import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, createLocalStorage, runMigrations, schema as s, setupStore, type DbHandle } from '../../index';
import { csvLine, parseCsv, parseCsvObjects } from '../csv';
import { JobReporter, createJob, getJob } from '../jobs';
import { exportCustomers, exportInventory, exportOrders, exportProducts, importCustomers, importInventory, importProducts, type CsvRow, type ImageFetcher, type ImportEnv } from './index';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const fetchImage: ImageFetcher = async (url) => (url.includes('broken') ? null : { data: PNG, mimeType: 'image/png' });

async function* chunks(text: string, size = 7) { for (let i = 0; i < text.length; i += size) yield text.slice(i, i + size); }
async function all<T>(g: AsyncIterable<T>): Promise<T[]> { const out: T[] = []; for await (const x of g) out.push(x); return out; }
const text = async (g: AsyncIterable<string>) => (await all(g)).join('');

async function store(name: string) {
  const handle = await createDb({ memory: true });
  await runMigrations(handle);
  const { shop } = await setupStore(handle.db, { shopName: name, email: 'o@example.com', password: 'correct horse', currency: 'USD', country: 'US', locale: 'en' });
  const env = (dryRun = false): ImportEnv => ({ db: handle.db, shopId: shop.id, storage: createLocalStorage(mkdtempSync(path.join(tmpdir(), 'ie-'))), dryRun, fetchImage });
  return { handle, shopId: shop.id, env };
}

/** Run an importer over CSV text and collect what the reporter saw. */
async function run(fn: (env: ImportEnv, rows: AsyncIterable<CsvRow>, rep: never) => Promise<void>, env: ImportEnv, csv: string) {
  const counts = { created: 0, updated: 0, skipped: 0, failed: 0 };
  const errors: { row?: number; message: string }[] = [];
  const rep = { count: (k: keyof typeof counts, n = 1) => { counts[k] += n; }, error: (message: string, row?: number) => { errors.push({ row, message }); }, progress: async () => {} };
  await fn(env, parseCsvObjects(chunks(csv)), rep as never);
  return { counts, errors };
}

describe('csv', () => {
  it('parses quotes, escaped quotes, embedded newlines, CRLF split across chunks and a BOM', async () => {
    const src = '﻿a,b,c\r\n1,"x, ""y""",3\r\n"multi\nline",,\r\n\r\nlast,row,here';
    expect(await all(parseCsv(chunks(src, 1)))).toEqual([['a', 'b', 'c'], ['1', 'x, "y"', '3'], ['multi\nline', '', ''], ['last', 'row', 'here']]);
  });
  it('serializes what it parses', async () => {
    const row = ['plain', 'with,comma', 'with "quote"', 'two\nlines', '', ' padded '];
    expect(await all(parseCsv([csvLine(row)]))).toEqual([row]);
  });
});

