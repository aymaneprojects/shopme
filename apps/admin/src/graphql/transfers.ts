// Inventory transfers, shipments, suppliers and purchase orders. Transfer and shipment names follow the Admin API; purchase order
// writes and supplier operations are ShopMe extensions (`shopme*`).

const ERRORS = 'userErrors { field message code }';

const TRANSFER_LIST_FIELDS = `
  id name status dateCreated referenceName tags totalQuantity receivedQuantity
  origin { name } destination { name }
  shipments(first: 20) { nodes { id tracking { arrivesAt } } }
`;

export const TRANSFERS = /* GraphQL */ `
  query Transfers($first: Int, $after: String, $last: Int, $before: String, $query: String, $sortKey: TransferSortKeys, $reverse: Boolean) {
    inventoryTransfers(first: $first, after: $after, last: $last, before: $before, query: $query, sortKey: $sortKey, reverse: $reverse) {
      nodes { ${TRANSFER_LIST_FIELDS} }
      pageInfo { hasNextPage hasPreviousPage startCursor endCursor }
    }
  }
`;

export const TRANSFER_COUNT = /* GraphQL */ `
  query TransferCount($query: String) { shopmeInventoryTransfersCount(query: $query) { count } }
`;

const SHIPMENT_FIELDS = `
  id name status barcode dateCreated dateShipped dateReceived
  tracking { company trackingNumber trackingUrl arrivesAt }
  lineItemTotalQuantity totalAcceptedQuantity totalRejectedQuantity totalCanceledQuantity totalReceivedQuantity
  lineItems(first: 250) { nodes { id quantity acceptedQuantity rejectedQuantity canceledQuantity unreceivedQuantity inventoryItem { id sku variant { id title product { id title } } } } }
`;

export const TRANSFER = /* GraphQL */ `
  query Transfer($id: ID!) {
    inventoryTransfer(id: $id) {
      id name status dateCreated referenceName note tags totalQuantity receivedQuantity shopmePurchaseOrderId
      origin { name location { id } address { formatted } }
      destination { name location { id } address { formatted } }
      lineItems(first: 250) {
        nodes {
          id title totalQuantity shippableQuantity shippedQuantity pickedForShipmentQuantity processableQuantity
          inventoryItem { id sku variant { id title product { id title } } }
        }
      }
      shipments(first: 50) { nodes { ${SHIPMENT_FIELDS} } }
    }
  }
`;

export const TRANSFER_SHIPMENT = /* GraphQL */ `
  query TransferShipment($id: ID!) {
    inventoryShipment(id: $id) {
      ${SHIPMENT_FIELDS}
      shopmeTransfer { id name status origin { name } destination { name } }
    }
  }
`;

/** Variant search for the "Search products to add" field, with the stock at each location. */
export const STOCK_VARIANT_SEARCH = /* GraphQL */ `
  query StockVariantSearch($query: String) {
    productVariants(first: 20, query: $query) {
      nodes {
        id title sku
        product { id title featuredMedia { id ... on MediaImage { image { url } } } }
        inventoryItem {
          id tracked unitCost { amount currencyCode }
          inventoryLevels(first: 50) { nodes { location { id } quantities(names: ["available", "incoming"]) { name quantity } } }
        }
      }
    }
  }
`;

export const TRANSFER_LOCATIONS = /* GraphQL */ `
  query TransferLocations { locations(first: 100, sortKey: PRIORITY) { nodes { id name isActive } } }
`;

const TRANSFER_PAYLOAD = `inventoryTransfer { id name status } ${ERRORS}`;

