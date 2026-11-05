// The full merchant + shopper journey, driven in a real Chromium. See e2e/run.mjs.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { createHmac } from 'node:crypto';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { deflateSync } from 'node:zlib';

// Playwright is preinstalled in the dev container (global module) or installed in CI; browsers are never downloaded here.
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE ?? 'playwright');

const OWNER = { email: 'camille@maison-lumiere.fr', password: 'correct horse battery', first: 'Camille', last: 'Martin' };
const SHOT_DIR = 'docs/assets/screenshots';
const T = 15_000;

/** RFC 6238 code of a base32 secret (SHA-1, 6 digits, 30 s). */
function totp(secret) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const ch of secret) bits += alphabet.indexOf(ch).toString(2).padStart(5, '0');
  const key = Buffer.from(bits.match(/.{8}/g).map((b) => parseInt(b, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
  const h = createHmac('sha1', key).update(counter).digest();
  const o = h[h.length - 1] & 15;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1_000_000).padStart(6, '0');
}

/** Small valid PNG (a warm gradient) so the product has a real image without binary fixtures. */
function makePng(w = 600, h = 600) {
  const crc = (buf) => {
    let c = ~0;
    for (const b of buf) {
      c ^= b;
      for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
    }
    return ~c >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const o = y * (w * 3 + 1) + 1 + x * 3;
      raw[o] = 230 - Math.round((y / h) * 60);
      raw[o + 1] = 190 - Math.round((x / w) * 60);
      raw[o + 2] = 140 + Math.round((x / w) * 40);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

export async function runScenario({ baseUrl, root }) {
  const shotDir = path.join(root, SHOT_DIR);
  mkdirSync(shotDir, { recursive: true });
  const work = mkdtempSync(path.join(tmpdir(), 'shopme-e2e-files-'));
  const pngPath = path.join(work, 'bougie.png');
  writeFileSync(pngPath, makePng());

  const browser = await chromium.launch();
  const pageErrors = [];
  const serverErrors = [];
  const newContext = async (opts = {}) => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, locale: 'en-US', colorScheme: 'light', ...opts });
    ctx.on('page', (pg) => {
      pg.on('pageerror', (e) => pageErrors.push(`${pg.url()}: ${e.message}`));
    });
    // Any GraphQL error payload or 5xx anywhere in the journey is a failure, even when the UI happens to look fine.
    ctx.on('response', async (res) => {
      try {
        if (res.status() >= 500) serverErrors.push(`${res.status()} ${res.request().method()} ${res.url()}`);
        else if (res.url().includes('/graphql.json') && res.status() === 200) {
          const body = await res.json();
          if (body.errors?.length) serverErrors.push(`GraphQL ${res.url()}: ${body.errors.map((e) => e.message).join('; ')}`);
        }
      } catch { /* body unavailable (navigation) */ }
    });
    return ctx;
  };

  let page;
  const shot = async (name, p = page) => {
    await p.screenshot({ path: path.join(shotDir, `e2e-${name}.png`) });
  };
  let current = '';
  const step = async (name, fn) => {
    current = name;
    const t0 = Date.now();
    try {
      await fn();
    } catch (err) {
      try {
        mkdirSync(path.join(root, 'e2e/failures'), { recursive: true });
        const out = path.join(root, 'e2e/failures', `FAILED-${name.replace(/\W+/g, '_')}.png`);
        await page.screenshot({ path: out });
        console.error(`  failure screenshot: ${out} (url ${page.url()})`);
      } catch { /* ignore */ }
      err.message = `[${name}] ${err.message}`;
      throw err;
    }
    console.log(`  ok  ${name} (${Date.now() - t0} ms)`);
  };
  const vis = (loc) => loc.first().waitFor({ state: 'visible', timeout: T });
  const text = async (loc) => (await loc.first().innerText({ timeout: T })).replace(/\s+/g, ' ').trim();
  /** Digits-only comparison of a price text, tolerant to nbsp / narrow nbsp / currency position. */
  const norm = (s) => s.replace(/[\s  ]/g, '');

  try {
    const ctx = await newContext();
    page = await ctx.newPage();

    // ---------------------------------------------------------------- 1. setup wizard
    await step('1 setup wizard', async () => {
      await page.goto(`${baseUrl}/admin`);
      await vis(page.getByRole('heading', { name: 'Set up your store' }));
      await page.getByLabel('Language').selectOption('fr');
      await vis(page.getByRole('heading', { name: 'Configurez votre boutique' }));
      await page.getByLabel('Nom de la boutique').fill('Maison Lumière');
      await page.getByLabel('Prénom').fill(OWNER.first);
      await page.getByLabel('Nom', { exact: true }).fill(OWNER.last);
      await page.getByLabel('E-mail').fill(OWNER.email);
      await page.getByLabel('Mot de passe').fill(OWNER.password);
      await page.getByLabel('Devise').selectOption('EUR');
      await page.getByLabel('Pays').selectOption('FR');
      await shot('01-setup');
      await page.getByRole('button', { name: 'Créer la boutique' }).click();
      await vis(page.getByRole('navigation', { name: /Main|Principale/ }));
      await vis(page.getByText('Bienvenue, Camille'));
      // Continue in English; the FR/EN switch is exercised again in step 8.
      await page.getByRole('button', { name: 'Menu du compte' }).click();
      await page.getByRole('menuitem', { name: /English/ }).click();
      await vis(page.getByText('Welcome, Camille'));
    });

    // ---------------------------------------------------------------- 2. settings
    await step('2a payments: bank transfer', async () => {
      await page.goto(`${baseUrl}/admin/settings/payments`);
      await page.getByLabel('Accept bank transfers').click();
      await page.getByLabel('Payment instructions').fill('Virement sur IBAN FR76 3000 6000 0112 3456 7890 189, BIC AGRIFRPP. Indiquez le numéro de commande.');
      await page.getByRole('button', { name: 'Save', exact: true }).click();
      await page.reload();
      await vis(page.getByLabel('Payment instructions'));
      assert.match(await page.getByLabel('Payment instructions').inputValue(), /IBAN FR76/);
    });

    await step('2b shipping zone France in the general profile', async () => {
      await page.goto(`${baseUrl}/admin/settings/shipping`);
      await page.getByText('General profile').first().click();
      await page.getByRole('button', { name: 'Add shipping zone' }).first().click();
      let dlg = page.getByRole('dialog');
      await dlg.getByLabel('Zone name').fill('France');
      await dlg.getByLabel('France', { exact: true }).check();
      await dlg.getByRole('button', { name: 'Save', exact: true }).click();
      await vis(page.getByRole('button', { name: 'Add rate' }));
      await page.getByRole('button', { name: 'Add rate' }).first().click();
      dlg = page.getByRole('dialog');
      await dlg.getByLabel('Option name').fill('Livraison standard');
      await dlg.getByLabel('Price (EUR)').fill('4.90');
      await dlg.getByRole('button', { name: 'Save', exact: true }).click();
      await dlg.waitFor({ state: 'hidden' });
      await vis(page.getByText('Livraison standard'));
      await page.getByRole('button', { name: 'Add rate' }).first().click();
      dlg = page.getByRole('dialog');
      await dlg.getByLabel('Option name').fill('Livraison offerte');
      await dlg.getByLabel('Price (EUR)').fill('0');
      await dlg.getByLabel('Condition').selectOption({ label: 'Based on order price' });
      await dlg.getByLabel(/Minimum order price/).fill('50');
      await shot('02-shipping-zone');
      await dlg.getByRole('button', { name: 'Save', exact: true }).click();
      await vis(page.getByText('Livraison offerte'));
      await vis(page.getByText('France').first());
    });

    await step('2c tax rate FR 20% included', async () => {
      await page.goto(`${baseUrl}/admin/settings/taxes`);
      await page.getByRole('button', { name: 'Add tax rate' }).click();
      const dlg = page.getByRole('dialog');
      await dlg.getByLabel('Country').selectOption('FR');
      await dlg.getByLabel('Tax name').fill('TVA');
      await dlg.getByLabel('Rate (%)').fill('20');
      await dlg.getByRole('button', { name: 'Save', exact: true }).click();
      await vis(page.getByText('TVA'));
      const incl = page.getByLabel('Prices include tax');
      if (!(await incl.isChecked())) await incl.check();
      const save = page.getByRole('button', { name: 'Save', exact: true });
      if (await save.isVisible()) await save.click();
      await page.reload();
      await vis(page.getByText('TVA'));
      assert.equal(await page.getByLabel('Prices include tax').isChecked(), true);
      await shot('03-taxes');
    });

    // ---------------------------------------------------------------- 3. catalog
    let productUrl = '';
    await step('3a product with 4 variants, image, active', async () => {
      await page.goto(`${baseUrl}/admin/products/new`);
      await page.getByLabel('Title', { exact: true }).fill('Bougie parfumée');
      await page.locator('[contenteditable="true"]').first().fill('Bougie à la cire de soja, parfum au choix.');
      await page.getByLabel('Vendor').fill('Maison Lumière');
      await page.getByLabel('Status').selectOption({ label: 'Active' });
      // image upload
      const chooser = page.waitForEvent('filechooser');
      await page.getByRole('button', { name: /Upload images/ }).click();
      await (await chooser).setFiles(pngPath);
      await vis(page.locator('main img').first());
      // options
      await page.getByRole('button', { name: 'Add options like size or color' }).click();
      await page.getByLabel('Option name').first().fill('Parfum');
      await page.getByLabel('Option values').first().fill('Vanille');
      await page.keyboard.press('Enter');
      await page.getByLabel('Option values').first().fill('Figue');
      await page.keyboard.press('Enter');
      await page.getByRole('button', { name: 'Add another option' }).click();
      await page.getByLabel('Option name').nth(1).fill('Taille');
      await page.getByLabel('Option values').nth(1).fill('S');
      await page.keyboard.press('Enter');
      await page.getByLabel('Option values').nth(1).fill('L');
      await page.keyboard.press('Enter');
      await vis(page.getByText('4 variants'));
      const prices = { 'Vanille / S': ['18.00', 'BOUG-VAN-S'], 'Vanille / L': ['32.00', 'BOUG-VAN-L'], 'Figue / S': ['19.00', 'BOUG-FIG-S'], 'Figue / L': ['34.00', 'BOUG-FIG-L'] };
      for (const [label, [price_, sku]] of Object.entries(prices)) {
        await page.getByRole('group', { name: 'Variants' }).getByRole('button', { name: label, exact: true }).click();
        const price = page.getByLabel('Price', { exact: true });
        await price.fill(price_);
        await page.getByRole('button', { name: 'SKU', exact: true }).click();
        await page.getByLabel('SKU', { exact: true }).fill(sku);
        await page.getByLabel(/Available/).fill('10');
      }
      await shot('04-product-editor');
      await page.getByRole('button', { name: 'Save', exact: true }).click();
      await page.waitForURL(/\/admin\/products\/\d+|gid/, { timeout: T });
      productUrl = page.url();
      await page.reload();
      await page.getByRole('group', { name: 'Variants' }).getByRole('button', { name: 'Figue / L', exact: true }).click();
      assert.equal(await page.getByLabel('Status').inputValue(), 'ACTIVE');
      assert.equal(await page.getByLabel('Price', { exact: true }).inputValue(), '34.00');
    });

    await step('3b manual collection Bougies', async () => {
      await page.goto(`${baseUrl}/admin/collections/new`);
      await page.getByLabel('Title', { exact: true }).fill('Bougies');
      await page.getByRole('button', { name: 'Add products' }).click();
      const dlg = page.getByRole('dialog');
      await vis(dlg.getByText('Bougie parfumée'));
      await dlg.getByRole('checkbox').first().check();
      await dlg.getByRole('button', { name: /^Add \(1\)/ }).click();
      await vis(page.getByText('Bougie parfumée'));
      await page.getByRole('button', { name: 'Save', exact: true }).click();
      await page.waitForURL(/\/admin\/collections\/(?!new)/, { timeout: T });
      await page.reload();
      await vis(page.getByText('Bougie parfumée'));
    });

    // ---------------------------------------------------------------- 4. online store
    const PRIMARY = '#c2410c';
    let themeNum = '1';
    await step('4a theme editor: primary colour', async () => {
      await page.goto(`${baseUrl}/admin/online-store`);
      await vis(page.getByText('Aurora'));
      await page.getByRole('button', { name: 'Customize' }).click();
      await page.waitForURL(/\/themes\/\d+\/editor/, { timeout: T });
      themeNum = /\/themes\/(\d+)\//.exec(page.url())[1];
      // the editor opens on the Sections tab; colours live under "Theme settings"
      await page.getByRole('tab', { name: 'Theme settings' }).click();
      await vis(page.getByLabel('Primary color (hex)'));
      await page.getByLabel('Primary color (hex)').fill(PRIMARY);
      await shot('05-theme-editor');
      await page.getByRole('button', { name: 'Save', exact: true }).click();
      await page.reload();
      await page.getByRole('tab', { name: 'Theme settings' }).click();
      await vis(page.getByLabel('Primary color (hex)'));
      assert.equal((await page.getByLabel('Primary color (hex)').inputValue()).toLowerCase(), PRIMARY);
    });

    await step('4a2 theme editor: preview data, add section preview, menu entries', async () => {
      await page.goto(`${baseUrl}/admin/online-store/themes/${themeNum}/editor`);
      await vis(page.getByRole('region', { name: 'Template', exact: true }));
      await page.getByRole('button', { name: 'Preview data' }).click();
      await vis(page.getByRole('dialog', { name: 'Preview data' }).getByLabel('Product'));
      await page.keyboard.press('Escape');
      await page.getByRole('region', { name: 'Template', exact: true }).getByRole('button', { name: 'Add section' }).click();
      const picker = page.getByRole('dialog', { name: 'Add section' });
      await vis(picker.getByRole('button', { name: /Slideshow/ }).first());
      await vis(picker.getByRole('button', { name: 'Add section' }));
      await page.keyboard.press('Escape');
      await page.getByRole('button', { name: 'More actions' }).click();
      for (const name of ['Edit code', 'Edit default theme content', 'View documentation']) await vis(page.getByRole('menuitem', { name }));
      await page.keyboard.press('Escape');
    });

    await step('4a3 theme code editor: open, check, refuse a syntax error, save, history', async () => {
      await page.goto(`${baseUrl}/admin/online-store/themes/${themeNum}/code?file=snippets/price.liquid`);
      await vis(page.getByRole('tab', { name: 'price.liquid' }));
      const editor = page.locator('.cm-content');
      await vis(editor);
      await editor.click();
      await page.keyboard.press('Control+Home');
      await page.keyboard.type('{% if x %}');
      await vis(page.getByRole('list', { name: 'Problems' }));
      await page.getByRole('button', { name: 'Save', exact: true }).click();
      await vis(page.getByText(/snippets\/price\.liquid line \d+/));
      await editor.click();
      await page.keyboard.press('Control+Home');
      for (let i = 0; i < 10; i++) await page.keyboard.press('Delete');
      await page.keyboard.type('{%- comment -%}saved by the e2e{%- endcomment -%}\n');
      await page.getByRole('button', { name: 'Save', exact: true }).click();
      await vis(page.getByText('Theme files saved'));
      await page.getByRole('button', { name: 'History' }).click();
      await vis(page.getByRole('complementary', { name: 'History' }).locator('button[aria-pressed]').first());
      // a new file appears in the tree
      await page.getByRole('button', { name: 'Add a file to snippets' }).click();
      await page.getByLabel('File name').fill('e2e-note');
      await page.getByRole('button', { name: 'Create file' }).click();
      await vis(page.getByRole('tab', { name: 'e2e-note.liquid' }));
    });

    await step('4a4 default theme content: edit a text and keep it', async () => {
      await page.goto(`${baseUrl}/admin/online-store/themes/${themeNum}/content`);
      await page.getByPlaceholder('Search texts').fill('products.add_to_cart');
      const box = page.getByLabel('products.add_to_cart', { exact: true });
      await vis(box);
      await box.fill('Add to bag');
      await page.getByRole('button', { name: 'Save', exact: true }).click();
      await vis(page.getByText('Theme content saved'));
      await page.reload();
      await page.getByPlaceholder('Search texts').fill('products.add_to_cart');
      assert.equal(await page.getByLabel('products.add_to_cart', { exact: true }).inputValue(), 'Add to bag');
    });

    await step('4b page "À propos"', async () => {
      await page.goto(`${baseUrl}/admin/online-store/pages/new`);
      await page.getByLabel('Title', { exact: true }).fill('À propos');
      await page.locator('[contenteditable="true"]').first().fill('Maison Lumière fabrique des bougies artisanales à Grasse.');
      await page.getByLabel('Visible', { exact: true }).check();
      await page.getByRole('button', { name: 'Save', exact: true }).first().click();
      await page.waitForURL(/\/online-store\/pages\/(?!new)/, { timeout: T });
      await page.goto(`${baseUrl}/admin/online-store/pages`);
      await vis(page.getByText('À propos'));
    });

    await step('4c main menu: add the page', async () => {
      await page.goto(`${baseUrl}/admin/online-store/navigation`);
      await page.getByRole('cell', { name: 'Menu principal' }).click();
      await page.waitForURL(/\/online-store\/navigation\/\d+/, { timeout: T });
      await page.getByRole('button', { name: 'Add menu item' }).click();
      const dlg = page.getByRole('dialog');
      await dlg.getByLabel('Link to').selectOption({ label: 'Page' });
      await dlg.getByText('À propos').click();
      await page.getByRole('button', { name: 'Save', exact: true }).first().click();
      await page.reload();
      await vis(page.getByText('Menu items'));
      await page.waitForFunction(() => [...document.querySelectorAll('input')].some((i) => i.value === 'À propos'), null, { timeout: T });
      assert.equal(await page.getByRole('button', { name: 'Delete' }).count(), 0, 'default menus cannot be deleted');
    });

    // ---------------------------------------------------------------- 5. discount
    await step('5 discount BIENVENUE10', async () => {
      await page.goto(`${baseUrl}/admin/discounts/new`);
      await page.getByLabel('Discount code', { exact: true }).fill('BIENVENUE10');
      await page.getByLabel('Discount type').selectOption({ label: 'Percentage' });
      await page.getByLabel('%').fill('10');
      await shot('06-discount');
      await page.getByRole('button', { name: 'Save', exact: true }).first().click();
      await page.waitForURL(/\/admin\/discounts\/(?!new)/, { timeout: T });
      await page.goto(`${baseUrl}/admin/discounts`);
      await vis(page.getByText('BIENVENUE10'));
    });

    // ---------------------------------------------------------------- 6. storefront + checkout (shopper, desktop, French)
    const admin = page;
    const shopperCtx = await newContext({ locale: 'fr-FR' });
    const shop = await shopperCtx.newPage();
    await step('6a storefront home shows product and collection', async () => {
      page = shop;
      const res = await shop.goto(`${baseUrl}/`);
      assert.equal(res.status(), 200);
      assert.match(await shop.title(), /Maison Lumière/);
      await vis(shop.getByText('Bougie parfumée'));
      await vis(shop.getByText('Bougies').first());
      assert.equal(await shop.locator('html').getAttribute('lang'), 'fr');
      // the primary colour set in the theme editor is applied
      const css = await shop.content();
      assert.ok(css.toLowerCase().includes(PRIMARY), 'theme primary colour is rendered on the storefront');
      // the page added to the main menu is in the header
      await vis(shop.locator('header').getByRole('link', { name: 'À propos' }));
      await shot('07-storefront-home');
    });

    await step('6b collection and page', async () => {
      await shop.goto(`${baseUrl}/collections/bougies`);
      await vis(shop.getByRole('heading', { name: 'Bougies' }));
      await vis(shop.getByText('Bougie parfumée'));
      await shop.goto(`${baseUrl}/pages/a-propos`);
      await vis(shop.getByText('bougies artisanales à Grasse'));
    });

    await step('6c product page: pick Figue / L and add to cart (Ajax)', async () => {
      await shop.goto(`${baseUrl}/collections/bougies`);
      await shop.getByText('Bougie parfumée').first().click();
      await shop.waitForURL(/\/products\/bougie-parfumee/);
      await vis(shop.getByRole('heading', { name: 'Bougie parfumée' }));
      await shop.locator('label.option__label', { hasText: /^Figue$/ }).click();
      await shop.locator('label.option__label', { hasText: /^L$/ }).click();
      assert.equal(await shop.getByLabel('Figue', { exact: true }).isChecked(), true);
      await vis(shop.locator('[data-product-price]').getByText(/34/));
      assert.match(await text(shop.locator('[data-product-price]')), /34,00/);
      await shot('08-storefront-product');
      const count = shop.locator('[data-cart-count]').first();
      const addReq = shop.waitForResponse((r) => r.url().includes('/cart/add') && r.request().method() === 'POST');
      await shop.locator('[data-add-to-cart]').click();
      assert.equal((await addReq).status(), 200);
      await shop.waitForFunction(() => document.querySelector('[data-cart-count]')?.textContent?.trim() === '1', null, { timeout: T });
      assert.equal(shop.url().includes('/cart'), false, 'add to cart stays on the product page (Ajax)');
    });

    await step('6d /cart.js sanity and cart page', async () => {
      const cart = await (await shopperCtx.request.get(`${baseUrl}/cart.js`)).json();
      assert.equal(cart.item_count, 1);
      assert.equal(cart.currency, 'EUR');
      assert.equal(cart.items.length, 1);
      assert.equal(cart.items[0].variant_title, 'Figue / L');
      assert.equal(cart.items[0].sku, 'BOUG-FIG-L');
      assert.equal(cart.items[0].price, 3400);
      assert.equal(cart.total_price, 3400);
      await shop.goto(`${baseUrl}/cart`);
      await vis(shop.getByText('Bougie parfumée'));
      await vis(shop.getByText('Parfum: Figue'));
      await vis(shop.getByText('Taille: L'));
      await shot('09-storefront-cart');
    });

    await step('6e checkout page', async () => {
      await shop.getByRole('link', { name: 'Commander' }).click();
      await shop.waitForURL(/\/checkouts?\//, { timeout: T });
      await shot('10-checkout-start');
    });

    await step('6f checkout: contact, address, shipping, discount, bank transfer', async () => {
      await shop.locator('#email').fill('julie.dupont@example.fr');
      await shop.getByLabel('Prénom').fill('Julie');
      await shop.getByLabel('Nom', { exact: true }).fill('Dupont');
      await shop.getByLabel('Adresse', { exact: true }).fill('12 rue de la Paix');
      await shop.getByLabel('Code postal').fill('75002');
      await shop.getByLabel('Ville').fill('Paris');
      const phone = shop.getByLabel(/Téléphone/);
      if (await phone.count()) await phone.fill('0142000000');
      // shipping rates appear once the address is complete
      const rates = shop.locator('#shipping-methods input[name="shippingRateId"]');
      await rates.first().waitFor({ state: 'attached', timeout: T });
      assert.equal(await rates.count(), 1, 'only the 4.90 rate is offered below 50 EUR');
      await vis(shop.locator('#shipping-methods').getByText('Livraison standard'));
      await vis(shop.locator('#shipping-methods').getByText(/4,90/));
      // discount
      await shop.locator('#discount-input').fill('BIENVENUE10');
      await shop.locator('[data-discount-add]').click();
      await vis(shop.locator('.tag', { hasText: 'BIENVENUE10' }));
      const summary = await text(shop.locator('#summary-lines'));
      assert.match(summary, /Sous-total 34,00 €/);
      assert.match(summary, /-3,40 €|−3,40 €|-3,40/, `discount line: ${summary}`);
      assert.match(summary, /4,90 €/);
      assert.match(summary, /Total 35,50 €/, `total: ${summary}`);
      // payment: bank transfer
      await shop.locator('input[name="paymentMethod"][value="bank_transfer"]').check();
      await shot('11-checkout-filled');
      const statusAfter = shop.waitForURL(/thank|order|status/i, { timeout: 30_000 });
      await shop.locator('#submit').click();
      await statusAfter;
    });

    await step('6g thank-you page: order #1001 and totals', async () => {
      await vis(shop.getByText('#1001').first());
      const body = await text(shop.locator('main'));
      assert.match(body, /#1001/);
      assert.match(body, /IBAN FR76/, 'bank transfer instructions are shown');
      assert.match(body, /Sous-total.*34,00 €/);
      assert.match(body, /3,40 €/);
      assert.match(body, /4,90 €/);
      assert.match(body, /35,50 €/);
      assert.match(body, /Dont taxes\s*5,10 €/, 'VAT included in 30.60 items (shipping untaxed by setting) = 5.10');
      await shot('12-thank-you');
    });

    // ---------------------------------------------------------------- 7. back office: the order
    await step('7a orders list: #1001 pending / unfulfilled', async () => {
      page = admin;
      await admin.goto(`${baseUrl}/admin/orders`);
      const row = admin.getByRole('row', { name: /#1001/ });
      await vis(row);
      const t = await text(row);
      assert.match(t, /#1001.*Julie Dupont €35\.50 Payment pending Unfulfilled 1/);
      await shot('13-admin-orders');
    });

    await step('7b order detail', async () => {
      await admin.getByRole('row', { name: /#1001/ }).getByText('#1001').click();
      await admin.waitForURL(/\/admin\/orders\/\d+/);
      await admin.waitForTimeout(1000);
      await vis(admin.getByText('Order #1001 was placed online'));
      assert.match(await text(admin.locator('main')), /Taxes\s*€5\.10/);
      await shot('14-admin-order-pending');
    });

    await step('7c mark as paid', async () => {
      await admin.getByRole('button', { name: 'Mark as paid' }).first().click();
      const dlg = admin.getByRole('dialog');
      if (await dlg.count()) await dlg.getByRole('button', { name: /Mark as paid|Confirm|Save/ }).last().click();
      await admin.waitForFunction(() => /#1001\s*Paid/.test(document.querySelector('main')?.innerText.replace(/\s+/g, ' ') ?? ''), null, { timeout: T });
      await vis(admin.getByText(/marked as paid|payment/i).first());
    });

    await step('7d fulfil with tracking number', async () => {
      await admin.getByRole('button', { name: 'Mark as fulfilled' }).first().click();
      const dlg = admin.getByRole('dialog');
      await dlg.getByLabel('Carrier').fill('Colissimo');
      await dlg.getByLabel('Tracking number').fill('6A12345678901');
      await dlg.getByRole('button', { name: 'Mark as fulfilled' }).click();
      await admin.waitForFunction(() => /#1001\s*Paid\s*Fulfilled/.test(document.querySelector('main')?.innerText.replace(/\s+/g, ' ') ?? ''), null, { timeout: T });
      await vis(admin.getByText('6A12345678901').first());
    });

    await step('7e timeline comment', async () => {
      await admin.getByPlaceholder(/comment|Leave/i).fill('Colis préparé et remis au transporteur.');
      await admin.getByRole('button', { name: 'Post' }).click();
      await vis(admin.getByText('Colis préparé et remis au transporteur.'));
      await admin.reload();
      await vis(admin.getByText('Colis préparé et remis au transporteur.'));
      await shot('15-admin-order-fulfilled');
    });

    await step('7f customer exists with 1 order', async () => {
      await admin.goto(`${baseUrl}/admin/customers`);
      const row = admin.getByRole('row', { name: /Julie Dupont/ });
      await vis(row);
      assert.match(await text(row), /Julie Dupont.*Paris, France 1 €35\.50/);
      await shot('16-admin-customers');
      await row.getByText('Julie Dupont').click();
      await admin.waitForURL(/\/admin\/customers\/\d+/);
      await vis(admin.getByText('julie.dupont@example.fr').first());
      const detail = await text(admin.locator('main'));
      assert.match(detail, /Orders 1/);
      assert.match(detail, /Amount spent €35\.50/);
      assert.match(detail, /#1001.*Paid.*Fulfilled.*€35\.50/);
    });

    await step('7f2 customer tools: query bar, bulk edit, company, more actions', async () => {
      await admin.goto(`${baseUrl}/admin/customers`);
      const bar = admin.getByRole('combobox', { name: 'Filter customers with a query' });
      await bar.fill('foo:bar');
      await vis(admin.getByRole('alert').filter({ hasText: 'is not a customer field' }));
      await bar.fill('orders_count:>0');
      await admin.getByRole('button', { name: 'Apply', exact: true }).click();
      const row = admin.getByRole('row', { name: /Julie Dupont/ });
      await vis(row);
      await admin.getByRole('button', { name: 'Save as segment' }).waitFor({ state: 'visible', timeout: T });
      // bulk edit: add a tag to the selected customer
      await row.getByRole('checkbox').check();
      await admin.getByRole('button', { name: 'Edit in bulk' }).click();
      await vis(admin.getByRole('dialog').getByText('Edit 1 customer'));
      await admin.getByRole('dialog').locator('input').first().fill('vip');
      await admin.getByRole('dialog').locator('input').first().press('Enter');
      await admin.getByRole('dialog').getByRole('button', { name: 'Apply changes' }).click();
      await vis(admin.getByText('1 customer updated'));
      // the column chooser can show the tags column
      await admin.getByRole('button', { name: 'Edit columns' }).click();
      await admin.getByRole('checkbox', { name: 'Tags' }).check();
      await vis(admin.getByRole('row', { name: /Julie Dupont.*vip/ }));
      // a company with this customer as a contact
      await admin.goto(`${baseUrl}/admin/customers/companies`);
      await admin.getByRole('button', { name: 'Add company' }).first().click();
      await admin.getByRole('dialog').getByLabel('Company', { exact: true }).fill('Maison Lumière Pro');
      await admin.getByRole('dialog').getByRole('button', { name: 'Create company' }).click();
      await admin.waitForURL(/\/admin\/customers\/companies\/\d+/);
      await vis(admin.getByRole('heading', { name: 'Maison Lumière Pro' }));
      await admin.getByRole('button', { name: 'Add contact' }).click();
      await admin.getByRole('dialog').getByRole('searchbox').fill('Julie');
      await admin.getByRole('dialog').getByRole('button', { name: /Julie Dupont/ }).click();
      await vis(admin.getByRole('link', { name: 'Julie Dupont' }));
      await shot('16b-admin-company', admin);
      // the customer page shows the company, the group tile and the new More actions
      await admin.goto(`${baseUrl}/admin/customers`);
      await admin.getByRole('row', { name: /Julie Dupont/ }).getByText('Julie Dupont').click();
      await admin.waitForURL(/\/admin\/customers\/\d+/);
      await vis(admin.getByRole('link', { name: 'Maison Lumière Pro' }));
      assert.match(await text(admin.locator('main')), /Customer group Customer/);
      await admin.getByRole('button', { name: 'More actions' }).first().click();
      await vis(admin.getByRole('menuitem', { name: 'Erase personal data' }));
      await vis(admin.getByRole('menuitem', { name: 'Merge customer' }));
      await vis(admin.getByRole('menuitem', { name: 'Request customer data' }));
      await admin.keyboard.press('Escape');
    });

    await step('7g inventory of Figue / L is 9', async () => {
      await admin.goto(`${baseUrl}/admin/inventory`);
      const row = admin.getByRole('row', { name: /Figue \/ L/ });
      await vis(row);
      const cells = (await row.locator('td').allInnerTexts()).map((c) => c.trim());
      // columns: product, SKU, unavailable, committed, available, on hand, incoming (10 in stock, 1 sold and shipped)
      assert.deepEqual(cells.slice(-4, -1), ['0', '9', '9'], `committed/available/on hand: ${cells.join(' | ')}`);
      const other = await text(admin.getByRole('row', { name: /Vanille \/ S/ }));
      assert.match(other, /BOUG-VAN-S\s+0\s+0\s+10\s+10\s+0/);
      await shot('17-admin-inventory');
    });

    await step('7g2 orders buttons: stats strip, columns, bulk bar, order extras, labels, marketing, channels', async () => {
      page = admin;
      await admin.goto(`${baseUrl}/admin/orders`);
      await vis(admin.getByRole('row', { name: /#1001/ }));
      // stats strip with its period menu and the extra figures
      await vis(admin.getByText('Orders fulfilled', { exact: true }));
      await vis(admin.getByText('Fulfillment time', { exact: true }));
      await admin.getByRole('button', { name: 'Period' }).click();
      await admin.getByRole('menuitem', { name: 'Last 7 days' }).click();
      // column chooser
      await admin.getByRole('button', { name: 'Edit columns' }).click();
      await admin.getByLabel('Delivery status').check();
      await vis(admin.getByRole('columnheader', { name: 'Delivery status' }));
      await admin.keyboard.press('Escape');
      // bulk bar
      await admin.getByRole('row', { name: /#1001/ }).getByRole('checkbox').check();
      for (const name of ['Print', 'Create shipping labels', 'Mark as', 'Capture payments', 'Batch', 'Add tags']) await vis(admin.getByRole('toolbar').getByRole('button', { name }));
      await admin.getByRole('toolbar').getByRole('button', { name: 'Mark as' }).click();
      await admin.getByRole('menuitem', { name: 'Delivered' }).click();
      await vis(admin.getByText('1 order updated'));
      await admin.getByRole('row', { name: /#1001/ }).getByRole('checkbox').check();
      await admin.getByRole('toolbar').getByRole('button', { name: 'Batch' }).click();
      await admin.getByRole('menuitem', { name: 'Create batch' }).click();
      await admin.getByLabel('Batch name').fill('Morning pick');
      await admin.getByRole('dialog').getByRole('button', { name: 'Create batch' }).click();
      await vis(admin.getByText('Batch Morning pick created'));
      await shot('13b-admin-orders-bulk');
      // order page: conversion summary, risk, fulfilment details
      await admin.getByRole('row', { name: /#1001/ }).getByText('#1001').click();
      await admin.waitForURL(/\/admin\/orders\/\d+/);
      await vis(admin.getByText('Conversion summary', { exact: true }));
      await vis(admin.getByText('Order risk', { exact: true }));
      await vis(admin.getByLabel('Fulfill by'));
      await shot('13c-admin-order-extras');
      // shipping labels page
      await admin.goto(`${baseUrl}/admin/orders/shipping-labels`);
      await vis(admin.getByRole('heading', { name: 'Shipping labels' }));
      await vis(admin.getByRole('tab', { name: /Awaiting a label/ }));
      await shot('13d-admin-shipping-labels');
      // marketing: create a campaign
      await admin.goto(`${baseUrl}/admin/marketing`);
      await admin.getByRole('button', { name: 'Create campaign' }).first().click();
      await admin.getByLabel('Name').fill('Spring email');
      await admin.getByLabel('Campaign (utm_campaign)').fill('spring');
      await admin.getByRole('dialog').getByRole('button', { name: 'Save', exact: true }).click();
      await vis(admin.getByRole('row', { name: /Spring email/ }));
      await shot('13e-admin-marketing');
      // sales channels
      await admin.goto(`${baseUrl}/admin/channels`);
      await vis(admin.getByRole('heading', { name: 'Online store' }));
      await shot('13f-admin-channels');
      // learn more under the orders list
      await admin.goto(`${baseUrl}/admin/orders`);
      await vis(admin.getByRole('link', { name: /Learn more about orders/ }));
    });

    await step('7h dashboard shows the sale', async () => {
      await admin.goto(`${baseUrl}/admin`);
      await vis(admin.getByText('Welcome').first());
      await admin.waitForTimeout(1000);
      const dash = await text(admin.locator('main'));
      assert.match(dash, /Sales €35\.50/);
      assert.match(dash, /Orders 1/);
      assert.match(dash, /Average order value €35\.50/);
      assert.match(dash, /Top products Bougie parfumée 1/);
      await shot('18-admin-dashboard');
    });

    // ---------------------------------------------------------------- 8. auth, language, 404, JSON
    await step('8a log out and back in', async () => {
      await admin.goto(`${baseUrl}/admin`);
      await admin.getByRole('button', { name: 'Account menu' }).click();
      await admin.getByRole('menuitem', { name: 'Log out' }).click();
      await vis(admin.getByRole('heading', { name: 'Log in' }));
      // the session is really gone server-side
      assert.equal((await admin.request.get(`${baseUrl}/admin/api/auth/me`)).status(), 401);
      await admin.getByLabel('Email').fill(OWNER.email);
      await admin.getByLabel('Password').fill('wrong password here');
      await admin.getByRole('button', { name: 'Log in' }).click();
      await vis(admin.getByText('Incorrect email or password.'));
      await admin.getByLabel('Password').fill(OWNER.password);
      await admin.getByRole('button', { name: 'Log in' }).click();
      await vis(admin.getByText('Welcome, Camille'));
    });

    await step('8b language switch EN <-> FR', async () => {
      await admin.getByRole('button', { name: 'Account menu' }).click();
      await admin.getByRole('menuitem', { name: /Français/ }).click();
      await vis(admin.getByText('Bienvenue, Camille'));
      const nav = await text(admin.locator('nav').first());
      for (const w of ['Accueil', 'Commandes', 'Produits', 'Clients', 'Réductions', 'Boutique en ligne', 'Paramètres']) assert.ok(nav.includes(w), `French nav has ${w}: ${nav}`);
      await admin.goto(`${baseUrl}/admin/orders`);
      await vis(admin.getByRole('row', { name: /#1001/ }));
      const row = await text(admin.getByRole('row', { name: /#1001/ }));
      assert.match(row, /Payé/);
      assert.match(row, /Traitée|Expédié|Exécuté/i);
      assert.match(row, /35,50\s*€/, `French money format: ${row}`);
      await shot('19-admin-orders-fr');
      await admin.getByRole('button', { name: 'Menu du compte' }).click();
      await admin.getByRole('menuitem', { name: /English/ }).click();
      await vis(admin.getByText('Orders', { exact: true }).first());
    });

    await step('8c 404 pages and JSON endpoints', async () => {
      const r = await shop.goto(`${baseUrl}/pages/does-not-exist`);
      assert.equal(r.status(), 404);
      await vis(shop.getByRole('heading', { name: /introuvable|404/i }));
      await shot('20-storefront-404', shop);
      assert.equal((await shopperCtx.request.get(`${baseUrl}/products/nope`)).status(), 404);
      assert.equal((await shopperCtx.request.get(`${baseUrl}/nope`)).status(), 404);
      // after checkout the cart is empty
      const cart = await (await shopperCtx.request.get(`${baseUrl}/cart.js`)).json();
      assert.equal(cart.item_count, 0);
      assert.deepEqual(cart.items, []);
      assert.equal(cart.currency, 'EUR');
      assert.equal((await shopperCtx.request.get(`${baseUrl}/products/bougie-parfumee.js`)).status(), 200);
      const health = await (await shopperCtx.request.get(`${baseUrl}/healthz`)).json();
      assert.equal(health.status, 'ok');
      // unauthenticated admin API is refused
      const anon = await browser.newContext();
      assert.equal((await anon.request.post(`${baseUrl}/admin/api/2026-10/graphql.json`, { data: { query: '{ shop { name } }' } })).status(), 401);
      await anon.close();
      // admin SPA: unknown route
      await admin.goto(`${baseUrl}/admin/definitely-not-here`);
      await vis(admin.getByText('Page not found'));
    });

    // ---------------------------------------------------------------- 9. mobile pass: storefront + checkout
    await step('9 mobile: browse, add to cart, checkout (order #1002)', async () => {
      const mctx = await newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'fr-FR' });
      const m = await mctx.newPage();
      page = m;
      const noHScroll = async (label) => {
        const o = await m.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
        assert.ok(o.sw <= o.iw + 1, `${label}: horizontal overflow (${o.sw} > ${o.iw})`);
      };
      await m.goto(`${baseUrl}/`);
      await vis(m.getByText('Bougie parfumée'));
      await noHScroll('home');
      await shot('m-01-home', m);
      await m.goto(`${baseUrl}/products/bougie-parfumee`);
      await m.locator('label.option__label', { hasText: /^Vanille$/ }).click();
      await m.locator('label.option__label', { hasText: /^S$/ }).click();
      assert.match(await text(m.locator('[data-product-price]')), /18,00/);
      await noHScroll('product');
      await shot('m-02-product', m);
      await m.locator('[data-add-to-cart]').click();
      await m.waitForFunction(() => document.querySelector('[data-cart-count]')?.textContent?.trim() === '1', null, { timeout: T });
      await m.goto(`${baseUrl}/cart`);
      await vis(m.getByText('Parfum: Vanille'));
      await noHScroll('cart');
      await shot('m-03-cart', m);
      await m.getByRole('link', { name: 'Commander' }).click();
      await m.waitForURL(/\/checkouts?\//, { timeout: T });
      await m.locator('#email').fill('marc.leroy@example.fr');
      await m.getByLabel('Prénom').fill('Marc');
      await m.getByLabel('Nom', { exact: true }).fill('Leroy');
      await m.getByLabel('Adresse', { exact: true }).fill('5 place Bellecour');
      await m.getByLabel('Code postal').fill('69002');
      await m.getByLabel('Ville').fill('Lyon');
      await m.locator('#shipping-methods input[name="shippingRateId"]').first().waitFor({ state: 'attached', timeout: T });
      await m.locator('input[name="paymentMethod"][value="bank_transfer"]').check();
      await noHScroll('checkout');
      await shot('m-04-checkout', m);
      await m.locator('#submit').click();
      await m.waitForURL(/thank/i, { timeout: 30_000 });
      const body = await text(m.locator('main'));
      assert.match(body, /#1002/);
      assert.match(body, /Total\s*22,90 €/, `18.00 + 4.90 shipping: ${body}`);
      await noHScroll('thank-you');
      await shot('m-05-thank-you', m);
      await mctx.close();
    });

    await step('10 free shipping rate over 50 EUR applies at checkout', async () => {
      const product = await (await shopperCtx.request.get(`${baseUrl}/products/bougie-parfumee.js`)).json();
      const big = product.variants.find((v) => v.title === 'Vanille / L');
      assert.equal(big.price, 3200);
      const add = await shopperCtx.request.post(`${baseUrl}/cart/add.js`, { data: { id: big.id, quantity: 2 } });
      assert.equal(add.status(), 200);
      await shop.goto(`${baseUrl}/checkout`);
      await shop.waitForURL(/\/checkouts\//, { timeout: T });
      await shop.locator('#email').fill('julie.dupont@example.fr');
      await shop.getByLabel('Prénom').fill('Julie');
      await shop.getByLabel('Nom', { exact: true }).fill('Dupont');
      await shop.getByLabel('Adresse', { exact: true }).fill('12 rue de la Paix');
      await shop.getByLabel('Code postal').fill('75002');
      await shop.getByLabel('Ville').fill('Paris');
      await vis(shop.locator('#shipping-methods').getByText('Livraison offerte'));
      assert.match(await text(shop.locator('#shipping-methods')), /Livraison offerte\s*Gratuit/i);
      await shop.locator('#shipping-methods label', { hasText: 'Livraison offerte' }).locator('input').check();
      await vis(shop.locator('#summary-lines').getByText(/Total\s*64,00 €/));
    });

    await step('10b local pickup: turn on at the location, offered at checkout, turn off', async () => {
      await admin.goto(`${baseUrl}/admin/settings/shipping/pickup`);
      await admin.getByText('Shop location').first().click();
      await admin.getByLabel('Pickup instructions').fill('Ask at the counter');
      await admin.getByRole('dialog').getByRole('button', { name: 'Turn on' }).click();
      await vis(admin.getByText('Usually ready in 2-4 days'));
      await shop.reload();
      await vis(shop.locator('#shipping-methods').getByText(/Pickup at Shop location/));
      await admin.getByText('Shop location').first().click();
      await admin.getByRole('dialog').getByRole('button', { name: 'Turn off' }).click();
      await vis(admin.getByText('Does not offer pickup'));
    });

    // ---------------------------------------------------------------- 11. platform: analytics, languages, backup, two-step verification
    const api = admin.request;
    const gqlApi = async (query) => (await (await api.post(`${baseUrl}/admin/api/2026-10/graphql.json`, { data: { query } })).json());
    await step('11a analytics report page and CSV export', async () => {
      await admin.goto(`${baseUrl}/admin/analytics/SALES_BY_PRODUCT?preset=THIS_YEAR`);
      await vis(admin.locator('table'));
      assert.match(await text(admin.locator('table')), /Bougie parfumée/);
      await shot('11-analytics', admin);
      const csv = await api.get(`${baseUrl}/admin/api/reports/SALES_BY_PRODUCT.csv?from=2020-01-01&to=2099-12-31`);
      assert.equal(csv.status(), 200);
      assert.match(await csv.text(), /Bougie parfumée/);
    });

    await step('11a2 analytics: overview, exploration, live view, reports list, content tabs', async () => {
      await admin.goto(`${baseUrl}/admin/analytics?preset=THIS_YEAR`);
      await vis(admin.getByText(/Last refreshed/));
      await vis(admin.getByText('Orders fulfilled'));
      await admin.getByRole('button', { name: 'Goals' }).click();
      await admin.getByRole('dialog').getByLabel('Target').fill('5000');
      await admin.getByRole('dialog').getByRole('button', { name: 'Set goal' }).click();
      await vis(admin.getByRole('dialog').getByText('Goal saved').or(admin.getByRole('dialog').getByText('5,000')));
      await admin.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).first().click();
      await vis(admin.getByRole('progressbar'));
      await admin.goto(`${baseUrl}/admin/analytics/explorations/new`);
      await vis(admin.getByRole('textbox', { name: 'Report query' }));
      await admin.getByRole('textbox', { name: 'Report query' }).fill('FROM orders SHOW orders, total_sales BY month SINCE this_year');
      await admin.getByRole('button', { name: 'Refine query' }).click();
      await vis(admin.locator('table'));
      await admin.getByRole('button', { name: 'Save', exact: true }).first().click();
      await admin.getByRole('dialog').getByLabel('Name').fill('Monthly sales');
      await admin.getByRole('dialog').getByRole('button', { name: 'Save', exact: true }).click();
      await admin.waitForURL(/\/admin\/analytics\/explorations\/\d+/);
      await admin.goto(`${baseUrl}/admin/analytics/reports`);
      await vis(admin.getByRole('link', { name: 'Monthly sales' }));
      await vis(admin.getByRole('link', { name: 'Sales by channel' }));
      await admin.getByRole('button', { name: 'Pin Monthly sales' }).click();
      await vis(admin.getByRole('button', { name: 'Unpin Monthly sales' }));
      await admin.goto(`${baseUrl}/admin/analytics/reports/SALES_OVER_TIME?preset=THIS_YEAR`);
      await admin.getByRole('button', { name: 'Controls' }).click();
      await vis(admin.getByRole('complementary', { name: 'Controls' }));
      await admin.getByRole('button', { name: 'Annotations' }).click();
      await vis(admin.getByRole('heading', { name: 'Annotations' }));
      await admin.goto(`${baseUrl}/admin/analytics/live`);
      await vis(admin.getByText('Visitors right now'));
      await shot('11a2-analytics-live', admin);
      await admin.goto(`${baseUrl}/admin/content/files`);
      await vis(admin.getByRole('link', { name: 'Metaobjects' }));
      await admin.goto(`${baseUrl}/admin/content/navigation`);
      await vis(admin.getByText('Customer account menu'));
      await admin.goto(`${baseUrl}/admin/online-store/preferences`);
      await vis(admin.getByLabel('Home page title'));
    });

    await step('11b languages: publish French, translate a product, storefront /fr', async () => {
      assert.deepEqual((await gqlApi('mutation { shopLocaleEnable(locale: "es") { userErrors { message } } }')).data.shopLocaleEnable.userErrors, []);
      assert.deepEqual((await gqlApi('mutation { shopLocaleUpdate(locale: "es", shopLocale: { published: true }) { userErrors { message } } }')).data.shopLocaleUpdate.userErrors, []);
      const first = (await gqlApi('{ translatableResources(resourceType: PRODUCT, first: 1) { nodes { resourceId translatableContent { key digest } } } }')).data.translatableResources.nodes[0];
      const digest = first.translatableContent.find((c) => c.key === 'title').digest;
      const reg = await gqlApi(`mutation { translationsRegister(resourceId: "${first.resourceId}", translations: [{ locale: "es", key: "title", value: "Vela perfumada", translatableContentDigest: "${digest}" }]) { userErrors { message } } }`);
      assert.deepEqual(reg.data.translationsRegister.userErrors, []);
      const page = await shopperCtx.request.get(`${baseUrl}/es/products/bougie-parfumee`);
      assert.equal(page.status(), 200);
      const html = await page.text();
      assert.match(html, /Vela perfumada/);
      assert.match(html, /hreflang="es"/);
      assert.match(await (await shopperCtx.request.get(`${baseUrl}/products/bougie-parfumee`)).text(), /Bougie parfumée/);
      await admin.goto(`${baseUrl}/admin/settings/languages/translate?locale=es`);
      await vis(admin.locator('main textarea, main button').first());
      assert.deepEqual((await gqlApi('mutation { shopLocaleDisable(locale: "es") { userErrors { message } } }')).data.shopLocaleDisable.userErrors, []);
    });

    await step('11c backup: export the store to a .shopme file', async () => {
      const start = await api.post(`${baseUrl}/admin/api/store/export`, { data: {} });
      assert.equal(start.status(), 202);
      const { job } = await start.json();
      let done;
      for (let i = 0; i < 100 && !done; i++) {
        const j = (await (await api.get(`${baseUrl}/admin/api/store/jobs/${job.id}`)).json()).job;
        if (j.done) done = j; else await new Promise((r) => setTimeout(r, 200));
      }
      assert.equal(done?.status, 'COMPLETED', done?.error);
      const dl = await api.get(`${baseUrl}/admin/api/store/export/${job.id}/download`);
      assert.equal(dl.status(), 200);
      const body = await dl.body();
      assert.equal(body.subarray(0, 2).toString(), 'PK');
      await admin.goto(`${baseUrl}/admin/settings/backup`);
      await vis(admin.locator('main button').first());
    });

    await step('11d two-step verification: enrol, then sign in with a code', async () => {
      const setup = await (await api.post(`${baseUrl}/admin/api/auth/2fa/setup`, { data: {} })).json();
      assert.match(setup.qrSvg, /<svg/);
      const enabled = await api.post(`${baseUrl}/admin/api/auth/2fa/enable`, { data: { code: totp(setup.secret) } });
      assert.equal(enabled.status(), 200);
      assert.equal((await enabled.json()).recoveryCodes.length, 10);
      await api.post(`${baseUrl}/admin/api/auth/logout`, { data: {} });
      await admin.goto(`${baseUrl}/admin`);
      await vis(admin.locator('input[type="password"]'));
      await admin.locator('input[type="email"]').fill(OWNER.email);
      await admin.locator('input[type="password"]').fill(OWNER.password);
      await admin.locator('button[type="submit"]').click();
      const codeInput = admin.locator('input[autocomplete="one-time-code"]');
      await vis(codeInput);
      await shot('11-two-factor-login', admin);
      await codeInput.fill(totp(setup.secret));
      await admin.locator('button[type="submit"]').click();
      await vis(admin.locator('nav').first());
      assert.equal((await api.get(`${baseUrl}/admin/api/auth/me`)).status(), 200);
      const off = await api.post(`${baseUrl}/admin/api/auth/2fa/disable`, { data: { password: OWNER.password } });
      assert.equal(off.status(), 200);
    });

    await step('12 gift card issued in admin and redeemed at checkout; wave 7a admin pages load', async () => {
      const a = await ctx.newPage();
      page = a;
      await a.goto(`${baseUrl}/admin`);
      await a.evaluate(() => localStorage.setItem('shopme.lang', 'en'));
      await a.goto(`${baseUrl}/admin/gift-cards/new`);
      await a.getByLabel('Initial value').fill('20');
      await a.getByLabel('Code', { exact: true }).fill('E2EGIFT2026');
      await a.getByRole('button', { name: 'Save', exact: true }).click();
      await vis(a.getByText('E2EG-IFT2-026'));
      await a.getByRole('button', { name: 'Close' }).first().click();
      await a.waitForURL(/\/admin\/gift-cards\/\d+/, { timeout: T });
      await vis(a.getByRole('heading', { name: /2026/ }));
      await shot('21-gift-card', a);

      await shop.locator('#gift-input').fill('e2egift2026');
      await shop.locator('[data-gift-add]').click();
      await vis(shop.locator('#summary-lines').getByText(/Carte cadeau/));
      assert.match(await text(shop.locator('#summary-lines')), /Reste à payer\s*44,00 €/);

      await a.goto(`${baseUrl}/admin/orders/abandoned`);
      await vis(a.getByRole('heading', { name: 'Abandoned checkouts' }));
      await vis(a.getByText('Recovery emails'));
      await a.goto(`${baseUrl}/admin/discounts`);
      await a.getByRole('button', { name: /Create discount/ }).click();
      await vis(a.getByRole('button', { name: /Buy X get Y/ }));
      await a.goto(`${baseUrl}/admin/orders/1/edit`);
      await vis(a.getByRole('heading', { name: /Edit order/ }));
      await vis(a.getByLabel(/^Quantity/));
      await shot('22-order-edit', a);
      await a.getByRole('button', { name: 'Back' }).click();
      await a.waitForURL(/\/admin\/orders\/1$/, { timeout: T });
    });

    await step('13a settings: add a second location', async () => {
      page = await ctx.newPage(); // the page of the mobile step is closed; the admin session cookie lives in `ctx`
      await page.goto(`${baseUrl}/admin/settings/locations`);
      await page.getByRole('button', { name: 'Add location' }).click();
      await page.getByLabel('Location name').fill('Entrepôt Lille');
      await page.getByLabel('City').fill('Lille');
      await page.getByRole('dialog').getByRole('button', { name: 'Save', exact: true }).click();
      await vis(page.getByText('Entrepôt Lille'));
      await vis(page.getByText('Active locations: 2'));
    });

    const sku = await (await shopperCtx.request.get(`${baseUrl}/products/bougie-parfumee.js`)).json();
    await step('13b custom data: definition, value in the product editor, value in the storefront', async () => {
      await page.goto(`${baseUrl}/admin/settings/metafields/PRODUCT`);
      await page.getByRole('button', { name: 'Add definition' }).click();
      await page.getByLabel('Name', { exact: true }).fill('Matière');
      await page.getByRole('dialog').getByRole('button', { name: 'Save', exact: true }).click();
      await vis(page.getByText('custom.matiere'));
      await page.goto(`${baseUrl}/admin/products/${sku.id}`);
      await page.getByText('Matière', { exact: true }).locator('xpath=..').getByRole('button', { name: 'Add' }).click();
      await page.getByLabel('Matière').fill('Cire de soja');
      await page.getByRole('button', { name: 'Save', exact: true }).click();
      await vis(page.getByText('Product saved'));
      await shop.goto(`${baseUrl}/products/bougie-parfumee`);
      assert.match(await text(shop.locator('.product__details')), /Cire de soja/);
    });

    await step('13c bulk editor: change a price', async () => {
      await page.goto(`${baseUrl}/admin/products/bulk?ids=${sku.id}`);
      const price = page.getByLabel(/^Price Bougie.*Vanille \/ S/);
      await vis(price);
      await price.fill('19.50');
      await page.getByRole('button', { name: 'Save', exact: true }).click();
      await vis(page.getByText('1 variants updated'));
      const after = await (await shopperCtx.request.get(`${baseUrl}/products/bougie-parfumee.js`)).json();
      assert.equal(after.variants.find((v) => v.title === 'Vanille / S').price, 1950);
    });

    await step('13d storefront: predictive search', async () => {
      await shop.goto(baseUrl);
      await shop.locator('[data-search-toggle]').click();
      await shop.locator('#predictive-search-q').fill('bougi');
      await vis(shop.locator('[data-predictive-results] a', { hasText: /Bougie/ }));
    });

    await shopperCtx.close();
    await ctx.close();
    assert.deepEqual(pageErrors, [], 'uncaught page errors');
    assert.deepEqual(serverErrors, [], '5xx or GraphQL errors during the journey');
  } finally {
    await browser.close();
  }
}
