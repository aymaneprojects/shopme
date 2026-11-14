import type { FastifyInstance } from 'fastify';
import type { GatewayAdapter, GatewayResolver } from '@shopme/core';
import type { StripeGateway } from '@shopme/payments';

/** Stripe as a gateway adapter: capture, refund and void act on the PaymentIntent stored in the transaction's `paymentId`. */
export function stripeAdapter(gw: StripeGateway): GatewayAdapter {
  return {
    capture: async (parent, amount, key) => { await gw.capture(parent.paymentId!, amount, key); },
    refund: (parent, charge, key) => gw.refund(parent.paymentId!, charge.amount, key),
    void: (parent, key) => gw.cancel(parent.paymentId!, key),
  };
}

/**
 * The payment provider adapters of one store, resolved by gateway name: `stripe` with the store's own keys (else the installation's).
 * Other gateways have no adapter, so what happens on them is only recorded. PayPal and Mollie plug in here.
 */
export async function gatewaysFor(app: FastifyInstance, shopId: number): Promise<GatewayResolver> {
  const stripe = await app.checkoutPayments?.forShop(shopId);
  const adapters: Record<string, GatewayAdapter | undefined> = { stripe: stripe ? stripeAdapter(stripe) : undefined };
  return (gateway) => adapters[gateway] ?? null;
}
