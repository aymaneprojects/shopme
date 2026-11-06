import type { FastifyInstance, FastifyRequest } from 'fastify';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { accountCount, bundledThemeDescription, discoverBundledThemes, needsSetup, readThemePreview, readThemeReleaseNotes, themePreviewFiles, type BundledThemeInfo, type ThemeReleaseNote } from '@shopme/core';
import { accountOf, authenticate } from '../plugins/auth';
import { themeRoots, type ServerPaths } from '../paths';

/** Where the admin loads a bundled theme's preview images from (authenticated; see `registerThemeRoutes`). */
export const THEME_PREVIEW_ROUTE = '/admin/api/theme-previews';

export interface BundledThemeListing {
  handle: string; name: string; version: string; author: string; description: string; tags: string[];
  previews: { desktop: string | null; mobile: string | null };
  /** Pages the theme ships a template for (`index`, `product`, `customers/login`...). */
  templates: string[];
  /** What changed in each version, newest first (`changelog.json`). */
  changelog: ThemeReleaseNote[];
}

/** Names of the page templates of a theme folder (`templates/*.json|liquid`, `templates/customers/*`). */
export function templatesOf(dir: string): string[] {
  const out: string[] = [];
  for (const sub of ['', 'customers']) {
    try {
      for (const f of readdirSync(path.join(dir, 'templates', sub), { withFileTypes: true })) {
        const m = f.isFile() ? /^(.+)\.(json|liquid)$/.exec(f.name) : null;
        if (m && !out.includes(sub ? `${sub}/${m[1]}` : m[1]!)) out.push(sub ? `${sub}/${m[1]}` : m[1]!);
      }
    } catch { /* no such folder */ }
  }
  return out.sort();
}

/** The bundled themes as the admin shows them (description in `locale`, previews as URLs of the preview route; null when there is no image). */
export function listBundledThemes(paths: ServerPaths, locale: string | null | undefined): BundledThemeListing[] {
  const roots = themeRoots(paths);
  const url = (f: string | null) => (f ? `${THEME_PREVIEW_ROUTE}/${f}` : null);
  return discoverBundledThemes(roots).map((i: BundledThemeInfo) => {
    const p = themePreviewFiles(roots, i.handle);
    return { handle: i.handle, name: i.name, version: i.version, author: i.author, description: bundledThemeDescription(i, locale), tags: i.tags, templates: templatesOf(i.dir), changelog: readThemeReleaseNotes(i.dir, locale ?? 'en'), previews: { desktop: url(p.desktop), mobile: url(p.mobile) } };
  });
}

/**
 *   GET /admin/api/bundled-themes?locale=      the bundled themes (name, description, tags, preview URLs)
 *   GET /admin/api/theme-previews/<handle>-(desktop|mobile).webp
 * Both need a signed-in admin (staff or, in multi-store mode, account), except while the installation is not set up yet: the
 * first-store wizard offers the same theme choice.
 */
export function registerThemeRoutes(app: FastifyInstance) {
  const { db, config, paths } = app.ctx;
  const allowed = async (req: FastifyRequest): Promise<boolean> => {
    if (await authenticate(req)) return true;
    if (config.multiStore && (await accountOf(req))) return true;
    return config.multiStore ? (await accountCount(db)) === 0 && (await needsSetup(db)) : needsSetup(db);
  };

  app.get('/admin/api/bundled-themes', async (req, reply) => {
    if (!(await allowed(req))) return reply.code(401).send({ error: 'Not authenticated' });
    const locale = (req.query as { locale?: string }).locale;
    return { themes: listBundledThemes(paths, typeof locale === 'string' ? locale.slice(0, 20) : 'en') };
  });

  app.get('/admin/api/theme-previews/:file', async (req, reply) => {
    if (!(await allowed(req))) return reply.code(401).send({ error: 'Not authenticated' });
    const data = readThemePreview(themeRoots(paths), (req.params as { file: string }).file);
    if (!data) return reply.code(404).send({ error: 'Not found' });
    // Private (signed-in only) but cacheable by the browser: previews change only when ShopMe is upgraded.
    return reply.header('cache-control', 'private, max-age=3600').header('x-content-type-options', 'nosniff').type('image/webp').send(data);
  });
}
