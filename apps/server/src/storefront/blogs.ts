import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { articleTags, listArticles, type Blog, type Shop } from '@shopme/core';
import type { AppContext } from '../context';
import { articleNeighbours, buildBlog, getBlog, getPublishedArticle } from './data/blogs';
import { makeEnv, type Query } from './env';
import type { createContent } from './pages';
import { xmlEscape } from './seo';

const first = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);
const plain = (html: string) => html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

/** `/blogs/:blog`, `/blogs/:blog/tagged/:tag`, `/blogs/:blog/:article` and the Atom feed `/blogs/:blog.atom`. */
export function registerBlogRoutes(app: FastifyInstance, ctx: AppContext, content: ReturnType<typeof createContent>): void {
  const { db } = ctx;
  const { withShop, renderTemplate, notFound } = content;

  async function atom(req: FastifyRequest, reply: FastifyReply, shop: Shop, blog: Blog) {
    const origin = ctx.config.appUrl;
    const items = await listArticles(db, shop.id, { blogId: blog.id, publishedOnly: true, offset: 0, limit: 25 });
    const url = `${origin}/blogs/${blog.handle}`;
    const updated = items[0]?.updatedAt ?? blog.updatedAt;
    const entries = items.map((a) => `<entry><id>${xmlEscape(`${url}/${a.handle}`)}</id><published>${a.publishedAt!.toISOString()}</published><updated>${a.updatedAt.toISOString()}</updated>`
      + `<link rel="alternate" type="text/html" href="${xmlEscape(`${url}/${a.handle}`)}"/><title>${xmlEscape(a.title)}</title><author><name>${xmlEscape(a.author ?? shop.name)}</name></author>`
      + `${a.tags.map((t) => `<category term="${xmlEscape(t)}"/>`).join('')}<summary type="html">${xmlEscape(a.summaryHtml ?? plain(a.bodyHtml).slice(0, 300))}</summary><content type="html">${xmlEscape(a.bodyHtml)}</content></entry>`).join('');
    return reply.type('application/atom+xml; charset=utf-8').send(`<?xml version="1.0" encoding="UTF-8"?>\n<feed xml:lang="${xmlEscape(shop.locale)}" xmlns="http://www.w3.org/2005/Atom">`
      + `<id>${xmlEscape(`${url}.atom`)}</id><link rel="alternate" type="text/html" href="${xmlEscape(url)}"/><link rel="self" type="application/atom+xml" href="${xmlEscape(`${url}.atom`)}"/>`
      + `<title>${xmlEscape(`${shop.name} - ${blog.title}`)}</title><updated>${updated.toISOString()}</updated><author><name>${xmlEscape(shop.name)}</name></author>${entries}</feed>`);
    void req;
  }

  async function blogPage(req: FastifyRequest, reply: FastifyReply, shop: Shop, handle: string, tag?: string) {
    const env = await makeEnv(ctx, req, shop);
    const blog = await getBlog(db, shop.id, handle);
    if (!blog) return notFound(req, reply, shop, env);
    if (tag) {
      const known = (await articleTags(db, shop.id, { blogId: blog.id, publishedOnly: true })).find((t) => t.toLowerCase() === tag!.toLowerCase());
      if (!known) return notFound(req, reply, shop, env);
      tag = known;
    }
    const obj = await buildBlog(db, shop.id, blog, { tag });
    const page = parseInt(first((req.query as Query).page) ?? '1', 10);
    const title = `${blog.title}${tag ? ` - tagged "${tag}"` : ''}${page > 1 ? ` - Page ${page}` : ''}`;
    return renderTemplate(req, reply, env, { template: 'blog', pageType: 'blog', title, suffix: first((req.query as Query).view) ?? blog.templateSuffix, extra: { blog: obj, current_tags: tag ? [tag] : [] } });
  }

  app.get('/blogs/:blog', withShop(async (req, reply, shop) => {
    const raw = decodeURIComponent((req.params as { blog: string }).blog);
    if (raw.endsWith('.atom')) {
      const blog = await getBlog(db, shop.id, raw.slice(0, -'.atom'.length));
      return blog ? atom(req, reply, shop, blog) : notFound(req, reply, shop);
    }
    return blogPage(req, reply, shop, raw);
  }));
  app.get('/blogs/:blog/tagged/:tag', withShop(async (req, reply, shop) => {
    const p = req.params as { blog: string; tag: string };
    return blogPage(req, reply, shop, decodeURIComponent(p.blog), decodeURIComponent(p.tag));
  }));
  app.get('/blogs/:blog/:article', withShop(async (req, reply, shop) => {
    const p = req.params as { blog: string; article: string };
    const env = await makeEnv(ctx, req, shop);
    const blogRow = await getBlog(db, shop.id, decodeURIComponent(p.blog));
    const article = blogRow ? await getPublishedArticle(db, shop.id, blogRow, decodeURIComponent(p.article)) : null;
    if (!blogRow || !article) return notFound(req, reply, shop, env);
    const blog = await buildBlog(db, shop.id, blogRow);
    const { next, previous } = await articleNeighbours(db, shop.id, blogRow, article);
    blog.next_article = next;
    blog.previous_article = previous;
    return renderTemplate(req, reply, env, {
      template: 'article', pageType: 'article', title: article.title, suffix: first((req.query as Query).view) ?? (article.template_suffix || null), extra: { article, blog },
      description: plain(article.excerpt || article.content).slice(0, 320),
    });
  }));
}
