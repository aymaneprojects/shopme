import { and, eq } from 'drizzle-orm';
import { schema as s, seedDemo, type Mail } from '@shopme/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, SETUP_BODY, type TestApp } from '../../../src/test-utils';

let t: TestApp;
let sent: Mail[] = [];
const sku: Record<string, number> = {};
const FORM = { 'content-type': 'application/x-www-form-urlencoded' };

const post = (url: string, form: Record<string, string>, cookies: Record<string, string> = {}, headers: Record<string, string> = {}) =>
  t.app.inject({ method: 'POST', url, payload: new URLSearchParams(form).toString(), headers: { ...FORM, ...headers }, cookies });
const get = (url: string, cookies: Record<string, string> = {}) => t.app.inject({ url, cookies });
const cookieOf = (res: { cookies: { name: string; value: string }[] }, name: string) => res.cookies.find((c) => c.name === name)?.value;
const mails = async () => { await t.app.ctx.queue.idle(); return sent; };

/** Place a bank-transfer order for `email` as a guest or signed-in buyer; returns the order row. */
async function buy(email: string, customerCookie?: string) {
  const add = await t.app.inject({ method: 'POST', url: '/cart/add.js', payload: { id: sku['HEB-250'], quantity: 1 } });
  const cart = cookieOf(add, 'cart')!;
  const go = await t.app.inject({ method: 'POST', url: '/checkout', cookies: { cart } });
  const token = go.headers.location!.toString().split('/').pop()!;
  const cookies: Record<string, string> = customerCookie ? { cart, shopme_customer: customerCookie } : { cart };
  const page = await get(`/checkouts/${token}`, cookies);
  const address = { email, firstName: 'Ada', lastName: 'Lovelace', address1: '1 Rue de Rivoli', city: 'Paris', zip: '75001', countryCode: 'FR', phone: '' };
  await t.app.inject({ method: 'POST', url: `/checkouts/${token}/refresh`, payload: address });
  const done = await post(`/checkouts/${token}/complete`, { ...address, paymentMethod: 'bank_transfer' });
  expect(done.statusCode).toBe(303);
  const [order] = await t.dbHandle.db.select().from(s.orders).where(eq(s.orders.cartToken, token));
  return { order: order!, checkoutHtml: page.body };
}

beforeAll(async () => {
  t = await createTestApp();
  await t.app.inject({ method: 'POST', url: '/admin/api/setup', payload: SETUP_BODY });
  await seedDemo(t.dbHandle.db, t.app.ctx.storage);
  for (const v of await t.dbHandle.db.select().from(s.productVariants)) if (v.sku) sku[v.sku] = v.id;
  t.app.ctx.mailer = { send: async (m) => { sent.push(m); } };
}, 90_000);
afterAll(async () => { await t.close(); });

