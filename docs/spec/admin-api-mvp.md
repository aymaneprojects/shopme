# Admin GraphQL API: conventions and MVP subset

Status: draft. Inputs: the schema of API version **2026-10** obtained by introspection of our own development store, and
sample responses recorded from that store. Names (types, fields, enums, arguments) are listed for interoperability; no
descriptive text of the original schema is reproduced. "Sampled" means a field appeared in a recorded response;
"proposed" means we add it because the MVP needs it or because common clients ask for it (taken from the schema, not
from samples).

Goal: let existing tools that speak the Shopify Admin GraphQL dialect work against ShopMe for the catalog, customer,
inventory and order basics, with identical field names, types, nullability and error shapes where we implement them.
Anything not implemented must fail in a predictable way (a standard GraphQL validation error for unknown fields).

## 1. Conventions

### 1.1 Endpoint, authentication, versions

- One HTTP endpoint per API version, path of the form `/admin/api/<version>/graphql.json`, method POST, JSON body
  `{ "query", "variables", "operationName" }`. The credential travels in a request header (`X-Shopify-Access-Token`;
  public documentation).
- Access tokens were obtained with the **client-credentials grant** (app id + secret exchanged for a token). Observed:
  tokens **expire after 24 hours**, so clients must re-request; ShopMe should issue tokens with an `expires_in` and
  reject expired ones.
- **Versioning** is calendar based: `YYYY-MM`, one stable release per quarter (months 01, 04, 07, 10), each supported for
  a limited window (public docs), plus `unstable`. We study **2026-10**. ShopMe should mount the same schema under every
  version string it claims to support and answer unknown versions with the platform's fallback behavior (to be recorded).
- Responses use HTTP 200 for GraphQL-level errors (an `errors` array next to or instead of `data`); transport and
  authentication problems use 4xx/5xx statuses.

### 1.2 Global IDs

- Every `Node` has `id: ID!` of the form `gid://shopify/<TypeName>/<number>` (e.g. `gid://shopify/Product/1234567890123`).
  The number is a 64-bit integer allocated per resource type, shown as a decimal; the observed numbers are 11 to 14 digits.
- Many types also expose `legacyResourceId: UnsignedInt64!`, which serialises as a **string** containing the same number
  (the REST-style id). `Customer.numberOfOrders` is also an `UnsignedInt64` and serialises as a string.
- `node(id: ID!)` and `nodes(ids: [ID!]!)` resolve any GID to a `Node` (221 object types implement `Node`); the type
  name inside the GID selects the resolver. Unknown ids resolve to null.
- Inside a ShopMe database ids are plain `bigint` per table; the GID is a presentation format (see data-model.md).
  Because queries use ids typed `ID`, parse leniently: accept the full GID, and reject a GID whose type name does not match
  the argument's expected type with a user-visible error.

### 1.3 Connections and pagination

- A list field with potentially many items returns a `<Type>Connection` object (207 connection types in 2026-10) with:
  `edges { cursor node }`, `nodes` (shortcut for the node list) and `pageInfo { hasNextPage hasPreviousPage startCursor endCursor }`.
  All samples use only `nodes`.
- Standard arguments: `first: Int`, `after: String`, `last: Int`, `before: String`, `reverse: Boolean`; most also take
  `sortKey: <Type>SortKeys` and `query: String` (search syntax) and, on some roots, `savedSearchId: ID`. At most 250 items
  per page (public docs); asking for neither `first` nor `last` is an error.
- Cursors are opaque strings; they must remain valid across requests while the underlying sort key is stable.
- Counts are separate fields: `productsCount(query:, limit:)` returns `Count { count, precision }`, where precision is
  `EXACT` or `AT_LEAST` when a `limit` cut the count short. Nested counts like `Collection.productsCount` and
  `Product.variantsCount` return the same `Count` type (sampled: `productsCount { count }`).
- Some relations are plain lists with an optional `first` argument, not connections: `Product.options`,
  `Order.transactions`, `Order.fulfillments`, `Order.refunds`, `LineItem.taxLines`, `Fulfillment.trackingInfo`.
- The `query` argument takes a search string such as `status:active vendor:Acme` (field filters, comparison operators,
  AND/OR, wildcards, date ranges; public docs). Its grammar and per-resource filter names are a separate spec to write;
  the MVP list is: products `status`, `title`, `vendor`, `product_type`, `tag`, `handle`, `sku`, `created_at`,
  `updated_at`, `inventory_total`; collections `title`, `handle`, `collection_type`; customers `email`, `first_name`,
  `last_name`, `phone`, `state`, `tag`, `created_at`; orders `name`, `status`, `financial_status`,
  `fulfillment_status`, `email`, `tag`, `created_at` (names from public docs; to verify against our store).

### 1.4 Mutation payloads and `userErrors`

- Every mutation takes arguments (usually one `input` object, sometimes several scalars) and returns a `<Name>Payload`
  object. 534 of 537 mutations have a payload field `userErrors`; the three exceptions are `locationActivate`,
  `locationDeactivate`, `locationDelete`, which expose typed error lists under their own names (`locationActivateUserErrors`, `locationDeactivateUserErrors`, `locationDeleteUserErrors`).
- `userErrors: [UserError!]!` where `UserError { field: [String!], message: String! }`. `field` is a path into the input
  (e.g. `["input","title"]`), null when the error is not field-specific. Many mutations return a typed subtype with an extra
  `code` enum (232 object types implement the `DisplayableError` interface, which declares `field` and `message`);
  the subtype name is shown in the mutation table below.
- Validation problems are reported through `userErrors` with HTTP 200 and the main payload field null; unknown ids on
  update/delete mutations are expected to produce a `userErrors` entry rather than a top-level error (to verify).
- Payload objects also carry the mutated resource under a lower-camel field (`product`, `collection`, `customer`, ...) and,
  for deletes, a `deleted<Type>Id: ID`. Long operations return a `Job` or an `*Operation` (asynchronous) which clients
  poll; ShopMe may complete work synchronously and return a finished job object.
- Mutations cost 10 points each in addition to selected fields (public docs).

### 1.5 Scalars and money

| Scalar | Wire format | Notes |
|---|---|---|
| `ID` | string | GID, see above |
| `DateTime` | ISO 8601 UTC with `Z`, second precision (e.g. `2026-11-04T10:35:59Z`) | observed |
| `Decimal` | string | **Trailing zeros are trimmed**: observed `"19.9"`, `"0.0"`, `"885.95"` |
| `Money` | string | Used for variant `price`/`compareAtPrice` and money inputs; **two decimals kept**: observed `"19.90"`, `"600.00"` |
| `UnsignedInt64` | string | ids, order counts |
| `HTML`, `URL`, `JSON`, `Color`, `Date`, `FormattedString`, `StorefrontID`, `ARN` | string / JSON | other custom scalars (19 scalars in total including the built-ins) |

- `MoneyV2 { amount: Decimal!, currencyCode: CurrencyCode! }`; `MoneyBag { shopMoney: MoneyV2!, presentmentMoney: MoneyV2! }`.
  Fields whose name ends in `Set` (`totalPriceSet`, `originalUnitPriceSet`, `amountSet`, ...) return a `MoneyBag`: the same
  amount in the shop currency and in the customer's presentment currency. Both equal the shop currency in our store.
  Implement `presentmentMoney` even if equal to `shopMoney`.
- The shop's display format is a template with an amount placeholder (observed money format `${{amount}}` and
  with-currency format `${{amount}} USD`), exposed through `Shop.currencyFormats`.

### 1.6 Rate limiting (cost-based throttling)

Observed behavior, confirmed on a reference store:

- The response carries `extensions.cost = { requestedQueryCost, actualQueryCost, throttleStatus { maximumAvailable, currentlyAvailable, restoreRate } }`.
- **Bucket**: capacity 2000 points (`maximumAvailable`), refilling at **100 points per second** (`restoreRate`). A single
  query may not request more than **1000** points. The bucket level is reported as `currentlyAvailable`.
- `requestedQueryCost` is the cost computed from the query before execution (assuming each connection returns its full
  requested `first` items); `actualQueryCost` is recomputed from what was actually returned and is what is deducted.
  Samples: a shop+locations query had requested 9 / actual 6; a collections query with nested products requested 65 / actual 6;
  an orders query requested 242 / actual 6; a customers query requested 42 / actual 8.
- Cost model (public docs, to be reproduced and verified): scalar and enum fields 0, object fields 1, connections cost 2
  plus the requested page size times the cost of the node selection, mutations 10. When the bucket cannot cover the
  requested cost the request is rejected with a throttled error (code `THROTTLED`) and the client should retry later;
  requests above the 1000 cap are rejected up front (`MAX_COST_EXCEEDED`).
- ShopMe MVP: implement the accounting and the `extensions.cost` block; start with a per-token bucket in Redis.

### 1.7 Access scopes and error shapes

- Fields and mutations are gated by access scopes granted to the app (for example read/write for products, customers,
  orders, inventory, locations). When the token lacks the scope for a selected field, the request still executes: the
  response has a **top-level** `errors` entry with a message of the form *Access denied for `<field>` field. Required access:
  `<scope>` ...*, a `path` pointing at the field, and (per public docs) `extensions.code = "ACCESS_DENIED"` and a
  `documentation` URL; the field is null and the rest of the data is returned.
- Other top-level error cases (parse/validation errors, internal errors, throttling) follow the standard GraphQL
  `errors: [{ message, locations, path, extensions }]` shape.
- Scope names follow `read_<resource>` / `write_<resource>` (`write` implies `read`). Required scopes per field are not
  listed in this spec yet; they are available in the private schema dump as field descriptions and should be
  summarised in our own words when implemented.

### 1.8 Deprecations in 2026-10 that matter

The sampled queries use several fields that the 2026-10 schema marks deprecated. ShopMe must still serve them
(clients depend on them) but should document the replacements:

- `Shop.billingAddress` (use `shopAddress`), `Shop.productTypes/productVendors/productTags` (use the root fields).
- `ProductVariant.barcode` (use `barcodes`), `ProductVariant.image` (use `media`), `ProductVariant.taxCode`.
- `Collection.ruleSet` (use `sources`).
- `InventoryItem.variant` (use `variants`), `OrderTransaction.authorizationCode` (use `paymentId`).
- Root `productByHandle`, `collectionByHandle` (use the `...ByIdentifier` queries).
- Mutation arguments: `productCreate(input:)`, `productUpdate(input:)`, `collectionCreate(input:)`,
  `collectionUpdate(input:)` (use `product:` / `collection:`); `collectionAddProducts*`/`collectionRemoveProducts`
  (use `collectionUpdate` with inclusion selections); `productChangeStatus` (use `productUpdate`);
  `productPublish/Unpublish`, `collectionPublish/Unpublish` (use publishable mutations);
  `productCreateMedia/UpdateMedia/DeleteMedia` (use the `media` argument of product mutations).

## 2. Size of the API (set expectations)

| Item | Count in 2026-10 |
|---|---:|
| Object types | 2117 |
| Input object types | 759 |
| Enums | 693 |
| Interfaces | 61 |
| Unions | 59 |
| Scalars (incl. 5 built-in) | 19 |
| Connection types | 207 |
| Types implementing `Node` | 221 |
| Root query fields | 298 (20 deprecated) |
| Mutations | 537 (54 deprecated) |
| Fields declared on object types (sum) | about 9,400 |

