// Online store operations: themes (settings editor), pages, navigation menus.

export const THEMES = /* GraphQL */ `
  query Themes { themes { nodes { id name role } } }
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
    themeFilesUpsert(themeId: $themeId, files: $files) { upsertedThemeFiles { filename } userErrors { field message } }
  }
`;
export const THEME_PUBLISH = /* GraphQL */ `
  mutation ThemePublish($id: ID!) { themePublish(id: $id) { theme { id role } userErrors { field message } } }
`;

export const PAGES = /* GraphQL */ `
  query Pages($first: Int, $after: String, $last: Int, $before: String, $query: String) {
    pages(first: $first, after: $after, last: $last, before: $before, query: $query) {
      nodes { id title handle isPublished updatedAt }
      pageInfo { hasNextPage hasPreviousPage startCursor endCursor }
    }
  }
`;
export const PAGE = /* GraphQL */ `
  query Page($id: ID!) { page(id: $id) { id title handle body isPublished updatedAt } }
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
const MENU = `id title handle items { ${ITEM} items { ${ITEM} items { ${ITEM} } } }`;
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
