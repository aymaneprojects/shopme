import { parseJsonc } from './jsonc';
import type { FileSchema, ImageValue, ResourceResolvers, SettingDef } from './types';

const SCHEMA_RE = /\{%-?\s*schema\s*-?%\}([\s\S]*?)\{%-?\s*endschema\s*-?%\}/;

type Tree = Record<string, unknown>;

/** An in-memory theme: text files by path (`sections/header.liquid`, `config/settings_data.json`, ...). */
export class Theme {
  readonly id: number | string;
  readonly version: string;
  private files: Map<string, string>;
  private jsonCache = new Map<string, unknown>();
  private schemaCache = new Map<string, FileSchema | null>();

  constructor(files: Record<string, string> | Map<string, string>, opts: { id?: number | string; version?: string } = {}) {
    this.files = files instanceof Map ? files : new Map(Object.entries(files));
    this.id = opts.id ?? 0;
    this.version = opts.version ?? '1';
  }

  has(path: string): boolean { return this.files.has(path); }
  read(path: string): string | undefined { return this.files.get(path); }
  paths(prefix = ''): string[] { return [...this.files.keys()].filter((p) => p.startsWith(prefix)); }

  /** Liquid source ready for parsing: `{% schema %}` and `{% doc %}` bodies are blanked (they are JSON/docs, not Liquid; the schema is read separately). */
  source(path: string): string | undefined {
    const raw = this.files.get(path);
    if (raw === undefined || !path.endsWith('.liquid')) return raw;
    return raw.replace(/(\{%-?\s*(schema|doc)\s*-?%\})[\s\S]*?(\{%-?\s*end\2\s*-?%\})/g, '$1$3');
  }

  json<T = unknown>(path: string): T | undefined {
    if (this.jsonCache.has(path)) return this.jsonCache.get(path) as T;
    const text = this.files.get(path);
    let value: unknown;
    if (text !== undefined) { try { value = parseJsonc(text); } catch { value = undefined; } }
    this.jsonCache.set(path, value);
    return value as T | undefined;
  }

  /** Parsed `{% schema %}` JSON of a section or block file. */
  schema(path: string): FileSchema | null {
    if (this.schemaCache.has(path)) return this.schemaCache.get(path)!;
    const m = SCHEMA_RE.exec(this.files.get(path) ?? '');
    let s: FileSchema | null = null;
    if (m) { try { s = parseJsonc<FileSchema>(m[1]!); } catch { s = null; } }
    this.schemaCache.set(path, s);
    return s;
  }

  /** Locale tree for `code` (`en`, `fr`, `pt-BR`), falling back from region to language. */
  localeFile(code: string, schema = false): Tree | undefined {
    const suffix = schema ? '.schema.json' : '.json';
    const candidates = [code, code.split('-')[0]!];
    for (const c of candidates) {
      for (const p of [`locales/${c}${suffix}`, `locales/${c}.default${suffix}`]) {
        const j = this.json<Tree>(p);
        if (j) return j;
      }
    }
    return undefined;
  }

  defaultLocale(): string {
    for (const p of this.files.keys()) { const m = /^locales\/([A-Za-z-]+)\.default\.json$/.exec(p); if (m) return m[1]!; }
    return 'en';
  }

  /** Global setting definitions flattened from `config/settings_schema.json`. */
  globalSettingDefs(): SettingDef[] {
    const groups = this.json<{ name?: string; settings?: SettingDef[] }[]>('config/settings_schema.json') ?? [];
    return groups.flatMap((g) => g.settings ?? []);
  }

  /** Raw stored global settings (handles both `current: {…}` and `current: "Preset"`). */
  globalSettingValues(): Tree {
    const data = this.json<{ current?: unknown; presets?: Record<string, Tree> }>('config/settings_data.json');
    if (!data) return {};
    if (typeof data.current === 'string') return data.presets?.[data.current] ?? {};
    return (data.current as Tree) ?? {};
  }

  /** Resolve a template reference to a file. Suffix selects `<name>.<suffix>` when present. */
  findTemplate(name: string, suffix?: string | null): { path: string; kind: 'json' | 'liquid' } | null {
    const names = suffix ? [`${name}.${suffix}`, name] : [name];
    for (const n of names) {
      if (this.has(`templates/${n}.json`)) return { path: `templates/${n}.json`, kind: 'json' };
      if (this.has(`templates/${n}.liquid`)) return { path: `templates/${n}.liquid`, kind: 'liquid' };
    }
    return null;
  }
}

