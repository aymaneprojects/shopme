import { and, asc, eq, inArray, sql, type SQL } from 'drizzle-orm';
import { isIdentity, priceVariants, productListedOnStorefront, productReachableOnStorefront, schema as s, searchProducts, type Db, type MarketContext } from '@shopme/core';
import { loadMetafields } from './metafields';
import type { Image, ProductObject, VariantObject } from './types';

type ProductRow = typeof s.products.$inferSelect;

const iso = (d: Date | null | undefined): string | null => (d ? d.toISOString() : null);

function imageObject(m: typeof s.media.$inferSelect, position: number, productId: number): Image {
  const w = m.width ?? null, h = m.height ?? null;
  const base = { id: m.id, src: m.url ?? '', url: m.url ?? '', alt: m.alt ?? null, width: w, height: h, aspect_ratio: w && h ? w / h : null, position, product_id: productId, media_type: 'image' };
  const presentation = m.focalX != null && m.focalY != null ? { focal_point: `${+m.focalX.toFixed(1)}% ${+m.focalY.toFixed(1)}%` } : null;
  return { ...base, preview_image: { src: base.src, width: w, height: h, aspect_ratio: base.aspect_ratio, alt: base.alt }, presentation };
}

export interface VariantStock { variantId: number; productId: number; price: number; compareAt: number | null; available: boolean; quantity: number | null }

/** Per variant: price and availability (tracked stock summed over active locations; untracked or oversell-allowed means available). */
export async function variantStock(db: Db, shopId: number, productIds: number[]): Promise<VariantStock[]> {
  if (!productIds.length) return [];
  const rows = await db.select({
    id: s.productVariants.id, productId: s.productVariants.productId, price: s.productVariants.price, compareAt: s.productVariants.compareAtPrice,
    policy: s.productVariants.inventoryPolicy, tracked: s.inventoryItems.tracked,
    stock: sql<number | null>`(select coalesce(sum(l.available), 0)::int from inventory_levels l where l.inventory_item_id = ${s.inventoryItems.id} and l.is_active)`,
  }).from(s.productVariants)
    .leftJoin(s.inventoryItems, eq(s.inventoryItems.variantId, s.productVariants.id))
    .where(and(eq(s.productVariants.shopId, shopId), inArray(s.productVariants.productId, productIds)));
  return rows.map((r) => {
    const unlimited = r.policy === 'CONTINUE' || r.tracked === null || r.tracked === false;
    return { variantId: r.id, productId: r.productId, price: r.price, compareAt: r.compareAt, available: unlimited || (r.stock ?? 0) > 0, quantity: r.tracked ? (r.stock ?? 0) : null };
  });
}

