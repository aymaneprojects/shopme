import { eq } from 'drizzle-orm';
import { orders, transactions } from '../../db/schema';
import type { Db } from '../../db/client';
import { errR, okR, txResult, type Result } from '../catalog/common';
import { addEvent } from '../events';
import { getOrderDetail, type OrderTransaction } from './orders';
import type { GatewayResolver } from './gateways';

export type VoidErrorCode = 'TRANSACTION_NOT_FOUND' | 'AUTH_NOT_SUCCESSFUL' | 'AUTH_NOT_VOIDABLE' | 'GENERIC_ERROR';

/** The successful, still uncaptured and unvoided AUTHORIZATIONs of an order. */
export const voidableOf = (txs: OrderTransaction[]) => txs.filter((a) => a.kind === 'AUTHORIZATION' && a.status === 'SUCCESS'
  && !txs.some((t) => t.parentId === a.id && t.status === 'SUCCESS' && (t.kind === 'VOID' || t.kind === 'CAPTURE')));

/**
 * `transactionVoid`: release an uncaptured authorisation at the payment provider (gateways without an adapter: recorded only), record a VOID
 * transaction and mark the order VOIDED. A provider failure records nothing.
 */
export async function voidTransaction(db: Db, shopId: number, i: { parentTransactionId: number; gateways?: GatewayResolver; staffId?: number | null }): Promise<Result<OrderTransaction>> {
  const [parent] = await db.select().from(transactions).where(eq(transactions.id, i.parentTransactionId)).limit(1);
  if (!parent || parent.shopId !== shopId) return errR(['parentTransactionId'], 'Transaction does not exist', 'TRANSACTION_NOT_FOUND');
  return txResult(db, async (tx) => {
    await tx.select({ id: orders.id }).from(orders).where(eq(orders.id, parent.orderId)).for('update');
    const txs = (await getOrderDetail(tx, shopId, parent.orderId)).transactions;
    if (parent.kind !== 'AUTHORIZATION') return errR(['parentTransactionId'], 'Only an authorization can be voided', 'AUTH_NOT_VOIDABLE');
    if (parent.status !== 'SUCCESS') return errR(['parentTransactionId'], 'The authorization was not successful', 'AUTH_NOT_SUCCESSFUL');
    if (!voidableOf(txs).some((a) => a.id === parent.id)) return errR(['parentTransactionId'], 'The authorization was already captured or voided', 'AUTH_NOT_VOIDABLE');
    const adapter = parent.gateway && parent.paymentId ? i.gateways?.(parent.gateway) : null;
    if (adapter?.void) {
      try { await adapter.void(parent, `void-${parent.id}`); } catch (e) { return errR(['parentTransactionId'], `The payment provider refused the void: ${(e as Error).message}`, 'GENERIC_ERROR'); }
    }
    const now = new Date();
    const [row] = await tx.insert(transactions).values({
      shopId, orderId: parent.orderId, parentId: parent.id, kind: 'VOID', status: 'SUCCESS', gateway: parent.gateway, amount: parent.amount, currency: parent.currency,
      test: parent.test, paymentId: parent.paymentId, processedAt: now,
    }).returning();
    await tx.update(orders).set({ financialStatus: 'VOIDED', updatedAt: now }).where(eq(orders.id, parent.orderId));
    await addEvent(tx, shopId, { subjectType: 'order', subjectId: parent.orderId, verb: 'order.voided', message: 'Authorization was voided', authorStaffUserId: i.staffId });
    return okR(row!);
  });
}
