import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createLocalStorage, schema as s, seedDemo } from '@shopme/core';
import { makeGql, makeGqlOk } from '../test/conformance/helpers';
import { createTestApp, setupAndLogin, type TestApp } from './test-utils';

const ADDRESS = { email: 'buyer@example.com', firstName: 'Ada', lastName: 'Lovelace', address1: '1 Rue de Rivoli', city: 'Paris', zip: '75001', countryCode: 'FR', phone: '' };

let t: TestApp;
let g: ReturnType<typeof makeGqlOk>;
let gql: ReturnType<typeof makeGql>;
const sku: Record<string, number> = {};
let locationGid: string;
let locationId: number;

beforeAll(async () => {
  t = await createTestApp();
  const cookie = await setupAndLogin(t.app);
  gql = makeGql(t.app, cookie);
  g = makeGqlOk(gql);
  await seedDemo(t.dbHandle.db, createLocalStorage(mkdtempSync(path.join(tmpdir(), 'ship-'))));
  for (const v of await t.dbHandle.db.select().from(s.productVariants)) if (v.sku) sku[v.sku] = v.id;
  const [loc] = await t.dbHandle.db.select().from(s.locations);
  locationId = loc!.id;
  locationGid = `gid://shopify/Location/${loc!.id}`;
}, 120_000);
afterAll(async () => { await t.close(); });

const variantGid = (code: string) => `gid://shopify/ProductVariant/${sku[code]}`;

async function cartWith(items: [string, number][]) {
  let cart = '';
  for (const [code, quantity] of items) {
    const add = await t.app.inject({ method: 'POST', url: '/cart/add.js', payload: { id: sku[code], quantity }, cookies: cart ? { cart } : {} });
    expect(add.statusCode).toBe(200);
    cart ||= add.cookies.find((c) => c.name === 'cart')!.value;
  }
  return cart;
}
const startCheckout = async (cart: string) => (await t.app.inject({ method: 'POST', url: '/checkout', cookies: { cart } })).headers.location!.toString().split('/').pop()!;
const refresh = (token: string, body: Record<string, unknown> = {}) => t.app.inject({ method: 'POST', url: `/checkouts/${token}/refresh`, payload: { ...ADDRESS, ...body } });

