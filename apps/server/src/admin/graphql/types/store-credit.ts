import {
  findStoreCreditAccount, getCustomer, getStoreCreditAccount, listStoreCreditAccounts, listStoreCreditTransactions, liveBalance,
  type StoreCreditAccountRow, type StoreCreditTransactionRow,
} from '@shopme/core';
import { getOrder, getOrderDetail, schema as s } from '@shopme/core';
import { and, eq } from 'drizzle-orm';
import { builder } from '../builder';
import { requireScope, type GraphQLContext } from '../context';
import { ConnectionArgs, defineConnection, paginateArray } from './connection';
import { MoneyV2, moneyV2 } from './money';
import { Node, legacyId } from './node';
import { Customer_ } from './sales';
import { OrderTransaction } from '../modules/orders';

/**
 * Store credit types (shared because `Customer` implements `HasStoreCreditAccounts`, which has to exist before the customer module runs).
 * Roots and mutations are in modules/store-credit.ts.
 */
export const StoreCreditSystemEvent = builder.enumType('StoreCreditSystemEvent', { values: s.STORE_CREDIT_EVENTS });

export type AccountShape = StoreCreditAccountRow;
export const StoreCreditAccount = builder.objectRef<AccountShape>('StoreCreditAccount');
export const StoreCreditAccountConnection = defineConnection('StoreCreditAccount', StoreCreditAccount);

interface OwnerShape { id: number }
export const HasStoreCreditAccounts = builder.interfaceRef<OwnerShape>('HasStoreCreditAccounts').implement({
  fields: (t) => ({
    storeCreditAccounts: t.field({
      type: StoreCreditAccountConnection, args: { ...ConnectionArgs, query: t.arg.string() },
      resolve: async (o, a, ctx) => { requireScope(ctx, 'read_store_credit_accounts'); return paginateArray(a, await listStoreCreditAccounts(ctx.db, ctx.shopId, o.id)); },
    }),
  }),
  resolveType: () => 'Customer',
});

export interface TxShape extends StoreCreditTransactionRow { account: AccountShape }
/** What caused a transaction: the order transaction that paid with credit or received the refund. */
const Origin = builder.unionType('StoreCreditAccountTransactionOrigin', { types: [OrderTransaction], resolveType: () => OrderTransaction });
const kindName: Record<string, string> = {
  CREDIT: 'StoreCreditAccountCreditTransaction', DEBIT: 'StoreCreditAccountDebitTransaction', DEBIT_REVERT: 'StoreCreditAccountDebitRevertTransaction', EXPIRATION: 'StoreCreditAccountExpirationTransaction',
};
export const StoreCreditAccountTransaction = builder.interfaceRef<TxShape>('StoreCreditAccountTransaction').implement({
  fields: (t) => ({
    account: t.field({ type: StoreCreditAccount, resolve: (x) => x.account }),
    amount: t.field({ type: MoneyV2, resolve: (x) => moneyV2(x.amount, x.account.currency) }),
    balanceAfterTransaction: t.field({ type: MoneyV2, resolve: (x) => moneyV2(x.balanceAfter, x.account.currency) }),
    createdAt: t.field({ type: 'DateTime', resolve: (x) => x.createdAt }),
    event: t.field({ type: StoreCreditSystemEvent, resolve: (x) => x.event as 'ADJUSTMENT' }),
    origin: t.field({
      type: Origin, nullable: true,
      resolve: async (x, _a, ctx) => {
        if (!x.orderId) return null;
        const order = await getOrder(ctx.db, ctx.shopId, x.orderId);
        if (!order) return null;
        const tx = (await getOrderDetail(ctx.db, ctx.shopId, x.orderId)).transactions.filter((y) => y.gateway === 'store_credit' && (x.kind === 'DEBIT' ? y.kind === 'SALE' : y.kind === 'REFUND')).at(-1);
        return tx ? { ...tx, order } : null;
      },
    }),
  }),
  resolveType: (x) => kindName[x.kind] ?? 'StoreCreditAccountDebitTransaction',
});
const txId = (typeName: string) => (x: TxShape) => `gid://shopify/${typeName}/${x.id}`;