/** Build Liquid product objects (with variants, options, images) for the given ids, in the given order. */
export async function loadProducts(db: Db, shopId: number, ids: number[], opts: { selectedVariantId?: number; /** Buyer market: prices come out in its currency. */ pricing?: MarketContext } = {}): Promise<ProductObject[]> {
  if (!ids.length) return [];
  const prods = await db.select().from(s.products).where(and(eq(s.products.shopId, shopId), inArray(s.products.id, ids)));
  const [variantRows, optionRows, valueRows, vov, mediaRows, items, stock, productMf] = await Promise.all([
    db.select().from(s.productVariants).where(inArray(s.productVariants.productId, ids)).orderBy(asc(s.productVariants.position), asc(s.productVariants.id)),
    db.select().from(s.productOptions).where(inArray(s.productOptions.productId, ids)).orderBy(asc(s.productOptions.position)),
    db.select({ v: s.productOptionValues, productId: s.productOptions.productId }).from(s.productOptionValues).innerJoin(s.productOptions, eq(s.productOptions.id, s.productOptionValues.optionId)).where(inArray(s.productOptions.productId, ids)).orderBy(asc(s.productOptionValues.position)),
    db.select({ variantId: s.variantOptionValues.variantId, optionId: s.variantOptionValues.optionId, valueId: s.variantOptionValues.optionValueId }).from(s.variantOptionValues).innerJoin(s.productVariants, eq(s.productVariants.id, s.variantOptionValues.variantId)).where(inArray(s.productVariants.productId, ids)),
    db.select({ productId: s.productMedia.productId, position: s.productMedia.position, m: s.media }).from(s.productMedia).innerJoin(s.media, eq(s.media.id, s.productMedia.mediaId)).where(inArray(s.productMedia.productId, ids)).orderBy(asc(s.productMedia.position)),
    db.select({ variantId: s.inventoryItems.variantId, requiresShipping: s.inventoryItems.requiresShipping, tracked: s.inventoryItems.tracked, weight: s.inventoryItems.weightValue, unit: s.inventoryItems.weightUnit })
      .from(s.inventoryItems).innerJoin(s.productVariants, eq(s.productVariants.id, s.inventoryItems.variantId)).where(inArray(s.productVariants.productId, ids)),
    variantStock(db, shopId, ids),
    loadMetafields(db, shopId, 'PRODUCT', ids),
  ]);
  const priced = opts.pricing && !isIdentity(opts.pricing) ? await priceVariants(db, shopId, opts.pricing, variantRows.map((v) => ({ id: v.id, price: v.price, compareAt: v.compareAtPrice }))) : null;
  const variants = priced ? variantRows.map((v) => { const p = priced.get(v.id); return p ? { ...v, price: p.price, compareAtPrice: p.compareAt } : v; }) : variantRows;
  const variantMf = await loadMetafields(db, shopId, 'PRODUCTVARIANT', variants.map((v) => v.id));
  const grams: Record<string, number> = { GRAMS: 1, KILOGRAMS: 1000, POUNDS: 453.59237, OUNCES: 28.349523125 };
  const byId = new Map(prods.map((p) => [p.id, p]));
  const out: ProductObject[] = [];
  for (const id of ids) {
    const p = byId.get(id);
    if (!p) continue;
    const options = optionRows.filter((o) => o.productId === id);
    const images = mediaRows.filter((m) => m.productId === id && m.m.url).map((m, i) => imageObject(m.m, i + 1, id));
    // Variants hidden from the Online Store are not offered (unless every variant is hidden, which the admin refuses): neither they nor option values only they use are listed.
    const allRows = variants.filter((v) => v.productId === id);
    const vrows = allRows.some((v) => !v.hiddenFromOnlineStore) ? allRows.filter((v) => !v.hiddenFromOnlineStore) : allRows;
    const usedValueIds = vrows.length < allRows.length ? new Set(vov.filter((x) => vrows.some((v) => v.id === x.variantId)).map((x) => x.valueId)) : null;
    const vObjs: VariantObject[] = vrows.map((v, i) => {
      const optVals = options.map((o) => {
        const link = vov.find((x) => x.variantId === v.id && x.optionId === o.id);
        return link ? valueRows.find((x) => x.v.id === link.valueId)?.v.name ?? null : null;
      });
      const st = stock.find((x) => x.variantId === v.id);
      const item = items.find((x) => x.variantId === v.id);
      const img = v.mediaId ? images.find((m) => m.id === v.mediaId) ?? null : null;
      const defaultTitle = options.length === 0;
      const unit = v.unitQuantityValue && v.unitReferenceValue ? { quantity_value: v.unitQuantityValue, quantity_unit: v.unitQuantityUnit ?? '', reference_value: v.unitReferenceValue, reference_unit: v.unitReferenceUnit ?? '' } : null;
      return {
        id: v.id, title: v.title, public_title: defaultTitle ? null : v.title, name: `${p.title}${defaultTitle ? '' : ` - ${v.title}`}`,
        option1: optVals[0] ?? (defaultTitle ? v.title : null), option2: optVals[1] ?? null, option3: optVals[2] ?? null, options: optVals.filter((x): x is string => !!x).length ? optVals.filter((x): x is string => !!x) : [v.title],
        sku: v.sku ?? '', barcode: v.barcode ?? '', price: v.price, compare_at_price: v.compareAtPrice && v.compareAtPrice > v.price ? v.compareAtPrice : null,
        available: st?.available ?? true, inventory_quantity: st?.quantity ?? 0, inventory_management: item?.tracked ? 'shopify' : null, inventory_policy: v.inventoryPolicy.toLowerCase(),
        requires_shipping: item?.requiresShipping ?? true, taxable: v.taxable, weight: Math.round((item?.weight ?? 0) * (grams[item?.unit ?? 'GRAMS'] ?? 1)), weight_unit: 'g',
        featured_image: img, featured_media: img, image: img, url: `/products/${p.handle}?variant=${v.id}`, position: i + 1, product_id: id,
        quantity_rule: { min: 1, max: null, increment: 1 }, quantity_price_breaks: [], selling_plan_allocations: [], requires_selling_plan: false,
        unit_price_measurement: unit, unit_price: unit ? Math.round((v.price / unit.quantity_value) * unit.reference_value) : null, metafields: variantMf.get(v.id) ?? {}, created_at: iso(v.createdAt), updated_at: iso(v.updatedAt),
      } satisfies VariantObject;
    });
    const prices = vObjs.map((v) => v.price);
    const compare = vObjs.map((v) => v.compare_at_price ?? 0);
    const priceMin = Math.min(...prices), priceMax = Math.max(...prices);
    const compareMax = Math.max(0, ...compare), compareMin = Math.min(...compare.filter((c) => c > 0), compareMax || 0);
    const firstAvailable = vObjs.find((v) => v.available) ?? null;
    const selected = opts.selectedVariantId ? vObjs.find((v) => v.id === opts.selectedVariantId) ?? null : null;
    const onlyDefault = vObjs.length === 1 && options.length === 0;
    out.push({
      id: p.id, title: p.title, handle: p.handle, description: p.descriptionHtml, content: p.descriptionHtml, vendor: p.vendor, type: p.productType, product_type: p.productType, tags: p.tags,
      url: `/products/${p.handle}`, available: vObjs.some((v) => v.available), price: priceMin, price_min: priceMin, price_max: priceMax, price_varies: priceMin !== priceMax,
      compare_at_price: compareMax || null, compare_at_price_min: compareMin || 0, compare_at_price_max: compareMax, compare_at_price_varies: compareMin !== compareMax,
      featured_image: images[0] ?? null, featured_media: images[0] ?? null, images, media: images, variants: vObjs,
      options: options.map((o) => o.name),
      options_with_values: options.map((o, i) => ({ name: o.name, position: o.position, values: valueRows.filter((v) => v.v.optionId === o.id && (!usedValueIds || usedValueIds.has(v.v.id))).map((v) => v.v.name), selected_value: selected?.options[i] ?? (selected ? null : (firstAvailable ?? vObjs[0])?.options[i] ?? null) })),
      has_only_default_variant: onlyDefault, selected_variant: selected, first_available_variant: firstAvailable, selected_or_first_available_variant: selected ?? firstAvailable ?? vObjs[0] ?? null,
      template_suffix: p.templateSuffix ?? '', gift_card: p.isGiftCard, 'gift_card?': p.isGiftCard, requires_selling_plan: false, selling_plan_groups: [], metafields: productMf.get(id) ?? {},
      published_at: iso(p.publishedAt), created_at: iso(p.createdAt), updated_at: iso(p.updatedAt), seo: { title: p.seoTitle, description: p.seoDescription },
    });
  }
  return out;
}

