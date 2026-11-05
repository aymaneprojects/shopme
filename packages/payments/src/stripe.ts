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
  /** `manual`: the card is authorised at checkout and captured later from the order. */
  captureMethod?: 'automatic' | 'manual';
  /** Subscriptions: keep the payment method on `customer` for later charges without the buyer (renewals). */
  setupFutureUsage?: 'off_session';
  customer?: string;
}

export interface OffSessionInput {
  /** Minor units. */
  amount: number;
  currency: string;
  /** Stripe customer and saved payment method (ids only: the card itself stays with Stripe). */
  customer: string;
  paymentMethod: string;
  idempotencyKey: string;
  description?: string;
  reference: string;
  email?: string | null;
}
export type OffSessionResult = { ok: true; id: string } | { ok: false; code: string; message: string; id: string | null };

export interface StripeEventLike { id: string; type: string; data: { object: Record<string, any> } }

/** What the checkout needs from Stripe. Card data never reaches this server: the browser talks to Stripe.js. */
export interface StripeGateway {
  publishableKey: string;
  createPaymentIntent(input: CreateIntentInput): Promise<{ id: string; clientSecret: string }>;
  /** Verify the `Stripe-Signature` header over the raw body; throws when invalid. */
  verifyWebhook(rawBody: string | Buffer, signature: string): StripeEventLike;
  /** Capture (part of) an authorised PaymentIntent; `amount` in minor units. */
  capture(paymentIntentId: string, amount: number, idempotencyKey: string): Promise<void>;
  /** A Stripe customer to save the subscription's payment method on. Returns its id. */
  createCustomer(input: { email?: string | null; name?: string | null; reference: string; idempotencyKey: string }): Promise<string>;
  /** Charge a saved payment method without the customer present (subscription renewals). Declines come back as data, not exceptions. */
  chargeOffSession(input: OffSessionInput): Promise<OffSessionResult>;
  /** Refund (part of) a PaymentIntent; `amount` in minor units. */
  refund(paymentIntentId: string, amount: number, idempotencyKey: string): Promise<void>;
}

/** The slice of the Stripe SDK used here (lets tests inject a fake). */
export interface StripeClientLike {
  paymentIntents: {
    create(params: Record<string, unknown>, options?: Record<string, unknown>): Promise<{ id: string; client_secret: string | null }>;
    capture?(id: string, params?: Record<string, unknown>, options?: Record<string, unknown>): Promise<unknown>;
  };
  customers?: { create(params: Record<string, unknown>, options?: Record<string, unknown>): Promise<{ id: string }> };
  refunds?: { create(params: Record<string, unknown>, options?: Record<string, unknown>): Promise<unknown> };
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
        ...(i.captureMethod === 'manual' ? { capture_method: 'manual' } : {}),
        ...(i.setupFutureUsage ? { setup_future_usage: i.setupFutureUsage } : {}), ...(i.customer ? { customer: i.customer } : {}),
        metadata: { checkout_token: i.reference },
      }, { idempotencyKey: i.idempotencyKey });
      if (!pi.client_secret) throw new Error('Stripe returned no client secret');
      return { id: pi.id, clientSecret: pi.client_secret };
    },
    verifyWebhook: (raw, sig) => stripe.webhooks.constructEvent(raw, sig, webhookSecret),
    async capture(id, amount, idempotencyKey) {
      if (!stripe.paymentIntents.capture) throw new Error('Stripe client cannot capture');
      await stripe.paymentIntents.capture(id, { amount_to_capture: amount }, { idempotencyKey });
    },
    async createCustomer(i) {
      if (!stripe.customers) throw new Error('Stripe client cannot create customers');
      const c = await stripe.customers.create({ email: i.email ?? undefined, name: i.name ?? undefined, metadata: { shopme_reference: i.reference } }, { idempotencyKey: i.idempotencyKey });
      return c.id;
    },
    async chargeOffSession(i) {
      try {
        const pi = await stripe.paymentIntents.create({
          amount: i.amount, currency: i.currency.toLowerCase(), customer: i.customer, payment_method: i.paymentMethod, off_session: true, confirm: true,
          description: i.description, receipt_email: i.email ?? undefined, metadata: { subscription_reference: i.reference },
        }, { idempotencyKey: i.idempotencyKey }) as { id: string; status?: string };
        if (!pi.status || pi.status === 'succeeded' || pi.status === 'processing') return { ok: true, id: pi.id };
        return { ok: false, code: pi.status === 'requires_action' ? 'authentication_required' : pi.status, message: `Payment ${pi.status.replace(/_/g, ' ')}`, id: pi.id };
      } catch (e) {
        const err = e as { code?: string; decline_code?: string; type?: string; message?: string; raw?: { payment_intent?: { id?: string } }; payment_intent?: { id?: string } };
        return { ok: false, code: err.decline_code ?? err.code ?? err.type ?? 'payment_failed', message: err.message ?? 'The payment failed', id: err.raw?.payment_intent?.id ?? err.payment_intent?.id ?? null };
      }
    },
    async refund(id, amount, idempotencyKey) {
      if (!stripe.refunds) throw new Error('Stripe client cannot refund');
      await stripe.refunds.create({ payment_intent: id, amount }, { idempotencyKey });
    },
  };
}
