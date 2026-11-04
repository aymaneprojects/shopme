/**
 * Store settings. Shopify exposes most of this through app-specific or very complex APIs (deliveryProfiles, tax
 * overrides, payment gateways); ShopMe-specific, simpler operations are prefixed `shopme` or documented in
 * docs/dev/admin-settings-api.md.
 */
import {
  createShippingRate, createShippingZone, createTaxRate, deleteShippingRate, deleteShippingZone, deleteTaxRate, getShippingRate, getShippingZone, getTaxRate, listShippingZones, listStaff,
  listTaxRates, paymentSettingsOf, shopAddressOf, storefrontOf, updatePaymentSettings, updateShippingRate, updateShippingZone, updateShopSettings, updateTaxRate,
  type ShippingRate, type ShippingRateInput, type ShippingZone, type TaxRate,
} from '@shopme/core';
import { parseId, parseMoney, toGid, type UserError } from '@shopme/shopify-compat';
import { builder } from '../builder';
import { requireScope, type GraphQLContext } from '../context';
import { ConnectionArgs, paginateArray } from '../types/connection';
import { definePayload } from '../types/errors';
import { CurrencyCode, MoneyV2, moneyV2 } from '../types/money';
import { Node, registerNode } from '../types/node';
import { shopOf } from '../types/catalog';
import { CountryCode, COUNTRY_CODES, MailingAddressInput, StaffMemberConnection, countryName } from '../types/sales';
import { Shop } from './shop';

const staffId = (ctx: GraphQLContext) => (ctx.auth.kind === 'session' ? ctx.auth.user.id : null);

/* ------------------------------ shop details ------------------------------ */

interface AddressShape { company?: string | null; address1?: string | null; address2?: string | null; city?: string | null; provinceCode?: string | null; province?: string | null; zip?: string | null; countryCode?: string | null; phone?: string | null }
const ShopAddress = builder.objectRef<AddressShape>('ShopAddress').implement({
  fields: (t) => ({
    address1: t.string({ nullable: true, resolve: (a) => a.address1 ?? null }),
    address2: t.string({ nullable: true, resolve: (a) => a.address2 ?? null }),
    city: t.string({ nullable: true, resolve: (a) => a.city ?? null }),
    company: t.string({ nullable: true, resolve: (a) => a.company ?? null }),
    country: t.string({ nullable: true, resolve: (a) => countryName(a.countryCode ?? null) }),
    countryCodeV2: t.field({ type: CountryCode, nullable: true, resolve: (a) => (a.countryCode && COUNTRY_CODES.has(a.countryCode) ? a.countryCode : null) }),
    phone: t.string({ nullable: true, resolve: (a) => a.phone ?? null }),
    province: t.string({ nullable: true, resolve: (a) => a.province ?? a.provinceCode ?? null }),
    provinceCode: t.string({ nullable: true, resolve: (a) => a.provinceCode ?? null }),
    zip: t.string({ nullable: true, resolve: (a) => a.zip ?? null }),
  }),
});

const Storefront = builder.objectRef<{ passwordEnabled: boolean; password: string; message: string }>('ShopmeStorefrontSettings').implement({
  fields: (t) => ({ passwordEnabled: t.exposeBoolean('passwordEnabled'), password: t.exposeString('password'), passwordMessage: t.string({ resolve: (s) => s.message }) }),
});

builder.objectFields(Shop, (t) => ({
  billingAddress: t.field({ type: ShopAddress, resolve: (s) => shopAddressOf(s) }),
  unitSystem: t.string({ resolve: (s) => (s.weightUnit === 'POUNDS' || s.weightUnit === 'OUNCES' ? 'IMPERIAL_SYSTEM' : 'METRIC_SYSTEM') }),
  /** ShopMe: "Charge tax on shipping" (settings > taxes). */
  shopmeTaxShipping: t.boolean({ resolve: (s) => s.settings.taxShipping === true }),
  /** ShopMe: storefront password protection (settings > preferences). */
  shopmeStorefront: t.field({ type: Storefront, resolve: (s) => storefrontOf(s) }),
  shopmeLocale: t.string({ resolve: (s) => s.locale }),
}));

