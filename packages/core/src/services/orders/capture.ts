import { eq } from 'drizzle-orm';
import { orders, transactions } from '../../db/schema';
import type { Db } from '../../db/client';
import { errR, okR, txResult, type Result } from '../catalog/common';
import { addEvent } from '../events';
import { getOrder, getOrderDetail, paidAmounts, type OrderTransaction } from './orders';

/**
 * `orderCapture`: collect (part of) the money authorised by an AUTHORIZATION transaction. Several captures are allowed until the
 * authorised amount is used up or `finalCapture` closes it. Amounts are minor units. The order turns PAID once it is fully received.
 */
export async function captureTransaction(db: Db, shopId: number, i: { orderId: number; parentTransactionId: number; amount: number; currency?: string | null; finalCapture?: boolean | null; staffId?: number | null;
  /** Called once the capture is valid and before it is recorded: collects the money at the payment provider (throw to refuse). */
  collect?: (parent: OrderTransaction, amount: number) => Promise<void> }): Promise<Result<OrderTransaction>> {
  const order = await getOrder(db, shopId, i.orderId);
  if (!order) return errR(['input', 'id'], 'Order does not exist', 'NOT_FOUND');
  return txResult(db, async (tx) => {
    const txs = (await getOrderDetail(tx, shopId, i.orderId)).transactions;
    const parent = txs.find((t) => t.id === i.parentTransactionId);
    if (!parent) return errR(['input', 'parentTransactionId'], 'Transaction does not exist', 'NOT_FOUND');
    if (parent.kind !== 'AUTHORIZATION' || parent.status !== 'SUCCESS') return errR(['input', 'parentTransactionId'], 'Transaction is not an authorization that can be captured', 'INVALID');
    if (i.currency && i.currency !== parent.currency) return errR(['input', 'currency'], 'Currency does not match the authorization', 'INVALID');
    const children = txs.filter((t) => t.parentId === parent.id && t.status === 'SUCCESS');
    if (children.some((t) => t.kind === 'VOID')) return errR(['input', 'parentTransactionId'], 'The authorization was voided', 'INVALID');
    if (children.some((t) => t.kind === 'CAPTURE' && t.errorCode === 'FINAL')) return errR(['input', 'parentTransactionId'], 'The authorization was already captured in full', 'INVALID');
    const remaining = parent.amount - children.filter((t) => t.kind === 'CAPTURE').reduce((n, t) => n + t.amount, 0);
    if (!(i.amount > 0)) return errR(['input', 'amount'], 'Amount must be greater than 0', 'GREATER_THAN');
    if (i.amount > remaining) return errR(['input', 'amount'], 'Amount is greater than the remaining authorized amount', 'INVALID');
    if (i.collect) {
      try { await i.collect(parent, i.amount); } catch (e) { return errR(['input', 'parentTransactionId'], `The payment provider refused the capture: ${(e as Error).message}`, 'INVALID'); }
    }
    const now = new Date();
    const closes = !!i.finalCapture || i.amount === remaining;
    const [capture] = await tx.insert(transactions).values({
      shopId, orderId: i.orderId, parentId: parent.id, kind: 'CAPTURE', status: 'SUCCESS', gateway: parent.gateway, amount: i.amount, currency: parent.currency, test: parent.test,
      paymentId: parent.paymentId, processedAt: now, errorCode: closes ? 'FINAL' : null,
    }).returning();
    const received = paidAmounts([...txs, capture!]).received;
    const status = received >= order.total ? 'PAID' : 'PARTIALLY_PAID';
    await tx.update(orders).set({ financialStatus: status, updatedAt: now }).where(eq(orders.id, i.orderId));
    await addEvent(tx, shopId, { subjectType: 'order', subjectId: i.orderId, verb: status === 'PAID' ? 'order.paid' : 'order.updated', message: 'Payment was captured', authorStaffUserId: i.staffId });
    return okR(capture!);
  });
}
