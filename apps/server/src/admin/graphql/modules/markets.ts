import {
  addFixedPrices, catalogContextUpdate, catalogForMarket, COUNTRY_CURRENCY, countCatalogs, createCatalog, createMarket, createPriceList, currencyName, deleteCatalog, deleteFixedPrices, deleteMarket, deleteMarketRegion,
  deletePriceList, enabledPresentmentCurrencies, ensurePrimaryMarket, getCatalog, getCurrencySetting, getMarket, getMarketRegion, getPriceList, getProduct, getVariant, listCatalogs, listVariants, listCurrencySettings, listMarkets, listPriceLists,
  listPriceListPrices, priceVariants, regionIdsOf, resolveMarketContext, updateCatalog, updateMarket, updatePriceList, countryName,
  type CatalogView, type CurrencySettingRow, type MarketContext, type MarketInput, type MarketSortKey, type MarketView, type PriceListPriceRow, type PriceListView, type Variant,
} from '@shopme/core';
import type { ObjectRef } from '@pothos/core';
import { parseId, parseMoney, toGid } from '@shopme/shopify-compat';
import { builder } from '../builder';
import { requireScope, type GraphQLContext } from '../context';
import { ConnectionArgs, defineConnection, paginate, paginateArray } from '../types/connection';
import { Node, registerNode } from '../types/node';
import { Count, CurrencyCode, MoneyInput, MoneyV2, moneyV2 } from '../types/money';
import { CountryCode } from '../types/sales';
import { Product_, ProductVariant, defineTypedPayload, shopOf, typedError } from '../types/catalog';
import type { UserError } from '@shopme/shopify-compat';
import { Shop } from './shop';

/* Markets, catalogs and price lists (Admin API names). Behavior: docs/spec/markets.md. */

const fail = (field: string[], message: string, code: string): UserError[] => [{ field, message, code }];
const mid = (id: unknown) => parseId(String(id), 'Market');
const cid = (id: unknown) => parseId(String(id), 'MarketCatalog') ?? parseId(String(id), 'Catalog');
const pid = (id: unknown) => parseId(String(id), 'PriceList');
const vid = (id: unknown) => parseId(String(id), 'ProductVariant');
const prefixed = (errors: UserError[], prefix: string[]): UserError[] => errors.map((e) => ({ ...e, field: e.field ? [...prefix, ...e.field] : prefix }));

/* ------------------------------ enums ------------------------------ */

const MarketStatus = builder.enumType('MarketStatus', { values: ['ACTIVE', 'DRAFT'] as const });
const MarketType = builder.enumType('MarketType', { values: ['NONE', 'REGION', 'LOCATION', 'COMPANY_LOCATION', 'CHANNEL'] as const });
const MarketConditionType = builder.enumType('MarketConditionType', { values: ['REGION', 'LOCATION', 'COMPANY_LOCATION', 'CHANNEL'] as const });
const MarketConditionApplicationType = builder.enumType('MarketConditionApplicationType', { values: ['SPECIFIED', 'ALL'] as const });
const MarketsSortKeys = builder.enumType('MarketsSortKeys', { values: ['CREATED_AT', 'ID', 'MARKET_CONDITION_TYPES', 'MARKET_TYPE', 'NAME', 'STATUS', 'UPDATED_AT'] as const });
const CatalogStatus = builder.enumType('CatalogStatus', { values: ['ACTIVE', 'ARCHIVED', 'DRAFT'] as const });
const CatalogType = builder.enumType('CatalogType', { values: ['NONE', 'APP', 'COMPANY_LOCATION', 'MARKET'] as const });
const CatalogSortKeys = builder.enumType('CatalogSortKeys', { values: ['ID', 'RELEVANCE', 'TITLE', 'TYPE'] as const });
const PriceListSortKeys = builder.enumType('PriceListSortKeys', { values: ['ID', 'NAME'] as const });
const PriceListAdjustmentType = builder.enumType('PriceListAdjustmentType', { values: ['PERCENTAGE_DECREASE', 'PERCENTAGE_INCREASE'] as const });
const PriceListCompareAtMode = builder.enumType('PriceListCompareAtMode', { values: ['ADJUSTED', 'NULLIFY'] as const });
const PriceListPriceOriginType = builder.enumType('PriceListPriceOriginType', { values: ['FIXED', 'RELATIVE'] as const });
const InclusiveTaxPricingStrategy = builder.enumType('InclusiveTaxPricingStrategy', { values: ['ADD_TAXES_AT_CHECKOUT', 'INCLUDES_TAXES_IN_PRICE', 'INCLUDES_TAXES_IN_PRICE_BASED_ON_COUNTRY'] as const });
const InclusiveDutiesPricingStrategy = builder.enumType('InclusiveDutiesPricingStrategy', { values: ['ADD_DUTIES_AT_CHECKOUT', 'INCLUDE_DUTIES_IN_PRICE'] as const });

/* ------------------------------ currency settings ------------------------------ */

const CurrencySetting = builder.objectRef<CurrencySettingRow>('CurrencySetting').implement({
  fields: (t) => ({
    currencyCode: t.field({ type: CurrencyCode, resolve: (c) => c.currencyCode }),
    currencyName: t.string({ resolve: (c) => currencyName(c.currencyCode) }),
    enabled: t.exposeBoolean('enabled'),
    manualRate: t.field({ type: 'Decimal', nullable: true, resolve: (c) => (c.manualRate == null ? null : String(c.manualRate)) }),
    rateUpdatedAt: t.field({ type: 'DateTime', nullable: true, resolve: (c) => c.rateUpdatedAt }),
  }),
});
const CurrencySettingConnection = defineConnection('CurrencySetting', CurrencySetting);

builder.objectFields(Shop, (t) => ({
  currencySettings: t.field({
    type: CurrencySettingConnection, args: { ...ConnectionArgs },
    resolve: async (s, a, ctx) => { requireScope(ctx, 'read_markets'); return paginateArray(a, await currencyRows(ctx, s.currency)); },
  }),
  enabledPresentmentCurrencies: t.field({ type: [CurrencyCode], resolve: (s, _a, ctx) => enabledPresentmentCurrencies(ctx.db, s) }),
}));

async function currencyRows(ctx: GraphQLContext, shopCurrency: string): Promise<CurrencySettingRow[]> {
  const rows = await listCurrencySettings(ctx.db, ctx.shopId);
  return rows.some((r) => r.currencyCode === shopCurrency) ? rows : [await getCurrencySetting(ctx.db, ctx.shopId, shopCurrency, shopCurrency), ...rows];
}

/* ------------------------------ market ------------------------------ */

interface RegionShape { id: number; countryCode: string; marketId: number }
const MarketRegion = builder.interfaceRef<RegionShape>('MarketRegion').implement({
  fields: (t) => ({ id: t.id({ resolve: (r) => toGid('MarketRegionCountry', r.id) }), name: t.string({ resolve: (r) => countryName(r.countryCode) }) }),
  resolveType: () => 'MarketRegionCountry',
});
const MarketRegionCountry = builder.objectRef<RegionShape>('MarketRegionCountry').implement({
  interfaces: [Node, MarketRegion],
  fields: (t) => ({
    code: t.field({ type: CountryCode, resolve: (r) => r.countryCode }),
    currency: t.field({
      type: CurrencySetting,
      resolve: async (r, _a, ctx) => { const shop = await shopOf(ctx); const m = await getMarket(ctx.db, shop, r.marketId); return getCurrencySetting(ctx.db, ctx.shopId, COUNTRY_CURRENCY[r.countryCode] && m?.localCurrencies ? COUNTRY_CURRENCY[r.countryCode]! : m?.effectiveCurrency ?? shop.currency, shop.currency); },
    }),
  }),
});
registerNode('MarketRegionCountry', async (ctx, id) => { const r = await getMarketRegion(ctx.db, ctx.shopId, id); return r ? { id: r.id, countryCode: r.countryCode, marketId: r.marketId } : null; });
const MarketRegionConnection = defineConnection('MarketRegion', MarketRegion as unknown as ObjectRef<any, RegionShape>);

