import { GraphQLError } from 'graphql';
import { getJob, getProduct, schema } from '@shopme/core';
import { parseId, toGid, type UserError } from '@shopme/shopify-compat';
import { builder } from '../builder';
import { requireScope, type GraphQLContext } from '../context';
import { UserError as UserErrorRef } from '../types/errors';
import { Node, registerNode } from '../types/node';
import { Product_ } from '../types/catalog';

/** Asynchronous product operations (`productDuplicate(synchronous: false)`): a `jobs` row with type `product.duplicate`. */

export type JobRow = typeof schema.jobs.$inferSelect;
export interface DuplicateResult { productId: number; newProductId: number | null; errors: UserError[] }
export const JOB_TYPE_DUPLICATE = 'product.duplicate';

const Status = builder.enumType('ProductOperationStatus', { values: ['CREATED', 'ACTIVE', 'COMPLETE'] as const });
const statusOf = (j: JobRow) => (j.done ? 'COMPLETE' : j.status === 'PENDING' ? 'CREATED' : 'ACTIVE') as 'COMPLETE';
const resultOf = (j: JobRow) => ((j.result as { details?: DuplicateResult } | null)?.details ?? { productId: 0, newProductId: null, errors: [] }) as DuplicateResult;

const ProductOperation = builder.interfaceRef<JobRow>('ProductOperation').implement({
  fields: (t) => ({
    status: t.field({ type: Status, resolve: statusOf }),
    product: t.field({ type: Product_, nullable: true, resolve: (j, _a, ctx) => getProduct(ctx.db, ctx.shopId, resultOf(j).productId) }),
  }),
  resolveType: () => 'ProductDuplicateOperation',
});

export const ProductDuplicateOperation = builder.objectRef<JobRow>('ProductDuplicateOperation').implement({
  interfaces: [Node, ProductOperation],
  fields: (t) => ({
    newProduct: t.field({ type: Product_, nullable: true, resolve: (j, _a, ctx) => { const id = resultOf(j).newProductId; return id ? getProduct(ctx.db, ctx.shopId, id) : null; } }),
    userErrors: t.field({ type: [UserErrorRef], resolve: (j) => resultOf(j).errors }),
  }),
});

const loadOp = async (ctx: GraphQLContext, id: number) => { const j = await getJob(ctx.db, ctx.shopId, id); return j && j.type === JOB_TYPE_DUPLICATE ? j : null; };
registerNode('ProductDuplicateOperation', loadOp);

export const ProductDuplicateJob = builder.objectRef<JobRow>('ProductDuplicateJob').implement({
  fields: (t) => ({ id: t.id({ resolve: (j) => toGid('Job', j.id) }), done: t.boolean({ resolve: (j) => j.done }) }),
});

builder.queryFields((t) => ({
  productOperation: t.field({
    type: ProductOperation, nullable: true, args: { id: t.arg.id({ required: true }) },
    resolve: async (_r, a, ctx) => { requireScope(ctx, 'read_products'); const id = parseId(String(a.id), 'ProductDuplicateOperation'); return id ? loadOp(ctx, id) : null; },
  }),
  productDuplicateJob: t.field({
    type: ProductDuplicateJob, args: { id: t.arg.id({ required: true }) },
    resolve: async (_r, a, ctx) => {
      requireScope(ctx, 'read_products');
      const id = parseId(String(a.id), 'Job') ?? parseId(String(a.id), 'ProductDuplicateOperation');
      const job = id ? await loadOp(ctx, id) : null;
      if (!job) throw new GraphQLError('Job does not exist', { extensions: { code: 'NOT_FOUND' } });
      return job;
    },
  }),
}));
