import {
  adjustQuantities, getInventoryItem, getInventoryLevel, getLocation, getVariant, listInventoryItems, listInventoryLevels,
  QUANTITY_COLUMNS, setQuantities, updateInventoryItem, type AdjustmentGroup, type AppliedChange, type InventoryItemUpdate, type InventoryLevel, type WeightUnit,
} from '@shopme/core';
import { parseId, parseMoney, toGid } from '@shopme/shopify-compat';
import { builder } from '../builder';
import { requireScope } from '../context';
import { ConnectionArgs, paginate } from '../types/connection';
import { Node, legacyId, registerNode } from '../types/node';
import { MoneyV2, moneyV2 } from '../types/money';
import {
  InventoryItem_, InventoryItemConnection, InventoryLevel_, InventoryLevelConnection, Location_, ProductVariant, WEIGHT_UNIT, defineTypedPayload, prefixed, shopOf,
} from '../types/catalog';
import { definePayload } from '../types/errors';

export const WeightInput = builder.inputType('WeightInput', { fields: (t) => ({ value: t.float({ required: true }), unit: t.field({ type: WEIGHT_UNIT, required: true }) }) });
const InventoryItemMeasurementInput = builder.inputType('InventoryItemMeasurementInput', { fields: (t) => ({ weight: t.field({ type: WeightInput }), shippingPackageId: t.id() }) });
export const InventoryItemInput = builder.inputType('InventoryItemInput', {
  fields: (t) => ({
    sku: t.string(), cost: t.field({ type: 'Decimal' }), tracked: t.boolean(), countryCodeOfOrigin: t.string(), harmonizedSystemCode: t.string(),
    provinceCodeOfOrigin: t.string(), measurement: t.field({ type: InventoryItemMeasurementInput }), requiresShipping: t.boolean(),
  }),
});

interface ItemInputShape { sku?: string | null; cost?: string | null; tracked?: boolean | null; countryCodeOfOrigin?: string | null; harmonizedSystemCode?: string | null; requiresShipping?: boolean | null; measurement?: { weight?: { value: number; unit: unknown } | null } | null }
/** GraphQL InventoryItemInput -> service update (cost converted to minor units). */
export function toItemUpdate(i: ItemInputShape | null | undefined, currency: string): InventoryItemUpdate | null {
  if (!i) return null;
  return {
    sku: i.sku, cost: i.cost == null ? (i.cost as null | undefined) : parseMoney(i.cost, currency), tracked: i.tracked, countryCodeOfOrigin: i.countryCodeOfOrigin,
    harmonizedSystemCode: i.harmonizedSystemCode, requiresShipping: i.requiresShipping,
    weight: i.measurement?.weight ? { value: i.measurement.weight.value, unit: i.measurement.weight.unit as WeightUnit } : undefined,
  };
}

const Weight = builder.objectRef<{ unit: string; value: number }>('Weight').implement({
  fields: (t) => ({ unit: t.field({ type: WEIGHT_UNIT, resolve: (w) => w.unit as never }), value: t.exposeFloat('value') }),
});
const InventoryItemMeasurement = builder.objectRef<{ id: string; weight: { unit: string; value: number } }>('InventoryItemMeasurement').implement({
  fields: (t) => ({ id: t.exposeID('id'), weight: t.field({ type: Weight, nullable: true, resolve: (m) => m.weight }) }),
});
const InventoryQuantity = builder.objectRef<{ id: string; name: string; quantity: number; updatedAt: Date }>('InventoryQuantity').implement({
  fields: (t) => ({ id: t.exposeID('id'), name: t.exposeString('name'), quantity: t.exposeInt('quantity'), updatedAt: t.field({ type: 'DateTime', nullable: true, resolve: (q) => q.updatedAt }) }),
});

