import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { createAccount, getEmailSettings, listDkimKeys, schema as s, type DnsResolver } from '@shopme/core';
import { createTestApp, type TestApp } from './test-utils';
import { startSmtp, verifyDkim, type FakeSmtp } from './email/test-smtp';

/** Multi-store: e-mail settings, DKIM keys and the outbox belong to each store; every store signs with its own domain. */
const ADMIN = 'localhost';
const nf = () => Object.assign(new Error('not found'), { code: 'ENOTFOUND' });
const resolver: DnsResolver = {
  resolveTxt: async () => { throw nf(); }, resolveCname: async () => { throw nf(); },
  resolveMx: async (n) => { if (n === 'inbox.example.org') return [{ exchange: 'mx.example.org', priority: 10 }]; throw nf(); },
  resolve4: async () => { throw nf(); }, resolve6: async () => { throw nf(); }, reverse: async () => { throw nf(); },
};

let t: TestApp;
let mx: FakeSmtp;
let alice: string, bob: string;
let shopA: number, shopB: number;
const db = () => t.dbHandle.db;
const cookieOf = (r: { cookies: Array<{ name: string; value: string }> }) => r.cookies.find((c) => c.name === 'shopme_session')!.value;
const gql = async (cookie: string, handle: string, query: string, variables: Record<string, unknown> = {}) => {
  const r = await t.app.inject({ method: 'POST', url: `/admin/store/${handle}/api/2026-10/graphql.json`, headers: { host: ADMIN }, cookies: { shopme_session: cookie }, payload: { query, variables } });
  const body = r.json() as { data?: any; errors?: unknown };
  expect(body.errors, JSON.stringify(body.errors)).toBeUndefined();
  return body.data;
};
const SETTINGS = 'mutation($i: ShopmeEmailInput!) { shopmeEmailSettingsUpdate(input: $i) { settings userErrors { message } } }';
const sender = (c: string, h: string, a: string) => gql(c, h, `mutation { shopmeNotificationSettingsUpdate(senderName: "N", senderEmail: "${a}") { userErrors { message } } }`);

beforeAll(async () => {
  t = await createTestApp({ MULTI_STORE: 'true', STORE_BASE_DOMAIN: 'shops.example.org' });
  const setup = await t.app.inject({ method: 'POST', url: '/admin/api/setup', headers: { host: ADMIN }, payload: { shopName: 'Alpha Store', email: 'alice@example.com', password: 'alice-password', currency: 'EUR', country: 'FR', locale: 'en' } });
  expect(setup.statusCode, setup.body).toBe(201);
  alice = cookieOf(setup);
  await t.app.inject({ method: 'PUT', url: '/admin/api/platform/settings', headers: { host: ADMIN }, cookies: { shopme_session: alice }, payload: { storeCreation: 'EVERYONE' } });
  await createAccount(db(), { email: 'bob@example.com', password: 'bob-password' });
  bob = cookieOf(await t.app.inject({ method: 'POST', url: '/admin/api/auth/login', headers: { host: ADMIN }, payload: { email: 'bob@example.com', password: 'bob-password' } }));
  const created = await t.app.inject({ method: 'POST', url: '/admin/api/account/stores', headers: { host: ADMIN }, cookies: { shopme_session: bob }, payload: { shopName: 'Beta Shop', currency: 'USD', country: 'US', locale: 'en' } });
  expect(created.statusCode, created.body).toBe(201);
  shopA = (await db().select().from(s.shops).where(eq(s.shops.handle, 'alpha-store')))[0]!.id;
  shopB = (await db().select().from(s.shops).where(eq(s.shops.handle, 'beta-shop')))[0]!.id;
  mx = await startSmtp();
  t.app.ctx.email.deps = { resolver, probe: async () => ({ ok: true }), detectIp: async () => ({ v4: '203.0.113.9', v6: null }), direct: { target: () => ({ host: '127.0.0.1', port: mx.port }) } };
  await sender(alice, 'alpha-store', 'hello@alpha-example.fr');
  await sender(bob, 'beta-shop', 'contact@beta-example.com');
  for (const [c, h] of [[alice, 'alpha-store'], [bob, 'beta-shop']] as const) await gql(c, h, SETTINGS, { i: { mode: 'direct' } });
}, 180_000);
afterAll(async () => { await mx?.close(); await t?.close(); });

const send = async (shopId: number, subject: string) => {
  const before = mx.messages.length;
  await t.app.ctx.mailer.send({ to: 'buyer@inbox.example.org', subject, text: 'x', shopId, from: undefined, fromName: 'S' });
  await t.app.ctx.queue.idle();
  return mx.messages.slice(before)[0]!;
};

