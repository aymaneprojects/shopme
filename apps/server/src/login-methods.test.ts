import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { createAccount, getPrimaryShop, inviteStaff, signChallenge, renderNotification, schema as s, totpCode, type Mail } from '@shopme/core';
import { createTestApp, SETUP_BODY, setupAndLogin, type TestApp } from './test-utils';
import { SoftAuthenticator } from './webauthn-test-authenticator';

let t: TestApp;
let owner: string;
const sent: Mail[] = [];
let deliverable = true;
let ipN = 10;
const nextIp = () => `10.1.0.${ipN++}`;

const call = (method: 'GET' | 'POST' | 'DELETE', url: string, payload?: unknown, o: { cookie?: string | null; cookies?: Record<string, string>; ip?: string } = {}) =>
  t.app.inject({ method, url, payload: payload as never, remoteAddress: o.ip, cookies: { ...(o.cookie ? { shopme_session: o.cookie } : {}), ...o.cookies } });
const login = (ip: string, cookies?: Record<string, string>, creds = { email: SETUP_BODY.email, password: SETUP_BODY.password }) => call('POST', '/admin/api/auth/login', creds, { ip, cookies });
const cookieOf = (res: { cookies: Array<{ name: string; value: string }> }, name = 'shopme_session') => res.cookies.find((c) => c.name === name)?.value;
const codeMails = () => sent.filter((m) => /verification code|code de vérification/i.test(m.subject));
const lastCode = () => /\b(\d{6})\b/.exec(codeMails().at(-1)!.text!)![1]!;
const origin = () => new URL(t.app.ctx.config.appUrl).origin;
const accountId = async () => (await t.dbHandle.db.select().from(s.platformAccounts).where(eq(s.platformAccounts.email, SETUP_BODY.email)))[0]!.id;

beforeAll(async () => {
  t = await createTestApp();
  owner = await setupAndLogin(t.app);
  t.app.ctx.mailer = { send: async (m) => { sent.push(m); } };
  t.app.ctx.email.health = async () => ({ status: deliverable ? 'ok' : 'problem', reasons: [], effectiveMode: 'relay', fromKind: 'store', done: deliverable });
}, 120_000);
afterAll(async () => { await t?.close(); });

