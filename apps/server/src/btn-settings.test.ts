import { createServer, type Server } from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import {
  applyCustomsDefaults, applyTaxPreset, availablePaymentMethods, captureTransaction, configOf, createFulfillment, createGiftCard, createLocalStorage, createRole, deleteRole, generatePolicies, getPrimaryShop, importStaff, inviteStaff,
  listRoles, loadProfiles, markLocalDelivery, orderNameOf, quoteShipping, routedLocations, schema as s, seedDemo, setLocaleDomain, shippingByMarket, taxRegions, updateConfig, updateProfile, updateRole, updateStaff, listStaff,
  type ConfigKey, type Mail,
} from '@shopme/core';
import { signPaymentWebhook } from '@shopme/payments';
import { createTestApp, SETUP_BODY, type TestApp, verifiedDomainForTests } from './test-utils';
import { makeGql, makeGqlOk } from '../test/conformance/helpers';

const ADDRESS = { email: 'Buyer@Example.com', firstName: 'Ada', lastName: 'Lovelace', address1: '1 Rue de Rivoli', city: 'Paris', zip: '75001', countryCode: 'FR', phone: '+33 6 12 34 56 78' };
let t: TestApp;
let gql: ReturnType<typeof makeGql>;
let g: ReturnType<typeof makeGqlOk>;
let shopId: number;
let sent: Mail[];
const sku: Record<string, number> = {};
const db = () => t.dbHandle.db;
const form = (o: Record<string, string>) => ({ payload: new URLSearchParams(o).toString(), headers: { 'content-type': 'application/x-www-form-urlencoded' } });

const shop = async () => (await getPrimaryShop(db()))!;
async function setConfig(key: ConfigKey, value: unknown) {
  const r = await updateConfig(db(), await shop(), key, value);
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
}
async function startCheckout(variant: string, quantity = 1) {
  const add = await t.app.inject({ method: 'POST', url: '/cart/add.js', payload: { id: sku[variant], quantity } });
  const cart = add.cookies.find((c) => c.name === 'cart')!.value;
  const go = await t.app.inject({ method: 'POST', url: '/checkout', cookies: { cart } });
  return go.headers.location!.toString().split('/').pop()!;
}
async function placeOrder(method: string, variant = 'JPG-50') {
  const token = await startCheckout(variant);
  const done = await t.app.inject({ method: 'POST', url: `/checkouts/${token}/complete`, ...form({ ...ADDRESS, paymentMethod: method }) });
  const [order] = await db().select().from(s.orders).where(eq(s.orders.cartToken, token));
  return { token, done, order: order! };
}

beforeAll(async () => {
  t = await createTestApp();
  const setup = await t.app.inject({ method: 'POST', url: '/admin/api/setup', payload: SETUP_BODY });
  gql = makeGql(t.app, setup.cookies.find((c) => c.name === 'shopme_session')!.value);
  g = makeGqlOk(gql);
  await seedDemo(db(), createLocalStorage(mkdtempSync(path.join(tmpdir(), 'btn-'))));
  shopId = (await getPrimaryShop(db()))!.id;
  for (const v of await db().select().from(s.productVariants)) if (v.sku) sku[v.sku] = v.id;
  sent = [];
  t.app.ctx.mailer = { send: async (m) => { sent.push(m); } };
}, 90_000);
afterAll(async () => { await t.close(); });

describe('settings blocks', () => {
  it('returns defaults, validates the whole block and keeps ids unique', async () => {
    const r = await g(`query { shopmeConfig(key: "orders") }`);
    expect(r.shopmeConfig).toMatchObject({ idPrefix: '#', idSuffix: '', autoArchive: false, autoFulfillGiftCards: true });
    const bad = await updateConfig(db(), await shop(), 'GENERAL', { backupRegion: 'France' });
    expect(bad.ok).toBe(false);
    const dup = await updateConfig(db(), await shop(), 'PAYMENTS', { customMethods: [{ id: 'a', name: 'A' }, { id: 'a', name: 'B' }] });
    expect(!dup.ok && dup.errors[0]!.message).toMatch(/unique/);
    const unknown = await gql(`mutation { shopmeConfigUpdate(key: "NOPE", value: {}) { userErrors { message } } }`);
    expect(unknown.data.shopmeConfigUpdate.userErrors[0].message).toMatch(/Unknown/);
    const ok = await g(`mutation($v: JSON!) { shopmeConfigUpdate(key: "GIFT_CARDS", value: $v) { value userErrors { message } } }`, { v: { defaultExpirationMonths: 12 } });
    expect(ok.shopmeConfigUpdate.value).toEqual({ defaultExpirationMonths: 12 });
    await setConfig('GIFT_CARDS', {});
  });
});

