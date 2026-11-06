import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { schema as s } from '@shopme/core';
import { createTestApp, SETUP_BODY, type TestApp } from './test-utils';

/** A server installed for one domain: the admin and the first store's storefront share `boutique.test`. */
const DOMAIN = 'boutique.test';
const TOKEN = 'hosts-token-0123456789';
let t: TestApp;
let cookie: string;

const get = (url: string, host = DOMAIN, extra: Record<string, string> = {}, c?: string) =>
  t.app.inject({ method: 'GET', url, headers: { host, ...extra }, cookies: c ? { shopme_session: c } : {} });

beforeAll(async () => {
  t = await createTestApp({ MULTI_STORE: 'true', APP_URL: `https://${DOMAIN}`, STORE_BASE_DOMAIN: DOMAIN, HOSTS_TOKEN: TOKEN });
  const res = await t.app.inject({ method: 'POST', url: '/admin/api/setup', headers: { host: DOMAIN }, payload: { ...SETUP_BODY, shopName: 'Boutique' } });
  expect(res.statusCode, res.body).toBe(201);
  cookie = res.cookies.find((c) => c.name === 'shopme_session')!.value;
});
afterAll(async () => { await t.close(); });

describe('admin host equal to the first store host', () => {
  it('records the install domain as the first store primary domain, verified', async () => {
    expect(t.app.ctx.config.installDomain).toBe(DOMAIN);
    const [shop] = await t.app.ctx.db.select().from(s.shops);
    expect(shop!.primaryDomain).toBe(DOMAIN);
    const [d] = await t.app.ctx.db.select().from(s.shopDomains).where(eq(s.shopDomains.shopId, shop!.id));
    expect(d).toMatchObject({ host: DOMAIN });
    expect(d!.verifiedAt).toBeTruthy();
    expect(t.app.ctx.stores.idForHostSync(DOMAIN)).toBe(shop!.id);
  });

  it('serves the storefront on non-admin paths and the admin on /admin', async () => {
    const home = await get('/');
    expect(home.statusCode).toBe(200);
    expect(home.headers.location).toBeUndefined();
    expect(home.body).not.toContain('Store not found');
    const status = await get('/admin/api/setup/status');
    expect(status.json()).toEqual({ needsSetup: false });
    const me = await get('/admin/api/auth/me', DOMAIN, {}, cookie);
    expect(me.statusCode).toBe(200);
    expect(me.json().multiStore).toBe(true);
    expect((await get('/admin/api/account/stores', DOMAIN, {}, cookie)).statusCode).toBe(200);
  });

  it('redirects the permanent store host to the install domain and keeps its admin paths', async () => {
    const handle = t.app.ctx.stores.all()[0]!.handle;
    const r = await get('/collections/all', `${handle}.${DOMAIN}`);
    expect(r.statusCode).toBe(301);
    expect(r.headers.location).toBe(`https://${DOMAIN}/collections/all`);
  });

  it('accepts same-origin posts and cookies on the shared host, refuses other origins', async () => {
    const post = (origin: string) => t.app.inject({ method: 'POST', url: '/admin/api/auth/logout', headers: { host: DOMAIN, origin }, cookies: { shopme_session: cookie } });
    expect((await post(`https://evil.test`)).statusCode).toBe(403);
    const ok = await t.app.inject({ method: 'POST', url: '/admin/api/auth/login', headers: { host: DOMAIN, origin: `https://${DOMAIN}` }, payload: { email: SETUP_BODY.email, password: SETUP_BODY.password } });
    expect(ok.statusCode, ok.body).toBe(200);
    expect(ok.cookies.find((c) => c.name === 'shopme_session')!.secure).toBe(true);
  });

  it('answers the TLS ask for the install domain and its store hosts', async () => {
    expect((await get(`/__shopme/tls-ask?domain=${DOMAIN}`)).statusCode).toBe(200);
    const handle = t.app.ctx.stores.all()[0]!.handle;
    expect((await get(`/__shopme/tls-ask?domain=${handle}.${DOMAIN}`)).statusCode).toBe(200);
    expect((await get('/__shopme/tls-ask?domain=other.test')).statusCode).toBe(404);
  });
});

