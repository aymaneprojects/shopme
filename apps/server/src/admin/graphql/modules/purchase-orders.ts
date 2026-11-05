import {
  archivePurchaseOrder, closePurchaseOrder, countPurchaseOrders, createPurchaseOrder, createSupplier, deletePurchaseOrder, deleteSupplier, duplicatePurchaseOrder, getInventoryItem, getPurchaseOrder,
  getSupplier, listPurchaseOrders, listPurchaseOrderTransfers, listSuppliers, markPurchaseOrderAsOrdered, PAYMENT_TERMS, receivePurchaseOrder, updatePurchaseOrder, updateSupplier, getTransfer,
  type PoLineView, type PoTotals, type PurchaseOrderInput, type PurchaseOrderState, type PurchaseOrderView, type Supplier, type SupplierInput, type LocationSnapshotData,
} from '@shopme/core';
import { parseId, parseMoney, toGid, type UserError } from '@shopme/shopify-compat';
import { builder } from '../builder';
import { requireScope, type GraphQLContext } from '../context';
import { ConnectionArgs, defineConnection, paginate, paginateArray } from '../types/connection';
import { Count, CurrencyCode, MoneyV2, moneyV2 } from '../types/money';
import { Node, registerNode } from '../types/node';
import { InventoryItem_ } from '../types/catalog';
import { InventoryTransferConnection, LocationSnapshot, payload } from './inventory-transfers';

/**
 * Purchase orders. The read side matches the Admin API (`InventoryPurchaseOrder`, `inventoryPurchaseOrders`); the write side is
 * ShopMe's (`shopmePurchaseOrder*`, `shopmeSupplier*`) because the reference schema has no create or update mutations.
 */

const CODES = [
  'PURCHASE_ORDER_NOT_FOUND', 'SUPPLIER_NOT_FOUND', 'LOCATION_NOT_FOUND', 'LOCATION_NOT_ACTIVE', 'ITEMS_EMPTY', 'ITEM_NOT_FOUND', 'DUPLICATE_ITEM', 'INVALID_QUANTITY', 'INVALID_COST', 'INVALID_STATUS',
  'TAG_EXCEEDS_MAX_LENGTH', 'NOTE_TOO_LONG', 'REFERENCE_TOO_LONG', 'UNTRACKED_ITEM', 'BLANK', 'TAKEN', 'TOO_LONG', 'INVALID',
] as const;

const StatusEnum = builder.enumType('InventoryPurchaseOrderStatus', { values: ['DRAFT', 'ORDERED'] as const });
const StateEnum = builder.enumType('ShopmePurchaseOrderState', { values: ['DRAFT', 'ORDERED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CLOSED'] as const });
const PaymentTermsEnum = builder.enumType('ShopmePurchaseOrderPaymentTerms', { values: PAYMENT_TERMS });
const LineSortKeys = builder.enumType('PurchaseOrderLineItemSortKeys', { values: ['ID', 'CREATED_AT'] as const });
const SortKeys = builder.enumType('ShopmePurchaseOrderSortKeys', { values: ['CREATED_AT', 'ID', 'NAME', 'ORDERED_AT'] as const });

interface Ctx { currency: string }
const SupplierSnapshot = builder.objectRef<{ supplierName: string | null }>('InventorySupplierSnapshot').implement({ fields: (t) => ({ supplierName: t.exposeString('supplierName', { nullable: true }) }) });

