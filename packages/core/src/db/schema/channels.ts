import { bigint, check, index, pgTable, primaryKey, text, uniqueIndex } from 'drizzle-orm/pg-core';
import { createdAt, oneOf, pk, ref, shopIdCol, ts } from './_helpers';
import { shops } from './shop';
import { catalogs } from './markets';
import { inventoryItems, products } from './catalog';

const shopFk = () => shopIdCol().references(() => shops.id, { onDelete: 'cascade' });

export const PUBLICATION_KINDS = ['ONLINE_STORE', 'CUSTOM'] as const;
export const PUBLISHABLE_TYPES = ['PRODUCT', 'COLLECTION'] as const;

/**
 * A sales channel. Every shop has the built-in Online Store; more kinds can be added later.
 * The Online Store's own publish state is stored on the resource (`products.online_store_published_at`, `collections.published_at`),
 * every other channel keeps one `resource_publications` row per published resource.
 */
export const publications = pgTable('publications', {
  id: pk(), shopId: shopFk(),
  name: text('name').notNull(), handle: text('handle').notNull(),
  kind: text('kind').notNull().default('CUSTOM'),
  position: bigint('position', { mode: 'number' }).notNull().default(0),
  createdAt: createdAt(),
}, (t) => [uniqueIndex('publications_handle_uq').on(t.shopId, t.handle), check('publications_kind_chk', oneOf(t.kind, PUBLICATION_KINDS))]);

export const resourcePublications = pgTable('resource_publications', {
  shopId: shopFk(),
  publicationId: ref('publication_id').notNull().references(() => publications.id, { onDelete: 'cascade' }),
  resourceType: text('resource_type').notNull(),
  resourceId: ref('resource_id').notNull(),
  /** Future dates schedule the publication. */
  publishedAt: ts('published_at').notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.publicationId, t.resourceType, t.resourceId] }), index('resource_publications_resource_idx').on(t.resourceType, t.resourceId),
  check('resource_publications_type_chk', oneOf(t.resourceType, PUBLISHABLE_TYPES))]);

/** Products that belong to a market catalog. */
export const catalogProducts = pgTable('catalog_products', {
  shopId: shopFk(),
  catalogId: ref('catalog_id').notNull().references(() => catalogs.id, { onDelete: 'cascade' }),
  productId: ref('product_id').notNull().references(() => products.id, { onDelete: 'cascade' }),
  createdAt: createdAt(),
}, (t) => [primaryKey({ columns: [t.catalogId, t.productId] }), index('catalog_products_product_idx').on(t.productId)]);

/** Harmonized System code per destination country (customs ship-to). */
export const inventoryItemCountryHs = pgTable('inventory_item_country_hs', {
  shopId: shopFk(),
  inventoryItemId: ref('inventory_item_id').notNull().references(() => inventoryItems.id, { onDelete: 'cascade' }),
  countryCode: text('country_code').notNull(),
  harmonizedSystemCode: text('harmonized_system_code').notNull(),
}, (t) => [primaryKey({ columns: [t.inventoryItemId, t.countryCode] })]);
