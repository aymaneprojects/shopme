import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { strToU8, unzipSync, zipSync } from 'fflate';
import sharp from 'sharp';
import { loadSharp, parseResizeParams, transformImage } from './images';
import { createTestApp, setupAndLogin, type TestApp } from './test-utils';

/** Build a multipart/form-data body by hand (app.inject has no form helper). */
function multipart(parts: { name: string; value?: string; filename?: string; data?: Buffer; type?: string }[]) {
  const boundary = '----shopme-test-boundary';
  const chunks: Buffer[] = [];
  for (const p of parts) {
    chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${p.name}"${p.filename ? `; filename="${p.filename}"` : ''}\r\n${p.type ? `Content-Type: ${p.type}\r\n` : ''}\r\n`));
    chunks.push(p.data ?? Buffer.from(p.value ?? ''), Buffer.from('\r\n'));
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return { payload: Buffer.concat(chunks), headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } };
}

let t: TestApp; let cookie: string;
const auth = () => ({ cookies: { shopme_session: cookie } });
const gql = (query: string) => t.app.inject({ method: 'POST', url: '/admin/api/2026-10/graphql.json', payload: { query }, ...auth() });
beforeAll(async () => { t = await createTestApp(); cookie = await setupAndLogin(t.app); }, 60_000);
afterAll(async () => { await t.close(); });

describe('image params', () => {
  it('parses the reference params and ignores the rest', () => {
    expect(parseResizeParams({ width: '300', height: '200', crop: 'Center', format: 'WEBP', pad_color: '#FFF', v: '1' })).toEqual({ width: 300, height: 200, crop: 'center', format: 'webp', padColor: '#fff' });
    expect(parseResizeParams({ width: '99999' })).toEqual({ width: 5000, height: undefined });
    expect(parseResizeParams({ width: 'abc', crop: 'diagonal' })).toBeNull();
    expect(parseResizeParams({ v: '123' })).toBeNull();
    expect(parseResizeParams({ format: 'gif' })).toBeNull();
  });

  it('resizes, crops and pads', async () => {
    const png = await sharp({ create: { width: 400, height: 200, channels: 3, background: '#f00' } }).png().toBuffer();
    const size = async (p: Parameters<typeof transformImage>[2]) => { const r = (await transformImage(sharp, png, p, '.png'))!; const m = await sharp(r.data).metadata(); return [m.width, m.height, r.contentType]; };
    expect(await size({ width: 100 })).toEqual([100, 50, 'image/png']);
    expect(await size({ width: 100, height: 100 })).toEqual([100, 50, 'image/png']); // fit inside, no crop
    expect(await size({ width: 100, height: 100, crop: 'center' })).toEqual([100, 100, 'image/png']);
    expect(await size({ width: 100, height: 100, padColor: '#ffffff' })).toEqual([100, 100, 'image/png']);
    expect(await size({ width: 800 })).toEqual([400, 200, 'image/png']); // never enlarges
    expect(await size({ width: 50, format: 'webp' })).toEqual([50, 25, 'image/webp']);
    expect(await size({ width: 50, format: 'avif' })).toEqual([50, 25, 'image/avif']);
    expect(await size({ width: 50, format: 'jpg' })).toEqual([50, 25, 'image/jpeg']);
  });

  it('serves resized variants from /files with immutable caching and a disk cache', async () => {
    expect(await loadSharp()).not.toBeNull();
    const png = await sharp({ create: { width: 640, height: 480, channels: 3, background: '#0a0' } }).png().toBuffer();
    const up = await t.app.inject({ method: 'POST', url: '/admin/api/files', ...auth(), ...multipart([{ name: 'file', filename: 'pic.png', data: png, type: 'image/png' }]) });
    expect(up.statusCode).toBe(201);
    const url: string = up.json().file.url;

    const orig = await t.app.inject({ url });
    expect(orig.rawPayload.equals(png)).toBe(true);

    const r = await t.app.inject({ url: `${url}?width=160&height=160&crop=center&format=webp&v=1` });
    expect(r.statusCode).toBe(200);
    expect(r.headers['content-type']).toBe('image/webp');
    expect(r.headers['cache-control']).toContain('immutable');
    const meta = await sharp(r.rawPayload).metadata();
    expect([meta.width, meta.height, meta.format]).toEqual([160, 160, 'webp']);
    const cacheDir = path.join(t.dir, 'cache', 'images');
    expect(readdirSync(cacheDir)).toHaveLength(1);
    expect(existsSync(path.join(cacheDir, readdirSync(cacheDir)[0]!))).toBe(true);

    const again = await t.app.inject({ url: `${url}?width=160&height=160&crop=center&format=webp` });
    expect(again.rawPayload.equals(r.rawPayload)).toBe(true);
    expect(readdirSync(cacheDir)).toHaveLength(1);
    const cond = await t.app.inject({ url: `${url}?width=160&height=160&crop=center&format=webp`, headers: { 'if-none-match': String(r.headers['etag']) } });
    expect(cond.statusCode).toBe(304);

    const pad = await t.app.inject({ url: `${url}?width=200&height=200&pad_color=ffffff` });
    expect(pad.statusCode).toBe(200);
    expect((await sharp(pad.rawPayload).metadata()).height).toBe(200);
    // params that are not a resize leave the original untouched; unsafe keys never resolve
    expect((await t.app.inject({ url: `${url}?v=3` })).rawPayload.equals(png)).toBe(true);
    expect([403, 404]).toContain((await t.app.inject({ url: '/files/..%2F..%2Fetc%2Fpasswd?width=10' })).statusCode);
  });
});

