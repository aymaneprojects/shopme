import { createHash, randomBytes } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { ensureDefaultTheme, ensureMainTheme, parseLocaleJson, schema as s, setPath, themeTranslations } from '@shopme/core';
import { Theme, ThemeRenderer } from '@shopme/liquid-compat';
import type { AppContext } from '../context';

const DRAFT_TTL_MS = 60 * 60_000;
const MAX_DRAFTS = 50;
const MAX_DRAFT_BYTES = 8 * 1024 * 1024;

interface Draft { shopId: number; themeId: number; files: Map<string, string>; rev: number; at: number }

export interface LoadedTheme { themeId: number; theme: Theme; renderer: ThemeRenderer }

/** Loads the shop's MAIN theme from `theme_files`, installs Aurora when it is empty, and caches the parsed renderer until files change. */
export class ThemeStore {
  private cache = new Map<number, { sig: string; loaded: LoadedTheme }>();
  private derived = new Map<string, { sig: string; loaded: LoadedTheme }>();
  constructor(private ctx: AppContext) {}

  /** The main theme; with `locale` (a non-primary storefront language) the merchant's translations of theme strings are laid over `locales/<locale>.json`. */
  async main(shopId: number, locale?: string): Promise<LoadedTheme> {
    const base = await this.mainBase(shopId);
    if (!locale) return base;
    const tr = await themeTranslations(this.ctx.db, shopId, base.themeId, locale);
    if (!Object.keys(tr.values).length) return base;
    const key = `${shopId}:${locale}`;
    const sig = `${base.theme.version}:${tr.sig}`;
    const hit = this.derived.get(key);
    if (hit && hit.sig === sig) return hit.loaded;
    const files = new Map(base.theme.paths().map((p) => [p, base.theme.read(p)!] as const));
    const path = [`locales/${locale}.json`, `locales/${locale.split('-')[0]}.json`].find((p) => files.has(p)) ?? `locales/${locale}.json`;
    const tree = parseLocaleJson(files.get(path) ?? null);
    for (const [k, v] of Object.entries(tr.values)) setPath(tree, k, v);
    files.set(path, JSON.stringify(tree));
    const theme = new Theme(files, { id: base.themeId, version: `${base.theme.version}-${locale}` });
    const loaded = { themeId: base.themeId, theme, renderer: new ThemeRenderer(theme) };
    this.derived.set(key, { sig, loaded });
    return loaded;
  }

  private drafts = new Map<string, Draft>();
  private previews = new Map<string, { sig: string; loaded: LoadedTheme }>();

  /**
   * Theme editor preview: any theme of the shop (not only the live one), with an optional unsaved draft laid over its files.
   * Returns null when the theme does not belong to the shop or the draft token expired.
   */
  async preview(shopId: number, themeId: number, token?: string): Promise<LoadedTheme | null> {
    const draft = token ? this.draftOf(token, shopId, themeId) : null;
    if (token && !draft) return null;
    const sig = await this.signature(themeId);
    if (sig.startsWith('0:')) return null;
    const key = `${shopId}:${themeId}:${token ?? ''}`;
    const full = `${sig}:${draft?.rev ?? 0}`;
    const hit = this.previews.get(key);
    if (hit && hit.sig === full) return hit.loaded;
    const rows = await this.ctx.db.select({ path: s.themeFiles.path, body: s.themeFiles.body }).from(s.themeFiles).where(and(eq(s.themeFiles.themeId, themeId), eq(s.themeFiles.shopId, shopId)));
    const files = new Map<string, string>();
    if (!rows.length) return null;
    for (const r of rows) if (r.body !== null) files.set(r.path, r.body);
    for (const [p, body] of draft?.files ?? []) files.set(p, body);
    const version = createHash('md5').update(full).digest('hex').slice(0, 10);
    const theme = new Theme(files, { id: themeId, version });
    const loaded = { themeId, theme, renderer: new ThemeRenderer(theme) };
    if (this.previews.size > MAX_DRAFTS * 2) this.previews.delete(this.previews.keys().next().value!);
    this.previews.set(key, { sig: full, loaded });
    return loaded;
  }

  private draftOf(token: string, shopId: number, themeId: number): Draft | null {
    const d = this.drafts.get(token);
    if (!d || d.shopId !== shopId || d.themeId !== themeId) return null;
    if (Date.now() - d.at > DRAFT_TTL_MS) { this.drafts.delete(token); return null; }
    return d;
  }

  /** Store (or replace, when `token` is given) the unsaved files of an editor session. Returns the token the preview URL carries, or null when too large. */
  putDraft(shopId: number, themeId: number, files: Record<string, string>, token?: string): string | null {
    let bytes = 0;
    for (const [p, b] of Object.entries(files)) { if (typeof b !== 'string' || p.includes('..')) return null; bytes += b.length; }
    if (bytes > MAX_DRAFT_BYTES) return null;
    const now = Date.now();
    for (const [k, d] of this.drafts) if (now - d.at > DRAFT_TTL_MS) { this.drafts.delete(k); this.previews.delete(`${d.shopId}:${d.themeId}:${k}`); }
    const prev = token ? this.draftOf(token, shopId, themeId) : null;
    const id = prev ? token! : randomBytes(12).toString('hex');
    this.drafts.set(id, { shopId, themeId, files: new Map(Object.entries(files)), rev: (prev?.rev ?? 0) + 1, at: now });
    if (this.drafts.size > MAX_DRAFTS) {
      const oldest = this.drafts.keys().next().value!;
      const d = this.drafts.get(oldest)!;
      this.drafts.delete(oldest); this.previews.delete(`${d.shopId}:${d.themeId}:${oldest}`);
    }
    return id;
  }

  private async mainBase(shopId: number): Promise<LoadedTheme> {
    const { db } = this.ctx;
    const main = await ensureMainTheme(db, shopId);
    let sig = await this.signature(main.id);
    if (sig.startsWith('0:')) {
      await ensureDefaultTheme(db, shopId, this.ctx.paths.themeDefaultDir, this.ctx.storageFor(shopId));
      sig = await this.signature(main.id);
    }
    const hit = this.cache.get(shopId);
    if (hit && hit.sig === sig) return hit.loaded;
    const rows = await db.select({ path: s.themeFiles.path, body: s.themeFiles.body }).from(s.themeFiles).where(and(eq(s.themeFiles.themeId, main.id), eq(s.themeFiles.shopId, shopId)));
    const files = new Map<string, string>();
    for (const r of rows) if (r.body !== null) files.set(r.path, r.body);
    const version = createHash('md5').update(sig).digest('hex').slice(0, 10);
    const theme = new Theme(files, { id: main.id, version });
    const loaded = { themeId: main.id, theme, renderer: new ThemeRenderer(theme) };
    this.cache.set(shopId, { sig, loaded });
    return loaded;
  }

  private async signature(themeId: number): Promise<string> {
    const [r] = await this.ctx.db.select({ n: sql<number>`count(*)::int`, t: sql<string>`coalesce(max(${s.themeFiles.updatedAt})::text, '')`, c: sql<string>`coalesce(md5(string_agg(${s.themeFiles.checksum}, ',' order by ${s.themeFiles.path})), '')` })
      .from(s.themeFiles).where(eq(s.themeFiles.themeId, themeId));
    return `${r?.n ?? 0}:${r?.t ?? ''}:${r?.c ?? ''}`;
  }
}
