import {
  availableByVariant, bulkCreateVariants, bulkDeleteVariants, bulkUpdateVariants, changeTags, countProductMedia, countProducts, countVariants, createOptions, createProduct, createProductMedia,
  deleteProduct, duplicateProduct, getInventoryItemForVariant, getMedia, getProduct, getProductByHandle, getProductOptions, getProductSummary, getSelectedOptions, getVariant, listProductCollections,
  listProductFilterValues, listProductMedia, listProducts, listVariants, reorderProductMedia, updateProduct,
  type BulkResult, type OptionInput, type Product, type ProductInput as ServiceProductInput, type Result, type Variant, type VariantInput,
} from '@shopme/core';
import { formatMoney, fromGid, parseId, parseMoney, toGid, type UserError } from '@shopme/shopify-compat';
import { GraphQLError } from 'graphql';
import { changeTagsOf } from '../types/sales';
import { builder } from '../builder';
import { requireScope, type GraphQLContext } from '../context';
import { ConnectionArgs, paginate, type PageArgs } from '../types/connection';
import { Node, legacyId, registerNode } from '../types/node';
import { Count, MoneyV2, moneyV2 } from '../types/money';
import {
  Collection_, CollectionConnection, InventoryItem_, Job, MediaConnection, Media_, MetafieldInput, Product_, ProductConnection, ProductOption, ProductOptionValue, ProductVariant, StringConnection,
  ProductVariantConnection, SEO, SEOInput, defineTypedPayload, prefixed, shopOf, typedError,
} from '../types/catalog';
import { definePayload } from '../types/errors';
import { CollectionSortKeys, UniqueMetafieldValueInput } from './collections';
import { CreateMediaInput, Image, imageOf } from './files';
import { InventoryItemInput, toItemUpdate } from './inventory';

const ProductStatus = builder.enumType('ProductStatus', { values: ['ACTIVE', 'ARCHIVED', 'DRAFT'] as const });
const ProductSortKeys = builder.enumType('ProductSortKeys', { values: ['CREATED_AT', 'ID', 'INVENTORY_TOTAL', 'PRODUCT_TYPE', 'PUBLISHED_AT', 'RELEVANCE', 'TITLE', 'UPDATED_AT', 'VENDOR'] as const });
const ProductVariantSortKeys = builder.enumType('ProductVariantSortKeys', {
  values: ['CREATED_AT', 'FULL_TITLE', 'ID', 'INVENTORY_LEVELS_AVAILABLE', 'INVENTORY_MANAGEMENT', 'INVENTORY_POLICY', 'INVENTORY_QUANTITY', 'NAME', 'POPULAR', 'POSITION', 'RELEVANCE', 'SKU', 'TITLE'] as const,
});
const ProductVariantInventoryPolicy = builder.enumType('ProductVariantInventoryPolicy', { values: ['DENY', 'CONTINUE'] as const });
const VariantStrategyCreate = builder.enumType('ProductOptionCreateVariantStrategy', { values: ['LEAVE_AS_IS', 'CREATE'] as const });
const BulkCreateStrategy = builder.enumType('ProductVariantsBulkCreateStrategy', { values: ['DEFAULT', 'REMOVE_STANDALONE_VARIANT', 'PRESERVE_STANDALONE_VARIANT'] as const });

const stripHtml = (s: string) => s.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

/* ------------------------------ Product ------------------------------ */

ProductOptionValue.implement({
  interfaces: [Node],
  fields: (t) => ({ name: t.exposeString('name'), hasVariants: t.exposeBoolean('hasVariants') }),
});
ProductOption.implement({
  interfaces: [Node],
  fields: (t) => ({
    name: t.exposeString('name'),
    position: t.exposeInt('position'),
    values: t.stringList({ resolve: (o) => o.values.map((v) => v.name) }),
    optionValues: t.field({ type: [ProductOptionValue], resolve: (o) => o.values }),
  }),
});

const SelectedOption = builder.objectRef<{ name: string; value: string }>('SelectedOption').implement({
  fields: (t) => ({ name: t.exposeString('name'), value: t.exposeString('value') }),
});
const ProductPriceRangeV2 = builder.objectRef<{ min: number; max: number; currency: string }>('ProductPriceRangeV2').implement({
  fields: (t) => ({
    minVariantPrice: t.field({ type: MoneyV2, resolve: (r) => moneyV2(r.min, r.currency) }),
    maxVariantPrice: t.field({ type: MoneyV2, resolve: (r) => moneyV2(r.max, r.currency) }),
  }),
});

