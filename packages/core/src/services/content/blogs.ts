import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { articles, blogs, media } from '../../db/schema';
import type { Db, Executor } from '../../db/client';
import { buildSearch, dateCompare, idTerm, likeCi } from '../catalog/search';
import { errR, normalizeTags, okR, txResult, type Result } from '../catalog/common';
import { slugify, uniqueHandle } from '../handle';
import { redirectPathChange } from './redirects';

export type Blog = typeof blogs.$inferSelect;
export type Article = typeof articles.$inferSelect;
export type ArticleWithImage = Article & { image: { url: string; alt: string | null } | null };

export const COMMENT_POLICIES = ['CLOSED', 'AUTO_PUBLISHED', 'MODERATED'] as const;
const dir = (reverse?: boolean) => (reverse ? desc : asc);

/* ------------------------------ blogs ------------------------------ */

export async function getBlog(db: Executor, shopId: number, id: number): Promise<Blog | null> {
  return (await db.select().from(blogs).where(and(eq(blogs.shopId, shopId), eq(blogs.id, id))))[0] ?? null;
}
export async function getBlogByHandle(db: Executor, shopId: number, handle: string): Promise<Blog | null> {
  return (await db.select().from(blogs).where(and(eq(blogs.shopId, shopId), eq(blogs.handle, handle))))[0] ?? null;
}

const blogSearch = (q?: string | null) => buildSearch(q, {
  fields: {
    title: (_o, v) => likeCi(blogs.title, v), handle: (_o, v) => likeCi(blogs.handle, v, true), id: (_o, v) => idTerm(blogs.id, v),
    created_at: (op, v) => dateCompare(blogs.createdAt, op, v), updated_at: (op, v) => dateCompare(blogs.updatedAt, op, v),
  },
  text: (v) => sql`(${likeCi(blogs.title, v)} or ${likeCi(blogs.handle, v)})`,
});

export function listBlogs(db: Executor, shopId: number, o: { query?: string | null; sortKey?: string; reverse?: boolean; offset: number; limit: number }): Promise<Blog[]> {
  const col = ({ CREATED_AT: blogs.createdAt, HANDLE: blogs.handle, TITLE: sql`lower(${blogs.title})` } as Record<string, unknown>)[o.sortKey ?? 'ID'] ?? blogs.id;
  return db.select().from(blogs).where(and(eq(blogs.shopId, shopId), blogSearch(o.query))).orderBy(dir(o.reverse)(col as never), dir(o.reverse)(blogs.id)).limit(o.limit).offset(o.offset);
}

export async function countBlogs(db: Executor, shopId: number, query?: string | null, limit = 10000): Promise<{ count: number; precision: 'EXACT' | 'AT_LEAST' }> {
  const rows = await db.select({ id: blogs.id }).from(blogs).where(and(eq(blogs.shopId, shopId), blogSearch(query))).limit(limit + 1);
  return rows.length > limit ? { count: limit, precision: 'AT_LEAST' } : { count: rows.length, precision: 'EXACT' };
}

export interface BlogInput { title?: string | null; handle?: string | null; templateSuffix?: string | null; commentPolicy?: string | null; redirectArticles?: boolean | null }

const policyOk = (p?: string | null) => !p || (COMMENT_POLICIES as readonly string[]).includes(p);

export async function createBlog(db: Executor, shopId: number, i: BlogInput): Promise<Result<Blog>> {
  if (!i.title?.trim()) return errR(['title'], "Title can't be blank", 'BLANK');
  if (!policyOk(i.commentPolicy)) return errR(['commentPolicy'], 'Comment policy is invalid', 'INVALID');
  const taken = async (h: string) => !!(await getBlogByHandle(db, shopId, h));
  if (i.handle?.trim() && (await taken(slugify(i.handle)))) return errR(['handle'], 'Handle has already been taken', 'TAKEN');
  const handle = i.handle?.trim() ? slugify(i.handle) : await uniqueHandle(i.title, taken);
  const [row] = await db.insert(blogs).values({ shopId, title: i.title.trim(), handle, templateSuffix: i.templateSuffix || null, commentPolicy: i.commentPolicy ?? 'CLOSED' }).returning();
  return okR(row!);
}

