import { createHash } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { and, eq, ne } from 'drizzle-orm';
import { findRedirect, safeEqual, searchArticles, searchPages, searchProducts, suggestQueries, tokenize, schema as s, sha256, type CartView, type Shop } from '@shopme/core';
import { formatMoney } from '@shopme/shopify-compat';
import type { AppContext } from '../context';
import { authenticate } from '../plugins/auth';
import { getCollection, getProductByHandle, listCollections, listProducts, loadProducts } from './data/catalog';
import { getPage, listPages, policiesOf } from './data/content';
import { flashGlobals, takeFlash } from './flash';
import { collectionAtom } from './seo';
import type { ProductObject } from './data/types';
import { buildCollection, buildGlobals, buildSearch, makeEnv, makeResolvers, pageInput, primaryShop, type Env, type Query } from './env';
import type { ThemeStore } from './theme-store';

export type SectionRenderer = (req: FastifyRequest, shop: Shop, url: string, names: string[], cart?: CartView | null) => Promise<Record<string, string>>;

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const first = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);
const PASSWORD_COOKIE = 'storefront_password';

interface PageSpec {
  template: string;
  pageType: string;
  title: string;
  status?: number;
  suffix?: string | null;
  extra?: Record<string, unknown>;
  description?: string;
}

const ASSET_TYPES: Record<string, string> = { css: 'text/css', js: 'text/javascript', mjs: 'text/javascript', json: 'application/json', svg: 'image/svg+xml', txt: 'text/plain' };

function passwordOf(shop: Shop): { enabled: boolean; password: string; message: string } {
  const st = shop.settings as Record<string, unknown>;
  const password = typeof st.storefrontPassword === 'string' ? st.storefrontPassword : '';
  return { enabled: st.storefrontPasswordEnabled === true && password !== '', password, message: String(st.passwordMessage ?? '') };
}

const unlockToken = (ctx: AppContext, password: string) => sha256(`${ctx.config.sessionSecret}:storefront:${password}`);

