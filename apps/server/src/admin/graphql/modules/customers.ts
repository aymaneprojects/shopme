import {
  changeCustomerTags, countCustomers, createCustomer, customerStats, deleteCustomer, getCustomer, getDefaultAddress, listCustomerAddresses, listCustomers, listOrders, countOrders, updateCustomer,
  type CustomerInput as ServiceInput,
} from '@shopme/core';
import { parseId, toGid, type UserError } from '@shopme/shopify-compat';
import { builder } from '../builder';
import { requireScope } from '../context';
import { ConnectionArgs, paginate } from '../types/connection';
import { definePayload } from '../types/errors';
import { Count, MoneyV2, moneyV2 } from '../types/money';
import { Node, legacyId, registerNode } from '../types/node';
import { shopOf } from '../types/catalog';
import { Customer_, CustomerConnection, MailingAddress, MailingAddressConnection, MailingAddressInput, OrderConnection, registerTaggable } from '../types/sales';
import { paginateArray } from '../types/connection';
import { Shop } from './shop';

const CustomerState = builder.enumType('CustomerState', { values: ['DECLINED', 'DISABLED', 'ENABLED', 'INVITED'] as const });
const MarketingState = builder.enumType('CustomerEmailAddressMarketingState', { values: ['INVALID', 'NOT_SUBSCRIBED', 'PENDING', 'SUBSCRIBED', 'UNSUBSCRIBED'] as const });
const CustomerSortKeys = builder.enumType('CustomerSortKeys', { values: ['CREATED_AT', 'ID', 'LOCATION', 'NAME', 'RELEVANCE', 'UPDATED_AT'] as const });
const OrderSortKeysRef = 'OrderSortKeys' as never;

const CustomerEmailAddress = builder.objectRef<{ emailAddress: string; subscribed: boolean }>('CustomerEmailAddress').implement({
  fields: (t) => ({
    emailAddress: t.exposeString('emailAddress'),
    marketingState: t.field({ type: MarketingState, resolve: (e) => (e.subscribed ? 'SUBSCRIBED' : 'NOT_SUBSCRIBED') as 'SUBSCRIBED' }),
    validFormat: t.boolean({ resolve: () => true }),
    marketingUpdatedAt: t.field({ type: 'DateTime', nullable: true, resolve: () => null }),
  }),
});
const CustomerPhoneNumber = builder.objectRef<{ phoneNumber: string }>('CustomerPhoneNumber').implement({ fields: (t) => ({ phoneNumber: t.exposeString('phoneNumber') }) });

const displayName = (c: { firstName: string | null; lastName: string | null; email: string | null }) => [c.firstName, c.lastName].filter(Boolean).join(' ') || c.email || '';

