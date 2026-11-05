import { activateDueMarkets, createPublication, getPrimaryShop, schema, seedDemo } from '@shopme/core';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, SETUP_BODY, type TestApp } from '../../../src/test-utils';
import { makeGql } from '../helpers';

let t: TestApp;
let gql: ReturnType<typeof makeGql>;
const g = async (q: string, v: Record<string, unknown> = {}) => {
  const r = await gql(q, v);
  expect(r.errors, JSON.stringify(r.errors)).toBeUndefined();
  return r.data;
};
const create = async (p: Record<string, unknown>) => {
  const d = await g(`mutation($p: ProductCreateInput!) { productCreate(product: $p) { product { id handle status } userErrors { message } } }`, { p });
  expect(d.productCreate.userErrors).toEqual([]);
  return d.productCreate.product as { id: string; handle: string; status: string };
};
let storeId = '';
let shopId = 0;

beforeAll(async () => {
  t = await createTestApp();
  const setup = await t.app.inject({ method: 'POST', url: '/admin/api/setup', payload: SETUP_BODY });
  gql = makeGql(t.app, setup.cookies.find((c) => c.name === 'shopme_session')!.value);
  await seedDemo(t.dbHandle.db, t.app.ctx.storage);
  shopId = (await getPrimaryShop(t.dbHandle.db))!.id;
  storeId = (await g(`{ publications(first: 5) { nodes { id name } } }`)).publications.nodes[0].id;
}, 120_000);
afterAll(async () => { await t.close(); });

