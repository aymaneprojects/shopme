import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import {
  inventoryItems, inventoryLevels, inventoryShipmentLines, inventoryTransferLines, inventoryTransfers, locations, productVariants, products, purchaseOrderLines, purchaseOrders, suppliers,
  type LocationSnapshotData, type SupplierAddress,
} from '../db/schema';
import type { Db, Executor } from '../db/client';
import { buildSearch, dateCompare, idTerm, likeCi } from './catalog/search';
import { emit, errR, normalizeTags, okR, txResult, type Result } from './catalog/common';
import { getShop } from './shops';
import { nextSequence } from './sequences';
import { applyLevelDeltas, createReceiptTransfer, receiveShipment, type InventoryTransfer } from './inventory-transfers';

export type Supplier = typeof suppliers.$inferSelect;
export type PurchaseOrderRow = typeof purchaseOrders.$inferSelect;
export type PurchaseOrderLineRow = typeof purchaseOrderLines.$inferSelect;
export type PurchaseOrderState = 'DRAFT' | 'ORDERED' | 'PARTIALLY_RECEIVED' | 'RECEIVED' | 'CLOSED';

export const MAX_PO_LINES = 5000;
export const PAYMENT_TERMS = ['NONE', 'DUE_ON_RECEIPT', 'DUE_ON_FULFILLMENT', 'NET_7', 'NET_15', 'NET_30', 'NET_45', 'NET_60'] as const;
export const poUri = (id: number) => `gid://shopify/InventoryPurchaseOrder/${id}`;

/* ------------------------------ suppliers ------------------------------ */

export interface SupplierInput { name?: string | null; contactName?: string | null; email?: string | null; phone?: string | null; address?: SupplierAddress | null; currency?: string | null; paymentTerms?: string | null; note?: string | null }

async function checkSupplier(db: Executor, shopId: number, i: SupplierInput, selfId?: number): Promise<Result<null>> {
  if (i.name !== undefined) {
    if (!i.name?.trim()) return errR(['input', 'name'], 'Add a supplier name.', 'BLANK');
    if (i.name.length > 255) return errR(['input', 'name'], 'The name is too long.', 'TOO_LONG');
    const [dup] = await db.select({ id: suppliers.id }).from(suppliers).where(and(eq(suppliers.shopId, shopId), sql`lower(${suppliers.name}) = ${i.name.trim().toLowerCase()}`));
    if (dup && dup.id !== selfId) return errR(['input', 'name'], 'A supplier with this name already exists.', 'TAKEN');
  }
  if (i.currency && !/^[A-Z]{3}$/.test(i.currency)) return errR(['input', 'currency'], 'The currency is invalid.', 'INVALID');
  if (i.email && !/^\S+@\S+\.\S+$/.test(i.email)) return errR(['input', 'email'], 'The email is invalid.', 'INVALID');
  return okR(null);
}

export async function listSuppliers(db: Executor, shopId: number, o: { query?: string | null; offset?: number; limit?: number } = {}): Promise<Supplier[]> {
  const search = buildSearch(o.query, { fields: { name: (_op, v) => likeCi(suppliers.name, v), id: (_op, v) => idTerm(suppliers.id, v) }, text: (v) => sql`(${likeCi(suppliers.name, v)} or ${likeCi(suppliers.contactName, v)} or ${likeCi(suppliers.email, v)})` });
  return db.select().from(suppliers).where(and(eq(suppliers.shopId, shopId), search)).orderBy(asc(sql`lower(${suppliers.name})`)).limit(o.limit ?? 250).offset(o.offset ?? 0);
}

export async function getSupplier(db: Executor, shopId: number, id: number): Promise<Supplier | null> {
  const [r] = await db.select().from(suppliers).where(and(eq(suppliers.shopId, shopId), eq(suppliers.id, id)));
  return r ?? null;
}

export async function createSupplier(db: Db, shopId: number, input: SupplierInput): Promise<Result<Supplier>> {
  const v = await checkSupplier(db, shopId, { ...input, name: input.name ?? '' });
  if (!v.ok) return v;
  const [row] = await db.insert(suppliers).values({
    shopId, name: input.name!.trim(), contactName: input.contactName ?? null, email: input.email ?? null, phone: input.phone ?? null, address: input.address ?? null,
    currency: input.currency ?? null, paymentTerms: input.paymentTerms ?? null, note: input.note ?? null,
  }).returning();
  return okR(row!);
}

export async function updateSupplier(db: Db, shopId: number, id: number, input: SupplierInput): Promise<Result<Supplier>> {
  const cur = await getSupplier(db, shopId, id);
  if (!cur) return errR(['id'], 'The supplier could not be found.', 'SUPPLIER_NOT_FOUND');
  const v = await checkSupplier(db, shopId, input, id);
  if (!v.ok) return v;
  const [row] = await db.update(suppliers).set({
    ...(input.name != null && { name: input.name.trim() }), ...(input.contactName !== undefined && { contactName: input.contactName }), ...(input.email !== undefined && { email: input.email }),
    ...(input.phone !== undefined && { phone: input.phone }), ...(input.address !== undefined && { address: input.address }), ...(input.currency !== undefined && { currency: input.currency }),
    ...(input.paymentTerms !== undefined && { paymentTerms: input.paymentTerms }), ...(input.note !== undefined && { note: input.note }),
  }).where(eq(suppliers.id, id)).returning();
  return okR(row!);
}

