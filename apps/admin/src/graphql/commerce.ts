// Wave 7a: gift cards, abandoned checkouts, order edits and returns, automatic / BXGY discounts.

const MONEY = 'shopMoney { amount currencyCode }';
const PAGE_INFO = 'pageInfo { hasNextPage hasPreviousPage startCursor endCursor }';

/* ------------------------------ gift cards ------------------------------ */

const GIFT_CARD_FIELDS = `
  id enabled isRedeemable expiresOn createdAt deactivatedAt lastCharacters maskedCode note
  balance { amount currencyCode } initialValue { amount currencyCode }
  customer { id displayName }
  order { id name }
  recipientAttributes { recipient { id displayName } }
`;

export const GIFT_CARDS = /* GraphQL */ `
  query GiftCards($first: Int, $after: String, $last: Int, $before: String, $query: String, $sortKey: GiftCardSortKeys, $reverse: Boolean) {
    giftCards(first: $first, after: $after, last: $last, before: $before, query: $query, sortKey: $sortKey, reverse: $reverse) {
      nodes { ${GIFT_CARD_FIELDS} }
      ${PAGE_INFO}
    }
  }
`;

export const GIFT_CARD = /* GraphQL */ `
  query GiftCard($id: ID!) {
    giftCard(id: $id) {
      ${GIFT_CARD_FIELDS}
      recipientAttributes { message preferredName recipient { id displayName } }
      transactions(first: 50) { nodes { __typename id amount { amount currencyCode } note processedAt } }
    }
  }
`;

export const GIFT_CARD_CREATE = /* GraphQL */ `
  mutation GiftCardCreate($input: GiftCardCreateInput!) {
    giftCardCreate(input: $input) { giftCard { id } giftCardCode userErrors { field message code } }
  }
`;
export const GIFT_CARD_UPDATE = /* GraphQL */ `
  mutation GiftCardUpdate($id: ID!, $input: GiftCardUpdateInput!) { giftCardUpdate(id: $id, input: $input) { giftCard { id } userErrors { field message code } } }
`;
export const GIFT_CARD_DEACTIVATE = /* GraphQL */ `
  mutation GiftCardDeactivate($id: ID!) { giftCardDeactivate(id: $id) { giftCard { id enabled } userErrors { field message code } } }
`;
export const GIFT_CARD_CREDIT = /* GraphQL */ `
  mutation GiftCardCredit($id: ID!, $creditInput: GiftCardCreditInput!) {
    giftCardCredit(id: $id, creditInput: $creditInput) { giftCardCreditTransaction { id } userErrors { field message code } }
  }
`;
export const GIFT_CARD_DEBIT = /* GraphQL */ `
  mutation GiftCardDebit($id: ID!, $debitInput: GiftCardDebitInput!) {
    giftCardDebit(id: $id, debitInput: $debitInput) { giftCardDebitTransaction { id } userErrors { field message code } }
  }
`;
export const GIFT_CARD_SEND_TO_RECIPIENT = /* GraphQL */ `
  mutation GiftCardSendNotificationToRecipient($id: ID!) { giftCardSendNotificationToRecipient(id: $id) { giftCard { id } userErrors { field message } } }
`;
export const GIFT_CARD_SEND_TO_CUSTOMER = /* GraphQL */ `
  mutation GiftCardSendNotificationToCustomer($id: ID!) { giftCardSendNotificationToCustomer(id: $id) { giftCard { id } userErrors { field message } } }
`;

/* ------------------------------ abandoned checkouts ------------------------------ */

export const ABANDONED_CHECKOUTS = /* GraphQL */ `
  query AbandonedCheckouts($first: Int, $after: String, $last: Int, $before: String, $query: String, $reverse: Boolean) {
    abandonedCheckouts(first: $first, after: $after, last: $last, before: $before, query: $query, reverse: $reverse, sortKey: ID) {
      nodes {
        id name createdAt updatedAt lineItemsQuantity shopmeEmail shopmeRecoveryEmailsSent shopmeRecoveryEmailSentAt
        customer { id displayName defaultEmailAddress { emailAddress } }
        totalPriceSet { ${MONEY} }
      }
      ${PAGE_INFO}
    }
  }
`;

