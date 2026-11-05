import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import QRCode from 'qrcode';
import { z } from 'zod';
import {
  beginTwoFactorSetup, confirmTwoFactor, disableTwoFactor, getSecuritySettings, getShop, listStaffSessions, otpauthUri, regenerateRecoveryCodes, revokeOtherStaffSessions, revokeStaffSession,
  setRequireTwoFactor, twoFactorStatus, verifyPassword, type StaffUser,
} from '@shopme/core';
import { authenticate, invalidateSecurityPolicy, sessionToken } from '../plugins/auth';

const codeBody = z.object({ code: z.string().trim().min(6).max(12) });
const passwordBody = z.object({ password: z.string().min(1).max(200) });

/**
 * Staff security, all for the signed-in member (cookie session, not API tokens):
 *   GET    /admin/api/auth/security                 { twoFactor, require2fa, canManagePolicy, sessions }
 *   POST   /admin/api/auth/2fa/setup                { secret, otpauthUri, qrSvg }
 *   POST   /admin/api/auth/2fa/enable {code}        { recoveryCodes }
 *   POST   /admin/api/auth/2fa/disable {password}
 *   POST   /admin/api/auth/2fa/recovery-codes {password}   { recoveryCodes }
 *   PUT    /admin/api/auth/security {require2fa}    (owner/admin)
 *   DELETE /admin/api/auth/sessions/:id, POST /admin/api/auth/sessions/revoke-others
 */
export function registerTwoFactorRoutes(app: FastifyInstance) {
  const { db, config } = app.ctx;

  async function member(req: FastifyRequest, reply: FastifyReply): Promise<{ user: StaffUser; shopId: number } | null> {
    const auth = await authenticate(req);
    if (!auth || auth.kind !== 'session') { reply.code(401).send({ error: 'Not authenticated' }); return null; }
    return { user: auth.user, shopId: auth.shopId };
  }

  app.get('/admin/api/auth/security', async (req, reply) => {
    const m = await member(req, reply);
    if (!m) return;
    const [twoFactor, policy, sessions] = await Promise.all([twoFactorStatus(db, m.user.id), getSecuritySettings(db, m.shopId), listStaffSessions(db, m.user.id, sessionToken(req))]);
    return { twoFactor, require2fa: policy.require2fa, canManagePolicy: m.user.role !== 'staff', sessions: sessions.map((s) => ({ ...s, userAgent: s.userAgent ?? '' })) };
  });

  app.post('/admin/api/auth/2fa/setup', async (req, reply) => {
    const m = await member(req, reply);
    if (!m) return;
    const r = await beginTwoFactorSetup(db, config.sessionSecret, m.user);
    if (!r) return reply.code(409).send({ error: 'Two-factor authentication is already enabled' });
    const shop = await getShop(db, m.shopId);
    const uri = otpauthUri(r.secret, m.user.email, shop?.name ?? 'ShopMe');
    return { secret: r.secret, otpauthUri: uri, qrSvg: await QRCode.toString(uri, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' }) };
  });

  app.post('/admin/api/auth/2fa/enable', async (req, reply) => {
    const m = await member(req, reply);
    const body = codeBody.safeParse(req.body);
    if (!m) return;
    if (!body.success) return reply.code(422).send({ error: 'A code is required' });
    const r = await confirmTwoFactor(db, config.sessionSecret, m.user.id, body.data.code);
    return r ? r : reply.code(422).send({ error: 'Invalid code' });
  });

  const withPassword = (handler: (m: { user: StaffUser; shopId: number }) => Promise<unknown>) => async (req: FastifyRequest, reply: FastifyReply) => {
    const m = await member(req, reply);
    if (!m) return;
    const body = passwordBody.safeParse(req.body);
    if (!body.success || !(await verifyPassword(m.user.passwordHash, body.data.password))) return reply.code(403).send({ error: 'Incorrect password' });
    return handler(m);
  };
  app.post('/admin/api/auth/2fa/disable', withPassword(async (m) => { await disableTwoFactor(db, m.user.id); return { ok: true }; }));
  app.post('/admin/api/auth/2fa/recovery-codes', withPassword(async (m) => ({ recoveryCodes: (await regenerateRecoveryCodes(db, m.user.id)) ?? [] })));

  app.put('/admin/api/auth/security', async (req, reply) => {
    const m = await member(req, reply);
    if (!m) return;
    if (m.user.role === 'staff') return reply.code(403).send({ error: 'Only the owner or an admin can change this' });
    const body = z.object({ require2fa: z.boolean() }).safeParse(req.body);
    if (!body.success) return reply.code(422).send({ error: 'require2fa is required' });
    await setRequireTwoFactor(db, m.shopId, body.data.require2fa);
    invalidateSecurityPolicy();
    return { require2fa: body.data.require2fa };
  });

  app.delete('/admin/api/auth/sessions/:id', async (req, reply) => {
    const m = await member(req, reply);
    if (!m) return;
    const ok = await revokeStaffSession(db, m.user.id, (req.params as { id: string }).id);
    return ok ? { ok: true } : reply.code(404).send({ error: 'Session not found' });
  });
  app.post('/admin/api/auth/sessions/revoke-others', async (req, reply) => {
    const m = await member(req, reply);
    if (!m) return;
    return { revoked: await revokeOtherStaffSessions(db, m.user.id, sessionToken(req)) };
  });
}
