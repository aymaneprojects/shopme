import { mkdtempSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { createLocalStorage, schema as s, seedDemo } from '@shopme/core';
import { createTestApp, SETUP_BODY, type TestApp } from './test-utils';
import { makeGql, makeGqlOk } from '../test/conformance/helpers';

const ADDRESS = { email: 'buyer@example.com', firstName: 'Ada', lastName: 'Lovelace', address1: '1 Rue de Rivoli', city: 'Paris', zip: '75001', countryCode: 'FR', phone: '' };
const LABEL = '{ id source carrier service trackingNumber trackingUrl cost currencyCode status labelUrl labelFormat refundStatus test fulfillmentId weightGrams }';
const RATES = `query($i: ShopmeShippingLabelRatesInput!) { shopmeShippingLabelRates(input: $i) { rates { accountId accountName test rateId service name price currencyCode estimatedDays } carrierErrors { accountName message } userErrors { field message } } }`;
const BUY = `mutation($i: ShopmeShippingLabelPurchaseInput!) { shopmeShippingLabelPurchase(input: $i) { label ${LABEL} userErrors { field message } } }`;
const VOID = `mutation($id: ID!) { shopmeShippingLabelVoid(id: $id) { label ${LABEL} userErrors { message } } }`;
const CONFIG = `mutation($v: JSON!) { shopmeConfigUpdate(key: "SHIPPING", value: $v) { userErrors { field message } } }`;

let t: TestApp;
let g: ReturnType<typeof makeGqlOk>;
let cookie: string;
const sku: Record<string, number> = {};
const db = () => t.dbHandle.db;
const gid = (type: string, id: number) => `gid://shopify/${type}/${id}`;

async function newOrder(variant: string, quantity: number) {
  const add = await t.app.inject({ method: 'POST', url: '/cart/add.js', payload: { id: sku[variant], quantity } });
  const cart = add.cookies.find((c) => c.name === 'cart')!.value;
  const go = await t.app.inject({ method: 'POST', url: '/checkout', cookies: { cart } });
  const token = go.headers.location!.toString().split('/').pop()!;
  await t.app.inject({ method: 'POST', url: `/checkouts/${token}/refresh`, payload: ADDRESS });
  const done = await t.app.inject({ method: 'POST', url: `/checkouts/${token}/complete`, payload: new URLSearchParams({ ...ADDRESS, paymentMethod: 'bank_transfer' }).toString(), headers: { 'content-type': 'application/x-www-form-urlencoded' } });
  expect(done.statusCode).toBe(303);
  return (await db().select().from(s.orders).where(eq(s.orders.cartToken, token)))[0]!;
}
const fulfillmentStatus = async (id: number) => (await g(`query($id: ID!) { order(id: $id) { displayFulfillmentStatus fulfillments { id status trackingInfo { company number url } } } }`, { id: gid('Order', id) })).order;

beforeAll(async () => {
  t = await createTestApp();
  const setup = await t.app.inject({ method: 'POST', url: '/admin/api/setup', payload: SETUP_BODY });
  cookie = setup.cookies.find((c) => c.name === 'shopme_session')!.value;
  g = makeGqlOk(makeGql(t.app, cookie));
  await seedDemo(db(), createLocalStorage(mkdtempSync(path.join(tmpdir(), 'lp-'))));
  for (const v of await db().select().from(s.productVariants)) if (v.sku) sku[v.sku] = v.id;
  t.app.ctx.mailer = { send: async () => {} };
}, 90_000);
afterAll(async () => { await t.close(); });

describe('buying shipping labels with the test carrier', () => {
  it('needs a carrier account that sells labels', async () => {
    const order = await newOrder('HEB-250', 1);
    expect((await g('{ shopmeLabelCarriers { id } }')).shopmeLabelCarriers).toEqual([]);
    const r = await g(RATES, { i: { orderId: gid('Order', order.id), parcel: { weightGrams: 900 } } });
    expect(r.shopmeShippingLabelRates.userErrors[0].message).toMatch(/Settings > Shipping/);
    // An HTTP account still needs its endpoint; the test carrier does not.
    expect((await g(CONFIG, { v: { carrierAccounts: [{ id: 'acme', provider: 'http', name: 'Acme', endpoint: '' }] } })).shopmeConfigUpdate.userErrors[0].message).toMatch(/Endpoint/);
    expect((await g(CONFIG, { v: { carrierAccounts: [{ id: 'test', provider: 'test', name: 'Test carrier' }, { id: 'rates-only', provider: 'http', name: 'Rates only', endpoint: 'https://rates.example.com/quote' }] } })).shopmeConfigUpdate.userErrors).toEqual([]);
    expect((await g('{ shopmeLabelCarriers { id name provider test } }')).shopmeLabelCarriers).toEqual([{ id: 'test', name: 'Test carrier', provider: 'test', test: true }]);
    // "Calculate rates" in Settings > Shipping: no order needed.
    const est = (await g(`query($i: ShopmeShippingLabelEstimateInput!) { shopmeShippingLabelEstimate(input: $i) { rates { rateId price } userErrors { field message } } }`, { i: { countryCode: 'de', parcel: { weightGrams: 2500 } } })).shopmeShippingLabelEstimate;
    expect(est.rates).toEqual([{ rateId: 'test-standard', price: '8.2' }, { rateId: 'test-express', price: '15.6' }]);
    expect((await g(`query($i: ShopmeShippingLabelEstimateInput!) { shopmeShippingLabelEstimate(input: $i) { userErrors { field } } }`, { i: { countryCode: '', parcel: { weightGrams: 2500 } } })).shopmeShippingLabelEstimate.userErrors[0].field).toEqual(['input', 'countryCode']);
  });

  it('quotes, buys, prints and voids a label, with its tracking on the fulfillment', async () => {
    const order = await newOrder('HEB-250', 2);
    const oid = gid('Order', order.id);
    const bad = await g(RATES, { i: { orderId: oid, parcel: { weightGrams: 0 } } });
    expect(bad.shopmeShippingLabelRates.userErrors[0]).toMatchObject({ field: ['input', 'parcel', 'weightGrams'] });
    const r = (await g(RATES, { i: { orderId: oid, parcel: { weightGrams: 1200 } } })).shopmeShippingLabelRates;
    expect(r.userErrors).toEqual([]);
    expect(r.rates.map((x: { rateId: string }) => x.rateId)).toEqual(['test-standard', 'test-express']); // cheapest first
    expect(r.rates[0]).toMatchObject({ accountId: 'test', accountName: 'Test carrier', test: true, name: 'Test Standard', price: '7.1', currencyCode: 'EUR', estimatedDays: 3 });

    const wrong = await g(BUY, { i: { orderId: oid, parcel: { weightGrams: 1200 }, accountId: 'test', rateId: 'nope' } });
    expect(wrong.shopmeShippingLabelPurchase.userErrors[0].message).toMatch(/rate does not exist/);
    expect((await fulfillmentStatus(order.id)).displayFulfillmentStatus).toBe('UNFULFILLED');

    const bought = await g(BUY, { i: { orderId: oid, parcel: { weightGrams: 1200 }, accountId: 'test', rateId: 'test-express', notifyCustomer: false } });
    expect(bought.shopmeShippingLabelPurchase.userErrors).toEqual([]);
    const label = bought.shopmeShippingLabelPurchase.label;
    expect(label).toMatchObject({ source: 'PURCHASED', carrier: 'Test carrier', service: 'Test Express', cost: '13.7', currencyCode: 'EUR', status: 'ACTIVE', labelFormat: 'PDF', test: true, weightGrams: 1200 });
    expect(label.trackingNumber).toMatch(/^TEST\d{12}$/);
    const o = await fulfillmentStatus(order.id);
    expect(o.displayFulfillmentStatus).toBe('FULFILLED');
    expect(o.fulfillments[0].id).toBe(label.fulfillmentId);
    expect(o.fulfillments[0].trackingInfo[0]).toMatchObject({ company: 'Test carrier', number: label.trackingNumber });

    // The PDF is served to staff only.
    expect(label.labelUrl).toBe(`/admin/api/shipping-labels/${label.id.split('/').pop()}/label`);
    const pdf = await t.app.inject({ url: label.labelUrl, cookies: { shopme_session: cookie } });
    expect(pdf.statusCode).toBe(200);
    expect(pdf.headers['content-type']).toBe('application/pdf');
    expect(pdf.headers['cache-control']).toContain('no-store');
    expect(pdf.rawPayload.subarray(0, 8).toString('latin1')).toBe('%PDF-1.4');
    expect(pdf.rawPayload.toString('latin1')).toContain('TEST LABEL - NOT VALID FOR SHIPPING');
    expect(pdf.rawPayload.toString('latin1')).toContain(label.trackingNumber);
    expect(pdf.rawPayload.toString('latin1')).toContain('Ada Lovelace');
    expect((await t.app.inject({ url: label.labelUrl })).statusCode).toBe(401);
    expect((await g(`{ shopmeShippingLabels(orderId: "${oid}") { id source } }`)).shopmeShippingLabels).toEqual([{ id: label.id, source: 'PURCHASED' }]);
    const events = await db().select().from(s.events).where(eq(s.events.subjectId, order.id));
    expect(events.map((e) => e.verb)).toContain('order.label_purchased');

    // Nothing left to ship: no new label.
    expect((await g(RATES, { i: { orderId: oid, parcel: { weightGrams: 500 } } })).shopmeShippingLabelRates.userErrors[0].message).toMatch(/nothing left to ship/);

    const voided = await g(VOID, { id: label.id });
    expect(voided.shopmeShippingLabelVoid.userErrors).toEqual([]);
    expect(voided.shopmeShippingLabelVoid.label).toMatchObject({ status: 'VOIDED', refundStatus: 'REFUNDED' });
    const after = await fulfillmentStatus(order.id);
    expect(after.displayFulfillmentStatus).toBe('UNFULFILLED'); // the fulfillment went with the label
    expect(after.fulfillments[0].status).toBe('CANCELLED');
    expect((await g(VOID, { id: label.id })).shopmeShippingLabelVoid.userErrors[0].message).toMatch(/already voided/);
  });

  it('buys a label for an existing fulfillment without tracking', async () => {
    const order = await newOrder('HEB-250', 1);
    const oid = gid('Order', order.id);
    const made = await g(`mutation($f: FulfillmentInput!) { fulfillmentCreate(fulfillment: $f) { fulfillment { id } userErrors { message } } }`, { f: { orderId: oid, notifyCustomer: false } });
    const fid = made.fulfillmentCreate.fulfillment.id;
    const r = (await g(RATES, { i: { orderId: oid, fulfillmentId: fid, parcel: { weightGrams: 300 } } })).shopmeShippingLabelRates;
    expect(r.rates).toHaveLength(2);
    const bought = await g(BUY, { i: { orderId: oid, fulfillmentId: fid, parcel: { weightGrams: 300 }, accountId: 'test', rateId: 'test-standard' } });
    expect(bought.shopmeShippingLabelPurchase.userErrors).toEqual([]);
    expect(bought.shopmeShippingLabelPurchase.label.fulfillmentId).toBe(fid);
    const o = await fulfillmentStatus(order.id);
    expect(o.fulfillments.find((f: { id: string }) => f.id === fid).trackingInfo[0].number).toBe(bought.shopmeShippingLabelPurchase.label.trackingNumber);
    const again = await g(BUY, { i: { orderId: oid, fulfillmentId: fid, parcel: { weightGrams: 300 }, accountId: 'test', rateId: 'test-standard' } });
    expect(again.shopmeShippingLabelPurchase.userErrors[0].message).toMatch(/already has a label/);
  });
});

describe('buying shipping labels from an HTTP carrier account', () => {
  let server: Server;
  const seen: Array<Record<string, any>> = [];
  beforeAll(async () => {
    process.env.WEBHOOKS_ALLOW_PRIVATE = '1'; // the carrier below listens on loopback
    server = createServer((req, res) => {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        const j = JSON.parse(body) as Record<string, any>;
        seen.push({ ...j, auth: req.headers.authorization });
        res.setHeader('content-type', 'application/json');
        if (j.action === 'label_rates') return res.end(JSON.stringify({ rates: [{ id: 'eco', service: 'economy', name: 'Economy', price: 450, currency: 'EUR', estimatedDays: 4 }, { id: 'broken' }] }));
        if (j.action === 'label_purchase') return j.rateId === 'eco' ? res.end(JSON.stringify({ labelId: 'L-1', trackingNumber: 'AC123456789', trackingUrl: 'https://track.example/AC123456789', service: 'economy', name: 'Economy', price: 460, currency: 'EUR', label: { format: 'PDF', url: 'https://labels.example/L-1.pdf' } })) : (res.statusCode = 422, res.end(JSON.stringify({ error: 'Rate expired' })));
        if (j.action === 'label_void') return res.end(JSON.stringify({ voided: true, refunded: false }));
        res.end(JSON.stringify({ price: 500 }));
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    const port = (server.address() as { port: number }).port;
    expect((await g(CONFIG, { v: { carrierAccounts: [{ id: 'acme', provider: 'http', name: 'Acme Post', endpoint: `http://127.0.0.1:${port}/carrier`, secret: 'tok', labels: true }] } })).shopmeConfigUpdate.userErrors).toEqual([]);
  });
  afterAll(() => { server.close(); delete process.env.WEBHOOKS_ALLOW_PRIVATE; });

  it('follows the documented JSON contract', async () => {
    const order = await newOrder('HEB-250', 1);
    const oid = gid('Order', order.id);
    const r = (await g(RATES, { i: { orderId: oid, parcel: { weightGrams: 800 } } })).shopmeShippingLabelRates;
    expect(r.rates).toEqual([{ accountId: 'acme', accountName: 'Acme Post', test: false, rateId: 'eco', service: 'economy', name: 'Economy', price: '4.5', currencyCode: 'EUR', estimatedDays: 4 }]);
    const ask = seen.find((x) => x.action === 'label_rates')!;
    expect(ask.auth).toBe('Bearer tok');
    expect(ask.shipment).toMatchObject({ reference: order.name, currency: 'EUR', parcel: { weightGrams: 800 }, shipTo: { name: 'Ada Lovelace', city: 'Paris', zip: '75001', countryCode: 'FR' } });
    expect(ask.shipment.shipTo.email).toBeUndefined();
    expect(ask.shipment.items[0]).toMatchObject({ quantity: 1 });
    const expired = await g(BUY, { i: { orderId: oid, parcel: { weightGrams: 800 }, accountId: 'acme', rateId: 'old' } });
    expect(expired.shopmeShippingLabelPurchase.userErrors[0].message).toBe('Acme Post: Rate expired');
    const bought = await g(BUY, { i: { orderId: oid, parcel: { weightGrams: 800 }, accountId: 'acme', rateId: 'eco' } });
    expect(bought.shopmeShippingLabelPurchase.label).toMatchObject({ carrier: 'Acme Post', trackingNumber: 'AC123456789', trackingUrl: 'https://track.example/AC123456789', cost: '4.6', labelUrl: 'https://labels.example/L-1.pdf', test: false });
    const voided = await g(VOID, { id: bought.shopmeShippingLabelPurchase.label.id });
    expect(voided.shopmeShippingLabelVoid.label).toMatchObject({ status: 'VOIDED', refundStatus: 'NOT_REFUNDED' });
    expect(seen.find((x) => x.action === 'label_void')).toMatchObject({ labelId: 'L-1', trackingNumber: 'AC123456789' });
  });
});