const RegionsCondition = builder.objectRef<MarketView>('RegionsCondition').implement({
  fields: (t) => ({
    applicationLevel: t.field({ type: MarketConditionApplicationType, nullable: true, resolve: () => 'SPECIFIED' as const }),
    regions: t.field({ type: MarketRegionConnection, args: { ...ConnectionArgs }, resolve: async (m, a, ctx) => paginateArray(a, await regionsOf(ctx, m)) }),
  }),
});
const MarketConditions = builder.objectRef<MarketView>('MarketConditions').implement({
  fields: (t) => ({
    conditionTypes: t.field({ type: [MarketConditionType], resolve: (m) => (m.countryCodes.length ? ['REGION' as const] : []) }),
    regionsCondition: t.field({ type: RegionsCondition, nullable: true, resolve: (m) => (m.countryCodes.length ? m : null) }),
  }),
});

async function regionsOf(ctx: GraphQLContext, m: MarketView): Promise<RegionShape[]> {
  if (m.isPrimary) return m.countryCodes.map((c, i) => ({ id: -(m.id * 1000 + i + 1), countryCode: c, marketId: m.id }));
  return (await regionIdsOf(ctx.db, m.id)).map((r) => ({ id: r.id, countryCode: r.countryCode, marketId: m.id }));
}

const MarketCurrencySettings = builder.objectRef<MarketView>('MarketCurrencySettings').implement({
  fields: (t) => ({
    baseCurrency: t.field({ type: CurrencySetting, resolve: async (m, _a, ctx) => { const shop = await shopOf(ctx); return getCurrencySetting(ctx.db, ctx.shopId, m.effectiveCurrency, shop.currency); } }),
    localCurrencies: t.exposeBoolean('localCurrencies'),
    roundingEnabled: t.exposeBoolean('roundingEnabled'),
  }),
});
const MarketPriceInclusions = builder.objectRef<MarketView>('MarketPriceInclusions').implement({
  fields: (t) => ({
    adaptivePricingEnabled: t.boolean({ resolve: () => false }),
    inclusiveTaxPricingStrategy: t.field({ type: InclusiveTaxPricingStrategy, resolve: async (m, _a, ctx) => (m.taxPricingStrategy ?? ((await shopOf(ctx)).taxesIncluded ? 'INCLUDES_TAXES_IN_PRICE' : 'ADD_TAXES_AT_CHECKOUT')) as 'ADD_TAXES_AT_CHECKOUT' }),
    inclusiveDutiesPricingStrategy: t.field({ type: InclusiveDutiesPricingStrategy, resolve: (m) => (m.dutiesPricingStrategy ?? 'ADD_DUTIES_AT_CHECKOUT') as 'ADD_DUTIES_AT_CHECKOUT' }),
  }),
});

export const Market = builder.objectRef<MarketView>('Market');
const MarketConnection = defineConnection('Market', Market);

/** Web presences (domains and subfolders per market) are not implemented yet: the type exists so clients compile and lists stay empty. */
const MarketWebPresence = builder.objectRef<{ id: number; subfolderSuffix: string | null }>('MarketWebPresence').implement({
  interfaces: [Node],
  fields: (t) => ({ subfolderSuffix: t.exposeString('subfolderSuffix', { nullable: true }), rootUrls: t.field({ type: [builder.objectRef<{ locale: string; url: string }>('MarketWebPresenceRootUrl').implement({ fields: (u) => ({ locale: u.exposeString('locale'), url: u.field({ type: 'URL', resolve: (r) => r.url }) }) })], resolve: () => [] }) }),
});
const MarketWebPresenceConnection = defineConnection('MarketWebPresence', MarketWebPresence);

Market.implement({
  interfaces: [Node],
  fields: (t) => ({
    name: t.exposeString('name'),
    handle: t.exposeString('handle'),
    status: t.field({ type: MarketStatus, resolve: (m) => m.status as 'ACTIVE' }),
    enabled: t.boolean({ deprecationReason: 'Use `status` instead.', resolve: (m) => m.status === 'ACTIVE' }),
    primary: t.exposeBoolean('isPrimary', { deprecationReason: 'This field is deprecated and will be removed in the future.' }),
    type: t.field({ type: MarketType, resolve: (m) => m.type }),
    createdAt: t.field({ type: 'DateTime', resolve: (m) => m.createdAt }),
    conditions: t.field({ type: MarketConditions, nullable: true, resolve: (m) => m }),
    currencySettings: t.field({ type: MarketCurrencySettings, nullable: true, resolve: (m) => m }),
    priceInclusions: t.field({ type: MarketPriceInclusions, nullable: true, resolve: (m) => m }),
    regions: t.field({
      type: MarketRegionConnection, deprecationReason: 'This field is deprecated and will be removed in the future. Use `conditions.regionConditions` instead.', args: { ...ConnectionArgs },
      resolve: async (m, a, ctx) => paginateArray(a, await regionsOf(ctx, m)),
    }),
    catalogs: t.field({
      type: MarketCatalogConnection, args: { ...ConnectionArgs },
      resolve: async (m, a, ctx) => paginateArray(a, (await Promise.all(m.catalogIds.map((id) => getCatalog(ctx.db, ctx.shopId, id)))).filter((c): c is CatalogView => !!c)),
    }),
    catalogsCount: t.field({ type: Count, nullable: true, resolve: (m) => ({ count: m.catalogIds.length, precision: 'EXACT' as const }) }),
    priceList: t.field({
      type: PriceList, nullable: true, deprecationReason: 'Use `catalogs` instead.',
      resolve: async (m, _a, ctx) => { const c = await catalogForMarket(ctx.db, m.id); return c?.priceListId ? getPriceList(ctx.db, ctx.shopId, c.priceListId) : null; },
    }),
    webPresences: t.field({ type: MarketWebPresenceConnection, args: { ...ConnectionArgs }, resolve: (_m, a) => paginateArray(a, [] as { id: number; subfolderSuffix: string | null }[]) }),
    webPresence: t.field({ type: MarketWebPresence, nullable: true, deprecationReason: 'Use `webPresences` instead.', resolve: () => null }),
  }),
});
registerNode('Market', async (ctx, id) => getMarket(ctx.db, await shopOf(ctx), id));

/* ------------------------------ catalog and price list ------------------------------ */

const Catalog = builder.interfaceRef<CatalogView>('Catalog').implement({
  interfaces: [Node],
  fields: (t) => ({
    title: t.exposeString('title'),
    status: t.field({ type: CatalogStatus, resolve: (c) => c.status as 'ACTIVE' }),
    priceList: t.field({ type: PriceList, nullable: true, resolve: (c, _a, ctx) => (c.priceListId ? getPriceList(ctx.db, ctx.shopId, c.priceListId) : null) }),
  }),
  resolveType: () => 'MarketCatalog',
});
const MarketCatalog = builder.objectRef<CatalogView>('MarketCatalog');
const MarketCatalogConnection = defineConnection('MarketCatalog', MarketCatalog);
const CatalogConnection = defineConnection('Catalog', Catalog as unknown as ObjectRef<any, CatalogView>);

async function marketsOfCatalog(ctx: GraphQLContext, c: CatalogView): Promise<MarketView[]> {
  const shop = await shopOf(ctx);
  return (await Promise.all(c.marketIds.map((id) => getMarket(ctx.db, shop, id)))).filter((m): m is MarketView => !!m);
}
MarketCatalog.implement({
  interfaces: [Node, Catalog],
  fields: (t) => ({
    markets: t.field({
      type: MarketConnection, args: { ...ConnectionArgs, type: t.arg({ type: MarketType }), status: t.arg({ type: MarketStatus }) },
      resolve: async (c, a, ctx) => paginateArray(a, (await marketsOfCatalog(ctx, c)).filter((m) => (!a.status || m.status === a.status) && (!a.type || m.type === a.type))),
    }),
    marketsCount: t.field({ type: Count, nullable: true, resolve: (c) => ({ count: c.marketIds.length, precision: 'EXACT' as const }) }),
  }),
});
registerNode('MarketCatalog', (ctx, id) => getCatalog(ctx.db, ctx.shopId, id));

