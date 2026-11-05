// Markets, catalogs and price lists.

const MARKET_FIELDS = `
  id name handle status primary type
  conditions { regionsCondition { regions(first: 250) { nodes { id name ... on MarketRegionCountry { code } } } } }
  currencySettings { baseCurrency { currencyCode currencyName manualRate } localCurrencies roundingEnabled }
  priceInclusions { inclusiveTaxPricingStrategy }
  catalogsCount { count }
  catalogs(first: 5) { nodes { id title status priceList { id name currency } } }
`;

export const MARKETS_LIST = /* GraphQL */ `
  query MarketsList($query: String, $sortKey: MarketsSortKeys, $reverse: Boolean) {
    markets(first: 100, query: $query, sortKey: $sortKey, reverse: $reverse) { nodes { ${MARKET_FIELDS} } }
    shop { id currencyCode }
  }
`;

export const MARKET_DETAIL = /* GraphQL */ `
  query MarketDetail($id: ID!) {
    market(id: $id) { ${MARKET_FIELDS} }
    shop { id currencyCode taxesIncluded enabledPresentmentCurrencies }
    catalogs(first: 100, type: MARKET) { nodes { id title status priceList { id name currency } ... on MarketCatalog { markets(first: 5) { nodes { id } } } } }
    others: markets(first: 100) { nodes { id name primary conditions { regionsCondition { regions(first: 250) { nodes { ... on MarketRegionCountry { code } } } } } } }
  }
`;

export const MARKET_CREATE = /* GraphQL */ `
  mutation MarketCreate($input: MarketCreateInput!) {
    marketCreate(input: $input) { market { id name } userErrors { field message code } }
  }
`;

export const MARKET_UPDATE = /* GraphQL */ `
  mutation MarketUpdate($id: ID!, $input: MarketUpdateInput!) {
    marketUpdate(id: $id, input: $input) { market { id name } userErrors { field message code } }
  }
`;

export const MARKET_DELETE = /* GraphQL */ `
  mutation MarketDelete($id: ID!) { marketDelete(id: $id) { deletedId userErrors { field message code } } }
`;

const CATALOG_FIELDS = `
  id title status
  priceList { id name currency fixedPricesCount parent { adjustment { type value } settings { compareAtMode } } }
  ... on MarketCatalog { markets(first: 5) { nodes { id name primary } } }
`;

export const CATALOGS_LIST = /* GraphQL */ `
  query CatalogsList($query: String) {
    catalogs(first: 100, type: MARKET, query: $query) { nodes { ${CATALOG_FIELDS} } }
  }
`;

export const CATALOG_DETAIL = /* GraphQL */ `
  query CatalogDetail($id: ID!) {
    catalog(id: $id) { ${CATALOG_FIELDS} }
    markets(first: 100) { nodes { id name primary currencySettings { baseCurrency { currencyCode } } catalogs(first: 1) { nodes { id } } } }
    shop { id currencyCode }
  }
`;

export const CATALOG_CREATE = /* GraphQL */ `
  mutation CatalogCreate($input: CatalogCreateInput!) { catalogCreate(input: $input) { catalog { id } userErrors { field message code } } }
`;

export const CATALOG_UPDATE = /* GraphQL */ `
  mutation CatalogUpdate($id: ID!, $input: CatalogUpdateInput!) { catalogUpdate(id: $id, input: $input) { catalog { id } userErrors { field message code } } }
`;

export const CATALOG_DELETE = /* GraphQL */ `
  mutation CatalogDelete($id: ID!, $deleteDependentResources: Boolean) { catalogDelete(id: $id, deleteDependentResources: $deleteDependentResources) { deletedId userErrors { field message code } } }
`;

export const PRICE_LIST_CREATE = /* GraphQL */ `
  mutation PriceListCreate($input: PriceListCreateInput!) { priceListCreate(input: $input) { priceList { id } userErrors { field message code } } }
`;

export const PRICE_LIST_UPDATE = /* GraphQL */ `
  mutation PriceListUpdate($id: ID!, $input: PriceListUpdateInput!) { priceListUpdate(id: $id, input: $input) { priceList { id } userErrors { field message code } } }
`;

export const PRICE_LIST_PRICES = /* GraphQL */ `
  query PriceListPrices($id: ID!, $first: Int, $after: String, $last: Int, $before: String, $query: String, $originType: PriceListPriceOriginType) {
    priceList(id: $id) {
      id currency fixedPricesCount
      prices(first: $first, after: $after, last: $last, before: $before, query: $query, originType: $originType) {
        nodes { originType price { amount currencyCode } compareAtPrice { amount currencyCode } variant { id title sku price product { id title } } }
        pageInfo { hasNextPage hasPreviousPage startCursor endCursor }
      }
    }
  }
`;

export const PRICE_LIST_FIXED_ADD = /* GraphQL */ `
  mutation PriceListFixedPricesAdd($priceListId: ID!, $prices: [PriceListPriceInput!]!) {
    priceListFixedPricesAdd(priceListId: $priceListId, prices: $prices) { prices { originType } userErrors { field message code } }
  }
`;

export const PRICE_LIST_FIXED_DELETE = /* GraphQL */ `
  mutation PriceListFixedPricesDelete($priceListId: ID!, $variantIds: [ID!]!) {
    priceListFixedPricesDelete(priceListId: $priceListId, variantIds: $variantIds) { deletedFixedPriceVariantIds userErrors { field message code } }
  }
`;
