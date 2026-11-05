import { and, asc, desc, eq, inArray, ne, sql } from 'drizzle-orm';
import type { UserError } from '@shopme/shopify-compat';
import {
  files, inventoryItems, inventoryLevels, media, productMedia, productOptionValues, productOptions, productVariants, products, variantOptionValues,
} from '../../db/schema';
import type { Db, Executor } from '../../db/client';
import { slugify, uniqueHandle } from '../handle';
import { redirectPathChange } from '../content/redirects';
import { getShop } from '../shops';
import { emit, errR, normalizeTags, okR, txResult, type Result } from './common';
import { buildSearch, compare, dateCompare, idTerm, likeCi } from './search';
import { activateLevel, defaultLocationId, getLocation, inventoryItemPatch, type InventoryItemUpdate } from './inventory';
import { deleteMetafieldsFor, setMetafieldsTx, type MetafieldSetInput } from './metafields';
import { recomputeSmartMembership, setProductCollections } from './collections';
import { getCategory } from './taxonomy';

export type Product = typeof products.$inferSelect;
export type Variant = typeof productVariants.$inferSelect;
export type Media = typeof media.$inferSelect;
export type ProductStatus = 'ACTIVE' | 'ARCHIVED' | 'DRAFT';
const STATUSES = ['ACTIVE', 'ARCHIVED', 'DRAFT'];
export const MAX_OPTIONS = 3;
export const MAX_VARIANTS = 2048;

/* ------------------------------ reads ------------------------------ */

export async function getProduct(db: Executor, shopId: number, id: number): Promise<Product | null> {
  const [r] = await db.select().from(products).where(and(eq(products.shopId, shopId), eq(products.id, id))).limit(1);
  return r ?? null;
}
export async function getProductByHandle(db: Executor, shopId: number, handle: string): Promise<Product | null> {
  const [r] = await db.select().from(products).where(and(eq(products.shopId, shopId), eq(products.handle, handle))).limit(1);
  return r ?? null;
}

const invTotal = sql`(select coalesce(sum(l.available), 0) from product_variants v join inventory_items i on i.variant_id = v.id join inventory_levels l on l.inventory_item_id = i.id and l.is_active where v.product_id = ${products.id} and i.tracked)`;
const hasVariant = (cond: unknown) => sql`exists (select 1 from product_variants v where v.product_id = ${products.id} and ${cond})`;

const productSearch = (q?: string | null) => buildSearch(q, {
  fields: {
    title: (_o, v) => likeCi(products.title, v), handle: (_o, v) => likeCi(products.handle, v, true), vendor: (_o, v) => likeCi(products.vendor, v, true),
    product_type: (_o, v) => likeCi(products.productType, v, true), status: (_o, v) => sql`${products.status} = ${v.toUpperCase()}`,
    tag: (_o, v) => sql`exists (select 1 from unnest(${products.tags}) t where lower(t) = ${v.toLowerCase()})`,
    id: (_o, v) => idTerm(products.id, v),
    sku: (_o, v) => hasVariant(likeCi(sql`v.sku`, v, true)), barcode: (_o, v) => hasVariant(likeCi(sql`v.barcode`, v, true)),
    created_at: (o, v) => dateCompare(products.createdAt, o, v), updated_at: (o, v) => dateCompare(products.updatedAt, o, v), published_at: (o, v) => dateCompare(products.publishedAt, o, v),
    inventory_total: (o, v) => (Number.isFinite(Number(v)) ? compare(invTotal, o, Number(v)) : null),
    collection_id: (_o, v) => sql`exists (select 1 from collection_products cp where cp.product_id = ${products.id} and cp.collection_id = ${Number(v)})`,
    gift_card: (_o, v) => sql`${products.isGiftCard} = ${v === 'true'}`,
  },
  text: (v) => sql`(${likeCi(products.title, v)} or ${likeCi(products.vendor, v)} or ${likeCi(products.productType, v)} or ${likeCi(products.handle, v)}
    or exists (select 1 from unnest(${products.tags}) t where t ilike ${`%${v}%`}) or ${hasVariant(likeCi(sql`v.sku`, v))})`,
});

export interface ListProductsOptions { query?: string | null; sortKey?: string | null; reverse?: boolean; offset: number; limit: number }

export function listProducts(db: Executor, shopId: number, o: ListProductsOptions): Promise<Product[]> {
  const col = ({ TITLE: products.title, VENDOR: products.vendor, PRODUCT_TYPE: products.productType, CREATED_AT: products.createdAt, UPDATED_AT: products.updatedAt, PUBLISHED_AT: products.publishedAt, INVENTORY_TOTAL: invTotal } as Record<string, unknown>)[o.sortKey ?? 'ID'] ?? products.id;
  return db.select().from(products).where(and(eq(products.shopId, shopId), productSearch(o.query)))
    .orderBy(o.reverse ? desc(col as never) : asc(col as never), o.reverse ? desc(products.id) : asc(products.id)).limit(o.limit).offset(o.offset);
}

export async function countProducts(db: Executor, shopId: number, q?: string | null, limit = 10000): Promise<{ count: number; precision: 'EXACT' | 'AT_LEAST' }> {
  const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(products).where(and(eq(products.shopId, shopId), productSearch(q)));
  const n = r?.n ?? 0;
  return n > limit ? { count: limit, precision: 'AT_LEAST' } : { count: n, precision: 'EXACT' };
}

export interface OptionWithValues { id: number; name: string; position: number; values: { id: number; name: string; position: number; hasVariants: boolean }[] }

export async function getProductOptions(db: Executor, shopId: number, productId: number): Promise<OptionWithValues[]> {
  const opts = await db.select().from(productOptions).where(and(eq(productOptions.shopId, shopId), eq(productOptions.productId, productId))).orderBy(asc(productOptions.position));
  if (!opts.length) return [];
  const vals = await db.select({ v: productOptionValues, used: sql<number>`(select count(*)::int from variant_option_values x where x.option_value_id = ${productOptionValues.id})` })
    .from(productOptionValues).where(inArray(productOptionValues.optionId, opts.map((o) => o.id))).orderBy(asc(productOptionValues.position), asc(productOptionValues.id));
  return opts.map((o) => ({ id: o.id, name: o.name, position: o.position, values: vals.filter((x) => x.v.optionId === o.id).map((x) => ({ id: x.v.id, name: x.v.name, position: x.v.position, hasVariants: x.used > 0 })) }));
}

export async function getVariant(db: Executor, shopId: number, id: number): Promise<Variant | null> {
  const [r] = await db.select().from(productVariants).where(and(eq(productVariants.shopId, shopId), eq(productVariants.id, id))).limit(1);
  return r ?? null;
}

