import { and, asc, eq, inArray, ne, sql } from 'drizzle-orm';
import { articles, collections, menuItems, menus, pages, products, themeFiles, themes, translations } from '../db/schema';
import type { Db, Executor } from '../db/client';
import { errR, okR, type Result } from './catalog/common';
import { sha256 } from './crypto';
import { listShopLocales } from './locales';

export const TRANSLATABLE_TYPES = ['PRODUCT', 'COLLECTION', 'PAGE', 'ARTICLE', 'MENU', 'LINK', 'ONLINE_STORE_THEME'] as const;
export type TranslatableType = (typeof TRANSLATABLE_TYPES)[number];
export const isTranslatableType = (v: string): v is TranslatableType => (TRANSLATABLE_TYPES as readonly string[]).includes(v);

export type ContentKind = 'SINGLE_LINE_TEXT_FIELD' | 'MULTI_LINE_TEXT_FIELD' | 'HTML';
export interface TranslatableField { key: string; value: string; digest: string; type: ContentKind }
export interface TranslatableResourceRow { type: TranslatableType; id: string; content: TranslatableField[] }
export interface TranslationRow { key: string; locale: string; value: string; outdated: boolean; updatedAt: Date }

export const digestOf = (v: string) => sha256(v);
const field = (key: string, value: string | null | undefined, type: ContentKind = 'SINGLE_LINE_TEXT_FIELD'): TranslatableField | null =>
  value ? { key, value, digest: digestOf(value), type } : null;
const compact = (f: (TranslatableField | null)[]) => f.filter((x): x is TranslatableField => !!x);

/** Flatten the nested strings of a theme locale file to `a.b.c` keys. */
export function flattenStrings(tree: unknown, prefix = '', out: Record<string, string> = {}): Record<string, string> {
  if (typeof tree === 'string') { if (prefix) out[prefix] = tree; }
  else if (tree && typeof tree === 'object') for (const [k, v] of Object.entries(tree)) flattenStrings(v, prefix ? `${prefix}.${k}` : k, out);
  return out;
}
/** Parse a theme locale JSON file (may contain `/* *\/` comments, as theme editors write them). */
export function parseLocaleJson(body: string | null): Record<string, unknown> {
  if (!body) return {};
  try { return JSON.parse(body.replace(/^\s*\/\*[\s\S]*?\*\/\s*/, '')) as Record<string, unknown>; } catch { return {}; }
}

/** Translatable content of `type` resources, `ids` restricting to some (numeric ids as strings). */
async function sources(db: Executor, shopId: number, type: TranslatableType, o: { ids?: string[]; offset?: number; limit?: number }): Promise<TranslatableResourceRow[]> {
  const nums = o.ids?.map(Number).filter(Number.isSafeInteger);
  if (o.ids && !nums!.length) return [];
  const lim = o.limit ?? 1000, off = o.offset ?? 0;
  const row = (id: number, content: (TranslatableField | null)[]): TranslatableResourceRow => ({ type, id: String(id), content: compact(content) });
  switch (type) {
    case 'PRODUCT': {
      const rows = await db.select().from(products).where(and(eq(products.shopId, shopId), nums ? inArray(products.id, nums) : undefined)).orderBy(asc(products.id)).limit(lim).offset(off);
      return rows.map((r) => row(r.id, [field('title', r.title), field('body_html', r.descriptionHtml, 'HTML'), field('product_type', r.productType), field('meta_title', r.seoTitle), field('meta_description', r.seoDescription, 'MULTI_LINE_TEXT_FIELD')]));
    }
    case 'COLLECTION': {
      const rows = await db.select().from(collections).where(and(eq(collections.shopId, shopId), nums ? inArray(collections.id, nums) : undefined)).orderBy(asc(collections.id)).limit(lim).offset(off);
      return rows.map((r) => row(r.id, [field('title', r.title), field('body_html', r.descriptionHtml, 'HTML'), field('meta_title', r.seoTitle), field('meta_description', r.seoDescription, 'MULTI_LINE_TEXT_FIELD')]));
    }
    case 'PAGE': {
      const rows = await db.select().from(pages).where(and(eq(pages.shopId, shopId), nums ? inArray(pages.id, nums) : undefined)).orderBy(asc(pages.id)).limit(lim).offset(off);
      return rows.map((r) => row(r.id, [field('title', r.title), field('body_html', r.bodyHtml, 'HTML')]));
    }
    case 'ARTICLE': {
      const rows = await db.select().from(articles).where(and(eq(articles.shopId, shopId), nums ? inArray(articles.id, nums) : undefined)).orderBy(asc(articles.id)).limit(lim).offset(off);
      return rows.map((r) => row(r.id, [field('title', r.title), field('body_html', r.bodyHtml, 'HTML'), field('summary_html', r.summaryHtml, 'HTML')]));
    }
    case 'MENU': {
      const rows = await db.select().from(menus).where(and(eq(menus.shopId, shopId), nums ? inArray(menus.id, nums) : undefined)).orderBy(asc(menus.id)).limit(lim).offset(off);
      return rows.map((r) => row(r.id, [field('title', r.title)]));
    }
    case 'LINK': {
      const rows = await db.select().from(menuItems).where(and(eq(menuItems.shopId, shopId), nums ? inArray(menuItems.id, nums) : undefined)).orderBy(asc(menuItems.id)).limit(lim).offset(off);
      return rows.map((r) => row(r.id, [field('title', r.title)]));
    }
    case 'ONLINE_STORE_THEME': {
      const list = await db.select({ id: themes.id }).from(themes).where(and(eq(themes.shopId, shopId), nums ? inArray(themes.id, nums) : eq(themes.role, 'MAIN'))).orderBy(asc(themes.id)).limit(lim).offset(off);
      const out: TranslatableResourceRow[] = [];
      for (const t of list) {
        const files = await db.select({ path: themeFiles.path, body: themeFiles.body }).from(themeFiles)
          .where(and(eq(themeFiles.themeId, t.id), sql`${themeFiles.path} ~ '^locales/[A-Za-z-]+\\.default\\.json$'`)).limit(1);
        const flat = flattenStrings(parseLocaleJson(files[0]?.body ?? null));
        out.push(row(t.id, Object.entries(flat).map(([k, v]) => field(k, v, v.includes('<') ? 'HTML' : 'SINGLE_LINE_TEXT_FIELD'))));
      }
      return out;
    }
  }
}

