// Orders, home and shell additions: list columns, stats strip, batches, labels, bulk actions, order page extras, marketing and channels.

const MONEY = 'shopMoney { amount currencyCode }';

export const ORDERS_LIST = /* GraphQL */ `
  query OrdersList($first: Int, $after: String, $last: Int, $before: String, $query: String, $sortKey: OrderSortKeys, $reverse: Boolean) {
    orders(first: $first, after: $after, last: $last, before: $before, query: $query, sortKey: $sortKey, reverse: $reverse) {
      nodes {
        id name createdAt displayFinancialStatus displayFulfillmentStatus tags cancelledAt closedAt sourceName poNumber test capturable requiresShipping
        totalPriceSet { ${MONEY} }
        customer { id displayName }
        lineItems(first: 50) { nodes { id title quantity } }
        shopmeAddressProblems shopmeDeliveryStatus shopmeDeliveryMethod shopmeFulfillBy
        shopmeBatch { id name }
        shopmeLocation { id name }
      }
      pageInfo { hasNextPage hasPreviousPage startCursor endCursor }
    }
  }
`;

export const ORDERS_STATS = /* GraphQL */ `
  query ShopmeOrdersStats($from: DateTime!, $to: DateTime!, $locationId: ID) {
    shopmeOrdersStats(from: $from, to: $to, locationId: $locationId) { currencyCode buckets metrics { key value previous series } }
  }
`;

export const ORDERS_FILTER_OPTIONS = /* GraphQL */ `
  query OrdersFilterOptions { locations(first: 50, sortKey: PRIORITY) { nodes { id name isActive } } shopmeOrderBatches { id name orderCount } }
`;

export const ORDERS_MARK_AS = /* GraphQL */ `
  mutation ShopmeOrdersMarkAs($ids: [ID!]!, $status: ShopmeOrderMarkAs!) {
    shopmeOrdersMarkAs(ids: $ids, status: $status) { succeeded results { orderId ok message } userErrors { field message } }
  }
`;
export const ORDERS_CAPTURE = /* GraphQL */ `
  mutation ShopmeOrdersCapture($ids: [ID!]!) {
    shopmeOrdersCapture(ids: $ids) { succeeded results { orderId ok message } userErrors { field message } }
  }
`;

export const BATCHES = /* GraphQL */ `query ShopmeOrderBatches { shopmeOrderBatches { id name orderCount createdAt } }`;
export const BATCH_CREATE = /* GraphQL */ `
  mutation ShopmeOrderBatchCreate($name: String, $orderIds: [ID!]!) { shopmeOrderBatchCreate(name: $name, orderIds: $orderIds) { batch { id name orderCount } userErrors { field message } } }
`;
export const BATCH_MOVE = /* GraphQL */ `
  mutation ShopmeOrdersMoveToBatch($batchId: ID, $orderIds: [ID!]!) { shopmeOrdersMoveToBatch(batchId: $batchId, orderIds: $orderIds) { moved userErrors { field message } } }
`;
export const BATCH_DELETE = /* GraphQL */ `
  mutation ShopmeOrderBatchDelete($id: ID!) { shopmeOrderBatchDelete(id: $id) { deletedId userErrors { field message } } }
`;

/* ------------------------------ order page ------------------------------ */

export const ORDER_EXTRAS = /* GraphQL */ `
  query OrderExtras($id: ID!) {
    order(id: $id) {
      id test confirmationNumber capturable poNumber shopmeFulfillBy
      shopmeAddressProblems
      shopmeRisk { level score signals { code weight detail } }
      shopmeConversion { visits firstVisitAt landingPath lastVisitPath referrer utmSource utmMedium utmCampaign }
      shopmeLocation { id name }
      shopmeBatch { id name }
      shopmeDeliveryStatus
    }
  }
`;

export const ORDER_COMMENT_CREATE = /* GraphQL */ `
  mutation OrderTimelineCommentCreateWithFiles($id: ID!, $message: String!, $attachments: [String!]) {
    orderTimelineCommentCreate(id: $id, message: $message, attachments: $attachments) { event { ... on Node { id } } userErrors { field message } }
  }
`;

