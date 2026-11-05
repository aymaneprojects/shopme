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
const shots = process.env.SHOTS_DIR ?? path.resolve(here, '../../../docs/assets/screenshots');
const screenshots = process.argv.includes('--screenshots');

const dataDir = mkdtempSync(path.join(tmpdir(), 'shopme-e2e-'));
const server = await startServer({ port: 0, host: '127.0.0.1', dataDir, logger: false, env: { SESSION_SECRET: 's'.repeat(40), NODE_ENV: 'test', DATA_DIR: dataDir } });
const browser = await chromium.launch();
let failed = false;
try {
  const page = await browser.newPage({ viewport: { width: Number(process.env.SHOT_W ?? 1280), height: Number(process.env.SHOT_H ?? 800) }, deviceScaleFactor: 1, locale: 'en-US', colorScheme: 'light' });
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
  for (const item of ['Home', 'Orders', 'Products', 'Customers', 'Discounts', 'Online Store', 'Settings']) {
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
  // Sub-navigation reveals under the active section.
  for (const sub of ['Collections', 'Inventory']) await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: sub, exact: true }).waitFor();
  if (screenshots) {
    await page.getByText('Ember Candle').waitFor();
    await page.screenshot({ path: path.join(shots, 'admin-products.png') });
    await page.getByText('Ember Candle').click();
    await page.getByLabel('Title', { exact: true }).waitFor();
    await page.getByRole('heading', { name: 'Ember Candle' }).waitFor();
    await page.screenshot({ path: path.join(shots, 'admin-product-editor.png'), fullPage: true });
    // Contextual save bar, command palette and one light-mode capture (dark is the default).
    await page.getByLabel('Title', { exact: true }).fill('Ember Candle (large)');
    await page.getByRole('region', { name: 'Unsaved changes' }).waitFor();
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(shots, 'admin-save-bar.png') });
    await page.getByRole('region', { name: 'Unsaved changes' }).getByRole('button', { name: 'Discard' }).click();
    await page.keyboard.press('Control+k');
    await page.getByRole('combobox', { name: 'Search' }).fill('ord');
    await page.getByRole('listbox').getByRole('option').first().waitFor();
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(shots, 'admin-command-palette.png') });
    await page.keyboard.press('Escape');
    await page.evaluate(() => { document.documentElement.dataset.theme = 'light'; });
    await page.waitForTimeout(200);
    await page.screenshot({ path: path.join(shots, 'admin-product-editor-light.png') });
    await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });
  } else {
    const state = await Promise.race([
      page.getByText('Add your first product').waitFor().then(() => 'empty'),
      page.getByRole('alert').waitFor().then(() => 'api-error'),
    ]);
    console.log(`products page rendered (${state})`);
  }
  // 6. Commerce, settings and online-store pages: each renders its heading, then data or an error banner while the API is partly missing.
  const pages: Array<[string, string, string?]> = [
    ['/', 'Welcome', 'home'], ['/orders', 'Orders', 'orders'], ['/customers', 'Customers'], ['/customers/new', 'New customer'], ['/discounts', 'Discounts'],
    ['/discounts/new?type=order', 'Amount off order'], ['/settings/general', 'Settings', 'settings'], ['/settings/payments', 'Settings'], ['/settings/shipping', 'Settings'],
    ['/settings/taxes', 'Settings'], ['/settings/domains', 'Settings'], ['/settings/languages', 'Settings'], ['/online-store', 'Online Store'],
    ['/online-store/pages', 'Online Store'], ['/online-store/pages/new', 'Add page'], ['/online-store/navigation', 'Online Store'],
    ['/online-store/blog-posts', 'Online Store'], ['/online-store/blog-posts/new', 'Add blog post'], ['/online-store/blogs', 'Online Store'], ['/online-store/redirects', 'Online Store'],
    ['/orders/drafts', 'Draft orders'], ['/orders/drafts/new', 'Create order'],
    ['/settings/users', 'Settings'], ['/settings/notifications', 'Settings'], ['/settings/policies', 'Settings'], ['/settings/webhooks', 'Settings'], ['/settings/shopify-import', 'Settings'],
  ];
  for (const [route, heading, shot] of pages) {
    await page.goto(`${server.url}/admin${route}`);
    await page.getByRole('heading', { level: 1 }).filter({ hasText: heading }).first().waitFor();
    if (screenshots && shot) {
      if (shot === 'orders') await page.getByText('Léa Moreau').waitFor();
      if (shot === 'settings') await page.getByLabel('Store name').waitFor();
      if (shot === 'home') await page.getByText('Ember Candle').first().waitFor();
      await page.screenshot({ path: path.join(shots, `admin-${shot === 'home' ? 'dashboard' : shot === 'orders' ? 'orders' : 'settings'}.png`) });
    }
    console.log(`page ok ${route}`);
  }
  if (screenshots) {
    await page.goto(`${server.url}/admin/orders/1006`);
    await page.getByRole('heading', { name: /#1006/ }).waitFor();
    await page.getByText('Ember Candle').first().waitFor();
    await page.screenshot({ path: path.join(shots, 'admin-order-detail.png'), fullPage: true });
    await page.goto(`${server.url}/admin/online-store/themes/1/editor?tab=settings`);
    await page.getByText('Primary color').waitFor();
    await page.waitForTimeout(1500);
    await page.screenshot({ path: path.join(shots, 'admin-theme-editor.png') });
    await page.goto(`${server.url}/admin/online-store`);
    await page.getByText('Aurora (autumn draft)').waitFor();
    await page.screenshot({ path: path.join(shots, 'admin-themes.png') });
    await page.goto(`${server.url}/admin/online-store/themes/1/editor`);
    await page.getByRole('button', { name: /^Hide: Hero/ }).waitFor();
    await page.getByRole('region', { name: 'Template: index' }).getByRole('button', { name: 'Add section' }).click();
    await page.getByRole('dialog').getByRole('button', { name: /Rich text/ }).click();
    await page.getByRole('button', { name: /^Hide: Rich text/ }).first().waitFor();
    await page.waitForTimeout(1500);
    await page.screenshot({ path: path.join(shots, 'admin-section-editor.png') });
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
