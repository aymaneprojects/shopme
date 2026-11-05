import { bigint, boolean, check, index, integer, jsonb, numeric, pgTable, primaryKey, text, uniqueIndex } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { money, oneOf, pk, ref, shopIdCol, timestamps, ts } from './_helpers';
import { shops } from './shop';
import { locations, productVariants } from './catalog';
import { orders } from './sales';

const shopFk = () => shopIdCol().references(() => shops.id, { onDelete: 'cascade' });

export const PICKUP_TIMES = ['ONE_HOUR', 'TWO_HOURS', 'FOUR_HOURS', 'TWENTY_FOUR_HOURS', 'TWO_TO_FOUR_DAYS', 'FIVE_OR_MORE_DAYS', 'CUSTOM'] as const;
export const PACKAGE_TYPES = ['BOX', 'ENVELOPE', 'SOFT_PACK', 'FLAT_RATE'] as const;
export const DELIVERY_METHOD_TYPES = ['SHIPPING', 'PICK_UP', 'LOCAL', 'NONE'] as const;

/** A named set of variants shipped with the same locations, zones and rates. One per shop has `isDefault` (the general profile). */
export const deliveryProfiles = pgTable('delivery_profiles', {
  id: pk(), shopId: shopFk(),
  name: text('name').notNull(),
  isDefault: boolean('is_default').notNull().default(false),
  version: integer('version').notNull().default(1),
  ...timestamps(),
}, (t) => [uniqueIndex('delivery_profiles_default_uq').on(t.shopId).where(sql`${t.isDefault}`)]);

/** Variants of a custom profile. A variant is in at most one custom profile; the others belong to the general profile. */
export const deliveryProfileVariants = pgTable('delivery_profile_variants', {
  profileId: bigint('profile_id', { mode: 'number' }).notNull().references(() => deliveryProfiles.id, { onDelete: 'cascade' }),
  variantId: bigint('variant_id', { mode: 'number' }).notNull().references(() => productVariants.id, { onDelete: 'cascade' }),
  shopId: shopFk(),
}, (t) => [primaryKey({ columns: [t.variantId] }), index('delivery_profile_variants_profile_idx').on(t.profileId)]);

export const deliveryLocationGroups = pgTable('delivery_location_groups', {
  id: pk(), shopId: shopFk(),
  profileId: bigint('profile_id', { mode: 'number' }).notNull().references(() => deliveryProfiles.id, { onDelete: 'cascade' }),
});
export const deliveryLocationGroupLocations = pgTable('delivery_location_group_locations', {
  groupId: bigint('group_id', { mode: 'number' }).notNull().references(() => deliveryLocationGroups.id, { onDelete: 'cascade' }),
  locationId: bigint('location_id', { mode: 'number' }).notNull().references(() => locations.id, { onDelete: 'cascade' }),
  shopId: shopFk(),
}, (t) => [primaryKey({ columns: [t.groupId, t.locationId] })]);

