// Registry of the themes bundled with ShopMe: Aurora (`packages/theme-default`) plus every folder of `packages/themes/*`
// that holds a theme (a readable `config/settings_schema.json` with a `theme_info` group). The format is described in
// packages/themes/README.md.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { and, eq, sql } from 'drizzle-orm';
import type { Db } from '../db/client';
import { shops, themeFiles, themes } from '../db/schema';
import { getTheme, type Theme } from './content/content';
import { addEvent } from './events';
import type { Storage } from './storage';
import {
  cachedPackageFile, ensureMainTheme, installThemeFiles, localizeSeedTexts, parseThemeJson, readBundledTheme, recordThemeOrigin, seedDefaultsFor, seedDefaultsOf, type BundledTheme,
} from './theme-install';
import { deleteTheme } from './theme-zip';

/** Where the bundled themes live. */
export interface ThemeRoots {
  /** The default theme (Aurora). */
  defaultDir: string;
  /** Folder whose sub-folders are themes (`packages/themes`). May not exist. */
  themesDir?: string | null;
  /** Folder with `<handle>-desktop.webp` / `<handle>-mobile.webp` previews. Default: `<themesDir>/previews`. */
  previewsDir?: string | null;
}

export interface BundledThemeInfo extends BundledTheme {
  author: string;
  /** English description (`shopme_description`). */
  description: string;
  /** Descriptions per language (`shopme_descriptions`), e.g. `{ "fr": "..." }`. */
  descriptions: Record<string, string>;
  /** Free-form English tags (`shopme_tags`), e.g. "Fashion". */
  tags: string[];
  /** Industries the theme is made for (`shopme_industries`, slugs such as `fashion` or `home-decor`): the theme store's "Industry" facet. */
  industries: string[];
  /** How many products the theme is made for (`shopme_catalog_size`): the theme store's "Catalog size" facet. */
  catalogSize: CatalogSize | null;
  /** Features of the theme (`shopme_features`, slugs such as `mega-menu`): the theme store's "Features" facet. */
  features: string[];
  /** Absolute folder of the theme. */
  dir: string;
  /** Languages (besides English) the theme has seed texts for (`seed_defaults` in `locales/<language>.json`). */
  seedLocales: string[];
}

/** Catalog sizes a theme can be made for: a single product, a few, some or many. */
export const CATALOG_SIZES = ['one', 'few', 'some', 'many'] as const;
export type CatalogSize = (typeof CATALOG_SIZES)[number];
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const AURORA_HANDLE = 'aurora';
/** Folders of `packages/themes` that are not themes. */
export const NON_THEME_FOLDERS = new Set(['previews', 'node_modules']);
const HANDLE_RE = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

/** `theme_info` of a theme folder's settings schema (null when missing or unreadable). */
function themeInfoGroup(dir: string): Record<string, unknown> | null {
  return cachedPackageFile(path.join(dir, 'config', 'settings_schema.json'), (text) => {
    const groups = parseThemeJson(text);
    const found = Array.isArray(groups) ? (groups as unknown[]).find((g) => isObj(g) && g.name === 'theme_info') : null;
    return isObj(found) ? found : null;
  }, 'theme_info');
}

/** Languages a theme has seed texts for. */
function seedLocalesOf(dir: string): string[] {
  const locales = path.join(dir, 'locales');
  if (!existsSync(locales)) return [];
  const out: string[] = [];
  for (const f of readdirSync(locales).sort()) {
    const m = /^([a-z]{2,3})\.json$/.exec(f);
    if (m && Object.keys(seedDefaultsOf(dir, m[1]!)).length) out.push(m[1]!);
  }
  return out;
}

/** Registry entry of a theme folder; null when the folder is not a theme. */
export function readThemeInfo(dir: string, handle: string): BundledThemeInfo | null {
  const base = readBundledTheme(dir, handle);
  const info = themeInfoGroup(dir);
  if (!base || !info) return null;
  const descriptions = isObj(info.shopme_descriptions)
    ? Object.fromEntries(Object.entries(info.shopme_descriptions).map(([k, v]) => [k.toLowerCase(), str(v)] as const).filter(([, v]) => v))
    : {};
  const tags = Array.isArray(info.shopme_tags) ? [...new Set(info.shopme_tags.map(str).filter(Boolean))] : [];
  const slugs = (v: unknown) => (Array.isArray(v) ? [...new Set(v.map(str).filter((x) => SLUG_RE.test(x)))] : []);
  const size = str(info.shopme_catalog_size);
  const catalogSize = (CATALOG_SIZES as readonly string[]).includes(size) ? (size as CatalogSize) : null;
  return { ...base, author: str(info.theme_author), description: str(info.shopme_description), descriptions, tags, industries: slugs(info.shopme_industries), catalogSize, features: slugs(info.shopme_features), dir, seedLocales: seedLocalesOf(dir) };
}

