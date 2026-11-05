import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import {
  inventoryAdjustments, inventoryItems, inventoryLevels, inventoryShipmentLines, inventoryShipments, inventoryTransferLines, inventoryTransfers, locations, productVariants, products, purchaseOrders,
  type LocationSnapshotData,
} from '../db/schema';
import type { Db, Executor, Tx } from '../db/client';
import { buildSearch, dateCompare, idTerm, likeCi } from './catalog/search';
import { emit, errR, normalizeTags, okR, txResult, type Result } from './catalog/common';
import { activateLevel } from './catalog/inventory';
import { nextSequence } from './sequences';
import { applyPurchaseOrderReceipt } from './purchase-orders';

export type { LocationSnapshotData } from '../db/schema';
export type InventoryTransfer = typeof inventoryTransfers.$inferSelect;
export type InventoryShipment = typeof inventoryShipments.$inferSelect;
export type TransferStatus = 'DRAFT' | 'READY_TO_SHIP' | 'IN_PROGRESS' | 'TRANSFERRED' | 'CANCELED';
export type ShipmentStatus = 'DRAFT' | 'IN_TRANSIT' | 'PARTIALLY_RECEIVED' | 'RECEIVED';
export type ReceiveReason = 'ACCEPTED' | 'REJECTED' | 'CANCELED';

export const MAX_TRANSFER_LINES = 10_000;
export const transferUri = (id: number) => `gid://shopify/InventoryTransfer/${id}`;

/* ------------------------------ ledger helper ------------------------------ */

export interface LevelDelta { inventoryItemId: number; locationId: number; available?: number; onHand?: number; incoming?: number; reserved?: number }
const NAMES = [['available', 'available'], ['onHand', 'on_hand'], ['incoming', 'incoming'], ['reserved', 'reserved']] as const;

/**
 * Apply explicit per-column deltas to inventory levels and append them to the ledger under one group id.
 * Missing or inactive levels are (re)activated at zero: the destination of a transfer is stocked on first use.
 */
export async function applyLevelDeltas(tx: Executor, shopId: number, reason: string, referenceUri: string | null, deltas: LevelDelta[]): Promise<void> {
  const rows: { itemId: number; locationId: number; name: string; delta: number; after: number }[] = [];
  for (const d of deltas) {
    if (!NAMES.some(([k]) => d[k])) continue;
    let [lv] = await tx.select().from(inventoryLevels).where(and(eq(inventoryLevels.shopId, shopId), eq(inventoryLevels.inventoryItemId, d.inventoryItemId), eq(inventoryLevels.locationId, d.locationId)));
    if (!lv || !lv.isActive) lv = await activateLevel(tx, shopId, d.inventoryItemId, d.locationId, 0);
    const next = { available: lv.available + (d.available ?? 0), onHand: lv.onHand + (d.onHand ?? 0), incoming: lv.incoming + (d.incoming ?? 0), reserved: lv.reserved + (d.reserved ?? 0) };
    await tx.update(inventoryLevels).set(next).where(eq(inventoryLevels.id, lv.id));
    for (const [k, name] of NAMES) if (d[k]) rows.push({ itemId: d.inventoryItemId, locationId: d.locationId, name, delta: d[k]!, after: next[k] });
  }
  let groupId = 0;
  for (const r of rows) {
    const [row] = await tx.insert(inventoryAdjustments).values({
      shopId, groupId: groupId || null, inventoryItemId: r.itemId, locationId: r.locationId, name: r.name, delta: r.delta, quantityAfter: r.after, reason, referenceUri,
    }).returning();
    if (!groupId) { groupId = row!.id; await tx.update(inventoryAdjustments).set({ groupId }).where(eq(inventoryAdjustments.id, groupId)); }
  }
  for (const id of new Set(rows.map((r) => r.itemId))) await emit(tx, shopId, 'inventory_item', id, 'inventory_levels/update');
}

/* ------------------------------ loading ------------------------------ */

export interface TransferLine {
  id: number; transferId: number; inventoryItemId: number; title: string | null; totalQuantity: number; purchaseOrderLineId: number | null;
  pickedForShipmentQuantity: number; shippedQuantity: number; shippableQuantity: number; processableQuantity: number; sku: string | null;
}
export interface ShipmentLine {
  id: number; shipmentId: number; transferLineId: number; inventoryItemId: number; quantity: number; acceptedQuantity: number; rejectedQuantity: number; canceledQuantity: number;
  unreceivedQuantity: number; createdAt: Date;
}
export interface ShipmentView extends InventoryShipment {
  lines: ShipmentLine[]; totalQuantity: number; totalAcceptedQuantity: number; totalRejectedQuantity: number; totalCanceledQuantity: number; totalReceivedQuantity: number;
}
export interface TransferView extends InventoryTransfer {
  lines: TransferLine[]; shipments: ShipmentView[]; totalQuantity: number; receivedQuantity: number; origin: LocationSnapshotData | null; destination: LocationSnapshotData | null;
}

export async function getTransferRow(db: Executor, shopId: number, id: number): Promise<InventoryTransfer | null> {
  const [r] = await db.select().from(inventoryTransfers).where(and(eq(inventoryTransfers.shopId, shopId), eq(inventoryTransfers.id, id))).limit(1);
  return r ?? null;
}

export async function getShipmentRow(db: Executor, shopId: number, id: number): Promise<InventoryShipment | null> {
  const [r] = await db.select().from(inventoryShipments).where(and(eq(inventoryShipments.shopId, shopId), eq(inventoryShipments.id, id))).limit(1);
  return r ?? null;
}

async function liveSnapshot(db: Executor, shopId: number, locationId: number | null): Promise<LocationSnapshotData | null> {
  if (!locationId) return null;
  const [l] = await db.select().from(locations).where(and(eq(locations.shopId, shopId), eq(locations.id, locationId)));
  if (!l) return null;
  return { locationId: l.id, name: l.name, address1: l.address1, address2: l.address2, city: l.city, zip: l.zip, countryCode: l.countryCode, provinceCode: l.provinceCode, phone: l.phone, snapshottedAt: new Date().toISOString() };
}

const toShipmentLine = (r: typeof inventoryShipmentLines.$inferSelect): ShipmentLine => ({ ...r, unreceivedQuantity: r.quantity - r.acceptedQuantity - r.rejectedQuantity - r.canceledQuantity });

