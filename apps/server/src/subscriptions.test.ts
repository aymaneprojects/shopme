import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Stripe from 'stripe';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { createLocalStorage, getPrimaryShop, schema as s, seedDemo, type Mail } from '@shopme/core';
import { createStripeGateway } from '@shopme/payments';
import { createTestApp, SETUP_BODY, type TestApp } from './test-utils';
import { makeGql, makeGqlOk } from '../test/conformance/helpers';
import { runDueBilling, sendRenewalReminders } from './subscriptions';

const STRIPE = { secretKey: 'sk_test_x', publishableKey: 'pk_test_x', webhookSecret: 'whsec_test' };
const ADDRESS = { firstName: 'Ada', lastName: 'Lovelace', address1: '1 Rue de Rivoli', city: 'Paris', zip: '75001', countryCode: 'FR', phone: '' };
const DAY = 86400_000;

let t: TestApp;
let g: ReturnType<typeof makeGqlOk>;
let gql: ReturnType<typeof makeGql>;
let sent: Mail[];
let shopId: number;
const sku: Record<string, number> = {};
let coffeeId: number;
let groupId: number;
let planIds: number[];

const db = () => t.dbHandle.db;
const gid = (type: string, id: number) => `gid://shopify/${type}/${id}`;
const num = (g0: string) => Number(g0.split('/').pop());

beforeAll(async () => {
  t = await createTestApp({ STRIPE_SECRET_KEY: STRIPE.secretKey, STRIPE_PUBLISHABLE_KEY: STRIPE.publishableKey, STRIPE_WEBHOOK_SECRET: STRIPE.webhookSecret });
  const setup = await t.app.inject({ method: 'POST', url: '/admin/api/setup', payload: SETUP_BODY });
  gql = makeGql(t.app, setup.cookies.find((c) => c.name === 'shopme_session')!.value);
  g = makeGqlOk(gql);
  await seedDemo(db(), createLocalStorage(mkdtempSync(path.join(tmpdir(), 'subs-'))));
  shopId = (await getPrimaryShop(db()))!.id;
  for (const v of await db().select().from(s.productVariants)) if (v.sku) sku[v.sku] = v.id;
  coffeeId = (await db().select().from(s.products).where(eq(s.products.handle, 'highland-morning-coffee-beans')))[0]!.id;
  groupId = (await db().select().from(s.sellingPlanGroups))[0]!.id;
  planIds = (await db().select().from(s.sellingPlans).where(eq(s.sellingPlans.groupId, groupId))).map((p) => p.id).sort((a, b) => a - b);
  sent = [];
  t.app.ctx.mailer = { send: async (m) => { sent.push(m); } };
}, 90_000);
afterAll(async () => { await t.close(); });

async function cartWith(items: Record<string, unknown>[], cookies: Record<string, string> = {}) {
  const add = await t.app.inject({ method: 'POST', url: '/cart/add.js', payload: { items }, cookies });
  expect(add.statusCode, add.body).toBe(200);
  return add.cookies.find((c) => c.name === 'cart')?.value ?? cookies.cart!;
}
async function checkout(cart: string, email: string, method: string, extra: Record<string, unknown> = {}, cookies: Record<string, string> = {}) {
  const go = await t.app.inject({ method: 'POST', url: '/checkout', cookies: { cart, ...cookies } });
  const token = go.headers.location!.toString().split('/').pop()!;
  await t.app.inject({ method: 'POST', url: `/checkouts/${token}/refresh`, payload: { ...ADDRESS, email, ...extra }, cookies });
  const res = await t.app.inject({ method: 'POST', url: `/checkouts/${token}/complete`, payload: { ...ADDRESS, email, paymentMethod: method }, headers: { 'content-type': 'application/json' }, cookies });
  return { token, res };
}
const contractOfOrder = async (orderId: number) => (await db().select().from(s.subscriptionContracts).where(eq(s.subscriptionContracts.originOrderId, orderId)))[0]!;

