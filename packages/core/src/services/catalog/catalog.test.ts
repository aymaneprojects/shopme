import { describe, expect, it } from 'vitest';
import { normalizeTags } from './common';
import { ruleMatches } from './collections';
import { parseSearch } from './search';

describe('search parser', () => {
  it('parses fields, negation, operators, quotes and OR groups', () => {
    expect(parseSearch('title:snow -status:draft')).toEqual([[
      { field: 'title', op: ':', value: 'snow', negate: false }, { field: 'status', op: ':', value: 'draft', negate: true },
    ]]);
    expect(parseSearch('inventory_total:>=5 "red hoodie"')).toEqual([[
      { field: 'inventory_total', op: '>=', value: '5', negate: false }, { field: null, op: ':', value: 'red hoodie', negate: false },
    ]]);
    expect(parseSearch('tag:a OR tag:b AND vendor:c').map((g) => g.length)).toEqual([1, 2]);
    expect(parseSearch('   ')).toEqual([]);
  });
});

describe('tags', () => {
  it('trims, dedupes case-insensitively and sorts', () => {
    expect(normalizeTags([' b', 'a,c', 'B', ''])).toEqual(['a', 'b', 'c']);
  });
});

describe('smart collection rules', () => {
  const p = { id: 1, title: 'Red Snowboard', vendor: 'Snow Co', productType: 'Board', tags: ['Winter', 'sale'], variants: [{ price: 50000, compareAt: 60000, title: 'Default Title', qty: 4, weightKg: 2 }] };
  const ctx = { exp: 2, weightFactor: 0.45359237 }; // shop weight unit: pounds
  const m = (column: string, relation: string, condition: string) => ruleMatches(p, { column, relation, condition }, ctx);
  it('matches text columns', () => {
    expect(m('TITLE', 'CONTAINS', 'snow')).toBe(true);
    expect(m('TITLE', 'STARTS_WITH', 'red')).toBe(true);
    expect(m('VENDOR', 'EQUALS', 'SNOW CO')).toBe(true);
    expect(m('TYPE', 'NOT_EQUALS', 'board')).toBe(false);
    expect(m('TAG', 'EQUALS', 'winter')).toBe(true);
    expect(m('TAG', 'NOT_CONTAINS', 'win')).toBe(false);
    expect(m('TAG', 'IS_SET', '')).toBe(true);
  });
  it('matches numeric columns in major units and the shop weight unit', () => {
    expect(m('VARIANT_PRICE', 'EQUALS', '500')).toBe(true);
    expect(m('VARIANT_PRICE', 'GREATER_THAN', '499.99')).toBe(true);
    expect(m('VARIANT_COMPARE_AT_PRICE', 'LESS_THAN', '599')).toBe(false);
    expect(m('VARIANT_INVENTORY', 'LESS_THAN', '5')).toBe(true);
    expect(m('VARIANT_WEIGHT', 'GREATER_THAN', '4.4')).toBe(true); // 2 kg = 4.41 lb
    expect(m('IS_PRICE_REDUCED', 'EQUALS', 'true')).toBe(true);
  });
});