const themeZip = (extra: Record<string, string> = {}, root = '') => Buffer.from(zipSync(Object.fromEntries(Object.entries({
  'layout/theme.liquid': '<html>{{ content_for_layout }}</html>', 'templates/index.json': '/* banner */ {"sections":{},"order":[]}', 'config/settings_schema.json': '[]',
  'assets/theme.css': 'body{color:red}', 'assets/logo.png': 'PNGDATA', 'notes/readme.md': 'ignored', '.git/config': 'ignored', ...extra,
}).map(([k, v]) => [root + k, strToU8(v)]))));

describe('theme zip upload and management', () => {
  const upload = (zip: Buffer, name?: string) => t.app.inject({ method: 'POST', url: '/admin/api/themes/upload', ...auth(), ...multipart([...(name ? [{ name: 'name', value: name }] : []), { name: 'file', filename: 'my-theme.zip', data: zip, type: 'application/zip' }]) });
  let themeId: number;

  it('creates an unpublished theme from a zip (wrapping folder stripped, junk ignored, binaries stored)', async () => {
    const r = await upload(themeZip({}, 'my-theme-main/'), 'Dawn copy');
    expect(r.statusCode).toBe(201);
    const body = r.json();
    expect(body.theme).toMatchObject({ name: 'Dawn copy', role: 'UNPUBLISHED' });
    expect(body.files).toBe(5);
    expect(body.ignored).toEqual(expect.arrayContaining(['notes/readme.md']));
    themeId = body.theme.id;

    const files = await gql(`{ theme(id: "gid://shopify/OnlineStoreTheme/${themeId}") { name role files(first: 20) { nodes { filename } } } }`);
    expect(files.json().data.theme.files.nodes.map((f: { filename: string }) => f.filename).sort()).toEqual(['assets/logo.png', 'assets/theme.css', 'config/settings_schema.json', 'layout/theme.liquid', 'templates/index.json']);
    const asset = await t.app.inject({ url: `/cdn/shop/t/${themeId}/assets/logo.png` });
    expect(asset.statusCode).toBe(200);
    expect(asset.headers['content-type']).toBe('image/png');
    expect(asset.body).toBe('PNGDATA');
    expect((await t.app.inject({ url: `/cdn/shop/t/${themeId}/assets/theme.css` })).body).toBe('body{color:red}');
  });

  it('rejects archives that are not themes', async () => {
    const noLayout = await upload(Buffer.from(zipSync({ 'templates/index.liquid': strToU8('x') })));
    expect(noLayout.statusCode).toBe(422);
    expect(noLayout.json().errors[0].message).toMatch(/layout\/theme\.liquid/);
    expect((await upload(Buffer.from('definitely not a zip'))).statusCode).toBe(422);
    expect((await upload(themeZip({ 'config/bad.json': '{nope' }))).statusCode).toBe(422);
    expect((await t.app.inject({ method: 'POST', url: '/admin/api/themes/upload', ...multipart([{ name: 'x', value: 'y' }]) })).statusCode).toBe(401);
  });

  it('downloads a theme as a zip that round-trips', async () => {
    const r = await t.app.inject({ url: `/admin/api/themes/${themeId}/download.zip`, ...auth() });
    expect(r.statusCode).toBe(200);
    expect(r.headers['content-type']).toBe('application/zip');
    const files = unzipSync(new Uint8Array(r.rawPayload));
    expect(Object.keys(files).sort()).toEqual(['assets/logo.png', 'assets/theme.css', 'config/settings_schema.json', 'layout/theme.liquid', 'templates/index.json']);
    expect(Buffer.from(files['assets/logo.png']!).toString()).toBe('PNGDATA');
    expect((await t.app.inject({ url: '/admin/api/themes/999999/download.zip', ...auth() })).statusCode).toBe(404);
  });

  it('themeDuplicate, themeUpdate, themeFilesCopy, themeFilesDelete and themeDelete', async () => {
    const gid = `gid://shopify/OnlineStoreTheme/${themeId}`;
    const dup = (await gql(`mutation { themeDuplicate(id: "${gid}", name: "Second") { newTheme { id name role } userErrors { message } } }`)).json().data.themeDuplicate;
    expect(dup.userErrors).toEqual([]);
    expect(dup.newTheme).toMatchObject({ name: 'Second', role: 'UNPUBLISHED' });
    const dupGid: string = dup.newTheme.id;

    const upd = (await gql(`mutation { themeUpdate(id: "${dupGid}", input: { name: "Renamed" }) { theme { name } userErrors { message } } }`)).json().data.themeUpdate;
    expect(upd.theme.name).toBe('Renamed');
    expect((await gql(`mutation { themeUpdate(id: "${dupGid}", input: { name: " " }) { theme { name } userErrors { message code } } }`)).json().data.themeUpdate.userErrors[0].code).toBe('BLANK');

    const copy = (await gql(`mutation { themeFilesCopy(themeId: "${dupGid}", files: [{ srcFilename: "assets/theme.css", dstFilename: "assets/theme-copy.css" }]) { copiedThemeFiles { filename } userErrors { message } } }`)).json().data.themeFilesCopy;
    expect(copy.copiedThemeFiles).toEqual([{ filename: 'assets/theme-copy.css' }]);
    expect((await t.app.inject({ url: `/cdn/shop/t/${dupGid.split('/').pop()}/assets/theme-copy.css` })).body).toBe('body{color:red}');
    const badCopy = (await gql(`mutation { themeFilesCopy(themeId: "${dupGid}", files: [{ srcFilename: "assets/nope.css", dstFilename: "assets/x.css" }]) { userErrors { message code } } }`)).json().data.themeFilesCopy;
    expect(badCopy.userErrors[0].code).toBe('NOT_FOUND');

    const del = (await gql(`mutation { themeFilesDelete(themeId: "${dupGid}", files: ["assets/theme-copy.css", "assets/logo.png"]) { deletedThemeFiles { filename } userErrors { message } } }`)).json().data.themeFilesDelete;
    expect(del.deletedThemeFiles.map((f: { filename: string }) => f.filename).sort()).toEqual(['assets/logo.png', 'assets/theme-copy.css']);
    expect((await gql(`mutation { themeFilesDelete(themeId: "${dupGid}", files: ["layout/theme.liquid"]) { userErrors { message } } }`)).json().data.themeFilesDelete.userErrors).toHaveLength(1);
    // the original still serves its binary after the duplicate dropped its reference
    expect((await t.app.inject({ url: `/cdn/shop/t/${themeId}/assets/logo.png` })).body).toBe('PNGDATA');

    expect((await gql(`mutation { themeDelete(id: "${dupGid}") { deletedThemeId userErrors { message } } }`)).json().data.themeDelete.deletedThemeId).toBe(dupGid);
    expect((await gql(`mutation { themeDelete(id: "${gid}") { deletedThemeId } }`)).json().data.themeDelete.deletedThemeId).toBe(gid);
    expect((await t.app.inject({ url: `/cdn/shop/t/${themeId}/assets/logo.png` })).statusCode).toBe(404);

    const main = (await gql('{ themes(first: 5, roles: [MAIN]) { nodes { id } } }')).json().data.themes.nodes[0].id;
    const blocked = (await gql(`mutation { themeDelete(id: "${main}") { deletedThemeId userErrors { code } } }`)).json().data.themeDelete;
    expect(blocked).toEqual({ deletedThemeId: null, userErrors: [{ code: 'CANNOT_DELETE_MAIN_THEME' }] });
  });

  it('themeCreate refuses unreachable and private sources', async () => {
    const r = (await gql('mutation { themeCreate(source: "http://127.0.0.1:1/theme.zip", name: "X") { theme { id } userErrors { message code } } }')).json().data.themeCreate;
    expect(r.theme).toBeNull();
    expect(r.userErrors[0].code).toBe('THEME_CREATE_FAILED');
    expect((await gql('mutation { themeCreate(source: "ftp://x/y.zip") { userErrors { code } } }')).json().data.themeCreate.userErrors[0].code).toBe('INVALID');
  });
});

