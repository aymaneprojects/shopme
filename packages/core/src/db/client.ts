import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import { resolveMigrationsDir } from './migrate';
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
  /** In-memory PGlite (tests). With `TEST_DATABASE_URL` set, a throwaway database on that PostgreSQL server instead. */
  memory?: boolean;
  /** Test mode on PostgreSQL only: an empty database instead of a clone of the migrated template (tests that apply partial migrations). */
  blank?: boolean;
}

/** Fingerprint of the committed migrations: a template database is reused only while they are unchanged. */
function migrationsFingerprint(dir: string): string {
  const h = createHash('sha256');
  const files = [path.join(dir, 'meta', '_journal.json'), ...readdirSync(dir).filter((f) => f.endsWith('.sql')).sort().map((f) => path.join(dir, f))];
  for (const f of files) h.update(f.slice(dir.length)).update(readFileSync(f));
  return h.digest('hex').slice(0, 12);
}

/**
 * Test mode (`TEST_DATABASE_URL`): every call gets its own fresh database, cloned from a migrated template database
 * (`CREATE DATABASE ... TEMPLATE`), and `close()` drops it. The role needs CREATEDB.
 */
async function createTestPostgresDb(adminUrl: string, blank: boolean): Promise<DbHandle> {
  const [{ default: postgres }, { drizzle }, { migrate }] = await Promise.all([
    import('postgres'),
    import('drizzle-orm/postgres-js'),
    import('drizzle-orm/postgres-js/migrator'),
  ]);
  const withDb = (name: string) => { const u = new URL(adminUrl); u.pathname = `/${name}`; return u.toString(); };
  const folder = resolveMigrationsDir();
  const template = `shopme_tpl_${migrationsFingerprint(folder)}`;
  const name = `shopme_test_${process.pid}_${randomBytes(4).toString('hex')}`;
  const admin = postgres(adminUrl, { max: 1, onnotice: () => {} });
  try {
    if (blank) { await admin.unsafe(`CREATE DATABASE "${name}" TEMPLATE template0`); } else {
      // (CREATE DATABASE cannot run in a transaction: a session-level lock on the single admin connection.)
      await admin`SELECT pg_advisory_lock(727274)`;
      try {
        const [exists] = await admin`SELECT 1 AS one FROM pg_database WHERE datname = ${template}`;
        if (!exists) {
          const build = `${template}_build_${randomBytes(3).toString('hex')}`;
          await admin.unsafe(`CREATE DATABASE "${build}"`);
          const client = postgres(withDb(build), { max: 1, onnotice: () => {} });
          try { await migrate(drizzle(client, { schema }), { migrationsFolder: folder }); } finally { await client.end(); }
          await admin.unsafe(`ALTER DATABASE "${build}" RENAME TO "${template}"`);
        }
      } finally { await admin`SELECT pg_advisory_unlock(727274)`; }
      await admin.unsafe(`CREATE DATABASE "${name}" TEMPLATE "${template}"`);
    }
  } finally { await admin.end(); }
  const client = postgres(withDb(name), { max: 4, onnotice: () => {} });
  const db = drizzle(client, { schema });
  return {
    db, driver: 'postgres',
    async close() {
      await client.end();
      const a = postgres(adminUrl, { max: 1, onnotice: () => {} });
      try { await a.unsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`); } finally { await a.end(); }
    },
    migrate: (f) => migrate(db, { migrationsFolder: f }),
  };
}

export async function createDb(opts: CreateDbOptions): Promise<DbHandle> {
  if (opts.memory && !opts.databaseUrl && process.env.TEST_DATABASE_URL) return createTestPostgresDb(process.env.TEST_DATABASE_URL, !!opts.blank);
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
