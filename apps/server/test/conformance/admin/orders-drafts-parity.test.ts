import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { createLocalStorage, getPrimaryShop, schema as s, seedDemo } from '@shopme/core';
import { createTestApp, setupAndLogin, type TestApp } from '../../../src/test-utils';
import { makeGql, makeGqlOk } from '../helpers';

describe('orders and drafts parity', () => {
  let t: TestApp;
  let gql: ReturnType<typeof makeGql>;
  let g: ReturnType<typeof makeGqlOk>;
  let shopId = 0;
  let variantId = '';
  const sku: Record<string, number> = {};
  const db = () => t.dbHandle.db;

  beforeAll(async () => {
    t = await createTestApp();
    gql = makeGql(t.app, await setupAndLogin(t.app));
    g = makeGqlOk(gql);
    await seedDemo(db(), createLocalStorage(mkdtempSync(path.join(tmpdir(), 'op-'))));
    shopId = (await getPrimaryShop(db()))!.id;
    for (const v of await db().select().from(s.productVariants)) if (v.sku) sku[v.sku] = v.id;
    variantId = `gid://shopify/ProductVariant/${sku['HEB-250']}`;
  }, 120_000);
  afterAll(async () => { await t.close(); });

  const draft = async (extra = '') => {
    const r = (await g(`mutation($v: ID!) { draftOrderCreate(input: { email: "d@example.com", lineItems: [{ variantId: $v, quantity: 2 }], ${extra} }) { draftOrder { id name tags } userErrors { field message } } }`, { v: variantId })).draftOrderCreate;
    expect(r.userErrors).toEqual([]);
    return r.draftOrder as { id: string; name: string; tags: string[] };
  };
  const tagsOf = async (id: string) => (await g(`{ draftOrder(id: "${id}") { tags } }`)).draftOrder.tags as string[];

  it('adds and removes tags on drafts in bulk by ids, search and saved search', async () => {
    const d1 = await draft('tags: ["a"]');
    const d2 = await draft('tags: ["a", "b"]');
    const d3 = await draft();
    const add = (vars: Record<string, unknown>) => g(`mutation($ids: [ID!], $search: String, $saved: ID, $tags: [String!]!) { draftOrderBulkAddTags(ids: $ids, search: $search, savedSearchId: $saved, tags: $tags) { job { id done } userErrors { field message } } }`, vars);
    const rem = (vars: Record<string, unknown>) => g(`mutation($ids: [ID!], $search: String, $tags: [String!]!) { draftOrderBulkRemoveTags(ids: $ids, search: $search, tags: $tags) { job { id done } userErrors { field message } } }`, vars);

    const r = (await add({ ids: [d1.id, d3.id], tags: ['rush', 'vip'] })).draftOrderBulkAddTags;
    expect(r.userErrors).toEqual([]);
    expect(r.job).toMatchObject({ done: true, id: expect.stringMatching(/^gid:\/\/shopify\/Job\/\d+$/) });
    expect(await tagsOf(d1.id)).toEqual(['a', 'rush', 'vip']);
    expect(await tagsOf(d2.id)).toEqual(['a', 'b']);
    expect(await tagsOf(d3.id)).toEqual(['rush', 'vip']);

    expect((await add({ search: 'tag:a', tags: ['alpha'] })).draftOrderBulkAddTags.userErrors).toEqual([]);
    expect(await tagsOf(d2.id)).toEqual(['a', 'alpha', 'b']);
    expect(await tagsOf(d3.id)).toEqual(['rush', 'vip']);

    expect((await rem({ ids: [d1.id, d2.id], tags: ['A', 'vip'] })).draftOrderBulkRemoveTags.userErrors).toEqual([]);
    expect(await tagsOf(d1.id)).toEqual(['alpha', 'rush']);
    expect(await tagsOf(d2.id)).toEqual(['alpha', 'b']);

    const saved = (await g(`mutation { savedSearchCreate(input: { resourceType: ORDER, name: "Rush", query: "tag:rush" }) { savedSearch { id } userErrors { message } } }`)).savedSearchCreate.savedSearch.id;
    expect((await add({ saved, tags: ['seen'] })).draftOrderBulkAddTags.userErrors).toEqual([]);
    expect(await tagsOf(d3.id)).toEqual(['rush', 'seen', 'vip']);

    expect((await add({ tags: ['x'] })).draftOrderBulkAddTags.userErrors).toEqual([{ field: null, message: expect.stringMatching(/required/) }]);
    expect((await add({ ids: [d1.id], search: 'x', tags: ['x'] })).draftOrderBulkAddTags.userErrors[0].message).toMatch(/Only one/);
    expect((await add({ ids: ['gid://shopify/DraftOrder/9999'], tags: ['x'] })).draftOrderBulkAddTags).toMatchObject({ job: null, userErrors: [{ field: ['ids'] }] });
    expect((await add({ ids: [d1.id], tags: [' '] })).draftOrderBulkAddTags.userErrors[0]).toMatchObject({ field: ['tags'] });
  });

  it('exposes draft order tags and the generic tagsAdd / tagsRemove', async () => {
    const d = await draft('tags: ["Hot Item"]');
    const tag = (await g(`{ draftOrderTag(id: "gid://shopify/DraftOrderTag/1") { id } }`)).draftOrderTag;
    expect(tag).toBeNull();
    const added = (await g(`mutation($id: ID!) { tagsAdd(id: $id, tags: ["extra"]) { node { id ... on DraftOrder { tags } } userErrors { field message } } }`, { id: d.id })).tagsAdd;
    expect(added).toEqual({ node: { id: d.id, tags: ['extra', 'Hot Item'] }, userErrors: [] });
    const removed = (await g(`mutation($id: ID!) { tagsRemove(id: $id, tags: ["extra"]) { node { ... on DraftOrder { tags } } userErrors { field message } } }`, { id: d.id })).tagsRemove;
    expect(removed.node.tags).toEqual(['Hot Item']);
    expect((await g(`mutation { tagsAdd(id: "gid://shopify/DraftOrder/99999", tags: ["x"]) { node { id } userErrors { field message } } }`)).tagsAdd.userErrors).toHaveLength(1);
    // Products still work through the same mutation.
    const product = (await g(`{ products(first: 1) { nodes { id } } }`)).products.nodes[0].id;
    expect((await g(`mutation($id: ID!) { tagsAdd(id: $id, tags: ["via-tags"]) { node { ... on Product { tags } } userErrors { message } } }`, { id: product })).tagsAdd.node.tags).toContain('via-tags');

    const list = (await g(`query($q: String) { draftOrders(first: 1, query: $q) { nodes { id } } }`, { q: 'tag:"Hot Item"' })).draftOrders.nodes;
    expect(list).toHaveLength(1);
  });

  it('duplicates a draft and creates a draft from an order', async () => {
    const d = (await g(`mutation($v: ID!) { draftOrderCreate(input: { email: "copy@example.com", note: "Gift", tags: ["x"], lineItems: [{ variantId: $v, quantity: 3 }, { title: "Engraving", originalUnitPrice: "5.00", quantity: 1 }], appliedDiscount: { value: 10, valueType: PERCENTAGE, title: "Friends" }, shippingAddress: { address1: "1 Rue", city: "Paris", countryCode: FR, zip: "75001" } }) { draftOrder { id name } userErrors { message } } }`, { v: variantId })).draftOrderCreate.draftOrder;
    const q = `mutation($id: ID, $old: ID) { draftOrderDuplicate(id: $id, draftOrderId: $old) { draftOrder { id name status email note2 tags invoiceUrl completedAt totalPriceSet { shopMoney { amount } } appliedDiscount { title } lineItems(first: 5) { nodes { title quantity } } shippingAddress { city } } userErrors { field message } } }`;
    const dup = (await g(q, { id: d.id })).draftOrderDuplicate;
    expect(dup.userErrors).toEqual([]);
    expect(dup.draftOrder.id).not.toBe(d.id);
    expect(dup.draftOrder.name).not.toBe(d.name);
    expect(dup.draftOrder).toMatchObject({ status: 'OPEN', email: 'copy@example.com', note2: 'Gift', tags: ['x'], completedAt: null, appliedDiscount: { title: 'Friends' }, shippingAddress: { city: 'Paris' } });
    expect(dup.draftOrder.lineItems.nodes.map((l: { title: string; quantity: number }) => `${l.quantity}x ${l.title}`)).toEqual(['3x House Espresso Blend', '1x Engraving']);
    const orig = (await g(`{ draftOrder(id: "${d.id}") { totalPriceSet { shopMoney { amount } } invoiceUrl } }`)).draftOrder;
    expect(dup.draftOrder.totalPriceSet.shopMoney.amount).toBe(orig.totalPriceSet.shopMoney.amount);
    expect(dup.draftOrder.invoiceUrl).not.toBe(orig.invoiceUrl);
    expect((await g(q, { old: d.id })).draftOrderDuplicate.userErrors).toEqual([]);
    expect((await g(q, { id: 'gid://shopify/DraftOrder/99999' })).draftOrderDuplicate).toMatchObject({ draftOrder: null, userErrors: [{ field: ['id'], message: 'Draft order does not exist' }] });
    expect((await g(q, {})).draftOrderDuplicate.userErrors).toHaveLength(1);

    // Complete the draft to get an order, then draft from it.
    const done = (await g(`mutation($id: ID!) { draftOrderComplete(id: $id) { draftOrder { order { id name } } userErrors { message } } }`, { id: d.id })).draftOrderComplete;
    expect(done.userErrors).toEqual([]);
    const order = done.draftOrder.order;
    const from = (await g(`mutation($o: ID!) { draftOrderCreateFromOrder(orderId: $o) { draftOrder { id status email note2 tags lineItems(first: 5) { nodes { title quantity } } shippingAddress { city } } userErrors { field message } } }`, { o: order.id })).draftOrderCreateFromOrder;
    expect(from.userErrors).toEqual([]);
    expect(from.draftOrder).toMatchObject({ status: 'OPEN', email: 'copy@example.com', note2: 'Gift', shippingAddress: { city: 'Paris' } });
    expect(from.draftOrder.lineItems.nodes.map((l: { title: string; quantity: number }) => `${l.quantity}x ${l.title}`)).toEqual(['3x House Espresso Blend', '1x Engraving']);
    expect((await g(`mutation { draftOrderCreateFromOrder(orderId: "gid://shopify/Order/99999") { draftOrder { id } userErrors { field message } } }`)).draftOrderCreateFromOrder).toMatchObject({ draftOrder: null, userErrors: [{ field: ['orderId'] }] });
  });

  it('deletes drafts in bulk', async () => {
    const d1 = await draft('tags: ["trash"]');
    const d2 = await draft('tags: ["trash"]');
    const keep = await draft('tags: ["keep"]');
    const del = (await g(`mutation($s: String) { draftOrderBulkDelete(search: $s) { job { done } userErrors { field message } } }`, { s: 'tag:trash' })).draftOrderBulkDelete;
    expect(del).toMatchObject({ job: { done: true }, userErrors: [] });
    expect((await g(`{ a: draftOrder(id: "${d1.id}") { id } b: draftOrder(id: "${d2.id}") { id } c: draftOrder(id: "${keep.id}") { id } }`))).toEqual({ a: null, b: null, c: { id: keep.id } });
    const byIds = (await g(`mutation($ids: [ID!]) { draftOrderBulkDelete(ids: $ids) { job { done } userErrors { message } } }`, { ids: [keep.id] })).draftOrderBulkDelete;
    expect(byIds.userErrors).toEqual([]);
    expect((await g(`{ draftOrder(id: "${keep.id}") { id } }`)).draftOrder).toBeNull();
  });

  it('captures authorized payments', async () => {
    const d = await draft();
    const done = (await g(`mutation($id: ID!) { draftOrderComplete(id: $id) { draftOrder { order { id } } userErrors { message } } }`, { id: d.id })).draftOrderComplete;
    expect(done.userErrors).toEqual([]);
    const orderGid = done.draftOrder.order.id as string;
    const [order] = await db().select().from(s.orders).where(eq(s.orders.id, Number(orderGid.split('/').pop())));
    expect(order).toBeTruthy();
    const saleTx = (await db().select().from(s.transactions).where(eq(s.transactions.orderId, order!.id)))[0];
    // The order still owes 10.00, which is authorized but not captured yet.
    await db().update(s.orders).set({ financialStatus: 'AUTHORIZED', total: saleTx!.amount + 1000 }).where(eq(s.orders.id, order!.id));
    const [auth] = await db().insert(s.transactions).values({ shopId, orderId: order!.id, kind: 'AUTHORIZATION', status: 'SUCCESS', gateway: 'bogus', amount: 1000, currency: order!.currency, test: true }).returning();
    const authGid = `gid://shopify/OrderTransaction/${auth!.id}`;
    const cap = (input: Record<string, unknown>) => g(`mutation($i: OrderCaptureInput!) { orderCapture(input: $i) { transaction { id kind status gateway amountSet { shopMoney { amount } } parentTransaction { id } } userErrors { field message } } }`, { i: input });

    expect((await cap({ id: orderGid, parentTransactionId: authGid, amount: '0' })).orderCapture.userErrors[0]).toMatchObject({ field: ['input', 'amount'] });
    expect((await cap({ id: orderGid, parentTransactionId: authGid, amount: '10.01' })).orderCapture.userErrors[0]).toMatchObject({ field: ['input', 'amount'], message: expect.stringMatching(/remaining/) });
    expect((await cap({ id: orderGid, parentTransactionId: 'gid://shopify/OrderTransaction/999999', amount: '1' })).orderCapture.userErrors[0]).toMatchObject({ field: ['input', 'parentTransactionId'] });
    expect(saleTx).toBeTruthy();
    expect((await cap({ id: orderGid, parentTransactionId: `gid://shopify/OrderTransaction/${saleTx!.id}`, amount: '1' })).orderCapture.userErrors[0]).toMatchObject({ field: ['input', 'parentTransactionId'] });
    expect((await cap({ id: 'gid://shopify/Order/999999', parentTransactionId: authGid, amount: '1' })).orderCapture.userErrors[0]).toMatchObject({ field: ['input', 'id'] });
    expect((await cap({ id: orderGid, parentTransactionId: authGid, amount: '1', currency: 'XTS' })).orderCapture.userErrors[0]).toMatchObject({ field: ['input', 'currency'] });

    const first = (await cap({ id: orderGid, parentTransactionId: authGid, amount: '4.00' })).orderCapture;
    expect(first.userErrors).toEqual([]);
    expect(first.transaction).toMatchObject({ kind: 'CAPTURE', status: 'SUCCESS', gateway: 'bogus', amountSet: { shopMoney: { amount: '4.0' } }, parentTransaction: { id: authGid } });
    expect((await g(`{ order(id: "${orderGid}") { displayFinancialStatus } }`)).order.displayFinancialStatus).toBe('PARTIALLY_PAID');
    const second = (await cap({ id: orderGid, parentTransactionId: authGid, amount: '6.00' })).orderCapture;
    expect(second.userErrors).toEqual([]);
    expect((await g(`{ order(id: "${orderGid}") { displayFinancialStatus } }`)).order.displayFinancialStatus).toBe('PAID');
    expect((await cap({ id: orderGid, parentTransactionId: authGid, amount: '1.00' })).orderCapture.userErrors[0]).toMatchObject({ field: ['input', 'parentTransactionId'] });
  });

  it('reads abandonments of abandoned checkouts', async () => {
    const add = await t.app.inject({ method: 'POST', url: '/cart/add.js', payload: { id: sku['HEB-250'], quantity: 2 } });
    const cart = add.cookies.find((c) => c.name === 'cart')!.value;
    const go = await t.app.inject({ method: 'POST', url: '/checkout', cookies: { cart } });
    const token = go.headers.location!.toString().split('/').pop()!;
    await t.app.inject({ method: 'POST', url: `/checkouts/${token}/refresh`, payload: { email: 'lost@example.com', firstName: 'Lou', lastName: 'Lost', address1: '1 Rue', city: 'Paris', zip: '75001', countryCode: 'FR' } });
    await db().update(s.carts).set({ updatedAt: new Date(Date.now() - 12 * 3_600_000) }).where(eq(s.carts.token, token));
    const checkout = (await g(`{ abandonedCheckouts(first: 5, query: "email:lost@example.com") { nodes { id } } }`)).abandonedCheckouts.nodes[0].id as string;

    const q = `{ abandonmentByAbandonedCheckoutId(abandonedCheckoutId: "${checkout}") { id abandonmentType mostRecentStep cartUrl createdAt emailState emailSentAt daysSinceLastAbandonmentEmail hoursSinceLastAbandonedCheckout isFromOnlineStore isFromShopApp isMostSignificantAbandonment customerHasNoOrderSinceAbandonment customerHasNoDraftOrderSinceAbandonment inventoryAvailable lastCheckoutAbandonmentDate customer { email } abandonedCheckoutPayload { id lineItemsQuantity } } }`;
    // A guest with no customer record has no abandonment.
    expect((await g(q)).abandonmentByAbandonedCheckoutId).toBeNull();
    const cust = (await g(`mutation { customerCreate(input: { email: "lost@example.com", firstName: "Lou" }) { customer { id } userErrors { message } } }`)).customerCreate;
    expect(cust.userErrors).toEqual([]);
    const a = (await g(q)).abandonmentByAbandonedCheckoutId;
    expect(a).toMatchObject({
      id: expect.stringMatching(/^gid:\/\/shopify\/Abandonment\/\d+$/), abandonmentType: 'CHECKOUT', mostRecentStep: 'CHECKOUT', emailState: 'NOT_SENT', emailSentAt: null, isFromOnlineStore: true, isFromShopApp: false,
      isMostSignificantAbandonment: true, customerHasNoOrderSinceAbandonment: true, customerHasNoDraftOrderSinceAbandonment: true, inventoryAvailable: true, customer: { email: 'lost@example.com' },
      abandonedCheckoutPayload: { id: checkout, lineItemsQuantity: 2 }, cartUrl: expect.stringContaining(`/checkouts/${token}/recover`),
    });
    expect(a.hoursSinceLastAbandonedCheckout).toBeGreaterThan(11);
    const byId = (await g(`{ abandonment(id: "${a.id}") { id abandonmentType } node(id: "${a.id}") { id } }`));
    expect(byId.abandonment).toEqual({ id: a.id, abandonmentType: 'CHECKOUT' });
    expect(byId.node.id).toBe(a.id);
    expect((await g(`{ abandonment(id: "gid://shopify/Abandonment/999999") { id } abandonmentByAbandonedCheckoutId(abandonedCheckoutId: "gid://shopify/AbandonedCheckout/999999") { id } }`))).toEqual({ abandonment: null, abandonmentByAbandonedCheckoutId: null });
  });
});
