// Locations, metafields, categories, bulk editing. Names and fields follow the Shopify Admin API (ShopMe extensions are marked in the server schema).

export const LOCATIONS_ADMIN = /* GraphQL */ `
  query LocationsAdmin {
    locations(first: 100, includeInactive: true, sortKey: PRIORITY) {
      nodes { id name isActive fulfillsOnlineOrders priority isPrimary hasActiveInventory address { address1 address2 city zip countryCode phone } }
    }
  }
`;

export const LOCATION_ADD = /* GraphQL */ `
  mutation LocationAdd($input: LocationAddInput!) { locationAdd(input: $input) { location { id } userErrors { field message } } }
`;
export const LOCATION_EDIT = /* GraphQL */ `
  mutation LocationEdit($id: ID!, $input: LocationEditInput!) { locationEdit(id: $id, input: $input) { location { id } userErrors { field message } } }
`;
export const LOCATION_ACTIVATE = /* GraphQL */ `
  mutation LocationActivate($locationId: ID!) { locationActivate(locationId: $locationId) { location { id } locationActivateUserErrors { field message } } }
`;
export const LOCATION_DEACTIVATE = /* GraphQL */ `
  mutation LocationDeactivate($locationId: ID!, $destinationLocationId: ID) {
    locationDeactivate(locationId: $locationId, destinationLocationId: $destinationLocationId) { location { id } locationDeactivateUserErrors { field message } }
  }
`;
export const LOCATIONS_REORDER = /* GraphQL */ `
  mutation LocationsReorder($locationIds: [ID!]!) { shopmeLocationsReorder(locationIds: $locationIds) { locations { id priority } userErrors { field message } } }
`;
export const INVENTORY_MOVE = /* GraphQL */ `
  mutation InventoryMove($input: InventoryMoveQuantitiesInput!) {
    inventoryMoveQuantities(input: $input) { inventoryAdjustmentGroup { id } userErrors { field message } }
  }
`;
export const INVENTORY_ACTIVATE = /* GraphQL */ `
  mutation InventoryActivate($inventoryItemId: ID!, $locationId: ID!, $available: Int) {
    inventoryActivate(inventoryItemId: $inventoryItemId, locationId: $locationId, available: $available) { inventoryLevel { id } userErrors { field message } }
  }
`;

export const METAFIELD_DEFINITIONS = /* GraphQL */ `
  query MetafieldDefinitions($ownerType: MetafieldOwnerType!) {
    metafieldDefinitions(ownerType: $ownerType, first: 100) {
      nodes { id name namespace key description type { name category } pinnedPosition metafieldsCount validations { name value } }
    }
  }
`;
export const METAFIELD_DEFINITION_CREATE = /* GraphQL */ `
  mutation MetafieldDefinitionCreate($definition: MetafieldDefinitionInput!) {
    metafieldDefinitionCreate(definition: $definition) { createdDefinition { id } userErrors { field message code } }
  }
`;
export const METAFIELD_DEFINITION_UPDATE = /* GraphQL */ `
  mutation MetafieldDefinitionUpdate($definition: MetafieldDefinitionUpdateInput!) {
    metafieldDefinitionUpdate(definition: $definition) { updatedDefinition { id } userErrors { field message code } }
  }
`;
export const METAFIELD_DEFINITION_DELETE = /* GraphQL */ `
  mutation MetafieldDefinitionDelete($id: ID!, $deleteAllAssociatedMetafields: Boolean) {
    metafieldDefinitionDelete(id: $id, deleteAllAssociatedMetafields: $deleteAllAssociatedMetafields) { deletedDefinitionId userErrors { field message } }
  }
`;

/** Metafield values of any owner type the editor supports. */
export const OWNER_METAFIELDS = /* GraphQL */ `
  query OwnerMetafields($id: ID!) {
    node(id: $id) {
      id
      ... on Product { metafields(first: 100) { nodes { id namespace key type value } } }
      ... on ProductVariant { metafields(first: 100) { nodes { id namespace key type value } } }
      ... on Collection { metafields(first: 100) { nodes { id namespace key type value } } }
      ... on Customer { metafields(first: 100) { nodes { id namespace key type value } } }
      ... on Order { metafields(first: 100) { nodes { id namespace key type value } } }
    }
  }
`;
export const METAFIELDS_SET = /* GraphQL */ `
  mutation MetafieldsSet($metafields: [MetafieldsSetInput!]!) {
    metafieldsSet(metafields: $metafields) { metafields { id } userErrors { field message code } }
  }
`;

export const TAXONOMY_CATEGORIES = /* GraphQL */ `
  query TaxonomyCategories { taxonomy { categories(first: 250) { nodes { id name fullName isLeaf } } } }
`;

export const PRODUCT_DUPLICATE = /* GraphQL */ `
  mutation ProductDuplicate($productId: ID!, $newTitle: String!, $includeImages: Boolean, $newStatus: ProductStatus) {
    productDuplicate(productId: $productId, newTitle: $newTitle, includeImages: $includeImages, newStatus: $newStatus) { newProduct { id } userErrors { field message } }
  }
`;

/** Products with every variant, for the bulk editor grid. */
export const PRODUCTS_BULK = /* GraphQL */ `
  query ProductsBulk($query: String!, $locationId: ID!) {
    products(first: 100, query: $query) {
      nodes {
        id title status
        variants(first: 100) {
          nodes {
            id title sku price compareAtPrice
            inventoryItem { id tracked unitCost { amount } inventoryLevel(locationId: $locationId) { quantities(names: ["available"]) { name quantity } } }
          }
        }
      }
    }
  }
`;
