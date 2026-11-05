import { and, desc, eq } from 'drizzle-orm';
import { events } from '../db/schema';
import type { Executor } from '../db/client';
import { errR, okR, type Result } from './catalog/common';

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

export async function getEvent(db: Executor, shopId: number, id: number): Promise<EventRow | null> {
  const [row] = await db.select().from(events).where(and(eq(events.shopId, shopId), eq(events.id, id))).limit(1);
  return row ?? null;
}

/** Staff comments on a resource timeline (order, customer): plain text, one author each. */
export async function addComment(db: Executor, shopId: number, subjectType: 'order' | 'customer', subjectId: number, message: string, staffId: number | null, attachments: string[] = []) {
  const text = message.trim();
  const files = attachments.filter((u) => /^(https?:\/\/|\/)/i.test(u)).slice(0, 10);
  if (!text && !files.length) return errR(['message'], "Message can't be blank");
  if (text.length > 5000) return errR(['message'], 'Message is too long (maximum is 5000 characters)');
  return okR(await addEvent(db, shopId, { subjectType, subjectId, kind: 'comment', verb: `${subjectType}.comment`, message: text, authorStaffUserId: staffId, ...(files.length && { data: { attachments: files } }) }));
}

/** A comment can only be deleted by its author. System events are part of the audit trail and never deletable. */
export async function deleteComment(db: Executor, shopId: number, id: number, staffId: number | null): Promise<Result<{ id: number; subjectType: string; subjectId: number | null }>> {
  const ev = await getEvent(db, shopId, id);
  if (!ev || ev.kind !== 'comment') return errR(['id'], 'Comment does not exist', 'NOT_FOUND');
  if (staffId == null || ev.authorStaffUserId !== staffId) return errR(['id'], 'Only the author can delete a comment', 'INVALID');
  await db.delete(events).where(eq(events.id, id));
  return okR({ id, subjectType: ev.subjectType, subjectId: ev.subjectId });
}

/** Timeline entry for a transactional email sent to the customer (best effort, never throws). */
export async function recordOrderEmail(db: Executor, shopId: number, orderId: number, template: string, to: string): Promise<void> {
  try { await addEvent(db, shopId, { subjectType: 'order', subjectId: orderId, verb: 'order.email_sent', message: `Email "${template.replace(/_/g, ' ')}" sent to ${to}`, data: { template, to } }); } catch { /* timeline only */ }
}

export function listEvents(db: Executor, shopId: number, subjectType: string, subjectId: number, limit = 100) {
  return db
    .select()
    .from(events)
    .where(and(eq(events.shopId, shopId), eq(events.subjectType, subjectType), eq(events.subjectId, subjectId)))
    .orderBy(desc(events.createdAt), desc(events.id))
    .limit(limit);
}
