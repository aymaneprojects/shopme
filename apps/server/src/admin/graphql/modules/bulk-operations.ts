import {
  cancelBulkOperation, createBulkOperation, currentBulkOperation, effectiveBulkStatus, getBulkOperation, listBulkOperations, type BulkOperation as Row,
} from '@shopme/core';
import { parseId, type UserError } from '@shopme/shopify-compat';
import { builder } from '../builder';
import type { GraphQLContext } from '../context';
import { ConnectionArgs, defineConnection, paginate } from '../types/connection';
import { DisplayableError, definePayload } from '../types/errors';
import { Node, registerNode } from '../types/node';
import { analyzeBulkQuery } from '../../../bulk/query';
import { checkBulkMutation, stagedBulkPrefix } from '../../../bulk/runner';

/** Bulk operations: asynchronous queries over connections and mutations over staged JSONL variables. See docs/spec/admin-api-mvp.md (bulk operations). */

const Status = builder.enumType('BulkOperationStatus', { values: ['CANCELED', 'CANCELING', 'COMPLETED', 'CREATED', 'EXPIRED', 'FAILED', 'RUNNING'] as const });
const Type = builder.enumType('BulkOperationType', { values: ['QUERY', 'MUTATION'] as const });
const ErrorCode = builder.enumType('BulkOperationErrorCode', { values: ['ACCESS_DENIED', 'INTERNAL_SERVER_ERROR', 'TIMEOUT'] as const });
const SortKeys = builder.enumType('BulkOperationsSortKeys', { values: ['COMPLETED_AT', 'CREATED_AT'] as const });
const QueryErrorCode = builder.enumType('BulkOperationUserErrorCode', { values: ['OPERATION_IN_PROGRESS', 'INVALID', 'LIMIT_REACHED'] as const });
const MutationErrorCode = builder.enumType('BulkMutationErrorCode', {
  values: ['OPERATION_IN_PROGRESS', 'INVALID_MUTATION', 'INVALID_STAGED_UPLOAD_FILE', 'NO_SUCH_FILE', 'INTERNAL_FILE_SERVER_ERROR', 'LIMIT_REACHED'] as const,
});

const fileUrl = (ctx: GraphQLContext, key: string | null) => (key ? `${ctx.app.config.appUrl}${ctx.app.storage.url(key)}` : null);

export const BulkOperation = builder.objectRef<Row>('BulkOperation');
BulkOperation.implement({
  interfaces: [Node],
  fields: (t) => ({
    status: t.field({ type: Status, resolve: (o) => effectiveBulkStatus(o) }),
    type: t.field({ type: Type, resolve: (o) => o.type as 'QUERY' }),
    query: t.exposeString('query'),
    errorCode: t.field({ type: ErrorCode, nullable: true, resolve: (o) => o.errorCode as 'TIMEOUT' | null }),
    createdAt: t.field({ type: 'DateTime', resolve: (o) => o.createdAt }),
    completedAt: t.field({ type: 'DateTime', nullable: true, resolve: (o) => o.completedAt }),
    objectCount: t.field({ type: 'UnsignedInt64', resolve: (o) => String(o.objectCount) }),
    rootObjectCount: t.field({ type: 'UnsignedInt64', resolve: (o) => String(o.rootObjectCount) }),
    fileSize: t.field({ type: 'UnsignedInt64', nullable: true, resolve: (o) => (o.resultSize != null && effectiveBulkStatus(o) === 'COMPLETED' ? String(o.resultSize) : null) }),
    url: t.field({ type: 'URL', nullable: true, resolve: (o, _a, ctx) => (effectiveBulkStatus(o) === 'COMPLETED' ? fileUrl(ctx, o.resultKey) : null) }),
    partialDataUrl: t.field({ type: 'URL', nullable: true, resolve: (o, _a, ctx) => fileUrl(ctx, o.partialKey) }),
  }),
});
registerNode('BulkOperation', (ctx, id) => getBulkOperation(ctx.db, ctx.shopId, id));
const Connection = defineConnection('BulkOperation', BulkOperation);

