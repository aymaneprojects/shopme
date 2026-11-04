import { randomUUID } from 'node:crypto';
import {
  addProductsToCollection, countCollectionProducts, countCollections, createCollection, deleteCollection, getCollection, getCollectionByHandle, getCollectionRules, listCollectionProducts,
  listCollections, removeProductsFromCollection, updateCollection, type Collection, type CollectionInput as ServiceInput, type Media, getMedia,
} from '@shopme/core';
import { parseId, toGid } from '@shopme/shopify-compat';
import { builder } from '../builder';
import { requireScope } from '../context';
import { ConnectionArgs, paginate } from '../types/connection';
import { Node, legacyId, registerNode } from '../types/node';
import { Count } from '../types/money';
import { Collection_, CollectionConnection, Job, MetafieldInput, ProductConnection, SEO, SEOInput, prefixed } from '../types/catalog';
import { definePayload } from '../types/errors';
import { Image, imageOf } from './files';

export const CollectionSortKeys = builder.enumType('CollectionSortKeys', { values: ['ID', 'RELEVANCE', 'TITLE', 'UPDATED_AT'] as const });
const ProductCollectionSortKeys = builder.enumType('ProductCollectionSortKeys', { values: ['BEST_SELLING', 'COLLECTION_DEFAULT', 'CREATED', 'ID', 'MANUAL', 'PRICE', 'RELEVANCE', 'TITLE'] as const });
const CollectionSortOrder = builder.enumType('CollectionSortOrder', { values: ['ALPHA_ASC', 'ALPHA_DESC', 'BEST_SELLING', 'MOST_RELEVANT', 'CREATED', 'CREATED_DESC', 'MANUAL', 'PRICE_ASC', 'PRICE_DESC'] as const });
const CollectionRuleColumn = builder.enumType('CollectionRuleColumn', {
  values: [
    'TAG', 'TITLE', 'TYPE', 'PRODUCT_TAXONOMY_NODE_ID', 'PRODUCT_CATEGORY_ID', 'PRODUCT_CATEGORY_ID_WITH_DESCENDANTS', 'VENDOR', 'VARIANT_PRICE', 'IS_PRICE_REDUCED',
    'VARIANT_COMPARE_AT_PRICE', 'VARIANT_WEIGHT', 'VARIANT_INVENTORY', 'VARIANT_TITLE', 'PRODUCT_METAFIELD_DEFINITION', 'VARIANT_METAFIELD_DEFINITION',
  ] as const,
});
const CollectionRuleRelation = builder.enumType('CollectionRuleRelation', {
  values: ['CONTAINS', 'ENDS_WITH', 'EQUALS', 'GREATER_THAN', 'IS_NOT_SET', 'IS_SET', 'LESS_THAN', 'NOT_CONTAINS', 'NOT_EQUALS', 'STARTS_WITH'] as const,
});

export const UniqueMetafieldValueInput = builder.inputType('UniqueMetafieldValueInput', {
  fields: (t) => ({ namespace: t.string({ required: true }), key: t.string({ required: true }), value: t.string({ required: true }) }),
});
const CollectionIdentifierInput = builder.inputType('CollectionIdentifierInput', {
  fields: (t) => ({ id: t.id(), customId: t.field({ type: UniqueMetafieldValueInput }), handle: t.string() }),
});

const CollectionRule = builder.objectRef<{ column: string; relation: string; condition: string }>('CollectionRule').implement({
  fields: (t) => ({
    column: t.field({ type: CollectionRuleColumn, resolve: (r) => r.column as 'TAG' }),
    relation: t.field({ type: CollectionRuleRelation, resolve: (r) => r.relation as 'EQUALS' }),
    condition: t.exposeString('condition'),
  }),
});
const CollectionRuleSet = builder.objectRef<{ appliedDisjunctively: boolean; rules: { column: string; relation: string; condition: string }[] }>('CollectionRuleSet').implement({
  fields: (t) => ({ appliedDisjunctively: t.exposeBoolean('appliedDisjunctively'), rules: t.field({ type: [CollectionRule], resolve: (r) => r.rules }) }),
});