/** `includeInactive` lets signed-in staff preview drafts and archived products. */
export async function getProductByHandle(db: Db, shopId: number, handle: string, opts: { selectedVariantId?: number; includeInactive?: boolean; pricing?: MarketContext } = {}): Promise<ProductObject | null> {
  const [p] = await db.select({ id: s.products.id }).from(s.products).where(and(eq(s.products.shopId, shopId), eq(s.products.handle, handle), opts.includeInactive ? undefined : productReachableOnStorefront)).limit(1);
  return p ? (await loadProducts(db, shopId, [p.id], opts))[0] ?? null : null;
}

// ---------------------------------------------------------------------------------------------------------------------
// Listing: collections, search
// ---------------------------------------------------------------------------------------------------------------------

export const SORT_KEYS = ['manual', 'best-selling', 'title-ascending', 'title-descending', 'price-ascending', 'price-descending', 'created-ascending', 'created-descending'] as const;
export type SortKey = (typeof SORT_KEYS)[number];

const COLLECTION_SORT: Record<string, SortKey> = { ALPHA_ASC: 'title-ascending', ALPHA_DESC: 'title-descending', BEST_SELLING: 'best-selling', CREATED: 'created-ascending', CREATED_DESC: 'created-descending', MANUAL: 'manual', PRICE_ASC: 'price-ascending', PRICE_DESC: 'price-descending' };
export const defaultSort = (collectionSortOrder: string | undefined): SortKey => COLLECTION_SORT[collectionSortOrder ?? 'MANUAL'] ?? 'manual';