/** Load transfers with lines (and their shipped/picked counters), shipments and totals. */
export async function hydrateTransfers(db: Executor, shopId: number, rows: InventoryTransfer[], withShipments = true): Promise<TransferView[]> {
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const lines = await db.select({ l: inventoryTransferLines, sku: inventoryItems.sku }).from(inventoryTransferLines)
    .leftJoin(inventoryItems, eq(inventoryItems.id, inventoryTransferLines.inventoryItemId))
    .where(and(eq(inventoryTransferLines.shopId, shopId), inArray(inventoryTransferLines.transferId, ids))).orderBy(asc(inventoryTransferLines.id));
  const ships = await db.select().from(inventoryShipments).where(and(eq(inventoryShipments.shopId, shopId), inArray(inventoryShipments.transferId, ids))).orderBy(asc(inventoryShipments.id));
  const slines = ships.length ? await db.select().from(inventoryShipmentLines).where(and(eq(inventoryShipmentLines.shopId, shopId), inArray(inventoryShipmentLines.shipmentId, ships.map((s) => s.id)))).orderBy(asc(inventoryShipmentLines.id)) : [];
  const shipById = new Map(ships.map((s) => [s.id, s]));
  return rows.map((t) => {
    const myShips = ships.filter((s) => s.transferId === t.id);
    const myShipLines = slines.filter((sl) => shipById.get(sl.shipmentId)?.transferId === t.id);
    const tl: TransferLine[] = lines.filter((x) => x.l.transferId === t.id).map(({ l, sku }) => {
      const mine = myShipLines.filter((sl) => sl.transferLineId === l.id);
      const picked = mine.filter((sl) => shipById.get(sl.shipmentId)!.status === 'DRAFT').reduce((n, sl) => n + sl.quantity, 0);
      const shipped = mine.filter((sl) => shipById.get(sl.shipmentId)!.status !== 'DRAFT').reduce((n, sl) => n + sl.quantity, 0);
      const free = Math.max(0, l.totalQuantity - picked - shipped);
      return { id: l.id, transferId: l.transferId, inventoryItemId: l.inventoryItemId, title: l.title, totalQuantity: l.totalQuantity, purchaseOrderLineId: l.purchaseOrderLineId, pickedForShipmentQuantity: picked, shippedQuantity: shipped, shippableQuantity: free, processableQuantity: free, sku };
    });
    const sv: ShipmentView[] = withShipments ? myShips.map((s) => {
      const ls = myShipLines.filter((sl) => sl.shipmentId === s.id).map(toShipmentLine);
      const sum = (k: 'quantity' | 'acceptedQuantity' | 'rejectedQuantity' | 'canceledQuantity') => ls.reduce((n, l) => n + l[k], 0);
      return { ...s, lines: ls, totalQuantity: sum('quantity'), totalAcceptedQuantity: sum('acceptedQuantity'), totalRejectedQuantity: sum('rejectedQuantity'), totalCanceledQuantity: sum('canceledQuantity'), totalReceivedQuantity: sum('acceptedQuantity') + sum('rejectedQuantity') };
    }) : [];
    const received = myShipLines.reduce((n, sl) => n + sl.acceptedQuantity + sl.rejectedQuantity, 0);
    return { ...t, lines: tl, shipments: sv, totalQuantity: tl.reduce((n, l) => n + l.totalQuantity, 0), receivedQuantity: received, origin: t.originSnapshot ?? null, destination: t.destinationSnapshot ?? null };
  });
}

export async function getTransfer(db: Executor, shopId: number, id: number): Promise<TransferView | null> {
  const row = await getTransferRow(db, shopId, id);
  if (!row) return null;
  const [v] = await hydrateTransfers(db, shopId, [row]);
  const view = v!;
  // Drafts show the live location; started transfers keep the snapshot taken when they left draft.
  if (!view.origin && view.originLocationId) view.origin = await liveSnapshot(db, shopId, view.originLocationId);
  if (!view.destination && view.destinationLocationId) view.destination = await liveSnapshot(db, shopId, view.destinationLocationId);
  return view;
}

export async function getShipment(db: Executor, shopId: number, id: number): Promise<(ShipmentView & { transfer: InventoryTransfer }) | null> {
  const s = await getShipmentRow(db, shopId, id);
  if (!s) return null;
  const t = await getTransfer(db, shopId, s.transferId);
  const sv = t?.shipments.find((x) => x.id === id);
  return sv ? { ...sv, transfer: t! } : null;
}

export interface ListTransfersOptions {
  query?: string | null; status?: TransferStatus | null; sortKey?: 'CREATED_AT' | 'DESTINATION_NAME' | 'EXPECTED_SHIPMENT_ARRIVAL' | 'ID' | 'NAME' | 'ORIGIN_NAME' | 'SOURCE_NAME' | 'STATUS';
  reverse?: boolean; offset: number; limit: number;
}

function transferSearch(shopId: number, o: { query?: string | null; status?: TransferStatus | null }) {
  const t = inventoryTransfers;
  const search = buildSearch(o.query, {
    fields: {
      status: (_op, v) => sql`${t.status} = ${v.toUpperCase().replace(/ /g, '_')}`,
      name: (_op, v) => likeCi(t.name, v),
      origin_id: (_op, v) => idTerm(t.originLocationId, v),
      destination_id: (_op, v) => idTerm(t.destinationLocationId, v),
      tag: (_op, v) => sql`${v} = any(${t.tags})`,
      reference_name: (_op, v) => likeCi(t.referenceName, v),
      created_at: (op, v) => dateCompare(t.dateCreated, op, v),
      product_id: (_op, v) => {
        const n = Number(v.split('/').pop());
        return Number.isSafeInteger(n) ? sql`exists (select 1 from ${inventoryTransferLines} l join ${inventoryItems} i on i.id = l.inventory_item_id join ${productVariants} pv on pv.id = i.variant_id where l.transfer_id = ${t.id} and pv.product_id = ${n})` : null;
      },
      id: (_op, v) => idTerm(t.id, v),
    },
    text: (v) => sql`(${likeCi(t.name, v)} or ${likeCi(t.referenceName, v)} or exists (select 1 from unnest(${t.tags}) x where x ilike ${`%${v}%`}) or coalesce(${t.originSnapshot}->>'name', '') ilike ${`%${v}%`} or coalesce(${t.destinationSnapshot}->>'name', '') ilike ${`%${v}%`})`,
  });
  return and(eq(t.shopId, shopId), o.status ? eq(t.status, o.status) : undefined, search);
}

export async function listTransfers(db: Executor, shopId: number, o: ListTransfersOptions): Promise<TransferView[]> {
  const t = inventoryTransfers;
  const col = o.sortKey === 'NAME' ? t.name : o.sortKey === 'STATUS' ? t.status : o.sortKey === 'CREATED_AT' ? t.dateCreated
    : o.sortKey === 'ORIGIN_NAME' || o.sortKey === 'SOURCE_NAME' ? sql`coalesce(${t.originSnapshot}->>'name', (select name from locations where id = ${t.originLocationId}), '')`
      : o.sortKey === 'DESTINATION_NAME' ? sql`coalesce(${t.destinationSnapshot}->>'name', (select name from locations where id = ${t.destinationLocationId}), '')`
        : o.sortKey === 'EXPECTED_SHIPMENT_ARRIVAL' ? sql`(select min(arrives_at) from inventory_shipments s where s.transfer_id = ${t.id})` : t.id;
  const rows = await db.select().from(t).where(transferSearch(shopId, o)).orderBy(o.reverse ? desc(col) : asc(col), o.reverse ? desc(t.id) : asc(t.id)).limit(o.limit).offset(o.offset);
  const views = await hydrateTransfers(db, shopId, rows);
  for (const v of views) {
    if (!v.origin && v.originLocationId) v.origin = await liveSnapshot(db, shopId, v.originLocationId);
    if (!v.destination && v.destinationLocationId) v.destination = await liveSnapshot(db, shopId, v.destinationLocationId);
  }
  return views;
}

export async function countTransfers(db: Executor, shopId: number, o: { query?: string | null; status?: TransferStatus | null } = {}): Promise<number> {
  const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(inventoryTransfers).where(transferSearch(shopId, o));
  return r?.n ?? 0;
}

