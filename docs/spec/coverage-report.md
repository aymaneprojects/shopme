# ShopMe coverage report: how completely do we reproduce observed Shopify behavior?

## Status update (2026-11-05)

Each P0 and P1 item below was checked against the code at the first public release (v0.1.0). The gap lists in section 8
are unchanged; this table only records what has since been built. **Done** means delivered as described. **Partial** means
a named part of the item is still missing (see the notes). **Not done** means absent. P2 items are not re-scored.

### P0

| # | Gap | Status | Notes |
|---|---|---|---|
| P0-1 | Customer accounts | Done | Register, login, logout, reset, order history, address book, `customer` object, `/account/*` |
| P0-2 | Theme install/upload | Done | Zip upload, create, duplicate, delete, file copy and delete; updates of the bundled Aurora theme as a new unpublished copy (`shopmeThemeUpdateToBundled`) |
| P0-3 | Section-level theme editor | Done | Add, remove and move sections and blocks, template switching, undo |
| P0-4 | CSV import/export | Done | Products, customers, inventory and orders |
| P0-5 | Shopify migration importer | Done | `packages/migrate` (command line and admin page); discounts, gift cards and theme code are not imported |
| P0-6 | Notification emails | Partial | Shipping, refund, cancellation, password reset and the editor are done; account welcome and invite templates have no sending flow yet |
| P0-7 | Draft and manual orders | Done | Draft create, edit, calculate, complete and invoice link; no `orderCreate` mutation |
| P0-8 | Staff management and permissions | Done | Team page, invitations, roles, per-area permissions enforced through scopes, session list |
| P0-9 | URL redirects with 301 and bulk CSV import | Partial | 301 on handle change and the admin page are done; no CSV or bulk import (`urlRedirectImport` is absent) |
| P0-10 | Policies editor, legal pages, consent basics | Done | Policies editor, cookie banner, customer data export; no erasure tooling |
| P0-11 | Image resizing and WebP/AVIF | Done | Width, height, crop and format, with a disk cache |
| P0-12 | Cart-level discounts | Done | Cart, Ajax responses, Liquid and `/discount/:code` |
| P0-13 | Blogs and articles | Done | Admin editors, storefront routes, Atom feeds, sitemap entries, `blog` and `article` objects |
| P0-14 | Contact and newsletter forms | Done | `POST /contact` and newsletter sign-up |
| P0-15 | Outbound webhooks with HMAC | Done | HMAC-SHA256 signatures, retries, delivery log, admin page |

P0 result: 13 Done, 2 Partial, 0 Not done.

### P1

| # | Gap | Status | Notes |
|---|---|---|---|
| P1-1 | Gift cards | Done | Issue, balance, checkout redemption, public page, admin page |
| P1-2 | Abandoned checkouts and recovery | Done | List, recovery emails, recovery link |
| P1-3 | Order editing, returns and exchanges | Partial | Order editing and returns are done; exchanges are not built |
| P1-4 | Automatic discounts, BXGY, order-level and bulk codes | Done | Automatic, BXGY and order-level discounts; many codes per discount (`discountRedeemCodeBulkAdd`, "Generate codes" on the discount page, CSV export), bulk activate, deactivate, delete and tags |
| P1-5 | Sitemap index, feeds, `search.json`, `meta.json`, `x-robots-tag` | Done | Blog Atom feeds included |
| P1-6 | Storefront metafields and definitions UI | Partial | Product, variant, collection, customer and order owners are done; article, page and blog owners and `metafieldsDelete` are missing |
| P1-7 | Search upgrade | Done | Ranking, typo tolerance, prefix option, pages and articles, predictive queries |
| P1-8 | Multi-location inventory and transfers | Partial | Locations, activation, priority allocation and fulfillment location are done; inventory transfers and purchase orders are not built (P2-3) |
| P1-9 | Shipping labels, carrier rates, packages, local pickup | Not done | No label purchase, carrier integration, packages or local pickup |
| P1-10 | Product page admin gaps | Partial | Variant image, unit price, category, duplicate, preview, metafields and bulk editor are done; `productVariantAppendMedia` and a share link are missing |
| P1-11 | Admin API completeness | Partial | `productSet`, `productChangeStatus`, publications, `customerAddress*`, files, staged uploads, `staffMember`, saved searches, `productPublish`/`Unpublish` and `collectionPublish`/`Unpublish` are done; other roots remain (see section 2) |
| P1-12 | Bulk operations | Done | `bulkOperationRunQuery` (JSONL with `__parentId`), `bulkOperationRunMutation` (staged JSONL variables), `bulkOperationCancel`, `bulkOperation`, `bulkOperations`, `currentBulkOperation`, `bulk_operations/finish` webhook; one run per type, results kept 7 days |
| P1-13 | Core type fields | Partial | Most listed fields are added; `Order.fulfillmentOrders` and `suggestedRefund` are missing |
| P1-14 | Analytics reports | Done | Twelve reports, comparison, CSV export |
| P1-15 | Staff 2FA, session list, login alerts | Done | TOTP, recovery codes, session revoke, sign-in alert email |
| P1-16 | Security headers and ETag caching | Done | Strict admin CSP, storefront report-only CSP, HSTS option, ETag and 304 |
| P1-17 | Store export/import and scheduled backups | Done | `.shopme` archive, backup settings, retention |
| P1-18 | Languages and translations | Done | Locale prefixes, translatable resources, `/localization`; checkout and policy pages are not translated yet |

P1 result: 11 Done, 6 Partial, 1 Not done (P1-9, shipping labels, carrier rates, packages and local pickup).

---


Status: audit snapshot, 2026-11-04, branch `main` (v0.1.0 pre-release code). Written in our own words. Names of types,
fields, routes and filters are interoperability facts; no vendor text is reproduced.

Inputs: our Admin GraphQL schema printed from `apps/server/src/admin/graphql/schema.ts`; the private Admin SDL
(API 2026-10); private sample responses; the 39 admin screenshots; the storefront HAR, route probe and ajax recordings;
extra storefront probes made on 2026-11-04 against our own development store (read-only GETs, nothing ordered or
changed; stored privately under `raw/storefront/extra/`); the Horizon and `test-data-main` themes rendered through our
storefront with the seeded demo data.

Percentages are measured where a count exists (API, Liquid, routes) and are judgment-weighted where it does not
(screens, journey). The weighting rule is stated in each section so the numbers can be reproduced or challenged.

---

## 1. Summary

