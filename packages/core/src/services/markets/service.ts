import { and, asc, desc, eq, ilike, inArray, or, sql } from 'drizzle-orm';
import type { Db, Executor } from '../../db/client';
import * as s from '../../db/schema';
import { errR, okR, txResult, type Result } from '../catalog/common';
import { slugify } from '../handle';
import { rulesOf, type MarketContext } from './context';
import { COUNTRY_CURRENCY, countryName, isCountryCode, SUPPORTED_CURRENCIES } from './reference';
import { convertMinor, resolvePrice } from './money';

type MarketRow = typeof s.markets.$inferSelect;
type CatalogRow = typeof s.catalogs.$inferSelect;
type PriceListRow = typeof s.priceLists.$inferSelect;
export type CurrencySettingRow = typeof s.currencySettings.$inferSelect;

export interface ShopInfo { id: number; name: string; currency: string; country: string }

export interface MarketView extends MarketRow {
  /** Currency buyers pay in (the override, else the shop currency). */
  effectiveCurrency: string;
  countryCodes: string[];
  catalogIds: number[];
  type: 'REGION' | 'NONE';
}

const HANDLE_RE = /^[a-z0-9][a-z0-9-]*$/;

// ---------------------------------------------------------------------------------------------------------------------
// Primary market and currency settings
// ---------------------------------------------------------------------------------------------------------------------

/** The shop's primary market, created on first use (new shops and shops that predate markets). */
export async function ensurePrimaryMarket(db: Executor, shop: ShopInfo): Promise<MarketRow> {
  const [existing] = await db.select().from(s.markets).where(and(eq(s.markets.shopId, shop.id), eq(s.markets.isPrimary, true))).limit(1);
  if (existing) {
    if (!existing.name) {
      const [row] = await db.update(s.markets).set({ name: countryName(shop.country) }).where(eq(s.markets.id, existing.id)).returning();
      return row!;
    }
    return existing;
  }
  await db.insert(s.currencySettings).values({ shopId: shop.id, currencyCode: shop.currency, enabled: true, manualRate: 1 }).onConflictDoNothing();
  const [row] = await db.insert(s.markets).values({ shopId: shop.id, name: countryName(shop.country), handle: 'primary', status: 'ACTIVE', isPrimary: true }).onConflictDoNothing().returning();
  if (row) return row;
  const [again] = await db.select().from(s.markets).where(and(eq(s.markets.shopId, shop.id), eq(s.markets.isPrimary, true))).limit(1);
  return again!;
}

export async function listCurrencySettings(db: Executor, shopId: number): Promise<CurrencySettingRow[]> {
  return db.select().from(s.currencySettings).where(eq(s.currencySettings.shopId, shopId)).orderBy(asc(s.currencySettings.currencyCode));
}

export async function getCurrencySetting(db: Executor, shopId: number, code: string, shopCurrency: string): Promise<CurrencySettingRow> {
  const [row] = await db.select().from(s.currencySettings).where(and(eq(s.currencySettings.shopId, shopId), eq(s.currencySettings.currencyCode, code))).limit(1);
  return row ?? { id: 0, shopId, currencyCode: code, enabled: code === shopCurrency, manualRate: code === shopCurrency ? 1 : null, rateUpdatedAt: null };
}

/** Currencies a buyer can pay in: the shop currency and every enabled presentment currency. */
export async function enabledPresentmentCurrencies(db: Executor, shop: ShopInfo): Promise<string[]> {
  const rows = await db.select().from(s.currencySettings).where(and(eq(s.currencySettings.shopId, shop.id), eq(s.currencySettings.enabled, true)));
  return [...new Set([shop.currency, ...rows.map((r) => r.currencyCode)])];
}

/** Set (or create) the manual rate of a presentment currency: `currency` per one unit of the shop currency. */
export async function setCurrencyRate(db: Executor, shop: ShopInfo, code: string, rate: number): Promise<Result<CurrencySettingRow>> {
  if (!SUPPORTED_CURRENCIES.includes(code)) return errR(['currencyCode'], 'Currency is not supported', 'UNSUPPORTED_CURRENCY');
  if (code === shop.currency) return errR(['currencyCode'], 'The shop currency always has a rate of 1', 'PRIMARY_MARKET_USES_SHOP_CURRENCY');
  if (!(rate > 0) || !Number.isFinite(rate)) return errR(['manualRate'], 'The exchange rate must be a positive number', 'INVALID');
  const now = new Date();
  const [row] = await db.insert(s.currencySettings).values({ shopId: shop.id, currencyCode: code, enabled: true, manualRate: rate, rateUpdatedAt: now })
    .onConflictDoUpdate({ target: [s.currencySettings.shopId, s.currencySettings.currencyCode], set: { manualRate: rate, enabled: true, rateUpdatedAt: now } }).returning();
  return okR(row!);
}

// ---------------------------------------------------------------------------------------------------------------------
// Markets
// ---------------------------------------------------------------------------------------------------------------------

async function toViews(db: Executor, shop: ShopInfo, rows: MarketRow[]): Promise<MarketView[]> {
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const [regions, links] = await Promise.all([
    db.select().from(s.marketRegions).where(inArray(s.marketRegions.marketId, ids)).orderBy(asc(s.marketRegions.id)),
    db.select().from(s.catalogMarkets).where(inArray(s.catalogMarkets.marketId, ids)),
  ]);
  return rows.map((m) => {
    const countryCodes = m.isPrimary ? [shop.country.toUpperCase()] : regions.filter((r) => r.marketId === m.id).map((r) => r.countryCode);
    return { ...m, name: m.name || countryName(shop.country), effectiveCurrency: m.isPrimary ? shop.currency : m.currencyCode ?? shop.currency, countryCodes, catalogIds: links.filter((l) => l.marketId === m.id).map((l) => l.catalogId), type: countryCodes.length ? 'REGION' : 'NONE' };
  });
}

export type MarketSortKey = 'CREATED_AT' | 'ID' | 'MARKET_CONDITION_TYPES' | 'MARKET_TYPE' | 'NAME' | 'STATUS' | 'UPDATED_AT';

export interface ListMarketsOptions { query?: string | null; type?: string | null; status?: string | null; sortKey?: MarketSortKey; reverse?: boolean; offset?: number; limit?: number }

