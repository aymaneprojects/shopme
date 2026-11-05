import { describe, expect, it } from 'vitest';
import { changedDocs, changedSettings, emptySession, sessionReducer } from './editor-session';
import { categoryOf, groupItems } from './section-categories';
import type { Template } from './theme-template';

const doc = (n: number): Template => ({ sections: { a: { type: 'x', settings: { n } } }, order: ['a'] });

describe('editor session history', () => {
  it('shares one history between templates and theme settings', () => {
    let s = emptySession();
    s = sessionReducer(s, { kind: 'doc', file: 'templates/index.json', doc: doc(1), at: 0 });
    s = sessionReducer(s, { kind: 'setting', id: 'color', value: '#fff', at: 5000 });
    expect(s.past).toHaveLength(2);
    s = sessionReducer(s, { kind: 'undo' });
    expect(s.present.settings).toEqual({});
    expect(s.present.docs['templates/index.json']).toBeDefined();
    s = sessionReducer(s, { kind: 'undo' });
    expect(s.present.docs).toEqual({});
    s = sessionReducer(s, { kind: 'redo' });
    s = sessionReducer(s, { kind: 'redo' });
    expect(s.present.settings.color).toBe('#fff');
  });
  it('coalesces fast edits of the same field and clears redo on a new edit', () => {
    let s = emptySession();
    s = sessionReducer(s, { kind: 'setting', id: 'other', value: '0', at: 0 });
    for (const [i, v] of ['a', 'ab', 'abc'].entries()) s = sessionReducer(s, { kind: 'setting', id: 't', value: v, at: 5000 + i * 100 });
    expect(s.past).toHaveLength(2);
    s = sessionReducer(s, { kind: 'undo' });
    expect(s.future).toHaveLength(1);
    s = sessionReducer(s, { kind: 'setting', id: 'z', value: '1', at: 9000 });
    expect(s.future).toHaveLength(0);
  });
  it('ignores identical edits and reports what changed against the stored values', () => {
    let s = emptySession();
    s = sessionReducer(s, { kind: 'setting', id: 'a', value: 1, at: 0 });
    expect(sessionReducer(s, { kind: 'setting', id: 'a', value: 1, at: 1 })).toBe(s);
    expect(changedSettings({ a: 1 }, s.present)).toEqual([]);
    expect(changedSettings({ a: 2 }, s.present)).toEqual(['a']);
    const d = sessionReducer(emptySession(), { kind: 'doc', file: 'f', doc: doc(2), at: 0 });
    expect(changedDocs({ f: doc(2) }, d.present)).toEqual([]);
    expect(changedDocs({ f: doc(3) }, d.present)).toEqual(['f']);
  });
});

describe('section categories', () => {
  it('uses the preset category, else keywords', () => {
    expect(categoryOf('x', 'Y', 'Banners')).toBe('banners');
    expect(categoryOf('image-banner', 'Image banner')).toBe('banners');
    expect(categoryOf('featured-collection', 'Featured collection')).toBe('collections');
    expect(categoryOf('featured-product', 'Featured product')).toBe('products');
    expect(categoryOf('rich-text', 'Rich text')).toBe('content');
    expect(categoryOf('newsletter', 'Newsletter')).toBe('forms');
    expect(categoryOf('zzz', 'Zzz')).toBe('other');
  });
  it('groups in display order and filters by search', () => {
    const items = [{ type: 'a', presetIndex: 0, name: 'Rich text', category: 'content' as const }, { type: 'b', presetIndex: 0, name: 'Hero', category: 'banners' as const }];
    expect(groupItems(items, '', (c) => c).map((g) => g.id)).toEqual(['banners', 'content']);
    expect(groupItems(items, 'rich', (c) => c).map((g) => g.id)).toEqual(['content']);
    expect(groupItems(items, 'banners', (c) => c).map((g) => g.id)).toEqual(['banners']);
  });
});
