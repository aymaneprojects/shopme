import {
  bulkCreateVariants, bulkDeleteVariants, bulkUpdateVariants, createOptions, createProduct, createProductMedia, getProduct, getProductByHandle, getProductOptions, getSelectedOptions, listVariants, updateProduct,
  type OptionInput, type Result, type VariantInput,
} from '@shopme/core';
import { parseId } from '@shopme/shopify-compat';
import { builder } from '../builder';
import { requireScope } from '../context';
import { Product_, SEOInput, MetafieldInput, shopOf, defineTypedPayload } from '../types/catalog';
import { InventoryItemInput } from './inventory';
import { BarcodeInput, ProductStatus, ProductVariantInventoryPolicy, VariantOptionValueInput, toProduct, toVariant, type VariantInputShape } from './products';

const OptionValueSetInput = builder.inputType('OptionValueSetInput', { fields: (t) => ({ id: t.id(), name: t.string() }) });
const OptionSetInput = builder.inputType('OptionSetInput', { fields: (t) => ({ id: t.id(), name: t.string(), position: t.int(), values: t.field({ type: [OptionValueSetInput] }) }) });
const ProductSetInventoryInput = builder.inputType('ProductSetInventoryInput', {
  fields: (t) => ({ locationId: t.id({ required: true }), name: t.string({ required: true }), quantity: t.int({ required: true }) }),
});
const FileSetInput = builder.inputType('FileSetInput', {
  fields: (t) => ({ id: t.id(), alt: t.string(), contentType: t.string(), filename: t.string(), originalSource: t.string() }),
});
const ProductVariantSetInput = builder.inputType('ProductVariantSetInput', {
  fields: (t) => ({
    id: t.id(), optionValues: t.field({ type: [VariantOptionValueInput], required: true }), price: t.field({ type: 'Money' }), compareAtPrice: t.field({ type: 'Money' }), sku: t.string(),
    barcode: t.string(), barcodes: t.field({ type: [BarcodeInput] }), taxable: t.boolean(), taxCode: t.string(), inventoryPolicy: t.field({ type: ProductVariantInventoryPolicy }),
    inventoryQuantities: t.field({ type: [ProductSetInventoryInput] }), inventoryItem: t.field({ type: InventoryItemInput }), position: t.int(), metafields: t.field({ type: [MetafieldInput] }),
    file: t.field({ type: FileSetInput }),
  }),
});
const ProductSetInput = builder.inputType('ProductSetInput', {
  fields: (t) => ({
    id: t.id(), title: t.string(), handle: t.string(), descriptionHtml: t.string(), vendor: t.string(), productType: t.string(), tags: t.stringList(), status: t.field({ type: ProductStatus }),
    giftCard: t.boolean(), templateSuffix: t.string(), category: t.id(), seo: t.field({ type: SEOInput }), metafields: t.field({ type: [MetafieldInput] }),
    productOptions: t.field({ type: [OptionSetInput] }), variants: t.field({ type: [ProductVariantSetInput] }), files: t.field({ type: [FileSetInput] }), collections: t.idList(),
  }),
});
const ProductSetIdentifiers = builder.inputType('ProductSetIdentifiers', { fields: (t) => ({ id: t.id(), handle: t.string() }) });
const ProductSetPayload = defineTypedPayload<{ product: import('@shopme/core').Product | null; productSetOperation: null }>('ProductSetPayload', 'ProductSetUserError', (t) => ({
  product: t.field({ type: Product_, nullable: true, resolve: (p) => p.product }),
  productSetOperation: t.field({ type: ProductSetOperation, nullable: true, resolve: () => null }),
}));
const ProductSetOperation = builder.objectRef<{ id: string }>('ProductSetOperation').implement({ fields: (t) => ({ id: t.exposeID('id'), status: t.string({ resolve: () => 'COMPLETE' }) }) });

const ProductChangeStatusPayload = defineTypedPayload<{ product: import('@shopme/core').Product | null }>('ProductChangeStatusPayload', 'ProductChangeStatusUserError', (t) => ({
  product: t.field({ type: Product_, nullable: true, resolve: (p) => p.product }),
}));

/** Variant key: option values joined (case-insensitive), the way productSet matches inputs to existing variants. */
const keyOf = (values: string[]) => values.map((v) => v.trim().toLowerCase()).join('\u0000');

/**
 * `productSet`: create or fully sync a product. Product fields and variants are upserted; variants missing from the input are deleted
 * (on update). Changing the option structure of an existing product is limited to products that have no options yet.
 */
