import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { createLocalStorage, getPrimaryShop, schema as s, seedDemo, updateConfig, type Mail } from '@shopme/core';
import { clearPayPalTokenCache, type FetchLike } from '@shopme/payments';
import { createTestApp, SETUP_BODY, type TestApp } from './test-utils';
import { makeGql, makeGqlOk } from '../test/conformance/helpers';
import { hostedPaymentKey } from './checkout';

const ADDRESS = { email: 'Buyer@Example.com', firstName: 'Ada', lastName: 'Lovelace', address1: '1 Rue de Rivoli', city: 'Paris', zip: '75001', countryCode: 'FR', phone: '' };
const PP = { clientId: 'AbCdEfGhIjKl1234', clientSecret: 'EsecretSecretSecret9876', environment: 'sandbox' };
const MOLLIE_KEY = 'test_abcdefghijklmnopqrstuvwxyz123456';

// ---- a fake PayPal and Mollie behind the injected fetch (nothing reaches the providers) ----------------------------------------
interface Req { method: string; url: string; headers: Record<string, string>; body: any }
const log: Req[] = [];
const pp = {
  orders: new Map<string, { intent: string; amount: { currency_code: string; value: string }; captureId?: string; authId?: string }>(), seq: 0,
  declineCapture: false, failRefund: false, failVoid: false, goodSignature: 'valid',
};
const mollie = {
  payments: new Map<string, { status: string; amount: { currency: string; value: string }; refunded: number; metadata: any }>(), seq: 0, refundSeq: 0, failRefund: false, badKey: false, methodsFail: false,
};
const res = (status: number, json?: unknown) => ({ ok: status < 400, status, headers: { get: () => null }, text: async () => (json === undefined ? '' : JSON.stringify(json)) });
const dec = (minor: number) => (minor / 100).toFixed(2);

const providerFetch: FetchLike = async (url, init) => {
  const u = new URL(url);
  const body = init.body ? (init.headers['Content-Type']?.includes('json') ? JSON.parse(init.body) : init.body) : undefined;
  log.push({ method: init.method, url, headers: init.headers, body });
  const p = u.pathname;
  if (u.hostname.includes('paypal')) {
    if (p === '/v1/oauth2/token') return String(init.headers.Authorization).includes(Buffer.from('BAD:x').toString('base64')) ? res(401, { error: 'invalid_client', error_description: 'Client Authentication failed' }) : res(200, { access_token: 'tok', expires_in: 3000 });
    if (p === '/v1/notifications/webhooks' && init.method === 'POST') return res(201, { id: `WH-created-${++pp.seq}`, url: body.url });
    if (p.startsWith('/v1/notifications/webhooks/') && init.method === 'DELETE') return res(204);
    if (p === '/v1/notifications/verify-webhook-signature') return res(200, { verification_status: body.transmission_sig === pp.goodSignature ? 'SUCCESS' : 'FAILURE' });
    if (p === '/v2/checkout/orders' && init.method === 'POST') {
      const id = `PPO${++pp.seq}`;
      pp.orders.set(id, { intent: body.intent, amount: body.purchase_units[0].amount });
      return res(201, { id, status: 'PAYER_ACTION_REQUIRED', links: [{ rel: 'payer-action', href: `https://www.sandbox.paypal.com/checkoutnow?token=${id}` }] });
    }
    const order = /^\/v2\/checkout\/orders\/([^/]+)(?:\/(capture|authorize))?$/.exec(p);
    if (order) {
      const o = pp.orders.get(order[1]!)!;
      if (order[2] === 'capture') {
        if (pp.declineCapture) return res(422, { name: 'UNPROCESSABLE_ENTITY', details: [{ issue: 'INSTRUMENT_DECLINED', description: 'The instrument presented was declined.' }] });
        o.captureId ??= `CAP${++pp.seq}`;
      }
      if (order[2] === 'authorize') o.authId ??= `AUTH${++pp.seq}`;
      const units = { custom_id: 'x', payments: { ...(o.captureId ? { captures: [{ id: o.captureId, status: 'COMPLETED', amount: o.amount }] } : {}), ...(o.authId ? { authorizations: [{ id: o.authId, status: 'CREATED', amount: o.amount }] } : {}) } };
      return res(200, { id: order[1], status: o.captureId ? 'COMPLETED' : o.authId ? 'COMPLETED' : 'APPROVED', purchase_units: [units] });
    }
    const auth = /^\/v2\/payments\/authorizations\/([^/]+)\/(capture|void)$/.exec(p);
    if (auth) {
      if (auth[2] === 'void') return pp.failVoid ? res(422, { name: 'AUTHORIZATION_ALREADY_VOIDED', message: 'Authorization has been voided' }) : res(204);
      return res(201, { id: 'CAPAUTH1', status: 'COMPLETED', amount: body.amount ?? { currency_code: 'EUR', value: '0.00' } });
    }
    if (/^\/v2\/payments\/captures\/[^/]+\/refund$/.test(p)) {
      if (pp.failRefund) return res(422, { name: 'CAPTURE_FULLY_REFUNDED', message: 'The capture has already been fully refunded' });
      return res(201, { id: `REF${++pp.seq}`, status: 'COMPLETED', amount: body.amount });
    }
  } else if (u.hostname === 'api.mollie.com') {
    if (mollie.badKey || String(init.headers.Authorization).includes('badkey')) return res(401, { title: 'Unauthorized Request', detail: 'Missing authentication, or failed to authenticate' });
    if (p === '/v2/methods') return mollie.methodsFail ? res(500, { title: 'Internal Server Error', detail: 'boom' }) : res(200, { _embedded: { methods: [{ id: 'ideal', description: 'iDEAL', status: 'activated' }, { id: 'creditcard', description: 'Credit card', status: 'activated' }, { id: 'giropay', description: 'Giropay', status: 'pending-boarding' }] } });
    const view = (id: string) => { const m = mollie.payments.get(id)!; return { id, status: m.status, amount: m.amount, amountRefunded: { currency: m.amount.currency, value: dec(m.refunded) }, metadata: m.metadata, method: 'ideal', isCancelable: m.status === 'open', _links: { checkout: { href: `https://www.mollie.com/checkout/${id}` } } }; };
    if (p === '/v2/payments' && init.method === 'POST') {
      const id = `tr_${++mollie.seq}`;
      mollie.payments.set(id, { status: 'open', amount: body.amount, refunded: 0, metadata: body.metadata });
      return res(201, view(id));
    }
    const pay = /^\/v2\/payments\/(tr_[A-Za-z0-9]+)(?:\/(refunds))?$/.exec(p);
    if (pay) {
      if (!mollie.payments.has(pay[1]!)) return res(404, { title: 'Not Found', detail: 'No payment exists with token' });
      if (pay[2] === 'refunds') {
        if (mollie.failRefund) return res(422, { title: 'Unprocessable Entity', detail: 'The amount is higher than the maximum refundable amount' });
        const minor = Math.round(Number(body.amount.value) * 100);
        mollie.payments.get(pay[1]!)!.refunded += minor;
        return res(201, { id: `re_${++mollie.refundSeq}`, paymentId: pay[1], status: 'queued', amount: body.amount });
      }
      if (init.method === 'DELETE') { mollie.payments.get(pay[1]!)!.status = 'canceled'; return res(200, view(pay[1]!)); }
      return res(200, view(pay[1]!));
    }
  }
  return res(404, { message: `unexpected ${init.method} ${url}` });
};
const calls = (needle: string | RegExp, method?: string) => log.filter((r) => (!method || r.method === method) && (typeof needle === 'string' ? r.url.includes(needle) : needle.test(r.url)));

