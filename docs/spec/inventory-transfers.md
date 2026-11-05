# Inventory transfers

Status: MVP implemented (transfers, shipments, receiving, admin list/create/detail/receive, Admin API). Open: webhooks, link-a-purchase-order picker on the create page, timeline comments, idempotency keys, bundle handling, barcode receive screen. API version studied: 2026-10. Names are listed for interoperability; behavior text is ours.
Admin screens were observed on our own development store (section 3.1). Purchase orders, which feed transfers, are in
[purchase-orders.md](purchase-orders.md).

## 1. Purpose

Move stock between two of the shop's locations and track it while it travels, without the merchant having to adjust two levels by hand.
Quantities in motion are visible as `reserved` at the origin and `incoming` at the destination.

Existing in ShopMe: `locations`, `inventory_items`, `inventory_levels` (columns `available`, `on_hand`, `committed`, `incoming`,
`reserved`, `is_active`), the append-only ledger `inventory_adjustments` (`name`, `delta`, `quantity_after`, `group_id`), inventory
admin and API (adjust, set, move quantities between states, activate). `incoming` and `reserved` exist but nothing writes them.
Missing: transfers, shipments, receiving, admin pages.

## 2. Concepts

- **Transfer** (`InventoryTransfer`): origin location, destination location, line items (inventory item and quantity), status, name
  (`#T0001` style sequence), reference name, note, tags, creation date, optional link to a purchase order.
- **Transfer status**: `DRAFT`, `READY_TO_SHIP`, `IN_PROGRESS`, `TRANSFERRED`, `CANCELED` (plus `OTHER` for forward compatibility).
- **Shipment** (`InventoryShipment`): a physical batch of a transfer's lines, with optional tracking (company, number, URL, expected arrival),
  barcode, and status `DRAFT`, `IN_TRANSIT`, `PARTIALLY_RECEIVED`, `RECEIVED`. A transfer can have several shipments (partial shipping).
- **Shipment line**: quantity shipped, and per-line counters `acceptedQuantity`, `rejectedQuantity`, `canceledQuantity`, `unreceivedQuantity`.
- **Quantity states** touched: `available`, `on_hand`, `incoming`, `reserved` (existing names in `InventoryQuantity.name`).
  `reserved` here means held for a transfer (it is distinct from `committed`, which means held for orders).
- Origin and destination must be different, active locations. Items must be tracked at both ends (an inventory level is activated at the
  destination automatically on first receipt).

## 3. Merchant-facing behavior

### 3.1 Admin screens (observed)

Navigation: Products > Transfers (siblings: Collections, Stock, Purchase orders, Gift cards).

**Transfers list.** Header with back arrow and "Transfers". With no transfers: a card with an illustration, headline "Move stock
between locations", one sentence ("move and track stock between your locations"), a primary "Create transfer" button, and a link
"Learn more about transfers". With transfers (inferred): a table with checkbox, transfer number, origin, destination, status badge, items
count, expected arrival, tags; tabs by status, search and filter bar, sort, a "Create transfer" button top right.

**Create transfer** (single page, title "Create transfer"):
- Card 1 is a left-to-right pipeline: an origin dropdown ("Select an origin" with a pin icon), an arrow, a static "In transit" step
  with a truck icon, an arrow, and a destination dropdown ("Select a destination"). Below a divider: a product search field
  ("Search products to add") with two icon buttons at the right: import (a download-style icon: add lines from a CSV) and barcode scan
  (focuses a scan input that adds a line per scanned barcode). Search results are variants with image, title, SKU and the available
  quantity at the chosen origin; adding a line puts it into a table (product, SKU, quantity input, remove).
- Card "Transfer details": a row with the creation date (a chip showing the current date, opens a date picker), then four link rows with
  icons: "Add a reference name", "Add a note", "Add tags", "Link a purchase order". Each expands into an input in place.
- Footer actions (not in capture): "Save as draft" and "Mark as ready to ship" (primary), disabled until origin, destination and at least
  one line exist.

**Transfer detail page** (not captured, designed from the API): header with transfer name and status badge; "Mark as ready to ship" /
"Ship items" / "Receive items" buttons depending on status; lines table with ordered, shipped, received, rejected columns; shipment cards
with tracking fields and a "Receive" action; timeline with comments; side column with origin, destination, reference, tags, note, linked
purchase order; "More actions": duplicate, cancel, delete (draft only).