describe('selling plan groups: Admin API', () => {
  const GROUP = `id name merchantCode options summary productsCount { count } productVariantsCount { count }
    sellingPlans(first: 10) { nodes { id name options position category
      billingPolicy { ... on SellingPlanRecurringBillingPolicy { interval intervalCount minCycles maxCycles } }
      deliveryPolicy { ... on SellingPlanRecurringDeliveryPolicy { interval intervalCount intent } }
      pricingPolicies { __typename ... on SellingPlanPricingPolicyBase { adjustmentType adjustmentValue { __typename ... on SellingPlanPricingPolicyPercentageValue { percentage } ... on MoneyV2 { amount currencyCode } } } ... on SellingPlanRecurringPricingPolicy { afterCycle } } } }`;
  let created: string;

  it('creates a group with plans, attaches products and variants, updates and deletes it', async () => {
    const tea = (await db().select().from(s.products).where(eq(s.products.handle, 'jasmine-pearl-green-tea')))[0]!.id;
    const r = (await g(`mutation($input: SellingPlanGroupInput!, $resources: SellingPlanGroupResourceInput) { sellingPlanGroupCreate(input: $input, resources: $resources) { sellingPlanGroup { ${GROUP} } userErrors { field message code } } }`, {
      input: {
        name: 'Tea club', merchantCode: 'tea-club', options: ['Delivery every'],
        sellingPlansToCreate: [
          { name: 'Monthly', options: ['Month'], category: 'SUBSCRIPTION', billingPolicy: { recurring: { interval: 'MONTH', intervalCount: 1, maxCycles: 6 } }, deliveryPolicy: { recurring: { interval: 'MONTH', intervalCount: 1 } },
            pricingPolicies: [{ fixed: { adjustmentType: 'PERCENTAGE', adjustmentValue: { percentage: 5 } } }, { recurring: { adjustmentType: 'PRICE', adjustmentValue: { fixedValue: '9.50' }, afterCycle: 3 } }] },
          { name: 'Quarterly prepaid', options: ['3 months'], billingPolicy: { recurring: { interval: 'MONTH', intervalCount: 3 } }, deliveryPolicy: { recurring: { interval: 'MONTH', intervalCount: 1 } }, pricingPolicies: [] },
        ],
      },
      resources: { productIds: [gid('Product', tea)] },
    })).sellingPlanGroupCreate;
    expect(r.userErrors).toEqual([]);
    const grp = r.sellingPlanGroup;
    created = grp.id;
    expect(grp).toMatchObject({ name: 'Tea club', merchantCode: 'tea-club', options: ['Delivery every'], summary: 'Monthly, Quarterly prepaid', productsCount: { count: 1 }, productVariantsCount: { count: 0 } });
    const monthly = grp.sellingPlans.nodes[0];
    expect(monthly).toMatchObject({ name: 'Monthly', options: ['Month'], position: 1, category: 'SUBSCRIPTION', billingPolicy: { interval: 'MONTH', intervalCount: 1, minCycles: null, maxCycles: 6 }, deliveryPolicy: { interval: 'MONTH', intervalCount: 1, intent: 'FULFILLMENT_BEGIN' } });
    expect(monthly.pricingPolicies).toEqual([
      { __typename: 'SellingPlanFixedPricingPolicy', adjustmentType: 'PERCENTAGE', adjustmentValue: { __typename: 'SellingPlanPricingPolicyPercentageValue', percentage: 5 } },
      { __typename: 'SellingPlanRecurringPricingPolicy', adjustmentType: 'PRICE', adjustmentValue: { __typename: 'MoneyV2', amount: '9.5', currencyCode: 'EUR' }, afterCycle: 3 },
    ]);

    const product = (await g(`query($id: ID!) { product(id: $id) { requiresSellingPlan sellingPlanGroupsCount { count } sellingPlanGroups(first: 5) { nodes { id name } } } }`, { id: gid('Product', tea) })).product;
    expect(product).toMatchObject({ requiresSellingPlan: false, sellingPlanGroupsCount: { count: 1 }, sellingPlanGroups: { nodes: [{ id: created, name: 'Tea club' }] } });
    const up = (await g(`mutation($p: ProductUpdateInput!) { productUpdate(product: $p) { product { requiresSellingPlan } userErrors { message } } }`, { p: { id: gid('Product', tea), requiresSellingPlan: true } })).productUpdate;
    expect(up.product.requiresSellingPlan).toBe(true);
    await g(`mutation($p: ProductUpdateInput!) { productUpdate(product: $p) { userErrors { message } } }`, { p: { id: gid('Product', tea), requiresSellingPlan: false } });

    const u = (await g(`mutation($id: ID!, $input: SellingPlanGroupInput!) { sellingPlanGroupUpdate(id: $id, input: $input) { deletedSellingPlanIds sellingPlanGroup { name sellingPlans(first: 5) { nodes { id name billingPolicy { ... on SellingPlanRecurringBillingPolicy { interval intervalCount maxCycles } } } } } userErrors { field message } } }`, {
      id: created, input: { name: 'Tea lovers', sellingPlansToUpdate: [{ id: monthly.id, name: 'Every month', billingPolicy: { recurring: { intervalCount: 1 } } }], sellingPlansToDelete: [grp.sellingPlans.nodes[1].id] },
    })).sellingPlanGroupUpdate;
    expect(u.userErrors).toEqual([]);
    expect(u.deletedSellingPlanIds).toEqual([grp.sellingPlans.nodes[1].id]);
    expect(u.sellingPlanGroup).toMatchObject({ name: 'Tea lovers', sellingPlans: { nodes: [{ id: monthly.id, name: 'Every month', billingPolicy: { interval: 'MONTH', intervalCount: 1, maxCycles: 6 } }] } });

    const variant = gid('ProductVariant', sku['HEB-250']!);
    const av = (await g(`mutation($id: ID!, $v: [ID!]!) { sellingPlanGroupAddProductVariants(id: $id, productVariantIds: $v) { sellingPlanGroup { productVariantsCount { count } appliesToProductVariant(productVariantId: "${variant}") } userErrors { message } } }`, { id: created, v: [variant] })).sellingPlanGroupAddProductVariants;
    expect(av.sellingPlanGroup).toEqual({ productVariantsCount: { count: 1 }, appliesToProductVariant: true });
    const vgroups = (await g(`query($id: ID!) { productVariant(id: $id) { sellingPlanGroups(first: 5) { nodes { name } } } }`, { id: variant })).productVariant;
    expect(vgroups.sellingPlanGroups.nodes).toEqual([{ name: 'Tea lovers' }]);
    expect((await g(`mutation($id: ID!, $v: [ID!]!) { sellingPlanGroupRemoveProductVariants(id: $id, productVariantIds: $v) { removedProductVariantIds userErrors { message } } }`, { id: created, v: [variant] })).sellingPlanGroupRemoveProductVariants.removedProductVariantIds).toEqual([variant]);
    expect((await g(`mutation($id: ID!, $p: [ID!]!) { sellingPlanGroupRemoveProducts(id: $id, productIds: $p) { removedProductIds userErrors { message } } }`, { id: created, p: [gid('Product', tea)] })).sellingPlanGroupRemoveProducts.removedProductIds).toEqual([gid('Product', tea)]);
    expect((await g(`mutation($id: ID!, $p: [ID!]!) { sellingPlanGroupAddProducts(id: $id, productIds: $p) { sellingPlanGroup { appliesToProduct(productId: "${gid('Product', tea)}") } userErrors { message } } }`, { id: created, p: [gid('Product', tea)] })).sellingPlanGroupAddProducts.sellingPlanGroup.appliesToProduct).toBe(true);

    const list = (await g(`{ sellingPlanGroups(first: 10, query: "name:tea") { nodes { name } } }`)).sellingPlanGroups.nodes;
    expect(list).toEqual([{ name: 'Tea lovers' }]);
    expect((await g(`mutation($id: ID!) { sellingPlanGroupDelete(id: $id) { deletedSellingPlanGroupId userErrors { message } } }`, { id: created })).sellingPlanGroupDelete.deletedSellingPlanGroupId).toBe(created);
    expect((await g(`query($id: ID!) { sellingPlanGroup(id: $id) { id } }`, { id: created })).sellingPlanGroup).toBeNull();
  });

  it('returns user errors for invalid input', async () => {
    const r = (await g(`mutation($input: SellingPlanGroupInput!) { sellingPlanGroupCreate(input: $input) { sellingPlanGroup { id } userErrors { field message code } } }`, {
      input: { name: '', sellingPlansToCreate: [] },
    })).sellingPlanGroupCreate;
    expect(r.userErrors[0]).toMatchObject({ field: ['input', 'name'], code: 'BLANK' });
    const r2 = (await g(`mutation($input: SellingPlanGroupInput!) { sellingPlanGroupCreate(input: $input) { sellingPlanGroup { id } userErrors { field code } } }`, {
      input: { name: 'X', sellingPlansToCreate: [{ name: 'Y', billingPolicy: { recurring: { interval: 'WEEK', intervalCount: 0 } }, deliveryPolicy: { recurring: { interval: 'WEEK', intervalCount: 1 } } }] },
    })).sellingPlanGroupCreate;
    expect(r2.userErrors[0]).toMatchObject({ field: ['input', 'sellingPlansToCreate', '0', 'billingPolicy', 'recurring', 'intervalCount'], code: 'BILLING_POLICY_INTERVAL_TOO_LARGE' });
    const r3 = (await g(`mutation { sellingPlanGroupAddProducts(id: "gid://shopify/SellingPlanGroup/999999", productIds: ["gid://shopify/Product/1"]) { userErrors { code } } }`)).sellingPlanGroupAddProducts;
    expect(r3.userErrors[0].code).toBe('GROUP_DOES_NOT_EXIST');
  });
});

