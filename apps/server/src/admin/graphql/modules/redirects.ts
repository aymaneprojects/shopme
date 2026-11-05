import { countUrlRedirects, createUrlRedirect, deleteUrlRedirect, getUrlRedirect, listUrlRedirects, updateUrlRedirect, type UrlRedirect as UrlRedirectRow } from '@shopme/core';
import { parseId, toGid, type UserError } from '@shopme/shopify-compat';
import { builder } from '../builder';
import { requireScope } from '../context';
import { ConnectionArgs, defineConnection, paginate } from '../types/connection';
import { Count } from '../types/money';
import { Node, registerNode } from '../types/node';
import { payloadWith, typedUserError } from '../types/sales';

/** Merchant URL redirects (`/old` to `/new`), served as 301s by the storefront before it answers 404. */

const gidId = (raw: string | number, type: string) => parseId(String(raw), type);
const notFound = (): UserError[] => [{ field: ['id'], message: 'Redirect does not exist', code: 'DOES_NOT_EXIST' }];

const UrlRedirectSortKeys = builder.enumType('UrlRedirectSortKeys', { values: ['CREATED_AT', 'ID', 'PATH', 'RELEVANCE'] as const });

const UrlRedirect = builder.objectRef<UrlRedirectRow>('UrlRedirect');
UrlRedirect.implement({
  interfaces: [Node],
  fields: (t) => ({
    path: t.exposeString('path'),
    target: t.exposeString('target'),
    createdAt: t.field({ type: 'DateTime', resolve: (r) => r.createdAt }),
  }),
});
const UrlRedirectConnection = defineConnection('UrlRedirect', UrlRedirect);
registerNode('UrlRedirect', (ctx, id) => getUrlRedirect(ctx.db, ctx.shopId, id));

const UrlRedirectInput = builder.inputType('UrlRedirectInput', { fields: (t) => ({ path: t.string(), target: t.string() }) });
const UrlRedirectError = typedUserError('UrlRedirectUserError', ['DOES_NOT_EXIST', 'CREATE_FAILED', 'UPDATE_FAILED', 'DELETE_FAILED'] as const);
const CreatePayload = payloadWith<{ urlRedirect: UrlRedirectRow | null }>('UrlRedirectCreatePayload', UrlRedirectError, (t) => ({ urlRedirect: t.field({ type: UrlRedirect, nullable: true, resolve: (p) => p.urlRedirect }) }));
const UpdatePayload = payloadWith<{ urlRedirect: UrlRedirectRow | null }>('UrlRedirectUpdatePayload', UrlRedirectError, (t) => ({ urlRedirect: t.field({ type: UrlRedirect, nullable: true, resolve: (p) => p.urlRedirect }) }));
const DeletePayload = payloadWith<{ deletedUrlRedirectId: string | null }>('UrlRedirectDeletePayload', UrlRedirectError, (t) => ({ deletedUrlRedirectId: t.id({ nullable: true, resolve: (p) => p.deletedUrlRedirectId }) }));

builder.queryFields((t) => ({
  urlRedirect: t.field({
    type: UrlRedirect, nullable: true, args: { id: t.arg.id({ required: true }) },
    resolve: (_r, a, ctx) => { requireScope(ctx, 'read_online_store_navigation'); const id = gidId(a.id, 'UrlRedirect'); return id ? getUrlRedirect(ctx.db, ctx.shopId, id) : null; },
  }),
  urlRedirects: t.field({
    type: UrlRedirectConnection, args: { ...ConnectionArgs, sortKey: t.arg({ type: UrlRedirectSortKeys, defaultValue: 'ID' }), query: t.arg.string(), savedSearchId: t.arg.id() },
    resolve: (_r, a, ctx) => {
      requireScope(ctx, 'read_online_store_navigation');
      return paginate(a, {
        fetch: ({ offset, limit }) => listUrlRedirects(ctx.db, ctx.shopId, { query: a.query, sortKey: a.sortKey ?? 'ID', reverse: !!a.reverse, offset, limit }),
        total: async () => (await countUrlRedirects(ctx.db, ctx.shopId, a.query)).count,
      });
    },
  }),
  urlRedirectsCount: t.field({
    type: Count, nullable: true, args: { query: t.arg.string(), limit: t.arg.int({ defaultValue: 10000 }), savedSearchId: t.arg.id() },
    resolve: (_r, a, ctx) => { requireScope(ctx, 'read_online_store_navigation'); return countUrlRedirects(ctx.db, ctx.shopId, a.query, a.limit ?? 10000); },
  }),
}));

builder.mutationFields((t) => ({
  urlRedirectCreate: t.field({
    type: CreatePayload, args: { urlRedirect: t.arg({ type: UrlRedirectInput, required: true }) },
    resolve: async (_r, a, ctx) => {
      requireScope(ctx, 'write_online_store_navigation');
      const r = await createUrlRedirect(ctx.db, ctx.shopId, a.urlRedirect);
      return r.ok ? { urlRedirect: r.value, userErrors: [] } : { urlRedirect: null, userErrors: r.errors.map((e) => ({ ...e, field: ['urlRedirect', ...(e.field ?? [])] })) };
    },
  }),
  urlRedirectUpdate: t.field({
    type: UpdatePayload, args: { id: t.arg.id({ required: true }), urlRedirect: t.arg({ type: UrlRedirectInput, required: true }) },
    resolve: async (_r, a, ctx) => {
      requireScope(ctx, 'write_online_store_navigation');
      const id = gidId(a.id, 'UrlRedirect');
      if (!id) return { urlRedirect: null, userErrors: notFound() };
      const r = await updateUrlRedirect(ctx.db, ctx.shopId, id, a.urlRedirect);
      return r.ok ? { urlRedirect: r.value, userErrors: [] } : { urlRedirect: null, userErrors: r.errors.map((e) => ({ ...e, field: e.field?.[0] === 'id' ? e.field : ['urlRedirect', ...(e.field ?? [])] })) };
    },
  }),
  urlRedirectDelete: t.field({
    type: DeletePayload, args: { id: t.arg.id({ required: true }) },
    resolve: async (_r, a, ctx) => {
      requireScope(ctx, 'write_online_store_navigation');
      const id = gidId(a.id, 'UrlRedirect');
      const r = id ? await deleteUrlRedirect(ctx.db, ctx.shopId, id) : null;
      return r?.ok ? { deletedUrlRedirectId: toGid('UrlRedirect', id!), userErrors: [] } : { deletedUrlRedirectId: null, userErrors: notFound() };
    },
  }),
}));
