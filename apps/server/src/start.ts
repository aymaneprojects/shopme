import type { AddressInfo } from 'node:net';
import { createDb, exportStore, getPrimaryShop, importStore, loadConfig, runMigrations, type AppConfig } from '@shopme/core';
import { buildApp } from './app';
import { resolvePaths, type ServerPaths } from './paths';

export interface StartServerOptions {
  /** 0 picks a free port. */
  port?: number;
  host?: string;
  /** Holds pglite/, uploads/ and the generated session secret. Relative paths resolve against `baseDir`. */
  dataDir?: string;
  appUrl?: string;
  databaseUrl?: string;
  storageDir?: string;
  /** Base for relative dataDir/storageDir. Default: INIT_CWD or process.cwd() (only used for relative paths). */
  baseDir?: string;
  /** Environment to read configuration from. Default process.env. */
  env?: Record<string, string | undefined>;
  /** Override resolved file locations (admin dist, migrations, default theme). */
  paths?: Partial<ServerPaths>;
  /** false silences logs. */
  logger?: boolean;
}

export interface RunningServer {
  /** Base URL, e.g. http://127.0.0.1:54321 (reflects the real port when `port: 0`). */
  url: string;
  port: number;
  config: AppConfig;
  /** Write the whole store to a `.shopme` file (desktop "Export my store"). Rejects when the store is not set up. */
  exportStore(file: string): Promise<void>;
  /** Replace the store with a `.shopme` file. Resolves to an error message, or null on success. */
  importStore(file: string): Promise<string | null>;
  close(): Promise<void>;
}

/**
 * Programmatic entry point: load config, open the database (PGlite or PostgreSQL), run migrations,
 * start listening. Used by the CLI (`main.ts`) and by embedders such as a desktop shell.
 * Never reads process.cwd() to locate migrations, the admin build or theme files.
 */
export async function startServer(opts: StartServerOptions = {}): Promise<RunningServer> {
  const config = loadConfig(opts.env ?? process.env, {
    baseDir: opts.baseDir,
    overrides: { port: opts.port, host: opts.host, dataDir: opts.dataDir, appUrl: opts.appUrl, databaseUrl: opts.databaseUrl, storageDir: opts.storageDir },
  });
  const paths = resolvePaths(opts.paths);
  const dbHandle = await createDb({ databaseUrl: config.databaseUrl, dataDir: config.dataDir });
  try {
    await runMigrations(dbHandle, paths.migrationsDir);
    const app = await buildApp({ config, dbHandle, paths, logger: opts.logger });
    const explicitUrl = !!(opts.appUrl ?? (opts.env ?? process.env).APP_URL);
    await app.listen({ port: config.port, host: config.host });
    const port = (app.server.address() as AddressInfo).port;
    config.port = port;
    if (!explicitUrl) config.appUrl = `http://localhost:${port}`;
    const host = config.host === '0.0.0.0' || config.host === '::' ? 'localhost' : config.host;
    const url = `http://${host}:${port}`;
    app.log.info(`ShopMe listening on ${url} (database: ${dbHandle.driver}, admin: ${config.appUrl}/admin/)`);
    let closed = false;
    const shopId = async () => (await getPrimaryShop(dbHandle.db))?.id ?? null;
    return {
      url, port, config,
      async exportStore(file) {
        const id = await shopId();
        if (id === null) throw new Error('The store is not set up yet.');
        await exportStore(dbHandle.db, app.ctx.storage, id, file, { appVersion: app.ctx.appVersion });
      },
      async importStore(file) {
        const id = await shopId();
        if (id === null) return 'Set up the store first (create the owner account), then import.';
        const r = await importStore(dbHandle.db, app.ctx.storage, id, file);
        if (r.ok) await app.ctx.locales.refresh(dbHandle.db);
        return r.ok ? null : r.error;
      },
      async close() {
        if (closed) return;
        closed = true;
        await app.close();
        await dbHandle.close();
      },
    };
  } catch (err) {
    await dbHandle.close().catch(() => {});
    throw err;
  }
}