describe('delivery profiles API', () => {
  it('reads the general profile with the migrated zone, rates and conditions', async () => {
    const d = await g(`{ deliveryProfiles(first: 5) { nodes { id name default coversAllItems version activeMethodDefinitionsCount originLocationCount zoneCountryCount productVariantsCount { count }
      profileLocationGroups { locationGroup { id locationsCount { count } } locationGroupZones(first: 5) { nodes { zone { name countries { code { countryCode restOfWorld } name } }
        methodDefinitionCounts { rateDefinitionsCount } methodDefinitions(first: 5) { nodes { name active rateProvider { __typename ... on DeliveryRateDefinition { price { amount currencyCode } } }
          methodConditions { field operator conditionCriteria { __typename ... on MoneyV2 { amount } } } } } } } } } } }`);
    const p = d.deliveryProfiles.nodes[0];
    expect(p).toMatchObject({ name: 'General profile', default: true, coversAllItems: true, activeMethodDefinitionsCount: 2, originLocationCount: 1, zoneCountryCount: 6, productVariantsCount: { count: 0 } });
    const z = p.profileLocationGroups[0].locationGroupZones.nodes[0];
    expect(z.zone.name).toBe('Europe');
    expect(z.zone.countries[0].code).toEqual({ countryCode: 'FR', restOfWorld: false });
    expect(z.methodDefinitions.nodes[0]).toMatchObject({ name: 'Standard', rateProvider: { __typename: 'DeliveryRateDefinition', price: { amount: '4.9', currencyCode: 'EUR' } }, methodConditions: [{ field: 'TOTAL_PRICE', operator: 'LESS_THAN_OR_EQUAL_TO', conditionCriteria: { __typename: 'MoneyV2', amount: '49.99' } }] });
  });

  it('creates and updates a custom profile with zones, rates, weight and price conditions, and reports errors', async () => {
    const created = await g(`mutation($v: ID!, $l: ID!) { deliveryProfileCreate(profile: { name: "Heavy goods", variantsToAssociate: [$v], locationGroupsToCreate: [{ locations: [$l], zonesToCreate: [{ name: "France",
      countries: [{ code: FR }], methodDefinitionsToCreate: [
        { name: "Freight", rateDefinition: { price: { amount: "25.00", currencyCode: EUR } }, weightConditionsToCreate: [{ operator: GREATER_THAN_OR_EQUAL_TO, criteria: { value: 0.4, unit: KILOGRAMS } }] },
        { name: "Express", description: "1-2 days", rateDefinition: { price: { amount: "9.00", currencyCode: EUR } }, shopmeFreeOverAmount: { amount: "100.00", currencyCode: EUR } }] }] }] }) {
      profile { id name version productVariantsCount { count } profileItems(first: 5) { nodes { variants(first: 5) { nodes { id } } } }
        profileLocationGroups { locationGroupZones(first: 5) { nodes { zone { id } methodDefinitions(first: 5) { nodes { id name description shopmeFreeOverAmount { amount } methodConditions { id field conditionCriteria { __typename ... on Weight { unit value } } } } } } } } }
      userErrors { field message } } }`, { v: variantGid('HEB-250'), l: locationGid });
    expect(created.deliveryProfileCreate.userErrors).toEqual([]);
    const p = created.deliveryProfileCreate.profile;
    expect(p).toMatchObject({ name: 'Heavy goods', productVariantsCount: { count: 1 } });
    expect(p.profileItems.nodes[0].variants.nodes[0].id).toBe(variantGid('HEB-250'));
    const methods = p.profileLocationGroups[0].locationGroupZones.nodes[0].methodDefinitions.nodes;
    expect(methods[0]).toMatchObject({ name: 'Freight', methodConditions: [{ field: 'TOTAL_WEIGHT', conditionCriteria: { __typename: 'Weight', unit: 'GRAMS', value: 400 } }] });
    expect(methods[1]).toMatchObject({ name: 'Express', description: '1-2 days', shopmeFreeOverAmount: { amount: '100.0' } });

    const upd = await g(`mutation($id: ID!, $c: ID!) { a: deliveryProfileUpdate(id: $id, profile: { name: "Freight goods" }) { userErrors { message } }
      b: deliveryProfileUpdate(id: $id, profile: { conditionsToDelete: [$c] }) { userErrors { message } } }`, { id: p.id, c: methods[0].methodConditions[0].id });
    expect(upd.a.userErrors).toEqual([]);
    expect(upd.b.userErrors).toEqual([]);
    const after = await g(`query($id: ID!) { deliveryProfile(id: $id) { name version profileLocationGroups { locationGroupZones(first: 5) { nodes { methodDefinitions(first: 5) { nodes { name methodConditions { id } } } } } } } }`, { id: p.id });
    expect(after.deliveryProfile.name).toBe('Freight goods');
    expect(after.deliveryProfile.version).toBeGreaterThan(p.version);
    expect(after.deliveryProfile.profileLocationGroups[0].locationGroupZones.nodes[0].methodDefinitions.nodes[0].methodConditions).toEqual([]);

    // a condition can be updated through its id (criteria in the unit given)
    const grp = (await t.dbHandle.db.select().from(s.deliveryLocationGroups).where(eq(s.deliveryLocationGroups.profileId, Number(p.id.split('/').pop()))))[0]!;
    const methodId = methods[1].id;
    const withCond = await g(`mutation($id: ID!, $g: ID!, $z: ID!, $m: ID!) { deliveryProfileUpdate(id: $id, profile: { locationGroupsToUpdate: [{ id: $g, zonesToUpdate: [{ id: $z, methodDefinitionsToUpdate: [{ id: $m,
      priceConditionsToCreate: [{ operator: LESS_THAN_OR_EQUAL_TO, criteria: { amount: "300.00", currencyCode: EUR } }] }] }] }] }) {
      profile { profileLocationGroups { locationGroupZones(first: 5) { nodes { methodDefinitions(first: 5) { nodes { name methodConditions { id field conditionCriteria { ... on MoneyV2 { amount } } } } } } } } } userErrors { message } } }`,
    { id: p.id, g: `gid://shopify/DeliveryLocationGroup/${grp.id}`, z: p.profileLocationGroups[0].locationGroupZones.nodes[0].zone.id, m: methodId });
    expect(withCond.deliveryProfileUpdate.userErrors).toEqual([]);
    const cond = withCond.deliveryProfileUpdate.profile.profileLocationGroups[0].locationGroupZones.nodes[0].methodDefinitions.nodes[1].methodConditions[0];
    expect(cond).toMatchObject({ field: 'TOTAL_PRICE', conditionCriteria: { amount: '300.0' } });
    const edit = await g(`mutation($id: ID!, $g: ID!, $z: ID!, $m: ID!, $c: ID!) { deliveryProfileUpdate(id: $id, profile: { locationGroupsToUpdate: [{ id: $g, zonesToUpdate: [{ id: $z, methodDefinitionsToUpdate: [{ id: $m,
      conditionsToUpdate: [{ id: $c, criteria: 150 }] }] }] }] }) { profile { profileLocationGroups { locationGroupZones(first: 5) { nodes { methodDefinitions(first: 5) { nodes { methodConditions { conditionCriteria { ... on MoneyV2 { amount } } } } } } } } } userErrors { message } } }`,
    { id: p.id, g: `gid://shopify/DeliveryLocationGroup/${grp.id}`, z: p.profileLocationGroups[0].locationGroupZones.nodes[0].zone.id, m: methodId, c: cond.id });
    expect(edit.deliveryProfileUpdate.userErrors).toEqual([]);
    expect(edit.deliveryProfileUpdate.profile.profileLocationGroups[0].locationGroupZones.nodes[0].methodDefinitions.nodes[1].methodConditions[0].conditionCriteria.amount).toBe('150.0');

    const dup = await g(`mutation { deliveryProfileCreate(profile: { name: "freight goods" }) { profile { id } userErrors { field message } } }`);
    expect(dup.deliveryProfileCreate).toMatchObject({ profile: null, userErrors: [{ field: ['profile', 'name'], message: 'Profile name has already been taken' }] });
    const badLoc = await g(`mutation { deliveryProfileCreate(profile: { name: "Ghost", locationGroupsToCreate: [{ locations: ["gid://shopify/Location/99999"] }] }) { userErrors { field message } } }`);
    expect(badLoc.deliveryProfileCreate.userErrors[0]).toMatchObject({ field: ['profile', 'locationGroupsToCreate', '0', 'locations', '0'], message: 'Location not found' });
    const removeDefault = await g(`query { deliveryProfiles(first: 1) { nodes { id } } }`);
    const rd = await g(`mutation($id: ID!) { deliveryProfileRemove(id: $id) { job { done } userErrors { message } } }`, { id: removeDefault.deliveryProfiles.nodes[0].id });
    expect(rd.deliveryProfileRemove.userErrors[0].message).toMatch(/general profile/);
    expect((await g(`mutation($id: ID!) { deliveryProfileRemove(id: $id) { job { done } userErrors { message } } }`, { id: p.id })).deliveryProfileRemove).toEqual({ job: { done: true }, userErrors: [] });
  });
});

