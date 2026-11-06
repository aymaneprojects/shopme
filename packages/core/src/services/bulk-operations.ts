import { and, asc, desc, eq, inArray, lt, sql } from 'drizzle-orm';
import { bulkOperations } from '../db/schema';
import type { Db, Executor } from '../db/client';
import { buildSearch, dateCompare, idTerm } from './catalog/search';
import { errR, okR, type Result } from './catalog/common';
import { addEvent } from './events';
import type { Storage } from './storage';

export type BulkOperation = typeof bulkOperations.$inferSelect;
export type BulkOperationType = 'QUERY' | 'MUTATION';
export type BulkOperationStatus = 'CREATED' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELING' | 'CANCELED' | 'EXPIRED';

/** Result files stay available for a week, then the operation reads EXPIRED. */
export const BULK_RESULT_TTL_MS = 7 * 24 * 3600_000;
const ACTIVE: BulkOperationStatus[] = ['CREATED', 'RUNNING', 'CANCELING'];

/** Status as the API shows it: a completed run whose result file aged out reads EXPIRED. */
export function effectiveBulkStatus(op: Pick<BulkOperation, 'status' | 'completedAt'>, now = new Date()): BulkOperationStatus {
  if (op.status === 'COMPLETED' && op.completedAt && now.getTime() - op.completedAt.getTime() > BULK_RESULT_TTL_MS) return 'EXPIRED';
  return op.status as BulkOperationStatus;
}

export async function getBulkOperation(db: Executor, shopId: number, id: number): Promise<BulkOperation | null> {
  const [r] = await db.select().from(bulkOperations).where(and(eq(bulkOperations.shopId, shopId), eq(bulkOperations.id, id))).limit(1);
  return r ?? null;
}

const search = (q: string | null | undefined) => buildSearch(q, {
  fields: {
    id: (_o, v) => idTerm(bulkOperations.id, v),
    status: (_o, v) => {
      const s = v.toUpperCase();
      const lim = new Date(Date.now() - BULK_RESULT_TTL_MS).toISOString();
      if (s === 'EXPIRED') return sql`(${bulkOperations.status} = 'EXPIRED' or (${bulkOperations.status} = 'COMPLETED' and ${bulkOperations.completedAt} < ${lim}::timestamptz))`;
      if (s === 'COMPLETED') return sql`(${bulkOperations.status} = 'COMPLETED' and ${bulkOperations.completedAt} >= ${lim}::timestamptz)`;
      return sql`${bulkOperations.status} = ${s}`;
    },
    operation_type: (_o, v) => sql`${bulkOperations.type} = ${v.toUpperCase()}`,
    type: (_o, v) => sql`${bulkOperations.type} = ${v.toUpperCase()}`,
    created_at: (op, v) => dateCompare(bulkOperations.createdAt, op, v),
    completed_at: (op, v) => dateCompare(bulkOperations.completedAt, op, v),
  },
  text: () => sql`true`,
});

/** Newest first by default (`reverse` flips it). */
export async function listBulkOperations(db: Executor, shopId: number, o: { query?: string | null; sortKey?: 'CREATED_AT' | 'COMPLETED_AT'; reverse?: boolean; offset: number; limit: number }): Promise<BulkOperation[]> {
  const col = o.sortKey === 'COMPLETED_AT' ? bulkOperations.completedAt : bulkOperations.createdAt;
  const dir = o.reverse ? asc : desc;
  return db.select().from(bulkOperations).where(and(eq(bulkOperations.shopId, shopId), search(o.query))).orderBy(dir(col), dir(bulkOperations.id)).limit(o.limit).offset(o.offset);
}

/** The most recent operation of a type (any status). */
export async function currentBulkOperation(db: Executor, shopId: number, type: BulkOperationType): Promise<BulkOperation | null> {
  const [r] = await db.select().from(bulkOperations).where(and(eq(bulkOperations.shopId, shopId), eq(bulkOperations.type, type))).orderBy(desc(bulkOperations.id)).limit(1);
  return r ?? null;
}

/** Start a record. One operation of each type may be active per shop (`OPERATION_IN_PROGRESS` otherwise). */
export async function createBulkOperation(db: Db, shopId: number, i: { type: BulkOperationType; query: string; inputKey?: string | null; groupObjects?: boolean; clientIdentifier?: string | null }): Promise<Result<BulkOperation>> {
  const [busy] = await db.select({ id: bulkOperations.id }).from(bulkOperations)
    .where(and(eq(bulkOperations.shopId, shopId), eq(bulkOperations.type, i.type), inArray(bulkOperations.status, ACTIVE))).limit(1);
  if (busy) return errR(null, `A bulk ${i.type.toLowerCase()} operation for this app and shop is already in progress: gid://shopify/BulkOperation/${busy.id}.`, 'OPERATION_IN_PROGRESS');
  const [row] = await db.insert(bulkOperations).values({ shopId, type: i.type, query: i.query, inputKey: i.inputKey ?? null, groupObjects: !!i.groupObjects, clientIdentifier: i.clientIdentifier ?? null }).returning();
  return okR(row!);
}