const SupplierAddress = builder.objectRef<NonNullable<Supplier['address']>>('ShopmeSupplierAddress').implement({
  fields: (t) => ({
    address1: t.exposeString('address1', { nullable: true }), address2: t.exposeString('address2', { nullable: true }), city: t.exposeString('city', { nullable: true }),
    zip: t.exposeString('zip', { nullable: true }), countryCode: t.exposeString('countryCode', { nullable: true }), provinceCode: t.exposeString('provinceCode', { nullable: true }),
  }),
});
const SupplierRef = builder.objectRef<Supplier>('ShopmeSupplier');
SupplierRef.implement({
  interfaces: [Node],
  fields: (t) => ({
    name: t.exposeString('name'), contactName: t.exposeString('contactName', { nullable: true }), email: t.exposeString('email', { nullable: true }), phone: t.exposeString('phone', { nullable: true }),
    address: t.field({ type: SupplierAddress, nullable: true, resolve: (s) => s.address }), currencyCode: t.exposeString('currency', { nullable: true }),
    paymentTerms: t.exposeString('paymentTerms', { nullable: true }), note: t.exposeString('note', { nullable: true }),
    createdAt: t.field({ type: 'DateTime', resolve: (s) => s.createdAt }), updatedAt: t.field({ type: 'DateTime', resolve: (s) => s.updatedAt }),
  }),
});
const SupplierConnection = defineConnection('ShopmeSupplier', SupplierRef);
registerNode('ShopmeSupplier', (ctx, id) => getSupplier(ctx.db, ctx.shopId, id));

const Totals = builder.objectRef<PoTotals & Ctx>('ShopmePurchaseOrderTotals').implement({
  fields: (t) => ({
    variantsCount: t.exposeInt('variants'), itemsCount: t.exposeInt('items'),
    subtotal: t.field({ type: MoneyV2, resolve: (x) => moneyV2(x.subtotal, x.currency) }), taxes: t.field({ type: MoneyV2, resolve: (x) => moneyV2(x.taxes, x.currency) }),
    shipping: t.field({ type: MoneyV2, resolve: (x) => moneyV2(x.shipping, x.currency) }), other: t.field({ type: MoneyV2, resolve: (x) => moneyV2(x.other, x.currency) }),
    total: t.field({ type: MoneyV2, resolve: (x) => moneyV2(x.total, x.currency) }),
  }),
});

type LineShape = PoLineView & { po: PurchaseOrderView };
const LineRef = builder.objectRef<LineShape>('InventoryPurchaseOrderLineItem');
LineRef.implement({
  interfaces: [Node],
  fields: (t) => ({
    createdAt: t.field({ type: 'DateTime', resolve: (l) => l.createdAt }),
    inventoryItem: t.field({ type: InventoryItem_, nullable: true, resolve: (l, _a, ctx) => getInventoryItem(ctx.db, ctx.shopId, l.inventoryItemId) }),
    purchaseOrder: t.field({ type: PurchaseOrderRef, nullable: true, resolve: (l) => l.po }),
    title: t.exposeString('title', { nullable: true }), variantTitle: t.exposeString('variantTitle', { nullable: true }), supplierSku: t.exposeString('supplierSku', { nullable: true }),
    taxPercent: t.field({ type: 'Decimal', nullable: true, resolve: (l) => (l.taxPercent == null ? null : String(l.taxPercent)) }),
    unitCost: t.field({ type: MoneyV2, nullable: true, resolve: (l) => moneyV2(l.unitCost, l.po.currency) }),
    subtotal: t.field({ type: MoneyV2, nullable: true, resolve: (l) => moneyV2(l.subtotal, l.po.currency) }),
    totalCost: t.field({ type: MoneyV2, nullable: true, resolve: (l) => moneyV2(l.totalCost, l.po.currency) }),
    totalQuantity: t.exposeInt('quantity'),
    /** ShopMe extensions. */
    shopmeSku: t.exposeString('sku', { nullable: true }),
    shopmeReceivedQuantity: t.exposeInt('receivedQuantity'), shopmeRejectedQuantity: t.exposeInt('rejectedQuantity'), shopmeOutstandingQuantity: t.exposeInt('outstandingQuantity'),
    shopmeTaxAmount: t.field({ type: MoneyV2, resolve: (l) => moneyV2(l.tax, l.po.currency) }),
  }),
});
const LineConnection = defineConnection('InventoryPurchaseOrderLineItem', LineRef);

