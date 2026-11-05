# Markets and multi-currency

Status: MVP implemented (markets with country regions, per-market currency with manual rate and rounding, catalogs and price lists with percentage adjustment and fixed prices, price resolution in Liquid, the Ajax cart, cart, checkout and orders, `contextualPricing`, admin Markets and Catalogs pages). Later items in section 5.3 and 9 are open: web presences, market translations, subdivision regions, per-catalog publications, duties, market-scoped discounts, geolocation, live exchange rates. API version studied: 2026-10. Names of types, fields, enums and mutations are listed for
interoperability only; all behavior text is our own. Admin screens were observed on our own development store (section 3.1).

## 1. Purpose

Let one store sell to several regions with region-specific prices and currencies, catalogs, shipping options, domains or
language subfolders, and privacy rules, while the merchant still manages one product catalog.

Today ShopMe has a single shop currency (`shops.currency`), one set of shipping zones (`shipping_zones`), translations per
locale (`shop_locales`, `translations`) with `/fr` style prefixes, and no notion of a buyer's country beyond the shipping
address. Everything below is new unless stated.

## 2. Concepts

- **Market**: a named, active or draft group of buyers defined by a condition. Only the REGION condition (a list of countries;
  subdivisions later) is in scope. LOCATION, COMPANY_LOCATION and CHANNEL exist in the `MarketType` enum; we return only
  `REGION` and `NONE`.
- **Primary market**: every store has one implicit market holding the shop's own settings (shop currency, shop domain, shop
  languages). It cannot be deleted or disabled and has no region list (it covers every country not claimed by another market).
  The admin shows it as the parent ("shop default") of the other markets.
- **Region**: a country (`MarketRegionCountry`). A country belongs to at most one market. Subdivision regions
  (`MarketRegionSubdivision`) are later.
- **Catalog**: ties a market to a price list (and later to a product publication). Only market catalogs (`MarketCatalog`) are
  supported. A market with no catalog inherits "all products at base prices".
- **Price list**: a currency plus either a percentage adjustment of base prices, or fixed per-variant prices, or both (fixed
  prices win).
- **Web presence**: a domain or a subfolder (`/ca`) plus a default locale and alternate locales, attached to a market.

## 3. Merchant-facing behavior

### 3.1 Admin screens (observed)

**Markets list** (left nav "Markets" with sub-entries "Catalogs" and a rollouts page that we do not clone).
- Header: back arrow, page title, a "graph view" button (diagram of markets and their parents; later) and a primary
  "Create market" button.
- Toolbar: a sidebar collapse toggle, a search field over market names, a filter button, a sort button.
- Table columns: Market (globe icon plus name), Status (green Active badge or Draft), Conditions (flag plus country name(s)),
  Customizations (icons: a catalog icon when a catalog is attached, a truck icon when shipping is customized). A row opens the
  market.

**Market detail** (two columns).
- Title row: market name, a "Region" tag and the status badge. Top right: an "Other actions" menu (delete the market; further
  items not observed).
- Main card: Name field; a status dropdown (Active / Draft); an "Includes" row listing the countries as flag chips with a pencil
  that opens the country picker.
- "Customizations" card: one row per customization turned on for this market. Each row shows a dropdown of the current choice,
  a plus button to add another one (e.g. a second catalog) and a minus button that removes the customization so the market
  inherits again. Rows seen: Catalogs ("Catalog for Canada") and Shipping ("Standard, Express"). The Shipping dropdown opens a
  popover: an on/off switch, a count of active options, one card per option (name, price with its free-shipping threshold,
  transit time, which products, which location), an overflow menu per card, and "Add a shipping option" at the bottom
  (details in shipping-profiles.md section 3.1).
