import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import {
  createCodeDiscount, createCustomerSegment, createFulfillment, createLocalStorage, createReturn, getPrimaryShop, getShop, recordBackupResult, schema as s, seedDemo, updateCheckoutSettings, updateReturnRules,
  type Mail,
} from '@shopme/core';
import { createTestApp, SETUP_BODY, type TestApp } from './test-utils';
import { makeGql, makeGqlOk } from '../test/conformance/helpers';

const ADDRESS = { email: 'buyer@example.com', firstName: 'Ada', lastName: 'Lovelace', address1: '1 Rue de Rivoli', city: 'Paris', zip: '75001', countryCode: 'FR', phone: '' };
let t: TestApp;
let g: ReturnType<typeof makeGqlOk>;
let gql: ReturnType<typeof makeGql>;
let sent: Mail[];
let shopId: number;
const sku: Record<string, number> = {};
const db = () => t.dbHandle.db;
const gid = (type: string, id: number) => `gid://shopify/${type}/${id}`;

beforeAll(async () => {
  t = await createTestApp();
  const setup = await t.app.inject({ method: 'POST', url: '/admin/api/setup', payload: SETUP_BODY });
  const cookie = setup.cookies.find((c) => c.name === 'shopme_session')!.value;
  gql = makeGql(t.app, cookie);
  g = makeGqlOk(gql);
  await seedDemo(db(), createLocalStorage(mkdtempSync(path.join(tmpdir(), 'w8c-'))));
  shopId = (await getPrimaryShop(db()))!.id;
  for (const v of await db().select().from(s.productVariants)) if (v.sku) sku[v.sku] = v.id;
  sent = [];
  t.app.ctx.mailer = { send: async (m) => { sent.push(m); } };
}, 90_000);
afterAll(async () => { await t.close(); });

const shop = async () => (await getShop(db(), shopId))!;
const setCheckout = async (input: Parameters<typeof updateCheckoutSettings>[2]) => { const r = await updateCheckoutSettings(db(), await shop(), input); expect(r.ok).toBe(true); };

async function startCheckout(variant: string, quantity: number, cookies: Record<string, string> = {}) {
  const add = await t.app.inject({ method: 'POST', url: '/cart/add.js', payload: { id: sku[variant], quantity } });
  const cart = add.cookies.find((c) => c.name === 'cart')!.value;
  const go = await t.app.inject({ method: 'POST', url: '/checkout', cookies: { cart, ...cookies } });
  return { cart, token: go.headers.location!.toString().split('/').pop()! };
}
const refresh = (token: string, body: Record<string, unknown>) => t.app.inject({ method: 'POST', url: `/checkouts/${token}/refresh`, payload: body });
const complete = (token: string, extra: Record<string, string> = {}, base: Record<string, string> = ADDRESS) => t.app.inject({
  method: 'POST', url: `/checkouts/${token}/complete`, payload: new URLSearchParams({ ...base, paymentMethod: 'bank_transfer', ...extra }).toString(), headers: { 'content-type': 'application/x-www-form-urlencoded' },
});
const orderOf = async (token: string) => (await db().select().from(s.orders).where(eq(s.orders.cartToken, token)))[0]!;

