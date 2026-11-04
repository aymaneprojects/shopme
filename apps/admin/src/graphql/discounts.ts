// Code discount operations (Shopify-compatible names; DiscountCodeBasic covers amount-off order/products).

const COMMON = `
  title status startsAt endsAt usageLimit asyncUsageCount appliesOncePerCustomer summary
  codes(first: 1) { nodes { code } }
  combinesWith { productDiscounts orderDiscounts shippingDiscounts }
`;
const MIN = `
  minimumRequirement {
    __typename
    ... on DiscountMinimumSubtotal { greaterThanOrEqualToSubtotal { amount } }
    ... on DiscountMinimumQuantity { greaterThanOrEqualToQuantity }
  }
`;

export const CODE_DISCOUNT_NODES = /* GraphQL */ `
  query CodeDiscountNodes($first: Int, $after: String, $last: Int, $before: String, $query: String) {
    codeDiscountNodes(first: $first, after: $after, last: $last, before: $before, query: $query) {
      nodes {
        id
        codeDiscount {
          __typename
          ... on DiscountCodeBasic { ${COMMON} }
          ... on DiscountCodeFreeShipping { ${COMMON} }
        }
      }
      pageInfo { hasNextPage hasPreviousPage startCursor endCursor }
    }
  }
`;

export const CODE_DISCOUNT_NODE = /* GraphQL */ `
  query CodeDiscountNode($id: ID!) {
    codeDiscountNode(id: $id) {
      id
      codeDiscount {
        __typename
        ... on DiscountCodeBasic {
          ${COMMON}
          customerGets {
            value {
              __typename
              ... on DiscountPercentage { percentage }
              ... on DiscountAmount { amount { amount } appliesOnEachItem }
            }
            items {
              __typename
              ... on AllDiscountItems { allItems }
              ... on DiscountCollections { collections(first: 100) { nodes { id title } } }
              ... on DiscountProducts { products(first: 100) { nodes { id title } } }
            }
          }
          ${MIN}
        }
        ... on DiscountCodeFreeShipping {
          ${COMMON}
          maximumShippingPrice { amount }
          ${MIN}
        }
      }
    }
  }
`;

export const DISCOUNT_CODE_BASIC_CREATE = /* GraphQL */ `
  mutation DiscountCodeBasicCreate($basicCodeDiscount: DiscountCodeBasicInput!) {
    discountCodeBasicCreate(basicCodeDiscount: $basicCodeDiscount) { codeDiscountNode { id } userErrors { field message } }
  }
`;
export const DISCOUNT_CODE_BASIC_UPDATE = /* GraphQL */ `
  mutation DiscountCodeBasicUpdate($id: ID!, $basicCodeDiscount: DiscountCodeBasicInput!) {
    discountCodeBasicUpdate(id: $id, basicCodeDiscount: $basicCodeDiscount) { codeDiscountNode { id } userErrors { field message } }
  }
`;
export const DISCOUNT_CODE_FREE_SHIPPING_CREATE = /* GraphQL */ `
  mutation DiscountCodeFreeShippingCreate($freeShippingCodeDiscount: DiscountCodeFreeShippingInput!) {
    discountCodeFreeShippingCreate(freeShippingCodeDiscount: $freeShippingCodeDiscount) { codeDiscountNode { id } userErrors { field message } }
  }
`;
export const DISCOUNT_CODE_FREE_SHIPPING_UPDATE = /* GraphQL */ `
  mutation DiscountCodeFreeShippingUpdate($id: ID!, $freeShippingCodeDiscount: DiscountCodeFreeShippingInput!) {
    discountCodeFreeShippingUpdate(id: $id, freeShippingCodeDiscount: $freeShippingCodeDiscount) { codeDiscountNode { id } userErrors { field message } }
  }
`;
export const DISCOUNT_CODE_ACTIVATE = /* GraphQL */ `
  mutation DiscountCodeActivate($id: ID!) { discountCodeActivate(id: $id) { codeDiscountNode { id } userErrors { field message } } }
`;
export const DISCOUNT_CODE_DEACTIVATE = /* GraphQL */ `
  mutation DiscountCodeDeactivate($id: ID!) { discountCodeDeactivate(id: $id) { codeDiscountNode { id } userErrors { field message } } }
`;
export const DISCOUNT_CODE_DELETE = /* GraphQL */ `
  mutation DiscountCodeDelete($id: ID!) { discountCodeDelete(id: $id) { deletedCodeDiscountId userErrors { field message } } }
`;
