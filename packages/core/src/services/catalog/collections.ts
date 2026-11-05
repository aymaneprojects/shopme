import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { currencyExponent } from '@shopme/shopify-compat';
import { collectionProducts, collectionRules, collections, inventoryItems, inventoryLevels, media, productVariants, products, shops } from '../../db/schema';
import type { Db, Executor } from '../../db/client';
import { slugify, uniqueHandle } from '../handle';
import { redirectPathChange } from '../content/redirects';
import { WEIGHT_KG, emit, errR, okR, txResult, type Result } from './common';
import { buildSearch, dateCompare, idTerm, likeCi } from './search';
import { deleteMetafieldsFor, setMetafieldsTx, type MetafieldSetInput } from './metafields';

export type Collection = typeof collections.$inferSelect;
export type CollectionRule = typeof collectionRules.$inferSelect;
type Product = typeof products.$inferSelect;

/* ------------------------------ smart rules ------------------------------ */

const TEXT_COLUMNS = ['TAG', 'TITLE', 'TYPE', 'VENDOR', 'VARIANT_TITLE'];
const NUM_COLUMNS = ['VARIANT_PRICE', 'VARIANT_COMPARE_AT_PRICE', 'VARIANT_INVENTORY', 'VARIANT_WEIGHT'];
const TEXT_RELATIONS = ['EQUALS', 'NOT_EQUALS', 'STARTS_WITH', 'ENDS_WITH', 'CONTAINS', 'NOT_CONTAINS', 'IS_SET', 'IS_NOT_SET'];
const NUM_RELATIONS = ['EQUALS', 'NOT_EQUALS', 'GREATER_THAN', 'LESS_THAN'];

export interface RuleInput { column: string; relation: string; condition: string }
export interface RuleSetInput { appliedDisjunctively: boolean; rules?: RuleInput[] | null }

function validateRules(rs: RuleSetInput): Result<RuleInput[]> {
  const rules = rs.rules ?? [];
  if (!rules.length) return errR(['ruleSet', 'rules'], 'A smart collection needs at least one rule.');
  if (rules.length > 60) return errR(['ruleSet', 'rules'], 'Too many rules (maximum is 60).');
  for (const [i, r] of rules.entries()) {
    const at = ['ruleSet', 'rules', String(i)];
    if (r.column === 'IS_PRICE_REDUCED') {
      if (r.relation !== 'EQUALS' || !['true', 'false'].includes(r.condition)) return errR(at, 'IS_PRICE_REDUCED needs relation EQUALS and condition true or false.');
    } else if (TEXT_COLUMNS.includes(r.column)) {
      if (!TEXT_RELATIONS.includes(r.relation)) return errR([...at, 'relation'], `Relation ${r.relation} is not valid for column ${r.column}.`);
    } else if (NUM_COLUMNS.includes(r.column)) {
      if (!NUM_RELATIONS.includes(r.relation) && !(r.column === 'VARIANT_COMPARE_AT_PRICE' && ['IS_SET', 'IS_NOT_SET'].includes(r.relation))) return errR([...at, 'relation'], `Relation ${r.relation} is not valid for column ${r.column}.`);
      if (!['IS_SET', 'IS_NOT_SET'].includes(r.relation) && !Number.isFinite(Number(r.condition))) return errR([...at, 'condition'], 'Condition must be a number.');
    } else return errR([...at, 'column'], `Column ${r.column} is not supported.`);
    if (!r.condition.trim() && !['IS_SET', 'IS_NOT_SET'].includes(r.relation)) return errR([...at, 'condition'], "Condition can't be blank.");
  }
  return okR(rules);
}

interface EvalVariant { price: number; compareAt: number | null; title: string; qty: number; weightKg: number | null }
interface EvalProduct { id: number; title: string; vendor: string; productType: string; tags: string[]; variants: EvalVariant[] }
interface EvalCtx { exp: number; weightFactor: number }

function textMatch(value: string, relation: string, cond: string): boolean {
  const v = value.toLowerCase(); const c = cond.toLowerCase();
  switch (relation) {
    case 'EQUALS': return v === c;
    case 'NOT_EQUALS': return v !== c;
    case 'STARTS_WITH': return v.startsWith(c);
    case 'ENDS_WITH': return v.endsWith(c);
    case 'CONTAINS': return v.includes(c);
    case 'NOT_CONTAINS': return !v.includes(c);
    case 'IS_SET': return v !== '';
    case 'IS_NOT_SET': return v === '';
    default: return false;
  }
}

