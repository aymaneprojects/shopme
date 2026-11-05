import {
  addShipmentItems, cancelTransfer, editTransfer, countTransfers, createShipment, createTransfer, deleteShipment, deleteTransfer, duplicateTransfer, getInventoryItem, getLocation, getShipment, getTransfer, listShipments,
  listTransfers, markShipmentInTransit, markTransferReadyToShip, receiveShipment, removeShipmentItems, removeTransferItems, setShipmentBarcode, setShipmentTracking, setTransferItems,
  updateShipmentItemQuantities, type LocationSnapshotData, type ShipmentLine, type ShipmentView, type TransferLine, type TransferView, type TransferStatus, type LineUpdate,
} from '@shopme/core';
import { parseId, toGid, type UserError } from '@shopme/shopify-compat';
import { builder } from '../builder';
import { requireScope } from '../context';
import { ConnectionArgs, defineConnection, paginate, paginateArray } from '../types/connection';
import { DisplayableError } from '../types/errors';
import { Count } from '../types/money';
import { Node, registerNode } from '../types/node';
import { InventoryItem_, Location_ } from '../types/catalog';
import { LocationAddress } from './locations';

/** Inventory transfers and shipments (Shopify-compatible names). Purchase orders live in `purchase-orders.ts`. */

const ERROR_CODES = [
  'LOCATION_NOT_FOUND', 'LOCATION_NOT_ACTIVE', 'LOCATION_REQUIRED', 'TRANSFER_ORIGIN_CANNOT_BE_THE_SAME_AS_DESTINATION', 'ITEMS_EMPTY', 'ITEM_NOT_FOUND', 'UNTRACKED_ITEM', 'BUNDLED_ITEM',
  'INVALID_QUANTITY', 'DUPLICATE_ITEM', 'INVENTORY_STATE_NOT_ACTIVE', 'TAG_EXCEEDS_MAX_LENGTH', 'INVALID_TAG', 'INVALID_METAFIELDS', 'INVALID_TRANSFER_STATUS', 'TRANSFER_NOT_FOUND',
  'TRANSFER_LOCATION_IMMUTABLE', 'ALL_QUANTITY_SHIPPED', 'CANT_REMOVE_ALL_ITEMS_FROM_READY_TO_SHIP_TRANSFER', 'ITEM_PRESENT_ON_DRAFT_SHIPMENT_WITH_ZERO_QUANTITY', 'INVALID_ITEM', 'SHIPMENT_EXISTS',
  'INVALID_STATE', 'BARCODE_DUPLICATE', 'BARCODE_TOO_LONG', 'EMPTY_SHIPMENT_INPUT', 'INVALID_SHIPMENT_INPUT', 'INVALID_URL', 'SHIPMENT_NOT_FOUND', 'INVALID_SHIPMENT_STATUS', 'ACTIVATION_FAILED',
  'INTERNAL_ERROR', 'INVALID', 'PURCHASE_ORDER_NOT_FOUND',
] as const;

/** `<Name>UserError implements DisplayableError { code field message }` with its `<Name>UserErrorCode` enum. */
export function errorType(name: string, codes: readonly [string, ...string[]] = ERROR_CODES) {
  const Code = builder.enumType(`${name}Code`, { values: codes });
  const ref = builder.objectRef<UserError>(name);
  ref.implement({
    interfaces: [DisplayableError],
    fields: (t) => ({ code: t.field({ type: Code, nullable: true, resolve: (e) => (codes.includes(e.code ?? '') ? e.code : null) as never }) }),
  });
  return ref;
}

export type FieldBuilder<S extends object> = PothosSchemaTypes.ObjectFieldBuilder<PothosSchemaTypes.ExtendDefaultTypes<import('../builder').SchemaTypes>, S>;
export function payload<S extends object>(name: string, fields: (t: FieldBuilder<S & { userErrors: UserError[] }>) => Record<string, any>, codes: readonly [string, ...string[]] = ERROR_CODES) {
  const Err = errorType(`${name.replace(/Payload$/, '')}UserError`, codes);
  const ref = builder.objectRef<S & { userErrors: UserError[] }>(name);
  ref.implement({ fields: (t) => ({ ...fields(t as never), userErrors: t.field({ type: [Err], resolve: (p) => p.userErrors }) }) });
  return ref;
}

/* ------------------------------ enums ------------------------------ */

const TransferStatusEnum = builder.enumType('InventoryTransferStatus', { values: ['DRAFT', 'READY_TO_SHIP', 'IN_PROGRESS', 'TRANSFERRED', 'CANCELED', 'OTHER'] as const });
const ShipmentStatusEnum = builder.enumType('InventoryShipmentStatus', { values: ['DRAFT', 'IN_TRANSIT', 'PARTIALLY_RECEIVED', 'RECEIVED', 'OTHER'] as const });
const ReceiveReasonEnum = builder.enumType('InventoryShipmentReceiveLineItemReason', { values: ['ACCEPTED', 'REJECTED', 'CANCELED'] as const });
const TransferSortKeys = builder.enumType('TransferSortKeys', { values: ['CREATED_AT', 'DESTINATION_NAME', 'EXPECTED_SHIPMENT_ARRIVAL', 'ID', 'NAME', 'ORIGIN_NAME', 'SOURCE_NAME', 'STATUS'] as const });
const ShipmentSortKeys = builder.enumType('InventoryShipmentSortKeys', { values: ['CREATED_AT', 'ID', 'STATUS'] as const });

