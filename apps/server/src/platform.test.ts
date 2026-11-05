import { mkdtempSync, readFileSync, readdirSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { unzipSync, strFromU8 } from 'fflate';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { count, eq } from 'drizzle-orm';
import { createStaffUser, createSession, getPrimaryShop, runScheduledBackup, schema as s, seedDemo, totpCode, createLocalStorage, type Mail } from '@shopme/core';
import { seedCustomer, seedOrder } from '../test/conformance/seed-sales';
import { createTestApp, setupAndLogin, type TestApp } from './test-utils';

let t: TestApp;
let owner: string;
let shopId: number;
const sent: Mail[] = [];

const UA = 'Mozilla/5.0 (X11; Linux x86_64) Chrome/120.0 Safari/537.36';
const call = (cookie: string | null, method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, payload?: unknown, headers: Record<string, string> = {}, app = t) =>
  app.app.inject({ method, url, payload: payload as never, headers, cookies: cookie ? { shopme_session: cookie } : undefined });
async function gql(cookie: string, query: string, variables: Record<string, unknown> = {}, app = t) {
  const res = await call(cookie, 'POST', '/admin/api/2026-10/graphql.json', { query, variables }, {}, app);
  return res.json() as { data?: any; errors?: { message: string }[] };
}
const today = () => new Date().toISOString().slice(0, 10);
const tomorrow = () => new Date(Date.now() + 86400_000).toISOString().slice(0, 10);

function multipart(parts: Array<{ name: string; value?: string; filename?: string; data?: Uint8Array }>) {
  const boundary = '----shopme-test';
  const chunks: Buffer[] = [];
  for (const p of parts) {
    chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${p.name}"${p.filename ? `; filename="${p.filename}"` : ''}\r\n${p.filename ? 'Content-Type: application/zip\r\n' : ''}\r\n`));
    chunks.push(p.data ? Buffer.from(p.data) : Buffer.from(p.value ?? ''));
    chunks.push(Buffer.from('\r\n'));
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return { payload: Buffer.concat(chunks), headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } };
}
async function waitJob(cookie: string, id: number, app = t) {
  for (let i = 0; i < 100; i++) {
    const j = ((await call(cookie, 'GET', `/admin/api/store/jobs/${id}`, undefined, {}, app)).json() as { job: { status: string; done: boolean; error: string | null; result: any } }).job;
    if (j.done) return j;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('job did not finish');
}

beforeAll(async () => {
  t = await createTestApp();
  owner = await setupAndLogin(t.app);
  t.app.ctx.mailer = { send: async (m) => { sent.push(m); } };
  const storage = createLocalStorage(t.app.ctx.config.storageDir);
  await seedDemo(t.dbHandle.db, storage);
  shopId = (await getPrimaryShop(t.dbHandle.db))!.id;
}, 120_000);
afterAll(async () => { await t.close(); });

describe('analytics reports', () => {
  beforeAll(async () => {
    const c1 = await seedCustomer(t.dbHandle.db, shopId, { email: 'a@example.com', firstName: 'Ann', lastName: 'A' });
    const c2 = await seedCustomer(t.dbHandle.db, shopId, { email: 'b@example.com', firstName: 'Bob', lastName: 'B' });
    const old = new Date(Date.now() - 40 * 86400_000);
    await seedOrder(t.dbHandle.db, shopId, 1, { customerId: c1.id, processedAt: old, qty: 1, unitPrice: 2000 });
    await seedOrder(t.dbHandle.db, shopId, 2, { customerId: c1.id, qty: 2, unitPrice: 1000, lineTitle: 'Mug' });
    await seedOrder(t.dbHandle.db, shopId, 3, { customerId: c2.id, qty: 1, unitPrice: 5000, lineTitle: 'Lamp' });
    await seedOrder(t.dbHandle.db, shopId, 4, { cancelledAt: new Date() });
    await seedOrder(t.dbHandle.db, shopId, 5, { test: true });
  });
  const run = async (name: string, groupBy = 'DAY', from = addDays(today(), -10), to = today()) =>
    (await gql(owner, 'query($n: ShopmeReportName!, $f: String!, $t: String!, $g: ShopmeReportGroupBy) { shopmeReport(name: $n, from: $f, to: $t, groupBy: $g) { name columns { key type } rows totals currencyCode } }', { n: name, f: from, t: to, g: groupBy })).data.shopmeReport;
  const addDays = (d: string, n: number) => new Date(Date.parse(d) + n * 86400_000).toISOString().slice(0, 10);

  it('sales over time ignores cancelled, test and out-of-range orders', async () => {
    const r = await run('SALES_OVER_TIME');
    expect(r.currencyCode).toBe('EUR');
    expect(r.rows).toHaveLength(1);
    expect(r.totals.orders).toBe(2); // orders 2 and 3
    expect(r.totals.total).toBe(2 * 1000 + 500 + 5000 + 500);
    expect(r.totals.taxes).toBe(200); // totalTax is 100 per order
  });
  it('covers orders, AOV, products, variants, vendors, customers, discounts, taxes, returning rate, inventory', async () => {
    expect((await run('ORDERS_OVER_TIME')).totals.units).toBe(3);
    const aov = await run('AVERAGE_ORDER_VALUE');
    expect(aov.totals.aov).toBe(Math.round((2500 + 5500) / 2));
    const byProduct = await run('SALES_BY_PRODUCT');
    expect(byProduct.rows.map((x: unknown[]) => x[0])).toEqual(['Lamp', 'Mug']);
    expect((await run('SALES_BY_VARIANT')).rows).toHaveLength(2);
    expect((await run('SALES_BY_VENDOR')).rows[0]).toEqual(['Snow Co', 3, 7000]);
    const top = await run('TOP_CUSTOMERS');
    expect(top.rows[0][0]).toBe('Bob B');
    expect((await run('DISCOUNT_USAGE')).rows[0][0]).toBe('WELCOME');
    expect((await run('TAXES')).rows[0][0]).toBe('VAT');
    // Ann ordered 40 days ago too: she is returning in the last 10 days; Bob is new.
    const ret = await run('RETURNING_CUSTOMER_RATE', 'MONTH', addDays(today(), -10), today());
    expect(ret.totals.rate).toBe(50);
    const inv = await run('INVENTORY_SNAPSHOT');
    expect(inv.rows.length).toBeGreaterThan(3);
  });
  it('groups by week and month, and rejects bad ranges', async () => {
    expect((await run('SALES_OVER_TIME', 'MONTH', addDays(today(), -60), today())).rows.length).toBeGreaterThanOrEqual(1);
    const bad = await gql(owner, '{ shopmeReport(name: SALES_OVER_TIME, from: "2026-02-01", to: "2026-01-01") { name } }');
    expect(bad.errors?.[0]?.message).toMatch(/YYYY-MM-DD/);
  });
  it('exports CSV and enforces auth', async () => {
    const url = `/admin/api/reports/SALES_BY_PRODUCT.csv?from=${addDays(today(), -10)}&to=${today()}`;
    const res = await call(owner, 'GET', url);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.body.split('\r\n')[0]).toBe('Product,Units sold,Sales');
    expect(res.body).toContain('Lamp,1,50.00');
    expect((await call(null, 'GET', url)).statusCode).toBe(401);
    expect((await call(owner, 'GET', '/admin/api/reports/NOPE.csv')).statusCode).toBe(404);
  });
});

describe('visit tracking and conversion', () => {
  const visit = (headers: Record<string, string> = {}, cookies: Record<string, string> = {}) => t.app.inject({ method: 'GET', url: '/', headers: { 'user-agent': UA, ...headers }, cookies });
  const views = async () => (await t.dbHandle.db.select({ n: count() }).from(s.visits))[0]!.n;

  it('counts sessions server-side with an anonymous cookie, and honours consent and DNT', async () => {
    const before = await views();
    const r1 = await visit();
    expect(r1.statusCode).toBe(200);
    const vid = r1.cookies.find((c) => c.name === 'shopme_vid')!;
    expect(vid.httpOnly).toBe(true);
    await visit({}, { shopme_vid: vid.value });
    expect(await views()).toBe(before + 2);
    await visit({ dnt: '1' });
    await visit({ 'user-agent': 'Googlebot/2.1' });
    expect(await views()).toBe(before + 2);

    await gql(owner, 'mutation { shopmeCookieBannerUpdate(enabled: true) { cookieBanner { enabled } } }');
    await visit();
    expect(await views()).toBe(before + 2); // no consent yet
    await visit({}, { cookie_consent: 'accepted' });
    expect(await views()).toBe(before + 3);
    await gql(owner, 'mutation { shopmeCookieBannerUpdate(enabled: false) { cookieBanner { enabled } } }');
  });
  it('shows sessions and conversion rate', async () => {
    const r = (await gql(owner, `{ shopmeReport(name: SESSIONS, from: "${today()}", to: "${tomorrow()}") { rows totals } }`)).data.shopmeReport;
    expect(r.totals.sessions).toBeGreaterThanOrEqual(2);
    expect(r.totals.conversion).toBeGreaterThan(0);
  });
});

describe('two-factor authentication and sessions', () => {
  const login = (email = 'owner@example.com', password = 'correct horse', ua = UA) => t.app.inject({ method: 'POST', url: '/admin/api/auth/login', payload: { email, password }, headers: { 'user-agent': ua } });
  let secret = '';
  let recovery: string[] = [];

  it('enrols with a QR code, confirms with a code and returns recovery codes', async () => {
    expect((await call(null, 'GET', '/admin/api/auth/security')).statusCode).toBe(401);
    const setup = (await call(owner, 'POST', '/admin/api/auth/2fa/setup', {})).json() as { secret: string; otpauthUri: string; qrSvg: string };
    secret = setup.secret;
    expect(setup.qrSvg).toContain('<svg');
    expect(setup.otpauthUri).toContain(`secret=${secret}`);
    expect((await call(owner, 'POST', '/admin/api/auth/2fa/enable', { code: '000000' })).statusCode).toBe(422);
    const en = await call(owner, 'POST', '/admin/api/auth/2fa/enable', { code: totpCode(secret) });
    expect(en.statusCode).toBe(200);
    recovery = (en.json() as { recoveryCodes: string[] }).recoveryCodes;
    expect(recovery).toHaveLength(10);
    expect((await call(owner, 'GET', '/admin/api/auth/security')).json()).toMatchObject({ twoFactor: { enabled: true, recoveryCodesLeft: 10 } });
  });

  it('asks for a second step at login and creates the session only after it', async () => {
    const step1 = await login();
    expect(step1.json()).toMatchObject({ twoFactorRequired: true });
    expect(step1.cookies.find((c) => c.name === 'shopme_session')).toBeUndefined();
    const { challenge } = step1.json() as { challenge: string };
    const bad = await t.app.inject({ method: 'POST', url: '/admin/api/auth/login/2fa', payload: { challenge, code: '123456' } });
    expect(bad.statusCode).toBe(401);
    expect((await t.app.inject({ method: 'POST', url: '/admin/api/auth/login/2fa', payload: { challenge: 'xxxxxx.yyyyyyy.zzzzzzzz', code: totpCode(secret) } })).statusCode).toBe(401);
    const ok = await t.app.inject({ method: 'POST', url: '/admin/api/auth/login/2fa', payload: { challenge, code: totpCode(secret) }, headers: { 'user-agent': 'Other/1.0' } });
    expect(ok.statusCode).toBe(200);
    expect(ok.cookies.find((c) => c.name === 'shopme_session')).toBeDefined();
  });

  it('accepts each recovery code once', async () => {
    const challenge = ((await login()).json() as { challenge: string }).challenge;
    const use = (code: string) => t.app.inject({ method: 'POST', url: '/admin/api/auth/login/2fa', payload: { challenge, code } });
    expect((await use(recovery[0]!)).statusCode).toBe(200);
    expect((await use(recovery[0]!)).statusCode).toBe(401);
    expect((await call(owner, 'GET', '/admin/api/auth/security')).json()).toMatchObject({ twoFactor: { recoveryCodesLeft: 9 } });
  });

  it('mails a sign-in alert for a new device only', async () => {
    sent.length = 0;
    const c1 = ((await login()).json() as { challenge: string }).challenge;
    await t.app.inject({ method: 'POST', url: '/admin/api/auth/login/2fa', payload: { challenge: c1, code: totpCode(secret) }, headers: { 'user-agent': 'Brand-New-Device/9' } });
    await t.app.ready();
    await new Promise((r) => setTimeout(r, 50));
    expect(sent.filter((m) => /New sign-in/.test(m.subject))).toHaveLength(1);
    expect(sent[0]!.to).toBe('owner@example.com');
    expect(sent[0]!.html).toContain('Brand-New-Device/9');
  });

  it('lists active sessions and revokes them', async () => {
    const list = (await call(owner, 'GET', '/admin/api/auth/security')).json() as { sessions: Array<{ id: string; current: boolean }> };
    expect(list.sessions.length).toBeGreaterThan(2);
    expect(list.sessions.filter((x) => x.current)).toHaveLength(1);
    const other = list.sessions.find((x) => !x.current)!;
    expect((await call(owner, 'DELETE', `/admin/api/auth/sessions/${other.id}`)).statusCode).toBe(200);
    expect((await call(owner, 'DELETE', `/admin/api/auth/sessions/${other.id}`)).statusCode).toBe(404);
    const r = (await call(owner, 'POST', '/admin/api/auth/sessions/revoke-others', {})).json() as { revoked: number };
    expect(r.revoked).toBeGreaterThan(0);
    const after = (await call(owner, 'GET', '/admin/api/auth/security')).json() as { sessions: unknown[] };
    expect(after.sessions).toHaveLength(1);
  });

  it('enforces 2FA per shop for members who have not enrolled', async () => {
    const staff = await createStaffUser(t.dbHandle.db, { shopId, email: 'clerk@example.com', password: 'clerk-password', role: 'admin' });
    const sess = await createSession(t.dbHandle.db, { shopId, staffUserId: staff.id });
    const signed = t.app.signCookie(sess.token);
    expect((await gql(signed, '{ shop { name } }')).data.shop.name).toBe('Test Shop');
    expect((await call(owner, 'PUT', '/admin/api/auth/security', { require2fa: true })).statusCode).toBe(200);
    expect((await call(signed, 'PUT', '/admin/api/auth/security', { require2fa: false })).statusCode).toBe(200); // admins may still manage it
    expect((await call(owner, 'PUT', '/admin/api/auth/security', { require2fa: true })).statusCode).toBe(200);
    const blocked = await gql(signed, '{ shop { name } }');
    expect(blocked.errors?.[0]?.message).toMatch(/Access denied/);
    expect((await call(signed, 'GET', '/admin/api/auth/me')).json()).toMatchObject({ twoFactorSetupRequired: true });
    expect((await gql(owner, '{ shop { name } }')).data.shop.name).toBe('Test Shop'); // the owner is enrolled
    await call(owner, 'PUT', '/admin/api/auth/security', { require2fa: false });
  });

  it('turns two-step verification off with the password', async () => {
    expect((await call(owner, 'POST', '/admin/api/auth/2fa/disable', { password: 'wrong' })).statusCode).toBe(403);
    expect((await call(owner, 'POST', '/admin/api/auth/2fa/disable', { password: 'correct horse' })).statusCode).toBe(200);
    expect((await login()).json()).toMatchObject({ user: { email: 'owner@example.com' } });
  });
});

describe('security headers and caching', () => {
  it('sets storefront headers, a report-only CSP and an ETag with 304', async () => {
    const res = await t.app.inject({ method: 'GET', url: '/', headers: { 'user-agent': 'Googlebot' } });
    expect(res.headers['x-frame-options']).toBe('SAMEORIGIN');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
    expect(res.headers['content-security-policy']).toBe("frame-ancestors 'self'");
    expect(res.headers['content-security-policy-report-only']).toContain('report-uri /csp-report');
    expect(res.headers['strict-transport-security']).toBeUndefined();
    const etag = res.headers.etag as string;
    expect(etag).toMatch(/^W\//);
    const again = await t.app.inject({ method: 'GET', url: '/', headers: { 'user-agent': 'Googlebot', 'if-none-match': etag } });
    expect(again.statusCode).toBe(304);
    expect(again.body).toBe('');
    expect((await t.app.inject({ method: 'GET', url: '/', headers: { 'user-agent': 'Googlebot', 'if-none-match': 'W/"nope"' } })).statusCode).toBe(200);
    expect((await t.app.inject({ method: 'POST', url: '/csp-report', headers: { 'content-type': 'application/csp-report' }, payload: '{"csp-report":{}}' })).statusCode).toBe(204);
  });
  it('uses a strict CSP and no framing for the admin', async () => {
    const res = await t.app.inject({ method: 'GET', url: '/admin/' });
    expect(res.headers['x-frame-options']).toBe('DENY');
    expect(res.headers['content-security-policy']).toContain("script-src 'self'");
    expect(res.headers['content-security-policy']).toContain("frame-ancestors 'none'");
  });
  it('serves theme assets with an ETag and a long cache when versioned', async () => {
    const [theme] = await t.dbHandle.db.select().from(s.themes).where(eq(s.themes.role, 'MAIN'));
    const url = `/cdn/shop/t/${theme!.id}/assets/aurora.css`;
    const plain = await t.app.inject({ method: 'GET', url });
    expect(plain.statusCode).toBe(200);
    const versioned = await t.app.inject({ method: 'GET', url: `${url}?v=1`, headers: { 'if-none-match': plain.headers.etag as string } });
    expect(versioned.statusCode).toBe(304);
    expect(versioned.headers['cache-control']).toContain('immutable');
  });
  it('adds HSTS only with HSTS=true on an https URL', async () => {
    const h = await createTestApp({ HSTS: 'true', APP_URL: 'https://shop.example.com' });
    const res = await h.app.inject({ method: 'GET', url: '/healthz' });
    expect(res.headers['strict-transport-security']).toContain('max-age=31536000');
    await h.close();
    const plain = await createTestApp({ HSTS: 'true' });
    expect((await plain.app.inject({ method: 'GET', url: '/healthz' })).headers['strict-transport-security']).toBeUndefined();
    await plain.close();
  });
});

describe('languages and translations', () => {
  let productId: number;
  let handle: string;
  const gidOf = (type: string, id: number) => `gid://shopify/${type}/${id}`;

  beforeAll(async () => {
    const [p] = await t.dbHandle.db.select().from(s.products).where(eq(s.products.status, 'ACTIVE')).limit(1);
    productId = p!.id; handle = p!.handle;
  });

  it('manages shop locales', async () => {
    expect((await gql(owner, '{ shopLocales { locale primary published } }')).data.shopLocales).toEqual([{ locale: 'en', primary: true, published: true }]);
    const en = await gql(owner, 'mutation { shopLocaleEnable(locale: "fr") { shopLocale { locale name published } userErrors { message } } }');
    expect(en.data.shopLocaleEnable.shopLocale).toEqual({ locale: 'fr', name: 'French', published: false });
    expect((await gql(owner, 'mutation { shopLocaleEnable(locale: "fr") { userErrors { message } } }')).data.shopLocaleEnable.userErrors[0].message).toMatch(/taken/);
    expect((await gql(owner, 'mutation { shopLocaleDisable(locale: "en") { userErrors { message } } }')).data.shopLocaleDisable.userErrors[0].message).toMatch(/primary/);
  });

  it('lists translatable resources and registers translations (digest checked)', async () => {
    const q = (await gql(owner, `{ translatableResource(resourceId: "${gidOf('Product', productId)}") { resourceId translatableContent { key value digest } } translatableResources(resourceType: PRODUCT, first: 2) { nodes { resourceId } pageInfo { hasNextPage } } }`)).data;
    const title = q.translatableResource.translatableContent.find((c: { key: string }) => c.key === 'title');
    expect(q.translatableResources.nodes).toHaveLength(2);
    const reg = (value: string, digest: string, locale = 'fr') => gql(owner, `mutation($v: String!, $d: String!, $l: String!) { translationsRegister(resourceId: "${gidOf('Product', productId)}", translations: [{ locale: $l, key: "title", value: $v, translatableContentDigest: $d }]) { translations { key value outdated } userErrors { code message } } }`, { v: value, d: digest, l: locale });
    expect((await reg('x', 'bad-digest')).data.translationsRegister.userErrors[0].code).toBe('INVALID_TRANSLATABLE_CONTENT');
    expect((await reg('x', title.digest, 'de')).data.translationsRegister.userErrors[0].code).toBe('INVALID_LOCALE_FOR_SHOP');
    const ok = await reg('Titre traduit', title.digest);
    expect(ok.data.translationsRegister.translations).toEqual([{ key: 'title', value: 'Titre traduit', outdated: false }]);
    // Changing the source makes the translation outdated.
    await t.dbHandle.db.update(s.products).set({ title: 'Changed source' }).where(eq(s.products.id, productId));
    const after = (await gql(owner, `{ translatableResource(resourceId: "${gidOf('Product', productId)}") { translations(locale: "fr") { key outdated } } }`)).data;
    expect(after.translatableResource.translations).toEqual([{ key: 'title', outdated: true }]);
    await t.dbHandle.db.update(s.products).set({ title: String(title.value) }).where(eq(s.products.id, productId));
  });

  it('serves published locales under a prefix, translated, with hreflang and a language selector', async () => {
    const bot = { 'user-agent': 'Googlebot' };
    expect((await t.app.inject({ method: 'GET', url: `/fr/products/${handle}`, headers: bot })).statusCode).toBe(404); // not published yet
    await gql(owner, 'mutation { shopLocaleUpdate(locale: "fr", shopLocale: { published: true }) { shopLocale { published } } }');
    const fr = await t.app.inject({ method: 'GET', url: `/fr/products/${handle}`, headers: bot });
    expect(fr.statusCode).toBe(200);
    expect(fr.body).toContain('Titre traduit');
    expect(fr.body).toContain('<html lang="fr"');
    expect(fr.body).toContain(`hreflang="fr" href="http://localhost:3000/fr/products/${handle}"`);
    expect(fr.body).toContain(`hreflang="en" href="http://localhost:3000/products/${handle}"`);
    expect(fr.body).toContain('rel="canonical" href="http://localhost:3000/fr/products/' + handle);
    expect(fr.body).toContain('href="/fr/cart"'); // theme links keep the prefix
    expect(fr.body).toContain('href="/fr"');
    expect(fr.body).not.toContain('href="/cdn/shop/t/' + '/fr/'); // assets stay unprefixed
    expect(fr.body).toContain('name="language_code"');
    const en = await t.app.inject({ method: 'GET', url: `/products/${handle}`, headers: bot });
    expect(en.body).not.toContain('Titre traduit');
    expect(en.body).toContain('<html lang="en"');
    expect((await t.app.inject({ method: 'GET', url: '/fr', headers: bot })).statusCode).toBe(200);
  });

  it('switches language through POST /localization', async () => {
    const post = (body: Record<string, string>) => t.app.inject({ method: 'POST', url: '/localization', payload: new URLSearchParams(body).toString(), headers: { 'content-type': 'application/x-www-form-urlencoded' } });
    const r = await post({ language_code: 'fr', return_to: '/collections/all' });
    expect(r.statusCode).toBe(302);
    expect(r.headers.location).toBe('/fr/collections/all');
    expect((await post({ language_code: 'en', return_to: '/fr/collections/all' })).headers.location).toBe('/collections/all');
    expect((await post({ language_code: 'de', return_to: '/cart' })).headers.location).toBe('/cart');
    expect((await post({ language_code: 'fr', return_to: '//evil.example' })).headers.location).toBe('/fr');
  });

  it('translates theme strings and collections, pages and menus', async () => {
    const [theme] = await t.dbHandle.db.select().from(s.themes).where(eq(s.themes.role, 'MAIN'));
    const themeRes = (await gql(owner, `{ translatableResource(resourceId: "gid://shopify/OnlineStoreTheme/${theme!.id}") { translatableContent { key value digest } } }`)).data.translatableResource.translatableContent as Array<{ key: string; value: string; digest: string }>;
    const skip = themeRes.find((c) => c.key === 'accessibility.skip_to_content')!;
    expect(skip.value).toBe('Skip to content');
    const res = await gql(owner, `mutation { translationsRegister(resourceId: "gid://shopify/OnlineStoreTheme/${theme!.id}", translations: [{ locale: "fr", key: "accessibility.skip_to_content", value: "Aller au contenu (perso)", translatableContentDigest: "${skip.digest}" }]) { userErrors { message } } }`);
    expect(res.data.translationsRegister.userErrors).toEqual([]);
    const home = await t.app.inject({ method: 'GET', url: '/fr', headers: { 'user-agent': 'Googlebot' } });
    expect(home.body).toContain('Aller au contenu (perso)');
    const [col] = await t.dbHandle.db.select().from(s.collections).limit(1);
    const colRes = (await gql(owner, `{ translatableResource(resourceId: "gid://shopify/Collection/${col!.id}") { translatableContent { key digest } } }`)).data.translatableResource.translatableContent as Array<{ key: string; digest: string }>;
    await gql(owner, `mutation { translationsRegister(resourceId: "gid://shopify/Collection/${col!.id}", translations: [{ locale: "fr", key: "title", value: "Collection traduite", translatableContentDigest: "${colRes.find((c) => c.key === 'title')!.digest}" }]) { userErrors { message } } }`);
    const page = await t.app.inject({ method: 'GET', url: `/fr/collections/${col!.handle}`, headers: { 'user-agent': 'Googlebot' } });
    expect(page.body).toContain('Collection traduite');
    const removed = await gql(owner, `mutation { translationsRemove(resourceId: "gid://shopify/Collection/${col!.id}", translationKeys: ["title"], locales: ["fr"]) { translations { key } userErrors { message } } }`);
    expect(removed.data.translationsRemove.translations).toEqual([{ key: 'title' }]);
  });

  it('removes a locale together with its translations', async () => {
    const d = await gql(owner, 'mutation { shopLocaleDisable(locale: "fr") { locale userErrors { message } } }');
    expect(d.data.shopLocaleDisable.locale).toBe('fr');
    expect((await t.dbHandle.db.select({ n: count() }).from(s.translations))[0]!.n).toBe(0);
    expect((await t.app.inject({ method: 'GET', url: '/fr', headers: { 'user-agent': 'Googlebot' } })).statusCode).toBe(404);
  });
});

describe('store export, import and backups', () => {
  let archive: Uint8Array;
  let productCount: number;

  it('exports the whole store to a .shopme zip through a job', async () => {
    await gql(owner, 'mutation { shopLocaleEnable(locale: "es") { userErrors { message } } }');
    productCount = (await t.dbHandle.db.select({ n: count() }).from(s.products))[0]!.n;
    expect((await call(null, 'POST', '/admin/api/store/export', {})).statusCode).toBe(401);
    const start = await call(owner, 'POST', '/admin/api/store/export', {});
    expect(start.statusCode).toBe(202);
    const job = await waitJob(owner, (start.json() as { job: { id: number } }).job.id);
    expect(job.status).toBe('COMPLETED');
    const dl = await call(owner, 'GET', `/admin/api/store/export/${(start.json() as { job: { id: number } }).job.id}/download`);
    expect(dl.statusCode).toBe(200);
    expect(dl.headers['content-type']).toBe('application/zip');
    archive = new Uint8Array(dl.rawPayload);
    const files = unzipSync(archive);
    const manifest = JSON.parse(strFromU8(files['manifest.json']!));
    expect(manifest).toMatchObject({ format: 'shopme-export', formatVersion: 1 });
    expect(manifest.tables.products).toBe(productCount);
    expect(JSON.parse(strFromU8(files['data/products.json']!))).toHaveLength(productCount);
    expect(files['data/staff_users.json']).toBeUndefined(); // credentials never leave
    expect(files['data/sessions.json']).toBeUndefined();
    expect(Object.keys(files).some((k) => k.startsWith('data/theme_files'))).toBe(true);
    expect(JSON.parse(strFromU8(files['data/orders.json']!)).length).toBeGreaterThan(0);
  });

  it('imports into a fresh install, idempotently, keeping the local owner signed in', async () => {
    const fresh = await createTestApp();
    const cookie = await setupAndLogin(fresh.app);
    const send = (extra: Array<{ name: string; value: string }> = [], data: Uint8Array = archive) => {
      const m = multipart([...extra, { name: 'file', filename: 'store.shopme', data }]);
      return fresh.app.inject({ method: 'POST', url: '/admin/api/store/import', payload: m.payload, headers: m.headers, cookies: { shopme_session: cookie } });
    };
    const first = await send();
    expect(first.statusCode).toBe(202);
    const job = await waitJob(cookie, (first.json() as { job: { id: number } }).job.id, fresh);
    expect(job.error).toBeNull();
    expect(job.status).toBe('COMPLETED');
    const state = async () => {
      const db = fresh.dbHandle.db;
      return { products: (await db.select({ n: count() }).from(s.products))[0]!.n, orders: (await db.select({ n: count() }).from(s.orders))[0]!.n, variants: (await db.select({ n: count() }).from(s.productVariants))[0]!.n, files: (await db.select({ n: count() }).from(s.themeFiles))[0]!.n, locales: (await db.select({ n: count() }).from(s.shopLocales))[0]!.n };
    };
    const s1 = await state();
    expect(s1.products).toBe(productCount);
    expect(s1.orders).toBeGreaterThan(0);
    expect(s1.locales).toBe(1);
    expect((await call(cookie, 'GET', '/admin/api/auth/me', undefined, {}, fresh)).statusCode).toBe(200); // still signed in

    // The store is no longer empty: a second import must be confirmed, and then gives the same state.
    const refused = await send();
    expect(refused.statusCode).toBe(409);
    expect(refused.json()).toMatchObject({ needsConfirm: true });
    const second = await send([{ name: 'confirm', value: 'replace' }]);
    expect((await waitJob(cookie, (second.json() as { job: { id: number } }).job.id, fresh)).status).toBe('COMPLETED');
    expect(await state()).toEqual(s1);

    // New rows continue after the imported ids (sequences were reset).
    const [maxP] = await fresh.dbHandle.db.select({ id: s.products.id }).from(s.products).orderBy(s.products.id).limit(1);
    expect(maxP).toBeDefined();
    const created = await gql(cookie, 'mutation { productCreate(product: { title: "After import" }) { product { id } userErrors { message } } }', {}, fresh);
    expect(created.data.productCreate.userErrors).toEqual([]);
    // The imported storefront renders.
    expect((await fresh.app.inject({ method: 'GET', url: '/', headers: { 'user-agent': 'Googlebot' } })).statusCode).toBe(200);
    await fresh.close();
  });

  it('checks the format and database versions', async () => {
    const fresh = await createTestApp();
    const cookie = await setupAndLogin(fresh.app);
    const tamper = (patch: Record<string, unknown>) => {
      const files = unzipSync(archive);
      const manifest = { ...JSON.parse(strFromU8(files['manifest.json']!)), ...patch };
      return new (globalThis as any).TextEncoder().encode(JSON.stringify(manifest)) as Uint8Array;
    };
    const { zipSync } = await import('fflate');
    const rebuild = (patch: Record<string, unknown>) => zipSync({ ...unzipSync(archive), 'manifest.json': tamper(patch) });
    const run = async (data: Uint8Array) => {
      const m = multipart([{ name: 'file', filename: 'x.shopme', data }]);
      const r = await fresh.app.inject({ method: 'POST', url: '/admin/api/store/import', payload: m.payload, headers: m.headers, cookies: { shopme_session: cookie } });
      return waitJob(cookie, (r.json() as { job: { id: number } }).job.id, fresh);
    };
    expect((await run(rebuild({ schemaVersion: 999 }))).error).toMatch(/newer ShopMe/);
    expect((await run(rebuild({ formatVersion: 99 }))).error).toMatch(/format version 99/);
    expect((await run(rebuild({ format: 'something-else' }))).error).toMatch(/not a ShopMe export/);
    expect((await run(new Uint8Array([1, 2, 3]))).error).toMatch(/not a valid/);
    expect((await fresh.dbHandle.db.select({ n: count() }).from(s.products))[0]!.n).toBe(0); // nothing was written
    await fresh.close();
  });

  it('runs scheduled backups with retention', async () => {
    await call(owner, 'PUT', '/admin/api/store/backups/settings', { enabled: true, intervalHours: 1, keep: 2 });
    const { db } = t.dbHandle;
    const storage = t.app.ctx.storage;
    const dir = t.app.ctx.config.dataDir;
    const mk = (at: Date) => runScheduledBackup(db, storage, shopId, dir, '0.1.0', at);
    const bdir = path.join(dir, 'backups');
    const age = () => { const f = readdirSync(bdir).filter((n) => n.startsWith('backup-')).map((n) => path.join(bdir, n)); const old = new Date(Date.now() - 3 * 3600_000); f.forEach((x) => utimesSync(x, old, old)); };
    expect(await mk(new Date('2026-01-01T00:00:00Z'))).toBe('backup-2026-01-01T00-00-00Z.shopme');
    expect(await mk(new Date())).toBeNull(); // the newest is younger than the interval
    for (let k = 1; k <= 4; k++) { age(); expect(await mk(new Date(Date.now() + k * 60_000))).toMatch(/^backup-/); }
    const list = (await call(owner, 'GET', '/admin/api/store/backups')).json() as { backups: Array<{ name: string }>; settings: { keep: number } };
    expect(list.settings.keep).toBe(2);
    expect(list.backups.length).toBeLessThanOrEqual(2);
    expect(list.backups.length).toBeGreaterThan(0);
    const name = list.backups[0]!.name;
    const dl = await call(owner, 'GET', `/admin/api/store/backups/${name}`);
    expect(dl.statusCode).toBe(200);
    expect(JSON.parse(strFromU8(unzipSync(new Uint8Array(dl.rawPayload))['manifest.json']!)).format).toBe('shopme-export');
    expect((await call(owner, 'GET', '/admin/api/store/backups/..%2Fsession-secret')).statusCode).toBe(404);
    expect(readFileSync(path.join(dir, 'backups', name)).length).toBeGreaterThan(100);
    await call(owner, 'DELETE', `/admin/api/store/backups/${name}`);
  });
});
