// Updates of the bundled themes (Aurora and the themes of packages/themes): a shop keeps the theme it installed in the database, so a newer version shipped
// with the server is offered as an update that creates a new, unpublished copy carrying the merchant's customizations.
import { createHash } from 'node:crypto';
import path from 'node:path';
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import type { Db, Executor } from '../db/client';
import { shops, themeFiles, themeFileVersions, themes, translations } from '../db/schema';
import { errR, okR, type Result } from './catalog/common';
import { getTheme, type Theme } from './content/content';
import { addEvent } from './events';
import { cachedPackageFile, localizeSeedTexts, seedDefaultsFor, parseThemeJson, readBundledTheme, readThemeBinaries, readThemeDir, type BundledTheme } from './theme-install';
import { findBundledTheme, type ThemeRoots } from './theme-registry';
import { releaseObjects } from './theme-zip';
import type { Storage } from './storage';

/* ------------------------------ bundled theme info ------------------------------ */

export interface ThemeReleaseNote { version: string; date: string | null; notes: string[] }

const md5 = (data: string | Buffer) => createHash('md5').update(data).digest('hex');
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** Compare dotted versions numerically (`1.10.0` > `1.9.2`); a missing part counts as 0. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(/[.+-]/).map((x) => Number.parseInt(x, 10) || 0);
  const pb = b.split(/[.+-]/).map((x) => Number.parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d < 0 ? -1 : 1;
  }
  return 0;
}

interface ChangelogFile { versions?: { version?: string; date?: string; notes?: Record<string, string[]> }[] }

/**
 * Release notes of the theme package (`changelog.json`) for the versions after `after` up to `upTo`, newest first, in
 * `locale` (falling back to English).
 */
export function readThemeReleaseNotes(dir: string, locale: string, o: { after?: string | null; upTo?: string | null } = {}): ThemeReleaseNote[] {
  const log = cachedPackageFile(path.join(dir, 'changelog.json'), (text) => JSON.parse(text) as ChangelogFile);
  const lang = locale.toLowerCase().split(/[-_]/)[0]!;
  return (log?.versions ?? [])
    .filter((v): v is { version: string; date?: string; notes?: Record<string, string[]> } => typeof v.version === 'string')
    .filter((v) => (!o.after || compareVersions(v.version, o.after) > 0) && (!o.upTo || compareVersions(v.version, o.upTo) <= 0))
    .sort((a, b) => compareVersions(b.version, a.version))
    .map((v) => ({ version: v.version, date: v.date ?? null, notes: (v.notes?.[lang] ?? v.notes?.en ?? []).filter((n) => typeof n === 'string') }));
}

/** MD5 sums of every file the bundled theme has shipped (`checksums.json`), by path. */
export function readKnownChecksums(dir: string): Record<string, string[]> {
  return cachedPackageFile(path.join(dir, 'checksums.json'), (text) => (JSON.parse(text) as { files?: Record<string, string[]> }).files ?? {}) ?? {};
}

export interface ThemeUpdateStatus { name: string; installedVersion: string | null; bundledVersion: string; updateAvailable: boolean }

/** How a theme stands against the bundled theme; null when it was not installed from it. */
export function themeUpdateStatus(theme: Pick<Theme, 'originTheme' | 'originVersion'>, bundled: BundledTheme | null): ThemeUpdateStatus | null {
  if (!bundled || !theme.originTheme || theme.originTheme !== bundled.handle) return null;
  const installed = theme.originVersion ?? null;
  return { name: bundled.name, installedVersion: installed, bundledVersion: bundled.version, updateAvailable: compareVersions(installed ?? '0', bundled.version) < 0 };
}

/* ------------------------------ origin of installed themes ------------------------------ */

const AURORA = { handle: 'aurora', name: 'Aurora', author: 'ShopMe contributors', marker: 'assets/aurora.css' };

/**
 * Mark the shop's themes that are Aurora but carry no origin (themes from an older export, like migration 0025 does for
 * existing themes): their settings schema names Aurora and its authors, and the theme has Aurora's stylesheet.
 */
