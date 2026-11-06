import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  accountCount, authenticateAccount, canCreateStores, countPasskeys, createSession, destroySession, getAccount, getShop, handleOf, isTwoFactorEnabled, listAccountStores, listStaffSessions, needsSetup, publicAccount, publicStaff,
  sendNotification, setSessionShop, setupStore, staffOfAccount, twoFactorEnrolmentRequired, SetupError, signChallenge, verifyChallenge, verifySecondFactor, schema, type Account, type Shop, type StaffUser,
} from '@shopme/core';
import { eq } from 'drizzle-orm';
import { accountOf, authenticate, clearSessionCookie, requestedShopId, sessionToken, setSessionCookie } from '../plugins/auth';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { FailureLimiter } from '../plugins/rate-limit';
import { applyStartingTheme, startingThemeExists } from './starting-theme';
import { emailCodeStep, registerLoginMethodRoutes } from './login-methods-routes';

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
  /** Handle of the bundled theme the store starts with (default: Aurora). */
  theme: z.string().trim().toLowerCase().max(40).optional(),
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

  const multi = app.ctx.config.multiStore;
  // Multi-store: the installation is set up once its first account exists (stores can then be created and deleted freely).
  const setupNeeded = async () => (multi ? (await accountCount(db)) === 0 && (await needsSetup(db)) : needsSetup(db));
  app.get('/admin/api/setup/status', async () => ({ needsSetup: await setupNeeded() }));

  app.post('/admin/api/setup', async (req, reply) => {
    const body = setupBody.safeParse(req.body);
    if (!body.success) return reply.code(422).send({ error: 'Invalid input', issues: body.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })) });
    try {
      if (multi && !(await setupNeeded())) throw new SetupError('Store is already set up');
      if (body.data.theme && !startingThemeExists(app, body.data.theme)) return reply.code(422).send({ error: 'Unknown theme', issues: [{ field: 'theme', message: 'Unknown theme' }] });
      const { theme: startingTheme, ...setup } = body.data;
      const { shop, owner } = await setupStore(db, { ...setup, ...(multi && { perStoreStorage: true, platformOwner: true }) });
      await app.ctx.locales.refresh(db);
      await app.ctx.stores.refresh(db);
      // Install the starting theme (Aurora unless another was chosen) now so the admin theme editor works before the storefront is ever visited.
      await applyStartingTheme(app, shop.id, startingTheme);
      const session = await createSession(db, { shopId: shop.id, staffUserId: owner.id, accountId: owner.accountId, ip: req.ip, userAgent: req.headers['user-agent'] });
      setSessionCookie(app, reply, session.token, session.expiresAt);
      const account = multi && owner.accountId != null ? await getAccount(db, owner.accountId) : null;
      return reply.code(201).send({ user: publicStaff(owner), shop: publicShop(shop), ...(multi && { storeHandle: handleOf(shop), ...(account && { account: publicAccount(account) }) }) });
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
    const account = await authenticateAccount(db, body.data.email, body.data.password);
    const user = account ? await memberFor(req, account) : null;
    // An account without an active membership cannot sign in, except (multi-store) one allowed to create its first store.
    if (!account || (!user && !(multi && (await canCreateStores(db, account))))) {
      keys.forEach((k) => limiter.fail(k));
      return reply.code(401).send({ error: 'Invalid email or password' });
    }
    keys.forEach((k) => limiter.reset(k));
    if (await isTwoFactorEnabled(db, account.id)) return { twoFactorRequired: true, challenge: signChallenge(app.ctx.config.sessionSecret, account.id) };
    // A member invited with "secure sign-in method" who already has a passkey signs in with it, not with a password alone.
    if (user?.requireSecureLogin && (await countPasskeys(db, account.id)) > 0) {
      return reply.code(403).send({ error: 'This account must sign in with a passkey or two-step verification.', passkeyRequired: true });
    }
    // A device this account has not used yet confirms itself with a code mailed to the account (only when e-mail can be delivered).
    const step = await emailCodeStep(app, req, account, user);
    if (step) return step;
    return finishLogin(app, req, reply, account, user);
  });

  registerLoginMethodRoutes(app, limiter, { finishLogin, memberFor });

  /** Second login step: the signed challenge from the password step plus a TOTP or recovery code. */
  app.post('/admin/api/auth/login/2fa', async (req, reply) => {
    const body = challengeBody.safeParse(req.body);
    if (!body.success) return reply.code(422).send({ error: 'A code is required' });
    const accountId = verifyChallenge(app.ctx.config.sessionSecret, body.data.challenge);
    if (!accountId) return reply.code(401).send({ error: 'The sign-in expired. Enter your password again.', expired: true });
    const keys = [`ip:${req.ip}`, `2fa:${accountId}`];
    const limited = keys.find((k) => limiter.isLimited(k));
    if (limited) return reply.code(429).header('retry-after', String(limiter.retryAfter(limited))).send({ error: 'Too many failed attempts. Try again later.' });
    if (!(await verifySecondFactor(db, app.ctx.config.sessionSecret, accountId, body.data.code))) {
      keys.forEach((k) => limiter.fail(k));
      return reply.code(401).send({ error: 'Invalid code' });
    }
    keys.forEach((k) => limiter.reset(k));
    const account = await getAccount(db, accountId);
    const user = account?.active ? await memberFor(req, account) : null;
    if (!account?.active || (!user && !(multi && (await canCreateStores(db, account))))) return reply.code(401).send({ error: 'Invalid code' });
    return finishLogin(app, req, reply, account, user);
  });

  app.post('/admin/api/auth/logout', async (req, reply) => {
    const token = sessionToken(req);
    if (token) await destroySession(db, token);
    clearSessionCookie(reply);
    return { ok: true };
  });

  app.get('/admin/api/auth/me', async (req, reply) => {
    if (multi) return accountMe(app, req, reply);
    const auth = await authenticate(req);
    if (!auth || auth.kind !== 'session') return reply.code(401).send({ error: 'Not authenticated' });
    const shop = await getShop(db, auth.shopId);
    return { user: publicStaff(auth.user), shop: shop ? publicShop(shop) : null, twoFactorSetupRequired: auth.needs2fa === true };
  });
}

