// Draft order form -> DraftOrderInput, local estimate, and the totals rows shown under the line items.
import { parseDecimal } from '../format';

export interface DraftLine { key: string; variantId?: string; title: string; variantTitle?: string; price: string; quantity: number }
export interface DraftDiscount { valueType: 'FIXED_AMOUNT' | 'PERCENTAGE'; value: string }
export interface DraftForm {
  lines: DraftLine[]; discount: DraftDiscount | null; shipping: { title: string; price: string } | null;
  customerId: string; email: string; note: string; tags: string[];
}
export const blankDraft: DraftForm = { lines: [], discount: null, shipping: null, customerId: '', email: '', note: '', tags: [] };

export interface Totals { subtotal: number; discount: number; shipping: number; tax: number; total: number; currency?: string }
export interface TotalsRow { key: 'subtotal' | 'discount' | 'shipping' | 'tax' | 'total'; amount: number; free?: boolean }

const num = (s: string) => parseDecimal(s) ?? 0;
const round = (n: number) => Math.round(n * 100) / 100;

export function toDraftInput(f: DraftForm) {
  return {
    lineItems: f.lines.map((l) => (l.variantId ? { variantId: l.variantId, quantity: l.quantity } : { title: l.title, originalUnitPrice: num(l.price).toFixed(2), quantity: l.quantity })),
    ...(f.discount && num(f.discount.value) > 0 && { appliedDiscount: { valueType: f.discount.valueType, value: num(f.discount.value) } }),
    ...(f.customerId && { customerId: f.customerId }),
    ...(!f.customerId && f.email.trim() && { email: f.email.trim() }),
    ...(f.shipping && { shippingLine: { title: f.shipping.title.trim() || 'Shipping', price: num(f.shipping.price).toFixed(2) } }),
    note: f.note, tags: f.tags,
  };
}

/** Client-side estimate used before the server calculation answers (no tax). */
export function estimateTotals(f: DraftForm): Totals {
  const subtotal = round(f.lines.reduce((s, l) => s + num(l.price) * l.quantity, 0));
  const v = f.discount ? num(f.discount.value) : 0;
  const discount = round(Math.min(subtotal, f.discount?.valueType === 'PERCENTAGE' ? (subtotal * Math.min(v, 100)) / 100 : v));
  const shipping = round(f.shipping ? num(f.shipping.price) : 0);
  return { subtotal, discount, shipping, tax: 0, total: round(subtotal - discount + shipping) };
}

interface MoneySetLike { shopMoney: { amount: string; currencyCode: string } }
export interface CalculatedDraft { subtotalPriceSet: MoneySetLike; totalDiscountsSet?: MoneySetLike | null; totalShippingPriceSet?: MoneySetLike | null; totalTaxSet?: MoneySetLike | null; totalPriceSet: MoneySetLike }
export function totalsFromCalculation(c: CalculatedDraft): Totals {
  const n = (m?: MoneySetLike | null) => Number(m?.shopMoney.amount ?? 0);
  return { subtotal: n(c.subtotalPriceSet), discount: n(c.totalDiscountsSet), shipping: n(c.totalShippingPriceSet), tax: n(c.totalTaxSet), total: n(c.totalPriceSet), currency: c.totalPriceSet.shopMoney.currencyCode };
}

/** Rows to display: discount (as a negative) and tax only when non-zero; shipping only when a shipping line is set. */
export function totalsRows(t: Totals, hasShipping: boolean): TotalsRow[] {
  const rows: TotalsRow[] = [{ key: 'subtotal', amount: t.subtotal }];
  if (t.discount > 0) rows.push({ key: 'discount', amount: -t.discount });
  if (hasShipping) rows.push({ key: 'shipping', amount: t.shipping, free: t.shipping === 0 });
  if (t.tax > 0) rows.push({ key: 'tax', amount: t.tax });
  rows.push({ key: 'total', amount: t.total });
  return rows;
}
