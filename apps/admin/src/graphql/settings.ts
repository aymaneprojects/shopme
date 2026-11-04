// Settings operations: shop, shipping zones, tax rates, payments. ShopMe-specific parts (zones, taxRates, paymentSettings) follow the agreed names.

export const SHOP = /* GraphQL */ `
  query ShopSettings {
    shop {
      id name email contactEmail description currencyCode ianaTimezone weightUnit taxesIncluded taxShipping locale
      currencyFormats { moneyFormat moneyWithCurrencyFormat }
      primaryDomain { host url }
      myshopifyDomain
      storefrontPasswordEnabled storefrontPassword
    }
  }
`;
export const SHOP_UPDATE = /* GraphQL */ `
  mutation ShopUpdate($input: ShopUpdateInput!) { shopUpdate(input: $input) { shop { id } userErrors { field message } } }
`;

const ZONE = 'id name countryCodes rates { id name price minSubtotal maxSubtotal minWeight maxWeight estimatedDelivery }';
export const SHIPPING_ZONES = /* GraphQL */ `
  query ShippingZones { shippingZones { nodes { ${ZONE} } } }
`;
export const SHIPPING_ZONE_CREATE = /* GraphQL */ `
  mutation ShippingZoneCreate($input: ShippingZoneInput!) { shippingZoneCreate(input: $input) { shippingZone { id } userErrors { field message } } }
`;
export const SHIPPING_ZONE_UPDATE = /* GraphQL */ `
  mutation ShippingZoneUpdate($id: ID!, $input: ShippingZoneInput!) { shippingZoneUpdate(id: $id, input: $input) { shippingZone { id } userErrors { field message } } }
`;
export const SHIPPING_ZONE_DELETE = /* GraphQL */ `
  mutation ShippingZoneDelete($id: ID!) { shippingZoneDelete(id: $id) { deletedId userErrors { field message } } }
`;

export const TAX_RATES = /* GraphQL */ `
  query TaxRates { taxRates { nodes { id name countryCode province rate } } }
`;
export const TAX_RATE_CREATE = /* GraphQL */ `
  mutation TaxRateCreate($input: TaxRateInput!) { taxRateCreate(input: $input) { taxRate { id } userErrors { field message } } }
`;
export const TAX_RATE_UPDATE = /* GraphQL */ `
  mutation TaxRateUpdate($id: ID!, $input: TaxRateInput!) { taxRateUpdate(id: $id, input: $input) { taxRate { id } userErrors { field message } } }
`;
export const TAX_RATE_DELETE = /* GraphQL */ `
  mutation TaxRateDelete($id: ID!) { taxRateDelete(id: $id) { deletedId userErrors { field message } } }
`;

export const PAYMENT_SETTINGS = /* GraphQL */ `
  query PaymentSettings { paymentSettings { bankTransfer { enabled instructions } cod { enabled } stripe { enabled } stripeConfigured } }
`;
export const PAYMENT_SETTINGS_UPDATE = /* GraphQL */ `
  mutation PaymentSettingsUpdate($input: PaymentSettingsInput!) { paymentSettingsUpdate(input: $input) { paymentSettings { stripeConfigured } userErrors { field message } } }
`;
