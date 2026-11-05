import { describe, expect, it } from 'vitest';
import { hasSource, insertSource, sourcesFor, withoutSources } from './dynamic-sources';
import { applyEdits, flatten, localeFiles, parseLocale, placeholders, placeholdersDiffer, serializeLocale } from './locale-content';
import { addScheme, coerceValue, isVisible, schemeOptions, visibleSettings } from './settings-schema';
import type { SchemeSet } from './settings-schema';

describe('visible_if', () => {
  const scope = { section: { media_type: 'video', link: '', show: true, count: 3 }, block: { on: false }, settings: { predictive: true } };

  it('reads section, block and theme settings', () => {
    expect(isVisible("{{ section.settings.media_type == 'video' }}", scope)).toBe(true);
    expect(isVisible("{{ section.settings.media_type == 'image' }}", scope)).toBe(false);
    expect(isVisible("{{ section.settings.media_type != 'image' }}", scope)).toBe(true);
    expect(isVisible('{{ block.settings.on }}', scope)).toBe(false);
    expect(isVisible('{{ settings.predictive }}', scope)).toBe(true);
  });

  it('compares with blank, numbers and combines with and / or', () => {
    expect(isVisible('{{ section.settings.link != blank }}', scope)).toBe(false);
    expect(isVisible('{{ section.settings.link == blank }}', scope)).toBe(true);
    expect(isVisible('{{ section.settings.count > 2 }}', scope)).toBe(true);
    expect(isVisible("{{ section.settings.show and section.settings.media_type == 'video' }}", scope)).toBe(true);
    expect(isVisible("{{ block.settings.on or section.settings.media_type == 'image' }}", scope)).toBe(false);
  });

  it('keeps a setting visible when there is no condition or it cannot be read', () => {
    expect(isVisible(undefined, scope)).toBe(true);
    expect(isVisible('section.settings.x', scope)).toBe(true);
  });

  it('filters settings by their condition', () => {
    const defs = [{ type: 'text', id: 'a' }, { type: 'text', id: 'b', visible_if: "{{ section.settings.media_type == 'image' }}" }, { type: 'text', id: 'c', visible_if: '{{ section.settings.show }}' }];
    expect(visibleSettings(defs, scope).map((d) => d.id)).toEqual(['a', 'c']);
  });
});

describe('color schemes', () => {
  const schemes: SchemeSet = { 'scheme-1': { settings: { name: 'Soft', background: '#eee' } }, 'scheme-2': { settings: { background: '#000' } } };

  it('lists schemes with their names, numbering the unnamed ones', () => {
    expect(schemeOptions(schemes)).toEqual([{ id: 'scheme-1', name: 'Soft' }, { id: 'scheme-2', name: 'Scheme 2' }]);
    expect(schemeOptions(undefined)).toEqual([]);
  });

  it('adds a scheme under the next free id, blank or copied from another', () => {
    const blank = addScheme(schemes, { background: '#fff', name: 'Scheme' });
    expect(blank.id).toBe('scheme-3');
    expect(blank.schemes['scheme-3']!.settings).toMatchObject({ background: '#fff', name: 'Scheme 3' });
    const copy = addScheme(schemes, {}, 'scheme-1');
    expect(copy.schemes[copy.id]!.settings).toMatchObject({ background: '#eee', name: 'Soft 3' });
    expect(Object.keys(copy.schemes)).toHaveLength(3);
  });

  it('keeps the scheme group value as an object', () => {
    const def = { type: 'color_scheme_group', id: 'color_schemes' };
    expect(coerceValue(def, schemes)).toBe(schemes);
    expect(coerceValue(def, undefined)).toEqual({});
  });
});

describe('dynamic sources', () => {
  it('offers the data of the page the preview shows, and always the store name', () => {
    expect(sourcesFor('product').map((s) => s.id)).toContain('product.title');
    expect(sourcesFor('collection.custom').map((s) => s.id)).toContain('collection.title');
    expect(sourcesFor('index').map((s) => s.id)).toEqual(['shop.name']);
  });

  it('inserts a source into plain and rich text and takes it out again', () => {
    expect(insertSource('', '{{ shop.name }}', false)).toBe('{{ shop.name }}');
    expect(insertSource('Welcome to', '{{ shop.name }}', false)).toBe('Welcome to {{ shop.name }}');
    expect(insertSource('<p>Hi</p>', '{{ shop.name }}', true)).toBe('<p>Hi</p><p>{{ shop.name }}</p>');
    expect(hasSource('Welcome to {{ shop.name }}')).toBe(true);
    expect(withoutSources('Welcome to {{ shop.name }}').trim()).toBe('Welcome to');
    expect(withoutSources('<p>Hi</p><p>{{ shop.name }}</p>')).toBe('<p>Hi</p>');
  });
});

describe('theme content', () => {
  const tree = parseLocale('/* banner */ { "cart": { "title": "Cart", "empty": "Empty" }, "general": { "home": "Home" }, "seed_defaults": { "A": "B" } }')!;

  it('flattens the texts by dotted key and skips what is not a storefront text', () => {
    expect(flatten(tree)).toEqual({ 'cart.title': 'Cart', 'cart.empty': 'Empty', 'general.home': 'Home' });
    expect(parseLocale('[1]')).toBeNull();
    expect(parseLocale('{oops')).toBeNull();
  });

  it('applies edits, creates branches, and removes emptied keys and branches', () => {
    const out = applyEdits(tree, { 'cart.title': 'Panier', 'products.add': 'Ajouter', 'general.home': '' });
    expect(out).toMatchObject({ cart: { title: 'Panier', empty: 'Empty' }, products: { add: 'Ajouter' }, seed_defaults: { A: 'B' } });
    expect(out).not.toHaveProperty('general');
    expect(tree).toHaveProperty('general.home', 'Home'); // the source tree is not changed
    expect(applyEdits({}, { 'a.b': '' })).toEqual({});
    expect(serializeLocale({ a: 'b' })).toBe('{\n  "a": "b"\n}\n');
  });

  it('checks that a translation keeps the placeholders of the default text', () => {
    expect(placeholders('Hi {{ name }}, {{count}} items')).toEqual(['count', 'name']);
    expect(placeholdersDiffer('Hi {{ name }}', 'Salut {{ name }}')).toBe(false);
    expect(placeholdersDiffer('Hi {{ name }}', 'Salut')).toBe(true);
    expect(placeholdersDiffer('Hi {{ name }}', '')).toBe(false);
  });

  it('finds the locale files of a theme, default first, ignoring schema files', () => {
    const files = localeFiles(['locales/fr.json', 'locales/en.default.json', 'locales/en.default.schema.json', 'locales/fr.schema.json', 'locales/pt-BR.json', 'sections/a.liquid']);
    expect(files.map((f) => [f.code, f.isDefault])).toEqual([['en', true], ['fr', false], ['pt-BR', false]]);
  });
});