describe('cart and storefront with a purchase option', () => {
  it('adds and changes lines with selling_plan and returns selling_plan_allocation', async () => {
    const add = await t.app.inject({ method: 'POST', url: '/cart/add.js', payload: { id: sku['HMC-250-WB'], quantity: 2, selling_plan: planIds[0] } });
    expect(add.statusCode, add.body).toBe(200);
    const line = add.json();
    expect(line).toMatchObject({ variant_id: sku['HMC-250-WB'], price: 1305, original_price: 1305, line_price: 2610 });
    expect(line.selling_plan_allocation).toMatchObject({
      price: 1305, compare_at_price: 1450, per_delivery_price: 1305, price_adjustments: [{ position: 1, price: 1305 }], selling_plan_group_id: String(groupId),
      selling_plan: { id: planIds[0], name: 'Delivery every 2 weeks, save 10%', options: [{ name: 'Delivery every', position: 1, value: '2 weeks' }], recurring_deliveries: true, price_adjustments: [{ position: 1, order_count: null, value_type: 'percentage', value: 10 }] },
    });
    const cart = add.cookies.find((c) => c.name === 'cart')!.value;
    const oneTime = await t.app.inject({ method: 'POST', url: '/cart/add.js', payload: { id: sku['HMC-250-WB'], quantity: 1 }, cookies: { cart } });
    expect(oneTime.json().selling_plan_allocation).toBeNull();
    expect(oneTime.json().key).not.toBe(line.key);

    const full = (await t.app.inject({ url: '/cart.js', cookies: { cart } })).json();
    expect(full.items).toHaveLength(2);
    expect(full.total_price).toBe(2610 + 1450);

    const change = await t.app.inject({ method: 'POST', url: '/cart/change.js', payload: { id: line.key, quantity: 2, selling_plan: planIds[1] }, cookies: { cart } });
    expect(change.statusCode, change.body).toBe(200);
    const switched = change.json().items.find((i: { selling_plan_allocation: unknown }) => i.selling_plan_allocation);
    expect(switched.selling_plan_allocation.selling_plan.id).toBe(planIds[1]);

    const bad = await t.app.inject({ method: 'POST', url: '/cart/add.js', payload: { id: sku['HEB-250'], quantity: 1, selling_plan: planIds[0] }, cookies: { cart } });
    expect(bad.statusCode).toBe(422);
    expect(bad.json().description).toBe('Cannot find selling plan');

    const page = await t.app.inject({ url: '/cart', cookies: { cart } });
    expect(page.body).toContain('Delivery every 4 weeks, save 10%');
    expect(page.body).toContain('Subscription: €13.05 per delivery');
  });

  it('renders the purchase options of the product page from the Liquid objects', async () => {
    const page = await t.app.inject({ url: '/products/highland-morning-coffee-beans' });
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain('data-purchase-options');
    expect(page.body).toContain('One-time purchase');
    expect(page.body).toContain('Subscribe and save');
    expect(page.body).toContain('€13.05 per delivery');
    expect(page.body).toContain('Save 10%');
    expect(page.body).toMatch(/name="selling_plan" value=""/);
    const json = JSON.parse(/<script type="application\/json" data-product-json>([\s\S]*?)<\/script>/.exec(page.body)![1]!);
    expect(json.requires_selling_plan).toBe(false);
    expect(json.selling_plan_groups[0]).toMatchObject({ name: 'Subscribe and save', selling_plan_selected: false, options: [{ name: 'Delivery every', position: 1, values: ['2 weeks', '4 weeks'] }] });
    expect(json.variants[0].selling_plan_allocations).toHaveLength(2);
    expect(json.variants[0].selling_plan_allocations[1]).toMatchObject({ price: 1305, compare_at_price: 1450, selling_plan: { id: planIds[1] } });

    const chosen = await t.app.inject({ url: `/products/highland-morning-coffee-beans?selling_plan=${planIds[1]}` });
    expect(chosen.body).toMatch(new RegExp(`name="selling_plan" value="${planIds[1]}"`));
    const json2 = JSON.parse(/<script type="application\/json" data-product-json>([\s\S]*?)<\/script>/.exec(chosen.body)![1]!);
    expect(json2.selected_selling_plan).toMatchObject({ id: planIds[1], selected: true });
    expect(json2.selected_or_first_available_selling_plan_allocation.selling_plan.id).toBe(planIds[1]);

    await db().update(s.products).set({ requiresSellingPlan: true }).where(eq(s.products.id, coffeeId));
    const required = await t.app.inject({ url: '/products/highland-morning-coffee-beans' });
    expect(required.body).not.toContain('One-time purchase');
    expect(required.body).toContain('only sold as a subscription');
    expect(required.body).toMatch(new RegExp(`name="selling_plan" value="${planIds[0]}"`));
    const refused = await t.app.inject({ method: 'POST', url: '/cart/add.js', payload: { id: sku['HMC-250-WB'], quantity: 1 } });
    expect(refused.statusCode).toBe(422);
    await db().update(s.products).set({ requiresSellingPlan: false }).where(eq(s.products.id, coffeeId));
  });
});

