import { bigint, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core';
import { createdAt, pk, shopIdCol } from './_helpers';
import { shops } from './shop';

/** Source id -> local id for migrated resources, so re-running a migration updates instead of duplicating. */
export const importMappings = pgTable('import_mappings', {
  id: pk(),
  shopId: shopIdCol().references(() => shops.id, { onDelete: 'cascade' }),
  /** e.g. `shopify:my-store.myshopify.com` */
  source: text('source').notNull(),
  /** product, variant, collection, customer, order, page, blog, article, menu, location */
  resourceType: text('resource_type').notNull(),
  /** Source identifier (Shopify GID). */
  sourceId: text('source_id').notNull(),
  localId: bigint('local_id', { mode: 'number' }).notNull(),
  createdAt: createdAt(),
}, (t) => [uniqueIndex('import_mappings_uq').on(t.shopId, t.source, t.resourceType, t.sourceId)]);
