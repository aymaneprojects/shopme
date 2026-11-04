import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Stripe from 'stripe';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createLocalStorage, getPrimaryShop, schema as s, seedDemo, type Mail } from '@shopme/core';
import { createStripeGateway } from '@shopme/payments';
import { eq } from 'drizzle-orm';
import { createTestApp, SETUP_BODY, type TestApp } from '../test-utils';

const STRIPE = { secretKey: 'sk_test_x', publishableKey: 'pk_test_x', webhookSecret: 'whsec_test' };
const ADDRESS = { email: 'Buyer@Example.com', firstName: 'Ada', lastName: 'Lovelace', address1: '1 Rue de Rivoli', city: 'Paris', zip: '75001', countryCode: 'FR', phone: '' };

let t: TestApp;
let sent: Mail[];
const sku: Record<string, number> = {};

async function boot() {
  t = await createTestApp({ STRIPE_SECRET_KEY: STRIPE.secretKey, STRIPE_PUBLISHABLE_KEY: STRIPE.publishableKey, STRIPE_WEBHOOK_SECRET: STRIPE.webhookSecret });
  await t.app.inject({ method: 'POST', url: '/admin/api/setup', payload: SETUP_BODY });
  await seedDemo(t.dbHandle.db, createLocalStorage(mkdtempSync(path.join(tmpdir(), 'co-'))));
  for (const v of await t.dbHandle.db.select().from(s.productVariants)) if (v.sku) sku[v.sku] = v.id;
  sent = [];
  t.app.ctx.mailer = { send: async (m) => { sent.push(m); } };
}

/** Add to cart and start checkout; returns the cart cookie and checkout token. */
async function startCheckout(variant: string, quantity: number) {
  const add = await t.app.inject({ method: 'POST', url: '/cart/add.js', payload: { id: sku[variant], quantity } });
  expect(add.statusCode).toBe(200);
  const cart = add.cookies.find((c) => c.name === 'cart')!.value;
  const go = await t.app.inject({ method: 'POST', url: '/checkout', cookies: { cart } });
  expect(go.statusCode).toBe(303);
  const token = go.headers.location!.toString().split('/').pop()!;
  return { cart, token };
}

const refresh = (token: string, body: Record<string, unknown>) => t.app.inject({ method: 'POST', url: `/checkouts/${token}/refresh`, payload: body });
const stock = async (v: string) => (await t.dbHandle.db.select().from(s.inventoryLevels).innerJoin(s.inventoryItems, eq(s.inventoryItems.id, s.inventoryLevels.inventoryItemId)).where(eq(s.inventoryItems.variantId, sku[v]!)))[0]!.inventory_levels;

beforeAll(boot, 90_000);
afterAll(async () => { await t.close(); });

describe('checkout with bank transfer', () => {
  it('empty cart goes home; page renders; prices live', async () => {
    expect((await t.app.inject({ method: 'POST', url: '/checkout' })).headers.location).toBe('/cart');
    const { token } = await startCheckout('HEB-250', 2);
    const page = await t.app.inject(`/checkouts/${token}`);
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain('House Espresso Blend');
    expect(page.body).toContain('Bank transfer');
    expect(page.body).toContain('Cash on delivery');
    expect(page.body).toContain('Credit card'); // Stripe is configured

    const r = (await refresh(token, { ...ADDRESS, addDiscountCode: 'welcome10' })).json();
    expect(r.discountError).toBe('');
    // 2 x 13.00, 10% off, flat 4.90 shipping, 20% VAT on goods and shipping
    expect(r.amount).toBe(2600 - 260 + 490 + 468 + 98);
    expect(r.shipping).toContain('Standard');
    expect((await refresh(token, { ...ADDRESS, addDiscountCode: 'NOPE' })).json().discountError).toMatch(/does not exist/);
  });

  it('places the order, decrements stock, links the customer, uses the discount and queues emails', async () => {
    const before = (await stock('JPG-50')).available;
    const { token } = await startCheckout('JPG-50', 1);
    await refresh(token, { ...ADDRESS, addDiscountCode: 'WELCOME10' });

    // incomplete submissions are rejected with messages and no order
    const bad = await t.app.inject({ method: 'POST', url: `/checkouts/${token}/complete`, payload: { email: 'x', paymentMethod: 'bank_transfer' }, headers: { 'content-type': 'application/json' } });
    expect(bad.statusCode).toBe(422);

    const form = new URLSearchParams({ ...ADDRESS, paymentMethod: 'bank_transfer', acceptsMarketing: '1' }).toString();
    const done = await t.app.inject({ method: 'POST', url: `/checkouts/${token}/complete`, payload: form, headers: { 'content-type': 'application/x-www-form-urlencoded' } });
    expect(done.statusCode).toBe(303);
    expect(done.headers.location).toBe(`/checkouts/${token}/thank-you`);

    const db = t.dbHandle.db;
    const [order] = await db.select().from(s.orders).where(eq(s.orders.cartToken, token));
    // 11.00 - 1.10 + 4.90 shipping = 14.80 net, VAT 20% => 1.98 + 0.98 (on 9.90 goods and 4.90 shipping)
    expect(order).toMatchObject({ name: '#1001', financialStatus: 'PENDING', fulfillmentStatus: 'UNFULFILLED', subtotal: 1100, totalDiscounts: 110, totalShipping: 490, totalTax: 198 + 98, total: 1100 - 110 + 490 + 198 + 98, email: 'buyer@example.com' });
    expect((await stock('JPG-50')).available).toBe(before - 1);
    const [cust] = await db.select().from(s.customers).where(eq(s.customers.email, 'buyer@example.com'));
    expect(cust).toMatchObject({ numberOfOrders: 1, acceptsMarketing: true });
    expect(order!.customerId).toBe(cust!.id);
    expect((await db.select().from(s.orderAddresses).where(eq(s.orderAddresses.orderId, order!.id))).map((a) => a.kind).sort()).toEqual(['billing', 'shipping']);
    expect((await db.select().from(s.transactions).where(eq(s.transactions.orderId, order!.id)))[0]).toMatchObject({ gateway: 'bank_transfer', status: 'PENDING', amount: order!.total });
    expect((await db.select().from(s.discounts).where(eq(s.discounts.title, 'Welcome 10%')))[0]!.usageCount).toBe(1);
    expect((await db.select().from(s.events).where(eq(s.events.subjectId, order!.id))).map((e) => e.verb)).toContain('order.created');

    await t.app.ctx.queue.idle();
    expect(sent.map((m) => m.to).sort()).toEqual(['buyer@example.com', 'owner@example.com']);
    expect(sent[0]!.subject + sent[1]!.subject).toContain('#1001');

    const ty = await t.app.inject(`/checkouts/${token}/thank-you`);
    expect(ty.statusCode).toBe(200);
    expect(ty.body).toContain('#1001');
    // the checkout cannot be completed twice
    const again = await t.app.inject({ method: 'POST', url: `/checkouts/${token}/complete`, payload: form, headers: { 'content-type': 'application/x-www-form-urlencoded' } });
    expect(again.statusCode).toBe(303);
    expect(await db.select().from(s.orders)).toHaveLength(1);
  });

  it('refuses to oversell at submit', async () => {
    const { token } = await startCheckout('CPD-SL', 2);
    await refresh(token, ADDRESS);
    await t.dbHandle.db.update(s.inventoryLevels).set({ available: 1 }).where(eq(s.inventoryLevels.inventoryItemId, (await t.dbHandle.db.select().from(s.inventoryItems).where(eq(s.inventoryItems.variantId, sku['CPD-SL']!)))[0]!.id));
    const res = await t.app.inject({ method: 'POST', url: `/checkouts/${token}/complete`, payload: { ...ADDRESS, paymentMethod: 'cod' }, headers: { 'content-type': 'application/json' } });
    expect(res.statusCode).toBe(422);
    expect(res.json().errors[0]).toMatch(/no longer available/);
  });
});

