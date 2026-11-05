import {
  creditStoreCredit, debitStoreCredit, findStoreCreditAccount, getCustomer, getShop, getStoreCreditAccount, liveBalance, moneyOf, sendNotification, storeCreditSettingsOf,
  type StoreCreditAccountRow,
} from '@shopme/core';
import { parseId, parseMoney, type UserError } from '@shopme/shopify-compat';
import { builder } from '../builder';
import { requireScope, type GraphQLContext } from '../context';
import { DisplayableError } from '../types/errors';
import { MoneyInput } from '../types/money';
import { registerNode } from '../types/node';
import { shopOf } from '../types/catalog';
import {
  CreditTransaction, DebitTransaction, StoreCreditAccount, type AccountShape, type TxShape,
} from '../types/store-credit';

/** Store credit: `storeCreditAccount`, `storeCreditConfiguration`, `storeCreditAccountCredit` and `storeCreditAccountDebit`. */

registerNode('StoreCreditAccount', (ctx, id) => getStoreCreditAccount(ctx.db, ctx.shopId, id));

const CREDIT_CODES = ['ACCOUNT_NOT_FOUND', 'OWNER_NOT_FOUND', 'NEGATIVE_OR_ZERO_AMOUNT', 'MISMATCHING_CURRENCY', 'EXPIRES_AT_IN_PAST', 'CREDIT_LIMIT_EXCEEDED', 'UNSUPPORTED_CURRENCY'] as const;
const DEBIT_CODES = ['ACCOUNT_NOT_FOUND', 'NEGATIVE_OR_ZERO_AMOUNT', 'INSUFFICIENT_FUNDS', 'MISMATCHING_CURRENCY'] as const;
const CreditCode = builder.enumType('StoreCreditAccountCreditUserErrorCode', { values: CREDIT_CODES });
const DebitCode = builder.enumType('StoreCreditAccountDebitUserErrorCode', { values: DEBIT_CODES });
const codeOf = <T extends string>(allowed: readonly T[], e: UserError): T | null => (e.code && (allowed as readonly string[]).includes(e.code) ? (e.code as T) : null);
const CreditUserError = builder.objectRef<UserError>('StoreCreditAccountCreditUserError').implement({
  interfaces: [DisplayableError], fields: (t) => ({ code: t.field({ type: CreditCode, nullable: true, resolve: (e) => codeOf(CREDIT_CODES, e) }) }),
});
const DebitUserError = builder.objectRef<UserError>('StoreCreditAccountDebitUserError').implement({
  interfaces: [DisplayableError], fields: (t) => ({ code: t.field({ type: DebitCode, nullable: true, resolve: (e) => codeOf(DEBIT_CODES, e) }) }),
});

const Configuration = builder.objectRef<{ enabled: boolean }>('StoreCreditConfiguration').implement({ fields: (t) => ({ storeCreditEnabled: t.exposeBoolean('enabled') }) });

builder.queryFields((t) => ({
  storeCreditAccount: t.field({
    type: StoreCreditAccount, nullable: true, args: { id: t.arg.id({ required: true }) },
    resolve: (_r, a, ctx) => { requireScope(ctx, 'read_store_credit_accounts'); const id = parseId(String(a.id), 'StoreCreditAccount'); return id ? getStoreCreditAccount(ctx.db, ctx.shopId, id) : null; },
  }),
  storeCreditConfiguration: t.field({
    type: Configuration,
    resolve: async (_r, _a, ctx) => { requireScope(ctx, 'read_store_credit_accounts'); return { enabled: storeCreditSettingsOf(await shopOf(ctx)).enabled }; },
  }),
}));

const CreditInput = builder.inputType('StoreCreditAccountCreditInput', {
  fields: (t) => ({ creditAmount: t.field({ type: MoneyInput, required: true }), expiresAt: t.field({ type: 'DateTime' }), notify: t.boolean({ defaultValue: false }) }),
});
const DebitInput = builder.inputType('StoreCreditAccountDebitInput', { fields: (t) => ({ debitAmount: t.field({ type: MoneyInput, required: true }) }) });

const CreditPayload = builder.objectRef<{ tx: TxShape | null; userErrors: UserError[] }>('StoreCreditAccountCreditPayload').implement({
  fields: (t) => ({
    storeCreditAccountTransaction: t.field({ type: CreditTransaction, nullable: true, resolve: (p) => p.tx }),
    userErrors: t.field({ type: [CreditUserError], resolve: (p) => p.userErrors }),
  }),
});
const DebitPayload = builder.objectRef<{ tx: TxShape | null; userErrors: UserError[] }>('StoreCreditAccountDebitPayload').implement({
  fields: (t) => ({
    storeCreditAccountTransaction: t.field({ type: DebitTransaction, nullable: true, resolve: (p) => p.tx }),
    userErrors: t.field({ type: [DebitUserError], resolve: (p) => p.userErrors }),
  }),
});

