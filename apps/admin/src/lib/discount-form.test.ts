import { describe, expect, it } from 'vitest';
import { blankDiscount, fromDiscountNode, generateCode, toDiscountInput, validateDiscount } from './discount-form';

const valid = () => ({ ...blankDiscount('order'), code: 'SUMMER10', value: '10', startsAt: '2026-06-01T10:00' });

describe('discount form validation', () => {
  it('accepts a valid order percentage discount', () => {
    expect(validateDiscount(valid())).toEqual({});
  });

  it('requires a code without spaces', () => {
    expect(validateDiscount({ ...valid(), code: '' }).code).toBe('discount.err.codeRequired');
    expect(validateDiscount({ ...valid(), code: 'A B' }).code).toBe('discount.err.codeSpaces');
  });

  it('requires a positive value and caps percentages at 100', () => {
    expect(validateDiscount({ ...valid(), value: '0' }).value).toBe('discount.err.valuePositive');
    expect(validateDiscount({ ...valid(), value: '' }).value).toBe('discount.err.valuePositive');
    expect(validateDiscount({ ...valid(), value: '101' }).value).toBe('discount.err.percentMax');
    expect(validateDiscount({ ...valid(), valueType: 'fixed', value: '150,5' }).value).toBeUndefined();
  });

  it('requires targets when scoped to collections or products', () => {
    const f = { ...valid(), kind: 'product' as const, appliesTo: 'collections' as const };
    expect(validateDiscount(f).targets).toBe('discount.err.targets');
    expect(validateDiscount({ ...f, collections: [{ id: 'gid://shopify/Collection/1', title: 'Sale' }] }).targets).toBeUndefined();
  });

  it('validates minimums, usage limit and dates', () => {
    expect(validateDiscount({ ...valid(), minType: 'subtotal', minValue: '' }).minValue).toBe('discount.err.minValue');
    expect(validateDiscount({ ...valid(), minType: 'quantity', minValue: '1.5' }).minValue).toBe('discount.err.minValue');
    expect(validateDiscount({ ...valid(), limitTotal: true, usageLimit: '0' }).usageLimit).toBe('discount.err.usageLimit');
    expect(validateDiscount({ ...valid(), hasEnd: true, endsAt: '2026-05-01T10:00' }).endsAt).toBe('discount.err.endAfterStart');
    expect(validateDiscount({ ...valid(), hasEnd: true, endsAt: '2026-07-01T10:00' }).endsAt).toBeUndefined();
  });

  it('does not require a value for free shipping', () => {
    expect(validateDiscount({ ...blankDiscount('shipping'), code: 'SHIPFREE' })).toEqual({});
    expect(validateDiscount({ ...blankDiscount('shipping'), code: 'SHIPFREE', hasMaxShipping: true, maxShipping: '-1' }).maxShipping).toBe('discount.err.maxShipping');
  });
});

describe('discount input mapping', () => {
  it('maps a percentage to a 0-1 fraction and round-trips from the API node', () => {
    const input = toDiscountInput({ ...valid(), minType: 'subtotal', minValue: '50' }) as Record<string, unknown>;
    expect(input.customerGets).toEqual({ value: { percentage: 0.1 }, items: { all: true } });
    // DiscountCodeBasicInput has no `customerSelection` (server rejects the variable); only API-defined keys are sent
    expect(Object.keys(input).sort()).toEqual(['appliesOncePerCustomer', 'code', 'combinesWith', 'customerGets', 'endsAt', 'minimumRequirement', 'startsAt', 'title', 'usageLimit']);
    expect(input.minimumRequirement).toEqual({ subtotal: { greaterThanOrEqualToSubtotal: '50.00' } });
    const back = fromDiscountNode({
      __typename: 'DiscountCodeBasic', title: 'SUMMER10', startsAt: '2026-06-01T10:00:00Z', endsAt: null, usageLimit: 5, appliesOncePerCustomer: true,
      codes: { nodes: [{ code: 'SUMMER10' }] }, combinesWith: { productDiscounts: false, orderDiscounts: true, shippingDiscounts: false },
      minimumRequirement: { __typename: 'DiscountMinimumQuantity', greaterThanOrEqualToQuantity: '3' },
      customerGets: { value: { __typename: 'DiscountPercentage', percentage: 0.125 }, items: { __typename: 'AllDiscountItems' } },
    });
    expect(back).toMatchObject({ code: 'SUMMER10', value: '12.5', valueType: 'percentage', minType: 'quantity', minValue: '3', limitTotal: true, usageLimit: '5', oncePerCustomer: true });
  });

  it('diffs product targets on update and generates readable codes', () => {
    const f = { ...valid(), kind: 'product' as const, appliesTo: 'products' as const, products: [{ id: 'p2', title: 'B' }] };
    const input = toDiscountInput(f, { collections: [], products: ['p1'] }) as Record<string, unknown>;
    expect(input.customerGets).toMatchObject({ items: { products: { productsToAdd: ['p2'], productsToRemove: ['p1'] } } });
    expect(generateCode(8, () => 0)).toBe('AAAAAAAA');
    expect(generateCode()).toMatch(/^[A-Z2-9]{10}$/);
  });
});
