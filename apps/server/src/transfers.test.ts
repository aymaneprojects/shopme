import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import {
  addLocation, setLocationActive, addShipmentItems, cancelTransfer, closePurchaseOrder, computeTotals, createLocalStorage, createPurchaseOrder, createShipment, createSupplier, createTransfer, deleteShipment, deleteTransfer,
  duplicateTransfer, editTransfer, getPrimaryShop, getPurchaseOrder, getShipment, getTransfer, listTransfers, markPurchaseOrderAsOrdered, markShipmentInTransit, markTransferReadyToShip,
  receivePurchaseOrder, receiveShipment, removeShipmentItems, removeTransferItems, schema as s, seedDemo, setTransferItems, updatePurchaseOrder, updateShipmentItemQuantities,
  type Result,
} from '@shopme/core';
import { createTestApp, SETUP_BODY, type TestApp } from './test-utils';
import { makeGql, makeGqlOk } from '../test/conformance/helpers';

let t: TestApp;
let g: ReturnType<typeof makeGqlOk>;
let gql: ReturnType<typeof makeGql>;
let shopId: number;
let main: number;
let second: number;
let third: number;
const items: number[] = [];
const db = () => t.dbHandle.db;
const gid = (type: string, id: number) => `gid://shopify/${type}/${id}`;

beforeAll(async () => {
  t = await createTestApp();
  const setup = await t.app.inject({ method: 'POST', url: '/admin/api/setup', payload: SETUP_BODY });
  const cookie = setup.cookies.find((c) => c.name === 'shopme_session')!.value;
  gql = makeGql(t.app, cookie);
  g = makeGqlOk(gql);
  await seedDemo(db(), createLocalStorage(mkdtempSync(path.join(tmpdir(), 'transfers-'))));
  shopId = (await getPrimaryShop(db()))!.id;
  main = (await db().select().from(s.locations).where(eq(s.locations.shopId, shopId)))[0]!.id;
  const l2 = await addLocation(db(), shopId, { name: 'Warehouse', address: { countryCode: 'FR', city: 'Lyon' } });
  const l3 = await addLocation(db(), shopId, { name: 'Pop-up', address: { countryCode: 'FR' } });
  if (!l2.ok || !l3.ok) throw new Error('locations');
  second = l2.value.id; third = l3.value.id;
  const rows = await db().select().from(s.inventoryItems).where(eq(s.inventoryItems.shopId, shopId));
  items.push(...rows.slice(0, 6).map((r) => r.id));
}, 90_000);
afterAll(async () => { await t.close(); });

const ok = <T>(r: Result<T>): T => { if (!r.ok) throw new Error(JSON.stringify(r.errors)); return r.value; };
const errCode = (r: Result<unknown>) => (r.ok ? null : r.errors[0]!.code);

async function level(item: number, location: number) {
  const [l] = await db().select().from(s.inventoryLevels).where(and(eq(s.inventoryLevels.inventoryItemId, item), eq(s.inventoryLevels.locationId, location)));
  return l ? { available: l.available, onHand: l.onHand, incoming: l.incoming, reserved: l.reserved, committed: l.committed } : { available: 0, onHand: 0, incoming: 0, reserved: 0, committed: 0 };
}
/** Put exact stock in a location (no ledger needed for the arrange step). */
async function stock(item: number, location: number, n: number) {
  await db().insert(s.inventoryLevels).values({ shopId, inventoryItemId: item, locationId: location, available: n, onHand: n })
    .onConflictDoUpdate({ target: [s.inventoryLevels.inventoryItemId, s.inventoryLevels.locationId], set: { available: n, onHand: n, incoming: 0, reserved: 0, committed: 0, isActive: true } });
}
const newTransfer = async (lines: { inventoryItemId: number; quantity: number }[], from = main, to = second) =>
  ok(await createTransfer(db(), shopId, { originLocationId: from, destinationLocationId: to, lineItems: lines }));

