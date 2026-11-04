import { mkdirSync } from 'node:fs';
import path from 'node:path';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import * as schema from './schema';

export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
/** Anything that can run queries: the db or a transaction. Services accept this. */
export type Executor = Db | Tx;

export interface DbHandle {
  db: Db;
  driver: 'postgres' | 'pglite';
  close(): Promise<void>;
  /** Internal: applies migrations with the driver-specific migrator. */
  migrate(folder: string): Promise<void>;
}

export interface CreateDbOptions {
  /** If set: PostgreSQL. Otherwise embedded PGlite. */
  databaseUrl?: string;
  /** PGlite files go to `<dataDir>/pglite`. Ignored when `memory` or `databaseUrl` is set. */
  dataDir?: string;
  /** In-memory PGlite (tests). */
  memory?: boolean;
}

export async function createDb(opts: CreateDbOptions): Promise<DbHandle> {
  if (opts.databaseUrl) {
    const [{ default: postgres }, { drizzle }, { migrate }] = await Promise.all([
      import('postgres'),
      import('drizzle-orm/postgres-js'),
      import('drizzle-orm/postgres-js/migrator'),
    ]);
    const client = postgres(opts.databaseUrl, { max: 10, onnotice: () => {} });
    const db = drizzle(client, { schema });
    return { db, driver: 'postgres', close: () => client.end(), migrate: (folder) => migrate(db, { migrationsFolder: folder }) };
  }
  const [{ PGlite }, { drizzle }, { migrate }] = await Promise.all([
    import('@electric-sql/pglite'),
    import('drizzle-orm/pglite'),
    import('drizzle-orm/pglite/migrator'),
  ]);
  let location: string | undefined;
  if (!opts.memory) {
    location = path.join(path.resolve(opts.dataDir ?? './data'), 'pglite');
    mkdirSync(location, { recursive: true });
  }
  const client = new PGlite(location);
  await client.waitReady;
  const db = drizzle(client, { schema });
  return { db, driver: 'pglite', close: () => client.close(), migrate: (folder) => migrate(db, { migrationsFolder: folder }) };
}
