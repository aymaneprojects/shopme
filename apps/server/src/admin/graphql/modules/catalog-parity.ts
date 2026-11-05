import { getCollection, getProduct, reorderCollectionProducts, reorderOptions, reorderVariants, type Collection, type Product } from '@shopme/core';
import { fromGid, parseId, type UserError } from '@shopme/shopify-compat';
import { builder } from '../builder';
import { requireScope, type GraphQLContext } from '../context';
import { definePayload } from '../types/errors';
import { Node } from '../types/node';
import { Collection_, Job, Product_, shopOf } from '../types/catalog';
import { typedUserError, payloadWith } from '../types/sales';
import { Shop } from './shop';
import { MoveInput } from './products';
import { ONLINE_STORE, Publication, setPublished } from './catalog-ext';
import { completedJob } from './jobs';

/** Catalog parity: manual collection order, variant and option reordering, and the legacy publish mutations on the single Online Store channel. */

/* ------------------------------ reordering ------------------------------ */

const ReorderProductsError = typedUserError('CollectionReorderProductsUserError', ['TOO_MANY_ATTEMPTS_TO_REORDER_PRODUCTS', 'COLLECTION_NOT_FOUND', 'MANUALLY_SORTED_COLLECTION', 'INVALID_MOVE']);
const ReorderProductsPayload = builder.objectRef<{ job: { id: string; done: boolean } | null; userErrors: UserError[] }>('CollectionReorderProductsPayload').implement({
  fields: (t) => ({ job: t.field({ type: Job, nullable: true, resolve: (p) => p.job }), userErrors: t.field({ type: [ReorderProductsError], resolve: (p) => p.userErrors }) }),
});
const BulkReorderError = typedUserError('ProductVariantsBulkReorderUserError', ['PRODUCT_DOES_NOT_EXIST', 'MISSING_VARIANT', 'INVALID_POSITION', 'DUPLICATED_VARIANT_ID', 'GENERIC_ERROR']);
const BulkReorderPayload = payloadWith<{ product: Product | null }>('ProductVariantsBulkReorderPayload', BulkReorderError, (t) => ({ product: t.field({ type: Product_, nullable: true, resolve: (p) => p.product }) }));
const OptionsReorderError = typedUserError('ProductOptionsReorderUserError', [
  'OPTION_NAME_DOES_NOT_EXIST', 'OPTION_VALUE_DOES_NOT_EXIST', 'OPTION_ID_DOES_NOT_EXIST', 'OPTION_VALUE_ID_DOES_NOT_EXIST', 'DUPLICATED_OPTION_NAME', 'DUPLICATED_OPTION_VALUE', 'MISSING_OPTION_NAME',
  'MISSING_OPTION_VALUE', 'PRODUCT_DOES_NOT_EXIST', 'PRODUCT_SUSPENDED', 'NO_KEY_ON_REORDER', 'MIXING_ID_AND_NAME_KEYS_IS_NOT_ALLOWED', 'CANNOT_MAKE_CHANGES_IF_VARIANT_IS_MISSING_REQUIRED_SKU',
]);
const OptionsReorderPayload = payloadWith<{ product: Product | null }>('ProductOptionsReorderPayload', OptionsReorderError, (t) => ({ product: t.field({ type: Product_, nullable: true, resolve: (p) => p.product }) }));
const VariantPositionInput = builder.inputType('ProductVariantPositionInput', { fields: (t) => ({ id: t.id({ required: true }), position: t.int({ required: true }) }) });
const OptionValueReorderInput = builder.inputType('OptionValueReorderInput', { fields: (t) => ({ id: t.id(), name: t.string() }) });
const OptionReorderInput = builder.inputType('OptionReorderInput', { fields: (t) => ({ id: t.id(), name: t.string(), values: t.field({ type: [OptionValueReorderInput] }) }) });

