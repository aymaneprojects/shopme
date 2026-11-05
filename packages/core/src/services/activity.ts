import { and, desc, eq, gt, inArray, sql } from 'drizzle-orm';
import { events, inventoryItems, inventoryLevels, orderLines, orders, productVariants, products, staffUsers } from '../db/schema';
import type { Executor } from '../db/client';
import { addEvent } from './events';

/**
 * In-app activity feed (the bell in the admin header): new orders, low stock, failed webhook deliveries and backup results.
 * Entries are rows of the `events` table (new orders reuse `order.created`); each staff member keeps their own "read up to" mark.
 */
export const ACTIVITY_VERBS = ['order.created', 'activity.low_stock', 'activity.webhook_failed', 'activity.backup'] as const;
export type ActivityKind = 'order' | 'low_stock' | 'webhook_failed' | 'backup';
export const LOW_STOCK_THRESHOLD = 5;
/** Entries older than this are not listed (and never counted as unread). */
const FEED_DAYS = 30;

export interface ActivityEntry { id: number; kind: ActivityKind; title: string; body: string; link: string | null; createdAt: Date; read: boolean; ok: boolean }

const KIND: Record<string, ActivityKind> = { 'order.created': 'order', 'activity.low_stock': 'low_stock', 'activity.webhook_failed': 'webhook_failed', 'activity.backup': 'backup' };

const since = () => new Date(Date.now() - FEED_DAYS * 86_400_000);

export async function readMarkOf(db: Executor, shopId: number, staffId: number | null): Promise<Date | null> {
  if (!staffId) return null;
  const [r] = await db.select({ at: staffUsers.activityReadAt }).from(staffUsers).where(and(eq(staffUsers.shopId, shopId), eq(staffUsers.id, staffId)));
  return r?.at ?? null;
}

export async function listActivity(db: Executor, shopId: number, staffId: number | null, limit = 30): Promise<{ items: ActivityEntry[]; unreadCount: number }> {
  const mark = await readMarkOf(db, shopId, staffId);
  const rows = await db.select({ e: events, orderName: orders.name, orderTotal: orders.total, currency: orders.currency }).from(events)
    .leftJoin(orders, and(eq(events.verb, 'order.created'), eq(orders.id, events.subjectId)))
    .where(and(eq(events.shopId, shopId), inArray(events.verb, [...ACTIVITY_VERBS]), gt(events.createdAt, since()))).orderBy(desc(events.createdAt), desc(events.id)).limit(Math.min(limit, 100));
  const items: ActivityEntry[] = rows.map(({ e, orderName }) => {
    const d = (e.data ?? {}) as Record<string, unknown>;
    const kind = KIND[e.verb!]!;
    const read = !staffId || (!!mark && e.createdAt <= mark);
    switch (kind) {
      case 'order': return { id: e.id, kind, title: orderName ?? 'Order', body: e.message ?? '', link: e.subjectId ? `/orders/${e.subjectId}` : null, createdAt: e.createdAt, read, ok: true };
      case 'low_stock': return { id: e.id, kind, title: String(d.title ?? 'Low stock'), body: `${Number(d.available ?? 0)}`, link: d.productId ? `/products/${d.productId}` : null, createdAt: e.createdAt, read, ok: true };
      case 'webhook_failed': return { id: e.id, kind, title: String(d.topic ?? ''), body: String(d.error ?? ''), link: '/settings/webhooks', createdAt: e.createdAt, read, ok: false };
      default: return { id: e.id, kind, title: String(d.name ?? ''), body: String(d.error ?? ''), link: '/settings/backup', createdAt: e.createdAt, read, ok: d.ok !== false };
    }
  });
  const [c] = await db.select({ n: sql<number>`count(*)::int` }).from(events)
    .where(and(eq(events.shopId, shopId), inArray(events.verb, [...ACTIVITY_VERBS]), gt(events.createdAt, since()), mark ? gt(events.createdAt, mark) : undefined));
  return { items, unreadCount: staffId ? (c?.n ?? 0) : 0 };
}

export async function markActivityRead(db: Executor, shopId: number, staffId: number | null): Promise<void> {
  if (!staffId) return;
  await db.update(staffUsers).set({ activityReadAt: new Date() }).where(and(eq(staffUsers.shopId, shopId), eq(staffUsers.id, staffId)));
}

/** A variant dropped to the low stock threshold or below: one entry per variant per day. */
export async function recordLowStockForOrder(db: Executor, shopId: number, orderId: number, threshold = LOW_STOCK_THRESHOLD): Promise<number> {
  const lines = await db.select({ variantId: orderLines.variantId }).from(orderLines).where(and(eq(orderLines.shopId, shopId), eq(orderLines.orderId, orderId)));
  const variantIds = [...new Set(lines.flatMap((l) => (l.variantId ? [l.variantId] : [])))];
  if (!variantIds.length) return 0;
  const rows = await db.select({ variantId: productVariants.id, productId: productVariants.productId, productTitle: products.title, variantTitle: productVariants.title, available: sql<number>`coalesce(sum(${inventoryLevels.available}), 0)::int` })
    .from(productVariants).innerJoin(products, eq(products.id, productVariants.productId)).innerJoin(inventoryItems, and(eq(inventoryItems.variantId, productVariants.id), eq(inventoryItems.tracked, true)))
    .innerJoin(inventoryLevels, and(eq(inventoryLevels.inventoryItemId, inventoryItems.id), eq(inventoryLevels.isActive, true)))
    .where(and(eq(productVariants.shopId, shopId), inArray(productVariants.id, variantIds))).groupBy(productVariants.id, products.title);
  let n = 0;
  for (const r of rows) {
    if (r.available > threshold) continue;
    const [recent] = await db.select({ id: events.id }).from(events).where(and(eq(events.shopId, shopId), eq(events.verb, 'activity.low_stock'), eq(events.subjectId, r.variantId), gt(events.createdAt, new Date(Date.now() - 86_400_000)))).limit(1);
    if (recent) continue;
    await addEvent(db, shopId, { subjectType: 'variant', subjectId: r.variantId, verb: 'activity.low_stock', message: 'Low stock', data: { title: [r.productTitle, r.variantTitle === 'Default Title' ? '' : r.variantTitle].filter(Boolean).join(' - '), available: r.available, productId: r.productId } });
    n++;
  }
  return n;
}

export const recordWebhookFailure = (db: Executor, shopId: number, d: { topic: string; endpoint: string; error: string; deliveryId: number }) =>
  addEvent(db, shopId, { subjectType: 'webhook', subjectId: d.deliveryId, verb: 'activity.webhook_failed', message: 'Webhook delivery failed', data: { topic: d.topic, endpoint: d.endpoint, error: d.error } });

export const recordBackupResult = (db: Executor, shopId: number, d: { ok: boolean; name?: string; error?: string }) =>
  addEvent(db, shopId, { subjectType: 'shop', subjectId: shopId, verb: 'activity.backup', message: d.ok ? 'Backup completed' : 'Backup failed', data: { ok: d.ok, name: d.name ?? '', error: d.error ?? '' } });
