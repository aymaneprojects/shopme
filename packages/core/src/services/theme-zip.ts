import { createHash } from 'node:crypto';
import path from 'node:path';
import { and, eq, inArray } from 'drizzle-orm';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { themeFiles, themes } from '../db/schema';
import type { Db } from '../db/client';
import { errR, okR, txResult, type Result } from './catalog/common';
import { getTheme, publishTheme, type Theme } from './content/content';
import { THEME_DIRS } from './theme-install';
import type { Storage } from './storage';

export const MAX_THEME_ZIP_BYTES = 50 * 1024 * 1024;
const MAX_THEME_UNPACKED_BYTES = 200 * 1024 * 1024;
const MAX_THEME_FILES = 5000;

const TEXT_TYPES: Record<string, string> = {
  '.liquid': 'text/x-liquid', '.json': 'application/json', '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript', '.svg': 'image/svg+xml', '.txt': 'text/plain', '.html': 'text/html',
};
/** Binary files allowed under assets/ (stored in object storage, served by the storefront). */
const BINARY_TYPES: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.avif': 'image/avif', '.ico': 'image/x-icon',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.otf': 'font/otf', '.eot': 'application/vnd.ms-fontobject', '.mp4': 'video/mp4', '.webm': 'video/webm', '.mp3': 'audio/mpeg',
};
const SAFE_PATH = /^[\w\-. ]+(\/[\w\-. ]+)+$/;

export interface ThemeEntry { path: string; data: Uint8Array }

/**
 * Read a theme zip: strips a single wrapping folder, ignores junk (`__MACOSX`, dotfiles) and anything outside the
 * theme directories. Validates that the archive is a theme (`layout/theme.liquid`) and guards against zip bombs.
 */
