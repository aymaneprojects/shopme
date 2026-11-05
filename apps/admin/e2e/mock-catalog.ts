// Fixture GraphQL answers used only to take README screenshots before/without a seeded database.
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Page } from 'playwright';

const themeDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../packages/theme-default/config');
const themeFile = (name: string) => ({ filename: `config/${name}`, body: { content: readFileSync(path.join(themeDir, name), 'utf8') } });

const themeRoot = path.join(themeDir, '..');
const textFile = (filename: string) => ({ filename, body: { content: readFileSync(path.join(themeRoot, filename), 'utf8') } });
const dirFiles = (dir: string, ext: string) => readdirSync(path.join(themeRoot, dir)).filter((f) => f.endsWith(ext)).map((f) => textFile(`${dir}/${f}`));
const themeNode = (files: unknown[]) => ({ theme: { id: 'gid://shopify/OnlineStoreTheme/1', files: { nodes: files } } });

const swatch = (color: string) => `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="240" height="240"><rect width="240" height="240" fill="${color}"/><circle cx="120" cy="130" r="46" fill="rgba(255,255,255,.55)"/></svg>`)}`;
const media = (c: string) => ({ id: `gid://shopify/MediaImage/${c.slice(1)}`, alt: '', mediaContentType: 'IMAGE', image: { url: swatch(c) } });
const product = (n: number, title: string, status: string, vendor: string, type: string, inv: number, color: string) => ({
  id: `gid://shopify/Product/${n}`, title, handle: title.toLowerCase().replace(/\W+/g, '-'), status, vendor, productType: type,
  totalInventory: inv, tracksInventory: true, variantsCount: { count: n === 1 ? 3 : 1 }, featuredMedia: media(color),
});
const products = [
  product(1, 'Ember Candle', 'ACTIVE', 'Atelier Lumière', 'Candles', 128, '#c2410c'),
  product(2, 'Linen Throw Blanket', 'ACTIVE', 'Maison Lin', 'Textiles', 42, '#a8a29e'),
  product(3, 'Ceramic Pour-over Set', 'DRAFT', 'Atelier Lumière', 'Kitchen', 0, '#0f766e'),
  product(4, 'Oak Serving Board', 'ACTIVE', 'Bois & Fils', 'Kitchen', 17, '#a16207'),
  product(5, 'Wool Dryer Balls (3)', 'ARCHIVED', 'Maison Lin', 'Textiles', 0, '#4338ca'),
];
const location = { id: 'gid://shopify/Location/1', name: 'Paris warehouse', isActive: true };
const variant = (n: number, size: string, price: string, qty: number) => ({
  id: `gid://shopify/ProductVariant/${n}`, title: size, sku: `EMBER-${size.toUpperCase()}`, barcode: null, price, compareAtPrice: n === 1 ? '24.00' : null, taxable: true, inventoryPolicy: 'DENY',
  selectedOptions: [{ name: 'Size', value: size }],
  inventoryItem: { id: `gid://shopify/InventoryItem/${n}`, tracked: true, requiresShipping: true, unitCost: { amount: '7.50' }, measurement: { weight: { unit: 'GRAMS', value: 220 } },
    inventoryLevels: { nodes: [{ location: { id: location.id }, quantities: [{ name: 'available', quantity: qty }, { name: 'committed', quantity: 0 }] }] } },
});
const detail = {
  ...products[0]!, descriptionHtml: '<p>Hand-poured soy candle with notes of cedar, amber and smoked vanilla. Burns for about 45 hours.</p>', tags: ['candle', 'gift', 'winter'], templateSuffix: null, updatedAt: '2026-11-01T10:00:00Z',
  seo: { title: 'Ember Candle | Atelier Lumière', description: 'Hand-poured soy candle with cedar, amber and smoked vanilla.' },
  options: [{ id: 'gid://shopify/ProductOption/1', name: 'Size', position: 1, values: ['Small', 'Medium', 'Large'] }],
  media: { nodes: [media('#c2410c'), media('#9a3412'), media('#7c2d12')] },
  collections: { nodes: [{ id: 'gid://shopify/Collection/1', title: 'Home fragrance', ruleSet: null }] },
  variants: { nodes: [variant(1, 'Small', '18.00', 60), variant(2, 'Medium', '26.00', 48), variant(3, 'Large', '34.00', 20)] },
};
const pageInfo = { hasNextPage: false, hasPreviousPage: false, startCursor: null, endCursor: null };
const edges = (a: string[]) => ({ edges: a.map((node) => ({ node })) });