export const ABANDONED_CHECKOUT = /* GraphQL */ `
  query AbandonedCheckout($id: ID!) {
    node(id: $id) {
      ... on AbandonedCheckout {
        id name createdAt updatedAt abandonedCheckoutUrl discountCodes taxesIncluded shopmeEmail shopmeRecoveryEmailsSent shopmeRecoveryEmailSentAt
        customer { id displayName defaultEmailAddress { emailAddress } }
        shippingAddress { firstName lastName company address1 address2 city province zip country phone }
        lineItems(first: 100) { nodes { id title variantTitle sku quantity image { url } originalUnitPriceSet { ${MONEY} } discountedTotalPriceSet { ${MONEY} } } }
        totalLineItemsPriceSet { ${MONEY} } totalDiscountSet { ${MONEY} } totalTaxSet { ${MONEY} } totalPriceSet { ${MONEY} }
      }
    }
  }
`;

export const ABANDONED_SETTINGS = /* GraphQL */ `
  query ShopmeAbandonedCheckoutSettings { shopmeAbandonedCheckoutSettings { enabled delayHours } }
`;
export const ABANDONED_SETTINGS_UPDATE = /* GraphQL */ `
  mutation ShopmeAbandonedCheckoutSettingsUpdate($enabled: Boolean, $delayHours: Int) {
    shopmeAbandonedCheckoutSettingsUpdate(enabled: $enabled, delayHours: $delayHours) { settings { enabled delayHours } userErrors { field message } }
  }
`;
export const ABANDONED_SEND_EMAIL = /* GraphQL */ `
  mutation ShopmeAbandonedCheckoutRecoveryEmailSend($id: ID!) {
    shopmeAbandonedCheckoutRecoveryEmailSend(id: $id) { abandonedCheckout { id shopmeRecoveryEmailsSent } userErrors { field message } }
  }
`;

/* ------------------------------ order editing ------------------------------ */

const CALCULATED = `
  id
  totalPriceSet { ${MONEY} } subtotalPriceSet { ${MONEY} } totalOutstandingSet { ${MONEY} }
  lineItems(first: 100) {
    nodes {
      id title variantTitle sku quantity editableQuantity editableQuantityBeforeChanges hasStagedLineItemDiscount
      image { url } originalUnitPriceSet { ${MONEY} } discountedUnitPriceSet { ${MONEY} } editableSubtotalSet { ${MONEY} }
    }
  }
`;

export const ORDER_EDIT_BEGIN = /* GraphQL */ `
  mutation OrderEditBegin($id: ID!) { orderEditBegin(id: $id) { calculatedOrder { ${CALCULATED} originalOrder { id name } } userErrors { field message } } }
`;
export const ORDER_EDIT_ADD_VARIANT = /* GraphQL */ `
  mutation OrderEditAddVariant($id: ID!, $variantId: ID!, $quantity: Int!) {
    orderEditAddVariant(id: $id, variantId: $variantId, quantity: $quantity) { calculatedOrder { ${CALCULATED} } userErrors { field message } }
  }
`;
export const ORDER_EDIT_SET_QUANTITY = /* GraphQL */ `
  mutation OrderEditSetQuantity($id: ID!, $lineItemId: ID!, $quantity: Int!, $restock: Boolean) {
    orderEditSetQuantity(id: $id, lineItemId: $lineItemId, quantity: $quantity, restock: $restock) { calculatedOrder { ${CALCULATED} } userErrors { field message } }
  }
`;
export const ORDER_EDIT_ADD_LINE_ITEM_DISCOUNT = /* GraphQL */ `
  mutation OrderEditAddLineItemDiscount($id: ID!, $lineItemId: ID!, $discount: OrderEditAppliedDiscountInput!) {
    orderEditAddLineItemDiscount(id: $id, lineItemId: $lineItemId, discount: $discount) { calculatedOrder { ${CALCULATED} } userErrors { field message } }
  }
`;
export const ORDER_EDIT_COMMIT = /* GraphQL */ `
  mutation OrderEditCommit($id: ID!, $notifyCustomer: Boolean, $staffNote: String) {
    orderEditCommit(id: $id, notifyCustomer: $notifyCustomer, staffNote: $staffNote) { order { id } successMessages userErrors { field message } }
  }
`;
export const ORDER_EDIT_DISCARD = /* GraphQL */ `
  mutation ShopmeOrderEditDiscard($id: ID!) { shopmeOrderEditDiscard(id: $id) { discarded userErrors { field message } } }
`;

/* ------------------------------ returns ------------------------------ */