export async function detectThemeOrigins(db: Executor, shopId: number): Promise<number> {
  const list = await db.select({ id: themes.id }).from(themes).where(and(eq(themes.shopId, shopId), isNull(themes.originTheme)));
  let marked = 0;
  for (const t of list) {
    const files = await db.select({ path: themeFiles.path, body: themeFiles.body }).from(themeFiles)
      .where(and(eq(themeFiles.themeId, t.id), inArray(themeFiles.path, ['config/settings_schema.json', AURORA.marker])));
    const schema = files.find((f) => f.path === 'config/settings_schema.json')?.body;
    if (!schema || !files.some((f) => f.path === AURORA.marker)) continue;
    let info: Record<string, unknown> | undefined;
    try { const g = parseThemeJson(schema); info = Array.isArray(g) ? g.find((x) => isObj(x) && x.name === 'theme_info') : undefined; } catch { continue; }
    if (info?.theme_name !== AURORA.name || info.theme_author !== AURORA.author) continue;
    await db.update(themes).set({ originTheme: AURORA.handle, originVersion: typeof info.theme_version === 'string' ? info.theme_version : '1.0.0' }).where(eq(themes.id, t.id));
    marked++;
  }
  return marked;
}

/* ------------------------------ update plan (pure) ------------------------------ */

export interface CurrentThemeFile { path: string; contentType: string; body: string | null; checksum: string; sizeBytes: number; storageKey: string | null }
export interface BundleTextFile { path: string; contentType: string; body: string }
export interface BundleBinaryFile { path: string; contentType: string; data: Buffer }

export type SkipReason = 'EDITED' | 'REMOVED_IN_NEW_VERSION' | 'UNREADABLE';
export interface SkippedFile { filename: string; reason: SkipReason }
export interface RemovedReference { filename: string; kind: 'SECTION' | 'BLOCK'; id: string; type: string }

export interface PlannedFile {
  path: string; contentType: string; checksum: string; sizeBytes: number;
  /** Text body, or null for a binary (then `data` to store, or the merchant's `storageKey` to share). */
  body: string | null; data?: Buffer; storageKey?: string | null;
  source: 'bundle' | 'merchant' | 'merged';
}

export interface UpdatePlan {
  files: PlannedFile[];
  /** MD5 of each file of the new version as shipped: the baseline that tells the merchant's next edits apart. */
  baseline: Record<string, string>;
  /** Merchant files kept or merged into the new version. */
  carriedOver: string[];
  skipped: SkippedFile[];
  removedReferences: RemovedReference[];
  /** Theme setting ids of `config/settings_data.json` the new version no longer has. */
  removedSettings: string[];
}

export interface UpdatePlanInput {
  current: CurrentThemeFile[];
  bundleText: BundleTextFile[];
  bundleBinary: BundleBinaryFile[];
  /** Whether the installed bundled theme had a file at this path (merchant-added files are not). */
  isBundledPath: (path: string) => boolean;
  /** Whether `checksum` is what the bundled theme installed at this path (the merchant did not edit it). */
  isPristine: (path: string, checksum: string) => boolean;
  /** The text the bundled theme installed at this path, when still known (from the file's history). */
  originalText?: (path: string) => string | undefined;
}

const SETTINGS_DATA = 'config/settings_data.json';
const SETTINGS_SCHEMA = 'config/settings_schema.json';
const isPageJson = (p: string) => /^templates\/.+\.json$/.test(p) || /^sections\/[^/]+\.json$/.test(p);
const isLocale = (p: string) => /^locales\/[^/]+\.json$/.test(p) && !p.endsWith('.schema.json');
const SCHEMA_RE = /\{%-?\s*schema\s*-?%\}([\s\S]*?)\{%-?\s*endschema\s*-?%\}/;
const pretty = (v: unknown) => `${JSON.stringify(v, null, 2)}\n`;

function tryJson(body: string | null | undefined): unknown {
  if (body == null) return undefined;
  try { return parseThemeJson(body); } catch { return undefined; }
}

