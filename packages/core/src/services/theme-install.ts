import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { and, eq, sql } from 'drizzle-orm';
import type { Db, Executor } from '../db/client';
import { shops, themeFiles, themes } from '../db/schema';

/** Theme directories that make up a theme (anything else in a package, such as `src/`, is ignored). */
export const THEME_DIRS = ['layout', 'templates', 'sections', 'blocks', 'snippets', 'config', 'locales', 'assets'] as const;

const TEXT_TYPES: Record<string, string> = {
  '.liquid': 'text/x-liquid', '.json': 'application/json', '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.svg': 'image/svg+xml', '.txt': 'text/plain', '.html': 'text/html',
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
export async function installThemeFiles(db: Db, shopId: number, themeId: number, dir: string, transform?: (files: ReturnType<typeof readThemeDir>) => ReturnType<typeof readThemeDir>): Promise<number> {
  const files = transform ? transform(readThemeDir(dir)) : readThemeDir(dir);
  await db.transaction(async (tx) => {
    await tx.delete(themeFiles).where(and(eq(themeFiles.themeId, themeId), eq(themeFiles.shopId, shopId)));
    for (let i = 0; i < files.length; i += 50) {
      await tx.insert(themeFiles).values(files.slice(i, i + 50).map((f) => ({
        themeId, shopId, path: f.path, contentType: f.contentType, body: f.body,
        checksum: createHash('md5').update(f.body).digest('hex'), sizeBytes: Buffer.byteLength(f.body),
      })));
    }
  });
  return files.length;
}

/** The MAIN theme row of a shop (created if missing). */
export async function ensureMainTheme(db: Executor, shopId: number): Promise<{ id: number; name: string }> {
  const [t] = await db.select({ id: themes.id, name: themes.name }).from(themes).where(and(eq(themes.shopId, shopId), eq(themes.role, 'MAIN'))).limit(1);
  if (t) return t;
  const [c] = await db.insert(themes).values({ shopId, name: 'Aurora', role: 'MAIN' }).returning({ id: themes.id, name: themes.name });
  return c!;
}

/** Install the default theme into the shop's MAIN theme when that theme has no files yet. Returns true when files were installed. */
export async function ensureDefaultTheme(db: Db, shopId: number, dir: string): Promise<boolean> {
  const main = await ensureMainTheme(db, shopId);
  const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(themeFiles).where(eq(themeFiles.themeId, main.id));
  if ((r?.n ?? 0) > 0 || !existsSync(dir)) return false;
  // A French shop gets the seed texts in French; other locales keep the English defaults.
  const [shop] = await db.select({ locale: shops.locale }).from(shops).where(eq(shops.id, shopId)).limit(1);
  const fr = shop?.locale.toLowerCase().startsWith('fr') ? frenchSeedDefaults(dir) : {};
  await installThemeFiles(db, shopId, main.id, dir, (files) => localizeSeedTexts(files, fr));
  await db.update(themes).set({ name: 'Aurora' }).where(and(eq(themes.id, main.id), eq(themes.name, 'Default')));
  return true;
}
