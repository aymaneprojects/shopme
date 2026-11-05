/** Buying shipping labels from the carrier accounts of Settings > Shipping (rates, purchase; void is LABEL_VOID). */
const LABEL = 'id orderId orderName carrier service trackingNumber trackingUrl cost currencyCode status source fulfillmentId labelUrl labelFormat refundStatus test weightGrams createdAt';

export const LABEL_CARRIERS = /* GraphQL */ `
  query ShopmeLabelCarriers { shopmeLabelCarriers { id name provider test } }
`;
export const LABEL_RATES = /* GraphQL */ `
  query ShopmeShippingLabelRates($input: ShopmeShippingLabelRatesInput!) {
    shopmeShippingLabelRates(input: $input) {
      rates { accountId accountName test rateId service name price currencyCode estimatedDays }
      carrierErrors { accountId accountName message }
      userErrors { field message }
    }
  }
`;
export const LABEL_ESTIMATE = /* GraphQL */ `
  query ShopmeShippingLabelEstimate($input: ShopmeShippingLabelEstimateInput!) {
    shopmeShippingLabelEstimate(input: $input) {
      rates { accountId accountName test rateId service name price currencyCode estimatedDays }
      carrierErrors { accountId accountName message }
      userErrors { field message }
    }
  }
`;
export const LABEL_PURCHASE = /* GraphQL */ `
  mutation ShopmeShippingLabelPurchase($input: ShopmeShippingLabelPurchaseInput!) {
    shopmeShippingLabelPurchase(input: $input) { label { ${LABEL} } userErrors { field message } }
  }
`;
export const LABEL_ITEMS_WEIGHT = /* GraphQL */ `
  query ShopmeShippingLabelItemsWeight($orderId: ID!, $fulfillmentId: ID) { shopmeShippingLabelItemsWeight(orderId: $orderId, fulfillmentId: $fulfillmentId) }
`;
export const ORDER_LABELS = /* GraphQL */ `
  query ShopmeOrderLabels($orderId: ID!) {
    shopmeShippingLabels(orderId: $orderId, first: 50) { ${LABEL} }
    shopmeLabelCarriers { id name provider test }
    shopmeShippingPackages { id name default weight { value unit } }
  }
`;
