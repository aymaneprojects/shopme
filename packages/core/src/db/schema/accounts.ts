import { check, index, pgTable, text } from 'drizzle-orm/pg-core';
import { createdAt, oneOf, pk, ref, shopIdCol, ts } from './_helpers';
import { shops } from './shop';
import { customers } from './sales';

/** One-time tokens for storefront accounts (password reset, account activation). Only the SHA-256 of the token is stored. */
export const customerTokens = pgTable('customer_tokens', {
  id: pk(),
  shopId: shopIdCol().references(() => shops.id, { onDelete: 'cascade' }),
  customerId: ref('customer_id').notNull().references(() => customers.id, { onDelete: 'cascade' }),
  kind: text('kind').notNull(), // reset | activate
  tokenHash: text('token_hash').notNull().unique(),
  expiresAt: ts('expires_at').notNull(),
  usedAt: ts('used_at'),
  createdAt: createdAt(),
}, (t) => [index('customer_tokens_customer_idx').on(t.customerId, t.kind), check('customer_tokens_kind_chk', oneOf(t.kind, ['reset', 'activate']))]);
