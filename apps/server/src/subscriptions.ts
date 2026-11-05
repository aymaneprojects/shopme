import type { FastifyInstance } from 'fastify';
import {
  billSubscriptionContract, contractsDueForReminder, dueSubscriptionContracts, getShop, getSubscriptionContract, markRenewalReminderSent, schema, sendNotification, subscriptionMailVars,
  type BillOptions, type BillingOutcome, type NotificationKey, type OffSessionCharge, type Shop,
} from '@shopme/core';
import { eq } from 'drizzle-orm';

/** How often due contracts are looked for (renewals run at most this late after their billing date). */
export const BILLING_SWEEP_MS = 5 * 60_000;

export interface SubscriptionNotifyJob { shopId: number; contractId: number; key: NotificationKey; error?: string | null; retry?: boolean }

/** Stripe decline codes -> the billing error codes shown on the contract. */
const STRIPE_ERRORS: Record<string, string> = {
  card_declined: 'PAYMENT_METHOD_DECLINED', generic_decline: 'PAYMENT_METHOD_DECLINED', do_not_honor: 'PAYMENT_METHOD_DECLINED', insufficient_funds: 'INSUFFICIENT_FUNDS',
  expired_card: 'EXPIRED_PAYMENT_METHOD', authentication_required: 'AUTHENTICATION_ERROR', incorrect_cvc: 'INVALID_PAYMENT_METHOD', incorrect_number: 'INVALID_PAYMENT_METHOD',
  invalid_cvc: 'INVALID_PAYMENT_METHOD', processing_error: 'PAYMENT_PROVIDER_IS_NOT_ENABLED', lost_card: 'PAYMENT_METHOD_DECLINED', stolen_card: 'PAYMENT_METHOD_DECLINED',
};

/** Off-session charge through the configured Stripe gateway (null when Stripe is off). */
function stripeCharge(app: FastifyInstance): OffSessionCharge | null {
  const gw = app.checkoutPayments?.stripe;
  if (!gw) return null;
  return async (i) => {
    const r = await gw.chargeOffSession({ amount: i.amount, currency: i.currency, customer: i.customer, paymentMethod: i.paymentMethod, idempotencyKey: i.idempotencyKey, description: i.description, reference: i.reference, email: i.email });
    return r.ok ? { ok: true, paymentId: r.id } : { ok: false, code: STRIPE_ERRORS[r.code] ?? 'PAYMENT_METHOD_DECLINED', message: r.message, paymentId: r.id };
  };
}

/** Bill one contract (scheduled renewal or "bill now") and queue the emails that follow: order confirmation, or payment failed. */
export async function billContract(app: FastifyInstance, shop: Shop, contractId: number, opts: Omit<BillOptions, 'charge' | 'refund'> = {}): Promise<BillingOutcome> {
  const ctx = app.ctx;
  const gw = app.checkoutPayments?.stripe ?? null;
  const out = await billSubscriptionContract(ctx.db, shop, contractId, { ...opts, charge: stripeCharge(app), refund: gw ? (id, amount, key) => gw.refund(id, amount, key) : null });
  if (out.status === 'ordered') {
    for (const job of ['order.confirmation-email', 'order.staff-email', 'order.fulfillment-request']) ctx.queue.enqueue(job, { shopId: shop.id, orderId: out.orderId });
  } else if (out.status === 'failed') {
    ctx.queue.enqueue<SubscriptionNotifyJob>('subscription.notify', { shopId: shop.id, contractId, key: 'subscription_payment_failed', error: out.message, retry: out.willRetry });
  }
  return out;
}

/** Every due contract of every shop, oldest billing date first. */
export async function runDueBilling(app: FastifyInstance, now = new Date()): Promise<BillingOutcome[]> {
  const out: BillingOutcome[] = [];
  const shops = new Map<number, Shop | null>();
  for (const due of await dueSubscriptionContracts(app.ctx.db, now)) {
    if (!shops.has(due.shopId)) shops.set(due.shopId, await getShop(app.ctx.db, due.shopId));
    const shop = shops.get(due.shopId);
    if (!shop) continue;
    try { out.push(await billContract(app, shop, due.id, { now })); } catch (err) { app.ctx.log.error({ err, contractId: due.id }, 'subscription billing failed'); }
  }
  return out;
}

/** "Upcoming renewal" emails, once per billing date. Returns how many were sent. */
export async function sendRenewalReminders(app: FastifyInstance, now = new Date()): Promise<number> {
  let n = 0;
  for (const c of await contractsDueForReminder(app.ctx.db, now)) {
    const shop = await getShop(app.ctx.db, c.shopId);
    if (!shop) continue;
    if (await notifyContract(app, shop, c.id, 'subscription_upcoming_renewal')) n++;
    await markRenewalReminderSent(app.ctx.db, c);
  }
  return n;
}

/** Send a subscription email to the contract's customer. */
export async function notifyContract(app: FastifyInstance, shop: Shop, contractId: number, key: NotificationKey, extra: { error?: string | null; retry?: boolean } = {}): Promise<boolean> {
  const { db, mailer, config } = app.ctx;
  const c = await getSubscriptionContract(db, shop.id, contractId);
  if (!c?.customerId) return false;
  const [customer] = await db.select({ email: schema.customers.email }).from(schema.customers).where(eq(schema.customers.id, c.customerId)).limit(1);
  if (!customer?.email) return false;
  return sendNotification(db, mailer, shop, config.appUrl, key, customer.email, await subscriptionMailVars(db, shop, config.appUrl, c, extra));
}

/** Background work of subscriptions: the renewal sweep, renewal reminders and the subscription emails. */
export function registerSubscriptionJobs(app: FastifyInstance): void {
  const { queue } = app.ctx;
  queue.register<SubscriptionNotifyJob>('subscription.notify', async (j) => {
    const shop = await getShop(app.ctx.db, j.shopId);
    if (shop) await notifyContract(app, shop, j.contractId, j.key, { error: j.error, retry: j.retry });
  });
  queue.every('subscription-billing', BILLING_SWEEP_MS, async () => { await runDueBilling(app); });
  queue.every('subscription-reminders', 3600_000, async () => { await sendRenewalReminders(app); });
}
