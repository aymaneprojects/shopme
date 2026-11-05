import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import {
  createLocalStorage, getPrimaryShop, LOGIN_CODE_MAX_ATTEMPTS, LOGIN_CODE_RESEND_MS, LOGIN_CODE_TTL_MS, requestLoginCode, schema as s, seedDemo, verifyLoginCode,
  type Mail,
} from '@shopme/core';
import { createTestApp, SETUP_BODY, type TestApp } from './test-utils';
import { makeGql, makeGqlOk } from '../test/conformance/helpers';

let t: TestApp;
let g: ReturnType<typeof makeGqlOk>;
let shopId: number;
let sent: Mail[];
const sku: Record<string, number> = {};
const db = () => t.dbHandle.db;
const form = (o: Record<string, string>) => ({ payload: new URLSearchParams(o).toString(), headers: { 'content-type': 'application/x-www-form-urlencoded' } });
const accounts = (input: string) => g(`mutation { shopmeCustomerAccountsSettingsUpdate(input: { ${input} }) { settings { mode loginLinksVisible signIn { password emailCode } orderActions { reorder returns cancellations cancellationWindowHours } storeCredit accountUrl } userErrors { field message } } }`);

beforeAll(async () => {
  t = await createTestApp();
  const setup = await t.app.inject({ method: 'POST', url: '/admin/api/setup', payload: SETUP_BODY });
  const cookie = setup.cookies.find((c) => c.name === 'shopme_session')!.value;
  g = makeGqlOk(makeGql(t.app, cookie));
  await seedDemo(db(), createLocalStorage(mkdtempSync(path.join(tmpdir(), 'acc-'))));
  shopId = (await getPrimaryShop(db()))!.id;
  for (const v of await db().select().from(s.productVariants)) if (v.sku) sku[v.sku] = v.id;
  sent = [];
  t.app.ctx.mailer = { send: async (m) => { sent.push(m); } };
}, 90_000);
afterAll(async () => { await t.close(); });

