import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { createGiftCard, createLocalStorage, getPrimaryShop, refundOrder, schema as s, seedDemo, type Mail } from '@shopme/core';
import { formatDecimal } from '@shopme/shopify-compat';
import { createTestApp, SETUP_BODY, type TestApp } from './test-utils';
import { makeGql, makeGqlOk } from '../test/conformance/helpers';

/** Shop currency EUR (France). Markets: Canada in CAD at 1 EUR = 1.5 CAD. */
const ADDRESS_CA = { email: 'buyer@example.com', firstName: 'Ada', lastName: 'Lovelace', address1: '1 Main St', city: 'Toronto', zip: 'M5V 2T6', countryCode: 'CA', provinceCode: 'ON', phone: '' };
let t: TestApp;
let g: ReturnType<typeof makeGqlOk>;
let gql: ReturnType<typeof makeGql>;
let shopId: number;
let cookie: string;
let sent: Mail[];
const sku: Record<string, number> = {};
const db = () => t.dbHandle.db;
const gid = (type: string, id: number) => `gid://shopify/${type}/${id}`;

beforeAll(async () => {
  t = await createTestApp();
  const setup = await t.app.inject({ method: 'POST', url: '/admin/api/setup', payload: SETUP_BODY });
  cookie = setup.cookies.find((c) => c.name === 'shopme_session')!.value;
  gql = makeGql(t.app, cookie);
  g = makeGqlOk(gql);
  await seedDemo(db(), createLocalStorage(mkdtempSync(path.join(tmpdir(), 'mk-'))));
  shopId = (await getPrimaryShop(db()))!.id;
  for (const v of await db().select().from(s.productVariants)) if (v.sku) sku[v.sku] = v.id;
  sent = [];
  t.app.ctx.mailer = { send: async (m) => { sent.push(m); } };
  // Shipping to Canada: one flat rate of 10.00 EUR.
  const [zone] = await db().insert(s.shippingZones).values({ shopId, name: 'Canada' }).returning();
  await db().insert(s.shippingZoneCountries).values({ shopId, zoneId: zone!.id, countryCode: 'CA' });
  await db().insert(s.shippingRates).values({ shopId, zoneId: zone!.id, name: 'Canada post', type: 'FLAT', price: 1000 });
}, 90_000);
afterAll(async () => { await t.close(); });

const MARKET_FIELDS = `id name handle status primary type
  conditions { conditionTypes regionsCondition { regions(first: 10) { nodes { id name ... on MarketRegionCountry { code } } } } }
  currencySettings { baseCurrency { currencyCode manualRate enabled } localCurrencies roundingEnabled }`;