export async function deleteSupplier(db: Db, shopId: number, id: number): Promise<Result<number>> {
  const cur = await getSupplier(db, shopId, id);
  if (!cur) return errR(['id'], 'The supplier could not be found.', 'SUPPLIER_NOT_FOUND');
  await db.delete(suppliers).where(eq(suppliers.id, id));
  return okR(id);
}

/* ------------------------------ totals ------------------------------ */

export interface PoLineView extends PurchaseOrderLineRow { subtotal: number; tax: number; totalCost: number; outstandingQuantity: number }
export interface PoTotals { variants: number; items: number; subtotal: number; taxes: number; shipping: number; other: number; total: number }

/** Line amounts in the order currency. With taxes included the tax is a part of the line amount, otherwise it is added on top. */
export function lineAmounts(l: { quantity: number; unitCost: number; taxPercent: number | null }, taxesIncluded: boolean) {
  const subtotal = l.quantity * l.unitCost;
  const pct = l.taxPercent ?? 0;
  const tax = taxesIncluded ? Math.round((subtotal * pct) / (100 + pct)) : Math.round((subtotal * pct) / 100);
  return { subtotal, tax, totalCost: subtotal + (taxesIncluded ? 0 : tax) };
}

export function computeTotals(lines: { quantity: number; unitCost: number; taxPercent: number | null }[], taxesIncluded: boolean, shipping: number, other: number): PoTotals {
  let subtotal = 0; let taxes = 0; let total = 0;
  for (const l of lines) { const a = lineAmounts(l, taxesIncluded); subtotal += a.subtotal; taxes += a.tax; total += a.totalCost; }
  return { variants: lines.length, items: lines.reduce((n, l) => n + l.quantity, 0), subtotal, taxes, shipping, other, total: total + shipping + other };
}

export function purchaseOrderState(po: Pick<PurchaseOrderRow, 'status' | 'closedAt'>, lines: Pick<PurchaseOrderLineRow, 'quantity' | 'receivedQuantity' | 'rejectedQuantity'>[]): PurchaseOrderState {
  if (po.status === 'DRAFT') return 'DRAFT';
  const qty = lines.reduce((n, l) => n + l.quantity, 0);
  const resolved = lines.reduce((n, l) => n + l.receivedQuantity + l.rejectedQuantity, 0);
  if (qty > 0 && resolved >= qty) return 'RECEIVED';
  if (po.closedAt) return 'CLOSED';
  return resolved > 0 ? 'PARTIALLY_RECEIVED' : 'ORDERED';
}

/* ------------------------------ loading ------------------------------ */

export interface PurchaseOrderView extends PurchaseOrderRow {
  lines: PoLineView[]; totals: PoTotals; state: PurchaseOrderState; receivedQuantity: number; rejectedQuantity: number; totalQuantity: number;
  destination: LocationSnapshotData | null; supplier: Supplier | null;
}

export async function hydratePurchaseOrders(db: Executor, shopId: number, rows: PurchaseOrderRow[]): Promise<PurchaseOrderView[]> {
  if (!rows.length) return [];
  const lines = await db.select().from(purchaseOrderLines).where(and(eq(purchaseOrderLines.shopId, shopId), inArray(purchaseOrderLines.purchaseOrderId, rows.map((r) => r.id)))).orderBy(asc(purchaseOrderLines.id));
  const sup = new Map((await db.select().from(suppliers).where(and(eq(suppliers.shopId, shopId), inArray(suppliers.id, [...new Set(rows.map((r) => r.supplierId).filter((x): x is number => !!x))].concat(0))))).map((s) => [s.id, s]));
  const locs = new Map((await db.select().from(locations).where(and(eq(locations.shopId, shopId), inArray(locations.id, [...new Set(rows.map((r) => r.destinationLocationId).filter((x): x is number => !!x))].concat(0))))).map((l) => [l.id, l]));
  return rows.map((po) => {
    const mine = lines.filter((l) => l.purchaseOrderId === po.id);
    const lv: PoLineView[] = mine.map((l) => ({ ...l, ...lineAmounts(l, po.taxesIncluded), outstandingQuantity: Math.max(0, l.quantity - l.receivedQuantity - l.rejectedQuantity) }));
    const loc = po.destinationLocationId ? locs.get(po.destinationLocationId) : undefined;
    const destination = po.destinationSnapshot ?? (loc ? { locationId: loc.id, name: loc.name, address1: loc.address1, address2: loc.address2, city: loc.city, zip: loc.zip, countryCode: loc.countryCode, provinceCode: loc.provinceCode, phone: loc.phone, snapshottedAt: new Date().toISOString() } : null);
    return {
      ...po, lines: lv, totals: computeTotals(mine, po.taxesIncluded, po.shippingCost, po.otherCost), state: purchaseOrderState(po, mine),
      receivedQuantity: mine.reduce((n, l) => n + l.receivedQuantity, 0), rejectedQuantity: mine.reduce((n, l) => n + l.rejectedQuantity, 0), totalQuantity: mine.reduce((n, l) => n + l.quantity, 0),
      destination, supplier: po.supplierId ? sup.get(po.supplierId) ?? null : null,
    };
  });
}

