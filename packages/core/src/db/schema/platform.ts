import { boolean, index, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core';
import { createdAt, pk, ref, shopIdCol, timestamps, ts } from './_helpers';
import { shops, staffUsers } from './shop';

const shopFk = () => shopIdCol().references(() => shops.id, { onDelete: 'cascade' });

/** Server-side storefront page views (first-party, no third party). `sessionId` is an anonymous random id from the visit cookie. */
export const visits = pgTable('visits', {
  id: pk(), shopId: shopFk(),
  sessionId: text('session_id').notNull(),
  path: text('path').notNull(),
  referrer: text('referrer'),
  createdAt: createdAt(),
}, (t) => [index('visits_shop_created_idx').on(t.shopId, t.createdAt)]);

/** TOTP second factor of a staff member. `secret` is AES-GCM encrypted; `recoveryCodes` hold SHA-256 hashes of unused codes. */
export const staffTwoFactor = pgTable('staff_two_factor', {
  staffUserId: ref('staff_user_id').primaryKey().references(() => staffUsers.id, { onDelete: 'cascade' }),
  shopId: shopFk(),
  secret: text('secret').notNull(),
  enabled: boolean('enabled').notNull().default(false),
  recoveryCodes: text('recovery_codes').array().notNull().default([]),
  enabledAt: ts('enabled_at'),
  createdAt: createdAt(),
});

/** Additional storefront languages (the primary one is `shops.locale`). */
export const shopLocales = pgTable('shop_locales', {
  id: pk(), shopId: shopFk(),
  locale: text('locale').notNull(),
  published: boolean('published').notNull().default(false),
  createdAt: createdAt(),
}, (t) => [uniqueIndex('shop_locales_uq').on(t.shopId, t.locale)]);

/** Translated values of translatable resource fields (Shopify's `TranslatableContent` / `Translation`). */
export const translations = pgTable('translations', {
  id: pk(), shopId: shopFk(),
  /** PRODUCT, COLLECTION, PAGE, ARTICLE, MENU, ONLINE_STORE_THEME */
  resourceType: text('resource_type').notNull(),
  resourceId: text('resource_id').notNull(),
  key: text('key').notNull(),
  locale: text('locale').notNull(),
  value: text('value').notNull(),
  /** Digest of the source value when translated; a different digest means the translation is outdated. */
  digest: text('digest').notNull(),
  updatedAt: timestamps().updatedAt,
}, (t) => [uniqueIndex('translations_uq').on(t.shopId, t.resourceType, t.resourceId, t.key, t.locale), index('translations_lookup_idx').on(t.shopId, t.locale, t.resourceType)]);
