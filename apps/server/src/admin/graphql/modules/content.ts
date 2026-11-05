import {
  countPages, createMenu, listTemplateSuffixes, createPage, deleteMenu, deletePage, getMenu, getMenuItems, getPage, getTheme, listMenus, listPages, listThemeFiles, listThemes, publishTheme, updateMenu, updatePage,
  upsertThemeFiles, DEFAULT_MENU_HANDLES, ensureCustomerAccountMenu, type Menu as MenuRow, type MenuItemInput, type MenuItemNode, type Page as PageRow, type Theme as ThemeRow, type ThemeFile,
} from '@shopme/core';
import { parseId, toGid, type UserError } from '@shopme/shopify-compat';
import { builder } from '../builder';
import { requireScope } from '../context';
import { ConnectionArgs, defineConnection, paginate, paginateArray } from '../types/connection';
import { DisplayableError } from '../types/errors';
import { Count } from '../types/money';
import { Node, legacyId, registerNode } from '../types/node';
import { Job, SEO, SEOInput } from '../types/catalog';
import { payloadWith, typedUserError } from '../types/sales';

const staffId = (ctx: { auth: { kind: string; user?: { id: number } } }) => (ctx.auth.kind === 'session' ? ctx.auth.user!.id : null);
const gidId = (raw: string | number, type: string) => parseId(String(raw), type);
const fail = (field: string[], message: string, code = 'NOT_FOUND'): UserError[] => [{ field, message, code }];

/* ------------------------------ pages ------------------------------ */

const PageSortKeys = builder.enumType('PageSortKeys', { values: ['CREATED_AT', 'ID', 'PUBLISHED_AT', 'TITLE', 'UPDATED_AT'] as const });
const stripHtml = (h: string) => h.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

export const Page = builder.objectRef<PageRow>('Page');
Page.implement({
  interfaces: [Node],
  fields: (t) => ({
    legacyResourceId: t.field({ type: 'UnsignedInt64', resolve: legacyId }),
    title: t.exposeString('title'),
    handle: t.exposeString('handle'),
    body: t.field({ type: 'HTML', resolve: (p) => p.bodyHtml }),
    bodySummary: t.string({ resolve: (p) => stripHtml(p.bodyHtml).slice(0, 150) }),
    isPublished: t.boolean({ resolve: (p) => p.publishedAt != null && p.publishedAt <= new Date() }),
    publishedAt: t.field({ type: 'DateTime', nullable: true, resolve: (p) => p.publishedAt }),
    templateSuffix: t.exposeString('templateSuffix', { nullable: true }),
    seo: t.field({ type: SEO, resolve: (p) => ({ title: p.seoTitle, description: p.seoDescription }) }),
    createdAt: t.field({ type: 'DateTime', resolve: (p) => p.createdAt }),
    updatedAt: t.field({ type: 'DateTime', resolve: (p) => p.updatedAt }),
  }),
});
const PageConnection = defineConnection('Page', Page);
registerNode('Page', (ctx, id) => getPage(ctx.db, ctx.shopId, id));

const PAGE_CODES = ['BLANK', 'INVALID', 'TAKEN', 'TOO_LONG', 'NOT_FOUND', 'CREATE_FAILED', 'UPDATE_FAILED', 'DELETE_FAILED'] as const;
const PageCreateError = typedUserError('PageCreateUserError', PAGE_CODES);
const PageUpdateError = typedUserError('PageUpdateUserError', PAGE_CODES);
const PageDeleteError = typedUserError('PageDeleteUserError', PAGE_CODES);
const PageCreateInput = builder.inputType('PageCreateInput', {
  fields: (t) => ({ handle: t.string(), body: t.string(), isPublished: t.boolean(), publishDate: t.field({ type: 'DateTime' }), templateSuffix: t.string(), seo: t.field({ type: SEOInput }), title: t.string({ required: true }) }),
});
const PageUpdateInput = builder.inputType('PageUpdateInput', {
  fields: (t) => ({ handle: t.string(), body: t.string(), isPublished: t.boolean(), publishDate: t.field({ type: 'DateTime' }), templateSuffix: t.string(), seo: t.field({ type: SEOInput }), title: t.string(), redirectNewHandle: t.boolean({ defaultValue: false }) }),
});
const PageCreatePayload = payloadWith<{ page: PageRow | null }>('PageCreatePayload', PageCreateError, (t) => ({ page: t.field({ type: Page, nullable: true, resolve: (p) => p.page }) }));
const PageUpdatePayload = payloadWith<{ page: PageRow | null }>('PageUpdatePayload', PageUpdateError, (t) => ({ page: t.field({ type: Page, nullable: true, resolve: (p) => p.page }) }));
const PageDeletePayload = payloadWith<{ deletedPageId: string | null }>('PageDeletePayload', PageDeleteError, (t) => ({ deletedPageId: t.id({ nullable: true, resolve: (p) => p.deletedPageId }) }));