Customer_.implement({
  interfaces: [Node],
  fields: (t) => ({
    legacyResourceId: t.field({ type: 'UnsignedInt64', resolve: legacyId }),
    firstName: t.exposeString('firstName', { nullable: true }),
    lastName: t.exposeString('lastName', { nullable: true }),
    displayName: t.string({ resolve: displayName }),
    email: t.exposeString('email', { nullable: true, deprecationReason: 'Use `defaultEmailAddress` instead.' }),
    phone: t.exposeString('phone', { nullable: true, deprecationReason: 'Use `defaultPhoneNumber` instead.' }),
    locale: t.exposeString('locale'),
    note: t.exposeString('note', { nullable: true }),
    tags: t.exposeStringList('tags'),
    state: t.field({ type: CustomerState, resolve: (c) => c.state as 'DISABLED' }),
    verifiedEmail: t.exposeBoolean('verifiedEmail'),
    taxExempt: t.exposeBoolean('taxExempt'),
    createdAt: t.field({ type: 'DateTime', resolve: (c) => c.createdAt }),
    updatedAt: t.field({ type: 'DateTime', resolve: (c) => c.updatedAt }),
    defaultEmailAddress: t.field({ type: CustomerEmailAddress, nullable: true, resolve: (c) => (c.email ? { emailAddress: c.email, subscribed: c.acceptsMarketing } : null) }),
    defaultPhoneNumber: t.field({ type: CustomerPhoneNumber, nullable: true, resolve: (c) => (c.phone ? { phoneNumber: c.phone } : null) }),
    numberOfOrders: t.field({ type: 'UnsignedInt64', resolve: async (c, _a, ctx) => String((await customerStats(ctx.db, ctx.shopId, c.id)).numberOfOrders) }),
    amountSpent: t.field({
      type: MoneyV2,
      resolve: async (c, _a, ctx) => moneyV2((await customerStats(ctx.db, ctx.shopId, c.id)).amountSpent, (await shopOf(ctx)).currency),
    }),
    defaultAddress: t.field({ type: MailingAddress, nullable: true, resolve: (c, _a, ctx) => getDefaultAddress(ctx.db, ctx.shopId, c) }),
    addresses: t.field({ type: [MailingAddress], args: { first: t.arg.int() }, resolve: (c, a, ctx) => listCustomerAddresses(ctx.db, ctx.shopId, c.id, { offset: 0, limit: a.first ?? 250 }) }),
    addressesV2: t.field({
      type: MailingAddressConnection, args: ConnectionArgs,
      resolve: async (c, a, ctx) => paginateArray(a, await listCustomerAddresses(ctx.db, ctx.shopId, c.id, { reverse: !!a.reverse, offset: 0, limit: 250 })),
    }),
    orders: t.field({
      type: OrderConnection, args: { ...ConnectionArgs, sortKey: t.arg({ type: OrderSortKeysRef, defaultValue: 'ID' as never }), query: t.arg.string() },
      resolve: (c, a, ctx) => {
        requireScope(ctx, 'read_orders');
        const query = `customer_id:${c.id}${a.query ? ` ${a.query}` : ''}`;
        const key = (a.sortKey as string) ?? 'ID';
        return paginate(a, {
          fetch: ({ offset, limit }) => listOrders(ctx.db, ctx.shopId, { query, sortKey: key as 'ID', reverse: !!a.reverse, offset, limit }),
          total: async () => (await countOrders(ctx.db, ctx.shopId, query)).count,
        });
      },
    }),
  }),
});
registerNode('Customer', (ctx, id) => getCustomer(ctx.db, ctx.shopId, id));
registerTaggable('Customer', async (ctx, id, mode, tags) => { requireScope(ctx, 'write_customers'); return changeCustomerTags(ctx.db, ctx.shopId, id, mode, tags); });

/* ------------------------------ queries ------------------------------ */

builder.queryFields((t) => ({
  customer: t.field({
    type: Customer_, nullable: true, args: { id: t.arg.id({ required: true }) },
    resolve: (_r, a, ctx) => { requireScope(ctx, 'read_customers'); const id = parseId(String(a.id), 'Customer'); return id ? getCustomer(ctx.db, ctx.shopId, id) : null; },
  }),
  customers: t.field({
    type: CustomerConnection, args: { ...ConnectionArgs, sortKey: t.arg({ type: CustomerSortKeys, defaultValue: 'ID' }), query: t.arg.string() },
    resolve: (_r, a, ctx) => {
      requireScope(ctx, 'read_customers');
      return paginate(a, {
        fetch: ({ offset, limit }) => listCustomers(ctx.db, ctx.shopId, { query: a.query, sortKey: a.sortKey ?? 'ID', reverse: !!a.reverse, offset, limit }),
        total: async () => (await countCustomers(ctx.db, ctx.shopId, a.query)).count,
      });
    },
  }),
  customersCount: t.field({
    type: Count, nullable: true, args: { query: t.arg.string(), limit: t.arg.int({ defaultValue: 10000 }) },
    resolve: (_r, a, ctx) => { requireScope(ctx, 'read_customers'); return countCustomers(ctx.db, ctx.shopId, a.query, a.limit ?? 10000); },
  }),
}));

/* ------------------------------ mutations ------------------------------ */

