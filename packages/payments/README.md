# @shopme/payments

Payment provider adapters and helpers. Pure modules: no database, no server code.

## What exists

| Module | Status |
| --- | --- |
| `manual.ts` | Bank transfer and cash on delivery settings and providers. In use. |
| `stripe.ts` | Stripe gateway (PaymentIntents, manual capture, off-session charges, refunds, webhook verification). In use. |
| `redirect.ts` | Redirect gateways: payment page URL templates and HMAC-signed confirmation webhooks. In use. |
| Test gateway | Sandbox gateway that charges nothing (`test` payment kind in `types.ts`). In use. |
| `paypal.ts` | PayPal Orders v2 adapter. **Adapter only, not yet wired into checkout.** |
| `mollie.ts` | Mollie API v2 adapter. **Adapter only, not yet wired into checkout.** |
| `provider-common.ts` | Shared by PayPal and Mollie: `PaymentProviderError`, `NormalizedPaymentStatus`, amount formatting, timeout-aware HTTP. |

## PayPal and Mollie adapters

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
