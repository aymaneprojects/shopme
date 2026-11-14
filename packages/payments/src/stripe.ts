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

export interface StripeRefundLike { id: string; amount: number; currency?: string; status?: string | null }

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
  /** Refund (part of) a PaymentIntent; `amount` in minor units. Returns the Stripe refund id (null when the client does not report one). */
  refund(paymentIntentId: string, amount: number, idempotencyKey: string): Promise<{ id: string | null }>;
  /** Refunds Stripe holds for a PaymentIntent (amounts in minor units of the charge currency). */
  listRefunds(paymentIntentId: string): Promise<StripeRefundLike[]>;
  /** Cancel a PaymentIntent that holds an uncaptured authorisation (releases the held money). */
  cancel(paymentIntentId: string, idempotencyKey: string): Promise<void>;
}

/** The slice of the Stripe SDK used here (lets tests inject a fake). */
export interface StripeClientLike {
  paymentIntents: {
    create(params: Record<string, unknown>, options?: Record<string, unknown>): Promise<{ id: string; client_secret: string | null }>;
    capture?(id: string, params?: Record<string, unknown>, options?: Record<string, unknown>): Promise<unknown>;
    cancel?(id: string, params?: Record<string, unknown>, options?: Record<string, unknown>): Promise<unknown>;
  };
  customers?: { create(params: Record<string, unknown>, options?: Record<string, unknown>): Promise<{ id: string }> };
  refunds?: {
    create(params: Record<string, unknown>, options?: Record<string, unknown>): Promise<unknown>;
    list?(params: Record<string, unknown>): Promise<{ data: StripeRefundLike[] }>;
  };
  accounts?: { retrieve(): Promise<{ id: string; livemode?: boolean }> };
  webhookEndpoints?: {
    create(params: Record<string, unknown>, options?: Record<string, unknown>): Promise<{ id: string; secret?: string }>;
    del(id: string): Promise<unknown>;
  };
  paymentMethodDomains?: { create(params: Record<string, unknown>, options?: Record<string, unknown>): Promise<unknown> };
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
      const r = await stripe.refunds.create({ payment_intent: id, amount }, { idempotencyKey }) as { id?: string } | undefined;
      return { id: typeof r?.id === 'string' ? r.id : null };
    },
    async listRefunds(id) {
      if (!stripe.refunds?.list) throw new Error('Stripe client cannot list refunds');
      return (await stripe.refunds.list({ payment_intent: id, limit: 100 })).data;
    },
    async cancel(id, idempotencyKey) {
      if (!stripe.paymentIntents.cancel) throw new Error('Stripe client cannot cancel a payment');
      await stripe.paymentIntents.cancel(id, {}, { idempotencyKey });
    },
  };
}

/** Events the webhook endpoint handles (see `POST /webhooks/stripe`); an auto-created endpoint subscribes to exactly these. */
export const STRIPE_WEBHOOK_EVENTS = [
  'payment_intent.succeeded', 'payment_intent.amount_capturable_updated', 'payment_intent.payment_failed', 'payment_intent.canceled', 'charge.refunded', 'charge.dispute.created',
] as const;

/** Account-level calls made when a merchant saves their keys (no webhook secret needed yet). */
export interface StripeAdmin {
  /** Retrieve the account the secret key belongs to; throws when Stripe rejects the key. */
  verifyAccount(): Promise<{ id: string }>;
  /** Create the webhook endpoint for `url` subscribed to `STRIPE_WEBHOOK_EVENTS`. The signing secret is only returned at creation. */
  createWebhookEndpoint(url: string): Promise<{ id: string; secret: string }>;
  deleteWebhookEndpoint(id: string): Promise<void>;
  /** Register a domain for wallets (Apple Pay, Google Pay) in the Payment Element. */
  registerDomain(domain: string): Promise<void>;
}

export function createStripeAdmin(secretKey: string, client?: StripeClientLike): StripeAdmin {
  const stripe: StripeClientLike = client ?? (new Stripe(secretKey) as unknown as StripeClientLike);
  return {
    async verifyAccount() {
      if (!stripe.accounts) throw new Error('Stripe client cannot retrieve the account');
      const a = await stripe.accounts.retrieve();
      return { id: a.id };
    },
    async createWebhookEndpoint(url) {
      if (!stripe.webhookEndpoints) throw new Error('Stripe client cannot create webhook endpoints');
      const e = await stripe.webhookEndpoints.create({ url, enabled_events: [...STRIPE_WEBHOOK_EVENTS], description: 'ShopMe' });
      if (!e.secret) throw new Error('Stripe returned no signing secret');
      return { id: e.id, secret: e.secret };
    },
    async deleteWebhookEndpoint(id) {
      if (!stripe.webhookEndpoints) throw new Error('Stripe client cannot delete webhook endpoints');
      await stripe.webhookEndpoints.del(id);
    },
    async registerDomain(domain) {
      if (!stripe.paymentMethodDomains) throw new Error('Stripe client cannot register domains');
      await stripe.paymentMethodDomains.create({ domain_name: domain });
    },
  };
}