describe('local hosts endpoint', () => {
  const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
  it('lists the hosts for the certificate sync with the token, from the machine itself', async () => {
    const handle = t.app.ctx.stores.all()[0]!.handle;
    const r = await get('/__shopme/hosts', '127.0.0.1:3000', bearer(TOKEN));
    expect(r.statusCode).toBe(200);
    expect(r.json().hosts).toEqual([DOMAIN, `${handle}.${DOMAIN}`].sort());
  });
  it('answers 404 without or with a wrong token', async () => {
    expect((await get('/__shopme/hosts', '127.0.0.1:3000')).statusCode).toBe(404);
    expect((await get('/__shopme/hosts', '127.0.0.1:3000', bearer('wrong-token-wrong-token'))).statusCode).toBe(404);
  });
  it('answers 404 when the request came through a proxy or from another address', async () => {
    expect((await get('/__shopme/hosts', DOMAIN, { ...bearer(TOKEN), 'x-forwarded-for': '203.0.113.9' })).statusCode).toBe(404);
    const remote = await t.app.inject({ method: 'GET', url: '/__shopme/hosts', remoteAddress: '203.0.113.9', headers: { host: DOMAIN, ...bearer(TOKEN) } });
    expect(remote.statusCode).toBe(404);
    // the Docker bridge gateway (host to published port) is local
    const bridge = await t.app.inject({ method: 'GET', url: '/__shopme/hosts', remoteAddress: '172.18.0.1', headers: { host: '127.0.0.1:3200', ...bearer(TOKEN) } });
    expect(bridge.statusCode).toBe(200);
  });
  it('is off without HOSTS_TOKEN and in single-store mode', async () => {
    const off = await createTestApp({ MULTI_STORE: 'true', STORE_BASE_DOMAIN: 'x.test' });
    expect((await off.app.inject({ url: '/__shopme/hosts', headers: { host: '127.0.0.1', ...bearer(TOKEN) } })).statusCode).toBe(404);
    await off.close();
    const single = await createTestApp({ MULTI_STORE: 'false', HOSTS_TOKEN: TOKEN });
    expect((await single.app.inject({ url: '/__shopme/hosts', headers: { host: '127.0.0.1', ...bearer(TOKEN) } })).statusCode).toBe(404);
    await single.close();
  });
});

describe('account routes stay on the admin host', () => {
  it('are not served on a store host, even with a valid session cookie', async () => {
    const handle = t.app.ctx.stores.all()[0]!.handle;
    const host = `${handle}.${DOMAIN}`;
    for (const [method, url] of [['GET', '/admin/api/account/stores'], ['GET', '/admin/api/platform/stores'], ['POST', '/admin/api/auth/login'], ['POST', '/admin/api/auth/logout']] as const) {
      const r = await t.app.inject({ method, url, headers: { host }, cookies: { shopme_session: cookie }, payload: method === 'POST' ? {} : undefined });
      expect(r.statusCode, `${method} ${url}`).toBe(404);
    }
    // the same routes work on the admin host
    expect((await get('/admin/api/platform/stores', DOMAIN, {}, cookie)).statusCode).toBe(200);
  });
});

describe('origin check with Fetch Metadata and no Origin', () => {
  const post = (site?: string) => t.app.inject({ method: 'POST', url: '/admin/api/auth/logout', headers: { host: DOMAIN, ...(site ? { 'sec-fetch-site': site } : {}) }, cookies: { shopme_session: cookie } });
  it('refuses same-site and cross-site', async () => {
    expect((await post('same-site')).statusCode).toBe(403);
    expect((await post('cross-site')).statusCode).toBe(403);
  });
  it('accepts same-origin, none, and clients that send no Fetch Metadata', async () => {
    expect((await post('same-origin')).statusCode).not.toBe(403);
    expect((await post('none')).statusCode).not.toBe(403);
    expect((await post()).statusCode).not.toBe(403);
  });
});