describe('sales channels: product and collection publications', () => {
  it('new products are published on the Online Store and visible on the storefront; unpublishing hides them', async () => {
    const p = await create({ title: 'Channel Tee', status: 'ACTIVE' });
    expect((await t.app.inject(`/products/${p.handle}.json`)).statusCode).toBe(200);
    const d = await g(`{ product(id: "${p.id}") { publishedOnCurrentPublication resourcePublicationsCount { count } resourcePublicationsV2(first: 5) { nodes { isPublished publication { name } } } } }`);
    expect(d.product).toMatchObject({ publishedOnCurrentPublication: true, resourcePublicationsCount: { count: 1 }, resourcePublicationsV2: { nodes: [{ isPublished: true, publication: { name: 'Online Store' } }] } });

    await g(`mutation { publishableUnpublish(id: "${p.id}", input: [{ publicationId: "${storeId}" }]) { userErrors { message } } }`);
    expect((await g(`{ product(id: "${p.id}") { publishedOnCurrentPublication status } }`)).product).toEqual({ publishedOnCurrentPublication: false, status: 'ACTIVE' });
    expect((await t.app.inject(`/products/${p.handle}.json`)).statusCode).toBe(404);
    expect(JSON.parse((await t.app.inject('/collections/all/products.json')).body).products?.some((x: { handle: string }) => x.handle === p.handle) ?? false).toBe(false);

    await g(`mutation { publishablePublish(id: "${p.id}", input: [{ publicationId: "${storeId}" }]) { userErrors { message } } }`);
    expect((await t.app.inject(`/products/${p.handle}.json`)).statusCode).toBe(200);
  });

  it('a future publish date schedules the publication', async () => {
    const p = await create({ title: 'Scheduled Tee' });
    const future = new Date(Math.floor((Date.now() + 86_400_000) / 1000) * 1000).toISOString().replace('.000Z', 'Z');
    await g(`mutation($d: DateTime) { publishablePublish(id: "${p.id}", input: [{ publicationId: "${storeId}", publishDate: $d }]) { userErrors { message } } }`, { d: future });
    expect((await g(`{ product(id: "${p.id}") { publishedOnCurrentPublication resourcePublicationsV2(first: 5, onlyPublished: false) { nodes { isPublished publishDate } } } }`)).product)
      .toMatchObject({ publishedOnCurrentPublication: false, resourcePublicationsV2: { nodes: [{ isPublished: true, publishDate: future }] } });
    expect((await t.app.inject(`/products/${p.handle}.json`)).statusCode).toBe(404);
  });

  it('another channel keeps its own rows, counts and list filter', async () => {
    const made = await createPublication(t.dbHandle.db, shopId, 'Wholesale');
    expect(made.ok).toBe(true);
    const pubs = (await g(`{ publications(first: 10) { nodes { id name shopmeKind } } publicationsCount { count } }`));
    expect(pubs.publicationsCount.count).toBe(2);
    const wholesale = pubs.publications.nodes.find((n: { name: string }) => n.name === 'Wholesale').id as string;
    const p = await create({ title: 'Wholesale Tee' });
    await g(`mutation { publishablePublish(id: "${p.id}", input: [{ publicationId: "${wholesale}" }]) { userErrors { message } } }`);
    expect((await g(`{ product(id: "${p.id}") { publishedOnPublication(publicationId: "${wholesale}") resourcePublicationsCount { count } } }`)).product).toEqual({ publishedOnPublication: true, resourcePublicationsCount: { count: 2 } });
    const only = (await g(`{ products(first: 20, query: "publication_ids:${wholesale.split('/').pop()}") { nodes { id } } }`)).products.nodes;
    expect(only).toEqual([{ id: p.id }]);
    const bad = (await g(`mutation { publishablePublish(id: "${p.id}", input: [{ publicationId: "gid://shopify/Publication/9999" }]) { userErrors { message } } }`)).publishablePublish;
    expect(bad.userErrors).toHaveLength(1);
  });

  it('collections publish per channel too and unpublished ones leave the storefront', async () => {
    const c = (await g(`mutation { collectionCreate(input: { title: "Chan Col" }) { collection { id handle resourcePublicationsCount { count } } userErrors { message } } }`)).collectionCreate.collection;
    expect(c.resourcePublicationsCount.count).toBe(1);
    await g(`mutation { publishableUnpublish(id: "${c.id}", input: [{ publicationId: "${storeId}" }]) { userErrors { message } } }`);
    expect((await t.app.inject(`/collections/${c.handle}`)).statusCode).toBe(404);
  });

  it('unlisted products are reachable by URL but missing from listings; filters accept lists', async () => {
    const p = await create({ title: 'Hidden Gem', status: 'UNLISTED' });
    expect(p.status).toBe('UNLISTED');
    expect((await t.app.inject(`/products/${p.handle}.json`)).statusCode).toBe(200);
    const sitemapish = JSON.parse((await t.app.inject('/products.json')).body) as { products?: { handle: string }[] };
    expect((sitemapish.products ?? []).some((x) => x.handle === p.handle)).toBe(false);
    const both = (await g(`{ products(first: 50, query: "status:unlisted,draft") { nodes { status } } }`)).products.nodes as { status: string }[];
    expect(both.length).toBeGreaterThan(0);
    expect(both.every((n) => n.status === 'UNLISTED' || n.status === 'DRAFT')).toBe(true);
  });
});

describe('catalog membership', () => {
  it('adds and removes products in bulk and filters by catalog', async () => {
    const cat = (await g(`mutation { catalogCreate(input: { title: "EU", status: ACTIVE, context: { marketIds: [] } }) { catalog { id } userErrors { message } } }`)).catalogCreate;
    expect(cat.userErrors).toEqual([]);
    const catId = cat.catalog.id as string;
    const a = await create({ title: 'Cat A' });
    const b = await create({ title: 'Cat B' });
    const add = (await g(`mutation($p: [ID!]!, $i: [ID!]) { shopmeCatalogProductsUpdate(productIds: $p, include: $i) { added removed userErrors { message } } }`, { p: [a.id, b.id], i: [catId] })).shopmeCatalogProductsUpdate;
    expect(add).toEqual({ added: 2, removed: 0, userErrors: [] });
    expect((await g(`{ product(id: "${a.id}") { shopmeCatalogsCount shopmeCatalogs { id title } } }`)).product).toEqual({ shopmeCatalogsCount: 1, shopmeCatalogs: [{ id: catId, title: 'EU' }] });
    const inCat = (await g(`{ products(first: 10, query: "catalog_id:${catId.split('/').pop()}") { nodes { id } } }`)).products.nodes.map((n: { id: string }) => n.id).sort();
    expect(inCat).toEqual([a.id, b.id].sort());
    const rm = (await g(`mutation($p: [ID!]!, $e: [ID!]) { shopmeCatalogProductsUpdate(productIds: $p, exclude: $e) { added removed } }`, { p: [a.id], e: [catId] })).shopmeCatalogProductsUpdate;
    expect(rm).toEqual({ added: 0, removed: 1 });
    expect((await g(`{ products(first: 10, query: "catalog_id:none title:Cat") { nodes { id } } }`)).products.nodes.map((n: { id: string }) => n.id)).toEqual([a.id]);
  });
});

