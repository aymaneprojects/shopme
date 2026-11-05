import { and, eq, sql, type SQL } from 'drizzle-orm';
import { articles, blogs, pages, products } from '../../db/schema';
import type { Db, Executor } from '../../db/client';
import { productListedOnStorefront } from './publications';

/**
 * Storefront search: PostgreSQL full-text (`tsvector`, `simple` config, GIN index `products_fts_idx`) ranked by field weight
 * (title > vendor/type/tags > description) plus ILIKE for substrings and SKUs. Typo tolerance: when nothing matches, each term is
 * replaced by the closest word of the shop's vocabulary (pg_trgm similarity when the extension is available, else edit distance).
 */
export interface SearchOptions { prefix?: 'last' | 'none'; limit?: number }
export interface ProductSearch { ids: number[]; corrected: string | null }

let trigram = false;
/** Try to enable pg_trgm (PostgreSQL only; PGlite ships without it). Safe to call repeatedly; failures leave the fallback in place. */
export async function ensureSearchExtensions(db: Db): Promise<boolean> {
  try {
    await db.execute(sql`create extension if not exists pg_trgm`);
    trigram = rowsOf(await db.execute(sql`select 1 as ok from pg_extension where extname = 'pg_trgm'`)).length > 0;
  } catch { trigram = false; }
  return trigram;
}
export const hasTrigram = () => trigram;

export const tokenize = (q: string): string[] => q.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean).slice(0, 10);
const esc = (v: string) => v.replace(/[\\%_]/g, (c) => `\\${c}`);

/** Same expression as the migration's GIN index. */
const plainVec = sql`to_tsvector('simple', coalesce(${products.title}, '') || ' ' || coalesce(${products.vendor}, '') || ' ' || coalesce(${products.productType}, '') || ' ' || coalesce(${products.descriptionHtml}, ''))`;
const tagsVec = sql`to_tsvector('simple', array_to_string(${products.tags}, ' '))`;
const rankVec = sql`(setweight(to_tsvector('simple', coalesce(${products.title}, '')), 'A') || setweight(to_tsvector('simple', coalesce(${products.vendor}, '') || ' ' || coalesce(${products.productType}, '')), 'B') || setweight(${tagsVec}, 'B') || setweight(to_tsvector('simple', coalesce(${products.descriptionHtml}, '')), 'C'))`;

const tsQuery = (tokens: string[], prefix: 'last' | 'none') =>
  sql`to_tsquery('simple', ${tokens.map((t, i) => (prefix === 'last' && i === tokens.length - 1 ? `${t}:*` : t)).join(' & ')})`;

async function rankedProducts(db: Executor, shopId: number, tokens: string[], raw: string, prefix: 'last' | 'none', limit: number): Promise<number[]> {
  if (!tokens.length) return [];
  const q = tsQuery(tokens, prefix);
  const phrase = raw.trim().toLowerCase();
  // Title phrase at the start of a word (prefix matching only): "espres" finds "House Espresso Blend", "ssion" does not.
  const wordStart = prefix === 'last' ? sql`(lower(${products.title}) like ${`${esc(phrase)}%`} or lower(${products.title}) like ${`% ${esc(phrase)}%`})` : sql`false`;
  const rows = await db.select({ id: products.id }).from(products).where(and(
    eq(products.shopId, shopId), productListedOnStorefront,
    sql`(${plainVec} @@ ${q} or ${tagsVec} @@ ${q} or ${wordStart}
      or exists (select 1 from product_variants v where v.product_id = ${products.id} and lower(v.sku) = ${phrase}))`,
  )).orderBy(sql`(ts_rank(${rankVec}, ${q}) + case when ${wordStart} then 1 else 0 end + case when lower(${products.title}) = ${phrase} then 2 else 0 end) desc`, products.id).limit(limit);
  return rows.map((r) => r.id);
}

/* ------------------------------ typo tolerance ------------------------------ */

const rowsOf = <T>(r: unknown): T[] => ((r as { rows?: T[] }).rows ?? (r as T[]));
const vocabSql = (shopId: number) => sql`select distinct lower(regexp_split_to_table(coalesce(title,'') || ' ' || coalesce(vendor,'') || ' ' || coalesce(product_type,'') || ' ' || array_to_string(tags, ' '), '[^[:alnum:]]+')) as w from products where shop_id = ${shopId} and status = 'ACTIVE' and online_store_published_at is not null and online_store_published_at <= now()`;

const vocabCache = new Map<number, { at: number; words: string[] }>();
/** Distinct lowercase words of titles, vendors, types and tags of active products (cached for 30s). */
export async function vocabulary(db: Executor, shopId: number): Promise<string[]> {
  const hit = vocabCache.get(shopId);
  if (hit && Date.now() - hit.at < 30_000) return hit.words;
  const words = rowsOf<{ w: string }>(await db.execute(sql`select w from (${vocabSql(shopId)}) v where length(w) > 1 limit 20000`)).map((r) => r.w);
  vocabCache.set(shopId, { at: Date.now(), words });
  return words;
}