/** Block types a section or block file declares in its `{% schema %}` (`@theme`, `@app` or local types). */
function schemaBlockTypes(body: string | undefined): Set<string> | null {
  const m = body ? SCHEMA_RE.exec(body) : null;
  if (!m) return new Set();
  const s = tryJson(m[1]!);
  if (!isObj(s)) return null; // unreadable schema: keep every block
  return new Set((Array.isArray(s.blocks) ? s.blocks : []).map((b) => (isObj(b) && typeof b.type === 'string' ? b.type : '')).filter(Boolean));
}

/** String leaves of a locale tree, keyed by their JSON-encoded path (keys may contain dots). */
function leaves(tree: unknown, at: string[] = [], out = new Map<string, string>()): Map<string, string> {
  if (typeof tree === 'string') out.set(JSON.stringify(at), tree);
  else if (isObj(tree)) for (const [k, v] of Object.entries(tree)) leaves(v, [...at, k], out);
  return out;
}
function setLeaf(tree: Record<string, unknown>, at: string[], value: string) {
  let cur = tree;
  for (const k of at.slice(0, -1)) { if (!isObj(cur[k])) cur[k] = {}; cur = cur[k] as Record<string, unknown>; }
  cur[at.at(-1)!] = value;
}

/** Setting ids of a `settings_schema.json` (null when it cannot be read). */
function schemaSettingIds(body: string | undefined): Set<string> | null {
  const groups = tryJson(body);
  if (!Array.isArray(groups)) return null;
  const ids = new Set<string>();
  for (const g of groups) if (isObj(g) && Array.isArray(g.settings)) for (const s of g.settings) if (isObj(s) && typeof s.id === 'string') ids.add(s.id);
  return ids;
}

/**
 * Work out the files of the updated theme: the new version's files, with the merchant's theme settings (keys the new
 * schema still has), JSON templates and section groups (without sections and blocks whose type is gone), locale edits and
 * own files (uploaded assets, added snippets or sections) carried over. Theme files the merchant edited are not merged:
 * the new version's file is used and the file is reported, so the edit can be made again.
 */