Largest object types by field count in our MVP set: `Order` 154, `Product` 83, `Shop` 82, `ProductVariant` 53, `Customer` 49.
Mutation name prefixes by count: subscription* 37, product* 32, company* 31, fulfillment* 31, customer* 30, discount* 30,
order* 28, inventory* 27, collection* 13, draft* 12, market* 12. Whole areas out of MVP scope: B2B (company*), discounts,
markets and translations, subscriptions and selling plans administration, returns and exchanges, gift cards,
payments/customer payment methods, marketing, metaobjects, themes and files administration, bulk operations, webhooks
(needed later but separate spec), apps/billing, cash tracking, segments, shipping/delivery profiles.

The MVP below is **45 types, 210 sampled fields and 209 proposed fields** (about 4% of all object fields), 39 root fields and
55 mutations. A pragmatic first milestone is the P0 subset (25 queries, 23 mutations).
Priorities: P0 = needed for the first sellable store; P1 = needed for parity with common tools; P2 = later.

## 3. MVP object types and fields

Source column: "sampled" = observed in a recorded response from our store; "proposed" = chosen from the schema.
Types are quoted exactly as in the schema (`!` = non-null, `[T!]!` = non-null list of non-null). Unless noted, a
connection-typed field accepts the standard pagination arguments of 1.3; only extra or different arguments are listed.

### Shop

Query root: `shop`. Single object per tenant.

| Field | GraphQL type | Source | Notes |
|---|---|---|---|
| `id` | `ID!` | sampled |  |
| `name` | `String!` | sampled |  |
| `email` | `String!` | sampled |  |
| `myshopifyDomain` | `String!` | sampled |  |
| `primaryDomain` | `Domain!` | sampled |  |
| `currencyCode` | `CurrencyCode!` | sampled |  |
| `enabledPresentmentCurrencies` | `[CurrencyCode!]!` | sampled |  |
| `ianaTimezone` | `String!` | sampled |  |
| `weightUnit` | `WeightUnit!` | sampled |  |
| `unitSystem` | `UnitSystem!` | sampled |  |
| `taxesIncluded` | `Boolean!` | sampled |  |
| `taxShipping` | `Boolean!` | sampled |  |
| `billingAddress` | `ShopAddress!` | sampled | **deprecated** in 2026-10: Use `shopAddress` instead. |
| `currencyFormats` | `CurrencyFormats!` | sampled |  |
| `features` | `ShopFeatures!` | sampled |  |
| `url` | `URL!` | proposed |  |
| `contactEmail` | `String!` | proposed |  |
| `description` | `String` | proposed |  |
| `createdAt` | `DateTime!` | proposed |  |
| `updatedAt` | `DateTime!` | proposed |  |
| `shopPolicies` | `[ShopPolicy!]!` | proposed |  |
| `productTypes` | `StringConnection!` | proposed | args: first:Int!; **deprecated** in 2026-10: Use `QueryRoot.productTypes` instead. |
| `productVendors` | `StringConnection!` | proposed | args: first:Int!; **deprecated** in 2026-10: Use `QueryRoot.productVendors` instead. |
| `productTags` | `StringConnection!` | proposed | args: first:Int!; **deprecated** in 2026-10: Use `QueryRoot.productTags` instead. |
| `metafield` | `Metafield` | proposed | args: namespace:String, key:String! |
| `metafields` | `MetafieldConnection!` | proposed | args: namespace:String, keys:[String!], first:Int, after:String, last:Int, before:String, reverse:Boolean |

### Domain

Returned by `Shop.primaryDomain`.

| Field | GraphQL type | Source | Notes |
|---|---|---|---|
| `host` | `String!` | sampled |  |
| `url` | `URL!` | sampled |  |
| `id` | `ID!` | proposed |  |
| `sslEnabled` | `Boolean!` | proposed |  |

### ShopAddress

Returned by `Shop.billingAddress` (deprecated name) and `Shop.shopAddress`.

| Field | GraphQL type | Source | Notes |
|---|---|---|---|
| `countryCodeV2` | `CountryCode` | sampled |  |
| `city` | `String` | sampled |  |
| `address1` | `String` | proposed |  |
| `address2` | `String` | proposed |  |
| `province` | `String` | proposed |  |
| `provinceCode` | `String` | proposed |  |
| `zip` | `String` | proposed |  |
| `country` | `String` | proposed |  |
| `phone` | `String` | proposed |  |
| `company` | `String` | proposed |  |

### CurrencyFormats

Format templates with an `{{amount}}` placeholder (observed value for a reference store: a dollar sign followed by the placeholder).

| Field | GraphQL type | Source | Notes |
|---|---|---|---|
| `moneyFormat` | `FormattedString!` | sampled |  |
| `moneyWithCurrencyFormat` | `FormattedString!` | sampled |  |
| `moneyInEmailsFormat` | `String!` | proposed |  |
| `moneyWithCurrencyInEmailsFormat` | `String!` | proposed |  |

### ShopFeatures

Feature flags; only two observed.

| Field | GraphQL type | Source | Notes |
|---|---|---|---|
| `storefront` | `Boolean!` | sampled |  |
| `giftCards` | `Boolean!` | sampled |  |

### Product

Core catalog object.

| Field | GraphQL type | Source | Notes |
|---|---|---|---|
| `id` | `ID!` | sampled |  |
| `legacyResourceId` | `UnsignedInt64!` | sampled |  |
| `handle` | `String!` | sampled |  |
| `title` | `String!` | sampled |  |
| `status` | `ProductStatus!` | sampled |  |
| `vendor` | `String!` | sampled |  |
| `productType` | `String!` | sampled |  |
| `tags` | `[String!]!` | sampled |  |
| `descriptionHtml` | `HTML!` | sampled |  |
| `createdAt` | `DateTime!` | sampled |  |
| `updatedAt` | `DateTime!` | sampled |  |
| `publishedAt` | `DateTime` | sampled |  |
| `templateSuffix` | `String` | sampled |  |
| `seo` | `SEO!` | sampled |  |
| `options` | `[ProductOption!]!` | sampled | args: first:Int |
| `priceRangeV2` | `ProductPriceRangeV2!` | sampled |  |
| `featuredMedia` | `Media` | sampled |  |
| `media` | `MediaConnection!` | sampled | args: first:Int, after:String, last:Int, before:String, reverse:Boolean, sortKey:ProductMediaSortKeys, query:String |
| `collections` | `CollectionConnection!` | sampled | args: first:Int, after:String, last:Int, before:String, reverse:Boolean, sortKey:CollectionSortKeys, query:String |
| `metafields` | `MetafieldConnection!` | sampled | args: namespace:String, keys:[String!], first:Int, after:String, last:Int, before:String, reverse:Boolean |
| `variants` | `ProductVariantConnection!` | sampled | args: first:Int, after:String, last:Int, before:String, reverse:Boolean, sortKey:ProductVariantSortKeys |
| `description` | `String!` | proposed | args: truncateAt:Int |
| `onlineStoreUrl` | `URL` | proposed |  |
| `totalInventory` | `Int!` | proposed |  |
| `tracksInventory` | `Boolean!` | proposed |  |
| `hasOnlyDefaultVariant` | `Boolean!` | proposed |  |
| `hasOutOfStockVariants` | `Boolean!` | proposed |  |
| `variantsCount` | `Count` | proposed |  |
| `isGiftCard` | `Boolean!` | proposed |  |
| `requiresSellingPlan` | `Boolean!` | proposed |  |
| `compareAtPriceRange` | `ProductCompareAtPriceRange` | proposed |  |
| `giftCardTemplateSuffix` | `String` | proposed |  |
| `metafield` | `Metafield` | proposed | args: namespace:String, key:String! |
| `sellingPlanGroups` | `SellingPlanGroupConnection!` | proposed | args: first:Int, after:String, last:Int, before:String, reverse:Boolean |

### SEO

Search-engine title/description overrides (shared by Product and Collection).

| Field | GraphQL type | Source | Notes |
|---|---|---|---|
| `title` | `String` | sampled |  |
| `description` | `String` | sampled |  |

### ProductPriceRangeV2

Min/max of variant prices as `MoneyV2`.

| Field | GraphQL type | Source | Notes |
|---|---|---|---|
| `minVariantPrice` | `MoneyV2!` | sampled |  |
| `maxVariantPrice` | `MoneyV2!` | sampled |  |

### ProductOption

One option axis of a product (e.g. Color).

| Field | GraphQL type | Source | Notes |
|---|---|---|---|
| `id` | `ID!` | sampled |  |
| `name` | `String!` | sampled |  |
| `position` | `Int!` | sampled |  |
| `values` | `[String!]!` | sampled |  |
| `optionValues` | `[ProductOptionValue!]!` | sampled |  |

### ProductOptionValue

`ProductOption.optionValues` entries.

| Field | GraphQL type | Source | Notes |
|---|---|---|---|
| `id` | `ID!` | sampled |  |
| `name` | `String!` | sampled |  |
| `hasVariants` | `Boolean!` | sampled |  |
| `swatch` | `ProductOptionValueSwatch` | proposed |  |
| `linkedMetafieldValue` | `String` | proposed |  |

### ProductVariant

Sellable unit.

| Field | GraphQL type | Source | Notes |
|---|---|---|---|
| `id` | `ID!` | sampled |  |
| `legacyResourceId` | `UnsignedInt64!` | sampled |  |
| `title` | `String!` | sampled |  |
| `sku` | `String` | sampled |  |
| `barcode` | `String` | sampled | **deprecated** in 2026-10: Use `barcodes` instead. |
| `price` | `Money!` | sampled |  |
| `compareAtPrice` | `Money` | sampled |  |
| `position` | `Int!` | sampled |  |
| `taxable` | `Boolean!` | sampled |  |
| `inventoryPolicy` | `ProductVariantInventoryPolicy!` | sampled |  |
| `inventoryQuantity` | `Int` | sampled |  |
| `availableForSale` | `Boolean!` | sampled |  |
| `selectedOptions` | `[SelectedOption!]!` | sampled |  |
| `image` | `Image` | sampled | args: maxWidth:Int, maxHeight:Int, crop:CropRegion, scale:Int; **deprecated** in 2026-10: Use `media` instead. |
| `inventoryItem` | `InventoryItem!` | sampled |  |
| `product` | `Product!` | proposed |  |
| `createdAt` | `DateTime!` | proposed |  |
| `updatedAt` | `DateTime!` | proposed |  |
| `media` | `MediaConnection!` | proposed | args: first:Int, after:String, last:Int, before:String, reverse:Boolean |
| `displayName` | `String!` | proposed |  |
| `metafield` | `Metafield` | proposed | args: namespace:String, key:String! |
| `metafields` | `MetafieldConnection!` | proposed | args: namespace:String, keys:[String!], first:Int, after:String, last:Int, before:String, reverse:Boolean |
| `sellableOnlineQuantity` | `Int!` | proposed |  |
| `taxCode` | `String` | proposed | **deprecated** in 2026-10: This field should no longer be used in new integrations. This field will not be available  |
| `requiresComponents` | `Boolean!` | proposed |  |
| `sellingPlanGroups` | `SellingPlanGroupConnection!` | proposed | args: first:Int, after:String, last:Int, before:String, reverse:Boolean |

### SelectedOption

`ProductVariant.selectedOptions` entries.

| Field | GraphQL type | Source | Notes |
|---|---|---|---|
| `name` | `String!` | sampled |  |
| `value` | `String!` | sampled |  |
| `optionValue` | `ProductOptionValue!` | proposed |  |

### Image

Image reference (`url` plus dimensions).

