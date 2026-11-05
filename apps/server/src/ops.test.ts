import { createHmac } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { and, desc, eq, gt } from 'drizzle-orm';
import { attemptDelivery, cancelOrder, createFulfillment, createLocalStorage, getPrimaryShop, refundOrder, schema as s, seedDemo, type Mail } from '@shopme/core';
import { createTestApp, setupAndLogin, type TestApp } from './test-utils';

let t: TestApp;
let owner: string;
let sent: Mail[] = [];
const sku: Record<string, number> = {};

async function gqlAs(cookie: string, query: string, variables: Record<string, unknown> = {}) {
  const res = await t.app.inject({ method: 'POST', url: '/admin/api/2026-10/graphql.json', cookies: { shopme_session: cookie }, payload: { query, variables } });
  return res.json() as { data?: any; errors?: { message: string; extensions?: { code?: string } }[] };
}
const gql = (query: string, variables?: Record<string, unknown>) => gqlAs(owner, query, variables);
const gid = (type: string, id: number) => `gid://shopify/${type}/${id}`;

beforeAll(async () => {
  t = await createTestApp();
  owner = await setupAndLogin(t.app);
  await seedDemo(t.dbHandle.db, createLocalStorage(mkdtempSync(path.join(tmpdir(), 'ops-'))));
  for (const v of await t.dbHandle.db.select().from(s.productVariants)) if (v.sku) sku[v.sku] = v.id;
  t.app.ctx.mailer = { send: async (m) => { sent.push(m); } };
}, 90_000);
afterAll(async () => { await t.close(); });

describe('policies and cookie banner', () => {
  it('stores policies, lists all types and serves them on the storefront', async () => {
    const r = await gql(`mutation { shopPolicyUpdate(shopPolicy: { type: REFUND_POLICY, body: "<p>Refunds within 30 days</p>" }) { shopPolicy { id type title body url } userErrors { message } } }`);
    expect(r.data.shopPolicyUpdate.userErrors).toEqual([]);
    expect(r.data.shopPolicyUpdate.shopPolicy).toMatchObject({ type: 'REFUND_POLICY', title: 'Refund policy', body: '<p>Refunds within 30 days</p>' });
    expect(r.data.shopPolicyUpdate.shopPolicy.url).toMatch(/\/policies\/refund-policy$/);
    const list = await gql('{ shop { shopPolicies { type body } } }');
    expect(list.data.shop.shopPolicies.map((p: { type: string }) => p.type)).toEqual(['REFUND_POLICY', 'PRIVACY_POLICY', 'TERMS_OF_SERVICE', 'SHIPPING_POLICY', 'CONTACT_INFORMATION']);
    const page = await t.app.inject('/policies/refund-policy');
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain('Refunds within 30 days');
    await gql(`mutation { shopPolicyUpdate(shopPolicy: { type: REFUND_POLICY, body: "" }) { userErrors { message } } }`);
    expect((await t.app.inject('/policies/refund-policy')).statusCode).toBe(404);
  });

  it('cookie banner setting', async () => {
    const r = await gql(`mutation { shopmeCookieBannerUpdate(enabled: true, message: "Cookies!") { cookieBanner { enabled message } } }`);
    expect(r.data.shopmeCookieBannerUpdate.cookieBanner).toEqual({ enabled: true, message: 'Cookies!' });
    expect((await gql('{ shop { shopmeCookieBanner { enabled } } }')).data.shop.shopmeCookieBanner.enabled).toBe(true);
    const shop = (await getPrimaryShop(t.dbHandle.db))!;
    expect(shop.settings.cookieBanner).toEqual({ enabled: true, message: 'Cookies!' });
  });
});

