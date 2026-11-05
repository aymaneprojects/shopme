import { boolean, index, jsonb, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core';
import { pk, shopIdCol, timestamps } from './_helpers';
import { shops } from './shop';

/** Typed metafield definitions (schema for `metafields` rows of one owner type). */
export const metafieldDefinitions = pgTable('metafield_definitions', {
  id: pk(),
  shopId: shopIdCol().references(() => shops.id, { onDelete: 'cascade' }),
  ownerType: text('owner_type').notNull(),
  namespace: text('namespace').notNull(),
  key: text('key').notNull(),
  name: text('name').notNull(),
  description: text('description'),
  type: text('type').notNull(),
  validations: jsonb('validations').notNull().default([]),
  pinned: boolean('pinned').notNull().default(false),
  /** Exposed to the storefront (Liquid `metafields` and Ajax). Shopify's `access.storefront`. */
  storefrontVisible: boolean('storefront_visible').notNull().default(true),
  ...timestamps(),
}, (t) => [
  uniqueIndex('metafield_definitions_uq').on(t.shopId, t.ownerType, t.namespace, t.key),
  index('metafield_definitions_owner_idx').on(t.shopId, t.ownerType),
]);
