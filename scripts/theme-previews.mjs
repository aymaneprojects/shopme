// Regenerates the home page previews of the bundled themes (Aurora and packages/themes/*).
//
//   pnpm build && node scripts/theme-previews.mjs [handle...] [--out <dir>]
//
// Seeds a demo store into a temporary DATA_DIR, boots the production server on a free port, then for each bundled theme in turn
// adds it to the theme library, publishes it and captures the storefront home page as WebP:
//   <out>/<handle>-desktop.webp   1440x900 (the top of the page, cropped)
//   <out>/<handle>-mobile.webp    390x844
// <out> defaults to packages/themes/previews, where the admin serves them from. THEMES_DIR and THEME_PREVIEWS_DIR (see
// apps/server/src/paths.ts) let the server look at another themes folder, e.g. to preview a theme that is not bundled yet.
//
// A theme that ships packages/themes/<handle>/demo/catalog.json (and demo/images/*.webp) is previewed on its own demo store: its
// products, collections, menus, pages, shop name and home page photos replace the coffee demo, so the preview looks like a real
// store of that theme's trade. Themes without a demo share the coffee demo store. The demo folder is never installed with a theme.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const themesDir = process.env.THEMES_DIR ? path.resolve(process.env.THEMES_DIR) : path.join(root, 'packages/themes');
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
// sharp (a dependency of the server) converts the PNG captures to WebP.
const sharp = createRequire(path.join(root, 'apps/server/package.json'))('sharp');

const args = process.argv.slice(2);
const outIndex = args.indexOf('--out');
const outDir = path.resolve(outIndex >= 0 ? (args.splice(outIndex, 2)[1] ?? '') : path.join(root, 'packages/themes/previews'));
const wanted = args;
const PASSWORD = 'previews-demo-pw';
const EMAIL = 'owner@example.com';
const SIZES = { desktop: { width: 1440, height: 900 }, mobile: { width: 390, height: 844 } };

const freePort = () =>
  new Promise((resolve, reject) => {
    const s = createServer();
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
    s.on('error', reject);
  });

/** The demo catalogue of a theme folder (null when it has none). */
const demoOf = (handle) => {
  const file = path.join(themesDir, handle, 'demo/catalog.json');
  return existsSync(file) ? { catalog: JSON.parse(readFileSync(file, 'utf8')), dir: path.join(themesDir, handle, 'demo') } : null;
};
const en = (v) => (v && typeof v === 'object' && 'en' in v ? v.en : v);

/**
 * Replaces the coffee demo of a freshly seeded store by a theme's demo catalogue: products with options, variants and photos,
 * collections, menus, pages and the shop name. Returns the uploaded home page photos (file name -> served path).
 */