const PriceListAdjustment = builder.objectRef<{ type: string; value: number }>('PriceListAdjustment').implement({
  fields: (t) => ({ type: t.field({ type: PriceListAdjustmentType, resolve: (a) => a.type as 'PERCENTAGE_DECREASE' }), value: t.float({ resolve: (a) => a.value }) }),
});
const PriceListAdjustmentSettings = builder.objectRef<{ compareAtMode: string }>('PriceListAdjustmentSettings').implement({
  fields: (t) => ({ compareAtMode: t.field({ type: PriceListCompareAtMode, resolve: (s) => s.compareAtMode as 'ADJUSTED' }) }),
});
const PriceListParent = builder.objectRef<PriceListView>('PriceListParent').implement({
  fields: (t) => ({
    adjustment: t.field({ type: PriceListAdjustment, resolve: (p) => ({ type: p.adjustmentType, value: p.adjustmentValue }) }),
    settings: t.field({ type: PriceListAdjustmentSettings, resolve: (p) => ({ compareAtMode: p.compareAtMode }) }),
  }),
});
interface PriceShape extends PriceListPriceRow { currency: string }
const PriceListPrice = builder.objectRef<PriceShape>('PriceListPrice').implement({
  fields: (t) => ({
    price: t.field({ type: MoneyV2, resolve: (p) => moneyV2(p.price, p.currency) }),
    compareAtPrice: t.field({ type: MoneyV2, nullable: true, resolve: (p) => (p.compareAtPrice == null ? null : moneyV2(p.compareAtPrice, p.currency)) }),
    originType: t.field({ type: PriceListPriceOriginType, resolve: (p) => (p.fixed ? 'FIXED' : 'RELATIVE') }),
    variant: t.field({ type: ProductVariant, resolve: async (p, _a, ctx) => (await getVariant(ctx.db, ctx.shopId, p.variantId)) as Variant }),
  }),
});
const PriceListPriceConnection = defineConnection('PriceListPrice', PriceListPrice);

export const PriceList = builder.objectRef<PriceListView>('PriceList');
const PriceListConnection = defineConnection('PriceList', PriceList);
PriceList.implement({
  interfaces: [Node],
  fields: (t) => ({
    name: t.exposeString('name'),
    currency: t.field({ type: CurrencyCode, resolve: (p) => p.currency }),
    fixedPricesCount: t.exposeInt('fixedPricesCount'),
    createdAt: t.field({ type: 'DateTime', resolve: (p) => p.createdAt }),
    parent: t.field({ type: PriceListParent, nullable: true, resolve: (p) => p }),
    catalog: t.field({ type: Catalog, nullable: true, resolve: (p, _a, ctx) => (p.catalogId ? getCatalog(ctx.db, ctx.shopId, p.catalogId) : null) }),
    prices: t.field({
      type: PriceListPriceConnection, args: { ...ConnectionArgs, originType: t.arg({ type: PriceListPriceOriginType }), query: t.arg.string() },
      resolve: async (p, a, ctx) => {
        const shop = await shopOf(ctx);
        const page = (offset: number, limit: number) => listPriceListPrices(ctx.db, shop, p.id, { origin: a.originType, query: a.query, offset, limit }).then((r) => r.rows.map((x) => ({ ...x, currency: p.currency })));
        return paginate(a, { fetch: ({ offset, limit }) => page(offset, limit), total: async () => (await listPriceListPrices(ctx.db, shop, p.id, { origin: a.originType, query: a.query })).total });
      },
    }),
  }),
});
registerNode('PriceList', (ctx, id) => getPriceList(ctx.db, ctx.shopId, id));

/* ------------------------------ contextual pricing ------------------------------ */

const ContextualPricingContext = builder.inputType('ContextualPricingContext', { fields: (t) => ({ country: t.field({ type: CountryCode }), companyLocationId: t.id(), locationId: t.id() }) });

interface VariantPricingShape { price: number; compareAt: number | null; currency: string }
const ProductVariantContextualPricing = builder.objectRef<VariantPricingShape>('ProductVariantContextualPricing').implement({
  fields: (t) => ({
    price: t.field({ type: MoneyV2, resolve: (p) => moneyV2(p.price, p.currency) }),
    compareAtPrice: t.field({ type: MoneyV2, nullable: true, resolve: (p) => (p.compareAt == null ? null : moneyV2(p.compareAt, p.currency)) }),
  }),
});
const PricingRange = builder.objectRef<{ min: VariantPricingShape; max: VariantPricingShape }>('ProductContextualPriceRange').implement({
  fields: (t) => ({ minVariantPrice: t.field({ type: MoneyV2, resolve: (r) => moneyV2(r.min.price, r.min.currency) }), maxVariantPrice: t.field({ type: MoneyV2, resolve: (r) => moneyV2(r.max.price, r.max.currency) }) }),
});
const ProductContextualPricing = builder.objectRef<{ min: VariantPricingShape | null; max: VariantPricingShape | null }>('ProductContextualPricing').implement({
  fields: (t) => ({
    fixedQuantityRulesCount: t.int({ resolve: () => 0 }),
    minVariantPricing: t.field({ type: ProductVariantContextualPricing, nullable: true, resolve: (p) => p.min }),
    maxVariantPricing: t.field({ type: ProductVariantContextualPricing, nullable: true, resolve: (p) => p.max }),
    priceRange: t.field({ type: PricingRange, resolve: (p) => ({ min: p.min!, max: p.max! }) }),
  }),
});

async function contextFor(ctx: GraphQLContext, country?: string | null): Promise<MarketContext> {
  return resolveMarketContext(ctx.db, await shopOf(ctx), country);
}

builder.objectFields(ProductVariant, (t) => ({
  contextualPricing: t.field({
    type: ProductVariantContextualPricing, args: { context: t.arg({ type: ContextualPricingContext, required: true }) },
    resolve: async (v, a, ctx) => {
      const mc = await contextFor(ctx, a.context.country);
      const p = (await priceVariants(ctx.db, ctx.shopId, mc, [{ id: v.id, price: v.price, compareAt: v.compareAtPrice }])).get(v.id)!;
      return { price: p.price, compareAt: p.compareAt, currency: mc.currency };
    },
  }),
}));

builder.objectFields(Product_, (t) => ({
  contextualPricing: t.field({
    type: ProductContextualPricing, args: { context: t.arg({ type: ContextualPricingContext, required: true }) },
    resolve: async (p, a, ctx) => {
      const mc = await contextFor(ctx, a.context.country);
      const vs = await listVariants(ctx.db, ctx.shopId, { productId: p.id, offset: 0, limit: 250 });
      const priced = await priceVariants(ctx.db, ctx.shopId, mc, vs.map((v) => ({ id: v.id, price: v.price, compareAt: v.compareAtPrice })));
      const rows = vs.map((v) => ({ price: priced.get(v.id)!.price, compareAt: priced.get(v.id)!.compareAt, currency: mc.currency })).sort((x, y) => x.price - y.price);
      return { min: rows[0] ?? null, max: rows.at(-1) ?? null };
    },
  }),
}));

/* ------------------------------ queries ------------------------------ */

const ResolvedPriceInclusivity = builder.objectRef<{ taxes: boolean }>('ResolvedPriceInclusivity').implement({
  fields: (t) => ({ taxesIncluded: t.boolean({ resolve: (p) => p.taxes }), dutiesIncluded: t.boolean({ resolve: () => false }) }),
});
const BuyerSignalInput = builder.inputType('BuyerSignalInput', { fields: (t) => ({ countryCode: t.field({ type: CountryCode, required: true }) }) });
const MarketsResolvedValues = builder.objectRef<{ ctx: MarketContext; catalogs: CatalogView[]; taxes: boolean }>('MarketsResolvedValues').implement({
  fields: (t) => ({
    currencyCode: t.field({ type: CurrencyCode, resolve: (r) => r.ctx.currency }),
    priceInclusivity: t.field({ type: ResolvedPriceInclusivity, resolve: (r) => ({ taxes: r.taxes }) }),
    catalogs: t.field({ type: MarketCatalogConnection, args: { ...ConnectionArgs }, resolve: (r, a) => paginateArray(a, r.catalogs) }),
    webPresences: t.field({ type: MarketWebPresenceConnection, args: { ...ConnectionArgs }, resolve: (_r, a) => paginateArray(a, [] as { id: number; subfolderSuffix: string | null }[]) }),
  }),
});