export const TRANSFER_CREATE = /* GraphQL */ `
  mutation TransferCreate($input: InventoryTransferCreateInput!) { inventoryTransferCreate(input: $input) { ${TRANSFER_PAYLOAD} } }
`;
export const TRANSFER_CREATE_READY = /* GraphQL */ `
  mutation TransferCreateReady($input: InventoryTransferCreateAsReadyToShipInput!) { inventoryTransferCreateAsReadyToShip(input: $input) { ${TRANSFER_PAYLOAD} } }
`;
export const TRANSFER_EDIT = /* GraphQL */ `
  mutation TransferEdit($id: ID!, $input: InventoryTransferEditInput!) { inventoryTransferEdit(id: $id, input: $input) { ${TRANSFER_PAYLOAD} } }
`;
export const TRANSFER_SET_ITEMS = /* GraphQL */ `
  mutation TransferSetItems($input: InventoryTransferSetItemsInput!) { inventoryTransferSetItems(input: $input) { inventoryTransfer { id } updatedLineItems { inventoryItemId newQuantity } ${ERRORS} } }
`;
export const TRANSFER_REMOVE_ITEMS = /* GraphQL */ `
  mutation TransferRemoveItems($input: InventoryTransferRemoveItemsInput!) { inventoryTransferRemoveItems(input: $input) { inventoryTransfer { id } ${ERRORS} } }
`;
export const TRANSFER_READY = /* GraphQL */ `
  mutation TransferReady($id: ID!) { inventoryTransferMarkAsReadyToShip(id: $id) { ${TRANSFER_PAYLOAD} } }
`;
export const TRANSFER_CANCEL = /* GraphQL */ `
  mutation TransferCancel($id: ID!) { inventoryTransferCancel(id: $id) { ${TRANSFER_PAYLOAD} } }
`;
export const TRANSFER_DELETE = /* GraphQL */ `
  mutation TransferDelete($id: ID!) { inventoryTransferDelete(id: $id) { deletedId ${ERRORS} } }
`;
export const TRANSFER_DUPLICATE = /* GraphQL */ `
  mutation TransferDuplicate($id: ID!) { inventoryTransferDuplicate(id: $id) { ${TRANSFER_PAYLOAD} } }
`;
export const SHIPMENT_CREATE = /* GraphQL */ `
  mutation ShipmentCreate($input: InventoryShipmentCreateInput!) { inventoryShipmentCreate(input: $input) { inventoryShipment { id name status } ${ERRORS} } }
`;
export const SHIPMENT_CREATE_IN_TRANSIT = /* GraphQL */ `
  mutation ShipmentCreateInTransit($input: InventoryShipmentCreateInput!) { inventoryShipmentCreateInTransit(input: $input) { inventoryShipment { id name status } ${ERRORS} } }
`;
export const SHIPMENT_MARK_IN_TRANSIT = /* GraphQL */ `
  mutation ShipmentMarkInTransit($id: ID!) { inventoryShipmentMarkInTransit(id: $id) { inventoryShipment { id status } ${ERRORS} } }
`;
export const SHIPMENT_RECEIVE = /* GraphQL */ `
  mutation ShipmentReceive($id: ID!, $lineItems: [InventoryShipmentReceiveItemInput!], $bulkReceiveAction: InventoryShipmentReceiveLineItemReason) {
    inventoryShipmentReceive(id: $id, lineItems: $lineItems, bulkReceiveAction: $bulkReceiveAction) { inventoryShipment { id status } ${ERRORS} }
  }
`;
export const SHIPMENT_SET_TRACKING = /* GraphQL */ `
  mutation ShipmentSetTracking($id: ID!, $tracking: InventoryShipmentTrackingInput!) { inventoryShipmentSetTracking(id: $id, tracking: $tracking) { inventoryShipment { id } ${ERRORS} } }
`;
export const SHIPMENT_DELETE = /* GraphQL */ `
  mutation ShipmentDelete($id: ID!) { inventoryShipmentDelete(id: $id) { id ${ERRORS} } }
`;

/* ------------------------------ suppliers and purchase orders ------------------------------ */

export const SUPPLIERS = /* GraphQL */ `
  query Suppliers($query: String) {
    shopmeSuppliers(first: 100, query: $query) { nodes { id name contactName email phone currencyCode paymentTerms note } }
  }
`;
export const SUPPLIER_CREATE = /* GraphQL */ `
  mutation SupplierCreate($input: ShopmeSupplierInput!) { shopmeSupplierCreate(input: $input) { supplier { id name currencyCode paymentTerms } ${ERRORS} } }
`;
export const SUPPLIER_UPDATE = /* GraphQL */ `
  mutation SupplierUpdate($id: ID!, $input: ShopmeSupplierInput!) { shopmeSupplierUpdate(id: $id, input: $input) { supplier { id name } ${ERRORS} } }
`;

