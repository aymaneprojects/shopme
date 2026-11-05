// Theme code editor helpers: the file tree, new file names and starter contents.

export const THEME_DIRS = ['layout', 'templates', 'sections', 'blocks', 'snippets', 'assets', 'config', 'locales'] as const;
export type ThemeDir = (typeof THEME_DIRS)[number];
/** Extensions the store keeps as text (the others, such as fonts and images, are binary assets). */
export const TEXT_EXT = ['liquid', 'json', 'css', 'js', 'mjs', 'svg', 'txt', 'html'] as const;
const BINARY_EXT = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'ico', 'woff', 'woff2', 'ttf', 'otf', 'eot', 'mp4', 'webm', 'mp3'];
export type Language = 'liquid' | 'json' | 'css' | 'js' | 'html' | 'text';

export const extOf = (path: string): string => (/\.([A-Za-z0-9]+)$/.exec(path)?.[1] ?? '').toLowerCase();
export const isTextFile = (path: string): boolean => (TEXT_EXT as readonly string[]).includes(extOf(path));
export const isImageFile = (path: string): boolean => ['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'ico', 'svg'].includes(extOf(path));
export const dirOf = (path: string): string => path.split('/')[0] ?? '';
export const baseOf = (path: string): string => path.split('/').slice(1).join('/');

export function languageOf(path: string): Language {
  switch (extOf(path)) {
    case 'liquid': return 'liquid';
    case 'json': return 'json';
    case 'css': return 'css';
    case 'js': case 'mjs': return 'js';
    case 'html': case 'svg': return 'html';
    default: return 'text';
  }
}

export interface FileGroup { dir: string; files: string[] }
/** The files by directory in the order of {@link THEME_DIRS}, narrowed by a search text (a path part, case-insensitive). */
export function groupFiles(paths: string[], find = ''): FileGroup[] {
  const n = find.trim().toLowerCase();
  const kept = paths.filter((p) => !n || p.toLowerCase().includes(n));
  const known = THEME_DIRS.map((dir) => ({ dir: dir as string, files: kept.filter((p) => dirOf(p) === dir).sort((a, b) => a.localeCompare(b)) }));
  const other = kept.filter((p) => !(THEME_DIRS as readonly string[]).includes(dirOf(p)));
  return [...known, ...(other.length ? [{ dir: 'other', files: other.sort() }] : [])].filter((g) => g.files.length || (!n && (THEME_DIRS as readonly string[]).includes(g.dir)));
}

const DEFAULT_EXT: Record<string, string> = { layout: 'liquid', templates: 'json', sections: 'liquid', blocks: 'liquid', snippets: 'liquid', assets: 'css', config: 'json', locales: 'json' };

export type NewFileResult = { ok: true; path: string } | { ok: false; error: 'dir' | 'name' | 'ext' | 'exists' };
/** The path of a new file typed as `name` in `dir`: the extension is added when missing; names are limited to letters, digits, `-`, `_`, `.` and sub-folders. */
export function newFilePath(dir: string, name: string, existing: string[]): NewFileResult {
  if (!(THEME_DIRS as readonly string[]).includes(dir)) return { ok: false, error: 'dir' };
  let n = name.trim().replace(/^\/+/, '');
  if (!n || !/^[\w\-./]+$/.test(n) || n.includes('..') || n.endsWith('/') || n.includes('//')) return { ok: false, error: 'name' };
  if (!extOf(n) || !(TEXT_EXT as readonly string[]).includes(extOf(n)) && !BINARY_EXT.includes(extOf(n))) n = `${n}.${DEFAULT_EXT[dir]}`;
  if (!(TEXT_EXT as readonly string[]).includes(extOf(n))) return { ok: false, error: 'ext' };
  const path = `${dir}/${n}`;
  return existing.includes(path) ? { ok: false, error: 'exists' } : { ok: true, path };
}

/** A new name for a file: it stays in its directory and keeps its type. */
export function renamedPath(path: string, name: string, existing: string[]): NewFileResult {
  const r = newFilePath(dirOf(path), name, existing.filter((p) => p !== path));
  if (r.ok && extOf(r.path) !== extOf(path)) return { ok: false, error: 'ext' };
  return r;
}

const titleOf = (path: string) => (path.split('/').at(-1) ?? '').replace(/\.[^.]+$/, '').replace(/[-_.]+/g, ' ').replace(/^./, (c) => c.toUpperCase());

/** Starting content of a new file. */
export function starterContent(path: string): string {
  const dir = dirOf(path); const ext = extOf(path);
  if (dir === 'sections' && ext === 'liquid') return `<div class="page-width section-pad">\n  <h2>{{ section.settings.heading | escape }}</h2>\n</div>\n\n{% schema %}\n{\n  "name": ${JSON.stringify(titleOf(path))},\n  "settings": [\n    { "type": "text", "id": "heading", "label": "Heading", "default": "Heading" }\n  ],\n  "presets": [{ "name": ${JSON.stringify(titleOf(path))} }]\n}\n{% endschema %}\n`;
  if (dir === 'sections' && ext === 'json') return `{\n  "name": ${JSON.stringify(titleOf(path))},\n  "sections": {},\n  "order": []\n}\n`;
  if (dir === 'blocks' && ext === 'liquid') {
    const n = JSON.stringify(titleOf(path));
    return `<div {{ block.shopify_attributes }}>\n  {{ block.settings.text | escape }}\n</div>\n\n{% schema %}\n{\n  "name": ${n},\n  "settings": [\n    { "type": "text", "id": "text", "label": "Text", "default": "Text" }\n  ],\n  "presets": [{ "name": ${n} }]\n}\n{% endschema %}\n`;
  }
  if (dir === 'snippets' && ext === 'liquid') return `{%- doc -%}\n  ${titleOf(path)}.\n{%- enddoc -%}\n`;
  if (dir === 'layout' && ext === 'liquid') return `<!doctype html>\n<html lang="{{ request.locale.iso_code }}">\n  <head>\n    <meta charset="utf-8">\n    <title>{{ page_title }}</title>\n    {{ content_for_header }}\n  </head>\n  <body>\n    <main>{{ content_for_layout }}</main>\n  </body>\n</html>\n`;
  if (dir === 'templates' && ext === 'json') return `{\n  "sections": {},\n  "order": []\n}\n`;
  if (ext === 'json') return '{}\n';
  return '';
}

/** `<value>` of a file size in a short form. */
export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  return n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`;
}
