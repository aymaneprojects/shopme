import {
  adjustGiftCard, countGiftCards, createGiftCard, deactivateGiftCard, getCustomer, getGiftCard, getOrder, getShop, giftCardAddressees, giftCardMailVars, isRedeemable, listGiftCardTransactions,
  listGiftCards, listGiftCardsForOrder, markGiftCardNotified, maskedGiftCardCode, lastCharacters, sendNotification, updateGiftCard, GIFT_CARD_LIMIT,
  type GiftCard as GiftCardRow, type GiftCardTransaction as TxRow,
} from '@shopme/core';
import { parseId, parseMoney, toGid, type UserError } from '@shopme/shopify-compat';
import { builder } from '../builder';
import { requireScope, type GraphQLContext } from '../context';
import { ConnectionArgs, defineConnection, paginate, paginateArray } from '../types/connection';
import { DisplayableError } from '../types/errors';
import { Count, MoneyInput, MoneyV2, moneyV2 } from '../types/money';
import { Node, legacyId, registerNode } from '../types/node';
import { shopOf } from '../types/catalog';
import { Customer_, Order_ } from '../types/sales';

/** Gift cards: `giftCards`, `giftCard`, create / update / deactivate, credit / debit, and the notification re-sends. */

const SortKeys = builder.enumType('GiftCardSortKeys', { values: ['AMOUNT_SPENT', 'BALANCE', 'CODE', 'CREATED_AT', 'CUSTOMER_NAME', 'DISABLED_AT', 'EXPIRES_ON', 'ID', 'INITIAL_VALUE', 'UPDATED_AT'] as const });
const Strategy = builder.enumType('GiftCardCrossCurrencyRedemptionStrategy', { values: ['MARKET_FX', 'NONE'] as const });
const ERROR_CODES = ['TOO_BIG', 'TOO_LONG', 'TOO_SHORT', 'TAKEN', 'INVALID', 'INTERNAL_ERROR', 'MISSING_ARGUMENT', 'GREATER_THAN', 'GIFT_CARD_LIMIT_EXCEEDED', 'CUSTOMER_NOT_FOUND', 'RECIPIENT_NOT_FOUND'] as const;
const TX_ERROR_CODES = ['GIFT_CARD_NOT_FOUND', 'INACTIVE_GIFT_CARD', 'INSUFFICIENT_FUNDS', 'INVALID', 'MISSING_ARGUMENT', 'NEGATIVE_OR_ZERO_AMOUNT', 'GREATER_THAN', 'TOO_BIG', 'MISMATCHING_CURRENCY', 'INTERNAL_ERROR'] as const;
const ErrorCode = builder.enumType('GiftCardErrorCode', { values: ERROR_CODES });
const TxErrorCode = builder.enumType('GiftCardTransactionUserErrorCode', { values: TX_ERROR_CODES });
const codeOf = <T extends string>(allowed: readonly T[], e: UserError): T | null => (e.code && (allowed as readonly string[]).includes(e.code) ? (e.code as T) : null);
const GiftCardUserError = builder.objectRef<UserError>('GiftCardUserError').implement({
  interfaces: [DisplayableError],
  fields: (t) => ({ code: t.field({ type: ErrorCode, nullable: true, resolve: (e) => codeOf(ERROR_CODES, e) }) }),
});
const GiftCardTransactionUserError = builder.objectRef<UserError>('GiftCardTransactionUserError').implement({
  interfaces: [DisplayableError],
  fields: (t) => ({ code: t.field({ type: TxErrorCode, nullable: true, resolve: (e) => codeOf(TX_ERROR_CODES, e) }) }),
});

/* ------------------------------ output types ------------------------------ */

interface Shape extends GiftCardRow { _shopCurrency: string }
const staffOf = (ctx: GraphQLContext) => (ctx.auth.kind === 'session' ? ctx.auth.user.id : null);

const GiftCardRecipient = builder.objectRef<Shape>('GiftCardRecipient').implement({
  fields: (t) => ({
    message: t.string({ nullable: true, resolve: (c) => c.message }),
    preferredName: t.string({ nullable: true, resolve: (c) => c.recipientName }),
    sendNotificationAt: t.field({ type: 'DateTime', nullable: true, resolve: (c) => c.sendNotificationAt }),
    recipient: t.field({ type: Customer_, resolve: async (c, _a, ctx) => (await getCustomer(ctx.db, ctx.shopId, c.recipientCustomerId!))! }),
  }),
});

