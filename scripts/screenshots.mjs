// Regenerates the README screenshots from a fresh demo store.   pnpm build && pnpm screenshots
// Seeds the demo data into a temporary DATA_DIR, boots the production server on a free port and captures the pages with Playwright.
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'docs/assets/screenshots');
const PASSWORD = 'screenshots-demo-pw';
const EMAIL = 'owner@example.com';

const freePort = () =>
  new Promise((resolve, reject) => {
    const s = createServer();
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
    s.on('error', reject);
  });

const port = await freePort();
const dataDir = mkdtempSync(path.join(tmpdir(), 'shopme-shots-'));
const baseUrl = `http://127.0.0.1:${port}`;
const env = { ...process.env, NODE_ENV: 'production', PORT: String(port), HOST: '127.0.0.1', APP_URL: baseUrl, DATA_DIR: dataDir, SESSION_SECRET: 's'.repeat(40), LOG_LEVEL: 'warn', SEED_ADMIN_PASSWORD: PASSWORD };

// Seed first: embedded PGlite is single-process, so the server starts afterwards.
const seed = spawnSync('pnpm', ['--filter', '@shopme/core', 'seed'], { cwd: root, env: { ...env, INIT_CWD: root }, stdio: 'inherit' });
if (seed.status !== 0) {
  rmSync(dataDir, { recursive: true, force: true });
  process.exit(seed.status ?? 1);
}

const server = spawn('node', ['apps/server/dist/main.js'], { cwd: root, env, stdio: ['ignore', 'inherit', 'inherit'] });
let serverExited = false;
server.on('exit', () => { serverExited = true; });

let code = 0;
let browser;
try {
  for (let i = 0; ; i++) {
    if (serverExited) throw new Error('server exited during startup');
    try { if ((await fetch(`${baseUrl}/admin/`)).ok) break; } catch { /* not up yet */ }
    if (i > 150) throw new Error('server did not start in time');
    await new Promise((r) => setTimeout(r, 200));
  }
  mkdirSync(outDir, { recursive: true });
  browser = await chromium.launch();

  /** Wait until every <img> on the page has loaded (or failed). */
  const imagesReady = (page) => page.evaluate(() => Promise.all([...document.images].map((i) => (i.complete ? null : new Promise((r) => { i.onload = i.onerror = r; })))));
  const shot = async (page, name, opts = {}) => {
    await imagesReady(page);
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(outDir, name), ...opts });
    console.log(`  wrote docs/assets/screenshots/${name}`);
  };

  // Storefront: full-page captures cropped to the established sizes.
  for (const [name, viewport, height, url] of [
    ['storefront-desktop.png', { width: 1440, height: 900 }, 2414, '/'],
    ['storefront-mobile.png', { width: 390, height: 844 }, 3107, '/'],
    ['storefront-product.png', { width: 1440, height: 900 }, null, '/products/highland-morning-coffee-beans'],
    ['storefront-collection.png', { width: 1440, height: 900 }, null, '/collections/coffee'],
  ]) {
    const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1, locale: 'en-US', colorScheme: 'light' });
    const page = await ctx.newPage();
    await page.goto(baseUrl + url, { waitUntil: 'networkidle' });
    // Lazy images only load once scrolled into view.
    await page.evaluate(async () => { for (let y = 0; y < document.body.scrollHeight; y += 500) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 60)); } window.scrollTo(0, 0); });
    await shot(page, name, height ? { fullPage: true, clip: { x: 0, y: 0, width: viewport.width, height } } : { fullPage: true });
    await ctx.close();
  }

  // Admin (dark theme, 1280x800).
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, locale: 'en-US', colorScheme: 'dark' });
  const login = await ctx.request.post(`${baseUrl}/admin/api/auth/login`, { data: { email: EMAIL, password: PASSWORD } });
  if (!login.ok()) throw new Error(`admin login failed: ${login.status()}`);
  const page = await ctx.newPage();
  await page.goto(`${baseUrl}/admin/products`, { waitUntil: 'networkidle' });
  await page.getByText('Highland Morning Coffee Beans').first().waitFor();
  await shot(page, 'admin-products.png');
  await page.getByText('Highland Morning Coffee Beans').first().click();
  await page.getByLabel('Title', { exact: true }).waitFor();
  await page.waitForLoadState('networkidle');
  await shot(page, 'admin-product-editor.png');
  await ctx.close();
  console.log('\nScreenshots written.');
} catch (err) {
  console.error('\nScreenshots FAILED:', err instanceof Error ? err.stack : err);
  code = 1;
} finally {
  await browser?.close();
  server.kill('SIGTERM');
  await new Promise((r) => (serverExited ? r() : server.on('exit', r)));
  rmSync(dataDir, { recursive: true, force: true });
}
process.exit(code);
