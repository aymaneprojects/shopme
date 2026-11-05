// Purchase options (selling plan groups) on the product page, subscription contracts (list, detail, customer and order cards).

import { SELLING_PLAN_GROUP_FIELDS } from './selling-plan-fields';

export const PRODUCT_SELLING_PLAN_GROUPS = /* GraphQL */ `
  query ProductSellingPlanGroups($id: ID!) {
    product(id: $id) { id requiresSellingPlan sellingPlanGroups(first: 20) { nodes { ${SELLING_PLAN_GROUP_FIELDS} } } }
  }
`;
export const SELLING_PLAN_GROUPS = /* GraphQL */ `
  query SellingPlanGroups($first: Int!, $query: String) {
    sellingPlanGroups(first: $first, query: $query, sortKey: NAME) { nodes { ${SELLING_PLAN_GROUP_FIELDS} } }
  }
`;
export const SELLING_PLAN_GROUP_CREATE = /* GraphQL */ `
  mutation SellingPlanGroupCreate($input: SellingPlanGroupInput!, $resources: SellingPlanGroupResourceInput) {
    sellingPlanGroupCreate(input: $input, resources: $resources) { sellingPlanGroup { id } userErrors { field message code } }
  }
`;
export const SELLING_PLAN_GROUP_UPDATE = /* GraphQL */ `
  mutation SellingPlanGroupUpdate($id: ID!, $input: SellingPlanGroupInput!) {
    sellingPlanGroupUpdate(id: $id, input: $input) { deletedSellingPlanIds sellingPlanGroup { id } userErrors { field message code } }
  }
`;
export const SELLING_PLAN_GROUP_ADD_PRODUCTS = /* GraphQL */ `
  mutation SellingPlanGroupAddProducts($id: ID!, $productIds: [ID!]!) {
    sellingPlanGroupAddProducts(id: $id, productIds: $productIds) { sellingPlanGroup { id } userErrors { field message code } }
  }
`;
export const SELLING_PLAN_GROUP_REMOVE_PRODUCTS = /* GraphQL */ `
  mutation SellingPlanGroupRemoveProducts($id: ID!, $productIds: [ID!]!) {
    sellingPlanGroupRemoveProducts(id: $id, productIds: $productIds) { removedProductIds userErrors { field message code } }
  }
`;

const CONTRACT_ROW = `
  id status createdAt nextBillingDate lastPaymentStatus currencyCode
  customer { id displayName email }
  billingPolicy { interval intervalCount }
  lines(first: 5) { nodes { title variantTitle quantity sellingPlanName variantImage { url } } }
  linesCount { count }
  shopmeNextOrderTotal { amount currencyCode }
`;

export const SUBSCRIPTION_CONTRACTS = /* GraphQL */ `
  query SubscriptionContracts($first: Int, $after: String, $last: Int, $before: String, $query: String) {
    subscriptionContracts(first: $first, after: $after, last: $last, before: $before, query: $query, reverse: true) {
      nodes { ${CONTRACT_ROW} }
      pageInfo { hasNextPage hasPreviousPage startCursor endCursor }
    }
  }
`;
export const SUBSCRIPTION_CONTRACTS_COUNT = /* GraphQL */ `
  query SubscriptionContractsCount($query: String) { shopmeSubscriptionContractsCount(query: $query) { count } }
`;

export const SUBSCRIPTION_CONTRACT = /* GraphQL */ `
  query SubscriptionContract($id: ID!) {
    subscriptionContract(id: $id) {
      id status createdAt updatedAt nextBillingDate lastPaymentStatus lastBillingAttemptErrorType currencyCode note
      shopmePaymentGateway shopmeHasSavedPaymentMethod shopmeCyclesCompleted shopmeFailedAttempts shopmeRetryAt shopmePausedAt shopmeCancelledAt
      billingPolicy { interval intervalCount minCycles maxCycles }
      deliveryPolicy { interval intervalCount }
      deliveryPrice { amount currencyCode }
      deliveryMethod { ... on SubscriptionDeliveryMethodShipping { address { name address1 address2 city zip province country phone } shippingOption { title } } }
      customer { id displayName email phone }
      originOrder { id name }
      lines(first: 50) {
        nodes {
          id title variantTitle sku quantity sellingPlanName productId variantId
          currentPrice { amount currencyCode } lineDiscountedPrice { amount currencyCode } variantImage { url }
          pricingPolicy { basePrice { amount currencyCode } cycleDiscounts { adjustmentType afterCycle computedPrice { amount currencyCode } } }
        }
      }
      orders(first: 50) { nodes { id name createdAt displayFinancialStatus displayFulfillmentStatus totalPriceSet { shopMoney { amount currencyCode } } } }
      billingAttempts(first: 20) { nodes { id createdAt ready errorCode errorMessage order { id name } } }
      shopmeDiscounts { title code remainingCycles valueType percentage amount { amount currencyCode } }
      shopmeNextOrderTotal { amount currencyCode }
      shopmeEvents(first: 100) { nodes { __typename action message createdAt ... on Node { id } ... on BasicEvent { arguments } } }
    }
  }
`;

const STATUS_PAYLOAD = 'contract { id status nextBillingDate } userErrors { field message code }';
export const SUBSCRIPTION_CONTRACT_PAUSE = /* GraphQL */ `
  mutation SubscriptionContractPause($id: ID!) { subscriptionContractPause(subscriptionContractId: $id) { ${STATUS_PAYLOAD} } }
`;
export const SUBSCRIPTION_CONTRACT_ACTIVATE = /* GraphQL */ `
  mutation SubscriptionContractActivate($id: ID!) { subscriptionContractActivate(subscriptionContractId: $id) { ${STATUS_PAYLOAD} } }
`;
export const SUBSCRIPTION_CONTRACT_CANCEL = /* GraphQL */ `
  mutation SubscriptionContractCancel($id: ID!) { subscriptionContractCancel(subscriptionContractId: $id) { ${STATUS_PAYLOAD} } }
`;
export const SUBSCRIPTION_BILLING_CYCLE_SKIP = /* GraphQL */ `
  mutation SubscriptionBillingCycleSkip($input: SubscriptionBillingCycleInput!) {
    subscriptionBillingCycleSkip(billingCycleInput: $input) { billingCycle { cycleIndex skipped } userErrors { field message code } }
  }
`;
export const SUBSCRIPTION_BILLING_ATTEMPT_CREATE = /* GraphQL */ `
  mutation SubscriptionBillingAttemptCreate($id: ID!, $input: SubscriptionBillingAttemptInput!) {
    subscriptionBillingAttemptCreate(subscriptionContractId: $id, subscriptionBillingAttemptInput: $input) {
      subscriptionBillingAttempt { id ready errorCode errorMessage order { id name } }
      userErrors { field message code }
    }
  }
`;

export const CUSTOMER_SUBSCRIPTIONS = /* GraphQL */ `
  query CustomerSubscriptions($id: ID!) {
    customer(id: $id) { id subscriptionContracts(first: 10) { nodes { ${CONTRACT_ROW} } } }
  }
`;

export const ORDER_SUBSCRIPTIONS = /* GraphQL */ `
  query OrderSubscriptions($id: ID!) {
    order(id: $id) {
      id
      shopmeSubscriptionContracts { id status nextBillingDate originOrder { id } billingPolicy { interval intervalCount } }
      lineItems(first: 250) { nodes { id sellingPlan { name sellingPlanId } contract { id } } }
    }
  }
`;
