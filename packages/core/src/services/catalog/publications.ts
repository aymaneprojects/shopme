import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { catalogProducts, catalogs, collections, products, publications, resourcePublications } from '../../db/schema';
import type { Executor } from '../../db/client';
import { slugify } from '../handle';
import { errR, okR, type Result } from './common';

export type Publication = typeof publications.$inferSelect;
export type PublishableType = 'PRODUCT' | 'COLLECTION';
export const ONLINE_STORE_HANDLE = 'online-store';

/** One publication of a resource. A future `publishedAt` means it is scheduled. */
export interface ResourcePublication { publicationId: number; publishedAt: Date }

/** SQL: the product is on the Online Store channel right now (published, not scheduled). Storefront queries must include it. */
export const productOnOnlineStore = sql`(${products.onlineStorePublishedAt} is not null and ${products.onlineStorePublishedAt} <= now())`;
/** SQL: product visible in storefront listings and search (active and on the Online Store). Unlisted products are reachable by URL only. */
export const productListedOnStorefront = sql`(${products.status} = 'ACTIVE' and ${productOnOnlineStore})`;
/** SQL: product reachable by URL on the storefront. */
export const productReachableOnStorefront = sql`(${products.status} in ('ACTIVE', 'UNLISTED') and ${productOnOnlineStore})`;

export async function ensureOnlineStore(db: Executor, shopId: number): Promise<Publication> {
  const [row] = await db.insert(publications).values({ shopId, name: 'Online Store', handle: ONLINE_STORE_HANDLE, kind: 'ONLINE_STORE', position: 0 })
    .onConflictDoNothing().returning();
  if (row) return row;
  const [cur] = await db.select().from(publications).where(and(eq(publications.shopId, shopId), eq(publications.handle, ONLINE_STORE_HANDLE))).limit(1);
  return cur!;
}

export async function listPublications(db: Executor, shopId: number): Promise<Publication[]> {
  await ensureOnlineStore(db, shopId);
  return db.select().from(publications).where(eq(publications.shopId, shopId)).orderBy(asc(publications.position), asc(publications.id));
}

export async function getPublication(db: Executor, shopId: number, id: number): Promise<Publication | null> {
  await ensureOnlineStore(db, shopId);
  const [r] = await db.select().from(publications).where(and(eq(publications.shopId, shopId), eq(publications.id, id))).limit(1);
  return r ?? null;
}

/** Add a sales channel (the Online Store always exists; other channels come from integrations). */
export async function createPublication(db: Executor, shopId: number, name: string): Promise<Result<Publication>> {
  const title = name.trim();
  if (!title) return errR(['name'], "Name can't be blank", 'BLANK');
  const handle = slugify(title);
  const [dupe] = await db.select({ id: publications.id }).from(publications).where(and(eq(publications.shopId, shopId), eq(publications.handle, handle))).limit(1);
  if (dupe) return errR(['name'], 'Name has already been taken', 'TAKEN');
  const [{ n } = { n: 0 }] = await db.select({ n: sql<number>`count(*)::int` }).from(publications).where(eq(publications.shopId, shopId));
  const [row] = await db.insert(publications).values({ shopId, name: title, handle, kind: 'CUSTOM', position: n }).returning();
  return okR(row!);
}

/** Every publication of the given resources, Online Store included. */
export async function getResourcePublications(db: Executor, shopId: number, type: PublishableType, ids: number[]): Promise<Map<number, ResourcePublication[]>> {
  const out = new Map<number, ResourcePublication[]>(ids.map((i) => [i, []]));
  if (!ids.length) return out;
  const store = await ensureOnlineStore(db, shopId);
  const own = type === 'PRODUCT'
    ? (await db.select({ id: products.id, at: products.onlineStorePublishedAt }).from(products).where(and(eq(products.shopId, shopId), inArray(products.id, ids))))
    : (await db.select({ id: collections.id, at: collections.publishedAt }).from(collections).where(and(eq(collections.shopId, shopId), inArray(collections.id, ids))));
  for (const r of own) if (r.at) out.get(r.id)!.push({ publicationId: store.id, publishedAt: r.at });
  const rows = await db.select().from(resourcePublications).where(and(eq(resourcePublications.shopId, shopId), eq(resourcePublications.resourceType, type), inArray(resourcePublications.resourceId, ids)));
  for (const r of rows) out.get(r.resourceId)?.push({ publicationId: r.publicationId, publishedAt: r.publishedAt });
  return out;
}

