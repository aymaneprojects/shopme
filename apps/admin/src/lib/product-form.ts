import type { GalleryItem } from '@shopme/ui';
import { mutate } from '../api';
import { parseDecimal, toDecimalString } from '../format';
import {
  INVENTORY_SET_QUANTITIES, PRODUCT_CREATE, PRODUCT_OPTIONS_CREATE, PRODUCT_REORDER_MEDIA, PRODUCT_UPDATE,
  VARIANTS_BULK_CREATE, VARIANTS_BULK_DELETE, VARIANTS_BULK_UPDATE,
} from '../graphql';
import { blankVariant, cleanOptions } from './variants';
import type { OptionDef, VariantDraft, WeightUnit } from './variants';

export interface LocationRef { id: string; name: string }
export interface CollectionRef { id: string; title: string }

export interface ProductForm {
  title: string; descriptionHtml: string; status: 'ACTIVE' | 'DRAFT' | 'ARCHIVED';
  vendor: string; productType: string; tags: string[]; templateSuffix: string; handle: string;
  /** Taxonomy category GID, or empty. */
  category: string;
  seoTitle: string; seoDescription: string;
  options: OptionDef[]; variants: VariantDraft[];
  media: GalleryItem[]; collections: CollectionRef[];
}

/** Shape of the `product(id:)` query (see graphql/products.ts). */
export interface ApiProduct {
  id: string; title: string; handle: string; descriptionHtml: string; status: ProductForm['status']; vendor: string; productType: string;
  tags: string[]; templateSuffix: string | null; updatedAt: string; onlineStorePreviewUrl?: string | null;
  category?: { id: string; fullName: string } | null;
  seo: { title: string | null; description: string | null };
  options: Array<{ id: string; name: string; values: string[] }>;
  media: { nodes: Array<{ id: string; alt: string | null; image?: { url: string } }> };
  collections: { nodes: Array<{ id: string; title: string; ruleSet: unknown }> };
  variants: { nodes: ApiVariant[] };
}
export interface ApiVariant {
  id: string; title: string; sku: string | null; barcode: string | null; price: string; compareAtPrice: string | null; taxable: boolean; inventoryPolicy: 'DENY' | 'CONTINUE';
  selectedOptions: Array<{ name: string; value: string }>;
  media?: { nodes: Array<{ id: string }> };
  unitPriceMeasurement?: { quantityValue: number; quantityUnit: string; referenceValue: number; referenceUnit: string } | null;
  inventoryItem: {
    id: string; tracked: boolean; requiresShipping: boolean; unitCost: { amount: string } | null; measurement: { weight: { unit: WeightUnit; value: number } | null } | null;
    inventoryLevels: { nodes: Array<{ location: { id: string }; quantities: Array<{ name: string; quantity: number }> }> };
  };
}

export const isPersistedMedia = (i: GalleryItem) => i.key.startsWith('gid://');

export function emptyForm(locations: LocationRef[]): ProductForm {
  return {
    title: '', descriptionHtml: '', status: 'DRAFT', vendor: '', productType: '', tags: [], templateSuffix: '', handle: '', category: '', seoTitle: '', seoDescription: '',
    options: [], variants: [blankVariant({ quantities: Object.fromEntries(locations.map((l) => [l.id, '0'])) })], media: [], collections: [],
  };
}