| Area | Coverage | Basis |
|---|---:|---|
| Admin API, root queries (all) | 32% (96 of 298) | Shopify roots we also expose, re-measured 2026-11-05 by comparing the SDL of both schemas (81 before the bulk operations, discounts, drafts, catalog and webhooks work) |
| Admin API, root queries (single-shop scope) | not recomputed (was ~29% of ~147 in the 2026-11-04 audit) | After excluding B2B, markets, subscriptions, apps/billing, POS, fulfillment/carrier services, payments disputes, marketing, segments |
| Admin API, mutations (all) | 29.6% (159 of 537) | Re-measured 2026-11-05 the same way (133 before this work); `productPublish`, `bulkOperation*`, bulk discount and draft mutations are now counted |
| Admin API, mutations (single-shop scope) | not recomputed (was ~20% of ~260 in the 2026-11-04 audit) | Same exclusions |
| Admin API, fields on 20 core types | 55% (330 of 601 non-deprecated fields) | Product 49%, Variant 49%, Collection 55%, Order 53%, LineItem 77%, Customer 51%, DiscountCodeNode 40%, Shop 26% |
| Admin UI (39 screenshots) | ~55% weighted | 10 covered, 24 partial, 5 missing (covered = 1, partial = 0.5) |
| Storefront routes and endpoints | ~64% weighted | 53 route patterns: 30 implemented, 8 partial, 15 missing |
| Liquid tags and filters | ~99% | All P0 and P1 tags and filters registered; of 42 P2 filters only 1 missing; `ifchanged` tag missing |
| Liquid objects | ~86% by name, lower in depth | 31 of 36 P0/P1 globals exist; several exist only as stubs (see 5.3) |
| Real theme rendering (Horizon, test-data-main) | 100% of tested pages render without Liquid errors | 395 Liquid files parse; 0 unknown tags or filters |
| Merchant journey, A to Z | ~30% weighted | 30 capabilities: 4 present, 10 partial, 16 absent (section 7) |

Reading: ShopMe is strong on the part it set out to do (sell a product end to end through a Shopify-format theme, with an
Ajax cart that matches the recordings) and weak on everything around it. The three largest structural gaps are:
(1) no customer accounts, no blogs, no gift cards, no draft or manual orders; (2) no outbound webhooks, no bulk
operations, no CSV or Shopify migration, so no tool or data can move in or out; (3) the admin has no staff management,
no notification editing, no section-level theme editing and no theme upload.

---

## 2. Admin GraphQL API

### 2.1 Method

Both schemas were loaded as SDL and compared by root field name and by field name per type. "Single-shop scope"
excludes: B2B companies, markets and international pricing, catalogs and price lists, subscriptions and selling plans,
app billing and app platform, fulfillment and carrier services, POS and cash management, payments disputes and payouts,
marketing activities and events, segments and flows, customer payment methods, store credit, inbound shipments and
purchase orders, web pixels, functions-based customizations, and combined listings/bundles. The remaining count of
~147 queries and ~260 mutations is therefore an approximation; moving a few borderline items in or out shifts the
percentages by a couple of points.

### 2.2 Implemented (matches a Shopify root by name)

Queries (43): `node`, `nodes`, `shop`, `product`, `productByHandle`, `productByIdentifier`, `products`, `productsCount`,
`productVariant`, `productVariants`, `productTags`, `productTypes`, `productVendors`, `collection`, `collectionByHandle`,
`collectionByIdentifier`, `collections`, `collectionsCount`, `customer`, `customers`, `customersCount`, `order`,
`orders`, `ordersCount`, `codeDiscountNode`, `codeDiscountNodeByCode`, `codeDiscountNodes`, `discountNode`,
`discountNodes`, `discountNodesCount`, `inventoryItem`, `inventoryItems`, `inventoryLevel`, `location`, `locations`,
`menu`, `menus`, `page`, `pages`, `pagesCount`, `theme`, `themes`, `staffMembers`.

Mutations (51): products (`productCreate`, `productUpdate`, `productDelete`, `productDuplicate`, `productOptionsCreate`,
`productCreateMedia`, `productReorderMedia`, `productVariantsBulkCreate/Update/Delete`, `tagsAdd`, `tagsRemove`);
collections (`collectionCreate/Update/Delete`, `collectionAddProducts`, `collectionAddProductsV2`,
`collectionRemoveProducts`); customers (`customerCreate/Update/Delete`); discounts (`discountCodeBasicCreate/Update`,
`discountCodeFreeShippingCreate/Update`, `discountCodeActivate/Deactivate/Delete`); orders (`orderUpdate`, `orderCancel`,
`orderClose`, `orderOpen`, `orderMarkAsPaid`, `refundCreate`, `fulfillmentCreate`, `fulfillmentTrackingInfoUpdate`);
inventory and locations (`inventoryAdjustQuantities`, `inventorySetQuantities`, `inventoryItemUpdate`, `locationAdd`,
`locationEdit`); content (`pageCreate/Update/Delete`, `menuCreate/Update/Delete`, `fileCreate`); other
(`metafieldsSet`, `themeFilesUpsert`, `themePublish`).

ShopMe-only roots (not in the reference schema): queries `shopmeDashboard`, `shopmePaymentSettings`, `shippingZone(s)`,
`taxRates`; mutations `shopmeShopUpdate`, `shopmePaymentSettingsUpdate`, `shippingZone*`, `shippingRate*`, `taxRate*`,
`orderTimelineCommentCreate`. Shipping and tax are modeled the ShopMe way because the reference models them through
delivery profiles and markets, which are out of scope.

### 2.3 Missing roots relevant to a single-shop merchant

Queries (104 missing): abandoned checkouts (`abandonedCheckouts`, `abandonedCheckoutsCount`, `abandonment*`); blogs and
articles (`blog`, `blogs`, `blogsCount`, `article`, `articles`, `articleAuthors`, `articleTags`, `comment`, `comments`);
automatic discounts (`automaticDiscount*`, `discountCodesCount`, `discountRedeemCodeBulkCreation`, `discountTags`);
draft orders (`draftOrder`, `draftOrders`, `draftOrdersCount`, `draftOrderTag`, `draftOrderSavedSearches`); gift cards
(`giftCard`, `giftCards`, `giftCardsCount`, `giftCardConfiguration`); fulfillment orders (`fulfillmentOrder`,
`fulfillmentOrders`, `fulfillment`, `manualHoldsFulfillmentOrders`); returns (`return`, `returnableFulfillments`,
`returnCalculate`, `returnReasonDefinitions`); redirects (`urlRedirect`, `urlRedirects`, `urlRedirectsCount`,
`urlRedirectImport`); webhooks (`webhookSubscription`, `webhookSubscriptions`, `webhookSubscriptionsCount`); bulk
operations (`bulkOperation`, `bulkOperations`, `currentBulkOperation`); files (`files`, `fileSavedSearches`); metafield
and metaobject definitions (`metafieldDefinition(s)`, `metaobject*`); saved searches for products, orders, customers,
collections, discounts; translation and locale (`shopLocales`, `availableLocales`, `translatableResource(s)`);
publications (`publication(s)`, `publicationsCount`, `publishedProductsCount`); identity and ops (`currentStaffMember`,
`staffMember`, `customerByIdentifier`, `orderByIdentifier`, `productVariantByIdentifier`, `locationByIdentifier`,
`locationsCount`, `productVariantsCount`, `pendingOrdersCount`, `refund`, `events`, `event`, `eventsCount`,
`deletionEvents`, `domain`, `privacySettings`, `consentPolicy`, `onlineStore`, `inventoryTransfer(s)`,
`orderPaymentStatus`, `orderEditSession`, `customerMergePreview`, `customerMergeJobStatus`, `productDuplicateJob`,
`productOperation`).

