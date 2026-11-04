import { eq } from 'drizzle-orm';
import { orderLines, orders, refundLines, refunds, transactions } from '../../db/schema';
import type { Db } from '../../db/client';
import { errR, okR, txResult, type Result } from '../catalog/common';
import { addEvent } from '../events';
import { getOrder, getOrderDetail, paidAmounts, restockVariant, type Order, type Refund } from './orders';

export interface RefundLineInput { orderLineId: number; quantity: number; restockType?: 'RETURN' | 'CANCEL' | 'LEGACY_RESTOCK' | 'NO_RESTOCK' | null; locationId?: number | null }
export interface RefundInput {
  note?: string | null;
  lines?: RefundLineInput[];
  /** Refund shipping: all of it, or a fixed amount (minor units). */
  shipping?: { full?: boolean | null; amount?: number | null } | null;
  /** Restock lines that do not name a restock type. */
  restock?: boolean;
  /** Explicit refund total in minor units (cancel-with-refund). Otherwise lines + shipping, or the sum of `transactions`. */
  amount?: number;
  /** Refund transactions to record (amounts in minor units). Defaults to one transaction for the refund total. */
  transactions?: { amount: number; gateway?: string | null; parentId?: number | null }[] | null;
  allowOverRefunding?: boolean;
  processedAt?: Date | null;
  staffId?: number | null;
}

/**
 * Create a refund: line items (with optional restock), shipping, and the REFUND transaction records.
 * ShopMe records the money movement; paying it back through a provider is the payment adapter's job.
 */
export async function refundOrder(db: Db, shopId: number, orderId: number, input: RefundInput): Promise<Result<{ order: Order; refund: Refund }>> {
  const order = await getOrder(db, shopId, orderId);
  if (!order) return errR(['orderId'], 'Order does not exist');
  return txResult(db, async (tx) => {
    const d = await getOrderDetail(tx, shopId, orderId);
    const byId = new Map(d.lines.map((l) => [l.id, l]));
    let computed = 0;
    const lineRows: (typeof refundLines.$inferInsert)[] = [];
    for (const [i, rl] of (input.lines ?? []).entries()) {
      const line = byId.get(rl.orderLineId);
      if (!line) return errR(['refundLineItems', String(i), 'lineItemId'], 'Line item does not exist');
      if (rl.quantity <= 0 || rl.quantity > line.currentQuantity) return errR(['refundLineItems', String(i), 'quantity'], `Quantity cannot refund more items than were purchased (${line.currentQuantity} refundable)`);
      const subtotal = Math.round((line.discountedTotal * rl.quantity) / line.quantity);
      const tax = Math.round((line.totalTax * rl.quantity) / line.quantity);
      computed += subtotal + (order.taxesIncluded ? 0 : tax);
      const type = rl.restockType ?? (input.restock ? 'RETURN' : 'NO_RESTOCK');
      lineRows.push({ shopId, refundId: 0, orderLineId: line.id, quantity: rl.quantity, restockType: type, locationId: rl.locationId ?? null, subtotal, totalTax: tax });
    }
    let shipping = 0;
    if (input.shipping?.amount != null) shipping = input.shipping.amount;
    else if (input.shipping?.full) shipping = order.totalShipping;
    computed += shipping;

    const given = input.transactions?.reduce((s, t) => s + t.amount, 0);
    const total = input.amount ?? given ?? computed;
    if (total <= 0 && !lineRows.length) return errR(['refundLineItems'], 'Nothing to refund');
    if (total < 0) return errR(['transactions'], 'Refund amount must be positive');
    const { received, refunded } = paidAmounts(d.transactions);
    if (!input.allowOverRefunding && total > received - refunded) return errR(['transactions'], `Refund amount exceeds the refundable amount (${received - refunded} minor units)`);

    const now = new Date();
    const [refund] = await tx.insert(refunds).values({ shopId, orderId, note: input.note ?? null, total, processedAt: input.processedAt ?? now, createdAt: now }).returning();
    const insertedLines = lineRows.length ? await tx.insert(refundLines).values(lineRows.map((r) => ({ ...r, refundId: refund!.id }))).returning() : [];
    const sale = d.transactions.find((t) => ['SALE', 'CAPTURE'].includes(t.kind) && t.status === 'SUCCESS');
    const txInputs = input.transactions?.length ? input.transactions : total > 0 ? [{ amount: total, gateway: sale?.gateway ?? 'manual', parentId: sale?.id ?? null }] : [];
    const txRows = txInputs.length
      ? await tx.insert(transactions).values(txInputs.map((t) => ({
        shopId, orderId, kind: 'REFUND', status: 'SUCCESS', gateway: t.gateway ?? sale?.gateway ?? 'manual', amount: t.amount, currency: order.currency, test: order.test,
        parentId: t.parentId ?? sale?.id ?? null, processedAt: now, createdAt: now,
      }))).returning()
      : [];

    for (const r of insertedLines) {
      const line = byId.get(r.orderLineId)!;
      await tx.update(orderLines).set({ currentQuantity: line.currentQuantity - r.quantity }).where(eq(orderLines.id, line.id));
      if (r.restockType && r.restockType !== 'NO_RESTOCK') await restockVariant(tx, shopId, line.variantId, r.quantity, r.locationId, `shopme://orders/${order.name}`, line.currentQuantity - line.fulfilledQuantity);
    }
    const totalRefunded = order.totalRefunded + total;
    const [updated] = await tx.update(orders).set({
      totalRefunded, updatedAt: now,
      ...(received > 0 && { financialStatus: totalRefunded >= order.total ? 'REFUNDED' : 'PARTIALLY_REFUNDED' }),
    }).where(eq(orders.id, orderId)).returning();
    await addEvent(tx, shopId, { subjectType: 'order', subjectId: orderId, verb: 'order.refunded', message: `Refunded ${total} (minor units)${input.note ? `: ${input.note}` : ''}`, authorStaffUserId: input.staffId, data: { refundId: refund!.id, total } });
    return okR({ order: updated!, refund: { ...refund!, lines: insertedLines, transactions: txRows } });
  });
}

