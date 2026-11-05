import { describe, expect, it } from 'vitest';
import { addableSections, allowedBlocks, historyReducer, indexSchemas, parseLiquidSchema, parseTemplate, templateReducer as r } from './theme-template';
import type { Template } from './theme-template';

const base = (): Template => ({ sections: { hero: { type: 'hero', settings: {} }, rich: { type: 'rich-text', settings: {}, blocks: { a: { type: 'text' }, b: { type: 'text' } }, block_order: ['a', 'b'] } }, order: ['hero', 'rich'] });

describe('parseTemplate', () => {
  it('strips the editor banner and drops unknown ids from order', () => {
    const t = parseTemplate('/* warning */\n{"sections":{"a":{"type":"x"}},"order":["a","zzz"]}');
    expect(t?.order).toEqual(['a']);
  });
  it('returns null for invalid input', () => { expect(parseTemplate('nope')).toBeNull(); expect(parseTemplate('{}')).toBeNull(); });
});

describe('sections', () => {
  it('adds a section from a preset with unique ids and preset blocks', () => {
    const t = r(r(base(), { kind: 'addSection', type: 'hero', preset: { name: 'Hero', settings: { a: 1 }, blocks: [{ type: 'text' }, { type: 'text' }] } }), { kind: 'addSection', type: 'hero' });
    expect(t.order).toEqual(['hero', 'rich', 'hero_2', 'hero_3']);
    expect(t.sections.hero_2?.block_order).toEqual(['text', 'text_2']);
    expect(t.sections.hero_2?.settings).toEqual({ a: 1 });
  });
  it('adds preset blocks given as an id-keyed object with block_order', () => {
    const t = r(base(), { kind: 'addSection', type: 'rich-text', preset: { name: 'R', blocks: { b1: { type: 'button' }, h: { type: 'heading', settings: { text: 'x' } } }, block_order: ['h', 'b1'] } });
    expect(t.sections['rich-text']?.block_order).toEqual(['h', 'b1']);
    expect(t.sections['rich-text']?.blocks?.h).toMatchObject({ type: 'heading', settings: { text: 'x' } });
  });
  it('removes and reorders', () => {
    expect(r(base(), { kind: 'removeSection', id: 'hero' }).order).toEqual(['rich']);
    expect(r(base(), { kind: 'moveSection', id: 'hero', to: 1 }).order).toEqual(['rich', 'hero']);
  });
  it('toggles hidden and sets settings', () => {
    const t = r(r(base(), { kind: 'toggleSection', id: 'hero' }), { kind: 'setSetting', id: 'hero', key: 'h', value: 'x' });
    expect(t.sections.hero).toMatchObject({ disabled: true, settings: { h: 'x' } });
    expect(r(t, { kind: 'toggleSection', id: 'hero' }).sections.hero?.disabled).toBe(false);
  });
  it('ignores unknown ids by returning the same object', () => {
    const t = base();
    expect(r(t, { kind: 'removeSection', id: 'nope' })).toBe(t);
    expect(r(t, { kind: 'moveSection', id: 'nope', to: 0 })).toBe(t);
  });
});

describe('blocks', () => {
  it('adds, respects max_blocks and per-type limit', () => {
    const t = r(base(), { kind: 'addBlock', section: 'rich', type: 'text', max: 3 });
    expect(t.sections.rich?.block_order).toEqual(['a', 'b', 'text']);
    expect(r(t, { kind: 'addBlock', section: 'rich', type: 'text', max: 3 })).toBe(t);
    expect(r(base(), { kind: 'addBlock', section: 'rich', type: 'text', limit: 2 })).toEqual(base());
  });
  it('removes, reorders, toggles and edits block settings', () => {
    let t = r(base(), { kind: 'moveBlock', section: 'rich', block: 'a', to: 1 });
    expect(t.sections.rich?.block_order).toEqual(['b', 'a']);
    t = r(t, { kind: 'removeBlock', section: 'rich', block: 'b' });
    expect(t.sections.rich?.block_order).toEqual(['a']);
    expect(t.sections.rich?.blocks).not.toHaveProperty('b');
    t = r(r(t, { kind: 'toggleBlock', section: 'rich', block: 'a' }), { kind: 'setSetting', id: 'rich', block: 'a', key: 'k', value: true });
    expect(t.sections.rich?.blocks?.a).toMatchObject({ disabled: true, settings: { k: true } });
  });
});