### 3.2 Lifecycle and quantity effects

All stock changes are written to `inventory_adjustments` under one `group_id` per action and use reason `transfer`; every step is atomic.

| Step | Origin level | Destination level |
|---|---|---|
| Create as DRAFT | none | none |
| Mark as ready to ship (`READY_TO_SHIP`) | available -N, reserved +N | incoming +N |
| Create a shipment (DRAFT) from lines | none (quantity picked for shipment) | none |
| Mark shipment in transit (shipment `IN_TRANSIT`, transfer `IN_PROGRESS`) | reserved -N, on_hand -N | none |
| Receive accepted units | none | incoming -n, available +n, on_hand +n |
| Receive rejected units | none | incoming -n (units leave the books; merchant adjusts) |
| Cancel unreceived units (line canceled) | none | incoming -n (units leave the books) |
| Cancel a READY_TO_SHIP transfer (no shipment) | reserved -N, available +N | incoming -N |
| Delete a DRAFT transfer | none | none |

Transfer status derives from lines: `DRAFT` until marked ready; `READY_TO_SHIP` while nothing is in transit; `IN_PROGRESS` once any
shipment is in transit or partially received; `TRANSFERRED` when every line's shipped quantity is fully resolved (accepted + rejected +
canceled equals shipped) and shipped equals ordered (or the remainder was removed); `CANCELED` when canceled before any shipment. Shipments:
`DRAFT` until `markInTransit`; `IN_TRANSIT` until the first receipt; `PARTIALLY_RECEIVED` while unreceived quantity is above zero after
receipts; `RECEIVED` when all lines are resolved.

Rules:
- Quantity requested must be at least 1 and no more than the origin's `available` when the transfer becomes ready to ship (checked then,
  not at draft time; drafts can exceed stock).
- Editing lines (`inventoryTransferSetItems`, `inventoryTransferRemoveItems`) is allowed in DRAFT and READY_TO_SHIP (the reserved and
  incoming quantities adjust by the delta; shipped quantities can never be reduced below what is already shipped).
- Changing origin or destination is allowed only in DRAFT (`TRANSFER_LOCATION_IMMUTABLE` otherwise).
- A transfer linked to a purchase order has the supplier as virtual origin: no origin level changes (see purchase-orders.md); it can
  only be received.
- Deactivating a location with open transfers is refused until they are received or canceled.
- A receipt can be partial any number of times; `bulkReceiveAction` receives every remaining unit with one reason.
- Duplicate: copies lines and details into a new DRAFT.
- Events: each step adds a timeline event; comments allowed (`CommentEventSubject`).
- Webhooks: `inventory_transfers/*` topics later; MVP emits `inventory_levels/update` for each level change (existing).

## 4. Data model proposal (Drizzle)

```ts
export const inventoryTransfers = pgTable('inventory_transfers', {
  id: pk(), shopId: shopFk(),
  name: text('name').notNull(),                          // '#T0001' from sequences('transfer')
  status: text('status').notNull().default('DRAFT'),      // DRAFT | READY_TO_SHIP | IN_PROGRESS | TRANSFERRED | CANCELED
  originLocationId: ref('origin_location_id').references(() => locations.id, { onDelete: 'restrict' }),
  destinationLocationId: ref('destination_location_id').references(() => locations.id, { onDelete: 'restrict' }),
  originSnapshot: jsonb('origin_snapshot'),               // { name, address } frozen once leaving DRAFT (API LocationSnapshot)
  destinationSnapshot: jsonb('destination_snapshot'),
  purchaseOrderId: ref('purchase_order_id'),              // optional link
  referenceName: text('reference_name'), note: text('note'), tags: tagsCol(),
  dateCreated: timestamp('date_created', { withTimezone: true }).notNull().defaultNow(),  // user-editable date
  ...timestamps(),
}, (t) => [uniqueIndex('inventory_transfers_name_uq').on(t.shopId, t.name), index('inventory_transfers_status_idx').on(t.shopId, t.status)]);

export const inventoryTransferLines = pgTable('inventory_transfer_lines', {
  id: pk(), shopId: shopFk(),
  transferId: ref('transfer_id').notNull().references(() => inventoryTransfers.id, { onDelete: 'cascade' }),
  inventoryItemId: ref('inventory_item_id').notNull().references(() => inventoryItems.id),
  title: text('title'),                                   // snapshot of product/variant title
  totalQuantity: integer('total_quantity').notNull(),
  pickedForShipmentQuantity: integer('picked_for_shipment_quantity').notNull().default(0),   // in DRAFT shipments
  shippedQuantity: integer('shipped_quantity').notNull().default(0),
}, (t) => [uniqueIndex('inventory_transfer_lines_uq').on(t.transferId, t.inventoryItemId)]);

export const inventoryShipments = pgTable('inventory_shipments', {
  id: pk(), shopId: shopFk(),
  transferId: ref('transfer_id').notNull().references(() => inventoryTransfers.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),                           // '#T0001-S1'
  status: text('status').notNull().default('DRAFT'),     // DRAFT | IN_TRANSIT | PARTIALLY_RECEIVED | RECEIVED
  barcode: text('barcode'),
  trackingCompany: text('tracking_company'), trackingNumber: text('tracking_number'), trackingUrl: text('tracking_url'), arrivesAt: ts('arrives_at'),
  dateCreated: ts('date_created'), dateShipped: ts('date_shipped'), dateReceived: ts('date_received'),
}, (t) => [uniqueIndex('inventory_shipments_barcode_uq').on(t.shopId, t.barcode)]);

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
});
```

