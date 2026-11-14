/** Shared helpers for the HTTP based provider adapters (PayPal, Mollie). */

/** Provider-neutral payment state. */
export type NormalizedPaymentStatus = 'pending' | 'authorized' | 'paid' | 'failed' | 'voided' | 'refunded';

/** Injectable fetch (tests pass a fake; production uses the global one). */
export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body?: string; signal?: AbortSignal }) => Promise<{
  ok: boolean; status: number; headers: { get(name: string): string | null }; text(): Promise<string>;
}>;

export type ProviderName = 'paypal' | 'mollie';

/** A failed provider call or invalid input. `code` is the provider's error name when it sent one, otherwise a local code. */
export class PaymentProviderError extends Error {
  constructor(
    public readonly provider: ProviderName,
    message: string,
    public readonly code: string,
    /** HTTP status, 0 when no response was received. */
    public readonly status = 0,
    /** Provider debug id (PayPal `debug_id`), safe to log. */
    public readonly debugId?: string,
  ) {
    super(message);
    this.name = 'PaymentProviderError';
  }
}

/** Currencies whose ISO 4217 minor-unit exponent is 0 (minor units equal whole units). */
const ZERO_EXPONENT = new Set(['BIF', 'CLP', 'DJF', 'GNF', 'ISK', 'JPY', 'KMF', 'KRW', 'PYG', 'RWF', 'UGX', 'UYI', 'VND', 'VUV', 'XAF', 'XOF', 'XPF']);
const THREE_EXPONENT = new Set(['BHD', 'IQD', 'JOD', 'KWD', 'LYD', 'OMR', 'TND']);

/** ISO 4217 exponent: how many minor units make one whole unit (10^exponent). */
export function currencyExponent(currency: string): number {
  const c = currency.toUpperCase();
  return ZERO_EXPONENT.has(c) ? 0 : THREE_EXPONENT.has(c) ? 3 : 2;
}

/** Decimal string for `minor` with exactly `decimals` digits; throws when that would lose precision. */
export function minorToDecimal(provider: ProviderName, minor: number, currency: string, decimals: number): string {
  if (!Number.isSafeInteger(minor) || minor < 0) throw new PaymentProviderError(provider, `Invalid amount: ${minor}`, 'invalid_amount');
  const exp = currencyExponent(currency);
  if (decimals > exp) throw new PaymentProviderError(provider, `${currency} cannot have ${decimals} decimals`, 'invalid_currency');
  const drop = 10 ** (exp - decimals);
  if (minor % drop !== 0) {
    throw new PaymentProviderError(provider, `Amount ${minor} (minor units) cannot be expressed in ${currency} with ${decimals} decimals`, 'amount_not_representable');
  }
  const units = minor / drop;
  if (decimals === 0) return String(units);
  const s = String(units).padStart(decimals + 1, '0');
  return `${s.slice(0, -decimals)}.${s.slice(-decimals)}`;
}

/** Inverse of {@link minorToDecimal}: a provider decimal string to minor units; NaN when malformed. */
export function decimalToMinor(value: string, currency: string): number {
  const exp = currencyExponent(currency);
  const m = /^(\d+)(?:\.(\d+))?$/.exec(value.trim());
  if (!m) return NaN;
  const frac = (m[2] ?? '').padEnd(exp, '0').slice(0, exp);
  return Number(m[1]) * 10 ** exp + (exp ? Number(frac) : 0);
}

export const DEFAULT_TIMEOUT_MS = 15_000;

/** One HTTP exchange with timeout; returns parsed JSON (null for an empty or non-JSON body). Throws PaymentProviderError on timeout/network errors. */
export async function httpJson(
  provider: ProviderName,
  fetchImpl: FetchLike,
  timeoutMs: number,
  method: string,
  url: string,
  headers: Record<string, string>,
  body?: string,
): Promise<{ ok: boolean; status: number; json: any; headers: { get(name: string): string | null } }> {
  let res;
  try {
    res = await fetchImpl(url, { method, headers, ...(body !== undefined ? { body } : {}), signal: AbortSignal.timeout(timeoutMs) });
  } catch (e) {
    const err = e as { name?: string; message?: string };
    if (err?.name === 'TimeoutError' || err?.name === 'AbortError') {
      throw new PaymentProviderError(provider, `${provider} request timed out after ${timeoutMs} ms (${method} ${new URL(url).pathname})`, 'timeout');
    }
    throw new PaymentProviderError(provider, `${provider} request failed: ${err?.message ?? 'network error'}`, 'network_error');
  }
  const text = await res.text();
  let json: any = null;
  if (text) { try { json = JSON.parse(text); } catch { json = null; } }
  return { ok: res.ok, status: res.status, json, headers: res.headers };
}
