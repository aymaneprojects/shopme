/** Customer fields (lastOrder, statistics, marketing consent...) and the address-book mutations; Shop fields live next to them. */
import {
  addressBookAdd, addressBookDelete, addressBookSetDefault, addressBookUpdate, customerStats, lastOrderOf, shopAddressOf, type CustomerAddress,
} from '@shopme/core';
import { parseId, toGid } from '@shopme/shopify-compat';
import { builder } from '../builder';
import { requireScope } from '../context';
import { ConnectionArgs, defineConnection, paginateArray } from '../types/connection';
import { definePayload } from '../types/errors';
import { CurrencyCode } from '../types/money';
import { Customer_, CountryCode, MailingAddress, MailingAddressInput, Order_ } from '../types/sales';
import { ShopAddress } from './settings';
import { Shop } from './shop';

/* ------------------------------ Customer ------------------------------ */

const MarketingState = 'CustomerEmailAddressMarketingState' as never;
const EmailConsent = builder.objectRef<{ subscribed: boolean }>('CustomerEmailMarketingConsentState').implement({
  fields: (t) => ({
    marketingState: t.field({ type: MarketingState, resolve: (c) => (c.subscribed ? 'SUBSCRIBED' : 'NOT_SUBSCRIBED') as never }),
    marketingOptInLevel: t.string({ nullable: true, resolve: (c) => (c.subscribed ? 'SINGLE_OPT_IN' : null) }),
    consentUpdatedAt: t.field({ type: 'DateTime', nullable: true, resolve: () => null }),
  }),
});
const SmsMarketingState = builder.enumType('CustomerSmsMarketingState', { values: ['NOT_SUBSCRIBED', 'PENDING', 'REDACTED', 'SUBSCRIBED', 'UNSUBSCRIBED'] as const });
const SmsConsent = builder.objectRef<{ subscribed: boolean }>('CustomerSmsMarketingConsentState').implement({
  fields: (t) => ({
    marketingState: t.field({ type: SmsMarketingState, resolve: (c) => (c.subscribed ? 'SUBSCRIBED' : 'NOT_SUBSCRIBED') }),
    marketingOptInLevel: t.string({ nullable: true, resolve: () => null }),
    consentUpdatedAt: t.field({ type: 'DateTime', nullable: true, resolve: () => null }),
    consentCollectedFrom: t.string({ nullable: true, resolve: () => null }),
  }),
});
const SpendTier = builder.enumType('CustomerPredictedSpendTier', { values: ['HIGH', 'MEDIUM', 'LOW'] as const });
const RfmGroup = builder.enumType('CustomerRfmGroup', { values: ['CHAMPIONS', 'LOYAL', 'ACTIVE', 'NEW', 'PROMISING', 'NEEDS_ATTENTION', 'ALMOST_LOST', 'PREVIOUSLY_LOYAL', 'AT_RISK', 'DORMANT', 'PROSPECTS'] as const });
const CustomerStatistics = builder.objectRef<Record<string, never>>('CustomerStatistics').implement({
  fields: (t) => ({ predictedSpendTier: t.field({ type: SpendTier, nullable: true, resolve: () => null }), rfmGroup: t.field({ type: RfmGroup, nullable: true, resolve: () => null }) }),
});

builder.objectFields(Customer_, (t) => ({
  lastOrder: t.field({ type: Order_, nullable: true, resolve: async (c, _a, ctx) => { requireScope(ctx, 'read_orders'); return lastOrderOf(ctx.db, ctx.shopId, c.id); } }),
  statistics: t.field({ type: CustomerStatistics, resolve: () => ({}) }),
  emailMarketingConsent: t.field({ type: EmailConsent, nullable: true, resolve: (c) => (c.email ? { subscribed: c.acceptsMarketing } : null) }),
  smsMarketingConsent: t.field({ type: SmsConsent, nullable: true, resolve: (c) => (c.phone ? { subscribed: false } : null) }),
  canDelete: t.boolean({ resolve: async (c, _a, ctx) => (await customerStats(ctx.db, ctx.shopId, c.id)).numberOfOrders === 0 }),
  lifetimeDuration: t.string({
    resolve: (c) => {
      const days = Math.max(0, Math.floor((Date.now() - c.createdAt.getTime()) / 86400000));
      return days < 1 ? 'less than a day' : days < 30 ? `${days} day${days > 1 ? 's' : ''}` : days < 365 ? `${Math.floor(days / 30)} month${days >= 60 ? 's' : ''}` : `${Math.floor(days / 365)} year${days >= 730 ? 's' : ''}`;
    },
  }),
  unsubscribeUrl: t.field({ type: 'URL', resolve: (c, _a, ctx) => `${ctx.app.config.appUrl}/account/unsubscribe?customer=${c.id}` }),
}));