export const CreditTransaction = builder.objectRef<TxShape>('StoreCreditAccountCreditTransaction').implement({
  interfaces: [StoreCreditAccountTransaction],
  fields: (t) => ({
    id: t.id({ resolve: txId('StoreCreditAccountCreditTransaction') }),
    expiresAt: t.field({ type: 'DateTime', nullable: true, resolve: (x) => x.expiresAt }),
    remainingAmount: t.field({ type: MoneyV2, resolve: (x) => moneyV2(x.remaining ?? 0, x.account.currency) }),
  }),
});
export const DebitTransaction = builder.objectRef<TxShape>('StoreCreditAccountDebitTransaction').implement({
  interfaces: [StoreCreditAccountTransaction], fields: (t) => ({ id: t.id({ resolve: txId('StoreCreditAccountDebitTransaction') }) }),
});
const loadTx = async (ctx: GraphQLContext, id: number | null): Promise<TxShape | null> => {
  if (!id) return null;
  const [row] = await ctx.db.select().from(s.storeCreditTransactions).where(and(eq(s.storeCreditTransactions.shopId, ctx.shopId), eq(s.storeCreditTransactions.id, id))).limit(1);
  const account = row ? await getStoreCreditAccount(ctx.db, ctx.shopId, row.accountId) : null;
  return row && account ? { ...row, account } : null;
};
export const DebitRevertTransaction = builder.objectRef<TxShape>('StoreCreditAccountDebitRevertTransaction').implement({
  interfaces: [StoreCreditAccountTransaction],
  fields: (t) => ({
    id: t.id({ resolve: txId('StoreCreditAccountDebitRevertTransaction') }),
    debitTransaction: t.field({ type: DebitTransaction, resolve: async (x, _a, ctx) => (await loadTx(ctx, x.debitTransactionId))! }),
  }),
});
export const ExpirationTransaction = builder.objectRef<TxShape>('StoreCreditAccountExpirationTransaction').implement({
  interfaces: [StoreCreditAccountTransaction],
  fields: (t) => ({
    id: t.id({ resolve: txId('StoreCreditAccountExpirationTransaction') }),
    creditTransaction: t.field({ type: CreditTransaction, resolve: async (x, _a, ctx) => (await loadTx(ctx, x.creditTransactionId))! }),
  }),
});
export const StoreCreditTransactionConnection = defineConnection('StoreCreditAccountTransaction', StoreCreditAccountTransaction as never);

/** `query` of the transactions connection: `event:ORDER_PAYMENT type:credit order_id:12 created_at:>2026-01-01`. */
function filterTx(rows: TxShape[], query: string | null | undefined): TxShape[] {
  if (!query?.trim()) return rows;
  return query.trim().split(/\s+/).reduce((acc, term) => {
    const m = /^([a-z_]+):(>=|<=|>|<)?(.+)$/i.exec(term);
    if (!m) return acc;
    const [, key, op, raw] = m as unknown as [string, string, string | undefined, string];
    const v = raw.replace(/^["']|["']$/g, '');
    if (key === 'event') return acc.filter((x) => x.event.toLowerCase() === v.toLowerCase());
    if (key === 'type') return acc.filter((x) => x.kind.toLowerCase().replace('_', '') === v.toLowerCase().replace(/[_-]/g, ''));
    if (key === 'order_id') return acc.filter((x) => String(x.orderId ?? '') === v.replace(/^gid:\/\/shopify\/Order\//, ''));
    if (key === 'created_at') {
      const at = new Date(v).getTime();
      if (Number.isNaN(at)) return acc;
      return acc.filter((x) => (op === '>' ? x.createdAt.getTime() > at : op === '>=' ? x.createdAt.getTime() >= at : op === '<' ? x.createdAt.getTime() < at : op === '<=' ? x.createdAt.getTime() <= at : x.createdAt.toISOString().startsWith(v)));
    }
    return acc;
  }, rows);
}

StoreCreditAccount.implement({
  interfaces: [Node],
  fields: (t) => ({
    legacyResourceId: t.field({ type: 'UnsignedInt64', resolve: legacyId }),
    balance: t.field({ type: MoneyV2, resolve: async (a, _x, ctx) => moneyV2(await liveBalance(ctx.db, a.id), a.currency) }),
    owner: t.field({ type: HasStoreCreditAccounts, resolve: async (a, _x, ctx) => (await getCustomer(ctx.db, ctx.shopId, a.customerId))! }),
    transactions: t.field({
      type: StoreCreditTransactionConnection, args: { ...ConnectionArgs, query: t.arg.string(), sortKey: t.arg({ type: builder.enumType('StoreCreditAccountTransactionSortKeys', { values: ['CREATED_AT'] as const }), defaultValue: 'CREATED_AT' }) },
      resolve: async (a, args, ctx) => {
        requireScope(ctx, 'read_store_credit_account_transactions');
        const rows = (await listStoreCreditTransactions(ctx.db, { accountId: a.id, limit: 1000, reverse: !args.reverse })).map((x) => ({ ...x, account: a }));
        return paginateArray({ ...args, reverse: false }, filterTx(rows, args.query));
      },
    }),
  }),
});

/** The customer's account in a currency, with the live balance (used by the admin customer page). */
export const accountOf = (ctx: GraphQLContext, customerId: number, currency: string) => findStoreCreditAccount(ctx.db, ctx.shopId, customerId, currency);
