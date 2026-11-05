import { eq } from 'drizzle-orm';
import { createCustomer, getPrimaryShop, schema as s, seedDemo, type Mail } from '@shopme/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, SETUP_BODY, type TestApp } from '../../../src/test-utils';

let t: TestApp;
let shopId = 0;
let sent: Mail[] = [];
const sku: Record<string, number> = {};
const FORM = { 'content-type': 'application/x-www-form-urlencoded' };
const post = (url: string, form: Record<string, string>, headers: Record<string, string> = {}, cookies: Record<string, string> = {}) =>
  t.app.inject({ method: 'POST', url, payload: new URLSearchParams(form).toString(), headers: { ...FORM, ...headers }, cookies });
const get = (url: string, cookies: Record<string, string> = {}) => t.app.inject({ url, cookies });
const cookieOf = (res: { cookies: { name: string; value: string }[] }, name: string) => res.cookies.find((c) => c.name === name)?.value;

beforeAll(async () => {
  t = await createTestApp();
  await t.app.inject({ method: 'POST', url: '/admin/api/setup', payload: SETUP_BODY });
  await seedDemo(t.dbHandle.db, t.app.ctx.storage);
  shopId = (await getPrimaryShop(t.dbHandle.db))!.id;
  for (const v of await t.dbHandle.db.select().from(s.productVariants)) if (v.sku) sku[v.sku] = v.id;
  t.app.ctx.mailer = { send: async (m) => { sent.push(m); } };
}, 90_000);
afterAll(async () => { await t.close(); });

describe('contact form', () => {
  it('mails the shop owner (reply-to the sender) and reports success on the page', async () => {
    sent = [];
    const r = await post('/contact', { form_type: 'contact', utf8: '✓', 'contact[name]': 'Ada <script>', 'contact[email]': 'Ada@Example.com', 'contact[phone]': '0102030405', 'contact[body]': 'Hello there\nsecond line', 'contact[order]': '#1001', return_to: '/pages/contact' });
    expect(r.statusCode).toBe(303);
    expect(r.headers.location).toBe('/pages/contact?contact_posted=true#contact_form');
    await t.app.ctx.queue.idle();
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ to: 'owner@example.com', replyTo: 'Ada@Example.com', subject: '[Test Shop] New message from Ada <script>' });
    expect(sent[0]!.text).toContain('Hello there\nsecond line');
    expect(sent[0]!.text).toContain('order: #1001');
    expect(sent[0]!.html).toContain('Ada &lt;script&gt;'); // escaped in HTML

    const page = await get('/pages/contact?contact_posted=true', { shopme_flash: cookieOf(r, 'shopme_flash')! });
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain('Thanks for contacting us');
    expect(page.body).toContain('name="form_type" value="contact"');
    expect(page.body).not.toContain('Liquid error');
    expect((await get('/pages/contact')).body).not.toContain('Thanks for contacting us');
  });

  it('returns to the page the form was on (Referer) and keeps what was typed when validation fails', async () => {
    sent = [];
    const bad = await post('/contact', { form_type: 'contact', 'contact[email]': 'not-an-email', 'contact[body]': 'Keep this text' }, { host: 'shop.test', referer: 'https://shop.test/pages/contact' });
    expect(bad.headers.location).toBe('/pages/contact#contact_form');
    const page = await get('/pages/contact', { shopme_flash: cookieOf(bad, 'shopme_flash')! });
    expect(page.body).toMatch(/Email is invalid/);
    expect(page.body).toContain('Keep this text');
    expect(page.body).toContain('value="not-an-email"');
    await t.app.ctx.queue.idle();
    expect(sent).toHaveLength(0);
    // a foreign Referer is not trusted
    const foreign = await post('/contact', { form_type: 'contact', 'contact[email]': 'x' }, { referer: 'https://evil.example/steal' });
    expect(foreign.headers.location).toBe('/pages/contact#contact_form');
    expect((await post('/contact', { form_type: 'contact', 'contact[email]': 'a@b.co' }, { origin: 'https://evil.example' })).statusCode).toBe(403);
  });
});