describe('customer accounts', () => {
  let session = '';
  let customerId = 0;

  it('anonymous visitors are sent to the login page; the classic templates render', async () => {
    const r = await get('/account');
    expect(r.statusCode).toBe(302);
    expect(r.headers.location).toBe('/account/login?return_url=%2Faccount');
    for (const url of ['/account/login', '/account/register']) {
      const page = await get(url);
      expect(page.statusCode, url).toBe(200);
      expect(page.body, url).not.toContain('Liquid error');
      expect(page.body).toContain('name="form_type" value="' + (url.endsWith('login') ? 'customer_login' : 'create_customer') + '"');
    }
    const login = (await get('/account/login')).body;
    expect(login).toContain('action="/account/login"');
    expect(login).toContain('name="form_type" value="recover_customer_password"');
    expect((await get('/account/orders/1')).statusCode).toBe(302);
    expect((await get('/account/addresses')).statusCode).toBe(302);
  });

  it('registration validates, then creates an account, signs in and shows the account page', async () => {
    const bad = await post('/account', { form_type: 'create_customer', 'customer[email]': 'ada@example.com', 'customer[password]': 'short' });
    expect(bad.statusCode).toBe(303);
    expect(bad.headers.location).toBe('/account/register');
    const flash = cookieOf(bad, 'shopme_flash')!;
    const again = await get('/account/register', { shopme_flash: flash });
    expect(again.body).toContain('Password is too short');
    expect(again.body).toContain('value="ada@example.com"');

    const ok = await post('/account', { form_type: 'create_customer', 'customer[first_name]': 'Ada', 'customer[last_name]': 'Lovelace', 'customer[email]': 'Ada@Example.com', 'customer[password]': 'analytical engine' });
    expect(ok.statusCode).toBe(303);
    expect(ok.headers.location).toBe('/account');
    session = cookieOf(ok, 'shopme_customer')!;
    expect(session).toBeTruthy();
    const [row] = await t.dbHandle.db.select().from(s.customers).where(eq(s.customers.email, 'ada@example.com'));
    customerId = row!.id;
    expect(row).toMatchObject({ state: 'ENABLED', firstName: 'Ada' });
    expect(row!.passwordHash).toMatch(/^\$argon2/);

    const account = await get('/account', { shopme_customer: session });
    expect(account.statusCode).toBe(200);
    expect(account.body).toContain('Ada Lovelace');
    expect(account.body).toContain('ada@example.com');
    expect(account.body).toContain('You have not placed any orders yet.');
    expect(account.body).not.toContain('Liquid error');
    // logged in: login and register bounce to the account
    expect((await get('/account/login', { shopme_customer: session })).headers.location).toBe('/account');

    const dup = await post('/account', { form_type: 'create_customer', 'customer[email]': 'ada@example.com', 'customer[password]': 'another password' });
    expect(dup.headers.location).toBe('/account/register');
    expect((await get('/account/register', { shopme_flash: cookieOf(dup, 'shopme_flash')! })).body).toContain('already associated with an account');
  });

  it('login rejects a wrong password with one message and accepts the right one; logout ends the session', async () => {
    const bad = await post('/account/login', { form_type: 'customer_login', 'customer[email]': 'ada@example.com', 'customer[password]': 'nope nope' });
    expect(bad.headers.location).toBe('/account/login');
    expect((await get('/account/login', { shopme_flash: cookieOf(bad, 'shopme_flash')! })).body).toContain('Incorrect email or password.');
    const unknown = await post('/account/login', { 'customer[email]': 'nobody@example.com', 'customer[password]': 'whatever' });
    expect((await get('/account/login', { shopme_flash: cookieOf(unknown, 'shopme_flash')! })).body).toContain('Incorrect email or password.');

    const ok = await post('/account/login?return_url=%2Faccount%2Faddresses', { 'customer[email]': 'ADA@example.com', 'customer[password]': 'analytical engine' });
    expect(ok.headers.location).toBe('/account/addresses');
    const second = cookieOf(ok, 'shopme_customer')!;
    expect((await get('/account', { shopme_customer: second })).statusCode).toBe(200);
    const out = await get('/account/logout', { shopme_customer: second });
    expect(out.statusCode).toBe(302);
    expect(out.headers.location).toBe('/');
    expect((await get('/account', { shopme_customer: second })).statusCode).toBe(302); // the session row is gone
    expect((await get('/account', { shopme_customer: 'tampered' })).statusCode).toBe(302);
  });

  it('checkout starts with the signed-in customer, the order joins their history and order pages are private', async () => {
    const { order, checkoutHtml } = await buy('ada@example.com', session);
    expect(checkoutHtml).toContain('ada@example.com');
    expect(order.customerId).toBe(customerId);

    const account = await get('/account', { shopme_customer: session });
    expect(account.body).toContain(`href="/account/orders/${order.id}"`);
    expect(account.body).toContain('#1001');
    const detail = await get(`/account/orders/${order.id}`, { shopme_customer: session });
    expect(detail.statusCode).toBe(200);
    expect(detail.body).toContain('House Espresso Blend');
    expect(detail.body).toContain('Order #1001');
    expect(detail.body).not.toContain('Liquid error');

    // another customer, and a guest, cannot read it
    const eve = await post('/account', { 'customer[email]': 'eve@example.com', 'customer[password]': 'evil plans 123' });
    expect((await get(`/account/orders/${order.id}`, { shopme_customer: cookieOf(eve, 'shopme_customer')! })).statusCode).toBe(404);
    expect((await get(`/account/orders/${order.id}`)).statusCode).toBe(302);
    expect((await get('/account/orders/abc', { shopme_customer: session })).statusCode).toBe(404);
  });

  it('the address book supports create, edit, default and delete, scoped to the customer', async () => {
    const c = { shopme_customer: session };
    const add = await post('/account/addresses', { form_type: 'customer_address', 'address[first_name]': 'Ada', 'address[last_name]': 'Lovelace', 'address[address1]': '10 Downing St', 'address[city]': 'London', 'address[zip]': 'SW1A 2AA', 'address[country]': 'GB', 'address[default]': '1' }, c);
    expect(add.headers.location).toBe('/account/addresses');
    const second = await post('/account/addresses', { 'address[address1]': '5 Quai Voltaire', 'address[city]': 'Paris', 'address[country]': 'France', 'address[zip]': '75007' }, c);
    expect(second.statusCode).toBe(303);
    const db = t.dbHandle.db;
    let rows = await db.select().from(s.customerAddresses).where(eq(s.customerAddresses.customerId, customerId)).orderBy(s.customerAddresses.id);
    const london = rows.find((r) => r.city === 'London')!;
    const paris = rows.find((r) => r.address1 === '5 Quai Voltaire')!;
    expect(paris.countryCode).toBe('FR'); // a country name is accepted
    expect((await db.select().from(s.customers).where(eq(s.customers.id, customerId)))[0]!.defaultAddressId).toBe(london.id);

    const page = await get('/account/addresses', c);
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain('10 Downing St');
    expect(page.body).toContain('5 Quai Voltaire');
    expect(page.body).toContain(`action="/account/addresses/${london.id}"`);
    expect(page.body).not.toContain('Liquid error');

    await post(`/account/addresses/${paris.id}`, { 'address[address1]': '7 Quai Voltaire', 'address[city]': 'Paris', 'address[country]': 'FR', 'address[default]': '1' }, c);
    expect((await db.select().from(s.customers).where(eq(s.customers.id, customerId)))[0]!.defaultAddressId).toBe(paris.id);
    const invalid = await post('/account/addresses', { 'address[address1]': '', 'address[city]': 'X', 'address[country]': 'FR' }, c);
    expect((await get('/account/addresses', { ...c, shopme_flash: cookieOf(invalid, 'shopme_flash')! })).body).toMatch(/Address can(&#39;|')t be blank/);

    await post(`/account/addresses/${paris.id}`, { _method: 'delete' }, c);
    rows = await db.select().from(s.customerAddresses).where(eq(s.customerAddresses.customerId, customerId));
    expect(rows.map((r) => r.id)).not.toContain(paris.id);
    expect(rows.map((r) => r.id)).toContain(london.id);
    expect((await db.select().from(s.customers).where(eq(s.customers.id, customerId)))[0]!.defaultAddressId).toBe(Math.min(...rows.map((r) => r.id))); // the default moves on

    // another customer cannot touch it
    const eve = (await db.select().from(s.customers).where(eq(s.customers.email, 'eve@example.com')))[0]!;
    const evesSession = (await post('/account/login', { 'customer[email]': 'eve@example.com', 'customer[password]': 'evil plans 123' })).cookies.find((x) => x.name === 'shopme_customer')!.value;
    await post(`/account/addresses/${london.id}`, { _method: 'delete' }, { shopme_customer: evesSession });
    expect(await db.select().from(s.customerAddresses).where(and(eq(s.customerAddresses.id, london.id)))).toHaveLength(1);
    expect(eve.id).not.toBe(customerId);
  });

  it('password reset: a mailed single-use link sets a new password and signs in', async () => {
    sent = [];
    const r = await post('/account/recover', { form_type: 'recover_customer_password', email: 'ada@example.com' });
    expect(r.headers.location).toBe('/account/login#recover');
    const login = await get('/account/login', { shopme_flash: cookieOf(r, 'shopme_flash')! });
    expect(login.body).toContain('If an account exists for this email address');
    const mail = (await mails()).find((m) => m.to === 'ada@example.com')!;
    expect(mail.subject).toBe('Reset your password');
    const link = /\/account\/reset\/(\d+)\/([\w-]+)/.exec(mail.text)!;
    expect(link[1]).toBe(String(customerId));
    // unknown address: same answer, no mail
    const before = sent.length;
    const unknown = await post('/account/recover', { email: 'ghost@example.com' });
    expect(unknown.headers.location).toBe('/account/login#recover');
    await t.app.ctx.queue.idle();
    expect(sent.length).toBe(before);

    const form = await get(link[0]!);
    expect(form.statusCode).toBe(200);
    expect(form.body).toContain(`action="${link[0]}"`);
    expect(form.body).toContain('name="form_type" value="reset_customer_password"');

    const mismatch = await post(link[0]!, { 'customer[password]': 'brand new secret', 'customer[password_confirmation]': 'different one' });
    expect(mismatch.headers.location).toBe(link[0]);
    expect((await get(link[0]!, { shopme_flash: cookieOf(mismatch, 'shopme_flash')! })).body).toContain('Password confirmation');

    const done = await post(link[0]!, { 'customer[password]': 'brand new secret', 'customer[password_confirmation]': 'brand new secret' });
    expect(done.headers.location).toBe('/account');
    expect(cookieOf(done, 'shopme_customer')).toBeTruthy();
    expect((await get('/account', { shopme_customer: session })).statusCode).toBe(302); // old sessions were dropped
    expect((await post('/account/login', { 'customer[email]': 'ada@example.com', 'customer[password]': 'analytical engine' })).headers.location).toBe('/account/login');
    expect((await post('/account/login', { 'customer[email]': 'ada@example.com', 'customer[password]': 'brand new secret' })).headers.location).toBe('/account');

    // the link works once
    expect((await get(link[0]!)).headers.location).toBe('/account/login');
    expect((await post(link[0]!, { 'customer[password]': 'yet another one' })).headers.location).toBe('/account/login');
  });

  it('a guest customer proves email ownership with an activation link before getting an account', async () => {
    sent = [];
    const { order } = await buy('guest@example.com');
    expect(order.customerId).toBeTruthy();
    const reg = await post('/account', { 'customer[email]': 'guest@example.com', 'customer[password]': 'guest secret 1' });
    expect(reg.headers.location).toBe('/account/login'); // no session: the email is not proven yet
    expect(cookieOf(reg, 'shopme_customer')).toBeUndefined();
    const mail = (await mails()).find((m) => m.to === 'guest@example.com' && m.subject.startsWith('Activate'))!;
    expect(mail.subject).toBe('Activate your account');
    const link = /\/account\/activate\/\d+\/[\w-]+/.exec(mail.text)![0];
    const page = await get(link);
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain('name="form_type" value="activate_customer_password"');
    const done = await post(link, { 'customer[password]': 'guest secret 1', 'customer[password_confirmation]': 'guest secret 1' });
    expect(done.headers.location).toBe('/account');
    const account = await get('/account', { shopme_customer: cookieOf(done, 'shopme_customer')! });
    expect(account.body).toContain(`/account/orders/${order.id}`);
  });

  it('answers in the shop language and rate-limits repeated failures', async () => {
    const db = t.dbHandle.db;
    const [shop] = await db.select().from(s.shops);
    await db.update(s.shops).set({ locale: 'fr' }).where(eq(s.shops.id, shop!.id));
    const bad = await post('/account/login', { 'customer[email]': 'ada@example.com', 'customer[password]': 'x' });
    const fr = await get('/account/login', { shopme_flash: cookieOf(bad, 'shopme_flash')! });
    expect(fr.body).toContain('E-mail ou mot de passe incorrect.');
    expect(fr.body).toContain('Mot de passe oublié ?');
    expect((await get('/account/register')).body).toContain('Créer mon compte');
    await db.update(s.shops).set({ locale: 'en' }).where(eq(s.shops.id, shop!.id));

    let last = bad;
    for (let i = 0; i < 12; i++) last = await post('/account/login', { 'customer[email]': 'rate@example.com', 'customer[password]': `wrong ${i}` });
    expect((await get('/account/login', { shopme_flash: cookieOf(last, 'shopme_flash')! })).body).toContain('Too many attempts');
    // a cross-site POST is refused
    expect((await post('/account/login', { 'customer[email]': 'a@b.co', 'customer[password]': 'x' }, {}, { origin: 'https://evil.example' })).statusCode).toBe(403);
  });
});
