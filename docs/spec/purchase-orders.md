# Purchase orders

Status: draft for implementation. API version studied: 2026-10. Names are listed for interoperability; behavior text is ours.
Admin screens were observed on our own development store (section 3.1). Receiving goes through inventory transfers
([inventory-transfers.md](inventory-transfers.md)).

## 1. Purpose

Track stock ordered from suppliers: who it was ordered from, which variants at what cost, where it should arrive, and how much has been
received. Receiving adds stock at the destination location and can update unit costs.

Existing in ShopMe: `inventory_items.unit_cost`, `locations`, inventory levels and ledger. Nothing for suppliers or ordering.

## 2. Concepts

- **Supplier**: a vendor record (name, contact, address, email, phone, notes, default currency, default payment terms). Orders keep a
  frozen `supplierName` snapshot (`InventorySupplierSnapshot`).
- **Purchase order** (`InventoryPurchaseOrder`): name (`#PO1`), status `DRAFT` or `ORDERED` (the API enum has only these two; receipt
  progress is derived from linked transfers), currency, destination location, reference number, supplier note, payment terms, tags,
  created and ordered dates, archived date, line items.
- **Line**: inventory item (variant), supplier SKU, unit cost, tax percent, quantity ordered; derived subtotal and total cost.
- **Received** quantity of a line: sum of accepted quantities on shipments of transfers linked to the order.
- **Derived state** shown in the admin: Draft, Ordered, Partially received, Received, Closed (merchant closes with units outstanding),
  Archived.

## 3. Merchant-facing behavior

### 3.1 Admin screens (observed)

Navigation: Products > Purchase orders.

**List.** Header: back arrow and "Purchase orders". A toolbar with a view selector (tab "All"), a combined search-and-filter field
("Search and filter"), and a columns button at the far right. Empty state: illustration, headline "Manage your purchase orders", one
sentence ("track and receive stock ordered from suppliers"), a primary "Create purchase order" button, and a "Learn more" link. With
data (inferred): table of order number, supplier, destination, status, received progress (n of m), total, expected arrival; filters for
status, supplier, destination, tag.

**Create purchase order** (single page, two columns):
- Left card: a pipeline with a supplier dropdown ("Select a supplier") then an arrow and a destination dropdown ("Select a destination",
  a location). Below it a product search field ("Search products to add") with two icon buttons: import (CSV) and barcode scan. Added
  variants appear in a table: product and variant, supplier SKU, quantity, unit cost, tax rate, line total.
- Right column, "Cost summary" (with a pencil to adjust shipping/other costs): "Order details" lines: "N variants (M items)" with amount,
  "Taxes (included)" with amount, and a bold Total. All 0.00 when empty.
- Right column, "Purchase order details": text field "Reference number" (counter 0/255), multi-line "Note to supplier" (counter 0/5000),
  and a footer with two chips: "Payment terms" (default "None", dropdown) and "Currency" (default shop currency, dropdown), plus an
  expander chevron for further fields (shipping carrier and expected arrival, inferred).
- Right column, "Tags" (with pencil): one text input with counter 0/40 per tag.
- Page actions (not in the capture): "Save as draft" and "Mark as ordered" (primary); on an ordered order: "Receive items", "Close", "Cancel
  order" (inferred).

**Detail page** (inferred): order number and status badge, lines with received progress bars, linked transfers (receipts) with statuses,
timeline, print/email PDF to supplier, duplicate.

### 3.2 Behaviors

- Draft: freely editable. "Mark as ordered": validates supplier, destination, at least one line; sets `ordered_at`; increases `incoming`
  at the destination by each line quantity (`incoming` +N, ledger reason `purchase_order_ordered`).
- Receive: creates (or reuses) a transfer linked to the order with the supplier as virtual origin and the order's destination; shipments
  and receipts follow inventory-transfers.md 3.2 without origin changes. Accepted units add to `available` and `on_hand`; the PO's incoming
  at the destination is released as units are accepted, rejected or canceled. Unit cost from the line updates the item's `unit_cost` as a
  weighted average (setting `inventory.costMethod` = `average` default, or `last`).
