import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { and, eq, sql } from 'drizzle-orm';
import type { Db, Executor } from '../db/client';
import { shops, themeFiles, themes } from '../db/schema';
import type { Storage } from './storage';

/** Theme directories that make up a theme (anything else in a package, such as `src/`, is ignored). */
export const THEME_DIRS = ['layout', 'templates', 'sections', 'blocks', 'snippets', 'config', 'locales', 'assets'] as const;

const TEXT_TYPES: Record<string, string> = {
  '.liquid': 'text/x-liquid', '.json': 'application/json', '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.svg': 'image/svg+xml', '.txt': 'text/plain', '.html': 'text/html',
};

/** Binary files allowed under assets/ (stored in object storage, served by the storefront). */
export const BINARY_ASSET_TYPES: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.avif': 'image/avif', '.ico': 'image/x-icon',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.otf': 'font/otf', '.eot': 'application/vnd.ms-fontobject', '.mp4': 'video/mp4', '.webm': 'video/webm', '.mp3': 'audio/mpeg',
};

function walk(dir: string, base: string, out: string[]): void {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, base, out);
    else out.push(path.relative(base, full).split(path.sep).join('/'));
  }
}

/** Read the text files of a theme directory (`<dir>/layout/...`). Binary files are skipped. */
export function readThemeDir(dir: string): { path: string; body: string; contentType: string }[] {
  const files: string[] = [];
  for (const d of THEME_DIRS) if (existsSync(path.join(dir, d))) walk(path.join(dir, d), dir, files);
  const out: { path: string; body: string; contentType: string }[] = [];
  for (const f of files.sort()) {
    const contentType = TEXT_TYPES[path.extname(f).toLowerCase()];
    if (contentType) out.push({ path: f, body: readFileSync(path.join(dir, f), 'utf8'), contentType });
  }
  return out;
}

/** The binary assets (fonts, images) of a theme directory. */
export function readThemeBinaries(dir: string): { path: string; data: Buffer; contentType: string }[] {
  const root = path.join(dir, 'assets');
  if (!existsSync(root)) return [];
  const files: string[] = [];
  walk(root, dir, files);
  const out: { path: string; data: Buffer; contentType: string }[] = [];
  for (const f of files.sort()) {
    const contentType = BINARY_ASSET_TYPES[path.extname(f).toLowerCase()];
    if (contentType) out.push({ path: f, data: readFileSync(path.join(dir, f)), contentType });
  }
  return out;
}

/**
 * Replace the English seed texts of the default theme (section settings and schema defaults, as quoted JSON strings) with
 * their translations from `seedDefaults` (`seed_defaults` in `locales/fr.json`). Only applied at install, so merchant edits
 * and existing installs are not touched.
 */
export function localizeSeedTexts<F extends { path: string; body: string }>(files: F[], seedDefaults: Record<string, string>): F[] {
  return files.map((f) => {
    if (f.path.startsWith('locales/') || !/\.(liquid|json)$/.test(f.path)) return f; // the map itself is a locale file
    let body = f.body;
    for (const [en, fr] of Object.entries(seedDefaults)) body = body.split(JSON.stringify(en)).join(JSON.stringify(fr));
    return body === f.body ? f : { ...f, body };
  });
}

/** The `seed_defaults` map of the theme's French locale file (empty when missing). */
export function frenchSeedDefaults(dir: string): Record<string, string> {
  try {
    const fr = JSON.parse(readFileSync(path.join(dir, 'locales', 'fr.json'), 'utf8')) as { seed_defaults?: Record<string, string> };
    return fr.seed_defaults ?? {};
  } catch { return {}; }
}

/** Replace all files of a theme with those found in `dir` (optionally transformed first). */
export async function installThemeFiles(db: Db, shopId: number, themeId: number, dir: string, transform?: (files: ReturnType<typeof readThemeDir>) => ReturnType<typeof readThemeDir>, storage?: Storage): Promise<number> {
  const files = transform ? transform(readThemeDir(dir)) : readThemeDir(dir);
  const binaries: (typeof themeFiles.$inferInsert)[] = [];
  for (const b of storage ? readThemeBinaries(dir) : []) {
    const checksum = createHash('md5').update(b.data).digest('hex');
    const key = `themes/${themeId}/${checksum}-${path.basename(b.path).replace(/[^A-Za-z0-9._-]/g, '_')}`;
    await storage!.put(key, b.data);
    binaries.push({ themeId, shopId, path: b.path, contentType: b.contentType, body: null, storageKey: key, checksum, sizeBytes: b.data.length });
  }
  await db.transaction(async (tx) => {
    await tx.delete(themeFiles).where(and(eq(themeFiles.themeId, themeId), eq(themeFiles.shopId, shopId)));
    for (let i = 0; i < files.length; i += 50) {
      await tx.insert(themeFiles).values(files.slice(i, i + 50).map((f) => ({
        themeId, shopId, path: f.path, contentType: f.contentType, body: f.body,
        checksum: createHash('md5').update(f.body).digest('hex'), sizeBytes: Buffer.byteLength(f.body),
      })));
    }
    if (binaries.length) await tx.insert(themeFiles).values(binaries);
  });
  return files.length + binaries.length;
}

