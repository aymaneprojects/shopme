import { and, asc, desc, eq, inArray, or, sql } from 'drizzle-orm';
import type { Db, Executor } from '../../db/client';
import {
  customers, discountExtensions, discounts, orderLines, orders, subscriptionBillingAttempts, subscriptionContractLines, subscriptionContracts,
  type ContractAddress, type ContractDiscount, type PlanBillingPolicy, type PlanDeliveryPolicy, type PlanPricingPolicy, type SubscriptionStatus,
} from '../../db/schema';
import { buildSearch, dateCompare, idTerm, likeCi } from '../catalog/search';
import { errR, okR, txResult, type Result } from '../catalog/common';
import { addEvent } from '../events';
import type { DiscountApplication } from '../pricing';
import { addInterval, contractLinePrice, frequencyLabel } from './pricing';
import { moneyOf, shopUrl } from '../../mail/notifications';
import type { Shop } from '../shops';

export type SubscriptionContract = typeof subscriptionContracts.$inferSelect;
export type SubscriptionContractLine = typeof subscriptionContractLines.$inferSelect;
export type SubscriptionBillingAttempt = typeof subscriptionBillingAttempts.$inferSelect;

/** Contract events are recorded on this subject type (timeline of the contract page). */
export const CONTRACT_SUBJECT = 'subscription_contract';

// ---------------------------------------------------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------------------------------------------------

export async function getSubscriptionContract(db: Executor, shopId: number, id: number): Promise<SubscriptionContract | null> {
  const [r] = await db.select().from(subscriptionContracts).where(and(eq(subscriptionContracts.shopId, shopId), eq(subscriptionContracts.id, id))).limit(1);
  return r ?? null;
}

/** A contract of this customer only (customer account pages). */
export async function getCustomerSubscriptionContract(db: Executor, shopId: number, customerId: number, id: number): Promise<SubscriptionContract | null> {
  const [r] = await db.select().from(subscriptionContracts).where(and(eq(subscriptionContracts.shopId, shopId), eq(subscriptionContracts.id, id), eq(subscriptionContracts.customerId, customerId))).limit(1);
  return r ?? null;
}

export async function listContractLines(db: Executor, shopId: number, contractIds: number[]): Promise<SubscriptionContractLine[]> {
  if (!contractIds.length) return [];
  return db.select().from(subscriptionContractLines).where(and(eq(subscriptionContractLines.shopId, shopId), inArray(subscriptionContractLines.contractId, contractIds))).orderBy(asc(subscriptionContractLines.id));
}

export async function listBillingAttempts(db: Executor, shopId: number, contractId: number): Promise<SubscriptionBillingAttempt[]> {
  return db.select().from(subscriptionBillingAttempts).where(and(eq(subscriptionBillingAttempts.shopId, shopId), eq(subscriptionBillingAttempts.contractId, contractId))).orderBy(desc(subscriptionBillingAttempts.id));
}

/** The checkout order and the renewal orders of a contract, newest first. */
export async function contractOrderIds(db: Executor, shopId: number, c: Pick<SubscriptionContract, 'id' | 'originOrderId'>): Promise<number[]> {
  const rows = await db.select({ id: orders.id }).from(orders)
    .where(and(eq(orders.shopId, shopId), or(eq(orders.subscriptionContractId, c.id), c.originOrderId ? eq(orders.id, c.originOrderId) : sql`false`))).orderBy(desc(orders.createdAt), desc(orders.id));
  return rows.map((r) => r.id);
}

/** Contracts that an order started (checkout order) or billed (renewal). */
export async function contractsForOrder(db: Executor, shopId: number, orderId: number): Promise<SubscriptionContract[]> {
  const [o] = await db.select({ contractId: orders.subscriptionContractId }).from(orders).where(and(eq(orders.shopId, shopId), eq(orders.id, orderId))).limit(1);
  return db.select().from(subscriptionContracts).where(and(eq(subscriptionContracts.shopId, shopId), or(eq(subscriptionContracts.originOrderId, orderId), o?.contractId ? eq(subscriptionContracts.id, o.contractId) : sql`false`)))
    .orderBy(asc(subscriptionContracts.id));
}