describe('checkout settings', () => {
  it('defaults keep the current form', async () => {
    const { token } = await startCheckout('JPG-50', 1);
    const page = (await t.app.inject(`/checkouts/${token}`)).body;
    expect(page).toContain('name="company"');
    expect(page).toContain('name="address2"');
    expect(page).toContain('name="acceptsMarketing"');
    expect(page).not.toContain('name="tip"');
    expect(page).not.toContain('name="note"');
  });

  it('honours hidden, required and last-name-only rules on the page and on the server', async () => {
    await setCheckout({ nameMode: 'last', company: 'required', address2: 'hidden', phone: 'required', marketing: 'hidden', orderNotes: true });
    const { token } = await startCheckout('JPG-50', 1);
    const page = (await t.app.inject(`/checkouts/${token}`)).body;
    expect(page).not.toContain('name="firstName"');
    expect(page).not.toContain('name="address2"');
    expect(page).not.toContain('name="acceptsMarketing"');
    expect(page).toMatch(/name="company"[^>]*required/);
    expect(page).toMatch(/name="phone"[^>]*required/);
    expect(page).toContain('name="note"');
    await refresh(token, ADDRESS);
    const bad = await t.app.inject({ method: 'POST', url: `/checkouts/${token}/complete`, payload: { ...ADDRESS, paymentMethod: 'bank_transfer' }, headers: { 'content-type': 'application/json' } });
    expect(bad.statusCode).toBe(422);
    expect(bad.json().errors[0]).toMatch(/Company/);
    expect(bad.json().errors[0]).toMatch(/Phone/);
    expect(bad.json().errors[0]).not.toMatch(/First name/);
    const ok = await complete(token, { company: 'Analytical Engines', phone: '+33123456789', firstName: 'Ignored', address2: 'Ignored', acceptsMarketing: '1', note: 'Leave at the door' });
    expect(ok.statusCode).toBe(303);
    const o = await orderOf(token);
    expect(o.note).toBe('Leave at the door');
    const [ship] = await db().select().from(s.orderAddresses).where(eq(s.orderAddresses.orderId, o.id));
    expect(ship).toMatchObject({ company: 'Analytical Engines', firstName: null, address2: null });
    const [cust] = await db().select().from(s.customers).where(eq(s.customers.email, 'buyer@example.com'));
    expect(cust!.acceptsMarketing).toBe(false); // the opt-in is hidden: a posted value is ignored
  });

  it('pre-checks the marketing box, adds tips to the total and stores them on the order', async () => {
    await setCheckout({ nameMode: 'full', company: 'optional', address2: 'optional', phone: 'optional', marketing: 'checked', orderNotes: false, tipping: { enabled: true, presets: [10, 5] } });
    const { token } = await startCheckout('JPG-50', 1);
    const page = (await t.app.inject(`/checkouts/${token}`)).body;
    expect(page).toMatch(/name="acceptsMarketing"[^>]*checked/);
    expect(page).toContain('name="tip"');
    const base = (await refresh(token, ADDRESS)).json().amount as number;
    const r = (await refresh(token, { ...ADDRESS, tip: '10' })).json();
    expect(r.amount).toBeGreaterThan(base);
    expect(r.summary).toContain('Tip');
    const tip = r.amount - base;
    expect((await refresh(token, { ...ADDRESS, tip: 'custom', tipCustom: '2.50' })).json().amount).toBe(base + 250);
    expect((await refresh(token, { ...ADDRESS, tip: '99' })).json().amount).toBe(base); // not a preset
    await refresh(token, { ...ADDRESS, tip: '10' });
    expect((await complete(token, { tip: '10' })).statusCode).toBe(303);
    const o = await orderOf(token);
    expect(o.totalTip).toBe(tip);
    expect(o.total).toBe(base + tip);
    const [tx] = await db().select().from(s.transactions).where(eq(s.transactions.orderId, o.id));
    expect(tx!.amount).toBe(o.total);
    const q = await g(`query($id: ID!) { order(id: $id) { totalTipReceivedSet { shopMoney { amount } } } }`, { id: gid('Order', o.id) });
    expect(Number(q.order.totalTipReceivedSet.shopMoney.amount)).toBeCloseTo(tip / 100);
  });

  it('accepts a phone number as contact when email or phone is allowed', async () => {
    await setCheckout({ tipping: { enabled: false }, contactMethod: 'email_or_phone' });
    const { token } = await startCheckout('JPG-50', 1);
    const { email: _e, ...noEmail } = ADDRESS;
    expect((await t.app.inject(`/checkouts/${token}`)).body).toContain('Email or mobile phone number');
    expect((await complete(token, { email: '+33 6 12 34 56 78' }, noEmail as Record<string, string>)).statusCode).toBe(303);
    const o = await orderOf(token);
    expect(o.email).toBeNull();
    expect(o.phone).toBe('+33 6 12 34 56 78');
    // neither an email nor a phone: refused
    const again = await startCheckout('JPG-50', 1);
    const bad = await t.app.inject({ method: 'POST', url: `/checkouts/${again.token}/complete`, payload: { ...noEmail, email: 'nonsense', paymentMethod: 'bank_transfer' }, headers: { 'content-type': 'application/json' } });
    expect(bad.statusCode).toBe(422);
    expect(bad.json().errors[0]).toMatch(/email address or mobile phone/);
    await setCheckout({ contactMethod: 'email' });
  });

  it('can require a customer account', async () => {
    await setCheckout({ accountMode: 'required' });
    const { token } = await startCheckout('JPG-50', 1);
    const page = await t.app.inject(`/checkouts/${token}`);
    expect(page.statusCode).toBe(303);
    expect(page.headers.location).toContain(`/account/login?return_url=${encodeURIComponent(`/checkouts/${token}`)}`);
    expect((await complete(token)).statusCode).toBe(303);
    expect(await db().select().from(s.orders).where(eq(s.orders.cartToken, token))).toHaveLength(0);
    await setCheckout({ accountMode: 'guest' });
    expect((await t.app.inject(`/checkouts/${token}`)).statusCode).toBe(200);
  });

  it('validates the settings through the Admin API', async () => {
    const bad = await g(`mutation { shopmeCheckoutSettingsUpdate(input: { tipping: { enabled: true, presets: [] } }) { settings { orderNotes } userErrors { field message } } }`);
    expect(bad.shopmeCheckoutSettingsUpdate.userErrors[0].field).toEqual(['tipping', 'presets']);
    const ok = await g(`mutation { shopmeCheckoutSettingsUpdate(input: { phone: required, tipping: { enabled: true, presets: [15, 5, 5] } }) { settings { phone tipping { enabled presets } } userErrors { message } } }`);
    expect(ok.shopmeCheckoutSettingsUpdate.settings).toEqual({ phone: 'required', tipping: { enabled: true, presets: [5, 15] } });
    await setCheckout({ phone: 'optional', tipping: { enabled: false } });
  });
});