describe('checkout with Stripe', () => {
  it('creates a PaymentIntent server-side and marks the order paid from a signed webhook', async () => {
    const created: any[] = [];
    t.app.checkoutPayments.stripe = createStripeGateway(STRIPE, {
      paymentIntents: { create: async (p) => { created.push(p); return { id: 'pi_test_1', client_secret: 'pi_test_1_secret_x' }; } },
      webhooks: new Stripe(STRIPE.secretKey).webhooks as never,
    });
    sent.length = 0;
    const { token } = await startCheckout('SEG-75', 1);
    await refresh(token, ADDRESS);
    const res = await t.app.inject({ method: 'POST', url: `/checkouts/${token}/complete`, payload: { ...ADDRESS, paymentMethod: 'stripe' }, headers: { 'content-type': 'application/json' } });
    expect(res.json()).toMatchObject({ ok: true, clientSecret: 'pi_test_1_secret_x' });
    expect(created[0]).toMatchObject({ amount: 1250 + 490 + 250 + 98, currency: 'eur' });
    await t.app.ctx.queue.idle();
    expect(sent).toHaveLength(0); // no emails before the payment is confirmed

    const db = t.dbHandle.db;
    let [order] = await db.select().from(s.orders).where(eq(s.orders.cartToken, token));
    expect(order!.financialStatus).toBe('PENDING');

    const payload = JSON.stringify({ id: 'evt_1', object: 'event', type: 'payment_intent.succeeded', data: { object: { id: 'pi_test_1' } } });
    const header = new Stripe(STRIPE.secretKey).webhooks.generateTestHeaderString({ payload, secret: STRIPE.webhookSecret });
    const post = (body: string, sig: string) => t.app.inject({ method: 'POST', url: '/webhooks/stripe', payload: body, headers: { 'content-type': 'application/json', 'stripe-signature': sig } });

    expect((await post(payload, 't=1,v1=deadbeef')).statusCode).toBe(400);
    expect((await post(payload + ' ', header)).statusCode).toBe(400);
    expect((await db.select().from(s.orders).where(eq(s.orders.id, order!.id)))[0]!.financialStatus).toBe('PENDING');

    expect((await post(payload, header)).statusCode).toBe(200);
    [order] = await db.select().from(s.orders).where(eq(s.orders.id, order!.id));
    expect(order!.financialStatus).toBe('PAID');
    expect((await db.select().from(s.transactions).where(eq(s.transactions.orderId, order!.id)))[0]).toMatchObject({ status: 'SUCCESS', paymentId: 'pi_test_1' });
    await t.app.ctx.queue.idle();
    expect(sent).toHaveLength(2);

    expect((await post(payload, header)).statusCode).toBe(200); // replay is harmless
    await t.app.ctx.queue.idle();
    expect(sent).toHaveLength(2);
  });
});

describe('seed', () => { it('shop exists', async () => { expect(await getPrimaryShop(t.dbHandle.db)).not.toBeNull(); }); });
