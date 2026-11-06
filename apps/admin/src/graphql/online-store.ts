// Online store operations: themes (settings editor), pages, navigation menus.

export const THEMES = /* GraphQL */ `
  query Themes { themes(first: 50) { nodes { id name role createdAt shopmeBundledTheme { handle name installedVersion bundledVersion updateAvailable } } } }
`;

/** The themes that ship with ShopMe (the "Free ShopMe themes" gallery). */
export const BUNDLED_THEMES = /* GraphQL */ `
  query BundledThemes($locale: String) { shopmeBundledThemes(locale: $locale) { handle name version author description tags templates changelog { version date notes } previews { desktop mobile } } }
`;

/** Add a bundled theme to the library, unpublished. */
export const THEME_INSTALL_BUNDLED = /* GraphQL */ `
  mutation ThemeInstallBundled($handle: String!) {
    shopmeThemeInstallBundled(handle: $handle) { theme { id name role } userErrors { field message code } }
  }
`;

/** What changed in the bundled theme (Aurora) since the version a theme was installed from. */
export const THEME_RELEASE_NOTES = /* GraphQL */ `
  query ThemeReleaseNotes($id: ID!, $locale: String) {
    theme(id: $id) { id shopmeBundledTheme { name installedVersion bundledVersion releaseNotes(locale: $locale) { version date notes } } }
  }
`;

/** New unpublished copy of a theme at the bundled version, with the merchant's customizations carried over. */
export const THEME_UPDATE_TO_BUNDLED = /* GraphQL */ `
  mutation ThemeUpdateToBundled($id: ID!) {
    shopmeThemeUpdateToBundled(id: $id) {
      theme { id name role }
      previousVersion version carriedOverFiles removedSettings
      skippedFiles { filename reason }
      removedReferences { filename kind id type }
      userErrors { field message code }
    }
  }
`;

export const THEME_SETTINGS = /* GraphQL */ `
  query ThemeSettings($id: ID!) {
    theme(id: $id) {
      id name role
      files(filenames: ["config/settings_schema.json", "config/settings_data.json"]) {
        nodes { filename body { ... on OnlineStoreThemeFileBodyText { content } } }
      }
    }
  }
`;

/** Optional label translations for `t:` keys in the schema; the editor falls back to readable ids when missing. */
export const THEME_LOCALES = /* GraphQL */ `
  query ThemeLocales($id: ID!) {
    theme(id: $id) {
      id
      files(filenames: ["locales/en.default.schema.json", "locales/fr.schema.json"]) {
        nodes { filename body { ... on OnlineStoreThemeFileBodyText { content } } }
      }
    }
  }
`;

export const THEME_FILES_UPSERT = /* GraphQL */ `
  mutation ThemeFilesUpsert($themeId: ID!, $files: [OnlineStoreThemeFilesUpsertFileInput!]!) {
    themeFilesUpsert(themeId: $themeId, files: $files) { upsertedThemeFiles { filename } userErrors { field message filename } }
  }
`;
export const THEME_DUPLICATE = /* GraphQL */ `
  mutation ThemeDuplicate($id: ID!, $name: String) { themeDuplicate(id: $id, name: $name) { newTheme { id name role } userErrors { field message } } }
`;
export const THEME_DELETE = /* GraphQL */ `
  mutation ThemeDelete($id: ID!) { themeDelete(id: $id) { deletedThemeId userErrors { field message } } }
`;
export const THEME_UPDATE = /* GraphQL */ `
  mutation ThemeUpdate($id: ID!, $input: OnlineStoreThemeInput!) { themeUpdate(id: $id, input: $input) { theme { id name } userErrors { field message } } }
`;

/** Section editor: one template plus every section group (header/footer), read by file name. */
export const THEME_EDITOR_FILES = /* GraphQL */ `
  query ThemeEditorFiles($id: ID!, $filenames: [String!]) {
    theme(id: $id) { id files(filenames: $filenames, first: 250) { nodes { filename body { ... on OnlineStoreThemeFileBodyText { content } } } } }
  }
`;
/** Template file names only (for the template picker). */
export const THEME_TEMPLATE_NAMES = /* GraphQL */ `
  query ThemeTemplateNames($id: ID!) { theme(id: $id) { id files(filenames: ["templates/*.json"], first: 250) { nodes { filename } } } }
`;
/** Section and theme-block sources, from which `{% schema %}` is parsed. */
export const THEME_SCHEMAS = /* GraphQL */ `
  query ThemeSchemas($id: ID!) {
    theme(id: $id) { id files(filenames: ["sections/*.liquid", "blocks/*.liquid"], first: 250) { nodes { filename body { ... on OnlineStoreThemeFileBodyText { content } } } } }
  }
`;
/** One handle per resource type, so the preview iframe can open a real product / page. */
export const THEME_PREVIEW_HANDLES = /* GraphQL */ `
  query ThemePreviewHandles { products(first: 1) { nodes { handle } } collections(first: 1) { nodes { handle } } pages(first: 1) { nodes { handle } } }
`;

/** Preview data selector: what the preview can show (products, collections, pages, articles), the shop languages and the market countries. */
export const THEME_PREVIEW_DATA = /* GraphQL */ `
  query ThemePreviewData {
    products(first: 50, sortKey: TITLE) { nodes { handle title } }
    collections(first: 50, sortKey: TITLE) { nodes { handle title } }
    pages(first: 50) { nodes { handle title } }
    articles(first: 50) { nodes { handle title blog { handle } } }
    shopLocales { locale name primary published }
    markets(first: 50) { nodes { id name conditions { regionsCondition { regions(first: 250) { nodes { ... on MarketRegionCountry { code name } } } } } } }
  }
`;

