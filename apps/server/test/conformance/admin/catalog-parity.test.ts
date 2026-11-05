import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, setupAndLogin, type TestApp } from '../../../src/test-utils';
import { makeGql, makeGqlOk } from '../helpers';

describe('catalog parity: ordering, publishing and async duplicate', () => {
  let t: TestApp;
  let gql: ReturnType<typeof makeGql>;
  let g: ReturnType<typeof makeGqlOk>;
  const ids: Record<string, string> = {};

  const product = async (title: string, extra = '') => {
    const r = (await g(`mutation { productCreate(product: { title: "${title}", ${extra} }) { product { id } userErrors { message } } }`)).productCreate;
    expect(r.userErrors).toEqual([]);
    return r.product.id as string;
  };

  beforeAll(async () => {
    t = await createTestApp();
    gql = makeGql(t.app, await setupAndLogin(t.app));
    g = makeGqlOk(gql);
    ids.a = await product('Alpha');
    ids.b = await product('Bravo');
    ids.c = await product('Charlie');
    const col = (await g(`mutation { collectionCreate(input: { title: "Picks", sortOrder: MANUAL, products: ["${ids.a}", "${ids.b}", "${ids.c}"] }) { collection { id } userErrors { message } } }`)).collectionCreate;
    expect(col.userErrors).toEqual([]);
    ids.col = col.collection.id;
  }, 120_000);
  afterAll(async () => { await t.close(); });

  const order = async (id = ids.col!) => (await g(`{ collection(id: "${id}") { products(first: 10) { nodes { title } } } }`)).collection.products.nodes.map((n: { title: string }) => n.title);

  it('reorders products of a manually sorted collection', async () => {
    expect(await order()).toEqual(['Alpha', 'Bravo', 'Charlie']);
    const move = `mutation($id: ID!, $m: [MoveInput!]!) { collectionReorderProducts(id: $id, moves: $m) { job { id done } userErrors { field message code } } }`;
    const r = (await g(move, { id: ids.col, m: [{ id: ids.c, newPosition: '0' }] })).collectionReorderProducts;
    expect(r.userErrors).toEqual([]);
    expect(r.job).toMatchObject({ done: true, id: expect.stringMatching(/^gid:\/\/shopify\/Job\//) });
    expect(await order()).toEqual(['Charlie', 'Alpha', 'Bravo']);
    expect((await g(move, { id: ids.col, m: [{ id: ids.c, newPosition: '2' }, { id: ids.a, newPosition: '2' }] })).collectionReorderProducts.userErrors).toEqual([]);
    expect(await order()).toEqual(['Bravo', 'Charlie', 'Alpha']);
    expect((await g(move, { id: ids.col, m: [{ id: ids.c, newPosition: '99' }] })).collectionReorderProducts.userErrors).toEqual([]);
    expect(await order()).toEqual(['Bravo', 'Alpha', 'Charlie']);

    const outsider = await product('Delta');
    expect((await g(move, { id: ids.col, m: [{ id: outsider, newPosition: '0' }] })).collectionReorderProducts.userErrors[0]).toMatchObject({ field: ['moves', '0', 'id'], code: 'INVALID_MOVE' });
    expect((await g(move, { id: ids.col, m: [{ id: ids.a, newPosition: '-1' }] })).collectionReorderProducts.userErrors[0]).toMatchObject({ code: 'INVALID_MOVE' });
    expect((await g(move, { id: 'gid://shopify/Collection/99999', m: [] })).collectionReorderProducts).toMatchObject({ job: null, userErrors: [{ code: 'COLLECTION_NOT_FOUND' }] });
    const sorted = (await g(`mutation { collectionCreate(input: { title: "A to Z", sortOrder: ALPHA_ASC, products: ["${ids.a}"] }) { collection { id } userErrors { message } } }`)).collectionCreate.collection.id;
    expect((await g(move, { id: sorted, m: [{ id: ids.a, newPosition: '0' }] })).collectionReorderProducts.userErrors[0]).toMatchObject({ field: ['id'], code: 'MANUALLY_SORTED_COLLECTION' });
    expect(await order()).toEqual(['Bravo', 'Alpha', 'Charlie']);
  });

  it('reorders variants and options', async () => {
    const p = (await g(`mutation { productCreate(product: { title: "Tee", productOptions: [{ name: "Color", values: [{ name: "Red" }, { name: "Blue" }] }, { name: "Size", values: [{ name: "S" }] }] }) { product { id options { id name position values: optionValues { id name } } variants(first: 10) { nodes { id title position } } } userErrors { message } } }`)).productCreate;
    expect(p.userErrors).toEqual([]);
    const tee = p.product;
    // Variants: Red / S exists; add Blue / S.
    await g(`mutation { productVariantsBulkCreate(productId: "${tee.id}", variants: [{ optionValues: [{ optionName: "Color", name: "Blue" }, { optionName: "Size", name: "S" }], price: "5.00" }]) { userErrors { message } } }`);
    const variants = async () => (await g(`{ product(id: "${tee.id}") { variants(first: 10) { nodes { id title position } } } }`)).product.variants.nodes as { id: string; title: string; position: number }[];
    const before = await variants();
    expect(before.map((v) => v.title)).toEqual(['Red / S', 'Blue / S']);

    const reorder = `mutation($p: ID!, $pos: [ProductVariantPositionInput!]!) { productVariantsBulkReorder(productId: $p, positions: $pos) { product { id } userErrors { field message code } } }`;
    const ok = (await g(reorder, { p: tee.id, pos: [{ id: before[1]!.id, position: 1 }] })).productVariantsBulkReorder;
    expect(ok.userErrors).toEqual([]);
    expect(ok.product.id).toBe(tee.id);
    expect((await variants()).map((v) => `${v.position}:${v.title}`)).toEqual(['1:Blue / S', '2:Red / S']);
    const codes = async (pos: unknown[]) => (await g(reorder, { p: tee.id, pos })).productVariantsBulkReorder.userErrors.map((e: { code: string }) => e.code);
    expect(await codes([{ id: before[0]!.id, position: 0 }])).toEqual(['INVALID_POSITION']);
    expect(await codes([{ id: 'gid://shopify/ProductVariant/99999', position: 1 }])).toEqual(['MISSING_VARIANT']);
    expect(await codes([{ id: before[0]!.id, position: 1 }, { id: before[0]!.id, position: 2 }])).toEqual(['DUPLICATED_VARIANT_ID']);
    expect((await g(reorder, { p: 'gid://shopify/Product/99999', pos: [] })).productVariantsBulkReorder).toMatchObject({ product: null, userErrors: [{ field: ['productId'], code: 'PRODUCT_DOES_NOT_EXIST' }] });

    const optionsQ = async () => (await g(`{ product(id: "${tee.id}") { options { name position values: optionValues { name } } variants(first: 10) { nodes { title } } } }`)).product;
    const ro = `mutation($p: ID!, $o: [OptionReorderInput!]!) { productOptionsReorder(productId: $p, options: $o) { product { id } userErrors { field message code } } }`;
    const byName = (await g(ro, { p: tee.id, o: [{ name: 'Size' }, { name: 'Color', values: [{ name: 'Red' }, { name: 'Blue' }] }] })).productOptionsReorder;
    expect(byName.userErrors).toEqual([]);
    const after = await optionsQ();
    expect(after.options.map((o: { name: string; position: number }) => `${o.position}:${o.name}`)).toEqual(['1:Size', '2:Color']);
    expect(after.options[1].values.map((v: { name: string }) => v.name)).toEqual(['Red', 'Blue']);
    expect(after.variants.nodes.map((v: { title: string }) => v.title).sort()).toEqual(['S / Blue', 'S / Red']);
    const byId = (await g(ro, { p: tee.id, o: [{ id: tee.options[1].id }, { id: tee.options[0].id }] })).productOptionsReorder;
    expect(byId.userErrors).toEqual([]);
    expect((await optionsQ()).options.map((o: { name: string }) => o.name)).toEqual(['Size', 'Color']);

    const code = async (o: unknown[]) => (await g(ro, { p: tee.id, o })).productOptionsReorder.userErrors.map((e: { code: string }) => e.code);
    expect(await code([{ name: 'Nope' }])).toEqual(['OPTION_NAME_DOES_NOT_EXIST']);
    expect(await code([{ id: 'gid://shopify/ProductOption/99999' }])).toEqual(['OPTION_ID_DOES_NOT_EXIST']);
    expect(await code([{}])).toEqual(['NO_KEY_ON_REORDER']);
    expect(await code([{ id: tee.options[0].id, name: 'Color' }])).toEqual(['MIXING_ID_AND_NAME_KEYS_IS_NOT_ALLOWED']);
    expect(await code([{ name: 'Color' }, { name: 'color' }])).toEqual(['DUPLICATED_OPTION_NAME']);
    expect(await code([{ name: 'Color', values: [{ name: 'Green' }] }])).toEqual(['OPTION_VALUE_DOES_NOT_EXIST']);
    expect(await code([{ name: 'Color', values: [{ name: 'Red' }, { name: 'Red' }] }])).toEqual(['DUPLICATED_OPTION_VALUE']);
    expect(await code([{ name: 'Color', values: [{}] }])).toEqual(['MISSING_OPTION_VALUE']);
    expect((await g(ro, { p: 'gid://shopify/Product/99999', o: [] })).productOptionsReorder.userErrors[0]).toMatchObject({ code: 'PRODUCT_DOES_NOT_EXIST' });
  });

  it('publishes and unpublishes through the legacy mutations', async () => {
    const col = ids.col!;
    const state = async () => (await g(`{ c: collection(id: "${col}") { publishedOnCurrentPublication } p: product(id: "${ids.a}") { publishedOnCurrentPublication status } }`));
    await g(`mutation { publishableUnpublish(id: "${col}", input: [{}]) { userErrors { message } } }`);
    expect((await state()).c.publishedOnCurrentPublication).toBe(false);

    const pub = (await g(`mutation($i: CollectionPublishInput!) { collectionPublish(input: $i) { collection { id publishedOnCurrentPublication } collectionPublications { isPublished publication { id name } collection { id } } shop { name } userErrors { field message } } }`,
      { i: { id: col, collectionPublications: [{ publicationId: 'gid://shopify/Publication/1' }] } })).collectionPublish;
    expect(pub.userErrors).toEqual([]);
    expect(pub.collection).toEqual({ id: col, publishedOnCurrentPublication: true });
    expect(pub.collectionPublications).toEqual([{ isPublished: true, publication: { id: 'gid://shopify/Publication/1', name: 'Online Store' }, collection: { id: col } }]);
    expect((await g(`mutation($i: CollectionUnpublishInput!) { collectionUnpublish(input: $i) { collection { publishedOnCurrentPublication } userErrors { message } } }`, { i: { id: col, collectionPublications: [{ publicationId: 'gid://shopify/Publication/1' }] } })).collectionUnpublish).toEqual({ collection: { publishedOnCurrentPublication: false }, userErrors: [] });
    const bad = (await g(`mutation($i: CollectionPublishInput!) { collectionPublish(input: $i) { collection { id } userErrors { field message } } }`, { i: { id: ids.a, collectionPublications: [{ publicationId: 'gid://shopify/Publication/1' }] } })).collectionPublish;
    expect(bad).toMatchObject({ collection: null, userErrors: [{ field: ['id'] }] });
    const wrongPub = (await g(`mutation($i: CollectionPublishInput!) { collectionPublish(input: $i) { collection { id } userErrors { field message } } }`, { i: { id: col, collectionPublications: [{ publicationId: 'gid://shopify/Publication/77' }] } })).collectionPublish;
    expect(wrongPub.userErrors).toHaveLength(1);

    const un = (await g(`mutation($i: ProductUnpublishInput!) { productUnpublish(input: $i) { product { id status publishedOnCurrentPublication } shop { name } userErrors { message } } }`, { i: { id: ids.a, productPublications: [{ publicationId: 'gid://shopify/Publication/1' }] } })).productUnpublish;
    expect(un.userErrors).toEqual([]);
    expect(un.product).toMatchObject({ id: ids.a, status: 'DRAFT', publishedOnCurrentPublication: false });
    const rp = (await g(`mutation($i: ProductPublishInput!) { productPublish(input: $i) { product { status publishedOnCurrentPublication } productPublications { isPublished product { id } } userErrors { message } } }`, { i: { id: ids.a, productPublications: [{ publicationId: 'gid://shopify/Publication/1' }] } })).productPublish;
    expect(rp).toEqual({ product: { status: 'ACTIVE', publishedOnCurrentPublication: true }, productPublications: [{ isPublished: true, product: { id: ids.a } }], userErrors: [] });

    const cur = (await g(`mutation { publishableUnpublishToCurrentChannel(id: "${col}") { publishable { ... on Collection { publishedOnCurrentPublication } } userErrors { message } } }`)).publishableUnpublishToCurrentChannel;
    expect(cur.publishable.publishedOnCurrentPublication).toBe(false);
    expect((await g(`mutation { publishablePublishToCurrentChannel(id: "${col}") { publishable { ... on Collection { publishedOnCurrentPublication } } userErrors { message } } }`)).publishablePublishToCurrentChannel.publishable.publishedOnCurrentPublication).toBe(true);
    expect((await g(`mutation { publishablePublishToCurrentChannel(id: "gid://shopify/Order/1") { publishable { __typename } userErrors { field message } } }`)).publishablePublishToCurrentChannel.userErrors).toHaveLength(1);
  });

  it('duplicates a product in the background', async () => {
    const start = (await g(`mutation($id: ID!) { productDuplicate(productId: $id, newTitle: "Alpha copy", synchronous: false) { newProduct { id } productDuplicateOperation { id status newProduct { id } product { id } userErrors { message } } userErrors { field message } } }`, { id: ids.a })).productDuplicate;
    expect(start.userErrors).toEqual([]);
    expect(start.newProduct).toBeNull();
    const op = start.productDuplicateOperation;
    expect(op.id).toMatch(/^gid:\/\/shopify\/ProductDuplicateOperation\/\d+$/);
    expect(['CREATED', 'ACTIVE', 'COMPLETE']).toContain(op.status);
    await t.app.ctx.queue.idle();

    const done = (await g(`query($id: ID!) { productOperation(id: $id) { __typename status product { id } ... on ProductDuplicateOperation { newProduct { id title status } userErrors { message } } } node(id: $id) { id } }`, { id: op.id }));
    expect(done.productOperation).toMatchObject({ __typename: 'ProductDuplicateOperation', status: 'COMPLETE', product: { id: ids.a }, newProduct: { title: 'Alpha copy', status: 'DRAFT' }, userErrors: [] });
    expect(done.node.id).toBe(op.id);
    const job = (await g(`query($id: ID!) { productDuplicateJob(id: $id) { id done } }`, { id: op.id })).productDuplicateJob;
    expect(job.done).toBe(true);
    expect(job.id).toMatch(/^gid:\/\/shopify\/Job\//);
    expect((await g(`query($id: ID!) { productDuplicateJob(id: $id) { done } }`, { id: job.id })).productDuplicateJob.done).toBe(true);
    expect((await g(`query($q: String) { products(first: 20, query: $q) { nodes { id } } }`, { q: 'title:"Alpha copy"' })).products.nodes).toHaveLength(1);

    const missing = await gql(`{ productDuplicateJob(id: "gid://shopify/Job/99999") { done } }`);
    expect(missing.errors?.[0]?.message).toMatch(/does not exist/);
    const bad = (await g(`mutation { productDuplicate(productId: "gid://shopify/Product/99999", newTitle: "x", synchronous: false) { productDuplicateOperation { id } userErrors { field message } } }`)).productDuplicate;
    expect(bad).toMatchObject({ productDuplicateOperation: null, userErrors: [{ field: ['productId'] }] });
    // The synchronous form is unchanged.
    const sync = (await g(`mutation($id: ID!) { productDuplicate(productId: $id, newTitle: "Bravo copy") { newProduct { title } productDuplicateOperation { id } imageJob { id } userErrors { message } } }`, { id: ids.b })).productDuplicate;
    expect(sync).toEqual({ newProduct: { title: 'Bravo copy' }, productDuplicateOperation: null, imageJob: null, userErrors: [] });
  });
});