builder.mutationFields((t) => ({
  collectionReorderProducts: t.field({
    type: ReorderProductsPayload, args: { id: t.arg.id({ required: true }), moves: t.arg({ type: [MoveInput], required: true }) },
    resolve: async (_r, a, ctx) => {
      requireScope(ctx, 'write_products');
      const id = parseId(String(a.id), 'Collection');
      if (!id) return { job: null, userErrors: [{ field: ['id'], message: 'Collection does not exist', code: 'COLLECTION_NOT_FOUND' }] };
      const r = await reorderCollectionProducts(ctx.db, ctx.shopId, id, a.moves.map((m) => ({ productId: parseId(String(m.id), 'Product'), newPosition: String(m.newPosition) })));
      return r.ok ? { job: await completedJob(ctx, 'collection.reorder-products'), userErrors: [] } : { job: null, userErrors: r.errors };
    },
  }),
  productVariantsBulkReorder: t.field({
    type: BulkReorderPayload, args: { productId: t.arg.id({ required: true }), positions: t.arg({ type: [VariantPositionInput], required: true }) },
    resolve: async (_r, a, ctx) => {
      requireScope(ctx, 'write_products');
      const id = parseId(String(a.productId), 'Product');
      if (!id) return { product: null, userErrors: [{ field: ['productId'], message: 'Product does not exist', code: 'PRODUCT_DOES_NOT_EXIST' }] };
      const r = await reorderVariants(ctx.db, ctx.shopId, id, a.positions.map((p) => ({ variantId: parseId(String(p.id), 'ProductVariant'), position: p.position })));
      return r.ok ? { product: await getProduct(ctx.db, ctx.shopId, id), userErrors: [] } : { product: null, userErrors: r.errors };
    },
  }),
  productOptionsReorder: t.field({
    type: OptionsReorderPayload, args: { productId: t.arg.id({ required: true }), options: t.arg({ type: [OptionReorderInput], required: true }) },
    resolve: async (_r, a, ctx) => {
      requireScope(ctx, 'write_products');
      const id = parseId(String(a.productId), 'Product');
      if (!id) return { product: null, userErrors: [{ field: ['productId'], message: 'Product does not exist', code: 'PRODUCT_DOES_NOT_EXIST' }] };
      const idOf = (x: string | number | null | undefined, type: string) => (x == null ? undefined : parseId(String(x), type) ?? -1);
      const r = await reorderOptions(ctx.db, ctx.shopId, id, a.options.map((o) => ({
        id: idOf(o.id, 'ProductOption'), name: o.name, values: o.values?.map((v) => ({ id: idOf(v.id, 'ProductOptionValue'), name: v.name })),
      })));
      return r.ok ? { product: await getProduct(ctx.db, ctx.shopId, id), userErrors: [] } : { product: null, userErrors: r.errors };
    },
  }),
}));

/* ------------------------------ publish / unpublish (Online Store only) ------------------------------ */

const CollectionPublicationInput = builder.inputType('CollectionPublicationInput', {
  fields: (t) => ({ publicationId: t.id(), channelId: t.id({ deprecationReason: 'Use publicationId instead.' }), channelHandle: t.string({ deprecationReason: 'Use publicationId instead.' }) }),
});
const ProductPublicationInput = builder.inputType('ProductPublicationInput', {
  fields: (t) => ({ publicationId: t.id(), channelId: t.id({ deprecationReason: 'Use publicationId instead.' }), channelHandle: t.string({ deprecationReason: 'Use publicationId instead.' }), publishDate: t.field({ type: 'DateTime' }) }),
});
const CollectionPublishInput = builder.inputType('CollectionPublishInput', { fields: (t) => ({ id: t.id({ required: true }), collectionPublications: t.field({ type: [CollectionPublicationInput], required: true }) }) });
const CollectionUnpublishInput = builder.inputType('CollectionUnpublishInput', { fields: (t) => ({ id: t.id({ required: true }), collectionPublications: t.field({ type: [CollectionPublicationInput], required: true }) }) });
const ProductPublishInput = builder.inputType('ProductPublishInput', { fields: (t) => ({ id: t.id({ required: true }), productPublications: t.field({ type: [ProductPublicationInput], required: true }) }) });
const ProductUnpublishInput = builder.inputType('ProductUnpublishInput', { fields: (t) => ({ id: t.id({ required: true }), productPublications: t.field({ type: [ProductPublicationInput], required: true }) }) });

