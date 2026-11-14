// Order operations (Shopify-compatible names; see docs/spec/admin-api-mvp.md). One document per operation so a renamed field is a one-line fix.

const MONEY = 'shopMoney { amount currencyCode }';
const ADDRESS = 'firstName lastName company address1 address2 city province provinceCode zip country countryCodeV2 phone';

export const ORDERS = /* GraphQL */ `
  query Orders($first: Int, $after: String, $last: Int, $before: String, $query: String, $sortKey: OrderSortKeys, $reverse: Boolean) {
    orders(first: $first, after: $after, last: $last, before: $before, query: $query, sortKey: $sortKey, reverse: $reverse) {
      nodes {
        id name createdAt displayFinancialStatus displayFulfillmentStatus tags cancelledAt closedAt
        totalPriceSet { ${MONEY} }
        customer { id displayName }
        lineItems(first: 50) { nodes { id quantity } }
      }
      pageInfo { hasNextPage hasPreviousPage startCursor endCursor }
    }
  }
`;

export const ORDERS_COUNT = /* GraphQL */ `
  query OrdersCount($query: String) { ordersCount(query: $query) { count } }
`;

export const ORDER = /* GraphQL */ `
  query Order($id: ID!) {
    order(id: $id) {
      id name createdAt email note tags cancelledAt closedAt sourceName displayFinancialStatus displayFulfillmentStatus statusPageUrl
      lineItems(first: 100) {
        nodes {
          id title variantTitle sku quantity refundableQuantity unfulfilledQuantity requiresShipping
          originalUnitPriceSet { ${MONEY} }
          discountedTotalSet { ${MONEY} }
          variant { id image { url } }
          product { id }
        }
      }
      subtotalPriceSet { ${MONEY} }
      totalShippingPriceSet { ${MONEY} }
      totalTaxSet { ${MONEY} }
      totalDiscountsSet { ${MONEY} }
      totalPriceSet { ${MONEY} }
      totalRefundedSet { ${MONEY} }
      shippingAddress { ${ADDRESS} }
      billingAddress { ${ADDRESS} }
      shippingLines(first: 10) { nodes { title originalPriceSet { ${MONEY} } } }
      discountApplications(first: 10) { nodes { __typename ... on DiscountCodeApplication { code } } }
      transactions { id kind status gateway formattedGateway createdAt amountSet { ${MONEY} } }
      fulfillments { id name status createdAt shopmeNotifyCustomer trackingInfo { company number url } fulfillmentLineItems(first: 50) { nodes { quantity lineItem { title variantTitle sellingPlan { name } } } } }
      shopmeFulfillmentHold { reason reasonNotes heldAt }
      refunds { id createdAt note totalRefundedSet { ${MONEY} } }
      customer { id displayName defaultEmailAddress { emailAddress } numberOfOrders }
          }
  }
`;

export const ORDER_UPDATE = /* GraphQL */ `
  mutation OrderUpdate($input: OrderInput!) { orderUpdate(input: $input) { order { id note email } userErrors { field message } } }
`;
export const ORDER_CLOSE = /* GraphQL */ `
  mutation OrderClose($input: OrderCloseInput!) { orderClose(input: $input) { order { id } userErrors { field message } } }
`;
export const ORDER_OPEN = /* GraphQL */ `
  mutation OrderOpen($input: OrderOpenInput!) { orderOpen(input: $input) { order { id } userErrors { field message } } }
`;
export const ORDER_CANCEL = /* GraphQL */ `
  mutation OrderCancel($orderId: ID!, $reason: OrderCancelReason!, $refund: Boolean!, $restock: Boolean!, $notifyCustomer: Boolean, $staffNote: String) {
    orderCancel(orderId: $orderId, reason: $reason, refund: $refund, restock: $restock, notifyCustomer: $notifyCustomer, staffNote: $staffNote) {
      job { id }
      userErrors: orderCancelUserErrors { field message }
    }
  }
`;
export const TRANSACTION_VOID = /* GraphQL */ `
  mutation TransactionVoid($parentTransactionId: ID!) { transactionVoid(parentTransactionId: $parentTransactionId) { transaction { id kind status } userErrors { field message code } } }
`;
export const ORDER_MARK_AS_PAID = /* GraphQL */ `
  mutation OrderMarkAsPaid($input: OrderMarkAsPaidInput!) { orderMarkAsPaid(input: $input) { order { id } userErrors { field message } } }
`;
export const FULFILLMENT_CREATE = /* GraphQL */ `
  mutation FulfillmentCreate($fulfillment: FulfillmentInput!) { fulfillmentCreate(fulfillment: $fulfillment) { fulfillment { id status } userErrors { field message } } }
`;
export const REFUND_CREATE = /* GraphQL */ `
  mutation RefundCreate($input: RefundInput!) { refundCreate(input: $input) { refund { id } userErrors { field message } } }
`;
export const ORDER_TIMELINE_COMMENT_CREATE = /* GraphQL */ `
  mutation OrderTimelineCommentCreate($id: ID!, $message: String!) {
    orderTimelineCommentCreate(id: $id, message: $message) { event { id message createdAt } userErrors { field message } }
  }
`;