describe('notifications', () => {
  it('switches a notification off and sends "New order" to the staff recipients', async () => {
    await g(`mutation { shopmeNotificationToggle(key: "order_confirmation", enabled: false) { enabled userErrors { message } } }`);
    const locked = await g(`mutation { shopmeNotificationToggle(key: "password_reset", enabled: false) { userErrors { message } } }`);
    expect(locked.shopmeNotificationToggle.userErrors[0].message).toMatch(/always sent/);
    const r = await g(`mutation { shopmeStaffOrderRecipientsUpdate(emails: ["Ops@Example.com", "ops@example.com", "boss@example.com"]) { recipients { emails isDefault } userErrors { message } } }`);
    expect(r.shopmeStaffOrderRecipientsUpdate.recipients).toEqual({ emails: ['ops@example.com', 'boss@example.com'], isDefault: false });
    const badMail = await g(`mutation { shopmeStaffOrderRecipientsUpdate(emails: ["nope"]) { userErrors { message } } }`);
    expect(badMail.shopmeStaffOrderRecipientsUpdate.userErrors[0].message).toMatch(/not a valid/);

    sent.length = 0;
    const { token } = await startCheckout('SEG-75', 1);
    await refresh(token, ADDRESS);
    expect((await complete(token)).statusCode).toBe(303);
    await t.app.ctx.queue.idle();
    expect(sent.map((m) => m.to).sort()).toEqual(['boss@example.com', 'ops@example.com']); // no customer confirmation, no owner

    const list = await g(`{ shopmeNotificationTemplates { key enabled toggleable } }`);
    expect(list.shopmeNotificationTemplates.find((n: any) => n.key === 'order_confirmation')).toMatchObject({ enabled: false, toggleable: true });

    await g(`mutation { shopmeNotificationToggle(key: "order_confirmation", enabled: true) { enabled } }`);
    await g(`mutation { shopmeStaffOrderRecipientsUpdate(emails: []) { recipients { emails isDefault } } }`);
    sent.length = 0;
    const second = await startCheckout('SEG-75', 1);
    await refresh(second.token, ADDRESS);
    await complete(second.token);
    await t.app.ctx.queue.idle();
    expect(sent.map((m) => m.to).sort()).toEqual(['buyer@example.com', 'owner@example.com']);
  });

  it('does not email a switched-off shipping update', async () => {
    const order = (await db().select().from(s.orders).orderBy(s.orders.id))[0]!;
    await g(`mutation { shopmeNotificationToggle(key: "shipping_confirmation", enabled: false) { enabled } }`);
    sent.length = 0;
    const f = await createFulfillment(db(), shopId, order.id, { notify: true } as never);
    expect(f.ok).toBe(true);
    await t.app.ctx.queue.idle();
    await new Promise((r) => setTimeout(r, 800));
    await t.app.ctx.queue.idle();
    expect(sent.filter((m) => /on its way/.test(m.subject))).toHaveLength(0);
    await g(`mutation { shopmeNotificationToggle(key: "shipping_confirmation", enabled: true) { enabled } }`);
  });
});

