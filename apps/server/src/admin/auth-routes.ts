import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticateStaff, createSession, destroySession, ensureDefaultTheme, getShop, needsSetup, publicStaff, setupStore, SetupError, type Shop } from '@shopme/core';
import { authenticate, clearSessionCookie, sessionToken, setSessionCookie } from '../plugins/auth';
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
      // Install Aurora now so the admin theme editor works before the storefront is ever visited.
      await ensureDefaultTheme(db, shop.id, app.ctx.paths.themeDefaultDir);
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
    const session = await createSession(db, { shopId: user.shopId, staffUserId: user.id, ip: req.ip, userAgent: req.headers['user-agent'] });
    setSessionCookie(app, reply, session.token, session.expiresAt);
    const shop = await getShop(db, user.shopId);
    return { user: publicStaff(user), shop: shop ? publicShop(shop) : null };
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
    return { user: publicStaff(auth.user), shop: shop ? publicShop(shop) : null };
  });
}
