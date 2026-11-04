import { describe, expect, it } from 'vitest';
import { allocate, applicableTaxRates, matchShippingRates, priceCheckout, roundDiv, type PricingDiscount, type PricingInput, type PricingLine, type PricingTaxRate } from './index';

const line = (id: number, unitPrice: number, quantity = 1, o: Partial<PricingLine> = {}): PricingLine =>
  ({ id, unitPrice, quantity, taxable: true, requiresShipping: true, grams: 100, productId: id, collectionIds: [], ...o });
const disc = (o: Partial<PricingDiscount>): PricingDiscount =>
  ({ id: 1, code: 'X', title: 'X', valueType: 'PERCENTAGE', value: 1000, target: 'ORDER', appliesTo: {}, ...o });
const vat: PricingTaxRate = { name: 'VAT', countryCode: 'FR', provinceCode: null, rate: 20, appliesToShipping: true, priority: 0 };
const base = (o: Partial<PricingInput> = {}): PricingInput => ({ lines: [line(1, 1000, 2)], discounts: [], shipping: null, taxRates: [], taxesIncluded: false, country: 'FR', province: null, ...o });

describe('rounding', () => {
  it('rounds halves up with exact integers', () => {
    expect(roundDiv(5, 10)).toBe(1); expect(roundDiv(4, 10)).toBe(0); expect(roundDiv(15, 10)).toBe(2); expect(roundDiv(0, 7)).toBe(0);
  });
  it('allocates exactly, remainder to largest fractions', () => {
    expect(allocate(100, [1, 1, 1])).toEqual([34, 33, 33]);
    expect(allocate(10, [3, 0, 7])).toEqual([3, 0, 7]);
    expect(allocate(0, [5, 5])).toEqual([0, 0]);
    const a = allocate(999, [333, 334, 1]); expect(a.reduce((x, y) => x + y, 0)).toBe(999);
  });
});

describe('totals without extras', () => {
  it('sums lines', () => {
    const r = priceCheckout(base({ lines: [line(1, 1000, 2), line(2, 550)] }));
    expect(r).toMatchObject({ subtotal: 2550, totalDiscounts: 0, totalShipping: 0, totalTax: 0, total: 2550 });
  });
});

describe('discounts', () => {
  it('percentage on the order, allocated across lines', () => {
    const r = priceCheckout(base({ lines: [line(1, 1000), line(2, 1000), line(3, 1000)], discounts: [disc({ value: 1000 })] }));
    expect(r.totalDiscounts).toBe(300);
    expect(r.lines.map((l) => l.discount)).toEqual([100, 100, 100]);
    expect(r.total).toBe(2700);
  });
  it('odd percentages round half up and sum exactly', () => {
    const r = priceCheckout(base({ lines: [line(1, 333), line(2, 333), line(3, 335)], discounts: [disc({ value: 1250 })] })); // 12.5% of 1001 = 125.125
    expect(r.totalDiscounts).toBe(125);
    expect(r.lines.reduce((a, l) => a + l.discount, 0)).toBe(125);
  });
  it('fixed amount is capped at the subtotal', () => {
    expect(priceCheckout(base({ discounts: [disc({ valueType: 'FIXED_AMOUNT', value: 500 })] })).total).toBe(1500);
    expect(priceCheckout(base({ discounts: [disc({ valueType: 'FIXED_AMOUNT', value: 99999 })] })).total).toBe(0);
  });
  it('product-targeted discounts only touch matching products and collections', () => {
    const lines = [line(1, 1000, 1, { productId: 10 }), line(2, 1000, 1, { productId: 20, collectionIds: [5] }), line(3, 1000, 1, { productId: 30 })];
    const r = priceCheckout(base({ lines, discounts: [disc({ target: 'PRODUCTS', value: 5000, appliesTo: { productIds: [10], collectionIds: [5] } })] }));
    expect(r.lines.map((l) => l.discount)).toEqual([500, 500, 0]);
  });
  it('stacked discounts apply to the remaining amount', () => {
    const r = priceCheckout(base({ lines: [line(1, 1000)], discounts: [disc({ value: 5000 }), disc({ id: 2, valueType: 'FIXED_AMOUNT', value: 800 })] }));
    expect(r.discountApplications.map((a) => a.allocated)).toEqual([500, 500]);
    expect(r.total).toBe(0);
  });
  it('free shipping discount zeroes shipping', () => {
    const r = priceCheckout(base({ shipping: { id: 1, name: 'Std', price: 490 }, discounts: [disc({ target: 'SHIPPING', value: 10000 })] }));
    expect(r.totalShipping).toBe(0); expect(r.totalDiscounts).toBe(490); expect(r.total).toBe(2000);
  });
});

