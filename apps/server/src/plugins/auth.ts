import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { getSecuritySettings, isTwoFactorEnabled, resolveAccountSession, resolveApiToken, resolveSession, scopesFor, staffInShop, type Account } from '@shopme/core';
import type { AuthInfo } from '../context';

export const SESSION_COOKIE = 'shopme_session';
export const TOKEN_HEADER = 'x-shopify-access-token';
const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** Resolve the caller from an access-token header or the signed session cookie. Cached per request. */
export async function authenticate(req: FastifyRequest): Promise<AuthInfo | null> {
  if (req.auth) return req.auth;
  const { db, config } = req.server.ctx;
  const header = req.headers[TOKEN_HEADER];
  if (typeof header === 'string' && header) {
    const t = await resolveApiToken(db, header);
    if (!t) return null;
    // Multi-store: a token only works for its own store; a request that names another store is refused.
    if (config.multiStore) {
      const wanted = await requestedShopId(req);
      if (wanted !== null && wanted !== t.shopId) { req.authDenied = true; return null; }
    }
    return (req.auth = { kind: 'token', shopId: t.shopId, tokenId: t.id, scopes: t.scopes });
  }
  const token = sessionToken(req);
  if (!token) return null;
  if (!config.multiStore) {
    const user = await resolveSession(db, token);
    if (!user) return null;
    const needs2fa = await enrolmentRequired(req, user.shopId, user.accountId);
    return (req.auth = { kind: 'session', shopId: user.shopId, user, scopes: needs2fa ? [] : scopesFor(user), needs2fa });
  }
  // Multi-store: the session belongs to an account; the URL (or the store's own host) picks the store, checked on every request.
  const sess = await accountOf(req);
  if (!sess) return null;
  const wanted = await requestedShopId(req);
  const shopId = wanted ?? sess.shopId;
  if (shopId == null || shopId < 0) { if (shopId != null) req.authDenied = true; return null; }
  const user = await staffInShop(db, sess.account.id, shopId);
  if (!user) { req.authDenied = true; return null; }
  const needs2fa = await enrolmentRequired(req, shopId, sess.account.id);
  return (req.auth = { kind: 'session', shopId, user, scopes: needs2fa ? [] : scopesFor(user), needs2fa, account: sess.account });
}

const accountCache = new WeakMap<FastifyRequest, { account: Account; shopId: number | null } | null>();
/** Multi-store: the account of the session cookie and the store the session last used. */
export async function accountOf(req: FastifyRequest): Promise<{ account: Account; shopId: number | null } | null> {
  if (accountCache.has(req)) return accountCache.get(req)!;
  const token = sessionToken(req);
  const r = token ? await resolveAccountSession(req.server.ctx.db, token) : null;
  accountCache.set(req, r);
  return r;
}

/**
 * Multi-store: the store a request names, or null when it names none (then the session's last store applies). The admin URL
 * (`/admin/store/<handle>/...`) or the `X-ShopMe-Store` header names it by handle, the store's own host by host; when both are
 * present and disagree the request is refused (-1).
 */
export async function requestedShopId(req: FastifyRequest): Promise<number | null> {
  const { stores, db } = req.server.ctx;
  const header = req.headers['x-shopme-store'];
  const handle = stores.adminHandleOf(req.raw) ?? (typeof header === 'string' && header ? header.toLowerCase() : undefined);
  let byHandle: number | null = null;
  if (handle) {
    byHandle = stores.idForHandle(handle);
    if (byHandle == null) { await stores.refresh(db); byHandle = stores.idForHandle(handle) ?? -1; }
  }
  const byHost = req.hostShopId ?? null;
  if (byHandle != null && byHost != null && byHandle !== byHost) return -1;
  return byHandle ?? byHost;
}

const policyCache = new Map<number, { at: number; required: boolean }>();
/** Drop the cached "shop requires 2FA" flag (after the policy changes). */
export const invalidateSecurityPolicy = () => policyCache.clear();

