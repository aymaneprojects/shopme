import { lazyList, type PageInput, type ResourceResolvers } from '@shopme/liquid-compat';
import { getPrimaryShop, getCartByToken, loadTranslator, NO_TRANSLATOR, searchArticles, searchPages, priceCartDiscounts, resolveCustomerSession, type CartView, type Customer, type Db, type Shop, type Translator } from '@shopme/core';
import type { FastifyRequest } from 'fastify';
import type { AppContext } from '../context';
import { getCollection, getProductByHandle, listCollections, listProducts, loadProducts, SORT_KEYS, defaultSort, type CollectionBase, type FilterGroup, type SortKey } from './data/catalog';
import { countryOptions } from '../checkout/geo';
import { buildBlog, getBlog, getPublishedArticle, listBlogHandles } from './data/blogs';
import { getPage, listMenus, listPages, type LinklistObject } from './data/content';
import { loadMetafields } from './data/metafields';
import { buildCustomer } from './data/customer';
import type { ProductObject } from './data/types';
import { lazyMap, liquidCart, localizationObject, requestObject, routesObject, shopObject } from './objects';

export const CART_COOKIE = 'cart';
export const CUSTOMER_COOKIE = 'shopme_customer';

/** The signed-in storefront customer of a request (signed session cookie), or null. */
export async function customerOf(ctx: AppContext, req: FastifyRequest, shop: Shop): Promise<Customer | null> {
  const raw = req.cookies[CUSTOMER_COOKIE];
  const un = raw ? req.unsignCookie(raw) : null;
  return un?.valid && un.value ? resolveCustomerSession(ctx.db, shop.id, un.value) : null;
}

export type Query = Record<string, string | string[] | undefined>;

/** Everything one storefront request needs. */
export interface Env {
  ctx: AppContext;
  db: Db;
  shop: Shop;
  origin: string;
  path: string;
  query: Query;
  cart: CartView | null;
  customer: Customer | null;
  /** Storefront language of this request (`shop.locale` unless the URL carries a published locale prefix). */
  locale: string;
  /** URL prefix of that language (`''` for the primary one, else `/fr`). */
  prefix: string;
  /** Translations of content into `locale` (inactive for the primary language). */
  tr: Translator;
}

export async function makeEnv(ctx: AppContext, req: FastifyRequest, shop: Shop, path?: string): Promise<Env> {
  const token = req.cookies[CART_COOKIE];
  const cart = token ? await getCartByToken(ctx.db, shop.id, token.split('?')[0]!.split('%3F')[0]!) : null;
  const locale = ctx.locales.localeOf(req.raw) ?? shop.locale;
  const tr = locale === shop.locale ? NO_TRANSLATOR : await loadTranslator(ctx.db, shop.id, locale);
  return { ctx, db: ctx.db, shop, origin: ctx.config.appUrl, path: path ?? req.url.split('?')[0]!, query: req.query as Query, cart, customer: await customerOf(ctx, req, shop), locale, prefix: locale === shop.locale ? '' : ctx.locales.prefixOf(locale), tr };
}

export async function primaryShop(ctx: AppContext): Promise<Shop | null> { return getPrimaryShop(ctx.db); }

const first = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);

/** `filter.<scope>.<key>=value` query params -> `{ '<scope>.<key>': [values] }`. */
export function parseFilters(query: Query): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(query)) {
    if (!k.startsWith('filter.') || v === undefined || v === '') continue;
    out[k.slice('filter.'.length)] = (Array.isArray(v) ? v : [v]).filter((x) => x !== '');
  }
  return out;
}

export const sortOptions = [
  { name: 'Featured', value: 'manual' }, { name: 'Best selling', value: 'best-selling' }, { name: 'Alphabetically, A-Z', value: 'title-ascending' }, { name: 'Alphabetically, Z-A', value: 'title-descending' },
  { name: 'Price, low to high', value: 'price-ascending' }, { name: 'Price, high to low', value: 'price-descending' }, { name: 'Date, old to new', value: 'created-ascending' }, { name: 'Date, new to old', value: 'created-descending' },
];

function sortFrom(query: Query, fallback: SortKey): SortKey {
  const s = first(query.sort_by) === 'relevance' ? 'manual' : first(query.sort_by);
  return s && (SORT_KEYS as readonly string[]).includes(s) ? (s as SortKey) : fallback;
}