/* ------------------------------ menus ------------------------------ */

const MenuSortKeys = builder.enumType('MenuSortKeys', { values: ['CREATED_AT', 'ID', 'TITLE', 'UPDATED_AT'] as const });
const MenuItemType = builder.enumType('MenuItemType', {
  values: ['FRONTPAGE', 'COLLECTION', 'COLLECTIONS', 'PRODUCT', 'CATALOG', 'PAGE', 'BLOG', 'ARTICLE', 'SEARCH', 'SHOP_POLICY', 'HTTP', 'METAOBJECT', 'CUSTOMER_ACCOUNT_PAGE'] as const,
});
const MenuItem = builder.objectRef<MenuItemNode>('MenuItem');
MenuItem.implement({
  fields: (t) => ({
    id: t.id({ resolve: (i) => toGid('MenuItem', i.id) }),
    title: t.exposeString('title'),
    type: t.field({ type: MenuItemType, resolve: (i) => i.type as 'HTTP' }),
    resourceId: t.id({ nullable: true, resolve: (i) => (i.resourceId ? toGid(RESOURCE_GID[i.type] ?? 'Resource', i.resourceId) : null) }),
    url: t.exposeString('url', { nullable: true }),
    tags: t.exposeStringList('tags'),
    items: t.field({ type: [MenuItem], resolve: (i) => i.items }),
  }),
});
const RESOURCE_GID: Record<string, string> = { PRODUCT: 'Product', COLLECTION: 'Collection', PAGE: 'Page', BLOG: 'Blog', ARTICLE: 'Article' };

const Menu = builder.objectRef<MenuRow>('Menu');
Menu.implement({
  interfaces: [Node],
  fields: (t) => ({
    title: t.exposeString('title'),
    handle: t.exposeString('handle'),
    isDefault: t.boolean({ resolve: (m) => DEFAULT_MENU_HANDLES.includes(m.handle) }),
    createdAt: t.field({ type: 'DateTime', resolve: (m) => m.createdAt }),
    items: t.field({
      type: [MenuItem], args: { limit: t.arg.int() },
      resolve: async (m, a, ctx) => (await getMenuItems(ctx.db, ctx.shopId, m.id)).slice(0, a.limit ?? undefined),
    }),
  }),
});
const MenuConnection = defineConnection('Menu', Menu);
registerNode('Menu', (ctx, id) => getMenu(ctx.db, ctx.shopId, id));

type ItemIn = { id?: string | number | null; title: string; type: string; resourceId?: string | number | null; url?: string | null; tags?: string[] | null; items?: ItemIn[] | null };
const itemFields = (t: PothosSchemaTypes.InputFieldBuilder<PothosSchemaTypes.ExtendDefaultTypes<import('../builder').SchemaTypes>, 'InputObject'>) => ({
  title: t.string({ required: true }), type: t.field({ type: MenuItemType, required: true }), resourceId: t.id(), url: t.string(), tags: t.stringList(),
});
const MenuItemCreateInput = builder.inputRef<ItemIn>('MenuItemCreateInput');
MenuItemCreateInput.implement({ fields: (t) => ({ ...itemFields(t), items: t.field({ type: [MenuItemCreateInput] }) }) });
const MenuItemUpdateInput = builder.inputRef<ItemIn>('MenuItemUpdateInput');
MenuItemUpdateInput.implement({ fields: (t) => ({ ...itemFields(t), id: t.id(), items: t.field({ type: [MenuItemUpdateInput] }) }) });

