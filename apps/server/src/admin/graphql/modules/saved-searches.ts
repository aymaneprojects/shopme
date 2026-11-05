/** Saved searches: the named views (tabs) of the admin lists, shared by all staff. Shopify names; `params` and the INVENTORY type are ShopMe extensions. */
import { createSavedSearch, deleteSavedSearch, getSavedSearch, listSavedSearches, updateSavedSearch, type SavedSearch as SavedSearchRow, type SavedSearchType } from '@shopme/core';
import { parseId, toGid } from '@shopme/shopify-compat';
import { builder } from '../builder';
import { requireScope, type GraphQLContext } from '../context';
import { ConnectionArgs, defineConnection, paginate } from '../types/connection';
import { Node, legacyId, registerNode } from '../types/node';
import { shopOf } from '../types/catalog';
import { definePayload } from '../types/errors';
import { Shop } from './shop';

const SearchResultType = builder.enumType('SearchResultType', {
  values: ['CUSTOMER', 'DRAFT_ORDER', 'INVENTORY_TRANSFER', 'PRODUCT', 'COLLECTION', 'FILE', 'PAGE', 'BLOG', 'ARTICLE', 'URL_REDIRECT', 'PRICE_RULE', 'DISCOUNT_REDEEM_CODE', 'ORDER', 'BALANCE_TRANSACTION', 'INVENTORY'] as const,
});
const SUPPORTED: readonly string[] = ['PRODUCT', 'ORDER', 'CUSTOMER', 'INVENTORY', 'PAGE', 'ARTICLE'];
const SCOPE: Record<SavedSearchType, string> = { PRODUCT: 'products', ORDER: 'orders', CUSTOMER: 'customers', INVENTORY: 'inventory', PAGE: 'online_store_pages', ARTICLE: 'online_store_pages' };

/** Split a search query into `key:value` filters and free text. */
export function parseSearchQuery(query: string): { searchTerms: string; filters: { key: string; value: string }[] } {
  const filters: { key: string; value: string }[] = [];
  const rest = query.replace(/(?:^|\s)(-?[a-z_]+):("([^"]*)"|\S+)/gi, (_m, key: string, raw: string, quoted?: string) => { filters.push({ key, value: quoted ?? raw }); return ' '; });
  return { searchTerms: rest.replace(/\s+/g, ' ').trim(), filters };
}

const SearchFilter = builder.objectRef<{ key: string; value: string }>('SearchFilter').implement({ fields: (t) => ({ key: t.exposeString('key'), value: t.exposeString('value') }) });
const SavedSearch = builder.objectRef<SavedSearchRow>('SavedSearch');
SavedSearch.implement({
  interfaces: [Node],
  fields: (t) => ({
    legacyResourceId: t.field({ type: 'UnsignedInt64', resolve: legacyId }),
    name: t.exposeString('name'),
    query: t.exposeString('query'),
    resourceType: t.field({ type: SearchResultType, resolve: (s) => s.resourceType as 'PRODUCT' }),
    searchTerms: t.string({ resolve: (s) => parseSearchQuery(s.query).searchTerms }),
    filters: t.field({ type: [SearchFilter], resolve: (s) => parseSearchQuery(s.query).filters }),
    /** ShopMe extension: the list state (filters, sort) as a URL query string. */
    params: t.exposeString('params'),
  }),
});
const SavedSearchConnection = defineConnection('SavedSearch', SavedSearch);
registerNode('SavedSearch', (ctx, id) => getSavedSearch(ctx.db, ctx.shopId, id));

const CreateInput = builder.inputType('SavedSearchCreateInput', {
  fields: (t) => ({ resourceType: t.field({ type: SearchResultType, required: true }), name: t.string({ required: true }), query: t.string({ required: true }), params: t.string() }),
});
const UpdateInput = builder.inputType('SavedSearchUpdateInput', { fields: (t) => ({ id: t.id({ required: true }), name: t.string(), query: t.string(), params: t.string() }) });
const DeleteInput = builder.inputType('SavedSearchDeleteInput', { fields: (t) => ({ id: t.id({ required: true }) }) });

const CreatePayload = definePayload<{ savedSearch: SavedSearchRow | null }>('SavedSearchCreatePayload', (t) => ({ savedSearch: t.field({ type: SavedSearch, nullable: true, resolve: (p) => p.savedSearch }) }));
const UpdatePayload = definePayload<{ savedSearch: SavedSearchRow | null }>('SavedSearchUpdatePayload', (t) => ({ savedSearch: t.field({ type: SavedSearch, nullable: true, resolve: (p) => p.savedSearch }) }));
const DeletePayload = definePayload<{ deletedSavedSearchId: string | null }>('SavedSearchDeletePayload', (t) => ({
  deletedSavedSearchId: t.id({ nullable: true, resolve: (p) => p.deletedSavedSearchId }),
  shop: t.field({ type: Shop, resolve: (_p, _a, ctx) => shopOf(ctx) }),
}));