interface TxShape extends TxRow { card: Shape; kind: 'CREDIT' | 'DEBIT' }
const CreditTransaction = builder.objectRef<TxShape>('GiftCardCreditTransaction');
const DebitTransaction = builder.objectRef<TxShape>('GiftCardDebitTransaction');
const GiftCardTransaction = builder.interfaceRef<TxShape>('GiftCardTransaction').implement({
  fields: (t) => ({
    id: t.id({ resolve: (x, _a, _c, info) => toGid(info.parentType.name, x.id) }),
    amount: t.field({ type: MoneyV2, resolve: (x) => moneyV2(Math.abs(x.amount), x.card.currency) }),
    note: t.string({ nullable: true, resolve: (x) => x.note }),
    processedAt: t.field({ type: 'DateTime', resolve: (x) => x.processedAt }),
    giftCard: t.field({ type: GiftCard, resolve: (x) => x.card }),
  }),
  resolveType: (x): string => (x.kind === 'CREDIT' ? 'GiftCardCreditTransaction' : 'GiftCardDebitTransaction'),
});
CreditTransaction.implement({ interfaces: [GiftCardTransaction], fields: () => ({}) });
DebitTransaction.implement({ interfaces: [GiftCardTransaction], fields: () => ({}) });
const TransactionConnection = defineConnection('GiftCardTransaction', GiftCardTransaction as never);
const txShape = (card: Shape, x: TxRow): TxShape => ({ ...x, card, kind: x.amount >= 0 ? 'CREDIT' : 'DEBIT' });

const GiftCard = builder.objectRef<Shape>('GiftCard');
GiftCard.implement({
  interfaces: [Node],
  fields: (t) => ({
    legacyResourceId: t.field({ type: 'UnsignedInt64', resolve: legacyId }),
    balance: t.field({ type: MoneyV2, resolve: (c) => moneyV2(c.balance, c.currency) }),
    initialValue: t.field({ type: MoneyV2, resolve: (c) => moneyV2(c.initialValue, c.currency) }),
    createdAt: t.field({ type: 'DateTime', resolve: (c) => c.createdAt }),
    updatedAt: t.field({ type: 'DateTime', resolve: (c) => c.updatedAt }),
    deactivatedAt: t.field({ type: 'DateTime', nullable: true, resolve: (c) => c.deactivatedAt }),
    expiresOn: t.field({ type: 'Date', nullable: true, resolve: (c) => c.expiresOn }),
    enabled: t.boolean({ resolve: (c) => c.enabled }),
    isRedeemable: t.boolean({ resolve: (c) => isRedeemable(c) }),
    lastCharacters: t.string({ resolve: (c) => lastCharacters(c.code) }),
    maskedCode: t.string({ resolve: (c) => maskedGiftCardCode(c.code) }),
    note: t.string({ nullable: true, resolve: (c) => c.note }),
    templateSuffix: t.string({ nullable: true, resolve: (c) => c.templateSuffix }),
    crossCurrencyRedemptionStrategy: t.field({ type: Strategy, resolve: () => 'NONE' as const }),
    customer: t.field({ type: Customer_, nullable: true, resolve: (c, _a, ctx) => (c.customerId ? getCustomer(ctx.db, ctx.shopId, c.customerId) : null) }),
    order: t.field({ type: Order_, nullable: true, resolve: (c, _a, ctx) => (c.orderId ? getOrder(ctx.db, ctx.shopId, c.orderId) : null) }),
    recipientAttributes: t.field({ type: GiftCardRecipient, nullable: true, resolve: (c) => (c.recipientCustomerId ? c : null) }),
    transactions: t.field({
      type: TransactionConnection, nullable: true, args: ConnectionArgs,
      resolve: async (c, a, ctx) => { requireScope(ctx, 'read_gift_card_transactions'); return paginateArray(a, (await listGiftCardTransactions(ctx.db, ctx.shopId, c.id)).map((x) => txShape(c, x))); },
    }),
  }),
});
const GiftCardConnection = defineConnection('GiftCard', GiftCard);
const load = async (ctx: GraphQLContext, c: GiftCardRow | null): Promise<Shape | null> => (c ? { ...c, _shopCurrency: (await shopOf(ctx)).currency } : null);
registerNode('GiftCard', async (ctx, id) => load(ctx, await getGiftCard(ctx.db, ctx.shopId, id)));

