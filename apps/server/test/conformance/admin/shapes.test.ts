import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { schema } from '../../../src/admin/graphql/schema';
import { createTestApp, setupAndLogin, type TestApp } from '../../../src/test-utils';
import { assertShape, buildSelection, loadFixture, makeGql, makeGqlOk } from '../helpers';
import { seedCatalog } from '../seed';

/**
 * Response shapes against fixtures derived from the reverse-engineered captures (paths and GraphQL types only).
 * The query is generated from the fixture, so a path our schema lacks fails here.
 */
describe('admin catalog response shapes', () => {
  let t: TestApp;
  let g: ReturnType<typeof makeGqlOk>;
  beforeAll(async () => {
    t = await createTestApp();
    g = makeGqlOk(makeGql(t.app, await setupAndLogin(t.app)));
    await seedCatalog(g);
  }, 120_000);
  afterAll(async () => { await t.close(); });

  for (const name of ['products', 'collections', 'locations']) {
    it(`${name} match the recorded shape`, async () => {
      const fx = loadFixture(name);
      const query = `{ ${fx.root}(first: 10) { nodes { ${buildSelection(schema, fx)} } } }`;
      const data = await g(query);
      const nodes = data[fx.root].nodes as unknown[];
      expect(nodes.length).toBeGreaterThan(0);
      assertShape(schema, fx, nodes);
    });
  }

  it('serves the fields the admin SPA lists', async () => {
    const data = await g(`{ products(first: 5) { nodes {
      id legacyResourceId title handle status vendor productType tags descriptionHtml createdAt updatedAt publishedAt templateSuffix seo { title description }
      options { id name position optionValues { id name hasVariants } } priceRangeV2 { minVariantPrice { amount currencyCode } maxVariantPrice { amount currencyCode } }
      featuredMedia { id } media(first: 5) { nodes { id } } totalInventory tracksInventory variantsCount { count } variants(first: 5) { nodes { id } }
      collections(first: 5) { nodes { id } } metafields(first: 5) { nodes { namespace key value type } } onlineStoreUrl hasOnlyDefaultVariant
    } }
    productVariants(first: 5) { nodes { id title sku barcode price compareAtPrice position taxable inventoryPolicy inventoryQuantity availableForSale selectedOptions { name value } image { url } media(first: 1) { nodes { id } }
      inventoryItem { id tracked requiresShipping unitCost { amount currencyCode } measurement { weight { unit value } } inventoryLevels(first: 5) { nodes { id location { id name } quantities(names: ["available"]) { name quantity } } } } product { id } } }
    collections(first: 5) { nodes { id title handle descriptionHtml sortOrder templateSuffix image { url } productsCount { count } ruleSet { appliedDisjunctively rules { column relation condition } } products(first: 5) { nodes { id } } seo { title description } updatedAt } }
    locations(first: 5) { nodes { id name isActive fulfillsOnlineOrders address { address1 city zip countryCode } } }
    productsCount { count precision } collectionsCount { count } }`);
    expect(data.products.nodes.length).toBe(3);
    const board = data.products.nodes.find((p: { title: string }) => p.title === 'The Minimal Snowboard');
    expect(board.legacyResourceId).toMatch(/^\d+$/);
    expect(board.id).toBe(`gid://shopify/Product/${board.legacyResourceId}`);
    expect(board.priceRangeV2.minVariantPrice).toEqual({ amount: '885.95', currencyCode: 'EUR' });
    expect(board.totalInventory).toBe(60);
    expect(board.hasOnlyDefaultVariant).toBe(true);
    expect(board.tags).toEqual(['board', 'winter']);
    expect(data.productsCount).toEqual({ count: 3, precision: 'EXACT' });
  });
});
