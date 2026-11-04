import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, setupAndLogin, type TestApp } from '../../../src/test-utils';
import { makeGql, makeGqlOk } from '../helpers';
import { seedCatalog } from '../seed';
import { seedOrder, shopIdOf } from '../seed-sales';

describe('discounts, settings, content and dashboard API', () => {
  let t: TestApp;
  let gql: ReturnType<typeof makeGql>;
  let g: ReturnType<typeof makeGqlOk>;
  let cat: Awaited<ReturnType<typeof seedCatalog>>;

  beforeAll(async () => {
    t = await createTestApp();
    gql = makeGql(t.app, await setupAndLogin(t.app));
    g = makeGqlOk(gql);
    cat = await seedCatalog(g);
  }, 120_000);
  afterAll(async () => { await t.close(); });

  it('creates, updates, deactivates and deletes code discounts', async () => {
    const created = await g(`mutation { discountCodeBasicCreate(basicCodeDiscount: { title: "Summer", code: "summer10", startsAt: "2020-01-01T00:00:00Z", usageLimit: 5, appliesOncePerCustomer: true,
      minimumRequirement: { subtotal: { greaterThanOrEqualToSubtotal: "50.00" } }, customerGets: { value: { percentage: 0.1 }, items: { all: true } } }) {
      codeDiscountNode { id codeDiscount { __typename ... on DiscountCodeBasic { title status usageLimit appliesOncePerCustomer asyncUsageCount summary codes(first: 5) { nodes { code asyncUsageCount } } codesCount { count }
        minimumRequirement { __typename ... on DiscountMinimumSubtotal { greaterThanOrEqualToSubtotal { amount currencyCode } } }
        customerGets { value { __typename ... on DiscountPercentage { percentage } } items { __typename } } } } }
      userErrors { field message code } } }`);
    expect(created.discountCodeBasicCreate.userErrors).toEqual([]);
    const node = created.discountCodeBasicCreate.codeDiscountNode;
    expect(node.id).toMatch(/^gid:\/\/shopify\/DiscountCodeNode\/\d+$/);
    expect(node.codeDiscount).toMatchObject({
      __typename: 'DiscountCodeBasic', title: 'Summer', status: 'ACTIVE', usageLimit: 5, appliesOncePerCustomer: true, asyncUsageCount: 0, codes: { nodes: [{ code: 'SUMMER10', asyncUsageCount: 0 }] },
      minimumRequirement: { __typename: 'DiscountMinimumSubtotal', greaterThanOrEqualToSubtotal: { amount: '50.0', currencyCode: 'EUR' } },
      customerGets: { value: { __typename: 'DiscountPercentage', percentage: 0.1 }, items: { __typename: 'AllDiscountItems' } },
    });

    const dup = await g(`mutation { discountCodeBasicCreate(basicCodeDiscount: { code: "SUMMER10", customerGets: { value: { percentage: 0.2 }, items: { all: true } } }) { codeDiscountNode { id } userErrors { field message code } } }`);
    expect(dup.discountCodeBasicCreate.userErrors).toEqual([{ field: ['basicCodeDiscount', 'code'], message: 'Discount code must be unique. Please try a different code.', code: 'TAKEN' }]);
    const range = await g(`mutation { discountCodeBasicCreate(basicCodeDiscount: { code: "BAD", customerGets: { value: { percentage: 1.5 }, items: { all: true } } }) { userErrors { code } } }`);
    expect(range.discountCodeBasicCreate.userErrors[0].code).toBe('VALUE_OUTSIDE_RANGE');
    const both = await g(`mutation { discountCodeBasicCreate(basicCodeDiscount: { code: "BOTH", minimumRequirement: { quantity: { greaterThanOrEqualToQuantity: "2" }, subtotal: { greaterThanOrEqualToSubtotal: "5" } }, customerGets: { value: { percentage: 0.1 }, items: { all: true } } }) { userErrors { code } } }`);
    expect(both.discountCodeBasicCreate.userErrors[0].code).toBe('MINIMUM_SUBTOTAL_AND_QUANTITY_RANGE_BOTH_PRESENT');

    const fixed = await g(`mutation { discountCodeBasicCreate(basicCodeDiscount: { title: "Boards", code: "BOARD5", customerGets: { value: { discountAmount: { amount: "5.00", appliesOnEachItem: false } },
      items: { products: { productsToAdd: ["${cat.minimal.id}"] } } }, minimumRequirement: { quantity: { greaterThanOrEqualToQuantity: "2" } } }) {
      codeDiscountNode { id codeDiscount { ... on DiscountCodeBasic { customerGets { value { __typename ... on DiscountAmount { amount { amount currencyCode } } } items { __typename ... on DiscountProducts { products(first: 5) { nodes { title } } } } } minimumRequirement { __typename ... on DiscountMinimumQuantity { greaterThanOrEqualToQuantity } } } } } userErrors { message } } }`);
    expect(fixed.discountCodeBasicCreate.userErrors).toEqual([]);
    expect(fixed.discountCodeBasicCreate.codeDiscountNode.codeDiscount.customerGets).toMatchObject({
      value: { __typename: 'DiscountAmount', amount: { amount: '5.0', currencyCode: 'EUR' } }, items: { __typename: 'DiscountProducts', products: { nodes: [{ title: 'The Minimal Snowboard' }] } },
    });

    const free = await g(`mutation { discountCodeFreeShippingCreate(freeShippingCodeDiscount: { title: "Ship", code: "FREESHIP", startsAt: "2099-01-01T00:00:00Z", destination: { all: true } }) {
      codeDiscountNode { id codeDiscount { __typename ... on DiscountCodeFreeShipping { status destinationSelection { __typename } } } } userErrors { message } } }`);
    expect(free.discountCodeFreeShippingCreate.codeDiscountNode.codeDiscount).toEqual({ __typename: 'DiscountCodeFreeShipping', status: 'SCHEDULED', destinationSelection: { __typename: 'DiscountCountryAll' } });

    const upd = await g(`mutation { discountCodeBasicUpdate(id: "${node.id}", basicCodeDiscount: { title: "Summer 20", customerGets: { value: { percentage: 0.2 }, items: { all: true } }, endsAt: "2099-01-01T00:00:00Z" }) { codeDiscountNode { codeDiscount { ... on DiscountCodeBasic { title endsAt summary } } } userErrors { message } } }`);
    expect(upd.discountCodeBasicUpdate.codeDiscountNode.codeDiscount).toMatchObject({ title: 'Summer 20', summary: '20% off entire order' });

    const off = await g(`mutation { discountCodeDeactivate(id: "${node.id}") { codeDiscountNode { codeDiscount { ... on DiscountCodeBasic { status } } } userErrors { message } } }`);
    expect(off.discountCodeDeactivate.codeDiscountNode.codeDiscount.status).toBe('EXPIRED');
    const on = await g(`mutation { discountCodeActivate(id: "${node.id}") { codeDiscountNode { codeDiscount { ... on DiscountCodeBasic { status } } } } }`);
    expect(on.discountCodeActivate.codeDiscountNode.codeDiscount.status).toBe('ACTIVE');

    const list = async (q: string) => (await g(`{ codeDiscountNodes(first: 10, query: "${q}") { nodes { codeDiscount { ... on DiscountCodeBasic { title } ... on DiscountCodeFreeShipping { title } } } } discountNodesCount(query: "${q}") { count } }`));
    expect((await list('')).codeDiscountNodes.nodes).toHaveLength(3);
    expect((await list('status:scheduled')).codeDiscountNodes.nodes).toEqual([{ codeDiscount: { title: 'Ship' } }]);
    expect((await list('code:BOARD5')).discountNodesCount.count).toBe(1);
    expect((await list('type:free_shipping')).discountNodesCount.count).toBe(1);
    const byCode = await g(`{ codeDiscountNodeByCode(code: "freeship") { id } codeDiscountNode(id: "${node.id}") { id } discountNode(id: "${node.id}") { id discount { __typename } } }`);
    expect(byCode.codeDiscountNodeByCode.id).toBeTruthy();
    expect(byCode.discountNode.discount.__typename).toBe('DiscountCodeBasic');

    const del = await g(`mutation { discountCodeDelete(id: "${node.id}") { deletedCodeDiscountId userErrors { message } } }`);
    expect(del.discountCodeDelete.deletedCodeDiscountId).toBe(node.id);
    expect((await g(`{ codeDiscountNode(id: "${node.id}") { id } }`)).codeDiscountNode).toBeNull();
  });

  it('updates shop details and payment settings', async () => {
    const r = await g(`mutation { shopmeShopUpdate(input: { name: "Boutique", ianaTimezone: "Europe/Paris", weightUnit: GRAMS, taxesIncluded: true, taxShipping: true, description: "Hello",
      address: { address1: "1 Rue X", city: "Paris", zip: "75001", countryCode: FR, phone: "+33123456789" }, storefrontPasswordEnabled: true, storefrontPassword: "secret", storefrontPasswordMessage: "Soon", primaryDomain: "shop.example.com" }) {
      shop { name ianaTimezone weightUnit unitSystem taxesIncluded shopmeTaxShipping description primaryDomain { host } billingAddress { address1 city countryCodeV2 } shopmeStorefront { passwordEnabled password passwordMessage } }
      userErrors { field message } } }`);
    expect(r.shopmeShopUpdate.userErrors).toEqual([]);
    expect(r.shopmeShopUpdate.shop).toEqual({
      name: 'Boutique', ianaTimezone: 'Europe/Paris', weightUnit: 'GRAMS', unitSystem: 'METRIC_SYSTEM', taxesIncluded: true, shopmeTaxShipping: true, description: 'Hello', primaryDomain: { host: 'shop.example.com' },
      billingAddress: { address1: '1 Rue X', city: 'Paris', countryCodeV2: 'FR' }, shopmeStorefront: { passwordEnabled: true, password: 'secret', passwordMessage: 'Soon' },
    });
    const bad = await g(`mutation { shopmeShopUpdate(input: { ianaTimezone: "Mars/Base", email: "nope" }) { shop { name } userErrors { field message } } }`);
    expect(bad.shopmeShopUpdate.shop).toBeNull();
    const noPw = await g(`mutation { shopmeShopUpdate(input: { storefrontPassword: "" , storefrontPasswordEnabled: true }) { userErrors { field } } }`);
    expect(noPw.shopmeShopUpdate.userErrors[0].field).toEqual(['input', 'storefrontPassword']);
    expect((await g(`{ shop { name currencyFormats { moneyFormat } } }`)).shop.name).toBe('Boutique');
    const cur = await g(`mutation { shopmeShopUpdate(input: { currencyCode: USD }) { shop { currencyCode currencyFormats { moneyFormat } } userErrors { message } } }`);
    expect(cur.shopmeShopUpdate.shop).toEqual({ currencyCode: 'USD', currencyFormats: { moneyFormat: '$' + '{{amount}}' } });
    await g(`mutation { shopmeShopUpdate(input: { currencyCode: EUR }) { userErrors { message } } }`);

    const pay = await g(`mutation { shopmePaymentSettingsUpdate(input: { bankTransfer: { enabled: true, instructions: "IBAN FR76" }, cod: { enabled: true } }) { paymentSettings { bankTransfer { enabled instructions } cod { enabled } stripe { enabled stripeConfigured } } userErrors { message } } }`);
    expect(pay.shopmePaymentSettingsUpdate.paymentSettings).toEqual({ bankTransfer: { enabled: true, instructions: 'IBAN FR76' }, cod: { enabled: true }, stripe: { enabled: false, stripeConfigured: false } });
    const stripe = await g(`mutation { shopmePaymentSettingsUpdate(input: { stripe: { enabled: true } }) { paymentSettings { cod { enabled } } userErrors { field message } } }`);
    expect(stripe.shopmePaymentSettingsUpdate.paymentSettings).toBeNull();
    expect(stripe.shopmePaymentSettingsUpdate.userErrors[0].message).toMatch(/not configured/);
    expect((await g(`{ shopmePaymentSettings { bankTransfer { enabled } } staffMembers(first: 5) { nodes { email name isShopOwner } } }`)).staffMembers.nodes).toEqual([{ email: 'owner@example.com', name: 'owner@example.com', isShopOwner: true }]);
  });

  it('manages shipping zones, rates and tax rates', async () => {
    const z = await g(`mutation { shippingZoneCreate(input: { name: "Europe", countries: [{ countryCode: "FR" }, { countryCode: "DE" }], rates: [{ name: "Standard", type: FLAT, price: "5.90" }, { name: "Heavy", type: WEIGHT_BASED, price: "12", minWeight: 5000, maxWeight: 20000 }] }) {
      zone { id name countries { countryCode } rates { id name type price { amount } minWeight maxWeight } } userErrors { field message } } }`);
    expect(z.shippingZoneCreate.userErrors).toEqual([]);
    const zone = z.shippingZoneCreate.zone;
    expect(zone.countries).toEqual([{ countryCode: 'FR' }, { countryCode: 'DE' }]);
    expect(zone.rates[1]).toMatchObject({ name: 'Heavy', type: 'WEIGHT_BASED', price: { amount: '12.0' }, minWeight: 5000, maxWeight: 20000 });
    const rate = await g(`mutation { shippingRateCreate(zoneId: "${zone.id}", input: { name: "Free over 100", type: PRICE_BASED, price: "0", minSubtotal: "100.00" }) { rate { id type minSubtotal { amount } } userErrors { message } } }`);
    expect(rate.shippingRateCreate.rate).toMatchObject({ type: 'PRICE_BASED', minSubtotal: { amount: '100.0' } });
    const ru = await g(`mutation { shippingRateUpdate(id: "${zone.rates[0].id}", input: { price: "6.50", active: false }) { rate { price { amount } } userErrors { message } } }`);
    expect(ru.shippingRateUpdate.rate.price.amount).toBe('6.5');
    expect((await g(`mutation { shippingZoneCreate(input: { name: "" }) { zone { id } userErrors { field message } } }`)).shippingZoneCreate.userErrors[0].field).toEqual(['input', 'name']);
    const zu = await g(`mutation { shippingZoneUpdate(id: "${zone.id}", input: { name: "EU", countries: [{ countryCode: "*" }] }) { zone { name countries { countryCode } rates { id } } } }`);
    expect(zu.shippingZoneUpdate.zone).toMatchObject({ name: 'EU', countries: [{ countryCode: '*' }] });
    expect(zu.shippingZoneUpdate.zone.rates).toHaveLength(3);
    await g(`mutation { shippingRateDelete(id: "${rate.shippingRateCreate.rate.id}") { deletedRateId } }`);
    expect((await g(`{ shippingZones { name rates { id } } }`)).shippingZones[0].rates).toHaveLength(2);
    expect((await g(`mutation { shippingZoneDelete(id: "${zone.id}") { deletedZoneId } }`)).shippingZoneDelete.deletedZoneId).toBe(zone.id);
    expect((await g(`{ shippingZones { id } }`)).shippingZones).toEqual([]);

    const tax = await g(`mutation { taxRateCreate(input: { name: "TVA", countryCode: "fr", rate: 20, appliesToShipping: true }) { taxRate { id name countryCode rate appliesToShipping active priority } userErrors { message } } }`);
    expect(tax.taxRateCreate.taxRate).toMatchObject({ name: 'TVA', countryCode: 'FR', rate: 20, appliesToShipping: true, active: true });
    expect((await g(`mutation { taxRateCreate(input: { name: "X", countryCode: "FR", rate: 120 }) { userErrors { field } } }`)).taxRateCreate.userErrors[0].field).toEqual(['input', 'rate']);
    const tu = await g(`mutation { taxRateUpdate(id: "${tax.taxRateCreate.taxRate.id}", input: { rate: 5.5, active: false }) { taxRate { rate active } } }`);
    expect(tu.taxRateUpdate.taxRate).toEqual({ rate: 5.5, active: false });
    expect((await g(`{ taxRates { id } }`)).taxRates).toHaveLength(1);
    await g(`mutation { taxRateDelete(id: "${tax.taxRateCreate.taxRate.id}") { deletedTaxRateId } }`);
    expect((await g(`{ taxRates { id } }`)).taxRates).toEqual([]);
  });

  it('manages pages, menus and themes', async () => {
    const p = await g(`mutation { pageCreate(page: { title: "About us", body: "<p>Hello <b>world</b></p>" }) { page { id handle title body bodySummary isPublished publishedAt } userErrors { field message code } } }`);
    expect(p.pageCreate.page).toMatchObject({ handle: 'about-us', body: '<p>Hello <b>world</b></p>', bodySummary: 'Hello world', isPublished: true });
    const dup = await g(`mutation { pageCreate(page: { title: "x", handle: "about-us" }) { page { id } userErrors { field code } } }`);
    expect(dup.pageCreate.userErrors).toEqual([{ field: ['page', 'handle'], code: 'TAKEN' }]);
    const pu = await g(`mutation { pageUpdate(id: "${p.pageCreate.page.id}", page: { title: "About", isPublished: false, templateSuffix: "wide" }) { page { title isPublished publishedAt templateSuffix } userErrors { message } } }`);
    expect(pu.pageUpdate.page).toEqual({ title: 'About', isPublished: false, publishedAt: null, templateSuffix: 'wide' });
    expect((await g(`{ pages(first: 5, query: "published_status:unpublished") { nodes { title } } pagesCount { count } }`))).toEqual({ pages: { nodes: [{ title: 'About' }] }, pagesCount: { count: 1 } });

    const m = await g(`mutation { menuCreate(title: "Footer links", handle: "footer-links", items: [
      { title: "Shop", type: COLLECTION, resourceId: "${cat.manual.id}", items: [{ title: "Board", type: PRODUCT, resourceId: "${cat.minimal.id}" }] },
      { title: "About", type: PAGE, resourceId: "${p.pageCreate.page.id}" }, { title: "Blog", type: HTTP, url: "https://blog.example.com" }, { title: "Home", type: FRONTPAGE }]) {
      menu { id handle isDefault items { id title type url resourceId items { title url } } } userErrors { field message code } } }`);
    expect(m.menuCreate.userErrors).toEqual([]);
    const menu = m.menuCreate.menu;
    expect(menu.items.map((i: { url: string }) => i.url)).toEqual(['/collections/hydrogen', '/pages/about-us', 'https://blog.example.com', '/']);
    expect(menu.items[0].items[0].url).toMatch(/^\/products\//);
    const badMenu = await g(`mutation { menuCreate(title: "T", handle: "t", items: [{ title: "x", type: HTTP }]) { menu { id } userErrors { field code } } }`);
    expect(badMenu.menuCreate.userErrors[0]).toEqual({ field: ['items', '0', 'url'], code: 'BLANK' });
    const mu = await g(`mutation { menuUpdate(id: "${menu.id}", title: "Footer", items: [{ id: "${menu.items[1].id}", title: "About us", type: PAGE, resourceId: "${p.pageCreate.page.id}" }]) { menu { title items { id title } } userErrors { message } } }`);
    expect(mu.menuUpdate.menu).toEqual({ title: 'Footer', items: [{ id: menu.items[1].id, title: 'About us' }] });
    const defaults = (await g(`{ menus(first: 10, query: "handle:main-menu") { nodes { id isDefault } } }`)).menus.nodes;
    if (defaults.length) expect((await g(`mutation { menuDelete(id: "${defaults[0].id}") { deletedMenuId userErrors { code } } }`)).menuDelete.userErrors[0].code).toBe('UNABLE_TO_DELETE_DEFAULT_MENU');
    expect((await g(`mutation { menuDelete(id: "${menu.id}") { deletedMenuId } }`)).menuDelete.deletedMenuId).toBe(menu.id);
    expect((await g(`mutation { pageDelete(id: "${p.pageCreate.page.id}") { deletedPageId } }`)).pageDelete.deletedPageId).toBe(p.pageCreate.page.id);

    const themes = (await g(`{ themes(first: 5) { nodes { id name role } } }`)).themes.nodes;
    expect(themes).toHaveLength(1);
    expect(themes[0].role).toBe('MAIN');
    const up = await g(`mutation { themeFilesUpsert(themeId: "${themes[0].id}", files: [{ filename: "config/settings_data.json", body: { type: TEXT, value: "/* banner */ {\\"current\\": {\\"accent\\": \\"#fff\\"}}" } }, { filename: "snippets/hello.liquid", body: { type: TEXT, value: "hi" } }]) {
      upsertedThemeFiles { filename size checksumMd5 } userErrors { filename message code } } }`);
    expect(up.themeFilesUpsert.userErrors).toEqual([]);
    expect(up.themeFilesUpsert.upsertedThemeFiles.map((f: { filename: string }) => f.filename)).toEqual(['config/settings_data.json', 'snippets/hello.liquid']);
    const files = (await g(`{ theme(id: "${themes[0].id}") { files(filenames: ["config/settings_data.json", "snippets/hello.liquid"]) { nodes { filename contentType body { ... on OnlineStoreThemeFileBodyText { content } } } } } }`)).theme.files.nodes;
    expect(files.map((f: { filename: string }) => f.filename)).toEqual(['config/settings_data.json', 'snippets/hello.liquid']);
    expect(files[1]).toMatchObject({ contentType: 'text/x-liquid', body: { content: 'hi' } });
    const badJson = await g(`mutation { themeFilesUpsert(themeId: "${themes[0].id}", files: [{ filename: "config/settings_data.json", body: { type: TEXT, value: "{oops" } }]) { userErrors { filename code } } }`);
    expect(badJson.themeFilesUpsert.userErrors).toEqual([{ filename: null, code: 'INVALID' }]);
    const outside = await g(`mutation { themeFilesUpsert(themeId: "${themes[0].id}", files: [{ filename: "../x.liquid", body: { type: TEXT, value: "" } }]) { userErrors { code } } }`);
    expect(outside.themeFilesUpsert.userErrors[0].code).toBe('INVALID');

    // publish a second theme
    const { id } = (await t.dbHandle.db.execute(`insert into themes (shop_id, name, role) values (${await shopIdOf(t.dbHandle.db)}, 'Draft', 'UNPUBLISHED') returning id`) as unknown as { rows: { id: string }[] }).rows[0]!;
    const pub = await g(`mutation { themePublish(id: "gid://shopify/OnlineStoreTheme/${id}") { theme { name role } userErrors { message } } }`);
    expect(pub.themePublish.theme).toEqual({ name: 'Draft', role: 'MAIN' });
    expect((await g(`{ themes(first: 5, roles: [UNPUBLISHED]) { nodes { role } } }`)).themes.nodes).toHaveLength(1);
  });

  it('computes the dashboard from orders', async () => {
    const db = t.dbHandle.db;
    const shopId = await shopIdOf(db);
    const day = (n: number) => new Date(Date.now() - n * 86400000);
    await seedOrder(db, shopId, 40, { processedAt: new Date(), total: 3000, lineTitle: 'Snow Board' });
    await seedOrder(db, shopId, 41, { processedAt: day(2), total: 1000, lineTitle: 'Mug' });
    await seedOrder(db, shopId, 42, { processedAt: day(2), total: 2000, lineTitle: 'Snow Board' });
    await seedOrder(db, shopId, 43, { processedAt: day(20), total: 9000, lineTitle: 'Old' });
    await seedOrder(db, shopId, 44, { processedAt: new Date(), total: 5000, cancelledAt: new Date() });
    await seedOrder(db, shopId, 45, { processedAt: new Date(), total: 7000, test: true });
    const q = (range: string) => g(`{ shopmeDashboard(range: ${range}) { totalSales { amount currencyCode } ordersCount averageOrderValue { amount } salesByDay { date sales { amount } ordersCount } topProducts { title quantity sales { amount } } } }`);
    const today = (await q('TODAY')).shopmeDashboard;
    expect(today).toMatchObject({ totalSales: { amount: '30.0', currencyCode: 'EUR' }, ordersCount: 1, averageOrderValue: { amount: '30.0' } });
    expect(today.salesByDay).toHaveLength(1);
    const week = (await q('LAST_7_DAYS')).shopmeDashboard;
    expect(week).toMatchObject({ totalSales: { amount: '60.0' }, ordersCount: 3, averageOrderValue: { amount: '20.0' } });
    expect(week.salesByDay).toHaveLength(7);
    expect(week.salesByDay.reduce((s: number, d: { ordersCount: number }) => s + d.ordersCount, 0)).toBe(3);
    expect(week.topProducts[0]).toMatchObject({ title: 'Snow Board', quantity: 4 });
    const month = (await q('LAST_30_DAYS')).shopmeDashboard;
    expect(month).toMatchObject({ totalSales: { amount: '150.0' }, ordersCount: 4 });
    expect(month.salesByDay).toHaveLength(30);
  });
});
