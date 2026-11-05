import type { FastifyReply, FastifyRequest } from 'fastify';
import { getCartByToken, isCountryCode, isIdentity, resolveMarketContext, setCartContext, type CartView, type MarketContext, type Shop } from '@shopme/core';
import type { AppContext } from '../context';

/** Cookie holding the buyer's chosen country (ISO code). Set by `?country=XX` and by `POST /localization`. */
export const COUNTRY_COOKIE = 'shopme_country';
const YEAR = 365 * 24 * 3600;

const pending = new WeakMap<FastifyRequest, string>();
const contexts = new WeakMap<FastifyRequest, Promise<MarketContext>>();

const asCountry = (v: unknown): string | null => {
  const code = typeof v === 'string' ? v.trim().toUpperCase() : '';
  return isCountryCode(code) ? code : null;
};

export function setCountryCookie(ctx: AppContext, reply: FastifyReply, code: string): void {
  reply.setCookie(COUNTRY_COOKIE, code, { path: '/', maxAge: YEAR, sameSite: 'lax', httpOnly: false, secure: ctx.config.appUrl.startsWith('https://') });
}

/** `?country=XX` on any storefront request switches the buyer's country (cookie for a year), like the selector form does. */
export function registerCountryParam(app: { addHook: (name: 'onRequest', fn: (req: FastifyRequest, reply: FastifyReply) => Promise<void>) => void }, ctx: AppContext): void {
  app.addHook('onRequest', async (req, reply) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return;
    const q = req.url.indexOf('?') >= 0 ? new URLSearchParams(req.url.slice(req.url.indexOf('?') + 1)).get('country') : null;
    const code = asCountry(q);
    if (code) { pending.set(req, code); setCountryCookie(ctx, reply, code); }
  });
}

/** The country this request is for: `?country=`, else the cookie, else null (the shop default). */
export function requestCountry(req: FastifyRequest): string | null {
  return pending.get(req) ?? asCountry(req.cookies?.[COUNTRY_COOKIE]);
}

/** The buyer's market context for this request (resolved once per request). */
export function buyerContext(ctx: AppContext, req: FastifyRequest, shop: Shop): Promise<MarketContext> {
  let p = contexts.get(req);
  if (!p) { p = resolveMarketContext(ctx.db, shop, requestCountry(req)); contexts.set(req, p); }
  return p;
}

/** Country to store on a cart: only when the buyer chose one or the market differs from the plain shop pricing. */
export const cartCountryOf = (req: FastifyRequest, m: MarketContext): string | null => (requestCountry(req) || !isIdentity(m) ? m.countryCode : null);

/** Make a cart follow the buyer's current market: country, market and currency are updated, so prices change on the next load. */
export async function syncCartToBuyer(ctx: AppContext, req: FastifyRequest, shop: Shop, cart: CartView): Promise<CartView> {
  if (!cart.id) return cart;
  const m = await buyerContext(ctx, req, shop);
  const want = cartCountryOf(req, m);
  if ((cart.countryCode ?? null) === want && (want === null || cart.currency === m.currency)) return cart;
  await setCartContext(ctx.db, shop.id, cart.id, want ? m : null, shop.currency);
  return (await getCartByToken(ctx.db, shop.id, cart.token)) ?? cart;
}

/** `window.Shopify` compatibility globals (active currency and its rate, country, locale) put in the page head for themes and apps that read them. */
export function injectShopifyGlobals(html: string, market: MarketContext, locale: string): string {
  const data = { currency: { active: market.currency, rate: String(market.rate) }, country: market.countryCode, locale };
  const script = `<script>window.Shopify=window.Shopify||{};Object.assign(window.Shopify,${JSON.stringify(data).replace(/</g, '\\u003c')});</script>`;
  return html.includes('</head>') ? html.replace('</head>', `${script}</head>`) : html;
}
