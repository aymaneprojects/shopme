import { and, asc, eq, gt, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import type { Db, Executor } from '../../db/client';
import { customers, inventoryItems, inventoryLevels, productVariants, subscriptionBillingAttempts, subscriptionContractLines, subscriptionContracts, taxRates, type ContractDiscount } from '../../db/schema';
import { addEvent } from '../events';
import { createOrder, type OrderLineInput } from '../orders/create';
import { priceCheckout, type PricingDiscount, type PricingResult, type PricingTaxRate } from '../pricing';
import { taxExtrasFor } from '../settings/tax-presets';
import type { Shop } from '../shops';
import { CONTRACT_SUBJECT, getSubscriptionContract, listContractLines, type SubscriptionContract, type SubscriptionContractLine } from './contracts';
import { addInterval, contractLinePrice } from './pricing';

/** Failed billing attempts in a row before a contract is marked FAILED, and the wait between two attempts. */
export const BILLING_MAX_ATTEMPTS = 3;
export const BILLING_RETRY_DELAY_MS = 24 * 3600_000;
/** Days before the billing date when the "upcoming renewal" email goes out. */
export const UPCOMING_RENEWAL_DAYS = 3;
/** A billing attempt still pending after this long was interrupted and may be replayed. */
const STALE_ATTEMPT_MS = 15 * 60_000;

export interface OffSessionChargeInput { amount: number; currency: string; customer: string; paymentMethod: string; idempotencyKey: string; description: string; reference: string; email: string | null }
/** Charge a saved card without the customer present (Stripe off-session PaymentIntent). */
export type OffSessionCharge = (i: OffSessionChargeInput) => Promise<{ ok: true; paymentId: string } | { ok: false; code: string; message: string; paymentId?: string | null }>;
export type ChargeRefund = (paymentId: string, amount: number, idempotencyKey: string) => Promise<void>;

export type BillingOutcome =
  | { status: 'ordered'; contract: SubscriptionContract; attemptId: number; orderId: number; orderName: string; paid: boolean }
  | { status: 'failed'; contract: SubscriptionContract; attemptId: number; code: string; message: string; willRetry: boolean }
  | { status: 'skipped'; reason: 'not_found' | 'not_active' | 'busy' };

export interface BillOptions {
  now?: Date;
  charge?: OffSessionCharge | null;
  refund?: ChargeRefund | null;
  /** Caller-chosen key (Admin API `subscriptionBillingAttemptCreate`); scheduled runs derive one from the cycle and attempt. */
  idempotencyKey?: string;
  maxAttempts?: number;
  retryDelayMs?: number;
}

// ---------------------------------------------------------------------------------------------------------------------
// Due contracts
// ---------------------------------------------------------------------------------------------------------------------

/** Active contracts whose billing date has come (and whose retry wait, after a failure, is over), every shop. */
export async function dueSubscriptionContracts(db: Executor, now = new Date(), limit = 50): Promise<{ id: number; shopId: number }[]> {
  return db.select({ id: subscriptionContracts.id, shopId: subscriptionContracts.shopId }).from(subscriptionContracts)
    .where(and(eq(subscriptionContracts.status, 'ACTIVE'), lte(subscriptionContracts.nextBillingDate, now), or(isNull(subscriptionContracts.retryAt), lte(subscriptionContracts.retryAt, now))))
    .orderBy(asc(subscriptionContracts.nextBillingDate), asc(subscriptionContracts.id)).limit(limit);
}

/** Active contracts billed within `days` that have not had their reminder for that date yet. */
export async function contractsDueForReminder(db: Executor, now = new Date(), days = UPCOMING_RENEWAL_DAYS): Promise<SubscriptionContract[]> {
  const until = new Date(now.getTime() + days * 86400_000);
  return db.select().from(subscriptionContracts)
    .where(and(eq(subscriptionContracts.status, 'ACTIVE'), gt(subscriptionContracts.nextBillingDate, now), lte(subscriptionContracts.nextBillingDate, until), eq(subscriptionContracts.failedAttempts, 0),
      or(isNull(subscriptionContracts.upcomingNotifiedFor), sql`${subscriptionContracts.upcomingNotifiedFor} <> ${subscriptionContracts.nextBillingDate}`)))
    .orderBy(asc(subscriptionContracts.id)).limit(100);
}

export async function markRenewalReminderSent(db: Executor, c: Pick<SubscriptionContract, 'id' | 'nextBillingDate'>): Promise<void> {
  await db.update(subscriptionContracts).set({ upcomingNotifiedFor: c.nextBillingDate }).where(eq(subscriptionContracts.id, c.id));
}

// ---------------------------------------------------------------------------------------------------------------------
// Pricing a renewal
// ---------------------------------------------------------------------------------------------------------------------

export interface RenewalQuote { cycle: number; lines: OrderLineInput[]; pricing: PricingResult; total: number }

/** Lines, discounts, shipping and taxes of the next billing cycle (shop currency). */
export async function quoteRenewal(db: Executor, shop: Shop, c: SubscriptionContract, lines: SubscriptionContractLine[]): Promise<RenewalQuote> {
  const cycle = c.cyclesCompleted + 1;
  const orderLines: OrderLineInput[] = lines.map((l, i) => ({
    id: i + 1, unitPrice: contractLinePrice(l.basePrice, l.pricingPolicies, l.deliveriesPerBilling, cycle), quantity: l.quantity, taxable: l.taxable, requiresShipping: l.requiresShipping,
    grams: l.grams * l.quantity, productId: l.productId ?? 0, collectionIds: [], subscription: true,
    variantId: l.variantId, title: l.title, variantTitle: l.variantTitle, sku: l.sku, vendor: null, imageUrl: l.imageUrl, isGiftCard: false, properties: {},
    sellingPlanId: l.sellingPlanId, sellingPlanName: l.sellingPlanName, subscriptionContractId: c.id,
  }));
  const allIds = orderLines.map((l) => l.id);
  const discounts: PricingDiscount[] = c.discounts.filter((d) => d.remainingCycles === null || d.remainingCycles > 0).map((d, i) => ({
    id: d.discountId ?? -(i + 1), code: d.code, title: d.title, valueType: d.valueType, value: d.value, target: d.target, appliesTo: d.target === 'PRODUCTS' ? { lineIds: allIds } : {},
  }));
  const ships = lines.some((l) => l.requiresShipping) && !!c.deliveryMethod;
  const country = c.deliveryAddress?.countryCode ?? null;
  const rows = country ? await db.select().from(taxRates).where(and(eq(taxRates.shopId, shop.id), eq(taxRates.active, true), eq(taxRates.countryCode, country.toUpperCase()))) : [];
  const rates: PricingTaxRate[] = rows.map((r) => ({ name: r.name, countryCode: r.countryCode, provinceCode: r.provinceCode, rate: r.rate, appliesToShipping: r.appliesToShipping, priority: r.priority }));
  let taxExempt = false;
  if (c.customerId) { const [cu] = await db.select({ t: customers.taxExempt }).from(customers).where(eq(customers.id, c.customerId)).limit(1); taxExempt = !!cu?.t; }
  const pricing = priceCheckout({
    lines: orderLines, discounts, shipping: ships ? { id: 0, name: c.deliveryMethod!.title, price: c.deliveryPrice } : null, taxRates: rates, taxesIncluded: shop.taxesIncluded, taxExempt,
    ...taxExtrasFor(shop, country), country, province: c.deliveryAddress?.provinceCode ?? null,
  });
  return { cycle, lines: orderLines, pricing, total: pricing.total };
}

/** Variants of the renewal that lack stock (tracked, oversell not allowed). */
async function stockShortfall(db: Executor, shopId: number, lines: SubscriptionContractLine[]): Promise<boolean> {
  const want = new Map<number, number>();
  for (const l of lines) if (l.variantId) want.set(l.variantId, (want.get(l.variantId) ?? 0) + l.quantity);
  if (!want.size) return false;
  const rows = await db.select({ id: productVariants.id, policy: productVariants.inventoryPolicy, tracked: inventoryItems.tracked, itemId: inventoryItems.id }).from(productVariants)
    .leftJoin(inventoryItems, eq(inventoryItems.variantId, productVariants.id)).where(and(eq(productVariants.shopId, shopId), inArray(productVariants.id, [...want.keys()])));
  if (rows.length < want.size) return true; // a variant was deleted
  for (const r of rows) {
    if (r.policy === 'CONTINUE' || !r.itemId || !r.tracked) continue;
    const [lv] = await db.select({ n: sql<number>`coalesce(sum(${inventoryLevels.available}), 0)::int` }).from(inventoryLevels).where(and(eq(inventoryLevels.inventoryItemId, r.itemId), eq(inventoryLevels.isActive, true)));
    if ((lv?.n ?? 0) < want.get(r.id)!) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------------------------------------------------
// Billing
// ---------------------------------------------------------------------------------------------------------------------

const decremented = (ds: ContractDiscount[]): ContractDiscount[] => ds.map((d) => (d.remainingCycles === null ? d : { ...d, remainingCycles: d.remainingCycles - 1 })).filter((d) => d.remainingCycles === null || d.remainingCycles > 0);

/**
 * Bill the next cycle of an active contract: create the renewal order, paid off-session with the saved Stripe card, or awaiting payment
 * for manual methods (bank transfer, cash on delivery...). A failure is recorded and retried later; after `maxAttempts` failures in a row
 * the contract is marked FAILED. Each cycle and attempt has its own idempotency key, so a run that repeats does not bill twice.
 */
export async function billSubscriptionContract(db: Db, shop: Shop, contractId: number, opts: BillOptions = {}): Promise<BillingOutcome> {
  const now = opts.now ?? new Date();
  const c = await getSubscriptionContract(db, shop.id, contractId);
  if (!c) return { status: 'skipped', reason: 'not_found' };
  if (c.status !== 'ACTIVE') return { status: 'skipped', reason: 'not_active' };
  const lines = await listContractLines(db, shop.id, [c.id]);
  const cycle = c.cyclesCompleted + 1;
  const key = opts.idempotencyKey ?? `cycle-${cycle}-attempt-${c.failedAttempts + 1}`;
  if (c.billingPolicy.maxCycles != null && c.cyclesCompleted >= c.billingPolicy.maxCycles) {
    await db.update(subscriptionContracts).set({ status: 'EXPIRED', updatedAt: now }).where(eq(subscriptionContracts.id, c.id));
    await addEvent(db, shop.id, { subjectType: CONTRACT_SUBJECT, subjectId: c.id, verb: 'subscription_contracts/expired', message: 'Subscription completed its last billing cycle' });
    return { status: 'skipped', reason: 'not_active' };
  }
  const insert = () => db.insert(subscriptionBillingAttempts).values({ shopId: shop.id, contractId: c.id, idempotencyKey: key, status: 'PENDING', cycleIndex: cycle, billingDate: c.nextBillingDate }).onConflictDoNothing().returning();
  let [attempt] = await insert();
  if (!attempt) {
    // An attempt with this key that never finished (the process stopped mid-way) is replayed with the same key: the payment provider's
    // idempotency then returns the first charge instead of taking a second one.
    const stale = await db.delete(subscriptionBillingAttempts).where(and(eq(subscriptionBillingAttempts.contractId, c.id), eq(subscriptionBillingAttempts.idempotencyKey, key),
      eq(subscriptionBillingAttempts.status, 'PENDING'), lte(subscriptionBillingAttempts.createdAt, new Date(now.getTime() - STALE_ATTEMPT_MS)))).returning({ id: subscriptionBillingAttempts.id });
    if (stale.length) [attempt] = await insert();
  }
  if (!attempt) return { status: 'skipped', reason: 'busy' };

  const maxAttempts = opts.maxAttempts ?? BILLING_MAX_ATTEMPTS;
  const fail = async (code: string, message: string): Promise<BillingOutcome> => {
    const failed = c.failedAttempts + 1;
    const willRetry = failed < maxAttempts;
    const [row] = await db.transaction(async (tx) => {
      await tx.update(subscriptionBillingAttempts).set({ status: 'FAILED', errorCode: code, errorMessage: message.slice(0, 500), completedAt: now }).where(eq(subscriptionBillingAttempts.id, attempt.id));
      const r = await tx.update(subscriptionContracts).set({
        failedAttempts: failed, lastPaymentStatus: 'FAILED', lastBillingErrorType: code, retryAt: willRetry ? new Date(now.getTime() + (opts.retryDelayMs ?? BILLING_RETRY_DELAY_MS)) : null,
        ...(willRetry ? {} : { status: 'FAILED' }), updatedAt: now,
      }).where(eq(subscriptionContracts.id, c.id)).returning();
      await addEvent(tx, shop.id, { subjectType: CONTRACT_SUBJECT, subjectId: c.id, verb: 'subscription_contracts/billing_failed', message: `Billing attempt ${failed} of ${maxAttempts} failed: ${message}${willRetry ? '' : '. The subscription is marked as failed'}`, data: { code, attempt: failed, willRetry } });
      return r;
    });
    return { status: 'failed', contract: row!, attemptId: attempt.id, code, message, willRetry };
  };

  const [customer] = c.customerId ? await db.select().from(customers).where(eq(customers.id, c.customerId)).limit(1) : [];
  if (!customer || (!customer.email && !customer.phone)) return fail('CUSTOMER_INVALID', 'The subscription has no customer to bill');
  if (!lines.length) return fail('INVALID_LINES', 'The subscription has no products');
  if (await stockShortfall(db, shop.id, lines)) return fail('INSUFFICIENT_INVENTORY', 'Not enough stock for the renewal');
  const quote = await quoteRenewal(db, shop, c, lines);

  // Payment: off-session card charge, test gateway, or a manual method (order awaits payment).
  let payment: { gateway: string; status: 'PAID' | 'PENDING'; paymentId?: string | null; test?: boolean };
  if (quote.total <= 0) payment = { gateway: 'free', status: 'PAID' };
  else if (c.paymentGateway === 'stripe') {
    if (!opts.charge || !c.stripeCustomerId || !c.stripePaymentMethodId) return fail('PAYMENT_METHOD_NOT_FOUND', 'No saved card to charge');
    const r = await opts.charge({ amount: quote.total, currency: c.currency, customer: c.stripeCustomerId, paymentMethod: c.stripePaymentMethodId, idempotencyKey: `subscription-${c.id}-${key}`, description: `${shop.name} subscription #${c.id}`, reference: `subscription:${c.id}`, email: customer.email });
    if (!r.ok) return fail(r.code || 'PAYMENT_METHOD_DECLINED', r.message || 'The card was declined');
    payment = { gateway: 'stripe', status: 'PAID', paymentId: r.paymentId };
  } else if (c.paymentGateway === 'test') payment = { gateway: 'test', status: 'PAID', test: true };
  else payment = { gateway: c.paymentGateway, status: 'PENDING' };

  const address = c.deliveryAddress ?? null;
  const res = await createOrder(db, shop.id, {
    email: customer.email, phone: customer.phone, currency: shop.currency, taxesIncluded: shop.taxesIncluded, lines: quote.lines, pricing: quote.pricing,
    shippingAddress: quote.pricing.shipping ? address : null, billingAddress: address, payment, sourceName: 'subscription_contract', subscriptionContractId: c.id,
    eventMessage: `Renewal order for subscription #${c.id} (${payment.status === 'PAID' ? 'paid' : 'payment pending'})`,
  });
  if (!res.ok) {
    if (payment.paymentId && opts.refund) { try { await opts.refund(payment.paymentId, quote.total, `subscription-${c.id}-${key}-refund`); } catch { /* recorded below */ } }
    return fail(res.error === 'out_of_stock' ? 'INSUFFICIENT_INVENTORY' : 'UNEXPECTED_ERROR', res.error === 'out_of_stock' ? 'Not enough stock for the renewal' : `The renewal order could not be created (${res.error})`);
  }

  const b = c.billingPolicy;
  let next = addInterval(c.nextBillingDate, b.interval, b.intervalCount);
  while (next <= now) next = addInterval(next, b.interval, b.intervalCount);
  const expired = b.maxCycles != null && cycle >= b.maxCycles;
  const [row] = await db.transaction(async (tx) => {
    await tx.update(subscriptionBillingAttempts).set({ status: 'SUCCEEDED', orderId: res.orderId, paymentId: payment.paymentId ?? null, completedAt: now }).where(eq(subscriptionBillingAttempts.id, attempt.id));
    for (const l of lines) await tx.update(subscriptionContractLines).set({ currentPrice: contractLinePrice(l.basePrice, l.pricingPolicies, l.deliveriesPerBilling, cycle + 1) }).where(eq(subscriptionContractLines.id, l.id));
    const r = await tx.update(subscriptionContracts).set({
      cyclesCompleted: cycle, nextBillingDate: next, failedAttempts: 0, retryAt: null, lastPaymentStatus: 'SUCCEEDED', lastBillingErrorType: null, discounts: decremented(c.discounts),
      ...(expired ? { status: 'EXPIRED' } : {}), updatedAt: now,
    }).where(eq(subscriptionContracts.id, c.id)).returning();
    await addEvent(tx, shop.id, { subjectType: CONTRACT_SUBJECT, subjectId: c.id, verb: 'subscription_contracts/billed', message: `Renewal order ${res.name} created (${payment.status === 'PAID' ? 'paid' : 'payment pending'})`, data: { orderId: res.orderId, name: res.name, paid: payment.status === 'PAID', cycle } });
    if (expired) await addEvent(tx, shop.id, { subjectType: CONTRACT_SUBJECT, subjectId: c.id, verb: 'subscription_contracts/expired', message: 'Subscription completed its last billing cycle' });
    return r;
  });
  return { status: 'ordered', contract: row!, attemptId: attempt.id, orderId: res.orderId, orderName: res.name, paid: payment.status === 'PAID' };
}