const PurchaseOrderRef = builder.objectRef<PurchaseOrderView>('InventoryPurchaseOrder');
PurchaseOrderRef.implement({
  interfaces: [Node],
  fields: (t) => ({
    name: t.exposeString('name'),
    status: t.field({ type: StatusEnum, resolve: (p) => p.status as never }),
    currency: t.field({ type: CurrencyCode, resolve: (p) => p.currency as never }),
    dateCreated: t.field({ type: 'DateTime', resolve: (p) => p.dateCreated }),
    orderedAt: t.field({ type: 'DateTime', nullable: true, resolve: (p) => p.orderedAt }),
    archivedAt: t.field({ type: 'DateTime', nullable: true, resolve: (p) => p.archivedAt }),
    origin: t.field({ type: SupplierSnapshot, nullable: true, resolve: (p) => (p.supplierName ? { supplierName: p.supplierName } : null) }),
    destination: t.field({ type: LocationSnapshot, nullable: true, resolve: (p) => p.destination }),
    lineItems: t.field({
      type: LineConnection, args: { ...ConnectionArgs, lineItemId: t.arg.id(), sortKey: t.arg({ type: LineSortKeys, defaultValue: 'ID' }), query: t.arg.string() },
      resolve: (p, a) => {
        const id = a.lineItemId ? parseId(String(a.lineItemId), 'InventoryPurchaseOrderLineItem') : null;
        const all = p.lines.filter((l) => !id || l.id === id).map((l) => ({ ...l, po: p }));
        return paginateArray(a, a.reverse ? all.reverse() : all);
      },
    }),
    transfers: t.field({
      type: InventoryTransferConnection, args: ConnectionArgs,
      resolve: async (p, a, ctx) => {
        const rows = await listPurchaseOrderTransfers(ctx.db, ctx.shopId, p.id);
        const views = (await Promise.all(rows.map((r) => getTransfer(ctx.db, ctx.shopId, r.id)))).filter((x): x is NonNullable<typeof x> => !!x);
        return paginateArray(a, a.reverse ? views.reverse() : views);
      },
    }),
    /** ShopMe extensions (the write side is ours, so the order carries what the admin needs). */
    shopmeState: t.field({ type: StateEnum, resolve: (p) => p.state }),
    shopmeSupplier: t.field({ type: SupplierRef, nullable: true, resolve: (p) => p.supplier }),
    shopmeReferenceNumber: t.exposeString('referenceNumber', { nullable: true }),
    shopmeSupplierNote: t.exposeString('supplierNote', { nullable: true }),
    shopmePaymentTerms: t.exposeString('paymentTerms', { nullable: true }),
    shopmeTags: t.stringList({ resolve: (p) => p.tags }),
    shopmeTaxesIncluded: t.exposeBoolean('taxesIncluded'),
    shopmeExchangeRate: t.float({ nullable: true, resolve: (p) => p.exchangeRate }),
    shopmeExpectedArrival: t.field({ type: 'DateTime', nullable: true, resolve: (p) => p.expectedArrival }),
    shopmeCarrier: t.exposeString('carrier', { nullable: true }),
    shopmeClosedAt: t.field({ type: 'DateTime', nullable: true, resolve: (p) => p.closedAt }),
    shopmeTotals: t.field({ type: Totals, resolve: (p) => ({ ...p.totals, currency: p.currency }) }),
    shopmeTotalQuantity: t.exposeInt('totalQuantity'), shopmeReceivedQuantity: t.exposeInt('receivedQuantity'), shopmeRejectedQuantity: t.exposeInt('rejectedQuantity'),
    shopmeDestinationLocationId: t.id({ nullable: true, resolve: (p) => (p.destinationLocationId ? toGid('Location', p.destinationLocationId) : null) }),
  }),
});
const PurchaseOrderConnection = defineConnection('InventoryPurchaseOrder', PurchaseOrderRef);
registerNode('InventoryPurchaseOrder', (ctx, id) => getPurchaseOrder(ctx.db, ctx.shopId, id));
registerNode('InventoryPurchaseOrderLineItem', async () => null);

/* ------------------------------ queries ------------------------------ */

/** `state:partially_received` and `archived:true` are handled here (derived states are not stored). */
function splitQuery(q: string | null | undefined): { query: string | null; state: PurchaseOrderState | null; includeArchived: boolean } {
  let state: PurchaseOrderState | null = null;
  let includeArchived = false;
  const query = (q ?? '').replace(/(^|\s)state:(\w+)/gi, (_m, sp, v: string) => { state = v.toUpperCase() as PurchaseOrderState; return sp; })
    .replace(/(^|\s)archived:(\w+)/gi, (_m, sp, v: string) => { includeArchived = v === 'true'; return sp; }).trim();
  return { query: query || null, state, includeArchived };
}