const variantStock = sql`(select coalesce(sum(l.available), 0) from inventory_items i join inventory_levels l on l.inventory_item_id = i.id and l.is_active where i.variant_id = ${productVariants.id})`;

const variantSearch = (q?: string | null) => buildSearch(q, {
  fields: {
    sku: (_o, v) => likeCi(productVariants.sku, v, true), title: (_o, v) => likeCi(productVariants.title, v), barcode: (_o, v) => likeCi(productVariants.barcode, v, true),
    product_id: (_o, v) => idTerm(productVariants.productId, v), id: (_o, v) => idTerm(productVariants.id, v),
    price: (o, v) => (Number.isFinite(Number(v)) ? compare(productVariants.price, o, Math.round(Number(v) * 100)) : null),
    inventory_quantity: (o, v) => (Number.isFinite(Number(v)) ? compare(variantStock, o, Number(v)) : null),
    updated_at: (o, v) => dateCompare(productVariants.updatedAt, o, v), created_at: (o, v) => dateCompare(productVariants.createdAt, o, v),
  },
  text: (v) => sql`(${likeCi(productVariants.sku, v)} or ${likeCi(productVariants.title, v)} or ${likeCi(productVariants.barcode, v)})`,
});

export interface ListVariantsOptions { productId?: number; query?: string | null; sortKey?: string | null; reverse?: boolean; offset: number; limit: number }

export function listVariants(db: Executor, shopId: number, o: ListVariantsOptions): Promise<Variant[]> {
  const col = ({ POSITION: productVariants.position, TITLE: productVariants.title, FULL_TITLE: productVariants.title, NAME: productVariants.title, SKU: productVariants.sku, CREATED_AT: productVariants.createdAt, INVENTORY_QUANTITY: variantStock } as Record<string, unknown>)[o.sortKey ?? 'ID'] ?? productVariants.id;
  const byPosition = o.productId && (o.sortKey ?? 'POSITION') === 'POSITION';
  const c = byPosition ? productVariants.position : col;
  return db.select().from(productVariants)
    .where(and(eq(productVariants.shopId, shopId), o.productId ? eq(productVariants.productId, o.productId) : undefined, variantSearch(o.query)))
    .orderBy(o.reverse ? desc(c as never) : asc(c as never), o.reverse ? desc(productVariants.id) : asc(productVariants.id)).limit(o.limit).offset(o.offset);
}

export async function countVariants(db: Executor, shopId: number, productId: number): Promise<number> {
  const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(productVariants).where(and(eq(productVariants.shopId, shopId), eq(productVariants.productId, productId)));
  return r?.n ?? 0;
}

export interface SelectedOption { optionId: number; valueId: number; name: string; value: string; position: number }

export async function getSelectedOptions(db: Executor, shopId: number, variantIds: number[]): Promise<Map<number, SelectedOption[]>> {
  const out = new Map<number, SelectedOption[]>();
  if (!variantIds.length) return out;
  const rows = await db.select({ variantId: variantOptionValues.variantId, optionId: productOptions.id, valueId: productOptionValues.id, name: productOptions.name, value: productOptionValues.name, position: productOptions.position })
    .from(variantOptionValues).innerJoin(productOptions, eq(productOptions.id, variantOptionValues.optionId)).innerJoin(productOptionValues, eq(productOptionValues.id, variantOptionValues.optionValueId))
    .where(and(eq(variantOptionValues.shopId, shopId), inArray(variantOptionValues.variantId, variantIds))).orderBy(asc(productOptions.position));
  for (const r of rows) out.set(r.variantId, [...(out.get(r.variantId) ?? []), r]);
  return out;
}

export interface ProductSummary { minPrice: number; maxPrice: number; totalInventory: number; tracksInventory: boolean; variantsCount: number }

export async function getProductSummary(db: Executor, shopId: number, productId: number): Promise<ProductSummary> {
  const rows = await db.select({ price: productVariants.price, tracked: inventoryItems.tracked, qty: sql<number>`coalesce(sum(${inventoryLevels.available}), 0)::int` })
    .from(productVariants).leftJoin(inventoryItems, eq(inventoryItems.variantId, productVariants.id))
    .leftJoin(inventoryLevels, and(eq(inventoryLevels.inventoryItemId, inventoryItems.id), eq(inventoryLevels.isActive, true)))
    .where(and(eq(productVariants.shopId, shopId), eq(productVariants.productId, productId))).groupBy(productVariants.id, inventoryItems.id);
  const prices = rows.map((r) => r.price);
  return {
    minPrice: prices.length ? Math.min(...prices) : 0, maxPrice: prices.length ? Math.max(...prices) : 0,
    totalInventory: rows.filter((r) => r.tracked).reduce((a, r) => a + r.qty, 0), tracksInventory: rows.some((r) => r.tracked), variantsCount: rows.length,
  };
}

export function listProductMedia(db: Executor, shopId: number, productId: number, o: { reverse?: boolean; offset: number; limit: number }): Promise<Media[]> {
  return db.select({ m: media }).from(productMedia).innerJoin(media, eq(media.id, productMedia.mediaId))
    .where(and(eq(productMedia.shopId, shopId), eq(productMedia.productId, productId)))
    .orderBy(o.reverse ? desc(productMedia.position) : asc(productMedia.position)).limit(o.limit).offset(o.offset).then((rows) => rows.map((r) => r.m));
}
export async function countProductMedia(db: Executor, shopId: number, productId: number): Promise<number> {
  const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(productMedia).where(and(eq(productMedia.shopId, shopId), eq(productMedia.productId, productId)));
  return r?.n ?? 0;
}
export async function getMedia(db: Executor, shopId: number, id: number): Promise<Media | null> {
  const [r] = await db.select().from(media).where(and(eq(media.shopId, shopId), eq(media.id, id))).limit(1);
  return r ?? null;
}

/* ------------------------------ media ------------------------------ */

export interface MediaInput { originalSource: string; alt?: string | null; mediaContentType: string }