export function planThemeUpdate(input: UpdatePlanInput): UpdatePlan {
  const out = new Map<string, PlannedFile>();
  const baseline: Record<string, string> = {};
  for (const f of input.bundleText) {
    const checksum = md5(f.body);
    baseline[f.path] = checksum;
    out.set(f.path, { path: f.path, contentType: f.contentType, body: f.body, checksum, sizeBytes: Buffer.byteLength(f.body), source: 'bundle' });
  }
  for (const b of input.bundleBinary) {
    const checksum = md5(b.data);
    baseline[b.path] = checksum;
    out.set(b.path, { path: b.path, contentType: b.contentType, body: null, data: b.data, checksum, sizeBytes: b.data.length, source: 'bundle' });
  }

  const carried = new Set<string>();
  const skipped: SkippedFile[] = [];
  const pageJson: { path: string; tree: Record<string, unknown>; raw: CurrentThemeFile }[] = [];
  let mergeSettings: CurrentThemeFile | null = null;
  const keep = (f: CurrentThemeFile, body = f.body, source: PlannedFile['source'] = 'merchant') => {
    const changed = body !== f.body;
    out.set(f.path, { path: f.path, contentType: f.contentType, body, storageKey: body === null ? f.storageKey : null, checksum: changed ? md5(body!) : f.checksum, sizeBytes: changed ? Buffer.byteLength(body!) : f.sizeBytes, source });
    carried.add(f.path);
  };

  for (const f of input.current) {
    const next = baseline[f.path];
    if (next === f.checksum) continue; // same as the new version
    const bundled = input.isBundledPath(f.path);
    if (bundled && input.isPristine(f.path, f.checksum)) continue; // untouched since install: the new version's file (or its removal) applies
    const inNew = next !== undefined;

    if (f.path === SETTINGS_DATA && f.body !== null) {
      if (isObj(tryJson(f.body))) mergeSettings = f;
      else if (inNew) skipped.push({ filename: f.path, reason: 'UNREADABLE' });
      else keep(f);
    } else if (isPageJson(f.path) && f.body !== null) {
      const tree = tryJson(f.body);
      if (isObj(tree)) pageJson.push({ path: f.path, tree, raw: f });
      else if (inNew) skipped.push({ filename: f.path, reason: 'UNREADABLE' });
      else keep(f);
    } else if (isLocale(f.path) && f.body !== null) {
      const mine = tryJson(f.body);
      if (!inNew) { keep(f); continue; } // a language the merchant added (or the new version dropped): keep it as it is
      if (!isObj(mine)) { skipped.push({ filename: f.path, reason: 'UNREADABLE' }); continue; }
      const fresh = tryJson(out.get(f.path)!.body);
      if (!isObj(fresh)) { keep(f); continue; }
      // The merchant's changes: strings that differ from what was installed (or, when that text is unknown, from the new version).
      const original = bundled ? tryJson(input.originalText?.(f.path)) : undefined;
      const ref = leaves(isObj(original) ? original : fresh);
      let changed = 0;
      for (const [k, v] of leaves(mine)) if (ref.get(k) !== v) { setLeaf(fresh, JSON.parse(k) as string[], v); changed++; }
      if (changed) keep({ ...f, contentType: out.get(f.path)!.contentType }, pretty(fresh), 'merged');
    } else if (!bundled && !inNew) {
      keep(f); // the merchant's own file: uploaded asset, added snippet, section or template
    } else {
      skipped.push({ filename: f.path, reason: inNew ? 'EDITED' : 'REMOVED_IN_NEW_VERSION' });
    }
  }

  // Theme settings: the merchant's values for the settings the new schema still has; new settings keep the new defaults.
  const removedSettings: string[] = [];
  if (mergeSettings) {
    const mine = tryJson(mergeSettings.body) as Record<string, unknown>;
    const fresh = tryJson(out.get(SETTINGS_DATA)?.body);
    const ids = schemaSettingIds(out.get(SETTINGS_SCHEMA)?.body ?? undefined);
    if (!isObj(fresh) || !ids) keep(mergeSettings);
    else {
      const presets = isObj(fresh.presets) ? fresh.presets : {};
      let current: unknown = fresh.current;
      if (typeof mine.current === 'string') { if (mine.current in presets) current = mine.current; }
      else if (isObj(mine.current)) {
        const base = isObj(fresh.current) ? fresh.current : {};
        const kept: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(mine.current)) { if (ids.has(k)) kept[k] = v; else removedSettings.push(k); }
        current = { ...base, ...kept };
      }
      keep({ ...mergeSettings, contentType: out.get(SETTINGS_DATA)!.contentType }, pretty({ ...fresh, current }), 'merged');
    }
  }

  // Templates and section groups: drop sections and blocks whose type the updated theme no longer has.
  const removedReferences: RemovedReference[] = [];
  const has = (p: string) => out.has(p);
  const bodyOf = (p: string) => out.get(p)?.body ?? undefined;
  const pruneBlocks = (holder: Record<string, unknown>, allowed: Set<string> | null, filename: string, at: string): boolean => {
    if (!isObj(holder.blocks)) return false;
    let changed = false;
    for (const [id, b] of Object.entries(holder.blocks)) {
      const type = isObj(b) && typeof b.type === 'string' ? b.type : '';
      const ok = type.startsWith('@') || allowed === null || allowed.has(type) || has(`blocks/${type}.liquid`);
      if (!ok) {
        delete holder.blocks[id];
        if (Array.isArray(holder.block_order)) holder.block_order = holder.block_order.filter((x) => x !== id);
        removedReferences.push({ filename, kind: 'BLOCK', id: `${at}/${id}`, type });
        changed = true;
      } else if (isObj(b)) {
        changed = pruneBlocks(b, has(`blocks/${type}.liquid`) ? schemaBlockTypes(bodyOf(`blocks/${type}.liquid`)) : new Set(), filename, `${at}/${id}`) || changed;
      }
    }
    return changed;
  };
  for (const { path: p, tree, raw } of pageJson) {
    let changed = false;
    if (isObj(tree.sections)) {
      for (const [id, s] of Object.entries(tree.sections)) {
        const type = isObj(s) && typeof s.type === 'string' ? s.type : '';
        if (!has(`sections/${type}.liquid`)) {
          delete tree.sections[id];
          if (Array.isArray(tree.order)) tree.order = tree.order.filter((x) => x !== id);
          removedReferences.push({ filename: p, kind: 'SECTION', id, type });
          changed = true;
        } else if (isObj(s)) {
          changed = pruneBlocks(s, schemaBlockTypes(bodyOf(`sections/${type}.liquid`)), p, id) || changed;
        }
      }
    }
    keep({ ...raw, contentType: out.get(p)?.contentType ?? raw.contentType }, changed ? pretty(tree) : raw.body);
  }

  return {
    files: [...out.values()].sort((a, b) => a.path.localeCompare(b.path)),
    baseline,
    carriedOver: [...carried].sort(),
    skipped: skipped.sort((a, b) => a.filename.localeCompare(b.filename)),
    removedReferences,
    removedSettings: removedSettings.sort(),
  };
}

