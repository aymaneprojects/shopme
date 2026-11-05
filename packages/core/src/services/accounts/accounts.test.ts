import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { createDb, getPrimaryShop, runMigrations, schema as s, seedDemo, type DbHandle } from '../../index';
import { createLocalStorage } from '../storage';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createCart, addItems, loadCartView } from '../cart/service';
import { priceCartDiscounts } from '../checkout';
import { priceCheckout } from '../pricing';
import { redirectPathChange, findRedirect, createUrlRedirect, updateUrlRedirect } from '../content/redirects';
import { createArticle, createBlog, listArticles, updateBlog } from '../content/blogs';
import {
  authenticateCustomer, createCustomerToken, inviteCustomer, isCustomerTokenValid, registerCustomer, requestPasswordReset, setPasswordWithToken, subscribeNewsletter, resolveCustomerSession, createCustomerSession,
} from './accounts';

let h: DbHandle;
let shopId: number;

beforeAll(async () => {
  h = await createDb({ memory: true });
  await runMigrations(h);
  await seedDemo(h.db, createLocalStorage(mkdtempSync(path.join(tmpdir(), 'acc-'))));
  shopId = (await getPrimaryShop(h.db))!.id;
}, 60_000);
afterAll(async () => { await h.close(); });

describe('accounts service', () => {
  it('registers, authenticates and keeps sessions scoped to customers', async () => {
    expect((await registerCustomer(h.db, shopId, { email: 'bad', password: 'long enough' }))).toMatchObject({ ok: false, errors: [{ field: ['email'], code: 'INVALID' }] });
    expect((await registerCustomer(h.db, shopId, { email: 'a@b.co', password: 'short' }))).toMatchObject({ ok: false, errors: [{ code: 'TOO_SHORT' }] });
    const r = await registerCustomer(h.db, shopId, { email: ' Reg@Example.com ', password: 'long enough pw', firstName: ' Ann ' });
    expect(r.ok && r.value.customer).toMatchObject({ email: 'reg@example.com', firstName: 'Ann', state: 'ENABLED' });
    expect((await registerCustomer(h.db, shopId, { email: 'reg@example.com', password: 'long enough pw' }))).toMatchObject({ ok: false, errors: [{ code: 'TAKEN' }] });
    expect(await authenticateCustomer(h.db, shopId, 'REG@example.com', 'wrong password')).toBeNull();
    const c = await authenticateCustomer(h.db, shopId, 'REG@example.com', 'long enough pw');
    expect(c?.lastLoginAt).toBeNull(); // the returned row predates the login stamp
    const session = await createCustomerSession(h.db, { shopId, customerId: c!.id });
    expect((await resolveCustomerSession(h.db, shopId, session.token))?.id).toBe(c!.id);
    expect(await resolveCustomerSession(h.db, shopId + 1, session.token)).toBeNull();
    expect(await resolveCustomerSession(h.db, shopId, 'nope')).toBeNull();
    // a staff session token is not a customer session
    expect(await authenticateCustomer(h.db, shopId, 'nobody@example.com', 'x')).toBeNull();
  });

  it('tokens are single use, expire, and are replaced by newer ones; guests must activate', async () => {
    const reg = await registerCustomer(h.db, shopId, { email: 'tok@example.com', password: 'long enough pw' });
    const id = reg.ok ? reg.value.customer.id : 0;
    const reset = await requestPasswordReset(h.db, shopId, 'tok@example.com');
    expect(await requestPasswordReset(h.db, shopId, 'ghost@example.com')).toBeNull();
    expect(await isCustomerTokenValid(h.db, shopId, id, 'reset', reset!.token)).toBe(true);
    expect(await isCustomerTokenValid(h.db, shopId, id, 'activate', reset!.token)).toBe(false); // kinds are not interchangeable
    const newer = await createCustomerToken(h.db, shopId, id, 'reset');
    expect(await isCustomerTokenValid(h.db, shopId, id, 'reset', reset!.token)).toBe(false);
    expect(await setPasswordWithToken(h.db, shopId, 'reset', id, newer, 'new password 1', 'different')).toMatchObject({ ok: false, errors: [{ code: 'CONFIRMATION' }] });
    expect((await setPasswordWithToken(h.db, shopId, 'reset', id, newer, 'new password 1', 'new password 1')).ok).toBe(true);
    expect((await setPasswordWithToken(h.db, shopId, 'reset', id, newer, 'new password 2')).ok).toBe(false);
    expect(await authenticateCustomer(h.db, shopId, 'tok@example.com', 'new password 1')).not.toBeNull();

    const expired = await createCustomerToken(h.db, shopId, id, 'reset');
    await h.db.update(s.customerTokens).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(s.customerTokens.customerId, id));
    expect(await isCustomerTokenValid(h.db, shopId, id, 'reset', expired)).toBe(false);

    await h.db.insert(s.customers).values({ shopId, email: 'guest@example.com' });
    const guest = await registerCustomer(h.db, shopId, { email: 'guest@example.com', password: 'long enough pw' });
    expect(guest.ok && guest.value.activationToken).toBeTruthy(); // no password is set before the email is proven
    expect((await h.db.select().from(s.customers).where(eq(s.customers.email, 'guest@example.com')))[0]!.passwordHash).toBeNull();
    const invited = await inviteCustomer(h.db, shopId, guest.ok ? guest.value.customer.id : 0);
    expect(invited.ok && invited.value.token).toBeTruthy();
    expect((await h.db.select().from(s.customers).where(eq(s.customers.email, 'guest@example.com')))[0]!.state).toBe('INVITED');
  });

  it('newsletter sign-ups create or update customers', async () => {
    expect(await subscribeNewsletter(h.db, shopId, { email: 'x' })).toMatchObject({ ok: false });
    const a = await subscribeNewsletter(h.db, shopId, { email: 'n@example.com' });
    expect(a.ok && a.value).toMatchObject({ acceptsMarketing: true, tags: ['newsletter'] });
    const b = await subscribeNewsletter(h.db, shopId, { email: 'N@example.com', tags: ['vip'] });
    expect(b.ok && b.value.tags).toEqual(['newsletter', 'vip']);
  });
});

