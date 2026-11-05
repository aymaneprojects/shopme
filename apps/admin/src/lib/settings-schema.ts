// Theme settings form generator: turns config/settings_schema.json into typed groups and merges edited values back
// into config/settings_data.json (docs/spec/theme-format.md).

/** The named color schemes of the theme (`color_scheme_group`): scheme id to its settings (name, background, text, ...). */
export interface SchemeSet { [id: string]: { settings: Record<string, string> } }
export type SettingValue = string | number | boolean | string[] | SchemeSet;
export interface SettingOption { value: string; label: string }
export interface SettingDef {
  type: string; id?: string; label?: string; info?: string; default?: SettingValue; content?: string;
  min?: number; max?: number; step?: number; unit?: string; options?: SettingOption[];
  /** `metaobject` and `metaobject_list` settings: the definition type entries are chosen from, and the list size limit. */
  metaobject_type?: string; limit?: number;
  /** ShopMe hint for `select`: `segmented` draws the options as a segmented control, `font` as a font list. */
  variant?: string;
  /** Show the setting only when this Liquid-style condition holds, such as `{{ section.settings.media_type == 'video' }}`. */
  visible_if?: string;
  /** `color_scheme_group`: the settings of one scheme. */
  definition?: SettingDef[];
}
export interface SettingGroup { name: string; settings: SettingDef[] }

export const INPUT_TYPES = ['color', 'text', 'textarea', 'checkbox', 'range', 'select', 'radio', 'image_picker', 'font_picker', 'url', 'richtext', 'inline_richtext', 'metaobject', 'metaobject_list', 'color_scheme', 'color_scheme_group', 'video_url', 'liquid', 'html', 'number', 'collection', 'product', 'page', 'blog'] as const;
export const FONT_OPTIONS: SettingOption[] = [
  { value: 'system-ui, sans-serif', label: 'System sans-serif' }, { value: 'Georgia, serif', label: 'Georgia' },
  { value: 'ui-monospace, monospace', label: 'Monospace' }, { value: 'Helvetica, Arial, sans-serif', label: 'Helvetica' },
  { value: '"Times New Roman", serif', label: 'Times New Roman' },
];

/** Settings that hold a value (headers and paragraphs are layout only). */
export const isInput = (s: SettingDef): s is SettingDef & { id: string } => !!s.id && (INPUT_TYPES as readonly string[]).includes(s.type);

export function parseSchema(json: string): SettingGroup[] {
  let raw: unknown;
  try { raw = JSON.parse(json); } catch { return []; }
  if (!Array.isArray(raw)) return [];
  const groups: SettingGroup[] = [];
  for (const g of raw as Array<{ name?: string; settings?: SettingDef[] }>) {
    if (!g || g.name === 'theme_info' || !Array.isArray(g.settings)) continue;
    groups.push({ name: String(g.name ?? ''), settings: g.settings.filter((s) => s && typeof s.type === 'string') });
  }
  return groups;
}

/** Default value for a setting when the data file has none. */
export function defaultValue(s: SettingDef): SettingValue {
  if (s.default !== undefined) return s.default;
  switch (s.type) {
    case 'checkbox': return false;
    case 'range': return s.min ?? 0;
    case 'select': case 'radio': return s.options?.[0]?.value ?? '';
    case 'font_picker': return FONT_OPTIONS[0]!.value;
    case 'metaobject_list': return [];
    case 'color_scheme_group': return {};
    default: return '';
  }
}

/** Coerce an arbitrary stored/edited value to the type a setting expects. */
export function coerceValue(s: SettingDef, raw: unknown): SettingValue {
  if (raw === undefined || raw === null) return defaultValue(s);
  switch (s.type) {
    case 'checkbox': return raw === true || raw === 'true';
    case 'range': {
      const n = Number(raw);
      if (Number.isNaN(n)) return defaultValue(s);
      return Math.min(s.max ?? n, Math.max(s.min ?? n, n));
    }
    case 'metaobject_list': return Array.isArray(raw) ? raw.map(String) : typeof raw === 'string' && raw ? [raw] : [];
    case 'color_scheme_group': return raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as SchemeSet) : defaultValue(s);
    case 'select': case 'radio':
      return s.options?.some((o) => o.value === String(raw)) ? String(raw) : defaultValue(s);
    default: return String(raw);
  }
}

/** Values for every input setting: stored value, else default. */
export function buildValues(groups: SettingGroup[], current: Record<string, unknown>): Record<string, SettingValue> {
  const out: Record<string, SettingValue> = {};
  for (const g of groups) for (const s of g.settings) if (isInput(s)) out[s.id] = coerceValue(s, current[s.id]);
  return out;
}

/** The `current` object of settings_data.json (supports a missing/invalid file). */
export function parseCurrent(dataJson: string | undefined): Record<string, unknown> {
  try {
    const d = JSON.parse(dataJson ?? '{}') as { current?: unknown };
    return d.current && typeof d.current === 'object' ? (d.current as Record<string, unknown>) : {};
  } catch { return {}; }
}