describe('packages API', () => {
  it('creates, updates, switches the default and deletes', async () => {
    const a = await g(`mutation { shopmeShippingPackageCreate(shippingPackage: { name: "Sample box", type: BOX, dimensions: { length: 20, width: 15, height: 4, unit: CENTIMETERS }, weight: { value: 0.1, unit: KILOGRAMS } }) { shippingPackage { id name default type length dimensionUnit weight { value unit } } userErrors { message } } }`);
    expect(a.shopmeShippingPackageCreate.shippingPackage).toMatchObject({ name: 'Sample box', default: true, type: 'BOX', length: 20, weight: { value: 0.1, unit: 'KILOGRAMS' } });
    const b = await g(`mutation { shopmeShippingPackageCreate(shippingPackage: { name: "Mailer", type: SOFT_PACK }) { shippingPackage { id default } userErrors { message } } }`);
    expect(b.shopmeShippingPackageCreate.shippingPackage.default).toBe(false);
    expect((await g(`mutation($id: ID!) { shippingPackageMakeDefault(id: $id) { userErrors { message } } }`, { id: b.shopmeShippingPackageCreate.shippingPackage.id })).shippingPackageMakeDefault.userErrors).toEqual([]);
    expect((await g(`mutation($id: ID!) { shippingPackageUpdate(id: $id, shippingPackage: { name: "Big box" }) { userErrors { message } } }`, { id: a.shopmeShippingPackageCreate.shippingPackage.id })).shippingPackageUpdate.userErrors).toEqual([]);
    expect((await g(`{ shopmeShippingPackages { name default } }`)).shopmeShippingPackages).toEqual([{ name: 'Big box', default: false }, { name: 'Mailer', default: true }]);
    expect((await g(`mutation($id: ID!) { shippingPackageDelete(id: $id) { deletedId userErrors { message } } }`, { id: b.shopmeShippingPackageCreate.shippingPackage.id })).shippingPackageDelete.userErrors).toEqual([]);
    expect((await g(`{ shopmeShippingPackages { name default } }`)).shopmeShippingPackages).toEqual([{ name: 'Big box', default: true }]);
  });
});