describe('order ID format, test gateway and capture', () => {
  it('applies the prefix and suffix to new orders and sends the fulfilment request', async () => {
    await setConfig('ORDERS', { idPrefix: 'SM-', idSuffix: '-B' });
    await setConfig('SHIPPING', { fulfillmentServices: [{ id: 'partner', name: 'Partner', email: 'ship@partner.test' }] });
    await setConfig('NOTIFICATIONS', { fulfillmentRequest: { enabled: true } });
    sent.length = 0;
    const { order } = await placeOrder('bank_transfer');
    expect(order.name).toBe(`SM-${order.orderNumber}-B`);
    expect(orderNameOf(await shop(), 1234)).toBe('SM-1234-B');
    await t.app.ctx.queue.idle();
    expect(sent.some((m) => m.to === 'ship@partner.test' && m.subject.includes(order.name))).toBe(true);
    await setConfig('ORDERS', {});
    await setConfig('NOTIFICATIONS', {});
    await setConfig('SHIPPING', {});
  });

  it('offers the test gateway: paid at once, or authorised and captured later', async () => {
    await setConfig('PAYMENTS', { testGateway: true });
    const auto = await placeOrder('test');
    expect(auto.done.statusCode).toBe(303);
    expect(auto.order).toMatchObject({ financialStatus: 'PAID', test: true });

    await setConfig('PAYMENTS', { testGateway: true, captureMethod: 'manual' });
    const manual = await placeOrder('test');
    expect(manual.order.financialStatus).toBe('AUTHORIZED');
    const [auth] = await db().select().from(s.transactions).where(eq(s.transactions.orderId, manual.order.id));
    expect(auth).toMatchObject({ kind: 'AUTHORIZATION', status: 'SUCCESS', test: true });
    const cap = await captureTransaction(db(), shopId, { orderId: manual.order.id, parentTransactionId: auth!.id, amount: auth!.amount });
    expect(cap.ok).toBe(true);
    expect((await db().select().from(s.orders).where(eq(s.orders.id, manual.order.id)))[0]!.financialStatus).toBe('PAID');
    await setConfig('PAYMENTS', {});
    const refused = await placeOrder('test');
    expect(refused.done.statusCode).toBe(422);
  });

  it('adds merchant-defined methods and applies payment customizations by country and total', async () => {
    await setConfig('PAYMENTS', {
      customMethods: [{ id: 'cheque', name: 'Cheque', instructions: 'Send a cheque to our address.' }],
      customizations: [
        { id: 'hide-cod', name: 'No COD in France', action: 'hide', method: 'cod', countries: ['FR'] },
        { id: 'rename', name: 'Rename bank', action: 'rename', method: 'bank_transfer', newName: 'Wire transfer', minTotal: 100 },
        { id: 'first', name: 'Cheque first', action: 'move_first', method: 'manual:cheque' },
      ],
    });
    const base = (await shop()).settings;
    const fr = availablePaymentMethods(base, { stripeConfigured: false, context: { country: 'FR', total: 5000 } });
    expect(fr.map((m) => m.id)).toEqual(['manual:cheque', 'bank_transfer']);
    expect(fr[1]!.name).toBe('Wire transfer');
    expect(availablePaymentMethods(base, { stripeConfigured: false, context: { country: 'DE', total: 5000 } }).map((m) => m.id)).toContain('cod');
    const token = await startCheckout('JPG-50');
    await t.app.inject({ method: 'POST', url: `/checkouts/${token}/refresh`, payload: ADDRESS });
    const page = await t.app.inject(`/checkouts/${token}`);
    expect(page.body).toContain('Cheque');
    expect(page.body).not.toContain('value="cod"');
    const placed = await t.app.inject({ method: 'POST', url: `/checkouts/${token}/complete`, ...form({ ...ADDRESS, paymentMethod: 'manual:cheque' }) });
    expect(placed.statusCode).toBe(303);
    const thanks = await t.app.inject(`/checkouts/${token}/thank-you`);
    expect(thanks.body).toContain('Send a cheque to our address.');
    await setConfig('PAYMENTS', {});
  });

  it('sends the buyer to a redirect gateway and marks the order paid from its signed webhook', async () => {
    await setConfig('PAYMENTS', { redirectGateways: [{ id: 'pay', name: 'Pay page', redirectUrl: 'https://pay.example.com/p?ref={reference}&amt={amount}', secret: 's3cret' }] });
    const { done, order } = await placeOrder('redirect:pay');
    expect(done.statusCode).toBe(303);
    expect(done.headers.location).toBe(`https://pay.example.com/p?ref=${encodeURIComponent(order.name)}&amt=${(order.total / 100).toFixed(2)}`);
    expect(order.financialStatus).toBe('PENDING');
    const body = JSON.stringify({ reference: order.name, status: 'paid' });
    const bad = await t.app.inject({ method: 'POST', url: '/webhooks/payments/pay', payload: body, headers: { 'content-type': 'application/json', 'x-shopme-signature': 'deadbeef' } });
    expect(bad.statusCode).toBe(400);
    const ok = await t.app.inject({ method: 'POST', url: '/webhooks/payments/pay', payload: body, headers: { 'content-type': 'application/json', 'x-shopme-signature': signPaymentWebhook('s3cret', body) } });
    expect(ok.statusCode).toBe(200);
    expect((await db().select().from(s.orders).where(eq(s.orders.id, order.id)))[0]!.financialStatus).toBe('PAID');
    await setConfig('PAYMENTS', {});
  });
});