/** Resource ids may arrive as any GID type (Product, Collection, Page...); only the number is stored. */
const numId = (raw: string | number | null | undefined) => (raw == null ? null : Number(String(raw).split('/').pop()?.split('?')[0]) || null);
const toItems = (xs: ItemIn[] | null | undefined): MenuItemInput[] =>
  (xs ?? []).map((i) => ({ id: numId(i.id), title: i.title, type: i.type, resourceId: numId(i.resourceId), url: i.url, items: toItems(i.items) }));

const MENU_CODES = ['BLANK', 'INVALID', 'TAKEN', 'TOO_LONG', 'MENU_DOES_NOT_EXIST', 'UNEDITABLE_DEFAULT', 'UNABLE_TO_DELETE_DEFAULT_MENU', 'REQUIRED'] as const;
const MenuCreateError = typedUserError('MenuCreateUserError', MENU_CODES);
const MenuUpdateError = typedUserError('MenuUpdateUserError', MENU_CODES);
const MenuDeleteError = typedUserError('MenuDeleteUserError', MENU_CODES);
const MenuCreatePayload = payloadWith<{ menu: MenuRow | null }>('MenuCreatePayload', MenuCreateError, (t) => ({ menu: t.field({ type: Menu, nullable: true, resolve: (p) => p.menu }) }));
const MenuUpdatePayload = payloadWith<{ menu: MenuRow | null }>('MenuUpdatePayload', MenuUpdateError, (t) => ({ menu: t.field({ type: Menu, nullable: true, resolve: (p) => p.menu }) }));
const MenuDeletePayload = payloadWith<{ deletedMenuId: string | null }>('MenuDeletePayload', MenuDeleteError, (t) => ({ deletedMenuId: t.id({ nullable: true, resolve: (p) => p.deletedMenuId }) }));

/* ------------------------------ themes ------------------------------ */

export const ThemeRoleEnum = builder.enumType('ThemeRole', { values: ['MAIN', 'UNPUBLISHED', 'DEMO', 'DEVELOPMENT', 'ARCHIVED', 'LOCKED'] as const });
const BodyText = builder.objectRef<{ content: string }>('OnlineStoreThemeFileBodyText').implement({ fields: (t) => ({ content: t.exposeString('content') }) });
const BodyUnion = builder.unionType('OnlineStoreThemeFileBody', { types: [BodyText], resolveType: () => BodyText });

const ThemeFileShape = builder.objectRef<ThemeFile>('OnlineStoreThemeFile').implement({
  fields: (t) => ({
    filename: t.exposeString('path'),
    contentType: t.exposeString('contentType'),
    checksumMd5: t.exposeString('checksum', { nullable: true }),
    size: t.field({ type: 'UnsignedInt64', resolve: (f) => String(f.sizeBytes) }),
    createdAt: t.field({ type: 'DateTime', resolve: (f) => f.updatedAt }),
    updatedAt: t.field({ type: 'DateTime', resolve: (f) => f.updatedAt }),
    body: t.field({ type: BodyUnion, resolve: (f) => ({ content: f.body ?? '' }) }),
  }),
});
const ThemeFileConnection = defineConnection('OnlineStoreThemeFile', ThemeFileShape);

export const Theme = builder.objectRef<ThemeRow>('OnlineStoreTheme');
Theme.implement({
  interfaces: [Node],
  fields: (t) => ({
    name: t.exposeString('name'),
    role: t.field({ type: ThemeRoleEnum, resolve: (th) => th.role as 'MAIN' }),
    processing: t.exposeBoolean('processing'),
    processingFailed: t.boolean({ resolve: () => false }),
    prefix: t.string({ resolve: () => '/' }),
    themeStoreId: t.int({ nullable: true, resolve: () => null }),
    createdAt: t.field({ type: 'DateTime', resolve: (th) => th.createdAt }),
    updatedAt: t.field({ type: 'DateTime', resolve: (th) => th.updatedAt }),
    files: t.field({
      type: ThemeFileConnection, nullable: true, args: { filenames: t.arg.stringList(), first: t.arg.int({ defaultValue: 50 }), after: t.arg.string() },
      resolve: (th, a, ctx) => paginate({ first: a.first, after: a.after }, { fetch: ({ offset, limit }) => listThemeFiles(ctx.db, ctx.shopId, th.id, { filenames: a.filenames, offset, limit }) }),
    }),
  }),
});
const ThemeConnection = defineConnection('OnlineStoreTheme', Theme);
registerNode('OnlineStoreTheme', (ctx, id) => getTheme(ctx.db, ctx.shopId, id));