/** ShopMe extension: the gift cards issued when the order's gift card products were paid. */
builder.objectFields(Order_, (t) => ({
  shopmeIssuedGiftCards: t.field({
    type: [GiftCard],
    resolve: async (o, _a, ctx) => { requireScope(ctx, 'read_gift_cards'); return (await Promise.all((await listGiftCardsForOrder(ctx.db, ctx.shopId, o.id)).map((c) => load(ctx, c)))).filter((c): c is Shape => !!c); },
  }),
}));

const Configuration = builder.objectRef<{ currency: string }>('GiftCardConfiguration').implement({
  fields: (t) => ({
    issueLimit: t.field({ type: MoneyV2, resolve: (c) => moneyV2(GIFT_CARD_LIMIT, c.currency) }),
    purchaseLimit: t.field({ type: MoneyV2, resolve: (c) => moneyV2(GIFT_CARD_LIMIT, c.currency) }),
  }),
});

/* ------------------------------ queries ------------------------------ */

builder.queryFields((t) => ({
  giftCard: t.field({
    type: GiftCard, nullable: true, args: { id: t.arg.id({ required: true }) },
    resolve: async (_r, a, ctx) => { requireScope(ctx, 'read_gift_cards'); const id = parseId(String(a.id), 'GiftCard'); return id ? load(ctx, await getGiftCard(ctx.db, ctx.shopId, id)) : null; },
  }),
  giftCards: t.field({
    type: GiftCardConnection, args: { ...ConnectionArgs, sortKey: t.arg({ type: SortKeys, defaultValue: 'ID' }), query: t.arg.string(), savedSearchId: t.arg.id() },
    resolve: (_r, a, ctx) => {
      requireScope(ctx, 'read_gift_cards');
      return paginate(a, {
        fetch: async ({ offset, limit }) => Promise.all((await listGiftCards(ctx.db, ctx.shopId, { query: a.query, sortKey: (a.sortKey ?? 'ID') as 'ID', reverse: !!a.reverse, offset, limit })).map((c) => load(ctx, c) as Promise<Shape>)),
        total: async () => (await countGiftCards(ctx.db, ctx.shopId, a.query)).count,
      });
    },
  }),
  giftCardsCount: t.field({
    type: Count, nullable: true, args: { query: t.arg.string(), savedSearchId: t.arg.id(), limit: t.arg.int({ defaultValue: 10000 }) },
    resolve: (_r, a, ctx) => { requireScope(ctx, 'read_gift_cards'); return countGiftCards(ctx.db, ctx.shopId, a.query, a.limit ?? 10000); },
  }),
  giftCardConfiguration: t.field({ type: Configuration, resolve: async (_r, _a, ctx) => { requireScope(ctx, 'read_gift_cards'); return { currency: (await shopOf(ctx)).currency }; } }),
}));

/* ------------------------------ mutations ------------------------------ */

const RecipientInput = builder.inputType('GiftCardRecipientInput', {
  fields: (t) => ({ id: t.id({ required: true }), preferredName: t.string(), message: t.string(), sendNotificationAt: t.field({ type: 'DateTime' }) }),
});
const CreateInput = builder.inputType('GiftCardCreateInput', {
  fields: (t) => ({
    initialValue: t.field({ type: 'Decimal' }), initialAmount: t.field({ type: MoneyInput }), code: t.string(), customerId: t.id(), expiresOn: t.field({ type: 'Date' }), note: t.string(),
    crossCurrencyRedemptionStrategy: t.field({ type: Strategy }), recipientAttributes: t.field({ type: RecipientInput }), templateSuffix: t.string(),
  }),
});
const UpdateInput = builder.inputType('GiftCardUpdateInput', {
  fields: (t) => ({
    note: t.string(), expiresOn: t.field({ type: 'Date' }), customerId: t.id(), crossCurrencyRedemptionStrategy: t.field({ type: Strategy }), recipientAttributes: t.field({ type: RecipientInput }), templateSuffix: t.string(),
  }),
});
const CreditInput = builder.inputType('GiftCardCreditInput', { fields: (t) => ({ creditAmount: t.field({ type: MoneyInput, required: true }), note: t.string(), processedAt: t.field({ type: 'DateTime' }) }) });
const DebitInput = builder.inputType('GiftCardDebitInput', { fields: (t) => ({ debitAmount: t.field({ type: MoneyInput, required: true }), note: t.string(), processedAt: t.field({ type: 'DateTime' }) }) });

