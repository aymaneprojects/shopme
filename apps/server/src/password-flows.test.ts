import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { createAccount, schema as s, type Mail } from '@shopme/core';
import { createTestApp, MULTI_STORE_RUN, SETUP_BODY, setupAndLogin, type TestApp } from './test-utils';

// Reset and change of the account password, then signing in with the new one. Runs in single-store mode, and again in multi-store
// mode through `pnpm --filter @shopme/server test:multi`.
let t: TestApp;
let owner: string;
const sent: Mail[] = [];
let n = 1;
const ip = () => `10.7.0.${n++}`;
const call = (url: string, payload: unknown, o: { cookie?: string; ip?: string } = {}) =>
  t.app.inject({ method: 'POST', url, payload: payload as never, remoteAddress: o.ip ?? ip(), cookies: o.cookie ? { shopme_session: o.cookie } : {} });
const login = (email: string, password: string) => call('/admin/api/auth/login', { email, password });
const signedIn = (r: { cookies: Array<{ name: string }> }) => r.cookies.some((c) => c.name === 'shopme_session');
const lastCode = () => /\b(\d{6})\b/.exec(sent.at(-1)!.text!)![1]!;
const db = () => t.dbHandle.db;

beforeAll(async () => {
  t = await createTestApp();
  owner = await setupAndLogin(t.app);
  t.app.ctx.mailer = { send: async (m) => { sent.push(m); } };
  t.app.ctx.email.health = async () => ({ status: 'ok', reasons: [], effectiveMode: 'relay', fromKind: 'store', done: true });
}, 120_000);
afterAll(async () => { await t?.close(); });

describe(`password reset and change (${MULTI_STORE_RUN ? 'multi-store' : 'single-store'})`, () => {
  it('signs in with the new password after a reset, and no longer with the old one', async () => {
    const email = SETUP_BODY.email;
    expect((await call('/admin/api/auth/password/forgot', { email })).json()).toEqual({ ok: true });
    expect(sent.at(-1)!.subject).toMatch(/password reset code/);
    const ok = await call('/admin/api/auth/password/reset', { email, code: lastCode(), password: 'reset password 1' });
    expect(ok.statusCode, ok.body).toBe(200);
    expect((await login(email, SETUP_BODY.password)).statusCode).toBe(401);
    const fresh = await login(email, 'reset password 1');
    expect(fresh.statusCode, fresh.body).toBe(200);
    // New device: either the session opens at once or the mailed code step comes first; never "incorrect".
    expect(signedIn(fresh) || fresh.json().emailCodeRequired === true).toBe(true);
    // The old session was signed out by the reset.
    expect((await t.app.inject({ method: 'GET', url: '/admin/api/auth/profile', cookies: { shopme_session: owner } })).statusCode).toBe(401);
  });

  it('keeps the new password for every account sharing the e-mail, so the one with the store is not left behind', async () => {
    // Accounts may share an e-mail (members migrated from separate stores). The mailed code of the account without a store must
    // not turn the reset into a silent no-op for the account that signs in.
    const email = 'twin@example.com';
    const real = await createAccount(db(), { email, password: 'twin password 1' });
    const shop = (await db().select().from(s.shops))[0]!;
    await db().insert(s.staffUsers).values({ shopId: shop.id, email, accountId: real.id, role: 'staff', permissions: ['orders'], passwordHash: 'x', active: true });
    const orphan = await createAccount(db(), { email, password: 'twin password 2' });
    expect((await call('/admin/api/auth/password/forgot', { email })).json()).toEqual({ ok: true });
    // Use the code issued for the account that has no store.
    const { issueDeviceCode } = await import('@shopme/core');
    await db().delete(s.accountLoginCodes).where(eq(s.accountLoginCodes.accountId, orphan.id));
    const issued = await issueDeviceCode(db(), orphan.id);
    expect(issued.ok).toBe(true);
    const code = issued.ok ? issued.code : '';
    const reset = await call('/admin/api/auth/password/reset', { email, code, password: 'twin password 3' });
    expect(reset.statusCode, reset.body).toBe(200);
    const r = await login(email, 'twin password 3');
    expect(r.statusCode, r.body).toBe(200);
  });

  it('signs in with the new password after a change, and no longer with the old one', async () => {
    const email = 'changer@example.com';
    const account = await createAccount(db(), { email, password: 'change password 1' });
    const shop = (await db().select().from(s.shops))[0]!;
    await db().insert(s.staffUsers).values({ shopId: shop.id, email, accountId: account.id, role: 'admin', permissions: [], passwordHash: 'x', active: true });
    const step = await login(email, 'change password 1');
    expect(step.json().emailCodeRequired).toBe(true);
    const opened = await call('/admin/api/auth/login/email-code', { challenge: step.json().challenge, code: lastCode() });
    const cookie = opened.cookies.find((c) => c.name === 'shopme_session')?.value;
    expect(cookie, opened.body).toBeDefined();
    const ch = await call('/admin/api/auth/password/change', { password: 'change password 1', newPassword: 'change password 2' }, { cookie });
    expect(ch.statusCode, ch.body).toBe(200);
    expect((await login(email, 'change password 1')).statusCode).toBe(401);
    const again = await login(email, 'change password 2');
    expect(again.statusCode, again.body).toBe(200);
    expect(signedIn(again) || again.json().emailCodeRequired === true).toBe(true);
  });
});
