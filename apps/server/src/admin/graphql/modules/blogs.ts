import {
  articleTags, countArticles, countBlogs, createArticle, createBlog, deleteArticle, deleteBlog, getArticle, getBlog, getStaff, isArticlePublished, listArticles, listBlogs, updateArticle, updateBlog,
  type ArticleInput, type ArticleWithImage, type Blog as BlogRow, type Result,
} from '@shopme/core';
import { parseId, toGid, type UserError } from '@shopme/shopify-compat';
import { builder } from '../builder';
import { requireScope, type GraphQLContext } from '../context';
import { ConnectionArgs, defineConnection, paginate } from '../types/connection';
import { Count } from '../types/money';
import { Node, registerNode } from '../types/node';
import { absUrl } from '../types/catalog';
import { payloadWith, typedUserError } from '../types/sales';
import { Image } from './files';

/** Blogs and articles (Admin API names). Comments are not implemented: `commentPolicy` is stored and exposed only. */

const gidId = (raw: string | number | null | undefined, type: string) => (raw == null ? null : parseId(String(raw), type));
const fail = (field: string[], message: string, code = 'NOT_FOUND'): UserError[] => [{ field, message, code }];

const CommentPolicy = builder.enumType('CommentPolicy', { values: ['AUTO_PUBLISHED', 'CLOSED', 'MODERATED'] as const });
const BlogSortKeys = builder.enumType('BlogSortKeys', { values: ['CREATED_AT', 'HANDLE', 'ID', 'TITLE'] as const });
const ArticleSortKeys = builder.enumType('ArticleSortKeys', { values: ['AUTHOR', 'BLOG_TITLE', 'ID', 'PUBLISHED_AT', 'TITLE', 'UPDATED_AT'] as const });

/* ------------------------------ types ------------------------------ */

const Author = builder.objectRef<{ name: string }>('ArticleAuthor').implement({ fields: (t) => ({ name: t.exposeString('name') }) });
const Article = builder.objectRef<ArticleWithImage>('Article');
const ArticleConnection = defineConnection('Article', Article);

const Blog = builder.objectRef<BlogRow>('Blog');
Blog.implement({
  interfaces: [Node],
  fields: (t) => ({
    title: t.exposeString('title'),
    handle: t.exposeString('handle'),
    templateSuffix: t.exposeString('templateSuffix', { nullable: true }),
    commentPolicy: t.field({ type: CommentPolicy, resolve: (b) => b.commentPolicy as 'CLOSED' }),
    tags: t.field({ type: ['String'], nullable: true, resolve: (b, _a, ctx) => articleTags(ctx.db, ctx.shopId, { blogId: b.id }) }),
    createdAt: t.field({ type: 'DateTime', resolve: (b) => b.createdAt }),
    updatedAt: t.field({ type: 'DateTime', nullable: true, resolve: (b) => b.updatedAt }),
    articlesCount: t.field({ type: Count, nullable: true, args: { limit: t.arg.int({ defaultValue: 10000 }) }, resolve: async (b, _a, ctx) => ({ count: await countArticles(ctx.db, ctx.shopId, { blogId: b.id }), precision: 'EXACT' as const }) }),
    articles: t.field({
      type: ArticleConnection, args: { ...ConnectionArgs },
      resolve: (b, a, ctx) => paginate(a, {
        fetch: ({ offset, limit }) => listArticles(ctx.db, ctx.shopId, { blogId: b.id, reverse: !!a.reverse, offset, limit }),
        total: () => countArticles(ctx.db, ctx.shopId, { blogId: b.id }),
      }),
    }),
  }),
});
const BlogConnection = defineConnection('Blog', Blog);
registerNode('Blog', (ctx, id) => getBlog(ctx.db, ctx.shopId, id));

Article.implement({
  interfaces: [Node],
  fields: (t) => ({
    title: t.exposeString('title'),
    handle: t.exposeString('handle'),
    author: t.field({ type: Author, nullable: true, resolve: (a) => (a.author ? { name: a.author } : null) }),
    body: t.field({ type: 'HTML', resolve: (a) => a.bodyHtml }),
    summary: t.field({ type: 'HTML', nullable: true, resolve: (a) => a.summaryHtml }),
    tags: t.field({ type: ['String'], resolve: (a) => a.tags }),
    image: t.field({ type: Image, nullable: true, resolve: (a, _x, ctx) => (a.image ? { id: null, url: absUrl(ctx, a.image.url) ?? a.image.url, altText: a.image.alt, width: null, height: null } : null) }),
    isPublished: t.boolean({ resolve: (a) => isArticlePublished(a) }),
    publishedAt: t.field({ type: 'DateTime', nullable: true, resolve: (a) => a.publishedAt }),
    templateSuffix: t.exposeString('templateSuffix', { nullable: true }),
    blog: t.field({ type: Blog, resolve: async (a, _x, ctx) => (await getBlog(ctx.db, ctx.shopId, a.blogId))! }),
    createdAt: t.field({ type: 'DateTime', resolve: (a) => a.createdAt }),
    updatedAt: t.field({ type: 'DateTime', nullable: true, resolve: (a) => a.updatedAt }),
  }),
});
registerNode('Article', (ctx, id) => getArticle(ctx.db, ctx.shopId, id));