/* ------------------------------ output types ------------------------------ */

export const LocationSnapshot = builder.objectRef<LocationSnapshotData>('LocationSnapshot').implement({
  fields: (t) => ({
    name: t.exposeString('name'),
    snapshottedAt: t.field({ type: 'DateTime', resolve: (s) => new Date(s.snapshottedAt) }),
    address: t.field({ type: LocationAddress, resolve: (s) => s as never }),
    location: t.field({ type: Location_, nullable: true, resolve: (s, _a, ctx) => (s.locationId ? getLocation(ctx.db, ctx.shopId, s.locationId) : null) }),
  }),
});

const TrackingShape = builder.objectRef<ShipmentView>('InventoryShipmentTracking').implement({
  fields: (t) => ({
    company: t.string({ nullable: true, resolve: (s) => s.trackingCompany }),
    trackingNumber: t.string({ nullable: true, resolve: (s) => s.trackingNumber }),
    trackingUrl: t.field({ type: 'URL', nullable: true, resolve: (s) => s.trackingUrl }),
    arrivesAt: t.field({ type: 'DateTime', nullable: true, resolve: (s) => s.arrivesAt }),
  }),
});

const ShipmentLineItem = builder.objectRef<ShipmentLine>('InventoryShipmentLineItem');
ShipmentLineItem.implement({
  interfaces: [Node],
  fields: (t) => ({
    inventoryItem: t.field({ type: InventoryItem_, nullable: true, resolve: (l, _a, ctx) => getInventoryItem(ctx.db, ctx.shopId, l.inventoryItemId) }),
    quantity: t.exposeInt('quantity'), acceptedQuantity: t.exposeInt('acceptedQuantity'), rejectedQuantity: t.exposeInt('rejectedQuantity'),
    canceledQuantity: t.exposeInt('canceledQuantity'), unreceivedQuantity: t.exposeInt('unreceivedQuantity'),
    createdAt: t.field({ type: 'DateTime', resolve: (l) => l.createdAt }),
  }),
});
const ShipmentLineItemConnection = defineConnection('InventoryShipmentLineItem', ShipmentLineItem);

type ShipmentShape = ShipmentView;
const Shipment = builder.objectRef<ShipmentShape>('InventoryShipment');
Shipment.implement({
  interfaces: [Node],
  fields: (t) => ({
    name: t.exposeString('name'),
    status: t.field({ type: ShipmentStatusEnum, resolve: (s) => s.status as never }),
    barcode: t.exposeString('barcode', { nullable: true }),
    dateCreated: t.field({ type: 'DateTime', nullable: true, resolve: (s) => s.dateCreated }),
    dateShipped: t.field({ type: 'DateTime', nullable: true, resolve: (s) => s.dateShipped }),
    dateReceived: t.field({ type: 'DateTime', nullable: true, resolve: (s) => s.dateReceived }),
    tracking: t.field({ type: TrackingShape, nullable: true, resolve: (s) => (s.trackingCompany || s.trackingNumber || s.trackingUrl || s.arrivesAt ? s : null) }),
    lineItemTotalQuantity: t.exposeInt('totalQuantity'),
    totalAcceptedQuantity: t.exposeInt('totalAcceptedQuantity'), totalRejectedQuantity: t.exposeInt('totalRejectedQuantity'),
    totalCanceledQuantity: t.exposeInt('totalCanceledQuantity'), totalReceivedQuantity: t.exposeInt('totalReceivedQuantity'),
    lineItems: t.field({
      type: ShipmentLineItemConnection, nullable: true, args: { ...ConnectionArgs, sortKey: t.arg({ type: builder.enumType('ShipmentLineItemSortKeys', { values: ['ID'] as const }), defaultValue: 'ID' }), query: t.arg.string() },
      resolve: (s, a) => paginateArray(a, a.reverse ? [...s.lines].reverse() : s.lines),
    }),
    lineItemsCount: t.field({ type: Count, nullable: true, args: { query: t.arg.string(), limit: t.arg.int({ defaultValue: 10000 }) }, resolve: (s) => ({ count: s.lines.length, precision: 'EXACT' as const }) }),
    /** ShopMe extension: the transfer this shipment belongs to. */
    shopmeTransfer: t.field({ type: Transfer_, nullable: true, resolve: (s, _a, ctx) => getTransfer(ctx.db, ctx.shopId, s.transferId) }),
  }),
});
const ShipmentConnection = defineConnection('InventoryShipment', Shipment);

