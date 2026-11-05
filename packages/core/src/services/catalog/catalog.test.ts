import { describe, expect, it } from 'vitest';
import { normalizeTags } from './common';
import { ruleMatches } from './collections';
import { parseSearch } from './search';
import { editDistance, tokenize } from './storefront-search';
import { getCategory, searchCategories } from './taxonomy';
import { validateMetafieldValue } from './metafields';

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

describe('storefront search helpers', () => {
  it('tokenizes on letters and digits, keeping accents', () => {
    expect(tokenize('Café-au-lait, 250g!')).toEqual(['café', 'au', 'lait', '250g']);
    expect(tokenize('  ')).toEqual([]);
  });
  it('measures edit distance with transpositions', () => {
    expect(editDistance('espreso', 'espresso')).toBe(1);
    expect(editDistance('cofee', 'coffee')).toBe(1);
    expect(editDistance('teh', 'the')).toBe(1);
    expect(editDistance('tea', 'coffee')).toBeGreaterThan(2);
  });
});

describe('taxonomy', () => {
  it('finds categories by full name and by id', () => {
    expect(searchCategories('shoes').map((c) => c.fullName)).toEqual(['Apparel & Accessories > Shoes']);
    expect(getCategory(searchCategories('shoes')[0]!.id)?.name).toBe('Shoes');
    expect(getCategory('nope')).toBeNull();
    expect(searchCategories().length).toBeGreaterThan(20);
  });
});

describe('metafield value validation', () => {
  it('checks the types the definitions editor offers', () => {
    expect(validateMetafieldValue('number_integer', '3.5')).toMatch(/integer/);
    expect(validateMetafieldValue('color', '#00ff00')).toBeNull();
    expect(validateMetafieldValue('list.single_line_text_field', '["a"]')).toBeNull();
    expect(validateMetafieldValue('list.single_line_text_field', 'a')).toMatch(/array/);
    expect(validateMetafieldValue('nope', 'x')).toMatch(/not a valid/);
  });
});