const CreatePayload = builder.objectRef<{ giftCard: Shape | null; giftCardCode: string | null; userErrors: UserError[] }>('GiftCardCreatePayload').implement({
  fields: (t) => ({
    giftCard: t.field({ type: GiftCard, nullable: true, resolve: (p) => p.giftCard }), giftCardCode: t.string({ nullable: true, resolve: (p) => p.giftCardCode }),
    userErrors: t.field({ type: [GiftCardUserError], resolve: (p) => p.userErrors }),
  }),
});
const cardPayload = (name: string) => builder.objectRef<{ giftCard: Shape | null; userErrors: UserError[] }>(name).implement({
  fields: (t) => ({ giftCard: t.field({ type: GiftCard, nullable: true, resolve: (p) => p.giftCard }), userErrors: t.field({ type: [GiftCardUserError], resolve: (p) => p.userErrors }) }),
});
const UpdatePayload = cardPayload('GiftCardUpdatePayload');
const DeactivatePayload = cardPayload('GiftCardDeactivatePayload');
const NotifyCustomerPayload = cardPayload('GiftCardSendNotificationToCustomerPayload');
const NotifyRecipientPayload = cardPayload('GiftCardSendNotificationToRecipientPayload');
const CreditPayload = builder.objectRef<{ tx: TxShape | null; userErrors: UserError[] }>('GiftCardCreditPayload').implement({
  fields: (t) => ({ giftCardCreditTransaction: t.field({ type: CreditTransaction, nullable: true, resolve: (p) => p.tx }), userErrors: t.field({ type: [GiftCardTransactionUserError], resolve: (p) => p.userErrors }) }),
});
const DebitPayload = builder.objectRef<{ tx: TxShape | null; userErrors: UserError[] }>('GiftCardDebitPayload').implement({
  fields: (t) => ({ giftCardDebitTransaction: t.field({ type: DebitTransaction, nullable: true, resolve: (p) => p.tx }), userErrors: t.field({ type: [GiftCardTransactionUserError], resolve: (p) => p.userErrors }) }),
});

const fail = (field: string[], message: string, code = 'INVALID'): UserError[] => [{ field, message, code }];
const withPrefix = (errors: UserError[], root: string): UserError[] => errors.map((e) => ({ ...e, field: e.field ? [root, ...e.field] : [root] }));

/** Amount in the shop currency, as minor units; returns an error when the currency differs or the amount is malformed. */
async function minor(ctx: GraphQLContext, amount: string, currency: string | null | undefined, field: string[]): Promise<{ value: number } | { errors: UserError[] }> {
  const shop = await shopOf(ctx);
  if (currency && currency !== shop.currency) return { errors: fail(field, 'Gift cards can only be issued in the shop currency', 'MISMATCHING_CURRENCY') };
  try { return { value: parseMoney(amount, shop.currency) }; } catch { return { errors: fail(field, 'Amount is invalid') }; }
}

