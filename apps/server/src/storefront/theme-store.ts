import { createHash } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { ensureDefaultTheme, ensureMainTheme, schema as s } from '@shopme/core';
import { Theme, ThemeRenderer } from '@shopme/liquid-compat';
import type { AppContext } from '../context';

export interface LoadedTheme { themeId: number; theme: Theme; renderer: ThemeRenderer }

/** Loads the shop's MAIN theme from `theme_files`, installs Aurora when it is empty, and caches the parsed renderer until files change. */
export class ThemeStore {
  private cache = new Map<number, { sig: string; loaded: LoadedTheme }>();
  constructor(private ctx: AppContext) {}

  async main(shopId: number): Promise<LoadedTheme> {
    const { db } = this.ctx;
    const main = await ensureMainTheme(db, shopId);
    let sig = await this.signature(main.id);
    if (sig.startsWith('0:')) {
      await ensureDefaultTheme(db, shopId, this.ctx.paths.themeDefaultDir);
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
