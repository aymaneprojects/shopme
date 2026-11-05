import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { createLocalStorage, schema as s, seedDemo } from '@shopme/core';
import { createTestApp, setupAndLogin, type TestApp } from '../test-utils';

const ADDRESS = { email: 'buyer@example.com', firstName: 'Ada', lastName: 'Lovelace', address1: '1 Rue de Rivoli', city: 'Paris', zip: '75001', countryCode: 'FR', phone: '' };

let t: TestApp;
let owner: string;
let variantId: number;

async function gql(query: string, variables: Record<string, unknown> = {}) {
  const res = await t.app.inject({ method: 'POST', url: '/admin/api/2026-10/graphql.json', cookies: { shopme_session: owner }, payload: { query, variables } });
  return res.json() as { data?: any; errors?: unknown };
}

beforeAll(async () => {
  t = await createTestApp();
  owner = await setupAndLogin(t.app);
  await seedDemo(t.dbHandle.db, createLocalStorage(mkdtempSync(path.join(tmpdir(), 'draftpay-'))));
  variantId = (await t.dbHandle.db.select().from(s.productVariants).where(eq(s.productVariants.sku, 'HEB-250')))[0]!.id;
}, 90_000);
afterAll(async () => { await t.close(); });

describe('draft order pay link', () => {
  it('completes the draft and links the order when the pay link is checked out', async () => {
    const created = await gql(`mutation($v: ID!) { draftOrderCreate(input: {
      email: "buyer@example.com",
      lineItems: [{ variantId: $v, quantity: 1 }],
      shippingAddress: { firstName: "Ada", lastName: "Lovelace", address1: "1 Rue de Rivoli", city: "Paris", zip: "75001", countryCode: FR }
    }) { draftOrder { id invoiceUrl } userErrors { message } } }`, { v: `gid://shopify/ProductVariant/${variantId}` });
    expect(created.data.draftOrderCreate.userErrors).toEqual([]);
    const { id, invoiceUrl } = created.data.draftOrderCreate.draftOrder;
    const token = /\/draft_orders\/([^/]+)\/pay$/.exec(invoiceUrl)![1]!;
    const draftRowId = Number(id.split('/').pop());

    const pay = await t.app.inject({ method: 'GET', url: `/draft_orders/${token}/pay` });
    expect(pay.statusCode).toBe(303);
    const checkoutToken = pay.headers.location!.toString().split('/').pop()!;
    // the draft stays open until the buyer actually places the order
    expect((await t.dbHandle.db.select().from(s.draftOrders).where(eq(s.draftOrders.id, draftRowId)))[0]!.status).not.toBe('COMPLETED');

    const form = new URLSearchParams({ ...ADDRESS, paymentMethod: 'bank_transfer' }).toString();
    const done = await t.app.inject({ method: 'POST', url: `/checkouts/${checkoutToken}/complete`, payload: form, headers: { 'content-type': 'application/x-www-form-urlencoded' } });
    expect(done.statusCode).toBe(303);

    const [draft] = await t.dbHandle.db.select().from(s.draftOrders).where(eq(s.draftOrders.id, draftRowId));
    expect(draft!.status).toBe('COMPLETED');
    expect(draft!.orderId).not.toBeNull();
    const [order] = await t.dbHandle.db.select().from(s.orders).where(eq(s.orders.id, draft!.orderId!));
    expect(order).toBeDefined();
    expect(order!.email).toBe('buyer@example.com');

    // a second visit to the pay link no longer offers checkout
    const again = await t.app.inject({ method: 'GET', url: `/draft_orders/${token}/pay` });
    expect(again.statusCode).toBe(200);
    expect(again.body).toMatch(/already been completed|déjà finalisée/);
  });
});
