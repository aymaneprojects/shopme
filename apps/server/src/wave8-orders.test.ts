import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { createLocalStorage, getPrimaryShop, schema as s, seedDemo, type Mail } from '@shopme/core';
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
  await seedDemo(t.dbHandle.db, createLocalStorage(mkdtempSync(path.join(tmpdir(), 'w8-'))));
  shopId = (await getPrimaryShop(t.dbHandle.db))!.id;
  for (const v of await t.dbHandle.db.select().from(s.productVariants)) if (v.sku) sku[v.sku] = v.id;
  sent = [];
  t.app.ctx.mailer = { send: async (m) => { sent.push(m); } };
}, 90_000);
afterAll(async () => { await t.close(); });

const db = () => t.dbHandle.db;
const gid = (type: string, id: number) => `gid://shopify/${type}/${id}`;

async function startCheckout(variant: string, quantity: number) {
  const add = await t.app.inject({ method: 'POST', url: '/cart/add.js', payload: { id: sku[variant], quantity } });
  const cart = add.cookies.find((c) => c.name === 'cart')!.value;
  const go = await t.app.inject({ method: 'POST', url: '/checkout', cookies: { cart } });
  return { cart, token: go.headers.location!.toString().split('/').pop()! };
}
const refresh = (token: string, body: Record<string, unknown>) => t.app.inject({ method: 'POST', url: `/checkouts/${token}/refresh`, payload: body });
const complete = (token: string, method: string) => t.app.inject({
  method: 'POST', url: `/checkouts/${token}/complete`, payload: new URLSearchParams({ ...ADDRESS, paymentMethod: method }).toString(), headers: { 'content-type': 'application/x-www-form-urlencoded' },
});
const orderOf = async (token: string) => (await db().select().from(s.orders).where(eq(s.orders.cartToken, token)))[0]!;
async function newOrder(variant: string, quantity: number, giftCode?: string, method = giftCode ? '' : 'bank_transfer') {
  const { token } = await startCheckout(variant, quantity);
  await refresh(token, giftCode ? { ...ADDRESS, addGiftCardCode: giftCode } : ADDRESS);
  const done = await complete(token, method);
  expect(done.statusCode).toBe(303);
  return orderOf(token);
}
const mkCard = async (code: string, value: number) => (await db().insert(s.giftCards).values({ shopId, code, token: `tok-${code}`, currency: 'EUR', initialValue: value, balance: value }).returning())[0]!;

