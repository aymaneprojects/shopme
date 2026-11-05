// Operations added for the screen-by-screen fidelity pass.

/** Which of the selected orders can get a shipping label (awaiting one) and, for the others, whether they ship at all. */
export const LABELS_ELIGIBILITY = /* GraphQL */ `
  query OrdersLabelEligibility($ids: [ID!]!) {
    shopmeOrdersAwaitingLabel { id }
    nodes(ids: $ids) { ... on Order { id name requiresShipping } }
  }
`;

/** Collections a shipping rate can be limited to, with their product counts, and the size of the whole catalog. */
export const RATE_COLLECTIONS = /* GraphQL */ `
  query RateCollections { collections(first: 100, sortKey: TITLE) { nodes { id title productsCount { count } } } productsCount { count } }
`;