async function sendCard(ctx: GraphQLContext, rawId: string, recipient: boolean) {
  requireScope(ctx, 'write_gift_cards');
  const id = parseId(String(rawId), 'GiftCard');
  const card = id ? await getGiftCard(ctx.db, ctx.shopId, id) : null;
  if (!card) return { giftCard: null, userErrors: fail(['id'], 'Gift card does not exist') };
  const shop = (await getShop(ctx.db, ctx.shopId))!;
  const { to, from } = await giftCardAddressees(ctx.db, card);
  if (recipient && !card.recipientCustomerId) return { giftCard: await load(ctx, card), userErrors: fail(['id'], 'This gift card has no recipient', 'RECIPIENT_NOT_FOUND') };
  if (!recipient && !card.customerId && !card.orderId) return { giftCard: await load(ctx, card), userErrors: fail(['id'], 'This gift card has no customer', 'CUSTOMER_NOT_FOUND') };
  if (!to) return { giftCard: await load(ctx, card), userErrors: fail(['id'], 'No email address to send the gift card to') };
  await sendNotification(ctx.db, ctx.app.mailer, shop, ctx.app.config.appUrl, 'gift_card_issued', to, giftCardMailVars(shop, ctx.app.config.appUrl, card, from));
  await markGiftCardNotified(ctx.db, card.id);
  return { giftCard: await load(ctx, card), userErrors: [] };
}

