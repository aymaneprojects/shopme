import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { FastifyInstance, InjectOptions } from 'fastify';
import { createDb, loadConfig, runMigrations, type DbHandle } from '@shopme/core';
import { buildApp } from './app';

export interface TestApp { app: FastifyInstance; dbHandle: DbHandle; dir: string; close(): Promise<void> }

/** `MULTI_STORE=true pnpm --filter @shopme/server test`: the whole suite runs with the installation in multi-store mode. */
export const MULTI_STORE_RUN = process.env.MULTI_STORE === 'true';
/** Base domain of the stores' permanent hosts in multi-store test runs. */
export const TEST_STORE_BASE_DOMAIN = 'shops.test';

export async function createTestApp(env: Record<string, string> = {}): Promise<TestApp> {
  const dir = mkdtempSync(path.join(tmpdir(), 'shopme-test-'));
  const multi = { ...(MULTI_STORE_RUN ? { MULTI_STORE: 'true' } : {}), STORE_BASE_DOMAIN: TEST_STORE_BASE_DOMAIN };
  const config = loadConfig({ SESSION_SECRET: 's'.repeat(40), NODE_ENV: 'test', DATA_DIR: dir, ...multi, ...env }, { baseDir: dir });
  const dbHandle = await createDb({ memory: true });
  await runMigrations(dbHandle);
  const app = await buildApp({ config, dbHandle, logger: false, paths: { adminDist: path.join(dir, 'no-admin') } });
  await app.ready();
  if (config.multiStore && !env.MULTI_STORE) routeToFirstStore(app);
  return { app, dbHandle, dir, async close() { await app.close(); await dbHandle.close(); } };
}

/**
 * Multi-store runs of the single-store suite: like a browser on the store's own domain, requests that name no host reach the
 * first store on its permanent host (`<handle>.shops.test`); admin requests stay on the platform admin host (`localhost`), where the
 * session picks the store. Tests that set a host keep it.
 */
function routeToFirstStore(app: FastifyInstance) {
  const inject = app.inject.bind(app) as (o?: InjectOptions | string) => ReturnType<FastifyInstance['inject']>;
  const firstHost = async (): Promise<string | null> => {
    let first = app.ctx.stores.all().sort((a, b) => a.id - b.id)[0];
    if (!first) { await app.ctx.stores.refresh(app.ctx.db); first = app.ctx.stores.all().sort((a, b) => a.id - b.id)[0]; }
    return first ? app.ctx.stores.platformHost(first.handle) : null;
  };
  (app as unknown as { inject: unknown }).inject = (opts?: InjectOptions | string) => {
    if (opts === undefined) return inject();
    const o: InjectOptions = typeof opts === 'string' ? { url: opts } : opts;
    const url = typeof o.url === 'string' ? o.url : o.url ? String(o.url.pathname ?? '') : '';
    const headers = (o.headers ?? {}) as Record<string, unknown>;
    if (url.startsWith('/admin') || headers.host || headers.Host || o.authority) return inject(o);
    return (async () => {
      const host = await firstHost();
      if (!host) return inject(o);
      // A Referer or Origin on the default host refers to the same page on the store's host.
      const local = (v: unknown) => String(v).replace(/^(https?:\/\/)localhost(:\d+)?(?=\/|$)/, `$1${host}`);
      return inject({ ...o, headers: { ...headers, host, ...(headers.referer ? { referer: local(headers.referer) } : {}), ...(headers.origin ? { origin: local(headers.origin) } : {}) } });
    })() as ReturnType<FastifyInstance['inject']>;
  };
}

/** Multi-store runs: the permanent host of the first store; single-store runs: `fallback`. */
export function storeHostOr(app: FastifyInstance, fallback: string): string {
  if (!app.ctx.config.multiStore) return fallback;
  const first = app.ctx.stores.all().sort((a, b) => a.id - b.id)[0];
  return first ? app.ctx.stores.platformHost(first.handle) : fallback;
}

/** Multi-store runs: a verified custom domain of the store (what Settings > Domains does), so it may serve as primary or language domain. */
export async function verifiedDomainForTests(app: FastifyInstance, shopId: number, host: string): Promise<void> {
  if (!app.ctx.config.multiStore) return;
  const { schema } = await import('@shopme/core');
  await app.ctx.db.insert(schema.shopDomains).values({ shopId, host: host.toLowerCase(), verificationToken: 'test', verifiedAt: new Date() }).onConflictDoNothing();
}

export const SETUP_BODY = { shopName: 'Test Shop', email: 'owner@example.com', password: 'correct horse', currency: 'EUR', country: 'FR', locale: 'en' };

/** Run setup and return the session cookie value. */
export async function setupAndLogin(app: FastifyInstance): Promise<string> {
  const res = await app.inject({ method: 'POST', url: '/admin/api/setup', payload: SETUP_BODY });
  if (res.statusCode !== 201) throw new Error(`setup failed: ${res.body}`);
  return res.cookies.find((c) => c.name === 'shopme_session')!.value;
}
