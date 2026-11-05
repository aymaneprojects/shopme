/**
 * Catalog API completeness: extra Product/ProductVariant/InventoryItem/Location fields, taxonomy, the single Online Store publication,
 * inventory activate/deactivate/move and location activate/deactivate. Fields are added with `objectFields` so the owning modules stay small.
 */
import {
  activateLevel, countLocations, countVariants, deactivateLevel, getCategory, getInventoryItem, getInventoryLevel, getLocation, listInventoryLevels, listVariants,
  ensureOnlineStore, getCollection, getProduct, getPublication, getResourcePublications, isLive, listPublications, publicationCounts, publishResource, unpublishResource, type Publication as PublicationRow,
  defaultLocationId, getInventoryItemForVariant, listLocations, moveQuantities, reorderLocations, searchCategories, setCollectionPublished, setLocationActive, updateProduct, type Location, type TaxonomyCategory,
} from '@shopme/core';
import { parseId } from '@shopme/shopify-compat';
import { builder } from '../builder';
import { requireScope } from '../context';
import { ConnectionArgs, defineConnection, paginateArray } from '../types/connection';
import { Count, MoneyV2, moneyV2 } from '../types/money';
import { Node, registerNode } from '../types/node';
import { Collection_, InventoryItem_, InventoryLevel_, Location_, Product_, ProductVariant, defineTypedPayload, shopOf, typedError } from '../types/catalog';
import { definePayload } from '../types/errors';
import { InventoryAdjustmentGroup } from './inventory';
import { Shop } from './shop';

/* ------------------------------ taxonomy ------------------------------ */

const TaxonomyCategory_ = builder.objectRef<TaxonomyCategory>('TaxonomyCategory').implement({
  fields: (t) => ({
    id: t.exposeID('id'), name: t.exposeString('name'), fullName: t.exposeString('fullName'), level: t.exposeInt('level'), isLeaf: t.exposeBoolean('isLeaf'), isRoot: t.boolean({ resolve: (c) => c.level === 0 }),
    isArchived: t.boolean({ resolve: () => false }), parentId: t.id({ nullable: true, resolve: (c) => c.parentId }),
    childrenIds: t.idList({ resolve: (c) => (c.isLeaf ? [] : searchCategories().filter((x) => x.parentId === c.id).map((x) => x.id)) }),
    ancestorIds: t.idList({ resolve: (c) => (c.parentId ? [c.parentId] : []) }),
  }),
});
const TaxonomyCategoryConnection = defineConnection('TaxonomyCategory', TaxonomyCategory_);
const Taxonomy = builder.objectRef<Record<string, never>>('Taxonomy').implement({
  fields: (t) => ({
    categories: t.field({
      type: TaxonomyCategoryConnection, args: { ...ConnectionArgs, search: t.arg.string(), childrenOf: t.arg.id(), siblingsOf: t.arg.id(), descendantsOf: t.arg.id() },
      resolve: (_p, a) => {
        const all = searchCategories(a.search).filter((c) => (a.childrenOf ? c.parentId === String(a.childrenOf) : a.descendantsOf ? c.parentId === String(a.descendantsOf) : true));
        return paginateArray(a, a.reverse ? [...all].reverse() : all);
      },
    }),
  }),
});
builder.queryFields((t) => ({ taxonomy: t.field({ type: Taxonomy, nullable: true, resolve: () => ({}) }) }));

/* ------------------------------ publications (sales channels) ------------------------------ */

export const Publication = builder.objectRef<PublicationRow>('Publication').implement({
  interfaces: [Node],
  fields: (t) => ({
    name: t.exposeString('name'), supportsFuturePublishing: t.boolean({ resolve: () => true }), autoPublish: t.boolean({ resolve: (p) => p.kind === 'ONLINE_STORE' }),
    hasCollection: t.boolean({ args: { id: t.arg.id({ required: true }) }, resolve: async (p, a, ctx) => {
      const id = parseId(String(a.id), 'Collection');
      return !!id && (await getResourcePublications(ctx.db, ctx.shopId, 'COLLECTION', [id])).get(id)!.some((r) => r.publicationId === p.id);
    } }),
    app: t.string({ nullable: true, resolve: () => null }),
    shopmeKind: t.string({ resolve: (p) => p.kind }),
    shopmeProductsCount: t.int({ resolve: async (p, _a, ctx) => (await publicationCounts(ctx.db, ctx.shopId)).get(p.id)?.products ?? 0 }),
    shopmeCollectionsCount: t.int({ resolve: async (p, _a, ctx) => (await publicationCounts(ctx.db, ctx.shopId)).get(p.id)?.collections ?? 0 }),
  }),
});
const PublicationConnection = defineConnection('Publication', Publication);
const PublicationInput = builder.inputType('PublicationInput', { fields: (t) => ({ publicationId: t.id(), publishDate: t.field({ type: 'DateTime' }) }) });
registerNode('Publication', (ctx, id) => getPublication(ctx.db, ctx.shopId, id));