Product_.implement({
  interfaces: [Node],
  fields: (t) => ({
    legacyResourceId: t.field({ type: 'UnsignedInt64', resolve: legacyId }),
    title: t.exposeString('title'),
    handle: t.exposeString('handle'),
    status: t.field({ type: ProductStatus, resolve: (p) => p.status as 'ACTIVE' }),
    vendor: t.exposeString('vendor'),
    productType: t.exposeString('productType'),
    tags: t.stringList({ resolve: (p) => p.tags }),
    descriptionHtml: t.field({ type: 'HTML', resolve: (p) => p.descriptionHtml }),
    description: t.string({ args: { truncateAt: t.arg.int() }, resolve: (p, a) => { const s = stripHtml(p.descriptionHtml); return a.truncateAt ? s.slice(0, a.truncateAt) : s; } }),
    createdAt: t.field({ type: 'DateTime', resolve: (p) => p.createdAt }),
    updatedAt: t.field({ type: 'DateTime', resolve: (p) => p.updatedAt }),
    publishedAt: t.field({ type: 'DateTime', nullable: true, resolve: (p) => p.publishedAt }),
    templateSuffix: t.exposeString('templateSuffix', { nullable: true }),
    isGiftCard: t.exposeBoolean('isGiftCard'),
    seo: t.field({ type: SEO, resolve: (p) => ({ title: p.seoTitle, description: p.seoDescription }) }),
    onlineStoreUrl: t.field({ type: 'URL', nullable: true, resolve: (p, _a, ctx) => (p.status === 'ACTIVE' && p.publishedAt ? `${ctx.app.config.appUrl}/products/${p.handle}` : null) }),
    options: t.field({
      type: [ProductOption], args: { first: t.arg.int() },
      resolve: async (p, a, ctx) => { const o = await getProductOptions(ctx.db, ctx.shopId, p.id); return a.first ? o.slice(0, a.first) : o; },
    }),
    priceRangeV2: t.field({
      type: ProductPriceRangeV2,
      resolve: async (p, _a, ctx) => { const s = await getProductSummary(ctx.db, ctx.shopId, p.id); return { min: s.minPrice, max: s.maxPrice, currency: (await shopOf(ctx)).currency }; },
    }),
    totalInventory: t.int({ resolve: async (p, _a, ctx) => (await getProductSummary(ctx.db, ctx.shopId, p.id)).totalInventory }),
    tracksInventory: t.boolean({ resolve: async (p, _a, ctx) => (await getProductSummary(ctx.db, ctx.shopId, p.id)).tracksInventory }),
    hasOnlyDefaultVariant: t.boolean({
      resolve: async (p, _a, ctx) => {
        const o = await getProductOptions(ctx.db, ctx.shopId, p.id);
        return o.length === 1 && o[0]!.name === 'Title' && o[0]!.values.length === 1 && o[0]!.values[0]!.name === 'Default Title';
      },
    }),
    hasOutOfStockVariants: t.boolean({
      resolve: async (p, _a, ctx) => {
        const vs = await listVariants(ctx.db, ctx.shopId, { productId: p.id, offset: 0, limit: 250 });
        const stock = await availableByVariant(ctx.db, ctx.shopId, vs.map((v) => v.id));
        const items = await Promise.all(vs.map((v) => getInventoryItemForVariant(ctx.db, ctx.shopId, v.id)));
        return vs.some((v, i) => items[i]?.tracked && (stock.get(v.id) ?? 0) <= 0);
      },
    }),
    variantsCount: t.field({ type: Count, nullable: true, resolve: async (p, _a, ctx) => ({ count: await countVariants(ctx.db, ctx.shopId, p.id), precision: 'EXACT' as const }) }),
    mediaCount: t.field({ type: Count, nullable: true, resolve: async (p, _a, ctx) => ({ count: await countProductMedia(ctx.db, ctx.shopId, p.id), precision: 'EXACT' as const }) }),
    featuredMedia: t.field({ type: Media_, nullable: true, resolve: async (p, _a, ctx) => (await listProductMedia(ctx.db, ctx.shopId, p.id, { offset: 0, limit: 1 }))[0] ?? null }),
    media: t.field({
      type: MediaConnection, args: { ...ConnectionArgs, sortKey: t.arg.string({ defaultValue: 'POSITION' }), query: t.arg.string() },
      resolve: (p, a, ctx) => paginate(a, {
        fetch: ({ offset, limit }) => listProductMedia(ctx.db, ctx.shopId, p.id, { reverse: !!a.reverse, offset, limit }),
        total: () => countProductMedia(ctx.db, ctx.shopId, p.id),
      }),
    }),
    variants: t.field({
      type: ProductVariantConnection, args: { ...ConnectionArgs, sortKey: t.arg({ type: ProductVariantSortKeys, defaultValue: 'POSITION' }) },
      resolve: (p, a, ctx) => paginate(a, {
        fetch: ({ offset, limit }) => listVariants(ctx.db, ctx.shopId, { productId: p.id, sortKey: a.sortKey, reverse: !!a.reverse, offset, limit }),
        total: () => countVariants(ctx.db, ctx.shopId, p.id),
      }),
    }),
    collections: t.field({
      type: CollectionConnection, args: { ...ConnectionArgs, sortKey: t.arg({ type: CollectionSortKeys, defaultValue: 'ID' }), query: t.arg.string() },
      resolve: (p, a, ctx) => {
        const fetch = (offset: number, limit: number) => listProductCollections(ctx.db, ctx.shopId, p.id, { query: a.query, reverse: !!a.reverse, offset, limit });
        return paginate(a, { fetch: ({ offset, limit }) => fetch(offset, limit), total: async () => (await fetch(0, 10000)).length });
      },
    }),
  }),
});
registerNode('Product', (ctx, id) => getProduct(ctx.db, ctx.shopId, id));
registerNode('ProductVariant', (ctx, id) => getVariant(ctx.db, ctx.shopId, id));
registerNode('ProductOption', async () => null);

