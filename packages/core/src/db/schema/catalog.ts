import { bigint, boolean, check, index, integer, numeric, pgTable, primaryKey, text, uniqueIndex } from 'drizzle-orm/pg-core';
import { createdAt, money, oneOf, pk, ref, shopIdCol, tagsCol, timestamps, ts } from './_helpers';
import { shops, WEIGHT_UNITS } from './shop';

const shopFk = () => shopIdCol().references(() => shops.id, { onDelete: 'cascade' });

export const LENGTH_UNITS = ['MILLIMETERS', 'CENTIMETERS', 'METERS', 'INCHES', 'FEET', 'YARDS'] as const;
export const PRODUCT_STATUSES = ['ACTIVE', 'ARCHIVED', 'DRAFT'] as const;
export const COLLECTION_SORT_ORDERS = ['ALPHA_ASC', 'ALPHA_DESC', 'BEST_SELLING', 'CREATED', 'CREATED_DESC', 'MANUAL', 'PRICE_ASC', 'PRICE_DESC'] as const;

/** Uploaded files (any kind). Bytes live in storage under `storageKey`. */
export const files = pgTable('files', {
  id: pk(), shopId: shopFk(),
  filename: text('filename').notNull(),
  storageKey: text('storage_key').notNull(),
  mimeType: text('mime_type'),
  byteSize: bigint('byte_size', { mode: 'number' }),
  alt: text('alt'),
  createdAt: createdAt(),
}, (t) => [uniqueIndex('files_storage_key_uq').on(t.shopId, t.storageKey)]);

/** Folders of the Files library (flat). */
export const fileFolders = pgTable('file_folders', {
  id: pk(), shopId: shopFk(), name: text('name').notNull(), createdAt: createdAt(),
}, (t) => [uniqueIndex('file_folders_shop_name_uq').on(t.shopId, t.name)]);

/** Images/videos attached to products, collections, articles. */
export const media = pgTable('media', {
  id: pk(), shopId: shopFk(),
  type: text('type').notNull().default('IMAGE'),
  alt: text('alt'),
  status: text('status').notNull().default('READY'),
  fileId: ref('file_id').references(() => files.id, { onDelete: 'set null' }),
  url: text('url'), // external or resolved URL; for local files use /files/<storage key>
  mimeType: text('mime_type'), width: integer('width'), height: integer('height'),
  folderId: ref('folder_id').references(() => fileFolders.id, { onDelete: 'set null' }),
  ...timestamps(),
}, (t) => [check('media_type_chk', oneOf(t.type, ['IMAGE', 'VIDEO', 'EXTERNAL_VIDEO', 'MODEL_3D']))]);

export const products = pgTable('products', {
  id: pk(), shopId: shopFk(),
  handle: text('handle').notNull(),
  title: text('title').notNull(),
  descriptionHtml: text('description_html').notNull().default(''),
  status: text('status').notNull().default('DRAFT'),
  vendor: text('vendor').notNull().default(''),
  productType: text('product_type').notNull().default(''),
  tags: tagsCol(),
  templateSuffix: text('template_suffix'),
  seoTitle: text('seo_title'), seoDescription: text('seo_description'),
  publishedAt: ts('published_at'),
  isGiftCard: boolean('is_gift_card').notNull().default(false),
  /** Taxonomy category id (see services/catalog/taxonomy). */
  category: text('category'),
  ...timestamps(),
}, (t) => [
  uniqueIndex('products_shop_handle_uq').on(t.shopId, t.handle),
  index('products_shop_status_idx').on(t.shopId, t.status, t.updatedAt),
  check('products_status_chk', oneOf(t.status, PRODUCT_STATUSES)),
]);

export const productMedia = pgTable('product_media', {
  shopId: shopFk(),
  productId: ref('product_id').notNull().references(() => products.id, { onDelete: 'cascade' }),
  mediaId: ref('media_id').notNull().references(() => media.id, { onDelete: 'cascade' }),
  position: integer('position').notNull().default(0),
}, (t) => [primaryKey({ columns: [t.productId, t.mediaId] })]);