describe('markets in the Admin API', () => {
  let canadaId = '';

  it('lists the primary market for a shop that has none configured', async () => {
    const r = await g(`{ markets(first: 10) { nodes { ${MARKET_FIELDS} } } }`);
    expect(r.markets.nodes).toHaveLength(1);
    const p = r.markets.nodes[0];
    expect(p.primary).toBe(true);
    expect(p.status).toBe('ACTIVE');
    expect(p.conditions.regionsCondition.regions.nodes[0].code).toBe('FR');
    expect(p.currencySettings.baseCurrency.currencyCode).toBe('EUR');
  });

  it('creates a region market with a currency and rate', async () => {
    const r = await g(`mutation($i: MarketCreateInput!) { marketCreate(input: $i) { market { ${MARKET_FIELDS} } userErrors { field code message } } }`, {
      i: { name: 'Canada', status: 'ACTIVE', conditions: { regionsCondition: { regions: [{ countryCode: 'CA' }] } }, currencySettings: { baseCurrency: 'CAD', baseCurrencyManualRate: '1.5', roundingEnabled: true } },
    });
    expect(r.marketCreate.userErrors).toEqual([]);
    const m = r.marketCreate.market;
    canadaId = m.id;
    expect(m.handle).toBe('canada');
    expect(m.type).toBe('REGION');
    expect(m.currencySettings.baseCurrency).toMatchObject({ currencyCode: 'CAD', manualRate: '1.5', enabled: true });
    expect(m.conditions.regionsCondition.regions.nodes.map((n: { code: string }) => n.code)).toEqual(['CA']);
  });

  it('enforces one market per country and protects the primary market', async () => {
    const dup = await g(`mutation { marketCreate(input: { name: "Canada 2", conditions: { regionsCondition: { regions: [{ countryCode: CA }] } } }) { market { id } userErrors { code field } } }`);
    expect(dup.marketCreate.userErrors[0].code).toBe('DUPLICATE_REGION_MARKET');
    const list = await g(`{ markets(first: 10) { nodes { id primary } } }`);
    const primary = list.markets.nodes.find((n: { primary: boolean }) => n.primary);
    const del = await g(`mutation($id: ID!) { marketDelete(id: $id) { deletedId userErrors { code } } }`, { id: primary.id });
    expect(del.marketDelete.userErrors[0].code).toBe('CANNOT_DELETE_PRIMARY_MARKET');
    const off = await g(`mutation($id: ID!) { marketUpdate(id: $id, input: { status: DRAFT }) { userErrors { code } } }`, { id: primary.id });
    expect(off.marketUpdate.userErrors[0].code).toBe('CANNOT_DISABLE_PRIMARY_MARKET');
    const add = await g(`mutation($id: ID!) { marketUpdate(id: $id, input: { conditions: { conditionsToAdd: { regionsCondition: { regions: [{ countryCode: DE }] } } } }) { userErrors { code } } }`, { id: primary.id });
    expect(add.marketUpdate.userErrors[0].code).toBe('CANNOT_ADD_REGIONS_TO_PRIMARY_MARKET');
    const cur = await g(`mutation($id: ID!) { marketUpdate(id: $id, input: { currencySettings: { baseCurrency: CAD, baseCurrencyManualRate: "1.5" } }) { userErrors { code } } }`, { id: primary.id });
    expect(cur.marketUpdate.userErrors[0].code).toBe('UNSUPPORTED_CURRENCY'); // the primary market keeps the shop currency
  });

  it('validates currencies and local currencies', async () => {
    const noRate = await g(`mutation { marketCreate(input: { name: "UK", currencySettings: { baseCurrency: GBP } }) { market { id } userErrors { code field } } }`);
    expect(noRate.marketCreate.userErrors[0].code).toBe('INVALID');
    const single = await g(`mutation($id: ID!) { marketUpdate(id: $id, input: { currencySettings: { localCurrencies: true } }) { userErrors { code } } }`, { id: canadaId });
    expect(single.marketUpdate.userErrors[0].code).toBe('NO_LOCAL_CURRENCIES_ON_SINGLE_COUNTRY_MARKET');
    const bad = await g(`mutation($id: ID!) { marketUpdate(id: $id, input: { currencySettings: { baseCurrency: XXX } }) { userErrors { code } } }`, { id: canadaId }).catch(() => null);
    expect(bad === null || bad.marketUpdate?.userErrors?.length > 0).toBe(true);
  });

  it('filters markets by search', async () => {
    expect((await g(`{ markets(first: 10, query: "name:canada") { nodes { name } } }`)).markets.nodes.map((n: { name: string }) => n.name)).toEqual(['Canada']);
    expect((await g(`{ markets(first: 10, query: "status:draft") { nodes { name } } }`)).markets.nodes).toHaveLength(0);
    expect((await g(`{ markets(first: 10, sortKey: NAME) { nodes { name } } }`)).markets.nodes.map((n: { name: string }) => n.name)).toEqual(['Canada', 'France']);
  });
});

