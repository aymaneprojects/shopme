import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { collectionProducts, orderLines, returnLines, returns, shops } from '../db/schema';
import { configOf } from './settings/config';
import type { Db, Executor } from '../db/client';
import { errR, okR, txResult, type Result } from './catalog/common';
import { addEvent } from './events';
import { getOrder, restockVariant, type OrderLine } from './orders/orders';
import { finalSaleProductIds, returnRulesOf, returnWindowStart } from './return-rules';

export type Return = typeof returns.$inferSelect;
export type ReturnLine = typeof returnLines.$inferSelect;
export type ReturnWithLines = Return & { lines: ReturnLine[] };
export const RETURN_REASONS = ['SIZE_TOO_SMALL', 'SIZE_TOO_LARGE', 'UNWANTED', 'NOT_AS_DESCRIBED', 'WRONG_ITEM', 'DEFECTIVE', 'STYLE', 'COLOR', 'OTHER', 'UNKNOWN'] as const;

export interface ReturnLineInput { orderLineId: number; quantity: number; reason?: string | null; note?: string | null; restock?: boolean; locationId?: number | null }

async function withLines(db: Executor, rows: Return[]): Promise<ReturnWithLines[]> {
  if (!rows.length) return [];
  const lines = await db.select().from(returnLines).where(inArray(returnLines.returnId, rows.map((r) => r.id))).orderBy(asc(returnLines.id));
  return rows.map((r) => ({ ...r, lines: lines.filter((l) => l.returnId === r.id) }));
}

export async function getReturn(db: Executor, shopId: number, id: number): Promise<ReturnWithLines | null> {
  const [r] = await db.select().from(returns).where(and(eq(returns.shopId, shopId), eq(returns.id, id))).limit(1);
  return r ? (await withLines(db, [r]))[0]! : null;
}

export async function listReturns(db: Executor, shopId: number, orderId: number): Promise<ReturnWithLines[]> {
  return withLines(db, await db.select().from(returns).where(and(eq(returns.shopId, shopId), eq(returns.orderId, orderId))).orderBy(desc(returns.id)));
}

/** Units of each order line that are fulfilled and not already part of a live (requested or open) or closed return. */
export async function returnableQuantities(db: Executor, shopId: number, orderId: number): Promise<Map<number, number>> {
  const lines = await db.select().from(orderLines).where(and(eq(orderLines.shopId, shopId), eq(orderLines.orderId, orderId)));
  const used = await db.select({ lineId: returnLines.orderLineId, n: sql<number>`sum(${returnLines.quantity})::int` }).from(returnLines).innerJoin(returns, eq(returns.id, returnLines.returnId))
    .where(and(eq(returns.orderId, orderId), inArray(returns.status, ['REQUESTED', 'OPEN', 'CLOSED']))).groupBy(returnLines.orderLineId);
  return new Map(lines.map((l: OrderLine) => [l.id, Math.max(0, Math.min(l.fulfilledQuantity, l.currentQuantity) - (used.find((u) => u.lineId === l.id)?.n ?? 0))]));
}