describe('newsletter form', () => {
  it('creates a customer with marketing consent and the newsletter tag, or updates an existing one', async () => {
    const db = t.dbHandle.db;
    const fresh = await post('/contact', { form_type: 'customer', 'contact[email]': 'News@Example.com', 'contact[tags]': 'newsletter, vip' }, { 'x-forwarded-for': '10.0.0.1' });
    expect(fresh.statusCode).toBe(303);
    expect(fresh.headers.location).toBe('/?customer_posted=true#contact_form');
    const [c] = await db.select().from(s.customers).where(eq(s.customers.email, 'news@example.com'));
    expect(c).toMatchObject({ acceptsMarketing: true, tags: ['newsletter', 'vip'], state: 'DISABLED' });

    const home = await get('/?customer_posted=true');
    expect(home.statusCode).toBe(200);
    expect(home.body).toContain('Thanks for subscribing!');
    expect((await get('/')).body).toContain('name="form_type" value="customer"');

    // an existing non-subscriber is switched on, not duplicated
    const existing = await createCustomer(db, shopId, { email: 'known@example.com', firstName: 'Kay', tags: ['wholesale'] });
    expect(existing.ok && existing.value.acceptsMarketing).toBe(false);
    await post('/contact', { form_type: 'customer', 'contact[email]': 'known@example.com' });
    const rows = await db.select().from(s.customers).where(eq(s.customers.email, 'known@example.com'));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ acceptsMarketing: true, firstName: 'Kay', tags: ['newsletter', 'wholesale'] });

    // invalid email: the error shows up in the footer form of the page
    const bad = await post('/contact', { form_type: 'customer', 'contact[email]': 'nope' });
    const page = await get('/', { shopme_flash: cookieOf(bad, 'shopme_flash')! });
    expect(page.body).toMatch(/Email is invalid/);
    expect(page.body).not.toContain('Thanks for subscribing!');
  });
});