builder.queryFields((t) => ({
  market: t.field({
    type: Market, nullable: true, args: { id: t.arg.id({ required: true }) },
    resolve: async (_r, a, ctx) => { requireScope(ctx, 'read_markets'); const id = mid(a.id); return id ? getMarket(ctx.db, await shopOf(ctx), id) : null; },
  }),
  markets: t.field({
    type: MarketConnection,
    args: { ...ConnectionArgs, type: t.arg({ type: MarketType }), sortKey: t.arg({ type: MarketsSortKeys, defaultValue: 'ID' }), query: t.arg.string() },
    resolve: async (_r, a, ctx) => {
      requireScope(ctx, 'read_markets');
      const shop = await shopOf(ctx);
      const base = { query: a.query, type: a.type, sortKey: a.sortKey as MarketSortKey, reverse: !!a.reverse };
      return paginate(a, { fetch: ({ offset, limit }) => listMarkets(ctx.db, shop, { ...base, offset, limit }), total: async () => (await listMarkets(ctx.db, shop, base)).length });
    },
  }),
  marketByGeography: t.field({
    type: Market, nullable: true, deprecationReason: 'This `market_by_geography` field will be removed in a future version of the API.', args: { countryCode: t.arg({ type: CountryCode, required: true }) },
    resolve: async (_r, a, ctx) => {
      requireScope(ctx, 'read_markets');
      const mc = await contextFor(ctx, a.countryCode);
      return mc.marketId ? getMarket(ctx.db, await shopOf(ctx), mc.marketId) : null;
    },
  }),
  marketsResolvedValues: t.field({
    type: MarketsResolvedValues, args: { buyerSignal: t.arg({ type: BuyerSignalInput, required: true }) },
    resolve: async (_r, a, ctx) => {
      requireScope(ctx, 'read_markets');
      const shop = await shopOf(ctx);
      const mc = await contextFor(ctx, a.buyerSignal.countryCode);
      const m = mc.marketId ? await getMarket(ctx.db, shop, mc.marketId) : null;
      const catalog = m?.status === 'ACTIVE' && m.catalogIds[0] ? await getCatalog(ctx.db, ctx.shopId, m.catalogIds[0]) : null;
      const taxes = m?.taxPricingStrategy ? m.taxPricingStrategy !== 'ADD_TAXES_AT_CHECKOUT' : shop.taxesIncluded;
      return { ctx: mc, catalogs: catalog && catalog.status === 'ACTIVE' ? [catalog] : [], taxes };
    },
  }),
  catalog: t.field({
    type: Catalog, nullable: true, args: { id: t.arg.id({ required: true }) },
    resolve: (_r, a, ctx) => { requireScope(ctx, 'read_markets'); const id = cid(a.id); return id ? getCatalog(ctx.db, ctx.shopId, id) : null; },
  }),
  catalogs: t.field({
    type: CatalogConnection, args: { ...ConnectionArgs, type: t.arg({ type: CatalogType }), sortKey: t.arg({ type: CatalogSortKeys, defaultValue: 'ID' }), query: t.arg.string() },
    resolve: (_r, a, ctx) => {
      requireScope(ctx, 'read_markets');
      if (a.type && a.type !== 'MARKET') return paginateArray(a, [] as CatalogView[]);
      const base = { query: a.query, sortKey: a.sortKey as 'ID', reverse: !!a.reverse };
      return paginate(a, { fetch: ({ offset, limit }) => listCatalogs(ctx.db, ctx.shopId, { ...base, offset, limit }), total: async () => (await listCatalogs(ctx.db, ctx.shopId, base)).length });
    },
  }),
  catalogsCount: t.field({
    type: Count, nullable: true, args: { type: t.arg({ type: CatalogType }), query: t.arg.string(), limit: t.arg.int() },
    resolve: async (_r, a, ctx) => {
      requireScope(ctx, 'read_markets');
      if (a.type && a.type !== 'MARKET') return { count: 0, precision: 'EXACT' as const };
      const n = a.query ? (await listCatalogs(ctx.db, ctx.shopId, { query: a.query })).length : await countCatalogs(ctx.db, ctx.shopId);
      return a.limit != null && n > a.limit ? { count: a.limit, precision: 'AT_LEAST' as const } : { count: n, precision: 'EXACT' as const };
    },
  }),
  priceList: t.field({
    type: PriceList, nullable: true, args: { id: t.arg.id({ required: true }) },
    resolve: (_r, a, ctx) => { requireScope(ctx, 'read_markets'); const id = pid(a.id); return id ? getPriceList(ctx.db, ctx.shopId, id) : null; },
  }),
  priceLists: t.field({
    type: PriceListConnection, args: { ...ConnectionArgs, sortKey: t.arg({ type: PriceListSortKeys, defaultValue: 'ID' }) },
    resolve: (_r, a, ctx) => {
      requireScope(ctx, 'read_markets');
      const base = { sortKey: a.sortKey as 'ID', reverse: !!a.reverse };
      return paginate(a, { fetch: ({ offset, limit }) => listPriceLists(ctx.db, ctx.shopId, { ...base, offset, limit }), total: async () => (await listPriceLists(ctx.db, ctx.shopId, base)).length });
    },
  }),
}));

/* ------------------------------ mutations: markets ------------------------------ */

const MarketRegionCreateInput = builder.inputType('MarketRegionCreateInput', { fields: (t) => ({ countryCode: t.field({ type: CountryCode, required: true }) }) });
const MarketConditionsRegionInput = builder.inputType('MarketConditionsRegionInput', { fields: (t) => ({ countryCode: t.field({ type: CountryCode, required: true }), subdivision: t.string() }) });
const MarketConditionsRegionsInput = builder.inputType('MarketConditionsRegionsInput', {
  fields: (t) => ({ regionIds: t.idList(), regions: t.field({ type: [MarketConditionsRegionInput] }), applicationLevel: t.field({ type: MarketConditionApplicationType }) }),
});
const MarketConditionsInput = builder.inputType('MarketConditionsInput', { fields: (t) => ({ regionsCondition: t.field({ type: MarketConditionsRegionsInput }) }) });
const MarketConditionsUpdateInput = builder.inputType('MarketConditionsUpdateInput', {
  fields: (t) => ({ conditionsToAdd: t.field({ type: MarketConditionsInput }), conditionsToDelete: t.field({ type: MarketConditionsInput }) }),
});
const MarketCurrencySettingsUpdateInput = builder.inputType('MarketCurrencySettingsUpdateInput', {
  fields: (t) => ({ baseCurrency: t.field({ type: CurrencyCode }), baseCurrencyManualRate: t.field({ type: 'Decimal' }), localCurrencies: t.boolean(), roundingEnabled: t.boolean() }),
});
const MarketPriceInclusionsInput = builder.inputType('MarketPriceInclusionsInput', {
  fields: (t) => ({ taxPricingStrategy: t.field({ type: InclusiveTaxPricingStrategy }), dutiesPricingStrategy: t.field({ type: InclusiveDutiesPricingStrategy }), adaptivePricingEnabled: t.boolean() }),
});
/** Accepted and ignored for now: market-level delivery customizations live in shipping profiles. */
const MarketDeliveryConfigurationsInput = (name: string) => builder.inputType(name, { fields: (t) => ({ shopmeIgnored: t.boolean({ description: 'Placeholder: delivery configuration is read-only on markets.' }) }) });