describe('return rules', () => {
  it('enforces the window and final sale items, and copies the fees onto the return', async () => {
    const { token } = await startCheckout('HEB-250', 2);
    await refresh(token, ADDRESS);
    await complete(token);
    const order = await orderOf(token);
    await createFulfillment(db(), shopId, order.id, {});
    const [line] = await db().select().from(s.orderLines).where(eq(s.orderLines.orderId, order.id));

    const set = await g(`mutation { shopmeReturnRulesUpdate(input: { windowDays: 14, shippingCost: customer_fixed, shippingFee: 495, restockingFeePercent: 10 }) { rules { windowDays shippingFee restockingFeePercent } userErrors { message } } }`);
    expect(set.shopmeReturnRulesUpdate.userErrors).toEqual([]);
    const noFee = await g(`mutation { shopmeReturnRulesUpdate(input: { shippingCost: customer_fixed, shippingFee: 0 }) { userErrors { message } } }`);
    expect(noFee.shopmeReturnRulesUpdate.userErrors[0].message).toMatch(/fixed return shipping fee/);

    const late = await createReturn(db(), shopId, order.id, [{ orderLineId: line!.id, quantity: 1 }], { now: new Date(Date.now() + 15 * 86_400_000) });
    expect(late.ok).toBe(false);
    expect(!late.ok && late.errors[0]!.message).toMatch(/14-day/);

    await updateReturnRules(db(), await shop(), { finalSale: { productIds: [line!.productId!] } });
    const final = await createReturn(db(), shopId, order.id, [{ orderLineId: line!.id, quantity: 1 }]);
    expect(!final.ok && final.errors[0]!.message).toMatch(/final sale/);
    await updateReturnRules(db(), await shop(), { finalSale: { productIds: [] } });

    const ok = await g(`mutation($o: ID!, $l: ID!) { returnCreate(returnInput: { orderId: $o, returnLineItems: [{ fulfillmentLineItemId: $l, quantity: 1 }] }) { return { shopmeRestockingFeePercent shopmeReturnShippingFee { amount } } userErrors { message } } }`, { o: gid('Order', order.id), l: gid('LineItem', line!.id) });
    expect(ok.returnCreate.userErrors).toEqual([]);
    expect(ok.returnCreate.return).toMatchObject({ shopmeRestockingFeePercent: 10, shopmeReturnShippingFee: { amount: '4.95' } });
    const policy = await g(`mutation { shopPolicyUpdate(shopPolicy: { type: REFUND_POLICY, body: "<p>Our policy</p>" }) { userErrors { message } } }`);
    expect(policy.shopPolicyUpdate.userErrors).toEqual([]);
    const page = await t.app.inject('/policies/refund-policy');
    expect(page.body).toContain('14 days');
    expect(page.body).toContain('10% restocking fee');
    await g(`mutation { shopmeReturnRulesUpdate(input: { windowDays: null, shippingCost: free, restockingFeePercent: 0 }) { userErrors { message } } }`);
  });
});