describe('cart-level discounts', () => {
  let cart = '';
  const cartJs = async () => (await get('/cart.js', { cart })).json();

  it('/discount/:code remembers the code (cookie and cart) and redirects', async () => {
    const r = await get('/discount/welcome10?redirect=/collections/all');
    expect(r.statusCode).toBe(302);
    expect(r.headers.location).toBe('/collections/all');
    expect(cookieOf(r, 'discount_code')).toBe('welcome10');
    cart = cookieOf(r, 'cart')!;
    expect(cart).toBeTruthy();
    expect((await get('/discount/x?redirect=//evil.example')).headers.location).toBe('/');
    expect((await get('/discount/WELCOME10')).headers.location).toBe('/');

    const empty = await cartJs();
    expect(empty).toMatchObject({ total_discount: 0, total_price: 0, cart_level_discount_applications: [], discount_codes: [{ code: 'welcome10', applicable: true }] });
  });

  it('an order discount code shows as a cart-level application and reduces the total', async () => {
    const add = await t.app.inject({ method: 'POST', url: '/cart/add.js', payload: { id: sku['HEB-250'], quantity: 2 }, cookies: { cart } });
    expect(add.statusCode).toBe(200);
    const c = await cartJs();
    expect(c).toMatchObject({ original_total_price: 2600, items_subtotal_price: 2600, total_discount: 260, total_price: 2340 });
    expect(c.cart_level_discount_applications).toHaveLength(1);
    expect(c.cart_level_discount_applications[0]).toMatchObject({
      type: 'discount_code', title: 'WELCOME10', value: '10.0', value_type: 'percentage', allocation_method: 'across', target_selection: 'all', target_type: 'line_item', total_allocated_amount: 260,
    });
    expect(c.cart_level_discount_applications[0].key).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-/);
    // order discounts are not attributed to lines
    expect(c.items[0]).toMatchObject({ total_discount: 0, discounts: [], line_level_discount_allocations: [], final_line_price: 2600, line_price: 2600, original_line_price: 2600 });

    // the same figures arrive with every Ajax mutation
    const changed = await t.app.inject({ method: 'POST', url: '/cart/change.js', payload: { line: 1, quantity: 3 }, cookies: { cart } });
    expect(changed.json()).toMatchObject({ total_price: 3510, total_discount: 390 });
    expect((await t.app.inject({ method: 'POST', url: '/cart/change.js', payload: { line: 1, quantity: 2 }, cookies: { cart } })).json().total_price).toBe(2340);
  });

  it('the cart page and the Liquid cart object carry the discount applications', async () => {
    const page = await get('/cart', { cart });
    expect(page.statusCode).toBe(200);
    expect(page.body).not.toContain('Liquid error');
    expect(page.body).toContain('Discount: WELCOME10');
    expect(page.body).toContain('-€2.60');
    expect(page.body).toMatch(/Subtotal.*€23\.40/s);

    await t.dbHandle.db.update(s.themeFiles).set({
      body: '<p id=d>{{ cart.total_discount }}|{{ cart.discount_applications.size }}|{{ cart.discount_applications[0].title }}|{{ cart.discount_applications[0].total_allocated_amount }}|{{ cart.cart_level_discount_applications.size }}|{{ cart.total_price }}|{{ cart.original_total_price }}</p>',
      checksum: 'changed',
    }).where(eq(s.themeFiles.path, 'sections/main-cart.liquid'));
    const custom = await get('/cart', { cart });
    expect(custom.body).toContain('<p id=d>260|1|WELCOME10|260|1|2340|2600</p>');
  });

  it('product discounts are allocated to lines (line_level_discount_allocations, discounts, final prices)', async () => {
    const db = t.dbHandle.db;
    const [variant] = await db.select().from(s.productVariants).where(eq(s.productVariants.sku, 'HEB-250'));
    const [d] = await db.insert(s.discounts).values({ shopId, title: 'Beans 30 percent off', kind: 'AUTOMATIC', valueType: 'PERCENTAGE', value: 3000, target: 'PRODUCTS', appliesTo: { productIds: [variant!.productId] } }).returning();
    // Discounts of different classes only stack when both allow it (default: they do not).
    const combine = { product: true, order: true, shipping: false };
    for (const id of [d!.id, ...(await db.select({ id: s.discountCodes.discountId }).from(s.discountCodes).where(eq(s.discountCodes.code, 'WELCOME10'))).map((x) => x.id)]) {
      await db.insert(s.discountExtensions).values({ discountId: id, shopId, combinesWith: combine }).onConflictDoUpdate({ target: s.discountExtensions.discountId, set: { combinesWith: combine } });
    }
    const c = await cartJs();
    const line = c.items[0];
    // product discounts apply before order discounts: 30% on the product (780), then the 10% order code on the remaining 1820 (182)
    expect(line).toMatchObject({ total_discount: 780, final_line_price: 1820, line_price: 1820, original_line_price: 2600, original_price: 1300, discounted_price: 910, final_price: 910, line_level_total_discount: 780 });
    expect(line.discounts).toEqual([{ amount: 780, title: 'Beans 30 percent off' }]);
    expect(line.line_level_discount_allocations).toHaveLength(1);
    expect(line.line_level_discount_allocations[0]).toMatchObject({
      amount: 780, discount_application: { type: 'automatic', title: 'Beans 30 percent off', value: '30.0', value_type: 'percentage', allocation_method: 'each', target_selection: 'entitled', target_type: 'line_item', total_allocated_amount: 780 },
    });
    expect(c).toMatchObject({ original_total_price: 2600, items_subtotal_price: 1820, total_discount: 962, total_price: 1638 });
    expect(c.cart_level_discount_applications).toHaveLength(1);

    // a code that does not apply is flagged, and an expired automatic discount disappears
    await get('/discount/NOPE', { cart });
    expect((await cartJs()).discount_codes).toEqual([{ code: 'welcome10', applicable: true }, { code: 'NOPE', applicable: false }]);
    await db.update(s.discounts).set({ status: 'DISABLED' }).where(eq(s.discounts.id, d!.id));
    expect((await cartJs()).items[0].line_level_discount_allocations).toEqual([]);
  });
});

describe('form rate limit', () => {
  it('is rate limited per visitor', async () => {
    let last = await post('/contact', { 'contact[email]': 'spam@example.com', 'contact[body]': 'x' });
    for (let i = 0; i < 10; i++) last = await post('/contact', { 'contact[email]': 'spam@example.com', 'contact[body]': 'x' });
    expect((await get('/pages/contact', { shopme_flash: cookieOf(last, 'shopme_flash')! })).body).toContain('Too many attempts');
  });
});