const BodyType = builder.enumType('OnlineStoreThemeFileBodyInputType', { values: ['TEXT', 'BASE64', 'URL'] as const });
const FileInput = builder.inputType('OnlineStoreThemeFilesUpsertFileInput', {
  fields: (t) => ({
    filename: t.string({ required: true }),
    body: t.field({ type: builder.inputType('OnlineStoreThemeFileBodyInput', { fields: (u) => ({ type: u.field({ type: BodyType, required: true }), value: u.string({ required: true }) }) }), required: true }),
  }),
});
export const UpsertResult = builder.objectRef<ThemeFile>('OnlineStoreThemeFileOperationResult').implement({
  fields: (t) => ({
    filename: t.exposeString('path'), checksumMd5: t.exposeString('checksum', { nullable: true }), size: t.field({ type: 'UnsignedInt64', resolve: (f) => String(f.sizeBytes) }),
    createdAt: t.field({ type: 'DateTime', resolve: (f) => f.updatedAt }), updatedAt: t.field({ type: 'DateTime', resolve: (f) => f.updatedAt }),
  }),
});
const ThemeFilesErrorCode = builder.enumType('OnlineStoreThemeFilesUserErrorsCode', { values: ['INVALID', 'NOT_FOUND', 'TOO_MANY_FILES', 'ACCESS_DENIED', 'THEME_FILES_NOT_FOUND'] as const });
export const ThemeFilesError = builder.objectRef<UserError & { filename?: string | null }>('OnlineStoreThemeFilesUserErrors').implement({
  interfaces: [DisplayableError],
  fields: (t) => ({
    code: t.field({ type: ThemeFilesErrorCode, nullable: true, resolve: (e) => (e.code === 'INVALID' || e.code === 'NOT_FOUND' ? e.code : null) }),
    filename: t.string({ nullable: true, resolve: (e) => e.filename ?? null }),
  }),
});
const FilesUpsertPayload = builder.objectRef<{ files: ThemeFile[] | null; userErrors: (UserError & { filename?: string | null })[] }>('ThemeFilesUpsertPayload').implement({
  fields: (t) => ({
    job: t.field({ type: Job, nullable: true, resolve: () => null }),
    upsertedThemeFiles: t.field({ type: [UpsertResult], nullable: true, resolve: (p) => p.files }),
    userErrors: t.field({ type: [ThemeFilesError], resolve: (p) => p.userErrors }),
  }),
});
const PublishError = typedUserError('ThemePublishUserError', ['INVALID', 'NOT_FOUND', 'THEME_NOT_FOUND', 'CANNOT_PUBLISH_THEME_DURING_PROCESSING'] as const);
const ThemePublishPayload = payloadWith<{ theme: ThemeRow | null }>('ThemePublishPayload', PublishError, (t) => ({ theme: t.field({ type: Theme, nullable: true, resolve: (p) => p.theme }) }));

/* ------------------------------ root fields ------------------------------ */

