import { eq } from 'drizzle-orm';
import { getPrimaryShop, schema as s, seedDemo, updateCollection, updatePage, updateProduct } from '@shopme/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, SETUP_BODY, type TestApp } from '../../../src/test-utils';
import { makeGql } from '../helpers';

let t: TestApp;
let gql: ReturnType<typeof makeGql>;
let shopId = 0;
const get = (url: string) => t.app.inject({ url });
const title = (html: string) => /<title>([^<]*)<\/title>/.exec(html)?.[1];

beforeAll(async () => {
  t = await createTestApp();
  const setup = await t.app.inject({ method: 'POST', url: '/admin/api/setup', payload: SETUP_BODY });
  gql = makeGql(t.app, setup.cookies.find((c) => c.name === 'shopme_session')!.value);
  await seedDemo(t.dbHandle.db, t.app.ctx.storage);
  shopId = (await getPrimaryShop(t.dbHandle.db))!.id;
}, 90_000);
afterAll(async () => { await t.close(); });

describe('Admin GraphQL: blogs and articles', () => {
  let blogId = '';
  let articleId = '';

  it('creates, reads and lists blogs', async () => {
    const created = await gql(`mutation($b: BlogCreateInput!) { blogCreate(blog: $b) { blog { id handle title commentPolicy templateSuffix } userErrors { field message code } } }`, { b: { title: 'Roastery Journal', commentPolicy: 'MODERATED' } });
    expect(created.errors).toBeUndefined();
    expect(created.data.blogCreate.userErrors).toEqual([]);
    const blog = created.data.blogCreate.blog;
    blogId = blog.id;
    expect(blog).toMatchObject({ handle: 'roastery-journal', title: 'Roastery Journal', commentPolicy: 'MODERATED' });
    expect(blogId).toMatch(/^gid:\/\/shopify\/Blog\/\d+$/);

    const dup = await gql(`mutation { blogCreate(blog: { title: "x", handle: "roastery-journal" }) { blog { id } userErrors { field code } } }`);
    expect(dup.data.blogCreate.userErrors[0]).toMatchObject({ field: ['blog', 'handle'], code: 'TAKEN' });
    const blank = await gql(`mutation { blogCreate(blog: { title: " " }) { userErrors { field code } } }`);
    expect(blank.data.blogCreate.userErrors[0].code).toBe('BLANK');

    const list = await gql(`{ blogs(first: 10, sortKey: TITLE) { nodes { handle articlesCount { count } } } blogsCount { count } blog(id: "${blogId}") { title } n: node(id: "${blogId}") { __typename ... on Blog { handle } } }`);
    expect(list.errors).toBeUndefined();
    expect(list.data.blogs.nodes.map((n: { handle: string }) => n.handle)).toEqual(['news', 'roastery-journal']);
    expect(list.data.blogsCount.count).toBe(2);
    expect(list.data.blog.title).toBe('Roastery Journal');
    expect(list.data.n).toEqual({ __typename: 'Blog', handle: 'roastery-journal' });
    expect((await gql(`{ blogs(first: 5, query: "title:journal") { nodes { handle } } }`)).data.blogs.nodes).toHaveLength(1);
  });

  it('creates, updates and queries articles', async () => {
    const created = await gql(`mutation($a: ArticleCreateInput!) { articleCreate(article: $a) { article { id handle title author { name } body summary tags isPublished publishedAt image { url altText } blog { handle } } userErrors { field message code } } }`, {
      a: { blogId, title: 'Cold Brew Basics', author: { name: 'Sam' }, body: '<p>Steep it slowly.</p>', summary: '<p>Slow wins.</p>', tags: ['brewing', 'Cold'], isPublished: true, image: { url: 'https://cdn.example/cold.jpg', altText: 'A jar' } },
    });
    expect(created.data.articleCreate.userErrors).toEqual([]);
    const a = created.data.articleCreate.article;
    articleId = a.id;
    expect(a).toMatchObject({ handle: 'cold-brew-basics', author: { name: 'Sam' }, isPublished: true, tags: ['brewing', 'Cold'], blog: { handle: 'roastery-journal' }, image: { url: 'https://cdn.example/cold.jpg', altText: 'A jar' } });

    const bad = await gql(`mutation { articleCreate(article: { title: "No author", author: { name: "A", userId: "gid://shopify/StaffMember/1" }, blogId: "${blogId}" }) { userErrors { code } } }`);
    expect(bad.data.articleCreate.userErrors[0].code).toBe('AMBIGUOUS_AUTHOR');
    const noBlog = await gql(`mutation { articleCreate(article: { title: "T", author: { name: "A" } }) { userErrors { code } } }`);
    expect(noBlog.data.articleCreate.userErrors[0].code).toBe('BLOG_REFERENCE_REQUIRED');
    const inline = await gql(`mutation { articleCreate(article: { title: "On the fly", author: { name: "A" } }, blog: { title: "Fresh Blog" }) { article { blog { handle } } userErrors { code } } }`);
    expect(inline.data.articleCreate.article.blog.handle).toBe('fresh-blog');

    await gql(`mutation { articleCreate(article: { title: "Draft post", author: { name: "Sam" }, blogId: "${blogId}", isPublished: false }) { article { id } } }`);
    const list = await gql(`{ articles(first: 20, query: "blog_id:${blogId.split('/').pop()}", sortKey: TITLE) { nodes { handle isPublished } } blog(id: "${blogId}") { articlesCount { count } tags articles(first: 5) { nodes { handle } } } articleTags(limit: 10) }`);
    expect(list.errors).toBeUndefined();
    expect(list.data.articles.nodes.map((n: { handle: string }) => n.handle)).toEqual(['cold-brew-basics', 'draft-post']);
    expect(list.data.blog.articlesCount.count).toBe(2);
    expect(list.data.blog.tags).toEqual(['brewing', 'Cold']);
    expect(list.data.articleTags).toEqual(expect.arrayContaining(['brewing', 'Cold', 'news']));
    expect((await gql(`{ articles(first: 5, query: "published_status:unpublished") { nodes { handle } } }`)).data.articles.nodes.map((n: { handle: string }) => n.handle)).toEqual(['on-the-fly', 'draft-post']); // articles are drafts unless isPublished is true
  });

  it('serves blogs and articles on the storefront, with tags, feed, 404s and sitemap entries', async () => {
    const index = await get('/blogs/roastery-journal');
    expect(index.statusCode).toBe(200);
    expect(index.body).not.toContain('Liquid error');
    expect(title(index.body)).toBe('Roastery Journal - Test Shop');
    expect(index.body).toContain('Cold Brew Basics');
    expect(index.body).toContain('Slow wins.');
    expect(index.body).not.toContain('Draft post'); // unpublished articles stay hidden
    expect(index.body).toContain('href="/blogs/roastery-journal/tagged/brewing"');

    const tagged = await get('/blogs/roastery-journal/tagged/COLD');
    expect(tagged.statusCode).toBe(200);
    expect(title(tagged.body)).toBe('Roastery Journal - tagged &quot;Cold&quot; - Test Shop');
    expect(tagged.body).toContain('Cold Brew Basics');
    expect((await get('/blogs/roastery-journal/tagged/nothing')).statusCode).toBe(404);

    const article = await get('/blogs/roastery-journal/cold-brew-basics');
    expect(article.statusCode).toBe(200);
    expect(article.body).not.toContain('Liquid error');
    expect(title(article.body)).toBe('Cold Brew Basics - Test Shop');
    expect(article.body).toContain('<p>Steep it slowly.</p>');
    expect(article.body).toContain('By Sam');
    expect(article.body).toContain('cdn.example/cold.jpg');
    expect((await get('/blogs/roastery-journal/draft-post')).statusCode).toBe(404);
    expect((await get('/blogs/roastery-journal/nope')).statusCode).toBe(404);
    expect((await get('/blogs/nope')).statusCode).toBe(404);

    const atom = await get('/blogs/roastery-journal.atom');
    expect(atom.statusCode).toBe(200);
    expect(atom.headers['content-type']).toContain('application/atom+xml');
    expect(atom.body).toContain('<title>Test Shop - Roastery Journal</title>');
    expect(atom.body).toContain('/blogs/roastery-journal/cold-brew-basics');
    expect(atom.body).not.toContain('draft-post');
    expect((await get('/blogs/nope.atom')).statusCode).toBe(404);

    // the seeded blog shows neighbours: newest first, "previous" is the older one
    const news = await get('/blogs/news/brewing-guide');
    expect(news.body).toContain('Previous article: Welcome to Little Leaf');

    expect((await get('/sitemap_blogs_1.xml')).body).toContain('/blogs/roastery-journal/cold-brew-basics');
    expect((await get('/sitemap_blogs_1.xml')).body).not.toContain('draft-post');
    expect((await get('/search/suggest.json?q=cold&resources[type]=article')).json().resources.results.articles[0]).toMatchObject({ title: 'Cold Brew Basics', url: '/blogs/roastery-journal/cold-brew-basics' });
  });

  it('renders the blog and article liquid objects (blogs, articles, blog.articles_count)', async () => {
    const [theme] = await t.dbHandle.db.select().from(s.themes).where(eq(s.themes.role, 'MAIN'));
    const tpl = "<p id=x>{{ blogs['roastery-journal'].articles_count }}|{{ blogs.news.title }}|{{ articles['news/welcome'].title }}|{{ articles['news.brewing-guide'].tags | join: '+' }}|{{ blogs.nope.title }}</p>";
    await gql(`mutation($f: [OnlineStoreThemeFilesUpsertFileInput!]!) { themeFilesUpsert(themeId: "gid://shopify/OnlineStoreTheme/${theme!.id}", files: $f) { userErrors { message } } }`, { f: [{ filename: 'templates/page.objects.liquid', body: { type: 'TEXT', value: tpl } }] });
    await t.dbHandle.db.insert(s.pages).values({ shopId, handle: 'objects', title: 'Objects', publishedAt: new Date(), templateSuffix: 'objects' });
    const r = await get('/pages/objects');
    expect(r.body).toContain('<p id=x>1|News|Welcome to Little Leaf|brewing+guide|</p>');
  });

  it('updates and deletes; a changed article handle redirects the old URL', async () => {
    const up = await gql(`mutation($id: ID!) { articleUpdate(id: $id, article: { handle: "cold-brew-guide", title: "Cold Brew Guide", isPublished: false }) { article { handle title isPublished } userErrors { field message } } }`, { id: articleId });
    expect(up.data.articleUpdate.userErrors).toEqual([]);
    expect(up.data.articleUpdate.article).toMatchObject({ handle: 'cold-brew-guide', isPublished: false });
    expect((await get('/blogs/roastery-journal/cold-brew-guide')).statusCode).toBe(404); // unpublished
    await gql(`mutation($id: ID!) { articleUpdate(id: $id, article: { isPublished: true }) { userErrors { message } } }`, { id: articleId });
    const old = await get('/blogs/roastery-journal/cold-brew-basics');
    expect(old.statusCode).toBe(301);
    expect(old.headers.location).toBe('/blogs/roastery-journal/cold-brew-guide');

    const rename = await gql(`mutation($id: ID!) { blogUpdate(id: $id, blog: { handle: "journal", redirectArticles: true }) { blog { handle } userErrors { message } } }`, { id: blogId });
    expect(rename.data.blogUpdate.blog.handle).toBe('journal');
    expect((await get('/blogs/roastery-journal')).headers.location).toBe('/blogs/journal');
    expect((await get('/blogs/roastery-journal/cold-brew-guide')).headers.location).toBe('/blogs/journal/cold-brew-guide');
    expect((await get('/blogs/roastery-journal/cold-brew-basics')).headers.location).toBe('/blogs/journal/cold-brew-guide'); // no chain

    const delA = await gql(`mutation($id: ID!) { articleDelete(id: $id) { deletedArticleId userErrors { message } } }`, { id: articleId });
    expect(delA.data.articleDelete.deletedArticleId).toBe(articleId);
    expect((await gql(`mutation($id: ID!) { articleDelete(id: $id) { deletedArticleId userErrors { message code } } }`, { id: articleId })).data.articleDelete.userErrors[0].code).toBe('NOT_FOUND');
    const delB = await gql(`mutation($id: ID!) { blogDelete(id: $id) { deletedBlogId userErrors { message } } }`, { id: blogId });
    expect(delB.data.blogDelete.deletedBlogId).toBe(blogId);
    expect((await get('/blogs/journal')).statusCode).toBe(404);
    expect(await t.dbHandle.db.select().from(s.articles).where(eq(s.articles.blogId, Number(blogId.split('/').pop())))).toHaveLength(0);
  });
});