/** Optimal string alignment distance (insert, delete, substitute, transpose). */
export function editDistance(a: string, b: string): number {
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array<number>(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0]![j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) {
    d[i]![j] = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i]![j] = Math.min(d[i]![j]!, d[i - 2]![j - 2]! + 1);
  }
  return d[a.length]![b.length]!;
}

async function closestWord(db: Executor, shopId: number, token: string, words: string[]): Promise<string | null> {
  if (words.includes(token) || token.length < 3) return token;
  if (trigram) {
    const row = rowsOf<{ w: string }>(await db.execute(sql`select w from (${vocabSql(shopId)}) v where similarity(w, ${token}) > 0.35 order by similarity(w, ${token}) desc limit 1`))[0];
    return row?.w ?? null;
  }
  const max = token.length <= 4 ? 1 : 2;
  let best: string | null = null, bestD = max + 1;
  for (const w of words) {
    if (Math.abs(w.length - token.length) > max) continue;
    const dist = editDistance(token, w);
    if (dist < bestD) { best = w; bestD = dist; }
  }
  return best;
}

/** Ranked ids of active products matching `q`; falls back to the nearest spelling when nothing matches. */
export async function searchProducts(db: Executor, shopId: number, q: string, o: SearchOptions = {}): Promise<ProductSearch> {
  const prefix = o.prefix ?? 'last';
  const limit = o.limit ?? 1000;
  const tokens = tokenize(q);
  const ids = await rankedProducts(db, shopId, tokens, q, prefix, limit);
  if (ids.length || !tokens.length) return { ids, corrected: null };
  const words = await vocabulary(db, shopId);
  const fixed = await Promise.all(tokens.map((t) => closestWord(db, shopId, t, words)));
  if (fixed.some((f) => !f) || fixed.every((f, i) => f === tokens[i])) return { ids: [], corrected: null };
  const corrected = fixed.join(' ');
  return { ids: await rankedProducts(db, shopId, fixed as string[], corrected, 'none', limit), corrected };
}

/* ------------------------------ pages, articles, query suggestions ------------------------------ */

const textMatch = (cols: SQL[], tokens: string[]): SQL =>
  sql.join(tokens.map((t) => sql`(${sql.join(cols.map((c) => sql`${c} ilike ${`%${esc(t)}%`}`), sql` or `)})`), sql` and `);

export async function searchPages(db: Executor, shopId: number, q: string, limit = 10) {
  const tokens = tokenize(q);
  if (!tokens.length) return [];
  return db.select().from(pages).where(and(eq(pages.shopId, shopId), sql`${pages.publishedAt} is not null and ${pages.publishedAt} <= now()`, sql`(${textMatch([sql`${pages.title}`, sql`${pages.bodyHtml}`], tokens)})`))
    .orderBy(sql`(lower(${pages.title}) like ${`%${esc(q.trim().toLowerCase())}%`}) desc`, pages.id).limit(limit);
}

export async function searchArticles(db: Executor, shopId: number, q: string, limit = 10) {
  const tokens = tokenize(q);
  if (!tokens.length) return [];
  return db.select({ a: articles, blogHandle: blogs.handle }).from(articles).innerJoin(blogs, eq(blogs.id, articles.blogId))
    .where(and(eq(articles.shopId, shopId), sql`${articles.publishedAt} is not null and ${articles.publishedAt} <= now()`, sql`(${textMatch([sql`${articles.title}`, sql`${articles.bodyHtml}`, sql`array_to_string(${articles.tags}, ' ')`, sql`coalesce(${articles.author}, '')`], tokens)})`))
    .orderBy(sql`(lower(${articles.title}) like ${`%${esc(q.trim().toLowerCase())}%`}) desc`, sql`${articles.publishedAt} desc`).limit(limit);
}

/** Search-as-you-type suggestions: `<earlier terms> <vocabulary word starting with the last term>`; a spelling fix when nothing completes. */
export async function suggestQueries(db: Executor, shopId: number, q: string, limit = 4): Promise<string[]> {
  const tokens = tokenize(q);
  if (!tokens.length) return [];
  const words = await vocabulary(db, shopId);
  const head = tokens.slice(0, -1).join(' ');
  const last = tokens.at(-1)!;
  const out = [...new Set(words.filter((w) => w.startsWith(last) && w !== last && w.length > last.length).sort((a, b) => a.length - b.length || a.localeCompare(b)))].slice(0, limit).map((w) => (head ? `${head} ${w}` : w));
  if (!out.length) {
    const fixed = await closestWord(db, shopId, last, words);
    if (fixed && fixed !== last) out.push(head ? `${head} ${fixed}` : fixed);
  }
  return out;
}