const money = (amount: string) => ({ shopMoney: { amount, currencyCode: 'EUR' } });
const orderRow = (n: number, who: string, total: string, fin: string, ful: string, items: number, date: string) => ({
  id: `gid://shopify/Order/${n}`, name: `#${n}`, createdAt: date, displayFinancialStatus: fin, displayFulfillmentStatus: ful, tags: n === 1004 ? ['gift'] : [], cancelledAt: null, closedAt: null,
  totalPriceSet: money(total), customer: { id: `gid://shopify/Customer/${n}`, displayName: who }, lineItems: { nodes: [{ id: `l${n}`, quantity: items }] },
});
const orders = [
  orderRow(1006, 'Léa Moreau', '62.00', 'PAID', 'UNFULFILLED', 2, '2026-11-03T09:12:00Z'),
  orderRow(1005, 'Hugo Bernard', '34.00', 'PENDING', 'UNFULFILLED', 1, '2026-11-02T16:40:00Z'),
  orderRow(1004, 'Camille Roux', '118.50', 'PAID', 'FULFILLED', 3, '2026-11-01T11:05:00Z'),
  orderRow(1003, 'Noah Petit', '26.00', 'PARTIALLY_REFUNDED', 'FULFILLED', 1, '2026-10-30T08:30:00Z'),
  orderRow(1002, 'Inès Garcia', '88.00', 'PAID', 'PARTIALLY_FULFILLED', 4, '2026-10-28T14:22:00Z'),
];
const line = (n: number, title: string, variant: string, qty: number, unit: string, color: string) => ({
  id: `gid://shopify/LineItem/${n}`, title, variantTitle: variant, sku: `SKU-${n}`, quantity: qty, refundableQuantity: qty, fulfillableQuantity: qty,
  originalUnitPriceSet: money(unit), discountedTotalSet: money((Number(unit) * qty).toFixed(2)), variant: { id: `v${n}`, image: { url: swatch(color) } }, product: { id: `p${n}` },
});
const orderDetail = {
  id: 'gid://shopify/Order/1006', name: '#1006', createdAt: '2026-11-03T09:12:00Z', email: 'lea.moreau@example.com', note: 'Gift wrap please.', tags: ['gift'], cancelledAt: null, closedAt: null,
  displayFinancialStatus: 'PAID', displayFulfillmentStatus: 'UNFULFILLED',
  lineItems: { nodes: [line(1, 'Ember Candle', 'Medium', 2, '26.00', '#9a3412'), line(2, 'Oak Serving Board', 'Default', 1, '14.00', '#a16207')] },
  subtotalPriceSet: money('66.00'), totalShippingPriceSet: money('5.00'), totalTaxSet: money('11.00'), totalDiscountsSet: money('9.00'), totalPriceSet: money('62.00'), totalRefundedSet: money('0.00'),
  shippingAddress: { firstName: 'Léa', lastName: 'Moreau', company: null, address1: '12 rue des Lilas', address2: null, city: 'Lyon', province: null, zip: '69003', country: 'France', countryCodeV2: 'FR', phone: null },
  billingAddress: null, shippingLines: { nodes: [{ title: 'Standard shipping', originalPriceSet: money('5.00') }] },
  discountApplications: { nodes: [{ __typename: 'DiscountCodeApplication', code: 'WELCOME10' }] },
  transactions: [{ id: 't1', kind: 'SALE', status: 'SUCCESS', gateway: 'stripe', createdAt: '2026-11-03T09:12:00Z', amountSet: money('62.00') }],
  fulfillments: [], refunds: [], customer: { id: 'gid://shopify/Customer/1', displayName: 'Léa Moreau', defaultEmailAddress: { emailAddress: 'lea.moreau@example.com' }, numberOfOrders: 3 },
  events: { nodes: [{ id: 'e2', message: 'Payment of €62.00 captured via Stripe.', createdAt: '2026-11-03T09:12:30Z' }, { id: 'e1', message: 'Order placed on the Online Store.', createdAt: '2026-11-03T09:12:00Z' }] },
};
const shop = {
  id: 'gid://shopify/Shop/1', name: 'Atelier Lumière', email: 'camille@example.com', contactEmail: 'camille@example.com', description: 'Candles and home goods, made in small batches.', currencyCode: 'EUR',
  ianaTimezone: 'Europe/Paris', weightUnit: 'KILOGRAMS', taxesIncluded: true, taxShipping: false, locale: 'en', currencyFormats: { moneyFormat: '{{amount}} €', moneyWithCurrencyFormat: '{{amount}} € EUR' },
  primaryDomain: { host: 'localhost', url: 'http://localhost' }, myshopifyDomain: 'localhost', storefront: { passwordEnabled: false, password: '' },
};
const dashboard = {
  totalSales: money('1284.50').shopMoney, ordersCount: 23, averageOrderValue: money('55.85').shopMoney,
  salesByDay: [120, 80, 0, 210, 160, 95, 340, 180, 60, 220, 130, 90, 250, 300].map((v, i) => ({ date: `2026-10-${String(21 + i).padStart(2, '0')}`, sales: { amount: String(v) } })),
  topProducts: [{ title: 'Ember Candle', quantity: 41 }, { title: 'Linen Throw Blanket', quantity: 22 }, { title: 'Oak Serving Board', quantity: 15 }],
};