type PublishableRow = { id: number; __typename?: string };
type ResourcePub = { publication: PublicationRow; published: boolean; publishDate: Date | null; publishable: PublishableRow };
const ResourcePublicationV2 = builder.objectRef<ResourcePub>('ResourcePublicationV2').implement({
  fields: (t) => ({
    isPublished: t.boolean({ resolve: (r) => r.published }), publication: t.field({ type: Publication, resolve: (r) => r.publication }),
    publishDate: t.field({ type: 'DateTime', nullable: true, resolve: (r) => r.publishDate }), publishable: t.field({ type: Node, resolve: (r) => r.publishable as never }),
  }),
});
const ResourcePublicationV2Connection = defineConnection('ResourcePublicationV2', ResourcePublicationV2);
const ResourcePublication = builder.objectRef<ResourcePub>('ResourcePublication').implement({
  fields: (t) => ({
    isPublished: t.boolean({ resolve: (r) => r.published }), publication: t.field({ type: Publication, resolve: (r) => r.publication }),
    publishDate: t.field({ type: 'DateTime', resolve: (r) => r.publishDate ?? new Date(0) }), publishable: t.field({ type: Node, resolve: (r) => r.publishable as never }),
  }),
});
const ResourcePublicationConnection = defineConnection('ResourcePublication', ResourcePublication);

async function resourcePubs(ctx: Parameters<typeof requireScope>[0], type: 'Product' | 'Collection', id: number, onlyPublished: boolean): Promise<ResourcePub[]> {
  const pubs = await listPublications(ctx.db, ctx.shopId);
  const own = (await getResourcePublications(ctx.db, ctx.shopId, type === 'Product' ? 'PRODUCT' : 'COLLECTION', [id])).get(id) ?? [];
  const out: ResourcePub[] = [];
  for (const p of pubs) {
    const r = own.find((x) => x.publicationId === p.id);
    if (r || !onlyPublished) out.push({ publication: p, published: !!r, publishDate: r?.publishedAt ?? null, publishable: { id, __typename: type } });
  }
  return onlyPublished ? out.filter((r) => r.publishDate && r.publishDate <= new Date()) : out;
}

builder.queryFields((t) => ({
  publications: t.field({ type: PublicationConnection, args: { ...ConnectionArgs, catalogType: t.arg.string() }, resolve: async (_r, a, ctx) => paginateArray(a, await listPublications(ctx.db, ctx.shopId)) }),
  publication: t.field({ type: Publication, nullable: true, args: { id: t.arg.id({ required: true }) }, resolve: async (_r, a, ctx) => { const id = parseId(String(a.id), 'Publication'); return id ? getPublication(ctx.db, ctx.shopId, id) : null; } }),
  publicationsCount: t.field({ type: Count, nullable: true, args: { catalogType: t.arg.string(), limit: t.arg.int() }, resolve: async (_r, _a, ctx) => ({ count: (await listPublications(ctx.db, ctx.shopId)).length, precision: 'EXACT' as const }) }),
  locationsCount: t.field({
    type: Count, nullable: true, args: { query: t.arg.string(), limit: t.arg.int() },
    resolve: async (_r, a, ctx) => { requireScope(ctx, 'read_locations'); return { count: await countLocations(ctx.db, ctx.shopId, /active:false|active:\s*\*/.test(a.query ?? '')), precision: 'EXACT' as const }; },
  }),
}));

