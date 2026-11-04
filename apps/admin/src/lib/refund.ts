// Refund amount helper. All math is done in integer cents to avoid float drift.

export const toCents = (amount: string | number | null | undefined) => Math.round(Number(amount ?? 0) * 100);
export const fromCents = (cents: number) => (cents / 100).toFixed(2);

export interface RefundLine {
  id: string;
  /** Quantity still refundable on this line. */
  refundableQuantity: number;
  /** Original quantity ordered (used to derive the per-unit discounted price). */
  quantity: number;
  /** Line total after discounts, in cents. */
  discountedTotalCents: number;
}

export interface RefundInput {
  lines: RefundLine[];
  /** Selected quantity per line id. */
  quantities: Record<string, number>;
  /** Shipping amount to refund, in cents (clamped to `shippingCents`). */
  shippingRefundCents: number;
  shippingCents: number;
  /** Paid minus already refunded, in cents: the refund can never exceed it. */
  refundableCents: number;
}

export interface RefundResult { itemsCents: number; shippingCents: number; totalCents: number; capped: boolean }

export const clampQuantity = (line: RefundLine, q: number) => Math.max(0, Math.min(line.refundableQuantity, Math.floor(Number.isFinite(q) ? q : 0)));

/** Per-unit price after discounts, rounded to the cent. */
export const unitCents = (line: RefundLine) => (line.quantity > 0 ? Math.round(line.discountedTotalCents / line.quantity) : 0);

export function calcRefund(input: RefundInput): RefundResult {
  const itemsCents = input.lines.reduce((sum, l) => {
    const q = clampQuantity(l, input.quantities[l.id] ?? 0);
    // Refunding every remaining unit of a fully-selected, never-refunded line returns the exact line total (no rounding loss).
    return sum + (q === l.quantity ? l.discountedTotalCents : q * unitCents(l));
  }, 0);
  const shippingCents = Math.max(0, Math.min(input.shippingCents, input.shippingRefundCents));
  const uncapped = itemsCents + shippingCents;
  const totalCents = Math.max(0, Math.min(uncapped, input.refundableCents));
  return { itemsCents, shippingCents, totalCents, capped: totalCents < uncapped };
}
