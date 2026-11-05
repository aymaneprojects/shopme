// Shipping and delivery: delivery profiles, local pickup, local delivery, packages, and the pickup flow on orders.

export const DELIVERY_PROFILES = /* GraphQL */ `
  query DeliveryProfiles {
    deliveryProfiles(first: 50) {
      nodes { id name default productVariantsCount { count } activeMethodDefinitionsCount originLocationCount zoneCountryCount locationsWithoutRatesCount }
    }
  }
`;

const METHOD = `id name description active shopmeFreeOverAmount { amount }
  shopmeTransitMinDays shopmeTransitMaxDays shopmeCollectionIds shopmeOriginLocationIds shopmeRateType shopmeCarrierProvider shopmeCarrierParams
  rateProvider { __typename ... on DeliveryRateDefinition { price { amount } } }
  methodConditions { id field operator conditionCriteria { __typename ... on MoneyV2 { amount } ... on Weight { unit value } } }`;

export const DELIVERY_PROFILE = /* GraphQL */ `
  query DeliveryProfile($id: ID!) {
    deliveryProfile(id: $id) {
      id name default version productVariantsCount { count }
      profileItems(first: 100) { nodes { id product { id title featuredMedia { id ... on MediaImage { image { url } } } } variants(first: 100) { nodes { id title } } } }
      profileLocationGroups {
        locationGroup { id locations(first: 50) { nodes { id name } } }
        locationGroupZones(first: 50) {
          nodes {
            zone { id name countries { id code { countryCode restOfWorld } name provinces { code } } }
            methodDefinitions(first: 50) { nodes { ${METHOD} } }
          }
        }
      }
    }
    locationsAvailableForDeliveryProfilesConnection(first: 50) { nodes { id name } }
  }
`;

export const DELIVERY_PROFILE_CREATE = /* GraphQL */ `
  mutation DeliveryProfileCreate($profile: DeliveryProfileInput!) { deliveryProfileCreate(profile: $profile) { profile { id } userErrors { field message } } }
`;
export const DELIVERY_PROFILE_UPDATE = /* GraphQL */ `
  mutation DeliveryProfileUpdate($id: ID!, $profile: DeliveryProfileInput!) { deliveryProfileUpdate(id: $id, profile: $profile) { profile { id } userErrors { field message } } }
`;
export const DELIVERY_PROFILE_REMOVE = /* GraphQL */ `
  mutation DeliveryProfileRemove($id: ID!) { deliveryProfileRemove(id: $id) { job { id } userErrors { field message } } }
`;

export const PRODUCT_VARIANT_IDS = /* GraphQL */ `
  query ProductVariantIds($id: ID!) { product(id: $id) { id variants(first: 250) { nodes { id } } } }
`;

const PACKAGE = `id name type default length width height dimensionUnit weight { value unit }`;
export const SHIPPING_PACKAGES = /* GraphQL */ `
  query ShippingPackages { shopmeShippingPackages { ${PACKAGE} } }
`;
export const SHIPPING_PACKAGE_CREATE = /* GraphQL */ `
  mutation ShippingPackageCreate($shippingPackage: CustomShippingPackageInput!) { shopmeShippingPackageCreate(shippingPackage: $shippingPackage) { shippingPackage { id } userErrors { field message } } }
`;
export const SHIPPING_PACKAGE_UPDATE = /* GraphQL */ `
  mutation ShippingPackageUpdate($id: ID!, $shippingPackage: CustomShippingPackageInput!) { shippingPackageUpdate(id: $id, shippingPackage: $shippingPackage) { userErrors { field message } } }
`;
export const SHIPPING_PACKAGE_MAKE_DEFAULT = /* GraphQL */ `
  mutation ShippingPackageMakeDefault($id: ID!) { shippingPackageMakeDefault(id: $id) { userErrors { field message } } }
`;
export const SHIPPING_PACKAGE_DELETE = /* GraphQL */ `
  mutation ShippingPackageDelete($id: ID!) { shippingPackageDelete(id: $id) { deletedId userErrors { field message } } }
`;

export const DELIVERY_LOCATIONS = /* GraphQL */ `
  query DeliveryLocations {
    locations(first: 100, sortKey: PRIORITY) {
      nodes {
        id name isActive address { address1 city zip countryCode }
        localPickupSettingsV2 { pickupTime instructions }
        shopmeLocalDelivery { enabled postalCodes price { amount } minimumOrder { amount } freeOverAmount { amount } info phone }
      }
    }
  }
`;
export const LOCAL_PICKUP_ENABLE = /* GraphQL */ `
  mutation LocalPickupEnable($localPickupSettings: DeliveryLocationLocalPickupEnableInput!) { locationLocalPickupEnable(localPickupSettings: $localPickupSettings) { localPickupSettings { pickupTime } userErrors { field message } } }
`;
export const LOCAL_PICKUP_DISABLE = /* GraphQL */ `
  mutation LocalPickupDisable($locationId: ID!) { locationLocalPickupDisable(locationId: $locationId) { locationId userErrors { field message } } }
`;
export const LOCAL_DELIVERY_UPDATE = /* GraphQL */ `
  mutation LocalDeliveryUpdate($locationId: ID!, $input: ShopmeLocationLocalDeliveryInput!) { shopmeLocationLocalDeliveryUpdate(locationId: $locationId, input: $input) { localDelivery { enabled } userErrors { field message } } }
`;

export const ORDER_DELIVERY = /* GraphQL */ `
  query OrderDelivery($id: ID!) { order(id: $id) { id shopmeDelivery { methodType location { id name address { address1 city zip } } pickupReadyAt pickedUpAt } } }
`;
export const ORDER_PICKUP_READY = /* GraphQL */ `
  mutation OrderPickupReady($orderId: ID!) { shopmeOrderPickupMarkReady(orderId: $orderId) { delivery { pickupReadyAt } userErrors { field message } } }
`;
export const ORDER_PICKED_UP = /* GraphQL */ `
  mutation OrderPickedUp($orderId: ID!) { shopmeOrderPickupMarkPickedUp(orderId: $orderId) { delivery { pickedUpAt } userErrors { field message } } }
`;