const staffOf = (ctx: GraphQLContext) => (ctx.auth.kind === 'session' ? ctx.auth.user.id : null);
const bad = (code: string, message: string, field: string[]): UserError[] => [{ field, message, code }];

/** `id` is a store credit account id, or a customer id (a credit then goes to the account in the amount's currency, created on first use). */
function target(rawId: string): { accountId?: number; customerId?: number } | null {
  const acc = parseId(String(rawId), 'StoreCreditAccount');
  if (acc) return { accountId: acc };
  const cust = parseId(String(rawId), 'Customer');
  return cust ? { customerId: cust } : null;
}

async function amountOf(ctx: GraphQLContext, a: { amount: string; currencyCode: string }, field: string[]): Promise<{ value: number } | { errors: UserError[] }> {
  try { return { value: parseMoney(a.amount, a.currencyCode) }; } catch { return { errors: bad('NEGATIVE_OR_ZERO_AMOUNT', 'Amount is invalid', field) }; }
}

/** Email the customer about new credit (the `store_credit_account_credit` notification). */
async function notifyCredit(ctx: GraphQLContext, account: StoreCreditAccountRow, amount: number, expiresAt: Date | null): Promise<void> {
  const [shop, customer] = await Promise.all([getShop(ctx.db, ctx.shopId), getCustomer(ctx.db, ctx.shopId, account.customerId)]);
  if (!shop || !customer?.email) return;
  const balance = await liveBalance(ctx.db, account.id);
  await sendNotification(ctx.db, ctx.app.mailer, shop, ctx.app.config.appUrl, 'store_credit_account_credit', customer.email, {
    customer: { first_name: customer.firstName ?? '', last_name: customer.lastName ?? '', email: customer.email },
    store_credit: { amount: moneyOf(shop, amount, account.currency), balance: moneyOf(shop, balance, account.currency), expires_on: expiresAt ? expiresAt.toISOString().slice(0, 10) : null },
    account_url: `${ctx.app.config.appUrl}/account`,
  });
}

builder.mutationFields((t) => ({
  storeCreditAccountCredit: t.field({
    type: CreditPayload, args: { id: t.arg.id({ required: true }), creditInput: t.arg({ type: CreditInput, required: true }) },
    resolve: async (_r, a, ctx) => {
      requireScope(ctx, 'write_store_credit_account_transactions');
      const who = target(String(a.id));
      if (!who) return { tx: null, userErrors: bad('ACCOUNT_NOT_FOUND', 'Store credit account does not exist', ['id']) };
      const amount = await amountOf(ctx, a.creditInput.creditAmount, ['creditInput', 'creditAmount']);
      if ('errors' in amount) return { tx: null, userErrors: amount.errors };
      const r = await creditStoreCredit(ctx.db, ctx.shopId, {
        ...who, amount: amount.value, currency: a.creditInput.creditAmount.currencyCode, expiresAt: a.creditInput.expiresAt ?? null, notify: !!a.creditInput.notify, staffUserId: staffOf(ctx),
      });
      if (!r.ok) return { tx: null, userErrors: r.errors };
      if (r.value.notify) await notifyCredit(ctx, r.value.account, amount.value, a.creditInput.expiresAt ?? null);
      return { tx: { ...r.value.transaction, account: r.value.account as AccountShape }, userErrors: [] };
    },
  }),
  storeCreditAccountDebit: t.field({
    type: DebitPayload, args: { id: t.arg.id({ required: true }), debitInput: t.arg({ type: DebitInput, required: true }) },
    resolve: async (_r, a, ctx) => {
      requireScope(ctx, 'write_store_credit_account_transactions');
      const who = target(String(a.id));
      // A debit needs an existing account: a customer id resolves to their account in the amount's currency.
      const account = who?.accountId ? await getStoreCreditAccount(ctx.db, ctx.shopId, who.accountId)
        : who?.customerId ? await findStoreCreditAccount(ctx.db, ctx.shopId, who.customerId, a.debitInput.debitAmount.currencyCode) : null;
      if (!account) return { tx: null, userErrors: bad('ACCOUNT_NOT_FOUND', 'Store credit account does not exist', ['id']) };
      const amount = await amountOf(ctx, a.debitInput.debitAmount, ['debitInput', 'debitAmount']);
      if ('errors' in amount) return { tx: null, userErrors: amount.errors };
      const r = await debitStoreCredit(ctx.db, ctx.shopId, { accountId: account.id, amount: amount.value, currency: a.debitInput.debitAmount.currencyCode, staffUserId: staffOf(ctx) });
      return r.ok ? { tx: { ...r.value.transaction, account: r.value.account }, userErrors: [] } : { tx: null, userErrors: r.errors };
    },
  }),
}));