/**
 * The staff membership a sign-in opens: single-store, the account's (only) store; multi-store, the store the request names
 * (its own host or admin URL) when the account works there, else its first store, else none.
 */
export async function memberFor(req: FastifyRequest, account: Account): Promise<StaffUser | null> {
  const members = await staffOfAccount(req.server.ctx.db, account.id);
  if (!req.server.ctx.config.multiStore) return members[0] ?? null;
  const wanted = await requestedShopId(req);
  return members.find((m) => m.shopId === wanted) ?? members[0] ?? null;
}

/** Multi-store `GET /admin/api/auth/me`: the account, its stores, and the store this request names (or the session's last one). */
async function accountMe(app: FastifyInstance, req: FastifyRequest, reply: FastifyReply) {
  const { db, config, stores } = app.ctx;
  const sess = await accountOf(req);
  if (!sess) return reply.code(401).send({ error: 'Not authenticated' });
  const auth = await authenticate(req);
  const list = await listAccountStores(db, sess.account.id, config.stripe.publishableKey);
  const base = {
    multiStore: true, account: publicAccount(sess.account), canCreateStores: await canCreateStores(db, sess.account),
    stores: list.map((x) => ({ ...x, host: stores.platformHost(x.handle), url: stores.publicOrigin(x.id) })),
  };
  if (!auth || auth.kind !== 'session') {
    if (req.authDenied) return reply.code(403).send({ error: 'You do not have access to this store', ...base });
    return { ...base, user: null, shop: null, twoFactorSetupRequired: false };
  }
  const token = sessionToken(req);
  if (token && sess.shopId !== auth.shopId) await setSessionShop(db, token, auth.shopId, auth.user.id);
  const shop = await getShop(db, auth.shopId);
  return {
    ...base, user: publicStaff(auth.user), shop: shop ? { ...publicShop(shop), handle: handleOf(shop), status: shop.status, url: stores.publicOrigin(shop.id) } : null,
    storeHandle: shop ? handleOf(shop) : null, suspended: shop?.status === 'SUSPENDED', twoFactorSetupRequired: auth.needs2fa === true,
  };
}

const deviceOf = (ua: string | undefined) => (ua ?? 'unknown').slice(0, 120);

/** Create the session after the password (and second factor); mail a sign-in alert when it comes from a device with no active session. */
export async function finishLogin(app: FastifyInstance, req: FastifyRequest, reply: FastifyReply, account: Account, user: StaffUser | null) {
  const { db } = app.ctx;
  const ua = req.headers['user-agent'];
  const known = (await listStaffSessions(db, account.id, null)).some((x) => x.ip === req.ip && x.userAgent === (ua ?? '').slice(0, 255));
  const session = await createSession(db, { shopId: user?.shopId ?? null, staffUserId: user?.id ?? null, accountId: account.id, ip: req.ip, userAgent: ua });
  setSessionCookie(app, reply, session.token, session.expiresAt);
  const shop = user ? await getShop(db, user.shopId) : null;
  if (user) await db.update(schema.staffUsers).set({ lastLoginAt: new Date() }).where(eq(schema.staffUsers.id, user.id));
  if (shop && user && !known && user.lastLoginAt) {
    const time = new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
    sendNotification(db, app.ctx.mailer, shop, app.ctx.stores.storefrontBase(shop.id), 'staff_login_alert', account.email, { login: { email: account.email, ip: req.ip, device: deviceOf(ua), time } })
      .catch((err) => req.log.warn({ err }, 'login alert failed'));
  }
  const out = { user: user ? publicStaff(user) : null, shop: shop ? publicShop(shop) : null, twoFactorSetupRequired: user ? (await twoFactorEnrolmentRequired(db, user.shopId, account.id)) || (user.requireSecureLogin && !(await isTwoFactorEnabled(db, account.id)) && (await countPasskeys(db, account.id)) === 0) : false };
  return app.ctx.config.multiStore ? { ...out, account: publicAccount(account), storeHandle: shop ? handleOf(shop) : null } : out;
}