- Over-receiving: allowed up to the ordered quantity unless the merchant confirms extra units (adds to the line).
- Cancel/close: closing with outstanding units releases their `incoming`; closed orders remain readable.
- Taxes: a line tax percent adds to cost when "Taxes (included)" is off (setting per order); totals in the order currency; when the order
  currency differs from the shop currency, a rate is saved at order time (manual field) to compute shop-currency cost.
- Numbering: sequence `purchase_order` (prefix `#PO`). References and tags are free text; tags max 40 characters each.
- Deleting: only drafts. Archiving (`archivedAt`) hides closed/received orders from default lists.
- Permissions: staff area `products` (existing `PERMISSION_AREAS`).

## 4. Data model proposal (Drizzle)

```ts
export const suppliers = pgTable('suppliers', {
  id: pk(), shopId: shopFk(), name: text('name').notNull(), contactName: text('contact_name'), email: text('email'), phone: text('phone'),
  address: jsonb('address'), currency: text('currency'), paymentTerms: text('payment_terms'), note: text('note'),
  ...timestamps(),
}, (t) => [uniqueIndex('suppliers_name_uq').on(t.shopId, t.name)]);

export const purchaseOrders = pgTable('purchase_orders', {
  id: pk(), shopId: shopFk(),
  name: text('name').notNull(),                            // '#PO1'
  status: text('status').notNull().default('DRAFT'),       // DRAFT | ORDERED
  closedAt: ts('closed_at'), archivedAt: ts('archived_at'),
  supplierId: ref('supplier_id').references(() => suppliers.id, { onDelete: 'set null' }),
  supplierName: text('supplier_name'),                     // snapshot
  destinationLocationId: ref('destination_location_id').references(() => locations.id),
  destinationSnapshot: jsonb('destination_snapshot'),
  currency: text('currency').notNull(), exchangeRate: numeric('exchange_rate', { precision: 18, scale: 8, mode: 'number' }),
  taxesIncluded: boolean('taxes_included').notNull().default(true),
  referenceNumber: text('reference_number'), supplierNote: text('supplier_note'), paymentTerms: text('payment_terms'), tags: tagsCol(),
  shippingCost: money('shipping_cost').notNull().default(0), expectedArrival: ts('expected_arrival'), carrier: text('carrier'),
  orderedAt: ts('ordered_at'), dateCreated: createdAt(), updatedAt: updatedAt(),
}, (t) => [uniqueIndex('purchase_orders_name_uq').on(t.shopId, t.name)]);

export const purchaseOrderLines = pgTable('purchase_order_lines', {
  id: pk(), shopId: shopFk(),
  purchaseOrderId: ref('purchase_order_id').notNull().references(() => purchaseOrders.id, { onDelete: 'cascade' }),
  inventoryItemId: ref('inventory_item_id').notNull().references(() => inventoryItems.id),
  title: text('title'), variantTitle: text('variant_title'), supplierSku: text('supplier_sku'),
  quantity: integer('quantity').notNull(), receivedQuantity: integer('received_quantity').notNull().default(0),
  rejectedQuantity: integer('rejected_quantity').notNull().default(0),
  unitCost: money('unit_cost').notNull().default(0), taxPercent: numeric('tax_percent', { precision: 6, scale: 3, mode: 'number' }),
  createdAt: createdAt(),
});
```
`inventory_transfers.purchase_order_id` links receipts. Totals (`subtotal`, `totalCost`) are computed in code from lines.

## 5. Admin GraphQL surface

The reference schema exposes purchase orders read-only (queries and types; no create/update mutations), as a view for apps. We expose the
same and add our own writes under a ShopMe prefix so the admin UI is not special-cased.

