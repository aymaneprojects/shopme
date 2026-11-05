import { bigint, boolean, index, integer, jsonb, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core';
import { pk, ref, shopIdCol, timestamps } from './_helpers';
import { shops } from './shop';

const shopFk = () => shopIdCol().references(() => shops.id, { onDelete: 'cascade' });

export interface MetaobjectFieldDef {
  key: string; name: string; description?: string | null; type: string; required: boolean;
  validations: { name: string; value: string }[]; adminFilterable?: boolean;
}

/** Merchant-defined content types (a type name, typed fields, capabilities). */
export const metaobjectDefinitions = pgTable('metaobject_definitions', {
  id: pk(), shopId: shopFk(),
  type: text('type').notNull(),
  name: text('name').notNull(), description: text('description'),
  fieldDefinitions: jsonb('field_definitions').$type<MetaobjectFieldDef[]>().notNull().default([]),
  displayNameKey: text('display_name_key'),
  accessAdmin: text('access_admin').notNull().default('PUBLIC_READ_WRITE'),
  accessStorefront: text('access_storefront').notNull().default('PUBLIC_READ'),
  accessCustomerAccount: text('access_customer_account').notNull().default('NONE'),
  capPublishable: boolean('cap_publishable').notNull().default(true),
  capTranslatable: boolean('cap_translatable').notNull().default(true),
  capRenderable: boolean('cap_renderable').notNull().default(false),
  renderableMetaTitleKey: text('renderable_meta_title_key'), renderableMetaDescKey: text('renderable_meta_desc_key'),
  capOnlineStore: boolean('cap_online_store').notNull().default(false),
  onlineStoreUrlHandle: text('online_store_url_handle'),
  onlineStoreCreateRedirects: boolean('online_store_create_redirects').notNull().default(false),
  ownerApp: text('owner_app'),
  entryCount: integer('entry_count').notNull().default(0),
  ...timestamps(),
}, (t) => [uniqueIndex('metaobject_defs_type_uq').on(t.shopId, t.type), uniqueIndex('metaobject_defs_urlhandle_uq').on(t.shopId, t.onlineStoreUrlHandle)]);

/** Entries of a definition. `values` maps field key to the stored string (same encoding as metafields). */
export const metaobjects = pgTable('metaobjects', {
  id: pk(), shopId: shopFk(),
  definitionId: ref('definition_id').notNull().references(() => metaobjectDefinitions.id, { onDelete: 'cascade' }),
  type: text('type').notNull(),
  handle: text('handle').notNull(),
  status: text('status').notNull().default('ACTIVE'),
  displayName: text('display_name').notNull().default(''),
  values: jsonb('values').$type<Record<string, string>>().notNull().default({}),
  templateSuffix: text('template_suffix'),
  /** ShopMe: the entry's id in another system (unique per type) for imports and syncs. */
  externalId: text('external_id'),
  createdByStaffId: ref('created_by_staff_id'), createdByApp: text('created_by_app'),
  ...timestamps(),
}, (t) => [uniqueIndex('metaobjects_handle_uq').on(t.shopId, t.type, t.handle), uniqueIndex('metaobjects_external_uq').on(t.shopId, t.type, t.externalId), index('metaobjects_def_idx').on(t.definitionId, t.updatedAt)]);

/** Reverse index: which entry fields and metafields point at an entry (referencedBy, delete checks). */
export const metaobjectReferences = pgTable('metaobject_references', {
  id: pk(), shopId: shopFk(),
  targetId: ref('target_id').notNull().references(() => metaobjects.id, { onDelete: 'cascade' }),
  sourceKind: text('source_kind').notNull(), // METAOBJECT | METAFIELD
  sourceId: bigint('source_id', { mode: 'number' }).notNull(),
  fieldKey: text('field_key').notNull(),
}, (t) => [index('metaobject_refs_target_idx').on(t.targetId), index('metaobject_refs_source_idx').on(t.sourceKind, t.sourceId)]);
