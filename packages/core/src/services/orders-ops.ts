import { and, asc, desc, eq, gte, inArray, lt, lte, sql } from 'drizzle-orm';
import {
  fulfillments, locations, marketingCampaigns, orderBatches, orders, products, returns, shippingLabels, visits,
} from '../db/schema';
import type { Db, Executor } from '../db/client';
import { errR, okR, txResult, type Result } from './catalog/common';
import { addEvent } from './events';
import { isCountryCode } from './markets/reference';
import { captureTransaction } from './orders/capture';
import { cancelFulfillment, createFulfillment, holdOrder, releaseOrderHold } from './orders/fulfillments';
import { getOrder, getOrderDetail, type Order, type OrderAddress, type OrderDetail } from './orders/orders';

const rowsOf = (r: unknown): Array<Record<string, unknown>> => ((r as { rows?: Array<Record<string, unknown>> }).rows ?? (r as Array<Record<string, unknown>>));

/* ------------------------------ address problems ------------------------------ */

export type AddressProblem = 'MISSING_ADDRESS' | 'NAME_MISSING' | 'ADDRESS1_MISSING' | 'CITY_MISSING' | 'ZIP_MISSING' | 'ZIP_INVALID' | 'COUNTRY_MISSING' | 'COUNTRY_UNKNOWN' | 'PHONE_INVALID';

/** Postal code formats of the countries we can check offline. Other countries only need a code to be present. */
const ZIP: Record<string, RegExp> = {
  FR: /^\d{5}$/, DE: /^\d{5}$/, ES: /^\d{5}$/, IT: /^\d{5}$/, US: /^\d{5}(-\d{4})?$/, GB: /^[A-Z]{1,2}\d[A-Z\d]? ?\d[A-Z]{2}$/i, CA: /^[A-Z]\d[A-Z] ?\d[A-Z]\d$/i,
  NL: /^\d{4} ?[A-Z]{2}$/i, BE: /^\d{4}$/, CH: /^\d{4}$/, AT: /^\d{4}$/, PT: /^\d{4}-\d{3}$/, AU: /^\d{4}$/, JP: /^\d{3}-?\d{4}$/, SE: /^\d{3} ?\d{2}$/, DK: /^\d{4}$/, PL: /^\d{2}-\d{3}$/, IE: /^[A-Z]\d{2} ?[A-Z\d]{4}$/i,
};
/** Countries that have no postal codes at all. */
const NO_ZIP = new Set(['AE', 'HK', 'IE_', 'QA', 'SA_', 'AO', 'BS', 'BZ', 'GH']);

/** Check a shipping address: required parts, postal code format of the country, phone shape. Pure. */
export function addressProblems(a: Pick<OrderAddress, 'firstName' | 'lastName' | 'address1' | 'city' | 'zip' | 'countryCode' | 'phone'> | null, requiresShipping = true): AddressProblem[] {
  if (!requiresShipping) return [];
  if (!a) return ['MISSING_ADDRESS'];
  const out: AddressProblem[] = [];
  const blank = (v: string | null | undefined) => !v || !v.trim();
  if (blank(a.firstName) && blank(a.lastName)) out.push('NAME_MISSING');
  if (blank(a.address1)) out.push('ADDRESS1_MISSING');
  if (blank(a.city)) out.push('CITY_MISSING');
  const cc = a.countryCode?.trim().toUpperCase() ?? '';
  if (!cc) out.push('COUNTRY_MISSING');
  else if (!isCountryCode(cc)) out.push('COUNTRY_UNKNOWN');
  if (!NO_ZIP.has(cc)) {
    if (blank(a.zip)) out.push('ZIP_MISSING');
    else if (ZIP[cc] && !ZIP[cc]!.test(a.zip!.trim())) out.push('ZIP_INVALID');
  }
  if (a.phone && a.phone.trim() && a.phone.replace(/\D/g, '').length < 6) out.push('PHONE_INVALID');
  return out;
}

export const orderAddressProblems = (d: Pick<OrderDetail, 'lines' | 'shippingAddress'>): AddressProblem[] => addressProblems(d.shippingAddress, d.lines.some((l) => l.requiresShipping));

/* ------------------------------ risk ------------------------------ */

export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH';
export interface RiskSignal { code: 'BILLING_COUNTRY_DIFFERS' | 'HIGH_VALUE' | 'REPEATED_ORDERS' | 'DISPOSABLE_EMAIL' | 'ADDRESS_PROBLEMS' | 'PAYMENT_FAILED' | 'PREVIOUS_FRAUD' | 'NEW_CUSTOMER_HIGH_VALUE'; weight: number; detail?: string }
export interface OrderRisk { level: RiskLevel; score: number; signals: RiskSignal[] }

const DISPOSABLE = ['mailinator.com', 'guerrillamail.com', '10minutemail.com', 'tempmail.com', 'yopmail.com', 'trashmail.com', 'sharklasers.com', 'getnada.com', 'throwawaymail.com', 'dispostable.com'];

export const riskLevelOf = (score: number): RiskLevel => (score >= 50 ? 'HIGH' : score >= 25 ? 'MEDIUM' : 'LOW');