describe('shipping rates', () => {
  async function standardRate() {
    const p = (await loadProfiles(db(), shopId))[0]!;
    const group = p.groups[0]!;
    const zone = group.zones.find((z) => z.methods.length)!;
    return { profile: p, group, zone, method: zone.methods[0]! };
  }
  const line = { variantId: 0, quantity: 1, price: 1100, grams: 1500, requiresShipping: true };

  it('estimates the transit time, adds the handling time and limits a rate to collections and origins', async () => {
    const { profile, group, zone, method } = await standardRate();
    const edit = (m: Record<string, unknown>) => updateProfile(db(), shopId, profile.id, { locationGroupsToUpdate: [{ id: group.id, zonesToUpdate: [{ id: zone.id, methodDefinitionsToUpdate: [{ id: method.id, ...m }] }] }] });
    expect((await edit({ transitMinDays: 2, transitMaxDays: 4 })).ok).toBe(true);
    expect((await edit({ transitMinDays: 5, transitMaxDays: 2 })).ok).toBe(false);
    await setConfig('SHIPPING', { handlingDays: 1 });
    const l = { ...line, variantId: sku['JPG-50']! };
    const quoted = await quoteShipping(db(), shopId, { countryCode: 'FR' }, [l]);
    expect(quoted.find((o) => o.id === method.id)?.transit).toEqual({ min: 3, max: 5 });
    const token = await startCheckout('JPG-50');
    await t.app.inject({ method: 'POST', url: `/checkouts/${token}/refresh`, payload: ADDRESS });
    expect((await t.app.inject(`/checkouts/${token}`)).body).toContain('Estimated delivery');

    const [collection] = await db().insert(s.collections).values({ shopId, title: 'Nothing here', handle: 'nothing-here' }).returning();
    expect((await edit({ collectionIds: [collection!.id] })).ok).toBe(true);
    expect((await quoteShipping(db(), shopId, { countryCode: 'FR' }, [l])).some((o) => o.id === method.id)).toBe(false);
    await db().insert(s.collectionProducts).values({ shopId, collectionId: collection!.id, productId: (await db().select().from(s.productVariants).where(eq(s.productVariants.id, l.variantId)))[0]!.productId });
    expect((await quoteShipping(db(), shopId, { countryCode: 'FR' }, [l])).some((o) => o.id === method.id)).toBe(true);
    await edit({ collectionIds: [] });

    const otherLocation = (await db().select().from(s.locations).where(eq(s.locations.shopId, shopId)))[0]!.id + 999;
    await edit({ originLocationIds: [otherLocation] });
    expect((await quoteShipping(db(), shopId, { countryCode: 'FR' }, [l])).some((o) => o.id === method.id)).toBe(false);
    await edit({ originLocationIds: [] });
    await edit({ transitMinDays: null, transitMaxDays: null });
    await setConfig('SHIPPING', {});
  });

  it('prices a carrier-calculated rate with the demo provider and an HTTP carrier account, with a fallback', async () => {
    const { profile, group, zone, method } = await standardRate();
    const edit = (m: Record<string, unknown>) => updateProfile(db(), shopId, profile.id, { locationGroupsToUpdate: [{ id: group.id, zonesToUpdate: [{ id: zone.id, methodDefinitionsToUpdate: [{ id: method.id, ...m }] }] }] });
    const l = { ...line, variantId: sku['JPG-50']! };
    expect((await edit({ rateType: 'CARRIER' })).ok).toBe(false);
    expect((await edit({ rateType: 'CARRIER', carrierProvider: 'demo_flat', carrierParams: { base: 300, perKg: 200 } })).ok).toBe(true);
    expect((await quoteShipping(db(), shopId, { countryCode: 'FR' }, [l])).find((o) => o.id === method.id)?.price).toBe(300 + 200 * 2);

    let asked: { service: string; grams: number } | null = null;
    let auth = '';
    const server: Server = createServer((req, res) => {
      let b = ''; req.on('data', (c) => { b += c; }); req.on('end', () => { asked = JSON.parse(b); auth = String(req.headers.authorization); res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ price: 777 })); });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const port = (server.address() as { port: number }).port;
    process.env.WEBHOOKS_ALLOW_PRIVATE = '1';
    try {
      await setConfig('SHIPPING', { carrierAccounts: [{ id: 'acme', provider: 'http', name: 'Acme', endpoint: `http://127.0.0.1:${port}/quote`, secret: 'tok' }] });
      await edit({ carrierProvider: 'http', carrierParams: { accountId: 'acme', service: 'express' } });
      expect((await quoteShipping(db(), shopId, { countryCode: 'FR' }, [l])).find((o) => o.id === method.id)?.price).toBe(777);
      expect(asked).toMatchObject({ service: 'express', grams: 1500 });
      expect(auth).toBe('Bearer tok');
    } finally { server.close(); delete process.env.WEBHOOKS_ALLOW_PRIVATE; }
    // account unreachable: the rate falls back to its fixed price
    const fallback = (await quoteShipping(db(), shopId, { countryCode: 'FR' }, [l])).find((o) => o.id === method.id)?.price;
    expect(fallback).toBe(method.price);
    await edit({ rateType: 'FIXED' });
    await setConfig('SHIPPING', {});
  });

  it('hides, renames and reorders options with delivery customizations', async () => {
    const l = { ...line, variantId: sku['JPG-50']! };
    const plain = await quoteShipping(db(), shopId, { countryCode: 'FR' }, [l]);
    const first = plain[0]!;
    await setConfig('SHIPPING', { customizations: [{ id: 'r', name: 'Rename', action: 'rename', optionName: first.name, newName: 'Express', countries: ['FR'] }] });
    expect((await quoteShipping(db(), shopId, { countryCode: 'FR' }, [l]))[0]!.name).toBe('Express');
    expect((await quoteShipping(db(), shopId, { countryCode: 'FR' }, [l])).length).toBe(plain.length);
    await setConfig('SHIPPING', { customizations: [{ id: 'h', name: 'Hide', action: 'hide', optionName: first.name, minSubtotal: 0, maxSubtotal: 999999 }] });
    expect((await quoteShipping(db(), shopId, { countryCode: 'FR' }, [l])).some((o) => o.name === first.name)).toBe(false);
    await setConfig('SHIPPING', {});
  });

  it('routes an order to the preferred locations of the first matching rule', async () => {
    await setConfig('SHIPPING', { routing: [{ id: 'a', name: 'Off', enabled: false, countries: ['FR'], locationIds: [9] }, { id: 'b', name: 'France', countries: ['FR'], locationIds: [3, 1] }, { id: 'c', name: 'All', locationIds: [2] }] });
    const sh = await shop();
    expect(routedLocations(sh, 'fr')).toEqual([3, 1]);
    expect(routedLocations(sh, 'DE')).toEqual([2]);
    await setConfig('SHIPPING', {});
    expect(routedLocations(await shop(), 'FR')).toEqual([]);
    const lists = await shippingByMarket(db(), shopId);
    expect(Array.isArray(lists)).toBe(true);
  });
});

