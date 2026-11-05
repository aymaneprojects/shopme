# Shipping profiles and delivery

Status: draft for implementation. API version studied: 2026-10. Names are listed for interoperability; behavior text is ours.
Admin screens were observed on our own development store (section 3).

## 1. Purpose

Replace the single list of shipping zones with delivery profiles (which products ship from which locations to which zones at
which rates), and add local pickup, local delivery, package presets, and provider interfaces for carrier-calculated rates and
shipping labels. Tie shipping options to markets in the admin the way current stores present them.

Existing in ShopMe: `shipping_zones`, `shipping_zone_countries` (country plus province codes, `*` = rest of world),
`shipping_rates` (type FLAT, WEIGHT_BASED, PRICE_BASED, FREE; min and max in grams or cents), `orders.shippingRateId`,
`order_shipping_lines`, `locations` (with `fulfillsOnlineOrders` and `priority`), `fulfillments`. No profiles, no per-product
shipping, no pickup, no local delivery, no packages, no carrier or label integration.

## 2. Concepts

- **Delivery profile**: a named set of products (variants) plus location groups. One **general profile** always exists and holds
  every variant not in another profile. Custom profiles hold chosen variants.
- **Location group**: the set of stock locations that ship the profile's items together. Each has **zones**.
- **Zone**: a named list of countries (and optionally provinces, or "rest of world"). Within a location group a country is in at
  most one zone.
- **Method definition** (a "rate" in merchant words): name, description, active flag, a price (merchant rate) or a carrier
  participant (calculated rate), and optional **conditions** on total weight or total price (operators greater-or-equal,
  less-or-equal).
- **Local pickup** and **local delivery** are per location settings, outside profiles.
- **Package**: a box, envelope, soft pack or flat-rate preset with dimensions and weight, one is the shop default.

## 3. Merchant-facing behavior

### 3.1 Admin screens (observed)

On a stores that have migrated to the markets-based layout, shipping options are edited from a market (Markets > market >
Customizations > Shipping). Settings > Shipping and delivery has a banner saying shipping moved to Markets with a "revert"
button back to the profile editor; the rates themselves are unchanged. We implement both views over one model (section 4).

**Shipping popover on the market page.** Title with an on/off switch ("Shipping", "N shipping options active"), then one card per
option: name, an overflow menu, the price line ("$8.00, free from $70.00 order amount"), transit time ("3 to 5 business days"),
and two chips: which products (e.g. "All products", or the collections) and which ship-from location. Bottom row: "Add a shipping
option". The switch off removes the market's custom shipping (it inherits the shop default).

**Add shipping option** (full-screen modal, title "Add a shipping option", close button; when something changed a floating bar
shows "Unsaved changes" with Cancel and Done):
- Option name text field.
- Chip row: status dropdown (Active / Inactive), Type dropdown (Fixed is the only one seen; calculated by carrier is the other
  kind), and a "+ Delivery details" link that reveals a description field.
- A preview strip showing how the option appears at checkout (radio, name, price, grey subtitle line, "FREE" for zero). With more
  than one rate the preview has previous/next arrows; a caption states the checkout shows the highest rate when the cart matches
  several rates, and a small label tells which rate is previewed.
- "Rate" section: a card per rate (titled "Rate 1", "Rate 2", with a trash button when there is more than one) containing:
  Price (decimal with currency suffix, default 0.00), Transit time (a dropdown; choices not captured), "Applies to" chip (a
  searchable multi-select of collections with product counts; the first entry is "All products" checked by default; the others are
  the store's collections), and "Ships from" chip (multi-select of the store's locations, summarized as "Name, Name, +1").
- A dashed "+ Rate" block adds another rate card.
- "Offer free shipping" switch; when on, a field "Minimum order amount" (currency suffix) enables.

**Per-option overflow menu** (edit, duplicate, delete: items inferred; to confirm).

**Settings > Shipping and delivery** (full page), sections top to bottom:
1. *Shipping options*: a collapsible card, count of markets; the banner described above; a table of markets with their option
   names as chips.
2. *Estimated delivery dates*: a collapsed row currently "Automated dates"; expands to settings (to capture).
3. *Shipping labels*: row with a "Calculate rates" button; collapsible (carrier accounts, preferred carriers).
4. *Packages*: collapsible, shows count ("1 box"). Expanded: each package row has an icon, name ("Sample box"), dimensions and
   weight text (e.g. "8.6 x 5.4 x 1.6 in, 0 lb"), a "Shop default" badge on the default, and an overflow menu; below, "Add a
   package". Dimensions and weight use the shop units.