Mutations (209 missing). Groups with the highest merchant value:
- Draft and manual orders: `draftOrderCreate/Update/Delete/Complete/Calculate/InvoiceSend/Duplicate`, `orderCreate`,
  `orderDelete`, `orderCreateManualPayment`, `orderCustomerSet/Remove`, `orderInvoiceSend`, `transactionVoid`.
- Order editing: `orderEditBegin/AddVariant/AddCustomItem/SetQuantity/AddShippingLine/AddLineItemDiscount/Commit` and
  siblings (13 total).
- Fulfillment workflow: `fulfillmentCreateV2`, `fulfillmentCancel`, `fulfillmentEventCreate`,
  `fulfillmentTrackingInfoUpdateV2`, `fulfillmentOrderHold/ReleaseHold/Cancel/Close/Open`.
- Returns: `returnCreate`, `returnRequest`, `returnApproveRequest`, `returnDeclineRequest`, `returnProcess`,
  `returnRefund`, `returnClose`, `returnReopen`, `returnCancel`, `removeFromReturn`.
- Products: `productSet`, `productChangeStatus`, `productPublish/Unpublish`, `productOptionUpdate`,
  `productOptionsDelete`, `productOptionsReorder`, `productUpdateMedia`, `productDeleteMedia`,
  `productVariantAppendMedia`, `productVariantDetachMedia`, `productVariantsBulkReorder`.
- Collections: `collectionDuplicate`, `collectionReorderProducts`, `collectionPublish/Unpublish`.
- Customers: `customerAddressCreate/Update/Delete`, `customerUpdateDefaultAddress`, `customerSet`, `customerMerge`,
  `customerSendAccountInviteEmail`, `customerGenerateAccountActivationUrl`, `customerEmailMarketingConsentUpdate`,
  `customerSmsMarketingConsentUpdate`, `customerRequestDataErasure`, `customerCancelDataErasure`, tax-exemption mutations.
- Discounts: `discountAutomaticBasic/Bxgy/FreeShipping` create/update/activate/deactivate/delete,
  `discountCodeBxgyCreate/Update`, `discountCodeBulkActivate/Deactivate/Delete`, `discountRedeemCodeBulkAdd`,
  `discountCodeRedeemCodeBulkDelete`, `discountBulkTagsAdd/Remove`.
- Gift cards: `giftCardCreate/Update/Credit/Debit/Deactivate/SendNotificationToCustomer/SendNotificationToRecipient`,
  `giftCardProductSet`.
- Content: `blogCreate/Update/Delete`, `articleCreate/Update/Delete`, `commentApprove/Delete/Spam/NotSpam`,
  `shopPolicyUpdate`, `urlRedirectCreate/Update/Delete`, `urlRedirectBulkDelete*`, `urlRedirectImportCreate/Submit`.
- Files and uploads: `fileUpdate`, `fileDelete`, `fileAcknowledgeUpdateFailed`, `stagedUploadsCreate`,
  `stagedUploadTargetGenerate`, `stagedUploadTargetsGenerate`.
- Webhooks and bulk: `webhookSubscriptionCreate/Update/Delete`, `bulkOperationRunQuery`, `bulkOperationRunMutation`,
  `bulkOperationCancel`.
- Inventory and locations: `inventoryActivate`, `inventoryDeactivate`, `inventoryBulkToggleActivation`,
  `inventoryMoveQuantities`, `inventorySetOnHandQuantities`, `locationActivate/Deactivate/Delete`,
  `locationLocalPickupEnable/Disable`, transfer mutations (10).
- Theme: `themeCreate`, `themeDelete`, `themeDuplicate`, `themeUpdate`, `themeFilesCopy`, `themeFilesDelete`.
- Settings and platform: `metafieldDefinition*`, `metafieldsDelete`, `metaobject*`, `savedSearch*`,
  `shopLocaleEnable/Disable/Update`, `translationsRegister/Remove`, `storefrontAccessTokenCreate/Delete`,
  `delegateAccessTokenCreate/Destroy`, `consentPolicyUpdate`, `publication*`, `publishablePublish/Unpublish`.

Scope notes: the exclusion filter also removed some borderline items (`orderCapture`, `paymentTerms*`,
`shippingPackage*`, `shippingLabelPurchase`, `deliveryProfile*`); a merchant who sells physical goods will eventually
want capture (authorize-then-capture) and packages.

### 2.4 Missing fields on core types (non-deprecated only)

| Type | Have / total | Notable missing fields |
|---|---:|---|
| Product | 31 / 63 | `priceRange`, `compareAtPriceRange`, `totalVariants`, `category` (taxonomy), `events`, `onlineStorePreviewUrl`, `metafieldDefinitions`, `translations`, `giftCardTemplateSuffix`, `publishedOnPublication` family, `resourcePublications*`, bundle/combined-listing/selling-plan fields |
| ProductVariant | 20 / 41 | `unitPrice`, `unitPriceMeasurement`, `showUnitPrice`, `taxCode`, `sellableOnlineQuantity`, `presentmentPrices`, `contextualPricing`, `events`, `translations`, publication fields |
| Collection | 16 / 29 | `createdAt` is absent while `updatedAt` exists, `events`, `sources`, `translations`, `feedback`, publication fields |
| Order | 69 / 129 | `totalPrice`-style flat money fields (only the `*Set` forms), `cancellation`, `channelInformation`, `customerJourneySummary`, `fulfillmentOrders`, `returns`, `returnStatus`, `risk`, `riskLevel`, `suggestedRefund`, `statusPageUrl`, `confirmationNumber`, `metafields`, `staffMember`, `paymentTerms`, `merchantEditable`, `agreements`, `edited`, `poNumber`, `totalCapturable`, `totalRefundedShippingSet`, `currentTaxLines` |
| LineItem | 30 / 39 | `discountAllocations`, `discountedUnitPrice`, `originalUnitPrice`, `originalTotal`, `discountedTotal`, `fulfillableQuantity`, `weight`, `totalDiscount` |
| Customer | 20 / 39 | `lastOrder`, `statistics`, `emailMarketingConsent`, `smsMarketingConsent`, `metafields`, `events`, `taxExemptions`, `mergeable`, `canDelete`, `image`, `unsubscribeUrl`, `validEmailAddress`, `lifetimeDuration` |
| DiscountCodeNode | 2 / 5 | `events`, `metafields`, `metafield` (also `DiscountCodeBasic.customerSelection`, `discountClass`) |
| Shop | 15 / 58 | `shopAddress`, `plan`, `currencySettings`, `enabledPresentmentCurrencies`, `shopPolicies`, `timezoneOffset`, `timezoneAbbreviation`, `storefrontUrl`, `shipsToCountries`, `customerAccounts`, `checkoutApiSupported`, `orderNumberFormatPrefix/Suffix`, `taxShipping`, `features`, `metafields`, `resourceLimits`, `paymentSettings`, connection fields (`products`, `orders`, ...), `shopOwnerName`, `domains` |
| Fulfillment | 11 / 21 | `displayStatus`, `estimatedDeliveryAt`, `events`, `inTransitAt`, `fulfillmentOrders`, `location`, `service`, `originAddress` |
| Refund | 10 / 15 | `staffMember`, `return`, `orderAdjustments`, `refundShippingLines`, `totalRefunded` |
| OrderTransaction | 15 / 32 | `amount*`, `paymentDetails`, `authorizationCode`, `authorizationExpiresAt`, `maximumRefundable`, `paymentIcon`, `receiptJson`, `user`, `location` |

