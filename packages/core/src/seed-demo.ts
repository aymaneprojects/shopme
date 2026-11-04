import { eq } from 'drizzle-orm';
import type { Db } from './db/client';
import * as s from './db/schema';
import { getPrimaryShop, setupStore, type Shop } from './services/shops';
import { slugify } from './services/handle';
import { randomToken } from './services/crypto';
import type { Storage } from './services/storage';

interface DemoVariant { options: string[]; sku: string; price: number; compareAt?: number; stock: number }
interface DemoProduct { title: string; vendor: string; type: string; tags: string[]; html: string; color: string; options: { name: string; values: string[] }[]; variants: DemoVariant[] }

// Original, fictional demo content: a small coffee and tea shop.
const PRODUCTS: DemoProduct[] = [
  { title: 'Highland Morning Coffee Beans', vendor: 'Little Leaf Roasters', type: 'Coffee', tags: ['coffee', 'single-origin', 'light-roast'], color: '#8a5a3c',
    html: '<p>A bright, floral light roast with notes of peach and honey. Roasted weekly in small batches.</p>',
    options: [{ name: 'Size', values: ['250 g', '1 kg'] }, { name: 'Grind', values: ['Whole bean', 'Filter'] }],
    variants: [
      { options: ['250 g', 'Whole bean'], sku: 'HMC-250-WB', price: 1450, stock: 40 }, { options: ['250 g', 'Filter'], sku: 'HMC-250-FL', price: 1450, stock: 25 },
      { options: ['1 kg', 'Whole bean'], sku: 'HMC-1K-WB', price: 4800, compareAt: 5400, stock: 12 }, { options: ['1 kg', 'Filter'], sku: 'HMC-1K-FL', price: 4800, stock: 0 } ] },
  { title: 'House Espresso Blend', vendor: 'Little Leaf Roasters', type: 'Coffee', tags: ['coffee', 'espresso', 'dark-roast'], color: '#4b2e22',
    html: '<p>Our everyday espresso: dark chocolate, toasted hazelnut and a syrupy body.</p>',
    options: [{ name: 'Size', values: ['250 g', '1 kg'] }],
    variants: [{ options: ['250 g'], sku: 'HEB-250', price: 1300, stock: 60 }, { options: ['1 kg'], sku: 'HEB-1K', price: 4400, stock: 20 }] },
  { title: 'Jasmine Pearl Green Tea', vendor: 'Little Leaf Teas', type: 'Tea', tags: ['tea', 'green-tea'], color: '#7c9a5b',
    html: '<p>Hand-rolled green tea pearls scented with jasmine blossoms. Unfurls beautifully in a glass.</p>',
    options: [], variants: [{ options: [], sku: 'JPG-50', price: 1100, stock: 35 }] },
  { title: 'Smoked Earl Grey', vendor: 'Little Leaf Teas', type: 'Tea', tags: ['tea', 'black-tea'], color: '#5d6770',
    html: '<p>Black tea with bergamot and a whisper of pine smoke. Lovely with a splash of milk.</p>',
    options: [], variants: [{ options: [], sku: 'SEG-75', price: 1250, stock: 18 }] },
  { title: 'Ceramic Pour-Over Dripper', vendor: 'Little Leaf Goods', type: 'Equipment', tags: ['equipment', 'brewing'], color: '#c9b79c',
    html: '<p>A hand-glazed ceramic dripper that sits on most mugs and carafes. Fits size 02 filters.</p>',
    options: [{ name: 'Color', values: ['Cream', 'Slate'] }],
    variants: [{ options: ['Cream'], sku: 'CPD-CR', price: 2800, stock: 8 }, { options: ['Slate'], sku: 'CPD-SL', price: 2800, stock: 5 }] },
];

