// Settings extensions: configuration blocks, roles, tax presets, carriers, local deliveries, language domains, store deletion.

export const SHOPME_CONFIG = /* GraphQL */ `
  query ShopmeConfig($key: String!) { shopmeConfig(key: $key) }
`;
export const SHOPME_CONFIG_UPDATE = /* GraphQL */ `
  mutation ShopmeConfigUpdate($key: String!, $value: JSON!) { shopmeConfigUpdate(key: $key, value: $value) { value userErrors { field message } } }
`;

export const STAFF_ROLES = /* GraphQL */ `
  query ShopmeStaffRoles { shopmeStaffRoles }
`;
export const STAFF_ROLE_CREATE = /* GraphQL */ `
  mutation ShopmeStaffRoleCreate($name: String!, $description: String, $permissions: [String!]!) { shopmeStaffRoleCreate(name: $name, description: $description, permissions: $permissions) { value userErrors { field message } } }
`;
export const STAFF_ROLE_UPDATE = /* GraphQL */ `
  mutation ShopmeStaffRoleUpdate($id: ID!, $name: String, $description: String, $permissions: [String!]) { shopmeStaffRoleUpdate(id: $id, name: $name, description: $description, permissions: $permissions) { value userErrors { field message } } }
`;
export const STAFF_ROLE_DELETE = /* GraphQL */ `
  mutation ShopmeStaffRoleDelete($id: ID!) { shopmeStaffRoleDelete(id: $id) { value userErrors { field message } } }
`;
export const STAFF_ROLE_ASSIGN = /* GraphQL */ `
  mutation ShopmeStaffRoleAssign($id: ID!, $roleId: ID) { shopmeStaffRoleAssign(id: $id, roleId: $roleId) { value userErrors { field message } } }
`;
export const STAFF_IMPORT = /* GraphQL */ `
  mutation ShopmeStaffImport($csv: String!) { shopmeStaffImport(csv: $csv) { value userErrors { field message } } }
`;
export const STAFF_INVITE_ROLE = /* GraphQL */ `
  mutation StaffInviteWithRole($email: String!, $role: String!, $roleId: ID, $permissions: [String!]!) { shopmeStaffInvite(email: $email, role: $role, roleId: $roleId, permissions: $permissions) { staffMember { id } userErrors { field message } } }
`;
export const STAFF_MEMBERS_EXT = /* GraphQL */ `
  query StaffMembersExt { staffMembers(first: 100) { nodes { id email firstName lastName active isShopOwner role: shopmeRole permissions: shopmePermissions twoFactor: shopmeTwoFactorEnabled roleId: shopmeRoleId roleName: shopmeRoleName } } }
`;

export const TAX_REGIONS = /* GraphQL */ `
  query ShopmeTaxRegions { shopmeTaxRegions shopmeTaxPresets }
`;
export const TAX_PRESET_APPLY = /* GraphQL */ `
  mutation ShopmeTaxPresetApply($id: String!, $replace: Boolean) { shopmeTaxPresetApply(id: $id, replace: $replace) { value userErrors { field message } } }
`;
export const CUSTOMS_APPLY = /* GraphQL */ `
  mutation ShopmeCustomsApply { shopmeCustomsApply { value userErrors { field message } } }
`;

export const CARRIER_PROVIDERS = /* GraphQL */ `
  query ShopmeCarrierProviders { shopmeCarrierProviders }
`;
export const LOCAL_DELIVERIES = /* GraphQL */ `
  query ShopmeLocalDeliveries { shopmeLocalDeliveries }
`;
export const LOCAL_DELIVERY_STATUS_UPDATE = /* GraphQL */ `
  mutation ShopmeLocalDeliveryUpdate($orderId: ID!, $status: String!) { shopmeLocalDeliveryUpdate(orderId: $orderId, status: $status) { value userErrors { field message } } }
`;
export const SMS_TEST = /* GraphQL */ `
  mutation ShopmeSmsTest($key: String!, $to: String!) { shopmeSmsTest(key: $key, to: $to) { value userErrors { field message } } }
`;
export const LOCALE_DOMAIN_UPDATE = /* GraphQL */ `
  mutation ShopmeLocaleDomainUpdate($locale: String!, $domain: String) { shopmeLocaleDomainUpdate(locale: $locale, domain: $domain) { value userErrors { field message } } }
`;
export const SHOP_DELETE = /* GraphQL */ `
  mutation ShopmeShopDelete($confirmName: String!) { shopmeShopDelete(confirmName: $confirmName) { value userErrors { field message } } }
`;
export const SHOP_LOCALES_EXT = /* GraphQL */ `
  query ShopLocalesExt { shopLocales { locale name primary published domain: shopmeDomain } }
`;
export const MARKETS_COUNTRIES = /* GraphQL */ `
  query MarketsCountries { markets(first: 50) { nodes { id name handle regions(first: 250) { nodes { ... on MarketRegionCountry { code } } } } } }
`;
export const POLICIES_GENERATE = /* GraphQL */ `
  mutation ShopmePoliciesGenerate($types: [String!], $overwrite: Boolean) { shopmePoliciesGenerate(types: $types, overwrite: $overwrite) { value userErrors { field message } } }
`;
export const RECENT_ORDERS = /* GraphQL */ `
  query RecentOrdersForDocs { orders(first: 15, sortKey: CREATED_AT, reverse: true) { nodes { id name createdAt } } }
`;
export const ORDER_FOR_DOCUMENT = /* GraphQL */ `
  query OrderForDocument($id: ID!) {
    order(id: $id) {
      id name createdAt email phone note currencyCode
      shippingAddress { name company address1 address2 city zip province country phone }
      billingAddress { name company address1 address2 city zip province country }
      lineItems(first: 100) { nodes { id title variantTitle sku quantity image { url } originalUnitPriceSet { shopMoney { amount currencyCode } } discountedTotalSet { shopMoney { amount currencyCode } } } }
      subtotalPriceSet { shopMoney { amount currencyCode } }
      totalShippingPriceSet { shopMoney { amount currencyCode } }
      totalTaxSet { shopMoney { amount currencyCode } }
      totalPriceSet { shopMoney { amount currencyCode } }
      shippingLines(first: 5) { nodes { title } }
    }
    shop { name email }
  }
`;
export const SHIPPING_BY_MARKET = /* GraphQL */ `
  query ShopmeShippingByMarket { shopmeShippingByMarket }
`;
export const LOCATIONS_SIMPLE = /* GraphQL */ `
  query LocationsSimple { locations(first: 100) { nodes { id name isActive } } }
`;
export const COLLECTIONS_SIMPLE = /* GraphQL */ `
  query CollectionsSimple { collections(first: 100) { nodes { id title } } }
`;