// ---- harness --------------------------------------------------------------------------------------------------------------------
let t: TestApp;
let g: ReturnType<typeof makeGqlOk>;
let cookie: string;
let shopId: number;
const sku: Record<string, number> = {};
const emails: string[] = [];

beforeAll(async () => {
  t = await createTestApp();
  const setup = await t.app.inject({ method: 'POST', url: '/admin/api/setup', payload: SETUP_BODY });
  cookie = setup.cookies.find((c) => c.name === 'shopme_session')!.value;
  g = makeGqlOk(makeGql(t.app, cookie));
  await seedDemo(t.dbHandle.db, createLocalStorage(mkdtempSync(path.join(tmpdir(), 'sm-'))));
  shopId = (await getPrimaryShop(t.dbHandle.db))!.id;
  for (const v of await t.dbHandle.db.select().from(s.productVariants)) if (v.sku) sku[v.sku] = v.id;
  t.app.ctx.mailer = { send: async (m: Mail) => { emails.push(m.subject); } };
  t.app.checkoutPayments.providerFetch = providerFetch;
}, 90_000);
afterAll(async () => { await t.close(); });
beforeEach(() => { clearPayPalTokenCache(); t.app.checkoutPayments.clearMollieLabels(); });

const db = () => t.dbHandle.db;
const gid = (type: string, id: number) => `gid://shopify/${type}/${id}`;
const admin = (method: string, url: string, payload?: unknown) => t.app.inject({ method: method as 'GET', url, payload: payload as never, cookies: { shopme_session: cookie } });
const txsOf = (orderId: number) => db().select().from(s.transactions).where(eq(s.transactions.orderId, orderId));
const orderRow = async (id: number) => (await db().select().from(s.orders).where(eq(s.orders.id, id)))[0]!;
const orderOf = async (token: string) => (await db().select().from(s.orders).where(eq(s.orders.cartToken, token)))[0]!;
const setAppUrl = (url: string) => { const c = t.app.ctx.config as { appUrl: string }; const old = c.appUrl; c.appUrl = url; return () => { c.appUrl = old; }; };

async function startCheckout(variant = 'HEB-250', quantity = 1) {
  const add = await t.app.inject({ method: 'POST', url: '/cart/add.js', payload: { id: sku[variant], quantity } });
  const cart = add.cookies.find((c) => c.name === 'cart')!.value;
  const go = await t.app.inject({ method: 'POST', url: '/checkout', cookies: { cart } });
  return { cart, token: go.headers.location!.toString().split('/').pop()! };
}
const refresh = (token: string) => t.app.inject({ method: 'POST', url: `/checkouts/${token}/refresh`, payload: ADDRESS });
const complete = (token: string, method: string) => t.app.inject({ method: 'POST', url: `/checkouts/${token}/complete`, payload: { ...ADDRESS, paymentMethod: method }, headers: { 'content-type': 'application/json' } });
/** A checkout paid with `method`: the order is PENDING and the buyer is sent to the provider. */
async function placeOrder(method: 'paypal' | 'mollie') {
  const { token } = await startCheckout();
  await refresh(token);
  const r = await complete(token, method);
  expect(r.statusCode, r.body).toBe(200);
  const order = await orderOf(token);
  return { token, order, redirectUrl: r.json().redirectUrl as string, sale: (await txsOf(order.id)).find((x) => x.kind === 'SALE')! };
}

