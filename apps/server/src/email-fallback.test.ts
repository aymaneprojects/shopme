import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { getEmailSettings, getPrimaryShop, listDkimKeys, dkimTxtValue, schema as s, type DnsResolver } from '@shopme/core';
import { MULTI_STORE_RUN, createTestApp, setupAndLogin, type TestApp } from './test-utils';
import { makeGql, makeGqlOk } from '../test/conformance/helpers';
import { startSmtp, verifyDkim, type FakeSmtp } from './email/test-smtp';

/**
 * The From that goes out. A store whose domain is not authenticated (or whose sender is a free mailbox) sends From the platform's
 * authenticated address with its name and Reply-To; it switches to its own address once its checks pass. Platform domain: the APP_URL
 * host (single-store) or STORE_BASE_DOMAIN / ADMIN_HOST (multi-store).
 */
const PLATFORM = MULTI_STORE_RUN ? 'platform-test.fr' : 'shop.platform-test.fr';
const dns = { txt: {} as Record<string, string[]> };
const nf = () => Object.assign(new Error('not found'), { code: 'ENOTFOUND' });
const resolver: DnsResolver = {
  resolveTxt: async (n) => { const v = dns.txt[n]; if (!v) throw nf(); return v.map((x) => [x]); },
  resolveCname: async () => { throw nf(); }, resolveMx: async (n) => { if (n === 'inbox.example.org') return [{ exchange: 'mx.example.org', priority: 10 }]; throw nf(); },
  resolve4: async () => { throw nf(); }, resolve6: async () => { throw nf(); }, reverse: async () => { throw nf(); },
};

let t: TestApp;
let g: ReturnType<typeof makeGqlOk>;
let shopId: number;
let mx: FakeSmtp;
const db = () => t.dbHandle.db;
const email = () => t.app.ctx.email;
const flush = () => t.app.ctx.queue.idle();
const setSender = (addr: string) => g(`mutation { shopmeNotificationSettingsUpdate(senderName: "Ma Boutique", senderEmail: "${addr}") { userErrors { message } } }`);
const send = async (subject: string) => {
  const before = mx.messages.length;
  await t.app.ctx.mailer.send({ to: 'buyer@inbox.example.org', subject, text: 'x', shopId, from: undefined, fromName: 'Ma Boutique' });
  await flush();
  return mx.messages.slice(before)[0]!;
};
/** Publish all records of a scope in the fake DNS, so its check passes. */
async function publish(scope: number | null, domain: string) {
  const r = await email().records(scope);
  dns.txt[domain] = [r.records[0]!.value];
  dns.txt[r.dkim!.host] = [r.dkim!.value];
  return r;
}

beforeAll(async () => {
  t = await createTestApp({ APP_URL: 'https://shop.platform-test.fr', STORE_BASE_DOMAIN: 'platform-test.fr', ADMIN_HOST: 'localhost' });
  g = makeGqlOk(makeGql(t.app, await setupAndLogin(t.app)));
  shopId = (await getPrimaryShop(db()))!.id;
  mx = await startSmtp();
  email().deps = { resolver, probe: async () => ({ ok: true }), detectIp: async () => ({ v4: '203.0.113.9', v6: null }), direct: { target: () => ({ host: '127.0.0.1', port: mx.port }) } };
  await g('mutation { shopmeEmailSettingsUpdate(input: { mode: "direct" }) { userErrors { message } } }');
}, 90_000);
afterAll(async () => { await mx?.close(); await t?.close(); });