function numMatch(value: number | null, relation: string, cond: number): boolean {
  if (relation === 'IS_SET') return value !== null;
  if (relation === 'IS_NOT_SET') return value === null;
  if (value === null) return false;
  switch (relation) {
    case 'EQUALS': return Math.abs(value - cond) < 1e-6;
    case 'NOT_EQUALS': return Math.abs(value - cond) >= 1e-6;
    case 'GREATER_THAN': return value > cond;
    case 'LESS_THAN': return value < cond;
    default: return false;
  }
}

/** A product matches a rule when it matches for any of its variants (tags: any/none, depending on the relation). */
export function ruleMatches(p: EvalProduct, rule: RuleInput, ctx: EvalCtx): boolean {
  const { column: col, relation: rel, condition: cond } = rule;
  const scale = 10 ** ctx.exp;
  switch (col) {
    case 'TITLE': return textMatch(p.title, rel, cond);
    case 'VENDOR': return textMatch(p.vendor, rel, cond);
    case 'TYPE': return textMatch(p.productType, rel, cond);
    case 'TAG':
      if (rel === 'IS_SET') return p.tags.length > 0;
      if (rel === 'IS_NOT_SET') return p.tags.length === 0;
      if (rel === 'NOT_EQUALS' || rel === 'NOT_CONTAINS') return p.tags.every((t) => textMatch(t, rel === 'NOT_EQUALS' ? 'EQUALS' : 'CONTAINS', cond) === false);
      return p.tags.some((t) => textMatch(t, rel, cond));
    case 'VARIANT_TITLE': return p.variants.some((v) => textMatch(v.title, rel, cond));
    case 'VARIANT_PRICE': return p.variants.some((v) => numMatch(v.price / scale, rel, Number(cond)));
    case 'VARIANT_COMPARE_AT_PRICE': return p.variants.some((v) => numMatch(v.compareAt === null ? null : v.compareAt / scale, rel, Number(cond)));
    case 'VARIANT_INVENTORY': return p.variants.some((v) => numMatch(v.qty, rel, Number(cond)));
    case 'VARIANT_WEIGHT': return p.variants.some((v) => numMatch(v.weightKg === null ? null : v.weightKg / ctx.weightFactor, rel, Number(cond)));
    case 'IS_PRICE_REDUCED': return p.variants.some((v) => v.compareAt !== null && v.compareAt > v.price) === (cond === 'true');
    default: return false;
  }
}

/**
 * Re-evaluate smart collection membership. `productIds` limits the products considered (omit for all),
 * `collectionIds` limits the collections. Call after anything that changes what rules look at.
 */
