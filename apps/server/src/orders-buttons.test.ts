import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { addressProblems, createLocalStorage, getPrimaryShop, schema as s, scoreRisk, seedDemo, type Mail } from '@shopme/core';
import { createTestApp, SETUP_BODY, type TestApp } from './test-utils';
import { makeGql, makeGqlOk } from '../test/conformance/helpers';

const ADDRESS = { email: 'Buyer@Example.com', firstName: 'Ada', lastName: 'Lovelace', address1: '1 Rue de Rivoli', city: 'Paris', zip: '75001', countryCode: 'FR', phone: '' };
let t: TestApp;
let g: ReturnType<typeof makeGqlOk>;
let gql: ReturnType<typeof makeGql>;
let cookie: string;
let shopId: number;
let sent: Mail[];
const sku: Record<string, number> = {};

beforeAll(async () => {
  t = await createTestApp();
  const setup = await t.app.inject({ method: 'POST', url: '/admin/api/setup', payload: SETUP_BODY });
  cookie = setup.cookies.find((c) => c.name === 'shopme_session')!.value;
  gql = makeGql(t.app, cookie);
  g = makeGqlOk(gql);
  await seedDemo(t.dbHandle.db, createLocalStorage(mkdtempSync(path.join(tmpdir(), 'ob-'))));
  shopId = (await getPrimaryShop(t.dbHandle.db))!.id;
  for (const v of await t.dbHandle.db.select().from(s.productVariants)) if (v.sku) sku[v.sku] = v.id;
  sent = [];
  t.app.ctx.mailer = { send: async (m) => { sent.push(m); } };
}, 90_000);
afterAll(async () => { await t.close(); });

const db = () => t.dbHandle.db;
const gid = (type: string, id: number) => `gid://shopify/${type}/${id}`;

async function startCheckout(variant: string, quantity: number, headers: Record<string, string> = {}, cookies: Record<string, string> = {}) {
  const add = await t.app.inject({ method: 'POST', url: '/cart/add.js', payload: { id: sku[variant], quantity } });
  const cart = add.cookies.find((c) => c.name === 'cart')!.value;
  const go = await t.app.inject({ method: 'POST', url: '/checkout', cookies: { cart, ...cookies }, headers });
  return { cart, token: go.headers.location!.toString().split('/').pop()!, cookies: { cart, ...cookies } };
}
const refresh = (token: string, body: Record<string, unknown>) => t.app.inject({ method: 'POST', url: `/checkouts/${token}/refresh`, payload: body });
const complete = (token: string, method: string, cookies: Record<string, string> = {}) => t.app.inject({
  method: 'POST', url: `/checkouts/${token}/complete`, payload: new URLSearchParams({ ...ADDRESS, paymentMethod: method }).toString(), headers: { 'content-type': 'application/x-www-form-urlencoded' }, cookies,
});
const orderOf = async (token: string) => (await db().select().from(s.orders).where(eq(s.orders.cartToken, token)))[0]!;
async function newOrder(variant: string, quantity: number, cookies: Record<string, string> = {}) {
  const { token } = await startCheckout(variant, quantity, {}, cookies);
  await refresh(token, ADDRESS);
  const done = await complete(token, 'bank_transfer', cookies);
  expect(done.statusCode).toBe(303);
  return orderOf(token);
}