/** Pure scoring from already-collected facts (see `orderRisk` for how they are gathered). */
export function scoreRisk(f: { email: string | null; billingCountry: string | null; shippingCountry: string | null; total: number; averageTotal: number; ordersLastDay: number; addressProblems: number; failedPayments: number; previousFraud: number; previousOrders: number }): OrderRisk {
  const signals: RiskSignal[] = [];
  if (f.billingCountry && f.shippingCountry && f.billingCountry !== f.shippingCountry) signals.push({ code: 'BILLING_COUNTRY_DIFFERS', weight: 20, detail: `${f.billingCountry} / ${f.shippingCountry}` });
  if (f.averageTotal > 0 && f.total >= f.averageTotal * 4 && f.total > 0) signals.push({ code: 'HIGH_VALUE', weight: 25 });
  if (f.previousOrders === 0 && f.averageTotal > 0 && f.total >= f.averageTotal * 2.5) signals.push({ code: 'NEW_CUSTOMER_HIGH_VALUE', weight: 15 });
  if (f.ordersLastDay >= 3) signals.push({ code: 'REPEATED_ORDERS', weight: 25, detail: String(f.ordersLastDay) });
  const domain = f.email?.split('@')[1]?.toLowerCase();
  if (domain && DISPOSABLE.includes(domain)) signals.push({ code: 'DISPOSABLE_EMAIL', weight: 30, detail: domain });
  if (f.addressProblems > 0) signals.push({ code: 'ADDRESS_PROBLEMS', weight: 15 });
  if (f.failedPayments > 0) signals.push({ code: 'PAYMENT_FAILED', weight: 15, detail: String(f.failedPayments) });
  if (f.previousFraud > 0) signals.push({ code: 'PREVIOUS_FRAUD', weight: 35 });
  const score = Math.min(100, signals.reduce((n, s) => n + s.weight, 0));
  return { level: riskLevelOf(score), score, signals };
}

/** A simple risk read from our own data only (no third party): geography, order value, order frequency, email domain, payment failures, past fraud cancellations. */
export async function orderRisk(db: Executor, shopId: number, order: Order, d: OrderDetail): Promise<OrderRisk> {
  const since = new Date(order.createdAt.getTime() - 86_400_000);
  const [avg] = await db.select({ v: sql<number>`coalesce(avg(${orders.total}), 0)::float` }).from(orders).where(and(eq(orders.shopId, shopId), sql`${orders.id} <> ${order.id}`, lt(orders.createdAt, order.createdAt)));
  const email = order.email?.toLowerCase() ?? null;
  const same = email ? await db.select({ id: orders.id, createdAt: orders.createdAt, cancelReason: orders.cancelReason }).from(orders).where(and(eq(orders.shopId, shopId), sql`lower(${orders.email}) = ${email}`, sql`${orders.id} <> ${order.id}`)) : [];
  const failed = d.transactions.filter((t) => t.status === 'FAILURE' || t.status === 'ERROR').length;
  return scoreRisk({
    email, billingCountry: d.billingAddress?.countryCode?.toUpperCase() ?? null, shippingCountry: d.shippingAddress?.countryCode?.toUpperCase() ?? null,
    total: order.total, averageTotal: avg?.v ?? 0, ordersLastDay: same.filter((o) => o.createdAt >= since && o.createdAt <= order.createdAt).length + 1,
    addressProblems: orderAddressProblems(d).length, failedPayments: failed, previousFraud: same.filter((o) => o.cancelReason === 'FRAUD').length, previousOrders: same.filter((o) => o.createdAt < order.createdAt).length,
  });
}

/* ------------------------------ conversion summary ------------------------------ */

export interface OrderConversion { visits: number; firstVisitAt: Date; landingPath: string; referrer: string | null; utmSource: string | null; utmMedium: string | null; utmCampaign: string | null; lastVisitPath: string }

/** What we know of the buyer's visit before the order: first page seen, where they came from, campaign tags. Null when the order did not come from a tracked visit. */
export async function orderConversion(db: Executor, shopId: number, order: Pick<Order, 'visitSessionId' | 'createdAt'>): Promise<OrderConversion | null> {
  if (!order.visitSessionId) return null;
  const rows = await db.select().from(visits).where(and(eq(visits.shopId, shopId), eq(visits.sessionId, order.visitSessionId), lte(visits.createdAt, new Date(order.createdAt.getTime() + 60_000)))).orderBy(asc(visits.createdAt), asc(visits.id)).limit(500);
  const first = rows[0];
  if (!first) return null;
  const tagged = rows.find((r) => r.utmSource || r.utmMedium || r.utmCampaign) ?? first;
  return {
    visits: rows.length, firstVisitAt: first.createdAt, landingPath: first.path, referrer: first.referrer, lastVisitPath: rows.at(-1)!.path,
    utmSource: tagged.utmSource, utmMedium: tagged.utmMedium, utmCampaign: tagged.utmCampaign,
  };
}

/* ------------------------------ delivery status ------------------------------ */

