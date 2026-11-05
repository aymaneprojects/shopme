import { execute, parse, validate, type FieldNode, type GraphQLSchema } from 'graphql';
import {
  bulkCancelRequested, failStaleBulkOperations, finishBulkOperation, markBulkRunning, purgeExpiredBulkResults, randomToken, updateBulkProgress,
  type BulkFinish,
} from '@shopme/core';
import type { AppContext, AuthInfo } from '../context';
import type { GraphQLContext } from '../admin/graphql/context';
import { connSelection, analyzeBulkQuery, type ConnDef } from './query';

export interface BulkJob { opId: number; shopId: number; auth: AuthInfo }

/** The bulk mutation's staged variables file must live under this prefix of the shop (set by `stagedUploadsCreate`). */
export const stagedBulkPrefix = (shopId: number) => `tmp/${shopId}/bulk/`;

const errorCodeOf = (errors: readonly { message: string; extensions?: Record<string, unknown> }[]): BulkFinish['errorCode'] =>
  errors.some((e) => e.extensions?.code === 'ACCESS_DENIED' || /access denied/i.test(e.message)) ? 'ACCESS_DENIED' : 'INTERNAL_SERVER_ERROR';

class Stop extends Error { constructor(readonly code: BulkFinish['errorCode'], message: string) { super(message); } }
class Canceled extends Error {}

/** Buffers JSONL lines in memory; the result file is written once at the end. */
class Sink {
  lines: string[] = [];
  objects = 0;
  roots = 0;
  push(obj: unknown, root: boolean) { this.lines.push(JSON.stringify(obj)); this.objects++; if (root) this.roots++; }
  get body() { return this.lines.length ? Buffer.from(`${this.lines.join('\n')}\n`) : null; }
}

