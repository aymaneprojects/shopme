import { createHash } from 'node:crypto';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { collections, menuItems, menus, pages, products, themeFileVersions, themeFiles, themes } from '../../db/schema';
import type { Db, Executor } from '../../db/client';
import { buildSearch, dateCompare, idTerm, likeCi } from '../catalog/search';
import { errR, okR, txResult, type Result } from '../catalog/common';
import { slugify, uniqueHandle } from '../handle';
import { THEME_DIRS } from '../theme-install';
import { addEvent } from '../events';
import { redirectPathChange } from './redirects';
import { cleanHtml } from './html-sanitize';

/* ------------------------------ pages ------------------------------ */

export type Page = typeof pages.$inferSelect;

export async function getPage(db: Executor, shopId: number, id: number): Promise<Page | null> {
  return (await db.select().from(pages).where(and(eq(pages.shopId, shopId), eq(pages.id, id))))[0] ?? null;
}

const pageSearch = (q?: string | null) => buildSearch(q, {
  fields: {
    title: (_o, v) => likeCi(pages.title, v), handle: (_o, v) => likeCi(pages.handle, v, true), id: (_o, v) => idTerm(pages.id, v),
    published_status: (_o, v) => (v === 'published' ? sql`${pages.publishedAt} is not null and ${pages.publishedAt} <= now()` : v === 'unpublished' ? sql`(${pages.publishedAt} is null or ${pages.publishedAt} > now())` : null),
    created_at: (op, v) => dateCompare(pages.createdAt, op, v), updated_at: (op, v) => dateCompare(pages.updatedAt, op, v),
  },
  text: (v) => sql`(${likeCi(pages.title, v)} or ${likeCi(pages.handle, v)})`,
});

export async function listPages(db: Executor, shopId: number, o: { query?: string | null; sortKey?: string; reverse?: boolean; offset: number; limit: number }): Promise<Page[]> {
  const col = ({ CREATED_AT: pages.createdAt, PUBLISHED_AT: pages.publishedAt, TITLE: sql`lower(${pages.title})`, UPDATED_AT: pages.updatedAt } as Record<string, unknown>)[o.sortKey ?? 'ID'] ?? pages.id;
  const dir = o.reverse ? desc : asc;
  return db.select().from(pages).where(and(eq(pages.shopId, shopId), pageSearch(o.query))).orderBy(dir(col as never), dir(pages.id)).limit(o.limit).offset(o.offset);
}

export async function countPages(db: Executor, shopId: number, limit = 10000): Promise<{ count: number; precision: 'EXACT' | 'AT_LEAST' }> {
  const rows = await db.select({ id: pages.id }).from(pages).where(eq(pages.shopId, shopId)).limit(limit + 1);
  return rows.length > limit ? { count: limit, precision: 'AT_LEAST' } : { count: rows.length, precision: 'EXACT' };
}

export interface PageInput { title?: string | null; handle?: string | null; body?: string | null; isPublished?: boolean | null; publishDate?: Date | null; templateSuffix?: string | null; seoTitle?: string | null; seoDescription?: string | null }

const publishedAt = (i: PageInput, cur?: Date | null): Date | null | undefined => {
  if (i.isPublished === false) return null;
  if (i.publishDate) return i.publishDate;
  if (i.isPublished === true) return cur ?? new Date();
  return undefined;
};

export async function createPage(db: Db, shopId: number, i: PageInput): Promise<Result<Page>> {
  if (!i.title?.trim()) return errR(['title'], "Title can't be blank", 'BLANK');
  const taken = async (h: string) => !!(await db.select({ id: pages.id }).from(pages).where(and(eq(pages.shopId, shopId), eq(pages.handle, h))))[0];
  if (i.handle?.trim() && (await taken(slugify(i.handle)))) return errR(['handle'], "Handle has already been taken", 'TAKEN');
  const handle = i.handle?.trim() ? slugify(i.handle) : await uniqueHandle(slugify(i.title) || 'page', taken);
  const [row] = await db.insert(pages).values({
    shopId, title: i.title.trim(), handle, bodyHtml: cleanHtml(i.body) ?? '', templateSuffix: i.templateSuffix || null, seoTitle: i.seoTitle?.trim() || null, seoDescription: i.seoDescription?.trim() || null,
    publishedAt: publishedAt({ isPublished: true, ...i }) ?? null,
  }).returning();
  return okR(row!);
}