export interface ListScope { collectionId?: number; q?: string; prefix?: 'last' | 'none' }
export interface ListOptions { sort?: SortKey; tag?: string; filters?: Record<string, string[]> }
interface Candidate { id: number; title: string; vendor: string; type: string; tags: string[]; createdAt: Date; pos: number; priceMin: number; priceMax: number; available: boolean; options: Map<string, string[]> }

async function candidates(db: Db, shopId: number, scope: ListScope, wantOptions: boolean, corrected: { value: string | null }): Promise<Candidate[]> {
  const conds: SQL[] = [eq(s.products.shopId, shopId), productListedOnStorefront];
  let rank: Map<number, number> | null = null;
  if (scope.q) {
    const found = await searchProducts(db, shopId, scope.q, { prefix: scope.prefix });
    rank = new Map(found.ids.map((id, i) => [id, i]));
    corrected.value = found.corrected;
    if (!found.ids.length) return [];
    conds.push(inArray(s.products.id, found.ids));
  }
  const base = scope.collectionId
    ? await db.select({ p: s.products, pos: s.collectionProducts.position }).from(s.collectionProducts).innerJoin(s.products, eq(s.products.id, s.collectionProducts.productId)).where(and(eq(s.collectionProducts.collectionId, scope.collectionId), ...conds))
    : (await db.select().from(s.products).where(and(...conds))).map((p) => ({ p, pos: 0 }));
  const ids = base.map((b) => b.p.id);
  const stock = await variantStock(db, shopId, ids);
  let optionMap = new Map<number, Map<string, string[]>>();
  if (wantOptions && ids.length) {
    const rows = await db.select({ productId: s.productOptions.productId, name: s.productOptions.name, value: s.productOptionValues.name }).from(s.productOptionValues).innerJoin(s.productOptions, eq(s.productOptions.id, s.productOptionValues.optionId)).where(inArray(s.productOptions.productId, ids));
    optionMap = new Map();
    for (const r of rows) { const m = optionMap.get(r.productId) ?? new Map<string, string[]>(); m.set(r.name, [...(m.get(r.name) ?? []), r.value]); optionMap.set(r.productId, m); }
  }
  return base.map(({ p, pos: pos0 }: { p: ProductRow; pos: number }) => {
    const pos = rank ? rank.get(p.id) ?? 0 : pos0;
    const vs = stock.filter((v) => v.productId === p.id);
    return { id: p.id, title: p.title, vendor: p.vendor, type: p.productType, tags: p.tags, createdAt: p.createdAt, pos, priceMin: Math.min(...vs.map((v) => v.price), Infinity), priceMax: Math.max(...vs.map((v) => v.price), 0), available: vs.some((v) => v.available), options: optionMap.get(p.id) ?? new Map() };
  });
}

const lc = (x: string) => x.toLowerCase();

function applyFilters(list: Candidate[], o: ListOptions): Candidate[] {
  let out = list;
  if (o.tag) out = out.filter((c) => c.tags.some((t) => lc(t) === lc(o.tag!)));
  const f = o.filters ?? {};
  const val = (k: string) => f[k]?.[0];
  if (val('v.availability') !== undefined) out = out.filter((c) => c.available === (val('v.availability') === '1'));
  const gte = val('v.price.gte'), lte = val('v.price.lte');
  if (gte) out = out.filter((c) => c.priceMax >= Number(gte) * 100);
  if (lte) out = out.filter((c) => c.priceMin <= Number(lte) * 100);
  if (f['p.product_type']) out = out.filter((c) => f['p.product_type']!.some((t) => lc(t) === lc(c.type)));
  if (f['p.vendor']) out = out.filter((c) => f['p.vendor']!.some((t) => lc(t) === lc(c.vendor)));
  if (f['p.tag']) out = out.filter((c) => f['p.tag']!.some((t) => c.tags.some((x) => lc(x) === lc(t))));
  for (const [k, vals] of Object.entries(f)) {
    if (!k.startsWith('v.option.')) continue;
    const name = lc(k.slice('v.option.'.length));
    out = out.filter((c) => [...c.options].some(([n, vs]) => lc(n) === name && vs.some((v) => vals.some((w) => lc(w) === lc(v)))));
  }
  return out;
}

