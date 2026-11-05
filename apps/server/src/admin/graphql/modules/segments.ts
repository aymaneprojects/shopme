/** ShopMe extension: customer segments, saved customer searches listed on the Segments page with a live customer count. */
import { countCustomers, createCustomerSegment, deleteCustomerSegment, getCustomerSegment, listCustomerSegments, updateCustomerSegment, type CustomerSegment as SegmentRow } from '@shopme/core';
import { parseId, toGid } from '@shopme/shopify-compat';
import { builder } from '../builder';
import { requireScope } from '../context';
import { definePayload } from '../types/errors';
import { Count } from '../types/money';

const Segment = builder.objectRef<SegmentRow>('ShopmeCustomerSegment');
Segment.implement({
  fields: (t) => ({
    id: t.id({ resolve: (s) => toGid('ShopmeCustomerSegment', s.id) }),
    name: t.exposeString('name'),
    query: t.exposeString('query', { description: 'A customer search, e.g. `accepts_marketing:true orders_count:>0`.' }),
    createdAt: t.field({ type: 'DateTime', resolve: (s) => new Date(s.createdAt) }),
    updatedAt: t.field({ type: 'DateTime', resolve: (s) => new Date(s.updatedAt) }),
    customersCount: t.field({ type: Count, resolve: (s, _a, ctx) => countCustomers(ctx.db, ctx.shopId, s.query) }),
  }),
});

const SegmentPayload = definePayload<{ segment: SegmentRow | null }>('ShopmeCustomerSegmentPayload', (t) => ({ segment: t.field({ type: Segment, nullable: true, resolve: (p) => p.segment }) }));
const SegmentDeletePayload = definePayload<{ deletedSegmentId: string | null }>('ShopmeCustomerSegmentDeletePayload', (t) => ({ deletedSegmentId: t.id({ nullable: true, resolve: (p) => p.deletedSegmentId }) }));
const gidId = (raw: string) => parseId(String(raw), 'ShopmeCustomerSegment');
const missing = [{ field: ['id'], message: 'Segment does not exist', code: 'DOES_NOT_EXIST' }];

builder.queryFields((t) => ({
  shopmeCustomerSegments: t.field({
    type: [Segment], resolve: (_r, _a, ctx) => { requireScope(ctx, 'read_customers'); return listCustomerSegments(ctx.db, ctx.shopId); },
  }),
  shopmeCustomerSegment: t.field({
    type: Segment, nullable: true, args: { id: t.arg.id({ required: true }) },
    resolve: (_r, a, ctx) => { requireScope(ctx, 'read_customers'); const id = gidId(a.id); return id ? getCustomerSegment(ctx.db, ctx.shopId, id) : null; },
  }),
}));

builder.mutationFields((t) => ({
  shopmeCustomerSegmentCreate: t.field({
    type: SegmentPayload, args: { name: t.arg.string({ required: true }), query: t.arg.string({ required: true }) },
    resolve: async (_r, a, ctx) => {
      requireScope(ctx, 'write_customers');
      const r = await createCustomerSegment(ctx.db, ctx.shopId, { name: a.name, query: a.query });
      return r.ok ? { segment: r.value, userErrors: [] } : { segment: null, userErrors: r.errors };
    },
  }),
  shopmeCustomerSegmentUpdate: t.field({
    type: SegmentPayload, args: { id: t.arg.id({ required: true }), name: t.arg.string(), query: t.arg.string() },
    resolve: async (_r, a, ctx) => {
      requireScope(ctx, 'write_customers');
      const id = gidId(a.id);
      if (!id) return { segment: null, userErrors: missing };
      const r = await updateCustomerSegment(ctx.db, ctx.shopId, id, { name: a.name, query: a.query });
      return r.ok ? { segment: r.value, userErrors: [] } : { segment: null, userErrors: r.errors };
    },
  }),
  shopmeCustomerSegmentDelete: t.field({
    type: SegmentDeletePayload, args: { id: t.arg.id({ required: true }) },
    resolve: async (_r, a, ctx) => {
      requireScope(ctx, 'write_customers');
      const id = gidId(a.id);
      if (!id) return { deletedSegmentId: null, userErrors: missing };
      const r = await deleteCustomerSegment(ctx.db, ctx.shopId, id);
      return r.ok ? { deletedSegmentId: toGid('ShopmeCustomerSegment', id), userErrors: [] } : { deletedSegmentId: null, userErrors: r.errors };
    },
  }),
}));