`unreceivedQuantity` is computed (`quantity - accepted - rejected - canceled`). Name sequences reuse `sequences` (`transfer`, starts at 1).
`inventory_adjustments.name` already holds the quantity name; add `reason` values `transfer_ready`, `transfer_ship`, `transfer_receive`,
`transfer_cancel` and `reference_document_uri` = the transfer GID (the ledger has `groupId`; check for an existing reference column when
implementing). Idempotency: the shipment and transfer create/receive mutations accept an `@idempotent`-style key header
(`Idempotency-Key`) stored in a small table `idempotency_keys(shop_id, key, request_hash, response)`; MVP can ignore it and answer the
`IDEMPOTENCY_*` codes only for the key table.

## 5. Admin GraphQL surface

### 5.1 Types (MVP)
`InventoryTransfer` (id, name, status, dateCreated, origin and destination `LocationSnapshot`, lineItems(connection), lineItemsCount,
totalQuantity, receivedQuantity, referenceName, note, tags, shipments(connection), events, hasTimelineComment, metafield(s)),
`InventoryTransferLineItem` (id, inventoryItem, title, totalQuantity, shippableQuantity, shippedQuantity, pickedForShipmentQuantity,
processableQuantity), `InventoryTransferLineItemUpdate` (inventoryItemId, newQuantity, deltaQuantity), `InventoryShipment` (id, name, status,
barcode, dateCreated, dateShipped, dateReceived, tracking, lineItems(connection), lineItemsCount, lineItemTotalQuantity,
totalAcceptedQuantity, totalRejectedQuantity, totalCanceledQuantity, totalReceivedQuantity), `InventoryShipmentLineItem` (id, inventoryItem,
quantity, acceptedQuantity, rejectedQuantity, canceledQuantity, unreceivedQuantity, createdAt), `InventoryShipmentTracking`
(company, trackingNumber, trackingUrl, arrivesAt), `LocationSnapshot`, connections. Enums: `InventoryTransferStatus`, `InventoryShipmentStatus`,
`InventoryShipmentReceiveLineItemReason` (ACCEPTED, REJECTED, CANCELED), `TransferSortKeys` (CREATED_AT, DESTINATION_NAME,
EXPECTED_SHIPMENT_ARRIVAL, ID, NAME, ORIGIN_NAME, SOURCE_NAME, STATUS), `InventoryShipmentSortKeys` (CREATED_AT, ID, STATUS),
`ShipmentLineItemSortKeys`. `InventoryLevel.quantities(names:)` must return `incoming` and `reserved` correctly.

### 5.2 Roots
`inventoryTransfer(id)`, `inventoryTransfers(first, sortKey, query, savedSearchId)`, `inventoryShipment(id)`, `inventoryShipments(...)`.
Transfer search: `status:`, `name:`, `origin_id:`, `destination_id:`, `tag:`, `created_at:`, `reference_name:`, `product_id:`.