Collection_.implement({
  interfaces: [Node],
  fields: (t) => ({
    legacyResourceId: t.field({ type: 'UnsignedInt64', resolve: legacyId }),
    title: t.exposeString('title'),
    handle: t.exposeString('handle'),
    descriptionHtml: t.field({ type: 'HTML', resolve: (c) => c.descriptionHtml }),
    description: t.string({ args: { truncateAt: t.arg.int() }, resolve: (c, a) => { const s = c.descriptionHtml.replace(/<[^>]*>/g, ''); return a.truncateAt ? s.slice(0, a.truncateAt) : s; } }),
    sortOrder: t.field({ type: CollectionSortOrder, resolve: (c) => c.sortOrder as 'MANUAL' }),
    templateSuffix: t.exposeString('templateSuffix', { nullable: true }),
    seo: t.field({ type: SEO, resolve: (c) => ({ title: c.seoTitle, description: c.seoDescription }) }),
    updatedAt: t.field({ type: 'DateTime', resolve: (c) => c.updatedAt }),
    image: t.field({
      type: Image, nullable: true,
      resolve: async (c, _a, ctx) => { const m: Media | null = c.imageMediaId ? await getMedia(ctx.db, ctx.shopId, c.imageMediaId) : null; return m ? imageOf(ctx, m) : null; },
    }),
    productsCount: t.field({ type: Count, nullable: true, resolve: async (c, _a, ctx) => ({ count: await countCollectionProducts(ctx.db, ctx.shopId, c.id), precision: 'EXACT' as const }) }),
    ruleSet: t.field({
      type: CollectionRuleSet, nullable: true, deprecationReason: 'Use `sources` instead.',
      resolve: async (c, _a, ctx) => {
        if (!c.isSmart) return null;
        const rules = await getCollectionRules(ctx.db, ctx.shopId, c.id);
        return { appliedDisjunctively: c.rulesAppliedDisjunctively, rules: rules.map((r) => ({ column: r.ruleColumn, relation: r.relation, condition: r.condition })) };
      },
    }),
    hasProduct: t.boolean({
      args: { id: t.arg.id({ required: true }) },
      resolve: async (c, a, ctx) => { const pid = parseId(String(a.id), 'Product'); return pid ? (await listCollectionProducts(ctx.db, ctx.shopId, c, { offset: 0, limit: 10000 })).some((p) => p.id === pid) : false; },
    }),
    products: t.field({
      type: ProductConnection, args: { ...ConnectionArgs, sortKey: t.arg({ type: ProductCollectionSortKeys, defaultValue: 'COLLECTION_DEFAULT' }) },
      resolve: (c, a, ctx) => paginate(a, {
        fetch: ({ offset, limit }) => listCollectionProducts(ctx.db, ctx.shopId, c, { sortKey: a.sortKey, reverse: !!a.reverse, offset, limit }),
        total: () => countCollectionProducts(ctx.db, ctx.shopId, c.id),
      }),
    }),
  }),
});
registerNode('Collection', (ctx, id) => getCollection(ctx.db, ctx.shopId, id));

/* ------------------------------ inputs ------------------------------ */

const ImageInput = builder.inputType('ImageInput', { fields: (t) => ({ id: t.id(), altText: t.string(), src: t.string() }) });
const CollectionRuleInput = builder.inputType('CollectionRuleInput', {
  fields: (t) => ({ column: t.field({ type: CollectionRuleColumn, required: true }), relation: t.field({ type: CollectionRuleRelation, required: true }), condition: t.string({ required: true }), conditionObjectId: t.id() }),
});
const CollectionRuleSetInput = builder.inputType('CollectionRuleSetInput', { fields: (t) => ({ appliedDisjunctively: t.boolean({ required: true }), rules: t.field({ type: [CollectionRuleInput] }) }) });
const CollectionDeleteInput = builder.inputType('CollectionDeleteInput', { fields: (t) => ({ id: t.id({ required: true }) }) });

/** Deprecated `input:` form (carries smart `ruleSet` and manual `products`). */
const CollectionInput = builder.inputType('CollectionInput', {
  fields: (t) => ({
    descriptionHtml: t.string(), handle: t.string(), id: t.id(), image: t.field({ type: ImageInput }), products: t.idList(), ruleSet: t.field({ type: CollectionRuleSetInput }),
    templateSuffix: t.string(), sortOrder: t.field({ type: CollectionSortOrder }), title: t.string(), metafields: t.field({ type: [MetafieldInput] }), seo: t.field({ type: SEOInput }),
    redirectNewHandle: t.boolean({ defaultValue: false }),
  }),
});
const CollectionCreateInput = builder.inputType('CollectionCreateInput', {
  fields: (t) => ({
    descriptionHtml: t.string(), handle: t.string(), image: t.field({ type: ImageInput }), templateSuffix: t.string(), sortOrder: t.field({ type: CollectionSortOrder }),
    title: t.string({ required: true }), metafields: t.field({ type: [MetafieldInput] }), seo: t.field({ type: SEOInput }),
  }),
});
const CollectionUpdateInput = builder.inputType('CollectionUpdateInput', {
  fields: (t) => ({
    descriptionHtml: t.string(), handle: t.string(), id: t.id(), image: t.field({ type: ImageInput }), templateSuffix: t.string(), sortOrder: t.field({ type: CollectionSortOrder }),
    title: t.string(), metafields: t.field({ type: [MetafieldInput] }), seo: t.field({ type: SEOInput }), redirectNewHandle: t.boolean({ defaultValue: false }),
  }),
});

