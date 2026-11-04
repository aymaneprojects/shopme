import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApiToken, getPrimaryShop } from '@shopme/core';
import { startServer } from './start';
import { createTestApp, SETUP_BODY, setupAndLogin, type TestApp } from './test-utils';

describe('auth flow', () => {
  let t: TestApp;
  beforeAll(async () => { t = await createTestApp(); }, 60_000);
  afterAll(async () => { await t.close(); });

  it('healthz', async () => {
    const r = await t.app.inject('/healthz');
    expect(r.json()).toEqual({ status: 'ok', db: 'pglite' });
  });

  it('setup -> me -> logout -> login', async () => {
    expect((await t.app.inject('/admin/api/setup/status')).json()).toEqual({ needsSetup: true });
    expect((await t.app.inject('/admin/api/auth/me')).statusCode).toBe(401);

    const bad = await t.app.inject({ method: 'POST', url: '/admin/api/setup', payload: { ...SETUP_BODY, password: 'x' } });
    expect(bad.statusCode).toBe(422);

    const setup = await t.app.inject({ method: 'POST', url: '/admin/api/setup', payload: SETUP_BODY });
    expect(setup.statusCode).toBe(201);
    const cookie = setup.cookies.find((c) => c.name === 'shopme_session')!;
    expect(cookie.httpOnly).toBe(true);
    expect(String(cookie.sameSite).toLowerCase()).toBe('lax');
    expect((await t.app.inject('/admin/api/setup/status')).json()).toEqual({ needsSetup: false });
    expect((await t.app.inject({ method: 'POST', url: '/admin/api/setup', payload: SETUP_BODY })).statusCode).toBe(409);

    const me = await t.app.inject({ url: '/admin/api/auth/me', cookies: { shopme_session: cookie.value } });
    expect(me.statusCode).toBe(200);
    expect(me.json()).toMatchObject({ user: { email: 'owner@example.com', role: 'owner' }, shop: { name: 'Test Shop', currency: 'EUR' } });

    // tampered cookie is rejected
    expect((await t.app.inject({ url: '/admin/api/auth/me', cookies: { shopme_session: cookie.value + 'x' } })).statusCode).toBe(401);

    await t.app.inject({ method: 'POST', url: '/admin/api/auth/logout', cookies: { shopme_session: cookie.value } });
    expect((await t.app.inject({ url: '/admin/api/auth/me', cookies: { shopme_session: cookie.value } })).statusCode).toBe(401);

    const login = await t.app.inject({ method: 'POST', url: '/admin/api/auth/login', payload: { email: 'OWNER@example.com', password: 'correct horse' } });
    expect(login.statusCode).toBe(200);
    expect(login.json().user.email).toBe('owner@example.com');
  });

  it('rate-limits failed logins', async () => {
    let last = 0;
    for (let i = 0; i < 12; i++) {
      const r = await t.app.inject({ method: 'POST', url: '/admin/api/auth/login', remoteAddress: '10.0.0.9', payload: { email: 'nobody@example.com', password: 'nope' } });
      last = r.statusCode;
      if (last === 429) { expect(r.headers['retry-after']).toBeDefined(); break; }
      expect(last).toBe(401);
    }
    expect(last).toBe(429);
  });

  it('blocks cross-origin mutating requests', async () => {
    const r = await t.app.inject({ method: 'POST', url: '/admin/api/auth/login', headers: { origin: 'https://evil.example' }, payload: { email: 'a@b.co', password: 'x' } });
    expect(r.statusCode).toBe(403);
    const same = await t.app.inject({ method: 'POST', url: '/admin/api/auth/logout', headers: { origin: 'http://localhost:3000', host: 'localhost:3000' } });
    expect(same.statusCode).toBe(200);
  });

  it('shows a friendly page when the admin is not built', async () => {
    const r = await t.app.inject({ url: '/admin/' });
    expect(r.statusCode).toBe(200);
    expect(r.body).toContain('Admin not built');
    expect((await t.app.inject('/admin/api/nope')).statusCode).toBe(404);
    expect((await t.app.inject('/')).body).toContain('class="template-index"');
  });
});