describe('local pickup and local delivery through checkout', () => {
  it('enables pickup, offers it at checkout with the location address, and the order follows the pickup flow', async () => {
    const bad = await g(`mutation { locationLocalPickupEnable(localPickupSettings: { locationId: "gid://shopify/Location/9999", pickupTime: ONE_HOUR }) { localPickupSettings { pickupTime } userErrors { code field message } } }`);
    expect(bad.locationLocalPickupEnable.userErrors[0]).toMatchObject({ code: 'ACTIVE_LOCATION_NOT_FOUND' });
    const custom = await g(`mutation($l: ID!) { locationLocalPickupEnable(localPickupSettings: { locationId: $l, pickupTime: CUSTOM }) { userErrors { code } } }`, { l: locationGid });
    expect(custom.locationLocalPickupEnable.userErrors[0].code).toBe('CUSTOM_PICKUP_TIME_NOT_ALLOWED');
    await t.dbHandle.db.update(s.locations).set({ address1: '5 Rue du Marche', city: 'Paris', zip: '75003', countryCode: 'FR' }).where(eq(s.locations.id, locationId));
    const on = await g(`mutation($l: ID!) { locationLocalPickupEnable(localPickupSettings: { locationId: $l, pickupTime: TWO_TO_FOUR_DAYS, instructions: "Bring your order number" }) { localPickupSettings { pickupTime instructions } userErrors { message } } }`, { l: locationGid });
    expect(on.locationLocalPickupEnable.localPickupSettings).toEqual({ pickupTime: 'TWO_TO_FOUR_DAYS', instructions: 'Bring your order number' });
    expect((await g(`query($l: ID!) { location(id: $l) { localPickupSettingsV2 { pickupTime } } }`, { l: locationGid })).location.localPickupSettingsV2).toEqual({ pickupTime: 'TWO_TO_FOUR_DAYS' });

    const cart = await cartWith([['HEB-250', 1]]);
    const rates = await t.app.inject({ method: 'GET', url: '/cart/shipping_rates.json?shipping_address[country]=France&shipping_address[zip]=75001', cookies: { cart } });
    expect(rates.statusCode).toBe(200);
    expect(rates.json().shipping_rates.map((r: { name: string; price: string; currency: string }) => [r.name, r.price, r.currency])).toEqual([['Standard', '4.90', 'EUR'], ['Pickup at Shop location', '0.00', 'EUR']]);
    expect((await t.app.inject({ method: 'GET', url: '/cart/shipping_rates.json?shipping_address[country]=Atlantis', cookies: { cart } })).statusCode).toBe(422);

    const token = await startCheckout(cart);
    const page = (await refresh(token)).json();
    expect(page.shipping).toContain('Pickup at Shop location');
    expect(page.shipping).toContain('Usually ready in 2-4 days');
    expect(page.shipping).toContain('5 Rue du Marche');

    const form = new URLSearchParams({ ...ADDRESS, paymentMethod: 'bank_transfer', shippingRateId: String(-locationId) }).toString();
    const done = await t.app.inject({ method: 'POST', url: `/checkouts/${token}/complete`, payload: form, headers: { 'content-type': 'application/x-www-form-urlencoded' } });
    expect(done.statusCode).toBe(303);
    const db = t.dbHandle.db;
    const [order] = await db.select().from(s.orders).where(eq(s.orders.cartToken, token));
    expect(order!.totalShipping).toBe(0);
    expect((await db.select().from(s.orderShippingLines).where(eq(s.orderShippingLines.orderId, order!.id)))[0]).toMatchObject({ title: 'Pickup at Shop location', price: 0 });
    expect((await db.select().from(s.orderDeliveries).where(eq(s.orderDeliveries.orderId, order!.id)))[0]).toMatchObject({ methodType: 'PICK_UP', locationId, pickupReadyAt: null });
    const addrs = await db.select().from(s.orderAddresses).where(eq(s.orderAddresses.orderId, order!.id));
    expect(addrs.find((a) => a.kind === 'shipping')).toMatchObject({ address1: '5 Rue du Marche', zip: '75003' });
    expect(addrs.find((a) => a.kind === 'billing')).toMatchObject({ address1: '1 Rue de Rivoli' });

    const gid = `gid://shopify/Order/${order!.id}`;
    const info = await g(`query($id: ID!) { order(id: $id) { shopmeDelivery { methodType location { name } pickupReadyAt pickedUpAt } } }`, { id: gid });
    expect(info.order.shopmeDelivery).toMatchObject({ methodType: 'PICK_UP', location: { name: 'Shop location' }, pickupReadyAt: null });
    const ready = await g(`mutation($id: ID!) { shopmeOrderPickupMarkReady(orderId: $id) { delivery { pickupReadyAt pickedUpAt } userErrors { message } } }`, { id: gid });
    expect(ready.shopmeOrderPickupMarkReady.userErrors).toEqual([]);
    expect(ready.shopmeOrderPickupMarkReady.delivery.pickupReadyAt).not.toBeNull();
    expect(ready.shopmeOrderPickupMarkReady.delivery.pickedUpAt).toBeNull();
    const picked = await g(`mutation($id: ID!) { shopmeOrderPickupMarkPickedUp(orderId: $id) { order { displayFulfillmentStatus } delivery { pickedUpAt } userErrors { message } } }`, { id: gid });
    expect(picked.shopmeOrderPickupMarkPickedUp.userErrors).toEqual([]);
    expect(picked.shopmeOrderPickupMarkPickedUp.order.displayFulfillmentStatus).toBe('FULFILLED');
    expect(picked.shopmeOrderPickupMarkPickedUp.delivery.pickedUpAt).not.toBeNull();
    const events = (await db.select().from(s.events).where(eq(s.events.subjectId, order!.id))).map((e) => e.verb);
    expect(events).toEqual(expect.arrayContaining(['order.pickup_ready', 'order.picked_up', 'order.fulfilled']));
    // a shipped order has no pickup flow
    const ship = await cartWith([['JPG-50', 1]]);
    const t2 = await startCheckout(ship);
    await refresh(t2);
    await t.app.inject({ method: 'POST', url: `/checkouts/${t2}/complete`, payload: new URLSearchParams({ ...ADDRESS, paymentMethod: 'bank_transfer' }).toString(), headers: { 'content-type': 'application/x-www-form-urlencoded' } });
    const [o2] = await db.select().from(s.orders).where(eq(s.orders.cartToken, t2));
    expect((await db.select().from(s.orderDeliveries).where(eq(s.orderDeliveries.orderId, o2!.id)))[0]!.methodType).toBe('SHIPPING');
    const nope = await g(`mutation($id: ID!) { shopmeOrderPickupMarkReady(orderId: $id) { userErrors { message } } }`, { id: `gid://shopify/Order/${o2!.id}` });
    expect(nope.shopmeOrderPickupMarkReady.userErrors[0].message).toMatch(/not a pickup order/);

    // turning pickup off removes the option
    await g(`mutation($l: ID!) { locationLocalPickupDisable(locationId: $l) { locationId userErrors { message } } }`, { l: locationGid });
    const cart2 = await cartWith([['HEB-250', 1]]);
    const r2 = await t.app.inject({ method: 'GET', url: '/cart/shipping_rates.json?shipping_address[country]=FR', cookies: { cart: cart2 } });
    expect(r2.json().shipping_rates.map((r: { name: string }) => r.name)).toEqual(['Standard']);
  });

  it('offers local delivery in the postal code area and rejects a stale choice outside of it', async () => {
    const upd = await g(`mutation($l: ID!) { shopmeLocationLocalDeliveryUpdate(locationId: $l, input: { enabled: true, postalCodes: ["750"], price: "3.50", minimumOrder: "10.00", info: "Delivered by bike" }) {
      localDelivery { enabled price { amount } minimumOrder { amount } postalCodes } userErrors { field message } } }`, { l: locationGid });
    expect(upd.shopmeLocationLocalDeliveryUpdate.userErrors).toEqual([]);
    expect(upd.shopmeLocationLocalDeliveryUpdate.localDelivery).toMatchObject({ enabled: true, price: { amount: '3.5' }, postalCodes: ['750'] });
    expect((await g(`mutation($l: ID!) { shopmeLocationLocalDeliveryUpdate(locationId: $l, input: { enabled: true, postalCodes: [] }) { userErrors { field message } } }`, { l: locationGid })).shopmeLocationLocalDeliveryUpdate.userErrors[0].field).toEqual(['input', 'postalCodes']);

    const cart = await cartWith([['HEB-250', 1]]);
    const token = await startCheckout(cart);
    const inside = (await refresh(token, { zip: '75001' })).json();
    expect(inside.shipping).toContain('Local delivery');
    expect(inside.shipping).toContain('Delivered by bike');
    const outside = (await refresh(token, { zip: '69001' })).json();
    expect(outside.shipping).not.toContain('Local delivery');
    // choosing the local delivery option for an address outside the area is refused
    const form = new URLSearchParams({ ...ADDRESS, zip: '69001', paymentMethod: 'bank_transfer', shippingRateId: String(-(1_000_000_000 + locationId)) }).toString();
    const bad = await t.app.inject({ method: 'POST', url: `/checkouts/${token}/complete`, payload: form, headers: { 'content-type': 'application/x-www-form-urlencoded' } });
    expect(bad.statusCode).toBe(422);
    expect(await t.dbHandle.db.select().from(s.orders).where(eq(s.orders.cartToken, token))).toHaveLength(0);
    // inside the area it becomes an order of type LOCAL
    const ok = new URLSearchParams({ ...ADDRESS, zip: '75001', paymentMethod: 'bank_transfer', shippingRateId: String(-(1_000_000_000 + locationId)) }).toString();
    expect((await t.app.inject({ method: 'POST', url: `/checkouts/${token}/complete`, payload: ok, headers: { 'content-type': 'application/x-www-form-urlencoded' } })).statusCode).toBe(303);
    const [order] = await t.dbHandle.db.select().from(s.orders).where(eq(s.orders.cartToken, token));
    expect(order!.totalShipping).toBe(350);
    expect((await t.dbHandle.db.select().from(s.orderDeliveries).where(eq(s.orderDeliveries.orderId, order!.id)))[0]).toMatchObject({ methodType: 'LOCAL', locationId });
  });
});