describe('address checks and risk', () => {
  it('flags missing and malformed address parts', () => {
    expect(addressProblems({ firstName: 'A', lastName: 'B', address1: '1 Rue X', city: 'Paris', zip: '75001', countryCode: 'FR', phone: '' })).toEqual([]);
    expect(addressProblems({ firstName: 'A', lastName: 'B', address1: '1 Rue X', city: 'Paris', zip: '7500', countryCode: 'FR', phone: '' })).toEqual(['ZIP_INVALID']);
    expect(addressProblems({ firstName: '', lastName: '', address1: '', city: '', zip: '', countryCode: '', phone: '12' })).toEqual(['NAME_MISSING', 'ADDRESS1_MISSING', 'CITY_MISSING', 'COUNTRY_MISSING', 'ZIP_MISSING', 'PHONE_INVALID']);
    expect(addressProblems(null)).toEqual(['MISSING_ADDRESS']);
    expect(addressProblems(null, false)).toEqual([]);
  });

  it('scores risk from our own signals', () => {
    const calm = scoreRisk({ email: 'a@b.com', billingCountry: 'FR', shippingCountry: 'FR', total: 5000, averageTotal: 5000, ordersLastDay: 1, addressProblems: 0, failedPayments: 0, previousFraud: 0, previousOrders: 2 });
    expect(calm).toMatchObject({ level: 'LOW', score: 0 });
    const bad = scoreRisk({ email: 'x@mailinator.com', billingCountry: 'US', shippingCountry: 'FR', total: 90000, averageTotal: 5000, ordersLastDay: 4, addressProblems: 1, failedPayments: 1, previousFraud: 0, previousOrders: 0 });
    expect(bad.level).toBe('HIGH');
    expect(bad.signals.map((x) => x.code)).toEqual(expect.arrayContaining(['BILLING_COUNTRY_DIFFERS', 'HIGH_VALUE', 'REPEATED_ORDERS', 'DISPOSABLE_EMAIL']));
  });

  it('exposes address problems, risk, delivery columns and the conversion summary on the order', async () => {
    const order = await newOrder('HEB-250', 1);
    await db().insert(s.visits).values([
      { shopId, sessionId: 'sess-conv-0001-abcdef', path: '/products/x', referrer: 'news.example.org', utmSource: 'newsletter', utmMedium: 'email', utmCampaign: 'spring' },
      { shopId, sessionId: 'sess-conv-0001-abcdef', path: '/cart' },
    ]);
    await db().update(s.orders).set({ visitSessionId: 'sess-conv-0001-abcdef' }).where(eq(s.orders.id, order.id));
    const r = await g(`query($id: ID!) { order(id: $id) { shopmeAddressProblems shopmeRisk { level score signals { code } } shopmeDeliveryStatus shopmeDeliveryMethod shopmeLocation { name } shopmeConversion { visits landingPath referrer utmSource utmCampaign } test } }`, { id: gid('Order', order.id) });
    expect(r.order.shopmeAddressProblems).toEqual([]);
    expect(r.order.shopmeRisk.level).toBe('LOW');
    expect(r.order.shopmeDeliveryStatus).toBe('NOT_FULFILLED');
    expect(r.order.shopmeConversion).toMatchObject({ visits: 2, landingPath: '/products/x', referrer: 'news.example.org', utmSource: 'newsletter', utmCampaign: 'spring' });
    expect(r.order.shopmeLocation.name).toBeTruthy();
  });

  it('keeps the visit session of the buyer on the order and tags from the query string', async () => {
    const home = await t.app.inject({ method: 'GET', url: '/?utm_source=ads&utm_medium=cpc&utm_campaign=launch' });
    const vid = home.cookies.find((c) => c.name === 'shopme_vid')?.value;
    if (!vid) return; // analytics not allowed in this environment
    const end = Date.now() + 3000;
    let row;
    while (!(row = (await db().select().from(s.visits).where(eq(s.visits.sessionId, vid)))[0]) && Date.now() < end) await new Promise((r) => setTimeout(r, 50));
    expect(row).toMatchObject({ utmSource: 'ads', utmMedium: 'cpc', utmCampaign: 'launch' });
    const order = await newOrder('HEB-250', 1, { shopme_vid: vid });
    expect(order.visitSessionId).toBe(vid);
  });
});