builder.mutationFields((t) => ({
  giftCardCreate: t.field({
    type: CreatePayload, args: { input: t.arg({ type: CreateInput, required: true }) },
    resolve: async (_r, { input: i }, ctx) => {
      requireScope(ctx, 'write_gift_cards');
      const none = { giftCard: null, giftCardCode: null };
      const amount = i.initialAmount ? await minor(ctx, i.initialAmount.amount, i.initialAmount.currencyCode, ['input', 'initialAmount']) : i.initialValue != null ? await minor(ctx, i.initialValue, null, ['input', 'initialValue']) : null;
      if (!amount) return { ...none, userErrors: fail(['input', 'initialValue'], 'Initial value is required', 'MISSING_ARGUMENT') };
      if ('errors' in amount) return { ...none, userErrors: amount.errors };
      const recipientId = i.recipientAttributes ? parseId(String(i.recipientAttributes.id), 'Customer') : null;
      if (i.recipientAttributes && !recipientId) return { ...none, userErrors: fail(['input', 'recipientAttributes', 'id'], 'Recipient could not be found', 'RECIPIENT_NOT_FOUND') };
      const customerId = i.customerId ? parseId(String(i.customerId), 'Customer') : null;
      if (i.customerId && !customerId) return { ...none, userErrors: fail(['input', 'customerId'], 'Customer could not be found', 'CUSTOMER_NOT_FOUND') };
      const shop = await shopOf(ctx);
      const r = await createGiftCard(ctx.db, ctx.shopId, shop.currency, {
        initialValue: amount.value, code: i.code, customerId, expiresOn: i.expiresOn, note: i.note, templateSuffix: i.templateSuffix, recipientCustomerId: recipientId,
        recipientName: i.recipientAttributes?.preferredName, message: i.recipientAttributes?.message, sendNotificationAt: i.recipientAttributes?.sendNotificationAt,
      }, staffOf(ctx));
      return r.ok ? { giftCard: await load(ctx, r.value), giftCardCode: r.value.code.toLowerCase(), userErrors: [] } : { ...none, userErrors: withPrefix(r.errors, 'input') };
    },
  }),
  giftCardUpdate: t.field({
    type: UpdatePayload, args: { id: t.arg.id({ required: true }), input: t.arg({ type: UpdateInput, required: true }) },
    resolve: async (_r, { id: rawId, input: i }, ctx) => {
      requireScope(ctx, 'write_gift_cards');
      const id = parseId(String(rawId), 'GiftCard');
      if (!id) return { giftCard: null, userErrors: fail(['id'], 'Gift card does not exist') };
      const recipientId = i.recipientAttributes ? parseId(String(i.recipientAttributes.id), 'Customer') : undefined;
      if (i.recipientAttributes && !recipientId) return { giftCard: null, userErrors: fail(['input', 'recipientAttributes', 'id'], 'Recipient could not be found', 'RECIPIENT_NOT_FOUND') };
      const r = await updateGiftCard(ctx.db, ctx.shopId, id, {
        ...(i.note !== undefined && { note: i.note }), ...(i.expiresOn !== undefined && { expiresOn: i.expiresOn }), ...(i.templateSuffix !== undefined && { templateSuffix: i.templateSuffix }),
        ...(i.customerId !== undefined && { customerId: i.customerId ? parseId(String(i.customerId), 'Customer') : null }),
        ...(i.recipientAttributes && { recipientCustomerId: recipientId, recipientName: i.recipientAttributes.preferredName ?? null, message: i.recipientAttributes.message ?? null, sendNotificationAt: i.recipientAttributes.sendNotificationAt ?? null }),
      }, staffOf(ctx));
      return r.ok ? { giftCard: await load(ctx, r.value), userErrors: [] } : { giftCard: null, userErrors: withPrefix(r.errors, 'input') };
    },
  }),
  giftCardDeactivate: t.field({
    type: DeactivatePayload, args: { id: t.arg.id({ required: true }) },
    resolve: async (_r, a, ctx) => {
      requireScope(ctx, 'write_gift_cards');
      const id = parseId(String(a.id), 'GiftCard');
      const r = id ? await deactivateGiftCard(ctx.db, ctx.shopId, id, staffOf(ctx)) : null;
      return r?.ok ? { giftCard: await load(ctx, r.value), userErrors: [] } : { giftCard: null, userErrors: fail(['id'], 'Gift card does not exist') };
    },
  }),
  giftCardCredit: t.field({
    type: CreditPayload, args: { id: t.arg.id({ required: true }), creditInput: t.arg({ type: CreditInput, required: true }) },
    resolve: async (_r, a, ctx) => {
      requireScope(ctx, 'write_gift_card_transactions');
      const id = parseId(String(a.id), 'GiftCard');
      const amt = await minor(ctx, a.creditInput.creditAmount.amount, a.creditInput.creditAmount.currencyCode, ['creditInput', 'creditAmount']);
      if ('errors' in amt) return { tx: null, userErrors: amt.errors };
      if (amt.value <= 0) return { tx: null, userErrors: fail(['creditInput', 'creditAmount'], 'Amount must be greater than 0', 'NEGATIVE_OR_ZERO_AMOUNT') };
      const r = id ? await adjustGiftCard(ctx.db, ctx.shopId, id, amt.value, { note: a.creditInput.note, processedAt: a.creditInput.processedAt, staffId: staffOf(ctx) }) : null;
      if (!r) return { tx: null, userErrors: fail(['id'], 'Gift card does not exist', 'GIFT_CARD_NOT_FOUND') };
      return r.ok ? { tx: txShape((await load(ctx, r.value.giftCard))!, r.value.transaction), userErrors: [] } : { tx: null, userErrors: r.errors };
    },
  }),
  giftCardDebit: t.field({
    type: DebitPayload, args: { id: t.arg.id({ required: true }), debitInput: t.arg({ type: DebitInput, required: true }) },
    resolve: async (_r, a, ctx) => {
      requireScope(ctx, 'write_gift_card_transactions');
      const id = parseId(String(a.id), 'GiftCard');
      const amt = await minor(ctx, a.debitInput.debitAmount.amount, a.debitInput.debitAmount.currencyCode, ['debitInput', 'debitAmount']);
      if ('errors' in amt) return { tx: null, userErrors: amt.errors };
      if (amt.value <= 0) return { tx: null, userErrors: fail(['debitInput', 'debitAmount'], 'Amount must be greater than 0', 'NEGATIVE_OR_ZERO_AMOUNT') };
      const r = id ? await adjustGiftCard(ctx.db, ctx.shopId, id, -amt.value, { note: a.debitInput.note, processedAt: a.debitInput.processedAt, staffId: staffOf(ctx) }) : null;
      if (!r) return { tx: null, userErrors: fail(['id'], 'Gift card does not exist', 'GIFT_CARD_NOT_FOUND') };
      return r.ok ? { tx: txShape((await load(ctx, r.value.giftCard))!, r.value.transaction), userErrors: [] } : { tx: null, userErrors: r.errors };
    },
  }),
  giftCardSendNotificationToCustomer: t.field({ type: NotifyCustomerPayload, args: { id: t.arg.id({ required: true }) }, resolve: (_r, a, ctx) => sendCard(ctx, String(a.id), false) }),
  giftCardSendNotificationToRecipient: t.field({ type: NotifyRecipientPayload, args: { id: t.arg.id({ required: true }) }, resolve: (_r, a, ctx) => sendCard(ctx, String(a.id), true) }),
}));