builder.queryFields((t) => ({
  inventoryPurchaseOrder: t.field({
    type: PurchaseOrderRef, nullable: true, args: { id: t.arg.id({ required: true }) },
    resolve: (_r, a, ctx) => { requireScope(ctx, 'read_inventory'); const id = parseId(String(a.id), 'InventoryPurchaseOrder'); return id ? getPurchaseOrder(ctx.db, ctx.shopId, id) : null; },
  }),
  inventoryPurchaseOrders: t.field({
    type: PurchaseOrderConnection, args: { ...ConnectionArgs, sortKey: t.arg({ type: SortKeys, defaultValue: 'ID' }), query: t.arg.string() },
    resolve: (_r, a, ctx) => {
      requireScope(ctx, 'read_inventory');
      const f = splitQuery(a.query);
      const o = { ...f, sortKey: a.sortKey ?? 'ID', reverse: !!a.reverse };
      return paginate(a, { fetch: ({ offset, limit }) => listPurchaseOrders(ctx.db, ctx.shopId, { ...o, offset, limit }), total: () => countPurchaseOrders(ctx.db, ctx.shopId, o) });
    },
  }),
  shopmeInventoryPurchaseOrdersCount: t.field({
    type: Count, args: { query: t.arg.string() },
    resolve: async (_r, a, ctx) => { requireScope(ctx, 'read_inventory'); return { count: await countPurchaseOrders(ctx.db, ctx.shopId, splitQuery(a.query)), precision: 'EXACT' as const }; },
  }),
  shopmeSuppliers: t.field({
    type: SupplierConnection, args: { ...ConnectionArgs, query: t.arg.string() },
    resolve: (_r, a, ctx) => { requireScope(ctx, 'read_inventory'); return paginate(a, { fetch: ({ offset, limit }) => listSuppliers(ctx.db, ctx.shopId, { query: a.query, offset, limit }) }); },
  }),
  shopmeSupplier: t.field({
    type: SupplierRef, nullable: true, args: { id: t.arg.id({ required: true }) },
    resolve: (_r, a, ctx) => { requireScope(ctx, 'read_inventory'); const id = parseId(String(a.id), 'ShopmeSupplier'); return id ? getSupplier(ctx.db, ctx.shopId, id) : null; },
  }),
}));

/* ------------------------------ mutations ------------------------------ */

const LineInput = builder.inputType('ShopmePurchaseOrderLineItemInput', {
  fields: (t) => ({ inventoryItemId: t.id({ required: true }), quantity: t.int({ required: true }), unitCost: t.field({ type: 'Decimal' }), supplierSku: t.string(), taxPercent: t.float() }),
});
const POInput = builder.inputType('ShopmePurchaseOrderInput', {
  fields: (t) => ({
    supplierId: t.id(), destinationLocationId: t.id(), currencyCode: t.string(), exchangeRate: t.float(), taxesIncluded: t.boolean(), referenceNumber: t.string(), supplierNote: t.string(),
    paymentTerms: t.string(), tags: t.stringList(), shippingCost: t.field({ type: 'Decimal' }), otherCost: t.field({ type: 'Decimal' }), expectedArrival: t.field({ type: 'DateTime' }),
    carrier: t.string(), lineItems: t.field({ type: [LineInput] }),
  }),
});
const ReceiveLineInput = builder.inputType('ShopmePurchaseOrderReceiveLineItemInput', {
  fields: (t) => ({ purchaseOrderLineItemId: t.id({ required: true }), acceptedQuantity: t.int(), rejectedQuantity: t.int() }),
});
const ReceiveInput = builder.inputType('ShopmePurchaseOrderReceiveInput', {
  fields: (t) => ({
    lineItems: t.field({ type: [ReceiveLineInput], required: true }), allowOverReceive: t.boolean({ defaultValue: false }), updateUnitCost: t.boolean({ defaultValue: true }),
    costMethod: t.field({ type: builder.enumType('ShopmeCostMethod', { values: ['AVERAGE', 'LAST'] as const }), defaultValue: 'AVERAGE' }),
  }),
});
const SupplierAddressInput = builder.inputType('ShopmeSupplierAddressInput', {
  fields: (t) => ({ address1: t.string(), address2: t.string(), city: t.string(), zip: t.string(), countryCode: t.string(), provinceCode: t.string() }),
});
const SupplierInputType = builder.inputType('ShopmeSupplierInput', {
  fields: (t) => ({
    name: t.string(), contactName: t.string(), email: t.string(), phone: t.string(), address: t.field({ type: SupplierAddressInput }), currencyCode: t.string(), paymentTerms: t.string(), note: t.string(),
  }),
});