/* ------------------------------ inputs and payloads ------------------------------ */

const BLOG_CODES = ['BLANK', 'INVALID', 'TAKEN', 'TOO_LONG', 'NOT_FOUND'] as const;
const ARTICLE_CODES = ['AMBIGUOUS_AUTHOR', 'AMBIGUOUS_BLOG', 'AUTHOR_FIELD_REQUIRED', 'AUTHOR_MUST_EXIST', 'INVALID_PUBLISH_DATE', 'BLOG_REFERENCE_REQUIRED', 'UPLOAD_FAILED', 'BLANK', 'NOT_FOUND', 'TOO_LONG', 'TOO_SHORT', 'TAKEN', 'INVALID', 'INVALID_VALUE'] as const;

const BlogCreateInput = builder.inputType('BlogCreateInput', { fields: (t) => ({ handle: t.string(), templateSuffix: t.string(), commentPolicy: t.field({ type: CommentPolicy }), title: t.string({ required: true }) }) });
const BlogUpdateInput = builder.inputType('BlogUpdateInput', {
  fields: (t) => ({ handle: t.string(), templateSuffix: t.string(), commentPolicy: t.field({ type: CommentPolicy }), title: t.string(), redirectNewHandle: t.boolean({ defaultValue: false }), redirectArticles: t.boolean({ defaultValue: false }) }),
});
const AuthorInput = builder.inputType('AuthorInput', { fields: (t) => ({ name: t.string(), userId: t.id() }) });
const ArticleImageInput = builder.inputType('ArticleImageInput', { fields: (t) => ({ altText: t.string(), url: t.string() }) });
const ArticleBlogInput = builder.inputType('ArticleBlogInput', { fields: (t) => ({ title: t.string({ required: true }) }) });
const articleFields = (t: PothosSchemaTypes.InputFieldBuilder<PothosSchemaTypes.ExtendDefaultTypes<import('../builder').SchemaTypes>, 'InputObject'>) => ({
  blogId: t.id(), handle: t.string(), body: t.field({ type: 'HTML' }), summary: t.field({ type: 'HTML' }), isPublished: t.boolean(), publishDate: t.field({ type: 'DateTime' }),
  templateSuffix: t.string(), tags: t.stringList(), image: t.field({ type: ArticleImageInput }),
});
const ArticleCreateInput = builder.inputType('ArticleCreateInput', { fields: (t) => ({ ...articleFields(t), title: t.string({ required: true }), author: t.field({ type: AuthorInput, required: true }) }) });
const ArticleUpdateInput = builder.inputType('ArticleUpdateInput', { fields: (t) => ({ ...articleFields(t), title: t.string(), author: t.field({ type: AuthorInput }), redirectNewHandle: t.boolean({ defaultValue: false }) }) });

const BlogCreateError = typedUserError('BlogCreateUserError', BLOG_CODES);
const BlogUpdateError = typedUserError('BlogUpdateUserError', BLOG_CODES);
const BlogDeleteError = typedUserError('BlogDeleteUserError', BLOG_CODES);
const ArticleCreateError = typedUserError('ArticleCreateUserError', ARTICLE_CODES);
const ArticleUpdateError = typedUserError('ArticleUpdateUserError', ARTICLE_CODES);
const ArticleDeleteError = typedUserError('ArticleDeleteUserError', ARTICLE_CODES);
const BlogCreatePayload = payloadWith<{ blog: BlogRow | null }>('BlogCreatePayload', BlogCreateError, (t) => ({ blog: t.field({ type: Blog, nullable: true, resolve: (p) => p.blog }) }));
const BlogUpdatePayload = payloadWith<{ blog: BlogRow | null }>('BlogUpdatePayload', BlogUpdateError, (t) => ({ blog: t.field({ type: Blog, nullable: true, resolve: (p) => p.blog }) }));
const BlogDeletePayload = payloadWith<{ deletedBlogId: string | null }>('BlogDeletePayload', BlogDeleteError, (t) => ({ deletedBlogId: t.id({ nullable: true, resolve: (p) => p.deletedBlogId }) }));
const ArticleCreatePayload = payloadWith<{ article: ArticleWithImage | null }>('ArticleCreatePayload', ArticleCreateError, (t) => ({ article: t.field({ type: Article, nullable: true, resolve: (p) => p.article }) }));
const ArticleUpdatePayload = payloadWith<{ article: ArticleWithImage | null }>('ArticleUpdatePayload', ArticleUpdateError, (t) => ({ article: t.field({ type: Article, nullable: true, resolve: (p) => p.article }) }));
const ArticleDeletePayload = payloadWith<{ deletedArticleId: string | null }>('ArticleDeletePayload', ArticleDeleteError, (t) => ({ deletedArticleId: t.id({ nullable: true, resolve: (p) => p.deletedArticleId }) }));