describe('e-mail code on a new device', () => {
  it('asks for a code, mails it, and opens the session only after the right code', async () => {
    const ip = nextIp();
    const before = codeMails().length;
    const r = await login(ip);
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ emailCodeRequired: true, email: SETUP_BODY.email });
    expect(cookieOf(r)).toBeUndefined();
    expect(codeMails()).toHaveLength(before + 1);
    expect(sent.at(-1)).toMatchObject({ to: SETUP_BODY.email });
    expect(sent.at(-1)!.subject).toContain(lastCode());
    const { challenge } = r.json() as { challenge: string };
    const wrong = await call('POST', '/admin/api/auth/login/email-code', { challenge, code: lastCode() === '000000' ? '111111' : '000000' }, { ip });
    expect(wrong.statusCode).toBe(401);
    const ok = await call('POST', '/admin/api/auth/login/email-code', { challenge, code: lastCode() }, { ip });
    expect(ok.statusCode, ok.body).toBe(200);
    expect(cookieOf(ok)).toBeDefined();
    // A code is single use.
    expect((await call('POST', '/admin/api/auth/login/email-code', { challenge, code: lastCode() }, { ip })).statusCode).toBe(401);
  });

  it('remembers the browser for 90 days with a signed cookie, and only that browser', async () => {
    const ip = nextIp();
    const step = (await login(ip)).json() as { challenge: string };
    const ok = await call('POST', '/admin/api/auth/login/email-code', { challenge: step.challenge, code: lastCode() }, { ip });
    const id = await accountId();
    const trust = ok.cookies.find((c) => c.name === `shopme_td_${id}`);
    expect(trust).toBeDefined();
    expect(trust!.httpOnly).toBe(true);
    expect(trust!.maxAge).toBe(90 * 24 * 3600);
    const before = codeMails().length;
    const again = await login(ip, { [trust!.name]: trust!.value });
    expect(cookieOf(again)).toBeDefined();
    expect(again.json().emailCodeRequired).toBeUndefined();
    expect(codeMails()).toHaveLength(before);
    // A forged or tampered cookie does not count.
    expect((await login(nextIp(), { [trust!.name]: `${trust!.value}x` })).json().emailCodeRequired).toBe(true);
    expect((await login(nextIp(), { [trust!.name]: 'td1.1.forged' })).json().emailCodeRequired).toBe(true);
  });

  it('refuses a code after it expired, and after 5 wrong tries until a new one is asked', async () => {
    const db = t.dbHandle.db;
    const ip = nextIp();
    const id = await accountId();
    const { challenge } = (await login(ip)).json() as { challenge: string };
    const good = lastCode();
    const wrongCode = good === '999999' ? '888888' : '999999';
    for (let i = 0; i < 4; i++) expect((await call('POST', '/admin/api/auth/login/email-code', { challenge, code: wrongCode }, { ip })).statusCode).toBe(401);
    const fifth = await call('POST', '/admin/api/auth/login/email-code', { challenge, code: wrongCode }, { ip });
    expect(fifth.json()).toMatchObject({ codeLocked: true });
    // Even the right code is refused now.
    expect((await call('POST', '/admin/api/auth/login/email-code', { challenge, code: good }, { ip })).json()).toMatchObject({ codeLocked: true });
    // Resend is rate limited (30 s), then gives a fresh code that works.
    const tooSoon = await call('POST', '/admin/api/auth/login/email-code/resend', { challenge }, { ip });
    expect(tooSoon.statusCode).toBe(429);
    expect(Number(tooSoon.headers['retry-after'])).toBeGreaterThan(0);
    await db.update(s.accountLoginCodes).set({ sentAt: new Date(Date.now() - 60_000) }).where(eq(s.accountLoginCodes.accountId, id));
    const before = codeMails().length;
    expect((await call('POST', '/admin/api/auth/login/email-code/resend', { challenge }, { ip })).statusCode).toBe(200);
    expect(codeMails()).toHaveLength(before + 1);
    const fresh = await call('POST', '/admin/api/auth/login/email-code', { challenge, code: lastCode() }, { ip });
    expect(fresh.statusCode).toBe(200);
    // Expiry: a code older than 10 minutes is dead.
    const again = (await login(ip)).json() as { challenge: string };
    await db.update(s.accountLoginCodes).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(s.accountLoginCodes.accountId, id));
    expect((await call('POST', '/admin/api/auth/login/email-code', { challenge: again.challenge, code: lastCode() }, { ip })).json()).toMatchObject({ codeExpired: true });
  });

  it('limits how many codes can be requested', async () => {
    const ip = nextIp();
    const db = t.dbHandle.db;
    const other = await createAccount(db, { email: 'limit@example.com', password: 'limit password 1' });
    const challenge = signChallenge(t.app.ctx.config.sessionSecret, other.id);
    let last = 0;
    for (let i = 0; i < 7; i++) {
      await db.update(s.accountLoginCodes).set({ sentAt: new Date(Date.now() - 60_000) }).where(eq(s.accountLoginCodes.accountId, other.id));
      last = (await call('POST', '/admin/api/auth/login/email-code/resend', { challenge }, { ip })).statusCode;
    }
    expect(last).toBe(429);
  });

  it('is skipped when e-mail cannot be delivered, so a fresh install or the desktop app can still sign in', async () => {
    const ip = nextIp();
    deliverable = false;
    try {
      const before = codeMails().length;
      const r = await login(ip);
      expect(cookieOf(r)).toBeDefined();
      expect(r.json().emailCodeRequired).toBeUndefined();
      expect(codeMails()).toHaveLength(before);
    } finally { deliverable = true; }
    // The unmodified e-mail health of a fresh test install (nothing configured) is not "ok" either.
    const real = await createTestApp();
    try {
      await setupAndLogin(real.app);
      const r = await real.app.inject({ method: 'POST', url: '/admin/api/auth/login', payload: { email: SETUP_BODY.email, password: SETUP_BODY.password } });
      expect(r.cookies.some((c) => c.name === 'shopme_session')).toBe(true);
    } finally { await real.close(); }
  });

  it('is skipped when the mailer fails, and never stands in for two-step verification', async () => {
    const ok = t.app.ctx.mailer;
    t.app.ctx.mailer = { send: async () => { throw new Error('smtp down'); } };
    try { expect(cookieOf(await login(nextIp()))).toBeDefined(); } finally { t.app.ctx.mailer = ok; }
  });

  it('keeps the authenticator step for accounts with two-step verification', async () => {
    const setup = (await call('POST', '/admin/api/auth/2fa/setup', {}, { cookie: owner })).json() as { secret: string };
    expect((await call('POST', '/admin/api/auth/2fa/enable', { code: totpCode(setup.secret) }, { cookie: owner })).statusCode).toBe(200);
    const before = codeMails().length;
    const r = await login(nextIp());
    expect(r.json()).toMatchObject({ twoFactorRequired: true });
    expect(r.json().emailCodeRequired).toBeUndefined();
    expect(codeMails()).toHaveLength(before);
    // The mailed-code endpoints refuse such accounts.
    const { challenge } = r.json() as { challenge: string };
    expect((await call('POST', '/admin/api/auth/login/email-code', { challenge, code: '123456' }, { ip: nextIp() })).statusCode).toBe(401);
    expect((await call('POST', '/admin/api/auth/login/email-code/resend', { challenge }, { ip: nextIp() })).statusCode).toBe(401);
    // (kept enabled for the passkey tests below)
  });
});


