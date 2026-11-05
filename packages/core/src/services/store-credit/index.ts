import { and, asc, desc, eq, gt, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import { customers, shops, storeCreditAccounts, storeCreditAllocations, storeCreditTransactions, transactions } from '../../db/schema';
import type { Db, Executor } from '../../db/client';
import { errR, okR, type Result } from '../catalog/common';
import { addEvent } from '../events';
import type { Shop } from '../shops';

export * from './tender';

/**
 * Store credit: a spendable balance per customer and currency. Credits carry their own optional expiry; debits consume the credits that
 * expire soonest first (credits without expiry last, oldest first on ties) and remember what they took so a revert restores the right ones.
 * Every write runs in a transaction that locks the account row, and rewrites the cached `balance` from the credits that are still valid.
 */
export type StoreCreditAccountRow = typeof storeCreditAccounts.$inferSelect;
export type StoreCreditTransactionRow = typeof storeCreditTransactions.$inferSelect;
export type StoreCreditEvent = StoreCreditTransactionRow['event'];

export interface StoreCreditSettings { enabled: boolean; creditLimit: number | null }

export function storeCreditSettingsOf(shop: Pick<Shop, 'settings'>): StoreCreditSettings {
  const s = ((shop.settings as Record<string, any>).storeCredit ?? {}) as Record<string, any>;
  return { enabled: s.enabled === true, creditLimit: Number.isInteger(s.creditLimit) && s.creditLimit > 0 ? s.creditLimit : null };
}
export const storeCreditEnabled = (shop: Pick<Shop, 'settings'>) => storeCreditSettingsOf(shop).enabled;

const stillValid = (now: Date) => or(isNull(storeCreditTransactions.expiresAt), gt(storeCreditTransactions.expiresAt, now));

/** Spendable balance: what remains of the credits that have not expired (an expired credit stops counting before the job writes its expiration). */
export async function liveBalance(db: Executor, accountId: number, now = new Date()): Promise<number> {
  const [r] = await db.select({ n: sql<number>`coalesce(sum(${storeCreditTransactions.remaining}), 0)::bigint` }).from(storeCreditTransactions)
    .where(and(eq(storeCreditTransactions.accountId, accountId), eq(storeCreditTransactions.kind, 'CREDIT'), stillValid(now)));
  return Number(r?.n ?? 0);
}

export async function getStoreCreditAccount(db: Executor, shopId: number, id: number): Promise<StoreCreditAccountRow | null> {
  const [a] = await db.select().from(storeCreditAccounts).where(and(eq(storeCreditAccounts.shopId, shopId), eq(storeCreditAccounts.id, id))).limit(1);
  return a ?? null;
}
export async function findStoreCreditAccount(db: Executor, shopId: number, customerId: number, currency: string): Promise<StoreCreditAccountRow | null> {
  const [a] = await db.select().from(storeCreditAccounts).where(and(eq(storeCreditAccounts.shopId, shopId), eq(storeCreditAccounts.customerId, customerId), eq(storeCreditAccounts.currency, currency))).limit(1);
  return a ?? null;
}
export const listStoreCreditAccounts = (db: Executor, shopId: number, customerId: number): Promise<StoreCreditAccountRow[]> =>
  db.select().from(storeCreditAccounts).where(and(eq(storeCreditAccounts.shopId, shopId), eq(storeCreditAccounts.customerId, customerId))).orderBy(asc(storeCreditAccounts.id));

export interface StoreCreditTransactionQuery { accountId: number; reverse?: boolean; offset?: number; limit?: number }
export const listStoreCreditTransactions = (db: Executor, q: StoreCreditTransactionQuery): Promise<StoreCreditTransactionRow[]> =>
  db.select().from(storeCreditTransactions).where(eq(storeCreditTransactions.accountId, q.accountId))
    .orderBy(q.reverse ? asc(storeCreditTransactions.id) : desc(storeCreditTransactions.id)).limit(q.limit ?? 50).offset(q.offset ?? 0);
export async function getStoreCreditTransaction(db: Executor, shopId: number, id: number): Promise<StoreCreditTransactionRow | null> {
  const [t] = await db.select().from(storeCreditTransactions).where(and(eq(storeCreditTransactions.shopId, shopId), eq(storeCreditTransactions.id, id))).limit(1);
  return t ?? null;
}

async function lock(tx: Executor, accountId: number): Promise<StoreCreditAccountRow> {
  const [a] = await tx.select().from(storeCreditAccounts).where(eq(storeCreditAccounts.id, accountId)).for('update');
  return a!;
}
async function setBalance(tx: Executor, accountId: number, now: Date): Promise<number> {
  const balance = await liveBalance(tx, accountId, now);
  await tx.update(storeCreditAccounts).set({ balance, updatedAt: now }).where(eq(storeCreditAccounts.id, accountId));
  return balance;
}

export interface CreditInput {
  /** Account to credit, or the customer whose account (in `currency`) is created on first credit. */
  accountId?: number | null; customerId?: number | null;
  amount: number; currency: string;
  expiresAt?: Date | null; notify?: boolean;
  event?: StoreCreditEvent; orderId?: number | null; staffUserId?: number | null; note?: string | null;
  /** Refunds are always credited, whatever the balance limit says. */
  skipLimit?: boolean; now?: Date;
}
export interface CreditOutcome { transaction: StoreCreditTransactionRow; account: StoreCreditAccountRow; notify: boolean }

const failure = (code: string, message: string, field: string[] = ['id']) => errR(field, message, code);

/** Issue credit. User-facing problems come back as `errors` with the Admin API codes (ACCOUNT_NOT_FOUND, NEGATIVE_OR_ZERO_AMOUNT, ...). */
export async function creditStoreCredit(db: Db, shopId: number, input: CreditInput): Promise<Result<CreditOutcome>> {
  const now = input.now ?? new Date();
  if (!Number.isInteger(input.amount) || input.amount <= 0) return failure('NEGATIVE_OR_ZERO_AMOUNT', 'A positive amount is required', ['creditInput', 'creditAmount', 'amount']);
  const [shop] = await db.select().from(shops).where(eq(shops.id, shopId)).limit(1);
  if (!shop) return failure('ACCOUNT_NOT_FOUND', 'Store credit account does not exist');
  if (input.currency !== shop.currency) return failure('UNSUPPORTED_CURRENCY', 'The currency is not enabled for this store', ['creditInput', 'creditAmount', 'currencyCode']);
  if (input.expiresAt && input.expiresAt.getTime() <= now.getTime()) return failure('EXPIRES_AT_IN_PAST', 'The expiration date must be in the future', ['creditInput', 'expiresAt']);
  const limit = storeCreditSettingsOf(shop).creditLimit;
  return db.transaction(async (tx) => {
    let account: StoreCreditAccountRow | null = null;
    if (input.accountId) {
      account = await getStoreCreditAccount(tx, shopId, input.accountId);
      if (!account) return failure('ACCOUNT_NOT_FOUND', 'Store credit account does not exist');
      if (account.currency !== input.currency) return failure('MISMATCHING_CURRENCY', 'The currency does not match the store credit account', ['creditInput', 'creditAmount', 'currencyCode']);
    } else {
      const [c] = input.customerId ? await tx.select({ id: customers.id }).from(customers).where(and(eq(customers.shopId, shopId), eq(customers.id, input.customerId))).limit(1) : [];
      if (!c) return failure('OWNER_NOT_FOUND', 'The store credit account owner does not exist');
      account = await findStoreCreditAccount(tx, shopId, c.id, input.currency);
      if (!account) {
        await tx.insert(storeCreditAccounts).values({ shopId, customerId: c.id, currency: input.currency }).onConflictDoNothing();
        account = (await findStoreCreditAccount(tx, shopId, c.id, input.currency))!;
      }
    }
    await lock(tx, account.id);
    if (limit && !input.skipLimit && (await liveBalance(tx, account.id, now)) + input.amount > limit) return failure('CREDIT_LIMIT_EXCEEDED', 'The credit would take the balance over the store limit', ['creditInput', 'creditAmount', 'amount']);
    const [row] = await tx.insert(storeCreditTransactions).values({
      shopId, accountId: account.id, kind: 'CREDIT', event: input.event ?? 'ADJUSTMENT', amount: input.amount, balanceAfter: 0, expiresAt: input.expiresAt ?? null, remaining: input.amount,
      orderId: input.orderId ?? null, staffUserId: input.staffUserId ?? null, note: input.note ?? null, notified: !!input.notify, createdAt: now,
    }).returning();
    const balance = await setBalance(tx, account.id, now);
    const [tr] = await tx.update(storeCreditTransactions).set({ balanceAfter: balance }).where(eq(storeCreditTransactions.id, row!.id)).returning();
    await addEvent(tx, shopId, {
      subjectType: 'customer', subjectId: account.customerId, verb: 'customers/store_credit_issued', authorStaffUserId: input.staffUserId ?? null,
      message: `Store credit of ${(input.amount / 100).toFixed(2)} ${input.currency} issued${input.expiresAt ? ` (expires ${input.expiresAt.toISOString().slice(0, 10)})` : ''}`,
      data: { accountId: account.id, amount: input.amount, currency: input.currency, expiresAt: input.expiresAt?.toISOString() ?? null, event: input.event ?? 'ADJUSTMENT', orderId: input.orderId ?? null },
    });
    return okR({ transaction: tr!, account: (await getStoreCreditAccount(tx, shopId, account.id))!, notify: !!input.notify });
  });
}

export interface DebitInput { accountId: number; amount: number; currency?: string | null; event?: StoreCreditEvent; orderId?: number | null; staffUserId?: number | null; note?: string | null; now?: Date }
export interface DebitOutcome { transaction: StoreCreditTransactionRow; account: StoreCreditAccountRow }

/** Spend or remove credit. Credits expiring soonest are used first. */
export async function debitStoreCredit(db: Db, shopId: number, input: DebitInput): Promise<Result<DebitOutcome>> {
  const now = input.now ?? new Date();
  if (!Number.isInteger(input.amount) || input.amount <= 0) return failure('NEGATIVE_OR_ZERO_AMOUNT', 'A positive amount is required', ['debitInput', 'debitAmount', 'amount']);
  return db.transaction(async (tx) => {
    const found = await getStoreCreditAccount(tx, shopId, input.accountId);
    if (!found) return failure('ACCOUNT_NOT_FOUND', 'Store credit account does not exist');
    if (input.currency && input.currency !== found.currency) return failure('MISMATCHING_CURRENCY', 'The currency does not match the store credit account', ['debitInput', 'debitAmount', 'currencyCode']);
    await lock(tx, found.id);
    const credits = await tx.select().from(storeCreditTransactions)
      .where(and(eq(storeCreditTransactions.accountId, found.id), eq(storeCreditTransactions.kind, 'CREDIT'), gt(storeCreditTransactions.remaining, 0), stillValid(now)))
      .orderBy(sql`${storeCreditTransactions.expiresAt} asc nulls last`, asc(storeCreditTransactions.createdAt), asc(storeCreditTransactions.id));
    if (credits.reduce((n, c) => n + (c.remaining ?? 0), 0) < input.amount) return failure('INSUFFICIENT_FUNDS', 'The account does not have enough funds', ['debitInput', 'debitAmount', 'amount']);
    const [debit] = await tx.insert(storeCreditTransactions).values({
      shopId, accountId: found.id, kind: 'DEBIT', event: input.event ?? 'ADJUSTMENT', amount: input.amount, balanceAfter: 0, orderId: input.orderId ?? null,
      staffUserId: input.staffUserId ?? null, note: input.note ?? null, createdAt: now,
    }).returning();
    let left = input.amount;
    for (const c of credits) {
      if (left <= 0) break;
      const take = Math.min(left, c.remaining ?? 0);
      await tx.update(storeCreditTransactions).set({ remaining: (c.remaining ?? 0) - take }).where(eq(storeCreditTransactions.id, c.id));
      await tx.insert(storeCreditAllocations).values({ shopId, debitTransactionId: debit!.id, creditTransactionId: c.id, amount: take });
      left -= take;
    }
    const balance = await setBalance(tx, found.id, now);
    const [tr] = await tx.update(storeCreditTransactions).set({ balanceAfter: balance }).where(eq(storeCreditTransactions.id, debit!.id)).returning();
    if (!input.orderId) {
      await addEvent(tx, shopId, {
        subjectType: 'customer', subjectId: found.customerId, verb: 'customers/store_credit_debited', authorStaffUserId: input.staffUserId ?? null,
        message: `Store credit of ${(input.amount / 100).toFixed(2)} ${found.currency} removed`, data: { accountId: found.id, amount: input.amount, currency: found.currency },
      });
    }
    return okR({ transaction: tr!, account: (await getStoreCreditAccount(tx, shopId, found.id))! });
  });
}

/**
 * Cancel a debit (a failed payment): what it took goes back to the credits it came from, except credits that have expired meanwhile.
 * Idempotent: a debit is reverted once. Returns null when there is nothing to restore.
 */
export async function revertStoreCreditDebit(db: Db, shopId: number, debitTransactionId: number, event: StoreCreditEvent = 'PAYMENT_FAILURE', now = new Date()): Promise<StoreCreditTransactionRow | null> {
  return db.transaction(async (tx) => {
    const debit = await getStoreCreditTransaction(tx, shopId, debitTransactionId);
    if (!debit || debit.kind !== 'DEBIT') return null;
    await lock(tx, debit.accountId);
    const [already] = await tx.select({ id: storeCreditTransactions.id }).from(storeCreditTransactions)
      .where(and(eq(storeCreditTransactions.debitTransactionId, debit.id), eq(storeCreditTransactions.kind, 'DEBIT_REVERT'))).limit(1);
    if (already) return null;
    const allocations = await tx.select().from(storeCreditAllocations).where(eq(storeCreditAllocations.debitTransactionId, debit.id));
    const credits = allocations.length ? await tx.select().from(storeCreditTransactions).where(inArray(storeCreditTransactions.id, allocations.map((a) => a.creditTransactionId))) : [];
    let restored = 0;
    for (const a of allocations) {
      const c = credits.find((x) => x.id === a.creditTransactionId);
      if (!c || (c.expiresAt && c.expiresAt <= now)) continue;
      await tx.update(storeCreditTransactions).set({ remaining: (c.remaining ?? 0) + a.amount }).where(eq(storeCreditTransactions.id, c.id));
      restored += a.amount;
    }
    if (restored === 0) return null;
    const [row] = await tx.insert(storeCreditTransactions).values({
      shopId, accountId: debit.accountId, kind: 'DEBIT_REVERT', event, amount: restored, balanceAfter: 0, debitTransactionId: debit.id, orderId: debit.orderId, createdAt: now,
    }).returning();
    const balance = await setBalance(tx, debit.accountId, now);
    const [tr] = await tx.update(storeCreditTransactions).set({ balanceAfter: balance }).where(eq(storeCreditTransactions.id, row!.id)).returning();
    return tr!;
  });
}

/** A payment failed after the order was created: give back what the order spent (and mark its store credit payment as failed). */
export async function revertOrderStoreCredit(db: Db, shopId: number, orderId: number, now = new Date()): Promise<number> {
  const debits = await db.select().from(storeCreditTransactions).where(and(eq(storeCreditTransactions.shopId, shopId), eq(storeCreditTransactions.orderId, orderId), eq(storeCreditTransactions.kind, 'DEBIT'), eq(storeCreditTransactions.event, 'ORDER_PAYMENT')));
  let n = 0;
  for (const d of debits) n += (await revertStoreCreditDebit(db, shopId, d.id, 'PAYMENT_FAILURE', now))?.amount ?? 0;
  if (n > 0) await db.update(transactions).set({ status: 'FAILURE' }).where(and(eq(transactions.shopId, shopId), eq(transactions.orderId, orderId), eq(transactions.gateway, 'store_credit'), eq(transactions.kind, 'SALE')));
  return n;
}

/** Job: write an EXPIRATION for every credit whose date has passed and that still holds value. Safe to run any number of times. */
export async function expireStoreCredits(db: Db, now = new Date()): Promise<number> {
  const due = await db.select().from(storeCreditTransactions)
    .where(and(eq(storeCreditTransactions.kind, 'CREDIT'), lte(storeCreditTransactions.expiresAt, now), gt(storeCreditTransactions.remaining, 0)));
  let count = 0;
  for (const credit of due) {
    await db.transaction(async (tx) => {
      await lock(tx, credit.accountId);
      const [fresh] = await tx.select().from(storeCreditTransactions).where(eq(storeCreditTransactions.id, credit.id)).limit(1);
      if (!fresh || !fresh.remaining || fresh.remaining <= 0) return;
      const [row] = await tx.insert(storeCreditTransactions).values({
        shopId: fresh.shopId, accountId: fresh.accountId, kind: 'EXPIRATION', event: 'ADJUSTMENT', amount: fresh.remaining, balanceAfter: 0, creditTransactionId: fresh.id, createdAt: now,
      }).returning();
      await tx.update(storeCreditTransactions).set({ remaining: 0 }).where(eq(storeCreditTransactions.id, fresh.id));
      const balance = await setBalance(tx, fresh.accountId, now);
      await tx.update(storeCreditTransactions).set({ balanceAfter: balance }).where(eq(storeCreditTransactions.id, row!.id));
      count += 1;
    });
  }
  return count;
}

/** Total of the unexpired credit a customer holds in a currency (0 without an account). */
export async function customerStoreCreditBalance(db: Executor, shopId: number, customerId: number, currency: string, now = new Date()): Promise<number> {
  const a = await findStoreCreditAccount(db, shopId, customerId, currency);
  return a ? liveBalance(db, a.id, now) : 0;
}