const TransferLineItem = builder.objectRef<TransferLine>('InventoryTransferLineItem');
TransferLineItem.implement({
  interfaces: [Node],
  fields: (t) => ({
    title: t.exposeString('title', { nullable: true }),
    inventoryItem: t.field({ type: InventoryItem_, nullable: true, resolve: (l, _a, ctx) => getInventoryItem(ctx.db, ctx.shopId, l.inventoryItemId) }),
    totalQuantity: t.exposeInt('totalQuantity'), shippableQuantity: t.exposeInt('shippableQuantity'), shippedQuantity: t.exposeInt('shippedQuantity'),
    pickedForShipmentQuantity: t.exposeInt('pickedForShipmentQuantity'), processableQuantity: t.exposeInt('processableQuantity'),
  }),
});
const TransferLineItemConnection = defineConnection('InventoryTransferLineItem', TransferLineItem);
const TransferLineItemUpdate = builder.objectRef<LineUpdate>('InventoryTransferLineItemUpdate').implement({
  fields: (t) => ({
    inventoryItemId: t.id({ nullable: true, resolve: (u) => toGid('InventoryItem', u.inventoryItemId) }),
    newQuantity: t.exposeInt('newQuantity', { nullable: true }), deltaQuantity: t.exposeInt('deltaQuantity', { nullable: true }),
  }),
});

const Transfer_ = builder.objectRef<TransferView>('InventoryTransfer');
Transfer_.implement({
  interfaces: [Node],
  fields: (t) => ({
    name: t.exposeString('name'),
    status: t.field({ type: TransferStatusEnum, resolve: (x) => x.status as never }),
    dateCreated: t.field({ type: 'DateTime', nullable: true, resolve: (x) => x.dateCreated }),
    origin: t.field({ type: LocationSnapshot, nullable: true, resolve: (x) => x.origin }),
    destination: t.field({ type: LocationSnapshot, nullable: true, resolve: (x) => x.destination }),
    referenceName: t.exposeString('referenceName', { nullable: true }),
    note: t.exposeString('note', { nullable: true }),
    tags: t.stringList({ resolve: (x) => x.tags }),
    totalQuantity: t.exposeInt('totalQuantity'),
    receivedQuantity: t.exposeInt('receivedQuantity'),
    hasTimelineComment: t.boolean({ resolve: () => false }),
    lineItems: t.field({
      type: TransferLineItemConnection, args: { ...ConnectionArgs, query: t.arg.string() },
      resolve: (x, a) => paginateArray(a, a.reverse ? [...x.lines].reverse() : x.lines),
    }),
    lineItemsCount: t.field({ type: Count, nullable: true, args: { query: t.arg.string(), limit: t.arg.int({ defaultValue: 10000 }) }, resolve: (x) => ({ count: x.lines.length, precision: 'EXACT' as const }) }),
    shipments: t.field({
      type: ShipmentConnection, args: ConnectionArgs,
      resolve: (x, a) => paginateArray(a, a.reverse ? [...x.shipments].reverse() : x.shipments),
    }),
    /** ShopMe extension: the purchase order this transfer receives, when any. */
    shopmePurchaseOrderId: t.id({ nullable: true, resolve: (x) => (x.purchaseOrderId ? toGid('InventoryPurchaseOrder', x.purchaseOrderId) : null) }),
    /** ShopMe extension: the purchase order linked to this transfer for reference, when any. */
    shopmeLinkedPurchaseOrderId: t.id({ nullable: true, resolve: (x) => (x.linkedPurchaseOrderId ? toGid('InventoryPurchaseOrder', x.linkedPurchaseOrderId) : null) }),
  }),
});
const TransferConnection = defineConnection('InventoryTransfer', Transfer_);

export { Transfer_ as InventoryTransferRef, TransferConnection as InventoryTransferConnection };

registerNode('InventoryTransfer', (ctx, id) => getTransfer(ctx.db, ctx.shopId, id));
registerNode('InventoryShipment', (ctx, id) => getShipment(ctx.db, ctx.shopId, id));

/* ------------------------------ queries ------------------------------ */

builder.queryFields((t) => ({
  inventoryTransfer: t.field({
    type: Transfer_, nullable: true, args: { id: t.arg.id({ required: true }) },
    resolve: (_r, a, ctx) => { requireScope(ctx, 'read_inventory'); const id = parseId(String(a.id), 'InventoryTransfer'); return id ? getTransfer(ctx.db, ctx.shopId, id) : null; },
  }),
  inventoryTransfers: t.field({
    type: TransferConnection, args: { ...ConnectionArgs, sortKey: t.arg({ type: TransferSortKeys, defaultValue: 'ID' }), query: t.arg.string(), savedSearchId: t.arg.id() },
    resolve: (_r, a, ctx) => {
      requireScope(ctx, 'read_inventory');
      return paginate(a, {
        fetch: ({ offset, limit }) => listTransfers(ctx.db, ctx.shopId, { query: a.query, sortKey: a.sortKey ?? 'ID', reverse: !!a.reverse, offset, limit }),
        total: () => countTransfers(ctx.db, ctx.shopId, { query: a.query }),
      });
    },
  }),
  /** ShopMe extension: number of transfers matching a search (list tabs). */
  shopmeInventoryTransfersCount: t.field({
    type: Count, args: { query: t.arg.string() },
    resolve: async (_r, a, ctx) => { requireScope(ctx, 'read_inventory'); return { count: await countTransfers(ctx.db, ctx.shopId, { query: a.query }), precision: 'EXACT' as const }; },
  }),
  inventoryShipment: t.field({
    type: Shipment, nullable: true, args: { id: t.arg.id({ required: true }) },
    resolve: (_r, a, ctx) => { requireScope(ctx, 'read_inventory'); const id = parseId(String(a.id), 'InventoryShipment'); return id ? getShipment(ctx.db, ctx.shopId, id) : null; },
  }),
  inventoryShipments: t.field({
    type: ShipmentConnection, args: { ...ConnectionArgs, sortKey: t.arg({ type: ShipmentSortKeys, defaultValue: 'ID' }), query: t.arg.string() },
    resolve: (_r, a, ctx) => {
      requireScope(ctx, 'read_inventory');
      return paginate(a, { fetch: ({ offset, limit }) => listShipments(ctx.db, ctx.shopId, { query: a.query, sortKey: a.sortKey ?? 'ID', reverse: !!a.reverse, offset, limit }) });
    },
  }),
}));

