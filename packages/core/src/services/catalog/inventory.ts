import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { inventoryAdjustments, inventoryItems, inventoryLevels, locations, productVariants } from '../../db/schema';
import type { Db, Executor } from '../../db/client';
import { WEIGHT_UNITS } from '../../db/schema/shop';
import { buildSearch, idTerm, likeCi } from './search';
import { emit, errR, okR, txResult, type Result } from './common';
import { recomputeSmartMembership } from './collections';

export type Location = typeof locations.$inferSelect;
export type InventoryItem = typeof inventoryItems.$inferSelect;
export type InventoryLevel = typeof inventoryLevels.$inferSelect;
export type WeightUnit = (typeof WEIGHT_UNITS)[number];

/** Quantity names exposed by the API, mapped to `inventory_levels` columns. */
export const QUANTITY_COLUMNS = { available: 'available', on_hand: 'onHand', committed: 'committed', incoming: 'incoming', reserved: 'reserved' } as const;
export type QuantityName = keyof typeof QUANTITY_COLUMNS;
export const QUANTITY_NAMES = Object.keys(QUANTITY_COLUMNS) as QuantityName[];

export const ADJUSTMENT_REASONS = [
  'correction', 'cycle_count_available', 'damaged', 'movement_created', 'movement_updated', 'movement_received', 'movement_canceled',
  'other', 'promotion', 'quality_control', 'received', 'reservation_created', 'reservation_deleted', 'reservation_updated', 'restock', 'safety_stock', 'shrinkage',
];

/* ------------------------------ locations ------------------------------ */

export async function getLocation(db: Executor, shopId: number, id: number): Promise<Location | null> {
  const [r] = await db.select().from(locations).where(and(eq(locations.shopId, shopId), eq(locations.id, id))).limit(1);
  return r ?? null;
}

export interface ListLocationsOptions { includeInactive?: boolean; query?: string | null; sortKey?: 'ID' | 'NAME' | 'CREATED_AT' | 'RELEVANCE'; reverse?: boolean; offset: number; limit: number }

export async function listLocations(db: Executor, shopId: number, o: ListLocationsOptions): Promise<Location[]> {
  const search = buildSearch(o.query, {
    fields: { name: (_op, v) => likeCi(locations.name, v), id: (_op, v) => idTerm(locations.id, v), active: (_op, v) => sql`${locations.isActive} = ${v === 'true'}` },
    text: (v) => likeCi(locations.name, v),
  });
  const col = o.sortKey === 'ID' ? locations.id : o.sortKey === 'CREATED_AT' ? locations.createdAt : locations.name;
  return db.select().from(locations)
    .where(and(eq(locations.shopId, shopId), o.includeInactive ? undefined : eq(locations.isActive, true), search))
    .orderBy(o.reverse ? desc(col) : asc(col), o.reverse ? desc(locations.id) : asc(locations.id))
    .limit(o.limit).offset(o.offset);
}

export interface LocationAddressInput { address1?: string | null; address2?: string | null; city?: string | null; phone?: string | null; zip?: string | null; countryCode?: string | null; provinceCode?: string | null }
export interface LocationInput { name?: string | null; address?: LocationAddressInput | null; fulfillsOnlineOrders?: boolean | null }

async function validateLocation(db: Executor, shopId: number, input: LocationInput, selfId?: number): Promise<Result<null>> {
  if (input.name !== undefined && !input.name?.trim()) return errR(['name'], "Add a location name", 'BLANK');
  if (input.name && input.name.length > 100) return errR(['name'], 'Location name is too long (maximum is 100 characters)', 'TOO_LONG');
  if (input.name) {
    const rows = await db.select({ id: locations.id }).from(locations).where(and(eq(locations.shopId, shopId), eq(locations.isActive, true), sql`lower(${locations.name}) = ${input.name.trim().toLowerCase()}`));
    if (rows.some((r) => r.id !== selfId)) return errR(['name'], 'You already have a location with this name', 'TAKEN');
  }
  const cc = input.address?.countryCode;
  if (cc !== undefined && cc !== null && !/^[A-Z]{2}$/.test(cc)) return errR(['address', 'countryCode'], 'Country code is invalid', 'INVALID');
  return okR(null);
}

