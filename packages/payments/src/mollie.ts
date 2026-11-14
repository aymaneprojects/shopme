import {
  DEFAULT_TIMEOUT_MS, PaymentProviderError, currencyExponent, decimalToMinor, httpJson, minorToDecimal,
  type FetchLike, type NormalizedPaymentStatus,
} from './provider-common';

export type MollieMode = 'test' | 'live';

export interface MollieSettings { apiKey: string }

/** Validate settings. The key must be `test_...` or `live_...`. Throws PaymentProviderError with code `invalid_settings`. */
export function parseMollieSettings(raw: unknown): MollieSettings & { mode: MollieMode } {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const apiKey = typeof o.apiKey === 'string' ? o.apiKey.trim() : '';
  const m = /^(test|live)_[A-Za-z0-9]{20,}$/.exec(apiKey);
  if (!m) throw new PaymentProviderError('mollie', "Mollie apiKey must start with 'test_' or 'live_'", 'invalid_settings');
  return { apiKey, mode: m[1] as MollieMode };
}

export const MOLLIE_BASE_URL = 'https://api.mollie.com/v2';

/** Mollie wants the exact number of decimals of the currency in a string, e.g. "10.00" (EUR) or "10" (JPY). */
export function toMollieAmount(minor: number, currency: string): { currency: string; value: string } {
  const c = currency.toUpperCase();
  return { currency: c, value: minorToDecimal('mollie', minor, c, currencyExponent(c)) };
}

/** Mollie payment status to the normalised one. `canceled` is reported as `voided`. */
export function mapMollieStatus(status: string): NormalizedPaymentStatus {
  switch ((status ?? '').toLowerCase()) {
    case 'paid': return 'paid';
    case 'authorized': return 'authorized';
    case 'canceled': return 'voided';
    case 'expired': case 'failed': return 'failed';
    default: return 'pending'; // open, pending
  }
}

/** Mollie refund status to the normalised one. */
export function mapMollieRefundStatus(status: string): NormalizedPaymentStatus {
  switch ((status ?? '').toLowerCase()) {
    case 'refunded': return 'refunded';
    case 'failed': case 'canceled': return 'failed';
    default: return 'pending'; // queued, pending, processing
  }
}

export interface MollieCreatePaymentInput {
  /** Minor units. */
  amount: number;
  currency: string;
  description: string;
  redirectUrl: string;
  cancelUrl?: string;
  webhookUrl?: string;
  orderId: string;
  shopId: string;
  /** Mollie method id (ideal, creditcard, ...) or several ids to restrict the method screen. */
  method?: string | string[];
  /** `manual` authorises first; capture later with createCapture. Card payments only. */
  captureMode?: 'automatic' | 'manual';
  /** Sent as the `Idempotency-Key` header. */
  idempotencyKey: string;
}

export interface MolliePaymentResult {
  paymentId: string;
  providerStatus: string;
  status: NormalizedPaymentStatus;
  /** Minor units. */
  amount: number | null;
  currency: string | null;
  /** Minor units refunded so far (0 when none). */
  amountRefunded: number;
  /** Minor units captured so far (manual capture mode), null when not reported. */
  amountCaptured: number | null;
  method: string | null;
  isCancelable: boolean;
  /** metadata.orderId / metadata.shopId as we sent them. */
  orderId: string | null;
  shopId: string | null;
  checkoutUrl: string | null;
}

export interface MollieCaptureResult { captureId: string; providerStatus: string; status: 'pending' | 'paid' | 'failed'; amount: number | null; currency: string | null }
export interface MollieRefundResult { refundId: string; paymentId: string; providerStatus: string; status: NormalizedPaymentStatus; amount: number | null; currency: string | null }
export interface MollieMethod { id: string; description: string; status: string; minimumAmount: { currency: string; value: string } | null; maximumAmount: { currency: string; value: string } | null }

export interface MollieAdapterOptions { fetch?: FetchLike; timeoutMs?: number }