describe('inventory transfers: lifecycle and quantities', () => {
  it('creates a draft with no stock effect and numbered names', async () => {
    await stock(items[0]!, main, 20); await stock(items[0]!, second, 0);
    const tr = await newTransfer([{ inventoryItemId: items[0]!, quantity: 5 }]);
    expect(tr.status).toBe('DRAFT');
    expect(tr.name).toMatch(/^#T\d{4}$/);
    expect(tr.totalQuantity).toBe(5);
    expect(await level(items[0]!, main)).toMatchObject({ available: 20, reserved: 0 });
    expect(await level(items[0]!, second)).toMatchObject({ incoming: 0 });
    // drafts may exceed stock
    const big = await newTransfer([{ inventoryItemId: items[0]!, quantity: 500 }]);
    expect(big.status).toBe('DRAFT');
    const r = await markTransferReadyToShip(db(), shopId, big.id);
    expect(errCode(r)).toBe('INVALID_ITEM');
  });

  it('validates locations, items and quantities on create', async () => {
    expect(errCode(await createTransfer(db(), shopId, { originLocationId: main, destinationLocationId: main }))).toBe('TRANSFER_ORIGIN_CANNOT_BE_THE_SAME_AS_DESTINATION');
    expect(errCode(await createTransfer(db(), shopId, { originLocationId: 9999, destinationLocationId: second }))).toBe('LOCATION_NOT_FOUND');
    expect(errCode(await createTransfer(db(), shopId, { originLocationId: main, destinationLocationId: second, lineItems: [{ inventoryItemId: items[0]!, quantity: 0 }] }))).toBe('INVALID_QUANTITY');
    expect(errCode(await createTransfer(db(), shopId, { originLocationId: main, destinationLocationId: second, lineItems: [{ inventoryItemId: 987654, quantity: 1 }] }))).toBe('ITEM_NOT_FOUND');
    expect(errCode(await createTransfer(db(), shopId, { originLocationId: main, destinationLocationId: second, lineItems: [{ inventoryItemId: items[0]!, quantity: 1 }, { inventoryItemId: items[0]!, quantity: 2 }] }))).toBe('DUPLICATE_ITEM');
    expect(errCode(await createTransfer(db(), shopId, { originLocationId: main, destinationLocationId: second, tags: ['x'.repeat(41)] }))).toBe('TAG_EXCEEDS_MAX_LENGTH');
    expect(errCode(await createTransfer(db(), shopId, { originLocationId: main, destinationLocationId: second }, { readyToShip: true }))).toBe('ITEMS_EMPTY');
  });

  it('ready to ship reserves at origin and sets incoming at destination', async () => {
    await stock(items[1]!, main, 10); await stock(items[1]!, second, 3);
    const tr = await newTransfer([{ inventoryItemId: items[1]!, quantity: 4 }]);
    const ready = ok(await markTransferReadyToShip(db(), shopId, tr.id));
    expect(ready.status).toBe('READY_TO_SHIP');
    expect(ready.origin?.name).toBeTruthy();
    expect(await level(items[1]!, main)).toMatchObject({ available: 6, onHand: 10, reserved: 4 });
    expect(await level(items[1]!, second)).toMatchObject({ available: 3, incoming: 4 });
    // not twice
    expect(errCode(await markTransferReadyToShip(db(), shopId, tr.id))).toBe('INVALID_TRANSFER_STATUS');
    // ledger entries share a group and use the transfer reason
    const ledger = await db().select().from(s.inventoryAdjustments).where(and(eq(s.inventoryAdjustments.inventoryItemId, items[1]!), eq(s.inventoryAdjustments.reason, 'transfer_ready')));
    expect(ledger.length).toBe(3);
    expect(new Set(ledger.map((l) => l.groupId)).size).toBe(1);
    expect(ledger[0]!.referenceUri).toBe(`gid://shopify/InventoryTransfer/${tr.id}`);
  });

  it('full flow: ship all, receive all, quantities end consistent', async () => {
    await stock(items[2]!, main, 10); await stock(items[2]!, second, 0);
    const tr = await newTransfer([{ inventoryItemId: items[2]!, quantity: 6 }]);
    await markTransferReadyToShip(db(), shopId, tr.id);
    const sh = ok(await createShipment(db(), shopId, { transferId: tr.id, lineItems: [{ inventoryItemId: items[2]!, quantity: 6 }], tracking: { company: 'DHL', trackingNumber: 'ABC123', trackingUrl: 'https://track.example/ABC123' }, barcode: 'SHIP-1' }));
    expect(sh.status).toBe('DRAFT');
    expect(sh.name).toBe(`${tr.name}-S1`);
    expect((await getTransfer(db(), shopId, tr.id))!.lines[0]!.pickedForShipmentQuantity).toBe(6);
    // draft shipment: nothing moved yet
    expect(await level(items[2]!, main)).toMatchObject({ available: 4, onHand: 10, reserved: 6 });
    const moving = ok(await markShipmentInTransit(db(), shopId, sh.id));
    expect(moving.status).toBe('IN_TRANSIT');
    expect(moving.transfer.status).toBe('IN_PROGRESS');
    expect(await level(items[2]!, main)).toMatchObject({ available: 4, onHand: 4, reserved: 0 });
    expect(await level(items[2]!, second)).toMatchObject({ available: 0, onHand: 0, incoming: 6 });
    const line = moving.lines[0]!;
    const got = ok(await receiveShipment(db(), shopId, sh.id, { lineItems: [{ shipmentLineItemId: line.id, quantity: 6, reason: 'ACCEPTED' }] }));
    expect(got.status).toBe('RECEIVED');
    expect(got.dateReceived).toBeTruthy();
    expect((await getTransfer(db(), shopId, tr.id))!.status).toBe('TRANSFERRED');
    expect((await getTransfer(db(), shopId, tr.id))!.receivedQuantity).toBe(6);
    expect(await level(items[2]!, second)).toMatchObject({ available: 6, onHand: 6, incoming: 0 });
    expect(errCode(await receiveShipment(db(), shopId, sh.id, { bulkReceiveAction: 'ACCEPTED' }))).toBe('INVALID_SHIPMENT_STATUS');
  });

  it('partial receiving with rejected and canceled units over several receipts', async () => {
    await stock(items[3]!, main, 20); await stock(items[3]!, second, 0);
    const tr = await newTransfer([{ inventoryItemId: items[3]!, quantity: 10 }]);
    await markTransferReadyToShip(db(), shopId, tr.id);
    const sh = ok(await createShipment(db(), shopId, { transferId: tr.id, lineItems: [{ inventoryItemId: items[3]!, quantity: 10 }] }, true));
    expect(sh.status).toBe('IN_TRANSIT');
    const lineId = sh.lines[0]!.id;
    expect(errCode(await receiveShipment(db(), shopId, sh.id, { lineItems: [{ shipmentLineItemId: lineId, quantity: 11, reason: 'ACCEPTED' }] }))).toBe('INVALID_QUANTITY');
    expect(errCode(await receiveShipment(db(), shopId, sh.id, { lineItems: [{ shipmentLineItemId: lineId, quantity: 0, reason: 'ACCEPTED' }] }))).toBe('INVALID_QUANTITY');
    const a = ok(await receiveShipment(db(), shopId, sh.id, { lineItems: [{ shipmentLineItemId: lineId, quantity: 4, reason: 'ACCEPTED' }, { shipmentLineItemId: lineId, quantity: 1, reason: 'REJECTED' }] }));
    expect(a.status).toBe('PARTIALLY_RECEIVED');
    expect(a.transfer.status).toBe('IN_PROGRESS');
    expect(a.lines[0]).toMatchObject({ acceptedQuantity: 4, rejectedQuantity: 1, unreceivedQuantity: 5 });
    expect(await level(items[3]!, second)).toMatchObject({ available: 4, onHand: 4, incoming: 5 });
    // all duplicates of the same line count together
    expect(errCode(await receiveShipment(db(), shopId, sh.id, { lineItems: [{ shipmentLineItemId: lineId, quantity: 3, reason: 'ACCEPTED' }, { shipmentLineItemId: lineId, quantity: 3, reason: 'ACCEPTED' }] }))).toBe('INVALID_QUANTITY');
    const b = ok(await receiveShipment(db(), shopId, sh.id, { lineItems: [{ shipmentLineItemId: lineId, quantity: 2, reason: 'ACCEPTED' }], bulkReceiveAction: 'CANCELED' }));
    expect(b.status).toBe('RECEIVED');
    expect(b.lines[0]).toMatchObject({ acceptedQuantity: 6, rejectedQuantity: 1, canceledQuantity: 3, unreceivedQuantity: 0 });
    expect(await level(items[3]!, second)).toMatchObject({ available: 6, onHand: 6, incoming: 0 });
    expect(await level(items[3]!, main)).toMatchObject({ available: 10, onHand: 10, reserved: 0 });
    expect((await getTransfer(db(), shopId, tr.id))!.status).toBe('TRANSFERRED');
  });

  it('partial shipping: several shipments, remainder removed completes the transfer', async () => {
    await stock(items[4]!, main, 30); await stock(items[4]!, third, 0);
    const tr = await newTransfer([{ inventoryItemId: items[4]!, quantity: 9 }], main, third);
    await markTransferReadyToShip(db(), shopId, tr.id);
    const s1 = ok(await createShipment(db(), shopId, { transferId: tr.id, lineItems: [{ inventoryItemId: items[4]!, quantity: 4 }] }, true));
    expect(s1.transfer.status).toBe('IN_PROGRESS');
    expect(await level(items[4]!, main)).toMatchObject({ available: 21, onHand: 26, reserved: 5 });
    expect(await level(items[4]!, third)).toMatchObject({ incoming: 9 });
    expect(errCode(await createShipment(db(), shopId, { transferId: tr.id, lineItems: [{ inventoryItemId: items[4]!, quantity: 6 }] }))).toBe('INVALID_QUANTITY');
    expect(errCode(await cancelTransfer(db(), shopId, tr.id))).toBe('SHIPMENT_EXISTS');
    ok(await receiveShipment(db(), shopId, s1.id, { bulkReceiveAction: 'ACCEPTED' }));
    expect((await getTransfer(db(), shopId, tr.id))!.status).toBe('IN_PROGRESS');
    // give up on the remaining 5 units
    const view = (await getTransfer(db(), shopId, tr.id))!;
    const removed = ok(await removeTransferItems(db(), shopId, tr.id, [view.lines[0]!.id]));
    expect(removed.updates[0]).toMatchObject({ newQuantity: 4, deltaQuantity: -5 });
    expect(removed.transfer.status).toBe('TRANSFERRED');
    expect(await level(items[4]!, main)).toMatchObject({ available: 26, onHand: 26, reserved: 0 });
    expect(await level(items[4]!, third)).toMatchObject({ available: 4, onHand: 4, incoming: 0 });
  });

  it('setItems adjusts reserved and incoming for ready-to-ship transfers', async () => {
    await stock(items[5]!, main, 10); await stock(items[5]!, second, 0);
    const tr = await newTransfer([{ inventoryItemId: items[5]!, quantity: 3 }]);
    await markTransferReadyToShip(db(), shopId, tr.id);
    const up = ok(await setTransferItems(db(), shopId, tr.id, [{ inventoryItemId: items[5]!, quantity: 7 }]));
    expect(up.updates[0]).toMatchObject({ newQuantity: 7, deltaQuantity: 4 });
    expect(await level(items[5]!, main)).toMatchObject({ available: 3, reserved: 7 });
    expect(await level(items[5]!, second)).toMatchObject({ incoming: 7 });
    expect(errCode(await setTransferItems(db(), shopId, tr.id, [{ inventoryItemId: items[5]!, quantity: 11 }]))).toBe('INVALID_QUANTITY');
    expect(errCode(await setTransferItems(db(), shopId, tr.id, [{ inventoryItemId: items[5]!, quantity: 0 }]))).toBe('INVALID_QUANTITY');
    ok(await setTransferItems(db(), shopId, tr.id, [{ inventoryItemId: items[5]!, quantity: 2 }]));
    expect(await level(items[5]!, main)).toMatchObject({ available: 8, reserved: 2 });
    expect(await level(items[5]!, second)).toMatchObject({ incoming: 2 });
    const only = (await getTransfer(db(), shopId, tr.id))!;
    expect(errCode(await removeTransferItems(db(), shopId, tr.id, [only.lines[0]!.id]))).toBe('CANT_REMOVE_ALL_ITEMS_FROM_READY_TO_SHIP_TRANSFER');
    expect(await level(items[5]!, main)).toMatchObject({ available: 8, reserved: 2 });
  });

  it('cancel releases the hold; delete only for drafts; duplicate copies lines; location is immutable after draft', async () => {
    await stock(items[0]!, main, 12); await stock(items[0]!, second, 0);
    const tr = await newTransfer([{ inventoryItemId: items[0]!, quantity: 5 }]);
    ok(await markTransferReadyToShip(db(), shopId, tr.id));
    expect(await level(items[0]!, main)).toMatchObject({ available: 7, reserved: 5 });
    expect(errCode(await editTransfer(db(), shopId, tr.id, { originId: third }))).toBe('TRANSFER_LOCATION_IMMUTABLE');
    expect(errCode(await deleteTransfer(db(), shopId, tr.id))).toBe('INVALID_TRANSFER_STATUS');
    const copy = ok(await duplicateTransfer(db(), shopId, tr.id));
    expect(copy.status).toBe('DRAFT');
    expect(copy.lines.map((l) => l.totalQuantity)).toEqual([5]);
    const canceled = ok(await cancelTransfer(db(), shopId, tr.id));
    expect(canceled.status).toBe('CANCELED');
    expect(await level(items[0]!, main)).toMatchObject({ available: 12, onHand: 12, reserved: 0 });
    expect(await level(items[0]!, second)).toMatchObject({ incoming: 0 });
    expect(errCode(await cancelTransfer(db(), shopId, tr.id))).toBe('INVALID_TRANSFER_STATUS');
    ok(await deleteTransfer(db(), shopId, copy.id));
    expect(await getTransfer(db(), shopId, copy.id)).toBeNull();
    const draft = await newTransfer([]);
    const moved = ok(await editTransfer(db(), shopId, draft.id, { originId: third, tags: ['b', 'a'], referenceName: 'Spring restock' }));
    expect(moved.originLocationId).toBe(third);
    expect(moved.tags).toEqual(['a', 'b']);
  });

  it('draft shipments can be edited and deleted; barcode and tracking are validated', async () => {
    await stock(items[1]!, main, 40); await stock(items[2]!, main, 40);
    const tr = await newTransfer([{ inventoryItemId: items[1]!, quantity: 8 }, { inventoryItemId: items[2]!, quantity: 8 }]);
    await markTransferReadyToShip(db(), shopId, tr.id);
    const sh = ok(await createShipment(db(), shopId, { transferId: tr.id, lineItems: [{ inventoryItemId: items[1]!, quantity: 3 }], barcode: 'DUP-1' }));
    expect(errCode(await createShipment(db(), shopId, { transferId: tr.id, lineItems: [{ inventoryItemId: items[2]!, quantity: 1 }], barcode: 'DUP-1' }))).toBe('BARCODE_DUPLICATE');
    expect(errCode(await createShipment(db(), shopId, { transferId: tr.id, lineItems: [{ inventoryItemId: items[2]!, quantity: 1 }], tracking: { trackingUrl: 'javascript:alert(1)' } }))).toBe('INVALID_URL');
    expect(errCode(await createShipment(db(), shopId, { transferId: tr.id, lineItems: [] }))).toBe('EMPTY_SHIPMENT_INPUT');
    const added = ok(await addShipmentItems(db(), shopId, sh.id, [{ inventoryItemId: items[2]!, quantity: 2 }]));
    expect(added.shipment.lines.length).toBe(2);
    const upd = ok(await updateShipmentItemQuantities(db(), shopId, sh.id, [{ shipmentLineItemId: added.added[0]!.id, quantity: 8 }]));
    expect(upd.updated[0]!.quantity).toBe(8);
    expect(errCode(await updateShipmentItemQuantities(db(), shopId, sh.id, [{ shipmentLineItemId: added.added[0]!.id, quantity: 9 }]))).toBe('INVALID_QUANTITY');
    ok(await removeShipmentItems(db(), shopId, sh.id, [added.added[0]!.id]));
    ok(await markShipmentInTransit(db(), shopId, sh.id, new Date('2026-11-01')));
    expect(errCode(await deleteShipment(db(), shopId, sh.id))).toBe('INVALID_SHIPMENT_STATUS');
    expect(errCode(await addShipmentItems(db(), shopId, sh.id, [{ inventoryItemId: items[2]!, quantity: 1 }]))).toBe('INVALID_SHIPMENT_STATUS');
  });

  it('refuses to deactivate a location with unfinished transfers', async () => {
    const loc = ok(await addLocation(db(), shopId, { name: 'Temp site', address: { countryCode: 'FR' } }));
    await stock(items[0]!, main, 30);
    const tr = await newTransfer([{ inventoryItemId: items[0]!, quantity: 2 }], main, loc.id);
    ok(await markTransferReadyToShip(db(), shopId, tr.id));
    const blocked = await setLocationActive(db(), shopId, loc.id, false, main);
    expect(blocked.ok).toBe(false);
    ok(await cancelTransfer(db(), shopId, tr.id));
    expect((await setLocationActive(db(), shopId, loc.id, false, main)).ok).toBe(true);
  });

  it('lists, searches and sorts transfers', async () => {
    const all = await listTransfers(db(), shopId, { offset: 0, limit: 100 });
    expect(all.length).toBeGreaterThan(5);
    const drafts = await listTransfers(db(), shopId, { query: 'status:draft', offset: 0, limit: 100 });
    expect(drafts.every((x) => x.status === 'DRAFT')).toBe(true);
    const ref = await listTransfers(db(), shopId, { query: 'Spring', offset: 0, limit: 10 });
    expect(ref.map((x) => x.referenceName)).toEqual(['Spring restock']);
    const byOrigin = await listTransfers(db(), shopId, { sortKey: 'ORIGIN_NAME', offset: 0, limit: 5 });
    expect(byOrigin.length).toBeGreaterThan(0);
  });
});

describe('inventory transfers: GraphQL', () => {
  it('runs the lifecycle through the Admin API with Shopify names', async () => {
    await stock(items[0]!, main, 50); await stock(items[0]!, second, 0);
    const created = await g(`mutation($i: InventoryTransferCreateInput!) { inventoryTransferCreate(input: $i) { inventoryTransfer { id name status totalQuantity origin { name } lineItems(first: 5) { nodes { id totalQuantity shippableQuantity inventoryItem { id } } } } userErrors { field message code } } }`, {
      i: { originLocationId: gid('Location', main), destinationLocationId: gid('Location', second), referenceName: 'API', lineItems: [{ inventoryItemId: gid('InventoryItem', items[0]!), quantity: 7 }] },
    });
    const tr = created.inventoryTransferCreate.inventoryTransfer;
    expect(created.inventoryTransferCreate.userErrors).toEqual([]);
    expect(tr.status).toBe('DRAFT');
    const ready = await g(`mutation($id: ID!) { inventoryTransferMarkAsReadyToShip(id: $id) { inventoryTransfer { status } userErrors { code } } }`, { id: tr.id });
    expect(ready.inventoryTransferMarkAsReadyToShip.inventoryTransfer.status).toBe('READY_TO_SHIP');
    const lv = await g(`query($id: ID!, $loc: ID!) { inventoryItem(id: $id) { inventoryLevel(locationId: $loc) { quantities(names: ["available", "reserved", "incoming", "on_hand"]) { name quantity } } } }`, { id: gid('InventoryItem', items[0]!), loc: gid('Location', main) });
    const q = Object.fromEntries(lv.inventoryItem.inventoryLevel.quantities.map((x: { name: string; quantity: number }) => [x.name, x.quantity]));
    expect(q).toMatchObject({ available: 43, reserved: 7, on_hand: 50 });
    const ship = await g(`mutation($i: InventoryShipmentCreateInput!) { inventoryShipmentCreateInTransit(input: $i) { inventoryShipment { id name status tracking { company trackingNumber } lineItems(first: 5) { nodes { id quantity unreceivedQuantity } } } userErrors { code field } } }`, {
      i: { movementId: tr.id, lineItems: [{ inventoryItemId: gid('InventoryItem', items[0]!), quantity: 7 }], trackingInput: { company: 'UPS', trackingNumber: '1Z' } },
    });
    const sh = ship.inventoryShipmentCreateInTransit.inventoryShipment;
    expect(sh.status).toBe('IN_TRANSIT');
    expect(sh.tracking).toEqual({ company: 'UPS', trackingNumber: '1Z' });
    const rec = await g(`mutation($id: ID!, $li: [InventoryShipmentReceiveItemInput!]) { inventoryShipmentReceive(id: $id, lineItems: $li) { inventoryShipment { status totalAcceptedQuantity totalRejectedQuantity } userErrors { code } } }`, {
      id: sh.id, li: [{ shipmentLineItemId: sh.lineItems.nodes[0].id, quantity: 5, reason: 'ACCEPTED' }, { shipmentLineItemId: sh.lineItems.nodes[0].id, quantity: 2, reason: 'REJECTED' }],
    });
    expect(rec.inventoryShipmentReceive.inventoryShipment).toEqual({ status: 'RECEIVED', totalAcceptedQuantity: 5, totalRejectedQuantity: 2 });
    const done = await g(`query($id: ID!) { inventoryTransfer(id: $id) { status receivedQuantity shipments(first: 5) { nodes { name } } } inventoryTransfers(first: 5, query: "status:transferred reference_name:API") { nodes { id } } }`, { id: tr.id });
    expect(done.inventoryTransfer.status).toBe('TRANSFERRED');
    expect(done.inventoryTransfer.receivedQuantity).toBe(7);
    expect(done.inventoryTransfers.nodes.map((n: { id: string }) => n.id)).toEqual([tr.id]);
    const missing = await g(`mutation { inventoryTransferCancel(id: "gid://shopify/InventoryTransfer/99999") { userErrors { code field message } } }`);
    expect(missing.inventoryTransferCancel.userErrors[0].code).toBe('TRANSFER_NOT_FOUND');
  });
});

describe('purchase orders', () => {
  it('computes totals with taxes included and excluded', () => {
    const lines = [{ quantity: 10, unitCost: 1000, taxPercent: 20 }, { quantity: 2, unitCost: 500, taxPercent: null }];
    const inc = computeTotals(lines, true, 300, 100);
    expect(inc).toMatchObject({ variants: 2, items: 12, subtotal: 11000, taxes: 1667, total: 11400 });
    const exc = computeTotals(lines, false, 0, 0);
    expect(exc).toMatchObject({ subtotal: 11000, taxes: 2000, total: 13000 });
  });

  async function draftPo(extra: Partial<Parameters<typeof createPurchaseOrder>[2]> = {}) {
    const sup = ok(await createSupplier(db(), shopId, { name: `Acme ${Math.random().toString(36).slice(2, 7)}`, currency: 'EUR' }));
    return ok(await createPurchaseOrder(db(), shopId, {
      supplierId: sup.id, destinationLocationId: second, referenceNumber: 'PO-REF', tags: ['spring'],
      lineItems: [{ inventoryItemId: items[0]!, quantity: 10, unitCost: 1000, supplierSku: 'S-1' }, { inventoryItemId: items[1]!, quantity: 5, unitCost: 2000 }], ...extra,
    }));
  }

  it('drafts do not touch stock; marking as ordered adds incoming; closing releases it', async () => {
    await stock(items[0]!, second, 4); await stock(items[1]!, second, 0);
    const po = await draftPo();
    expect(po.name).toMatch(/^#PO\d+$/);
    expect(po.state).toBe('DRAFT');
    expect(po.totals.total).toBe(20000);
    expect(await level(items[0]!, second)).toMatchObject({ incoming: 0 });
    const ordered = ok(await markPurchaseOrderAsOrdered(db(), shopId, po.id));
    expect(ordered.state).toBe('ORDERED');
    expect(ordered.supplierName).toBeTruthy();
    expect(ordered.orderedAt).toBeTruthy();
    expect(await level(items[0]!, second)).toMatchObject({ incoming: 10, available: 4 });
    expect(await level(items[1]!, second)).toMatchObject({ incoming: 5 });
    expect(errCode(await markPurchaseOrderAsOrdered(db(), shopId, po.id))).toBe('INVALID_STATUS');
    // editing an ordered order moves incoming
    const edited = ok(await updatePurchaseOrder(db(), shopId, po.id, { lineItems: [{ inventoryItemId: items[0]!, quantity: 12, unitCost: 1000 }, { inventoryItemId: items[1]!, quantity: 5 }] }));
    expect(edited.totalQuantity).toBe(17);
    expect(await level(items[0]!, second)).toMatchObject({ incoming: 12 });
    const closed = ok(await closePurchaseOrder(db(), shopId, po.id));
    expect(closed.state).toBe('CLOSED');
    expect(await level(items[0]!, second)).toMatchObject({ incoming: 0 });
    expect(await level(items[1]!, second)).toMatchObject({ incoming: 0 });
    expect(errCode(await updatePurchaseOrder(db(), shopId, po.id, { referenceNumber: 'x' }))).toBe('INVALID_STATUS');
  });

  it('rejects an incomplete order and invalid input', async () => {
    const po = ok(await createPurchaseOrder(db(), shopId, {}));
    expect(errCode(await markPurchaseOrderAsOrdered(db(), shopId, po.id))).toBe('SUPPLIER_NOT_FOUND');
    expect(errCode(await createPurchaseOrder(db(), shopId, { referenceNumber: 'x'.repeat(256) }))).toBe('REFERENCE_TOO_LONG');
    expect(errCode(await createPurchaseOrder(db(), shopId, { supplierNote: 'x'.repeat(5001) }))).toBe('NOTE_TOO_LONG');
    expect(errCode(await createPurchaseOrder(db(), shopId, { lineItems: [{ inventoryItemId: items[0]!, quantity: 1, unitCost: -5 }] }))).toBe('INVALID_COST');
    expect(errCode(await createPurchaseOrder(db(), shopId, { supplierId: 99999 }))).toBe('SUPPLIER_NOT_FOUND');
    expect(errCode(await createPurchaseOrder(db(), shopId, { tags: ['y'.repeat(41)] }))).toBe('TAG_EXCEEDS_MAX_LENGTH');
  });

  it('receives in two steps with a rejected unit, updates costs and incoming', async () => {
    await stock(items[2]!, main, 0); await stock(items[2]!, second, 10); await stock(items[3]!, main, 0); await stock(items[3]!, second, 0);
    await db().update(s.inventoryItems).set({ unitCost: 500 }).where(eq(s.inventoryItems.id, items[2]!));
    await db().update(s.inventoryItems).set({ unitCost: null }).where(eq(s.inventoryItems.id, items[3]!));
    const sup = ok(await createSupplier(db(), shopId, { name: 'Receiving Co', currency: 'EUR' }));
    const po0 = ok(await createPurchaseOrder(db(), shopId, { supplierId: sup.id, destinationLocationId: second, lineItems: [{ inventoryItemId: items[2]!, quantity: 10, unitCost: 800 }, { inventoryItemId: items[3]!, quantity: 4, unitCost: 300 }] }));
    ok(await markPurchaseOrderAsOrdered(db(), shopId, po0.id));
    const [l1, l2] = po0.lines;
    const r1 = ok(await receivePurchaseOrder(db(), shopId, po0.id, { lineItems: [{ purchaseOrderLineItemId: l1!.id, acceptedQuantity: 5, rejectedQuantity: 1 }] }));
    expect(r1.purchaseOrder.state).toBe('PARTIALLY_RECEIVED');
    expect(r1.purchaseOrder.lines[0]).toMatchObject({ receivedQuantity: 5, rejectedQuantity: 1, outstandingQuantity: 4 });
    // 10 on hand at 500 + 5 at 800 => 600
    const [it2] = await db().select().from(s.inventoryItems).where(eq(s.inventoryItems.id, items[2]!));
    expect(it2!.unitCost).toBe(600);
    expect(await level(items[2]!, second)).toMatchObject({ available: 15, onHand: 15, incoming: 4 });
    const transfer = (await getTransfer(db(), shopId, r1.transferId))!;
    expect(transfer.status).toBe('TRANSFERRED');
    expect(transfer.purchaseOrderId).toBe(po0.id);
    expect(transfer.origin?.name).toBe('Receiving Co');
    // too many
    expect(errCode(await receivePurchaseOrder(db(), shopId, po0.id, { lineItems: [{ purchaseOrderLineItemId: l1!.id, acceptedQuantity: 5 }] }))).toBe('INVALID_QUANTITY');
    const r2 = ok(await receivePurchaseOrder(db(), shopId, po0.id, { lineItems: [{ purchaseOrderLineItemId: l1!.id, acceptedQuantity: 4 }, { purchaseOrderLineItemId: l2!.id, acceptedQuantity: 4 }] }));
    expect(r2.purchaseOrder.state).toBe('RECEIVED');
    expect(await level(items[2]!, second)).toMatchObject({ available: 19, onHand: 19, incoming: 0 });
    expect(await level(items[3]!, second)).toMatchObject({ available: 4, onHand: 4, incoming: 0 });
    const [it3] = await db().select().from(s.inventoryItems).where(eq(s.inventoryItems.id, items[3]!));
    expect(it3!.unitCost).toBe(300); // no previous cost: the line cost
    expect((await listTransfers(db(), shopId, { query: `reference_name:${po0.name}`, offset: 0, limit: 10 })).length).toBe(2);
    expect(errCode(await receivePurchaseOrder(db(), shopId, po0.id, { lineItems: [{ purchaseOrderLineItemId: l1!.id, acceptedQuantity: 1 }] }))).toBe('INVALID_QUANTITY');
  });

  it('over-receiving needs confirmation and extends the order; the cost method and switch are honoured', async () => {
    await stock(items[4]!, second, 0); await stock(items[5]!, second, 0);
    await db().update(s.inventoryItems).set({ unitCost: 100 }).where(eq(s.inventoryItems.id, items[4]!));
    const po0 = await draftPo({ lineItems: [{ inventoryItemId: items[4]!, quantity: 2, unitCost: 400 }, { inventoryItemId: items[5]!, quantity: 2, unitCost: 400 }] });
    ok(await markPurchaseOrderAsOrdered(db(), shopId, po0.id));
    const [a, b] = po0.lines;
    expect(errCode(await receivePurchaseOrder(db(), shopId, po0.id, { lineItems: [{ purchaseOrderLineItemId: a!.id, acceptedQuantity: 3 }] }))).toBe('INVALID_QUANTITY');
    const r = ok(await receivePurchaseOrder(db(), shopId, po0.id, { lineItems: [{ purchaseOrderLineItemId: a!.id, acceptedQuantity: 3 }, { purchaseOrderLineItemId: b!.id, acceptedQuantity: 2 }], allowOverReceive: true, costMethod: 'last' }));
    expect(r.purchaseOrder.lines[0]).toMatchObject({ quantity: 3, receivedQuantity: 3 });
    expect(r.purchaseOrder.state).toBe('RECEIVED');
    expect(await level(items[4]!, second)).toMatchObject({ available: 3, incoming: 0 });
    const [c] = await db().select().from(s.inventoryItems).where(eq(s.inventoryItems.id, items[4]!));
    expect(c!.unitCost).toBe(400);
    // updateUnitCost: false leaves the cost alone
    const po1 = await draftPo({ lineItems: [{ inventoryItemId: items[5]!, quantity: 1, unitCost: 999 }] });
    ok(await markPurchaseOrderAsOrdered(db(), shopId, po1.id));
    ok(await receivePurchaseOrder(db(), shopId, po1.id, { lineItems: [{ purchaseOrderLineItemId: po1.lines[0]!.id, acceptedQuantity: 1 }], updateUnitCost: false }));
    const [d] = await db().select().from(s.inventoryItems).where(eq(s.inventoryItems.id, items[5]!));
    expect(d!.unitCost).not.toBe(999);
  });

  it('locks the destination after a receipt and exposes the read API with compat names', async () => {
    await stock(items[0]!, second, 0);
    const po = await draftPo({ lineItems: [{ inventoryItemId: items[0]!, quantity: 6, unitCost: 250 }] });
    ok(await markPurchaseOrderAsOrdered(db(), shopId, po.id));
    ok(await receivePurchaseOrder(db(), shopId, po.id, { lineItems: [{ purchaseOrderLineItemId: po.lines[0]!.id, acceptedQuantity: 2 }] }));
    expect(errCode(await updatePurchaseOrder(db(), shopId, po.id, { destinationLocationId: third }))).toBe('INVALID_STATUS');
    const q = await g(`query($id: ID!) { inventoryPurchaseOrder(id: $id) { id name status currency orderedAt origin { supplierName } destination { name } shopmeState shopmeTotals { total { amount currencyCode } itemsCount } lineItems(first: 5) { nodes { totalQuantity unitCost { amount } supplierSku shopmeReceivedQuantity } } transfers(first: 5) { nodes { name status } } }
      inventoryPurchaseOrders(first: 5, query: "state:partially_received") { nodes { id } } }`, { id: gid('InventoryPurchaseOrder', po.id) });
    expect(q.inventoryPurchaseOrder).toMatchObject({ status: 'ORDERED', shopmeState: 'PARTIALLY_RECEIVED', currency: 'EUR', destination: { name: 'Warehouse' }, shopmeTotals: { itemsCount: 6, total: { amount: '15.0' } } });
    expect(q.inventoryPurchaseOrder.lineItems.nodes[0]).toMatchObject({ totalQuantity: 6, shopmeReceivedQuantity: 2 });
    expect(q.inventoryPurchaseOrder.transfers.nodes).toHaveLength(1);
    expect(q.inventoryPurchaseOrders.nodes.map((n: { id: string }) => n.id)).toContain(gid('InventoryPurchaseOrder', po.id));
  });

  it('creates and receives purchase orders through the ShopMe mutations', async () => {
    const sup = await g(`mutation { shopmeSupplierCreate(input: { name: "GraphQL Supply", currencyCode: "EUR", email: "a@b.co" }) { supplier { id name } userErrors { code field } } }`);
    const supplierId = sup.shopmeSupplierCreate.supplier.id;
    const dup = await g(`mutation { shopmeSupplierCreate(input: { name: "graphql supply" }) { supplier { id } userErrors { code field } } }`);
    expect(dup.shopmeSupplierCreate.userErrors[0].code).toBe('TAKEN');
    const created = await g(`mutation($i: ShopmePurchaseOrderInput!) { shopmePurchaseOrderCreate(input: $i) { shopmePurchaseOrder { id name shopmeState shopmeTotals { total { amount } } lineItems(first: 5) { nodes { id } } } userErrors { code field } } }`, {
      i: { supplierId, destinationLocationId: gid('Location', second), shippingCost: '5.50', lineItems: [{ inventoryItemId: gid('InventoryItem', items[1]!), quantity: 3, unitCost: '12.00' }] },
    });
    const po = created.shopmePurchaseOrderCreate.shopmePurchaseOrder;
    expect(created.shopmePurchaseOrderCreate.userErrors).toEqual([]);
    expect(po.shopmeTotals.total.amount).toBe('41.5');
    const ord = await g(`mutation($id: ID!) { shopmePurchaseOrderMarkAsOrdered(id: $id) { shopmePurchaseOrder { status } userErrors { code } } }`, { id: po.id });
    expect(ord.shopmePurchaseOrderMarkAsOrdered.shopmePurchaseOrder.status).toBe('ORDERED');
    const rec = await g(`mutation($id: ID!, $i: ShopmePurchaseOrderReceiveInput!) { shopmePurchaseOrderReceive(id: $id, input: $i) { shopmePurchaseOrder { shopmeState shopmeReceivedQuantity } inventoryTransferId userErrors { code } } }`, {
      id: po.id, i: { lineItems: [{ purchaseOrderLineItemId: po.lineItems.nodes[0].id, acceptedQuantity: 3 }] },
    });
    expect(rec.shopmePurchaseOrderReceive.shopmePurchaseOrder).toEqual({ shopmeState: 'RECEIVED', shopmeReceivedQuantity: 3 });
    expect(rec.shopmePurchaseOrderReceive.inventoryTransferId).toMatch(/InventoryTransfer/);
    const del = await g(`mutation($id: ID!) { shopmePurchaseOrderDelete(id: $id) { deletedId userErrors { code } } }`, { id: po.id });
    expect(del.shopmePurchaseOrderDelete.userErrors[0].code).toBe('INVALID_STATUS');
    const read = await getPurchaseOrder(db(), shopId, Number(po.id.split('/').pop()));
    expect(read!.state).toBe('RECEIVED');
  });
});

describe('shipments queries', () => {
  it('reads a shipment by id with its transfer', async () => {
    const all = await db().select().from(s.inventoryShipments);
    const sh = await getShipment(db(), shopId, all[0]!.id);
    expect(sh?.transfer.id).toBe(all[0]!.transferId);
    const q = await g(`{ inventoryShipments(first: 3, query: "status:received") { nodes { id status lineItemTotalQuantity } } }`);
    expect(q.inventoryShipments.nodes.length).toBeGreaterThan(0);
  });
});
