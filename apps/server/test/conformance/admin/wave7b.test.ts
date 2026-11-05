import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, setupAndLogin, type TestApp } from '../../../src/test-utils';
import { schema } from '../../../src/admin/graphql/schema';
import { assertShape, buildSelection, loadFixture, makeGql, makeGqlOk } from '../helpers';

describe('wave 7b: catalog API completeness', () => {
  let t: TestApp;
  let gql: ReturnType<typeof makeGql>;
  let g: ReturnType<typeof makeGqlOk>;
  let cookie: string;
  beforeAll(async () => {
    t = await createTestApp();
    cookie = await setupAndLogin(t.app);
    gql = makeGql(t.app, cookie);
    g = makeGqlOk(gql);
  }, 120_000);
  afterAll(async () => { await t.close(); });

  let productId = '';
  let variantId = '';
  let itemId = '';

  it('productSet creates, then syncs variants (update, add, delete) and fields', async () => {
    const q = `mutation($i: ProductSetInput!, $id: ProductSetIdentifiers) { productSet(input: $i, identifier: $id) { product { id title status totalVariants category { name fullName } requiresSellingPlan
      priceRangeV2 { minVariantPrice { amount } maxVariantPrice { amount } } compareAtPriceRange { maxVariantCompareAtPrice { amount } } options { name values }
      variants(first: 10) { nodes { id title price sku unitPrice { amount } unitPriceMeasurement { quantityValue referenceValue } inventoryItem { id } } } } userErrors { field message code } } }`;
    const a = await g(q, { i: {
      title: 'Olive oil', status: 'ACTIVE', vendor: 'Mill', category: 'gid://shopify/TaxonomyCategory/fb-2',
      productOptions: [{ name: 'Size', values: [{ name: '50cl' }, { name: '75cl' }] }],
      variants: [
        { optionValues: [{ optionName: 'Size', name: '50cl' }], price: '9.00', compareAtPrice: '12.00', sku: 'OIL-50' },
        { optionValues: [{ optionName: 'Size', name: '75cl' }], price: '12.00', sku: 'OIL-75' },
      ],
    } });
    expect(a.productSet.userErrors).toEqual([]);
    const p = a.productSet.product;
    productId = p.id;
    expect(p).toMatchObject({ title: 'Olive oil', totalVariants: 2, requiresSellingPlan: false, category: { fullName: 'Food, Beverages & Tobacco > Food Items' } });
    expect(p.priceRangeV2.minVariantPrice.amount).toBe('9.0');
    expect(p.compareAtPriceRange.maxVariantCompareAtPrice.amount).toBe('12.0');
    expect(p.variants.nodes.map((v: { sku: string }) => v.sku).sort()).toEqual(['OIL-50', 'OIL-75']);

    // Sync: update 50cl (price + unit price), drop 75cl, add 1l.
    const b = await g(q, { id: { id: productId }, i: {
      title: 'Olive oil 2', variants: [
        { optionValues: [{ optionName: 'Size', name: '50cl' }], price: '10.00', sku: 'OIL-50' },
        { optionValues: [{ optionValueName: undefined, optionName: 'Size', name: '1l' }], price: '18.00', sku: 'OIL-100' },
      ],
    } });
    expect(b.productSet.userErrors).toEqual([]);
    expect(b.productSet.product.title).toBe('Olive oil 2');
    const skus = b.productSet.product.variants.nodes.map((v: { sku: string }) => v.sku).sort();
    expect(skus).toEqual(['OIL-100', 'OIL-50']);
    variantId = b.productSet.product.variants.nodes.find((v: { sku: string }) => v.sku === 'OIL-50').id;
    itemId = b.productSet.product.variants.nodes.find((v: { sku: string }) => v.sku === 'OIL-50').inventoryItem.id;

    const bad = await g(q, { i: { title: 'x', category: 'gid://shopify/TaxonomyCategory/nope' } });
    expect(bad.productSet.userErrors[0].message).toMatch(/category/i);
  });

  it('variants carry unit price measurement and the product has a preview url', async () => {
    const r = await g(`mutation($p: ID!, $v: [ProductVariantsBulkInput!]!) { productVariantsBulkUpdate(productId: $p, variants: $v) { productVariants { unitPrice { amount currencyCode } unitPriceMeasurement { quantityValue quantityUnit referenceValue referenceUnit } showUnitPrice } userErrors { message } } }`,
      { p: productId, v: [{ id: variantId, unitPriceMeasurement: { quantityValue: 50, quantityUnit: 'CL', referenceValue: 100, referenceUnit: 'CL' } }] });
    expect(r.productVariantsBulkUpdate.userErrors).toEqual([]);
    expect(r.productVariantsBulkUpdate.productVariants[0]).toMatchObject({ unitPrice: { amount: '20.0', currencyCode: 'EUR' }, showUnitPrice: true, unitPriceMeasurement: { referenceValue: 100 } });
    const d = await g(`{ product(id: "${productId}") { onlineStorePreviewUrl publishedOnCurrentPublication } }`);
    expect(d.product.onlineStorePreviewUrl).toMatch(/\/products\/olive-oil$/);
    expect(d.product.publishedOnCurrentPublication).toBe(true);
  });

  it('productChangeStatus and publishable publish/unpublish on the single Online Store publication', async () => {
    const pubs = await g(`{ publications(first: 5) { nodes { id name } } publicationsCount { count } }`);
    expect(pubs.publications.nodes).toHaveLength(1);
    const pubId = pubs.publications.nodes[0].id;
    const draft = await g(`mutation { productChangeStatus(productId: "${productId}", status: DRAFT) { product { status } userErrors { code } } }`);
    expect(draft.productChangeStatus.product.status).toBe('DRAFT');
    const preview = await g(`{ product(id: "${productId}") { onlineStorePreviewUrl } }`);
    expect(preview.product.onlineStorePreviewUrl).toContain('?preview=1');
    const pub = await g(`mutation { publishablePublish(id: "${productId}", input: [{ publicationId: "${pubId}" }]) { publishable { ... on Product { status } } userErrors { message } } }`);
    expect(pub.publishablePublish.userErrors).toEqual([]);
    expect(pub.publishablePublish.publishable.status).toBe('ACTIVE');
    const un = await g(`mutation { publishableUnpublish(id: "${productId}", input: [{ publicationId: "${pubId}" }]) { publishable { ... on Product { status } } } }`);
    expect(un.publishableUnpublish.publishable.status).toBe('DRAFT');
    await g(`mutation { productChangeStatus(productId: "${productId}", status: ACTIVE) { product { status } } }`);
  });

  it('customer address mutations and customer type fields', async () => {
    const c = await g(`mutation { customerCreate(input: { email: "a@example.com", firstName: "Ada", lastName: "L" }) { customer { id } userErrors { message } } }`);
    const id = c.customerCreate.customer.id;
    const a1 = await g(`mutation { customerAddressCreate(customerId: "${id}", address: { address1: "1 Rue A", city: "Paris", countryCode: FR, zip: "75001" }) { address { id city } userErrors { message } } }`);
    expect(a1.customerAddressCreate.address.city).toBe('Paris');
    const a2 = await g(`mutation { customerAddressCreate(customerId: "${id}", address: { address1: "2 Rue B", city: "Lyon", countryCode: FR }, setAsDefault: true) { address { id } } }`);
    const second = a2.customerAddressCreate.address.id;
    let d = await g(`{ customer(id: "${id}") { defaultAddress { id city } addresses { id } lastOrder { id } statistics { predictedSpendTier } emailMarketingConsent { marketingState } smsMarketingConsent { marketingState } canDelete } }`);
    expect(d.customer.defaultAddress.city).toBe('Lyon');
    expect(d.customer.addresses).toHaveLength(2);
    expect(d.customer).toMatchObject({ lastOrder: null, canDelete: true, emailMarketingConsent: { marketingState: 'NOT_SUBSCRIBED' }, smsMarketingConsent: null });
    const upd = await g(`mutation { customerAddressUpdate(customerId: "${id}", addressId: "${a1.customerAddressCreate.address.id}", address: { city: "Nice" }, setAsDefault: true) { address { city } userErrors { message } } }`);
    expect(upd.customerAddressUpdate.address.city).toBe('Nice');
    const def = await g(`mutation { customerUpdateDefaultAddress(customerId: "${id}", addressId: "${second}") { customer { defaultAddress { city } } } }`);
    expect(def.customerUpdateDefaultAddress.customer.defaultAddress.city).toBe('Lyon');
    const del = await g(`mutation { customerAddressDelete(customerId: "${id}", addressId: "${second}") { deletedAddressId userErrors { message } } }`);
    expect(del.customerAddressDelete.deletedAddressId).toBe(second);
    d = await g(`{ customer(id: "${id}") { defaultAddress { city } addresses { id } } }`);
    expect(d.customer.defaultAddress.city).toBe('Nice'); // promoted
    const miss = await g(`mutation { customerAddressDelete(customerId: "${id}", addressId: "gid://shopify/MailingAddress/999999") { userErrors { message } } }`);
    expect(miss.customerAddressDelete.userErrors).toHaveLength(1);
  });

  it('shop matches the recorded shape', async () => {
    const fx = loadFixture('shop');
    const data = await g(`{ shop { ${buildSelection(schema, fx)} } }`);
    assertShape(schema, fx, [data.shop]);
  });

  it('shop type fields', async () => {
    const d = await g(`{ shop { contactEmail shopAddress { countryCodeV2 } billingAddress { countryCodeV2 } currencySettings(first: 5) { nodes { currencyCode currencyName enabled } } enabledPresentmentCurrencies plan { displayName shopifyPlus } timezoneOffsetMinutes setupRequired } }`);
    expect(d.shop).toMatchObject({ contactEmail: 'owner@example.com', shopAddress: { countryCodeV2: 'FR' }, enabledPresentmentCurrencies: ['EUR'], plan: { shopifyPlus: false }, setupRequired: false });
    expect(d.shop.currencySettings.nodes[0]).toMatchObject({ currencyCode: 'EUR', currencyName: 'Euro', enabled: true });
  });

  it('files: files query, fileUpdate, fileDelete and staged uploads (local PUT target)', async () => {
    const st = await g(`mutation { stagedUploadsCreate(input: [{ resource: FILE, filename: "hero.png", mimeType: "image/png", httpMethod: PUT }]) { stagedTargets { url resourceUrl parameters { name value } } userErrors { message } } }`);
    const target = st.stagedUploadsCreate.stagedTargets[0];
    const path = new URL(target.url).pathname;
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
    const put = await t.app.inject({ method: 'PUT', url: path, payload: png, headers: { 'content-type': 'image/png' } });
    expect(put.statusCode).toBe(201);
    expect((await t.app.inject({ method: 'PUT', url: `${path}x`, payload: png, headers: { 'content-type': 'image/png' } })).statusCode).toBe(403);
    const created = await g(`mutation($s: String!) { fileCreate(files: [{ originalSource: $s, contentType: IMAGE, alt: "Hero" }]) { files { id alt ... on MediaImage { image { url } } } userErrors { message } } }`, { s: target.resourceUrl });
    expect(created.fileCreate.userErrors).toEqual([]);
    const fid = created.fileCreate.files[0].id;
    const list = await g(`{ files(first: 10, query: "Hero") { nodes { id alt } } }`);
    expect(list.files.nodes.map((f: { id: string }) => f.id)).toContain(fid);
    const up = await g(`mutation { fileUpdate(files: [{ id: "${fid}", alt: "Renamed" }]) { files { alt } userErrors { message } } }`);
    expect(up.fileUpdate.files[0].alt).toBe('Renamed');
    const del = await g(`mutation { fileDelete(fileIds: ["${fid}"]) { deletedFileIds userErrors { message } } }`);
    expect(del.fileDelete.deletedFileIds).toEqual([fid]);
    expect((await g(`{ files(first: 10) { nodes { id } } }`)).files.nodes).toEqual([]);
    const gone = await g(`mutation { fileDelete(fileIds: ["${fid}"]) { userErrors { code } } }`);
    expect(gone.fileDelete.userErrors[0].code).toBe('FILE_DOES_NOT_EXIST');
  });

  it('metafield definitions: create, validate, set values against the type, update, count, delete', async () => {
    const c = await g(`mutation { metafieldDefinitionCreate(definition: { name: "Origin", namespace: "specs", key: "origin", ownerType: PRODUCT, type: "single_line_text_field", pin: true }) { createdDefinition { id name type { name category } pinnedPosition ownerType } userErrors { field code message } } }`);
    expect(c.metafieldDefinitionCreate.userErrors).toEqual([]);
    const def = c.metafieldDefinitionCreate.createdDefinition;
    expect(def).toMatchObject({ type: { name: 'single_line_text_field', category: 'TEXT' }, pinnedPosition: 1, ownerType: 'PRODUCT' });
    const dup = await g(`mutation { metafieldDefinitionCreate(definition: { name: "x", namespace: "specs", key: "origin", ownerType: PRODUCT, type: "boolean" }) { userErrors { code } } }`);
    expect(dup.metafieldDefinitionCreate.userErrors[0].code).toBe('TAKEN');
    const badType = await g(`mutation { metafieldDefinitionCreate(definition: { name: "x", key: "kk", ownerType: PRODUCT, type: "nope" }) { userErrors { code } } }`);
    expect(badType.metafieldDefinitionCreate.userErrors[0].code).toBe('INCLUSION');

    // Values must follow the definition's type; omitting the type uses it.
    const wrong = await g(`mutation { metafieldsSet(metafields: [{ ownerId: "${productId}", namespace: "specs", key: "origin", type: "number_integer", value: "3" }]) { userErrors { code } } }`);
    expect(wrong.metafieldsSet.userErrors[0].code).toBe('INVALID_TYPE');
    const ok = await g(`mutation { metafieldsSet(metafields: [{ ownerId: "${productId}", namespace: "specs", key: "origin", value: "Provence" }]) { metafields { type value } userErrors { message } } }`);
    expect(ok.metafieldsSet.metafields[0]).toEqual({ type: 'single_line_text_field', value: 'Provence' });

    const list = await g(`{ metafieldDefinitions(ownerType: PRODUCT, first: 10) { nodes { id key metafieldsCount } } other: metafieldDefinitions(ownerType: CUSTOMER, first: 10) { nodes { id } } }`);
    expect(list.metafieldDefinitions.nodes).toEqual([{ id: def.id, key: 'origin', metafieldsCount: 1 }]);
    expect(list.other.nodes).toEqual([]);
    const up = await g(`mutation { metafieldDefinitionUpdate(definition: { namespace: "specs", key: "origin", ownerType: PRODUCT, name: "Country of origin", pin: false }) { updatedDefinition { name pinnedPosition } userErrors { message } } }`);
    expect(up.metafieldDefinitionUpdate.updatedDefinition).toEqual({ name: 'Country of origin', pinnedPosition: null });

    // Metafields on customers, orders and shop too.
    const cust = await g(`{ customers(first: 1) { nodes { id metafields(first: 5) { nodes { key } } } } shop { metafield(namespace: "a", key: "b") { value } } }`);
    expect(cust.customers.nodes[0].metafields.nodes).toEqual([]);
    expect(cust.shop.metafield).toBeNull();

    const del = await g(`mutation { metafieldDefinitionDelete(id: "${def.id}", deleteAllAssociatedMetafields: true) { deletedDefinitionId userErrors { message } } }`);
    expect(del.metafieldDefinitionDelete.deletedDefinitionId).toBe(def.id);
    expect((await g(`{ product(id: "${productId}") { metafield(namespace: "specs", key: "origin") { value } } }`)).product.metafield).toBeNull();
  });

  it('inventory: activate, move quantities, deactivate; locations activate/deactivate with stock move; locationsCount', async () => {
    const loc = await g(`mutation { locationAdd(input: { name: "Warehouse B", address: { countryCode: "FR", city: "Lille" } }) { location { id } } }`);
    const locB = loc.locationAdd.location.id;
    const shopLoc = (await g(`{ locations(first: 5, sortKey: PRIORITY) { nodes { id name priority isPrimary } } }`)).locations.nodes;
    expect(shopLoc[0].isPrimary).toBe(true);
    const locA = shopLoc[0].id as string;
    await g(`mutation { inventoryItemUpdate(id: "${itemId}", input: { tracked: true }) { userErrors { message } } }`);
    await g(`mutation($i: InventorySetQuantitiesInput!) { inventorySetQuantities(input: $i) { userErrors { message } } }`, { i: { reason: 'correction', name: 'available', quantities: [{ inventoryItemId: itemId, locationId: locA, quantity: 10 }] } });

    const act = await g(`mutation { inventoryActivate(inventoryItemId: "${itemId}", locationId: "${locB}", available: 2) { inventoryLevel { id quantities(names: ["available"]) { quantity } canDeactivate } userErrors { message } } }`);
    expect(act.inventoryActivate.userErrors).toEqual([]);
    expect(act.inventoryActivate.inventoryLevel.quantities[0].quantity).toBe(2);
    expect((await g(`{ inventoryItem(id: "${itemId}") { locationsCount { count } } }`)).inventoryItem.locationsCount.count).toBe(2);

    const mv = await g(`mutation($i: InventoryMoveQuantitiesInput!) { inventoryMoveQuantities(input: $i) { inventoryAdjustmentGroup { reason changes { name delta } } userErrors { code message } } }`,
      { i: { reason: 'movement_created', referenceDocumentUri: 'logistics://move/1', changes: [{ inventoryItemId: itemId, quantity: 4, from: { locationId: locA, name: 'available' }, to: { locationId: locB, name: 'available' } }] } });
    expect(mv.inventoryMoveQuantities.userErrors).toEqual([]);
    const lv = async (l: string) => (await g(`{ inventoryItem(id: "${itemId}") { inventoryLevel(locationId: "${l}") { quantities(names: ["available", "on_hand"]) { name quantity } } } }`)).inventoryItem.inventoryLevel.quantities;
    expect(await lv(locA)).toEqual([{ name: 'available', quantity: 6 }, { name: 'on_hand', quantity: 6 }]);
    expect(await lv(locB)).toEqual([{ name: 'available', quantity: 6 }, { name: 'on_hand', quantity: 6 }]);
    const over = await g(`mutation($i: InventoryMoveQuantitiesInput!) { inventoryMoveQuantities(input: $i) { userErrors { code } } }`,
      { i: { reason: 'movement_created', referenceDocumentUri: 'logistics://move/2', changes: [{ inventoryItemId: itemId, quantity: 1, from: { locationId: locA, name: 'available' }, to: { locationId: locA, name: 'available' } }] } });
    expect(over.inventoryMoveQuantities.userErrors[0].code).toBe('DIFFERENT_LOCATIONS');

    const levelB = act.inventoryActivate.inventoryLevel.id;
    const deact = await g(`mutation { inventoryDeactivate(inventoryLevelId: "${levelB}") { userErrors { message } } }`);
    expect(deact.inventoryDeactivate.userErrors).toEqual([]);
    expect((await g(`{ inventoryItem(id: "${itemId}") { locationsCount { count } } }`)).inventoryItem.locationsCount.count).toBe(1);
    const last = await g(`mutation { inventoryDeactivate(inventoryLevelId: "${(await g(`{ inventoryItem(id: "${itemId}") { inventoryLevels(first: 5) { nodes { id } } } }`)).inventoryItem.inventoryLevels.nodes[0].id}") { userErrors { message } } }`);
    expect(last.inventoryDeactivate.userErrors).toHaveLength(1);

    // Location deactivation requires a destination when it holds stock; stock moves over.
    await g(`mutation { inventoryActivate(inventoryItemId: "${itemId}", locationId: "${locB}", available: 3) { userErrors { message } } }`);
    const blocked = await g(`mutation { locationDeactivate(locationId: "${locB}") { locationDeactivateUserErrors { code } } }`);
    expect(blocked.locationDeactivate.locationDeactivateUserErrors[0].code).toBe('HAS_ACTIVE_INVENTORY_ERROR');
    const ok = await g(`mutation { locationDeactivate(locationId: "${locB}", destinationLocationId: "${locA}") { location { isActive deactivatedAt } locationDeactivateUserErrors { code } } }`);
    expect(ok.locationDeactivate.locationDeactivateUserErrors).toEqual([]);
    expect(ok.locationDeactivate.location.isActive).toBe(false);
    expect((await lv(locA))[0]).toEqual({ name: 'available', quantity: 9 });
    expect((await g(`{ locationsCount { count } }`)).locationsCount.count).toBe(1);
    const only = await g(`mutation { locationDeactivate(locationId: "${locA}") { locationDeactivateUserErrors { code } } }`);
    expect(only.locationDeactivate.locationDeactivateUserErrors[0].code).toBe('PERMANENTLY_BLOCKED_FROM_DEACTIVATION_ERROR');
    const re = await g(`mutation { locationActivate(locationId: "${locB}") { location { isActive } locationActivateUserErrors { code } } }`);
    expect(re.locationActivate.location.isActive).toBe(true);
  });

  it('reports a real query cost and a throttle status in extensions', async () => {
    const small = await gql(`{ shop { name } }`);
    const big = await gql(`{ products(first: 50) { nodes { id title variants(first: 10) { nodes { id } } } } }`);
    const ext = (r: unknown) => (r as { extensions: { cost: { requestedQueryCost: number; actualQueryCost: number; throttleStatus: { maximumAvailable: number; currentlyAvailable: number; restoreRate: number } } } }).extensions.cost;
    expect(ext(small).requestedQueryCost).toBe(1);
    expect(ext(big).requestedQueryCost).toBe(2 + 50 * (1 + 2 + 10 * 1));
    expect(ext(big).actualQueryCost).toBeLessThan(ext(big).requestedQueryCost);
    expect(ext(big).throttleStatus).toMatchObject({ maximumAvailable: 2000, restoreRate: 100 });
    expect(ext(big).throttleStatus.currentlyAvailable).toBeLessThanOrEqual(2000);
    const mut = await gql(`mutation { tagsAdd(id: "${productId}", tags: ["a"]) { userErrors { message } } }`);
    expect(ext(mut).requestedQueryCost).toBeGreaterThanOrEqual(10);
  });

  it('order totals family and new order fields exist', async () => {
    const d = await g(`{ orders(first: 1) { nodes { id totalPrice subtotalPrice totalTax totalShippingPrice totalDiscounts totalRefunded totalReceived netPayment cartDiscountAmountSet { shopMoney { amount } } totalCapturableSet { shopMoney { amount } } totalTipReceivedSet { shopMoney { amount } } confirmationNumber returnStatus merchantEditable metafields(first: 2) { nodes { key } } } } }`);
    expect(d.orders.nodes).toEqual([]); // no orders yet; the query validates against the schema
  });
});
