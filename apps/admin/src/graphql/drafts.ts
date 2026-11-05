// Draft orders (Orders > Drafts).

const MONEY = 'shopMoney { amount currencyCode }';
const TOTALS = `subtotalPriceSet { ${MONEY} } totalDiscountsSet { ${MONEY} } totalShippingPriceSet { ${MONEY} } totalTaxSet { ${MONEY} } totalPriceSet { ${MONEY} }`;

export const DRAFT_ORDERS = /* GraphQL */ `
  query DraftOrders($first: Int, $after: String, $last: Int, $before: String, $query: String) {
    draftOrders(first: $first, after: $after, last: $last, before: $before, query: $query) {
      nodes { id name status email createdAt totalPriceSet { ${MONEY} } customer { id displayName } }
      pageInfo { hasNextPage hasPreviousPage startCursor endCursor }
    }
  }
`;
export const DRAFT_ORDER = /* GraphQL */ `
  query DraftOrder($id: ID!) {
    draftOrder(id: $id) {
      id name status email note2 tags invoiceSentAt ${TOTALS}
      customer { id displayName }
      order { id name }
      appliedDiscount { valueType value }
      shippingLine { title originalPriceSet { ${MONEY} } }
      lineItems(first: 100) { nodes { id title variantTitle quantity variant { id } originalUnitPriceSet { ${MONEY} } } }
    }
  }
`;
export const DRAFT_ORDER_CREATE = /* GraphQL */ `
  mutation DraftOrderCreate($input: DraftOrderInput!) { draftOrderCreate(input: $input) { draftOrder { id } userErrors { field message } } }
`;
export const DRAFT_ORDER_UPDATE = /* GraphQL */ `
  mutation DraftOrderUpdate($id: ID!, $input: DraftOrderInput!) { draftOrderUpdate(id: $id, input: $input) { draftOrder { id } userErrors { field message } } }
`;
export const DRAFT_ORDER_DELETE = /* GraphQL */ `
  mutation DraftOrderDelete($input: DraftOrderDeleteInput!) { draftOrderDelete(input: $input) { deletedId userErrors { field message } } }
`;
export const DRAFT_ORDER_CALCULATE = /* GraphQL */ `
  mutation DraftOrderCalculate($input: DraftOrderInput!) { draftOrderCalculate(input: $input) { calculatedDraftOrder { ${TOTALS} } userErrors { field message } } }
`;
export const DRAFT_ORDER_COMPLETE = /* GraphQL */ `
  mutation DraftOrderComplete($id: ID!, $paymentPending: Boolean) { draftOrderComplete(id: $id, paymentPending: $paymentPending) { draftOrder { id order { id } } userErrors { field message } } }
`;
export const DRAFT_ORDER_INVOICE_SEND = /* GraphQL */ `
  mutation DraftOrderInvoiceSend($id: ID!, $email: EmailInput) { draftOrderInvoiceSend(id: $id, email: $email) { draftOrder { id } userErrors { field message } } }
`;
export const DRAFT_VARIANT_SEARCH = /* GraphQL */ `
  query DraftVariantSearch($query: String) {
    products(first: 30, query: $query) {
      nodes { id title featuredMedia { id ... on MediaImage { image { url } } } variants(first: 50) { nodes { id title price inventoryQuantity inventoryItem { tracked } } } }
    }
  }
`;
export const DRAFT_CUSTOMER_SEARCH = /* GraphQL */ `
  query DraftCustomerSearch($query: String) {
    customers(first: 10, query: $query) { nodes { id displayName defaultEmailAddress { emailAddress } } }
  }
`;