const search = (q: string | null | undefined) => buildSearch(q, {
  fields: {
    id: (_o, v) => idTerm(subscriptionContracts.id, v),
    status: (_o, v) => sql`${subscriptionContracts.status} = ${v.toUpperCase()}`,
    customer_id: (_o, v) => idTerm(subscriptionContracts.customerId, v),
    origin_order_id: (_o, v) => idTerm(subscriptionContracts.originOrderId, v),
    next_billing_date: (op, v) => dateCompare(subscriptionContracts.nextBillingDate, op, v),
    created_at: (op, v) => dateCompare(subscriptionContracts.createdAt, op, v),
    last_payment_status: (_o, v) => sql`${subscriptionContracts.lastPaymentStatus} = ${v.toUpperCase()}`,
  },
  text: (v) => sql`(exists (select 1 from customers c where c.id = ${subscriptionContracts.customerId} and (${likeCi(sql`c.email`, v)} or ${likeCi(sql`concat_ws(' ', c.first_name, c.last_name)`, v)}))
    or exists (select 1 from subscription_contract_lines l where l.contract_id = ${subscriptionContracts.id} and (${likeCi(sql`l.title`, v)} or ${likeCi(sql`l.selling_plan_name`, v)})))`,
});

export type ContractSortKey = 'ID' | 'CREATED_AT' | 'UPDATED_AT' | 'NEXT_BILLING_DATE' | 'STATUS';

export async function listSubscriptionContracts(db: Executor, shopId: number, o: { query?: string | null; sortKey?: ContractSortKey; reverse?: boolean; offset: number; limit: number; customerId?: number }): Promise<SubscriptionContract[]> {
  const col = { CREATED_AT: subscriptionContracts.createdAt, UPDATED_AT: subscriptionContracts.updatedAt, NEXT_BILLING_DATE: subscriptionContracts.nextBillingDate, STATUS: subscriptionContracts.status }[o.sortKey as string] ?? subscriptionContracts.id;
  const dir = o.reverse ? desc : asc;
  return db.select().from(subscriptionContracts)
    .where(and(eq(subscriptionContracts.shopId, shopId), o.customerId ? eq(subscriptionContracts.customerId, o.customerId) : undefined, search(o.query)))
    .orderBy(dir(col as never), dir(subscriptionContracts.id)).limit(o.limit).offset(o.offset);
}

export async function countSubscriptionContracts(db: Executor, shopId: number, query?: string | null, customerId?: number): Promise<number> {
  const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(subscriptionContracts)
    .where(and(eq(subscriptionContracts.shopId, shopId), customerId ? eq(subscriptionContracts.customerId, customerId) : undefined, search(query)));
  return r?.n ?? 0;
}

/** Contracts per status (subscriptions list tabs). */
export async function subscriptionStatusCounts(db: Executor, shopId: number): Promise<Record<string, number>> {
  const rows = await db.select({ status: subscriptionContracts.status, n: sql<number>`count(*)::int` }).from(subscriptionContracts).where(eq(subscriptionContracts.shopId, shopId)).groupBy(subscriptionContracts.status);
  return Object.fromEntries(rows.map((r) => [r.status, r.n]));
}

// ---------------------------------------------------------------------------------------------------------------------
// Creating at checkout
// ---------------------------------------------------------------------------------------------------------------------

export interface NewContractLine {
  orderLineId: number;
  productId: number | null; variantId: number | null;
  title: string; variantTitle: string | null; sku: string | null; imageUrl: string | null;
  quantity: number; requiresShipping: boolean; taxable: boolean; grams: number;
  sellingPlanId: number; sellingPlanName: string;
  billingPolicy: PlanBillingPolicy; deliveryPolicy: PlanDeliveryPolicy; pricingPolicies: PlanPricingPolicy[];
  deliveries: number;
  /** One-time price per delivery in shop money. */
  basePrice: number;
}

export interface NewContractsInput {
  orderId: number; customerId: number | null; currency: string;
  /** Payment method id of the checkout. */
  gateway: string;
  address: ContractAddress | null;
  shipping: { title: string; code: string | null; price: number } | null;
  /** The checkout's discount applications (to carry subscription discounts over to the next payments). */
  discountApplications: DiscountApplication[];
  lines: NewContractLine[];
  now?: Date;
}

