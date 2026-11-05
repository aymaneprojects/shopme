import type { GalleryItem } from '@shopme/ui';
import { mutate } from '../api';
import { parseDecimal, toDecimalString } from '../format';
import { fromField } from './metafields';
import {
  CATALOG_PRODUCTS_UPDATE, INVENTORY_ACTIVATE, INVENTORY_DEACTIVATE, METAFIELDS_SET, PUBLISHABLE_PUBLISH, PUBLISHABLE_UNPUBLISH,
  INVENTORY_SET_QUANTITIES, PRODUCT_CREATE, PRODUCT_OPTIONS_CREATE, PRODUCT_REORDER_MEDIA, PRODUCT_UPDATE,
  VARIANTS_BULK_CREATE, VARIANTS_BULK_DELETE, VARIANTS_BULK_UPDATE,
} from '../graphql';
import { blankVariant, cleanOptions, generateVariants } from './variants';
import type { LengthUnit, OptionDef, VariantDraft, WeightUnit } from './variants';
import { channelChanges, channelStates } from '../components/Channels';
import type { CatalogRef as ProductCatalog, ChannelState, Publication } from '../components/Channels';
import type { ExtraMedia } from '../components/MediaExtras';

export interface LocationRef { id: string; name: string }
export interface CollectionRef { id: string; title: string }

export interface ProductForm {
  title: string; descriptionHtml: string; status: 'ACTIVE' | 'DRAFT' | 'ARCHIVED' | 'UNLISTED';
  vendor: string; productType: string; tags: string[]; templateSuffix: string; handle: string;
  /** Taxonomy category GID, or empty. */
  category: string;
  seoTitle: string; seoDescription: string;
  /** A gift card product: buying it issues gift cards. Only set when the product is created. */
  isGiftCard: boolean;
  options: OptionDef[]; variants: VariantDraft[];
  media: GalleryItem[]; collections: CollectionRef[];
  /** Videos and 3D models (saved ones are read only). */
  extraMedia: ExtraMedia[];
  /** Sales channel publication state (one entry per channel). */
  channels: ChannelState[];
  /** Market catalogs the product belongs to. */
  catalogs: ProductCatalog[];
  /** Metafield values typed on the page, `namespace.key` -> raw field value (saved with the product). */
  metafieldEdits: Record<string, { namespace: string; key: string; type: string; value: string }>;
}

/** Shape of the `product(id:)` query (see graphql/products.ts). */
export interface ApiProduct {
  id: string; title: string; handle: string; descriptionHtml: string; status: ProductForm['status']; vendor: string; productType: string;
  tags: string[]; templateSuffix: string | null; isGiftCard?: boolean; updatedAt: string; onlineStorePreviewUrl?: string | null;
  category?: { id: string; fullName: string } | null;
  seo: { title: string | null; description: string | null };
  options: Array<{ id: string; name: string; values: string[] }>;
  media: { nodes: Array<{ id: string; alt: string | null; mediaContentType?: string; image?: { url: string } }> };
  collections: { nodes: Array<{ id: string; title: string; ruleSet: unknown }> };
  variants: { nodes: ApiVariant[] };
  resourcePublicationsV2?: { nodes: Array<{ isPublished: boolean; publishDate: string | null; publication: { id: string; name: string } }> };
  shopmeCatalogs?: ProductCatalog[];
}
export interface ApiVariant {
  id: string; title: string; sku: string | null; barcode: string | null; price: string; compareAtPrice: string | null; taxable: boolean; inventoryPolicy: 'DENY' | 'CONTINUE';
  selectedOptions: Array<{ name: string; value: string }>;
  media?: { nodes: Array<{ id: string }> };
  unitPriceMeasurement?: { quantityValue: number; quantityUnit: string; referenceValue: number; referenceUnit: string } | null;
  inventoryItem: {
    id: string; tracked: boolean; requiresShipping: boolean; unitCost: { amount: string } | null; countryCodeOfOrigin?: string | null; harmonizedSystemCode?: string | null;
    shopmeShippingPackageId?: string | null; countryHarmonizedSystemCodes?: Array<{ countryCode: string; harmonizedSystemCode: string }>;
    measurement: { weight: { unit: WeightUnit; value: number } | null; dimensions?: { length: number | null; width: number | null; height: number | null; unit: LengthUnit } | null } | null;
    inventoryLevels: { nodes: Array<{ id?: string; location: { id: string }; quantities: Array<{ name: string; quantity: number }> }> };
  };
}