/** Counts per status for the list tabs. */
export async function transferStatusCounts(db: Executor, shopId: number): Promise<Record<TransferStatus, number>> {
  const rows = await db.select({ status: inventoryTransfers.status, n: sql<number>`count(*)::int` }).from(inventoryTransfers).where(eq(inventoryTransfers.shopId, shopId)).groupBy(inventoryTransfers.status);
  const out: Record<TransferStatus, number> = { DRAFT: 0, READY_TO_SHIP: 0, IN_PROGRESS: 0, TRANSFERRED: 0, CANCELED: 0 };
  for (const r of rows) out[r.status as TransferStatus] = r.n;
  return out;
}

/* ------------------------------ validation helpers ------------------------------ */

interface LineInput { inventoryItemId: number; quantity: number }

async function checkLocation(db: Executor, shopId: number, id: number | null | undefined, field: string): Promise<Result<null>> {
  if (!id) return errR(['input', field], 'A location is required.', 'LOCATION_REQUIRED');
  const [l] = await db.select().from(locations).where(and(eq(locations.shopId, shopId), eq(locations.id, id)));
  if (!l) return errR(['input', field], 'The location could not be found.', 'LOCATION_NOT_FOUND');
  if (!l.isActive) return errR(['input', field], 'The location is not active.', 'LOCATION_NOT_ACTIVE');
  return okR(null);
}

async function loadItems(db: Executor, shopId: number, ids: number[]) {
  const rows = await db.select({ i: inventoryItems, productTitle: products.title, variantTitle: productVariants.title }).from(inventoryItems)
    .innerJoin(productVariants, eq(productVariants.id, inventoryItems.variantId)).innerJoin(products, eq(products.id, productVariants.productId))
    .where(and(eq(inventoryItems.shopId, shopId), inArray(inventoryItems.id, ids)));
  return new Map(rows.map((r) => [r.i.id, { item: r.i, title: [r.productTitle, r.variantTitle && r.variantTitle !== 'Default Title' ? r.variantTitle : ''].filter(Boolean).join(' - ') }]));
}

/** Validate `[{inventoryItemId, quantity}]`; `min` is 0 when zero-quantity draft lines are allowed. */
async function checkLineInputs(db: Executor, shopId: number, lines: LineInput[], root: string[], min = 1): Promise<Result<Map<number, { title: string }>>> {
  const seen = new Set<number>();
  for (const [i, l] of lines.entries()) {
    if (seen.has(l.inventoryItemId)) return errR([...root, String(i), 'inventoryItemId'], 'The same item appears more than once.', 'DUPLICATE_ITEM');
    seen.add(l.inventoryItemId);
    if (!Number.isInteger(l.quantity) || l.quantity < min) return errR([...root, String(i), 'quantity'], min ? 'The quantity must be at least 1.' : 'The quantity cannot be negative.', 'INVALID_QUANTITY');
  }
  const items = await loadItems(db, shopId, [...seen]);
  for (const [i, l] of lines.entries()) {
    const it = items.get(l.inventoryItemId);
    if (!it) return errR([...root, String(i), 'inventoryItemId'], 'The inventory item could not be found.', 'ITEM_NOT_FOUND');
    if (!it.item.tracked) return errR([...root, String(i), 'inventoryItemId'], 'The inventory item is not tracked.', 'UNTRACKED_ITEM');
  }
  return okR(new Map([...items].map(([k, v]) => [k, { title: v.title }])));
}

function checkTags(tags: string[] | null | undefined, root: string[]): Result<string[]> {
  const out = normalizeTags(tags ?? []);
  if (out.some((t) => t.length > 40)) return errR([...root, 'tags'], 'A tag is too long (maximum is 40 characters).', 'TAG_EXCEEDS_MAX_LENGTH');
  return okR(out);
}

const notFound = () => errR(['id'], 'The transfer could not be found.', 'TRANSFER_NOT_FOUND');
const badStatus = (s: string) => errR(['id'], `The transfer is ${s.toLowerCase().replace(/_/g, ' ')} and cannot be changed this way.`, 'INVALID_TRANSFER_STATUS');

/* ------------------------------ status derivation ------------------------------ */

/** Recompute a started transfer's status from its shipments and lines. */
async function refreshTransferStatus(tx: Executor, shopId: number, transferId: number): Promise<TransferStatus> {
  const t = (await getTransfer(tx, shopId, transferId))!;
  if (t.status === 'DRAFT' || t.status === 'CANCELED') return t.status;
  const live = t.shipments.filter((s) => s.status !== 'DRAFT');
  let next: TransferStatus = 'READY_TO_SHIP';
  if (live.length) {
    const allShipped = t.lines.length > 0 && t.lines.every((l) => l.shippedQuantity >= l.totalQuantity);
    next = allShipped && live.every((s) => s.status === 'RECEIVED') ? 'TRANSFERRED' : 'IN_PROGRESS';
  }
  if (next !== t.status) await tx.update(inventoryTransfers).set({ status: next }).where(eq(inventoryTransfers.id, transferId));
  return next;
}

/** Shipment status from its line counters (only for shipments already in transit). */
async function refreshShipmentStatus(tx: Executor, shipmentId: number, dateReceived?: Date | null) {
  const lines = await tx.select().from(inventoryShipmentLines).where(eq(inventoryShipmentLines.shipmentId, shipmentId));
  const unreceived = lines.reduce((n, l) => n + l.quantity - l.acceptedQuantity - l.rejectedQuantity - l.canceledQuantity, 0);
  const touched = lines.some((l) => l.acceptedQuantity + l.rejectedQuantity + l.canceledQuantity > 0);
  const status: ShipmentStatus = unreceived <= 0 ? 'RECEIVED' : touched ? 'PARTIALLY_RECEIVED' : 'IN_TRANSIT';
  await tx.update(inventoryShipments).set({ status, ...(status === 'RECEIVED' ? { dateReceived: dateReceived ?? new Date() } : {}) }).where(eq(inventoryShipments.id, shipmentId));
}

/* ------------------------------ create / edit ------------------------------ */

export interface TransferCreateInput {
  originLocationId?: number | null; destinationLocationId?: number | null; lineItems?: LineInput[]; dateCreated?: Date | null;
  note?: string | null; tags?: string[] | null; referenceName?: string | null;
  /** Purchase order to link for reference (null or absent: none). */
  linkedPurchaseOrderId?: number | null;
}

/** The purchase order a transfer can be linked to must exist in the shop. */
async function checkLinkedPurchaseOrder(tx: Executor, shopId: number, id: number | null | undefined, field: string[]) {
  if (!id) return okR(null);
  const [po] = await tx.select({ id: purchaseOrders.id }).from(purchaseOrders).where(and(eq(purchaseOrders.shopId, shopId), eq(purchaseOrders.id, id))).limit(1);
  return po ? okR(po.id) : errR(field, 'The purchase order does not exist.', 'PURCHASE_ORDER_NOT_FOUND');
}

async function nextTransferName(tx: Executor, shopId: number) {
  return `#T${String(await nextSequence(tx, shopId, 'transfer')).padStart(4, '0')}`;
}