export async function countTranslatable(db: Executor, shopId: number, type: TranslatableType): Promise<number> {
  const t = { PRODUCT: products, COLLECTION: collections, PAGE: pages, ARTICLE: articles, MENU: menus, LINK: menuItems }[type as 'PRODUCT'];
  if (!t) return (await sources(db, shopId, type, {})).length;
  const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(t).where(eq(t.shopId, shopId));
  return r?.n ?? 0;
}
export const listTranslatableResources = (db: Executor, shopId: number, type: TranslatableType, offset: number, limit: number) => sources(db, shopId, type, { offset, limit });
export async function getTranslatableResource(db: Executor, shopId: number, type: TranslatableType, id: string): Promise<TranslatableResourceRow | null> {
  return (await sources(db, shopId, type, { ids: [id] }))[0] ?? null;
}

/** Stored translations of one resource (optionally one locale), with the `outdated` flag computed against the current source. */
export async function getTranslations(db: Executor, shopId: number, type: TranslatableType, id: string, locale?: string): Promise<TranslationRow[]> {
  const rows = await db.select().from(translations).where(and(eq(translations.shopId, shopId), eq(translations.resourceType, type), eq(translations.resourceId, id), locale ? eq(translations.locale, locale) : undefined)).orderBy(asc(translations.key));
  if (!rows.length) return [];
  const src = new Map((await getTranslatableResource(db, shopId, type, id))?.content.map((c) => [c.key, c.digest]) ?? []);
  return rows.map((r) => ({ key: r.key, locale: r.locale, value: r.value, outdated: src.get(r.key) !== r.digest, updatedAt: r.updatedAt }));
}

export interface TranslationInput { locale: string; key: string; value: string; translatableContentDigest: string }
const MAX_KEYS = 5000;