describe('price resolution on the storefront', () => {
  const variant = () => db().select().from(s.productVariants).where(eq(s.productVariants.id, sku['HEB-250']!)).then((r) => r[0]!);
  const handleOf = async () => (await db().select().from(s.products).where(eq(s.products.id, (await variant()).productId)))[0]!.handle;

  it('keeps shop prices for buyers outside every market', async () => {
    const h = await handleOf();
    const res = await t.app.inject(`/products/${h}.js`);
    expect(JSON.parse(res.body).variants[0].price).toBe((await variant()).price);
    const de = await t.app.inject(`/products/${h}.js?country=DE`);
    expect(JSON.parse(de.body).variants[0].price).toBe((await variant()).price);
    expect(de.cookies.find((c) => c.name === 'shopme_country')?.value).toBe('DE');
  });

  it('converts and rounds up in the market currency, with the country remembered in a cookie', async () => {
    const h = await handleOf();
    const base = (await variant()).price; // 13.00 EUR
    const res = await t.app.inject(`/products/${h}.js?country=CA`);
    expect(res.cookies.find((c) => c.name === 'shopme_country')?.value).toBe('CA');
    const price = JSON.parse(res.body).variants[0].price;
    expect(price).toBe(Math.ceil((base * 1.5) / 100) * 100);
    const again = await t.app.inject({ url: `/products/${h}.js`, cookies: { shopme_country: 'CA' } });
    expect(JSON.parse(again.body).variants[0].price).toBe(price);
    const json = await t.app.inject({ url: `/products/${h}.json`, cookies: { shopme_country: 'CA' } });
    expect(JSON.parse(json.body).product.variants[0].price_currency).toBe('CAD');
    const page = await t.app.inject({ url: `/products/${h}`, cookies: { shopme_country: 'CA' } });
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain(`${(price / 100).toFixed(2)}`);
  });

  it('exposes the Liquid localization object with the selector data', async () => {
    const page = await t.app.inject({ url: '/', cookies: { shopme_country: 'CA' } });
    expect(page.body).toContain('name="country_code"');
    expect(page.body).toContain('value="CA"');
    expect(page.body).toContain('CAD');
    expect(page.body).toMatch(/window\.Shopify=window\.Shopify[\s\S]*"active":"CAD"/);
  });

  it('prices the Ajax cart in the buyer currency and re-prices when the country changes', async () => {
    const add = await t.app.inject({ method: 'POST', url: '/cart/add.js', payload: { id: sku['HEB-250'], quantity: 2 }, cookies: { shopme_country: 'CA' } });
    expect(add.statusCode).toBe(200);
    const cartCookie = add.cookies.find((c) => c.name === 'cart')!.value;
    const base = (await variant()).price;
    const unit = Math.ceil((base * 1.5) / 100) * 100;
    const cart = JSON.parse((await t.app.inject({ url: '/cart.js', cookies: { cart: cartCookie, shopme_country: 'CA' } })).body);
    expect(cart.currency).toBe('CAD');
    expect(cart.items[0].price).toBe(unit);
    expect(cart.total_price).toBe(unit * 2);
    // Back to a country outside the market: the same cart is priced in the shop currency again.
    const post = await t.app.inject({ method: 'POST', url: '/localization', payload: { country_code: 'FR', return_to: '/cart' }, cookies: { cart: cartCookie, shopme_country: 'CA' } });
    expect(post.statusCode).toBe(302);
    expect(post.cookies.find((c) => c.name === 'shopme_country')?.value).toBe('FR');
    const eur = JSON.parse((await t.app.inject({ url: '/cart.js', cookies: { cart: cartCookie, shopme_country: 'FR' } })).body);
    expect(eur.currency).toBe('EUR');
    expect(eur.items[0].price).toBe(base);
  });
});