export const productOptions = pgTable('product_options', {
  id: pk(), shopId: shopFk(),
  productId: ref('product_id').notNull().references(() => products.id, { onDelete: 'cascade' }),
  name: text('name').notNull(), position: integer('position').notNull(),
}, (t) => [uniqueIndex('product_options_name_uq').on(t.productId, t.name)]);

export const productOptionValues = pgTable('product_option_values', {
  id: pk(), shopId: shopFk(),
  optionId: ref('option_id').notNull().references(() => productOptions.id, { onDelete: 'cascade' }),
  name: text('name').notNull(), position: integer('position').notNull(),
}, (t) => [uniqueIndex('product_option_values_name_uq').on(t.optionId, t.name)]);

export const productVariants = pgTable('product_variants', {
  id: pk(), shopId: shopFk(),
  productId: ref('product_id').notNull().references(() => products.id, { onDelete: 'cascade' }),
  position: integer('position').notNull().default(1),
  title: text('title').notNull().default('Default Title'),
  sku: text('sku'), barcode: text('barcode'),
  price: money('price').notNull().default(0),
  compareAtPrice: money('compare_at_price'),
  taxable: boolean('taxable').notNull().default(true),
  taxCode: text('tax_code'),
  inventoryPolicy: text('inventory_policy').notNull().default('DENY'),
  mediaId: ref('media_id').references(() => media.id, { onDelete: 'set null' }),
  /** Unit price measurement, e.g. 750 ml priced per 100 ml. */
  unitQuantityValue: numeric('unit_quantity_value', { precision: 12, scale: 4, mode: 'number' }), unitQuantityUnit: text('unit_quantity_unit'),
  unitReferenceValue: integer('unit_reference_value'), unitReferenceUnit: text('unit_reference_unit'),
  ...timestamps(),
}, (t) => [index('product_variants_product_idx').on(t.productId, t.position), index('product_variants_sku_idx').on(t.shopId, t.sku),
  check('product_variants_policy_chk', oneOf(t.inventoryPolicy, ['DENY', 'CONTINUE']))]);

/** Variant -> chosen option value (one row per option). */
export const variantOptionValues = pgTable('variant_option_values', {
  shopId: shopFk(),
  variantId: ref('variant_id').notNull().references(() => productVariants.id, { onDelete: 'cascade' }),
  optionId: ref('option_id').notNull().references(() => productOptions.id, { onDelete: 'cascade' }),
  optionValueId: ref('option_value_id').notNull().references(() => productOptionValues.id, { onDelete: 'cascade' }),
}, (t) => [primaryKey({ columns: [t.variantId, t.optionId] })]);

export const locations = pgTable('locations', {
  id: pk(), shopId: shopFk(),
  name: text('name').notNull(),
  isActive: boolean('is_active').notNull().default(true),
  fulfillsOnlineOrders: boolean('fulfills_online_orders').notNull().default(true),
  /** Stock allocation order for online orders: lowest first. */
  priority: integer('priority').notNull().default(0),
  address1: text('address1'), address2: text('address2'), city: text('city'), provinceCode: text('province_code'),
  zip: text('zip'), countryCode: text('country_code'), phone: text('phone'),
  ...timestamps(),
});

export const inventoryItems = pgTable('inventory_items', {
  id: pk(), shopId: shopFk(),
  variantId: ref('variant_id').notNull().unique().references(() => productVariants.id, { onDelete: 'cascade' }),
  sku: text('sku'),
  tracked: boolean('tracked').notNull().default(true),
  requiresShipping: boolean('requires_shipping').notNull().default(true),
  weightValue: numeric('weight_value', { precision: 12, scale: 4, mode: 'number' }),
  weightUnit: text('weight_unit').default('KILOGRAMS'),
  countryCodeOfOrigin: text('country_code_of_origin'), harmonizedSystemCode: text('harmonized_system_code'),
  /** Package dimensions (ShopMe extension; Shopify only has a shipping package id). */
  lengthValue: numeric('length_value', { precision: 12, scale: 4, mode: 'number' }), widthValue: numeric('width_value', { precision: 12, scale: 4, mode: 'number' }), heightValue: numeric('height_value', { precision: 12, scale: 4, mode: 'number' }),
  dimensionUnit: text('dimension_unit').default('CENTIMETERS'),
  unitCost: money('unit_cost'),
  ...timestamps(),
}, (t) => [check('inventory_items_weight_chk', oneOf(t.weightUnit, WEIGHT_UNITS)), check('inventory_items_dimension_chk', oneOf(t.dimensionUnit, LENGTH_UNITS))]);