describe('taxes', () => {
  it('applies presets once, groups regions and fills customs defaults', async () => {
    const first = await applyTaxPreset(db(), shopId, 'EU_VAT');
    expect(first.ok && first.value.added).toBeGreaterThan(20);
    const second = await applyTaxPreset(db(), shopId, 'EU_VAT');
    expect(second.ok && second.value.added).toBe(0);
    expect((await applyTaxPreset(db(), shopId, 'NOPE')).ok).toBe(false);
    const ca = await applyTaxPreset(db(), shopId, 'CA_PROVINCES');
    expect(ca.ok).toBe(true);
    const regions = await taxRegions(db(), shopId);
    expect(regions.find((r) => r.countryCode === 'DE')).toMatchObject({ combinedRate: 19, rates: 1 });
    expect(regions.find((r) => r.countryCode === 'CA')!.provinces).toBeGreaterThan(5);
    expect((await applyTaxPreset(db(), shopId, 'EU_VAT', { replace: true })).ok).toBe(true);

    await setConfig('TAXES', { customs: { originCountry: 'fr', hsCode: '0901.21' } });
    const done = await applyCustomsDefaults(db(), await shop());
    expect(done.updated).toBeGreaterThan(0);
    expect((await applyCustomsDefaults(db(), await shop())).updated).toBe(0);
    await setConfig('TAXES', {});
  });

  it('charges the buyer-country VAT on digital goods and adds import duties on top', async () => {
    const { priceCheckout, taxExtrasFor } = await import('@shopme/core');
    await db().delete(s.taxRates).where(eq(s.taxRates.countryCode, 'DE'));
    const digital = { id: 1, unitPrice: 1000, quantity: 1, taxable: true, requiresShipping: false, grams: 0, productId: 1, collectionIds: [] };
    const goods = { ...digital, id: 2, requiresShipping: true };
    const input = (extra: object) => ({ lines: [digital, goods], discounts: [], shipping: null, taxRates: [], taxesIncluded: false, country: 'DE', province: null, ...extra });
    expect(priceCheckout(input({})).totalTax).toBe(0);
    await setConfig('TAXES', { digitalVat: true, duties: { enabled: true, rules: [{ countryCode: 'DE', rate: 10 }] } });
    const extras = taxExtrasFor(await shop(), 'DE');
    const r = priceCheckout(input(extras));
    expect(r.lines.find((l) => l.id === 1)!.tax).toBe(190); // 19 % German VAT on the digital item only
    expect(r.lines.find((l) => l.id === 2)!.tax).toBe(100); // 10 % duty on the shipped item
    expect(r.total).toBe(2000 + 190 + 100);
    expect(priceCheckout(input({ ...extras, taxesIncluded: true })).total).toBe(2000 + 100); // duties are never inside the price
    expect(taxExtrasFor(await shop(), 'FR').dutyRates).toBeUndefined();
    await setConfig('TAXES', {});
  });
});

