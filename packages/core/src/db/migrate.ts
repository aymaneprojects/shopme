import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DbHandle } from './client';

/**
 * Locate the committed migrations (`packages/core/drizzle`) without relying on process.cwd().
 * Order: explicit argument, MIGRATIONS_DIR env, relative to this file (source layout), then
 * relative to the bundle (`<bundle dir>/drizzle`, or `apps/server/dist` inside the monorepo).
 */
export function resolveMigrationsDir(explicit?: string): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [explicit, process.env.MIGRATIONS_DIR, path.resolve(here, '../../drizzle'), path.resolve(here, 'drizzle'), path.resolve(here, '../drizzle'), path.resolve(here, '../../../packages/core/drizzle')]
    .filter((c): c is string => !!c);
  const found = candidates.find((c) => existsSync(path.join(c, 'meta', '_journal.json')));
  if (!found) throw new Error(`Cannot find database migrations. Looked in:\n${candidates.join('\n')}`);
  return found;
}

export async function runMigrations(handle: DbHandle, migrationsDir?: string): Promise<void> {
  await handle.migrate(resolveMigrationsDir(migrationsDir));
}