interface POPayloadShape { shopmePurchaseOrder: PurchaseOrderView | null }
const poPayload = (name: string) => payload<POPayloadShape>(name, (t) => ({ shopmePurchaseOrder: t.field({ type: PurchaseOrderRef, nullable: true, resolve: (p) => p.shopmePurchaseOrder }) }), CODES);
const CreateP = poPayload('ShopmePurchaseOrderCreatePayload');
const UpdateP = poPayload('ShopmePurchaseOrderUpdatePayload');
const OrderedP = poPayload('ShopmePurchaseOrderMarkAsOrderedPayload');
const CloseP = poPayload('ShopmePurchaseOrderClosePayload');
const ArchiveP = poPayload('ShopmePurchaseOrderArchivePayload');
const DuplicateP = poPayload('ShopmePurchaseOrderDuplicatePayload');
const DeleteP = payload<{ deletedId: number | null }>('ShopmePurchaseOrderDeletePayload', (t) => ({ deletedId: t.id({ nullable: true, resolve: (p) => (p.deletedId ? toGid('InventoryPurchaseOrder', p.deletedId) : null) }) }), CODES);
const ReceiveP = payload<POPayloadShape & { transferId: number | null; shipmentId: number | null }>('ShopmePurchaseOrderReceivePayload', (t) => ({
  shopmePurchaseOrder: t.field({ type: PurchaseOrderRef, nullable: true, resolve: (p) => p.shopmePurchaseOrder }),
  inventoryTransferId: t.id({ nullable: true, resolve: (p) => (p.transferId ? toGid('InventoryTransfer', p.transferId) : null) }),
  inventoryShipmentId: t.id({ nullable: true, resolve: (p) => (p.shipmentId ? toGid('InventoryShipment', p.shipmentId) : null) }),
}), CODES);
interface SupplierPayloadShape { supplier: Supplier | null }
const SupplierP = (name: string) => payload<SupplierPayloadShape>(name, (t) => ({ supplier: t.field({ type: SupplierRef, nullable: true, resolve: (p) => p.supplier }) }), CODES);
const SupplierCreateP = SupplierP('ShopmeSupplierCreatePayload');
const SupplierUpdateP = SupplierP('ShopmeSupplierUpdatePayload');
const SupplierDeleteP = payload<{ deletedId: number | null }>('ShopmeSupplierDeletePayload', (t) => ({ deletedId: t.id({ nullable: true, resolve: (p) => (p.deletedId ? toGid('ShopmeSupplier', p.deletedId) : null) }) }), CODES);

const badId = (field: string[], type: string): UserError[] => [{ field, message: `Invalid id: ${type}`, code: 'INVALID' }];
const none = (errors: UserError[]) => ({ shopmePurchaseOrder: null, userErrors: errors });
const idOf = (v: string | number | null | undefined, type: string) => (v ? parseId(String(v), type) : null);