const savePayPal = (body: Record<string, unknown> = {}) => admin('PUT', '/admin/api/store/payments/paypal', { ...PP, webhookId: 'WH-manual-1', ...body });
const saveMollie = (apiKey = MOLLIE_KEY) => admin('PUT', '/admin/api/store/payments/mollie', { apiKey });
const enable = (input: Record<string, unknown>) => g(`mutation($input: ShopmePaymentSettingsInput!) { shopmePaymentSettingsUpdate(input: $input) { paymentSettings { paypal { enabled configured environment } mollie { enabled configured mode } } userErrors { field message } } }`, { input });

describe('credentials', () => {
  it('PayPal: validates with an access token, never returns secrets, removes cleanly', async () => {
    const bad = await savePayPal({ clientId: 'BAD', clientSecret: 'x' });
    expect(bad.statusCode).toBe(422);
    expect(bad.json().error).toMatch(/PayPal did not accept these credentials: Client Authentication failed/);
    expect((await admin('GET', '/admin/api/store/payments/paypal')).json()).toMatchObject({ configured: false });
    expect((await savePayPal({ environment: 'moon' })).statusCode).toBe(422);

    const ok = await savePayPal();
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({ configured: true, environment: 'sandbox', testMode: true, clientIdLast4: '1234', clientSecretLast4: '9876', webhookId: 'WH-manual-1', webhookAutoCreated: false });
    expect(ok.body).not.toContain(PP.clientSecret);
    const row = (await db().select().from(s.shopSecrets).where(eq(s.shopSecrets.shopId, shopId)))[0]!;
    expect(row.paypalClientSecret).not.toContain('secretSecret');
    expect(calls('/webhooks', 'POST')).toHaveLength(0); // a given webhook id creates nothing

    expect((await admin('GET', '/admin/api/store/payments/paypal')).json()).toMatchObject({ configured: true, clientSecretLast4: '9876' });
    const del = await admin('DELETE', '/admin/api/store/payments/paypal');
    expect(del.json()).toMatchObject({ configured: false, environment: null, webhookId: null });
  });

  it('PayPal: without a webhook id, a local server must be given one (422), an https one gets it created', async () => {
    const local = await savePayPal({ webhookId: undefined });
    expect(local.statusCode).toBe(422);
    expect(local.json()).toMatchObject({ issues: [{ code: 'WEBHOOK_ID_REQUIRED' }] });
    expect(local.json().error).toMatch(/not reachable from PayPal over https/);
    expect((await admin('GET', '/admin/api/store/payments/paypal')).json().configured).toBe(false);

    const restore = setAppUrl('https://shop.example.com');
    try {
      log.length = 0;
      const made = await savePayPal({ webhookId: undefined });
      expect(made.statusCode, made.body).toBe(200);
      const created = calls('/v1/notifications/webhooks', 'POST')[0]!;
      expect(created.body.url).toMatch(/^https:\/\/shop\.example\.com\/webhooks\/paypal(\/.+)?$/);
      expect(created.body.event_types.map((e: { name: string }) => e.name)).toEqual(expect.arrayContaining(['CHECKOUT.ORDER.APPROVED', 'PAYMENT.CAPTURE.COMPLETED', 'PAYMENT.CAPTURE.REFUNDED']));
      const first = made.json();
      expect(first).toMatchObject({ configured: true, webhookAutoCreated: true, webhookId: expect.stringMatching(/^WH-created-/) });
      // Saving the same app again reuses the webhook instead of creating a duplicate.
      log.length = 0;
      expect((await savePayPal({ webhookId: undefined })).json().webhookId).toBe(first.webhookId);
      expect(calls('/v1/notifications/webhooks', 'POST')).toHaveLength(0);
      // Another app: the new webhook is created and the old one deleted.
      const other = await savePayPal({ webhookId: undefined, clientId: 'OtherClientId5555' });
      expect(other.json().webhookId).not.toBe(first.webhookId);
      expect(calls(`/v1/notifications/webhooks/${first.webhookId}`, 'DELETE')).toHaveLength(1);
      // Removing the credentials deletes the webhook ShopMe created.
      log.length = 0;
      await admin('DELETE', '/admin/api/store/payments/paypal');
      expect(calls(`/v1/notifications/webhooks/${other.json().webhookId}`, 'DELETE')).toHaveLength(1);
    } finally { restore(); }
  });

  it('Mollie: format check, real validation, status without the key, removal', async () => {
    expect((await saveMollie('nope')).statusCode).toBe(422);
    mollie.badKey = true;
    const rejected = await saveMollie();
    mollie.badKey = false;
    expect(rejected.statusCode).toBe(422);
    expect(rejected.json().error).toMatch(/Mollie did not accept this API key: Unauthorized Request/);
    expect((await admin('GET', '/admin/api/store/payments/mollie')).json().configured).toBe(false);
    const ok = await saveMollie();
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({ configured: true, mode: 'test', testMode: true, apiKeyLast4: '3456' });
    expect(ok.body).not.toContain(MOLLIE_KEY);
    expect((await db().select().from(s.shopSecrets).where(eq(s.shopSecrets.shopId, shopId)))[0]!.mollieApiKey).not.toContain('abcdefgh');
    expect((await admin('DELETE', '/admin/api/store/payments/mollie')).json()).toMatchObject({ configured: false, mode: null });
  });
});

