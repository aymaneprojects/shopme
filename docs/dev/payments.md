# Checkout and payments

## Flow

`/cart` "Check out" -> `GET|POST /checkout` (cart cookie) -> `303 /checkouts/:token` (the token is the cart token; the cart row
holds email, address, chosen shipping rate and discount codes) -> live refresh `POST /checkouts/:token/refresh` (JSON, returns
re-priced HTML fragments) -> `POST /checkouts/:token/complete` -> `/checkouts/:token/thank-you`.
Abandoned checkouts stay as open `carts` rows (`findAbandonedCheckouts`, see `docs/dev/commerce.md`); gift cards pay as a `gift_card` gateway transaction before the payment method collects the rest.

Services (`packages/core/src/services`): `pricing` (pure: discounts, shipping rate matching, taxes), `checkout` (load, update,
submit), `orders/create.ts` (`createOrder`, one transaction), `payments-runtime` (methods, mark paid). Payment providers live in
`packages/payments`.

Pricing rules: integer minor units, half-up rounding on exact integer math. Discounts apply in code order to the remaining amount
(percentage `value` = basis points, fixed = minor units; target `SHIPPING` with 10000 bp is free shipping). Taxes: all active
`tax_rates` of the destination country (plus province-specific ones) are added; `applies_to_shipping` is per rate; with
`shops.taxes_included` tax is extracted from prices. Shipping: the zone listing the country (and province) else the `*` zone;
`PRICE_BASED` rates compare the shippable subtotal (cents), `WEIGHT_BASED` the grams; `FLAT`/`FREE` ignore min/max.
Stock is re-checked at submit and committed (available -> committed) inside the order transaction.

## Shop settings keys (`shops.settings`, nested or flat dotted keys are both read)

| Key | Default |
| --- | --- |
| `payments.manual.bankTransfer` `{ enabled, instructions }` | enabled, empty instructions (shown on the thank-you page and in the email) |
| `payments.manual.cod` `{ enabled }` | enabled |
| `payments.stripe` `{ enabled }` | enabled, but only offered when all three env vars below are set |

Env: `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET`.

## Stripe

Payment Element in deferred-intent mode (Stripe.js from js.stripe.com; card data never reaches the server). On submit the browser
validates the element, the server re-validates the checkout, creates the PaymentIntent for the final total, then creates the order
(PENDING, transaction carries the PaymentIntent id) and returns the client secret; the browser confirms and returns to the
thank-you page. `POST /webhooks/stripe` (raw body, signature verified) handles `payment_intent.succeeded` (order PAID, emails sent)
and `payment_intent.payment_failed` (failed transaction + timeline entry). Point the Stripe webhook at `<APP_URL>/webhooks/stripe`.

Manual methods create the order as PENDING; the confirmation and staff emails are queued immediately. Orders totalling 0 are PAID.

## Capture, test gateway, custom methods and redirect gateways

Settings blocks live in `shops.settings.config.<key>` and are read and written through `shopmeConfig(key)` / `shopmeConfigUpdate(key, value)`
(keys: GENERAL, ORDERS, PAYMENTS, SHIPPING, TAXES, NOTIFICATIONS, CHECKOUT, GIFT_CARDS, RETURNS, DOCUMENTS; each block is validated as a whole).

- `PAYMENTS.captureMethod = manual`: the Stripe PaymentIntent is created with `capture_method=manual`; `payment_intent.amount_capturable_updated`
  turns the order AUTHORIZED (an `AUTHORIZATION` transaction) and `orderCapture` collects it at Stripe before recording the capture. The test
  gateway follows the same rule (AUTHORIZED instead of PAID).
- `PAYMENTS.testGateway`: method id `test`, nothing is charged, orders and transactions are flagged `test`.
- `PAYMENTS.customMethods`: ids `manual:<id>` with a name and instructions (order stays PENDING, instructions shown on the thank-you page).
- `PAYMENTS.redirectGateways`: ids `redirect:<id>`. After the order is placed (PENDING) the buyer is redirected to `redirectUrl`, a template with
  `{order} {reference} {amount} {currency} {email} {return_url}`. The provider confirms with `POST /webhooks/payments/<id>` and the JSON body
  `{"reference": "<order name>", "status": "paid" | "failed"}`, signed as hex HMAC-SHA256 of the raw body in `X-ShopMe-Signature` with the gateway secret.
- `PAYMENTS.customizations`: rules that hide, rename or move a method to the top for a country list and an order-total range.
- PayPal and Mollie are not built in: both need provider-specific signed callbacks. A redirect gateway in front of their payment links works when
  the provider (or a small relay) can sign the confirmation.

Carrier-calculated shipping rates ask a provider registered in `packages/core/src/services/shipping/carriers.ts`. `demo_flat` computes
`base + perKg * started kilograms`; `http` POSTs `{service, grams, subtotal, destination}` to a carrier account of `SHIPPING.carrierAccounts`
(bearer secret) and reads `{"price": <minor units>}` (`null`: no offer). The rate price is the fallback when the carrier does not answer.
The same endpoint can also sell shipping labels, and a built-in `test` carrier quotes sample prices and makes fake labels: see
[Carrier accounts: rates and shipping labels](carrier-labels.md) for the full request and response JSON.