describe('subscription checkout, renewals and actions', () => {
  let customerCookie: string;
  let contractId: number;

  it('creates a contract when a subscription line is checked out with bank transfer', async () => {
    const reg = await t.app.inject({ method: 'POST', url: '/account/register', payload: new URLSearchParams({ 'customer[email]': 'subscriber@example.com', 'customer[password]': 'correct horse', 'customer[first_name]': 'Ada' }).toString(), headers: { 'content-type': 'application/x-www-form-urlencoded' } });
    customerCookie = reg.cookies.find((c) => c.name === 'shopme_customer')!.value;
    sent.length = 0;
    const cart = await cartWith([{ id: sku['HMC-250-WB'], quantity: 1, selling_plan: planIds[0] }, { id: sku['JPG-50'], quantity: 1 }]);
    const page = await t.app.inject({ url: `/checkouts/${(await t.app.inject({ method: 'POST', url: '/checkout', cookies: { cart } })).headers.location!.toString().split('/').pop()}` });
    expect(page.body).toContain('Delivery every 2 weeks, save 10%');
    expect(page.body).toContain('Then €13.05 every 2 weeks');
    const { token, res } = await checkout(cart, 'subscriber@example.com', 'bank_transfer');
    expect(res.json()).toMatchObject({ ok: true });
    const [order] = await db().select().from(s.orders).where(eq(s.orders.cartToken, token));
    const lines = await db().select().from(s.orderLines).where(eq(s.orderLines.orderId, order!.id));
    const subLine = lines.find((l) => l.sellingPlanId)!;
    expect(subLine).toMatchObject({ sellingPlanName: 'Delivery every 2 weeks, save 10%', unitPrice: 1305 });
    expect(lines.find((l) => !l.sellingPlanId)!.subscriptionContractId).toBeNull();

    const c = await contractOfOrder(order!.id);
    contractId = c.id;
    expect(subLine.subscriptionContractId).toBe(c.id);
    expect(c).toMatchObject({ status: 'ACTIVE', currency: 'EUR', paymentGateway: 'bank_transfer', cyclesCompleted: 1, deliveryPrice: 490, deliveryMethod: { title: 'Standard' }, customerId: order!.customerId });
    expect(Math.round((c.nextBillingDate.getTime() - order!.createdAt.getTime()) / DAY)).toBe(14);
    const [cl] = await db().select().from(s.subscriptionContractLines).where(eq(s.subscriptionContractLines.contractId, c.id));
    expect(cl).toMatchObject({ quantity: 1, basePrice: 1450, currentPrice: 1305, sellingPlanId: planIds[0], variantId: sku['HMC-250-WB'] });

    await t.app.ctx.queue.idle();
    const confirmation = sent.find((m) => m.subject.includes('is confirmed') && m.subject.includes('subscription'));
    expect(confirmation?.to).toBe('subscriber@example.com');
    expect(confirmation!.html).toContain('Delivery every 2 weeks, save 10%');
    expect(sent.find((m) => m.subject.startsWith('Order'))?.html).toContain('(Delivery every 2 weeks, save 10%)');

    const thanks = await t.app.inject({ url: `/checkouts/${token}/thank-you` });
    expect(thanks.body).toContain('Your subscription has started');
  });

  it('exposes the contract in the Admin API (list, detail, customer, order lines)', async () => {
    const list = (await g(`{ subscriptionContracts(first: 10, reverse: true, query: "status:active") { nodes { id status } } }`)).subscriptionContracts.nodes;
    expect(list.map((n: { id: string }) => n.id)).toContain(gid('SubscriptionContract', contractId));
    const c = (await g(`query($id: ID!) { subscriptionContract(id: $id) {
      id status currencyCode nextBillingDate lastPaymentStatus shopmePaymentGateway shopmeCyclesCompleted
      billingPolicy { interval intervalCount } deliveryPolicy { interval intervalCount } deliveryPrice { amount }
      deliveryMethod { ... on SubscriptionDeliveryMethodShipping { address { city countryCode } shippingOption { title } } }
      customer { email } originOrder { name } orders(first: 5) { nodes { name } }
      lines(first: 5) { nodes { title quantity sellingPlanName currentPrice { amount } pricingPolicy { basePrice { amount } cycleDiscounts { adjustmentType afterCycle computedPrice { amount } } } } }
      shopmeEvents(first: 10) { nodes { action message } } shopmeNextOrderTotal { amount } } }`, { id: gid('SubscriptionContract', contractId) })).subscriptionContract;
    expect(c).toMatchObject({
      status: 'ACTIVE', currencyCode: 'EUR', lastPaymentStatus: null, shopmePaymentGateway: 'bank_transfer', shopmeCyclesCompleted: 1,
      billingPolicy: { interval: 'WEEK', intervalCount: 2 }, deliveryPolicy: { interval: 'WEEK', intervalCount: 2 }, deliveryPrice: { amount: '4.9' },
      deliveryMethod: { address: { city: 'Paris', countryCode: 'FR' }, shippingOption: { title: 'Standard' } }, customer: { email: 'subscriber@example.com' },
      lines: { nodes: [{ title: 'Highland Morning Coffee Beans', quantity: 1, sellingPlanName: 'Delivery every 2 weeks, save 10%', currentPrice: { amount: '13.05' }, pricingPolicy: { basePrice: { amount: '14.5' }, cycleDiscounts: [{ adjustmentType: 'PERCENTAGE', afterCycle: 0, computedPrice: { amount: '13.05' } }] } }] },
      // 13.05 + 4.90 shipping, VAT 20% on both
      shopmeNextOrderTotal: { amount: '21.54' },
    });
    expect(c.orders.nodes).toHaveLength(1);
    expect(c.shopmeEvents.nodes[0]).toMatchObject({ action: 'subscription_contracts/create' });
    const customer = (await g(`query($id: ID!) { customer(id: $id) { subscriptionContracts(first: 5) { nodes { id } } } }`, { id: gid('Customer', (await db().select().from(s.subscriptionContracts).where(eq(s.subscriptionContracts.id, contractId)))[0]!.customerId!) })).customer;
    expect(customer.subscriptionContracts.nodes).toEqual([{ id: gid('SubscriptionContract', contractId) }]);
    const order = (await g(`query($id: ID!) { order(id: $id) { shopmeSubscriptionContracts { id } lineItems(first: 5) { nodes { title sellingPlan { name sellingPlanId } contract { id } } } } }`, { id: c.originOrder ? gid('Order', (await contractOfOrderById(contractId)).originOrderId!) : '' })).order;
    expect(order.shopmeSubscriptionContracts).toEqual([{ id: gid('SubscriptionContract', contractId) }]);
    const sub = order.lineItems.nodes.find((l: { sellingPlan: unknown }) => l.sellingPlan);
    expect(sub).toMatchObject({ sellingPlan: { name: 'Delivery every 2 weeks, save 10%', sellingPlanId: gid('SellingPlan', planIds[0]!) }, contract: { id: gid('SubscriptionContract', contractId) } });
  });

  it('sends the upcoming renewal reminder once', async () => {
    const c = await contractOfOrderById(contractId);
    sent.length = 0;
    expect(await sendRenewalReminders(t.app, new Date(c.nextBillingDate.getTime() - 2 * DAY))).toBe(1);
    expect(await sendRenewalReminders(t.app, new Date(c.nextBillingDate.getTime() - 1 * DAY))).toBe(0);
    expect(sent[0]).toMatchObject({ to: 'subscriber@example.com' });
    expect(sent[0]!.subject).toMatch(/coming up/);
  });

  it('bills a renewal with a manual method: a pending order is created and the customer is emailed', async () => {
    const before = await contractOfOrderById(contractId);
    sent.length = 0;
    const out = await runDueBilling(t.app, new Date(before.nextBillingDate.getTime() + 60_000));
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ status: 'ordered', paid: false });
    const orderId = (out[0] as { orderId: number }).orderId;
    const [order] = await db().select().from(s.orders).where(eq(s.orders.id, orderId));
    expect(order).toMatchObject({ financialStatus: 'PENDING', subscriptionContractId: contractId, sourceName: 'subscription_contract', email: 'subscriber@example.com', totalShipping: 490, total: 2154 });
    const [line] = await db().select().from(s.orderLines).where(eq(s.orderLines.orderId, orderId));
    expect(line).toMatchObject({ sellingPlanName: 'Delivery every 2 weeks, save 10%', subscriptionContractId: contractId, unitPrice: 1305 });
    const [tx] = await db().select().from(s.transactions).where(eq(s.transactions.orderId, orderId));
    expect(tx).toMatchObject({ gateway: 'bank_transfer', status: 'PENDING' });
    const after = await contractOfOrderById(contractId);
    expect(after).toMatchObject({ cyclesCompleted: 2, lastPaymentStatus: 'SUCCEEDED', failedAttempts: 0 });
    expect(after.nextBillingDate.getTime() - before.nextBillingDate.getTime()).toBe(14 * DAY);
    const [attempt] = await db().select().from(s.subscriptionBillingAttempts).where(eq(s.subscriptionBillingAttempts.contractId, contractId));
    expect(attempt).toMatchObject({ status: 'SUCCEEDED', orderId, cycleIndex: 2 });
    expect(await runDueBilling(t.app, new Date(before.nextBillingDate.getTime() + 120_000))).toEqual([]);
    await t.app.ctx.queue.idle();
    const mail = sent.find((m) => m.to === 'subscriber@example.com' && m.subject.includes(order!.name));
    expect(mail?.html).toContain('Awaiting payment');
  });

  it('skips the next order, pauses, resumes and cancels (admin and customer account)', async () => {
    const c0 = await contractOfOrderById(contractId);
    const skip = (await g(`mutation($i: SubscriptionBillingCycleInput!) { subscriptionBillingCycleSkip(billingCycleInput: $i) { billingCycle { cycleIndex skipped billingAttemptExpectedDate } userErrors { field message code } } }`, {
      i: { contractId: gid('SubscriptionContract', contractId), selector: { index: c0.cyclesCompleted + 1 } },
    })).subscriptionBillingCycleSkip;
    expect(skip.userErrors).toEqual([]);
    expect(skip.billingCycle).toMatchObject({ cycleIndex: 3, skipped: true });
    const c1 = await contractOfOrderById(contractId);
    expect(c1.nextBillingDate.getTime() - c0.nextBillingDate.getTime()).toBe(14 * DAY);
    const wrong = (await g(`mutation($i: SubscriptionBillingCycleInput!) { subscriptionBillingCycleSkip(billingCycleInput: $i) { userErrors { code } } }`, { i: { contractId: gid('SubscriptionContract', contractId), selector: { index: 9 } } })).subscriptionBillingCycleSkip;
    expect(wrong.userErrors[0].code).toBe('CYCLE_INDEX_OUT_OF_RANGE');

    const pause = (await g(`mutation($id: ID!) { subscriptionContractPause(subscriptionContractId: $id) { contract { status } userErrors { message code } } }`, { id: gid('SubscriptionContract', contractId) })).subscriptionContractPause;
    expect(pause).toEqual({ contract: { status: 'PAUSED' }, userErrors: [] });
    expect((await g(`mutation($id: ID!) { subscriptionContractPause(subscriptionContractId: $id) { contract { status } userErrors { code } } }`, { id: gid('SubscriptionContract', contractId) })).subscriptionContractPause.userErrors[0].code).toBe('INVALID');
    expect(await runDueBilling(t.app, new Date(c1.nextBillingDate.getTime() + 60 * DAY))).toEqual([]);
    const resumed = (await g(`mutation($id: ID!) { subscriptionContractActivate(subscriptionContractId: $id) { contract { status nextBillingDate } userErrors { message } } }`, { id: gid('SubscriptionContract', contractId) })).subscriptionContractActivate;
    expect(resumed.contract.status).toBe('ACTIVE');
    expect(new Date(resumed.contract.nextBillingDate).getTime()).toBeGreaterThan(Date.now());

    // The customer sees the subscription on the account page and acts on it from there.
    const account = await t.app.inject({ url: '/account', cookies: { shopme_customer: customerCookie } });
    expect(account.body).toContain('id="subscriptions"');
    expect(account.body).toContain('Skip next order');
    expect(account.body).toContain('Every 2 weeks');
    const other = await t.app.inject({ method: 'POST', url: `/account/subscriptions/${contractId}/pause` });
    expect(other.statusCode).toBe(303); // not signed in: back to the login page
    expect((await contractOfOrderById(contractId)).status).toBe('ACTIVE');
    const paused = await t.app.inject({ method: 'POST', url: `/account/subscriptions/${contractId}/pause`, cookies: { shopme_customer: customerCookie } });
    expect(paused.statusCode).toBe(303);
    expect((await contractOfOrderById(contractId)).status).toBe('PAUSED');
    await t.app.inject({ method: 'POST', url: `/account/subscriptions/${contractId}/resume`, cookies: { shopme_customer: customerCookie } });
    expect((await contractOfOrderById(contractId)).status).toBe('ACTIVE');
    sent.length = 0;
    await t.app.inject({ method: 'POST', url: `/account/subscriptions/${contractId}/cancel`, cookies: { shopme_customer: customerCookie } });
    const cancelled = await contractOfOrderById(contractId);
    expect(cancelled.status).toBe('CANCELLED');
    expect(cancelled.cancelledAt).not.toBeNull();
    await t.app.ctx.queue.idle();
    expect(sent.find((m) => m.subject.includes('was cancelled'))?.to).toBe('subscriber@example.com');
    const events = await db().select().from(s.events).where(and(eq(s.events.subjectType, 'subscription_contract'), eq(s.events.subjectId, contractId)));
    expect(events.map((e) => e.verb)).toEqual(expect.arrayContaining(['subscription_contracts/skipped', 'subscription_contracts/paused', 'subscription_contracts/activated', 'subscription_contracts/cancelled', 'subscription_contracts/billed']));
    const ended = (await g(`mutation($id: ID!) { subscriptionContractActivate(subscriptionContractId: $id) { userErrors { code } } }`, { id: gid('SubscriptionContract', contractId) })).subscriptionContractActivate;
    expect(ended.userErrors[0].code).toBe('CONTRACT_TERMINATED');
  });
});

