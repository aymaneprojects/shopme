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

Env: `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET` (the installation's Stripe account, used by every store without keys of its own).

Per-store keys (Settings > Payments, `PUT /admin/api/store/payments/stripe`, `DELETE` to go back to the installation keys) are kept per store in
`shop_secrets`, encrypted with `encryptSecret` (key derived from `SESSION_SECRET`); they win over the env keys. Saving them:

- The publishable and secret keys are format-checked, then the secret key is validated with a real call to Stripe (`accounts.retrieve`); a rejected key
  returns 422 with Stripe's reason and nothing is stored.
- The webhook signing secret is optional. When left empty, ShopMe creates the endpoint through the Stripe API (`webhookEndpoints.create`) for the store's
  public webhook URL (`<APP_URL>/webhooks/stripe`, or `/webhooks/stripe/<handle>` in multi-store mode) with exactly the events listed below, stores the
  returned secret encrypted and keeps the endpoint id (`shop_secrets.stripe_webhook_endpoint_id`). The endpoint is deleted when the keys are replaced or
  removed. When `APP_URL` is not https or points at localhost or a private address, Stripe cannot reach it: nothing is created and the request fails with a
  message asking for the secret of a webhook created by hand in the Stripe Dashboard (the manual `whsec_` field stays supported and creates nothing).
- Best effort and never blocking: the store's domains (primary domain, platform host, verified domains) are registered with `paymentMethodDomains.create` so Apple Pay and
  Google Pay can show in the Payment Element.

All Stripe calls go through `packages/payments/src/stripe.ts` (`createStripeGateway` for payments, `createStripeAdmin` for account setup). Tests inject a fake client
(`app.checkoutPayments.stripe = createStripeGateway(cfg, fake)`, `app.checkoutPayments.admin = (key) => createStripeAdmin(key, fake)`); they never reach Stripe.

## Stripe

Payment Element in deferred-intent mode (Stripe.js from js.stripe.com; card data never reaches the server). On submit the browser
validates the element, the server re-validates the checkout, creates the PaymentIntent for the final total, then creates the order
(PENDING, transaction carries the PaymentIntent id) and returns the client secret; the browser confirms and returns to the
thank-you page. The PaymentIntent idempotency key is `pi-<checkout token>-<fingerprint of amount, currency, capture method, email, customer>`: a double
submit reuses the intent, a changed cart gets a new one.

`POST /webhooks/stripe[/:handle]` (raw body, signature verified with the store's secret) handles, idempotently under duplicate deliveries:

| Event | Effect |
| --- | --- |
| `payment_intent.succeeded` | order PAID, emails sent |
| `payment_intent.amount_capturable_updated` | order AUTHORIZED (manual capture) |
| `payment_intent.payment_failed` | failed transaction + timeline entry |
| `payment_intent.canceled` | an AUTHORIZED order gets a VOID transaction and becomes VOIDED (no-op otherwise or once voided) |
| `charge.refunded` | refunds made in the Stripe dashboard are mirrored: one refund without lines and a REFUND transaction per Stripe refund id not recorded yet, status PARTIALLY_REFUNDED / REFUNDED. Refunds ShopMe created are matched by refund id and skipped |
| `charge.dispute.created` | a timeline event on the order (once per dispute), no other effect |

Point the Stripe webhook at `<APP_URL>/webhooks/stripe` (done automatically when keys are saved without a signing secret, see above).

## Refunds, void and capture at the provider

`captureTransaction`, `refundOrder`, `cancelOrder` and `voidTransaction` (`packages/core/src/services/orders`) take a `GatewayResolver` (`gateways.ts`):
`(gatewayName) => { capture?, refund?, void? } | null`, built per store by `gatewaysFor` (`apps/server/src/payments-gateways.ts`). Without an adapter for a
gateway (manual, gift card, store credit, ...) money movements are only recorded. A provider failure is a user error and nothing is recorded.

- **Refund** (`refundCreate`, `orderCancel` with refund, customer cancellation): for a refund against a SALE/CAPTURE of gateway `stripe` with a `paymentId`, the Stripe
  refund is created first (idempotency key `refund-<parent transaction>-<already refunded on it>-<amount>`, amount in the minor units of the currency the buyer was
  charged in) and the REFUND transaction stores the Stripe refund id in `paymentId`.
- **Void** (`transactionVoid(parentTransactionId)`): cancels the PaymentIntent of an uncaptured, successful AUTHORIZATION, records a VOID transaction and sets the order
  VOIDED. User error codes: `TRANSACTION_NOT_FOUND`, `AUTH_NOT_SUCCESSFUL`, `AUTH_NOT_VOIDABLE` (not an authorization, already captured or voided), `GENERIC_ERROR` (provider).
  `orderCancel` on an authorized order releases the authorization the same way and keeps the order when the provider refuses.
- **Capture** (`orderCapture`, bulk capture): collects at Stripe before recording the capture.

A new provider (PayPal, Mollie) is one more adapter returned by `gatewaysFor` for its gateway name.

Manual methods create the order as PENDING; the confirmation and staff emails are queued immediately. Orders totalling 0 are PAID.

## Capture, test gateway, custom methods and redirect gateways

Settings blocks live in `shops.settings.config.<key>` and are read and written through `shopmeConfig(key)` / `shopmeConfigUpdate(key, value)`
(keys: GENERAL, ORDERS, PAYMENTS, SHIPPING, TAXES, NOTIFICATIONS, CHECKOUT, GIFT_CARDS, RETURNS, DOCUMENTS; each block is validated as a whole).

- `PAYMENTS.captureMethod = manual`: the Stripe PaymentIntent is created with `capture_method=manual`; `payment_intent.amount_capturable_updated`
  turns the order AUTHORIZED (an `AUTHORIZATION` transaction) and `orderCapture` collects it at Stripe before recording the capture. The test
  gateway follows the same rule (AUTHORIZED instead of PAID).
- `PAYMENTS.testGateway`: method id `test`, nothing is charged, orders and transactions are flagged `test`.
- `PAYMENTS.customMethods`: ids `manual:<id>` with a name and instructions (order stays PENDING, instructions shown on the thank-you page).
- `PAYMENTS.redirectGateways`: ids `redirect:<id>`. The signing secret is stored encrypted in the settings JSON (same `encryptSecret` helpers as the Stripe keys; `shopmeConfig` returns it in the clear to the admin, `shopmeConfigUpdate` encrypts it, and legacy plaintext values are still read and encrypted at the next save). After the order is placed (PENDING) the buyer is redirected to `redirectUrl`, a template with
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