builder.queryFields((t) => ({
  page: t.field({
    type: Page, nullable: true, args: { id: t.arg.id({ required: true }) },
    resolve: (_r, a, ctx) => { requireScope(ctx, 'read_online_store_pages'); const id = gidId(a.id, 'Page'); return id ? getPage(ctx.db, ctx.shopId, id) : null; },
  }),
  pages: t.field({
    type: PageConnection, args: { ...ConnectionArgs, sortKey: t.arg({ type: PageSortKeys, defaultValue: 'ID' }), query: t.arg.string(), savedSearchId: t.arg.id() },
    resolve: (_r, a, ctx) => {
      requireScope(ctx, 'read_online_store_pages');
      return paginate(a, {
        fetch: ({ offset, limit }) => listPages(ctx.db, ctx.shopId, { query: a.query, sortKey: a.sortKey ?? 'ID', reverse: !!a.reverse, offset, limit }),
        total: async () => (await countPages(ctx.db, ctx.shopId)).count,
      });
    },
  }),
  pagesCount: t.field({
    type: Count, nullable: true, args: { limit: t.arg.int({ defaultValue: 10000 }) },
    resolve: (_r, a, ctx) => { requireScope(ctx, 'read_online_store_pages'); return countPages(ctx.db, ctx.shopId, a.limit ?? 10000); },
  }),
  menu: t.field({
    type: Menu, nullable: true, args: { id: t.arg.id({ required: true }) },
    resolve: (_r, a, ctx) => { requireScope(ctx, 'read_online_store_navigation'); const id = gidId(a.id, 'Menu'); return id ? getMenu(ctx.db, ctx.shopId, id) : null; },
  }),
  menus: t.field({
    type: MenuConnection, args: { ...ConnectionArgs, sortKey: t.arg({ type: MenuSortKeys, defaultValue: 'ID' }), query: t.arg.string() },
    resolve: async (_r, a, ctx) => {
      requireScope(ctx, 'read_online_store_navigation');
      await ensureCustomerAccountMenu(ctx.db, ctx.shopId);
      return paginate(a, {
        fetch: ({ offset, limit }) => listMenus(ctx.db, ctx.shopId, { query: a.query, sortKey: a.sortKey ?? 'ID', reverse: !!a.reverse, offset, limit }),
        total: async () => (await listMenus(ctx.db, ctx.shopId, { query: a.query, offset: 0, limit: 10000 })).length,
      });
    },
  }),
  theme: t.field({
    type: Theme, nullable: true, args: { id: t.arg.id({ required: true }) },
    resolve: (_r, a, ctx) => { requireScope(ctx, 'read_themes'); const id = gidId(a.id, 'OnlineStoreTheme'); return id ? getTheme(ctx.db, ctx.shopId, id) : null; },
  }),
  themes: t.field({
    type: ThemeConnection, nullable: true, args: { ...ConnectionArgs, roles: t.arg({ type: [ThemeRoleEnum] }), names: t.arg.stringList() },
    resolve: (_r, a, ctx) => {
      requireScope(ctx, 'read_themes');
      return paginate(a, {
        fetch: ({ offset, limit }) => listThemes(ctx.db, ctx.shopId, { roles: a.roles, names: a.names, reverse: !!a.reverse, offset, limit }),
        total: async () => (await listThemes(ctx.db, ctx.shopId, { roles: a.roles, names: a.names, offset: 0, limit: 1000 })).length,
      });
    },
  }),
}));

builder.queryFields((t) => ({
  /** ShopMe extension: alternate template suffixes the live theme provides for a resource kind (page, article, blog, product, collection). */
  shopmeTemplateSuffixes: t.stringList({
    args: { kind: t.arg.string({ required: true }) },
    resolve: (_r, a, ctx) => { requireScope(ctx, 'read_themes'); return listTemplateSuffixes(ctx.db, ctx.shopId, a.kind); },
  }),
}));

