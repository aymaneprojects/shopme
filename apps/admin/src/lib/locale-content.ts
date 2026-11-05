// Theme content: the translatable strings of a theme (`locales/<code>.json`) as a flat, editable table.

export type Tree = { [key: string]: string | Tree };

/** Parse a locale file (comments tolerated); null when it is not a JSON object. */
export function parseLocale(text: string | undefined): Tree | null {
  if (text === undefined) return null;
  try {
    const v = JSON.parse(text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')) as unknown;
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Tree) : null;
  } catch { return null; }
}

/** Top-level keys that hold something other than texts shown on the storefront. */
const HIDDEN = new Set(['seed_defaults']);

/** Every text of the tree by dotted key (`products.add_to_cart`), in file order. */
export function flatten(tree: Tree, prefix = '', out: Record<string, string> = {}): Record<string, string> {
  for (const [k, v] of Object.entries(tree)) {
    if (!prefix && HIDDEN.has(k)) continue;
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === 'string') out[key] = v; else if (v && typeof v === 'object') flatten(v, key, out);
  }
  return out;
}

/** The tree with `edits` applied: a text is set at its dotted key (missing branches are created); an empty text removes the key and branches left empty. */
export function applyEdits(tree: Tree, edits: Record<string, string>): Tree {
  const out = structuredClone(tree);
  for (const [key, value] of Object.entries(edits)) {
    const path = key.split('.');
    const parents: Tree[] = [out];
    let cur = out;
    for (const p of path.slice(0, -1)) {
      let next = cur[p];
      if (typeof next !== 'object' || next === null) { if (value === '') { cur = {}; break; } next = {}; cur[p] = next; }
      cur = next; parents.push(cur);
    }
    const last = path.at(-1)!;
    if (value === '') {
      delete cur[last];
      for (let i = parents.length - 1; i > 0; i--) if (!Object.keys(parents[i]!).length) delete parents[i - 1]![path[i - 1]!];
    } else cur[last] = value;
  }
  return out;
}

export const serializeLocale = (tree: Tree) => `${JSON.stringify(tree, null, 2)}\n`;

/** `{{ name }}` placeholders of a text. */
export const placeholders = (text: string): string[] => [...text.matchAll(/\{\{\s*([\w.]+)\s*\}\}/g)].map((m) => m[1]!).sort();

/** A translation that drops or invents a placeholder of the default text. */
export const placeholdersDiffer = (source: string, text: string): boolean => text !== '' && placeholders(source).join() !== placeholders(text).join();

export interface LocaleFile { code: string; path: string; isDefault: boolean }
/** The locale files of a theme (`locales/en.default.json`, `locales/fr.json`), default first. */
export function localeFiles(paths: string[]): LocaleFile[] {
  const out: LocaleFile[] = [];
  for (const path of paths) {
    const m = /^locales\/([A-Za-z]{2,3}(?:-[A-Za-z0-9]+)*)(\.default)?\.json$/.exec(path);
    if (m) out.push({ code: m[1]!, path, isDefault: !!m[2] });
  }
  return out.sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || a.code.localeCompare(b.code));
}