### 5.3 Mutations
MVP (all names exist in the reference schema): `inventoryTransferCreate(input)`, `inventoryTransferCreateAsReadyToShip(input)`,
`inventoryTransferEdit(id, input)`, `inventoryTransferSetItems(input { id, lineItems })`, `inventoryTransferRemoveItems(input { id,
transferLineItemIds })`, `inventoryTransferMarkAsReadyToShip(id)`, `inventoryTransferCancel(id)`, `inventoryTransferDelete(id)`,
`inventoryTransferDuplicate(id)`, `inventoryShipmentCreate(input)`, `inventoryShipmentCreateInTransit(input)`,
`inventoryShipmentMarkInTransit(id, dateShipped)`, `inventoryShipmentAddItems(id, lineItems)`, `inventoryShipmentRemoveItems(id, lineItems)`,
`inventoryShipmentUpdateItemQuantities(id, items)`, `inventoryShipmentReceive(id, lineItems, dateReceived, bulkReceiveAction)`,
`inventoryShipmentDelete(id)`, `inventoryShipmentSetTracking(id, tracking)`, `inventoryShipmentSetBarcode(id, barcode)`.
Inputs: `InventoryTransferCreateInput { originLocationId, destinationLocationId, lineItems: [{inventoryItemId, quantity}], dateCreated, note,
tags, referenceName, metafields }`; `InventoryTransferEditInput { originId, destinationId, dateCreated, note, tags, referenceName,
metafields }`; `InventoryShipmentCreateInput { movementId (the transfer id), trackingInput { trackingNumber, company, trackingUrl, arrivesAt },
lineItems: [{inventoryItemId, quantity}], dateCreated, barcode }`; `InventoryShipmentReceiveItemInput { shipmentLineItemId, quantity, reason }`.
Existing `inventoryMoveQuantities` stays as the instant, single-location state mover.
Later: webhooks, bundle handling, CSV import of lines, ShopMe extension `shopmeInventoryTransferReceiveAll`.

### 5.4 userErrors
Every payload has a typed error with `code`, `field`, `message`. Codes to emit, per mutation family:
- Create / CreateAsReadyToShip: `LOCATION_NOT_FOUND`, `LOCATION_NOT_ACTIVE`, `LOCATION_REQUIRED`, `TRANSFER_ORIGIN_CANNOT_BE_THE_SAME_AS_DESTINATION`,
  `ITEMS_EMPTY` (ready-to-ship only), `ITEM_NOT_FOUND`, `UNTRACKED_ITEM`, `BUNDLED_ITEM`, `INVALID_QUANTITY`, `DUPLICATE_ITEM`,
  `INVENTORY_STATE_NOT_ACTIVE`, `TAG_EXCEEDS_MAX_LENGTH`, `INVALID_TAG`, `INVALID_METAFIELDS`, `INVALID_TRANSFER_STATUS`, `TRANSFER_NOT_FOUND`.
- Edit: `TRANSFER_NOT_FOUND`, `TRANSFER_LOCATION_IMMUTABLE`, `TRANSFER_ORIGIN_CANNOT_BE_THE_SAME_AS_DESTINATION`, `LOCATION_NOT_FOUND`,
  `LOCATION_NOT_ACTIVE`, `INVENTORY_STATE_NOT_ACTIVE`, tag and metafield codes, `INTERNAL_ERROR`.
- SetItems / RemoveItems: `TRANSFER_NOT_FOUND`, `INVALID_TRANSFER_STATUS`, `ITEM_NOT_FOUND`, `INVALID_QUANTITY`, `UNTRACKED_ITEM`,
  `LOCATION_NOT_FOUND`, `LOCATION_NOT_ACTIVE`, `ALL_QUANTITY_SHIPPED`, `CANT_REMOVE_ALL_ITEMS_FROM_READY_TO_SHIP_TRANSFER`,
  `ITEM_PRESENT_ON_DRAFT_SHIPMENT_WITH_ZERO_QUANTITY`.
- MarkAsReadyToShip: `INVALID_ITEM`, `INVALID_TRANSFER_STATUS`, `ITEMS_EMPTY`, `LOCATION_NOT_ACTIVE`, `LOCATION_NOT_FOUND`, `LOCATION_REQUIRED`,
  `TRANSFER_NOT_FOUND`. Cancel: `INVALID_TRANSFER_STATUS`, `SHIPMENT_EXISTS`, `TRANSFER_NOT_FOUND`. Delete: `INVALID_STATE`,
  `INVALID_TRANSFER_STATUS`, `TRANSFER_NOT_FOUND`. Duplicate: `TRANSFER_NOT_FOUND`, `INVALID_QUANTITY`.
