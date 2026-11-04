#!/usr/bin/env node
// Capture storefront behaviour of an authorized Shopify dev store:
// HAR, screenshots and raw Ajax API exchanges. Output stays OUTSIDE the repo.
//
// Env: ENV_FILE (default <repo>/.env, KEY=VALUE), SHOPIFY_SHOP (name or name.myshopify.com),
//      SHOPIFY_STOREFRONT_PASSWORD, RE_OUT (default $HOME/shoppen-re).
// Never submits payment or places an order.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
let pw;
try { pw = require('playwright'); } catch {
  pw = require(path.join(execSync('npm root -g').toString().trim(), 'playwright'));
}
const { chromium, devices } = pw;

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const envFile = process.env.ENV_FILE || path.join(repo, '.env');
const env = { ...process.env };
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m && !line.trim().startsWith('#')) env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
}
const shop = (env.SHOPIFY_SHOP || '').replace(/^https?:\/\//, '').replace(/\.myshopify\.com\/?$/, '');
const password = env.SHOPIFY_STOREFRONT_PASSWORD || '';
if (!shop) { console.error('SHOPIFY_SHOP missing'); process.exit(1); }
const out = path.resolve(env.RE_OUT || path.join(os.homedir(), 'shoppen-re'));
if (out === repo || out.startsWith(repo + path.sep)) { console.error('RE_OUT must not be inside the repo'); process.exit(1); }

const BASE = `https://${shop}.myshopify.com`;
const shotDir = path.join(out, 'screenshots/storefront');
const ajaxDir = path.join(out, 'raw/storefront/ajax');
const harPath = path.join(out, 'har/storefront.har');
for (const d of [shotDir, ajaxDir, path.dirname(harPath)]) fs.mkdirSync(d, { recursive: true });
for (const f of fs.readdirSync(ajaxDir)) if (/^\d\d-.*\.json$/.test(f)) fs.unlinkSync(path.join(ajaxDir, f));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const summary = { screenshots: [], ajax: [], errors: [] };

async function unlock(page) {
  for (let attempt = 1; attempt <= 6; attempt++) {
    const resp = await page.goto(`${BASE}/password`, { waitUntil: 'domcontentloaded' });
    const input = page.locator('input[type=password]').first();
    if (!(await input.count())) {
      // No password form: either unlocked already or the store is not password protected, or we hit a challenge page.
      if (resp && resp.status() === 429) { await sleep(30000 * attempt); continue; }
      return;
    }
    await input.fill(password);
    await Promise.all([page.waitForLoadState('domcontentloaded').catch(() => {}), input.press('Enter')]);
    await sleep(2000);
    const probe = await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
    if (probe && probe.status() === 200 && !new URL(page.url()).pathname.startsWith('/password')) return;
    console.error(`unlock attempt ${attempt} failed (status ${probe && probe.status()}), backing off`);
    await sleep(30000 * attempt);
  }
  throw new Error('could not unlock storefront');
}

async function shot(page, name, url, { action } = {}) {
  try {
    if (url) await page.goto(BASE + url, { waitUntil: 'load', timeout: 45000 });
    await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
    if (action) await action();
    const file = path.join(shotDir, `${name}.png`);
    await page.screenshot({ path: file, fullPage: true });
    summary.screenshots.push(path.relative(out, file));
  } catch (e) { summary.errors.push(`shot ${name}: ${e.message.split('\n')[0]}`); }
}

async function runSet(browser, label, contextOpts, doAjax) {
  const ctx = await browser.newContext({
    ...contextOpts, deviceScaleFactor: 1,
    ...(doAjax ? { recordHar: { path: harPath + '.raw', content: 'embed' } } : {}),
  });
  const page = await ctx.newPage();
  await unlock(page);
  if (doAjax) await ajaxSuite(page);
  const p = (n) => `${label}-${n}`;
  const firstCollection = await page.evaluate(async () => {
    const r = await fetch('/collections.json'); try { return (await r.json()).collections?.[0]?.handle; } catch { return null; }
  }).catch(() => null);

  await shot(page, p('home'), '/');
  await shot(page, p('collections-all'), '/collections/all');
  const coll = firstCollection && firstCollection !== 'all' ? firstCollection : 'snowboards';
  await shot(page, p('collection'), `/collections/${coll}`);
  await shot(page, p('product-variants'), '/products/the-complete-snowboard');
  await shot(page, p('product-out-of-stock'), '/products/the-out-of-stock-snowboard');
  await shot(page, p('search'), '/search?q=snowboard');

  // add to cart through the UI
  await page.goto(`${BASE}/products/the-complete-snowboard`, { waitUntil: 'load' });
  try {
    const btn = page.locator('button[name=add], form[action*="/cart/add"] [type=submit], add-to-cart-component button').first();
    await btn.click({ timeout: 8000 });
    await sleep(2500);
    await shot(page, p('cart-drawer-or-after-add'));
  } catch (e) { summary.errors.push(`ui add: ${e.message.split('\n')[0]}`); }
  await shot(page, p('cart-page'), '/cart');

  // checkout: capture only, never submit
  try {
    await page.goto(`${BASE}/checkout`, { waitUntil: 'load', timeout: 45000 });
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    await sleep(2000);
    await shot(page, p('checkout-contact-shipping'));
    const full = path.join(shotDir, p('checkout-payment') + '.png');
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await sleep(1000);
    await page.screenshot({ path: full, fullPage: true });
    summary.screenshots.push(path.relative(out, full));
  } catch (e) { summary.errors.push(`checkout: ${e.message.split('\n')[0]}`); }

  await shot(page, p('account-login'), '/account/login');
  await shot(page, p('404'), '/this-page-does-not-exist-404');

  if (doAjax) { // cookie names and attributes only, never values
    const cookies = (await ctx.cookies()).map((c) => ({ name: c.name, path: c.path, httpOnly: c.httpOnly, secure: c.secure, sameSite: c.sameSite, session: c.expires === -1 }));
    fs.writeFileSync(path.join(out, 'raw/storefront/cookies.json'), JSON.stringify(cookies, null, 2));
  }
  await ctx.close(); // flushes HAR
}

const KEEP_HEADERS = ['content-type', 'cache-control', 'content-language', 'vary', 'content-length', 'location', 'retry-after', 'x-request-id-present'];
let seq = 0;
const THROTTLE_MS = Number(env.RE_THROTTLE_MS || 1500);
async function call(page, name, method, urlPath, opts = {}) {
  let res;
  for (let attempt = 0; attempt < 8; attempt++) {
    await sleep(THROTTLE_MS);
    res = await rawCall(page, method, urlPath, opts);
    if (res.status !== 429) break;
    const wait = Math.min(Number(res.headers['retry-after']) || 0, 120) * 1000 || Math.min(20000 * (attempt + 1), 150000);
    console.error(`429 on ${name}, backing off ${wait / 1000}s`);
    await sleep(wait);
  }
  return record(name, method, urlPath, opts, res);
}
async function rawCall(page, method, urlPath, opts) {
  return page.evaluate(async ({ method, urlPath, opts }) => {
    const headers = { ...(opts.headers || {}) };
    let body;
    if (opts.json !== undefined) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(opts.json); }
    else if (opts.form !== undefined) { headers['Content-Type'] = 'application/x-www-form-urlencoded'; body = opts.form; }
    const r = await fetch(urlPath, { method, headers, body, credentials: 'same-origin' });
    const text = await r.text();
    const h = {}; r.headers.forEach((v, k) => { h[k] = v; });
    return { status: r.status, statusText: r.statusText, headers: h, text, redirected: r.redirected, finalUrl: r.url };
  }, { method, urlPath, opts });
}
function record(name, method, urlPath, opts, res) {
  let json = null; try { json = JSON.parse(res.text); } catch {}
  const headers = {};
  for (const k of KEEP_HEADERS) if (res.headers[k]) headers[k] = res.headers[k];
  const rec = {
    name, request: { method, url: urlPath, contentType: opts.json !== undefined ? 'application/json' : opts.form !== undefined ? 'application/x-www-form-urlencoded' : null,
      body: opts.json !== undefined ? opts.json : opts.form ?? null },
    response: { status: res.status, statusText: res.statusText, redirected: res.redirected, finalPath: res.finalUrl.replace(BASE, ''), headers, json, text: json === null ? res.text.slice(0, 4000) : undefined },
  };
  const file = path.join(ajaxDir, `${String(++seq).padStart(2, '0')}-${name}.json`);
  fs.writeFileSync(file, JSON.stringify(rec, null, 2));
  summary.ajax.push({ file: path.basename(file), status: res.status });
  return rec.response;
}

