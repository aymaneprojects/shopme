// Regenerates the home page previews of the bundled themes (Aurora and packages/themes/*).
//
//   pnpm build && node scripts/theme-previews.mjs [handle...] [--out <dir>]
//
// Seeds the demo data into a temporary DATA_DIR, boots the production server on a free port, then for each bundled theme
// in turn adds it to the theme library, publishes it and captures the storefront home page as WebP:
//   <out>/<handle>-desktop.webp   1440x900 (the top of the page, cropped)
//   <out>/<handle>-mobile.webp    390x844
// <out> defaults to packages/themes/previews, where the admin serves them from. THEMES_DIR and THEME_PREVIEWS_DIR (see
// apps/server/src/paths.ts) let the server look at another themes folder, e.g. to preview a theme that is not bundled yet.
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
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

const port = await freePort();
const dataDir = mkdtempSync(path.join(tmpdir(), 'shopme-previews-'));
const baseUrl = `http://127.0.0.1:${port}`;
const env = { ...process.env, NODE_ENV: 'production', PORT: String(port), HOST: '127.0.0.1', APP_URL: baseUrl, DATA_DIR: dataDir, SESSION_SECRET: 'p'.repeat(40), LOG_LEVEL: 'warn', SEED_ADMIN_PASSWORD: PASSWORD };

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

  const login = await fetch(`${baseUrl}/admin/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json', origin: baseUrl }, body: JSON.stringify({ email: EMAIL, password: PASSWORD }) });
  if (!login.ok) throw new Error(`admin login failed: ${login.status}`);
  const cookie = login.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
  const gql = async (query, variables) => {
    const res = await fetch(`${baseUrl}/admin/api/2026-10/graphql.json`, { method: 'POST', headers: { 'content-type': 'application/json', origin: baseUrl, cookie }, body: JSON.stringify({ query, variables }) });
    const json = await res.json();
    if (json.errors) throw new Error(JSON.stringify(json.errors));
    return json.data;
  };

  const all = (await gql('{ shopmeBundledThemes { handle name } }')).shopmeBundledThemes;
  for (const h of wanted) if (!all.some((t) => t.handle === h)) throw new Error(`unknown theme: ${h} (bundled: ${all.map((t) => t.handle).join(', ')})`);
  const todo = all.filter((t) => !wanted.length || wanted.includes(t.handle));
  mkdirSync(outDir, { recursive: true });
  browser = await chromium.launch();

  for (const theme of todo) {
    const added = (await gql('mutation($h: String!) { shopmeThemeInstallBundled(handle: $h) { theme { id } userErrors { message } } }', { h: theme.handle })).shopmeThemeInstallBundled;
    if (!added.theme) throw new Error(`${theme.handle}: ${added.userErrors.map((e) => e.message).join('; ')}`);
    const published = (await gql('mutation($id: ID!) { themePublish(id: $id) { theme { id } userErrors { message } } }', { id: added.theme.id })).themePublish;
    if (!published.theme) throw new Error(`${theme.handle}: ${published.userErrors.map((e) => e.message).join('; ')}`);

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
      const file = path.join(outDir, `${theme.handle}-${kind}.webp`);
      writeFileSync(file, await sharp(png).webp({ quality: 82 }).toBuffer());
      console.log(`  wrote ${path.relative(root, file)}`);
    }
  }
  console.log('\nTheme previews written.');
} catch (err) {
  console.error('\nTheme previews FAILED:', err instanceof Error ? err.stack : err);
  code = 1;
} finally {
  await browser?.close();
  server.kill('SIGTERM');
  await new Promise((r) => (serverExited ? r() : server.on('exit', r)));
  rmSync(dataDir, { recursive: true, force: true });
}
process.exit(code);