export function readThemeZip(zip: Uint8Array): Result<{ entries: ThemeEntry[]; ignored: string[] }> {
  if (zip.length > MAX_THEME_ZIP_BYTES) return errR(['source'], 'The zip file is too large (maximum is 50MB)', 'INVALID');
  let total = 0; let count = 0;
  let raw: Record<string, Uint8Array>;
  try {
    raw = unzipSync(zip, { filter: (f) => { total += f.originalSize; count++; return !f.name.endsWith('/') && total <= MAX_THEME_UNPACKED_BYTES && count <= MAX_THEME_FILES * 2; } });
  } catch { return errR(['source'], 'The file is not a valid zip archive', 'INVALID'); }
  if (total > MAX_THEME_UNPACKED_BYTES) return errR(['source'], 'The zip file expands to more than 200MB', 'INVALID');
  const names = Object.keys(raw).filter((n) => !n.startsWith('__MACOSX/') && !n.split('/').some((p) => p.startsWith('.')));
  // Strip one wrapping folder (GitHub and desktop zippers add one).
  const root = names.length && names.every((n) => n.includes('/') && n.split('/')[0] === names[0]!.split('/')[0]) && !(THEME_DIRS as readonly string[]).includes(names[0]!.split('/')[0]!) ? `${names[0]!.split('/')[0]}/` : '';
  const entries: ThemeEntry[] = []; const ignored: string[] = [];
  for (const n of names) {
    const rel = n.slice(root.length);
    const top = rel.split('/')[0]!;
    const ext = path.extname(rel).toLowerCase();
    const ok = (THEME_DIRS as readonly string[]).includes(top) && rel.includes('/') && SAFE_PATH.test(rel) && !rel.includes('..')
      && (TEXT_TYPES[ext] || (top === 'assets' && BINARY_TYPES[ext]));
    if (ok) entries.push({ path: rel, data: raw[n]! }); else ignored.push(rel);
  }
  if (!entries.some((e) => e.path === 'layout/theme.liquid')) return errR(['source'], 'Not a valid theme: layout/theme.liquid is missing', 'INVALID');
  if (!entries.some((e) => e.path.startsWith('templates/'))) return errR(['source'], 'Not a valid theme: the templates/ directory is missing', 'INVALID');
  if (entries.length > MAX_THEME_FILES) return errR(['source'], `Too many files (maximum is ${MAX_THEME_FILES})`, 'TOO_MANY_FILES');
  for (const e of entries) {
    if (path.extname(e.path).toLowerCase() === '.json') {
      try { JSON.parse(strFromU8(e.data).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')); } catch { return errR(['source'], `${e.path} is not valid JSON`, 'INVALID'); }
    }
  }
  return okR({ entries, ignored });
}

/** Replace all files of a theme with `entries` (text in the database, binaries in storage). */
export async function installThemeEntries(db: Db, storage: Storage, shopId: number, themeId: number, entries: ThemeEntry[]): Promise<number> {
  const rows: (typeof themeFiles.$inferInsert)[] = [];
  for (const e of entries) {
    const ext = path.extname(e.path).toLowerCase();
    const checksum = createHash('md5').update(e.data).digest('hex');
    if (TEXT_TYPES[ext]) rows.push({ themeId, shopId, path: e.path, contentType: TEXT_TYPES[ext]!, body: strFromU8(e.data), checksum, sizeBytes: e.data.length });
    else {
      const key = `themes/${themeId}/${checksum}-${path.basename(e.path).replace(/[^A-Za-z0-9._-]/g, '_')}`;
      await storage.put(key, Buffer.from(e.data));
      rows.push({ themeId, shopId, path: e.path, contentType: BINARY_TYPES[ext]!, body: null, storageKey: key, checksum, sizeBytes: e.data.length });
    }
  }
  await db.transaction(async (tx) => {
    await tx.delete(themeFiles).where(and(eq(themeFiles.themeId, themeId), eq(themeFiles.shopId, shopId)));
    for (let i = 0; i < rows.length; i += 50) await tx.insert(themeFiles).values(rows.slice(i, i + 50));
    await tx.update(themes).set({ updatedAt: new Date() }).where(eq(themes.id, themeId));
  });
  return rows.length;
}

const ROLES = ['UNPUBLISHED', 'DEVELOPMENT', 'DEMO'];

/** Create a theme from a zip. The role is UNPUBLISHED unless told otherwise; MAIN publishes it right away. */
export async function createThemeFromZip(db: Db, storage: Storage, shopId: number, zip: Uint8Array, o: { name?: string | null; role?: string | null; staffId?: number | null }): Promise<Result<{ theme: Theme; files: number; ignored: string[] }>> {
  const role = o.role ?? 'UNPUBLISHED';
  if (![...ROLES, 'MAIN'].includes(role)) return errR(['role'], `Role must be one of ${[...ROLES, 'MAIN'].join(', ')}`, 'INVALID');
  const read = readThemeZip(zip);
  if (!read.ok) return read;
  const name = o.name?.trim() || 'Imported theme';
  const [row] = await db.insert(themes).values({ shopId, name: name.slice(0, 255), role: role === 'MAIN' ? 'UNPUBLISHED' : role }).returning();
  const files = await installThemeEntries(db, storage, shopId, row!.id, read.value.entries);
  if (role === 'MAIN') { const p = await publishTheme(db, shopId, row!.id, o.staffId); if (!p.ok) return p; return okR({ theme: p.value, files, ignored: read.value.ignored }); }
  return okR({ theme: row!, files, ignored: read.value.ignored });
}

/** Zip of a theme's files (what `GET /admin/api/themes/:id/download.zip` sends). */
export async function buildThemeZip(db: Db, storage: Storage, shopId: number, themeId: number): Promise<Uint8Array | null> {
  if (!(await getTheme(db, shopId, themeId))) return null;
  const rows = await db.select().from(themeFiles).where(and(eq(themeFiles.shopId, shopId), eq(themeFiles.themeId, themeId)));
  const out: Record<string, Uint8Array> = {};
  for (const r of rows) {
    if (r.body !== null) out[r.path] = strToU8(r.body);
    else if (r.storageKey) {
      const s = await storage.open(r.storageKey);
      if (!s) continue;
      const chunks: Buffer[] = [];
      for await (const c of s) chunks.push(Buffer.from(c as Buffer));
      out[r.path] = new Uint8Array(Buffer.concat(chunks));
    }
  }
  return zipSync(out, { level: 6 });
}

export async function renameTheme(db: Db, shopId: number, id: number, name: string | null | undefined): Promise<Result<Theme>> {
  if (!(await getTheme(db, shopId, id))) return errR(['id'], 'Theme does not exist', 'NOT_FOUND');
  if (!name?.trim()) return errR(['input', 'name'], "Name can't be blank", 'BLANK');
  const [row] = await db.update(themes).set({ name: name.trim().slice(0, 255), updatedAt: new Date() }).where(and(eq(themes.shopId, shopId), eq(themes.id, id))).returning();
  return okR(row!);
}

/** Copy a theme and all its files into a new UNPUBLISHED theme (binary files share their stored object). */
export async function duplicateTheme(db: Db, shopId: number, id: number, name?: string | null): Promise<Result<Theme>> {
  const cur = await getTheme(db, shopId, id);
  if (!cur) return errR(['id'], 'Theme does not exist', 'NOT_FOUND');
  return txResult(db, async (tx) => {
    const [row] = await tx.insert(themes).values({ shopId, name: (name?.trim() || `Copy of ${cur.name}`).slice(0, 255), role: 'UNPUBLISHED' }).returning();
    const rows = await tx.select().from(themeFiles).where(and(eq(themeFiles.shopId, shopId), eq(themeFiles.themeId, id)));
    for (let i = 0; i < rows.length; i += 50) await tx.insert(themeFiles).values(rows.slice(i, i + 50).map((r) => ({ ...r, themeId: row!.id })));
    return okR(row!);
  });
}

/** Storage objects are shared between duplicated themes: delete one only when no file row references it any more. */
async function releaseObjects(db: Db, storage: Storage, keys: string[]) {
  for (const key of new Set(keys)) {
    const [still] = await db.select({ p: themeFiles.path }).from(themeFiles).where(eq(themeFiles.storageKey, key)).limit(1);
    if (!still) await storage.delete(key).catch(() => {});
  }
}

export async function deleteTheme(db: Db, storage: Storage, shopId: number, id: number): Promise<Result<number>> {
  const cur = await getTheme(db, shopId, id);
  if (!cur) return errR(['id'], 'Theme does not exist', 'NOT_FOUND');
  if (cur.role === 'MAIN') return errR(['id'], 'The live theme cannot be deleted', 'CANNOT_DELETE_MAIN_THEME');
  const keys = (await db.select({ k: themeFiles.storageKey }).from(themeFiles).where(eq(themeFiles.themeId, id))).map((r) => r.k).filter((k): k is string => !!k);
  await db.delete(themes).where(and(eq(themes.shopId, shopId), eq(themes.id, id)));
  await releaseObjects(db, storage, keys);
  return okR(id);
}

/** Shopify `themeFilesCopy`: copy files within a theme, overwriting the destination. */
export async function copyThemeFiles(db: Db, shopId: number, themeId: number, files: { srcFilename: string; dstFilename: string }[]): Promise<Result<string[]>> {
  if (!(await getTheme(db, shopId, themeId))) return errR(['themeId'], 'Theme does not exist', 'NOT_FOUND');
  for (const [i, f] of files.entries()) {
    const dir = f.dstFilename.split('/')[0]!;
    if (!SAFE_PATH.test(f.dstFilename) || f.dstFilename.includes('..') || !(THEME_DIRS as readonly string[]).includes(dir)) return errR(['files', String(i), 'dstFilename'], 'Filename is invalid', 'INVALID');
    if (path.extname(f.dstFilename).toLowerCase() !== path.extname(f.srcFilename).toLowerCase()) return errR(['files', String(i), 'dstFilename'], 'Source and destination must have the same file type', 'INVALID');
  }
  return txResult(db, async (tx) => {
    for (const [i, f] of files.entries()) {
      const [src] = await tx.select().from(themeFiles).where(and(eq(themeFiles.themeId, themeId), eq(themeFiles.path, f.srcFilename)));
      if (!src) return errR(['files', String(i), 'srcFilename'], `File ${f.srcFilename} does not exist`, 'NOT_FOUND');
      const { path: _p, ...rest } = src;
      await tx.insert(themeFiles).values({ ...rest, path: f.dstFilename, updatedAt: new Date() }).onConflictDoUpdate({ target: [themeFiles.themeId, themeFiles.path], set: { ...rest, updatedAt: new Date() } });
    }
    await tx.update(themes).set({ updatedAt: new Date() }).where(eq(themes.id, themeId));
    return okR(files.map((f) => f.dstFilename));
  });
}

/** Shopify `themeFilesDelete`. Wildcards (`*`) are not supported; required files (`layout/theme.liquid`) cannot be removed. */
export async function deleteThemeFiles(db: Db, storage: Storage, shopId: number, themeId: number, filenames: string[]): Promise<Result<string[]>> {
  if (!(await getTheme(db, shopId, themeId))) return errR(['themeId'], 'Theme does not exist', 'NOT_FOUND');
  if (filenames.includes('layout/theme.liquid')) return errR(['files'], 'layout/theme.liquid is required and cannot be deleted', 'INVALID');
  const rows = await db.select().from(themeFiles).where(and(eq(themeFiles.themeId, themeId), inArray(themeFiles.path, filenames)));
  const missing = filenames.find((f) => !rows.some((r) => r.path === f));
  if (missing) return errR(['files'], `File ${missing} does not exist`, 'THEME_FILES_NOT_FOUND');
  await db.delete(themeFiles).where(and(eq(themeFiles.themeId, themeId), inArray(themeFiles.path, filenames)));
  await db.update(themes).set({ updatedAt: new Date() }).where(eq(themes.id, themeId));
  await releaseObjects(db, storage, rows.map((r) => r.storageKey).filter((k): k is string => !!k));
  return okR(rows.map((r) => r.path));
}