const addressCols = (a: LocationAddressInput) => ({
  ...(a.address1 !== undefined && { address1: a.address1 }), ...(a.address2 !== undefined && { address2: a.address2 }), ...(a.city !== undefined && { city: a.city }),
  ...(a.phone !== undefined && { phone: a.phone }), ...(a.zip !== undefined && { zip: a.zip }), ...(a.countryCode ? { countryCode: a.countryCode } : {}),
  ...(a.provinceCode !== undefined && { provinceCode: a.provinceCode }),
});

export async function addLocation(db: Executor, shopId: number, input: LocationInput): Promise<Result<Location>> {
  const v = await validateLocation(db, shopId, input);
  if (!v.ok) return v;
  const [row] = await db.insert(locations).values({ shopId, name: input.name!.trim(), fulfillsOnlineOrders: input.fulfillsOnlineOrders ?? true, ...addressCols(input.address ?? {}) }).returning();
  await emit(db, shopId, 'location', row!.id, 'locations/create');
  return okR(row!);
}

export async function editLocation(db: Executor, shopId: number, id: number, input: LocationInput): Promise<Result<Location>> {
  const cur = await getLocation(db, shopId, id);
  if (!cur) return errR(['id'], 'Location not found.', 'NOT_FOUND');
  const v = await validateLocation(db, shopId, input, id);
  if (!v.ok) return v;
  const [row] = await db.update(locations).set({
    ...(input.name ? { name: input.name.trim() } : {}), ...(input.fulfillsOnlineOrders != null && { fulfillsOnlineOrders: input.fulfillsOnlineOrders }), ...addressCols(input.address ?? {}),
  }).where(and(eq(locations.shopId, shopId), eq(locations.id, id))).returning();
  await emit(db, shopId, 'location', id, 'locations/update');
  return okR(row!);
}

/** The location new stock goes to by default: the oldest active one. */
export async function defaultLocationId(db: Executor, shopId: number): Promise<number | null> {
  const [r] = await db.select({ id: locations.id }).from(locations).where(and(eq(locations.shopId, shopId), eq(locations.isActive, true))).orderBy(asc(locations.id)).limit(1);
  return r?.id ?? null;
}

/* ------------------------------ items and levels ------------------------------ */

export async function getInventoryItem(db: Executor, shopId: number, id: number): Promise<InventoryItem | null> {
  const [r] = await db.select().from(inventoryItems).where(and(eq(inventoryItems.shopId, shopId), eq(inventoryItems.id, id))).limit(1);
  return r ?? null;
}

export async function getInventoryItemForVariant(db: Executor, shopId: number, variantId: number): Promise<InventoryItem | null> {
  const [r] = await db.select().from(inventoryItems).where(and(eq(inventoryItems.shopId, shopId), eq(inventoryItems.variantId, variantId))).limit(1);
  return r ?? null;
}

export async function listInventoryItems(db: Executor, shopId: number, o: { query?: string | null; reverse?: boolean; offset: number; limit: number }): Promise<InventoryItem[]> {
  const search = buildSearch(o.query, {
    fields: { sku: (_op, v) => likeCi(inventoryItems.sku, v, true), id: (_op, v) => idTerm(inventoryItems.id, v), tracked: (_op, v) => sql`${inventoryItems.tracked} = ${v === 'true'}` },
    text: (v) => likeCi(inventoryItems.sku, v),
  });
  return db.select().from(inventoryItems).where(and(eq(inventoryItems.shopId, shopId), search))
    .orderBy(o.reverse ? desc(inventoryItems.id) : asc(inventoryItems.id)).limit(o.limit).offset(o.offset);
}