export async function updateBlog(db: Db, shopId: number, id: number, i: BlogInput): Promise<Result<Blog>> {
  const cur = await getBlog(db, shopId, id);
  if (!cur) return errR(['id'], 'Blog does not exist', 'NOT_FOUND');
  if (i.title !== undefined && !i.title?.trim()) return errR(['title'], "Title can't be blank", 'BLANK');
  if (!policyOk(i.commentPolicy)) return errR(['commentPolicy'], 'Comment policy is invalid', 'INVALID');
  const handle = i.handle?.trim() ? slugify(i.handle) : undefined;
  if (handle && handle !== cur.handle && (await getBlogByHandle(db, shopId, handle))) return errR(['handle'], 'Handle has already been taken', 'TAKEN');
  return txResult(db, async (tx) => {
    const [row] = await tx.update(blogs).set({
      ...(i.title && { title: i.title.trim() }), ...(handle && { handle }), ...(i.templateSuffix !== undefined && { templateSuffix: i.templateSuffix || null }),
      ...(i.commentPolicy && { commentPolicy: i.commentPolicy }), updatedAt: new Date(),
    }).where(eq(blogs.id, id)).returning();
    if (handle && handle !== cur.handle) {
      await redirectPathChange(tx, shopId, `/blogs/${cur.handle}`, `/blogs/${handle}`);
      if (i.redirectArticles) for (const a of await tx.select({ handle: articles.handle }).from(articles).where(eq(articles.blogId, id))) await redirectPathChange(tx, shopId, `/blogs/${cur.handle}/${a.handle}`, `/blogs/${handle}/${a.handle}`);
    }
    return okR(row!);
  });
}

export async function deleteBlog(db: Db, shopId: number, id: number): Promise<Result<number>> {
  if (!(await getBlog(db, shopId, id))) return errR(['id'], 'Blog does not exist', 'NOT_FOUND');
  await db.delete(blogs).where(eq(blogs.id, id)); // articles cascade
  return okR(id);
}

/* ------------------------------ articles ------------------------------ */

const visible = sql`(${articles.publishedAt} is not null and ${articles.publishedAt} <= now())`;
export const isArticlePublished = (a: Pick<Article, 'publishedAt'>) => !!a.publishedAt && a.publishedAt <= new Date();

async function withImages(db: Executor, rows: Article[]): Promise<ArticleWithImage[]> {
  const ids = [...new Set(rows.flatMap((r) => (r.imageMediaId ? [r.imageMediaId] : [])))];
  const ms = ids.length ? await db.select({ id: media.id, url: media.url, alt: media.alt }).from(media).where(inArray(media.id, ids)) : [];
  return rows.map((r) => {
    const m = ms.find((x) => x.id === r.imageMediaId);
    return { ...r, image: m?.url ? { url: m.url, alt: m.alt } : null };
  });
}

export async function getArticle(db: Executor, shopId: number, id: number): Promise<ArticleWithImage | null> {
  const rows = await db.select().from(articles).where(and(eq(articles.shopId, shopId), eq(articles.id, id)));
  return (await withImages(db, rows))[0] ?? null;
}
export async function getArticleByHandle(db: Executor, shopId: number, blogId: number, handle: string): Promise<ArticleWithImage | null> {
  const rows = await db.select().from(articles).where(and(eq(articles.shopId, shopId), eq(articles.blogId, blogId), eq(articles.handle, handle)));
  return (await withImages(db, rows))[0] ?? null;
}

const articleSearch = (q?: string | null) => buildSearch(q, {
  fields: {
    title: (_o, v) => likeCi(articles.title, v), handle: (_o, v) => likeCi(articles.handle, v, true), author: (_o, v) => likeCi(articles.author, v), id: (_o, v) => idTerm(articles.id, v),
    blog_id: (_o, v) => idTerm(articles.blogId, v), tag: (_o, v) => sql`exists (select 1 from unnest(${articles.tags}) t where lower(t) = ${v.toLowerCase()})`,
    published_status: (_o, v) => (v === 'published' ? visible : v === 'unpublished' ? sql`not ${visible}` : null),
    created_at: (op, v) => dateCompare(articles.createdAt, op, v), updated_at: (op, v) => dateCompare(articles.updatedAt, op, v), published_at: (op, v) => dateCompare(articles.publishedAt, op, v),
  },
  text: (v) => sql`(${likeCi(articles.title, v)} or ${likeCi(articles.handle, v)} or ${likeCi(articles.author, v)} or ${likeCi(articles.bodyHtml, v)})`,
});