/* ------------------------------ mutation inputs ------------------------------ */

const LineInput = builder.inputType('InventoryTransferLineItemInput', { fields: (t) => ({ inventoryItemId: t.id({ required: true }), quantity: t.int({ required: true }) }) });
const TransferCreateInput = builder.inputType('InventoryTransferCreateInput', {
  fields: (t) => ({
    originLocationId: t.id(), destinationLocationId: t.id(), lineItems: t.field({ type: [LineInput], required: true, defaultValue: [] }), dateCreated: t.field({ type: 'DateTime' }),
    note: t.string(), tags: t.stringList(), referenceName: t.string(),
    shopmeLinkedPurchaseOrderId: t.id({ description: 'ShopMe extension: a purchase order to link to the transfer for reference.' }),
  }),
});
const TransferCreateReadyInput = builder.inputType('InventoryTransferCreateAsReadyToShipInput', {
  fields: (t) => ({
    originLocationId: t.id(), destinationLocationId: t.id(), lineItems: t.field({ type: [LineInput], required: true, defaultValue: [] }), dateCreated: t.field({ type: 'DateTime' }),
    note: t.string(), tags: t.stringList(), referenceName: t.string(),
    shopmeLinkedPurchaseOrderId: t.id({ description: 'ShopMe extension: a purchase order to link to the transfer for reference.' }),
  }),
});
const TransferEditInput = builder.inputType('InventoryTransferEditInput', {
  fields: (t) => ({ originId: t.id(), destinationId: t.id(), dateCreated: t.field({ type: 'Date' }), note: t.string(), tags: t.stringList(), referenceName: t.string(), shopmeLinkedPurchaseOrderId: t.id({ description: 'ShopMe extension: the purchase order linked for reference; null unlinks it.' }) }),
});
const SetItemsInput = builder.inputType('InventoryTransferSetItemsInput', { fields: (t) => ({ id: t.id({ required: true }), lineItems: t.field({ type: [LineInput], required: true }) }) });
const RemoveItemsInput = builder.inputType('InventoryTransferRemoveItemsInput', { fields: (t) => ({ id: t.id({ required: true }), transferLineItemIds: t.idList() }) });
const TrackingInput = builder.inputType('InventoryShipmentTrackingInput', {
  fields: (t) => ({ trackingNumber: t.string(), company: t.string(), trackingUrl: t.field({ type: 'URL' }), arrivesAt: t.field({ type: 'DateTime' }) }),
});
const ShipmentLineInput = builder.inputType('InventoryShipmentLineItemInput', { fields: (t) => ({ inventoryItemId: t.id({ required: true }), quantity: t.int({ required: true }) }) });
const ShipmentCreateInput = builder.inputType('InventoryShipmentCreateInput', {
  fields: (t) => ({
    movementId: t.id({ required: true }), trackingInput: t.field({ type: TrackingInput }), lineItems: t.field({ type: [ShipmentLineInput], required: true }),
    dateCreated: t.field({ type: 'DateTime' }), barcode: t.string(),
  }),
});
const ReceiveItemInput = builder.inputType('InventoryShipmentReceiveItemInput', {
  fields: (t) => ({ shipmentLineItemId: t.id({ required: true }), quantity: t.int({ required: true }), reason: t.field({ type: ReceiveReasonEnum, required: true }) }),
});
const UpdateQtyInput = builder.inputType('InventoryShipmentUpdateItemQuantitiesInput', { fields: (t) => ({ shipmentLineItemId: t.id({ required: true }), quantity: t.int({ required: true }) }) });

/* ------------------------------ payloads ------------------------------ */

