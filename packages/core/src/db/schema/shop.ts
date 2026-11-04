import { boolean, check, index, jsonb, pgTable, text, uniqueIndex, bigint, primaryKey, integer } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { createdAt, oneOf, pk, ref, shopIdCol, timestamps, ts } from './_helpers';

export const WEIGHT_UNITS = ['KILOGRAMS', 'GRAMS', 'POUNDS', 'OUNCES'] as const;
export const STAFF_ROLES = ['owner', 'admin', 'staff'] as const;

export const shops = pgTable('shops', {
  id: pk(),
  name: text('name').notNull(),
  email: text('email').notNull(),
  currency: text('currency').notNull().default('USD'),
  country: text('country').notNull().default('US'),
  locale: text('locale').notNull().default('en'),
  timezone: text('timezone').notNull().default('UTC'),
  weightUnit: text('weight_unit').notNull().default('KILOGRAMS'),
  moneyFormat: text('money_format').notNull().default('${{amount}}'),
  moneyWithCurrencyFormat: text('money_with_currency_format').notNull().default('${{amount}} USD'),
  taxesIncluded: boolean('taxes_included').notNull().default(false),
  primaryDomain: text('primary_domain'),
  /** Free-form settings (address, checkout options, theme-facing flags, ...). */
  settings: jsonb('settings').$type<Record<string, unknown>>().notNull().default({}),
  ...timestamps(),
}, (t) => [check('shops_weight_unit_chk', oneOf(t.weightUnit, WEIGHT_UNITS))]);

export const staffUsers = pgTable('staff_users', {
  id: pk(),
  shopId: shopIdCol().references(() => shops.id, { onDelete: 'cascade' }),
  email: text('email').notNull(), // stored lower-cased
  passwordHash: text('password_hash').notNull(),
  firstName: text('first_name'),
  lastName: text('last_name'),
  role: text('role').notNull().default('staff'),
  active: boolean('active').notNull().default(true),
  lastLoginAt: ts('last_login_at'),
  ...timestamps(),
}, (t) => [uniqueIndex('staff_users_shop_email_uq').on(t.shopId, t.email), check('staff_users_role_chk', oneOf(t.role, STAFF_ROLES))]);

/** Browser sessions. `id` is the SHA-256 of the cookie token. Exactly one of staff_user_id / customer_id is set. */
export const sessions = pgTable('sessions', {
  id: text('id').primaryKey(),
  shopId: shopIdCol().references(() => shops.id, { onDelete: 'cascade' }),
  kind: text('kind').notNull().default('staff'),
  staffUserId: ref('staff_user_id').references(() => staffUsers.id, { onDelete: 'cascade' }),
  customerId: ref('customer_id'),
  expiresAt: ts('expires_at').notNull(),
  ip: text('ip'),
  userAgent: text('user_agent'),
  createdAt: createdAt(),
}, (t) => [index('sessions_expires_idx').on(t.expiresAt), check('sessions_kind_chk', oneOf(t.kind, ['staff', 'customer']))]);

/** Admin API access tokens (`X-Shopify-Access-Token` style header). Only the hash is stored. */
export const apiTokens = pgTable('api_tokens', {
  id: pk(),
  shopId: shopIdCol().references(() => shops.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  tokenHash: text('token_hash').notNull().unique(),
  tokenPrefix: text('token_prefix').notNull(),
  scopes: text('scopes').array().notNull().default(sql`'{}'::text[]`),
  expiresAt: ts('expires_at'),
  revokedAt: ts('revoked_at'),
  lastUsedAt: ts('last_used_at'),
  createdByStaffId: ref('created_by_staff_id'),
  createdAt: createdAt(),
});

/** Per-shop counters, e.g. order numbers (start 1001). */
export const sequences = pgTable('sequences', {
  shopId: shopIdCol().references(() => shops.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  value: bigint('value', { mode: 'number' }).notNull(),
}, (t) => [primaryKey({ columns: [t.shopId, t.name] })]);

/** Timeline / audit log. Order, customer and product timelines read from here; staff comments are kind='comment'. */
export const events = pgTable('events', {
  id: pk(),
  shopId: shopIdCol().references(() => shops.id, { onDelete: 'cascade' }),
  subjectType: text('subject_type').notNull(), // 'order' | 'customer' | 'product' | ...
  subjectId: ref('subject_id'),
  kind: text('kind').notNull().default('system'), // 'comment' | 'system'
  verb: text('verb'), // machine-readable action, e.g. 'order.paid'
  message: text('message'),
  authorStaffUserId: ref('author_staff_user_id').references(() => staffUsers.id, { onDelete: 'set null' }),
  data: jsonb('data').$type<Record<string, unknown>>(),
  createdAt: createdAt(),
}, (t) => [index('events_subject_idx').on(t.shopId, t.subjectType, t.subjectId, t.createdAt), check('events_kind_chk', oneOf(t.kind, ['comment', 'system']))]);

export const jobs = pgTable('jobs', {
  id: pk(),
  shopId: shopIdCol().references(() => shops.id, { onDelete: 'cascade' }),
  type: text('type').notNull(),
  status: text('status').notNull().default('PENDING'),
  done: boolean('done').notNull().default(false),
  attempts: integer('attempts').notNull().default(0),
  result: jsonb('result'),
  error: text('error'),
  createdAt: createdAt(),
  finishedAt: ts('finished_at'),
});

export const metafields = pgTable('metafields', {
  id: pk(),
  shopId: shopIdCol().references(() => shops.id, { onDelete: 'cascade' }),
  /** SHOP, PRODUCT, PRODUCTVARIANT, COLLECTION, CUSTOMER, ORDER, LOCATION, PAGE, ... (polymorphic; no FK) */
  ownerType: text('owner_type').notNull(),
  ownerId: bigint('owner_id', { mode: 'number' }).notNull(),
  namespace: text('namespace').notNull(),
  key: text('key').notNull(),
  type: text('type').notNull().default('single_line_text_field'),
  value: text('value').notNull(),
  ...timestamps(),
}, (t) => [uniqueIndex('metafields_owner_uq').on(t.shopId, t.ownerType, t.ownerId, t.namespace, t.key)]);

export const webhookSubscriptions = pgTable('webhook_subscriptions', {
  id: pk(),
  shopId: shopIdCol().references(() => shops.id, { onDelete: 'cascade' }),
  topic: text('topic').notNull(),
  endpointUrl: text('endpoint_url').notNull(),
  secret: text('secret').notNull(),
  format: text('format').notNull().default('JSON'),
  apiVersion: text('api_version').notNull().default('unstable'),
  active: boolean('active').notNull().default(true),
  ...timestamps(),
}, (t) => [index('webhook_subs_topic_idx').on(t.shopId, t.topic)]);

export const webhookDeliveries = pgTable('webhook_deliveries', {
  id: pk(),
  shopId: shopIdCol().references(() => shops.id, { onDelete: 'cascade' }),
  subscriptionId: ref('subscription_id').references(() => webhookSubscriptions.id, { onDelete: 'cascade' }),
  topic: text('topic').notNull(),
  payload: jsonb('payload').notNull(),
  status: text('status').notNull().default('PENDING'), // PENDING | SUCCESS | FAILED
  attempts: integer('attempts').notNull().default(0),
  nextAttemptAt: ts('next_attempt_at'),
  responseCode: integer('response_code'),
  lastError: text('last_error'),
  createdAt: createdAt(),
}, (t) => [index('webhook_deliveries_due_idx').on(t.status, t.nextAttemptAt)]);
