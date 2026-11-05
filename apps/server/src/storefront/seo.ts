import { and, asc, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { listArticles, schema as s } from '@shopme/core';
import type { AppContext } from '../context';
import { listCollections } from './data/catalog';
import { listPages } from './data/content';
import type { createContent } from './pages';

/** `/robots.txt` and the sitemap index with its child sitemaps (products, collections, pages, blogs). */

const PER_FILE = 5000;
export const xmlEscape = (v: unknown) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
const XML = '<?xml version="1.0" encoding="UTF-8"?>\n';

export function robotsTxt(origin: string): string {
  return [
    '# ShopMe storefront. Public product, collection, page, blog and policy pages are crawlable.',
    '',
    'User-agent: *',
    'Allow: /',
    'Disallow: /admin',
    'Disallow: /cart',
    'Disallow: /checkout',
    'Disallow: /checkouts/',
    'Disallow: /orders',
    'Allow: /account/login',
    'Disallow: /account',
    'Disallow: /discount/',
    'Disallow: /recommendations/products',
    'Disallow: /collections/*sort_by*',
    'Disallow: /collections/*+*',
    'Disallow: /collections/*filter*&*filter*',
    'Disallow: /blogs/*+*',
    'Disallow: /*?*preview_theme_id=*',
    '',
    `Sitemap: ${origin}/sitemap.xml`,
    '',
  ].join('\n');
}

type Entry = { loc: string; lastmod?: Date | string | null; image?: string | null };
const urlset = (origin: string, entries: Entry[]) => `${XML}<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">${entries.map((e) =>
  `<url><loc>${xmlEscape(origin + e.loc)}</loc>${e.lastmod ? `<lastmod>${new Date(e.lastmod).toISOString()}</lastmod>` : ''}${e.image ? `<image:image><image:loc>${xmlEscape(e.image.startsWith('/') ? origin + e.image : e.image)}</image:loc></image:image>` : ''}</url>`).join('')}</urlset>`;

export function registerSeoRoutes(app: FastifyInstance, ctx: AppContext, content: ReturnType<typeof createContent>): void {
  const { db } = ctx;
  const { withShop } = content;
  const origin = ctx.config.appUrl;

  async function entries(shopId: number, type: string): Promise<Entry[]> {
    switch (type) {
      case 'products': {
        const rows = await db.select({ handle: s.products.handle, updatedAt: s.products.updatedAt }).from(s.products).where(and(eq(s.products.shopId, shopId), eq(s.products.status, 'ACTIVE'))).orderBy(asc(s.products.id));
        return rows.map((p) => ({ loc: `/products/${p.handle}`, lastmod: p.updatedAt }));
      }
      case 'collections': return [{ loc: '/collections/all' }, ...(await listCollections(db, shopId)).map((c) => ({ loc: `/collections/${c.handle}` }))];
      case 'pages': return (await listPages(db, shopId)).map((p) => ({ loc: p.url, lastmod: p.updated_at }));
      case 'blogs': {
        const blogs = await db.select().from(s.blogs).where(eq(s.blogs.shopId, shopId)).orderBy(asc(s.blogs.id));
        const out: Entry[] = blogs.map((b) => ({ loc: `/blogs/${b.handle}`, lastmod: b.updatedAt }));
        for (const a of await listArticles(db, shopId, { publishedOnly: true, offset: 0, limit: 50000 })) {
          const blog = blogs.find((b) => b.id === a.blogId);
          if (blog) out.push({ loc: `/blogs/${blog.handle}/${a.handle}`, lastmod: a.updatedAt, image: a.image?.url });
        }
        return out;
      }
      default: return [];
    }
  }

  app.get('/robots.txt', async (_req, reply) => reply.type('text/plain; charset=utf-8').send(robotsTxt(origin)));

  app.get('/sitemap.xml', withShop(async (_req, reply, shop) => {
    const children: string[] = [];
    for (const type of ['products', 'collections', 'pages', 'blogs']) {
      const n = (await entries(shop.id, type)).length;
      for (let i = 1; i <= Math.max(1, Math.ceil(n / PER_FILE)) && n > 0; i++) children.push(`${origin}/sitemap_${type}_${i}.xml`);
    }
    return reply.type('application/xml; charset=utf-8').send(`${XML}<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${children.map((c) => `<sitemap><loc>${xmlEscape(c)}</loc></sitemap>`).join('')}</sitemapindex>`);
  }));

  app.get('/sitemap_*', withShop(async (req, reply, shop) => {
    const m = /^([a-z]+)_(\d+)\.xml$/.exec((req.params as { '*': string })['*']);
    if (!m) return reply.code(400).type('application/xml; charset=utf-8').send('');
    const [, type = '', n = ''] = m;
    const page = Number(n);
    if (!['products', 'collections', 'pages', 'blogs'].includes(type) || !Number.isInteger(page) || page < 1) return reply.code(400).type('application/xml; charset=utf-8').send('');
    const all = await entries(shop.id, type);
    const slice = all.slice((page - 1) * PER_FILE, page * PER_FILE);
    if (!slice.length && page > 1) return reply.code(400).type('application/xml; charset=utf-8').send('');
    return reply.type('application/xml; charset=utf-8').send(urlset(origin, page === 1 && type === 'pages' ? [{ loc: '/' }, ...slice] : slice));
  }));
}
