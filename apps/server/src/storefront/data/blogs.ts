import { lazyList } from '@shopme/liquid-compat';
import { articleTags, countArticles, getArticleByHandle, getBlogByHandle, listArticles, listBlogs, type ArticleWithImage, type Blog, type Db } from '@shopme/core';

/** Plain objects handed to Liquid for blogs and articles. */
export interface ImageObject { src: string; url: string; alt: string | null; width: number | null; height: number | null; aspect_ratio: number | null }

export interface ArticleObject {
  id: number; handle: string; title: string; url: string; author: string; content: string; excerpt: string; excerpt_or_content: string; tags: string[];
  image: ImageObject | null; published_at: string | null; created_at: string; updated_at: string; template_suffix: string; seo: { title: string | null; description: string | null };
  comments: unknown[]; comments_count: number; 'comments_enabled?': boolean; 'moderated?': boolean; metafields: Record<string, unknown>; user: null; blog: BlogBase;
}
export interface BlogBase {
  id: number; handle: string; title: string; url: string; template_suffix: string; 'comments_enabled?': boolean; 'moderated?': boolean; metafields: Record<string, unknown>; created_at: string; updated_at: string;
}
export interface BlogObject extends BlogBase {
  articles: ArticleObject[]; articles_count: number; all_tags: string[]; tags: string[]; next_article: ArticleObject | null; previous_article: ArticleObject | null;
}

const PREVIEW = 50;

export const blogBase = (b: Blog): BlogBase => ({
  id: b.id, handle: b.handle, title: b.title, url: `/blogs/${b.handle}`, template_suffix: b.templateSuffix ?? '', 'comments_enabled?': b.commentPolicy !== 'CLOSED', 'moderated?': b.commentPolicy === 'MODERATED',
  metafields: {}, created_at: b.createdAt.toISOString(), updated_at: b.updatedAt.toISOString(),
});

export function articleObject(a: ArticleWithImage, blog: Blog): ArticleObject {
  const base = blogBase(blog);
  return {
    id: a.id, handle: a.handle, title: a.title, url: `/blogs/${blog.handle}/${a.handle}`, author: a.author ?? '', content: a.bodyHtml,
    excerpt: a.summaryHtml ?? '', excerpt_or_content: a.summaryHtml || a.bodyHtml, tags: a.tags,
    image: a.image ? { src: a.image.url, url: a.image.url, alt: a.image.alt, width: null, height: null, aspect_ratio: null } : null,
    published_at: a.publishedAt?.toISOString() ?? null, created_at: a.createdAt.toISOString(), updated_at: a.updatedAt.toISOString(), template_suffix: a.templateSuffix ?? '', seo: { title: a.seoTitle, description: a.seoDescription },
    comments: [], comments_count: 0, 'comments_enabled?': base['comments_enabled?'], 'moderated?': base['moderated?'], metafields: {}, user: null, blog: base,
  };
}

export async function getBlog(db: Db, shopId: number, handle: string): Promise<Blog | null> { return getBlogByHandle(db, shopId, handle); }

/** `blog` Liquid object; `articles` lists published articles (optionally of one tag) newest first, paginated lazily. */
export async function buildBlog(db: Db, shopId: number, blog: Blog, opts: { tag?: string } = {}): Promise<BlogObject> {
  const where = { blogId: blog.id, publishedOnly: true, tag: opts.tag };
  const total = await countArticles(db, shopId, where);
  const load = async (offset: number, limit: number) => (await listArticles(db, shopId, { ...where, offset, limit })).map((a) => articleObject(a, blog));
  const preview = await load(0, PREVIEW);
  const allTags = await articleTags(db, shopId, { blogId: blog.id, publishedOnly: true });
  return {
    ...blogBase(blog), articles: lazyList(preview, total, load) as ArticleObject[], articles_count: total, all_tags: allTags, tags: allTags, next_article: null, previous_article: null,
  };
}

/** Published article of a blog by handle, with its blog; null when missing or not yet published. */
export async function getPublishedArticle(db: Db, shopId: number, blog: Blog, handle: string): Promise<ArticleObject | null> {
  const a = await getArticleByHandle(db, shopId, blog.id, handle);
  return a && a.publishedAt && a.publishedAt <= new Date() ? articleObject(a, blog) : null;
}

/** Neighbours in publication order: `previous` is the older article, `next` the newer one. */
export async function articleNeighbours(db: Db, shopId: number, blog: Blog, article: ArticleObject): Promise<{ previous: ArticleObject | null; next: ArticleObject | null }> {
  const all = await listArticles(db, shopId, { blogId: blog.id, publishedOnly: true, offset: 0, limit: 1000 });
  const i = all.findIndex((a) => a.id === article.id);
  return { next: i > 0 ? articleObject(all[i - 1]!, blog) : null, previous: i >= 0 && i < all.length - 1 ? articleObject(all[i + 1]!, blog) : null };
}

export async function listBlogHandles(db: Db, shopId: number): Promise<Blog[]> { return listBlogs(db, shopId, { offset: 0, limit: 250 }); }
