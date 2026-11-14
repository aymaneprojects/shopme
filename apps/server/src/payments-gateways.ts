import type { FastifyInstance } from 'fastify';
import type { GatewayAdapter, GatewayResolver, OrderTransaction } from '@shopme/core';
import { PaymentProviderError, type MollieAdapter, type PayPalAdapter, type StripeGateway } from '@shopme/payments';

/** Stripe as a gateway adapter: capture, refund and void act on the PaymentIntent stored in the transaction's `paymentId`. */
export function stripeAdapter(gw: StripeGateway): GatewayAdapter {
  return {
    capture: async (parent, amount, key) => { await gw.capture(parent.paymentId!, amount, key); },
    refund: (parent, charge, key) => gw.refund(parent.paymentId!, charge.amount, key),
    void: (parent, key) => gw.cancel(parent.paymentId!, key),
  };
}

const refused = (provider: string, what: string, status: string) => new PaymentProviderError(provider === 'paypal' ? 'paypal' : 'mollie', `${provider} ${what} is ${status}`, status);

/**
 * PayPal: the SALE (intent CAPTURE) or CAPTURE transaction holds the PayPal capture id in `paymentId` (refunds), the AUTHORIZATION holds the
 * authorization id (capture, void). A capture made here stores the new capture id on the CAPTURE transaction.
 */
export function paypalAdapter(pp: PayPalAdapter): GatewayAdapter {
  /** Amount of a shop-money capture in the currency the buyer authorized (presentment), omitted when it is the whole authorization. */
  const authorized = (parent: OrderTransaction, amount: number) => {
    if (amount >= parent.amount) return {};
    return parent.presentmentAmount && parent.presentmentCurrency
      ? { amount: Math.round((amount * parent.presentmentAmount) / parent.amount), currency: parent.presentmentCurrency }
      : { amount, currency: parent.currency };
  };
  return {
    capture: async (parent, amount, key) => {
      const r = await pp.captureAuthorization(parent.paymentId!, { ...authorized(parent, amount), idempotencyKey: key });
      if (r.status === 'failed') throw refused('paypal', 'capture', r.providerStatus.toLowerCase());
      return { id: r.id };
    },
    refund: async (parent, charge, key) => {
      const r = await pp.refundCapture(parent.paymentId!, { amount: charge.amount, currency: charge.currency, idempotencyKey: key });
      if (r.status === 'failed') throw refused('paypal', 'refund', r.providerStatus.toLowerCase());
      return { id: r.id };
    },
    void: (parent, key) => pp.voidAuthorization(parent.paymentId!, key),
  };
}

/** Mollie: every transaction of the order keeps the payment id (`tr_...`) in `paymentId`; refunds store their own id (`re_...`). */
export function mollieAdapter(mo: MollieAdapter): GatewayAdapter {
  return {
    capture: async (parent, amount, key) => {
      const part = amount >= parent.amount ? {} : parent.presentmentAmount && parent.presentmentCurrency
        ? { amount: Math.round((amount * parent.presentmentAmount) / parent.amount), currency: parent.presentmentCurrency }
        : { amount, currency: parent.currency };
      const r = await mo.createCapture(parent.paymentId!, { ...part, idempotencyKey: key });
      if (r.status === 'failed') throw refused('mollie', 'capture', 'failed');
      // The CAPTURE transaction keeps the payment id: Mollie refunds are made on the payment.
    },
    refund: async (parent, charge, key) => {
      const r = await mo.createRefund(parent.paymentId!, { amount: charge.amount, currency: charge.currency, idempotencyKey: key });
      if (r.status === 'failed') throw refused('mollie', 'refund', 'failed');
      return { id: r.refundId };
    },
    void: async (parent) => { await mo.cancelPayment(parent.paymentId!); },
  };
}

type CheckoutPaymentsLike = { forShop(id: number): Promise<StripeGateway | null>; paypalForShop?(id: number): Promise<PayPalAdapter | null>; mollieForShop?(id: number): Promise<MollieAdapter | null> };

/**
 * The payment provider adapters of one store, resolved by gateway name: `stripe` with the store's own keys (else the installation's),
 * `paypal` and `mollie` with the store's saved credentials. Other gateways have no adapter, so what happens on them is only recorded.
 */
export async function gatewaysFor(app: FastifyInstance, shopId: number): Promise<GatewayResolver> {
  // Decorated by the checkout plugin; typed loosely so code compiled without that plugin's module augmentation (admin typecheck) still builds.
  const payments = (app as unknown as { checkoutPayments?: CheckoutPaymentsLike }).checkoutPayments;
  const [stripe, paypal, mollie] = await Promise.all([payments?.forShop(shopId), payments?.paypalForShop?.(shopId), payments?.mollieForShop?.(shopId)]);
  const adapters: Record<string, GatewayAdapter | undefined> = { stripe: stripe ? stripeAdapter(stripe) : undefined, paypal: paypal ? paypalAdapter(paypal) : undefined, mollie: mollie ? mollieAdapter(mollie) : undefined };
  return (gateway) => adapters[gateway] ?? null;
}