async function seedDemoCatalog({ gql, put }, demo) {
  const { catalog, dir } = demo;
  const must = (label, payload) => {
    const errors = payload?.userErrors ?? [];
    if (errors.length) throw new Error(`${label}: ${errors.map((e) => `${(e.field ?? []).join('.')} ${e.message}`).join('; ')}`);
    return payload;
  };
  for (const p of (await gql('{ products(first: 100) { nodes { id } } }')).products.nodes) must('productDelete', (await gql('mutation($id: ID!) { productDelete(input: { id: $id }) { userErrors { field message } } }', { id: p.id })).productDelete);
  for (const c of (await gql('{ collections(first: 100) { nodes { id } } }')).collections.nodes) await gql('mutation($id: ID!) { collectionDelete(input: { id: $id }) { userErrors { field message } } }', { id: c.id }).catch(() => undefined);
  must('shop', (await gql('mutation($n: String!) { shopmeShopUpdate(input: { name: $n }) { userErrors { field message } } }', { n: catalog.storeName })).shopmeShopUpdate);

  const location = (await gql('{ locations(first: 1) { nodes { id } } }')).locations.nodes[0].id;
  const collectionIds = {};
  for (const c of catalog.collections ?? []) {
    const created = must(`collection ${c.handle}`, (await gql('mutation($c: CollectionInput!) { collectionCreate(input: $c) { collection { id } userErrors { field message } } }', { c: { title: en(c.title), handle: c.handle, descriptionHtml: `<p>${en(c.description ?? '')}</p>` } })).collectionCreate);
    collectionIds[c.handle] = created.collection.id;
  }
  const inCollections = (handle) => (catalog.collections ?? []).filter((c) => c.products.includes(handle)).map((c) => collectionIds[c.handle]);

  const uploaded = {};
  const upload = async (file) => {
    if (uploaded[file]) return uploaded[file];
    const bytes = readFileSync(path.join(dir, 'images', file));
    const target = (await gql('mutation($i: [StagedUploadInput!]!) { stagedUploadsCreate(input: $i) { stagedTargets { url resourceUrl } userErrors { message } } }', { i: [{ filename: file, mimeType: 'image/webp', httpMethod: 'PUT', resource: 'FILE', fileSize: String(bytes.length) }] })).stagedUploadsCreate.stagedTargets[0];
    await put(target.url, bytes, 'image/webp');
    uploaded[file] = target.resourceUrl;
    return target.resourceUrl;
  };

  for (const [index, p] of (catalog.products ?? []).entries()) {
    const names = p.options.map((o) => en(o.name));
    const values = p.options.map((o) => o.values.map(en));
    const combos = values.reduce((acc, list) => acc.flatMap((a) => list.map((v) => [...a, v])), [[]]);
    // the first option varies fastest
    const ordered = values.length > 1 ? values.slice().reverse().reduce((acc, list) => acc.flatMap((a) => list.map((v) => [v, ...a])), [[]]) : combos;
    const photo = await upload(p.image);
    const input = {
      title: en(p.title), handle: p.handle, descriptionHtml: `<p>${en(p.description)}</p>`, vendor: p.vendor, productType: en(p.type), tags: p.tags, status: 'ACTIVE', collections: inCollections(p.handle),
      files: [{ originalSource: photo, contentType: 'IMAGE', filename: p.image, alt: en(p.title) }],
      productOptions: p.options.length ? p.options.map((o) => ({ name: en(o.name), values: o.values.map((v) => ({ name: en(v) })) })) : [{ name: 'Title', values: [{ name: 'Default Title' }] }],
      variants: ordered.map((vals, i) => ({
        optionValues: p.options.length ? vals.map((name, n) => ({ optionName: names[n], name })) : [{ optionName: 'Title', name: 'Default Title' }],
        price: p.price.toFixed(2), ...(p.compareAt ? { compareAtPrice: p.compareAt.toFixed(2) } : {}), sku: `${p.handle.slice(0, 3).toUpperCase()}${index + 1}-${i + 1}`,
        inventoryItem: { tracked: true }, inventoryQuantities: [{ locationId: location, name: 'available', quantity: p.variants[i]?.stock ?? 10 }],
      })),
    };
    must(`product ${p.handle}`, (await gql('mutation($i: ProductSetInput!) { productSet(input: $i) { product { id } userErrors { field message } } }', { i: input })).productSet);
  }

  const menus = (await gql('{ menus(first: 20) { nodes { id handle title } } }')).menus.nodes;
  const items = (list) => list.map((m) => ({ title: en(m.title), type: 'HTTP', url: m.url, items: m.children ? items(m.children) : [] }));
  for (const [handle, list] of [['main-menu', catalog.menu], ['footer', catalog.footerMenu]]) {
    const menu = menus.find((m) => m.handle === handle);
    if (menu && list) must(`menu ${handle}`, (await gql('mutation($id: ID!, $t: String!, $items: [MenuItemUpdateInput!]!) { menuUpdate(id: $id, title: $t, items: $items) { userErrors { field message } } }', { id: menu.id, t: menu.title, items: items(list) })).menuUpdate);
  }
  for (const pg of catalog.pages ?? []) {
    await gql('mutation($p: PageCreateInput!) { pageCreate(page: $p) { userErrors { field message } } }', { p: { title: en(pg.title), handle: pg.handle, body: `<p>${en(pg.title)}</p>`, templateSuffix: pg.template, isPublished: true } }).catch(() => undefined);
  }
  // photos of the home page sections: "<section>" or "<section>.<block>" -> { setting: file }
  const photos = {};
  for (const [key, settings] of Object.entries(catalog.homepage?.images ?? {})) {
    for (const [setting, file] of Object.entries(settings)) {
      const resource = await upload(file);
      const file2 = (await gql('mutation($f: [FileCreateInput!]!) { fileCreate(files: $f) { files { id } userErrors { message } } }', { f: [{ originalSource: resource, contentType: 'IMAGE', filename: file, alt: '' }] })).fileCreate;
      must('file', file2);
      photos[`${key}\u0000${setting}`] = new URL(resource).pathname;
    }
  }
  return photos;
}