export interface ArticleListOptions { blogId?: number; query?: string | null; sortKey?: string; reverse?: boolean; offset: number; limit: number; publishedOnly?: boolean; tag?: string }

const articleWhere = (shopId: number, o: Pick<ArticleListOptions, 'blogId' | 'query' | 'publishedOnly' | 'tag'>) => and(
  eq(articles.shopId, shopId), o.blogId ? eq(articles.blogId, o.blogId) : undefined, o.publishedOnly ? visible : undefined,
  o.tag ? sql`exists (select 1 from unnest(${articles.tags}) t where lower(t) = ${o.tag.toLowerCase()})` : undefined, articleSearch(o.query),
);

export async function listArticles(db: Executor, shopId: number, o: ArticleListOptions): Promise<ArticleWithImage[]> {
  const col = ({ AUTHOR: sql`lower(${articles.author})`, BLOG_TITLE: sql`(select lower(b.title) from blogs b where b.id = ${articles.blogId})`, PUBLISHED_AT: articles.publishedAt, TITLE: sql`lower(${articles.title})`, UPDATED_AT: articles.updatedAt } as Record<string, unknown>)[o.sortKey ?? 'ID'] ?? articles.id;
  // Storefront order: newest first.
  const d = o.sortKey ? dir(o.reverse) : o.publishedOnly ? desc : dir(o.reverse);
  const sortCol = o.sortKey ? col : o.publishedOnly ? articles.publishedAt : col;
  const rows = await db.select().from(articles).where(articleWhere(shopId, o)).orderBy(d(sortCol as never), d(articles.id)).limit(o.limit).offset(o.offset);
  return withImages(db, rows);
}

export async function countArticles(db: Executor, shopId: number, o: Pick<ArticleListOptions, 'blogId' | 'query' | 'publishedOnly' | 'tag'> = {}): Promise<number> {
  const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(articles).where(articleWhere(shopId, o));
  return r?.n ?? 0;
}

/** Distinct tags of (published) articles, alphabetical. */
export async function articleTags(db: Executor, shopId: number, o: { blogId?: number; publishedOnly?: boolean } = {}): Promise<string[]> {
  const rows = await db.select({ tags: articles.tags }).from(articles).where(and(eq(articles.shopId, shopId), o.blogId ? eq(articles.blogId, o.blogId) : undefined, o.publishedOnly ? visible : undefined));
  return normalizeTags(rows.flatMap((r) => r.tags));
}

export interface ArticleInput {
  blogId?: number | null; /** Create the blog on the fly (Shopify `ArticleBlogInput`). */ blogTitle?: string | null;
  title?: string | null; handle?: string | null; author?: string | null; body?: string | null; summary?: string | null; tags?: string[] | null;
  isPublished?: boolean | null; publishDate?: Date | null; templateSuffix?: string | null; image?: { url?: string | null; altText?: string | null } | null;
}

const publishedAt = (i: ArticleInput, cur?: Date | null): Date | null | undefined => {
  if (i.isPublished === false) return null;
  if (i.publishDate) return i.publishDate;
  if (i.isPublished === true) return cur ?? new Date();
  return undefined;
};

async function setImage(tx: Executor, shopId: number, image: NonNullable<ArticleInput['image']>): Promise<number | null> {
  if (!image.url) return null;
  const [m] = await tx.insert(media).values({ shopId, type: 'IMAGE', url: image.url, alt: image.altText ?? null }).returning();
  return m!.id;
}