builder.mutationFields((t) => ({
  pageCreate: t.field({
    type: PageCreatePayload, args: { page: t.arg({ type: PageCreateInput, required: true }) },
    resolve: async (_r, { page }, ctx) => {
      requireScope(ctx, 'write_online_store_pages');
      const r = await createPage(ctx.db, ctx.shopId, { ...page, seoTitle: page.seo?.title, seoDescription: page.seo?.description });
      return r.ok ? { page: r.value, userErrors: [] } : { page: null, userErrors: r.errors.map((e) => ({ ...e, field: ['page', ...(e.field ?? [])] })) };
    },
  }),
  pageUpdate: t.field({
    type: PageUpdatePayload, args: { id: t.arg.id({ required: true }), page: t.arg({ type: PageUpdateInput, required: true }) },
    resolve: async (_r, a, ctx) => {
      requireScope(ctx, 'write_online_store_pages');
      const id = gidId(a.id, 'Page');
      const r = id ? await updatePage(ctx.db, ctx.shopId, id, { ...a.page, ...(a.page.seo && { seoTitle: a.page.seo.title ?? null, seoDescription: a.page.seo.description ?? null }) }) : null;
      if (!r) return { page: null, userErrors: fail(['id'], 'Page does not exist') };
      return r.ok ? { page: r.value, userErrors: [] } : { page: null, userErrors: r.errors.map((e) => ({ ...e, field: e.field?.[0] === 'id' ? e.field : ['page', ...(e.field ?? [])] })) };
    },
  }),
  pageDelete: t.field({
    type: PageDeletePayload, args: { id: t.arg.id({ required: true }) },
    resolve: async (_r, a, ctx) => {
      requireScope(ctx, 'write_online_store_pages');
      const id = gidId(a.id, 'Page');
      const r = id ? await deletePage(ctx.db, ctx.shopId, id) : null;
      return r?.ok ? { deletedPageId: toGid('Page', id!), userErrors: [] } : { deletedPageId: null, userErrors: fail(['id'], 'Page does not exist') };
    },
  }),
  menuCreate: t.field({
    type: MenuCreatePayload, args: { title: t.arg.string({ required: true }), handle: t.arg.string({ required: true }), items: t.arg({ type: [MenuItemCreateInput], required: true }) },
    resolve: async (_r, a, ctx) => {
      requireScope(ctx, 'write_online_store_navigation');
      const r = await createMenu(ctx.db, ctx.shopId, { title: a.title, handle: a.handle, items: toItems(a.items) });
      return r.ok ? { menu: r.value, userErrors: [] } : { menu: null, userErrors: r.errors };
    },
  }),
  menuUpdate: t.field({
    type: MenuUpdatePayload, args: { id: t.arg.id({ required: true }), title: t.arg.string({ required: true }), handle: t.arg.string(), items: t.arg({ type: [MenuItemUpdateInput], required: true }) },
    resolve: async (_r, a, ctx) => {
      requireScope(ctx, 'write_online_store_navigation');
      const id = gidId(a.id, 'Menu');
      const r = id ? await updateMenu(ctx.db, ctx.shopId, id, { title: a.title, handle: a.handle, items: toItems(a.items) }) : null;
      if (!r) return { menu: null, userErrors: fail(['id'], 'Menu does not exist', 'MENU_DOES_NOT_EXIST') };
      return r.ok ? { menu: r.value, userErrors: [] } : { menu: null, userErrors: r.errors };
    },
  }),
  menuDelete: t.field({
    type: MenuDeletePayload, args: { id: t.arg.id({ required: true }) },
    resolve: async (_r, a, ctx) => {
      requireScope(ctx, 'write_online_store_navigation');
      const id = gidId(a.id, 'Menu');
      const r = id ? await deleteMenu(ctx.db, ctx.shopId, id) : null;
      if (!r) return { deletedMenuId: null, userErrors: fail(['id'], 'Menu does not exist', 'MENU_DOES_NOT_EXIST') };
      return r.ok ? { deletedMenuId: toGid('Menu', id!), userErrors: [] } : { deletedMenuId: null, userErrors: r.errors };
    },
  }),
  themeFilesUpsert: t.field({
    type: FilesUpsertPayload, args: { themeId: t.arg.id({ required: true }), files: t.arg({ type: [FileInput], required: true }) },
    resolve: async (_r, a, ctx) => {
      requireScope(ctx, 'write_themes');
      const id = gidId(a.themeId, 'OnlineStoreTheme');
      if (!id) return { files: null, userErrors: fail(['themeId'], 'Theme does not exist') };
      const unsupported = a.files.find((f) => f.body.type !== 'TEXT');
      if (unsupported) return { files: null, userErrors: [{ field: ['files'], message: 'Only TEXT bodies are supported', code: 'INVALID', filename: unsupported.filename }] };
      const r = await upsertThemeFiles(ctx.db, ctx.shopId, id, a.files.map((f) => ({ filename: f.filename, body: f.body.value })));
      return r.ok ? { files: r.value, userErrors: [] } : { files: null, userErrors: r.errors };
    },
  }),
  themePublish: t.field({
    type: ThemePublishPayload, args: { id: t.arg.id({ required: true }) },
    resolve: async (_r, a, ctx) => {
      requireScope(ctx, 'write_themes');
      const id = gidId(a.id, 'OnlineStoreTheme');
      const r = id ? await publishTheme(ctx.db, ctx.shopId, id, staffId(ctx)) : null;
      if (!r) return { theme: null, userErrors: fail(['id'], 'Theme does not exist') };
      return r.ok ? { theme: r.value, userErrors: [] } : { theme: null, userErrors: r.errors };
    },
  }),
}));

void paginateArray;