describe('bulk mark as, delivery and capture', () => {
  it('moves orders through the fulfilment states', async () => {
    const a = await newOrder('HEB-250', 1);
    const b = await newOrder('HEB-250', 1);
    const ids = [gid('Order', a.id), gid('Order', b.id)];
    const mark = (status: string) => g(`mutation($ids: [ID!]!, $s: ShopmeOrderMarkAs!) { shopmeOrdersMarkAs(ids: $ids, status: $s) { succeeded results { ok message } userErrors { message } } }`, { ids, s: status }).then((d) => d.shopmeOrdersMarkAs);
    const status = async (o: number) => (await g(`query($id: ID!) { order(id: $id) { displayFulfillmentStatus shopmeDeliveryStatus } }`, { id: gid('Order', o) })).order;

    expect((await mark('IN_PROGRESS')).succeeded).toBe(2);
    expect((await status(a.id)).displayFulfillmentStatus).toBe('IN_PROGRESS');
    expect((await g(`{ ordersCount(query: "fulfillment_status:in_progress") { count } }`)).ordersCount.count).toBeGreaterThanOrEqual(2);

    expect((await mark('ON_HOLD')).succeeded).toBe(2);
    expect((await status(a.id)).displayFulfillmentStatus).toBe('ON_HOLD');

    expect((await mark('FULFILLED')).succeeded).toBe(2);
    expect(await status(a.id)).toMatchObject({ displayFulfillmentStatus: 'FULFILLED', shopmeDeliveryStatus: 'IN_TRANSIT' });
    expect((await g(`{ ordersCount(query: "delivery_status:in_transit") { count } }`)).ordersCount.count).toBeGreaterThanOrEqual(2);

    expect((await mark('DELIVERED')).succeeded).toBe(2);
    expect((await status(a.id)).shopmeDeliveryStatus).toBe('DELIVERED');
    expect((await g(`{ ordersCount(query: "delivery_status:delivered") { count } }`)).ordersCount.count).toBeGreaterThanOrEqual(2);

    expect((await mark('UNFULFILLED')).succeeded).toBe(2);
    expect(await status(a.id)).toMatchObject({ displayFulfillmentStatus: 'UNFULFILLED', shopmeDeliveryStatus: 'NOT_FULFILLED' });

    const missing = await g(`mutation { shopmeOrdersMarkAs(ids: ["gid://shopify/Order/999999"], status: FULFILLED) { succeeded results { ok message } } }`);
    expect(missing.shopmeOrdersMarkAs).toMatchObject({ succeeded: 0, results: [{ ok: false }] });
  });

  it('captures authorised payments in bulk and shows them as capturable', async () => {
    const order = await newOrder('HEB-250', 1);
    await db().update(s.orders).set({ financialStatus: 'AUTHORIZED' }).where(eq(s.orders.id, order.id));
    await db().insert(s.transactions).values({ shopId, orderId: order.id, kind: 'AUTHORIZATION', status: 'SUCCESS', gateway: 'stripe', amount: order.total, currency: order.currency, processedAt: new Date() });
    const before = await g(`query($id: ID!) { order(id: $id) { capturable totalCapturableSet { shopMoney { amount } } } }`, { id: gid('Order', order.id) });
    expect(before.order.capturable).toBe(true);
    const r = await g(`mutation($ids: [ID!]!) { shopmeOrdersCapture(ids: $ids) { succeeded results { ok message } } }`, { ids: [gid('Order', order.id)] });
    expect(r.shopmeOrdersCapture.succeeded).toBe(1);
    const after = await g(`query($id: ID!) { order(id: $id) { capturable displayFinancialStatus } }`, { id: gid('Order', order.id) });
    expect(after.order).toEqual({ capturable: false, displayFinancialStatus: 'PAID' });
    const again = await g(`mutation($ids: [ID!]!) { shopmeOrdersCapture(ids: $ids) { succeeded results { ok message } } }`, { ids: [gid('Order', order.id)] });
    expect(again.shopmeOrdersCapture.results[0]).toMatchObject({ ok: false });
  });
});