export async function updatePage(db: Db, shopId: number, id: number, i: PageInput): Promise<Result<Page>> {
  const cur = await getPage(db, shopId, id);
  if (!cur) return errR(['id'], 'Page does not exist', 'NOT_FOUND');
  if (i.title !== undefined && !i.title?.trim()) return errR(['title'], "Title can't be blank", 'BLANK');
  const handle = i.handle?.trim() ? slugify(i.handle) : undefined;
  if (handle && handle !== cur.handle && (await db.select({ id: pages.id }).from(pages).where(and(eq(pages.shopId, shopId), eq(pages.handle, handle))))[0]) return errR(['handle'], 'Handle has already been taken', 'TAKEN');
  const pub = publishedAt(i, cur.publishedAt);
  if (handle && handle !== cur.handle) await redirectPathChange(db, shopId, `/pages/${cur.handle}`, `/pages/${handle}`);
  const [row] = await db.update(pages).set({
    ...(i.title && { title: i.title.trim() }), ...(handle && { handle }), ...(i.body != null && { bodyHtml: cleanHtml(i.body) }),
    ...(i.seoTitle !== undefined && { seoTitle: i.seoTitle?.trim() || null }), ...(i.seoDescription !== undefined && { seoDescription: i.seoDescription?.trim() || null }),
    ...(i.templateSuffix !== undefined && { templateSuffix: i.templateSuffix || null }), ...(pub !== undefined && { publishedAt: pub }), updatedAt: new Date(),
  }).where(eq(pages.id, id)).returning();
  return okR(row!);
}

export async function deletePage(db: Db, shopId: number, id: number): Promise<Result<number>> {
  if (!(await getPage(db, shopId, id))) return errR(['id'], 'Page does not exist', 'NOT_FOUND');
  await db.delete(pages).where(eq(pages.id, id));
  return okR(id);
}

/* ------------------------------ menus ------------------------------ */

export type Menu = typeof menus.$inferSelect;
export interface MenuItemNode { id: number; title: string; type: string; resourceId: number | null; url: string | null; tags: string[]; items: MenuItemNode[] }
export const DEFAULT_MENU_HANDLES = ['main-menu', 'footer'];

export async function getMenu(db: Executor, shopId: number, id: number): Promise<Menu | null> {
  return (await db.select().from(menus).where(and(eq(menus.shopId, shopId), eq(menus.id, id))))[0] ?? null;
}

const menuSearch = (q?: string | null) => buildSearch(q, {
  fields: { title: (_o, v) => likeCi(menus.title, v), handle: (_o, v) => likeCi(menus.handle, v, true), id: (_o, v) => idTerm(menus.id, v) },
  text: (v) => sql`(${likeCi(menus.title, v)} or ${likeCi(menus.handle, v)})`,
});

export function listMenus(db: Executor, shopId: number, o: { query?: string | null; sortKey?: string; reverse?: boolean; offset: number; limit: number }): Promise<Menu[]> {
  const col = ({ CREATED_AT: menus.createdAt, TITLE: sql`lower(${menus.title})`, UPDATED_AT: menus.updatedAt } as Record<string, unknown>)[o.sortKey ?? 'ID'] ?? menus.id;
  const dir = o.reverse ? desc : asc;
  return db.select().from(menus).where(and(eq(menus.shopId, shopId), menuSearch(o.query))).orderBy(dir(col as never), dir(menus.id)).limit(o.limit).offset(o.offset);
}

/** Storefront path for a menu item (`url` as the Admin API shows it). */
function pathFor(type: string, url: string | null, handleOf: Map<string, string>, resourceId: number | null): string | null {
  const h = resourceId ? handleOf.get(`${type}:${resourceId}`) : undefined;
  switch (type) {
    case 'PRODUCT': return h ? `/products/${h}` : url;
    case 'COLLECTION': return h ? `/collections/${h}` : url;
    case 'PAGE': return h ? `/pages/${h}` : url;
    case 'FRONTPAGE': return '/';
    case 'CATALOG': return '/collections/all';
    case 'COLLECTIONS': return '/collections';
    case 'SEARCH': return '/search';
    default: return url;
  }
}