describe('discount eligibility and tags', () => {
  it('limits a code to specific customers or segments and exposes the eligibility and tags', async () => {
    const [buyer] = await db().select().from(s.customers).where(eq(s.customers.email, 'buyer@example.com'));
    const seg = await createCustomerSegment(db(), shopId, { name: 'Buyers', query: 'email:buyer@example.com' });
    expect(seg.ok).toBe(true);
    const segId = seg.ok ? seg.value.id : 0;
    const base = { valueType: 'PERCENTAGE' as const, value: 1000, target: 'ORDER' as const };
    expect((await createCodeDiscount(db(), shopId, { ...base, code: 'VIPONLY', eligibility: 'CUSTOMERS', customerIds: [buyer!.id], tags: ['vip', 'VIP', 'spring'] })).ok).toBe(true);
    expect((await createCodeDiscount(db(), shopId, { ...base, code: 'SEGONLY', eligibility: 'SEGMENTS', segmentIds: [segId] })).ok).toBe(true);
    const empty = await createCodeDiscount(db(), shopId, { ...base, code: 'EMPTY', eligibility: 'SEGMENTS', segmentIds: [] });
    expect(empty.ok).toBe(false);
    expect((await createCodeDiscount(db(), shopId, { ...base, code: 'GHOST', eligibility: 'SEGMENTS', segmentIds: [999] })).ok).toBe(false);

    const { token } = await startCheckout('SEG-75', 1);
    for (const code of ['VIPONLY', 'SEGONLY']) {
      expect((await refresh(token, { ...ADDRESS, email: 'stranger@example.com', addDiscountCode: code })).json().discountError).toMatch(/not available for your account/);
      expect((await refresh(token, { ...ADDRESS, email: 'buyer@example.com', addDiscountCode: code })).json().discountError).toBe('');
      await refresh(token, { ...ADDRESS, removeDiscountCode: code });
    }

    const list = await g(`{ codeDiscountNodes(first: 20, query: "tag:vip") { nodes { codeDiscount { ... on DiscountCodeBasic { title tags context { __typename ... on DiscountCustomers { customers { id } } } } } } } }`);
    expect(list.codeDiscountNodes.nodes).toHaveLength(1);
    expect(list.codeDiscountNodes.nodes[0].codeDiscount).toMatchObject({ tags: ['vip', 'spring'], context: { __typename: 'DiscountCustomers', customers: [{ id: gid('Customer', buyer!.id) }] } });

    const viaApi = await g(`mutation($s: ID!) { discountCodeBasicCreate(basicCodeDiscount: { title: "Seg", code: "APISEG", startsAt: "2026-01-01T00:00:00Z", customerGets: { value: { percentage: 0.2 }, items: { all: true } }, context: { customerSegments: { add: [$s] } }, tags: ["api"] }) { codeDiscountNode { codeDiscount { ... on DiscountCodeBasic { context { __typename ... on DiscountCustomerSegments { segments { name } } } tags } } } userErrors { message } } }`, { s: gid('ShopmeCustomerSegment', segId) });
    expect(viaApi.discountCodeBasicCreate.userErrors).toEqual([]);
    expect(viaApi.discountCodeBasicCreate.codeDiscountNode.codeDiscount).toMatchObject({ tags: ['api'], context: { __typename: 'DiscountCustomerSegments', segments: [{ name: 'Buyers' }] } });
  });
});

describe('activity feed', () => {
  it('lists new orders, low stock, webhook and backup results with a per-user read mark', async () => {
    await recordBackupResult(db(), shopId, { ok: false, error: 'disk full' });
    // low stock: an order that leaves 5 or fewer units
    const [item] = await db().select().from(s.inventoryItems).where(eq(s.inventoryItems.variantId, sku['CPD-SL']!));
    await db().update(s.inventoryLevels).set({ available: 6, onHand: 6 }).where(eq(s.inventoryLevels.inventoryItemId, item!.id));
    const { token } = await startCheckout('CPD-SL', 1);
    await refresh(token, ADDRESS);
    await complete(token);
    await t.app.ctx.queue.idle();
    await new Promise((r) => setTimeout(r, 800));
    await t.app.ctx.queue.idle();

    const feed = await g(`{ shopmeActivityFeed(first: 50) { unreadCount items { kind title body link read ok } } }`);
    const kinds = new Set(feed.shopmeActivityFeed.items.map((i: any) => i.kind));
    expect(kinds).toEqual(new Set(['order', 'low_stock', 'backup']));
    expect(feed.shopmeActivityFeed.unreadCount).toBe(feed.shopmeActivityFeed.items.length);
    expect(feed.shopmeActivityFeed.items.find((i: any) => i.kind === 'backup')).toMatchObject({ ok: false, body: 'disk full' });
    expect(feed.shopmeActivityFeed.items.find((i: any) => i.kind === 'order').link).toMatch(/^\/orders\/\d+$/);

    await g(`mutation { shopmeActivityMarkAllRead { unreadCount } }`);
    const after = await g(`{ shopmeActivityFeed { unreadCount items { read } } }`);
    expect(after.shopmeActivityFeed.unreadCount).toBe(0);
    expect(after.shopmeActivityFeed.items.every((i: any) => i.read)).toBe(true);
  });
});