async function toInput(ctx: GraphQLContext, i: typeof POInput.$inferInput): Promise<PurchaseOrderInput> {
  const { getShop } = await import('@shopme/core');
  const currency = i.currencyCode ?? (await getShop(ctx.db, ctx.shopId))!.currency;
  const cost = (v: string | null | undefined) => (v == null ? (v as null | undefined) : parseMoney(v, currency));
  return {
    supplierId: i.supplierId === undefined ? undefined : idOf(i.supplierId, 'ShopmeSupplier'), destinationLocationId: i.destinationLocationId === undefined ? undefined : idOf(i.destinationLocationId, 'Location'),
    currency: i.currencyCode, exchangeRate: i.exchangeRate, taxesIncluded: i.taxesIncluded, referenceNumber: i.referenceNumber, supplierNote: i.supplierNote, paymentTerms: i.paymentTerms, tags: i.tags,
    shippingCost: cost(i.shippingCost), otherCost: cost(i.otherCost), expectedArrival: i.expectedArrival ? new Date(i.expectedArrival) : i.expectedArrival === null ? null : undefined, carrier: i.carrier,
    lineItems: i.lineItems?.map((l) => ({ inventoryItemId: idOf(l.inventoryItemId, 'InventoryItem') ?? 0, quantity: l.quantity, unitCost: cost(l.unitCost) ?? null, supplierSku: l.supplierSku, taxPercent: l.taxPercent })),
  };
}

type SimpleResult = { ok: true; value: PurchaseOrderView } | { ok: false; errors: UserError[] };
const out = (r: SimpleResult) => (r.ok ? { shopmePurchaseOrder: r.value, userErrors: [] } : none(r.errors));

