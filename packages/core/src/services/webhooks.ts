import { createHmac } from 'node:crypto';
import { and, asc, desc, eq, inArray, lte, or, isNull, sql } from 'drizzle-orm';
import { formatMoney, toGid } from '@shopme/shopify-compat';
import { customers, draftOrders, fulfillments, orderLines, orders, productVariants, products, refundLines, refunds, shops, transactions, webhookDeliveries, webhookSubscriptions } from '../db/schema';
import type { Db, Executor } from '../db/client';
import { errR, okR, type Result } from './catalog/common';
import { randomToken } from './crypto';
import { postGuarded, resolvesToPrivate, webhooksAllowPrivate } from './net-guard';
import type { EventRow } from './events';
import { getOrderSummary } from './orders/create';
import type { Shop } from './shops';
import { recordWebhookFailure } from './activity';

/** Webhook topics in Shopify's enum form; the wire form (`X-Shopify-Topic`) is lower case with `/`. */
export const WEBHOOK_TOPICS = [
  'PRODUCTS_CREATE', 'PRODUCTS_UPDATE', 'PRODUCTS_DELETE',
  'ORDERS_CREATE', 'ORDERS_PAID', 'ORDERS_UPDATED', 'ORDERS_FULFILLED', 'ORDERS_CANCELLED',
  'FULFILLMENTS_CREATE', 'FULFILLMENTS_UPDATE', 'REFUNDS_CREATE',
  'CUSTOMERS_CREATE', 'CUSTOMERS_UPDATE', 'CUSTOMERS_DELETE',
  'DRAFT_ORDERS_CREATE', 'DRAFT_ORDERS_UPDATE', 'DRAFT_ORDERS_DELETE',
] as const;
export type WebhookTopic = (typeof WEBHOOK_TOPICS)[number];
export const topicToWire = (t: string) => t.toLowerCase().replace('_', '/');
export const topicFromWire = (t: string) => t.toUpperCase().replace('/', '_');

const ORDER_CHANGED = ['orders/updated'];
/** Domain event verb (the `events` table) -> webhook topics it triggers. */
const VERB_TOPICS: Record<string, string[]> = {
  'products/create': ['products/create'], 'products/update': ['products/update'], 'products/delete': ['products/delete'],
  'customers/create': ['customers/create'], 'customers/update': ['customers/update'], 'customers/delete': ['customers/delete'],
  'order.created': ['orders/create'], 'order.paid': ['orders/paid', ...ORDER_CHANGED], 'order.updated': ORDER_CHANGED,
  'order.fulfilled': ['orders/fulfilled', 'fulfillments/create', ...ORDER_CHANGED], 'order.tracking_updated': ['fulfillments/update', ...ORDER_CHANGED],
  'order.cancelled': ['orders/cancelled', ...ORDER_CHANGED], 'order.refunded': ['refunds/create', ...ORDER_CHANGED],
  'draft_orders/create': ['draft_orders/create'], 'draft_orders/update': ['draft_orders/update'], 'draft_orders/delete': ['draft_orders/delete'],
};

export type WebhookSubscription = typeof webhookSubscriptions.$inferSelect;
export type WebhookDelivery = typeof webhookDeliveries.$inferSelect;

// ---- secret -----------------------------------------------------------------------------------------------------------------

/** Per-shop signing secret (`shops.settings.webhookSecret`), created on first use. */
export async function getWebhookSecret(db: Executor, shop: Shop, rotate = false): Promise<string> {
  const cur = shop.settings.webhookSecret;
  if (typeof cur === 'string' && cur && !rotate) return cur;
  const fresh = `whsec_${randomToken(24)}`;
  // Atomic: a concurrent first use keeps whichever secret was written first.
  const value = rotate ? sql`to_jsonb(${fresh}::text)` : sql`coalesce(${shops.settings}->'webhookSecret', to_jsonb(${fresh}::text))`;
  const [row] = await db.update(shops).set({ settings: sql`jsonb_set(${shops.settings}, '{webhookSecret}', ${value})` }).where(eq(shops.id, shop.id)).returning({ s: shops.settings });
  return String((row!.s as Record<string, unknown>).webhookSecret);
}