/* ------------------------------ address book ------------------------------ */

const toAddress = (a: NonNullable<typeof MailingAddressInput.$inferInput>) => ({ ...a, countryCode: a.countryCode ?? undefined });
const AddressPayload = (name: string) => definePayload<{ address: CustomerAddress | null }>(name, (t) => ({ address: t.field({ type: MailingAddress, nullable: true, resolve: (p) => p.address }) }));
const AddressCreatePayload = AddressPayload('CustomerAddressCreatePayload');
const AddressUpdatePayload = AddressPayload('CustomerAddressUpdatePayload');
const AddressDeletePayload = definePayload<{ deletedAddressId: string | null }>('CustomerAddressDeletePayload', (t) => ({ deletedAddressId: t.id({ nullable: true, resolve: (p) => p.deletedAddressId }) }));
const DefaultAddressPayload = definePayload<{ customer: typeof Customer_.$inferType | null }>('CustomerUpdateDefaultAddressPayload', (t) => ({ customer: t.field({ type: Customer_, nullable: true, resolve: (p) => p.customer }) }));

const ids = (customerId: unknown, addressId?: unknown) => ({ cid: parseId(String(customerId), 'Customer'), aid: addressId === undefined ? undefined : parseId(String(addressId), 'MailingAddress') });
const bad = (field: string[], message: string) => [{ field, message }];

builder.mutationFields((t) => ({
  customerAddressCreate: t.field({
    type: AddressCreatePayload, args: { customerId: t.arg.id({ required: true }), address: t.arg({ type: MailingAddressInput, required: true }), setAsDefault: t.arg.boolean() },
    resolve: async (_r, a, ctx) => {
      requireScope(ctx, 'write_customers');
      const { cid } = ids(a.customerId);
      if (!cid) return { address: null, userErrors: bad(['customerId'], "Customer can't be found") };
      const r = await addressBookAdd(ctx.db, ctx.shopId, cid, toAddress(a.address), !!a.setAsDefault);
      return r.ok ? { address: r.value, userErrors: [] } : { address: null, userErrors: r.errors };
    },
  }),
  customerAddressUpdate: t.field({
    type: AddressUpdatePayload, args: { customerId: t.arg.id({ required: true }), addressId: t.arg.id({ required: true }), address: t.arg({ type: MailingAddressInput, required: true }), setAsDefault: t.arg.boolean() },
    resolve: async (_r, a, ctx) => {
      requireScope(ctx, 'write_customers');
      const { cid, aid } = ids(a.customerId, a.addressId);
      if (!cid || !aid) return { address: null, userErrors: bad([cid ? 'addressId' : 'customerId'], 'Not found') };
      const r = await addressBookUpdate(ctx.db, ctx.shopId, cid, aid, toAddress(a.address), !!a.setAsDefault);
      return r.ok ? { address: r.value, userErrors: [] } : { address: null, userErrors: r.errors };
    },
  }),
  customerAddressDelete: t.field({
    type: AddressDeletePayload, args: { customerId: t.arg.id({ required: true }), addressId: t.arg.id({ required: true }) },
    resolve: async (_r, a, ctx) => {
      requireScope(ctx, 'write_customers');
      const { cid, aid } = ids(a.customerId, a.addressId);
      if (!cid || !aid) return { deletedAddressId: null, userErrors: bad([cid ? 'addressId' : 'customerId'], 'Not found') };
      const r = await addressBookDelete(ctx.db, ctx.shopId, cid, aid);
      return r.ok ? { deletedAddressId: toGid('MailingAddress', aid), userErrors: [] } : { deletedAddressId: null, userErrors: r.errors };
    },
  }),
  customerUpdateDefaultAddress: t.field({
    type: DefaultAddressPayload, args: { customerId: t.arg.id({ required: true }), addressId: t.arg.id({ required: true }) },
    resolve: async (_r, a, ctx) => {
      requireScope(ctx, 'write_customers');
      const { cid, aid } = ids(a.customerId, a.addressId);
      if (!cid || !aid) return { customer: null, userErrors: bad([cid ? 'addressId' : 'customerId'], 'Not found') };
      const r = await addressBookSetDefault(ctx.db, ctx.shopId, cid, aid);
      return r.ok ? { customer: r.value, userErrors: [] } : { customer: null, userErrors: r.errors };
    },
  }),
}));

