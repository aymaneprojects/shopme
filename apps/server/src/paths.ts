import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export interface ServerPaths {
  /** Built admin SPA (`index.html` inside). May not exist. */
  adminDist: string;
  /** Directory with the default theme sources (`packages/theme-default`). May not exist. */
  themeDefaultDir: string;
  /** Drizzle migrations folder; undefined = let @shopme/core locate its own. */
  migrationsDir?: string;
}

/**
 * Paths are resolved relative to this package (the file's own location), never process.cwd().
 * Works from `src/` (dev) and `dist/` (build): both sit directly under `apps/server`.
 * Every entry can be overridden (desktop app / Docker packaging).
 */
export function resolvePaths(overrides: Partial<ServerPaths> = {}): ServerPaths {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const serverRoot = path.resolve(here, '..');
  const appsDir = path.resolve(serverRoot, '..');
  const fromEnv = (k: string) => process.env[k] || undefined;
  return {
    adminDist: overrides.adminDist ?? fromEnv('ADMIN_DIST_DIR') ?? path.join(appsDir, 'admin', 'dist'),
    themeDefaultDir: overrides.themeDefaultDir ?? fromEnv('THEME_DEFAULT_DIR') ?? path.resolve(appsDir, '..', 'packages', 'theme-default'),
    migrationsDir: overrides.migrationsDir ?? fromEnv('MIGRATIONS_DIR'),
  };
}

export const adminBuilt = (p: ServerPaths) => existsSync(path.join(p.adminDist, 'index.html'));
