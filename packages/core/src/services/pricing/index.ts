/**
 * Pure checkout pricing: discounts, shipping rate matching and taxes. Money is integer minor units.
 * Rounding is always "half up" on exact integer arithmetic (BigInt), so results never depend on floating point.
 */

// --- rounding helpers -------------------------------------------------------------------------------------------------

/** round(n / d) with halves rounded up, for non-negative integers. */
export function roundDiv(n: number, d: number): number {
  if (d === 0) return 0;
  const N = BigInt(Math.round(n)); const D = BigInt(Math.round(d));
  return Number((2n * N + D) / (2n * D));
}

/** round(amount * ratePercent / 100) where the percent has at most 6 decimals. */
const RATE_SCALE = 1_000_000; // 1% = 10_000 micro-percent units, 100% = 1_000_000
const microPercent = (percent: number) => Math.round(percent * 10_000);
const percentOf = (amount: number, micro: number) => roundDiv(amount * micro, RATE_SCALE);

/** Split `total` across `weights` proportionally; the remainder goes to the largest fractions (ties: earliest). Sum is exact. */
export function allocate(total: number, weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (total <= 0 || sum <= 0) return weights.map(() => 0);
  const T = BigInt(total); const S = BigInt(sum);
  const parts = weights.map((w) => (T * BigInt(w)) / S);
  const rems = weights.map((w, i) => ({ i, r: (T * BigInt(w)) % S }));
  let left = Number(T - parts.reduce((a, b) => a + b, 0n));
  rems.sort((a, b) => (a.r === b.r ? a.i - b.i : a.r > b.r ? -1 : 1));
  const out = parts.map(Number);
  for (const { i } of rems) { if (left <= 0) break; if (weights[i]! > 0) { out[i]! += 1; left -= 1; } }
  return out;
}

// --- types ------------------------------------------------------------------------------------------------------------

export interface PricingLine {
  id: number;
  unitPrice: number;
  quantity: number;
  taxable: boolean;
  requiresShipping: boolean;
  grams: number;
  productId: number;
  collectionIds: number[];
}

export interface PricingDiscount {
  id: number;
  code: string | null;
  title: string;
  valueType: 'PERCENTAGE' | 'FIXED_AMOUNT';
  /** Basis points (1000 = 10%) for PERCENTAGE, minor units for FIXED_AMOUNT. */
  value: number;
  target: 'ORDER' | 'PRODUCTS' | 'SHIPPING';
  appliesTo: { productIds?: number[]; collectionIds?: number[] };
}

export interface PricingTaxRate { name: string; countryCode: string; provinceCode: string | null; rate: number; appliesToShipping: boolean; priority: number }
export interface PricingShippingRate { id: number; name: string; price: number }

export interface PricingInput {
  lines: PricingLine[];
  discounts: PricingDiscount[];
  shipping: PricingShippingRate | null;
  taxRates: PricingTaxRate[];
  taxesIncluded: boolean;
  taxExempt?: boolean;
  country: string | null;
  province: string | null;
}

export interface PricedLine { id: number; subtotal: number; discount: number; /** After discounts (tax included when taxesIncluded). */ total: number; tax: number }
export interface TaxLine { title: string; rate: number; price: number; lineId: number | null; shipping: boolean }
export interface DiscountApplication { discountId: number; code: string | null; title: string; valueType: 'PERCENTAGE' | 'FIXED_AMOUNT'; value: number; target: PricingDiscount['target']; allocated: number }

export interface PricingResult {
  lines: PricedLine[];
  shipping: { rate: PricingShippingRate; price: number; discount: number; tax: number } | null;
  taxLines: TaxLine[];
  discountApplications: DiscountApplication[];
  subtotal: number;
  totalDiscounts: number;
  totalShipping: number;
  totalTax: number;
  total: number;
}

// --- discounts --------------------------------------------------------------------------------------------------------

/** Whether a discount's target includes the line. */
export function discountMatchesLine(d: PricingDiscount, l: PricingLine): boolean {
  if (d.target === 'ORDER') return true;
  if (d.target === 'SHIPPING') return false;
  const { productIds = [], collectionIds = [] } = d.appliesTo;
  return productIds.includes(l.productId) || l.collectionIds.some((c) => collectionIds.includes(c));
}

function amountFor(d: PricingDiscount, base: number): number {
  const raw = d.valueType === 'PERCENTAGE' ? percentOf(base, d.value * 100) : d.value; // bp -> micro-percent: x100
  return Math.max(0, Math.min(base, raw));
}

// --- shipping ---------------------------------------------------------------------------------------------------------

export interface ShippingRateRow { id: number; name: string; type: string; price: number; minValue: number | null; maxValue: number | null; position: number }