export async function getPurchaseOrder(db: Executor, shopId: number, id: number): Promise<PurchaseOrderView | null> {
  const [r] = await db.select().from(purchaseOrders).where(and(eq(purchaseOrders.shopId, shopId), eq(purchaseOrders.id, id)));
  return r ? (await hydratePurchaseOrders(db, shopId, [r]))[0]! : null;
}

export interface ListPurchaseOrdersOptions { query?: string | null; state?: PurchaseOrderState | null; includeArchived?: boolean; sortKey?: 'CREATED_AT' | 'ID' | 'NAME' | 'ORDERED_AT'; reverse?: boolean; offset: number; limit: number }

async function matchingPurchaseOrders(db: Executor, shopId: number, o: ListPurchaseOrdersOptions): Promise<PurchaseOrderView[]> {
  const p = purchaseOrders;
  const search = buildSearch(o.query, {
    fields: {
      name: (_op, v) => likeCi(p.name, v), supplier: (_op, v) => likeCi(p.supplierName, v), destination_id: (_op, v) => idTerm(p.destinationLocationId, v),
      tag: (_op, v) => sql`${v} = any(${p.tags})`, created_at: (op, v) => dateCompare(p.dateCreated, op, v), id: (_op, v) => idTerm(p.id, v), reference: (_op, v) => likeCi(p.referenceNumber, v),
      status: (_op, v) => sql`${v === 'ordered' || v === 'draft' ? v.toUpperCase() : 'ZZZ'} = ${p.status}`,
    },
    text: (v) => sql`(${likeCi(p.name, v)} or ${likeCi(p.supplierName, v)} or ${likeCi(p.referenceNumber, v)})`,
  });
  const col = o.sortKey === 'NAME' ? p.name : o.sortKey === 'CREATED_AT' ? p.dateCreated : o.sortKey === 'ORDERED_AT' ? p.orderedAt : p.id;
  const rows = await db.select().from(p).where(and(eq(p.shopId, shopId), o.includeArchived ? undefined : sql`${p.archivedAt} is null`, search)).orderBy(o.reverse ? desc(col) : asc(col), o.reverse ? desc(p.id) : asc(p.id));
  const views = await hydratePurchaseOrders(db, shopId, rows);
  return o.state ? views.filter((v) => v.state === o.state) : views;
}

export async function listPurchaseOrders(db: Executor, shopId: number, o: ListPurchaseOrdersOptions): Promise<PurchaseOrderView[]> {
  return (await matchingPurchaseOrders(db, shopId, o)).slice(o.offset, o.offset + o.limit);
}
export async function countPurchaseOrders(db: Executor, shopId: number, o: Omit<ListPurchaseOrdersOptions, 'offset' | 'limit'>): Promise<number> {
  return (await matchingPurchaseOrders(db, shopId, { ...o, offset: 0, limit: 0 })).length;
}
export async function purchaseOrderStateCounts(db: Executor, shopId: number): Promise<Record<PurchaseOrderState, number>> {
  const out: Record<PurchaseOrderState, number> = { DRAFT: 0, ORDERED: 0, PARTIALLY_RECEIVED: 0, RECEIVED: 0, CLOSED: 0 };
  for (const v of await matchingPurchaseOrders(db, shopId, { offset: 0, limit: 0 })) out[v.state] += 1;
  return out;
}

export async function listPurchaseOrderTransfers(db: Executor, shopId: number, poId: number): Promise<InventoryTransfer[]> {
  return db.select().from(inventoryTransfers).where(and(eq(inventoryTransfers.shopId, shopId), eq(inventoryTransfers.purchaseOrderId, poId))).orderBy(asc(inventoryTransfers.id));
}

/* ------------------------------ create / update ------------------------------ */

export interface PoLineInput { inventoryItemId: number; quantity: number; unitCost?: number | null; supplierSku?: string | null; taxPercent?: number | null }
export interface PurchaseOrderInput {
  supplierId?: number | null; destinationLocationId?: number | null; currency?: string | null; exchangeRate?: number | null; taxesIncluded?: boolean | null;
  referenceNumber?: string | null; supplierNote?: string | null; paymentTerms?: string | null; tags?: string[] | null;
  shippingCost?: number | null; otherCost?: number | null; expectedArrival?: Date | null; carrier?: string | null; lineItems?: PoLineInput[] | null;
}

