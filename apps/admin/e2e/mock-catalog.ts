// Fixture GraphQL answers used only to take README screenshots before/without a seeded database.
import type { Page } from 'playwright';

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

const answers: Record<string, unknown> = {
  Products: { products: { nodes: products, pageInfo } },
  ProductsCount: { productsCount: { count: products.length, precision: 'EXACT' } },
  ProductFilterOptions: { productTypes: edges(['Candles', 'Kitchen', 'Textiles']), productVendors: edges(['Atelier Lumière', 'Bois & Fils', 'Maison Lin']), productTags: edges(['candle', 'gift', 'winter']) },
  Locations: { locations: { nodes: [location] } },
  Product: { product: detail },
};

/** Answer the catalog queries with fixtures; mutations and unknown operations pass through to the server. */
export async function mockCatalog(page: Page) {
  await page.route('**/graphql.json', async (route) => {
    const body = route.request().postDataJSON() as { query: string };
    const name = /(?:query|mutation)\s+(\w+)/.exec(body.query)?.[1] ?? '';
    if (name in answers) return route.fulfill({ json: { data: answers[name] } });
    return route.continue();
  });
}