export const isPersistedMedia = (i: GalleryItem) => i.key.startsWith('gid://');

export function emptyForm(locations: LocationRef[], pubs: Publication[] = []): ProductForm {
  return {
    channels: channelStates(pubs, null), catalogs: [], metafieldEdits: {}, extraMedia: [],
    title: '', descriptionHtml: '', status: 'ACTIVE', vendor: '', productType: '', tags: [], templateSuffix: '', handle: '', category: '', seoTitle: '', seoDescription: '', isGiftCard: false,
    options: [], variants: [blankVariant({ quantities: Object.fromEntries(locations.map((l) => [l.id, '0'])), onHand: Object.fromEntries(locations.map((l) => [l.id, '0'])) })], media: [], collections: [],
  };
}

/** Blank form of a gift card product: delivered by email (no shipping, no stock) in three denominations. */
export function giftCardForm(locations: LocationRef[], title: string, pubs: Publication[] = []): ProductForm {
  const base = emptyForm(locations, pubs);
  const options: OptionDef[] = [{ name: 'Denomination', values: ['25', '50', '100'] }];
  const variants = generateVariants(options, [blankVariant({ tracked: false, requiresShipping: false, taxable: false, quantities: base.variants[0]!.quantities })])
    .map((v) => ({ ...v, price: `${v.optionValues[0]}.00`, tracked: false, requiresShipping: false }));
  return { ...base, title, isGiftCard: true, options, variants };
}

