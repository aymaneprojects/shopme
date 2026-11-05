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
    expect(Object.keys(input).sort()).toEqual(['appliesOncePerCustomer', 'code', 'combinesWith', 'context', 'customerGets', 'endsAt', 'minimumRequirement', 'shopmePublicationIds', 'startsAt', 'tags', 'title', 'usageLimit']);
    expect(input.context).toEqual({ all: 'ALL' });
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

describe('automatic and buy-X-get-Y discounts', () => {
  const bxgy = () => {
    const f = blankDiscount('bxgy', 'automatic');
    f.title = 'Buy 2 get 1'; f.startsAt = '2026-06-01T10:00';
    f.bxgy = { ...f.bxgy, buyQty: '2', buyProducts: [{ id: 'gid://shopify/Product/1', title: 'A' }], getQty: '1', getProducts: [{ id: 'gid://shopify/Product/2', title: 'B' }] };
    return f;
  };

  it('automatic discounts need a title instead of a code and carry no code fields', () => {
    const f = { ...blankDiscount('order', 'automatic'), value: '10' };
    expect(validateDiscount(f).title).toBe('discount.err.titleRequired');
    expect(validateDiscount(f).code).toBeUndefined();
    const input = toDiscountInput({ ...f, title: 'Summer sale', startsAt: '2026-06-01T10:00' }) as Record<string, unknown>;
    expect(input).toMatchObject({ title: 'Summer sale' });
    expect(Object.keys(input)).not.toContain('code');
    expect(Object.keys(input)).not.toContain('usageLimit');
  });

  it('validates the buy and get sides', () => {
    expect(validateDiscount(bxgy())).toEqual({});
    const bad = { ...blankDiscount('bxgy'), code: 'BXGY' };
    expect(validateDiscount(bad)).toMatchObject({ buyTargets: 'discount.err.targets', getTargets: 'discount.err.targets' });
    expect(validateDiscount({ ...bxgy(), bxgy: { ...bxgy().bxgy, buyQty: '0' } }).buyQty).toBe('discount.err.quantity');
    expect(validateDiscount({ ...bxgy(), bxgy: { ...bxgy().bxgy, getEffect: 'percentage', getPercent: '120' } }).getPercent).toBe('discount.err.percentMax');
  });

  it('maps to the BXGY inputs and back (free = 100%)', () => {
    const input = toDiscountInput({ ...bxgy(), bxgy: { ...bxgy().bxgy, hasUsesLimit: true, usesLimit: '3' } }) as Record<string, any>;
    expect(input.customerBuys).toEqual({ value: { quantity: '2' }, items: { products: { productsToAdd: ['gid://shopify/Product/1'] } } });
    expect(input.customerGets.value.discountOnQuantity).toEqual({ quantity: '1', effect: { percentage: 1 } });
    expect(input.usesPerOrderLimit).toBe('3'); // UnsignedInt64 on automatic discounts
    const back = fromDiscountNode({
      __typename: 'DiscountAutomaticBxgy', title: 'Half price', startsAt: '2026-06-01T10:00:00Z', endsAt: null, combinesWith: { productDiscounts: true, orderDiscounts: false, shippingDiscounts: false },
      usesPerOrderAuto: null, customerBuys: { value: { quantity: '2' }, items: { __typename: 'DiscountCollections', collections: { nodes: [{ id: 'c1', title: 'Coffee' }] } } },
      customerGets: { value: { __typename: 'DiscountOnQuantity', quantity: { quantity: '1' }, effect: { __typename: 'DiscountPercentage', percentage: 0.5 } }, items: { __typename: 'DiscountProducts', products: { nodes: [{ id: 'p1', title: 'Mug' }] } } },
    });
    expect(back).toMatchObject({ kind: 'bxgy', method: 'automatic', title: 'Half price', combines: { productDiscounts: true } });
    expect(back.bxgy).toMatchObject({ buyQty: '2', buyAppliesTo: 'collections', getAppliesTo: 'products', getEffect: 'percentage', getPercent: '50', getQty: '1' });
  });
});

describe('discount eligibility and tags', () => {
  const base = () => ({ ...blankDiscount('order'), code: 'VIP', value: '10', startsAt: '2026-06-01T10:00' });
  it('requires a selection for segments and customers', () => {
    expect(validateDiscount({ ...base(), eligibility: 'segments' }).eligibility).toBe('discount.err.segments');
    expect(validateDiscount({ ...base(), eligibility: 'customers' }).eligibility).toBe('discount.err.customers');
    expect(validateDiscount({ ...base(), eligibility: 'customers', customers: [{ id: 'gid://shopify/Customer/1', title: 'Ada' }] }).eligibility).toBeUndefined();
  });
  it('sends only the segments and customers added or removed, plus tags, and reads them back', () => {
    const f = { ...base(), eligibility: 'segments' as const, segments: [{ id: 'gid://shopify/ShopmeCustomerSegment/2', title: 'B' }], tags: ['vip'] };
    const input = toDiscountInput(f, { collections: [], products: [], segments: ['gid://shopify/ShopmeCustomerSegment/1'] }) as Record<string, unknown>;
    expect(input.context).toEqual({ customerSegments: { add: ['gid://shopify/ShopmeCustomerSegment/2'], remove: ['gid://shopify/ShopmeCustomerSegment/1'] } });
    expect(input.tags).toEqual(['vip']);
    const back = fromDiscountNode({
      __typename: 'DiscountCodeBasic', title: 'VIP', startsAt: '2026-06-01T10:00:00Z', endsAt: null, combinesWith: { productDiscounts: false, orderDiscounts: false, shippingDiscounts: false },
      tags: ['vip'], context: { __typename: 'DiscountCustomers', customers: [{ id: 'gid://shopify/Customer/7', displayName: 'Ada' }] },
    });
    expect(back).toMatchObject({ eligibility: 'customers', customers: [{ id: 'gid://shopify/Customer/7', title: 'Ada' }], tags: ['vip'] });
  });
});