describe('redirects and blogs services', () => {
  it('redirectPathChange re-points old redirects and never leaves a self redirect', async () => {
    await redirectPathChange(h.db, shopId, '/products/a', '/products/b');
    await redirectPathChange(h.db, shopId, '/products/b', '/products/c');
    expect((await findRedirect(h.db, shopId, '/products/a'))?.target).toBe('/products/c');
    expect((await findRedirect(h.db, shopId, '/PRODUCTS/B'))?.target).toBe('/products/c');
    await redirectPathChange(h.db, shopId, '/products/c', '/products/a');
    expect(await findRedirect(h.db, shopId, '/products/a')).toBeNull();
    expect((await findRedirect(h.db, shopId, '/products/c'))?.target).toBe('/products/a');
    expect((await createUrlRedirect(h.db, shopId, { path: '/products/c', target: '/x' })).ok).toBe(false);
    const own = await createUrlRedirect(h.db, shopId, { path: '/loop', target: '/loop' });
    expect(own.ok).toBe(false);
    const ok = await createUrlRedirect(h.db, shopId, { path: 'no-slash', target: 'https://example.org' });
    expect(ok.ok && ok.value.path).toBe('/no-slash');
    expect((await updateUrlRedirect(h.db, shopId, ok.ok ? ok.value.id : 0, { path: '/products/c' })).ok).toBe(false);
  });

  it('blog handle changes redirect the blog and, on request, its articles; publish dates gate visibility', async () => {
    const blog = await createBlog(h.db, shopId, { title: 'Service Blog' });
    const id = blog.ok ? blog.value.id : 0;
    const a = await createArticle(h.db, shopId, { blogId: id, title: 'Future post', author: 'Me', isPublished: true, publishDate: new Date(Date.now() + 86_400_000) });
    expect(a.ok).toBe(true);
    expect(await listArticles(h.db, shopId, { blogId: id, publishedOnly: true, offset: 0, limit: 10 })).toHaveLength(0); // scheduled in the future
    await updateBlog(h.db, shopId, id, { handle: 'renamed', redirectArticles: true });
    expect((await findRedirect(h.db, shopId, '/blogs/service-blog'))?.target).toBe('/blogs/renamed');
    expect((await findRedirect(h.db, shopId, '/blogs/service-blog/future-post'))?.target).toBe('/blogs/renamed/future-post');
    expect((await createArticle(h.db, shopId, { blogId: id, title: 'Dup', handle: 'future-post', author: 'Me' }))).toMatchObject({ ok: false, errors: [{ code: 'TAKEN' }] });
  });
});

describe('cart-level discount pricing', () => {
  it('records which line each discount took from, summing to the application', () => {
    const lines = [1, 2].map((id) => ({ id, unitPrice: 1000, quantity: id, taxable: true, requiresShipping: true, grams: 0, productId: id, collectionIds: [] }));
    const r = priceCheckout({
      lines, shipping: null, taxRates: [], taxesIncluded: false, country: null, province: null,
      discounts: [{ id: 9, code: null, title: 'P2', valueType: 'FIXED_AMOUNT', value: 1000, target: 'PRODUCTS', appliesTo: { productIds: [2] } }, { id: 8, code: 'ALL', title: 'ALL', valueType: 'PERCENTAGE', value: 1000, target: 'ORDER', appliesTo: {} }],
    });
    const [p2, all] = r.discountApplications;
    expect(p2!.lineAllocations).toEqual([{ lineId: 2, amount: 1000 }]);
    expect(all!.lineAllocations.reduce((n, x) => n + x.amount, 0)).toBe(all!.allocated);
    expect(all!.allocated).toBe(200); // 10% of what remains after the product discount (1000 + 1000)
    expect(r.discountApplications.flatMap((a) => a.lineAllocations).length).toBe(3);
  });

  it('priceCartDiscounts evaluates cart codes like checkout and flags the ones that do not apply', async () => {
    const cart = await createCart(h.db, shopId, 'EUR');
    expect(await priceCartDiscounts(h.db, shopId, cart)).toEqual({ applications: [], rejected: [], totalDiscount: 0 });
    const [variant] = await h.db.select().from(s.productVariants).where(eq(s.productVariants.sku, 'HEB-250'));
    await addItems(h.db, shopId, cart.id, [{ id: variant!.id, quantity: 1 }]);
    await h.db.update(s.carts).set({ discountCodes: ['welcome10', 'nope'] }).where(eq(s.carts.id, cart.id));
    const view = (await loadCartView(h.db, shopId, cart.id))!;
    const d = await priceCartDiscounts(h.db, shopId, view);
    expect(d.totalDiscount).toBe(130);
    expect(d.applications.map((a) => [a.code, a.allocated])).toEqual([['WELCOME10', 130]]);
    expect(d.rejected).toEqual([{ code: 'NOPE', reason: 'not_found' }]);
  });
});