describe('outbound webhooks', () => {
  let server: Server;
  let url: string;
  const hits: { headers: Record<string, string | string[] | undefined>; body: string }[] = [];
  let status = 200;

  beforeAll(async () => {
    process.env.WEBHOOKS_ALLOW_PRIVATE = '1'; // the receiver below listens on loopback
    server = createServer((req, res) => {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => { hits.push({ headers: req.headers, body }); res.statusCode = status; res.end('ok'); });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    url = `http://127.0.0.1:${(server.address() as { port: number }).port}/hook`;
  });
  afterAll(async () => { delete process.env.WEBHOOKS_ALLOW_PRIVATE; await new Promise((r) => server.close(r)); });

  it('manages subscriptions', async () => {
    const c = await gql(`mutation($u: URL!) { webhookSubscriptionCreate(topic: CUSTOMERS_CREATE, webhookSubscription: { callbackUrl: $u, format: JSON }) { webhookSubscription { id topic format endpoint { ... on WebhookHttpEndpoint { callbackUrl } } } userErrors { field message } } }`, { u: url });
    expect(c.data.webhookSubscriptionCreate.userErrors).toEqual([]);
    expect(c.data.webhookSubscriptionCreate.webhookSubscription).toMatchObject({ topic: 'CUSTOMERS_CREATE', format: 'JSON', endpoint: { callbackUrl: url } });
    const dup = await gql(`mutation($u: URL!) { webhookSubscriptionCreate(topic: CUSTOMERS_CREATE, webhookSubscription: { callbackUrl: $u }) { userErrors { message } } }`, { u: url });
    expect(dup.data.webhookSubscriptionCreate.userErrors[0].message).toMatch(/already been taken/);
    const bad = await gql(`mutation { webhookSubscriptionCreate(topic: ORDERS_PAID, webhookSubscription: { callbackUrl: "ftp://x.example/hook" }) { userErrors { message } } }`);
    expect(bad.data.webhookSubscriptionCreate.userErrors[0].message).toMatch(/http/);
    const list = await gql('{ webhookSubscriptions(first: 10) { nodes { topic callbackUrl } } }');
    expect(list.data.webhookSubscriptions.nodes).toEqual([{ topic: 'CUSTOMERS_CREATE', callbackUrl: url }]);
    const id = c.data.webhookSubscriptionCreate.webhookSubscription.id;
    expect((await gql(`{ webhookSubscription(id: "${id}") { topic } }`)).data.webhookSubscription.topic).toBe('CUSTOMERS_CREATE');
  });

  it('delivers signed events and logs them', async () => {
    const secret = (await gql('{ shopmeWebhookSettings { signingSecret } }')).data.shopmeWebhookSettings.signingSecret as string;
    expect(secret).toMatch(/^whsec_/);
    expect((await gql('{ shopmeWebhookSettings { signingSecret } }')).data.shopmeWebhookSettings.signingSecret).toBe(secret);
    await gql(`mutation { customerCreate(input: { email: "hook@example.com", firstName: "Hook" }) { customer { id } userErrors { message } } }`);
    await vi.waitFor(() => expect(hits.length).toBe(1), { timeout: 8000 });
    const h = hits[0]!;
    expect(h.headers['x-shopify-topic']).toBe('customers/create');
    expect(h.headers['x-shopify-hmac-sha256']).toBe(createHmac('sha256', secret).update(h.body).digest('base64'));
    expect(h.headers['x-shopify-shop-domain']).toBeTruthy();
    expect(h.headers['x-shopify-webhook-id']).toBeTruthy();
    expect(JSON.parse(h.body)).toMatchObject({ email: 'hook@example.com', first_name: 'Hook' });
    await vi.waitFor(async () => {
      const log = await gql('{ shopmeWebhookDeliveries(first: 5) { nodes { topic status attempts responseCode } } }');
      expect(log.data.shopmeWebhookDeliveries.nodes).toEqual([{ topic: 'CUSTOMERS_CREATE', status: 'SUCCESS', attempts: 1, responseCode: 200 }]);
    });
  });

  it('retries failures with backoff', async () => {
    hits.length = 0; status = 500;
    await gql(`mutation { customerCreate(input: { email: "retry@example.com" }) { userErrors { message } } }`);
    const pending = () => t.dbHandle.db.select().from(s.webhookDeliveries).where(eq(s.webhookDeliveries.status, 'PENDING'));
    await vi.waitFor(async () => expect((await pending())[0]?.attempts).toBe(1), { timeout: 8000 });
    const [d] = await pending();
    expect(d).toMatchObject({ attempts: 1, responseCode: 500, lastError: 'HTTP 500' });
    expect(d!.nextAttemptAt!.getTime()).toBeGreaterThan(Date.now());
    status = 200;
    const shop = (await getPrimaryShop(t.dbHandle.db))!;
    const next = await attemptDelivery(t.dbHandle.db, shop, d!.id, { shopDomain: 'x', now: new Date(Date.now() + 3600_000) });
    expect(next).toBeNull();
    expect((await t.dbHandle.db.select().from(s.webhookDeliveries).where(eq(s.webhookDeliveries.id, d!.id)))[0]).toMatchObject({ status: 'SUCCESS', attempts: 2 });
  });

  it('refuses private and loopback targets at create and update unless WEBHOOKS_ALLOW_PRIVATE=1', async () => {
    delete process.env.WEBHOOKS_ALLOW_PRIVATE;
    try {
      const priv = async (u: string) => (await gql(`mutation($u: URL!) { webhookSubscriptionCreate(topic: ORDERS_PAID, webhookSubscription: { callbackUrl: $u }) { webhookSubscription { id } userErrors { message } } }`, { u })).data.webhookSubscriptionCreate;
      for (const u of ['http://127.0.0.1:9/hook', 'http://169.254.169.254/latest/meta-data', 'http://[::ffff:7f00:1]/hook', 'http://localhost:9/hook', 'http://[fd00::1]/hook']) {
        const r = await priv(u);
        expect(r.webhookSubscription, u).toBeNull();
        expect(r.userErrors[0].message, u).toMatch(/private or loopback/);
      }
      const existing = (await gql('{ webhookSubscriptions(first: 1) { nodes { id } } }')).data.webhookSubscriptions.nodes;
      if (existing.length) {
        const up = await gql(`mutation($id: ID!, $u: URL!) { webhookSubscriptionUpdate(id: $id, webhookSubscription: { callbackUrl: $u }) { userErrors { message } } }`, { id: existing[0].id, u: 'http://10.0.0.5/x' });
        expect(up.data.webhookSubscriptionUpdate.userErrors[0].message).toMatch(/private or loopback/);
      }
    } finally {
      process.env.WEBHOOKS_ALLOW_PRIVATE = '1';
    }
  });

  it('blocks delivery to an address that became private after subscribing', async () => {
    const [sub] = await t.dbHandle.db.select().from(s.webhookSubscriptions).limit(1);
    await t.dbHandle.db.update(s.webhookSubscriptions).set({ endpointUrl: 'http://10.1.2.3/hook' }).where(eq(s.webhookSubscriptions.id, sub!.id));
    const [last] = await t.dbHandle.db.select({ id: s.webhookDeliveries.id }).from(s.webhookDeliveries).orderBy(desc(s.webhookDeliveries.id)).limit(1);
    delete process.env.WEBHOOKS_ALLOW_PRIVATE; // dispatch happens with the guard on, so nothing connects to 10.1.2.3
    try {
      await gql(`mutation { customerCreate(input: { email: "ssrf@example.com" }) { userErrors { message } } }`);
      let d: typeof s.webhookDeliveries.$inferSelect | undefined;
      await vi.waitFor(async () => {
        [d] = await t.dbHandle.db.select().from(s.webhookDeliveries).where(and(eq(s.webhookDeliveries.subscriptionId, sub!.id), gt(s.webhookDeliveries.id, last?.id ?? 0))).orderBy(desc(s.webhookDeliveries.id)).limit(1);
        expect(d).toBeTruthy();
      }, { timeout: 8000 });
      const shop = (await getPrimaryShop(t.dbHandle.db))!;
      await attemptDelivery(t.dbHandle.db, shop, d!.id, { shopDomain: 'x', now: new Date(Date.now() + 3600_000) });
      const [row] = await t.dbHandle.db.select().from(s.webhookDeliveries).where(eq(s.webhookDeliveries.id, d!.id));
      expect(row!.lastError).toMatch(/private or loopback/);
      expect(row!.responseCode).toBeNull();
    } finally {
      process.env.WEBHOOKS_ALLOW_PRIVATE = '1';
    }
  });

  it('removes subscriptions', async () => {
    const id = (await gql('{ webhookSubscriptions(first: 1) { nodes { id } } }')).data.webhookSubscriptions.nodes[0].id;
    const r = await gql(`mutation { webhookSubscriptionDelete(id: "${id}") { deletedWebhookSubscriptionId userErrors { message } } }`);
    expect(r.data.webhookSubscriptionDelete.deletedWebhookSubscriptionId).toBe(id);
  });
});

describe('draft orders', () => {
  const FIELDS = 'id name status invoiceUrl email totalPriceSet { shopMoney { amount } } subtotalPriceSet { shopMoney { amount } } totalDiscountsSet { shopMoney { amount } } totalShippingPriceSet { shopMoney { amount } } order { id name displayFinancialStatus }';
  const input = (extra = '') => `{
    email: "Draft@Example.com",
    lineItems: [
      { variantId: "${gid('ProductVariant', sku['HEB-250']!)}", quantity: 2, appliedDiscount: { value: 10, valueType: PERCENTAGE, title: "Friends" } },
      { title: "Gift wrap", originalUnitPrice: "15.00", quantity: 1, taxable: false, requiresShipping: false }
    ],
    appliedDiscount: { value: 5, valueType: FIXED_AMOUNT, title: "Goodwill" },
    shippingLine: { title: "Courier", price: "4.90" },
    shippingAddress: { firstName: "Ada", lastName: "Lovelace", address1: "1 Rue de Rivoli", city: "Paris", zip: "75001", countryCode: FR }
    ${extra} }`;
  let draftId = '';
  let stockBefore = 0;
  const stock = async () => (await t.dbHandle.db.select().from(s.inventoryLevels).innerJoin(s.inventoryItems, eq(s.inventoryItems.id, s.inventoryLevels.inventoryItemId)).where(eq(s.inventoryItems.variantId, sku['HEB-250']!)))[0]!.inventory_levels.available;

  it('calculates and creates with custom lines, discounts and shipping', async () => {
    const calc = await gql(`mutation { draftOrderCalculate(input: ${input()}) { calculatedDraftOrder { subtotalPriceSet { shopMoney { amount } } totalDiscountsSet { shopMoney { amount } } totalPriceSet { shopMoney { amount } } lineItems { title custom quantity appliedDiscount { title value valueType amountSet { shopMoney { amount } } } } } userErrors { field message } } }`);
    expect(calc.data.draftOrderCalculate.userErrors).toEqual([]);
    const c = calc.data.draftOrderCalculate.calculatedDraftOrder;
    expect(c.totalDiscountsSet.shopMoney.amount).toBe('7.6'); // 2.60 (10% of 26.00) + 5.00
    expect(c.lineItems.map((l: { title: string; custom: boolean }) => [l.title, l.custom])).toEqual([['House Espresso Blend', false], ['Gift wrap', true]]);
    expect(c.lineItems[0].appliedDiscount).toMatchObject({ title: 'Friends', value: 10, valueType: 'PERCENTAGE', amountSet: { shopMoney: { amount: '2.6' } } });

    stockBefore = await stock();
    const r = await gql(`mutation { draftOrderCreate(input: ${input()}) { draftOrder { ${FIELDS} lineItems(first: 5) { nodes { title } } } userErrors { field message } } }`);
    expect(r.data.draftOrderCreate.userErrors).toEqual([]);
    const d = r.data.draftOrderCreate.draftOrder;
    expect(d).toMatchObject({ name: '#D1', status: 'OPEN', email: 'draft@example.com', totalShippingPriceSet: { shopMoney: { amount: '4.9' } } });
    expect(d.totalPriceSet.shopMoney.amount).toBe(c.totalPriceSet.shopMoney.amount);
    expect(d.invoiceUrl).toMatch(/\/draft_orders\/.+\/pay$/);
    expect(d.lineItems.nodes).toHaveLength(2);
    draftId = d.id;
    expect((await gql(`{ draftOrders(first: 5, query: "status:open") { nodes { id } } draftOrdersCount { count } }`)).data).toMatchObject({ draftOrders: { nodes: [{ id: draftId }] }, draftOrdersCount: { count: 1 } });
  });

  it('validates input', async () => {
    const r = await gql(`mutation { draftOrderCreate(input: { email: "a@b.co", lineItems: [{ title: "x", quantity: 1 }] }) { draftOrder { id } userErrors { field message } } }`);
    expect(r.data.draftOrderCreate.draftOrder).toBeNull();
    expect(r.data.draftOrderCreate.userErrors[0].field).toEqual(['lineItems', '0', 'originalUnitPrice']);
    const empty = await gql(`mutation { draftOrderCreate(input: { email: "a@b.co" }) { userErrors { message } } }`);
    expect(empty.data.draftOrderCreate.userErrors[0].message).toMatch(/at least 1/);
  });

  it('updates, then completes into a paid order through order creation', async () => {
    const up = await gql(`mutation { draftOrderUpdate(id: "${draftId}", input: { note: "VIP", tags: ["vip"] }) { draftOrder { ${FIELDS} } userErrors { message } } }`);
    expect(up.data.draftOrderUpdate.userErrors).toEqual([]);
    const total = up.data.draftOrderUpdate.draftOrder.totalPriceSet.shopMoney.amount;
    const done = await gql(`mutation { draftOrderComplete(id: "${draftId}") { draftOrder { status order { id name displayFinancialStatus totalPriceSet { shopMoney { amount } } note tags lineItems(first: 5) { nodes { title quantity variant { id } } } } } userErrors { message } } }`);
    expect(done.data.draftOrderComplete.userErrors).toEqual([]);
    const o = done.data.draftOrderComplete.draftOrder;
    expect(o.status).toBe('COMPLETED');
    expect(o.order).toMatchObject({ name: '#1001', displayFinancialStatus: 'PAID', note: 'VIP', tags: ['vip'], totalPriceSet: { shopMoney: { amount: total } } });
    expect(o.order.lineItems.nodes.map((l: { title: string; variant: unknown }) => [l.title, l.variant === null])).toEqual([['House Espresso Blend', false], ['Gift wrap', true]]);
    expect(await stock()).toBe(stockBefore - 2);
    const again = await gql(`mutation { draftOrderComplete(id: "${draftId}") { userErrors { message } } }`);
    expect(again.data.draftOrderComplete.userErrors[0].message).toMatch(/already completed/);
    const edit = await gql(`mutation { draftOrderUpdate(id: "${draftId}", input: { note: "x" }) { userErrors { message } } }`);
    expect(edit.data.draftOrderUpdate.userErrors[0].message).toMatch(/cannot be edited/);
  });

  it('completes with payment pending, sends the invoice and serves the pay link', async () => {
    const mk = await gql(`mutation { draftOrderCreate(input: ${input()}) { draftOrder { id invoiceUrl } } }`);
    const { id, invoiceUrl } = mk.data.draftOrderCreate.draftOrder;
    sent = [];
    const inv = await gql(`mutation { draftOrderInvoiceSend(id: "${id}", email: { customMessage: "Please pay soon" }) { draftOrder { status invoiceSentAt } userErrors { message } } }`);
    expect(inv.data.draftOrderInvoiceSend.draftOrder.status).toBe('INVOICE_SENT');
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ to: 'draft@example.com' });
    expect(sent[0]!.subject).toContain('#D2');
    expect(sent[0]!.html).toContain(invoiceUrl);
    expect(sent[0]!.html).toContain('Please pay soon');
    // custom items: the pay link shows the invoice and confirms with payment pending
    const pathOf = new URL(invoiceUrl).pathname;
    const page = await t.app.inject(pathOf);
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain('#D2');
    const post = await t.app.inject({ method: 'POST', url: pathOf, payload: '', headers: { 'content-type': 'application/x-www-form-urlencoded' } });
    expect(post.statusCode).toBe(200);
    const [order] = await t.dbHandle.db.select().from(s.orders).where(eq(s.orders.orderNumber, 1002));
    expect(order).toMatchObject({ financialStatus: 'PENDING', sourceName: 'draft_order_invoice' });
    expect((await gql(`{ draftOrder(id: "${id}") { status } }`)).data.draftOrder.status).toBe('COMPLETED');
  });

  it('opens the checkout pre-filled for variant-only drafts', async () => {
    const mk = await gql(`mutation { draftOrderCreate(input: { email: "buyer2@example.com", lineItems: [{ variantId: "${gid('ProductVariant', sku['HEB-250']!)}", quantity: 1 }], shippingAddress: { firstName: "Ada", lastName: "L", address1: "1 Rue", city: "Paris", zip: "75001", countryCode: FR } }) { draftOrder { id invoiceUrl } userErrors { message } } }`);
    const { id, invoiceUrl } = mk.data.draftOrderCreate.draftOrder;
    const res = await t.app.inject(new URL(invoiceUrl).pathname);
    expect(res.statusCode).toBe(303);
    expect(res.headers.location).toMatch(/^\/checkouts\//);
    const page = await t.app.inject({ url: String(res.headers.location), cookies: { cart: res.cookies.find((c) => c.name === 'cart')!.value } });
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain('House Espresso Blend');
    expect(page.body).toContain('buyer2@example.com');
    const del = await gql(`mutation { draftOrderDelete(input: { id: "${id}" }) { deletedId userErrors { message } } }`);
    expect(del.data.draftOrderDelete.deletedId).toBe(id);
    expect((await gql(`{ draftOrder(id: "${id}") { id } }`)).data.draftOrder).toBeNull();
  });
});