| Field | GraphQL type | Source | Notes |
|---|---|---|---|
| `url` | `URL!` | sampled | args: transform:ImageTransformInput |
| `altText` | `String` | sampled |  |
| `width` | `Int` | sampled |  |
| `height` | `Int` | sampled |  |
| `id` | `ID` | proposed |  |

### Media (interface)

Interface implemented by `MediaImage`, `Video`, `ExternalVideo`, `Model3d`. `mediaContentType` is enum `MediaContentType` (IMAGE, VIDEO, EXTERNAL_VIDEO, MODEL_3D).

| Field | GraphQL type | Source | Notes |
|---|---|---|---|
| `id` | `ID!` | sampled |  |
| `alt` | `String` | sampled |  |
| `mediaContentType` | `MediaContentType!` | sampled |  |
| `status` | `MediaStatus!` | proposed |  |
| `preview` | `MediaPreviewImage` | proposed |  |

### MediaImage

The IMAGE implementation.

| Field | GraphQL type | Source | Notes |
|---|---|---|---|
| `image` | `Image` | sampled |  |
| `mimeType` | `String` | proposed |  |

### InventoryItem

Stock-keeping record attached 1:1 to a variant.

| Field | GraphQL type | Source | Notes |
|---|---|---|---|
| `id` | `ID!` | sampled |  |
| `tracked` | `Boolean!` | sampled |  |
| `requiresShipping` | `Boolean!` | sampled |  |
| `measurement` | `InventoryItemMeasurement!` | sampled |  |
| `countryCodeOfOrigin` | `CountryCode` | sampled |  |
| `harmonizedSystemCode` | `String` | sampled |  |
| `inventoryLevels` | `InventoryLevelConnection!` | sampled | args: includeInactive:Boolean, first:Int, after:String, last:Int, before:String, reverse:Boolean, query:String |
| `legacyResourceId` | `UnsignedInt64!` | proposed |  |
| `sku` | `String` | proposed |  |
| `variant` | `ProductVariant!` | proposed | **deprecated** in 2026-10: Use `variants` instead. |
| `unitCost` | `MoneyV2` | proposed |  |
| `provinceCodeOfOrigin` | `String` | proposed |  |
| `createdAt` | `DateTime!` | proposed |  |
| `updatedAt` | `DateTime!` | proposed |  |
| `inventoryLevel` | `InventoryLevel` | proposed | args: locationId:ID!, includeInactive:Boolean |
| `locationsCount` | `Count` | proposed |  |

### InventoryItemMeasurement

Wraps weight.

| Field | GraphQL type | Source | Notes |
|---|---|---|---|
| `weight` | `Weight` | sampled |  |
| `id` | `ID!` | proposed |  |

### Weight

`unit` is enum `WeightUnit`.

| Field | GraphQL type | Source | Notes |
|---|---|---|---|
| `unit` | `WeightUnit!` | sampled |  |
| `value` | `Float!` | sampled |  |

### InventoryLevel

Stock of one item at one location.

| Field | GraphQL type | Source | Notes |
|---|---|---|---|
| `location` | `Location!` | sampled |  |
| `quantities` | `[InventoryQuantity!]!` | sampled | args: names:[String!]! |
| `id` | `ID!` | proposed |  |
| `item` | `InventoryItem!` | proposed |  |
| `createdAt` | `DateTime!` | proposed |  |
| `updatedAt` | `DateTime!` | proposed |  |
| `canDeactivate` | `Boolean!` | proposed |  |
| `isActive` | `Boolean!` | proposed |  |

### InventoryQuantity

One named quantity. Names observed: `available`, `on_hand`, `committed`, `incoming`, `reserved`. Requested via `quantities(names: [...])`.

| Field | GraphQL type | Source | Notes |
|---|---|---|---|
| `name` | `String!` | sampled |  |
| `quantity` | `Int!` | sampled |  |
| `id` | `ID!` | proposed |  |
| `updatedAt` | `DateTime` | proposed |  |

### Location

Place that holds stock / fulfills orders.

| Field | GraphQL type | Source | Notes |
|---|---|---|---|
| `id` | `ID!` | sampled |  |
| `name` | `String!` | sampled |  |
| `isActive` | `Boolean!` | sampled |  |
| `fulfillsOnlineOrders` | `Boolean!` | sampled |  |
| `address` | `LocationAddress!` | sampled |  |
| `legacyResourceId` | `UnsignedInt64!` | proposed |  |
| `isFulfillmentService` | `Boolean!` | proposed |  |
| `shipsInventory` | `Boolean!` | proposed |  |
| `hasActiveInventory` | `Boolean!` | proposed |  |
| `createdAt` | `DateTime!` | proposed |  |
| `updatedAt` | `DateTime!` | proposed |  |
| `inventoryLevels` | `InventoryLevelConnection!` | proposed | args: includeInactive:Boolean, first:Int, after:String, last:Int, before:String, reverse:Boolean, query:String |
| `metafield` | `Metafield` | proposed | args: namespace:String, key:String! |

### LocationAddress

Location address.

| Field | GraphQL type | Source | Notes |
|---|---|---|---|
| `city` | `String` | sampled |  |
| `countryCode` | `String` | sampled |  |
| `address1` | `String` | proposed |  |
| `address2` | `String` | proposed |  |
| `province` | `String` | proposed |  |
| `provinceCode` | `String` | proposed |  |
| `zip` | `String` | proposed |  |
| `country` | `String` | proposed |  |
| `phone` | `String` | proposed |  |
| `formatted` | `[String!]!` | proposed |  |

### Collection

Manual or smart (rule-based) collection.

| Field | GraphQL type | Source | Notes |
|---|---|---|---|
| `id` | `ID!` | sampled |  |
| `handle` | `String!` | sampled |  |
| `title` | `String!` | sampled |  |
| `descriptionHtml` | `HTML!` | sampled |  |
| `sortOrder` | `CollectionSortOrder!` | sampled |  |
| `templateSuffix` | `String` | sampled |  |
| `updatedAt` | `DateTime!` | sampled |  |
| `productsCount` | `Count` | sampled |  |
| `ruleSet` | `CollectionRuleSet` | sampled | **deprecated** in 2026-10: Use `sources` instead. |
| `image` | `Image` | sampled | args: maxWidth:Int, maxHeight:Int, crop:CropRegion, scale:Int |
| `seo` | `SEO!` | sampled |  |
| `products` | `ProductConnection!` | sampled | args: first:Int, after:String, last:Int, before:String, reverse:Boolean, sortKey:ProductCollectionSortKeys |
| `legacyResourceId` | `UnsignedInt64!` | proposed |  |
| `description` | `String!` | proposed | args: truncateAt:Int |
| `hasProduct` | `Boolean!` | proposed | args: id:ID! |
| `metafield` | `Metafield` | proposed | args: namespace:String, key:String! |
| `metafields` | `MetafieldConnection!` | proposed | args: namespace:String, keys:[String!], first:Int, after:String, last:Int, before:String, reverse:Boolean |

### CollectionRuleSet

Present only on smart collections (null on manual).

| Field | GraphQL type | Source | Notes |
|---|---|---|---|
| `appliedDisjunctively` | `Boolean!` | sampled |  |
| `rules` | `[CollectionRule!]!` | sampled |  |

### CollectionRule

One rule.

| Field | GraphQL type | Source | Notes |
|---|---|---|---|
| `column` | `CollectionRuleColumn!` | sampled |  |
| `relation` | `CollectionRuleRelation!` | sampled |  |
| `condition` | `String!` | sampled |  |
| `conditionObject` | `CollectionRuleConditionObject` | proposed |  |

### Customer

Registered customer.

| Field | GraphQL type | Source | Notes |
|---|---|---|---|
| `id` | `ID!` | sampled |  |
| `legacyResourceId` | `UnsignedInt64!` | sampled |  |
| `firstName` | `String` | sampled |  |
| `lastName` | `String` | sampled |  |
| `displayName` | `String!` | sampled |  |
| `locale` | `String!` | sampled |  |
| `note` | `String` | sampled |  |
| `tags` | `[String!]!` | sampled |  |
| `state` | `CustomerState!` | sampled |  |
| `verifiedEmail` | `Boolean!` | sampled |  |
| `taxExempt` | `Boolean!` | sampled |  |
| `createdAt` | `DateTime!` | sampled |  |
| `defaultEmailAddress` | `CustomerEmailAddress` | sampled |  |
| `defaultPhoneNumber` | `CustomerPhoneNumber` | sampled |  |
| `numberOfOrders` | `UnsignedInt64!` | sampled |  |
| `amountSpent` | `MoneyV2!` | sampled |  |
| `addressesV2` | `MailingAddressConnection!` | sampled | args: first:Int, after:String, last:Int, before:String, reverse:Boolean |
| `updatedAt` | `DateTime!` | proposed |  |
| `defaultAddress` | `MailingAddress` | proposed |  |
| `orders` | `OrderConnection!` | proposed | args: first:Int, after:String, last:Int, before:String, reverse:Boolean, sortKey:OrderSortKeys, query:String |
| `metafield` | `Metafield` | proposed | args: namespace:String, key:String! |
| `metafields` | `MetafieldConnection!` | proposed | args: namespace:String, keys:[String!], first:Int, after:String, last:Int, before:String, reverse:Boolean |
| `canDelete` | `Boolean!` | proposed |  |
| `lastOrder` | `Order` | proposed |  |

### CustomerEmailAddress

`Customer.defaultEmailAddress`.

| Field | GraphQL type | Source | Notes |
|---|---|---|---|
| `emailAddress` | `String!` | sampled |  |
| `marketingState` | `CustomerEmailAddressMarketingState!` | sampled |  |
| `marketingOptInLevel` | `CustomerMarketingOptInLevel` | proposed |  |
| `marketingUpdatedAt` | `DateTime` | proposed |  |
| `validFormat` | `Boolean!` | proposed |  |

### CustomerPhoneNumber

`Customer.defaultPhoneNumber`.

| Field | GraphQL type | Source | Notes |
|---|---|---|---|
| `phoneNumber` | `String!` | sampled |  |
| `marketingState` | `CustomerSmsMarketingState!` | proposed | **deprecated** in 2026-10: Use `smsMarketingConsent.state` instead. |

### MailingAddress

Customer and order addresses.

| Field | GraphQL type | Source | Notes |
|---|---|---|---|
| `address1` | `String` | sampled |  |
| `address2` | `String` | sampled |  |
| `city` | `String` | sampled |  |
| `zip` | `String` | sampled |  |
| `province` | `String` | sampled |  |
| `provinceCode` | `String` | sampled |  |
| `countryCodeV2` | `CountryCode` | sampled |  |
| `name` | `String` | sampled |  |
| `id` | `ID!` | proposed |  |
| `firstName` | `String` | proposed |  |
| `lastName` | `String` | proposed |  |
| `company` | `String` | proposed |  |
| `phone` | `String` | proposed |  |
| `country` | `String` | proposed |  |
| `formatted` | `[String!]!` | proposed | args: withName:Boolean, withCompany:Boolean |
| `latitude` | `Float` | proposed |  |
| `longitude` | `Float` | proposed |  |

### Order

Order.