describe('CSV import/export and job REST API', () => {
  const importCsv = (kind: string, csv: string, query = '') => t.app.inject({ method: 'POST', url: `/admin/api/import/${kind}${query}`, ...auth(), ...multipart([{ name: 'file', filename: 'x.csv', data: Buffer.from(csv), type: 'text/csv' }]) });
  const finished = async (id: number) => {
    for (let i = 0; i < 100; i++) {
      const j = (await t.app.inject({ url: `/admin/api/jobs/${id}`, ...auth() })).json().job;
      if (j.done) return j;
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error('job did not finish');
  };
  const csv = 'Handle,Title,Variant SKU,Variant Price,Variant Inventory Qty\r\nwidget,Widget,W-1,9.99,4\r\nbroken,,B-1,abc,';

  it('dry run previews errors per row and writes nothing; the real run imports and exports', async () => {
    const dry = await importCsv('products', csv, '?dryRun=1');
    expect(dry.statusCode).toBe(202);
    const dj = await finished(dry.json().job.id);
    expect(dj).toMatchObject({ status: 'COMPLETED', done: true, result: { dryRun: true, counts: { created: 1, failed: 1 } } });
    expect(dj.result.errors.map((e: { row: number }) => e.row)).toContain(3);
    expect((await gql('{ productsCount { count } }')).json().data.productsCount.count).toBe(0);

    const real = await importCsv('products', csv);
    const rj = await finished(real.json().job.id);
    expect(rj.result.counts).toMatchObject({ created: 1, failed: 1 });
    expect((await gql('{ productByHandle(handle: "widget") { title variants(first: 5) { nodes { sku price inventoryQuantity } } } }')).json().data.productByHandle).toEqual({ title: 'Widget', variants: { nodes: [{ sku: 'W-1', price: '9.99', inventoryQuantity: 4 }] } });

    const exp = await t.app.inject({ url: '/admin/api/export/products.csv', ...auth() });
    expect(exp.headers['content-type']).toContain('text/csv');
    expect(exp.headers['content-disposition']).toContain('products.csv');
    expect(exp.body.split('\r\n')[1]).toContain('widget,Widget');
    const none = await t.app.inject({ url: '/admin/api/export/products.csv?ids=987654', ...auth() });
    expect(none.body.trim().split('\r\n')).toHaveLength(1);
    for (const k of ['customers', 'inventory', 'orders']) expect((await t.app.inject({ url: `/admin/api/export/${k}.csv`, ...auth() })).statusCode).toBe(200);
    expect((await t.app.inject({ url: '/admin/api/export/secrets.csv', ...auth() })).statusCode).toBe(404);
  });

  it('imports customers and inventory, and requires authentication and a file', async () => {
    const c = await finished((await importCsv('customers', 'First Name,Email\r\nAda,ada@example.com')).json().job.id);
    expect(c.result.counts.created).toBe(1);
    const i = await finished((await importCsv('inventory', 'SKU,Available\r\nW-1,20')).json().job.id);
    expect(i.result.counts.updated).toBe(1);
    expect((await t.app.inject({ method: 'POST', url: '/admin/api/import/products', ...multipart([{ name: 'file', filename: 'x.csv', data: Buffer.from(csv) }]) })).statusCode).toBe(401);
    expect((await t.app.inject({ method: 'POST', url: '/admin/api/import/orders', ...auth(), ...multipart([{ name: 'file', filename: 'x.csv', data: Buffer.from(csv) }]) })).statusCode).toBe(404);
    expect((await t.app.inject({ method: 'POST', url: '/admin/api/import/products', ...auth(), ...multipart([{ name: 'other', value: 'x' }]) })).statusCode).toBe(400);
    expect((await t.app.inject({ url: '/admin/api/jobs/99999', ...auth() })).statusCode).toBe(404);
    expect((await t.app.inject({ url: '/admin/api/jobs/1' })).statusCode).toBe(401);
  });

  it('validates the Shopify migration request', async () => {
    const post = (payload: unknown) => t.app.inject({ method: 'POST', url: '/admin/api/migrate/shopify', payload: payload as object, ...auth() });
    expect((await post({})).statusCode).toBe(400);
    expect((await post({ shop: 'x' })).statusCode).toBe(400);
    expect((await post({ shop: 'x', accessToken: 't', only: ['nope'] })).statusCode).toBe(400);
  });
});
