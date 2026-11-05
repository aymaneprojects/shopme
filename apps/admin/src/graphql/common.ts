// Shared operations. Names/fields follow docs/spec/admin-api-mvp.md (Shopify Admin API compatible).

export const LOCATIONS = /* GraphQL */ `
  query Locations {
    locations(first: 50, sortKey: PRIORITY) { nodes { id name isActive fulfillsOnlineOrders } }
  }
`;

export const PRODUCT_FILTER_OPTIONS = /* GraphQL */ `
  query ProductFilterOptions {
    productTypes(first: 250) { edges { node } }
    productVendors(first: 250) { edges { node } }
    productTags(first: 250) { edges { node } }
  }
`;

export const TAGS_ADD = /* GraphQL */ `
  mutation TagsAdd($id: ID!, $tags: [String!]!) {
    tagsAdd(id: $id, tags: $tags) { node { id } userErrors { field message } }
  }
`;

export const TAGS_REMOVE = /* GraphQL */ `
  mutation TagsRemove($id: ID!, $tags: [String!]!) {
    tagsRemove(id: $id, tags: $tags) { node { id } userErrors { field message } }
  }
`;