- Shipment create: `BARCODE_DUPLICATE`, `BARCODE_TOO_LONG`, `EMPTY_SHIPMENT_INPUT`, `ITEM_NOT_FOUND`, `TRANSFER_NOT_FOUND`,
  `INVALID_TRANSFER_STATUS`, `INVALID_QUANTITY`, `UNTRACKED_ITEM`, `DUPLICATE_ITEM`, `INVALID_SHIPMENT_INPUT`, `INVALID_URL`, `LOCATION_NOT_ACTIVE`;
  receive/others: `SHIPMENT_NOT_FOUND`, `INVALID_SHIPMENT_STATUS`, `INVENTORY_STATE_NOT_ACTIVE`, `LOCATION_NOT_FOUND`, `LOCATION_NOT_ACTIVE`,
  `ITEM_NOT_FOUND`, `INVALID_QUANTITY`, `ACTIVATION_FAILED`, `INTERNAL_ERROR`.
- `IDEMPOTENCY_*` codes are emitted only if idempotency keys are implemented.

MVP vs later: MVP covers everything above (transfers, shipments, receiving, ledger, admin list/create/detail, API). Later: webhooks,
barcode scanning receive screen, CSV line import, shipment labels, cost tracking, purchase order receiving shortcuts.

## 6. Liquid and storefront impact

None directly. Storefront availability (`variant.available`, `inventory_quantity`, pickup availability) uses `available` only, so stock
in transit does not count until received. Order routing ignores `incoming`. Admin low-stock and inventory reports gain "Incoming" and
"Reserved" columns (existing admin inventory table shows them as editable-state columns; wire them to real data).

## 7. Edge cases

- Same item twice in a request: `DUPLICATE_ITEM`; across shipments of one transfer allowed until the line total is used.
- Shipping more than ordered or more than remaining shippable: `INVALID_QUANTITY`.
- Origin runs out between ready-to-ship and shipping because of sales: reservation prevents it (available is reduced at ready time).
- Receiving into a location where the item level is inactive: activate it (`ACTIVATION_FAILED` if the location is inactive).
- Receiving more than the unreceived quantity: error; receiving zero is a no-op error `INVALID_QUANTITY`.
- Cancel after partial shipping is refused (`SHIPMENT_EXISTS`); remove or receive remaining units instead; the transfer completes when the
  remainder is removed (`RemoveItems` of unshipped lines).
- Items deleted or untracked after the transfer was created: the transfer keeps its snapshot title; ready-to-ship/receive fail on untracked.
- Time zones: dates shown in shop zone; stored UTC.
- Large transfers: 10,000 lines per transfer maximum; the line pickers paginate.
- Location with open transfers cannot be deleted or deactivated (extend existing location mutations).

## 8. Test plan

- Unit: status derivation from line and shipment counters; quantity effects table above for every step and cancel path; ledger group ids.
- Service: concurrent ready-to-ship against sales (no oversell), partial receive sequences, reject/cancel receipts, remove remainder completes.
- API conformance: each mutation's payload and error codes, connection fields, query/sort, `quantities(names:["incoming","reserved"])`.
- Admin: create transfer form (location pipeline, product search, barcode input, date and details rows), list states, detail actions by status.
- Migration: none (new tables); backfill transfer sequence.

## 9. Open questions (captures still needed)

Observed: empty list, create page. Remaining:
1. **Transfer detail page** after creation in each status (draft, ready to ship, in progress): action buttons, lines table, shipment cards,
   timeline.
2. **Receive items** screen: per-line inputs for accepted, rejected and the reason or "cancel" option, "receive all" button.
3. **List with data**: columns, tabs, bulk actions, filters.
4. What happens to **rejected** and **canceled** units on the books (back to origin? flagged in a log?) via an API probe on a reference store:
   read `inventoryLevel.quantities` before/after receiving with a rejected quantity.
5. Draft with quantity above stock: warning text in the lines table.
6. Link-a-purchase-order picker (see purchase-orders.md).