describe('passkeys', () => {
  const auth = new SoftAuthenticator();
  let passkeyId = 0;

  const register = async (a: SoftAuthenticator, password = SETUP_BODY.password) => {
    const o = await call('POST', '/admin/api/auth/passkeys/options', { password }, { cookie: owner });
    if (o.statusCode !== 200) return { options: o };
    const { id, options } = o.json() as { id: string; options: { challenge: string; rp: { id: string } } };
    return { options: o, id, verify: (response: unknown) => call('POST', '/admin/api/auth/passkeys', { id, name: 'Laptop', response }, { cookie: owner }), response: a.register(options, origin()) };
  };

  it('registers a passkey after the password, and lists it without key material', async () => {
    expect((await call('POST', '/admin/api/auth/passkeys/options', { password: 'wrong' }, { cookie: owner })).statusCode).toBe(403);
    expect((await call('POST', '/admin/api/auth/passkeys/options', { password: SETUP_BODY.password })).statusCode).toBe(401);
    const r = await register(auth);
    const res = await r.verify!(r.response);
    expect(res.statusCode, res.body).toBe(201);
    passkeyId = res.json().passkey.id;
    const list = (await call('GET', '/admin/api/auth/passkeys', undefined, { cookie: owner })).json() as { passkeys: Array<Record<string, unknown>> };
    expect(list.passkeys).toHaveLength(1);
    expect(list.passkeys[0]).toMatchObject({ name: 'Laptop', id: passkeyId });
    expect(JSON.stringify(list)).not.toMatch(/publicKey|credentialId/);
    expect((await call('GET', '/admin/api/auth/security', undefined, { cookie: owner })).json().passkeys).toHaveLength(1);
    // The same authenticator cannot be registered twice.
    const again = await register(auth);
    expect(again.options.statusCode).toBe(200);
    expect((await again.verify!(again.response)).statusCode).toBe(409);
  });

  it('rejects a registration signed for another origin', async () => {
    const other = new SoftAuthenticator();
    const o = (await (await call('POST', '/admin/api/auth/passkeys/options', { password: SETUP_BODY.password }, { cookie: owner })).json()) as { id: string; options: { challenge: string; rp: { id: string } } };
    const res = await call('POST', '/admin/api/auth/passkeys', { id: o.id, response: other.register(o.options, 'https://evil.example') }, { cookie: owner });
    expect(res.statusCode).toBe(422);
  });

  const passkeyLogin = async (a: SoftAuthenticator, ip: string, cookies?: Record<string, string>) => {
    const o = (await call('POST', '/admin/api/auth/passkey/login/options', {}, { ip })).json() as { id: string; options: { challenge: string; rpId: string; allowCredentials?: unknown[] } };
    expect(o.options.allowCredentials ?? []).toHaveLength(0); // discoverable: no e-mail, nothing revealed
    return { id: o.id, challenge: o.options.challenge, res: (response?: unknown) => call('POST', '/admin/api/auth/passkey/login/verify', { id: o.id, response: response ?? a.authenticate(o.options, origin()) }, { ip, cookies }) };
  };

  it('signs in with a passkey, skipping the password, the e-mail code and two-step verification', async () => {
    // The account has an authenticator app (see above) and this is a new device: a password login would stop at the second factor.
    expect((await login(nextIp())).json()).toMatchObject({ twoFactorRequired: true });
    const ip = nextIp();
    const before = codeMails().length;
    const r = await (await passkeyLogin(auth, ip)).res();
    expect(r.statusCode, r.body).toBe(200);
    expect(cookieOf(r)).toBeDefined();
    expect(r.json().user).toMatchObject({ email: SETUP_BODY.email });
    expect(codeMails()).toHaveLength(before);
    const me = await call('GET', '/admin/api/auth/me', undefined, { cookie: cookieOf(r) });
    expect(me.statusCode).toBe(200);
    const list = (await call('GET', '/admin/api/auth/passkeys', undefined, { cookie: owner })).json() as { passkeys: Array<{ lastUsedAt: string | null }> };
    expect(list.passkeys[0]!.lastUsedAt).not.toBeNull();
  });

  it('refuses a replayed assertion, an unknown passkey, a wrong origin and a stale counter', async () => {
    const ip = nextIp();
    const a = await passkeyLogin(auth, ip);
    const response = auth.authenticate({ challenge: a.challenge }, origin());
    expect((await a.res(response)).statusCode).toBe(200);
    // The challenge is consumed: the same assertion cannot be used again.
    expect((await a.res(response)).statusCode).toBe(401);
    // Unknown credential.
    expect((await (await passkeyLogin(new SoftAuthenticator(), ip)).res()).statusCode).toBe(401);
    // Right key, wrong origin.
    const b = await passkeyLogin(auth, ip);
    expect((await b.res(auth.authenticate({ challenge: b.challenge }, 'https://evil.example'))).statusCode).toBe(401);
    // Counter going backwards (a cloned authenticator).
    const c = await passkeyLogin(auth, ip);
    auth.counter = 0;
    expect((await c.res(auth.authenticate({ challenge: c.challenge }, origin()))).statusCode).toBe(401);
    auth.counter = 1000;
  });

  it('deleting a passkey stops it signing in', async () => {
    expect((await call('DELETE', `/admin/api/auth/passkeys/${passkeyId}`, undefined, { cookie: owner })).statusCode).toBe(200);
    expect((await call('DELETE', `/admin/api/auth/passkeys/${passkeyId}`, undefined, { cookie: owner })).statusCode).toBe(404);
    expect((await (await passkeyLogin(auth, nextIp())).res()).statusCode).toBe(401);
  });
});

