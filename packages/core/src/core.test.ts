import { mkdtempSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApiToken, createDb, createInProcessQueue, createLocalStorage, createSession, destroySession, authenticateStaff, listEvents, addEvent,
  loadConfig, makeStorageKey, needsSetup, nextOrderNumber, resolveApiToken, resolveSession, runMigrations, saveUpload, schema, seedDemo, setupStore, slugify, uniqueHandle, type DbHandle } from './index';

/** `db.execute` returns `{ rows }` on PGlite and the bare row array on postgres.js. */
const rowsOf = <T>(r: unknown): T[] => (r as { rows?: T[] }).rows ?? (r as T[]);

describe('config', () => {
  const tmp = () => mkdtempSync(path.join(tmpdir(), 'shopme-cfg-'));
  it('applies defaults and generates + persists a session secret', () => {
    const base = tmp();
    const warnings: string[] = [];
    const c = loadConfig({}, { baseDir: base, warn: (m) => warnings.push(m) });
    expect(c.port).toBe(3000);
    expect(c.appUrl).toBe('http://localhost:3000');
    expect(c.dataDir).toBe(path.join(base, 'data'));
    expect(c.storageDir).toBe(path.join(base, 'data', 'uploads'));
    expect(c.databaseUrl).toBeUndefined();
    expect(warnings).toHaveLength(1);
    const again = loadConfig({}, { baseDir: base, warn: (m) => warnings.push(m) });
    expect(again.sessionSecret).toBe(c.sessionSecret);
    expect(warnings).toHaveLength(1);
    expect(existsSync(path.join(base, 'data', 'session-secret'))).toBe(true);
  });
  it('treats empty strings as unset and parses values', () => {
    const c = loadConfig({ PORT: '8080', APP_URL: 'https://shop.example.com/', DATABASE_URL: '', SMTP_URL: '', SESSION_SECRET: 'x'.repeat(40), STRIPE_SECRET_KEY: 'sk_test' }, { baseDir: tmp() });
    expect(c.port).toBe(8080);
    expect(c.appUrl).toBe('https://shop.example.com');
    expect(c.databaseUrl).toBeUndefined();
    expect(c.stripe.secretKey).toBe('sk_test');
  });
  it('rejects invalid values with a readable message', () => {
    expect(() => loadConfig({ PORT: 'abc', SESSION_SECRET: 'x'.repeat(40) }, { baseDir: tmp() })).toThrow(/PORT/);
    expect(() => loadConfig({ DATABASE_URL: 'mysql://x', SESSION_SECRET: 'x'.repeat(40) }, { baseDir: tmp() })).toThrow(/DATABASE_URL/);
    expect(() => loadConfig({ SESSION_SECRET: 'short' }, { baseDir: tmp() })).toThrow(/SESSION_SECRET/);
  });
  it('overrides win over env', () => {
    const c = loadConfig({ PORT: '1' , SESSION_SECRET: 'x'.repeat(40) }, { baseDir: tmp(), overrides: { port: 0, dataDir: '/tmp/x-data' } });
    expect(c.port).toBe(0);
    expect(c.dataDir).toBe('/tmp/x-data');
  });
});