export async function createArticle(db: Db, shopId: number, i: ArticleInput): Promise<Result<ArticleWithImage>> {
  if (i.blogId && i.blogTitle) return errR(['blog'], 'Provide either a blog id or a new blog, not both', 'AMBIGUOUS_BLOG');
  if (!i.blogId && !i.blogTitle) return errR(['article', 'blogId'], 'A blog is required', 'BLOG_REFERENCE_REQUIRED');
  if (!i.title?.trim()) return errR(['article', 'title'], "Title can't be blank", 'BLANK');
  if (!i.author?.trim()) return errR(['article', 'author'], "Author can't be blank", 'AUTHOR_FIELD_REQUIRED');
  return txResult(db, async (tx) => {
    let blog: Blog | null;
    if (i.blogId) blog = await getBlog(tx, shopId, i.blogId);
    else {
      const b = await createBlog(tx, shopId, { title: i.blogTitle });
      blog = b.ok ? b.value : null;
    }
    if (!blog) return errR(['article', 'blogId'], 'Blog does not exist', 'NOT_FOUND');
    const taken = async (h: string) => !!(await getArticleByHandle(tx, shopId, blog!.id, h));
    if (i.handle?.trim() && (await taken(slugify(i.handle)))) return errR(['article', 'handle'], 'Handle has already been taken', 'TAKEN');
    const handle = i.handle?.trim() ? slugify(i.handle) : await uniqueHandle(i.title!, taken);
    const imageMediaId = i.image ? await setImage(tx, shopId, i.image) : null;
    const [row] = await tx.insert(articles).values({
      shopId, blogId: blog.id, handle, title: i.title!.trim(), author: i.author!.trim(), bodyHtml: i.body ?? '', summaryHtml: i.summary ?? null, tags: normalizeTags(i.tags ?? []),
      imageMediaId, templateSuffix: i.templateSuffix || null, publishedAt: publishedAt({ isPublished: true, ...i }) ?? null,
    }).returning();
    return okR((await getArticle(tx, shopId, row!.id))!);
  });
}

export async function updateArticle(db: Db, shopId: number, id: number, i: ArticleInput): Promise<Result<ArticleWithImage>> {
  const cur = await getArticle(db, shopId, id);
  if (!cur) return errR(['id'], 'Article does not exist', 'NOT_FOUND');
  if (i.title !== undefined && !i.title?.trim()) return errR(['article', 'title'], "Title can't be blank", 'BLANK');
  if (i.author !== undefined && !i.author?.trim()) return errR(['article', 'author'], "Author can't be blank", 'AUTHOR_FIELD_REQUIRED');
  return txResult(db, async (tx) => {
    const blogId = i.blogId ?? cur.blogId;
    const [oldBlog, newBlog] = await Promise.all([getBlog(tx, shopId, cur.blogId), blogId === cur.blogId ? null : getBlog(tx, shopId, blogId)]);
    if (blogId !== cur.blogId && !newBlog) return errR(['article', 'blogId'], 'Blog does not exist', 'NOT_FOUND');
    const blog = newBlog ?? oldBlog!;
    const wanted = i.handle?.trim() ? slugify(i.handle) : cur.handle;
    const clash = async (h: string) => (blogId !== cur.blogId || h !== cur.handle) && !!(await getArticleByHandle(tx, shopId, blogId, h));
    if ((wanted !== cur.handle || blogId !== cur.blogId) && (await clash(wanted))) return errR(['article', 'handle'], 'Handle has already been taken', 'TAKEN');
    const pub = publishedAt(i, cur.publishedAt);
    const imageMediaId = i.image === undefined ? undefined : i.image ? await setImage(tx, shopId, i.image) : null;
    await tx.update(articles).set({
      blogId, handle: wanted, ...(i.title && { title: i.title.trim() }), ...(i.author && { author: i.author.trim() }), ...(i.body != null && { bodyHtml: i.body }),
      ...(i.summary !== undefined && { summaryHtml: i.summary }), ...(i.tags && { tags: normalizeTags(i.tags) }), ...(i.templateSuffix !== undefined && { templateSuffix: i.templateSuffix || null }),
      ...(pub !== undefined && { publishedAt: pub }), ...(imageMediaId !== undefined && { imageMediaId }), updatedAt: new Date(),
    }).where(eq(articles.id, id));
    if (wanted !== cur.handle || blogId !== cur.blogId) await redirectPathChange(tx, shopId, `/blogs/${oldBlog!.handle}/${cur.handle}`, `/blogs/${blog.handle}/${wanted}`);
    return okR((await getArticle(tx, shopId, id))!);
  });
}

export async function deleteArticle(db: Db, shopId: number, id: number): Promise<Result<number>> {
  if (!(await getArticle(db, shopId, id))) return errR(['id'], 'Article does not exist', 'NOT_FOUND');
  await db.delete(articles).where(eq(articles.id, id));
  return okR(id);
}