const policyKey = (l: NewContractLine) => `${l.billingPolicy.interval}:${l.billingPolicy.intervalCount}:${l.billingPolicy.maxCycles ?? ''}|${l.deliveryPolicy.interval}:${l.deliveryPolicy.intervalCount}`;

/** Discounts of the checkout that keep applying to the next payments of these lines. */
async function carriedDiscounts(db: Executor, shopId: number, apps: DiscountApplication[], orderLineIds: number[]): Promise<ContractDiscount[]> {
  const relevant = apps.filter((a) => a.discountId > 0 && a.allocated > 0 && (a.target === 'SHIPPING' || a.lineAllocations.some((x) => orderLineIds.includes(x.lineId))));
  if (!relevant.length) return [];
  const ids = relevant.map((a) => a.discountId);
  const [rows, exts] = await Promise.all([
    db.select().from(discounts).where(and(eq(discounts.shopId, shopId), inArray(discounts.id, ids))),
    db.select().from(discountExtensions).where(inArray(discountExtensions.discountId, ids)),
  ]);
  const out: ContractDiscount[] = [];
  for (const a of relevant) {
    const d = rows.find((r) => r.id === a.discountId);
    const ext = exts.find((e) => e.discountId === a.discountId);
    if (!d || !ext?.appliesOnSubscription) continue;
    const remaining = ext.recurringCycleLimit ? ext.recurringCycleLimit - 1 : null;
    if (remaining !== null && remaining <= 0) continue;
    out.push({ discountId: d.id, title: d.title, code: a.code, valueType: d.valueType as ContractDiscount['valueType'], value: d.value, target: d.target as ContractDiscount['target'], remainingCycles: remaining });
  }
  return out;
}

/**
 * One contract per billing and delivery schedule for the subscription lines of a checkout order. The lines are linked back to their
 * contract, and the first billing date is one billing interval after the order. Returns the new contract ids.
 */
export async function createContractsForOrder(db: Db, shopId: number, input: NewContractsInput): Promise<number[]> {
  if (!input.lines.length) return [];
  const now = input.now ?? new Date();
  const groups = new Map<string, NewContractLine[]>();
  for (const l of input.lines) groups.set(policyKey(l), [...(groups.get(policyKey(l)) ?? []), l]);
  const [order] = await db.select({ name: orders.name }).from(orders).where(eq(orders.id, input.orderId)).limit(1);
  const ids: number[] = [];
  for (const lines of groups.values()) {
    const first = lines[0]!;
    const ships = lines.some((l) => l.requiresShipping);
    const carried = await carriedDiscounts(db, shopId, input.discountApplications, lines.map((l) => l.orderLineId));
    const id = await db.transaction(async (tx) => {
      const [c] = await tx.insert(subscriptionContracts).values({
        shopId, customerId: input.customerId, status: 'ACTIVE', currency: input.currency, billingPolicy: first.billingPolicy, deliveryPolicy: first.deliveryPolicy,
        nextBillingDate: addInterval(now, first.billingPolicy.interval, first.billingPolicy.intervalCount), originOrderId: input.orderId, paymentGateway: input.gateway,
        deliveryAddress: ships ? input.address : null, deliveryMethod: ships && input.shipping ? { title: input.shipping.title, code: input.shipping.code } : null,
        deliveryPrice: ships && input.shipping ? input.shipping.price : 0, discounts: carried.filter((d) => ships || d.target !== 'SHIPPING'), cyclesCompleted: 1,
      }).returning();
      await tx.insert(subscriptionContractLines).values(lines.map((l) => ({
        shopId, contractId: c!.id, productId: l.productId, variantId: l.variantId, title: l.title, variantTitle: l.variantTitle, sku: l.sku, imageUrl: l.imageUrl, quantity: l.quantity,
        sellingPlanId: l.sellingPlanId, sellingPlanName: l.sellingPlanName, basePrice: l.basePrice, pricingPolicies: l.pricingPolicies, deliveriesPerBilling: l.deliveries,
        currentPrice: contractLinePrice(l.basePrice, l.pricingPolicies, l.deliveries, 2), requiresShipping: l.requiresShipping, taxable: l.taxable, grams: l.grams,
      })));
      await tx.update(orderLines).set({ subscriptionContractId: c!.id }).where(and(eq(orderLines.orderId, input.orderId), inArray(orderLines.id, lines.map((l) => l.orderLineId))));
      await addEvent(tx, shopId, { subjectType: CONTRACT_SUBJECT, subjectId: c!.id, verb: 'subscription_contracts/create', message: `Subscription created from order ${order?.name ?? ''}`.trim(), data: { orderId: input.orderId, name: order?.name } });
      if (input.customerId) await addEvent(tx, shopId, { subjectType: 'customer', subjectId: input.customerId, verb: 'customer.subscription_created', message: `Started subscription #${c!.id} with order ${order?.name ?? ''}`.trim(), data: { contractId: c!.id, orderId: input.orderId, name: order?.name ?? null } });
      return c!.id;
    });
    ids.push(id);
  }
  return ids;
}