export async function getInventoryLevel(db: Executor, shopId: number, id: number): Promise<InventoryLevel | null> {
  const [r] = await db.select().from(inventoryLevels).where(and(eq(inventoryLevels.shopId, shopId), eq(inventoryLevels.id, id))).limit(1);
  return r ?? null;
}

export function listInventoryLevels(db: Executor, shopId: number, filter: { itemId?: number; locationId?: number; includeInactive?: boolean }): Promise<InventoryLevel[]> {
  return db.select().from(inventoryLevels).where(and(
    eq(inventoryLevels.shopId, shopId),
    filter.itemId ? eq(inventoryLevels.inventoryItemId, filter.itemId) : undefined,
    filter.locationId ? eq(inventoryLevels.locationId, filter.locationId) : undefined,
    filter.includeInactive ? undefined : eq(inventoryLevels.isActive, true),
  )).orderBy(asc(inventoryLevels.id));
}

/** Start stocking an item at a location (idempotent; reactivates a deactivated level). */
export async function activateLevel(db: Executor, shopId: number, inventoryItemId: number, locationId: number, available = 0): Promise<InventoryLevel> {
  const [row] = await db.insert(inventoryLevels).values({ shopId, inventoryItemId, locationId, available, onHand: available })
    .onConflictDoUpdate({ target: [inventoryLevels.inventoryItemId, inventoryLevels.locationId], set: { isActive: true } }).returning();
  return row!;
}

/** Sum of `available` over active levels, per variant id. */
export async function availableByVariant(db: Executor, shopId: number, variantIds: number[]): Promise<Map<number, number>> {
  const out = new Map<number, number>();
  if (!variantIds.length) return out;
  const rows = await db.select({ variantId: inventoryItems.variantId, n: sql<number>`coalesce(sum(${inventoryLevels.available}), 0)::int` })
    .from(inventoryItems).leftJoin(inventoryLevels, and(eq(inventoryLevels.inventoryItemId, inventoryItems.id), eq(inventoryLevels.isActive, true)))
    .where(and(eq(inventoryItems.shopId, shopId), inArray(inventoryItems.variantId, variantIds))).groupBy(inventoryItems.variantId);
  for (const r of rows) out.set(r.variantId, r.n);
  return out;
}

export interface InventoryItemUpdate {
  sku?: string | null; cost?: number | null; tracked?: boolean | null; countryCodeOfOrigin?: string | null; harmonizedSystemCode?: string | null;
  requiresShipping?: boolean | null; weight?: { value: number; unit: WeightUnit } | null;
}

export function inventoryItemPatch(input: InventoryItemUpdate) {
  return {
    ...(input.sku !== undefined && { sku: input.sku || null }),
    ...(input.cost !== undefined && { unitCost: input.cost }),
    ...(input.tracked != null && { tracked: input.tracked }),
    ...(input.countryCodeOfOrigin !== undefined && { countryCodeOfOrigin: input.countryCodeOfOrigin }),
    ...(input.harmonizedSystemCode !== undefined && { harmonizedSystemCode: input.harmonizedSystemCode }),
    ...(input.requiresShipping != null && { requiresShipping: input.requiresShipping }),
    ...(input.weight && { weightValue: input.weight.value, weightUnit: input.weight.unit }),
  };
}

export async function updateInventoryItem(db: Db, shopId: number, id: number, input: InventoryItemUpdate): Promise<Result<InventoryItem>> {
  const cur = await getInventoryItem(db, shopId, id);
  if (!cur) return errR(['id'], "The product couldn't be found.");
  if (input.weight && (!Number.isFinite(input.weight.value) || input.weight.value < 0)) return errR(['input', 'measurement', 'weight', 'value'], 'Weight must be greater than or equal to 0');
  if (input.cost != null && input.cost < 0) return errR(['input', 'cost'], 'Cost must be greater than or equal to 0');
  const patch = inventoryItemPatch(input);
  const row = await db.transaction(async (tx) => {
    const [r] = await tx.update(inventoryItems).set(patch).where(and(eq(inventoryItems.shopId, shopId), eq(inventoryItems.id, id))).returning();
    if (input.sku !== undefined) await tx.update(productVariants).set({ sku: input.sku || null }).where(eq(productVariants.id, cur.variantId));
    await emit(tx, shopId, 'inventory_item', id, 'inventory_items/update');
    return r!;
  });
  return okR(row);
}

