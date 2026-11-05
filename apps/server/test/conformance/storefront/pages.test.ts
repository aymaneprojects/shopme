import { eq } from 'drizzle-orm';
import { schema as s, seedDemo } from '@shopme/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '../../../src/test-utils';

let t: TestApp;
const get = (url: string, headers: Record<string, string> = {}) => t.app.inject({ url, headers });
const title = (html: string) => /<title>([^<]*)<\/title>/.exec(html)?.[1];

beforeAll(async () => {
  t = await createTestApp();
  await seedDemo(t.dbHandle.db, t.app.ctx.storage);
});
afterAll(async () => { await t.close(); });

describe('routes', () => {
  it('renders the main pages with themed HTML and no Liquid errors', async () => {
    for (const url of ['/', '/collections', '/products', '/collections/all', '/collections/coffee', '/products/house-espresso-blend', '/cart', '/search', '/pages/about-us', '/pages/contact', '/collections/coffee/products/house-espresso-blend']) {
      const r = await get(url);
      expect(r.statusCode, url).toBe(200);
      expect(r.headers['content-type']).toContain('text/html');
      expect(r.body, url).not.toContain('Liquid error');
      expect(r.body, url).toContain('id="shopify-section-header"');
    }
  });

  it('titles follow the platform conventions', async () => {
    expect(title((await get('/')).body)).toBe('Little Leaf Coffee &amp; Tea');
    expect(title((await get('/collections')).body)).toBe('Collections - Little Leaf Coffee &amp; Tea');
    expect(title((await get('/collections/all')).body)).toBe('Products - Little Leaf Coffee &amp; Tea');
    expect(title((await get('/collections/all?page=2')).body)).toContain('Products - Page 2');
    expect(title((await get('/search?q=tea')).body)).toMatch(/^Search: 2 results found for &quot;tea&quot; - /);
    expect(title((await get('/search?q=zzzz')).body)).toMatch(/^Search: 0 results found/);
  });

  it('unknown handles give a themed 404', async () => {
    for (const url of ['/collections/nope', '/products/nope', '/pages/nope', '/pages', '/policies/nope', '/blogs', '/whatever/else']) {
      const r = await get(url);
      expect(r.statusCode, url).toBe(404);
      expect(title(r.body), url).toBe('404 Not Found - Little Leaf Coffee &amp; Tea');
    }
  });

  it('variant, view, sort_by and tag parameters', async () => {
    expect((await get('/products/house-espresso-blend?variant=1')).statusCode).toBe(200);
    const v = await t.dbHandle.db.select().from(s.productVariants).where(eq(s.productVariants.sku, 'HEB-1K'));
    expect((await get(`/products/house-espresso-blend?variant=${v[0]!.id}`)).body).toContain(`name="id" value="${v[0]!.id}"`);
    expect((await get('/products/house-espresso-blend?view=unknown')).statusCode).toBe(200);
    const asc = (await get('/collections/all?sort_by=price-ascending')).body;
    expect(asc.indexOf('Jasmine Pearl')).toBeLessThan(asc.indexOf('Ceramic Pour-Over'));
    expect((await get('/collections/all?sort_by=bogus')).statusCode).toBe(200);
    const tagged = await get('/collections/all/Tea');
    expect(tagged.statusCode).toBe(200);
    expect(tagged.body).toContain('Smoked Earl Grey');
    expect(tagged.body).not.toContain('House Espresso');
    expect(title(tagged.body)).toContain('tagged &quot;Tea&quot;');
  });

  it('filters: availability and price', async () => {
    const r = (await get('/collections/all?filter.v.price.lte=12')).body;
    expect(r).toContain('Jasmine Pearl');
    expect(r).not.toContain('Ceramic Pour-Over');
  });

  it('?sections= returns exactly the requested keys; section_id returns partial HTML or 404', async () => {
    const r = await get('/?sections=header,footer');
    expect(r.headers['content-type']).toContain('application/json');
    const body = JSON.parse(r.body);
    expect(Object.keys(body)).toEqual(['header', 'footer']);
    expect(body.header).toMatch(/^<div id="shopify-section-header"/);
    expect(JSON.parse((await get('/cart?sections=header')).body).header).toContain('data-cart-count');
    const one = await get('/products/house-espresso-blend?section_id=main');
    expect(one.statusCode).toBe(200);
    expect(one.body).toMatch(/^<section id="shopify-section-main"/);
    expect((await get('/products/house-espresso-blend?section_id=nope')).statusCode).toBe(404);
  });

  it('theme assets are served with long cache and robots/sitemap exist', async () => {
    const page = (await get('/')).body;
    const css = /href="(\/cdn\/shop\/t\/\d+\/assets\/aurora\.css[^"]*)"/.exec(page)![1]!;
    const r = await get(css.replace(/&amp;/g, '&'));
    expect(r.statusCode).toBe(200);
    expect(r.headers['content-type']).toContain('text/css');
    expect(r.headers['cache-control']).toContain('immutable');
    expect((await get('/robots.txt')).body).toContain('Sitemap:');
    const index = (await get('/sitemap.xml')).body;
    expect(index).toContain('<sitemapindex');
    expect(index).toContain('/sitemap_products_1.xml');
    expect((await get('/sitemap_products_1.xml')).body).toContain('/products/house-espresso-blend');
    expect((await get('/sitemap_blogs_1.xml')).body).toContain('/blogs/news/welcome');
    expect((await get('/sitemap_nope_1.xml')).statusCode).toBe(400);
  });

  it('cart page lists items and the checkout link', async () => {
    const add = await t.app.inject({ method: 'POST', url: '/cart/add.js', payload: { id: 1, quantity: 2 } });
    const cookie = `cart=${add.cookies.find((c) => c.name === 'cart')!.value}`;
    const r = await get('/cart', { cookie });
    expect(r.body).toContain('Highland Morning Coffee Beans');
    expect(r.body).toContain('href="/checkout"');
    expect(r.body).toContain('data-cart-count aria-hidden="true">2<');
  });
});

describe('password gate', () => {
  it('redirects everything to /password until unlocked', async () => {
    const [shop] = await t.dbHandle.db.select().from(s.shops);
    await t.dbHandle.db.update(s.shops).set({ settings: { storefrontPasswordEnabled: true, storefrontPassword: 'letmein' } }).where(eq(s.shops.id, shop!.id));
    for (const url of ['/', '/cart.js', '/products/house-espresso-blend.js', '/nope']) {
      const r = await get(url);
      expect(r.statusCode, url).toBe(302);
      expect(r.headers.location).toBe('/password');
    }
    expect((await get('/password')).statusCode).toBe(200);
    expect((await get('/robots.txt')).statusCode).toBe(200);
    const wrong = await t.app.inject({ method: 'POST', url: '/password', payload: 'password=nope', headers: { 'content-type': 'application/x-www-form-urlencoded' } });
    expect(wrong.statusCode).toBe(200);
    expect(wrong.body).toContain('Wrong password');
    const ok = await t.app.inject({ method: 'POST', url: '/password', payload: 'password=letmein', headers: { 'content-type': 'application/x-www-form-urlencoded' } });
    expect(ok.statusCode).toBe(302);
    expect(ok.headers.location).toBe('/');
    const cookie = `storefront_password=${ok.cookies.find((c) => c.name === 'storefront_password')!.value}`;
    expect((await get('/', { cookie })).statusCode).toBe(200);
    expect((await get('/cart.js', { cookie })).statusCode).toBe(200);
  });
});