const livePubs = async (ctx: Parameters<typeof requireScope>[0], type: 'PRODUCT' | 'COLLECTION', id: number) => (await getResourcePublications(ctx.db, ctx.shopId, type, [id])).get(id)!.filter((r) => isLive(r));
const pubFields = (type: 'PRODUCT' | 'COLLECTION') => (t: any) => ({
  publishedOnCurrentPublication: t.boolean({ resolve: async (p: { id: number }, _a: unknown, ctx: Parameters<typeof requireScope>[0]) => { const os = await ensureOnlineStore(ctx.db, ctx.shopId); return (await livePubs(ctx, type, p.id)).some((r) => r.publicationId === os.id); } }),
  publishedOnPublication: t.boolean({ args: { publicationId: t.arg.id({ required: true }) }, resolve: async (p: { id: number }, a: { publicationId: string }, ctx: Parameters<typeof requireScope>[0]) => (await livePubs(ctx, type, p.id)).some((r) => r.publicationId === parseId(String(a.publicationId), 'Publication')) }),
  availablePublicationsCount: t.field({ type: Count, nullable: true, resolve: async (_p: unknown, _a: unknown, ctx: Parameters<typeof requireScope>[0]) => ({ count: (await listPublications(ctx.db, ctx.shopId)).length, precision: 'EXACT' as const }) }),
  resourcePublicationsCount: t.field({ type: Count, nullable: true, resolve: async (p: { id: number }, _a: unknown, ctx: Parameters<typeof requireScope>[0]) => ({ count: (await livePubs(ctx, type, p.id)).length, precision: 'EXACT' as const }) }),
  resourcePublicationsV2: t.field({
    type: ResourcePublicationV2Connection, args: { ...ConnectionArgs, onlyPublished: t.arg.boolean({ defaultValue: true }), catalogType: t.arg.string() },
    resolve: async (p: { id: number }, a: { onlyPublished?: boolean | null }, ctx: Parameters<typeof requireScope>[0]) => paginateArray(a as never, await resourcePubs(ctx, type === 'PRODUCT' ? 'Product' : 'Collection', p.id, a.onlyPublished !== false)),
  }),
  resourcePublications: t.field({
    type: ResourcePublicationConnection, args: { ...ConnectionArgs, onlyPublished: t.arg.boolean({ defaultValue: true }) },
    resolve: async (p: { id: number }, a: { onlyPublished?: boolean | null }, ctx: Parameters<typeof requireScope>[0]) => paginateArray(a as never, await resourcePubs(ctx, type === 'PRODUCT' ? 'Product' : 'Collection', p.id, a.onlyPublished !== false)),
  }),
});
builder.objectFields(Product_, pubFields('PRODUCT'));
builder.objectFields(Collection_, pubFields('COLLECTION'));

/** Publish / unpublish a product or collection on one or more channels. Without a publication id the Online Store is used. */
export async function setPublished(ctx: Parameters<typeof requireScope>[0], rawId: string, input: { publicationId?: string | number | null; publishDate?: Date | string | null }[], publish: boolean) {
  requireScope(ctx, 'write_publications');
  const ref = rawId.startsWith('gid://') ? rawId.split('/')[3] : undefined;
  const id = parseId(rawId, ref ?? 'Product');
  if (!id || !ref || !['Product', 'Collection'].includes(ref)) return { publishable: null, userErrors: [{ field: ['id'], message: 'Publishable does not exist' }] };
  const type = ref === 'Product' ? 'PRODUCT' as const : 'COLLECTION' as const;
  const store = await ensureOnlineStore(ctx.db, ctx.shopId);
  for (const i of input.length ? input : [{}]) {
    const pubId = (i as { publicationId?: string | number | null }).publicationId;
    const pid = pubId == null ? store.id : parseId(String(pubId), 'Publication');
    if (!pid) return { publishable: null, userErrors: [{ field: ['input', 'publicationId'], message: 'Publication does not exist' }] };
    const when = (i as { publishDate?: Date | string | null }).publishDate;
    const r = publish ? await publishResource(ctx.db, ctx.shopId, type, id, pid, when ? new Date(when) : null) : await unpublishResource(ctx.db, ctx.shopId, type, id, pid);
    if (!r.ok) return { publishable: null, userErrors: r.errors };
  }
  if (ref === 'Product') { const p = await getProduct(ctx.db, ctx.shopId, id); return { publishable: { ...p!, __typename: 'Product' }, userErrors: [] }; }
  const c = await getCollection(ctx.db, ctx.shopId, id);
  return { publishable: { ...c!, __typename: 'Collection' }, userErrors: [] };
}
const PublishPayload = (name: string) => definePayload<{ publishable: unknown }>(name, (t) => ({
  publishable: t.field({ type: Node, nullable: true, resolve: (p) => p.publishable as never }),
  shop: t.field({ type: Shop, resolve: (_p, _a, ctx) => shopOf(ctx) }),
}));
const PublishablePublishPayload = PublishPayload('PublishablePublishPayload');
const PublishableUnpublishPayload = PublishPayload('PublishableUnpublishPayload');
builder.mutationFields((t) => ({
  publishablePublish: t.field({ type: PublishablePublishPayload, args: { id: t.arg.id({ required: true }), input: t.arg({ type: [PublicationInput], required: true }) }, resolve: (_r, a, ctx) => setPublished(ctx, String(a.id), a.input, true) }),
  publishableUnpublish: t.field({ type: PublishableUnpublishPayload, args: { id: t.arg.id({ required: true }), input: t.arg({ type: [PublicationInput], required: true }) }, resolve: (_r, a, ctx) => setPublished(ctx, String(a.id), a.input, false) }),
}));