export const CANCEL_REASONS = ['CUSTOMER', 'DECLINED', 'FRAUD', 'INVENTORY', 'STAFF', 'OTHER'] as const;

export async function cancelOrder(
  db: Db, shopId: number, id: number, o: { reason: string; restock: boolean; refund?: boolean; staffNote?: string | null; staffId?: number | null },
): Promise<Result<Order>> {
  const cur = await getOrder(db, shopId, id);
  if (!cur) return errR(['orderId'], 'Order does not exist', 'NOT_FOUND');
  if (cur.cancelledAt) return errR(['orderId'], 'Cannot cancel an order that has already been cancelled.', 'INVALID');
  return txResult(db, async (tx) => {
    const d = await getOrderDetail(tx, shopId, id);
    if (o.refund) {
      const { received, refunded } = paidAmounts(d.transactions);
      if (received - refunded > 0) {
        const r = await refundOrder(tx as unknown as Db, shopId, id, { note: o.staffNote ?? 'Order cancelled', amount: received - refunded, staffId: o.staffId });
        if (!r.ok) return r;
      }
    }
    if (o.restock) for (const l of d.lines) { const open = l.currentQuantity - l.fulfilledQuantity; await restockVariant(tx, shopId, l.variantId, open, null, `shopme://orders/${cur.name}`, open); }
    const fresh = (await getOrder(tx, shopId, id))!;
    const unpaid = ['PENDING', 'AUTHORIZED'].includes(fresh.financialStatus);
    const now = new Date();
    const [row] = await tx.update(orders).set({
      cancelledAt: now, closedAt: fresh.closedAt ?? now, cancelReason: o.reason, updatedAt: now,
      ...(unpaid && { financialStatus: 'VOIDED' }), ...(o.restock && d.lines.every((l) => l.fulfilledQuantity === 0) && { fulfillmentStatus: 'RESTOCKED' }),
    }).where(eq(orders.id, id)).returning();
    await addEvent(tx, shopId, { subjectType: 'order', subjectId: id, verb: 'order.cancelled', message: `Order was cancelled (${o.reason.toLowerCase()})${o.staffNote ? `: ${o.staffNote}` : ''}`, authorStaffUserId: o.staffId, data: { reason: o.reason, restock: o.restock } });
    return okR(row!);
  });
}