export const signBody = (secret: string, body: string) => createHmac('sha256', secret).update(body, 'utf8').digest('base64');

// ---- subscriptions ----------------------------------------------------------------------------------------------------------

export interface SubscriptionInput { callbackUrl?: string | null; format?: string | null }

async function validate(i: SubscriptionInput): Promise<string | null> {
  if (i.callbackUrl != null) {
    let u: URL;
    try { u = new URL(i.callbackUrl); } catch { return 'Address is invalid'; }
    if (!['http:', 'https:'].includes(u.protocol) || i.callbackUrl.length > 2000) return 'Address must be an http(s) URL';
    if (u.username || u.password) return 'Address must not contain credentials';
    // SSRF: checked again at delivery, after DNS resolution, so a name that later points inward is still refused.
    if (!webhooksAllowPrivate() && (await resolvesToPrivate(u.hostname))) return 'Address must not point to a private or loopback network';
  }
  if (i.format != null && i.format !== 'JSON') return 'Only the JSON format is supported';
  return null;
}

export async function createSubscription(db: Executor, shopId: number, topic: string, i: SubscriptionInput): Promise<Result<WebhookSubscription>> {
  if (!(WEBHOOK_TOPICS as readonly string[]).includes(topic)) return errR(['topic'], 'Topic is not supported', 'INVALID');
  if (!i.callbackUrl) return errR(['webhookSubscription', 'callbackUrl'], "Address can't be blank", 'BLANK');
  const bad = await validate(i);
  if (bad) return errR(['webhookSubscription', 'callbackUrl'], bad, 'INVALID');
  const [dup] = await db.select({ id: webhookSubscriptions.id }).from(webhookSubscriptions)
    .where(and(eq(webhookSubscriptions.shopId, shopId), eq(webhookSubscriptions.topic, topic), eq(webhookSubscriptions.endpointUrl, i.callbackUrl))).limit(1);
  if (dup) return errR(['webhookSubscription', 'callbackUrl'], 'Address for this topic has already been taken', 'TAKEN');
  const [row] = await db.insert(webhookSubscriptions).values({ shopId, topic, endpointUrl: i.callbackUrl, secret: '', format: 'JSON' }).returning();
  return okR(row!);
}

export async function updateSubscription(db: Executor, shopId: number, id: number, i: SubscriptionInput): Promise<Result<WebhookSubscription>> {
  const cur = await getSubscription(db, shopId, id);
  if (!cur) return errR(['id'], 'Webhook subscription does not exist', 'NOT_FOUND');
  const bad = await validate(i);
  if (bad) return errR(['webhookSubscription', 'callbackUrl'], bad, 'INVALID');
  const [row] = await db.update(webhookSubscriptions).set({ ...(i.callbackUrl && { endpointUrl: i.callbackUrl }), updatedAt: new Date() }).where(eq(webhookSubscriptions.id, id)).returning();
  return okR(row!);
}

export async function deleteSubscription(db: Executor, shopId: number, id: number): Promise<Result<number>> {
  if (!(await getSubscription(db, shopId, id))) return errR(['id'], 'Webhook subscription does not exist', 'NOT_FOUND');
  await db.delete(webhookSubscriptions).where(eq(webhookSubscriptions.id, id));
  return okR(id);
}

export async function getSubscription(db: Executor, shopId: number, id: number): Promise<WebhookSubscription | null> {
  return (await db.select().from(webhookSubscriptions).where(and(eq(webhookSubscriptions.shopId, shopId), eq(webhookSubscriptions.id, id))).limit(1))[0] ?? null;
}

export async function listSubscriptions(db: Executor, shopId: number, o: { topics?: string[]; reverse?: boolean; offset: number; limit: number }): Promise<WebhookSubscription[]> {
  return db.select().from(webhookSubscriptions)
    .where(and(eq(webhookSubscriptions.shopId, shopId), o.topics?.length ? inArray(webhookSubscriptions.topic, o.topics) : undefined))
    .orderBy((o.reverse ? desc : asc)(webhookSubscriptions.id)).limit(o.limit).offset(o.offset);
}

