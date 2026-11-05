import { describe, expect, it } from 'vitest';
import { addItem, canIndent, canMoveTo, indent, moveDown, moveTo, moveUp, outdent, removeItem, toInput, updateItem } from './menu-tree';
import type { MenuItem } from './menu-tree';

const it_ = (title: string, items: MenuItem[] = []): MenuItem => ({ title, type: 'HTTP', url: '/', resourceId: null, items });
const titles = (l: MenuItem[]): unknown[] => l.map((x) => (x.items.length ? [x.title, titles(x.items)] : x.title));

describe('menu tree helpers', () => {
  const base = [it_('A'), it_('B'), it_('C')];

  it('reorders siblings', () => {
    expect(titles(moveDown(base, [0]))).toEqual(['B', 'A', 'C']);
    expect(titles(moveUp(base, [2]))).toEqual(['A', 'C', 'B']);
    expect(moveUp(base, [0])).toBe(base);
    expect(moveDown(base, [2])).toBe(base);
  });

  it('nests under the previous sibling and back out', () => {
    const nested = indent(base, [1]);
    expect(titles(nested)).toEqual([['A', ['B']], 'C']);
    expect(titles(outdent(nested, [0, 0]))).toEqual(['A', 'B', 'C']);
    expect(indent(base, [0])).toBe(base);
  });

  it('limits the depth to three levels', () => {
    const deep = [it_('A', [it_('B', [it_('C')])]), it_('D')];
    expect(canIndent(deep, [1])).toBe(true); // D under A -> depth 2
    const tooDeep = [it_('A', [it_('B')]), it_('C', [it_('D', [it_('E')])])];
    expect(canIndent(tooDeep, [1])).toBe(false); // C subtree is 3 deep, would become 4
  });

  it('adds, updates and removes at a path', () => {
    const withChild = addItem(base, [1], it_('B1'));
    expect(titles(withChild)).toEqual(['A', ['B', ['B1']], 'C']);
    expect(updateItem(withChild, [1, 0], { title: 'X' })[1]!.items[0]!.title).toBe('X');
    expect(titles(removeItem(withChild, [1, 0]))).toEqual(['A', 'B', 'C']);
  });

  it('keeps ids only for updates', () => {
    const items = [{ ...it_('A'), id: 'gid://1' }];
    expect(toInput(items, true)).toMatchObject([{ id: 'gid://1', title: 'A' }]);
    expect(toInput(items, false)[0]).not.toHaveProperty('id');
  });
});

describe('drag and drop', () => {
  const leaf = (title: string, items: MenuItem[] = []): MenuItem => ({ title, type: 'HTTP', url: '/', resourceId: null, items });
  const titles = (l: MenuItem[]): unknown[] => l.map((i) => (i.items.length ? { [i.title]: titles(i.items) } : i.title));
  const tree = () => [leaf('a'), leaf('b', [leaf('b1'), leaf('b2')]), leaf('c')];

  it('moves before and after a sibling', () => {
    expect(titles(moveTo(tree(), [0], [2], 'after'))).toEqual([{ b: ['b1', 'b2'] }, 'c', 'a']);
    expect(titles(moveTo(tree(), [2], [0], 'before'))).toEqual(['c', 'a', { b: ['b1', 'b2'] }]);
    expect(titles(moveTo(tree(), [0], [1, 1], 'before'))).toEqual([{ b: ['b1', 'a', 'b2'] }, 'c']);
  });

  it('moves inside an item and out of one', () => {
    expect(titles(moveTo(tree(), [2], [0], 'inside'))).toEqual([{ a: ['c'] }, { b: ['b1', 'b2'] }]);
    expect(titles(moveTo(tree(), [1, 0], [0], 'after'))).toEqual(['a', 'b1', { b: ['b2'] }, 'c']);
  });

  it('refuses to drop onto itself, its children or beyond the maximum depth', () => {
    expect(canMoveTo(tree(), [1], [1], 'inside')).toBe(false);
    expect(canMoveTo(tree(), [1], [1, 0], 'before')).toBe(false);
    expect(moveTo(tree(), [1], [1, 1], 'after')).toEqual(tree());
    const deep = [leaf('x', [leaf('y', [leaf('z')])]), leaf('w')];
    expect(canMoveTo(deep, [1], [0, 0, 0], 'inside')).toBe(false);
    expect(canMoveTo(deep, [1], [0, 0], 'inside')).toBe(true);
    expect(canMoveTo(deep, [0], [1], 'inside')).toBe(false);
  });
});