export const ORDER_SET_FULFILL_BY = /* GraphQL */ `
  mutation OrderSetFulfillBy($input: OrderInput!) { orderUpdate(input: $input) { order { id shopmeFulfillBy poNumber } userErrors { field message } } }
`;

export const ORDER_EDIT_ADD_CUSTOM_ITEM = /* GraphQL */ `
  mutation OrderEditAddCustomItem($id: ID!, $title: String!, $price: MoneyInput!, $quantity: Int!, $taxable: Boolean, $requiresShipping: Boolean) {
    orderEditAddCustomItem(id: $id, title: $title, price: $price, quantity: $quantity, taxable: $taxable, requiresShipping: $requiresShipping) { calculatedOrder { ...Calc } userErrors { field message } }
  }
  fragment Calc on CalculatedOrder {
    id totalPriceSet { ${MONEY} } subtotalPriceSet { ${MONEY} } totalOutstandingSet { ${MONEY} } shopmeShippingFeeSet { ${MONEY} } shopmeOrderDiscountSet { ${MONEY} } shopmeShippingFeeTitle shopmeOrderDiscountDescription
    lineItems(first: 100) { nodes { id title variantTitle sku quantity editableQuantity editableQuantityBeforeChanges hasStagedLineItemDiscount variant { id } image { url } originalUnitPriceSet { ${MONEY} } discountedUnitPriceSet { ${MONEY} } editableSubtotalSet { ${MONEY} } } }
  }
`;
export const ORDER_EDIT_ADD_SHIPPING = /* GraphQL */ `
  mutation OrderEditAddShippingLine($id: ID!, $shippingLine: OrderEditAddShippingLineInput!) {
    orderEditAddShippingLine(id: $id, shippingLine: $shippingLine) { calculatedOrder { ...Calc } userErrors { field message } }
  }
  fragment Calc on CalculatedOrder {
    id totalPriceSet { ${MONEY} } subtotalPriceSet { ${MONEY} } totalOutstandingSet { ${MONEY} } shopmeShippingFeeSet { ${MONEY} } shopmeOrderDiscountSet { ${MONEY} } shopmeShippingFeeTitle shopmeOrderDiscountDescription
    lineItems(first: 100) { nodes { id title variantTitle sku quantity editableQuantity editableQuantityBeforeChanges hasStagedLineItemDiscount variant { id } image { url } originalUnitPriceSet { ${MONEY} } discountedUnitPriceSet { ${MONEY} } editableSubtotalSet { ${MONEY} } } }
  }
`;
export const ORDER_EDIT_SET_ORDER_DISCOUNT = /* GraphQL */ `
  mutation ShopmeOrderEditSetOrderDiscount($id: ID!, $discount: OrderEditAppliedDiscountInput) {
    shopmeOrderEditSetOrderDiscount(id: $id, discount: $discount) { calculatedOrder { ...Calc } userErrors { field message } }
  }
  fragment Calc on CalculatedOrder {
    id totalPriceSet { ${MONEY} } subtotalPriceSet { ${MONEY} } totalOutstandingSet { ${MONEY} } shopmeShippingFeeSet { ${MONEY} } shopmeOrderDiscountSet { ${MONEY} } shopmeShippingFeeTitle shopmeOrderDiscountDescription
    lineItems(first: 100) { nodes { id title variantTitle sku quantity editableQuantity editableQuantityBeforeChanges hasStagedLineItemDiscount variant { id } image { url } originalUnitPriceSet { ${MONEY} } discountedUnitPriceSet { ${MONEY} } editableSubtotalSet { ${MONEY} } } }
  }
`;

/* ------------------------------ shipping labels ------------------------------ */