export async function recomputeSmartMembership(db: Executor, shopId: number, productIds?: number[], collectionIds?: number[]): Promise<void> {
  if (productIds && !productIds.length) return;
  const smart = await db.select().from(collections).where(and(eq(collections.shopId, shopId), eq(collections.isSmart, true), collectionIds ? inArray(collections.id, collectionIds) : undefined));
  if (!smart.length) return;
  const rules = await db.select().from(collectionRules).where(and(eq(collectionRules.shopId, shopId), inArray(collectionRules.collectionId, smart.map((c) => c.id))));
  const [shop] = await db.select({ currency: shops.currency, weightUnit: shops.weightUnit }).from(shops).where(eq(shops.id, shopId));
  const ctx: EvalCtx = { exp: currencyExponent(shop?.currency ?? 'USD'), weightFactor: WEIGHT_KG[shop?.weightUnit ?? 'KILOGRAMS'] ?? 1 };

  const prodRows = await db.select().from(products).where(and(eq(products.shopId, shopId), productIds ? inArray(products.id, productIds) : undefined));
  const byId = new Map<number, EvalProduct>(prodRows.map((p) => [p.id, { id: p.id, title: p.title, vendor: p.vendor, productType: p.productType, tags: p.tags, variants: [] }]));
  if (byId.size) {
    const vrows = await db.select({
      productId: productVariants.productId, price: productVariants.price, compareAt: productVariants.compareAtPrice, title: productVariants.title,
      weightValue: inventoryItems.weightValue, weightUnit: inventoryItems.weightUnit, qty: sql<number>`coalesce(sum(${inventoryLevels.available}), 0)::int`,
    }).from(productVariants)
      .leftJoin(inventoryItems, eq(inventoryItems.variantId, productVariants.id))
      .leftJoin(inventoryLevels, and(eq(inventoryLevels.inventoryItemId, inventoryItems.id), eq(inventoryLevels.isActive, true)))
      .where(and(eq(productVariants.shopId, shopId), inArray(productVariants.productId, [...byId.keys()])))
      .groupBy(productVariants.id, inventoryItems.id);
    for (const v of vrows) {
      byId.get(v.productId)?.variants.push({
        price: v.price, compareAt: v.compareAt, title: v.title, qty: v.qty,
        weightKg: v.weightValue === null ? null : v.weightValue * (WEIGHT_KG[v.weightUnit ?? 'KILOGRAMS'] ?? 1),
      });
    }
  }

  for (const c of smart) {
    const cr = rules.filter((r) => r.collectionId === c.id);
    const matches = new Set<number>();
    for (const p of byId.values()) {
      const results = cr.map((r) => ruleMatches(p, { column: r.ruleColumn, relation: r.relation, condition: r.condition }, ctx));
      if (cr.length && (c.rulesAppliedDisjunctively ? results.some(Boolean) : results.every(Boolean))) matches.add(p.id);
    }
    const ids = [...byId.keys()];
    const existing = await db.select({ productId: collectionProducts.productId }).from(collectionProducts).where(and(eq(collectionProducts.collectionId, c.id), inArray(collectionProducts.productId, ids)));
    const have = new Set(existing.map((e) => e.productId));
    const drop = [...have].filter((id) => !matches.has(id));
    const add = [...matches].filter((id) => !have.has(id));
    if (drop.length) await db.delete(collectionProducts).where(and(eq(collectionProducts.collectionId, c.id), inArray(collectionProducts.productId, drop)));
    if (add.length) await db.insert(collectionProducts).values(add.map((productId) => ({ shopId, collectionId: c.id, productId, source: 'rule' }))).onConflictDoNothing();
  }
}

/* ------------------------------ reads ------------------------------ */

export async function getCollection(db: Executor, shopId: number, id: number): Promise<Collection | null> {
  const [r] = await db.select().from(collections).where(and(eq(collections.shopId, shopId), eq(collections.id, id))).limit(1);
  return r ?? null;
}
export async function getCollectionByHandle(db: Executor, shopId: number, handle: string): Promise<Collection | null> {
  const [r] = await db.select().from(collections).where(and(eq(collections.shopId, shopId), eq(collections.handle, handle))).limit(1);
  return r ?? null;
}

const collectionSearch = (q?: string | null) => buildSearch(q, {
  fields: {
    title: (_o, v) => likeCi(collections.title, v), handle: (_o, v) => likeCi(collections.handle, v, true), id: (_o, v) => idTerm(collections.id, v),
    collection_type: (_o, v) => sql`${collections.isSmart} = ${v.toLowerCase() === 'smart'}`,
    updated_at: (o, v) => dateCompare(collections.updatedAt, o, v),
    product_id: (_o, v) => sql`exists (select 1 from ${collectionProducts} cp where cp.collection_id = ${collections.id} and cp.product_id = ${Number(v)})`,
  },
  text: (v) => sql`(${likeCi(collections.title, v)} or ${likeCi(collections.handle, v)})`,
});

export interface ListCollectionsOptions { query?: string | null; sortKey?: 'ID' | 'RELEVANCE' | 'TITLE' | 'UPDATED_AT'; reverse?: boolean; offset: number; limit: number }

export function listCollections(db: Executor, shopId: number, o: ListCollectionsOptions): Promise<Collection[]> {
  const col = o.sortKey === 'TITLE' ? collections.title : o.sortKey === 'UPDATED_AT' ? collections.updatedAt : collections.id;
  return db.select().from(collections).where(and(eq(collections.shopId, shopId), collectionSearch(o.query)))
    .orderBy(o.reverse ? desc(col) : asc(col), o.reverse ? desc(collections.id) : asc(collections.id)).limit(o.limit).offset(o.offset);
}