export type DeliveryStatus = 'NOT_FULFILLED' | 'IN_TRANSIT' | 'DELIVERED';
export const deliveryStatusOf = (d: Pick<OrderDetail, 'fulfillments'>): DeliveryStatus => {
  const live = d.fulfillments.filter((f) => f.status !== 'CANCELLED');
  if (!live.length) return 'NOT_FULFILLED';
  return live.every((f) => f.deliveredAt) ? 'DELIVERED' : 'IN_TRANSIT';
};

/* ------------------------------ stats strip ------------------------------ */

export interface StatsMetric { key: 'orders' | 'items' | 'sales' | 'returns' | 'fulfilled' | 'delivered' | 'fulfillmentHours'; value: number; previous: number; series: number[] }
export interface OrdersStats { from: Date; to: Date; buckets: Date[]; currency: string; metrics: StatsMetric[] }

/**
 * Figures of the strip above the orders list for `[from, to)`, with the previous period of the same length for the comparison and one
 * point per bucket (hourly for a day or less, daily otherwise) for the sparklines. Money is in minor units.
 */
export async function ordersStats(db: Executor, shopId: number, o: { from: Date; to: Date; locationId?: number | null }, currency: string): Promise<OrdersStats> {
  const span = Math.max(1, o.to.getTime() - o.from.getTime());
  const prevFrom = new Date(o.from.getTime() - span);
  const step = span <= 86_400_000 * 1.01 ? 3_600_000 : 86_400_000;
  const n = Math.min(200, Math.ceil(span / step));
  const buckets = Array.from({ length: n }, (_, i) => new Date(o.from.getTime() + i * step));
  const at = (d: Date) => Math.min(n - 1, Math.max(0, Math.floor((d.getTime() - o.from.getTime()) / step)));
  const loc = o.locationId
    ? sql`and (exists (select 1 from fulfillments f where f.order_id = ${orders.id} and f.status <> 'CANCELLED' and f.location_id = ${o.locationId}) or not exists (select 1 from fulfillments f where f.order_id = ${orders.id} and f.status <> 'CANCELLED'))`
    : undefined;
  const rows = await db.select({
    id: orders.id, createdAt: orders.createdAt, total: orders.total, items: sql<number>`coalesce((select sum(l.quantity) from order_lines l where l.order_id = ${orders.id}), 0)::int`,
    firstShipped: sql<Date | null>`(select min(f.created_at) from fulfillments f where f.order_id = ${orders.id} and f.status <> 'CANCELLED')`,
  }).from(orders).where(and(eq(orders.shopId, shopId), gte(orders.createdAt, prevFrom), lt(orders.createdAt, o.to), sql`${orders.cancelledAt} is null`, loc));
  const inCur = (d: Date) => d >= o.from && d < o.to;
  const fulfilledNow = await db.select({ at: fulfillments.createdAt, deliveredAt: fulfillments.deliveredAt }).from(fulfillments)
    .where(and(eq(fulfillments.shopId, shopId), sql`${fulfillments.status} <> 'CANCELLED'`, sql`(${fulfillments.createdAt} >= ${prevFrom.toISOString()}::timestamptz or ${fulfillments.deliveredAt} >= ${prevFrom.toISOString()}::timestamptz)`));
  const ret = await db.select({ at: returns.createdAt }).from(returns).where(and(eq(returns.shopId, shopId), gte(returns.createdAt, prevFrom), lt(returns.createdAt, o.to)));

  const mk = (key: StatsMetric['key']): StatsMetric => ({ key, value: 0, previous: 0, series: Array.from({ length: n }, () => 0) });
  const m = { orders: mk('orders'), items: mk('items'), sales: mk('sales'), returns: mk('returns'), fulfilled: mk('fulfilled'), delivered: mk('delivered'), fulfillmentHours: mk('fulfillmentHours') };
  const add = (x: StatsMetric, when: Date, v: number) => { if (inCur(when)) { x.value += v; x.series[at(when)]! += v; } else if (when >= prevFrom && when < o.from) x.previous += v; };
  const hours = { cur: [] as number[], prev: [] as number[], series: Array.from({ length: n }, () => [] as number[]) };
  for (const r of rows) {
    add(m.orders, r.createdAt, 1); add(m.items, r.createdAt, r.items); add(m.sales, r.createdAt, r.total);
    if (r.firstShipped) {
      const h = (new Date(r.firstShipped).getTime() - r.createdAt.getTime()) / 3_600_000;
      if (inCur(r.createdAt)) { hours.cur.push(h); hours.series[at(r.createdAt)]!.push(h); } else hours.prev.push(h);
    }
  }
  for (const f of fulfilledNow) { add(m.fulfilled, f.at, 1); if (f.deliveredAt) add(m.delivered, f.deliveredAt, 1); }
  for (const r of ret) add(m.returns, r.at, 1);
  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
  m.fulfillmentHours.value = avg(hours.cur); m.fulfillmentHours.previous = avg(hours.prev); m.fulfillmentHours.series = hours.series.map(avg);
  return { from: o.from, to: o.to, buckets, currency, metrics: Object.values(m) };
}

/* ------------------------------ mark as ------------------------------ */

export const MARK_AS = ['UNFULFILLED', 'IN_PROGRESS', 'FULFILLED', 'ON_HOLD', 'DELIVERED'] as const;
export type MarkAs = (typeof MARK_AS)[number];