export const ORDER_RETURNS = /* GraphQL */ `
  query OrderReturns($id: ID!) {
    order(id: $id) {
      id returnStatus
      lineItems(first: 100) { nodes { id title variantTitle shopmeReturnableQuantity } }
      returns(first: 50) {
        nodes {
          id name status createdAt totalQuantity
          returnLineItems(first: 50) { nodes { quantity returnReason ... on ReturnLineItem { shopmeTitle shopmeVariantTitle shopmeRestockType shopmeRestocked } } }
        }
      }
    }
  }
`;
export const RETURN_CREATE = /* GraphQL */ `
  mutation ReturnCreate($returnInput: ReturnInput!) { returnCreate(returnInput: $returnInput) { return { id name } userErrors { field message code } } }
`;
export const RETURN_APPROVE_REQUEST = /* GraphQL */ `
  mutation ReturnApproveRequest($input: ReturnApproveRequestInput!) { returnApproveRequest(input: $input) { return { id status } userErrors { field message } } }
`;
export const RETURN_CLOSE = /* GraphQL */ `
  mutation ReturnClose($id: ID!) { returnClose(id: $id) { return { id status } userErrors { field message } } }
`;

/* ------------------------------ discounts: all types, code and automatic ------------------------------ */

const DISC_COMMON = `title status startsAt endsAt summary asyncUsageCount combinesWith { productDiscounts orderDiscounts shippingDiscounts }`;
const DISC_MIN = `minimumRequirement { __typename ... on DiscountMinimumSubtotal { greaterThanOrEqualToSubtotal { amount } } ... on DiscountMinimumQuantity { greaterThanOrEqualToQuantity } }`;
const DISC_ITEMS = `
  items {
    __typename
    ... on AllDiscountItems { allItems }
    ... on DiscountCollections { collections(first: 100) { nodes { id title } } }
    ... on DiscountProducts { products(first: 100) { nodes { id title } } }
  }
`;
const DISC_BXGY = (alias: string) => `
  ${alias}: usesPerOrderLimit
  customerBuys { value { __typename ... on DiscountQuantity { quantity } } ${DISC_ITEMS} }
  customerGets {
    value { __typename ... on DiscountOnQuantity { quantity { quantity } effect { __typename ... on DiscountPercentage { percentage } ... on DiscountAmount { amount { amount } } } } }
    ${DISC_ITEMS}
  }
`;
const DISC_GETS = `
  customerGets {
    value { __typename ... on DiscountPercentage { percentage } ... on DiscountAmount { amount { amount } appliesOnEachItem } }
    ${DISC_ITEMS}
  }
`;

/** Every discount (code and automatic), for the list. */
export const DISCOUNT_NODES = /* GraphQL */ `
  query DiscountNodes($first: Int, $after: String, $last: Int, $before: String, $query: String) {
    discountNodes(first: $first, after: $after, last: $last, before: $before, query: $query) {
      nodes {
        id
        discount {
          __typename
          ... on DiscountCodeBasic { title status startsAt endsAt usageLimit asyncUsageCount summary codes(first: 1) { nodes { code } } }
          ... on DiscountCodeBxgy { title status startsAt endsAt usageLimit asyncUsageCount summary codes(first: 1) { nodes { code } } }
          ... on DiscountCodeFreeShipping { title status startsAt endsAt usageLimit asyncUsageCount summary codes(first: 1) { nodes { code } } }
          ... on DiscountAutomaticBasic { title status startsAt endsAt asyncUsageCount summary }
          ... on DiscountAutomaticBxgy { title status startsAt endsAt asyncUsageCount summary }
          ... on DiscountAutomaticFreeShipping { title status startsAt endsAt asyncUsageCount summary }
        }
      }
      pageInfo { hasNextPage hasPreviousPage startCursor endCursor }
    }
  }
`;

export const DISCOUNT_NODE = /* GraphQL */ `
  query DiscountNode($id: ID!) {
    discountNode(id: $id) {
      id
      discount {
        __typename
        ... on DiscountCodeBasic { ${DISC_COMMON} usageLimit appliesOncePerCustomer codes(first: 1) { nodes { code } } ${DISC_GETS} ${DISC_MIN} }
        ... on DiscountCodeBxgy { ${DISC_COMMON} usageLimit appliesOncePerCustomer codes(first: 1) { nodes { code } } ${DISC_BXGY('usesPerOrderCode')} }
        ... on DiscountCodeFreeShipping { ${DISC_COMMON} usageLimit appliesOncePerCustomer codes(first: 1) { nodes { code } } maximumShippingPrice { amount } ${DISC_MIN} }
        ... on DiscountAutomaticBasic { ${DISC_COMMON} ${DISC_GETS} ${DISC_MIN} }
        ... on DiscountAutomaticBxgy { ${DISC_COMMON} ${DISC_BXGY('usesPerOrderAuto')} }
        ... on DiscountAutomaticFreeShipping { ${DISC_COMMON} maximumShippingPrice { amount } ${DISC_MIN} }
      }
    }
  }
`;