async function contractOfOrderById(id: number) { return (await db().select().from(s.subscriptionContracts).where(eq(s.subscriptionContracts.id, id)))[0]!; }

describe('Stripe subscriptions: card saved at checkout, charged off-session at renewal', () => {
  it('saves the card, renews with an off-session charge, then retries a declined card and fails after 3 attempts', async () => {
    const created: Record<string, any>[] = [];
    const customers: Record<string, any>[] = [];
    let decline = false;
    t.app.checkoutPayments.stripe = createStripeGateway(STRIPE, {
      paymentIntents: {
        create: async (p: Record<string, any>) => {
          created.push(p);
          if (p.off_session && decline) throw Object.assign(new Error('Your card was declined.'), { code: 'card_declined', decline_code: 'insufficient_funds', raw: { payment_intent: { id: `pi_declined_${created.length}` } } });
          return p.off_session ? { id: `pi_renew_${created.length}`, client_secret: null, status: 'succeeded' } : { id: 'pi_sub_1', client_secret: 'pi_sub_1_secret' };
        },
      },
      customers: { create: async (p: Record<string, any>) => { customers.push(p); return { id: 'cus_sub_1' }; } },
      webhooks: new Stripe(STRIPE.secretKey).webhooks as never,
    });
    sent.length = 0;
    const cart = await cartWith([{ id: sku['HMC-250-FL'], quantity: 2, selling_plan: planIds[1] }]);
    const { token, res } = await checkout(cart, 'card.subscriber@example.com', 'stripe');
    expect(res.json()).toMatchObject({ ok: true, clientSecret: 'pi_sub_1_secret' });
    expect(customers[0]).toMatchObject({ email: 'card.subscriber@example.com' });
    expect(created[0]).toMatchObject({ setup_future_usage: 'off_session', customer: 'cus_sub_1' });
    expect(JSON.stringify(created[0])).not.toMatch(/card_number|cvc/);
    const [order] = await db().select().from(s.orders).where(eq(s.orders.cartToken, token));
    let c = await contractOfOrder(order!.id);
    expect(c).toMatchObject({ paymentGateway: 'stripe', stripeCustomerId: null, stripePaymentMethodId: null });
    await t.app.ctx.queue.idle();
    expect(sent.some((m) => m.subject.includes('subscription'))).toBe(false); // nothing before the payment is confirmed

    const payload = JSON.stringify({ id: 'evt_sub_1', object: 'event', type: 'payment_intent.succeeded', data: { object: { id: 'pi_sub_1', customer: 'cus_sub_1', payment_method: 'pm_card_1' } } });
    const header = new Stripe(STRIPE.secretKey).webhooks.generateTestHeaderString({ payload, secret: STRIPE.webhookSecret });
    expect((await t.app.inject({ method: 'POST', url: '/webhooks/stripe', payload, headers: { 'content-type': 'application/json', 'stripe-signature': header } })).statusCode).toBe(200);
    c = await contractOfOrder(order!.id);
    expect(c).toMatchObject({ stripeCustomerId: 'cus_sub_1', stripePaymentMethodId: 'pm_card_1' });
    await t.app.ctx.queue.idle();
    expect(sent.find((m) => m.subject.includes('subscription') && m.subject.includes('confirmed'))?.to).toBe('card.subscriber@example.com');

    // Renewal: 2 x 13.05 = 26.10, free shipping over 50 does not apply, standard 4.90; VAT 20%.
    const due = new Date(c.nextBillingDate.getTime() + 60_000);
    const out = await runDueBilling(t.app, due);
    expect(out).toEqual([expect.objectContaining({ status: 'ordered', paid: true })]);
    const renewal = created.at(-1)!;
    expect(renewal).toMatchObject({ off_session: true, confirm: true, customer: 'cus_sub_1', payment_method: 'pm_card_1', currency: 'eur', amount: 2610 + 490 + 522 + 98 });
    const orderId = (out[0] as { orderId: number }).orderId;
    expect((await db().select().from(s.orders).where(eq(s.orders.id, orderId)))[0]).toMatchObject({ financialStatus: 'PAID', total: 3720 });
    expect((await db().select().from(s.transactions).where(eq(s.transactions.orderId, orderId)))[0]).toMatchObject({ gateway: 'stripe', status: 'SUCCESS', paymentId: `pi_renew_${created.length}` });

    // Declined card: retried a day later, failed for good after the third attempt.
    decline = true;
    sent.length = 0;
    c = await contractOfOrder(order!.id);
    const next = c.nextBillingDate.getTime();
    const first = await runDueBilling(t.app, new Date(next + 60_000));
    expect(first).toEqual([expect.objectContaining({ status: 'failed', code: 'INSUFFICIENT_FUNDS', willRetry: true })]);
    c = await contractOfOrder(order!.id);
    expect(c).toMatchObject({ status: 'ACTIVE', failedAttempts: 1, lastPaymentStatus: 'FAILED', lastBillingErrorType: 'INSUFFICIENT_FUNDS' });
    expect(await runDueBilling(t.app, new Date(next + 3600_000))).toEqual([]); // waiting for the retry
    await t.app.ctx.queue.idle();
    const failedMail = sent.find((m) => m.subject.includes('Payment problem'));
    expect(failedMail?.html).toContain('We will try again');
    expect((await runDueBilling(t.app, new Date(next + DAY + 120_000)))[0]).toMatchObject({ status: 'failed', willRetry: true });
    expect((await runDueBilling(t.app, new Date(next + 2 * DAY + 240_000)))[0]).toMatchObject({ status: 'failed', willRetry: false });
    c = await contractOfOrder(order!.id);
    expect(c).toMatchObject({ status: 'FAILED', failedAttempts: 3 });
    expect((await db().select().from(s.subscriptionBillingAttempts).where(eq(s.subscriptionBillingAttempts.contractId, c.id))).filter((a) => a.status === 'FAILED')).toHaveLength(3);
    // Reactivating clears the failures; "bill now" from the Admin API uses the caller's idempotency key.
    decline = false;
    const act = (await g(`mutation($id: ID!) { subscriptionContractActivate(subscriptionContractId: $id) { contract { status shopmeFailedAttempts } userErrors { message } } }`, { id: gid('SubscriptionContract', c.id) })).subscriptionContractActivate;
    expect(act.contract).toEqual({ status: 'ACTIVE', shopmeFailedAttempts: 0 });
    const bill = (await g(`mutation($id: ID!, $i: SubscriptionBillingAttemptInput!) { subscriptionBillingAttemptCreate(subscriptionContractId: $id, subscriptionBillingAttemptInput: $i) { subscriptionBillingAttempt { idempotencyKey ready errorCode order { displayFinancialStatus } } userErrors { code } } }`, {
      id: gid('SubscriptionContract', c.id), i: { idempotencyKey: 'bill-now-1' },
    })).subscriptionBillingAttemptCreate;
    expect(bill).toMatchObject({ subscriptionBillingAttempt: { idempotencyKey: 'bill-now-1', ready: true, errorCode: null, order: { displayFinancialStatus: 'PAID' } }, userErrors: [] });
    const again = (await g(`mutation($id: ID!, $i: SubscriptionBillingAttemptInput!) { subscriptionBillingAttemptCreate(subscriptionContractId: $id, subscriptionBillingAttemptInput: $i) { userErrors { code } } }`, { id: gid('SubscriptionContract', c.id), i: { idempotencyKey: 'bill-now-1' } })).subscriptionBillingAttemptCreate;
    expect(again.userErrors[0].code).toBe('DUPLICATE');
  });
});