describe('accounts mode', () => {
  it('has one source of truth shared with the checkout settings page', async () => {
    const read = () => g('{ shopmeCustomerAccountsSettings { mode } shopmeCheckoutSettings { accountMode } shop { customerAccounts customerAccountsV2 { loginRequiredAtCheckout loginLinksVisibleOnStorefrontAndCheckout customerAccountsVersion url } } }');
    expect((await read()).shopmeCustomerAccountsSettings.mode).toBe('OPTIONAL');
    await accounts('mode: REQUIRED');
    let r = await read();
    expect(r.shopmeCheckoutSettings.accountMode).toBe('required');
    expect(r.shop.customerAccountsV2).toMatchObject({ loginRequiredAtCheckout: true, loginLinksVisibleOnStorefrontAndCheckout: true, customerAccountsVersion: 'NEW_CUSTOMER_ACCOUNTS' });
    expect(r.shop.customerAccounts).toBe('REQUIRED');
    await g('mutation { shopmeCheckoutSettingsUpdate(input: { accountMode: guest }) { settings { accountMode } userErrors { message } } }');
    r = await read();
    expect(r.shopmeCustomerAccountsSettings.mode).toBe('OPTIONAL');
    await g('mutation { shopmeCheckoutSettingsUpdate(input: { accountMode: required }) { settings { accountMode } userErrors { message } } }');
    expect((await read()).shopmeCustomerAccountsSettings.mode).toBe('REQUIRED');
    await accounts('mode: OPTIONAL');
  });

  it('requires a sign-in at checkout in REQUIRED mode, then returns to it', async () => {
    const add = await t.app.inject({ method: 'POST', url: '/cart/add.js', payload: { id: sku['HEB-250'], quantity: 1 } });
    const cart = add.cookies.find((c) => c.name === 'cart')!.value;
    const token = (await t.app.inject({ method: 'POST', url: '/checkout', cookies: { cart } })).headers.location!.toString().split('/').pop()!;
    expect((await t.app.inject(`/checkouts/${token}`)).statusCode).toBe(200); // optional: guests may enter
    await accounts('mode: REQUIRED');
    const blocked = await t.app.inject(`/checkouts/${token}`);
    expect(blocked.statusCode).toBe(303);
    expect(blocked.headers.location).toBe(`/account/login?return_url=${encodeURIComponent(`/checkouts/${token}`)}`);
    const post = await t.app.inject({ method: 'POST', url: `/checkouts/${token}/complete`, ...form({ email: 'a@example.com', paymentMethod: 'bank_transfer' }) });
    expect(post.statusCode).toBe(303);
    expect(String(post.headers.location)).toContain('/account/login');
    // signed in: the checkout opens again and shows who is signed in
    const reg = await t.app.inject({ method: 'POST', url: '/account/register', ...form({ 'customer[email]': 'req@example.com', 'customer[password]': 'correct horse' }) });
    const session = reg.cookies.find((c) => c.name === 'shopme_customer')!.value;
    const open = await t.app.inject({ url: `/checkouts/${token}`, cookies: { shopme_customer: session } });
    expect(open.statusCode).toBe(200);
    expect(open.body).toContain('req@example.com');
    await accounts('mode: OPTIONAL');
  });

  it('shows the sign-in link at checkout for guests only while links are on', async () => {
    const add = await t.app.inject({ method: 'POST', url: '/cart/add.js', payload: { id: sku['HEB-250'], quantity: 1 } });
    const cart = add.cookies.find((c) => c.name === 'cart')!.value;
    const token = (await t.app.inject({ method: 'POST', url: '/checkout', cookies: { cart } })).headers.location!.toString().split('/').pop()!;
    expect((await t.app.inject(`/checkouts/${token}`)).body).toContain('/account/login?return_url=');
    await accounts('loginLinksVisible: false');
    expect((await t.app.inject(`/checkouts/${token}`)).body).not.toContain('/account/login?return_url=');
    await accounts('loginLinksVisible: true');
  });

  it('removes the account pages and the header link when accounts are off', async () => {
    expect((await t.app.inject('/')).body).toContain('href="/account"');
    await accounts('mode: DISABLED');
    for (const url of ['/account', '/account/login', '/account/register']) expect((await t.app.inject(url)).statusCode, url).toBe(404);
    expect((await t.app.inject({ method: 'POST', url: '/account/login', ...form({ 'customer[email]': 'a@b.co', 'customer[password]': 'x' }) })).statusCode).toBe(404);
    const home = await t.app.inject('/');
    expect(home.body).not.toContain('href="/account"');
    // checkout stays guest-only even if the legacy "required" option was on
    const add = await t.app.inject({ method: 'POST', url: '/cart/add.js', payload: { id: sku['HEB-250'], quantity: 1 } });
    const cart = add.cookies.find((c) => c.name === 'cart')!.value;
    const token = (await t.app.inject({ method: 'POST', url: '/checkout', cookies: { cart } })).headers.location!.toString().split('/').pop()!;
    expect((await t.app.inject(`/checkouts/${token}`)).statusCode).toBe(200);
    await accounts('mode: OPTIONAL');
    expect((await t.app.inject('/account/login')).statusCode).toBe(200);
  });

  it('hides the sign-in links from themes but keeps the pages', async () => {
    await accounts('loginLinksVisible: false');
    const home = (await t.app.inject('/')).body;
    expect(home).not.toContain('href="/account"');
    expect((await t.app.inject('/account/login')).statusCode).toBe(200);
    await accounts('loginLinksVisible: true');
    expect((await t.app.inject('/')).body).toContain('href="/account"');
  });

  it('validates the settings and offers a custom account URL', async () => {
    const none = await accounts('signIn: { password: false, emailCode: false }');
    expect(none.shopmeCustomerAccountsSettingsUpdate.userErrors[0].message).toMatch(/at least one/);
    const window = await accounts('orderActions: { cancellationWindowHours: 0 }');
    expect(window.shopmeCustomerAccountsSettingsUpdate.userErrors).toHaveLength(1);
    const url = await accounts('url: "https://account.example.com"');
    expect(url.shopmeCustomerAccountsSettingsUpdate.settings.accountUrl).toBe('https://account.example.com');
    expect((await accounts('url: "ftp://nope"')).shopmeCustomerAccountsSettingsUpdate.userErrors).toHaveLength(1);
    await accounts('url: ""');
  });
});