const placeholderSvg = (label: string, color: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="800" viewBox="0 0 800 800"><rect width="800" height="800" fill="${color}"/><text x="400" y="410" font-family="sans-serif" font-size="44" fill="#fff" text-anchor="middle">${label.replace(/[<&>]/g, '')}</text></svg>`;

/** Insert demo data for a shop. Creates the shop (with a random owner password) if none exists. */
export async function seedDemo(db: Db, storage: Storage, opts: { adminPassword?: string } = {}): Promise<{ shop: Shop; adminEmail?: string; adminPassword?: string }> {
  let shop = await getPrimaryShop(db);
  let adminEmail: string | undefined;
  let adminPassword: string | undefined;
  if (!shop) {
    adminEmail = 'owner@example.com';
    adminPassword = opts.adminPassword ?? randomToken(9);
    shop = (await setupStore(db, { shopName: 'Little Leaf Coffee & Tea', email: adminEmail, password: adminPassword, currency: 'EUR', country: 'FR', locale: 'en', timezone: 'Europe/Paris' })).shop;
  }
  const shopId = shop.id;
  const [location] = await db.select().from(s.locations).where(eq(s.locations.shopId, shopId)).limit(1);

  const productIds: Record<string, number> = {};
  for (const p of PRODUCTS) {
    const handle = slugify(p.title);
    const [existing] = await db.select({ id: s.products.id }).from(s.products).where(eq(s.products.handle, handle)).limit(1);
    if (existing) { productIds[handle] = existing.id; continue; }
    await db.transaction(async (tx) => {
      const [prod] = await tx.insert(s.products).values({ shopId, handle, title: p.title, descriptionHtml: p.html, status: 'ACTIVE', vendor: p.vendor, productType: p.type, tags: p.tags, publishedAt: new Date() }).returning();
      productIds[handle] = prod!.id;
      const key = `demo/${handle}.svg`;
      const svg = Buffer.from(placeholderSvg(p.title, p.color));
      await storage.put(key, svg);
      const [file] = await tx.insert(s.files).values({ shopId, filename: `${handle}.svg`, storageKey: key, mimeType: 'image/svg+xml', byteSize: svg.length, alt: p.title }).onConflictDoNothing().returning();
      const [m] = await tx.insert(s.media).values({ shopId, type: 'IMAGE', alt: p.title, fileId: file?.id, url: storage.url(key), mimeType: 'image/svg+xml', width: 800, height: 800 }).returning();
      await tx.insert(s.productMedia).values({ shopId, productId: prod!.id, mediaId: m!.id, position: 0 });

      const optionRows: { id: number; values: Map<string, number> }[] = [];
      for (const [i, o] of p.options.entries()) {
        const [opt] = await tx.insert(s.productOptions).values({ shopId, productId: prod!.id, name: o.name, position: i + 1 }).returning();
        const values = new Map<string, number>();
        for (const [j, v] of o.values.entries()) {
          const [val] = await tx.insert(s.productOptionValues).values({ shopId, optionId: opt!.id, name: v, position: j + 1 }).returning();
          values.set(v, val!.id);
        }
        optionRows.push({ id: opt!.id, values });
      }
      for (const [i, v] of p.variants.entries()) {
        const [variant] = await tx.insert(s.productVariants).values({ shopId, productId: prod!.id, position: i + 1, title: v.options.join(' / ') || 'Default Title', sku: v.sku, price: v.price, compareAtPrice: v.compareAt ?? null, mediaId: m!.id }).returning();
        for (const [k, name] of v.options.entries()) {
          await tx.insert(s.variantOptionValues).values({ shopId, variantId: variant!.id, optionId: optionRows[k]!.id, optionValueId: optionRows[k]!.values.get(name)! });
        }
        const [item] = await tx.insert(s.inventoryItems).values({ shopId, variantId: variant!.id, sku: v.sku, tracked: true, weightValue: 250, weightUnit: 'GRAMS' }).returning();
        if (location) await tx.insert(s.inventoryLevels).values({ shopId, inventoryItemId: item!.id, locationId: location.id, available: v.stock, onHand: v.stock });
      }
    });
  }

  // Collections
  const [existingCol] = await db.select({ id: s.collections.id }).from(s.collections).where(eq(s.collections.shopId, shopId)).limit(1);
  if (!existingCol) {
    const defs = [
      { handle: 'coffee', title: 'Coffee', tag: 'coffee' }, { handle: 'tea', title: 'Tea', tag: 'tea' }, { handle: 'equipment', title: 'Brewing equipment', tag: 'equipment' },
    ];
    for (const d of defs) {
      const [c] = await db.insert(s.collections).values({ shopId, handle: d.handle, title: d.title, descriptionHtml: `<p>${d.title} from Little Leaf.</p>`, isSmart: d.tag !== 'coffee', sortOrder: d.tag === 'coffee' ? 'MANUAL' : 'CREATED_DESC', publishedAt: new Date() }).returning();
      if (d.tag !== 'coffee') await db.insert(s.collectionRules).values({ shopId, collectionId: c!.id, ruleColumn: 'TAG', relation: 'EQUALS', condition: d.tag });
      const members = PRODUCTS.filter((p) => p.tags.includes(d.tag));
      for (const [i, p] of members.entries()) {
        await db.insert(s.collectionProducts).values({ shopId, collectionId: c!.id, productId: productIds[slugify(p.title)]!, position: i, source: d.tag === 'coffee' ? 'manual' : 'rule' });
      }
    }
  }

  // Pages, blog, menus
  const pageDefs = [
    ['about-us', 'About us', '<p>Little Leaf is a tiny roastery and tea house. We buy directly from small farms and roast every week.</p>'],
    ['contact', 'Contact', '<p>Questions? Write to hello@example.com and we will answer within one business day.</p>'],
    ['shipping-returns', 'Shipping and returns', '<p>Orders ship within two business days. Unopened items can be returned within 30 days.</p>'],
  ] as const;
  await db.insert(s.pages).values(pageDefs.map(([handle, title, bodyHtml]) => ({ shopId, handle, title, bodyHtml, publishedAt: new Date() }))).onConflictDoNothing();
  const [blog] = await db.insert(s.blogs).values({ shopId, handle: 'news', title: 'News' }).onConflictDoNothing().returning();
  if (blog) await db.insert(s.articles).values({ shopId, blogId: blog.id, handle: 'welcome', title: 'Welcome to Little Leaf', author: 'The Little Leaf team', bodyHtml: '<p>We are open for business. Here is what to expect.</p>', publishedAt: new Date() });

  const [menu] = await db.insert(s.menus).values({ shopId, handle: 'main-menu', title: 'Main menu' }).onConflictDoNothing().returning();
  if (menu) {
    const colls = await db.select().from(s.collections).where(eq(s.collections.shopId, shopId));
    const pg = await db.select().from(s.pages).where(eq(s.pages.shopId, shopId));
    const items: (typeof s.menuItems.$inferInsert)[] = [
      { shopId, menuId: menu.id, position: 0, title: 'Home', linkType: 'FRONTPAGE', url: '/' },
      ...colls.map((c, i) => ({ shopId, menuId: menu.id, position: i + 1, title: c.title, linkType: 'COLLECTION', resourceId: c.id, url: `/collections/${c.handle}` })),
      { shopId, menuId: menu.id, position: 10, title: 'About', linkType: 'PAGE', resourceId: pg.find((x) => x.handle === 'about-us')?.id, url: '/pages/about-us' },
    ];
    await db.insert(s.menuItems).values(items);
  }
  const [footer] = await db.insert(s.menus).values({ shopId, handle: 'footer', title: 'Footer menu' }).onConflictDoNothing().returning();
  if (footer) {
    const pg = await db.select().from(s.pages).where(eq(s.pages.shopId, shopId));
    await db.insert(s.menuItems).values([{ shopId, menuId: footer.id, position: 0, title: 'Search', linkType: 'HTTP', url: '/search' },
      ...pg.map((p, i) => ({ shopId, menuId: footer.id, position: i + 1, title: p.title, linkType: 'PAGE', resourceId: p.id, url: `/pages/${p.handle}` }))]);
  }

  // Shipping, tax, discount
  const [zone] = await db.select({ id: s.shippingZones.id }).from(s.shippingZones).where(eq(s.shippingZones.shopId, shopId)).limit(1);
  if (!zone) {
    const [z] = await db.insert(s.shippingZones).values({ shopId, name: 'Europe' }).returning();
    await db.insert(s.shippingZoneCountries).values(['FR', 'DE', 'BE', 'NL', 'ES', 'IT'].map((countryCode) => ({ shopId, zoneId: z!.id, countryCode })));
    await db.insert(s.shippingRates).values([
      { shopId, zoneId: z!.id, name: 'Standard', type: 'PRICE_BASED', price: 490, maxValue: 4999, position: 0 },
      { shopId, zoneId: z!.id, name: 'Free shipping over 50', type: 'PRICE_BASED', price: 0, minValue: 5000, position: 1 },
    ]);
    await db.insert(s.taxRates).values({ shopId, name: 'VAT', countryCode: 'FR', rate: 20, appliesToShipping: true });
    const [d] = await db.insert(s.discounts).values({ shopId, title: 'Welcome 10%', kind: 'CODE', valueType: 'PERCENTAGE', value: 1000, target: 'ORDER' }).returning();
    await db.insert(s.discountCodes).values({ shopId, discountId: d!.id, code: 'WELCOME10' });
  }
  return { shop, adminEmail, adminPassword };
}