/** `name:x status:active market_type:region` plus free text matched against the name. */
function parseQuery(q: string | null | undefined): { name?: string; status?: string; type?: string; text: string[] } {
  const out: { name?: string; status?: string; type?: string; text: string[] } = { text: [] };
  for (const tok of (q ?? '').match(/(?:[^\s"]+:"[^"]*"|\S+)/g) ?? []) {
    const m = /^([a-z_]+):"?([^"]*)"?$/i.exec(tok);
    if (!m) { out.text.push(tok.replace(/^"|"$/g, '').toLowerCase()); continue; }
    const key = m[1]!.toLowerCase();
    if (key === 'name') out.name = m[2]!.toLowerCase();
    else if (key === 'status') out.status = m[2]!.toUpperCase();
    else if (key === 'market_type' || key === 'market_condition_types') out.type = m[2]!.toUpperCase();
    else out.text.push(tok.toLowerCase());
  }
  return out;
}

export async function listMarkets(db: Executor, shop: ShopInfo, o: ListMarketsOptions = {}): Promise<MarketView[]> {
  await ensurePrimaryMarket(db, shop);
  const rows = await db.select().from(s.markets).where(eq(s.markets.shopId, shop.id));
  let views = await toViews(db, shop, rows);
  const q = parseQuery(o.query);
  if (o.status) views = views.filter((m) => m.status === o.status);
  if (o.type) views = views.filter((m) => m.type === o.type);
  if (q.status) views = views.filter((m) => m.status === q.status);
  if (q.type) views = views.filter((m) => m.type === q.type);
  if (q.name) views = views.filter((m) => m.name.toLowerCase().includes(q.name!));
  for (const t of q.text) views = views.filter((m) => m.name.toLowerCase().includes(t) || m.countryCodes.some((c) => countryName(c).toLowerCase().includes(t)));
  const key = o.sortKey ?? 'ID';
  const cmp: Record<MarketSortKey, (a: MarketView, b: MarketView) => number> = {
    NAME: (a, b) => a.name.localeCompare(b.name), STATUS: (a, b) => a.status.localeCompare(b.status) || a.id - b.id, ID: (a, b) => a.id - b.id,
    CREATED_AT: (a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id - b.id, UPDATED_AT: (a, b) => a.updatedAt.getTime() - b.updatedAt.getTime() || a.id - b.id,
    MARKET_TYPE: (a, b) => a.type.localeCompare(b.type) || a.id - b.id, MARKET_CONDITION_TYPES: (a, b) => a.type.localeCompare(b.type) || a.id - b.id,
  };
  views.sort(cmp[key]);
  if (o.reverse) views.reverse();
  const off = o.offset ?? 0;
  return o.limit != null ? views.slice(off, off + o.limit) : views.slice(off);
}

export async function getMarket(db: Executor, shop: ShopInfo, id: number): Promise<MarketView | null> {
  await ensurePrimaryMarket(db, shop);
  const [row] = await db.select().from(s.markets).where(and(eq(s.markets.shopId, shop.id), eq(s.markets.id, id))).limit(1);
  return row ? (await toViews(db, shop, [row]))[0]! : null;
}

export interface CurrencySettingsInput { baseCurrency?: string | null; baseCurrencyManualRate?: number | null; localCurrencies?: boolean | null; roundingEnabled?: boolean | null }

export interface MarketInput {
  name?: string; handle?: string | null; status?: string | null; enabled?: boolean | null;
  countriesToAdd?: string[]; countriesToDelete?: string[];
  currencySettings?: CurrencySettingsInput | null; removeCurrencySettings?: boolean | null;
  catalogsToAdd?: number[]; catalogsToDelete?: number[];
  taxPricingStrategy?: string | null; dutiesPricingStrategy?: string | null;
}

const statusOf = (status?: string | null, enabled?: boolean | null): Result<string | undefined> => {
  if (status && enabled != null && (status === 'ACTIVE') !== enabled) return errR(['status'], 'Status and enabled do not agree', 'INVALID_STATUS_AND_ENABLED_COMBINATION');
  if (status && status !== 'ACTIVE' && status !== 'DRAFT') return errR(['status'], 'Status is invalid', 'INVALID');
  return okR(status ?? (enabled == null ? undefined : enabled ? 'ACTIVE' : 'DRAFT'));
};

async function applyCurrency(tx: Executor, shop: ShopInfo, market: MarketRow, inp: CurrencySettingsInput, countryCount: number): Promise<Result<Partial<typeof s.markets.$inferInsert>>> {
  const patch: Partial<typeof s.markets.$inferInsert> = {};
  const code = inp.baseCurrency?.toUpperCase();
  if (code) {
    if (!SUPPORTED_CURRENCIES.includes(code)) return errR(['currencySettings', 'baseCurrency'], 'Currency is not supported', 'UNSUPPORTED_CURRENCY');
    if (market.isPrimary && code !== shop.currency) return errR(['currencySettings', 'baseCurrency'], "The primary market always uses the shop's currency", 'PRIMARY_MARKET_USES_SHOP_CURRENCY');
    if (code !== shop.currency) {
      const [existing] = await tx.select().from(s.currencySettings).where(and(eq(s.currencySettings.shopId, shop.id), eq(s.currencySettings.currencyCode, code))).limit(1);
      const rate = inp.baseCurrencyManualRate ?? existing?.manualRate ?? null;
      if (rate == null || !(rate > 0) || !Number.isFinite(rate)) return errR(['currencySettings', 'baseCurrencyManualRate'], 'An exchange rate greater than zero is required for this currency', 'INVALID');
      const now = new Date();
      await tx.insert(s.currencySettings).values({ shopId: shop.id, currencyCode: code, enabled: true, manualRate: rate, rateUpdatedAt: now })
        .onConflictDoUpdate({ target: [s.currencySettings.shopId, s.currencySettings.currencyCode], set: { manualRate: rate, enabled: true, ...(inp.baseCurrencyManualRate != null ? { rateUpdatedAt: now } : {}) } });
    }
    patch.currencyCode = code === shop.currency ? null : code;
  } else if (inp.baseCurrencyManualRate != null && market.currencyCode) {
    if (!(inp.baseCurrencyManualRate > 0)) return errR(['currencySettings', 'baseCurrencyManualRate'], 'An exchange rate greater than zero is required for this currency', 'INVALID');
    await tx.update(s.currencySettings).set({ manualRate: inp.baseCurrencyManualRate, rateUpdatedAt: new Date() }).where(and(eq(s.currencySettings.shopId, shop.id), eq(s.currencySettings.currencyCode, market.currencyCode)));
  }
  if (inp.localCurrencies != null) {
    if (inp.localCurrencies && (market.isPrimary || countryCount <= 1)) return errR(['currencySettings', 'localCurrencies'], 'Local currencies need a market with more than one country', 'NO_LOCAL_CURRENCIES_ON_SINGLE_COUNTRY_MARKET');
    patch.localCurrencies = inp.localCurrencies;
  }
  if (inp.roundingEnabled != null) patch.roundingEnabled = inp.roundingEnabled;
  return okR(patch);
}

async function claimCountries(tx: Executor, shopId: number, marketId: number, codes: string[]): Promise<Result<null>> {
  for (const [i, raw] of codes.entries()) {
    const code = raw.toUpperCase();
    if (!isCountryCode(code)) return errR(['conditions', 'regionsCondition', 'regions', String(i), 'countryCode'], 'Country is not supported', 'UNSUPPORTED_COUNTRY_REGION');
    const [taken] = await tx.select({ marketId: s.marketRegions.marketId }).from(s.marketRegions).where(and(eq(s.marketRegions.shopId, shopId), eq(s.marketRegions.countryCode, code))).limit(1);
    if (taken && taken.marketId !== marketId) return errR(['conditions', 'regionsCondition', 'regions', String(i), 'countryCode'], `${countryName(code)} already belongs to another market`, 'DUPLICATE_REGION_MARKET');
    if (!taken) await tx.insert(s.marketRegions).values({ shopId, marketId, countryCode: code });
  }
  return okR(null);
}

async function attachCatalogs(tx: Executor, shop: ShopInfo, market: MarketRow, ids: number[], effectiveCurrency: string): Promise<Result<null>> {
  for (const id of ids) {
    const [cat] = await tx.select().from(s.catalogs).where(and(eq(s.catalogs.shopId, shop.id), eq(s.catalogs.id, id))).limit(1);
    if (!cat) return errR(['catalogs'], 'Catalog does not exist', 'CATALOG_NOT_FOUND');
    const [link] = await tx.select().from(s.catalogMarkets).where(eq(s.catalogMarkets.marketId, market.id)).limit(1);
    if (link && link.catalogId !== id) return errR(['catalogs'], 'This market already has a catalog', 'MARKET_TAKEN');
    if (cat.priceListId) {
      if (market.isPrimary) return errR(['catalogs'], 'A price list cannot be used on the primary market', 'PRICE_LIST_NOT_ALLOWED_FOR_PRIMARY_MARKET');
      const [pl] = await tx.select().from(s.priceLists).where(eq(s.priceLists.id, cat.priceListId)).limit(1);
      if (pl && pl.currency !== effectiveCurrency) return errR(['catalogs'], 'The price list currency must match the market currency', 'MARKET_AND_PRICE_LIST_CURRENCY_MISMATCH');
    }
    const other = await tx.select().from(s.catalogMarkets).where(eq(s.catalogMarkets.catalogId, id));
    if (other.some((o) => o.marketId !== market.id)) return errR(['catalogs'], 'A catalog can only have one market', 'CANNOT_ADD_MORE_THAN_ONE_MARKET');
    if (!link) await tx.insert(s.catalogMarkets).values({ shopId: shop.id, catalogId: id, marketId: market.id });
  }
  return okR(null);
}

async function uniqueMarketHandle(tx: Executor, shopId: number, base: string, selfId?: number): Promise<string> {
  const root = slugify(base);
  for (let i = 1; ; i++) {
    const candidate = i === 1 ? root : `${root}-${i}`;
    const [hit] = await tx.select({ id: s.markets.id }).from(s.markets).where(and(eq(s.markets.shopId, shopId), eq(s.markets.handle, candidate))).limit(1);
    if (!hit || hit.id === selfId) return candidate;
  }
}

export interface CreateMarketInput extends MarketInput { name: string }

export async function createMarket(db: Db, shop: ShopInfo, input: CreateMarketInput): Promise<Result<MarketView>> {
  const name = (input.name ?? '').trim();
  if (!name) return errR(['name'], "Name can't be blank", 'BLANK');
  if (name.length > 255) return errR(['name'], 'Name is too long (maximum is 255 characters)', 'TOO_LONG');
  const st = statusOf(input.status, input.enabled);
  if (!st.ok) return st;
  return txResult(db, async (tx) => {
    await ensurePrimaryMarket(tx, shop);
    let handle: string;
    if (input.handle) {
      if (!HANDLE_RE.test(input.handle)) return errR(['handle'], 'Handle is invalid', 'INVALID');
      const [dup] = await tx.select({ id: s.markets.id }).from(s.markets).where(and(eq(s.markets.shopId, shop.id), eq(s.markets.handle, input.handle))).limit(1);
      if (dup) return errR(['handle'], 'Handle has already been taken', 'TAKEN');
      handle = input.handle;
    } else handle = await uniqueMarketHandle(tx, shop.id, name);
    const [row] = await tx.insert(s.markets).values({ shopId: shop.id, name, handle, status: st.value ?? 'DRAFT', taxPricingStrategy: input.taxPricingStrategy ?? null, dutiesPricingStrategy: input.dutiesPricingStrategy ?? null }).returning();
    const countries = [...new Set((input.countriesToAdd ?? []).map((c) => c.toUpperCase()))];
    const claimed = await claimCountries(tx, shop.id, row!.id, countries);
    if (!claimed.ok) return claimed;
    if (input.currencySettings) {
      const cur = await applyCurrency(tx, shop, row!, input.currencySettings, countries.length);
      if (!cur.ok) return cur;
      if (Object.keys(cur.value).length) await tx.update(s.markets).set(cur.value).where(eq(s.markets.id, row!.id));
    }
    const [fresh] = await tx.select().from(s.markets).where(eq(s.markets.id, row!.id));
    if (input.catalogsToAdd?.length) {
      const a = await attachCatalogs(tx, shop, fresh!, input.catalogsToAdd, fresh!.currencyCode ?? shop.currency);
      if (!a.ok) return a;
    }
    return okR((await toViews(tx, shop, [fresh!]))[0]!);
  });
}

export async function updateMarket(db: Db, shop: ShopInfo, id: number, input: MarketInput): Promise<Result<MarketView>> {
  const st = statusOf(input.status, input.enabled);
  if (!st.ok) return st;
  return txResult(db, async (tx) => {
    await ensurePrimaryMarket(tx, shop);
    const [market] = await tx.select().from(s.markets).where(and(eq(s.markets.shopId, shop.id), eq(s.markets.id, id))).limit(1);
    if (!market) return errR(['id'], 'Market does not exist', 'MARKET_NOT_FOUND');
    const patch: Partial<typeof s.markets.$inferInsert> = {};
    if (input.name !== undefined) {
      const name = input.name.trim();
      if (!name) return errR(['input', 'name'], "Name can't be blank", 'BLANK');
      if (name.length > 255) return errR(['input', 'name'], 'Name is too long (maximum is 255 characters)', 'TOO_LONG');
      patch.name = name;
    }
    if (input.handle) {
      if (!HANDLE_RE.test(input.handle)) return errR(['input', 'handle'], 'Handle is invalid', 'INVALID');
      const [dup] = await tx.select({ id: s.markets.id }).from(s.markets).where(and(eq(s.markets.shopId, shop.id), eq(s.markets.handle, input.handle))).limit(1);
      if (dup && dup.id !== id) return errR(['input', 'handle'], 'Handle has already been taken', 'TAKEN');
      patch.handle = input.handle;
    }
    if (st.value) {
      if (market.isPrimary && st.value !== 'ACTIVE') return errR(['input', 'status'], 'The primary market cannot be disabled', 'CANNOT_DISABLE_PRIMARY_MARKET');
      patch.status = st.value;
    }
    if (input.taxPricingStrategy !== undefined) patch.taxPricingStrategy = input.taxPricingStrategy;
    if (input.dutiesPricingStrategy !== undefined) patch.dutiesPricingStrategy = input.dutiesPricingStrategy;
    if (input.countriesToAdd?.length) {
      if (market.isPrimary) return errR(['input', 'conditions'], 'Countries cannot be added to the primary market', 'CANNOT_ADD_REGIONS_TO_PRIMARY_MARKET');
      const c = await claimCountries(tx, shop.id, id, [...new Set(input.countriesToAdd.map((x) => x.toUpperCase()))]);
      if (!c.ok) return c;
    }
    if (input.countriesToDelete?.length && !market.isPrimary) {
      await tx.delete(s.marketRegions).where(and(eq(s.marketRegions.marketId, id), inArray(s.marketRegions.countryCode, input.countriesToDelete.map((x) => x.toUpperCase()))));
    }
    const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(s.marketRegions).where(eq(s.marketRegions.marketId, id)) as [{ n: number }];
    if (input.removeCurrencySettings) { patch.currencyCode = null; patch.localCurrencies = false; patch.roundingEnabled = true; }
    if (input.currencySettings) {
      const cur = await applyCurrency(tx, shop, market, input.currencySettings, n);
      if (!cur.ok) return { ok: false, errors: cur.errors.map((e) => ({ ...e, field: ['input', ...(e.field ?? [])] })) };
      Object.assign(patch, cur.value);
    }
    if (input.catalogsToDelete?.length) await tx.delete(s.catalogMarkets).where(and(eq(s.catalogMarkets.marketId, id), inArray(s.catalogMarkets.catalogId, input.catalogsToDelete)));
    if (Object.keys(patch).length) await tx.update(s.markets).set(patch).where(eq(s.markets.id, id));
    const [fresh] = await tx.select().from(s.markets).where(eq(s.markets.id, id));
    if (input.catalogsToAdd?.length) {
      const a = await attachCatalogs(tx, shop, fresh!, input.catalogsToAdd, fresh!.isPrimary ? shop.currency : fresh!.currencyCode ?? shop.currency);
      if (!a.ok) return a;
    }
    // A price list whose currency no longer matches the market cannot stay attached.
    if (patch.currencyCode !== undefined || input.removeCurrencySettings) await detachMismatchedCatalogs(tx, fresh!, shop.currency);
    return okR((await toViews(tx, shop, [fresh!]))[0]!);
  });
}

async function detachMismatchedCatalogs(tx: Executor, market: MarketRow, shopCurrency: string): Promise<void> {
  const cur = market.currencyCode ?? shopCurrency;
  const rows = await tx.select({ catalogId: s.catalogs.id, currency: s.priceLists.currency }).from(s.catalogMarkets)
    .innerJoin(s.catalogs, eq(s.catalogs.id, s.catalogMarkets.catalogId)).innerJoin(s.priceLists, eq(s.priceLists.id, s.catalogs.priceListId)).where(eq(s.catalogMarkets.marketId, market.id));
  for (const r of rows) if (r.currency !== cur) await tx.delete(s.catalogMarkets).where(and(eq(s.catalogMarkets.catalogId, r.catalogId), eq(s.catalogMarkets.marketId, market.id)));
}

export async function deleteMarket(db: Db, shop: ShopInfo, id: number): Promise<Result<{ id: number }>> {
  await ensurePrimaryMarket(db, shop);
  const [market] = await db.select().from(s.markets).where(and(eq(s.markets.shopId, shop.id), eq(s.markets.id, id))).limit(1);
  if (!market) return errR(['id'], 'Market does not exist', 'MARKET_NOT_FOUND');
  if (market.isPrimary) return errR(['id'], 'The primary market cannot be deleted', 'CANNOT_DELETE_PRIMARY_MARKET');
  await db.delete(s.markets).where(eq(s.markets.id, id));
  return okR({ id });
}

/** One region by its row id (`MarketRegionCountry` id). */
export async function getMarketRegion(db: Executor, shopId: number, regionId: number) {
  const [row] = await db.select().from(s.marketRegions).where(and(eq(s.marketRegions.shopId, shopId), eq(s.marketRegions.id, regionId))).limit(1);
  return row ?? null;
}

export async function regionIdsOf(db: Executor, marketId: number): Promise<{ id: number; countryCode: string }[]> {
  return db.select({ id: s.marketRegions.id, countryCode: s.marketRegions.countryCode }).from(s.marketRegions).where(eq(s.marketRegions.marketId, marketId)).orderBy(asc(s.marketRegions.id));
}

export async function deleteMarketRegion(db: Db, shop: ShopInfo, regionId: number): Promise<Result<{ marketId: number }>> {
  const region = await getMarketRegion(db, shop.id, regionId);
  if (!region) return errR(['id'], 'Region does not exist', 'REGION_NOT_FOUND');
  const all = await db.select({ id: s.marketRegions.id }).from(s.marketRegions).where(eq(s.marketRegions.marketId, region.marketId));
  if (all.length <= 1) return errR(['id'], 'The only region of a market cannot be deleted', 'CANNOT_DELETE_ONLY_REGION');
  await db.delete(s.marketRegions).where(eq(s.marketRegions.id, regionId));
  return okR({ marketId: region.marketId });
}

// ---------------------------------------------------------------------------------------------------------------------
// Price lists
// ---------------------------------------------------------------------------------------------------------------------

export interface PriceListView extends PriceListRow { fixedPricesCount: number; catalogId: number | null }

async function priceListViews(db: Executor, rows: PriceListRow[]): Promise<PriceListView[]> {
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const [counts, cats] = await Promise.all([
    db.select({ id: s.priceListPrices.priceListId, n: sql<number>`count(*)::int` }).from(s.priceListPrices).where(inArray(s.priceListPrices.priceListId, ids)).groupBy(s.priceListPrices.priceListId),
    db.select({ id: s.catalogs.id, pl: s.catalogs.priceListId }).from(s.catalogs).where(inArray(s.catalogs.priceListId, ids)),
  ]);
  return rows.map((r) => ({ ...r, fixedPricesCount: counts.find((c) => c.id === r.id)?.n ?? 0, catalogId: cats.find((c) => c.pl === r.id)?.id ?? null }));
}

export async function getPriceList(db: Executor, shopId: number, id: number): Promise<PriceListView | null> {
  const [row] = await db.select().from(s.priceLists).where(and(eq(s.priceLists.shopId, shopId), eq(s.priceLists.id, id))).limit(1);
  return row ? (await priceListViews(db, [row]))[0]! : null;
}

export async function listPriceLists(db: Executor, shopId: number, o: { sortKey?: 'ID' | 'NAME'; reverse?: boolean; offset?: number; limit?: number } = {}): Promise<PriceListView[]> {
  const rows = await db.select().from(s.priceLists).where(eq(s.priceLists.shopId, shopId)).orderBy(o.reverse ? desc(o.sortKey === 'NAME' ? s.priceLists.name : s.priceLists.id) : asc(o.sortKey === 'NAME' ? s.priceLists.name : s.priceLists.id)).limit(o.limit ?? 1000).offset(o.offset ?? 0);
  return priceListViews(db, rows);
}

export interface PriceListInput {
  name?: string; currency?: string; adjustment?: { type: string; value: number }; compareAtMode?: string | null; catalogId?: number | null;
}

function validateAdjustment(a: { type: string; value: number } | undefined, prefix: string[]): Result<null> {
  if (!a) return okR(null);
  if (a.type !== 'PERCENTAGE_DECREASE' && a.type !== 'PERCENTAGE_INCREASE') return errR([...prefix, 'type'], 'Adjustment type is invalid', 'INCLUSION');
  if (!Number.isFinite(a.value) || a.value < 0) return errR([...prefix, 'value'], 'The adjustment must be zero or more', 'INVALID_ADJUSTMENT_MIN_VALUE');
  if (a.type === 'PERCENTAGE_DECREASE' && a.value > 100) return errR([...prefix, 'value'], 'A decrease cannot be more than 100%', 'INVALID_ADJUSTMENT_MAX_VALUE');
  if (a.value > 1000) return errR([...prefix, 'value'], 'The adjustment is too large', 'INVALID_ADJUSTMENT_MAX_VALUE');
  return okR(null);
}

async function checkCatalogForList(tx: Executor, shop: ShopInfo, catalogId: number, currency: string, listId: number | null, replace = false): Promise<Result<null>> {
  const [cat] = await tx.select().from(s.catalogs).where(and(eq(s.catalogs.shopId, shop.id), eq(s.catalogs.id, catalogId))).limit(1);
  if (!cat) return errR(['catalogId'], 'Catalog does not exist', 'CATALOG_DOES_NOT_EXIST');
  if (!replace && cat.priceListId && cat.priceListId !== listId) return errR(['catalogId'], 'This catalog already has a price list', 'CATALOG_TAKEN');
  const ms = await tx.select({ m: s.markets }).from(s.catalogMarkets).innerJoin(s.markets, eq(s.markets.id, s.catalogMarkets.marketId)).where(eq(s.catalogMarkets.catalogId, catalogId));
  for (const { m } of ms) {
    if (m.isPrimary) return errR(['catalogId'], 'A price list cannot be used on the primary market', 'PRICE_LIST_NOT_ALLOWED_FOR_PRIMARY_MARKET');
    if ((m.currencyCode ?? shop.currency) !== currency) return errR(['currency'], 'The price list currency must match the market currency', 'CATALOG_MARKET_AND_PRICE_LIST_CURRENCY_MISMATCH');
  }
  return okR(null);
}

export async function createPriceList(db: Db, shop: ShopInfo, input: PriceListInput & { name: string; currency: string }): Promise<Result<PriceListView>> {
  const name = input.name.trim();
  if (!name) return errR(['name'], "Name can't be blank", 'BLANK');
  if (name.length > 255) return errR(['name'], 'Name is too long (maximum is 255 characters)', 'TOO_LONG');
  const currency = input.currency.toUpperCase();
  if (!SUPPORTED_CURRENCIES.includes(currency)) return errR(['currency'], 'Currency is not supported', 'CURRENCY_NOT_SUPPORTED');
  const adj = validateAdjustment(input.adjustment, ['parent', 'adjustment']);
  if (!adj.ok) return adj;
  if (input.compareAtMode && input.compareAtMode !== 'ADJUSTED' && input.compareAtMode !== 'NULLIFY') return errR(['parent', 'settings', 'compareAtMode'], 'Compare at mode is invalid', 'INCLUSION');
  return txResult(db, async (tx) => {
    if (input.catalogId) { const c = await checkCatalogForList(tx, shop, input.catalogId, currency, null); if (!c.ok) return c; }
    const [row] = await tx.insert(s.priceLists).values({
      shopId: shop.id, name, currency, adjustmentType: input.adjustment?.type ?? 'PERCENTAGE_DECREASE', adjustmentValue: input.adjustment?.value ?? 0, compareAtMode: input.compareAtMode ?? 'ADJUSTED',
    }).returning();
    if (input.catalogId) await tx.update(s.catalogs).set({ priceListId: row!.id, updatedAt: new Date() }).where(eq(s.catalogs.id, input.catalogId));
    return okR((await priceListViews(tx, [row!]))[0]!);
  });
}

export async function updatePriceList(db: Db, shop: ShopInfo, id: number, input: PriceListInput): Promise<Result<PriceListView>> {
  const adj = validateAdjustment(input.adjustment, ['parent', 'adjustment']);
  if (!adj.ok) return adj;
  return txResult(db, async (tx) => {
    const [pl] = await tx.select().from(s.priceLists).where(and(eq(s.priceLists.shopId, shop.id), eq(s.priceLists.id, id))).limit(1);
    if (!pl) return errR(['id'], 'Price list does not exist', 'PRICE_LIST_NOT_FOUND');
    const patch: Partial<typeof s.priceLists.$inferInsert> = {};
    if (input.name !== undefined) {
      const name = input.name.trim();
      if (!name) return errR(['name'], "Name can't be blank", 'BLANK');
      patch.name = name.slice(0, 255);
    }
    if (input.currency && input.currency.toUpperCase() !== pl.currency) {
      const currency = input.currency.toUpperCase();
      if (!SUPPORTED_CURRENCIES.includes(currency)) return errR(['currency'], 'Currency is not supported', 'CURRENCY_NOT_SUPPORTED');
      const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(s.priceListPrices).where(eq(s.priceListPrices.priceListId, id)) as [{ n: number }];
      if (n > 0) return errR(['currency'], 'Remove the fixed prices before changing the currency', 'GENERIC_ERROR');
      patch.currency = currency;
    }
    if (input.adjustment) { patch.adjustmentType = input.adjustment.type; patch.adjustmentValue = input.adjustment.value; }
    if (input.compareAtMode) {
      if (input.compareAtMode !== 'ADJUSTED' && input.compareAtMode !== 'NULLIFY') return errR(['parent', 'settings', 'compareAtMode'], 'Compare at mode is invalid', 'INCLUSION');
      patch.compareAtMode = input.compareAtMode;
    }
    const catId = input.catalogId ?? (await tx.select({ id: s.catalogs.id }).from(s.catalogs).where(eq(s.catalogs.priceListId, id)).limit(1))[0]?.id ?? null;
    if (catId && (input.catalogId || patch.currency)) { const c = await checkCatalogForList(tx, shop, catId, patch.currency ?? pl.currency, id); if (!c.ok) return c; }
    if (Object.keys(patch).length) await tx.update(s.priceLists).set(patch).where(eq(s.priceLists.id, id));
    if (input.catalogId) await tx.update(s.catalogs).set({ priceListId: id, updatedAt: new Date() }).where(eq(s.catalogs.id, input.catalogId));
    return okR((await getPriceList(tx, shop.id, id))!);
  });
}

export async function deletePriceList(db: Db, shopId: number, id: number): Promise<Result<{ id: number }>> {
  const pl = await getPriceList(db, shopId, id);
  if (!pl) return errR(['id'], 'Price list does not exist', 'PRICE_LIST_NOT_FOUND');
  await db.delete(s.priceLists).where(eq(s.priceLists.id, id));
  return okR({ id });
}

export interface PriceListPriceRow { variantId: number; productId: number; productTitle: string; variantTitle: string; sku: string | null; basePrice: number; baseCompareAt: number | null; price: number; compareAtPrice: number | null; fixed: boolean }

/**
 * Prices of every variant under a price list, with the fixed ones flagged. `origin` narrows to FIXED or RELATIVE (computed)
 * rows. Relative prices use the list adjustment and the list currency at the currency's manual rate.
 */
export async function listPriceListPrices(db: Executor, shop: ShopInfo, priceListId: number, o: { origin?: 'FIXED' | 'RELATIVE' | null; query?: string | null; offset?: number; limit?: number } = {}): Promise<{ rows: PriceListPriceRow[]; total: number }> {
  const [pl] = await db.select().from(s.priceLists).where(and(eq(s.priceLists.shopId, shop.id), eq(s.priceLists.id, priceListId))).limit(1);
  if (!pl) return { rows: [], total: 0 };
  const fixedRows = await db.select().from(s.priceListPrices).where(eq(s.priceListPrices.priceListId, priceListId));
  const fixed = new Map(fixedRows.map((f) => [f.variantId, f]));
  const conds = [eq(s.productVariants.shopId, shop.id), eq(s.products.status, 'ACTIVE')];
  if (o.query?.trim()) {
    const like = `%${o.query.trim().replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
    conds.push(or(ilike(s.products.title, like), ilike(s.productVariants.title, like), ilike(s.productVariants.sku, like))!);
  }
  if (o.origin === 'FIXED') conds.push(inArray(s.productVariants.id, fixedRows.length ? fixedRows.map((f) => f.variantId) : [-1]));
  const base = db.select({ v: s.productVariants, p: s.products }).from(s.productVariants).innerJoin(s.products, eq(s.products.id, s.productVariants.productId)).where(and(...conds));
  const all = await base.orderBy(asc(s.products.title), asc(s.productVariants.position), asc(s.productVariants.id));
  const [rate] = pl.currency === shop.currency ? [{ manualRate: 1 }] : await db.select().from(s.currencySettings).where(and(eq(s.currencySettings.shopId, shop.id), eq(s.currencySettings.currencyCode, pl.currency))).limit(1);
  const ctx: MarketContext = {
    marketId: null, marketHandle: '', marketName: '', primary: false, countryCode: '', shopCurrency: shop.currency, currency: pl.currency, rate: rate?.manualRate ?? 1, roundingEnabled: true,
    priceList: { id: pl.id, adjustment: { type: pl.adjustmentType as 'PERCENTAGE_DECREASE', value: pl.adjustmentValue }, compareAtMode: pl.compareAtMode as 'ADJUSTED' },
  };
  const rules = rulesOf(ctx);
  const rows: PriceListPriceRow[] = [];
  for (const { v, p } of all) {
    const f = fixed.get(v.id);
    if (o.origin === 'RELATIVE' && f) continue;
    const rel = resolvePrice({ price: v.price, compareAt: v.compareAtPrice }, rules, null);
    rows.push({
      variantId: v.id, productId: p.id, productTitle: p.title, variantTitle: v.title, sku: v.sku, basePrice: v.price, baseCompareAt: v.compareAtPrice,
      price: f ? f.price : rel.price, compareAtPrice: f ? f.compareAtPrice : rel.compareAt, fixed: !!f,
    });
  }
  const off = o.offset ?? 0;
  return { rows: o.limit != null ? rows.slice(off, off + o.limit) : rows.slice(off), total: rows.length };
}

export interface FixedPriceInput { variantId: number; price: number; compareAtPrice?: number | null; currency?: string }

export async function addFixedPrices(db: Db, shop: ShopInfo, priceListId: number, prices: FixedPriceInput[]): Promise<Result<{ priceList: PriceListView; variantIds: number[] }>> {
  return txResult(db, async (tx) => {
    const [pl] = await tx.select().from(s.priceLists).where(and(eq(s.priceLists.shopId, shop.id), eq(s.priceLists.id, priceListId))).limit(1);
    if (!pl) return errR(['priceListId'], 'Price list does not exist', 'PRICE_LIST_NOT_FOUND');
    const ids = prices.map((p) => p.variantId);
    const found = ids.length ? await tx.select({ id: s.productVariants.id }).from(s.productVariants).where(and(eq(s.productVariants.shopId, shop.id), inArray(s.productVariants.id, ids))) : [];
    for (const [i, p] of prices.entries()) {
      if (p.currency && p.currency.toUpperCase() !== pl.currency) return errR(['prices', String(i), 'price', 'currencyCode'], 'The price currency must match the price list currency', 'PRICE_LIST_CURRENCY_MISMATCH');
      if (p.compareAtPrice != null && p.currency && p.currency.toUpperCase() !== pl.currency) return errR(['prices', String(i), 'compareAtPrice', 'currencyCode'], 'The price currency must match the price list currency', 'PRICE_LIST_CURRENCY_MISMATCH');
      if (!found.some((f) => f.id === p.variantId)) return errR(['prices', String(i), 'variantId'], 'Variant does not exist', 'VARIANT_NOT_FOUND');
      if (!Number.isFinite(p.price) || p.price < 0) return errR(['prices', String(i), 'price', 'amount'], 'The price must be zero or more', 'BLANK');
    }
    for (const p of prices) {
      await tx.insert(s.priceListPrices).values({ shopId: shop.id, priceListId, variantId: p.variantId, price: p.price, compareAtPrice: p.compareAtPrice ?? null })
        .onConflictDoUpdate({ target: [s.priceListPrices.priceListId, s.priceListPrices.variantId], set: { price: p.price, compareAtPrice: p.compareAtPrice ?? null } });
    }
    return okR({ priceList: (await getPriceList(tx, shop.id, priceListId))!, variantIds: ids });
  });
}

export async function deleteFixedPrices(db: Db, shop: ShopInfo, priceListId: number, variantIds: number[]): Promise<Result<{ priceList: PriceListView; deleted: number[] }>> {
  return txResult(db, async (tx) => {
    const pl = await getPriceList(tx, shop.id, priceListId);
    if (!pl) return errR(['priceListId'], 'Price list does not exist', 'PRICE_LIST_NOT_FOUND');
    const rows = variantIds.length ? await tx.select({ v: s.priceListPrices.variantId }).from(s.priceListPrices).where(and(eq(s.priceListPrices.priceListId, priceListId), inArray(s.priceListPrices.variantId, variantIds))) : [];
    const have = new Set(rows.map((r) => r.v));
    for (const [i, v] of variantIds.entries()) if (!have.has(v)) return errR(['variantIds', String(i)], 'This variant has no fixed price', 'PRICE_NOT_FIXED');
    if (variantIds.length) await tx.delete(s.priceListPrices).where(and(eq(s.priceListPrices.priceListId, priceListId), inArray(s.priceListPrices.variantId, variantIds)));
    return okR({ priceList: (await getPriceList(tx, shop.id, priceListId))!, deleted: variantIds });
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// Catalogs
// ---------------------------------------------------------------------------------------------------------------------

export interface CatalogView extends CatalogRow { marketIds: number[] }

async function catalogViews(db: Executor, rows: CatalogRow[]): Promise<CatalogView[]> {
  if (!rows.length) return [];
  const links = await db.select().from(s.catalogMarkets).where(inArray(s.catalogMarkets.catalogId, rows.map((r) => r.id)));
  return rows.map((r) => ({ ...r, marketIds: links.filter((l) => l.catalogId === r.id).map((l) => l.marketId) }));
}

export async function getCatalog(db: Executor, shopId: number, id: number): Promise<CatalogView | null> {
  const [row] = await db.select().from(s.catalogs).where(and(eq(s.catalogs.shopId, shopId), eq(s.catalogs.id, id))).limit(1);
  return row ? (await catalogViews(db, [row]))[0]! : null;
}

export async function listCatalogs(db: Executor, shopId: number, o: { query?: string | null; sortKey?: 'ID' | 'TITLE' | 'TYPE' | 'RELEVANCE'; reverse?: boolean; offset?: number; limit?: number; status?: string | null } = {}): Promise<CatalogView[]> {
  const conds = [eq(s.catalogs.shopId, shopId)];
  const q = (o.query ?? '').trim();
  const statusTok = /status:(\w+)/i.exec(q)?.[1]?.toUpperCase();
  const text = q.replace(/\w+:\S+/g, '').trim();
  if (text) conds.push(ilike(s.catalogs.title, `%${text.replace(/[%_\\]/g, (c) => `\\${c}`)}%`));
  const status = o.status ?? statusTok;
  if (status) conds.push(eq(s.catalogs.status, status));
  const col = o.sortKey === 'TITLE' ? s.catalogs.title : s.catalogs.id;
  const rows = await db.select().from(s.catalogs).where(and(...conds)).orderBy(o.reverse ? desc(col) : asc(col)).limit(o.limit ?? 1000).offset(o.offset ?? 0);
  return catalogViews(db, rows);
}

export async function countCatalogs(db: Executor, shopId: number): Promise<number> {
  const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(s.catalogs).where(eq(s.catalogs.shopId, shopId));
  return r?.n ?? 0;
}

export async function createCatalog(db: Db, shop: ShopInfo, input: { title: string; status?: string; marketIds?: number[]; priceListId?: number | null }): Promise<Result<CatalogView>> {
  const title = input.title.trim();
  if (!title) return errR(['title'], "Title can't be blank", 'BLANK');
  if (title.length > 255) return errR(['title'], 'Title is too long (maximum is 255 characters)', 'TOO_LONG');
  if (input.status && !['ACTIVE', 'DRAFT', 'ARCHIVED'].includes(input.status)) return errR(['status'], 'Status is invalid', 'INVALID');
  if ((input.marketIds?.length ?? 0) > 1) return errR(['context', 'marketIds'], 'A catalog can only have one market', 'CANNOT_ADD_MORE_THAN_ONE_MARKET');
  return txResult(db, async (tx) => {
    await ensurePrimaryMarket(tx, shop);
    if (input.priceListId) {
      const pl = await getPriceList(tx, shop.id, input.priceListId);
      if (!pl) return errR(['priceListId'], 'Price list does not exist', 'PRICE_LIST_NOT_FOUND');
    }
    const [row] = await tx.insert(s.catalogs).values({ shopId: shop.id, title, status: input.status ?? 'DRAFT', priceListId: input.priceListId ?? null }).returning();
    const ctx = await setCatalogMarkets(tx, shop, row!, input.marketIds ?? [], []);
    if (!ctx.ok) return ctx;
    return okR((await catalogViews(tx, [row!]))[0]!);
  });
}

async function setCatalogMarkets(tx: Executor, shop: ShopInfo, catalog: CatalogRow, add: number[], remove: number[]): Promise<Result<null>> {
  if (remove.length) await tx.delete(s.catalogMarkets).where(and(eq(s.catalogMarkets.catalogId, catalog.id), inArray(s.catalogMarkets.marketId, remove)));
  for (const marketId of add) {
    const [m] = await tx.select().from(s.markets).where(and(eq(s.markets.shopId, shop.id), eq(s.markets.id, marketId))).limit(1);
    if (!m) return errR(['context', 'marketIds'], 'Market does not exist', 'MARKET_NOT_FOUND');
    const r = await attachCatalogs(tx, shop, m, [catalog.id], m.isPrimary ? shop.currency : m.currencyCode ?? shop.currency);
    if (!r.ok) return r;
  }
  return okR(null);
}

export async function updateCatalog(db: Db, shop: ShopInfo, id: number, input: { title?: string; status?: string; marketIds?: number[]; priceListId?: number | null }): Promise<Result<CatalogView>> {
  return txResult(db, async (tx) => {
    const [cat] = await tx.select().from(s.catalogs).where(and(eq(s.catalogs.shopId, shop.id), eq(s.catalogs.id, id))).limit(1);
    if (!cat) return errR(['id'], 'Catalog does not exist', 'CATALOG_NOT_FOUND');
    const patch: Partial<typeof s.catalogs.$inferInsert> = {};
    if (input.title !== undefined) {
      const title = input.title.trim();
      if (!title) return errR(['title'], "Title can't be blank", 'BLANK');
      patch.title = title.slice(0, 255);
    }
    if (input.status) {
      if (!['ACTIVE', 'DRAFT', 'ARCHIVED'].includes(input.status)) return errR(['status'], 'Status is invalid', 'INVALID');
      patch.status = input.status;
    }
    if (input.priceListId !== undefined) {
      if (input.priceListId) {
        const pl = await getPriceList(tx, shop.id, input.priceListId);
        if (!pl) return errR(['priceListId'], 'Price list does not exist', 'PRICE_LIST_NOT_FOUND');
        const [taken] = await tx.select({ id: s.catalogs.id }).from(s.catalogs).where(and(eq(s.catalogs.priceListId, input.priceListId))).limit(1);
        if (taken && taken.id !== id) return errR(['priceListId'], 'This price list belongs to another catalog', 'CATALOG_TAKEN');
        const chk = await checkCatalogForList(tx, shop, id, pl.currency, input.priceListId, true);
        if (!chk.ok) return { ok: false, errors: chk.errors.map((e) => ({ ...e, code: e.code === 'CATALOG_MARKET_AND_PRICE_LIST_CURRENCY_MISMATCH' ? 'MARKET_AND_PRICE_LIST_CURRENCY_MISMATCH' : e.code })) };
      }
      patch.priceListId = input.priceListId;
    }
    if (Object.keys(patch).length) await tx.update(s.catalogs).set({ ...patch, updatedAt: new Date() }).where(eq(s.catalogs.id, id));
    if (input.marketIds) {
      if (input.marketIds.length > 1) return errR(['context', 'marketIds'], 'A catalog can only have one market', 'CANNOT_ADD_MORE_THAN_ONE_MARKET');
      const current = (await tx.select().from(s.catalogMarkets).where(eq(s.catalogMarkets.catalogId, id))).map((l) => l.marketId);
      const r = await setCatalogMarkets(tx, shop, cat, input.marketIds.filter((m) => !current.includes(m)), current.filter((m) => !input.marketIds!.includes(m)));
      if (!r.ok) return r;
    }
    return okR((await getCatalog(tx, shop.id, id))!);
  });
}

export async function catalogContextUpdate(db: Db, shop: ShopInfo, id: number, add: number[], remove: number[]): Promise<Result<CatalogView>> {
  if (!add.length && !remove.length) return errR(['contextsToAdd'], 'Contexts to add or remove are required', 'REQUIRES_CONTEXTS_TO_ADD_OR_REMOVE');
  return txResult(db, async (tx) => {
    const [cat] = await tx.select().from(s.catalogs).where(and(eq(s.catalogs.shopId, shop.id), eq(s.catalogs.id, id))).limit(1);
    if (!cat) return errR(['catalogId'], 'Catalog does not exist', 'CATALOG_NOT_FOUND');
    const r = await setCatalogMarkets(tx, shop, cat, add, remove);
    if (!r.ok) return r;
    return okR((await getCatalog(tx, shop.id, id))!);
  });
}

export async function deleteCatalog(db: Db, shopId: number, id: number, deleteDependent = false): Promise<Result<{ id: number }>> {
  const cat = await getCatalog(db, shopId, id);
  if (!cat) return errR(['id'], 'Catalog does not exist', 'CATALOG_NOT_FOUND');
  await db.transaction(async (tx) => {
    await tx.delete(s.catalogs).where(eq(s.catalogs.id, id));
    if (deleteDependent && cat.priceListId) await tx.delete(s.priceLists).where(eq(s.priceLists.id, cat.priceListId));
  });
  return okR({ id });
}

export async function catalogForMarket(db: Executor, marketId: number): Promise<CatalogRow | null> {
  const [row] = await db.select({ c: s.catalogs }).from(s.catalogMarkets).innerJoin(s.catalogs, eq(s.catalogs.id, s.catalogMarkets.catalogId)).where(eq(s.catalogMarkets.marketId, marketId)).limit(1);
  return row?.c ?? null;
}

// ---------------------------------------------------------------------------------------------------------------------
// Conversions for the admin
// ---------------------------------------------------------------------------------------------------------------------

/** Preview of a shop-currency amount in a market currency (used by the currency popover). */
export const previewConversion = (shopMinor: number, shopCurrency: string, currency: string, rate: number): number => convertMinor(shopMinor, shopCurrency, currency, rate);

/** Local currency a country usually uses, when it is a known one. */
export const usualCurrencyOf = (countryCode: string): string | null => COUNTRY_CURRENCY[countryCode.toUpperCase()] ?? null;
