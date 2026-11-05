// Customer accounts, customer privacy, customer events (pixels) and store credit.

const ACCOUNTS = `mode loginLinksVisible signIn { password emailCode } orderActions { reorder returns cancellations cancellationWindowHours } storeCredit url accountUrl`;
export const CUSTOMER_ACCOUNTS_SETTINGS = /* GraphQL */ `
  query CustomerAccountsSettings { shopmeCustomerAccountsSettings { ${ACCOUNTS} } }
`;
export const CUSTOMER_ACCOUNTS_SETTINGS_UPDATE = /* GraphQL */ `
  mutation CustomerAccountsSettingsUpdate($input: ShopmeCustomerAccountsSettingsInput!) { shopmeCustomerAccountsSettingsUpdate(input: $input) { settings { ${ACCOUNTS} } userErrors { field message } } }
`;

const PRIVACY = `mode cookieBanner { mode message position } dataSaleOptOutPage doubleOptIn hasPrivacyPolicy storageLocation regions { consentRequired notice dataSaleOptOutUsStates reviewedAt }`;
export const PRIVACY_SETTINGS = /* GraphQL */ `
  query PrivacySettingsPage { shopmePrivacySettings { ${PRIVACY} } shopmeCheckoutSettings { marketing } }
`;
export const PRIVACY_SETTINGS_UPDATE = /* GraphQL */ `
  mutation PrivacySettingsUpdate($input: ShopmePrivacySettingsInput!) { shopmePrivacySettingsUpdate(input: $input) { settings { ${PRIVACY} } userErrors { field message } } }
`;
export const CONSENT_POLICIES = /* GraphQL */ `
  query ConsentPolicies { consentPolicy { id countryCode regionCode consentRequired dataSaleOptOutRequired } }
`;
export const CONSENT_POLICY_UPDATE = /* GraphQL */ `
  mutation ConsentPolicyUpdate($policies: [ConsentPolicyInput!]!) { shopmeConsentPoliciesReplace(consentPolicies: $policies) { updatedPolicies { id countryCode regionCode consentRequired dataSaleOptOutRequired } userErrors { field message code } } }
`;

const PIXEL = `id name code connected kind requiredConsent respectSaleOptOut domEvents updatedAt`;
export const PIXELS = /* GraphQL */ `
  query Pixels { shopmeCustomPixels { ${PIXEL} } shopmeStorefrontEventCounts(days: 7) { name count } }
`;
export const PIXEL_QUERY = /* GraphQL */ `
  query Pixel($id: ID!) { shopmeCustomPixel(id: $id) { ${PIXEL} } }
`;
export const PIXEL_CREATE = /* GraphQL */ `
  mutation PixelCreate($input: ShopmeCustomPixelInput!) { shopmeCustomPixelCreate(input: $input) { pixel { ${PIXEL} } userErrors { field message } } }
`;
export const PIXEL_UPDATE = /* GraphQL */ `
  mutation PixelUpdate($id: ID!, $input: ShopmeCustomPixelInput!) { shopmeCustomPixelUpdate(id: $id, input: $input) { pixel { ${PIXEL} } userErrors { field message } } }
`;
export const PIXEL_CONNECT = /* GraphQL */ `
  mutation PixelConnect($id: ID!) { shopmeCustomPixelConnect(id: $id) { pixel { ${PIXEL} } userErrors { field message } } }
`;
export const PIXEL_DISCONNECT = /* GraphQL */ `
  mutation PixelDisconnect($id: ID!) { shopmeCustomPixelDisconnect(id: $id) { pixel { ${PIXEL} } userErrors { field message } } }
`;
export const PIXEL_DELETE = /* GraphQL */ `
  mutation PixelDelete($id: ID!) { shopmeCustomPixelDelete(id: $id) { deletedPixelId userErrors { field message } } }
`;

export const CUSTOMER_STORE_CREDIT = /* GraphQL */ `
  query CustomerStoreCredit($id: ID!) {
    storeCreditConfiguration { storeCreditEnabled }
    customer(id: $id) {
      id dataSaleOptOut
      emailMarketingConsent { marketingState marketingOptInLevel consentUpdatedAt }
      storeCreditAccounts(first: 10) { nodes { id balance { amount currencyCode } transactions(first: 5, reverse: true) { nodes { __typename amount { amount currencyCode } event createdAt ... on StoreCreditAccountCreditTransaction { expiresAt } } } } }
    }
    shop { currencyCode ianaTimezone }
  }
`;
export const STORE_CREDIT_CREDIT = /* GraphQL */ `
  mutation StoreCreditCredit($id: ID!, $input: StoreCreditAccountCreditInput!) {
    storeCreditAccountCredit(id: $id, creditInput: $input) { storeCreditAccountTransaction { account { id balance { amount currencyCode } } } userErrors { field message code } }
  }
`;
export const STORE_CREDIT_DEBIT = /* GraphQL */ `
  mutation StoreCreditDebit($id: ID!, $input: StoreCreditAccountDebitInput!) {
    storeCreditAccountDebit(id: $id, debitInput: $input) { storeCreditAccountTransaction { account { id balance { amount currencyCode } } } userErrors { field message code } }
  }
`;
export const CUSTOMER_EMAIL_CONSENT_UPDATE = /* GraphQL */ `
  mutation CustomerEmailConsentUpdate($input: CustomerEmailMarketingConsentUpdateInput!) {
    customerEmailMarketingConsentUpdate(input: $input) { customer { id emailMarketingConsent { marketingState marketingOptInLevel } } userErrors { field message code } }
  }
`;