export async function createTransfer(db: Db, shopId: number, input: TransferCreateInput, opts: { readyToShip?: boolean } = {}): Promise<Result<TransferView>> {
  return txResult(db, async (tx) => {
    const lines = input.lineItems ?? [];
    if (opts.readyToShip && !lines.length) return errR(['input', 'lineItems'], 'Add at least one item.', 'ITEMS_EMPTY');
    if (input.originLocationId) { const r = await checkLocation(tx, shopId, input.originLocationId, 'originLocationId'); if (!r.ok) return r; }
    if (input.destinationLocationId) { const r = await checkLocation(tx, shopId, input.destinationLocationId, 'destinationLocationId'); if (!r.ok) return r; }
    if (input.originLocationId && input.originLocationId === input.destinationLocationId) {
      return errR(['input', 'destinationLocationId'], 'The origin and destination must be different.', 'TRANSFER_ORIGIN_CANNOT_BE_THE_SAME_AS_DESTINATION');
    }
    if (lines.length > MAX_TRANSFER_LINES) return errR(['input', 'lineItems'], 'Too many items.', 'INVALID_QUANTITY');
    const checked = await checkLineInputs(tx, shopId, lines, ['input', 'lineItems']);
    if (!checked.ok) return checked;
    const tags = checkTags(input.tags, ['input']);
    if (!tags.ok) return tags;
    const linked = await checkLinkedPurchaseOrder(tx, shopId, input.linkedPurchaseOrderId, ['input', 'shopmeLinkedPurchaseOrderId']);
    if (!linked.ok) return linked;
    const name = await nextTransferName(tx, shopId);
    const [row] = await tx.insert(inventoryTransfers).values({
      shopId, name, originLocationId: input.originLocationId ?? null, destinationLocationId: input.destinationLocationId ?? null,
      referenceName: input.referenceName?.trim() || null, note: input.note?.trim() || null, tags: tags.value, linkedPurchaseOrderId: linked.value, ...(input.dateCreated ? { dateCreated: input.dateCreated } : {}),
    }).returning();
    if (lines.length) {
      await tx.insert(inventoryTransferLines).values(lines.map((l) => ({ shopId, transferId: row!.id, inventoryItemId: l.inventoryItemId, totalQuantity: l.quantity, title: checked.value.get(l.inventoryItemId)!.title })));
    }
    await emit(tx, shopId, 'inventory_transfer', row!.id, 'inventory_transfers/create');
    if (opts.readyToShip) {
      const r = await markReadyTx(tx, shopId, row!.id);
      if (!r.ok) return r;
    }
    return okR((await getTransfer(tx, shopId, row!.id))!);
  });
}

export interface TransferEditInput { originId?: number | null; destinationId?: number | null; dateCreated?: Date | null; note?: string | null; tags?: string[] | null; referenceName?: string | null; /** null unlinks; absent keeps the current link. */ linkedPurchaseOrderId?: number | null }

export async function editTransfer(db: Db, shopId: number, id: number, input: TransferEditInput): Promise<Result<TransferView>> {
  return txResult(db, async (tx) => {
    const t = await getTransferRow(tx, shopId, id);
    if (!t) return notFound();
    const locChange = (input.originId !== undefined && input.originId !== t.originLocationId) || (input.destinationId !== undefined && input.destinationId !== t.destinationLocationId);
    if (locChange && t.status !== 'DRAFT') return errR(['id'], 'Locations can only be changed on a draft.', 'TRANSFER_LOCATION_IMMUTABLE');
    const origin = input.originId !== undefined ? input.originId : t.originLocationId;
    const dest = input.destinationId !== undefined ? input.destinationId : t.destinationLocationId;
    if (locChange) {
      if (input.originId) { const r = await checkLocation(tx, shopId, input.originId, 'originId'); if (!r.ok) return r; }
      if (input.destinationId) { const r = await checkLocation(tx, shopId, input.destinationId, 'destinationId'); if (!r.ok) return r; }
      if (origin && origin === dest) return errR(['input', 'destinationId'], 'The origin and destination must be different.', 'TRANSFER_ORIGIN_CANNOT_BE_THE_SAME_AS_DESTINATION');
    }
    const tags = input.tags !== undefined ? checkTags(input.tags, ['input']) : okR(t.tags);
    if (!tags.ok) return tags;
    const linked = input.linkedPurchaseOrderId !== undefined ? await checkLinkedPurchaseOrder(tx, shopId, input.linkedPurchaseOrderId, ['input', 'shopmeLinkedPurchaseOrderId']) : okR(t.linkedPurchaseOrderId);
    if (!linked.ok) return linked;
    await tx.update(inventoryTransfers).set({
      linkedPurchaseOrderId: linked.value,
      originLocationId: origin ?? null, destinationLocationId: dest ?? null, tags: tags.value,
      ...(input.note !== undefined && { note: input.note?.trim() || null }), ...(input.referenceName !== undefined && { referenceName: input.referenceName?.trim() || null }),
      ...(input.dateCreated ? { dateCreated: input.dateCreated } : {}),
    }).where(eq(inventoryTransfers.id, id));
    await emit(tx, shopId, 'inventory_transfer', id, 'inventory_transfers/update');
    return okR((await getTransfer(tx, shopId, id))!);
  });
}

/* ------------------------------ ready to ship / cancel / delete ------------------------------ */

async function availableAt(tx: Executor, shopId: number, itemId: number, locationId: number): Promise<number> {
  const [lv] = await tx.select({ a: inventoryLevels.available, active: inventoryLevels.isActive }).from(inventoryLevels).where(and(eq(inventoryLevels.shopId, shopId), eq(inventoryLevels.inventoryItemId, itemId), eq(inventoryLevels.locationId, locationId)));
  return lv?.active ? lv.a : 0;
}

/** Hold `qty` of each item: reserved at the origin, incoming at the destination. A negative `qty` releases it. */
async function holdStock(tx: Executor, shopId: number, t: InventoryTransfer, lines: { inventoryItemId: number; qty: number }[], reason: string) {
  if (t.purchaseOrderId || !t.originLocationId || !t.destinationLocationId) return;
  const ls = lines.filter((l) => l.qty !== 0);
  await applyLevelDeltas(tx, shopId, reason, transferUri(t.id), ls.flatMap((l) => [
    { inventoryItemId: l.inventoryItemId, locationId: t.originLocationId!, reserved: l.qty, available: -l.qty },
    { inventoryItemId: l.inventoryItemId, locationId: t.destinationLocationId!, incoming: l.qty },
  ]));
}

async function markReadyTx(tx: Executor, shopId: number, id: number): Promise<Result<TransferView>> {
  const t = await getTransfer(tx, shopId, id);
  if (!t) return notFound();
  if (t.status !== 'DRAFT') return badStatus(t.status);
  if (!t.originLocationId) return errR(['id'], 'Choose an origin.', 'LOCATION_REQUIRED');
  if (!t.destinationLocationId) return errR(['id'], 'Choose a destination.', 'LOCATION_REQUIRED');
  for (const [f, lid] of [['originLocationId', t.originLocationId], ['destinationLocationId', t.destinationLocationId]] as const) {
    const r = await checkLocation(tx, shopId, lid, f);
    if (!r.ok) return r;
  }
  if (t.originLocationId === t.destinationLocationId) return errR(['id'], 'The origin and destination must be different.', 'TRANSFER_ORIGIN_CANNOT_BE_THE_SAME_AS_DESTINATION');
  const lines = t.lines.filter((l) => l.totalQuantity > 0);
  if (!lines.length) return errR(['id'], 'Add at least one item.', 'ITEMS_EMPTY');
  const items = await loadItems(tx, shopId, lines.map((l) => l.inventoryItemId));
  for (const l of lines) {
    const it = items.get(l.inventoryItemId);
    if (!it || !it.item.tracked) return errR(['id'], 'An item on this transfer is no longer tracked.', 'INVALID_ITEM');
    if ((await availableAt(tx, shopId, l.inventoryItemId, t.originLocationId)) < l.totalQuantity) return errR(['id'], `Not enough available stock of ${l.title ?? 'an item'} at the origin.`, 'INVALID_ITEM');
  }
  await tx.delete(inventoryTransferLines).where(and(eq(inventoryTransferLines.transferId, id), eq(inventoryTransferLines.totalQuantity, 0)));
  await holdStock(tx, shopId, t, lines.map((l) => ({ inventoryItemId: l.inventoryItemId, qty: l.totalQuantity })), 'transfer_ready');
  await tx.update(inventoryTransfers).set({
    status: 'READY_TO_SHIP', originSnapshot: await liveSnapshot(tx, shopId, t.originLocationId), destinationSnapshot: await liveSnapshot(tx, shopId, t.destinationLocationId),
  }).where(eq(inventoryTransfers.id, id));
  await emit(tx, shopId, 'inventory_transfer', id, 'inventory_transfers/ready_to_ship');
  return okR((await getTransfer(tx, shopId, id))!);
}