describe('timeline comments', () => {
  it('posts, lists and deletes comments on orders and customers (author only)', async () => {
    const order = await newOrder('HEB-250', 1);
    const oid = gid('Order', order.id);
    const posted = await g(`mutation($id: ID!) { orderTimelineCommentCreate(id: $id, message: "  Call the buyer  ") { event { __typename ... on CommentEvent { id rawMessage canDelete author { name } } } userErrors { message } } }`, { id: oid });
    expect(posted.orderTimelineCommentCreate.event).toMatchObject({ __typename: 'CommentEvent', rawMessage: 'Call the buyer', canDelete: true });
    const blank = await g(`mutation($id: ID!) { orderTimelineCommentCreate(id: $id, message: "   ") { event { id } userErrors { message } } }`, { id: oid });
    expect(blank.orderTimelineCommentCreate.userErrors[0].message).toMatch(/blank/);

    const read = await g(`query($id: ID!) { order(id: $id) { hasTimelineComment events(first: 50) { nodes { __typename action message ... on CommentEvent { id canDelete } } } } }`, { id: oid });
    expect(read.order.hasTimelineComment).toBe(true);
    const actions = read.order.events.nodes.map((e: { action: string }) => e.action);
    expect(actions).toContain('order.created');
    expect(actions).toContain('order.comment');

    const cid = posted.orderTimelineCommentCreate.event.id;
    const del = await g(`mutation($id: ID!) { timelineCommentDelete(id: $id) { deletedCommentId userErrors { message } } }`, { id: cid });
    expect(del.timelineCommentDelete).toEqual({ deletedCommentId: cid, userErrors: [] });
    const again = await g(`mutation($id: ID!) { timelineCommentDelete(id: $id) { deletedCommentId userErrors { message } } }`, { id: cid });
    expect(again.timelineCommentDelete.deletedCommentId).toBeNull();

    // another staff member cannot delete someone else's comment, and system events are not comments
    const [other] = await db().insert(s.staffUsers).values({ shopId, email: 'other@example.com', passwordHash: 'x', role: 'staff' } as never).returning();
    const ev = await db().insert(s.events).values({ shopId, subjectType: 'order', subjectId: order.id, kind: 'comment', verb: 'order.comment', message: 'Mine', authorStaffUserId: other!.id }).returning();
    const notMine = await g(`mutation($id: ID!) { timelineCommentDelete(id: $id) { deletedCommentId userErrors { message } } }`, { id: gid('CommentEvent', ev[0]!.id) });
    expect(notMine.timelineCommentDelete.userErrors[0].message).toMatch(/author/);
    const sys = (await db().select().from(s.events).where(eq(s.events.subjectId, order.id))).find((e) => e.kind === 'system')!;
    expect((await g(`mutation($id: ID!) { timelineCommentDelete(id: $id) { userErrors { message } } }`, { id: gid('CommentEvent', sys.id) })).timelineCommentDelete.userErrors).toHaveLength(1);

    // customer timeline: creation and order events come with the checkout
    const cust = (await db().select().from(s.customers).where(eq(s.customers.id, order.customerId!)))[0]!;
    const cgid = gid('Customer', cust.id);
    const cc = await g(`mutation($id: ID!) { customerTimelineCommentCreate(id: $id, message: "VIP") { event { ... on CommentEvent { rawMessage canDelete } } userErrors { message } } }`, { id: cgid });
    expect(cc.customerTimelineCommentCreate.event).toMatchObject({ rawMessage: 'VIP', canDelete: true });
    const cr = await g(`query($id: ID!) { customer(id: $id) { hasTimelineComment events(first: 20) { nodes { action message } } } }`, { id: cgid });
    expect(cr.customer.hasTimelineComment).toBe(true);
    expect(cr.customer.events.nodes.map((e: { action: string }) => e.action)).toEqual(expect.arrayContaining(['customer.order_placed', 'customer.comment']));
  });

  it('records the order confirmation email on the timeline', async () => {
    const order = await newOrder('HEB-250', 1);
    const end = Date.now() + 6000;
    for (;;) {
      const evs = await db().select().from(s.events).where(eq(s.events.subjectId, order.id));
      if (evs.some((e) => e.verb === 'order.email_sent')) break;
      if (Date.now() > end) throw new Error('no email event');
      await new Promise((r) => setTimeout(r, 50));
    }
  });
});