/** Decorate filter groups with links that add/remove them from the current URL. */
function withFilterUrls(groups: FilterGroup[], env: Env): FilterGroup[] {
  const url = (mutate: (q: URLSearchParams) => void) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(env.query)) { if (k === 'page' || v === undefined) continue; for (const x of Array.isArray(v) ? v : [v]) q.append(k, x); }
    mutate(q);
    const s = q.toString();
    return env.path + (s ? `?${s}` : '');
  };
  return groups.map((g) => ({
    ...g,
    url_to_remove: url((q) => { q.delete(g.param_name); q.delete(`${g.param_name}.gte`); q.delete(`${g.param_name}.lte`); }),
    values: g.values?.map((v) => ({ ...v, url_to_add: url((q) => q.append(v.param_name, v.value)), url_to_remove: url((q) => { const keep = q.getAll(v.param_name).filter((x) => x.toLowerCase() !== v.value.toLowerCase()); q.delete(v.param_name); keep.forEach((x) => q.append(v.param_name, x)); }) })),
  }));
}

/** Product with its translated title, description, type and SEO fields (a copy; the primary language returns it unchanged). */
export function trProduct<T extends ProductObject | null>(env: Env, p: T): T {
  if (!p || !env.tr.active) return p;
  const t = env.tr;
  const description = t.text('PRODUCT', p.id, 'body_html', p.description);
  const type = t.text('PRODUCT', p.id, 'product_type', p.type);
  return {
    ...p, title: t.text('PRODUCT', p.id, 'title', p.title), description, content: description, type, product_type: type,
    seo: { title: t.get('PRODUCT', p.id, 'meta_title') ?? p.seo.title, description: t.get('PRODUCT', p.id, 'meta_description') ?? p.seo.description },
  };
}

/** Collection base with translated title, description and SEO fields. */
export function trCollection(env: Env, c: CollectionBase): CollectionBase {
  if (!env.tr.active || c.isAll) return c;
  const t = env.tr;
  return { ...c, title: t.text('COLLECTION', c.id, 'title', c.title), description: t.text('COLLECTION', c.id, 'body_html', c.description), seoTitle: t.get('COLLECTION', c.id, 'meta_title') ?? c.seoTitle, seoDescription: t.get('COLLECTION', c.id, 'meta_description') ?? c.seoDescription };
}

export function trPage<T extends { id: number; title: string; content: string } | null>(env: Env, p: T): T {
  if (!p || !env.tr.active) return p;
  return { ...p, title: env.tr.text('PAGE', p.id, 'title', p.title), content: env.tr.text('PAGE', p.id, 'body_html', p.content) };
}

/** Preview size of `collection.products` outside `paginate` (the full list is reachable through `paginate`). */
const PREVIEW = 50;

async function productList(env: Env, db: Db, shopId: number, ids: number[], total: number): Promise<ProductObject[]> {
  const memo = new Map<number, ProductObject>();
  const load = async (offset: number, limit: number) => {
    const wanted = ids.slice(offset, offset + limit);
    const missing = wanted.filter((id) => !memo.has(id));
    if (missing.length) for (const p of await loadProducts(db, shopId, missing)) memo.set(p.id, trProduct(env, p));
    return wanted.map((id) => memo.get(id)).filter((p): p is ProductObject => !!p);
  };
  return lazyList(await load(0, PREVIEW), total, load) as ProductObject[];
}

export async function buildCollection(env: Env, base0: CollectionBase, opts: { tag?: string; withFacets?: boolean } = {}) {
  const { db, shop } = env;
  const base = trCollection(env, base0);
  const sort = sortFrom(env.query, defaultSort(base.sortOrder));
  const listing = await listProducts(db, shop.id, { collectionId: base.isAll ? undefined : base.id }, { sort, tag: opts.tag, filters: parseFilters(env.query) }, opts.withFacets ?? true);
  const products = await productList(env, db, shop.id, listing.ids, listing.total);
  const image = base.image ?? products[0]?.featured_image ?? null;
  const metafields = (await loadMetafields(db, shop.id, 'COLLECTION', [base.id])).get(base.id) ?? {};
  return {
    id: base.id, handle: base.handle, title: opts.tag ? `${base.title} - tagged "${opts.tag}"` : base.title, description: base.description, url: `/collections/${base.handle}`,
    image: base.image, featured_image: image, products, products_count: listing.total, all_products_count: listing.allCount, sort_by: sort, default_sort_by: defaultSort(base.sortOrder), sort_options: sortOptions,
    filters: withFilterUrls(listing.groups, env), tags: listing.tags, all_tags: listing.tags, all_types: listing.types, all_vendors: listing.vendors, current_type: first(env.query.type), current_vendor: first(env.query.vendor),
    template_suffix: base.templateSuffix ?? '', published_at: base.publishedAt?.toISOString() ?? null, metafields, seo: { title: base.seoTitle, description: base.seoDescription }, 'all?': base.isAll,
  };
}