/* ------------------------------ Product / variant fields ------------------------------ */

const ProductCompareAtPriceRange = builder.objectRef<{ min: number | null; max: number | null; currency: string }>('ProductCompareAtPriceRange').implement({
  fields: (t) => ({
    minVariantCompareAtPrice: t.field({ type: MoneyV2, nullable: true, resolve: (r) => (r.min == null ? null : moneyV2(r.min, r.currency)) }),
    maxVariantCompareAtPrice: t.field({ type: MoneyV2, nullable: true, resolve: (r) => (r.max == null ? null : moneyV2(r.max, r.currency)) }),
  }),
});
const ProductPriceRange = builder.objectRef<{ min: number; max: number; currency: string }>('ProductPriceRange').implement({
  fields: (t) => ({
    minVariantPrice: t.field({ type: MoneyV2, resolve: (r) => moneyV2(r.min, r.currency) }),
    maxVariantPrice: t.field({ type: MoneyV2, resolve: (r) => moneyV2(r.max, r.currency) }),
  }),
});
const CategoryRef = TaxonomyCategory_;

builder.objectFields(Product_, (t) => ({
  priceRange: t.field({
    type: ProductPriceRange, deprecationReason: 'Use `priceRangeV2` instead.',
    resolve: async (p, _a, ctx) => {
      const vs = await listVariants(ctx.db, ctx.shopId, { productId: p.id, offset: 0, limit: 250 });
      const prices = vs.map((v) => v.price);
      return { min: Math.min(...prices, Infinity) === Infinity ? 0 : Math.min(...prices), max: Math.max(0, ...prices), currency: (await shopOf(ctx)).currency };
    },
  }),
  compareAtPriceRange: t.field({
    type: ProductCompareAtPriceRange, nullable: true,
    resolve: async (p, _a, ctx) => {
      const vs = (await listVariants(ctx.db, ctx.shopId, { productId: p.id, offset: 0, limit: 250 })).map((v) => v.compareAtPrice).filter((c): c is number => c != null && c > 0);
      return { min: vs.length ? Math.min(...vs) : null, max: vs.length ? Math.max(...vs) : null, currency: (await shopOf(ctx)).currency };
    },
  }),
  totalVariants: t.int({ deprecationReason: 'Use `variantsCount` instead.', resolve: (p, _a, ctx) => countVariants(ctx.db, ctx.shopId, p.id) }),
  onlineStorePreviewUrl: t.field({ type: 'URL', nullable: true, resolve: (p, _a, ctx) => `${ctx.app.config.appUrl}/products/${p.handle}${p.status === 'ACTIVE' ? '' : '?preview=1'}` }),
  category: t.field({ type: CategoryRef, nullable: true, resolve: (p) => getCategory(p.category) }),
  hasVariantsThatRequiresComponents: t.boolean({ resolve: () => false }),
  giftCardTemplateSuffix: t.string({ nullable: true, resolve: () => null }),
}));

