import { sql } from 'drizzle-orm';
import { boolean, check, index, pgTable, primaryKey, text, uniqueIndex } from 'drizzle-orm/pg-core';
import { createdAt, money, oneOf, pk, ref, shopIdCol, timestamps, ts } from './_helpers';
import { shops } from './shop';
import { customers } from './sales';

const shopFk = () => shopIdCol().references(() => shops.id, { onDelete: 'cascade' });

export const STORE_CREDIT_KINDS = ['CREDIT', 'DEBIT', 'DEBIT_REVERT', 'EXPIRATION'] as const;
export const STORE_CREDIT_EVENTS = ['ADJUSTMENT', 'ORDER_PAYMENT', 'ORDER_REFUND', 'PAYMENT_FAILURE', 'PAYMENT_RETURNED', 'ORDER_CANCELLATION', 'TAX_FINALIZATION', 'RECURRING_PAYMENT'] as const;

/** One account per customer and currency. `balance` caches the unspent, unexpired credit and is rewritten with every transaction. */
export const storeCreditAccounts = pgTable('store_credit_accounts', {
  id: pk(), shopId: shopFk(),
  customerId: ref('customer_id').notNull().references(() => customers.id, { onDelete: 'cascade' }),
  currency: text('currency').notNull(),
  balance: money('balance').notNull().default(0),
  ...timestamps(),
}, (t) => [uniqueIndex('store_credit_accounts_uq').on(t.shopId, t.customerId, t.currency), check('sc_balance_chk', sql`${t.balance} >= 0`)]);

export const storeCreditTransactions = pgTable('store_credit_transactions', {
  id: pk(), shopId: shopFk(),
  accountId: ref('account_id').notNull().references(() => storeCreditAccounts.id, { onDelete: 'cascade' }),
  kind: text('kind').notNull(),
  event: text('event').notNull().default('ADJUSTMENT'),
  /** Positive magnitude in minor units. */
  amount: money('amount').notNull(),
  balanceAfter: money('balance_after').notNull(),
  /** CREDIT only. */
  expiresAt: ts('expires_at'),
  remaining: money('remaining'),
  creditTransactionId: ref('credit_transaction_id'),
  debitTransactionId: ref('debit_transaction_id'),
  orderId: ref('order_id'),
  staffUserId: ref('staff_user_id'),
  note: text('note'),
  notified: boolean('notified').notNull().default(false),
  createdAt: createdAt(),
}, (t) => [
  index('sc_tx_account_idx').on(t.accountId, t.createdAt), index('sc_tx_expiry_idx').on(t.expiresAt),
  check('sc_tx_kind_chk', oneOf(t.kind, STORE_CREDIT_KINDS)), check('sc_tx_event_chk', oneOf(t.event, STORE_CREDIT_EVENTS)),
]);

/** Which credits a debit consumed (drives reverts and the soonest-expiry-first rule). */
export const storeCreditAllocations = pgTable('store_credit_allocations', {
  shopId: shopFk(),
  debitTransactionId: ref('debit_transaction_id').notNull().references(() => storeCreditTransactions.id, { onDelete: 'cascade' }),
  creditTransactionId: ref('credit_transaction_id').notNull().references(() => storeCreditTransactions.id, { onDelete: 'cascade' }),
  amount: money('amount').notNull(),
}, (t) => [primaryKey({ columns: [t.debitTransactionId, t.creditTransactionId] })]);
