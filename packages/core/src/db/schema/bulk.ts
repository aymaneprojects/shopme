import { bigint, boolean, check, index, integer, jsonb, pgTable, text } from 'drizzle-orm/pg-core';
import { createdAt, oneOf, pk, ref, shopIdCol, ts } from './_helpers';
import { shops } from './shop';
import { discounts } from './sales';

const shopFk = () => shopIdCol().references(() => shops.id, { onDelete: 'cascade' });

/** Asynchronous bulk query/mutation runs (`bulkOperationRunQuery`, `bulkOperationRunMutation`). Result files live in object storage. */
export const bulkOperations = pgTable('bulk_operations', {
  id: pk(), shopId: shopFk(),
  type: text('type').notNull(), // QUERY | MUTATION
  status: text('status').notNull().default('CREATED'), // CREATED | RUNNING | COMPLETED | FAILED | CANCELING | CANCELED | EXPIRED
  query: text('query').notNull(),
  errorCode: text('error_code'), // ACCESS_DENIED | INTERNAL_SERVER_ERROR | TIMEOUT
  objectCount: bigint('object_count', { mode: 'number' }).notNull().default(0),
  rootObjectCount: bigint('root_object_count', { mode: 'number' }).notNull().default(0),
  /** Storage key of the JSONL result and its size in bytes. */
  resultKey: text('result_key'), resultSize: bigint('result_size', { mode: 'number' }),
  /** Storage key of the partial result kept when a run fails or is canceled. */
  partialKey: text('partial_key'),
  /** Mutation runs: storage key of the uploaded variables file. */
  inputKey: text('input_key'),
  groupObjects: boolean('group_objects').notNull().default(false),
  clientIdentifier: text('client_identifier'),
  createdAt: createdAt(), completedAt: ts('completed_at'),
}, (t) => [
  index('bulk_operations_shop_idx').on(t.shopId, t.type, t.createdAt),
  check('bulk_operations_type_chk', oneOf(t.type, ['QUERY', 'MUTATION'])),
]);

/** One `discountRedeemCodeBulkAdd` call: per-code outcome kept for `discountRedeemCodeBulkCreation`. */
export const discountCodeBulkCreations = pgTable('discount_code_bulk_creations', {
  id: pk(), shopId: shopFk(),
  discountId: ref('discount_id').notNull().references(() => discounts.id, { onDelete: 'cascade' }),
  codesCount: integer('codes_count').notNull().default(0),
  importedCount: integer('imported_count').notNull().default(0),
  failedCount: integer('failed_count').notNull().default(0),
  done: boolean('done').notNull().default(false),
  /** `[{ code, codeId, errors: [{ field, message, code }] }]` in input order. */
  results: jsonb('results').$type<{ code: string; codeId: number | null; errors: { field: string[]; message: string; code: string }[] }[]>().notNull().default([]),
  createdAt: createdAt(), completedAt: ts('completed_at'),
}, (t) => [index('discount_code_bulk_creations_idx').on(t.shopId, t.discountId)]);
