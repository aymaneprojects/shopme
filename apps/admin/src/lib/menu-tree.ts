// Pure helpers for the navigation menu editor (immutable tree edits addressed by index paths).

export type LinkType = 'HTTP' | 'PRODUCT' | 'COLLECTION' | 'PAGE';
export interface MenuItem { id?: string; title: string; type: LinkType; url: string; resourceId: string | null; items: MenuItem[] }
export type Path = number[];
export const MAX_DEPTH = 3;

const edit = (items: MenuItem[], parent: Path, fn: (list: MenuItem[]) => MenuItem[]): MenuItem[] => {
  if (!parent.length) return fn(items);
  const [i, ...rest] = parent as [number, ...number[]];
  return items.map((it, k) => (k === i ? { ...it, items: edit(it.items, rest, fn) } : it));
};
export const getItem = (items: MenuItem[], path: Path): MenuItem | undefined => path.reduce<MenuItem | undefined>((cur, i, n) => (n === 0 ? items[i] : cur?.items[i]), undefined);
const depthOf = (it: MenuItem): number => 1 + Math.max(0, ...it.items.map(depthOf));

export const addItem = (items: MenuItem[], parent: Path, item: MenuItem) => edit(items, parent, (l) => [...l, item]);
export const removeItem = (items: MenuItem[], path: Path) => edit(items, path.slice(0, -1), (l) => l.filter((_, k) => k !== path[path.length - 1]));
export const updateItem = (items: MenuItem[], path: Path, patch: Partial<MenuItem>) => edit(items, path.slice(0, -1), (l) => l.map((it, k) => (k === path[path.length - 1] ? { ...it, ...patch } : it)));

const swap = (l: MenuItem[], a: number, b: number) => { const n = [...l]; [n[a], n[b]] = [n[b]!, n[a]!]; return n; };
export const canMoveUp = (path: Path) => path[path.length - 1]! > 0;
export const canMoveDown = (items: MenuItem[], path: Path) => path[path.length - 1]! < (path.length === 1 ? items : getItem(items, path.slice(0, -1))!.items).length - 1;
export const moveUp = (items: MenuItem[], path: Path) => (canMoveUp(path) ? edit(items, path.slice(0, -1), (l) => swap(l, path[path.length - 1]!, path[path.length - 1]! - 1)) : items);
export const moveDown = (items: MenuItem[], path: Path) => (canMoveDown(items, path) ? edit(items, path.slice(0, -1), (l) => swap(l, path[path.length - 1]!, path[path.length - 1]! + 1)) : items);

/** Make the item the last child of its previous sibling (blocked beyond MAX_DEPTH). */
export const canIndent = (items: MenuItem[], path: Path) => {
  const it = getItem(items, path);
  return !!it && canMoveUp(path) && path.length + depthOf(it) <= MAX_DEPTH;
};
export function indent(items: MenuItem[], path: Path): MenuItem[] {
  if (!canIndent(items, path)) return items;
  const it = getItem(items, path)!;
  const idx = path[path.length - 1]!;
  return edit(items, path.slice(0, -1), (l) => l.map((x, k) => (k === idx - 1 ? { ...x, items: [...x.items, it] } : x)).filter((_, k) => k !== idx));
}
/** Move the item out of its parent, right after it. */
export const canOutdent = (path: Path) => path.length > 1;
export function outdent(items: MenuItem[], path: Path): MenuItem[] {
  if (!canOutdent(path)) return items;
  const it = getItem(items, path)!;
  const parentPath = path.slice(0, -1);
  const removed = removeItem(items, path);
  return edit(removed, parentPath.slice(0, -1), (l) => { const at = parentPath[parentPath.length - 1]! + 1; return [...l.slice(0, at), it, ...l.slice(at)]; });
}

/** Strip UI-only data for create (no ids) or update (keep ids so the server can keep existing items). */
export const toInput = (items: MenuItem[], withIds: boolean): unknown[] => items.map((it) => ({
  ...(withIds && it.id && { id: it.id }), title: it.title.trim(), type: it.type, url: it.type === 'HTTP' ? it.url.trim() : it.url || null, resourceId: it.resourceId, items: toInput(it.items, withIds),
}));

/* ------------------------------ drag and drop ------------------------------ */

export type DropPlace = 'before' | 'after' | 'inside';
const samePrefix = (a: Path, b: Path, n: number) => a.slice(0, n).every((x, i) => x === b[i]);

/** Where the target path ends up once the dragged item is taken out of the tree. */
function shiftedTarget(from: Path, to: Path): Path {
  const d = from.length - 1;
  if (to.length > d && samePrefix(from, to, d) && from[d]! < to[d]!) { const n = [...to]; n[d] = to[d]! - 1; return n; }
  return to;
}

/** Whether the item at `from` may be dropped before, after or inside the item at `to` (not onto itself or its children, and not deeper than MAX_DEPTH). */
export function canMoveTo(items: MenuItem[], from: Path, to: Path, place: DropPlace): boolean {
  const it = getItem(items, from);
  if (!it || !getItem(items, to)) return false;
  if (to.length >= from.length && samePrefix(from, to, from.length)) return false; // onto itself or one of its own children
  const newDepth = place === 'inside' ? to.length + 1 : to.length;
  return newDepth + depthOf(it) - 1 <= MAX_DEPTH;
}

/** Drag and drop: move the item at `from` before/after the item at `to`, or make it the last child of that item. */
export function moveTo(items: MenuItem[], from: Path, to: Path, place: DropPlace): MenuItem[] {
  if (!canMoveTo(items, from, to, place)) return items;
  const it = getItem(items, from)!;
  const target = shiftedTarget(from, to);
  const removed = removeItem(items, from);
  if (place === 'inside') return edit(removed, target, (l) => [...l, it]);
  const at = target[target.length - 1]! + (place === 'after' ? 1 : 0);
  return edit(removed, target.slice(0, -1), (l) => [...l.slice(0, at), it, ...l.slice(at)]);
}