describe('notification templates and order hooks', () => {
  it('lists, edits (Liquid), previews and resets templates', async () => {
    const list = await gql('{ shopmeNotificationTemplates { key customized subject variables } }');
    expect(list.data.shopmeNotificationTemplates.map((x: { key: string }) => x.key)).toEqual(expect.arrayContaining([
      'order_confirmation', 'staff_new_order', 'shipping_confirmation', 'shipping_update', 'order_cancelled', 'refund', 'customer_account_welcome', 'customer_account_invite', 'password_reset', 'draft_order_invoice', 'contact_form',
    ]));
    const bad = await gql(`mutation { shopmeNotificationTemplateUpdate(key: "refund", subject: "{% if %}", body: "x") { userErrors { message } } }`);
    expect(bad.data.shopmeNotificationTemplateUpdate.userErrors[0].message).toMatch(/Liquid/);
    const up = await gql(`mutation { shopmeNotificationTemplateUpdate(key: "refund", subject: "Money back for {{ order.name }}", body: "<p>Hi {{ order.email }}: {{ refund.amount }} <b>{{ refund.note }}</b></p>") { template { customized subject } userErrors { message } } }`);
    expect(up.data.shopmeNotificationTemplateUpdate.template).toEqual({ customized: true, subject: 'Money back for {{ order.name }}' });
    const prev = await gql(`mutation { shopmeNotificationPreview(key: "refund") { preview { subject html text } userErrors { message } } }`);
    expect(prev.data.shopmeNotificationPreview.preview.subject).toBe('Money back for #1001');
    expect(prev.data.shopmeNotificationPreview.preview.text).toContain('customer@example.com');
    const xss = await gql(`mutation { shopmeNotificationPreview(key: "contact_form", body: "{{ contact.message }}") { preview { html } } }`);
    expect(xss.data.shopmeNotificationPreview.preview.html).toContain('Hello, do you ship to Canada?');
    const esc = await gql(`mutation { shopmeNotificationPreview(key: "refund", body: "{{ shop.name }}", subject: "s") { preview { html } } }`);
    expect(esc.data.shopmeNotificationPreview.preview.html).toContain('Test Shop');
    const reset = await gql(`mutation { shopmeNotificationTemplateReset(key: "refund") { template { customized subject } } }`);
    expect(reset.data.shopmeNotificationTemplateReset.template).toEqual({ customized: false, subject: 'Refund for order {{ order.name }}' });
    expect((await gql(`mutation { shopmeNotificationTemplateReset(key: "nope") { userErrors { message } } }`)).data.shopmeNotificationTemplateReset.userErrors).toHaveLength(1);
  });

  it('sender settings apply to outgoing emails; hooks send shipping, refund and cancellation emails', async () => {
    const set = await gql(`mutation { shopmeNotificationSettingsUpdate(senderName: "Test Shop", senderEmail: "orders@example.com") { settings { senderName senderEmail } userErrors { message } } }`);
    expect(set.data.shopmeNotificationSettingsUpdate.settings).toEqual({ senderName: 'Test Shop', senderEmail: 'orders@example.com' });
    expect((await gql(`mutation { shopmeNotificationSettingsUpdate(senderEmail: "nope") { userErrors { message } } }`)).data.shopmeNotificationSettingsUpdate.userErrors).toHaveLength(1);
    await gql(`mutation { shopmeNotificationTemplateUpdate(key: "refund", subject: "Money back for {{ order.name }}", body: "<p>Refunded {{ refund.amount }}</p>") { userErrors { message } } }`);

    const db = t.dbHandle.db;
    const shop = (await getPrimaryShop(db))!;
    const [o1] = await db.select().from(s.orders).where(eq(s.orders.orderNumber, 1001));
    sent = [];
    expect((await createFulfillment(db, shop.id, o1!.id, { notifyCustomer: true, tracking: { company: 'UPS', numbers: ['T123'], urls: ['https://track.example/T123'] } })).ok).toBe(true);
    await vi.waitFor(() => expect(sent.length).toBe(1), { timeout: 8000 });
    expect(sent[0]).toMatchObject({ to: 'draft@example.com', from: '"Test Shop" <orders@example.com>', replyTo: shop.email });
    expect(sent[0]!.subject).toBe('Your order #1001 is on its way');
    expect(sent[0]!.html).toContain('T123');
    expect(sent[0]!.text).toContain('House Espresso Blend');

    sent = [];
    expect((await refundOrder(db, shop.id, o1!.id, { amount: 500, notifyCustomer: true })).ok).toBe(true);
    await vi.waitFor(() => expect(sent.length).toBe(1), { timeout: 8000 });
    expect(sent[0]!.subject).toBe('Money back for #1001');
    expect(sent[0]!.html).toContain('Refunded');

    // not requested -> not sent
    sent = [];
    const [o2] = await db.select().from(s.orders).where(eq(s.orders.orderNumber, 1002));
    expect((await cancelOrder(db, shop.id, o2!.id, { reason: 'OTHER', restock: true })).ok).toBe(true);
    await new Promise((r) => setTimeout(r, 900));
    expect(sent).toHaveLength(0);
  });

  it('sends the cancellation email when asked', async () => {
    const db = t.dbHandle.db;
    const shop = (await getPrimaryShop(db))!;
    const mk = await gql(`mutation { draftOrderCreate(input: { email: "cancel@example.com", lineItems: [{ title: "Thing", originalUnitPrice: "10.00", quantity: 1 }] }) { draftOrder { id } } }`);
    const done = await gql(`mutation { draftOrderComplete(id: "${mk.data.draftOrderCreate.draftOrder.id}", paymentPending: true) { draftOrder { order { id } } } }`);
    const orderId = Number(done.data.draftOrderComplete.draftOrder.order.id.split('/').pop());
    sent = [];
    expect((await cancelOrder(db, shop.id, orderId, { reason: 'CUSTOMER', restock: false, notifyCustomer: true })).ok).toBe(true);
    await vi.waitFor(() => expect(sent.length).toBe(1), { timeout: 8000 });
    expect(sent[0]).toMatchObject({ to: 'cancel@example.com' });
    expect(sent[0]!.subject).toContain('was cancelled');
  });
});