const ShopInput = builder.inputType('ShopmeShopInput', {
  fields: (t) => ({
    name: t.string(), email: t.string(), description: t.string(), currencyCode: t.field({ type: CurrencyCode }), ianaTimezone: t.string(), weightUnit: t.field({ type: 'WeightUnit' as never }),
    locale: t.string(), address: t.field({ type: MailingAddressInput }), moneyFormat: t.string(), moneyWithCurrencyFormat: t.string(), taxesIncluded: t.boolean(), taxShipping: t.boolean(),
    storefrontPasswordEnabled: t.boolean(), storefrontPassword: t.string(), storefrontPasswordMessage: t.string(),
    primaryDomain: t.string({ description: 'Hostname without scheme, e.g. shop.example.com; empty string clears it.' }),
  }),
});
const ShopUpdatePayload = definePayload<{ shop: typeof Shop.$inferType | null }>('ShopmeShopUpdatePayload', (t) => ({ shop: t.field({ type: Shop, nullable: true, resolve: (p) => p.shop }) }));

/* ------------------------------ payments ------------------------------ */

const ManualBank = builder.objectRef<{ enabled: boolean; instructions: string }>('ShopmeBankTransferSettings').implement({ fields: (t) => ({ enabled: t.exposeBoolean('enabled'), instructions: t.exposeString('instructions') }) });
const ManualCod = builder.objectRef<{ enabled: boolean }>('ShopmeCodSettings').implement({ fields: (t) => ({ enabled: t.exposeBoolean('enabled') }) });
const StripeSettings = builder.objectRef<{ enabled: boolean; configured: boolean }>('ShopmeStripeSettings').implement({
  fields: (t) => ({ enabled: t.exposeBoolean('enabled'), stripeConfigured: t.boolean({ description: 'True when the server has Stripe keys in its environment. Keys are never exposed.', resolve: (s) => s.configured }) }),
});
interface PaymentsShape { bankTransfer: { enabled: boolean; instructions: string }; cod: { enabled: boolean }; stripe: { enabled: boolean; configured: boolean } }
const Payments = builder.objectRef<PaymentsShape>('ShopmePaymentSettings').implement({
  fields: (t) => ({
    bankTransfer: t.field({ type: ManualBank, resolve: (p) => p.bankTransfer }),
    cod: t.field({ type: ManualCod, resolve: (p) => p.cod }),
    stripe: t.field({ type: StripeSettings, resolve: (p) => p.stripe }),
  }),
});
const PaymentsInput = builder.inputType('ShopmePaymentSettingsInput', {
  fields: (t) => ({
    bankTransfer: t.field({ type: builder.inputType('ShopmeBankTransferInput', { fields: (u) => ({ enabled: u.boolean(), instructions: u.string() }) }) }),
    cod: t.field({ type: builder.inputType('ShopmeCodInput', { fields: (u) => ({ enabled: u.boolean() }) }) }),
    stripe: t.field({ type: builder.inputType('ShopmeStripeInput', { fields: (u) => ({ enabled: u.boolean() }) }) }),
  }),
});
const PaymentsPayload = definePayload<{ paymentSettings: PaymentsShape | null }>('ShopmePaymentSettingsUpdatePayload', (t) => ({ paymentSettings: t.field({ type: Payments, nullable: true, resolve: (p) => p.paymentSettings }) }));
const stripeConfigured = (ctx: GraphQLContext) => !!(ctx.app.config.stripe.secretKey && ctx.app.config.stripe.publishableKey);
const paymentsOf = async (ctx: GraphQLContext): Promise<PaymentsShape> => {
  const p = paymentSettingsOf(await shopOf(ctx));
  return { bankTransfer: p.manual.bankTransfer, cod: p.manual.cod, stripe: { enabled: p.stripe.enabled, configured: stripeConfigured(ctx) } };
};

/* ------------------------------ shipping zones ------------------------------ */

const RateType = builder.enumType('ShopmeShippingRateType', { values: ['FLAT', 'WEIGHT_BASED', 'PRICE_BASED', 'FREE'] as const });
interface RateShape extends ShippingRate { currency: string }
interface ZoneShape extends Omit<ShippingZone, 'rates'> { rates: RateShape[] }

