import { and, asc, eq } from 'drizzle-orm';
import { schema as s, type Db, type Translator } from '@shopme/core';

export interface PageObject { id: number; handle: string; title: string; content: string; url: string; author: string; template_suffix: string; published_at: string | null; created_at: string; updated_at: string }

const visible = (p: { publishedAt: Date | null }) => !!p.publishedAt && p.publishedAt <= new Date();

const toPage = (p: typeof s.pages.$inferSelect): PageObject => ({
  id: p.id, handle: p.handle, title: p.title, content: p.bodyHtml, url: `/pages/${p.handle}`, author: '', template_suffix: p.templateSuffix ?? '',
  published_at: p.publishedAt?.toISOString() ?? null, created_at: p.createdAt.toISOString(), updated_at: p.updatedAt.toISOString(),
});

export async function getPage(db: Db, shopId: number, handle: string): Promise<PageObject | null> {
  const [p] = await db.select().from(s.pages).where(and(eq(s.pages.shopId, shopId), eq(s.pages.handle, handle))).limit(1);
  return p && visible(p) ? toPage(p) : null;
}

export async function listPages(db: Db, shopId: number): Promise<PageObject[]> {
  return (await db.select().from(s.pages).where(eq(s.pages.shopId, shopId)).orderBy(asc(s.pages.title))).filter(visible).map(toPage);
}

export interface LinkObject { title: string; url: string; type: string; handle: string; object: unknown; active: boolean; current: boolean; child_active: boolean; child_current: boolean; levels: number; links: LinkObject[] }
export interface LinklistObject { id: number; handle: string; title: string; levels: number; links: LinkObject[] }

const LINK_TYPES: Record<string, string> = { PRODUCT: 'product_link', COLLECTION: 'collection_link', PAGE: 'page_link', BLOG: 'blog_link', FRONTPAGE: 'frontpage_link', CATALOG: 'catalog_link', HTTP: 'http_link' };

/** All navigation menus as Liquid `linklists` (nested links). `currentPath` marks active links. */
export async function listMenus(db: Db, shopId: number, currentPath: string, tr?: Translator): Promise<LinklistObject[]> {
  const [menus, items] = await Promise.all([
    db.select().from(s.menus).where(eq(s.menus.shopId, shopId)).orderBy(asc(s.menus.id)),
    db.select().from(s.menuItems).where(eq(s.menuItems.shopId, shopId)).orderBy(asc(s.menuItems.position), asc(s.menuItems.id)),
  ]);
  const build = (menuId: number, parent: number | null): LinkObject[] => items.filter((i) => i.menuId === menuId && (i.parentId ?? null) === parent).map((i) => {
    const links = build(menuId, i.id);
    const url = i.url ?? '#';
    const current = url === currentPath;
    const active = current || (url !== '/' && currentPath.startsWith(`${url}/`));
    const handle = url.split('/').filter(Boolean).pop() ?? '';
    return {
      title: tr?.text('LINK', i.id, 'title', i.title) ?? i.title, url, type: LINK_TYPES[i.linkType] ?? 'http_link', handle, object: null, active: active || links.some((l) => l.active), current,
      child_active: links.some((l) => l.active), child_current: links.some((l) => l.current), levels: links.length ? 1 + Math.max(...links.map((l) => l.levels)) : 0, links,
    };
  });
  return menus.map((m) => { const links = build(m.id, null); return { id: m.id, handle: m.handle, title: tr?.text('MENU', m.id, 'title', m.title) ?? m.title, links, levels: links.length ? 1 + Math.max(...links.map((l) => l.levels)) : 0 }; });
}

export interface Policy { title: string; body: string; handle: string; url: string }

/** Store policies live in `shops.settings.policies` as `{ "<handle>": { title, body } }`. */
export function policiesOf(settings: Record<string, unknown>): Policy[] {
  const p = (settings.policies ?? {}) as Record<string, { title?: string; body?: string }>;
  return Object.entries(p).filter(([, v]) => v && v.body).map(([handle, v]) => ({ handle, title: v.title ?? handle, body: v.body ?? '', url: `/policies/${handle}` }));
}