/* ------------------------------ ProductVariant ------------------------------ */

ProductVariant.implement({
  interfaces: [Node],
  fields: (t) => ({
    legacyResourceId: t.field({ type: 'UnsignedInt64', resolve: legacyId }),
    title: t.exposeString('title'),
    displayName: t.string({ resolve: async (v, _a, ctx) => { const p = await getProduct(ctx.db, ctx.shopId, v.productId); return v.title === 'Default Title' ? p!.title : `${p!.title} - ${v.title}`; } }),
    sku: t.exposeString('sku', { nullable: true }),
    barcode: t.exposeString('barcode', { nullable: true, deprecationReason: 'Use `barcodes` instead.' }),
    price: t.field({ type: 'Money', resolve: async (v, _a, ctx) => formatMoney(v.price, (await shopOf(ctx)).currency) }),
    compareAtPrice: t.field({ type: 'Money', nullable: true, resolve: async (v, _a, ctx) => (v.compareAtPrice == null ? null : formatMoney(v.compareAtPrice, (await shopOf(ctx)).currency)) }),
    position: t.exposeInt('position'),
    taxable: t.exposeBoolean('taxable'),
    inventoryPolicy: t.field({ type: ProductVariantInventoryPolicy, resolve: (v) => v.inventoryPolicy as 'DENY' }),
    inventoryQuantity: t.int({ nullable: true, resolve: async (v, _a, ctx) => (await availableByVariant(ctx.db, ctx.shopId, [v.id])).get(v.id) ?? 0 }),
    availableForSale: t.boolean({
      resolve: async (v, _a, ctx) => {
        if (v.inventoryPolicy === 'CONTINUE') return true;
        const item = await getInventoryItemForVariant(ctx.db, ctx.shopId, v.id);
        return !item?.tracked || ((await availableByVariant(ctx.db, ctx.shopId, [v.id])).get(v.id) ?? 0) > 0;
      },
    }),
    selectedOptions: t.field({ type: [SelectedOption], resolve: async (v, _a, ctx) => ((await getSelectedOptions(ctx.db, ctx.shopId, [v.id])).get(v.id) ?? []).map((s) => ({ name: s.name, value: s.value })) }),
    image: t.field({
      type: Image, nullable: true, deprecationReason: 'Use `media` instead.',
      args: { maxWidth: t.arg.int(), maxHeight: t.arg.int(), scale: t.arg.int({ defaultValue: 1 }) },
      resolve: async (v, _a, ctx) => { const m = v.mediaId ? await getMedia(ctx.db, ctx.shopId, v.mediaId) : null; return m ? imageOf(ctx, m) : null; },
    }),
    media: t.field({
      type: MediaConnection, args: { ...ConnectionArgs },
      resolve: async (v, a, ctx) => { const m = v.mediaId ? await getMedia(ctx.db, ctx.shopId, v.mediaId) : null; return paginate(a, { fetch: async ({ offset, limit }) => (m ? [m] : []).slice(offset, offset + limit), total: async () => (m ? 1 : 0) }); },
    }),
    inventoryItem: t.field({ type: InventoryItem_, resolve: async (v, _a, ctx) => (await getInventoryItemForVariant(ctx.db, ctx.shopId, v.id))! }),
    product: t.field({ type: Product_, resolve: async (v, _a, ctx) => (await getProduct(ctx.db, ctx.shopId, v.productId))! }),
    createdAt: t.field({ type: 'DateTime', resolve: (v) => v.createdAt }),
    updatedAt: t.field({ type: 'DateTime', resolve: (v) => v.updatedAt }),
  }),
});

/* ------------------------------ inputs ------------------------------ */