export function createContent(ctx: AppContext, store: ThemeStore) {
  const { db } = ctx;

  /** Render a template with all request globals; `sections`/`section_id` query params switch to the Section Rendering API. */
  async function renderTemplate(req: FastifyRequest, reply: FastifyReply, env: Env, spec: PageSpec) {
    const loaded = await store.main(env.shop.id);
    const globals = await buildGlobals(env, loaded.themeId, spec.pageType);
    const query0 = req.query as Query;
    const fromQuery: Record<string, unknown> = query0.contact_posted === 'true' || query0.customer_posted === 'true'
      ? { __form_success: { contact: query0.contact_posted === 'true', customer: query0.customer_posted === 'true' } } : {};
    Object.assign(globals, fromQuery, flashGlobals(takeFlash(req, reply)), spec.extra ?? {}, {
      page_title: escapeHtml(spec.title ? `${spec.title}${spec.title === env.shop.name ? '' : ` - ${env.shop.name}`}` : env.shop.name),
      page_description: spec.description ?? String((env.shop.settings as Record<string, unknown>).description ?? ''),
      handle: spec.pageType,
    });
    const query = req.query as Query;
    const suffix = spec.suffix ?? first(query.view) ?? null;
    const input = { ...pageInput(env, spec.template, suffix, globals), resolvers: makeResolvers(env, globals) };

    const sectionsParam = first(query.sections);
    if (sectionsParam !== undefined) {
      const names = sectionsParam.split(',').map((x) => x.trim()).filter(Boolean);
      const out = await loaded.renderer.renderSections(input, names);
      const body: Record<string, string | null> = {};
      for (const n of names) body[n] = out[n] ?? null;
      return reply.code(200).type('application/json; charset=utf-8').send(body);
    }
    const sectionId = first(query.section_id);
    if (sectionId !== undefined) {
      const html = (await loaded.renderer.renderSections(input, [sectionId]))[sectionId];
      return html == null ? reply.code(404).type('text/html; charset=utf-8').send('') : reply.code(200).type('text/html; charset=utf-8').send(html);
    }
    const { html, errors } = await loaded.renderer.renderPage(input);
    for (const e of errors) req.log.warn({ liquid: e }, 'liquid error');
    return reply.code(spec.status ?? 200).header('cache-control', 'no-cache').type('text/html; charset=utf-8').send(html);
  }

  /** 301 for a stored URL redirect (old product, collection, page or blog handles, merchant-defined paths), else the themed 404. */
  async function notFound(req: FastifyRequest, reply: FastifyReply, shop: Shop, env?: Env) {
    if (req.method === 'GET' || req.method === 'HEAD') {
      const [rawPath, qs] = req.url.split('?') as [string, string | undefined];
      let path = rawPath;
      try { path = decodeURIComponent(rawPath); } catch { /* keep raw */ }
      const hit = (await findRedirect(db, shop.id, path)) ?? (path.length > 1 && path.endsWith('/') ? await findRedirect(db, shop.id, path.replace(/\/+$/, '')) : null);
      if (hit) return reply.redirect(hit.target + (qs && !hit.target.includes('?') ? `?${qs}` : ''), 301);
    }
    const e = env ?? (await makeEnv(ctx, req, shop));
    return renderTemplate(req, reply, e, { template: '404', pageType: '404', title: '404 Not Found', status: 404, suffix: null });
  }

  const renderSections: SectionRenderer = async (req, shop, url, names, cart) => {
    const [path, qs] = url.split('?');
    const env = await makeEnv(ctx, req, shop, path || '/');
    if (cart) env.cart = cart;
    env.query = Object.fromEntries(new URLSearchParams(qs ?? ''));
    const loaded = await store.main(shop.id);
    const template = path === '/cart' ? 'cart' : 'index';
    const globals = await buildGlobals(env, loaded.themeId, template);
    const input = { ...pageInput(env, template, null, globals), resolvers: makeResolvers(env, globals) };
    const res = await loaded.renderer.renderSections(input, names);
    return Object.fromEntries(Object.entries(res).filter(([, v]) => v !== null)) as Record<string, string>;
  };

  // ---------------------------------------------------------------------------------------------------------------------
  // JSON helpers
  // ---------------------------------------------------------------------------------------------------------------------
  const cur = (shop: Shop) => shop.currency;
  const dec = (cents: number | null, shop: Shop) => (cents === null ? null : formatMoney(cents, cur(shop)));
  const imageJs = (i: ProductObject['featured_image']) => (i ? { id: i.id, product_id: i.product_id, position: i.position, alt: i.alt, width: i.width, height: i.height, src: i.src } : null);

  function productJs(p: ProductObject) {
    return {
      id: p.id, title: p.title, handle: p.handle, description: p.description, published_at: p.published_at, created_at: p.created_at, vendor: p.vendor, type: p.type, tags: p.tags,
      price: p.price, price_min: p.price_min, price_max: p.price_max, available: p.available, price_varies: p.price_varies, compare_at_price: p.compare_at_price,
      compare_at_price_min: p.compare_at_price_min, compare_at_price_max: p.compare_at_price_max, compare_at_price_varies: p.compare_at_price_varies,
      variants: p.variants.map((v) => ({
        id: v.id, title: v.title, option1: v.option1, option2: v.option2, option3: v.option3, sku: v.sku || null, requires_shipping: v.requires_shipping, taxable: v.taxable, featured_image: imageJs(v.featured_image),
        available: v.available, name: v.name, public_title: v.public_title, options: v.options, price: v.price, weight: v.weight, compare_at_price: v.compare_at_price, inventory_management: v.inventory_management,
        barcode: v.barcode || null, quantity_rule: v.quantity_rule, quantity_price_breaks: [], requires_selling_plan: false, selling_plan_allocations: [],
      })),
      images: p.images.map((i) => i.src), featured_image: p.featured_image?.src ?? null,
      options: p.options_with_values.map((o) => ({ name: o.name, position: o.position, values: o.values })), url: p.url,
      media: p.media.map((m) => ({ id: m.id, position: m.position, media_type: 'image', alt: m.alt, src: m.src, width: m.width, height: m.height, aspect_ratio: m.aspect_ratio, preview_image: m.preview_image })),
      requires_selling_plan: false, selling_plan_groups: [],
    };
  }

  function productListItem(p: ProductObject, shop: Shop) {
    return {
      id: p.id, title: p.title, handle: p.handle, body_html: p.description, published_at: p.published_at, created_at: p.created_at, updated_at: p.updated_at, vendor: p.vendor, product_type: p.type, tags: p.tags,
      variants: p.variants.map((v) => ({
        id: v.id, title: v.title, option1: v.option1, option2: v.option2, option3: v.option3, sku: v.sku || null, requires_shipping: v.requires_shipping, taxable: v.taxable, featured_image: imageJs(v.featured_image),
        available: v.available, price: dec(v.price, shop), grams: v.weight, compare_at_price: dec(v.compare_at_price, shop), position: v.position, product_id: p.id, created_at: v.created_at, updated_at: v.updated_at,
      })),
      images: p.images.map((i) => ({ id: i.id, created_at: p.created_at, position: i.position, updated_at: p.updated_at, product_id: p.id, variant_ids: [], src: i.src, width: i.width, height: i.height })),
      options: p.options_with_values.map((o) => ({ name: o.name, position: o.position, values: o.values })),
    };
  }

  function productJson(p: ProductObject, shop: Shop) {
    return {
      product: {
        id: p.id, title: p.title, body_html: p.description, vendor: p.vendor, product_type: p.type, created_at: p.created_at, handle: p.handle, updated_at: p.updated_at, published_at: p.published_at,
        template_suffix: p.template_suffix || null, published_scope: 'web', tags: p.tags.join(', '),
        variants: p.variants.map((v) => ({
          id: v.id, product_id: p.id, title: v.title, price: dec(v.price, shop), position: v.position, inventory_policy: v.inventory_policy, compare_at_price: dec(v.compare_at_price, shop) ?? '', option1: v.option1, option2: v.option2, option3: v.option3,
          created_at: v.created_at, updated_at: v.updated_at, taxable: v.taxable, barcode: v.barcode || null, fulfillment_service: 'manual', grams: v.weight, inventory_management: v.inventory_management, requires_shipping: v.requires_shipping,
          sku: v.sku || null, weight: v.weight, weight_unit: 'g', inventory_quantity: v.inventory_quantity, old_inventory_quantity: v.inventory_quantity, image_id: v.featured_image?.id ?? null, price_currency: shop.currency,
        })),
        options: p.options_with_values.map((o) => ({ id: p.id * 10 + o.position, product_id: p.id, name: o.name, position: o.position, values: o.values })),
        images: p.images.map((i) => ({ id: i.id, product_id: p.id, position: i.position, alt: i.alt, width: i.width, height: i.height, src: i.src, variant_ids: [], created_at: p.created_at, updated_at: p.updated_at })),
        image: p.images[0] ? { id: p.images[0].id, product_id: p.id, position: 1, alt: p.images[0].alt, width: p.images[0].width, height: p.images[0].height, src: p.images[0].src } : null,
      },
    };
  }

  async function relatedProducts(shop: Shop, source: ProductObject, limit: number): Promise<ProductObject[]> {
    const rows = await db.select({ id: s.products.id, type: s.products.productType, tags: s.products.tags }).from(s.products)
      .where(and(eq(s.products.shopId, shop.id), eq(s.products.status, 'ACTIVE'), ne(s.products.id, source.id)));
    const score = (r: (typeof rows)[number]) => (r.type && r.type === source.type ? 2 : 0) + r.tags.filter((t) => source.tags.includes(t)).length;
    const ids = rows.sort((a, b) => score(b) - score(a) || a.id - b.id).slice(0, limit).map((r) => r.id);
    return loadProducts(db, shop.id, ids);
  }

  const withShop = (fn: (req: FastifyRequest, reply: FastifyReply, shop: Shop) => Promise<unknown>) => async (req: FastifyRequest, reply: FastifyReply) => {
    const shop = await primaryShop(ctx);
    if (!shop) return reply.code(503).type('text/html; charset=utf-8').send('<!doctype html><meta charset="utf-8"><title>ShopMe</title><body style="font-family:system-ui;max-width:36rem;margin:4rem auto"><h1>Store not set up</h1><p><a href="/admin/">Open the admin</a> to finish setup.</p></body>');
    return fn(req, reply, shop);
  };

  // ---------------------------------------------------------------------------------------------------------------------
  // Routes
  // ---------------------------------------------------------------------------------------------------------------------
  function register(app: FastifyInstance) {
    // Password gate: everything except /password, /robots.txt and theme assets redirects to the password page while it is on.
    app.addHook('onRequest', async (req, reply) => {
      const path = req.url.split('?')[0]!;
      if (path === '/password' || path === '/robots.txt' || path.startsWith('/cdn/')) return;
      const shop = await primaryShop(ctx);
      if (!shop) return;
      const pw = passwordOf(shop);
      if (!pw.enabled) return;
      const cookie = req.cookies[PASSWORD_COOKIE];
      if (cookie && safeEqual(cookie, unlockToken(ctx, pw.password))) return;
      if (await authenticate(req)) return; // signed-in staff preview the store
      return reply.redirect('/password', 302);
    });

    app.get('/', withShop(async (req, reply, shop) => renderTemplate(req, reply, await makeEnv(ctx, req, shop), { template: 'index', pageType: 'index', title: shop.name })));

    const collectionsList = withShop(async (req, reply, shop) => renderTemplate(req, reply, await makeEnv(ctx, req, shop), { template: 'list-collections', pageType: 'list-collections', title: 'Collections' }));
    app.get('/collections', collectionsList);
    app.get('/products', collectionsList);

    // --- collections
    app.get('/collections/*', withShop(async (req, reply, shop) => {
      const segs = (req.params as { '*': string })['*'].split('/').filter(Boolean).map(decodeURIComponent);
      const env = await makeEnv(ctx, req, shop);
      const [handleRaw, second, third] = segs;
      if (!handleRaw) return notFound(req, reply, shop, env);
      if (second === 'products' && third && segs.length === 3) return productPage(req, reply, shop, env, third.replace(/\.(js|json|oembed)$/, ''), handleRaw);
      if (second === 'products.json' && segs.length === 2) return productsJson(req, reply, shop, handleRaw);
      if (segs.length === 2 && second === 'products' ) return notFound(req, reply, shop, env);
      if (handleRaw.endsWith('.atom') && segs.length === 1) {
        const xml = await collectionAtom(ctx, shop, handleRaw.slice(0, -5));
        return xml ? reply.type('application/atom+xml; charset=utf-8').send(xml) : notFound(req, reply, shop, env);
      }
      if (segs.length > 2) return notFound(req, reply, shop, env);
      const base = await getCollection(db, shop.id, handleRaw);
      if (!base) return notFound(req, reply, shop, env);
      const tag = second;
      const collection = await buildCollection(env, base, { tag });
      const page = parseInt(first((req.query as Query).page) ?? '1', 10);
      const title = `${collection.title}${page > 1 ? ` - Page ${page}` : ''}`;
      return renderTemplate(req, reply, env, {
        template: 'collection', pageType: 'collection', title, suffix: first((req.query as Query).view) ?? base.templateSuffix, extra: { collection, current_tags: tag ? [tag] : [] },
        description: base.description.replace(/<[^>]*>/g, ''),
      });
    }));

    // --- products
    async function productPage(req: FastifyRequest, reply: FastifyReply, shop: Shop, env: Env, handle: string, collectionHandle?: string) {
      const variantQ = Number(first((req.query as Query).variant));
      const preview = !!first((req.query as Query).preview) && !!(await authenticate(req));
      const product = await getProductByHandle(db, shop.id, handle, { selectedVariantId: Number.isFinite(variantQ) ? variantQ : undefined, includeInactive: preview });
      if (!product) return notFound(req, reply, shop, env);
      const extra: Record<string, unknown> = { product };
      if (collectionHandle) { const b = await getCollection(db, shop.id, collectionHandle); if (b) extra.collection = await buildCollection(env, b, { withFacets: false }); }
      return renderTemplate(req, reply, env, {
        template: 'product', pageType: 'product', title: product.seo.title || product.title, suffix: first((req.query as Query).view) ?? (product.template_suffix || null), extra,
        description: (product.seo.description ?? product.description).replace(/<[^>]*>/g, '').slice(0, 320),
      });
    }
    app.get('/products/*', withShop(async (req, reply, shop) => {
      const raw = decodeURIComponent((req.params as { '*': string })['*']);
      if (raw.includes('/')) return notFound(req, reply, shop);
      const m = /^(.+)\.(js|json|oembed)$/.exec(raw);
      if (m && m[2]) {
        const p = await getProductByHandle(db, shop.id, m[1]!);
        if (!p) return reply.code(404).type(m[2] === 'js' ? 'text/javascript; charset=utf-8' : 'application/json; charset=utf-8').send('');
        if (m[2] === 'js') return reply.type('text/javascript; charset=utf-8').send(JSON.stringify(productJs(p)));
        if (m[2] === 'json') return reply.type('application/json; charset=utf-8').send(productJson(p, shop));
        return reply.type('application/json; charset=utf-8').send({ version: '1.0', type: 'link', title: p.title, provider_name: shop.name, provider_url: ctx.config.appUrl, thumbnail_url: p.featured_image?.src ?? null });
      }
      return productPage(req, reply, shop, await makeEnv(ctx, req, shop), raw);
    }));
    app.get('/products.json', withShop((req, reply, shop) => productsJson(req, reply, shop, 'all')));

    async function productsJson(req: FastifyRequest, reply: FastifyReply, shop: Shop, collectionHandle: string) {
      const q = req.query as Query;
      const limit = Math.min(250, Math.max(1, parseInt(first(q.limit) ?? '30', 10) || 30));
      const page = Math.max(1, parseInt(first(q.page) ?? '1', 10) || 1);
      const base = await getCollection(db, shop.id, collectionHandle);
      if (!base) return reply.code(404).type('application/json; charset=utf-8').send('');
      const listing = await listProducts(db, shop.id, { collectionId: base.isAll ? undefined : base.id }, { sort: 'manual' }, false);
      const products = await loadProducts(db, shop.id, listing.ids.slice((page - 1) * limit, page * limit));
      return reply.type('application/json; charset=utf-8').send({ products: products.map((p) => productListItem(p, shop)) });
    }

    app.get('/collections.json', withShop(async (_req, reply, shop) => {
      const cols = await listCollections(db, shop.id);
      return reply.type('application/json; charset=utf-8').send({ collections: cols.map((c) => ({ id: c.id, title: c.title, handle: c.handle, description: c.description || null, published_at: c.publishedAt?.toISOString() ?? null, updated_at: null, image: c.image ? { src: c.image.src, alt: c.image.alt, width: c.image.width, height: c.image.height } : null, products_count: c.productsCount })) });
    }));

    // --- cart page, search, pages, policies
    app.get('/cart', withShop(async (req, reply, shop) => renderTemplate(req, reply, await makeEnv(ctx, req, shop), { template: 'cart', pageType: 'cart', title: 'Cart', suffix: null })));

    const searchPage = withShop(async (req, reply, shop) => {
      const env = await makeEnv(ctx, req, shop);
      const q = (first((req.query as Query).q) ?? '').trim();
      const search = await buildSearch(env, q);
      return renderTemplate(req, reply, env, { template: 'search', pageType: 'search', title: q ? `Search: ${search.results_count} results found for "${q}"` : 'Search', extra: { search } });
    });
    app.get('/search', searchPage);
    app.get('/search.json', searchPage);

    app.get('/search/suggest.json', withShop(async (req, reply, shop) => reply.type('application/json; charset=utf-8').send(await suggest(req, shop))));
    app.get('/search/suggest', withShop(async (req, reply, shop) => {
      const sectionId = first((req.query as Query).section_id);
      if (!sectionId) return reply.type('application/json; charset=utf-8').send(await suggest(req, shop));
      const env = await makeEnv(ctx, req, shop);
      const results = await suggest(req, shop);
      return renderTemplate(req, reply, env, { template: 'search', pageType: 'search', title: 'Search', extra: { predictive_search: { performed: !!first((req.query as Query).q), terms: first((req.query as Query).q) ?? '', resources: results.resources } } });
    }));

    async function suggest(req: FastifyRequest, shop: Shop) {
      const q = req.query as Query;
      const term = (first(q.q) ?? '').trim();
      const types = (first(q['resources[type]']) ?? 'product').split(',').map((x) => x.trim());
      const limit = Math.min(10, Math.max(1, parseInt(first(q['resources[limit]']) ?? '10', 10) || 10));
      const prefix = first(q['resources[options][prefix]']) === 'none' ? 'none' : 'last';
      const results: Record<string, unknown[]> = {};
      if (types.includes('product')) {
        const ids = term ? (await searchProducts(db, shop.id, term, { prefix, limit })).ids : [];
        results.products = (await loadProducts(db, shop.id, ids)).map((p, i) => ({
          available: p.available, body: p.description.replace(/<[^>]*>/g, ' ').trim().slice(0, 200), compare_at_price_max: dec(p.compare_at_price_max, shop), compare_at_price_min: dec(p.compare_at_price_min, shop), handle: p.handle, id: p.id,
          image: p.featured_image?.src ?? null, price: dec(p.price, shop), price_max: dec(p.price_max, shop), price_min: dec(p.price_min, shop), tags: p.tags, title: p.title, type: p.type,
          url: `${p.url}?_pos=${i + 1}&_psq=${encodeURIComponent(term)}&_psid=${p.id}`, variants: [], vendor: p.vendor,
          featured_image: p.featured_image ? { alt: p.featured_image.alt, aspect_ratio: p.featured_image.aspect_ratio, height: p.featured_image.height, url: p.featured_image.src, width: p.featured_image.width } : null,
        }));
      }
      if (types.includes('collection')) {
        const tokens = tokenize(term);
        results.collections = tokens.length ? (await listCollections(db, shop.id)).filter((c) => tokens.every((t) => c.title.toLowerCase().includes(t))).slice(0, limit).map((c) => ({ id: c.id, handle: c.handle, title: c.title, url: `/collections/${c.handle}`, body: c.description.replace(/<[^>]*>/g, ' ').trim().slice(0, 200), image: c.image?.src ?? null })) : [];
      }
      if (types.includes('page')) results.pages = (await searchPages(db, shop.id, term, limit)).map((p) => ({ id: p.id, handle: p.handle, title: p.title, url: `/pages/${p.handle}`, body: p.bodyHtml.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200), author: '', published_at: p.publishedAt?.toISOString() ?? null, tags: [], updated_at: p.updatedAt.toISOString() }));
      if (types.includes('article')) results.articles = (await searchArticles(db, shop.id, term, limit)).map(({ a, blogHandle }) => ({ id: a.id, handle: a.handle, title: a.title, author: a.author ?? '', url: `/blogs/${blogHandle}/${a.handle}`, body: a.bodyHtml.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200), published_at: a.publishedAt?.toISOString() ?? null, tags: a.tags, image: null }));
      if (types.includes('query')) {
        results.queries = (await suggestQueries(db, shop.id, term, limit)).map((text) => {
          const lead = tokenize(term).join(' ');
          return { text, styled_text: text.startsWith(lead) ? `${escapeHtml(lead)}<mark>${escapeHtml(text.slice(lead.length))}</mark>` : escapeHtml(text), url: `/search?q=${encodeURIComponent(text)}&_pos=1&_psq=${encodeURIComponent(term)}&_ss=e&_v=1.0` };
        });
      }
      return { resources: { results } };
    }

    const recommendations = withShop(async (req, reply, shop) => {
      const q = req.query as Query;
      const id = Number(first(q.product_id));
      const limit = Math.min(10, Math.max(1, parseInt(first(q.limit) ?? '10', 10) || 10));
      const [src] = Number.isFinite(id) ? await loadProducts(db, shop.id, [id]) : [];
      if (!src) return reply.code(404).type('application/json; charset=utf-8').send({ status: 404, message: 'Product not found' });
      const intent = first(q.intent) ?? 'related';
      const related = await relatedProducts(shop, src, limit);
      const sectionId = first(q.section_id);
      if (sectionId && !req.url.split('?')[0]!.endsWith('.json')) {
        const env = await makeEnv(ctx, req, shop);
        return renderTemplate(req, reply, env, { template: 'product', pageType: 'product', title: src.title, extra: { product: src, recommendations: { performed: true, products: related, products_count: related.length, intent } } });
      }
      return reply.type('application/json; charset=utf-8').send({ products: related.map((p) => ({ ...productJs(p), url: `${p.url}?pr_prod_strat=collect` })), intent });
    });
    app.get('/recommendations/products.json', recommendations);
    app.get('/recommendations/products', recommendations);

    app.get('/pages/*', withShop(async (req, reply, shop) => {
      const handle = decodeURIComponent((req.params as { '*': string })['*']);
      const env = await makeEnv(ctx, req, shop);
      const page = handle.includes('/') ? null : await getPage(db, shop.id, handle);
      if (!page) return notFound(req, reply, shop, env);
      const loaded = await store.main(shop.id);
      const suffix = first((req.query as Query).view) ?? (page.template_suffix || (handle === 'contact' && loaded.theme.has('templates/page.contact.json') ? 'contact' : null));
      return renderTemplate(req, reply, env, { template: 'page', pageType: 'page', title: page.title, suffix, extra: { page } });
    }));

    app.get('/policies/*', withShop(async (req, reply, shop) => {
      const handle = decodeURIComponent((req.params as { '*': string })['*']);
      const env = await makeEnv(ctx, req, shop);
      const policy = policiesOf(shop.settings as Record<string, unknown>).find((p) => p.handle === handle);
      if (!policy) return notFound(req, reply, shop, env);
      return renderTemplate(req, reply, env, { template: 'page', pageType: 'policy', title: policy.title, extra: { page: { id: 0, handle, title: policy.title, content: policy.body, url: policy.url, author: '', template_suffix: '', published_at: null }, policy } });
    }));

    // --- password page
    const passwordPage = (errors?: string[]) => withShop(async (req, reply, shop) => {
      const pw = passwordOf(shop);
      if (!pw.enabled) return reply.redirect('/', 302);
      const env = await makeEnv(ctx, req, shop);
      return renderTemplate(req, reply, env, { template: 'password', pageType: 'password', title: shop.name, extra: { __form_errors: { storefront_password: errors ?? null }, password_error: !!errors } });
    });
    app.get('/password', passwordPage());
    app.post('/password', withShop(async (req, reply, shop) => {
      const pw = passwordOf(shop);
      const given = String(((req.body ?? {}) as Record<string, unknown>).password ?? '');
      if (pw.enabled && safeEqual(sha256(given), sha256(pw.password))) {
        reply.setCookie(PASSWORD_COOKIE, unlockToken(ctx, pw.password), { path: '/', httpOnly: true, sameSite: 'lax', maxAge: 30 * 24 * 3600 });
        return reply.redirect('/', 302);
      }
      return (passwordPage(['Wrong password']) as (r: FastifyRequest, p: FastifyReply) => Promise<unknown>)(req, reply);
    }));

    // --- theme assets
    app.get('/cdn/shop/t/:themeId/assets/*', async (req, reply) => {
      const { themeId, '*': name } = req.params as { themeId: string; '*': string };
      if (name.includes('..')) return reply.code(404).send('');
      const [row] = await db.select({ body: s.themeFiles.body, storageKey: s.themeFiles.storageKey, type: s.themeFiles.contentType, checksum: s.themeFiles.checksum }).from(s.themeFiles).where(and(eq(s.themeFiles.themeId, Number(themeId) || 0), eq(s.themeFiles.path, `assets/${name}`))).limit(1);
      if (!row || (row.body === null && !row.storageKey)) return reply.code(404).send('');
      const ext = name.split('.').pop()?.toLowerCase() ?? '';
      const versioned = 'v' in (req.query as object);
      // Text files live in the database; binaries (images, fonts) in object storage.
      const payload = row.body ?? (await app.ctx.storage.open(row.storageKey!));
      if (payload === null) return reply.code(404).send('');
      return reply.header('cache-control', versioned ? 'public, max-age=31536000, immutable' : 'public, max-age=300').header('etag', `"${createHash('md5').update(row.checksum).digest('hex')}"`).type(ASSET_TYPES[ext] ?? row.type).send(payload);
    });

    // --- anything else: themed 404 for browsers
    app.get('/*', withShop(async (req, reply, shop) => notFound(req, reply, shop)));
  }

  return { register, renderSections, renderTemplate, notFound, withShop };
}