/** Canonical path: a product reached through a collection canonicalizes to `/products/<handle>`; trailing slashes go. */
export function canonicalPath(path: string): string {
  const m = /^\/collections\/[^/]+\/products\/([^/]+)\/?$/.exec(path);
  return m ? `/products/${m[1]}` : path.length > 1 ? path.replace(/\/+$/, '') : path;
}

const SEARCH_TYPES = ['product', 'page', 'article'];
const plain = (html: string) => html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

/**
 * Storefront search. `type=product,page,article` picks resource types (default: all three), `options[prefix]=last|none` controls
 * prefix matching of the last term (default `last`). Products only: lazily paginated, sortable, filterable. Mixed types: one flat
 * list (products first, then articles and pages) where every item has `object_type`.
 */
export async function buildSearch(env: Env, q: string) {
  const { db, shop } = env;
  const requested = (first(env.query.type) ?? SEARCH_TYPES.join(',')).split(',').map((x) => x.trim()).filter((x) => SEARCH_TYPES.includes(x));
  const types = requested.length ? requested : SEARCH_TYPES;
  const prefix = first(env.query['options[prefix]']) === 'none' ? 'none' : 'last';
  const sort = sortFrom(env.query, 'manual');
  const productsOnly = types.length === 1 && types[0] === 'product';
  const listing = q && types.includes('product') ? await listProducts(db, shop.id, { q, prefix }, { sort, filters: parseFilters(env.query) }, productsOnly) : null;
  const ids = listing?.ids ?? [];
  const base = { performed: !!q, terms: q, types, sort_by: sort, default_sort_by: 'manual', sort_options: [{ name: 'Relevance', value: 'manual' }, ...sortOptions.filter((o) => o.value !== 'manual')], url: `/search?q=${encodeURIComponent(q)}`, corrected_terms: listing?.corrected ?? null };
  if (productsOnly) {
    return { ...base, results: await productList(env, db, shop.id, ids, ids.length), results_count: ids.length, products_count: ids.length, filters: withFilterUrls(listing?.groups ?? [], env) };
  }
  const [products, pageRows, articleRows] = await Promise.all([
    loadProducts(db, shop.id, ids.slice(0, 250)),
    q && types.includes('page') ? searchPages(db, shop.id, q, 50) : [],
    q && types.includes('article') ? searchArticles(db, shop.id, q, 50) : [],
  ]);
  const results = [
    ...products.map((p) => ({ ...trProduct(env, p), object_type: 'product' })),
    ...articleRows.map(({ a, blogHandle }) => ({ id: a.id, object_type: 'article', title: a.title, handle: a.handle, url: `/blogs/${blogHandle}/${a.handle}`, author: a.author ?? '', content: a.bodyHtml, excerpt: a.summaryHtml ?? '', excerpt_or_content: a.summaryHtml || a.bodyHtml, tags: a.tags, image: null, published_at: a.publishedAt?.toISOString() ?? null })),
    ...pageRows.map((p) => ({ id: p.id, object_type: 'page', title: p.title, handle: p.handle, url: `/pages/${p.handle}`, content: p.bodyHtml, author: '', published_at: p.publishedAt?.toISOString() ?? null, excerpt: plain(p.bodyHtml).slice(0, 200) })),
  ];
  return { ...base, results, results_count: results.length, products_count: products.length, filters: [] };
}

