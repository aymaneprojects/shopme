// Saved views of the lists, the products metrics strip and bulk inventory item updates.

const VIEW_FIELDS = 'id name query params resourceType';
const viewsQuery = (name: string, field: string) => /* GraphQL */ `query ${name} { views: ${field}(first: 50) { nodes { ${VIEW_FIELDS} } } }`;

export const SAVED_VIEWS_PRODUCT = viewsQuery('ProductSavedViews', 'productSavedSearches');
export const SAVED_VIEWS_ORDER = viewsQuery('OrderSavedViews', 'orderSavedSearches');
export const SAVED_VIEWS_CUSTOMER = viewsQuery('CustomerSavedViews', 'customerSavedSearches');
export const SAVED_VIEWS_INVENTORY = viewsQuery('InventorySavedViews', 'inventorySavedSearches');

export const SAVED_SEARCH_CREATE = /* GraphQL */ `
  mutation SavedSearchCreate($input: SavedSearchCreateInput!) {
    savedSearchCreate(input: $input) { savedSearch { ${VIEW_FIELDS} } userErrors { field message } }
  }
`;

export const SAVED_SEARCH_UPDATE = /* GraphQL */ `
  mutation SavedSearchUpdate($input: SavedSearchUpdateInput!) {
    savedSearchUpdate(input: $input) { savedSearch { ${VIEW_FIELDS} } userErrors { field message } }
  }
`;

export const SAVED_SEARCH_DELETE = /* GraphQL */ `
  mutation SavedSearchDelete($input: SavedSearchDeleteInput!) {
    savedSearchDelete(input: $input) { deletedSavedSearchId userErrors { field message } }
  }
`;

export const PRODUCT_METRICS = /* GraphQL */ `
  query ProductMetrics($days: Int) {
    shopmeProductMetrics(days: $days) { days unitsSold unitsInStock sellThroughRate daysOfStockLeft unsold abc { a b c } }
  }
`;

export const INVENTORY_ITEM_TRACKING = /* GraphQL */ `
  mutation InventoryItemTracking($id: ID!, $tracked: Boolean!) {
    inventoryItemUpdate(id: $id, input: { tracked: $tracked }) { inventoryItem { id tracked } userErrors { field message } }
  }
`;

export const ORDER_GIFT_CARDS = /* GraphQL */ `
  query OrderGiftCards($id: ID!) {
    order(id: $id) { id shopmeIssuedGiftCards { id maskedCode enabled balance { amount currencyCode } initialValue { amount currencyCode } } }
  }
`;

export const ORDER_UNFULFILLED_LINES = /* GraphQL */ `
  query OrderUnfulfilledLines($id: ID!) { order(id: $id) { id lineItems(first: 100) { nodes { id unfulfilledQuantity } } } }
`;