describe('product CSV', () => {
  let a: Awaited<ReturnType<typeof store>>;
  beforeAll(async () => { a = await store('A'); }, 60_000);
  afterAll(async () => { await a.handle.close(); });

  const csv = [
    'Handle,Title,Body (HTML),Vendor,Type,Tags,Published,Option1 Name,Option1 Value,Option2 Name,Option2 Value,Variant SKU,Variant Grams,Variant Inventory Qty,Variant Inventory Policy,Variant Price,Variant Compare At Price,Variant Requires Shipping,Variant Taxable,Image Src,Image Position,Image Alt Text,SEO Title,Variant Image,Cost per item,Status',
    'tee,Tee,"<p>Soft, ""cotton""</p>",Acme,Shirts,"b, a",true,Size,S,Color,Red,TEE-S-R,200,5,deny,19.90,24.00,true,true,https://img.example/tee-1.png,1,Front,Tee SEO,https://img.example/tee-1.png,7.50,active',
    'tee,,,,,,,,M,,Red,TEE-M-R,200,3,deny,19.90,,true,true,https://img.example/tee-2.png,2,Back,,,7.50,',
    'mug,Mug,,Acme,Home,,false,Title,Default Title,,,MUG-1,350,12,continue,8.00,,true,false,,,,,,,draft',
  ].join('\r\n');

  it('dry run reports row errors without writing', async () => {
    const bad = `${csv}\r\nbad,,,,,,,,,,,B-1,,x,,abc,,,,https://img.example/bad.png,,,,,,`;
    const r = await run(importProducts, a.env(true), bad);
    expect(r.counts).toMatchObject({ created: 2, failed: 1 });
    expect(r.errors.map((e) => e.message).join('|')).toMatch(/Title is required.*|Variant Price "abc" is not a number/s);
    expect(r.errors.find((e) => e.message.includes('abc'))!.row).toBe(5);
    expect((await a.handle.db.select().from(s.products)).length).toBe(0);
  }, 30_000);

  it('imports, then re-imports idempotently (upsert by handle and option values)', async () => {
    const first = await run(importProducts, a.env(), csv);
    expect(first.errors).toEqual([]);
    expect(first.counts).toMatchObject({ created: 2, failed: 0 });
    const count = async () => ({ products: (await a.handle.db.select().from(s.products)).length, variants: (await a.handle.db.select().from(s.productVariants)).length, media: (await a.handle.db.select().from(s.productMedia)).length });
    expect(await count()).toEqual({ products: 2, variants: 3, media: 2 });
    const [tee] = await a.handle.db.select().from(s.products).where((await import('drizzle-orm')).eq(s.products.handle, 'tee'));
    expect(tee).toMatchObject({ title: 'Tee', vendor: 'Acme', tags: ['a', 'b'], status: 'ACTIVE', seoTitle: 'Tee SEO', descriptionHtml: '<p>Soft, "cotton"</p>' });
    const again = await run(importProducts, a.env(), csv);
    expect(again.counts).toMatchObject({ updated: 2, created: 0, failed: 0 });
    expect(await count()).toEqual({ products: 2, variants: 3, media: 2 });
  }, 30_000);

  it('exports the Shopify columns and survives a round trip into a fresh store', async () => {
    const out = await text(exportProducts(a.handle.db, a.shopId, 'https://shop.test'));
    const rows = await all(parseCsvObjects([out]));
    expect(Object.keys(rows[0]!.row)).toEqual(expect.arrayContaining(['Handle', 'Title', 'Body (HTML)', 'Vendor', 'Product Category', 'Type', 'Tags', 'Published', 'Option1 Name', 'Option1 Value', 'Variant SKU', 'Variant Grams', 'Variant Inventory Qty', 'Variant Inventory Policy', 'Variant Price', 'Variant Compare At Price', 'Variant Requires Shipping', 'Variant Taxable', 'Variant Barcode', 'Image Src', 'Image Position', 'Image Alt Text', 'SEO Title', 'SEO Description', 'Variant Image', 'Variant Weight Unit', 'Cost per item', 'Status']));
    expect(rows.map((r) => r.row['Variant SKU'])).toEqual(['TEE-S-R', 'TEE-M-R', 'MUG-1']);
    expect(rows[0]!.row).toMatchObject({ 'Variant Price': '19.90', 'Variant Compare At Price': '24.00', 'Variant Grams': '200', 'Variant Inventory Qty': '5', 'Cost per item': '7.50', Published: 'true' });
    expect(rows[0]!.row['Image Src']).toMatch(/^https:\/\/shop\.test\/files\//);
    expect(rows[2]!.row).toMatchObject({ Published: 'false', Status: 'draft', 'Variant Inventory Policy': 'continue', 'Variant Taxable': 'false' });

    const b = await store('B');
    const imported = await run(importProducts, b.env(), out);
    expect(imported.errors).toEqual([]);
    expect(imported.counts.created).toBe(2);
    const strip = (t: string) => t.replace(/https:\/\/shop\.test\/files\/[^,"\r\n]+/g, 'IMG').replace(/https:\/\/shop2\.test\/files\/[^,"\r\n]+/g, 'IMG');
    expect(strip(await text(exportProducts(b.handle.db, b.shopId, 'https://shop2.test')))).toBe(strip(out));
    await b.handle.close();
  }, 30_000);

  it('keeps going when an image cannot be downloaded', async () => {
    const r = await run(importProducts, a.env(), 'Handle,Title,Variant Price,Image Src\r\nlamp,Lamp,3.00,https://img.example/broken.png');
    expect(r.counts.created).toBe(1);
    expect(r.errors[0]!.message).toMatch(/Image could not be downloaded/);
  }, 30_000);

  it('exports orders as CSV (header only when there are none)', async () => {
    expect((await text(exportOrders(a.handle.db, a.shopId))).split('\r\n')[0]).toContain('Lineitem quantity');
  });
});

describe('customer and inventory CSV', () => {
  let a: Awaited<ReturnType<typeof store>>;
  beforeAll(async () => {
    a = await store('C');
    await run(importProducts, a.env(), 'Handle,Title,Variant SKU,Variant Price\r\nhat,Hat,HAT-1,5.00');
  }, 60_000);
  afterAll(async () => { await a.handle.close(); });

  it('upserts customers by email and exports the default address', async () => {
    const csv = 'First Name,Last Name,Email,Accepts Email Marketing,Default Address Address1,Default Address City,Default Address Country Code,Default Address Zip,Phone,Tags,Note,Tax Exempt\r\n'
      + 'Ada,Lovelace,ADA@example.com,yes,1 Main St,London,GB,N1 9GU,+442071234567,"vip, new",hello,no\r\n'
      + 'Bad,Email,not-an-email,,,,,,,,,';
    const r = await run(importCustomers, a.env(), csv);
    expect(r.counts).toMatchObject({ created: 1, failed: 1 });
    const again = await run(importCustomers, a.env(), csv.replace('hello', 'updated note'));
    expect(again.counts.updated).toBe(1);
    const [c] = await a.handle.db.select().from(s.customers);
    expect(c).toMatchObject({ email: 'ada@example.com', acceptsMarketing: true, note: 'updated note', tags: ['new', 'vip'] });
    const rows = await all(parseCsvObjects([await text(exportCustomers(a.handle.db, a.shopId))]));
    expect(rows[0]!.row).toMatchObject({ Email: 'ada@example.com', 'Accepts Email Marketing': 'yes', 'Default Address City': 'London', 'Default Address Country Code': 'GB', Tags: 'new, vip' });
  }, 30_000);

  it('sets stock by SKU or handle and reports unknown SKUs and locations', async () => {
    const r = await run(importInventory, a.env(), 'SKU,Location,Available\r\nHAT-1,Shop location,14\r\nNOPE,,1\r\nHAT-1,Mars,2');
    expect(r.counts).toMatchObject({ updated: 1, failed: 2 });
    const out = await all(parseCsvObjects([await text(exportInventory(a.handle.db, a.shopId))]));
    expect(out[0]!.row).toMatchObject({ Handle: 'hat', SKU: 'HAT-1', Location: 'Shop location', Available: '14', 'On hand': '14' });
  }, 30_000);
});

describe('job reporter', () => {
  it('persists progress, capped errors and completion', async () => {
    const a = await store('J');
    const id = await createJob(a.handle.db, a.shopId, 'import.products', true);
    const rep = new JobReporter(a.handle.db, id, true);
    for (let i = 0; i < 250; i++) rep.error(`e${i}`, i);
    rep.count('created', 3);
    await rep.progress(250, 250, 'products');
    await rep.flush();
    await rep.finish();
    const job = await getJob(a.handle.db, a.shopId, id);
    expect(job).toMatchObject({ status: 'COMPLETED', done: true });
    expect((job!.result as { errors: unknown[]; errorCount: number; counts: { created: number } })).toMatchObject({ errorCount: 250, counts: { created: 3 } });
    expect((job!.result as { errors: unknown[] }).errors).toHaveLength(200);
    await a.handle.close();
  }, 30_000);
});