/** Request-wide Liquid globals (everything except the page's own resource). */
export async function buildGlobals(env: Env, themeId: number, pageType: string): Promise<Record<string, unknown>> {
  const { db, shop } = env;
  const [menus, pages, cols, blogRows, pricing, customer, shopMf] = await Promise.all([
    listMenus(db, shop.id, env.path, env.tr), listPages(db, shop.id).then((l) => l.map((p) => trPage(env, p))), listCollections(db, shop.id), listBlogHandles(db, shop.id),
    env.cart ? priceCartDiscounts(db, shop.id, env.cart, env.customer?.email ?? null) : null, env.customer ? buildCustomer(db, shop, env.customer) : null,
    loadMetafields(db, shop.id, 'SHOP', [shop.id]),
  ]);
  const linklists: Record<string, LinklistObject> = {};
  for (const m of menus) { linklists[m.handle] = m; linklists[m.handle.replace(/-/g, '_')] = m; }
  const colLight = cols.map((c0) => trCollection(env, c0)).map((c) => ({ id: c.id, handle: c.handle, title: c.title, url: `/collections/${c.handle}`, description: c.description, image: c.image, featured_image: c.image, products_count: c.productsCount, all_products_count: c.productsCount }));
  const collections = lazyMap(['all', ...cols.map((c) => c.handle)], async (h) => { const b = await getCollection(db, shop.id, h); return b ? buildCollection(env, b, { withFacets: false }) : null; }, colLight);
  const origin = env.origin;
  const request = requestObject(shop, origin, env.path, pageType, env.locale, env.prefix);
  const languages = env.ctx.locales.locales.map((l) => ({ locale: l.locale, name: l.name, primary: l.primary, prefix: env.ctx.locales.prefixOf(l.locale) }));
  return {
    shop: { ...shopObject(shop, origin, { products: 0, collections: cols.length }), metafields: shopMf.get(shop.id) ?? {} }, request, routes: routesObject(env.prefix), localization: localizationObject(shop, env.locale, languages, origin, env.path), cart: liquidCart(env.cart, shop, pricing),
    linklists, pages: lazyMap(pages.map((p) => p.handle), async (h) => pages.find((p) => p.handle === h) ?? null), collections,
    all_products: lazyMap(true, async (h) => trProduct(env, await getProductByHandle(db, shop.id, h)), {}), customer, blogs: lazyMap(blogRows.map((b) => b.handle), async (h) => { const b = blogRows.find((x) => x.handle === h); return b ? buildBlog(db, shop.id, b) : null; }),
    articles: lazyMap(true, async (key) => { const [bh, ah] = key.split(/[/.]/); const b = bh ? await getBlog(db, shop.id, bh) : null; const a = b && ah ? await getPublishedArticle(db, shop.id, b, ah) : null; return a ?? null; }, {}),
    all_country_option_tags: countryOptions(null, shop.locale).map((c) => `<option value="${c.code}" data-provinces="[]">${c.name.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</option>`).join(''), theme: { id: themeId, name: 'Aurora', role: 'main' },
    canonical_url: origin + env.prefix + (env.prefix && env.path === '/' ? '' : canonicalPath(env.path)) + (Number(first(env.query.page)) > 1 ? `?page=${Number(first(env.query.page))}` : ''), page_title: '', page_description: '', current_page: 1, current_tags: [], powered_by_link: '<a href="https://github.com/" rel="nofollow">Powered by ShopMe</a>',
    additional_checkout_buttons: false, content_for_additional_checkout_buttons: '', handle: '',
  };
}

/** Typed-setting lookups (collection pickers, links, images). */
export function makeResolvers(env: Env, globals: Record<string, unknown>): ResourceResolvers {
  return {
    collection: async (h) => { const b = await getCollection(env.db, env.shop.id, h); return b ? buildCollection(env, { ...b }, { withFacets: false }) : null; },
    product: async (h) => trProduct(env, await getProductByHandle(env.db, env.shop.id, h)),
    page: async (h) => trPage(env, await getPage(env.db, env.shop.id, h)),
    linklist: async (h) => (globals.linklists as Record<string, unknown>)[h] ?? null,
    image: (v) => {
      if (!v) return null;
      const m = /^shopify:\/\/shop_images\/(.+)$/.exec(v);
      const src = m ? `/files/${m[1]}` : v;
      return { src, url: src, alt: '', width: null, height: null, aspect_ratio: null };
    },
  };
}

export const pageInput = (env: Env, template: string, suffix: string | null | undefined, globals: Record<string, unknown>): PageInput => ({
  template, suffix, globals, locale: env.locale,
  request: { path: env.path, query: env.query },
  money: { format: env.shop.moneyFormat, withCurrency: env.shop.moneyWithCurrencyFormat, currency: env.shop.currency },
});