type AuthorIn = { name?: string | null; userId?: string | null } | null | undefined;
/** `author` input -> name (a staff member id is resolved to their name). */
async function authorName(ctx: GraphQLContext, a: AuthorIn): Promise<Result<string | undefined>> {
  if (!a) return { ok: true, value: undefined };
  if (a.name && a.userId) return { ok: false, errors: fail(['article', 'author'], "Can't create an article author if both author name and user ID are supplied.", 'AMBIGUOUS_AUTHOR') };
  if (a.userId) {
    const id = gidId(a.userId, 'StaffMember');
    const staff = id ? await getStaff(ctx.db, ctx.shopId, id) : null;
    if (!staff) return { ok: false, errors: fail(['article', 'author', 'userId'], 'Author must exist', 'AUTHOR_MUST_EXIST') };
    return { ok: true, value: [staff.firstName, staff.lastName].filter(Boolean).join(' ') || staff.email };
  }
  return { ok: true, value: a.name ?? undefined };
}

const articleInput = (a: Record<string, any>, author: string | undefined, blogId: number | null | undefined): ArticleInput => ({
  blogId, title: a.title, handle: a.handle, author, body: a.body, summary: a.summary, tags: a.tags, isPublished: a.isPublished, publishDate: a.publishDate, templateSuffix: a.templateSuffix,
  ...(a.image !== undefined && { image: a.image ? { url: a.image.url, altText: a.image.altText } : null }),
});

/* ------------------------------ roots ------------------------------ */

builder.queryFields((t) => ({
  blog: t.field({ type: Blog, nullable: true, args: { id: t.arg.id({ required: true }) }, resolve: (_r, a, ctx) => { requireScope(ctx, 'read_content'); const id = gidId(a.id, 'Blog'); return id ? getBlog(ctx.db, ctx.shopId, id) : null; } }),
  blogs: t.field({
    type: BlogConnection, args: { ...ConnectionArgs, sortKey: t.arg({ type: BlogSortKeys, defaultValue: 'ID' }), query: t.arg.string(), savedSearchId: t.arg.id() },
    resolve: (_r, a, ctx) => {
      requireScope(ctx, 'read_content');
      return paginate(a, {
        fetch: ({ offset, limit }) => listBlogs(ctx.db, ctx.shopId, { query: a.query, sortKey: a.sortKey ?? 'ID', reverse: !!a.reverse, offset, limit }),
        total: async () => (await countBlogs(ctx.db, ctx.shopId, a.query)).count,
      });
    },
  }),
  blogsCount: t.field({ type: Count, nullable: true, args: { query: t.arg.string(), limit: t.arg.int({ defaultValue: 10000 }) }, resolve: (_r, a, ctx) => { requireScope(ctx, 'read_content'); return countBlogs(ctx.db, ctx.shopId, a.query, a.limit ?? 10000); } }),
  article: t.field({ type: Article, nullable: true, args: { id: t.arg.id({ required: true }) }, resolve: (_r, a, ctx) => { requireScope(ctx, 'read_content'); const id = gidId(a.id, 'Article'); return id ? getArticle(ctx.db, ctx.shopId, id) : null; } }),
  articles: t.field({
    type: ArticleConnection, args: { ...ConnectionArgs, sortKey: t.arg({ type: ArticleSortKeys, defaultValue: 'ID' }), query: t.arg.string(), savedSearchId: t.arg.id() },
    resolve: (_r, a, ctx) => {
      requireScope(ctx, 'read_content');
      return paginate(a, {
        fetch: ({ offset, limit }) => listArticles(ctx.db, ctx.shopId, { query: a.query, sortKey: a.sortKey ?? 'ID', reverse: !!a.reverse, offset, limit }),
        total: () => countArticles(ctx.db, ctx.shopId, { query: a.query }),
      });
    },
  }),
  articleTags: t.field({
    type: ['String'], args: { limit: t.arg.int({ required: true }), sort: t.arg.string() },
    resolve: async (_r, a, ctx) => { requireScope(ctx, 'read_content'); return (await articleTags(ctx.db, ctx.shopId)).slice(0, a.limit); },
  }),
}));