describe('fulfillments: tracking, cancel and holds', () => {
  it('cancels a fulfillment: items go back to unfulfilled and stock is committed again', async () => {
    const order = await newOrder('HEB-250', 2);
    const oid = gid('Order', order.id);
    const lineOf = async () => (await db().select().from(s.orderLines).where(eq(s.orderLines.orderId, order.id)))[0]!;
    const made = await g(`mutation($f: FulfillmentInput!) { fulfillmentCreate(fulfillment: $f) { fulfillment { id status } userErrors { message } } }`, { f: { orderId: oid, trackingInfo: { company: 'DHL', number: 'X1' } } });
    const fid = made.fulfillmentCreate.fulfillment.id;
    expect((await lineOf()).fulfilledQuantity).toBe(2);
    expect((await g(`query($id: ID!) { order(id: $id) { displayFulfillmentStatus } }`, { id: oid })).order.displayFulfillmentStatus).toBe('FULFILLED');

    const upd = await g(`mutation($id: ID!) { fulfillmentTrackingInfoUpdate(fulfillmentId: $id, trackingInfoInput: { company: "UPS", number: "Z9", url: "https://t.example/Z9" }, notifyCustomer: true) { fulfillment { shopmeNotifyCustomer trackingInfo { company number url } } userErrors { message } } }`, { id: fid });
    expect(upd.fulfillmentTrackingInfoUpdate.fulfillment).toMatchObject({ shopmeNotifyCustomer: true, trackingInfo: [{ company: 'UPS', number: 'Z9', url: 'https://t.example/Z9' }] });

    const cancelled = await g(`mutation($id: ID!) { fulfillmentCancel(id: $id) { fulfillment { status } userErrors { message } } }`, { id: fid });
    expect(cancelled.fulfillmentCancel).toEqual({ fulfillment: { status: 'CANCELLED' }, userErrors: [] });
    expect((await lineOf()).fulfilledQuantity).toBe(0);
    expect((await g(`query($id: ID!) { order(id: $id) { displayFulfillmentStatus lineItems(first: 5) { nodes { unfulfilledQuantity } } } }`, { id: oid })).order).toMatchObject({ displayFulfillmentStatus: 'UNFULFILLED', lineItems: { nodes: [{ unfulfilledQuantity: 2 }] } });
    expect((await g(`mutation($id: ID!) { fulfillmentCancel(id: $id) { userErrors { message } } }`, { id: fid })).fulfillmentCancel.userErrors).toHaveLength(1);
    expect((await g(`mutation($id: ID!) { fulfillmentTrackingInfoUpdate(fulfillmentId: $id, trackingInfoInput: { number: "A" }) { userErrors { message } } }`, { id: fid })).fulfillmentTrackingInfoUpdate.userErrors).toHaveLength(1);

    // the items can be fulfilled again
    const again = await g(`mutation($f: FulfillmentInput!) { fulfillmentCreate(fulfillment: $f) { fulfillment { status } userErrors { message } } }`, { f: { orderId: oid } });
    expect(again.fulfillmentCreate.userErrors).toEqual([]);
  });

  it('holds an order: it shows ON_HOLD and cannot be fulfilled until released', async () => {
    const order = await newOrder('HEB-250', 1);
    const oid = gid('Order', order.id);
    const held = await g(`mutation($id: ID!) { fulfillmentOrderHold(id: $id, fulfillmentHold: { reason: INVENTORY_OUT_OF_STOCK, reasonNotes: "Waiting for stock" }) { order { displayFulfillmentStatus shopmeFulfillmentHold { reason reasonNotes } } userErrors { message } } }`, { id: oid });
    expect(held.fulfillmentOrderHold).toEqual({ order: { displayFulfillmentStatus: 'ON_HOLD', shopmeFulfillmentHold: { reason: 'INVENTORY_OUT_OF_STOCK', reasonNotes: 'Waiting for stock' } }, userErrors: [] });
    expect((await g(`mutation($id: ID!) { fulfillmentOrderHold(id: $id, fulfillmentHold: { reason: OTHER }) { userErrors { message } } }`, { id: oid })).fulfillmentOrderHold.userErrors[0].message).toMatch(/already/);
    const blocked = await g(`mutation($f: FulfillmentInput!) { fulfillmentCreate(fulfillment: $f) { fulfillment { id } userErrors { message } } }`, { f: { orderId: oid } });
    expect(blocked.fulfillmentCreate.userErrors[0].message).toMatch(/on hold/);
    expect((await g(`query { orders(first: 5, query: "fulfillment_status:on_hold") { nodes { id } } }`)).orders.nodes.map((n: { id: string }) => n.id)).toContain(oid);

    const released = await g(`mutation($id: ID!) { fulfillmentOrderReleaseHold(id: $id) { order { displayFulfillmentStatus shopmeFulfillmentHold { reason } } userErrors { message } } }`, { id: oid });
    expect(released.fulfillmentOrderReleaseHold).toEqual({ order: { displayFulfillmentStatus: 'UNFULFILLED', shopmeFulfillmentHold: null }, userErrors: [] });
    const ok = await g(`mutation($f: FulfillmentInput!) { fulfillmentCreate(fulfillment: $f) { fulfillment { id } userErrors { message } } }`, { f: { orderId: oid } });
    expect(ok.fulfillmentCreate.userErrors).toEqual([]);
    const verbs = (await db().select().from(s.events).where(eq(s.events.subjectId, order.id))).map((e) => e.verb);
    expect(verbs).toEqual(expect.arrayContaining(['order.held', 'order.hold_released']));
  });
});

