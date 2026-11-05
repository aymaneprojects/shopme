import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context';
import { normalizeLocale } from '@shopme/core';
import { primaryShop } from './env';

/** Paths that never carry a locale prefix (assets, uploads, admin, checkout, the switch itself). */
const UNPREFIXED = /^\/(cdn|files|admin|checkouts?|checkout-assets|localization|csp-report)(?=[/?#]|$)/;

/**
 * Add the locale prefix to root-relative `href` and `action` URLs of rendered HTML (`/products/x` -> `/fr/products/x`), so any theme
 * links stay inside the language the visitor chose. The prefix is stripped again before routing (see LocaleCache).
 */
export function localizeHtml(html: string, prefix: string): string {
  if (!prefix) return html;
  return html.replace(/(\s(?:href|action)=)(["'])(\/(?!\/)[^"']*)\2/gi, (m, attr: string, q: string, url: string) => {
    if (UNPREFIXED.test(url) || url === prefix || url.startsWith(`${prefix}/`) || url.startsWith(`${prefix}?`)) return m;
    const rest = url === '/' ? '' : url.startsWith('/?') ? url.slice(1) : url;
    return `${attr}${q}${prefix}${rest}${q}`;
  });
}

/** `POST /localization` (Shopify's language switch): `language_code`, optional `return_to`; redirects to the same page in that language. */
export function registerLocalizationRoutes(scope: FastifyInstance, ctx: AppContext): void {
  scope.post('/localization', async (req, reply) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const shop = await primaryShop(ctx);
    const code = typeof body.language_code === 'string' ? normalizeLocale(body.language_code) : null;
    const wanted = shop && code ? ctx.locales.locales.find((l) => l.locale === code) : undefined;
    let back = typeof body.return_to === 'string' ? body.return_to : '/';
    if (!back.startsWith('/') || back.startsWith('//') || back.includes('\\')) back = '/';
    if (!wanted) return reply.redirect(back, 302);
    // Drop a prefix the page already had, then add the new one.
    const m = /^\/([A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})?)(?=[/?#]|$)/.exec(back);
    if (m && ctx.locales.locales.some((l) => l.locale.toLowerCase() === m[1]!.toLowerCase() && !l.primary)) back = back.slice(m[0].length) || '/';
    if (back.startsWith('?')) back = `/${back}`;
    reply.setCookie('localization', wanted.locale, { path: '/', maxAge: 365 * 24 * 3600, sameSite: 'lax' });
    const prefix = ctx.locales.prefixOf(wanted.locale);
    return reply.redirect(back === '/' ? prefix || '/' : prefix + (back.startsWith('/?') ? back.slice(1) : back), 302);
  });
}
