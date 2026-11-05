// Redeem codes of a code discount: count, page through, and generate many at once (ShopMe's `shopmeDiscountCodesGenerate`).

export const DISCOUNT_CODES_PAGE = /* GraphQL */ `
  query DiscountCodesPage($id: ID!, $first: Int!, $after: String) {
    codeDiscountNode(id: $id) {
      id
      codeDiscount {
        __typename
        ... on DiscountCodeBasic { codesCount { count } codes(first: $first, after: $after) { nodes { code asyncUsageCount } pageInfo { hasNextPage endCursor } } }
        ... on DiscountCodeFreeShipping { codesCount { count } codes(first: $first, after: $after) { nodes { code asyncUsageCount } pageInfo { hasNextPage endCursor } } }
        ... on DiscountCodeBxgy { codesCount { count } codes(first: $first, after: $after) { nodes { code asyncUsageCount } pageInfo { hasNextPage endCursor } } }
      }
    }
  }
`;

export const DISCOUNT_CODES_GENERATE = /* GraphQL */ `
  mutation DiscountCodesGenerate($discountId: ID!, $count: Int!, $length: Int, $prefix: String, $suffix: String, $characterSet: ShopmeDiscountCodeCharacterSet) {
    shopmeDiscountCodesGenerate(discountId: $discountId, count: $count, length: $length, prefix: $prefix, suffix: $suffix, characterSet: $characterSet) {
      bulkCreation { id importedCount failedCount }
      userErrors { field message code }
    }
  }
`;
