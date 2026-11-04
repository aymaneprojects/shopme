import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, setupAndLogin, type TestApp } from '../../../src/test-utils';
import { makeGql, makeGqlOk } from '../helpers';

describe('products API', () => {
  let t: TestApp;
  let gql: ReturnType<typeof makeGql>;
  let g: ReturnType<typeof makeGqlOk>;
  beforeAll(async () => {
    t = await createTestApp();
    gql = makeGql(t.app, await setupAndLogin(t.app));
    g = makeGqlOk(gql);
  }, 120_000);
  afterAll(async () => { await t.close(); });

  const create = async (product: Record<string, unknown>) => {
    const d = await g(`mutation($p: ProductCreateInput!) { productCreate(product: $p) { product { id handle title status publishedAt } userErrors { field message } } }`, { p: product });
    expect(d.productCreate.userErrors).toEqual([]);
    return d.productCreate.product as { id: string; handle: string; title: string; status: string; publishedAt: string | null };
  };

  it('creates a product with the default Title option and variant', async () => {
    const p = await create({ title: 'Plain Tee', vendor: 'Acme' });
    expect(p.status).toBe('ACTIVE');
    expect(p.publishedAt).not.toBeNull();
    expect(p.handle).toBe('plain-tee');
    const d = await g(`{ product(id: "${p.id}") { hasOnlyDefaultVariant variantsCount { count } options { name position values optionValues { name hasVariants } }
      variants(first: 5) { nodes { title price sku position inventoryPolicy availableForSale selectedOptions { name value } inventoryItem { tracked requiresShipping inventoryLevels(first: 5) { nodes { location { name } quantities(names: ["available", "on_hand"]) { name quantity } } } } } } } }`);
    expect(d.product.hasOnlyDefaultVariant).toBe(true);
    expect(d.product.variantsCount.count).toBe(1);
    expect(d.product.options).toEqual([{ name: 'Title', position: 1, values: ['Default Title'], optionValues: [{ name: 'Default Title', hasVariants: true }] }]);
    const v = d.product.variants.nodes[0];
    expect(v).toMatchObject({ title: 'Default Title', price: '0.00', sku: null, position: 1, inventoryPolicy: 'DENY', availableForSale: true, selectedOptions: [{ name: 'Title', value: 'Default Title' }] });
    expect(v.inventoryItem.inventoryLevels.nodes[0].location.name).toBe('Shop location');
    expect(v.inventoryItem.requiresShipping).toBe(true);
  });

  it('generates unique handles', async () => {
    const a = await create({ title: 'Twin' });
    const b = await create({ title: 'Twin' });
    const c = await create({ title: 'Other', handle: 'twin' });
    expect([a.handle, b.handle, c.handle]).toEqual(['twin', 'twin-2', 'twin-3']);
  });

  it('reports validation problems as userErrors', async () => {
    const r = await gql(`mutation { productCreate(product: { title: "  " }) { product { id } userErrors { field message } } }`);
    expect(r.errors).toBeUndefined();
    expect(r.data.productCreate.product).toBeNull();
    expect(r.data.productCreate.userErrors).toEqual([{ field: ['product', 'title'], message: "Title can't be blank" }]);
    const upd = await g(`mutation { productUpdate(product: { id: "gid://shopify/Product/999999", title: "x" }) { product { id } userErrors { field message } } }`);
    expect(upd.productUpdate.userErrors[0]).toMatchObject({ field: ['product', 'id'] });
    const bad = await g(`mutation { productCreate(product: { title: "x", productOptions: [{ name: "Size" }] }) { product { id } userErrors { field message } } }`);
    expect(bad.productCreate.product).toBeNull();
    expect(bad.productCreate.userErrors[0].field).toEqual(['product', 'productOptions', '0', 'values']);
  });

  it('supports the deprecated input argument', async () => {
    const d = await g(`mutation { productCreate(input: { title: "Legacy Input", tags: ["b", "a", "B"] }) { product { id tags } userErrors { message } } }`);
    expect(d.productCreate.product.tags).toEqual(['a', 'b']);
  });

  it('updates fields, status and handle', async () => {
    const p = await create({ title: 'Updatable', vendor: 'V1' });
    const d = await g(`mutation($p: ProductUpdateInput!) { productUpdate(product: $p) { product { title handle vendor status publishedAt seo { title description } templateSuffix } userErrors { message } } }`,
      { p: { id: p.id, title: 'Updated!', handle: 'new-handle', status: 'DRAFT', seo: { title: 'S', description: 'D' }, templateSuffix: 'alt' } });
    expect(d.productUpdate.product).toEqual({ title: 'Updated!', handle: 'new-handle', vendor: 'V1', status: 'DRAFT', publishedAt: null, seo: { title: 'S', description: 'D' }, templateSuffix: 'alt' });
    const back = await g(`mutation { productUpdate(product: { id: "${p.id}", status: ACTIVE }) { product { publishedAt } } }`);
    expect(back.productUpdate.product.publishedAt).not.toBeNull();
    expect((await g(`{ productByHandle(handle: "new-handle") { id } productByIdentifier(identifier: { handle: "new-handle" }) { id } }`))).toEqual({ productByHandle: { id: p.id }, productByIdentifier: { id: p.id } });
  });

  describe('search syntax', () => {
    beforeAll(async () => {
      await create({ title: 'Red Hoodie', vendor: 'Nike', productType: 'Apparel', tags: ['sale', 'hoodie'] });
      await create({ title: 'Green Hoodie', vendor: 'Adidas', productType: 'Apparel', tags: ['hoodie'], status: 'DRAFT' });
      await create({ title: 'Blue Mug', vendor: 'Nike', productType: 'Kitchen', tags: ['sale'] });
    });
    const titles = async (query: string, extra = '') => (await g(`query($q: String) { products(first: 50, query: $q ${extra}) { nodes { title } } }`, { q: query })).products.nodes.map((n: { title: string }) => n.title) as string[];

    it('filters by field', async () => {
      expect(await titles('title:hoodie')).toEqual(['Red Hoodie', 'Green Hoodie']);
      expect(await titles('status:draft')).toEqual(['Green Hoodie']);
      expect(await titles('vendor:Nike')).toEqual(['Red Hoodie', 'Blue Mug']);
      expect(await titles('product_type:Kitchen')).toEqual(['Blue Mug']);
      expect(await titles('tag:sale')).toEqual(['Red Hoodie', 'Blue Mug']);
      expect(await titles('tag:sale vendor:Nike product_type:Apparel')).toEqual(['Red Hoodie']);
    });
    it('supports free text, negation, OR, quotes and wildcards', async () => {
      expect(await titles('mug')).toEqual(['Blue Mug']);
      expect(await titles('Adidas')).toEqual(['Green Hoodie']);
      expect(await titles('hoodie -status:draft')).toEqual(['Red Hoodie']);
      expect(await titles('title:Mug OR title:"Green Hoodie"')).toEqual(['Green Hoodie', 'Blue Mug']);
      expect(await titles('title:Blu*')).toEqual(['Blue Mug']);
    });
    it('sorts and paginates', async () => {
      expect((await titles('vendor:Nike', ', sortKey: TITLE'))).toEqual(['Blue Mug', 'Red Hoodie']);
      expect((await titles('vendor:Nike', ', sortKey: TITLE, reverse: true'))).toEqual(['Red Hoodie', 'Blue Mug']);
      const p1 = (await g(`{ products(first: 2, query: "tag:hoodie OR tag:sale", sortKey: TITLE) { nodes { title } pageInfo { hasNextPage endCursor } } }`)).products;
      expect(p1.nodes.map((n: { title: string }) => n.title)).toEqual(['Blue Mug', 'Green Hoodie']);
      expect(p1.pageInfo.hasNextPage).toBe(true);
      const p2 = (await g(`{ products(first: 2, after: "${p1.pageInfo.endCursor}", query: "tag:hoodie OR tag:sale", sortKey: TITLE) { nodes { title } pageInfo { hasNextPage } } }`)).products;
      expect(p2.nodes.map((n: { title: string }) => n.title)).toEqual(['Red Hoodie']);
      expect(p2.pageInfo.hasNextPage).toBe(false);
      expect((await g(`{ productsCount(query: "vendor:Nike") { count precision } }`)).productsCount).toEqual({ count: 2, precision: 'EXACT' });
      expect((await g(`{ productsCount(limit: 2) { count precision } }`)).productsCount).toEqual({ count: 2, precision: 'AT_LEAST' });
    });
    it('requires first or last', async () => {
      const r = await gql(`{ products { nodes { id } } }`);
      expect(r.errors?.[0]?.message).toMatch(/first or last/);
    });
  });

  it('adds options and variants, rejects duplicates and deleting the last variant', async () => {
    const p = await create({ title: 'Shirt' });
    const opt = await g(`mutation { productOptionsCreate(productId: "${p.id}", options: [{ name: "Size", values: [{ name: "S" }, { name: "M" }] }, { name: "Color", values: [{ name: "Red" }, { name: "Blue" }] }], variantStrategy: CREATE) {
      product { options { name values optionValues { hasVariants } } variants(first: 10) { nodes { title selectedOptions { name value } } } } userErrors { field message code } } }`);
    expect(opt.productOptionsCreate.userErrors).toEqual([]);
    expect(opt.productOptionsCreate.product.options.map((o: { name: string }) => o.name)).toEqual(['Size', 'Color']);
    expect(opt.productOptionsCreate.product.variants.nodes.map((v: { title: string }) => v.title).sort()).toEqual(['M / Blue', 'M / Red', 'S / Blue', 'S / Red']);

    const dup = await g(`mutation { productVariantsBulkCreate(productId: "${p.id}", variants: [{ optionValues: [{ optionName: "Size", name: "S" }, { optionName: "Color", name: "Red" }] }]) { productVariants { id } userErrors { field message code } } }`);
    expect(dup.productVariantsBulkCreate.productVariants).toBeNull();
    expect(dup.productVariantsBulkCreate.userErrors[0]).toMatchObject({ code: 'VARIANT_ALREADY_EXISTS' });

    const add = await g(`mutation { productVariantsBulkCreate(productId: "${p.id}", variants: [{ optionValues: [{ optionName: "Size", name: "L" }, { optionName: "Color", name: "Red" }], price: "19.9", compareAtPrice: "25", inventoryItem: { sku: "L-RED", tracked: true } }]) {
      productVariants { id title price compareAtPrice sku } product { priceRangeV2 { minVariantPrice { amount } } options { optionValues { name hasVariants } } } userErrors { message } } }`);
    expect(add.productVariantsBulkCreate.userErrors).toEqual([]);
    expect(add.productVariantsBulkCreate.productVariants[0]).toMatchObject({ title: 'L / Red', price: '19.90', compareAtPrice: '25.00', sku: 'L-RED' });
    expect(add.productVariantsBulkCreate.product.priceRangeV2.minVariantPrice.amount).toBe('0.0');

    const all = (await g(`{ product(id: "${p.id}") { variants(first: 20) { nodes { id title } } } }`)).product.variants.nodes as { id: string; title: string }[];
    const del = await g(`mutation { productVariantsBulkDelete(productId: "${p.id}", variantsIds: [${all.slice(1).map((v) => `"${v.id}"`).join(',')}]) { product { variantsCount { count } } userErrors { code message } } }`);
    expect(del.productVariantsBulkDelete.product.variantsCount.count).toBe(1);
    const last = await g(`mutation { productVariantsBulkDelete(productId: "${p.id}", variantsIds: ["${all[0]!.id}"]) { userErrors { code message } } }`);
    expect(last.productVariantsBulkDelete.userErrors[0].code).toBe('CANNOT_DELETE_LAST_VARIANT');
  });

  it('replaces the default variant when bulk creating variants with new options', async () => {
    const p = await create({ title: 'Mug Set' });
    const r = await g(`mutation { productVariantsBulkCreate(productId: "${p.id}", variants: [{ optionValues: [{ optionName: "Size", name: "Small" }], price: "5" }, { optionValues: [{ optionName: "Size", name: "Large" }], price: "9" }]) { productVariants { title } userErrors { field message code } } }`);
    expect(r.productVariantsBulkCreate.userErrors).toEqual([]);
    const d = await g(`{ product(id: "${p.id}") { hasOnlyDefaultVariant options { name values } variants(first: 5) { nodes { title position } } priceRangeV2 { minVariantPrice { amount } maxVariantPrice { amount } } } }`);
    expect(d.product.hasOnlyDefaultVariant).toBe(false);
    expect(d.product.options).toEqual([{ name: 'Size', values: ['Small', 'Large'] }]);
    expect(d.product.variants.nodes).toEqual([{ title: 'Small', position: 1 }, { title: 'Large', position: 2 }]);
    expect(d.product.priceRangeV2).toEqual({ minVariantPrice: { amount: '5.0' }, maxVariantPrice: { amount: '9.0' } });
  });

  it('updates variants in bulk, with partial updates', async () => {
    const p = await create({ title: 'Bulk Update' });
    const vid = (await g(`{ product(id: "${p.id}") { variants(first: 1) { nodes { id } } } }`)).product.variants.nodes[0].id;
    const ok = await g(`mutation { productVariantsBulkUpdate(productId: "${p.id}", variants: [{ id: "${vid}", price: "12.5", barcode: "123", taxable: false, inventoryPolicy: CONTINUE, inventoryItem: { sku: "SKU-1", requiresShipping: false } }]) {
      productVariants { price barcode taxable inventoryPolicy sku inventoryItem { requiresShipping sku } } userErrors { message } } }`);
    expect(ok.productVariantsBulkUpdate.productVariants[0]).toEqual({ price: '12.50', barcode: '123', taxable: false, inventoryPolicy: 'CONTINUE', sku: 'SKU-1', inventoryItem: { requiresShipping: false, sku: 'SKU-1' } });
    const bad = await g(`mutation { productVariantsBulkUpdate(productId: "${p.id}", variants: [{ id: "${vid}", price: "1" }, { id: "gid://shopify/ProductVariant/424242", price: "2" }]) { productVariants { price } userErrors { field code } } }`);
    expect(bad.productVariantsBulkUpdate.userErrors[0]).toMatchObject({ field: ['variants', '1', 'id'], code: 'PRODUCT_VARIANT_DOES_NOT_EXIST' });
    expect((await g(`{ productVariant(id: "${vid}") { price } }`)).productVariant.price).toBe('12.50');
    const partial = await g(`mutation { productVariantsBulkUpdate(productId: "${p.id}", allowPartialUpdates: true, variants: [{ id: "${vid}", price: "1" }, { id: "gid://shopify/ProductVariant/424242", price: "2" }]) { productVariants { price } userErrors { code } } }`);
    expect(partial.productVariantsBulkUpdate.productVariants).toEqual([{ price: '1.00' }]);
    expect(partial.productVariantsBulkUpdate.userErrors).toHaveLength(1);
  });

  it('adds and removes tags', async () => {
    const p = await create({ title: 'Taggy', tags: ['x'] });
    const add = await g(`mutation { tagsAdd(id: "${p.id}", tags: ["z", "y", "X"]) { node { id ... on Product { tags } } userErrors { message } } }`);
    expect(add.tagsAdd.node.tags).toEqual(['x', 'y', 'z']);
    const rm = await g(`mutation { tagsRemove(id: "${p.id}", tags: ["y", "nope"]) { node { ... on Product { tags } } } }`);
    expect(rm.tagsRemove.node.tags).toEqual(['x', 'z']);
    const bad = await g(`mutation { tagsAdd(id: "gid://shopify/Product/424242", tags: ["a"]) { node { id } userErrors { message } } }`);
    expect(bad.tagsAdd.node).toBeNull();
    expect(bad.tagsAdd.userErrors).toHaveLength(1);
  });

  it('attaches media with productCreate, productUpdate and productCreateMedia', async () => {
    const d = await g(`mutation { productCreate(product: { title: "With Media" }, media: [{ originalSource: "https://example.com/1.jpg", alt: "one", mediaContentType: IMAGE }]) {
      product { id featuredMedia { alt mediaContentType ... on MediaImage { image { url altText } } } mediaCount { count } } userErrors { message } } }`);
    expect(d.productCreate.product.featuredMedia).toMatchObject({ alt: 'one', mediaContentType: 'IMAGE', image: { url: 'https://example.com/1.jpg', altText: 'one' } });
    const id = d.productCreate.product.id;
    await g(`mutation { productUpdate(product: { id: "${id}" }, media: [{ originalSource: "https://example.com/2.jpg", mediaContentType: IMAGE }]) { userErrors { message } } }`);
    const c = await g(`mutation { productCreateMedia(productId: "${id}", media: [{ originalSource: "https://example.com/3.jpg", mediaContentType: IMAGE }]) { media { id mediaContentType status } mediaUserErrors { field message } product { mediaCount { count } } } }`);
    expect(c.productCreateMedia.media[0]).toMatchObject({ mediaContentType: 'IMAGE', status: 'READY' });
    expect(c.productCreateMedia.product.mediaCount.count).toBe(3);
    const bad = await g(`mutation { productCreateMedia(productId: "${id}", media: [{ originalSource: "javascript:alert(1)", mediaContentType: IMAGE }]) { media { id } mediaUserErrors { field message code } } }`);
    expect(bad.productCreateMedia.media).toBeNull();
    expect(bad.productCreateMedia.mediaUserErrors).toHaveLength(1);
  });

  it('duplicates, deletes, and resolves through node/nodes', async () => {
    const p = await create({ title: 'Original', vendor: 'V', tags: ['t'] });
    await g(`mutation { productOptionsCreate(productId: "${p.id}", options: [{ name: "Size", values: [{ name: "S" }, { name: "M" }] }], variantStrategy: CREATE) { userErrors { message } } }`);
    const dup = await g(`mutation { productDuplicate(productId: "${p.id}", newTitle: "Copy of Original") { newProduct { id title handle status vendor tags variantsCount { count } options { name values } } userErrors { message } } }`);
    expect(dup.productDuplicate.newProduct).toMatchObject({ title: 'Copy of Original', handle: 'copy-of-original', status: 'DRAFT', vendor: 'V', tags: ['t'], variantsCount: { count: 2 }, options: [{ name: 'Size', values: ['S', 'M'] }] });
    const nodes = await g(`{ node(id: "${p.id}") { __typename id ... on Product { title } } nodes(ids: ["${p.id}", "gid://shopify/Product/424242", "${dup.productDuplicate.newProduct.id}"]) { __typename } }`);
    expect(nodes.node).toEqual({ __typename: 'Product', id: p.id, title: 'Original' });
    expect(nodes.nodes).toEqual([{ __typename: 'Product' }, null, { __typename: 'Product' }]);
    const del = await g(`mutation { productDelete(input: { id: "${p.id}" }) { deletedProductId userErrors { field message } } }`);
    expect(del.productDelete).toEqual({ deletedProductId: p.id, userErrors: [] });
    expect((await g(`{ product(id: "${p.id}") { id } }`)).product).toBeNull();
    const again = await g(`mutation { productDelete(input: { id: "${p.id}" }) { deletedProductId userErrors { field message } } }`);
    expect(again.productDelete.deletedProductId).toBeNull();
    expect(again.productDelete.userErrors).toHaveLength(1);
  });

  it('records domain events for webhooks', async () => {
    const { listEvents } = await import('@shopme/core');
    const p = await create({ title: 'Evented' });
    const rows = await listEvents(t.dbHandle.db, 1, 'product', Number(p.id.split('/').pop()));
    expect(rows.map((r) => r.verb)).toContain('products/create');
  });

  it('lists distinct product types, vendors and tags, sorted and paginated', async () => {
    await create({ title: 'Filter A', productType: 'Shoe', vendor: 'Zeta', tags: ['sale', 'red'] });
    await create({ title: 'Filter B', productType: 'Bag', vendor: 'Alpha', tags: ['red', ''] });
    const d = await g(`{ productTypes(first: 250) { edges { cursor node } nodes pageInfo { hasNextPage } } productVendors(first: 250) { nodes } productTags(first: 250) { nodes } }`);
    expect(d.productTypes.nodes).toEqual(expect.arrayContaining(['Bag', 'Shoe']));
    expect(d.productVendors.nodes).toEqual(expect.arrayContaining(['Alpha', 'Zeta']));
    expect(d.productTags.nodes).toEqual(expect.arrayContaining(['red', 'sale']));
    for (const xs of [d.productTypes.nodes, d.productVendors.nodes, d.productTags.nodes] as string[][]) {
      expect(xs).toEqual([...new Set(xs)].sort());
      expect(xs).not.toContain('');
    }
    const p1 = await g(`{ productTags(first: 1) { edges { cursor node } nodes pageInfo { hasNextPage endCursor } } }`);
    expect(p1.productTags.nodes).toEqual([d.productTags.nodes[0]]);
    expect(p1.productTags.pageInfo.hasNextPage).toBe(true);
    const p2 = await g(`{ productTags(first: 1, after: "${p1.productTags.pageInfo.endCursor}") { nodes } }`);
    expect(p2.productTags.nodes).toEqual([d.productTags.nodes[1]]);
    const bad = await gql(`{ productVendors { nodes } }`);
    expect(bad.errors).toBeDefined();
  });

  it('reorders product media with productReorderMedia', async () => {
    const d = await g(`mutation { productCreate(product: { title: "Reorder Me" }, media: [
      { originalSource: "https://example.com/a.jpg", mediaContentType: IMAGE },
      { originalSource: "https://example.com/b.jpg", mediaContentType: IMAGE },
      { originalSource: "https://example.com/c.jpg", mediaContentType: IMAGE }]) {
      product { id media(first: 10) { nodes { id } } } userErrors { message } } }`);
    const pid: string = d.productCreate.product.id;
    const [a, b, c]: string[] = d.productCreate.product.media.nodes.map((n: { id: string }) => n.id);
    const mutation = `mutation ProductReorderMedia($id: ID!, $moves: [MoveInput!]!) {
      productReorderMedia(id: $id, moves: $moves) { job { id done } mediaUserErrors { field message code } userErrors { field message } } }`;
    const r = await g(mutation, { id: pid, moves: [{ id: c, newPosition: '0' }, { id: a, newPosition: '2' }] });
    expect(r.productReorderMedia).toEqual({ job: null, mediaUserErrors: [], userErrors: [] });
    const after = await g(`{ product(id: "${pid}") { media(first: 10) { nodes { id } } } }`);
    expect(after.product.media.nodes.map((n: { id: string }) => n.id)).toEqual([c, b, a]);
    const bad = await g(mutation, { id: pid, moves: [{ id: 'gid://shopify/MediaImage/999999', newPosition: '0' }] });
    expect(bad.productReorderMedia.mediaUserErrors).toEqual([{ field: ['moves', '0', 'id'], message: 'Media does not exist on product', code: 'MEDIA_DOES_NOT_EXIST_ON_PRODUCT' }]);
    const missing = await g(mutation, { id: 'gid://shopify/Product/424242', moves: [] });
    expect(missing.productReorderMedia.userErrors[0]).toMatchObject({ field: ['id'] });
  });
});
