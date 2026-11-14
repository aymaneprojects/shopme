import { and, eq, inArray } from 'drizzle-orm';
import { manualProviders, parsePaymentSettings, type PaymentProvider } from '@shopme/payments';
import type { Executor } from '../../db/client';
import * as s from '../../db/schema';
import { addEvent } from '../events';
import { configOf } from '../settings/config';
import { revertOrderStoreCredit } from '../store-credit';
import type { Db } from '../../db/client';
import { getOrderDetail } from '../orders/orders';
import { refundOrder } from '../orders/refunds';
import { voidableOf, voidTransaction } from '../orders/void';

/**
 * Payment methods offered at checkout: enabled manual methods, merchant-defined manual methods and redirect gateways, the test gateway
 * when switched on, plus Stripe when configured (env) and not switched off. Payment customisation rules then hide, rename or move methods
 * for the destination country and order total (`context`).
 */
export function availablePaymentMethods(settings: Record<string, unknown>, opts: { stripeConfigured: boolean; /** PayPal credentials saved for the store. */ paypalConfigured?: boolean; /** Mollie API key saved for the store. */ mollieConfigured?: boolean; /** Label of the Mollie option (the names of its enabled methods). */ mollieName?: string; context?: { country: string | null; total: number } }): PaymentProvider[] {
  const parsed = parsePaymentSettings(settings);
  const cfg = configOf({ settings }, 'PAYMENTS');
  let methods = manualProviders(parsed);
  if (opts.stripeConfigured && parsed.stripe.enabled) methods.unshift({ id: 'stripe', kind: 'online' });
  // PayPal and Mollie come after the card and before the merchant's other methods; both create the order, then send the buyer to the provider.
  const at = methods.findIndex((m) => m.id !== 'stripe');
  const hosted: PaymentProvider[] = [];
  if (opts.paypalConfigured && parsed.paypal.enabled) hosted.push({ id: 'paypal', kind: 'online', name: 'PayPal' });
  if (opts.mollieConfigured && parsed.mollie.enabled) hosted.push({ id: 'mollie', kind: 'online', name: opts.mollieName || 'Mollie' });
  if (hosted.length) methods.splice(at < 0 ? methods.length : at, 0, ...hosted);
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

/** First order of the store carrying one of these provider references (PayPal order / capture / authorization ids). */
export async function findOrderIdByPaymentIds(db: Executor, shopId: number, paymentIds: string[], gateway?: string): Promise<number | null> {
  const ids = paymentIds.filter(Boolean);
  if (!ids.length) return null;
  const rows = await db.select({ orderId: s.transactions.orderId, paymentId: s.transactions.paymentId, gateway: s.transactions.gateway }).from(s.transactions).where(and(eq(s.transactions.shopId, shopId), inArray(s.transactions.paymentId, ids)));
  for (const id of ids) { const hit = rows.find((r) => r.paymentId === id && (!gateway || r.gateway === gateway)); if (hit) return hit.orderId; }
  return null;
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
export async function recordPaymentFailure(db: Executor, shopId: number, orderId: number, info: { gateway: string; paymentId?: string | null; message?: string | null; /** Skip when a failure with this payment id is already recorded (duplicate webhook deliveries). */ dedupe?: boolean }): Promise<void> {
  if (info.dedupe && info.paymentId) {
    const [dup] = await db.select({ id: s.transactions.id }).from(s.transactions).where(and(eq(s.transactions.shopId, shopId), eq(s.transactions.orderId, orderId), eq(s.transactions.kind, 'SALE'), eq(s.transactions.status, 'FAILURE'), eq(s.transactions.paymentId, info.paymentId))).limit(1);
    if (dup) return;
  }
  const [o] = await db.select({ total: s.orders.total, currency: s.orders.currency, pm: s.orders.presentmentMoney, pmCurrency: s.orders.presentmentCurrency }).from(s.orders).where(and(eq(s.orders.id, orderId), eq(s.orders.shopId, shopId))).limit(1);
  if (!o) return;
  await db.insert(s.transactions).values({ shopId, orderId, kind: 'SALE', status: 'FAILURE', gateway: info.gateway, amount: o.total, currency: o.currency, ...(o.pm ? { presentmentAmount: o.pm.total, presentmentCurrency: o.pmCurrency } : {}), paymentId: info.paymentId ?? null, errorCode: info.message?.slice(0, 200) ?? null });
  await addEvent(db, shopId, { subjectType: 'order', subjectId: orderId, verb: 'order.payment_failed', message: `Payment failed (${info.gateway})${info.message ? `: ${info.message}` : ''}` });
  // Store credit the order already spent goes back to the buyer (the payment for the rest did not go through).
  const back = await revertOrderStoreCredit(db as unknown as Db, shopId, orderId);
  if (back > 0) await addEvent(db, shopId, { subjectType: 'order', subjectId: orderId, verb: 'order.store_credit_restored', message: 'Store credit was restored after the payment failed', data: { amount: back } });
}


/**
 * Mirror refunds made at the provider (Stripe dashboard) that ShopMe has not recorded: one refund without lines and a REFUND transaction per
 * provider refund id. Refunds ShopMe created itself carry their provider id in `paymentId` and are skipped, so duplicate deliveries and our
 * own refunds are no-ops. Provider amounts are in the charge currency; the transaction is recorded in shop money. Returns how many were added.
 */
export async function mirrorProviderRefunds(db: Db, shopId: number, orderId: number, gateway: string, list: { id: string; amount: number; status?: string | null }[]): Promise<number> {
  const live = list.filter((r) => r.amount > 0 && (r.status == null || r.status === 'succeeded' || r.status === 'pending'));
  if (!live.length) return 0;
  return db.transaction(async (tx) => {
    // Serialised with ShopMe's own refunds (they lock the order too): a refund made here is recorded before this looks for its id.
    await tx.select({ id: s.orders.id }).from(s.orders).where(and(eq(s.orders.id, orderId), eq(s.orders.shopId, shopId))).for('update');
    const txs = (await getOrderDetail(tx, shopId, orderId)).transactions;
    const known = new Set(txs.filter((t) => t.kind === 'REFUND' && t.paymentId).map((t) => t.paymentId));
    const fresh = live.filter((r) => !known.has(r.id));
    const parent = txs.find((t) => ['SALE', 'CAPTURE'].includes(t.kind) && t.status === 'SUCCESS' && t.gateway === gateway);
    if (!fresh.length || !parent) return 0;
    const shopMoney = (amount: number) => (parent.presentmentAmount && parent.presentmentAmount > 0 ? Math.round((amount * parent.amount) / parent.presentmentAmount) : amount);
    const r = await refundOrder(tx as unknown as Db, shopId, orderId, {
      note: 'Refunded from the payment provider', allowOverRefunding: true,
      transactions: fresh.map((f) => ({ amount: shopMoney(f.amount), gateway, parentId: parent.id, paymentId: f.id })),
    });
    return r.ok ? fresh.length : 0;
  });
}

/** The provider cancelled the payment: an authorised order is voided without calling the provider again (no-op once voided or captured). */
export async function recordPaymentCanceled(db: Db, shopId: number, orderId: number): Promise<boolean> {
  const auth = voidableOf((await getOrderDetail(db, shopId, orderId)).transactions)[0];
  if (!auth) return false;
  return (await voidTransaction(db, shopId, { parentTransactionId: auth.id })).ok;
}

/** A buyer disputed the payment: a note on the order timeline, once per dispute id. */
export async function recordDispute(db: Executor, shopId: number, orderId: number, d: { id: string; amount?: number | null; currency?: string | null; reason?: string | null }): Promise<boolean> {
  const seen = await db.select({ data: s.events.data }).from(s.events).where(and(eq(s.events.shopId, shopId), eq(s.events.subjectType, 'order'), eq(s.events.subjectId, orderId), eq(s.events.verb, 'order.dispute_created')));
  if (seen.some((e) => e.data?.disputeId === d.id)) return false;
  await addEvent(db, shopId, { subjectType: 'order', subjectId: orderId, verb: 'order.dispute_created', message: `Payment disputed${d.reason ? ` (${d.reason.replace(/_/g, ' ')})` : ''}: respond in the Stripe dashboard`, data: { disputeId: d.id, amount: d.amount ?? null, currency: d.currency ?? null, reason: d.reason ?? null } });
  return true;
}

/**
 * Mollie reports only the total refunded on a payment. When that is more than the REFUND transactions ShopMe holds for the order on the
 * gateway (a refund made in the Mollie dashboard), the difference is recorded as one refund without lines whose provider id is
 * `<paymentId>:<total refunded>`: a duplicate delivery finds nothing left to add. Amounts are in the currency the buyer was charged in.
 * Serialised with ShopMe's own refunds (order row lock). Returns the amount mirrored (charge currency, minor units).
 */
export async function mirrorRefundedTotal(db: Db, shopId: number, orderId: number, gateway: string, paymentId: string, totalRefunded: number): Promise<number> {
  if (!(totalRefunded > 0)) return 0;
  return db.transaction(async (tx) => {
    await tx.select({ id: s.orders.id }).from(s.orders).where(and(eq(s.orders.id, orderId), eq(s.orders.shopId, shopId))).for('update');
    const txs = (await getOrderDetail(tx, shopId, orderId)).transactions;
    const parent = txs.find((t) => ['SALE', 'CAPTURE'].includes(t.kind) && t.status === 'SUCCESS' && t.gateway === gateway && t.paymentId === paymentId);
    if (!parent) return 0;
    const known = txs.filter((t) => t.kind === 'REFUND' && t.status === 'SUCCESS' && t.gateway === gateway).reduce((n, t) => n + (t.presentmentAmount && t.presentmentAmount > 0 ? t.presentmentAmount : t.amount), 0);
    const diff = totalRefunded - known;
    if (diff <= (parent.presentmentAmount ? 1 : 0)) return 0; // rounding noise of currency conversion
    const shopMoney = parent.presentmentAmount && parent.presentmentAmount > 0 ? Math.round((diff * parent.amount) / parent.presentmentAmount) : diff;
    const r = await refundOrder(tx as unknown as Db, shopId, orderId, {
      note: 'Refunded from the payment provider', allowOverRefunding: true,
      transactions: [{ amount: shopMoney, gateway, parentId: parent.id, paymentId: `${paymentId}:${totalRefunded}` }],
    });
    return r.ok ? diff : 0;
  });
}
