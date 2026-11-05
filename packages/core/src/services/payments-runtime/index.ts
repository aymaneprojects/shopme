import { and, eq } from 'drizzle-orm';
import { manualProviders, parsePaymentSettings, type PaymentProvider } from '@shopme/payments';
import type { Executor } from '../../db/client';
import * as s from '../../db/schema';
import { addEvent } from '../events';
import { revertOrderStoreCredit } from '../store-credit';
import type { Db } from '../../db/client';

/** Payment methods offered at checkout: enabled manual methods, plus Stripe when configured (env) and not switched off in settings. */
export function availablePaymentMethods(settings: Record<string, unknown>, opts: { stripeConfigured: boolean }): PaymentProvider[] {
  const parsed = parsePaymentSettings(settings);
  const methods = manualProviders(parsed);
  if (opts.stripeConfigured && parsed.stripe.enabled) methods.unshift({ id: 'stripe', kind: 'online' });
  return methods;
}

/** Remember the provider reference (PaymentIntent id) on the order's pending sale transaction. */
export async function attachPaymentReference(db: Executor, shopId: number, orderId: number, paymentId: string): Promise<void> {
  await db.update(s.transactions).set({ paymentId })
    .where(and(eq(s.transactions.shopId, shopId), eq(s.transactions.orderId, orderId), eq(s.transactions.kind, 'SALE'), eq(s.transactions.status, 'PENDING')));
}

export async function findOrderIdByPayment(db: Executor, shopId: number, paymentId: string): Promise<number | null> {
  const [t] = await db.select({ orderId: s.transactions.orderId }).from(s.transactions).where(and(eq(s.transactions.shopId, shopId), eq(s.transactions.paymentId, paymentId))).limit(1);
  return t?.orderId ?? null;
}

/** Mark a PENDING order paid (idempotent). Returns true only on the transition, so callers send emails once. */
export async function markOrderPaid(db: Executor, shopId: number, orderId: number, info: { gateway: string; paymentId?: string | null }): Promise<boolean> {
  const upd = await db.update(s.orders).set({ financialStatus: 'PAID' })
    .where(and(eq(s.orders.id, orderId), eq(s.orders.shopId, shopId), eq(s.orders.financialStatus, 'PENDING'))).returning({ id: s.orders.id });
  if (!upd.length) return false;
  const done = await db.update(s.transactions).set({ status: 'SUCCESS', processedAt: new Date(), ...(info.paymentId ? { paymentId: info.paymentId } : {}) })
    .where(and(eq(s.transactions.orderId, orderId), eq(s.transactions.kind, 'SALE'), eq(s.transactions.status, 'PENDING'))).returning({ id: s.transactions.id });
  if (!done.length) {
    const [o] = await db.select({ total: s.orders.total, currency: s.orders.currency }).from(s.orders).where(eq(s.orders.id, orderId)).limit(1);
    await db.insert(s.transactions).values({ shopId, orderId, kind: 'SALE', status: 'SUCCESS', gateway: info.gateway, amount: o!.total, currency: o!.currency, paymentId: info.paymentId ?? null, processedAt: new Date() });
  }
  await addEvent(db, shopId, { subjectType: 'order', subjectId: orderId, verb: 'order.paid', message: `Payment received (${info.gateway})` });
  return true;
}

/** Record a failed online payment attempt; the order stays PENDING so the buyer can be contacted or the order cancelled. */
export async function recordPaymentFailure(db: Executor, shopId: number, orderId: number, info: { gateway: string; paymentId?: string | null; message?: string | null }): Promise<void> {
  const [o] = await db.select({ total: s.orders.total, currency: s.orders.currency }).from(s.orders).where(and(eq(s.orders.id, orderId), eq(s.orders.shopId, shopId))).limit(1);
  if (!o) return;
  await db.insert(s.transactions).values({ shopId, orderId, kind: 'SALE', status: 'FAILURE', gateway: info.gateway, amount: o.total, currency: o.currency, paymentId: info.paymentId ?? null, errorCode: info.message?.slice(0, 200) ?? null });
  await addEvent(db, shopId, { subjectType: 'order', subjectId: orderId, verb: 'order.payment_failed', message: `Payment failed (${info.gateway})${info.message ? `: ${info.message}` : ''}` });
  // Store credit the order already spent goes back to the buyer (the payment for the rest did not go through).
  const back = await revertOrderStoreCredit(db as unknown as Db, shopId, orderId);
  if (back > 0) await addEvent(db, shopId, { subjectType: 'order', subjectId: orderId, verb: 'order.store_credit_restored', message: 'Store credit was restored after the payment failed', data: { amount: back } });
}