describe('database + services (PGlite in memory)', () => {
  let h: DbHandle;
  beforeAll(async () => { h = await createDb({ memory: true }); await runMigrations(h); }, 60_000);
  afterAll(async () => { await h.close(); });

  it('applies migrations (all MVP tables exist) and is idempotent', async () => {
    await runMigrations(h);
    const r = await h.db.execute(sql`select table_name from information_schema.tables where table_schema = 'public'`);
    const names = new Set(rowsOf<{ table_name: string }>(r).map((x) => x.table_name));
    for (const t of ['shops', 'staff_users', 'sessions', 'api_tokens', 'products', 'product_variants', 'inventory_levels', 'collections', 'customers', 'carts', 'orders', 'order_lines', 'transactions', 'fulfillments', 'refunds', 'discounts', 'shipping_rates', 'tax_rates', 'pages', 'menus', 'menu_items', 'themes', 'theme_files', 'metafields', 'webhook_subscriptions', 'events', 'sequences', 'files']) expect(names.has(t), t).toBe(true);
  });

  it('setup -> authenticate -> session -> api token', async () => {
    expect(await needsSetup(h.db)).toBe(true);
    const { shop, owner } = await setupStore(h.db, { shopName: 'T', email: 'A@B.com', password: 'password123', currency: 'eur', country: 'fr', locale: 'fr' });
    expect(shop.currency).toBe('EUR');
    expect(shop.moneyFormat).toContain('amount_with_comma_separator');
    expect(owner.email).toBe('a@b.com');
    expect(await needsSetup(h.db)).toBe(false);
    // default menus exist from the start so the merchant can add links to the main menu
    const defaultMenus = await h.db.select({ handle: schema.menus.handle }).from(schema.menus).where(eq(schema.menus.shopId, shop.id));
    expect(defaultMenus.map((r) => r.handle).sort()).toEqual(['footer', 'main-menu']);
    await expect(setupStore(h.db, { shopName: 'T2', email: 'x@y.com', password: 'password123', currency: 'USD', country: 'US', locale: 'en' })).rejects.toThrow(/already/);

    expect(await authenticateStaff(h.db, 'a@b.com', 'wrong')).toBeNull();
    const u = await authenticateStaff(h.db, ' A@B.com ', 'password123');
    expect(u?.id).toBe(owner.id);
    const { token } = await createSession(h.db, { shopId: shop.id, staffUserId: owner.id });
    expect((await resolveSession(h.db, token))?.id).toBe(owner.id);
    await destroySession(h.db, token);
    expect(await resolveSession(h.db, token)).toBeNull();
    const expired = await createSession(h.db, { shopId: shop.id, staffUserId: owner.id, ttlMs: -1000 });
    expect(await resolveSession(h.db, expired.token)).toBeNull();

    const api = await createApiToken(h.db, { shopId: shop.id, name: 'test', scopes: ['read_products'] });
    expect((await resolveApiToken(h.db, api.token))?.shopId).toBe(shop.id);
    expect(await resolveApiToken(h.db, 'nope')).toBeNull();
  });

  it('allocates order numbers from 1001 per shop', async () => {
    const shopId = rowsOf<{ id: number }>(await h.db.execute(sql`select id from shops limit 1`))[0]!.id;
    expect(await nextOrderNumber(h.db, shopId)).toBe(1001);
    expect(await nextOrderNumber(h.db, shopId)).toBe(1002);
    const concurrent = await Promise.all([nextOrderNumber(h.db, shopId), nextOrderNumber(h.db, shopId)]);
    expect(new Set(concurrent).size).toBe(2);
  });

  it('events timeline', async () => {
    const shopId = rowsOf<{ id: number }>(await h.db.execute(sql`select id from shops limit 1`))[0]!.id;
    await addEvent(h.db, shopId, { subjectType: 'order', subjectId: 5, kind: 'comment', message: 'hello' });
    const list = await listEvents(h.db, shopId, 'order', 5);
    expect(list).toHaveLength(1);
    expect(list[0]!.kind).toBe('comment');
  });

  it('seeds demo data idempotently', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'shopme-seed-'));
    const storage = createLocalStorage(dir);
    await seedDemo(h.db, storage);
    await seedDemo(h.db, storage);
    const r = rowsOf<Record<string, number>>(await h.db.execute(sql`select (select count(*)::int from products) p, (select count(*)::int from product_variants) v, (select count(*)::int from menus) m, (select count(*)::int from collections) c`));
    expect(r[0]).toEqual({ p: 5, v: 10, m: 2, c: 3 });
    expect(existsSync(path.join(dir, 'demo', 'product-highland-morning-coffee-beans-1.webp'))).toBe(true);
  });

  it('saves uploads', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'shopme-up-'));
    const shopId = rowsOf<{ id: number }>(await h.db.execute(sql`select id from shops limit 1`))[0]!.id;
    const f = await saveUpload(h.db, createLocalStorage(dir), shopId, { filename: '../../evil name.PNG', data: Buffer.from('x'), mimeType: 'image/png' });
    expect(f.url.startsWith('/files/')).toBe(true);
    expect(readFileSync(path.join(dir, f.storageKey), 'utf8')).toBe('x');
  });
});

describe('helpers', () => {
  it('slugify and uniqueHandle', async () => {
    expect(slugify('Crème Brûlée & Co!')).toBe('creme-brulee-co');
    const taken = new Set(['tea', 'tea-2']);
    expect(await uniqueHandle('Tea', async (h) => taken.has(h))).toBe('tea-3');
  });
  it('storage keys are safe', async () => {
    expect(makeStorageKey('../x y.JPG')).toMatch(/^\d{4}\/\d{2}\/[\w-]+-x-y\.jpg$/);
    const st = createLocalStorage(tmpdir());
    await expect(st.put('../escape', Buffer.from('x'))).rejects.toThrow();
  });
  it('in-process queue runs, retries and stops', async () => {
    const q = createInProcessQueue({ error() {} });
    let n = 0;
    q.register('t', async (x: number) => { n += x; });
    q.enqueue('t', 2);
    await q.idle();
    expect(n).toBe(2);
    expect(() => q.enqueue('unknown', 1)).toThrow();
    let ticks = 0;
    q.every('tick', 5, async () => { ticks++; });
    await new Promise((r) => setTimeout(r, 30));
    await q.stop();
    expect(ticks).toBeGreaterThan(0);
  });
});
