import { and, eq } from 'drizzle-orm';
import { fulfillmentLines, fulfillments, locationPickupSettings, locations, orderDeliveries, orderLines, refunds } from '../db/schema';
import type { Executor } from '../db/client';
import { moneyOf, orderVars, type NotificationKey } from '../mail/notifications';
import { getOrderSummary } from './orders/create';
import type { Shop } from './shops';

/** Order event verbs (events table) that notify the customer when the staff action asked for it, and the template each one uses. */
export const ORDER_EMAIL_VERBS: Record<string, NotificationKey> = {
  'order.fulfilled': 'shipping_confirmation', 'order.tracking_updated': 'shipping_update', 'order.cancelled': 'order_cancelled', 'order.refunded': 'refund',
  'order.pickup_ready': 'pickup_ready', 'order.picked_up': 'pickup_picked_up', 'order.local_delivered': 'local_delivery_delivered', 'order.local_delivery_missed': 'local_delivery_missed',
};
/** Verbs whose email does not depend on a "notify customer" choice of the staff member: the buyer is waiting for them. */
export const AUTOMATIC_EMAIL_VERBS: ReadonlySet<string> = new Set(['order.pickup_ready', 'order.picked_up', 'order.local_delivered', 'order.local_delivery_missed']);

/** Recipient, template and Liquid variables for an order event, or null when nothing should be sent. Throws while the order is not readable yet (job retry). */
export async function orderEventMail(db: Executor, shop: Shop, verb: string, orderId: number, data: Record<string, unknown> | null): Promise<{ key: NotificationKey; to: string; vars: Record<string, unknown>; phone: string | null } | null> {
  let key = ORDER_EMAIL_VERBS[verb];
  if (!key || !(data?.notify || AUTOMATIC_EMAIL_VERBS.has(verb))) return null;
  const o = await getOrderSummary(db, shop.id, orderId);
  if (!o) throw new Error('order not readable yet');
  if (!o.order.email) return null;
  const vars = orderVars(o, shop);
  const [delivery] = await db.select({ methodType: orderDeliveries.methodType, locationId: orderDeliveries.locationId }).from(orderDeliveries).where(eq(orderDeliveries.orderId, orderId)).limit(1);
  if (delivery?.locationId) {
    const [l] = await db.select().from(locations).where(eq(locations.id, delivery.locationId)).limit(1);
    const [pick] = await db.select({ instructions: locationPickupSettings.instructions }).from(locationPickupSettings).where(eq(locationPickupSettings.locationId, delivery.locationId)).limit(1);
    vars.location = { name: l?.name ?? '', address: l ? [l.address1, [l.zip, l.city].filter(Boolean).join(' ')].filter(Boolean).join(', ') : '', instructions: pick?.instructions ?? '' };
  } else vars.location = { name: '', address: '', instructions: '' };
  // A local delivery is "out for delivery" rather than "shipped".
  if (key === 'shipping_confirmation' && delivery?.methodType === 'LOCAL') key = 'local_delivery_out';
  if (key === 'shipping_confirmation' || key === 'shipping_update' || key === 'local_delivery_out') {
    const [f] = await db.select().from(fulfillments).where(and(eq(fulfillments.shopId, shop.id), eq(fulfillments.id, Number(data?.fulfillmentId)))).limit(1);
    if (!f) return null;
    const lines = await db.select({ title: orderLines.title, variantTitle: orderLines.variantTitle, quantity: fulfillmentLines.quantity }).from(fulfillmentLines)
      .innerJoin(orderLines, eq(orderLines.id, fulfillmentLines.orderLineId)).where(eq(fulfillmentLines.fulfillmentId, f.id));
    vars.fulfillment = {
      name: f.name, tracking_company: f.trackingCompany, tracking_number: f.trackingNumbers[0] ?? null, tracking_url: f.trackingUrls[0] ?? null, tracking_numbers: f.trackingNumbers,
      line_items: lines.map((l) => ({ title: [l.title, l.variantTitle].filter(Boolean).join(' - '), quantity: l.quantity })),
    };
  } else if (key === 'refund') {
    const [r] = await db.select().from(refunds).where(and(eq(refunds.shopId, shop.id), eq(refunds.id, Number(data?.refundId)))).limit(1);
    if (!r) return null;
    vars.refund = { amount: moneyOf(shop, r.total, o.order.currency), note: r.note };
  }
  return { key, to: o.order.email, vars, phone: o.order.phone };
}