/** The nested item tree of a menu, with `url` resolved from the linked resource. */
export async function getMenuItems(db: Executor, shopId: number, menuId: number): Promise<MenuItemNode[]> {
  const rows = await db.select().from(menuItems).where(and(eq(menuItems.shopId, shopId), eq(menuItems.menuId, menuId))).orderBy(asc(menuItems.position), asc(menuItems.id));
  const handleOf = new Map<string, string>();
  const ids = (t: string) => [...new Set(rows.filter((r) => r.linkType === t && r.resourceId).map((r) => r.resourceId!))];
  const [ps, cs, gs] = await Promise.all([
    ids('PRODUCT').length ? db.select({ id: products.id, handle: products.handle }).from(products).where(inArray(products.id, ids('PRODUCT'))) : [],
    ids('COLLECTION').length ? db.select({ id: collections.id, handle: collections.handle }).from(collections).where(inArray(collections.id, ids('COLLECTION'))) : [],
    ids('PAGE').length ? db.select({ id: pages.id, handle: pages.handle }).from(pages).where(inArray(pages.id, ids('PAGE'))) : [],
  ]);
  for (const [t, list] of [['PRODUCT', ps], ['COLLECTION', cs], ['PAGE', gs]] as const) for (const r of list) handleOf.set(`${t}:${r.id}`, r.handle);
  const nodes = new Map<number, MenuItemNode>(rows.map((r) => [r.id, { id: r.id, title: r.title, type: r.linkType, resourceId: r.resourceId, url: pathFor(r.linkType, r.url, handleOf, r.resourceId), tags: [], items: [] }]));
  const roots: MenuItemNode[] = [];
  for (const r of rows) {
    const parent = r.parentId ? nodes.get(r.parentId) : undefined;
    (parent ? parent.items : roots).push(nodes.get(r.id)!);
  }
  return roots;
}

export interface MenuItemInput { id?: number | null; title: string; type: string; resourceId?: number | null; url?: string | null; items?: MenuItemInput[] | null }
const LINK_TYPES = ['FRONTPAGE', 'COLLECTION', 'COLLECTIONS', 'PRODUCT', 'CATALOG', 'PAGE', 'BLOG', 'ARTICLE', 'SEARCH', 'SHOP_POLICY', 'HTTP', 'METAOBJECT', 'CUSTOMER_ACCOUNT_PAGE'];
const RESOURCE_TYPES = ['PRODUCT', 'COLLECTION', 'PAGE', 'BLOG', 'ARTICLE'];

function checkItems(items: MenuItemInput[], at: string[]): Result<null> {
  for (const [n, it] of items.entries()) {
    const p = [...at, String(n)];
    if (!it.title?.trim()) return errR([...p, 'title'], "Title can't be blank", 'BLANK');
    if (!LINK_TYPES.includes(it.type)) return errR([...p, 'type'], 'Type is invalid', 'INVALID');
    if (it.type === 'HTTP' && !it.url?.trim()) return errR([...p, 'url'], "Url can't be blank", 'BLANK');
    if (RESOURCE_TYPES.includes(it.type) && !it.resourceId && !it.url) return errR([...p, 'resourceId'], 'Resource is required for this item type', 'BLANK');
    const sub = checkItems(it.items ?? [], [...p, 'items']);
    if (!sub.ok) return sub;
  }
  return okR(null);
}

async function writeItems(tx: Executor, shopId: number, menuId: number, items: MenuItemInput[], parentId: number | null, reusable: Set<number>) {
  for (const [position, it] of items.entries()) {
    const reuse = it.id && reusable.has(it.id) ? it.id : undefined;
    if (reuse) reusable.delete(reuse);
    const [row] = await tx.insert(menuItems).values({
      ...(reuse && { id: reuse }), shopId, menuId, parentId, position, title: it.title.trim(), linkType: it.type, resourceId: it.resourceId ?? null, url: it.type === 'HTTP' || !it.resourceId ? it.url ?? null : null,
    }).returning();
    if (it.items?.length) await writeItems(tx, shopId, menuId, it.items, row!.id, reusable);
  }
}

