/**
 * ShopMe extensions around the product page and list: catalog membership, inventory history, per country HS codes, shipping package.
 * Custom fields are prefixed `shopme` so they never clash with the Shopify-compatible names.
 */
import { getProduct, getProductCatalogs, listCountryHsCodes, listItemAdjustments, listLocations, updateCatalogProducts, type CatalogRef } from '@shopme/core';
import { parseId, toGid } from '@shopme/shopify-compat';
import { builder } from '../builder';
import { requireScope } from '../context';
import { InventoryItem_, Product_, shopOf } from '../types/catalog';
import { definePayload } from '../types/errors';
import { Shop } from './shop';

const CatalogRef_ = builder.objectRef<CatalogRef>('ShopmeProductCatalog').implement({
  fields: (t) => ({ id: t.id({ resolve: (c) => toGid('MarketCatalog', c.id) }), title: t.exposeString('title'), status: t.exposeString('status') }),
});

builder.objectFields(Product_, (t) => ({
  shopmeCatalogs: t.field({ type: [CatalogRef_], resolve: async (p, _a, ctx) => (await getProductCatalogs(ctx.db, ctx.shopId, [p.id])).get(p.id) ?? [] }),
  shopmeCatalogsCount: t.int({ resolve: async (p, _a, ctx) => ((await getProductCatalogs(ctx.db, ctx.shopId, [p.id])).get(p.id) ?? []).length }),
}));

const CountryHs = builder.objectRef<{ countryCode: string; harmonizedSystemCode: string }>('CountryHarmonizedSystemCode').implement({
  fields: (t) => ({ countryCode: t.exposeString('countryCode'), harmonizedSystemCode: t.exposeString('harmonizedSystemCode') }),
});
type Adj = { id: number; name: string; delta: number; quantityAfter: number; reason: string; createdAt: Date; locationId: number; locationName: string };
const InventoryHistoryEntry = builder.objectRef<Adj>('ShopmeInventoryHistoryEntry').implement({
  fields: (t) => ({
    id: t.id({ resolve: (a) => toGid('InventoryAdjustment', a.id) }), name: t.exposeString('name'), delta: t.exposeInt('delta'), quantityAfter: t.exposeInt('quantityAfter'),
    reason: t.exposeString('reason'), createdAt: t.field({ type: 'DateTime', resolve: (a) => a.createdAt }), locationName: t.exposeString('locationName'),
  }),
});
builder.objectFields(InventoryItem_, (t) => ({
  countryHarmonizedSystemCodes: t.field({ type: [CountryHs], resolve: (i, _a, ctx) => listCountryHsCodes(ctx.db, ctx.shopId, i.id) }),
  shopmeShippingPackageId: t.id({ nullable: true, resolve: (i) => (i.shippingPackageId ? toGid('ShopmeShippingPackage', i.shippingPackageId) : null) }),
  shopmeHistory: t.field({
    type: [InventoryHistoryEntry], args: { first: t.arg.int({ defaultValue: 20 }) },
    resolve: async (i, a, ctx) => {
      const rows = await listItemAdjustments(ctx.db, ctx.shopId, i.id, Math.min(a.first ?? 20, 100));
      const names = new Map((await listLocations(ctx.db, ctx.shopId, { includeInactive: true, offset: 0, limit: 250 })).map((l) => [l.id, l.name] as const));
      return rows.map((r) => ({ id: r.id, name: r.name, delta: r.delta, quantityAfter: r.quantityAfter, reason: r.reason, createdAt: r.createdAt, locationId: r.locationId, locationName: names.get(r.locationId) ?? '' }));
    },
  }),
}));

const CatalogsUpdatePayload = definePayload<{ added: number; removed: number }>('ShopmeCatalogProductsUpdatePayload', (t) => ({
  added: t.exposeInt('added'), removed: t.exposeInt('removed'), shop: t.field({ type: Shop, resolve: (_p, _a, ctx) => shopOf(ctx) }),
}));
builder.mutationFields((t) => ({
  /** Add products to and remove them from market catalogs in one call (bulk include / exclude). */
  shopmeCatalogProductsUpdate: t.field({
    type: CatalogsUpdatePayload,
    args: { productIds: t.arg.idList({ required: true }), include: t.arg.idList(), exclude: t.arg.idList() },
    resolve: async (_r, a, ctx) => {
      requireScope(ctx, 'write_products');
      const ids = (xs: (string | number)[] | null | undefined, type: string, alt?: string) => (xs ?? []).map((x) => parseId(String(x), type) ?? (alt ? parseId(String(x), alt) : null)).filter((n): n is number => !!n);
      const productIds = ids(a.productIds, 'Product');
      const found = (await Promise.all(productIds.map((id) => getProduct(ctx.db, ctx.shopId, id)))).filter(Boolean);
      if (!found.length) return { added: 0, removed: 0, userErrors: [{ field: ['productIds'], message: 'Product does not exist' }] };
      const r = await updateCatalogProducts(ctx.db, ctx.shopId, { productIds, include: ids(a.include, 'MarketCatalog', 'Catalog'), exclude: ids(a.exclude, 'MarketCatalog', 'Catalog') });
      return r.ok ? { ...r.value, userErrors: [] } : { added: 0, removed: 0, userErrors: r.errors };
    },
  }),
}));

