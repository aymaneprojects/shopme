import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { events, orderDeliveries, orders } from '../db/schema';
import type { Db, Executor } from '../db/client';
import { orderVars, sendNotification } from '../mail/notifications';
import type { Mail, Mailer } from '../mail';
import { errR, okR, type Result } from './catalog/common';
import { addEvent } from './events';
import { createFulfillment } from './orders/fulfillments';
import { getOrderSummary } from './orders/create';
import { configOf } from './settings/config';
import type { Shop } from './shops';

/** A local delivery order and where it stands: out for delivery (open), delivered or missed. */
export interface LocalDeliveryRow { orderId: number; name: string; email: string | null; status: 'OPEN' | 'DELIVERED' | 'MISSED'; placedAt: Date }

async function localOrder(db: Executor, shopId: number, orderId: number) {
  const [o] = await db.select({ id: orders.id, cancelledAt: orders.cancelledAt, fulfillmentStatus: orders.fulfillmentStatus, type: orderDeliveries.methodType, locationId: orderDeliveries.locationId })
    .from(orders).leftJoin(orderDeliveries, eq(orderDeliveries.orderId, orders.id)).where(and(eq(orders.shopId, shopId), eq(orders.id, orderId))).limit(1);
  return o ?? null;
}

/**
 * The courier brought a local delivery order (`DELIVERED`: also fulfils what is left) or could not hand it over (`MISSED`).
 * Both are recorded on the order timeline and email the buyer (Settings > Notifications, Local delivery).
 */
export async function markLocalDelivery(db: Db, shopId: number, orderId: number, status: 'DELIVERED' | 'MISSED', staffId?: number | null): Promise<Result<LocalDeliveryRow>> {
  const o = await localOrder(db, shopId, orderId);
  if (!o) return errR(['orderId'], 'Order does not exist', 'NOT_FOUND');
  if (o.type !== 'LOCAL') return errR(['orderId'], 'This order is not a local delivery order', 'INVALID');
  if (o.cancelledAt) return errR(['orderId'], 'This order is cancelled', 'INVALID');
  if (status === 'DELIVERED' && o.fulfillmentStatus !== 'FULFILLED') {
    const f = await createFulfillment(db, shopId, orderId, { locationId: o.locationId, staffId, notifyCustomer: false });
    if (!f.ok && !f.errors.some((e) => e.message.includes('no items left'))) return f;
  }
  await addEvent(db, shopId, {
    subjectType: 'order', subjectId: orderId, verb: status === 'DELIVERED' ? 'order.local_delivered' : 'order.local_delivery_missed',
    message: status === 'DELIVERED' ? 'Marked as delivered' : 'Delivery attempt missed', authorStaffUserId: staffId,
  });
  return okR((await listLocalDeliveries(db, shopId)).find((r) => r.orderId === orderId) ?? { orderId, name: '', email: null, status, placedAt: new Date() });
}

/** Recent local delivery orders (newest first) with their delivery state, from the order timeline. */
export async function listLocalDeliveries(db: Executor, shopId: number, limit = 50): Promise<LocalDeliveryRow[]> {
  const rows = await db.select({ id: orders.id, name: orders.name, email: orders.email, placedAt: orders.createdAt }).from(orders)
    .innerJoin(orderDeliveries, eq(orderDeliveries.orderId, orders.id))
    .where(and(eq(orders.shopId, shopId), eq(orderDeliveries.methodType, 'LOCAL'), sql`${orders.cancelledAt} is null`)).orderBy(desc(orders.id)).limit(limit);
  if (!rows.length) return [];
  const ev = await db.select({ id: events.id, subjectId: events.subjectId, verb: events.verb }).from(events)
    .where(and(eq(events.shopId, shopId), eq(events.subjectType, 'order'), inArray(events.subjectId, rows.map((r) => r.id)), inArray(events.verb, ['order.local_delivered', 'order.local_delivery_missed']))).orderBy(events.id);
  const last = new Map<number, string>();
  for (const e of ev) if (e.subjectId != null && e.verb) last.set(e.subjectId, e.verb);
  return rows.map((r) => ({ orderId: r.id, name: r.name, email: r.email, placedAt: r.placedAt, status: last.get(r.id) === 'order.local_delivered' ? 'DELIVERED' : last.get(r.id) === 'order.local_delivery_missed' ? 'MISSED' : 'OPEN' }));
}

/** Settings > Notifications > Fulfillment request: email every fulfillment service that has an address. Returns how many were sent. */
export async function sendFulfillmentRequests(db: Executor, mailer: Mailer, shop: Shop, appUrl: string, orderId: number): Promise<number> {
  if (!configOf(shop, 'NOTIFICATIONS').fulfillmentRequest.enabled) return 0;
  const o = await getOrderSummary(db, shop.id, orderId);
  if (!o) return 0;
  let n = 0;
  for (const svc of configOf(shop, 'SHIPPING').fulfillmentServices) {
    if (!svc.email) continue;
    if (await sendNotification(db, mailer as Mailer, shop, appUrl, 'fulfillment_request', svc.email, { ...orderVars(o, shop), service: { name: svc.name } })) n++;
  }
  return n;
}

export type { Mail };
