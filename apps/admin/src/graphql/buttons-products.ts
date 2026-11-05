// Sales channels, catalogs and inventory helpers for the product pages (ShopMe extensions are prefixed `shopme`).

export const PUBLICATIONS = /* GraphQL */ `
  query Publications { publications(first: 50) { nodes { id name shopmeKind shopmeProductsCount shopmeCollectionsCount } } }
`;

export const PRODUCT_PUBLICATIONS = /* GraphQL */ `
  query ProductPublications($id: ID!) {
    product(id: $id) {
      id
      resourcePublicationsV2(first: 50, onlyPublished: false) { nodes { isPublished publishDate publication { id name } } }
    }
  }
`;

export const COLLECTION_PUBLICATIONS = /* GraphQL */ `
  query CollectionPublications($id: ID!) {
    collection(id: $id) {
      id
      resourcePublicationsV2(first: 50, onlyPublished: false) { nodes { isPublished publishDate publication { id name } } }
    }
  }
`;

export const PUBLISHABLE_PUBLISH = /* GraphQL */ `
  mutation PublishablePublish($id: ID!, $input: [PublicationInput!]!) {
    publishablePublish(id: $id, input: $input) { publishable { ... on Product { id } ... on Collection { id } } userErrors { field message } }
  }
`;

export const PUBLISHABLE_UNPUBLISH = /* GraphQL */ `
  mutation PublishableUnpublish($id: ID!, $input: [PublicationInput!]!) {
    publishableUnpublish(id: $id, input: $input) { publishable { ... on Product { id } ... on Collection { id } } userErrors { field message } }
  }
`;

export const CATALOGS_PICKER = /* GraphQL */ `
  query CatalogsPicker { catalogs(first: 100, type: MARKET) { nodes { id title status } } }
`;

export const PRODUCT_CATALOGS = /* GraphQL */ `
  query ProductCatalogs($id: ID!) { product(id: $id) { id shopmeCatalogs { id title status } } }
`;

export const CATALOG_PRODUCTS_UPDATE = /* GraphQL */ `
  mutation CatalogProductsUpdate($productIds: [ID!]!, $include: [ID!], $exclude: [ID!]) {
    shopmeCatalogProductsUpdate(productIds: $productIds, include: $include, exclude: $exclude) { added removed userErrors { field message } }
  }
`;

export const INVENTORY_ITEM_HISTORY = /* GraphQL */ `
  query InventoryItemHistory($id: ID!) { inventoryItem(id: $id) { id shopmeHistory(first: 20) { id name delta quantityAfter reason createdAt locationName } } }
`;

export const INVENTORY_DEACTIVATE = /* GraphQL */ `
  mutation InventoryDeactivate($inventoryLevelId: ID!) { inventoryDeactivate(inventoryLevelId: $inventoryLevelId) { userErrors { field message } } }
`;

export const TAXONOMY_ROOT_CATEGORIES = /* GraphQL */ `
  query TaxonomyRootCategories { taxonomy { categories(first: 250) { nodes { id name fullName } } } }
`;

export const COLLECTIONS_PICKER_OPTIONS = /* GraphQL */ `
  query CollectionsPickerOptions { collections(first: 250) { nodes { id title } } }
`;