export async function listDeliveries(db: Executor, shopId: number, o: { subscriptionId?: number | null; status?: string | null; offset: number; limit: number }): Promise<WebhookDelivery[]> {
  return db.select().from(webhookDeliveries)
    .where(and(eq(webhookDeliveries.shopId, shopId), o.subscriptionId ? eq(webhookDeliveries.subscriptionId, o.subscriptionId) : undefined, o.status ? eq(webhookDeliveries.status, o.status) : undefined))
    .orderBy(desc(webhookDeliveries.id)).limit(o.limit).offset(o.offset);
}

// ---- payloads (Shopify REST webhook shapes, trimmed) ------------------------------------------------------------------------

const iso = (d: Date | null) => (d ? d.toISOString() : null);
const gid = (type: string, id: number) => toGid(type, id);

async function orderPayload(db: Executor, shopId: number, id: number): Promise<Record<string, unknown> | null> {
  const o = await getOrderSummary(db, shopId, id);
  if (!o) return null;
  const c = o.order.currency; const m = (n: number) => formatMoney(n, c);
  const addr = (a: typeof o.shippingAddress) => (a ? { first_name: a.firstName, last_name: a.lastName, company: a.company, address1: a.address1, address2: a.address2, city: a.city, province: a.province, province_code: a.provinceCode, zip: a.zip, country: a.country, country_code: a.countryCode, phone: a.phone } : null);
  const [cust] = o.order.customerId ? await db.select().from(customers).where(eq(customers.id, o.order.customerId)).limit(1) : [];
  const fs = await db.select().from(fulfillments).where(eq(fulfillments.orderId, id)).orderBy(asc(fulfillments.id));
  return {
    id, admin_graphql_api_id: gid('Order', id), name: o.order.name, order_number: o.order.orderNumber, email: o.order.email, phone: o.order.phone, note: o.order.note, tags: o.order.tags.join(', '),
    created_at: iso(o.order.createdAt), updated_at: iso(o.order.updatedAt), processed_at: iso(o.order.processedAt), cancelled_at: iso(o.order.cancelledAt), closed_at: iso(o.order.closedAt), cancel_reason: o.order.cancelReason?.toLowerCase() ?? null,
    currency: c, test: o.order.test, taxes_included: o.order.taxesIncluded, financial_status: o.order.financialStatus.toLowerCase(), fulfillment_status: o.order.fulfillmentStatus === 'UNFULFILLED' ? null : o.order.fulfillmentStatus.toLowerCase(),
    subtotal_price: m(o.order.subtotal), total_discounts: m(o.order.totalDiscounts), total_shipping_price: m(o.order.totalShipping), total_tax: m(o.order.totalTax), total_price: m(o.order.total), total_refunded: m(o.order.totalRefunded),
    line_items: o.lines.map((l) => ({ id: l.id, admin_graphql_api_id: gid('LineItem', l.id), product_id: l.productId, variant_id: l.variantId, title: l.title, variant_title: l.variantTitle, sku: l.sku, vendor: l.vendor, quantity: l.quantity, current_quantity: l.currentQuantity, fulfilled_quantity: l.fulfilledQuantity, price: m(l.unitPrice), total_discount: m(Math.max(0, l.unitPrice * l.quantity - l.discountedTotal)), requires_shipping: l.requiresShipping, taxable: l.taxable, grams: l.weightGrams ?? 0 })),
    shipping_lines: o.shippingLines.map((s) => ({ id: s.id, title: s.title, code: s.code, price: m(s.price) })),
    tax_lines: o.taxLines.map((t) => ({ title: t.title, rate: t.rate, price: m(t.price) })),
    discount_applications: o.discounts.map((d) => ({ code: d.code, title: d.title, value_type: d.valueType, allocated_amount: m(d.allocatedAmount) })),
    shipping_address: addr(o.shippingAddress), billing_address: addr(o.billingAddress),
    customer: cust ? { id: cust.id, admin_graphql_api_id: gid('Customer', cust.id), email: cust.email, first_name: cust.firstName, last_name: cust.lastName, phone: cust.phone } : null,
    fulfillments: fs.map((f) => ({ id: f.id, name: f.name, status: f.status.toLowerCase(), tracking_company: f.trackingCompany, tracking_numbers: f.trackingNumbers, tracking_urls: f.trackingUrls })),
    gateway: o.transactions[0]?.gateway ?? null,
  };
}