export function formFromProduct(p: ApiProduct, locations: LocationRef[], pubs: Publication[] = []): ProductForm {
  const defaultTitle = p.options.length === 1 && p.options[0]!.name === 'Title' && p.options[0]!.values[0] === 'Default Title';
  const options = defaultTitle ? [] : p.options.map((o) => ({ id: o.id, name: o.name, values: o.values }));
  const variants = p.variants.nodes.map((v): VariantDraft => {
    const levels: Record<string, string> = {}, onHand: Record<string, string> = {}, committed: Record<string, number> = {}, unavailable: Record<string, number> = {}, incoming: Record<string, number> = {}, levelIds: Record<string, string> = {};
    for (const lv of v.inventoryItem.inventoryLevels.nodes) {
      const q = (name: string) => lv.quantities.find((x) => x.name === name)?.quantity ?? 0;
      levels[lv.location.id] = String(q('available')); onHand[lv.location.id] = String(q('on_hand'));
      committed[lv.location.id] = q('committed'); unavailable[lv.location.id] = q('reserved'); incoming[lv.location.id] = q('incoming');
      if (lv.id) levelIds[lv.location.id] = lv.id;
    }
    const w = v.inventoryItem.measurement?.weight;
    const d = v.inventoryItem.measurement?.dimensions;
    const side = (n: number | null | undefined) => (n ? String(n) : '');
    const u = v.unitPriceMeasurement;
    return {
      key: v.id, id: v.id, inventoryItemId: v.inventoryItem.id,
      optionValues: defaultTitle ? [] : options.map((o) => v.selectedOptions.find((s) => s.name === o.name)?.value ?? ''),
      price: v.price, compareAtPrice: v.compareAtPrice ?? '', cost: v.inventoryItem.unitCost?.amount ?? '', sku: v.sku ?? '', barcode: v.barcode ?? '',
      taxable: v.taxable, tracked: v.inventoryItem.tracked, continueSelling: v.inventoryPolicy === 'CONTINUE', requiresShipping: v.inventoryItem.requiresShipping,
      weight: w ? String(w.value) : '', weightUnit: w?.unit ?? 'KILOGRAMS',
      length: side(d?.length), width: side(d?.width), height: side(d?.height), dimensionUnit: d?.unit ?? 'CENTIMETERS',
      countryOfOrigin: v.inventoryItem.countryCodeOfOrigin ?? '', hsCode: v.inventoryItem.harmonizedSystemCode ?? '', quantities: levels, onHand, committed, unavailable, incoming, levelIds,
      countryHs: (v.inventoryItem.countryHarmonizedSystemCodes ?? []).map((c) => ({ countryCode: c.countryCode, code: c.harmonizedSystemCode })), packageId: v.inventoryItem.shopmeShippingPackageId ?? '', mediaId: v.media?.nodes[0]?.id ?? '',
      unitQuantity: u ? String(u.quantityValue) : '', unitQuantityUnit: u?.quantityUnit || 'L', unitReference: u ? String(u.referenceValue) : '1', unitReferenceUnit: u?.referenceUnit || 'L',
    };
  });
  return {
    title: p.title, descriptionHtml: p.descriptionHtml, status: p.status,
    channels: channelStates(pubs, p.resourcePublicationsV2?.nodes ?? []), catalogs: p.shopmeCatalogs ?? [], metafieldEdits: {},
    extraMedia: p.media.nodes.filter((m) => m.mediaContentType === 'VIDEO' || m.mediaContentType === 'MODEL_3D').map((m): ExtraMedia => ({ key: m.id, url: '', name: m.alt ?? '', type: m.mediaContentType as ExtraMedia['type'], persisted: true })),
    vendor: p.vendor, productType: p.productType, tags: p.tags, templateSuffix: p.templateSuffix ?? '', handle: p.handle, category: p.category?.id ?? '',
    seoTitle: p.seo.title ?? '', seoDescription: p.seo.description ?? '', isGiftCard: !!p.isGiftCard, options, variants,
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
  const side = (x: string) => { const n = parseDecimal(x); return n !== null && n > 0 ? n : null; };
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
      countryCodeOfOrigin: v.countryOfOrigin || null, harmonizedSystemCode: v.hsCode.trim() || null,
      countryHarmonizedSystemCodes: v.countryHs.filter((c) => c.countryCode && c.code.trim()).map((c) => ({ countryCode: c.countryCode, harmonizedSystemCode: c.code.trim() })),
      ...(v.requiresShipping && {
        measurement: {
          shippingPackageId: v.packageId || null,
          ...(weight !== null && { weight: { value: weight, unit: v.weightUnit } }),
          dimensions: { length: side(v.length), width: side(v.width), height: side(v.height), unit: v.dimensionUnit },
        },
      }),
    },
    ...(create && v.tracked && { inventoryQuantities: locations.filter((l) => l.id in v.quantities).map((l) => ({ locationId: l.id, availableQuantity: Math.max(0, Math.trunc(Number(v.quantities[l.id]) || 0)) })) }),
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

  // Stocked locations and quantity edits of variants that already have an inventory item.
  const int = (x: string | undefined) => Math.max(0, Math.trunc(Number(x)) || 0);
  const activate: Array<{ inventoryItemId: string; locationId: string; available: number }> = [];
  const deactivate: string[] = [];
  const setAvailable: Array<{ inventoryItemId: string; locationId: string; quantity: number }> = [];
  const setOnHand: Array<{ inventoryItemId: string; locationId: string; quantity: number }> = [];
  for (const v of existing.filter((x) => x.inventoryItemId)) {
    const before = original.find((o) => o.id === v.id);
    for (const l of locations) {
      const now = l.id in v.quantities, was = !!before && l.id in before.quantities;
      if (now && !was) { activate.push({ inventoryItemId: v.inventoryItemId!, locationId: l.id, available: int(v.quantities[l.id]) }); if (int(v.quantities[l.id]) > 0) setAvailable.push({ inventoryItemId: v.inventoryItemId!, locationId: l.id, quantity: int(v.quantities[l.id]) }); continue; }
      if (!now && was) { const lid = before!.levelIds[l.id]; if (lid) deactivate.push(lid); continue; }
      if (!now || !v.tracked) continue;
      const availChanged = int(v.quantities[l.id]) !== int(before?.quantities[l.id]), handChanged = int(v.onHand[l.id]) !== int(before?.onHand[l.id]);
      if (availChanged) setAvailable.push({ inventoryItemId: v.inventoryItemId!, locationId: l.id, quantity: int(v.quantities[l.id]) });
      else if (handChanged) setOnHand.push({ inventoryItemId: v.inventoryItemId!, locationId: l.id, quantity: int(v.onHand[l.id]) });
    }
  }
  for (const a of activate) await mutate(INVENTORY_ACTIVATE, a, 'inventoryActivate');
  for (const id of deactivate) await mutate(INVENTORY_DEACTIVATE, { inventoryLevelId: id }, 'inventoryDeactivate');
  if (setAvailable.length) await mutate(INVENTORY_SET_QUANTITIES, { input: { reason: 'correction', name: 'available', quantities: setAvailable } }, 'inventorySetQuantities');
  if (setOnHand.length) await mutate(INVENTORY_SET_QUANTITIES, { input: { reason: 'correction', name: 'on_hand', quantities: setOnHand } }, 'inventorySetQuantities');
}

