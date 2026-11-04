# Checkout and payments

## Flow

`/cart` "Check out" -> `GET|POST /checkout` (cart cookie) -> `303 /checkouts/:token` (the token is the cart token; the cart row
holds email, address, chosen shipping rate and discount codes) -> live refresh `POST /checkouts/:token/refresh` (JSON, returns
re-priced HTML fragments) -> `POST /checkouts/:token/complete` -> `/checkouts/:token/thank-you`.
Abandoned checkouts stay as open `carts` rows (`listAbandonedCheckouts`).

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