const OptionValueCreateInput = builder.inputType('OptionValueCreateInput', { fields: (t) => ({ name: t.string(), linkedMetafieldValue: t.string() }) });
const OptionCreateInput = builder.inputType('OptionCreateInput', { fields: (t) => ({ name: t.string(), position: t.int(), values: t.field({ type: [OptionValueCreateInput] }) }) });
const VariantOptionValueInput = builder.inputType('VariantOptionValueInput', {
  fields: (t) => ({ id: t.id(), name: t.string(), linkedMetafieldValue: t.string(), optionId: t.id(), optionName: t.string() }),
});
const BarcodeInput = builder.inputType('BarcodeInput', { fields: (t) => ({ value: t.string({ required: true }), type: t.string() }) });
const InventoryLevelInput = builder.inputType('InventoryLevelInput', { fields: (t) => ({ availableQuantity: t.int({ required: true }), locationId: t.id({ required: true }) }) });
const ProductVariantsBulkInput = builder.inputType('ProductVariantsBulkInput', {
  fields: (t) => ({
    barcode: t.string({ deprecationReason: 'Use `barcodes` instead.' }), barcodes: t.field({ type: [BarcodeInput] }), compareAtPrice: t.field({ type: 'Money' }), id: t.id(),
    inventoryPolicy: t.field({ type: ProductVariantInventoryPolicy }), inventoryQuantities: t.field({ type: [InventoryLevelInput] }), inventoryItem: t.field({ type: InventoryItemInput }),
    mediaId: t.id(), metafields: t.field({ type: [MetafieldInput] }), optionValues: t.field({ type: [VariantOptionValueInput] }), price: t.field({ type: 'Money' }),
    taxable: t.boolean(), taxCode: t.string(),
  }),
});

const productInputFields = (t: any) => ({
  descriptionHtml: t.string(), handle: t.string(), seo: t.field({ type: SEOInput }), productType: t.string(), tags: t.stringList(), templateSuffix: t.string(),
  giftCardTemplateSuffix: t.string(), title: t.string(), vendor: t.string(), category: t.id(), collectionsToJoin: t.idList(), metafields: t.field({ type: [MetafieldInput] }),
  status: t.field({ type: ProductStatus }),
});
const ProductCreateInput = builder.inputType('ProductCreateInput', {
  fields: (t) => ({ ...productInputFields(t), giftCard: t.boolean(), productOptions: t.field({ type: [OptionCreateInput] }) }),
});
const ProductUpdateInput = builder.inputType('ProductUpdateInput', {
  fields: (t) => ({ ...productInputFields(t), redirectNewHandle: t.boolean(), id: t.id(), collectionsToLeave: t.idList() }),
});
/** Deprecated `input:` form. */
const ProductInput = builder.inputType('ProductInput', {
  fields: (t) => ({ ...productInputFields(t), giftCard: t.boolean(), redirectNewHandle: t.boolean(), collectionsToLeave: t.idList(), id: t.id(), productOptions: t.field({ type: [OptionCreateInput] }) }),
});
const ProductDeleteInput = builder.inputType('ProductDeleteInput', { fields: (t) => ({ id: t.id({ required: true }) }) });
const ProductIdentifierInput = builder.inputType('ProductIdentifierInput', { fields: (t) => ({ id: t.id(), customId: t.field({ type: UniqueMetafieldValueInput }), handle: t.string() }) });
const ProductUpdateIdentifiers = builder.inputType('ProductUpdateIdentifiers', { fields: (t) => ({ id: t.id(), customId: t.field({ type: UniqueMetafieldValueInput }), handle: t.string() }) });

/* ------------------------------ input mapping ------------------------------ */

const ids = (xs: (string | number)[] | null | undefined, type: string) => xs?.map((x) => parseId(String(x), type)).filter((x): x is number => x !== null);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const toProduct = (i: any): ServiceProductInput => ({
  ...i,
  collectionsToJoin: ids(i.collectionsToJoin, 'Collection'), collectionsToLeave: ids(i.collectionsToLeave, 'Collection'),
  metafields: i.metafields?.map((m: { namespace?: string | null; key?: string | null; value?: string | null; type?: string | null }) => ({ ownerType: 'PRODUCT', ownerId: 0, namespace: m.namespace, key: m.key ?? '', value: m.value ?? '', type: m.type })),
  productOptions: i.productOptions as OptionInput[] | null | undefined,
});

type MoneyIn = string | null | undefined;
function minor(v: MoneyIn, currency: string): number | null | undefined {
  if (v == null) return v as null | undefined;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new GraphQLError(`Invalid money amount: ${v}`);
  return parseMoney(v, currency);
}

interface VariantInputShape {
  id?: string | number | null; price?: MoneyIn; compareAtPrice?: MoneyIn; barcode?: string | null; barcodes?: { value: string }[] | null; taxable?: boolean | null; taxCode?: string | null;
  inventoryPolicy?: string | null; mediaId?: string | number | null; optionValues?: { id?: string | number | null; name?: string | null; optionId?: string | number | null; optionName?: string | null }[] | null;
  inventoryItem?: Parameters<typeof toItemUpdate>[0]; inventoryQuantities?: { availableQuantity: number; locationId: string | number }[] | null;
  metafields?: { namespace?: string | null; key?: string | null; value?: string | null; type?: string | null }[] | null;
}
function toVariant(v: VariantInputShape, currency: string): VariantInput {
  return {
    id: v.id ? parseId(String(v.id), 'ProductVariant') : null,
    price: minor(v.price, currency), compareAtPrice: minor(v.compareAtPrice, currency),
    barcode: v.barcodes?.[0]?.value ?? v.barcode, taxable: v.taxable, taxCode: v.taxCode, inventoryPolicy: v.inventoryPolicy,
    mediaId: v.mediaId ? parseId(String(v.mediaId), 'MediaImage') : v.mediaId === null ? null : undefined,
    optionValues: v.optionValues?.map((o) => ({ id: o.id ? parseId(String(o.id), 'ProductOptionValue') : null, name: o.name, optionId: o.optionId ? parseId(String(o.optionId), 'ProductOption') : null, optionName: o.optionName })),
    inventoryItem: toItemUpdate(v.inventoryItem, currency),
    inventoryQuantities: v.inventoryQuantities?.map((q) => ({ availableQuantity: q.availableQuantity, locationId: parseId(String(q.locationId), 'Location') ?? 0 })),
    metafields: v.metafields?.map((m) => ({ ownerType: 'PRODUCTVARIANT', ownerId: 0, namespace: m.namespace, key: m.key ?? '', value: m.value ?? '', type: m.type })),
  };
}