describe('batches', () => {
  it('creates, moves, filters and deletes batches', async () => {
    const a = await newOrder('HEB-250', 1);
    const b = await newOrder('HEB-250', 1);
    const created = await g(`mutation($ids: [ID!]!) { shopmeOrderBatchCreate(name: "Morning pick", orderIds: $ids) { batch { id name orderCount } userErrors { message } } }`, { ids: [gid('Order', a.id)] });
    const batch = created.shopmeOrderBatchCreate.batch;
    expect(batch).toMatchObject({ name: 'Morning pick', orderCount: 1 });
    const move = await g(`mutation($b: ID, $ids: [ID!]!) { shopmeOrdersMoveToBatch(batchId: $b, orderIds: $ids) { moved userErrors { message } } }`, { b: batch.id, ids: [gid('Order', b.id)] });
    expect(move.shopmeOrdersMoveToBatch.moved).toBe(1);
    const list = await g(`{ shopmeOrderBatches { id name orderCount } orders(first: 10, query: "batch_id:${batch.id.split('/').pop()}") { nodes { id shopmeBatch { name } } } }`);
    expect(list.shopmeOrderBatches.find((x: { id: string }) => x.id === batch.id).orderCount).toBe(2);
    expect(list.orders.nodes).toHaveLength(2);
    expect(list.orders.nodes[0].shopmeBatch.name).toBe('Morning pick');
    expect((await gql(`mutation { shopmeOrdersMoveToBatch(batchId: "gid://shopify/ShopmeOrderBatch/99999", orderIds: []) { userErrors { message } } }`)).data.shopmeOrdersMoveToBatch.userErrors[0].message).toMatch(/does not exist/);
    expect((await g(`mutation($b: ID, $ids: [ID!]!) { shopmeOrdersMoveToBatch(batchId: $b, orderIds: $ids) { moved } }`, { b: null, ids: [gid('Order', b.id)] })).shopmeOrdersMoveToBatch.moved).toBe(1);
    const del = await g(`mutation($id: ID!) { shopmeOrderBatchDelete(id: $id) { deletedId userErrors { message } } }`, { id: batch.id });
    expect(del.shopmeOrderBatchDelete.deletedId).toBe(batch.id);
    expect((await db().select().from(s.orders).where(eq(s.orders.id, a.id)))[0]!.batchId).toBeNull();
  });
});

describe('shipping labels', () => {
  it('records a label, fulfils the order with its tracking and lists it', async () => {
    const order = await newOrder('HEB-250', 1);
    const oid = gid('Order', order.id);
    const awaiting = await g(`{ shopmeOrdersAwaitingLabel { id } }`);
    expect(awaiting.shopmeOrdersAwaitingLabel.map((o: { id: string }) => o.id)).toContain(oid);
    const bad = await g(`mutation($i: ShopmeShippingLabelInput!) { shopmeShippingLabelCreate(input: $i) { label { id } userErrors { message } } }`, { i: { orderId: oid, carrier: '  ' } });
    expect(bad.shopmeShippingLabelCreate.userErrors[0].message).toMatch(/blank/);
    const r = await g(`mutation($i: ShopmeShippingLabelInput!) { shopmeShippingLabelCreate(input: $i) { label { id carrier trackingNumber cost status orderName } userErrors { message } } }`, { i: { orderId: oid, carrier: 'La Poste', service: 'Colissimo', trackingNumber: '6A123', trackingUrl: 'https://track.example/6A123', cost: '4.2' } });
    const label = r.shopmeShippingLabelCreate.label;
    expect(label).toMatchObject({ carrier: 'La Poste', trackingNumber: '6A123', cost: '4.2', status: 'ACTIVE', orderName: order.name });
    const o = await g(`query($id: ID!) { order(id: $id) { displayFulfillmentStatus fulfillments { trackingInfo { company number url } } } }`, { id: oid });
    expect(o.order.displayFulfillmentStatus).toBe('FULFILLED');
    expect(o.order.fulfillments[0].trackingInfo[0]).toMatchObject({ company: 'La Poste', number: '6A123' });
    expect((await g(`{ shopmeShippingLabels(status: "ACTIVE") { id } shopmeShippingLabelsCount(status: "ACTIVE") { count } }`)).shopmeShippingLabelsCount.count).toBeGreaterThanOrEqual(1);
    const voided = await g(`mutation($id: ID!) { shopmeShippingLabelVoid(id: $id) { label { status } userErrors { message } } }`, { id: label.id });
    expect(voided.shopmeShippingLabelVoid.label.status).toBe('VOIDED');
    expect((await g(`mutation($id: ID!) { shopmeShippingLabelVoid(id: $id) { userErrors { message } } }`, { id: label.id })).shopmeShippingLabelVoid.userErrors).toHaveLength(1);
  });
});