describe('email code sign-in', () => {
  it('issues 6-digit codes that expire, lock after five wrong tries and cannot be resent too fast', async () => {
    const now = new Date();
    const email = 'code-rules@example.com';
    const first = await requestLoginCode(db(), shopId, email, now);
    if (!first.ok) throw new Error('code not issued');
    expect(first.code).toMatch(/^\d{6}$/);
    expect(await requestLoginCode(db(), shopId, email, new Date(now.getTime() + 5000))).toEqual({ ok: false, reason: 'too_soon' });
    expect(await requestLoginCode(db(), shopId, 'nope', now)).toEqual({ ok: false, reason: 'invalid_email' });
    const second = await requestLoginCode(db(), shopId, email, new Date(now.getTime() + LOGIN_CODE_RESEND_MS + 1));
    if (!second.ok) throw new Error('second code not issued');
    expect(await verifyLoginCode(db(), shopId, email, first.code, new Date(now.getTime() + LOGIN_CODE_RESEND_MS + 2))).toMatchObject({ ok: first.code === second.code }); // the first code stopped working
    // wrong guesses: the fifth locks the code even when the right one follows
    const wrong = second.code === '000000' ? '111111' : '000000';
    const at = new Date(now.getTime() + LOGIN_CODE_RESEND_MS + 3);
    for (let i = 0; i < LOGIN_CODE_MAX_ATTEMPTS; i++) expect((await verifyLoginCode(db(), shopId, email, wrong, at)).ok).toBe(false);
    expect(await verifyLoginCode(db(), shopId, email, second.code, at)).toMatchObject({ ok: false });
    // expiry
    const third = await requestLoginCode(db(), shopId, email, new Date(now.getTime() + 10 * 60_000));
    if (!third.ok) throw new Error('third code not issued');
    expect(await verifyLoginCode(db(), shopId, email, third.code, new Date(now.getTime() + 10 * 60_000 + LOGIN_CODE_TTL_MS + 1))).toEqual({ ok: false, reason: 'expired' });
  });

  it('creates or finds the customer, marks the email verified and burns the code', async () => {
    const email = 'code-user@example.com';
    const r = await requestLoginCode(db(), shopId, email);
    if (!r.ok) throw new Error('no code');
    const ok = await verifyLoginCode(db(), shopId, email, r.code);
    expect(ok.ok && ok.customer).toMatchObject({ email, verifiedEmail: true, state: 'ENABLED' });
    expect(await verifyLoginCode(db(), shopId, email, r.code)).toMatchObject({ ok: false }); // used
    const again = await requestLoginCode(db(), shopId, email, new Date(Date.now() + 60_000));
    if (!again.ok) throw new Error('no code');
    const same = await verifyLoginCode(db(), shopId, email, again.code, new Date(Date.now() + 61_000));
    expect(same.ok && same.customer.id).toBe(ok.ok && ok.customer.id);
    expect((await db().select().from(s.customers).where(eq(s.customers.email, email)))).toHaveLength(1);
  });

  it('works through the storefront: code mail, sign-in, rate limits, and the method switches', async () => {
    // off by default: the routes do not exist
    expect((await t.app.inject({ method: 'POST', url: '/account/login/code', ...form({ 'customer[email]': 'web@example.com' }) })).statusCode).toBe(404);
    expect((await t.app.inject('/account/login')).body).not.toContain('customer_login_code');
    await accounts('signIn: { emailCode: true }');
    expect((await t.app.inject('/account/login')).body).toContain('/account/login/code');
    sent.length = 0;
    const ask = await t.app.inject({ method: 'POST', url: '/account/login/code', ...form({ 'customer[email]': 'Web@Example.com', return_url: '/account/orders' }) });
    expect(ask.statusCode).toBe(303);
    expect(ask.headers.location).toContain('step=code');
    await t.app.ctx.queue.idle();
    const mail = sent.find((m) => m.to === 'web@example.com')!;
    const code = /\b(\d{6})\b/.exec(mail.text)![1]!;
    const step = await t.app.inject({ url: String(ask.headers.location) });
    expect(step.body).toContain('autocomplete="one-time-code"');
    const wrong = await t.app.inject({ method: 'POST', url: '/account/login/code/verify', ...form({ 'customer[email]': 'web@example.com', 'customer[code]': code === '123456' ? '654321' : '123456' }) });
    expect(wrong.statusCode).toBe(303);
    expect(wrong.cookies.find((c) => c.name === 'shopme_customer')).toBeUndefined();
    const good = await t.app.inject({ method: 'POST', url: '/account/login/code/verify', ...form({ 'customer[email]': 'web@example.com', 'customer[code]': code, return_url: '/account/orders' }) });
    expect(good.statusCode).toBe(303);
    expect(good.headers.location).toBe('/account/orders');
    const session = good.cookies.find((c) => c.name === 'shopme_customer')!.value;
    expect((await t.app.inject({ url: '/account', cookies: { shopme_customer: session } })).statusCode).toBe(200);

    // passwords can be turned off: only the code works
    await accounts('signIn: { password: false }');
    const reg = await t.app.inject({ method: 'POST', url: '/account/register', ...form({ 'customer[email]': 'pw@example.com', 'customer[password]': 'correct horse' }) });
    expect(reg.statusCode).toBe(303);
    const pw = await t.app.inject({ method: 'POST', url: '/account/login', ...form({ 'customer[email]': 'pw@example.com', 'customer[password]': 'correct horse' }) });
    expect(pw.cookies.find((c) => c.name === 'shopme_customer')).toBeUndefined();
    expect((await t.app.inject('/account/login')).body).not.toContain('name="customer[password]"');
    await accounts('signIn: { password: true, emailCode: false }');
  });

  it('limits how many codes one address can ask for', async () => {
    await accounts('signIn: { emailCode: true }');
    let last = 0;
    for (let i = 0; i < 7; i++) last = (await t.app.inject({ method: 'POST', url: '/account/login/code', ...form({ 'customer[email]': 'flood@example.com' }) })).statusCode;
    expect(last).toBe(303);
    const res = await t.app.inject({ method: 'POST', url: '/account/login/code', ...form({ 'customer[email]': 'flood@example.com' }) });
    expect(res.headers.location).toContain('/account/login');
    expect((await t.app.inject({ url: String(res.headers.location), cookies: Object.fromEntries(res.cookies.map((c) => [c.name, c.value])) })).body).toMatch(/Too many attempts|rate/i);
    await accounts('signIn: { password: true, emailCode: false }');
  });
});

