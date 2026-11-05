import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { addItems, cartBadRequest, quoteShipping, changeLine, clearCart, createCart, getCartByToken, newCartToken, priceCartDiscounts, updateCart, type CartError, type CartView, type Shop } from '@shopme/core';
import type { AppContext } from '../context';
import { ajaxCart, ajaxLine, changeEntry } from './cart-format';
import { CART_COOKIE, customerOf, primaryShop } from './env';
import { buyerContext, cartCountryOf, syncCartToBuyer } from './market';
import type { SectionRenderer } from './pages';

const JS = 'text/javascript; charset=utf-8';

/** Turn `a[b]=1&a[c]=2&items[0][id]=3` style flat keys into nested objects/arrays. */
export function nestKeys(flat: Record<string, unknown>): Record<string, unknown> {
  const root: Record<string, any> = {};
  for (const [key, value] of Object.entries(flat)) {
    const parts = key.replace(/\]/g, '').split('[');
    let cur = root;
    parts.forEach((p, i) => {
      const k = p === '' ? String(Object.keys(cur).length) : p;
      if (i === parts.length - 1) cur[k] = value;
      else { if (typeof cur[k] !== 'object' || cur[k] === null) cur[k] = {}; cur = cur[k]; }
    });
  }
  const arrayify = (o: any): any => {
    if (!o || typeof o !== 'object' || Array.isArray(o)) return o;
    const keys = Object.keys(o);
    for (const k of keys) o[k] = arrayify(o[k]);
    return keys.length && keys.every((k, i) => k === String(i)) ? keys.map((k) => o[k]) : o;
  };
  return arrayify(root);
}

/** Body as an object whatever the encoding (JSON, urlencoded, multipart); query parameters are merged underneath (GET adds). */
function readParams(req: FastifyRequest): Record<string, any> {
  const body = req.body && typeof req.body === 'object' ? (req.body as Record<string, unknown>) : {};
  const hasBracket = Object.keys(body).some((k) => k.includes('['));
  const isForm = !String(req.headers['content-type'] ?? '').includes('json');
  return { ...nestKeys(req.query as Record<string, unknown>), ...(isForm || hasBracket ? nestKeys(body) : body) };
}

const wantsJson = (req: FastifyRequest) => req.url.split('?')[0]!.endsWith('.js') || req.url.split('?')[0]!.endsWith('.json')
  || req.headers['x-requested-with'] === 'XMLHttpRequest' || /json|javascript/.test(String(req.headers.accept ?? ''));

