import Stripe from 'stripe';

export interface StripeConfig { secretKey?: string; publishableKey?: string; webhookSecret?: string }

export interface CreateIntentInput {
  /** Minor units. */
  amount: number;
  currency: string;
  /** Checkout token, stored as PaymentIntent metadata for traceability. */
  reference: string;
  description?: string;
  email?: string | null;
  idempotencyKey: string;
}

export interface StripeEventLike { id: string; type: string; data: { object: Record<string, any> } }

/** What the checkout needs from Stripe. Card data never reaches this server: the browser talks to Stripe.js. */
export interface StripeGateway {
  publishableKey: string;
  createPaymentIntent(input: CreateIntentInput): Promise<{ id: string; clientSecret: string }>;
  /** Verify the `Stripe-Signature` header over the raw body; throws when invalid. */
  verifyWebhook(rawBody: string | Buffer, signature: string): StripeEventLike;
}

/** The slice of the Stripe SDK used here (lets tests inject a fake). */
export interface StripeClientLike {
  paymentIntents: { create(params: Record<string, unknown>, options?: Record<string, unknown>): Promise<{ id: string; client_secret: string | null }> };
  webhooks: { constructEvent(payload: string | Buffer, header: string, secret: string): StripeEventLike };
}

/** A gateway when all three STRIPE_* values are configured, otherwise null (Stripe stays off). */
export function createStripeGateway(cfg: StripeConfig, client?: StripeClientLike): StripeGateway | null {
  if (!cfg.secretKey || !cfg.publishableKey || !cfg.webhookSecret) return null;
  const stripe: StripeClientLike = client ?? (new Stripe(cfg.secretKey) as unknown as StripeClientLike);
  const { publishableKey, webhookSecret } = cfg;
  return {
    publishableKey,
    async createPaymentIntent(i) {
      const pi = await stripe.paymentIntents.create({
        amount: i.amount, currency: i.currency.toLowerCase(), automatic_payment_methods: { enabled: true },
        description: i.description, receipt_email: i.email ?? undefined,
        metadata: { checkout_token: i.reference },
      }, { idempotencyKey: i.idempotencyKey });
      if (!pi.client_secret) throw new Error('Stripe returned no client secret');
      return { id: pi.id, clientSecret: pi.client_secret };
    },
    verifyWebhook: (raw, sig) => stripe.webhooks.constructEvent(raw, sig, webhookSecret),
  };
}
