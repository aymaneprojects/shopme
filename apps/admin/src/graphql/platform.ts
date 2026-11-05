// Analytics reports, languages and translations (ShopMe wave 7c).
export const SHOPME_REPORT = /* GraphQL */ `
  query ShopmeReport($name: ShopmeReportName!, $from: String!, $to: String!, $groupBy: ShopmeReportGroupBy) {
    shopmeReport(name: $name, from: $from, to: $to, groupBy: $groupBy) {
      name currencyCode from to groupBy
      columns { key label type }
      rows
      totals
    }
  }
`;

export const SHOP_LOCALES = /* GraphQL */ `
  query ShopLocales { shopLocales { locale name primary published } }
`;

export const SHOP_LOCALE_ENABLE = /* GraphQL */ `
  mutation ShopLocaleEnable($locale: String!) {
    shopLocaleEnable(locale: $locale) { shopLocale { locale name primary published } userErrors { field message } }
  }
`;

export const SHOP_LOCALE_UPDATE = /* GraphQL */ `
  mutation ShopLocaleUpdate($locale: String!, $published: Boolean) {
    shopLocaleUpdate(locale: $locale, shopLocale: { published: $published }) { shopLocale { locale name primary published } userErrors { field message } }
  }
`;

export const SHOP_LOCALE_DISABLE = /* GraphQL */ `
  mutation ShopLocaleDisable($locale: String!) {
    shopLocaleDisable(locale: $locale) { locale userErrors { field message } }
  }
`;

export const TRANSLATABLE_RESOURCES = /* GraphQL */ `
  query TranslatableResources($resourceType: TranslatableResourceType!, $first: Int!, $after: String, $locale: String!) {
    translatableResources(resourceType: $resourceType, first: $first, after: $after) {
      nodes {
        resourceId
        translatableContent { key value digest type locale }
        translations(locale: $locale) { key value outdated }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

export const TRANSLATIONS_REGISTER = /* GraphQL */ `
  mutation TranslationsRegister($resourceId: ID!, $translations: [TranslationInput!]!) {
    translationsRegister(resourceId: $resourceId, translations: $translations) {
      translations { key locale value outdated }
      userErrors { field message code }
    }
  }
`;

export const TRANSLATIONS_REMOVE = /* GraphQL */ `
  mutation TranslationsRemove($resourceId: ID!, $translationKeys: [String!]!, $locales: [String!]!) {
    translationsRemove(resourceId: $resourceId, translationKeys: $translationKeys, locales: $locales) {
      translations { key locale }
      userErrors { field message code }
    }
  }
`;