| Field | GraphQL type | Source | Notes |
|---|---|---|---|
| `id` | `ID!` | sampled |  |
| `legacyResourceId` | `UnsignedInt64!` | sampled |  |
| `name` | `String!` | sampled |  |
| `createdAt` | `DateTime!` | sampled |  |
| `processedAt` | `DateTime!` | sampled |  |
| `cancelledAt` | `DateTime` | sampled |  |
| `closedAt` | `DateTime` | sampled |  |
| `test` | `Boolean!` | sampled |  |
| `displayFinancialStatus` | `OrderDisplayFinancialStatus` | sampled |  |
| `displayFulfillmentStatus` | `OrderDisplayFulfillmentStatus!` | sampled |  |
| `confirmed` | `Boolean!` | sampled |  |
| `currencyCode` | `CurrencyCode!` | sampled |  |
| `presentmentCurrencyCode` | `CurrencyCode!` | sampled |  |
| `taxesIncluded` | `Boolean!` | sampled |  |
| `email` | `String` | sampled |  |
| `phone` | `String` | sampled |  |
| `note` | `String` | sampled |  |
| `tags` | `[String!]!` | sampled |  |
| `sourceName` | `String` | sampled |  |
| `subtotalPriceSet` | `MoneyBag` | sampled |  |
| `totalPriceSet` | `MoneyBag!` | sampled |  |
| `totalTaxSet` | `MoneyBag` | sampled |  |
| `totalShippingPriceSet` | `MoneyBag!` | sampled |  |
| `totalDiscountsSet` | `MoneyBag` | sampled |  |
| `totalRefundedSet` | `MoneyBag!` | sampled |  |
| `customer` | `Customer` | sampled |  |
| `shippingAddress` | `MailingAddress` | sampled |  |
| `billingAddress` | `MailingAddress` | sampled |  |
| `lineItems` | `LineItemConnection!` | sampled | args: first:Int, after:String, last:Int, before:String, reverse:Boolean |
| `shippingLines` | `ShippingLineConnection!` | sampled | args: includeRemovals:Boolean, first:Int, after:String, last:Int, before:String, reverse:Boolean |
| `discountApplications` | `DiscountApplicationConnection!` | sampled | args: first:Int, after:String, last:Int, before:String, reverse:Boolean |
| `transactions` | `[OrderTransaction!]!` | sampled | args: first:Int, capturable:Boolean, manuallyResolvable:Boolean |
| `fulfillments` | `[Fulfillment!]!` | sampled | args: first:Int, query:String |
| `refunds` | `[Refund!]!` | sampled | args: first:Int |
| `updatedAt` | `DateTime!` | proposed |  |
| `cancelReason` | `OrderCancelReason` | proposed |  |
| `currentTotalPriceSet` | `MoneyBag!` | proposed |  |
| `currentSubtotalPriceSet` | `MoneyBag!` | proposed |  |
| `totalReceivedSet` | `MoneyBag!` | proposed |  |
| `netPaymentSet` | `MoneyBag!` | proposed |  |
| `fulfillmentOrders` | `FulfillmentOrderConnection!` | proposed | args: displayable:Boolean, first:Int, after:String, last:Int, before:String, reverse:Boolean, query:String |
| `metafield` | `Metafield` | proposed | args: namespace:String, key:String! |
| `metafields` | `MetafieldConnection!` | proposed | args: namespace:String, keys:[String!], first:Int, after:String, last:Int, before:String, reverse:Boolean |
| `customerLocale` | `String` | proposed |  |

### LineItem

Order line.

| Field | GraphQL type | Source | Notes |
|---|---|---|---|
| `id` | `ID!` | sampled |  |
| `name` | `String!` | sampled |  |
| `title` | `String!` | sampled |  |
| `quantity` | `Int!` | sampled |  |
| `sku` | `String` | sampled |  |
| `variantTitle` | `String` | sampled |  |
| `vendor` | `String` | sampled |  |
| `requiresShipping` | `Boolean!` | sampled |  |
| `taxable` | `Boolean!` | sampled |  |
| `originalUnitPriceSet` | `MoneyBag!` | sampled |  |
| `discountedTotalSet` | `MoneyBag!` | sampled | args: withCodeDiscounts:Boolean |
| `taxLines` | `[TaxLine!]!` | sampled | args: first:Int |
| `variant` | `ProductVariant` | sampled |  |
| `product` | `Product` | sampled |  |
| `currentQuantity` | `Int!` | proposed |  |
| `nonFulfillableQuantity` | `Int!` | proposed |  |
| `refundableQuantity` | `Int!` | proposed |  |
| `unfulfilledQuantity` | `Int!` | proposed |  |
| `image` | `Image` | proposed | args: maxWidth:Int, maxHeight:Int, crop:CropRegion, scale:Int |
| `customAttributes` | `[Attribute!]!` | proposed |  |
| `discountAllocations` | `[DiscountAllocation!]!` | proposed |  |
| `originalTotalSet` | `MoneyBag!` | proposed |  |
| `isGiftCard` | `Boolean!` | proposed |  |

### TaxLine

Tax applied to a line or shipping line (empty in samples).

| Field | GraphQL type | Source | Notes |
|---|---|---|---|
| `title` | `String!` | proposed |  |
| `rate` | `Float` | proposed |  |
| `ratePercentage` | `Float` | proposed |  |
| `priceSet` | `MoneyBag!` | proposed |  |
| `channelLiable` | `Boolean` | proposed |  |

### ShippingLine

Order shipping charge (empty in samples).

| Field | GraphQL type | Source | Notes |
|---|---|---|---|
| `id` | `ID` | proposed |  |
| `title` | `String!` | proposed |  |
| `code` | `String` | proposed |  |
| `originalPriceSet` | `MoneyBag!` | proposed |  |
| `discountedPriceSet` | `MoneyBag!` | proposed |  |
| `taxLines` | `[TaxLine!]!` | proposed |  |

### OrderTransaction (the "Transaction" of the brief)

Payment event. Note `Order.transactions` is a plain list, not a connection.

| Field | GraphQL type | Source | Notes |
|---|---|---|---|
| `id` | `ID!` | sampled |  |
| `kind` | `OrderTransactionKind!` | sampled |  |
| `status` | `OrderTransactionStatus!` | sampled |  |
| `gateway` | `String` | sampled |  |
| `amountSet` | `MoneyBag!` | sampled |  |
| `createdAt` | `DateTime!` | sampled |  |
| `test` | `Boolean!` | sampled |  |
| `processedAt` | `DateTime` | proposed |  |
| `errorCode` | `OrderTransactionErrorCode` | proposed |  |
| `authorizationCode` | `String` | proposed | **deprecated** in 2026-10: Use `paymentId` instead. |
| `parentTransaction` | `OrderTransaction` | proposed |  |
| `order` | `Order` | proposed |  |
| `paymentId` | `String` | proposed |  |

### Fulfillment

Not present in samples (empty arrays); fields chosen from the schema.

| Field | GraphQL type | Source | Notes |
|---|---|---|---|
| `id` | `ID!` | proposed |  |
| `legacyResourceId` | `UnsignedInt64!` | proposed |  |
| `name` | `String!` | proposed |  |
| `status` | `FulfillmentStatus!` | proposed |  |
| `displayStatus` | `FulfillmentDisplayStatus` | proposed |  |
| `createdAt` | `DateTime!` | proposed |  |
| `updatedAt` | `DateTime!` | proposed |  |
| `trackingInfo` | `[FulfillmentTrackingInfo!]!` | proposed | args: first:Int |
| `fulfillmentLineItems` | `FulfillmentLineItemConnection!` | proposed | args: first:Int, after:String, last:Int, before:String, reverse:Boolean |
| `totalQuantity` | `Int!` | proposed |  |
| `location` | `Location` | proposed |  |
| `order` | `Order!` | proposed |  |
| `service` | `FulfillmentService` | proposed |  |
| `deliveredAt` | `DateTime` | proposed |  |

### FulfillmentTrackingInfo

Tracking details.

| Field | GraphQL type | Source | Notes |
|---|---|---|---|
| `company` | `String` | proposed |  |
| `number` | `String` | proposed |  |
| `url` | `URL` | proposed |  |

### FulfillmentLineItem

Line fulfilled.

| Field | GraphQL type | Source | Notes |
|---|---|---|---|
| `id` | `ID!` | proposed |  |
| `lineItem` | `LineItem!` | proposed |  |
| `quantity` | `Int` | proposed |  |
| `originalTotalSet` | `MoneyBag!` | proposed |  |
| `discountedTotalSet` | `MoneyBag!` | proposed |  |

### Refund

Not present in samples; fields chosen from the schema.

| Field | GraphQL type | Source | Notes |
|---|---|---|---|
| `id` | `ID!` | proposed |  |
| `legacyResourceId` | `UnsignedInt64!` | proposed |  |
| `createdAt` | `DateTime` | proposed |  |
| `updatedAt` | `DateTime!` | proposed |  |
| `note` | `String` | proposed |  |
| `totalRefundedSet` | `MoneyBag!` | proposed |  |
| `refundLineItems` | `RefundLineItemConnection!` | proposed | args: first:Int, after:String, last:Int, before:String, reverse:Boolean |
| `transactions` | `OrderTransactionConnection!` | proposed | args: first:Int, after:String, last:Int, before:String, reverse:Boolean |
| `order` | `Order!` | proposed |  |
| `duties` | `[RefundDuty!]` | proposed |  |

### RefundLineItem

Line refunded.

| Field | GraphQL type | Source | Notes |
|---|---|---|---|
| `id` | `ID` | proposed |  |
| `lineItem` | `LineItem!` | proposed |  |
| `quantity` | `Int!` | proposed |  |
| `restockType` | `RefundLineItemRestockType!` | proposed |  |
| `restocked` | `Boolean!` | proposed |  |
| `location` | `Location` | proposed |  |
| `priceSet` | `MoneyBag!` | proposed |  |
| `subtotalSet` | `MoneyBag!` | proposed |  |
| `totalTaxSet` | `MoneyBag!` | proposed |  |

### Metafield

Custom data attached to a resource.

| Field | GraphQL type | Source | Notes |
|---|---|---|---|
| `namespace` | `String!` | sampled |  |
| `key` | `String!` | sampled |  |
| `type` | `String!` | sampled |  |
| `value` | `String!` | sampled |  |
| `id` | `ID!` | proposed |  |
| `jsonValue` | `JSON!` | proposed |  |
| `createdAt` | `DateTime!` | proposed |  |
| `updatedAt` | `DateTime!` | proposed |  |
| `ownerType` | `MetafieldOwnerType!` | proposed |  |
| `definition` | `MetafieldDefinition` | proposed |  |
| `description` | `String` | proposed | **deprecated** in 2026-10: This field will be removed in a future release. Use the `description` on the metafield def |

### MoneyV2

`amount: Decimal!` (string on the wire), `currencyCode: CurrencyCode!`.

| Field | GraphQL type | Source | Notes |
|---|---|---|---|
| `amount` | `Decimal!` | sampled |  |
| `currencyCode` | `CurrencyCode!` | sampled |  |

### MoneyBag

`shopMoney` and `presentmentMoney`; samples only select `shopMoney`.

| Field | GraphQL type | Source | Notes |
|---|---|---|---|
| `shopMoney` | `MoneyV2!` | sampled |  |
| `presentmentMoney` | `MoneyV2!` | proposed |  |

### PageInfo

Pagination info.

| Field | GraphQL type | Source | Notes |
|---|---|---|---|
| `hasNextPage` | `Boolean!` | proposed |  |
| `hasPreviousPage` | `Boolean!` | proposed |  |
| `startCursor` | `String` | proposed |  |
| `endCursor` | `String` | proposed |  |

### Count

`count` + `precision` (enum EXACT, AT_LEAST). Returned by `*Count` queries and `productsCount`-style fields.

| Field | GraphQL type | Source | Notes |
|---|---|---|---|
| `count` | `Int!` | sampled |  |
| `precision` | `CountPrecision!` | proposed |  |


### 3.1 Smart collection rules