5. *Business shipping accounts*: collapsed, "None".
6. *Order routing*: collapsed, "2 rules" (location priority rules; maps to `locations.priority` and a rule list, later).
7. *Additional delivery methods*: two rows with a status badge and chevron: Local delivery and Local pickup, each "Off" or "On".
8. *Documents*: table (name, modified date, newest first) with Pick list, Packing slip, Invoice, and a "Create document" dropdown.
9. *Delivery customizations*: description about hiding, reordering and renaming options at checkout via apps; one button to add a
   customization (out of scope; Functions).
10. *Custom order fulfillment*: a button "Add fulfillment service" that asks for an email address of whoever fulfills (maps to
   `fulfillmentServiceCreate`; later).

**Local pickup page** (Settings > Shipping and delivery > Local pickup): title, section "Your locations", an informational
banner (pickup can be offered even when the items are not stocked at the pickup point, by transferring stock between locations;
select a location to configure), then one row per active location: pin icon, name, address, and a grey badge "Doesn't offer
pickup" (or the pickup time when on). A row opens the location's pickup settings (not captured: expected pickup time dropdown
with the eight `DeliveryLocalPickupTime` values, instructions textarea, Turn on / Turn off buttons).

**Local delivery page**: title and sentence (deliver orders directly from your locations; also applies to subscriptions), list of
locations with badge "Doesn't offer delivery" (or "Delivers"), a learn-more link. A row opens the location's settings (not captured:
expected delivery area by radius or postal codes, price, minimum order price, delivery information shown to the buyer, phone
number).

### 3.2 Checkout behavior

Inputs: destination address, cart lines, cart subtotal and total weight, currency, market.
1. Group lines by profile (a variant is in exactly one profile; lines without a profile belong to the general profile). Lines whose
   inventory item has `requiresShipping = false` are ignored.
2. For each profile pick the location group that can ship the lines (all locations with stock; if several groups apply choose by
   location priority) and then the zone containing the destination (province zone beats country zone beats rest-of-world).
   No zone: the profile has no options.
