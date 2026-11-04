import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, setupAndLogin, type TestApp } from '../../../src/test-utils';
import { makeGql, makeGqlOk } from '../helpers';

describe('collections API', () => {
  let t: TestApp;
  let gql: ReturnType<typeof makeGql>;
  let g: ReturnType<typeof makeGqlOk>;
  const ids: Record<string, string> = {};
  beforeAll(async () => {
    t = await createTestApp();
    gql = makeGql(t.app, await setupAndLogin(t.app));
    g = makeGqlOk(gql);
    const mk = async (key: string, title: string, extra: string) => {
      const d = await g(`mutation { productCreate(product: { title: "${title}", ${extra} }) { product { id variants(first: 1) { nodes { id } } } userErrors { message } } }`);
      ids[key] = d.productCreate.product.id;
      ids[`${key}V`] = d.productCreate.product.variants.nodes[0].id;
      await g(`mutation { productVariantsBulkUpdate(productId: "${ids[key]}", variants: [{ id: "${ids[`${key}V`]}", price: "${key === 'cheap' ? '10.00' : key === 'mid' ? '500.00' : '900.00'}" }]) { userErrors { message } } }`);
    };
    await mk('cheap', 'Cheap Mug', 'vendor: "Acme", tags: ["kitchen"], productType: "Mug"');
    await mk('mid', 'Mid Board', 'vendor: "Snow Co", tags: ["winter"], productType: "Snowboard"');
    await mk('pricey', 'Pricey Board', 'vendor: "Snow Co", tags: ["winter", "premium"], productType: "Snowboard"');
  }, 120_000);
  afterAll(async () => { await t.close(); });

  const members = async (id: string) => (await g(`{ collection(id: "${id}") { productsCount { count } products(first: 20) { nodes { title } } } }`)).collection as { productsCount: { count: number }; products: { nodes: { title: string }[] } };
  const smart = async (rules: string, disjunctive = false, title = `Smart ${Math.random()}`) => {
    const d = await g(`mutation { collectionCreate(input: { title: "${title}", ruleSet: { appliedDisjunctively: ${disjunctive}, rules: [${rules}] } }) { collection { id ruleSet { appliedDisjunctively rules { column relation condition } } } userErrors { field message } } }`);
    expect(d.collectionCreate.userErrors).toEqual([]);
    return d.collectionCreate.collection as { id: string; ruleSet: unknown };
  };

  it('creates manual collections and manages membership', async () => {
    const d = await g(`mutation { collectionCreate(collection: { title: "Hand Picked", descriptionHtml: "<p>x</p>", seo: { title: "t", description: "d" }, sortOrder: ALPHA_ASC }) {
      collection { id handle title sortOrder descriptionHtml ruleSet { appliedDisjunctively } productsCount { count } seo { title description } } userErrors { field message } } }`);
    const c = d.collectionCreate.collection;
    expect(c).toMatchObject({ handle: 'hand-picked', title: 'Hand Picked', sortOrder: 'ALPHA_ASC', ruleSet: null, productsCount: { count: 0 }, seo: { title: 't', description: 'd' } });
    const add = await g(`mutation { collectionAddProducts(id: "${c.id}", productIds: ["${ids.mid}", "${ids.cheap}"]) { collection { productsCount { count } } userErrors { field message } } }`);
    expect(add.collectionAddProducts.collection.productsCount.count).toBe(2);
    expect((await members(c.id)).products.nodes.map((n) => n.title)).toEqual(['Cheap Mug', 'Mid Board']); // ALPHA_ASC
    await g(`mutation { collectionAddProducts(id: "${c.id}", productIds: ["${ids.mid}"]) { userErrors { message } } }`);
    expect((await members(c.id)).productsCount.count).toBe(2);
    const bad = await g(`mutation { collectionAddProducts(id: "${c.id}", productIds: ["gid://shopify/Product/424242"]) { collection { id } userErrors { field message } } }`);
    expect(bad.collectionAddProducts.collection).toBeNull();
    expect(bad.collectionAddProducts.userErrors).toHaveLength(1);
    const rm = await g(`mutation { collectionRemoveProducts(id: "${c.id}", productIds: ["${ids.mid}"]) { job { id done } userErrors { message } } }`);
    expect(rm.collectionRemoveProducts.job.done).toBe(true);
    expect((await members(c.id)).products.nodes.map((n) => n.title)).toEqual(['Cheap Mug']);
    const inProduct = await g(`{ product(id: "${ids.cheap}") { collections(first: 5) { nodes { title } } } }`);
    expect(inProduct.product.collections.nodes.map((n: { title: string }) => n.title)).toContain('Hand Picked');
    await g(`mutation { productUpdate(product: { id: "${ids.cheap}", collectionsToLeave: ["${c.id}"] }) { userErrors { message } } }`);
    expect((await members(c.id)).productsCount.count).toBe(0);
    await g(`mutation { productUpdate(product: { id: "${ids.cheap}", collectionsToJoin: ["${c.id}"] }) { userErrors { message } } }`);
    expect((await members(c.id)).productsCount.count).toBe(1);
  });

  it('keeps handles unique and validates titles', async () => {
    await g(`mutation { collectionCreate(input: { title: "Dup" }) { userErrors { message } } }`);
    const d = await g(`mutation { collectionCreate(input: { title: "Dup" }) { collection { handle } userErrors { message } } }`);
    expect(d.collectionCreate.collection.handle).toBe('dup-2');
    const blank = await g(`mutation { collectionCreate(collection: { title: "" }) { collection { id } userErrors { field message } } }`);
    expect(blank.collectionCreate.userErrors).toEqual([{ field: ['collection', 'title'], message: "Title can't be blank" }]);
  });

  it('evaluates smart collection rules (AND)', async () => {
    const c = await smart(`{ column: VARIANT_PRICE, relation: GREATER_THAN, condition: "100" }, { column: VARIANT_PRICE, relation: LESS_THAN, condition: "800.00" }`);
    expect((await members(c.id)).products.nodes.map((n) => n.title)).toEqual(['Mid Board']);
  });

  it('evaluates rules by tag, title, type, vendor with OR', async () => {
    const byTag = await smart(`{ column: TAG, relation: EQUALS, condition: "premium" }`);
    expect((await members(byTag.id)).products.nodes.map((n) => n.title)).toEqual(['Pricey Board']);
    const byVendor = await smart(`{ column: VENDOR, relation: EQUALS, condition: "snow co" }, { column: TITLE, relation: NOT_CONTAINS, condition: "pricey" }`);
    expect((await members(byVendor.id)).products.nodes.map((n) => n.title)).toEqual(['Mid Board']);
    const or = await smart(`{ column: TYPE, relation: STARTS_WITH, condition: "mug" }, { column: TAG, relation: ENDS_WITH, condition: "mium" }`, true);
    expect((await members(or.id)).products.nodes.map((n) => n.title).sort()).toEqual(['Cheap Mug', 'Pricey Board']);
    const notTag = await smart(`{ column: TAG, relation: NOT_EQUALS, condition: "winter" }`);
    expect((await members(notTag.id)).products.nodes.map((n) => n.title)).toEqual(['Cheap Mug']);
    const isSet = await smart(`{ column: VARIANT_COMPARE_AT_PRICE, relation: IS_NOT_SET, condition: "" }`);
    expect((await members(isSet.id)).productsCount.count).toBe(3);
  });

  it('recomputes membership when products change', async () => {
    const c = await smart(`{ column: TAG, relation: EQUALS, condition: "sale" }`);
    expect((await members(c.id)).productsCount.count).toBe(0);
    await g(`mutation { tagsAdd(id: "${ids.cheap}", tags: ["sale"]) { userErrors { message } } }`);
    expect((await members(c.id)).products.nodes.map((n) => n.title)).toEqual(['Cheap Mug']);
    await g(`mutation { productUpdate(product: { id: "${ids.mid}", tags: ["sale"] }) { userErrors { message } } }`);
    expect((await members(c.id)).productsCount.count).toBe(2);
    await g(`mutation { tagsRemove(id: "${ids.cheap}", tags: ["sale"]) { userErrors { message } } }`);
    expect((await members(c.id)).products.nodes.map((n) => n.title)).toEqual(['Mid Board']);
    await g(`mutation { productDelete(input: { id: "${ids.mid}" }) { userErrors { message } } }`);
    expect((await members(c.id)).productsCount.count).toBe(0);
    // price rule follows variant updates
    const p = await smart(`{ column: VARIANT_PRICE, relation: LESS_THAN, condition: "20" }`);
    expect((await members(p.id)).products.nodes.map((n) => n.title)).toEqual(['Cheap Mug']);
    await g(`mutation { productVariantsBulkUpdate(productId: "${ids.cheap}", variants: [{ id: "${ids.cheapV}", price: "25.00" }]) { userErrors { message } } }`);
    expect((await members(p.id)).productsCount.count).toBe(0);
  });

  it('follows inventory for VARIANT_INVENTORY rules', async () => {
    const stock = await g(`{ productVariant(id: "${ids.priceyV}") { inventoryItem { id } } locations(first: 1) { nodes { id } } }`);
    await g(`mutation { inventoryItemUpdate(id: "${stock.productVariant.inventoryItem.id}", input: { tracked: true }) { userErrors { message } } }`);
    const c = await smart(`{ column: VARIANT_INVENTORY, relation: GREATER_THAN, condition: "5" }`);
    expect((await members(c.id)).productsCount.count).toBe(0);
    await g(`mutation { inventorySetQuantities(input: { name: "available", reason: "correction", quantities: [{ inventoryItemId: "${stock.productVariant.inventoryItem.id}", locationId: "${stock.locations.nodes[0].id}", quantity: 9 }] }) { userErrors { message } } }`);
    expect((await members(c.id)).products.nodes.map((n) => n.title)).toEqual(['Pricey Board']);
  });

  it('rejects invalid rules and manual edits of smart collections', async () => {
    const bad = await g(`mutation { collectionCreate(input: { title: "Bad", ruleSet: { appliedDisjunctively: false, rules: [{ column: VARIANT_PRICE, relation: CONTAINS, condition: "1" }] } }) { collection { id } userErrors { field message } } }`);
    expect(bad.collectionCreate.collection).toBeNull();
    expect(bad.collectionCreate.userErrors[0].field).toEqual(['input', 'ruleSet', 'rules', '0', 'relation']);
    const c = await smart(`{ column: TAG, relation: EQUALS, condition: "winter" }`);
    const add = await g(`mutation { collectionAddProducts(id: "${c.id}", productIds: ["${ids.cheap}"]) { userErrors { message } } }`);
    expect(add.collectionAddProducts.userErrors[0].message).toMatch(/smart collection/);
  });

  it('updates rules, lists, counts and deletes', async () => {
    const c = await smart(`{ column: TAG, relation: EQUALS, condition: "kitchen" }`, false, 'To Update');
    const u = await g(`mutation { collectionUpdate(collection: { id: "${c.id}", title: "Renamed", handle: "renamed" }) { collection { title handle } job { id } userErrors { message } } }`);
    expect(u.collectionUpdate.collection).toEqual({ title: 'Renamed', handle: 'renamed' });
    await g(`mutation { collectionUpdate(input: { id: "${c.id}", ruleSet: { appliedDisjunctively: false, rules: [{ column: TAG, relation: EQUALS, condition: "premium" }] } }) { userErrors { message } } }`);
    expect((await members(c.id)).products.nodes.map((n) => n.title)).toEqual(['Pricey Board']);
    expect((await g(`{ collectionByHandle(handle: "renamed") { id } collectionByIdentifier(identifier: { handle: "renamed" }) { id } }`))).toEqual({ collectionByHandle: { id: c.id }, collectionByIdentifier: { id: c.id } });
    const list = await g(`{ collections(first: 50, query: "title:Renamed") { nodes { id } } collectionsCount(query: "collection_type:smart") { count } }`);
    expect(list.collections.nodes).toEqual([{ id: c.id }]);
    expect(list.collectionsCount.count).toBeGreaterThan(3);
    const del = await g(`mutation { collectionDelete(input: { id: "${c.id}" }) { deletedCollectionId userErrors { message } } }`);
    expect(del.collectionDelete.deletedCollectionId).toBe(c.id);
    expect((await g(`{ collection(id: "${c.id}") { id } node(id: "${c.id}") { id } }`))).toEqual({ collection: null, node: null });
  });
});