async function loadItems(db: Executor, shopId: number, ids: number[]) {
  if (!ids.length) return new Map<number, { item: typeof inventoryItems.$inferSelect; title: string; variantTitle: string | null }>();
  const rows = await db.select({ i: inventoryItems, pt: products.title, vt: productVariants.title }).from(inventoryItems)
    .innerJoin(productVariants, eq(productVariants.id, inventoryItems.variantId)).innerJoin(products, eq(products.id, productVariants.productId))
    .where(and(eq(inventoryItems.shopId, shopId), inArray(inventoryItems.id, ids)));
  return new Map(rows.map((r) => [r.i.id, { item: r.i, title: r.pt, variantTitle: r.vt && r.vt !== 'Default Title' ? r.vt : null }]));
}

async function validateInput(tx: Executor, shopId: number, i: PurchaseOrderInput, root: string[]): Promise<Result<{ tags?: string[]; items: Awaited<ReturnType<typeof loadItems>> }>> {
  if (i.referenceNumber && i.referenceNumber.length > 255) return errR([...root, 'referenceNumber'], 'The reference number is too long (maximum is 255 characters).', 'REFERENCE_TOO_LONG');
  if (i.supplierNote && i.supplierNote.length > 5000) return errR([...root, 'supplierNote'], 'The note is too long (maximum is 5000 characters).', 'NOTE_TOO_LONG');
  if (i.currency && !/^[A-Z]{3}$/.test(i.currency)) return errR([...root, 'currency'], 'The currency is invalid.', 'INVALID_COST');
  if ([i.shippingCost, i.otherCost].some((c) => c != null && (!Number.isInteger(c) || c < 0))) return errR([...root, 'shippingCost'], 'Costs cannot be negative.', 'INVALID_COST');
  let tags: string[] | undefined;
  if (i.tags) { tags = normalizeTags(i.tags); if (tags.some((t) => t.length > 40)) return errR([...root, 'tags'], 'A tag is too long (maximum is 40 characters).', 'TAG_EXCEEDS_MAX_LENGTH'); }
  if (i.supplierId && !(await getSupplier(tx, shopId, i.supplierId))) return errR([...root, 'supplierId'], 'The supplier could not be found.', 'SUPPLIER_NOT_FOUND');
  if (i.destinationLocationId) {
    const [l] = await tx.select().from(locations).where(and(eq(locations.shopId, shopId), eq(locations.id, i.destinationLocationId)));
    if (!l) return errR([...root, 'destinationLocationId'], 'The location could not be found.', 'LOCATION_NOT_FOUND');
    if (!l.isActive) return errR([...root, 'destinationLocationId'], 'The location is not active.', 'LOCATION_NOT_ACTIVE');
  }
  const lines = i.lineItems ?? [];
  if (lines.length > MAX_PO_LINES) return errR([...root, 'lineItems'], 'Too many items.', 'INVALID_QUANTITY');
  const items = await loadItems(tx, shopId, lines.map((l) => l.inventoryItemId));
  const seen = new Set<number>();
  for (const [n, l] of lines.entries()) {
    const at = [...root, 'lineItems', String(n)];
    if (seen.has(l.inventoryItemId)) return errR([...at, 'inventoryItemId'], 'The same item appears more than once.', 'DUPLICATE_ITEM');
    seen.add(l.inventoryItemId);
    const it = items.get(l.inventoryItemId);
    if (!it) return errR([...at, 'inventoryItemId'], 'The inventory item could not be found.', 'ITEM_NOT_FOUND');
    if (!it.item.tracked) return errR([...at, 'inventoryItemId'], 'The inventory item is not tracked.', 'UNTRACKED_ITEM');
    if (!Number.isInteger(l.quantity) || l.quantity < 1) return errR([...at, 'quantity'], 'The quantity must be at least 1.', 'INVALID_QUANTITY');
    if (l.unitCost != null && (!Number.isInteger(l.unitCost) || l.unitCost < 0)) return errR([...at, 'unitCost'], 'The unit cost cannot be negative.', 'INVALID_COST');
    if (l.taxPercent != null && (l.taxPercent < 0 || l.taxPercent > 100)) return errR([...at, 'taxPercent'], 'The tax rate must be between 0 and 100.', 'INVALID_COST');
  }
  return okR({ tags, items });
}

const lineValues = (shopId: number, poId: number, l: PoLineInput, it: { item: typeof inventoryItems.$inferSelect; title: string; variantTitle: string | null }) => ({
  shopId, purchaseOrderId: poId, inventoryItemId: l.inventoryItemId, title: it.title, variantTitle: it.variantTitle, sku: it.item.sku,
  supplierSku: l.supplierSku || null, quantity: l.quantity, unitCost: l.unitCost ?? it.item.unitCost ?? 0, taxPercent: l.taxPercent ?? null,
});

