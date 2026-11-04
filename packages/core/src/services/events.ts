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

/** Append to the timeline/audit log (order, customer, product timelines; staff comments). */
export async function addEvent(db: Executor, shopId: number, e: NewEvent) {
  const [row] = await db.insert(events).values({ shopId, kind: 'system', ...e }).returning();
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
