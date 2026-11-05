import type { FastifyInstance, FastifyRequest } from 'fastify';
import { randomToken, recordVisit, VISIT_SESSION_MS } from '@shopme/core';
import type { AppContext } from '../context';
import { primaryShop } from './env';
import { analyticsAllowed } from './privacy';

export const VISIT_COOKIE = 'shopme_vid';
const BOT = /bot|crawl|spider|slurp|preview|monitor|uptime|curl|wget|python|headless|lighthouse|facebookexternalhit/i;

const ids = new WeakMap<FastifyRequest, string>();

/**
 * First-party visit tracking for the analytics "Sessions" and conversion numbers: every successful storefront HTML page view is stored
 * with an anonymous 30-minute session id from the `shopme_vid` cookie (httpOnly, never shared). No IP address, user agent or
 * personal data is stored and nothing leaves the server.
 */
export function registerVisitTracking(scope: FastifyInstance, ctx: AppContext): void {
  scope.addHook('onRequest', async (req, reply) => {
    if (req.method !== 'GET' || BOT.test(req.headers['user-agent'] ?? 'bot') || req.headers.purpose === 'prefetch') return;
    const path = req.url.split('?')[0]!;
    if (path === '/password' || path.startsWith('/cdn/') || path.startsWith('/.shopme/') || /[?&](sections|section_id)=/.test(req.url)) return;
    const shop = await primaryShop(ctx);
    // Consent: counted only where analytics may run (no consent needed in the visitor's region, or given). Do-Not-Track and GPC are always honoured.
    if (!shop || req.headers.dnt === '1' || req.headers['sec-gpc'] === '1' || !(await analyticsAllowed(ctx, req, shop))) return;
    const given = req.cookies[VISIT_COOKIE];
    const id = given && /^[A-Za-z0-9_-]{16,64}$/.test(given) ? given : randomToken(16);
    reply.setCookie(VISIT_COOKIE, id, { path: '/', httpOnly: true, sameSite: 'lax', maxAge: VISIT_SESSION_MS / 1000 });
    ids.set(req, id);
  });
  scope.addHook('onResponse', async (req, reply) => {
    const id = ids.get(req);
    if (!id || reply.statusCode !== 200 || !String(reply.getHeader('content-type') ?? '').includes('text/html')) return;
    const shop = await primaryShop(ctx);
    if (!shop) return;
    let referrer: string | null = null;
    try { const u = new URL(String(req.headers.referer ?? '')); if (u.host !== req.headers.host) referrer = u.host; } catch { /* none */ }
    const q = new URL(req.url, 'http://x').searchParams;
    await recordVisit(ctx.db, shop.id, { sessionId: id, path: req.url.split('?')[0]!, referrer, utmSource: q.get('utm_source'), utmMedium: q.get('utm_medium'), utmCampaign: q.get('utm_campaign') }).catch((err) => req.log.warn({ err }, 'visit not recorded'));
  });
}