const CollectionPublication = builder.objectRef<{ collection: Collection; published: boolean }>('CollectionPublication').implement({
  fields: (t) => ({
    collection: t.field({ type: Collection_, resolve: (p) => p.collection }), isPublished: t.boolean({ resolve: (p) => p.published }),
    publication: t.field({ type: Publication, resolve: () => ONLINE_STORE }), publishDate: t.field({ type: 'DateTime', resolve: (p) => p.collection.publishedAt ?? p.collection.updatedAt }),
  }),
});
const ProductPublication = builder.objectRef<{ product: Product; published: boolean }>('ProductPublication').implement({
  fields: (t) => ({
    product: t.field({ type: Product_, resolve: (p) => p.product }), isPublished: t.boolean({ resolve: (p) => p.published }),
    publishDate: t.field({ type: 'DateTime', nullable: true, resolve: (p) => p.product.publishedAt }),
  }),
});
type WithShop = { userErrors: UserError[] };
const shopField = (t: PothosSchemaTypes.ObjectFieldBuilder<PothosSchemaTypes.ExtendDefaultTypes<import('../builder').SchemaTypes>, WithShop>) => t.field({ type: Shop, resolve: (_p, _a, ctx) => shopOf(ctx) });
const CollectionPublishPayload = definePayload<{ collection: Collection | null; collectionPublications: { collection: Collection; published: boolean }[] | null }>('CollectionPublishPayload', (t) => ({
  collection: t.field({ type: Collection_, nullable: true, resolve: (p) => p.collection }),
  collectionPublications: t.field({ type: [CollectionPublication], nullable: true, resolve: (p) => p.collectionPublications }),
  shop: shopField(t),
}));
const CollectionUnpublishPayload = definePayload<{ collection: Collection | null }>('CollectionUnpublishPayload', (t) => ({ collection: t.field({ type: Collection_, nullable: true, resolve: (p) => p.collection }), shop: shopField(t) }));
const ProductPublishPayload = definePayload<{ product: Product | null; productPublications: { product: Product; published: boolean }[] | null }>('ProductPublishPayload', (t) => ({
  product: t.field({ type: Product_, nullable: true, resolve: (p) => p.product }),
  productPublications: t.field({ type: [ProductPublication], nullable: true, deprecationReason: 'Use Product.publications instead.', resolve: (p) => p.productPublications }),
  shop: shopField(t),
}));
const ProductUnpublishPayload = definePayload<{ product: Product | null }>('ProductUnpublishPayload', (t) => ({ product: t.field({ type: Product_, nullable: true, resolve: (p) => p.product }), shop: shopField(t) }));

// `Publishable` payloads: the node is a Product or a Collection.
const CurrentChannelPublish = definePayload<{ publishable: unknown }>('PublishablePublishToCurrentChannelPayload', (t) => ({ publishable: t.field({ type: Node, nullable: true, resolve: (p) => p.publishable as never }), shop: shopField(t) }));
const CurrentChannelUnpublish = definePayload<{ publishable: unknown }>('PublishableUnpublishToCurrentChannelPayload', (t) => ({ publishable: t.field({ type: Node, nullable: true, resolve: (p) => p.publishable as never }), shop: shopField(t) }));

const wrongType = (field: string[], what: string): UserError[] => [{ field, message: `${what} does not exist` }];
const publicationsOf = (xs: { publicationId?: string | number | null; channelId?: string | number | null }[]) => xs.map((x) => ({ publicationId: x.publicationId ?? x.channelId ?? null }));