/** Dotted-path lookup in a translation tree. */
export function lookupKey(tree: Tree | undefined, key: string): unknown {
  let cur: unknown = tree;
  for (const part of key.split('.')) {
    if (cur && typeof cur === 'object' && part in (cur as Tree)) cur = (cur as Tree)[part];
    else return undefined;
  }
  return cur;
}

const FONT_WEIGHTS: Record<string, number> = { '1': 100, '2': 200, '3': 300, '4': 400, '5': 500, '6': 600, '7': 700, '8': 800, '9': 900 };

export interface FontValue { family: string; fallback_families: string; style: string; weight: number; system: boolean; baseline_ratio: number; variants: FontValue[]; src: Record<string, string>; handle: string }

const titleCase = (s: string) => s.split(/[-_ ]+/).filter(Boolean).map((w) => w[0]!.toUpperCase() + w.slice(1)).join(' ');

/** `inter_n4` / `helvetica_i7` / `system-ui` -> a font object. Only system and locally installed faces are produced. */
export function parseFont(handle: string): FontValue {
  const m = /^(.*)_([ni])([1-9])$/.exec(handle);
  const base = m ? m[1]! : handle;
  const style = m && m[2] === 'i' ? 'italic' : 'normal';
  const weight = m ? FONT_WEIGHTS[m[3]!]! : 400;
  const system = /^(system|sans|serif|mono|helvetica|georgia|arial)/.test(base) || base.startsWith('-');
  const family = system && /^system/.test(base) ? 'system-ui' : titleCase(base);
  return { handle, family, fallback_families: system ? 'sans-serif' : 'sans-serif', style, weight, system, baseline_ratio: 0.5, variants: [], src: {} };
}

const SHOPIFY_URI = /^shopify:\/\/(collections|products|pages|blogs|policies)\/(.+)$/;

/** Resolve `shopify://collections/x` style URIs to a storefront path. Other values pass through. */
export function resolveLinkValue(v: unknown): unknown {
  if (typeof v !== 'string') return v;
  const m = SHOPIFY_URI.exec(v);
  if (!m) return v;
  return `/${m[1]}/${m[2]}`;
}

export interface SettingsContext { resolvers: ResourceResolvers; schemaLocale?: Tree }

/** Turn stored values + definitions into the object Liquid sees as `settings`/`section.settings`/`block.settings`. */
export async function resolveSettings(defs: SettingDef[] | undefined, values: Record<string, unknown> | undefined, sc: SettingsContext): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  const tr = (v: unknown) => (typeof v === 'string' && v.startsWith('t:') ? String(lookupKey(sc.schemaLocale, v.slice(2)) ?? '') : v);
  for (const d of defs ?? []) {
    if (!d.id) continue;
    let v = values && d.id in values ? values[d.id] : d.default;
    if (v === undefined) v = defaultFor(d.type);
    v = tr(v);
    const empty = v === '' || v === null || v === undefined;
    switch (d.type) {
      case 'image_picker': v = empty ? null : ((await sc.resolvers.image?.(String(v))) ?? null); break;
      case 'font_picker': v = empty ? null : parseFont(String(v)); break;
      case 'collection': case 'product': case 'page': case 'blog': {
        const fn = sc.resolvers[d.type];
        v = empty || !fn ? null : ((await fn(String(v))) ?? null);
        break;
      }
      case 'metaobject': v = empty || !sc.resolvers.metaobject ? null : ((await sc.resolvers.metaobject(String(v))) ?? null); break;
      case 'metaobject_list': v = Array.isArray(v) && sc.resolvers.metaobject ? (await Promise.all(v.map((h) => sc.resolvers.metaobject!(String(h))))).filter(Boolean) : []; break;
      case 'link_list': v = empty || !sc.resolvers.linklist ? null : ((await sc.resolvers.linklist(String(v))) ?? null); break;
      case 'collection_list': v = Array.isArray(v) && sc.resolvers.collection ? (await Promise.all(v.map((h) => sc.resolvers.collection!(String(h))))).filter(Boolean) : []; break;
      case 'url': v = resolveLinkValue(v); break;
      case 'video': case 'video_url': v = empty ? null : v; break;
      default: break;
    }
    out[d.id] = v;
  }
  // Values without a definition (legacy data) are still readable.
  for (const [k, val] of Object.entries(values ?? {})) if (!(k in out)) out[k] = val;
  return out;
}

function defaultFor(type: string): unknown {
  if (type === 'checkbox') return false;
  if (type === 'range' || type === 'number') return 0;
  if (type === 'header' || type === 'paragraph') return undefined;
  return '';
}

export type { ImageValue };
