import { createWriteStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { once } from 'node:events';
import { Zip, ZipDeflate, ZipPassThrough, strFromU8, strToU8, unzipSync } from 'fflate';
import { eq, getTableColumns, getTableName, is, sql } from 'drizzle-orm';
import { getTableConfig, PgTable } from 'drizzle-orm/pg-core';
import * as schema from '../db/schema';
import type { Db, Executor } from '../db/client';
import { shops } from '../db/schema';
import { assertSafeKey, type Storage } from './storage';

export const EXPORT_FORMAT = 'shopme-export';
export const EXPORT_FORMAT_VERSION = 1;
/** Rows of these tables are not exported: credentials, sessions, transient and rebuildable data. */
const EXCLUDED = new Set(['sessions', 'staff_users', 'staff_two_factor', 'api_tokens', 'customer_tokens', 'jobs', 'webhook_deliveries', 'visits', 'customer_login_codes', 'storefront_events']);

export interface ExportManifest {
  format: typeof EXPORT_FORMAT; formatVersion: number; appVersion: string; schemaVersion: number; createdAt: string;
  shop: { name: string; currency: string; locale: string };
  tables: Record<string, number>; files: number;
}
export interface ImportSummary { tables: Record<string, number>; files: number; manifest: ExportManifest }

/* eslint-disable @typescript-eslint/no-explicit-any */
interface Tbl { name: string; table: any; cols: [string, { name: string; dataType: string }][]; shopCol: string }
const shopEq = (t: Tbl, shopId: number) => eq((t.table as Record<string, any>)[t.shopCol], shopId);

/** Exported tables in foreign-key order (parents first). */
function exportTables(): Tbl[] {
  const all = Object.values(schema as Record<string, unknown>).filter((v): v is PgTable => is(v, PgTable)).map((table) => ({ name: getTableName(table), table: table as any }))
    .filter((t) => !EXCLUDED.has(t.name) && t.name !== 'shops');
  const names = new Set(all.map((t) => t.name));
  const deps = new Map(all.map((t) => [t.name, getTableConfig(t.table).foreignKeys.map((f) => getTableName(f.reference().foreignTable)).filter((n) => names.has(n) && n !== t.name)]));
  const out: Tbl[] = [];
  const seen = new Set<string>();
  const visit = (n: string) => {
    if (seen.has(n)) return;
    seen.add(n);
    deps.get(n)!.forEach(visit);
    const t = all.find((x) => x.name === n)!;
    const cols = Object.entries(getTableColumns(t.table)) as Tbl["cols"];
    out.push({ name: n, table: t.table, cols, shopCol: cols.find(([, c]) => c.name === 'shop_id')![0] });
  };
  all.map((t) => t.name).sort().forEach(visit);
  return out;
}

const rowsOf = (r: unknown) => ((r as { rows?: unknown[] }).rows ?? (r as unknown[])) as Record<string, unknown>[];

/** Number of applied migrations: a store can only be imported into an installation at least as new as the one that wrote it. */
export async function schemaVersion(db: Executor): Promise<number> {
  try { return Number(rowsOf(await db.execute(sql`select count(*)::int as n from drizzle.__drizzle_migrations`))[0]?.n ?? 0); } catch { return 0; }
}

/** Write the whole store (JSON per table, uploaded files, theme files) to a single `.shopme` zip at `file`. */
export async function exportStore(db: Db, storage: Storage, shopId: number, file: string, opts: { appVersion: string; progress?: (done: number, total: number) => void }): Promise<ExportManifest> {
  const [shop] = await db.select().from(shops).where(eq(shops.id, shopId));
  if (!shop) throw new Error('Shop not found');
  const tables = exportTables();
  const out = createWriteStream(file);
  const failed = new Promise<never>((_r, rej) => out.on('error', rej));
  const zip = new Zip((err, chunk, final) => { if (err) out.destroy(err); else { out.write(chunk); if (final) out.end(); } });
  const add = (name: string, data: Uint8Array, store = false) => {
    const f = store ? new ZipPassThrough(name) : new ZipDeflate(name, { level: 6 });
    zip.add(f); f.push(data, true);
  };
  const counts: Record<string, number> = {};
  const keys = new Set<string>();
  let done = 0;
  const total = tables.length + 1;
  for (const t of tables) {
    let rows = await db.select().from(t.table).where(shopEq(t, shopId)) as Record<string, unknown>[];
    if (t.name === 'events') rows = rows.map((r) => ({ ...r, authorStaffUserId: null }));
    counts[t.name] = rows.length;
    if (rows.length) add(`data/${t.name}.json`, strToU8(JSON.stringify(rows)));
    if (t.name === 'files' || t.name === 'theme_files') for (const r of rows) if (typeof r.storageKey === 'string' && r.storageKey) keys.add(r.storageKey);
    opts.progress?.(++done, total);
  }
  let files = 0;
  for (const key of keys) {
    const stream = await storage.open(key);
    if (!stream) continue;
    const chunks: Buffer[] = [];
    for await (const c of stream) chunks.push(Buffer.from(c));
    add(`uploads/${key}`, Buffer.concat(chunks), true);
    files++;
  }
  const manifest: ExportManifest = {
    format: EXPORT_FORMAT, formatVersion: EXPORT_FORMAT_VERSION, appVersion: opts.appVersion, schemaVersion: await schemaVersion(db), createdAt: new Date().toISOString(),
    shop: { name: shop.name, currency: shop.currency, locale: shop.locale }, tables: counts, files,
  };
  add('manifest.json', strToU8(JSON.stringify(manifest, null, 2)));
  const { id: _id, ...shopRow } = shop;
  void _id;
  add('data/shop.json', strToU8(JSON.stringify(shopRow)));
  zip.end();
  await Promise.race([once(out, 'close'), failed]);
  opts.progress?.(total, total);
  return manifest;
}

export const MAX_IMPORT_BYTES = 2 * 1024 * 1024 * 1024;

export type ImportResult = { ok: true; value: ImportSummary } | { ok: false; error: string };

/** Read and validate the manifest of a `.shopme` archive. */
export function readManifest(files: Record<string, Uint8Array>): ExportManifest | string {
  const raw = files['manifest.json'];
  if (!raw) return 'This is not a ShopMe export (manifest.json is missing).';
  let m: ExportManifest;
  try { m = JSON.parse(strFromU8(raw)) as ExportManifest; } catch { return 'The export manifest is unreadable.'; }
  if (m.format !== EXPORT_FORMAT) return 'This is not a ShopMe export.';
  if (m.formatVersion > EXPORT_FORMAT_VERSION) return `This export uses format version ${m.formatVersion}; this server supports up to ${EXPORT_FORMAT_VERSION}. Update ShopMe first.`;
  return m;
}

const toDate = (v: unknown) => (typeof v === 'string' ? new Date(v) : v);

/**
 * Replace the store's contents with a `.shopme` archive (the signed-in staff, sessions and API tokens of this installation are kept).
 * Idempotent: importing the same file twice leaves the same state. Ids are preserved; shop ids are remapped to `shopId`.
 */
export async function importStore(db: Db, storage: Storage, shopId: number, file: string, opts: { progress?: (done: number, total: number) => void } = {}): Promise<ImportResult> {
  const size = (await stat(file)).size;
  if (size > MAX_IMPORT_BYTES) return { ok: false, error: 'The file is too large.' };
  let entries: Record<string, Uint8Array>;
  try { entries = unzipSync(new Uint8Array(await readFile(file))); } catch { return { ok: false, error: 'The file is not a valid .shopme archive.' }; }
  const manifest = readManifest(entries);
  if (typeof manifest === 'string') return { ok: false, error: manifest };
  const current = await schemaVersion(db);
  if (manifest.schemaVersion > current) return { ok: false, error: `This export comes from a newer ShopMe (database version ${manifest.schemaVersion}, this server has ${current}). Update this server first.` };

  const tables = exportTables();
  const data = (name: string) => (entries[`data/${name}.json`] ? (JSON.parse(strFromU8(entries[`data/${name}.json`]!)) as Record<string, unknown>[]) : []);
  const uploads = Object.keys(entries).filter((k) => k.startsWith('uploads/')).map((k) => k.slice('uploads/'.length));
  for (const k of uploads) assertSafeKey(k);
  const counts: Record<string, number> = {};
  let done = 0;
  const total = tables.length * 2 + 2;
  await db.transaction(async (tx) => {
    // Clear in reverse FK order, then insert in FK order.
    for (const t of [...tables].reverse()) { await tx.delete(t.table).where(shopEq(t, shopId)); opts.progress?.(++done, total); }
    const shopRow = entries['data/shop.json'] ? (JSON.parse(strFromU8(entries['data/shop.json'])) as Record<string, unknown>) : null;
    if (shopRow) {
      const { primaryDomain: _pd, ...rest } = shopRow;
      void _pd;
      const known = getTableColumns(shops) as Record<string, { dataType: string }>;
      const set = Object.fromEntries(Object.entries(rest).filter(([k]) => k in known && k !== 'id').map(([k, v]) => [k, known[k]!.dataType === 'date' ? toDate(v) : v]));
      await tx.update(shops).set(set).where(eq(shops.id, shopId));
    }
    opts.progress?.(++done, total);
    for (const t of tables) {
      const rows = data(t.name);
      counts[t.name] = rows.length;
      const known = new Map(t.cols);
      const chunk = Math.max(1, Math.min(500, Math.floor(30000 / t.cols.length)));
      for (let i = 0; i < rows.length; i += chunk) {
        const batch = rows.slice(i, i + chunk).map((r) => Object.fromEntries([
          ...Object.entries(r).filter(([k]) => known.has(k)).map(([k, v]) => [k, v !== null && known.get(k)!.dataType === 'date' ? toDate(v) : v] as const),
          [t.shopCol, shopId] as const,
        ]));
        await tx.insert(t.table).values(batch);
      }
      if (known.has('id')) await tx.execute(sql`select setval(pg_get_serial_sequence(${`"${t.name}"`}, 'id'), greatest((select coalesce(max(id), 0) from ${t.table}), 1), (select count(*) > 0 from ${t.table}))`);
      opts.progress?.(++done, total);
    }
  });
  for (const k of uploads) await storage.put(k, Buffer.from(entries[`uploads/${k}`]!));
  opts.progress?.(total, total);
  return { ok: true, value: { tables: counts, files: uploads.length, manifest } };
}
