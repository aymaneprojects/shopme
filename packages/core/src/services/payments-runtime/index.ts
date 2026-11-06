import { and, eq } from 'drizzle-orm';
import { manualProviders, parsePaymentSettings, type PaymentProvider } from '@shopme/payments';
import type { Executor } from '../../db/client';
import * as s from '../../db/schema';
import { addEvent } from '../events';
import { configOf } from '../settings/config';
import { revertOrderStoreCredit } from '../store-credit';
import type { Db } from '../../db/client';

/**
 * Payment methods offered at checkout: enabled manual methods, merchant-defined manual methods and redirect gateways, the test gateway
 * when switched on, plus Stripe when configured (env) and not switched off. Payment customisation rules then hide, rename or move methods
 * for the destination country and order total (`context`).
 */
export function availablePaymentMethods(settings: Record<string, unknown>, opts: { stripeConfigured: boolean; context?: { country: string | null; total: number } }): PaymentProvider[] {
  const parsed = parsePaymentSettings(settings);
  const cfg = configOf({ settings }, 'PAYMENTS');
  let methods = manualProviders(parsed);
  if (opts.stripeConfigured && parsed.stripe.enabled) methods.unshift({ id: 'stripe', kind: 'online' });
  for (const m of cfg.customMethods) if (m.enabled) methods.push({ id: `manual:${m.id}`, kind: 'manual', name: m.name, instructions: m.instructions });
  for (const g of cfg.redirectGateways) if (g.enabled && g.redirectUrl) methods.push({ id: `redirect:${g.id}`, kind: 'redirect', name: g.name });
  if (cfg.testGateway) methods.push({ id: 'test', kind: 'test' });
  const country = opts.context?.country?.toUpperCase() ?? null;
  const total = opts.context?.total ?? 0;
  for (const r of cfg.customizations) {
    if (!r.enabled) continue;
    if (r.countries.length && (!country || !r.countries.includes(country))) continue;
    if (r.minTotal != null && total < r.minTotal) continue;
    if (r.maxTotal != null && total > r.maxTotal) continue;
    if (r.action === 'hide') methods = methods.filter((m) => m.id !== r.method);
    else if (r.action === 'rename' && r.newName) methods = methods.map((m) => (m.id === r.method ? { ...m, name: r.newName } : m));
    else if (r.action === 'move_first') { const m = methods.find((x) => x.id === r.method); if (m) methods = [m, ...methods.filter((x) => x !== m)]; }
  }
  return methods;
}

/** Mark a pending Stripe-style payment as authorised: the money is held and can be captured from the order. Idempotent. */
export async function markOrderAuthorized(db: Executor, shopId: number, orderId: number, info: { gateway: string; paymentId?: string | null }): Promise<boolean> {
  const upd = await db.update(s.orders).set({ financialStatus: 'AUTHORIZED' })
    .where(and(eq(s.orders.id, orderId), eq(s.orders.shopId, shopId), eq(s.orders.financialStatus, 'PENDING'))).returning({ id: s.orders.id });
  if (!upd.length) return false;
  await db.update(s.transactions).set({ kind: 'AUTHORIZATION', status: 'SUCCESS', processedAt: new Date(), ...(info.paymentId ? { paymentId: info.paymentId } : {}) })
    .where(and(eq(s.transactions.orderId, orderId), eq(s.transactions.kind, 'SALE'), eq(s.transactions.status, 'PENDING')));
  await addEvent(db, shopId, { subjectType: 'order', subjectId: orderId, verb: 'order.authorized', message: `Payment authorised (${info.gateway}): capture it from the order` });
  return true;
}