InventoryItem_.implement({
  interfaces: [Node],
  fields: (t) => ({
    legacyResourceId: t.field({ type: 'UnsignedInt64', resolve: legacyId }),
    sku: t.exposeString('sku', { nullable: true }),
    tracked: t.exposeBoolean('tracked'),
    requiresShipping: t.exposeBoolean('requiresShipping'),
    unitCost: t.field({ type: MoneyV2, nullable: true, resolve: async (i, _a, ctx) => (i.unitCost == null ? null : moneyV2(i.unitCost, (await shopOf(ctx)).currency)) }),
    measurement: t.field({
      type: InventoryItemMeasurement,
      resolve: async (i, _a, ctx) => ({ id: toGid('InventoryItemMeasurement', i.id), weight: { unit: i.weightUnit ?? (await shopOf(ctx)).weightUnit, value: i.weightValue ?? 0 } }),
    }),
    countryCodeOfOrigin: t.exposeString('countryCodeOfOrigin', { nullable: true }),
    harmonizedSystemCode: t.exposeString('harmonizedSystemCode', { nullable: true }),
    createdAt: t.field({ type: 'DateTime', resolve: (i) => i.createdAt }),
    updatedAt: t.field({ type: 'DateTime', resolve: (i) => i.updatedAt }),
    variant: t.field({ type: ProductVariant, deprecationReason: 'Use `variants` instead.', resolve: async (i, _a, ctx) => (await getVariant(ctx.db, ctx.shopId, i.variantId))! }),
    inventoryLevel: t.field({
      type: InventoryLevel_, nullable: true, args: { locationId: t.arg.id({ required: true }), includeInactive: t.arg.boolean({ defaultValue: false }) },
      resolve: async (i, a, ctx) => {
        const loc = parseId(String(a.locationId), 'Location');
        if (!loc) return null;
        return (await listInventoryLevels(ctx.db, ctx.shopId, { itemId: i.id, locationId: loc, includeInactive: !!a.includeInactive }))[0] ?? null;
      },
    }),
    inventoryLevels: t.field({
      type: InventoryLevelConnection, args: { ...ConnectionArgs, includeInactive: t.arg.boolean({ defaultValue: false }), query: t.arg.string() },
      resolve: async (i, a, ctx) => {
        const all = await listInventoryLevels(ctx.db, ctx.shopId, { itemId: i.id, includeInactive: !!a.includeInactive });
        return paginate(a, { fetch: async ({ offset, limit }) => (a.reverse ? [...all].reverse() : all).slice(offset, offset + limit), total: async () => all.length });
      },
    }),
  }),
});

const levelGid = (l: InventoryLevel) => `${toGid('InventoryLevel', l.id)}?inventory_item_id=${l.inventoryItemId}`;

InventoryLevel_.implement({
  interfaces: [Node],
  fields: (t) => ({
    id: t.id({ resolve: levelGid }),
    isActive: t.exposeBoolean('isActive'),
    createdAt: t.field({ type: 'DateTime', resolve: (l) => l.createdAt }),
    updatedAt: t.field({ type: 'DateTime', resolve: (l) => l.updatedAt }),
    location: t.field({ type: Location_, resolve: async (l, _a, ctx) => (await getLocation(ctx.db, ctx.shopId, l.locationId))! }),
    item: t.field({ type: InventoryItem_, resolve: async (l, _a, ctx) => (await getInventoryItem(ctx.db, ctx.shopId, l.inventoryItemId))! }),
    quantities: t.field({
      type: [InventoryQuantity], args: { names: t.arg.stringList({ required: true }) },
      resolve: (l, a) => a.names.map((name) => {
        const col = QUANTITY_COLUMNS[name as keyof typeof QUANTITY_COLUMNS];
        if (!col) throw new Error(`Invalid quantity name: ${name}`);
        return { id: `${toGid('InventoryQuantity', l.id)}?name=${name}`, name, quantity: l[col], updatedAt: l.updatedAt };
      }),
    }),
  }),
});

registerNode('InventoryItem', (ctx, id) => getInventoryItem(ctx.db, ctx.shopId, id));
registerNode('InventoryLevel', (ctx, id) => getInventoryLevel(ctx.db, ctx.shopId, id));

/* ------------------------------ adjustment groups ------------------------------ */

