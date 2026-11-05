import { boolean, index, integer, pgTable, primaryKey, text, uniqueIndex } from 'drizzle-orm/pg-core';
import { createdAt, pk, ref, shopIdCol, tagsCol, timestamps, ts } from './_helpers';
import { shops } from './shop';
import { media } from './catalog';

const shopFk = () => shopIdCol().references(() => shops.id, { onDelete: 'cascade' });

export const pages = pgTable('pages', {
  id: pk(), shopId: shopFk(),
  handle: text('handle').notNull(), title: text('title').notNull(), bodyHtml: text('body_html').notNull().default(''),
  templateSuffix: text('template_suffix'), seoTitle: text('seo_title'), seoDescription: text('seo_description'), publishedAt: ts('published_at'), ...timestamps(),
}, (t) => [uniqueIndex('pages_shop_handle_uq').on(t.shopId, t.handle)]);

export const blogs = pgTable('blogs', {
  id: pk(), shopId: shopFk(),
  handle: text('handle').notNull(), title: text('title').notNull(), templateSuffix: text('template_suffix'),
  commentPolicy: text('comment_policy').notNull().default('CLOSED'), // CLOSED | AUTO_PUBLISHED | MODERATED
  ...timestamps(),
}, (t) => [uniqueIndex('blogs_shop_handle_uq').on(t.shopId, t.handle)]);

export const articles = pgTable('articles', {
  id: pk(), shopId: shopFk(),
  blogId: ref('blog_id').notNull().references(() => blogs.id, { onDelete: 'cascade' }),
  handle: text('handle').notNull(), title: text('title').notNull(), author: text('author'),
  bodyHtml: text('body_html').notNull().default(''), summaryHtml: text('summary_html'), tags: tagsCol(),
  imageMediaId: ref('image_media_id').references(() => media.id, { onDelete: 'set null' }),
  templateSuffix: text('template_suffix'), seoTitle: text('seo_title'), seoDescription: text('seo_description'), publishedAt: ts('published_at'), ...timestamps(),
}, (t) => [uniqueIndex('articles_blog_handle_uq').on(t.blogId, t.handle)]);

/** Navigation menus (theme "linklists"). */
export const menus = pgTable('menus', {
  id: pk(), shopId: shopFk(), handle: text('handle').notNull(), title: text('title').notNull(), ...timestamps(),
}, (t) => [uniqueIndex('menus_shop_handle_uq').on(t.shopId, t.handle)]);

export const menuItems = pgTable('menu_items', {
  id: pk(), shopId: shopFk(),
  menuId: ref('menu_id').notNull().references(() => menus.id, { onDelete: 'cascade' }),
  parentId: ref('parent_id'),
  position: integer('position').notNull().default(0),
  title: text('title').notNull(),
  linkType: text('link_type').notNull().default('HTTP'), // PRODUCT | COLLECTION | PAGE | BLOG | HTTP | FRONTPAGE | CATALOG
  resourceId: ref('resource_id'), url: text('url'),
}, (t) => [index('menu_items_menu_idx').on(t.menuId, t.position)]);

export const urlRedirects = pgTable('url_redirects', {
  id: pk(), shopId: shopFk(), path: text('path').notNull(), target: text('target').notNull(), createdAt: createdAt(),
}, (t) => [uniqueIndex('url_redirects_path_uq').on(t.shopId, t.path)]);

export const themes = pgTable('themes', {
  id: pk(), shopId: shopFk(),
  name: text('name').notNull(),
  role: text('role').notNull().default('UNPUBLISHED'), // MAIN | UNPUBLISHED | DEMO | DEVELOPMENT
  processing: boolean('processing').notNull().default(false),
  ...timestamps(),
});

/** Earlier contents of a text theme file (what the code editor lists as the file's history, newest first). */
export const themeFileVersions = pgTable('theme_file_versions', {
  id: pk(), shopId: shopFk(),
  themeId: ref('theme_id').notNull().references(() => themes.id, { onDelete: 'cascade' }),
  path: text('path').notNull(),
  body: text('body').notNull(),
  checksum: text('checksum').notNull(),
  sizeBytes: integer('size_bytes').notNull().default(0),
  staffUserId: ref('staff_user_id'),
  createdAt: createdAt(),
}, (t) => [index('theme_file_versions_file_idx').on(t.themeId, t.path, t.createdAt)]);

/** Theme files stored in the database (liquid, json, css, js, svg as text; binaries via storage_key). */
export const themeFiles = pgTable('theme_files', {
  themeId: ref('theme_id').notNull().references(() => themes.id, { onDelete: 'cascade' }),
  shopId: shopFk(),
  path: text('path').notNull(),
  contentType: text('content_type').notNull().default('text/plain'),
  checksum: text('checksum').notNull(),
  sizeBytes: integer('size_bytes').notNull().default(0),
  body: text('body'),
  storageKey: text('storage_key'),
  updatedAt: timestamps().updatedAt,
}, (t) => [primaryKey({ columns: [t.themeId, t.path] })]);