interface InputShape {
  title?: string | null; handle?: string | null; descriptionHtml?: string | null; sortOrder?: string | null; templateSuffix?: string | null;
  seo?: { title?: string | null; description?: string | null } | null; image?: { src?: string | null; altText?: string | null } | null;
  ruleSet?: { appliedDisjunctively: boolean; rules?: { column: string; relation: string; condition: string }[] | null } | null;
  products?: (string | number)[] | null; metafields?: { namespace?: string | null; key?: string | null; value?: string | null; type?: string | null }[] | null;
}
function toService(i: InputShape): ServiceInput {
  return {
    ...i,
    sortOrder: i.sortOrder === 'MOST_RELEVANT' ? 'MANUAL' : i.sortOrder, // stored sort orders are the persisted subset
    products: i.products?.map((p) => parseId(String(p), 'Product')).filter((x): x is number => x !== null),
    metafields: i.metafields?.map((m) => ({ ownerType: 'COLLECTION', ownerId: 0, namespace: m.namespace, key: m.key ?? '', value: m.value ?? '', type: m.type })),
  };
}

/* ------------------------------ payloads ------------------------------ */

const jobOf = () => ({ id: toGid('Job', randomUUID()), done: true });
type CollectionPayload = { collection: Collection | null };
const CreatePayload = definePayload<CollectionPayload>('CollectionCreatePayload', (t) => ({ collection: t.field({ type: Collection_, nullable: true, resolve: (p) => p.collection }) }));
const UpdatePayload = definePayload<CollectionPayload & { job: { id: string; done: boolean } | null }>('CollectionUpdatePayload', (t) => ({
  collection: t.field({ type: Collection_, nullable: true, resolve: (p) => p.collection }),
  job: t.field({ type: Job, nullable: true, resolve: (p) => p.job }),
}));
const DeletePayload = definePayload<{ deletedCollectionId: string | null }>('CollectionDeletePayload', (t) => ({ deletedCollectionId: t.id({ nullable: true, resolve: (p) => p.deletedCollectionId }) }));
const AddPayload = definePayload<CollectionPayload>('CollectionAddProductsPayload', (t) => ({ collection: t.field({ type: Collection_, nullable: true, resolve: (p) => p.collection }) }));
const AddV2Payload = definePayload<{ job: { id: string; done: boolean } | null }>('CollectionAddProductsV2Payload', (t) => ({ job: t.field({ type: Job, nullable: true, resolve: (p) => p.job }) }));
const RemovePayload = definePayload<{ job: { id: string; done: boolean } | null }>('CollectionRemoveProductsPayload', (t) => ({ job: t.field({ type: Job, nullable: true, resolve: (p) => p.job }) }));

/* ------------------------------ root fields ------------------------------ */

builder.queryFields((t) => ({
  collection: t.field({
    type: Collection_, nullable: true, args: { id: t.arg.id({ required: true }) },
    resolve: (_r, a, ctx) => { requireScope(ctx, 'read_products'); const id = parseId(String(a.id), 'Collection'); return id ? getCollection(ctx.db, ctx.shopId, id) : null; },
  }),
  collectionByHandle: t.field({
    type: Collection_, nullable: true, deprecationReason: 'Use `collectionByIdentifier` instead.', args: { handle: t.arg.string({ required: true }) },
    resolve: (_r, a, ctx) => { requireScope(ctx, 'read_products'); return getCollectionByHandle(ctx.db, ctx.shopId, a.handle); },
  }),
  collectionByIdentifier: t.field({
    type: Collection_, nullable: true, args: { identifier: t.arg({ type: CollectionIdentifierInput, required: true }) },
    resolve: (_r, { identifier }, ctx) => {
      requireScope(ctx, 'read_products');
      if (identifier.id) { const id = parseId(String(identifier.id), 'Collection'); return id ? getCollection(ctx.db, ctx.shopId, id) : null; }
      return identifier.handle ? getCollectionByHandle(ctx.db, ctx.shopId, identifier.handle) : null;
    },
  }),
  collections: t.field({
    type: CollectionConnection, args: { ...ConnectionArgs, sortKey: t.arg({ type: CollectionSortKeys, defaultValue: 'ID' }), query: t.arg.string(), savedSearchId: t.arg.id() },
    resolve: (_r, a, ctx) => {
      requireScope(ctx, 'read_products');
      return paginate(a, {
        fetch: ({ offset, limit }) => listCollections(ctx.db, ctx.shopId, { query: a.query, sortKey: a.sortKey ?? 'ID', reverse: !!a.reverse, offset, limit }),
        total: async () => (await countCollections(ctx.db, ctx.shopId, a.query)).count,
      });
    },
  }),
  collectionsCount: t.field({
    type: Count, nullable: true, args: { query: t.arg.string(), savedSearchId: t.arg.id(), limit: t.arg.int({ defaultValue: 10000 }) },
    resolve: (_r, a, ctx) => { requireScope(ctx, 'read_products'); return countCollections(ctx.db, ctx.shopId, a.query, a.limit ?? 10000); },
  }),
}));

