// Section-level theme editing: parse JSON templates / section groups, read section schemas from `.liquid` files, and a pure reducer
// for add / remove / reorder / hide of sections and blocks (docs/spec/theme-format.md section 3.4).
import type { SettingDef, SettingValue } from './settings-schema';

export interface BlockInstance { type: string; settings?: Record<string, SettingValue>; static?: boolean; disabled?: boolean; name?: string; blocks?: Record<string, BlockInstance>; block_order?: string[] }
export interface SectionInstance { type: string; settings?: Record<string, SettingValue>; blocks?: Record<string, BlockInstance>; block_order?: string[]; disabled?: boolean; name?: string }
export interface Template { sections: Record<string, SectionInstance>; order: string[]; [key: string]: unknown }

/** Parse a template or section-group file (leading `/* ... *\/` banners and `//` lines are tolerated). Returns null when invalid. */
export function parseTemplate(text: string | undefined): Template | null {
  if (text === undefined) return null;
  try {
    const d = JSON.parse(text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')) as Partial<Template>;
    if (!d || typeof d !== 'object' || typeof d.sections !== 'object' || d.sections === null) return null;
    const order = Array.isArray(d.order) ? d.order.filter((id) => id in d.sections!) : Object.keys(d.sections);
    return { ...d, sections: d.sections, order } as Template;
  } catch { return null; }
}
export const serializeTemplate = (t: Template) => `${JSON.stringify(t, null, 2)}\n`;

/* ----------------------------- schemas ----------------------------- */

export interface BlockDef { type: string; name?: string; limit?: number; settings?: SettingDef[] }
type PresetBlock = { type: string; settings?: Record<string, SettingValue> };
/** Preset blocks come as a list (older schemas) or as an id-keyed object plus `block_order` (newer ones). */
export interface Preset { name: string; settings?: Record<string, SettingValue>; blocks?: PresetBlock[] | Record<string, PresetBlock>; block_order?: string[] }
export interface SectionSchema { name?: string; settings?: SettingDef[]; blocks?: BlockDef[]; max_blocks?: number; presets?: Preset[] }

/** Read the `{% schema %}` JSON of a `.liquid` file; null when absent or invalid. */
export function parseLiquidSchema(liquid: string | undefined): SectionSchema | null {
  const m = /\{%-?\s*schema\s*-?%\}([\s\S]*?)\{%-?\s*endschema\s*-?%\}/.exec(liquid ?? '');
  if (!m) return null;
  try { const s = JSON.parse(m[1]!) as SectionSchema; return s && typeof s === 'object' ? s : null; } catch { return null; }
}

export interface SchemaIndex { sections: Record<string, SectionSchema>; blocks: Record<string, SectionSchema> }
/** Build the schema index from files `sections/*.liquid` and `blocks/*.liquid`. */
export function indexSchemas(files: Array<{ filename: string; content?: string }>): SchemaIndex {
  const out: SchemaIndex = { sections: {}, blocks: {} };
  for (const f of files) {
    const m = /^(sections|blocks)\/([^/]+)\.liquid$/.exec(f.filename);
    const schema = m && parseLiquidSchema(f.content);
    if (m && schema) out[m[1] as 'sections' | 'blocks'][m[2]!] = schema;
  }
  return out;
}

/** Block types a section accepts: its own declared blocks plus public theme blocks when it lists `@theme`. */
export function allowedBlocks(section: SectionSchema | undefined, idx: SchemaIndex): BlockDef[] {
  const out: BlockDef[] = [];
  for (const b of section?.blocks ?? []) {
    if (b.type === '@theme') for (const [type, s] of Object.entries(idx.blocks)) { if (!type.startsWith('_')) out.push({ type, name: s.name, settings: s.settings, limit: undefined }); }
    else if (b.type !== '@app') out.push(b);
  }
  return out.filter((b, i) => out.findIndex((x) => x.type === b.type) === i);
}

/** Settings schema of a block instance (local block def, else theme block). */
export function blockSettings(section: SectionSchema | undefined, type: string, idx: SchemaIndex): SettingDef[] {
  return section?.blocks?.find((b) => b.type === type)?.settings ?? idx.blocks[type]?.settings ?? [];
}

/** Sections that can be added from the picker: those with at least one preset. */
export const addableSections = (idx: SchemaIndex) => Object.entries(idx.sections).filter(([, s]) => s.presets?.length).map(([type, s]) => ({ type, name: s.name ?? type, presets: s.presets! }));

/* ----------------------------- reducer ----------------------------- */

export type Action =
  | { kind: 'addSection'; type: string; preset?: Preset; id?: string; index?: number }
  | { kind: 'removeSection'; id: string }
  | { kind: 'duplicateSection'; id: string; newId: string }
  | { kind: 'moveSection'; id: string; to: number }
  | { kind: 'toggleSection'; id: string }
  | { kind: 'setSetting'; id: string; key: string; value: SettingValue; block?: string }
  | { kind: 'addBlock'; section: string; type: string; max?: number; limit?: number; settings?: Record<string, SettingValue> }
  | { kind: 'removeBlock'; section: string; block: string }
  | { kind: 'moveBlock'; section: string; block: string; to: number }
  | { kind: 'toggleBlock'; section: string; block: string };

/** Unused id derived from `base`: `base`, `base_2`, `base_3`, ... */
export function uniqueId(base: string, taken: Iterable<string>): string {
  const set = new Set(taken);
  const root = base.replace(/[^a-zA-Z0-9_-]+/g, '_') || 'item';
  if (!set.has(root)) return root;
  let n = 2;
  while (set.has(`${root}_${n}`)) n++;
  return `${root}_${n}`;
}

const move = <T,>(a: T[], from: number, to: number) => {
  const next = a.slice(); const [x] = next.splice(from, 1);
  if (x === undefined) return a;
  next.splice(Math.max(0, Math.min(next.length, to)), 0, x);
  return next;
};
export const blockOrder = (s: SectionInstance) => (s.block_order ?? Object.keys(s.blocks ?? {})).filter((id) => s.blocks?.[id]);

/** Pure template reducer. Invalid actions (unknown ids, exceeding `max`/`limit`) return the same object. */
export function templateReducer(t: Template, a: Action): Template {
  const sec = (id: string) => t.sections[id];
  switch (a.kind) {
    case 'addSection': {
      const id = a.id ?? uniqueId(a.type, Object.keys(t.sections));
      const section: SectionInstance = { type: a.type, settings: { ...a.preset?.settings } };
      const pb = a.preset?.blocks;
      const entries: Array<[string, PresetBlock]> = Array.isArray(pb) ? pb.map((b) => [b.type, b]) : Object.entries(pb ?? {});
      if (entries.length) {
        const ids = Array.isArray(pb) ? [] : (a.preset?.block_order ?? []).filter((x) => x in pb!);
        section.blocks = {}; section.block_order = [];
        const sorted = Array.isArray(pb) ? entries : [...ids.map((x) => [x, pb![x]!] as [string, PresetBlock]), ...entries.filter(([k]) => !ids.includes(k))];
        for (const [key, b] of sorted) {
          const bid = uniqueId(key, section.block_order);
          section.blocks[bid] = { type: b.type, settings: { ...b.settings } }; section.block_order.push(bid);
        }
      }
      const order = t.order.slice(); order.splice(a.index ?? order.length, 0, id);
      return { ...t, sections: { ...t.sections, [id]: section }, order };
    }
    case 'removeSection': {
      if (!sec(a.id)) return t;
      const { [a.id]: _gone, ...rest } = t.sections;
      return { ...t, sections: rest, order: t.order.filter((x) => x !== a.id) };
    }
    case 'duplicateSection': {
      const src = sec(a.id);
      if (!src || t.sections[a.newId]) return t;
      const order = t.order.slice(); order.splice(t.order.indexOf(a.id) + 1, 0, a.newId);
      return { ...t, sections: { ...t.sections, [a.newId]: structuredClone(src) }, order };
    }
    case 'moveSection': {
      const from = t.order.indexOf(a.id);
      return from < 0 || from === a.to ? t : { ...t, order: move(t.order, from, a.to) };
    }
    case 'toggleSection': {
      const s = sec(a.id); if (!s) return t;
      return { ...t, sections: { ...t.sections, [a.id]: { ...s, disabled: !s.disabled } } };
    }
    case 'setSetting': {
      const s = sec(a.id); if (!s) return t;
      if (a.block) {
        const b = s.blocks?.[a.block]; if (!b) return t;
        return { ...t, sections: { ...t.sections, [a.id]: { ...s, blocks: { ...s.blocks, [a.block]: { ...b, settings: { ...b.settings, [a.key]: a.value } } } } } };
      }
      return { ...t, sections: { ...t.sections, [a.id]: { ...s, settings: { ...s.settings, [a.key]: a.value } } } };
    }
    case 'addBlock': {
      const s = sec(a.section); if (!s) return t;
      const order = blockOrder(s);
      if (a.max !== undefined && order.length >= a.max) return t;
      if (a.limit !== undefined && order.filter((id) => s.blocks![id]!.type === a.type).length >= a.limit) return t;
      const id = uniqueId(a.type, Object.keys(s.blocks ?? {}));
      return { ...t, sections: { ...t.sections, [a.section]: { ...s, blocks: { ...s.blocks, [id]: { type: a.type, settings: { ...a.settings } } }, block_order: [...order, id] } } };
    }
    case 'removeBlock': {
      const s = sec(a.section); if (!s?.blocks?.[a.block]) return t;
      const { [a.block]: _gone, ...blocks } = s.blocks;
      return { ...t, sections: { ...t.sections, [a.section]: { ...s, blocks, block_order: blockOrder(s).filter((x) => x !== a.block) } } };
    }
    case 'moveBlock': {
      const s = sec(a.section); if (!s) return t;
      const order = blockOrder(s); const from = order.indexOf(a.block);
      return from < 0 || from === a.to ? t : { ...t, sections: { ...t.sections, [a.section]: { ...s, block_order: move(order, from, a.to) } } };
    }
    case 'toggleBlock': {
      const s = sec(a.section); const b = s?.blocks?.[a.block]; if (!s || !b) return t;
      return { ...t, sections: { ...t.sections, [a.section]: { ...s, blocks: { ...s.blocks, [a.block]: { ...b, disabled: !b.disabled } } } } };
    }
  }
}

/* ----------------------------- history (undo) ----------------------------- */

export interface History<T> { past: T[]; present: T; future?: T[] }
export type HistoryAction<T, A> = { kind: 'do'; action: A } | { kind: 'undo' } | { kind: 'redo' } | { kind: 'reset'; to: T };

/** Wrap a reducer with an undo/redo stack. Actions that change nothing are not recorded; a new change clears what could be redone. */
export function historyReducer<T, A>(inner: (s: T, a: A) => T) {
  return (h: History<T>, e: HistoryAction<T, A>): History<T> => {
    if (e.kind === 'reset') return { past: [], present: e.to };
    if (e.kind === 'undo') return h.past.length ? { past: h.past.slice(0, -1), present: h.past[h.past.length - 1]!, future: [h.present, ...(h.future ?? [])] } : h;
    if (e.kind === 'redo') return h.future?.length ? { past: [...h.past, h.present], present: h.future[0]!, future: h.future.slice(1) } : h;
    const next = inner(h.present, e.action);
    return next === h.present ? h : { past: [...h.past, h.present].slice(-100), present: next };
  };
}