/* ------------------------------ Shop ------------------------------ */

interface CurrencySettingShape { currencyCode: string; enabled: boolean }
const CurrencySetting = builder.objectRef<CurrencySettingShape>('CurrencySetting').implement({
  fields: (t) => ({
    currencyCode: t.field({ type: CurrencyCode, resolve: (c) => c.currencyCode }),
    currencyName: t.string({ resolve: (c) => new Intl.DisplayNames(['en'], { type: 'currency' }).of(c.currencyCode) ?? c.currencyCode }),
    enabled: t.exposeBoolean('enabled'),
    rateUpdatedAt: t.field({ type: 'DateTime', nullable: true, resolve: () => null }),
  }),
});
const CurrencySettingConnection = defineConnection('CurrencySetting', CurrencySetting);
const ShopPlan = builder.objectRef<Record<string, never>>('ShopPlan').implement({
  fields: (t) => ({
    displayName: t.string({ resolve: () => 'ShopMe' }), partnerDevelopment: t.boolean({ resolve: () => false }), shopifyPlus: t.boolean({ resolve: () => false }),
    publicDisplayName: t.string({ resolve: () => 'ShopMe' }),
  }),
});
const ShopFeatures = builder.objectRef<Record<string, never>>('ShopFeatures').implement({
  fields: (t) => ({
    storefront: t.boolean({ resolve: () => true }), giftCards: t.boolean({ resolve: () => true }), multiLocation: t.boolean({ resolve: () => true }), reports: t.boolean({ resolve: () => true }),
    harmonizedSystemCode: t.boolean({ resolve: () => true }), bundles: t.boolean({ resolve: () => false }), sellsSubscriptions: t.boolean({ resolve: () => false }),
  }),
});

const offsetMinutes = (tz: string): number => {
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'longOffset' }).formatToParts(new Date());
    const m = /GMT([+-])(\d{2}):?(\d{2})?/.exec(parts.find((p) => p.type === 'timeZoneName')?.value ?? '');
    return m ? (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3] ?? 0)) : 0;
  } catch { return 0; }
};

builder.objectFields(Shop, (t) => ({
  shopAddress: t.field({ type: ShopAddress, resolve: (s) => shopAddressOf(s) }),
  currencySettings: t.field({ type: CurrencySettingConnection, args: ConnectionArgs, resolve: (s, a) => paginateArray(a, [{ currencyCode: s.currency, enabled: true }]) }),
  enabledPresentmentCurrencies: t.field({ type: [CurrencyCode], resolve: (s) => [s.currency] }),
  plan: t.field({ type: ShopPlan, resolve: () => ({}) }),
  features: t.field({ type: ShopFeatures, resolve: () => ({}) }),
  setupRequired: t.boolean({ resolve: () => false }),
  checkoutApiSupported: t.boolean({ resolve: () => true }),
  timezoneAbbreviation: t.string({ resolve: (s) => new Intl.DateTimeFormat('en-US', { timeZone: s.timezone, timeZoneName: 'short' }).formatToParts(new Date()).find((p) => p.type === 'timeZoneName')?.value ?? s.timezone }),
  timezoneOffsetMinutes: t.int({ resolve: (s) => offsetMinutes(s.timezone) }),
  timezoneOffset: t.string({ resolve: (s) => { const m = offsetMinutes(s.timezone); const a = Math.abs(m); return `${m < 0 ? '-' : '+'}${String(Math.floor(a / 60)).padStart(2, '0')}${String(a % 60).padStart(2, '0')}`; } }),
  orderNumberFormatPrefix: t.string({ resolve: () => '#' }),
  orderNumberFormatSuffix: t.string({ resolve: () => '' }),
  taxShipping: t.boolean({ resolve: (s) => s.settings.taxShipping === true }),
  shipsToCountries: t.field({ type: [CountryCode], resolve: (s) => [s.country as 'FR'] }),
  shopOwnerName: t.string({ resolve: (s) => s.name }),
  updatedAt: t.field({ type: 'DateTime', resolve: (s) => s.createdAt }),
}));
