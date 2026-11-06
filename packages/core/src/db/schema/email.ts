import { bigint, boolean, check, index, integer, jsonb, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core';
import { createdAt, oneOf, pk, timestamps, ts } from './_helpers';
import { shops } from './shop';

/** `shop_id` is null for the installation's own row (the platform sending identity used as the fallback From). */
const scopeCol = () => bigint('shop_id', { mode: 'number' }).references(() => shops.id, { onDelete: 'cascade' });

/**
 * How a store (or the installation, `shop_id` null) sends e-mail. `mode` null = nothing chosen: direct delivery from this server
 * unless the installation has an SMTP_URL. Relay credentials are write-only; the password is AES-GCM encrypted.
 */
export const emailSettings = pgTable('email_settings', {
  id: pk(),
  shopId: scopeCol(),
  mode: text('mode'),
  relayPreset: text('relay_preset'),
  relayHost: text('relay_host'),
  relayPort: integer('relay_port'),
  relaySecurity: text('relay_security'),
  relayUsername: text('relay_username'),
  relayPasswordEnc: text('relay_password_enc'),
  /** Public IP typed by the merchant when it cannot be detected. */
  manualPublicIp: text('manual_public_ip'),
  dmarcReportEmail: text('dmarc_report_email'),
  /** Domain the last DNS check was run for, and whether its SPF and DKIM passed (drives the From decision at send time). */
  authDomain: text('auth_domain'),
  authOk: boolean('auth_ok').notNull().default(false),
  authCheckedAt: ts('auth_checked_at'),
  lastCheck: jsonb('last_check').$type<unknown>(),
  ...timestamps(),
}, (t) => [uniqueIndex('email_settings_shop_uq').on(t.shopId)]);

/** DKIM key pairs per sending domain. The private key is AES-GCM encrypted and never leaves the server. `pending` keys are not used for signing until activated. */
export const emailDkimKeys = pgTable('email_dkim_keys', {
  id: pk(),
  shopId: scopeCol(),
  domain: text('domain').notNull(),
  selector: text('selector').notNull(),
  /** Base64 of the SubjectPublicKeyInfo DER (the `p=` value of the DNS record). */
  publicKey: text('public_key').notNull(),
  privateKeyEnc: text('private_key_enc').notNull(),
  status: text('status').notNull().default('active'),
  createdAt: createdAt(),
  activatedAt: ts('activated_at'),
  retiredAt: ts('retired_at'),
}, (t) => [index('email_dkim_keys_scope_idx').on(t.shopId, t.domain), check('email_dkim_keys_status_chk', oneOf(t.status, ['active', 'pending', 'retired']))]);

/** Every message the server delivers itself (direct or relay): status, attempts, last error, Message-ID. `payload` is dropped once the message is final. */
export const emailOutbox = pgTable('email_outbox', {
  id: pk(),
  shopId: scopeCol(),
  messageId: text('message_id').notNull(),
  toAddress: text('to_address').notNull(),
  fromAddress: text('from_address').notNull(),
  subject: text('subject').notNull(),
  mode: text('mode').notNull(),
  status: text('status').notNull().default('queued'),
  attempts: integer('attempts').notNull().default(0),
  lastError: text('last_error'),
  lastResponse: text('last_response'),
  mxHost: text('mx_host'),
  nextAttemptAt: ts('next_attempt_at'),
  sentAt: ts('sent_at'),
  payload: jsonb('payload').$type<unknown>(),
  ...timestamps(),
}, (t) => [
  index('email_outbox_shop_idx').on(t.shopId, t.id),
  index('email_outbox_due_idx').on(t.status, t.nextAttemptAt),
  check('email_outbox_status_chk', oneOf(t.status, ['queued', 'sending', 'retry', 'sent', 'failed'])),
]);
