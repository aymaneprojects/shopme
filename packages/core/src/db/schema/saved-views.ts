import { check, index, integer, pgTable, text } from 'drizzle-orm/pg-core';
import { oneOf, pk, ref, shopIdCol, timestamps } from './_helpers';
import { shops } from './shop';

export const SAVED_SEARCH_TYPES = ['PRODUCT', 'ORDER', 'CUSTOMER', 'INVENTORY'] as const;

/**
 * Saved views of the admin lists (the tabs next to "All"): a named search shared by all staff of the shop.
 * `query` is the search syntax; `params` is the list state (filters, sort) as a URL query string, which the admin applies as is.
 */
export const savedSearches = pgTable('saved_searches', {
  id: pk(),
  shopId: shopIdCol().references(() => shops.id, { onDelete: 'cascade' }),
  resourceType: text('resource_type').notNull(),
  name: text('name').notNull(),
  query: text('query').notNull().default(''),
  params: text('params').notNull().default(''),
  position: integer('position').notNull().default(0),
  createdBy: ref('created_by'),
  ...timestamps(),
}, (t) => [index('saved_searches_shop_type_idx').on(t.shopId, t.resourceType, t.position), check('saved_searches_type_chk', oneOf(t.resourceType, SAVED_SEARCH_TYPES))]);
