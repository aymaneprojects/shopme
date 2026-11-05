import { eq, and, asc, gt, sql } from 'drizzle-orm';
import { fulfillmentLines, fulfillments, inventoryAdjustments, inventoryItems, inventoryLevels, orderLines, orders } from '../../db/schema';
import type { Db, Executor } from '../../db/client';
import { errR, okR, txResult, type Result } from '../catalog/common';
import { defaultLocationId, getLocation } from '../catalog/inventory';
import { addEvent } from '../events';
import { getOrder, getOrderDetail, type Fulfillment, type Order } from './orders';

/**
 * Goods leave the building: release the stock committed by the order and take it off the shelf (committed and on_hand both go
 * down, available is unchanged since it was already reserved at checkout). No-op for untracked variants.
 */
async function shipCommittedStock(tx: Executor, shopId: number, variantId: number | null, quantity: number, orderId: number, preferred?: number | null): Promise<void> {
  if (!variantId || quantity <= 0) return;
  const [item] = await tx.select({ id: inventoryItems.id, tracked: inventoryItems.tracked }).from(inventoryItems)
    .where(and(eq(inventoryItems.shopId, shopId), eq(inventoryItems.variantId, variantId))).limit(1);
  if (!item?.tracked) return;
  const levels = await tx.select().from(inventoryLevels)
    .where(and(eq(inventoryLevels.inventoryItemId, item.id), eq(inventoryLevels.shopId, shopId), gt(inventoryLevels.committed, 0))).orderBy(sql`(${inventoryLevels.locationId} = ${preferred ?? 0}) desc`, asc(inventoryLevels.id));
  let left = quantity;
  for (const lv of levels) {
    if (left <= 0) break;
    const n = Math.min(left, lv.committed);
    const [upd] = await tx.update(inventoryLevels).set({ committed: sql`${inventoryLevels.committed} - ${n}`, onHand: sql`${inventoryLevels.onHand} - ${n}` })
      .where(eq(inventoryLevels.id, lv.id)).returning({ committed: inventoryLevels.committed, onHand: inventoryLevels.onHand });
    const ref = `shopme://orders/${orderId}`;
    await tx.insert(inventoryAdjustments).values([
      { shopId, inventoryItemId: item.id, locationId: lv.locationId, name: 'committed', delta: -n, quantityAfter: upd!.committed, reason: 'other', referenceUri: ref },
      { shopId, inventoryItemId: item.id, locationId: lv.locationId, name: 'on_hand', delta: -n, quantityAfter: upd!.onHand, reason: 'other', referenceUri: ref },
    ]);
    left -= n;
  }
}

export interface TrackingInput { company?: string | null; numbers?: string[]; urls?: string[] }

/**
 * Simplified fulfillment: fulfil all remaining items or the given `{orderLineId, quantity}` selection in one go.
 * Sets the order's fulfillment status (UNFULFILLED -> PARTIALLY_FULFILLED -> FULFILLED).
 */
