import { eq } from 'drizzle-orm';
import { schema, type Db } from '@shopme/core';

const { customerAddresses, customers, orderAddresses, orderDiscountApplications, orderLines, orderShippingLines, orderTaxLines, orders, shops, transactions } = schema;

export interface SeedOrder {
  customerId?: number | null; email?: string; total?: number; financialStatus?: string; fulfillmentStatus?: string; processedAt?: Date; tags?: string[]; test?: boolean;
  cancelledAt?: Date | null; closedAt?: Date | null; paid?: boolean; variantId?: number | null; productId?: number | null; lineTitle?: string; qty?: number; unitPrice?: number; sku?: string | null;
}

export const shopIdOf = async (db: Db) => (await db.select({ id: shops.id }).from(shops))[0]!.id;

export async function seedCustomer(db: Db, shopId: number, o: Partial<typeof customers.$inferInsert> = {}) {
  const [c] = await db.insert(customers).values({
    shopId, email: 'russell@example.com', firstName: 'Russell', lastName: 'Winfield', phone: '+16135550135', note: 'VIP', tags: ['vip'], locale: 'en-ca', verifiedEmail: true, ...o,
  }).returning();
  const [a] = await db.insert(customerAddresses).values({ shopId, customerId: c!.id, address1: '105 Victoria St', city: 'Toronto', zip: 'M5C1N7', country: 'CA', countryCode: 'CA', provinceCode: 'ON', province: 'ON' }).returning();
  await db.update(customers).set({ defaultAddressId: a!.id }).where(eq(customers.id, c!.id));
  return c!;
}

/** One order with a single line, a shipping line, tax, discount, sale transaction and addresses, written straight to the tables. */
export async function seedOrder(db: Db, shopId: number, n: number, o: SeedOrder = {}) {
  const qty = o.qty ?? 2;
  const unit = o.unitPrice ?? 1000;
  const subtotal = qty * unit;
  const total = o.total ?? subtotal + 500;
  const paid = o.paid ?? true;
  const [order] = await db.insert(orders).values({
    shopId, orderNumber: 1000 + n, name: `#${1000 + n}`, customerId: o.customerId ?? null, email: o.email ?? 'buyer@example.com', phone: '+33123456789', currency: 'EUR', presentmentCurrency: 'EUR',
    financialStatus: o.financialStatus ?? (paid ? 'PAID' : 'PENDING'), fulfillmentStatus: o.fulfillmentStatus ?? 'UNFULFILLED', processedAt: o.processedAt ?? new Date(), test: o.test ?? false, tags: o.tags ?? [],
    cancelledAt: o.cancelledAt ?? null, closedAt: o.closedAt ?? null, note: 'Leave at door', sourceName: 'web', cartToken: `tok${n}`,
    subtotal, totalShipping: 500, totalTax: 100, totalDiscounts: 0, total,
  }).returning();
  const [line] = await db.insert(orderLines).values({
    shopId, orderId: order!.id, position: 0, productId: o.productId ?? null, variantId: o.variantId ?? null, title: o.lineTitle ?? 'Snow Board', variantTitle: 'Blue', sku: o.sku === undefined ? `SKU-${n}` : o.sku, vendor: 'Snow Co',
    quantity: qty, currentQuantity: qty, unitPrice: unit, discountedTotal: subtotal, totalTax: 100, imageUrl: 'https://example.com/a.png', properties: { engraving: 'Hi' },
  }).returning();
  const [ship] = await db.insert(orderShippingLines).values({ shopId, orderId: order!.id, title: 'Standard', code: 'standard', price: 500, tax: 0 }).returning();
  await db.insert(orderTaxLines).values([{ shopId, orderId: order!.id, orderLineId: line!.id, title: 'VAT', rate: 0.2, price: 100 }, { shopId, orderId: order!.id, shippingLineId: ship!.id, title: 'VAT', rate: 0.2, price: 0 }]);
  await db.insert(orderDiscountApplications).values({ shopId, orderId: order!.id, code: 'WELCOME', title: 'WELCOME', valueType: 'PERCENTAGE', value: 1000, allocatedAmount: 0 });
  await db.insert(orderAddresses).values([
    { shopId, orderId: order!.id, kind: 'shipping', firstName: 'Ada', lastName: 'Lovelace', address1: '1 Rue X', address2: 'Apt 2', city: 'Paris', province: 'IDF', provinceCode: 'IDF', zip: '75001', country: 'FR', countryCode: 'FR', phone: '+33123456789' },
    { shopId, orderId: order!.id, kind: 'billing', firstName: 'Ada', lastName: 'Lovelace', address1: '1 Rue X', city: 'Paris', zip: '75001', country: 'FR', countryCode: 'FR' },
  ]);
  if (paid) await db.insert(transactions).values({ shopId, orderId: order!.id, kind: 'SALE', status: 'SUCCESS', gateway: 'bogus', amount: total, currency: 'EUR', test: true, processedAt: new Date() });
  return { order: order!, line: line! };
}