describe('order actions in the customer account', () => {
  async function order(email: string) {
    const reg = await t.app.inject({ method: 'POST', url: '/account/register', ...form({ 'customer[email]': email, 'customer[password]': 'correct horse' }) });
    const session = reg.cookies.find((c) => c.name === 'shopme_customer')!.value;
    const add = await t.app.inject({ method: 'POST', url: '/cart/add.js', payload: { id: sku['HEB-250'], quantity: 2 } });
    const cart = add.cookies.find((c) => c.name === 'cart')!.value;
    const token = (await t.app.inject({ method: 'POST', url: '/checkout', cookies: { cart } })).headers.location!.toString().split('/').pop()!;
    const done = await t.app.inject({
      method: 'POST', url: `/checkouts/${token}/complete`, cookies: { shopme_customer: session },
      ...form({ email, firstName: 'A', lastName: 'B', address1: '1 rue', city: 'Paris', zip: '75001', countryCode: 'FR', paymentMethod: 'bank_transfer' }),
    });
    expect(done.statusCode).toBe(303);
    const [o] = await db().select().from(s.orders).where(eq(s.orders.cartToken, token));
    return { session, order: o! };
  }
  const get = (url: string, session: string) => t.app.inject({ url, cookies: { shopme_customer: session } });
  const act = (url: string, session: string, body: Record<string, string> = {}) => t.app.inject({ method: 'POST', url, cookies: { shopme_customer: session }, ...form(body) });
  const stock = async () => (await db().select().from(s.inventoryLevels)).reduce((n, l) => n + l.available, 0);

  it('shows buy again by default and the other actions only when switched on', async () => {
    const { session, order: o } = await order('actions@example.com');
    let page = (await get(`/account/orders/${o.id}`, session)).body;
    expect(page).toContain(`/account/orders/${o.id}/reorder`);
    expect(page).not.toContain(`/account/orders/${o.id}/cancel`);
    expect(page).not.toContain(`/account/orders/${o.id}/return`);
    // cancel is refused while switched off
    expect((await act(`/account/orders/${o.id}/cancel`, session)).headers.location).toContain('notice=cancel_failed');
    await accounts('orderActions: { cancellations: true, returns: true, cancellationWindowHours: 24 }');
    page = (await get(`/account/orders/${o.id}`, session)).body;
    expect(page).toContain(`/account/orders/${o.id}/cancel`);
    expect(page).not.toContain(`/account/orders/${o.id}/return`); // nothing fulfilled yet
    await accounts('orderActions: { cancellations: false, returns: false }');
  });

  it('lets the customer cancel an unfulfilled order inside the window, restocking it, and never outside', async () => {
    await accounts('orderActions: { cancellations: true, cancellationWindowHours: 24 }');
    const { session, order: o } = await order('cancel-me@example.com');
    const before = await stock();
    const done = await act(`/account/orders/${o.id}/cancel`, session);
    expect(done.headers.location).toBe(`/account/orders/${o.id}?notice=cancel_ok`);
    const [row] = await db().select().from(s.orders).where(eq(s.orders.id, o.id));
    expect(row!.cancelledAt).not.toBeNull();
    expect(row!.cancelReason).toBe('CUSTOMER');
    expect(await stock()).toBe(before + 2);
    expect((await get(`/account/orders/${o.id}?notice=cancel_ok`, session)).body).toContain('Your order was cancelled');

    const late = await order('too-late@example.com');
    await db().update(s.orders).set({ processedAt: new Date(Date.now() - 3 * 24 * 3600 * 1000) }).where(eq(s.orders.id, late.order.id));
    expect((await get(`/account/orders/${late.order.id}`, late.session)).body).not.toContain('/cancel');
    expect((await act(`/account/orders/${late.order.id}/cancel`, late.session)).headers.location).toContain('cancel_failed');
    // another customer's order is not theirs to cancel
    const other = await order('other@example.com');
    expect((await act(`/account/orders/${other.order.id}/cancel`, late.session)).statusCode).toBe(404);

    const fulfilled = await order('fulfilled@example.com');
    await db().update(s.orderLines).set({ fulfilledQuantity: 2 }).where(eq(s.orderLines.orderId, fulfilled.order.id));
    await db().update(s.orders).set({ fulfillmentStatus: 'FULFILLED' }).where(eq(s.orders.id, fulfilled.order.id));
    expect((await act(`/account/orders/${fulfilled.order.id}/cancel`, fulfilled.session)).headers.location).toContain('cancel_failed');
    await accounts('orderActions: { cancellations: false }');
  });

  it('creates a return request for fulfilled items that staff then approve', async () => {
    await accounts('orderActions: { returns: true }');
    const { session, order: o } = await order('returns@example.com');
    await db().update(s.orderLines).set({ fulfilledQuantity: 2 }).where(eq(s.orderLines.orderId, o.id));
    await db().update(s.orders).set({ fulfillmentStatus: 'FULFILLED' }).where(eq(s.orders.id, o.id));
    const page = (await get(`/account/orders/${o.id}`, session)).body;
    expect(page).toContain(`/account/orders/${o.id}/return`);
    const [line] = await db().select().from(s.orderLines).where(eq(s.orderLines.orderId, o.id));
    const none = await act(`/account/orders/${o.id}/return`, session, { [`return[${line!.id}]`]: '0' });
    expect(none.headers.location).toContain('return_failed');
    const made = await act(`/account/orders/${o.id}/return`, session, { [`return[${line!.id}]`]: '1', note: 'Too small' });
    expect(made.headers.location).toContain('return_ok');
    const [r] = await db().select().from(s.returns).where(eq(s.returns.orderId, o.id));
    expect(r).toMatchObject({ status: 'REQUESTED' });
    const tooMany = await act(`/account/orders/${o.id}/return`, session, { [`return[${line!.id}]`]: '5' });
    expect(tooMany.headers.location).toContain('return_failed');
    await accounts('orderActions: { returns: false }');
  });

  it('puts the lines of an order back in the cart (buy again)', async () => {
    const { session, order: o } = await order('again@example.com');
    const res = await act(`/account/orders/${o.id}/reorder`, session);
    expect(res.headers.location).toBe('/cart');
    const cart = res.cookies.find((c) => c.name === 'cart')!.value;
    const json = (await t.app.inject({ url: '/cart.js', cookies: { cart } })).json() as { items: Array<{ variant_id: number; quantity: number }> };
    expect(json.items).toEqual([expect.objectContaining({ variant_id: sku['HEB-250'], quantity: 2 })]);
    await accounts('orderActions: { reorder: false }');
    expect((await act(`/account/orders/${o.id}/reorder`, session)).headers.location).toBe(`/account/orders/${o.id}`);
    await accounts('orderActions: { reorder: true }');
  });
});