interface TransferPayloadShape { inventoryTransfer: TransferView | null }
const transferField = (t: FieldBuilder<TransferPayloadShape & { userErrors: UserError[] }>) => ({ inventoryTransfer: t.field({ type: Transfer_, nullable: true, resolve: (p) => p.inventoryTransfer }) });
const CreatePayload = payload<TransferPayloadShape>('InventoryTransferCreatePayload', transferField);
const CreateReadyPayload = payload<TransferPayloadShape>('InventoryTransferCreateAsReadyToShipPayload', transferField);
const EditPayload = payload<TransferPayloadShape>('InventoryTransferEditPayload', transferField);
const ReadyPayload = payload<TransferPayloadShape>('InventoryTransferMarkAsReadyToShipPayload', transferField);
const CancelPayload = payload<TransferPayloadShape>('InventoryTransferCancelPayload', transferField);
const DuplicatePayload = payload<TransferPayloadShape>('InventoryTransferDuplicatePayload', transferField);
const DeletePayload = payload<{ deletedId: number | null }>('InventoryTransferDeletePayload', (t) => ({ deletedId: t.id({ nullable: true, resolve: (p) => (p.deletedId ? toGid('InventoryTransfer', p.deletedId) : null) }) }));
const itemsPayloadFields = (key: string) => (t: FieldBuilder<TransferPayloadShape & { updates: LineUpdate[] | null; userErrors: UserError[] }>) => ({
  inventoryTransfer: t.field({ type: Transfer_, nullable: true, resolve: (p) => p.inventoryTransfer }),
  [key]: t.field({ type: [TransferLineItemUpdate], nullable: true, resolve: (p) => p.updates }),
});
const SetItemsPayload = payload<TransferPayloadShape & { updates: LineUpdate[] | null }>('InventoryTransferSetItemsPayload', itemsPayloadFields('updatedLineItems'));
const RemoveItemsPayload = payload<TransferPayloadShape & { updates: LineUpdate[] | null }>('InventoryTransferRemoveItemsPayload', itemsPayloadFields('removedQuantities'));

type ShipFull = ShipmentView;
interface ShipmentPayloadShape { inventoryShipment: ShipFull | null }
const shipField = (t: FieldBuilder<ShipmentPayloadShape & { userErrors: UserError[] }>) => ({ inventoryShipment: t.field({ type: Shipment, nullable: true, resolve: (p) => p.inventoryShipment }) });
const ShipCreatePayload = payload<ShipmentPayloadShape>('InventoryShipmentCreatePayload', shipField);
const ShipCreateInTransitPayload = payload<ShipmentPayloadShape>('InventoryShipmentCreateInTransitPayload', shipField);
const ShipTransitPayload = payload<ShipmentPayloadShape>('InventoryShipmentMarkInTransitPayload', shipField);
const ShipReceivePayload = payload<ShipmentPayloadShape>('InventoryShipmentReceivePayload', shipField);
const ShipTrackingPayload = payload<ShipmentPayloadShape>('InventoryShipmentSetTrackingPayload', shipField);
const ShipBarcodePayload = payload<ShipmentPayloadShape>('InventoryShipmentSetBarcodePayload', shipField);
const ShipRemoveItemsPayload = payload<ShipmentPayloadShape>('InventoryShipmentRemoveItemsPayload', shipField);
const ShipAddItemsPayload = payload<ShipmentPayloadShape & { addedItems: ShipmentLine[] | null }>('InventoryShipmentAddItemsPayload', (t) => ({
  ...shipField(t as never), addedItems: t.field({ type: [ShipmentLineItem], nullable: true, resolve: (p) => p.addedItems }),
}));
const ShipUpdateQtyPayload = payload<{ shipment: ShipFull | null; updatedLineItems: ShipmentLine[] | null }>('InventoryShipmentUpdateItemQuantitiesPayload', (t) => ({
  shipment: t.field({ type: Shipment, nullable: true, resolve: (p) => p.shipment }),
  updatedLineItems: t.field({ type: [ShipmentLineItem], nullable: true, resolve: (p) => p.updatedLineItems }),
}));
const ShipDeletePayload = payload<{ id: number | null }>('InventoryShipmentDeletePayload', (t) => ({ id: t.id({ nullable: true, resolve: (p) => (p.id ? toGid('InventoryShipment', p.id) : null) }) }));

/* ------------------------------ helpers ------------------------------ */

const bad = (field: string[], type: string): UserError[] => [{ field, message: `Invalid id: ${type}`, code: 'INVALID' }];
const num = (v: string | null | undefined, type: string) => (v ? parseId(String(v), type) : null);
/** A purchase order id from the API: null clears the link, an id that does not parse is kept as -1 so the service reports it as missing. */
const linkedPo = (v: string | number | null | undefined) => (v ? parseId(String(v), 'InventoryPurchaseOrder') ?? -1 : null);
const lines = (rows: { inventoryItemId: string | number; quantity: number }[]) => rows.map((l) => ({ inventoryItemId: parseId(String(l.inventoryItemId), 'InventoryItem') ?? 0, quantity: l.quantity }));

function tracking(i: { trackingNumber?: string | null; company?: string | null; trackingUrl?: string | null; arrivesAt?: Date | null } | null | undefined) {
  return i ? { trackingNumber: i.trackingNumber, company: i.company, trackingUrl: i.trackingUrl, arrivesAt: i.arrivesAt ? new Date(i.arrivesAt) : null } : null;
}