export async function createPurchaseOrder(db: Db, shopId: number, input: PurchaseOrderInput): Promise<Result<PurchaseOrderView>> {
  return txResult(db, async (tx) => {
    const v = await validateInput(tx, shopId, input, ['input']);
    if (!v.ok) return v;
    const shop = (await getShop(tx, shopId))!;
    const supplier = input.supplierId ? await getSupplier(tx, shopId, input.supplierId) : null;
    const name = `#PO${await nextSequence(tx, shopId, 'purchase_order')}`;
    const [po] = await tx.insert(purchaseOrders).values({
      shopId, name, supplierId: supplier?.id ?? null, supplierName: supplier?.name ?? null, destinationLocationId: input.destinationLocationId ?? null,
      currency: input.currency ?? supplier?.currency ?? shop.currency, exchangeRate: input.exchangeRate ?? null, taxesIncluded: input.taxesIncluded ?? true,
      referenceNumber: input.referenceNumber?.trim() || null, supplierNote: input.supplierNote?.trim() || null, paymentTerms: input.paymentTerms ?? supplier?.paymentTerms ?? null,
      tags: v.value.tags ?? [], shippingCost: input.shippingCost ?? 0, otherCost: input.otherCost ?? 0, expectedArrival: input.expectedArrival ?? null, carrier: input.carrier ?? null,
    }).returning();
    const lines = input.lineItems ?? [];
    if (lines.length) await tx.insert(purchaseOrderLines).values(lines.map((l) => lineValues(shopId, po!.id, l, v.value.items.get(l.inventoryItemId)!)));
    await emit(tx, shopId, 'inventory_purchase_order', po!.id, 'inventory_purchase_orders/create');
    return okR((await getPurchaseOrder(tx, shopId, po!.id))!);
  });
}

const notFound = () => errR(['id'], 'The purchase order could not be found.', 'PURCHASE_ORDER_NOT_FOUND');

/** Adjust `incoming` at the order's destination (reason `purchase_order_*`). */
async function holdIncoming(tx: Executor, shopId: number, po: PurchaseOrderRow, changes: { inventoryItemId: number; qty: number }[], reason: string) {
  if (!po.destinationLocationId) return;
  await applyLevelDeltas(tx, shopId, reason, poUri(po.id), changes.filter((c) => c.qty !== 0).map((c) => ({ inventoryItemId: c.inventoryItemId, locationId: po.destinationLocationId!, incoming: c.qty })));
}

export async function updatePurchaseOrder(db: Db, shopId: number, id: number, input: PurchaseOrderInput): Promise<Result<PurchaseOrderView>> {
  return txResult(db, async (tx) => {
    const cur = await getPurchaseOrder(tx, shopId, id);
    if (!cur) return notFound();
    if (cur.state === 'CLOSED' || cur.state === 'RECEIVED') return errR(['id'], 'A closed or received purchase order cannot be edited.', 'INVALID_STATUS');
    const received = cur.receivedQuantity + cur.rejectedQuantity > 0;
    if (received && ((input.supplierId !== undefined && input.supplierId !== cur.supplierId) || (input.destinationLocationId !== undefined && input.destinationLocationId !== cur.destinationLocationId))) {
      return errR(['input', 'destinationLocationId'], 'The supplier and destination are locked once items were received.', 'INVALID_STATUS');
    }
    const v = await validateInput(tx, shopId, input, ['input']);
    if (!v.ok) return v;
    const ordered = cur.status === 'ORDERED';
    const destChanged = input.destinationLocationId !== undefined && input.destinationLocationId !== cur.destinationLocationId;
    const supplier = input.supplierId !== undefined ? (input.supplierId ? await getSupplier(tx, shopId, input.supplierId) : null) : undefined;
    const incomingMoves: { inventoryItemId: number; qty: number }[] = [];
    if (input.lineItems) {
      if (ordered && !input.lineItems.length) return errR(['input', 'lineItems'], 'An ordered purchase order needs at least one item.', 'ITEMS_EMPTY');
      const keep = new Set(input.lineItems.map((l) => l.inventoryItemId));
      for (const old of cur.lines) {
        if (keep.has(old.inventoryItemId)) continue;
        if (old.receivedQuantity + old.rejectedQuantity > 0) return errR(['input', 'lineItems'], 'A line with received items cannot be removed.', 'INVALID_QUANTITY');
        await tx.delete(purchaseOrderLines).where(eq(purchaseOrderLines.id, old.id));
        incomingMoves.push({ inventoryItemId: old.inventoryItemId, qty: -old.outstandingQuantity });
      }
      for (const l of input.lineItems) {
        const old = cur.lines.find((x) => x.inventoryItemId === l.inventoryItemId);
        if (!old) {
          await tx.insert(purchaseOrderLines).values(lineValues(shopId, id, l, v.value.items.get(l.inventoryItemId)!));
          incomingMoves.push({ inventoryItemId: l.inventoryItemId, qty: l.quantity });
          continue;
        }
        if (l.quantity < old.receivedQuantity + old.rejectedQuantity) return errR(['input', 'lineItems'], 'The quantity cannot go below what was already received.', 'INVALID_QUANTITY');
        await tx.update(purchaseOrderLines).set({
          quantity: l.quantity, ...(l.unitCost != null && { unitCost: l.unitCost }), ...(l.supplierSku !== undefined && { supplierSku: l.supplierSku || null }), ...(l.taxPercent !== undefined && { taxPercent: l.taxPercent }),
        }).where(eq(purchaseOrderLines.id, old.id));
        incomingMoves.push({ inventoryItemId: l.inventoryItemId, qty: l.quantity - old.quantity });
      }
    }
    if (ordered) {
      // Incoming follows the order: quantity edits adjust it, a new destination moves all outstanding units over.
      if (destChanged) {
        if (!input.destinationLocationId) return errR(['input', 'destinationLocationId'], 'An ordered purchase order needs a destination.', 'LOCATION_NOT_FOUND');
        const after = (await getPurchaseOrder(tx, shopId, id))!;
        await holdIncoming(tx, shopId, cur, cur.lines.map((l) => ({ inventoryItemId: l.inventoryItemId, qty: -l.outstandingQuantity })), 'purchase_order_updated');
        await holdIncoming(tx, shopId, { ...cur, destinationLocationId: input.destinationLocationId }, after.lines.map((l) => ({ inventoryItemId: l.inventoryItemId, qty: l.outstandingQuantity })), 'purchase_order_updated');
      } else await holdIncoming(tx, shopId, cur, incomingMoves, 'purchase_order_updated');
    }
    await tx.update(purchaseOrders).set({
      updatedAt: new Date(),
      ...(supplier !== undefined && { supplierId: supplier?.id ?? null, supplierName: supplier?.name ?? null }),
      ...(input.destinationLocationId !== undefined && { destinationLocationId: input.destinationLocationId, destinationSnapshot: null }),
      ...(input.currency && { currency: input.currency }), ...(input.exchangeRate !== undefined && { exchangeRate: input.exchangeRate }), ...(input.taxesIncluded != null && { taxesIncluded: input.taxesIncluded }),
      ...(input.referenceNumber !== undefined && { referenceNumber: input.referenceNumber?.trim() || null }), ...(input.supplierNote !== undefined && { supplierNote: input.supplierNote?.trim() || null }),
      ...(input.paymentTerms !== undefined && { paymentTerms: input.paymentTerms }), ...(v.value.tags && { tags: v.value.tags }),
      ...(input.shippingCost != null && { shippingCost: input.shippingCost }), ...(input.otherCost != null && { otherCost: input.otherCost }),
      ...(input.expectedArrival !== undefined && { expectedArrival: input.expectedArrival }), ...(input.carrier !== undefined && { carrier: input.carrier }),
    }).where(eq(purchaseOrders.id, id));
    if (ordered && input.destinationLocationId) await snapshotPo(tx, shopId, id);
    await emit(tx, shopId, 'inventory_purchase_order', id, 'inventory_purchase_orders/update');
    return okR((await getPurchaseOrder(tx, shopId, id))!);
  });
}