/* ------------------------------ update (database) ------------------------------ */

export interface ThemeUpdateResult {
  theme: Theme;
  fromVersion: string | null;
  toVersion: string;
  carriedOver: string[];
  skipped: SkippedFile[];
  removedReferences: RemovedReference[];
  removedSettings: string[];
}

/**
 * Create a new, unpublished copy of a theme installed from the bundled theme in `dir`, at the bundled version, with the
 * merchant's customizations carried over (see `planThemeUpdate`). The original theme is not changed.
 */
export async function updateThemeToBundled(db: Db, storage: Storage, shopId: number, themeId: number, source: string | ThemeRoots, o: { staffId?: number | null } = {}): Promise<Result<ThemeUpdateResult>> {
  const cur = await getTheme(db, shopId, themeId);
  if (!cur) return errR(['id'], 'Theme does not exist', 'NOT_FOUND');
  // `source` is the folder of one bundled theme, or the bundled themes (the one the theme came from is looked up by its handle).
  let dir: string;
  let bundled: BundledTheme | null;
  if (typeof source === 'string') { dir = source; bundled = readBundledTheme(source); }
  else {
    const info = cur.originTheme ? findBundledTheme(source, cur.originTheme) : null;
    dir = info?.dir ?? source.defaultDir;
    bundled = info ?? (cur.originTheme ? null : readBundledTheme(source.defaultDir));
  }
  if (!bundled) return errR(['id'], 'The bundled theme is not available on this server', 'BUNDLE_UNAVAILABLE');
  if (cur.originTheme !== bundled.handle) return errR(['id'], `This theme was not installed from ${bundled.name}`, 'NOT_BUNDLED_THEME');
  if (compareVersions(cur.originVersion ?? '0', bundled.version) >= 0) return errR(['id'], `This theme is already at ${bundled.name} ${cur.originVersion ?? bundled.version}`, 'UP_TO_DATE');

  const current = await db.select({ path: themeFiles.path, contentType: themeFiles.contentType, body: themeFiles.body, checksum: themeFiles.checksum, sizeBytes: themeFiles.sizeBytes, storageKey: themeFiles.storageKey })
    .from(themeFiles).where(and(eq(themeFiles.shopId, shopId), eq(themeFiles.themeId, themeId)));
  // What was installed: the checksums recorded at install, else every checksum the bundled theme has ever shipped.
  const stored = cur.originChecksums;
  const known = stored ? null : readKnownChecksums(dir);
  const isBundledPath = (p: string) => (stored ? p in stored : !!known![p]);
  const isPristine = (p: string, c: string) => (stored ? stored[p] === c : !!known![p]?.includes(c));
  // The installed text of edited locale files, from their history (the first saved version that matches what was installed).
  const editedLocales = current.filter((f) => isLocale(f.path) && isBundledPath(f.path) && !isPristine(f.path, f.checksum)).map((f) => f.path);
  const originals = new Map<string, string>();
  if (editedLocales.length) {
    const versions = await db.select({ path: themeFileVersions.path, body: themeFileVersions.body, checksum: themeFileVersions.checksum }).from(themeFileVersions)
      .where(and(eq(themeFileVersions.shopId, shopId), eq(themeFileVersions.themeId, themeId), inArray(themeFileVersions.path, editedLocales))).orderBy(asc(themeFileVersions.id));
    for (const v of versions) if (!originals.has(v.path) && isPristine(v.path, v.checksum)) originals.set(v.path, v.body);
  }

  // The new version as a fresh install would write it (French seed texts for a French shop).
  const [shop] = await db.select({ locale: shops.locale }).from(shops).where(eq(shops.id, shopId)).limit(1);
  const seeds = seedDefaultsFor(dir, shop?.locale);
  const plan = planThemeUpdate({
    current, bundleText: localizeSeedTexts(readThemeDir(dir), seeds), bundleBinary: readThemeBinaries(dir),
    isBundledPath, isPristine, originalText: (p) => originals.get(p),
  });

  const [row] = await db.insert(themes).values({
    shopId, name: `${bundled.name} ${bundled.version}`.slice(0, 255), role: 'UNPUBLISHED', processing: true,
    originTheme: bundled.handle, originVersion: bundled.version, originChecksums: plan.baseline,
  }).returning();
  const id = row!.id;
  const put: string[] = [];
  try {
    // Binaries of the new version share the original's stored object when the file did not change.
    const shared = new Map(current.filter((f) => f.storageKey).map((f) => [`${f.path}:${f.checksum}`, f.storageKey!]));
    const rows: (typeof themeFiles.$inferInsert)[] = [];
    for (const f of plan.files) {
      let storageKey = f.storageKey ?? null;
      if (f.body === null && f.data) {
        storageKey = shared.get(`${f.path}:${f.checksum}`) ?? null;
        if (!storageKey) {
          storageKey = `themes/${id}/${f.checksum}-${path.basename(f.path).replace(/[^A-Za-z0-9._-]/g, '_')}`;
          await storage.put(storageKey, f.data);
          put.push(storageKey);
        }
      }
      rows.push({ themeId: id, shopId, path: f.path, contentType: f.contentType, body: f.body, storageKey, checksum: f.checksum, sizeBytes: f.sizeBytes });
    }
    await db.transaction(async (tx) => {
      for (let i = 0; i < rows.length; i += 50) await tx.insert(themeFiles).values(rows.slice(i, i + 50));
      // Translations of the theme's strings into the shop's other languages follow the copy.
      const tr = await tx.select().from(translations).where(and(eq(translations.shopId, shopId), eq(translations.resourceType, 'ONLINE_STORE_THEME'), eq(translations.resourceId, String(themeId))));
      for (let i = 0; i < tr.length; i += 200) await tx.insert(translations).values(tr.slice(i, i + 200).map(({ id: _id, ...r }) => ({ ...r, resourceId: String(id) })));
      await tx.update(themes).set({ processing: false, updatedAt: new Date() }).where(eq(themes.id, id));
      await addEvent(tx, shopId, { subjectType: 'theme', subjectId: id, verb: 'themes/update', message: `Theme ${bundled.name} ${bundled.version} was created from ${cur.name} (${cur.originVersion ?? '?'} to ${bundled.version})`, authorStaffUserId: o.staffId ?? null });
    });
  } catch (e) {
    await db.delete(themes).where(eq(themes.id, id));
    await releaseObjects(db, storage, put);
    throw e;
  }
  return okR({
    theme: (await getTheme(db, shopId, id))!, fromVersion: cur.originVersion, toVersion: bundled.version,
    carriedOver: plan.carriedOver, skipped: plan.skipped, removedReferences: plan.removedReferences, removedSettings: plan.removedSettings,
  });
}