export async function countCollections(db: Executor, shopId: number, q?: string | null, limit = 10000): Promise<{ count: number; precision: 'EXACT' | 'AT_LEAST' }> {
  const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(collections).where(and(eq(collections.shopId, shopId), collectionSearch(q)));
  const n = r?.n ?? 0;
  return n > limit ? { count: limit, precision: 'AT_LEAST' } : { count: n, precision: 'EXACT' };
}

export async function getCollectionRules(db: Executor, shopId: number, collectionId: number): Promise<CollectionRule[]> {
  return db.select().from(collectionRules).where(and(eq(collectionRules.shopId, shopId), eq(collectionRules.collectionId, collectionId))).orderBy(asc(collectionRules.position), asc(collectionRules.id));
}

export async function countCollectionProducts(db: Executor, shopId: number, collectionId: number): Promise<number> {
  const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(collectionProducts).where(and(eq(collectionProducts.shopId, shopId), eq(collectionProducts.collectionId, collectionId)));
  return r?.n ?? 0;
}

const minPrice = sql`(select min(v.price) from product_variants v where v.product_id = ${products.id})`;

export interface ListCollectionProductsOptions { sortKey?: string | null; reverse?: boolean; offset: number; limit: number }

/** Products of a collection, ordered per `sortKey` (COLLECTION_DEFAULT follows the collection's sort order). */
export async function listCollectionProducts(db: Executor, shopId: number, c: Collection, o: ListCollectionProductsOptions): Promise<Product[]> {
  let key = o.sortKey ?? 'COLLECTION_DEFAULT';
  if (key === 'COLLECTION_DEFAULT' || key === 'RELEVANCE') key = ({ ALPHA_ASC: 'TITLE', ALPHA_DESC: 'TITLE_DESC', CREATED: 'CREATED', CREATED_DESC: 'CREATED_DESC', PRICE_ASC: 'PRICE', PRICE_DESC: 'PRICE_DESC' } as Record<string, string>)[c.sortOrder] ?? 'MANUAL';
  const manual: [unknown, boolean] = [collectionProducts.position, false];
  const [col, descending] = ({
    TITLE: [products.title, false], TITLE_DESC: [products.title, true], CREATED: [products.createdAt, false], CREATED_DESC: [products.createdAt, true], ID: [products.id, false],
    PRICE: [minPrice, false], PRICE_DESC: [minPrice, true],
  } as Record<string, [unknown, boolean]>)[key] ?? manual;
  const dir = descending !== !!o.reverse ? desc : asc;
  const rows = await db.select({ p: products }).from(collectionProducts).innerJoin(products, eq(products.id, collectionProducts.productId))
    .where(and(eq(collectionProducts.shopId, shopId), eq(collectionProducts.collectionId, c.id)))
    .orderBy(dir(col as never), asc(products.id)).limit(o.limit).offset(o.offset);
  return rows.map((r) => r.p);
}

/** Collections a product belongs to. */
export async function listProductCollections(db: Executor, shopId: number, productId: number, o: { query?: string | null; reverse?: boolean; offset: number; limit: number }): Promise<Collection[]> {
  const rows = await db.select({ c: collections }).from(collectionProducts).innerJoin(collections, eq(collections.id, collectionProducts.collectionId))
    .where(and(eq(collectionProducts.shopId, shopId), eq(collectionProducts.productId, productId), collectionSearch(o.query)))
    .orderBy(o.reverse ? desc(collections.id) : asc(collections.id)).limit(o.limit).offset(o.offset);
  return rows.map((r) => r.c);
}

/* ------------------------------ writes ------------------------------ */

export interface CollectionInput {
  title?: string | null; handle?: string | null; descriptionHtml?: string | null; sortOrder?: string | null; templateSuffix?: string | null;
  seo?: { title?: string | null; description?: string | null } | null;
  image?: { src?: string | null; altText?: string | null } | null;
  ruleSet?: RuleSetInput | null; products?: number[] | null; metafields?: MetafieldSetInput[] | null;
}

async function setImage(tx: Executor, shopId: number, image: NonNullable<CollectionInput['image']>): Promise<number | null> {
  if (!image.src) return null;
  const [m] = await tx.insert(media).values({ shopId, type: 'IMAGE', url: image.src, alt: image.altText ?? null }).returning();
  return m!.id;
}