/** Create a return (status OPEN) or a return request from the customer (REQUESTED, waiting for `approveReturn`). */
export async function createReturn(db: Db, shopId: number, orderId: number, lines: ReturnLineInput[], o: { requested?: boolean; note?: string | null; staffId?: number | null; ignoreRules?: boolean; now?: Date } = {}): Promise<Result<ReturnWithLines>> {
  const order = await getOrder(db, shopId, orderId);
  if (!order) return errR(['orderId'], 'Order does not exist', 'NOT_FOUND');
  if (!lines.length) return errR(['returnLineItems'], 'Select at least one item to return', 'BLANK');
  // Shop return rules (Settings > Policies): window and final sale items are validated, fees become the return's defaults.
  const [shopRow] = await db.select({ settings: shops.settings }).from(shops).where(eq(shops.id, shopId));
  const defaults = returnRulesOf({ settings: shopRow?.settings ?? {} });
  let rules = defaults;
  const lineRows = await db.select({ id: orderLines.id, productId: orderLines.productId, title: orderLines.title }).from(orderLines).where(and(eq(orderLines.orderId, orderId), inArray(orderLines.id, lines.map((l) => l.orderLineId))));
  // Settings > Policies > return rule sets: items of a rule set's collections follow that set instead of the default rules.
  const sets = configOf({ settings: shopRow?.settings ?? {} }, 'RETURNS').ruleSets;
  const memberships = sets.length && lineRows.length
    ? await db.select({ p: collectionProducts.productId, c: collectionProducts.collectionId }).from(collectionProducts).where(and(eq(collectionProducts.shopId, shopId), inArray(collectionProducts.productId, lineRows.flatMap((r) => (r.productId ? [r.productId] : []))), inArray(collectionProducts.collectionId, sets.flatMap((x) => x.collectionIds))))
    : [];
  const ruleOf = (productId: number | null) => {
    const set = productId ? sets.find((x) => x.collectionIds.some((c) => memberships.some((m) => m.p === productId && m.c === c))) : undefined;
    return set ? { ...defaults, windowDays: set.windowDays, shippingCost: set.shippingCost, shippingFee: set.shippingFee, restockingFeePercent: set.restockingFeePercent } : defaults;
  };
  const perLine = lineRows.map((r) => ruleOf(r.productId));
  const distinct = [...new Map(perLine.map((r) => [JSON.stringify([r.windowDays, r.shippingCost, r.shippingFee, r.restockingFeePercent]), r])).values()];
  if (distinct.length === 1) rules = distinct[0]!;
  if (!o.ignoreRules) {
    for (const [i, r] of perLine.entries()) {
      if (r.windowDays === null) continue;
      const since = await returnWindowStart(db, shopId, orderId, order.createdAt);
      if (((o.now ?? new Date()).getTime() - since.getTime()) / 86_400_000 > r.windowDays) return errR(['returnLineItems'], r.windowDays === 0 ? `${lineRows[i]!.title} cannot be returned` : `The ${r.windowDays}-day return window for this order has passed`, 'INVALID');
    }
    const finals = await finalSaleProductIds(db, shopId, defaults, lineRows.flatMap((r) => (r.productId ? [r.productId] : [])));
    for (const [i, l] of lines.entries()) {
      const row = lineRows.find((r) => r.id === l.orderLineId);
      if (row?.productId && finals.has(row.productId)) return errR(['returnLineItems', String(i), 'fulfillmentLineItemId'], `${row.title} is a final sale item and cannot be returned`, 'INVALID');
    }
  }
  return txResult(db, async (tx) => {
    const room = await returnableQuantities(tx, shopId, orderId);
    const wanted = new Map<number, number>();
    for (const [i, l] of lines.entries()) {
      if (!room.has(l.orderLineId)) return errR(['returnLineItems', String(i), 'fulfillmentLineItemId'], 'Line item does not exist', 'NOT_FOUND');
      if (!Number.isInteger(l.quantity) || l.quantity < 1) return errR(['returnLineItems', String(i), 'quantity'], 'Quantity must be greater than 0', 'GREATER_THAN');
      const total = (wanted.get(l.orderLineId) ?? 0) + l.quantity;
      wanted.set(l.orderLineId, total);
      if (total > room.get(l.orderLineId)!) return errR(['returnLineItems', String(i), 'quantity'], `Only ${room.get(l.orderLineId)} fulfilled item(s) can still be returned`, 'INVALID');
      if (l.reason && !(RETURN_REASONS as readonly string[]).includes(l.reason)) return errR(['returnLineItems', String(i), 'returnReason'], 'Return reason is invalid', 'INVALID');
    }
    const [count] = await tx.select({ n: sql<number>`count(*)::int` }).from(returns).where(eq(returns.orderId, orderId));
    const number = (count?.n ?? 0) + 1;
    const now = new Date();
    const [r] = await tx.insert(returns).values({
      shopId, orderId, number, name: `${order.name}-R${number}`, status: o.requested ? 'REQUESTED' : 'OPEN', note: o.note ?? null, requestApprovedAt: o.requested ? null : now,
      returnShippingFee: rules.shippingCost === 'customer_fixed' ? rules.shippingFee : 0, restockingFeeBps: Math.round(rules.restockingFeePercent * 100),
    }).returning();
    await tx.insert(returnLines).values(lines.map((l) => ({
      shopId, returnId: r!.id, orderLineId: l.orderLineId, quantity: l.quantity, reason: l.reason ?? 'UNKNOWN', note: l.note ?? null, restockType: l.restock ? 'RETURN' : 'NO_RESTOCK', locationId: l.locationId ?? null,
    })));
    await addEvent(tx, shopId, { subjectType: 'order', subjectId: orderId, verb: o.requested ? 'order.return_requested' : 'order.return_created', message: `Return ${r!.name} ${o.requested ? 'was requested' : 'was created'}`, authorStaffUserId: o.staffId, data: { returnId: r!.id } });
    return okR((await getReturn(tx, shopId, r!.id))!);
  });
}

export async function approveReturn(db: Db, shopId: number, id: number, staffId?: number | null): Promise<Result<ReturnWithLines>> {
  const cur = await getReturn(db, shopId, id);
  if (!cur) return errR(['id'], 'Return does not exist', 'NOT_FOUND');
  if (cur.status !== 'REQUESTED') return errR(['id'], 'Only a requested return can be approved', 'INVALID_STATE');
  const now = new Date();
  await db.update(returns).set({ status: 'OPEN', requestApprovedAt: now, updatedAt: now }).where(eq(returns.id, id));
  await addEvent(db, shopId, { subjectType: 'order', subjectId: cur.orderId, verb: 'order.return_approved', message: `Return ${cur.name} was approved`, authorStaffUserId: staffId, data: { returnId: id } });
  return okR((await getReturn(db, shopId, id))!);
}

/** Close an open return: items marked for restocking go back on the shelf (once). */
export async function closeReturn(db: Db, shopId: number, id: number, staffId?: number | null): Promise<Result<ReturnWithLines>> {
  const cur = await getReturn(db, shopId, id);
  if (!cur) return errR(['id'], 'Return does not exist', 'NOT_FOUND');
  if (cur.status !== 'OPEN') return errR(['id'], 'Only an open return can be closed', 'INVALID_STATE');
  return txResult(db, async (tx) => {
    const orderLineRows = await tx.select().from(orderLines).where(inArray(orderLines.id, cur.lines.map((l) => l.orderLineId)));
    for (const l of cur.lines) {
      if (l.restockType !== 'RETURN' || l.restocked) continue;
      await restockVariant(tx, shopId, orderLineRows.find((x) => x.id === l.orderLineId)?.variantId ?? null, l.quantity, l.locationId, `shopme://returns/${cur.name}`, 0);
      await tx.update(returnLines).set({ restocked: true }).where(eq(returnLines.id, l.id));
    }
    const now = new Date();
    await tx.update(returns).set({ status: 'CLOSED', closedAt: now, updatedAt: now }).where(eq(returns.id, id));
    await addEvent(tx, shopId, { subjectType: 'order', subjectId: cur.orderId, verb: 'order.return_closed', message: `Return ${cur.name} was closed`, authorStaffUserId: staffId, data: { returnId: id } });
    return okR((await getReturn(tx, shopId, id))!);
  });
}