export const markTransferReadyToShip = (db: Db, shopId: number, id: number) => txResult(db, (tx) => markReadyTx(tx, shopId, id));

export async function cancelTransfer(db: Db, shopId: number, id: number): Promise<Result<TransferView>> {
  return txResult(db, async (tx) => {
    const t = await getTransfer(tx, shopId, id);
    if (!t) return notFound();
    if (t.shipments.length) return errR(['id'], 'A transfer with shipments cannot be canceled.', 'SHIPMENT_EXISTS');
    if (t.status !== 'DRAFT' && t.status !== 'READY_TO_SHIP') return badStatus(t.status);
    if (t.status === 'READY_TO_SHIP') await holdStock(tx, shopId, t, t.lines.map((l) => ({ inventoryItemId: l.inventoryItemId, qty: -l.totalQuantity })), 'transfer_cancel');
    await tx.update(inventoryTransfers).set({ status: 'CANCELED' }).where(eq(inventoryTransfers.id, id));
    await emit(tx, shopId, 'inventory_transfer', id, 'inventory_transfers/cancel');
    return okR((await getTransfer(tx, shopId, id))!);
  });
}

export async function deleteTransfer(db: Db, shopId: number, id: number): Promise<Result<number>> {
  return txResult(db, async (tx) => {
    const t = await getTransferRow(tx, shopId, id);
    if (!t) return notFound();
    if (t.status !== 'DRAFT') return errR(['id'], 'Only a draft transfer can be deleted.', 'INVALID_TRANSFER_STATUS');
    await tx.delete(inventoryTransfers).where(eq(inventoryTransfers.id, id));
    await emit(tx, shopId, 'inventory_transfer', id, 'inventory_transfers/delete');
    return okR(id);
  });
}

export async function duplicateTransfer(db: Db, shopId: number, id: number): Promise<Result<TransferView>> {
  return txResult(db, async (tx) => {
    const t = await getTransfer(tx, shopId, id);
    if (!t) return notFound();
    const name = await nextTransferName(tx, shopId);
    const [row] = await tx.insert(inventoryTransfers).values({
      shopId, name, originLocationId: t.originLocationId, destinationLocationId: t.destinationLocationId, referenceName: t.referenceName, note: t.note, tags: t.tags,
    }).returning();
    const lines = t.lines.filter((l) => l.totalQuantity > 0);
    if (lines.length) await tx.insert(inventoryTransferLines).values(lines.map((l) => ({ shopId, transferId: row!.id, inventoryItemId: l.inventoryItemId, title: l.title, totalQuantity: l.totalQuantity })));
    await emit(tx, shopId, 'inventory_transfer', row!.id, 'inventory_transfers/create');
    return okR((await getTransfer(tx, shopId, row!.id))!);
  });
}

/* ------------------------------ line editing ------------------------------ */

export interface LineUpdate { inventoryItemId: number; newQuantity: number; deltaQuantity: number }
const EDITABLE: TransferStatus[] = ['DRAFT', 'READY_TO_SHIP', 'IN_PROGRESS'];

/** Set the processable (not yet shipped or picked) quantity of items; unknown items are added. Reserved and incoming follow the change. */
export async function setTransferItems(db: Db, shopId: number, id: number, lineItems: LineInput[]): Promise<Result<{ transfer: TransferView; updates: LineUpdate[] }>> {
  return txResult(db, async (tx) => {
    const t = await getTransfer(tx, shopId, id);
    if (!t) return notFound();
    if (!EDITABLE.includes(t.status as TransferStatus)) return badStatus(t.status);
    const draft = t.status === 'DRAFT';
    const checked = await checkLineInputs(tx, shopId, lineItems, ['input', 'lineItems'], draft ? 0 : 1);
    if (!checked.ok) return checked;
    const updates: LineUpdate[] = [];
    const holds: { inventoryItemId: number; qty: number }[] = [];
    for (const li of lineItems) {
      const cur = t.lines.find((l) => l.inventoryItemId === li.inventoryItemId);
      const allocated = cur ? cur.pickedForShipmentQuantity + cur.shippedQuantity : 0;
      const newTotal = allocated + li.quantity;
      const delta = newTotal - (cur?.totalQuantity ?? 0);
      if (!draft && delta > 0 && t.originLocationId && !t.purchaseOrderId && (await availableAt(tx, shopId, li.inventoryItemId, t.originLocationId)) < delta) {
        return errR(['input', 'lineItems'], 'Not enough available stock at the origin.', 'INVALID_QUANTITY');
      }
      if (cur) await tx.update(inventoryTransferLines).set({ totalQuantity: newTotal }).where(eq(inventoryTransferLines.id, cur.id));
      else await tx.insert(inventoryTransferLines).values({ shopId, transferId: id, inventoryItemId: li.inventoryItemId, title: checked.value.get(li.inventoryItemId)!.title, totalQuantity: newTotal });
      if (!draft) holds.push({ inventoryItemId: li.inventoryItemId, qty: delta });
      updates.push({ inventoryItemId: li.inventoryItemId, newQuantity: newTotal, deltaQuantity: delta });
    }
    if (!draft) await holdStock(tx, shopId, t, holds, 'transfer_updated');
    if (!draft) await refreshTransferStatus(tx, shopId, id);
    return okR({ transfer: (await getTransfer(tx, shopId, id))!, updates });
  });
}

/** Remove lines (or their unallocated part). Quantity already in a shipment stays. */
export async function removeTransferItems(db: Db, shopId: number, id: number, lineIds: number[] | null | undefined): Promise<Result<{ transfer: TransferView; updates: LineUpdate[] }>> {
  return txResult(db, async (tx) => {
    const t = await getTransfer(tx, shopId, id);
    if (!t) return notFound();
    if (!EDITABLE.includes(t.status as TransferStatus)) return badStatus(t.status);
    const targets = lineIds?.length ? t.lines.filter((l) => lineIds.includes(l.id)) : t.lines;
    if (lineIds?.length && targets.length !== new Set(lineIds).size) return errR(['input', 'transferLineItemIds'], 'A line item could not be found.', 'ITEM_NOT_FOUND');
    const updates: LineUpdate[] = [];
    const holds: { inventoryItemId: number; qty: number }[] = [];
    for (const l of targets) {
      const allocated = l.pickedForShipmentQuantity + l.shippedQuantity;
      if (allocated === 0) await tx.delete(inventoryTransferLines).where(eq(inventoryTransferLines.id, l.id));
      else await tx.update(inventoryTransferLines).set({ totalQuantity: allocated }).where(eq(inventoryTransferLines.id, l.id));
      holds.push({ inventoryItemId: l.inventoryItemId, qty: -l.processableQuantity });
      updates.push({ inventoryItemId: l.inventoryItemId, newQuantity: allocated, deltaQuantity: -l.processableQuantity });
    }
    if (t.status === 'READY_TO_SHIP' && targets.length >= t.lines.length) return errR(['input', 'transferLineItemIds'], 'A ready to ship transfer must keep at least one item.', 'CANT_REMOVE_ALL_ITEMS_FROM_READY_TO_SHIP_TRANSFER');
    if (t.status !== 'DRAFT') { await holdStock(tx, shopId, t, holds, 'transfer_updated'); await refreshTransferStatus(tx, shopId, id); }
    return okR({ transfer: (await getTransfer(tx, shopId, id))!, updates });
  });
}

