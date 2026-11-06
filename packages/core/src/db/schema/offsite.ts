import { bigint, boolean, check, index, integer, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core';
import { createdAt, oneOf, pk, timestamps, ts } from './_helpers';
import { shops } from './shop';

/** `shop_id` is null for the installation's own row (the platform destination that backs up every store). */
const scopeCol = () => bigint('shop_id', { mode: 'number' }).references(() => shops.id, { onDelete: 'cascade' });

/**
 * Where a store (or the installation, `shop_id` null) sends its off-site backups: an S3-compatible bucket.
 * The access secret and the optional client-side passphrase are write-only: AES-GCM encrypted, never returned by the API, never exported.
 */
export const backupDestinations = pgTable('backup_destinations', {
  id: pk(),
  shopId: scopeCol(),
  enabled: boolean('enabled').notNull().default(true),
  provider: text('provider').notNull().default('s3'),
  preset: text('preset'),
  endpoint: text('endpoint').notNull().default(''),
  region: text('region').notNull().default(''),
  forcePathStyle: boolean('force_path_style').notNull().default(false),
  bucket: text('bucket').notNull().default(''),
  prefix: text('prefix').notNull().default(''),
  accessKeyId: text('access_key_id').notNull().default(''),
  secretKeyEnc: text('secret_key_enc'),
  passphraseEnc: text('passphrase_enc'),
  keepDaily: integer('keep_daily').notNull().default(7),
  keepWeekly: integer('keep_weekly').notNull().default(4),
  keepMonthly: integer('keep_monthly').notNull().default(6),
  ...timestamps(),
}, (t) => [uniqueIndex('backup_destinations_shop_uq').on(t.shopId)]);

/** One upload and its retries: what was sent, how big, whether it worked, and when the next retry is due. */
export const backupRuns = pgTable('backup_runs', {
  id: pk(),
  /** The destination's scope: a store, or null for the platform destination. */
  shopId: scopeCol(),
  /** The store the archive belongs to (null for a database dump). */
  subjectShopId: bigint('subject_shop_id', { mode: 'number' }),
  kind: text('kind').notNull().default('store'),
  trigger: text('trigger').notNull().default('scheduled'),
  status: text('status').notNull().default('running'),
  attempts: integer('attempts').notNull().default(0),
  nextAttemptAt: ts('next_attempt_at'),
  /** Local archive the upload reads from, when one was kept. */
  sourceName: text('source_name'),
  objectKey: text('object_key'),
  bytes: bigint('bytes', { mode: 'number' }),
  encrypted: boolean('encrypted').notNull().default(false),
  error: text('error'),
  startedAt: createdAt('started_at'),
  finishedAt: ts('finished_at'),
}, (t) => [
  index('backup_runs_scope_idx').on(t.shopId, t.startedAt),
  index('backup_runs_due_idx').on(t.status, t.nextAttemptAt),
  check('backup_runs_kind_chk', oneOf(t.kind, ['store', 'database'])),
  check('backup_runs_status_chk', oneOf(t.status, ['running', 'ok', 'retry', 'failed'])),
]);
