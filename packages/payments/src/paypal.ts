import {
  DEFAULT_TIMEOUT_MS, PaymentProviderError, currencyExponent, decimalToMinor, httpJson, minorToDecimal,
  type FetchLike, type NormalizedPaymentStatus,
} from './provider-common';


export type PayPalEnvironment = 'sandbox' | 'live';

export interface PayPalSettings { clientId: string; clientSecret: string; webhookId: string; environment: PayPalEnvironment }

/** Validate raw settings (admin form / env). Throws PaymentProviderError with code `invalid_settings`. */
export function parsePayPalSettings(raw: unknown, opt: { allowMissingWebhook?: boolean } = {}): PayPalSettings {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const str = (k: string) => (typeof o[k] === 'string' ? (o[k] as string).trim() : '');
  const bad = (m: string) => new PaymentProviderError('paypal', m, 'invalid_settings');
  const clientId = str('clientId'), clientSecret = str('clientSecret'), webhookId = str('webhookId');
  if (!clientId) throw bad('PayPal clientId is required');
  if (!clientSecret) throw bad('PayPal clientSecret is required');
  if (!webhookId && !opt.allowMissingWebhook) throw bad('PayPal webhookId is required');
  if (o.environment !== 'sandbox' && o.environment !== 'live') throw bad("PayPal environment must be 'sandbox' or 'live'");
  return { clientId, clientSecret, webhookId, environment: o.environment };
}

export const PAYPAL_BASE_URL: Record<PayPalEnvironment, string> = { sandbox: 'https://api-m.sandbox.paypal.com', live: 'https://api-m.paypal.com' };

/** Currencies PayPal accepts only as whole numbers (PayPal currency-codes page: HUF, JPY, TWD). */
const PAYPAL_ZERO_DECIMAL = new Set(['HUF', 'JPY', 'TWD']);

/**
 * Our minor units (ISO 4217 exponent) to PayPal's decimal string. HUF and TWD have 2 minor digits but PayPal wants whole units,
 * so an amount that is not a whole number of units throws `amount_not_representable` instead of being rounded silently.
 */
export function toPayPalValue(minor: number, currency: string): string {
  const c = currency.toUpperCase();
  return minorToDecimal('paypal', minor, c, PAYPAL_ZERO_DECIMAL.has(c) ? 0 : currencyExponent(c));
}

export interface PayPalMoney { currency_code: string; value: string }

export interface PayPalCreateOrderInput {
  /** Minor units. */
  amount: number;
  currency: string;
  intent: 'CAPTURE' | 'AUTHORIZE';
  /** Our order id, stored as `reference_id` and `custom_id`. */
  orderId: string;
  /** Visible to the buyer in PayPal history (max 127 chars, unique per merchant account by default). */
  invoiceId?: string;
  description?: string;
  returnUrl: string;
  cancelUrl: string;
  /** Sent as the `PayPal-Request-Id` header. */
  idempotencyKey: string;
  /** Button label on the PayPal page. Default PAY_NOW. */
  userAction?: 'PAY_NOW' | 'CONTINUE';
}

export interface PayPalOrderRef { id: string; providerStatus: string; approvalUrl: string | null }

export interface PayPalOrderResult {
  orderId: string;
  /** Raw PayPal order status (CREATED, APPROVED, COMPLETED, ...). */
  providerStatus: string;
  status: NormalizedPaymentStatus;
  captureId: string | null;
  authorizationId: string | null;
  /** Minor units of the capture/authorization when present. */
  amount: number | null;
  currency: string | null;
  /** Our order id (custom_id, else reference_id). */
  reference: string | null;
}

export interface PayPalPaymentResult { id: string; providerStatus: string; status: NormalizedPaymentStatus; amount: number | null; currency: string | null }

export interface PayPalWebhookEvent { id: string; event_type: string; resource: Record<string, any>; [k: string]: unknown }