async function ajaxSuite(page) {
  await page.goto(`${BASE}/`, { waitUntil: 'load' });
  const prod = (await call(page, 'product-js', 'GET', '/products/the-complete-snowboard.js')).json;
  await call(page, 'product-json', 'GET', '/products/the-complete-snowboard.json');
  const oos = (await call(page, 'product-oos-js', 'GET', '/products/the-out-of-stock-snowboard.js')).json;
  const vA = prod.variants[0], vB = prod.variants[1] || prod.variants[0];
  const oosVar = oos.variants.find((v) => !v.available) || oos.variants[0];

  await call(page, 'cart-clear-initial', 'POST', '/cart/clear.js', { json: {} });
  await call(page, 'cart-get-empty', 'GET', '/cart.js');
  await call(page, 'cart-add-json', 'POST', '/cart/add.js', { json: { items: [{ id: vA.id, quantity: 1 }] } });
  await call(page, 'cart-get-after-add-json', 'GET', '/cart.js');
  await call(page, 'cart-add-form', 'POST', '/cart/add.js', { form: `id=${vA.id}&quantity=1&properties[gift]=yes` });
  await call(page, 'cart-add-single-json', 'POST', '/cart/add.js', { json: { id: vA.id, quantity: 1 } });
  await call(page, 'cart-add-two-items', 'POST', '/cart/add.js', { json: { items: [{ id: vA.id, quantity: 1, properties: { engraving: 'x' } }, { id: vB.id, quantity: 2 }] } });
  await call(page, 'cart-get-after-add-multi', 'GET', '/cart.js');
  await call(page, 'cart-change-by-line', 'POST', '/cart/change.js', { json: { line: 1, quantity: 3 } });
  await call(page, 'cart-get-after-change-line', 'GET', '/cart.js');
  const key = (await call(page, 'cart-get-for-key', 'GET', '/cart.js')).json.items[0].key;
  await call(page, 'cart-change-by-key', 'POST', '/cart/change.js', { json: { id: key, quantity: 2 } });
  await call(page, 'cart-change-by-variant-id', 'POST', '/cart/change.js', { json: { id: String(vA.id), quantity: 2 } });
  await call(page, 'cart-change-form', 'POST', '/cart/change.js', { form: 'line=1&quantity=1' });
  await call(page, 'cart-change-bad-line', 'POST', '/cart/change.js', { json: { line: 99, quantity: 1 } });
  await call(page, 'cart-change-properties', 'POST', '/cart/change.js', { json: { line: 1, properties: { note: 'hi' } } });
  await call(page, 'cart-update-array', 'POST', '/cart/update.js', { json: { updates: [2, 1, 0, 0].slice(0, (await call(page, 'cart-get-count', 'GET', '/cart.js')).json.items.length) } });
  await call(page, 'cart-get-before-update-map', 'GET', '/cart.js');
  await call(page, 'cart-update-map', 'POST', '/cart/update.js', { json: { updates: { [vA.id]: 2 } } });
  await call(page, 'cart-update-note-attributes', 'POST', '/cart/update.js', { json: { note: 'Please gift wrap', attributes: { gift: 'true', color: 'red' } } });
  await call(page, 'cart-update-form', 'POST', '/cart/update.js', { form: `updates[${vA.id}]=1&note=form+note&attributes[k]=v` });
  await call(page, 'cart-update-unknown-variant', 'POST', '/cart/update.js', { json: { updates: { 1: 1 } } });
  await call(page, 'cart-get-after-updates', 'GET', '/cart.js');
  await call(page, 'cart-update-attribute-remove', 'POST', '/cart/update.js', { json: { attributes: { gift: '' } } });
  await call(page, 'cart-add-sections-json', 'POST', '/cart/add.js', { json: { items: [{ id: vA.id, quantity: 1 }], sections: 'cart-icon-bubble,cart-drawer', sections_url: '/cart' } });
  await call(page, 'cart-add-sections-form', 'POST', '/cart/add.js', { form: `id=${vA.id}&quantity=1&sections=header&sections_url=/` });
  await call(page, 'cart-add-sections-query', 'POST', '/cart/add.js?sections=header', { json: { items: [{ id: vA.id, quantity: 1 }] } });
  await call(page, 'cart-update-sections', 'POST', '/cart/update.js', { json: { updates: { [vA.id]: 1 }, sections: 'header' } });
  await call(page, 'cart-change-sections', 'POST', '/cart/change.js', { json: { line: 1, quantity: 1, sections: 'header' } });
  await call(page, 'sections-render-get', 'GET', '/?sections=header,footer');
  await call(page, 'sections-render-cart', 'GET', '/cart?sections=header');
  await call(page, 'cart-get-with-sections', 'GET', '/cart.js?sections=header');
  await call(page, 'cart-get-final', 'GET', '/cart.js');
  await call(page, 'cart-clear', 'POST', '/cart/clear.js', { json: {} });
  await call(page, 'cart-get-after-clear', 'GET', '/cart.js');
  await call(page, 'cart-clear-get-method', 'GET', '/cart/clear.js');
  await call(page, 'cart-add-get-method', 'GET', `/cart/add.js?id=${vA.id}&quantity=1`);
  await call(page, 'cart-clear-after-get-add', 'POST', '/cart/clear.js', { json: {} });

  await call(page, 'collection-all-products-json', 'GET', '/collections/all/products.json');
  await call(page, 'collection-all-products-json-paged', 'GET', '/collections/all/products.json?limit=2&page=2');
  await call(page, 'products-json', 'GET', '/products.json?limit=2');
  await call(page, 'collections-json', 'GET', '/collections.json');
  await call(page, 'product-js-404', 'GET', '/products/does-not-exist.js');
  await call(page, 'product-json-404', 'GET', '/products/does-not-exist.json');
  await call(page, 'product-js-variant-qs', 'GET', `/products/the-complete-snowboard.js?variant=${vB.id}`);
  await call(page, 'search-suggest', 'GET', '/search/suggest.json?q=snow&resources[type]=product');
  await call(page, 'search-suggest-multi', 'GET', '/search/suggest.json?q=snow&resources[type]=product,collection,page,article&resources[limit]=3');
  await call(page, 'search-suggest-sections', 'GET', '/search/suggest?q=snow&section_id=predictive-search');
  await call(page, 'search-json', 'GET', '/search.json?q=snowboard');
  await call(page, 'recommendations-products', 'GET', `/recommendations/products.json?product_id=${prod.id}&limit=4`);
  await call(page, 'recommendations-products-intent', 'GET', `/recommendations/products.json?product_id=${prod.id}&limit=4&intent=related`);
  await call(page, 'recommendations-products-html', 'GET', `/recommendations/products?product_id=${prod.id}&limit=4&section_id=product-recommendations`);
  await call(page, 'shop-js-policies', 'GET', '/policies/refund-policy');
  await call(page, 'locale-json', 'GET', '/localization.json');
  await call(page, 'cart-js-trailing', 'GET', '/cart.json');
  await call(page, 'meta-js', 'GET', '/meta.json');
  // error-shaped adds last: failed adds trigger the storefront rate limiter fastest
  await call(page, 'cart-add-oos', 'POST', '/cart/add.js', { json: { items: [{ id: oosVar.id, quantity: 1 }] } });
  await call(page, 'cart-add-oos-single', 'POST', '/cart/add.js', { json: { id: oosVar.id, quantity: 1 } });
  await call(page, 'cart-add-over-stock', 'POST', '/cart/add.js', { json: { items: [{ id: vA.id, quantity: 999999 }] } });
  await call(page, 'cart-add-over-stock-form', 'POST', '/cart/add.js', { form: `id=${vA.id}&quantity=999999` });
  await call(page, 'cart-add-unknown-variant', 'POST', '/cart/add.js', { json: { items: [{ id: 1, quantity: 1 }] } });
  await call(page, 'cart-add-zero-qty', 'POST', '/cart/add.js', { json: { items: [{ id: vA.id, quantity: 0 }] } });
  await call(page, 'cart-add-no-body', 'POST', '/cart/add.js', { json: {} });
}

