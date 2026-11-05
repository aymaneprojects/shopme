// Blogs, articles (blog posts) and URL redirects.

export const BLOGS = /* GraphQL */ `
  query Blogs { blogs(first: 50) { nodes { id title handle } } }
`;
export const BLOG_CREATE = /* GraphQL */ `
  mutation BlogCreate($blog: BlogCreateInput!) { blogCreate(blog: $blog) { blog { id } userErrors { field message } } }
`;
export const BLOG_UPDATE = /* GraphQL */ `
  mutation BlogUpdate($id: ID!, $blog: BlogUpdateInput!) { blogUpdate(id: $id, blog: $blog) { blog { id } userErrors { field message } } }
`;
export const BLOG_DELETE = /* GraphQL */ `
  mutation BlogDelete($id: ID!) { blogDelete(id: $id) { deletedBlogId userErrors { field message } } }
`;

export const ARTICLES = /* GraphQL */ `
  query Articles($first: Int, $after: String, $last: Int, $before: String, $query: String) {
    articles(first: $first, after: $after, last: $last, before: $before, query: $query) {
      nodes { id title handle isPublished publishedAt updatedAt tags author { name } blog { id title } }
      pageInfo { hasNextPage hasPreviousPage startCursor endCursor }
    }
  }
`;
export const ARTICLE = /* GraphQL */ `
  query Article($id: ID!) {
    article(id: $id) { id title handle body summary tags isPublished publishedAt author { name } image { url altText } blog { id title } }
  }
`;
export const ARTICLE_CREATE = /* GraphQL */ `
  mutation ArticleCreate($article: ArticleCreateInput!) { articleCreate(article: $article) { article { id } userErrors { field message } } }
`;
export const ARTICLE_UPDATE = /* GraphQL */ `
  mutation ArticleUpdate($id: ID!, $article: ArticleUpdateInput!) { articleUpdate(id: $id, article: $article) { article { id } userErrors { field message } } }
`;
export const ARTICLE_DELETE = /* GraphQL */ `
  mutation ArticleDelete($id: ID!) { articleDelete(id: $id) { deletedArticleId userErrors { field message } } }
`;

export const URL_REDIRECTS = /* GraphQL */ `
  query UrlRedirects($first: Int, $after: String, $last: Int, $before: String, $query: String) {
    urlRedirects(first: $first, after: $after, last: $last, before: $before, query: $query) {
      nodes { id path target }
      pageInfo { hasNextPage hasPreviousPage startCursor endCursor }
    }
  }
`;
export const URL_REDIRECT_CREATE = /* GraphQL */ `
  mutation UrlRedirectCreate($urlRedirect: UrlRedirectInput!) { urlRedirectCreate(urlRedirect: $urlRedirect) { urlRedirect { id } userErrors { field message } } }
`;
export const URL_REDIRECT_UPDATE = /* GraphQL */ `
  mutation UrlRedirectUpdate($id: ID!, $urlRedirect: UrlRedirectInput!) { urlRedirectUpdate(id: $id, urlRedirect: $urlRedirect) { urlRedirect { id } userErrors { field message } } }
`;
export const URL_REDIRECT_DELETE = /* GraphQL */ `
  mutation UrlRedirectDelete($id: ID!) { urlRedirectDelete(id: $id) { deletedUrlRedirectId userErrors { field message } } }
`;