builder.mutationFields((t) => ({
  shopmePurchaseOrderCreate: t.field({
    type: CreateP, args: { input: t.arg({ type: POInput, required: true }) },
    resolve: async (_r, { input }, ctx) => { requireScope(ctx, 'write_inventory'); return out(await createPurchaseOrder(ctx.db, ctx.shopId, await toInput(ctx, input))); },
  }),
  shopmePurchaseOrderUpdate: t.field({
    type: UpdateP, args: { id: t.arg.id({ required: true }), input: t.arg({ type: POInput, required: true }) },
    resolve: async (_r, a, ctx) => {
      requireScope(ctx, 'write_inventory');
      const id = idOf(a.id, 'InventoryPurchaseOrder');
      if (!id) return none(badId(['id'], 'InventoryPurchaseOrder'));
      return out(await updatePurchaseOrder(ctx.db, ctx.shopId, id, await toInput(ctx, a.input)));
    },
  }),
  shopmePurchaseOrderMarkAsOrdered: t.field({
    type: OrderedP, args: { id: t.arg.id({ required: true }) },
    resolve: async (_r, a, ctx) => { requireScope(ctx, 'write_inventory'); const id = idOf(a.id, 'InventoryPurchaseOrder'); return id ? out(await markPurchaseOrderAsOrdered(ctx.db, ctx.shopId, id)) : none(badId(['id'], 'InventoryPurchaseOrder')); },
  }),
  shopmePurchaseOrderClose: t.field({
    type: CloseP, args: { id: t.arg.id({ required: true }) },
    resolve: async (_r, a, ctx) => { requireScope(ctx, 'write_inventory'); const id = idOf(a.id, 'InventoryPurchaseOrder'); return id ? out(await closePurchaseOrder(ctx.db, ctx.shopId, id)) : none(badId(['id'], 'InventoryPurchaseOrder')); },
  }),
  shopmePurchaseOrderArchive: t.field({
    type: ArchiveP, args: { id: t.arg.id({ required: true }), archive: t.arg.boolean({ defaultValue: true }) },
    resolve: async (_r, a, ctx) => { requireScope(ctx, 'write_inventory'); const id = idOf(a.id, 'InventoryPurchaseOrder'); return id ? out(await archivePurchaseOrder(ctx.db, ctx.shopId, id, a.archive !== false)) : none(badId(['id'], 'InventoryPurchaseOrder')); },
  }),
  shopmePurchaseOrderDuplicate: t.field({
    type: DuplicateP, args: { id: t.arg.id({ required: true }) },
    resolve: async (_r, a, ctx) => { requireScope(ctx, 'write_inventory'); const id = idOf(a.id, 'InventoryPurchaseOrder'); return id ? out(await duplicatePurchaseOrder(ctx.db, ctx.shopId, id)) : none(badId(['id'], 'InventoryPurchaseOrder')); },
  }),
  shopmePurchaseOrderDelete: t.field({
    type: DeleteP, args: { id: t.arg.id({ required: true }) },
    resolve: async (_r, a, ctx) => {
      requireScope(ctx, 'write_inventory');
      const id = idOf(a.id, 'InventoryPurchaseOrder');
      if (!id) return { deletedId: null, userErrors: badId(['id'], 'InventoryPurchaseOrder') };
      const r = await deletePurchaseOrder(ctx.db, ctx.shopId, id);
      return r.ok ? { deletedId: r.value, userErrors: [] } : { deletedId: null, userErrors: r.errors };
    },
  }),
  shopmePurchaseOrderReceive: t.field({
    type: ReceiveP, args: { id: t.arg.id({ required: true }), input: t.arg({ type: ReceiveInput, required: true }) },
    resolve: async (_r, a, ctx) => {
      requireScope(ctx, 'write_inventory');
      const id = idOf(a.id, 'InventoryPurchaseOrder');
      if (!id) return { shopmePurchaseOrder: null, transferId: null, shipmentId: null, userErrors: badId(['id'], 'InventoryPurchaseOrder') };
      const r = await receivePurchaseOrder(ctx.db, ctx.shopId, id, {
        lineItems: a.input.lineItems.map((l) => ({ purchaseOrderLineItemId: idOf(l.purchaseOrderLineItemId, 'InventoryPurchaseOrderLineItem') ?? 0, acceptedQuantity: l.acceptedQuantity ?? 0, rejectedQuantity: l.rejectedQuantity ?? 0 })),
        allowOverReceive: !!a.input.allowOverReceive, updateUnitCost: a.input.updateUnitCost !== false, costMethod: a.input.costMethod === 'LAST' ? 'last' : 'average',
      });
      return r.ok ? { shopmePurchaseOrder: r.value.purchaseOrder, transferId: r.value.transferId, shipmentId: r.value.shipmentId, userErrors: [] } : { shopmePurchaseOrder: null, transferId: null, shipmentId: null, userErrors: r.errors };
    },
  }),

  shopmeSupplierCreate: t.field({
    type: SupplierCreateP, args: { input: t.arg({ type: SupplierInputType, required: true }) },
    resolve: async (_r, { input }, ctx) => {
      requireScope(ctx, 'write_inventory');
      const r = await createSupplier(ctx.db, ctx.shopId, supplierInput(input));
      return r.ok ? { supplier: r.value, userErrors: [] } : { supplier: null, userErrors: r.errors };
    },
  }),
  shopmeSupplierUpdate: t.field({
    type: SupplierUpdateP, args: { id: t.arg.id({ required: true }), input: t.arg({ type: SupplierInputType, required: true }) },
    resolve: async (_r, a, ctx) => {
      requireScope(ctx, 'write_inventory');
      const id = idOf(a.id, 'ShopmeSupplier');
      if (!id) return { supplier: null, userErrors: badId(['id'], 'ShopmeSupplier') };
      const r = await updateSupplier(ctx.db, ctx.shopId, id, supplierInput(a.input));
      return r.ok ? { supplier: r.value, userErrors: [] } : { supplier: null, userErrors: r.errors };
    },
  }),
  shopmeSupplierDelete: t.field({
    type: SupplierDeleteP, args: { id: t.arg.id({ required: true }) },
    resolve: async (_r, a, ctx) => {
      requireScope(ctx, 'write_inventory');
      const id = idOf(a.id, 'ShopmeSupplier');
      if (!id) return { deletedId: null, userErrors: badId(['id'], 'ShopmeSupplier') };
      const r = await deleteSupplier(ctx.db, ctx.shopId, id);
      return r.ok ? { deletedId: r.value, userErrors: [] } : { deletedId: null, userErrors: r.errors };
    },
  }),
}));

function supplierInput(i: typeof SupplierInputType.$inferInput): SupplierInput {
  return { name: i.name, contactName: i.contactName, email: i.email, phone: i.phone, address: i.address === undefined ? undefined : i.address ? { ...i.address } : null, currency: i.currencyCode, paymentTerms: i.paymentTerms, note: i.note };
}
