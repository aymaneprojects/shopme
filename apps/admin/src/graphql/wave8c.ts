// Checkout settings, return rules, notification switches and staff recipients, and the activity feed (bell).

const CHECKOUT = `contactMethod accountMode nameMode company address2 phone marketing orderNotes tipping { enabled presets }`;
export const CHECKOUT_SETTINGS = /* GraphQL */ `
  query CheckoutSettings { shopmeCheckoutSettings { ${CHECKOUT} } }
`;
export const CHECKOUT_SETTINGS_UPDATE = /* GraphQL */ `
  mutation CheckoutSettingsUpdate($input: ShopmeCheckoutSettingsInput!) { shopmeCheckoutSettingsUpdate(input: $input) { settings { ${CHECKOUT} } userErrors { field message } } }
`;

const RULES = `windowDays shippingCost shippingFee restockingFeePercent finalSale { productIds collectionIds }`;
export const RETURN_RULES = /* GraphQL */ `
  query ReturnRules { shopmeReturnRules { ${RULES} } }
`;
export const RETURN_RULES_UPDATE = /* GraphQL */ `
  mutation ReturnRulesUpdate($input: ShopmeReturnRulesInput!) { shopmeReturnRulesUpdate(input: $input) { rules { ${RULES} } userErrors { field message } } }
`;
export const FINAL_SALE_TITLES = /* GraphQL */ `
  query FinalSaleTitles($ids: [ID!]!) { nodes(ids: $ids) { ... on Product { id title } ... on Collection { id title } } }
`;

export const STAFF_ORDER_RECIPIENTS = /* GraphQL */ `
  query StaffOrderRecipients { shopmeStaffOrderRecipients { emails isDefault } }
`;
export const STAFF_ORDER_RECIPIENTS_UPDATE = /* GraphQL */ `
  mutation StaffOrderRecipientsUpdate($emails: [String!]!) { shopmeStaffOrderRecipientsUpdate(emails: $emails) { recipients { emails isDefault } userErrors { field message } } }
`;
export const NOTIFICATION_TOGGLE = /* GraphQL */ `
  mutation NotificationToggle($key: String!, $enabled: Boolean!) { shopmeNotificationToggle(key: $key, enabled: $enabled) { key enabled userErrors { field message } } }
`;

export const ACTIVITY_FEED = /* GraphQL */ `
  query ActivityFeed($first: Int) { shopmeActivityFeed(first: $first) { unreadCount items { id kind title body link createdAt read ok } } }
`;
export const ACTIVITY_MARK_ALL_READ = /* GraphQL */ `
  mutation ActivityMarkAllRead { shopmeActivityMarkAllRead { unreadCount } }
`;
