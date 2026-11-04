import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { resolveApiToken, resolveSession } from '@shopme/core';
import type { AuthInfo } from '../context';

export const SESSION_COOKIE = 'shopme_session';
export const TOKEN_HEADER = 'x-shopify-access-token';
const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** Resolve the caller from an access-token header or the signed session cookie. Cached per request. */
export async function authenticate(req: FastifyRequest): Promise<AuthInfo | null> {
  if (req.auth) return req.auth;
  const { db } = req.server.ctx;
  const header = req.headers[TOKEN_HEADER];
  if (typeof header === 'string' && header) {
    const t = await resolveApiToken(db, header);
    if (!t) return null;
    return (req.auth = { kind: 'token', shopId: t.shopId, tokenId: t.id, scopes: t.scopes });
  }
  const raw = req.cookies[SESSION_COOKIE];
  if (raw) {
    const un = req.unsignCookie(raw);
    if (un.valid && un.value) {
      const user = await resolveSession(db, un.value);
      if (user) return (req.auth = { kind: 'session', shopId: user.shopId, user, scopes: ['*'] });
    }
  }
  return null;
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
      if (req.headers['sec-fetch-site'] === 'cross-site') return reply.code(403).send({ error: 'Cross-site request blocked' });
      return;
    }
    let host: string;
    try { host = new URL(origin).host; } catch { return reply.code(403).send({ error: 'Bad Origin' }); }
    const { config } = app.ctx;
    const allowed = host === req.headers.host || host === new URL(config.appUrl).host || config.trustedOrigins.some((o) => o === origin);
    if (!allowed) return reply.code(403).send({ error: 'Cross-origin request blocked' });
  });
}