function scrubHar() {
  const raw = harPath + '.raw';
  if (!fs.existsSync(raw)) return 0;
  const har = JSON.parse(fs.readFileSync(raw, 'utf8'));
  const SENSITIVE = /^(cookie|set-cookie|authorization|proxy-authorization|x-shopify-.*|x-csrf-token|x-sorting-hat-.*)$/i;
  const tokenish = /(token|key|secret|session|csrf|auth)/i;
  let n = 0;
  const scrubHeaders = (hs) => hs.forEach((h) => { if (SENSITIVE.test(h.name) && !/^x-shopify-(stage|shop-?id|request-id|storefront.*)$/i.test('')) { h.value = '[scrubbed]'; n++; } });
  for (const e of har.log.entries) {
    scrubHeaders(e.request.headers); scrubHeaders(e.response.headers);
    e.request.cookies = []; e.response.cookies = [];
    e.request.queryString = (e.request.queryString || []).map((q) => (tokenish.test(q.name) ? { ...q, value: '[scrubbed]' } : q));
    if (/\/password(\?|$)/.test(e.request.url) && e.request.postData) e.request.postData = { mimeType: e.request.postData.mimeType, text: '[scrubbed]', params: [] };
    if (e.request.postData?.params) e.request.postData.params = e.request.postData.params.map((p) => (/password|token|authenticity/i.test(p.name) ? { ...p, value: '[scrubbed]' } : p));
    if (e.request.postData?.text && /password=|authenticity_token/.test(e.request.postData.text)) e.request.postData.text = e.request.postData.text.replace(/((?:password|authenticity_token)=)[^&]*/g, '$1[scrubbed]');
  }
  let text = JSON.stringify(har);
  if (password) text = text.split(password).join('[scrubbed]').split(encodeURIComponent(password)).join('[scrubbed]');
  fs.writeFileSync(harPath, text);
  fs.unlinkSync(raw);
  return har.log.entries.length;
}

const browser = await chromium.launch();
try {
  await runSet(browser, 'desktop', { viewport: { width: 1440, height: 900 } }, true);
  await runSet(browser, 'mobile', { ...devices['iPhone 13'] }, false);
} finally {
  await browser.close();
}
const entries = scrubHar();
console.log(`HAR entries: ${entries} -> ${harPath}`);
console.log(`screenshots: ${summary.screenshots.length} in ${shotDir}`);
const bad = summary.ajax.filter((a) => a.status >= 400).length;
console.log(`ajax captures: ${summary.ajax.length} (${bad} with status>=400) in ${ajaxDir}`);
if (summary.errors.length) console.log('errors:\n  ' + summary.errors.join('\n  '));