describe('URL redirects', () => {
  it('Admin GraphQL manages redirects and the storefront answers them with 301 before the 404', async () => {
    const created = await gql(`mutation { urlRedirectCreate(urlRedirect: { path: "promo", target: "/collections/all" }) { urlRedirect { id path target createdAt } userErrors { field message code } } }`);
    expect(created.errors).toBeUndefined();
    const r = created.data.urlRedirectCreate.urlRedirect;
    expect(r).toMatchObject({ path: '/promo', target: '/collections/all' });

    const promo = await get('/promo');
    expect(promo.statusCode).toBe(301);
    expect(promo.headers.location).toBe('/collections/all');
    expect((await get('/PROMO?utm=1')).headers.location).toBe('/collections/all?utm=1');
    expect((await get('/promo/')).statusCode).toBe(301);
    expect((await get('/not-a-redirect')).statusCode).toBe(404);

    const dup = await gql(`mutation { urlRedirectCreate(urlRedirect: { path: "/promo", target: "/x" }) { userErrors { field code message } } }`);
    expect(dup.data.urlRedirectCreate.userErrors[0]).toMatchObject({ field: ['urlRedirect', 'path'], code: 'CREATE_FAILED' });
    const bad = await gql(`mutation { urlRedirectCreate(urlRedirect: { path: "/a", target: "nowhere" }) { userErrors { message } } }`);
    expect(bad.data.urlRedirectCreate.userErrors[0].message).toMatch(/Target/);

    await gql(`mutation { urlRedirectCreate(urlRedirect: { path: "/offsite", target: "https://example.org/shop" }) { userErrors { message } } }`);
    expect((await get('/offsite')).headers.location).toBe('https://example.org/shop');

    const list = await gql(`{ urlRedirects(first: 10, sortKey: PATH) { nodes { path target } } urlRedirectsCount { count } urlRedirect(id: "${r.id}") { path } }`);
    expect(list.errors).toBeUndefined();
    const paths = list.data.urlRedirects.nodes.map((n: { path: string }) => n.path);
    expect(paths).toEqual(expect.arrayContaining(['/offsite', '/promo']));
    expect(paths).toEqual([...paths].sort((a: string, b: string) => a.toLowerCase().localeCompare(b.toLowerCase())));
    expect(list.data.urlRedirectsCount.count).toBe(paths.length);
    expect((await gql(`{ urlRedirects(first: 10, query: "path:promo") { nodes { path } } }`)).data.urlRedirects.nodes).toHaveLength(1);

    const up = await gql(`mutation($id: ID!) { urlRedirectUpdate(id: $id, urlRedirect: { target: "/collections" }) { urlRedirect { target } userErrors { message } } }`, { id: r.id });
    expect(up.data.urlRedirectUpdate.urlRedirect.target).toBe('/collections');
    expect((await get('/promo')).headers.location).toBe('/collections');

    const del = await gql(`mutation($id: ID!) { urlRedirectDelete(id: $id) { deletedUrlRedirectId userErrors { code } } }`, { id: r.id });
    expect(del.data.urlRedirectDelete.deletedUrlRedirectId).toBe(r.id);
    expect((await get('/promo')).statusCode).toBe(404);
    expect((await gql(`mutation($id: ID!) { urlRedirectDelete(id: $id) { userErrors { code } } }`, { id: r.id })).data.urlRedirectDelete.userErrors[0].code).toBe('DOES_NOT_EXIST');
  });

  it('changing a product, collection or page handle redirects the old URL (and flattens chains)', async () => {
    const db = t.dbHandle.db;
    const [product] = await db.select().from(s.products).where(eq(s.products.handle, 'house-espresso-blend'));
    expect((await updateProduct(db, shopId, product!.id, { handle: 'espresso-house' })).ok).toBe(true);
    const moved = await get('/products/house-espresso-blend?variant=5');
    expect(moved.statusCode).toBe(301);
    expect(moved.headers.location).toBe('/products/espresso-house?variant=5');
    expect((await get('/products/espresso-house')).statusCode).toBe(200);
    expect((await updateProduct(db, shopId, product!.id, { handle: 'espresso' })).ok).toBe(true);
    expect((await get('/products/house-espresso-blend')).headers.location).toBe('/products/espresso');
    expect((await get('/products/espresso-house')).headers.location).toBe('/products/espresso');
    // moving back removes the redirect that would point at itself
    expect((await updateProduct(db, shopId, product!.id, { handle: 'house-espresso-blend' })).ok).toBe(true);
    expect((await get('/products/house-espresso-blend')).statusCode).toBe(200);
    expect((await get('/products/espresso')).headers.location).toBe('/products/house-espresso-blend');

    const [collection] = await db.select().from(s.collections).where(eq(s.collections.handle, 'coffee'));
    expect((await updateCollection(db, shopId, collection!.id, { handle: 'beans' })).ok).toBe(true);
    expect((await get('/collections/coffee')).headers.location).toBe('/collections/beans');
    expect((await get('/collections/beans')).statusCode).toBe(200);

    const [page] = await db.select().from(s.pages).where(eq(s.pages.handle, 'about-us'));
    expect((await updatePage(db, shopId, page!.id, { handle: 'about' })).ok).toBe(true);
    expect((await get('/pages/about-us')).headers.location).toBe('/pages/about');
    expect((await get('/pages/about')).statusCode).toBe(200);
  });
});

describe('robots.txt and sitemap', () => {
  it('robots lists the private areas and the sitemap; the index points at non-empty child sitemaps', async () => {
    const robots = (await get('/robots.txt')).body;
    for (const line of ['User-agent: *', 'Disallow: /admin', 'Disallow: /checkout', 'Disallow: /cart', 'Allow: /account/login', 'Disallow: /account', 'Disallow: /collections/*sort_by*']) expect(robots).toContain(line);
    expect(robots).toMatch(/Sitemap: http\S+\/sitemap\.xml/);
    const index = await get('/sitemap.xml');
    expect(index.headers['content-type']).toContain('application/xml');
    expect(index.body).toContain('<sitemapindex');
    for (const type of ['products', 'collections', 'pages', 'blogs']) expect(index.body).toContain(`/sitemap_${type}_1.xml</loc>`);
    const products = (await get('/sitemap_products_1.xml')).body;
    expect(products).toContain('<urlset');
    expect(products).toContain('/products/');
    expect((await get('/sitemap_pages_1.xml')).body).toContain('<loc>http');
    expect((await get('/sitemap_products_2.xml')).statusCode).toBe(400);
  });
});
