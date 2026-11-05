import { boolean, check, index, integer, jsonb, numeric, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core';
import { createdAt, money, oneOf, pk, ref, shopIdCol, tagsCol, timestamps, ts, updatedAt } from './_helpers';
import { shops } from './shop';
import { inventoryItems, locations } from './catalog';

const shopFk = () => shopIdCol().references(() => shops.id, { onDelete: 'cascade' });

export const TRANSFER_STATUSES = ['DRAFT', 'READY_TO_SHIP', 'IN_PROGRESS', 'TRANSFERRED', 'CANCELED'] as const;
export const SHIPMENT_STATUSES = ['DRAFT', 'IN_TRANSIT', 'PARTIALLY_RECEIVED', 'RECEIVED'] as const;
export const PURCHASE_ORDER_STATUSES = ['DRAFT', 'ORDERED'] as const;

export interface SupplierAddress { address1?: string | null; address2?: string | null; city?: string | null; zip?: string | null; countryCode?: string | null; provinceCode?: string | null }
export interface LocationSnapshotData { locationId: number | null; name: string; address1?: string | null; address2?: string | null; city?: string | null; zip?: string | null; countryCode?: string | null; provinceCode?: string | null; phone?: string | null; snapshottedAt: string }

/** Vendors stock is ordered from. Purchase orders keep a name snapshot. */
export const suppliers = pgTable('suppliers', {
  id: pk(), shopId: shopFk(),
  name: text('name').notNull(), contactName: text('contact_name'), email: text('email'), phone: text('phone'),
  address: jsonb('address').$type<SupplierAddress | null>(), currency: text('currency'), paymentTerms: text('payment_terms'), note: text('note'),
  ...timestamps(),
}, (t) => [uniqueIndex('suppliers_name_uq').on(t.shopId, t.name)]);

export const purchaseOrders = pgTable('purchase_orders', {
  id: pk(), shopId: shopFk(),
  name: text('name').notNull(),
  status: text('status').notNull().default('DRAFT'),
  closedAt: ts('closed_at'), archivedAt: ts('archived_at'),
  supplierId: ref('supplier_id').references(() => suppliers.id, { onDelete: 'set null' }),
  supplierName: text('supplier_name'),
  destinationLocationId: ref('destination_location_id').references(() => locations.id, { onDelete: 'restrict' }),
  destinationSnapshot: jsonb('destination_snapshot').$type<LocationSnapshotData | null>(),
  currency: text('currency').notNull(),
  exchangeRate: numeric('exchange_rate', { precision: 18, scale: 8, mode: 'number' }),
  taxesIncluded: boolean('taxes_included').notNull().default(true),
  referenceNumber: text('reference_number'), supplierNote: text('supplier_note'), paymentTerms: text('payment_terms'), tags: tagsCol(),
  shippingCost: money('shipping_cost').notNull().default(0),
  otherCost: money('other_cost').notNull().default(0),
  expectedArrival: ts('expected_arrival'), carrier: text('carrier'),
  orderedAt: ts('ordered_at'), dateCreated: createdAt(), updatedAt: updatedAt(),
}, (t) => [
  uniqueIndex('purchase_orders_name_uq').on(t.shopId, t.name),
  check('purchase_orders_status_chk', oneOf(t.status, PURCHASE_ORDER_STATUSES)),
]);

export const purchaseOrderLines = pgTable('purchase_order_lines', {
  id: pk(), shopId: shopFk(),
  purchaseOrderId: ref('purchase_order_id').notNull().references(() => purchaseOrders.id, { onDelete: 'cascade' }),
  inventoryItemId: ref('inventory_item_id').notNull().references(() => inventoryItems.id),
  title: text('title'), variantTitle: text('variant_title'), sku: text('sku'), supplierSku: text('supplier_sku'),
  quantity: integer('quantity').notNull(), receivedQuantity: integer('received_quantity').notNull().default(0),
  rejectedQuantity: integer('rejected_quantity').notNull().default(0),
  unitCost: money('unit_cost').notNull().default(0), taxPercent: numeric('tax_percent', { precision: 6, scale: 3, mode: 'number' }),
  createdAt: createdAt(),
}, (t) => [uniqueIndex('purchase_order_lines_uq').on(t.purchaseOrderId, t.inventoryItemId)]);

export const inventoryTransfers = pgTable('inventory_transfers', {
  id: pk(), shopId: shopFk(),
  name: text('name').notNull(),
  status: text('status').notNull().default('DRAFT'),
  originLocationId: ref('origin_location_id').references(() => locations.id, { onDelete: 'restrict' }),
  destinationLocationId: ref('destination_location_id').references(() => locations.id, { onDelete: 'restrict' }),
  originSnapshot: jsonb('origin_snapshot').$type<LocationSnapshotData | null>(),
  destinationSnapshot: jsonb('destination_snapshot').$type<LocationSnapshotData | null>(),
  purchaseOrderId: ref('purchase_order_id').references(() => purchaseOrders.id, { onDelete: 'set null' }),
  /** A purchase order the transfer is linked to for reference (it does not receive it: that is `purchaseOrderId`). */
  linkedPurchaseOrderId: ref('linked_purchase_order_id').references(() => purchaseOrders.id, { onDelete: 'set null' }),
  referenceName: text('reference_name'), note: text('note'), tags: tagsCol(),
  dateCreated: ts('date_created').notNull().defaultNow(),
  ...timestamps(),
}, (t) => [
  uniqueIndex('inventory_transfers_name_uq').on(t.shopId, t.name),
  index('inventory_transfers_status_idx').on(t.shopId, t.status),
  check('inventory_transfers_status_chk', oneOf(t.status, TRANSFER_STATUSES)),
]);

export const inventoryTransferLines = pgTable('inventory_transfer_lines', {
  id: pk(), shopId: shopFk(),
  transferId: ref('transfer_id').notNull().references(() => inventoryTransfers.id, { onDelete: 'cascade' }),
  inventoryItemId: ref('inventory_item_id').notNull().references(() => inventoryItems.id),
  purchaseOrderLineId: ref('purchase_order_line_id'),
  title: text('title'),
  totalQuantity: integer('total_quantity').notNull(),
  createdAt: createdAt(),
}, (t) => [uniqueIndex('inventory_transfer_lines_uq').on(t.transferId, t.inventoryItemId)]);

export const inventoryShipments = pgTable('inventory_shipments', {
  id: pk(), shopId: shopFk(),
  transferId: ref('transfer_id').notNull().references(() => inventoryTransfers.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  status: text('status').notNull().default('DRAFT'),
  barcode: text('barcode'),
  trackingCompany: text('tracking_company'), trackingNumber: text('tracking_number'), trackingUrl: text('tracking_url'), arrivesAt: ts('arrives_at'),
  dateCreated: ts('date_created').notNull().defaultNow(), dateShipped: ts('date_shipped'), dateReceived: ts('date_received'),
}, (t) => [
  uniqueIndex('inventory_shipments_barcode_uq').on(t.shopId, t.barcode),
  index('inventory_shipments_transfer_idx').on(t.transferId),
  check('inventory_shipments_status_chk', oneOf(t.status, SHIPMENT_STATUSES)),
]);

export const inventoryShipmentLines = pgTable('inventory_shipment_lines', {
  id: pk(), shopId: shopFk(),
  shipmentId: ref('shipment_id').notNull().references(() => inventoryShipments.id, { onDelete: 'cascade' }),
  transferLineId: ref('transfer_line_id').notNull().references(() => inventoryTransferLines.id, { onDelete: 'cascade' }),
  inventoryItemId: ref('inventory_item_id').notNull(),
  quantity: integer('quantity').notNull(),
  acceptedQuantity: integer('accepted_quantity').notNull().default(0),
  rejectedQuantity: integer('rejected_quantity').notNull().default(0),
  canceledQuantity: integer('canceled_quantity').notNull().default(0),
  createdAt: createdAt(),
}, (t) => [index('inventory_shipment_lines_shipment_idx').on(t.shipmentId)]);
