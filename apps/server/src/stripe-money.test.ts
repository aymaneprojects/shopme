import { createHmac } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Stripe from 'stripe';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import {
  createLocalStorage, decryptSecret, gatewaySecretOf, getPrimaryShop, getShop, getShopStripeKeys, openGatewaySecrets, schema as s, seedDemo, setShopStripeKeys, updateConfig, type Mail,
} from '@shopme/core';
import { createStripeAdmin, createStripeGateway, STRIPE_WEBHOOK_EVENTS, type StripeAdmin, type StripeClientLike } from '@shopme/payments';
import { createTestApp, SETUP_BODY, type TestApp } from './test-utils';
import { makeGql, makeGqlOk } from '../test/conformance/helpers';
import { paymentIntentKey } from './checkout';

const STRIPE = { secretKey: 'sk_test_x', publishableKey: 'pk_test_x', webhookSecret: 'whsec_test' };
const ADDRESS = { email: 'Buyer@Example.com', firstName: 'Ada', lastName: 'Lovelace', address1: '1 Rue de Rivoli', city: 'Paris', zip: '75001', countryCode: 'FR', phone: '' };

let t: TestApp;
let g: ReturnType<typeof makeGqlOk>;
let gql: ReturnType<typeof makeGql>;
let cookie: string;
let shopId: number;
const sku: Record<string, number> = {};

/** What the fake Stripe client was asked to do. */
const calls = { intents: [] as { params: any; key: string }[], refunds: [] as { params: any; key: string }[], cancels: [] as { id: string; key: string }[], captures: [] as string[] };
const fail = { refund: false, cancel: false };
let refundSeq = 0;
const listed: Record<string, { id: string; amount: number; status: string }[]> = {};

function fakeClient(): StripeClientLike {
  return {
    paymentIntents: {
      create: async (params, o) => { calls.intents.push({ params, key: String(o?.idempotencyKey) }); return { id: `pi_new_${calls.intents.length}`, client_secret: `pi_new_${calls.intents.length}_secret` }; },
      capture: async (id) => { calls.captures.push(id); },
      cancel: async (id, _p, o) => { if (fail.cancel) throw new Error('already canceled'); calls.cancels.push({ id, key: String(o?.idempotencyKey) }); },
    },
    refunds: {
      create: async (params, o) => {
        if (fail.refund) throw new Error('charge_already_refunded');
        calls.refunds.push({ params, key: String(o?.idempotencyKey) });
        return { id: `re_shopme_${++refundSeq}` };
      },
      list: async (p) => ({ data: listed[String(p.payment_intent)] ?? [] }),
    },
    webhooks: new Stripe(STRIPE.secretKey).webhooks as never,
  };
}

