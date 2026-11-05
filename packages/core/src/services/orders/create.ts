import { and, asc, eq, sql } from 'drizzle-orm';
import type { Db, Executor } from '../../db/client';
import * as s from '../../db/schema';
import { addEvent } from '../events';
import { nextOrderNumber } from '../sequences';
import type { PricingLine, PricingResult } from '../pricing';

export interface CheckoutAddressInput {
  firstName?: string | null; lastName?: string | null; company?: string | null;
  address1?: string | null; address2?: string | null; city?: string | null;
  province?: string | null; provinceCode?: string | null; zip?: string | null;
  country?: string | null; countryCode?: string | null; phone?: string | null;
}

export interface OrderLineInput extends PricingLine {
  /** Null for custom items (draft orders). */
  variantId: number | null;
  title: string; variantTitle: string | null; sku: string | null; vendor: string | null;
  imageUrl: string | null; isGiftCard: boolean; properties: Record<string, string>;
}

export interface CreateOrderInput {
  /** Null for a buyer who identified with a phone number only. */
  email: string | null;
  phone?: string | null;
  acceptsMarketing?: boolean;
  currency: string;
  taxesIncluded: boolean;
  lines: OrderLineInput[];
  pricing: PricingResult;
  shippingAddress: CheckoutAddressInput | null;
  billingAddress: CheckoutAddressInput | null;
  /** PAID when the money is in (or nothing is due); PENDING for manual methods and unconfirmed online payments. */
  payment: { gateway: string; status: 'PAID' | 'PENDING'; paymentId?: string | null; test?: boolean };
  /** Gift cards that pay part (or all) of the total: balances are debited atomically with the order. */
  giftCards?: { giftCardId: number; amount: number }[];
  /** Checkout (cart) token: stored on the order and used to complete the cart exactly once. */
  cartToken?: string | null;
  note?: string | null;
  sourceName?: string;
  /** Tip added by the buyer (minor units), on top of `pricing.total`. */
  tip?: number;
}

export type CreateOrderResult =
  | { ok: true; orderId: number; orderNumber: number; name: string }
  | { ok: false; error: 'out_of_stock'; variantIds: number[] }
  | { ok: false; error: 'discount_unavailable' | 'already_completed' | 'gift_card_unavailable' };

class Abort extends Error { constructor(readonly result: Extract<CreateOrderResult, { ok: false }>) { super(result.error); } }

const normEmail = (e: string) => e.trim().toLowerCase();

/** Move stock from available to committed for one variant, across the item's active locations. Fails when it is not there. */
export async function commitStock(tx: Executor, shopId: number, variantId: number, quantity: number, orderId: number): Promise<boolean> {
  const [row] = await tx.select({ itemId: s.inventoryItems.id, tracked: s.inventoryItems.tracked, policy: s.productVariants.inventoryPolicy })
    .from(s.productVariants).leftJoin(s.inventoryItems, eq(s.inventoryItems.variantId, s.productVariants.id))
    .where(and(eq(s.productVariants.id, variantId), eq(s.productVariants.shopId, shopId))).limit(1);
  if (!row?.itemId || !row.tracked) return true;
  // Allocation rule: locations that fulfil online orders, by priority; the first one holding the whole quantity wins, else stock spills over in priority order.
  const rows = await tx.select({ lv: s.inventoryLevels, online: s.locations.fulfillsOnlineOrders }).from(s.inventoryLevels).innerJoin(s.locations, eq(s.locations.id, s.inventoryLevels.locationId))
    .where(and(eq(s.inventoryLevels.inventoryItemId, row.itemId), eq(s.inventoryLevels.isActive, true), eq(s.locations.isActive, true))).orderBy(asc(s.locations.priority), asc(s.locations.id));
  const online = rows.filter((r) => r.online);
  let levels = (online.length ? online : rows).map((r) => r.lv);
  const whole = levels.find((l) => l.available >= quantity);
  if (whole) levels = [whole];
  if (!levels.length) return row.policy === 'CONTINUE';
  const deny = row.policy !== 'CONTINUE';
  let left = quantity;
  const take = async (levelId: number, locationId: number, n: number, guard: boolean): Promise<boolean> => {
    const upd = await tx.update(s.inventoryLevels)
      .set({ available: sql`${s.inventoryLevels.available} - ${n}`, committed: sql`${s.inventoryLevels.committed} + ${n}` })
      .where(guard ? and(eq(s.inventoryLevels.id, levelId), sql`${s.inventoryLevels.available} >= ${n}`) : eq(s.inventoryLevels.id, levelId))
      .returning({ available: s.inventoryLevels.available, committed: s.inventoryLevels.committed });
    if (!upd.length) return false;
    const ref = `shopme://orders/${orderId}`;
    await tx.insert(s.inventoryAdjustments).values([
      { shopId, inventoryItemId: row.itemId!, locationId, name: 'available', delta: -n, quantityAfter: upd[0]!.available, reason: 'other', referenceUri: ref },
      { shopId, inventoryItemId: row.itemId!, locationId, name: 'committed', delta: n, quantityAfter: upd[0]!.committed, reason: 'other', referenceUri: ref },
    ]);
    return true;
  };
  for (const lv of levels) {
    if (left <= 0) break;
    const n = Math.min(left, Math.max(0, lv.available));
    if (n > 0) { if (!(await take(lv.id, lv.locationId, n, deny))) return false; left -= n; }
  }
  if (left > 0) {
    if (deny) return false;
    await take(levels[0]!.id, levels[0]!.locationId, left, false); // oversell allowed: goes negative at the first location
  }
  return true;
}

