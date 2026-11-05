import { describe, expect, it } from 'vitest';
import { invalidCount, isValid, planBulk, setEdit } from './bulk-edit';
import type { BulkVariant } from './bulk-edit';

const row = (over: Partial<BulkVariant> = {}): BulkVariant => ({ productId: 'p1', variantId: 'v1', inventoryItemId: 'i1', tracked: true, stocked: true, sku: 'A', price: '10.00', compareAtPrice: '', cost: '4.00', quantity: '5', ...over });

describe('bulk editor', () => {
  it('validates cells per column', () => {
    expect(isValid('price', '12.5')).toBe(true);
    expect(isValid('price', '')).toBe(false);
    expect(isValid('compareAtPrice', '')).toBe(true);
    expect(isValid('cost', '-1')).toBe(false);
    expect(isValid('quantity', '3.5')).toBe(false);
    expect(isValid('quantity', '12')).toBe(true);
  });

  it('keeps only real changes', () => {
    const rows = [row()];
    let e = setEdit({}, rows, 'v1', 'price', '11');
    expect(e).toEqual({ v1: { price: '11' } });
    e = setEdit(e, rows, 'v1', 'price', '10.00');
    expect(e).toEqual({});
    expect(invalidCount(setEdit({}, rows, 'v1', 'quantity', 'x'))).toBe(1);
  });

  it('plans one update per product and quantity changes only for stocked, tracked variants', () => {
    const rows = [row(), row({ variantId: 'v2', inventoryItemId: 'i2' }), row({ productId: 'p2', variantId: 'v3', inventoryItemId: 'i3', tracked: false }), row({ productId: 'p2', variantId: 'v4', inventoryItemId: 'i4', stocked: false })];
    const plan = planBulk(rows, { v1: { price: '12', sku: ' X ' }, v2: { compareAtPrice: '', cost: '5' }, v3: { quantity: '9', price: '1.5' }, v4: { quantity: '2' } }, 'loc1');
    expect(plan.variants).toEqual([
      { productId: 'p1', variants: [{ id: 'v1', price: '12.00', inventoryItem: { sku: 'X' } }, { id: 'v2', compareAtPrice: null, inventoryItem: { cost: '5.00' } }] },
      { productId: 'p2', variants: [{ id: 'v3', price: '1.50' }] },
    ]);
    expect(plan.quantities).toEqual([]);
    expect(planBulk(rows, { v1: { quantity: '8' } }, 'loc1')).toEqual({ variants: [], quantities: [{ inventoryItemId: 'i1', locationId: 'loc1', quantity: 8 }] });
  });
});
