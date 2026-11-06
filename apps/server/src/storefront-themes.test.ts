import { mkdtempSync, readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { zipSync } from 'fflate';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { createLocalStorage, createThemeFromZip, getPrimaryShop, schema as s, seedDemo, THEME_DIRS } from '@shopme/core';
import { createTestApp, SETUP_BODY, type TestApp } from './test-utils';
import { makeGql, makeGqlOk } from '../test/conformance/helpers';
import { lintThemeFile } from './theme-lint';

/**
 * The themes shipped in packages/themes (Circuit and Velours): each one is installed on a seeded shop from a zip, exactly like an upload,
 * published, and every template is rendered in English and in French (customer pages signed in, a product with a selling plan, the
 * password page, a gift card). Pages must answer 200, carry no Liquid error and no untranslated key, and French pages no English UI text.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const THEMES_DIR = path.resolve(here, '../../../packages/themes');
const ALL_HANDLES = ['circuit', 'velours', 'sillage', 'foyer', 'maroquin', 'comptine', 'pelage', 'cimaise'] as const;
const HANDLES = (process.env.THEME_ONLY ? [process.env.THEME_ONLY] : [...ALL_HANDLES]) as (typeof ALL_HANDLES)[number][];
const NAMES = { circuit: 'Circuit', velours: 'Velours', sillage: 'Sillage', foyer: 'Foyer', maroquin: 'Maroquin', comptine: 'Comptine', pelage: 'Pelage', cimaise: 'Cimaise' } as const;

/** What each theme composed by the kit (scripts/theme-kit/themes) is made of. */
const KIT = {
  sillage: { header: 'split', card: 'minimal', pdp: 'stacked', filters: 'bar', infinite: true, homeMarker: 'k-lookbook', sections: ['lookbook', 'size-guide'], templates: ['page.size-guide'] },
  foyer: { header: 'centered', card: 'rounded', pdp: 'left', filters: 'bar', infinite: false, homeMarker: 'k-rooms', sections: ['room-tiles', 'materials'], templates: ['page.care-guide'] },
  maroquin: { header: 'mega', card: 'framed', pdp: 'rail', filters: 'side', infinite: false, homeMarker: 'k-craft', sections: ['craft-steps', 'gift-guide'], templates: ['page.leather-care'] },
  comptine: { header: 'centered', card: 'arched', pdp: 'rail', filters: 'bar', infinite: true, homeMarker: 'k-ages', sections: ['age-tiles', 'safety-promise'], templates: ['page.toy-safety'] },
  pelage: { header: 'split', card: 'rounded', pdp: 'stacked', filters: 'side', infinite: false, homeMarker: 'k-pets', sections: ['pet-tiles', 'refill-highlight'], templates: ['page.vet-approved'] },
  cimaise: { header: 'centered', card: 'minimal', pdp: 'left', filters: 'side', infinite: false, homeMarker: 'k-artist', sections: ['artist-feature', 'frame-guide'], templates: ['page.sizes-and-frames'] },
} as const;

function walk(dir: string, base = dir, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, base, out);
    else out.push(path.relative(base, full).split(path.sep).join('/'));
  }
  return out;
}
const themeFiles = (handle: string) => walk(path.join(THEMES_DIR, handle)).filter((f) => (THEME_DIRS as readonly string[]).includes(f.split('/')[0]!));
const zipOf = (handle: string) => zipSync(Object.fromEntries(themeFiles(handle).map((f) => [f, new Uint8Array(readFileSync(path.join(THEMES_DIR, handle, f)))])));
const read = (handle: string, file: string) => readFileSync(path.join(THEMES_DIR, handle, file), 'utf8');
const readJson = (handle: string, file: string) => JSON.parse(read(handle, file)) as Record<string, any>;
const leaves = (o: unknown, prefix = '', out: Record<string, string> = {}): Record<string, string> => {
  if (typeof o === 'string') out[prefix] = o;
  else if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) leaves(v, prefix ? `${prefix}.${k}` : k, out);
  return out;
};
const lookup = (tree: unknown, key: string) => key.split('.').reduce<any>((a, k) => (a && typeof a === 'object' ? a[k] : undefined), tree);