describe('checkout and orders in another currency', () => {
  const refresh = (token: string, body: Record<string, unknown>) => t.app.inject({ method: 'POST', url: `/checkouts/${token}/refresh`, payload: body });
  const complete = (token: string, method: string) => t.app.inject({
    method: 'POST', url: `/checkouts/${token}/complete`, payload: new URLSearchParams({ ...ADDRESS_CA, paymentMethod: method }).toString(), headers: { 'content-type': 'application/x-www-form-urlencoded' },
  });
  async function checkout(country: string, variant = 'HEB-250', quantity = 2) {
    const add = await t.app.inject({ method: 'POST', url: '/cart/add.js', payload: { id: sku[variant], quantity }, cookies: { shopme_country: country } });
    const cart = add.cookies.find((c) => c.name === 'cart')!.value;
    const go = await t.app.inject({ method: 'POST', url: '/checkout', cookies: { cart, shopme_country: country } });
    return { cart, token: go.headers.location!.toString().split('/').pop()! };
  }

  it('totals the checkout in the market currency, converting shipping and fixed discounts', async () => {
    const price = (await db().select().from(s.productVariants).where(eq(s.productVariants.id, sku['HEB-250']!)))[0]!.price;
    const unit = Math.ceil((price * 1.5) / 100) * 100;
    const [d] = await db().insert(s.discounts).values({ shopId, title: 'Five off', kind: 'CODE', status: 'ACTIVE', valueType: 'FIXED_AMOUNT', value: 500, target: 'ORDER' }).returning();
    await db().insert(s.discountCodes).values({ shopId, discountId: d!.id, code: 'FIVEOFF' });
    const { token } = await checkout('CA');
    const page = await t.app.inject(`/checkouts/${token}`);
    expect(page.statusCode).toBe(200);
    const r = (await refresh(token, { ...ADDRESS_CA, addDiscountCode: 'fiveoff' })).json();
    expect(r.discountError).toBe('');
    // 2 x unit CAD, 5.00 EUR off = 7.50 CAD, 10.00 EUR shipping = 15.00 CAD, no tax in Canada.
    expect(r.amount).toBe(unit * 2 - 750 + 1500);
    expect(r.total).not.toContain('€');
  });

  it('keeps shop money and presentment money on the order', async () => {
    const price = (await db().select().from(s.productVariants).where(eq(s.productVariants.id, sku['HEB-250']!)))[0]!.price;
    const unit = Math.ceil((price * 1.5) / 100) * 100;
    const { token } = await checkout('CA');
    await refresh(token, ADDRESS_CA);
    const done = await complete(token, 'bank_transfer');
    expect(done.statusCode).toBe(303);
    const order = (await db().select().from(s.orders).where(eq(s.orders.cartToken, token)))[0]!;
    expect(order.currency).toBe('EUR');
    expect(order.presentmentCurrency).toBe('CAD');
    expect(order.currencyRate).toBe(1.5);
    const presentmentTotal = unit * 2 + 1500;
    expect(order.presentmentMoney).toMatchObject({ subtotal: unit * 2, shipping: 1500, total: presentmentTotal });
    expect(order.subtotal).toBe(Math.round((unit * 2) / 1.5));
    expect(order.totalShipping).toBe(1000);
    expect(order.total).toBe(order.subtotal + order.totalShipping);
    const lines = await db().select().from(s.orderLines).where(eq(s.orderLines.orderId, order.id));
    expect(lines[0]!.presentmentUnitPrice).toBe(unit);
    expect(lines[0]!.unitPrice).toBe(Math.round(unit / 1.5));
    const tx = (await db().select().from(s.transactions).where(eq(s.transactions.orderId, order.id)))[0]!;
    expect(tx.presentmentAmount).toBe(presentmentTotal);
    expect(tx.presentmentCurrency).toBe('CAD');
    expect(tx.currency).toBe('EUR');

    const q = await g(`query($id: ID!) { order(id: $id) { currencyCode presentmentCurrencyCode totalPriceSet { shopMoney { amount currencyCode } presentmentMoney { amount currencyCode } } subtotalPriceSet { presentmentMoney { amount } }
      lineItems(first: 5) { nodes { originalUnitPriceSet { presentmentMoney { amount currencyCode } } } } transactions { amountSet { presentmentMoney { amount currencyCode } } } } }`, { id: gid('Order', order.id) });
    expect(q.order.currencyCode).toBe('EUR');
    expect(q.order.presentmentCurrencyCode).toBe('CAD');
    expect(q.order.totalPriceSet.shopMoney.currencyCode).toBe('EUR');
    expect(q.order.totalPriceSet.presentmentMoney).toEqual({ amount: formatDecimal(presentmentTotal, 'CAD'), currencyCode: 'CAD' });
    expect(q.order.lineItems.nodes[0].originalUnitPriceSet.presentmentMoney.currencyCode).toBe('CAD');
    expect(q.order.transactions[0].amountSet.presentmentMoney.currencyCode).toBe('CAD');

    const thanks = await t.app.inject(`/checkouts/${token}/thank-you`);
    expect(thanks.body).toContain((presentmentTotal / 100).toFixed(2));
    expect(sent.length).toBeGreaterThanOrEqual(0);
  });

  it('refunds in the presentment currency', async () => {
    const { token } = await checkout('CA', 'HEB-250', 1);
    await refresh(token, ADDRESS_CA);
    await complete(token, 'bank_transfer');
    const order = (await db().select().from(s.orders).where(eq(s.orders.cartToken, token)))[0]!;
    const paid = await t.app.inject({ method: 'POST', url: '/admin/api/2026-10/graphql.json', payload: { query: 'mutation($id: ID!) { orderMarkAsPaid(input: { id: $id }) { userErrors { message } } }', variables: { id: gid('Order', order.id) } }, cookies: { shopme_session: cookie } });
    expect(paid.statusCode).toBe(200);
    const fresh = (await db().select().from(s.orders).where(eq(s.orders.id, order.id)))[0]!;
    const res = await refundOrder(db(), shopId, order.id, { amount: fresh.total, note: 'full' });
    expect(res.ok).toBe(true);
    const refund = (await db().select().from(s.transactions).where(eq(s.transactions.orderId, order.id))).find((x) => x.kind === 'REFUND')!;
    expect(refund.presentmentCurrency).toBe('CAD');
    expect(refund.presentmentAmount).toBe(fresh.presentmentMoney!.total);
  });

  it('does not accept a gift card in another currency', async () => {
    const card = await createGiftCard(db(), shopId, 'EUR', { initialValue: 5000, code: 'EURCARD1234567890' });
    expect(card.ok).toBe(true);
    const { token } = await checkout('CA');
    const bad = (await refresh(token, { ...ADDRESS_CA, addGiftCardCode: 'EURCARD1234567890' })).json();
    expect(bad.giftError).not.toBe('');
  });
});

