import { eq } from 'drizzle-orm';
import { schema as s, seedDemo, setMetafields } from '@shopme/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '../../../src/test-utils';

let t: TestApp;
let shopId = 0;
const get = (url: string, headers: Record<string, string> = {}) => t.app.inject({ url, headers });
const json = async (url: string) => JSON.parse((await get(url)).body);
const q = (o: Record<string, string>) => new URLSearchParams(o).toString();

beforeAll(async () => {
  t = await createTestApp();
  await seedDemo(t.dbHandle.db, t.app.ctx.storage);
  shopId = (await t.dbHandle.db.select().from(s.shops))[0]!.id;
});
afterAll(async () => { await t.close(); });

describe('storefront search', () => {
  it('ranks title matches first and matches word prefixes (options[prefix]=last, the default)', async () => {
    const r = await json(`/search/suggest.json?${q({ q: 'espres', 'resources[type]': 'product' })}`);
    expect(r.resources.results.products.map((p: { handle: string }) => p.handle)).toContain('house-espresso-blend');
    const page = await get(`/search?${q({ q: 'espres', type: 'product' })}`);
    expect(page.body).toContain('house-espresso-blend');
    expect(page.body).not.toContain('Showing results for'); // a prefix hit, no spelling fix needed
    // Without prefix matching "espres" is not a word of the catalog: the search falls back to the nearest spelling.
    const exact = await get(`/search?${q({ q: 'espres', type: 'product', 'options[prefix]': 'none' })}`);
    expect(exact.body).toContain('Showing results for');
  });

  it('tolerates typos and says what it searched for', async () => {
    const page = await get(`/search?${q({ q: 'espreso', type: 'product' })}`);
    expect(page.body).toContain('house-espresso-blend');
    expect(page.body).toContain('Showing results for');
    const suggest = await json(`/search/suggest.json?${q({ q: 'cofee', 'resources[type]': 'product,query' })}`);
    expect(suggest.resources.results.products.length).toBeGreaterThan(0);
    expect(suggest.resources.results.queries.map((x: { text: string }) => x.text)).toContain('coffee');
    expect((await get(`/search?${q({ q: 'qqqqqqq', type: 'product' })}`)).body).not.toContain('Showing results for');
  });

  it('searches products, pages and articles by type and returns mixed results', async () => {
    const all = await get('/search?q=about');
    expect(all.body).toContain('/pages/about-us');
    expect(all.body).toContain('search-result__type');
    expect((await get(`/search?${q({ q: 'about', type: 'product' })}`)).body).not.toContain('/pages/about-us');
    const sug = await json(`/search/suggest.json?${q({ q: 'about', 'resources[type]': 'page,article,collection,query' })}`);
    expect(sug.resources.results.pages.map((p: { url: string }) => p.url)).toContain('/pages/about-us');
    expect(Array.isArray(sug.resources.results.articles)).toBe(true);
    expect(Array.isArray(sug.resources.results.collections)).toBe(true);
    // The predictive section markup is part of every page.
    const home = await get('/');
    expect(home.body).toContain('data-predictive-search');
    expect(home.body).toContain('Suggestions');
  });

  it('/search.json renders the search page like the reference store and is not indexable', async () => {
    const r = await get('/search.json?q=coffee');
    expect(r.statusCode).toBe(200);
    expect(r.headers['x-robots-tag']).toBe('noindex, nofollow');
  });
});