function sortCandidates(list: Candidate[], sort: SortKey): Candidate[] {
  const cmp: Record<SortKey, (a: Candidate, b: Candidate) => number> = {
    manual: (a, b) => a.pos - b.pos || a.id - b.id,
    'best-selling': (a, b) => +b.createdAt - +a.createdAt,
    'title-ascending': (a, b) => a.title.localeCompare(b.title), 'title-descending': (a, b) => b.title.localeCompare(a.title),
    'price-ascending': (a, b) => a.priceMin - b.priceMin, 'price-descending': (a, b) => b.priceMin - a.priceMin,
    'created-ascending': (a, b) => +a.createdAt - +b.createdAt, 'created-descending': (a, b) => +b.createdAt - +a.createdAt,
  };
  return [...list].sort(cmp[sort]);
}

export interface FilterValue { label: string; value: string; count: number; active: boolean; param_name: string }
export interface FilterGroup { label: string; param_name: string; type: 'list' | 'price_range'; values?: FilterValue[]; min_value?: { value: number }; max_value?: { value: number }; range_max?: number; active_values: FilterValue[]; url_to_remove: string }

export interface Listing { corrected: string | null; ids: number[]; total: number; allCount: number; groups: FilterGroup[]; tags: string[]; types: string[]; vendors: string[] }