describe('staff and permissions', () => {
  let inviteUrl = '';
  let staffCookie = '';
  let staffId = '';

  it('invites by email and creates a pending member', async () => {
    sent = [];
    const r = await gql(`mutation { shopmeStaffInvite(email: "Clerk@Example.com", role: "staff", permissions: ["products", "orders"], firstName: "Cle") { staffMember { id email shopmeRole shopmePermissions shopmeInvitePending } inviteUrl userErrors { message } } }`);
    expect(r.data.shopmeStaffInvite.userErrors).toEqual([]);
    expect(r.data.shopmeStaffInvite.staffMember).toMatchObject({ email: 'clerk@example.com', shopmeRole: 'staff', shopmePermissions: ['products', 'orders'], shopmeInvitePending: true });
    staffId = r.data.shopmeStaffInvite.staffMember.id;
    inviteUrl = r.data.shopmeStaffInvite.inviteUrl;
    expect(inviteUrl).toMatch(/\/admin\/invite\/.+/);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.html).toContain(inviteUrl);
    const dup = await gql(`mutation { shopmeStaffInvite(email: "owner@example.com", role: "staff") { userErrors { message } } }`);
    expect(dup.data.shopmeStaffInvite.userErrors[0].message).toMatch(/already exists/);
    expect((await gql(`mutation { shopmeStaffInvite(email: "x@example.com", role: "owner") { userErrors { message } } }`)).data.shopmeStaffInvite.userErrors).toHaveLength(1);
    expect((await gql(`mutation { shopmeStaffInvite(email: "x@example.com", role: "staff", permissions: ["nope"]) { userErrors { message } } }`)).data.shopmeStaffInvite.userErrors).toHaveLength(1);
  });

  it('cannot log in before accepting; accepting sets the password and signs in', async () => {
    const token = inviteUrl.split('/').pop()!;
    expect((await t.app.inject({ method: 'POST', url: '/admin/api/auth/login', payload: { email: 'clerk@example.com', password: 'whatever123' } })).statusCode).toBe(401);
    expect((await t.app.inject(`/admin/api/staff/invite/${token}`)).json()).toMatchObject({ email: 'clerk@example.com', shopName: 'Test Shop' });
    expect((await t.app.inject('/admin/api/staff/invite/nope-nope-nope')).statusCode).toBe(404);
    expect((await t.app.inject({ method: 'POST', url: '/admin/api/staff/accept-invite', payload: { token, password: 'short' } })).statusCode).toBe(422);
    const ok = await t.app.inject({ method: 'POST', url: '/admin/api/staff/accept-invite', payload: { token, password: 'a good password' } });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().user).toMatchObject({ email: 'clerk@example.com', role: 'staff', permissions: ['products', 'orders'] });
    staffCookie = ok.cookies.find((c) => c.name === 'shopme_session')!.value;
    // single use
    expect((await t.app.inject({ method: 'POST', url: '/admin/api/staff/accept-invite', payload: { token, password: 'another password' } })).statusCode).toBe(422);
    expect((await t.app.inject({ method: 'POST', url: '/admin/api/auth/login', payload: { email: 'clerk@example.com', password: 'a good password' } })).statusCode).toBe(200);
  });

  it('enforces permissions per area in GraphQL and REST', async () => {
    expect((await gqlAs(staffCookie, '{ products(first: 1) { nodes { id } } orders(first: 1) { nodes { id } } }')).errors).toBeUndefined();
    const denied = await gqlAs(staffCookie, '{ customers(first: 1) { nodes { id } } }');
    expect(denied.errors![0]!.extensions!.code).toBe('ACCESS_DENIED');
    expect((await gqlAs(staffCookie, '{ draftOrders(first: 1) { nodes { id } } }')).errors).toBeUndefined(); // orders area
    expect((await gqlAs(staffCookie, '{ staffMembers(first: 5) { nodes { id } } }')).errors![0]!.extensions!.code).toBe('ACCESS_DENIED');
    expect((await gqlAs(staffCookie, `mutation { shopmeStaffInvite(email: "z@example.com", role: "staff") { userErrors { message } } }`)).errors![0]!.extensions!.code).toBe('ACCESS_DENIED');
    expect((await gqlAs(staffCookie, `mutation { shopPolicyUpdate(shopPolicy: { type: REFUND_POLICY, body: "x" }) { userErrors { message } } }`)).errors![0]!.extensions!.code).toBe('ACCESS_DENIED');
    expect((await gqlAs(staffCookie, '{ webhookSubscriptions(first: 1) { nodes { id } } }')).errors![0]!.extensions!.code).toBe('ACCESS_DENIED');
    expect((await t.app.inject({ url: '/admin/api/customers/1/export.json', cookies: { shopme_session: staffCookie } })).statusCode).toBe(403);
    const me = await gqlAs(staffCookie, '{ currentStaffMember { email shopmeRole shopmePermissions } }');
    expect(me.data.currentStaffMember).toEqual({ email: 'clerk@example.com', shopmeRole: 'staff', shopmePermissions: ['products', 'orders'] });
  });

  it('updates permissions and keeps the owner safe', async () => {
    const up = await gql(`mutation { shopmeStaffUpdate(id: "${staffId}", permissions: ["customers"]) { staffMember { shopmePermissions } userErrors { message } } }`);
    expect(up.data.shopmeStaffUpdate.staffMember.shopmePermissions).toEqual(['customers']);
    expect((await gqlAs(staffCookie, '{ customers(first: 1) { nodes { id } } }')).errors).toBeUndefined();
    expect((await gqlAs(staffCookie, '{ products(first: 1) { nodes { id } } }')).errors![0]!.extensions!.code).toBe('ACCESS_DENIED');

    const ownerId = (await gql('{ currentStaffMember { id isShopOwner shopmeRole } }')).data.currentStaffMember;
    expect(ownerId).toMatchObject({ isShopOwner: true, shopmeRole: 'owner' });
    for (const q of [
      `mutation { shopmeStaffDeactivate(id: "${ownerId.id}") { userErrors { message } } }`,
      `mutation { shopmeStaffDelete(id: "${ownerId.id}") { userErrors { message } } }`,
      `mutation { shopmeStaffUpdate(id: "${ownerId.id}", role: "staff") { userErrors { message } } }`,
    ]) {
      const r = await gql(q);
      expect(Object.values(r.data)[0]).toMatchObject({ userErrors: [{ message: expect.stringMatching(/owner/) }] });
    }
    // an admin cannot manage another admin
    const adm = (await gql(`mutation { shopmeStaffInvite(email: "adm@example.com", role: "admin") { inviteUrl } }`)).data.shopmeStaffInvite.inviteUrl as string;
    const acc = await t.app.inject({ method: 'POST', url: '/admin/api/staff/accept-invite', payload: { token: adm.split('/').pop(), password: 'admin password' } });
    const admCookie = acc.cookies.find((c) => c.name === 'shopme_session')!.value;
    expect((await gqlAs(admCookie, '{ customers(first: 1) { nodes { id } } }')).errors).toBeUndefined();
    const admId = acc.json().user.id;
    const r = await gqlAs(admCookie, `mutation { shopmeStaffDeactivate(id: "${gid('StaffMember', admId)}") { userErrors { message } } }`);
    expect(r.data.shopmeStaffDeactivate.userErrors[0].message).toMatch(/own account|administrators/);
    const r2 = await gqlAs(admCookie, `mutation { shopmeStaffInvite(email: "adm2@example.com", role: "admin") { userErrors { message } } }`);
    expect(r2.data.shopmeStaffInvite.userErrors[0].message).toMatch(/owner can manage/);
  });

  it('deactivation ends sessions; deletion removes the member', async () => {
    const d = await gql(`mutation { shopmeStaffDeactivate(id: "${staffId}") { staffMember { active } userErrors { message } } }`);
    expect(d.data.shopmeStaffDeactivate.staffMember.active).toBe(false);
    expect((await t.app.inject({ url: '/admin/api/auth/me', cookies: { shopme_session: staffCookie } })).statusCode).toBe(401);
    expect((await t.app.inject({ method: 'POST', url: '/admin/api/auth/login', payload: { email: 'clerk@example.com', password: 'a good password' } })).statusCode).toBe(401);
    const del = await gql(`mutation { shopmeStaffDelete(id: "${staffId}") { deletedStaffMemberId userErrors { message } } }`);
    expect(del.data.shopmeStaffDelete.deletedStaffMemberId).toBe(staffId);
    expect((await gql(`{ staffMember(id: "${staffId}") { id } }`)).data.staffMember).toBeNull();
  });
});

describe('customer data export', () => {
  it('exports everything stored about a customer', async () => {
    const [c] = await t.dbHandle.db.select().from(s.customers).where(eq(s.customers.email, 'draft@example.com'));
    expect((await t.app.inject(`/admin/api/customers/${c!.id}/export.json`)).statusCode).toBe(401);
    const res = await t.app.inject({ url: `/admin/api/customers/${c!.id}/export.json`, cookies: { shopme_session: owner } });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-disposition']).toContain('attachment');
    const data = res.json();
    expect(data.customer.email).toBe('draft@example.com');
    expect(data.customer.passwordHash).toBeUndefined();
    expect(data.orders.length).toBeGreaterThanOrEqual(2);
    expect(data.orders[0].lines.length).toBeGreaterThan(0);
    expect((await t.app.inject({ url: '/admin/api/customers/999999/export.json', cookies: { shopme_session: owner } })).statusCode).toBe(404);
  });
});


