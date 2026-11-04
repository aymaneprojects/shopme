import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { createDb, loadConfig, runMigrations, type DbHandle } from '@shopme/core';
import { buildApp } from './app';

export interface TestApp { app: FastifyInstance; dbHandle: DbHandle; dir: string; close(): Promise<void> }

export async function createTestApp(env: Record<string, string> = {}): Promise<TestApp> {
  const dir = mkdtempSync(path.join(tmpdir(), 'shopme-test-'));
  const config = loadConfig({ SESSION_SECRET: 's'.repeat(40), NODE_ENV: 'test', DATA_DIR: dir, ...env }, { baseDir: dir });
  const dbHandle = await createDb({ memory: true });
  await runMigrations(dbHandle);
  const app = await buildApp({ config, dbHandle, logger: false, paths: { adminDist: path.join(dir, 'no-admin') } });
  await app.ready();
  return { app, dbHandle, dir, async close() { await app.close(); await dbHandle.close(); } };
}

export const SETUP_BODY = { shopName: 'Test Shop', email: 'owner@example.com', password: 'correct horse', currency: 'EUR', country: 'FR', locale: 'en' };

/** Run setup and return the session cookie value. */
export async function setupAndLogin(app: FastifyInstance): Promise<string> {
  const res = await app.inject({ method: 'POST', url: '/admin/api/setup', payload: SETUP_BODY });
  if (res.statusCode !== 201) throw new Error(`setup failed: ${res.body}`);
  return res.cookies.find((c) => c.name === 'shopme_session')!.value;
}
