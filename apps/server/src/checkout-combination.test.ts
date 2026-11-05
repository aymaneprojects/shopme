import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { createLocalStorage, creditStoreCredit, createShippingZone, findStoreCreditAccount, getPrimaryShop, liveBalance, schema as s, seedDemo } from '@shopme/core';
import { createTestApp, SETUP_BODY, type TestApp } from './test-utils';
import { makeGql, makeGqlOk } from '../test/conformance/helpers';

/** Shop in EUR; Canada sells in CAD at 1 EUR = 1.5 CAD; a delivery profile rate of 10.00 EUR to Canada; the buyer holds 10.00 EUR of store credit. */
const ADDRESS_CA = { firstName: 'Ada', lastName: 'Lovelace', address1: '1 Main St', city: 'Toronto', zip: 'M5V 2T6', countryCode: 'CA', provinceCode: 'ON', phone: '' };
let t: TestApp;
let shopId: number;
const sku: Record<string, number> = {};
const db = () => t.dbHandle.db;

beforeAll(async () => {
  t = await createTestApp();
  const setup = await t.app.inject({ method: 'POST', url: '/admin/api/setup', payload: SETUP_BODY });
  const g = makeGqlOk(makeGql(t.app, setup.cookies.find((c) => c.name === 'shopme_session')!.value));
  await seedDemo(db(), createLocalStorage(mkdtempSync(path.join(tmpdir(), 'combo-'))));
  shopId = (await getPrimaryShop(db()))!.id;
  for (const v of await db().select().from(s.productVariants)) if (v.sku) sku[v.sku] = v.id;
  const created = await g(`mutation($i: MarketCreateInput!) { marketCreate(input: $i) { market { id } userErrors { code } } }`, {
    i: { name: 'Canada', status: 'ACTIVE', conditions: { regionsCondition: { regions: [{ countryCode: 'CA' }] } }, currencySettings: { baseCurrency: 'CAD', baseCurrencyManualRate: '1.5', roundingEnabled: true } },
  });
  expect(created.marketCreate.userErrors).toEqual([]);
  const zone = await createShippingZone(db(), shopId, { name: 'Canada', countries: [{ countryCode: 'CA' }], rates: [{ name: 'Canada post', type: 'FLAT', price: 1000 }] });
  if (!zone.ok) throw new Error('shipping zone');
  const [shop] = await db().select().from(s.shops).where(eq(s.shops.id, shopId));
  await db().update(s.shops).set({ settings: { ...shop!.settings, storeCredit: { enabled: true } } }).where(eq(s.shops.id, shopId));
}, 90_000);
afterAll(async () => { await t.close(); });

describe('presentment currency, delivery profile rate and store credit in one checkout', () => {
  it('spends shop-money credit at the cart rate and records shop and presentment money', async () => {
    const reg = await t.app.inject({ method: 'POST', url: '/account/register', payload: new URLSearchParams({ 'customer[email]': 'combo@example.com', 'customer[password]': 'correct horse', 'customer[first_name]': 'Ada' }).toString(), headers: { 'content-type': 'application/x-www-form-urlencoded' } });
    const customerCookie = reg.cookies.find((c) => c.name === 'shopme_customer')!.value;
    const [customer] = await db().select().from(s.customers).where(eq(s.customers.email, 'combo@example.com'));
    expect((await creditStoreCredit(db(), shopId, { customerId: customer!.id, amount: 1000, currency: 'EUR' })).ok).toBe(true);

    const price = (await db().select().from(s.productVariants).where(eq(s.productVariants.id, sku['HEB-250']!)))[0]!.price;
    const unit = Math.ceil((price * 1.5) / 100) * 100;
    const cookies = { shopme_country: 'CA', shopme_customer: customerCookie };
    const add = await t.app.inject({ method: 'POST', url: '/cart/add.js', payload: { id: sku['HEB-250'], quantity: 2 }, cookies });
    const cart = add.cookies.find((c) => c.name === 'cart')!.value;
    const go = await t.app.inject({ method: 'POST', url: '/checkout', cookies: { ...cookies, cart } });
    const token = go.headers.location!.toString().split('/').pop()!;

    const total = unit * 2 + 1500; // 10.00 EUR shipping = 15.00 CAD, no tax in Canada
    const page = await t.app.inject({ url: `/checkouts/${token}`, cookies });
    expect(page.body).toContain('store-credit-box');
    const refreshed = (await t.app.inject({ method: 'POST', url: `/checkouts/${token}/refresh`, cookies, payload: { ...ADDRESS_CA, email: 'combo@example.com', storeCreditField: '1', useStoreCredit: '1' } })).json() as { amount: number; total: string; summary: string };
    expect(refreshed.summary).toContain('Store credit');
    expect(refreshed.amount).toBe(total - 1500); // 10.00 EUR of credit is 15.00 CAD

    const done = await t.app.inject({
      method: 'POST', url: `/checkouts/${token}/complete`, cookies, headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: new URLSearchParams({ ...ADDRESS_CA, email: 'combo@example.com', paymentMethod: 'bank_transfer', storeCreditField: '1', useStoreCredit: '1' }).toString(),
    });
    expect(done.statusCode).toBe(303);
    const order = (await db().select().from(s.orders).where(eq(s.orders.cartToken, token)))[0]!;
    expect(order).toMatchObject({ currency: 'EUR', presentmentCurrency: 'CAD', currencyRate: 1.5, totalShipping: 1000 });
    expect(order.presentmentMoney).toMatchObject({ subtotal: unit * 2, shipping: 1500, total });
    const txs = await db().select().from(s.transactions).where(eq(s.transactions.orderId, order.id)).orderBy(s.transactions.id);
    const credit = txs.find((x) => x.gateway === 'store_credit')!;
    const cash = txs.find((x) => x.gateway === 'bank_transfer')!;
    expect(credit).toMatchObject({ amount: 1000, currency: 'EUR', presentmentAmount: 1500, presentmentCurrency: 'CAD' });
    expect(cash).toMatchObject({ amount: order.total - 1000, presentmentAmount: total - 1500, presentmentCurrency: 'CAD' });
    const account = (await findStoreCreditAccount(db(), shopId, customer!.id, 'EUR'))!;
    expect(await liveBalance(db(), account.id)).toBe(0);
  });
});
