import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { schema as s } from '@shopme/core';
import { createTestApp, SETUP_BODY, setupAndLogin, type TestApp } from './test-utils';

let t: TestApp;
let owner: string;
const call = (method: 'GET' | 'POST' | 'PATCH', url: string, payload?: unknown, cookie: string | null = owner, ip = '10.2.0.1') =>
  t.app.inject({ method, url, payload: payload as never, remoteAddress: ip, cookies: cookie ? { shopme_session: cookie } : {} });

beforeAll(async () => { t = await createTestApp(); owner = await setupAndLogin(t.app); }, 120_000);
afterAll(async () => { await t?.close(); });

describe('account profile and password', () => {
  it('needs a session', async () => {
    expect((await call('GET', '/admin/api/auth/profile', undefined, null)).statusCode).toBe(401);
    expect((await call('PATCH', '/admin/api/auth/profile', { firstName: 'A', lastName: 'B' }, null)).statusCode).toBe(401);
  });

  it('re-checks the password before a sensitive change', async () => {
    expect((await call('POST', '/admin/api/auth/verify', { password: 'nope-nope' })).statusCode).toBe(403);
    expect((await call('POST', '/admin/api/auth/verify', { password: SETUP_BODY.password })).json()).toEqual({ ok: true });
    expect((await call('POST', '/admin/api/auth/verify', { password: SETUP_BODY.password }, null)).statusCode).toBe(401);
  });

  it('renames the account and its staff memberships', async () => {
    const r = await call('PATCH', '/admin/api/auth/profile', { firstName: ' Ada ', lastName: 'Lovelace' });
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json().account).toMatchObject({ firstName: 'Ada', lastName: 'Lovelace' });
    expect((await call('GET', '/admin/api/auth/profile')).json().account).toMatchObject({ email: SETUP_BODY.email, firstName: 'Ada' });
    const staff = await t.dbHandle.db.select().from(s.staffUsers).where(eq(s.staffUsers.email, SETUP_BODY.email));
    expect(staff[0]).toMatchObject({ firstName: 'Ada', lastName: 'Lovelace' });
    // A blank name clears it.
    const cleared = await call('PATCH', '/admin/api/auth/profile', { firstName: '', lastName: '' });
    expect(cleared.json().account).toMatchObject({ firstName: null, lastName: null });
  });

  it('changes the password after checking the current one, keeps this device signed in and signs the others out', async () => {
    const other = (await t.app.inject({ method: 'POST', url: '/admin/api/auth/login', payload: { email: SETUP_BODY.email, password: SETUP_BODY.password }, remoteAddress: '10.2.0.1' })).cookies.find((c) => c.name === 'shopme_session')?.value;
    expect(other).toBeDefined();
    expect((await call('POST', '/admin/api/auth/password/change', { password: 'wrong-password', newPassword: 'a-brand-new-password' })).statusCode).toBe(403);
    expect((await call('POST', '/admin/api/auth/password/change', { password: SETUP_BODY.password, newPassword: 'short' })).statusCode).toBe(422);
    const ok = await call('POST', '/admin/api/auth/password/change', { password: SETUP_BODY.password, newPassword: 'a-brand-new-password' });
    expect(ok.statusCode, ok.body).toBe(200);
    const fresh = ok.cookies.find((c) => c.name === 'shopme_session')?.value;
    expect(fresh).toBeDefined();
    expect((await call('GET', '/admin/api/auth/profile', undefined, fresh)).statusCode).toBe(200);
    expect((await call('GET', '/admin/api/auth/profile', undefined, owner)).statusCode).toBe(401);
    expect((await call('GET', '/admin/api/auth/profile', undefined, other)).statusCode).toBe(401);
    const login = await t.app.inject({ method: 'POST', url: '/admin/api/auth/login', payload: { email: SETUP_BODY.email, password: 'a-brand-new-password' }, remoteAddress: '10.2.0.1' });
    expect(login.statusCode).toBe(200);
  });
});