export interface PayPalAdapterOptions { fetch?: FetchLike; timeoutMs?: number; now?: () => number;
  /** Admin use (saving credentials): accept an empty webhookId so the webhook can be created with `createWebhook`. `verifyWebhook` then always answers null. */
  allowMissingWebhook?: boolean }

/** Events ShopMe handles; a webhook created through the API subscribes to exactly these. */
export const PAYPAL_WEBHOOK_EVENTS = [
  'CHECKOUT.ORDER.APPROVED', 'PAYMENT.CAPTURE.COMPLETED', 'PAYMENT.CAPTURE.DENIED', 'PAYMENT.CAPTURE.DECLINED', 'PAYMENT.CAPTURE.REFUNDED',
  'PAYMENT.AUTHORIZATION.CREATED', 'PAYMENT.AUTHORIZATION.VOIDED',
] as const;

/** Map a PayPal order/capture/authorization/refund status to the normalised one. */
export function mapPayPalStatus(kind: 'order' | 'capture' | 'authorization' | 'refund', status: string): NormalizedPaymentStatus {
  const s = (status ?? '').toUpperCase();
  switch (kind) {
    case 'order':
      if (s === 'COMPLETED') return 'paid';
      if (s === 'VOIDED') return 'voided';
      return 'pending'; // CREATED, SAVED, APPROVED, PAYER_ACTION_REQUIRED
    case 'capture':
      if (s === 'COMPLETED') return 'paid';
      if (s === 'REFUNDED' || s === 'PARTIALLY_REFUNDED') return 'refunded';
      if (s === 'DECLINED' || s === 'FAILED') return 'failed';
      return 'pending';
    case 'authorization':
      if (s === 'CREATED') return 'authorized';
      if (s === 'CAPTURED' || s === 'PARTIALLY_CAPTURED') return 'paid';
      if (s === 'VOIDED') return 'voided';
      if (s === 'DENIED' || s === 'EXPIRED') return 'failed';
      return 'pending';
    case 'refund':
      if (s === 'COMPLETED') return 'refunded';
      if (s === 'FAILED' || s === 'CANCELLED') return 'failed';
      return 'pending';
  }
}

export interface PayPalAdapter {
  /** Obtain an access token with the credentials (throws PaymentProviderError when PayPal rejects them). */
  verifyCredentials(): Promise<void>;
  /** POST /v1/notifications/webhooks for `url` with `PAYPAL_WEBHOOK_EVENTS`; returns the webhook id. */
  createWebhook(url: string): Promise<{ id: string }>;
  /** DELETE /v1/notifications/webhooks/{id}. */
  deleteWebhook(id: string): Promise<void>;
  createOrder(input: PayPalCreateOrderInput): Promise<PayPalOrderRef>;
  getOrder(orderId: string): Promise<PayPalOrderResult>;
  captureOrder(orderId: string, idempotencyKey?: string): Promise<PayPalOrderResult>;
  authorizeOrder(orderId: string, idempotencyKey?: string): Promise<PayPalOrderResult>;
  /** Omit `amount` to capture the full authorised amount. */
  captureAuthorization(authorizationId: string, opts: { amount?: number; currency?: string; finalCapture?: boolean; idempotencyKey: string }): Promise<PayPalPaymentResult>;
  voidAuthorization(authorizationId: string, idempotencyKey?: string): Promise<void>;
  /** Omit `amount` for a full refund. */
  refundCapture(captureId: string, opts: { amount?: number; currency?: string; note?: string; idempotencyKey: string }): Promise<PayPalPaymentResult>;
  /** Returns the parsed event only when PayPal answers verification_status SUCCESS, otherwise null. */
  verifyWebhook(headers: Record<string, string | string[] | undefined>, rawBody: string): Promise<PayPalWebhookEvent | null>;
}

const tokenCache = new Map<string, { token: string; expiresAt: number }>();
/** Forget cached access tokens (tests). */
export function clearPayPalTokenCache(): void { tokenCache.clear(); }