const PO_LIST_FIELDS = `
  id name status shopmeState dateCreated orderedAt shopmeReferenceNumber shopmeExpectedArrival shopmeTags
  origin { supplierName } destination { name }
  shopmeTotalQuantity shopmeReceivedQuantity shopmeRejectedQuantity
  shopmeTotals { total { amount currencyCode } }
`;

export const PURCHASE_ORDERS = /* GraphQL */ `
  query PurchaseOrders($first: Int, $after: String, $last: Int, $before: String, $query: String, $sortKey: ShopmePurchaseOrderSortKeys, $reverse: Boolean) {
    inventoryPurchaseOrders(first: $first, after: $after, last: $last, before: $before, query: $query, sortKey: $sortKey, reverse: $reverse) {
      nodes { ${PO_LIST_FIELDS} }
      pageInfo { hasNextPage hasPreviousPage startCursor endCursor }
    }
  }
`;

export const PURCHASE_ORDER = /* GraphQL */ `
  query PurchaseOrder($id: ID!) {
    inventoryPurchaseOrder(id: $id) {
      ${PO_LIST_FIELDS}
      currency archivedAt shopmeClosedAt shopmeSupplierNote shopmePaymentTerms shopmeTaxesIncluded shopmeExchangeRate shopmeCarrier shopmeDestinationLocationId
      shopmeSupplier { id name }
      shopmeTotals { variantsCount itemsCount subtotal { amount } taxes { amount } shipping { amount } other { amount } total { amount currencyCode } }
      lineItems(first: 250) {
        nodes {
          id title variantTitle supplierSku totalQuantity taxPercent shopmeSku shopmeReceivedQuantity shopmeRejectedQuantity shopmeOutstandingQuantity
          unitCost { amount } subtotal { amount } totalCost { amount }
          inventoryItem { id sku variant { id product { featuredMedia { id ... on MediaImage { image { url } } } } } }
        }
      }
      transfers(first: 50) { nodes { id name status totalQuantity receivedQuantity dateCreated } }
    }
  }
`;

const PO_PAYLOAD = `shopmePurchaseOrder { id name shopmeState status } ${ERRORS}`;
export const PURCHASE_ORDER_CREATE = /* GraphQL */ `
  mutation PurchaseOrderCreate($input: ShopmePurchaseOrderInput!) { shopmePurchaseOrderCreate(input: $input) { ${PO_PAYLOAD} } }
`;
export const PURCHASE_ORDER_UPDATE = /* GraphQL */ `
  mutation PurchaseOrderUpdate($id: ID!, $input: ShopmePurchaseOrderInput!) { shopmePurchaseOrderUpdate(id: $id, input: $input) { ${PO_PAYLOAD} } }
`;
export const PURCHASE_ORDER_ORDERED = /* GraphQL */ `
  mutation PurchaseOrderOrdered($id: ID!) { shopmePurchaseOrderMarkAsOrdered(id: $id) { ${PO_PAYLOAD} } }
`;
export const PURCHASE_ORDER_CLOSE = /* GraphQL */ `
  mutation PurchaseOrderClose($id: ID!) { shopmePurchaseOrderClose(id: $id) { ${PO_PAYLOAD} } }
`;
export const PURCHASE_ORDER_ARCHIVE = /* GraphQL */ `
  mutation PurchaseOrderArchive($id: ID!, $archive: Boolean) { shopmePurchaseOrderArchive(id: $id, archive: $archive) { ${PO_PAYLOAD} } }
`;
export const PURCHASE_ORDER_DELETE = /* GraphQL */ `
  mutation PurchaseOrderDelete($id: ID!) { shopmePurchaseOrderDelete(id: $id) { deletedId ${ERRORS} } }
`;
export const PURCHASE_ORDER_DUPLICATE = /* GraphQL */ `
  mutation PurchaseOrderDuplicate($id: ID!) { shopmePurchaseOrderDuplicate(id: $id) { ${PO_PAYLOAD} } }
`;
export const PURCHASE_ORDER_RECEIVE = /* GraphQL */ `
  mutation PurchaseOrderReceive($id: ID!, $input: ShopmePurchaseOrderReceiveInput!) {
    shopmePurchaseOrderReceive(id: $id, input: $input) { shopmePurchaseOrder { id shopmeState } inventoryTransferId inventoryShipmentId ${ERRORS} }
  }
`;