export async function createMenu(db: Db, shopId: number, i: { title: string; handle: string; items: MenuItemInput[] }): Promise<Result<Menu>> {
  if (!i.title?.trim()) return errR(['title'], "Title can't be blank", 'BLANK');
  const handle = slugify(i.handle || i.title);
  if (!handle) return errR(['handle'], "Handle can't be blank", 'BLANK');
  if ((await db.select({ id: menus.id }).from(menus).where(and(eq(menus.shopId, shopId), eq(menus.handle, handle))))[0]) return errR(['handle'], 'Handle has already been taken', 'TAKEN');
  const v = checkItems(i.items, ['items']);
  if (!v.ok) return v;
  return txResult(db, async (tx) => {
    const [m] = await tx.insert(menus).values({ shopId, title: i.title.trim(), handle }).returning();
    await writeItems(tx, shopId, m!.id, i.items, null, new Set());
    return okR(m!);
  });
}

export async function updateMenu(db: Db, shopId: number, id: number, i: { title: string; handle?: string | null; items: MenuItemInput[] }): Promise<Result<Menu>> {
  const cur = await getMenu(db, shopId, id);
  if (!cur) return errR(['id'], 'Menu does not exist', 'NOT_FOUND');
  if (!i.title?.trim()) return errR(['title'], "Title can't be blank", 'BLANK');
  const handle = i.handle?.trim() ? slugify(i.handle) : cur.handle;
  if (DEFAULT_MENU_HANDLES.includes(cur.handle) && handle !== cur.handle) return errR(['handle'], 'Default menu handles cannot be changed', 'UNEDITABLE_DEFAULT');
  if (handle !== cur.handle && (await db.select({ id: menus.id }).from(menus).where(and(eq(menus.shopId, shopId), eq(menus.handle, handle))))[0]) return errR(['handle'], 'Handle has already been taken', 'TAKEN');
  const v = checkItems(i.items, ['items']);
  if (!v.ok) return v;
  return txResult(db, async (tx) => {
    const old = new Set((await tx.select({ id: menuItems.id }).from(menuItems).where(eq(menuItems.menuId, id))).map((r) => r.id));
    await tx.delete(menuItems).where(eq(menuItems.menuId, id));
    await writeItems(tx, shopId, id, i.items, null, old);
    const [m] = await tx.update(menus).set({ title: i.title.trim(), handle, updatedAt: new Date() }).where(eq(menus.id, id)).returning();
    return okR(m!);
  });
}

export async function deleteMenu(db: Db, shopId: number, id: number): Promise<Result<number>> {
  const cur = await getMenu(db, shopId, id);
  if (!cur) return errR(['id'], 'Menu does not exist', 'MENU_DOES_NOT_EXIST');
  if (DEFAULT_MENU_HANDLES.includes(cur.handle)) return errR(['id'], 'Default menus cannot be deleted', 'UNABLE_TO_DELETE_DEFAULT_MENU');
  await db.delete(menus).where(eq(menus.id, id));
  return okR(id);
}

/* ------------------------------ themes ------------------------------ */

export type Theme = typeof themes.$inferSelect;
export type ThemeFile = typeof themeFiles.$inferSelect;

export async function getTheme(db: Executor, shopId: number, id: number): Promise<Theme | null> {
  return (await db.select().from(themes).where(and(eq(themes.shopId, shopId), eq(themes.id, id))))[0] ?? null;
}

export function listThemes(db: Executor, shopId: number, o: { roles?: string[] | null; names?: string[] | null; reverse?: boolean; offset: number; limit: number }): Promise<Theme[]> {
  const dir = o.reverse ? desc : asc;
  return db.select().from(themes).where(and(eq(themes.shopId, shopId), o.roles?.length ? inArray(themes.role, o.roles) : undefined, o.names?.length ? inArray(themes.name, o.names) : undefined))
    .orderBy(dir(themes.id)).limit(o.limit).offset(o.offset);
}

export async function listThemeFiles(db: Executor, shopId: number, themeId: number, o: { filenames?: string[] | null; offset: number; limit: number }): Promise<ThemeFile[]> {
  const wild = (o.filenames ?? []).filter((f) => f.includes('*'));
  const exact = (o.filenames ?? []).filter((f) => !f.includes('*'));
  const cond = o.filenames?.length
    ? sql`(${exact.length ? inArray(themeFiles.path, exact) : sql`false`}${sql.join(wild.map((w) => sql` or ${themeFiles.path} like ${w.replace(/[\\%_]/g, (c) => `\\${c}`).replace(/\*/g, '%')}`), sql``)})`
    : undefined;
  return db.select().from(themeFiles).where(and(eq(themeFiles.shopId, shopId), eq(themeFiles.themeId, themeId), cond)).orderBy(asc(themeFiles.path)).limit(o.limit).offset(o.offset);
}