const InventoryChange = builder.objectRef<AppliedChange>('InventoryChange').implement({
  fields: (t) => ({
    delta: t.exposeInt('delta'), name: t.exposeString('name'), quantityAfterChange: t.exposeInt('quantityAfter', { nullable: true }),
    ledgerDocumentUri: t.exposeString('ledgerDocumentUri', { nullable: true }),
    item: t.field({ type: InventoryItem_, nullable: true, resolve: (c, _a, ctx) => getInventoryItem(ctx.db, ctx.shopId, c.inventoryItemId) }),
    location: t.field({ type: Location_, nullable: true, resolve: (c, _a, ctx) => getLocation(ctx.db, ctx.shopId, c.locationId) }),
  }),
});

export const InventoryAdjustmentGroup = builder.objectRef<AdjustmentGroup>('InventoryAdjustmentGroup').implement({
  interfaces: [Node],
  fields: (t) => ({
    createdAt: t.field({ type: 'DateTime', resolve: (g) => g.createdAt }),
    reason: t.exposeString('reason'),
    referenceDocumentUri: t.exposeString('referenceDocumentUri', { nullable: true }),
    changes: t.field({
      type: [InventoryChange],
      args: { inventoryItemIds: t.arg.idList(), locationIds: t.arg.idList(), quantityNames: t.arg.stringList() },
      resolve: (g, a) => {
        const items = a.inventoryItemIds?.map((i) => parseId(String(i), 'InventoryItem'));
        const locs = a.locationIds?.map((i) => parseId(String(i), 'Location'));
        return g.changes.filter((c) => (!items || items.includes(c.inventoryItemId)) && (!locs || locs.includes(c.locationId)) && (!a.quantityNames || a.quantityNames.includes(c.name)));
      },
    }),
  }),
});

const InventoryChangeInput = builder.inputType('InventoryChangeInput', {
  fields: (t) => ({ delta: t.int({ required: true }), changeFromQuantity: t.int(), inventoryItemId: t.id({ required: true }), locationId: t.id({ required: true }), ledgerDocumentUri: t.string() }),
});
const InventoryAdjustQuantitiesInput = builder.inputType('InventoryAdjustQuantitiesInput', {
  fields: (t) => ({ reason: t.string({ required: true }), name: t.string({ required: true }), referenceDocumentUri: t.string(), changes: t.field({ type: [InventoryChangeInput], required: true }) }),
});
const InventoryQuantityInput = builder.inputType('InventoryQuantityInput', {
  fields: (t) => ({ inventoryItemId: t.id({ required: true }), locationId: t.id({ required: true }), quantity: t.int({ required: true }), changeFromQuantity: t.int() }),
});
const InventorySetQuantitiesInput = builder.inputType('InventorySetQuantitiesInput', {
  fields: (t) => ({ reason: t.string({ required: true }), name: t.string({ required: true }), referenceDocumentUri: t.string(), quantities: t.field({ type: [InventoryQuantityInput], required: true }) }),
});

const group = (g: AdjustmentGroup | null) => ({ inventoryAdjustmentGroup: g });
const AdjustPayload = defineTypedPayload<{ inventoryAdjustmentGroup: AdjustmentGroup | null }>('InventoryAdjustQuantitiesPayload', 'InventoryAdjustQuantitiesUserError', (t) => ({
  inventoryAdjustmentGroup: t.field({ type: InventoryAdjustmentGroup, nullable: true, resolve: (p) => p.inventoryAdjustmentGroup }),
}));
const SetPayload = defineTypedPayload<{ inventoryAdjustmentGroup: AdjustmentGroup | null }>('InventorySetQuantitiesPayload', 'InventorySetQuantitiesUserError', (t) => ({
  inventoryAdjustmentGroup: t.field({ type: InventoryAdjustmentGroup, nullable: true, resolve: (p) => p.inventoryAdjustmentGroup }),
}));
const ItemUpdatePayload = definePayload<{ inventoryItem: import('@shopme/core').InventoryItem | null }>('InventoryItemUpdatePayload', (t) => ({
  inventoryItem: t.field({ type: InventoryItem_, nullable: true, resolve: (p) => p.inventoryItem }),
}));