describe('the From of a store', () => {
  it('the platform domain comes from APP_URL (single-store) or STORE_BASE_DOMAIN / ADMIN_HOST (multi-store); local names are no domain', () => {
    expect(email().platformDomain()).toBe(PLATFORM);
    const local = (url: string, base: string, multi: boolean) => {
      const svc = new (email().constructor as new (c: unknown) => typeof t.app.ctx.email)({ ...t.app.ctx, config: { ...t.app.ctx.config, appUrl: url, multiStore: multi, storeBaseDomain: base, adminHosts: [new URL(url).hostname] } });
      return svc.platformDomain();
    };
    expect(local('http://localhost:3000', 'localhost', false)).toBeNull();
    expect(local('https://admin.shops.example.com', 'shops.example.com', true)).toBe('shops.example.com');
    expect(local('https://admin.example.com', 'localhost', true)).toBe('admin.example.com');
    expect(local('https://shop.example.com', 'shops.example.com', false)).toBe('shop.example.com');
  });

  it('nothing is authenticated yet: the store address is tried, but the store is reported as not deliverable', async () => {
    await setSender('hello@boutique-test.fr');
    const m = await send('Before any DNS');
    expect(m.from).toBe('hello@boutique-test.fr');
    const v = await email().view(shopId);
    expect(v.from).toMatchObject({ kind: 'store', reason: 'unverified_nowhere', deliverable: false });
    expect((await g('{ shopmeEmailHealth }')).shopmeEmailHealth).toMatchObject({ status: 'unchecked', reasons: ['not_set_up'] });
  });

  it('once the platform domain is authenticated, an unauthenticated store sends on its behalf with its name and Reply-To', async () => {
    const r = await publish(null, PLATFORM);
    expect(r.domain).toBe(PLATFORM);
    expect((await email().check(null)).records.slice(0, 2).map((c) => c.status)).toEqual(['ok', 'ok']);
    expect(await email().platformAuth()).toMatchObject({ authenticated: true, address: `no-reply@${PLATFORM}` });

    const m = await send('On behalf');
    expect(m.from).toBe(`no-reply@${PLATFORM}`);
    expect(m.data).toMatch(new RegExp(`^From: Ma Boutique <no-reply@${PLATFORM.replace(/\./g, '\\.')}>`, 'm'));
    expect(m.data).toMatch(/^Reply-To: hello@boutique-test\.fr/m);
    const key = (await listDkimKeys(db(), null, PLATFORM))[0]!;
    expect(verifyDkim(m.data, key.publicKey)).toMatchObject({ ok: true, domain: PLATFORM });
    expect((await email().view(shopId)).from).toMatchObject({ kind: 'platform', address: `no-reply@${PLATFORM}`, reason: 'unauthenticated', deliverable: true });
    expect((await g('{ shopmeEmailHealth }')).shopmeEmailHealth).toMatchObject({ fromKind: 'platform' });
    expect((await g('{ shopmeEmailHealth }')).shopmeEmailHealth.reasons).not.toContain('not_authenticated');
  });

  it('a free mailbox is never used in From, even with its "checks" green', async () => {
    await setSender('maboutique@gmail.com');
    const m = await send('Free mailbox');
    expect(m.from).toBe(`no-reply@${PLATFORM}`);
    expect(m.data).toMatch(/^Reply-To: maboutique@gmail\.com/m);
    expect((await email().view(shopId)).from).toMatchObject({ kind: 'platform', reason: 'free_mailbox' });
    await db().update(s.emailSettings).set({ authOk: true, authDomain: 'gmail.com' }).where(eq(s.emailSettings.shopId, shopId));
    expect((await send('Free mailbox 2')).from).toBe(`no-reply@${PLATFORM}`);
  });

  it('switches to the store address by itself once its own checks pass', async () => {
    await setSender('hello@boutique-test.fr');
    expect((await send('Still platform')).from).toBe(`no-reply@${PLATFORM}`);
    await publish(shopId, 'boutique-test.fr');
    // the background re-check picks it up (no click on "Check")
    expect(await email().recheckDue([shopId], new Date(Date.now() + 11 * 60_000))).toBeGreaterThan(0);
    expect(await getEmailSettings(db(), shopId)).toMatchObject({ authOk: true, authDomain: 'boutique-test.fr' });
    const m = await send('Own domain now');
    expect(m.from).toBe('hello@boutique-test.fr');
    const key = (await listDkimKeys(db(), shopId, 'boutique-test.fr'))[0]!;
    expect(verifyDkim(m.data, key.publicKey)).toMatchObject({ ok: true, domain: 'boutique-test.fr' });
    expect((await email().view(shopId)).from).toMatchObject({ kind: 'store', reason: 'store', deliverable: true });
    // if the record disappears, the store falls back again after the next re-check
    delete dns.txt[`${key.selector}._domainkey.boutique-test.fr`];
    await email().recheckDue([shopId], new Date(Date.now() + 13 * 3_600_000));
    expect((await send('Dropped')).from).toBe(`no-reply@${PLATFORM}`);
  });

  it('zero configuration: without a sender address the store domain is used (primary domain first)', async () => {
    await setSender('');
    await db().update(s.shops).set({ primaryDomain: 'www.zero-conf.fr' }).where(eq(s.shops.id, shopId));
    const v = await email().view(shopId);
    expect(v.sender).toMatchObject({ address: 'no-reply@www.zero-conf.fr', domain: 'www.zero-conf.fr', source: 'derived' });
    expect((await email().records(shopId)).domain).toBe('www.zero-conf.fr');
    await db().update(s.shops).set({ primaryDomain: null }).where(eq(s.shops.id, shopId));
    if (!t.app.ctx.config.multiStore) expect((await email().view(shopId)).sender).toMatchObject({ domain: PLATFORM, source: 'derived' }); // then the APP_URL host
    // and the DKIM key for the derived domain was created on the way
    expect((await listDkimKeys(db(), shopId, 'www.zero-conf.fr')).length).toBe(1);
    expect(dkimTxtValue('x')).toContain('k=rsa');
  });
});
