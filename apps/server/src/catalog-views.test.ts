import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { abcClasses, createLocalStorage, schema as s, seedDemo, type Mail } from '@shopme/core';
import { createTestApp, SETUP_BODY, type TestApp } from './test-utils';
import { makeGql, makeGqlOk } from '../test/conformance/helpers';

let t: TestApp;
let g: ReturnType<typeof makeGqlOk>;
let gql: ReturnType<typeof makeGql>;
let sent: Mail[];
const sku: Record<string, number> = {};
const db = () => t.dbHandle.db;

beforeAll(async () => {
  t = await createTestApp();
  const setup = await t.app.inject({ method: 'POST', url: '/admin/api/setup', payload: SETUP_BODY });
  const cookie = setup.cookies.find((c) => c.name === 'shopme_session')!.value;
  gql = makeGql(t.app, cookie);
  g = makeGqlOk(gql);
  await seedDemo(t.dbHandle.db, createLocalStorage(mkdtempSync(path.join(tmpdir(), 'cv-'))));
  for (const v of await db().select().from(s.productVariants)) if (v.sku) sku[v.sku] = v.id;
  sent = [];
  t.app.ctx.mailer = { send: async (m) => { sent.push(m); } };
}, 90_000);
afterAll(async () => { await t.close(); });

const until = async <T>(fn: () => Promise<T | null | undefined | false>, ms = 6000): Promise<T> => {
  const end = Date.now() + ms;
  for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) throw new Error('timeout'); await new Promise((r) => setTimeout(r, 50)); }
};

describe('saved views (saved searches)', () => {
  const create = (input: Record<string, unknown>) => gql(`mutation($i: SavedSearchCreateInput!) { savedSearchCreate(input: $i) { savedSearch { id name query params searchTerms resourceType filters { key value } } userErrors { field message } } }`, { i: input });

  it('creates, lists per list type, renames, updates and deletes views', async () => {
    const made = (await create({ resourceType: 'PRODUCT', name: 'Low stock', query: 'status:active inventory_total:<=5 boots', params: 'status=active&stock=out&sort=TITLE' })).data.savedSearchCreate;
    expect(made.userErrors).toEqual([]);
    expect(made.savedSearch).toMatchObject({ name: 'Low stock', resourceType: 'PRODUCT', searchTerms: 'boots', params: 'status=active&stock=out&sort=TITLE' });
    expect(made.savedSearch.filters).toEqual([{ key: 'status', value: 'active' }, { key: 'inventory_total', value: '<=5' }]);
    await create({ resourceType: 'ORDER', name: 'Unpaid', query: 'financial_status:pending' });
    await create({ resourceType: 'INVENTORY', name: 'Out of stock', query: '' });
    await create({ resourceType: 'PRODUCT', name: 'Second', query: '' });

    const lists = await g(`{ p: productSavedSearches(first: 10) { nodes { name } } o: orderSavedSearches(first: 10) { nodes { name } } c: customerSavedSearches(first: 10) { nodes { name } } i: inventorySavedSearches(first: 10) { nodes { name } } }`);
    expect(lists.p.nodes.map((n: { name: string }) => n.name)).toEqual(['Low stock', 'Second']);
    expect(lists.o.nodes).toEqual([{ name: 'Unpaid' }]);
    expect(lists.c.nodes).toEqual([]);
    expect(lists.i.nodes).toEqual([{ name: 'Out of stock' }]);

    const id = made.savedSearch.id as string;
    const upd = (await gql(`mutation($i: SavedSearchUpdateInput!) { savedSearchUpdate(input: $i) { savedSearch { name query } userErrors { field message } } }`, { i: { id, name: 'Nearly out', query: 'inventory_total:<=2' } })).data.savedSearchUpdate;
    expect(upd).toEqual({ savedSearch: { name: 'Nearly out', query: 'inventory_total:<=2' }, userErrors: [] });
    const clash = (await gql(`mutation($i: SavedSearchUpdateInput!) { savedSearchUpdate(input: $i) { userErrors { field message } } }`, { i: { id, name: 'second' } })).data.savedSearchUpdate;
    expect(clash.userErrors).toEqual([{ field: ['input', 'name'], message: 'Name has already been taken' }]);

    const del = (await gql(`mutation($i: SavedSearchDeleteInput!) { savedSearchDelete(input: $i) { deletedSavedSearchId userErrors { message } } }`, { i: { id } })).data.savedSearchDelete;
    expect(del).toEqual({ deletedSavedSearchId: id, userErrors: [] });
    expect((await gql(`mutation($i: SavedSearchDeleteInput!) { savedSearchDelete(input: $i) { userErrors { message } } }`, { i: { id } })).data.savedSearchDelete.userErrors).toHaveLength(1);
    expect((await g(`{ productSavedSearches(first: 10) { nodes { name } } }`)).productSavedSearches.nodes).toEqual([{ name: 'Second' }]);
  });

  it('rejects blank, duplicate and unsupported views', async () => {
    expect((await create({ resourceType: 'PRODUCT', name: '  ', query: '' })).data.savedSearchCreate.userErrors[0]).toMatchObject({ field: ['input', 'name'] });
    expect((await create({ resourceType: 'PRODUCT', name: 'second', query: '' })).data.savedSearchCreate.userErrors[0]).toMatchObject({ field: ['input', 'name'], message: 'Name has already been taken' });
    expect((await create({ resourceType: 'PRODUCT', name: 'x'.repeat(41), query: '' })).data.savedSearchCreate.userErrors[0].message).toContain('too long');
    expect((await create({ resourceType: 'FILE', name: 'Files', query: '' })).data.savedSearchCreate.userErrors[0]).toMatchObject({ field: ['input', 'resourceType'] });
    // the same name is fine in another list
    expect((await create({ resourceType: 'ORDER', name: 'second', query: '' })).data.savedSearchCreate.userErrors).toEqual([]);
  });
});