const MarketCreateInput = builder.inputType('MarketCreateInput', {
  fields: (t) => ({
    name: t.string({ required: true }), handle: t.string(), enabled: t.boolean({ deprecationReason: 'Use `status` instead.' }), regions: t.field({ type: [MarketRegionCreateInput], deprecationReason: 'Use `conditions` instead.' }),
    conditions: t.field({ type: MarketConditionsInput }), catalogs: t.idList(), makeDuplicateRegionMarketsDraft: t.boolean(), makeDuplicateUniqueMarketsDraft: t.boolean(), status: t.field({ type: MarketStatus }),
    webPresences: t.idList(), currencySettings: t.field({ type: MarketCurrencySettingsUpdateInput }), priceInclusions: t.field({ type: MarketPriceInclusionsInput }), discounts: t.idList(),
    delivery: t.field({ type: MarketDeliveryConfigurationsInput('MarketDeliveryConfigurationsCreateInput') }), returnPolicyProfileId: t.id(),
  }),
});
const MarketUpdateInput = builder.inputType('MarketUpdateInput', {
  fields: (t) => ({
    name: t.string(), handle: t.string(), enabled: t.boolean({ deprecationReason: 'Use `status` instead.' }), conditions: t.field({ type: MarketConditionsUpdateInput }),
    catalogsToAdd: t.idList(), catalogsToDelete: t.idList(), webPresencesToAdd: t.idList(), webPresencesToDelete: t.idList(), discountsToAdd: t.idList(), discountsToDelete: t.idList(),
    makeDuplicateRegionMarketsDraft: t.boolean(), makeDuplicateUniqueMarketsDraft: t.boolean(), status: t.field({ type: MarketStatus }), currencySettings: t.field({ type: MarketCurrencySettingsUpdateInput }),
    removeCurrencySettings: t.boolean(), removePriceInclusions: t.boolean(), priceInclusions: t.field({ type: MarketPriceInclusionsInput }),
    delivery: t.field({ type: MarketDeliveryConfigurationsInput('MarketDeliveryConfigurationsUpdateInput') }), returnPolicyProfileId: t.id(), removeReturnPolicyProfile: t.boolean(),
  }),
});

const MarketPayload = (name: string) => defineTypedPayload<{ market: MarketView | null }>(name, 'MarketUserError', (t) => ({ market: t.field({ type: Market, nullable: true, resolve: (p) => p.market }) }));
const MarketCreatePayload = MarketPayload('MarketCreatePayload');
const MarketUpdatePayload = MarketPayload('MarketUpdatePayload');
const MarketRegionsCreatePayload = MarketPayload('MarketRegionsCreatePayload');
const MarketDeletePayload = defineTypedPayload<{ deletedId: string | null }>('MarketDeletePayload', 'MarketUserError', (t) => ({ deletedId: t.id({ nullable: true, resolve: (p) => p.deletedId }) }));
const MarketRegionDeletePayload = defineTypedPayload<{ deletedId: string | null; market: MarketView | null }>('MarketRegionDeletePayload', 'MarketUserError', (t) => ({
  deletedId: t.id({ nullable: true, resolve: (p) => p.deletedId }), market: t.field({ type: Market, nullable: true, resolve: (p) => p.market }),
}));
const MarketCurrencySettingsUpdatePayload = defineTypedPayload<{ market: MarketView | null }>('MarketCurrencySettingsUpdatePayload', 'MarketCurrencySettingsUserError', (t) => ({
  market: t.field({ type: Market, nullable: true, deprecationReason: 'Use `marketCreate` and `marketUpdate` mutations instead.', resolve: (p) => p.market }),
}));

type RegionsInput = { regionIds?: string[] | null; regions?: { countryCode: string }[] | null } | null | undefined;
type CurrencyInput = { baseCurrency?: string | null; baseCurrencyManualRate?: string | null; localCurrencies?: boolean | null; roundingEnabled?: boolean | null } | null | undefined;

const rate = (v: string | null | undefined): number | null => { if (v == null || v === '') return null; const n = Number(v); return Number.isFinite(n) ? n : NaN; };
const currencyOf = (c: CurrencyInput) => (c ? { baseCurrency: c.baseCurrency, baseCurrencyManualRate: rate(c.baseCurrencyManualRate), localCurrencies: c.localCurrencies, roundingEnabled: c.roundingEnabled } : undefined);

async function countriesOf(ctx: GraphQLContext, r: RegionsInput): Promise<string[]> {
  const out = (r?.regions ?? []).map((x) => x.countryCode);
  for (const id of r?.regionIds ?? []) {
    const rid = parseId(String(id), 'MarketRegionCountry');
    const row = rid ? await getMarketRegion(ctx.db, ctx.shopId, rid) : null;
    if (row) out.push(row.countryCode);
  }
  return out;
}
const ids = (v: readonly (string | number)[] | null | undefined, f: (x: unknown) => number | null) => (v ?? []).map(f).filter((x): x is number => x != null);
const priceInclusion = (p: { taxPricingStrategy?: string | null; dutiesPricingStrategy?: string | null } | null | undefined, remove?: boolean | null): Partial<MarketInput> =>
  remove ? { taxPricingStrategy: null, dutiesPricingStrategy: null } : p ? { ...(p.taxPricingStrategy ? { taxPricingStrategy: p.taxPricingStrategy } : {}), ...(p.dutiesPricingStrategy ? { dutiesPricingStrategy: p.dutiesPricingStrategy } : {}) } : {};

builder.mutationFields((t) => ({
  marketCreate: t.field({
    type: MarketCreatePayload, args: { input: t.arg({ type: MarketCreateInput, required: true }) },
    resolve: async (_r, { input }, ctx) => {
      requireScope(ctx, 'write_markets');
      const shop = await shopOf(ctx);
      const countries = [...(input.regions ?? []).map((r) => r.countryCode), ...(await countriesOf(ctx, input.conditions?.regionsCondition))];
      const r = await createMarket(ctx.db, shop, {
        name: input.name, handle: input.handle, status: input.status, enabled: input.enabled, countriesToAdd: countries, currencySettings: currencyOf(input.currencySettings),
        catalogsToAdd: ids(input.catalogs, cid), ...priceInclusion(input.priceInclusions),
      });
      return r.ok ? { market: r.value, userErrors: [] } : { market: null, userErrors: prefixed(r.errors, ['input']) };
    },
  }),
  marketUpdate: t.field({
    type: MarketUpdatePayload, args: { id: t.arg.id({ required: true }), input: t.arg({ type: MarketUpdateInput, required: true }) },
    resolve: async (_r, { id, input }, ctx) => {
      requireScope(ctx, 'write_markets');
      const marketId = mid(id);
      if (!marketId) return { market: null, userErrors: fail(['id'], 'Market does not exist', 'MARKET_NOT_FOUND') };
      const shop = await shopOf(ctx);
      const add = await countriesOf(ctx, input.conditions?.conditionsToAdd?.regionsCondition);
      const del = await countriesOf(ctx, input.conditions?.conditionsToDelete?.regionsCondition);
      const r = await updateMarket(ctx.db, shop, marketId, {
        name: input.name ?? undefined, handle: input.handle, status: input.status, enabled: input.enabled, countriesToAdd: add, countriesToDelete: del, currencySettings: currencyOf(input.currencySettings),
        removeCurrencySettings: input.removeCurrencySettings, catalogsToAdd: ids(input.catalogsToAdd, cid), catalogsToDelete: ids(input.catalogsToDelete, cid), ...priceInclusion(input.priceInclusions, input.removePriceInclusions),
      });
      return r.ok ? { market: r.value, userErrors: [] } : { market: null, userErrors: r.errors.map((e) => (e.field?.[0] === 'id' ? e : { ...e, field: e.field?.[0] === 'input' ? e.field : ['input', ...(e.field ?? [])] })) };
    },
  }),
  marketDelete: t.field({
    type: MarketDeletePayload, args: { id: t.arg.id({ required: true }) },
    resolve: async (_r, { id }, ctx) => {
      requireScope(ctx, 'write_markets');
      const marketId = mid(id);
      if (!marketId) return { deletedId: null, userErrors: fail(['id'], 'Market does not exist', 'MARKET_NOT_FOUND') };
      const r = await deleteMarket(ctx.db, await shopOf(ctx), marketId);
      return r.ok ? { deletedId: toGid('Market', marketId), userErrors: [] } : { deletedId: null, userErrors: r.errors };
    },
  }),
  marketRegionsCreate: t.field({
    type: MarketRegionsCreatePayload, deprecationReason: 'This mutation is deprecated and will be removed in the future. Use `marketCreate` or `marketUpdate` instead.',
    args: { marketId: t.arg.id({ required: true }), regions: t.arg({ type: [MarketRegionCreateInput], required: true }) },
    resolve: async (_r, a, ctx) => {
      requireScope(ctx, 'write_markets');
      const marketId = mid(a.marketId);
      if (!marketId) return { market: null, userErrors: fail(['marketId'], 'Market does not exist', 'MARKET_NOT_FOUND') };
      const r = await updateMarket(ctx.db, await shopOf(ctx), marketId, { countriesToAdd: a.regions.map((x) => x.countryCode) });
      return r.ok ? { market: r.value, userErrors: [] } : { market: null, userErrors: r.errors };
    },
  }),
  marketRegionDelete: t.field({
    type: MarketRegionDeletePayload, deprecationReason: 'Use `marketUpdate` instead.', args: { id: t.arg.id({ required: true }) },
    resolve: async (_r, { id }, ctx) => {
      requireScope(ctx, 'write_markets');
      const rid = parseId(String(id), 'MarketRegionCountry');
      if (!rid) return { deletedId: null, market: null, userErrors: fail(['id'], 'Region does not exist', 'REGION_NOT_FOUND') };
      const shop = await shopOf(ctx);
      const r = await deleteMarketRegion(ctx.db, shop, rid);
      return r.ok ? { deletedId: toGid('MarketRegionCountry', rid), market: await getMarket(ctx.db, shop, r.value.marketId), userErrors: [] } : { deletedId: null, market: null, userErrors: r.errors };
    },
  }),
  marketCurrencySettingsUpdate: t.field({
    type: MarketCurrencySettingsUpdatePayload, deprecationReason: 'Use `marketCreate` and `marketUpdate` for creating and updating market currency settings, respectively.',
    args: { marketId: t.arg.id({ required: true }), input: t.arg({ type: MarketCurrencySettingsUpdateInput, required: true }) },
    resolve: async (_r, a, ctx) => {
      requireScope(ctx, 'write_markets');
      const marketId = mid(a.marketId);
      if (!marketId) return { market: null, userErrors: fail(['marketId'], 'Market does not exist', 'MARKET_NOT_FOUND') };
      const r = await updateMarket(ctx.db, await shopOf(ctx), marketId, { currencySettings: currencyOf(a.input) });
      return r.ok ? { market: r.value, userErrors: [] } : { market: null, userErrors: r.errors.map((e) => ({ ...e, field: e.field?.slice(1) ?? null })) };
    },
  }),
}));

