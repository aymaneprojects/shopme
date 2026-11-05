import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createBulkOperation, finishBulkOperation, getPrimaryShop } from '@shopme/core';
import { createTestApp, setupAndLogin, type TestApp } from '../../../src/test-utils';
import { makeGql, makeGqlOk } from '../helpers';

describe('bulk operations', () => {
  let t: TestApp;
  let gql: ReturnType<typeof makeGql>;
  let g: ReturnType<typeof makeGqlOk>;
  let cookie: string;
  let shopId = 0;

  beforeAll(async () => {
    t = await createTestApp();
    cookie = await setupAndLogin(t.app);
    gql = makeGql(t.app, cookie);
    g = makeGqlOk(gql);
    for (const [title, tag] of [['Alpha', 'a'], ['Beta', 'b'], ['Gamma', 'a']] as const) {
      await g(`mutation { productCreate(product: { title: "${title}", tags: ["${tag}"], productOptions: [{ name: "Size", values: [{ name: "S" }, { name: "M" }] }] }) { product { id } userErrors { message } } }`);
    }
    const first = (await g(`{ products(first: 1) { nodes { id variants(first: 1) { nodes { id } } } } }`)).products.nodes[0];
    await g(`mutation { productVariantsBulkCreate(productId: "${first.id}", variants: [{ optionValues: [{ optionName: "Size", name: "M" }], price: "5.00" }]) { userErrors { message } } }`);
    shopId = (await getPrimaryShop(t.app.ctx.db))!.id;
  }, 120_000);
  afterAll(async () => { await t.close(); });

  const fileLines = async (url: string) => {
    const res = await t.app.inject({ method: 'GET', url: new URL(url).pathname });
    expect(res.statusCode).toBe(200);
    return res.body.trim().split('\n').map((l) => JSON.parse(l) as Record<string, unknown>);
  };
  const settle = async () => { await t.app.ctx.queue.idle(); };

  it('runs a query to a JSONL file with __parentId for nested connections', async () => {
    const start = await g(`mutation($q: String!) { bulkOperationRunQuery(query: $q) { bulkOperation { id status type query url partialDataUrl errorCode objectCount rootObjectCount fileSize completedAt createdAt } userErrors { field message code } } }`, {
      q: `{ products { edges { node { id title tags variants { edges { node { id title } } } } } } }`,
    });
    expect(start.bulkOperationRunQuery.userErrors).toEqual([]);
    const op = start.bulkOperationRunQuery.bulkOperation;
    expect(op.id).toMatch(/^gid:\/\/shopify\/BulkOperation\/\d+$/);
    expect(op).toMatchObject({ type: 'QUERY', url: null, errorCode: null });
    expect(['CREATED', 'RUNNING', 'COMPLETED']).toContain(op.status);
    await settle();
    const done = (await g(`query($id: ID!) { bulkOperation(id: $id) { id status url objectCount rootObjectCount fileSize completedAt } }`, { id: op.id })).bulkOperation;
    expect(done).toMatchObject({ id: op.id, status: 'COMPLETED', objectCount: '7', rootObjectCount: '3' });
    expect(Number(done.fileSize)).toBeGreaterThan(10);
    expect(done.completedAt).toBeTruthy();

    const lines = await fileLines(done.url);
    expect(lines).toHaveLength(7);
    const products = lines.filter((l) => !('__parentId' in l));
    expect(products.map((p) => p.title)).toEqual(['Alpha', 'Beta', 'Gamma']);
    expect(products[0]).toMatchObject({ id: expect.stringMatching(/^gid:\/\/shopify\/Product\//), tags: ['a'] });
    expect(products[0]).not.toHaveProperty('variants');
    const alphaVariants = lines.filter((l) => l.__parentId === products[0]!.id);
    expect(alphaVariants.map((v) => v.title)).toEqual(['S', 'M']);
    // Children follow their parent.
    expect(lines.indexOf(alphaVariants[0]!)).toBe(lines.indexOf(products[0]!) + 1);
  });

  it('supports nodes shorthand, arguments, fragments and aliases; adds id for parents', async () => {
    const start = await g(`mutation($q: String!) { bulkOperationRunQuery(query: $q) { bulkOperation { id } userErrors { message } } }`, {
      q: `fragment V on ProductVariant { price } { items: products(query: "tag:a") { nodes { name: title variants { nodes { ...V } } } } }`,
    });
    expect(start.bulkOperationRunQuery.userErrors).toEqual([]);
    await settle();
    const done = (await g(`query($id: ID!) { bulkOperation(id: $id) { status url objectCount } }`, { id: start.bulkOperationRunQuery.bulkOperation.id })).bulkOperation;
    expect(done.status).toBe('COMPLETED');
    const lines = await fileLines(done.url);
    const roots = lines.filter((l) => !('__parentId' in l));
    expect(roots.map((r) => r.name).sort()).toEqual(['Alpha', 'Gamma']);
    expect(roots[0]).toHaveProperty('id');
    expect(lines.filter((l) => '__parentId' in l).every((l) => 'price' in l)).toBe(true);
  });

  it('rejects invalid queries with INVALID user errors', async () => {
    const run = async (q: string) => (await g(`mutation($q: String!) { bulkOperationRunQuery(query: $q) { bulkOperation { id } userErrors { field message code } } }`, { q })).bulkOperationRunQuery;
    for (const q of ['{ shop { name } }', 'mutation { productCreate(product: {title: "x"}) { product { id } } }', '{ products { nodes { id', '{ products(first: 5) { nodes { id } } p1: products { nodes { id } } p2: products { nodes { id } } p3: products { nodes { id } } p4: products { nodes { id } } p5: products { nodes { id } } }']) {
      const r = await run(q);
      expect(r.bulkOperation).toBeNull();
      expect(r.userErrors).toHaveLength(1);
      expect(r.userErrors[0]).toMatchObject({ code: 'INVALID', field: ['query'] });
      expect(r.userErrors[0].message.length).toBeGreaterThan(5);
    }
  });

  it('allows one running operation per type', async () => {
    const r = await createBulkOperation(t.app.ctx.db, shopId, { type: 'QUERY', query: '{ products { nodes { id } } }' });
    expect(r.ok).toBe(true);
    const busy = (await g(`mutation { bulkOperationRunQuery(query: "{ products { nodes { id } } }") { bulkOperation { id } userErrors { field message code } } }`)).bulkOperationRunQuery;
    expect(busy.bulkOperation).toBeNull();
    expect(busy.userErrors[0]).toMatchObject({ code: 'OPERATION_IN_PROGRESS' });
    expect(busy.userErrors[0].message).toContain('gid://shopify/BulkOperation/');
    // A mutation run is a separate slot.
    const cur = (await g(`{ currentBulkOperation { id status type } }`)).currentBulkOperation;
    expect(cur).toMatchObject({ status: 'CREATED', type: 'QUERY' });

    const cancel = (await g(`mutation($id: ID!) { bulkOperationCancel(id: $id) { bulkOperation { id status } userErrors { field message } } }`, { id: cur.id })).bulkOperationCancel;
    expect(cancel).toMatchObject({ bulkOperation: { status: 'CANCELING' }, userErrors: [] });
    if (r.ok) await finishBulkOperation(t.app.ctx.db, shopId, r.value.id, { status: 'CANCELED', objectCount: 0, rootObjectCount: 0 });
    const after = (await g(`{ bulkOperation(id: "${cur.id}") { status completedAt } }`)).bulkOperation;
    expect(after.status).toBe('CANCELED');

    const again = (await g(`mutation($id: ID!) { bulkOperationCancel(id: $id) { bulkOperation { status } userErrors { field message } } }`, { id: cur.id })).bulkOperationCancel;
    expect(again.bulkOperation.status).toBe('CANCELED');
    const missing = (await g(`mutation { bulkOperationCancel(id: "gid://shopify/BulkOperation/99999") { bulkOperation { id } userErrors { field message } } }`)).bulkOperationCancel;
    expect(missing).toMatchObject({ bulkOperation: null, userErrors: [{ field: ['id'] }] });
    // A completed operation cannot be canceled.
    const completed = (await g(`{ bulkOperations(first: 5, query: "status:completed") { nodes { id } } }`)).bulkOperations.nodes[0].id;
    const no = (await g(`mutation($id: ID!) { bulkOperationCancel(id: $id) { userErrors { field message } } }`, { id: completed })).bulkOperationCancel;
    expect(no.userErrors).toHaveLength(1);
  });

  it('lists operations, newest first, with search and sort', async () => {
    const d = await g(`{ bulkOperations(first: 10) { edges { cursor node { id status type } } nodes { id } pageInfo { hasNextPage } } done: bulkOperations(first: 10, query: "status:completed operation_type:query", sortKey: COMPLETED_AT, reverse: true) { nodes { status } } }`);
    expect(d.bulkOperations.nodes.length).toBeGreaterThanOrEqual(3);
    const ids = d.bulkOperations.nodes.map((n: { id: string }) => Number(n.id.split('/').pop()));
    expect(ids).toEqual([...ids].sort((a, b) => b - a));
    expect(d.done.nodes.length).toBe(2);
    expect(d.done.nodes.every((n: { status: string }) => n.status === 'COMPLETED')).toBe(true);
    const n = (await g(`query($id: ID!) { node(id: $id) { ... on BulkOperation { id type } } }`, { id: ids.length ? d.bulkOperations.nodes[0].id : '' })).node;
    expect(n.type).toBe('QUERY');
  });

  it('runs a mutation over a staged JSONL file', async () => {
    const staged = (await g(`mutation { stagedUploadsCreate(input: [{ resource: BULK_MUTATION_VARIABLES, filename: "vars.jsonl", mimeType: "text/jsonl", httpMethod: POST }]) { stagedTargets { url resourceUrl parameters { name value } } userErrors { message } } }`)).stagedUploadsCreate;
    expect(staged.userErrors).toEqual([]);
    const target = staged.stagedTargets[0];
    const key = target.parameters.find((p: { name: string }) => p.name === 'key').value as string;
    expect(key).toContain(`tmp/${shopId}/bulk/`);
    const body = [
      JSON.stringify({ product: { title: 'Bulk One' } }), JSON.stringify({ product: { title: 'Bulk Two', tags: ['bulk'] } }), JSON.stringify({ product: { title: '' } }), 'not json',
    ].join('\n');
    const up = await t.app.inject({ method: 'PUT', url: new URL(target.url).pathname, payload: body, headers: { 'content-type': 'text/jsonl' } });
    expect(up.statusCode).toBe(201);
    const mutation = `mutation call($product: ProductCreateInput!) { productCreate(product: $product) { product { id title } userErrors { field message } } }`;

    const run = (await g(`mutation($m: String!, $p: String!) { bulkOperationRunMutation(mutation: $m, stagedUploadPath: $p) { bulkOperation { id status type query } userErrors { field message code } } }`, { m: mutation, p: key })).bulkOperationRunMutation;
    expect(run.userErrors).toEqual([]);
    expect(run.bulkOperation).toMatchObject({ type: 'MUTATION', query: mutation });
    await settle();
    const done = (await g(`query($id: ID!) { bulkOperation(id: $id) { status url objectCount rootObjectCount errorCode } }`, { id: run.bulkOperation.id })).bulkOperation;
    expect(done).toMatchObject({ status: 'COMPLETED', objectCount: '4', rootObjectCount: '4', errorCode: null });
    const lines = await fileLines(done.url);
    expect(lines.map((l) => l.__lineNumber)).toEqual([0, 1, 2, 3]);
    expect((lines[0]!.data as any).productCreate.product.title).toBe('Bulk One');
    expect((lines[1]!.data as any).productCreate.userErrors).toEqual([]);
    expect((lines[2]!.data as any).productCreate.userErrors[0].field).toEqual(['product', 'title']);
    expect(lines[3]!.errors).toBeTruthy();
    const found = (await g(`{ products(first: 10, query: "tag:bulk") { nodes { title } } }`)).products.nodes;
    expect(found).toEqual([{ title: 'Bulk Two' }]);
  });

  it('validates the mutation and the staged file', async () => {
    const run = async (m: string, p: string) => (await g(`mutation($m: String!, $p: String!) { bulkOperationRunMutation(mutation: $m, stagedUploadPath: $p) { bulkOperation { id } userErrors { field message code } } }`, { m, p })).bulkOperationRunMutation;
    const ok = 'mutation($product: ProductCreateInput!) { productCreate(product: $product) { product { id } } }';
    expect((await run('query { shop { name } }', 'x')).userErrors[0]).toMatchObject({ code: 'INVALID_MUTATION', field: ['mutation'] });
    expect((await run('mutation { nothingHere }', 'x')).userErrors[0].code).toBe('INVALID_MUTATION');
    expect((await run(ok, 'tmp/999/bulk/zzz/vars.jsonl')).userErrors[0]).toMatchObject({ code: 'NO_SUCH_FILE', field: ['stagedUploadPath'] });
    expect((await run(ok, `tmp/${shopId}/bulk/missing/vars.jsonl`)).userErrors[0].code).toBe('NO_SUCH_FILE');
    const staged = (await g(`mutation { stagedUploadsCreate(input: [{ resource: BULK_MUTATION_VARIABLES, filename: "bad.jsonl", mimeType: "text/jsonl" }]) { stagedTargets { url parameters { name value } } } }`)).stagedUploadsCreate.stagedTargets[0];
    await t.app.inject({ method: 'PUT', url: new URL(staged.url).pathname, payload: 'this is not json', headers: { 'content-type': 'text/jsonl' } });
    const key = staged.parameters.find((p: { name: string }) => p.name === 'key').value as string;
    expect((await run(ok, key)).userErrors[0]).toMatchObject({ code: 'INVALID_STAGED_UPLOAD_FILE' });
  });

  it('queues bulk_operations/finish webhooks', async () => {
    await g(`mutation { webhookSubscriptionCreate(topic: BULK_OPERATIONS_FINISH, webhookSubscription: { callbackUrl: "https://example.com/hook", format: JSON }) { webhookSubscription { id topic } userErrors { message } } }`);
    const run = (await g(`mutation { bulkOperationRunQuery(query: "{ products { nodes { id } } }") { bulkOperation { id } userErrors { message } } }`)).bulkOperationRunQuery;
    expect(run.userErrors).toEqual([]);
    await settle();
    let rows: { topic: string; payload: Record<string, unknown> }[] = [];
    for (let i = 0; i < 40 && !rows.length; i++) {
      await new Promise((r) => setTimeout(r, 100));
      rows = (await g(`{ shopmeWebhookDeliveries(first: 20) { nodes { wireTopic payload } } }`)).shopmeWebhookDeliveries.nodes
        .map((n: { wireTopic: string; payload: Record<string, unknown> }) => ({ topic: n.wireTopic, payload: n.payload }))
        .filter((r: { payload: Record<string, unknown> }) => r.payload.admin_graphql_api_id === run.bulkOperation.id);
    }
    expect(rows[0]).toMatchObject({ topic: 'bulk_operations/finish', payload: { admin_graphql_api_id: run.bulkOperation.id, status: 'completed', type: 'query', error_code: null } });
  });
});