A collection is *smart* when `ruleSet` is non-null (`CollectionRuleSet { appliedDisjunctively: Boolean!, rules: [CollectionRule!]! }`).
`appliedDisjunctively` false = all rules must match (AND); true = any rule matches (OR). A rule is
`(column, relation, condition)` where `condition` is always a string (numbers and prices are written as decimal strings,
e.g. a price threshold). The sampled smart collection used two `VARIANT_PRICE` rules (one `LESS_THAN`, one `GREATER_THAN`),
combined with AND, and matched 8 products. The rule input types are `CollectionRuleSetInput` and `CollectionRuleInput`
(`column`, `relation`, `condition`, optional `conditionObjectId` for references to metaobjects/definitions).

Column values: `TAG`, `TITLE`, `TYPE`, `VENDOR`, `VARIANT_PRICE`, `IS_PRICE_REDUCED`, `VARIANT_COMPARE_AT_PRICE`,
`VARIANT_WEIGHT`, `VARIANT_INVENTORY`, `VARIANT_TITLE`, `PRODUCT_TAXONOMY_NODE_ID`, `PRODUCT_CATEGORY_ID`,
`PRODUCT_CATEGORY_ID_WITH_DESCENDANTS`, `PRODUCT_METAFIELD_DEFINITION`, `VARIANT_METAFIELD_DEFINITION`.
Relation values: `EQUALS`, `NOT_EQUALS`, `GREATER_THAN`, `LESS_THAN`, `STARTS_WITH`, `ENDS_WITH`, `CONTAINS`,
`NOT_CONTAINS`, `IS_SET`, `IS_NOT_SET`. Not every relation is valid for every column (text columns: equals, not equals,
starts/ends with, contains, not contains; numeric columns: equals, not equals, greater/less than; `IS_PRICE_REDUCED`:
equals; tag/metafield: also set/not set) — the exact validity matrix must be recorded from the store before implementing
validation. MVP suggestion: implement TAG, TITLE, TYPE, VENDOR, VARIANT_PRICE, VARIANT_COMPARE_AT_PRICE, VARIANT_INVENTORY,
VARIANT_TITLE, IS_PRICE_REDUCED, VARIANT_WEIGHT and defer the taxonomy and metafield columns. Membership of smart
collections is computed (re-evaluated when products change), manual collections hold an explicit ordered list.

### 3.2 Enum reference

| Enum | Values |
|---|---|
| `ProductStatus` | `ACTIVE`, `ARCHIVED`, `DRAFT`, `UNLISTED` |
| `ProductVariantInventoryPolicy` | `DENY`, `CONTINUE` |
| `CollectionSortOrder` | `ALPHA_ASC`, `ALPHA_DESC`, `BEST_SELLING`, `MOST_RELEVANT`, `CREATED`, `CREATED_DESC`, `MANUAL`, `PRICE_ASC`, `PRICE_DESC` |
| `CollectionRuleColumn` | `TAG`, `TITLE`, `TYPE`, `PRODUCT_TAXONOMY_NODE_ID`, `PRODUCT_CATEGORY_ID`, `PRODUCT_CATEGORY_ID_WITH_DESCENDANTS`, `VENDOR`, `VARIANT_PRICE`, `IS_PRICE_REDUCED`, `VARIANT_COMPARE_AT_PRICE`, `VARIANT_WEIGHT`, `VARIANT_INVENTORY`, `VARIANT_TITLE`, `PRODUCT_METAFIELD_DEFINITION`, `VARIANT_METAFIELD_DEFINITION` |
| `CollectionRuleRelation` | `CONTAINS`, `ENDS_WITH`, `EQUALS`, `GREATER_THAN`, `IS_NOT_SET`, `IS_SET`, `LESS_THAN`, `NOT_CONTAINS`, `NOT_EQUALS`, `STARTS_WITH` |
| `CustomerState` | `DECLINED`, `DISABLED`, `ENABLED`, `INVITED` |
| `CustomerEmailMarketingState` | `NOT_SUBSCRIBED`, `PENDING`, `SUBSCRIBED`, `UNSUBSCRIBED`, `REDACTED`, `INVALID` |
| `OrderDisplayFinancialStatus` | `PENDING`, `AUTHORIZED`, `PARTIALLY_PAID`, `PARTIALLY_REFUNDED`, `VOIDED`, `PAID`, `REFUNDED`, `EXPIRED` |
| `OrderDisplayFulfillmentStatus` | `UNFULFILLED`, `PARTIALLY_FULFILLED`, `FULFILLED`, `RESTOCKED`, `PENDING_FULFILLMENT`, `OPEN`, `IN_PROGRESS`, `ON_HOLD`, `SCHEDULED`, `REQUEST_DECLINED`, `FULFILLMENT_NOT_REQUIRED` |
| `OrderTransactionKind` | `SALE`, `CAPTURE`, `AUTHORIZATION`, `VOID`, `REFUND`, `CHANGE`, `EMV_AUTHORIZATION`, `SUGGESTED_REFUND` |
| `OrderTransactionStatus` | `SUCCESS`, `FAILURE`, `PENDING`, `ERROR`, `AWAITING_RESPONSE`, `UNKNOWN` |
| `FulfillmentStatus` | `PENDING` (deprecated), `OPEN` (deprecated), `SUCCESS`, `CANCELLED`, `ERROR`, `FAILURE` |
| `FulfillmentDisplayStatus` | `ATTEMPTED_DELIVERY`, `CANCELED`, `CONFIRMED`, `DELAYED`, `DELIVERED`, `FAILURE`, `FULFILLED`, `CARRIER_PICKED_UP`, `IN_TRANSIT`, `LABEL_PRINTED`, `LABEL_PURCHASED`, `LABEL_VOIDED`, `MARKED_AS_FULFILLED`, `NOT_DELIVERED`, `OUT_FOR_DELIVERY`, `READY_FOR_PICKUP`, `PICKED_UP`, `SUBMITTED` |
| `OrderCancelReason` | `CUSTOMER`, `DECLINED`, `FRAUD`, `INVENTORY`, `STAFF`, `OTHER` |
| `WeightUnit` | `KILOGRAMS`, `GRAMS`, `POUNDS`, `OUNCES` |
| `UnitSystem` | `IMPERIAL_SYSTEM`, `METRIC_SYSTEM` |
| `MediaContentType` | `VIDEO`, `EXTERNAL_VIDEO`, `MODEL_3D`, `IMAGE` |
| `CountPrecision` | `EXACT`, `AT_LEAST` |
| `ProductSortKeys` | `CREATED_AT`, `ID`, `INVENTORY_TOTAL`, `PRODUCT_TYPE`, `PUBLISHED_AT`, `RELEVANCE`, `TITLE`, `UPDATED_AT`, `VENDOR` |
| `CollectionSortKeys` | `ID`, `RELEVANCE`, `TITLE`, `UPDATED_AT` |
| `CustomerSortKeys` | `CREATED_AT`, `ID`, `LOCATION`, `NAME`, `RELEVANCE`, `UPDATED_AT` |
| `OrderSortKeys` | `CREATED_AT`, `CURRENT_TOTAL_PRICE`, `CUSTOMER_NAME`, `DESTINATION`, `FINANCIAL_STATUS`, `FULFILLMENT_STATUS`, `ID`, `ORDER_NUMBER`, `PO_NUMBER`, `PROCESSED_AT`, `RELEVANCE`, `TOTAL_ITEMS_QUANTITY`, `TOTAL_PRICE`, `UPDATED_AT` |
| `ProductVariantSortKeys` | `CREATED_AT`, `FULL_TITLE`, `ID`, `INVENTORY_LEVELS_AVAILABLE`, `INVENTORY_MANAGEMENT`, `INVENTORY_POLICY`, `INVENTORY_QUANTITY`, `NAME`, `POPULAR`, `POSITION`, `RELEVANCE`, `SKU`, `TITLE` |
| `LocationSortKeys` | `CREATED_AT`, `ID`, `NAME`, `RELEVANCE` |
| `ProductCollectionSortKeys` | `BEST_SELLING`, `COLLECTION_DEFAULT`, `CREATED`, `ID`, `MANUAL`, `PRICE`, `RELEVANCE`, `TITLE` |
| `MetafieldOwnerType` | `API_PERMISSION`, `COMPANY`, `COMPANY_LOCATION`, `PAYMENT_CUSTOMIZATION`, `VALIDATION`, `CUSTOMER`, `DELIVERY_CUSTOMIZATION`, `DRAFTORDER`, `GIFT_CARD_TRANSACTION`, `TRANSFER`, `MARKET`, `CARTTRANSFORM`, `COLLECTION`, `MEDIA_IMAGE` (deprecated), `PRODUCT`, `PRODUCTVARIANT`, `SELLING_PLAN`, `ARTICLE`, `BLOG`, `PAGE`, `FULFILLMENT_CONSTRAINT_RULE`, `ORDER_ROUTING_LOCATION_RULE`, `DISCOUNT`, `ORDER`, `LOCATION`, `SHOP` |
| `ProductVariantsBulkCreateStrategy` | `DEFAULT`, `REMOVE_STANDALONE_VARIANT`, `PRESERVE_STANDALONE_VARIANT` |

Note `ProductStatus` has a fourth value `UNLISTED` in this version; it did not occur in samples.

## 4. Root query fields

