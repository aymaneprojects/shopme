// Checks the JavaScript features of the kit themes in a real browser: age check, infinite scroll, back to top, sticky header, low stock
// counter, countdown and the mobile menu. Boots a seeded store (after pnpm build) with Sillage published, then stops it.
//
//   PLAYWRIGHT_MODULE=/path/to/playwright node scripts/theme-kit/browser-check.mjs
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const port = await new Promise((r) => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => r(port)); }); });
const dataDir = mkdtempSync(path.join(tmpdir(), 'shopme-beh-'));
const base = `http://127.0.0.1:${port}`;
const env = { ...process.env, NODE_ENV: 'production', PORT: String(port), HOST: '127.0.0.1', APP_URL: base, DATA_DIR: dataDir, SESSION_SECRET: 'p'.repeat(40), LOG_LEVEL: 'warn', SEED_ADMIN_PASSWORD: 'previews-demo-pw' };
spawnSync('pnpm', ['--filter', '@shopme/core', 'seed'], { cwd: root, env: { ...env, INIT_CWD: root }, stdio: 'ignore' });
const server = spawn('node', ['apps/server/dist/main.js'], { cwd: root, env, stdio: 'ignore' });
const results = [];
const ok = (name, cond, extra = '') => { results.push(`${cond ? 'PASS' : 'FAIL'} ${name} ${extra}`); };
let browser;
try {
  for (let i = 0; i < 150; i++) { try { if ((await fetch(`${base}/admin/`)).ok) break; } catch { /* */ } await new Promise((r) => setTimeout(r, 200)); }
  const login = await fetch(`${base}/admin/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json', origin: base }, body: JSON.stringify({ email: 'owner@example.com', password: 'previews-demo-pw' }) });
  const cookie = login.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
  const gql = async (query, variables) => { const r = await fetch(`${base}/admin/api/2026-10/graphql.json`, { method: 'POST', headers: { 'content-type': 'application/json', origin: base, cookie }, body: JSON.stringify({ query, variables }) }); const j = await r.json(); if (j.errors) throw new Error(JSON.stringify(j.errors)); return j.data; };
  const theme = (await gql('mutation { shopmeThemeInstallBundled(handle: "sillage") { theme { id } } }')).shopmeThemeInstallBundled.theme.id;
  await gql('mutation($id: ID!) { themePublish(id: $id) { theme { id } } }', { id: theme });
  const file = async (name) => JSON.parse((await gql('query($id: ID!, $n: String!) { node(id: $id) { ... on OnlineStoreTheme { files(filenames: [$n], first: 1) { nodes { body { ... on OnlineStoreThemeFileBodyText { content } } } } } } }', { id: theme, n: name })).node.files.nodes[0].body.content);
  const put = (name, obj) => gql('mutation($id: ID!, $f: [OnlineStoreThemeFilesUpsertFileInput!]!) { themeFilesUpsert(themeId: $id, files: $f) { userErrors { message } } }', { id: theme, f: [{ filename: name, body: { type: 'TEXT', value: JSON.stringify(obj) } }] });
  const col = await file('templates/collection.json');
  col.sections.main.settings.products_per_page = 4; col.sections.main.settings.infinite_scroll = true;
  await put('templates/collection.json', col);
  const data = await file('config/settings_data.json');
  data.current.age_gate_enabled = true; data.current.stock_threshold = 30; data.current.age_gate_min_age = 18;
  await put('config/settings_data.json', data);

  browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  await page.goto(`${base}/collections/all`, { waitUntil: 'networkidle' });
  const gate = page.locator('[data-age-gate]');
  ok('age gate shows', await gate.isVisible());
  ok('age gate title', (await gate.textContent()).includes('18'));
  await page.locator('[data-age-no]').click();
  ok('age gate denies', await page.locator('[data-age-denied]').isVisible());
  await page.reload({ waitUntil: 'networkidle' });
  await page.locator('[data-age-yes]').click();
  ok('age gate hides on yes', !(await gate.isVisible()));
  await page.reload({ waitUntil: 'networkidle' });
  ok('age gate remembered', !(await gate.isVisible()));
  await page.locator('[data-consent-accept]:visible').first().click({ timeout: 1000 }).catch(() => undefined);
  const count = () => page.locator('[data-infinite] > li').count();
  ok('first page has 4 products', (await count()) >= 4, String(await count()));
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForFunction(() => document.querySelectorAll('[data-infinite] > li').length === 5, null, { timeout: 8000 }).catch(() => undefined);
  ok('infinite scroll loads the next page', (await count()) === 5, String(await count()));
  ok('top button visible after scroll', await page.locator('[data-back-to-top].is-visible').count() === 1);
  await page.locator('[data-back-to-top]').click();
  await page.waitForFunction(() => window.scrollY < 50, null, { timeout: 5000 }).catch(() => undefined);
  ok('back to top scrolls up', (await page.evaluate(() => window.scrollY)) < 50);
  await page.goto(`${base}/products/highland-morning-coffee-beans`, { waitUntil: 'networkidle' });
  ok('sticky header marked on scroll', await page.evaluate(async () => { window.scrollTo(0, 400); await new Promise((r) => setTimeout(r, 200)); return document.querySelector('[data-header]').classList.contains('is-stuck'); }));
  await page.evaluate(() => window.scrollTo(0, 0));
  const low = page.locator('[data-lowstock]');
  ok('stock counter hidden (40 left)', !(await low.isVisible()));
  await page.locator('label[for$="-2-2"]').first().click();
  ok('stock counter shows (25 left)', await low.isVisible(), await low.textContent());
  await page.locator('label[for$="-2-1"]').first().click();
  ok('stock counter hides again', !(await low.isVisible()));
  const dd = await page.locator('[data-main-image], [data-gallery-image]').count();
  ok('gallery rendered', dd > 0);
  await page.goto(`${base}/`, { waitUntil: 'networkidle' });
  const a = await page.locator('[data-cd="seconds"]').first().textContent();
  await page.waitForTimeout(2100);
  const b = await page.locator('[data-cd="seconds"]').first().textContent();
  ok('countdown ticks', a !== b, `${a} -> ${b}`);
  ok('countdown days is positive', Number(await page.locator('[data-cd="days"]').first().textContent()) > 0);
  // mobile menu drawer
  const m = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await m.addInitScript(() => localStorage.setItem('sillage-age-ok', '1'));
  const mp = await m.newPage();
  await mp.goto(`${base}/`, { waitUntil: 'networkidle' });
  await mp.locator('[data-nav-toggle]').click();
  ok('mobile drawer opens', await mp.locator('.k-drawer-nav').isVisible());
} catch (e) { results.push(`ERROR ${e.stack}`); } finally {
  await browser?.close();
  server.kill('SIGTERM');
  await new Promise((r) => setTimeout(r, 800));
  rmSync(dataDir, { recursive: true, force: true });
}
console.log(results.join('\n'));
process.exit(results.some((r) => !r.startsWith('PASS')) ? 1 : 0);
