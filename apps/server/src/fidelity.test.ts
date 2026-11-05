import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createLocalStorage, seedDemo } from '@shopme/core';
import { makeGql, makeGqlOk } from '../test/conformance/helpers';
import { createTestApp, setupAndLogin, type TestApp } from './test-utils';

// Backend pieces added for the screen-by-screen review of the admin: rate details per market, separate SKU / barcode copy on duplicate,
// and the order fields the "create shipping labels" check reads.
let t: TestApp;
let g: ReturnType<typeof makeGqlOk>;

beforeAll(async () => {
  t = await createTestApp();
  const cookie = await setupAndLogin(t.app);
  g = makeGqlOk(makeGql(t.app, cookie));
  await seedDemo(t.dbHandle.db, createLocalStorage(mkdtempSync(path.join(tmpdir(), 'fid-'))));
}, 120_000);
afterAll(async () => { await t.close(); });

const num = (gid: string) => Number(gid.split('/').pop());

describe('shipping options per market', () => {
  it('lists each rate with its id, profile, free-over amount, transit time and origin locations', async () => {
    const d = await g(`{ shop { currencyCode } deliveryProfiles(first: 5) { nodes { id default profileLocationGroups { locationGroup { id locations(first: 5) { nodes { id } } }
      locationGroupZones(first: 5) { nodes { zone { id countries { code { countryCode } } } methodDefinitions(first: 5) { nodes { id name } } } } } } } }`);
    const profile = d.deliveryProfiles.nodes.find((p: { default: boolean }) => p.default);
    const group = profile.profileLocationGroups[0];
    const zone = group.locationGroupZones.nodes[0];
    const method = zone.methodDefinitions.nodes[0];
    const country = zone.zone.countries.map((c: { code: { countryCode: string } }) => c.code.countryCode).find((c: string) => c !== 'FR');
    const cur = d.shop.currencyCode;
    const up = await g(`mutation($id: ID!, $p: DeliveryProfileInput!) { deliveryProfileUpdate(id: $id, profile: $p) { userErrors { message } } }`, {
      id: profile.id, p: { locationGroupsToUpdate: [{ id: group.locationGroup.id, zonesToUpdate: [{ id: zone.zone.id, methodDefinitionsToUpdate: [{ id: method.id, shopmeTransitMinDays: 3, shopmeTransitMaxDays: 5, shopmeFreeOverAmount: { amount: '70.00', currencyCode: cur } }] }] }] },
    });
    expect(up.deliveryProfileUpdate.userErrors).toEqual([]);
    const m = await g(`mutation($i: MarketCreateInput!) { marketCreate(input: $i) { market { id } userErrors { message } } }`, { i: { name: 'Fidelity market', status: 'ACTIVE', conditions: { regionsCondition: { regions: [{ countryCode: country }] } } } });
    expect(m.marketCreate.userErrors).toEqual([]);
    const rows = (await g(`{ shopmeShippingByMarket }`)).shopmeShippingByMarket as Array<{ marketId: number; options: Array<Record<string, unknown>> }>;
    const mine = rows.find((r) => r.marketId === num(m.marketCreate.market.id))!;
    const option = mine.options.find((o) => o.methodId === num(method.id))!;
    expect(option).toMatchObject({ name: method.name, profileId: num(profile.id), transitMinDays: 3, transitMaxDays: 5, freeOverAmount: 7000, collectionIds: [] });
    expect(option.originLocationIds).toEqual(group.locationGroup.locations.nodes.map((l: { id: string }) => num(l.id)));
  });
});

describe('product duplicate', () => {
  it('copies barcodes and SKUs separately; barcodes follow SKUs when not asked', async () => {
    const p = (await g(`{ products(first: 1, query: "sku:*") { nodes { id title variants(first: 1) { nodes { id sku } } } } }`)).products.nodes[0];
    const v = p.variants.nodes[0];
    expect(v.sku).toBeTruthy();
    await g(`mutation($p: ID!, $v: [ProductVariantsBulkInput!]!) { productVariantsBulkUpdate(productId: $p, variants: $v) { userErrors { message } } }`, { p: p.id, v: [{ id: v.id, barcode: '4006381333931' }] });
    const dup = async (args: Record<string, boolean>) => {
      const r = await g(`mutation($id: ID!, $t: String!, $s: Boolean, $b: Boolean) { productDuplicate(productId: $id, newTitle: $t, shopmeIncludeSkus: $s, shopmeIncludeBarcodes: $b) { newProduct { variants(first: 1) { nodes { sku barcode } } } userErrors { message } } }`, { id: p.id, t: `${p.title} (Copy)`, ...args });
      expect(r.productDuplicate.userErrors).toEqual([]);
      return r.productDuplicate.newProduct.variants.nodes[0];
    };
    expect(await dup({ s: false, b: true })).toEqual({ sku: null, barcode: '4006381333931' });
    expect(await dup({ s: true, b: false })).toMatchObject({ sku: v.sku, barcode: null });
    expect(await dup({ s: false })).toEqual({ sku: null, barcode: null });
    expect(await dup({ s: true })).toEqual({ sku: v.sku, barcode: '4006381333931' });
  });
});

describe('shipping label eligibility', () => {
  it('tells digital orders apart from orders still awaiting a label', async () => {
    const addr = { firstName: 'Ada', lastName: 'Lovelace', address1: '1 Rue de Rivoli', city: 'Paris', zip: '75001', countryCode: 'FR' };
    const make = async (requiresShipping: boolean) => {
      const d = await g(`mutation($i: DraftOrderInput!) { draftOrderCreate(input: $i) { draftOrder { id } userErrors { message } } }`, { i: { email: 'ada@example.com', shippingAddress: addr, lineItems: [{ title: requiresShipping ? 'Mug' : 'Ebook', quantity: 1, originalUnitPrice: '10.00', requiresShipping }] } });
      const c = await g(`mutation($id: ID!) { draftOrderComplete(id: $id, paymentPending: false) { draftOrder { order { id } } userErrors { message } } }`, { id: d.draftOrderCreate.draftOrder.id });
      return c.draftOrderComplete.draftOrder.order.id as string;
    };
    const digital = await make(false);
    const parcel = await make(true);
    const r = await g(`query($ids: [ID!]!) { shopmeOrdersAwaitingLabel { id } nodes(ids: $ids) { ... on Order { id requiresShipping } } }`, { ids: [digital, parcel] });
    const awaiting = r.shopmeOrdersAwaitingLabel.map((o: { id: string }) => o.id);
    expect(awaiting).toContain(parcel);
    expect(awaiting).not.toContain(digital);
    expect(r.nodes).toEqual([{ id: digital, requiresShipping: false }, { id: parcel, requiresShipping: true }]);
  });
});