/**
 * Create an order from a priced checkout, in one transaction: order number, lines, addresses, shipping/tax/discount lines,
 * transaction, customer (by email), stock commitment, discount usage, cart completion and the timeline entry.
 * Returns a failure (nothing written) when stock ran out meanwhile, a discount hit its usage limit, or the cart was already completed.
 */
export async function createOrder(db: Db, shopId: number, input: CreateOrderInput): Promise<CreateOrderResult> {
  const email = input.email ? normEmail(input.email) : null;
  const { pricing } = input;
  const tip = Math.max(0, input.tip ?? 0);
  try {
    return await db.transaction(async (tx) => {
      if (input.cartToken) {
        const done = await tx.update(s.carts).set({ completedAt: new Date() })
          .where(and(eq(s.carts.shopId, shopId), eq(s.carts.token, input.cartToken), sql`${s.carts.completedAt} is null`)).returning({ id: s.carts.id });
        if (!done.length) throw new Abort({ ok: false, error: 'already_completed' });
      }
      for (const a of pricing.discountApplications) {
        if (a.discountId <= 0) continue; // custom (draft order) discount: no usage counting
        const used = await tx.update(s.discounts).set({ usageCount: sql`${s.discounts.usageCount} + 1` })
          .where(and(eq(s.discounts.id, a.discountId), eq(s.discounts.shopId, shopId), sql`(${s.discounts.usageLimit} is null or ${s.discounts.usageCount} < ${s.discounts.usageLimit})`)).returning({ id: s.discounts.id });
        if (!used.length) throw new Abort({ ok: false, error: 'discount_unavailable' });
        if (a.code) await tx.update(s.discountCodes).set({ usageCount: sql`${s.discountCodes.usageCount} + 1` }).where(and(eq(s.discountCodes.shopId, shopId), eq(s.discountCodes.discountId, a.discountId), eq(s.discountCodes.code, a.code.toUpperCase())));
      }

      // Customer by email.
      const ship = input.shippingAddress ?? input.billingAddress;
      const phone = input.phone ?? ship?.phone ?? null;
      let [customer] = email ? await tx.select().from(s.customers).where(and(eq(s.customers.shopId, shopId), eq(s.customers.email, email))).limit(1)
        : phone ? await tx.select().from(s.customers).where(and(eq(s.customers.shopId, shopId), eq(s.customers.phone, phone))).limit(1) : [];
      if (!customer) {
        [customer] = await tx.insert(s.customers).values({ shopId, email, firstName: ship?.firstName ?? null, lastName: ship?.lastName ?? null, phone: input.phone ?? ship?.phone ?? null, acceptsMarketing: !!input.acceptsMarketing }).returning();
      }
      await tx.update(s.customers).set({
        numberOfOrders: sql`${s.customers.numberOfOrders} + 1`, amountSpent: sql`${s.customers.amountSpent} + ${pricing.total + tip}`,
        ...(input.acceptsMarketing ? { acceptsMarketing: true } : {}),
      }).where(eq(s.customers.id, customer!.id));
      if (ship && !customer!.defaultAddressId) {
        const [addr] = await tx.insert(s.customerAddresses).values({ shopId, customerId: customer!.id, ...ship }).returning({ id: s.customerAddresses.id });
        await tx.update(s.customers).set({ defaultAddressId: addr!.id }).where(eq(s.customers.id, customer!.id));
      }

      const orderNumber = await nextOrderNumber(tx, shopId);
      const paid = input.payment.status === 'PAID';
      const [order] = await tx.insert(s.orders).values({
        shopId, orderNumber, name: `#${orderNumber}`, customerId: customer!.id, email, phone: input.phone ?? ship?.phone ?? null,
        currency: input.currency, presentmentCurrency: input.currency, taxesIncluded: input.taxesIncluded, test: !!input.payment.test,
        financialStatus: paid ? 'PAID' : 'PENDING', fulfillmentStatus: 'UNFULFILLED', note: input.note ?? null, sourceName: input.sourceName ?? 'web', cartToken: input.cartToken ?? null,
        subtotal: pricing.subtotal, totalShipping: pricing.totalShipping, totalTax: pricing.totalTax, totalDiscounts: pricing.totalDiscounts, total: pricing.total + tip, totalTip: tip,
      }).returning();
      const orderId = order!.id;

      const lineIds = new Map<number, number>();
      for (const [i, l] of input.lines.entries()) {
        const p = pricing.lines.find((x) => x.id === l.id)!;
        const [row] = await tx.insert(s.orderLines).values({
          shopId, orderId, position: i, productId: l.productId || null, variantId: l.variantId, title: l.title, variantTitle: l.variantTitle, sku: l.sku, vendor: l.vendor,
          quantity: l.quantity, currentQuantity: l.quantity, requiresShipping: l.requiresShipping, taxable: l.taxable, isGiftCard: l.isGiftCard,
          unitPrice: l.unitPrice, discountedTotal: p.total, totalTax: p.tax, weightGrams: l.grams, imageUrl: l.imageUrl, properties: l.properties,
        }).returning({ id: s.orderLines.id });
        lineIds.set(l.id, row!.id);
      }
      const bad: number[] = [];
      for (const [variantId, quantity] of [...input.lines.reduce((m, l) => (l.variantId == null ? m : m.set(l.variantId, (m.get(l.variantId) ?? 0) + l.quantity)), new Map<number, number>())]) {
        if (!(await commitStock(tx, shopId, variantId, quantity, orderId))) bad.push(variantId);
      }
      if (bad.length) throw new Abort({ ok: false, error: 'out_of_stock', variantIds: bad });

      for (const [kind, a] of [['shipping', input.shippingAddress], ['billing', input.billingAddress ?? input.shippingAddress]] as const) {
        if (a) await tx.insert(s.orderAddresses).values({ shopId, orderId, kind, ...a });
      }
      let shippingLineId: number | null = null;
      if (pricing.shipping) {
        const [sl] = await tx.insert(s.orderShippingLines).values({
          shopId, orderId, title: pricing.shipping.rate.name, code: String(pricing.shipping.rate.id), price: pricing.shipping.price - pricing.shipping.discount, tax: pricing.shipping.tax,
        }).returning({ id: s.orderShippingLines.id });
        shippingLineId = sl!.id;
      }
      if (pricing.taxLines.length) {
        await tx.insert(s.orderTaxLines).values(pricing.taxLines.map((t) => ({
          shopId, orderId, title: t.title, rate: t.rate, price: t.price,
          orderLineId: t.lineId === null ? null : lineIds.get(t.lineId)!, shippingLineId: t.shipping ? shippingLineId : null,
        })));
      }
      if (pricing.discountApplications.length) {
        await tx.insert(s.orderDiscountApplications).values(pricing.discountApplications.map((a) => ({
          shopId, orderId, discountId: a.discountId > 0 ? a.discountId : null, code: a.code, title: a.title, valueType: a.valueType, value: a.value, allocatedAmount: a.allocated,
          targetType: a.target === 'SHIPPING' ? 'SHIPPING_LINE' : 'LINE_ITEM',
        })));
      }
      const giftTotal = (input.giftCards ?? []).reduce((n, g) => n + g.amount, 0);
      if (pricing.total + tip - giftTotal > 0) {
        await tx.insert(s.transactions).values({
          shopId, orderId, kind: 'SALE', status: paid ? 'SUCCESS' : 'PENDING', gateway: input.payment.gateway, amount: pricing.total + tip - giftTotal, currency: input.currency,
          test: !!input.payment.test, paymentId: input.payment.paymentId ?? null, processedAt: paid ? new Date() : null,
        });
      }
      for (const g of input.giftCards ?? []) {
        const debited = await tx.update(s.giftCards).set({ balance: sql`${s.giftCards.balance} - ${g.amount}`, updatedAt: new Date() })
          .where(and(eq(s.giftCards.id, g.giftCardId), eq(s.giftCards.shopId, shopId), eq(s.giftCards.enabled, true), sql`${s.giftCards.balance} >= ${g.amount}`)).returning({ id: s.giftCards.id });
        if (!debited.length) throw new Abort({ ok: false, error: 'gift_card_unavailable' });
        await tx.insert(s.giftCardTransactions).values({ shopId, giftCardId: g.giftCardId, amount: -g.amount, orderId, note: `Order ${order!.name}` });
        await tx.insert(s.transactions).values({ shopId, orderId, kind: 'SALE', status: 'SUCCESS', gateway: 'gift_card', amount: g.amount, currency: input.currency, test: !!input.payment.test, processedAt: new Date() });
      }
      await addEvent(tx, shopId, { subjectType: 'order', subjectId: orderId, verb: 'order.created', message: `Order ${order!.name} placed online (${input.payment.gateway})`, data: { gateway: input.payment.gateway } });
      if (paid) await addEvent(tx, shopId, { subjectType: 'order', subjectId: orderId, verb: 'order.paid', message: 'Payment received' });
      return { ok: true as const, orderId, orderNumber, name: order!.name };
    });
  } catch (e) {
    if (e instanceof Abort) return e.result;
    throw e;
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Reading an order back (thank-you page, emails)
// ---------------------------------------------------------------------------------------------------------------------

export interface OrderSummary {
  order: typeof s.orders.$inferSelect;
  lines: (typeof s.orderLines.$inferSelect)[];
  shippingAddress: typeof s.orderAddresses.$inferSelect | null;
  billingAddress: typeof s.orderAddresses.$inferSelect | null;
  shippingLines: (typeof s.orderShippingLines.$inferSelect)[];
  taxLines: (typeof s.orderTaxLines.$inferSelect)[];
  discounts: (typeof s.orderDiscountApplications.$inferSelect)[];
  transactions: (typeof s.transactions.$inferSelect)[];
}

export async function getOrderSummary(db: Executor, shopId: number, orderId: number): Promise<OrderSummary | null> {
  const [order] = await db.select().from(s.orders).where(and(eq(s.orders.id, orderId), eq(s.orders.shopId, shopId))).limit(1);
  if (!order) return null;
  const [lines, addrs, shippingLines, taxLines, discounts, transactions] = await Promise.all([
    db.select().from(s.orderLines).where(eq(s.orderLines.orderId, orderId)).orderBy(asc(s.orderLines.position)),
    db.select().from(s.orderAddresses).where(eq(s.orderAddresses.orderId, orderId)),
    db.select().from(s.orderShippingLines).where(eq(s.orderShippingLines.orderId, orderId)),
    db.select().from(s.orderTaxLines).where(eq(s.orderTaxLines.orderId, orderId)).orderBy(asc(s.orderTaxLines.id)),
    db.select().from(s.orderDiscountApplications).where(eq(s.orderDiscountApplications.orderId, orderId)).orderBy(asc(s.orderDiscountApplications.id)),
    db.select().from(s.transactions).where(eq(s.transactions.orderId, orderId)).orderBy(asc(s.transactions.id)),
  ]);
  return {
    order, lines, shippingLines, taxLines, discounts, transactions,
    shippingAddress: addrs.find((a) => a.kind === 'shipping') ?? null, billingAddress: addrs.find((a) => a.kind === 'billing') ?? null,
  };
}

/** The order created from a checkout token (the token is the buyer's capability for the thank-you page). */
export async function getOrderByCheckoutToken(db: Executor, shopId: number, token: string): Promise<OrderSummary | null> {
  const [o] = await db.select({ id: s.orders.id }).from(s.orders).where(and(eq(s.orders.shopId, shopId), eq(s.orders.cartToken, token))).limit(1);
  return o ? getOrderSummary(db, shopId, o.id) : null;
}
