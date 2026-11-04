import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, setupAndLogin, type TestApp } from '../../../src/test-utils';
import { makeGql, makeGqlOk } from '../helpers';
import { seedCatalog } from '../seed';
import { seedCustomer, seedOrder, shopIdOf } from '../seed-sales';

const num = (gid: string) => Number(gid.split('/').pop());

describe('orders and customers API', () => {
  let t: TestApp;
  let gql: ReturnType<typeof makeGql>;
  let g: ReturnType<typeof makeGqlOk>;
  let shopId: number;
  let cat: Awaited<ReturnType<typeof seedCatalog>>;
  let customerGid: string;
  const o: Record<string, { id: string; line: string }> = {};

  beforeAll(async () => {
    t = await createTestApp();
    gql = makeGql(t.app, await setupAndLogin(t.app));
    g = makeGqlOk(gql);
    shopId = await shopIdOf(t.dbHandle.db);
    cat = await seedCatalog(g);
    const c = await seedCustomer(t.dbHandle.db, shopId);
    customerGid = `gid://shopify/Customer/${c.id}`;
    const mk = async (key: string, n: number, extra: Parameters<typeof seedOrder>[3] = {}) => {
      const r = await seedOrder(t.dbHandle.db, shopId, n, extra);
      o[key] = { id: `gid://shopify/Order/${r.order.id}`, line: `gid://shopify/LineItem/${r.line.id}` };
    };
    await mk('a', 1, { customerId: c.id, processedAt: new Date('2026-11-01T10:00:00Z'), tags: ['vip'], variantId: num(cat.minimalVariant.id) });
    await mk('b', 2, { processedAt: new Date('2026-11-02T10:00:00Z'), paid: false, email: 'other@example.com', lineTitle: 'Mug', sku: 'MUG-1' });
    await mk('c', 3, { processedAt: new Date('2026-11-03T10:00:00Z'), fulfillmentStatus: 'FULFILLED', closedAt: new Date() });
  }, 120_000);
  afterAll(async () => { await t.close(); });

  it('lists, sorts and filters orders', async () => {
    const names = async (args: string) => (await g(`{ orders(first: 10 ${args}) { nodes { name } } }`)).orders.nodes.map((n: { name: string }) => n.name);
    expect(await names('')).toEqual(['#1003', '#1002', '#1001']); // newest first by default
    expect(await names(', reverse: true')).toEqual(['#1001', '#1002', '#1003']);
    expect(await names(', query: "financial_status:pending"')).toEqual(['#1002']);
    expect(await names(', query: "fulfillment_status:unfulfilled"')).toEqual(['#1002', '#1001']);
    expect(await names(', query: "status:closed"')).toEqual(['#1003']);
    expect(await names(', query: "status:open"')).toEqual(['#1002', '#1001']);
    expect(await names(', query: "name:#1002"')).toEqual(['#1002']);
    expect(await names(', query: "email:other@example.com"')).toEqual(['#1002']);
    expect(await names(', query: "tag:vip"')).toEqual(['#1001']);
    expect(await names(', query: "Mug"')).toEqual(['#1002']);
    expect(await names(', query: "Winfield"')).toEqual(['#1001']);
    expect(await names(', sortKey: TOTAL_PRICE, reverse: true')).toHaveLength(3);
    expect((await g(`{ ordersCount(query: "financial_status:paid") { count precision } }`)).ordersCount).toEqual({ count: 2, precision: 'EXACT' });
    const page = (await g(`{ orders(first: 1) { pageInfo { hasNextPage endCursor } } }`)).orders.pageInfo;
    expect(page.hasNextPage).toBe(true);
  });

  it('reads an order in full', async () => {
    const { order } = await g(`{ order(id: "${o.a!.id}") {
      id name number displayFinancialStatus displayFulfillmentStatus closed canMarkAsPaid unpaid note tags test
      totalPriceSet { shopMoney { amount currencyCode } presentmentMoney { amount } } subtotalPriceSet { shopMoney { amount } } totalShippingPriceSet { shopMoney { amount } } totalReceivedSet { shopMoney { amount } } totalOutstandingSet { shopMoney { amount } }
      customer { id displayName numberOfOrders amountSpent { amount currencyCode } }
      shippingAddress { name address1 address2 city countryCodeV2 country formatted(withName: true) formattedArea }
      lineItems(first: 5) { nodes { id name title quantity sku originalUnitPriceSet { shopMoney { amount } } discountedTotalSet { shopMoney { amount } } taxLines { title rate ratePercentage priceSet { shopMoney { amount } } } product { id } variant { id } customAttributes { key value } } }
      shippingLines(first: 5) { nodes { title originalPriceSet { shopMoney { amount } } taxLines { title } } }
      discountApplications(first: 5) { nodes { __typename targetType value { __typename ... on PricingPercentageValue { percentage } } ... on DiscountCodeApplication { code } } }
      transactions { id kind status gateway amountSet { shopMoney { amount } } } fulfillments { id } refunds { id }
    } }`);
    expect(order.name).toBe('#1001');
    expect(order.id).toMatch(/^gid:\/\/shopify\/Order\/\d+$/);
    expect(order.totalPriceSet.shopMoney).toEqual({ amount: '25.0', currencyCode: 'EUR' });
    expect(order.totalOutstandingSet.shopMoney.amount).toBe('0.0');
    expect(order.canMarkAsPaid).toBe(false);
    expect(order.customer).toMatchObject({ displayName: 'Russell Winfield', numberOfOrders: '1', amountSpent: { amount: '25.0', currencyCode: 'EUR' } });
    expect(order.shippingAddress).toMatchObject({ name: 'Ada Lovelace', city: 'Paris', countryCodeV2: 'FR', country: 'France' });
    expect(order.shippingAddress.formatted).toEqual(['Ada Lovelace', '1 Rue X', 'Apt 2', '75001 Paris', 'France']);
    expect(order.lineItems.nodes[0]).toMatchObject({ name: 'Snow Board - Blue', quantity: 2, customAttributes: [{ key: 'engraving', value: 'Hi' }], taxLines: [{ title: 'VAT', rate: 0.2, ratePercentage: 20 }] });
    expect(order.lineItems.nodes[0].variant.id).toBe(cat.minimalVariant.id);
    expect(order.discountApplications.nodes[0]).toMatchObject({ __typename: 'DiscountCodeApplication', code: 'WELCOME', value: { __typename: 'PricingPercentageValue', percentage: 10 } });
    expect(order.transactions[0]).toMatchObject({ kind: 'SALE', status: 'SUCCESS', gateway: 'bogus' });
    expect((await g(`{ node(id: "${o.a!.id}") { ... on Order { name } } order(id: "gid://shopify/Order/99999") { id } }`))).toEqual({ node: { name: '#1001' }, order: null });
  });

  it('updates, closes, reopens and tags orders; writes a timeline', async () => {
    const up = await g(`mutation { orderUpdate(input: { id: "${o.b!.id}", note: "Gift", tags: ["z", "a"], email: "x@example.com", shippingAddress: { city: "Lyon", countryCode: FR } }) { order { note tags email shippingAddress { city countryCodeV2 } } userErrors { field message } } }`);
    expect(up.orderUpdate.userErrors).toEqual([]);
    expect(up.orderUpdate.order).toMatchObject({ note: 'Gift', tags: ['a', 'z'], email: 'x@example.com', shippingAddress: { city: 'Lyon', countryCodeV2: 'FR' } });
    const bad = await g(`mutation { orderUpdate(input: { id: "${o.b!.id}", email: "nope" }) { order { id } userErrors { field message } } }`);
    expect(bad.orderUpdate.order).toBeNull();
    expect(bad.orderUpdate.userErrors[0].message).toMatch(/Email/);

    expect((await g(`mutation { orderClose(input: { id: "${o.b!.id}" }) { order { closed closedAt } userErrors { message } } }`)).orderClose.order.closed).toBe(true);
    expect((await g(`mutation { orderOpen(input: { id: "${o.b!.id}" }) { order { closed closedAt } } }`)).orderOpen.order).toEqual({ closed: false, closedAt: null });

    const tags = await g(`mutation { tagsAdd(id: "${o.b!.id}", tags: ["new"]) { node { id ... on Order { tags } } userErrors { message } } }`);
    expect(tags.tagsAdd.node.tags).toEqual(['a', 'new', 'z']);
    expect((await g(`mutation { tagsRemove(id: "${o.b!.id}", tags: ["a", "z"]) { node { ... on Order { tags } } } }`)).tagsRemove.node.tags).toEqual(['new']);

    const c = await g(`mutation { orderTimelineCommentCreate(id: "${o.b!.id}", message: "Called the buyer") { event { __typename message ... on CommentEvent { rawMessage author { email } } } userErrors { message } } }`);
    expect(c.orderTimelineCommentCreate.event).toMatchObject({ __typename: 'CommentEvent', rawMessage: 'Called the buyer', author: { email: 'owner@example.com' } });
    const ev = (await g(`{ order(id: "${o.b!.id}") { hasTimelineComment events(first: 20, reverse: true) { nodes { __typename message } } } }`)).order;
    expect(ev.hasTimelineComment).toBe(true);
    expect(ev.events.nodes[0]).toEqual({ __typename: 'CommentEvent', message: 'Called the buyer' });
    expect(ev.events.nodes.map((n: { message: string }) => n.message)).toContain('Order was archived');
  });

  it('marks an unpaid order as paid', async () => {
    const before = (await g(`{ order(id: "${o.b!.id}") { canMarkAsPaid totalOutstandingSet { shopMoney { amount } } } }`)).order;
    expect(before).toEqual({ canMarkAsPaid: true, totalOutstandingSet: { shopMoney: { amount: '25.0' } } });
    const r = await g(`mutation { orderMarkAsPaid(input: { id: "${o.b!.id}" }) { order { displayFinancialStatus transactions { kind gateway amountSet { shopMoney { amount } } } } userErrors { message } } }`);
    expect(r.orderMarkAsPaid.order).toMatchObject({ displayFinancialStatus: 'PAID', transactions: [{ kind: 'SALE', gateway: 'manual', amountSet: { shopMoney: { amount: '25.0' } } }] });
    expect((await g(`mutation { orderMarkAsPaid(input: { id: "${o.b!.id}" }) { order { id } userErrors { message } } }`)).orderMarkAsPaid.userErrors[0].message).toMatch(/already paid/);
  });

  it('fulfils partially then fully with tracking', async () => {
    const mk = await seedOrder(t.dbHandle.db, shopId, 10, { qty: 3 });
    const id = `gid://shopify/Order/${mk.order.id}`;
    const line = `gid://shopify/LineItem/${mk.line.id}`;
    const f1 = await g(`mutation { fulfillmentCreate(fulfillment: { orderId: "${id}", lineItems: [{ id: "${line}", quantity: 1 }], trackingInfo: { company: "DHL", number: "123", url: "https://dhl.example/123" } }) {
      fulfillment { id name status totalQuantity trackingInfo { company number url } fulfillmentLineItems(first: 5) { nodes { quantity lineItem { id } } } order { displayFulfillmentStatus } } userErrors { field message } } }`);
    expect(f1.fulfillmentCreate.userErrors).toEqual([]);
    expect(f1.fulfillmentCreate.fulfillment).toMatchObject({ name: '#1010.1', status: 'SUCCESS', totalQuantity: 1, trackingInfo: [{ company: 'DHL', number: '123', url: 'https://dhl.example/123' }], order: { displayFulfillmentStatus: 'PARTIALLY_FULFILLED' } });
    const tooMany = await g(`mutation { fulfillmentCreate(fulfillment: { orderId: "${id}", lineItems: [{ id: "${line}", quantity: 5 }] }) { fulfillment { id } userErrors { message } } }`);
    expect(tooMany.fulfillmentCreate.userErrors[0].message).toMatch(/between 1 and 2/);
    const f2 = await g(`mutation { fulfillmentCreate(fulfillment: { lineItemsByFulfillmentOrder: [{ fulfillmentOrderId: "${id}" }] }) { fulfillment { name order { displayFulfillmentStatus } } userErrors { message } } }`);
    expect(f2.fulfillmentCreate.fulfillment).toEqual({ name: '#1010.2', order: { displayFulfillmentStatus: 'FULFILLED' } });
    const upd = await g(`mutation { fulfillmentTrackingInfoUpdate(fulfillmentId: "${f1.fulfillmentCreate.fulfillment.id}", trackingInfoInput: { number: "999", company: "UPS" }) { fulfillment { trackingInfo { company number } } userErrors { message } } }`);
    expect(upd.fulfillmentTrackingInfoUpdate.fulfillment.trackingInfo).toEqual([{ company: 'UPS', number: '999' }]);
    const none = await g(`mutation { fulfillmentCreate(fulfillment: { orderId: "${id}" }) { fulfillment { id } userErrors { message } } }`);
    expect(none.fulfillmentCreate.userErrors[0].message).toMatch(/no items left/);
  });

  const stock = async () => (await g(`{ product(id: "${cat.minimal.id}") { totalInventory } }`)).product.totalInventory as number;

  it('refunds line items with restock and records a refund transaction', async () => {
    const start = await stock();
    const r = await g(`mutation { refundCreate(input: { orderId: "${o.a!.id}", note: "Damaged", refundLineItems: [{ lineItemId: "${o.a!.line}", quantity: 1, restockType: RETURN }], shipping: { fullRefund: true } }) {
      refund { id note totalRefundedSet { shopMoney { amount } } refundLineItems(first: 5) { nodes { quantity restocked restockType subtotalSet { shopMoney { amount } } } } transactions(first: 5) { nodes { kind gateway amountSet { shopMoney { amount } } } } }
      order { displayFinancialStatus totalRefundedSet { shopMoney { amount } } currentTotalPriceSet { shopMoney { amount } } lineItems(first: 5) { nodes { currentQuantity refundableQuantity } } refunds { id } }
      userErrors { field message } } }`);
    expect(r.refundCreate.userErrors).toEqual([]);
    // line: 1000 subtotal + 50 tax share, shipping 500 -> 15.50
    expect(r.refundCreate.refund.totalRefundedSet.shopMoney.amount).toBe('15.5');
    expect(r.refundCreate.refund.refundLineItems.nodes[0]).toMatchObject({ quantity: 1, restocked: true, restockType: 'RETURN', subtotalSet: { shopMoney: { amount: '10.0' } } });
    expect(r.refundCreate.refund.transactions.nodes).toEqual([{ kind: 'REFUND', gateway: 'bogus', amountSet: { shopMoney: { amount: '15.5' } } }]);
    expect(r.refundCreate.order).toMatchObject({ displayFinancialStatus: 'PARTIALLY_REFUNDED', totalRefundedSet: { shopMoney: { amount: '15.5' } }, currentTotalPriceSet: { shopMoney: { amount: '9.5' } } });
    expect(r.refundCreate.order.lineItems.nodes[0].currentQuantity).toBe(1);
    expect(await stock()).toBe(start + 1);
    const over = await g(`mutation { refundCreate(input: { orderId: "${o.a!.id}", transactions: [{ orderId: "${o.a!.id}", amount: "100.00", gateway: "bogus", kind: REFUND }] }) { refund { id } userErrors { message } } }`);
    expect(over.refundCreate.refund).toBeNull();
    expect(over.refundCreate.userErrors[0].message).toMatch(/exceeds/);
  });

  it('cancels with restock and refund', async () => {
    const mk = await seedOrder(t.dbHandle.db, shopId, 20, { qty: 2, variantId: num(cat.minimalVariant.id) });
    const id = `gid://shopify/Order/${mk.order.id}`;
    const start = await stock();
    const r = await g(`mutation { orderCancel(orderId: "${id}", reason: CUSTOMER, restock: true, refund: true, staffNote: "changed mind") { job { done } orderCancelUserErrors { code message } userErrors { message } } }`);
    expect(r.orderCancel.orderCancelUserErrors).toEqual([]);
    expect(r.orderCancel.job.done).toBe(true);
    const after = (await g(`{ order(id: "${id}") { cancelledAt cancelReason closedAt displayFinancialStatus displayFulfillmentStatus refunds { id } } }`)).order;
    expect(after).toMatchObject({ cancelReason: 'CUSTOMER', displayFinancialStatus: 'REFUNDED', displayFulfillmentStatus: 'RESTOCKED' });
    expect(after.cancelledAt).toBeTruthy();
    expect(after.refunds).toHaveLength(1);
    expect(await stock()).toBe(start + 2);
    const again = await g(`mutation { orderCancel(orderId: "${id}", reason: OTHER, restock: false) { orderCancelUserErrors { code message } } }`);
    expect(again.orderCancel.orderCancelUserErrors[0]).toMatchObject({ code: 'INVALID' });
    expect((await g(`{ ordersCount(query: "status:cancelled") { count } }`)).ordersCount.count).toBe(1);
  });

  it('manages customers', async () => {
    const created = await g(`mutation { customerCreate(input: { email: "New@Example.com", firstName: "Ada", lastName: "L", phone: "+33123456789", tags: ["b", "a"], note: "n", addresses: [{ address1: "1 Rue X", city: "Paris", countryCode: FR, zip: "75001" }] }) {
      customer { id displayName defaultEmailAddress { emailAddress marketingState } defaultPhoneNumber { phoneNumber } tags state numberOfOrders amountSpent { amount currencyCode } defaultAddress { city countryCodeV2 } addressesV2(first: 5) { nodes { city } } } userErrors { field message } } }`);
    expect(created.customerCreate.userErrors).toEqual([]);
    const c = created.customerCreate.customer;
    expect(c).toMatchObject({ displayName: 'Ada L', defaultEmailAddress: { emailAddress: 'new@example.com', marketingState: 'NOT_SUBSCRIBED' }, tags: ['a', 'b'], state: 'DISABLED', numberOfOrders: '0', amountSpent: { amount: '0.0', currencyCode: 'EUR' }, defaultAddress: { city: 'Paris', countryCodeV2: 'FR' } });
    const dup = await g(`mutation { customerCreate(input: { email: "new@example.com" }) { customer { id } userErrors { field message } } }`);
    expect(dup.customerCreate.userErrors).toEqual([{ field: ['input', 'email'], message: 'Email has already been taken' }]);
    const upd = await g(`mutation { customerUpdate(input: { id: "${c.id}", firstName: "Grace", note: "x", taxExempt: true }) { customer { displayName note taxExempt } userErrors { message } } }`);
    expect(upd.customerUpdate.customer).toEqual({ displayName: 'Grace L', note: 'x', taxExempt: true });
    expect((await g(`mutation { tagsAdd(id: "${c.id}", tags: ["c"]) { node { ... on Customer { tags } } } }`)).tagsAdd.node.tags).toEqual(['a', 'b', 'c']);

    const list = (q: string) => g(`{ customers(first: 10, query: "${q}") { nodes { displayName } } customersCount(query: "${q}") { count } }`);
    expect((await list('Grace')).customers.nodes).toEqual([{ displayName: 'Grace L' }]);
    expect((await list('tag:vip')).customers.nodes).toEqual([{ displayName: 'Russell Winfield' }]);
    expect((await list('orders_count:>0')).customersCount.count).toBe(1);
    expect((await list('email:new@example.com')).customersCount.count).toBe(1);

    const withOrders = (await g(`{ customer(id: "${customerGid}") { numberOfOrders orders(first: 5) { nodes { name } } } }`)).customer;
    expect(withOrders).toMatchObject({ numberOfOrders: '1', orders: { nodes: [{ name: '#1001' }] } });
    const del = await g(`mutation { customerDelete(input: { id: "${customerGid}" }) { deletedCustomerId userErrors { message } } }`);
    expect(del.customerDelete.deletedCustomerId).toBeNull();
    expect(del.customerDelete.userErrors[0].message).toMatch(/associated orders/);
    const ok = await g(`mutation { customerDelete(input: { id: "${c.id}" }) { deletedCustomerId userErrors { message } } }`);
    expect(ok.customerDelete.deletedCustomerId).toBe(c.id);
    expect((await g(`{ customer(id: "${c.id}") { id } }`)).customer).toBeNull();
  });
});