type CodedError = UserError & { code?: string };
const QueryUserError = builder.objectRef<CodedError>('BulkOperationUserError').implement({
  interfaces: [DisplayableError],
  fields: (t) => ({ code: t.field({ type: QueryErrorCode, nullable: true, resolve: (e) => (e.code as 'INVALID' | undefined) ?? null }) }),
});
const MutationUserError = builder.objectRef<CodedError>('BulkMutationUserError').implement({
  interfaces: [DisplayableError],
  fields: (t) => ({ code: t.field({ type: MutationErrorCode, nullable: true, resolve: (e) => (e.code as 'INVALID_MUTATION' | undefined) ?? null }) }),
});

const RunQueryPayload = builder.objectRef<{ bulkOperation: Row | null; userErrors: CodedError[] }>('BulkOperationRunQueryPayload').implement({
  fields: (t) => ({ bulkOperation: t.field({ type: BulkOperation, nullable: true, resolve: (p) => p.bulkOperation }), userErrors: t.field({ type: [QueryUserError], resolve: (p) => p.userErrors }) }),
});
const RunMutationPayload = builder.objectRef<{ bulkOperation: Row | null; userErrors: CodedError[] }>('BulkOperationRunMutationPayload').implement({
  fields: (t) => ({ bulkOperation: t.field({ type: BulkOperation, nullable: true, resolve: (p) => p.bulkOperation }), userErrors: t.field({ type: [MutationUserError], resolve: (p) => p.userErrors }) }),
});
const CancelPayload = definePayload<{ bulkOperation: Row | null }>('BulkOperationCancelPayload', (t) => ({ bulkOperation: t.field({ type: BulkOperation, nullable: true, resolve: (p) => p.bulkOperation }) }));

const opId = (raw: string | number) => parseId(String(raw), 'BulkOperation');

builder.queryFields((t) => ({
  bulkOperation: t.field({
    type: BulkOperation, nullable: true, args: { id: t.arg.id({ required: true }) },
    resolve: async (_r, a, ctx) => { const id = opId(a.id); return id ? getBulkOperation(ctx.db, ctx.shopId, id) : null; },
  }),
  bulkOperations: t.field({
    type: Connection, args: { ...ConnectionArgs, sortKey: t.arg({ type: SortKeys, defaultValue: 'CREATED_AT' }), query: t.arg.string() },
    resolve: (_r, a, ctx) => paginate(a, {
      fetch: ({ offset, limit }) => listBulkOperations(ctx.db, ctx.shopId, { query: a.query, sortKey: a.sortKey ?? 'CREATED_AT', reverse: !!a.reverse, offset, limit }),
      total: async () => (await listBulkOperations(ctx.db, ctx.shopId, { query: a.query, offset: 0, limit: 100000 })).length,
    }),
  }),
  currentBulkOperation: t.field({
    type: BulkOperation, nullable: true, deprecationReason: 'Use `bulkOperations` with status filter instead.', args: { type: t.arg({ type: Type, defaultValue: 'QUERY' }) },
    resolve: (_r, a, ctx) => currentBulkOperation(ctx.db, ctx.shopId, a.type ?? 'QUERY'),
  }),
}));

