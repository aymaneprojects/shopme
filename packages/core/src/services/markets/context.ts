/**
 * Buyer pricing context: which market a buyer is in and how a variant's shop-currency price turns into the presentment price.
 * This is the one place cart, checkout, storefront objects and the Admin API ask for market pricing.
 */
import { and, asc, eq, inArray } from 'drizzle-orm';
import type { Executor } from '../../db/client';
import * as s from '../../db/schema';
import { adjustMinor, convertMinor, resolvePrice, type FixedPrice, type PriceAdjustment, type PriceRules } from './money';
import { COUNTRY_CURRENCY, countryName } from './reference';
import { configOf } from '../settings/config';

export interface ShopBasics { id: number; currency: string; country: string }

export interface MarketContext {
  /** Null when the buyer is in the implicit shop-default context (no market row yet). */
  marketId: number | null;
  marketHandle: string;
  marketName: string;
  primary: boolean;
  countryCode: string;
  shopCurrency: string;
  /** Presentment currency of this buyer. */
  currency: string;
  /** `currency` per one unit of the shop currency (1 when equal). */
  rate: number;
  roundingEnabled: boolean;
  priceList: { id: number; adjustment: PriceAdjustment; compareAtMode: 'ADJUSTED' | 'NULLIFY' } | null;
}

export const defaultContext = (shop: ShopBasics, countryCode?: string | null): MarketContext => ({
  marketId: null, marketHandle: 'primary', marketName: countryName(shop.country), primary: true, countryCode: countryCode || shop.country,
  shopCurrency: shop.currency, currency: shop.currency, rate: 1, roundingEnabled: true, priceList: null,
});

/** True when prices equal the shop's own (no conversion and no adjustment): lets hot paths skip every extra query. */
export const isIdentity = (c: MarketContext): boolean => c.currency === c.shopCurrency && !c.priceList;

const asAdjustment = (pl: typeof s.priceLists.$inferSelect): PriceAdjustment => ({ type: pl.adjustmentType as PriceAdjustment['type'], value: pl.adjustmentValue });

async function currencyRate(db: Executor, shopId: number, shopCurrency: string, currency: string): Promise<number | null> {
  if (currency === shopCurrency) return 1;
  const [row] = await db.select().from(s.currencySettings).where(and(eq(s.currencySettings.shopId, shopId), eq(s.currencySettings.currencyCode, currency), eq(s.currencySettings.enabled, true))).limit(1);
  return row?.manualRate && row.manualRate > 0 ? row.manualRate : null;
}

/** Market a country buys from: the active market listing it, else the primary market (null when the shop has none yet). */
export async function marketForCountry(db: Executor, shopId: number, countryCode: string): Promise<typeof s.markets.$inferSelect | null> {
  const [hit] = await db.select({ m: s.markets }).from(s.marketRegions)
    .innerJoin(s.markets, eq(s.markets.id, s.marketRegions.marketId))
    .where(and(eq(s.marketRegions.shopId, shopId), eq(s.marketRegions.countryCode, countryCode.toUpperCase()), eq(s.markets.status, 'ACTIVE'))).limit(1);
  if (hit) return hit.m;
  // Settings > General > backup region: a country no market lists buys from the market of the backup region (when it has one).
  const [shopRow] = await db.select({ settings: s.shops.settings }).from(s.shops).where(eq(s.shops.id, shopId)).limit(1);
  const backup = shopRow ? configOf(shopRow, 'GENERAL').backupRegion : '';
  if (backup && backup !== countryCode.toUpperCase()) {
    const [alt] = await db.select({ m: s.markets }).from(s.marketRegions)
      .innerJoin(s.markets, eq(s.markets.id, s.marketRegions.marketId))
      .where(and(eq(s.marketRegions.shopId, shopId), eq(s.marketRegions.countryCode, backup), eq(s.markets.status, 'ACTIVE'))).limit(1);
    if (alt) return alt.m;
  }
  const [primary] = await db.select().from(s.markets).where(and(eq(s.markets.shopId, shopId), eq(s.markets.isPrimary, true))).limit(1);
  return primary ?? null;
}

/** The price context for a buyer in `countryCode` (the shop country when unknown). Falls back to the shop currency when a rate is missing. */
export async function resolveMarketContext(db: Executor, shop: ShopBasics, countryCode?: string | null): Promise<MarketContext> {
  const country = (countryCode || shop.country).toUpperCase();
  const market = await marketForCountry(db, shop.id, country);
  if (!market) return defaultContext(shop, country);
  const base: MarketContext = {
    marketId: market.id, marketHandle: market.handle, marketName: market.name || countryName(shop.country), primary: market.isPrimary, countryCode: country,
    shopCurrency: shop.currency, currency: shop.currency, rate: 1, roundingEnabled: market.roundingEnabled, priceList: null,
  };
  if (!market.isPrimary) {
    const wanted = (market.localCurrencies ? COUNTRY_CURRENCY[country] : null) ?? market.currencyCode ?? shop.currency;
    for (const code of [...new Set([wanted, market.currencyCode, shop.currency])]) {
      if (!code) continue;
      const rate = await currencyRate(db, shop.id, shop.currency, code);
      if (rate) { base.currency = code; base.rate = rate; break; }
    }
    const [row] = await db.select({ pl: s.priceLists }).from(s.catalogMarkets)
      .innerJoin(s.catalogs, eq(s.catalogs.id, s.catalogMarkets.catalogId))
      .innerJoin(s.priceLists, eq(s.priceLists.id, s.catalogs.priceListId))
      .where(and(eq(s.catalogMarkets.marketId, market.id), eq(s.catalogs.status, 'ACTIVE'))).limit(1);
    if (row && row.pl.currency === base.currency) base.priceList = { id: row.pl.id, adjustment: asAdjustment(row.pl), compareAtMode: row.pl.compareAtMode as 'ADJUSTED' | 'NULLIFY' };
  }
  return base;
}