/* ------------------------------ quantity changes ------------------------------ */

export interface AppliedChange { inventoryItemId: number; locationId: number; name: string; delta: number; quantityAfter: number; ledgerDocumentUri: string | null }
export interface AdjustmentGroup { id: number; reason: string; referenceDocumentUri: string | null; createdAt: Date; changes: AppliedChange[] }
export interface QuantityChange { inventoryItemId: number; locationId: number; delta: number; changeFromQuantity?: number | null; ledgerDocumentUri?: string | null }

type Eff = { available: number; onHand: number; committed: number; incoming: number; reserved: number };
/** How a change to one named quantity moves the others (on_hand = available + committed + reserved). */
function effects(name: QuantityName, d: number): [QuantityName, number][] {
  switch (name) {
    case 'available': return [['available', d], ['on_hand', d]];
    case 'on_hand': return [['on_hand', d], ['available', d]];
    case 'committed': return [['committed', d], ['available', -d]];
    case 'reserved': return [['reserved', d], ['available', -d]];
    default: return [['incoming', d]];
  }
}

/** Core of adjust/set: validates and applies changes inside `tx`, writes the ledger. */
async function applyChanges(
  tx: Executor, shopId: number, name: QuantityName, reason: string, referenceUri: string | null | undefined,
  changes: (QuantityChange & { absolute?: number })[], fieldRoot: string[], createLevels: boolean,
): Promise<Result<AdjustmentGroup>> {
  const applied: AppliedChange[] = [];
  const ledger: { change: AppliedChange }[] = [];
  for (const [i, c] of changes.entries()) {
    const at = [...fieldRoot, String(i)];
    if (!(await getInventoryItem(tx, shopId, c.inventoryItemId))) return errR([...at, 'inventoryItemId'], 'The specified inventory item could not be found.', 'INVALID_INVENTORY_ITEM');
    if (!(await getLocation(tx, shopId, c.locationId))) return errR([...at, 'locationId'], 'The specified location could not be found.', 'INVALID_LOCATION');
    let [level] = await tx.select().from(inventoryLevels).where(and(eq(inventoryLevels.inventoryItemId, c.inventoryItemId), eq(inventoryLevels.locationId, c.locationId), eq(inventoryLevels.shopId, shopId)));
    if (!level || !level.isActive) {
      if (!createLevels) return errR([...at, 'locationId'], 'The specified inventory item is not stocked at the location.', 'INVALID_LOCATION');
      level = await activateLevel(tx, shopId, c.inventoryItemId, c.locationId, 0);
    }
    const cur: Eff = level;
    const key = QUANTITY_COLUMNS[name];
    const current = cur[key];
    if (c.changeFromQuantity != null && c.changeFromQuantity !== current) {
      return errR([...at, 'changeFromQuantity'], "The specified 'changeFromQuantity' does not match the current quantity.", 'CHANGE_FROM_QUANTITY_STALE');
    }
    const delta = c.absolute !== undefined ? c.absolute - current : c.delta;
    const next: Eff = { ...cur };
    for (const [n, d] of effects(name, delta)) {
      next[QUANTITY_COLUMNS[n]] += d;
      applied.push({ inventoryItemId: c.inventoryItemId, locationId: c.locationId, name: n, delta: d, quantityAfter: next[QUANTITY_COLUMNS[n]], ledgerDocumentUri: c.ledgerDocumentUri ?? null });
      ledger.push({ change: applied.at(-1)! });
    }
    await tx.update(inventoryLevels).set({ available: next.available, onHand: next.onHand, committed: next.committed, incoming: next.incoming, reserved: next.reserved }).where(eq(inventoryLevels.id, level.id));
  }
  if (!ledger.length) return errR(fieldRoot, 'At least one change is required.');
  let groupId = 0;
  for (const { change } of ledger) {
    const [row] = await tx.insert(inventoryAdjustments).values({
      shopId, groupId: groupId || null, inventoryItemId: change.inventoryItemId, locationId: change.locationId, name: change.name, delta: change.delta,
      quantityAfter: change.quantityAfter, reason, referenceUri: referenceUri ?? null,
    }).returning();
    if (!groupId) { groupId = row!.id; await tx.update(inventoryAdjustments).set({ groupId }).where(eq(inventoryAdjustments.id, groupId)); }
  }
  for (const itemId of new Set(applied.map((a) => a.inventoryItemId))) await emit(tx, shopId, 'inventory_item', itemId, 'inventory_levels/update');
  return okR({ id: groupId, reason, referenceDocumentUri: referenceUri ?? null, createdAt: new Date(), changes: applied });
}