describe('timeline: attachments and emails', () => {
  it('keeps attachments on a comment and the rendered email on the event', async () => {
    const order = await newOrder('HEB-250', 1);
    const oid = gid('Order', order.id);
    const posted = await g(`mutation($id: ID!) { orderTimelineCommentCreate(id: $id, message: "", attachments: ["/files/a.pdf"]) { event { ... on CommentEvent { attachments rawMessage } } userErrors { message } } }`, { id: oid });
    expect(posted.orderTimelineCommentCreate.event.attachments).toEqual(['/files/a.pdf']);
    const bad = await g(`mutation($id: ID!) { orderTimelineCommentCreate(id: $id, message: "x", attachments: ["javascript:alert(1)"]) { event { id } userErrors { message } } }`, { id: oid });
    expect(bad.orderTimelineCommentCreate.userErrors[0].message).toMatch(/file link/);
    const end = Date.now() + 6000;
    for (;;) {
      const ev = (await db().select().from(s.events).where(eq(s.events.subjectId, order.id))).find((e) => e.verb === 'order.email_sent');
      if (ev) { expect((ev.data as { html?: string; subject?: string }).html).toContain('<'); expect((ev.data as { subject?: string }).subject).toBeTruthy(); break; }
      if (Date.now() > end) throw new Error('no email event');
      await new Promise((r) => setTimeout(r, 50));
    }
    const read = await g(`query($id: ID!) { order(id: $id) { events(first: 50) { nodes { ... on BasicEvent { action arguments shopmeEmailHtml } } } } }`, { id: oid });
    const mail = read.order.events.nodes.find((e: { action: string }) => e.action === 'order.email_sent');
    expect(mail.shopmeEmailHtml).toContain('<');
    expect(mail.arguments.html).toBeUndefined();
  });
});

describe('order edit: custom item, order discount, shipping fee', () => {
  it('prices and commits them', async () => {
    const order = await newOrder('HEB-250', 1);
    const oid = gid('Order', order.id);
    const begin = await g(`mutation($id: ID!) { orderEditBegin(id: $id) { calculatedOrder { id } userErrors { message } } }`, { id: oid });
    const id = begin.orderEditBegin.calculatedOrder.id;
    const item = await g(`mutation($id: ID!) { orderEditAddCustomItem(id: $id, title: "Gift wrap", price: { amount: "5.00", currencyCode: EUR }, quantity: 2, taxable: false) { calculatedLineItem { id title quantity } calculatedOrder { totalPriceSet { shopMoney { amount } } } userErrors { message } } }`, { id });
    expect(item.orderEditAddCustomItem.userErrors).toEqual([]);
    expect(item.orderEditAddCustomItem.calculatedLineItem).toMatchObject({ title: 'Gift wrap', quantity: 2 });
    const totalBefore = Number(item.orderEditAddCustomItem.calculatedOrder.totalPriceSet.shopMoney.amount);
    const fee = await g(`mutation($id: ID!) { orderEditAddShippingLine(id: $id, shippingLine: { title: "Express", price: { amount: "3.00", currencyCode: EUR } }) { calculatedOrder { totalPriceSet { shopMoney { amount } } shopmeShippingFeeSet { shopMoney { amount } } } userErrors { message } } }`, { id });
    expect(fee.orderEditAddShippingLine.calculatedOrder.shopmeShippingFeeSet.shopMoney.amount).toBe('3.0');
    expect(Number(fee.orderEditAddShippingLine.calculatedOrder.totalPriceSet.shopMoney.amount)).toBeCloseTo(totalBefore + 3, 2);
    const disc = await g(`mutation($id: ID!) { shopmeOrderEditSetOrderDiscount(id: $id, discount: { percentValue: 10, description: "Goodwill" }) { calculatedOrder { totalPriceSet { shopMoney { amount } } shopmeOrderDiscountSet { shopMoney { amount } } } userErrors { message } } }`, { id });
    expect(disc.shopmeOrderEditSetOrderDiscount.userErrors).toEqual([]);
    const discounted = Number(disc.shopmeOrderEditSetOrderDiscount.calculatedOrder.shopmeOrderDiscountSet.shopMoney.amount);
    expect(discounted).toBeGreaterThan(0);
    const calcTotal = Number(disc.shopmeOrderEditSetOrderDiscount.calculatedOrder.totalPriceSet.shopMoney.amount);
    const commit = await g(`mutation($id: ID!) { orderEditCommit(id: $id) { order { id totalPriceSet { shopMoney { amount } } totalShippingPriceSet { shopMoney { amount } } lineItems(first: 10) { nodes { title quantity } } shippingLines(first: 5) { nodes { title } } } userErrors { message } } }`, { id });
    expect(commit.orderEditCommit.userErrors).toEqual([]);
    const o = commit.orderEditCommit.order;
    expect(Number(o.totalPriceSet.shopMoney.amount)).toBeCloseTo(calcTotal, 2);
    expect(o.lineItems.nodes.map((l: { title: string }) => l.title)).toContain('Gift wrap');
    expect(o.shippingLines.nodes.map((x: { title: string }) => x.title)).toContain('Express');
    const clear = await g(`mutation($id: ID!) { orderEditBegin(id: $id) { calculatedOrder { id } } }`, { id: oid });
    const cleared = await g(`mutation($id: ID!) { shopmeOrderEditSetOrderDiscount(id: $id) { calculatedOrder { shopmeOrderDiscountSet { shopMoney { amount } } } userErrors { message } } }`, { id: clear.orderEditBegin.calculatedOrder.id });
    expect(cleared.shopmeOrderEditSetOrderDiscount.calculatedOrder.shopmeOrderDiscountSet.shopMoney.amount).toBe('0.0');
  });
});