builder.mutationFields((t) => ({
  blogCreate: t.field({
    type: BlogCreatePayload, args: { blog: t.arg({ type: BlogCreateInput, required: true }) },
    resolve: async (_r, { blog }, ctx) => {
      requireScope(ctx, 'write_content');
      const r = await createBlog(ctx.db, ctx.shopId, blog);
      return r.ok ? { blog: r.value, userErrors: [] } : { blog: null, userErrors: r.errors.map((e) => ({ ...e, field: ['blog', ...(e.field ?? [])] })) };
    },
  }),
  blogUpdate: t.field({
    type: BlogUpdatePayload, args: { id: t.arg.id({ required: true }), blog: t.arg({ type: BlogUpdateInput, required: true }) },
    resolve: async (_r, a, ctx) => {
      requireScope(ctx, 'write_content');
      const id = gidId(a.id, 'Blog');
      if (!id) return { blog: null, userErrors: fail(['id'], 'Blog does not exist') };
      const r = await updateBlog(ctx.db, ctx.shopId, id, a.blog);
      return r.ok ? { blog: r.value, userErrors: [] } : { blog: null, userErrors: r.errors.map((e) => ({ ...e, field: e.field?.[0] === 'id' ? e.field : ['blog', ...(e.field ?? [])] })) };
    },
  }),
  blogDelete: t.field({
    type: BlogDeletePayload, args: { id: t.arg.id({ required: true }) },
    resolve: async (_r, a, ctx) => {
      requireScope(ctx, 'write_content');
      const id = gidId(a.id, 'Blog');
      const r = id ? await deleteBlog(ctx.db, ctx.shopId, id) : null;
      return r?.ok ? { deletedBlogId: toGid('Blog', id!), userErrors: [] } : { deletedBlogId: null, userErrors: fail(['id'], 'Blog does not exist') };
    },
  }),
  articleCreate: t.field({
    type: ArticleCreatePayload, args: { article: t.arg({ type: ArticleCreateInput, required: true }), blog: t.arg({ type: ArticleBlogInput }) },
    resolve: async (_r, a, ctx) => {
      requireScope(ctx, 'write_content');
      const author = await authorName(ctx, a.article.author);
      if (!author.ok) return { article: null, userErrors: author.errors };
      const r = await createArticle(ctx.db, ctx.shopId, { ...articleInput(a.article, author.value, gidId(a.article.blogId, 'Blog')), blogTitle: a.blog?.title });
      return r.ok ? { article: r.value, userErrors: [] } : { article: null, userErrors: r.errors };
    },
  }),
  articleUpdate: t.field({
    type: ArticleUpdatePayload, args: { id: t.arg.id({ required: true }), article: t.arg({ type: ArticleUpdateInput, required: true }), blog: t.arg({ type: ArticleBlogInput }) },
    resolve: async (_r, a, ctx) => {
      requireScope(ctx, 'write_content');
      const id = gidId(a.id, 'Article');
      if (!id) return { article: null, userErrors: fail(['id'], 'Article does not exist') };
      const author = await authorName(ctx, a.article.author);
      if (!author.ok) return { article: null, userErrors: author.errors };
      const r = await updateArticle(ctx.db, ctx.shopId, id, articleInput(a.article, author.value, gidId(a.article.blogId, 'Blog')));
      return r.ok ? { article: r.value, userErrors: [] } : { article: null, userErrors: r.errors };
    },
  }),
  articleDelete: t.field({
    type: ArticleDeletePayload, args: { id: t.arg.id({ required: true }) },
    resolve: async (_r, a, ctx) => {
      requireScope(ctx, 'write_content');
      const id = gidId(a.id, 'Article');
      const r = id ? await deleteArticle(ctx.db, ctx.shopId, id) : null;
      return r?.ok ? { deletedArticleId: toGid('Article', id!), userErrors: [] } : { deletedArticleId: null, userErrors: fail(['id'], 'Article does not exist') };
    },
  }),
}));