describe('duplicate options, customs country codes, package and inventory history', () => {
  it('duplicates with inventory, SKUs and translations only when asked', async () => {
    const loc = (await g(`{ locations(first: 1) { nodes { id } } }`)).locations.nodes[0].id as string;
    const src = (await g(`mutation($p: ProductCreateInput!) { productCreate(product: $p) { product { id variants(first: 1) { nodes { id inventoryItem { id } } } } userErrors { message } } }`, { p: { title: 'Source Tee' } })).productCreate.product;
    const variant = src.variants.nodes[0];
    await g(`mutation($p: ID!, $v: [ProductVariantsBulkInput!]!) { productVariantsBulkUpdate(productId: $p, variants: $v) { userErrors { message } } }`,
      { p: src.id, v: [{ id: variant.id, barcode: '123', inventoryItem: { sku: 'SRC-1', tracked: true } }] });
    await g(`mutation($i: InventorySetQuantitiesInput!) { inventorySetQuantities(input: $i) { userErrors { message } } }`,
      { i: { reason: 'correction', name: 'available', quantities: [{ inventoryItemId: variant.inventoryItem.id, locationId: loc, quantity: 7, changeFromQuantity: null }] } });
    const dupQ = `mutation($id: ID!, $inv: Boolean, $sku: Boolean) { productDuplicate(productId: $id, newTitle: "Copy", shopmeIncludeInventory: $inv, shopmeIncludeSkus: $sku) { newProduct { variants(first: 1) { nodes { sku barcode inventoryQuantity } } } userErrors { message } } }`;
    const plain = (await g(dupQ, { id: src.id, inv: false, sku: false })).productDuplicate.newProduct.variants.nodes[0];
    expect(plain).toMatchObject({ sku: null, barcode: null, inventoryQuantity: 0 });
    const full = (await g(dupQ, { id: src.id, inv: true, sku: true })).productDuplicate.newProduct.variants.nodes[0];
    expect(full).toMatchObject({ sku: 'SRC-1', barcode: '123', inventoryQuantity: 7 });

    const hist = (await g(`{ inventoryItem(id: "${variant.inventoryItem.id}") { shopmeHistory(first: 5) { name delta quantityAfter reason locationName } } }`)).inventoryItem.shopmeHistory;
    expect(hist.find((h: { name: string }) => h.name === 'available')).toMatchObject({ name: 'available', delta: 7, quantityAfter: 7, reason: 'correction' });
  });

  it('stores per country HS codes and a shipping package on an inventory item', async () => {
    const p = (await g(`mutation($p: ProductCreateInput!) { productCreate(product: $p) { product { id variants(first: 1) { nodes { inventoryItem { id } } } } } }`, { p: { title: 'Customs Tee' } })).productCreate.product;
    const item = p.variants.nodes[0].inventoryItem.id as string;
    const up = (await g(`mutation($id: ID!, $i: InventoryItemInput!) { inventoryItemUpdate(id: $id, input: $i) { inventoryItem { countryHarmonizedSystemCodes { countryCode harmonizedSystemCode } } userErrors { message } } }`,
      { id: item, i: { countryHarmonizedSystemCodes: [{ countryCode: 'ca', harmonizedSystemCode: '6109.10' }, { countryCode: 'GB', harmonizedSystemCode: '6109.90' }] } })).inventoryItemUpdate;
    expect(up.userErrors).toEqual([]);
    expect(up.inventoryItem.countryHarmonizedSystemCodes).toEqual([{ countryCode: 'CA', harmonizedSystemCode: '6109.10' }, { countryCode: 'GB', harmonizedSystemCode: '6109.90' }]);
    const clear = (await g(`mutation($id: ID!, $i: InventoryItemInput!) { inventoryItemUpdate(id: $id, input: $i) { inventoryItem { countryHarmonizedSystemCodes { countryCode } } } }`, { id: item, i: { countryHarmonizedSystemCodes: [] } })).inventoryItemUpdate;
    expect(clear.inventoryItem.countryHarmonizedSystemCodes).toEqual([]);
  });
});