Types absent entirely: `DraftOrder`, `FulfillmentOrder`, `Blog`, `Article`, `Comment`, `GiftCard`, `UrlRedirect`,
`WebhookSubscription`, `BulkOperation`, `DiscountAutomaticBasic/Bxgy/FreeShipping`, `DiscountCodeBxgy`, `Return`,
`MetafieldDefinition`, `Metaobject`, `Publication`, `SavedSearch`. Object types overall: 229 ours against 2,117 in the reference; most of
the reference types belong to excluded areas.

Input coverage on the core mutations is better than field coverage: `ProductCreateInput` 15/18, `ProductUpdateInput`
16/18, `ProductVariantsBulkInput` 13/19 (no `mediaSrc`, `quantityAdjustments`, unit price), `CustomerInput` 10/16 (no
marketing consent inputs, metafields, tax exemptions), `DiscountCodeBasicInput` 12/13, `OrderInput` 7/11,
`CollectionInput` 12/13. The query arguments on `products`, `orders`, `customers` match (first/after/last/before/reverse/
query/sortKey/savedSearchId).

### 2.5 Behavior differences

- Versioned endpoint `POST /admin/api/:version/graphql.json` and the access-token header are honored; any
  version string matching a pattern is accepted and served by the same schema (no per-version behavior).
- No `extensions.cost` throttle headers (`X-Shopify-Shop-Api-Call-Limit` style) were found; `cost.ts` exists for
  query cost, but REST-style limit headers are not emitted. Tools that read throttle status will see none.
- No REST Admin API at all (clients still using `/admin/api/<v>/products.json` fail). Probably acceptable, since the
  reference is deprecating REST, but the older ecosystem expects it.
- No bulk operations and no staged uploads, so large imports by existing tools (which always use staged upload +
  bulk mutation) cannot work against ShopMe.
- No outbound webhooks (tables `webhook_subscriptions` and `webhook_deliveries` exist; `apps/server/src/webhooks/index.ts` is empty).
- No OAuth app install flow; only staff session cookie and static API tokens.

---

## 3. Admin UI against the 39 screenshots

Routes we have: `/`, `/products`, `/products/:id`, `/collections`, `/collections/:id`, `/inventory`, `/orders`,
`/orders/:id`, `/customers`, `/customers/new`, `/customers/:id(/edit)`, `/discounts`, `/discounts/:id`,
`/online-store` (themes), `/online-store/pages(/:id)`, `/online-store/navigation`, `/online-store/themes/:id/editor`,
`/settings/{general,payments,shipping,taxes,domains,languages}`. Everything else falls into a "page not found" shell.
Navigation items in the reference that have no route at all: Drafts, Shipping labels, Abandoned checkouts, Purchase
orders, Transfers, Gift cards, Growth, Content (blogs, files), Markets, Finances, Analytics, Apps, and the settings
entries Plan, Billing, Users, Checkout, Customer accounts, Locations (a locations picker exists on inventory only),
Markets, Apps, Sales channels, Customer events, Notifications, Metafields and metaobjects, Customer privacy, Policies.

| # | Screen | Our route | Status | Missing on our page |
|---|---|---|---|---|
| 01 | Home / dashboard | `/` | Partial | Store preview card with launch (publish) action, setup checklist with progress, "next step" prompt, Sidekick-style assistant (out of scope), notification bell; we show sales, orders, AOV, top products and a 7-day chart |
| 02 | Products list | `/products` | Covered | Saved views, column chooser, export/import buttons |
| 03 | Products search + filters | `/products` | Partial | Filters limited to status/type/vendor/tag; no collection, inventory-status, category or sales-channel filters, no saved view |
| 04 | Product edit, top + variants | `/products/:id` | Partial | Category picker, variant-level media, cost per item, unit price, charge-tax toggle, sales-channel/market availability, "view as", preview, share, next/previous product, duplicate action in UI |
| 05 | Variant stock + shipping | `/products/:id` | Partial | Per-location quantity editing inside the variant, HS code, country of origin, package, bulk variant editing |
| 06 | Metafields + SEO | `/products/:id` | Partial | SEO fields present; no metafield editor (API `metafieldsSet` exists), no metafield definitions |
| 07-09 | Create product | `/products/new` | Partial | Same as 04/05 plus gift-card flag, statistics, AI description, publishing section |
| 10 | Collections list | `/collections` | Covered | Saved views, publish state per channel |
| 11 | Automatic collection conditions | `/collections/:id` (`ConditionsBuilder`) | Covered | Condition set is smaller than the reference's (no metafield conditions) |
| 12 | Create collection | `/collections/new` | Partial | Publishing, SEO preview, theme template picker is absent |
| 13 | Inventory | `/inventory` | Partial | Tabs for incoming/committed/unavailable states, CSV import/export, per-reason adjustments, history |
| 14 | Orders list | `/orders` | Partial | Saved views, status filter chips, delivery status, channel, tags, return status, print and export, date range presets |
| 15 | Order detail | `/orders/:id` | Partial | Edit order, change customer, edit shipping/billing address, customer notes, send invoice, print packing slip, duplicate, risk analysis, conversion summary, returns, fulfillment per location, payment capture/void; present: fulfill + tracking, refund, mark paid, cancel, archive, comments, tags, timeline |
| 16 | Order timeline | `/orders/:id` | Covered | Email resend and email preview in timeline entries |
| 17 | Customers list | `/customers` | Covered | Segments, import/export, saved views, "email subscribers" filter |
| 18 | Customer detail | `/customers/:id` | Partial | Marketing consent state/update, tax-exempt per region, store credit, timeline and comments, merge, send account invite, order-per-customer metrics beyond count and spend |
| 19 | Discounts list | `/discounts` | Covered | Automatic discounts (list has codes only), saved views, status tabs |
| 20 | Discount type chooser | none | Missing | Type picker (amount off products, buy X get Y, amount off order, free shipping) |
| 21-22 | Discount form | `/discounts/:id` | Partial | Automatic method, buy-X-get-Y, order-level amounts, customer eligibility groups, purchase type, sales channels, tags, combinations with specific classes; present: percentage/fixed, products or collections scope, minimum, usage limits, once per customer, dates, free shipping |
| 23-24 | Payments settings | `/settings/payments` | Partial | Providers beyond Stripe/bank transfer/COD, manual custom methods, authorize vs capture, wallet buttons, per-provider test mode panel |
| 25-26 | Shipping settings | `/settings/shipping` | Partial | Delivery profiles per product/location, packages, shipping-label rates, local delivery and pickup, order routing rules, estimated delivery dates, carrier rates; present: zones and flat/weight/price-tier rates |
| 27-28 | Taxes settings | `/settings/taxes` | Partial | Automatic tax regions, per-collection overrides, VAT number collection, duties, tax on shipping per region; present: manual per-zone rates, includes-tax toggle |
| 29 | Domains | `/settings/domains` | Partial | Read-only display plus DNS hint; no domain connection or verification (acceptable for self-hosting) |
| 30 | Languages | `/settings/languages` | Partial | Store locale only; no additional languages, translation editor, per-market languages |
| 31 | Theme editor overview | `/online-store/themes/:id/editor` | Partial | Section tree (header/template/footer groups), add/remove/reorder sections and blocks, per-template switching, undo/redo, publish/save from the editor |
| 32-33 | Add section dialogs | none | Missing | Section library with categories and previews |
| 34-35 | Section and block settings | none | Missing | Per-section and per-block setting panels |
| 36-38 | Theme settings list, palette, typography | editor (global settings) | Covered | Schema-driven global settings render (colors, fonts, text, ranges, selects, images, links); font library is a smaller list |
| 39 | Mobile preview | editor device toggle | Covered | None observed |