export const DISCOUNT_AUTOMATIC_BASIC_CREATE = /* GraphQL */ `
  mutation DiscountAutomaticBasicCreate($automaticBasicDiscount: DiscountAutomaticBasicInput!) {
    discountAutomaticBasicCreate(automaticBasicDiscount: $automaticBasicDiscount) { automaticDiscountNode { id } userErrors { field message } }
  }
`;
export const DISCOUNT_AUTOMATIC_BASIC_UPDATE = /* GraphQL */ `
  mutation DiscountAutomaticBasicUpdate($id: ID!, $automaticBasicDiscount: DiscountAutomaticBasicInput!) {
    discountAutomaticBasicUpdate(id: $id, automaticBasicDiscount: $automaticBasicDiscount) { automaticDiscountNode { id } userErrors { field message } }
  }
`;
export const DISCOUNT_AUTOMATIC_FREE_SHIPPING_CREATE = /* GraphQL */ `
  mutation DiscountAutomaticFreeShippingCreate($freeShippingAutomaticDiscount: DiscountAutomaticFreeShippingInput!) {
    discountAutomaticFreeShippingCreate(freeShippingAutomaticDiscount: $freeShippingAutomaticDiscount) { automaticDiscountNode { id } userErrors { field message } }
  }
`;
export const DISCOUNT_AUTOMATIC_FREE_SHIPPING_UPDATE = /* GraphQL */ `
  mutation DiscountAutomaticFreeShippingUpdate($id: ID!, $freeShippingAutomaticDiscount: DiscountAutomaticFreeShippingInput!) {
    discountAutomaticFreeShippingUpdate(id: $id, freeShippingAutomaticDiscount: $freeShippingAutomaticDiscount) { automaticDiscountNode { id } userErrors { field message } }
  }
`;
export const DISCOUNT_AUTOMATIC_BXGY_CREATE = /* GraphQL */ `
  mutation DiscountAutomaticBxgyCreate($automaticBxgyDiscount: DiscountAutomaticBxgyInput!) {
    discountAutomaticBxgyCreate(automaticBxgyDiscount: $automaticBxgyDiscount) { automaticDiscountNode { id } userErrors { field message } }
  }
`;
export const DISCOUNT_AUTOMATIC_BXGY_UPDATE = /* GraphQL */ `
  mutation DiscountAutomaticBxgyUpdate($id: ID!, $automaticBxgyDiscount: DiscountAutomaticBxgyInput!) {
    discountAutomaticBxgyUpdate(id: $id, automaticBxgyDiscount: $automaticBxgyDiscount) { automaticDiscountNode { id } userErrors { field message } }
  }
`;
export const DISCOUNT_CODE_BXGY_CREATE = /* GraphQL */ `
  mutation DiscountCodeBxgyCreate($bxgyCodeDiscount: DiscountCodeBxgyInput!) {
    discountCodeBxgyCreate(bxgyCodeDiscount: $bxgyCodeDiscount) { codeDiscountNode { id } userErrors { field message } }
  }
`;
export const DISCOUNT_CODE_BXGY_UPDATE = /* GraphQL */ `
  mutation DiscountCodeBxgyUpdate($id: ID!, $bxgyCodeDiscount: DiscountCodeBxgyInput!) {
    discountCodeBxgyUpdate(id: $id, bxgyCodeDiscount: $bxgyCodeDiscount) { codeDiscountNode { id } userErrors { field message } }
  }
`;
export const DISCOUNT_AUTOMATIC_ACTIVATE = /* GraphQL */ `
  mutation DiscountAutomaticActivate($id: ID!) { discountAutomaticActivate(id: $id) { automaticDiscountNode { id } userErrors { field message } } }
`;
export const DISCOUNT_AUTOMATIC_DEACTIVATE = /* GraphQL */ `
  mutation DiscountAutomaticDeactivate($id: ID!) { discountAutomaticDeactivate(id: $id) { automaticDiscountNode { id } userErrors { field message } } }
`;
export const DISCOUNT_AUTOMATIC_DELETE = /* GraphQL */ `
  mutation DiscountAutomaticDelete($id: ID!) { discountAutomaticDelete(id: $id) { deletedAutomaticDiscountId userErrors { field message } } }
`;