/** Set the fulfilment state of one order the way the bulk "Mark as" menu does. */
export async function markOrderAs(db: Db, shopId: number, orderId: number, status: MarkAs, staffId?: number | null): Promise<Result<Order>> {
  const order = await getOrder(db, shopId, orderId);
  if (!order) return errR(['id'], 'Order does not exist', 'NOT_FOUND');
  if (order.cancelledAt) return errR(['id'], `${order.name} is cancelled`, 'INVALID');
  const live = async () => (await getOrderDetail(db, shopId, orderId)).fulfillments.filter((f) => f.status !== 'CANCELLED');
  switch (status) {
    case 'UNFULFILLED': {
      if (order.heldAt) { const r = await releaseOrderHold(db, shopId, orderId, staffId); if (!r.ok) return r; }
      for (const f of await live()) { const r = await cancelFulfillment(db, shopId, f.id, staffId); if (!r.ok) return r; }
      const [row] = await db.update(orders).set({ fulfillmentStatus: 'UNFULFILLED', updatedAt: new Date() }).where(eq(orders.id, orderId)).returning();
      return okR(row!);
    }
    case 'IN_PROGRESS': {
      if (order.heldAt) { const r = await releaseOrderHold(db, shopId, orderId, staffId); if (!r.ok) return r; }
      if (order.fulfillmentStatus === 'FULFILLED') return errR(['id'], `${order.name} is already fulfilled`, 'INVALID');
      const [row] = await db.update(orders).set({ fulfillmentStatus: order.fulfillmentStatus === 'PARTIALLY_FULFILLED' ? 'PARTIALLY_FULFILLED' : 'IN_PROGRESS', updatedAt: new Date() }).where(eq(orders.id, orderId)).returning();
      await addEvent(db, shopId, { subjectType: 'order', subjectId: orderId, verb: 'order.updated', message: 'Order was marked as in progress', authorStaffUserId: staffId });
      return okR(row!);
    }
    case 'FULFILLED': {
      if (order.heldAt) { const r = await releaseOrderHold(db, shopId, orderId, staffId); if (!r.ok) return r; }
      if (order.fulfillmentStatus === 'FULFILLED') return okR(order);
      const r = await createFulfillment(db, shopId, orderId, { staffId, notifyCustomer: false });
      return r.ok ? okR(r.value.order) : r;
    }
    case 'ON_HOLD': {
      if (order.heldAt) return okR(order);
      return holdOrder(db, shopId, orderId, { reason: 'OTHER', staffId });
    }
    case 'DELIVERED': {
      if (order.heldAt) { const r = await releaseOrderHold(db, shopId, orderId, staffId); if (!r.ok) return r; }
      if (order.fulfillmentStatus !== 'FULFILLED') { const r = await createFulfillment(db, shopId, orderId, { staffId, notifyCustomer: false }); if (!r.ok) return r; }
      const pending = (await live()).filter((f) => !f.deliveredAt);
      const now = new Date();
      if (pending.length) {
        await db.update(fulfillments).set({ deliveredAt: now, updatedAt: now }).where(inArray(fulfillments.id, pending.map((f) => f.id)));
        await addEvent(db, shopId, { subjectType: 'order', subjectId: orderId, verb: 'order.delivered', message: 'Order was marked as delivered', authorStaffUserId: staffId });
      }
      return okR((await getOrder(db, shopId, orderId))!);
    }
  }
}

/* ------------------------------ capture payments ------------------------------ */

/** Authorisations of the order that still hold money to collect: `{ transactionId, remaining }` (minor units). */
export function capturableOf(txs: OrderDetail['transactions']): Array<{ id: number; remaining: number }> {
  return txs.filter((t) => t.kind === 'AUTHORIZATION' && t.status === 'SUCCESS').flatMap((auth) => {
    const kids = txs.filter((t) => t.parentId === auth.id && t.status === 'SUCCESS');
    if (kids.some((t) => t.kind === 'VOID' || (t.kind === 'CAPTURE' && t.errorCode === 'FINAL'))) return [];
    const remaining = auth.amount - kids.filter((t) => t.kind === 'CAPTURE').reduce((s, t) => s + t.amount, 0);
    return remaining > 0 ? [{ id: auth.id, remaining }] : [];
  });
}

/** Collect everything still authorised on one order. */
export async function captureOrderPayments(db: Db, shopId: number, orderId: number, staffId?: number | null): Promise<Result<Order>> {
  const order = await getOrder(db, shopId, orderId);
  if (!order) return errR(['id'], 'Order does not exist', 'NOT_FOUND');
  const todo = capturableOf((await getOrderDetail(db, shopId, orderId)).transactions);
  if (!todo.length) return errR(['id'], `${order.name} has no payment to capture`, 'INVALID');
  for (const a of todo) {
    const r = await captureTransaction(db, shopId, { orderId, parentTransactionId: a.id, amount: a.remaining, finalCapture: true, staffId });
    if (!r.ok) return r;
  }
  return okR((await getOrder(db, shopId, orderId))!);
}

/* ------------------------------ batches ------------------------------ */

export type OrderBatch = typeof orderBatches.$inferSelect;