export function registerCartRoutes(app: FastifyInstance, ctx: AppContext, renderSections: SectionRenderer): void {
  const { db } = ctx;

  const setCookie = (reply: FastifyReply, cart: CartView) => {
    reply.setCookie(CART_COOKIE, cart.token, { path: '/', sameSite: 'lax', httpOnly: false, maxAge: 90 * 24 * 3600, secure: ctx.config.appUrl.startsWith('https://') });
  };

  /** Existing cart from the cookie, or a new persisted one. */
  async function cartFor(req: FastifyRequest, reply: FastifyReply, shop: Shop): Promise<CartView> {
    const raw = req.cookies[CART_COOKIE];
    const existing = raw ? await getCartByToken(db, shop.id, raw.split('?')[0]!.split('%3F')[0]!) : null;
    if (existing) return syncCartToBuyer(ctx, req, shop, existing);
    const m = await buyerContext(ctx, req, shop);
    const country = cartCountryOf(req, m);
    const cart = await createCart(db, shop.id, country ? m.currency : shop.currency, country ? m : null);
    setCookie(reply, cart);
    return cart;
  }

  const fail = (reply: FastifyReply, e: CartError) =>
    reply.code(e.httpStatus).header('cache-control', 'no-cache, no-store').type(e.message === 'Cart Error' ? 'application/json; charset=utf-8' : JS).send(JSON.stringify({ status: e.status, message: e.message, description: e.description }));

  async function withSections(req: FastifyRequest, shop: Shop, cart: CartView, body: Record<string, unknown>, params: Record<string, any>) {
    const raw = params.sections ?? (req.query as Record<string, unknown>).sections;
    const names = (Array.isArray(raw) ? raw.map(String) : String(raw ?? '').split(',')).map((x) => x.trim()).filter(Boolean);
    if (!names.length) return body;
    const url = String(params.sections_url ?? (req.query as Record<string, unknown>).sections_url ?? '/');
    return { ...body, sections: await renderSections(req, shop, url, names, cart) };
  }

  /** The Ajax cart with discounts applied (codes on the cart plus automatic discounts). */
  const priced = async (req: FastifyRequest, shop: Shop, cart: CartView) => ajaxCart(cart, await priceCartDiscounts(db, shop.id, cart, (await customerOf(ctx, req, shop))?.email ?? null));

  const send = (reply: FastifyReply, body: unknown) => reply.header('cache-control', 'no-cache, no-store').type(JS).send(JSON.stringify(body));

  /** Common wrapper: resolve shop, cart (created if needed), run the mutation, answer in the Ajax format or redirect. */
  const mutation = (handler: (c: { req: FastifyRequest; reply: FastifyReply; shop: Shop; cart: CartView; params: Record<string, any> }) => Promise<unknown>, opts: { redirect?: string } = {}) =>
    async (req: FastifyRequest, reply: FastifyReply) => {
      const shop = await primaryShop(ctx);
      if (!shop) return reply.code(503).send({ status: 503, message: 'Store is not set up', description: 'Store is not set up' });
      const cart = await cartFor(req, reply, shop);
      const params = readParams(req);
      const out = await handler({ req, reply, shop, cart, params });
      if (reply.sent) return reply;
      if (!wantsJson(req) && opts.redirect) return reply.redirect(opts.redirect, 302);
      return out;
    };

  // --- GET /cart.js, /cart.json
  const getCart = async (req: FastifyRequest, reply: FastifyReply) => {
    const shop = await primaryShop(ctx);
    if (!shop) return reply.code(503).send({ error: 'Store is not set up' });
    const raw = req.cookies[CART_COOKIE];
    const found = raw ? await getCartByToken(db, shop.id, raw.split('?')[0]!.split('%3F')[0]!) : null;
    const m = await buyerContext(ctx, req, shop);
    const cart = found ? await syncCartToBuyer(ctx, req, shop, found) : { id: 0, token: newCartToken(), note: null, attributes: {}, currency: m.currency, countryCode: null, marketId: m.marketId, shopCurrency: shop.currency, rate: m.rate, discountCodes: [], lines: [] } satisfies CartView;
    return reply.type(req.url.split('?')[0]!.endsWith('.json') ? 'application/json; charset=utf-8' : JS).send(JSON.stringify(await priced(req, shop, cart)));
  };
  app.get('/cart.js', getCart);
  app.get('/cart.json', getCart);

  // --- add
  const add = mutation(async ({ req, reply, shop, cart, params }) => {
    let items: any[];
    let single = false;
    if ('items' in params) {
      if (!Array.isArray(params.items)) return fail(reply, cartBadRequest('must be a collection of items: items'));
      items = params.items.map((i: any) => (i && typeof i === 'object' ? { ...i, sellingPlan: i.selling_plan ?? i.sellingPlan } : i));
    } else if (params.id !== undefined) {
      single = true;
      items = [{ id: params.id, quantity: params.quantity, properties: params.properties, sellingPlan: params.selling_plan }];
    } else return fail(reply, cartBadRequest('Parameter Missing or Invalid', 'Required parameter missing or invalid: items'));
    const r = await addItems(db, shop.id, cart.id, items);
    if (r.error) return fail(reply, r.error);
    const lines = r.added.map((l) => ajaxLine(l, r.cart.currency));
    return send(reply, await withSections(req, shop, r.cart, single ? (lines[0] ?? { items: [] }) : { items: lines }, params));
  }, { redirect: '/cart' });
  app.post('/cart/add.js', add);
  app.post('/cart/add', add);
  app.get('/cart/add.js', add);

  // --- change
  const change = mutation(async ({ req, reply, shop, cart, params }) => {
    const r = await changeLine(db, shop.id, cart.id, params);
    if (r.error) return fail(reply, r.error);
    const cur = r.cart.currency;
    const body = { ...(await priced(req, shop, r.cart)), items_added: r.deltas.filter((d) => d.delta > 0).map((d) => changeEntry(d, cur)), items_removed: r.deltas.filter((d) => d.delta < 0).map((d) => changeEntry(d, cur)) };
    return send(reply, await withSections(req, shop, r.cart, body, params));
  }, { redirect: '/cart' });
  app.post('/cart/change.js', change);
  app.post('/cart/change', change);
  app.get('/cart/change', change);

  // --- update
  const update = mutation(async ({ req, reply, shop, cart, params }) => {
    const r = await updateCart(db, shop.id, cart.id, params);
    if (r.error) return fail(reply, r.error);
    const body = { ...(await priced(req, shop, r.cart)), items_changelog: { added: r.added.map((a) => ({ variant_id: a.variantId, quantity: a.quantity })) } };
    return send(reply, await withSections(req, shop, r.cart, body, params));
  }, { redirect: '/cart' });
  app.post('/cart/update.js', update);
  app.post('/cart/update', update);

  // --- clear
  const clear = mutation(async ({ req, reply, shop, cart }) => {
    const c = await clearCart(db, shop.id, cart.id);
    return send(reply, await priced(req, shop, c));
  }, { redirect: '/cart' });
  app.post('/cart/clear.js', clear);
  app.get('/cart/clear.js', clear);
  app.post('/cart/clear', clear);
  app.get('/cart/clear', clear);

  // --- /discount/<code>: remembers the code (cookie + the current cart) and redirects; `?redirect=/path` picks the landing page
  app.get('/discount/:code', async (req, reply) => {
    const shop = await primaryShop(ctx);
    if (!shop) return reply.callNotFound();
    const code = decodeURIComponent((req.params as { code: string }).code).trim().slice(0, 255);
    const target = String((req.query as Record<string, unknown>).redirect ?? '/');
    const safe = target.startsWith('/') && !target.startsWith('//') ? target : '/';
    if (code) {
      reply.setCookie('discount_code', code, { path: '/', sameSite: 'lax', httpOnly: false, secure: ctx.config.appUrl.startsWith('https://') });
      const cart = await cartFor(req, reply, shop);
      if (!cart.discountCodes.some((c) => c.toUpperCase() === code.toUpperCase())) await updateCart(db, shop.id, cart.id, { discount: [...cart.discountCodes, code].join(',') });
    }
    return reply.header('x-robots-tag', 'noindex, nofollow').redirect(safe, 302);
  });

  // --- shipping rates for the cart and a destination (same selection as checkout): GET or POST /cart/shipping_rates.json?shipping_address[zip]=..&shipping_address[country]=..
  const countryCodeOf = (v: unknown): string | null => {
    const raw = String(v ?? '').trim();
    if (/^[A-Za-z]{2}$/.test(raw)) return raw.toUpperCase();
    const names = new Intl.DisplayNames(['en'], { type: 'region' });
    for (let a = 65; a <= 90; a++) for (let b = 65; b <= 90; b++) { const c = String.fromCharCode(a, b); try { if (names.of(c)?.toLowerCase() === raw.toLowerCase()) return c; } catch { /* not a region */ } }
    return null;
  };
  const shippingRates = async (req: FastifyRequest, reply: FastifyReply) => {
    const shop = await primaryShop(ctx);
    if (!shop) return reply.code(503).send({ error: 'Store is not set up' });
    const raw = req.cookies[CART_COOKIE];
    const cart = raw ? await getCartByToken(db, shop.id, raw.split('?')[0]!.split('%3F')[0]!) : null;
    const addr = (readParams(req).shipping_address ?? {}) as Record<string, unknown>;
    const country = countryCodeOf(addr.country);
    if (!country) return reply.code(422).type('application/json; charset=utf-8').send({ country: ['is not supported'] });
    const options = cart ? await quoteShipping(db, shop.id, { countryCode: country, provinceCode: String(addr.province ?? '').trim() || null, zip: String(addr.zip ?? '').trim() || null },
      cart.lines.map((l) => ({ variantId: l.variantId, quantity: l.quantity, price: l.price, grams: l.grams * l.quantity, requiresShipping: l.requiresShipping }))) : [];
    const digits = new Intl.NumberFormat('en', { style: 'currency', currency: shop.currency }).resolvedOptions().maximumFractionDigits ?? 2;
    return reply.header('cache-control', 'no-cache, no-store').type('application/json; charset=utf-8').send({
      shipping_rates: options.map((o) => ({ name: o.name, presentment_name: o.name, code: o.name, price: (o.price / 10 ** digits).toFixed(digits), currency: shop.currency, source: 'shopify', delivery_date: null })),
    });
  };
  app.get('/cart/shipping_rates.json', shippingRates);
  app.post('/cart/shipping_rates.json', shippingRates);

  // --- permalink: /cart/<variant>:<qty>[,<variant>:<qty>] adds the lines and continues to checkout
  app.get('/cart/:permalink', async (req, reply) => {
    const spec = (req.params as { permalink: string }).permalink;
    if (!/^\d+(:\d+)?(,\d+(:\d+)?)*$/.test(spec)) return reply.callNotFound();
    const shop = await primaryShop(ctx);
    if (!shop) return reply.callNotFound();
    const cart = await cartFor(req, reply, shop);
    const items = spec.split(',').map((p) => { const [id, q] = p.split(':'); return { id, quantity: q ?? 1 }; });
    await addItems(db, shop.id, cart.id, items);
    return reply.redirect('/checkout', 302);
  });

}