describe('stats strip, drafts and marketing', () => {
  it('computes the stats strip with series and a previous period', async () => {
    await newOrder('HEB-250', 2);
    const from = new Date(Date.now() - 86_400_000).toISOString();
    const to = new Date(Date.now() + 3_600_000).toISOString();
    const r = await g(`query($f: DateTime!, $t: DateTime!) { shopmeOrdersStats(from: $f, to: $t) { currencyCode buckets metrics { key value previous series } } }`, { f: from, t: to });
    const m = Object.fromEntries(r.shopmeOrdersStats.metrics.map((x: { key: string }) => [x.key, x]));
    expect(Object.keys(m).sort()).toEqual(['delivered', 'fulfilled', 'fulfillmentHours', 'items', 'orders', 'returns', 'sales']);
    expect(m.orders.value).toBeGreaterThan(0);
    expect(m.sales.value).toBeGreaterThan(0);
    expect(m.orders.series).toHaveLength(r.shopmeOrdersStats.buckets.length);
    expect(m.orders.series.reduce((a: number, b: number) => a + b, 0)).toBe(m.orders.value);
    const bad = await gql(`query { shopmeOrdersStats(from: "2026-02-02T00:00:00Z", to: "2026-02-01T00:00:00Z") { currencyCode } }`);
    expect(bad.errors?.[0]?.message).toMatch(/after/);
  });

  it('filters orders by location and keeps PO number and market on drafts', async () => {
    const loc = (await db().select().from(s.locations))[0]!;
    const byLoc = await g(`query($q: String) { orders(first: 5, query: $q) { nodes { id } } }`, { q: `location_id:${loc.id}` });
    expect(byLoc.orders.nodes.length).toBeGreaterThan(0);
    const none = await g(`query($q: String) { orders(first: 5, query: $q) { nodes { id } } }`, { q: 'location_id:999999' });
    expect(none.orders.nodes).toHaveLength(0);

    const market = (await db().select().from(s.markets))[0]!;
    const d = await g(`mutation($i: DraftOrderInput!) { draftOrderCreate(input: $i) { draftOrder { id poNumber shopmeMarket { name } presentmentCurrencyCode } userErrors { message } } }`, {
      i: { email: 'po@example.com', poNumber: 'PO-7', shopmeMarketId: gid('Market', market.id), lineItems: [{ title: 'Custom', quantity: 1, originalUnitPrice: '10.00' }] },
    });
    expect(d.draftOrderCreate.userErrors).toEqual([]);
    expect(d.draftOrderCreate.draftOrder).toMatchObject({ poNumber: 'PO-7', shopmeMarket: { name: market.name } });
    const bad = await g(`mutation($i: DraftOrderInput!) { draftOrderCreate(input: $i) { userErrors { message } } }`, { i: { shopmeMarketId: gid('Market', 987654), lineItems: [{ title: 'C', quantity: 1, originalUnitPrice: '1.00' }] } });
    expect(bad.draftOrderCreate.userErrors[0].message).toMatch(/Market/);
    const done = await g(`mutation($id: ID!) { draftOrderComplete(id: $id) { draftOrder { order { poNumber } } userErrors { message } } }`, { id: d.draftOrderCreate.draftOrder.id });
    expect(done.draftOrderComplete.draftOrder.order.poNumber).toBe('PO-7');
    const find = await g(`{ draftOrders(first: 5, query: "po_number:PO-7") { nodes { id } } }`);
    expect(find.draftOrders.nodes.length).toBe(1);
  });

  it('manages campaigns and reports attribution', async () => {
    const created = await g(`mutation { shopmeMarketingCampaignCreate(input: { name: "Spring mail", channel: "email", utmSource: "newsletter", utmCampaign: "spring", budget: "50.00" }) { campaign { id name budget orders } userErrors { message } } }`);
    const c = created.shopmeMarketingCampaignCreate.campaign;
    expect(c).toMatchObject({ name: 'Spring mail', budget: '50.0' });
    const blank = await g(`mutation { shopmeMarketingCampaignCreate(input: { name: " " }) { userErrors { message } } }`);
    expect(blank.shopmeMarketingCampaignCreate.userErrors[0].message).toMatch(/blank/);
    const list = await g(`{ shopmeMarketingCampaigns { id name orders sales } shopmeAttribution(from: "2020-01-01T00:00:00Z", to: "2100-01-01T00:00:00Z") { totalOrders attributedOrders rows { source medium campaign orders } } }`);
    const mine = list.shopmeMarketingCampaigns.find((x: { id: string }) => x.id === c.id);
    expect(mine.orders).toBeGreaterThanOrEqual(1); // the order with the newsletter / spring visit above
    expect(list.shopmeAttribution.rows.find((r: { source: string }) => r.source === 'newsletter')).toMatchObject({ campaign: 'spring', medium: 'email' });
    const upd = await g(`mutation($id: ID!) { shopmeMarketingCampaignUpdate(id: $id, input: { status: "ENDED" }) { campaign { status } userErrors { message } } }`, { id: c.id });
    expect(upd.shopmeMarketingCampaignUpdate.campaign.status).toBe('ENDED');
    const del = await g(`mutation($id: ID!) { shopmeMarketingCampaignDelete(id: $id) { deletedId } }`, { id: c.id });
    expect(del.shopmeMarketingCampaignDelete.deletedId).toBe(c.id);
  });

  it('lists the sales channels and toggles the online store catalog', async () => {
    const list = await g(`{ shopmeSalesChannels { handle kind products publishedProducts orders } }`);
    expect(list.shopmeSalesChannels.map((c: { handle: string }) => c.handle)).toEqual(['online-store', 'draft-orders', 'manual']);
    const off = await g(`mutation { shopmeSalesChannelPublishAll(handle: "online-store", publish: false) { changed userErrors { message } } }`);
    expect(off.shopmeSalesChannelPublishAll.changed).toBeGreaterThan(0);
    expect((await g(`{ shopmeSalesChannels { handle publishedProducts } }`)).shopmeSalesChannels[0].publishedProducts).toBe(0);
    const on = await g(`mutation { shopmeSalesChannelPublishAll(handle: "online-store", publish: true) { changed } }`);
    expect(on.shopmeSalesChannelPublishAll.changed).toBeGreaterThan(0);
    expect((await g(`mutation { shopmeSalesChannelPublishAll(handle: "manual", publish: true) { userErrors { message } } }`)).shopmeSalesChannelPublishAll.userErrors).toHaveLength(1);
  });
});
