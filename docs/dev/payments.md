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
| `payments.paypal` `{ enabled }` | disabled; offered only when enabled and the store saved PayPal credentials |
| `payments.mollie` `{ enabled }` | disabled; offered only when enabled and the store saved a Mollie API key |

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

PayPal and Mollie are two more adapters returned by `gatewaysFor` (see below); another provider is one more adapter for its gateway name.

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

Carrier-calculated shipping rates ask a provider registered in `packages/core/src/services/shipping/carriers.ts`. `demo_flat` computes
`base + perKg * started kilograms`; `http` POSTs `{service, grams, subtotal, destination}` to a carrier account of `SHIPPING.carrierAccounts`
(bearer secret) and reads `{"price": <minor units>}` (`null`: no offer). The rate price is the fallback when the carrier does not answer.
The same endpoint can also sell shipping labels, and a built-in `test` carrier quotes sample prices and makes fake labels: see
[Carrier accounts: rates and shipping labels](carrier-labels.md) for the full request and response JSON.

## PayPal and Mollie

Both are per store only (no environment fallback) and work as "create the order, send the buyer to the provider, confirm by webhook". Adapters:
`packages/payments/src/paypal.ts` and `mollie.ts` (see `packages/payments/README.md`); wiring: `apps/server/src/checkout/index.ts` (options, `complete`),
`apps/server/src/checkout/hosted-providers.ts` (return pages and webhooks), `apps/server/src/payments-gateways.ts` (refund / capture / void).

### Credentials (Settings > Payments, server endpoints)

Encrypted in `shop_secrets` like the Stripe keys (`paypal_*`, `mollie_api_key`). `GET` returns the status only (never a secret), `PUT` validates for real and answers
422 with the provider's reason (nothing is stored), `DELETE` removes the credentials and switches the method off. Same auth and multi-store handling as Stripe.

| Endpoint | Body of `PUT` | Status fields |
| --- | --- | --- |
| `/admin/api/store/payments/paypal` | `{ clientId, clientSecret, environment: "sandbox" \| "live", webhookId? }` | `configured, environment, testMode, clientIdLast4, clientSecretLast4, webhookId, webhookAutoCreated, webhookUrl` |
| `/admin/api/store/payments/mollie` | `{ apiKey }` (`test_...` or `live_...`) | `configured, mode, testMode, apiKeyLast4, webhookUrl` |

- PayPal is validated by obtaining an access token, Mollie by listing the methods of the account.
- PayPal without a `webhookId`: ShopMe creates the webhook (`POST /v1/notifications/webhooks`) for `<APP_URL>/webhooks/paypal` (`/webhooks/paypal/<handle>` in multi-store mode)
  with the events below, stores its id (`paypal_webhook_managed`) and deletes it when the credentials are replaced by another app or removed (saving the same app again reuses it).
  On a non-https or local/private `APP_URL` nothing is created and the request fails with 422 (`WEBHOOK_ID_REQUIRED`): create the webhook in the PayPal dashboard and send its id.
- Mollie webhooks have no setup: the URL is sent with each payment (omitted on a non-public `APP_URL`, where the return page reads the payment instead).

Enable switches: `shopmePaymentSettings { paypal { enabled configured environment } mollie { enabled configured mode } }` and
`shopmePaymentSettingsUpdate(input: { paypal: { enabled }, mollie: { enabled } })`; enabling without saved credentials is a user error.
`PAYMENTS.captureMethod` applies to PayPal (`manual` = intent AUTHORIZE, else CAPTURE). Mollie is always automatic capture: manual capture is a card-only
feature and the Mollie option lets the buyer pick any method on Mollie's page.

### Checkout

The payment step offers "PayPal" and a Mollie option labelled with the enabled method names (`listMethods`, cached 5 minutes per store, "Mollie" when unavailable).
On complete the provider order / payment is created first (idempotency key `paypal|mollie-<checkout token>-<fingerprint of amount, currency, capture mode, email>`, `hostedPaymentKey`),
then the order is created PENDING with the provider id as `paymentId` of the SALE transaction, and the buyer is redirected (303, or `redirectUrl` in the JSON answer).

- `GET /checkouts/:token/paypal/return`: captures (or authorizes) server side, then the thank-you page. Safe when the webhook was first or the page is reloaded.
  A declined capture records a failure and shows a retry page (order stays PENDING).
- `GET /checkouts/:token/paypal/cancel`: a page with a clear message and a "Pay with PayPal" link (`/paypal/retry`, back to the still open PayPal order). The order stays PENDING.
- `GET /checkouts/:token/mollie/return`: reads the payment, applies it, then the thank-you page ("payment is being processed" while open; a canceled/expired payment shows a not completed message).

### Webhooks (idempotent, resolved to the store by `/<handle>` in the path or the request host)

`POST /webhooks/paypal[/:handle]`, verified with the adapter (`verify-webhook-signature` against the store's webhook id; otherwise 400):

| Event | Effect |
| --- | --- |
| `CHECKOUT.ORDER.APPROVED` | capture / authorize if the order is still PENDING |
| `PAYMENT.CAPTURE.COMPLETED` | order PAID (SALE `paymentId` becomes the capture id) |
| `PAYMENT.AUTHORIZATION.CREATED` | order AUTHORIZED (AUTHORIZATION `paymentId` is the authorization id) |
| `PAYMENT.CAPTURE.DENIED` / `DECLINED` | failed transaction + timeline entry, once per capture id |
| `PAYMENT.AUTHORIZATION.VOIDED` | an AUTHORIZED order is VOIDED |
| `PAYMENT.CAPTURE.REFUNDED` | refunds made in PayPal are mirrored (one refund without lines per PayPal refund id) |

`POST /webhooks/mollie[/:handle]` (form body `id=tr_...`, unsigned): the payment is re-fetched with the store's key (`resolveWebhook`) and only that state is used. `paid` marks the order PAID,
`authorized` AUTHORIZED, `failed`/`expired` records one failure, `canceled` voids an authorized order else records a failure. `amountRefunded` above the REFUND transactions ShopMe holds
(`mirrorRefundedTotal`) is mirrored as one refund with the id `<payment id>:<total refunded>`, so a repeated delivery adds nothing. A payment that is not of the store's account answers 200 and does nothing.
A payment whose metadata names another store is ignored.

Not mirrored: a capture of a PayPal authorization made in the PayPal dashboard, and Mollie refunds that fail later.

### Ids stored per transaction

| Provider | Transaction | `paymentId` |
| --- | --- | --- |
| PayPal | SALE pending | PayPal order id; after payment the capture id (used for refunds) |
| PayPal | AUTHORIZATION | authorization id (capture, void); a CAPTURE made from the admin stores the new capture id (refunds) |
| PayPal | REFUND | PayPal refund id |
| Mollie | SALE / AUTHORIZATION / CAPTURE / VOID | payment id `tr_...` |
| Mollie | REFUND | refund id `re_...` (`<payment id>:<total>` for a mirrored dashboard refund) |

`GatewayAdapter.capture` may return `{ id }`, stored as the `paymentId` of the CAPTURE transaction (PayPal needs the capture id to refund).

### Tests

`apps/server/src/hosted-payments.test.ts` injects a fake `fetch` (`app.checkoutPayments.providerFetch`) behind both adapters; `multistore.test.ts` covers isolation between stores.