/* ------------------------------ shipments ------------------------------ */

export interface ShipmentTrackingInput { trackingNumber?: string | null; company?: string | null; trackingUrl?: string | null; arrivesAt?: Date | null }
export interface ShipmentCreateInput { transferId: number; lineItems: LineInput[]; tracking?: ShipmentTrackingInput | null; barcode?: string | null; dateCreated?: Date | null }

function checkTracking(t: ShipmentTrackingInput | null | undefined): Result<null> {
  if (t?.trackingUrl) {
    try { const u = new URL(t.trackingUrl); if (!/^https?:$/.test(u.protocol)) throw new Error('scheme'); } catch { return errR(['tracking', 'trackingUrl'], 'The tracking URL is invalid.', 'INVALID_URL'); }
  }
  return okR(null);
}

async function checkBarcode(tx: Executor, shopId: number, barcode: string | null | undefined, selfId?: number): Promise<Result<null>> {
  if (!barcode) return okR(null);
  if (barcode.length > 255) return errR(['barcode'], 'The barcode is too long.', 'BARCODE_TOO_LONG');
  const [dup] = await tx.select({ id: inventoryShipments.id }).from(inventoryShipments).where(and(eq(inventoryShipments.shopId, shopId), eq(inventoryShipments.barcode, barcode)));
  if (dup && dup.id !== selfId) return errR(['barcode'], 'This barcode is already used by another shipment.', 'BARCODE_DUPLICATE');
  return okR(null);
}

export async function createShipment(db: Db, shopId: number, input: ShipmentCreateInput, inTransit = false): Promise<Result<ShipmentView & { transfer: InventoryTransfer }>> {
  return txResult(db, async (tx) => {
    const r = await createShipmentTx(tx, shopId, input);
    if (!r.ok) return r;
    if (inTransit) { const m = await markInTransitTx(tx, shopId, r.value, null); if (!m.ok) return m; }
    return okR((await getShipment(tx, shopId, r.value))!);
  });
}

export async function createShipmentTx(tx: Executor, shopId: number, input: ShipmentCreateInput): Promise<Result<number>> {
  const t = await getTransfer(tx, shopId, input.transferId);
  if (!t) return errR(['input', 'movementId'], 'The transfer could not be found.', 'TRANSFER_NOT_FOUND');
  if (t.status !== 'READY_TO_SHIP' && t.status !== 'IN_PROGRESS') return errR(['input', 'movementId'], 'Shipments can only be added to a ready to ship or in progress transfer.', 'INVALID_TRANSFER_STATUS');
  if (!input.lineItems.length) return errR(['input', 'lineItems'], 'A shipment needs at least one item.', 'EMPTY_SHIPMENT_INPUT');
  const trk = checkTracking(input.tracking);
  if (!trk.ok) return trk;
  const bc = await checkBarcode(tx, shopId, input.barcode);
  if (!bc.ok) return bc;
  const picks: { line: TransferLine; quantity: number }[] = [];
  const seen = new Set<number>();
  for (const [i, li] of input.lineItems.entries()) {
    if (seen.has(li.inventoryItemId)) return errR(['input', 'lineItems', String(i), 'inventoryItemId'], 'The same item appears more than once.', 'DUPLICATE_ITEM');
    seen.add(li.inventoryItemId);
    const line = t.lines.find((l) => l.inventoryItemId === li.inventoryItemId);
    if (!line) return errR(['input', 'lineItems', String(i), 'inventoryItemId'], 'The item is not part of this transfer.', 'ITEM_NOT_FOUND');
    if (!Number.isInteger(li.quantity) || li.quantity < 1 || li.quantity > line.processableQuantity) return errR(['input', 'lineItems', String(i), 'quantity'], 'The quantity exceeds what can still be shipped.', 'INVALID_QUANTITY');
    picks.push({ line, quantity: li.quantity });
  }
  const n = t.shipments.length + 1;
  const [s] = await tx.insert(inventoryShipments).values({
    shopId, transferId: t.id, name: `${t.name}-S${n}`, barcode: input.barcode || null, trackingCompany: input.tracking?.company ?? null, trackingNumber: input.tracking?.trackingNumber ?? null,
    trackingUrl: input.tracking?.trackingUrl ?? null, arrivesAt: input.tracking?.arrivesAt ?? null, ...(input.dateCreated ? { dateCreated: input.dateCreated } : {}),
  }).returning();
  await tx.insert(inventoryShipmentLines).values(picks.map((p) => ({ shopId, shipmentId: s!.id, transferLineId: p.line.id, inventoryItemId: p.line.inventoryItemId, quantity: p.quantity })));
  await emit(tx, shopId, 'inventory_shipment', s!.id, 'inventory_shipments/create');
  return okR(s!.id);
}

async function markInTransitTx(tx: Executor, shopId: number, shipmentId: number, dateShipped: Date | null | undefined): Promise<Result<null>> {
  const s = await getShipment(tx, shopId, shipmentId);
  if (!s) return errR(['id'], 'The shipment could not be found.', 'SHIPMENT_NOT_FOUND');
  if (s.status !== 'DRAFT') return errR(['id'], 'Only a draft shipment can be marked in transit.', 'INVALID_SHIPMENT_STATUS');
  if (!s.lines.length || s.lines.every((l) => l.quantity === 0)) return errR(['id'], 'The shipment is empty.', 'EMPTY_SHIPMENT_INPUT');
  const t = s.transfer;
  if (t.status !== 'READY_TO_SHIP' && t.status !== 'IN_PROGRESS') return errR(['id'], 'The transfer cannot ship in its current status.', 'INVALID_TRANSFER_STATUS');
  if (t.originLocationId && !t.purchaseOrderId) {
    await applyLevelDeltas(tx, shopId, 'transfer_ship', transferUri(t.id), s.lines.map((l) => ({ inventoryItemId: l.inventoryItemId, locationId: t.originLocationId!, reserved: -l.quantity, onHand: -l.quantity })));
  }
  await tx.update(inventoryShipments).set({ status: 'IN_TRANSIT', dateShipped: dateShipped ?? new Date() }).where(eq(inventoryShipments.id, shipmentId));
  await tx.update(inventoryTransfers).set({ status: 'IN_PROGRESS' }).where(eq(inventoryTransfers.id, t.id));
  await emit(tx, shopId, 'inventory_shipment', shipmentId, 'inventory_shipments/in_transit');
  return okR(null);
}

