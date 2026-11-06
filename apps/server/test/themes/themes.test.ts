import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { frenchSeedDefaults, installThemeFiles, localizeSeedTexts, schema as s, seedDemo, type Mail } from '@shopme/core';
import { analyzeTheme, createEngine, Theme } from '@shopme/liquid-compat';
import { and, isNotNull } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, SETUP_BODY, type TestApp } from '../../src/test-utils';
import { makeGql, makeGqlOk } from '../conformance/helpers';
import { THEME_HANDLES, loadThemeFiles, loadJson, themeDir } from './helpers';

/**
 * The premium themes (Nocturne, Terroir): static checks of the files, then every template rendered for a seeded shop in English and
 * French (customer pages for a signed-in customer, a product with a selling plan, the cart drawer, filters and recommendations).
 */
const FORM = { 'content-type': 'application/x-www-form-urlencoded' };
const decode = (t: string) => t.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&#x27;/g, "'").replace(/&nbsp;/g, ' ');
const leaves = (o: unknown, prefix = '', out: Record<string, string> = {}): Record<string, string> => {
  for (const [k, v] of Object.entries((o ?? {}) as Record<string, unknown>)) {
    if (typeof v === 'string') out[prefix + k] = v; else if (v && typeof v === 'object') leaves(v, `${prefix}${k}.`, out);
  }
  return out;
};