describe('taxes', () => {
  it('adds tax on top, including shipping when the rate applies to it', () => {
    const r = priceCheckout(base({ taxRates: [vat], shipping: { id: 1, name: 'Std', price: 500 } }));
    expect(r.taxLines.map((t) => [t.price, t.shipping])).toEqual([[400, false], [100, true]]);
    expect(r.totalTax).toBe(500); expect(r.total).toBe(2000 + 500 + 500);
  });
  it('does not tax shipping when the rate says no', () => {
    const r = priceCheckout(base({ taxRates: [{ ...vat, appliesToShipping: false }], shipping: { id: 1, name: 'Std', price: 500 } }));
    expect(r.totalTax).toBe(400); expect(r.total).toBe(2900);
  });
  it('extracts tax from tax-inclusive prices without changing the total', () => {
    const r = priceCheckout(base({ taxRates: [vat], taxesIncluded: true, lines: [line(1, 1200)], shipping: { id: 1, name: 'Std', price: 600 } }));
    expect(r.totalTax).toBe(300); // 200 + 100
    expect(r.total).toBe(1800);
  });
  it('taxes the discounted amount and skips non-taxable lines and exempt customers', () => {
    const r = priceCheckout(base({ taxRates: [vat], lines: [line(1, 1000), line(2, 1000, 1, { taxable: false })], discounts: [disc({ value: 5000 })] }));
    expect(r.lines.map((l) => l.tax)).toEqual([100, 0]);
    expect(priceCheckout(base({ taxRates: [vat], taxExempt: true })).totalTax).toBe(0);
  });
  it('combines country and province rates, picks by destination', () => {
    const qst: PricingTaxRate = { name: 'QST', countryCode: 'CA', provinceCode: 'QC', rate: 9.975, appliesToShipping: false, priority: 1 };
    const gst: PricingTaxRate = { name: 'GST', countryCode: 'CA', provinceCode: null, rate: 5, appliesToShipping: false, priority: 0 };
    expect(applicableTaxRates([qst, gst], 'ca', 'QC').map((r) => r.name)).toEqual(['GST', 'QST']);
    expect(applicableTaxRates([qst, gst], 'CA', 'ON').map((r) => r.name)).toEqual(['GST']);
    expect(applicableTaxRates([qst, gst], 'US', null)).toEqual([]);
    const r = priceCheckout(base({ lines: [line(1, 10000)], taxRates: [qst, gst], country: 'CA', province: 'QC' }));
    expect(r.taxLines.map((t) => t.price)).toEqual([500, 998]); // 997.5 rounds half up
  });
});

describe('shipping rates', () => {
  const rates = [
    { id: 1, name: 'Light', type: 'WEIGHT_BASED', price: 300, minValue: 0, maxValue: 500, position: 0 },
    { id: 2, name: 'Heavy', type: 'WEIGHT_BASED', price: 900, minValue: 501, maxValue: null, position: 1 },
    { id: 3, name: 'Std', type: 'PRICE_BASED', price: 490, minValue: null, maxValue: 4999, position: 2 },
    { id: 4, name: 'Free', type: 'PRICE_BASED', price: 0, minValue: 5000, maxValue: null, position: 3 },
    { id: 5, name: 'Flat', type: 'FLAT', price: 700, minValue: 100000, maxValue: null, position: 4 },
  ];
  it('filters by weight and price conditions; flat rates ignore them', () => {
    expect(matchShippingRates(rates, { subtotal: 3000, grams: 400 }).map((r) => r.name)).toEqual(['Light', 'Std', 'Flat']);
    expect(matchShippingRates(rates, { subtotal: 6000, grams: 800 }).map((r) => r.name)).toEqual(['Heavy', 'Free', 'Flat']);
  });
});
