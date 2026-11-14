# @shopme/payments

Payment provider adapters used by the checkout and the admin. Provider calls live here so that tests can inject a fake client; card data never reaches the server.

- `stripe.ts`: the only real provider. `createStripeGateway(config, client?)` creates PaymentIntents (Payment Element), verifies webhook signatures, captures, refunds,
  cancels (voids) PaymentIntents and lists refunds, off-session renewals for subscriptions included. `createStripeAdmin(secretKey, client?)` is used when a store saves
  its keys: validates the secret key, creates the webhook endpoint (`STRIPE_WEBHOOK_EVENTS`) and registers wallet domains. Both take the Stripe client as an optional
  argument (`StripeClientLike`), which is how tests avoid the network.
- `manual.ts`: manual methods (bank transfer, cash on delivery) and the settings parser, `redirect.ts`: redirect gateways (payment page URL template and signed
  confirmation callback), `types.ts`: shared types.

PayPal and Mollie are not implemented. Refund, void and capture are plugged into `packages/core` through a small per-gateway adapter interface
(`GatewayAdapter` in `packages/core/src/services/orders/gateways.ts`), see `docs/dev/payments.md`.