/** The bundled themes: Aurora first, then the folders of `themesDir` in alphabetical order. */
export function discoverBundledThemes(roots: ThemeRoots): BundledThemeInfo[] {
  const out: BundledThemeInfo[] = [];
  const aurora = readThemeInfo(roots.defaultDir, AURORA_HANDLE);
  if (aurora) out.push(aurora);
  const dir = roots.themesDir;
  if (dir && existsSync(dir)) {
    for (const name of readdirSync(dir).sort()) {
      if (name.startsWith('.') || NON_THEME_FOLDERS.has(name) || name === AURORA_HANDLE || !HANDLE_RE.test(name)) continue;
      const full = path.join(dir, name);
      try { if (!statSync(full).isDirectory()) continue; } catch { continue; }
      const info = readThemeInfo(full, name);
      if (info) out.push(info);
    }
  }
  return out;
}

export function findBundledTheme(roots: ThemeRoots, handle: string): BundledThemeInfo | null {
  if (handle === AURORA_HANDLE) return readThemeInfo(roots.defaultDir, AURORA_HANDLE);
  if (!roots.themesDir || !HANDLE_RE.test(handle) || NON_THEME_FOLDERS.has(handle)) return null;
  const full = path.join(roots.themesDir, handle);
  return existsSync(full) ? readThemeInfo(full, handle) : null;
}

/** Description of a theme in `locale` (falls back to English). */
export function bundledThemeDescription(info: Pick<BundledThemeInfo, 'description' | 'descriptions'>, locale: string | null | undefined): string {
  const language = (locale ?? 'en').toLowerCase().split(/[-_]/)[0]!;
  return info.descriptions[(locale ?? '').toLowerCase()] ?? info.descriptions[language] ?? info.description;
}

export const previewsDirOf = (roots: ThemeRoots): string | null => roots.previewsDir ?? (roots.themesDir ? path.join(roots.themesDir, 'previews') : null);

/** File names of a theme's previews (`<handle>-desktop.webp`, `<handle>-mobile.webp`) that exist; null for a missing one. */
export function themePreviewFiles(roots: ThemeRoots, handle: string): { desktop: string | null; mobile: string | null } {
  const dir = previewsDirOf(roots);
  const pick = (kind: 'desktop' | 'mobile') => {
    const f = `${handle}-${kind}.webp`;
    return dir && existsSync(path.join(dir, f)) ? f : null;
  };
  return { desktop: pick('desktop'), mobile: pick('mobile') };
}

/** Read a preview image by file name (`aurora-desktop.webp`); null when the name is not a preview or the file is missing. */
export function readThemePreview(roots: ThemeRoots, file: string): Buffer | null {
  const dir = previewsDirOf(roots);
  if (!dir || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?-(?:desktop|mobile)\.webp$/.test(file)) return null;
  try { return readFileSync(path.join(dir, file)); } catch { return null; }
}

/* ------------------------------ install ------------------------------ */

/** Write a bundled theme's files into `themeId` (seed texts in the shop's language when the theme has them) and record its origin. */
async function installInto(db: Db, storage: Storage | undefined, shopId: number, themeId: number, info: BundledThemeInfo): Promise<void> {
  const [shop] = await db.select({ locale: shops.locale }).from(shops).where(eq(shops.id, shopId)).limit(1);
  const seeds = seedDefaultsFor(info.dir, shop?.locale);
  await installThemeFiles(db, shopId, themeId, info.dir, (files) => localizeSeedTexts(files, seeds), storage);
  await recordThemeOrigin(db, themeId, info);
}

/** Add a bundled theme to the shop's theme library as a new, unpublished theme, and record its origin. */
export async function installBundledTheme(db: Db, storage: Storage, shopId: number, info: BundledThemeInfo, o: { staffId?: number | null } = {}): Promise<Theme> {
  const [row] = await db.insert(themes).values({ shopId, name: info.name.slice(0, 255), role: 'UNPUBLISHED', processing: true }).returning();
  const id = row!.id;
  try {
    await installInto(db, storage, shopId, id, info);
    await db.update(themes).set({ processing: false, updatedAt: new Date() }).where(eq(themes.id, id));
    await addEvent(db, shopId, { subjectType: 'theme', subjectId: id, verb: 'themes/create', message: `Theme ${info.name} ${info.version} was added to the library`, authorStaffUserId: o.staffId ?? null });
  } catch (e) {
    await deleteTheme(db, storage, shopId, id).catch(() => undefined);
    throw e;
  }
  return (await getTheme(db, shopId, id))!;
}

/**
 * Install a bundled theme as the shop's MAIN (published) theme when that theme has no files yet: the starting theme of a new
 * store. Returns true when files were installed.
 */
export async function installStartingTheme(db: Db, storage: Storage, shopId: number, info: BundledThemeInfo): Promise<boolean> {
  const main = await ensureMainTheme(db, shopId);
  const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(themeFiles).where(eq(themeFiles.themeId, main.id));
  if ((r?.n ?? 0) > 0) return false;
  await installInto(db, storage, shopId, main.id, info);
  await db.update(themes).set({ name: info.name }).where(and(eq(themes.id, main.id), eq(themes.shopId, shopId)));
  return true;
}