describe('SEO routes and headers', () => {
  it('serves /meta.json and the collection Atom feed', async () => {
    const meta = await json('/meta.json');
    expect(meta).toMatchObject({ currency: expect.any(String), money_format: expect.any(String), published_products_count: expect.any(Number), shopify_pay_enabled_card_brands: [] });
    expect(meta.published_products_count).toBeGreaterThan(0);
    const atom = await get('/collections/all.atom');
    expect(atom.statusCode).toBe(200);
    expect(atom.headers['content-type']).toContain('application/atom+xml');
    expect(atom.body).toContain('<feed xml:lang=');
    expect(atom.body).toContain('xmlns:s="http://jadedpixel.com/-/spec/shopify"');
    expect(atom.body).toMatch(/<s:variant>[\s\S]*<s:price currency="[A-Z]{3}">\d+\.\d{2}<\/s:price>/);
    expect((await get('/collections/coffee.atom')).statusCode).toBe(200);
    expect((await get('/collections/nope.atom')).statusCode).toBe(404);
    expect((await json('/products.json')).products.length).toBeGreaterThan(0);
  });

  it('sets x-robots-tag on search, admin, checkout and redirect responses', async () => {
    expect((await get('/search?q=x')).headers['x-robots-tag']).toBe('noindex, nofollow');
    expect((await get('/admin/')).headers['x-robots-tag']).toBe('noindex, nofollow');
    expect((await get('/checkouts/abc')).headers['x-robots-tag']).toBe('none');
    expect((await get('/products/house-espresso-blend')).headers['x-robots-tag']).toBeUndefined();
    await t.dbHandle.db.insert(s.urlRedirects).values({ shopId, path: '/old-coffee', target: '/products/house-espresso-blend' });
    const redirect = await get('/old-coffee');
    expect(redirect.statusCode).toBe(301);
    expect(redirect.headers['x-robots-tag']).toBe('noindex');
  });

  it('emits canonical, hreflang and Product JSON-LD', async () => {
    const r = await get('/collections/coffee/products/house-espresso-blend');
    expect(r.body).toMatch(/<link rel="canonical" href="[^"]*\/products\/house-espresso-blend">/);
    expect(r.body).toMatch(/<link rel="alternate" hreflang="en[^"]*" href="[^"]*\/collections\/coffee\/products|<link rel="alternate" hreflang="en[^"]*" href="[^"]*\/products\/house-espresso-blend"/);
    expect(r.body).toContain('hreflang="x-default"');
    const ld = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(r.body)?.[1];
    expect(ld).toBeTruthy();
    const data = JSON.parse(ld!);
    expect(data).toMatchObject({ '@type': 'Product', name: 'House Espresso Blend' });
    expect(data.url).toMatch(/^https?:\/\//);
    expect(data.offers[0]).toMatchObject({ '@type': 'Offer', availability: expect.stringContaining('schema.org'), priceCurrency: expect.any(String) });
    expect((await get('/collections/all?page=2')).body).toContain('/collections/all?page=2">');
  });
});

describe('metafields in Liquid', () => {
  it('exposes typed values, definitions-agnostic, on products (metafield_tag / metafield_text in the theme)', async () => {
    const [p] = await t.dbHandle.db.select().from(s.products).where(eq(s.products.handle, 'house-espresso-blend'));
    const set = await setMetafields(t.dbHandle.db, shopId, [
      { ownerType: 'PRODUCT', ownerId: p!.id, namespace: 'custom', key: 'origin', type: 'single_line_text_field', value: 'Huila <Colombia>' },
      { ownerType: 'PRODUCT', ownerId: p!.id, namespace: 'custom', key: 'roast_level', type: 'number_integer', value: '3' },
      { ownerType: 'PRODUCT', ownerId: p!.id, namespace: 'custom', key: 'site', type: 'url', value: 'https://example.com/x' },
      { ownerType: 'PRODUCT', ownerId: p!.id, namespace: 'custom', key: 'notes', type: 'list.single_line_text_field', value: '["cocoa","citrus"]' },
      { ownerType: 'PRODUCT', ownerId: p!.id, namespace: 'private', key: 'secret', type: 'single_line_text_field', value: 'not in custom' },
    ]);
    expect(set.ok).toBe(true);
    const html = (await get('/products/house-espresso-blend')).body;
    expect(html).toContain('<span class="metafield-single_line_text_field">Huila &lt;Colombia&gt;</span>');
    expect(html).toContain('<a href="https://example.com/x" class="metafield-url">https://example.com/x</a>');
    expect(html).toContain('<ul class="metafield-list_single_line_text_field"><li><span class="metafield-single_line_text_field">cocoa</span></li>');
    expect(html).toContain('Roast level');
    expect(html).not.toContain('not in custom');
    // `| json` of a product never prints metafields.
    expect(/data-product-json>([\s\S]*?)<\/script>/.exec(html)?.[1]).not.toContain('Huila');
  });
});