const CONTENT_TYPES: Record<string, string> = {
  liquid: 'text/x-liquid', json: 'application/json', css: 'text/css', js: 'text/javascript', mjs: 'text/javascript', svg: 'image/svg+xml', txt: 'text/plain', html: 'text/html',
};

/** Theme JSON files may start with a `/* ... *\/` banner; strip comments before parsing. */
const parseThemeJson = (body: string) => JSON.parse(body.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, ''));

export interface ThemeFileInput { filename: string; body: string }

/** Create or replace text files of a theme. All-or-nothing: the first invalid file rejects the batch. */
export async function upsertThemeFiles(db: Db, shopId: number, themeId: number, files: ThemeFileInput[], staffId?: number | null): Promise<Result<ThemeFile[]>> {
  if (!(await getTheme(db, shopId, themeId))) return errR(['themeId'], 'Theme does not exist');
  if (!files.length) return errR(['files'], 'At least one file is required');
  for (const [i, f] of files.entries()) {
    const at = ['files', String(i), 'filename'];
    if (!/^[\w\-./]+$/.test(f.filename) || f.filename.includes('..') || f.filename.startsWith('/')) return errR(at, 'Filename is invalid', 'INVALID');
    const dir = f.filename.split('/')[0]!;
    if (!(THEME_DIRS as readonly string[]).includes(dir) || !f.filename.includes('/')) return errR(at, `Files must live in one of: ${THEME_DIRS.join(', ')}`, 'INVALID');
    const ext = f.filename.split('.').pop()!.toLowerCase();
    if (!CONTENT_TYPES[ext]) return errR(at, `Unsupported file type .${ext}`, 'INVALID');
    if (ext === 'json') { try { parseThemeJson(f.body); } catch { return errR(['files', String(i), 'body'], `${f.filename} is not valid JSON`, 'INVALID'); } }
    if (Buffer.byteLength(f.body) > 1_000_000) return errR(['files', String(i), 'body'], 'File is too large (maximum is 1MB)', 'INVALID');
  }
  return txResult(db, async (tx) => {
    const out: ThemeFile[] = [];
    for (const f of files) {
      await snapshotThemeFile(tx, shopId, themeId, f.filename, f.body, staffId);
      const values = { contentType: CONTENT_TYPES[f.filename.split('.').pop()!.toLowerCase()]!, body: f.body, storageKey: null, checksum: createHash('md5').update(f.body).digest('hex'), sizeBytes: Buffer.byteLength(f.body), updatedAt: new Date() };
      const [row] = await tx.insert(themeFiles).values({ themeId, shopId, path: f.filename, ...values }).onConflictDoUpdate({ target: [themeFiles.themeId, themeFiles.path], set: values }).returning();
      out.push(row!);
    }
    await tx.update(themes).set({ updatedAt: new Date() }).where(eq(themes.id, themeId));
    return okR(out);
  });
}

/* ------------------------------ file history ------------------------------ */

export type ThemeFileVersion = Omit<typeof themeFileVersions.$inferSelect, 'body'> & { body?: string };
export const THEME_FILE_VERSION_LIMIT = 30;

/** Keep the current text of a file as a version before it is replaced (nothing when the text does not change or the file is new). */
async function snapshotThemeFile(tx: Executor, shopId: number, themeId: number, path: string, nextBody: string | null, staffId?: number | null): Promise<void> {
  const [cur] = await tx.select({ body: themeFiles.body, checksum: themeFiles.checksum, sizeBytes: themeFiles.sizeBytes }).from(themeFiles).where(and(eq(themeFiles.themeId, themeId), eq(themeFiles.path, path)));
  if (!cur || cur.body === null || cur.body === nextBody) return;
  const [last] = await tx.select({ checksum: themeFileVersions.checksum }).from(themeFileVersions).where(and(eq(themeFileVersions.themeId, themeId), eq(themeFileVersions.path, path))).orderBy(desc(themeFileVersions.id)).limit(1);
  if (last?.checksum === cur.checksum) return;
  await tx.insert(themeFileVersions).values({ shopId, themeId, path, body: cur.body, checksum: cur.checksum, sizeBytes: cur.sizeBytes, staffUserId: staffId ?? null });
  const old = await tx.select({ id: themeFileVersions.id }).from(themeFileVersions).where(and(eq(themeFileVersions.themeId, themeId), eq(themeFileVersions.path, path))).orderBy(desc(themeFileVersions.id)).offset(THEME_FILE_VERSION_LIMIT);
  if (old.length) await tx.delete(themeFileVersions).where(inArray(themeFileVersions.id, old.map((o) => o.id)));
}

