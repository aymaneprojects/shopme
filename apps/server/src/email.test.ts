import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { dkimTxtValue, getEmailSettings, getPrimaryShop, listDkimKeys, sampleVars, schema as s, sendNotification, type DnsResolver } from '@shopme/core';
import { createTestApp, setupAndLogin, type TestApp } from './test-utils';
import { makeGql, makeGqlOk } from '../test/conformance/helpers';
import { closedPort, startSmtp, verifyDkim, type FakeSmtp } from './email/test-smtp';

/** DNS answered from a table that tests edit; no real lookups. */
const dns = { txt: {} as Record<string, string[]>, mx: {} as Record<string, string[]>, a: {} as Record<string, string[]>, ptr: {} as Record<string, string[]> };
const nf = () => Object.assign(new Error('not found'), { code: 'ENOTFOUND' });
const resolver: DnsResolver = {
  resolveTxt: async (n) => { const v = dns.txt[n]; if (!v) throw nf(); return v.map((x) => [x]); },
  resolveCname: async () => { throw nf(); },
  resolveMx: async (n) => { const v = dns.mx[n]; if (!v) throw nf(); return v.map((exchange, i) => ({ exchange, priority: (i + 1) * 10 })); },
  resolve4: async (n) => { const v = dns.a[n]; if (!v) throw nf(); return v; },
  resolve6: async () => { throw nf(); },
  reverse: async (ip) => { const v = dns.ptr[ip]; if (!v) throw nf(); return v; },
};
const IP = '203.0.113.7';

let t: TestApp;
let gql: ReturnType<typeof makeGql>;
let g: ReturnType<typeof makeGqlOk>;
let shopId: number;
let mxA: FakeSmtp, mxB: FakeSmtp, relay: FakeSmtp;
let deadPort: number;
const ports: Record<string, number> = {};
const db = () => t.dbHandle.db;
const email = () => t.app.ctx.email;
const flush = () => t.app.ctx.queue.idle();
const outbox = () => db().select().from(s.emailOutbox).orderBy(s.emailOutbox.id);

function useFakeNetwork() {
  email().deps = { resolver, probe: async () => ({ ok: true, banner: '220 mx ESMTP' }), detectIp: async () => ({ v4: IP, v6: null }), direct: { target: (h) => ({ host: '127.0.0.1', port: ports[h] ?? deadPort }) }, relayTarget: { host: '127.0.0.1', port: relay.port } };
}

const SETTINGS = 'mutation($i: ShopmeEmailInput!) { shopmeEmailSettingsUpdate(input: $i) { settings userErrors { field message } } }';

beforeAll(async () => {
  t = await createTestApp();
  const cookie = await setupAndLogin(t.app);
  gql = makeGql(t.app, cookie);
  g = makeGqlOk(gql);
  shopId = (await getPrimaryShop(db()))!.id;
  [mxA, mxB, relay] = [await startSmtp(), await startSmtp(), await startSmtp({ auth: true })];
  deadPort = await closedPort();
  Object.assign(ports, { 'mx1.example.org': deadPort, 'mx2.example.org': mxB.port, 'mx-a.example.org': mxA.port });
  Object.assign(dns.mx, { 'example.org': ['mx1.example.org', 'mx2.example.org'], 'single.example.org': ['mx-a.example.org'] });
  useFakeNetwork();
  await g('mutation { shopmeNotificationSettingsUpdate(senderName: "Boutique Test", senderEmail: "hello@boutique-test.fr") { settings { senderEmail } userErrors { message } } }');
}, 90_000);
afterAll(async () => { await Promise.all([mxA?.close(), mxB?.close(), relay?.close()]); await t?.close(); });

const mail = (to: string, extra: Record<string, unknown> = {}) => ({ to, subject: 'Hello', text: 'Plain body', html: '<p>Hello</p>', shopId, from: '"Boutique Test" <hello@boutique-test.fr>', fromName: 'Boutique Test', ...extra });

describe('nothing configured', () => {
  it('logs only in the test environment, and reports no working mode', async () => {
    await t.app.ctx.mailer.send(mail('buyer@example.org'));
    await flush();
    expect(await outbox()).toHaveLength(0);
    const h = (await g('{ shopmeEmailHealth }')).shopmeEmailHealth;
    expect(h).toMatchObject({ status: 'problem', reasons: ['no_mode'], effectiveMode: 'log' });
  });
});