/** Create media rows from sources (external URLs or our own `/files/...` URLs from the upload endpoint). */
export async function createMediaRows(tx: Executor, shopId: number, inputs: MediaInput[], fieldRoot = 'media'): Promise<Result<Media[]>> {
  for (const [i, m] of inputs.entries()) {
    if (!/^(https?:\/\/|\/files\/)/.test(m.originalSource)) return errR([fieldRoot, String(i), 'originalSource'], 'Image URL is invalid', 'INVALID');
    if (!['IMAGE', 'VIDEO', 'EXTERNAL_VIDEO', 'MODEL_3D'].includes(m.mediaContentType)) return errR([fieldRoot, String(i), 'mediaContentType'], 'Unsupported media content type', 'INVALID');
  }
  const out: Media[] = [];
  for (const m of inputs) {
    const key = /\/files\/(.+?)(?:[?#].*)?$/.exec(m.originalSource)?.[1];
    const [file] = key ? await tx.select().from(files).where(and(eq(files.shopId, shopId), eq(files.storageKey, key))).limit(1) : [];
    const [row] = await tx.insert(media).values({ shopId, type: m.mediaContentType, alt: m.alt ?? null, url: m.originalSource, fileId: file?.id ?? null, mimeType: file?.mimeType ?? null }).returning();
    out.push(row!);
  }
  return okR(out);
}

async function attachMedia(tx: Executor, shopId: number, productId: number, rows: Media[]) {
  if (!rows.length) return;
  const [m] = await tx.select({ max: sql<number>`coalesce(max(${productMedia.position}), 0)::int` }).from(productMedia).where(eq(productMedia.productId, productId));
  await tx.insert(productMedia).values(rows.map((r, i) => ({ shopId, productId, mediaId: r.id, position: (m?.max ?? 0) + 1 + i })));
}

export async function createProductMedia(db: Db, shopId: number, productId: number, inputs: MediaInput[]): Promise<Result<Media[]>> {
  if (!(await getProduct(db, shopId, productId))) return errR(['productId'], "Product does not exist", 'PRODUCT_DOES_NOT_EXIST');
  return txResult(db, async (tx) => {
    const rows = await createMediaRows(tx, shopId, inputs);
    if (!rows.ok) return rows;
    await attachMedia(tx, shopId, productId, rows.value);
    await tx.update(products).set({ updatedAt: new Date() }).where(eq(products.id, productId));
    await emit(tx, shopId, 'product', productId, 'products/update');
    return rows;
  });
}

/** Reorder a product's media: each move puts `mediaId` at `newPosition` (clamped to the end). Positions become 0..n-1. */
export async function reorderProductMedia(db: Db, shopId: number, productId: number, moves: { mediaId: number | null; newPosition: string }[]): Promise<Result<true>> {
  if (!(await getProduct(db, shopId, productId))) return errR(['id'], 'Product does not exist', 'PRODUCT_DOES_NOT_EXIST');
  return txResult(db, async (tx) => {
    const rows = await tx.select({ mediaId: productMedia.mediaId }).from(productMedia)
      .where(and(eq(productMedia.shopId, shopId), eq(productMedia.productId, productId)))
      .orderBy(asc(productMedia.position), asc(productMedia.mediaId));
    const order = rows.map((r) => r.mediaId);
    const errors: UserError[] = [];
    for (const [i, m] of moves.entries()) {
      if (m.mediaId == null || !order.includes(m.mediaId)) errors.push({ field: ['moves', String(i), 'id'], message: 'Media does not exist on product', code: 'MEDIA_DOES_NOT_EXIST_ON_PRODUCT' });
      if (!/^\d+$/.test(m.newPosition)) errors.push({ field: ['moves', String(i), 'newPosition'], message: 'Position must be a non-negative integer', code: 'INVALID' });
    }
    if (errors.length) return { ok: false, errors };
    for (const m of moves) {
      const from = order.indexOf(m.mediaId!);
      order.splice(from, 1);
      order.splice(Math.min(Number(m.newPosition), order.length), 0, m.mediaId!);
    }
    for (const [position, mediaId] of order.entries()) {
      await tx.update(productMedia).set({ position }).where(and(eq(productMedia.shopId, shopId), eq(productMedia.productId, productId), eq(productMedia.mediaId, mediaId)));
    }
    await tx.update(products).set({ updatedAt: new Date() }).where(eq(products.id, productId));
    await emit(tx, shopId, 'product', productId, 'products/update');
    return okR(true as const);
  });
}

/* ------------------------------ product filter values ------------------------------ */

/** One page (offset/limit) of the distinct non-empty product types, vendors or tags of the shop, sorted alphabetically. */
export async function listProductFilterValues(db: Executor, shopId: number, field: 'productType' | 'vendor' | 'tag', o: { offset: number; limit: number }): Promise<string[]> {
  if (field === 'tag') {
    const tags = db.select({ value: sql<string>`unnest(${products.tags})`.as('value') }).from(products).where(eq(products.shopId, shopId)).as('shop_tags');
    const rows = await db.selectDistinct({ value: tags.value }).from(tags).where(ne(tags.value, ''))
      .orderBy(asc(tags.value)).limit(o.limit).offset(o.offset);
    return rows.map((r) => r.value);
  }
  const col = field === 'vendor' ? products.vendor : products.productType;
  const rows = await db.selectDistinct({ value: col }).from(products).where(and(eq(products.shopId, shopId), ne(col, '')))
    .orderBy(asc(col)).limit(o.limit).offset(o.offset);
  return rows.map((r) => r.value);
}

/* ------------------------------ options and variants ------------------------------ */

export interface OptionInput { name?: string | null; position?: number | null; values?: { name?: string | null }[] | null }
export interface VariantOptionValueInput { id?: number | null; name?: string | null; optionId?: number | null; optionName?: string | null }
export interface UnitPriceMeasurement { quantityValue: number; quantityUnit: string; referenceValue: number; referenceUnit: string }
export interface VariantInput {
  id?: number | null; price?: number | null; compareAtPrice?: number | null; barcode?: string | null; taxable?: boolean | null; taxCode?: string | null;
  inventoryPolicy?: string | null; mediaId?: number | null; optionValues?: VariantOptionValueInput[] | null;
  unitPriceMeasurement?: UnitPriceMeasurement | null;
  inventoryItem?: InventoryItemUpdate | null; inventoryQuantities?: { locationId: number; availableQuantity: number }[] | null; metafields?: MetafieldSetInput[] | null;
}

const withPrefix = (errors: UserError[], prefix: string[]): UserError[] => errors.map((e) => ({ ...e, field: e.field ? [...prefix, ...e.field] : prefix }));

/** Insert options (with values) for a product; returns them with ids. */
async function insertOptions(tx: Executor, shopId: number, productId: number, inputs: OptionInput[], startPosition: number, fieldRoot: string[]): Promise<Result<OptionWithValues[]>> {
  const names = new Set<string>();
  for (const [i, o] of inputs.entries()) {
    const at = [...fieldRoot, String(i)];
    const name = o.name?.trim();
    if (!name) return errR([...at, 'name'], 'Option name is missing', 'OPTION_NAME_MISSING');
    if (name.length > 255) return errR([...at, 'name'], 'Option name is too long', 'OPTION_NAME_TOO_LONG');
    if (names.has(name.toLowerCase())) return errR([...at, 'name'], 'Duplicated option name', 'DUPLICATED_OPTION_NAME');
    names.add(name.toLowerCase());
    const vals = (o.values ?? []).map((v) => v.name?.trim() ?? '');
    if (!vals.length || vals.some((v) => !v)) return errR([...at, 'values'], 'Option values are missing', 'OPTION_VALUES_MISSING');
    if (new Set(vals.map((v) => v.toLowerCase())).size !== vals.length) return errR([...at, 'values'], 'Duplicated option value', 'DUPLICATED_OPTION_VALUE');
  }
  const out: OptionWithValues[] = [];
  const ordered = [...inputs].map((o, i) => ({ o, i })).sort((a, b) => (a.o.position ?? 1e9) - (b.o.position ?? 1e9) || a.i - b.i);
  for (const [n, { o }] of ordered.entries()) {
    const [opt] = await tx.insert(productOptions).values({ shopId, productId, name: o.name!.trim(), position: startPosition + n + 1 }).returning();
    const vals = await tx.insert(productOptionValues).values(o.values!.map((v, p) => ({ shopId, optionId: opt!.id, name: v.name!.trim(), position: p + 1 }))).returning();
    out.push({ id: opt!.id, name: opt!.name, position: opt!.position, values: vals.map((v) => ({ id: v.id, name: v.name, position: v.position, hasVariants: false })) });
  }
  return okR(out);
}

interface NewVariant {
  input: VariantInput; position: number; optionValueIds: { optionId: number; valueId: number }[]; title: string;
}

/** Insert a variant, its inventory item and stock levels. */
const unitCols = (u: UnitPriceMeasurement | null | undefined) => u === undefined ? {} : {
  unitQuantityValue: u?.quantityValue ?? null, unitQuantityUnit: u?.quantityUnit ?? null, unitReferenceValue: u?.referenceValue ?? null, unitReferenceUnit: u?.referenceUnit ?? null,
};

async function insertVariant(tx: Executor, shopId: number, productId: number, v: NewVariant, shopWeightUnit: string, defaultLoc: number | null): Promise<Variant> {
  const inp = v.input;
  const [row] = await tx.insert(productVariants).values({
    shopId, productId, position: v.position, title: v.title, sku: inp.inventoryItem?.sku || null, barcode: inp.barcode ?? null, price: inp.price ?? 0,
    compareAtPrice: inp.compareAtPrice ?? null, taxable: inp.taxable ?? true, taxCode: inp.taxCode ?? null, inventoryPolicy: inp.inventoryPolicy ?? 'DENY', mediaId: inp.mediaId ?? null, ...unitCols(inp.unitPriceMeasurement),
  }).returning();
  if (v.optionValueIds.length) await tx.insert(variantOptionValues).values(v.optionValueIds.map((x) => ({ shopId, variantId: row!.id, optionId: x.optionId, optionValueId: x.valueId })));
  const [item] = await tx.insert(inventoryItems).values({
    shopId, variantId: row!.id, tracked: false, weightUnit: shopWeightUnit, ...inventoryItemPatch(inp.inventoryItem ?? {}),
  }).returning();
  const stock = inp.inventoryQuantities?.length ? inp.inventoryQuantities : defaultLoc ? [{ locationId: defaultLoc, availableQuantity: 0 }] : [];
  for (const s of stock) await activateLevel(tx, shopId, item!.id, s.locationId, s.availableQuantity);
  if (inp.metafields?.length) await setMetafieldsTx(tx, shopId, inp.metafields.map((m) => ({ ...m, ownerType: 'PRODUCTVARIANT', ownerId: row!.id })));
  return row!;
}

const titleOf = (names: string[]) => names.join(' / ') || 'Default Title';

/** Default "Title / Default Title" option and variant. */
async function insertDefaultVariant(tx: Executor, shopId: number, productId: number, shopWeightUnit: string, defaultLoc: number | null) {
  const opts = await insertOptions(tx, shopId, productId, [{ name: 'Title', values: [{ name: 'Default Title' }] }], 0, ['options']);
  if (!opts.ok) throw new Error('default option failed');
  const o = opts.value[0]!;
  return insertVariant(tx, shopId, productId, { input: {}, position: 1, title: 'Default Title', optionValueIds: [{ optionId: o.id, valueId: o.values[0]!.id }] }, shopWeightUnit, defaultLoc);
}

async function validateInventoryLocations(tx: Executor, shopId: number, inp: VariantInput, at: string[]): Promise<Result<null>> {
  for (const [j, q] of (inp.inventoryQuantities ?? []).entries()) {
    if (q.availableQuantity < 0) return errR([...at, 'inventoryQuantities', String(j), 'availableQuantity'], 'Quantity must be greater than or equal to 0', 'GREATER_THAN_OR_EQUAL_TO');
    if (!(await getLocation(tx, shopId, q.locationId))) return errR([...at, 'inventoryQuantities', String(j), 'locationId'], 'Location not found', 'NOT_DEFINED_FOR_SHOP');
  }
  return okR(null);
}

function validateVariantFields(inp: VariantInput, at: string[], codes: { negative: string }): Result<null> {
  if (inp.price != null && inp.price < 0) return errR([...at, 'price'], 'Price must be greater than or equal to 0', codes.negative);
  if (inp.compareAtPrice != null && inp.compareAtPrice < 0) return errR([...at, 'compareAtPrice'], 'Compare at price must be greater than or equal to 0', codes.negative);
  if (inp.inventoryPolicy != null && !['DENY', 'CONTINUE'].includes(inp.inventoryPolicy)) return errR([...at, 'inventoryPolicy'], 'Inventory policy is invalid', 'INVALID_INPUT');
  const w = inp.inventoryItem?.weight;
  if (w && !(w.value >= 0)) return errR([...at, 'inventoryItem', 'measurement', 'weight', 'value'], 'Weight must be greater than or equal to 0', 'INVALID_INPUT');
  return okR(null);
}

/** Map `optionValues` of a variant input to (option, value) ids, creating unknown values. Every option needs a value. */
async function resolveOptionValues(tx: Executor, shopId: number, opts: OptionWithValues[], given: VariantOptionValueInput[], at: string[]): Promise<Result<{ optionId: number; valueId: number; name: string }[]>> {
  const picked = new Map<number, { valueId: number; name: string }>();
  for (const g of given) {
    let opt = g.optionId ? opts.find((o) => o.id === g.optionId) : g.optionName ? opts.find((o) => o.name.toLowerCase() === g.optionName!.trim().toLowerCase()) : undefined;
    let val: { id: number; name: string } | undefined;
    if (g.id) {
      for (const o of opts) { const v = o.values.find((x) => x.id === g.id); if (v) { opt = o; val = v; } }
    }
    if (!opt) return errR([...at, 'optionValues'], 'Option does not exist', g.id ? 'OPTION_VALUE_DOES_NOT_EXIST' : 'OPTION_DOES_NOT_EXIST');
    const name = (val?.name ?? g.name)?.trim();
    if (!name) return errR([...at, 'optionValues'], 'Option value name is missing', 'INVALID_INPUT');
    if (name.length > 255) return errR([...at, 'optionValues'], 'Option value name is too long', 'OPTION_VALUE_NAME_TOO_LONG');
    val ??= opt.values.find((x) => x.name.toLowerCase() === name.toLowerCase());
    if (!val) {
      const [nv] = await tx.insert(productOptionValues).values({ shopId, optionId: opt.id, name, position: opt.values.length + 1 }).returning();
      val = { id: nv!.id, name: nv!.name };
      opt.values.push({ id: nv!.id, name: nv!.name, position: nv!.position, hasVariants: false });
    }
    picked.set(opt.id, { valueId: val.id, name: val.name });
  }
  const out: { optionId: number; valueId: number; name: string }[] = [];
  for (const o of opts) {
    const p = picked.get(o.id);
    if (!p) return errR([...at, 'optionValues'], `You need to add option values for ${o.name}`, 'NEED_TO_ADD_OPTION_VALUES');
    out.push({ optionId: o.id, ...p });
  }
  return okR(out);
}

async function existingCombos(tx: Executor, shopId: number, productId: number): Promise<Map<string, number>> {
  const rows = await tx.select({ variantId: variantOptionValues.variantId, optionId: variantOptionValues.optionId, valueId: variantOptionValues.optionValueId })
    .from(variantOptionValues).innerJoin(productVariants, eq(productVariants.id, variantOptionValues.variantId))
    .where(and(eq(productVariants.shopId, shopId), eq(productVariants.productId, productId))).orderBy(asc(variantOptionValues.optionId));
  const by = new Map<number, number[]>();
  for (const r of rows) by.set(r.variantId, [...(by.get(r.variantId) ?? []), r.valueId]);
  return new Map([...by].map(([id, vals]) => [vals.join(','), id]));
}
const comboKey = (ids: { valueId: number; optionId: number }[]) => [...ids].sort((a, b) => a.optionId - b.optionId).map((x) => x.valueId).join(',');

async function touchProduct(tx: Executor, shopId: number, productId: number) {
  await tx.update(products).set({ updatedAt: new Date() }).where(eq(products.id, productId));
  await recomputeSmartMembership(tx, shopId, [productId]);
}

export async function createOptions(db: Db, shopId: number, productId: number, options: OptionInput[], strategy: 'LEAVE_AS_IS' | 'CREATE' = 'LEAVE_AS_IS'): Promise<Result<Product>> {
  const product = await getProduct(db, shopId, productId);
  if (!product) return errR(['productId'], 'Product does not exist', 'PRODUCT_DOES_NOT_EXIST');
  return txResult(db, async (tx) => {
    let current = await getProductOptions(tx, shopId, productId);
    const onlyDefault = current.length === 1 && current[0]!.name === 'Title' && current[0]!.values.length === 1 && current[0]!.values[0]!.name === 'Default Title';
    if (onlyDefault) {
      if (options.some((o) => o.name?.trim().toLowerCase() === 'title') === false) {
        await tx.delete(variantOptionValues).where(eq(variantOptionValues.optionId, current[0]!.id));
        await tx.delete(productOptions).where(eq(productOptions.id, current[0]!.id));
        current = [];
      }
    }
    if (current.length + options.length > MAX_OPTIONS) return errR(['options'], `Product can have at most ${MAX_OPTIONS} options`, 'OPTIONS_OVER_LIMIT');
    if (options.some((o) => current.some((c) => c.name.toLowerCase() === o.name?.trim().toLowerCase()))) return errR(['options'], 'Option already exists', 'OPTION_ALREADY_EXISTS');
    const created = await insertOptions(tx, shopId, productId, options, current.length, ['options']);
    if (!created.ok) return created;
    const variants = await tx.select().from(productVariants).where(eq(productVariants.productId, productId)).orderBy(asc(productVariants.position));
    const all = [...current, ...created.value];
    // Existing variants take the first value of each new option.
    const selected = await getSelectedOptions(tx, shopId, variants.map((v) => v.id));
    for (const v of variants) {
      await tx.insert(variantOptionValues).values(created.value.map((o) => ({ shopId, variantId: v.id, optionId: o.id, optionValueId: o.values[0]!.id })));
      const names = [...(selected.get(v.id) ?? []).map((s) => s.value), ...created.value.map((o) => o.values[0]!.name)];
      await tx.update(productVariants).set({ title: titleOf(names) }).where(eq(productVariants.id, v.id));
    }
    if (strategy === 'CREATE' && variants.length) {
      const base = variants[0]!;
      const shop = await getShop(tx, shopId);
      const loc = await defaultLocationId(tx, shopId);
      const have = await existingCombos(tx, shopId, productId);
      let combos: { optionId: number; valueId: number; name: string }[][] = [[]];
      for (const o of all) combos = combos.flatMap((c) => o.values.map((v) => [...c, { optionId: o.id, valueId: v.id, name: v.name }]));
      if (combos.length > MAX_VARIANTS) return errR(['options'], 'Too many variants would be created', 'TOO_MANY_VARIANTS_CREATED');
      let position = variants.length;
      for (const c of combos) {
        if (have.has(comboKey(c))) continue;
        await insertVariant(tx, shopId, productId, { input: { price: base.price, compareAtPrice: base.compareAtPrice, taxable: base.taxable, inventoryPolicy: base.inventoryPolicy }, position: ++position, optionValueIds: c, title: titleOf(c.map((x) => x.name)) }, shop?.weightUnit ?? 'KILOGRAMS', loc);
      }
    }
    await touchProduct(tx, shopId, productId);
    await emit(tx, shopId, 'product', productId, 'products/update');
    return okR((await getProduct(tx, shopId, productId))!);
  });
}

export interface BulkResult { variants: Variant[]; errors: UserError[] }

export async function bulkCreateVariants(db: Db, shopId: number, productId: number, inputs: VariantInput[], strategy: 'DEFAULT' | 'REMOVE_STANDALONE_VARIANT' | 'PRESERVE_STANDALONE_VARIANT' = 'DEFAULT'): Promise<Result<BulkResult>> {
  if (!(await getProduct(db, shopId, productId))) return errR(['productId'], 'Product does not exist', 'PRODUCT_DOES_NOT_EXIST');
  if (!inputs.length) return errR(['variants'], 'At least one variant is required', 'INVALID_INPUT');
  return txResult(db, async (tx) => {
    const shop = await getShop(tx, shopId);
    const loc = await defaultLocationId(tx, shopId);
    let opts = await getProductOptions(tx, shopId, productId);
    let existing = await tx.select().from(productVariants).where(eq(productVariants.productId, productId)).orderBy(asc(productVariants.position));
    const standalone = opts.length === 1 && opts[0]!.name === 'Title' && opts[0]!.values[0]?.name === 'Default Title' && existing.length === 1;
    const named = inputs[0]!.optionValues?.map((o) => o.optionName?.trim()).filter((n): n is string => !!n && n.toLowerCase() !== 'title') ?? [];
    if (standalone && strategy !== 'PRESERVE_STANDALONE_VARIANT' && named.length) {
      // The placeholder "Title" option is replaced by the options named in the first variant; values are added as variants reference them.
      await tx.delete(productOptions).where(eq(productOptions.productId, productId));
      opts = [];
      for (const [i, name] of [...new Set(named)].entries()) {
        const [o] = await tx.insert(productOptions).values({ shopId, productId, name, position: i + 1 }).returning();
        opts.push({ id: o!.id, name: o!.name, position: o!.position, values: [] });
      }
    }
    if (standalone && strategy !== 'PRESERVE_STANDALONE_VARIANT') {
      await tx.delete(productVariants).where(eq(productVariants.id, existing[0]!.id));
      existing = [];
    }
    if (existing.length + inputs.length > MAX_VARIANTS) return errR(['variants'], 'Too many variants', 'INVALID_INPUT');
    const have = await existingCombos(tx, shopId, productId);
    const created: Variant[] = [];
    let position = existing.length ? Math.max(...existing.map((v) => v.position)) : 0;
    for (const [i, inp] of inputs.entries()) {
      const at = ['variants', String(i)];
      const f = validateVariantFields(inp, at, { negative: 'NEGATIVE_PRICE_VALUE' });
      if (!f.ok) return f;
      const q = await validateInventoryLocations(tx, shopId, inp, at);
      if (!q.ok) return q;
      const picked = await resolveOptionValues(tx, shopId, opts, inp.optionValues ?? [], at);
      if (!picked.ok) return picked;
      const key = comboKey(picked.value);
      if (have.has(key)) return errR([...at, 'optionValues'], 'The variant already exists', 'VARIANT_ALREADY_EXISTS');
      have.set(key, -1);
      created.push(await insertVariant(tx, shopId, productId, { input: inp, position: ++position, optionValueIds: picked.value, title: titleOf(picked.value.map((x) => x.name)) }, shop?.weightUnit ?? 'KILOGRAMS', loc));
    }
    await touchProduct(tx, shopId, productId);
    for (const v of created) await emit(tx, shopId, 'product_variant', v.id, 'product_variants/create');
    await emit(tx, shopId, 'product', productId, 'products/update');
    return okR({ variants: created, errors: [] });
  });
}

export async function bulkUpdateVariants(db: Db, shopId: number, productId: number, inputs: VariantInput[], allowPartial = false): Promise<Result<BulkResult>> {
  if (!(await getProduct(db, shopId, productId))) return errR(['productId'], 'Product does not exist', 'PRODUCT_DOES_NOT_EXIST');
  return txResult(db, async (tx) => {
    const opts = await getProductOptions(tx, shopId, productId);
    const updated: Variant[] = [];
    const errors: UserError[] = [];
    for (const [i, inp] of inputs.entries()) {
      const at = ['variants', String(i)];
      const fail = (r: Result<unknown>) => { if (!r.ok) errors.push(...r.errors); return !r.ok; };
      if (!inp.id) { fail(errR([...at, 'id'], 'Variant id is missing', 'PRODUCT_VARIANT_ID_MISSING')); continue; }
      const cur = await getVariant(tx, shopId, inp.id);
      if (!cur) { fail(errR([...at, 'id'], 'Variant does not exist', 'PRODUCT_VARIANT_DOES_NOT_EXIST')); continue; }
      if (cur.productId !== productId) { fail(errR([...at, 'id'], 'Variant does not belong to the specified product', 'MUST_BE_FOR_THIS_PRODUCT')); continue; }
      if (inp.inventoryQuantities?.length) { fail(errR([...at, 'inventoryQuantities'], 'Inventory quantities can not be set during a variant update; use inventory mutations', 'NO_INVENTORY_QUANTITES_DURING_UPDATE')); continue; }
      if (fail(validateVariantFields(inp, at, { negative: 'NEGATIVE_PRICE_VALUE' }))) continue;
      let title = cur.title;
      if (inp.optionValues?.length) {
        const picked = await resolveOptionValues(tx, shopId, opts, inp.optionValues, at);
        if (fail(picked)) continue;
        const pv = (picked as { ok: true; value: { optionId: number; valueId: number; name: string }[] }).value;
        const dup = (await existingCombos(tx, shopId, productId)).get(comboKey(pv));
        if (dup !== undefined && dup !== cur.id) { fail(errR([...at, 'optionValues'], 'The variant already exists', 'VARIANT_ALREADY_EXISTS')); continue; }
        await tx.delete(variantOptionValues).where(eq(variantOptionValues.variantId, cur.id));
        await tx.insert(variantOptionValues).values(pv.map((x) => ({ shopId, variantId: cur.id, optionId: x.optionId, optionValueId: x.valueId })));
        title = titleOf(pv.map((x) => x.name));
      }
      const [row] = await tx.update(productVariants).set({
        title, ...(inp.price != null && { price: inp.price }), ...(inp.compareAtPrice !== undefined && { compareAtPrice: inp.compareAtPrice }), ...(inp.barcode !== undefined && { barcode: inp.barcode || null }),
        ...(inp.taxable != null && { taxable: inp.taxable }), ...(inp.taxCode !== undefined && { taxCode: inp.taxCode }), ...(inp.inventoryPolicy && { inventoryPolicy: inp.inventoryPolicy }),
        ...(inp.mediaId !== undefined && { mediaId: inp.mediaId }), ...unitCols(inp.unitPriceMeasurement), ...(inp.inventoryItem?.sku !== undefined && { sku: inp.inventoryItem.sku || null }),
      }).where(eq(productVariants.id, cur.id)).returning();
      if (inp.inventoryItem) await tx.update(inventoryItems).set(inventoryItemPatch(inp.inventoryItem)).where(eq(inventoryItems.variantId, cur.id));
      if (inp.metafields?.length) await setMetafieldsTx(tx, shopId, inp.metafields.map((m) => ({ ...m, ownerType: 'PRODUCTVARIANT', ownerId: cur.id })));
      updated.push(row!);
    }
    if (errors.length && !allowPartial) return { ok: false as const, errors };
    await touchProduct(tx, shopId, productId);
    for (const v of updated) await emit(tx, shopId, 'product_variant', v.id, 'product_variants/update');
    await emit(tx, shopId, 'product', productId, 'products/update');
    return okR({ variants: updated, errors });
  });
}

export async function bulkDeleteVariants(db: Db, shopId: number, productId: number, variantIds: number[]): Promise<Result<Product>> {
  const product = await getProduct(db, shopId, productId);
  if (!product) return errR(['productId'], 'Product does not exist', 'PRODUCT_DOES_NOT_EXIST');
  return txResult(db, async (tx) => {
    const all = await tx.select().from(productVariants).where(eq(productVariants.productId, productId)).orderBy(asc(productVariants.position));
    const ids = new Set(all.map((v) => v.id));
    if (variantIds.some((id) => !ids.has(id))) return errR(['variantsIds'], 'At least one variant does not belong to the product', 'AT_LEAST_ONE_VARIANT_DOES_NOT_BELONG_TO_THE_PRODUCT');
    const remaining = all.filter((v) => !variantIds.includes(v.id));
    if (!remaining.length) return errR(['variantsIds'], 'Cannot delete the last variant of a product', 'CANNOT_DELETE_LAST_VARIANT');
    await tx.delete(productVariants).where(inArray(productVariants.id, variantIds));
    await deleteMetafieldsFor(tx, shopId, 'PRODUCTVARIANT', variantIds);
    for (const [i, v] of remaining.entries()) if (v.position !== i + 1) await tx.update(productVariants).set({ position: i + 1 }).where(eq(productVariants.id, v.id));
    await touchProduct(tx, shopId, productId);
    for (const id of variantIds) await emit(tx, shopId, 'product_variant', id, 'product_variants/delete');
    await emit(tx, shopId, 'product', productId, 'products/update');
    return okR((await getProduct(tx, shopId, productId))!);
  });
}

/* ------------------------------ product CRUD ------------------------------ */

export interface ProductInput {
  title?: string | null; handle?: string | null; descriptionHtml?: string | null; vendor?: string | null; productType?: string | null; tags?: string[] | null;
  status?: string | null; templateSuffix?: string | null; seo?: { title?: string | null; description?: string | null } | null; giftCard?: boolean | null;
  category?: string | null; collectionsToJoin?: number[] | null; collectionsToLeave?: number[] | null; metafields?: MetafieldSetInput[] | null; productOptions?: OptionInput[] | null;
}

function validateProduct(input: ProductInput, creating: boolean): Result<null> {
  if (creating ? !input.title?.trim() : input.title !== undefined && !input.title?.trim()) return errR(['title'], "Title can't be blank", 'BLANK');
  if (input.title && input.title.length > 255) return errR(['title'], 'Title is too long (maximum is 255 characters)', 'TOO_LONG');
  if (input.status != null && !STATUSES.includes(input.status)) return errR(['status'], 'Status is invalid', 'INVALID');
  if (input.category && !getCategory(input.category)) return errR(['category'], 'Product category is invalid', 'INVALID');
  if ((input.tags?.length ?? 0) > 250) return errR(['tags'], 'Too many tags (maximum is 250)', 'INVALID');
  return okR(null);
}

const productFields = (input: ProductInput) => ({
  ...(input.descriptionHtml != null && { descriptionHtml: input.descriptionHtml }), ...(input.vendor != null && { vendor: input.vendor.trim() }),
  ...(input.productType != null && { productType: input.productType.trim() }), ...(input.tags != null && { tags: normalizeTags(input.tags) }),
  ...(input.templateSuffix !== undefined && { templateSuffix: input.templateSuffix || null }), ...(input.giftCard != null && { isGiftCard: input.giftCard }),
  ...(input.category !== undefined && { category: input.category || null }),
  ...(input.seo && { seoTitle: input.seo.title ?? null, seoDescription: input.seo.description ?? null }),
});

export async function createProduct(db: Db, shopId: number, input: ProductInput, mediaInputs: MediaInput[] = []): Promise<Result<Product>> {
  const v = validateProduct(input, true);
  if (!v.ok) return v;
  return txResult(db, async (tx) => {
    const shop = await getShop(tx, shopId);
    const loc = await defaultLocationId(tx, shopId);
    const handle = await uniqueHandle(input.handle?.trim() || input.title!, async (h) => !!(await getProductByHandle(tx, shopId, h)));
    const status = input.status ?? 'ACTIVE';
    const [row] = await tx.insert(products).values({ shopId, handle, title: input.title!.trim(), status, publishedAt: status === 'ACTIVE' ? new Date() : null, ...productFields(input) }).returning();
    const id = row!.id;
    const options = input.productOptions ?? [];
    if (options.length) {
      if (options.length > MAX_OPTIONS) return errR(['productOptions'], `Product can have at most ${MAX_OPTIONS} options`, 'OPTIONS_OVER_LIMIT');
      const made = await insertOptions(tx, shopId, id, options, 0, ['productOptions']);
      if (!made.ok) return made;
      await insertVariant(tx, shopId, id, { input: {}, position: 1, title: titleOf(made.value.map((o) => o.values[0]!.name)), optionValueIds: made.value.map((o) => ({ optionId: o.id, valueId: o.values[0]!.id })) }, shop?.weightUnit ?? 'KILOGRAMS', loc);
    } else await insertDefaultVariant(tx, shopId, id, shop?.weightUnit ?? 'KILOGRAMS', loc);
    if (input.metafields?.length) {
      const mf = await setMetafieldsTx(tx, shopId, input.metafields.map((m) => ({ ...m, ownerType: 'PRODUCT', ownerId: id })), 'metafields');
      if (!mf.ok) return mf;
    }
    if (mediaInputs.length) {
      const m = await createMediaRows(tx, shopId, mediaInputs);
      if (!m.ok) return m;
      await attachMedia(tx, shopId, id, m.value);
    }
    const col = await setProductCollections(tx, shopId, id, input.collectionsToJoin ?? [], []);
    if (!col.ok) return col;
    await recomputeSmartMembership(tx, shopId, [id]);
    await emit(tx, shopId, 'product', id, 'products/create');
    return okR(row!);
  });
}

export async function updateProduct(db: Db, shopId: number, id: number, input: ProductInput, mediaInputs: MediaInput[] = []): Promise<Result<Product>> {
  const cur = await getProduct(db, shopId, id);
  if (!cur) return errR(['id'], 'Product does not exist', 'PRODUCT_DOES_NOT_EXIST');
  const v = validateProduct(input, false);
  if (!v.ok) return v;
  return txResult(db, async (tx) => {
    let handle = cur.handle;
    if (input.handle && slugify(input.handle) !== cur.handle) handle = await uniqueHandle(input.handle, async (h) => h !== cur.handle && !!(await getProductByHandle(tx, shopId, h)));
    const status = input.status ?? cur.status;
    const publishedAt = status !== 'ACTIVE' ? null : cur.publishedAt ?? new Date();
    const [row] = await tx.update(products).set({ handle, status, publishedAt, ...(input.title && { title: input.title.trim() }), ...productFields(input), updatedAt: new Date() })
      .where(and(eq(products.shopId, shopId), eq(products.id, id))).returning();
    if (handle !== cur.handle) await redirectPathChange(tx, shopId, `/products/${cur.handle}`, `/products/${handle}`);
    if (input.metafields?.length) {
      const mf = await setMetafieldsTx(tx, shopId, input.metafields.map((m) => ({ ...m, ownerType: 'PRODUCT', ownerId: id })));
      if (!mf.ok) return mf;
    }
    if (mediaInputs.length) {
      const m = await createMediaRows(tx, shopId, mediaInputs);
      if (!m.ok) return m;
      await attachMedia(tx, shopId, id, m.value);
    }
    const col = await setProductCollections(tx, shopId, id, input.collectionsToJoin ?? [], input.collectionsToLeave ?? []);
    if (!col.ok) return col;
    await recomputeSmartMembership(tx, shopId, [id]);
    await emit(tx, shopId, 'product', id, 'products/update');
    return okR(row!);
  });
}

export async function deleteProduct(db: Db, shopId: number, id: number): Promise<Result<number>> {
  if (!(await getProduct(db, shopId, id))) return errR(['id'], 'Product does not exist', 'PRODUCT_DOES_NOT_EXIST');
  await db.transaction(async (tx) => {
    const variantIds = (await tx.select({ id: productVariants.id }).from(productVariants).where(eq(productVariants.productId, id))).map((v) => v.id);
    const mediaIds = (await tx.select({ id: productMedia.mediaId }).from(productMedia).where(eq(productMedia.productId, id))).map((m) => m.id);
    await tx.delete(products).where(and(eq(products.shopId, shopId), eq(products.id, id)));
    if (mediaIds.length) await tx.delete(media).where(inArray(media.id, mediaIds));
    await deleteMetafieldsFor(tx, shopId, 'PRODUCT', [id]);
    await deleteMetafieldsFor(tx, shopId, 'PRODUCTVARIANT', variantIds);
    await emit(tx, shopId, 'product', id, 'products/delete');
  });
  return okR(id);
}

export async function duplicateProduct(db: Db, shopId: number, id: number, o: { newTitle: string; newStatus?: string | null; includeImages?: boolean | null }): Promise<Result<Product>> {
  const src = await getProduct(db, shopId, id);
  if (!src) return errR(['productId'], 'Product does not exist', 'PRODUCT_DOES_NOT_EXIST');
  if (!o.newTitle.trim()) return errR(['newTitle'], "Title can't be blank", 'BLANK');
  return txResult(db, async (tx) => {
    const shop = await getShop(tx, shopId);
    const loc = await defaultLocationId(tx, shopId);
    const status = o.newStatus ?? 'DRAFT';
    const handle = await uniqueHandle(o.newTitle, async (h) => !!(await getProductByHandle(tx, shopId, h)));
    const { id: _i, createdAt: _c, updatedAt: _u, ...rest } = src;
    const [copy] = await tx.insert(products).values({ ...rest, handle, title: o.newTitle.trim(), status, publishedAt: status === 'ACTIVE' ? new Date() : null }).returning();
    const opts = await getProductOptions(tx, shopId, id);
    const map = new Map<number, { optionId: number; valueId: number }>();
    for (const op of opts) {
      const [no] = await tx.insert(productOptions).values({ shopId, productId: copy!.id, name: op.name, position: op.position }).returning();
      for (const val of op.values) {
        const [nv] = await tx.insert(productOptionValues).values({ shopId, optionId: no!.id, name: val.name, position: val.position }).returning();
        map.set(val.id, { optionId: no!.id, valueId: nv!.id });
      }
    }
    const variants = await tx.select().from(productVariants).where(eq(productVariants.productId, id)).orderBy(asc(productVariants.position));
    const sel = await getSelectedOptions(tx, shopId, variants.map((v) => v.id));
    for (const v of variants) {
      const [item] = await tx.select().from(inventoryItems).where(eq(inventoryItems.variantId, v.id));
      await insertVariant(tx, shopId, copy!.id, {
        input: { price: v.price, compareAtPrice: v.compareAtPrice, barcode: v.barcode, taxable: v.taxable, taxCode: v.taxCode, inventoryPolicy: v.inventoryPolicy,
          unitPriceMeasurement: v.unitQuantityValue && v.unitReferenceValue ? { quantityValue: v.unitQuantityValue, quantityUnit: v.unitQuantityUnit ?? '', referenceValue: v.unitReferenceValue, referenceUnit: v.unitReferenceUnit ?? '' } : null,
          inventoryItem: item ? { sku: item.sku ?? v.sku, tracked: item.tracked, requiresShipping: item.requiresShipping, cost: item.unitCost, countryCodeOfOrigin: item.countryCodeOfOrigin, harmonizedSystemCode: item.harmonizedSystemCode, weight: item.weightValue != null ? { value: item.weightValue, unit: item.weightUnit as 'KILOGRAMS' } : null } : { sku: v.sku } },
        position: v.position, title: v.title, optionValueIds: (sel.get(v.id) ?? []).map((s) => map.get(s.valueId)!).filter(Boolean),
      }, shop?.weightUnit ?? 'KILOGRAMS', loc);
    }
    if (o.includeImages) {
      const ms = await tx.select().from(productMedia).where(eq(productMedia.productId, id)).orderBy(asc(productMedia.position));
      if (ms.length) await tx.insert(productMedia).values(ms.map((m) => ({ shopId, productId: copy!.id, mediaId: m.mediaId, position: m.position })));
    }
    await recomputeSmartMembership(tx, shopId, [copy!.id]);
    await emit(tx, shopId, 'product', copy!.id, 'products/create');
    return okR(copy!);
  });
}

export async function changeTags(db: Db, shopId: number, id: number, mode: 'add' | 'remove', tags: string[]): Promise<Result<Product>> {
  const cur = await getProduct(db, shopId, id);
  if (!cur) return errR(['id'], 'Product does not exist', 'PRODUCT_DOES_NOT_EXIST');
  const drop = new Set(tags.flatMap((t) => t.split(',')).map((t) => t.trim().toLowerCase()));
  const next = mode === 'add' ? normalizeTags([...cur.tags, ...tags]) : cur.tags.filter((t) => !drop.has(t.toLowerCase()));
  if (next.length > 250) return errR(['tags'], 'Too many tags (maximum is 250)', 'INVALID');
  return txResult(db, async (tx) => {
    const [row] = await tx.update(products).set({ tags: next, updatedAt: new Date() }).where(eq(products.id, id)).returning();
    await recomputeSmartMembership(tx, shopId, [id]);
    await emit(tx, shopId, 'product', id, 'products/update');
    return okR(row!);
  });
}