/** After stock changes, smart collections with inventory rules may need a refresh. */
async function refreshCollectionsForItems(tx: Executor, shopId: number, itemIds: number[]) {
  const rows = await tx.select({ productId: productVariants.productId }).from(inventoryItems).innerJoin(productVariants, eq(productVariants.id, inventoryItems.variantId))
    .where(and(eq(inventoryItems.shopId, shopId), inArray(inventoryItems.id, itemIds)));
  await recomputeSmartMembership(tx, shopId, [...new Set(rows.map((r) => r.productId))]);
}

export async function adjustQuantities(db: Db, shopId: number, input: { name: string; reason: string; referenceDocumentUri?: string | null; changes: QuantityChange[] }): Promise<Result<AdjustmentGroup>> {
  if (!(input.name in QUANTITY_COLUMNS)) return errR(['input', 'name'], `The quantity name must be one of: ${QUANTITY_NAMES.join(', ')}.`, 'INVALID_QUANTITY_NAME');
  if (!ADJUSTMENT_REASONS.includes(input.reason)) return errR(['input', 'reason'], 'The specified reason is invalid.', 'INVALID_REASON');
  return txResult(db, async (tx) => {
    const r = await applyChanges(tx, shopId, input.name as QuantityName, input.reason, input.referenceDocumentUri, input.changes, ['input', 'changes'], false);
    if (r.ok) await refreshCollectionsForItems(tx, shopId, input.changes.map((c) => c.inventoryItemId));
    return r;
  });
}

export async function setQuantities(db: Db, shopId: number, input: { name: string; reason: string; referenceDocumentUri?: string | null; quantities: { inventoryItemId: number; locationId: number; quantity: number; changeFromQuantity?: number | null }[] }): Promise<Result<AdjustmentGroup>> {
  if (input.name !== 'available' && input.name !== 'on_hand') return errR(['input', 'name'], 'The quantity name must be either available or on_hand.', 'INVALID_NAME');
  if (!ADJUSTMENT_REASONS.includes(input.reason)) return errR(['input', 'reason'], 'The specified reason is invalid.', 'INVALID_REASON');
  const bad = input.quantities.findIndex((q) => q.quantity < 0);
  if (bad >= 0) return errR(['input', 'quantities', String(bad), 'quantity'], 'The quantity can not be negative.', 'INVALID_QUANTITY_NEGATIVE');
  return txResult(db, async (tx) => {
    const r = await applyChanges(tx, shopId, input.name as QuantityName, input.reason, input.referenceDocumentUri,
      input.quantities.map((q) => ({ inventoryItemId: q.inventoryItemId, locationId: q.locationId, delta: 0, absolute: q.quantity, changeFromQuantity: q.changeFromQuantity })),
      ['input', 'quantities'], true);
    if (r.ok) await refreshCollectionsForItems(tx, shopId, input.quantities.map((c) => c.inventoryItemId));
    return r;
  });
}