async function replaceRules(tx: Executor, shopId: number, collectionId: number, rules: RuleInput[]) {
  await tx.delete(collectionRules).where(eq(collectionRules.collectionId, collectionId));
  await tx.insert(collectionRules).values(rules.map((r, position) => ({ shopId, collectionId, position, ruleColumn: r.column, relation: r.relation, condition: r.condition })));
}

export async function createCollection(db: Db, shopId: number, input: CollectionInput): Promise<Result<Collection>> {
  const title = input.title?.trim();
  if (!title) return errR(['title'], "Title can't be blank", 'BLANK');
  let rules: RuleInput[] | null = null;
  if (input.ruleSet) { const v = validateRules(input.ruleSet); if (!v.ok) return v; rules = v.value; }
  return txResult(db, async (tx) => {
    const handle = await uniqueHandle(input.handle?.trim() || title, async (h) => !!(await getCollectionByHandle(tx, shopId, h)));
    const imageMediaId = input.image ? await setImage(tx, shopId, input.image) : null;
    const [row] = await tx.insert(collections).values({
      shopId, handle, title, descriptionHtml: input.descriptionHtml ?? '', sortOrder: input.sortOrder ?? 'MANUAL', templateSuffix: input.templateSuffix ?? null,
      seoTitle: input.seo?.title ?? null, seoDescription: input.seo?.description ?? null, imageMediaId, isSmart: !!rules,
      rulesAppliedDisjunctively: input.ruleSet?.appliedDisjunctively ?? false, publishedAt: new Date(),
    }).returning();
    if (rules) { await replaceRules(tx, shopId, row!.id, rules); await recomputeSmartMembership(tx, shopId, undefined, [row!.id]); }
    else if (input.products?.length) {
      const valid = await tx.select({ id: products.id }).from(products).where(and(eq(products.shopId, shopId), inArray(products.id, input.products)));
      if (valid.length) await tx.insert(collectionProducts).values(valid.map((p, position) => ({ shopId, collectionId: row!.id, productId: p.id, position, source: 'manual' })));
    }
    if (input.metafields?.length) {
      const mf = await setMetafieldsTx(tx, shopId, input.metafields.map((m) => ({ ...m, ownerType: 'COLLECTION', ownerId: row!.id })));
      if (!mf.ok) return mf;
    }
    await emit(tx, shopId, 'collection', row!.id, 'collections/create');
    return okR(row!);
  });
}

export async function updateCollection(db: Db, shopId: number, id: number, input: CollectionInput): Promise<Result<Collection>> {
  const cur = await getCollection(db, shopId, id);
  if (!cur) return errR(['id'], 'Collection does not exist', 'NOT_FOUND');
  if (input.title !== undefined && !input.title?.trim()) return errR(['title'], "Title can't be blank", 'BLANK');
  let rules: RuleInput[] | null = null;
  if (input.ruleSet) { const v = validateRules(input.ruleSet); if (!v.ok) return v; rules = v.value; }
  return txResult(db, async (tx) => {
    let handle = cur.handle;
    if (input.handle && slugify(input.handle) !== cur.handle) handle = await uniqueHandle(input.handle, async (h) => h !== cur.handle && !!(await getCollectionByHandle(tx, shopId, h)));
    const imageMediaId = input.image === undefined ? undefined : input.image ? await setImage(tx, shopId, input.image) : null;
    const [row] = await tx.update(collections).set({
      handle, ...(input.title && { title: input.title.trim() }), ...(input.descriptionHtml != null && { descriptionHtml: input.descriptionHtml }),
      ...(input.sortOrder && { sortOrder: input.sortOrder }), ...(input.templateSuffix !== undefined && { templateSuffix: input.templateSuffix }),
      ...(input.seo && { seoTitle: input.seo.title ?? null, seoDescription: input.seo.description ?? null }),
      ...(imageMediaId !== undefined && { imageMediaId }),
      ...(rules && { isSmart: true, rulesAppliedDisjunctively: input.ruleSet!.appliedDisjunctively }),
      updatedAt: new Date(),
    }).where(and(eq(collections.shopId, shopId), eq(collections.id, id))).returning();
    if (handle !== cur.handle) await redirectPathChange(tx, shopId, `/collections/${cur.handle}`, `/collections/${handle}`);
    if (rules) {
      await replaceRules(tx, shopId, id, rules);
      await tx.delete(collectionProducts).where(eq(collectionProducts.collectionId, id));
      await recomputeSmartMembership(tx, shopId, undefined, [id]);
    }
    if (input.metafields?.length) {
      const mf = await setMetafieldsTx(tx, shopId, input.metafields.map((m) => ({ ...m, ownerType: 'COLLECTION', ownerId: id })));
      if (!mf.ok) return mf;
    }
    await emit(tx, shopId, 'collection', id, 'collections/update');
    return okR(row!);
  });
}