export interface MollieAdapter {
  readonly mode: MollieMode;
  createPayment(input: MollieCreatePaymentInput): Promise<{ paymentId: string; checkoutUrl: string | null; status: NormalizedPaymentStatus }>;
  getPayment(paymentId: string): Promise<MolliePaymentResult>;
  /** Omit `amount` to capture the full authorised amount. */
  createCapture(paymentId: string, opts: { amount?: number; currency?: string; description?: string; idempotencyKey: string }): Promise<MollieCaptureResult>;
  /** Cancel an open payment or release an authorisation (DELETE /payments/{id}). Mollie answers 422 when it can no longer be cancelled. */
  cancelPayment(paymentId: string): Promise<MolliePaymentResult>;
  createRefund(paymentId: string, opts: { amount: number; currency: string; description?: string; idempotencyKey: string }): Promise<MollieRefundResult>;
  getRefund(paymentId: string, refundId: string): Promise<MollieRefundResult>;
  /** Enabled online methods for the account. Mollie returns EUR methods unless `amount` is given. */
  listMethods(opts?: { amount?: number; currency?: string; locale?: string }): Promise<MollieMethod[]>;
  /**
   * Mollie webhooks carry only `id=tr_...` and no signature. This extracts the id from the posted body (form string,
   * URLSearchParams or object), then re-fetches the payment with the merchant key and returns that verified state.
   * The posted body is never trusted for anything but the id. Returns null when no valid payment id is present.
   */
  resolveWebhook(body: string | URLSearchParams | Record<string, unknown> | null | undefined): Promise<MolliePaymentResult | null>;
}

const PAYMENT_ID = /^tr_[A-Za-z0-9]+$/;
const enc = encodeURIComponent;

