// Checkout configurations (Settings > Checkout).
const SETTINGS = `contactMethod accountMode nameMode company address2 phone marketing orderNotes tipping { enabled presets }`;
const CONFIGURATION = `id name active config settings { ${SETTINGS} }`;

export const CHECKOUT_CONFIGURATIONS = /* GraphQL */ `
  query CheckoutConfigurations { shopmeCheckoutConfigurations { ${CONFIGURATION} } }
`;
export const CHECKOUT_CONFIGURATION_CREATE = /* GraphQL */ `
  mutation CheckoutConfigurationCreate($name: String!, $fromId: String) { shopmeCheckoutConfigurationCreate(name: $name, fromId: $fromId) { configuration { ${CONFIGURATION} } userErrors { field message } } }
`;
export const CHECKOUT_CONFIGURATION_RENAME = /* GraphQL */ `
  mutation CheckoutConfigurationRename($id: String!, $name: String!) { shopmeCheckoutConfigurationRename(id: $id, name: $name) { configuration { ${CONFIGURATION} } userErrors { field message } } }
`;
export const CHECKOUT_CONFIGURATION_UPDATE = /* GraphQL */ `
  mutation CheckoutConfigurationUpdate($id: String!, $settings: ShopmeCheckoutSettingsInput, $config: JSON) { shopmeCheckoutConfigurationUpdate(id: $id, settings: $settings, config: $config) { configuration { ${CONFIGURATION} } userErrors { field message } } }
`;
export const CHECKOUT_CONFIGURATION_ACTIVATE = /* GraphQL */ `
  mutation CheckoutConfigurationActivate($id: String!) { shopmeCheckoutConfigurationActivate(id: $id) { configuration { ${CONFIGURATION} } userErrors { field message } } }
`;
export const CHECKOUT_CONFIGURATION_DELETE = /* GraphQL */ `
  mutation CheckoutConfigurationDelete($id: String!) { shopmeCheckoutConfigurationDelete(id: $id) { deletedId userErrors { field message } } }
`;
