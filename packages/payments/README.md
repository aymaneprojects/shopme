# @shopme/payments

Payment provider adapters used by the checkout and the admin. Provider calls live here so that tests can inject a fake client; card data never reaches the server.

- `stripe.ts`: the provider wired into checkout today. `createStripeGateway(config, client?)` creates PaymentIntents (Payment Element), verifies webhook signatures, captures, refunds,
  cancels (voids) PaymentIntents and lists refunds, off-session renewals for subscriptions included. `createStripeAdmin(secretKey, client?)` is used when a store saves
  its keys: validates the secret key, creates the webhook endpoint (`STRIPE_WEBHOOK_EVENTS`) and registers wallet domains. Both take the Stripe client as an optional
  argument (`StripeClientLike`), which is how tests avoid the network.
- `manual.ts`: manual methods (bank transfer, cash on delivery) and the settings parser, `redirect.ts`: redirect gateways (payment page URL template and signed
  confirmation callback), `types.ts`: shared types.

Refund, void and capture are plugged into `packages/core` through a small per-gateway adapter interface
(`GatewayAdapter` in `packages/core/src/services/orders/gateways.ts`), see `docs/dev/payments.md`.

## PayPal and Mollie adapters (not yet wired into checkout)

`paypal.ts` (Orders v2) and `mollie.ts` (API v2), with `provider-common.ts` for what they share (`PaymentProviderError`, `NormalizedPaymentStatus`,
amount formatting, timeout-aware HTTP).

Both use the global `fetch` (no SDK). Pass `{ fetch }` in the options to inject a fake in tests. Every request times out
(default 15 s) with a `PaymentProviderError` (`code: 'timeout'`). Errors carry the provider's message and code; secrets are never logged or put in messages.
Amounts in and out are integer minor units. Normalised statuses: `pending | authorized | paid | failed | voided | refunded`.

```ts
const paypal = createPayPalAdapter({ clientId, clientSecret, webhookId, environment: 'sandbox' });
const { id, approvalUrl } = await paypal.createOrder({ amount: 1050, currency: 'EUR', intent: 'CAPTURE', orderId, returnUrl, cancelUrl, idempotencyKey });
// redirect the buyer to approvalUrl, then on return: paypal.captureOrder(id)
// PayPal webhooks: paypal.verifyWebhook(headers, rawBody) returns the event or null

const mollie = createMollieAdapter({ apiKey: 'test_...' });
const { paymentId, checkoutUrl } = await mollie.createPayment({ amount: 1050, currency: 'EUR', description, redirectUrl, webhookUrl, orderId, shopId, idempotencyKey });
// Mollie webhooks carry only `id=tr_...` and are unsigned: mollie.resolveWebhook(body) re-fetches the payment and returns its verified state
```

Notes:
- PayPal HUF, JPY and TWD are sent as whole numbers. HUF and TWD have two minor digits in our amounts, so an amount that is not a whole unit throws `amount_not_representable` instead of being rounded.
- Idempotency: PayPal uses `PayPal-Request-Id`, Mollie uses `Idempotency-Key` (POST requests, cached for one hour).
- Tests: `pnpm --filter @shopme/payments test` (mocked fetch, no network).