describe('settings and checkout options', () => {
  it('refuses enabling an unconfigured provider and shows the options only when enabled and configured', async () => {
    expect((await enable({ paypal: { enabled: true } })).shopmePaymentSettingsUpdate.userErrors[0].message).toMatch(/PayPal is not configured/);
    expect((await enable({ mollie: { enabled: true } })).shopmePaymentSettingsUpdate.userErrors[0].message).toMatch(/Mollie is not configured/);

    const { token } = await startCheckout();
    const page = async () => (await t.app.inject({ method: 'GET', url: `/checkouts/${token}` })).body;
    expect(await page()).not.toContain('value="paypal"');

    await savePayPal();
    await saveMollie();
    // Configured but not switched on: still hidden.
    let html = await page();
    expect(html).not.toContain('value="paypal"');
    expect(html).not.toContain('value="mollie"');

    const r = (await enable({ paypal: { enabled: true }, mollie: { enabled: true } })).shopmePaymentSettingsUpdate;
    expect(r.userErrors).toEqual([]);
    expect(r.paymentSettings).toMatchObject({ paypal: { enabled: true, configured: true, environment: 'sandbox' }, mollie: { enabled: true, configured: true, mode: 'test' } });
    log.length = 0;
    html = await page();
    expect(html).toMatch(/name="paymentMethod" value="paypal"[^>]*><span class="grow">PayPal</);
    expect(html).toMatch(/name="paymentMethod" value="mollie"[^>]*><span class="grow">iDEAL, Credit card</);
    expect(html).not.toContain('Giropay'); // not activated
    await page();
    expect(calls('/v2/methods')).toHaveLength(1); // cached per store

    // The methods cannot be read: the option falls back to "Mollie".
    t.app.checkoutPayments.clearMollieLabels();
    mollie.methodsFail = true;
    try { expect(await page()).toMatch(/value="mollie"[^>]*><span class="grow">Mollie</); } finally { mollie.methodsFail = false; }

    // The refresh endpoint offers them too, and removing the credentials switches them off for good.
    expect((await refresh(token)).json().methods).toEqual(expect.arrayContaining(['paypal', 'mollie']));
    await admin('DELETE', '/admin/api/store/payments/paypal');
    await admin('DELETE', '/admin/api/store/payments/mollie');
    html = await page();
    expect(html).not.toContain('value="paypal"');
    expect(html).not.toContain('value="mollie"');
    await savePayPal();
    expect(await page()).not.toContain('value="paypal"'); // saving again does not switch it back on
    await saveMollie();
    await enable({ paypal: { enabled: true }, mollie: { enabled: true } });
  });

  it('keys the provider order by checkout, amount, currency, capture mode and email', () => {
    const k = hostedPaymentKey('paypal', 'tok', { amount: 1000, currency: 'eur', email: 'a@b.c' });
    expect(k).toBe(hostedPaymentKey('paypal', 'tok', { amount: 1000, currency: 'EUR', email: 'a@b.c' }));
    expect(k).not.toBe(hostedPaymentKey('paypal', 'tok', { amount: 1001, currency: 'EUR', email: 'a@b.c' }));
    expect(k).not.toBe(hostedPaymentKey('paypal', 'tok', { amount: 1000, currency: 'EUR', captureMethod: 'manual', email: 'a@b.c' }));
    expect(k).not.toBe(hostedPaymentKey('mollie', 'tok', { amount: 1000, currency: 'EUR', email: 'a@b.c' }));
  });
});