/* ------------------------------ payloads ------------------------------ */

type MediaRow = import('@shopme/core').Media;
const ProductCreatePayload = definePayload<{ product: Product | null }>('ProductCreatePayload', (t) => ({ product: t.field({ type: Product_, nullable: true, resolve: (p) => p.product }) }));
const ProductUpdatePayload = definePayload<{ product: Product | null }>('ProductUpdatePayload', (t) => ({ product: t.field({ type: Product_, nullable: true, resolve: (p) => p.product }) }));
const ProductDeletePayload = definePayload<{ deletedProductId: string | null }>('ProductDeletePayload', (t) => ({ deletedProductId: t.id({ nullable: true, resolve: (p) => p.deletedProductId }) }));
const ProductDuplicatePayload = definePayload<{ newProduct: Product | null }>('ProductDuplicatePayload', (t) => ({ newProduct: t.field({ type: Product_, nullable: true, resolve: (p) => p.newProduct }) }));
const OptionsCreatePayload = defineTypedPayload<{ product: Product | null }>('ProductOptionsCreatePayload', 'ProductOptionsCreateUserError', (t) => ({ product: t.field({ type: Product_, nullable: true, resolve: (p) => p.product }) }));
const bulkPayload = (name: string, err: 'ProductVariantsBulkCreateUserError' | 'ProductVariantsBulkUpdateUserError') => defineTypedPayload<{ product: Product | null; productVariants: Variant[] | null }>(name, err, (t) => ({
  product: t.field({ type: Product_, nullable: true, resolve: (p) => p.product }),
  productVariants: t.field({ type: [ProductVariant], nullable: true, resolve: (p) => p.productVariants }),
}));
const BulkCreatePayload = bulkPayload('ProductVariantsBulkCreatePayload', 'ProductVariantsBulkCreateUserError');
const BulkUpdatePayload = bulkPayload('ProductVariantsBulkUpdatePayload', 'ProductVariantsBulkUpdateUserError');
const BulkDeletePayload = defineTypedPayload<{ product: Product | null }>('ProductVariantsBulkDeletePayload', 'ProductVariantsBulkDeleteUserError', (t) => ({ product: t.field({ type: Product_, nullable: true, resolve: (p) => p.product }) }));
const CreateMediaPayload = definePayload<{ product: Product | null; media: MediaRow[] | null; mediaUserErrors: UserError[] }>('ProductCreateMediaPayload', (t) => ({
  product: t.field({ type: Product_, nullable: true, resolve: (p) => p.product }),
  media: t.field({ type: [Media_], nullable: true, resolve: (p) => p.media }),
  mediaUserErrors: t.field({ type: [typedMediaError()], resolve: (p) => p.mediaUserErrors }),
}));
const TagsPayload = (name: string) => definePayload<{ node: unknown }>(name, (t) => ({ node: t.field({ type: Node, nullable: true, resolve: (p) => p.node as never }) }));
const TagsAddPayload = TagsPayload('TagsAddPayload');
const TagsRemovePayload = TagsPayload('TagsRemovePayload');
const MoveInput = builder.inputType('MoveInput', {
  fields: (t) => ({ id: t.id({ required: true }), newPosition: t.field({ type: 'UnsignedInt64', required: true }) }),
});
const ReorderMediaPayload = definePayload<{ job: { id: string; done: boolean } | null; mediaUserErrors: UserError[] }>('ProductReorderMediaPayload', (t) => ({
  job: t.field({ type: Job, nullable: true, resolve: (p) => p.job }),
  mediaUserErrors: t.field({ type: [typedMediaError()], resolve: (p) => p.mediaUserErrors }),
}));

function typedMediaError() { return typedError('MediaUserError'); }

/* ------------------------------ queries ------------------------------ */

/** Distinct non-empty product types / vendors / tags (Shopify Admin API `productTypes` etc.), one page at a time. */
function filterValues(ctx: GraphQLContext, field: 'productType' | 'vendor' | 'tag', a: PageArgs) {
  requireScope(ctx, 'read_products');
  return paginate(a, { fetch: ({ offset, limit }) => listProductFilterValues(ctx.db, ctx.shopId, field, { offset, limit }) });
}

