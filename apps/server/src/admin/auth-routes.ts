import type { FastifyInstance } from 'fastify';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { schema, authenticateStaff, createSession, destroySession, ensureDefaultTheme, getShop, isTwoFactorEnabled, listStaffSessions, needsSetup, publicStaff, sendNotification, setupStore, twoFactorEnrolmentRequired, SetupError, signChallenge, verifyChallenge, verifySecondFactor, type Shop, type StaffUser } from '@shopme/core';
import { authenticate, clearSessionCookie, sessionToken, setSessionCookie } from '../plugins/auth';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { FailureLimiter } from '../plugins/rate-limit';

const setupBody = z.object({
  shopName: z.string().trim().min(1).max(120),
  email: z.string().trim().email().max(254),
  password: z.string().min(8).max(200),
  currency: z.string().trim().regex(/^[A-Za-z]{3}$/),
  country: z.string().trim().regex(/^[A-Za-z]{2}$/),
  locale: z.string().trim().min(2).max(20).default('en'),
  timezone: z.string().trim().min(1).max(64).optional(),
  firstName: z.string().trim().max(100).optional(),
  lastName: z.string().trim().max(100).optional(),
});
const loginBody = z.object({ email: z.string().trim().email(), password: z.string().min(1).max(200) });
const challengeBody = z.object({ challenge: z.string().min(10).max(200), code: z.string().trim().min(6).max(20) });

export const publicShop = (s: Shop) => ({
  id: s.id, name: s.name, email: s.email, currency: s.currency, country: s.country, locale: s.locale, timezone: s.timezone,
  weightUnit: s.weightUnit, moneyFormat: s.moneyFormat, moneyWithCurrencyFormat: s.moneyWithCurrencyFormat,
  taxesIncluded: s.taxesIncluded, primaryDomain: s.primaryDomain,
});

export function registerAuthRoutes(app: FastifyInstance) {
  const { db } = app.ctx;
  const limiter = new FailureLimiter(10, 15 * 60 * 1000);

  app.get('/admin/api/setup/status', async () => ({ needsSetup: await needsSetup(db) }));

  app.post('/admin/api/setup', async (req, reply) => {
    const body = setupBody.safeParse(req.body);
    if (!body.success) return reply.code(422).send({ error: 'Invalid input', issues: body.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })) });
    try {
      const { shop, owner } = await setupStore(db, body.data);
      await app.ctx.locales.refresh(db);
      // Install Aurora now so the admin theme editor works before the storefront is ever visited.
      await ensureDefaultTheme(db, shop.id, app.ctx.paths.themeDefaultDir, app.ctx.storage);
      const session = await createSession(db, { shopId: shop.id, staffUserId: owner.id, ip: req.ip, userAgent: req.headers['user-agent'] });
      setSessionCookie(app, reply, session.token, session.expiresAt);
      return reply.code(201).send({ user: publicStaff(owner), shop: publicShop(shop) });
    } catch (e) {
      if (e instanceof SetupError) return reply.code(409).send({ error: e.message });
      throw e;
    }
  });

  app.post('/admin/api/auth/login', async (req, reply) => {
    const body = loginBody.safeParse(req.body);
    if (!body.success) return reply.code(422).send({ error: 'Email and password are required' });
    const keys = [`ip:${req.ip}`, `email:${body.data.email.toLowerCase()}`];
    const limited = keys.find((k) => limiter.isLimited(k));
    if (limited) return reply.code(429).header('retry-after', String(limiter.retryAfter(limited))).send({ error: 'Too many failed attempts. Try again later.' });
    const user = await authenticateStaff(db, body.data.email, body.data.password);
    if (!user) {
      keys.forEach((k) => limiter.fail(k));
      return reply.code(401).send({ error: 'Invalid email or password' });
    }
    keys.forEach((k) => limiter.reset(k));
    if (await isTwoFactorEnabled(db, user.id)) return { twoFactorRequired: true, challenge: signChallenge(app.ctx.config.sessionSecret, user.id) };
    return finishLogin(app, req, reply, user);
  });

  /** Second login step: the signed challenge from the password step plus a TOTP or recovery code. */
  app.post('/admin/api/auth/login/2fa', async (req, reply) => {
    const body = challengeBody.safeParse(req.body);
    if (!body.success) return reply.code(422).send({ error: 'A code is required' });
    const userId = verifyChallenge(app.ctx.config.sessionSecret, body.data.challenge);
    if (!userId) return reply.code(401).send({ error: 'The sign-in expired. Enter your password again.', expired: true });
    const keys = [`ip:${req.ip}`, `2fa:${userId}`];
    const limited = keys.find((k) => limiter.isLimited(k));
    if (limited) return reply.code(429).header('retry-after', String(limiter.retryAfter(limited))).send({ error: 'Too many failed attempts. Try again later.' });
    if (!(await verifySecondFactor(db, app.ctx.config.sessionSecret, userId, body.data.code))) {
      keys.forEach((k) => limiter.fail(k));
      return reply.code(401).send({ error: 'Invalid code' });
    }
    keys.forEach((k) => limiter.reset(k));
    const user = (await db.select().from(schema.staffUsers).where(and(eq(schema.staffUsers.id, userId), eq(schema.staffUsers.active, true))))[0];
    if (!user) return reply.code(401).send({ error: 'Invalid code' });
    return finishLogin(app, req, reply, user);
  });

  app.post('/admin/api/auth/logout', async (req, reply) => {
    const token = sessionToken(req);
    if (token) await destroySession(db, token);
    clearSessionCookie(reply);
    return { ok: true };
  });

  app.get('/admin/api/auth/me', async (req, reply) => {
    const auth = await authenticate(req);
    if (!auth || auth.kind !== 'session') return reply.code(401).send({ error: 'Not authenticated' });
    const shop = await getShop(db, auth.shopId);
    return { user: publicStaff(auth.user), shop: shop ? publicShop(shop) : null, twoFactorSetupRequired: auth.needs2fa === true };
  });
}

const deviceOf = (ua: string | undefined) => (ua ?? 'unknown').slice(0, 120);

/** Create the session after the password (and second factor); mail a sign-in alert when it comes from a device with no active session. */
export async function finishLogin(app: FastifyInstance, req: FastifyRequest, reply: FastifyReply, user: StaffUser) {
  const { db } = app.ctx;
  const ua = req.headers['user-agent'];
  const known = (await listStaffSessions(db, user.id, null)).some((x) => x.ip === req.ip && x.userAgent === (ua ?? '').slice(0, 255));
  const session = await createSession(db, { shopId: user.shopId, staffUserId: user.id, ip: req.ip, userAgent: ua });
  setSessionCookie(app, reply, session.token, session.expiresAt);
  const shop = await getShop(db, user.shopId);
  if (shop && !known && user.lastLoginAt) {
    const time = new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
    sendNotification(db, app.ctx.mailer, shop, app.ctx.config.appUrl, 'staff_login_alert', user.email, { login: { email: user.email, ip: req.ip, device: deviceOf(ua), time } })
      .catch((err) => req.log.warn({ err }, 'login alert failed'));
  }
  return { user: publicStaff(user), shop: shop ? publicShop(shop) : null, twoFactorSetupRequired: await twoFactorEnrolmentRequired(db, user.shopId, user.id) };
}