| Root field | Arguments | Returns | Prio |
|---|---|---|---|
| `shop` | none | `Shop!` | P0 |
| `node` | `id: ID!` | `Node` | P0 |
| `nodes` | `ids: [ID!]!` | `[Node]!` | P0 |
| `product` | `id: ID!` | `Product` | P0 |
| `productByIdentifier` | `identifier: ProductIdentifierInput!` | `Product` | P0 |
| `productByHandle` (deprecated) | `handle: String!` | `Product` | P0 |
| `products` | `first: Int`, `after: String`, `last: Int`, `before: String`, `reverse: Boolean`, `sortKey: ProductSortKeys`, `query: String`, `savedSearchId: ID` | `ProductConnection!` | P0 |
| `productsCount` | `query: String`, `savedSearchId: ID`, `limit: Int` | `Count` | P0 |
| `productVariant` | `id: ID!` | `ProductVariant` | P0 |
| `productVariantByIdentifier` | `identifier: ProductVariantIdentifierInput!` | `ProductVariant` | P1 |
| `productVariants` | `first: Int`, `after: String`, `last: Int`, `before: String`, `reverse: Boolean`, `sortKey: ProductVariantSortKeys`, `query: String`, `savedSearchId: ID` | `ProductVariantConnection!` | P0 |
| `productVariantsCount` | `query: String`, `limit: Int` | `Count` | P1 |
| `collection` | `id: ID!` | `Collection` | P0 |
| `collectionByIdentifier` | `identifier: CollectionIdentifierInput!` | `Collection` | P0 |
| `collectionByHandle` (deprecated) | `handle: String!` | `Collection` | P0 |
| `collections` | `first: Int`, `after: String`, `last: Int`, `before: String`, `reverse: Boolean`, `sortKey: CollectionSortKeys`, `query: String`, `savedSearchId: ID` | `CollectionConnection!` | P0 |
| `collectionsCount` | `query: String`, `savedSearchId: ID`, `limit: Int` | `Count` | P0 |
| `customer` | `id: ID!` | `Customer` | P0 |
| `customerByIdentifier` | `identifier: CustomerIdentifierInput!` | `Customer` | P1 |
| `customers` | `first: Int`, `after: String`, `last: Int`, `before: String`, `reverse: Boolean`, `sortKey: CustomerSortKeys`, `query: String` | `CustomerConnection!` | P0 |
| `customersCount` | `query: String`, `limit: Int` | `Count` | P0 |
| `order` | `id: ID!` | `Order` | P0 |
| `orderByIdentifier` | `identifier: OrderIdentifierInput!` | `Order` | P1 |
| `orders` | `first: Int`, `after: String`, `last: Int`, `before: String`, `reverse: Boolean`, `sortKey: OrderSortKeys`, `query: String`, `savedSearchId: ID` | `OrderConnection!` | P0 |
| `ordersCount` | `query: String`, `savedSearchId: ID`, `limit: Int` | `Count` | P0 |
| `location` | `id: ID` | `Location` | P0 |
| `locationByIdentifier` | `identifier: LocationIdentifierInput!` | `Location` | P2 |
| `locations` | `includeLegacy: Boolean`, `includeInactive: Boolean`, `first: Int`, `after: String`, `last: Int`, `before: String`, `reverse: Boolean`, `sortKey: LocationSortKeys`, `query: String` | `LocationConnection!` | P0 |
| `locationsCount` | `query: String`, `limit: Int` | `Count` | P1 |
| `inventoryItem` | `id: ID!` | `InventoryItem` | P0 |
| `inventoryItems` | `first: Int`, `after: String`, `last: Int`, `before: String`, `reverse: Boolean`, `query: String` | `InventoryItemConnection!` | P0 |
| `inventoryLevel` | `id: ID!` | `InventoryLevel` | P1 |
| `fulfillment` | `id: ID!` | `Fulfillment` | P1 |
| `refund` | `id: ID!` | `Refund` | P1 |
| `productTags` | `first: Int`, `after: String`, `last: Int`, `before: String`, `reverse: Boolean` | `StringConnection` | P1 |
| `productTypes` | `first: Int`, `after: String`, `last: Int`, `before: String`, `reverse: Boolean` | `StringConnection` | P1 |
| `productVendors` | `first: Int`, `after: String`, `last: Int`, `before: String`, `reverse: Boolean` | `StringConnection` | P1 |
| `currentAppInstallation` | none | `AppInstallation!` | P1 |
| `metafieldDefinitions` | `key: String`, `namespace: String`, `ownerType: MetafieldOwnerType!`, `pinnedStatus: MetafieldDefinitionPinnedStatus`, `constraintSubtype: MetafieldDefinitionConstraintSubtypeIdentifier`, `constraintStatus: MetafieldDefinitionConstraintStatus`, `first: Int`, `after: String`, `last: Int`, `before: String`, `reverse: Boolean`, `sortKey: MetafieldDefinitionSortKeys`, `query: String` | `MetafieldDefinitionConnection!` | P2 |

## 5. Mutations

Payload column omits `userErrors` (always present, see the type column) and `shop`. Prefer the non-deprecated argument names.

| Mutation | Arguments | Payload fields | User errors type | Prio | Notes |
|---|---|---|---|---|---|
| `productCreate` | `input: ProductInput (deprecated)`, `product: ProductCreateInput`, `media: [CreateMediaInput!]` | `product: Product` | `[UserError!]!` | P0 | Use the `product` argument; `input` is deprecated. |
| `productUpdate` | `input: ProductInput (deprecated)`, `product: ProductUpdateInput`, `media: [CreateMediaInput!]`, `identifier: ProductUpdateIdentifiers` | `product: Product` | `[UserError!]!` | P0 | Use `product` argument (carries `id`); `input` deprecated. |
| `productDelete` | `input: ProductDeleteInput!`, `synchronous: Boolean` | `deletedProductId: ID`, `productDeleteOperation: ProductDeleteOperation` | `[UserError!]!` | P0 | Optional `synchronous` flag; payload also carries an async operation. |
| `productSet` | `input: ProductSetInput!`, `synchronous: Boolean`, `identifier: ProductSetIdentifiers` | `product: Product`, `productSetOperation: ProductSetOperation` | `[ProductSetUserError!]!` | P1 | Upsert of a whole product tree (options, variants, files) in one call; used by sync tools. |
| `productDuplicate` | `productId: ID!`, `newTitle: String!`, `newStatus: ProductStatus`, `includeImages: Boolean`, `includeTranslations: Boolean`, `synchronous: Boolean` | `imageJob: Job`, `newProduct: Product`, `productDuplicateOperation: ProductDuplicateOperation` | `[UserError!]!` | P2 |  |
| `productVariantsBulkCreate` | `variants: [ProductVariantsBulkInput!]!`, `productId: ID!`, `media: [CreateMediaInput!]`, `strategy: ProductVariantsBulkCreateStrategy` | `product: Product`, `productVariants: [ProductVariant!]` | `[ProductVariantsBulkCreateUserError!]!` | P0 | `strategy` controls what happens to the placeholder default variant. |
| `productVariantsBulkUpdate` | `variants: [ProductVariantsBulkInput!]!`, `productId: ID!`, `media: [CreateMediaInput!]`, `allowPartialUpdates: Boolean` | `product: Product`, `productVariants: [ProductVariant!]` | `[ProductVariantsBulkUpdateUserError!]!` | P0 | `allowPartialUpdates` lets valid rows succeed. |
| `productVariantsBulkDelete` | `variantsIds: [ID!]!`, `productId: ID!` | `product: Product` | `[ProductVariantsBulkDeleteUserError!]!` | P0 |  |
| `productVariantsBulkReorder` | `productId: ID!`, `positions: [ProductVariantPositionInput!]!` | `product: Product` | `[ProductVariantsBulkReorderUserError!]!` | P2 |  |
| `productOptionsCreate` | `productId: ID!`, `options: [OptionCreateInput!]!`, `variantStrategy: ProductOptionCreateVariantStrategy` | `product: Product` | `[ProductOptionsCreateUserError!]!` | P0 |  |
| `productOptionUpdate` | `option: OptionUpdateInput!`, `productId: ID!`, `optionValuesToAdd: [OptionValueCreateInput!]`, `optionValuesToUpdate: [OptionValueUpdateInput!]`, `optionValuesToDelete: [ID!]`, `variantStrategy: ProductOptionUpdateVariantStrategy` | `product: Product` | `[ProductOptionUpdateUserError!]!` | P1 |  |
| `productOptionsDelete` | `productId: ID!`, `options: [ID!]!`, `strategy: ProductOptionDeleteStrategy` | `deletedOptionsIds: [ID!]`, `product: Product` | `[ProductOptionsDeleteUserError!]!` | P1 |  |
| `productOptionsReorder` | `productId: ID!`, `options: [OptionReorderInput!]!` | `product: Product` | `[ProductOptionsReorderUserError!]!` | P2 |  |
| `productReorderMedia` | `id: ID!`, `moves: [MoveInput!]!` | `job: Job`, `mediaUserErrors: [MediaUserError!]!` | `[UserError!]!` | P2 | Media is otherwise attached through the `media` argument of productCreate/productUpdate; the old productCreateMedia family is deprecated. |
| `collectionCreate` | `input: CollectionInput (deprecated)`, `collection: CollectionCreateInput` | `collection: Collection` | `[UserError!]!` | P0 | Use the `collection` argument; `input` deprecated. |
| `collectionUpdate` | `input: CollectionInput (deprecated)`, `collection: CollectionUpdateInput` | `collection: Collection`, `job: Job` | `[UserError!]!` | P0 | Use `collection` argument (carries `id`); manual membership changes use the `sources*` fields in 2026-10. |
| `collectionDelete` | `input: CollectionDeleteInput!` | `deletedCollectionId: ID` | `[UserError!]!` | P0 |  |
| `collectionAddProductsV2` (deprecated) | `id: ID!`, `productIds: [ID!]!` | `job: Job` | `[CollectionAddProductsV2UserError!]!` | P1 | Deprecated in 2026-10 but still the common way to add members; returns a `Job`. |
| `collectionRemoveProducts` (deprecated) | `id: ID!`, `productIds: [ID!]!` | `job: Job` | `[UserError!]!` | P1 | Deprecated in 2026-10; returns a `Job`. |
| `collectionReorderProducts` | `id: ID!`, `moves: [MoveInput!]!` | `job: Job` | `[CollectionReorderProductsUserError!]!` | P1 | For collections with `sortOrder: MANUAL`. |
| `customerCreate` | `input: CustomerInput!` | `customer: Customer` | `[UserError!]!` | P0 |  |
| `customerUpdate` | `input: CustomerInput!` | `customer: Customer` | `[UserError!]!` | P0 |  |
| `customerDelete` | `input: CustomerDeleteInput!` | `deletedCustomerId: ID` | `[UserError!]!` | P0 |  |
| `customerSet` | `input: CustomerSetInput!`, `identifier: CustomerSetIdentifiers` | `customer: Customer` | `[CustomerSetUserError!]!` | P1 | Upsert by identifier. |
| `customerAddressCreate` | `customerId: ID!`, `address: MailingAddressInput!`, `setAsDefault: Boolean` | `address: MailingAddress` | `[UserError!]!` | P1 |  |
| `customerAddressUpdate` | `customerId: ID!`, `addressId: ID!`, `address: MailingAddressInput!`, `setAsDefault: Boolean` | `address: MailingAddress` | `[UserError!]!` | P1 |  |
| `customerAddressDelete` | `customerId: ID!`, `addressId: ID!` | `deletedAddressId: ID` | `[UserError!]!` | P1 |  |
| `customerUpdateDefaultAddress` | `customerId: ID!`, `addressId: ID!` | `customer: Customer` | `[UserError!]!` | P1 |  |
| `inventoryAdjustQuantities` | `input: InventoryAdjustQuantitiesInput!` | `inventoryAdjustmentGroup: InventoryAdjustmentGroup` | `[InventoryAdjustQuantitiesUserError!]!` | P0 | Relative change per (item, location) with a named quantity (e.g. `available`) and a reason string. |
| `inventorySetQuantities` | `input: InventorySetQuantitiesInput!` | `inventoryAdjustmentGroup: InventoryAdjustmentGroup` | `[InventorySetQuantitiesUserError!]!` | P0 | Absolute set; optional `changeFromQuantity` acts as a compare-and-set guard. |
| `inventoryActivate` | `inventoryItemId: ID!`, `locationId: ID!`, `available: Int`, `onHand: Int`, `stockAtLegacyLocation: Boolean (deprecated)` | `inventoryLevel: InventoryLevel` | `[UserError!]!` | P1 | Start stocking an item at a location. |
| `inventoryDeactivate` | `inventoryLevelId: ID!` |  | `[UserError!]!` | P1 |  |
| `inventoryItemUpdate` | `id: ID!`, `input: InventoryItemInput!` | `inventoryItem: InventoryItem` | `[UserError!]!` | P0 | SKU, tracked, cost, weight, origin. |
| `inventoryMoveQuantities` | `input: InventoryMoveQuantitiesInput!` | `inventoryAdjustmentGroup: InventoryAdjustmentGroup` | `[InventoryMoveQuantitiesUserError!]!` | P2 | Move between named quantities (e.g. available to reserved). |
| `metafieldsSet` | `metafields: [MetafieldsSetInput!]!` | `metafields: [Metafield!]` | `[MetafieldsSetUserError!]!` | P0 | Up to 25 per call (per public docs); create-or-update by (owner, namespace, key). |
| `metafieldsDelete` | `metafields: [MetafieldIdentifierInput!]!` | `deletedMetafields: [MetafieldIdentifier]` | `[UserError!]!` | P1 |  |
| `tagsAdd` | `id: ID!`, `tags: [String!]!` | `node: Node` | `[UserError!]!` | P1 | Works on products, customers, orders, ... via the `Node` id. |
| `tagsRemove` | `id: ID!`, `tags: [String!]!` | `node: Node` | `[UserError!]!` | P1 |  |
| `orderUpdate` | `input: OrderInput!` | `order: Order` | `[UserError!]!` | P0 | Edit email, phone, note, tags, shipping address, custom attributes, metafields. |
| `orderClose` | `input: OrderCloseInput!` | `order: Order` | `[UserError!]!` | P0 |  |
| `orderOpen` | `input: OrderOpenInput!` | `order: Order` | `[UserError!]!` | P0 |  |
| `orderCancel` | `orderId: ID!`, `refund: Boolean (deprecated)`, `refundMethod: OrderCancelRefundMethodInput`, `restock: Boolean!`, `reason: OrderCancelReason!`, `notifyCustomer: Boolean`, `staffNote: String` | `job: Job`, `jobResult: OrderCancelJobResult`, `orderCancelUserErrors: [OrderCancelUserError!]!` | `[UserError!]!` | P0 | Asynchronous (`Job`); `restock` and `reason` required. |
| `orderMarkAsPaid` | `input: OrderMarkAsPaidInput!` | `order: Order` | `[UserError!]!` | P1 |  |
| `orderCreate` | `order: OrderCreateOrderInput!`, `options: OrderCreateOptionsInput` | `order: Order` | `[OrderCreateUserError!]!` | P1 | Programmatic order creation (imports, migration). |
| `orderCapture` | `input: OrderCaptureInput!` | `transaction: OrderTransaction` | `[UserError!]!` | P1 | Capture an authorization. |
| `refundCreate` | `input: RefundInput!` | `order: Order`, `refund: Refund` | `[UserError!]!` | P0 |  |
| `fulfillmentCreate` | `fulfillment: FulfillmentInput!`, `message: String` | `fulfillment: Fulfillment` | `[UserError!]!` | P0 | Takes `lineItemsByFulfillmentOrder`, so a minimal `FulfillmentOrder` object is required even though fulfillment orders are not in the MVP read surface. |
| `fulfillmentCancel` | `id: ID!` | `fulfillment: Fulfillment` | `[UserError!]!` | P1 |  |
| `fulfillmentTrackingInfoUpdate` | `fulfillmentId: ID!`, `trackingInfoInput: FulfillmentTrackingInput!`, `notifyCustomer: Boolean` | `fulfillment: Fulfillment` | `[UserError!]!` | P1 |  |
| `draftOrderCreate` | `input: DraftOrderInput!` | `draftOrder: DraftOrder` | `[UserError!]!` | P2 |  |
| `draftOrderComplete` | `id: ID!`, `paymentPending: Boolean (deprecated)`, `paymentGatewayId: ID`, `sourceName: String` | `draftOrder: DraftOrder` | `[UserError!]!` | P2 |  |
| `locationAdd` | `input: LocationAddInput!` | `location: Location` | `[LocationAddUserError!]!` | P1 |  |
| `locationEdit` | `id: ID!`, `input: LocationEditInput!` | `location: Location` | `[LocationEditUserError!]!` | P1 |  |
| `stagedUploadsCreate` | `input: [StagedUploadInput!]!` | `stagedTargets: [StagedMediaUploadTarget!]` | `[UserError!]!` | P2 | First step of file/media upload. |
| `fileCreate` | `files: [FileCreateInput!]!` | `files: [File!]` | `[FilesUserError!]!` | P2 |  |