export async function listBatches(db: Executor, shopId: number): Promise<Array<OrderBatch & { orderCount: number }>> {
  const rows = await db.select().from(orderBatches).where(eq(orderBatches.shopId, shopId)).orderBy(desc(orderBatches.id));
  const counts = rows.length ? await db.select({ id: orders.batchId, n: sql<number>`count(*)::int` }).from(orders).where(and(eq(orders.shopId, shopId), inArray(orders.batchId, rows.map((r) => r.id)))).groupBy(orders.batchId) : [];
  return rows.map((r) => ({ ...r, orderCount: counts.find((c) => c.id === r.id)?.n ?? 0 }));
}

export async function getBatch(db: Executor, shopId: number, id: number): Promise<OrderBatch | null> {
  const [r] = await db.select().from(orderBatches).where(and(eq(orderBatches.shopId, shopId), eq(orderBatches.id, id))).limit(1);
  return r ?? null;
}

async function assignOrders(tx: Executor, shopId: number, batchId: number | null, orderIds: number[], staffId: number | null | undefined, name: string | null): Promise<number> {
  if (!orderIds.length) return 0;
  const rows = await tx.update(orders).set({ batchId, updatedAt: new Date() }).where(and(eq(orders.shopId, shopId), inArray(orders.id, orderIds))).returning({ id: orders.id });
  for (const r of rows) await addEvent(tx, shopId, { subjectType: 'order', subjectId: r.id, verb: 'order.updated', message: name ? `Order was added to batch ${name}` : 'Order was removed from its batch', authorStaffUserId: staffId });
  return rows.length;
}

export async function createBatch(db: Db, shopId: number, i: { name?: string | null; orderIds: number[]; staffId?: number | null }): Promise<Result<OrderBatch & { orderCount: number }>> {
  if (!i.orderIds.length) return errR(['orderIds'], 'Select at least one order', 'INVALID');
  return txResult(db, async (tx) => {
    const [n] = await tx.select({ n: sql<number>`count(*)::int` }).from(orderBatches).where(eq(orderBatches.shopId, shopId));
    const name = i.name?.trim() || `Batch ${(n?.n ?? 0) + 1}`;
    if (name.length > 100) return errR(['name'], 'Name is too long (maximum is 100 characters)', 'TOO_LONG');
    const [b] = await tx.insert(orderBatches).values({ shopId, name }).returning();
    const count = await assignOrders(tx, shopId, b!.id, i.orderIds, i.staffId, b!.name);
    return okR({ ...b!, orderCount: count });
  });
}

export async function moveToBatch(db: Db, shopId: number, i: { batchId: number | null; orderIds: number[]; staffId?: number | null }): Promise<Result<{ batch: OrderBatch | null; moved: number }>> {
  return txResult(db, async (tx) => {
    const batch = i.batchId ? await getBatch(tx, shopId, i.batchId) : null;
    if (i.batchId && !batch) return errR(['batchId'], 'Batch does not exist', 'NOT_FOUND');
    return okR({ batch, moved: await assignOrders(tx, shopId, batch?.id ?? null, i.orderIds, i.staffId, batch?.name ?? null) });
  });
}

export async function renameBatch(db: Db, shopId: number, id: number, name: string): Promise<Result<OrderBatch>> {
  const n = name.trim();
  if (!n) return errR(['name'], "Name can't be blank", 'BLANK');
  const [b] = await db.update(orderBatches).set({ name: n.slice(0, 100), updatedAt: new Date() }).where(and(eq(orderBatches.shopId, shopId), eq(orderBatches.id, id))).returning();
  return b ? okR(b) : errR(['id'], 'Batch does not exist', 'NOT_FOUND');
}

/** Delete a batch; its orders simply leave it. */
export async function deleteBatch(db: Db, shopId: number, id: number): Promise<Result<{ id: number }>> {
  return txResult(db, async (tx) => {
    if (!(await getBatch(tx, shopId, id))) return errR(['id'], 'Batch does not exist', 'NOT_FOUND');
    await tx.update(orders).set({ batchId: null }).where(and(eq(orders.shopId, shopId), eq(orders.batchId, id)));
    await tx.delete(orderBatches).where(eq(orderBatches.id, id));
    return okR({ id });
  });
}

/* ------------------------------ shipping labels ------------------------------ */

export type ShippingLabel = typeof shippingLabels.$inferSelect;

export interface LabelInput { orderId: number; carrier: string; service?: string | null; trackingNumber?: string | null; trackingUrl?: string | null; cost?: number | null; weightGrams?: number | null; notifyCustomer?: boolean; staffId?: number | null }

/**
 * Record a label bought outside (or printed from a carrier's own site): the carrier, service and tracking number are stored with the order and
 * the unfulfilled items are fulfilled with that tracking, so the customer gets their shipping notification. Buying postage from a carrier account
 * is `purchaseLabel` (services/shipping/labels.ts).
 */