type Fail = { ok: false; errors: UserError[] };
const failT = (e: Fail) => ({ inventoryTransfer: null, userErrors: e.errors });

/* ------------------------------ transfer mutations ------------------------------ */

builder.mutationFields((t) => ({
  inventoryTransferCreate: t.field({
    type: CreatePayload, args: { input: t.arg({ type: TransferCreateInput, required: true }) },
    resolve: async (_r, { input }, ctx) => {
      requireScope(ctx, 'write_inventory');
      const r = await createTransfer(ctx.db, ctx.shopId, {
        originLocationId: num(input.originLocationId, 'Location'), destinationLocationId: num(input.destinationLocationId, 'Location'), lineItems: lines(input.lineItems),
        dateCreated: input.dateCreated ? new Date(input.dateCreated) : null, note: input.note, tags: input.tags, referenceName: input.referenceName,
        linkedPurchaseOrderId: linkedPo(input.shopmeLinkedPurchaseOrderId),
      });
      return r.ok ? { inventoryTransfer: r.value, userErrors: [] } : failT(r);
    },
  }),
  inventoryTransferCreateAsReadyToShip: t.field({
    type: CreateReadyPayload, args: { input: t.arg({ type: TransferCreateReadyInput, required: true }) },
    resolve: async (_r, { input }, ctx) => {
      requireScope(ctx, 'write_inventory');
      const r = await createTransfer(ctx.db, ctx.shopId, {
        originLocationId: num(input.originLocationId, 'Location'), destinationLocationId: num(input.destinationLocationId, 'Location'), lineItems: lines(input.lineItems),
        dateCreated: input.dateCreated ? new Date(input.dateCreated) : null, note: input.note, tags: input.tags, referenceName: input.referenceName,
        linkedPurchaseOrderId: linkedPo(input.shopmeLinkedPurchaseOrderId),
      }, { readyToShip: true });
      return r.ok ? { inventoryTransfer: r.value, userErrors: [] } : failT(r);
    },
  }),
  inventoryTransferEdit: t.field({
    type: EditPayload, args: { id: t.arg.id({ required: true }), input: t.arg({ type: TransferEditInput, required: true }) },
    resolve: async (_r, a, ctx) => {
      requireScope(ctx, 'write_inventory');
      const id = parseId(String(a.id), 'InventoryTransfer');
      if (!id) return { inventoryTransfer: null, userErrors: bad(['id'], 'InventoryTransfer') };
      const i = a.input;
      const r = await editTransfer(ctx.db, ctx.shopId, id, {
        originId: i.originId === undefined ? undefined : num(i.originId, 'Location'), destinationId: i.destinationId === undefined ? undefined : num(i.destinationId, 'Location'),
        dateCreated: i.dateCreated ? new Date(i.dateCreated) : undefined, note: i.note, tags: i.tags, referenceName: i.referenceName,
        linkedPurchaseOrderId: i.shopmeLinkedPurchaseOrderId === undefined ? undefined : linkedPo(i.shopmeLinkedPurchaseOrderId),
      });
      return r.ok ? { inventoryTransfer: r.value, userErrors: [] } : failT(r);
    },
  }),
  inventoryTransferMarkAsReadyToShip: t.field({
    type: ReadyPayload, args: { id: t.arg.id({ required: true }) },
    resolve: async (_r, a, ctx) => {
      requireScope(ctx, 'write_inventory');
      const id = parseId(String(a.id), 'InventoryTransfer');
      if (!id) return { inventoryTransfer: null, userErrors: bad(['id'], 'InventoryTransfer') };
      const r = await markTransferReadyToShip(ctx.db, ctx.shopId, id);
      return r.ok ? { inventoryTransfer: r.value, userErrors: [] } : failT(r);
    },
  }),
  inventoryTransferCancel: t.field({
    type: CancelPayload, args: { id: t.arg.id({ required: true }) },
    resolve: async (_r, a, ctx) => {
      requireScope(ctx, 'write_inventory');
      const id = parseId(String(a.id), 'InventoryTransfer');
      if (!id) return { inventoryTransfer: null, userErrors: bad(['id'], 'InventoryTransfer') };
      const r = await cancelTransfer(ctx.db, ctx.shopId, id);
      return r.ok ? { inventoryTransfer: r.value, userErrors: [] } : failT(r);
    },
  }),
  inventoryTransferDuplicate: t.field({
    type: DuplicatePayload, args: { id: t.arg.id({ required: true }) },
    resolve: async (_r, a, ctx) => {
      requireScope(ctx, 'write_inventory');
      const id = parseId(String(a.id), 'InventoryTransfer');
      if (!id) return { inventoryTransfer: null, userErrors: bad(['id'], 'InventoryTransfer') };
      const r = await duplicateTransfer(ctx.db, ctx.shopId, id);
      return r.ok ? { inventoryTransfer: r.value, userErrors: [] } : failT(r);
    },
  }),
  inventoryTransferDelete: t.field({
    type: DeletePayload, args: { id: t.arg.id({ required: true }) },
    resolve: async (_r, a, ctx) => {
      requireScope(ctx, 'write_inventory');
      const id = parseId(String(a.id), 'InventoryTransfer');
      if (!id) return { deletedId: null, userErrors: bad(['id'], 'InventoryTransfer') };
      const r = await deleteTransfer(ctx.db, ctx.shopId, id);
      return r.ok ? { deletedId: r.value, userErrors: [] } : { deletedId: null, userErrors: r.errors };
    },
  }),
  inventoryTransferSetItems: t.field({
    type: SetItemsPayload, args: { input: t.arg({ type: SetItemsInput, required: true }) },
    resolve: async (_r, { input }, ctx) => {
      requireScope(ctx, 'write_inventory');
      const id = parseId(String(input.id), 'InventoryTransfer');
      if (!id) return { inventoryTransfer: null, updates: null, userErrors: bad(['input', 'id'], 'InventoryTransfer') };
      const r = await setTransferItems(ctx.db, ctx.shopId, id, lines(input.lineItems));
      return r.ok ? { inventoryTransfer: r.value.transfer, updates: r.value.updates, userErrors: [] } : { inventoryTransfer: null, updates: null, userErrors: r.errors };
    },
  }),
  inventoryTransferRemoveItems: t.field({
    type: RemoveItemsPayload, args: { input: t.arg({ type: RemoveItemsInput, required: true }) },
    resolve: async (_r, { input }, ctx) => {
      requireScope(ctx, 'write_inventory');
      const id = parseId(String(input.id), 'InventoryTransfer');
      if (!id) return { inventoryTransfer: null, updates: null, userErrors: bad(['input', 'id'], 'InventoryTransfer') };
      const ids = input.transferLineItemIds?.map((x) => parseId(String(x), 'InventoryTransferLineItem') ?? 0);
      const r = await removeTransferItems(ctx.db, ctx.shopId, id, ids);
      return r.ok ? { inventoryTransfer: r.value.transfer, updates: r.value.updates, userErrors: [] } : { inventoryTransfer: null, updates: null, userErrors: r.errors };
    },
  }),

  /* ------------------------------ shipments ------------------------------ */

  inventoryShipmentCreate: t.field({
    type: ShipCreatePayload, args: { input: t.arg({ type: ShipmentCreateInput, required: true }) },
    resolve: (_r, { input }, ctx) => createShipmentMutation(ctx, input, false),
  }),
  inventoryShipmentCreateInTransit: t.field({
    type: ShipCreateInTransitPayload, args: { input: t.arg({ type: ShipmentCreateInput, required: true }) },
    resolve: (_r, { input }, ctx) => createShipmentMutation(ctx, input, true),
  }),
  inventoryShipmentMarkInTransit: t.field({
    type: ShipTransitPayload, args: { id: t.arg.id({ required: true }), dateShipped: t.arg({ type: 'DateTime' }) },
    resolve: async (_r, a, ctx) => {
      requireScope(ctx, 'write_inventory');
      const id = parseId(String(a.id), 'InventoryShipment');
      if (!id) return { inventoryShipment: null, userErrors: bad(['id'], 'InventoryShipment') };
      const r = await markShipmentInTransit(ctx.db, ctx.shopId, id, a.dateShipped ? new Date(a.dateShipped) : null);
      return r.ok ? { inventoryShipment: r.value, userErrors: [] } : { inventoryShipment: null, userErrors: r.errors };
    },
  }),
  inventoryShipmentReceive: t.field({
    type: ShipReceivePayload, args: { id: t.arg.id({ required: true }), lineItems: t.arg({ type: [ReceiveItemInput] }), dateReceived: t.arg({ type: 'DateTime' }), bulkReceiveAction: t.arg({ type: ReceiveReasonEnum }) },
    resolve: async (_r, a, ctx) => {
      requireScope(ctx, 'write_inventory');
      const id = parseId(String(a.id), 'InventoryShipment');
      if (!id) return { inventoryShipment: null, userErrors: bad(['id'], 'InventoryShipment') };
      const r = await receiveShipment(ctx.db, ctx.shopId, id, {
        lineItems: a.lineItems?.map((l) => ({ shipmentLineItemId: parseId(String(l.shipmentLineItemId), 'InventoryShipmentLineItem') ?? 0, quantity: l.quantity, reason: l.reason })),
        dateReceived: a.dateReceived ? new Date(a.dateReceived) : null, bulkReceiveAction: a.bulkReceiveAction,
      });
      return r.ok ? { inventoryShipment: r.value, userErrors: [] } : { inventoryShipment: null, userErrors: r.errors };
    },
  }),
  inventoryShipmentSetTracking: t.field({
    type: ShipTrackingPayload, args: { id: t.arg.id({ required: true }), tracking: t.arg({ type: TrackingInput, required: true }) },
    resolve: async (_r, a, ctx) => {
      requireScope(ctx, 'write_inventory');
      const id = parseId(String(a.id), 'InventoryShipment');
      if (!id) return { inventoryShipment: null, userErrors: bad(['id'], 'InventoryShipment') };
      const r = await setShipmentTracking(ctx.db, ctx.shopId, id, tracking(a.tracking)!);
      return r.ok ? { inventoryShipment: r.value, userErrors: [] } : { inventoryShipment: null, userErrors: r.errors };
    },
  }),
  inventoryShipmentSetBarcode: t.field({
    type: ShipBarcodePayload, args: { id: t.arg.id({ required: true }), barcode: t.arg.string({ required: true }) },
    resolve: async (_r, a, ctx) => {
      requireScope(ctx, 'write_inventory');
      const id = parseId(String(a.id), 'InventoryShipment');
      if (!id) return { inventoryShipment: null, userErrors: bad(['id'], 'InventoryShipment') };
      const r = await setShipmentBarcode(ctx.db, ctx.shopId, id, a.barcode);
      return r.ok ? { inventoryShipment: r.value, userErrors: [] } : { inventoryShipment: null, userErrors: r.errors };
    },
  }),
  inventoryShipmentAddItems: t.field({
    type: ShipAddItemsPayload, args: { id: t.arg.id({ required: true }), lineItems: t.arg({ type: [ShipmentLineInput], required: true }) },
    resolve: async (_r, a, ctx) => {
      requireScope(ctx, 'write_inventory');
      const id = parseId(String(a.id), 'InventoryShipment');
      if (!id) return { inventoryShipment: null, addedItems: null, userErrors: bad(['id'], 'InventoryShipment') };
      const r = await addShipmentItems(ctx.db, ctx.shopId, id, lines(a.lineItems));
      return r.ok ? { inventoryShipment: r.value.shipment, addedItems: r.value.added, userErrors: [] } : { inventoryShipment: null, addedItems: null, userErrors: r.errors };
    },
  }),
  inventoryShipmentRemoveItems: t.field({
    type: ShipRemoveItemsPayload, args: { id: t.arg.id({ required: true }), lineItems: t.arg.idList({ required: true }) },
    resolve: async (_r, a, ctx) => {
      requireScope(ctx, 'write_inventory');
      const id = parseId(String(a.id), 'InventoryShipment');
      if (!id) return { inventoryShipment: null, userErrors: bad(['id'], 'InventoryShipment') };
      const r = await removeShipmentItems(ctx.db, ctx.shopId, id, a.lineItems.map((x) => parseId(String(x), 'InventoryShipmentLineItem') ?? 0));
      return r.ok ? { inventoryShipment: r.value, userErrors: [] } : { inventoryShipment: null, userErrors: r.errors };
    },
  }),
  inventoryShipmentUpdateItemQuantities: t.field({
    type: ShipUpdateQtyPayload, args: { id: t.arg.id({ required: true }), items: t.arg({ type: [UpdateQtyInput], defaultValue: [] }) },
    resolve: async (_r, a, ctx) => {
      requireScope(ctx, 'write_inventory');
      const id = parseId(String(a.id), 'InventoryShipment');
      if (!id) return { shipment: null, updatedLineItems: null, userErrors: bad(['id'], 'InventoryShipment') };
      const r = await updateShipmentItemQuantities(ctx.db, ctx.shopId, id, (a.items ?? []).map((x) => ({ shipmentLineItemId: parseId(String(x.shipmentLineItemId), 'InventoryShipmentLineItem') ?? 0, quantity: x.quantity })));
      return r.ok ? { shipment: r.value.shipment, updatedLineItems: r.value.updated, userErrors: [] } : { shipment: null, updatedLineItems: null, userErrors: r.errors };
    },
  }),
  inventoryShipmentDelete: t.field({
    type: ShipDeletePayload, args: { id: t.arg.id({ required: true }) },
    resolve: async (_r, a, ctx) => {
      requireScope(ctx, 'write_inventory');
      const id = parseId(String(a.id), 'InventoryShipment');
      if (!id) return { id: null, userErrors: bad(['id'], 'InventoryShipment') };
      const r = await deleteShipment(ctx.db, ctx.shopId, id);
      return r.ok ? { id: r.value, userErrors: [] } : { id: null, userErrors: r.errors };
    },
  }),
}));

async function createShipmentMutation(
  ctx: import('../context').GraphQLContext,
  input: { movementId: string | number; trackingInput?: { trackingNumber?: string | null; company?: string | null; trackingUrl?: string | null; arrivesAt?: Date | null } | null; lineItems: { inventoryItemId: string | number; quantity: number }[]; dateCreated?: Date | null; barcode?: string | null },
  inTransit: boolean,
) {
  requireScope(ctx, 'write_inventory');
  const transferId = parseId(String(input.movementId), 'InventoryTransfer');
  if (!transferId) return { inventoryShipment: null, userErrors: bad(['input', 'movementId'], 'InventoryTransfer') };
  const r = await createShipment(ctx.db, ctx.shopId, {
    transferId, lineItems: lines(input.lineItems), tracking: tracking(input.trackingInput), barcode: input.barcode, dateCreated: input.dateCreated ? new Date(input.dateCreated) : null,
  }, inTransit);
  return r.ok ? { inventoryShipment: r.value, userErrors: [] } : { inventoryShipment: null, userErrors: r.errors };
}

export type { TransferStatus };