export function formFromProduct(p: ApiProduct, locations: LocationRef[]): ProductForm {
  const defaultTitle = p.options.length === 1 && p.options[0]!.name === 'Title' && p.options[0]!.values[0] === 'Default Title';
  const options = defaultTitle ? [] : p.options.map((o) => ({ id: o.id, name: o.name, values: o.values }));
  const variants = p.variants.nodes.map((v): VariantDraft => {
    const levels = Object.fromEntries(locations.map((l) => [l.id, '0']));
    for (const lv of v.inventoryItem.inventoryLevels.nodes) levels[lv.location.id] = String(lv.quantities.find((q) => q.name === 'available')?.quantity ?? 0);
    const w = v.inventoryItem.measurement?.weight;
    const u = v.unitPriceMeasurement;
    return {
      key: v.id, id: v.id, inventoryItemId: v.inventoryItem.id,
      optionValues: defaultTitle ? [] : options.map((o) => v.selectedOptions.find((s) => s.name === o.name)?.value ?? ''),
      price: v.price, compareAtPrice: v.compareAtPrice ?? '', cost: v.inventoryItem.unitCost?.amount ?? '', sku: v.sku ?? '', barcode: v.barcode ?? '',
      taxable: v.taxable, tracked: v.inventoryItem.tracked, continueSelling: v.inventoryPolicy === 'CONTINUE', requiresShipping: v.inventoryItem.requiresShipping,
      weight: w ? String(w.value) : '', weightUnit: w?.unit ?? 'KILOGRAMS', quantities: levels, mediaId: v.media?.nodes[0]?.id ?? '',
      unitQuantity: u ? String(u.quantityValue) : '', unitQuantityUnit: u?.quantityUnit || 'L', unitReference: u ? String(u.referenceValue) : '1', unitReferenceUnit: u?.referenceUnit || 'L',
    };
  });
  return {
    title: p.title, descriptionHtml: p.descriptionHtml, status: p.status === 'ARCHIVED' || p.status === 'ACTIVE' ? p.status : 'DRAFT',
    vendor: p.vendor, productType: p.productType, tags: p.tags, templateSuffix: p.templateSuffix ?? '', handle: p.handle, category: p.category?.id ?? '',
    seoTitle: p.seo.title ?? '', seoDescription: p.seo.description ?? '', options, variants,
    media: p.media.nodes.filter((m) => m.image).map((m) => ({ key: m.id, url: m.image!.url, alt: m.alt ?? '' })),
    collections: p.collections.nodes.filter((c) => !c.ruleSet).map((c) => ({ id: c.id, title: c.title })),
  };
}

/** Client-side validation. Returns field -> message keys. */
export function validate(f: ProductForm): Record<string, 'title' | 'price'> {
  const errors: Record<string, 'title' | 'price'> = {};
  if (!f.title.trim()) errors.title = 'title';
  if (f.variants.some((v) => { const n = parseDecimal(v.price); return n === null || n < 0; })) errors.price = 'price';
  return errors;
}

const dec = (s: string) => toDecimalString(parseDecimal(s));
const absolute = (url: string) => new URL(url, window.location.origin).href;

/** Unit price measurement input, or null (clears it) when the quantity is empty. */
function unitOf(v: VariantDraft) {
  const q = parseDecimal(v.unitQuantity), r = parseDecimal(v.unitReference);
  return q && q > 0 && r && r > 0 ? { quantityValue: q, quantityUnit: v.unitQuantityUnit, referenceValue: Math.round(r), referenceUnit: v.unitReferenceUnit } : null;
}

function variantInput(v: VariantDraft, options: OptionDef[], locations: LocationRef[], create: boolean) {
  const weight = parseDecimal(v.weight);
  return {
    ...(v.id && { id: v.id }),
    ...(create && { optionValues: v.optionValues.map((name, i) => ({ optionName: options[i]!.name, name })) }),
    price: dec(v.price) ?? '0.00',
    compareAtPrice: dec(v.compareAtPrice),
    taxable: v.taxable,
    barcode: v.barcode.trim() || null,
    inventoryPolicy: v.continueSelling ? 'CONTINUE' : 'DENY',
    ...(v.id ? { mediaId: v.mediaId || null } : v.mediaId ? { mediaId: v.mediaId } : {}),
    unitPriceMeasurement: unitOf(v),
    inventoryItem: {
      sku: v.sku.trim() || null, tracked: v.tracked, cost: dec(v.cost), requiresShipping: v.requiresShipping,
      ...(v.requiresShipping && weight !== null && { measurement: { weight: { value: weight, unit: v.weightUnit } } }),
    },
    ...(create && v.tracked && { inventoryQuantities: locations.map((l) => ({ locationId: l.id, availableQuantity: Math.max(0, Math.trunc(Number(v.quantities[l.id]) || 0)) })) }),
  };
}

const chunk = <T,>(a: T[], n: number) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));

