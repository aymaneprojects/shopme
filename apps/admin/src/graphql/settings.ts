// Settings operations: shop, shipping zones, tax rates, payments. ShopMe-specific parts (zones, taxRates, payment settings) are documented in docs/dev/admin-settings-api.md.

const MONEY_AMOUNT = 'amount currencyCode';

export const SHOP = /* GraphQL */ `
  query ShopSettings {
    shop {
      id name email contactEmail description currencyCode ianaTimezone weightUnit taxesIncluded
      taxShipping: shopmeTaxShipping
      locale: shopmeLocale
      currencyFormats { moneyFormat moneyWithCurrencyFormat }
      primaryDomain { host url }
      myshopifyDomain
      storefront: shopmeStorefront { passwordEnabled password }
    }
  }
`;
export const SHOP_UPDATE = /* GraphQL */ `
  mutation ShopUpdate($input: ShopmeShopInput!) { shopmeShopUpdate(input: $input) { shop { id } userErrors { field message } } }
`;

const ZONE = `id name countries { countryCode provinceCodes } rates { id name type price { ${MONEY_AMOUNT} } minSubtotal { amount } maxSubtotal { amount } minWeight maxWeight }`;
export const SHIPPING_ZONES = /* GraphQL */ `
  query ShippingZones { shippingZones { ${ZONE} } }
`;
export const SHIPPING_ZONE_CREATE = /* GraphQL */ `
  mutation ShippingZoneCreate($input: ShopmeShippingZoneInput!) { shippingZoneCreate(input: $input) { zone { id } userErrors { field message } } }
`;
export const SHIPPING_ZONE_UPDATE = /* GraphQL */ `
  mutation ShippingZoneUpdate($id: ID!, $input: ShopmeShippingZoneInput!) { shippingZoneUpdate(id: $id, input: $input) { zone { id } userErrors { field message } } }
`;
export const SHIPPING_ZONE_DELETE = /* GraphQL */ `
  mutation ShippingZoneDelete($id: ID!) { shippingZoneDelete(id: $id) { deletedZoneId userErrors { field message } } }
`;

export const TAX_RATES = /* GraphQL */ `
  query TaxRates { taxRates { id name countryCode provinceCode rate } }
`;
export const TAX_RATE_CREATE = /* GraphQL */ `
  mutation TaxRateCreate($input: ShopmeTaxRateInput!) { taxRateCreate(input: $input) { taxRate { id } userErrors { field message } } }
`;
export const TAX_RATE_UPDATE = /* GraphQL */ `
  mutation TaxRateUpdate($id: ID!, $input: ShopmeTaxRateInput!) { taxRateUpdate(id: $id, input: $input) { taxRate { id } userErrors { field message } } }
`;
export const TAX_RATE_DELETE = /* GraphQL */ `
  mutation TaxRateDelete($id: ID!) { taxRateDelete(id: $id) { deletedTaxRateId userErrors { field message } } }
`;

export const PAYMENT_SETTINGS = /* GraphQL */ `
  query PaymentSettings { shopmePaymentSettings { bankTransfer { enabled instructions } cod { enabled } stripe { enabled stripeConfigured } } }
`;
export const PAYMENT_SETTINGS_UPDATE = /* GraphQL */ `
  mutation PaymentSettingsUpdate($input: ShopmePaymentSettingsInput!) { shopmePaymentSettingsUpdate(input: $input) { paymentSettings { stripe { stripeConfigured } } userErrors { field message } } }
`;