export const isLive = (p: ResourcePublication, now = new Date()) => p.publishedAt <= now;

async function resourceExists(db: Executor, shopId: number, type: PublishableType, id: number): Promise<boolean> {
  const [r] = type === 'PRODUCT'
    ? await db.select({ id: products.id }).from(products).where(and(eq(products.shopId, shopId), eq(products.id, id))).limit(1)
    : await db.select({ id: collections.id }).from(collections).where(and(eq(collections.shopId, shopId), eq(collections.id, id))).limit(1);
  return !!r;
}

/** Publish a resource to a channel now, or at `publishDate` (future dates schedule it). Already published resources keep their date unless one is given. */
export async function publishResource(db: Executor, shopId: number, type: PublishableType, id: number, publicationId: number, publishDate?: Date | null): Promise<Result<null>> {
  const pub = await getPublication(db, shopId, publicationId);
  if (!pub) return errR(['input', 'publicationId'], 'Publication does not exist', 'NOT_FOUND');
  if (!(await resourceExists(db, shopId, type, id))) return errR(['id'], 'Publishable does not exist', 'NOT_FOUND');
  const when = publishDate ?? new Date();
  if (pub.kind === 'ONLINE_STORE') {
    if (type === 'PRODUCT') {
      const [cur] = await db.select({ at: products.onlineStorePublishedAt }).from(products).where(eq(products.id, id));
      await db.update(products).set({ onlineStorePublishedAt: publishDate ? when : cur?.at && cur.at <= new Date() ? cur.at : when, updatedAt: new Date() }).where(and(eq(products.shopId, shopId), eq(products.id, id)));
    } else {
      const [cur] = await db.select({ at: collections.publishedAt }).from(collections).where(eq(collections.id, id));
      await db.update(collections).set({ publishedAt: publishDate ? when : cur?.at && cur.at <= new Date() ? cur.at : when, updatedAt: new Date() }).where(and(eq(collections.shopId, shopId), eq(collections.id, id)));
    }
    return okR(null);
  }
  await db.insert(resourcePublications).values({ shopId, publicationId, resourceType: type, resourceId: id, publishedAt: when })
    .onConflictDoUpdate({ target: [resourcePublications.publicationId, resourcePublications.resourceType, resourcePublications.resourceId], set: { publishedAt: when } });
  return okR(null);
}

export async function unpublishResource(db: Executor, shopId: number, type: PublishableType, id: number, publicationId: number): Promise<Result<null>> {
  const pub = await getPublication(db, shopId, publicationId);
  if (!pub) return errR(['input', 'publicationId'], 'Publication does not exist', 'NOT_FOUND');
  if (!(await resourceExists(db, shopId, type, id))) return errR(['id'], 'Publishable does not exist', 'NOT_FOUND');
  if (pub.kind === 'ONLINE_STORE') {
    if (type === 'PRODUCT') await db.update(products).set({ onlineStorePublishedAt: null, updatedAt: new Date() }).where(and(eq(products.shopId, shopId), eq(products.id, id)));
    else await db.update(collections).set({ publishedAt: null, updatedAt: new Date() }).where(and(eq(collections.shopId, shopId), eq(collections.id, id)));
    return okR(null);
  }
  await db.delete(resourcePublications).where(and(eq(resourcePublications.publicationId, publicationId), eq(resourcePublications.resourceType, type), eq(resourcePublications.resourceId, id)));
  return okR(null);
}

