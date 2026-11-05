// Inventory operations. Names/fields follow docs/spec/admin-api-mvp.md (Shopify Admin API compatible).

export const INVENTORY_VARIANTS = /* GraphQL */ `
  query InventoryVariants($first: Int, $after: String, $last: Int, $before: String, $query: String) {
    productVariants(first: $first, after: $after, last: $last, before: $before, query: $query, sortKey: INVENTORY_LEVELS_AVAILABLE) {
      nodes {
        id title sku
        product { id title featuredMedia { id ... on MediaImage { image { url } } } }
        inventoryItem {
          id tracked
          inventoryLevels(first: 50) {
            nodes { location { id name } quantities(names: ["available", "committed", "on_hand", "incoming", "reserved"]) { name quantity } }
          }
        }
      }
      pageInfo { hasNextPage hasPreviousPage startCursor endCursor }
    }
  }
`;

export const INVENTORY_SET_QUANTITIES = /* GraphQL */ `
  mutation InventorySetQuantities($input: InventorySetQuantitiesInput!) {
    inventorySetQuantities(input: $input) {
      inventoryAdjustmentGroup { id }
      userErrors { field message }
    }
  }
`;

export const INVENTORY_ADJUST_QUANTITIES = /* GraphQL */ `
  mutation InventoryAdjustQuantities($input: InventoryAdjustQuantitiesInput!) {
    inventoryAdjustQuantities(input: $input) {
      inventoryAdjustmentGroup { id }
      userErrors { field message }
    }
  }
`;