describe('direct delivery', () => {
  it('signs with DKIM (verified with the published key), uses the sending domain everywhere and falls back to the next MX', async () => {
    await g(SETTINGS, { i: { mode: 'direct' } });
    const recs = (await g('{ shopmeEmailRecords }')).shopmeEmailRecords;
    expect(recs.domain).toBe('boutique-test.fr');
    expect(recs.ip).toMatchObject({ v4: IP, source: 'dns' });
    expect(recs.records.map((r: { host: string }) => r.host)).toEqual(['boutique-test.fr', 'shopme1._domainkey.boutique-test.fr', '_dmarc.boutique-test.fr']);
    expect(recs.records[0].value).toBe(`v=spf1 ip4:${IP} ~all`);
    const publicKey = (await listDkimKeys(db(), shopId, 'boutique-test.fr'))[0]!.publicKey;
    expect(recs.dkim.value).toBe(dkimTxtValue(publicKey));

    await t.app.ctx.mailer.send(mail('buyer@example.org'));
    await flush();
    expect(mxB.messages).toHaveLength(1); // mx1 refused the connection, mx2 took it
    const m = mxB.messages[0]!;
    expect(m.from).toBe('hello@boutique-test.fr');
    expect(m.to).toEqual(['buyer@example.org']);
    const v = verifyDkim(m.data, publicKey);
    expect(v).toMatchObject({ ok: true, domain: 'boutique-test.fr', selector: 'shopme1' });
    expect(v.signedHeaders).toEqual(expect.arrayContaining(['from', 'to', 'subject', 'message-id']));
    expect(/^Message-ID: <[0-9a-f-]+@boutique-test\.fr>/im.test(m.data)).toBe(true);
    expect(m.data).not.toMatch(/^List-Unsubscribe:/im);
    const [row] = await outbox();
    expect(row).toMatchObject({ status: 'sent', attempts: 1, mxHost: 'mx2.example.org', mode: 'direct', toAddress: 'buyer@example.org', payload: null });
    expect(row!.lastResponse).toContain('queued as TEST1');
    // a tampered body no longer verifies
    expect(verifyDkim(m.data.replace('Plain body', 'Other body'), publicKey).ok).toBe(false);
  });

  it('a 4xx answer is retried with backoff (5 attempts over about a day) and then fails', async () => {
    mxA.reply.rcpt = () => '451 4.7.1 Greylisted, try again later';
    await t.app.ctx.mailer.send(mail('someone@single.example.org', { subject: 'Greylisted' }));
    await flush();
    const get = async () => (await outbox()).find((r) => r.subject === 'Greylisted')!;
    let r = await get();
    expect(r).toMatchObject({ status: 'retry', attempts: 1 });
    expect(r.lastError).toContain('451');
    const wait1 = r.nextAttemptAt!.getTime() - Date.now();
    expect(wait1).toBeGreaterThan(14 * 60_000);
    expect(wait1).toBeLessThanOrEqual(15 * 60_000);
    // nothing is due yet
    expect(await email().sweep(new Date())).toBe(0);
    let at = Date.now();
    const total = [1, 2, 3, 4].map((n) => [15 * 60_000, 3_600_000, 4 * 3_600_000, 18 * 3_600_000][n - 1]!);
    for (let attempt = 2; attempt <= 5; attempt++) {
      at += total[attempt - 2]! + 1000;
      expect(await email().sweep(new Date(at))).toBe(1);
      r = await get();
      expect(r.attempts).toBe(attempt);
      expect(r.status).toBe(attempt < 5 ? 'retry' : 'failed');
    }
    expect(at - Date.now()).toBeLessThan(24 * 3_600_000);
    expect(r.lastError).toContain('451');
    expect(await email().sweep(new Date(at + 10 * 86_400_000))).toBe(0); // final: never retried again
  });

  it('a temporary failure that clears is delivered on the retry', async () => {
    let calls = 0;
    mxA.reply.rcpt = () => (++calls === 1 ? '450 4.2.0 Mailbox busy' : '250 ok');
    await t.app.ctx.mailer.send(mail('late@single.example.org', { subject: 'Second chance' }));
    await flush();
    const row = (await outbox()).find((r) => r.subject === 'Second chance')!;
    expect(row.status).toBe('retry');
    await email().sweep(new Date(Date.now() + 16 * 60_000));
    const after = (await outbox()).find((r) => r.subject === 'Second chance')!;
    expect(after).toMatchObject({ status: 'sent', attempts: 2, lastError: null });
    expect(mxA.messages.some((x) => x.to[0] === 'late@single.example.org')).toBe(true);
    mxA.reply.rcpt = undefined;
  });

  it('a 5xx answer fails at once and shows why', async () => {
    mxA.reply.rcpt = () => '550 5.1.1 No such user here';
    await t.app.ctx.mailer.send(mail('ghost@single.example.org', { subject: 'Unknown user' }));
    await flush();
    const row = (await outbox()).find((r) => r.subject === 'Unknown user')!;
    expect(row).toMatchObject({ status: 'failed', attempts: 1, payload: null });
    expect(row.lastError).toContain('550');
    expect(await email().sweep(new Date(Date.now() + 30 * 86_400_000))).toBe(0);
    mxA.reply.rcpt = undefined;
    const list = (await g('{ shopmeEmailOutbox(first: 50) }')).shopmeEmailOutbox as Array<{ subject: string; status: string; lastError: string }>;
    expect(list.find((r) => r.subject === 'Unknown user')).toMatchObject({ status: 'failed' });
    expect((await g('{ shopmeEmailHealth }')).shopmeEmailHealth.reasons).toContain('failures');
  });

  it('a domain that does not exist fails for good; a null MX too', async () => {
    await t.app.ctx.mailer.send(mail('x@nowhere.example.net', { subject: 'No domain' }));
    await flush();
    expect((await outbox()).find((r) => r.subject === 'No domain')).toMatchObject({ status: 'failed' });
    dns.mx['nullmx.example.net'] = [''];
    await t.app.ctx.mailer.send(mail('x@nullmx.example.net', { subject: 'Null MX' }));
    await flush();
    expect((await outbox()).find((r) => r.subject === 'Null MX')).toMatchObject({ status: 'failed' });
  });

  it('marketing mail carries List-Unsubscribe (and the link works); transactional mail does not', async () => {
    const shop = (await getPrimaryShop(db()))!;
    const base = t.app.ctx.stores.storefrontBase(shopId);
    const before = mxA.messages.length;
    await sendNotification(db(), t.app.ctx.mailer, shop, base, 'abandoned_checkout', 'cart@single.example.org', sampleVars(shop, base), { force: true });
    await sendNotification(db(), t.app.ctx.mailer, shop, base, 'order_confirmation', 'order@single.example.org', sampleVars(shop, base), { force: true });
    await flush();
    const fresh = mxA.messages.slice(before);
    expect(fresh).toHaveLength(2);
    const marketing = fresh.find((x) => x.to[0] === 'cart@single.example.org')!;
    const order = fresh.find((x) => x.to[0] === 'order@single.example.org')!;
    const lu = /^List-Unsubscribe:[ ]?([^\r]*(?:\r\n[ \t][^\r]+)*)/im.exec(marketing.data)![1]!.replace(/\r\n[ \t]/g, ' ');
    expect(lu).toContain('/unsubscribe/');
    expect(lu).toContain('mailto:');
    expect(order.data).not.toMatch(/List-Unsubscribe/i);
    // the signed link unsubscribes the customer
    const token = /\/unsubscribe\/([^>\s]+)>/.exec(lu)![1]!;
    await db().insert(s.customers).values({ shopId, email: 'cart@single.example.org', emailMarketingState: 'SUBSCRIBED' });
    expect((await t.app.inject({ method: 'GET', url: `/unsubscribe/${token}` })).statusCode).toBe(200);
    expect((await t.app.inject({ method: 'POST', url: `/unsubscribe/${token}`, headers: { 'content-type': 'application/x-www-form-urlencoded' }, payload: 'List-Unsubscribe=One-Click' })).statusCode).toBe(200);
    const [c] = await db().select().from(s.customers).where(and(eq(s.customers.shopId, shopId), eq(s.customers.email, 'cart@single.example.org')));
    expect(c!.emailMarketingState).toBe('UNSUBSCRIBED');
    expect((await t.app.inject({ method: 'POST', url: `/unsubscribe/${token}x` })).statusCode).toBe(404);
  });
});