export const rulesOf = (c: MarketContext): PriceRules => ({
  shopCurrency: c.shopCurrency, currency: c.currency, rate: c.rate, roundingEnabled: c.roundingEnabled, adjustment: c.priceList?.adjustment ?? null, compareAtMode: c.priceList?.compareAtMode,
});

export interface VariantBase { id: number; price: number; compareAt: number | null }
export interface VariantPrice { price: number; compareAt: number | null; fixed: boolean }

/** Presentment price (and compare-at) per variant for a context. Fixed prices of the context's price list win over conversion. */
export async function priceVariants(db: Executor, shopId: number, ctx: MarketContext, variants: VariantBase[]): Promise<Map<number, VariantPrice>> {
  const out = new Map<number, VariantPrice>();
  if (isIdentity(ctx)) {
    for (const v of variants) out.set(v.id, { price: v.price, compareAt: v.compareAt && v.compareAt > v.price ? v.compareAt : null, fixed: false });
    return out;
  }
  const fixed = new Map<number, FixedPrice>();
  if (ctx.priceList && variants.length) {
    const rows = await db.select().from(s.priceListPrices).where(and(eq(s.priceListPrices.shopId, shopId), eq(s.priceListPrices.priceListId, ctx.priceList.id), inArray(s.priceListPrices.variantId, variants.map((v) => v.id))));
    for (const r of rows) fixed.set(r.variantId, { price: r.price, compareAtPrice: r.compareAtPrice });
  }
  const rules = rulesOf(ctx);
  for (const v of variants) {
    const f = fixed.get(v.id) ?? null;
    out.set(v.id, { ...resolvePrice({ price: v.price, compareAt: v.compareAt }, rules, f), fixed: !!f });
  }
  return out;
}

/** Same lookup by variant id: reads the shop-currency prices itself. */
export async function priceVariantIds(db: Executor, shopId: number, ctx: MarketContext, ids: number[]): Promise<Map<number, VariantPrice>> {
  if (!ids.length) return new Map();
  const rows = await db.select({ id: s.productVariants.id, price: s.productVariants.price, compareAt: s.productVariants.compareAtPrice }).from(s.productVariants)
    .where(and(eq(s.productVariants.shopId, shopId), inArray(s.productVariants.id, ids)));
  return priceVariants(db, shopId, ctx, rows);
}

/** Convert a shop-currency amount (fixed discount value, shipping rate, minimum spend) into the context currency. Not rounded up. */
export const toPresentment = (c: Pick<MarketContext, 'shopCurrency' | 'currency' | 'rate'>, shopMinor: number): number =>
  c.currency === c.shopCurrency ? shopMinor : convertMinor(shopMinor, c.shopCurrency, c.currency, c.rate);

export interface BuyerCountry { code: string; name: string; currency: string; marketId: number | null; marketHandle: string }

/** Countries a buyer can pick: those of the active markets plus the shop country (the primary market), sorted by name. */
export async function listBuyerCountries(db: Executor, shop: ShopBasics, locale = 'en'): Promise<BuyerCountry[]> {
  const [ms, regions, rates] = await Promise.all([
    db.select().from(s.markets).where(eq(s.markets.shopId, shop.id)),
    db.select().from(s.marketRegions).where(eq(s.marketRegions.shopId, shop.id)),
    db.select().from(s.currencySettings).where(and(eq(s.currencySettings.shopId, shop.id), eq(s.currencySettings.enabled, true))),
  ]);
  const usable = new Set(rates.filter((r) => r.manualRate && r.manualRate > 0).map((r) => r.currencyCode));
  const byId = new Map(ms.map((m) => [m.id, m]));
  const primary = ms.find((m) => m.isPrimary);
  const entry = (code: string, m: typeof s.markets.$inferSelect | undefined): BuyerCountry => {
    let currency = shop.currency;
    if (m && !m.isPrimary) {
      const wanted = [(m.localCurrencies ? COUNTRY_CURRENCY[code] : null) ?? m.currencyCode, m.currencyCode].find((c) => c && (c === shop.currency || usable.has(c)));
      currency = wanted ?? shop.currency;
    }
    return { code, name: countryName(code, locale), currency, marketId: m?.id ?? null, marketHandle: m?.handle ?? 'primary' };
  };
  const out = new Map<string, BuyerCountry>();
  for (const r of regions) { const m = byId.get(r.marketId); if (m?.status === 'ACTIVE') out.set(r.countryCode, entry(r.countryCode, m)); }
  const home = shop.country.toUpperCase();
  if (!out.has(home)) out.set(home, entry(home, primary));
  return [...out.values()].sort((a, b) => a.name.localeCompare(b.name, locale));
}

/** Price of `shopMinor` after only the price-list adjustment (used by previews). */
export const adjustedShopPrice = (c: MarketContext, shopMinor: number): number => adjustMinor(shopMinor, c.priceList?.adjustment ?? null);