/** Remember the Stripe customer and saved card of the checkout payment on the contracts the order started (off-session renewals use them). */
export async function attachContractPaymentMethod(db: Executor, shopId: number, orderId: number, ref: { customer?: string | null; paymentMethod?: string | null }): Promise<number> {
  if (!ref.customer && !ref.paymentMethod) return 0;
  const rows = await db.update(subscriptionContracts).set({ ...(ref.customer && { stripeCustomerId: ref.customer }), ...(ref.paymentMethod && { stripePaymentMethodId: ref.paymentMethod }), updatedAt: new Date() })
    .where(and(eq(subscriptionContracts.shopId, shopId), eq(subscriptionContracts.originOrderId, orderId))).returning({ id: subscriptionContracts.id });
  return rows.length;
}

// ---------------------------------------------------------------------------------------------------------------------
// Status changes
// ---------------------------------------------------------------------------------------------------------------------

export type ContractAction = 'pause' | 'activate' | 'cancel' | 'skip' | 'expire' | 'fail';
export interface ContractActionOptions { staffId?: number | null; actor?: 'staff' | 'customer' | 'system'; now?: Date }

const ACTION_FROM: Record<ContractAction, SubscriptionStatus[]> = {
  pause: ['ACTIVE'], activate: ['PAUSED', 'FAILED'], cancel: ['ACTIVE', 'PAUSED', 'FAILED'], skip: ['ACTIVE', 'PAUSED'], expire: ['ACTIVE', 'PAUSED', 'FAILED'], fail: ['ACTIVE', 'PAUSED'],
};
const ACTION_TO: Partial<Record<ContractAction, SubscriptionStatus>> = { pause: 'PAUSED', activate: 'ACTIVE', cancel: 'CANCELLED', expire: 'EXPIRED', fail: 'FAILED' };
const VERB: Record<ContractAction, string> = { pause: 'paused', activate: 'activated', cancel: 'cancelled', skip: 'skipped', expire: 'expired', fail: 'failed' };