describe('secure sign-in method for invited users', () => {
  const EMAIL = 'secure@example.com';
  const PASSWORD = 'secure password 1';
  const auth = new SoftAuthenticator();
  let cookie = '';
  const creds = { email: EMAIL, password: PASSWORD };

  it('lets a member who must use a secure method in, but only to set one up', async () => {
    const shop = (await getPrimaryShop(t.dbHandle.db))!;
    const inv = await inviteStaff(t.dbHandle.db, shop.id, { email: EMAIL, role: 'staff', permissions: ['orders'], requireSecureLogin: true });
    expect(inv.ok).toBe(true);
    const acc = await call('POST', '/admin/api/staff/accept-invite', { token: inv.ok && inv.value.token, password: PASSWORD }, { ip: nextIp() });
    expect(acc.statusCode, acc.body).toBe(200);
    deliverable = false; // the e-mail code is covered above
    const r = await login(nextIp(), undefined, creds);
    expect(r.json().twoFactorSetupRequired).toBe(true);
    cookie = cookieOf(r)!;
    const me = await call('GET', '/admin/api/auth/me', undefined, { cookie });
    expect(me.json().twoFactorSetupRequired).toBe(true);
    // Nothing but the security pages opens until then.
    const gql = await call('POST', '/admin/api/2026-10/graphql.json', { query: '{ shop { name } }' }, { cookie });
    expect(JSON.stringify(gql.json())).toMatch(/access denied|Access denied|errors/i);
    expect((await call('GET', '/admin/api/auth/security', undefined, { cookie })).statusCode).toBe(200);
  });

  it('then needs the passkey: the password alone is refused, the passkey signs in', async () => {
    const o = (await call('POST', '/admin/api/auth/passkeys/options', { password: PASSWORD }, { cookie })).json() as { id: string; options: { challenge: string; rp: { id: string } } };
    expect((await call('POST', '/admin/api/auth/passkeys', { id: o.id, response: auth.register(o.options, origin()) }, { cookie })).statusCode).toBe(201);
    const me = await call('GET', '/admin/api/auth/me', undefined, { cookie });
    expect(me.json().twoFactorSetupRequired).toBe(false);
    const denied = await login(nextIp(), undefined, creds);
    expect(denied.statusCode).toBe(403);
    expect(denied.json()).toMatchObject({ passkeyRequired: true });
    expect(cookieOf(denied)).toBeUndefined();
    const ip = nextIp();
    const p = (await call('POST', '/admin/api/auth/passkey/login/options', {}, { ip })).json() as { id: string; options: { challenge: string; rpId: string } };
    const ok = await call('POST', '/admin/api/auth/passkey/login/verify', { id: p.id, response: auth.authenticate(p.options, origin()) }, { ip });
    expect(ok.statusCode, ok.body).toBe(200);
    expect(ok.json().twoFactorSetupRequired).toBe(false);
  });

  it('a member without the requirement keeps signing in with the password', async () => {
    const shop = (await getPrimaryShop(t.dbHandle.db))!;
    const inv = await inviteStaff(t.dbHandle.db, shop.id, { email: 'plain@example.com', role: 'staff', permissions: ['orders'] });
    await call('POST', '/admin/api/staff/accept-invite', { token: inv.ok && inv.value.token, password: 'plain password 1' }, { ip: nextIp() });
    const r = await login(nextIp(), undefined, { email: 'plain@example.com', password: 'plain password 1' });
    expect(cookieOf(r)).toBeDefined();
    expect(r.json().twoFactorSetupRequired).toBe(false);
  });
});