const Rate = builder.objectRef<RateShape>('ShopmeShippingRate').implement({
  interfaces: [Node],
  fields: (t) => ({
    name: t.exposeString('name'),
    type: t.field({ type: RateType, resolve: (r) => r.type as 'FLAT' }),
    price: t.field({ type: MoneyV2, resolve: (r) => moneyV2(r.price, r.currency) }),
    minWeight: t.float({ nullable: true, description: 'Grams (weight based rates).', resolve: (r) => (r.type === 'WEIGHT_BASED' ? r.minValue : null) }),
    maxWeight: t.float({ nullable: true, resolve: (r) => (r.type === 'WEIGHT_BASED' ? r.maxValue : null) }),
    minSubtotal: t.field({ type: MoneyV2, nullable: true, resolve: (r) => (r.type === 'PRICE_BASED' && r.minValue != null ? moneyV2(r.minValue, r.currency) : null) }),
    maxSubtotal: t.field({ type: MoneyV2, nullable: true, resolve: (r) => (r.type === 'PRICE_BASED' && r.maxValue != null ? moneyV2(r.maxValue, r.currency) : null) }),
    active: t.exposeBoolean('active'),
    position: t.exposeInt('position'),
  }),
});
const ZoneCountry = builder.objectRef<{ countryCode: string; provinceCodes: string[] }>('ShopmeShippingZoneCountry').implement({
  fields: (t) => ({ countryCode: t.exposeString('countryCode', { description: "ISO code, or '*' for the rest of the world." }), provinceCodes: t.exposeStringList('provinceCodes') }),
});
const Zone = builder.objectRef<ZoneShape>('ShopmeShippingZone').implement({
  interfaces: [Node],
  fields: (t) => ({
    name: t.exposeString('name'),
    countries: t.field({ type: [ZoneCountry], resolve: (z) => z.countries }),
    rates: t.field({ type: [Rate], resolve: (z) => z.rates }),
  }),
});
const zoneOf = async (ctx: GraphQLContext, z: ShippingZone): Promise<ZoneShape> => { const currency = (await shopOf(ctx)).currency; return { ...z, rates: z.rates.map((r) => ({ ...r, currency })) }; };
registerNode('ShopmeShippingZone', async (ctx, id) => { const z = await getShippingZone(ctx.db, ctx.shopId, id); return z ? zoneOf(ctx, z) : null; });

const RateInput = builder.inputType('ShopmeShippingRateInput', {
  fields: (t) => ({
    name: t.string(), type: t.field({ type: RateType }), price: t.field({ type: 'Money' }), minWeight: t.float(), maxWeight: t.float(), minSubtotal: t.field({ type: 'Money' }), maxSubtotal: t.field({ type: 'Money' }), active: t.boolean(),
  }),
});
const ZoneInput = builder.inputType('ShopmeShippingZoneInput', {
  fields: (t) => ({
    name: t.string(),
    countries: t.field({ type: [builder.inputType('ShopmeShippingZoneCountryInput', { fields: (u) => ({ countryCode: u.string({ required: true }), provinceCodes: u.stringList() }) })] }),
    rates: t.field({ type: [RateInput], description: 'When given on update, replaces all rates of the zone.' }),
  }),
});

const toRate = (i: typeof RateInput.$inferInput, currency: string): ShippingRateInput | UserError => {
  try {
    const type = i.type ?? undefined;
    const weight = type === 'WEIGHT_BASED';
    return {
      name: i.name, type, active: i.active, price: i.price != null ? parseMoney(i.price, currency) : undefined,
      minValue: weight ? i.minWeight != null ? Math.round(i.minWeight) : null : i.minSubtotal != null ? parseMoney(i.minSubtotal, currency) : null,
      maxValue: weight ? i.maxWeight != null ? Math.round(i.maxWeight) : null : i.maxSubtotal != null ? parseMoney(i.maxSubtotal, currency) : null,
    };
  } catch { return { field: ['input'], message: 'Invalid money amount' }; }
};
const isErr = (x: ShippingRateInput | UserError): x is UserError => 'message' in x;