builder.mutationFields((t) => ({
  productSet: t.field({
    type: ProductSetPayload,
    args: { input: t.arg({ type: ProductSetInput, required: true }), synchronous: t.arg.boolean({ defaultValue: true }), identifier: t.arg({ type: ProductSetIdentifiers }) },
    resolve: async (_r, { input, identifier }, ctx) => {
      requireScope(ctx, 'write_products');
      const fail = (field: string[], message: string, code = 'INVALID_INPUT') => ({ product: null, productSetOperation: null, userErrors: [{ field, message, code }] });
      const currency = (await shopOf(ctx)).currency;
      let id: number | null = null;
      if (identifier?.id ?? input.id) { id = parseId(String(identifier?.id ?? input.id), 'Product'); if (!id || !(await getProduct(ctx.db, ctx.shopId, id))) return fail(['input', 'id'], 'Product does not exist', 'NOT_FOUND'); }
      else if (identifier?.handle) id = (await getProductByHandle(ctx.db, ctx.shopId, identifier.handle))?.id ?? null;

      const variants = input.variants ?? [];
      const options = (input.productOptions ?? []).map((o): OptionInput => ({ name: o.name, position: o.position, values: o.values?.map((v) => ({ name: v.name })) }));
      const fields = toProduct({ ...input, id: undefined, collectionsToJoin: input.collections, variants: undefined, files: undefined, productOptions: undefined, productOptionsSet: undefined });
      let res: Result<{ id: number }>;
      if (!id) {
        if (!input.title?.trim()) return fail(['input', 'title'], "Title can't be blank", 'MISSING_FIELD_REQUIRED');
        res = await createProduct(ctx.db, ctx.shopId, { ...fields, productOptions: options.length ? options : undefined });
      } else {
        const hasOptions = (await getProductOptions(ctx.db, ctx.shopId, id)).length > 0;
        if (options.length && !hasOptions) {
          const o = await createOptions(ctx.db, ctx.shopId, id, options, 'LEAVE_AS_IS');
          if (!o.ok) return { product: null, productSetOperation: null, userErrors: o.errors.map((e) => ({ ...e, field: ['input', 'productOptions', ...(e.field?.slice(1) ?? [])] })) };
        }
        res = await updateProduct(ctx.db, ctx.shopId, id, fields);
      }
      if (!res.ok) return { product: null, productSetOperation: null, userErrors: res.errors.map((e) => ({ ...e, field: ['input', ...(e.field ?? [])] })) };
      const pid = res.value.id;

      if (variants.length) {
        const current = await listVariants(ctx.db, ctx.shopId, { productId: pid, offset: 0, limit: 250 });
        const selected = await getSelectedOptions(ctx.db, ctx.shopId, current.map((v) => v.id));
        const byKey = new Map(current.map((v) => [keyOf((selected.get(v.id) ?? []).map((s) => s.value)), v.id]));
        const toCreate: VariantInput[] = [];
        const toUpdate: VariantInput[] = [];
        const kept = new Set<number>();
        for (const [i, v] of variants.entries()) {
          const shape: VariantInputShape = { ...v, inventoryItem: { ...(v.inventoryItem ?? {}), sku: v.sku ?? v.inventoryItem?.sku }, inventoryQuantities: v.inventoryQuantities?.map((q) => ({ availableQuantity: q.quantity, locationId: q.locationId })) };
          const vi = toVariant(shape, currency);
          const explicit = v.id ? parseId(String(v.id), 'ProductVariant') : null;
          const match = explicit ?? byKey.get(keyOf((v.optionValues ?? []).map((o) => o.name ?? ''))) ?? null;
          if (v.id && (!explicit || !current.some((c) => c.id === explicit))) return fail(['input', 'variants', String(i), 'id'], 'Variant does not exist', 'NOT_FOUND');
          if (match) { kept.add(match); toUpdate.push({ ...vi, id: match }); } else toCreate.push(vi);
        }
        if (toUpdate.length) {
          const u = await bulkUpdateVariants(ctx.db, ctx.shopId, pid, toUpdate, false);
          if (!u.ok) return { product: null, productSetOperation: null, userErrors: u.errors.map((e) => ({ ...e, field: ['input', 'variants', ...(e.field?.slice(1) ?? [])] })) };
        }
        if (toCreate.length) {
          const c = await bulkCreateVariants(ctx.db, ctx.shopId, pid, toCreate, 'REMOVE_STANDALONE_VARIANT');
          if (!c.ok) return { product: null, productSetOperation: null, userErrors: c.errors.map((e) => ({ ...e, field: ['input', 'variants', ...(e.field?.slice(1) ?? [])] })) };
          if (c.value.errors.length) return { product: null, productSetOperation: null, userErrors: c.value.errors.map((e) => ({ ...e, field: ['input', 'variants', ...(e.field?.slice(1) ?? [])] })) };
          for (const nv of c.value.variants) kept.add(nv.id);
        }
        const stale = (await listVariants(ctx.db, ctx.shopId, { productId: pid, offset: 0, limit: 250 })).filter((v) => !kept.has(v.id)).map((v) => v.id);
        if (stale.length && kept.size) await bulkDeleteVariants(ctx.db, ctx.shopId, pid, stale);
      }
      if (input.files?.length) {
        const m = await createProductMedia(ctx.db, ctx.shopId, pid, input.files.filter((f) => f.originalSource).map((f) => ({ originalSource: f.originalSource!, alt: f.alt, mediaContentType: 'IMAGE' })));
        if (!m.ok) return { product: null, productSetOperation: null, userErrors: m.errors.map((e) => ({ ...e, field: ['input', 'files', ...(e.field?.slice(1) ?? [])] })) };
      }
      return { product: await getProduct(ctx.db, ctx.shopId, pid), productSetOperation: null, userErrors: [] };
    },
  }),
  productChangeStatus: t.field({
    type: ProductChangeStatusPayload, deprecationReason: 'Use `productUpdate` instead.', args: { productId: t.arg.id({ required: true }), status: t.arg({ type: ProductStatus, required: true }) },
    resolve: async (_r, a, ctx) => {
      requireScope(ctx, 'write_products');
      const id = parseId(String(a.productId), 'Product');
      if (!id || !(await getProduct(ctx.db, ctx.shopId, id))) return { product: null, userErrors: [{ field: ['productId'], message: 'Product could not be found', code: 'PRODUCT_NOT_FOUND' }] };
      const r = await updateProduct(ctx.db, ctx.shopId, id, { status: a.status });
      return r.ok ? { product: r.value, userErrors: [] } : { product: null, userErrors: r.errors };
    },
  }),
}));