### 5.1 Input types

| Input type | Fields (name: type) |
|---|---|
| `ProductCreateInput` | `descriptionHtml: String`, `handle: String`, `seo: SEOInput`, `productType: String`, `tags: [String!]`, `templateSuffix: String`, `giftCardTemplateSuffix: String`, `title: String`, `vendor: String`, `category: ID`, `giftCard: Boolean`, `collectionsToJoin: [ID!]`, `combinedListingRole: CombinedListingsRole`, `metafields: [MetafieldInput!]`, `productOptions: [OptionCreateInput!]`, `status: ProductStatus`, `requiresSellingPlan: Boolean`, `claimOwnership: ProductClaimOwnershipInput` |
| `ProductUpdateInput` | `descriptionHtml: String`, `handle: String`, `seo: SEOInput`, `productType: String`, `tags: [String!]`, `templateSuffix: String`, `giftCardTemplateSuffix: String`, `title: String`, `vendor: String`, `category: ID`, `redirectNewHandle: Boolean`, `id: ID`, `collectionsToJoin: [ID!]`, `collectionsToLeave: [ID!]`, `deleteConflictingConstrainedMetafields: Boolean`, `metafields: [MetafieldInput!]`, `status: ProductStatus`, `requiresSellingPlan: Boolean` |
| `ProductVariantsBulkInput` | `barcode: String` (deprecated), `barcodes: [BarcodeInput!]`, `compareAtPrice: Money`, `id: ID`, `mediaSrc: [String!]`, `inventoryPolicy: ProductVariantInventoryPolicy`, `inventoryQuantities: [InventoryLevelInput!]`, `quantityAdjustments: [InventoryAdjustmentInput!]`, `inventoryItem: InventoryItemInput`, `mediaId: ID`, `metafields: [MetafieldInput!]`, `optionValues: [VariantOptionValueInput!]`, `price: Money`, `taxable: Boolean`, `taxCode: String`, `unitPriceMeasurement: UnitPriceMeasurementInput`, `showUnitPrice: Boolean`, `requiresComponents: Boolean`, `published: Boolean` |
| `OptionCreateInput` | `name: String`, `position: Int`, `values: [OptionValueCreateInput!]`, `linkedMetafield: LinkedMetafieldCreateInput` |
| `OptionValueCreateInput` | `name: String`, `linkedMetafieldValue: String` |
| `VariantOptionValueInput` | `id: ID`, `name: String`, `linkedMetafieldValue: String`, `optionId: ID`, `optionName: String` |
| `InventoryItemInput` | `sku: String`, `cost: Decimal`, `tracked: Boolean`, `countryCodeOfOrigin: CountryCode`, `harmonizedSystemCode: String`, `countryHarmonizedSystemCodes: [CountryHarmonizedSystemCodeInput!]`, `provinceCodeOfOrigin: String`, `measurement: InventoryItemMeasurementInput`, `requiresShipping: Boolean` |
| `InventoryItemMeasurementInput` | `weight: WeightInput`, `shippingPackageId: ID` |
| `WeightInput` | `value: Float!`, `unit: WeightUnit!` |
| `SEOInput` | `title: String`, `description: String` |
| `CreateMediaInput` | `originalSource: String!`, `alt: String`, `mediaContentType: MediaContentType!` |
| `CollectionCreateInput` | `descriptionHtml: String`, `handle: String`, `image: ImageInput`, `templateSuffix: String`, `sortOrder: CollectionSortOrder`, `title: String!`, `metafields: [MetafieldInput!]`, `seo: SEOInput`, `sources: [CollectionCreateSourceTargetInput!]` |
| `CollectionUpdateInput` | `descriptionHtml: String`, `handle: String`, `id: ID`, `image: ImageInput`, `templateSuffix: String`, `sortOrder: CollectionSortOrder`, `title: String`, `metafields: [MetafieldInput!]`, `seo: SEOInput`, `redirectNewHandle: Boolean`, `sourcesToDelete: [ID!]`, `sourcesToCreate: [CollectionCreateSourceTargetInput!]`, `sourcesToUpdate: [CollectionUpdateSourceTargetInput!]` |
| `CollectionRuleSetInput` | `appliedDisjunctively: Boolean!`, `rules: [CollectionRuleInput!]` |
| `CollectionRuleInput` | `column: CollectionRuleColumn!`, `relation: CollectionRuleRelation!`, `condition: String!`, `conditionObjectId: ID` |
| `CustomerInput` | `addresses: [MailingAddressInput!]` (deprecated), `email: String`, `firstName: String`, `id: ID`, `lastName: String`, `locale: String`, `metafields: [MetafieldInput!]`, `note: String`, `phone: String`, `tags: [String!]`, `emailMarketingConsent: CustomerEmailMarketingConsentInput`, `smsMarketingConsent: CustomerSmsMarketingConsentInput`, `whatsAppMarketingConsent: CustomerMarketingConsentInput`, `taxExempt: Boolean`, `taxExemptions: [TaxExemption!]`, `multipassIdentifier: String` |
| `MailingAddressInput` | `address1: String`, `address2: String`, `city: String`, `company: String`, `country: String` (deprecated), `countryCode: CountryCode`, `firstName: String`, `id: ID` (deprecated), `lastName: String`, `phone: String`, `province: String` (deprecated), `provinceCode: String`, `zip: String` |
| `CustomerSetInput` | `addresses: [MailingAddressInput!]` (deprecated), `email: String`, `firstName: String`, `id: ID` (deprecated), `lastName: String`, `locale: String`, `note: String`, `phone: String`, `tags: [String!]`, `taxExempt: Boolean`, `taxExemptions: [TaxExemption!]` |
| `InventoryAdjustQuantitiesInput` | `reason: String!`, `name: String!`, `referenceDocumentUri: String`, `changes: [InventoryChangeInput!]!` |
| `InventoryChangeInput` | `delta: Int!`, `changeFromQuantity: Int`, `inventoryItemId: ID!`, `locationId: ID!`, `ledgerDocumentUri: String` |
| `InventorySetQuantitiesInput` | `reason: String!`, `name: String!`, `referenceDocumentUri: String`, `quantities: [InventoryQuantityInput!]!` |
| `InventoryQuantityInput` | `inventoryItemId: ID!`, `locationId: ID!`, `quantity: Int!`, `changeFromQuantity: Int` |
| `InventoryLevelInput` | `availableQuantity: Int!`, `locationId: ID!` |
| `MetafieldInput` | `id: ID`, `namespace: String`, `key: String`, `value: String`, `type: String` |
| `MetafieldsSetInput` | `ownerId: ID!`, `namespace: String`, `key: String!`, `value: String!`, `compareDigest: String`, `type: String` |
| `OrderInput` | `id: ID!`, `email: String`, `phone: String`, `note: String`, `tags: [String!]`, `shippingAddress: MailingAddressInput`, `customAttributes: [AttributeInput!]`, `metafields: [MetafieldInput!]`, `localizationExtensions: [LocalizationExtensionInput!]` (deprecated), `localizedFields: [LocalizedFieldInput!]`, `poNumber: String` |
| `RefundInput` | `currency: CurrencyCode`, `orderId: ID!`, `note: String`, `notify: Boolean`, `shipping: ShippingRefundInput`, `processedAt: DateTime`, `refundLineItems: [RefundLineItemInput!]`, `refundDuties: [RefundDutyInput!]`, `transactions: [OrderTransactionInput!]`, `refundMethods: [RefundMethodInput!]`, `discrepancyReason: OrderAdjustmentInputDiscrepancyReason`, `allowOverRefunding: Boolean` |
| `RefundLineItemInput` | `lineItemId: ID!`, `quantity: Int!`, `restockType: RefundLineItemRestockType`, `locationId: ID` |
| `FulfillmentInput` | `trackingInfo: FulfillmentTrackingInput`, `notifyCustomer: Boolean`, `lineItemsByFulfillmentOrder: [FulfillmentOrderLineItemsInput!]!`, `originAddress: FulfillmentOriginAddressInput` |
| `FulfillmentTrackingInput` | `number: String`, `url: URL`, `company: String`, `numbers: [String!]`, `urls: [URL!]` |
| `ProductIdentifierInput` | `id: ID`, `customId: UniqueMetafieldValueInput`, `handle: String` |
| `CollectionIdentifierInput` | `id: ID`, `customId: UniqueMetafieldValueInput`, `handle: String` |
| `CustomerIdentifierInput` | `id: ID`, `customId: UniqueMetafieldValueInput`, `emailAddress: String`, `phoneNumber: String` |
| `MoveInput` | `id: ID!`, `newPosition: UnsignedInt64!` |