beforeAll(async () => {
  t = await createTestApp({ STRIPE_SECRET_KEY: STRIPE.secretKey, STRIPE_PUBLISHABLE_KEY: STRIPE.publishableKey, STRIPE_WEBHOOK_SECRET: STRIPE.webhookSecret });
  const setup = await t.app.inject({ method: 'POST', url: '/admin/api/setup', payload: SETUP_BODY });
  cookie = setup.cookies.find((c) => c.name === 'shopme_session')!.value;
  gql = makeGql(t.app, cookie);
  g = makeGqlOk(gql);
  await seedDemo(t.dbHandle.db, createLocalStorage(mkdtempSync(path.join(tmpdir(), 'sm-'))));
  shopId = (await getPrimaryShop(t.dbHandle.db))!.id;
  for (const v of await t.dbHandle.db.select().from(s.productVariants)) if (v.sku) sku[v.sku] = v.id;
  t.app.ctx.mailer = { send: async (_m: Mail) => undefined };
  t.app.checkoutPayments.stripe = createStripeGateway(STRIPE, fakeClient());
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
const complete = (token: string, method: string) => t.app.inject({ method: 'POST', url: `/checkouts/${token}/complete`, payload: { ...ADDRESS, paymentMethod: method }, headers: { 'content-type': 'application/json' } });

/** A fresh order (bank transfer, so nothing goes to Stripe) that we then dress up as a Stripe payment. */
async function stripeOrder(kind: 'SALE' | 'AUTHORIZATION', paymentId: string) {
  const { token } = await startCheckout('HEB-250', 1);
  await refresh(token, ADDRESS);
  expect((await complete(token, 'bank_transfer')).json()).toMatchObject({ ok: true });
  const [order] = await db().select().from(s.orders).where(eq(s.orders.cartToken, token));
  await db().update(s.transactions).set({ status: 'FAILURE' }).where(eq(s.transactions.orderId, order!.id));
  const [tx] = await db().insert(s.transactions).values({ shopId, orderId: order!.id, kind, status: 'SUCCESS', gateway: 'stripe', amount: order!.total, currency: order!.currency, paymentId, processedAt: new Date() }).returning();
  await db().update(s.orders).set({ financialStatus: kind === 'SALE' ? 'PAID' : 'AUTHORIZED' }).where(eq(s.orders.id, order!.id));
  return { order: order!, tx: tx! };
}
const txsOf = (orderId: number) => db().select().from(s.transactions).where(eq(s.transactions.orderId, orderId));
const orderRow = async (id: number) => (await db().select().from(s.orders).where(eq(s.orders.id, id)))[0]!;

const REFUND = `mutation($input: RefundInput!) { refundCreate(input: $input) { refund { id } userErrors { field message } } }`;
const refundInput = (order: { id: number; currency: string }, tx: { id: number }, amount: string) => ({
  orderId: gid('Order', order.id), transactions: [{ amount, gateway: 'stripe', kind: 'REFUND', orderId: gid('Order', order.id), parentId: gid('OrderTransaction', tx.id) }],
});

describe('refunds reach Stripe', () => {
  it('creates the Stripe refund first and stores its id on the REFUND transaction', async () => {
    const { order, tx } = await stripeOrder('SALE', 'pi_refund_1');
    const before = calls.refunds.length;
    const r = (await g(REFUND, { input: refundInput(order, tx, '5.00') })).refundCreate;
    expect(r.userErrors).toEqual([]);
    expect(calls.refunds).toHaveLength(before + 1);
    expect(calls.refunds.at(-1)!.params).toEqual({ payment_intent: 'pi_refund_1', amount: 500 });
    expect(calls.refunds.at(-1)!.key).toMatch(/^refund-/);
    const refund = (await txsOf(order.id)).find((x) => x.kind === 'REFUND')!;
    expect(refund).toMatchObject({ status: 'SUCCESS', gateway: 'stripe', amount: 500, paymentId: expect.stringMatching(/^re_shopme_/), parentId: tx.id });
    expect((await orderRow(order.id)).financialStatus).toBe('PARTIALLY_REFUNDED');
  });

  it('refuses the refund and records nothing when Stripe fails', async () => {
    const { order, tx } = await stripeOrder('SALE', 'pi_refund_2');
    fail.refund = true;
    try {
      const r = (await g(REFUND, { input: refundInput(order, tx, '3.00') })).refundCreate;
      expect(r.refund).toBeNull();
      expect(r.userErrors[0].message).toMatch(/payment provider refused the refund: charge_already_refunded/);
    } finally { fail.refund = false; }
    expect((await txsOf(order.id)).filter((x) => x.kind === 'REFUND')).toHaveLength(0);
    expect(await db().select().from(s.refunds).where(eq(s.refunds.orderId, order.id))).toHaveLength(0);
    expect(await orderRow(order.id)).toMatchObject({ financialStatus: 'PAID', totalRefunded: 0 });
  });

  it('only records manual, gift card and store credit refunds', async () => {
    const { token } = await startCheckout('HEB-250', 1);
    await refresh(token, ADDRESS);
    await complete(token, 'bank_transfer');
    const [order] = await db().select().from(s.orders).where(eq(s.orders.cartToken, token));
    await db().update(s.transactions).set({ status: 'SUCCESS', gateway: 'manual', paymentId: 'pi_not_stripe' }).where(eq(s.transactions.orderId, order!.id));
    await db().update(s.orders).set({ financialStatus: 'PAID' }).where(eq(s.orders.id, order!.id));
    const before = calls.refunds.length;
    const r = (await g(REFUND, { input: { orderId: gid('Order', order!.id), transactions: [{ amount: '2.00', gateway: 'manual', kind: 'REFUND', orderId: gid('Order', order!.id) }] } })).refundCreate;
    expect(r.userErrors).toEqual([]);
    expect(calls.refunds).toHaveLength(before);
    expect((await txsOf(order!.id)).find((x) => x.kind === 'REFUND')).toMatchObject({ gateway: 'manual', paymentId: null });
  });

  it('orderCancel with refund refunds at Stripe the whole captured amount', async () => {
    const { order } = await stripeOrder('SALE', 'pi_cancel_refund');
    const before = calls.refunds.length;
    const r = await g(`mutation($id: ID!) { orderCancel(orderId: $id, reason: OTHER, refund: true, restock: false) { orderCancelUserErrors { message } } }`, { id: gid('Order', order.id) });
    expect(r.orderCancel.orderCancelUserErrors).toEqual([]);
    expect(calls.refunds).toHaveLength(before + 1);
    expect(calls.refunds.at(-1)!.params).toEqual({ payment_intent: 'pi_cancel_refund', amount: order.total });
    expect(await orderRow(order.id)).toMatchObject({ financialStatus: 'REFUNDED' });
  });
});

describe('void', () => {
  const VOID = `mutation($id: ID!) { transactionVoid(parentTransactionId: $id) { transaction { id kind status } userErrors { field message code } } }`;

  it('cancels the PaymentIntent, records a VOID and voids the order', async () => {
    const { order, tx } = await stripeOrder('AUTHORIZATION', 'pi_void_1');
    const r = (await g(VOID, { id: gid('OrderTransaction', tx.id) })).transactionVoid;
    expect(r.userErrors).toEqual([]);
    expect(r.transaction).toMatchObject({ kind: 'VOID', status: 'SUCCESS' });
    expect(calls.cancels.at(-1)).toMatchObject({ id: 'pi_void_1', key: `void-${tx.id}` });
    expect(await orderRow(order.id)).toMatchObject({ financialStatus: 'VOIDED' });
    // Not voidable twice.
    const again = (await g(VOID, { id: gid('OrderTransaction', tx.id) })).transactionVoid;
    expect(again.transaction).toBeNull();
    expect(again.userErrors[0]).toMatchObject({ code: 'AUTH_NOT_VOIDABLE' });
  });

  it('reports unknown transactions, captured authorizations and provider failures', async () => {
    expect((await g(VOID, { id: gid('OrderTransaction', 999999) })).transactionVoid.userErrors[0]).toMatchObject({ code: 'TRANSACTION_NOT_FOUND' });
    const sale = await stripeOrder('SALE', 'pi_void_sale');
    expect((await g(VOID, { id: gid('OrderTransaction', sale.tx.id) })).transactionVoid.userErrors[0]).toMatchObject({ code: 'AUTH_NOT_VOIDABLE' });
    const failed = await db().insert(s.transactions).values({ shopId, orderId: sale.order.id, kind: 'AUTHORIZATION', status: 'FAILURE', gateway: 'stripe', amount: 100, currency: 'EUR' }).returning();
    expect((await g(VOID, { id: gid('OrderTransaction', failed[0]!.id) })).transactionVoid.userErrors[0]).toMatchObject({ code: 'AUTH_NOT_SUCCESSFUL' });
    const auth = await stripeOrder('AUTHORIZATION', 'pi_void_fail');
    fail.cancel = true;
    try {
      const r = (await g(VOID, { id: gid('OrderTransaction', auth.tx.id) })).transactionVoid;
      expect(r.userErrors[0]).toMatchObject({ code: 'GENERIC_ERROR' });
    } finally { fail.cancel = false; }
    expect((await txsOf(auth.order.id)).some((x) => x.kind === 'VOID')).toBe(false);
    expect(await orderRow(auth.order.id)).toMatchObject({ financialStatus: 'AUTHORIZED' });
  });

  it('only records the void of a non-Stripe authorization', async () => {
    const { order, tx } = await stripeOrder('AUTHORIZATION', 'pi_void_manual');
    await db().update(s.transactions).set({ gateway: 'manual', paymentId: null }).where(eq(s.transactions.id, tx.id));
    const before = calls.cancels.length;
    expect((await g(VOID, { id: gid('OrderTransaction', tx.id) })).transactionVoid.userErrors).toEqual([]);
    expect(calls.cancels).toHaveLength(before);
    expect(await orderRow(order.id)).toMatchObject({ financialStatus: 'VOIDED' });
  });

  it('orderCancel releases the authorization at Stripe', async () => {
    const { order, tx } = await stripeOrder('AUTHORIZATION', 'pi_cancel_auth');
    const r = await g(`mutation($id: ID!) { orderCancel(orderId: $id, reason: CUSTOMER, refund: false, restock: false) { orderCancelUserErrors { message } } }`, { id: gid('Order', order.id) });
    expect(r.orderCancel.orderCancelUserErrors).toEqual([]);
    expect(calls.cancels.at(-1)).toMatchObject({ id: 'pi_cancel_auth' });
    expect((await txsOf(order.id)).find((x) => x.kind === 'VOID')).toMatchObject({ parentId: tx.id, status: 'SUCCESS' });
    expect(await orderRow(order.id)).toMatchObject({ financialStatus: 'VOIDED' });
    expect((await orderRow(order.id)).cancelledAt).not.toBeNull();
  });

  it('orderCancel keeps the order when Stripe refuses to release the authorization', async () => {
    const { order } = await stripeOrder('AUTHORIZATION', 'pi_cancel_auth_fail');
    fail.cancel = true;
    try {
      const r = await g(`mutation($id: ID!) { orderCancel(orderId: $id, reason: OTHER, refund: false, restock: false) { orderCancelUserErrors { message } } }`, { id: gid('Order', order.id) });
      expect(r.orderCancel.orderCancelUserErrors[0].message).toMatch(/refused the void/);
    } finally { fail.cancel = false; }
    expect((await orderRow(order.id)).cancelledAt).toBeNull();
  });
});

describe('Stripe webhooks', () => {
  const post = (event: Record<string, unknown>, secret = STRIPE.webhookSecret) => {
    const payload = JSON.stringify({ id: `evt_${Math.random().toString(36).slice(2)}`, object: 'event', ...event });
    const header = new Stripe(STRIPE.secretKey).webhooks.generateTestHeaderString({ payload, secret });
    return t.app.inject({ method: 'POST', url: '/webhooks/stripe', payload, headers: { 'content-type': 'application/json', 'stripe-signature': header } });
  };
  const refunded = (pi: string, refunds?: { id: string; amount: number; status: string }[]) => ({ type: 'charge.refunded', data: { object: { id: 'ch_1', payment_intent: pi, ...(refunds ? { refunds: { data: refunds } } : {}) } } });

  it('charge.refunded mirrors a dashboard refund once, with no lines', async () => {
    const { order } = await stripeOrder('SALE', 'pi_wh_1');
    const ev = refunded('pi_wh_1', [{ id: 're_dash_1', amount: 300, status: 'succeeded' }]);
    expect((await post(ev)).statusCode).toBe(200);
    const refund = (await txsOf(order.id)).filter((x) => x.kind === 'REFUND');
    expect(refund).toHaveLength(1);
    expect(refund[0]).toMatchObject({ gateway: 'stripe', status: 'SUCCESS', amount: 300, paymentId: 're_dash_1' });
    const rows = await db().select().from(s.refunds).where(eq(s.refunds.orderId, order.id));
    expect(rows).toHaveLength(1);
    expect(await db().select().from(s.refundLines).where(eq(s.refundLines.refundId, rows[0]!.id))).toHaveLength(0);
    expect(await orderRow(order.id)).toMatchObject({ financialStatus: 'PARTIALLY_REFUNDED', totalRefunded: 300 });
    // The same delivery again, and a later event that lists the same refund, change nothing.
    expect((await post(ev)).statusCode).toBe(200);
    expect((await post(refunded('pi_wh_1', [{ id: 're_dash_1', amount: 300, status: 'succeeded' }]))).statusCode).toBe(200);
    expect((await txsOf(order.id)).filter((x) => x.kind === 'REFUND')).toHaveLength(1);
    expect(await orderRow(order.id)).toMatchObject({ totalRefunded: 300 });
    // A second dashboard refund for the rest turns the order REFUNDED.
    const rest = order.total - 300;
    expect((await post(refunded('pi_wh_1', [{ id: 're_dash_1', amount: 300, status: 'succeeded' }, { id: 're_dash_2', amount: rest, status: 'succeeded' }]))).statusCode).toBe(200);
    expect(await orderRow(order.id)).toMatchObject({ financialStatus: 'REFUNDED', totalRefunded: order.total });
    expect((await txsOf(order.id)).filter((x) => x.kind === 'REFUND')).toHaveLength(2);
  });

  it('does not count a refund ShopMe made itself', async () => {
    const { order, tx } = await stripeOrder('SALE', 'pi_wh_2');
    expect((await g(REFUND, { input: refundInput(order, tx, '4.00') })).refundCreate.userErrors).toEqual([]);
    const mine = (await txsOf(order.id)).find((x) => x.kind === 'REFUND')!.paymentId!;
    expect((await post(refunded('pi_wh_2', [{ id: mine, amount: 400, status: 'succeeded' }]))).statusCode).toBe(200);
    expect((await txsOf(order.id)).filter((x) => x.kind === 'REFUND')).toHaveLength(1);
    expect(await orderRow(order.id)).toMatchObject({ totalRefunded: 400 });
  });

  it('asks Stripe for the refunds when the charge does not carry them, and ignores failed ones', async () => {
    const { order } = await stripeOrder('SALE', 'pi_wh_3');
    listed.pi_wh_3 = [{ id: 're_listed_1', amount: 250, status: 'succeeded' }, { id: 're_listed_failed', amount: 100, status: 'failed' }];
    expect((await post(refunded('pi_wh_3'))).statusCode).toBe(200);
    expect((await txsOf(order.id)).filter((x) => x.kind === 'REFUND').map((x) => x.paymentId)).toEqual(['re_listed_1']);
  });

  it('payment_intent.canceled voids an authorized order, once', async () => {
    const { order, tx } = await stripeOrder('AUTHORIZATION', 'pi_wh_4');
    const ev = { type: 'payment_intent.canceled', data: { object: { id: 'pi_wh_4' } } };
    const cancels = calls.cancels.length;
    expect((await post(ev)).statusCode).toBe(200);
    expect((await txsOf(order.id)).filter((x) => x.kind === 'VOID')).toHaveLength(1);
    expect((await txsOf(order.id)).find((x) => x.kind === 'VOID')).toMatchObject({ parentId: tx.id });
    expect(await orderRow(order.id)).toMatchObject({ financialStatus: 'VOIDED' });
    expect(calls.cancels).toHaveLength(cancels); // Stripe already cancelled it: nothing to call
    expect((await post(ev)).statusCode).toBe(200);
    expect((await txsOf(order.id)).filter((x) => x.kind === 'VOID')).toHaveLength(1);
    // A paid order is left alone.
    const paid = await stripeOrder('SALE', 'pi_wh_5');
    expect((await post({ type: 'payment_intent.canceled', data: { object: { id: 'pi_wh_5' } } })).statusCode).toBe(200);
    expect(await orderRow(paid.order.id)).toMatchObject({ financialStatus: 'PAID' });
  });

  it('a void made from ShopMe is not voided again by the canceled event', async () => {
    const { order, tx } = await stripeOrder('AUTHORIZATION', 'pi_wh_6');
    expect((await g(`mutation($id: ID!) { transactionVoid(parentTransactionId: $id) { userErrors { message } } }`, { id: gid('OrderTransaction', tx.id) })).transactionVoid.userErrors).toEqual([]);
    expect((await post({ type: 'payment_intent.canceled', data: { object: { id: 'pi_wh_6' } } })).statusCode).toBe(200);
    expect((await txsOf(order.id)).filter((x) => x.kind === 'VOID')).toHaveLength(1);
  });

  it('charge.dispute.created adds one timeline event per dispute', async () => {
    const { order } = await stripeOrder('SALE', 'pi_wh_7');
    const ev = { type: 'charge.dispute.created', data: { object: { id: 'dp_1', payment_intent: 'pi_wh_7', amount: 1000, currency: 'eur', reason: 'fraudulent' } } };
    expect((await post(ev)).statusCode).toBe(200);
    expect((await post(ev)).statusCode).toBe(200);
    const events = await db().select().from(s.events).where(and(eq(s.events.subjectId, order.id), eq(s.events.verb, 'order.dispute_created')));
    expect(events).toHaveLength(1);
    expect(events[0]!.message).toMatch(/fraudulent/);
  });

  it('still rejects a bad signature', async () => {
    expect((await post(refunded('pi_wh_1', []), 'whsec_wrong')).statusCode).toBe(400);
  });
});

describe('PaymentIntent idempotency key', () => {
  it('is stable for the same checkout and changes with the cart', () => {
    const a = paymentIntentKey('tok', { amount: 1000, currency: 'eur' });
    expect(paymentIntentKey('tok', { amount: 1000, currency: 'EUR' })).toBe(a);
    expect(paymentIntentKey('tok', { amount: 1001, currency: 'eur' })).not.toBe(a);
    expect(paymentIntentKey('tok', { amount: 1000, currency: 'usd' })).not.toBe(a);
    expect(paymentIntentKey('other', { amount: 1000, currency: 'eur' })).not.toBe(a);
    expect(a).toMatch(/^pi-tok-[0-9a-f]{20}$/);
  });

  it('is what the checkout sends to Stripe', async () => {
    const { token } = await startCheckout('HEB-250', 1);
    await refresh(token, ADDRESS);
    const before = calls.intents.length;
    const res = await complete(token, 'stripe');
    expect(res.json()).toMatchObject({ ok: true });
    const sent = calls.intents.slice(before);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.key).toBe(paymentIntentKey(token, { amount: sent[0]!.params.amount, currency: 'eur', captureMethod: 'automatic', email: 'buyer@example.com' }));
  });
});

/** An admin client double: records the account calls, can fail each of them. */
function fakeAdmin(over: Partial<Record<'verify' | 'create' | 'register' | 'delete', () => Promise<never>>> = {}) {
  const log = { created: [] as { url: string; events: string[] }[], deleted: [] as string[], domains: [] as string[], secretKeys: [] as string[] };
  let n = 0;
  const client: StripeClientLike = {
    paymentIntents: { create: async () => ({ id: 'x', client_secret: 'y' }) },
    accounts: { retrieve: async () => { if (over.verify) return over.verify(); return { id: 'acct_1' }; } },
    webhookEndpoints: {
      create: async (p) => { if (over.create) return over.create(); log.created.push({ url: String(p.url), events: p.enabled_events as string[] }); return { id: `we_${++n}`, secret: `whsec_auto${n}` }; },
      del: async (id) => { if (over.delete) return over.delete(); log.deleted.push(id); },
    },
    paymentMethodDomains: { create: async (p) => { if (over.register) return over.register(); log.domains.push(String(p.domain_name)); } },
    webhooks: new Stripe(STRIPE.secretKey).webhooks as never,
  };
  const admin = (k: string): StripeAdmin => { log.secretKeys.push(k); return createStripeAdmin(k, client); };
  return { admin, log };
}

describe('saving Stripe keys', () => {
  const keys = { publishableKey: 'pk_test_abc123', secretKey: 'sk_test_abc123', webhookSecret: '' };
  const SECRET = 'k'.repeat(40);
  const HTTPS = 'https://shop.example.com/webhooks/stripe';
  const put = (payload: Record<string, unknown>) => t.app.inject({ method: 'PUT', url: '/admin/api/store/payments/stripe', cookies: { shopme_session: cookie }, payload });
  const rawSecrets = async () => { const r = (await db().select().from(s.shopSecrets).where(eq(s.shopSecrets.shopId, shopId)))[0]; return r?.stripeSecretKey ? r : undefined; };

  it('rejects a secret key Stripe does not accept, with a clear message, and stores nothing', async () => {
    const f = fakeAdmin({ verify: async () => { throw new Error('Invalid API Key provided: sk_test_****'); } });
    const original = t.app.checkoutPayments.admin;
    t.app.checkoutPayments.admin = f.admin;
    try {
      const res = await put({ ...keys, webhookSecret: 'whsec_manual1' });
      expect(res.statusCode).toBe(422);
      expect(res.json().error).toMatch(/Stripe did not accept this secret key: Invalid API Key/);
    } finally { t.app.checkoutPayments.admin = original; }
    expect(await rawSecrets()).toBeUndefined();
  });

  it('keeps the format checks', async () => {
    const f = fakeAdmin();
    t.app.checkoutPayments.admin = f.admin;
    expect((await put({ ...keys, secretKey: 'nope' })).json().error).toMatch(/secret key starts with/);
    expect((await put({ ...keys, webhookSecret: 'abc' })).json().error).toMatch(/starts with whsec_/);
    expect(f.log.secretKeys).toEqual([]); // nothing reached Stripe
  });

  it('saves with a pasted signing secret and creates no endpoint', async () => {
    const f = fakeAdmin();
    t.app.checkoutPayments.admin = f.admin;
    const res = await put({ ...keys, webhookSecret: 'whsec_pasted1' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ configured: true, webhookAutoCreated: false });
    expect(f.log.created).toEqual([]);
    expect((await getShopStripeKeys(db(), shopId, SECRET))).toBeNull(); // other session secret: not readable
    expect((await getShopStripeKeys(db(), shopId, t.app.ctx.config.sessionSecret))!.webhookSecret).toBe('whsec_pasted1');
    await put(null as never); // reset below through the API
    expect((await t.app.inject({ method: 'DELETE', url: '/admin/api/store/payments/stripe', cookies: { shopme_session: cookie } })).statusCode).toBe(200);
  });

  it('skips auto-registration on a local or non-https URL and asks for the secret', async () => {
    const f = fakeAdmin();
    t.app.checkoutPayments.admin = f.admin;
    const res = await put(keys); // the test server's public URL is http://localhost
    expect(res.statusCode).toBe(422);
    expect(res.json().error).toMatch(/cannot be created automatically.*paste its signing secret/);
    expect(f.log.created).toEqual([]);
    expect(await rawSecrets()).toBeUndefined();
  });

  it('creates the webhook endpoint through Stripe, stores its secret encrypted and replaces it with the keys', async () => {
    const f = fakeAdmin();
    const key = t.app.ctx.config.sessionSecret;
    const setup = { admin: f.admin, webhookUrl: HTTPS, domains: ['shop.example.com', 'localhost', 'shop.example.com'] };
    const r1 = await setShopStripeKeys(db(), shopId, keys, key, setup);
    expect(r1.ok && r1.value).toMatchObject({ configured: true, webhookSecretSet: true, webhookAutoCreated: true });
    expect(f.log.created).toEqual([{ url: HTTPS, events: [...STRIPE_WEBHOOK_EVENTS] }]);
    expect(f.log.domains).toEqual(['shop.example.com']); // once, and never localhost
    const row = (await rawSecrets())!;
    expect(row.stripeWebhookSecret).not.toContain('whsec_auto1');
    expect(decryptSecret(row.stripeWebhookSecret!, key)).toBe('whsec_auto1');
    expect(row.stripeWebhookEndpointId).toBe('we_1');
    // Replacing the keys creates a new endpoint and deletes the old one.
    const r2 = await setShopStripeKeys(db(), shopId, keys, key, setup);
    expect(r2.ok).toBe(true);
    expect(f.log.deleted).toEqual(['we_1']);
    expect((await rawSecrets())!.stripeWebhookEndpointId).toBe('we_2');
    // Pasting a secret instead removes the endpoint we had created.
    await setShopStripeKeys(db(), shopId, { ...keys, webhookSecret: 'whsec_mine1' }, key, setup);
    expect(f.log.deleted).toEqual(['we_1', 'we_2']);
    expect((await rawSecrets())!.stripeWebhookEndpointId).toBeNull();
    // Removing auto-created keys deletes the endpoint too.
    await setShopStripeKeys(db(), shopId, keys, key, setup);
    await setShopStripeKeys(db(), shopId, null, key, setup);
    expect(f.log.deleted).toEqual(['we_1', 'we_2', 'we_3']);
    expect(await getShopStripeKeys(db(), shopId, key)).toBeNull();
  });

  it('saves even when wallet domain registration fails, and reports a failed endpoint creation', async () => {
    const key = t.app.ctx.config.sessionSecret;
    const bad = fakeAdmin({ register: async () => { throw new Error('domain not verifiable'); } });
    expect((await setShopStripeKeys(db(), shopId, keys, key, { admin: bad.admin, webhookUrl: HTTPS, domains: ['shop.example.com'] })).ok).toBe(true);
    await setShopStripeKeys(db(), shopId, null, key);
    const noEndpoint = fakeAdmin({ create: async () => { throw new Error('permission denied'); } });
    const r = await setShopStripeKeys(db(), shopId, keys, key, { admin: noEndpoint.admin, webhookUrl: HTTPS });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.errors[0]!.message).toMatch(/could not create the webhook endpoint \(permission denied\)/);
    expect(await getShopStripeKeys(db(), shopId, key)).toBeNull();
  });
});