Counts: 10 covered, 24 partial, 5 missing; weighted score (covered = 1, partial = 0.5, missing = 0) = 22 / 39 = 56%.

---

## 4. Storefront routes and endpoints

Sources: HAR, route probe, ajax recordings and the 2026-11-04 probe. Analytics, pixel, telemetry and checkout-widget
requests (`/.well-known/shopify/monorail/*`, `/api/collect`, `/web-pixels*`, `/cdn/wpm/*`, `/cdn/shopifycloud/*`,
`/private_access_tokens`, `/services/login_with_shop/*`) were excluded: they are platform plumbing, not behavior a
theme depends on. Each row compares what the reference returns with what our server returns for the same request.

| Route | Reference | ShopMe | Status |
|---|---|---|---|
| `/` | 200 | 200 | Implemented |
| `/collections`, `/products` | 200 list-collections | same | Implemented |
| `/collections/all`, `/collections/:h`, `?page`, `?sort_by`, `filter.*` | 200, bogus sort ignored | same, filters parsed | Implemented |
| `/collections/:h/:tag` | 200 filtered | 200 filtered | Implemented |
| `/collections/:h.atom`, `/collections/:h/products.atom` | 200 `application/atom+xml` | 404 HTML (the `products.atom` path returns an HTML 200 page, wrong) | Missing |
| `/collections/:h/products.json` | 200 JSON | 200 JSON | Implemented |
| `/collections/vendors?q=`, `/collections/types?q=` | 200 themed listing | 404 | Missing |
| `/collections.json`, `/products.json` | 200 JSON | 200 JSON (`updated_at` null on collections) | Partial |
| `/products/:h` (+ `variant`, `view`) | 200, unknown view ignored | same | Implemented |
| `?sections=a,b`, `?section_id=` | JSON map / partial HTML | implemented in the renderer | Implemented |
| `/products/:h.js`, `.json`, `.oembed` | 200 JSON | 200 | Implemented |
| `/collections/:c/products/:h` | 200 | 200 | Implemented |
| `/cart` | 200 | 200 | Implemented |
| `/cart.js`, `/cart.json` | 200 | 200 | Implemented |
| `/cart/add(.js)`, `change`, `update`, `clear` incl. GET variants | 200/422 per recordings | same shapes | Implemented |
| `GET /cart/add?id=&quantity=` | 422 JSON | 404 JSON | Partial difference (minor) |
| `/cart/<variant>:<qty>` permalink | 302 to `/checkouts/cn/<token>/<locale>`; unknown variant 410 | 302 to `/checkout`; unknown variant also 302 | Partial |
| `/discount/CODE?redirect=` | 302 to redirect target, sets `discount_code` cookie, applied at checkout | 404 | Missing |
| `/checkout` | 302 to hosted checkout path | handled on same path | Implemented (different URL scheme) |
| `/checkouts/cn/<token>/<locale>` | checkout page | `/checkouts/:token` | Partial (URL shape differs; themes do not link here) |
| `/search` (+ `q`, `sort_by`, filters) | 200, title with count | 200 | Implemented |
| `/search?type=product,page,article`, `options[prefix]` | resource-type restriction | accepted, but only products are searched | Partial |
| `/search.json` | 200 JSON | 404 | Missing |
| `/search/suggest(.json)` | 200 JSON/HTML | 200; articles always empty | Partial |
| `/recommendations/products(.json)` | 200 | 200 (related by simple heuristic; `complementary` intent not distinct) | Implemented |
| `/pages/:h` | 200 / 404, `page.contact` template | same | Implemented |
| `/policies/:h` | 200 / 404 | 200 / 404 (policies read from shop settings; no admin editor) | Implemented |
| `/blogs/:b`, `/blogs/:b/:a`, `.atom`, `/tagged/:tag` | 200 (blog template) | 404 | Missing (3 patterns) |
| `/account`, `/account/login`, `/account/register`, `/account/logout`, `/account/orders` | 302 to hosted accounts (new accounts) or local forms (classic) | 404 | Missing |
| `/password`, `POST /password` | 200 form, 302 on success | same | Implemented |
| `/robots.txt` | ~60 lines (wildcard disallows for filters, cart, checkout, account, sort_by, `+` in collections) | 5 lines, only a handful of disallows | Partial |
| `/sitemap.xml` | sitemap index with child sitemaps (products, collections, pages, blogs) | single flat `urlset`; no blogs, no images, no child sitemaps | Partial |
| `/sitemap_*_N.xml` children | served (signed names) | 404 | Missing |
| `/meta.json` | 200 JSON store descriptor | 404 | Missing |
| `/.well-known/ucp` | 200 JSON commerce profile | 404 | Missing (P2, vendor-specific) |
| `/gift_cards/:id`, `/orders/:token` | 200 pages (404 without valid id) | 404 | Missing |
| `POST /localization` (country and language switch) | cookie switch, redirect | no handler (404) | Missing |
| `POST /contact` and customer newsletter form | 302 with `posted_successfully`, sends email | no handler (form tag emits action but no route) | Missing |
| `/cdn/shop/t/<id>/assets/*` | immutable cache with `?v=` | implemented, `cache-control` immutable when versioned | Implemented |
| `/cdn/shop/files/*` with `?width=` transformations | on-the-fly resize, WebP/AVIF | `/files/*` served as-is; query params ignored | Partial |
| Themed 404 | 404 HTML | 404 HTML | Implemented |

Pattern count: 53 patterns: 30 implemented, 8 partial, 15 missing; weighted (partial = 0.5) 34 / 53 = 64%.

