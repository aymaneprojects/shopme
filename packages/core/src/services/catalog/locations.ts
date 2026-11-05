import { and, asc, eq, sql } from 'drizzle-orm';
import { inventoryLevels, locations } from '../../db/schema';
import type { Db } from '../../db/client';
import { emit, errR, okR, txResult, type Result } from './common';
import { addLocationToGeneralProfile } from '../shipping/profiles';
import { applyChanges, getInventoryItem, getLocation, listInventoryLevels, type AdjustmentGroup, type Location, type QuantityName } from './inventory';

export async function countLocations(db: Db, shopId: number, includeInactive = false): Promise<number> {
  const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(locations).where(and(eq(locations.shopId, shopId), includeInactive ? undefined : eq(locations.isActive, true)));
  return r?.n ?? 0;
}

export interface MoveChange { inventoryItemId: number; quantity: number; from: { locationId: number; name: string }; to: { locationId: number; name: string } }

/** Move stock between locations (same quantity name on both sides, e.g. available -> available). One ledger group, all or nothing. */
export async function moveQuantities(db: Db, shopId: number, input: { reason: string; referenceDocumentUri?: string | null; changes: MoveChange[] }): Promise<Result<AdjustmentGroup>> {
  const root = ['input', 'changes'];
  for (const [i, c] of input.changes.entries()) {
    if (c.quantity <= 0) return errR([...root, String(i), 'quantity'], 'The quantity must be greater than zero.', 'INVALID_QUANTITY_NEGATIVE');
    if (c.from.name !== c.to.name) return errR([...root, String(i), 'to', 'name'], 'Moving between different quantity names is not supported.', 'INVALID_QUANTITY_NAME');
    if (c.from.locationId === c.to.locationId) return errR([...root, String(i), 'to', 'locationId'], 'The source and destination locations must differ.', 'DIFFERENT_LOCATIONS');
  }
  return txResult(db, async (tx) => {
    const flat = input.changes.flatMap((c) => [
      { inventoryItemId: c.inventoryItemId, locationId: c.from.locationId, delta: -c.quantity, name: c.from.name },
      { inventoryItemId: c.inventoryItemId, locationId: c.to.locationId, delta: c.quantity, name: c.to.name },
    ]);
    // `applyChanges` handles one quantity name at a time; moves of several names are applied in sequence and merged.
    let merged: AdjustmentGroup | undefined;
    for (const name of new Set(flat.map((f) => f.name))) {
      const r = await applyChanges(tx, shopId, name as QuantityName, input.reason, input.referenceDocumentUri, flat.filter((f) => f.name === name), root, true);
      if (!r.ok) return r;
      const prev: AdjustmentGroup | undefined = merged;
      merged = prev ? { ...prev, changes: [...prev.changes, ...r.value.changes] } : r.value;
    }
    return okR(merged!);
  });
}

/** Stop stocking an item at a location. The item must stay stocked somewhere and nothing may be committed there. */
export async function deactivateLevel(db: Db, shopId: number, inventoryItemId: number, locationId: number): Promise<Result<true>> {
  const [lv] = await db.select().from(inventoryLevels).where(and(eq(inventoryLevels.shopId, shopId), eq(inventoryLevels.inventoryItemId, inventoryItemId), eq(inventoryLevels.locationId, locationId)));
  if (!lv?.isActive) return errR(['locationId'], 'The inventory item is not stocked at this location.', 'NOT_FOUND');
  if (!(await getInventoryItem(db, shopId, inventoryItemId))) return errR(['inventoryItemId'], 'Inventory item not found.', 'NOT_FOUND');
  const others = (await listInventoryLevels(db, shopId, { itemId: inventoryItemId })).filter((l) => l.locationId !== locationId);
  if (!others.length) return errR(['locationId'], 'The inventory item must be stocked at at least one location.', 'INVENTORY_ITEM_HAS_ONLY_ONE_LOCATION');
  if (lv.committed > 0 || lv.reserved > 0) return errR(['locationId'], 'Stock is committed to orders at this location.', 'HAS_COMMITTED_INVENTORY');
  await db.update(inventoryLevels).set({ isActive: false, available: 0, onHand: 0, incoming: 0 }).where(eq(inventoryLevels.id, lv.id));
  return okR(true);
}

