// Customer operations (Shopify-compatible names).

export const CUSTOMERS = /* GraphQL */ `
  query Customers($first: Int, $after: String, $last: Int, $before: String, $query: String, $sortKey: CustomerSortKeys, $reverse: Boolean) {
    customers(first: $first, after: $after, last: $last, before: $before, query: $query, sortKey: $sortKey, reverse: $reverse) {
      nodes {
        id displayName note tags numberOfOrders createdAt
        defaultEmailAddress { emailAddress marketingState }
        defaultAddress { city country countryCodeV2 }
        amountSpent { amount currencyCode }
      }
      pageInfo { hasNextPage hasPreviousPage startCursor endCursor }
    }
  }
`;

export const CUSTOMERS_COUNT = /* GraphQL */ `
  query CustomersCount($query: String) { customersCount(query: $query) { count } }
`;

export const CUSTOMER = /* GraphQL */ `
  query Customer($id: ID!) {
    customer(id: $id) {
      id displayName firstName lastName locale note tags createdAt numberOfOrders taxExempt
      defaultEmailAddress { emailAddress marketingState }
      defaultPhoneNumber { phoneNumber }
      smsMarketingConsent { marketingState }
      shopmeWhatsappMarketingConsent { marketingState }
      amountSpent { amount currencyCode }
      addressesV2(first: 10) { nodes { id firstName lastName company address1 address2 city province zip country countryCodeV2 phone } }
      orders(first: 5) {
        nodes { id name createdAt displayFinancialStatus displayFulfillmentStatus totalPriceSet { shopMoney { amount currencyCode } } }
      }
    }
  }
`;

export const CUSTOMER_CREATE = /* GraphQL */ `
  mutation CustomerCreate($input: CustomerInput!) { customerCreate(input: $input) { customer { id } userErrors { field message } } }
`;
export const CUSTOMER_UPDATE = /* GraphQL */ `
  mutation CustomerUpdate($input: CustomerInput!) { customerUpdate(input: $input) { customer { id } userErrors { field message } } }
`;
export const CUSTOMER_DELETE = /* GraphQL */ `
  mutation CustomerDelete($input: CustomerDeleteInput!) { customerDelete(input: $input) { deletedCustomerId userErrors { field message } } }
`;

/** Ids in list order, for the previous/next arrows on the customer page. */
export const CUSTOMER_IDS = /* GraphQL */ `
  query CustomerIds { customers(first: 250, sortKey: CREATED_AT, reverse: true) { nodes { id } } }
`;

/** Tags in use on the first customers, offered in the bulk tag dialog. */
export const CUSTOMER_TAGS = /* GraphQL */ `
  query CustomerTags { customers(first: 250) { nodes { id tags } } }
`;