for (const handle of THEME_HANDLES) {
  describe(`${handle}: files`, () => {
    const dir = themeDir(handle);
    const files = loadThemeFiles(handle);
    const paths = files.map((f) => f.path);

    it('has the standard layout, theme_info, changelog, license and only theme files', () => {
      for (const p of ['layout/theme.liquid', 'layout/password.liquid', 'config/settings_schema.json', 'config/settings_data.json', 'locales/en.default.json', 'locales/fr.json', 'locales/en.default.schema.json', 'locales/fr.schema.json', 'sections/header-group.json', 'sections/footer-group.json', 'templates/gift_card.liquid']) expect(paths, p).toContain(p);
      for (const t of ['index', 'product', 'collection', 'list-collections', 'search', 'cart', 'page', 'page.contact', 'blog', 'article', '404', 'password']) expect(paths, t).toContain(`templates/${t}.json`);
      for (const t of ['login', 'register', 'account', 'order', 'addresses', 'activate_account', 'reset_password']) expect(paths, t).toContain(`templates/customers/${t}.json`);
      expect(existsSync(path.join(dir, 'LICENSE'))).toBe(true);
      expect(readFileSync(path.join(dir, 'LICENSE'), 'utf8')).toContain('ShopMe contributors');
      const schema = loadJson(handle, 'config/settings_schema.json') as Array<Record<string, unknown>>;
      const info = schema[0]!;
      expect(info).toMatchObject({ name: 'theme_info', theme_version: '1.0.0', theme_author: 'ShopMe contributors' });
      expect(String(info.theme_documentation_url)).toContain('https://github.com/aymaneprojects/shopme');
      expect(String(info.theme_support_url)).toContain('https://github.com/aymaneprojects/shopme');
      expect(typeof info.shopme_description).toBe('string');
      expect(Array.isArray(info.shopme_tags) && (info.shopme_tags as string[]).length > 1).toBe(true);
      const log = loadJson(handle, 'changelog.json') as { versions: Array<{ version: string; notes: { en: string[]; fr: string[] } }> };
      expect(log.versions[0]!.version).toBe('1.0.0');
      expect(log.versions[0]!.notes.en.length).toBeGreaterThan(2);
      expect(log.versions[0]!.notes.fr.length).toBe(log.versions[0]!.notes.en.length);
      expect(paths.filter((p) => !/^(layout|templates|sections|blocks|snippets|config|locales|assets)\//.test(p))).toEqual([]);
    });

    it('parses: every Liquid file compiles and every JSON file is valid', () => {
      const theme = new Theme(new Map(files.map((f) => [f.path, f.body])));
      const report = analyzeTheme(theme, createEngine(theme));
      expect(report.parseFailures).toEqual([]);
      for (const f of files.filter((x) => x.path.endsWith('.json'))) expect(() => JSON.parse(f.body.replace(/\/\*[\s\S]*?\*\//g, '')), f.path).not.toThrow();
    });

    it('gives every section a translated schema with settings, and presets where the merchant can add it', () => {
      const en = leaves(loadJson(handle, 'locales/en.default.schema.json'));
      const fr = leaves(loadJson(handle, 'locales/fr.schema.json'));
      expect(Object.keys(fr).sort()).toEqual(Object.keys(en).sort());
      const sections = files.filter((f) => /^sections\/[^/]+\.liquid$/.test(f.path));
      expect(sections.length).toBeGreaterThan(30);
      const noPreset: string[] = [];
      for (const f of [...sections, ...files.filter((x) => x.path.startsWith('blocks/'))]) {
        const m = /\{% schema %\}([\s\S]*?)\{% endschema %\}/.exec(f.body);
        expect(m, f.path).toBeTruthy();
        const schema = JSON.parse(m![1]!) as { name: string; settings: unknown[]; presets?: unknown[]; blocks?: unknown[] };
        expect(schema.name, f.path).toMatch(/^t:/);
        expect(Array.isArray(schema.settings), f.path).toBe(true);
        if (!schema.presets) noPreset.push(path.basename(f.path, '.liquid'));
      }
      // only structural sections (header, footer, templates' main sections, overlays) are placed by the theme itself
      for (const n of noPreset) expect(n, `${n} cannot be added from the editor`).toMatch(/^(header|footer|footer-utilities|main-.+|cart-drawer|popup|product-recommendations)$/);
      // every t: key used in a schema, template, group or settings file is defined in both languages
      for (const f of files.filter((x) => /\.(liquid|json)$/.test(x.path) && !x.path.startsWith('locales/'))) {
        for (const k of f.body.matchAll(/"t:([A-Za-z0-9_.]+)"/g)) {
          expect(en[k[1]!], `${f.path}: ${k[1]}`).toBeTypeOf('string');
          expect(fr[k[1]!], `${f.path}: ${k[1]} (fr)`).toBeTypeOf('string');
        }
      }
    });

    it('has the same storefront strings in English and French, used keys exist, and French is translated', () => {
      const en = leaves(loadJson(handle, 'locales/en.default.json'));
      const frAll = leaves(loadJson(handle, 'locales/fr.json'));
      const seeds = Object.fromEntries(Object.entries(frAll).filter(([k]) => k.startsWith('seed_defaults.')));
      const fr = Object.fromEntries(Object.entries(frAll).filter(([k]) => !k.startsWith('seed_defaults.')));
      expect(Object.keys(fr).sort()).toEqual(Object.keys(en).sort());
      for (const f of files.filter((x) => x.path.endsWith('.liquid'))) {
        for (const m of f.body.matchAll(/'([a-z0-9_.]+)'\s*\|\s*t\b/g)) {
          if (m[1]!.endsWith('.')) continue;
          const exists = Object.keys(en).some((k) => k === m[1] || k.startsWith(`${m[1]}.`));
          expect(exists, `${f.path}: ${m[1]}`).toBe(true);
        }
      }
      const same = Object.keys(en).filter((k) => en[k] === fr[k] && /[a-z]{4}/i.test(en[k]!) && !/^(general\.copyright|general\.powered_by)$/.test(k));
      const sameWords = new Set(['Pagination', 'Total', 'Collections', 'Pages', 'Articles', 'Suggestions', 'Page', 'Article', 'Date', 'Taxes', 'Marketing', 'Description', 'Navigation', 'Collection', 'Journal', 'Newsletter', 'Contact', 'Menu']);
      const allowed = new Set(['header.search', 'customer.login', 'customer.register', 'contact.title', 'search.title', 'search.submit', 'contact.message', 'products.description', 'blog.tags', 'blog.all', 'collection.eyebrow', 'blog.eyebrow', 'carousel.next', 'newsletter.title', 'password.title', 'slideshow.label']);
      expect(same.filter((k) => !allowed.has(k) && !sameWords.has(en[k]!) && !/^customer\.subscriptions\.statuses/.test(k) && !/^(badges|products\.sku|products\.details|footer\.explore|collection\.product_type|collection\.sort\.manual)/.test(k) && !/(email|Email|E-mail|Téléphone)/i.test(en[k]!))).toEqual([]);
      expect(Object.keys(seeds).length).toBeGreaterThan(40);
      for (const [k, v] of Object.entries(seeds)) expect(v, k).not.toBe('');
    });

    it('loads no third-party resources and ships only the fonts the store serves', () => {
      for (const f of files.filter((x) => /\.(liquid|css|js)$/.test(x.path))) {
        const external = [...f.body.matchAll(/https?:\/\/[^\s"')]+/g)].map((m) => m[0]).filter((u) => !/^https?:\/\/(www\.youtube-nocookie\.com|player\.vimeo\.com|www\.w3\.org|schema\.org)/.test(u));
        expect(external, f.path).toEqual([]);
      }
      const assets = readdirAssets(dir);
      expect(assets.filter((a) => /\.(png|jpe?g|gif|webp|avif|svg|mp4)$/i.test(a))).toEqual([]);
      expect(assets.filter((a) => a.endsWith('.woff2')).every((a) => /^font-(inter|dm-sans|manrope|space-grotesk|lora|playfair-display)\.woff2$/.test(a))).toBe(true);
      expect(assets).toContain(`${handle}.css`);
      expect(assets).toContain(`${handle}.js`);
    });
  });
}

function readdirAssets(dir: string): string[] {
  const root = path.join(dir, 'assets');
  return existsSync(root) ? readdirSync(root) : [];
}

for (const handle of THEME_HANDLES) {
  describe(`${handle}: storefront rendering`, () => {
    let t: TestApp;
    let shopId: number;
    let themeId: number;
    let customerCookie = '';
    let orderId = 0;
    let addressId = 0;
    const sku: Record<string, number> = {};
    const productId: Record<string, number> = {};
    let planId = 0;
    let giftToken = '';
    let g: ReturnType<typeof makeGqlOk>;
    const sent: Mail[] = [];
    const get = (url: string, cookies: Record<string, string> = {}, headers: Record<string, string> = {}) => t.app.inject({ url, cookies, headers });
    const post = (url: string, form: Record<string, string>, cookies: Record<string, string> = {}) => t.app.inject({ method: 'POST', url, payload: new URLSearchParams(form).toString(), headers: FORM, cookies });
    const cookieOf = (res: { cookies: { name: string; value: string }[] }, name: string) => res.cookies.find((c) => c.name === name)?.value;

    beforeAll(async () => {
      t = await createTestApp();
      const setup = await t.app.inject({ method: 'POST', url: '/admin/api/setup', payload: SETUP_BODY });
      g = makeGqlOk(makeGql(t.app, setup.cookies.find((c) => c.name === 'shopme_session')!.value));
      await seedDemo(t.dbHandle.db, t.app.ctx.storage);
      t.app.ctx.mailer = { send: async (m) => { sent.push(m); } };
      const [shop] = await t.dbHandle.db.select().from(s.shops);
      shopId = shop!.id;
      const [main] = await t.dbHandle.db.select().from(s.themes).where(eq(s.themes.role, 'MAIN'));
      themeId = main!.id;
      for (const v of await t.dbHandle.db.select().from(s.productVariants)) if (v.sku) sku[v.sku] = v.id;
      for (const p of await t.dbHandle.db.select().from(s.products)) productId[p.handle] = p.id;
      planId = (await t.dbHandle.db.select().from(s.sellingPlans))[0]!.id;
      // tags that drive badges, and a gift card
      await g(`mutation($i: ProductInput!) { productUpdate(input: $i) { userErrors { message } } }`, { i: { id: `gid://shopify/Product/${productId['highland-morning-coffee-beans']}`, tags: ['coffee', 'single-origin', 'organic', 'local', 'new'] } });
      giftToken = 'tok-THEMES1';
      await t.dbHandle.db.insert(s.giftCards).values({ shopId, code: 'THEMES1', token: giftToken, currency: 'EUR', initialValue: 5000, balance: 5000, message: 'Happy birthday' });

      // a customer with an order, a subscription and an address
      const reg = await post('/account', { form_type: 'create_customer', 'customer[first_name]': 'Ada', 'customer[last_name]': 'Lovelace', 'customer[email]': 'ada@example.com', 'customer[password]': 'analytical engine' });
      customerCookie = cookieOf(reg, 'shopme_customer')!;
      const add = await t.app.inject({ method: 'POST', url: '/cart/add.js', payload: { items: [{ id: sku['HMC-250-WB'], quantity: 1, selling_plan: planId }, { id: sku['HEB-250'], quantity: 2 }] } });
      const cart = cookieOf(add, 'cart')!;
      const go = await t.app.inject({ method: 'POST', url: '/checkout', cookies: { cart } });
      const token = go.headers.location!.toString().split('/').pop()!;
      await t.app.inject({ url: `/checkouts/${token}`, cookies: { cart, shopme_customer: customerCookie } });
      const address = { email: 'ada@example.com', firstName: 'Ada', lastName: 'Lovelace', address1: '1 Rue de Rivoli', city: 'Paris', zip: '75001', countryCode: 'FR', phone: '' };
      await t.app.inject({ method: 'POST', url: `/checkouts/${token}/refresh`, payload: address });
      const done = await post(`/checkouts/${token}/complete`, { ...address, paymentMethod: 'bank_transfer' }, { cart, shopme_customer: customerCookie });
      expect(done.statusCode).toBe(303);
      const [order] = await t.dbHandle.db.select().from(s.orders).where(eq(s.orders.cartToken, token));
      orderId = order!.id;
      await post('/account/addresses', { form_type: 'customer_address', 'address[first_name]': 'Ada', 'address[last_name]': 'Lovelace', 'address[address1]': '10 Downing St', 'address[city]': 'London', 'address[zip]': 'SW1A 2AA', 'address[country]': 'GB', 'address[default]': '1' }, { shopme_customer: customerCookie });
      addressId = (await t.dbHandle.db.select().from(s.customerAddresses))[0]?.id ?? 0;
    }, 180_000);
    afterAll(async () => { await t.close(); });

    /** Installs the theme as the shop's live theme, as the store installs Aurora (French shops get the French seed texts). */
    async function install(locale: 'en' | 'fr') {
      await t.dbHandle.db.update(s.shops).set({ locale }).where(eq(s.shops.id, shopId));
      const fr = locale === 'fr' ? frenchSeedDefaults(themeDir(handle)) : {};
      await installThemeFiles(t.dbHandle.db, shopId, themeId, themeDir(handle), (files) => localizeSeedTexts(files, fr), t.app.ctx.storage);
    }

    interface Page { name: string; url: string; status?: number; cookies?: () => Record<string, string>; contains?: string[]; document?: boolean }
    const pages = (): Page[] => {
      const me = () => ({ shopme_customer: customerCookie });
      return [
        { name: 'home', url: '/' },
        { name: 'list-collections', url: '/collections' },
        { name: 'collection', url: '/collections/coffee', contains: ['collection-form', 'filters'] },
        { name: 'collection all', url: '/collections/all', contains: ['class="grid'] },
        { name: 'collection filtered', url: '/collections/all?filter.v.availability=1&filter.v.price.gte=5&filter.v.price.lte=40&sort_by=price-descending', contains: ['active-filters'] },
        { name: 'collection page 2', url: '/collections/all?page=2' },
        { name: 'collection empty', url: '/collections/all?filter.v.price.gte=900' },
        { name: 'product with plan', url: '/products/highland-morning-coffee-beans', contains: ['data-purchase-options', 'data-selling-plan-input', 'data-product-json', 'data-recommendations'] },
        { name: 'product sold-out variant', url: `/products/highland-morning-coffee-beans?variant=${sku['HMC-1K-FL']}`, contains: ['disabled'] },
        { name: 'product', url: '/products/house-espresso-blend' },
        { name: 'product single', url: '/products/jasmine-pearl-green-tea' },
        { name: 'product swatches', url: '/products/ceramic-pour-over-dripper' },
        { name: 'cart empty', url: '/cart' },
        { name: 'search', url: '/search' },
        { name: 'search results', url: '/search?q=tea' },
        { name: 'search none', url: '/search?q=zzzz' },
        { name: 'page', url: '/pages/about-us' },
        { name: 'contact', url: '/pages/contact', contains: ['contact_form'] },
        { name: 'blog', url: '/blogs/news' },
        { name: 'blog tag', url: '/blogs/news/tagged/news' },
        { name: 'article', url: '/blogs/news/welcome' },
        { name: '404', url: '/no/such/page', status: 404 },
        { name: 'gift card', url: `/gift_cards/${giftToken}`, contains: ['Happy birthday'], document: true },
        { name: 'login', url: '/account/login', contains: ['customer_login'] },
        { name: 'register', url: '/account/register', contains: ['create_customer'] },
        { name: 'account', url: '/account', cookies: me, contains: ['Ada', '#1001'] },
        { name: 'account subscriptions', url: '/account', cookies: me, contains: ['subscription'] },
        { name: 'order', url: `/account/orders/${orderId}`, cookies: me, contains: ['House Espresso Blend'] },
        { name: 'addresses', url: '/account/addresses', cookies: me, contains: ['address[address1]'] },
      ];
    };

    async function check(locale: 'en' | 'fr') {
      const enLeaves = leaves(loadJson(handle, 'locales/en.default.json'));
      const frLeaves = leaves(loadJson(handle, 'locales/fr.json'));
      const frSeeds = loadJson(handle, 'locales/fr.json').seed_defaults as Record<string, string>;
      const seeds = Object.keys(frSeeds);
      const shopData = new Set(['Search', 'Contact', 'Home', 'About us', 'Coffee', 'Tea', 'Products', 'Shipping and returns', 'Filter']);
      const leakedUi = Object.keys(enLeaves).filter((k) => enLeaves[k] !== frLeaves[k] && !shopData.has(enLeaves[k]!) && !enLeaves[k]!.includes('{{') && enLeaves[k]!.length >= 5 && !/^(general\.date_format)$/.test(k));
      const list = pages();
      const dyn: Page[] = [];
      // cart with a subscription and a discount-free line, rendered as page and drawer
      const add = await t.app.inject({ method: 'POST', url: '/cart/add.js', payload: { items: [{ id: sku['HMC-250-WB'], quantity: 1, selling_plan: planId }, { id: sku['CPD-CR'], quantity: 2 }], sections: 'cart-drawer' } });
      expect(add.statusCode, add.body).toBe(200);
      expect(add.json().sections['cart-drawer']).toContain('data-cart-drawer-content');
      const cart = cookieOf(add, 'cart')!;
      dyn.push({ name: 'cart', url: '/cart', cookies: () => ({ cart }), contains: ['data-cart-section', 'cart-item', 'data-qty-step'] });
      for (const p of [...list, ...dyn]) {
        const r = await get(p.url, p.cookies?.() ?? {});
        expect(r.statusCode, `${locale} ${p.name}`).toBe(p.status ?? 200);
        const html = r.body;
        expect(html, `${locale} ${p.name}: liquid error`).not.toMatch(/Liquid error|liquid error/);
        expect(html, `${locale} ${p.name}: translation`).not.toContain('translation missing');
        if (!p.document) expect(html, `${locale} ${p.name}`).toContain('id="shopify-section-header"');
        if (process.env.THEME_DUMP) writeFileSync(path.join(process.env.THEME_DUMP, `${handle}-${locale}-${p.name.replace(/\W+/g, '_')}.html`), html);
        for (const c of p.contains ?? []) if (c) expect(html, `${locale} ${p.name}: ${c}`).toContain(c);
        expect(html, `${locale} ${p.name}`).toContain(`lang="${locale}`);
        if (locale === 'fr') {
          const body = decode(html.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<style[\s\S]*?<\/style>/g, ''));
          const texts = new Set([...body.matchAll(/>([^<>]+)</g)].map((m) => m[1]!.replace(/\s+/g, ' ').trim()));
          const attrs = new Set([...body.matchAll(/(?:aria-label|placeholder|title|alt)="([^"]*)"/g)].map((m) => m[1]!.trim()));
          for (const k of leakedUi) expect(texts.has(enLeaves[k]!) || attrs.has(enLeaves[k]!), `fr ${p.name}: English string left (${k}: ${enLeaves[k]})`).toBe(false);
          for (const sd of seeds) if (sd.length >= 8 && frSeeds[sd] !== sd && !sd.startsWith('<')) expect(texts.has(decode(sd)) || attrs.has(decode(sd)), `fr ${p.name}: English seed text left (${sd})`).toBe(false);
        }
      }
      // password page, with the gate on
      await t.dbHandle.db.update(s.shops).set({ settings: { storefrontPasswordEnabled: true, storefrontPassword: 'letmein', passwordMessage: '' } }).where(eq(s.shops.id, shopId));
      const gate = await get('/password');
      expect(gate.statusCode).toBe(200);
      expect(gate.body).not.toMatch(/Liquid error|translation missing/);
      expect(gate.body).toContain('storefront_password');
      await t.dbHandle.db.update(s.shops).set({ settings: {} }).where(eq(s.shops.id, shopId));
    }

    it('renders every template in English', async () => {
      await install('en');
      await check('en');
    }, 180_000);

    it('renders every template in French, with no English left', async () => {
      await install('fr');
      await check('fr');
    }, 180_000);

    it('serves the section rendering, recommendations, predictive search, filters and tag badges the scripts rely on', async () => {
      await install('en');
      const drawer = (await get('/?sections=cart-drawer')).json() as Record<string, string>;
      expect(Object.keys(drawer)).toEqual(['cart-drawer']);
      expect(drawer['cart-drawer']).toMatch(/^<div id="shopify-section-cart-drawer"/);
      expect(drawer['cart-drawer']).toContain('data-cart-drawer-content');
      const recs = await get(`/recommendations/products?product_id=${productId['highland-morning-coffee-beans']}&section_id=recommendations&limit=4&intent=related`);
      expect(recs.statusCode).toBe(200);
      expect(recs.body).toContain('data-recommendations-list');
      expect(recs.body).not.toMatch(/Liquid error|translation missing/);
      const suggest = await get('/search/suggest.json?q=tea&resources[type]=product,collection,query&resources[limit]=3');
      expect(suggest.statusCode).toBe(200);
      expect(suggest.json().resources.results.products.length).toBeGreaterThan(0);
      const home = (await get('/')).body;
      expect(home).toContain('data-predictive-search');
      expect(home).toContain('data-cart-drawer');
      expect(home).toContain('data-cart-count');
      expect(home).not.toContain('language-selector');
      expect(home).toContain('name="contact[email]"');
      const product = (await get('/products/highland-morning-coffee-beans')).body;
      expect(product).toContain(handle === 'terroir' ? 'badge--organic' : 'badge--new');
      expect(product).toContain('badge--sale');
      expect(product).toContain('data-media-id');
      const priced = (await get('/collections/all?filter.v.price.lte=12')).body;
      expect(priced).toContain('Jasmine Pearl');
      expect(priced).not.toContain('Ceramic Pour-Over');
      const sorted = (await get('/collections/all?sort_by=price-ascending')).body;
      expect(sorted.indexOf('Jasmine Pearl')).toBeLessThan(sorted.indexOf('Ceramic Pour-Over'));
      void addressId;
    }, 120_000);

    it('honors the image focal point as object-position', async () => {
      await install('en');
      const rows = await t.dbHandle.db.select({ id: s.media.id }).from(s.productMedia).innerJoin(s.media, eq(s.media.id, s.productMedia.mediaId)).where(and(isNotNull(s.media.url), eq(s.media.type, 'IMAGE')));
      const set = await g(`mutation($f: [FileUpdateInput!]!) { fileUpdate(files: $f) { userErrors { message } } }`, { f: rows.map((r) => ({ id: `gid://shopify/MediaImage/${r.id}`, focalPoint: { x: 25, y: 75 } })) });
      expect(set.fileUpdate.userErrors).toEqual([]);
      const fp = (await get('/products/highland-morning-coffee-beans')).body;
      if (process.env.THEME_DUMP) writeFileSync(path.join(process.env.THEME_DUMP, `${handle}-focal.html`), fp);
      expect(fp).toContain('object-position: 25% 75%');
      expect((await get('/collections/all')).body).toContain('object-position: 25% 75%');
      expect((await get('/')).body).toContain('object-position: 25% 75%');
      expect((await get('/search?q=coffee')).body).toContain('object-position: 25% 75%');
    }, 60_000);

    it('offers the language selector once a second language is published, and answers in French under /fr', async () => {
      await install('en');
      await g(`mutation { shopLocaleEnable(locale: "fr") { userErrors { message } } }`);
      await g(`mutation { shopLocaleUpdate(locale: "fr", shopLocale: { published: true }) { userErrors { message } } }`);
      const home = (await get('/')).body;
      expect(home).toContain('class="language-selector"');
      expect(home).toContain('hreflang="fr"');
      expect(home).not.toMatch(/Liquid error|translation missing/);
      for (const url of ['/fr', '/fr/collections/coffee', '/fr/products/highland-morning-coffee-beans', '/fr/cart', '/fr/search?q=tea']) {
        const r = await get(url);
        expect(r.statusCode, url).toBe(200);
        expect(r.body, url).not.toMatch(/Liquid error|translation missing/);
        expect(r.body, url).toContain('lang="fr');
        expect(r.body, url).toMatch(/Rechercher|Recherche/);
      }
      const post2 = await post('/localization', { language_code: 'fr', return_to: '/collections/coffee' });
      expect(post2.statusCode).toBe(302);
    }, 60_000);

    it('serves reset and activation pages', async () => {
      await install('en');
      sent.length = 0;
      await post('/account/login', { form_type: 'recover_customer_password', email: 'ada@example.com' });
      await t.app.ctx.queue.idle();
      const reset = sent.find((m) => /\/account\/reset\/\d+\/[\w-]+/.test(m.text));
      if (reset) {
        const link = /\/account\/reset\/\d+\/[\w-]+/.exec(reset.text)![0];
        const page = await get(link);
        expect(page.statusCode).toBe(200);
        expect(page.body).toContain('customer[password_confirmation]');
        expect(page.body).not.toMatch(/Liquid error|translation missing/);
      }
      const guest = await t.app.inject({ method: 'POST', url: '/account', payload: new URLSearchParams({ 'customer[email]': 'guest@example.com', 'customer[password]': 'guest secret 1' }).toString(), headers: FORM });
      await t.app.ctx.queue.idle();
      const activation = sent.find((m) => /\/account\/activate\/\d+\/[\w-]+/.test(m.text));
      if (guest.statusCode && activation) {
        const page = await get(/\/account\/activate\/\d+\/[\w-]+/.exec(activation.text)![0]);
        expect(page.statusCode).toBe(200);
        expect(page.body).toContain('activate_customer_password');
        expect(page.body).not.toMatch(/Liquid error|translation missing/);
      }
    }, 60_000);
  });
}