async function snapshotPo(tx: Executor, shopId: number, id: number) {
  const [po] = await tx.select().from(purchaseOrders).where(eq(purchaseOrders.id, id));
  if (!po?.destinationLocationId) return;
  const [l] = await tx.select().from(locations).where(eq(locations.id, po.destinationLocationId));
  if (!l) return;
  await tx.update(purchaseOrders).set({ destinationSnapshot: { locationId: l.id, name: l.name, address1: l.address1, address2: l.address2, city: l.city, zip: l.zip, countryCode: l.countryCode, provinceCode: l.provinceCode, phone: l.phone, snapshottedAt: new Date().toISOString() } }).where(eq(purchaseOrders.id, id));
}

/* ------------------------------ lifecycle ------------------------------ */

export async function markPurchaseOrderAsOrdered(db: Db, shopId: number, id: number): Promise<Result<PurchaseOrderView>> {
  return txResult(db, async (tx) => {
    const po = await getPurchaseOrder(tx, shopId, id);
    if (!po) return notFound();
    if (po.status !== 'DRAFT') return errR(['id'], 'Only a draft purchase order can be marked as ordered.', 'INVALID_STATUS');
    if (!po.supplier) return errR(['id'], 'Choose a supplier.', 'SUPPLIER_NOT_FOUND');
    if (!po.destinationLocationId) return errR(['id'], 'Choose a destination.', 'LOCATION_NOT_FOUND');
    const [loc] = await tx.select().from(locations).where(eq(locations.id, po.destinationLocationId));
    if (!loc?.isActive) return errR(['id'], 'The destination is not active.', 'LOCATION_NOT_ACTIVE');
    if (!po.lines.length) return errR(['id'], 'Add at least one item.', 'ITEMS_EMPTY');
    await holdIncoming(tx, shopId, po, po.lines.map((l) => ({ inventoryItemId: l.inventoryItemId, qty: l.quantity })), 'purchase_order_ordered');
    await tx.update(purchaseOrders).set({ status: 'ORDERED', orderedAt: new Date(), supplierName: po.supplier.name }).where(eq(purchaseOrders.id, id));
    await snapshotPo(tx, shopId, id);
    await emit(tx, shopId, 'inventory_purchase_order', id, 'inventory_purchase_orders/ordered');
    return okR((await getPurchaseOrder(tx, shopId, id))!);
  });
}

