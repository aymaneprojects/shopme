import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyIncludeFields, SHOPIFY_WEBHOOK_TOPICS, topicToWire, WEBHOOK_TOPICS } from '@shopme/core';
import { createTestApp, setupAndLogin, type TestApp } from '../../../src/test-utils';
import { makeGql, makeGqlOk } from '../helpers';

describe('webhook subscriptions parity', () => {
  let t: TestApp;
  let gql: ReturnType<typeof makeGql>;
  let g: ReturnType<typeof makeGqlOk>;

  beforeAll(async () => {
    t = await createTestApp();
    gql = makeGql(t.app, await setupAndLogin(t.app));
    g = makeGqlOk(gql);
  }, 120_000);
  afterAll(async () => { await t.close(); });

  const create = (topic: string, input: string) => g(`mutation { webhookSubscriptionCreate(topic: ${topic}, webhookSubscription: { ${input} }) { webhookSubscription { id legacyResourceId topic format uri callbackUrl includeFields metafieldNamespaces filter name apiVersion { handle } endpoint { __typename ... on WebhookHttpEndpoint { callbackUrl } } } userErrors { field message } } }`).then((d) => d.webhookSubscriptionCreate);

  it('knows every Shopify topic and delivers the ShopMe ones with the right wire name', async () => {
    const enumValues = (await g(`{ __type(name: "WebhookSubscriptionTopic") { enumValues { name } } }`)).__type.enumValues.map((v: { name: string }) => v.name);
    expect(enumValues).toHaveLength(new Set([...SHOPIFY_WEBHOOK_TOPICS, ...WEBHOOK_TOPICS]).size);
    for (const topic of ['ORDERS_CREATE', 'APP_UNINSTALLED', 'BULK_OPERATIONS_FINISH', 'METAOBJECTS_UPDATE', 'DISCOUNTS_CREATE', 'INVENTORY_LEVELS_UPDATE']) expect(enumValues).toContain(topic);
    for (const topic of WEBHOOK_TOPICS) expect(enumValues, topic).toContain(topic);
    expect(topicToWire('DRAFT_ORDERS_CREATE')).toBe('draft_orders/create');
    expect(topicToWire('BULK_OPERATIONS_FINISH')).toBe('bulk_operations/finish');
    expect(topicToWire('ORDERS_PAID')).toBe('orders/paid');
  });

  it('creates subscriptions with the optional fields and rejects bad input', async () => {
    const r = await create('PRODUCTS_UPDATE', 'callbackUrl: "https://example.com/hooks/products", includeFields: ["id", "title", "variants.price", "id"], metafieldNamespaces: ["custom"], filter: "vendor:Acme", name: "Product sync"');
    expect(r.userErrors).toEqual([]);
    expect(r.webhookSubscription).toMatchObject({
      topic: 'PRODUCTS_UPDATE', format: 'JSON', uri: 'https://example.com/hooks/products', callbackUrl: 'https://example.com/hooks/products', includeFields: ['id', 'title', 'variants.price'],
      metafieldNamespaces: ['custom'], filter: 'vendor:Acme', name: 'Product sync', endpoint: { __typename: 'WebhookHttpEndpoint', callbackUrl: 'https://example.com/hooks/products' },
    });
    expect(r.webhookSubscription.id).toMatch(/^gid:\/\/shopify\/WebhookSubscription\/\d+$/);
    expect(r.webhookSubscription.legacyResourceId).toMatch(/^\d+$/);

    const viaUri = await create('APP_UNINSTALLED', 'uri: "https://example.com/hooks/uninstalled"');
    expect(viaUri.userErrors).toEqual([]);
    expect(viaUri.webhookSubscription).toMatchObject({ topic: 'APP_UNINSTALLED', includeFields: [], metafieldNamespaces: [], filter: null, name: null });

    expect((await create('PRODUCTS_UPDATE', 'callbackUrl: "https://example.com/hooks/products"')).userErrors).toEqual([{ field: ['webhookSubscription', 'callbackUrl'], message: 'Address for this topic has already been taken' }]);
    expect((await create('ORDERS_PAID', 'callbackUrl: "not a url"')).userErrors[0]).toMatchObject({ field: ['webhookSubscription', 'callbackUrl'] });
    expect((await create('ORDERS_PAID', 'callbackUrl: "http://127.0.0.1/x"')).userErrors).toHaveLength(1);
    expect((await create('ORDERS_PAID', 'name: "no address"')).userErrors[0]).toMatchObject({ field: ['webhookSubscription', 'callbackUrl'] });
    expect((await create('ORDERS_PAID', 'callbackUrl: "https://example.com/x", format: XML')).userErrors).toHaveLength(1);
  });

  it('updates and deletes subscriptions', async () => {
    const sub = (await create('ORDERS_PAID', 'callbackUrl: "https://example.com/paid"')).webhookSubscription;
    const upd = (await g(`mutation($id: ID!) { webhookSubscriptionUpdate(id: $id, webhookSubscription: { callbackUrl: "https://example.com/paid-2", includeFields: ["id"], name: "Paid" }) { webhookSubscription { id uri includeFields name updatedAt } userErrors { field message } } }`, { id: sub.id })).webhookSubscriptionUpdate;
    expect(upd.userErrors).toEqual([]);
    expect(upd.webhookSubscription).toMatchObject({ id: sub.id, uri: 'https://example.com/paid-2', includeFields: ['id'], name: 'Paid' });
    expect((await g(`mutation { webhookSubscriptionUpdate(id: "gid://shopify/WebhookSubscription/99999", webhookSubscription: { name: "x" }) { webhookSubscription { id } userErrors { field message } } }`)).webhookSubscriptionUpdate).toEqual({ webhookSubscription: null, userErrors: [{ field: ['id'], message: 'Webhook subscription does not exist' }] });
    const del = (await g(`mutation($id: ID!) { webhookSubscriptionDelete(id: $id) { deletedWebhookSubscriptionId userErrors { field message } } }`, { id: sub.id })).webhookSubscriptionDelete;
    expect(del).toEqual({ deletedWebhookSubscriptionId: sub.id, userErrors: [] });
    expect((await g(`mutation($id: ID!) { webhookSubscriptionDelete(id: $id) { deletedWebhookSubscriptionId userErrors { field message } } }`, { id: sub.id })).webhookSubscriptionDelete).toEqual({ deletedWebhookSubscriptionId: null, userErrors: [{ field: ['id'], message: 'Webhook subscription does not exist' }] });
  });

  it('lists, filters, sorts and counts subscriptions', async () => {
    await create('ORDERS_CREATE', 'callbackUrl: "https://example.com/a"');
    await create('ORDERS_CREATE', 'callbackUrl: "https://shop.example.org/b"');
    const all = (await g(`{ webhookSubscriptions(first: 20) { nodes { id topic uri } } webhookSubscriptionsCount { count precision } }`));
    const n = all.webhookSubscriptions.nodes.length;
    expect(all.webhookSubscriptionsCount).toEqual({ count: n, precision: 'EXACT' });
    expect(n).toBeGreaterThanOrEqual(4);

    const q = async (args: string) => (await g(`{ webhookSubscriptions(first: 20 ${args}) { nodes { topic uri } } }`)).webhookSubscriptions.nodes as { topic: string; uri: string }[];
    expect((await q(', topics: [ORDERS_CREATE]')).map((x) => x.uri)).toEqual(['https://example.com/a', 'https://shop.example.org/b']);
    expect((await q(', uri: "https://example.com/a"')).map((x) => x.topic)).toEqual(['ORDERS_CREATE']);
    expect((await q(', callbackUrl: "https://example.com/a"'))).toHaveLength(1);
    expect((await q(', format: JSON')).length).toBe(n);
    expect((await q(', topics: [ORDERS_CREATE], reverse: true, sortKey: ID')).map((x) => x.uri)).toEqual(['https://shop.example.org/b', 'https://example.com/a']);
    expect((await q(', query: "topic:orders_create endpoint:shop.example.org"')).map((x) => x.uri)).toEqual(['https://shop.example.org/b']);
    expect((await q(', sortKey: CREATED_AT, reverse: true'))[0]!.uri).toBe('https://shop.example.org/b');
    expect((await g(`{ webhookSubscriptionsCount(query: "topic:ORDERS_CREATE") { count } }`)).webhookSubscriptionsCount.count).toBe(2);
    expect((await g(`{ webhookSubscriptionsCount(limit: 1) { count precision } }`)).webhookSubscriptionsCount).toEqual({ count: 1, precision: 'AT_LEAST' });
    const last = (await g(`{ webhookSubscriptions(last: 1) { nodes { uri } } }`)).webhookSubscriptions.nodes;
    expect(last).toHaveLength(1);
    const node = (await g(`query($id: ID!) { node(id: $id) { ... on WebhookSubscription { topic } } }`, { id: (await g(`{ webhookSubscriptions(first: 1) { nodes { id } } }`)).webhookSubscriptions.nodes[0].id })).node;
    expect(node.topic).toBeTruthy();
  });

  it('keeps only includeFields in delivered payloads', () => {
    const p = { id: 1, title: 'x', vendor: 'v', variants: [{ id: 2, price: '1.00', sku: 's' }, { id: 3, price: '2.00', sku: 't' }], customer: { id: 9, email: 'e' } };
    expect(applyIncludeFields(p, [])).toBe(p);
    expect(applyIncludeFields(p, ['id', 'title'])).toEqual({ id: 1, title: 'x' });
    expect(applyIncludeFields(p, ['variants.price', 'variants.id'])).toEqual({ variants: [{ price: '1.00', id: 2 }, { price: '2.00', id: 3 }] });
    expect(applyIncludeFields(p, ['customer.email', 'missing'])).toEqual({ customer: { email: 'e' } });
  });
});