describe('account invites', () => {
  it('generates an activation link and sends the invite email', async () => {
    const [c] = await db().insert(s.customers).values({ shopId, email: 'invitee@example.com', firstName: 'Ivy' }).returning();
    const id = `gid://shopify/Customer/${c!.id}`;
    const gen = await g(`mutation { customerGenerateAccountActivationUrl(customerId: "${id}") { accountActivationUrl userErrors { message } } }`);
    const url = gen.customerGenerateAccountActivationUrl.accountActivationUrl as string;
    expect(url).toMatch(/\/account\/activate\/\d+\/[\w-]+$/);
    expect((await t.app.inject(url.replace(/^https?:\/\/[^/]+/, ''))).statusCode).toBe(200);
    sent.length = 0;
    const mail = await g(`mutation { customerSendAccountInviteEmail(customerId: "${id}") { customer { id } userErrors { message } } }`);
    expect(mail.customerSendAccountInviteEmail.userErrors).toEqual([]);
    expect(sent.some((m) => m.to === 'invitee@example.com' && /activate/i.test(m.text))).toBe(true);
    const missing = await g(`mutation { customerGenerateAccountActivationUrl(customerId: "gid://shopify/Customer/99999") { accountActivationUrl userErrors { message } } }`);
    expect(missing.customerGenerateAccountActivationUrl.userErrors).toHaveLength(1);
  });
});