export async function createShippingLabel(db: Db, shopId: number, i: LabelInput): Promise<Result<ShippingLabel>> {
  const carrier = i.carrier.trim();
  if (!carrier) return errR(['carrier'], "Carrier can't be blank", 'BLANK');
  if (carrier.length > 100) return errR(['carrier'], 'Carrier is too long', 'TOO_LONG');
  if ((i.cost ?? 0) < 0) return errR(['cost'], 'Cost cannot be negative', 'INVALID');
  const order = await getOrder(db, shopId, i.orderId);
  if (!order) return errR(['orderId'], 'Order does not exist', 'NOT_FOUND');
  if (order.cancelledAt) return errR(['orderId'], 'Cannot ship a cancelled order', 'INVALID');
  const tracking = i.trackingNumber?.trim() || null;
  const url = i.trackingUrl?.trim() || null;
  if (url && !/^https?:\/\//i.test(url)) return errR(['trackingUrl'], 'Tracking link must start with http:// or https://', 'INVALID');
  let fulfillmentId: number | null = null;
  const d = await getOrderDetail(db, shopId, i.orderId);
  const open = d.lines.some((l) => l.requiresShipping && l.currentQuantity > l.fulfilledQuantity) && !order.heldAt;
  if (open) {
    const f = await createFulfillment(db, shopId, i.orderId, {
      lines: d.lines.filter((l) => l.currentQuantity > l.fulfilledQuantity).map((l) => ({ orderLineId: l.id, quantity: l.currentQuantity - l.fulfilledQuantity })),
      tracking: { company: carrier, numbers: tracking ? [tracking] : [], urls: url ? [url] : [] }, notifyCustomer: !!i.notifyCustomer, staffId: i.staffId,
    });
    if (!f.ok) return f;
    fulfillmentId = f.value.fulfillment.id;
  }
  const [row] = await db.insert(shippingLabels).values({ shopId, orderId: i.orderId, fulfillmentId, carrier, service: i.service?.trim() || null, trackingNumber: tracking, trackingUrl: url, cost: i.cost ?? 0, weightGrams: i.weightGrams ?? null }).returning();
  await addEvent(db, shopId, { subjectType: 'order', subjectId: i.orderId, verb: 'order.label_created', message: `Shipping label recorded (${carrier}${tracking ? ` ${tracking}` : ''})`, authorStaffUserId: i.staffId, data: { labelId: row!.id, carrier, trackingNumber: tracking } });
  return okR(row!);
}

export async function voidShippingLabel(db: Db, shopId: number, id: number, staffId?: number | null): Promise<Result<ShippingLabel>> {
  const [l] = await db.select().from(shippingLabels).where(and(eq(shippingLabels.shopId, shopId), eq(shippingLabels.id, id))).limit(1);
  if (!l) return errR(['id'], 'Label does not exist', 'NOT_FOUND');
  if (l.status === 'VOIDED') return errR(['id'], 'Label is already voided', 'INVALID');
  const [row] = await db.update(shippingLabels).set({ status: 'VOIDED', voidedAt: new Date(), updatedAt: new Date() }).where(eq(shippingLabels.id, id)).returning();
  await addEvent(db, shopId, { subjectType: 'order', subjectId: l.orderId, verb: 'order.label_voided', message: `Shipping label voided (${l.carrier}${l.trackingNumber ? ` ${l.trackingNumber}` : ''})`, authorStaffUserId: staffId });
  return okR(row!);
}

export async function listShippingLabels(db: Executor, shopId: number, o: { status?: 'ACTIVE' | 'VOIDED' | null; orderId?: number | null; limit: number; offset: number }): Promise<Array<ShippingLabel & { orderName: string }>> {
  const rows = await db.select({ l: shippingLabels, orderName: orders.name }).from(shippingLabels).innerJoin(orders, eq(orders.id, shippingLabels.orderId))
    .where(and(eq(shippingLabels.shopId, shopId), o.status ? eq(shippingLabels.status, o.status) : undefined, o.orderId ? eq(shippingLabels.orderId, o.orderId) : undefined))
    .orderBy(desc(shippingLabels.createdAt), desc(shippingLabels.id)).limit(o.limit).offset(o.offset);
  return rows.map((r) => ({ ...r.l, orderName: r.orderName }));
}

export async function countShippingLabels(db: Executor, shopId: number, status?: 'ACTIVE' | 'VOIDED' | null): Promise<number> {
  const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(shippingLabels).where(and(eq(shippingLabels.shopId, shopId), status ? eq(shippingLabels.status, status) : undefined));
  return r?.n ?? 0;
}

/** Open orders with something to ship and no label yet: the "ready for a label" queue of the labels page. */
export async function ordersAwaitingLabel(db: Executor, shopId: number, limit = 50): Promise<Order[]> {
  return db.select().from(orders).where(and(
    eq(orders.shopId, shopId), sql`${orders.cancelledAt} is null`, sql`${orders.closedAt} is null`, sql`${orders.heldAt} is null`, inArray(orders.fulfillmentStatus, ['UNFULFILLED', 'IN_PROGRESS', 'PARTIALLY_FULFILLED']),
    sql`exists (select 1 from order_lines l where l.order_id = ${orders.id} and l.requires_shipping and l.current_quantity > l.fulfilled_quantity)`,
    sql`not exists (select 1 from shipping_labels s where s.order_id = ${orders.id} and s.status = 'ACTIVE')`,
  )).orderBy(asc(orders.createdAt)).limit(limit);
}

/* ------------------------------ marketing ------------------------------ */

export type MarketingCampaign = typeof marketingCampaigns.$inferSelect;
export interface CampaignInput { name?: string; channel?: string; utmSource?: string | null; utmMedium?: string | null; utmCampaign?: string | null; budget?: number; status?: 'DRAFT' | 'ACTIVE' | 'ENDED'; startsAt?: Date | null; endsAt?: Date | null; notes?: string | null }
export const CAMPAIGN_CHANNELS = ['email', 'social', 'search', 'display', 'affiliate', 'influencer', 'other'] as const;

const trimOrNull = (v: string | null | undefined) => (v == null ? null : v.trim().slice(0, 200) || null);

export async function saveCampaign(db: Executor, shopId: number, id: number | null, i: CampaignInput): Promise<Result<MarketingCampaign>> {
  if (id == null && !i.name?.trim()) return errR(['name'], "Name can't be blank", 'BLANK');
  if (i.name !== undefined && !i.name.trim()) return errR(['name'], "Name can't be blank", 'BLANK');
  if (i.channel && !(CAMPAIGN_CHANNELS as readonly string[]).includes(i.channel)) return errR(['channel'], 'Channel is invalid', 'INVALID');
  if (i.budget != null && (!Number.isInteger(i.budget) || i.budget < 0)) return errR(['budget'], 'Budget must be 0 or more', 'INVALID');
  if (i.startsAt && i.endsAt && i.endsAt < i.startsAt) return errR(['endsAt'], 'The end date must be after the start date', 'INVALID');
  const patch = {
    ...(i.name !== undefined && { name: i.name.trim().slice(0, 200) }), ...(i.channel && { channel: i.channel }),
    ...(i.utmSource !== undefined && { utmSource: trimOrNull(i.utmSource) }), ...(i.utmMedium !== undefined && { utmMedium: trimOrNull(i.utmMedium) }), ...(i.utmCampaign !== undefined && { utmCampaign: trimOrNull(i.utmCampaign) }),
    ...(i.budget != null && { budget: i.budget }), ...(i.status && { status: i.status }), ...(i.startsAt !== undefined && { startsAt: i.startsAt }), ...(i.endsAt !== undefined && { endsAt: i.endsAt }), ...(i.notes !== undefined && { notes: i.notes?.trim().slice(0, 2000) || null }),
  };
  if (id == null) { const [r] = await db.insert(marketingCampaigns).values({ shopId, name: i.name!.trim().slice(0, 200), ...patch }).returning(); return okR(r!); }
  const [r] = await db.update(marketingCampaigns).set({ ...patch, updatedAt: new Date() }).where(and(eq(marketingCampaigns.shopId, shopId), eq(marketingCampaigns.id, id))).returning();
  return r ? okR(r) : errR(['id'], 'Campaign does not exist', 'NOT_FOUND');
}

export async function deleteCampaign(db: Executor, shopId: number, id: number): Promise<boolean> {
  const r = await db.delete(marketingCampaigns).where(and(eq(marketingCampaigns.shopId, shopId), eq(marketingCampaigns.id, id))).returning({ id: marketingCampaigns.id });
  return r.length > 0;
}

export interface AttributionRow { source: string; medium: string; campaign: string; orders: number; sales: number; visits: number }

/**
 * Orders of the period grouped by where the buyer came from: the campaign tags (`utm_*`) of the first tagged page of their visit, else the
 * referring site, else "direct". Only orders placed after a tracked visit are attributed; the rest count as "unknown".
 */
export async function attributionReport(db: Executor, shopId: number, from: Date, to: Date): Promise<{ rows: AttributionRow[]; currency: string | null; totalOrders: number; totalSales: number; attributedOrders: number }> {
  const res = await db.execute(sql`
    select coalesce(v.utm_source, nullif(v.referrer, ''), 'direct') as source, coalesce(v.utm_medium, '') as medium, coalesce(v.utm_campaign, '') as campaign,
      count(*)::int as orders, coalesce(sum(o.total), 0)::bigint as sales, coalesce(sum(v.n), 0)::int as visits
    from orders o
    join lateral (
      select (array_agg(x.utm_source order by (x.utm_source is null), x.created_at))[1] as utm_source, (array_agg(x.utm_medium order by (x.utm_medium is null), x.created_at))[1] as utm_medium,
        (array_agg(x.utm_campaign order by (x.utm_campaign is null), x.created_at))[1] as utm_campaign, (array_agg(x.referrer order by (x.referrer is null), x.created_at))[1] as referrer, count(*) as n
      from visits x where x.shop_id = o.shop_id and x.session_id = o.visit_session_id and x.created_at <= o.created_at + interval '1 minute'
    ) v on true
    where o.shop_id = ${shopId} and o.created_at >= ${from.toISOString()}::timestamptz and o.created_at < ${to.toISOString()}::timestamptz and o.cancelled_at is null and o.visit_session_id is not null
    group by 1, 2, 3 order by sales desc, orders desc limit 100`);
  const rows = rowsOf(res).map((r) => ({ source: String(r.source), medium: String(r.medium), campaign: String(r.campaign), orders: Number(r.orders), sales: Number(r.sales), visits: Number(r.visits) }));
  const [tot] = await db.select({ n: sql<number>`count(*)::int`, s: sql<number>`coalesce(sum(${orders.total}), 0)::float`, c: sql<string | null>`max(${orders.currency})` }).from(orders)
    .where(and(eq(orders.shopId, shopId), gte(orders.createdAt, from), lt(orders.createdAt, to), sql`${orders.cancelledAt} is null`));
  return { rows, currency: tot?.c ?? null, totalOrders: tot?.n ?? 0, totalSales: Math.round(tot?.s ?? 0), attributedOrders: rows.reduce((n, r) => n + r.orders, 0) };
}

/** Orders and sales credited to each campaign (matching `utm_campaign`, and `utm_source` when the campaign sets one) within its dates. */
export async function campaignResults(db: Executor, shopId: number): Promise<Array<MarketingCampaign & { orders: number; sales: number }>> {
  const list = await db.select().from(marketingCampaigns).where(eq(marketingCampaigns.shopId, shopId)).orderBy(desc(marketingCampaigns.createdAt));
  const out: Array<MarketingCampaign & { orders: number; sales: number }> = [];
  for (const c of list) {
    if (!c.utmCampaign && !c.utmSource && !c.utmMedium) { out.push({ ...c, orders: 0, sales: 0 }); continue; }
    const res = await db.execute(sql`
      select count(*)::int as orders, coalesce(sum(o.total), 0)::bigint as sales from orders o
      where o.shop_id = ${shopId} and o.cancelled_at is null and o.visit_session_id is not null
        ${c.startsAt ? sql`and o.created_at >= ${c.startsAt.toISOString()}::timestamptz` : sql``} ${c.endsAt ? sql`and o.created_at <= ${c.endsAt.toISOString()}::timestamptz` : sql``}
        and exists (select 1 from visits x where x.shop_id = o.shop_id and x.session_id = o.visit_session_id and x.created_at <= o.created_at + interval '1 minute'
          ${c.utmCampaign ? sql`and lower(x.utm_campaign) = ${c.utmCampaign.toLowerCase()}` : sql``} ${c.utmSource ? sql`and lower(x.utm_source) = ${c.utmSource.toLowerCase()}` : sql``} ${c.utmMedium ? sql`and lower(x.utm_medium) = ${c.utmMedium.toLowerCase()}` : sql``})`);
    const r = rowsOf(res)[0] ?? {};
    out.push({ ...c, orders: Number(r.orders ?? 0), sales: Number(r.sales ?? 0) });
  }
  return out;
}

/* ------------------------------ sales channels ------------------------------ */

export interface SalesChannel { handle: string; kind: 'storefront' | 'manual' | 'draft'; active: boolean; products: number; published: number; orders: number; sales: number }

/** The ways orders reach the shop: the online store (products published to it) and the staff-entered sources, with their order counts. */
export async function salesChannels(db: Executor, shopId: number): Promise<SalesChannel[]> {
  const [p] = await db.select({ total: sql<number>`count(*) filter (where ${products.status} <> 'ARCHIVED')::int`, published: sql<number>`count(*) filter (where ${products.status} = 'ACTIVE' and ${products.publishedAt} is not null)::int` }).from(products).where(eq(products.shopId, shopId));
  const by = await db.select({ source: orders.sourceName, n: sql<number>`count(*)::int`, s: sql<number>`coalesce(sum(${orders.total}), 0)::float` }).from(orders).where(and(eq(orders.shopId, shopId), sql`${orders.cancelledAt} is null`)).groupBy(orders.sourceName);
  const sum = (names: string[]) => by.filter((b) => names.includes(b.source ?? 'web')).reduce((a, b) => ({ n: a.n + b.n, s: a.s + b.s }), { n: 0, s: 0 });
  const web = sum(['web']), draft = sum(['draft', 'draft_order', 'shopify_draft_order']), manual = sum(['manual', 'pos']);
  return [
    { handle: 'online-store', kind: 'storefront', active: true, products: p?.total ?? 0, published: p?.published ?? 0, orders: web.n, sales: Math.round(web.s) },
    { handle: 'draft-orders', kind: 'draft', active: true, products: 0, published: 0, orders: draft.n, sales: Math.round(draft.s) },
    { handle: 'manual', kind: 'manual', active: true, products: 0, published: 0, orders: manual.n, sales: Math.round(manual.s) },
  ];
}

/** Publish every active product to the online store (sets the publication date), or take them all off it. */
export async function setStorefrontPublication(db: Executor, shopId: number, publish: boolean): Promise<number> {
  const rows = publish
    ? await db.update(products).set({ publishedAt: new Date() }).where(and(eq(products.shopId, shopId), eq(products.status, 'ACTIVE'), sql`${products.publishedAt} is null`)).returning({ id: products.id })
    : await db.update(products).set({ publishedAt: null }).where(and(eq(products.shopId, shopId), sql`${products.publishedAt} is not null`)).returning({ id: products.id });
  return rows.length;
}

/** All active locations, for the "All locations" filter. */
export const activeLocations = (db: Executor, shopId: number) => db.select().from(locations).where(and(eq(locations.shopId, shopId), eq(locations.isActive, true))).orderBy(asc(locations.priority), asc(locations.id));
