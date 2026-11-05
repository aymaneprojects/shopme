import { createHash } from 'node:crypto';
import type { FastifyInstance, FastifyReply } from 'fastify';

/** Strict policy for the admin SPA: only own scripts, no framing, no plugins. Inline styles are needed by the UI kit. */
export const ADMIN_CSP = [
  "default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline'", "img-src 'self' data: blob: https:", "font-src 'self' data:",
  "connect-src 'self'", "frame-src 'self' https://www.youtube.com https://www.youtube-nocookie.com https://player.vimeo.com", "media-src 'self' https:", "object-src 'none'", "base-uri 'self'", "form-action 'self'", "frame-ancestors 'none'",
].join('; ');

/** Report-only policy for themes (merchants add arbitrary scripts, so it only reports): same-origin framing is enforced separately. */
export const STOREFRONT_CSP_REPORT_ONLY = [
  "default-src 'self' https: data: blob:", "script-src 'self' 'unsafe-inline' 'unsafe-eval' https:", "style-src 'self' 'unsafe-inline' https:", "img-src 'self' data: blob: https:",
  "font-src 'self' data: https:", "connect-src 'self' https:", "object-src 'none'", "base-uri 'self'", "report-uri /csp-report",
].join('; ');

const MAX_AGE = 31536000;
const set = (reply: FastifyReply, name: string, value: string) => { if (!reply.hasHeader(name)) reply.header(name, value); };

/**
 * Security headers on every response, and ETag / 304 for text responses.
 * Admin (`/admin*`): strict CSP + `X-Frame-Options: DENY`. Storefront: `X-Frame-Options: SAMEORIGIN`, enforced `frame-ancestors 'self'`,
 * CSP in report-only mode (reports go to `POST /csp-report`, logged). `/files/*` keeps its own sandboxing CSP.
 * HSTS only with `HSTS=true` and an https APP_URL.
 */
export function registerSecurity(app: FastifyInstance): void {
  const hsts = app.ctx.config.hsts && app.ctx.config.appUrl.startsWith('https://');
  app.addContentTypeParser('application/csp-report', { parseAs: 'string' }, (_r, body, done) => { try { done(null, JSON.parse(body as string)); } catch { done(null, {}); } });
  app.post('/csp-report', async (req, reply) => {
    req.log.warn({ csp: req.body }, 'csp violation (report-only)');
    return reply.code(204).send();
  });

  app.addHook('onSend', async (req, reply, payload) => {
    const path = req.url.split('?')[0]!;
    set(reply, 'x-content-type-options', 'nosniff');
    set(reply, 'referrer-policy', 'strict-origin-when-cross-origin');
    if (hsts) set(reply, 'strict-transport-security', `max-age=${MAX_AGE}; includeSubDomains`);
    if (path === '/admin' || path.startsWith('/admin/')) {
      reply.header('x-frame-options', 'DENY');
      set(reply, 'content-security-policy', ADMIN_CSP);
      set(reply, 'permissions-policy', 'camera=(), microphone=(), geolocation=()');
    } else if (!path.startsWith('/files/')) {
      reply.header('x-frame-options', 'SAMEORIGIN');
      set(reply, 'content-security-policy', "frame-ancestors 'self'");
      set(reply, 'content-security-policy-report-only', STOREFRONT_CSP_REPORT_ONLY);
    }
    return conditional(req.method, req.headers['if-none-match'], reply, payload);
  });
}

const TEXTUAL = /^(text\/|application\/(json|javascript|xml)|image\/svg)/;

/** Add a weak ETag to cacheable text responses and answer `If-None-Match` with 304. */
function conditional(method: string, inm: string | string[] | undefined, reply: FastifyReply, payload: unknown): unknown {
  if ((method !== 'GET' && method !== 'HEAD') || reply.statusCode !== 200 || (typeof payload !== 'string' && !Buffer.isBuffer(payload))) return payload;
  const cc = String(reply.getHeader('cache-control') ?? '');
  if (/no-store|private/.test(cc) || !TEXTUAL.test(String(reply.getHeader('content-type') ?? ''))) return payload;
  let etag = reply.getHeader('etag') as string | undefined;
  if (!etag) {
    etag = `W/"${createHash('sha1').update(payload).digest('base64url').slice(0, 27)}"`;
    reply.header('etag', etag);
  }
  if (!cc) reply.header('cache-control', 'no-cache');
  const sent = (Array.isArray(inm) ? inm.join(',') : inm ?? '').split(',').map((t) => t.trim().replace(/^W\//, ''));
  if (sent.includes('*') || sent.includes(etag.replace(/^W\//, ''))) {
    reply.code(304).removeHeader('content-length').removeHeader('content-type');
    return '';
  }
  return payload;
}