/** Register translations (upsert). Locale must be a non-primary locale of the shop; digest must match the current source value. */
export async function registerTranslations(db: Db, shopId: number, type: TranslatableType, id: string, inputs: TranslationInput[]): Promise<Result<TranslationRow[]>> {
  const res = await getTranslatableResource(db, shopId, type, id);
  if (!res) return errR(['resourceId'], 'Resource does not exist', 'RESOURCE_NOT_FOUND');
  if (inputs.length > MAX_KEYS) return errR(['translations'], 'Too many keys', 'TOO_MANY_KEYS_FOR_RESOURCE');
  const locales = new Set((await listShopLocales(db, shopId)).filter((l) => !l.primary).map((l) => l.locale));
  const content = new Map(res.content.map((c) => [c.key, c]));
  const errors: { field: string[]; message: string; code: string }[] = [];
  inputs.forEach((t, i) => {
    const at = (f: string) => ['translations', String(i), f];
    if (!locales.has(t.locale)) errors.push({ field: at('locale'), message: 'Locale is not enabled for this shop', code: 'INVALID_LOCALE_FOR_SHOP' });
    const c = content.get(t.key);
    if (!c) errors.push({ field: at('key'), message: `Key ${t.key} is not translatable on this resource`, code: 'INVALID_KEY_FOR_MODEL' });
    else if (c.digest !== t.translatableContentDigest) errors.push({ field: at('translatableContentDigest'), message: 'Translatable content hash is invalid', code: 'INVALID_TRANSLATABLE_CONTENT' });
    if (!t.value.trim()) errors.push({ field: at('value'), message: "Value can't be blank", code: 'BLANK' });
  });
  if (errors.length) return { ok: false, errors };
  await db.transaction(async (tx) => {
    for (const t of inputs) {
      await tx.insert(translations).values({ shopId, resourceType: type, resourceId: id, key: t.key, locale: t.locale, value: t.value, digest: t.translatableContentDigest })
        .onConflictDoUpdate({ target: [translations.shopId, translations.resourceType, translations.resourceId, translations.key, translations.locale], set: { value: t.value, digest: t.translatableContentDigest, updatedAt: new Date() } });
    }
  });
  return okR(await getTranslations(db, shopId, type, id).then((r) => r.filter((x) => inputs.some((i) => i.key === x.key && i.locale === x.locale))));
}

export async function removeTranslations(db: Db, shopId: number, type: TranslatableType, id: string, keys: string[], locales: string[]): Promise<Result<TranslationRow[]>> {
  if (!(await getTranslatableResource(db, shopId, type, id))) return errR(['resourceId'], 'Resource does not exist', 'RESOURCE_NOT_FOUND');
  const where = and(eq(translations.shopId, shopId), eq(translations.resourceType, type), eq(translations.resourceId, id), inArray(translations.key, keys), locales.length ? inArray(translations.locale, locales) : undefined);
  const gone = await db.delete(translations).where(where).returning();
  return okR(gone.map((r) => ({ key: r.key, locale: r.locale, value: r.value, outdated: false, updatedAt: r.updatedAt })));
}

// ---- storefront ------------------------------------------------------------------------------------------------------------------------

/** All content translations of one locale (everything but theme strings), looked up synchronously while rendering. */
export interface Translator { locale: string; active: boolean; get(type: TranslatableType, id: number | string, key: string): string | undefined; text(type: TranslatableType, id: number | string, key: string, fallback: string): string }
export const NO_TRANSLATOR: Translator = { locale: '', active: false, get: () => undefined, text: (_t, _i, _k, f) => f };

export async function loadTranslator(db: Executor, shopId: number, locale: string): Promise<Translator> {
  const rows = await db.select().from(translations).where(and(eq(translations.shopId, shopId), eq(translations.locale, locale), ne(translations.resourceType, 'ONLINE_STORE_THEME')));
  const map = new Map(rows.map((r) => [`${r.resourceType}:${r.resourceId}:${r.key}`, r.value]));
  const get: Translator['get'] = (t, id, k) => map.get(`${t}:${id}:${k}`);
  return { locale, active: true, get, text: (t, id, k, f) => get(t, id, k) ?? f };
}

/** Translations of the theme's locale strings in `locale` as `{ 'a.b.c': value }`, plus a signature to key caches. */
export async function themeTranslations(db: Executor, shopId: number, themeId: number, locale: string): Promise<{ values: Record<string, string>; sig: string }> {
  const rows = await db.select({ key: translations.key, value: translations.value }).from(translations)
    .where(and(eq(translations.shopId, shopId), eq(translations.locale, locale), eq(translations.resourceType, 'ONLINE_STORE_THEME'), eq(translations.resourceId, String(themeId))));
  return { values: Object.fromEntries(rows.map((r) => [r.key, r.value])), sig: sha256(JSON.stringify(rows.map((r) => [r.key, r.value]).sort())) };
}

/** Set `a.b.c` in a nested object. */
export function setPath(tree: Record<string, unknown>, path: string, value: string): void {
  const parts = path.split('.');
  let cur = tree;
  for (const p of parts.slice(0, -1)) {
    if (typeof cur[p] !== 'object' || cur[p] === null) cur[p] = {};
    cur = cur[p] as Record<string, unknown>;
  }
  cur[parts.at(-1)!] = value;
}
