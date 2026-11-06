import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ThemeRoots } from '@shopme/core';

export interface ServerPaths {
  /** Built admin SPA (`index.html` inside). May not exist. */
  adminDist: string;
  /** Directory with the default theme sources (`packages/theme-default`). May not exist. */
  themeDefaultDir: string;
  /** Directory whose sub-folders are the other bundled themes (`packages/themes`). May not exist. */
  themesDir: string;
  /** Preview images of the bundled themes (`<handle>-desktop.webp`, `<handle>-mobile.webp`); `packages/themes/previews` by default. */
  themePreviewsDir: string;
  /** Drizzle migrations folder; undefined = let @shopme/core locate its own. */
  migrationsDir?: string;
}

/**
 * Paths are resolved relative to this package (the file's own location), never process.cwd().
 * Works from `src/` (dev) and `dist/` (build): both sit directly under `apps/server`.
 * Every entry can be overridden (desktop app / Docker packaging). The prebuilt layout (an app root holding `apps/server/dist`,
 * `packages/theme-default` and `packages/themes`) needs no configuration.
 */
export function resolvePaths(overrides: Partial<ServerPaths> = {}): ServerPaths {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const serverRoot = path.resolve(here, '..');
  const appsDir = path.resolve(serverRoot, '..');
  const fromEnv = (k: string) => process.env[k] || undefined;
  const themesDir = overrides.themesDir ?? fromEnv('THEMES_DIR') ?? path.resolve(appsDir, '..', 'packages', 'themes');
  return {
    adminDist: overrides.adminDist ?? fromEnv('ADMIN_DIST_DIR') ?? path.join(appsDir, 'admin', 'dist'),
    themeDefaultDir: overrides.themeDefaultDir ?? fromEnv('THEME_DEFAULT_DIR') ?? path.resolve(appsDir, '..', 'packages', 'theme-default'),
    themesDir,
    themePreviewsDir: overrides.themePreviewsDir ?? fromEnv('THEME_PREVIEWS_DIR') ?? path.join(themesDir, 'previews'),
    migrationsDir: overrides.migrationsDir ?? fromEnv('MIGRATIONS_DIR'),
  };
}

export const adminBuilt = (p: ServerPaths) => existsSync(path.join(p.adminDist, 'index.html'));

/** Where the bundled themes are (Aurora, the themes folder and their previews). */
export const themeRoots = (p: ServerPaths): ThemeRoots => ({ defaultDir: p.themeDefaultDir, themesDir: p.themesDir, previewsDir: p.themePreviewsDir });
