/**
 * Pure price math for markets: currency conversion with a manual rate, percentage adjustments and rounding.
 * All amounts are integer minor units; conversion uses exact BigInt arithmetic (halves round away from zero), never floats.
 */
import { currencyExponent } from '@shopme/shopify-compat';

const RATE_SCALE = 100_000_000n; // rates carry up to 8 decimals

/** round(n / d) with halves away from zero (d > 0). */
function divRound(n: bigint, d: bigint): bigint {
  const neg = n < 0n;
  const a = neg ? -n : n;
  const q = (2n * a + d) / (2n * d);
  return neg ? -q : q;
}

/** `minor * numerator / denominator`, rounded half away from zero. */
export function scaleMinor(minor: number, numerator: bigint, denominator: bigint): number {
  return Number(divRound(BigInt(Math.round(minor)) * numerator, denominator));
}

const rateBig = (rate: number): bigint => BigInt(Math.round(rate * 1e8));
const pow10 = (n: number): bigint => 10n ** BigInt(Math.max(0, n));

/** Convert minor units of `from` into minor units of `to` at `rate` (units of `to` per one unit of `from`). */
export function convertMinor(minor: number, from: string, to: string, rate: number): number {
  if (from === to && rate === 1) return Math.round(minor);
  const ef = currencyExponent(from), et = currencyExponent(to);
  // minor_to = minor_from * rate * 10^(et - ef)
  return scaleMinor(minor, rateBig(rate) * pow10(et - ef), RATE_SCALE * pow10(ef - et));
}

/** Convert an amount of the presentment currency back into shop money (inverse of `convertMinor`). */
export function unconvertMinor(minor: number, shopCurrency: string, presentmentCurrency: string, rate: number): number {
  if (shopCurrency === presentmentCurrency && rate === 1) return Math.round(minor);
  if (!(rate > 0)) return Math.round(minor);
  const ef = currencyExponent(shopCurrency), et = currencyExponent(presentmentCurrency);
  // minor_from = minor_to / (rate * 10^(et - ef))
  return scaleMinor(minor, RATE_SCALE * pow10(ef - et), rateBig(rate) * pow10(et - ef));
}

/** Round up to the next whole unit of the currency (a whole number already stays). Zero-decimal currencies are whole already. */
export function roundUpToWhole(minor: number, currency: string): number {
  const unit = 10 ** currencyExponent(currency);
  return Math.ceil(minor / unit) * unit;
}

export interface PriceAdjustment { type: 'PERCENTAGE_DECREASE' | 'PERCENTAGE_INCREASE'; value: number }

/** Apply a percentage adjustment to an amount (the value is a percent with up to 4 decimals). */
export function adjustMinor(minor: number, adj: PriceAdjustment | null | undefined): number {
  if (!adj || !adj.value) return minor;
  const pct = BigInt(Math.round(adj.value * 10_000)); // percent x 10^4
  const base = 1_000_000n; // 100% in the same scale
  const factor = adj.type === 'PERCENTAGE_DECREASE' ? base - pct : base + pct;
  return scaleMinor(minor, factor < 0n ? 0n : factor, base);
}

export interface PriceRules {
  shopCurrency: string;
  currency: string;
  /** `currency` per one unit of the shop currency. */
  rate: number;
  roundingEnabled: boolean;
  adjustment?: PriceAdjustment | null;
  compareAtMode?: 'ADJUSTED' | 'NULLIFY';
}

export interface FixedPrice { price: number; compareAtPrice: number | null }

/**
 * Price of one variant for a market: a fixed price wins (and is never rounded); otherwise the shop-currency base price is adjusted,
 * converted and rounded. A compare-at price that is not above the price is dropped.
 */
export function resolvePrice(base: { price: number; compareAt: number | null }, rules: PriceRules, fixed?: FixedPrice | null): { price: number; compareAt: number | null } {
  if (fixed) return { price: fixed.price, compareAt: fixed.compareAtPrice && fixed.compareAtPrice > fixed.price ? fixed.compareAtPrice : null };
  const local = (minor: number) => {
    const v = convertMinor(adjustMinor(minor, rules.adjustment), rules.shopCurrency, rules.currency, rules.rate);
    return rules.roundingEnabled && rules.currency !== rules.shopCurrency ? roundUpToWhole(v, rules.currency) : v;
  };
  const price = local(base.price);
  const compareRaw = base.compareAt && rules.compareAtMode !== 'NULLIFY' ? local(base.compareAt) : null;
  return { price, compareAt: compareRaw && compareRaw > price ? compareRaw : null };
}