/** An order paid or authorised by a gateway id (`redirect:<id>`), found by its display name (the reference sent to the payment page). */
export async function findOrderIdByName(db: Executor, shopId: number, name: string, gateway: string): Promise<number | null> {
  const [o] = await db.select({ id: s.orders.id }).from(s.orders).innerJoin(s.transactions, eq(s.transactions.orderId, s.orders.id))
    .where(and(eq(s.orders.shopId, shopId), eq(s.orders.name, name), eq(s.transactions.gateway, gateway))).limit(1);
  return o?.id ?? null;
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

/** The store that owns a payment (multi-store, shared installation Stripe keys: the event names no store). */
export async function shopOfPayment(db: Executor, paymentId: string): Promise<typeof s.shops.$inferSelect | null> {
  const [t] = await db.select({ shop: s.shops }).from(s.transactions).innerJoin(s.shops, eq(s.shops.id, s.transactions.shopId)).where(eq(s.transactions.paymentId, paymentId)).limit(1);
  return t?.shop ?? null;
}

/** Mark a PENDING order paid (idempotent). Returns true only on the transition, so callers send emails once. */
export async function markOrderPaid(db: Executor, shopId: number, orderId: number, info: { gateway: string; paymentId?: string | null }): Promise<boolean> {
  const upd = await db.update(s.orders).set({ financialStatus: 'PAID' })
    .where(and(eq(s.orders.id, orderId), eq(s.orders.shopId, shopId), eq(s.orders.financialStatus, 'PENDING'))).returning({ id: s.orders.id });
  if (!upd.length) return false;
  const done = await db.update(s.transactions).set({ status: 'SUCCESS', processedAt: new Date(), ...(info.paymentId ? { paymentId: info.paymentId } : {}) })
    .where(and(eq(s.transactions.orderId, orderId), eq(s.transactions.kind, 'SALE'), eq(s.transactions.status, 'PENDING'))).returning({ id: s.transactions.id });
  if (!done.length) {
    const [o] = await db.select({ total: s.orders.total, currency: s.orders.currency, pm: s.orders.presentmentMoney, pmCurrency: s.orders.presentmentCurrency }).from(s.orders).where(eq(s.orders.id, orderId)).limit(1);
    await db.insert(s.transactions).values({ shopId, orderId, kind: 'SALE', status: 'SUCCESS', gateway: info.gateway, amount: o!.total, currency: o!.currency, ...(o!.pm ? { presentmentAmount: o!.pm.total, presentmentCurrency: o!.pmCurrency } : {}), paymentId: info.paymentId ?? null, processedAt: new Date() });
  }
  await addEvent(db, shopId, { subjectType: 'order', subjectId: orderId, verb: 'order.paid', message: `Payment received (${info.gateway})` });
  return true;
}

/** Record a failed online payment attempt; the order stays PENDING so the buyer can be contacted or the order cancelled. */
export async function recordPaymentFailure(db: Executor, shopId: number, orderId: number, info: { gateway: string; paymentId?: string | null; message?: string | null }): Promise<void> {
  const [o] = await db.select({ total: s.orders.total, currency: s.orders.currency, pm: s.orders.presentmentMoney, pmCurrency: s.orders.presentmentCurrency }).from(s.orders).where(and(eq(s.orders.id, orderId), eq(s.orders.shopId, shopId))).limit(1);
  if (!o) return;
  await db.insert(s.transactions).values({ shopId, orderId, kind: 'SALE', status: 'FAILURE', gateway: info.gateway, amount: o.total, currency: o.currency, ...(o.pm ? { presentmentAmount: o.pm.total, presentmentCurrency: o.pmCurrency } : {}), paymentId: info.paymentId ?? null, errorCode: info.message?.slice(0, 200) ?? null });
  await addEvent(db, shopId, { subjectType: 'order', subjectId: orderId, verb: 'order.payment_failed', message: `Payment failed (${info.gateway})${info.message ? `: ${info.message}` : ''}` });
  // Store credit the order already spent goes back to the buyer (the payment for the rest did not go through).
  const back = await revertOrderStoreCredit(db as unknown as Db, shopId, orderId);
  if (back > 0) await addEvent(db, shopId, { subjectType: 'order', subjectId: orderId, verb: 'order.store_credit_restored', message: 'Store credit was restored after the payment failed', data: { amount: back } });
}