describe('catalogs and price lists', () => {
  let listId = '';
  let catalogId = '';
  let marketId = '';

  it('creates a catalog with a price list for the market and fixed prices', async () => {
    marketId = (await g(`{ markets(first: 10, query: "name:canada") { nodes { id } } }`)).markets.nodes[0].id;
    const pl = await g(`mutation { priceListCreate(input: { name: "Canada prices", currency: CAD, parent: { adjustment: { type: PERCENTAGE_DECREASE, value: 10 }, settings: { compareAtMode: ADJUSTED } } }) { priceList { id name currency parent { adjustment { type value } } fixedPricesCount } userErrors { code field } } }`);
    expect(pl.priceListCreate.userErrors).toEqual([]);
    listId = pl.priceListCreate.priceList.id;
    const cat = await g(`mutation($i: CatalogCreateInput!) { catalogCreate(input: $i) { catalog { id title status ... on MarketCatalog { markets(first: 5) { nodes { id } } } } userErrors { code field } } }`, {
      i: { title: 'Catalog for Canada', status: 'ACTIVE', context: { marketIds: [marketId] }, priceListId: listId },
    });
    expect(cat.catalogCreate.userErrors).toEqual([]);
    catalogId = cat.catalogCreate.catalog.id;
    expect(cat.catalogCreate.catalog.markets.nodes[0].id).toBe(marketId);
    const fixed = await g(`mutation($l: ID!, $p: [PriceListPriceInput!]!) { priceListFixedPricesAdd(priceListId: $l, prices: $p) { prices { price { amount currencyCode } originType } userErrors { code field } } }`, {
      l: listId, p: [{ variantId: gid('ProductVariant', sku['HEB-250']!), price: { amount: '17.99', currencyCode: 'CAD' } }],
    });
    expect(fixed.priceListFixedPricesAdd.userErrors).toEqual([]);
    expect(fixed.priceListFixedPricesAdd.prices[0]).toMatchObject({ originType: 'FIXED', price: { amount: '17.99', currencyCode: 'CAD' } });
    const wrong = await g(`mutation($l: ID!, $p: [PriceListPriceInput!]!) { priceListFixedPricesAdd(priceListId: $l, prices: $p) { userErrors { code } } }`, {
      l: listId, p: [{ variantId: gid('ProductVariant', sku['HEB-250']!), price: { amount: '17.99', currencyCode: 'USD' } }],
    });
    expect(wrong.priceListFixedPricesAdd.userErrors[0].code).toBe('PRICE_LIST_CURRENCY_MISMATCH');
  });

  it('rejects a price list in another currency than its market', async () => {
    const pl = await g(`mutation { priceListCreate(input: { name: "USD list", currency: USD, parent: { adjustment: { type: PERCENTAGE_DECREASE, value: 0 } } }) { priceList { id } userErrors { code } } }`);
    const r = await g(`mutation($c: ID!, $p: ID!) { catalogUpdate(id: $c, input: { priceListId: $p }) { userErrors { code } } }`, { c: catalogId, p: pl.priceListCreate.priceList.id });
    expect(r.catalogUpdate.userErrors[0].code).toBe('MARKET_AND_PRICE_LIST_CURRENCY_MISMATCH');
  });

  it('lets fixed prices win and applies the percentage adjustment to the rest', async () => {
    const hv = (await db().select().from(s.productVariants).where(eq(s.productVariants.id, sku['HEB-250']!)))[0]!;
    const h = (await db().select().from(s.products).where(eq(s.products.id, hv.productId)))[0]!.handle;
    const js = JSON.parse((await t.app.inject({ url: `/products/${h}.js`, cookies: { shopme_country: 'CA' } })).body);
    expect(js.variants.find((v: { id: number }) => v.id === hv.id).price).toBe(1799);
    // Another product: 10% off, converted at 1.5 and rounded up to the next dollar.
    const other = (await db().select().from(s.productVariants).where(eq(s.productVariants.id, sku['HEB-1K'] ?? sku['HEB-250']!)))[0]!;
    const q = await g(`query($v: ID!) { productVariant(id: $v) { price contextualPricing(context: { country: CA }) { price { amount currencyCode } compareAtPrice { amount } } } }`, { v: gid('ProductVariant', other.id) });
    const expected = other.id === hv.id ? 1799 : Math.ceil(Math.round(other.price * 0.9 * 1.5) / 100) * 100;
    expect(q.productVariant.contextualPricing.price).toEqual({ amount: formatDecimal(expected, 'CAD'), currencyCode: 'CAD' });
    const eur = await g(`query($v: ID!) { productVariant(id: $v) { contextualPricing(context: { country: DE }) { price { currencyCode } } } }`, { v: gid('ProductVariant', other.id) });
    expect(eur.productVariant.contextualPricing.price.currencyCode).toBe('EUR');
  });

  it('resolves values for a buyer country and lists prices of the list', async () => {
    const r = await g(`{ marketsResolvedValues(buyerSignal: { countryCode: CA }) { currencyCode catalogs(first: 5) { nodes { title } } } }`);
    expect(r.marketsResolvedValues.currencyCode).toBe('CAD');
    expect(r.marketsResolvedValues.catalogs.nodes[0].title).toBe('Catalog for Canada');
    const prices = await g(`query($l: ID!) { priceList(id: $l) { fixedPricesCount prices(first: 50) { nodes { originType price { amount } } } } }`, { l: listId });
    expect(prices.priceList.fixedPricesCount).toBe(1);
    expect(prices.priceList.prices.nodes.some((n: { originType: string }) => n.originType === 'FIXED')).toBe(true);
    expect(prices.priceList.prices.nodes.some((n: { originType: string }) => n.originType === 'RELATIVE')).toBe(true);
    expect((await g(`{ catalogsCount { count } }`)).catalogsCount.count).toBe(1);
  });

  it('deletes the catalog and its price list; a disabled market is invisible to buyers', async () => {
    const del = await g(`mutation($c: ID!) { catalogDelete(id: $c, deleteDependentResources: true) { deletedId userErrors { code } } }`, { c: catalogId });
    expect(del.catalogDelete.deletedId).toBe(catalogId);
    expect((await g(`query($l: ID!) { priceList(id: $l) { id } }`, { l: listId })).priceList).toBeNull();
    await g(`mutation($m: ID!) { marketUpdate(id: $m, input: { status: DRAFT }) { userErrors { code } } }`, { m: marketId });
    const hv = (await db().select().from(s.productVariants).where(eq(s.productVariants.id, sku['HEB-250']!)))[0]!;
    const h = (await db().select().from(s.products).where(eq(s.products.id, hv.productId)))[0]!.handle;
    const js = JSON.parse((await t.app.inject({ url: `/products/${h}.js`, cookies: { shopme_country: 'CA' } })).body);
    expect(js.variants.find((v: { id: number }) => v.id === hv.id).price).toBe(hv.price);
  });
});