/** Close an ordered purchase order: outstanding units no longer count as incoming. */
export async function closePurchaseOrder(db: Db, shopId: number, id: number): Promise<Result<PurchaseOrderView>> {
  return txResult(db, async (tx) => {
    const po = await getPurchaseOrder(tx, shopId, id);
    if (!po) return notFound();
    if (po.status !== 'ORDERED' || po.closedAt) return errR(['id'], 'Only an open ordered purchase order can be closed.', 'INVALID_STATUS');
    await holdIncoming(tx, shopId, po, po.lines.map((l) => ({ inventoryItemId: l.inventoryItemId, qty: -l.outstandingQuantity })), 'purchase_order_closed');
    await tx.update(purchaseOrders).set({ closedAt: new Date() }).where(eq(purchaseOrders.id, id));
    await emit(tx, shopId, 'inventory_purchase_order', id, 'inventory_purchase_orders/closed');
    return okR((await getPurchaseOrder(tx, shopId, id))!);
  });
}

export async function archivePurchaseOrder(db: Db, shopId: number, id: number, archive = true): Promise<Result<PurchaseOrderView>> {
  const po = await getPurchaseOrder(db, shopId, id);
  if (!po) return notFound();
  if (archive && po.state !== 'CLOSED' && po.state !== 'RECEIVED' && po.state !== 'DRAFT') return errR(['id'], 'Close the purchase order before archiving it.', 'INVALID_STATUS');
  await db.update(purchaseOrders).set({ archivedAt: archive ? new Date() : null }).where(eq(purchaseOrders.id, id));
  return okR((await getPurchaseOrder(db, shopId, id))!);
}

export async function deletePurchaseOrder(db: Db, shopId: number, id: number): Promise<Result<number>> {
  const po = await getPurchaseOrder(db, shopId, id);
  if (!po) return notFound();
  if (po.status !== 'DRAFT') return errR(['id'], 'Only a draft purchase order can be deleted.', 'INVALID_STATUS');
  await db.delete(purchaseOrders).where(eq(purchaseOrders.id, id));
  return okR(id);
}

export async function duplicatePurchaseOrder(db: Db, shopId: number, id: number): Promise<Result<PurchaseOrderView>> {
  const po = await getPurchaseOrder(db, shopId, id);
  if (!po) return notFound();
  return createPurchaseOrder(db, shopId, {
    supplierId: po.supplierId, destinationLocationId: po.destinationLocationId, currency: po.currency, exchangeRate: po.exchangeRate, taxesIncluded: po.taxesIncluded, referenceNumber: po.referenceNumber,
    supplierNote: po.supplierNote, paymentTerms: po.paymentTerms, tags: po.tags, shippingCost: po.shippingCost, otherCost: po.otherCost, carrier: po.carrier,
    lineItems: po.lines.map((l) => ({ inventoryItemId: l.inventoryItemId, quantity: l.quantity, unitCost: l.unitCost, supplierSku: l.supplierSku, taxPercent: l.taxPercent })),
  });
}

/* ------------------------------ receiving ------------------------------ */

export interface PoReceiveInput {
  lineItems: { purchaseOrderLineItemId: number; acceptedQuantity?: number; rejectedQuantity?: number }[];
  /** Allow receiving more than ordered: the order quantity grows to match. */
  allowOverReceive?: boolean;
  /** Update the item's unit cost from the order line (default true). */
  updateUnitCost?: boolean;
  /** `average` (weighted by on hand units, default) or `last`. */
  costMethod?: 'average' | 'last';
}