async function syncVariants(productId: string, form: ProductForm, original: VariantDraft[], locations: LocationRef[]) {
  const options = cleanOptions(form.options);
  const drafts = form.variants;
  const gone = original.filter((o) => o.id && !drafts.some((d) => d.id === o.id)).map((o) => o.id!);
  if (gone.length) await mutate(VARIANTS_BULK_DELETE, { productId, variantsIds: gone }, 'productVariantsBulkDelete');
  const existing = drafts.filter((d) => d.id);
  for (const part of chunk(existing, 100)) await mutate(VARIANTS_BULK_UPDATE, { productId, variants: part.map((v) => variantInput(v, options, locations, false)) }, 'productVariantsBulkUpdate');
  for (const part of chunk(drafts.filter((d) => !d.id), 100)) await mutate(VARIANTS_BULK_CREATE, { productId, variants: part.map((v) => variantInput(v, options, locations, true)) }, 'productVariantsBulkCreate');

  // Quantity edits on variants that already had an inventory item.
  const quantities = existing.filter((v) => v.tracked && v.inventoryItemId).flatMap((v) => {
    const before = original.find((o) => o.id === v.id);
    return locations
      .filter((l) => (Math.trunc(Number(v.quantities[l.id])) || 0) !== (Math.trunc(Number(before?.quantities[l.id])) || 0))
      .map((l) => ({ inventoryItemId: v.inventoryItemId!, locationId: l.id, quantity: Math.max(0, Math.trunc(Number(v.quantities[l.id]) || 0)) }));
  });
  if (quantities.length) await mutate(INVENTORY_SET_QUANTITIES, { input: { reason: 'correction', name: 'available', quantities } }, 'inventorySetQuantities');
}

function productInput(f: ProductForm) {
  return {
    title: f.title.trim(), descriptionHtml: f.descriptionHtml, status: f.status, vendor: f.vendor.trim(), productType: f.productType.trim(),
    tags: f.tags, templateSuffix: f.templateSuffix.trim() || null, category: f.category || null,
    seo: { title: f.seoTitle.trim() || null, description: f.seoDescription.trim() || null },
    ...(f.handle.trim() && { handle: f.handle.trim() }),
  };
}

const newMedia = (f: ProductForm) => f.media.filter((m) => !isPersistedMedia(m)).map((m) => ({ originalSource: absolute(m.url), alt: m.alt || null, mediaContentType: 'IMAGE' }));

/** Create a product with its options, variants and stock. Returns the new product GID. */
export async function createProduct(f: ProductForm, locations: LocationRef[]): Promise<string> {
  const options = cleanOptions(f.options);
  const res = await mutate<{ product: { id: string; variants: { nodes: Array<{ id: string; inventoryItem: { id: string } }> } } }>(PRODUCT_CREATE, {
    product: {
      ...productInput(f), collectionsToJoin: f.collections.map((c) => c.id),
      ...(options.length && { productOptions: options.map((o) => ({ name: o.name, values: o.values.map((name) => ({ name })) })) }),
    },
    media: newMedia(f),
  }, 'productCreate');
  const first = res.product.variants.nodes[0];
  const variants = f.variants.map((v, i) => (i === 0 && first ? { ...v, id: first.id, inventoryItemId: first.inventoryItem.id } : v));
  // The server created one variant (the default, or the first option combination); everything else is created or updated here.
  await syncVariants(res.product.id, { ...f, variants }, first ? [blankVariant({ id: first.id, quantities: {} })] : [], locations);
  return res.product.id;
}

export async function updateProduct(id: string, f: ProductForm, initial: ProductForm, locations: LocationRef[]) {
  const before = new Set(initial.collections.map((c) => c.id));
  const now = new Set(f.collections.map((c) => c.id));
  await mutate(PRODUCT_UPDATE, {
    product: {
      id, ...productInput(f),
      collectionsToJoin: [...now].filter((c) => !before.has(c)), collectionsToLeave: [...before].filter((c) => !now.has(c)),
    },
    media: newMedia(f),
  }, 'productUpdate');

  const added = cleanOptions(f.options).filter((o) => !o.id);
  if (added.length) await mutate(PRODUCT_OPTIONS_CREATE, { productId: id, options: added.map((o) => ({ name: o.name, values: o.values.map((name) => ({ name })) })) }, 'productOptionsCreate');

  await syncVariants(id, f, initial.variants, locations);

  const persisted = f.media.filter(isPersistedMedia);
  const originalOrder = initial.media.map((m) => m.key);
  const moves = persisted.map((m, i) => ({ id: m.key, newPosition: String(i) })).filter((m, i) => originalOrder[i] !== m.id);
  if (moves.length) await mutate(PRODUCT_REORDER_MEDIA, { id, moves }, 'productReorderMedia');
}