describe('PayPal checkout', () => {
  beforeAll(async () => { await savePayPal(); await enable({ paypal: { enabled: true } }); });

  it('pay, come back, captured, order PAID, provider ids stored', async () => {
    emails.length = 0;
    const { token, order, redirectUrl, sale } = await placeOrder('paypal');
    expect(redirectUrl).toMatch(/^https:\/\/www\.sandbox\.paypal\.com\/checkoutnow\?token=PPO\d+$/);
    expect(order.financialStatus).toBe('PENDING');
    expect(sale).toMatchObject({ gateway: 'paypal', status: 'PENDING', paymentId: redirectUrl.split('=')[1] });
    const create = calls('/v2/checkout/orders', 'POST').at(-1)!;
    expect(create.body).toMatchObject({ intent: 'CAPTURE', purchase_units: [{ custom_id: token, amount: { currency_code: 'EUR' } }] });
    expect(create.headers['PayPal-Request-Id']).toMatch(new RegExp(`^paypal-${token}-`));
    expect(create.body.payment_source.paypal.experience_context.return_url).toMatch(new RegExp(`/checkouts/${token}/paypal/return$`));

    const back = await t.app.inject({ method: 'GET', url: `/checkouts/${token}/paypal/return?token=${sale.paymentId}&PayerID=P1` });
    expect(back.statusCode).toBe(303);
    expect(back.headers.location).toBe(`/checkouts/${token}/thank-you`);
    expect(await orderRow(order.id)).toMatchObject({ financialStatus: 'PAID' });
    const paid = (await txsOf(order.id)).find((x) => x.kind === 'SALE')!;
    expect(paid).toMatchObject({ status: 'SUCCESS', gateway: 'paypal', paymentId: expect.stringMatching(/^CAP\d+$/) });
    // Back again (reload, or the webhook got there first): nothing is captured twice.
    const captures = calls(/\/capture$/, 'POST').length;
    await t.app.inject({ method: 'GET', url: `/checkouts/${token}/paypal/return` });
    expect(calls(/\/capture$/, 'POST')).toHaveLength(captures);
    const ty = await t.app.inject({ method: 'GET', url: `/checkouts/${token}/thank-you` });
    expect(ty.body).toContain('PayPal');
    expect(ty.body).toContain('Paid');
  });

  it('a declined capture records a failure and keeps the order PENDING with a retry link', async () => {
    const { token, order, sale } = await placeOrder('paypal');
    pp.declineCapture = true;
    try {
      const back = await t.app.inject({ method: 'GET', url: `/checkouts/${token}/paypal/return` });
      expect(back.statusCode).toBe(422);
      expect(back.body).toMatch(/could not complete the payment/);
      expect(back.body).toContain(`/checkouts/${token}/paypal/retry`);
    } finally { pp.declineCapture = false; }
    expect((await orderRow(order.id)).financialStatus).toBe('PENDING');
    expect((await txsOf(order.id)).filter((x) => x.status === 'FAILURE' && x.paymentId === sale.paymentId)).toHaveLength(1);
    // The retry link goes back to the open PayPal order, and a second try can succeed.
    const retry = await t.app.inject({ method: 'GET', url: `/checkouts/${token}/paypal/retry` });
    expect(retry.headers.location).toBe(`https://www.sandbox.paypal.com/checkoutnow?token=${sale.paymentId}`);
    expect((await t.app.inject({ method: 'GET', url: `/checkouts/${token}/paypal/return` })).statusCode).toBe(303);
    expect((await orderRow(order.id)).financialStatus).toBe('PAID');
  });

  it('cancel return: back with a clear message, the order stays PENDING and is not shown as paid', async () => {
    const { token, order, sale } = await placeOrder('paypal');
    const r = await t.app.inject({ method: 'GET', url: `/checkouts/${token}/paypal/cancel?token=${sale.paymentId}` });
    expect(r.statusCode).toBe(200);
    expect(r.body).toMatch(/payment was not completed/);
    expect(r.body).toContain('Awaiting payment');
    expect(r.body).not.toMatch(/badge ok/);
    expect(r.body).toContain(`/checkouts/${token}/paypal/retry`);
    expect(await orderRow(order.id)).toMatchObject({ financialStatus: 'PENDING' });
    expect((await txsOf(order.id)).find((x) => x.kind === 'SALE')).toMatchObject({ status: 'PENDING' });
  });

  describe('authorize only', () => {
    beforeAll(async () => { await updateConfig(db(), (await getPrimaryShop(db()))!, 'PAYMENTS', { captureMethod: 'manual' }); });

    const authorized = async () => {
      const placed = await placeOrder('paypal');
      expect(calls('/v2/checkout/orders', 'POST').at(-1)!.body.intent).toBe('AUTHORIZE');
      await t.app.inject({ method: 'GET', url: `/checkouts/${placed.token}/paypal/return` });
      const order = await orderRow(placed.order.id);
      const auth = (await txsOf(order.id)).find((x) => x.kind === 'AUTHORIZATION')!;
      return { ...placed, order, auth };
    };
    const CAPTURE = `mutation($id: ID!, $parent: ID!, $amount: Money!) { orderCapture(input: { id: $id, parentTransactionId: $parent, amount: $amount }) { transaction { id } userErrors { message } } }`;
    const VOID = `mutation($id: ID!) { transactionVoid(parentTransactionId: $id) { transaction { kind } userErrors { code message } } }`;
    const REFUND = `mutation($input: RefundInput!) { refundCreate(input: $input) { refund { id } userErrors { message } } }`;

    it('authorizes on return, then captures from the admin and refunds that capture', async () => {
      const { order, auth } = await authorized();
      expect(order.financialStatus).toBe('AUTHORIZED');
      expect(auth).toMatchObject({ gateway: 'paypal', status: 'SUCCESS', paymentId: expect.stringMatching(/^AUTH\d+$/) });
      const r = (await g(CAPTURE, { id: gid('Order', order.id), parent: gid('OrderTransaction', auth.id), amount: (order.total / 100).toFixed(2) })).orderCapture;
      expect(r.userErrors).toEqual([]);
      const cap = calls(`/v2/payments/authorizations/${auth.paymentId}/capture`, 'POST');
      expect(cap).toHaveLength(1);
      expect(cap[0]!.headers['PayPal-Request-Id']).toBe(`capture-${auth.id}-${order.total}`);
      expect(await orderRow(order.id)).toMatchObject({ financialStatus: 'PAID' });
      const capture = (await txsOf(order.id)).find((x) => x.kind === 'CAPTURE')!;
      expect(capture.paymentId).toBe('CAPAUTH1'); // the capture id, needed for refunds
      const refund = (await g(REFUND, { input: { orderId: gid('Order', order.id), transactions: [{ amount: '2.00', gateway: 'paypal', kind: 'REFUND', orderId: gid('Order', order.id), parentId: gid('OrderTransaction', capture.id) }] } })).refundCreate;
      expect(refund.userErrors).toEqual([]);
      expect(calls('/v2/payments/captures/CAPAUTH1/refund', 'POST').at(-1)!.body.amount).toEqual({ currency_code: 'EUR', value: '2.00' });
    });

    it('voids the authorization at PayPal, and refuses (recording nothing) when PayPal refuses', async () => {
      const a = await authorized();
      pp.failVoid = true;
      try {
        const r = (await g(VOID, { id: gid('OrderTransaction', a.auth.id) })).transactionVoid;
        expect(r.userErrors[0]).toMatchObject({ code: 'GENERIC_ERROR' });
      } finally { pp.failVoid = false; }
      expect(await orderRow(a.order.id)).toMatchObject({ financialStatus: 'AUTHORIZED' });
      expect((await g(VOID, { id: gid('OrderTransaction', a.auth.id) })).transactionVoid.userErrors).toEqual([]);
      expect(calls(`/v2/payments/authorizations/${a.auth.paymentId}/void`, 'POST').length).toBeGreaterThan(0);
      expect(await orderRow(a.order.id)).toMatchObject({ financialStatus: 'VOIDED' });
    });

    it('orderCancel releases the authorization at PayPal', async () => {
      const a = await authorized();
      const before = calls('/void', 'POST').length;
      const r = await g(`mutation($id: ID!) { orderCancel(orderId: $id, reason: OTHER, refund: false, restock: false) { orderCancelUserErrors { message } } }`, { id: gid('Order', a.order.id) });
      expect(r.orderCancel.orderCancelUserErrors).toEqual([]);
      expect(calls('/void', 'POST')).toHaveLength(before + 1);
      expect(await orderRow(a.order.id)).toMatchObject({ financialStatus: 'VOIDED' });
    });

    afterAll(async () => { await updateConfig(db(), (await getPrimaryShop(db()))!, 'PAYMENTS', { captureMethod: 'automatic' }); });
  });

  describe('webhooks', () => {
    const REFUND = `mutation($input: RefundInput!) { refundCreate(input: $input) { refund { id } userErrors { message } } }`;
    const post = (event: Record<string, unknown>, sig = 'valid') => t.app.inject({
      method: 'POST', url: '/webhooks/paypal', payload: JSON.stringify({ id: `WH-EVT-${Math.random()}`, ...event }),
      headers: { 'content-type': 'application/json', 'paypal-auth-algo': 'SHA256withRSA', 'paypal-cert-url': 'https://api.paypal.com/cert.pem', 'paypal-transmission-id': 'tid', 'paypal-transmission-sig': sig, 'paypal-transmission-time': '2026-11-14T10:00:00Z' },
    });

    it('rejects an unverified event and changes nothing', async () => {
      const { order, sale } = await placeOrder('paypal');
      const r = await post({ event_type: 'CHECKOUT.ORDER.APPROVED', resource: { id: sale.paymentId, intent: 'CAPTURE' } }, 'forged');
      expect(r.statusCode).toBe(400);
      expect((await t.app.inject({ method: 'POST', url: '/webhooks/paypal', payload: '{}', headers: { 'content-type': 'application/json' } })).statusCode).toBe(400);
      expect(await orderRow(order.id)).toMatchObject({ financialStatus: 'PENDING' });
    });

    it('order approved captures it when the buyer never came back; the capture event and duplicates do nothing more', async () => {
      emails.length = 0;
      const { order, sale } = await placeOrder('paypal');
      const approved = { event_type: 'CHECKOUT.ORDER.APPROVED', resource: { id: sale.paymentId, intent: 'CAPTURE', status: 'APPROVED' } };
      expect((await post(approved)).statusCode).toBe(200);
      expect(await orderRow(order.id)).toMatchObject({ financialStatus: 'PAID' });
      const capId = (await txsOf(order.id)).find((x) => x.kind === 'SALE')!.paymentId!;
      expect(capId).toMatch(/^CAP/);
      const captures = calls(/\/capture$/, 'POST').length;
      expect((await post(approved)).statusCode).toBe(200);
      expect((await post({ event_type: 'PAYMENT.CAPTURE.COMPLETED', resource: { id: capId, status: 'COMPLETED', supplementary_data: { related_ids: { order_id: sale.paymentId } } } })).statusCode).toBe(200);
      expect(calls(/\/capture$/, 'POST')).toHaveLength(captures);
      expect((await txsOf(order.id)).filter((x) => x.kind === 'SALE')).toHaveLength(1);
      expect((await db().select().from(s.events).where(eq(s.events.subjectId, order.id))).filter((e) => e.verb === 'order.paid')).toHaveLength(1);
      // The return page arriving afterwards is a no-op too.
      await t.app.inject({ method: 'GET', url: `/checkouts/${order.cartToken}/paypal/return` });
      expect(calls(/\/capture$/, 'POST')).toHaveLength(captures);
    });

    it('capture completed alone marks the order paid; denied records one failure', async () => {
      const a = await placeOrder('paypal');
      expect((await post({ event_type: 'PAYMENT.CAPTURE.COMPLETED', resource: { id: 'CAPX1', supplementary_data: { related_ids: { order_id: a.sale.paymentId } } } })).statusCode).toBe(200);
      expect(await orderRow(a.order.id)).toMatchObject({ financialStatus: 'PAID' });
      expect((await txsOf(a.order.id)).find((x) => x.kind === 'SALE')!.paymentId).toBe('CAPX1');

      const b = await placeOrder('paypal');
      const denied = { event_type: 'PAYMENT.CAPTURE.DENIED', resource: { id: 'CAPDEN1', supplementary_data: { related_ids: { order_id: b.sale.paymentId } } } };
      expect((await post(denied)).statusCode).toBe(200);
      expect((await post(denied)).statusCode).toBe(200);
      expect((await txsOf(b.order.id)).filter((x) => x.status === 'FAILURE')).toHaveLength(1);
      expect(await orderRow(b.order.id)).toMatchObject({ financialStatus: 'PENDING' });
    });

    it('mirrors a refund made in PayPal once and ignores the ones ShopMe made', async () => {
      const a = await placeOrder('paypal');
      await t.app.inject({ method: 'GET', url: `/checkouts/${a.token}/paypal/return` });
      const sale = (await txsOf(a.order.id)).find((x) => x.kind === 'SALE')!;
      const refundEvent = (id: string, value: string) => ({ event_type: 'PAYMENT.CAPTURE.REFUNDED', resource: { id, status: 'COMPLETED', amount: { currency_code: 'EUR', value }, links: [{ rel: 'up', href: `https://api.sandbox.paypal.com/v2/payments/captures/${sale.paymentId}` }] } });
      expect((await post(refundEvent('REFDASH1', '3.00'))).statusCode).toBe(200);
      expect((await post(refundEvent('REFDASH1', '3.00'))).statusCode).toBe(200);
      let refunds = (await txsOf(a.order.id)).filter((x) => x.kind === 'REFUND');
      expect(refunds).toHaveLength(1);
      expect(refunds[0]).toMatchObject({ gateway: 'paypal', amount: 300, paymentId: 'REFDASH1' });
      expect(await orderRow(a.order.id)).toMatchObject({ financialStatus: 'PARTIALLY_REFUNDED', totalRefunded: 300 });
      // A refund made from ShopMe, then its own webhook: still one record for it.
      const mine = (await g(REFUND, { input: { orderId: gid('Order', a.order.id), transactions: [{ amount: '1.00', gateway: 'paypal', kind: 'REFUND', orderId: gid('Order', a.order.id), parentId: gid('OrderTransaction', sale.id) }] } })).refundCreate;
      expect(mine.userErrors).toEqual([]);
      refunds = (await txsOf(a.order.id)).filter((x) => x.kind === 'REFUND');
      const own = refunds.find((x) => x.paymentId !== 'REFDASH1')!;
      expect(own.paymentId).toMatch(/^REF\d+$/);
      expect((await post(refundEvent(own.paymentId!, '1.00'))).statusCode).toBe(200);
      expect((await txsOf(a.order.id)).filter((x) => x.kind === 'REFUND')).toHaveLength(2);
    });

    it('admin refund: success moves money at PayPal, a provider failure records nothing', async () => {
      const a = await placeOrder('paypal');
      await t.app.inject({ method: 'GET', url: `/checkouts/${a.token}/paypal/return` });
      const sale = (await txsOf(a.order.id)).find((x) => x.kind === 'SALE')!;
      const input = (amount: string) => ({ orderId: gid('Order', a.order.id), transactions: [{ amount, gateway: 'paypal', kind: 'REFUND', orderId: gid('Order', a.order.id), parentId: gid('OrderTransaction', sale.id) }] });
      pp.failRefund = true;
      try {
        const bad = (await g(REFUND, { input: input('2.00') })).refundCreate;
        expect(bad.refund).toBeNull();
        expect(bad.userErrors[0].message).toMatch(/payment provider refused the refund: .*already been fully refunded/);
      } finally { pp.failRefund = false; }
      expect((await txsOf(a.order.id)).filter((x) => x.kind === 'REFUND')).toHaveLength(0);
      expect(await orderRow(a.order.id)).toMatchObject({ financialStatus: 'PAID', totalRefunded: 0 });
      expect((await g(REFUND, { input: input('2.00') })).refundCreate.userErrors).toEqual([]);
      const call = calls(`/v2/payments/captures/${sale.paymentId}/refund`, 'POST').at(-1)!;
      expect(call.body.amount).toEqual({ currency_code: 'EUR', value: '2.00' });
      expect(call.headers['PayPal-Request-Id']).toBe(`refund-${sale.id}-0-200`);
      expect((await txsOf(a.order.id)).find((x) => x.kind === 'REFUND')).toMatchObject({ status: 'SUCCESS', amount: 200, paymentId: expect.stringMatching(/^REF\d+$/) });
    });
  });
});

