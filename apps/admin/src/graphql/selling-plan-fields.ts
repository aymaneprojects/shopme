// Field selection shared by the product and purchase option queries. Kept out of the operations map: it is not a document on its own.

const PLAN_FIELDS = `
  id name options position
  billingPolicy { ... on SellingPlanRecurringBillingPolicy { interval intervalCount minCycles maxCycles } }
  deliveryPolicy { ... on SellingPlanRecurringDeliveryPolicy { interval intervalCount } }
  pricingPolicies {
    __typename
    ... on SellingPlanPricingPolicyBase { adjustmentType adjustmentValue { __typename ... on SellingPlanPricingPolicyPercentageValue { percentage } ... on MoneyV2 { amount } } }
    ... on SellingPlanRecurringPricingPolicy { afterCycle }
  }
`;
export const SELLING_PLAN_GROUP_FIELDS = `id name merchantCode options summary productsCount { count } sellingPlans(first: 31) { nodes { ${PLAN_FIELDS} } }`;