export const deliveryZones = pgTable('delivery_zones', {
  id: pk(), shopId: shopFk(),
  groupId: bigint('group_id', { mode: 'number' }).notNull().references(() => deliveryLocationGroups.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  /** Set when the zone was created from a market's shipping editor. */
  marketId: ref('market_id'),
});
export const deliveryZoneCountries = pgTable('delivery_zone_countries', {
  id: pk(), shopId: shopFk(),
  zoneId: bigint('zone_id', { mode: 'number' }).notNull().references(() => deliveryZones.id, { onDelete: 'cascade' }),
  /** ISO code, or null with `restOfWorld`. */
  countryCode: text('country_code'),
  restOfWorld: boolean('rest_of_world').notNull().default(false),
  /** Empty = whole country. */
  provinceCodes: text('province_codes').array().notNull().default(sql`'{}'::text[]`),
}, (t) => [index('delivery_zone_countries_zone_idx').on(t.zoneId)]);

/** A rate offered in a zone: fixed price, optional conditions on total weight or total price, optional free-over threshold. */
export const deliveryMethodDefinitions = pgTable('delivery_method_definitions', {
  id: pk(), shopId: shopFk(),
  zoneId: bigint('zone_id', { mode: 'number' }).notNull().references(() => deliveryZones.id, { onDelete: 'cascade' }),
  name: text('name').notNull(), description: text('description'),
  active: boolean('active').notNull().default(true),
  position: integer('position').notNull().default(0),
  /** Shop currency minor units. */
  price: money('price').notNull().default(0),
  /** The price becomes 0 once the qualifying subtotal reaches this amount. */
  freeOverAmount: money('free_over_amount'),
  /** Estimated transit time in days (shown to the buyer as a delivery date range). */
  transitMinDays: integer('transit_min_days'), transitMaxDays: integer('transit_max_days'),
  /** The rate is offered only when every item belongs to one of these collections (empty = all products). */
  collectionIds: bigint('collection_ids', { mode: 'number' }).array().notNull().default(sql`'{}'::bigint[]`),
  /** The rate is offered only when it ships from one of these locations (empty = any location of the group). */
  originLocationIds: bigint('origin_location_ids', { mode: 'number' }).array().notNull().default(sql`'{}'::bigint[]`),
  /** `FIXED` uses `price`; `CARRIER` asks the carrier provider for the price at checkout. */
  rateType: text('rate_type').notNull().default('FIXED'),
  carrierProvider: text('carrier_provider'),
  carrierParams: jsonb('carrier_params').$type<Record<string, unknown>>().notNull().default({}),
}, (t) => [index('delivery_method_definitions_zone_idx').on(t.zoneId)]);
export const deliveryConditions = pgTable('delivery_conditions', {
  id: pk(), shopId: shopFk(),
  methodId: bigint('method_id', { mode: 'number' }).notNull().references(() => deliveryMethodDefinitions.id, { onDelete: 'cascade' }),
  field: text('field').notNull(), // TOTAL_WEIGHT (grams) | TOTAL_PRICE (minor units)
  operator: text('operator').notNull(), // GREATER_THAN_OR_EQUAL_TO | LESS_THAN_OR_EQUAL_TO
  value: bigint('value', { mode: 'number' }).notNull(),
}, (t) => [
  index('delivery_conditions_method_idx').on(t.methodId),
  check('delivery_conditions_field_chk', oneOf(t.field, ['TOTAL_WEIGHT', 'TOTAL_PRICE'])),
  check('delivery_conditions_operator_chk', oneOf(t.operator, ['GREATER_THAN_OR_EQUAL_TO', 'LESS_THAN_OR_EQUAL_TO'])),
]);

export const locationPickupSettings = pgTable('location_pickup_settings', {
  locationId: bigint('location_id', { mode: 'number' }).primaryKey().references(() => locations.id, { onDelete: 'cascade' }), shopId: shopFk(),
  enabled: boolean('enabled').notNull().default(false),
  pickupTime: text('pickup_time').notNull().default('TWO_TO_FOUR_DAYS'),
  customPickupTime: text('custom_pickup_time'),
  instructions: text('instructions').notNull().default(''),
}, (t) => [check('location_pickup_time_chk', oneOf(t.pickupTime, PICKUP_TIMES))]);

export const locationLocalDelivery = pgTable('location_local_delivery', {
  locationId: bigint('location_id', { mode: 'number' }).primaryKey().references(() => locations.id, { onDelete: 'cascade' }), shopId: shopFk(),
  enabled: boolean('enabled').notNull().default(false),
  areaType: text('area_type').notNull().default('POSTAL_CODES'), // RADIUS | POSTAL_CODES
  radiusKm: numeric('radius_km', { precision: 8, scale: 2, mode: 'number' }),
  postalCodes: text('postal_codes').array().notNull().default(sql`'{}'::text[]`),
  price: money('price').notNull().default(0),
  minimumOrder: money('minimum_order'),
  freeOverAmount: money('free_over_amount'),
  info: text('info'), phone: text('phone'),
}, (t) => [check('location_local_delivery_area_chk', oneOf(t.areaType, ['RADIUS', 'POSTAL_CODES']))]);

export const shippingPackages = pgTable('shipping_packages', {
  id: pk(), shopId: shopFk(), name: text('name').notNull(),
  type: text('type').notNull().default('BOX'),
  length: numeric('length', { precision: 10, scale: 3, mode: 'number' }), width: numeric('width', { precision: 10, scale: 3, mode: 'number' }), height: numeric('height', { precision: 10, scale: 3, mode: 'number' }),
  dimensionUnit: text('dimension_unit').notNull().default('CENTIMETERS'),
  weight: numeric('weight', { precision: 10, scale: 3, mode: 'number' }), weightUnit: text('weight_unit').notNull().default('KILOGRAMS'),
  isDefault: boolean('is_default').notNull().default(false),
  ...timestamps(),
}, (t) => [check('shipping_packages_type_chk', oneOf(t.type, PACKAGE_TYPES))]);

/** How an order is delivered, and the pickup progress. One row per order that ships, is picked up or is delivered locally. */
export const orderDeliveries = pgTable('order_deliveries', {
  orderId: bigint('order_id', { mode: 'number' }).primaryKey().references(() => orders.id, { onDelete: 'cascade' }), shopId: shopFk(),
  methodType: text('method_type').notNull().default('SHIPPING'),
  locationId: bigint('location_id', { mode: 'number' }).references(() => locations.id, { onDelete: 'set null' }),
  pickupReadyAt: ts('pickup_ready_at'), pickedUpAt: ts('picked_up_at'),
}, (t) => [check('order_deliveries_type_chk', oneOf(t.methodType, DELIVERY_METHOD_TYPES))]);