builder.mutationFields((t) => ({
  collectionCreate: t.field({
    type: CreatePayload, args: { input: t.arg({ type: CollectionInput, deprecationReason: 'Use `collection` instead.' }), collection: t.arg({ type: CollectionCreateInput }) },
    resolve: async (_r, a, ctx) => {
      requireScope(ctx, 'write_products');
      const src = a.collection ?? a.input;
      if (!src) return { collection: null, userErrors: [{ field: ['collection'], message: 'A collection is required.' }] };
      const r = await createCollection(ctx.db, ctx.shopId, toService(src));
      return r.ok ? { collection: r.value, userErrors: [] } : { collection: null, userErrors: prefixed(r.errors, [a.collection ? 'collection' : 'input']) };
    },
  }),
  collectionUpdate: t.field({
    type: UpdatePayload, args: { input: t.arg({ type: CollectionInput, deprecationReason: 'Use `collection` instead.' }), collection: t.arg({ type: CollectionUpdateInput }) },
    resolve: async (_r, a, ctx) => {
      requireScope(ctx, 'write_products');
      const src = a.collection ?? a.input;
      const root = a.collection ? 'collection' : 'input';
      const id = src?.id ? parseId(String(src.id), 'Collection') : null;
      if (!src || !id) return { collection: null, job: null, userErrors: [{ field: [root, 'id'], message: 'Collection does not exist' }] };
      const r = await updateCollection(ctx.db, ctx.shopId, id, toService(src));
      return r.ok ? { collection: r.value, job: null, userErrors: [] } : { collection: null, job: null, userErrors: prefixed(r.errors, [root]) };
    },
  }),
  collectionDelete: t.field({
    type: DeletePayload, args: { input: t.arg({ type: CollectionDeleteInput, required: true }) },
    resolve: async (_r, { input }, ctx) => {
      requireScope(ctx, 'write_products');
      const id = parseId(String(input.id), 'Collection');
      const r = id ? await deleteCollection(ctx.db, ctx.shopId, id) : null;
      return r?.ok ? { deletedCollectionId: toGid('Collection', id!), userErrors: [] } : { deletedCollectionId: null, userErrors: [{ field: ['input', 'id'], message: 'Collection does not exist' }] };
    },
  }),
  collectionAddProducts: t.field({
    type: AddPayload, deprecationReason: 'Use `collectionUpdate` with inclusion.selectionsToAdd instead.', args: { id: t.arg.id({ required: true }), productIds: t.arg.idList({ required: true }) },
    resolve: async (_r, a, ctx) => {
      requireScope(ctx, 'write_products');
      const r = await changeMembers(ctx, a.id, a.productIds, 'add');
      return r.ok ? { collection: r.value, userErrors: [] } : { collection: null, userErrors: r.errors };
    },
  }),
  collectionAddProductsV2: t.field({
    type: AddV2Payload, args: { id: t.arg.id({ required: true }), productIds: t.arg.idList({ required: true }) },
    resolve: async (_r, a, ctx) => {
      requireScope(ctx, 'write_products');
      const r = await changeMembers(ctx, a.id, a.productIds, 'add');
      return r.ok ? { job: jobOf(), userErrors: [] } : { job: null, userErrors: r.errors };
    },
  }),
  collectionRemoveProducts: t.field({
    type: RemovePayload, deprecationReason: 'Use `collectionUpdate` with inclusions.selectionsToRemove instead.', args: { id: t.arg.id({ required: true }), productIds: t.arg.idList({ required: true }) },
    resolve: async (_r, a, ctx) => {
      requireScope(ctx, 'write_products');
      const r = await changeMembers(ctx, a.id, a.productIds, 'remove');
      return r.ok ? { job: jobOf(), userErrors: [] } : { job: null, userErrors: r.errors };
    },
  }),
}));

async function changeMembers(ctx: import('../context').GraphQLContext, id: string | number, productIds: (string | number)[], mode: 'add' | 'remove') {
  const cid = parseId(String(id), 'Collection');
  const pids = productIds.map((p) => parseId(String(p), 'Product'));
  if (!cid) return { ok: false as const, errors: [{ field: ['id'], message: 'Collection does not exist' }] };
  if (pids.some((p) => p === null)) return { ok: false as const, errors: [{ field: ['productIds'], message: 'Invalid product id' }] };
  const fn = mode === 'add' ? addProductsToCollection : removeProductsFromCollection;
  return fn(ctx.db, ctx.shopId, cid, pids as number[]);
}