describe('shipping fields of an inventory item', () => {
  it('stores package dimensions, origin and HS code', async () => {
    const item = (await g(`query($id: ID!) { productVariant(id: $id) { inventoryItem { id } } }`, { id: `gid://shopify/ProductVariant/${sku['HEB-250']}` })).productVariant.inventoryItem.id;
    const r = await g(`mutation($id: ID!, $i: InventoryItemInput!) { inventoryItemUpdate(id: $id, input: $i) { inventoryItem { requiresShipping countryCodeOfOrigin harmonizedSystemCode measurement { weight { value unit } dimensions { length width height unit } } } userErrors { message } } }`, {
      id: item, i: { requiresShipping: true, countryCodeOfOrigin: 'FR', harmonizedSystemCode: '0902.30', measurement: { weight: { value: 250, unit: 'GRAMS' }, dimensions: { length: 20, width: 10.5, height: 5, unit: 'CENTIMETERS' } } },
    });
    expect(r.inventoryItemUpdate.userErrors).toEqual([]);
    expect(r.inventoryItemUpdate.inventoryItem).toEqual({
      requiresShipping: true, countryCodeOfOrigin: 'FR', harmonizedSystemCode: '0902.30',
      measurement: { weight: { value: 250, unit: 'GRAMS' }, dimensions: { length: 20, width: 10.5, height: 5, unit: 'CENTIMETERS' } },
    });
    const bad = await g(`mutation($id: ID!, $i: InventoryItemInput!) { inventoryItemUpdate(id: $id, input: $i) { userErrors { message } } }`, { id: item, i: { measurement: { dimensions: { length: -1 } } } });
    expect(bad.inventoryItemUpdate.userErrors).toHaveLength(1);
  });

  it('the weight of the items feeds the grams of a cart (weight-based rates)', async () => {
    const add = await t.app.inject({ method: 'POST', url: '/cart/add.js', payload: { id: sku['HEB-250'], quantity: 3 } });
    expect(add.statusCode).toBe(200);
    const cart = add.cookies.find((c) => c.name === 'cart')!.value;
    expect((await t.app.inject({ method: 'GET', url: '/cart.js', cookies: { cart } })).json().total_weight).toBe(750);
  });
});