export const LABELS_PAGE = /* GraphQL */ `
  query ShopmeShippingLabelsPage($status: String) {
    shopmeShippingLabels(status: $status, first: 100) { id orderId orderName carrier service trackingNumber trackingUrl cost currencyCode status source labelUrl refundStatus test createdAt }
    shopmeShippingLabelsCount { count }
    shopmeOrdersAwaitingLabel { id name createdAt totalPriceSet { ${MONEY} } customer { displayName } shippingAddress { city country countryCodeV2 } lineItems(first: 20) { nodes { quantity } } }
  }
`;
export const LABEL_CREATE = /* GraphQL */ `
  mutation ShopmeShippingLabelCreate($input: ShopmeShippingLabelInput!) {
    shopmeShippingLabelCreate(input: $input) { label { id orderName carrier trackingNumber } userErrors { field message } }
  }
`;
export const LABEL_VOID = /* GraphQL */ `
  mutation ShopmeShippingLabelVoid($id: ID!) { shopmeShippingLabelVoid(id: $id) { label { id status refundStatus } userErrors { field message } } }
`;
export const ORDER_LABEL_PRINT = /* GraphQL */ `
  query OrderForLabel($id: ID!) {
    order(id: $id) { id name shippingAddress { firstName lastName company address1 address2 city province zip country phone } lineItems(first: 100) { nodes { title variantTitle quantity } } }
  }
`;

/* ------------------------------ bulk print ------------------------------ */

export const ORDER_FOR_PRINT = /* GraphQL */ `
  query OrderForPrint($id: ID!) {
    order(id: $id) {
      id name createdAt email
      lineItems(first: 100) { nodes { title variantTitle sku quantity originalUnitPriceSet { ${MONEY} } discountedTotalSet { ${MONEY} } } }
      subtotalPriceSet { ${MONEY} } totalShippingPriceSet { ${MONEY} } totalTaxSet { ${MONEY} } totalPriceSet { ${MONEY} }
      shippingAddress { firstName lastName company address1 address2 city province zip country phone }
      billingAddress { firstName lastName company address1 address2 city province zip country phone }
    }
  }
`;

/* ------------------------------ home, marketing, channels ------------------------------ */

export const MARKETING_PAGE = /* GraphQL */ `
  query ShopmeMarketing($from: DateTime!, $to: DateTime!) {
    shopmeMarketingCampaigns { id name channel status utmSource utmMedium utmCampaign budget startsAt endsAt notes orders sales createdAt }
    shopmeAttribution(from: $from, to: $to) { totalOrders attributedOrders totalSales rows { source medium campaign orders visits sales } }
  }
`;
export const CAMPAIGN_CREATE = /* GraphQL */ `
  mutation ShopmeMarketingCampaignCreate($input: ShopmeMarketingCampaignInput!) { shopmeMarketingCampaignCreate(input: $input) { campaign { id } userErrors { field message } } }
`;
export const CAMPAIGN_UPDATE = /* GraphQL */ `
  mutation ShopmeMarketingCampaignUpdate($id: ID!, $input: ShopmeMarketingCampaignInput!) { shopmeMarketingCampaignUpdate(id: $id, input: $input) { campaign { id } userErrors { field message } } }
`;
export const CAMPAIGN_DELETE = /* GraphQL */ `
  mutation ShopmeMarketingCampaignDelete($id: ID!) { shopmeMarketingCampaignDelete(id: $id) { deletedId userErrors { field message } } }
`;

export const CHANNELS = /* GraphQL */ `query ShopmeSalesChannels { shopmeSalesChannels { handle kind active products publishedProducts orders sales } }`;
export const CHANNEL_PUBLISH_ALL = /* GraphQL */ `
  mutation ShopmeSalesChannelPublishAll($handle: String!, $publish: Boolean!) { shopmeSalesChannelPublishAll(handle: $handle, publish: $publish) { changed userErrors { field message } } }
`;

/* ------------------------------ drafts ------------------------------ */

export const DRAFT_MARKETS = /* GraphQL */ `query DraftMarkets { markets(first: 100) { nodes { id name status currencySettings { baseCurrency { currencyCode } } } } shop { currencyCode } }`;