const ZonePayload = definePayload<{ zone: ZoneShape | null }>('ShopmeShippingZonePayload', (t) => ({ zone: t.field({ type: Zone, nullable: true, resolve: (p) => p.zone }) }));
const RatePayload = definePayload<{ rate: RateShape | null }>('ShopmeShippingRatePayload', (t) => ({ rate: t.field({ type: Rate, nullable: true, resolve: (p) => p.rate }) }));
const DeletePayload = <K extends string>(name: string, key: K) => definePayload<Record<K, string | null>>(name, (t) => ({ [key]: t.id({ nullable: true, resolve: (p) => p[key] }) }));
const ZoneDeletePayload = DeletePayload('ShopmeShippingZoneDeletePayload', 'deletedZoneId');
const RateDeletePayload = DeletePayload('ShopmeShippingRateDeletePayload', 'deletedRateId');

/* ------------------------------ tax rates ------------------------------ */

const Tax = builder.objectRef<TaxRate>('ShopmeTaxRate').implement({
  interfaces: [Node],
  fields: (t) => ({
    name: t.exposeString('name'), countryCode: t.exposeString('countryCode'), provinceCode: t.exposeString('provinceCode', { nullable: true }),
    rate: t.float({ description: 'Percent, e.g. 20 for 20%.', resolve: (r) => r.rate }),
    appliesToShipping: t.exposeBoolean('appliesToShipping'), priority: t.exposeInt('priority'), active: t.exposeBoolean('active'),
  }),
});
const TaxInput = builder.inputType('ShopmeTaxRateInput', {
  fields: (t) => ({ name: t.string(), countryCode: t.string(), provinceCode: t.string(), rate: t.float(), appliesToShipping: t.boolean(), priority: t.int(), active: t.boolean() }),
});
const TaxPayload = definePayload<{ taxRate: TaxRate | null }>('ShopmeTaxRatePayload', (t) => ({ taxRate: t.field({ type: Tax, nullable: true, resolve: (p) => p.taxRate }) }));
const TaxDeletePayload = DeletePayload('ShopmeTaxRateDeletePayload', 'deletedTaxRateId');

/* ------------------------------ root fields ------------------------------ */

const gidId = (raw: string | number, type: string) => parseId(String(raw), type);
const notFound = (what: string, field: string[]): UserError[] => [{ field, message: `${what} does not exist` }];

builder.queryFields((t) => ({
  shopmePaymentSettings: t.field({ type: Payments, resolve: (_r, _a, ctx) => { requireScope(ctx, 'read_shop'); return paymentsOf(ctx); } }),
  shippingZones: t.field({
    type: [Zone], resolve: async (_r, _a, ctx) => { requireScope(ctx, 'read_shipping'); return Promise.all((await listShippingZones(ctx.db, ctx.shopId)).map((z) => zoneOf(ctx, z))); },
  }),
  shippingZone: t.field({
    type: Zone, nullable: true, args: { id: t.arg.id({ required: true }) },
    resolve: async (_r, a, ctx) => { requireScope(ctx, 'read_shipping'); const id = gidId(a.id, 'ShopmeShippingZone'); const z = id ? await getShippingZone(ctx.db, ctx.shopId, id) : null; return z ? zoneOf(ctx, z) : null; },
  }),
  taxRates: t.field({ type: [Tax], resolve: (_r, _a, ctx) => { requireScope(ctx, 'read_shipping'); return listTaxRates(ctx.db, ctx.shopId); } }),
  staffMembers: t.field({
    type: StaffMemberConnection, args: ConnectionArgs,
    resolve: async (_r, a, ctx) => { requireScope(ctx, 'read_users'); const all = await listStaff(ctx.db, ctx.shopId); return paginateArray(a, a.reverse ? all.reverse() : all); },
  }),
}));