describe('Mollie checkout', () => {
  beforeAll(async () => { await saveMollie(); await enable({ mollie: { enabled: true } }); });
  const hook = (id: string, host?: string) => t.app.inject({ method: 'POST', url: '/webhooks/mollie', payload: `id=${id}`, headers: { 'content-type': 'application/x-www-form-urlencoded', ...(host ? { host } : {}) } });
  const REFUND = `mutation($input: RefundInput!) { refundCreate(input: $input) { refund { id } userErrors { message } } }`;

  it('pay, webhook says paid, order PAID; duplicates do nothing; the return page reads the state', async () => {
    emails.length = 0;
    const { token, order, redirectUrl, sale } = await placeOrder('mollie');
    expect(redirectUrl).toBe(`https://www.mollie.com/checkout/${sale.paymentId}`);
    expect(order.financialStatus).toBe('PENDING');
    expect(sale).toMatchObject({ gateway: 'mollie', status: 'PENDING', paymentId: expect.stringMatching(/^tr_\d+$/) });
    const create = calls('/v2/payments', 'POST').at(-1)!;
    expect(create.body).toMatchObject({ metadata: { orderId: token, shopId: String(shopId) }, captureMode: 'automatic', redirectUrl: expect.stringMatching(new RegExp(`/checkouts/${token}/mollie/return$`)) });
    expect(create.body.webhookUrl).toBeUndefined(); // a local server has no URL Mollie could call
    expect(create.headers['Idempotency-Key']).toMatch(new RegExp(`^mollie-${token}-`));

    // Back from Mollie while still open: honest pending page.
    const pending = await t.app.inject({ method: 'GET', url: `/checkouts/${token}/mollie/return` });
    expect(pending.statusCode).toBe(303);
    const page = await t.app.inject({ method: 'GET', url: `/checkouts/${token}/thank-you` });
    expect(page.body).toContain('Your payment is being processed');
    expect(page.body).toContain('Awaiting payment');
    expect((await orderRow(order.id)).financialStatus).toBe('PENDING');

    mollie.payments.get(sale.paymentId!)!.status = 'paid';
    expect((await hook(sale.paymentId!)).statusCode).toBe(200);
    expect(await orderRow(order.id)).toMatchObject({ financialStatus: 'PAID' });
    expect((await hook(sale.paymentId!)).statusCode).toBe(200);
    expect((await txsOf(order.id)).filter((x) => x.kind === 'SALE')).toHaveLength(1);
    expect((await db().select().from(s.events).where(eq(s.events.subjectId, order.id))).filter((e) => e.verb === 'order.paid')).toHaveLength(1);
    expect((await t.app.inject({ method: 'GET', url: `/checkouts/${token}/thank-you` })).body).toContain('Paid');
  });

  it('passes a webhook URL when the server is public, and answers bad webhook bodies', async () => {
    const restore = setAppUrl('https://shop.example.com');
    try {
      const { sale: _s } = await placeOrder('mollie');
      expect(calls('/v2/payments', 'POST').at(-1)!.body.webhookUrl).toMatch(/^https:\/\/shop\.example\.com\/webhooks\/mollie/);
    } finally { restore(); }
    expect((await t.app.inject({ method: 'POST', url: '/webhooks/mollie', payload: 'id=nope', headers: { 'content-type': 'application/x-www-form-urlencoded' } })).statusCode).toBe(400);
    expect((await hook('tr_unknown999')).statusCode).toBe(200); // not a payment of this account: nothing to retry
  });

  it.each([['failed', 'failed'], ['expired', 'failed'], ['canceled', 'canceled']])('%s payment: one failure recorded, order stays PENDING', async (status) => {
    const { order, sale } = await placeOrder('mollie');
    mollie.payments.get(sale.paymentId!)!.status = status;
    expect((await hook(sale.paymentId!)).statusCode).toBe(200);
    expect((await hook(sale.paymentId!)).statusCode).toBe(200);
    const failures = (await txsOf(order.id)).filter((x) => x.status === 'FAILURE');
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatchObject({ gateway: 'mollie', paymentId: sale.paymentId });
    expect(await orderRow(order.id)).toMatchObject({ financialStatus: 'PENDING' });
  });

  it('the return page shows a canceled payment as not completed', async () => {
    const { token, sale } = await placeOrder('mollie');
    mollie.payments.get(sale.paymentId!)!.status = 'canceled';
    const r = await t.app.inject({ method: 'GET', url: `/checkouts/${token}/mollie/return` });
    expect(r.statusCode).toBe(200);
    expect(r.body).toMatch(/payment was not completed/);
  });

  it('mirrors a refund made in the Mollie dashboard once, and does not double count ShopMe\'s own', async () => {
    const { order, sale } = await placeOrder('mollie');
    const payment = mollie.payments.get(sale.paymentId!)!;
    payment.status = 'paid';
    await hook(sale.paymentId!);
    payment.refunded = 300; // dashboard refund of 3.00
    await hook(sale.paymentId!);
    await hook(sale.paymentId!);
    let refunds = (await txsOf(order.id)).filter((x) => x.kind === 'REFUND');
    expect(refunds).toHaveLength(1);
    expect(refunds[0]).toMatchObject({ gateway: 'mollie', status: 'SUCCESS', amount: 300 });
    expect(await orderRow(order.id)).toMatchObject({ financialStatus: 'PARTIALLY_REFUNDED', totalRefunded: 300 });
    // A second dashboard refund only adds the difference.
    payment.refunded = 500;
    await hook(sale.paymentId!);
    await hook(sale.paymentId!);
    refunds = (await txsOf(order.id)).filter((x) => x.kind === 'REFUND');
    expect(refunds.map((x) => x.amount).sort()).toEqual([200, 300]);
    // A refund from ShopMe, then Mollie's webhook for it: not recorded twice.
    const mine = (await g(REFUND, { input: { orderId: gid('Order', order.id), transactions: [{ amount: '1.00', gateway: 'mollie', kind: 'REFUND', orderId: gid('Order', order.id), parentId: gid('OrderTransaction', sale.id) }] } })).refundCreate;
    expect(mine.userErrors).toEqual([]);
    await hook(sale.paymentId!);
    expect((await txsOf(order.id)).filter((x) => x.kind === 'REFUND')).toHaveLength(3);
    expect(await orderRow(order.id)).toMatchObject({ totalRefunded: 600 });
  });

  it('admin refund: success creates the Mollie refund and stores its id, a provider failure records nothing', async () => {
    const { order, sale } = await placeOrder('mollie');
    mollie.payments.get(sale.paymentId!)!.status = 'paid';
    await hook(sale.paymentId!);
    const input = (amount: string) => ({ orderId: gid('Order', order.id), transactions: [{ amount, gateway: 'mollie', kind: 'REFUND', orderId: gid('Order', order.id), parentId: gid('OrderTransaction', sale.id) }] });
    mollie.failRefund = true;
    try {
      const bad = (await g(REFUND, { input: input('2.00') })).refundCreate;
      expect(bad.refund).toBeNull();
      expect(bad.userErrors[0].message).toMatch(/payment provider refused the refund: .*maximum refundable amount/);
    } finally { mollie.failRefund = false; }
    expect((await txsOf(order.id)).filter((x) => x.kind === 'REFUND')).toHaveLength(0);
    expect((await g(REFUND, { input: input('2.00') })).refundCreate.userErrors).toEqual([]);
    const call = calls(`/v2/payments/${sale.paymentId}/refunds`, 'POST').at(-1)!;
    expect(call.body.amount).toEqual({ currency: 'EUR', value: '2.00' });
    expect(call.headers['Idempotency-Key']).toBe(`refund-${sale.id}-0-200`);
    expect((await txsOf(order.id)).find((x) => x.kind === 'REFUND')).toMatchObject({ status: 'SUCCESS', amount: 200, paymentId: expect.stringMatching(/^re_\d+$/), parentId: sale.id });
  });
});