async function productPayload(db: Executor, shopId: number, id: number): Promise<Record<string, unknown> | null> {
  const [p] = await db.select().from(products).where(and(eq(products.shopId, shopId), eq(products.id, id))).limit(1);
  if (!p) return null;
  const shop = await db.select({ c: shops.currency }).from(shops).where(eq(shops.id, shopId)).limit(1);
  const vs = await db.select().from(productVariants).where(eq(productVariants.productId, id)).orderBy(asc(productVariants.position));
  return {
    id, admin_graphql_api_id: gid('Product', id), title: p.title, handle: p.handle, body_html: p.descriptionHtml, vendor: p.vendor, product_type: p.productType, status: p.status.toLowerCase(), tags: p.tags.join(', '),
    created_at: iso(p.createdAt), updated_at: iso(p.updatedAt), published_at: iso(p.publishedAt),
    variants: vs.map((v) => ({ id: v.id, admin_graphql_api_id: gid('ProductVariant', v.id), product_id: id, title: v.title, sku: v.sku, barcode: v.barcode, price: formatMoney(v.price, shop[0]?.c ?? 'USD'), compare_at_price: v.compareAtPrice == null ? null : formatMoney(v.compareAtPrice, shop[0]?.c ?? 'USD'), taxable: v.taxable, position: v.position })),
  };
}

async function customerPayload(db: Executor, shopId: number, id: number): Promise<Record<string, unknown> | null> {
  const [c] = await db.select().from(customers).where(and(eq(customers.shopId, shopId), eq(customers.id, id))).limit(1);
  if (!c) return null;
  return {
    id, admin_graphql_api_id: gid('Customer', id), email: c.email, first_name: c.firstName, last_name: c.lastName, phone: c.phone, accepts_marketing: c.acceptsMarketing, tags: c.tags.join(', '), state: c.state.toLowerCase(),
    orders_count: c.numberOfOrders, created_at: iso(c.createdAt), updated_at: iso(c.updatedAt), tax_exempt: c.taxExempt, note: c.note,
  };
}

async function refundPayload(db: Executor, shopId: number, refundId: number): Promise<Record<string, unknown> | null> {
  const [r] = await db.select().from(refunds).where(and(eq(refunds.shopId, shopId), eq(refunds.id, refundId))).limit(1);
  if (!r) return null;
  const [o] = await db.select({ c: orders.currency }).from(orders).where(eq(orders.id, r.orderId)).limit(1);
  const c = o?.c ?? 'USD';
  const lines = await db.select().from(refundLines).where(eq(refundLines.refundId, refundId));
  const txs = await db.select().from(transactions).where(and(eq(transactions.orderId, r.orderId), eq(transactions.kind, 'REFUND'), eq(transactions.createdAt, r.createdAt)));
  return {
    id: refundId, admin_graphql_api_id: gid('Refund', refundId), order_id: r.orderId, note: r.note, created_at: iso(r.createdAt), processed_at: iso(r.processedAt), total: formatMoney(r.total, c),
    refund_line_items: lines.map((l) => ({ id: l.id, line_item_id: l.orderLineId, quantity: l.quantity, restock_type: l.restockType?.toLowerCase() ?? null, subtotal: formatMoney(l.subtotal, c), total_tax: formatMoney(l.totalTax, c) })),
    transactions: txs.map((t) => ({ id: t.id, kind: 'refund', gateway: t.gateway, amount: formatMoney(t.amount, c), status: t.status.toLowerCase() })),
  };
}