### 5.1 Types and roots (MVP)
`InventoryPurchaseOrder` (id, name, status `InventoryPurchaseOrderStatus { DRAFT, ORDERED }`, currency, destination `LocationSnapshot`, origin
`InventorySupplierSnapshot { supplierName }`, dateCreated, orderedAt, archivedAt, lineItems(connection, `lineItemId`, `sortKey:
PurchaseOrderLineItemSortKeys`, query), transfers(connection)), `InventoryPurchaseOrderLineItem` (id, purchaseOrder, inventoryItem, title,
variantTitle, supplierSku, taxPercent, unitCost, subtotal, totalCost, totalQuantity, createdAt). Roots: `inventoryPurchaseOrder(id)` and
`inventoryPurchaseOrders(first, after, ..., query)`; search filters `status:`, `name:`, `supplier:`, `destination_id:`, `created_at:`, `tag:`.

### 5.2 ShopMe extensions (write side; names prefixed)
`shopmePurchaseOrderCreate(input)`, `shopmePurchaseOrderUpdate(id, input)`, `shopmePurchaseOrderMarkAsOrdered(id)`,
`shopmePurchaseOrderClose(id)`, `shopmePurchaseOrderArchive(id)`, `shopmePurchaseOrderDelete(id)`, `shopmePurchaseOrderReceive(id,
destinationLocationId, lineItems)` (creates the linked transfer and shipment and receives in one step), supplier CRUD
`shopmeSupplierCreate/Update/Delete`, queries `shopmeSuppliers`. Payloads follow the common `userErrors { field message code }` shape with
codes: `PURCHASE_ORDER_NOT_FOUND`, `SUPPLIER_NOT_FOUND`, `LOCATION_NOT_FOUND`, `LOCATION_NOT_ACTIVE`, `ITEMS_EMPTY`, `ITEM_NOT_FOUND`,
`DUPLICATE_ITEM`, `INVALID_QUANTITY`, `INVALID_COST`, `INVALID_STATUS`, `TAG_EXCEEDS_MAX_LENGTH`, `NOTE_TOO_LONG`, `REFERENCE_TOO_LONG`,
`UNTRACKED_ITEM`. Types for these live in a clearly namespaced part of the schema so a future upstream mutation can replace them.

MVP vs later: MVP: suppliers, drafts, ordered, receiving through transfers, read-only compatible API, list and create pages, costs updating
unit cost. Later: PDF to supplier, email, CSV import/export, bulk receiving by barcode, landed costs (shipping, duties allocation), suppliers
catalog (supplier SKU per variant defaults), reorder suggestions.

## 6. Liquid and storefront impact

None (admin-only). Inventory "incoming" columns reflect ordered but unreceived quantities.

## 7. Edge cases

- Variant deleted while on an order: the line keeps its snapshot; receiving is refused for untracked or deleted items.
- Currency differs from shop currency: line costs shown in order currency, shop cost computed with the saved rate.
- Editing an ORDERED order: quantities may increase freely (incoming adjusts) and decrease down to the received quantity; supplier and
  destination are locked after any receipt.
- Zero-cost lines allowed (samples); negative cost rejected.
- Two orders for the same destination and item: incoming sums.
- Closed with outstanding units releases incoming; reopening is not supported (duplicate instead).
- Large orders: 5,000 lines max.

## 8. Test plan

- Unit: totals with tax included/excluded, weighted average cost, incoming effects on mark-as-ordered, edit, close.
- Service: receive in two shipments with a rejected unit; over-receipt confirmation; destination lock.
- API: read-only compat types/queries pagination and filter syntax; ShopMe mutations user errors.
- Admin: create page (supplier and destination pickers, product search, cost summary updates, tags and counters), list empty and filled
  states, status derivation labels.

## 9. Open questions (captures still needed)

Observed: empty list, create page (header, cost summary, details, tags).
1. **Supplier picker**: what the dropdown offers (list, "Add supplier", fields of the supplier form).
2. **Expanded** payment terms and currency chip (the chevron): extra fields (shipping carrier, tracking, expected arrival, estimated delivery).
3. **Detail page** after "Mark as ordered": buttons, received progress, receiving screen.
4. **List with data**: columns and status labels (including partially received, closed).
5. Cost summary pencil: which cost adjustments exist (shipping, customs, discount) and how they allocate to lines.
6. Payment terms options.