const answers: Record<string, unknown | ((v: Record<string, unknown>) => unknown)> = {
  Products: { products: { nodes: products, pageInfo } },
  ProductsCount: { productsCount: { count: products.length, precision: 'EXACT' } },
  ProductFilterOptions: { productTypes: edges(['Candles', 'Kitchen', 'Textiles']), productVendors: edges(['Atelier Lumière', 'Bois & Fils', 'Maison Lin']), productTags: edges(['candle', 'gift', 'winter']) },
  Locations: { locations: { nodes: [location] } },
  Product: { product: detail },
  Orders: { orders: { nodes: orders, pageInfo } },
  OrdersCount: { ordersCount: { count: orders.length } },
  Order: { order: orderDetail },
  ShopSettings: { shop },
  ShopmeDashboard: { shopmeDashboard: dashboard },
  Themes: { themes: { nodes: [
    { id: 'gid://shopify/OnlineStoreTheme/1', name: 'Aurora', role: 'MAIN' }, { id: 'gid://shopify/OnlineStoreTheme/2', name: 'Aurora (autumn draft)', role: 'UNPUBLISHED' }, { id: 'gid://shopify/OnlineStoreTheme/3', name: 'Horizon', role: 'UNPUBLISHED' },
  ] } },
  ThemeTemplateNames: themeNode(dirFiles('templates', '.json').map((f) => ({ filename: f.filename }))),
  ThemeSchemas: themeNode([...dirFiles('sections', '.liquid'), ...dirFiles('blocks', '.liquid')]),
  ThemeEditorFiles: (v: Record<string, unknown>) => themeNode([textFile((v.filenames as string[])[0]!), textFile('sections/header-group.json'), textFile('sections/footer-group.json')]),
  ThemePreviewHandles: { products: { nodes: [{ handle: 'ember-candle' }] }, collections: { nodes: [{ handle: 'all' }] }, pages: { nodes: [] } },
  ThemeSettings: { theme: { id: 'gid://shopify/OnlineStoreTheme/1', name: 'Aurora', role: 'MAIN', files: { nodes: [themeFile('settings_schema.json'), themeFile('settings_data.json')] } } },
  ThemeLocales: { theme: { id: 'gid://shopify/OnlineStoreTheme/1', files: { nodes: [{ filename: 'locales/en.default.schema.json', body: { content: readFileSync(path.join(themeDir, '../locales/en.default.schema.json'), 'utf8') } }] } } },
};

/** Answer the catalog queries with fixtures; mutations and unknown operations pass through to the server. */
export async function mockCatalog(page: Page) {
  await page.route('**/graphql.json', async (route) => {
    const body = route.request().postDataJSON() as { query: string; variables?: Record<string, unknown> };
    const name = /(?:query|mutation)\s+(\w+)/.exec(body.query)?.[1] ?? '';
    if (name in answers) { const a = answers[name]; return route.fulfill({ json: { data: typeof a === 'function' ? a(body.variables ?? {}) : a } }); }
    return route.continue();
  });
}
