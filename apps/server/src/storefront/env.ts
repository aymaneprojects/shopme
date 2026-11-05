import { lazyList, type PageInput, type ResourceResolvers } from '@shopme/liquid-compat';
import { getPrimaryShop, getCartByToken, searchArticles, searchPages, priceCartDiscounts, resolveCustomerSession, type CartView, type Customer, type Db, type Shop } from '@shopme/core';
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
}

export async function makeEnv(ctx: AppContext, req: FastifyRequest, shop: Shop, path?: string): Promise<Env> {
  const token = req.cookies[CART_COOKIE];
  const cart = token ? await getCartByToken(ctx.db, shop.id, token.split('?')[0]!.split('%3F')[0]!) : null;
  return { ctx, db: ctx.db, shop, origin: ctx.config.appUrl, path: path ?? req.url.split('?')[0]!, query: req.query as Query, cart, customer: await customerOf(ctx, req, shop) };
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

/** Preview size of `collection.products` outside `paginate` (the full list is reachable through `paginate`). */
const PREVIEW = 50;

async function productList(db: Db, shopId: number, ids: number[], total: number): Promise<ProductObject[]> {
  const memo = new Map<number, ProductObject>();
  const load = async (offset: number, limit: number) => {
    const wanted = ids.slice(offset, offset + limit);
    const missing = wanted.filter((id) => !memo.has(id));
    if (missing.length) for (const p of await loadProducts(db, shopId, missing)) memo.set(p.id, p);
    return wanted.map((id) => memo.get(id)).filter((p): p is ProductObject => !!p);
  };
  return lazyList(await load(0, PREVIEW), total, load) as ProductObject[];
}

export async function buildCollection(env: Env, base: CollectionBase, opts: { tag?: string; withFacets?: boolean } = {}) {
  const { db, shop } = env;
  const sort = sortFrom(env.query, defaultSort(base.sortOrder));
  const listing = await listProducts(db, shop.id, { collectionId: base.isAll ? undefined : base.id }, { sort, tag: opts.tag, filters: parseFilters(env.query) }, opts.withFacets ?? true);
  const products = await productList(db, shop.id, listing.ids, listing.total);
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
    return { ...base, results: await productList(db, shop.id, ids, ids.length), results_count: ids.length, products_count: ids.length, filters: withFilterUrls(listing?.groups ?? [], env) };
  }
  const [products, pageRows, articleRows] = await Promise.all([
    loadProducts(db, shop.id, ids.slice(0, 250)),
    q && types.includes('page') ? searchPages(db, shop.id, q, 50) : [],
    q && types.includes('article') ? searchArticles(db, shop.id, q, 50) : [],
  ]);
  const results = [
    ...products.map((p) => ({ ...p, object_type: 'product' })),
    ...articleRows.map(({ a, blogHandle }) => ({ id: a.id, object_type: 'article', title: a.title, handle: a.handle, url: `/blogs/${blogHandle}/${a.handle}`, author: a.author ?? '', content: a.bodyHtml, excerpt: a.summaryHtml ?? '', excerpt_or_content: a.summaryHtml || a.bodyHtml, tags: a.tags, image: null, published_at: a.publishedAt?.toISOString() ?? null })),
    ...pageRows.map((p) => ({ id: p.id, object_type: 'page', title: p.title, handle: p.handle, url: `/pages/${p.handle}`, content: p.bodyHtml, author: '', published_at: p.publishedAt?.toISOString() ?? null, excerpt: plain(p.bodyHtml).slice(0, 200) })),
  ];
  return { ...base, results, results_count: results.length, products_count: products.length, filters: [] };
}

/** Request-wide Liquid globals (everything except the page's own resource). */
export async function buildGlobals(env: Env, themeId: number, pageType: string): Promise<Record<string, unknown>> {
  const { db, shop } = env;
  const [menus, pages, cols, blogRows, pricing, customer, shopMf] = await Promise.all([
    listMenus(db, shop.id, env.path), listPages(db, shop.id), listCollections(db, shop.id), listBlogHandles(db, shop.id),
    env.cart ? priceCartDiscounts(db, shop.id, env.cart, env.customer?.email ?? null) : null, env.customer ? buildCustomer(db, shop, env.customer) : null,
    loadMetafields(db, shop.id, 'SHOP', [shop.id]),
  ]);
  const linklists: Record<string, LinklistObject> = {};
  for (const m of menus) { linklists[m.handle] = m; linklists[m.handle.replace(/-/g, '_')] = m; }
  const colLight = cols.map((c) => ({ id: c.id, handle: c.handle, title: c.title, url: `/collections/${c.handle}`, description: c.description, image: c.image, featured_image: c.image, products_count: c.productsCount, all_products_count: c.productsCount }));
  const collections = lazyMap(['all', ...cols.map((c) => c.handle)], async (h) => { const b = await getCollection(db, shop.id, h); return b ? buildCollection(env, b, { withFacets: false }) : null; }, colLight);
  const origin = env.origin;
  const request = requestObject(shop, origin, env.path, pageType);
  return {
    shop: { ...shopObject(shop, origin, { products: 0, collections: cols.length }), metafields: shopMf.get(shop.id) ?? {} }, request, routes: routesObject(), localization: localizationObject(shop), cart: liquidCart(env.cart, shop, pricing),
    linklists, pages: lazyMap(pages.map((p) => p.handle), async (h) => pages.find((p) => p.handle === h) ?? null), collections,
    all_products: lazyMap(true, async (h) => getProductByHandle(db, shop.id, h), {}), customer, blogs: lazyMap(blogRows.map((b) => b.handle), async (h) => { const b = blogRows.find((x) => x.handle === h); return b ? buildBlog(db, shop.id, b) : null; }),
    articles: lazyMap(true, async (key) => { const [bh, ah] = key.split(/[/.]/); const b = bh ? await getBlog(db, shop.id, bh) : null; const a = b && ah ? await getPublishedArticle(db, shop.id, b, ah) : null; return a ?? null; }, {}),
    all_country_option_tags: countryOptions(null, shop.locale).map((c) => `<option value="${c.code}" data-provinces="[]">${c.name.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</option>`).join(''), theme: { id: themeId, name: 'Aurora', role: 'main' },
    canonical_url: origin + canonicalPath(env.path) + (Number(first(env.query.page)) > 1 ? `?page=${Number(first(env.query.page))}` : ''), page_title: '', page_description: '', current_page: 1, current_tags: [], powered_by_link: '<a href="https://github.com/" rel="nofollow">Powered by ShopMe</a>',
    additional_checkout_buttons: false, content_for_additional_checkout_buttons: '', handle: '',
  };
}

/** Typed-setting lookups (collection pickers, links, images). */
export function makeResolvers(env: Env, globals: Record<string, unknown>): ResourceResolvers {
  return {
    collection: async (h) => { const b = await getCollection(env.db, env.shop.id, h); return b ? buildCollection(env, { ...b }, { withFacets: false }) : null; },
    product: (h) => getProductByHandle(env.db, env.shop.id, h),
    page: (h) => getPage(env.db, env.shop.id, h),
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
  template, suffix, globals, locale: env.shop.locale,
  request: { path: env.path, query: env.query },
  money: { format: env.shop.moneyFormat, withCurrency: env.shop.moneyWithCurrencyFormat, currency: env.shop.currency },
});
