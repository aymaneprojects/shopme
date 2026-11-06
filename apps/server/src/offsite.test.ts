import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, count, eq, isNull } from 'drizzle-orm';
import { createAccount, schema as s } from '@shopme/core';
import { startFakeS3, type FakeS3 } from '@shopme/core/test-fixtures/fake-s3';
import { createTestApp, setupAndLogin, type TestApp } from './test-utils';

/**
 * Off-site backups against an in-process S3 (no real network): settings and secrets, the connection test, upload after a scheduled
 * backup, encryption, retention, listing and restore, failure with retry and the banner, per-store isolation and the platform destination.
 */
const SECRET = 'SUPER-SECRET-ACCESS-VALUE-123';
const PASS = 'correct horse battery staple';
const BASE = '/admin/api/store/backups/offsite';

let s3: FakeS3;
let t: TestApp;
let cookie: string;
let shopId: number;
let dumpScript: string;
const multi = () => t.app.ctx.config.multiStore;
const db = () => t.dbHandle.db;

const call = (ck: string | null, method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, payload?: unknown, app: TestApp = t) =>
  app.app.inject({ method, url, payload: payload as never, cookies: ck ? { shopme_session: ck } : undefined });
async function waitJob(ck: string, id: number, app: TestApp = t) {
  for (let i = 0; i < 300; i++) {
    const j = ((await call(ck, 'GET', `/admin/api/store/jobs/${id}`, undefined, app)).json() as { job: { status: string; done: boolean; error: string | null } }).job;
    if (j.done) return j;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('job did not finish');
}
const gql = async (ck: string, query: string, app: TestApp = t) => (await call(ck, 'POST', '/admin/api/2026-10/graphql.json', { query }, app)).json() as { data?: any; errors?: unknown };
const form = (o: Record<string, unknown> = {}) => ({ enabled: true, preset: 'custom', endpoint: s3.endpoint, region: 'us-east-1', forcePathStyle: true, bucket: s3.bucket, prefix: 'backups', accessKeyId: s3.accessKeyId, secretAccessKey: SECRET, keepDaily: 7, keepWeekly: 4, keepMonthly: 6, ...o });
const setClock = (at: Date | null) => { (t.app.ctx.offsite as unknown as { deps: { now?: () => Date } }).deps.now = at ? () => at : undefined; };
const productCount = async () => (await db().select({ n: count() }).from(s.products).where(eq(s.products.shopId, shopId)))[0]!.n;
const runNow = async (app: TestApp = t, ck = cookie) => {
  const r = await call(ck, 'POST', `${BASE}/run`, {}, app);
  expect(r.statusCode, r.body).toBe(202);
  return waitJob(ck, (r.json() as { job: { id: number } }).job.id, app);
};
const folder = () => `backups/shop-${shopId}/`;

beforeAll(async () => {
  s3 = await startFakeS3();
  const dir = mkdtempSync(path.join(tmpdir(), 'shopme-pgdump-'));
  dumpScript = path.join(dir, 'pg_dump');
  writeFileSync(dumpScript, '#!/bin/sh\nif [ -n "$FAKE_DUMP_FAIL" ]; then echo "pg_dump: error: connection refused" >&2; exit 1; fi\nprintf "PGDMP-FAKE db=%s host=%s user=%s args=%s" "$PGDATABASE" "$PGHOST" "$PGUSER" "$*"\n');
  chmodSync(dumpScript, 0o755);
  t = await createTestApp({ BACKUP_ALLOW_PRIVATE_ENDPOINTS: 'true', DATABASE_URL: 'postgres://shopper:dbpass@db.internal:5432/shopdb', PG_DUMP_PATH: dumpScript });
  cookie = await setupAndLogin(t.app);
  shopId = (await db().select().from(s.shops).orderBy(s.shops.id))[0]!.id;
}, 120_000);
afterAll(async () => { await t?.close(); await s3?.close(); });

describe('destination settings', () => {
  it('requires a signed-in administrator', async () => {
    expect((await call(null, 'GET', BASE)).statusCode).toBe(401);
    expect((await call(null, 'PUT', BASE, form())).statusCode).toBe(401);
    expect((await call(null, 'POST', `${BASE}/test`, {})).statusCode).toBe(401);
  });

  it('saves the destination and never returns the secret or the passphrase', async () => {
    const put = await call(cookie, 'PUT', BASE, form({ passphrase: PASS }));
    expect(put.statusCode, put.body).toBe(200);
    const get = await call(cookie, 'GET', BASE);
    for (const body of [put.body, get.body]) {
      expect(body).not.toContain(SECRET);
      expect(body).not.toContain(PASS);
      expect(body).not.toMatch(/secretKeyEnc|passphraseEnc|secret_key_enc/);
    }
    const d = (get.json() as { destination: Record<string, unknown> }).destination;
    expect(d).toMatchObject({ configured: true, enabled: true, bucket: s3.bucket, prefix: 'backups', accessKeyId: s3.accessKeyId, secretSet: true, passphraseSet: true, keepDaily: 7, scope: 'store' });
    expect(d).not.toHaveProperty('secretAccessKey');
    expect((d.presets as unknown[]).length).toBe(7);
    // stored encrypted
    const [row] = await db().select().from(s.backupDestinations).where(eq(s.backupDestinations.shopId, shopId));
    expect(row!.secretKeyEnc).toBeTruthy();
    expect(row!.secretKeyEnc).not.toContain(SECRET);
    expect(row!.passphraseEnc).not.toContain(PASS);
    // an update without the secret keeps it
    await call(cookie, 'PUT', BASE, { keepDaily: 5 });
    const again = (await call(cookie, 'GET', BASE)).json() as { destination: { secretSet: boolean; keepDaily: number } };
    expect(again.destination).toMatchObject({ secretSet: true, keepDaily: 5 });
    await call(cookie, 'PUT', BASE, { keepDaily: 7 });
    // the secret is never in the activity log or the history either
    expect(JSON.stringify(await db().select().from(s.backupRuns))).not.toContain(SECRET);
  });

  it('validates the form with messages per field', async () => {
    const r = await call(cookie, 'PUT', BASE, { bucket: 'Not A Bucket', prefix: '../etc', passphrase: 'short', endpoint: 'not a url' });
    expect(r.statusCode).toBe(422);
    expect((r.json() as { errors: Array<{ field: string }> }).errors.map((e) => e.field).sort()).toEqual(['bucket', 'endpoint', 'passphrase', 'prefix']);
    expect((await call(cookie, 'PUT', BASE, { unknownField: 1 })).statusCode).toBe(400);
  });

  it('refuses private and loopback endpoints unless BACKUP_ALLOW_PRIVATE_ENDPOINTS=true', async () => {
    const strict = await createTestApp({});
    try {
      const ck = await setupAndLogin(strict.app);
      for (const endpoint of [s3.endpoint, 'https://127.0.0.1:9000', 'https://localhost', 'https://10.1.2.3', 'https://169.254.169.254', 'http://s3.example.com']) {
        const r = await call(ck, 'PUT', BASE, form({ endpoint }), strict);
        expect(r.statusCode, endpoint).toBe(422);
      }
      const test = await call(ck, 'POST', `${BASE}/test`, form({ endpoint: 'https://192.168.0.9' }), strict);
      expect(test.statusCode).toBe(422);
      expect(((await call(ck, 'GET', BASE, undefined, strict)).json() as { destination: { allowPrivateEndpoints: boolean } }).destination.allowPrivateEndpoints).toBe(false);
    } finally { await strict.close(); }
  });
});

describe('connection test', () => {
  it('writes, reads and deletes a small object with the saved settings', async () => {
    const before = s3.log.length;
    const r = await call(cookie, 'POST', `${BASE}/test`, {});
    expect(r.json()).toEqual({ ok: true, steps: [{ step: 'write', ok: true }, { step: 'read', ok: true }, { step: 'delete', ok: true }] });
    expect(s3.log.slice(before).map((l) => l.method)).toEqual(['PUT', 'GET', 'DELETE']);
    expect(s3.keys(folder())).toEqual([]);
  });

  it('tests the form values over the saved ones without saving them, and never echoes a secret', async () => {
    const r = await call(cookie, 'POST', `${BASE}/test`, { accessKeyId: 'AKIAWRONGKEY', secretAccessKey: 'ANOTHER-SECRET-VALUE' });
    const body = r.json() as { ok: boolean; error: string; steps: Array<{ ok: boolean }> };
    expect(body.ok).toBe(false);
    expect(body.error).toMatch(/access key or secret/);
    expect(r.body).not.toContain('ANOTHER-SECRET-VALUE');
    expect(r.body).not.toContain(SECRET);
    expect(((await call(cookie, 'GET', BASE)).json() as { destination: { accessKeyId: string } }).destination.accessKeyId).toBe(s3.accessKeyId);
    const missing = (await call(cookie, 'POST', `${BASE}/test`, { bucket: 'no-such-bucket' })).json() as { ok: boolean; error: string };
    expect(missing).toMatchObject({ ok: false, error: expect.stringMatching(/bucket was not found/) });
  });
});

describe('upload after a scheduled backup', () => {
  it('uploads the archive (and the database dump on a single-store installation) and records the history', async () => {
    await call(cookie, 'PUT', BASE, { passphrase: null, clearPassphrase: true });
    t.app.ctx.queue.enqueue('store.auto-backup', {}, { maxAttempts: 1 });
    await t.app.ctx.queue.idle();
    const archives = s3.keys(`${folder()}archives/`);
    expect(archives).toHaveLength(1);
    expect(archives[0]).toMatch(/\/archives\/backup-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z\.shopme$/);
    expect(s3.objects.get(archives[0]!)!.body.subarray(0, 2).toString()).toBe('PK'); // a zip: the same file the local backup wrote
    const dumps = s3.keys(`${folder()}database/`);
    if (multi()) expect(dumps).toEqual([]); // a store never receives the whole installation's database
    else {
      expect(dumps).toHaveLength(1);
      const body = s3.objects.get(dumps[0]!)!.body.toString();
      expect(body).toContain('PGDMP-FAKE db=shopdb host=db.internal user=shopper');
      expect(body).not.toContain('dbpass'); // the password goes through the environment, never the command line
    }
    const h = (await call(cookie, 'GET', BASE)).json() as { history: Array<{ status: string; bytes: number; kind: string; error: string | null; encrypted: boolean }>; alert: unknown };
    expect(h.history[multi() ? 0 : 1]).toMatchObject({ status: 'ok', kind: 'store', error: null, encrypted: false });
    expect(h.history[0]!.bytes).toBeGreaterThan(0);
    expect(h.alert).toBeNull();
  });

  it('applies the retention schedule in the bucket and leaves foreign files alone', async () => {
    const f = `${folder()}archives/`;
    for (const d of ['2020-01-01', '2020-01-02', '2020-01-03', '2020-01-04', '2020-01-05']) s3.put(`${f}backup-${d}T03-00-00Z.shopme`, 'old');
    s3.put(`${f}notes.txt`, 'not ours');
    s3.put(`backups/shop-${shopId + 100}/archives/backup-2020-01-01T03-00-00Z.shopme`, 'someone else');
    await call(cookie, 'PUT', BASE, { keepDaily: 2, keepWeekly: 0, keepMonthly: 0 });
    const job = await runNow();
    expect(job.status, job.error ?? '').toBe('COMPLETED');
    const left = s3.keys(f).map((k) => k.slice(f.length));
    expect(left).toContain('notes.txt');
    expect(left.filter((k) => k.startsWith('backup-2020'))).toEqual(['backup-2020-01-05T03-00-00Z.shopme']); // newest of the 2 kept days; the other kept day is today's
    expect(left.filter((k) => k.startsWith('backup-2026') || k.startsWith('backup-20')).length).toBeGreaterThanOrEqual(2);
    expect(s3.keys(`backups/shop-${shopId + 100}/`)).toHaveLength(1);
    await call(cookie, 'PUT', BASE, { keepDaily: 7, keepWeekly: 4, keepMonthly: 6 });
  });
});

describe('client-side encryption, listing and restore', () => {
  let encryptedKey = '';

  it('encrypts before upload: the bucket never holds the archive in clear', async () => {
    await call(cookie, 'PUT', BASE, { passphrase: PASS });
    const job = await runNow();
    expect(job.status, job.error ?? '').toBe('COMPLETED');
    const keys = s3.keys(`${folder()}archives/`).filter((k) => k.endsWith('.shopme.enc'));
    expect(keys.length).toBeGreaterThanOrEqual(1);
    encryptedKey = keys[keys.length - 1]!;
    const body = s3.objects.get(encryptedKey)!.body;
    expect(body.subarray(0, 6).toString()).toBe('SMENC1');
    expect(body.includes(Buffer.from('manifest.json'))).toBe(false);
  });

  it('lists remote backups, newest first, with kind, size and encryption', async () => {
    const r = (await call(cookie, 'GET', `${BASE}/remote`)).json() as { backups: Array<{ key: string; kind: string; encrypted: boolean; bytes: number; createdAt: string }> };
    const stamps = r.backups.map((b) => b.createdAt);
    expect(stamps).toEqual([...stamps].sort().reverse());
    const enc = r.backups.find((b) => b.key === encryptedKey)!;
    expect(enc).toMatchObject({ kind: 'store', encrypted: true });
    expect(enc.bytes).toBeGreaterThan(100);
    expect(r.backups.some((b) => b.key.endsWith('notes.txt'))).toBe(false);
  });

  it('downloads a backup decrypted, and refuses keys that are not its own', async () => {
    const dl = await call(cookie, 'GET', `${BASE}/download?key=${encodeURIComponent(encryptedKey)}`);
    expect(dl.statusCode).toBe(200);
    expect(dl.headers['content-disposition']).toMatch(/backup-.*\.shopme"$/);
    expect(dl.rawPayload.subarray(0, 2).toString()).toBe('PK');
    for (const key of [`backups/shop-${shopId + 100}/archives/backup-2020-01-01T03-00-00Z.shopme`, `${folder()}archives/notes.txt`, `${folder()}../shop-9/archives/backup-2020-01-01T03-00-00Z.shopme`, 'whatever']) {
      expect((await call(cookie, 'GET', `${BASE}/download?key=${encodeURIComponent(key)}`)).statusCode, key).toBe(400);
    }
    // wrong passphrase saved: the download fails instead of returning garbage
    await call(cookie, 'PUT', BASE, { passphrase: 'a different passphrase' });
    const bad = await call(cookie, 'GET', `${BASE}/download?key=${encodeURIComponent(encryptedKey)}`);
    expect(bad.rawPayload.subarray(0, 2).toString()).not.toBe('PK');
    await call(cookie, 'PUT', BASE, { passphrase: PASS });
  });

  it('restores through the regular import, after a confirmation when the store has data', async () => {
    expect((await gql(cookie, 'mutation { productCreate(product: { title: "Kept by the backup" }) { userErrors { message } } }')).errors).toBeUndefined();
    await runNow();
    const key = s3.keys(`${folder()}archives/`).filter((k) => k.endsWith('.shopme.enc')).pop()!;
    expect(await productCount()).toBe(1);
    await gql(cookie, 'mutation { productCreate(product: { title: "Created after the backup" }) { userErrors { message } } }');
    expect(await productCount()).toBe(2);

    expect((await call(cookie, 'POST', `${BASE}/restore`, { key })).json()).toMatchObject({ needsConfirm: true });
    expect(await productCount()).toBe(2); // nothing happened yet
    expect((await call(cookie, 'POST', `${BASE}/restore`, { key: 'nope', confirm: 'replace' })).statusCode).toBe(404);
    expect((await call(cookie, 'POST', `${BASE}/restore`, { key: `backups/shop-${shopId + 100}/archives/backup-2020-01-01T03-00-00Z.shopme`, confirm: 'replace' })).statusCode).toBe(404);

    const r = await call(cookie, 'POST', `${BASE}/restore`, { key, confirm: 'replace' });
    expect(r.statusCode, r.body).toBe(202);
    const job = await waitJob(cookie, (r.json() as { job: { id: number } }).job.id);
    expect(job.error).toBeNull();
    expect(job.status).toBe('COMPLETED');
    expect(await productCount()).toBe(1);
    const titles = (await db().select({ t: s.products.title }).from(s.products).where(eq(s.products.shopId, shopId))).map((p) => p.t);
    expect(titles).toEqual(['Kept by the backup']);
  });

  it('reports a restore that cannot be decrypted as a failed job and leaves the store untouched', async () => {
    const key = s3.keys(`${folder()}archives/`).filter((k) => k.endsWith('.shopme.enc')).pop()!;
    await call(cookie, 'PUT', BASE, { passphrase: 'not the passphrase used' });
    const r = await call(cookie, 'POST', `${BASE}/restore`, { key, confirm: 'replace' });
    const job = await waitJob(cookie, (r.json() as { job: { id: number } }).job.id);
    expect(job.status).toBe('FAILED');
    expect(job.error).toMatch(/passphrase is wrong or the file is damaged/);
    expect(await productCount()).toBe(1);
    await call(cookie, 'PUT', BASE, { passphrase: PASS });
  });
});

describe('failure, retry and the banner', () => {
  const at = (hours: number) => new Date(Date.now() + hours * 3600_000);
  afterAll(() => setClock(null));

  it('records a failed upload with its error, retries with backoff and raises the banner', async () => {
    await call(cookie, 'PUT', BASE, { clearPassphrase: true });
    await db().delete(s.backupRuns);
    s3.failWrites(1000);
    const job = await runNow();
    expect(job.status).toBe('FAILED');
    const h = (await call(cookie, 'GET', BASE)).json() as { history: Array<{ status: string; attempts: number; error: string; nextAttemptAt: string }>; alert: { kind: string; retrying: boolean; error: string } };
    expect(h.history[0]).toMatchObject({ status: 'retry', attempts: 1 });
    expect(h.history[0]!.error).toBeTruthy();
    expect(new Date(h.history[0]!.nextAttemptAt).getTime() - Date.now()).toBeGreaterThan(4 * 60_000); // 5 minutes
    expect(h.alert).toMatchObject({ kind: 'failed', retrying: true });
    expect(JSON.stringify(h)).not.toContain(SECRET);
    expect((await call(cookie, 'GET', `${BASE}/alert`)).json()).toMatchObject({ alert: { kind: 'failed' } });

    // nothing is due yet: the sweep leaves it alone
    await t.app.ctx.offsite.sweep();
    expect((await db().select().from(s.backupRuns))[0]!.attempts).toBe(1);

    // 6 minutes later the first retry runs (and fails again, now waiting 15 minutes)
    const t1 = at(0.1);
    setClock(t1);
    await t.app.ctx.offsite.sweep();
    const second = (await db().select().from(s.backupRuns).where(eq(s.backupRuns.kind, 'store')))[0]!;
    expect(second).toMatchObject({ status: 'retry', attempts: 2 });
    expect(second.nextAttemptAt!.getTime() - t1.getTime()).toBe(15 * 60_000);
  });

  it('recovers when the destination comes back, and the banner clears', async () => {
    s3.failWrites(0);
    setClock(at(1));
    await t.app.ctx.offsite.sweep();
    const run = (await db().select().from(s.backupRuns).where(eq(s.backupRuns.kind, 'store')))[0]!;
    expect(run).toMatchObject({ status: 'ok', attempts: 3, error: null });
    expect(s3.keys(`${folder()}archives/`).some((k) => k.endsWith(path.basename(run.objectKey!)))).toBe(true);
    expect(((await call(cookie, 'GET', BASE)).json() as { alert: unknown }).alert).toBeNull();
  });

  it('gives up after five attempts and tells the activity feed', async () => {
    await db().delete(s.backupRuns);
    s3.failWrites(1000);
    setClock(null);
    await runNow();
    for (let i = 1; i <= 4; i++) { setClock(at(i * 10)); await t.app.ctx.offsite.sweep(); }
    const [run] = await db().select().from(s.backupRuns).where(eq(s.backupRuns.kind, 'store'));
    expect(run).toMatchObject({ status: 'failed', attempts: 5, nextAttemptAt: null });
    expect(((await call(cookie, 'GET', BASE)).json() as { alert: { retrying: boolean } }).alert).toMatchObject({ retrying: false });
    const feed = await db().select().from(s.events).where(eq(s.events.verb, 'activity.backup'));
    expect(feed.some((e) => (e.data as { error?: string } | null)?.error?.startsWith('Off-site backup:'))).toBe(true);
    s3.failWrites(0);
  });

  it('raises the banner when the newest good upload is older than 48 hours', async () => {
    await db().delete(s.backupRuns);
    setClock(null);
    expect((await runNow()).status).toBe('COMPLETED');
    expect(((await call(cookie, 'GET', BASE)).json() as { alert: unknown }).alert).toBeNull();
    setClock(at(47));
    expect(((await call(cookie, 'GET', BASE)).json() as { alert: unknown }).alert).toBeNull();
    setClock(at(49));
    expect(((await call(cookie, 'GET', BASE)).json() as { alert: unknown }).alert).toMatchObject({ kind: 'stale' });
    setClock(null);
  });

  it('a failing pg_dump fails its own run without touching the archive upload', async () => {
    if (multi()) return;
    await db().delete(s.backupRuns);
    process.env.FAKE_DUMP_FAIL = '1';
    try {
      const job = await runNow();
      expect(job.status).toBe('FAILED');
      const runs = await db().select().from(s.backupRuns);
      expect(runs.find((r) => r.kind === 'store')!.status).toBe('ok');
      expect(runs.find((r) => r.kind === 'database')).toMatchObject({ status: 'retry' });
      expect(runs.find((r) => r.kind === 'database')!.error).toMatch(/pg_dump failed.*connection refused/);
    } finally { delete process.env.FAKE_DUMP_FAIL; }
  });

  it('turns the banner off when the destination is switched off or removed', async () => {
    await call(cookie, 'PUT', BASE, { enabled: false });
    expect(((await call(cookie, 'GET', `${BASE}/alert`)).json() as { alert: unknown }).alert).toBeNull();
    await call(cookie, 'PUT', BASE, { enabled: true });
    expect((await call(cookie, 'DELETE', BASE)).statusCode).toBe(200);
    expect(((await call(cookie, 'GET', BASE)).json() as { destination: { configured: boolean } }).destination.configured).toBe(false);
    expect((await call(cookie, 'GET', `${BASE}/remote`)).statusCode).toBe(502);
  });
});

describe('every store has its own destination, history and folder (multi-store)', () => {
  let m: TestApp;
  let alice: string, bob: string;
  let shopA: number, shopB: number;
  const ADMIN = 'localhost';
  const mdb = () => m.dbHandle.db;
  const mcall = (ck: string | null, method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, payload?: unknown) =>
    m.app.inject({ method, url, headers: { host: ADMIN }, payload: payload as never, cookies: ck ? { shopme_session: ck } : undefined });
  const cookieOf = (r: { cookies: Array<{ name: string; value: string }> }) => r.cookies.find((c) => c.name === 'shopme_session')!.value;
  const storeUrl = (handle: string, p: string) => `/admin/store/${handle}/api${p}`;
  const A = '/store/backups/offsite';
  let s3: FakeS3; // its own bucket: store ids restart at 1 in this installation
  const form = (o: Record<string, unknown> = {}) => ({ enabled: true, preset: 'custom', endpoint: s3.endpoint, region: 'us-east-1', forcePathStyle: true, bucket: s3.bucket, prefix: 'backups', accessKeyId: s3.accessKeyId, secretAccessKey: SECRET, keepDaily: 7, keepWeekly: 4, keepMonthly: 6, ...o });

  beforeAll(async () => {
    s3 = await startFakeS3();
    m = await createTestApp({ MULTI_STORE: 'true', STORE_BASE_DOMAIN: 'shops.example.org', BACKUP_ALLOW_PRIVATE_ENDPOINTS: 'true', DATABASE_URL: 'postgres://shopper:dbpass@db.internal:5432/shopdb', PG_DUMP_PATH: dumpScript });
    const setup = await mcall(null, 'POST', '/admin/api/setup', { shopName: 'Alpha Store', email: 'alice@example.com', password: 'alice-password', currency: 'EUR', country: 'FR', locale: 'en' });
    expect(setup.statusCode, setup.body).toBe(201);
    alice = cookieOf(setup);
    await mcall(alice, 'PUT', '/admin/api/platform/settings', { storeCreation: 'EVERYONE' });
    await createAccount(mdb(), { email: 'bob@example.com', password: 'bob-password' });
    bob = cookieOf(await mcall(null, 'POST', '/admin/api/auth/login', { email: 'bob@example.com', password: 'bob-password' }));
    const created = await mcall(bob, 'POST', '/admin/api/account/stores', { shopName: 'Beta Shop', currency: 'USD', country: 'US', locale: 'en' });
    expect(created.statusCode, created.body).toBe(201);
    shopA = (await mdb().select().from(s.shops).where(eq(s.shops.handle, 'alpha-store')))[0]!.id;
    shopB = (await mdb().select().from(s.shops).where(eq(s.shops.handle, 'beta-shop')))[0]!.id;
  }, 180_000);
  afterAll(async () => { await m?.close(); await s3?.close(); });

  const put = (ck: string, handle: string, body: Record<string, unknown>) => mcall(ck, 'PUT', storeUrl(handle, A), body);
  const backupNow = async (ck: string, handle: string) => {
    const r = await mcall(ck, 'POST', storeUrl(handle, `${A}/run`), {});
    expect(r.statusCode, r.body).toBe(202);
    const id = (r.json() as { job: { id: number } }).job.id;
    for (let i = 0; i < 300; i++) {
      const j = ((await mcall(ck, 'GET', storeUrl(handle, `/store/jobs/${id}`))).json() as { job: { done: boolean; error: string | null; status: string } }).job;
      if (j.done) return j;
      await new Promise((r2) => setTimeout(r2, 100));
    }
    throw new Error('job did not finish');
  };

  it('keeps settings, history and secrets per store, in the same bucket and folder', async () => {
    // Both stores point at the same bucket and prefix, with different secrets: they still cannot see each other.
    expect((await put(alice, 'alpha-store', form({ secretAccessKey: 'ALPHA-SECRET-VALUE' }))).statusCode).toBe(200);
    expect((await put(bob, 'beta-shop', form({ secretAccessKey: 'BETA-SECRET-VALUE', keepDaily: 3 }))).statusCode).toBe(200);
    const a = (await mcall(alice, 'GET', storeUrl('alpha-store', A))).json() as { destination: { keepDaily: number; secretSet: boolean } };
    const b = (await mcall(bob, 'GET', storeUrl('beta-shop', A))).json() as { destination: { keepDaily: number } };
    expect(a.destination.keepDaily).toBe(7);
    expect(b.destination.keepDaily).toBe(3);
    const rows = await mdb().select().from(s.backupDestinations);
    expect(rows.filter((r) => r.shopId === shopA || r.shopId === shopB)).toHaveLength(2);
    expect(JSON.stringify(rows)).not.toMatch(/ALPHA-SECRET-VALUE|BETA-SECRET-VALUE/);
    // Bob cannot reach Alpha's store through his own session
    expect((await mcall(bob, 'GET', storeUrl('alpha-store', A))).statusCode).toBe(403);
  });

  it('uploads each store to its own folder, lists only its own backups and refuses the other store’s keys', async () => {
    expect((await backupNow(alice, 'alpha-store')).status).toBe('COMPLETED');
    expect((await backupNow(bob, 'beta-shop')).status).toBe('COMPLETED');
    const aKeys = s3.keys(`backups/shop-${shopA}/archives/`).filter((k) => k.endsWith('.shopme'));
    const bKeys = s3.keys(`backups/shop-${shopB}/archives/`).filter((k) => k.endsWith('.shopme'));
    expect(aKeys.length).toBeGreaterThanOrEqual(1);
    expect(bKeys.length).toBeGreaterThanOrEqual(1);
    expect(s3.keys(`backups/shop-${shopA}/database/`)).toEqual([]); // no whole-database dump in a store's folder
    expect(s3.keys(`backups/shop-${shopB}/database/`)).toEqual([]);
    const listA = ((await mcall(alice, 'GET', storeUrl('alpha-store', `${A}/remote`))).json() as { backups: Array<{ key: string }> }).backups.map((x) => x.key);
    const listB = ((await mcall(bob, 'GET', storeUrl('beta-shop', `${A}/remote`))).json() as { backups: Array<{ key: string }> }).backups.map((x) => x.key);
    expect(listA.every((k) => k.startsWith(`backups/shop-${shopA}/`))).toBe(true);
    expect(listB.every((k) => k.startsWith(`backups/shop-${shopB}/`))).toBe(true);
    expect(listA.some((k) => listB.includes(k))).toBe(false);
    // cross-store download and restore
    const foreign = encodeURIComponent(aKeys[0]!);
    expect((await mcall(bob, 'GET', storeUrl('beta-shop', `${A}/download?key=${foreign}`))).statusCode).toBe(400);
    expect((await mcall(bob, 'POST', storeUrl('beta-shop', `${A}/restore`), { key: aKeys[0], confirm: 'replace' })).statusCode).toBe(404);
    // history per store
    const histA = (await mdb().select().from(s.backupRuns).where(eq(s.backupRuns.shopId, shopA)));
    const histB = (await mdb().select().from(s.backupRuns).where(eq(s.backupRuns.shopId, shopB)));
    expect(histA.every((r) => r.subjectShopId === shopA || r.subjectShopId === null)).toBe(true);
    expect(histB.every((r) => r.subjectShopId === shopB || r.subjectShopId === null)).toBe(true);
    // a failing destination for one store raises that store's banner only
    await put(bob, 'beta-shop', { bucket: 'nonexistent-bucket' });
    await backupNow(bob, 'beta-shop');
    expect(((await mcall(bob, 'GET', storeUrl('beta-shop', `${A}/alert`))).json() as { alert: { kind: string } }).alert).toMatchObject({ kind: 'failed' });
    expect(((await mcall(alice, 'GET', storeUrl('alpha-store', `${A}/alert`))).json() as { alert: unknown }).alert).toBeNull();
  });

  describe('platform destination', () => {
    const P = '/admin/api/platform/backups/offsite';
    it('belongs to the platform owner only', async () => {
      expect((await mcall(null, 'GET', P)).statusCode).toBe(401);
      expect((await mcall(bob, 'GET', P)).statusCode).toBe(403);
      expect((await mcall(bob, 'PUT', P, form())).statusCode).toBe(403);
      expect((await mcall(bob, 'POST', `${P}/run`, {})).statusCode).toBe(403);
      expect((await mcall(alice, 'GET', P)).statusCode).toBe(200);
    });

    it('backs up every store and the database, encrypted, into its own folder, and never returns its secret', async () => {
      const r = await mcall(alice, 'PUT', P, form({ prefix: 'platform-level', passphrase: PASS, secretAccessKey: 'PLATFORM-SECRET-VALUE' }));
      expect(r.statusCode, r.body).toBe(200);
      expect(r.body).not.toMatch(/PLATFORM-SECRET-VALUE|correct horse/);
      expect(((await mcall(alice, 'GET', P)).json() as { destination: { scope: string } }).destination.scope).toBe('platform');
      expect((await mcall(alice, 'POST', `${P}/test`, {})).json()).toMatchObject({ ok: true });
      const runs = await m.app.ctx.offsite.runPlatform('manual');
      expect(runs.map((x) => x.status)).toEqual(['ok', 'ok', 'ok']); // two stores and the database dump
      const keys = s3.keys('platform-level/platform/');
      expect(keys.filter((k) => k.includes(`/archives/shop-${shopA}/`) && k.endsWith('.shopme.enc'))).toHaveLength(1);
      expect(keys.filter((k) => k.includes(`/archives/shop-${shopB}/`) && k.endsWith('.shopme.enc'))).toHaveLength(1);
      expect(keys.filter((k) => k.includes('/database/') && k.endsWith('.dump.enc'))).toHaveLength(1);
      // history rows of the platform destination have no store scope; the stores' own history is untouched
      const platformRuns = await mdb().select().from(s.backupRuns).where(isNull(s.backupRuns.shopId));
      expect(platformRuns).toHaveLength(3);
      const list = ((await mcall(alice, 'GET', `${P}/remote`)).json() as { backups: Array<{ key: string; kind: string; subjectShopId: number | null }> }).backups;
      expect(list.filter((b) => b.kind === 'store').map((b) => b.subjectShopId).sort()).toEqual([shopA, shopB].sort());
      expect(list.filter((b) => b.kind === 'database')).toHaveLength(1);
      const dl = await mcall(alice, 'GET', `${P}/download?key=${encodeURIComponent(list.find((b) => b.kind === 'store')!.key)}`);
      expect(dl.rawPayload.subarray(0, 2).toString()).toBe('PK');
      const dump = await mcall(alice, 'GET', `${P}/download?key=${encodeURIComponent(list.find((b) => b.kind === 'database')!.key)}`);
      expect(dump.body).toContain('PGDMP-FAKE');
      // the stores' destinations are not the platform's: a store folder does not appear in the platform list
      expect(list.some((b) => b.key.startsWith('backups/'))).toBe(false);
    });

    it('is separate from the stores: its history, banner and daily schedule are its own', async () => {
      expect(await mdb().select({ n: count() }).from(s.backupDestinations).where(and(isNull(s.backupDestinations.shopId)))).toEqual([{ n: 1 }]);
      expect(((await mcall(alice, 'GET', `${P}/alert`)).json() as { alert: unknown }).alert).toBeNull();
      // the sweep starts a platform backup only when the last one is a day old
      const before = (await mdb().select().from(s.backupRuns).where(isNull(s.backupRuns.shopId))).length;
      await m.app.ctx.offsite.sweep();
      expect((await mdb().select().from(s.backupRuns).where(isNull(s.backupRuns.shopId))).length).toBe(before);
      (m.app.ctx.offsite as unknown as { deps: { now?: () => Date } }).deps.now = () => new Date(Date.now() + 25 * 3600_000);
      await m.app.ctx.offsite.sweep();
      (m.app.ctx.offsite as unknown as { deps: { now?: () => Date } }).deps.now = undefined;
      expect((await mdb().select().from(s.backupRuns).where(isNull(s.backupRuns.shopId))).length).toBe(before + 3);
    });
  });
});