describe('minimum and maximum billing cycles, interrupted attempts', () => {
  it('keeps customers from cancelling before the minimum, ends after the last cycle and replays an interrupted attempt', async () => {
    const tea = (await db().select().from(s.products).where(eq(s.products.handle, 'jasmine-pearl-green-tea')))[0]!.id;
    const created = (await g(`mutation($input: SellingPlanGroupInput!, $resources: SellingPlanGroupResourceInput) { sellingPlanGroupCreate(input: $input, resources: $resources) { sellingPlanGroup { sellingPlans(first: 1) { nodes { id } } } userErrors { message } } }`, {
      input: { name: 'Tea trial', sellingPlansToCreate: [{ name: 'Two months', billingPolicy: { recurring: { interval: 'MONTH', intervalCount: 1, minCycles: 2, maxCycles: 2 } }, deliveryPolicy: { recurring: { interval: 'MONTH', intervalCount: 1 } } }] },
      resources: { productIds: [gid('Product', tea)] },
    })).sellingPlanGroupCreate;
    const planId = num(created.sellingPlanGroup.sellingPlans.nodes[0].id);
    const reg = await t.app.inject({ method: 'POST', url: '/account/register', payload: new URLSearchParams({ 'customer[email]': 'trial@example.com', 'customer[password]': 'correct horse' }).toString(), headers: { 'content-type': 'application/x-www-form-urlencoded' } });
    const cookie = reg.cookies.find((c) => c.name === 'shopme_customer')!.value;
    const cart = await cartWith([{ id: sku['JPG-50'], quantity: 1, selling_plan: planId }]);
    const { token } = await checkout(cart, 'trial@example.com', 'bank_transfer');
    const [order] = await db().select().from(s.orders).where(eq(s.orders.cartToken, token));
    let c = await contractOfOrder(order!.id);

    const account = await t.app.inject({ url: '/account', cookies: { shopme_customer: cookie } });
    expect(account.body).not.toContain(`/account/subscriptions/${c.id}/cancel`);
    await t.app.inject({ method: 'POST', url: `/account/subscriptions/${c.id}/cancel`, cookies: { shopme_customer: cookie } });
    expect((await contractOfOrder(order!.id)).status).toBe('ACTIVE');

    // A billing attempt left pending by a stopped process is replayed with the same key once it is stale.
    const due = new Date(c.nextBillingDate.getTime() + 60_000);
    await db().insert(s.subscriptionBillingAttempts).values({ shopId, contractId: c.id, idempotencyKey: 'cycle-2-attempt-1', status: 'PENDING', cycleIndex: 2, billingDate: c.nextBillingDate, createdAt: new Date(due.getTime() - 3600_000) });
    const out = await runDueBilling(t.app, due);
    expect(out).toEqual([expect.objectContaining({ status: 'ordered', paid: false })]);
    expect((await db().select().from(s.subscriptionBillingAttempts).where(eq(s.subscriptionBillingAttempts.contractId, c.id)))).toEqual([expect.objectContaining({ idempotencyKey: 'cycle-2-attempt-1', status: 'SUCCEEDED' })]);
    c = await contractOfOrder(order!.id);
    expect(c).toMatchObject({ status: 'EXPIRED', cyclesCompleted: 2 });
    expect((await runDueBilling(t.app, new Date(due.getTime() + 90 * DAY))).filter((o) => 'contract' in o && o.contract.id === c.id)).toEqual([]);
  });
});