/* ------------------------------ mutations: catalogs ------------------------------ */

const CatalogContextInput = builder.inputType('CatalogContextInput', { fields: (t) => ({ marketIds: t.idList(), companyLocationIds: t.idList() }) });
const CatalogCreateInput = builder.inputType('CatalogCreateInput', {
  fields: (t) => ({ title: t.string({ required: true }), status: t.field({ type: CatalogStatus, required: true }), context: t.field({ type: CatalogContextInput, required: true }), priceListId: t.id(), publicationId: t.id() }),
});
const CatalogUpdateInput = builder.inputType('CatalogUpdateInput', {
  fields: (t) => ({ title: t.string(), status: t.field({ type: CatalogStatus }), context: t.field({ type: CatalogContextInput }), priceListId: t.id(), publicationId: t.id() }),
});
const CatalogPayload = (name: string) => defineTypedPayload<{ catalog: CatalogView | null }>(name, 'CatalogUserError', (t) => ({ catalog: t.field({ type: Catalog, nullable: true, resolve: (p) => p.catalog }) }));
const CatalogCreatePayload = CatalogPayload('CatalogCreatePayload');
const CatalogUpdatePayload = CatalogPayload('CatalogUpdatePayload');
const CatalogContextUpdatePayload = CatalogPayload('CatalogContextUpdatePayload');
const CatalogDeletePayload = defineTypedPayload<{ deletedId: string | null }>('CatalogDeletePayload', 'CatalogUserError', (t) => ({ deletedId: t.id({ nullable: true, resolve: (p) => p.deletedId }) }));

/** The same service error with the catalog-specific code naming (`MARKET_NOT_FOUND`, `CATALOG_NOT_FOUND`...). */
const catalogErrors = (errors: UserError[]): UserError[] => errors.map((e) => ({ ...e, code: e.code === 'BLANK' || e.code === 'TOO_LONG' || e.code?.endsWith('NOT_FOUND') || e.code === 'MARKET_TAKEN' ? e.code : e.code }));

builder.mutationFields((t) => ({
  catalogCreate: t.field({
    type: CatalogCreatePayload, args: { input: t.arg({ type: CatalogCreateInput, required: true }) },
    resolve: async (_r, { input }, ctx) => {
      requireScope(ctx, 'write_markets');
      if (input.context.companyLocationIds?.length || (input.context.marketIds?.length && input.context.companyLocationIds?.length)) return { catalog: null, userErrors: fail(['input', 'context'], 'Provide exactly one context type', 'MUST_PROVIDE_EXACTLY_ONE_CONTEXT_TYPE') };
      const r = await createCatalog(ctx.db, await shopOf(ctx), { title: input.title, status: input.status, marketIds: ids(input.context.marketIds, mid), priceListId: input.priceListId ? pid(input.priceListId) : null });
      return r.ok ? { catalog: r.value, userErrors: [] } : { catalog: null, userErrors: prefixed(catalogErrors(r.errors), ['input']) };
    },
  }),
  catalogUpdate: t.field({
    type: CatalogUpdatePayload, args: { id: t.arg.id({ required: true }), input: t.arg({ type: CatalogUpdateInput, required: true }) },
    resolve: async (_r, { id, input }, ctx) => {
      requireScope(ctx, 'write_markets');
      const catalogId = cid(id);
      if (!catalogId) return { catalog: null, userErrors: fail(['id'], 'Catalog does not exist', 'CATALOG_NOT_FOUND') };
      const r = await updateCatalog(ctx.db, await shopOf(ctx), catalogId, {
        title: input.title ?? undefined, status: input.status ?? undefined, marketIds: input.context ? ids(input.context.marketIds, mid) : undefined,
        priceListId: input.priceListId === undefined ? undefined : input.priceListId ? pid(input.priceListId) : null,
      });
      return r.ok ? { catalog: r.value, userErrors: [] } : { catalog: null, userErrors: r.errors.map((e) => (e.field?.[0] === 'id' ? e : { ...e, field: ['input', ...(e.field ?? [])] })) };
    },
  }),
  catalogDelete: t.field({
    type: CatalogDeletePayload, args: { id: t.arg.id({ required: true }), deleteDependentResources: t.arg.boolean({ defaultValue: false }) },
    resolve: async (_r, a, ctx) => {
      requireScope(ctx, 'write_markets');
      const catalogId = cid(a.id);
      if (!catalogId) return { deletedId: null, userErrors: fail(['id'], 'Catalog does not exist', 'CATALOG_NOT_FOUND') };
      const r = await deleteCatalog(ctx.db, ctx.shopId, catalogId, !!a.deleteDependentResources);
      return r.ok ? { deletedId: toGid('MarketCatalog', catalogId), userErrors: [] } : { deletedId: null, userErrors: r.errors };
    },
  }),
  catalogContextUpdate: t.field({
    type: CatalogContextUpdatePayload, args: { catalogId: t.arg.id({ required: true }), contextsToAdd: t.arg({ type: CatalogContextInput }), contextsToRemove: t.arg({ type: CatalogContextInput }) },
    resolve: async (_r, a, ctx) => {
      requireScope(ctx, 'write_markets');
      const catalogId = cid(a.catalogId);
      if (!catalogId) return { catalog: null, userErrors: fail(['catalogId'], 'Catalog does not exist', 'CATALOG_NOT_FOUND') };
      const r = await catalogContextUpdate(ctx.db, await shopOf(ctx), catalogId, ids(a.contextsToAdd?.marketIds, mid), ids(a.contextsToRemove?.marketIds, mid));
      return r.ok ? { catalog: r.value, userErrors: [] } : { catalog: null, userErrors: r.errors };
    },
  }),
}));

/* ------------------------------ mutations: price lists ------------------------------ */