/** Pause, resume, cancel, skip the next billing, expire or fail a contract. Invalid transitions come back as a user error. */
export async function changeContractStatus(db: Db, shopId: number, id: number, action: ContractAction, opts: ContractActionOptions = {}): Promise<Result<SubscriptionContract>> {
  const c = await getSubscriptionContract(db, shopId, id);
  if (!c) return errR(['subscriptionContractId'], 'Subscription contract does not exist', 'CONTRACT_DOES_NOT_EXIST');
  if (!ACTION_FROM[action].includes(c.status as SubscriptionStatus)) {
    const ended = c.status === 'CANCELLED' || c.status === 'EXPIRED';
    return errR(['subscriptionContractId'], ended ? 'The subscription has ended' : `A ${c.status.toLowerCase()} subscription cannot be ${VERB[action]}`, ended ? 'CONTRACT_TERMINATED' : 'INVALID');
  }
  // Customers cannot end a subscription before its minimum number of billing cycles; staff can.
  if (action === 'cancel' && opts.actor === 'customer' && c.billingPolicy.minCycles != null && c.cyclesCompleted < c.billingPolicy.minCycles) {
    return errR(['subscriptionContractId'], `This subscription can be cancelled after ${c.billingPolicy.minCycles} orders`, 'INVALID');
  }
  const now = opts.now ?? new Date();
  const set: Partial<typeof subscriptionContracts.$inferInsert> = { updatedAt: now };
  const data: Record<string, unknown> = { actor: opts.actor ?? 'staff' };
  const b = c.billingPolicy;
  if (ACTION_TO[action]) set.status = ACTION_TO[action];
  if (action === 'pause') set.pausedAt = now;
  if (action === 'cancel') set.cancelledAt = now;
  if (action === 'activate') {
    // A date that passed while paused moves to the next one in the schedule.
    let next = c.nextBillingDate;
    while (next <= now) next = addInterval(next, b.interval, b.intervalCount, c.createdAt.getUTCDate());
    Object.assign(set, { pausedAt: null, failedAttempts: 0, retryAt: null, nextBillingDate: next });
    data.nextBillingDate = next.toISOString();
  }
  if (action === 'skip') {
    set.nextBillingDate = addInterval(c.nextBillingDate, b.interval, b.intervalCount, c.createdAt.getUTCDate());
    Object.assign(data, { skippedDate: c.nextBillingDate.toISOString(), nextBillingDate: set.nextBillingDate.toISOString() });
  }
  return txResult(db, async (tx) => {
    const [row] = await tx.update(subscriptionContracts).set(set).where(eq(subscriptionContracts.id, id)).returning();
    const by = opts.actor === 'customer' ? ' by the customer' : '';
    const message = action === 'skip' ? `The order of ${c.nextBillingDate.toISOString().slice(0, 10)} was skipped${by}` : `Subscription ${VERB[action]}${by}`;
    await addEvent(tx, shopId, { subjectType: CONTRACT_SUBJECT, subjectId: id, verb: `subscription_contracts/${VERB[action]}`, message, authorStaffUserId: opts.staffId ?? null, data });
    if (c.customerId && (action === 'cancel' || action === 'pause' || action === 'activate')) await addEvent(tx, shopId, { subjectType: 'customer', subjectId: c.customerId, verb: `customer.subscription_${VERB[action]}`, message: `Subscription #${id} ${VERB[action]}${by}`, data: { contractId: id, actor: opts.actor ?? 'staff' } });
    return okR(row!);
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// Email variables
// ---------------------------------------------------------------------------------------------------------------------

const langOf = (shop: Shop) => (shop.locale.slice(0, 2).toLowerCase() === 'fr' ? 'fr' : 'en');
const dateText = (shop: Shop, d: Date) => new Intl.DateTimeFormat(langOf(shop) === 'fr' ? 'fr-FR' : 'en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: shop.timezone || 'UTC' }).format(d);

/** Liquid variables of the subscription emails (`subscription.*`, `customer.*`). */
export async function subscriptionMailVars(db: Executor, shop: Shop, appUrl: string, c: SubscriptionContract, extra: { error?: string | null; retry?: boolean; orderName?: string | null } = {}): Promise<Record<string, unknown>> {
  const lines = await listContractLines(db, shop.id, [c.id]);
  const [cust] = c.customerId ? await db.select().from(customers).where(eq(customers.id, c.customerId)).limit(1) : [];
  const money = (n: number) => moneyOf(shop, n, c.currency);
  const cycle = c.cyclesCompleted + 1;
  const items = lines.map((l) => ({ title: [l.title, l.variantTitle].filter(Boolean).join(' - '), quantity: l.quantity, plan: l.sellingPlanName ?? '', total: money(contractLinePrice(l.basePrice, l.pricingPolicies, l.deliveriesPerBilling, cycle) * l.quantity) }));
  const subtotal = lines.reduce((n, l) => n + contractLinePrice(l.basePrice, l.pricingPolicies, l.deliveriesPerBilling, cycle) * l.quantity, 0);
  const L = langOf(shop);
  return {
    customer: { first_name: cust?.firstName ?? '', last_name: cust?.lastName ?? '', email: cust?.email ?? '' },
    subscription: {
      id: c.id, name: `#${c.id}`, status: c.status.toLowerCase(), line_items: items, frequency: frequencyLabel(L, c.billingPolicy), delivery_frequency: frequencyLabel(L, c.deliveryPolicy),
      next_billing_date: dateText(shop, c.nextBillingDate), subtotal: money(subtotal), delivery_price: c.deliveryPrice ? money(c.deliveryPrice) : null, total: money(subtotal + c.deliveryPrice),
      manage_url: `${shopUrl(shop, appUrl)}/account`, error: extra.error ?? null, retry: !!extra.retry, order_name: extra.orderName ?? null,
    },
  };
}