const UnitPriceMeasurement = builder.objectRef<{ quantityValue: number; quantityUnit: string; referenceValue: number; referenceUnit: string }>('UnitPriceMeasurement').implement({
  fields: (t) => ({
    quantityValue: t.exposeFloat('quantityValue'), quantityUnit: t.exposeString('quantityUnit', { nullable: true }),
    referenceValue: t.exposeInt('referenceValue'), referenceUnit: t.exposeString('referenceUnit', { nullable: true }),
  }),
});
builder.objectFields(ProductVariant, (t) => ({
  unitPriceMeasurement: t.field({
    type: UnitPriceMeasurement, nullable: true,
    resolve: (v) => (v.unitQuantityValue && v.unitReferenceValue ? { quantityValue: v.unitQuantityValue, quantityUnit: v.unitQuantityUnit ?? '', referenceValue: v.unitReferenceValue, referenceUnit: v.unitReferenceUnit ?? '' } : null),
  }),
  /** Price per reference unit (e.g. per 100 ml), when a unit price measurement is set. */
  unitPrice: t.field({
    type: MoneyV2, nullable: true,
    resolve: async (v, _a, ctx) => (v.unitQuantityValue && v.unitReferenceValue ? moneyV2(Math.round((v.price / v.unitQuantityValue) * v.unitReferenceValue), (await shopOf(ctx)).currency) : null),
  }),
  showUnitPrice: t.boolean({ resolve: (v) => !!(v.unitQuantityValue && v.unitReferenceValue) }),
  taxCode: t.string({ nullable: true, resolve: (v) => v.taxCode }),
  requiresComponents: t.boolean({ resolve: () => false }),
  sellableOnlineQuantity: t.int({
    resolve: async (v, _a, ctx) => {
      const item = await getInventoryItemForVariant(ctx.db, ctx.shopId, v.id);
      if (!item) return 0;
      const levels = await listInventoryLevels(ctx.db, ctx.shopId, { itemId: item.id });
      const online = new Set((await Promise.all(levels.map((l) => getLocation(ctx.db, ctx.shopId, l.locationId)))).filter((l) => l?.fulfillsOnlineOrders).map((l) => l!.id));
      return levels.filter((l) => online.has(l.locationId)).reduce((n, l) => n + l.available, 0);
    },
  }),
}));

/* ------------------------------ inventory item / level / location fields ------------------------------ */

builder.objectFields(InventoryItem_, (t) => ({
  locationsCount: t.field({ type: Count, nullable: true, resolve: async (i, _a, ctx) => ({ count: (await listInventoryLevels(ctx.db, ctx.shopId, { itemId: i.id })).length, precision: 'EXACT' as const }) }),
  duplicateSkuCount: t.int({ resolve: () => 0 }),
  provinceCodeOfOrigin: t.string({ nullable: true, resolve: () => null }),
  trackedEditable: t.field({ type: TrackedEditable, resolve: () => ({ locked: false, reason: null }) }),
}));
const TrackedEditable = builder.objectRef<{ locked: boolean; reason: string | null }>('EditableProperty').implement({
  fields: (t) => ({ locked: t.exposeBoolean('locked'), reason: t.exposeString('reason', { nullable: true }) }),
});
builder.objectFields(InventoryLevel_, (t) => ({
  canDeactivate: t.boolean({
    resolve: async (l, _a, ctx) => l.isActive && l.committed === 0 && l.reserved === 0 && (await listInventoryLevels(ctx.db, ctx.shopId, { itemId: l.inventoryItemId })).length > 1,
  }),
}));
builder.objectFields(Location_, (t) => ({
  isPrimary: t.boolean({ resolve: async (l, _a, ctx) => (await defaultLocationId(ctx.db, ctx.shopId)) === l.id }),
  activatable: t.boolean({ resolve: (l) => !l.isActive }),
  deactivatable: t.boolean({ resolve: async (l, _a, ctx) => l.isActive && (await countLocations(ctx.db, ctx.shopId)) > 1 }),
  deletable: t.boolean({ resolve: () => false }),
  deactivatedAt: t.string({ nullable: true, resolve: (l) => (l.isActive ? null : l.updatedAt.toISOString()) }),
  hasUnfulfilledOrders: t.boolean({ resolve: () => false }),
  inventoryLevel: t.field({
    type: InventoryLevel_, nullable: true, args: { inventoryItemId: t.arg.id({ required: true }) },
    resolve: async (l, a, ctx) => { const item = parseId(String(a.inventoryItemId), 'InventoryItem'); return item ? (await listInventoryLevels(ctx.db, ctx.shopId, { itemId: item, locationId: l.id }))[0] ?? null : null; },
  }),
  /** ShopMe extension: allocation priority for online orders (lowest first). */
  priority: t.int({ resolve: (l) => l.priority }),
}));

