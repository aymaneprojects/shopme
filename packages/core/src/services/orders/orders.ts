import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import {
  customers, fulfillmentLines, fulfillments, inventoryLevels, orderAddresses, orderDiscountApplications, orderLines, orderShippingLines, orderTaxLines, orders, refundLines, refunds, transactions,
} from '../../db/schema';
import type { Db, Executor } from '../../db/client';
import { buildSearch, dateCompare, idTerm, likeCi } from '../catalog/search';
import { errR, normalizeTags, okR, txResult, type Result } from '../catalog/common';
import { adjustQuantities, defaultLocationId, getInventoryItemForVariant } from '../catalog/inventory';
import { addComment, addEvent } from '../events';

export type Order = typeof orders.$inferSelect;
export type OrderLine = typeof orderLines.$inferSelect;
export type OrderAddress = typeof orderAddresses.$inferSelect;
export type OrderTransaction = typeof transactions.$inferSelect;
export type Fulfillment = typeof fulfillments.$inferSelect & { lines: (typeof fulfillmentLines.$inferSelect)[] };
export type Refund = typeof refunds.$inferSelect & { lines: (typeof refundLines.$inferSelect)[]; transactions: OrderTransaction[] };

export interface OrderDetail {
  lines: OrderLine[];
  shippingAddress: OrderAddress | null;
  billingAddress: OrderAddress | null;
  shippingLines: (typeof orderShippingLines.$inferSelect)[];
  taxLines: (typeof orderTaxLines.$inferSelect)[];
  discounts: (typeof orderDiscountApplications.$inferSelect)[];
  transactions: OrderTransaction[];
  fulfillments: Fulfillment[];
  refunds: Refund[];
}

export async function getOrder(db: Executor, shopId: number, id: number): Promise<Order | null> {
  const [r] = await db.select().from(orders).where(and(eq(orders.shopId, shopId), eq(orders.id, id))).limit(1);
  return r ?? null;
}

/** Everything hanging off one order, loaded in a handful of queries. */
export async function getOrderDetail(db: Executor, shopId: number, orderId: number): Promise<OrderDetail> {
  const [lines, addresses, shippingLines, taxLines, discounts, txs, fs, rs] = await Promise.all([
    db.select().from(orderLines).where(and(eq(orderLines.shopId, shopId), eq(orderLines.orderId, orderId))).orderBy(asc(orderLines.position), asc(orderLines.id)),
    db.select().from(orderAddresses).where(and(eq(orderAddresses.shopId, shopId), eq(orderAddresses.orderId, orderId))),
    db.select().from(orderShippingLines).where(and(eq(orderShippingLines.shopId, shopId), eq(orderShippingLines.orderId, orderId))).orderBy(asc(orderShippingLines.id)),
    db.select().from(orderTaxLines).where(and(eq(orderTaxLines.shopId, shopId), eq(orderTaxLines.orderId, orderId))).orderBy(asc(orderTaxLines.id)),
    db.select().from(orderDiscountApplications).where(and(eq(orderDiscountApplications.shopId, shopId), eq(orderDiscountApplications.orderId, orderId))).orderBy(asc(orderDiscountApplications.id)),
    db.select().from(transactions).where(and(eq(transactions.shopId, shopId), eq(transactions.orderId, orderId))).orderBy(asc(transactions.id)),
    db.select().from(fulfillments).where(and(eq(fulfillments.shopId, shopId), eq(fulfillments.orderId, orderId))).orderBy(asc(fulfillments.id)),
    db.select().from(refunds).where(and(eq(refunds.shopId, shopId), eq(refunds.orderId, orderId))).orderBy(asc(refunds.id)),
  ]);
  const fl = fs.length ? await db.select().from(fulfillmentLines).where(inArray(fulfillmentLines.fulfillmentId, fs.map((f) => f.id))) : [];
  const rl = rs.length ? await db.select().from(refundLines).where(inArray(refundLines.refundId, rs.map((r) => r.id))) : [];
  return {
    lines,
    shippingAddress: addresses.find((a) => a.kind === 'shipping') ?? null,
    billingAddress: addresses.find((a) => a.kind === 'billing') ?? null,
    shippingLines, taxLines, discounts, transactions: txs,
    fulfillments: fs.map((f) => ({ ...f, lines: fl.filter((l) => l.fulfillmentId === f.id) })),
    // Refund transactions are the REFUND rows written in the same instant as the refund (see refunds.ts).
    refunds: rs.map((r) => ({ ...r, lines: rl.filter((l) => l.refundId === r.id), transactions: txs.filter((t) => t.kind === 'REFUND' && t.createdAt.getTime() === r.createdAt.getTime()) })),
  };
}