builder.queryFields((t) => ({
  productTypes: t.field({
    type: StringConnection, args: { first: t.arg.int({ required: true }), after: t.arg.string() },
    resolve: (_r, a, ctx) => filterValues(ctx, 'productType', a),
  }),
  productVendors: t.field({
    type: StringConnection, args: { first: t.arg.int({ required: true }), after: t.arg.string() },
    resolve: (_r, a, ctx) => filterValues(ctx, 'vendor', a),
  }),
  productTags: t.field({
    type: StringConnection, args: { first: t.arg.int({ required: true }), after: t.arg.string() },
    resolve: (_r, a, ctx) => filterValues(ctx, 'tag', a),
  }),
  product: t.field({
    type: Product_, nullable: true, args: { id: t.arg.id({ required: true }) },
    resolve: (_r, a, ctx) => { requireScope(ctx, 'read_products'); const id = parseId(String(a.id), 'Product'); return id ? getProduct(ctx.db, ctx.shopId, id) : null; },
  }),
  productByHandle: t.field({
    type: Product_, nullable: true, deprecationReason: 'Use `productByIdentifier` instead.', args: { handle: t.arg.string({ required: true }) },
    resolve: (_r, a, ctx) => { requireScope(ctx, 'read_products'); return getProductByHandle(ctx.db, ctx.shopId, a.handle); },
  }),
  productByIdentifier: t.field({
    type: Product_, nullable: true, args: { identifier: t.arg({ type: ProductIdentifierInput, required: true }) },
    resolve: (_r, { identifier }, ctx) => {
      requireScope(ctx, 'read_products');
      if (identifier.id) { const id = parseId(String(identifier.id), 'Product'); return id ? getProduct(ctx.db, ctx.shopId, id) : null; }
      return identifier.handle ? getProductByHandle(ctx.db, ctx.shopId, identifier.handle) : null;
    },
  }),
  products: t.field({
    type: ProductConnection, args: { ...ConnectionArgs, sortKey: t.arg({ type: ProductSortKeys, defaultValue: 'ID' }), query: t.arg.string(), savedSearchId: t.arg.id() },
    resolve: (_r, a, ctx) => {
      requireScope(ctx, 'read_products');
      return paginate(a, {
        fetch: ({ offset, limit }) => listProducts(ctx.db, ctx.shopId, { query: a.query, sortKey: a.sortKey, reverse: !!a.reverse, offset, limit }),
        total: async () => (await countProducts(ctx.db, ctx.shopId, a.query)).count,
      });
    },
  }),
  productsCount: t.field({
    type: Count, nullable: true, args: { query: t.arg.string(), savedSearchId: t.arg.id(), limit: t.arg.int({ defaultValue: 10000 }) },
    resolve: (_r, a, ctx) => { requireScope(ctx, 'read_products'); return countProducts(ctx.db, ctx.shopId, a.query, a.limit ?? 10000); },
  }),
  productVariant: t.field({
    type: ProductVariant, nullable: true, args: { id: t.arg.id({ required: true }) },
    resolve: (_r, a, ctx) => { requireScope(ctx, 'read_products'); const id = parseId(String(a.id), 'ProductVariant'); return id ? getVariant(ctx.db, ctx.shopId, id) : null; },
  }),
  productVariants: t.field({
    type: ProductVariantConnection, args: { ...ConnectionArgs, sortKey: t.arg({ type: ProductVariantSortKeys, defaultValue: 'ID' }), query: t.arg.string(), savedSearchId: t.arg.id() },
    resolve: (_r, a, ctx) => {
      requireScope(ctx, 'read_products');
      const fetch = (offset: number, limit: number) => listVariants(ctx.db, ctx.shopId, { query: a.query, sortKey: a.sortKey, reverse: !!a.reverse, offset, limit });
      return paginate(a, { fetch: ({ offset, limit }) => fetch(offset, limit), total: async () => (await fetch(0, 100000)).length });
    },
  }),
}));

/* ------------------------------ mutations ------------------------------ */

const asProduct = async (ctx: GraphQLContext, r: Result<unknown>, id: number) => (r.ok ? getProduct(ctx.db, ctx.shopId, id) : null);

const parsePid = (v: string | number) => parseId(String(v), 'Product');
const noProduct = (field: string[]) => [{ field, message: 'Product does not exist', code: 'PRODUCT_DOES_NOT_EXIST' }];