const list = (type: SavedSearchType) => (_r: unknown, a: { first?: number | null; after?: string | null; last?: number | null; before?: string | null; reverse?: boolean | null }, ctx: GraphQLContext) => {
  requireScope(ctx, `read_${SCOPE[type]}`);
  return paginate(a, { fetch: ({ offset, limit }) => listSavedSearches(ctx.db, ctx.shopId, type, { reverse: !!a.reverse, offset, limit }) });
};

builder.queryFields((t) => ({
  productSavedSearches: t.field({ type: SavedSearchConnection, args: { ...ConnectionArgs }, resolve: list('PRODUCT') }),
  orderSavedSearches: t.field({ type: SavedSearchConnection, args: { ...ConnectionArgs }, resolve: list('ORDER') }),
  customerSavedSearches: t.field({ type: SavedSearchConnection, args: { ...ConnectionArgs }, deprecationReason: 'Use `segments` instead.', resolve: list('CUSTOMER') }),
  /** ShopMe extension: views of the inventory list. */
  inventorySavedSearches: t.field({ type: SavedSearchConnection, args: { ...ConnectionArgs }, resolve: list('INVENTORY') }),
  /** ShopMe extensions: views of the pages and blog posts lists. */
  pageSavedSearches: t.field({ type: SavedSearchConnection, args: { ...ConnectionArgs }, resolve: list('PAGE') }),
  articleSavedSearches: t.field({ type: SavedSearchConnection, args: { ...ConnectionArgs }, resolve: list('ARTICLE') }),
}));

const missing = [{ field: ['input', 'id'], message: 'Saved search does not exist', code: 'DOES_NOT_EXIST' }];
const scopeOf = (row: SavedSearchRow) => `write_${SCOPE[row.resourceType as SavedSearchType]}`;
const staffId = (ctx: GraphQLContext) => (ctx.auth.kind === 'session' ? ctx.auth.user.id : null);

builder.mutationFields((t) => ({
  savedSearchCreate: t.field({
    type: CreatePayload, args: { input: t.arg({ type: CreateInput, required: true }) },
    resolve: async (_r, { input }, ctx) => {
      if (!SUPPORTED.includes(input.resourceType)) return { savedSearch: null, userErrors: [{ field: ['input', 'resourceType'], message: 'Resource type is not supported', code: 'INVALID' }] };
      requireScope(ctx, `write_${SCOPE[input.resourceType as SavedSearchType]}`);
      const r = await createSavedSearch(ctx.db, ctx.shopId, input, staffId(ctx));
      return r.ok ? { savedSearch: r.value, userErrors: [] } : { savedSearch: null, userErrors: r.errors.map((e) => ({ ...e, field: ['input', ...(e.field ?? [])] })) };
    },
  }),
  savedSearchUpdate: t.field({
    type: UpdatePayload, args: { input: t.arg({ type: UpdateInput, required: true }) },
    resolve: async (_r, { input }, ctx) => {
      const id = parseId(String(input.id), 'SavedSearch');
      const cur = id ? await getSavedSearch(ctx.db, ctx.shopId, id) : null;
      if (!id || !cur) return { savedSearch: null, userErrors: missing };
      requireScope(ctx, scopeOf(cur));
      const r = await updateSavedSearch(ctx.db, ctx.shopId, id, input);
      return r.ok ? { savedSearch: r.value, userErrors: [] } : { savedSearch: null, userErrors: r.errors.map((e) => ({ ...e, field: ['input', ...(e.field ?? [])] })) };
    },
  }),
  savedSearchDelete: t.field({
    type: DeletePayload, args: { input: t.arg({ type: DeleteInput, required: true }) },
    resolve: async (_r, { input }, ctx) => {
      const id = parseId(String(input.id), 'SavedSearch');
      const cur = id ? await getSavedSearch(ctx.db, ctx.shopId, id) : null;
      if (!id || !cur) return { deletedSavedSearchId: null, userErrors: missing };
      requireScope(ctx, scopeOf(cur));
      const r = await deleteSavedSearch(ctx.db, ctx.shopId, id);
      return r.ok ? { deletedSavedSearchId: toGid('SavedSearch', id), userErrors: [] } : { deletedSavedSearchId: null, userErrors: missing };
    },
  }),
}));
