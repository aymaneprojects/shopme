import { describe, expect, it } from 'vitest';
import { choicesToText, definitionIdsOf, draftOf, emptyField, fieldType, parseList, previewValues, serializeList, slugKey, textToChoices, validationInputs, validationSpecs } from './metaobjects';

describe('metaobject helpers', () => {
  it('derives types and keys from names', () => {
    expect(slugKey('Cart upsell')).toBe('cart_upsell');
    expect(slugKey('  Couleurs de tissu é ')).toBe('couleurs_de_tissu_e');
  });

  it('offers validations per type, with list limits for lists', () => {
    expect(validationSpecs('single_line_text_field').map((s) => s.name)).toEqual(['min', 'max', 'regex', 'choices']);
    expect(validationSpecs('list.number_integer').map((s) => s.name)).toEqual(['min', 'max', 'list.min', 'list.max']);
    expect(validationSpecs('metaobject_reference').map((s) => s.name)).toEqual(['metaobject_definition_id']);
    expect(validationSpecs('boolean')).toEqual([]);
  });

  it('only sends validations the type supports and that have a value', () => {
    const f = { ...emptyField('a'), base: 'number_integer', validations: { min: '0', max: ' ', regex: 'x', 'list.min': '1' } };
    expect(validationInputs(f)).toEqual([{ name: 'min', value: '0' }]);
    expect(validationInputs({ ...f, list: true })).toEqual([{ name: 'min', value: '0' }, { name: 'list.min', value: '1' }]);
    expect(fieldType({ base: 'boolean', list: true })).toBe('list.boolean');
  });

  it('round-trips field definitions through drafts', () => {
    const d = draftOf({ key: 'tags', name: 'Tags', description: null, required: true, type: { name: 'list.single_line_text_field' }, validations: [{ name: 'choices', value: '["a","b"]' }], capabilities: { adminFilterable: { enabled: true } } }, 'u1');
    expect(d).toMatchObject({ base: 'single_line_text_field', list: true, required: true, filterable: true, existing: true, validations: { choices: '["a","b"]' } });
  });

  it('converts choices and list values', () => {
    expect(textToChoices('a\n b \n\n')).toBe('["a","b"]');
    expect(choicesToText('["a","b"]')).toBe('a\nb');
    expect(textToChoices('')).toBe('');
    expect(parseList('["x",2,{"a":1}]')).toEqual(['x', '2', '{"a":1}']);
    expect(parseList('nope')).toEqual([]);
    expect(serializeList('number_integer', ['1', '', '3'])).toBe('[1,3]');
    expect(serializeList('single_line_text_field', ['', ' '])).toBe('');
    expect(definitionIdsOf('["gid://shopify/MetaobjectDefinition/1"]')).toEqual(['gid://shopify/MetaobjectDefinition/1']);
    expect(definitionIdsOf('gid://shopify/MetaobjectDefinition/2')).toEqual(['gid://shopify/MetaobjectDefinition/2']);
  });

  it('previews the first plain values of an entry', () => {
    const fields = [
      { key: 'a', type: 'single_line_text_field', value: 'A' }, { key: 'r', type: 'product_reference', value: 'gid://shopify/Product/1' }, { key: 'e', type: 'single_line_text_field', value: null },
      { key: 'l', type: 'list.single_line_text_field', value: '["x","y"]' }, { key: 'n', type: 'number_integer', value: '4' },
    ];
    expect(previewValues(fields, 3)).toEqual([{ key: 'a', text: 'A' }, { key: 'l', text: 'x, y' }, { key: 'n', text: '4' }]);
  });
});