async function publishCollection(ctx: GraphQLContext, input: { id: string | number; collectionPublications: { publicationId?: string | number | null; channelId?: string | number | null }[] }, publish: boolean) {
  const gid = fromGid(String(input.id));
  if (!gid || gid.type !== 'Collection') { requireScope(ctx, 'write_publications'); return { collection: null, collectionPublications: null, userErrors: wrongType(['id'], 'Collection') }; }
  const r = await setPublished(ctx, String(input.id), publicationsOf(input.collectionPublications), publish);
  if (r.userErrors.length) return { collection: null, collectionPublications: null, userErrors: r.userErrors as UserError[] };
  const collection = (await getCollection(ctx.db, ctx.shopId, gid.id))!;
  return { collection, collectionPublications: publish ? [{ collection, published: true }] : null, userErrors: [] as UserError[] };
}
async function publishProduct(ctx: GraphQLContext, input: { id: string | number; productPublications: { publicationId?: string | number | null; channelId?: string | number | null }[] }, publish: boolean) {
  const gid = fromGid(String(input.id));
  if (!gid || gid.type !== 'Product') { requireScope(ctx, 'write_publications'); return { product: null, productPublications: null, userErrors: wrongType(['id'], 'Product') }; }
  const r = await setPublished(ctx, String(input.id), publicationsOf(input.productPublications), publish);
  if (r.userErrors.length) return { product: null, productPublications: null, userErrors: r.userErrors as UserError[] };
  const product = (await getProduct(ctx.db, ctx.shopId, gid.id))!;
  return { product, productPublications: publish ? [{ product, published: true }] : null, userErrors: [] as UserError[] };
}

builder.mutationFields((t) => ({
  collectionPublish: t.field({ type: CollectionPublishPayload, deprecationReason: 'Use `publishablePublish` instead.', args: { input: t.arg({ type: CollectionPublishInput, required: true }) }, resolve: (_r, a, ctx) => publishCollection(ctx, a.input, true) }),
  collectionUnpublish: t.field({
    type: CollectionUnpublishPayload, deprecationReason: 'Use `publishableUnpublish` instead.', args: { input: t.arg({ type: CollectionUnpublishInput, required: true }) },
    resolve: async (_r, a, ctx) => { const r = await publishCollection(ctx, a.input, false); return { collection: r.collection, userErrors: r.userErrors }; },
  }),
  productPublish: t.field({ type: ProductPublishPayload, deprecationReason: 'Use `publishablePublish` instead.', args: { input: t.arg({ type: ProductPublishInput, required: true }) }, resolve: (_r, a, ctx) => publishProduct(ctx, a.input, true) }),
  productUnpublish: t.field({
    type: ProductUnpublishPayload, deprecationReason: 'Use `publishableUnpublish` instead.', args: { input: t.arg({ type: ProductUnpublishInput, required: true }) },
    resolve: async (_r, a, ctx) => { const r = await publishProduct(ctx, a.input, false); return { product: r.product, userErrors: r.userErrors }; },
  }),
  publishablePublishToCurrentChannel: t.field({
    type: CurrentChannelPublish, deprecationReason: 'Use `publishablePublish` instead.', args: { id: t.arg.id({ required: true }) },
    resolve: async (_r, a, ctx) => { const r = await setPublished(ctx, String(a.id), [{}], true); return { publishable: r.publishable, userErrors: r.userErrors as UserError[] }; },
  }),
  publishableUnpublishToCurrentChannel: t.field({
    type: CurrentChannelUnpublish, deprecationReason: 'Use `publishableUnpublish` instead.', args: { id: t.arg.id({ required: true }) },
    resolve: async (_r, a, ctx) => { const r = await setPublished(ctx, String(a.id), [{}], false); return { publishable: r.publishable, userErrors: r.userErrors as UserError[] }; },
  }),
}));