Response header differences (HTML pages): the reference sends `cache-control: private, max-age=0, must-revalidate`,
`content-language`, `x-frame-options: DENY`, a CSP with `frame-ancestors 'none'`, HSTS, a `link` header advertising the
commerce profile, and sets `localization` and `cart_currency` cookies. We send `cache-control: no-cache`,
`x-content-type-options`, `referrer-policy` only. Discount links add `x-robots-tag: noindex, nofollow`.

---

## 5. Themes and Liquid

### 5.1 Tags and filters

- Tags: all 22 P0 tags and the P1 tags (`section`, `layout`, `cycle`) registered, including Shopify-specific `schema`,
  `doc`, `stylesheet`, `javascript`, `style`, `form`, `paginate`, `content_for`, `sections`. P2 tags `include`,
  `tablerow`, `decrement`, `raw`, `render` present; `ifchanged` absent.
- Filters: every filter listed as P0 or P1 in `liquid-compat.md` is registered (about 90 Shopify-specific and standard
  filters). Of 42 P2 filters probed (`img_url`, `link_to_tag`, `sha256`, `base64_*`, `pluralize`, `color_*` extras,
  `customer_*_link`, ...) only `metafield_text` is missing. Several are stubs by design per the spec
  (`payment_terms`, `payment_button`, `login_button`, `applicable_disclosures`, `model_viewer_tag`,
  `payment_type_svg_tag` draws a text placeholder).
- Pagination, forms and `render` isolation behave as the spec describes; `image_url` appends `width`/`height`/`crop`/
  `format` query parameters but the server never resizes (see 4).

### 5.2 Rendering the third-party themes

Both themes were installed into a seeded demo shop and requested through the storefront:

| Theme | Liquid files | Parsed | Unknown tags / filters | Pages tested (status, Liquid errors) |
|---|---:|---:|---|---|
| Horizon | 282 | 282 | none | home 200/0, product 200/0, collection 200/0, cart 200/0, search 200/0, page 200/0, collections list 200/0, 404 404/0, blog 404 (no blog support) |
| test-data-main | 113 | 113 | none | same set, same result |

Rendering is complete, but correctness of the output was not compared pixel-wise against the reference; Horizon
relies on metafields, quantity rules, discount allocations and localization data that we serve as empty values (below).

### 5.3 Objects missing or stubbed (depth, not just names)

Of 36 P0/P1 global objects in the spec, 31 exist. Absent: `article`, `blog` (no routes), `gift_card`, `order`
(status/thank-you page object), and `customer` is always `null`. Stubs that themes will notice:

- `metafields` is `{}` on product, variant and collection even though the admin stores metafields; themes that read
  `product.metafields.<ns>.<key>` get nothing.
- Cart and line-item discounts: `total_discount` is 0, `discounts` and `cart_level_discount_applications` are empty;
  discounts are only applied inside our checkout, so a theme cart never shows a discounted price.
- `shop.features`, `shop.customer_accounts_enabled` (false), `shop.enabled_currencies` (one), `localization`
  (one country, one language), `selling_plan_*` (empty), `quantity_rule` and price breaks (defaults), `unit_price_*`
  (null), `product.category` and standard taxonomy (absent), `shop.brand` (empty).
- `collections.all`, `all_products`, `linklists`, `pages`, `routes` are present. Missing P2 objects from the spec:
  `blogs`, `articles`, `images`, `metaobjects`, `shop_locale`, `scripts`, `policy` (as a global), `robots`.
- Theme architecture: JSON templates, section groups, theme blocks, `blocks/` directory, snippets, locales and
  `settings_data.json` presets all load. There is no theme zip upload or install in the admin; themes get in via
  `themeFilesUpsert`, seed, or the placeholder CLI.

---

## 6. Behavior differences worth tracking (cross-cutting)

1. Checkout is ShopMe's own server-rendered page (`/checkout`, `/checkouts/:token`), not the reference's checkout; it
   cannot be restyled by the theme or by checkout extensibility, and it does not use the same URL scheme.
2. Discount codes act only at checkout; the cart, the Ajax responses and the product pages know nothing about them.
3. Search covers products only, with no ranking beyond substring and best-selling; no typo tolerance and no
   article/page search. Predictive search supports `product`, `collection`, `page` and returns no `queries` or `tags`.
4. Images are served as uploaded; no resizing, no WebP/AVIF, no CDN integration, no alt-text tools. A focal point can be set per image, and the Aurora theme applies it as `object-position`.
5. HTML pages are `no-cache`; the reference revalidates and relies on edge caching. No page caching layer exists.
6. Emails come from two hard-coded templates and need an SMTP URL; without one, mail is logged and dropped.

---

## 7. Merchant journey, A to Z

Legend: Y present, P partial, N absent. Score: Y = 1, P = 0.5, N = 0; 30 capabilities: 4 Y, 10 P, 16 N, weighted 9 / 30 = 30%.

| # | Capability | Status | Notes |
|---|---|---|---|
| 1 | Onboarding / first run | Y | Setup wizard creates shop and owner; a "get started" card exists on Home. No guided checklist, no sample data option, no theme choice step |
| 2 | Catalog editing | Y | Products, variants, options, media, collections (manual and rule-based), tags, vendors, types |
| 3 | Catalog import/export (CSV) | N | No CSV code anywhere (`grep csv` finds nothing), no products, customers, inventory or discount import/export |
| 4 | Migration from Shopify | N | `packages/migrate` is a placeholder; no product/customer/order importer, no URL redirect import |
| 5 | SEO: meta fields | Y | Page title and description on products (and collections, pages); handle editing |
| 6 | SEO: sitemap and robots | P | Flat sitemap, 5-line robots; see section 4 |
| 7 | SEO: URL redirects | N | `url_redirects` table exists, nothing reads or writes it; no 301 on handle change |
| 8 | Customer accounts (login, order history, addresses, password reset) | N | No `/account/*`, `customer` object always null, `customer_accounts_enabled` false; checkout is guest-only |
| 9 | Blogs and articles | N | `blogs` and `articles` tables exist; no admin, no storefront routes, no feed |
| 10 | Pages, navigation menus | Y | Admin editors for pages and menus; policies exist in settings JSON but have no editor |
| 11 | Gift cards | N | Roadmap lists them as not started; product flag exists, no balance model |
| 12 | Abandoned checkouts | N | Carts persist, but there is no checkout capture list, no recovery email, no admin screen |
| 13 | Draft orders / manual orders | N | No `draftOrder*` or `orderCreate`; phone and invoice orders impossible |
| 14 | Order handling | P | Fulfill with tracking, refund (with restock), cancel, archive, mark paid, comments, tags. Missing: order editing, returns/exchanges, partial fulfillment by location, capture/void, packing slips, invoices |
| 15 | Payments | P | Stripe (PaymentIntents, signed webhooks), bank transfer, COD. No PayPal, no wallets, no BNPL, no 3DS configuration screen, no payout view |
| 16 | Shipping | P | Zones and rates (flat, weight, price tiers). No carrier-calculated rates, no labels, no local delivery/pickup, no packages |
| 17 | Taxes | P | Manual per-zone rates, includes-tax toggle. No automatic VAT, OSS, per-product tax overrides, tax invoices |
| 18 | Discounts | P | Code discounts (percentage, fixed, free shipping) with limits and dates. No automatic discounts, no buy-X-get-Y, no order-level discount, no bulk code generation |
| 19 | Notifications / email templates | P | Order confirmation and staff new-order email, hard-coded, no editor, no shipping, refund, account, abandoned or gift-card emails, no logo/branding settings |
| 20 | Staff accounts and permissions | P | Roles `owner`/`admin`/`staff` in schema and `staffMembers` query; no Users screen, invite flow, or permission enforcement per area |
| 21 | Security (2FA, login protections) | P | Argon2 password hashing, sessions, API tokens, rate-limit plugin. No 2FA, no login alerts, no staff session list, no admin CSP |
| 22 | Analytics and reports | P | Dashboard with sales by day, AOV, top products. No reports, no traffic, no conversion, no export |
| 23 | Multi-currency and markets | N | Single currency, single market, no presentment currency |
| 24 | Languages / translations | N | Admin is EN/FR; storefront single locale; no translatable content or theme locale switching |
| 25 | Shipping labels | N | No label purchase, no carrier integration |
| 26 | Returns | N | No returns model or admin flow; refunds only |
| 27 | Webhooks and apps | N | No outbound webhooks, no OAuth, no app embedding, no script tags |
| 28 | Backups and portability | N | Docker volume only; no export/import of a store (roadmap Phase 5), no scheduled backups |
| 29 | Legal pages, cookie consent, GDPR | N | Policies are readable on the storefront but cannot be edited in the admin; no consent banner, no customer data export or erasure, no marketing consent capture at checkout |
| 30 | Performance (image resizing, CDN, caching) | N | No resizing or format conversion, no HTML caching, no CDN hooks; theme assets cache well |