describe('gift card products', () => {
  it('creates a product flagged as gift card without shipping, and the order lists the cards issued', async () => {
    const created = await g(`mutation($p: ProductCreateInput!) { productCreate(product: $p) { product { id isGiftCard variants(first: 1) { nodes { id inventoryItem { requiresShipping } } } } userErrors { message } } }`, { p: { title: 'Gift card', giftCard: true, status: 'ACTIVE' } });
    expect(created.productCreate.userErrors).toEqual([]);
    const p = created.productCreate.product;
    expect(p.isGiftCard).toBe(true);
    expect(p.variants.nodes[0].inventoryItem.requiresShipping).toBe(false);
    await g(`mutation($id: ID!, $v: [ProductVariantsBulkInput!]!) { productVariantsBulkUpdate(productId: $id, variants: $v) { userErrors { message } } }`, { id: p.id, v: [{ id: p.variants.nodes[0].id, price: '40.00', inventoryPolicy: 'CONTINUE' }] });

    const variantId = Number(p.variants.nodes[0].id.split('/').pop());
    const add = await t.app.inject({ method: 'POST', url: '/cart/add.js', payload: { id: variantId, quantity: 1, properties: { 'Recipient email': 'pal@example.com' } } });
    const cart = add.cookies.find((c) => c.name === 'cart')!.value;
    const go = await t.app.inject({ method: 'POST', url: '/checkout', cookies: { cart } });
    const token = go.headers.location!.toString().split('/').pop()!;
    const address = { email: 'buyer@example.com', firstName: 'Ada', lastName: 'L', address1: '1 Rue', city: 'Paris', zip: '75001', countryCode: 'FR', phone: '' };
    await t.app.inject({ method: 'POST', url: `/checkouts/${token}/refresh`, payload: address });
    const done = await t.app.inject({ method: 'POST', url: `/checkouts/${token}/complete`, payload: new URLSearchParams({ ...address, paymentMethod: 'bank_transfer' }).toString(), headers: { 'content-type': 'application/x-www-form-urlencoded' } });
    expect(done.statusCode).toBe(303);
    const order = (await db().select().from(s.orders).where(eq(s.orders.cartToken, token)))[0]!;
    const orderGid = `gid://shopify/Order/${order.id}`;
    expect((await g(`query($id: ID!) { order(id: $id) { shopmeIssuedGiftCards { id } } }`, { id: orderGid })).order.shopmeIssuedGiftCards).toEqual([]);

    sent.length = 0;
    await g(`mutation($id: ID!) { orderMarkAsPaid(input: { id: $id }) { userErrors { message } } }`, { id: orderGid });
    const cards = await until(async () => { const r = (await g(`query($id: ID!) { order(id: $id) { shopmeIssuedGiftCards { initialValue { amount } lastCharacters } } }`, { id: orderGid })).order.shopmeIssuedGiftCards; return r.length ? r : null; });
    expect(cards).toHaveLength(1);
    expect(cards[0].initialValue.amount).toBe('40.0');
    await until(async () => sent.some((m) => m.to === 'pal@example.com'));
  });
});

describe('products metrics', () => {
  it('ranks products by revenue into A, B and C', () => {
    expect(abcClasses([])).toEqual({ a: 0, b: 0, c: 0 });
    expect(abcClasses([{ id: 1, revenue: 100 }])).toEqual({ a: 1, b: 0, c: 0 });
    const rows = [{ id: 1, revenue: 7000 }, { id: 2, revenue: 1500 }, { id: 3, revenue: 900 }, { id: 4, revenue: 400 }, { id: 5, revenue: 200 }, { id: 6, revenue: 0 }];
    // shares before each product: 0, .70, .85, .94, .98: A A B B C, then the unsold one is a C
    expect(abcClasses(rows)).toEqual({ a: 2, b: 2, c: 2 });
  });

  it('computes sell-through and days of stock left from orders and inventory', async () => {
    const add = await t.app.inject({ method: 'POST', url: '/cart/add.js', payload: { id: sku['HEB-250'], quantity: 2 } });
    const cart = add.cookies.find((c) => c.name === 'cart')!.value;
    const token = (await t.app.inject({ method: 'POST', url: '/checkout', cookies: { cart } })).headers.location!.toString().split('/').pop()!;
    const address = { email: 'm@example.com', firstName: 'Ada', lastName: 'L', address1: '1 Rue', city: 'Paris', zip: '75001', countryCode: 'FR', phone: '' };
    await t.app.inject({ method: 'POST', url: `/checkouts/${token}/refresh`, payload: address });
    expect((await t.app.inject({ method: 'POST', url: `/checkouts/${token}/complete`, payload: new URLSearchParams({ ...address, paymentMethod: 'bank_transfer' }).toString(), headers: { 'content-type': 'application/x-www-form-urlencoded' } })).statusCode).toBe(303);
    const m = (await g(`{ shopmeProductMetrics(days: 30) { days unitsSold unitsInStock sellThroughRate daysOfStockLeft unsold abc { a b c } } }`)).shopmeProductMetrics;
    expect(m.days).toBe(30);
    expect(m.unitsInStock).toBeGreaterThan(0);
    expect(m.abc.a + m.abc.b + m.abc.c).toBeGreaterThan(0);
    expect(m.unitsSold).toBeGreaterThanOrEqual(2);
    expect(m.sellThroughRate).toBeCloseTo(m.unitsSold / (m.unitsSold + m.unitsInStock), 5);
    expect(m.daysOfStockLeft).toBe(Math.round(m.unitsInStock / (m.unitsSold / 30)));
    expect(m.abc.a).toBeGreaterThanOrEqual(1);
  });
});