/** Theme JSON files may start with a `/* ... *\/` banner; strip comments before parsing. */
export const parseThemeJson = (body: string): unknown => JSON.parse(body.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, ''));

/** A small file of a theme package, parsed with `parse`, read again only when it changes on disk (null when missing or invalid). */
const packageFiles = new Map<string, { mtime: number; value: unknown }>();
export function cachedPackageFile<T>(file: string, parse: (text: string) => T): T | null {
  let mtime: number;
  try { mtime = statSync(file).mtimeMs; } catch { return null; }
  const hit = packageFiles.get(file);
  if (hit && hit.mtime === mtime) return hit.value as T;
  let value: T | null = null;
  try { value = parse(readFileSync(file, 'utf8')); } catch { value = null; }
  packageFiles.set(file, { mtime, value });
  return value;
}

export interface BundledTheme { handle: string; name: string; version: string }

/** A stable handle for a theme name (`Aurora` -> `aurora`). */
export const themeHandle = (name: string) => name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** Name and version of the theme in a package directory (`theme_info` of `config/settings_schema.json`). */
export function readBundledTheme(dir: string): BundledTheme | null {
  return cachedPackageFile(path.join(dir, 'config', 'settings_schema.json'), (text) => {
    const groups = parseThemeJson(text);
    const info = Array.isArray(groups) ? (groups as Record<string, unknown>[]).find((g) => g && g.name === 'theme_info') : undefined;
    const name = typeof info?.theme_name === 'string' ? info.theme_name : '';
    const version = typeof info?.theme_version === 'string' ? info.theme_version : '';
    return name && version ? { handle: themeHandle(name), name, version } : null;
  });
}

/** Checksums of a theme's files as stored, by path. */
export async function themeChecksums(db: Executor, themeId: number): Promise<Record<string, string>> {
  const rows = await db.select({ path: themeFiles.path, checksum: themeFiles.checksum }).from(themeFiles).where(eq(themeFiles.themeId, themeId));
  return Object.fromEntries(rows.map((r) => [r.path, r.checksum]));
}

/** Record that a theme was just installed from the bundled theme: its version, and the checksum of every file as installed (the baseline of the merchant's edits). */
export async function recordThemeOrigin(db: Executor, themeId: number, bundled: BundledTheme): Promise<void> {
  await db.update(themes).set({ originTheme: bundled.handle, originVersion: bundled.version, originChecksums: await themeChecksums(db, themeId) }).where(eq(themes.id, themeId));
}

/** The MAIN theme row of a shop (created if missing). */
export async function ensureMainTheme(db: Executor, shopId: number): Promise<{ id: number; name: string }> {
  const [t] = await db.select({ id: themes.id, name: themes.name }).from(themes).where(and(eq(themes.shopId, shopId), eq(themes.role, 'MAIN'))).limit(1);
  if (t) return t;
  const [c] = await db.insert(themes).values({ shopId, name: 'Aurora', role: 'MAIN' }).returning({ id: themes.id, name: themes.name });
  return c!;
}

/** Install the default theme into the shop's MAIN theme when that theme has no files yet. Returns true when files were installed. */
export async function ensureDefaultTheme(db: Db, shopId: number, dir: string, storage?: Storage): Promise<boolean> {
  const main = await ensureMainTheme(db, shopId);
  const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(themeFiles).where(eq(themeFiles.themeId, main.id));
  if ((r?.n ?? 0) > 0 || !existsSync(dir)) return false;
  // A French shop gets the seed texts in French; other locales keep the English defaults.
  const [shop] = await db.select({ locale: shops.locale }).from(shops).where(eq(shops.id, shopId)).limit(1);
  const fr = shop?.locale.toLowerCase().startsWith('fr') ? frenchSeedDefaults(dir) : {};
  await installThemeFiles(db, shopId, main.id, dir, (files) => localizeSeedTexts(files, fr), storage);
  await db.update(themes).set({ name: 'Aurora' }).where(and(eq(themes.id, main.id), eq(themes.name, 'Default')));
  const bundled = readBundledTheme(dir);
  if (bundled) await recordThemeOrigin(db, main.id, bundled);
  return true;
}