export function createMollieAdapter(rawSettings: unknown, opts: MollieAdapterOptions = {}): MollieAdapter {
  const { apiKey, mode } = parseMollieSettings(rawSettings);
  const doFetch: FetchLike = opts.fetch ?? ((url, init) => fetch(url, init));
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  async function call(method: string, path: string, body?: unknown, extra: Record<string, string> = {}): Promise<any> {
    const res = await httpJson('mollie', doFetch, timeoutMs, method, `${MOLLIE_BASE_URL}${path}`, {
      Authorization: `Bearer ${apiKey}`, Accept: 'application/json', ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...extra,
    }, body !== undefined ? JSON.stringify(body) : undefined);
    if (!res.ok) {
      const j = res.json ?? {};
      const message = [j.title, j.detail].filter(Boolean).join(': ') || `Mollie request failed with HTTP ${res.status}`;
      // Mollie errors have no machine code: `title` is the closest (e.g. "Unprocessable Entity"); `field` names the offending parameter on 422.
      throw new PaymentProviderError('mollie', j.field ? `${message} (field: ${j.field})` : message, j.title ?? `http_${res.status}`, res.status);
    }
    return res.json;
  }

  const idem = (key?: string): Record<string, string> => (key ? { 'Idempotency-Key': key } : {});
  const minor = (a?: { currency: string; value: string }) => {
    const v = a ? decimalToMinor(a.value, a.currency) : NaN;
    return Number.isFinite(v) ? v : null;
  };
  const optAmount = (amount: number | undefined, currency: string | undefined) => {
    if (amount === undefined) return {};
    if (!currency) throw new PaymentProviderError('mollie', 'currency is required with an amount', 'invalid_amount');
    return { amount: toMollieAmount(amount, currency) };
  };

  function toPayment(p: any): MolliePaymentResult {
    let status = mapMollieStatus(p.status);
    const total = minor(p.amount), refunded = minor(p.amountRefunded) ?? 0;
    if (status === 'paid' && total !== null && refunded >= total && total > 0) status = 'refunded';
    return {
      paymentId: p.id, providerStatus: p.status, status, amount: total, currency: p.amount?.currency ?? null, amountRefunded: refunded,
      amountCaptured: p.amountCaptured ? minor(p.amountCaptured) : null, method: p.method ?? null, isCancelable: p.isCancelable === true,
      orderId: typeof p.metadata?.orderId === 'string' ? p.metadata.orderId : null, shopId: typeof p.metadata?.shopId === 'string' ? p.metadata.shopId : null,
      checkoutUrl: p._links?.checkout?.href ?? null,
    };
  }
  const toRefund = (r: any): MollieRefundResult => ({
    refundId: r.id, paymentId: r.paymentId, providerStatus: r.status, status: mapMollieRefundStatus(r.status), amount: minor(r.amount), currency: r.amount?.currency ?? null,
  });

  return {
    mode,
    async createPayment(i) {
      const p = await call('POST', '/payments', {
        amount: toMollieAmount(i.amount, i.currency), description: i.description.slice(0, 255), redirectUrl: i.redirectUrl,
        ...(i.cancelUrl ? { cancelUrl: i.cancelUrl } : {}), ...(i.webhookUrl ? { webhookUrl: i.webhookUrl } : {}),
        metadata: { orderId: i.orderId, shopId: i.shopId },
        ...(i.method ? { method: i.method } : {}), ...(i.captureMode ? { captureMode: i.captureMode } : {}),
      }, idem(i.idempotencyKey));
      return { paymentId: p.id, checkoutUrl: p._links?.checkout?.href ?? null, status: mapMollieStatus(p.status) };
    },
    async getPayment(id) {
      if (!PAYMENT_ID.test(id)) throw new PaymentProviderError('mollie', `Invalid Mollie payment id: ${id}`, 'invalid_id');
      return toPayment(await call('GET', `/payments/${enc(id)}`));
    },
    async createCapture(id, o) {
      const c = await call('POST', `/payments/${enc(id)}/captures`, {
        ...optAmount(o.amount, o.currency), ...(o.description ? { description: o.description.slice(0, 255) } : {}),
      }, idem(o.idempotencyKey));
      return { captureId: c.id, providerStatus: c.status, status: c.status === 'succeeded' ? 'paid' : c.status === 'failed' ? 'failed' : 'pending', amount: minor(c.amount), currency: c.amount?.currency ?? null };
    },
    async cancelPayment(id) { return toPayment(await call('DELETE', `/payments/${enc(id)}`)); },
    async createRefund(id, o) {
      const r = await call('POST', `/payments/${enc(id)}/refunds`, {
        amount: toMollieAmount(o.amount, o.currency), ...(o.description ? { description: o.description.slice(0, 255) } : {}),
      }, idem(o.idempotencyKey));
      return toRefund(r);
    },
    async getRefund(paymentId, refundId) { return toRefund(await call('GET', `/payments/${enc(paymentId)}/refunds/${enc(refundId)}`)); },
    async listMethods(o = {}) {
      const q = new URLSearchParams();
      if (o.amount !== undefined) {
        if (!o.currency) throw new PaymentProviderError('mollie', 'currency is required with an amount', 'invalid_amount');
        const a = toMollieAmount(o.amount, o.currency);
        q.set('amount[currency]', a.currency); q.set('amount[value]', a.value);
      }
      if (o.locale) q.set('locale', o.locale);
      const qs = q.toString();
      const j = await call('GET', `/methods${qs ? `?${qs}` : ''}`);
      return ((j?._embedded?.methods ?? []) as any[]).map((m) => ({
        id: m.id, description: m.description, status: m.status, minimumAmount: m.minimumAmount ?? null, maximumAmount: m.maximumAmount ?? null,
      }));
    },
    async resolveWebhook(body) {
      let id: unknown;
      if (typeof body === 'string') id = new URLSearchParams(body).get('id');
      else if (body instanceof URLSearchParams) id = body.get('id');
      else if (body && typeof body === 'object') id = (body as Record<string, unknown>).id;
      if (typeof id !== 'string' || !PAYMENT_ID.test(id)) return null;
      return toPayment(await call('GET', `/payments/${enc(id)}`));
    },
  };
}
