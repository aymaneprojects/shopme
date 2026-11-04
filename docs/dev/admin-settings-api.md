# Admin API: settings, analytics and other ShopMe-specific operations

Shopify has no public Admin GraphQL API for most store settings, or exposes them through much heavier models
(`deliveryProfiles`, payment gateways, tax overrides). ShopMe adds small, documented operations for them. Everything
here lives in `apps/server/src/admin/graphql/modules/{settings,analytics,orders}.ts`. Money inputs use the `Money`
scalar (decimal string in the shop currency), outputs use `MoneyV2`. All mutations return `userErrors`.

## Shop details

`shop` (the standard type) gains: `billingAddress: ShopAddress!`, `unitSystem`, `shopmeTaxShipping`, `shopmeLocale`,
`shopmeStorefront { passwordEnabled password passwordMessage }`.

`shopmeShopUpdate(input: ShopmeShopInput!): { shop userErrors }`. Input (all optional): `name email description
currencyCode ianaTimezone weightUnit locale address(MailingAddressInput) moneyFormat moneyWithCurrencyFormat
taxesIncluded taxShipping storefrontPasswordEnabled storefrontPassword storefrontPasswordMessage primaryDomain`.
The currency cannot change once orders exist; changing it resets the money formats unless given. Enabling the
storefront password requires a password. Address, description, `taxShipping` and the storefront password live in
`shops.settings` (JSON) under the keys the storefront already reads.

## Payments

`shopmePaymentSettings` / `shopmePaymentSettingsUpdate(input)` with
`bankTransfer { enabled instructions }`, `cod { enabled }`, `stripe { enabled }` (stored in
`shops.settings.payments.manual.bankTransfer|cod` and `payments.stripe`). Stripe keys stay in the server environment:
the API only exposes `stripe.stripeConfigured: Boolean`, and enabling Stripe without keys is a userError. Bank transfer
needs instructions to be enabled.

## Shipping zones and rates (replaces `deliveryProfiles`)

Queries `shippingZones`, `shippingZone(id)`; mutations `shippingZoneCreate|Update|Delete`,
`shippingRateCreate|Update|Delete`. A zone has `countries { countryCode provinceCodes }` (`"*"` = rest of world) and
`rates`. Rate: `name`, `type` (`FLAT | WEIGHT_BASED | PRICE_BASED | FREE`), `price`, `minWeight/maxWeight` (grams,
weight based), `minSubtotal/maxSubtotal` (money, price based), `active`. `shippingZoneUpdate` with `rates` replaces
all rates. Types are prefixed `Shopme` (`ShopmeShippingZone`, `ShopmeShippingRate`); ids are GIDs of those types.

## Tax rates

`taxRates`; `taxRateCreate|Update|Delete`. Rate is a percent (20 = 20%), per country and optional province, with
`appliesToShipping`, `priority`, `active`. The shop-wide "prices include tax" / "charge tax on shipping" toggles are
`taxesIncluded` / `taxShipping` of `shopmeShopUpdate`.

## Staff

`staffMembers(first)` (the standard connection; no password data). Invitations are not implemented yet.

## Dashboard (analytics)

`shopmeDashboard(range: TODAY | LAST_7_DAYS | LAST_30_DAYS)` returns `totalSales` (net of refunds), `ordersCount`,
`averageOrderValue`, `salesByDay { date sales ordersCount }` (zero-filled, one entry per day) and
`topProducts { title quantity sales product }` (top 5 by sales). Cancelled and test orders are excluded; days are cut
in the shop time zone.

## Orders: ShopMe differences

- `orderTimelineCommentCreate(id, message)` adds a staff comment to the order timeline (stored in `events` with
  `kind = 'comment'`); read it with `Order.events` (`CommentEvent`). Shopify has no public equivalent.
- `fulfillmentCreate(fulfillment: FulfillmentInput!)`: ShopMe has no fulfillment orders. The input also accepts
  `orderId` and `lineItems: [{ id: <LineItem gid>, quantity }]`; omit both lists to fulfil everything left.
  `lineItemsByFulfillmentOrder` is optional and takes the Order GID as `fulfillmentOrderId` and LineItem GIDs.
- `refundCreate` records the refund and REFUND transactions; paying the money back through the provider is the
  payment adapter's job. Without explicit `transactions` it records one for the refund total on the original gateway.
- `orderCancel` runs synchronously and returns a finished `Job`; `refund: true` refunds the remaining paid amount.
- `Customer.numberOfOrders` and `amountSpent` are computed from the orders table (excluding cancelled orders from spend).
- `CustomerInput.addresses` is a ShopMe extension (replaces the customer's addresses) until `customerAddress*` exist.
- `tagsAdd` / `tagsRemove` now accept `Order` and `Customer` ids too.

## Discounts

Code discounts only: `discountCodeBasicCreate|Update`, `discountCodeFreeShippingCreate|Update`,
`discountCodeActivate|Deactivate|Delete`, `codeDiscountNode(s)`, `codeDiscountNodeByCode`, `discountNode(s)`,
`discountNodesCount`. Supported: percentage or fixed amount, all items or selected products/collections (variant
selection, buy-X-get-Y, customer segments and markets are rejected with a userError), minimum subtotal or quantity
(not both), usage limit, once per customer, start/end dates. Codes are stored upper-case. Deactivating reads as
`EXPIRED`. `combinesWith` is accepted and ignored (reported all `false`).