builder.mutationFields((t) => ({
  productCreate: t.field({
    type: ProductCreatePayload,
    args: { input: t.arg({ type: ProductInput, deprecationReason: 'Use `product` instead.' }), product: t.arg({ type: ProductCreateInput }), media: t.arg({ type: [CreateMediaInput] }) },
    resolve: async (_r, a, ctx) => {
      requireScope(ctx, 'write_products');
      const src = a.product ?? a.input;
      const root = a.product ? 'product' : 'input';
      if (!src) return { product: null, userErrors: [{ field: [root], message: 'A product is required.' }] };
      const r = await createProduct(ctx.db, ctx.shopId, toProduct(src), a.media ?? []);
      return r.ok ? { product: r.value, userErrors: [] } : { product: null, userErrors: prefixed(r.errors, [root]) };
    },
  }),
  productUpdate: t.field({
    type: ProductUpdatePayload,
    args: { input: t.arg({ type: ProductInput, deprecationReason: 'Use `product` instead.' }), product: t.arg({ type: ProductUpdateInput }), media: t.arg({ type: [CreateMediaInput] }), identifier: t.arg({ type: ProductUpdateIdentifiers }) },
    resolve: async (_r, a, ctx) => {
      requireScope(ctx, 'write_products');
      const src = a.product ?? a.input;
      const root = a.product ? 'product' : 'input';
      if (!src) return { product: null, userErrors: [{ field: [root], message: 'A product is required.' }] };
      let id: number | null = null;
      if (a.identifier?.handle) id = (await getProductByHandle(ctx.db, ctx.shopId, a.identifier.handle))?.id ?? null;
      else id = parsePid(a.identifier?.id ?? src.id ?? '');
      if (!id) return { product: null, userErrors: [{ field: [root, 'id'], message: 'Product does not exist' }] };
      const r = await updateProduct(ctx.db, ctx.shopId, id, toProduct(src), a.media ?? []);
      return r.ok ? { product: r.value, userErrors: [] } : { product: null, userErrors: prefixed(r.errors, [root]) };
    },
  }),
  productDelete: t.field({
    type: ProductDeletePayload, args: { input: t.arg({ type: ProductDeleteInput, required: true }), synchronous: t.arg.boolean({ defaultValue: true }) },
    resolve: async (_r, { input }, ctx) => {
      requireScope(ctx, 'write_products');
      const id = parsePid(input.id);
      const r = id ? await deleteProduct(ctx.db, ctx.shopId, id) : null;
      return r?.ok ? { deletedProductId: toGid('Product', id!), userErrors: [] } : { deletedProductId: null, userErrors: [{ field: ['id'], message: 'Product does not exist' }] };
    },
  }),
  productDuplicate: t.field({
    type: ProductDuplicatePayload,
    args: { productId: t.arg.id({ required: true }), newTitle: t.arg.string({ required: true }), newStatus: t.arg({ type: ProductStatus }), includeImages: t.arg.boolean({ defaultValue: false }), includeTranslations: t.arg.boolean({ defaultValue: false }), synchronous: t.arg.boolean({ defaultValue: true }) },
    resolve: async (_r, a, ctx) => {
      requireScope(ctx, 'write_products');
      const id = parsePid(a.productId);
      if (!id) return { newProduct: null, userErrors: [{ field: ['productId'], message: 'Product does not exist' }] };
      const r = await duplicateProduct(ctx.db, ctx.shopId, id, { newTitle: a.newTitle, newStatus: a.newStatus, includeImages: a.includeImages });
      return r.ok ? { newProduct: r.value, userErrors: [] } : { newProduct: null, userErrors: prefixed(r.errors, []) };
    },
  }),
  productOptionsCreate: t.field({
    type: OptionsCreatePayload,
    args: { productId: t.arg.id({ required: true }), options: t.arg({ type: [OptionCreateInput], required: true }), variantStrategy: t.arg({ type: VariantStrategyCreate, defaultValue: 'LEAVE_AS_IS' }) },
    resolve: async (_r, a, ctx) => {
      requireScope(ctx, 'write_products');
      const id = parsePid(a.productId);
      if (!id) return { product: null, userErrors: noProduct(['productId']) };
      const r = await createOptions(ctx.db, ctx.shopId, id, a.options as OptionInput[], a.variantStrategy ?? 'LEAVE_AS_IS');
      return r.ok ? { product: r.value, userErrors: [] } : { product: null, userErrors: r.errors };
    },
  }),
  productVariantsBulkCreate: t.field({
    type: BulkCreatePayload,
    args: { variants: t.arg({ type: [ProductVariantsBulkInput], required: true }), productId: t.arg.id({ required: true }), media: t.arg({ type: [CreateMediaInput] }), strategy: t.arg({ type: BulkCreateStrategy, defaultValue: 'DEFAULT' }) },
    resolve: async (_r, a, ctx) => {
      requireScope(ctx, 'write_products');
      const id = parsePid(a.productId);
      if (!id) return { product: null, productVariants: null, userErrors: noProduct(['productId']) };
      const cur = (await shopOf(ctx)).currency;
      const r = await bulkCreateVariants(ctx.db, ctx.shopId, id, a.variants.map((v) => toVariant(v, cur)), a.strategy ?? 'DEFAULT');
      return bulkOut(ctx, r, id);
    },
  }),
  productVariantsBulkUpdate: t.field({
    type: BulkUpdatePayload,
    args: { variants: t.arg({ type: [ProductVariantsBulkInput], required: true }), productId: t.arg.id({ required: true }), media: t.arg({ type: [CreateMediaInput] }), allowPartialUpdates: t.arg.boolean({ defaultValue: false }) },
    resolve: async (_r, a, ctx) => {
      requireScope(ctx, 'write_products');
      const id = parsePid(a.productId);
      if (!id) return { product: null, productVariants: null, userErrors: noProduct(['productId']) };
      const cur = (await shopOf(ctx)).currency;
      const r = await bulkUpdateVariants(ctx.db, ctx.shopId, id, a.variants.map((v) => toVariant(v, cur)), !!a.allowPartialUpdates);
      return bulkOut(ctx, r, id);
    },
  }),
  productVariantsBulkDelete: t.field({
    type: BulkDeletePayload, args: { variantsIds: t.arg.idList({ required: true }), productId: t.arg.id({ required: true }) },
    resolve: async (_r, a, ctx) => {
      requireScope(ctx, 'write_products');
      const id = parsePid(a.productId);
      if (!id) return { product: null, userErrors: noProduct(['productId']) };
      const vids = ids(a.variantsIds, 'ProductVariant') ?? [];
      if (vids.length !== a.variantsIds.length) return { product: null, userErrors: [{ field: ['variantsIds'], message: 'At least one variant does not belong to the product', code: 'AT_LEAST_ONE_VARIANT_DOES_NOT_BELONG_TO_THE_PRODUCT' }] };
      const r = await bulkDeleteVariants(ctx.db, ctx.shopId, id, vids);
      return r.ok ? { product: r.value, userErrors: [] } : { product: await asProduct(ctx, r, id), userErrors: r.errors };
    },
  }),
  productCreateMedia: t.field({
    type: CreateMediaPayload, deprecationReason: 'Use `productUpdate` or `productSet` instead.', args: { productId: t.arg.id({ required: true }), media: t.arg({ type: [CreateMediaInput], required: true }) },
    resolve: async (_r, a, ctx) => {
      requireScope(ctx, 'write_products');
      const id = parsePid(a.productId);
      const r = id ? await createProductMedia(ctx.db, ctx.shopId, id, a.media) : null;
      if (r?.ok) return { product: await getProduct(ctx.db, ctx.shopId, id!), media: r.value, mediaUserErrors: [], userErrors: [] };
      const errors = r && !r.ok ? r.errors : noProduct(['productId']);
      return { product: null, media: null, mediaUserErrors: errors.map((e) => ({ ...e, code: 'INVALID' })), userErrors: errors };
    },
  }),
  productReorderMedia: t.field({
    type: ReorderMediaPayload, args: { id: t.arg.id({ required: true }), moves: t.arg({ type: [MoveInput], required: true }) },
    resolve: async (_r, a, ctx) => {
      requireScope(ctx, 'write_products');
      const id = parsePid(a.id);
      if (!id) return { job: null, mediaUserErrors: [], userErrors: noProduct(['id']) };
      const moves = a.moves.map((m) => ({
        mediaId: ['MediaImage', 'Video', 'ExternalVideo', 'Model3d'].map((type) => parseId(String(m.id), type)).find((n) => n != null) ?? null,
        newPosition: String(m.newPosition),
      }));
      const r = await reorderProductMedia(ctx.db, ctx.shopId, id, moves);
      if (r.ok) return { job: null, mediaUserErrors: [], userErrors: [] };
      return {
        job: null,
        mediaUserErrors: r.errors.filter((e) => e.field?.[0] !== 'id'),
        userErrors: r.errors.filter((e) => e.field?.[0] === 'id'),
      };
    },
  }),
  tagsAdd: t.field({ type: TagsAddPayload, args: { id: t.arg.id({ required: true }), tags: t.arg.stringList({ required: true }) }, resolve: (_r, a, ctx) => tagsMutation(ctx, a.id, a.tags, 'add') }),
  tagsRemove: t.field({ type: TagsRemovePayload, args: { id: t.arg.id({ required: true }), tags: t.arg.stringList({ required: true }) }, resolve: (_r, a, ctx) => tagsMutation(ctx, a.id, a.tags, 'remove') }),
}));

async function bulkOut(ctx: GraphQLContext, r: Result<BulkResult>, productId: number) {
  const product = await getProduct(ctx.db, ctx.shopId, productId);
  return r.ok ? { product, productVariants: r.value.variants, userErrors: r.value.errors } : { product: null, productVariants: null, userErrors: r.errors };
}

async function tagsMutation(ctx: GraphQLContext, rawId: string | number, tags: string[], mode: 'add' | 'remove') {
  const gid = fromGid(String(rawId));
  if (!gid || gid.type !== 'Product') {
    // Orders and customers register themselves in types/sales.ts.
    return (await changeTagsOf(ctx, String(rawId), tags, mode)) ?? { node: null, userErrors: [{ field: ['id'], message: 'Resource not found or does not support tags' }] };
  }
  requireScope(ctx, 'write_products');
  const r = await changeTags(ctx.db, ctx.shopId, gid.id, mode, tags);
  return r.ok ? { node: Object.assign({}, r.value, { __typename: 'Product' }), userErrors: [] } : { node: null, userErrors: r.errors };
}