/** Move all stock of a location into another one (every quantity column), used when deactivating a location. */
async function drainLocation(tx: Parameters<Parameters<Db['transaction']>[0]>[0], shopId: number, from: number, to: number) {
  const levels = await tx.select().from(inventoryLevels).where(and(eq(inventoryLevels.shopId, shopId), eq(inventoryLevels.locationId, from), eq(inventoryLevels.isActive, true)));
  for (const lv of levels) {
    await tx.insert(inventoryLevels).values({ shopId, inventoryItemId: lv.inventoryItemId, locationId: to, available: lv.available, onHand: lv.onHand, committed: lv.committed, incoming: lv.incoming, reserved: lv.reserved })
      .onConflictDoUpdate({
        target: [inventoryLevels.inventoryItemId, inventoryLevels.locationId],
        set: {
          isActive: true, available: sql`${inventoryLevels.available} + ${lv.available}`, onHand: sql`${inventoryLevels.onHand} + ${lv.onHand}`, committed: sql`${inventoryLevels.committed} + ${lv.committed}`,
          incoming: sql`${inventoryLevels.incoming} + ${lv.incoming}`, reserved: sql`${inventoryLevels.reserved} + ${lv.reserved}`,
        },
      });
    await tx.update(inventoryLevels).set({ isActive: false, available: 0, onHand: 0, committed: 0, incoming: 0, reserved: 0 }).where(eq(inventoryLevels.id, lv.id));
  }
}

/** Deactivate (stock moves to `destinationId`, required when the location holds stock) or reactivate a location. */
export async function setLocationActive(db: Db, shopId: number, id: number, active: boolean, destinationId?: number | null): Promise<Result<Location>> {
  const cur = await getLocation(db, shopId, id);
  if (!cur) return errR(['locationId'], 'Location not found.', 'LOCATION_NOT_FOUND');
  if (cur.isActive === active) return okR(cur);
  return txResult(db, async (tx) => {
    if (active) {
      const dup = await tx.select({ id: locations.id }).from(locations).where(and(eq(locations.shopId, shopId), eq(locations.isActive, true), sql`lower(${locations.name}) = ${cur.name.toLowerCase()}`));
      if (dup.length) return errR(['locationId'], 'You already have an active location with this name.', 'HAS_NON_UNIQUE_NAME');
    } else {
      const active = await tx.select({ id: locations.id }).from(locations).where(and(eq(locations.shopId, shopId), eq(locations.isActive, true)));
      if (active.length <= 1) return errR(['locationId'], 'You must keep at least one active location.', 'PERMANENTLY_BLOCKED_FROM_DEACTIVATION_ERROR');
      const stocked = (await tx.select().from(inventoryLevels).where(and(eq(inventoryLevels.shopId, shopId), eq(inventoryLevels.locationId, id), eq(inventoryLevels.isActive, true))))
        .some((l) => l.available > 0 || l.onHand > 0 || l.committed > 0 || l.incoming > 0);
      if (stocked) {
        const dest = destinationId ? await getLocation(tx, shopId, destinationId) : null;
        if (!dest?.isActive || dest.id === id) return errR(['destinationLocationId'], 'Choose another active location to move the inventory to.', 'HAS_ACTIVE_INVENTORY_ERROR');
        await drainLocation(tx, shopId, id, dest.id);
      }
    }
    const [row] = await tx.update(locations).set({ isActive: active, updatedAt: new Date() }).where(eq(locations.id, id)).returning();
    await emit(tx, shopId, 'location', id, active ? 'locations/activate' : 'locations/deactivate');
    if (active && row!.fulfillsOnlineOrders) await addLocationToGeneralProfile(tx, shopId, id);
    return okR(row!);
  });
}

/** Allocation priority for online orders: the given location ids first (in order), the rest after. */
export async function reorderLocations(db: Db, shopId: number, orderedIds: number[]): Promise<void> {
  const all = await db.select({ id: locations.id }).from(locations).where(eq(locations.shopId, shopId)).orderBy(asc(locations.priority), asc(locations.id));
  const order = [...orderedIds.filter((i) => all.some((a) => a.id === i)), ...all.map((a) => a.id).filter((i) => !orderedIds.includes(i))];
  await db.transaction(async (tx) => { for (const [i, id] of order.entries()) await tx.update(locations).set({ priority: i }).where(and(eq(locations.shopId, shopId), eq(locations.id, id))); });
}