describe('schemas', () => {
  const liquid = (s: object) => `<div></div>{% schema %}${JSON.stringify(s)}{% endschema %}`;
  const idx = indexSchemas([
    { filename: 'sections/rich-text.liquid', content: liquid({ name: 'Rich', blocks: [{ type: '@theme' }, { type: 'row', name: 'Row', limit: 2 }], presets: [{ name: 'Rich' }] }) },
    { filename: 'sections/plain.liquid', content: liquid({ name: 'Plain' }) },
    { filename: 'blocks/text.liquid', content: liquid({ name: 'Text', settings: [{ type: 'text', id: 't' }] }) },
    { filename: 'blocks/_private.liquid', content: liquid({ name: 'P' }) },
  ]);
  it('parses schemas and lists addable sections', () => {
    expect(parseLiquidSchema('no schema')).toBeNull();
    expect(addableSections(idx).map((s) => s.type)).toEqual(['rich-text']);
  });
  it('resolves allowed blocks without private theme blocks', () => {
    expect(allowedBlocks(idx.sections['rich-text'], idx).map((b) => b.type)).toEqual(['text', 'row']);
  });
});

describe('history', () => {
  const h = historyReducer(r);
  it('undoes changes and skips no-ops', () => {
    let s = { past: [] as Template[], present: base() };
    s = h(s, { kind: 'do', action: { kind: 'removeSection', id: 'hero' } });
    expect(h(s, { kind: 'do', action: { kind: 'removeSection', id: 'hero' } })).toBe(s);
    s = h(s, { kind: 'undo' });
    expect(s.present.order).toEqual(['hero', 'rich']);
    expect(h(s, { kind: 'undo' })).toBe(s);
  });

  it('redoes an undone change until a new change is made', () => {
    let s = { past: [] as Template[], present: base() };
    s = h(s, { kind: 'do', action: { kind: 'removeSection', id: 'hero' } });
    s = h(s, { kind: 'undo' });
    s = h(s, { kind: 'redo' });
    expect(s.present.order).toEqual(['rich']);
    expect(h(s, { kind: 'redo' })).toBe(s);
    s = h(s, { kind: 'undo' });
    s = h(s, { kind: 'do', action: { kind: 'toggleSection', id: 'rich' } });
    expect(h(s, { kind: 'redo' })).toBe(s);
  });
  it('duplicates a section right after the original', () => {
    const s = r(base(), { kind: 'duplicateSection', id: 'hero', newId: 'hero_2' });
    expect(s.order).toEqual(['hero', 'hero_2', 'rich']);
    expect(s.sections['hero_2']).toEqual(s.sections['hero']);
    expect(s.sections['hero_2']).not.toBe(s.sections['hero']);
    expect(r(s, { kind: 'duplicateSection', id: 'hero', newId: 'hero_2' })).toBe(s);
  });
});

describe('insert and rename section', () => {
  it('inserts a copy at an index and renames', () => {
    const t0 = { sections: { a: { type: 'x' }, b: { type: 'y' } }, order: ['a', 'b'] };
    const t1 = r(t0, { kind: 'insertSection', id: 'c', instance: { type: 'z' }, index: 1 });
    expect(t1.order).toEqual(['a', 'c', 'b']);
    expect(r(t1, { kind: 'insertSection', id: 'c', instance: { type: 'z' } })).toBe(t1);
    const t2 = r(t1, { kind: 'renameSection', id: 'c', name: ' Mine ' });
    expect(t2.sections.c!.name).toBe('Mine');
    expect(r(t2, { kind: 'renameSection', id: 'c', name: '' }).sections.c).toEqual({ type: 'z' });
  });
});