function productInput(f: ProductForm) {
  return {
    title: f.title.trim(), descriptionHtml: f.descriptionHtml, status: f.status, vendor: f.vendor.trim(), productType: f.productType.trim(),
    tags: f.tags, templateSuffix: f.templateSuffix.trim() || null, category: f.category || null,
    seo: { title: f.seoTitle.trim() || null, description: f.seoDescription.trim() || null },
    ...(f.handle.trim() && { handle: f.handle.trim() }),
  };
}

/** Metafield values typed on the product page -> `metafieldsSet` inputs for the saved product. */
const metafieldInputs = (ownerId: string, f: ProductForm) => Object.values(f.metafieldEdits).map((m) => ({ ownerId, namespace: m.namespace, key: m.key, type: m.type, value: fromField(m.type, m.value) }));

/** Apply the channel, catalog and metafield edits of the form to a saved product. */
async function syncPublishing(productId: string, f: ProductForm, initial: Pick<ProductForm, 'channels' | 'catalogs'>) {
  const { publish, unpublish } = channelChanges(initial.channels, f.channels);
  if (publish.length) await mutate(PUBLISHABLE_PUBLISH, { id: productId, input: publish }, 'publishablePublish');
  if (unpublish.length) await mutate(PUBLISHABLE_UNPUBLISH, { id: productId, input: unpublish }, 'publishableUnpublish');
  const had = new Set(initial.catalogs.map((c) => c.id)), has = new Set(f.catalogs.map((c) => c.id));
  const include = [...has].filter((c) => !had.has(c)), exclude = [...had].filter((c) => !has.has(c));
  if (include.length || exclude.length) await mutate(CATALOG_PRODUCTS_UPDATE, { productIds: [productId], include, exclude }, 'shopmeCatalogProductsUpdate');
  const mf = metafieldInputs(productId, f);
  if (mf.length) await mutate(METAFIELDS_SET, { metafields: mf }, 'metafieldsSet');
}

const newMedia = (f: ProductForm) => [
  ...f.media.filter((m) => !isPersistedMedia(m)).map((m) => ({ originalSource: absolute(m.url), alt: m.alt || null, mediaContentType: 'IMAGE' })),
  ...f.extraMedia.filter((m) => !m.persisted).map((m) => ({ originalSource: absolute(m.url), alt: m.name || null, mediaContentType: m.type })),
];

/** Create a product with its options, variants and stock. Returns the new product GID. */
export async function createProduct(f: ProductForm, locations: LocationRef[]): Promise<string> {
  const options = cleanOptions(f.options);
  const res = await mutate<{ product: { id: string; variants: { nodes: Array<{ id: string; inventoryItem: { id: string } }> } } }>(PRODUCT_CREATE, {
    product: {
      ...productInput(f), collectionsToJoin: f.collections.map((c) => c.id), ...(f.isGiftCard && { giftCard: true }),
      ...(options.length && { productOptions: options.map((o) => ({ name: o.name, values: o.values.map((name) => ({ name })) })) }),
    },
    media: newMedia(f),
  }, 'productCreate');
  const first = res.product.variants.nodes[0];
  const variants = f.variants.map((v, i) => (i === 0 && first ? { ...v, id: first.id, inventoryItemId: first.inventoryItem.id } : v));
  // The server created one variant (the default, or the first option combination); everything else is created or updated here.
  await syncVariants(res.product.id, { ...f, variants }, first ? [blankVariant({ id: first.id, quantities: {} })] : [], locations);
  // A new product is published on the Online Store by the server; the form decides the rest.
  await syncPublishing(res.product.id, f, { channels: f.channels.map((c) => ({ ...c, published: c.online, publishDate: '' })), catalogs: [] });
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

  await syncPublishing(id, f, initial);

  const persisted = f.media.filter(isPersistedMedia);
  const originalOrder = initial.media.map((m) => m.key);
  const moves = persisted.map((m, i) => ({ id: m.key, newPosition: String(i) })).filter((m, i) => originalOrder[i] !== m.id);
  if (moves.length) await mutate(PRODUCT_REORDER_MEDIA, { id, moves }, 'productReorderMedia');
}
