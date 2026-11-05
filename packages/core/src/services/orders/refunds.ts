import { and, eq, sql } from 'drizzle-orm';
import { giftCardTransactions, giftCards, orderLines, orders, refundLines, refunds, transactions } from '../../db/schema';
import type { Db } from '../../db/client';
import { decimal } from '../import-export/common';
import { errR, okR, txResult, type Result } from '../catalog/common';
import { addEvent } from '../events';
import { creditStoreCredit, type StoreCreditEvent } from '../store-credit';
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
  /** Refund part of the amount as store credit for the order's customer (the "Store credit" refund destination). */
  storeCredit?: { amount: number; expiresAt?: Date | null } | null;
  /** Why store credit is issued by this refund (cancelling an order restores the credit it spent). */
  storeCreditEvent?: StoreCreditEvent;
  /** Send the refund notification email. */
  notifyCustomer?: boolean;
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
    const toCreditPre = input.storeCredit?.amount ?? 0;
    // Explicit transactions describe the non-credit part of the refund; the store credit part is on top of them.
    const total = input.amount ?? (given != null ? given + toCreditPre : Math.max(computed, toCreditPre));
    if (total <= 0 && !lineRows.length) return errR(['refundLineItems'], 'Nothing to refund');
    if (total < 0) return errR(['transactions'], 'Refund amount must be positive');
    if (input.storeCredit) {
      if (!order.customerId) return errR(['refundMethods'], 'A store credit refund needs a customer on the order', 'STORE_CREDIT_REFUND_MISSING_CUSTOMER');
      if (!Number.isInteger(toCreditPre) || toCreditPre <= 0 || toCreditPre > total) return errR(['refundMethods'], 'The store credit amount must be positive and not above the refund', 'INVALID');
      if (input.storeCredit.expiresAt && input.storeCredit.expiresAt.getTime() <= Date.now()) return errR(['refundMethods'], 'The expiration date must be in the future', 'STORE_CREDIT_REFUND_EXPIRATION_IN_PAST');
    }
    const { received, refunded } = paidAmounts(d.transactions);
    if (!input.allowOverRefunding && total > received - refunded) return errR(['transactions'], `Refund amount exceeds the refundable amount (${received - refunded} minor units)`);

    const now = new Date();
    const [refund] = await tx.insert(refunds).values({ shopId, orderId, note: input.note ?? null, total, processedAt: input.processedAt ?? now, createdAt: now }).returning();
    const insertedLines = lineRows.length ? await tx.insert(refundLines).values(lineRows.map((r) => ({ ...r, refundId: refund!.id }))).returning() : [];
    const sale = d.transactions.find((t) => ['SALE', 'CAPTURE'].includes(t.kind) && t.status === 'SUCCESS' && !nonCash(t.gateway))
      ?? d.transactions.find((t) => ['SALE', 'CAPTURE'].includes(t.kind) && t.status === 'SUCCESS');
    const toCredit = toCreditPre;
    const rest = total - toCredit;
    const txInputs: { amount: number; gateway?: string | null; parentId?: number | null }[] = [
      ...(input.transactions?.length ? input.transactions : rest > 0 ? allocateRefund(d.transactions, rest, sale) : []),
      ...(toCredit > 0 ? [{ amount: toCredit, gateway: 'store_credit', parentId: null }] : []),
    ];
    const txRows = txInputs.length
      ? await tx.insert(transactions).values(txInputs.map((t) => {
        const parent = d.transactions.find((x) => x.id === (t.parentId ?? -1));
        const gateway = t.gateway ?? parent?.gateway ?? sale?.gateway ?? 'manual';
        return {
          shopId, orderId, kind: 'REFUND', status: 'SUCCESS', gateway, amount: t.amount, currency: order.currency, test: order.test,
          parentId: t.parentId ?? (nonCash(gateway) ? null : sale?.id ?? null), giftCardId: gateway === 'gift_card' ? parent?.giftCardId ?? null : null, processedAt: now, createdAt: now,
        };
      })).returning()
      : [];
    // Gift card payments are paid back onto the card balance.
    for (const row of txRows.filter((r) => r.gateway === 'gift_card')) {
      const cardId = row.giftCardId ?? (await legacyGiftCardId(tx, shopId, orderId, d.transactions, row.parentId));
      if (!cardId) continue;
      const [card] = await tx.update(giftCards).set({ balance: sql`${giftCards.balance} + ${row.amount}`, updatedAt: now }).where(and(eq(giftCards.id, cardId), eq(giftCards.shopId, shopId))).returning({ id: giftCards.id });
      if (!card) continue;
      await tx.insert(giftCardTransactions).values({ shopId, giftCardId: cardId, amount: row.amount, orderId, note: `Refund ${order.name}`, processedAt: now });
      if (!row.giftCardId) await tx.update(transactions).set({ giftCardId: cardId }).where(eq(transactions.id, row.id));
      row.giftCardId = cardId;
    }

    // Store credit payments (and refunds to credit) are paid back as credit: spending is restored, a refund destination is issued with its expiry.
    for (const row of txRows.filter((r) => r.gateway === 'store_credit')) {
      const explicit = row.parentId === null && toCredit > 0 && row.amount === toCredit;
      const r = await creditStoreCredit(tx as unknown as Db, shopId, {
        customerId: order.customerId, amount: row.amount, currency: order.currency, event: explicit ? 'ORDER_REFUND' : input.storeCreditEvent ?? 'ORDER_REFUND',
        expiresAt: explicit ? input.storeCredit?.expiresAt ?? null : null, orderId, staffUserId: input.staffId, skipLimit: true, note: `Refund ${order.name}`,
      });
      if (!r.ok) return errR(['refundMethods'], r.errors[0]?.message ?? 'The store credit could not be issued', 'INVALID');
    }

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
    await addEvent(tx, shopId, { subjectType: 'order', subjectId: orderId, verb: 'order.refunded', message: `Refunded ${decimal(total, order.currency)} ${order.currency}${input.note ? `: ${input.note}` : ''}`, authorStaffUserId: input.staffId, data: { refundId: refund!.id, total, currency: order.currency, note: input.note ?? null, giftCard: txRows.filter((r) => r.gateway === 'gift_card').reduce((n, r) => n + r.amount, 0), storeCredit: txRows.filter((r) => r.gateway === 'store_credit').reduce((n, r) => n + r.amount, 0), notify: !!input.notifyCustomer } });
    return okR({ order: updated!, refund: { ...refund!, lines: insertedLines, transactions: txRows } });
  });
}

