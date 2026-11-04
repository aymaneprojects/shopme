import { describe, expect, it } from 'vitest';
import { calcRefund, clampQuantity, fromCents, toCents } from './refund';
import type { RefundLine } from './refund';

const lines: RefundLine[] = [
  { id: 'a', quantity: 3, refundableQuantity: 3, discountedTotalCents: 3000 },
  { id: 'b', quantity: 2, refundableQuantity: 1, discountedTotalCents: 1999 },
];

describe('refund calculation', () => {
  it('converts money without float drift', () => {
    expect(toCents('19.99')).toBe(1999);
    expect(toCents('0.1') + toCents('0.2')).toBe(30);
    expect(fromCents(1050)).toBe('10.50');
  });

  it('clamps quantities to what is still refundable', () => {
    expect(clampQuantity(lines[1]!, 5)).toBe(1);
    expect(clampQuantity(lines[0]!, -2)).toBe(0);
    expect(clampQuantity(lines[0]!, 1.9)).toBe(1);
  });

  it('sums selected items and shipping', () => {
    const r = calcRefund({ lines, quantities: { a: 2, b: 1 }, shippingRefundCents: 500, shippingCents: 500, refundableCents: 100000 });
    expect(r).toEqual({ itemsCents: 2000 + 1000, shippingCents: 500, totalCents: 3500, capped: false });
  });

  it('returns the exact line total when the whole line is refunded', () => {
    const r = calcRefund({ lines: [{ id: 'x', quantity: 3, refundableQuantity: 3, discountedTotalCents: 1000 }], quantities: { x: 3 }, shippingRefundCents: 0, shippingCents: 0, refundableCents: 1000 });
    expect(r.itemsCents).toBe(1000);
  });

  it('never refunds more than the shipping paid or the refundable balance', () => {
    const r = calcRefund({ lines, quantities: { a: 3 }, shippingRefundCents: 9000, shippingCents: 500, refundableCents: 3200 });
    expect(r.shippingCents).toBe(500);
    expect(r.totalCents).toBe(3200);
    expect(r.capped).toBe(true);
  });
});
