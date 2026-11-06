import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import QRCode from 'qrcode';
import { z } from 'zod';
import {
  MIN_PASSWORD_LENGTH, beginTwoFactorSetup, confirmTwoFactor, createSession, publicAccount, setAccountPassword, updateAccountProfile, disableTwoFactor, getSecuritySettings, getShop, listPasskeys, listStaffSessions, otpauthUri, publicPasskey, regenerateRecoveryCodes, revokeOtherStaffSessions, revokeStaffSession,
  setRequireTwoFactor, twoFactorStatus, verifyStaffPassword,
} from '@shopme/core';
import { accountMember, invalidateSecurityPolicy, sessionToken, setSessionCookie } from '../plugins/auth';

const codeBody = z.object({ code: z.string().trim().min(6).max(12) });
const passwordBody = z.object({ password: z.string().min(1).max(200) });

/**
 * Staff security, all for the signed-in member (cookie session, not API tokens):
 *   GET    /admin/api/auth/security                 { twoFactor, require2fa, canManagePolicy, sessions }
 *   POST   /admin/api/auth/verify {password}           identity re-check before sensitive changes
 *   POST   /admin/api/auth/2fa/setup                { secret, otpauthUri, qrSvg }
 *   POST   /admin/api/auth/2fa/enable {code}        { recoveryCodes }
 *   POST   /admin/api/auth/2fa/disable {password}
 *   POST   /admin/api/auth/2fa/recovery-codes {password}   { recoveryCodes }
 *   PUT    /admin/api/auth/security {require2fa}    (owner/admin)
 *   GET/PATCH /admin/api/auth/profile {firstName, lastName}   the account's name (account page)
 *   POST   /admin/api/auth/password/change {password, newPassword}   signs the other devices out
 *   DELETE /admin/api/auth/sessions/:id, POST /admin/api/auth/sessions/revoke-others
 */