/* ------------------------------ mutations ------------------------------ */

const InventoryActivatePayload = definePayload<{ inventoryLevel: import('@shopme/core').InventoryLevel | null }>('InventoryActivatePayload', (t) => ({
  inventoryLevel: t.field({ type: InventoryLevel_, nullable: true, resolve: (p) => p.inventoryLevel }),
}));
const InventoryDeactivatePayload = definePayload<{ ok?: boolean }>('InventoryDeactivatePayload', () => ({}));
const MoveTerminal = builder.inputType('InventoryMoveQuantityTerminalInput', {
  fields: (t) => ({ locationId: t.id({ required: true }), name: t.string({ required: true }), ledgerDocumentUri: t.string(), changeFromQuantity: t.int() }),
});
const MoveChange = builder.inputType('InventoryMoveQuantityChange', {
  fields: (t) => ({ inventoryItemId: t.id({ required: true }), quantity: t.int({ required: true }), from: t.field({ type: MoveTerminal, required: true }), to: t.field({ type: MoveTerminal, required: true }) }),
});
const MoveInput = builder.inputType('InventoryMoveQuantitiesInput', {
  fields: (t) => ({ reason: t.string({ required: true }), referenceDocumentUri: t.string({ required: true }), changes: t.field({ type: [MoveChange], required: true }) }),
});
const MovePayload = defineTypedPayload<{ inventoryAdjustmentGroup: import('@shopme/core').AdjustmentGroup | null }>('InventoryMoveQuantitiesPayload', 'InventoryMoveQuantitiesUserError', (t) => ({
  inventoryAdjustmentGroup: t.field({ type: InventoryAdjustmentGroup, nullable: true, resolve: (p) => p.inventoryAdjustmentGroup }),
}));

const locationPayload = (name: string, errorType: 'LocationActivateUserError' | 'LocationDeactivateUserError', errorField: string) => {
  const ref = builder.objectRef<{ location: Location | null; errors: import('@shopme/shopify-compat').UserError[] }>(name);
  ref.implement({ fields: (t) => ({ location: t.field({ type: Location_, nullable: true, resolve: (p) => p.location }), [errorField]: t.field({ type: [typedError(errorType)], resolve: (p) => p.errors }) }) });
  return ref;
};
const LocationActivatePayload = locationPayload('LocationActivatePayload', 'LocationActivateUserError', 'locationActivateUserErrors');
const LocationDeactivatePayload = locationPayload('LocationDeactivatePayload', 'LocationDeactivateUserError', 'locationDeactivateUserErrors');
const LocationsReorderPayload = definePayload<{ locations: Location[] }>('ShopmeLocationsReorderPayload', (t) => ({ locations: t.field({ type: [Location_], resolve: (p) => p.locations }) }));