export const inventoryLevels = pgTable('inventory_levels', {
  id: pk(), shopId: shopFk(),
  inventoryItemId: ref('inventory_item_id').notNull().references(() => inventoryItems.id, { onDelete: 'cascade' }),
  locationId: ref('location_id').notNull().references(() => locations.id, { onDelete: 'cascade' }),
  isActive: boolean('is_active').notNull().default(true),
  available: integer('available').notNull().default(0),
  onHand: integer('on_hand').notNull().default(0),
  committed: integer('committed').notNull().default(0),
  incoming: integer('incoming').notNull().default(0),
  reserved: integer('reserved').notNull().default(0),
  ...timestamps(),
}, (t) => [uniqueIndex('inventory_levels_item_location_uq').on(t.inventoryItemId, t.locationId)]);

/** Append-only ledger: every quantity change is recorded here in the same transaction as the level update. */
export const inventoryAdjustments = pgTable('inventory_adjustments', {
  id: pk(), shopId: shopFk(),
  groupId: ref('group_id'),
  inventoryItemId: ref('inventory_item_id').notNull(), locationId: ref('location_id').notNull(),
  name: text('name').notNull().default('available'),
  delta: integer('delta').notNull(), quantityAfter: integer('quantity_after').notNull(),
  reason: text('reason').notNull(), referenceUri: text('reference_uri'),
  createdAt: createdAt(),
}, (t) => [index('inventory_adjustments_item_idx').on(t.inventoryItemId, t.createdAt)]);

export const collections = pgTable('collections', {
  id: pk(), shopId: shopFk(),
  handle: text('handle').notNull(), title: text('title').notNull(),
  descriptionHtml: text('description_html').notNull().default(''),
  sortOrder: text('sort_order').notNull().default('MANUAL'),
  templateSuffix: text('template_suffix'),
  seoTitle: text('seo_title'), seoDescription: text('seo_description'),
  imageMediaId: ref('image_media_id').references(() => media.id, { onDelete: 'set null' }),
  isSmart: boolean('is_smart').notNull().default(false),
  rulesAppliedDisjunctively: boolean('rules_applied_disjunctively').notNull().default(false),
  publishedAt: ts('published_at'),
  ...timestamps(),
}, (t) => [uniqueIndex('collections_shop_handle_uq').on(t.shopId, t.handle), check('collections_sort_chk', oneOf(t.sortOrder, COLLECTION_SORT_ORDERS))]);

export const collectionRules = pgTable('collection_rules', {
  id: pk(), shopId: shopFk(),
  collectionId: ref('collection_id').notNull().references(() => collections.id, { onDelete: 'cascade' }),
  position: integer('position').notNull().default(0),
  ruleColumn: text('rule_column').notNull(), relation: text('relation').notNull(), condition: text('condition').notNull(),
});

export const collectionProducts = pgTable('collection_products', {
  shopId: shopFk(),
  collectionId: ref('collection_id').notNull().references(() => collections.id, { onDelete: 'cascade' }),
  productId: ref('product_id').notNull().references(() => products.id, { onDelete: 'cascade' }),
  position: integer('position').notNull().default(0),
  source: text('source').notNull().default('manual'), // manual | rule
}, (t) => [primaryKey({ columns: [t.collectionId, t.productId] }), index('collection_products_product_idx').on(t.productId)]);