describe('billing address', () => {
  it('updates the billing address independently of the shipping address', async () => {
    const order = await newOrder('HEB-250', 1);
    const oid = gid('Order', order.id);
    const r = await g(`mutation($i: OrderInput!) { orderUpdate(input: $i) { order { billingAddress { address1 city countryCodeV2 } shippingAddress { address1 } } userErrors { message } } }`, {
      i: { id: oid, billingAddress: { firstName: 'Grace', address1: '9 Billing St', city: 'Lyon', zip: '69001', countryCode: 'FR' } },
    });
    expect(r.orderUpdate.order).toEqual({ billingAddress: { address1: '9 Billing St', city: 'Lyon', countryCodeV2: 'FR' }, shippingAddress: { address1: '1 Rue de Rivoli' } });
  });
});

describe('refunds restore gift cards', () => {
  const refundAll = (oid: string, lineId: string) => g(`mutation($i: RefundInput!) { refundCreate(input: $i) { refund { totalRefundedSet { shopMoney { amount } } transactions(first: 5) { nodes { gateway amountSet { shopMoney { amount } } } } } userErrors { message } } }`, {
    i: { orderId: oid, shipping: { fullRefund: true }, refundLineItems: [{ lineItemId: lineId, quantity: 1 }] },
  });

  it('a gift card that paid part of the order gets its share back, the rest goes to the gateway', async () => {
    const card = await mkCard('REFUND500', 500);
    const order = await newOrder('HEB-250', 1, 'refund500', 'bank_transfer');
    expect((await db().select().from(s.giftCards).where(eq(s.giftCards.id, card.id)))[0]!.balance).toBe(0);
    expect((await db().select().from(s.transactions).where(eq(s.transactions.orderId, order.id))).find((x) => x.gateway === 'gift_card')!.giftCardId).toBe(card.id);
    const oid = gid('Order', order.id);
    expect((await g(`mutation($i: OrderMarkAsPaidInput!) { orderMarkAsPaid(input: $i) { userErrors { message } } }`, { i: { id: oid } })).orderMarkAsPaid.userErrors).toEqual([]);
    const lineId = (await g(`query($id: ID!) { order(id: $id) { lineItems(first: 1) { nodes { id } } } }`, { id: oid })).order.lineItems.nodes[0].id;

    const r = await refundAll(oid, lineId);
    expect(r.refundCreate.userErrors).toEqual([]);
    const txs = r.refundCreate.refund.transactions.nodes;
    expect(txs.map((x: { gateway: string }) => x.gateway).sort()).toEqual(['gift_card', 'manual']);
    // the gateway share (order total minus the 5.00 gift card) is paid back first, the rest of the refund goes onto the card
    const cents = (gw: string) => Math.round(Number(txs.find((x: { gateway: string }) => x.gateway === gw).amountSet.shopMoney.amount) * 100);
    const refunded = Math.round(Number(r.refundCreate.refund.totalRefundedSet.shopMoney.amount) * 100);
    expect(cents('manual')).toBe(order.total - 500);
    expect(cents('gift_card')).toBe(refunded - (order.total - 500));
    expect((await db().select().from(s.giftCards).where(eq(s.giftCards.id, card.id)))[0]!.balance).toBe(cents('gift_card'));
    expect(await db().select().from(s.giftCardTransactions).where(eq(s.giftCardTransactions.giftCardId, card.id))).toEqual(expect.arrayContaining([expect.objectContaining({ amount: cents('gift_card'), orderId: order.id })]));
  });

  it('an order paid only with a gift card is refunded onto the card', async () => {
    const card = await mkCard('REFUNDALL2000', 20000);
    const order = await newOrder('JPG-50', 1, 'refundall2000');
    const used = 20000 - (await db().select().from(s.giftCards).where(eq(s.giftCards.id, card.id)))[0]!.balance;
    expect(used).toBe(order.total);
    const oid = gid('Order', order.id);
    const lineId = (await g(`query($id: ID!) { order(id: $id) { lineItems(first: 1) { nodes { id } } } }`, { id: oid })).order.lineItems.nodes[0].id;
    const r = await refundAll(oid, lineId);
    expect(r.refundCreate.userErrors).toEqual([]);
    expect(r.refundCreate.refund.transactions.nodes.map((x: { gateway: string }) => x.gateway)).toEqual(['gift_card']);
    const refunded = Math.round(Number(r.refundCreate.refund.totalRefundedSet.shopMoney.amount) * 100);
    expect(refunded).toBeGreaterThan(0);
    expect((await db().select().from(s.giftCards).where(eq(s.giftCards.id, card.id)))[0]!.balance).toBe(20000 - order.total + refunded);
  });
});