export async function markShipmentInTransit(db: Db, shopId: number, id: number, dateShipped?: Date | null): Promise<Result<ShipmentView & { transfer: InventoryTransfer }>> {
  return txResult(db, async (tx) => {
    const r = await markInTransitTx(tx, shopId, id, dateShipped);
    if (!r.ok) return r;
    await refreshTransferStatus(tx, shopId, (await getShipmentRow(tx, shopId, id))!.transferId);
    return okR((await getShipment(tx, shopId, id))!);
  });
}

async function draftShipment(tx: Executor, shopId: number, id: number): Promise<Result<NonNullable<Awaited<ReturnType<typeof getShipment>>>>> {
  const s = await getShipment(tx, shopId, id);
  if (!s) return errR(['id'], 'The shipment could not be found.', 'SHIPMENT_NOT_FOUND');
  if (s.status !== 'DRAFT') return errR(['id'], 'Only a draft shipment can be changed.', 'INVALID_SHIPMENT_STATUS');
  return okR(s);
}

export async function addShipmentItems(db: Db, shopId: number, id: number, lineItems: LineInput[]): Promise<Result<{ shipment: ShipmentView & { transfer: InventoryTransfer }; added: ShipmentLine[] }>> {
  return txResult(db, async (tx) => {
    const d = await draftShipment(tx, shopId, id);
    if (!d.ok) return d;
    const s = d.value;
    const t = (await getTransfer(tx, shopId, s.transferId))!;
    const added: number[] = [];
    const seen = new Set<number>();
    for (const [i, li] of lineItems.entries()) {
      const line = t.lines.find((l) => l.inventoryItemId === li.inventoryItemId);
      if (!line) return errR(['lineItems', String(i), 'inventoryItemId'], 'The item is not part of this transfer.', 'ITEM_NOT_FOUND');
      if (seen.has(li.inventoryItemId) || s.lines.some((l) => l.inventoryItemId === li.inventoryItemId)) return errR(['lineItems', String(i), 'inventoryItemId'], 'The item is already in the shipment.', 'DUPLICATE_ITEM');
      seen.add(li.inventoryItemId);
      if (!Number.isInteger(li.quantity) || li.quantity < 1 || li.quantity > line.processableQuantity) return errR(['lineItems', String(i), 'quantity'], 'The quantity exceeds what can still be shipped.', 'INVALID_QUANTITY');
      const [row] = await tx.insert(inventoryShipmentLines).values({ shopId, shipmentId: id, transferLineId: line.id, inventoryItemId: li.inventoryItemId, quantity: li.quantity }).returning({ id: inventoryShipmentLines.id });
      added.push(row!.id);
    }
    const out = (await getShipment(tx, shopId, id))!;
    return okR({ shipment: out, added: out.lines.filter((l) => added.includes(l.id)) });
  });
}

export async function removeShipmentItems(db: Db, shopId: number, id: number, lineIds: number[]): Promise<Result<ShipmentView & { transfer: InventoryTransfer }>> {
  return txResult(db, async (tx) => {
    const d = await draftShipment(tx, shopId, id);
    if (!d.ok) return d;
    if (lineIds.some((x) => !d.value.lines.some((l) => l.id === x))) return errR(['lineItems'], 'A shipment line could not be found.', 'ITEM_NOT_FOUND');
    await tx.delete(inventoryShipmentLines).where(and(eq(inventoryShipmentLines.shipmentId, id), inArray(inventoryShipmentLines.id, lineIds)));
    return okR((await getShipment(tx, shopId, id))!);
  });
}

export async function updateShipmentItemQuantities(db: Db, shopId: number, id: number, items: { shipmentLineItemId: number; quantity: number }[]): Promise<Result<{ shipment: ShipmentView & { transfer: InventoryTransfer }; updated: ShipmentLine[] }>> {
  return txResult(db, async (tx) => {
    const d = await draftShipment(tx, shopId, id);
    if (!d.ok) return d;
    const t = (await getTransfer(tx, shopId, d.value.transferId))!;
    for (const [i, it] of items.entries()) {
      const sl = d.value.lines.find((l) => l.id === it.shipmentLineItemId);
      if (!sl) return errR(['items', String(i), 'shipmentLineItemId'], 'A shipment line could not be found.', 'ITEM_NOT_FOUND');
      const tl = t.lines.find((l) => l.id === sl.transferLineId)!;
      if (!Number.isInteger(it.quantity) || it.quantity < 1 || it.quantity > tl.processableQuantity + sl.quantity) return errR(['items', String(i), 'quantity'], 'The quantity exceeds what can still be shipped.', 'INVALID_QUANTITY');
      await tx.update(inventoryShipmentLines).set({ quantity: it.quantity }).where(eq(inventoryShipmentLines.id, sl.id));
    }
    const out = (await getShipment(tx, shopId, id))!;
    return okR({ shipment: out, updated: out.lines.filter((l) => items.some((x) => x.shipmentLineItemId === l.id)) });
  });
}

export async function deleteShipment(db: Db, shopId: number, id: number): Promise<Result<number>> {
  return txResult(db, async (tx) => {
    const d = await draftShipment(tx, shopId, id);
    if (!d.ok) return d;
    await tx.delete(inventoryShipments).where(eq(inventoryShipments.id, id));
    return okR(id);
  });
}

export async function setShipmentTracking(db: Db, shopId: number, id: number, tracking: ShipmentTrackingInput): Promise<Result<ShipmentView & { transfer: InventoryTransfer }>> {
  return txResult(db, async (tx) => {
    const s = await getShipmentRow(tx, shopId, id);
    if (!s) return errR(['id'], 'The shipment could not be found.', 'SHIPMENT_NOT_FOUND');
    const trk = checkTracking(tracking);
    if (!trk.ok) return trk;
    await tx.update(inventoryShipments).set({
      trackingCompany: tracking.company ?? null, trackingNumber: tracking.trackingNumber ?? null, trackingUrl: tracking.trackingUrl ?? null, arrivesAt: tracking.arrivesAt ?? null,
    }).where(eq(inventoryShipments.id, id));
    return okR((await getShipment(tx, shopId, id))!);
  });
}

export async function setShipmentBarcode(db: Db, shopId: number, id: number, barcode: string): Promise<Result<ShipmentView & { transfer: InventoryTransfer }>> {
  return txResult(db, async (tx) => {
    const s = await getShipmentRow(tx, shopId, id);
    if (!s) return errR(['id'], 'The shipment could not be found.', 'SHIPMENT_NOT_FOUND');
    const bc = await checkBarcode(tx, shopId, barcode, id);
    if (!bc.ok) return bc;
    await tx.update(inventoryShipments).set({ barcode: barcode || null }).where(eq(inventoryShipments.id, id));
    return okR((await getShipment(tx, shopId, id))!);
  });
}