/** Parse the `stagedUploadPath` argument: the `key` parameter of the staged target, or the target's resource URL. */
function stagedKey(raw: string, shopId: number): string | null {
  let p = raw.trim();
  try { if (/^https?:\/\//i.test(p)) p = decodeURIComponent(new URL(p).pathname); } catch { return null; }
  p = p.replace(/^\/+/, '').replace(/^files\//, '');
  return p.startsWith(stagedBulkPrefix(shopId)) && !p.includes('..') ? p : null;
}

const MAX_VARIABLES_BYTES = 100 * 1024 * 1024;

builder.mutationFields((t) => ({
  bulkOperationRunQuery: t.field({
    type: RunQueryPayload, args: { query: t.arg.string({ required: true }), groupObjects: t.arg.boolean({ required: true, defaultValue: false }) },
    resolve: async (_r, a, ctx, info) => {
      const analysis = analyzeBulkQuery(info.schema, a.query);
      if (!analysis.ok) return { bulkOperation: null, userErrors: [{ field: ['query'], message: analysis.message, code: 'INVALID' }] };
      const r = await createBulkOperation(ctx.db, ctx.shopId, { type: 'QUERY', query: a.query, groupObjects: a.groupObjects });
      if (!r.ok) return { bulkOperation: null, userErrors: r.errors as CodedError[] };
      ctx.app.queue.enqueue('bulk.run', { opId: r.value.id, shopId: ctx.shopId, auth: ctx.auth }, { maxAttempts: 1 });
      return { bulkOperation: r.value, userErrors: [] };
    },
  }),
  bulkOperationRunMutation: t.field({
    type: RunMutationPayload,
    args: {
      mutation: t.arg.string({ required: true }), stagedUploadPath: t.arg.string({ required: true }),
      groupObjects: t.arg.boolean({ defaultValue: true, deprecationReason: 'This argument has no effect on output order.' }), clientIdentifier: t.arg.string(),
    },
    resolve: async (_r, a, ctx, info) => {
      const bad = (field: string[] | null, message: string, code: string) => ({ bulkOperation: null, userErrors: [{ field, message, code }] });
      const problem = checkBulkMutation(info.schema, a.mutation);
      if (problem) return bad(['mutation'], problem, 'INVALID_MUTATION');
      const key = stagedKey(a.stagedUploadPath, ctx.shopId);
      const stream = key ? await ctx.app.storage.open(key) : null;
      if (!key || !stream) return bad(['stagedUploadPath'], 'The file could not be found at the staged upload path. Upload the variables with stagedUploadsCreate (resource BULK_MUTATION_VARIABLES) first.', 'NO_SUCH_FILE');
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const c of stream) { const b = Buffer.from(c); size += b.length; if (size > MAX_VARIABLES_BYTES) { stream.destroy(); break; } chunks.push(b); }
      const first = Buffer.concat(chunks).toString('utf8').split(/\r?\n/).find((l) => l.trim());
      let ok = false;
      try { const v = first ? JSON.parse(first) : null; ok = !!v && typeof v === 'object' && !Array.isArray(v); } catch { /* invalid */ }
      if (size > MAX_VARIABLES_BYTES || !ok) return bad(['stagedUploadPath'], 'The staged file must be JSONL: one JSON object of mutation variables per line.', 'INVALID_STAGED_UPLOAD_FILE');
      const r = await createBulkOperation(ctx.db, ctx.shopId, { type: 'MUTATION', query: a.mutation, inputKey: key, clientIdentifier: a.clientIdentifier });
      if (!r.ok) return { bulkOperation: null, userErrors: r.errors as CodedError[] };
      ctx.app.queue.enqueue('bulk.run', { opId: r.value.id, shopId: ctx.shopId, auth: ctx.auth }, { maxAttempts: 1 });
      return { bulkOperation: r.value, userErrors: [] };
    },
  }),
  bulkOperationCancel: t.field({
    type: CancelPayload, args: { id: t.arg.id({ required: true }) },
    resolve: async (_r, a, ctx) => {
      const id = opId(a.id);
      if (!id) return { bulkOperation: null, userErrors: [{ field: ['id'], message: 'Bulk operation does not exist' }] };
      const r = await cancelBulkOperation(ctx.db, ctx.shopId, id);
      return r.ok ? { bulkOperation: r.value, userErrors: [] } : { bulkOperation: await getBulkOperation(ctx.db, ctx.shopId, id), userErrors: r.errors };
    },
  }),
}));
