import { boolean, index, integer, jsonb, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core';
import { createdAt, pk, ref, shopIdCol, timestamps, ts } from './_helpers';
import { shops } from './shop';
import { customers } from './sales';

const shopFk = () => shopIdCol().references(() => shops.id, { onDelete: 'cascade' });

/** One-time sign-in codes sent by email (passwordless sign-in). Only a hash of the code is stored. */
export const customerLoginCodes = pgTable('customer_login_codes', {
  id: pk(), shopId: shopFk(),
  email: text('email').notNull(),
  codeHash: text('code_hash').notNull(),
  attempts: integer('attempts').notNull().default(0),
  expiresAt: ts('expires_at').notNull(),
  consumedAt: ts('consumed_at'),
  createdAt: createdAt(),
}, (t) => [index('customer_login_codes_email_idx').on(t.shopId, t.email)]);

/** Merchant-defined consent rules (manual mode). A null country is the default for every region. */
export const consentPolicies = pgTable('consent_policies', {
  id: pk(), shopId: shopFk(),
  countryCode: text('country_code'),
  regionCode: text('region_code'),
  consentRequired: boolean('consent_required').notNull().default(false),
  dataSaleOptOutRequired: boolean('data_sale_opt_out_required').notNull().default(false),
}, (t) => [uniqueIndex('consent_policies_uq').on(t.shopId, t.countryCode, t.regionCode)]);

/** Pixels: merchant-pasted scripts (CUSTOM) run sandboxed in the storefront; APP and SERVER kinds are reserved for later. */
export const pixels = pgTable('pixels', {
  id: pk(), shopId: shopFk(),
  kind: text('kind').notNull().default('CUSTOM'),
  name: text('name').notNull(),
  code: text('code'),
  settings: jsonb('settings').$type<Record<string, unknown>>().notNull().default({}),
  connected: boolean('connected').notNull().default(false),
  /** Consent categories the visitor must have granted before the pixel runs (analytics, marketing, preferences). */
  requiredConsent: text('required_consent').array().notNull().default([]),
  respectSaleOptOut: boolean('respect_sale_opt_out').notNull().default(true),
  domEvents: boolean('dom_events').notNull().default(false),
  ...timestamps(),
});

/** First-party event stream (only recorded with analytics consent, kept 90 days). */
export const storefrontEvents = pgTable('storefront_events', {
  id: pk(), shopId: shopFk(),
  eventId: text('event_id'),
  name: text('name').notNull(),
  clientId: text('client_id'),
  customerId: ref('customer_id').references(() => customers.id, { onDelete: 'set null' }),
  data: jsonb('data').$type<Record<string, unknown> | null>(),
  context: jsonb('context').$type<Record<string, unknown> | null>(),
  occurredAt: ts('occurred_at').notNull(),
  createdAt: createdAt(),
}, (t) => [index('storefront_events_idx').on(t.shopId, t.name, t.occurredAt), uniqueIndex('storefront_events_event_uq').on(t.shopId, t.eventId)]);