/** Writes the home page photos into the installed theme's templates/index.json. */
async function placeHomePhotos({ gql }, themeId, handle, photos) {
  if (!Object.keys(photos).length) return;
  const index = JSON.parse(readFileSync(path.join(themesDir, handle, 'templates/index.json'), 'utf8'));
  for (const [k, src] of Object.entries(photos)) {
    const [target, setting] = k.split('\u0000');
    const [sectionId, blockId] = target.split('.');
    const node = blockId ? index.sections[sectionId]?.blocks?.[blockId] : index.sections[sectionId];
    if (node) (node.settings ??= {})[setting] = src;
  }
  const r = (await gql('mutation($id: ID!, $f: [OnlineStoreThemeFilesUpsertFileInput!]!) { themeFilesUpsert(themeId: $id, files: $f) { userErrors { message } } }', { id: themeId, f: [{ filename: 'templates/index.json', body: { type: 'TEXT', value: `${JSON.stringify(index, null, 2)}\n` } }] })).themeFilesUpsert;
  if (r.userErrors.length) throw new Error(`${handle}: ${r.userErrors.map((e) => e.message).join('; ')}`);
}

/** Boots a fresh store (seeded with the coffee demo), previews the given themes on it, then stops it. */
async function runGroup(handles, demo) {
  const port = await freePort();
  const dataDir = mkdtempSync(path.join(tmpdir(), 'shopme-previews-'));
  const baseUrl = `http://127.0.0.1:${port}`;
  const env = { ...process.env, NODE_ENV: 'production', PORT: String(port), HOST: '127.0.0.1', APP_URL: baseUrl, DATA_DIR: dataDir, SESSION_SECRET: 'p'.repeat(40), LOG_LEVEL: 'warn', SEED_ADMIN_PASSWORD: PASSWORD };

  // Seed first: embedded PGlite is single-process, so the server starts afterwards.
  const seed = spawnSync('pnpm', ['--filter', '@shopme/core', 'seed'], { cwd: root, env: { ...env, INIT_CWD: root }, stdio: 'inherit' });
  if (seed.status !== 0) { rmSync(dataDir, { recursive: true, force: true }); throw new Error('seed failed'); }

  const server = spawn('node', ['apps/server/dist/main.js'], { cwd: root, env, stdio: ['ignore', 'inherit', 'inherit'] });
  let serverExited = false;
  server.on('exit', () => { serverExited = true; });
  let browser;
  try {
    for (let i = 0; ; i++) {
      if (serverExited) throw new Error('server exited during startup');
      try { if ((await fetch(`${baseUrl}/admin/`)).ok) break; } catch { /* not up yet */ }
      if (i > 150) throw new Error('server did not start in time');
      await new Promise((r) => setTimeout(r, 200));
    }

    const login = await fetch(`${baseUrl}/admin/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json', origin: baseUrl }, body: JSON.stringify({ email: EMAIL, password: PASSWORD }) });
    if (!login.ok) throw new Error(`admin login failed: ${login.status}`);
    const cookie = login.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
    const gql = async (query, variables) => {
      const res = await fetch(`${baseUrl}/admin/api/2026-10/graphql.json`, { method: 'POST', headers: { 'content-type': 'application/json', origin: baseUrl, cookie }, body: JSON.stringify({ query, variables }) });
      const json = await res.json();
      if (json.errors) throw new Error(JSON.stringify(json.errors));
      return json.data;
    };
    const put = async (url, body, type) => {
      const res = await fetch(url, { method: 'PUT', headers: { 'content-type': type, origin: baseUrl, cookie }, body });
      if (!res.ok) throw new Error(`upload failed: ${res.status} ${await res.text()}`);
    };

    let photos = {};
    if (demo) photos = await seedDemoCatalog({ gql, put }, demo);

    mkdirSync(outDir, { recursive: true });
    browser = await chromium.launch();
    for (const handle of handles) {
      const added = (await gql('mutation($h: String!) { shopmeThemeInstallBundled(handle: $h) { theme { id } userErrors { message } } }', { h: handle })).shopmeThemeInstallBundled;
      if (!added.theme) throw new Error(`${handle}: ${added.userErrors.map((e) => e.message).join('; ')}`);
      if (demo) await placeHomePhotos({ gql }, added.theme.id, handle, photos);
      const published = (await gql('mutation($id: ID!) { themePublish(id: $id) { theme { id } userErrors { message } } }', { id: added.theme.id })).themePublish;
      if (!published.theme) throw new Error(`${handle}: ${published.userErrors.map((e) => e.message).join('; ')}`);

      for (const [kind, viewport] of Object.entries(SIZES)) {
        const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1, locale: 'en-US', colorScheme: 'light' });
        const page = await ctx.newPage();
        await page.goto(baseUrl, { waitUntil: 'networkidle' });
        // A previewed home page has no cookie banner over it.
        await page.locator('[data-consent-accept]:visible').first().click({ timeout: 1500 }).catch(() => undefined);
        await page.addStyleTag({ content: '[data-consent-banner] { display: none !important; }' });
        // Lazy images and reveal-on-scroll sections only show once scrolled into view.
        await page.evaluate(async () => { for (let y = 0; y < document.body.scrollHeight; y += 400) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 60)); } window.scrollTo(0, 0); });
        await page.evaluate(() => Promise.all([...document.images].map((i) => (i.complete ? null : new Promise((r) => { i.onload = i.onerror = r; })))));
        await page.waitForTimeout(500);
        const png = await page.screenshot({ fullPage: true, clip: { x: 0, y: 0, ...viewport } });
        await ctx.close();
        const file = path.join(outDir, `${handle}-${kind}.webp`);
        writeFileSync(file, await sharp(png).webp({ quality: 82 }).toBuffer());
        console.log(`  wrote ${path.relative(root, file)}${demo ? ' (demo catalogue)' : ''}`);
      }
    }
  } finally {
    await browser?.close();
    server.kill('SIGTERM');
    await new Promise((r) => (serverExited ? r() : server.on('exit', r)));
    rmSync(dataDir, { recursive: true, force: true });
  }
}

let code = 0;
try {
  const all = ['aurora', ...readdirSync(themesDir).sort().filter((d) => d !== 'previews' && existsSync(path.join(themesDir, d, 'config/settings_schema.json')))];
  for (const h of wanted) if (!all.includes(h)) throw new Error(`unknown theme: ${h} (bundled: ${all.join(', ')})`);
  const todo = all.filter((h) => !wanted.length || wanted.includes(h));
  const own = todo.filter((h) => demoOf(h));
  const shared = todo.filter((h) => !demoOf(h));
  if (shared.length) await runGroup(shared, null);
  for (const h of own) await runGroup([h], demoOf(h));
  console.log('\nTheme previews written.');
} catch (err) {
  console.error('\nTheme previews FAILED:', err instanceof Error ? err.stack : err);
  code = 1;
}
process.exit(code);