/* ------------------------------ search ------------------------------ */

const FULFILLMENT_QUERY: Record<string, string[]> = {
  shipped: ['FULFILLED'], fulfilled: ['FULFILLED'], partial: ['PARTIALLY_FULFILLED'], unshipped: ['UNFULFILLED'],
  unfulfilled: ['UNFULFILLED', 'PARTIALLY_FULFILLED'], restocked: ['RESTOCKED'], on_hold: ['ON_HOLD'],
};

const likeParam = (v: string) => `%${v.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

export const orderSearch = (q: string | null | undefined) => buildSearch(q, {
  fields: {
    name: (_o, v) => likeCi(orders.name, v.replace(/^#/, '')),
    email: (_o, v) => likeCi(orders.email, v, true),
    id: (_o, v) => idTerm(orders.id, v),
    customer_id: (_o, v) => idTerm(orders.customerId, v),
    financial_status: (_o, v) => sql`${orders.financialStatus} = ${v.toUpperCase()}`,
    fulfillment_status: (_o, v) => { const s = FULFILLMENT_QUERY[v.toLowerCase()]; return v.toLowerCase() === 'on_hold' ? sql`${orders.heldAt} is not null` : s ? inArray(orders.fulfillmentStatus, s) : null; },
    status: (_o, v) => {
      switch (v.toLowerCase()) {
        case 'open': return sql`(${orders.closedAt} is null and ${orders.cancelledAt} is null)`;
        case 'closed': return sql`${orders.closedAt} is not null`;
        case 'cancelled': return sql`${orders.cancelledAt} is not null`;
        default: return null;
      }
    },
    tag: (_o, v) => sql`exists (select 1 from unnest(${orders.tags}) t where lower(t) = ${v.toLowerCase()})`,
    test: (_o, v) => sql`${orders.test} = ${v === 'true'}`,
    created_at: (op, v) => dateCompare(orders.createdAt, op, v),
    processed_at: (op, v) => dateCompare(orders.processedAt, op, v),
    updated_at: (op, v) => dateCompare(orders.updatedAt, op, v),
    sku: (_o, v) => sql`exists (select 1 from order_lines l where l.order_id = ${orders.id} and l.sku ilike ${v})`,
  },
  text: (v) => {
    const like = likeParam(v);
    return sql`(${orders.name} ilike ${like} or ${orders.email} ilike ${like}
      or exists (select 1 from ${customers} c where c.id = ${orders.customerId} and (c.first_name ilike ${like} or c.last_name ilike ${like} or concat_ws(' ', c.first_name, c.last_name) ilike ${like}))
      or exists (select 1 from order_lines l where l.order_id = ${orders.id} and (l.title ilike ${like} or l.sku ilike ${like}))
      or exists (select 1 from unnest(${orders.tags}) t where t ilike ${like}))`;
  },
});

export type OrderSortKey = 'CREATED_AT' | 'CURRENT_TOTAL_PRICE' | 'CUSTOMER_NAME' | 'DESTINATION' | 'FINANCIAL_STATUS' | 'FULFILLMENT_STATUS' | 'ID' | 'ORDER_NUMBER' | 'PO_NUMBER' | 'PROCESSED_AT' | 'RELEVANCE' | 'TOTAL_ITEMS_QUANTITY' | 'TOTAL_PRICE' | 'UPDATED_AT';

export async function listOrders(db: Executor, shopId: number, o: { query?: string | null; sortKey?: OrderSortKey; reverse?: boolean; offset: number; limit: number }): Promise<Order[]> {
  const cols: Record<string, unknown> = {
    CREATED_AT: orders.createdAt, PROCESSED_AT: orders.processedAt, UPDATED_AT: orders.updatedAt, ID: orders.id, ORDER_NUMBER: orders.orderNumber,
    TOTAL_PRICE: orders.total, CURRENT_TOTAL_PRICE: sql`${orders.total} - ${orders.totalRefunded}`, FINANCIAL_STATUS: orders.financialStatus, FULFILLMENT_STATUS: orders.fulfillmentStatus,
    CUSTOMER_NAME: sql`(select lower(concat_ws(' ', c.first_name, c.last_name)) from ${customers} c where c.id = ${orders.customerId})`,
    DESTINATION: sql`(select a.country from order_addresses a where a.order_id = ${orders.id} and a.kind = 'shipping')`,
    TOTAL_ITEMS_QUANTITY: sql`(select coalesce(sum(l.quantity), 0) from order_lines l where l.order_id = ${orders.id})`,
  };
  const col = cols[o.sortKey ?? 'PROCESSED_AT'] ?? orders.processedAt;
  const dir = o.reverse ? desc : asc;
  return db.select().from(orders).where(and(eq(orders.shopId, shopId), orderSearch(o.query)))
    .orderBy(dir(col as never), dir(orders.id)).limit(o.limit).offset(o.offset);
}

export async function countOrders(db: Executor, shopId: number, query?: string | null, limit = 10000): Promise<{ count: number; precision: 'EXACT' | 'AT_LEAST' }> {
  const rows = await db.select({ id: orders.id }).from(orders).where(and(eq(orders.shopId, shopId), orderSearch(query))).limit(limit + 1);
  return rows.length > limit ? { count: limit, precision: 'AT_LEAST' } : { count: rows.length, precision: 'EXACT' };
}

/* ------------------------------ updates ------------------------------ */

export interface AddressInput { firstName?: string | null; lastName?: string | null; company?: string | null; address1?: string | null; address2?: string | null; city?: string | null; provinceCode?: string | null; zip?: string | null; countryCode?: string | null; phone?: string | null }
export interface OrderUpdateInput { email?: string | null; phone?: string | null; note?: string | null; tags?: string[] | null; shippingAddress?: AddressInput | null; billingAddress?: AddressInput | null }

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Address input -> column values (province and country names mirror the codes until a region table exists). */
export function addressColumns(a: AddressInput) {
  const { provinceCode, countryCode, ...rest } = a;
  return {
    ...rest,
    ...(provinceCode !== undefined && { provinceCode, province: provinceCode }),
    ...(countryCode ? { countryCode: countryCode.toUpperCase(), country: countryCode.toUpperCase() } : {}),
  };
}

export async function updateOrder(db: Db, shopId: number, id: number, input: OrderUpdateInput, staffId?: number | null): Promise<Result<Order>> {
  const cur = await getOrder(db, shopId, id);
  if (!cur) return errR(['id'], 'Order does not exist');
  if (input.email && !EMAIL_RE.test(input.email)) return errR(['email'], 'Email is invalid');
  const tags = input.tags ? normalizeTags(input.tags) : undefined;
  if (tags && tags.length > 250) return errR(['tags'], 'Too many tags (maximum is 250)');
  return txResult(db, async (tx) => {
    const [row] = await tx.update(orders).set({
      ...(input.email !== undefined && { email: input.email?.toLowerCase() || null }), ...(input.phone !== undefined && { phone: input.phone || null }),
      ...(input.note !== undefined && { note: input.note || null }), ...(tags && { tags }), updatedAt: new Date(),
    }).where(eq(orders.id, id)).returning();
    for (const [kind, addr] of [['shipping', input.shippingAddress], ['billing', input.billingAddress]] as const) {
      if (!addr) continue;
      const cols = addressColumns(addr);
      const [exists] = await tx.select({ id: orderAddresses.id }).from(orderAddresses).where(and(eq(orderAddresses.orderId, id), eq(orderAddresses.kind, kind)));
      if (exists) await tx.update(orderAddresses).set(cols).where(eq(orderAddresses.id, exists.id));
      else await tx.insert(orderAddresses).values({ shopId, orderId: id, kind, ...cols });
    }
    await addEvent(tx, shopId, { subjectType: 'order', subjectId: id, verb: 'order.updated', message: input.billingAddress && !input.shippingAddress ? 'Billing address was updated' : input.shippingAddress && !input.billingAddress ? 'Shipping address was updated' : 'Order details were updated', authorStaffUserId: staffId });
    return okR(row!);
  });
}

export async function changeOrderTags(db: Db, shopId: number, id: number, mode: 'add' | 'remove', tags: string[]): Promise<Result<Order>> {
  const cur = await getOrder(db, shopId, id);
  if (!cur) return errR(['id'], 'Order does not exist');
  const drop = new Set(tags.flatMap((t) => t.split(',')).map((t) => t.trim().toLowerCase()));
  const next = mode === 'add' ? normalizeTags([...cur.tags, ...tags]) : cur.tags.filter((t) => !drop.has(t.toLowerCase()));
  if (next.length > 250) return errR(['tags'], 'Too many tags (maximum is 250)');
  const [row] = await db.update(orders).set({ tags: next, updatedAt: new Date() }).where(eq(orders.id, id)).returning();
  return okR(row!);
}

async function setClosed(db: Db, shopId: number, id: number, closed: boolean, staffId?: number | null): Promise<Result<Order>> {
  const cur = await getOrder(db, shopId, id);
  if (!cur) return errR(['id'], 'Order does not exist');
  if (!!cur.closedAt === closed) return okR(cur);
  const [row] = await db.update(orders).set({ closedAt: closed ? new Date() : null, updatedAt: new Date() }).where(eq(orders.id, id)).returning();
  await addEvent(db, shopId, { subjectType: 'order', subjectId: id, verb: closed ? 'order.closed' : 'order.opened', message: closed ? 'Order was archived' : 'Order was unarchived', authorStaffUserId: staffId });
  return okR(row!);
}
export const closeOrder = (db: Db, shopId: number, id: number, staffId?: number | null) => setClosed(db, shopId, id, true, staffId);
export const openOrder = (db: Db, shopId: number, id: number, staffId?: number | null) => setClosed(db, shopId, id, false, staffId);

/**
 * Put `qty` of a sold variant back on the shelf (best effort: untracked or unknown variants are skipped).
 * `unfulfilled` is the part of `qty` that was never shipped: it is still committed, so it is released
 * (committed -> available, on hand unchanged) instead of being added to on hand a second time.
 */
export async function restockVariant(db: Executor, shopId: number, variantId: number | null, qty: number, locationId: number | null, ref: string, unfulfilled = 0): Promise<void> {
  if (!variantId || qty <= 0) return;
  const item = await getInventoryItemForVariant(db, shopId, variantId);
  const loc = locationId ?? (await defaultLocationId(db, shopId));
  if (!item || !item.tracked || !loc) return;
  const [level] = unfulfilled > 0
    ? await db.select({ committed: inventoryLevels.committed }).from(inventoryLevels).where(and(eq(inventoryLevels.inventoryItemId, item.id), eq(inventoryLevels.locationId, loc)))
    : [];
  const release = Math.min(qty, Math.max(0, unfulfilled), Math.max(0, level?.committed ?? 0));
  if (release > 0) await adjustQuantities(db as Db, shopId, { name: 'committed', reason: 'restock', referenceDocumentUri: ref, changes: [{ inventoryItemId: item.id, locationId: loc, delta: -release }] });
  if (qty - release > 0) await adjustQuantities(db as Db, shopId, { name: 'available', reason: 'restock', referenceDocumentUri: ref, changes: [{ inventoryItemId: item.id, locationId: loc, delta: qty - release }] });
}

/** Money received (successful SALE/CAPTURE) and refunded (successful REFUND) according to the transaction log. */
export function paidAmounts(txs: OrderTransaction[]) {
  const sum = (kinds: string[]) => txs.filter((t) => t.status === 'SUCCESS' && kinds.includes(t.kind)).reduce((s, t) => s + t.amount, 0);
  return { received: sum(['SALE', 'CAPTURE']), refunded: sum(['REFUND']) };
}

export async function markOrderAsPaid(db: Db, shopId: number, id: number, staffId?: number | null): Promise<Result<Order>> {
  const cur = await getOrder(db, shopId, id);
  if (!cur) return errR(['id'], 'Order does not exist');
  if (cur.cancelledAt) return errR(['id'], 'Cannot mark a cancelled order as paid');
  return txResult(db, async (tx) => {
    const { received } = paidAmounts((await getOrderDetail(tx, shopId, id)).transactions);
    const outstanding = cur.total - received;
    if (cur.financialStatus === 'PAID' || outstanding <= 0) return errR(['id'], 'Order is already paid');
    const now = new Date();
    await tx.insert(transactions).values({ shopId, orderId: id, kind: 'SALE', status: 'SUCCESS', gateway: 'manual', amount: outstanding, currency: cur.currency, test: cur.test, processedAt: now });
    const [row] = await tx.update(orders).set({ financialStatus: 'PAID', updatedAt: now }).where(eq(orders.id, id)).returning();
    await addEvent(tx, shopId, { subjectType: 'order', subjectId: id, verb: 'order.paid', message: 'Order was marked as paid', authorStaffUserId: staffId });
    return okR(row!);
  });
}

/* ------------------------------ timeline ------------------------------ */

export async function addOrderComment(db: Db, shopId: number, id: number, message: string, staffId: number | null) {
  if (!(await getOrder(db, shopId, id))) return errR(['id'], 'Order does not exist');
  return addComment(db, shopId, 'order', id, message, staffId);
}
