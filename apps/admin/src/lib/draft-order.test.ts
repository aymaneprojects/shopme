import { describe, expect, it } from 'vitest';
import { blankDraft, estimateTotals, toDraftInput, totalsFromCalculation, totalsRows } from './draft-order';
import type { DraftForm } from './draft-order';

const form: DraftForm = { ...blankDraft, lines: [{ key: '1', variantId: 'gid://v/1', title: 'Candle', price: '18.00', quantity: 2 }, { key: '2', title: 'Custom engraving', price: '5,5', quantity: 1 }] };

describe('draft totals', () => {
  it('estimates subtotal, percentage discount and shipping', () => {
    expect(estimateTotals(form)).toMatchObject({ subtotal: 41.5, discount: 0, total: 41.5 });
    const t = estimateTotals({ ...form, discount: { valueType: 'PERCENTAGE', value: '10' }, shipping: { title: 'Post', price: '4.90' } });
    expect(t).toMatchObject({ discount: 4.15, shipping: 4.9, total: 42.25 });
  });
  it('never discounts below zero', () => { expect(estimateTotals({ ...form, discount: { valueType: 'FIXED_AMOUNT', value: '100' } }).total).toBe(0); });
  it('shows discount negative, hides zero tax, flags free shipping', () => {
    const rows = totalsRows({ subtotal: 40, discount: 4, shipping: 0, tax: 0, total: 36 }, true);
    expect(rows.map((r) => r.key)).toEqual(['subtotal', 'discount', 'shipping', 'total']);
    expect(rows[1]!.amount).toBe(-4);
    expect(rows[2]!.free).toBe(true);
    expect(totalsRows({ subtotal: 40, discount: 0, shipping: 0, tax: 6.67, total: 40 }, false).map((r) => r.key)).toEqual(['subtotal', 'tax', 'total']);
  });
  it('reads a server calculation', () => {
    const m = (a: string) => ({ shopMoney: { amount: a, currencyCode: 'EUR' } });
    expect(totalsFromCalculation({ subtotalPriceSet: m('40.00'), totalDiscountsSet: null, totalTaxSet: m('6.67'), totalPriceSet: m('40.00') })).toMatchObject({ subtotal: 40, tax: 6.67, currency: 'EUR' });
  });
});

describe('toDraftInput', () => {
  it('maps variant and custom lines, prefers customerId over email', () => {
    const i = toDraftInput({ ...form, email: 'a@b.c', customerId: 'gid://c/1', discount: { valueType: 'FIXED_AMOUNT', value: '3' } });
    expect(i.lineItems).toEqual([{ variantId: 'gid://v/1', quantity: 2 }, { title: 'Custom engraving', originalUnitPrice: '5.50', quantity: 1 }]);
    expect(i).toMatchObject({ customerId: 'gid://c/1', appliedDiscount: { valueType: 'FIXED_AMOUNT', value: 3 } });
    expect(i).not.toHaveProperty('email');
  });
});

describe('toDraftInput: purchase order number and market', () => {
  it('sends the PO number and market, and clears them when emptied', () => {
    expect(toDraftInput({ ...form, poNumber: ' PO-7 ', marketId: 'gid://shopify/Market/2' })).toMatchObject({ poNumber: 'PO-7', shopmeMarketId: 'gid://shopify/Market/2' });
    expect(toDraftInput({ ...form, poNumber: '', marketId: '' })).toMatchObject({ poNumber: null, shopmeMarketId: null });
  });
  it('leaves them out for forms that do not carry them', () => {
    const i = toDraftInput({ ...form, poNumber: undefined, marketId: undefined });
    expect(i).not.toHaveProperty('poNumber');
    expect(i).not.toHaveProperty('shopmeMarketId');
  });
});