/** Rates of a zone that apply to a cart: PRICE_BASED compares the shippable subtotal (cents), WEIGHT_BASED the grams. */
export function matchShippingRates(rates: ShippingRateRow[], cart: { subtotal: number; grams: number }): PricingShippingRate[] {
  return rates
    .filter((r) => {
      const v = r.type === 'PRICE_BASED' ? cart.subtotal : r.type === 'WEIGHT_BASED' ? cart.grams : null;
      if (v === null) return true;
      return (r.minValue === null || v >= r.minValue) && (r.maxValue === null || v <= r.maxValue);
    })
    .sort((a, b) => a.position - b.position || a.id - b.id)
    .map((r) => ({ id: r.id, name: r.name, price: r.type === 'FREE' ? 0 : r.price }));
}

// --- taxes ------------------------------------------------------------------------------------------------------------

/** Rates that apply in a destination: country-wide ones plus those restricted to the province. Ordered by priority then name. */
export function applicableTaxRates(rates: PricingTaxRate[], country: string | null, province: string | null): PricingTaxRate[] {
  if (!country) return [];
  return rates
    .filter((r) => r.countryCode.toUpperCase() === country.toUpperCase() && (!r.provinceCode || r.provinceCode.toUpperCase() === (province ?? '').toUpperCase()))
    .sort((a, b) => a.priority - b.priority || a.name.localeCompare(b.name));
}

/** Tax on `base`: added on top, or extracted from a tax-inclusive amount (each rate separately, same rounding). */
function taxFor(base: number, rate: number, included: boolean, rates: PricingTaxRate[]): number {
  const micro = microPercent(rate);
  if (!included) return percentOf(base, micro);
  const totalMicro = rates.reduce((a, r) => a + microPercent(r.rate), 0);
  return roundDiv(base * micro, RATE_SCALE + totalMicro);
}

// --- main -------------------------------------------------------------------------------------------------------------

export function priceCheckout(input: PricingInput): PricingResult {
  const lines = input.lines;
  const remaining = lines.map((l) => l.unitPrice * l.quantity);
  const subtotals = [...remaining];
  const perLineDiscount = lines.map(() => 0);
  const applications: DiscountApplication[] = [];
  const shippingPrice = input.shipping?.price ?? 0;
  let shippingDiscount = 0;

  for (const d of input.discounts) {
    let allocated = 0;
    if (d.target === 'SHIPPING') {
      allocated = input.shipping ? amountFor(d, shippingPrice - shippingDiscount) : 0;
      shippingDiscount += allocated;
    } else {
      const idx = lines.map((l, i) => (discountMatchesLine(d, l) ? i : -1)).filter((i) => i >= 0);
      const base = idx.reduce((a, i) => a + remaining[i]!, 0);
      allocated = amountFor(d, base);
      const split = allocate(allocated, idx.map((i) => remaining[i]!));
      idx.forEach((i, k) => { remaining[i]! -= split[k]!; perLineDiscount[i]! += split[k]!; });
    }
    applications.push({ discountId: d.id, code: d.code, title: d.title, valueType: d.valueType, value: d.value, target: d.target, allocated });
  }

  const rates = input.taxExempt ? [] : applicableTaxRates(input.taxRates, input.country, input.province);
  const taxLines: TaxLine[] = [];
  const pricedLines: PricedLine[] = lines.map((l, i) => {
    let tax = 0;
    if (l.taxable) for (const r of rates) {
      const t = taxFor(remaining[i]!, r.rate, input.taxesIncluded, rates);
      if (t > 0) { taxLines.push({ title: r.name, rate: r.rate, price: t, lineId: l.id, shipping: false }); tax += t; }
    }
    return { id: l.id, subtotal: subtotals[i]!, discount: perLineDiscount[i]!, total: remaining[i]!, tax };
  });

  let shipping: PricingResult['shipping'] = null;
  if (input.shipping) {
    const net = shippingPrice - shippingDiscount;
    let tax = 0;
    for (const r of rates) if (r.appliesToShipping) {
      const t = taxFor(net, r.rate, input.taxesIncluded, rates.filter((x) => x.appliesToShipping));
      if (t > 0) { taxLines.push({ title: r.name, rate: r.rate, price: t, lineId: null, shipping: true }); tax += t; }
    }
    shipping = { rate: input.shipping, price: shippingPrice, discount: shippingDiscount, tax };
  }

  const subtotal = subtotals.reduce((a, b) => a + b, 0);
  const totalDiscounts = perLineDiscount.reduce((a, b) => a + b, 0) + shippingDiscount;
  const totalShipping = shipping ? shipping.price - shipping.discount : 0;
  const totalTax = taxLines.reduce((a, t) => a + t.price, 0);
  const total = subtotal - perLineDiscount.reduce((a, b) => a + b, 0) + totalShipping + (input.taxesIncluded ? 0 : totalTax);
  return { lines: pricedLines, shipping, taxLines, discountApplications: applications, subtotal, totalDiscounts, totalShipping, totalTax, total };
}