/** Code editor: the file list (names, types, sizes), then a file's text on demand. */
export const THEME_ALL_FILES = /* GraphQL */ `
  query ThemeAllFiles($id: ID!, $after: String) {
    theme(id: $id) { id name role files(first: 250, after: $after) { nodes { filename contentType size updatedAt } pageInfo { hasNextPage endCursor } } }
  }
`;
export const THEME_FILE_BODY = /* GraphQL */ `
  query ThemeFileBody($id: ID!, $filenames: [String!]) {
    theme(id: $id) { id files(filenames: $filenames, first: 250) { nodes { filename contentType body { ... on OnlineStoreThemeFileBodyText { content } } } } }
  }
`;
export const THEME_FILES_LINT = /* GraphQL */ `
  query ThemeFilesLint($files: [ThemeFileLintInput!]!) { themeFilesLint(files: $files) { filename line column severity message } }
`;
export const THEME_FILE_VERSIONS = /* GraphQL */ `
  query ThemeFileVersions($themeId: ID!, $filename: String!) { themeFileVersions(themeId: $themeId, filename: $filename) { id size createdAt } }
`;
export const THEME_FILE_VERSION = /* GraphQL */ `
  query ThemeFileVersion($id: ID!) { themeFileVersion(id: $id) { id filename body createdAt } }
`;
export const THEME_FILES_WITH_HISTORY = /* GraphQL */ `
  query ThemeFilesWithHistory($themeId: ID!) { themeFilesWithHistory(themeId: $themeId) }
`;
export const THEME_FILES_DELETE = /* GraphQL */ `
  mutation ThemeFilesDelete($themeId: ID!, $files: [String!]!) { themeFilesDelete(themeId: $themeId, files: $files) { deletedThemeFiles { filename } userErrors { field message } } }
`;
export const THEME_FILES_COPY = /* GraphQL */ `
  mutation ThemeFilesCopy($themeId: ID!, $files: [ThemeFilesCopyFileInput!]!) { themeFilesCopy(themeId: $themeId, files: $files) { copiedThemeFiles { filename } userErrors { field message } } }
`;
/** Default theme content: the locale files (`locales/<code>.json`, without the `.schema.json` ones that label the editor). */
export const THEME_LOCALE_FILES = /* GraphQL */ `
  query ThemeLocaleFiles($id: ID!) { theme(id: $id) { id name files(filenames: ["locales/*.json"], first: 250) { nodes { filename body { ... on OnlineStoreThemeFileBodyText { content } } } } } }
`;
/** Resources a theme setting can point at (collection, product, page, blog pickers). */
export const THEME_SETTING_RESOURCES = /* GraphQL */ `
  query ThemeSettingResources { collections(first: 100, sortKey: TITLE) { nodes { handle title } } products(first: 100, sortKey: TITLE) { nodes { handle title } } pages(first: 100) { nodes { handle title } } blogs(first: 100) { nodes { handle title } } }
`;

export const THEME_PUBLISH = /* GraphQL */ `
  mutation ThemePublish($id: ID!) { themePublish(id: $id) { theme { id role } userErrors { field message } } }
`;

export const PAGES = /* GraphQL */ `
  query Pages($first: Int, $after: String, $last: Int, $before: String, $query: String, $sortKey: PageSortKeys, $reverse: Boolean) {
    pages(first: $first, after: $after, last: $last, before: $before, query: $query, sortKey: $sortKey, reverse: $reverse) {
      nodes { id title handle body isPublished updatedAt }
      pageInfo { hasNextPage hasPreviousPage startCursor endCursor }
    }
  }
`;
export const PAGE = /* GraphQL */ `
  query Page($id: ID!) { page(id: $id) { id title handle body isPublished publishedAt templateSuffix seo { title description } updatedAt } }
`;
export const PAGE_CREATE = /* GraphQL */ `
  mutation PageCreate($page: PageCreateInput!) { pageCreate(page: $page) { page { id } userErrors { field message } } }
`;
export const PAGE_UPDATE = /* GraphQL */ `
  mutation PageUpdate($id: ID!, $page: PageUpdateInput!) { pageUpdate(id: $id, page: $page) { page { id } userErrors { field message } } }
`;
export const PAGE_DELETE = /* GraphQL */ `
  mutation PageDelete($id: ID!) { pageDelete(id: $id) { deletedPageId userErrors { field message } } }
`;

const ITEM = 'id title type url resourceId';
const MENU = `id title handle isDefault items { ${ITEM} items { ${ITEM} items { ${ITEM} } } }`;
export const MENUS = /* GraphQL */ `
  query Menus { menus(first: 50) { nodes { ${MENU} } } }
`;
export const MENU_CREATE = /* GraphQL */ `
  mutation MenuCreate($title: String!, $handle: String!, $items: [MenuItemCreateInput!]!) {
    menuCreate(title: $title, handle: $handle, items: $items) { menu { id } userErrors { field message } }
  }
`;
export const MENU_UPDATE = /* GraphQL */ `
  mutation MenuUpdate($id: ID!, $title: String!, $handle: String, $items: [MenuItemUpdateInput!]!) {
    menuUpdate(id: $id, title: $title, handle: $handle, items: $items) { menu { id } userErrors { field message } }
  }
`;
export const MENU_DELETE = /* GraphQL */ `
  mutation MenuDelete($id: ID!) { menuDelete(id: $id) { deletedMenuId userErrors { field message } } }
`;

export const TEMPLATE_SUFFIXES = /* GraphQL */ `
  query TemplateSuffixes($kind: String!) { shopmeTemplateSuffixes(kind: $kind) }
`;
