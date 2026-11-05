import { sql } from 'drizzle-orm';
import { boolean, check, index, integer, jsonb, numeric, pgTable, primaryKey, text, uniqueIndex } from 'drizzle-orm/pg-core';
import { money, oneOf, pk, ref, shopIdCol, timestamps, ts } from './_helpers';
import { shops } from './shop';
import { productVariants } from './catalog';

const shopFk = () => shopIdCol().references(() => shops.id, { onDelete: 'cascade' });

/** A group of buyers (countries) with its own currency and pricing. Exactly one market per shop is primary (the shop's own settings). */
export const markets = pgTable('markets', {
  id: pk(), shopId: shopFk(),
  name: text('name').notNull(),
  handle: text('handle').notNull(),
  status: text('status').notNull().default('DRAFT'), // ACTIVE | DRAFT
  isPrimary: boolean('is_primary').notNull().default(false),
  conditionType: text('condition_type').notNull().default('REGION'),
  /** Null: the shop currency. */
  currencyCode: text('currency_code'),
  localCurrencies: boolean('local_currencies').notNull().default(false),
  roundingEnabled: boolean('rounding_enabled').notNull().default(true),
  taxPricingStrategy: text('tax_pricing_strategy'), // null: inherit the shop setting
  dutiesPricingStrategy: text('duties_pricing_strategy'),
  settings: jsonb('settings').$type<Record<string, unknown>>().notNull().default({}),
  ...timestamps(),
}, (t) => [
  uniqueIndex('markets_handle_uq').on(t.shopId, t.handle),
  uniqueIndex('markets_primary_uq').on(t.shopId).where(sql`${t.isPrimary}`),
  check('markets_status_chk', oneOf(t.status, ['ACTIVE', 'DRAFT'])),
]);

/** A country that belongs to a market. A country belongs to at most one market. */
export const marketRegions = pgTable('market_regions', {
  id: pk(), shopId: shopFk(),
  marketId: ref('market_id').notNull().references(() => markets.id, { onDelete: 'cascade' }),
  countryCode: text('country_code').notNull(),
}, (t) => [uniqueIndex('market_regions_country_uq').on(t.shopId, t.countryCode), index('market_regions_market_idx').on(t.marketId)]);

/** Per presentment currency: enabled flag and the manual rate (shop currency -> this currency). */
export const currencySettings = pgTable('currency_settings', {
  id: pk(), shopId: shopFk(),
  currencyCode: text('currency_code').notNull(),
  enabled: boolean('enabled').notNull().default(true),
  manualRate: numeric('manual_rate', { precision: 18, scale: 8, mode: 'number' }),
  rateUpdatedAt: ts('rate_updated_at'),
}, (t) => [uniqueIndex('currency_settings_uq').on(t.shopId, t.currencyCode)]);

/** Price list: a currency plus a percentage adjustment of base prices and/or fixed per-variant prices (fixed wins). */
export const priceLists = pgTable('price_lists', {
  id: pk(), shopId: shopFk(),
  name: text('name').notNull(), currency: text('currency').notNull(),
  adjustmentType: text('adjustment_type').notNull().default('PERCENTAGE_DECREASE'),
  adjustmentValue: numeric('adjustment_value', { precision: 9, scale: 4, mode: 'number' }).notNull().default(0),
  compareAtMode: text('compare_at_mode').notNull().default('ADJUSTED'), // ADJUSTED | NULLIFY
  ...timestamps(),
}, (t) => [check('price_lists_adjustment_chk', oneOf(t.adjustmentType, ['PERCENTAGE_DECREASE', 'PERCENTAGE_INCREASE'])), check('price_lists_compare_chk', oneOf(t.compareAtMode, ['ADJUSTED', 'NULLIFY']))]);

export const priceListPrices = pgTable('price_list_prices', {
  id: pk(), shopId: shopFk(),
  priceListId: ref('price_list_id').notNull().references(() => priceLists.id, { onDelete: 'cascade' }),
  variantId: ref('variant_id').notNull().references(() => productVariants.id, { onDelete: 'cascade' }),
  /** Minor units of the list currency. */
  price: money('price').notNull(), compareAtPrice: money('compare_at_price'),
}, (t) => [uniqueIndex('price_list_prices_uq').on(t.priceListId, t.variantId)]);

/** Ties markets to a price list. Only market catalogs exist. */
export const catalogs = pgTable('catalogs', {
  id: pk(), shopId: shopFk(),
  title: text('title').notNull(), status: text('status').notNull().default('DRAFT'), // ACTIVE | DRAFT | ARCHIVED
  priceListId: ref('price_list_id').references(() => priceLists.id, { onDelete: 'set null' }),
  position: integer('position').notNull().default(0),
  ...timestamps(),
}, (t) => [check('catalogs_status_chk', oneOf(t.status, ['ACTIVE', 'DRAFT', 'ARCHIVED']))]);

export const catalogMarkets = pgTable('catalog_markets', {
  shopId: shopFk(),
  catalogId: ref('catalog_id').notNull().references(() => catalogs.id, { onDelete: 'cascade' }),
  marketId: ref('market_id').notNull().references(() => markets.id, { onDelete: 'cascade' }),
}, (t) => [primaryKey({ columns: [t.catalogId, t.marketId] }), uniqueIndex('catalog_markets_market_uq').on(t.marketId)]);