---

## 8. Prioritized gap list

Size: S under 2 days, M about a week, L more than a week or a new subsystem. Hints name the integration point.

### P0: blocks a typical small merchant from replacing Shopify

| # | Gap | Hint | Size |
|---|---|---|---|
| P0-1 | Customer accounts (register, login, logout, password reset, order history, address book, `customer` Liquid object, `/account/*` routes incl. classic templates) | Local auth tables on `customers`, session cookie `customer_token`, render `customers/*` theme templates, `customer_login` form POSTs; set `customer_accounts_enabled` | L |
| P0-2 | Theme install/upload in the admin (zip upload, duplicate, delete, rename, `themeCreate/Delete/Duplicate`, `themeFilesCopy/Delete`) | Reuse `installThemeFiles`; add multipart route + `/online-store/themes` upload dialog | M |
| P0-3 | Section-level theme editor (add/remove/reorder sections and blocks, per-section settings, template switching, save to `templates/*.json`) | Extend `ThemeEditor` using `liquid-compat` schema parsing and `themeFilesUpsert`; preview via `section_id` rendering | L |
| P0-4 | CSV import/export for products, customers, inventory | Streaming parser in core service + admin Import/Export dialogs; match the reference column names to ease migration | M |
| P0-5 | Shopify migration importer | `packages/migrate`: read export CSVs/Admin API, map products, variants, images, collections, customers, orders, pages, menus, redirects | L |
| P0-6 | Notification emails: shipping confirmation, refund, order cancelled, customer account invite/reset, plus editable templates and sender settings | Template registry in `core/mail`, hooks on fulfillment/refund events, Liquid-rendered subject/body editor in Settings > Notifications | M |
| P0-7 | Draft orders and manual orders (create, edit lines, discount, send invoice link, mark paid, convert) | `draftOrder*` GraphQL + admin page; reuse order creation service | L |
| P0-8 | Staff management and permissions (invite, roles, deactivate, enforce per area, list sessions) | `staff_users` already has `role`; add Settings > Users page, invite email, permission map checked in GraphQL context | M |
| P0-9 | URL redirects (table exists) with 301 on handle change and bulk CSV import | Storefront catch-all consults `url_redirects`; admin Navigation > URL redirects; `urlRedirect*` mutations | S |
| P0-10 | Policies editor and legal pages (refund, privacy, terms, shipping), cookie/consent basics | Settings > Policies page writing `shop.settings.policies`; basic consent banner snippet; customer data export | S |
| P0-11 | Image resizing and WebP/AVIF (`image_url` width/height/crop/format, srcset) | `sharp` route on `/files/*` honoring query params with disk cache and long cache headers | M |
| P0-12 | Cart-level discounts in cart, Ajax responses and Liquid (`total_discount`, `discount_applications`, line allocations) and `/discount/CODE` | Run the pricing service on cart reads; store `discount_code` cookie; return reference shapes | M |
| P0-13 | Storefront blogs and articles (admin editors, `/blogs/*` routes, atom feed, `article`/`blog` objects, sitemap entries) | Tables exist; add content services, `blogs`/`articles` modules, templates `blog` and `article`, comments optional | M |
| P0-14 | Contact and newsletter forms (`POST /contact`, `customer` form to create marketing customer, success flag in `form`) | Route handler validates, emails shop owner, creates customer with consent | S |
| P0-15 | Outbound webhooks with HMAC and a management UI | Fill `webhooks/index.ts`: subscribe on domain events, queue delivery with retries, `webhookSubscription*` API | M |

### P1: expected soon

