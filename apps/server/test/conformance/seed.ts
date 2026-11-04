import { expect } from 'vitest';
import type { makeGqlOk } from './helpers';

type Gql = ReturnType<typeof makeGqlOk>;

/** Create a small catalog through the public mutations. Returns the ids tests need. */
export async function seedCatalog(g: Gql) {
  const loc = await g(`mutation { locationAdd(input: { name: "My Custom Location", address: { countryCode: "CA", city: "Toronto" } }) { location { id } userErrors { field message } } }`);
  expect(loc.locationAdd.userErrors).toEqual([]);
  const locations = (await g(`{ locations(first: 10) { nodes { id name } } }`)).locations.nodes as { id: string; name: string }[];
  const shopLocation = locations.find((l) => l.name === 'Shop location')!.id;
  const customLocation = loc.locationAdd.location.id as string;

  const created = await g(`mutation($product: ProductCreateInput!, $media: [CreateMediaInput!]) {
    productCreate(product: $product, media: $media) { product { id handle variants(first: 1) { nodes { id inventoryItem { id } } } } userErrors { field message } }
  }`, {
    product: { title: 'The Minimal Snowboard', vendor: 'Snow Co', productType: 'Snowboard', tags: ['winter', 'board'], descriptionHtml: '<p>Minimal</p>', metafields: [{ namespace: 'custom', key: 'material', type: 'single_line_text_field', value: 'wood' }] },
    media: [{ originalSource: 'https://example.com/a.png', alt: 'A board', mediaContentType: 'IMAGE' }],
  });
  expect(created.productCreate.userErrors).toEqual([]);
  const minimal = created.productCreate.product;
  const minimalVariant = minimal.variants.nodes[0];

  await g(`mutation($id: ID!, $i: InventoryItemInput!) { inventoryItemUpdate(id: $id, input: $i) { userErrors { message } } }`, {
    id: minimalVariant.inventoryItem.id, i: { tracked: true, sku: 'MIN-1', cost: '5.50', measurement: { weight: { value: 2.5, unit: 'POUNDS' } } },
  });
  await g(`mutation($v: ID!) { productVariantsBulkUpdate(productId: "${minimal.id}", variants: [{ id: $v, price: "885.95", compareAtPrice: "999.00", inventoryPolicy: DENY }]) { userErrors { message } } }`, { v: minimalVariant.id });
  const set = await g(`mutation($i: InventorySetQuantitiesInput!) { inventorySetQuantities(input: $i) { userErrors { field message code } } }`, {
    i: { name: 'available', reason: 'correction', quantities: [{ inventoryItemId: minimalVariant.inventoryItem.id, locationId: shopLocation, quantity: 50 }, { inventoryItemId: minimalVariant.inventoryItem.id, locationId: customLocation, quantity: 10 }] },
  });
  expect(set.inventorySetQuantities.userErrors).toEqual([]);

  const colorful = (await g(`mutation { productCreate(product: { title: "Colorful Board", vendor: "Snow Co", tags: ["summer"], productOptions: [{ name: "Color", values: [{ name: "Red" }, { name: "Blue" }] }] }) { product { id } userErrors { message } } }`)).productCreate.product;
  const bulk = await g(`mutation { productVariantsBulkCreate(productId: "${colorful.id}", variants: [{ optionValues: [{ optionName: "Color", name: "Blue" }], price: "150.00", inventoryItem: { sku: "COL-B", tracked: true } }]) { productVariants { id title } userErrors { field message code } } }`);
  expect(bulk.productVariantsBulkCreate.userErrors).toEqual([]);
  await g(`mutation { productVariantsBulkUpdate(productId: "${colorful.id}", variants: [{ id: "${(await g(`{ product(id: "${colorful.id}") { variants(first: 1) { nodes { id } } } }`)).product.variants.nodes[0].id}", price: "120.00" }]) { userErrors { message } } }`);

  const draft = (await g(`mutation { productCreate(product: { title: "Hidden Draft", status: DRAFT, vendor: "Other", productType: "Accessory" }) { product { id } userErrors { message } } }`)).productCreate.product;

  const manual = (await g(`mutation { collectionCreate(input: { title: "Hydrogen", products: ["${minimal.id}", "${colorful.id}"] }) { collection { id } userErrors { field message } } }`)).collectionCreate.collection;
  const smart = (await g(`mutation { collectionCreate(input: { title: "Automated Collection", ruleSet: { appliedDisjunctively: false, rules: [{ column: VARIANT_PRICE, relation: LESS_THAN, condition: "800.00" }, { column: VARIANT_PRICE, relation: GREATER_THAN, condition: "100.00" }] } }) { collection { id } userErrors { field message } } }`)).collectionCreate.collection;
  await g(`mutation { collectionCreate(input: { title: "Home page", handle: "frontpage" }) { collection { id } } }`);

  return { shopLocation, customLocation, minimal, minimalVariant, colorful, draft, manual, smart };
}