const PriceListAdjustmentInput = builder.inputType('PriceListAdjustmentInput', { fields: (t) => ({ value: t.float({ required: true }), type: t.field({ type: PriceListAdjustmentType, required: true }) }) });
const PriceListAdjustmentSettingsInput = builder.inputType('PriceListAdjustmentSettingsInput', { fields: (t) => ({ compareAtMode: t.field({ type: PriceListCompareAtMode, required: true, defaultValue: 'ADJUSTED' }) }) });
const PriceListParentCreateInput = builder.inputType('PriceListParentCreateInput', { fields: (t) => ({ adjustment: t.field({ type: PriceListAdjustmentInput, required: true }), settings: t.field({ type: PriceListAdjustmentSettingsInput }) }) });
const PriceListParentUpdateInput = builder.inputType('PriceListParentUpdateInput', { fields: (t) => ({ adjustment: t.field({ type: PriceListAdjustmentInput, required: true }), settings: t.field({ type: PriceListAdjustmentSettingsInput }) }) });
const PriceListCreateInput = builder.inputType('PriceListCreateInput', {
  fields: (t) => ({ name: t.string({ required: true }), currency: t.field({ type: CurrencyCode, required: true }), parent: t.field({ type: PriceListParentCreateInput, required: true }), catalogId: t.id() }),
});
const PriceListUpdateInput = builder.inputType('PriceListUpdateInput', {
  fields: (t) => ({ name: t.string(), currency: t.field({ type: CurrencyCode }), parent: t.field({ type: PriceListParentUpdateInput }), catalogId: t.id() }),
});
const PriceListPriceInput = builder.inputType('PriceListPriceInput', { fields: (t) => ({ variantId: t.id({ required: true }), price: t.field({ type: MoneyInput, required: true }), compareAtPrice: t.field({ type: MoneyInput }) }) });

const PriceListPayload = (name: string) => defineTypedPayload<{ priceList: PriceListView | null }>(name, 'PriceListUserError', (t) => ({ priceList: t.field({ type: PriceList, nullable: true, resolve: (p) => p.priceList }) }));
const PriceListCreatePayload = PriceListPayload('PriceListCreatePayload');
const PriceListUpdatePayload = PriceListPayload('PriceListUpdatePayload');
const PriceListDeletePayload = defineTypedPayload<{ deletedId: string | null }>('PriceListDeletePayload', 'PriceListUserError', (t) => ({ deletedId: t.id({ nullable: true, resolve: (p) => p.deletedId }) }));
const FixedPricesAddPayload = defineTypedPayload<{ prices: PriceShape[] | null }>('PriceListFixedPricesAddPayload', 'PriceListPriceUserError', (t) => ({ prices: t.field({ type: [PriceListPrice], nullable: true, resolve: (p) => p.prices }) }));
const FixedPricesDeletePayload = defineTypedPayload<{ deletedFixedPriceVariantIds: string[] | null }>('PriceListFixedPricesDeletePayload', 'PriceListPriceUserError', (t) => ({ deletedFixedPriceVariantIds: t.idList({ nullable: true, resolve: (p) => p.deletedFixedPriceVariantIds }) }));
const FixedPricesUpdatePayload = defineTypedPayload<{ priceList: PriceListView | null; pricesAdded: PriceShape[] | null; deletedFixedPriceVariantIds: string[] | null }>('PriceListFixedPricesUpdatePayload', 'PriceListPriceUserError', (t) => ({
  priceList: t.field({ type: PriceList, nullable: true, resolve: (p) => p.priceList }), pricesAdded: t.field({ type: [PriceListPrice], nullable: true, resolve: (p) => p.pricesAdded }),
  deletedFixedPriceVariantIds: t.idList({ nullable: true, resolve: (p) => p.deletedFixedPriceVariantIds }),
}));

type PriceInput = { variantId: string | number; price: { amount: string; currencyCode: string }; compareAtPrice?: { amount: string; currencyCode: string } | null };
function parsePrices(list: PriceInput[], currency: string): { ok: true; rows: { variantId: number; price: number; compareAtPrice: number | null; currency: string }[] } | { ok: false; errors: UserError[] } {
  const rows: { variantId: number; price: number; compareAtPrice: number | null; currency: string }[] = [];
  for (const [i, p] of list.entries()) {
    const variantId = vid(p.variantId);
    if (!variantId) return { ok: false, errors: fail(['prices', String(i), 'variantId'], 'Variant does not exist', 'VARIANT_NOT_FOUND') };
    try {
      rows.push({ variantId, price: parseMoney(p.price.amount, p.price.currencyCode), compareAtPrice: p.compareAtPrice ? parseMoney(p.compareAtPrice.amount, p.compareAtPrice.currencyCode) : null, currency: p.price.currencyCode });
      if (p.compareAtPrice && p.compareAtPrice.currencyCode !== currency) return { ok: false, errors: fail(['prices', String(i), 'compareAtPrice', 'currencyCode'], 'The price currency must match the price list currency', 'PRICE_LIST_CURRENCY_MISMATCH') };
    } catch { return { ok: false, errors: fail(['prices', String(i), 'price', 'amount'], 'Price is invalid', 'BLANK') }; }
  }
  return { ok: true, rows };
}

async function addPrices(ctx: GraphQLContext, listId: number, list: PriceInput[]): Promise<{ ok: true; priceList: PriceListView; prices: PriceShape[] } | { ok: false; errors: UserError[] }> {
  const shop = await shopOf(ctx);
  const pl = await getPriceList(ctx.db, ctx.shopId, listId);
  if (!pl) return { ok: false, errors: fail(['priceListId'], 'Price list does not exist', 'PRICE_LIST_NOT_FOUND') };
  const parsed = parsePrices(list, pl.currency);
  if (!parsed.ok) return parsed;
  const r = await addFixedPrices(ctx.db, shop, listId, parsed.rows.map((x) => ({ variantId: x.variantId, price: x.price, compareAtPrice: x.compareAtPrice, currency: x.currency })));
  if (!r.ok) return r;
  const all = await listPriceListPrices(ctx.db, shop, listId, { origin: 'FIXED' });
  return { ok: true, priceList: r.value.priceList, prices: all.rows.filter((x) => r.value.variantIds.includes(x.variantId)).map((x) => ({ ...x, currency: pl.currency })) };
}

const PriceListProductPriceInput = builder.inputType('PriceListProductPriceInput', { fields: (t) => ({ productId: t.id({ required: true }), price: t.field({ type: MoneyInput, required: true }), compareAtPrice: t.field({ type: MoneyInput }) }) });
const FixedPricesByProductPayload = defineTypedPayload<{ priceList: PriceListView | null; pricesToAddProducts: { id: number }[] | null; pricesToDeleteProducts: { id: number }[] | null }>(
  'PriceListFixedPricesByProductUpdatePayload', 'PriceListFixedPricesByProductBulkUpdateUserError',
  (t) => ({
    priceList: t.field({ type: PriceList, nullable: true, resolve: (p) => p.priceList }),
    pricesToAddProducts: t.field({ type: [Product_], nullable: true, resolve: async (p, _a, ctx) => (p.pricesToAddProducts ? (await Promise.all(p.pricesToAddProducts.map((x) => getProduct(ctx.db, ctx.shopId, x.id)))).filter((x): x is NonNullable<typeof x> => !!x) : null) }),
    pricesToDeleteProducts: t.field({ type: [Product_], nullable: true, resolve: async (p, _a, ctx) => (p.pricesToDeleteProducts ? (await Promise.all(p.pricesToDeleteProducts.map((x) => getProduct(ctx.db, ctx.shopId, x.id)))).filter((x): x is NonNullable<typeof x> => !!x) : null) }),
  }),
);

const adjustmentOf = (p: { adjustment: { type: string; value: number }; settings?: { compareAtMode: string } | null } | null | undefined) => (p ? { adjustment: p.adjustment, compareAtMode: p.settings?.compareAtMode ?? null } : {});