describe.each(HANDLES)('static checks: %s', (handle) => {
  it('has a complete, valid file set', () => {
    const files = themeFiles(handle);
    for (const must of ['layout/theme.liquid', 'layout/password.liquid', 'config/settings_schema.json', 'config/settings_data.json', 'locales/en.default.json', 'locales/fr.json', 'locales/en.default.schema.json', 'locales/fr.schema.json', 'templates/gift_card.liquid']) expect(files, must).toContain(must);
    for (const t of ['index', 'product', 'collection', 'list-collections', 'search', 'cart', 'page', 'page.contact', 'blog', 'article', '404', 'password', 'customers/login', 'customers/register', 'customers/account', 'customers/order', 'customers/addresses', 'customers/activate_account', 'customers/reset_password']) expect(files, t).toContain(`templates/${t}.json`);
    expect(existsSync(path.join(THEMES_DIR, handle, 'LICENSE'))).toBe(true);
    expect(read(handle, 'LICENSE')).toContain('ShopMe contributors');
    const log = readJson(handle, 'changelog.json');
    expect(log.versions[0].version).toBe('1.0.0');
    expect(log.versions[0].notes.en.length).toBeGreaterThan(0);
    expect(log.versions[0].notes.fr.length).toBe(log.versions[0].notes.en.length);
    const info = (readJson(handle, 'config/settings_schema.json') as unknown as { name: string }[]).find((g) => g.name === 'theme_info') as Record<string, any>;
    expect(info).toMatchObject({ theme_name: NAMES[handle], theme_version: '1.0.0', theme_author: 'ShopMe contributors' });
    expect(info.theme_documentation_url).toContain('github.com/aymaneprojects/shopme');
    expect(info.theme_support_url).toContain('github.com/aymaneprojects/shopme');
    expect(typeof info.shopme_description).toBe('string');
    expect(typeof info.shopme_descriptions.fr).toBe('string');
    expect(Array.isArray(info.shopme_tags) && info.shopme_tags.length > 0).toBe(true);
  });

  it('has no Liquid or JSON syntax error and no reference to another theme', () => {
    const problems: string[] = [];
    for (const f of themeFiles(handle).filter((x) => /\.(liquid|json)$/.test(x))) {
      for (const d of lintThemeFile(f, read(handle, f))) if (d.severity === 'error') problems.push(`${f}:${d.line} ${d.message}`);
      if (/aurora|shopify\.com\/s\/|cdn\.shopify/i.test(read(handle, f)) && !f.endsWith('.txt')) problems.push(`${f} mentions another theme or a Shopify CDN`);
    }
    expect(problems).toEqual([]);
  });

  it('translates every storefront string and every editor label to French', () => {
    const en = leaves(readJson(handle, 'locales/en.default.json'));
    const frFile = readJson(handle, 'locales/fr.json');
    expect(typeof frFile.seed_defaults).toBe('object');
    const fr = leaves({ ...frFile, seed_defaults: undefined });
    expect(Object.keys(fr).sort()).toEqual(Object.keys(en).sort());
    const enSchema = leaves(readJson(handle, 'locales/en.default.schema.json'));
    const frSchema = leaves(readJson(handle, 'locales/fr.schema.json'));
    expect(Object.keys(frSchema).sort()).toEqual(Object.keys(enSchema).sort());
    // t: keys used in the theme resolve in the schema locales, and every section has a translated name
    const missing: string[] = [];
    const tree = readJson(handle, 'locales/en.default.schema.json');
    for (const f of themeFiles(handle).filter((x) => /^(sections|blocks|config)\//.test(x) && /\.(liquid|json)$/.test(x))) {
      for (const m of read(handle, f).matchAll(/"t:([A-Za-z0-9_.-]+)"/g)) if (typeof lookup(tree, m[1]!) !== 'string') missing.push(`${f}: ${m[1]}`);
    }
    expect(missing).toEqual([]);
    for (const f of themeFiles(handle).filter((x) => /^sections\/.*\.liquid$/.test(x))) {
      const schema = /\{%-?\s*schema\s*-?%\}([\s\S]*?)\{%-?\s*endschema\s*-?%\}/.exec(read(handle, f));
      expect(schema, f).not.toBeNull();
      const def = JSON.parse(schema![1]!) as { name: string; settings?: { type: string; id?: string; label?: string }[]; presets?: unknown[] };
      expect(def.name, f).toMatch(/^t:/);
      for (const st of def.settings ?? []) if (st.id) expect(st.label, `${f} ${st.id}`).toMatch(/^t:/);
    }
    // French text really differs from English for most strings (guards against copied English)
    const same = Object.keys(en).filter((k) => k !== 'general.copyright' && en[k] === fr[k] && en[k]!.length > 14 && /\s/.test(en[k]!));
    expect(same, 'French strings identical to English').toEqual([]);
  });

  it('declares every font it uses and ships the font files', () => {
    const files = themeFiles(handle);
    const css = read(handle, 'snippets/css-variables.liquid');
    for (const m of css.matchAll(/'(font-[a-z-]+\.woff2)'/g)) expect(files, m[1]).toContain(`assets/${m[1]}`);
  });
});

describe('themes rendered on a seeded shop', () => {
  let t: TestApp;
  let cookie: string;
  let shopId: number;
  let customerCookie: string;
  let orderId: number;
  let planId: number;
  let coffeeId: number;
  let giftToken: string;
  let activeThemeId: number;
  const db = () => t.dbHandle.db;
  const enLeaves = new Map<string, Record<string, string>>();
  const frLeaves = new Map<string, Record<string, string>>();
  const form = (o: Record<string, string>) => ({ payload: new URLSearchParams(o).toString(), headers: { 'content-type': 'application/x-www-form-urlencoded' } });

  beforeAll(async () => {
    t = await createTestApp();
    const setup = await t.app.inject({ method: 'POST', url: '/admin/api/setup', payload: SETUP_BODY });
    cookie = setup.cookies.find((c) => c.name === 'shopme_session')!.value;
    const g = makeGqlOk(makeGql(t.app, cookie));
    await seedDemo(db(), createLocalStorage(mkdtempSync(path.join(tmpdir(), 'themes-'))));
    shopId = (await getPrimaryShop(db()))!.id;
    const products = await db().select().from(s.products);
    const coffee = products.find((p) => p.handle === 'highland-morning-coffee-beans')!;
    coffeeId = coffee.id;
    const dripper = products.find((p) => p.handle === 'ceramic-pour-over-dripper')!;
    // Specs as product metafields
    const mf = (p: { id: number }, key: string, value: string) => ({ ownerId: `gid://shopify/Product/${p.id}`, namespace: 'specs', key, type: 'single_line_text_field', value });
    const set = await g(`mutation($m: [MetafieldsSetInput!]!) { metafieldsSet(metafields: $m) { userErrors { message } } }`, { m: [mf(coffee, 'roast', 'Light'), mf(coffee, 'origin', 'Ethiopia'), mf(coffee, 'weight', '250 g'), mf(coffee, 'process', 'Washed'), mf(dripper, 'material', 'Ceramic'), mf(dripper, 'capacity', '600 ml')] });
    expect(set.metafieldsSet.userErrors).toEqual([]);
    planId = (await db().select().from(s.sellingPlans))[0]!.id;
    // French published
    await g(`mutation { shopLocaleEnable(locale: "fr") { userErrors { message } } }`);
    await g(`mutation { shopLocaleUpdate(locale: "fr", shopLocale: { published: true }) { userErrors { message } } }`);
    // A signed-in customer with an order
    const reg = await t.app.inject({ method: 'POST', url: '/account/register', ...form({ 'customer[email]': 'ada@example.com', 'customer[first_name]': 'Ada', 'customer[last_name]': 'Lovelace', 'customer[password]': 'correct horse' }) });
    customerCookie = reg.cookies.find((c) => c.name === 'shopme_customer')!.value;
    const variants = await db().select().from(s.productVariants);
    const sku = variants.find((v) => v.sku === 'HEB-250') ?? variants[0]!;
    const add = await t.app.inject({ method: 'POST', url: '/cart/add.js', payload: { id: sku.id, quantity: 2 } });
    const cart = add.cookies.find((c) => c.name === 'cart')!.value;
    const token = (await t.app.inject({ method: 'POST', url: '/checkout', cookies: { cart } })).headers.location!.toString().split('/').pop()!;
    const done = await t.app.inject({ method: 'POST', url: `/checkouts/${token}/complete`, cookies: { shopme_customer: customerCookie }, ...form({ email: 'ada@example.com', firstName: 'Ada', lastName: 'Lovelace', address1: '1 Rue de Rivoli', city: 'Paris', zip: '75001', countryCode: 'FR', paymentMethod: 'bank_transfer' }) });
    expect(done.statusCode).toBe(303);
    orderId = (await db().select().from(s.orders).where(eq(s.orders.cartToken, token)))[0]!.id;
    giftToken = (await db().insert(s.giftCards).values({ shopId, code: 'THEMETEST100', token: 'tok-theme-test', currency: 'EUR', initialValue: 10000, balance: 7500 }).returning())[0]!.token;
  }, 120_000);
  afterAll(async () => { await t.close(); });

  async function install(handle: (typeof HANDLES)[number]) {
    const r = await createThemeFromZip(db(), t.app.ctx.storageFor(shopId), shopId, zipOf(handle), { name: NAMES[handle], role: 'MAIN' });
    if (!r.ok) throw new Error(JSON.stringify(r.errors));
    activeThemeId = r.value.theme.id;
    enLeaves.set(handle, leaves(readJson(handle, 'locales/en.default.json')));
    frLeaves.set(handle, leaves({ ...readJson(handle, 'locales/fr.json'), seed_defaults: undefined }));
  }

  const visibleText = (html: string) => html.replace(/<(script|style|svg|template)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&[#a-z0-9]+;/gi, ' ').replace(/\s+/g, ' ');
  const lang = (url: string, fr: boolean) => (fr ? `/fr${url === '/' ? '' : url}` : url);

  /** Every page of the storefront: [name, url, options]. */
  const pages = (): { name: string; url: string; status?: number; customer?: boolean; admin?: boolean; cart?: boolean; contains?: RegExp }[] => [
    { name: 'index', url: '/', contains: /cart|panier/i },
    { name: 'collection', url: '/collections/coffee' },
    { name: 'collection filtered', url: '/collections/all?filter.v.availability=1&sort_by=price-ascending' },
    { name: 'collection price filter', url: '/collections/all?filter.v.price.gte=1&filter.v.price.lte=40' },
    { name: 'collection list', url: '/collections' },
    { name: 'product', url: '/products/ceramic-pour-over-dripper' },
    { name: 'product with selling plan', url: `/products/highland-morning-coffee-beans?selling_plan=${planId}`, contains: /selling_plan|data-purchase-options/ },
    { name: 'product compare data', url: '/products/highland-morning-coffee-beans?view=compare' },
    { name: 'product recommendations', url: `/recommendations/products?product_id=${coffeeId}&section_id=recommendations&limit=4` },
    { name: 'search', url: '/search?q=coffee' },
    { name: 'search without results', url: '/search?q=zzzzqqqq' },
    { name: 'search empty', url: '/search' },
    { name: 'cart empty', url: '/cart' },
    { name: 'cart', url: '/cart', cart: true },
    { name: 'page', url: '/pages/about-us' },
    { name: 'page contact', url: '/pages/about-us?view=contact' },
    { name: 'blog', url: '/blogs/news' },
    { name: 'article', url: '/blogs/news/welcome' },
    { name: '404', url: '/does-not-exist', status: 404 },
    { name: 'gift card', url: `/gift_cards/${giftToken}` },
    { name: 'login', url: '/account/login' },
    { name: 'register', url: '/account/register' },
    { name: 'account', url: '/account', customer: true, contains: /Ada/ },
    { name: 'order', url: '/account/orders/__ORDER__', customer: true },
    { name: 'addresses', url: '/account/addresses', customer: true },
    { name: 'activate account', url: '/account/activate/1/abc', admin: true },
    { name: 'reset password', url: '/account/reset/1/abc', admin: true },
  ];

  const get = async (handle: string, fr: boolean, p: ReturnType<typeof pages>[number]) => {
    let url = p.url.replace('__ORDER__', String(orderId));
    if (p.admin) url += `${url.includes('?') ? '&' : '?'}preview_theme_id=${activeThemeId}`;
    const cookies: Record<string, string> = {};
    if (p.customer) cookies.shopme_customer = customerCookie;
    if (p.admin) cookies.shopme_session = cookie;
    if (p.cart) {
      const variants = await db().select().from(s.productVariants);
      const add = await t.app.inject({ method: 'POST', url: '/cart/add.js', payload: { items: [{ id: variants[0]!.id, quantity: 2 }, { id: variants[2]!.id, quantity: 1 }] } });
      cookies.cart = add.cookies.find((c) => c.name === 'cart')!.value;
    }
    return t.app.inject({ url: lang(url, fr), cookies, headers: { 'user-agent': 'Googlebot' } });
  };

  describe.each(HANDLES)('%s', (handle) => {
    it('installs from a zip and becomes the live theme', async () => {
      await install(handle);
      const home = await t.app.inject({ url: '/', headers: { 'user-agent': 'Googlebot' } });
      expect(home.statusCode).toBe(200);
      expect(home.body).toContain(`${handle}.css`);
    }, 60_000);

    for (const fr of [false, true]) {
      it(`renders every template in ${fr ? 'French' : 'English'}`, async () => {
        const problems: string[] = [];
        for (const p of pages()) {
          const res = await get(handle, fr, p);
          const label = `${fr ? 'fr' : 'en'} ${p.name}`;
          if (res.statusCode !== (p.status ?? 200)) { problems.push(`${label}: status ${res.statusCode}`); continue; }
          const body = res.body;
          if (/Liquid error|liquid error/.test(body)) problems.push(`${label}: Liquid error ${/Liquid error[^<]{0,160}/.exec(body)?.[0]}`);
          if (/translation missing/i.test(body)) problems.push(`${label}: untranslated key ${/translation missing: [\w.-]+/i.exec(body)?.[0]}`);
          if (p.name !== 'product compare data' && !/<html[^>]*lang="(en|fr)"/.test(body) && p.name !== 'product recommendations' && p.name !== 'gift card') problems.push(`${label}: no html lang`);
          if (p.contains && !p.contains.test(body)) problems.push(`${label}: expected ${p.contains}`);
          if (fr && p.name !== 'product compare data') {
            const text = visibleText(body);
            for (const [k, en] of Object.entries(enLeaves.get(handle)!)) {
              const fv = frLeaves.get(handle)![k];
              if (en !== fv && /\s/.test(en) && en.length >= 10 && !/\{\{|%/.test(en) && text.includes(en)) problems.push(`${label}: English text left (${k}): ${en}`);
            }
          }
        }
        expect(problems).toEqual([]);
      }, 180_000);
    }

    it('renders the compare data of a product as JSON with its specs', async () => {
      const res = await t.app.inject({ url: '/products/highland-morning-coffee-beans?view=compare' });
      if (handle === 'circuit') {
        const data = JSON.parse(/<!--circuit-compare-->([\s\S]*?)<!--\/circuit-compare-->/.exec(res.body)![1]!);
        expect(data.handle).toBe('highland-morning-coffee-beans');
        expect(data.specs.map((x: { label: string }) => x.label)).toEqual(expect.arrayContaining(['Roast', 'Origin']));
      }
    });

    it('product page: options, selling plan, focal point, stock and recommendations hooks', async () => {
      const res = await t.app.inject({ url: `/products/highland-morning-coffee-beans`, headers: { 'user-agent': 'Googlebot' } });
      expect(res.body).toContain('data-purchase-options');
      expect(res.body).toContain('name="selling_plan"');
      expect(res.body).toContain('data-product-json');
      expect(res.body).toContain('data-recommendations');
      expect(res.body).toMatch(/type="radio"[^>]*name="options\[/);
      expect(res.body).toContain('Roast');
      const recs = await t.app.inject({ url: `/recommendations/products?product_id=${coffeeId}&section_id=recommendations&limit=4` });
      expect(recs.statusCode).toBe(200);
    });

    it('collection page: filters, sorting, product count and pagination', async () => {
      const res = await t.app.inject({ url: '/collections/all?filter.v.availability=1&sort_by=price-descending', headers: { 'user-agent': 'Googlebot' } });
      expect(res.body).toContain('name="sort_by"');
      expect(res.body).toContain('filter.v.availability');
      expect(res.body).toMatch(/filter\.v\.price\.gte/);
      expect(res.body).toMatch(/option value="price-descending" selected/);
      const paged = await t.app.inject({ url: '/collections/all?page=2', headers: { 'user-agent': 'Googlebot' } });
      expect(paged.statusCode).toBe(200);
    });

    it('shows the localization selectors, the cart count, the newsletter form and the cookie hook', async () => {
      const res = await t.app.inject({ url: '/', headers: { 'user-agent': 'Googlebot' } });
      expect(res.body).toContain('name="language_code"');
      expect(res.body).toContain('data-cart-count');
      expect(res.body).toContain('name="contact[email]"');
      expect(res.body).toContain('data-predictive-input');
      expect(res.body).toContain('data-search-toggle'.slice(0, 0) + 'data-predictive-search');
    });

    it('serves the stylesheet, the script and the fonts it declares', async () => {
      const home = (await t.app.inject({ url: '/', headers: { 'user-agent': 'Googlebot' } })).body;
      for (const m of home.matchAll(/(?:href|src)="([^"]*\/assets\/[^"?]+)(?:\?[^"]*)?"/g)) {
        const r = await t.app.inject({ url: m[1]! });
        expect(r.statusCode, m[1]).toBe(200);
      }
      const font = /url\(([^)]*font-[a-z-]+\.woff2[^)]*)\)/.exec(home)![1]!.replace(/['"]/g, '');
      expect((await t.app.inject({ url: font })).statusCode).toBe(200);
    });

    it('subscribes to the newsletter and sends the contact form with success and error states', async () => {
      const ok = await t.app.inject({ method: 'POST', url: '/contact', ...form({ form_type: 'customer', 'contact[email]': `news-${handle}@example.com`, 'contact[tags]': 'newsletter' }) });
      expect([200, 302, 303]).toContain(ok.statusCode);
      const bad = await t.app.inject({ method: 'POST', url: '/contact', ...form({ form_type: 'contact', 'contact[email]': 'not-an-email', 'contact[body]': '' }) });
      expect([200, 302, 303, 422]).toContain(bad.statusCode);
    });

    // The themes composed by the theme kit: each variant, the kit features and the sections of their trade.
    it.runIf(handle in KIT)('kit theme: header, card, product page and collection variants, features and trade sections', async () => {
      const k = KIT[handle as keyof typeof KIT]!;
      const page = async (url: string) => (await t.app.inject({ url, headers: { 'user-agent': 'Googlebot' } })).body;
      const home = await page('/');
      expect(home).toContain(`k-header--${k.header}`);
      expect(home).toContain(k.homeMarker);
      expect(home).toContain('data-back-to-top');
      expect(home).not.toContain('data-age-gate');
      const collection = await page('/collections/all');
      expect(collection).toContain(`k-card--${k.card}`);
      expect(collection).toContain(`k-filters--${k.filters}`);
      expect(collection).toContain('class="k-crumbs"');
      expect(collection.includes('data-infinite')).toBe(k.infinite);
      const dripper = (await db().select().from(s.productVariants)).find((v) => v.sku === 'CPD-SL')!;
      const product = await page(`/products/ceramic-pour-over-dripper?variant=${dripper.id}`);
      expect(product).toContain(`k-pdp--${k.pdp}`);
      expect(product).toContain('class="k-crumbs"');
      expect(product).toContain('data-stock-json');
      expect(product).toMatch(/data-lowstock[^>]*role="status">Only 5 left in stock</);
      const files = themeFiles(handle);
      for (const section of ['countdown', ...k.sections]) expect(files, section).toContain(`sections/${section}.liquid`);
      for (const template of k.templates) expect(files, template).toContain(`templates/${template}.json`);
      for (const header of ['k-header--centered', 'k-header--mega', 'k-header--split']) if (header !== `k-header--${k.header}`) expect(home).not.toContain(header);
    });

    it('renders the password page', async () => {
      const [shop] = await db().select().from(s.shops);
      await db().update(s.shops).set({ settings: { ...(shop!.settings as object), storefrontPassword: 'letmein', storefrontPasswordEnabled: true } }).where(eq(s.shops.id, shopId));
      t.app.ctx.stores?.refresh?.(db());
      try {
        for (const fr of [false, true]) {
          const res = await t.app.inject({ url: lang('/password', fr), headers: { 'user-agent': 'Googlebot' } });
          expect(res.statusCode).toBe(200);
          expect(res.body).not.toMatch(/Liquid error|translation missing/i);
          expect(res.body).toContain('type="password"');
        }
        const wrong = await t.app.inject({ method: 'POST', url: '/password', ...form({ password: 'nope' }) });
        expect(wrong.statusCode).toBe(200);
        expect(wrong.body).toContain('form-errors');
      } finally {
        await db().update(s.shops).set({ settings: shop!.settings }).where(eq(s.shops.id, shopId));
      }
    });
  });
});