describe('discount purchase type: subscriptions and the first N payments', () => {
  it('stores the purchase type and cycle limit, applies to subscription lines only and keeps it for the limited renewals', async () => {
    const r = (await g(`mutation($d: DiscountCodeBasicInput!) { discountCodeBasicCreate(basicCodeDiscount: $d) { codeDiscountNode { codeDiscount { ... on DiscountCodeBasic { recurringCycleLimit customerGets { appliesOnOneTimePurchase appliesOnSubscription } } } } userErrors { field message } } }`, {
      d: { title: 'SUB20', code: 'SUB20', startsAt: new Date(Date.now() - DAY).toISOString(), recurringCycleLimit: 2, customerGets: { value: { percentage: 0.2 }, items: { all: true }, appliesOnOneTimePurchase: false, appliesOnSubscription: true } },
    })).discountCodeBasicCreate;
    expect(r.userErrors).toEqual([]);
    expect(r.codeDiscountNode.codeDiscount).toEqual({ recurringCycleLimit: 2, customerGets: { appliesOnOneTimePurchase: false, appliesOnSubscription: true } });
    const nothing = (await g(`mutation($d: DiscountCodeBasicInput!) { discountCodeBasicCreate(basicCodeDiscount: $d) { userErrors { code } } }`, {
      d: { title: 'NONE', code: 'NONE1', customerGets: { value: { percentage: 0.1 }, items: { all: true }, appliesOnOneTimePurchase: false, appliesOnSubscription: false } },
    })).discountCodeBasicCreate;
    expect(nothing.userErrors[0].code).toBe('APPLIES_ON_NOTHING');

    // One-time line only: the subscription code does not apply; the default (one-time) welcome code skips subscription lines.
    const oneTimeCart = await cartWith([{ id: sku['JPG-50'], quantity: 1 }]);
    const go = await t.app.inject({ method: 'POST', url: '/checkout', cookies: { cart: oneTimeCart } });
    const tok = go.headers.location!.toString().split('/').pop()!;
    expect((await t.app.inject({ method: 'POST', url: `/checkouts/${tok}/refresh`, payload: { ...ADDRESS, email: 'x@example.com', addDiscountCode: 'SUB20' } })).json().discountError).toMatch(/does not apply/);

    const cart = await cartWith([{ id: sku['HMC-250-WB'], quantity: 1, selling_plan: planIds[0] }, { id: sku['JPG-50'], quantity: 1 }]);
    const { token, res } = await checkout(cart, 'coupon.subscriber@example.com', 'cod', { addDiscountCode: 'SUB20' });
    expect(res.json()).toMatchObject({ ok: true });
    const [order] = await db().select().from(s.orders).where(eq(s.orders.cartToken, token));
    const lines = await db().select().from(s.orderLines).where(eq(s.orderLines.orderId, order!.id));
    expect(lines.find((l) => l.sellingPlanId)!.discountedTotal).toBe(1305 - 261);
    expect(lines.find((l) => !l.sellingPlanId)!.discountedTotal).toBe(lines.find((l) => !l.sellingPlanId)!.unitPrice);
    let c = await contractOfOrder(order!.id);
    expect(c.discounts).toEqual([expect.objectContaining({ title: 'SUB20', code: 'SUB20', valueType: 'PERCENTAGE', value: 2000, remainingCycles: 1 })]);

    // Second payment: still 20% off; third payment: full plan price.
    const second = await runDueBilling(t.app, new Date(c.nextBillingDate.getTime() + 60_000));
    const secondLine = (await db().select().from(s.orderLines).where(eq(s.orderLines.orderId, (second[0] as { orderId: number }).orderId)))[0]!;
    expect(secondLine.discountedTotal).toBe(1305 - 261);
    c = await contractOfOrder(order!.id);
    expect(c.discounts).toEqual([]);
    const third = await runDueBilling(t.app, new Date(c.nextBillingDate.getTime() + 60_000));
    const thirdLine = (await db().select().from(s.orderLines).where(eq(s.orderLines.orderId, (third[0] as { orderId: number }).orderId)))[0]!;
    expect(thirdLine.discountedTotal).toBe(1305);
    expect((await db().select().from(s.discounts).where(eq(s.discounts.title, 'SUB20')))[0]!.usageCount).toBe(1); // renewals are not new uses
  });
});

describe('billing after a reactivation', () => {
  it('bills a reactivated contract whose earlier attempt of the cycle failed (the attempt key is not reused)', async () => {
    const cart = await cartWith([{ id: sku['HMC-250-FL'], quantity: 1, selling_plan: planIds[1] }]);
    const { token } = await checkout(cart, 'reactivated@example.com', 'bank_transfer');
    const [order] = await db().select().from(s.orders).where(eq(s.orders.cartToken, token));
    const c = await contractOfOrder(order!.id);
    // One failed attempt on record, then pause and resume reset `failedAttempts` to 0.
    await db().insert(s.subscriptionBillingAttempts).values({ shopId, contractId: c.id, idempotencyKey: `cycle-${c.cyclesCompleted + 1}-attempt-1`, status: 'FAILED', cycleIndex: c.cyclesCompleted + 1, billingDate: c.nextBillingDate });
    const out = await runDueBilling(t.app, new Date(c.nextBillingDate.getTime() + 60_000));
    expect(out.filter((o) => 'contract' in o && o.contract.id === c.id)).toEqual([expect.objectContaining({ status: 'ordered' })]);
  });
});
