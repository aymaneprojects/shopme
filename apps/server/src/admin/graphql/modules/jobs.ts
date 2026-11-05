import { createJob, getJob, JobReporter } from '@shopme/core';
import { parseId, toGid } from '@shopme/shopify-compat';
import { builder } from '../builder';
import type { GraphQLContext } from '../context';
import { Job } from '../types/catalog';

/**
 * `Job` records for work that finishes inside the request (bulk discount edits and the like): the row exists, so `job(id)` can be
 * polled like any Shopify job, and it is already `done`.
 */
export async function completedJob(ctx: GraphQLContext, type: string): Promise<{ id: string; done: boolean }> {
  const id = await createJob(ctx.db, ctx.shopId, type);
  await new JobReporter(ctx.db, id).finish();
  return { id: toGid('Job', id), done: true };
}

builder.queryFields((t) => ({
  job: t.field({
    type: Job, nullable: true, args: { id: t.arg.id({ required: true }) },
    resolve: async (_r, a, ctx) => {
      const id = parseId(String(a.id), 'Job');
      const row = id ? await getJob(ctx.db, ctx.shopId, id) : null;
      return row ? { id: toGid('Job', row.id), done: row.done } : null;
    },
  }),
}));