describe('redirect gateway secrets', () => {
  const key = () => t.app.ctx.config.sessionSecret;
  const gw = (secret: string) => ({ id: 'pay', name: 'Pay page', redirectUrl: 'https://pay.example.com/?o={order}', secret, enabled: true });
  const hook = (secret: string, body: string) => t.app.inject({
    method: 'POST', url: '/webhooks/payments/pay', payload: body,
    headers: { 'content-type': 'application/json', 'x-shopme-signature': createHmac('sha256', secret).update(body).digest('hex') },
  });

  it('are stored encrypted, shown in the clear to the admin, and verify the payment webhook', async () => {
    const shop = (await getShop(db(), shopId))!;
    const r = await updateConfig(db(), shop, 'PAYMENTS', { redirectGateways: [gw('plain-secret-1')] }, null, key());
    expect(r.ok && (r.value as { redirectGateways: { secret: string }[] }).redirectGateways[0]!.secret).toBe('plain-secret-1');
    const stored = (await getShop(db(), shopId))!;
    const raw = JSON.stringify(stored.settings);
    expect(raw).not.toContain('plain-secret-1');
    const blob = (stored.settings.config as { payments: { redirectGateways: { secret: string }[] } }).payments.redirectGateways[0]!.secret;
    expect(decryptSecret(blob, key())).toBe('plain-secret-1');
    expect(gatewaySecretOf(blob, key())).toBe('plain-secret-1');
    const cfg = await g(`{ shopmeConfig(key: "PAYMENTS") }`);
    expect(cfg.shopmeConfig.redirectGateways[0].secret).toBe('plain-secret-1');
    // Saving the block again (the admin sends the clear value back) does not double-encrypt.
    await g(`mutation($v: JSON!) { shopmeConfigUpdate(key: "PAYMENTS", value: $v) { userErrors { message } } }`, { v: cfg.shopmeConfig });
    const again = ((await getShop(db(), shopId))!.settings.config as { payments: { redirectGateways: { secret: string }[] } }).payments.redirectGateways[0]!.secret;
    expect(decryptSecret(again, key())).toBe('plain-secret-1');
    // The signed confirmation still checks out (the order does not exist: 404 after the signature passed).
    expect((await hook('plain-secret-1', JSON.stringify({ reference: '#nope', status: 'paid' }))).statusCode).toBe(404);
    expect((await hook('wrong', JSON.stringify({ reference: '#nope', status: 'paid' }))).statusCode).toBe(400);
  });

  it('still reads a legacy plaintext secret', async () => {
    const shop = (await getShop(db(), shopId))!;
    await db().update(s.shops).set({ settings: { ...shop.settings, config: { ...(shop.settings.config as object), payments: { redirectGateways: [gw('legacy-secret-9')] } } } }).where(eq(s.shops.id, shopId));
    const legacy = (await getShop(db(), shopId))!;
    expect(openGatewaySecrets({ redirectGateways: [{ secret: 'legacy-secret-9' }] }, key()).redirectGateways[0]!.secret).toBe('legacy-secret-9');
    expect(gatewaySecretOf('legacy-secret-9', key())).toBe('legacy-secret-9');
    expect(legacy.settings.config).toBeTruthy();
    expect((await hook('legacy-secret-9', JSON.stringify({ reference: '#nope', status: 'paid' }))).statusCode).toBe(404);
    expect((await g(`{ shopmeConfig(key: "PAYMENTS") }`)).shopmeConfig.redirectGateways[0].secret).toBe('legacy-secret-9');
    // The next save encrypts it.
    const r = await updateConfig(db(), legacy, 'PAYMENTS', { redirectGateways: [gw('legacy-secret-9')] }, null, key());
    expect(r.ok).toBe(true);
    expect(JSON.stringify((await getShop(db(), shopId))!.settings)).not.toContain('legacy-secret-9');
  });
});