describe('admin GraphQL', () => {
  let t: TestApp;
  let cookie: string;
  const gql = (query: string, extra: Record<string, unknown> = {}, version = '2026-10') =>
    t.app.inject({ method: 'POST', url: `/admin/api/${version}/graphql.json`, payload: { query }, ...extra });
  beforeAll(async () => { t = await createTestApp(); cookie = await setupAndLogin(t.app); }, 60_000);
  afterAll(async () => { await t.close(); });

  it('rejects unauthenticated requests', async () => {
    const r = await gql('{ shop { name } }');
    expect(r.statusCode).toBe(401);
    expect((await gql('{ shop { name } }', { headers: { 'x-shopify-access-token': 'bogus' } })).statusCode).toBe(401);
  });

  it('serves the shop query with a session', async () => {
    const r = await gql('{ shop { id name currencyCode currencyFormats { moneyFormat } primaryDomain { host } createdAt } }', { cookies: { shopme_session: cookie } });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.errors).toBeUndefined();
    expect(body.data.shop).toMatchObject({ name: 'Test Shop', currencyCode: 'EUR' });
    expect(body.data.shop.id).toMatch(/^gid:\/\/shopify\/Shop\/\d+$/);
    expect(body.data.shop.createdAt).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);
    expect(body.extensions.cost.throttleStatus.maximumAvailable).toBe(2000);
  });

  it('accepts an api token header and any version string', async () => {
    const shop = (await getPrimaryShop(t.dbHandle.db))!;
    const { token } = await createApiToken(t.dbHandle.db, { shopId: shop.id, name: 'ci', scopes: ['read_shop'] });
    const r = await gql('{ shop { name } }', { headers: { 'x-shopify-access-token': token } }, 'unstable');
    expect(r.json().data.shop.name).toBe('Test Shop');
    expect((await gql('{ shop { name } }', { headers: { 'x-shopify-access-token': token } }, '2099-01')).statusCode).toBe(200);
    expect((await gql('{ shop { name } }', { cookies: { shopme_session: cookie } }, 'v1')).statusCode).toBe(404);
  });

  it('enforces token scopes', async () => {
    const shop = (await getPrimaryShop(t.dbHandle.db))!;
    const { token } = await createApiToken(t.dbHandle.db, { shopId: shop.id, name: 'noscope', scopes: ['read_products'] });
    const r = await gql('{ shop { name } }', { headers: { 'x-shopify-access-token': token } });
    expect(r.json().errors[0].extensions.code).toBe('ACCESS_DENIED');
  });

  it('resolves node/nodes by GID and null for unknown or foreign ids', async () => {
    const shop = (await getPrimaryShop(t.dbHandle.db))!;
    const gid = `gid://shopify/Shop/${shop.id}`;
    const r = await gql(`{ node(id: "${gid}") { id ... on Shop { name } } nodes(ids: ["${gid}", "gid://shopify/Shop/99999", "gid://shopify/Nothing/1"]) { id } }`, { cookies: { shopme_session: cookie } });
    const d = r.json().data;
    expect(d.node).toEqual({ id: gid, name: 'Test Shop' });
    expect(d.nodes).toEqual([{ id: gid }, null, null]);
    const bad = await gql('{ node(id: "garbage") { id } }', { cookies: { shopme_session: cookie } });
    expect(bad.json().errors[0].extensions.code).toBe('INVALID_GLOBAL_ID');
  });

  it('reports validation errors for unknown fields (HTTP 200)', async () => {
    const r = await gql('{ shop { doesNotExist } }', { cookies: { shopme_session: cookie } });
    expect(r.statusCode).toBe(200);
    expect(r.json().errors[0].message).toContain('doesNotExist');
  });
});

describe('uploads', () => {
  let t: TestApp;
  let cookie: string;
  beforeAll(async () => { t = await createTestApp(); cookie = await setupAndLogin(t.app); }, 60_000);
  afterAll(async () => { await t.close(); });

  it('uploads and serves a file', async () => {
    const boundary = 'XBOUNDARYX';
    const payload = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="hello.txt"\r\nContent-Type: text/plain\r\n\r\nhi there\r\n--${boundary}--\r\n`;
    const headers = { 'content-type': `multipart/form-data; boundary=${boundary}` };
    expect((await t.app.inject({ method: 'POST', url: '/admin/api/files', headers, payload })).statusCode).toBe(401);
    const r = await t.app.inject({ method: 'POST', url: '/admin/api/files', headers, payload, cookies: { shopme_session: cookie } });
    expect(r.statusCode).toBe(201);
    const { url } = r.json().file;
    const got = await t.app.inject(url);
    expect(got.statusCode).toBe(200);
    expect(got.body).toBe('hi there');
    expect(got.headers['x-content-type-options']).toBe('nosniff');
    expect((await t.app.inject('/files/../../etc/passwd')).statusCode).toBeGreaterThanOrEqual(400);
  });
});

describe('startServer (programmatic API)', () => {
  it('listens on a free port, serves requests and closes', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'shopme-start-'));
    const server = await startServer({ port: 0, host: '127.0.0.1', dataDir: dir, logger: false, env: { NODE_ENV: 'test' } });
    try {
      expect(server.port).toBeGreaterThan(0);
      expect(server.url).toBe(`http://127.0.0.1:${server.port}`);
      const res = await fetch(`${server.url}/healthz`);
      expect(await res.json()).toEqual({ status: 'ok', db: 'pglite' });
      expect(server.config.appUrl).toBe(`http://localhost:${server.port}`);
    } finally {
      await server.close();
    }
  }, 60_000);
});
