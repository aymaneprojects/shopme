import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, setupAndLogin, type TestApp } from '../../../src/test-utils';
import { makeGql, makeGqlOk } from '../helpers';
import { seedCatalog } from '../seed';

describe('inventory, locations, metafields and files API', () => {
  let t: TestApp;
  let gql: ReturnType<typeof makeGql>;
  let g: ReturnType<typeof makeGqlOk>;
  let s: Awaited<ReturnType<typeof seedCatalog>>;
  beforeAll(async () => {
    t = await createTestApp();
    gql = makeGql(t.app, await setupAndLogin(t.app));
    g = makeGqlOk(gql);
    s = await seedCatalog(g);
  }, 120_000);
  afterAll(async () => { await t.close(); });

  const item = () => s.minimalVariant.inventoryItem.id as string;
  const levels = async () => (await g(`{ inventoryItem(id: "${item()}") { inventoryLevels(first: 10) { nodes { id location { id } quantities(names: ["available", "on_hand", "committed", "incoming", "reserved"]) { name quantity } } } } }`))
    .inventoryItem.inventoryLevels.nodes as { id: string; location: { id: string }; quantities: { name: string; quantity: number }[] }[];
  const q = (l: { quantities: { name: string; quantity: number }[] }, name: string) => l.quantities.find((x) => x.name === name)!.quantity;

  it('lists locations and edits them', async () => {
    const d = await g(`{ locations(first: 10) { nodes { id name isActive fulfillsOnlineOrders address { city countryCode country } } } location(id: "${s.customLocation}") { name } }`);
    expect(d.locations.nodes.map((l: { name: string }) => l.name)).toEqual(['My Custom Location', 'Shop location']); // NAME order
    expect(d.locations.nodes[0].address).toMatchObject({ city: 'Toronto', countryCode: 'CA', country: 'Canada' });
    const e = await g(`mutation { locationEdit(id: "${s.customLocation}", input: { name: "Warehouse", address: { city: "Montreal" }, fulfillsOnlineOrders: false }) { location { name fulfillsOnlineOrders address { city countryCode } } userErrors { field message code } } }`);
    expect(e.locationEdit.location).toEqual({ name: 'Warehouse', fulfillsOnlineOrders: false, address: { city: 'Montreal', countryCode: 'CA' } });
    const dup = await g(`mutation { locationAdd(input: { name: "warehouse", address: { countryCode: "US" } }) { location { id } userErrors { field message code } } }`);
    expect(dup.locationAdd.location).toBeNull();
    expect(dup.locationAdd.userErrors[0]).toMatchObject({ field: ['input', 'name'], code: 'TAKEN' });
    const missing = await g(`mutation { locationEdit(id: "gid://shopify/Location/424242", input: { name: "x" }) { userErrors { code } } }`);
    expect(missing.locationEdit.userErrors[0].code).toBe('NOT_FOUND');
  });

  it('adjusts quantities with matching on_hand changes and a ledger group', async () => {
    const before = (await levels()).find((l) => l.location.id === s.shopLocation)!;
    expect(q(before, 'available')).toBe(50);
    const r = await g(`mutation($i: InventoryAdjustQuantitiesInput!) { inventoryAdjustQuantities(input: $i) { inventoryAdjustmentGroup { id reason changes { name delta quantityAfterChange item { id } location { id } } } userErrors { field message code } } }`,
      { i: { reason: 'correction', name: 'available', referenceDocumentUri: 'logistics://test/1', changes: [{ inventoryItemId: item(), locationId: s.shopLocation, delta: -5 }] } });
    expect(r.inventoryAdjustQuantities.userErrors).toEqual([]);
    const group = r.inventoryAdjustQuantities.inventoryAdjustmentGroup;
    expect(group.reason).toBe('correction');
    expect(group.changes).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'available', delta: -5, quantityAfterChange: 45 }), expect.objectContaining({ name: 'on_hand', delta: -5, quantityAfterChange: 45 }),
    ]));
    const after = (await levels()).find((l) => l.location.id === s.shopLocation)!;
    expect([q(after, 'available'), q(after, 'on_hand')]).toEqual([45, 45]);
    // committed moves stock out of available
    await g(`mutation($i: InventoryAdjustQuantitiesInput!) { inventoryAdjustQuantities(input: $i) { userErrors { message } } }`, { i: { reason: 'other', name: 'committed', changes: [{ inventoryItemId: item(), locationId: s.shopLocation, delta: 3 }] } });
    const c = (await levels()).find((l) => l.location.id === s.shopLocation)!;
    expect([q(c, 'available'), q(c, 'committed'), q(c, 'on_hand')]).toEqual([42, 3, 45]);
    expect((await g(`{ productVariant(id: "${s.minimalVariant.id}") { inventoryQuantity } product(id: "${s.minimal.id}") { totalInventory } }`))).toEqual({ productVariant: { inventoryQuantity: 52 }, product: { totalInventory: 52 } });
  });

  it('validates adjustments', async () => {
    const run = async (i: object) => (await g(`mutation($i: InventoryAdjustQuantitiesInput!) { inventoryAdjustQuantities(input: $i) { inventoryAdjustmentGroup { id } userErrors { field message code } } }`, { i })).inventoryAdjustQuantities;
    const stale = await run({ reason: 'correction', name: 'available', changes: [{ inventoryItemId: item(), locationId: s.shopLocation, delta: 1, changeFromQuantity: 999 }] });
    expect(stale.inventoryAdjustmentGroup).toBeNull();
    expect(stale.userErrors[0]).toMatchObject({ code: 'CHANGE_FROM_QUANTITY_STALE', field: ['input', 'changes', '0', 'changeFromQuantity'] });
    expect((await run({ reason: 'correction', name: 'bogus', changes: [{ inventoryItemId: item(), locationId: s.shopLocation, delta: 1 }] })).userErrors[0].code).toBe('INVALID_QUANTITY_NAME');
    expect((await run({ reason: 'nope', name: 'available', changes: [{ inventoryItemId: item(), locationId: s.shopLocation, delta: 1 }] })).userErrors[0].code).toBe('INVALID_REASON');
    expect((await run({ reason: 'correction', name: 'available', changes: [{ inventoryItemId: 'gid://shopify/InventoryItem/424242', locationId: s.shopLocation, delta: 1 }] })).userErrors[0].code).toBe('INVALID_INVENTORY_ITEM');
    const other = (await g(`mutation { locationAdd(input: { name: "Unstocked", address: { countryCode: "US" } }) { location { id } } }`)).locationAdd.location.id;
    expect((await run({ reason: 'correction', name: 'available', changes: [{ inventoryItemId: item(), locationId: other, delta: 1 }] })).userErrors[0].code).toBe('INVALID_LOCATION');
    // a failing change rolls back earlier ones
    const before = q((await levels()).find((l) => l.location.id === s.shopLocation)!, 'available');
    await run({ reason: 'correction', name: 'available', changes: [{ inventoryItemId: item(), locationId: s.shopLocation, delta: 100 }, { inventoryItemId: item(), locationId: other, delta: 1 }] });
    expect(q((await levels()).find((l) => l.location.id === s.shopLocation)!, 'available')).toBe(before);
  });

  it('sets quantities and starts stocking at a new location', async () => {
    const other = (await g(`mutation { locationAdd(input: { name: "Pop-up", address: { countryCode: "FR" } }) { location { id } } }`)).locationAdd.location.id;
    const r = await g(`mutation($i: InventorySetQuantitiesInput!) { inventorySetQuantities(input: $i) { inventoryAdjustmentGroup { changes { name delta quantityAfterChange } } userErrors { field message code } } }`,
      { i: { reason: 'correction', name: 'on_hand', quantities: [{ inventoryItemId: item(), locationId: other, quantity: 7 }] } });
    expect(r.inventorySetQuantities.userErrors).toEqual([]);
    const l = (await levels()).find((x) => x.location.id === other)!;
    expect([q(l, 'on_hand'), q(l, 'available')]).toEqual([7, 7]);
    const neg = await g(`mutation($i: InventorySetQuantitiesInput!) { inventorySetQuantities(input: $i) { userErrors { code } } }`, { i: { reason: 'correction', name: 'available', quantities: [{ inventoryItemId: item(), locationId: other, quantity: -1 }] } });
    expect(neg.inventorySetQuantities.userErrors[0].code).toBe('INVALID_QUANTITY_NEGATIVE');
    const stale = await g(`mutation($i: InventorySetQuantitiesInput!) { inventorySetQuantities(input: $i) { userErrors { code } } }`, { i: { reason: 'correction', name: 'available', quantities: [{ inventoryItemId: item(), locationId: other, quantity: 3, changeFromQuantity: 1 }] } });
    expect(stale.inventorySetQuantities.userErrors[0].code).toBe('CHANGE_FROM_QUANTITY_STALE');
  });

  it('reads items and levels by id and node', async () => {
    const lv = (await levels())[0]!;
    expect(lv.id).toMatch(/^gid:\/\/shopify\/InventoryLevel\/\d+\?inventory_item_id=\d+$/);
    const d = await g(`{ inventoryLevel(id: "${lv.id}") { id item { id } location { name } } node(id: "${item()}") { __typename ... on InventoryItem { sku tracked unitCost { amount currencyCode } measurement { weight { unit value } } } }
      inventoryItems(first: 5, query: "sku:MIN-1") { nodes { id } } }`);
    expect(d.inventoryLevel.item.id).toBe(item());
    expect(d.node).toMatchObject({ __typename: 'InventoryItem', sku: 'MIN-1', tracked: true, unitCost: { amount: '5.5', currencyCode: 'EUR' }, measurement: { weight: { unit: 'POUNDS', value: 2.5 } } });
    expect(d.inventoryItems.nodes).toEqual([{ id: item() }]);
  });

  it('computes availableForSale from tracking, stock and policy', async () => {
    const p = (await g(`mutation { productCreate(product: { title: "Stock Test" }) { product { id variants(first: 1) { nodes { id inventoryItem { id } } } } } }`)).productCreate.product;
    const v = p.variants.nodes[0];
    const afs = async () => (await g(`{ productVariant(id: "${v.id}") { availableForSale inventoryQuantity } }`)).productVariant;
    expect(await afs()).toEqual({ availableForSale: true, inventoryQuantity: 0 }); // untracked
    await g(`mutation { inventoryItemUpdate(id: "${v.inventoryItem.id}", input: { tracked: true }) { userErrors { message } } }`);
    expect((await afs()).availableForSale).toBe(false);
    await g(`mutation { productVariantsBulkUpdate(productId: "${p.id}", variants: [{ id: "${v.id}", inventoryPolicy: CONTINUE }]) { userErrors { message } } }`);
    expect((await afs()).availableForSale).toBe(true);
    const bad = await g(`mutation { inventoryItemUpdate(id: "${v.inventoryItem.id}", input: { cost: "-1" }) { inventoryItem { id } userErrors { field message } } }`);
    expect(bad.inventoryItemUpdate.inventoryItem).toBeNull();
    expect(bad.inventoryItemUpdate.userErrors).toHaveLength(1);
  });

  it('sets, reads and validates metafields', async () => {
    const owner = s.minimal.id as string;
    const set = await g(`mutation($m: [MetafieldsSetInput!]!) { metafieldsSet(metafields: $m) { metafields { id namespace key value type jsonValue ownerType compareDigest } userErrors { field message code elementIndex } } }`, {
      m: [
        { ownerId: owner, namespace: 'specs', key: 'weight_kg', type: 'number_integer', value: '12' },
        { ownerId: owner, namespace: 'specs', key: 'flags', type: 'json', value: '{"a":1}' },
        { ownerId: s.minimalVariant.id, namespace: 'specs', key: 'note', type: 'single_line_text_field', value: 'hi' },
        { ownerId: s.manual.id, namespace: 'specs', key: 'banner', type: 'boolean', value: 'true' },
      ],
    });
    expect(set.metafieldsSet.userErrors).toEqual([]);
    expect(set.metafieldsSet.metafields.map((m: { key: string; jsonValue: unknown }) => [m.key, m.jsonValue])).toEqual([['weight_kg', 12], ['flags', { a: 1 }], ['note', 'hi'], ['banner', true]]);
    const upd = await g(`mutation { metafieldsSet(metafields: [{ ownerId: "${owner}", namespace: "specs", key: "weight_kg", value: "15" }]) { metafields { id value type } userErrors { message } } }`);
    expect(upd.metafieldsSet.metafields[0]).toMatchObject({ value: '15', type: 'number_integer' });
    expect(upd.metafieldsSet.metafields[0].id).toBe(set.metafieldsSet.metafields[0].id);
    const read = await g(`{ product(id: "${owner}") { specs: metafields(namespace: "specs", first: 10) { nodes { key value } } one: metafield(namespace: "specs", key: "flags") { value } none: metafield(namespace: "specs", key: "zzz") { id } byKeys: metafields(first: 10, keys: ["note"]) { nodes { key } } }
      productVariant(id: "${s.minimalVariant.id}") { metafield(namespace: "specs", key: "note") { value } } collection(id: "${s.manual.id}") { metafield(namespace: "specs", key: "banner") { jsonValue } } }`);
    expect(read.product.specs.nodes.map((n: { key: string }) => n.key)).toEqual(['weight_kg', 'flags']);
    expect(read.product.one.value).toBe('{"a":1}');
    expect(read.product.none).toBeNull();
    expect(read.productVariant.metafield.value).toBe('hi');
    expect(read.collection.metafield.jsonValue).toBe(true);
    const bad = await g(`mutation { metafieldsSet(metafields: [{ ownerId: "${owner}", namespace: "specs", key: "num", type: "number_integer", value: "abc" }, { ownerId: "${owner}", namespace: "specs", key: "kay", value: "x" }, { ownerId: "gid://shopify/Product/424242", namespace: "specs", key: "kay2", type: "boolean", value: "true" }]) { metafields { id } userErrors { field message code elementIndex } } }`);
    expect(bad.metafieldsSet.metafields).toBeNull();
    expect(bad.metafieldsSet.userErrors.map((e: { code: string; elementIndex: number }) => [e.elementIndex, e.code])).toEqual([[0, 'INVALID_VALUE'], [1, 'INVALID_TYPE'], [2, 'INVALID']]);
    expect(bad.metafieldsSet.userErrors[0].field).toEqual(['metafields', '0', 'value']);
    const stale = await g(`mutation { metafieldsSet(metafields: [{ ownerId: "${owner}", namespace: "specs", key: "flags", value: "{}", compareDigest: "nope" }]) { userErrors { code } } }`);
    expect(stale.metafieldsSet.userErrors[0].code).toBe('STALE_OBJECT');
    // product creation with metafields
    const withMf = await g(`mutation { productCreate(product: { title: "Meta", metafields: [{ namespace: "custom", key: "color", type: "color", value: "#ff0000" }] }) { product { metafields(first: 5) { nodes { key type } } } userErrors { message } } }`);
    expect(withMf.productCreate.product.metafields.nodes).toEqual([{ key: 'color', type: 'color' }]);
  });

  it('creates files from URLs and from the upload endpoint', async () => {
    const r = await g(`mutation { fileCreate(files: [{ originalSource: "https://example.com/pic.png", alt: "pic", contentType: IMAGE }]) { files { id alt fileStatus ... on MediaImage { image { url altText } } } userErrors { field message code } } }`);
    expect(r.fileCreate.userErrors).toEqual([]);
    expect(r.fileCreate.files[0]).toMatchObject({ alt: 'pic', fileStatus: 'READY', image: { url: 'https://example.com/pic.png', altText: 'pic' } });
    expect(r.fileCreate.files[0].id).toMatch(/^gid:\/\/shopify\/MediaImage\/\d+$/);
    expect((await g(`{ node(id: "${r.fileCreate.files[0].id}") { __typename } }`)).node).toEqual({ __typename: 'MediaImage' });

    const boundary = 'xBOUNDARYx';
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="board.png"\r\nContent-Type: image/png\r\n\r\n`), Buffer.from([137, 80, 78, 71]), Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    const cookie = (await t.app.inject({ method: 'POST', url: '/admin/api/auth/login', payload: { email: 'owner@example.com', password: 'correct horse' } })).cookies.find((c) => c.name === 'shopme_session')!.value;
    const up = await t.app.inject({ method: 'POST', url: '/admin/api/files', headers: { 'content-type': `multipart/form-data; boundary=${boundary}` }, cookies: { shopme_session: cookie }, payload: body });
    expect(up.statusCode).toBe(201);
    const url = JSON.parse(up.body).file.url as string;
    const withFile = await g(`mutation($m: [CreateMediaInput!]) { productCreate(product: { title: "Uploaded" }, media: $m) { product { featuredMedia { mediaContentType ... on MediaImage { mimeType image { url } } } } userErrors { message } } }`, { m: [{ originalSource: url, mediaContentType: 'IMAGE' }] });
    expect(withFile.productCreate.product.featuredMedia).toMatchObject({ mimeType: 'image/png', image: { url: expect.stringMatching(/\/files\//) } });
    const bad = await g(`mutation { fileCreate(files: [{ originalSource: "ftp://nope", contentType: IMAGE }, { originalSource: "https://example.com/doc.pdf", contentType: FILE }]) { files { id } userErrors { field message code } } }`);
    expect(bad.fileCreate.files).toBeNull();
    expect(bad.fileCreate.userErrors[0].field).toEqual(['files', '1', 'contentType']);
  });
});