builder.mutationFields((t) => ({
  priceListCreate: t.field({
    type: PriceListCreatePayload, args: { input: t.arg({ type: PriceListCreateInput, required: true }) },
    resolve: async (_r, { input }, ctx) => {
      requireScope(ctx, 'write_markets');
      const r = await createPriceList(ctx.db, await shopOf(ctx), { name: input.name, currency: input.currency, ...adjustmentOf(input.parent), catalogId: input.catalogId ? cid(input.catalogId) : null });
      return r.ok ? { priceList: r.value, userErrors: [] } : { priceList: null, userErrors: prefixed(r.errors, ['input']) };
    },
  }),
  priceListUpdate: t.field({
    type: PriceListUpdatePayload, args: { id: t.arg.id({ required: true }), input: t.arg({ type: PriceListUpdateInput, required: true }) },
    resolve: async (_r, { id, input }, ctx) => {
      requireScope(ctx, 'write_markets');
      const listId = pid(id);
      if (!listId) return { priceList: null, userErrors: fail(['id'], 'Price list does not exist', 'PRICE_LIST_NOT_FOUND') };
      const r = await updatePriceList(ctx.db, await shopOf(ctx), listId, { name: input.name ?? undefined, currency: input.currency ?? undefined, ...adjustmentOf(input.parent), catalogId: input.catalogId ? cid(input.catalogId) : undefined });
      return r.ok ? { priceList: r.value, userErrors: [] } : { priceList: null, userErrors: r.errors.map((e) => (e.field?.[0] === 'id' ? e : { ...e, field: ['input', ...(e.field ?? [])] })) };
    },
  }),
  priceListDelete: t.field({
    type: PriceListDeletePayload, args: { id: t.arg.id({ required: true }) },
    resolve: async (_r, { id }, ctx) => {
      requireScope(ctx, 'write_markets');
      const listId = pid(id);
      if (!listId) return { deletedId: null, userErrors: fail(['id'], 'Price list does not exist', 'PRICE_LIST_NOT_FOUND') };
      const r = await deletePriceList(ctx.db, ctx.shopId, listId);
      return r.ok ? { deletedId: toGid('PriceList', listId), userErrors: [] } : { deletedId: null, userErrors: r.errors };
    },
  }),
  priceListFixedPricesAdd: t.field({
    type: FixedPricesAddPayload, args: { priceListId: t.arg.id({ required: true }), prices: t.arg({ type: [PriceListPriceInput], required: true }) },
    resolve: async (_r, a, ctx) => {
      requireScope(ctx, 'write_markets');
      const listId = pid(a.priceListId);
      if (!listId) return { prices: null, userErrors: fail(['priceListId'], 'Price list does not exist', 'PRICE_LIST_NOT_FOUND') };
      const r = await addPrices(ctx, listId, a.prices as PriceInput[]);
      return r.ok ? { prices: r.prices, userErrors: [] } : { prices: null, userErrors: r.errors };
    },
  }),
  priceListFixedPricesUpdate: t.field({
    type: FixedPricesUpdatePayload, args: { priceListId: t.arg.id({ required: true }), pricesToAdd: t.arg({ type: [PriceListPriceInput], required: true }), variantIdsToDelete: t.arg.idList({ required: true }) },
    resolve: async (_r, a, ctx) => {
      requireScope(ctx, 'write_markets');
      const listId = pid(a.priceListId);
      if (!listId) return { priceList: null, pricesAdded: null, deletedFixedPriceVariantIds: null, userErrors: fail(['priceListId'], 'Price list does not exist', 'PRICE_LIST_NOT_FOUND') };
      const toDelete = ids(a.variantIdsToDelete, vid);
      const del = toDelete.length ? await deleteFixedPrices(ctx.db, await shopOf(ctx), listId, toDelete) : null;
      if (del && !del.ok) return { priceList: null, pricesAdded: null, deletedFixedPriceVariantIds: null, userErrors: del.errors };
      const added = a.pricesToAdd.length ? await addPrices(ctx, listId, a.pricesToAdd as PriceInput[]) : null;
      if (added && !added.ok) return { priceList: null, pricesAdded: null, deletedFixedPriceVariantIds: null, userErrors: added.errors };
      return { priceList: await getPriceList(ctx.db, ctx.shopId, listId), pricesAdded: added?.prices ?? [], deletedFixedPriceVariantIds: toDelete.map((v) => toGid('ProductVariant', v)), userErrors: [] };
    },
  }),
  priceListFixedPricesByProductUpdate: t.field({
    type: FixedPricesByProductPayload,
    args: { priceListId: t.arg.id({ required: true }), pricesToAdd: t.arg({ type: [PriceListProductPriceInput] }), pricesToDeleteByProductIds: t.arg.idList() },
    resolve: async (_r, a, ctx) => {
      requireScope(ctx, 'write_markets');
      const err = (code: string, message: string, field: string[]) => ({ priceList: null, pricesToAddProducts: null, pricesToDeleteProducts: null, userErrors: fail(field, message, code) });
      const listId = pid(a.priceListId);
      const pl = listId ? await getPriceList(ctx.db, ctx.shopId, listId) : null;
      if (!listId || !pl) return err('PRICE_LIST_DOES_NOT_EXIST', 'Price list does not exist', ['priceListId']);
      if (!a.pricesToAdd?.length && !a.pricesToDeleteByProductIds?.length) return err('NO_UPDATE_OPERATIONS_SPECIFIED', 'No update operations were specified', ['pricesToAdd']);
      const addIds = (a.pricesToAdd ?? []).map((p) => parseId(String(p.productId), 'Product'));
      const delIds = ids(a.pricesToDeleteByProductIds, (x) => parseId(String(x), 'Product'));
      if (addIds.some((x) => x == null) || new Set([...addIds, ...delIds]).size !== addIds.length + delIds.length) return err('DUPLICATE_ID_IN_INPUT', 'A product can only appear once', ['pricesToAdd']);
      const shop = await shopOf(ctx);
      for (const [i, p] of (a.pricesToAdd ?? []).entries()) {
        if (p.price.currencyCode !== pl.currency) return err('PRICES_TO_ADD_CURRENCY_MISMATCH', 'The price currency must match the price list currency', ['pricesToAdd', String(i), 'price', 'currencyCode']);
        if (!(await getProduct(ctx.db, ctx.shopId, addIds[i]!))) return err('PRODUCT_DOES_NOT_EXIST', 'Product does not exist', ['pricesToAdd', String(i), 'productId']);
      }
      for (const [i, pidv] of delIds.entries()) if (!(await getProduct(ctx.db, ctx.shopId, pidv))) return err('PRODUCT_DOES_NOT_EXIST', 'Product does not exist', ['pricesToDeleteByProductIds', String(i)]);
      for (const [i, p] of (a.pricesToAdd ?? []).entries()) {
        const vs = await listVariants(ctx.db, ctx.shopId, { productId: addIds[i]!, offset: 0, limit: 250 });
        const price = parseMoney(p.price.amount, pl.currency);
        const compareAtPrice = p.compareAtPrice ? parseMoney(p.compareAtPrice.amount, pl.currency) : null;
        const r = await addFixedPrices(ctx.db, shop, listId, vs.map((v) => ({ variantId: v.id, price, compareAtPrice })));
        if (!r.ok) return { priceList: null, pricesToAddProducts: null, pricesToDeleteProducts: null, userErrors: r.errors };
      }
      for (const pidv of delIds) {
        const vs = await listVariants(ctx.db, ctx.shopId, { productId: pidv, offset: 0, limit: 250 });
        const fixed = (await listPriceListPrices(ctx.db, shop, listId, { origin: 'FIXED' })).rows.filter((x) => vs.some((v) => v.id === x.variantId)).map((x) => x.variantId);
        if (fixed.length) await deleteFixedPrices(ctx.db, shop, listId, fixed);
      }
      return { priceList: await getPriceList(ctx.db, ctx.shopId, listId), pricesToAddProducts: addIds.map((x) => ({ id: x! })), pricesToDeleteProducts: delIds.map((x) => ({ id: x })), userErrors: [] };
    },
  }),
  priceListFixedPricesDelete: t.field({
    type: FixedPricesDeletePayload, args: { priceListId: t.arg.id({ required: true }), variantIds: t.arg.idList({ required: true }) },
    resolve: async (_r, a, ctx) => {
      requireScope(ctx, 'write_markets');
      const listId = pid(a.priceListId);
      if (!listId) return { deletedFixedPriceVariantIds: null, userErrors: fail(['priceListId'], 'Price list does not exist', 'PRICE_LIST_NOT_FOUND') };
      const variantIds = ids(a.variantIds, vid);
      const r = await deleteFixedPrices(ctx.db, await shopOf(ctx), listId, variantIds);
      return r.ok ? { deletedFixedPriceVariantIds: variantIds.map((v) => toGid('ProductVariant', v)), userErrors: [] } : { deletedFixedPriceVariantIds: null, userErrors: r.errors };
    },
  }),
}));