describe('e-mail per store', () => {
  it('each store has its own sending domain, DKIM key, records and settings', async () => {
    const ra = (await gql(alice, 'alpha-store', '{ shopmeEmailRecords }')).shopmeEmailRecords;
    const rb = (await gql(bob, 'beta-shop', '{ shopmeEmailRecords }')).shopmeEmailRecords;
    expect(ra.domain).toBe('alpha-example.fr');
    expect(rb.domain).toBe('beta-example.com');
    expect(ra.dkim.value).not.toBe(rb.dkim.value);
    expect((await listDkimKeys(db(), shopA, 'alpha-example.fr')).length).toBe(1);
    expect((await listDkimKeys(db(), shopA, 'beta-example.com')).length).toBe(0);
    expect((await listDkimKeys(db(), shopB, 'beta-example.com')).length).toBe(1);
    // a relay set up by Alpha is invisible to Beta
    await gql(alice, 'alpha-store', SETTINGS, { i: { preset: 'brevo', host: 'smtp-relay.brevo.com', port: 587, security: 'starttls', username: 'alpha-user', password: 'alpha-secret' } });
    const sb = (await gql(bob, 'beta-shop', '{ shopmeEmailSettings }')).shopmeEmailSettings;
    expect(sb.relay).toMatchObject({ host: '', passwordSet: false, username: '' });
    expect((await getEmailSettings(db(), shopB))!.relayPasswordEnc).toBeNull();
    expect(JSON.stringify(sb)).not.toContain('alpha');
  });

  it('every store signs with its own domain and key; the outbox lists only its own messages', async () => {
    const a = await send(shopA, 'Alpha mail');
    const b = await send(shopB, 'Beta mail');
    expect(a.from).toBe('hello@alpha-example.fr');
    expect(b.from).toBe('contact@beta-example.com');
    const ka = (await listDkimKeys(db(), shopA, 'alpha-example.fr'))[0]!;
    const kb = (await listDkimKeys(db(), shopB, 'beta-example.com'))[0]!;
    expect(verifyDkim(a.data, ka.publicKey)).toMatchObject({ ok: true, domain: 'alpha-example.fr' });
    expect(verifyDkim(b.data, kb.publicKey)).toMatchObject({ ok: true, domain: 'beta-example.com' });
    expect(verifyDkim(a.data, kb.publicKey).ok).toBe(false);
    const ob = (await gql(bob, 'beta-shop', '{ shopmeEmailOutbox(first: 50) }')).shopmeEmailOutbox as Array<{ subject: string; from: string }>;
    expect(ob.map((r) => r.subject)).toEqual(['Beta mail']);
    const oa = (await gql(alice, 'alpha-store', '{ shopmeEmailOutbox(first: 50) }')).shopmeEmailOutbox as Array<{ subject: string }>;
    expect(oa.map((r) => r.subject)).toEqual(['Alpha mail']);
  });

  it('the platform domain is STORE_BASE_DOMAIN; only the platform owner reaches the platform e-mail routes', async () => {
    expect(t.app.ctx.email.platformDomain()).toBe('shops.example.org');
    const call = (cookie: string | null, method: 'GET' | 'POST' | 'PUT', url: string, payload?: unknown) => t.app.inject({ method, url: `/admin/api/platform/email/${url}`, headers: { host: ADMIN }, cookies: cookie ? { shopme_session: cookie } : {}, payload: payload as never });
    expect((await call(null, 'GET', 'settings')).statusCode).toBe(401);
    expect((await call(bob, 'GET', 'settings')).statusCode).toBe(403);
    expect((await call(bob, 'POST', 'check')).statusCode).toBe(403);
    const ok = await call(alice, 'GET', 'settings');
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({ scope: 'platform', sendingDomain: 'shops.example.org' });
    const rec = (await call(alice, 'GET', 'records')).json();
    expect(rec.domain).toBe('shops.example.org');
    expect((await listDkimKeys(db(), null, 'shops.example.org')).length).toBe(1);
    expect((await call(alice, 'PUT', 'settings', { host: '127.0.0.1' })).statusCode).toBe(422);
    const checked = (await call(alice, 'POST', 'check')).json();
    expect(checked.records.map((r: { id: string }) => r.id)).toEqual(['spf', 'dkim', 'dmarc']);
    // the test send of the platform is rate limited too
    let last = 0;
    for (let i = 0; i < 6; i++) last = (await call(alice, 'POST', 'test', { to: 'x@inbox.example.org' })).statusCode;
    expect(last).toBe(429);
    // the platform identity is its own scope: stores' settings are untouched
    expect((await getEmailSettings(db(), shopA))!.id).not.toBe((await getEmailSettings(db(), null))!.id);
  });
});