| # | Gap | Hint | Size |
|---|---|---|---|
| P1-1 | Gift cards (issue, balance, redeem at checkout, `/gift_cards/:id`, email) | New table, checkout payment method, `giftCard*` API, `gift_card` Liquid object | L (done in wave 7a, see `docs/dev/commerce.md`) |
| P1-2 | Abandoned checkouts list and recovery email | Persist checkout sessions with email; `abandonedCheckouts` query; scheduled job to send | M (done in wave 7a, see `docs/dev/commerce.md`) |
| P1-3 | Order editing, returns and exchanges | `orderEdit*`, `return*` mutations, admin dialogs, restock rules | L (done in wave 7a, see `docs/dev/commerce.md`) |
| P1-4 | Automatic discounts, buy-X-get-Y, order-level and bulk codes | Extend discount model and pricing service; admin type chooser (screen 20) | M (done in wave 7a, see `docs/dev/commerce.md`) |
| P1-5 | Sitemap index with child sitemaps, richer robots, atom feeds (`/collections/:h.atom`), `/search.json`, `/meta.json`, `x-robots-tag` on redirects | Pure route work in `pages.ts`; mirror reference robots rules **Done (wave 7b): `/collections/:h.atom`, `/meta.json`, `/search.json`, `x-robots-tag`, canonical/hreflang, Product JSON-LD. Gap: blog Atom feeds.** | S |
| P1-6 | Storefront metafields in Liquid and metafield definitions UI | Resolve `metafields` lazily per resource; add definition tables and admin editor **Done (wave 7b): definitions API and settings page, typed editor on product/variant/collection/customer/order, Liquid `metafields.ns.key` (`value`, `type`, `list`), `metafield_tag`/`metafield_text`. Gap: article/page/blog owners, `metafieldsDelete`.** | M |
| P1-7 | Search upgrade: type filter, articles/pages, prefix option, ranking, typo tolerance | Postgres `tsvector` + trigram; extend `buildSearch` and `suggest` **Done (wave 7b): full-text ranking, `type` and `options[prefix]`, typo tolerance (pg_trgm when allowed, else edit distance), pages and articles, predictive `queries` and Aurora dropdown.** | M |
| P1-8 | Multi-location inventory, locations settings, transfers | `inventoryActivate`, per-location pickers, fulfillment per location **Done (wave 7b): locations page, `inventoryActivate/Deactivate/MoveQuantities`, `locationActivate/Deactivate`, priority allocation, fulfillment location. Gap: moves between quantity names, purchase orders.** | M |
| P1-9 | Shipping labels and carrier rates, packages, local pickup/delivery | Provider interface in `packages/payments`-style package; start with one carrier or a generic rate API | L |
| P1-10 | Product page admin gaps: variant media, cost per item, unit price, category, metafield editor, duplicate/preview/share | Extend `ProductEdit` and `productSet`, `productVariantAppendMedia`, `productUpdateMedia` **Done (wave 7b): variant image, unit price, category picker, duplicate, preview, metafields, bulk editor. Gap: `productVariantAppendMedia`, share link.** | M |
| P1-11 | Admin API completeness: `productSet`, `productChangeStatus`, `productPublish`, `customerAddress*`, `fileDelete/Update`, `stagedUploads*`, saved searches, `locationsCount`, `staffMember`, `currentStaffMember`, publications | Mostly thin wrappers over existing services **Done (wave 7b): `productSet`, `productChangeStatus`, `publications`/`publishablePublish`, `customerAddress*`, `files`/`fileUpdate`/`fileDelete`, `stagedUploadsCreate`, `locationsCount`. Gap: saved searches, `productPublish`, `staffMember`.** | M |
| P1-12 | Bulk operations (`bulkOperationRunQuery/Mutation`, JSONL) | Job queue + JSONL writer; needed by import tools | L |
| P1-13 | Core type fields: `Product.priceRange`, `compareAtPriceRange`, `totalVariants`, `onlineStorePreviewUrl`, `Order.totalPrice`-family, `fulfillmentOrders`, `suggestedRefund`, `Customer.lastOrder/statistics/emailMarketingConsent`, `Shop.shopAddress/currencySettings/shopPolicies` | Resolvers over existing data; gains most client compatibility per line of code **Done (wave 7b) except `Order.fulfillmentOrders` and `suggestedRefund`.** | M |
| P1-14 (done, see docs/dev/platform.md) | Analytics reports (sales over time, by product, by channel, customers, export) | Extend `analytics` service; reports page; `shopifyqlQuery` is not required | M |
| P1-15 (done, see docs/dev/platform.md) | 2FA for staff (TOTP), session list, login alerts | `otplib`, recovery codes, enforce for owner | M |
| P1-16 (done, see docs/dev/platform.md) | Security headers on storefront (frame, HSTS option, CSP report-only), HTML cache strategy with ETag | Fastify hooks in `storefront/index.ts` | S |
| P1-17 (done, see docs/dev/platform.md) | Store export/import and scheduled backups | JSON/zip export of DB rows and files; `pg_dump` helper in CLI | L |
| P1-18 (done, see docs/dev/platform.md) | Languages and translations (additional storefront locales, translatable resources, `/localization` switch) | `translations` tables, `shopLocale*` and `translationsRegister`, locale prefix routing off by default | L |

### P2: nice to have

| # | Gap | Hint | Size |
|---|---|---|---|
| P2-1 | Multi-currency and markets (presentment prices, rounding, country-specific pricing) | Currency table, cookie `cart_currency`, price conversion in pricing service | L |
| P2-2 | Customer segments and saved views | Query language over customers; `segment*` and `savedSearch*` | L |
| P2-3 | Transfers, purchase orders, inbound shipments | Depends on multi-location | L |
| P2-4 | Metaobjects and standard definitions | Dynamic content tables, theme `metaobjects` object | L |
| P2-5 | OAuth app platform, script tags, app extensions | Token exchange flow, app embedding | L |
| P2-6 | Draft order calculator extras, payment terms, B2B | Out of scope for small merchants | L |
| P2-7 | `/.well-known/ucp`, `/localization.json`-style profile documents, `link` headers | Static JSON generated from shop settings | S |
| P2-8 | Missing P2 Liquid items: `ifchanged`, `metafield_text`, objects `blogs`, `articles`, `images`, `metaobjects`, `shop_locale`, `scripts`, `robots` | Small additions in `liquid-compat` **Partly done (wave 7b): `metafield_tag`, `metafield_text`.** | S |
| P2-9 | REST Admin API shim for legacy tools | Thin adapter over GraphQL services | L |
| P2-10 | Admin: saved views, column chooser, bulk editor spreadsheet, command palette search | Frontend work only | M |
| P2-11 | Dashboard setup checklist, store preview card, go-live toggle | `setup-progress` endpoint described in `admin-ux.md` | S |
| P2-12 | Throttle headers and cost extensions on the Admin API | `extensions.cost` already computable via `cost.ts` **Done (wave 7b): `extensions.cost` computed (requested/actual) with a per-shop throttle bucket. Gap: HTTP throttle headers, requests are never refused.** | S |
| P2-13 | Desktop packaging, one-click deploy, Helm (roadmap Phase 5) | Ops work | M |

---

## Next features

Implementation-ready specs now exist for the largest remaining gaps. P2-1 (markets and multi-currency): [markets.md](markets.md).
P2-3 (transfers, purchase orders): [inventory-transfers.md](inventory-transfers.md) and [purchase-orders.md](purchase-orders.md).
P2-4 (metaobjects): [metaobjects.md](metaobjects.md). Also specified: shipping profiles, pickup and local delivery
([shipping-profiles.md](shipping-profiles.md)), store credit ([store-credit.md](store-credit.md)), and customer account settings, privacy
and customer events ([customer-privacy-accounts-events.md](customer-privacy-accounts-events.md)).

## 9. Notes on method and limits

- Root-field and type-field comparisons are by name only; nullability, argument sets (apart from the three list
  queries) and enum values were not diffed field by field. A conformance suite (roadmap Phase 0) would turn this into
  pass/fail data.
- Fields marked deprecated in the reference are excluded from field totals; they remain reachable for clients that still
  use them, and several (`totalPrice`, `images`, `bodyHtml`) are still widely used by older tools, so real client
  compatibility is lower than the 55% field figure suggests for legacy integrations.
- The route probe against our server used the seeded demo shop through in-process requests, so the comparison covers
  routing, status codes, content types and headers, not byte-level body equality.
- The screenshot scoring is subjective by nature; the table lists what is shown there and absent in our page so a
  reader can re-score.
- Not measured: accessibility, load performance, concurrency behavior and checkout payment edge cases (3DS, partial
  capture, failed webhooks).
