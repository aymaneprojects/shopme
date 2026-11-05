// Collection operations. Names/fields follow docs/spec/admin-api-mvp.md (Shopify Admin API compatible).

export const COLLECTIONS = /* GraphQL */ `
  query Collections($first: Int, $after: String, $last: Int, $before: String, $query: String, $sortKey: CollectionSortKeys, $reverse: Boolean) {
    collections(first: $first, after: $after, last: $last, before: $before, query: $query, sortKey: $sortKey, reverse: $reverse) {
      nodes {
        id title handle updatedAt
        productsCount { count } resourcePublicationsCount { count }
        image { url }
        ruleSet { appliedDisjunctively rules { column relation condition } }
      }
      pageInfo { hasNextPage hasPreviousPage startCursor endCursor }
    }
  }
`;

export const COLLECTION = /* GraphQL */ `
  query Collection($id: ID!) {
    collection(id: $id) {
      id title handle descriptionHtml sortOrder templateSuffix updatedAt
      image { url altText }
      seo { title description }
      productsCount { count }
      resourcePublicationsV2(first: 50, onlyPublished: false) { nodes { isPublished publishDate publication { id name } } }
      ruleSet { appliedDisjunctively rules { column relation condition } }
      products(first: 100) { nodes { id title status featuredMedia { id ... on MediaImage { image { url } } } } }
    }
  }
`;

export const COLLECTION_CREATE = /* GraphQL */ `
  mutation CollectionCreate($collection: CollectionCreateInput!) {
    collectionCreate(collection: $collection) {
      collection { id }
      userErrors { field message }
    }
  }
`;

export const COLLECTION_UPDATE = /* GraphQL */ `
  mutation CollectionUpdate($collection: CollectionUpdateInput!) {
    collectionUpdate(collection: $collection) {
      collection { id }
      userErrors { field message }
    }
  }
`;

export const COLLECTION_DELETE = /* GraphQL */ `
  mutation CollectionDelete($input: CollectionDeleteInput!) {
    collectionDelete(input: $input) { deletedCollectionId userErrors { field message } }
  }
`;

/** Manual membership. `collectionAddProductsV2` returns a Job; the non-deprecated `sources*` route is not needed for MVP. */
export const COLLECTION_ADD_PRODUCTS = /* GraphQL */ `
  mutation CollectionAddProducts($id: ID!, $productIds: [ID!]!) {
    collectionAddProductsV2(id: $id, productIds: $productIds) { job { id } userErrors { field message } }
  }
`;

export const COLLECTION_REMOVE_PRODUCTS = /* GraphQL */ `
  mutation CollectionRemoveProducts($id: ID!, $productIds: [ID!]!) {
    collectionRemoveProducts(id: $id, productIds: $productIds) { job { id } userErrors { field message } }
  }
`;
