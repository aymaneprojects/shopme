// Product operations. Names/fields follow docs/spec/admin-api-mvp.md (Shopify Admin API compatible).

export const PRODUCTS = /* GraphQL */ `
  query Products($first: Int, $after: String, $last: Int, $before: String, $query: String, $sortKey: ProductSortKeys, $reverse: Boolean) {
    products(first: $first, after: $after, last: $last, before: $before, query: $query, sortKey: $sortKey, reverse: $reverse) {
      nodes {
        id title handle status vendor productType totalInventory tracksInventory
        variantsCount { count }
        featuredMedia { id ... on MediaImage { image { url } } }
      }
      pageInfo { hasNextPage hasPreviousPage startCursor endCursor }
    }
  }
`;

export const PRODUCTS_COUNT = /* GraphQL */ `
  query ProductsCount($query: String) { productsCount(query: $query) { count precision } }
`;

/** Lightweight list for pickers. */
export const PRODUCTS_PICKER = /* GraphQL */ `
  query ProductsPicker($first: Int!, $after: String, $query: String) {
    products(first: $first, after: $after, query: $query) {
      nodes { id title status featuredMedia { id ... on MediaImage { image { url } } } }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

const VARIANT_FIELDS = /* GraphQL */ `
  id title sku barcode price compareAtPrice taxable inventoryPolicy
  selectedOptions { name value }
  media(first: 1) { nodes { id } }
  unitPriceMeasurement { quantityValue quantityUnit referenceValue referenceUnit }
  inventoryItem {
    id tracked requiresShipping
    unitCost { amount }
    measurement { weight { unit value } }
    inventoryLevels(first: 50) {
      nodes { location { id name } quantities(names: ["available", "committed"]) { name quantity } }
    }
  }
`;

export const PRODUCT = /* GraphQL */ `
  query Product($id: ID!) {
    product(id: $id) {
      id title handle descriptionHtml status vendor productType tags templateSuffix updatedAt onlineStorePreviewUrl
      category { id fullName }
      seo { title description }
      options { id name position values }
      media(first: 100) { nodes { id alt mediaContentType ... on MediaImage { image { url } } } }
      collections(first: 100) { nodes { id title ruleSet { appliedDisjunctively } } }
      variants(first: 250) { nodes { ${VARIANT_FIELDS} } }
    }
  }
`;

export const PRODUCT_CREATE = /* GraphQL */ `
  mutation ProductCreate($product: ProductCreateInput!, $media: [CreateMediaInput!]) {
    productCreate(product: $product, media: $media) {
      product { id variants(first: 1) { nodes { id inventoryItem { id } } } }
      userErrors { field message }
    }
  }
`;

export const PRODUCT_UPDATE = /* GraphQL */ `
  mutation ProductUpdate($product: ProductUpdateInput!, $media: [CreateMediaInput!]) {
    productUpdate(product: $product, media: $media) {
      product { id status }
      userErrors { field message }
    }
  }
`;

export const PRODUCT_DELETE = /* GraphQL */ `
  mutation ProductDelete($input: ProductDeleteInput!) {
    productDelete(input: $input) { deletedProductId userErrors { field message } }
  }
`;

export const PRODUCT_REORDER_MEDIA = /* GraphQL */ `
  mutation ProductReorderMedia($id: ID!, $moves: [MoveInput!]!) {
    productReorderMedia(id: $id, moves: $moves) { job { id } mediaUserErrors { field message } userErrors { field message } }
  }
`;

export const PRODUCT_OPTIONS_CREATE = /* GraphQL */ `
  mutation ProductOptionsCreate($productId: ID!, $options: [OptionCreateInput!]!) {
    productOptionsCreate(productId: $productId, options: $options) {
      product { id options { id name values } }
      userErrors { field message }
    }
  }
`;

export const VARIANTS_BULK_CREATE = /* GraphQL */ `
  mutation ProductVariantsBulkCreate($productId: ID!, $variants: [ProductVariantsBulkInput!]!, $strategy: ProductVariantsBulkCreateStrategy) {
    productVariantsBulkCreate(productId: $productId, variants: $variants, strategy: $strategy) {
      productVariants { id }
      userErrors { field message }
    }
  }
`;

export const VARIANTS_BULK_UPDATE = /* GraphQL */ `
  mutation ProductVariantsBulkUpdate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
    productVariantsBulkUpdate(productId: $productId, variants: $variants) {
      productVariants { id }
      userErrors { field message }
    }
  }
`;

export const VARIANTS_BULK_DELETE = /* GraphQL */ `
  mutation ProductVariantsBulkDelete($productId: ID!, $variantsIds: [ID!]!) {
    productVariantsBulkDelete(productId: $productId, variantsIds: $variantsIds) {
      product { id }
      userErrors { field message }
    }
  }
`;