/** Ids (sorted and filtered) plus filter facets for a collection or search scope. */
export async function listProducts(db: Db, shopId: number, scope: ListScope, o: ListOptions, withFacets: boolean): Promise<Listing> {
  const corrected = { value: null as string | null };
  const all = await candidates(db, shopId, scope, withFacets, corrected);
  const filtered = applyFilters(all, o);
  const sorted = sortCandidates(filtered, o.sort ?? 'manual');
  const groups: FilterGroup[] = [];
  const active = o.filters ?? {};
  if (withFacets) {
    const counts = (get: (c: Candidate) => string[]) => { const m = new Map<string, number>(); for (const c of all) for (const v of get(c)) if (v) m.set(v, (m.get(v) ?? 0) + 1); return [...m].sort((a, b) => a[0].localeCompare(b[0])); };
    const list = (label: string, param: string, rows: [string, number][], activeKey: string): FilterGroup => {
      const values = rows.map(([v, n]) => ({ label: v, value: v, count: n, active: (active[activeKey] ?? []).some((x) => lc(x) === lc(v)), param_name: `filter.${param}` }));
      return { label, param_name: `filter.${param}`, type: 'list', values, active_values: values.filter((v) => v.active), url_to_remove: '' };
    };
    const inStock = all.filter((c) => c.available).length;
    const av = [['1', inStock], ['0', all.length - inStock]] as [string, number][];
    const availability = list('Availability', 'v.availability', av, 'v.availability');
    availability.values = availability.values!.map((v) => ({ ...v, label: v.value === '1' ? 'In stock' : 'Out of stock', active: (active['v.availability'] ?? []).includes(v.value) }));
    availability.active_values = availability.values.filter((v) => v.active);
    groups.push(availability);
    const maxPrice = Math.max(0, ...all.map((c) => c.priceMax));
    groups.push({ label: 'Price', param_name: 'filter.v.price', type: 'price_range', min_value: { value: active['v.price.gte']?.[0] ? Number(active['v.price.gte'][0]) * 100 : 0 }, max_value: { value: active['v.price.lte']?.[0] ? Number(active['v.price.lte'][0]) * 100 : maxPrice }, range_max: maxPrice, active_values: [], url_to_remove: '' });
    const types = counts((c) => [c.type]);
    if (types.length > 1) groups.push(list('Product type', 'p.product_type', types, 'p.product_type'));
    const vendors = counts((c) => [c.vendor]);
    if (vendors.length > 1) groups.push(list('Vendor', 'p.vendor', vendors, 'p.vendor'));
  }
  return {
    corrected: corrected.value, ids: sorted.map((c) => c.id), total: sorted.length, allCount: all.length, groups,
    tags: [...new Set(all.flatMap((c) => c.tags))].sort(), types: [...new Set(all.map((c) => c.type).filter(Boolean))].sort(), vendors: [...new Set(all.map((c) => c.vendor).filter(Boolean))].sort(),
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Collections
// ---------------------------------------------------------------------------------------------------------------------

export interface CollectionBase {
  id: number; handle: string; title: string; description: string; sortOrder: string; templateSuffix: string | null; image: Image | null;
  seoTitle: string | null; seoDescription: string | null; productsCount: number; publishedAt: Date | null; isAll: boolean;
}

async function collectionImages(db: Db, mediaIds: number[]): Promise<Map<number, Image>> {
  const out = new Map<number, Image>();
  if (!mediaIds.length) return out;
  for (const m of await db.select().from(s.media).where(inArray(s.media.id, mediaIds))) if (m.url) out.set(m.id, imageObject(m, 1, 0));
  return out;
}

async function collectionCounts(db: Db, shopId: number): Promise<Map<number, number>> {
  const rows = await db.select({ id: s.collectionProducts.collectionId, n: sql<number>`count(*)::int` }).from(s.collectionProducts).innerJoin(s.products, eq(s.products.id, s.collectionProducts.productId)).where(and(eq(s.collectionProducts.shopId, shopId), productListedOnStorefront)).groupBy(s.collectionProducts.collectionId);
  return new Map(rows.map((r) => [r.id, r.n]));
}

export async function activeProductCount(db: Db, shopId: number): Promise<number> {
  const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(s.products).where(and(eq(s.products.shopId, shopId), productListedOnStorefront));
  return r?.n ?? 0;
}

const allCollection = (count: number): CollectionBase => ({ id: 0, handle: 'all', title: 'Products', description: '', sortOrder: 'MANUAL', templateSuffix: null, image: null, seoTitle: null, seoDescription: null, productsCount: count, publishedAt: null, isAll: true });

function toBase(c: typeof s.collections.$inferSelect, images: Map<number, Image>, counts: Map<number, number>): CollectionBase {
  return { id: c.id, handle: c.handle, title: c.title, description: c.descriptionHtml, sortOrder: c.sortOrder, templateSuffix: c.templateSuffix, image: c.imageMediaId ? images.get(c.imageMediaId) ?? null : null, seoTitle: c.seoTitle, seoDescription: c.seoDescription, productsCount: counts.get(c.id) ?? 0, publishedAt: c.publishedAt, isAll: false };
}

/** Published collections (the built-in `all` collection is not included). */
export async function listCollections(db: Db, shopId: number): Promise<CollectionBase[]> {
  const rows = await db.select().from(s.collections).where(eq(s.collections.shopId, shopId)).orderBy(asc(s.collections.title));
  const [images, counts] = await Promise.all([collectionImages(db, rows.flatMap((r) => (r.imageMediaId ? [r.imageMediaId] : []))), collectionCounts(db, shopId)]);
  return rows.filter((r) => !!r.publishedAt && r.publishedAt <= new Date()).map((r) => toBase(r, images, counts));
}

export async function getCollection(db: Db, shopId: number, handle: string): Promise<CollectionBase | null> {
  if (handle === 'all') return allCollection(await activeProductCount(db, shopId));
  const [c] = await db.select().from(s.collections).where(and(eq(s.collections.shopId, shopId), eq(s.collections.handle, handle))).limit(1);
  if (!c || !c.publishedAt || c.publishedAt > new Date()) return null;
  const [images, counts] = await Promise.all([collectionImages(db, c.imageMediaId ? [c.imageMediaId] : []), collectionCounts(db, shopId)]);
  return toBase(c, images, counts);
}