/** `[{inventoryItemId, locationId}]` ids parsed; null entries become an INVALID error at the given index. */
function parseRefs<T extends { inventoryItemId: string | number; locationId: string | number }>(rows: T[], root: string[]) {
  const out: (Omit<T, 'inventoryItemId' | 'locationId'> & { inventoryItemId: number; locationId: number })[] = [];
  for (const [i, r] of rows.entries()) {
    const item = parseId(String(r.inventoryItemId), 'InventoryItem');
    const loc = parseId(String(r.locationId), 'Location');
    if (!item) return { error: { field: [...root, String(i), 'inventoryItemId'], message: 'The specified inventory item could not be found.', code: 'INVALID_INVENTORY_ITEM' } };
    if (!loc) return { error: { field: [...root, String(i), 'locationId'], message: 'The specified location could not be found.', code: 'INVALID_LOCATION' } };
    out.push({ ...r, inventoryItemId: item, locationId: loc });
  }
  return { rows: out };
}

builder.queryFields((t) => ({
  inventoryItem: t.field({
    type: InventoryItem_, nullable: true, args: { id: t.arg.id({ required: true }) },
    resolve: (_r, a, ctx) => { requireScope(ctx, 'read_inventory'); const id = parseId(String(a.id), 'InventoryItem'); return id ? getInventoryItem(ctx.db, ctx.shopId, id) : null; },
  }),
  inventoryLevel: t.field({
    type: InventoryLevel_, nullable: true, args: { id: t.arg.id({ required: true }) },
    resolve: (_r, a, ctx) => { requireScope(ctx, 'read_inventory'); const id = parseId(String(a.id).split('?')[0]!, 'InventoryLevel'); return id ? getInventoryLevel(ctx.db, ctx.shopId, id) : null; },
  }),
  inventoryItems: t.field({
    type: InventoryItemConnection, args: { ...ConnectionArgs, query: t.arg.string() },
    resolve: (_r, a, ctx) => { requireScope(ctx, 'read_inventory'); return paginate(a, { fetch: ({ offset, limit }) => listInventoryItems(ctx.db, ctx.shopId, { query: a.query, reverse: !!a.reverse, offset, limit }) }); },
  }),
}));

builder.mutationFields((t) => ({
  inventoryAdjustQuantities: t.field({
    type: AdjustPayload, args: { input: t.arg({ type: InventoryAdjustQuantitiesInput, required: true }) },
    resolve: async (_r, { input }, ctx) => {
      requireScope(ctx, 'write_inventory');
      const parsed = parseRefs(input.changes, ['input', 'changes']);
      if (!parsed.rows) return { ...group(null), userErrors: [parsed.error!] };
      const r = await adjustQuantities(ctx.db, ctx.shopId, { name: input.name, reason: input.reason, referenceDocumentUri: input.referenceDocumentUri, changes: parsed.rows });
      return r.ok ? { ...group(r.value), userErrors: [] } : { ...group(null), userErrors: r.errors };
    },
  }),
  inventorySetQuantities: t.field({
    type: SetPayload, args: { input: t.arg({ type: InventorySetQuantitiesInput, required: true }) },
    resolve: async (_r, { input }, ctx) => {
      requireScope(ctx, 'write_inventory');
      const parsed = parseRefs(input.quantities, ['input', 'quantities']);
      if (!parsed.rows) return { ...group(null), userErrors: [parsed.error!] };
      const r = await setQuantities(ctx.db, ctx.shopId, { name: input.name, reason: input.reason, referenceDocumentUri: input.referenceDocumentUri, quantities: parsed.rows });
      return r.ok ? { ...group(r.value), userErrors: [] } : { ...group(null), userErrors: r.errors };
    },
  }),
  inventoryItemUpdate: t.field({
    type: ItemUpdatePayload, args: { id: t.arg.id({ required: true }), input: t.arg({ type: InventoryItemInput, required: true }) },
    resolve: async (_r, a, ctx) => {
      requireScope(ctx, 'write_inventory');
      const id = parseId(String(a.id), 'InventoryItem');
      if (!id) return { inventoryItem: null, userErrors: [{ field: ['id'], message: 'Inventory item not found.' }] };
      const r = await updateInventoryItem(ctx.db, ctx.shopId, id, toItemUpdate(a.input, (await shopOf(ctx)).currency)!);
      return r.ok ? { inventoryItem: r.value, userErrors: [] } : { inventoryItem: null, userErrors: prefixed(r.errors, []) };
    },
  }),
}));

