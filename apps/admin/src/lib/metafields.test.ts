import { describe, expect, it } from 'vitest';
import { changedInputs, fromField, inputKind, toField } from './metafields';

describe('metafield form conversion', () => {
  it('picks an editor per type', () => {
    expect(inputKind('single_line_text_field')).toBe('text');
    expect(inputKind('multi_line_text_field')).toBe('multiline');
    expect(inputKind('number_decimal')).toBe('number');
    expect(inputKind('boolean')).toBe('boolean');
    expect(inputKind('list.single_line_text_field')).toBe('list');
    expect(inputKind('product_reference')).toBe('text');
  });

  it('shows lists one per line and stores them as a JSON array', () => {
    expect(toField('list.single_line_text_field', '["a","b"]')).toBe('a\nb');
    expect(fromField('list.single_line_text_field', 'a\n\n b \n')).toBe('["a","b"]');
    expect(fromField('list.number_integer', '1\n2')).toBe('[1,2]');
  });

  it('round-trips JSON and date times', () => {
    expect(toField('json', '{"a":1}')).toBe('{\n  "a": 1\n}');
    expect(fromField('json', '{\n  "a": 1\n}')).toBe('{"a":1}');
    expect(toField('date_time', '2026-11-05T10:30:00Z')).toBe('2026-11-05T10:30');
    expect(fromField('date_time', '2026-11-05T10:30Z')).toBe('2026-11-05T10:30Z');
  });

  it('only submits changed, non-empty fields', () => {
    const fields = {
      'custom.a': { namespace: 'custom', key: 'a', type: 'single_line_text_field', value: 'new' },
      'custom.b': { namespace: 'custom', key: 'b', type: 'single_line_text_field', value: 'same' },
      'custom.c': { namespace: 'custom', key: 'c', type: 'list.single_line_text_field', value: 'x\ny' },
      'custom.d': { namespace: 'custom', key: 'd', type: 'single_line_text_field', value: '' },
    };
    expect(changedInputs('gid://shopify/Product/1', fields, { 'custom.a': 'old', 'custom.b': 'same', 'custom.d': 'was set' })).toEqual([
      { ownerId: 'gid://shopify/Product/1', namespace: 'custom', key: 'a', type: 'single_line_text_field', value: 'new' },
      { ownerId: 'gid://shopify/Product/1', namespace: 'custom', key: 'c', type: 'list.single_line_text_field', value: '["x","y"]' },
    ]);
  });
});