## 6. Observed behaviors worth encoding as conformance tests

From the 27 products / 46 variants, 5 collections, 4 customers and 1 order in the samples (store currency USD, imperial
units, timezone America/New_York, two locations):

- **Statuses**: products appear as `ACTIVE` (25), `DRAFT` (1), `ARCHIVED` (1); only 23 of 27 have a non-null `publishedAt`
  (publication to the online channel is separate from status; two `ACTIVE` products have a null `publishedAt`, i.e. not on the storefront).
- **Default variant**: a product without real options has one option named `Title` with one value and one variant titled
  `Default Title` (14 of 27 products); every product has at least one option. `hasOnlyDefaultVariant` is the derived flag.
  One product uses an option literally named Title with 3 values; 13 products have more than one variant.
- **Options**: option names seen: Title, Color (5 values), Denominations (4), Format (2); all 27 products have exactly one option. Each
  `optionValues` entry carries `hasVariants`. Variants carry `selectedOptions` as ordered `{ name, value }` pairs.
- **Inventory**: `inventoryPolicy` is `DENY` or `CONTINUE` (oversell). `inventoryQuantity` is the `available` quantity
  summed over locations and **can be negative** (observed `-1` for a `CONTINUE` variant with one committed unit: quantities
  `available -1, on_hand 0, committed 1`). `availableForSale` is false when stock is 0 and tracked and policy is `DENY`;
  true for untracked inventory (`tracked: false`, observed quantity 0 but sellable) and for `CONTINUE`.
- **Quantities**: names are `available`, `on_hand`, `committed`, `incoming`, `reserved`; observed relation on_hand = available +
  committed. Multi-location variants have two `InventoryLevel` rows (50 + 50 available, reported as 100 in
  `inventoryQuantity`).
- **Shipping flag**: digital and gift card variants have `requiresShipping: false`; the flag lives on `InventoryItem`, and
  can differ between variants of the same product.
- **Weight**: variants carry a weight with unit `POUNDS` or `OUNCES` independent of the shop unit.
- **Compare-at price**: null unless set; the price range is computed from variant prices.
- **Collections**: a collection with handle `frontpage` ("Home page", no products) exists in the store; `sortOrder` was `MOST_RELEVANT`
  here; `products` honors `first`; `productsCount` was 8 while the sample listed 5 handles (we only requested a page).
- **Customers**: `state` observed `DISABLED` (no account created) for all four; emails and phones live in
  `defaultEmailAddress { emailAddress marketingState }` / `defaultPhoneNumber { phoneNumber }`; `locale` is a language tag
  (`en`, `en-ca`); `amountSpent` is a `MoneyV2` and `numberOfOrders` a string `"0"`; `addressesV2` returned
  addresses with many null parts; a customer may have several addresses.
- **Order**: name is `#1001`-style; the test order had `test: true`, `sourceName` `shopify_draft_order`, financial status
  `PAID`, fulfillment status `UNFULFILLED`, one SALE transaction with gateway `bogus`, a digital line with
  `requiresShipping: false`, an empty `shippingLines`, and money sets with only `shopMoney` requested.
  `Order.transactions`, `fulfillments`, `refunds` are lists. `lineItems.nodes[].variant` and `.product` can be null for
  deleted products (nullable types).
- **Metafields**: `(namespace, key, type, value)` where `type` is a string such as `single_line_text_field` and `value` is
  always a string; typed access goes through `jsonValue`.

## 7. Out of scope for the MVP (but plan the model so it can be added)

Publications/channels (online-store publication state is reduced to `publishedAt` for now), selling plans, markets and
catalogs/price lists, translations, discounts and discount allocations beyond empty lists, draft orders, order editing,
returns, fulfillment orders (other than the minimal object required by `fulfillmentCreate`), shipping profiles/delivery
zones, gift cards, product bundles and combined listings, taxonomy categories, bulk operations, webhooks admin, files API,
Storefront API (separate spec).

## 8. Implemented beyond the MVP: bulk operations, discount bulk edits, drafts, publishing, webhooks

What ShopMe does for these roots, and where it differs from the reference. Names, arguments, enums and `userErrors` codes
match the reference schema; the notes below are behavior and limits.

### 8.1 Bulk operations

`bulkOperationRunQuery`, `bulkOperationRunMutation`, `bulkOperationCancel`, `bulkOperation`, `bulkOperations` (search `status`,
`operation_type`, `created_at`, `completed_at`, `id`; sort `CREATED_AT`/`COMPLETED_AT`) and `currentBulkOperation(type)`.

- A run is a row of `bulk_operations` plus a job on the in-process queue (`bulk.run`); the result is a JSONL file in object
  storage, served from `/files/bulk/<shop>/<id>-<token>.jsonl`. The URL carries a random token; results expire after 7 days
  (status `EXPIRED`, file deleted). A restart fails runs that were in flight.
- One active operation per type and shop: a second start returns `OPERATION_IN_PROGRESS`.
- Queries: only connection fields at the top level (`edges { node }` or `nodes`), at most 5 connections, nested at most 2 levels,
  no variables, fragments allowed. Paging arguments (`first`, `after`, `last`, `before`) are ignored. Each node is one line with
  the selected scalar and object fields, without its connection fields; nodes of a nested connection follow their parent and
  carry `__parentId`. `id` is added to a node that has nested connections when it was not selected. Output is always grouped
  (`groupObjects` has no effect). Invalid queries return `INVALID` with `field: ["query"]`.
- Mutations: `stagedUploadsCreate` with resource `BULK_MUTATION_VARIABLES` returns an upload target whose parameters include
  `key`; PUT or POST the JSONL there and pass the `key` as `stagedUploadPath`. The staged file is private to the shop and is not
  listed under Files. Each line holds the variables of one execution; the result line is
  `{"data":…,"errors":…,"__lineNumber":n}`. Codes: `INVALID_MUTATION` (not a single-field mutation, or invalid against the schema),
  `NO_SUCH_FILE`, `INVALID_STAGED_UPLOAD_FILE` (not JSONL). Lines run one after another; a failing line does not stop the run.
- Runs use the access scopes of the caller who started them. `bulk_operations/finish` is delivered to webhook subscriptions
  (payload: `admin_graphql_api_id`, `completed_at`, `created_at`, `error_code`, `status`, `type`).
- `bulkOperationCancel` moves a running operation to `CANCELING`; the runner stops between pages and keeps `partialDataUrl`.

### 8.2 Discounts

`automaticDiscount`, `automaticDiscounts`, `discountNodes`, `discountNodesCount`, `codeDiscountNodes`, `automaticDiscountNodes`,
`discountCodesCount`, `discountRedeemCodeBulkCreation`, `discountTags`, `discountRedeemCodeBulkAdd`,
`discountCodeRedeemCodeBulkDelete`, `discountCodeBulkActivate`, `discountCodeBulkDeactivate`, `discountCodeBulkDelete`,
`discountAutomaticBulkDelete`, `discountBulkTagsAdd`, `discountBulkTagsRemove`.

- A code discount can hold many codes (each with its own usage count); checkout accepts any of them. `codes` is paged from the
  database. Codes are stored upper-case and are unique per shop.
- `discountRedeemCodeBulkAdd` takes up to 250 codes; invalid, blank, too long and already used codes are reported per code on the
  `DiscountRedeemCodeBulkCreation` (`errors` with `BLANK`, `TOO_LONG`, `INVALID`, `TAKEN`) and the others are added. The work is
  done inside the call, so `done` is already true.
- The bulk edit mutations take exactly one of `ids`, `search` or `savedSearchId` (`MISSING_ARGUMENT` / `TOO_MANY_ARGUMENTS`;
  unknown ids or a wrong kind give `INVALID` on `ids`). They also finish inside the call and return a completed `Job`
  (`job(id)` resolves it). Any saved search is accepted; only its query is used.
- `discountCodeRedeemCodeBulkDelete` refuses to delete every code of a discount (`INVALID` on `ids`).
- ShopMe extension `shopmeDiscountCodesGenerate(discountId, count, length, prefix, suffix, characterSet)` creates up to 10,000
  unique random codes (`characterSet`: `ALPHANUMERIC`, `LETTERS`, `DIGITS`, `UNAMBIGUOUS`); it backs the "Generate codes" action on
  the discount page.

### 8.3 Orders and drafts

`draftOrderBulkAddTags`, `draftOrderBulkRemoveTags`, `draftOrderBulkDelete` (same selection rules as above, `UserError` without
codes), `draftOrderCreateFromOrder` (open lines at their current quantity; deleted variants become custom items),
`draftOrderDuplicate` (`id`, or the deprecated `draftOrderId`), `draftOrderTag`, `tagsAdd` / `tagsRemove` for orders, products,
draft orders and customers, `orderCapture`, `abandonment`, `abandonmentByAbandonedCheckoutId`.

- `orderCapture` captures an `AUTHORIZATION` transaction in one or several parts and moves the order to `PARTIALLY_PAID` or
  `PAID`. Checkout in ShopMe records sales, not authorizations, so the mutation applies to authorizations created by payment
  providers or imports; on other transactions it returns `userErrors` on `input.parentTransactionId`.
- `Abandonment` is the customer view of one abandoned checkout (type `CHECKOUT`); it exists only when the buyer's email matches a
  customer. Not implemented on it: `app`, `productsViewed`, `productsAddedToCart`.
- Draft order tags have no table: `DraftOrderTag.id` is a stable hash of the lower-cased tag.

### 8.4 Products and collections

`collectionReorderProducts` (manually sorted collections only; positions are 0-based; codes `COLLECTION_NOT_FOUND`,
`MANUALLY_SORTED_COLLECTION`, `INVALID_MOVE`), `productVariantsBulkReorder` (1-based final positions),
`productOptionsReorder` (by id or by name; variant titles are rebuilt), `collectionPublish`, `collectionUnpublish`,
`productPublish`, `productUnpublish`, `publishablePublishToCurrentChannel`, `publishableUnpublishToCurrentChannel` on the single
Online Store publication, and `productDuplicate(synchronous: false)` which returns a `ProductDuplicateOperation`
(`productOperation(id)` and `productDuplicateJob(id)` report progress, `job(id)` as well). `ProductPublication.channel`,
`CollectionPublication.channel` and `Job.query` are not implemented.

### 8.5 Webhooks

`WebhookSubscriptionTopic` lists all 236 topics of the reference enum, so tools can register the topics they know; ShopMe
delivers the topics of `WEBHOOK_TOPICS` (products, orders, fulfillments, refunds, customers, draft orders and
`BULK_OPERATIONS_FINISH`). Any other topic is stored and never fires. `webhookSubscriptions` accepts `uri`, `callbackUrl`,
`format`, `topics`, `query` (`id`, `topic`, `endpoint`, `created_at`, `updated_at`) and `sortKey`; `webhookSubscriptionsCount` is
available. `includeFields` (top-level keys and `a.b` paths) is applied to delivered payloads; `metafieldNamespaces`, `filter` and
`name` are stored and returned but not applied. `metafields` on the input and the EventBridge and Pub/Sub endpoint variants are not
implemented; only the JSON format is delivered.
