import { and, desc, eq } from 'drizzle-orm';
import { events } from '../db/schema';
import type { Executor } from '../db/client';

export interface NewEvent {
  subjectType: string;
  subjectId?: number | null;
  kind?: 'comment' | 'system';
  verb?: string;
  message?: string;
  authorStaffUserId?: number | null;
  data?: Record<string, unknown>;
}

export type EventRow = typeof events.$inferSelect;
type Listener = (shopId: number, event: EventRow) => void;
const listeners = new Set<Listener>();

/**
 * Subscribe to every event written through `addEvent` (webhooks and notification hooks hang off this). Called right after the
 * insert, which may still be inside an open transaction: listeners must defer any read of the resource. Returns an unsubscribe.
 */
export function onEvent(fn: Listener): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/** Append to the timeline/audit log (order, customer, product timelines; staff comments). */
export async function addEvent(db: Executor, shopId: number, e: NewEvent) {
  const [row] = await db.insert(events).values({ shopId, kind: 'system', ...e }).returning();
  for (const l of listeners) { try { l(shopId, row!); } catch { /* a listener must never break the write */ } }
  return row!;
}

export function listEvents(db: Executor, shopId: number, subjectType: string, subjectId: number, limit = 100) {
  return db
    .select()
    .from(events)
    .where(and(eq(events.shopId, shopId), eq(events.subjectType, subjectType), eq(events.subjectId, subjectId)))
    .orderBy(desc(events.createdAt), desc(events.id))
    .limit(limit);
}