/** Receive units against an ordered purchase order in one step: creates the linked transfer and shipment and receives it. */
export async function receivePurchaseOrder(db: Db, shopId: number, id: number, input: PoReceiveInput): Promise<Result<{ purchaseOrder: PurchaseOrderView; transferId: number; shipmentId: number }>> {
  return txResult(db, async (tx) => {
    const po = await getPurchaseOrder(tx, shopId, id);
    if (!po) return notFound();
    if (po.status !== 'ORDERED' || po.closedAt) return errR(['id'], 'Only an open ordered purchase order can be received.', 'INVALID_STATUS');
    if (!po.destinationLocationId) return errR(['id'], 'The purchase order has no destination.', 'LOCATION_NOT_FOUND');
    const [loc] = await tx.select().from(locations).where(eq(locations.id, po.destinationLocationId));
    if (!loc?.isActive) return errR(['id'], 'The destination is not active.', 'LOCATION_NOT_ACTIVE');
    const picks: { line: PoLineView; accepted: number; rejected: number }[] = [];
    const seen = new Set<number>();
    for (const [n, li] of input.lineItems.entries()) {
      const at = ['lineItems', String(n)];
      const line = po.lines.find((l) => l.id === li.purchaseOrderLineItemId);
      if (!line) return errR([...at, 'purchaseOrderLineItemId'], 'The line could not be found.', 'ITEM_NOT_FOUND');
      if (seen.has(line.id)) return errR([...at, 'purchaseOrderLineItemId'], 'The same line appears more than once.', 'DUPLICATE_ITEM');
      seen.add(line.id);
      const accepted = li.acceptedQuantity ?? 0; const rejected = li.rejectedQuantity ?? 0;
      if (!Number.isInteger(accepted) || !Number.isInteger(rejected) || accepted < 0 || rejected < 0 || accepted + rejected < 1) return errR([...at, 'acceptedQuantity'], 'Enter a quantity of at least 1.', 'INVALID_QUANTITY');
      if (accepted + rejected > line.outstandingQuantity && !input.allowOverReceive) return errR([...at, 'acceptedQuantity'], 'The quantity is more than what is still expected.', 'INVALID_QUANTITY');
      picks.push({ line, accepted, rejected });
    }
    if (!picks.length) return errR(['lineItems'], 'Nothing to receive.', 'ITEMS_EMPTY');
    // Over-received units extend the order (and its incoming stock) before they arrive.
    const extra = picks.map((p) => ({ inventoryItemId: p.line.inventoryItemId, qty: Math.max(0, p.accepted + p.rejected - p.line.outstandingQuantity) }));
    for (const [i, p] of picks.entries()) if (extra[i]!.qty > 0) await tx.update(purchaseOrderLines).set({ quantity: p.line.quantity + extra[i]!.qty }).where(eq(purchaseOrderLines.id, p.line.id));
    await holdIncoming(tx, shopId, po, extra, 'purchase_order_updated');

    // Pre-receipt state for the cost average.
    const costBefore = new Map<number, { cost: number | null; onHand: number }>();
    for (const p of picks) {
      const [it] = await tx.select({ c: inventoryItems.unitCost }).from(inventoryItems).where(eq(inventoryItems.id, p.line.inventoryItemId));
      const [oh] = await tx.select({ n: sql<number>`coalesce(sum(${inventoryLevels.onHand}), 0)::int` }).from(inventoryLevels).where(and(eq(inventoryLevels.inventoryItemId, p.line.inventoryItemId), eq(inventoryLevels.isActive, true)));
      costBefore.set(p.line.inventoryItemId, { cost: it?.c ?? null, onHand: oh?.n ?? 0 });
    }

    const { transferId, shipmentId } = await createReceiptTransfer(tx as never, shopId, {
      purchaseOrderId: id, originName: po.supplierName ?? po.supplier?.name ?? 'Supplier', destinationLocationId: po.destinationLocationId, referenceName: po.name,
      lines: picks.map((p) => ({ inventoryItemId: p.line.inventoryItemId, title: [p.line.title, p.line.variantTitle].filter(Boolean).join(' - ') || null, quantity: p.accepted + p.rejected, purchaseOrderLineId: p.line.id })),
    });
    const sLines = await tx.select().from(inventoryShipmentLines).where(eq(inventoryShipmentLines.shipmentId, shipmentId));
    const received = await receiveShipment(tx as never, shopId, shipmentId, {
      lineItems: picks.flatMap((p) => {
        const sl = sLines.find((x) => x.inventoryItemId === p.line.inventoryItemId)!;
        return [
          ...(p.accepted ? [{ shipmentLineItemId: sl.id, quantity: p.accepted, reason: 'ACCEPTED' as const }] : []),
          ...(p.rejected ? [{ shipmentLineItemId: sl.id, quantity: p.rejected, reason: 'REJECTED' as const }] : []),
        ];
      }),
    });
    if (!received.ok) return received;

    if (input.updateUnitCost !== false) {
      const rate = po.exchangeRate && po.currency !== (await getShop(tx, shopId))!.currency ? po.exchangeRate : 1;
      for (const p of picks) {
        if (!p.accepted) continue;
        const lineCost = Math.round(p.line.unitCost * rate);
        const before = costBefore.get(p.line.inventoryItemId)!;
        const next = input.costMethod === 'last' || before.cost == null || before.onHand <= 0 ? lineCost
          : Math.round((before.cost * before.onHand + lineCost * p.accepted) / (before.onHand + p.accepted));
        await tx.update(inventoryItems).set({ unitCost: next }).where(eq(inventoryItems.id, p.line.inventoryItemId));
      }
    }
    await emit(tx, shopId, 'inventory_purchase_order', id, 'inventory_purchase_orders/receive');
    return okR({ purchaseOrder: (await getPurchaseOrder(tx, shopId, id))!, transferId, shipmentId });
  });
}

/** Called by shipment receiving for transfers linked to a purchase order: keeps the order line counters in step. */
export async function applyPurchaseOrderReceipt(
  tx: Executor, _shopId: number, transfer: InventoryTransfer, plan: { transferLineId: number; inventoryItemId: number; quantity: number; reason: 'ACCEPTED' | 'REJECTED' | 'CANCELED' }[],
): Promise<void> {
  for (const p of plan) {
    const [tl] = await tx.select().from(inventoryTransferLines).where(eq(inventoryTransferLines.id, p.transferLineId));
    if (!tl?.purchaseOrderLineId) continue;
    await tx.update(purchaseOrderLines).set(p.reason === 'ACCEPTED'
      ? { receivedQuantity: sql`${purchaseOrderLines.receivedQuantity} + ${p.quantity}` }
      : { rejectedQuantity: sql`${purchaseOrderLines.rejectedQuantity} + ${p.quantity}` }).where(eq(purchaseOrderLines.id, tl.purchaseOrderLineId));
  }
  void transfer;
}