export function registerBulkJobs(ctx: AppContext, schema: GraphQLSchema): void {
  const { db, queue, storage } = ctx;

  const gqlContext = (job: BulkJob): GraphQLContext => ({ app: ctx, db, shopId: job.shopId, auth: job.auth, request: undefined as never });

  async function savePart(op: { id: number; shopId: number }, sink: Sink, kind: 'result' | 'partial') {
    const body = sink.body;
    if (!body) return { key: null, size: null };
    const key = `bulk/${op.shopId}/${op.id}-${randomToken(18)}${kind === 'partial' ? '-partial' : ''}.jsonl`;
    await storage.put(key, body);
    return { key, size: body.length };
  }

  async function runQuery(job: BulkJob, text: string, sink: Sink) {
    const a = analyzeBulkQuery(schema, text);
    if (!a.ok) throw new Stop('INTERNAL_SERVER_ERROR', a.message);
    const gctx = gqlContext(job);
    const exec = async (q: string) => {
      const r = await execute({ schema, document: parse(q), contextValue: gctx });
      if (r.errors?.length) throw new Stop(errorCodeOf(r.errors as never), r.errors[0]!.message);
      return r.data as Record<string, any>;
    };
    const checkpoint = async () => {
      await updateBulkProgress(db, job.opId, sink.objects, sink.roots);
      if (await bulkCancelRequested(db, job.opId)) throw new Canceled();
    };

    /** Write one page of nodes (and, right after each node, its children). */
    const emit = async (def: ConnDef, conn: { edges: { node: Record<string, any> }[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } }, parentId: string | null) => {
      for (const { node } of conn.edges) {
        const line: Record<string, unknown> = {};
        const needId = def.nested.length > 0 && !def.selectsId;
        if (needId) line.id = node.__bulkId;
        const nestedKeys = new Set(def.nested.map((n) => n.key));
        for (const [k, v] of Object.entries(node)) if (k !== '__bulkId' && k !== '__bulkType' && !nestedKeys.has(k)) line[k] = v;
        if (parentId) line.__parentId = parentId;
        sink.push(line, parentId === null);
        for (const child of def.nested) {
          let page = node[child.key] as typeof conn | undefined;
          while (page) {
            await emit(child, page, node.__bulkId);
            if (!page.pageInfo.hasNextPage) break;
            const data = await exec(`query { node(id: ${JSON.stringify(node.__bulkId)}) { ... on ${node.__bulkType} { ${connSelection(child, page.pageInfo.endCursor)} } } }`);
            if (!data.node) throw new Stop('INTERNAL_SERVER_ERROR', `Cannot continue paging ${child.name}: parent ${node.__bulkId} was not found.`);
            page = data.node[child.key];
          }
        }
      }
      await checkpoint();
    };

    for (const root of a.roots) {
      let after: string | null = null;
      for (;;) {
        const data = await exec(`query { ${connSelection(root, after)} }`);
        const page = data[root.key];
        await emit(root, page, null);
        if (!page.pageInfo.hasNextPage) break;
        after = page.pageInfo.endCursor;
      }
    }
  }

  async function runMutation(job: BulkJob, text: string, inputKey: string, sink: Sink) {
    const doc = parse(text);
    const gctx = gqlContext(job);
    const stream = await storage.open(inputKey);
    if (!stream) throw new Stop('INTERNAL_SERVER_ERROR', 'The staged variables file is gone.');
    const chunks: Buffer[] = [];
    for await (const c of stream) chunks.push(Buffer.from(c));
    const lines = Buffer.concat(chunks).toString('utf8').split(/\r?\n/);
    for (const [i, raw] of lines.entries()) {
      if (!raw.trim()) continue;
      let vars: Record<string, unknown>;
      try { vars = JSON.parse(raw); if (!vars || typeof vars !== 'object' || Array.isArray(vars)) throw new Error('not an object'); } catch {
        sink.push({ errors: [{ message: 'Line is not a valid JSON object of variables.' }], __lineNumber: i }, true);
        continue;
      }
      const r = await execute({ schema, document: doc, variableValues: vars, contextValue: gctx });
      sink.push({ ...(r.data ? { data: r.data } : {}), ...(r.errors?.length ? { errors: r.errors.map((e) => ({ message: e.message, ...(e.path ? { path: e.path } : {}) })) } : {}), __lineNumber: i }, true);
      if (sink.objects % 25 === 0) {
        await updateBulkProgress(db, job.opId, sink.objects, sink.roots);
        if (await bulkCancelRequested(db, job.opId)) throw new Canceled();
      }
    }
  }

  queue.register<BulkJob>('bulk.run', async (job) => {
    const op = await markBulkRunning(db, job.opId);
    if (!op) return;
    const sink = new Sink();
    let outcome: BulkFinish['status'] = 'COMPLETED';
    let errorCode: BulkFinish['errorCode'] = null;
    try {
      if (op.type === 'QUERY') await runQuery(job, op.query, sink);
      else await runMutation(job, op.query, op.inputKey ?? '', sink);
    } catch (e) {
      if (e instanceof Canceled) outcome = 'CANCELED';
      else {
        outcome = 'FAILED';
        errorCode = e instanceof Stop ? e.code : 'INTERNAL_SERVER_ERROR';
        ctx.log.warn({ err: e, opId: job.opId }, 'bulk operation failed');
      }
    }
    const saved = await savePart(op, sink, outcome === 'COMPLETED' ? 'result' : 'partial');
    await finishBulkOperation(db, job.shopId, job.opId, {
      status: outcome, errorCode, objectCount: sink.objects, rootObjectCount: sink.roots,
      ...(outcome === 'COMPLETED' ? { resultKey: saved.key, resultSize: saved.size } : { partialKey: saved.key }),
    });
    if (op.inputKey) await storage.delete(op.inputKey).catch(() => undefined);
  });

  // A restart loses in-flight runs (the queue is in-process): fail them so a new operation can start.
  void failStaleBulkOperations(db).catch(() => undefined);
  queue.every('bulk-expire', 3600_000, async () => { await purgeExpiredBulkResults(db, storage); });
}

/** Validate the mutation of `bulkOperationRunMutation`: one mutation operation with exactly one root field. Returns an error message or null. */
export function checkBulkMutation(schema: GraphQLSchema, text: string): string | null {
  let doc;
  try { doc = parse(text); } catch (e) { return `Parse error: ${(e as Error).message.replace(/^Syntax Error: /, '')}`; }
  const ops = doc.definitions.filter((d) => d.kind === 'OperationDefinition');
  if (ops.length !== 1 || ops[0]!.kind !== 'OperationDefinition' || ops[0]!.operation !== 'mutation') return 'The document must contain exactly one mutation operation.';
  const roots = ops[0]!.selectionSet.selections.filter((s): s is FieldNode => s.kind === 'Field');
  if (roots.length !== 1 || ops[0]!.selectionSet.selections.length !== 1) return 'The mutation must have exactly one top-level field.';
  if (/^bulkOperation/.test(roots[0]!.name.value)) return 'Bulk operations cannot be started from a bulk mutation.';
  const errors = validate(schema, doc);
  return errors.length ? errors[0]!.message : null;
}