describe('verification e-mail', () => {
  it('renders the designed template in English and French, with the code, expiry and store name', async () => {
    const shop = (await getPrimaryShop(t.dbHandle.db))!;
    const vars = (date: string) => ({ login: { code: '876074', minutes: 10, date } });
    const en = await renderNotification(t.dbHandle.db, { ...shop, locale: 'en' }, 'http://localhost:3000', 'login_code', vars('6 November 2026'));
    expect(en.subject).toBe(`Your ${shop.name} verification code: 876074`);
    expect(en.html).toContain('6 November 2026');
    expect(en.html).toContain('Your verification code');
    expect(en.html).toContain('background:#1A3591'); // the thick accent bar, brand navy
    expect(en.html).toContain('876074');
    expect(en.html).toContain('This code expires in 10 minutes. Do not share it with anyone.');
    expect(en.html).toContain(shop.name);
    expect(en.html).not.toMatch(/Shopify/i);
    expect(en.text).toContain('876074');
    const fr = await renderNotification(t.dbHandle.db, { ...shop, locale: 'fr' }, 'http://localhost:3000', 'login_code', vars('6 novembre 2026'));
    expect(fr.subject).toBe(`Votre code de vérification ${shop.name} : 876074`);
    expect(fr.html).toContain('Votre code de vérification');
    expect(fr.html).toContain('Ce code expire dans 10 minutes. Ne le communiquez à personne.');
  });
});

describe('forgotten password', () => {
  it('answers the same for unknown addresses, mails a code otherwise, and resets with it', async () => {
    deliverable = true;
    const ip = nextIp();
    const unknown = await call('POST', '/admin/api/auth/password/forgot', { email: 'nobody@example.com' }, { ip });
    expect(unknown.json()).toEqual({ ok: true });
    const before = sent.length;
    const known = await call('POST', '/admin/api/auth/password/forgot', { email: 'plain@example.com' }, { ip });
    expect(known.json()).toEqual({ ok: true });
    expect(sent).toHaveLength(before + 1);
    expect(sent.at(-1)!.subject).toMatch(/password reset code/);
    const code = /\b(\d{6})\b/.exec(sent.at(-1)!.text!)![1]!;
    const wrong = await call('POST', '/admin/api/auth/password/reset', { email: 'plain@example.com', code: code === '000000' ? '111111' : '000000', password: 'brand new password' }, { ip });
    expect(wrong.statusCode).toBe(401);
    const ok = await call('POST', '/admin/api/auth/password/reset', { email: 'plain@example.com', code, password: 'brand new password' }, { ip });
    expect(ok.statusCode, ok.body).toBe(200);
    deliverable = false; // the new-device code is covered above
    expect(cookieOf(await login(nextIp(), undefined, { email: 'plain@example.com', password: 'plain password 1' }))).toBeUndefined();
    expect(cookieOf(await login(nextIp(), undefined, { email: 'plain@example.com', password: 'brand new password' }))).toBeDefined();
    // The code was single use.
    expect((await call('POST', '/admin/api/auth/password/reset', { email: 'plain@example.com', code, password: 'another password 1' }, { ip })).statusCode).toBe(401);
  });

  it('is not offered, and sends nothing, where e-mail cannot be delivered', async () => {
    deliverable = false;
    try {
      expect((await call('GET', '/admin/api/auth/methods')).json().passwordReset).toBe(false);
      const before = sent.length;
      expect((await call('POST', '/admin/api/auth/password/forgot', { email: 'plain@example.com' }, { ip: nextIp() })).json()).toEqual({ ok: true });
      expect(sent).toHaveLength(before);
    } finally { deliverable = true; }
    expect((await call('GET', '/admin/api/auth/methods')).json()).toMatchObject({ passwordReset: true, passkeys: { rpId: expect.any(String) }, links: { help: expect.stringContaining('github.com') } });
  });
});