describe('exports and abandoned checkouts', () => {
  const download = async (url: string) => (await t.app.inject({ method: 'GET', url, cookies: { shopme_session: cookie } }));

  it('exports orders for a filter or a selection, and draft orders', async () => {
    const a = await newOrder('HEB-250', 1);
    const b = await newOrder('JPG-50', 1);
    const all = await download('/admin/api/export/orders.csv');
    expect(all.statusCode).toBe(200);
    expect(all.body).toContain(a.name);
    const picked = await download(`/admin/api/export/orders.csv?ids=${b.id}`);
    expect(picked.body).toContain(b.name);
    expect(picked.body.split('\r\n').filter((l) => l.startsWith(`${a.name},`))).toHaveLength(0);
    const byQuery = await download(`/admin/api/export/orders.csv?query=${encodeURIComponent(`name:${a.name.replace('#', '')}`)}`);
    expect(byQuery.body).toContain(a.name);
    expect(byQuery.body).not.toContain(`${b.name},`);

    const draft = await g(`mutation($i: DraftOrderInput!) { draftOrderCreate(input: $i) { draftOrder { name } userErrors { message } } }`, { i: { email: 'd@example.com', lineItems: [{ title: 'Custom', quantity: 2, originalUnitPrice: '10.00' }] } });
    expect(draft.draftOrderCreate.userErrors).toEqual([]);
    const csv = await download('/admin/api/export/draft_orders.csv');
    expect(csv.statusCode).toBe(200);
    expect(csv.headers['content-disposition']).toContain('draft-orders.csv');
    expect(csv.body.split('\r\n')[0]).toContain('Status');
    expect(csv.body).toContain(draft.draftOrderCreate.draftOrder.name);
    expect(csv.body).toContain('d@example.com');
    expect((await t.app.inject({ method: 'GET', url: '/admin/api/export/draft_orders.csv' })).statusCode).toBe(401);
  });

  it('filters abandoned checkouts by status: open and recovered', async () => {
    const { token } = await startCheckout('HEB-250', 1);
    await refresh(token, ADDRESS);
    const [cart] = await db().select().from(s.carts).where(eq(s.carts.token, token));
    await db().update(s.carts).set({ updatedAt: new Date(Date.now() - 48 * 3_600_000) }).where(eq(s.carts.id, cart!.id));
    const names = async (q: string) => (await g(`query($q: String) { abandonedCheckouts(first: 50, query: $q) { nodes { id completedAt } } }`, { q })).abandonedCheckouts.nodes.map((n: { id: string }) => n.id);
    const cid = gid('AbandonedCheckout', cart!.id);
    expect(await names('status:open')).toContain(cid);
    expect(await names('status:recovered')).not.toContain(cid);

    await db().insert(s.checkoutMeta).values({ cartId: cart!.id, shopId, recoveryEmailCount: 1, recoverySentAt: new Date() });
    await db().update(s.carts).set({ completedAt: new Date() }).where(eq(s.carts.id, cart!.id));
    expect(await names('status:open')).not.toContain(cid);
    expect(await names('status:recovered')).toContain(cid);
    expect((await g(`{ abandonedCheckoutsCount(query: "status:recovered") { count } }`)).abandonedCheckoutsCount.count).toBeGreaterThanOrEqual(1);
  });
});