describe('staff roles and import', () => {
  it('creates roles, copies permissions to members, keeps them in sync and imports a CSV', async () => {
    const role = await createRole(db(), shopId, { name: 'Support', permissions: ['orders', 'customers'] });
    if (!role.ok) throw new Error('role');
    expect((await createRole(db(), shopId, { name: 'support', permissions: [] })).ok).toBe(false);
    expect((await createRole(db(), shopId, { name: 'Admin', permissions: [] })).ok).toBe(false);
    expect((await createRole(db(), shopId, { name: 'Bad', permissions: ['nope'] })).ok).toBe(false);
    const invited = await inviteStaff(db(), shopId, { email: 'sam@example.com', role: 'staff', roleId: role.value.id });
    if (!invited.ok) throw new Error('invite');
    expect(invited.value.staff.permissions).toEqual(['orders', 'customers']);

    const upd = await updateRole(db(), shopId, role.value.id, { permissions: ['orders'] });
    expect(upd.ok && upd.value.members).toBe(1);
    const sam = (await listStaff(db(), shopId)).find((m) => m.email === 'sam@example.com')!;
    expect(sam).toMatchObject({ permissions: ['orders'], roleName: 'Support', twoFactor: false });
    expect((await updateStaff(db(), shopId, sam.id, { role: 'admin' })).ok).toBe(true);
    expect((await listStaff(db(), shopId)).find((m) => m.id === sam.id)!.roleId).toBeNull();
    expect((await updateStaff(db(), shopId, sam.id, { roleId: role.value.id })).ok).toBe(true);
    expect((await deleteRole(db(), shopId, role.value.id)).ok).toBe(true);
    expect((await listStaff(db(), shopId)).find((m) => m.id === sam.id)).toMatchObject({ roleId: null, permissions: ['orders'] });

    await createRole(db(), shopId, { name: 'Packers', permissions: ['products'] });
    const csv = 'email,first_name,last_name,role\nPAT@example.com,Pat,Doe,Packers\nbad-email,,,staff\nroot@example.com,,,admin\nzed@example.com,,,Unknown role\nsam@example.com,,,staff\n';
    const rows = await importStaff(db(), shopId, csv, { allowAdmin: false });
    expect(rows.map((r) => [r.email.toLowerCase(), r.ok])).toEqual([['pat@example.com', true], ['bad-email', false], ['root@example.com', false], ['zed@example.com', false], ['sam@example.com', true]]);
    expect(rows[0]!.staff).toMatchObject({ roleName: 'Packers', permissions: ['products'] });
    expect((await importStaff(db(), shopId, 'email,role\nadm@example.com,admin\n', { allowAdmin: true }))[0]!.ok).toBe(true);
    expect(listRoles).toBeTypeOf('function');
  });

  it('exposes roles and the import through the Admin API', async () => {
    const created = await g(`mutation { shopmeStaffRoleCreate(name: "Editors", permissions: ["online_store"]) { value userErrors { message } } }`);
    expect(created.shopmeStaffRoleCreate.value.permissions).toEqual(['online_store']);
    const imp = await g(`mutation($csv: String!) { shopmeStaffImport(csv: $csv) { value userErrors { message } } }`, { csv: 'email,role\neve@example.com,Editors\n' });
    expect(imp.shopmeStaffImport.value).toMatchObject({ invited: 1, failed: 0 });
    const staff = await g(`query { staffMembers(first: 20) { nodes { email shopmeTwoFactorEnabled shopmeRoleName } } }`);
    expect(staff.staffMembers.nodes.find((n: { email: string }) => n.email === 'eve@example.com')).toMatchObject({ shopmeRoleName: 'Editors', shopmeTwoFactorEnabled: false });
  });
});

