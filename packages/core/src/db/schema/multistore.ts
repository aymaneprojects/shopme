import { boolean, index, jsonb, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core';
import { createdAt, pk, ref, shopIdCol, timestamps, ts } from './_helpers';
import { shops } from './shop';

/**
 * A person who signs in to the admin. One account can be a staff member of several stores (`staff_users.account_id`); its role
 * and permissions stay per store. The e-mail is not unique on purpose: staff migrated from separate stores keep separate
 * accounts until the person proves the password of each (see `authenticateAccount`).
 */
export const platformAccounts = pgTable('platform_accounts', {
  id: pk(),
  email: text('email').notNull(), // stored lower-cased
  passwordHash: text('password_hash').notNull(),
  firstName: text('first_name'),
  lastName: text('last_name'),
  /** The first account of the installation: may list, suspend and delete every store (multi-store mode). */
  platformOwner: boolean('platform_owner').notNull().default(false),
  active: boolean('active').notNull().default(true),
  lastLoginAt: ts('last_login_at'),
  ...timestamps(),
}, (t) => [index('platform_accounts_email_idx').on(t.email)]);

/** TOTP second factor of an account. `secret` is AES-GCM encrypted; `recoveryCodes` hold SHA-256 hashes of unused codes. */
export const accountTwoFactor = pgTable('account_two_factor', {
  accountId: ref('account_id').primaryKey().references(() => platformAccounts.id, { onDelete: 'cascade' }),
  secret: text('secret').notNull(),
  enabled: boolean('enabled').notNull().default(false),
  recoveryCodes: text('recovery_codes').array().notNull().default([]),
  enabledAt: ts('enabled_at'),
  createdAt: createdAt(),
});

/** Custom domains of a store (multi-store mode). A host belongs to at most one store; it serves the store once verified. */
export const shopDomains = pgTable('shop_domains', {
  id: pk(),
  shopId: shopIdCol().references(() => shops.id, { onDelete: 'cascade' }),
  host: text('host').notNull(),
  /** Value of the `_shopme-verify.<host>` TXT record that proves control of the domain. */
  verificationToken: text('verification_token').notNull(),
  verifiedAt: ts('verified_at'),
  createdAt: createdAt(),
}, (t) => [uniqueIndex('shop_domains_host_uq').on(t.host), index('shop_domains_shop_idx').on(t.shopId)]);

/** Credentials of a store's own payment account. Secret values are AES-GCM encrypted with the session secret; never exported. */
export const shopSecrets = pgTable('shop_secrets', {
  shopId: shopIdCol().primaryKey().references(() => shops.id, { onDelete: 'cascade' }),
  stripePublishableKey: text('stripe_publishable_key'),
  stripeSecretKey: text('stripe_secret_key'),
  stripeWebhookSecret: text('stripe_webhook_secret'),
  ...timestamps(),
});

/** Installation-wide settings (multi-store mode), e.g. who may create stores. */
export const platformSettings = pgTable('platform_settings', {
  key: text('key').primaryKey(),
  value: jsonb('value').$type<unknown>().notNull(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});