/** Number of products / collections live on each channel (scheduled ones excluded). */
export async function publicationCounts(db: Executor, shopId: number): Promise<Map<number, { products: number; collections: number }>> {
  const store = await ensureOnlineStore(db, shopId);
  const out = new Map<number, { products: number; collections: number }>();
  const [p] = await db.select({ n: sql<number>`count(*)::int` }).from(products).where(and(eq(products.shopId, shopId), sql`${productOnOnlineStore}`));
  const [c] = await db.select({ n: sql<number>`count(*)::int` }).from(collections).where(and(eq(collections.shopId, shopId), sql`${collections.publishedAt} <= now()`));
  out.set(store.id, { products: p?.n ?? 0, collections: c?.n ?? 0 });
  const rows = await db.select({ pid: resourcePublications.publicationId, type: resourcePublications.resourceType, n: sql<number>`count(*)::int` }).from(resourcePublications)
    .where(and(eq(resourcePublications.shopId, shopId), sql`${resourcePublications.publishedAt} <= now()`)).groupBy(resourcePublications.publicationId, resourcePublications.resourceType);
  for (const r of rows) {
    const cur = out.get(r.pid) ?? { products: 0, collections: 0 };
    if (r.type === 'PRODUCT') cur.products = r.n; else cur.collections = r.n;
    out.set(r.pid, cur);
  }
  return out;
}

/* ------------------------------ catalog membership ------------------------------ */

export type CatalogRef = { id: number; title: string; status: string };

export async function getProductCatalogs(db: Executor, shopId: number, productIds: number[]): Promise<Map<number, CatalogRef[]>> {
  const out = new Map<number, CatalogRef[]>(productIds.map((i) => [i, []]));
  if (!productIds.length) return out;
  const rows = await db.select({ productId: catalogProducts.productId, id: catalogs.id, title: catalogs.title, status: catalogs.status }).from(catalogProducts)
    .innerJoin(catalogs, eq(catalogs.id, catalogProducts.catalogId)).where(and(eq(catalogProducts.shopId, shopId), inArray(catalogProducts.productId, productIds))).orderBy(asc(catalogs.position), asc(catalogs.id));
  for (const r of rows) out.get(r.productId)!.push({ id: r.id, title: r.title, status: r.status });
  return out;
}

/** Add products to / remove them from catalogs. Unknown ids are skipped. */
export async function updateCatalogProducts(db: Executor, shopId: number, o: { productIds: number[]; include?: number[]; exclude?: number[] }): Promise<Result<{ added: number; removed: number }>> {
  const pids = o.productIds;
  if (!pids.length) return errR(['productIds'], 'Select at least one product', 'INVALID');
  const validP = (await db.select({ id: products.id }).from(products).where(and(eq(products.shopId, shopId), inArray(products.id, pids)))).map((r) => r.id);
  const all = [...(o.include ?? []), ...(o.exclude ?? [])];
  const validC = new Set(all.length ? (await db.select({ id: catalogs.id }).from(catalogs).where(and(eq(catalogs.shopId, shopId), inArray(catalogs.id, all)))).map((r) => r.id) : []);
  if (all.some((c) => !validC.has(c))) return errR(['catalogIds'], 'Catalog does not exist', 'NOT_FOUND');
  let added = 0; let removed = 0;
  for (const c of o.include ?? []) {
    if (!validP.length) break;
    const r = await db.insert(catalogProducts).values(validP.map((productId) => ({ shopId, catalogId: c, productId }))).onConflictDoNothing().returning({ p: catalogProducts.productId });
    added += r.length;
  }
  for (const c of o.exclude ?? []) {
    const r = await db.delete(catalogProducts).where(and(eq(catalogProducts.catalogId, c), inArray(catalogProducts.productId, pids))).returning({ p: catalogProducts.productId });
    removed += r.length;
  }
  return okR({ added, removed });
}

export async function countProductCatalogs(db: Executor, shopId: number, productIds: number[]): Promise<Map<number, number>> {
  const m = await getProductCatalogs(db, shopId, productIds);
  return new Map([...m].map(([k, v]) => [k, v.length]));
}