async function fulfillmentPayload(db: Executor, shopId: number, id: number): Promise<Record<string, unknown> | null> {
  const [f] = await db.select().from(fulfillments).where(and(eq(fulfillments.shopId, shopId), eq(fulfillments.id, id))).limit(1);
  if (!f) return null;
  const lines = await db.select({ l: orderLines }).from(orderLines).where(eq(orderLines.orderId, f.orderId));
  return { id, admin_graphql_api_id: gid('Fulfillment', id), order_id: f.orderId, name: f.name, status: f.status.toLowerCase(), tracking_company: f.trackingCompany, tracking_numbers: f.trackingNumbers, tracking_urls: f.trackingUrls, created_at: iso(f.createdAt), updated_at: iso(f.updatedAt), line_items: lines.map(({ l }) => ({ id: l.id, title: l.title, sku: l.sku })) };
}

async function draftPayload(db: Executor, shopId: number, id: number): Promise<Record<string, unknown> | null> {
  const [d] = await db.select().from(draftOrders).where(and(eq(draftOrders.shopId, shopId), eq(draftOrders.id, id))).limit(1);
  if (!d) return null;
  const m = (n: number) => formatMoney(n, d.currency);
  return {
    id, admin_graphql_api_id: gid('DraftOrder', id), name: d.name, status: d.status.toLowerCase(), email: d.email, currency: d.currency, note: d.note, tags: d.tags.join(', '), order_id: d.orderId,
    subtotal_price: m(d.subtotal), total_tax: m(d.totalTax), total_price: m(d.total), invoice_sent_at: iso(d.invoiceSentAt), completed_at: iso(d.completedAt), created_at: iso(d.createdAt), updated_at: iso(d.updatedAt),
    line_items: d.lines.map((l) => ({ title: l.title, variant_id: l.variantId, quantity: l.quantity, price: m(l.unitPrice) })),
  };
}

/** Payload for `topic` from the event that triggered it, or null when the resource is not readable (yet, or any more). */
export async function buildPayload(db: Executor, shopId: number, topic: string, e: Pick<EventRow, 'subjectId' | 'data'>): Promise<Record<string, unknown> | null> {
  const id = e.subjectId;
  if (id == null) return null;
  if (topic.endsWith('/delete')) return { id };
  const data = (e.data ?? {}) as { refundId?: number; fulfillmentId?: number };
  if (topic.startsWith('orders/')) return orderPayload(db, shopId, id);
  if (topic.startsWith('products/')) return productPayload(db, shopId, id);
  if (topic.startsWith('customers/')) return customerPayload(db, shopId, id);
  if (topic.startsWith('draft_orders/')) return draftPayload(db, shopId, id);
  if (topic === 'refunds/create') return data.refundId ? refundPayload(db, shopId, data.refundId) : null;
  if (topic.startsWith('fulfillments/')) return data.fulfillmentId ? fulfillmentPayload(db, shopId, data.fulfillmentId) : null;
  return null;
}

export const topicsForVerb = (verb: string | null): string[] => (verb ? VERB_TOPICS[verb] ?? [] : []);

/**
 * Record one pending delivery per active subscription matching the event. Returns the delivery ids to dispatch.
 * Throws when a payload cannot be read yet (the originating transaction may not have committed): the job queue retries.
 */
export async function recordDeliveries(db: Executor, shopId: number, e: Pick<EventRow, 'verb' | 'subjectId' | 'data'>): Promise<number[]> {
  const ids: number[] = [];
  for (const wire of topicsForVerb(e.verb)) {
    const subs = await db.select().from(webhookSubscriptions).where(and(eq(webhookSubscriptions.shopId, shopId), eq(webhookSubscriptions.topic, topicFromWire(wire)), eq(webhookSubscriptions.active, true)));
    if (!subs.length) continue;
    const payload = await buildPayload(db, shopId, wire, e);
    if (!payload) throw new Error(`webhook payload for ${wire} not available yet`);
    const rows = await db.insert(webhookDeliveries).values(subs.map((s) => ({ shopId, subscriptionId: s.id, topic: wire, payload, nextAttemptAt: new Date() }))).returning({ id: webhookDeliveries.id });
    ids.push(...rows.map((r) => r.id));
  }
  return ids;
}

// ---- delivery ---------------------------------------------------------------------------------------------------------------

/** Delay before attempt n+1 after attempt n failed (ms). After the last entry the delivery is FAILED. */
export const RETRY_DELAYS_MS = [10_000, 60_000, 5 * 60_000, 30 * 60_000, 2 * 3600_000, 6 * 3600_000];
const LEASE_MS = 2 * 60_000;