export function registerTwoFactorRoutes(app: FastifyInstance) {
  const { db, config } = app.ctx;

  /** The signed-in account (with the store membership of the store open, if any); two-step verification and sessions belong to the account, shared by all its stores. */
  const member = (req: FastifyRequest, reply: FastifyReply) => accountMember(req, reply);

  app.get('/admin/api/auth/security', async (req, reply) => {
    const m = await member(req, reply);
    if (!m) return;
    const [twoFactor, policy, sessions, passkeys] = await Promise.all([twoFactorStatus(db, m.accountId), (m.shopId != null ? getSecuritySettings(db, m.shopId) : Promise.resolve({ require2fa: false })), listStaffSessions(db, m.accountId, sessionToken(req)), listPasskeys(db, m.accountId)]);
    return { twoFactor, passkeys: passkeys.map(publicPasskey), requireSecureLogin: m.user?.requireSecureLogin ?? false, require2fa: policy.require2fa, canManagePolicy: !!m.user && m.user.role !== 'staff', sessions: sessions.map((s) => ({ ...s, userAgent: s.userAgent ?? '' })) };
  });

  app.post('/admin/api/auth/2fa/setup', async (req, reply) => {
    const m = await member(req, reply);
    if (!m) return;
    const r = await beginTwoFactorSetup(db, config.sessionSecret, m.accountId);
    if (!r) return reply.code(409).send({ error: 'Two-factor authentication is already enabled' });
    const shop = m.shopId != null ? await getShop(db, m.shopId) : null;
    const uri = otpauthUri(r.secret, m.account.email, shop?.name ?? 'ShopMe');
    return { secret: r.secret, otpauthUri: uri, qrSvg: await QRCode.toString(uri, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' }) };
  });

  app.post('/admin/api/auth/2fa/enable', async (req, reply) => {
    const m = await member(req, reply);
    const body = codeBody.safeParse(req.body);
    if (!m) return;
    if (!body.success) return reply.code(422).send({ error: 'A code is required' });
    const r = await confirmTwoFactor(db, config.sessionSecret, m.accountId, body.data.code);
    return r ? r : reply.code(422).send({ error: 'Invalid code' });
  });

  const withPassword = (handler: (m: { accountId: number }) => Promise<unknown>) => async (req: FastifyRequest, reply: FastifyReply) => {
    const m = await member(req, reply);
    if (!m) return;
    const body = passwordBody.safeParse(req.body);
    if (!body.success || !(await verifyStaffPassword(db, { accountId: m.accountId }, body.data.password))) return reply.code(403).send({ error: 'Incorrect password' });
    return handler(m);
  };
  /** Identity re-check before a sensitive change (the admin shows "Verify your account to continue"). */
  app.post('/admin/api/auth/verify', withPassword(async () => ({ ok: true })));
  app.post('/admin/api/auth/2fa/disable', withPassword(async (m) => { await disableTwoFactor(db, m.accountId); return { ok: true }; }));
  app.post('/admin/api/auth/2fa/recovery-codes', withPassword(async (m) => ({ recoveryCodes: (await regenerateRecoveryCodes(db, m.accountId)) ?? [] })));

  app.put('/admin/api/auth/security', async (req, reply) => {
    const m = await member(req, reply);
    if (!m) return;
    if (!m.user || m.shopId == null || m.user.role === 'staff') return reply.code(403).send({ error: 'Only the owner or an admin can change this' });
    const body = z.object({ require2fa: z.boolean() }).safeParse(req.body);
    if (!body.success) return reply.code(422).send({ error: 'require2fa is required' });
    await setRequireTwoFactor(db, m.shopId!, body.data.require2fa);
    invalidateSecurityPolicy();
    return { require2fa: body.data.require2fa };
  });

  app.delete('/admin/api/auth/sessions/:id', async (req, reply) => {
    const m = await member(req, reply);
    if (!m) return;
    const ok = await revokeStaffSession(db, m.accountId, (req.params as { id: string }).id);
    return ok ? { ok: true } : reply.code(404).send({ error: 'Session not found' });
  });
  app.post('/admin/api/auth/sessions/revoke-others', async (req, reply) => {
    const m = await member(req, reply);
    if (!m) return;
    return { revoked: await revokeOtherStaffSessions(db, m.accountId, sessionToken(req)) };
  });

  app.get('/admin/api/auth/profile', async (req, reply) => {
    const m = await member(req, reply);
    if (!m) return;
    return { account: publicAccount(m.account) };
  });
  app.patch('/admin/api/auth/profile', async (req, reply) => {
    const m = await member(req, reply);
    const body = z.object({ firstName: z.string().trim().max(100), lastName: z.string().trim().max(100) }).safeParse(req.body);
    if (!m) return;
    if (!body.success) return reply.code(422).send({ error: 'Invalid input' });
    const row = await updateAccountProfile(db, m.accountId, { firstName: body.data.firstName || null, lastName: body.data.lastName || null });
    return row ? { account: publicAccount(row) } : reply.code(404).send({ error: 'Account not found' });
  });

  app.post('/admin/api/auth/password/change', async (req, reply) => {
    const m = await member(req, reply);
    const body = z.object({ password: z.string().min(1).max(200), newPassword: z.string().min(MIN_PASSWORD_LENGTH).max(200) }).safeParse(req.body);
    if (!m) return;
    if (!body.success) return reply.code(422).send({ error: `The new password needs at least ${MIN_PASSWORD_LENGTH} characters` });
    if (!(await verifyStaffPassword(db, { accountId: m.accountId }, body.data.password))) return reply.code(403).send({ error: 'Incorrect password' });
    await setAccountPassword(db, m.accountId, body.data.newPassword);
    // Every device was signed out; this one stays signed in.
    const session = await createSession(db, { shopId: m.shopId, staffUserId: m.user?.id ?? null, accountId: m.accountId, ip: req.ip, userAgent: req.headers['user-agent'] });
    setSessionCookie(app, reply, session.token, session.expiresAt);
    return { ok: true };
  });
}