describe('guided setup: records, checks, rotation, test e-mail', () => {
  it('proposes an SPF merged with the existing record, then checks live DNS', async () => {
    dns.txt['boutique-test.fr'] = ['v=spf1 include:_spf.mail.example -all'];
    const recs = (await g('{ shopmeEmailRecords }')).shopmeEmailRecords;
    expect(recs.records[0]).toMatchObject({ existing: 'v=spf1 include:_spf.mail.example -all', value: `v=spf1 include:_spf.mail.example ip4:${IP} -all` });

    const run = async () => (await g('mutation { shopmeEmailCheck { check userErrors { message } } }')).shopmeEmailCheck.check;
    let c = await run();
    expect(c.records.map((r: { id: string; status: string }) => [r.id, r.status])).toEqual([['spf', 'error'], ['dkim', 'error'], ['dmarc', 'warn']]);
    expect(c.server.map((x: { id: string; status: string }) => [x.id, x.status])).toEqual([['ip', 'ok'], ['port25', 'unknown'], ['ptr', 'error'], ['dnsbl', 'ok']]);
    expect((await getEmailSettings(db(), shopId))!.authOk).toBe(false);

    const key = (await listDkimKeys(db(), shopId, 'boutique-test.fr'))[0]!;
    dns.txt['boutique-test.fr'] = [`v=spf1 include:_spf.mail.example ip4:${IP} -all`];
    dns.txt[`${key.selector}._domainkey.boutique-test.fr`] = [dkimTxtValue(key.publicKey)];
    dns.txt['_dmarc.boutique-test.fr'] = ['v=DMARC1; p=none; rua=mailto:dmarc@boutique-test.fr'];
    dns.mx['gmail.com'] = ['gmail-smtp-in.l.google.com']; dns.mx['outlook.com'] = ['outlook-mx.example.net'];
    dns.a['mail.boutique-test.fr'] = [IP]; dns.ptr[IP] = ['mail.boutique-test.fr'];
    c = await run();
    expect(c.records.map((r: { status: string }) => r.status)).toEqual(['ok', 'ok', 'ok']);
    expect(c.server.map((x: { status: string }) => x.status)).toEqual(['ok', 'ok', 'ok', 'ok']);
    expect((await getEmailSettings(db(), shopId))).toMatchObject({ authOk: true, authDomain: 'boutique-test.fr' });
    expect((await g('{ shopmeEmailHealth }')).shopmeEmailHealth.status).not.toBe('unchecked');
  });

  it('rotation: a pending key signs nothing until it is activated', async () => {
    const old = (await listDkimKeys(db(), shopId, 'boutique-test.fr')).find((k) => k.status === 'active')!;
    const r = (await g('mutation { shopmeEmailDkimRotate { records userErrors { message } } }')).shopmeEmailDkimRotate.records;
    expect(r.pending.selector).toBe('shopme2');
    expect(r.dkim.selector).toBe(old.selector);
    mxB.messages.length = 0; mxA.messages.length = 0;
    await t.app.ctx.mailer.send(mail('rot@single.example.org', { subject: 'Rotation 1' }));
    await flush();
    expect(verifyDkim(mxA.messages.at(-1)!.data, old.publicKey)).toMatchObject({ ok: true, selector: 'shopme1' });
    const act = (await g('mutation { shopmeEmailDkimActivate { records userErrors { message } } }')).shopmeEmailDkimActivate.records;
    expect(act.dkim.selector).toBe('shopme2');
    const keys = await listDkimKeys(db(), shopId, 'boutique-test.fr');
    expect(keys.map((k) => [k.selector, k.status])).toEqual([['shopme1', 'retired'], ['shopme2', 'active']]);
    // the new key has to pass its own check before the store signs as itself again
    expect((await getEmailSettings(db(), shopId))!.authOk).toBe(false);
    await t.app.ctx.mailer.send(mail('rot@single.example.org', { subject: 'Rotation 2' }));
    await flush();
    expect(verifyDkim(mxA.messages.at(-1)!.data, keys[1]!.publicKey)).toMatchObject({ ok: true, selector: 'shopme2' });
    const bad = await gql('mutation { shopmeEmailDkimActivate { userErrors { message } } }');
    expect(bad.data.shopmeEmailDkimActivate.userErrors[0].message).toMatch(/no pending key/);
  });

  it('sends a test e-mail and returns the delivery result and the remote answer; it is rate limited', async () => {
    const Q = 'mutation($to: String!) { shopmeEmailSendTest(to: $to) { result userErrors { field message } } }';
    const r = (await g(Q, { to: 'tester@single.example.org' })).shopmeEmailSendTest;
    expect(r.userErrors).toEqual([]);
    expect(r.result).toMatchObject({ ok: true, status: 'sent', mode: 'direct', mxHost: 'mx-a.example.org', to: 'tester@single.example.org' });
    expect(r.result.response).toContain('queued as TEST1');
    mxA.reply.rcpt = () => '550 5.7.1 Rejected by policy';
    const fail = (await g(Q, { to: 'tester@single.example.org' })).shopmeEmailSendTest.result;
    expect(fail).toMatchObject({ ok: false, status: 'failed' });
    expect(fail.error).toContain('550');
    mxA.reply.rcpt = undefined;
    expect((await g(Q, { to: 'not-an-address' })).shopmeEmailSendTest.userErrors[0].field).toEqual(['to']);
    for (let i = 0; i < 3; i++) await g(Q, { to: 'tester@single.example.org' });
    const limited = (await g(Q, { to: 'tester@single.example.org' })).shopmeEmailSendTest;
    expect(limited.result).toBeNull();
    expect(limited.userErrors[0].message).toMatch(/Too many test/);
  });

  it('never returns private keys or passwords', async () => {
    const all = JSON.stringify([(await g('{ shopmeEmailSettings shopmeEmailRecords shopmeEmailOutbox(first: 100) shopmeEmailHealth }'))]);
    expect(all).not.toMatch(/PRIVATE KEY/);
    expect(all).not.toMatch(/privateKey/i);
    const rows = await db().select().from(s.emailDkimKeys);
    expect(rows.every((k) => !k.privateKeyEnc.includes('PRIVATE KEY'))).toBe(true);
  });
});

