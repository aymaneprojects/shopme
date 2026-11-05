import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, createLocalStorage, runMigrations, schema as s, setupStore, type DbHandle } from '@shopme/core';
import { ShopifyClient, ShopifyError } from './shopify-client';
import { importFromShopify } from './shopify-import';

/** Hand-written Admin GraphQL responses in the shape the importer queries (invented data). */
const money = (amount: string) => ({ shopMoney: { amount, currencyCode: 'USD' } });
const page = <T>(nodes: T[]) => ({ nodes, pageInfo: { hasNextPage: false, endCursor: null } });
const variant = (n: number, extra: object) => ({ id: `gid://shopify/ProductVariant/${n}`, title: 'x', sku: `SKU-${n}`, barcode: null, price: '10.00', compareAtPrice: null, taxable: true, inventoryPolicy: 'DENY', position: n, image: null, ...extra });
const DATA: Record<string, unknown> = {
  shop: { name: 'Fixture Shop', currencyCode: 'USD', shopPolicies: [{ type: 'REFUND_POLICY', title: 'Refunds', body: '<p>30 days</p>' }] },
  locations: page([{ id: 'gid://shopify/Location/1', name: 'Warehouse', isPrimary: true, fulfillsOnlineOrders: true, address: { address1: '1 Dock Rd', address2: null, city: 'Lyon', provinceCode: null, zip: '69001', countryCode: 'FR', phone: null } }]),
  products: page([
    {
      id: 'gid://shopify/Product/1', handle: 'tee', title: 'Tee', descriptionHtml: '<p>Soft</p>', vendor: 'Acme', productType: 'Shirt', tags: ['b', 'a'], status: 'ACTIVE', templateSuffix: null, seo: { title: 'SEO', description: null },
      options: [{ name: 'Size', values: ['S', 'M'] }],
      media: page([{ id: 'gid://shopify/MediaImage/1', alt: 'front', image: { url: 'https://cdn.example/tee.png?v=1' } }]),
      variants: page([variant(11, { title: 'S', selectedOptions: [{ name: 'Size', value: 'S' }], image: { url: 'https://cdn.example/tee.png?v=1' } }), variant(12, { title: 'M', price: '12.50', compareAtPrice: '15.00', selectedOptions: [{ name: 'Size', value: 'M' }] })]),
    },
    {
      id: 'gid://shopify/Product/2', handle: 'mug', title: 'Mug', descriptionHtml: '', vendor: '', productType: '', tags: [], status: 'DRAFT', templateSuffix: null, seo: { title: null, description: null },
      options: [{ name: 'Title', values: ['Default Title'] }], media: page([]),
      variants: page([variant(21, { title: 'Default Title', selectedOptions: [{ name: 'Title', value: 'Default Title' }] })]),
    },
  ]),
  inventoryItems: page([
    { id: 'gid://shopify/InventoryItem/1', tracked: true, requiresShipping: true, countryCodeOfOrigin: null, harmonizedSystemCode: null, unitCost: { amount: '4.00' }, measurement: { weight: { value: 0.5, unit: 'KILOGRAMS' } }, variant: { id: 'gid://shopify/ProductVariant/11' }, inventoryLevels: page([{ location: { id: 'gid://shopify/Location/1' }, quantities: [{ name: 'available', quantity: 7 }] }]) },
    { id: 'gid://shopify/InventoryItem/2', tracked: false, requiresShipping: false, countryCodeOfOrigin: null, harmonizedSystemCode: null, unitCost: null, measurement: { weight: null }, variant: { id: 'gid://shopify/ProductVariant/21' }, inventoryLevels: page([]) },
  ]),
  collections: page([
    { id: 'gid://shopify/Collection/1', handle: 'featured', title: 'Featured', descriptionHtml: '', sortOrder: 'MOST_RELEVANT', templateSuffix: null, seo: { title: null, description: null }, image: null, ruleSet: null },
    { id: 'gid://shopify/Collection/2', handle: 'shirts', title: 'Shirts', descriptionHtml: '', sortOrder: 'BEST_SELLING', templateSuffix: null, seo: { title: null, description: null }, image: null, ruleSet: { appliedDisjunctively: false, rules: [{ column: 'TYPE', relation: 'EQUALS', condition: 'Shirt' }] } },
  ]),
  customers: page([{ id: 'gid://shopify/Customer/1', firstName: 'Ada', lastName: 'L', note: null, tags: ['vip'], taxExempt: false, locale: 'en', numberOfOrders: '1', amountSpent: { amount: '10.00' }, defaultEmailAddress: { emailAddress: 'Ada@Example.com', marketingState: 'SUBSCRIBED' }, defaultPhoneNumber: null, defaultAddress: { id: 'a1' }, addressesV2: { nodes: [{ id: 'a1', firstName: 'Ada', lastName: 'L', company: null, address1: '2 Rue', address2: null, city: 'Paris', provinceCode: null, zip: '75001', countryCodeV2: 'FR', phone: null }] } }]),
  orders: page([{
    id: 'gid://shopify/Order/1', name: '#1042', createdAt: '2026-01-02T03:04:05Z', processedAt: '2026-01-02T03:04:05Z', cancelledAt: null, closedAt: null, cancelReason: null, test: false, displayFinancialStatus: 'PAID', displayFulfillmentStatus: 'FULFILLED',
    currencyCode: 'USD', presentmentCurrencyCode: 'USD', taxesIncluded: false, email: 'ada@example.com', phone: null, note: 'gift', tags: ['b2b'], sourceName: 'web',
    subtotalPriceSet: money('10.00'), totalPriceSet: money('15.00'), totalTaxSet: money('1.00'), totalShippingPriceSet: money('5.00'), totalDiscountsSet: money('1.00'), totalRefundedSet: money('0.00'),
    customer: { id: 'gid://shopify/Customer/1' }, shippingAddress: { firstName: 'Ada', lastName: 'L', company: null, address1: '2 Rue', address2: null, city: 'Paris', provinceCode: null, zip: '75001', countryCodeV2: 'FR', phone: null, province: null, country: 'France' }, billingAddress: null,
    shippingLines: { nodes: [{ title: 'Post', code: 'post', originalPriceSet: money('5.00') }] },
    lineItems: page([{ id: 'l1', title: 'Tee', variantTitle: 'S', sku: 'SKU-11', vendor: 'Acme', quantity: 1, currentQuantity: 1, requiresShipping: true, taxable: true, isGiftCard: false, originalUnitPriceSet: money('10.00'), originalTotalSet: money('10.00'), totalDiscountSet: money('1.00'), product: { id: 'gid://shopify/Product/1' }, variant: { id: 'gid://shopify/ProductVariant/11' }, image: null }]),
  }]),
  pages: page([{ id: 'gid://shopify/Page/1', handle: 'about', title: 'About', body: '<p>Hi</p>', templateSuffix: null, isPublished: true, publishedAt: '2026-01-01T00:00:00Z' }]),
  blogs: page([{ id: 'gid://shopify/Blog/1', handle: 'news', title: 'News', templateSuffix: null }]),
  articles: page([{ id: 'gid://shopify/Article/1', handle: 'hello', title: 'Hello', body: '<p>x</p>', summary: null, tags: ['t'], templateSuffix: null, publishedAt: '2026-01-01T00:00:00Z', author: { name: 'Ada' }, image: null, blog: { id: 'gid://shopify/Blog/1' } }]),
  menus: page([{ id: 'gid://shopify/Menu/1', handle: 'main-menu', title: 'Main', items: [
    { id: 'm1', title: 'Shop', type: 'COLLECTION', url: 'https://x.myshopify.com/collections/featured', resourceId: 'gid://shopify/Collection/1', items: [{ id: 'm2', title: 'Tee', type: 'PRODUCT', url: '/products/tee', resourceId: 'gid://shopify/Product/1', items: [] }] },
    { id: 'm3', title: 'Blog', type: 'HTTP', url: 'https://x.myshopify.com/blogs/news', resourceId: null, items: [] },
  ] }]),
  urlRedirects: page([{ id: 'gid://shopify/UrlRedirect/1', path: '/old', target: '/products/tee' }]),
};
const COUNTS: Record<string, string> = { productsCount: 'p', collectionsCount: 'c', customersCount: 'u', ordersCount: 'o' };

