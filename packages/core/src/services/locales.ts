import { and, eq } from 'drizzle-orm';
import { shopLocales, shops, translations } from '../db/schema';
import type { Db, Executor } from '../db/client';
import { errR, okR, type Result } from './catalog/common';

export interface ShopLocaleRow { locale: string; name: string; primary: boolean; published: boolean }

const LOCALE_RE = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$/;
/** Normalised BCP 47 code: language lower-case, region upper-case (`pt-br` -> `pt-BR`). */
export function normalizeLocale(v: string): string | null {
  const [lang, region] = v.trim().replace('_', '-').split('-');
  const out = region ? `${lang!.toLowerCase()}-${region.length === 2 ? region.toUpperCase() : region}` : lang!.toLowerCase();
  return LOCALE_RE.test(out) ? out : null;
}

/** English name of a locale (`fr` -> `French`). */
export function localeName(code: string, inLocale = 'en'): string {
  try { const n = new Intl.DisplayNames([inLocale], { type: 'language' }).of(code); if (n && n !== code) return n.charAt(0).toUpperCase() + n.slice(1); } catch { /* fall through */ }
  return code;
}

/** Primary language first, then the added ones by code. */
export async function listShopLocales(db: Executor, shopId: number): Promise<ShopLocaleRow[]> {
  const [shop] = await db.select({ locale: shops.locale }).from(shops).where(eq(shops.id, shopId));
  const rows = await db.select().from(shopLocales).where(eq(shopLocales.shopId, shopId)).orderBy(shopLocales.locale);
  const primary = shop?.locale ?? 'en';
  return [{ locale: primary, name: localeName(primary), primary: true, published: true }, ...rows.filter((r) => r.locale !== primary).map((r) => ({ locale: r.locale, name: localeName(r.locale), primary: false, published: r.published }))];
}
export async function publishedLocales(db: Executor, shopId: number): Promise<ShopLocaleRow[]> {
  return (await listShopLocales(db, shopId)).filter((l) => l.published);
}

export async function enableShopLocale(db: Db, shopId: number, input: string): Promise<Result<ShopLocaleRow>> {
  const locale = normalizeLocale(input);
  if (!locale) return errR(['locale'], 'Locale is invalid', 'INVALID');
  if ((await listShopLocales(db, shopId)).some((l) => l.locale === locale)) return errR(['locale'], 'Locale has already been taken', 'TAKEN');
  await db.insert(shopLocales).values({ shopId, locale, published: false });
  return okR({ locale, name: localeName(locale), primary: false, published: false });
}
export async function updateShopLocale(db: Db, shopId: number, input: string, patch: { published?: boolean | null }): Promise<Result<ShopLocaleRow>> {
  const locale = normalizeLocale(input) ?? input;
  const cur = (await listShopLocales(db, shopId)).find((l) => l.locale === locale);
  if (!cur) return errR(['locale'], 'Locale not found', 'NOT_FOUND');
  if (cur.primary) return errR(['locale', 'published'], 'The primary locale cannot be unpublished', 'INVALID');
  if (patch.published != null) await db.update(shopLocales).set({ published: patch.published }).where(and(eq(shopLocales.shopId, shopId), eq(shopLocales.locale, locale)));
  return okR({ ...cur, published: patch.published ?? cur.published });
}
export async function disableShopLocale(db: Db, shopId: number, input: string): Promise<Result<string>> {
  const locale = normalizeLocale(input) ?? input;
  const cur = (await listShopLocales(db, shopId)).find((l) => l.locale === locale);
  if (!cur) return errR(['locale'], 'Locale not found', 'NOT_FOUND');
  if (cur.primary) return errR(['locale'], 'The primary locale cannot be disabled', 'INVALID');
  await db.transaction(async (tx) => {
    await tx.delete(translations).where(and(eq(translations.shopId, shopId), eq(translations.locale, locale)));
    await tx.delete(shopLocales).where(and(eq(shopLocales.shopId, shopId), eq(shopLocales.locale, locale)));
  });
  return okR(locale);
}