export async function createFulfillment(
  db: Db, shopId: number, orderId: number, o: { lines?: { orderLineId: number; quantity: number }[] | null; tracking?: TrackingInput | null; notifyCustomer?: boolean; staffId?: number | null; locationId?: number | null },
): Promise<Result<{ order: Order; fulfillment: Fulfillment }>> {
  const order = await getOrder(db, shopId, orderId);
  if (!order) return errR(['fulfillment', 'orderId'], 'Order does not exist');
  if (order.cancelledAt) return errR(['fulfillment'], 'Cannot fulfill a cancelled order');
  return txResult(db, async (tx) => {
    const d = await getOrderDetail(tx, shopId, orderId);
    const remaining = (l: (typeof d.lines)[number]) => l.currentQuantity - l.fulfilledQuantity;
    const picks = o.lines?.length
      ? o.lines
      : d.lines.filter((l) => remaining(l) > 0).map((l) => ({ orderLineId: l.id, quantity: remaining(l) }));
    if (!picks.length) return errR(['fulfillment'], 'There are no items left to fulfill');
    for (const [i, p] of picks.entries()) {
      const line = d.lines.find((l) => l.id === p.orderLineId);
      if (!line) return errR(['fulfillment', 'lineItems', String(i), 'id'], 'Line item does not exist');
      if (p.quantity <= 0 || p.quantity > remaining(line)) return errR(['fulfillment', 'lineItems', String(i), 'quantity'], `Quantity must be between 1 and ${remaining(line)}`);
    }
    if (o.locationId && !(await getLocation(tx, shopId, o.locationId))?.isActive) return errR(['fulfillment', 'locationId'], 'Location does not exist or is inactive');
    const locationId = o.locationId ?? (await defaultLocationId(tx, shopId));
    const [f] = await tx.insert(fulfillments).values({
      shopId, orderId, locationId, name: `${order.name}.${d.fulfillments.length + 1}`, status: 'SUCCESS',
      trackingCompany: o.tracking?.company ?? null, trackingNumbers: o.tracking?.numbers ?? [], trackingUrls: o.tracking?.urls ?? [], notifyCustomer: !!o.notifyCustomer,
    }).returning();
    const lines = await tx.insert(fulfillmentLines).values(picks.map((p) => ({ shopId, fulfillmentId: f!.id, orderLineId: p.orderLineId, quantity: p.quantity }))).returning();
    for (const p of picks) {
      const line = d.lines.find((l) => l.id === p.orderLineId)!;
      line.fulfilledQuantity += p.quantity;
      await tx.update(orderLines).set({ fulfilledQuantity: line.fulfilledQuantity }).where(eq(orderLines.id, line.id));
      await shipCommittedStock(tx, shopId, line.variantId, p.quantity, orderId, locationId);
    }
    const all = d.lines.every((l) => remaining(l) <= 0);
    const [updated] = await tx.update(orders).set({ fulfillmentStatus: all ? 'FULFILLED' : 'PARTIALLY_FULFILLED', updatedAt: new Date() }).where(eq(orders.id, orderId)).returning();
    await addEvent(tx, shopId, { subjectType: 'order', subjectId: orderId, verb: 'order.fulfilled', message: `Fulfilled ${picks.reduce((s, p) => s + p.quantity, 0)} item(s) (${f!.name})`, authorStaffUserId: o.staffId, data: { fulfillmentId: f!.id, notify: !!o.notifyCustomer } });
    return okR({ order: updated!, fulfillment: { ...f!, lines } });
  });
}

export async function getFulfillment(db: Db, shopId: number, id: number): Promise<Fulfillment | null> {
  const [f] = await db.select().from(fulfillments).where(and(eq(fulfillments.shopId, shopId), eq(fulfillments.id, id)));
  if (!f) return null;
  return { ...f, lines: await db.select().from(fulfillmentLines).where(eq(fulfillmentLines.fulfillmentId, id)) };
}

export async function updateTracking(db: Db, shopId: number, id: number, tracking: TrackingInput, notify?: boolean): Promise<Result<Fulfillment>> {
  const f = await getFulfillment(db, shopId, id);
  if (!f) return errR(['fulfillmentId'], 'Fulfillment does not exist');
  const [row] = await db.update(fulfillments).set({
    ...(tracking.company !== undefined && { trackingCompany: tracking.company }),
    ...(tracking.numbers && { trackingNumbers: tracking.numbers }), ...(tracking.urls && { trackingUrls: tracking.urls }),
    ...(notify != null && { notifyCustomer: notify }), updatedAt: new Date(),
  }).where(eq(fulfillments.id, id)).returning();
  await addEvent(db, shopId, { subjectType: 'order', subjectId: f.orderId, verb: 'order.tracking_updated', message: `Tracking updated for ${f.name}`, data: { fulfillmentId: id, notify: !!notify } });
  return okR({ ...row!, lines: f.lines });
}