function fakeFetch(calls: string[], opts: { throttle?: boolean } = {}): typeof fetch {
  return (async (_url: string, init: { body: string }) => {
    const { query } = JSON.parse(init.body) as { query: string };
    calls.push(query);
    let data: Record<string, unknown> = {};
    const root = /^\s*(?:query[^{]*)?\{\s*(\w+)/.exec(query)?.[1] ?? '';
    if (root === 'shop') data = { shop: DATA.shop };
    else if (root in COUNTS) data = { [root]: { count: 2 } };
    else if (root === 'node') data = { node: {} };
    else if (root === 'collection') data = { collection: { products: page([{ id: 'gid://shopify/Product/1' }]) } };
    else if (root === 'themes') data = { themes: { nodes: [] } };
    else data = { [root]: DATA[root] };
    const cost = { requestedQueryCost: 50, actualQueryCost: 5, throttleStatus: { maximumAvailable: 1000, currentlyAvailable: opts.throttle ? 0 : 1000, restoreRate: 100 } };
    return new Response(JSON.stringify({ data, extensions: { cost } }), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as never;
}

let h: DbHandle; let shopId: number;
beforeAll(async () => {
  h = await createDb({ memory: true });
  await runMigrations(h);
  shopId = (await setupStore(h.db, { shopName: 'Local', email: 'o@example.com', password: 'correct horse', currency: 'USD', country: 'US', locale: 'en' })).shop.id;
}, 60_000);
afterAll(async () => { await h.close(); });

const run = (calls: string[] = []) => importFromShopify({
  db: h.db, shopId, storage: createLocalStorage(mkdtempSync(path.join(tmpdir(), 'mig-'))),
  client: new ShopifyClient({ shop: 'x', auth: { token: 't' }, fetch: fakeFetch(calls), sleep: async () => {} }),
  fetchImage: async () => ({ data: Buffer.from('png'), mimeType: 'image/png' }),
});
const rows = async (t: unknown) => h.db.select().from(t as never);

describe('Shopify importer', () => {
  it('maps every resource and reports per-phase counts', async () => {
    const sum = await run();
    const c = (p: keyof typeof sum.phases) => { const x = sum.phases[p]!; return [x.created, x.updated, x.failed]; };
    expect(sum.source).toBe('shopify:x.myshopify.com');
    expect(sum.phases.products!.errors).toEqual([]);
    expect(c('products')).toEqual([2, 0, 0]);
    expect(c('collections')).toEqual([2, 0, 0]);
    expect(c('customers')).toEqual([1, 0, 0]);
    expect(c('orders')).toEqual([1, 0, 0]);
    expect(c('pages')).toEqual([1, 0, 0]);
    expect(c('blogs')).toEqual([2, 0, 0]); // one blog + one article
    expect(c('menus')).toEqual([0, 1, 0]); // main-menu exists after setup
    expect(c('redirects')[0]).toBe(1);
    expect(sum.phases.policies!.updated).toBe(1);

    const [tee] = (await rows(s.products) as (typeof s.products.$inferSelect)[]).filter((p) => p.handle === 'tee');
    expect(tee).toMatchObject({ title: 'Tee', tags: ['a', 'b'], status: 'ACTIVE', seoTitle: 'SEO' });
    const variants = (await rows(s.productVariants)) as (typeof s.productVariants.$inferSelect)[];
    expect(variants.map((v) => [v.sku, v.price, v.compareAtPrice]).sort()).toEqual([['SKU-11', 1000, null], ['SKU-12', 1250, 1500], ['SKU-21', 1000, null]]);
    expect(variants.find((v) => v.sku === 'SKU-11')!.mediaId).not.toBeNull();
    const items = (await rows(s.inventoryItems)) as (typeof s.inventoryItems.$inferSelect)[];
    expect(items.find((i) => i.sku === 'SKU-11')).toMatchObject({ tracked: true, unitCost: 400, weightValue: 0.5 });
    const levels = (await rows(s.inventoryLevels)) as (typeof s.inventoryLevels.$inferSelect)[];
    expect(levels.find((l) => l.inventoryItemId === items.find((i) => i.sku === 'SKU-11')!.id)!.available).toBe(7);
    expect(((await rows(s.collections)) as (typeof s.collections.$inferSelect)[]).map((x) => [x.handle, x.isSmart, x.sortOrder]).sort()).toEqual([['featured', false, 'MANUAL'], ['shirts', true, 'BEST_SELLING']]);
    expect((await rows(s.collectionProducts)).length).toBe(2); // manual + smart match
    const [order] = (await rows(s.orders)) as (typeof s.orders.$inferSelect)[];
    expect(order).toMatchObject({ name: '#1042', orderNumber: 1042, total: 1500, totalTax: 100, financialStatus: 'PAID', fulfillmentStatus: 'FULFILLED', tags: ['b2b'] });
    expect(order!.createdAt.toISOString()).toBe('2026-01-02T03:04:05.000Z');
    const [line] = (await rows(s.orderLines)) as (typeof s.orderLines.$inferSelect)[];
    expect(line).toMatchObject({ title: 'Tee', unitPrice: 1000, discountedTotal: 900 });
    expect(line!.variantId).toBe(variants.find((v) => v.sku === 'SKU-11')!.id);
    const [cust] = (await rows(s.customers)) as (typeof s.customers.$inferSelect)[];
    expect(cust).toMatchObject({ email: 'ada@example.com', acceptsMarketing: true, numberOfOrders: 1, amountSpent: 1000 });
    expect((await rows(s.menuItems)).length).toBe(3);
    expect(((await rows(s.shops)) as (typeof s.shops.$inferSelect)[])[0]!.settings).toMatchObject({ policies: { REFUND_POLICY: { body: '<p>30 days</p>' } } });
    expect((await rows(s.importMappings)).length).toBeGreaterThan(10);
  }, 30_000);

  it('is idempotent: a re-run updates in place and keeps historical orders untouched', async () => {
    const before = { products: (await rows(s.products)).length, variants: (await rows(s.productVariants)).length, media: (await rows(s.media)).length, orders: (await rows(s.orders)).length, items: (await rows(s.menuItems)).length };
    const sum = await run();
    expect(sum.phases.products).toMatchObject({ created: 0, updated: 2, failed: 0 });
    expect(sum.phases.collections).toMatchObject({ created: 0, updated: 2 });
    expect(sum.phases.customers).toMatchObject({ created: 0, updated: 1 });
    expect(sum.phases.orders).toMatchObject({ created: 0, skipped: 1 });
    expect(sum.phases.pages).toMatchObject({ created: 0, updated: 1 });
    expect({ products: (await rows(s.products)).length, variants: (await rows(s.productVariants)).length, media: (await rows(s.media)).length, orders: (await rows(s.orders)).length, items: (await rows(s.menuItems)).length }).toEqual(before);
  }, 30_000);

  it('only runs the requested phases and reports a missing scope as a warning', async () => {
    const storage = createLocalStorage(mkdtempSync(path.join(tmpdir(), 'mig-')));
    const only = await importFromShopify({ db: h.db, shopId, storage, only: ['menus'], client: new ShopifyClient({ shop: 'x', auth: { token: 't' }, fetch: fakeFetch([]) }) });
    expect(Object.keys(only.phases)).toEqual(['menus']);
    const ok = fakeFetch([]);
    const deny = async (url: Parameters<typeof fetch>[0], init?: RequestInit) => (String(init?.body).includes('menus(')
      ? new Response(JSON.stringify({ errors: [{ message: 'Access denied for menus field.', extensions: { code: 'ACCESS_DENIED' } }] }))
      : ok(url, init));
    const denied = await importFromShopify({ db: h.db, shopId, storage, only: ['menus'], client: new ShopifyClient({ shop: 'x', auth: { token: 't' }, fetch: deny as typeof fetch }) });
    expect(denied.warnings[0]).toMatch(/Skipped menus/);
  }, 30_000);
});

describe('Shopify client throttle', () => {
  it('waits for the bucket to refill based on query cost and restore rate', async () => {
    const waits: number[] = [];
    const c = new ShopifyClient({ shop: 'x', auth: { token: 't' }, fetch: fakeFetch([], { throttle: true }), sleep: async (ms) => { waits.push(ms); }, onThrottle: () => {} });
    await c.query('{ shop { name } }', {}, 5);
    await c.query('{ shop { name } }', {}, 200); // bucket reported empty, 200 points at 100/s => about 2s
    expect(waits.length).toBe(1);
    expect(waits[0]).toBeGreaterThanOrEqual(2000);
  });

  it('retries THROTTLED responses and maps missing scopes to ACCESS_DENIED', async () => {
    let n = 0;
    const f = (async () => new Response(JSON.stringify(n++ === 0 ? { errors: [{ message: 'Throttled', extensions: { code: 'THROTTLED' } }] } : { data: { ok: true } }))) as never;
    expect(await new ShopifyClient({ shop: 'x', auth: { token: 't' }, fetch: f, sleep: async () => {} }).query('{ ok }')).toEqual({ ok: true });
    const denied = (async () => new Response(JSON.stringify({ errors: [{ message: 'Access denied for orders field.' }] }))) as never;
    await expect(new ShopifyClient({ shop: 'x', auth: { token: 't' }, fetch: denied }).query('{ orders }')).rejects.toMatchObject({ code: 'ACCESS_DENIED' });
    expect(ShopifyError).toBeDefined();
  });

  it('obtains a token with the client-credentials grant', async () => {
    const seen: string[] = [];
    const f = (async (url: string) => { seen.push(url); return new Response(JSON.stringify(url.includes('oauth') ? { access_token: 'abc', expires_in: 86400 } : { data: { ok: 1 } })); }) as never;
    await new ShopifyClient({ shop: 'https://my-shop.myshopify.com/', auth: { clientId: 'i', clientSecret: 's' }, fetch: f }).query('{ ok }');
    expect(seen[0]).toBe('https://my-shop.myshopify.com/admin/oauth/access_token');
    expect(seen[1]).toMatch(/\/admin\/api\/\d{4}-\d{2}\/graphql\.json$/);
  });
});