export async function deleteCollection(db: Db, shopId: number, id: number): Promise<Result<number>> {
  const cur = await getCollection(db, shopId, id);
  if (!cur) return errR(['id'], 'Collection does not exist', 'NOT_FOUND');
  await db.transaction(async (tx) => {
    await tx.delete(collections).where(and(eq(collections.shopId, shopId), eq(collections.id, id)));
    await deleteMetafieldsFor(tx, shopId, 'COLLECTION', [id]);
    await emit(tx, shopId, 'collection', id, 'collections/delete');
  });
  return okR(id);
}

/** Add products to a manual collection (existing members are skipped). */
export async function addProductsToCollection(db: Executor, shopId: number, collectionId: number, productIds: number[]): Promise<Result<Collection>> {
  const c = await getCollection(db, shopId, collectionId);
  if (!c) return errR(['id'], 'Collection does not exist', 'NOT_FOUND');
  if (c.isSmart) return errR(['id'], "Can't manually add products to a smart collection");
  const unique = [...new Set(productIds)];
  const found = await db.select({ id: products.id }).from(products).where(and(eq(products.shopId, shopId), inArray(products.id, unique)));
  if (found.length !== unique.length) return errR(['productIds'], 'Error adding products to collection: product does not exist');
  const existing = new Set((await db.select({ id: collectionProducts.productId }).from(collectionProducts).where(eq(collectionProducts.collectionId, collectionId))).map((r) => r.id));
  const fresh = unique.filter((id) => !existing.has(id));
  if (fresh.length) {
    const [m] = await db.select({ max: sql<number>`coalesce(max(${collectionProducts.position}), -1)::int` }).from(collectionProducts).where(eq(collectionProducts.collectionId, collectionId));
    await db.insert(collectionProducts).values(fresh.map((productId, i) => ({ shopId, collectionId, productId, position: (m?.max ?? -1) + 1 + i, source: 'manual' })));
    await db.update(collections).set({ updatedAt: new Date() }).where(eq(collections.id, collectionId));
    await emit(db, shopId, 'collection', collectionId, 'collections/update', { added: fresh });
  }
  return okR((await getCollection(db, shopId, collectionId))!);
}

export async function removeProductsFromCollection(db: Executor, shopId: number, collectionId: number, productIds: number[]): Promise<Result<Collection>> {
  const c = await getCollection(db, shopId, collectionId);
  if (!c) return errR(['id'], 'Collection does not exist', 'NOT_FOUND');
  if (c.isSmart) return errR(['id'], "Can't manually remove products from a smart collection");
  await db.delete(collectionProducts).where(and(eq(collectionProducts.collectionId, collectionId), inArray(collectionProducts.productId, productIds)));
  await db.update(collections).set({ updatedAt: new Date() }).where(eq(collections.id, collectionId));
  await emit(db, shopId, 'collection', collectionId, 'collections/update', { removed: productIds });
  return okR(c);
}

/** Add a product to manual collections / remove it from them (used by productCreate/Update `collectionsToJoin/Leave`). */
export async function setProductCollections(db: Executor, shopId: number, productId: number, join: number[] = [], leave: number[] = []): Promise<Result<null>> {
  for (const id of join) {
    const r = await addProductsToCollection(db, shopId, id, [productId]);
    if (!r.ok) return { ok: false, errors: r.errors.map((e) => ({ ...e, field: ['collectionsToJoin'] })) };
  }
  for (const id of leave) {
    const r = await removeProductsFromCollection(db, shopId, id, [productId]);
    if (!r.ok) return { ok: false, errors: r.errors.map((e) => ({ ...e, field: ['collectionsToLeave'] })) };
  }
  return okR(null);
}