/** `addresses` is a ShopMe extension (the real CustomerInput manages addresses through customerAddress* mutations). */
const EmailConsentInput = builder.inputType('CustomerEmailMarketingConsentInput', {
  fields: (t) => ({ marketingState: t.string({ required: true }), marketingOptInLevel: t.string(), consentUpdatedAt: t.field({ type: 'DateTime' }) }),
});
const CustomerInput = builder.inputType('CustomerInput', {
  fields: (t) => ({
    emailMarketingConsent: t.field({ type: EmailConsentInput }),
    email: t.string(), firstName: t.string(), id: t.id(), lastName: t.string(), locale: t.string(), note: t.string(), phone: t.string(), tags: t.stringList(), taxExempt: t.boolean(),
    addresses: t.field({ type: [MailingAddressInput] }),
  }),
});
const CustomerDeleteInput = builder.inputType('CustomerDeleteInput', { fields: (t) => ({ id: t.id({ required: true }) }) });
const CustomerPayload = (name: string) => definePayload<{ customer: typeof Customer_.$inferType | null }>(name, (t) => ({ customer: t.field({ type: Customer_, nullable: true, resolve: (p) => p.customer }) }));
const CreatePayload = CustomerPayload('CustomerCreatePayload');
const UpdatePayload = CustomerPayload('CustomerUpdatePayload');
const DeletePayload = definePayload<{ deletedCustomerId: string | null }>('CustomerDeletePayload', (t) => ({
  deletedCustomerId: t.id({ nullable: true, resolve: (p) => p.deletedCustomerId }),
  shop: t.field({ type: Shop, resolve: (_p, _a, ctx) => shopOf(ctx) }),
}));

const toService = (i: typeof CustomerInput.$inferInput): ServiceInput => ({
  email: i.email, firstName: i.firstName, lastName: i.lastName, locale: i.locale, note: i.note, phone: i.phone, tags: i.tags, taxExempt: i.taxExempt,
  acceptsMarketing: i.emailMarketingConsent ? i.emailMarketingConsent.marketingState === 'SUBSCRIBED' : undefined,
  addresses: i.addresses?.map((a) => ({ ...a, countryCode: a.countryCode ?? undefined })),
});
const prefixed = (errors: UserError[]): UserError[] => errors.map((e) => ({ ...e, field: ['input', ...(e.field ?? [])] }));

builder.mutationFields((t) => ({
  customerCreate: t.field({
    type: CreatePayload, args: { input: t.arg({ type: CustomerInput, required: true }) },
    resolve: async (_r, { input }, ctx) => {
      requireScope(ctx, 'write_customers');
      const r = await createCustomer(ctx.db, ctx.shopId, toService(input), ctx.auth.kind === 'session' ? ctx.auth.user.id : null);
      return r.ok ? { customer: r.value, userErrors: [] } : { customer: null, userErrors: prefixed(r.errors) };
    },
  }),
  customerUpdate: t.field({
    type: UpdatePayload, args: { input: t.arg({ type: CustomerInput, required: true }) },
    resolve: async (_r, { input }, ctx) => {
      requireScope(ctx, 'write_customers');
      const id = input.id ? parseId(String(input.id), 'Customer') : null;
      if (!id) return { customer: null, userErrors: [{ field: ['input', 'id'], message: 'Customer does not exist' }] };
      const r = await updateCustomer(ctx.db, ctx.shopId, id, toService(input), ctx.auth.kind === 'session' ? ctx.auth.user.id : null);
      return r.ok ? { customer: r.value, userErrors: [] } : { customer: null, userErrors: prefixed(r.errors) };
    },
  }),
  customerDelete: t.field({
    type: DeletePayload, args: { input: t.arg({ type: CustomerDeleteInput, required: true }) },
    resolve: async (_r, { input }, ctx) => {
      requireScope(ctx, 'write_customers');
      const id = parseId(String(input.id), 'Customer');
      const r = id ? await deleteCustomer(ctx.db, ctx.shopId, id) : null;
      if (r?.ok) return { deletedCustomerId: toGid('Customer', id!), userErrors: [] };
      return { deletedCustomerId: null, userErrors: r ? prefixed(r.errors) : [{ field: ['input', 'id'], message: "Customer can't be found" }] };
    },
  }),
}));