export function createPayPalAdapter(rawSettings: unknown, opts: PayPalAdapterOptions = {}): PayPalAdapter {
  const cfg = parsePayPalSettings(rawSettings, { allowMissingWebhook: opts.allowMissingWebhook });
  const base = PAYPAL_BASE_URL[cfg.environment];
  const doFetch: FetchLike = opts.fetch ?? ((url, init) => fetch(url, init));
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const now = opts.now ?? Date.now;
  const tokenKey = `${cfg.environment}:${cfg.clientId}`;

  function fail(res: { status: number; json: any }): never {
    const j = res.json ?? {};
    const d0 = Array.isArray(j.details) ? j.details[0] : undefined;
    const message = [j.message ?? j.error_description, d0?.description].filter(Boolean).join(': ') || `PayPal request failed with HTTP ${res.status}`;
    throw new PaymentProviderError('paypal', message, j.name ?? j.error ?? d0?.issue ?? `http_${res.status}`, res.status, j.debug_id);
  }

  async function accessToken(force = false): Promise<string> {
    const cached = tokenCache.get(tokenKey);
    if (!force && cached && cached.expiresAt > now()) return cached.token;
    const basic = Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`).toString('base64');
    const res = await httpJson('paypal', doFetch, timeoutMs, 'POST', `${base}/v1/oauth2/token`, {
      Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json',
    }, 'grant_type=client_credentials');
    if (!res.ok || !res.json?.access_token) fail(res);
    const ttl = Number(res.json.expires_in) || 300;
    tokenCache.set(tokenKey, { token: res.json.access_token, expiresAt: now() + Math.max(ttl - 60, 0) * 1000 }); // refresh a minute early
    return res.json.access_token;
  }

  /** Authenticated call; a 401 drops the cached token and retries once with a fresh one. */
  async function authed(method: string, path: string, headers: Record<string, string>, body?: string) {
    const send = (token: string) => httpJson('paypal', doFetch, timeoutMs, method, `${base}${path}`, { Authorization: `Bearer ${token}`, Accept: 'application/json', ...headers }, body);
    let res = await send(await accessToken());
    if (res.status === 401) { tokenCache.delete(tokenKey); res = await send(await accessToken(true)); }
    if (!res.ok) fail(res);
    return res.json;
  }
  const call = (method: string, path: string, body?: unknown, extra: Record<string, string> = {}) =>
    authed(method, path, { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...extra }, body !== undefined ? JSON.stringify(body) : undefined);

  const money = (minor: number, currency: string): PayPalMoney => ({ currency_code: currency.toUpperCase(), value: toPayPalValue(minor, currency) });
  const fromMoney = (m?: PayPalMoney) => {
    const v = m ? decimalToMinor(m.value, m.currency_code) : NaN;
    return Number.isFinite(v) ? { amount: v, currency: m!.currency_code } : { amount: null, currency: null };
  };
  const reqId = (key?: string): Record<string, string> => (key ? { 'PayPal-Request-Id': key } : {});
  const optAmount = (amount: number | undefined, currency: string | undefined) => {
    if (amount === undefined) return {};
    if (!currency) throw new PaymentProviderError('paypal', 'currency is required with an amount', 'invalid_amount');
    return { amount: money(amount, currency) };
  };
  const enc = encodeURIComponent;

  function toOrderResult(o: any): PayPalOrderResult {
    const pu = o.purchase_units?.[0] ?? {};
    const capture = pu.payments?.captures?.[0];
    const auth = pu.payments?.authorizations?.[0];
    const status = capture ? mapPayPalStatus('capture', capture.status) : auth ? mapPayPalStatus('authorization', auth.status) : mapPayPalStatus('order', o.status);
    return {
      orderId: o.id, providerStatus: o.status ?? '', status, captureId: capture?.id ?? null, authorizationId: auth?.id ?? null,
      ...fromMoney((capture ?? auth)?.amount), reference: pu.custom_id ?? pu.reference_id ?? null,
    };
  }
  const toPayment = (kind: 'capture' | 'refund', r: any): PayPalPaymentResult => ({ id: r.id, providerStatus: r.status, status: mapPayPalStatus(kind, r.status), ...fromMoney(r.amount) });

  return {
    async verifyCredentials() { await accessToken(true); },
    async createWebhook(url) {
      const j = await call('POST', '/v1/notifications/webhooks', { url, event_types: PAYPAL_WEBHOOK_EVENTS.map((name) => ({ name })) });
      if (!j?.id) throw new PaymentProviderError('paypal', 'PayPal returned no webhook id', 'invalid_response');
      return { id: j.id };
    },
    async deleteWebhook(id) { await call('DELETE', `/v1/notifications/webhooks/${enc(id)}`); },
    async createOrder(i) {
      const purchaseUnit = {
        reference_id: i.orderId, custom_id: i.orderId, amount: money(i.amount, i.currency),
        ...(i.invoiceId ? { invoice_id: i.invoiceId } : {}), ...(i.description ? { description: i.description.slice(0, 127) } : {}),
      };
      const o = await call('POST', '/v2/checkout/orders', {
        intent: i.intent, purchase_units: [purchaseUnit],
        payment_source: { paypal: { experience_context: { return_url: i.returnUrl, cancel_url: i.cancelUrl, user_action: i.userAction ?? 'PAY_NOW' } } },
      }, reqId(i.idempotencyKey));
      const links = (o.links ?? []) as Array<{ rel: string; href: string }>;
      const link = links.find((l) => l.rel === 'payer-action') ?? links.find((l) => l.rel === 'approve');
      return { id: o.id, providerStatus: o.status, approvalUrl: link?.href ?? null };
    },
    async getOrder(id) { return toOrderResult(await call('GET', `/v2/checkout/orders/${enc(id)}`)); },
    async captureOrder(id, key) { return toOrderResult(await call('POST', `/v2/checkout/orders/${enc(id)}/capture`, {}, reqId(key))); },
    async authorizeOrder(id, key) { return toOrderResult(await call('POST', `/v2/checkout/orders/${enc(id)}/authorize`, {}, reqId(key))); },
    async captureAuthorization(id, o) {
      const body = { ...optAmount(o.amount, o.currency), ...(o.finalCapture !== undefined ? { final_capture: o.finalCapture } : {}) };
      return toPayment('capture', await call('POST', `/v2/payments/authorizations/${enc(id)}/capture`, body, reqId(o.idempotencyKey)));
    },
    async voidAuthorization(id, key) { await call('POST', `/v2/payments/authorizations/${enc(id)}/void`, undefined, reqId(key)); },
    async refundCapture(id, o) {
      const body = { ...optAmount(o.amount, o.currency), ...(o.note ? { note_to_payer: o.note.slice(0, 255) } : {}) };
      return toPayment('refund', await call('POST', `/v2/payments/captures/${enc(id)}/refund`, body, reqId(o.idempotencyKey)));
    },
    async verifyWebhook(headers, rawBody) {
      const h = (k: string) => { const v = headers[k] ?? headers[k.toUpperCase()]; return Array.isArray(v) ? v[0] : v; };
      const fields = {
        auth_algo: h('paypal-auth-algo'), cert_url: h('paypal-cert-url'), transmission_id: h('paypal-transmission-id'),
        transmission_sig: h('paypal-transmission-sig'), transmission_time: h('paypal-transmission-time'),
      };
      if (!cfg.webhookId || Object.values(fields).some((v) => !v)) return null;
      let event: PayPalWebhookEvent;
      try { event = JSON.parse(rawBody); } catch { return null; }
      if (!event || typeof event !== 'object') return null;
      // PayPal requires webhook_event exactly as received, so splice the raw text instead of re-serialising the parsed event.
      const head = Object.entries({ ...fields, webhook_id: cfg.webhookId }).map(([k, v]) => `${JSON.stringify(k)}:${JSON.stringify(v)}`).join(',');
      const json = await authed('POST', '/v1/notifications/verify-webhook-signature', { 'Content-Type': 'application/json' }, `{${head},"webhook_event":${rawBody.trim()}}`);
      return json?.verification_status === 'SUCCESS' ? event : null;
    },
  };
}