/** Keep the current text of the files about to be deleted, so a deleted file can be brought back from its history. */
export async function snapshotThemeFiles(db: Executor, shopId: number, themeId: number, paths: string[], staffId?: number | null): Promise<void> {
  for (const p of paths) await snapshotThemeFile(db, shopId, themeId, p, null, staffId);
}

/** The saved versions of a file, newest first, without their text. */
export async function listThemeFileVersions(db: Executor, shopId: number, themeId: number, path: string): Promise<ThemeFileVersion[]> {
  return db.select({ id: themeFileVersions.id, shopId: themeFileVersions.shopId, themeId: themeFileVersions.themeId, path: themeFileVersions.path, checksum: themeFileVersions.checksum, sizeBytes: themeFileVersions.sizeBytes, staffUserId: themeFileVersions.staffUserId, createdAt: themeFileVersions.createdAt })
    .from(themeFileVersions).where(and(eq(themeFileVersions.shopId, shopId), eq(themeFileVersions.themeId, themeId), eq(themeFileVersions.path, path))).orderBy(desc(themeFileVersions.id)).limit(THEME_FILE_VERSION_LIMIT);
}

export async function getThemeFileVersion(db: Executor, shopId: number, id: number): Promise<ThemeFileVersion | null> {
  return (await db.select().from(themeFileVersions).where(and(eq(themeFileVersions.shopId, shopId), eq(themeFileVersions.id, id))))[0] ?? null;
}

/** Paths of the files that have a history in this theme (so the editor can bring back deleted files). */
export async function listThemeFilesWithHistory(db: Executor, shopId: number, themeId: number): Promise<string[]> {
  const rows = await db.selectDistinct({ path: themeFileVersions.path }).from(themeFileVersions).where(and(eq(themeFileVersions.shopId, shopId), eq(themeFileVersions.themeId, themeId)));
  return rows.map((r) => r.path).sort();
}

export async function publishTheme(db: Db, shopId: number, id: number, staffId?: number | null): Promise<Result<Theme>> {
  const cur = await getTheme(db, shopId, id);
  if (!cur) return errR(['id'], 'Theme does not exist');
  return txResult(db, async (tx) => {
    if (cur.role !== 'MAIN') {
      await tx.update(themes).set({ role: 'UNPUBLISHED', updatedAt: new Date() }).where(and(eq(themes.shopId, shopId), eq(themes.role, 'MAIN')));
      await tx.update(themes).set({ role: 'MAIN', updatedAt: new Date() }).where(eq(themes.id, id));
      await addEvent(tx, shopId, { subjectType: 'theme', subjectId: id, verb: 'themes/publish', message: `Theme ${cur.name} was published`, authorStaffUserId: staffId });
    }
    return okR((await getTheme(tx, shopId, id))!);
  });
}

/* ------------------------------ template suffixes ------------------------------ */

/** Alternate templates (`templates/<kind>.<suffix>.json|liquid`) that the live theme provides for `page`, `article`, `blog`, `product` or `collection`. */
export async function listTemplateSuffixes(db: Executor, shopId: number, kind: string): Promise<string[]> {
  if (!/^[a-z_]+$/.test(kind)) return [];
  const rows = await db.select({ path: themeFiles.path }).from(themeFiles).innerJoin(themes, eq(themes.id, themeFiles.themeId))
    .where(and(eq(themeFiles.shopId, shopId), eq(themes.role, 'MAIN'), sql`${themeFiles.path} like ${`templates/${kind}.%`}`));
  const out = new Set<string>();
  for (const r of rows) {
    const m = new RegExp(`^templates/${kind}\\.([A-Za-z0-9_.-]+)\\.(json|liquid)$`).exec(r.path);
    if (m) out.add(m[1]!);
  }
  return [...out].sort();
}