- A dismissible promo strip about translating the store (not reproduced).
- "Inherited settings" card: each row shows the value inherited from the shop (small store icon, arrow, value) and a plus button
  to override it. Rows: Currency (shop currency), Catalogs ("All products"), Discounts ("all eligible discounts"), Domain and
  language (shop domain, primary language), Taxes and duties ("not collected" when no rule), Returns and cancellations ("no rule
  defined"), Online store (store name), Payment and accounts (checkout configuration name). A row that has been customized moves
  up into the Customizations card.
- Right column: a small diagram with the parent market (a box "Shop default"); a card "Other settings for this market" with two
  links: Customer privacy (cookie banner, data-sale opt-out; see customer-privacy-accounts-events.md) and Policies (number
  published).

**Currency override popover** (plus on the Currency row): a currency dropdown, a "Price rounding" radio group with
"Round up to the next whole unit" (default, label shows the currency's unit) and "Do not round prices", buttons Cancel and Done.

**Not captured yet**: create-market flow, catalogs list/edit page, domain-language override, discounts override (section 8).

### 3.2 Buyer context and price resolution

1. **Country**: precedence: explicit choice posted to `POST /localization` (`country_code`, kept in a cookie for a year); else the
   market whose domain or subfolder matches the request; else IP geolocation if the shop enabled it (later, off by default so
   self-hosters need no GeoIP database); else the shop country.
2. **Market**: the active market containing the country; otherwise the primary market.
3. **Currency**: the market currency setting (4.3). Without a currency override the shop currency is used. The cart records its
   currency when created (`carts.currency` already exists) and re-prices when the buyer changes country before checkout starts.
   After an order exists its currency is immutable.
4. **Price of a variant for a market**: if the market's catalog price list has a fixed price for the variant use it (and its
   compare-at price, or none); otherwise take the base price in shop currency, apply the list's percentage adjustment if any, convert
   with the currency's rate, then round (4.2).
5. **Rates** are manual in the MVP (`CurrencySetting.manualRate`); an optional provider interface `ExchangeRateProvider`
   (`getRates(base, quotes[])`) may be plugged later.
6. **Tax inclusion** follows the market's price-inclusion strategy, falling back to the shop setting.
7. Orders keep both shop-currency totals (`shopMoney`) and presentment totals (`presentmentMoney`); reports use shop money.

### 3.3 Checkout

The buyer pays in the presentment currency; payment providers receive that amount and currency. Shipping rates are stored per
rate in shop currency (or a currency override, shipping-profiles.md 4) and converted with the same rate; shipping is not
rounded in the MVP. Fixed-amount discounts are converted; percentage discounts are not. Gift cards and store credit apply only to
carts in their own currency.

### 3.4 Languages, domains and subfolders

A market's web presence provides a root URL per locale and a default locale. Subfolder form: letters only, at least two,
not a script code. Domain form: a verified domain. A market cannot have both. `shop_locales` stays the shop-wide list of
languages; a web presence chooses a subset and a default. Our current locale prefix routing (`/fr`) becomes the primary market's
behavior; a market subfolder `/ca` coexists (`/ca` = market, then optionally a locale segment is not used: one locale per
subfolder, additional locales are alternate roots).

## 4. Data model proposal (Drizzle)

```ts
export const markets = pgTable('markets', {
  id: pk(), shopId: shopFk(),
  name: text('name').notNull(),
  handle: text('handle').notNull(),                       // unique per shop, derived from name
  status: text('status').notNull().default('DRAFT'),      // ACTIVE | DRAFT; "enabled" is derived
  isPrimary: boolean('is_primary').notNull().default(false), // exactly one per shop (partial unique index)
  conditionType: text('condition_type').notNull().default('REGION'),
  currencyCode: text('currency_code'),                    // null = inherit shop currency
  localCurrencies: boolean('local_currencies').notNull().default(false),
  roundingEnabled: boolean('rounding_enabled').notNull().default(true),
  taxPricingStrategy: text('tax_pricing_strategy'),       // null = inherit; see InclusiveTaxPricingStrategy
  dutiesPricingStrategy: text('duties_pricing_strategy'),
  settings: jsonb('settings').notNull().default({}),      // discount scope, returns policy ref (later)
  ...timestamps(),
}, (t) => [uniqueIndex('markets_handle_uq').on(t.shopId, t.handle)]);

export const marketRegions = pgTable('market_regions', {
  id: pk(), shopId: shopFk(),
  marketId: ref('market_id').notNull().references(() => markets.id, { onDelete: 'cascade' }),
  countryCode: text('country_code').notNull(),
  subdivisionCode: text('subdivision_code'),              // later
}, (t) => [uniqueIndex('market_regions_country_uq').on(t.shopId, t.countryCode)]);   // one market per country

export const currencySettings = pgTable('currency_settings', {
  id: pk(), shopId: shopFk(),
  currencyCode: text('currency_code').notNull(),
  enabled: boolean('enabled').notNull().default(true),
  manualRate: numeric('manual_rate', { precision: 18, scale: 8, mode: 'number' }),  // shop currency -> this currency
  rateUpdatedAt: ts('rate_updated_at'),
}, (t) => [uniqueIndex('currency_settings_uq').on(t.shopId, t.currencyCode)]);

export const priceLists = pgTable('price_lists', {
  id: pk(), shopId: shopFk(),
  name: text('name').notNull(), currency: text('currency').notNull(),
  adjustmentType: text('adjustment_type').notNull().default('PERCENTAGE_DECREASE'),   // or PERCENTAGE_INCREASE
  adjustmentValue: numeric('adjustment_value', { precision: 9, scale: 4, mode: 'number' }).notNull().default(0),
  compareAtMode: text('compare_at_mode').notNull().default('ADJUSTED'),                 // ADJUSTED | NULLIFY
  ...timestamps(),
});
export const priceListPrices = pgTable('price_list_prices', {
  id: pk(), shopId: shopFk(),
  priceListId: ref('price_list_id').notNull().references(() => priceLists.id, { onDelete: 'cascade' }),
  variantId: ref('variant_id').notNull().references(() => productVariants.id, { onDelete: 'cascade' }),
  price: money('price').notNull(), compareAtPrice: money('compare_at_price'),          // minor units of the list currency
}, (t) => [uniqueIndex('price_list_prices_uq').on(t.priceListId, t.variantId)]);

export const catalogs = pgTable('catalogs', {
  id: pk(), shopId: shopFk(),
  title: text('title').notNull(), status: text('status').notNull().default('DRAFT'),   // ACTIVE | DRAFT | ARCHIVED
  priceListId: ref('price_list_id').references(() => priceLists.id, { onDelete: 'set null' }),
  publicationId: ref('publication_id'),                    // later: product visibility per market
  ...timestamps(),
});
export const catalogMarkets = pgTable('catalog_markets', {
  catalogId: ref('catalog_id').notNull().references(() => catalogs.id, { onDelete: 'cascade' }),
  marketId: ref('market_id').notNull().references(() => markets.id, { onDelete: 'cascade' }),
}, (t) => [primaryKey({ columns: [t.catalogId, t.marketId] }), uniqueIndex('catalog_markets_market_uq').on(t.marketId)]);

export const marketWebPresences = pgTable('market_web_presences', {
  id: pk(), shopId: shopFk(),
  marketId: ref('market_id').references(() => markets.id, { onDelete: 'cascade' }),    // null = shop primary
  domainId: ref('domain_id'),                              // null for a subfolder
  subfolderSuffix: text('subfolder_suffix'),
  defaultLocale: text('default_locale').notNull(),
  alternateLocales: text('alternate_locales').array().notNull().default([]),
});
```

Changes to existing tables: `orders.presentment_currency` and `orders.presentment_rate`; `order_lines.presentment_price` (so a
later rate change never moves a paid order); `carts.market_id`, `carts.country_code`; a `domains` table (id, host, ssl, is_primary)
backing `Domain` (the MVP may synthesize one row from `shops.primaryDomain`). Backfill: one primary market (`handle = 'primary'`,
ACTIVE) and one `currency_settings` row for the shop currency per existing shop.

### 4.1 Market-localized content
Per-market overrides of translatable values (`marketLocalizationsRegister`) go to a later table `market_localizations`
(`marketId`, `resourceId`, `key`, `value`, `digest`); not MVP.

### 4.2 Rounding
After adjustment and conversion the local amount in minor units is rounded up to the next whole major unit when rounding is on.
Zero-decimal currencies already are whole. Rounding never applies to fixed prices, shipping or taxes. When off, round half away
from zero to the currency's minor unit. A currency exponent table is required (0, 2 and 3 decimals).

### 4.3 Currency setting rules
- `baseCurrency` must be an enabled currency from the supported list.
- A multi-country market uses `baseCurrency`; `localCurrencies = true` on it means each buyer sees the currency of their own
  country when we support it (country-currency table), else the base currency. Single-country markets always use the country's
  currency unless overridden.
- The primary market uses the shop currency (`PRIMARY_MARKET_USES_SHOP_CURRENCY`).

## 5. Admin GraphQL surface

### 5.1 Types (MVP)
`Market` (id, name, handle, status, enabled, primary, type, conditions, currencySettings, priceInclusions, regions, catalogs,
catalogsCount, priceList, webPresences, webPresence, metafield, metafields, createdAt), `MarketConditions` (conditionTypes,
regionsCondition), `MarketRegionCountry` (id, name, code, currency), `MarketRegion` interface, `MarketCurrencySettings`
(baseCurrency, localCurrencies, roundingEnabled), `CurrencySetting` (currencyCode, currencyName, enabled, manualRate,
rateUpdatedAt), `MarketPriceInclusions` (adaptivePricingEnabled always false, inclusiveTaxPricingStrategy,
inclusiveDutiesPricingStrategy), `MarketWebPresence` (id, domain, subfolderSuffix, defaultLocale, alternateLocales, rootUrls,
markets), `MarketWebPresenceRootUrl`, `Catalog` interface and `MarketCatalog` (id, title, status, priceList, publication,
markets, marketsCount), `PriceList` (id, name, currency, parent, catalog, fixedPricesCount, prices), `PriceListParent`,
`PriceListAdjustment`, `PriceListAdjustmentSettings`, `PriceListPrice` (price, compareAtPrice, originType, variant), and a
connection per list type.

Enums: `MarketStatus` (ACTIVE, DRAFT), `MarketType`, `MarketConditionType`, `MarketConditionApplicationType`, `CatalogStatus`,
`CatalogType`, `PriceListAdjustmentType`, `PriceListCompareAtMode`, `PriceListPriceOriginType`, `InclusiveTaxPricingStrategy`,
`InclusiveDutiesPricingStrategy`, `MarketsSortKeys` (CREATED_AT, ID, MARKET_CONDITION_TYPES, MARKET_TYPE, NAME, STATUS,
UPDATED_AT), `CatalogSortKeys`, `PriceListSortKeys`.

Extensions of existing types: `Shop.currencySettings`, `Shop.enabledPresentmentCurrencies`;
`Product.contextualPricing(context: ContextualPricingContext!)` and `ProductVariant.contextualPricing(context:)` returning
`ProductContextualPricing` / `ProductVariantContextualPricing` (price, compareAtPrice, minVariantPricing, maxVariantPricing,
priceRange; quantity rules and price breaks return empty defaults). Only `ContextualPricingContext.country` is honored.

### 5.2 Root fields
MVP: `market(id)`, `markets(first, type, sortKey, query)`, `marketByGeography(countryCode)`, `catalog(id)`, `catalogs(type, ...)`,
`catalogsCount`, `priceList(id)`, `priceLists`, `marketsResolvedValues(buyerSignal: BuyerSignalInput!)` (currency, price
inclusivity, web presences and catalogs for a country; handy for headless clients). Later: `webPresences`, `marketLocalizable*`,
`marketRelationships`.

Search for `markets(query:)`: `name:`, `status:`, `market_condition_types:`, `market_type:`, free text on name.

### 5.3 Mutations
MVP: `marketCreate`, `marketUpdate`, `marketDelete`, `marketRegionsCreate`, `marketRegionsDelete`, `marketRegionDelete`,
`marketCurrencySettingsUpdate(marketId, input)`, `catalogCreate`, `catalogUpdate`, `catalogDelete(id, deleteDependentResources)`,
`catalogContextUpdate(catalogId, contextsToAdd, contextsToRemove)`, `priceListCreate`, `priceListUpdate`, `priceListDelete`,
`priceListFixedPricesAdd`, `priceListFixedPricesUpdate`, `priceListFixedPricesDelete`, `priceListFixedPricesByProductUpdate`.
Later: `marketWebPresenceCreate/Update/Delete`, `webPresenceCreate/Update/Delete`, `marketLocalizationsRegister/Remove`.
Not planned: Function-based customizations, company-location contexts. `makeDuplicate*Draft` flags are accepted and ignored.

Inputs (exact field names): `MarketCreateInput { name, handle, enabled, status, regions: [MarketRegionCreateInput{countryCode}],
conditions, catalogs, webPresences, currencySettings, priceInclusions, discounts, delivery, returnPolicyProfileId }`;
`MarketUpdateInput` adds `catalogsToAdd/Delete`, `webPresencesToAdd/Delete`, `discountsToAdd/Delete`, `removeCurrencySettings`,
`removePriceInclusions`, `conditions: { conditionsToAdd, conditionsToDelete }`. `MarketCurrencySettingsUpdateInput { baseCurrency,
baseCurrencyManualRate, localCurrencies, roundingEnabled }`. `CatalogCreateInput { title, status, context: { marketIds },
priceListId, publicationId }`. `PriceListCreateInput { name, currency, parent: { adjustment: { type, value }, settings:
{ compareAtMode } }, catalogId }`. `PriceListPriceInput { variantId, price: MoneyInput, compareAtPrice: MoneyInput }`.
`delivery` is accepted and ignored in the MVP; `Market.delivery.shipping` is read-only (reflects shipping-profiles.md).

### 5.4 userErrors
Payloads: `MarketCreatePayload { market userErrors: [MarketUserError!]! }`, similarly for the other mutations; `MarketUserError`
has `field`, `message`, `code`.
MarketUserErrorCode we emit: `BLANK`, `TAKEN`, `TOO_LONG`, `TOO_SHORT`, `INVALID`, `MARKET_NOT_FOUND`, `REGION_NOT_FOUND`,
`UNSUPPORTED_COUNTRY_REGION`, `CANNOT_DELETE_PRIMARY_MARKET`, `CANNOT_DISABLE_PRIMARY_MARKET`, `CANNOT_ADD_REGIONS_TO_PRIMARY_MARKET`,
`CANNOT_DELETE_ONLY_REGION`, `DUPLICATE_REGION_MARKET`, `INVALID_STATUS_AND_ENABLED_COMBINATION`, `UNSUPPORTED_CURRENCY`,
`PRIMARY_MARKET_USES_SHOP_CURRENCY`, `NO_LOCAL_CURRENCIES_ON_SINGLE_COUNTRY_MARKET`, `SUBFOLDER_SUFFIX_MUST_CONTAIN_ONLY_LETTERS`,
`SUBFOLDER_SUFFIX_MUST_BE_AT_LEAST_2_LETTERS`, `SUBFOLDER_SUFFIX_CANNOT_BE_SCRIPT_CODE`, `CANNOT_HAVE_SUBFOLDER_AND_DOMAIN`,
`NO_LANGUAGES`, `DUPLICATE_LANGUAGES`, `UNPUBLISHED_LANGUAGE`, `DOMAIN_NOT_FOUND`, `WEB_PRESENCE_NOT_FOUND`,
`REQUIRES_DOMAIN_OR_SUBFOLDER`. The remaining values exist only for managed-market, B2B and channel features and are never emitted
(the enum still lists them so generated clients compile).
`CatalogUserErrorCode` we emit: `CATALOG_NOT_FOUND`, `MARKET_NOT_FOUND`, `PRICE_LIST_NOT_FOUND`, `MARKET_TAKEN`,
`MARKET_AND_PRICE_LIST_CURRENCY_MISMATCH`, `PRICE_LIST_NOT_ALLOWED_FOR_PRIMARY_MARKET`, `MUST_PROVIDE_EXACTLY_ONE_CONTEXT_TYPE`,
`REQUIRES_CONTEXTS_TO_ADD_OR_REMOVE`, `CANNOT_ADD_MORE_THAN_ONE_MARKET`, `BLANK`, `TAKEN`, `TOO_LONG`, `INVALID`.
`PriceListUserErrorCode`: `PRICE_LIST_NOT_FOUND`, `BLANK`, `TAKEN`, `INCLUSION`, `INVALID_ADJUSTMENT_VALUE`,
`INVALID_ADJUSTMENT_MIN_VALUE`, `INVALID_ADJUSTMENT_MAX_VALUE`, `CURRENCY_MARKET_MISMATCH`, `CATALOG_DOES_NOT_EXIST`, `CATALOG_TAKEN`,
`PRICE_LIST_NOT_ALLOWED_FOR_PRIMARY_MARKET`, `CURRENCY_NOT_SUPPORTED`. `PriceListPriceUserErrorCode`: `PRICE_LIST_NOT_FOUND`,
`VARIANT_NOT_FOUND`, `PRICE_LIST_CURRENCY_MISMATCH`, `PRICE_NOT_FIXED`, `BLANK`.

MVP vs later:
- MVP: markets with country regions, currency settings (manual rate, rounding), catalogs with price lists (percentage adjustment
  and fixed prices), price resolution in cart, checkout and Liquid, `contextualPricing`, `marketsResolvedValues`, presentment
  currency on orders, admin Markets pages (list, detail, currency popover, catalogs page).
- Later: web presences (domains and subfolders per market, hreflang), market translations, subdivision regions, per-catalog
  product publication, duties, market-scoped discounts, geolocation, live exchange rate provider.

## 6. Liquid and storefront impact

- `localization` object (currently languages only): add `country` (iso_code, name, currency { iso_code, name, symbol }, market
  { handle, id }), `language` (iso_code, name, endonym_name, root_url, primary), `available_countries` (countries of active
  markets, sorted by name, each with currency), `available_languages` (of the current web presence), `market` (handle, id).
- `cart.currency`, `shop.currency`, `shop.enabled_currencies` stay. `cart.currency.iso_code` is the presentment currency.
  Prices on `product`, `variant`, cart lines, collection pages come out in the presentment currency; `variant.price` is
  minor units as today.
- Money filters (`money`, `money_with_currency`, `money_without_currency`, `money_without_trailing_zeros`) need a per-currency
  format table; `shop.money_format` applies to the shop currency only; other currencies default to a generated `{{amount}} CODE`
  style from ISO data (symbol and separators per currency).
- Selector form: `POST /localization` with `country_code` (and `language_code`, `return_to`); sets the cookie and redirects.
- AJAX cart: `/cart.js` returns the cart currency and presentment minor-unit prices; `/products/<handle>.js` returns presentment
  prices. Themes read a JS global for the active currency and rate; we expose
  `window.Shopify = { currency: { active, rate }, country, locale }` for compatibility (rate = presentment per shop currency).
- Canonical and alternate-language tags and sitemap alternates per web presence, once those exist.

## 7. Edge cases

- Country in no market: primary market, shop currency. A draft market is invisible to buyers.
- Changing a market currency with open carts: carts re-price on next load; started checkouts keep their currency until completed
  or expired.
- Deleting a market with carts: they fall back to the primary market at next load.
- Refunds are in the order currency and limited by what was paid.
- Fixed price list currency differing from the market currency: reject at assignment.
- Compare-at lower than the computed price: drop compare-at.
- Zero-decimal and three-decimal currencies (JPY, KWD): never hard-code 2 decimals.
- Gift cards and store credit: single currency; unusable in another currency.
- Collection price filters and sorting use presentment prices; a buyer-entered range converts back to shop currency (later).
- A product with a fixed price in the list but a variant removed from the catalog's publication: not sold in that market (later).

## 8. Test plan

- Unit: rounding (2-, 0-, 3-decimal currencies, rounding on and off), adjustment up/down, compare-at modes, fixed-price
  precedence, rate conversion with half-cent cases.
- Service: country to market resolution (cookie, subfolder, shop country, no match); one-market-per-country constraint; primary
  market protections; backfill migration.
- API conformance: create/update/delete market, region add/remove, currency settings, catalog and price list lifecycle,
  `contextualPricing`, `marketsResolvedValues`; userError codes above; pagination, sort keys, query filters.
- Checkout: order created in CAD with USD shop currency has both `shopMoney` and `presentmentMoney`; refund in CAD; gift card
  blocked in other currency.
- Liquid: `localization.available_countries`, `localization.country.currency`, money filters per currency, selector form.
- Storefront: `POST /localization` cookie, cart re-pricing on country change.

## 9. Open questions (need captures)

Answered by the screenshots we have: list and detail layouts, currency override popover (shop currency case), shipping as a
market customization. Still open:
1. Create market flow (Markets list, "Create market"): the dialog or page, country picker, what happens when a country is
   already used by another market.
2. Currency popover with a non-shop currency selected (e.g. CAD or EUR chosen on a market): is an exchange rate field shown, the
   exact rounding wording, and where manual rates are managed.
3. Markets > Catalogs: list page and the edit page, including the price-list editor (adjustment percent, compare-at option, fixed prices
   table) and the product publication selector.
4. Domain and language override popover on a market, and the Discounts override popover.
5. API probe (no screenshot): `presentmentMoney` versus `shopMoney` on an order placed in a non-shop currency.