export interface DeliveryDeps { shopDomain: string; timeoutMs?: number; now?: Date }

/** Attempt one delivery. Returns the delay until the next attempt, or null when it is finished (SUCCESS or FAILED) or not claimable. */
export async function attemptDelivery(db: Db, shop: Shop, id: number, deps: DeliveryDeps): Promise<number | null> {
  const now = deps.now ?? new Date();
  // Claim: lease the row so the periodic sweep does not pick it up while the request is in flight.
  const [d] = await db.update(webhookDeliveries).set({ nextAttemptAt: new Date(now.getTime() + LEASE_MS) })
    .where(and(eq(webhookDeliveries.id, id), eq(webhookDeliveries.shopId, shop.id), eq(webhookDeliveries.status, 'PENDING'), or(isNull(webhookDeliveries.nextAttemptAt), lte(webhookDeliveries.nextAttemptAt, now)))).returning();
  if (!d) return null;
  const [sub] = d.subscriptionId ? await db.select().from(webhookSubscriptions).where(eq(webhookSubscriptions.id, d.subscriptionId)).limit(1) : [];
  if (!sub?.active) { await db.update(webhookDeliveries).set({ status: 'FAILED', lastError: 'Subscription was removed or disabled', nextAttemptAt: null }).where(eq(webhookDeliveries.id, id)); return null; }

  const body = JSON.stringify(d.payload);
  const secret = await getWebhookSecret(db, shop);
  let code: number | null = null; let error: string | null = null;
  try {
    code = await postGuarded(new URL(sub.endpointUrl), {
      timeoutMs: deps.timeoutMs ?? 10_000, allowPrivate: webhooksAllowPrivate(), body,
      headers: {
        'content-type': 'application/json', 'user-agent': 'ShopMe-Hookshot', 'x-shopify-topic': d.topic, 'x-shopify-hmac-sha256': signBody(secret, body), 'x-shopify-shop-domain': deps.shopDomain,
        'x-shopify-webhook-id': String(d.id), 'x-shopify-api-version': sub.apiVersion, 'x-shopify-triggered-at': d.createdAt.toISOString(),
      },
    });
    if (code < 200 || code >= 300) error = `HTTP ${code}`;
  } catch (e) { error = e instanceof Error ? e.message.slice(0, 500) : 'Request failed'; }

  const attempts = d.attempts + 1;
  if (!error) { await db.update(webhookDeliveries).set({ status: 'SUCCESS', attempts, responseCode: code, lastError: null, nextAttemptAt: null }).where(eq(webhookDeliveries.id, id)); return null; }
  const delay = RETRY_DELAYS_MS[attempts - 1];
  await db.update(webhookDeliveries).set({
    attempts, responseCode: code, lastError: error, status: delay == null ? 'FAILED' : 'PENDING', nextAttemptAt: delay == null ? null : new Date(now.getTime() + delay),
  }).where(eq(webhookDeliveries.id, id));
  if (delay == null) await recordWebhookFailure(db, shop.id, { topic: d.topic, endpoint: sub.endpointUrl, error, deliveryId: id }).catch(() => undefined);
  return delay ?? null;
}

/** Pending deliveries that are due (restart safety net for the in-process retry timers). */
export async function dueDeliveries(db: Executor, now = new Date(), limit = 100): Promise<{ id: number; shopId: number }[]> {
  return db.select({ id: webhookDeliveries.id, shopId: webhookDeliveries.shopId }).from(webhookDeliveries)
    .where(and(eq(webhookDeliveries.status, 'PENDING'), lte(webhookDeliveries.nextAttemptAt, now))).orderBy(asc(webhookDeliveries.id)).limit(limit);
}

export const purgeOldDeliveries = (db: Executor, olderThanMs = 30 * 24 * 3600_000) =>
  db.delete(webhookDeliveries).where(and(sql`${webhookDeliveries.createdAt} < ${new Date(Date.now() - olderThanMs)}`, sql`${webhookDeliveries.status} <> 'PENDING'`));