export async function listShipments(db: Executor, shopId: number, o: { query?: string | null; sortKey?: 'CREATED_AT' | 'ID' | 'STATUS'; reverse?: boolean; offset: number; limit: number }) {
  const sh = inventoryShipments;
  const search = buildSearch(o.query, {
    fields: { status: (_op, v) => sql`${sh.status} = ${v.toUpperCase()}`, name: (_op, v) => likeCi(sh.name, v), barcode: (_op, v) => likeCi(sh.barcode, v, true), id: (_op, v) => idTerm(sh.id, v), transfer_id: (_op, v) => idTerm(sh.transferId, v) },
    text: (v) => sql`(${likeCi(sh.name, v)} or ${likeCi(sh.barcode, v)} or ${likeCi(sh.trackingNumber, v)})`,
  });
  const col = o.sortKey === 'STATUS' ? sh.status : o.sortKey === 'CREATED_AT' ? sh.dateCreated : sh.id;
  const rows = await db.select({ id: sh.id }).from(sh).where(and(eq(sh.shopId, shopId), search)).orderBy(o.reverse ? desc(col) : asc(col), o.reverse ? desc(sh.id) : asc(sh.id)).limit(o.limit).offset(o.offset);
  const out: (ShipmentView & { transfer: InventoryTransfer })[] = [];
  for (const r of rows) { const s = await getShipment(db, shopId, r.id); if (s) out.push(s); }
  return out;
}

/* ------------------------------ receiving ------------------------------ */

export interface ReceiveInput { lineItems?: { shipmentLineItemId: number; quantity: number; reason: ReceiveReason }[] | null; dateReceived?: Date | null; bulkReceiveAction?: ReceiveReason | null }

/**
 * Receive units of a shipment. Accepted units arrive (incoming -n, available +n, on hand +n); rejected and canceled units are
 * released from incoming and leave the books. The shipment and the transfer move to partially received / received as lines resolve.
 */
export async function receiveShipment(db: Db, shopId: number, id: number, input: ReceiveInput): Promise<Result<ShipmentView & { transfer: InventoryTransfer }>> {
  return txResult(db, async (tx) => {
    const s = await getShipment(tx, shopId, id);
    if (!s) return errR(['id'], 'The shipment could not be found.', 'SHIPMENT_NOT_FOUND');
    if (s.status !== 'IN_TRANSIT' && s.status !== 'PARTIALLY_RECEIVED') return errR(['id'], 'Only a shipment in transit can be received.', 'INVALID_SHIPMENT_STATUS');
    const t = s.transfer;
    if (!t.destinationLocationId) return errR(['id'], 'The transfer has no destination.', 'LOCATION_NOT_FOUND');
    const dest = await checkLocation(tx, shopId, t.destinationLocationId, 'id');
    if (!dest.ok) return { ok: false, errors: dest.errors.map((e) => ({ ...e, code: e.code === 'LOCATION_NOT_ACTIVE' ? 'LOCATION_NOT_ACTIVE' : e.code })) };
    const remaining = new Map(s.lines.map((l) => [l.id, l.unreceivedQuantity]));
    const plan: { line: ShipmentLine; quantity: number; reason: ReceiveReason }[] = [];
    for (const [i, li] of (input.lineItems ?? []).entries()) {
      const line = s.lines.find((l) => l.id === li.shipmentLineItemId);
      if (!line) return errR(['lineItems', String(i), 'shipmentLineItemId'], 'The shipment line could not be found.', 'ITEM_NOT_FOUND');
      if (!Number.isInteger(li.quantity) || li.quantity < 1 || li.quantity > (remaining.get(line.id) ?? 0)) return errR(['lineItems', String(i), 'quantity'], 'The quantity exceeds the unreceived quantity.', 'INVALID_QUANTITY');
      remaining.set(line.id, remaining.get(line.id)! - li.quantity);
      plan.push({ line, quantity: li.quantity, reason: li.reason });
    }
    if (input.bulkReceiveAction) {
      for (const line of s.lines) { const left = remaining.get(line.id) ?? 0; if (left > 0) plan.push({ line, quantity: left, reason: input.bulkReceiveAction }); }
    }
    if (!plan.length) return errR(['lineItems'], 'Nothing to receive.', 'INVALID_QUANTITY');
    const col = { ACCEPTED: 'acceptedQuantity', REJECTED: 'rejectedQuantity', CANCELED: 'canceledQuantity' } as const;
    for (const p of plan) {
      const cur = (await tx.select().from(inventoryShipmentLines).where(eq(inventoryShipmentLines.id, p.line.id)))[0]!;
      await tx.update(inventoryShipmentLines).set({ [col[p.reason]]: cur[col[p.reason]] + p.quantity }).where(eq(inventoryShipmentLines.id, p.line.id));
    }
    await applyLevelDeltas(tx, shopId, 'transfer_receive', transferUri(t.id), plan.map((p) => ({
      inventoryItemId: p.line.inventoryItemId, locationId: t.destinationLocationId!, incoming: -p.quantity,
      ...(p.reason === 'ACCEPTED' ? { available: p.quantity, onHand: p.quantity } : {}),
    })));
    if (t.purchaseOrderId) await applyPurchaseOrderReceipt(tx, shopId, t, plan.map((p) => ({ transferLineId: p.line.transferLineId, inventoryItemId: p.line.inventoryItemId, quantity: p.quantity, reason: p.reason })));
    await refreshShipmentStatus(tx, id, input.dateReceived);
    await refreshTransferStatus(tx, shopId, t.id);
    await emit(tx, shopId, 'inventory_shipment', id, 'inventory_shipments/receive');
    return okR((await getShipment(tx, shopId, id))!);
  });
}

/** Deactivation guard for locations: how many unfinished transfers use it. */
export async function openTransfersAtLocation(db: Executor, shopId: number, locationId: number): Promise<number> {
  const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(inventoryTransfers).where(and(
    eq(inventoryTransfers.shopId, shopId), inArray(inventoryTransfers.status, ['READY_TO_SHIP', 'IN_PROGRESS']),
    sql`(${inventoryTransfers.originLocationId} = ${locationId} or ${inventoryTransfers.destinationLocationId} = ${locationId})`,
  ));
  return r?.n ?? 0;
}

/** Internal: create a transfer straight into progress with an in-transit shipment (used by purchase order receiving). */
export async function createReceiptTransfer(tx: Tx, shopId: number, o: {
  purchaseOrderId: number; originName: string; destinationLocationId: number; lines: { inventoryItemId: number; title: string | null; quantity: number; purchaseOrderLineId: number }[]; referenceName?: string | null;
}): Promise<{ transferId: number; shipmentId: number }> {
  const name = await nextTransferName(tx, shopId);
  const dest = await liveSnapshot(tx, shopId, o.destinationLocationId);
  const [t] = await tx.insert(inventoryTransfers).values({
    shopId, name, status: 'IN_PROGRESS', destinationLocationId: o.destinationLocationId, purchaseOrderId: o.purchaseOrderId, referenceName: o.referenceName ?? null,
    originSnapshot: { locationId: null, name: o.originName, snapshottedAt: new Date().toISOString() }, destinationSnapshot: dest,
  }).returning();
  const tl = await tx.insert(inventoryTransferLines).values(o.lines.map((l) => ({ shopId, transferId: t!.id, inventoryItemId: l.inventoryItemId, title: l.title, totalQuantity: l.quantity, purchaseOrderLineId: l.purchaseOrderLineId }))).returning();
  const [s] = await tx.insert(inventoryShipments).values({ shopId, transferId: t!.id, name: `${name}-S1`, status: 'IN_TRANSIT', dateShipped: new Date() }).returning();
  await tx.insert(inventoryShipmentLines).values(tl.map((l) => ({ shopId, shipmentId: s!.id, transferLineId: l.id, inventoryItemId: l.inventoryItemId, quantity: l.totalQuantity })));
  await emit(tx, shopId, 'inventory_transfer', t!.id, 'inventory_transfers/create');
  return { transferId: t!.id, shipmentId: s!.id };
}