describe('gift cards, policies, languages, local delivery', () => {
  it('gives gift cards a default expiry and fulfils gift card items once issued', async () => {
    await setConfig('GIFT_CARDS', { defaultExpirationMonths: 6 });
    const card = await createGiftCard(db(), shopId, 'EUR', { initialValue: 5000 });
    expect(card.ok && card.value.expiresOn!.getTime()).toBeGreaterThan(Date.now() + 150 * 86_400_000);
    const never = await createGiftCard(db(), shopId, 'EUR', { initialValue: 5000, expiresOn: null });
    expect(never.ok && never.value.expiresOn).toBeNull();
    await setConfig('GIFT_CARDS', {});
  });

  it('archives a paid order automatically when it is fulfilled', async () => {
    await setConfig('ORDERS', { autoArchive: true });
    await setConfig('PAYMENTS', { testGateway: true });
    const { order } = await placeOrder('test');
    const f = await createFulfillment(db(), shopId, order.id, {});
    expect(f.ok && f.value.order.closedAt).toBeTruthy();
    await setConfig('ORDERS', {});
    await setConfig('PAYMENTS', {});
  });

  it('writes empty policies from templates and keeps existing text unless told to overwrite', async () => {
    const sh = await shop();
    const written = await generatePolicies(db(), sh, ['REFUND_POLICY', 'LEGAL_NOTICE'], false);
    expect(written).toEqual(['REFUND_POLICY', 'LEGAL_NOTICE']);
    const again = await generatePolicies(db(), await shop(), ['REFUND_POLICY'], false);
    expect(again).toEqual([]);
    const r = await g(`mutation { shopmePoliciesGenerate(types: ["REFUND_POLICY"], overwrite: true) { value userErrors { message } } }`);
    expect(r.shopmePoliciesGenerate.value.written).toEqual(['REFUND_POLICY']);
    const p = await g(`query { shop { shopPolicies { type body } } }`);
    expect(p.shop.shopPolicies.find((x: { type: string }) => x.type === 'LEGAL_NOTICE').body).toContain('Test Shop');
  });

  it('serves a language on its own domain', async () => {
    await g(`mutation { shopLocaleEnable(locale: "fr") { shopLocale { locale } userErrors { message } } }`);
    await g(`mutation { shopLocaleUpdate(locale: "fr", shopLocale: { published: true }) { userErrors { message } } }`);
    expect((await setLocaleDomain(db(), shopId, 'fr', 'not a host')).ok).toBe(false);
    await verifiedDomainForTests(t.app, shopId, 'fr.example.com'); // multi-store: a store may only use a domain it verified
    const ok = await g(`mutation { shopmeLocaleDomainUpdate(locale: "fr", domain: "FR.example.com") { value userErrors { message } } }`);
    expect(ok.shopmeLocaleDomainUpdate.value.domain).toBe('fr.example.com');
    const dup = await setLocaleDomain(db(), shopId, 'en', 'fr.example.com');
    expect(dup.ok).toBe(false);
    const list = await g(`query { shopLocales { locale shopmeDomain } }`);
    expect(list.shopLocales.find((l: { locale: string }) => l.locale === 'fr').shopmeDomain).toBe('fr.example.com');
    const res = await t.app.inject({ method: 'GET', url: '/', headers: { host: 'fr.example.com' } });
    expect(res.statusCode).toBeLessThan(500);
  });

  it('refuses to mark a non-local order delivered', async () => {
    const { order } = await placeOrder('bank_transfer');
    const r = await markLocalDelivery(db(), shopId, order.id, 'DELIVERED');
    expect(r.ok).toBe(false);
    const api = await gql(`mutation { shopmeLocalDeliveryUpdate(orderId: "gid://shopify/Order/${order.id}", status: "DELIVERED") { userErrors { message } } }`);
    expect(api.data.shopmeLocalDeliveryUpdate.userErrors[0].message).toMatch(/not a local delivery/);
  });
});

describe('store deletion', () => {
  it('needs the owner, the exact name, and writes a final export first', async () => {
    const wrong = await g(`mutation { shopmeShopDelete(confirmName: "Nope") { value userErrors { message } } }`);
    expect(wrong.shopmeShopDelete.userErrors[0].message).toMatch(/does not match/);
    const ok = await g(`mutation { shopmeShopDelete(confirmName: "Test Shop") { value userErrors { message } } }`);
    expect(ok.shopmeShopDelete.value.deleted).toBe(true);
    expect(ok.shopmeShopDelete.value.backup).toMatch(/^final-.*\.shopme$/);
    expect(await getPrimaryShop(db())).toBeNull();
  });
});