/** Tenders that are not cash: they are paid back onto the gift card balance or as store credit. */
const NON_CASH = ['gift_card', 'store_credit'];
const nonCash = (g: string | null | undefined) => !!g && NON_CASH.includes(g);

/**
 * Split a refund over the payment methods that took the money: the card/gateway payment first (up to what is still refundable on it), whatever
 * is left goes back onto the gift cards that paid part of the order, in the order they were used.
 */
function allocateRefund(txs: (typeof transactions.$inferSelect)[], total: number, sale: (typeof transactions.$inferSelect) | undefined) {
  const ok = (t: typeof transactions.$inferSelect) => t.status === 'SUCCESS';
  const refundedOn = (pred: (t: typeof transactions.$inferSelect) => boolean) => txs.filter((t) => ok(t) && t.kind === 'REFUND' && pred(t)).reduce((n, t) => n + t.amount, 0);
  const prepaid = txs.filter((t) => ok(t) && t.kind === 'SALE' && nonCash(t.gateway));
  if (!prepaid.length) return [{ amount: total, gateway: sale?.gateway ?? 'manual', parentId: sale?.id ?? null }];
  const cashPaid = txs.filter((t) => ok(t) && ['SALE', 'CAPTURE'].includes(t.kind) && !nonCash(t.gateway)).reduce((n, t) => n + t.amount, 0);
  const cash = Math.max(0, Math.min(total, cashPaid - refundedOn((t) => !nonCash(t.gateway))));
  const out: { amount: number; gateway?: string | null; parentId?: number | null }[] = cash > 0 ? [{ amount: cash, gateway: sale?.gateway ?? 'manual', parentId: sale && !nonCash(sale.gateway) ? sale.id : null }] : [];
  let left = total - cash;
  for (const g of prepaid) {
    if (left <= 0) break;
    const room = g.amount - refundedOn((t) => t.parentId === g.id);
    const n = Math.min(left, Math.max(0, room));
    if (n > 0) { out.push({ amount: n, gateway: g.gateway, parentId: g.id }); left -= n; }
  }
  if (left > 0) out.push({ amount: left, gateway: sale?.gateway ?? 'manual', parentId: sale?.id ?? null }); // over-refunding: nothing else to credit
  return out;
}

/** Orders paid before gift card transactions were linked to their card: match by order and amount. */
async function legacyGiftCardId(tx: Parameters<typeof getOrderDetail>[0], shopId: number, orderId: number, txs: (typeof transactions.$inferSelect)[], parentId: number | null): Promise<number | null> {
  const parent = txs.find((t) => t.id === parentId);
  if (!parent) return null;
  const [row] = await tx.select({ id: giftCardTransactions.giftCardId }).from(giftCardTransactions)
    .where(and(eq(giftCardTransactions.shopId, shopId), eq(giftCardTransactions.orderId, orderId), eq(giftCardTransactions.amount, -parent.amount))).limit(1);
  return row?.id ?? null;
}

export const CANCEL_REASONS = ['CUSTOMER', 'DECLINED', 'FRAUD', 'INVENTORY', 'STAFF', 'OTHER'] as const;

export async function cancelOrder(
  db: Db, shopId: number, id: number, o: { reason: string; restock: boolean; refund?: boolean; staffNote?: string | null; staffId?: number | null; notifyCustomer?: boolean },
): Promise<Result<Order>> {
  const cur = await getOrder(db, shopId, id);
  if (!cur) return errR(['orderId'], 'Order does not exist', 'NOT_FOUND');
  if (cur.cancelledAt) return errR(['orderId'], 'Cannot cancel an order that has already been cancelled.', 'INVALID');
  return txResult(db, async (tx) => {
    const d = await getOrderDetail(tx, shopId, id);
    if (o.refund) {
      const { received, refunded } = paidAmounts(d.transactions);
      if (received - refunded > 0) {
        const r = await refundOrder(tx as unknown as Db, shopId, id, { note: o.staffNote ?? 'Order cancelled', amount: received - refunded, staffId: o.staffId, storeCreditEvent: 'ORDER_CANCELLATION' });
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
    await addEvent(tx, shopId, { subjectType: 'order', subjectId: id, verb: 'order.cancelled', message: `Order was cancelled (${o.reason.toLowerCase()})${o.staffNote ? `: ${o.staffNote}` : ''}`, authorStaffUserId: o.staffId, data: { reason: o.reason, restock: o.restock, note: o.staffNote ?? null, notify: !!o.notifyCustomer } });
    return okR(row!);
  });
}