async function enrolmentRequired(req: FastifyRequest, shopId: number, accountId: number | null): Promise<boolean> {
  const { db } = req.server.ctx;
  let hit = policyCache.get(shopId);
  if (!hit || Date.now() - hit.at > 10_000) {
    hit = { at: Date.now(), required: (await getSecuritySettings(db, shopId)).require2fa };
    policyCache.set(shopId, hit);
  }
  return hit.required && !(await isTwoFactorEnabled(db, accountId));
}

export function sessionToken(req: FastifyRequest): string | null {
  const raw = req.cookies[SESSION_COOKIE];
  if (!raw) return null;
  const un = req.unsignCookie(raw);
  return un.valid && un.value ? un.value : null;
}

export function setSessionCookie(app: FastifyInstance, reply: FastifyReply, token: string, expiresAt: Date) {
  reply.setCookie(SESSION_COOKIE, token, {
    path: '/', httpOnly: true, sameSite: 'lax', signed: true, expires: expiresAt,
    secure: app.ctx.config.appUrl.startsWith('https://'),
  });
}

export const clearSessionCookie = (reply: FastifyReply) => reply.clearCookie(SESSION_COOKIE, { path: '/' });

/**
 * CSRF defence for the admin API (in addition to SameSite=Lax): mutating requests that carry
 * an Origin header must come from this site or a trusted origin. Token-authenticated calls are exempt.
 */
export function installOriginCheck(app: FastifyInstance) {
  app.addHook('onRequest', async (req, reply) => {
    if (!MUTATING.has(req.method) || !req.url.startsWith('/admin/api/')) return;
    if (typeof req.headers[TOKEN_HEADER] === 'string') return;
    const origin = req.headers.origin;
    if (!origin) {
      // Browsers that send Fetch Metadata but no Origin: only the page's own origin, or a user-initiated request (`none`), may post.
      const site = req.headers['sec-fetch-site'];
      if (typeof site === 'string' && site !== 'same-origin' && site !== 'none') return reply.code(403).send({ error: 'Cross-site request blocked' });
      return;
    }
    let host: string;
    try { host = new URL(origin).host; } catch { return reply.code(403).send({ error: 'Bad Origin' }); }
    const { config } = app.ctx;
    // Multi-store: stores live on sibling hosts, so only the request's own host (and explicitly trusted origins) may post.
    const allowed = host === req.headers.host || (!config.multiStore && host === new URL(config.appUrl).host) || config.trustedOrigins.some((o) => o === origin);
    if (!allowed) return reply.code(403).send({ error: 'Cross-origin request blocked' });
  });
}

/** Admin endpoints that work without a store (account and platform level, public invitation and setup routes). */
const ACCOUNT_LEVEL = [/^\/admin\/api\/setup(\/|$)/, /^\/admin\/api\/auth\//, /^\/admin\/api\/account(\/|$)/, /^\/admin\/api\/platform(\/|$)/, /^\/admin\/api\/staff\/(invite|accept-invite)/, /^\/admin\/api\/staged\//];
const READ_ONLY_OK = [/^\/admin\/api\/\d{4}-\d{2}\/graphql\.json$/, /^\/admin\/api\/unstable\/graphql\.json$/];

/**
 * Multi-store, every store-level admin request: a signed-in account that is not staff of the store the request names gets 403
 * (never another store's data), and a suspended store refuses changes (read-only admin; GraphQL checks mutations itself).
 */
export function installStoreAccessCheck(app: FastifyInstance) {
  if (!app.ctx.config.multiStore) return;
  app.addHook('preHandler', async (req, reply) => {
    const path = req.url.split('?')[0]!;
    if (!path.startsWith('/admin/api/') || ACCOUNT_LEVEL.some((r) => r.test(path))) return;
    const auth = await authenticate(req);
    if (!auth && req.authDenied) return reply.code(403).send({ error: 'You do not have access to this store' });
    if (auth && MUTATING.has(req.method) && !READ_ONLY_OK.some((r) => r.test(path)) && app.ctx.stores.info(auth.shopId)?.status === 'SUSPENDED') {
      return reply.code(423).send({ error: 'This store is suspended: its admin is read-only.' });
    }
  });
}