export async function markBulkRunning(db: Executor, id: number): Promise<BulkOperation | null> {
  const [r] = await db.update(bulkOperations).set({ status: 'RUNNING' }).where(and(eq(bulkOperations.id, id), eq(bulkOperations.status, 'CREATED'))).returning();
  return r ?? null;
}

export const updateBulkProgress = (db: Executor, id: number, objectCount: number, rootObjectCount: number) =>
  db.update(bulkOperations).set({ objectCount, rootObjectCount }).where(eq(bulkOperations.id, id));

/** True once a cancel was requested (the runner polls this between pages). */
export async function bulkCancelRequested(db: Executor, id: number): Promise<boolean> {
  const [r] = await db.select({ s: bulkOperations.status }).from(bulkOperations).where(eq(bulkOperations.id, id)).limit(1);
  return !r || r.s === 'CANCELING' || r.s === 'CANCELED';
}

export interface BulkFinish { status: 'COMPLETED' | 'FAILED' | 'CANCELED'; errorCode?: 'ACCESS_DENIED' | 'INTERNAL_SERVER_ERROR' | 'TIMEOUT' | null; resultKey?: string | null; resultSize?: number | null; partialKey?: string | null; objectCount: number; rootObjectCount: number }

/** Record the outcome and raise `bulk_operations/finish` (webhook topic). */
export async function finishBulkOperation(db: Db, shopId: number, id: number, f: BulkFinish): Promise<BulkOperation | null> {
  const [row] = await db.update(bulkOperations).set({
    status: f.status, errorCode: f.errorCode ?? null, resultKey: f.resultKey ?? null, resultSize: f.resultSize ?? null, partialKey: f.partialKey ?? null,
    objectCount: f.objectCount, rootObjectCount: f.rootObjectCount, completedAt: new Date(),
  }).where(and(eq(bulkOperations.id, id), eq(bulkOperations.shopId, shopId))).returning();
  if (row) await addEvent(db, shopId, { subjectType: 'bulk_operation', subjectId: id, verb: 'bulk_operations/finish', message: `Bulk operation ${f.status.toLowerCase()}` });
  return row ?? null;
}

/** `bulkOperationCancel`: a running operation moves to CANCELING; the runner then stops and keeps its partial data. */
export async function cancelBulkOperation(db: Db, shopId: number, id: number): Promise<Result<BulkOperation>> {
  const cur = await getBulkOperation(db, shopId, id);
  if (!cur) return errR(['id'], 'Bulk operation does not exist');
  if (cur.status === 'CANCELING' || cur.status === 'CANCELED') return okR(cur);
  if (!ACTIVE.includes(cur.status as BulkOperationStatus)) return errR(['id'], `A bulk operation cannot be canceled when it is ${effectiveBulkStatus(cur).toLowerCase()}.`);
  const [row] = await db.update(bulkOperations).set({ status: 'CANCELING' }).where(and(eq(bulkOperations.id, id), inArray(bulkOperations.status, ACTIVE))).returning();
  return okR(row ?? (await getBulkOperation(db, shopId, id))!);
}

/** Runs left RUNNING by a restart cannot continue: fail them so a new operation can start. */
export async function failStaleBulkOperations(db: Executor): Promise<void> {
  await db.update(bulkOperations).set({ status: 'FAILED', errorCode: 'INTERNAL_SERVER_ERROR', completedAt: new Date() }).where(inArray(bulkOperations.status, ['CREATED', 'RUNNING']));
  await db.update(bulkOperations).set({ status: 'CANCELED', completedAt: new Date() }).where(eq(bulkOperations.status, 'CANCELING'));
}

/** Mark old results EXPIRED and delete their files. */
/** `storage`: one storage, or the storage of each shop (multi-store layout). */
export async function purgeExpiredBulkResults(db: Executor, storage: Storage | ((shopId: number) => Storage), now = new Date()): Promise<number> {
  const old = await db.select().from(bulkOperations).where(and(inArray(bulkOperations.status, ['COMPLETED', 'FAILED', 'CANCELED']), lt(bulkOperations.completedAt, new Date(now.getTime() - BULK_RESULT_TTL_MS))));
  for (const o of old) {
    const st = typeof storage === 'function' ? storage(o.shopId) : storage;
    for (const k of [o.resultKey, o.partialKey, o.inputKey]) if (k) await st.delete(k).catch(() => undefined);
    await db.update(bulkOperations).set({ status: o.status === 'COMPLETED' ? 'EXPIRED' : o.status, resultKey: null, partialKey: null, inputKey: null }).where(eq(bulkOperations.id, o.id));
  }
  return old.length;
}

/** Payload of the `bulk_operations/finish` webhook. */
export async function bulkFinishPayload(db: Executor, shopId: number, id: number): Promise<Record<string, unknown> | null> {
  const o = await getBulkOperation(db, shopId, id);
  if (!o) return null;
  return {
    admin_graphql_api_id: `gid://shopify/BulkOperation/${o.id}`, completed_at: o.completedAt?.toISOString() ?? null, created_at: o.createdAt.toISOString(),
    error_code: o.errorCode?.toLowerCase() ?? null, status: o.status.toLowerCase(), type: o.type.toLowerCase(),
  };
}