builder.mutationFields((t) => ({
  shopmeShopUpdate: t.field({
    type: ShopUpdatePayload, args: { input: t.arg({ type: ShopInput, required: true }) },
    resolve: async (_r, { input: i }, ctx) => {
      requireScope(ctx, 'write_shop');
      const r = await updateShopSettings(ctx.db, ctx.shopId, {
        name: i.name, email: i.email, description: i.description, currency: i.currencyCode, timezone: i.ianaTimezone, weightUnit: i.weightUnit as string | null | undefined, locale: i.locale,
        address: i.address ? { ...i.address, countryCode: i.address.countryCode ?? undefined } : undefined, moneyFormat: i.moneyFormat, moneyWithCurrencyFormat: i.moneyWithCurrencyFormat,
        taxesIncluded: i.taxesIncluded, taxShipping: i.taxShipping, storefrontPasswordEnabled: i.storefrontPasswordEnabled, storefrontPassword: i.storefrontPassword,
        storefrontPasswordMessage: i.storefrontPasswordMessage, primaryDomain: i.primaryDomain,
      }, staffId(ctx));
      return r.ok ? { shop: r.value, userErrors: [] } : { shop: null, userErrors: r.errors.map((e) => ({ ...e, field: ['input', ...(e.field ?? [])] })) };
    },
  }),
  shopmePaymentSettingsUpdate: t.field({
    type: PaymentsPayload, args: { input: t.arg({ type: PaymentsInput, required: true }) },
    resolve: async (_r, { input }, ctx) => {
      requireScope(ctx, 'write_shop');
      const r = await updatePaymentSettings(ctx.db, ctx.shopId, input, stripeConfigured(ctx));
      return r.ok ? { paymentSettings: await paymentsOf(ctx), userErrors: [] } : { paymentSettings: null, userErrors: r.errors.map((e) => ({ ...e, field: ['input', ...(e.field ?? [])] })) };
    },
  }),

  shippingZoneCreate: t.field({
    type: ZonePayload, args: { input: t.arg({ type: ZoneInput, required: true }) },
    resolve: async (_r, { input }, ctx) => {
      requireScope(ctx, 'write_shipping');
      const currency = (await shopOf(ctx)).currency;
      const rates = (input.rates ?? []).map((r) => toRate(r, currency));
      const bad = rates.find(isErr);
      if (bad) return { zone: null, userErrors: [{ ...bad, field: ['input', 'rates'] }] };
      const r = await createShippingZone(ctx.db, ctx.shopId, { name: input.name, countries: input.countries, rates: rates as ShippingRateInput[] });
      return r.ok ? { zone: await zoneOf(ctx, r.value), userErrors: [] } : { zone: null, userErrors: r.errors.map((e) => ({ ...e, field: ['input', ...(e.field ?? [])] })) };
    },
  }),
  shippingZoneUpdate: t.field({
    type: ZonePayload, args: { id: t.arg.id({ required: true }), input: t.arg({ type: ZoneInput, required: true }) },
    resolve: async (_r, { id: raw, input }, ctx) => {
      requireScope(ctx, 'write_shipping');
      const id = gidId(raw, 'ShopmeShippingZone');
      if (!id) return { zone: null, userErrors: notFound('Shipping zone', ['id']) };
      const currency = (await shopOf(ctx)).currency;
      const rates = input.rates?.map((r) => toRate(r, currency));
      const bad = rates?.find(isErr);
      if (bad) return { zone: null, userErrors: [{ ...bad, field: ['input', 'rates'] }] };
      const r = await updateShippingZone(ctx.db, ctx.shopId, id, { name: input.name, countries: input.countries, rates: rates as ShippingRateInput[] | undefined });
      return r.ok ? { zone: await zoneOf(ctx, r.value), userErrors: [] } : { zone: null, userErrors: r.errors };
    },
  }),
  shippingZoneDelete: t.field({
    type: ZoneDeletePayload, args: { id: t.arg.id({ required: true }) },
    resolve: async (_r, a, ctx) => {
      requireScope(ctx, 'write_shipping');
      const id = gidId(a.id, 'ShopmeShippingZone');
      const r = id ? await deleteShippingZone(ctx.db, ctx.shopId, id) : null;
      return r?.ok ? { deletedZoneId: toGid('ShopmeShippingZone', id!), userErrors: [] } : { deletedZoneId: null, userErrors: notFound('Shipping zone', ['id']) };
    },
  }),
  shippingRateCreate: t.field({
    type: RatePayload, args: { zoneId: t.arg.id({ required: true }), input: t.arg({ type: RateInput, required: true }) },
    resolve: async (_r, a, ctx) => {
      requireScope(ctx, 'write_shipping');
      const zid = gidId(a.zoneId, 'ShopmeShippingZone');
      if (!zid) return { rate: null, userErrors: notFound('Shipping zone', ['zoneId']) };
      const currency = (await shopOf(ctx)).currency;
      const i = toRate(a.input, currency);
      if (isErr(i)) return { rate: null, userErrors: [i] };
      const r = await createShippingRate(ctx.db, ctx.shopId, zid, i);
      return r.ok ? { rate: { ...r.value, currency }, userErrors: [] } : { rate: null, userErrors: r.errors.map((e) => ({ ...e, field: ['input', ...(e.field ?? [])] })) };
    },
  }),
  shippingRateUpdate: t.field({
    type: RatePayload, args: { id: t.arg.id({ required: true }), input: t.arg({ type: RateInput, required: true }) },
    resolve: async (_r, a, ctx) => {
      requireScope(ctx, 'write_shipping');
      const id = gidId(a.id, 'ShopmeShippingRate');
      if (!id) return { rate: null, userErrors: notFound('Shipping rate', ['id']) };
      const currency = (await shopOf(ctx)).currency;
      const cur = await getShippingRate(ctx.db, ctx.shopId, id);
      const i = toRate({ ...a.input, type: a.input.type ?? (cur?.type as 'FLAT' | undefined) }, currency);
      if (isErr(i)) return { rate: null, userErrors: [i] };
      const r = await updateShippingRate(ctx.db, ctx.shopId, id, i);
      return r.ok ? { rate: { ...r.value, currency }, userErrors: [] } : { rate: null, userErrors: r.errors.map((e) => ({ ...e, field: e.field?.[0] === 'id' ? e.field : ['input', ...(e.field ?? [])] })) };
    },
  }),
  shippingRateDelete: t.field({
    type: RateDeletePayload, args: { id: t.arg.id({ required: true }) },
    resolve: async (_r, a, ctx) => {
      requireScope(ctx, 'write_shipping');
      const id = gidId(a.id, 'ShopmeShippingRate');
      const r = id ? await deleteShippingRate(ctx.db, ctx.shopId, id) : null;
      return r?.ok ? { deletedRateId: toGid('ShopmeShippingRate', id!), userErrors: [] } : { deletedRateId: null, userErrors: notFound('Shipping rate', ['id']) };
    },
  }),

  taxRateCreate: t.field({
    type: TaxPayload, args: { input: t.arg({ type: TaxInput, required: true }) },
    resolve: async (_r, { input }, ctx) => {
      requireScope(ctx, 'write_shipping');
      const r = await createTaxRate(ctx.db, ctx.shopId, input);
      return r.ok ? { taxRate: r.value, userErrors: [] } : { taxRate: null, userErrors: r.errors.map((e) => ({ ...e, field: ['input', ...(e.field ?? [])] })) };
    },
  }),
  taxRateUpdate: t.field({
    type: TaxPayload, args: { id: t.arg.id({ required: true }), input: t.arg({ type: TaxInput, required: true }) },
    resolve: async (_r, a, ctx) => {
      requireScope(ctx, 'write_shipping');
      const id = gidId(a.id, 'ShopmeTaxRate');
      const r = id ? await updateTaxRate(ctx.db, ctx.shopId, id, a.input) : null;
      if (!r) return { taxRate: null, userErrors: notFound('Tax rate', ['id']) };
      return r.ok ? { taxRate: r.value, userErrors: [] } : { taxRate: null, userErrors: r.errors.map((e) => ({ ...e, field: e.field?.[0] === 'id' ? e.field : ['input', ...(e.field ?? [])] })) };
    },
  }),
  taxRateDelete: t.field({
    type: TaxDeletePayload, args: { id: t.arg.id({ required: true }) },
    resolve: async (_r, a, ctx) => {
      requireScope(ctx, 'write_shipping');
      const id = gidId(a.id, 'ShopmeTaxRate');
      const r = id ? await deleteTaxRate(ctx.db, ctx.shopId, id) : null;
      return r?.ok ? { deletedTaxRateId: toGid('ShopmeTaxRate', id!), userErrors: [] } : { deletedTaxRateId: null, userErrors: notFound('Tax rate', ['id']) };
    },
  }),
}));

void getTaxRate;