describe('relay (SMTP)', () => {
  it('validates the host: no private or loopback addresses', async () => {
    for (const host of ['127.0.0.1', '10.1.2.3', '192.168.0.9', '169.254.169.254', '[::1]', 'localhost', 'not a host']) {
      const r = (await g(SETTINGS, { i: { host } })).shopmeEmailSettingsUpdate;
      expect(r.settings, host).toBeNull();
      expect(r.userErrors[0].field, host).toEqual(['host']);
    }
    expect((await g(SETTINGS, { i: { port: 70000 } })).shopmeEmailSettingsUpdate.userErrors[0].field).toEqual(['port']);
    expect((await g(SETTINGS, { i: { mode: 'relay' } })).shopmeEmailSettingsUpdate.userErrors[0].message).toMatch(/relay host and port/);
    expect((await g(SETTINGS, { i: { mode: 'smtp' } })).shopmeEmailSettingsUpdate.userErrors[0].field).toEqual(['mode']);
  });

  it('delivers through the relay with its credentials (encrypted at rest, never returned) and without our DKIM', async () => {
    const r = (await g(SETTINGS, { i: { mode: 'relay', preset: 'generic', host: '93.184.216.34', port: 2525, security: 'none', username: 'apikey', password: 'S3cret-relay-pass' } })).shopmeEmailSettingsUpdate;
    expect(r.userErrors).toEqual([]);
    expect(r.settings.configuredMode).toBe('relay');
    expect(r.settings.relay).toMatchObject({ host: '93.184.216.34', port: 2525, username: 'apikey', passwordSet: true });
    expect(JSON.stringify(r)).not.toContain('S3cret');
    const row = (await getEmailSettings(db(), shopId))!;
    expect(row.relayPasswordEnc).toBeTruthy();
    expect(row.relayPasswordEnc).not.toContain('S3cret');

    await t.app.ctx.mailer.send(mail('buyer@anywhere.example.org', { subject: 'Via relay' }));
    await flush();
    expect(relay.messages).toHaveLength(1);
    expect(relay.messages[0]).toMatchObject({ from: 'hello@boutique-test.fr', to: ['buyer@anywhere.example.org'], auth: { user: 'apikey', pass: 'S3cret-relay-pass' } });
    expect(relay.messages[0]!.data).not.toMatch(/^DKIM-Signature:/im);
    expect((await outbox()).find((o) => o.subject === 'Via relay')).toMatchObject({ status: 'sent', mode: 'relay' });
    expect((await g('{ shopmeEmailHealth }')).shopmeEmailHealth.effectiveMode).toBe('relay');
  });

  it('a relay that refuses with 5xx fails, a 4xx is retried; switching back is one mutation', async () => {
    relay.reply.data = () => '554 5.7.1 Sender not verified';
    await t.app.ctx.mailer.send(mail('a@b.example.org', { subject: 'Relay refuses' }));
    await flush();
    expect((await outbox()).find((o) => o.subject === 'Relay refuses')).toMatchObject({ status: 'failed' });
    relay.reply.data = () => '421 4.3.2 Service not available';
    await t.app.ctx.mailer.send(mail('a@b.example.org', { subject: 'Relay busy' }));
    await flush();
    expect((await outbox()).find((o) => o.subject === 'Relay busy')).toMatchObject({ status: 'retry' });
    relay.reply.data = undefined;
    const back = (await g(SETTINGS, { i: { mode: 'direct' } })).shopmeEmailSettingsUpdate;
    expect(back.settings.effectiveMode).toBe('direct');
    expect(back.settings.relay.passwordSet).toBe(true); // kept for switching back
    const cleared = (await g(SETTINGS, { i: { clearPassword: true } })).shopmeEmailSettingsUpdate;
    expect(cleared.settings.relay.passwordSet).toBe(false);
  });
});