builder.mutationFields((t) => ({
  inventoryActivate: t.field({
    type: InventoryActivatePayload,
    args: { inventoryItemId: t.arg.id({ required: true }), locationId: t.arg.id({ required: true }), available: t.arg.int(), onHand: t.arg.int(), stockAtLegacyLocation: t.arg.boolean({ deprecationReason: 'Ignored.' }) },
    resolve: async (_r, a, ctx) => {
      requireScope(ctx, 'write_inventory');
      const itemId = parseId(String(a.inventoryItemId), 'InventoryItem');
      const locId = parseId(String(a.locationId), 'Location');
      if (!itemId || !(await getInventoryItem(ctx.db, ctx.shopId, itemId))) return { inventoryLevel: null, userErrors: [{ field: ['inventoryItemId'], message: "Couldn't find the inventory item" }] };
      const loc = locId ? await getLocation(ctx.db, ctx.shopId, locId) : null;
      if (!loc?.isActive) return { inventoryLevel: null, userErrors: [{ field: ['locationId'], message: "Couldn't find the location" }] };
      const existing = (await listInventoryLevels(ctx.db, ctx.shopId, { itemId, locationId: loc.id }))[0];
      if (existing) return { inventoryLevel: existing, userErrors: [] }; // already active: no-op like Shopify
      const level = await activateLevel(ctx.db, ctx.shopId, itemId, loc.id, Math.max(0, a.available ?? a.onHand ?? 0));
      return { inventoryLevel: level, userErrors: [] };
    },
  }),
  inventoryDeactivate: t.field({
    type: InventoryDeactivatePayload, args: { inventoryLevelId: t.arg.id({ required: true }) },
    resolve: async (_r, a, ctx) => {
      requireScope(ctx, 'write_inventory');
      const id = parseId(String(a.inventoryLevelId).split('?')[0]!, 'InventoryLevel');
      const level = id ? await getInventoryLevel(ctx.db, ctx.shopId, id) : null;
      if (!level) return { userErrors: [{ field: ['inventoryLevelId'], message: "The inventory level can't be found" }] };
      const r = await deactivateLevel(ctx.db, ctx.shopId, level.inventoryItemId, level.locationId);
      return { userErrors: r.ok ? [] : r.errors };
    },
  }),
  inventoryMoveQuantities: t.field({
    type: MovePayload, args: { input: t.arg({ type: MoveInput, required: true }) },
    resolve: async (_r, { input }, ctx) => {
      requireScope(ctx, 'write_inventory');
      const changes = [];
      for (const [i, c] of input.changes.entries()) {
        const item = parseId(String(c.inventoryItemId), 'InventoryItem');
        const from = parseId(String(c.from.locationId), 'Location');
        const to = parseId(String(c.to.locationId), 'Location');
        if (!item) return { inventoryAdjustmentGroup: null, userErrors: [{ field: ['input', 'changes', String(i), 'inventoryItemId'], message: 'The specified inventory item could not be found.', code: 'INVALID_INVENTORY_ITEM' }] };
        if (!from || !to) return { inventoryAdjustmentGroup: null, userErrors: [{ field: ['input', 'changes', String(i), from ? 'to' : 'from', 'locationId'], message: 'The specified location could not be found.', code: 'INVALID_LOCATION' }] };
        changes.push({ inventoryItemId: item, quantity: c.quantity, from: { locationId: from, name: c.from.name }, to: { locationId: to, name: c.to.name } });
      }
      const r = await moveQuantities(ctx.db, ctx.shopId, { reason: input.reason, referenceDocumentUri: input.referenceDocumentUri, changes });
      return r.ok ? { inventoryAdjustmentGroup: r.value, userErrors: [] } : { inventoryAdjustmentGroup: null, userErrors: r.errors };
    },
  }),
  locationActivate: t.field({
    type: LocationActivatePayload, args: { locationId: t.arg.id({ required: true }) },
    resolve: async (_r, a, ctx) => {
      requireScope(ctx, 'write_locations');
      const id = parseId(String(a.locationId), 'Location');
      const r = id ? await setLocationActive(ctx.db, ctx.shopId, id, true) : null;
      return r?.ok ? { location: r.value, errors: [] } : { location: null, errors: r ? r.errors : [{ field: ['locationId'], message: 'Location not found.', code: 'LOCATION_NOT_FOUND' }] };
    },
  }),
  locationDeactivate: t.field({
    type: LocationDeactivatePayload, args: { locationId: t.arg.id({ required: true }), destinationLocationId: t.arg.id() },
    resolve: async (_r, a, ctx) => {
      requireScope(ctx, 'write_locations');
      const id = parseId(String(a.locationId), 'Location');
      const dest = a.destinationLocationId ? parseId(String(a.destinationLocationId), 'Location') : null;
      const r = id ? await setLocationActive(ctx.db, ctx.shopId, id, false, dest) : null;
      return r?.ok ? { location: r.value, errors: [] } : { location: null, errors: r ? r.errors : [{ field: ['locationId'], message: 'Location not found.', code: 'LOCATION_NOT_FOUND' }] };
    },
  }),
  shopmeLocationsReorder: t.field({
    description: 'ShopMe extension: set the stock allocation priority of locations for online orders (first id = highest priority).',
    type: LocationsReorderPayload, args: { locationIds: t.arg.idList({ required: true }) },
    resolve: async (_r, a, ctx) => {
      requireScope(ctx, 'write_locations');
      await reorderLocations(ctx.db, ctx.shopId, a.locationIds.map((x) => parseId(String(x), 'Location')).filter((x): x is number => x != null));
      return { locations: await listLocations(ctx.db, ctx.shopId, { sortKey: 'PRIORITY', offset: 0, limit: 250, includeInactive: true }), userErrors: [] };
    },
  }),
}));