/** Write edited values into `current`, keeping presets and unknown keys intact. */
export function serializeData(dataJson: string | undefined, values: Record<string, SettingValue>): string {
  let data: Record<string, unknown> = {};
  try { data = JSON.parse(dataJson ?? '{}') as Record<string, unknown>; } catch { /* start fresh */ }
  const current = data.current && typeof data.current === 'object' ? (data.current as Record<string, unknown>) : {};
  return `${JSON.stringify({ ...data, current: { ...current, ...values } }, null, 2)}\n`;
}

/** Resolve `t:a.b.c` labels against a nested dictionary; falls back to a readable version of the last segment. */
export function resolveLabel(label: string | undefined, dict: unknown, fallback = ''): string {
  if (!label) return fallback;
  if (!label.startsWith('t:')) return label;
  const path = label.slice(2).split('.');
  let cur: unknown = dict;
  for (const p of path) cur = cur && typeof cur === 'object' ? (cur as Record<string, unknown>)[p] : undefined;
  if (typeof cur === 'string') return cur;
  const last = path[path.length - 1] ?? '';
  return last.replace(/[_-]+/g, ' ').replace(/^./, (c) => c.toUpperCase());
}

export function parseDict(json: string | undefined): unknown {
  try { return JSON.parse(json ?? '{}'); } catch { return {}; }
}

/* ----------------------------- visible_if ----------------------------- */

export interface VisibilityScope { section?: Record<string, unknown>; block?: Record<string, unknown>; settings?: Record<string, unknown> }

const literal = (tok: string, scope: VisibilityScope): unknown => {
  const t = tok.trim();
  if (/^(['"]).*\1$/.test(t)) return t.slice(1, -1);
  if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t);
  if (t === 'true') return true;
  if (t === 'false') return false;
  if (t === 'blank' || t === 'empty' || t === 'nil' || t === 'null') return null;
  const m = /^(section|block)\.settings\.(\w+)$/.exec(t) ?? /^(settings)\.(\w+)$/.exec(t);
  if (!m) return undefined;
  const bag = m[1] === 'settings' ? scope.settings : m[1] === 'section' ? scope.section : scope.block;
  return bag?.[m[2]!];
};
const blank = (v: unknown) => v === undefined || v === null || v === '' || v === false || (Array.isArray(v) && v.length === 0);

/** Evaluate a `visible_if` condition: `{{ a }}`, `{{ a == 'x' }}`, `!=`, `>`, `<`, `>=`, `<=`, `contains`, joined by `and` / `or`. Unknown syntax keeps the setting visible. */
export function isVisible(expr: string | undefined, scope: VisibilityScope): boolean {
  if (!expr) return true;
  const body = /^\s*\{\{([\s\S]*)\}\}\s*$/.exec(expr)?.[1];
  if (body === undefined) return true;
  const clause = (c: string): boolean => {
    const m = /^(.+?)\s+(==|!=|>=|<=|>|<|contains)\s+(.+)$/.exec(c.trim());
    if (!m) return !blank(literal(c, scope));
    const rawL = literal(m[1]!, scope); const rawR = literal(m[3]!, scope);
    const l = rawL === undefined ? null : rawL; const r = rawR === undefined ? null : rawR;
    const eq = (a: unknown, b: unknown) => (b === null ? blank(a) : String(a) === String(b));
    switch (m[2]) {
      case '==': return eq(l, r);
      case '!=': return !eq(l, r);
      case '>': return Number(l) > Number(r);
      case '<': return Number(l) < Number(r);
      case '>=': return Number(l) >= Number(r);
      case '<=': return Number(l) <= Number(r);
      default: return Array.isArray(l) ? l.map(String).includes(String(r)) : String(l ?? '').includes(String(r ?? ''));
    }
  };
  return body.split(/\s+or\s+/).some((orPart) => orPart.split(/\s+and\s+/).every(clause));
}

/** Keep the settings whose `visible_if` holds (headers and paragraphs with a condition are filtered the same way). */
export function visibleSettings<T extends SettingDef>(defs: T[], scope: VisibilityScope): T[] {
  return defs.filter((d) => isVisible(d.visible_if, scope));
}

/* ----------------------------- color schemes ----------------------------- */

/** Scheme ids in order, with their display names ("Scheme 2" when a scheme has none). */
export function schemeOptions(schemes: SchemeSet | undefined): Array<{ id: string; name: string }> {
  return Object.entries(schemes ?? {}).map(([id, s], i) => ({ id, name: s?.settings?.name?.trim() || `Scheme ${i + 1}` }));
}

/** A new scheme (copy of `from` when given) under the next free `scheme-N` id. */
export function addScheme(schemes: SchemeSet, defaults: Record<string, string>, from?: string): { schemes: SchemeSet; id: string } {
  let n = Object.keys(schemes).length + 1;
  while (`scheme-${n}` in schemes) n++;
  const id = `scheme-${n}`;
  const base = from && schemes[from] ? { ...schemes[from]!.settings } : { ...defaults };
  return { id, schemes: { ...schemes, [id]: { settings: { ...base, name: from ? `${base.name ?? 'Scheme'} ${n}` : `Scheme ${n}` } } } };
}