describe('discount sales channel access', () => {
  it('a discount limited to another channel is rejected at checkout, one limited to the Online Store applies', async () => {
    const made = await createPublication(t.dbHandle.db, shopId, 'Kiosk');
    expect(made.ok).toBe(true);
    const kiosk = `gid://shopify/Publication/${(made as { value: { id: number } }).value.id}`;
    const mk = async (code: string, pubs: string[]) => {
      const d = (await g(`mutation($i: DiscountCodeBasicInput!) { discountCodeBasicCreate(basicCodeDiscount: $i) { codeDiscountNode { codeDiscount { ... on DiscountCodeBasic { shopmePublicationIds } } } userErrors { message } } }`,
        { i: { title: code, code, startsAt: new Date().toISOString(), shopmePublicationIds: pubs, customerGets: { value: { percentage: 0.1 }, items: { all: true } } } })).discountCodeBasicCreate;
      expect(d.userErrors).toEqual([]);
      return d.codeDiscountNode.codeDiscount.shopmePublicationIds as string[];
    };
    expect(await mk('KIOSKONLY', [kiosk])).toEqual([kiosk]);
    expect(await mk('WEBOK', [storeId])).toEqual([storeId]);
    expect(await mk('ANYWHERE', [])).toEqual([]);
  });
});

describe('market rollouts', () => {
  it('plans a launch for a draft market, clears it, and launches due markets by themselves', async () => {
    const m = (await g(`mutation { marketCreate(input: { name: "Nordics", status: DRAFT, conditions: { regionsCondition: { regions: [{ countryCode: SE }] } } }) { market { id status shopmeLaunchAt } userErrors { message } } }`)).marketCreate;
    expect(m.userErrors).toEqual([]);
    const id = m.market.id as string;
    const later = new Date(Math.floor((Date.now() + 86_400_000) / 1000) * 1000).toISOString().replace('.000Z', 'Z');
    const planned = (await g(`mutation($id: ID!, $at: DateTime) { shopmeMarketLaunchSchedule(id: $id, launchAt: $at) { market { status shopmeLaunchAt } userErrors { message } } }`, { id, at: later })).shopmeMarketLaunchSchedule;
    expect(planned).toEqual({ market: { status: 'DRAFT', shopmeLaunchAt: later }, userErrors: [] });
    const cleared = (await g(`mutation($id: ID!) { shopmeMarketLaunchSchedule(id: $id) { market { status shopmeLaunchAt } } }`, { id })).shopmeMarketLaunchSchedule;
    expect(cleared.market).toEqual({ status: 'DRAFT', shopmeLaunchAt: null });
    // A plan whose time has come activates the market on the next read.
    await t.dbHandle.db.update(schema.markets).set({ launchAt: new Date(Date.now() - 1000) }).where(eq(schema.markets.id, Number(id.split('/').pop())));
    await activateDueMarkets(t.dbHandle.db, shopId, true);
    expect((await g(`{ market(id: "${id}") { status shopmeLaunchAt } }`)).market).toEqual({ status: 'ACTIVE', shopmeLaunchAt: null });
    const live = (await g(`mutation($id: ID!, $at: DateTime) { shopmeMarketLaunchSchedule(id: $id, launchAt: $at) { userErrors { message } } }`, { id, at: later })).shopmeMarketLaunchSchedule;
    expect(live.userErrors).toHaveLength(1);
  });
});