3. Active rates whose conditions match (weight compared in grams, price in cart currency minor units, subtotal before shipping and
   after discounts when the rate's price condition is price based) are offered. For the option-based editor, a rate "applies to"
   only the lines in its collections; the option's price when several rates match is the highest. Free-shipping threshold turns
   the price to 0 when the cart total (qualifying lines) reaches it.
4. Combine profiles: options of the same name in every profile are summed into one option; if no common name exists the
   buyer sees the cheapest combination per name set (verify with captures, 7.2). Pickup and local delivery options are added when
   enabled and the location with stock is eligible.
5. Output list sorted by price ascending, then by merchant order; at most 1 rate per name. The chosen rate is stored on the order as
   a shipping line (`order_shipping_lines`) with title, price, code (rate id) and the delivery method type (SHIPPING, PICK_UP,
   LOCAL, NONE). `NONE` when the cart needs no shipping.
6. Carrier-calculated rates are requested in parallel with a 5 s timeout (configurable); failures hide those options only.
7. Pickup: choose a location; the order is routed to that location (fulfillment order assigned there); notification
   "ready for pickup" later (`fulfillmentOrderLineItemsPreparedForPickup`).
8. Local delivery: available only if the destination is within the location's area; fees and the minimum order apply; add a buyer
   note field for delivery instructions (later).

## 4. Data model proposal (Drizzle)

New tables replace `shipping_zones`, `shipping_zone_countries`, `shipping_rates` (migrated, section 4.1):

```ts
export const deliveryProfiles = pgTable('delivery_profiles', {
  id: pk(), shopId: shopFk(), name: text('name').notNull(),
  isDefault: boolean('is_default').notNull().default(false),     // the general profile; one per shop
  version: integer('version').notNull().default(1),               // bumped on any change (API field `version`)
  ...timestamps(),
});
export const deliveryProfileVariants = pgTable('delivery_profile_variants', {
  profileId: ref('profile_id').notNull().references(() => deliveryProfiles.id, { onDelete: 'cascade' }),
  variantId: ref('variant_id').notNull().references(() => productVariants.id, { onDelete: 'cascade' }),
  shopId: shopFk(),
}, (t) => [primaryKey({ columns: [t.variantId] })]);               // a variant is in at most one custom profile
export const deliveryLocationGroups = pgTable('delivery_location_groups', {
  id: pk(), shopId: shopFk(),
  profileId: ref('profile_id').notNull().references(() => deliveryProfiles.id, { onDelete: 'cascade' }),
});
export const deliveryLocationGroupLocations = pgTable('delivery_location_group_locations', {
  groupId: ref('group_id').notNull().references(() => deliveryLocationGroups.id, { onDelete: 'cascade' }),
  locationId: ref('location_id').notNull().references(() => locations.id, { onDelete: 'cascade' }),
}, (t) => [primaryKey({ columns: [t.groupId, t.locationId] })]);
export const deliveryZones = pgTable('delivery_zones', {
  id: pk(), shopId: shopFk(),
  groupId: ref('group_id').notNull().references(() => deliveryLocationGroups.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  marketId: ref('market_id'),                        // set when created from a market's shipping editor
});
export const deliveryZoneCountries = pgTable('delivery_zone_countries', {  // like today's shipping_zone_countries
  id: pk(), shopId: shopFk(),
  zoneId: ref('zone_id').notNull().references(() => deliveryZones.id, { onDelete: 'cascade' }),
  countryCode: text('country_code'), restOfWorld: boolean('rest_of_world').notNull().default(false),
  provinceCodes: text('province_codes').array().notNull().default([]),   // empty = whole country
});
export const deliveryMethodDefinitions = pgTable('delivery_method_definitions', {
  id: pk(), shopId: shopFk(),
  zoneId: ref('zone_id').notNull().references(() => deliveryZones.id, { onDelete: 'cascade' }),
  name: text('name').notNull(), description: text('description'),
  active: boolean('active').notNull().default(true),
  position: integer('position').notNull().default(0),
  kind: text('kind').notNull().default('MERCHANT'),               // MERCHANT | PARTICIPANT
  price: money('price'), currency: text('currency'),              // MERCHANT; currency null = shop currency
  carrierServiceId: ref('carrier_service_id'),                    // PARTICIPANT
  fixedFee: money('fixed_fee'), percentageOfRateFee: numeric('percentage_of_rate_fee', { precision: 7, scale: 3, mode: 'number' }),
  adaptToNewServices: boolean('adapt_to_new_services').notNull().default(false),
  // ShopMe extensions needed by the option editor:
  transitMinDays: integer('transit_min_days'), transitMaxDays: integer('transit_max_days'),  // business days
  collectionIds: bigint('collection_ids', { mode: 'number' }).array().notNull().default([]),   // empty = all products
  freeOverAmount: money('free_over_amount'),                       // free shipping threshold, cart currency
  optionKey: text('option_key'),                                   // groups rates shown as one option in the editor
});
export const deliveryConditions = pgTable('delivery_conditions', {
  id: pk(), shopId: shopFk(),
  methodId: ref('method_id').notNull().references(() => deliveryMethodDefinitions.id, { onDelete: 'cascade' }),
  field: text('field').notNull(),                      // TOTAL_WEIGHT | TOTAL_PRICE
  operator: text('operator').notNull(),                // GREATER_THAN_OR_EQUAL_TO | LESS_THAN_OR_EQUAL_TO
  value: bigint('value', { mode: 'number' }).notNull(),// grams or minor units
});
export const carrierServices = pgTable('carrier_services', {
  id: pk(), shopId: shopFk(), name: text('name').notNull(), callbackUrl: text('callback_url'), providerKey: text('provider_key'),
  supportsServiceDiscovery: boolean('supports_service_discovery').notNull().default(false),
  active: boolean('active').notNull().default(true), createdAt: createdAt(),
});
export const locationPickupSettings = pgTable('location_pickup_settings', {
  locationId: ref('location_id').primaryKey().references(() => locations.id, { onDelete: 'cascade' }), shopId: shopFk(),
  enabled: boolean('enabled').notNull().default(false),
  pickupTime: text('pickup_time').notNull().default('TWO_TO_FOUR_DAYS'),   // DeliveryLocalPickupTime values
  customPickupTime: text('custom_pickup_time'),                              // when pickupTime = CUSTOM
  instructions: text('instructions').notNull().default(''),
  allowWhenOutOfStock: boolean('allow_when_out_of_stock').notNull().default(false),   // later (needs transfers)
});
export const locationLocalDelivery = pgTable('location_local_delivery', {
  locationId: ref('location_id').primaryKey().references(() => locations.id, { onDelete: 'cascade' }), shopId: shopFk(),
  enabled: boolean('enabled').notNull().default(false),
  areaType: text('area_type').notNull().default('RADIUS'),             // RADIUS | POSTAL_CODES
  radius: numeric('radius', { precision: 8, scale: 2, mode: 'number' }), radiusUnit: text('radius_unit').default('KM'),   // KM | MI
  postalCodes: text('postal_codes').array().notNull().default([]),    // prefix patterns allowed
  price: money('price').notNull().default(0), minimumOrder: money('minimum_order'),
  freeOverAmount: money('free_over_amount'),
  info: text('info'), phone: text('phone'),
});
export const shippingPackages = pgTable('shipping_packages', {
  id: pk(), shopId: shopFk(), name: text('name').notNull(),
  type: text('type').notNull().default('BOX'),        // BOX | FLAT_RATE | ENVELOPE | SOFT_PACK
  length: numeric('length', { precision: 10, scale: 3, mode: 'number' }), width: numeric('width', { precision: 10, scale: 3, mode: 'number' }),
  height: numeric('height', { precision: 10, scale: 3, mode: 'number' }), dimensionUnit: text('dimension_unit').notNull().default('INCHES'),
  weight: numeric('weight', { precision: 10, scale: 3, mode: 'number' }), weightUnit: text('weight_unit').notNull().default('KILOGRAMS'),
  isDefault: boolean('is_default').notNull().default(false),
});
export const shippingLabels = pgTable('shipping_labels', {
  id: pk(), shopId: shopFk(), fulfillmentId: ref('fulfillment_id'), fulfillmentOrderId: ref('fulfillment_order_id'),
  provider: text('provider').notNull(), providerRef: text('provider_ref'), status: text('status').notNull().default('PENDING_PURCHASE'),
  carrier: text('carrier'), service: text('service'), trackingNumber: text('tracking_number'), trackingUrl: text('tracking_url'),
  cost: money('cost'), currency: text('currency'), documentUrl: text('document_url'), printed: boolean('printed').notNull().default(false),
  purchasedAt: ts('purchased_at'), cancelledAt: ts('cancelled_at'), error: text('error'),
});
```

Extra columns: `variants`: no change (weight lives on inventory items). `order_shipping_lines.delivery_method_type`,
`orders.pickup_location_id`. Stores `locations.priority` already orders allocation.

### 4.1 Migration of existing data
Create the general profile with one location group holding every location with `fulfillsOnlineOrders`; copy each `shipping_zones`
row into a `delivery_zones` row, countries and provinces into `delivery_zone_countries`, and each `shipping_rates` row into a
method definition (FLAT: price; FREE: price 0; WEIGHT_BASED: a TOTAL_WEIGHT condition pair from `minValue` and `maxValue`;
PRICE_BASED: TOTAL_PRICE conditions). Keep the old tables until one release later for rollback. `orders.shippingRateId` keeps
pointing at the method definition id (same id space is not guaranteed; store `shipping_code` text on the shipping line at order time).

### 4.2 Option editor projection
The option editor groups method definitions by `(market zone, optionKey)`; a rate card = one method definition. A rate with a
specific "Ships from" set lives in the location group that has exactly those locations (created on demand). Zones created by the
editor have `marketId` set and countries copied from the market's regions (kept in sync when regions change).

## 5. Admin GraphQL surface

### 5.1 Types (MVP)
`DeliveryProfile` (id, name, default, version, coversAllItems, profileItems, profileLocationGroups, productVariantsCount,
productVariantsCountV2, activeMethodDefinitionsCount, locationsWithoutRatesCount, originLocationCount, zoneCountryCount,
unassignedLocations, unassignedLocationsPaginated, createdAt), `DeliveryProfileItem` (id, product, variants),
`DeliveryProfileLocationGroup` (locationGroup, locationGroupZones, countriesInAnyZone), `DeliveryLocationGroup` (id, locations,
locationsCount), `DeliveryLocationGroupZone` (zone, methodDefinitions, methodDefinitionCounts), `DeliveryZone` (id, name,
countries), `DeliveryCountry` (id, name, translatedName, code { countryCode restOfWorld }, provinces), `DeliveryProvince`,
`DeliveryCountryAndZone`, `DeliveryMethodDefinition` (id, name, description, active, methodConditions, rateProvider),
`DeliveryRateProvider` union (`DeliveryRateDefinition { id price }` | `DeliveryParticipant { id carrierService fixedFee
percentageOfRateFee participantServices adaptToNewServicesFlag }`), `DeliveryCondition` (id, field, operator, conditionCriteria
union `MoneyV2 | Weight`), `DeliveryMethodDefinitionCounts`, `DeliveryProductVariantsCount`, `DeliveryCarrierService`,
`DeliveryCarrierServiceAndLocations`, `DeliveryAvailableService`, `DeliveryLocalPickupSettings` (instructions, pickupTime),
`DeliveryMethod`/`DeliveryMethodType` (SHIPPING, PICK_UP, NONE, RETAIL, LOCAL, PICKUP_POINT), `ShippingLabel`, `ShippingLabelPurchaseResult`.
Existing types to extend: `Location.localPickupSettingsV2`, `Location.fulfillsOnlineOrders`, `Market.delivery`
(`MarketDeliveryConfigurations { shipping: ShippingConfiguration { isEnabled optionDefinitions optionDefinitionsCount } }`).
Enums: `DeliveryConditionField` (TOTAL_WEIGHT, TOTAL_PRICE), `DeliveryConditionOperator` (GREATER_THAN_OR_EQUAL_TO,
LESS_THAN_OR_EQUAL_TO), `DeliveryMethodDefinitionType` (MERCHANT, PARTICIPANT), `DeliveryLocalPickupTime` (ONE_HOUR, TWO_HOURS,
FOUR_HOURS, TWENTY_FOUR_HOURS, TWO_TO_FOUR_DAYS, FIVE_OR_MORE_DAYS, CUSTOM), `ShippingPackageType`.

### 5.2 Roots
MVP: `deliveryProfile(id)`, `deliveryProfiles(merchantOwnedOnly, ...)`, `locationsAvailableForDeliveryProfilesConnection`,
`carrierService(id)`, `carrierServices(query, sortKey)`, `availableCarrierServices`. Later: `deliveryPromise*`,
`deliveryCustomization(s)` (Functions; absent).

### 5.3 Mutations
MVP: `deliveryProfileCreate(profile)`, `deliveryProfileUpdate(id, profile)`, `deliveryProfileRemove(id)` (returns `job`),
`locationLocalPickupEnable(localPickupSettings)`, `locationLocalPickupDisable(locationId)`, `deliverySettingUpdate` and
`deliveryShippingOriginAssign(locationId)` (accepted, no-op effects except origin priority).
`carrierServiceCreate/Update/Delete`, `shippingPackageUpdate`, `shippingPackageDelete`, `shippingPackageMakeDefault` (these three
exist in the schema; creation is not in the API: ShopMe adds `shopmeShippingPackageCreate`).
Later: `shippingLabelPurchase(shippingLabelPurchase)`, `fulfillmentOrderLineItemsPreparedForPickup`, `fulfillmentService*`,
`deliveryPromise*`.
Local delivery has no Admin API in the reference schema (only `DeliveryMethodType.LOCAL` on orders); ShopMe adds
`shopmeLocationLocalDeliveryUpdate(locationId, input)` and a matching query field `Location.shopmeLocalDelivery`.

Inputs: `DeliveryProfileInput { name, profileLocationGroups, locationGroupsToCreate, locationGroupsToUpdate, locationGroupsToDelete,
variantsToAssociate, variantsToDissociate, zonesToDelete, methodDefinitionsToDelete, conditionsToDelete, sellingPlanGroupsToAssociate
(ignored), sellingPlanGroupsToDissociate (ignored), coversAllItems }`; `DeliveryProfileLocationGroupInput { id, locations,
locationsToAdd, locationsToRemove, zonesToCreate, zonesToUpdate }`; `DeliveryLocationGroupZoneInput { id, name, countries,
methodDefinitionsToCreate, methodDefinitionsToUpdate }`; `DeliveryCountryInput { code, restOfWorld, provinces: [{code}],
includeAllProvinces }`; `DeliveryMethodDefinitionInput { id, name, description, active, rateDefinition { id price },
participant, weightConditionsToCreate [{criteria: WeightInput, operator}], priceConditionsToCreate [{criteria: MoneyInput,
operator}], conditionsToUpdate [{id, criteria, criteriaUnit, field, operator}] }`; `DeliveryLocationLocalPickupEnableInput
{ locationId, pickupTime, instructions }`; `DeliveryCarrierServiceCreateInput { name, callbackUrl, supportsServiceDiscovery, active }`;
`CustomShippingPackageInput { name, type, weight, dimensions: ObjectDimensionsInput {length width height unit}, default }`.
ShopMe extension fields on `DeliveryMethodDefinitionInput` for the option editor: `shopmeTransitMinDays`, `shopmeTransitMaxDays`,
`shopmeCollectionIds`, `shopmeFreeOverAmount`, `shopmeOptionKey`.

### 5.4 userErrors
`DeliveryProfileCreatePayload.userErrors` and the other profile payloads use the generic `UserError { field message }` (no code
in the reference schema); we emit messages and `field` paths for: blank name, profile name taken (compare case-insensitively),
variant already in another profile (it is moved, no error), unknown location, location not active, country in two zones of the
same group, unknown country or province code, negative price, condition range with min greater than max, removing the default
profile, a method definition without a price or carrier. Pickup payloads use `DeliveryLocationLocalPickupSettingsError { code
field message }` with `ACTIVE_LOCATION_NOT_FOUND`, `CUSTOM_PICKUP_TIME_NOT_ALLOWED` (CUSTOM can be read but not written by
clients), `GENERIC_ERROR`. Carrier service payloads use `CarrierServiceCreateUserError`, `CarrierServiceUpdateUserError`, `CarrierServiceDeleteUserError`,
each with a single code (`CARRIER_SERVICE_CREATE_FAILED`, `CARRIER_SERVICE_UPDATE_FAILED`, `CARRIER_SERVICE_DELETE_FAILED`) plus
field and message. Label purchase: `ShippingLabelPurchaseUserErrorCode` (NOT_FOUND, TOTAL_WEIGHT_ZERO,
SHIPPING_DATE_IN_THE_PAST, MISSING_SHIPPING_RATE, INVALID_PACKAGE_DIMENSIONS, RATES_NOT_FOUND, CARRIER_NOT_SUPPORTED,
PURCHASE_FAILED, FULFILLMENT_ORDER_INVALID, ...).

MVP vs later:
- MVP: profiles (general plus custom), location groups, zones with countries/provinces, merchant rates with weight and price
  conditions, free-shipping threshold, migration of old zones, checkout selection algorithm, pickup per location, packages CRUD, market
  shipping option editor, `DeliveryProfile` read API and write mutations.
- Later: local delivery, carrier-calculated rates with a provider, label purchase with a provider, delivery date estimates, order routing
  rules, documents editor, fulfillment services, delivery customizations, pickup when not stocked.

## 6. Provider interfaces (plugins)

```ts
interface CarrierRateProvider {          // carrier-calculated rates; one registered per carrier_service
  key: string;                           // 'static', 'webhook', or a plugin id
  getRates(req: {
    origin: Address; destination: Address; currency: string; locale: string;
    items: { name: string; sku?: string; quantity: number; grams: number; priceMinor: number; requiresShipping: true; properties?: Record<string, string> }[];
    packages?: PackageDims[];
  }, ctx: { timeoutMs: number; shopId: number }): Promise<{ rates: { serviceName: string; serviceCode: string; priceMinor: number; currency: string; description?: string; minDeliveryDate?: string; maxDeliveryDate?: string }[] }>;
}
interface LabelProvider {
  key: string;
  quote(fulfillmentOrder: FulfillmentOrderSnapshot, pkg: PackageDims, shipDate: Date): Promise<LabelQuote[]>;
  purchase(quote: LabelQuote, opts: { notifyCustomer: boolean }): Promise<{ trackingNumber: string; trackingUrl?: string; carrier: string; service: string; costMinor: number; currency: string; documents: { kind: 'LABEL' | 'INVOICE' | 'FORM'; url: string; format: 'PDF' | 'PNG' | 'ZPL' }[] }>;
  cancel(providerRef: string): Promise<void>;
}
```
Built-in providers: `webhook` (HTTP POST of the request object to the carrier service's callback URL, JSON response in the
same shape as an array of `{ service_name, service_code, total_price, currency, description, min_delivery_date, max_delivery_date }`
to match what existing apps return) and `static` (testing). A `carrierServices` row with `callbackUrl` uses `webhook`. Label providers are
installed as server plugins; none ships in the MVP. Both interfaces must enforce SSRF protection (`net-guard`) and timeouts.

## 7. Liquid and storefront impact

- `shop.shipping_policy` unchanged. New cart-level data: AJAX `POST /cart/shipping_rates.json?shipping_address[...]` returns
  `{ shipping_rates: [{ name, presentment_name, code, price, currency, source, delivery_date? }] }`; currently absent. Implement
  using the same checkout algorithm for a cart.
- `request.locale`/`localization` unaffected. A "pickup availability" data path for product pages: `variant.store_availabilities`
  (list of `{ available, pick_up_enabled, pick_up_time, location { id, name, address } }`) so themes can show "Available for pickup at
  X, usually ready in 2 to 4 days". Needs `pickupTime` text in the shop language (labels per enum value, translatable).
- Product `requires_shipping` (variant property, derived from the inventory item) and `product.selected_or_first_available_variant`
  unchanged. Order status and email templates show shipping method name and, for pickup, the location address and instructions.
- Order object: `shipping_methods` (title, price, original_price, handle), `shipping_method`, `pickup` data via `shipping_address`
  being the location address plus `delivery_method`; keep `order.shipping_address` equal to the location address for pickup orders.

## 8. Edge cases

- A variant added to a custom profile leaves the general profile (never in two).
- Deleting a profile moves its variants back to the general profile; deleting the general profile is refused.
- A location group with no zone: those locations ship nowhere; `locationsWithoutRatesCount` counts them.
- Province-level zone and a country zone covering the same country: the province zone wins for those provinces.
- Rate currency override differing from cart currency: convert with the currency rate; a rate in another market currency is not rounded.
- Weight condition: sum of `grams x quantity`, gift cards and non-shipped lines excluded; missing weight counts as 0.
- Price condition uses the discounted merchandise subtotal, taxes excluded.
- Multiple rates in an option match: the highest price wins (observed caption); rates with overlapping conditions are allowed.
- Pickup at a location that is deactivated: the setting is kept but the option disappears; reactivation restores it.
- Pickup and local delivery orders require a deliverable address check only for local delivery; pickup orders still need a billing address.
- Carrier timeouts: log the failure on the cart event stream; show the remaining options; if none remain show a "no shipping method" message.
- Free shipping discount codes zero the chosen rate and keep its title.
- Orders keep the rate title, price and code as plain values; later edits of profiles never rewrite old orders.

## 9. Test plan

- Unit: zone resolution (province vs country vs rest of world), condition matching in grams and minor units, option combination across
  profiles, highest-rate-wins, free-over threshold with currency conversion.
- Migration: legacy zones, rates of each type convert and give the same quote for a matrix of carts.
- API conformance: profile create/update/remove with nested location groups, zones, method definitions and conditions; read-back shape
  including counts; pickup enable/disable and errors; carrier service lifecycle; package update, make default, delete default.
- Provider: `webhook` provider against a stub server (success, timeout, invalid JSON, SSRF block), label purchase flow with a fake provider.
- Checkout end to end: pickup order routes to the chosen location; local delivery out of area rejected (once built).
- Admin: market option editor creates zone and method definitions with the right `marketId`, collections and locations; popover reflects them.

## 10. Open questions (captures still needed)

Covered already: option editor, market shipping popover, shipping settings page, packages list, pickup and local delivery location lists.
Remaining:
1. Per-location **pickup settings** dialog (opened from a row on the Local pickup page): fields, time choices, buttons.
2. Per-location **local delivery settings** page: area definition (radius or postal codes), price, minimum order, info text, any "free over"
   field. This decides section 4 `location_local_delivery`.
3. **Transit time dropdown** options in the Add shipping option modal, and the overflow menu of an option card (edit, duplicate, delete?).
4. The **Type dropdown** (second value: calculated by carrier?) and how a carrier rate option looks.
5. The legacy profile editor reachable by the "revert" button (Settings > Shipping and delivery with profiles): needed to confirm
   weight/price condition UI and the product assignment screen.
6. Expanded panels of Estimated delivery dates, Shipping labels ("Calculate rates"), Order routing (the 2 rules), and the Create document menu.
7. API probe: what `deliveryProfiles` returns for a collection-scoped rate created from the market editor (separate profile? extra fields?).
   This fixes how we expose `shopmeCollectionIds` for compatibility.
