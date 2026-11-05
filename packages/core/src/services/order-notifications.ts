import { and, eq } from 'drizzle-orm';
import { fulfillmentLines, fulfillments, orderLines, refunds } from '../db/schema';
import type { Executor } from '../db/client';
import { moneyOf, orderVars, type NotificationKey } from '../mail/notifications';
import { getOrderSummary } from './orders/create';
import type { Shop } from './shops';

/** Order event verbs (events table) that notify the customer when the staff action asked for it, and the template each one uses. */
export const ORDER_EMAIL_VERBS: Record<string, NotificationKey> = {
  'order.fulfilled': 'shipping_confirmation', 'order.tracking_updated': 'shipping_update', 'order.cancelled': 'order_cancelled', 'order.refunded': 'refund',
};

/** Recipient, template and Liquid variables for an order event, or null when nothing should be sent. Throws while the order is not readable yet (job retry). */
export async function orderEventMail(db: Executor, shop: Shop, verb: string, orderId: number, data: Record<string, unknown> | null): Promise<{ key: NotificationKey; to: string; vars: Record<string, unknown> } | null> {
  const key = ORDER_EMAIL_VERBS[verb];
  if (!key || !data?.notify) return null;
  const o = await getOrderSummary(db, shop.id, orderId);
  if (!o) throw new Error('order not readable yet');
  if (!o.order.email) return null;
  const vars = orderVars(o, shop);
  if (key === 'shipping_confirmation' || key === 'shipping_update') {
    const [f] = await db.select().from(fulfillments).where(and(eq(fulfillments.shopId, shop.id), eq(fulfillments.id, Number(data.fulfillmentId)))).limit(1);
    if (!f) return null;
    const lines = await db.select({ title: orderLines.title, variantTitle: orderLines.variantTitle, quantity: fulfillmentLines.quantity }).from(fulfillmentLines)
      .innerJoin(orderLines, eq(orderLines.id, fulfillmentLines.orderLineId)).where(eq(fulfillmentLines.fulfillmentId, f.id));
    vars.fulfillment = {
      name: f.name, tracking_company: f.trackingCompany, tracking_number: f.trackingNumbers[0] ?? null, tracking_url: f.trackingUrls[0] ?? null, tracking_numbers: f.trackingNumbers,
      line_items: lines.map((l) => ({ title: [l.title, l.variantTitle].filter(Boolean).join(' - '), quantity: l.quantity })),
    };
  } else if (key === 'refund') {
    const [r] = await db.select().from(refunds).where(and(eq(refunds.shopId, shop.id), eq(refunds.id, Number(data.refundId)))).limit(1);
    if (!r) return null;
    vars.refund = { amount: moneyOf(shop, r.total, o.order.currency), note: r.note };
  }
  return { key, to: o.order.email, vars };
}
