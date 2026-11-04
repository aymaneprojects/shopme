// Playwright smoke test against the real server (PGlite in a temp dir) serving the built admin.
//   pnpm --filter @shopme/admin build && pnpm --filter @shopme/admin e2e
//   pnpm --filter @shopme/admin screenshots     (also writes docs/assets/screenshots/admin-*.png using mocked catalog data)
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from '../../server/src/start';
import { mockCatalog } from './mock-catalog';

const require = createRequire(import.meta.url);
// Playwright is preinstalled globally in the dev container; browsers come from PLAYWRIGHT_BROWSERS_PATH.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE ?? 'playwright') as typeof import('playwright');

const here = path.dirname(fileURLToPath(import.meta.url));
const shots = path.resolve(here, '../../../docs/assets/screenshots');
const screenshots = process.argv.includes('--screenshots');

const dataDir = mkdtempSync(path.join(tmpdir(), 'shopme-e2e-'));
const server = await startServer({ port: 0, host: '127.0.0.1', dataDir, logger: false, env: { SESSION_SECRET: 's'.repeat(40), NODE_ENV: 'test', DATA_DIR: dataDir } });
const browser = await chromium.launch();
let failed = false;
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, locale: 'en-US', colorScheme: 'light' });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  if (screenshots) mkdirSync(shots, { recursive: true });

  // 1. First run: setup wizard.
  await page.goto(`${server.url}/admin/`);
  await page.getByRole('heading', { name: 'Set up your store' }).waitFor();
  if (screenshots) {
    await page.getByLabel('Store name').fill('Atelier Lumière');
    await page.getByLabel('First name').fill('Camille');
    await page.getByLabel('Last name').fill('Martin');
    await page.getByLabel('Email').fill('camille@example.com');
    await page.getByLabel('Password').fill('correct horse battery');
    await page.screenshot({ path: path.join(shots, 'admin-setup.png') });
  } else {
    await page.getByLabel('Store name').fill('Smoke Shop');
    await page.getByLabel('Email').fill('owner@example.com');
    await page.getByLabel('Password').fill('correct horse battery');
  }
  await page.getByRole('button', { name: 'Create store' }).click();

  // 2. Shell renders (owner is logged in by setup).
  await page.getByRole('navigation', { name: 'Main' }).waitFor();
  for (const item of ['Home', 'Orders', 'Products', 'Collections', 'Inventory', 'Customers', 'Discounts', 'Online Store', 'Settings']) {
    await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: item, exact: true }).waitFor();
  }

  // 3. Log out and back in.
  await page.getByRole('button', { name: 'Account menu' }).click();
  await page.getByRole('menuitem', { name: 'Log out' }).click();
  await page.getByRole('heading', { name: 'Log in' }).waitFor();
  await page.getByLabel('Email').fill(screenshots ? 'camille@example.com' : 'owner@example.com');
  await page.getByLabel('Password').fill('correct horse battery');
  await page.getByRole('button', { name: 'Log in' }).click();
  await page.getByRole('navigation', { name: 'Main' }).waitFor();

  // 4. French switch.
  await page.getByRole('button', { name: 'Account menu' }).click();
  await page.getByRole('menuitem', { name: /Français/ }).click();
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Produits' }).waitFor();
  await page.getByRole('button', { name: 'Menu du compte' }).click();
  await page.getByRole('menuitem', { name: /English/ }).click();

  if (screenshots) await mockCatalog(page);

  // 5. Products page: empty state (or an error banner while the server lacks the products API).
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Products', exact: true }).click();
  await page.getByRole('heading', { name: 'Products', level: 1 }).waitFor();
  if (screenshots) {
    await page.getByText('Ember Candle').waitFor();
    await page.screenshot({ path: path.join(shots, 'admin-products.png') });
    await page.getByText('Ember Candle').click();
    await page.getByLabel('Title', { exact: true }).waitFor();
    await page.getByRole('heading', { name: 'Ember Candle' }).waitFor();
    await page.screenshot({ path: path.join(shots, 'admin-product-editor.png'), fullPage: true });
  } else {
    const state = await Promise.race([
      page.getByText('Add your first product').waitFor().then(() => 'empty'),
      page.getByRole('alert').waitFor().then(() => 'api-error'),
    ]);
    console.log(`products page rendered (${state})`);
  }
  assert.deepEqual(errors, [], `uncaught page errors: ${errors.join('; ')}`);
  console.log('smoke ok');
} catch (e) {
  failed = true;
  console.error(e);
} finally {
  await browser.close();
  await server.close();
  rmSync(dataDir, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);
