import {
  accountUrlOf, builtinRegions, customerAccountsSettingsOf, DATA_SALE_OPT_OUT_US_STATES, CONSENT_REQUIRED_COUNTRIES, getCustomer, inviteCustomer, listConsentPolicies,
  optOutOfDataSale, policiesOf, privacySettingsOf, updateCustomerAccountsSettings, updateEmailMarketingConsent, updatePrivacySettings, updateSmsMarketingConsent, upsertConsentPolicies,
  EMAIL_MARKETING_STATES, MARKETING_OPT_IN_LEVELS, sendNotification,
  type AccountsMode, type ConsentPolicyRow, type Customer, type CustomerAccountsSettings, type PrivacySettings,
} from '@shopme/core';
import { parseId, type UserError } from '@shopme/shopify-compat';
import { builder } from '../builder';
import { requireScope, type GraphQLContext } from '../context';
import { DisplayableError, definePayload } from '../types/errors';
import { shopOf } from '../types/catalog';
import { COUNTRY_CODES, Customer_ } from '../types/sales';
import { Shop } from './shop';

/**
 * Customer accounts settings, customer privacy (consent policies, cookie banner, data-sale opt-out, marketing consent) and the
 * account invite helpers. Shopify names are kept where the reference API has them; ShopMe additions start with `shopme`.
 */

const codeErrors = <T extends string>(allowed: readonly T[], e: UserError): T | null => (e.code && (allowed as readonly string[]).includes(e.code) ? (e.code as T) : null);

/* ------------------------------ customer accounts ------------------------------ */

const AccountsSetting = builder.enumType('ShopCustomerAccountsSetting', { values: ['DISABLED', 'OPTIONAL', 'REQUIRED'] as const });
const AccountsVersion = builder.enumType('CustomerAccountsVersion', { values: ['CLASSIC', 'NEW_CUSTOMER_ACCOUNTS'] as const });
const AccountsV2 = builder.objectRef<{ settings: CustomerAccountsSettings; url: string }>('CustomerAccountsV2').implement({
  fields: (t) => ({
    customerAccountsVersion: t.field({ type: AccountsVersion, resolve: () => 'NEW_CUSTOMER_ACCOUNTS' as const }),
    loginLinksVisibleOnStorefrontAndCheckout: t.boolean({ resolve: (a) => a.settings.loginLinksVisible }),
    loginRequiredAtCheckout: t.boolean({ resolve: (a) => a.settings.mode === 'REQUIRED' }),
    url: t.field({ type: 'URL', resolve: (a) => a.url }),
  }),
});
const absolute = (ctx: GraphQLContext, shop: Parameters<typeof accountUrlOf>[0]) => {
  const u = accountUrlOf(shop);
  return /^https?:/.test(u) ? u : `${ctx.app.config.appUrl.replace(/\/$/, '')}${u}`;
};
builder.objectFields(Shop, (t) => ({
  customerAccounts: t.field({ type: AccountsSetting, resolve: (s) => customerAccountsSettingsOf(s).mode }),
  customerAccountsV2: t.field({ type: AccountsV2, resolve: (s, _a, ctx) => ({ settings: customerAccountsSettingsOf(s), url: absolute(ctx, s) }) }),
}));

const SignIn = builder.objectRef<CustomerAccountsSettings['signIn']>('ShopmeCustomerAccountsSignIn').implement({ fields: (t) => ({ password: t.exposeBoolean('password'), emailCode: t.exposeBoolean('emailCode') }) });
const OrderActions = builder.objectRef<CustomerAccountsSettings['orderActions']>('ShopmeCustomerAccountsOrderActions').implement({
  fields: (t) => ({ reorder: t.exposeBoolean('reorder'), returns: t.exposeBoolean('returns'), cancellations: t.exposeBoolean('cancellations'), cancellationWindowHours: t.exposeInt('cancellationWindowHours') }),
});
const AccountsSettings = builder.objectRef<CustomerAccountsSettings & { accountUrl: string }>('ShopmeCustomerAccountsSettings').implement({
  fields: (t) => ({
    mode: t.field({ type: AccountsSetting, resolve: (s) => s.mode }), loginLinksVisible: t.exposeBoolean('loginLinksVisible'), signIn: t.field({ type: SignIn, resolve: (s) => s.signIn }),
    orderActions: t.field({ type: OrderActions, resolve: (s) => s.orderActions }), storeCredit: t.exposeBoolean('storeCredit', { description: 'Customers can see and spend their store credit.' }),
    url: t.string({ nullable: true, resolve: (s) => s.url }), accountUrl: t.exposeString('accountUrl', { description: 'The full URL customers use to reach their account.' }),
  }),
});
const SignInInput = builder.inputType('ShopmeCustomerAccountsSignInInput', { fields: (t) => ({ password: t.boolean(), emailCode: t.boolean() }) });
const OrderActionsInput = builder.inputType('ShopmeCustomerAccountsOrderActionsInput', { fields: (t) => ({ reorder: t.boolean(), returns: t.boolean(), cancellations: t.boolean(), cancellationWindowHours: t.int() }) });
const AccountsInput = builder.inputType('ShopmeCustomerAccountsSettingsInput', {
  fields: (t) => ({
    mode: t.field({ type: AccountsSetting }), loginLinksVisible: t.boolean(), signIn: t.field({ type: SignInInput }), orderActions: t.field({ type: OrderActionsInput }), storeCredit: t.boolean(),
    url: t.string({ description: 'Empty clears the custom URL.' }),
  }),
});
const AccountsPayload = definePayload<{ settings: (CustomerAccountsSettings & { accountUrl: string }) | null }>('ShopmeCustomerAccountsSettingsUpdatePayload', (t) => ({ settings: t.field({ type: AccountsSettings, nullable: true, resolve: (p) => p.settings }) }));

builder.queryFields((t) => ({
  shopmeCustomerAccountsSettings: t.field({
    type: AccountsSettings,
    resolve: async (_r, _a, ctx) => { requireScope(ctx, 'read_shop'); const shop = await shopOf(ctx); return { ...customerAccountsSettingsOf(shop), accountUrl: absolute(ctx, shop) }; },
  }),
}));
builder.mutationFields((t) => ({
  shopmeCustomerAccountsSettingsUpdate: t.field({
    type: AccountsPayload, args: { input: t.arg({ type: AccountsInput, required: true }) },
    resolve: async (_r, { input }, ctx) => {
      requireScope(ctx, 'write_shop');
      const shop = await shopOf(ctx);
      const r = await updateCustomerAccountsSettings(ctx.db, shop, {
        mode: (input.mode ?? undefined) as AccountsMode | undefined, loginLinksVisible: input.loginLinksVisible, signIn: input.signIn, orderActions: input.orderActions, storeCredit: input.storeCredit, url: input.url,
      });
      if (!r.ok) return { settings: null, userErrors: r.errors.map((e) => ({ ...e, field: ['input', ...(e.field ?? [])] })) };
      return { settings: { ...r.value, accountUrl: absolute(ctx, { settings: { ...shop.settings, customerAccounts: { url: r.value.url } } }) }, userErrors: [] };
    },
  }),

  /** Account invites: an activation link, or the invite email from the `customer_account_invite` template. */
  customerGenerateAccountActivationUrl: t.field({
    type: definePayload<{ accountActivationUrl: string | null }>('CustomerGenerateAccountActivationUrlPayload', (f) => ({ accountActivationUrl: f.field({ type: 'URL', nullable: true, resolve: (p) => p.accountActivationUrl }) })),
    args: { customerId: t.arg.id({ required: true }) },
    resolve: async (_r, a, ctx) => {
      requireScope(ctx, 'write_customers');
      const id = parseId(String(a.customerId), 'Customer');
      const r = id ? await inviteCustomer(ctx.db, ctx.shopId, id) : null;
      if (!r?.ok) return { accountActivationUrl: null, userErrors: r ? r.errors : [{ field: ['customerId'], message: 'Customer does not exist' }] };
      return { accountActivationUrl: `${ctx.app.config.appUrl.replace(/\/$/, '')}/account/activate/${r.value.customer.id}/${r.value.token}`, userErrors: [] };
    },
  }),
  customerSendAccountInviteEmail: t.field({
    type: definePayload<{ customer: Customer | null }>('CustomerSendAccountInviteEmailPayload', (f) => ({ customer: f.field({ type: Customer_, nullable: true, resolve: (p) => p.customer }) })),
    args: { customerId: t.arg.id({ required: true }), email: t.arg({ type: 'EmailInput' as never }) },
    resolve: async (_r, a, ctx) => {
      requireScope(ctx, 'write_customers');
      const id = parseId(String(a.customerId), 'Customer');
      const r = id ? await inviteCustomer(ctx.db, ctx.shopId, id) : null;
      if (!r?.ok) return { customer: null, userErrors: r ? r.errors : [{ field: ['customerId'], message: 'Customer does not exist' }] };
      const shop = await shopOf(ctx);
      const url = `${ctx.app.config.appUrl.replace(/\/$/, '')}/account/activate/${r.value.customer.id}/${r.value.token}`;
      if (r.value.customer.email) await sendNotification(ctx.db, ctx.app.mailer, shop, ctx.app.config.appUrl, 'customer_account_invite', r.value.customer.email, { customer: { first_name: r.value.customer.firstName ?? '', email: r.value.customer.email }, activation_url: url }, { force: true });
      return { customer: r.value.customer, userErrors: [] };
    },
  }),
}));

/* ------------------------------ privacy: consent policies ------------------------------ */

const PrivacyCountryCode = builder.enumType('PrivacyCountryCode', { values: [...COUNTRY_CODES] as [string, ...string[]] });
interface PolicyShape { id: string; countryCode: string | null; regionCode: string | null; consentRequired: boolean; dataSaleOptOutRequired: boolean; shopId: number }
const ConsentPolicy = builder.objectRef<PolicyShape>('ConsentPolicy').implement({
  fields: (t) => ({
    id: t.id({ resolve: (p) => `gid://shopify/ConsentPolicy/${p.id}` }), shopId: t.id({ resolve: (p) => `gid://shopify/Shop/${p.shopId}` }),
    countryCode: t.field({ type: PrivacyCountryCode, nullable: true, resolve: (p) => (p.countryCode && COUNTRY_CODES.has(p.countryCode) ? p.countryCode : null) }),
    regionCode: t.exposeString('regionCode', { nullable: true }),
    consentRequired: t.exposeBoolean('consentRequired'), dataSaleOptOutRequired: t.exposeBoolean('dataSaleOptOutRequired'),
  }),
});
const ConsentPolicyRegion = builder.objectRef<{ countryCode: string; regionCode: string | null }>('ConsentPolicyRegion').implement({
  fields: (t) => ({ countryCode: t.field({ type: PrivacyCountryCode, resolve: (r) => r.countryCode }), regionCode: t.exposeString('regionCode', { nullable: true }) }),
});

/** Policies in force: the merchant's rows in manual mode, else the rows the built-in table stands for. */
async function effectivePolicies(ctx: GraphQLContext): Promise<PolicyShape[]> {
  const shop = await shopOf(ctx);
  if (privacySettingsOf(shop).mode === 'MANUAL') return (await listConsentPolicies(ctx.db, ctx.shopId)).map((r: ConsentPolicyRow) => ({ ...r, id: String(r.id) }));
  return [
    ...CONSENT_REQUIRED_COUNTRIES.map((c) => ({ id: c, shopId: shop.id, countryCode: c, regionCode: null, consentRequired: true, dataSaleOptOutRequired: false })),
    ...DATA_SALE_OPT_OUT_US_STATES.map((r) => ({ id: `US-${r}`, shopId: shop.id, countryCode: 'US', regionCode: r, consentRequired: false, dataSaleOptOutRequired: true })),
  ];
}

const ConsentPolicyInput = builder.inputType('ConsentPolicyInput', {
  fields: (t) => ({ countryCode: t.field({ type: PrivacyCountryCode }), regionCode: t.string(), consentRequired: t.boolean(), dataSaleOptOutRequired: t.boolean() }),
});
const POLICY_CODES = ['COUNTRY_CODE_REQUIRED', 'REGION_CODE_REQUIRED', 'REGION_CODE_MUST_MATCH_COUNTRY_CODE', 'SHOPIFY_COOKIE_BANNER_NOT_DISABLED', 'UNSUPORTED_CONSENT_POLICY'] as const;
const PolicyCode = builder.enumType('ConsentPolicyErrorCode', { values: POLICY_CODES });
const ConsentPolicyError = builder.objectRef<UserError>('ConsentPolicyError').implement({
  interfaces: [DisplayableError], fields: (t) => ({ code: t.field({ type: PolicyCode, nullable: true, resolve: (e) => codeErrors(POLICY_CODES, e) }) }),
});
const PolicyUpdatePayload = builder.objectRef<{ updatedPolicies: PolicyShape[] | null; userErrors: UserError[] }>('ConsentPolicyUpdatePayload').implement({
  fields: (t) => ({
    updatedPolicies: t.field({ type: [ConsentPolicy], nullable: true, resolve: (p) => p.updatedPolicies }), userErrors: t.field({ type: [ConsentPolicyError], resolve: (p) => p.userErrors }),
  }),
});

/* ------------------------------ privacy settings ------------------------------ */

const Features = builder.enumType('PrivacyFeaturesEnum', { values: ['COOKIE_BANNER', 'DATA_SALE_OPT_OUT_PAGE', 'PRIVACY_POLICY'] as const });
const PrivacyBanner = builder.objectRef<{ enabled: boolean; autoManaged: boolean }>('PrivacyCookieBanner').implement({
  fields: (t) => ({ enabled: t.exposeBoolean('enabled'), autoManaged: t.exposeBoolean('autoManaged'), translations: t.stringList({ resolve: () => [] }) }),
});
const PrivacyOptOutPage = builder.objectRef<{ autoManaged: boolean }>('PrivacyDataSaleOptOutPage').implement({ fields: (t) => ({ autoManaged: t.exposeBoolean('autoManaged') }) });
const PrivacyPolicyInfo = builder.objectRef<{ autoManaged: boolean; locales: string[] }>('PrivacyPolicyInfo').implement({
  fields: (t) => ({ autoManaged: t.exposeBoolean('autoManaged'), supportedLocales: t.exposeStringList('locales') }),
});
const PrivacySettingsType = builder.objectRef<{ s: PrivacySettings; policyWritten: boolean; locale: string }>('PrivacySettings').implement({
  fields: (t) => ({
    banner: t.field({ type: PrivacyBanner, resolve: (p) => ({ enabled: p.s.cookieBanner.mode !== 'OFF', autoManaged: p.s.cookieBanner.mode === 'AUTO' && p.s.mode === 'AUTO' }) }),
    dataSaleOptOutPage: t.field({ type: PrivacyOptOutPage, resolve: (p) => ({ autoManaged: p.s.dataSaleOptOutPage === 'AUTO' }) }),
    privacyPolicy: t.field({ type: PrivacyPolicyInfo, resolve: (p) => ({ autoManaged: !p.policyWritten, locales: [p.locale] }) }),
  }),
});
const FeaturesPayload = definePayload<{ featuresDisabled: ('COOKIE_BANNER' | 'DATA_SALE_OPT_OUT_PAGE' | 'PRIVACY_POLICY')[] | null }>('PrivacyFeaturesDisablePayload', (t) => ({
  featuresDisabled: t.field({ type: [Features], nullable: true, resolve: (p) => p.featuresDisabled }),
}));
const OPT_OUT_CODES = ['FAILED'] as const;
const OptOutError = builder.objectRef<UserError>('DataSaleOptOutUserError').implement({
  interfaces: [DisplayableError], fields: (t) => ({ code: t.field({ type: builder.enumType('DataSaleOptOutUserErrorCode', { values: OPT_OUT_CODES }), nullable: true, resolve: (e) => codeErrors(OPT_OUT_CODES, e) }) }),
});
const OptOutPayload = builder.objectRef<{ customerId: string | null; userErrors: UserError[] }>('DataSaleOptOutPayload').implement({
  fields: (t) => ({ customerId: t.id({ nullable: true, resolve: (p) => p.customerId }), userErrors: t.field({ type: [OptOutError], resolve: (p) => p.userErrors }) }),
});

builder.objectFields(Customer_, (t) => ({
  dataSaleOptOut: t.boolean({ description: 'The customer opted out of the sale and sharing of their data.', resolve: (c) => c.dataSaleOptOut }),
}));

// ShopMe: the full privacy settings page.
const BannerModeEnum = builder.enumType('ShopmeCookieBannerMode', { values: ['AUTO', 'ALWAYS', 'OFF'] as const });
const BannerPositionEnum = builder.enumType('ShopmeCookieBannerPosition', { values: ['bottom', 'left', 'right'] as const });
const PrivacyModeEnum = builder.enumType('ShopmePrivacyMode', { values: ['AUTO', 'MANUAL'] as const });
const OptOutPageEnum = builder.enumType('ShopmeDataSaleOptOutPageMode', { values: ['AUTO', 'OFF'] as const });
const BannerSettings = builder.objectRef<PrivacySettings['cookieBanner']>('ShopmeCookieBannerSettings').implement({
  fields: (t) => ({ mode: t.field({ type: BannerModeEnum, resolve: (b) => b.mode }), message: t.exposeString('message'), position: t.field({ type: BannerPositionEnum, resolve: (b) => b.position }) }),
});
interface RegionsShape { consentRequired: string[]; notice: string[]; dataSaleOptOutUsStates: string[]; reviewedAt: string }
const Regions = builder.objectRef<RegionsShape>('ShopmePrivacyRegions').implement({
  description: 'The built-in region table (data to review on each release, not legal advice).',
  fields: (t) => ({ consentRequired: t.exposeStringList('consentRequired'), notice: t.exposeStringList('notice'), dataSaleOptOutUsStates: t.exposeStringList('dataSaleOptOutUsStates'), reviewedAt: t.exposeString('reviewedAt') }),
});
interface PrivacyPage { s: PrivacySettings; locale: string; hasPrivacyPolicy: boolean; storage: string }
const PrivacyPageType = builder.objectRef<PrivacyPage>('ShopmePrivacySettings').implement({
  fields: (t) => ({
    mode: t.field({ type: PrivacyModeEnum, resolve: (p) => p.s.mode }), cookieBanner: t.field({ type: BannerSettings, resolve: (p) => p.s.cookieBanner }),
    dataSaleOptOutPage: t.field({ type: OptOutPageEnum, resolve: (p) => p.s.dataSaleOptOutPage }), doubleOptIn: t.boolean({ resolve: (p) => p.s.doubleOptIn }),
    hasPrivacyPolicy: t.exposeBoolean('hasPrivacyPolicy'), regions: t.field({ type: Regions, resolve: () => builtinRegions() }), storageLocation: t.exposeString('storage'),
  }),
});
const BannerInput = builder.inputType('ShopmeCookieBannerSettingsInput', { fields: (t) => ({ mode: t.field({ type: BannerModeEnum }), message: t.string(), position: t.field({ type: BannerPositionEnum }) }) });
const PrivacyInput = builder.inputType('ShopmePrivacySettingsInput', {
  fields: (t) => ({ mode: t.field({ type: PrivacyModeEnum }), cookieBanner: t.field({ type: BannerInput }), dataSaleOptOutPage: t.field({ type: OptOutPageEnum }), doubleOptIn: t.boolean() }),
});
const PrivacyPagePayload = definePayload<{ settings: PrivacyPage | null }>('ShopmePrivacySettingsUpdatePayload', (t) => ({ settings: t.field({ type: PrivacyPageType, nullable: true, resolve: (p) => p.settings }) }));
const pageOf = async (ctx: GraphQLContext): Promise<PrivacyPage> => {
  const shop = await shopOf(ctx);
  return { s: privacySettingsOf(shop), locale: shop.locale, hasPrivacyPolicy: !!policiesOf(shop).find((p) => p.type === 'PRIVACY_POLICY')?.body.trim(), storage: ctx.app.config.dataDir ? 'Self-hosted' : 'Self-hosted' };
};

builder.queryFields((t) => ({
  privacySettings: t.field({
    type: PrivacySettingsType,
    resolve: async (_r, _a, ctx) => {
      requireScope(ctx, 'read_privacy_settings');
      const shop = await shopOf(ctx);
      return { s: privacySettingsOf(shop), policyWritten: !!policiesOf(shop).find((p) => p.type === 'PRIVACY_POLICY')?.body.trim(), locale: shop.locale };
    },
  }),
  consentPolicy: t.field({
    type: [ConsentPolicy], args: { id: t.arg.id(), countryCode: t.arg({ type: PrivacyCountryCode }), regionCode: t.arg.string(), consentRequired: t.arg.boolean(), dataSaleOptOutRequired: t.arg.boolean() },
    resolve: async (_r, a, ctx) => {
      requireScope(ctx, 'read_privacy_settings');
      return (await effectivePolicies(ctx)).filter((p) => (a.id == null || `gid://shopify/ConsentPolicy/${p.id}` === String(a.id)) && (a.countryCode == null || p.countryCode === a.countryCode)
        && (a.regionCode == null || p.regionCode === a.regionCode) && (a.consentRequired == null || p.consentRequired === a.consentRequired) && (a.dataSaleOptOutRequired == null || p.dataSaleOptOutRequired === a.dataSaleOptOutRequired));
    },
  }),
  consentPolicyRegions: t.field({
    type: [ConsentPolicyRegion],
    resolve: async (_r, _a, ctx) => { requireScope(ctx, 'read_privacy_settings'); return (await effectivePolicies(ctx)).flatMap((p) => (p.countryCode ? [{ countryCode: p.countryCode, regionCode: p.regionCode }] : [])); },
  }),
  shopmePrivacySettings: t.field({ type: PrivacyPageType, resolve: async (_r, _a, ctx) => { requireScope(ctx, 'read_privacy_settings'); return pageOf(ctx); } }),
}));

builder.mutationFields((t) => ({
  consentPolicyUpdate: t.field({
    type: PolicyUpdatePayload, args: { consentPolicies: t.arg({ type: [ConsentPolicyInput], required: true }) },
    resolve: async (_r, a, ctx) => {
      requireScope(ctx, 'write_privacy_settings');
      const shop = await shopOf(ctx);
      const r = await upsertConsentPolicies(ctx.db, shop, a.consentPolicies.map((p) => ({ countryCode: p.countryCode, regionCode: p.regionCode, consentRequired: !!p.consentRequired, dataSaleOptOutRequired: !!p.dataSaleOptOutRequired })));
      return r.ok ? { updatedPolicies: r.value.map((p) => ({ ...p, id: String(p.id) })), userErrors: [] } : { updatedPolicies: null, userErrors: r.errors };
    },
  }),
  /** ShopMe extension: the manual consent rules as the merchant edits them (the list replaces the previous one). */
  shopmeConsentPoliciesReplace: t.field({
    type: PolicyUpdatePayload, args: { consentPolicies: t.arg({ type: [ConsentPolicyInput], required: true }) },
    resolve: async (_r, a, ctx) => {
      requireScope(ctx, 'write_privacy_settings');
      const r = await upsertConsentPolicies(ctx.db, await shopOf(ctx), a.consentPolicies.map((p) => ({ countryCode: p.countryCode, regionCode: p.regionCode, consentRequired: !!p.consentRequired, dataSaleOptOutRequired: !!p.dataSaleOptOutRequired })), { replace: true });
      return r.ok ? { updatedPolicies: r.value.map((p) => ({ ...p, id: String(p.id) })), userErrors: [] } : { updatedPolicies: null, userErrors: r.errors };
    },
  }),
  privacyFeaturesDisable: t.field({
    type: FeaturesPayload, args: { featuresToDisable: t.arg({ type: [Features], required: true }) },
    resolve: async (_r, a, ctx) => {
      requireScope(ctx, 'write_privacy_settings');
      const shop = await shopOf(ctx);
      const off = new Set(a.featuresToDisable);
      await updatePrivacySettings(ctx.db, shop, { cookieBanner: off.has('COOKIE_BANNER') ? { mode: 'OFF' } : undefined, dataSaleOptOutPage: off.has('DATA_SALE_OPT_OUT_PAGE') ? 'OFF' : undefined });
      return { featuresDisabled: [...off], userErrors: [] };
    },
  }),
  dataSaleOptOut: t.field({
    type: OptOutPayload, args: { email: t.arg.string({ required: true }) },
    resolve: async (_r, a, ctx) => {
      requireScope(ctx, 'write_privacy_settings');
      const r = await optOutOfDataSale(ctx.db, ctx.shopId, a.email);
      return r.ok ? { customerId: `gid://shopify/Customer/${r.value.customerId}`, userErrors: [] } : { customerId: null, userErrors: r.errors.map((e) => ({ ...e, code: 'FAILED' })) };
    },
  }),
  shopmePrivacySettingsUpdate: t.field({
    type: PrivacyPagePayload, args: { input: t.arg({ type: PrivacyInput, required: true }) },
    resolve: async (_r, { input }, ctx) => {
      requireScope(ctx, 'write_privacy_settings');
      const shop = await shopOf(ctx);
      const r = await updatePrivacySettings(ctx.db, shop, {
        mode: input.mode, dataSaleOptOutPage: input.dataSaleOptOutPage, doubleOptIn: input.doubleOptIn,
        cookieBanner: input.cookieBanner ? { mode: input.cookieBanner.mode, message: input.cookieBanner.message, position: input.cookieBanner.position } : undefined,
      });
      return r.ok ? { settings: await pageOf(ctx), userErrors: [] } : { settings: null, userErrors: r.errors.map((e) => ({ ...e, field: ['input', ...(e.field ?? [])] })) };
    },
  }),
}));

/* ------------------------------ marketing consent ------------------------------ */

const EmailState = builder.enumType('CustomerEmailMarketingState', { values: EMAIL_MARKETING_STATES });
const SmsState = 'CustomerSmsMarketingState' as never;
const OptInLevel = builder.enumType('CustomerMarketingOptInLevel', { values: MARKETING_OPT_IN_LEVELS });
builder.enumType('CustomerConsentCollectedFrom', { values: ['SHOPIFY', 'OTHER'] as const });
const EmailConsentInput = builder.inputType('CustomerEmailMarketingConsentUpdateInput', {
  fields: (t) => ({ customerId: t.id({ required: true }), emailMarketingConsent: t.field({ type: builder.inputType('CustomerEmailMarketingConsentInputV2', { fields: (f) => ({ marketingState: f.field({ type: EmailState, required: true }), marketingOptInLevel: f.field({ type: OptInLevel }), consentUpdatedAt: f.field({ type: 'DateTime' }) }) }), required: true }) }),
});
const SmsConsentInput = builder.inputType('CustomerSmsMarketingConsentUpdateInput', {
  fields: (t) => ({
    customerId: t.id({ required: true }),
    smsMarketingConsent: t.field({
      type: builder.inputType('CustomerSmsMarketingConsentInput', { fields: (f) => ({ marketingState: f.field({ type: SmsState, required: true }), marketingOptInLevel: f.field({ type: OptInLevel }), consentUpdatedAt: f.field({ type: 'DateTime' }) }) }), required: true,
    }),
  }),
});
const CONSENT_CODES = ['INVALID', 'INCLUSION', 'INTERNAL_ERROR', 'MISSING_ARGUMENT'] as const;
const ConsentCode = builder.enumType('CustomerMarketingConsentUpdateUserErrorCode', { values: CONSENT_CODES });
const ConsentUserError = builder.objectRef<UserError>('CustomerEmailMarketingConsentUpdateUserError').implement({
  interfaces: [DisplayableError], fields: (t) => ({ code: t.field({ type: ConsentCode, nullable: true, resolve: (e) => codeErrors(CONSENT_CODES, e) }) }),
});
const SmsConsentUserError = builder.objectRef<UserError>('CustomerSmsMarketingConsentUpdateUserError').implement({
  interfaces: [DisplayableError], fields: (t) => ({ code: t.field({ type: ConsentCode, nullable: true, resolve: (e) => codeErrors(CONSENT_CODES, e) }) }),
});
const consentPayload = (name: string, err: typeof ConsentUserError) => builder.objectRef<{ customer: Customer | null; userErrors: UserError[] }>(name).implement({
  fields: (t) => ({ customer: t.field({ type: Customer_, nullable: true, resolve: (p) => p.customer }), userErrors: t.field({ type: [err], resolve: (p) => p.userErrors }) }),
});
const EmailConsentPayload = consentPayload('CustomerEmailMarketingConsentUpdatePayload', ConsentUserError);
const SmsConsentPayload = consentPayload('CustomerSmsMarketingConsentUpdatePayload', SmsConsentUserError);

builder.mutationFields((t) => ({
  customerEmailMarketingConsentUpdate: t.field({
    type: EmailConsentPayload, args: { input: t.arg({ type: EmailConsentInput, required: true }) },
    resolve: async (_r, { input }, ctx) => {
      requireScope(ctx, 'write_customers');
      const id = parseId(String(input.customerId), 'Customer');
      if (!id || !(await getCustomer(ctx.db, ctx.shopId, id))) return { customer: null, userErrors: [{ field: ['input', 'customerId'], message: 'Customer not found', code: 'INVALID' }] };
      const r = await updateEmailMarketingConsent(ctx.db, ctx.shopId, id, { marketingState: input.emailMarketingConsent.marketingState, marketingOptInLevel: input.emailMarketingConsent.marketingOptInLevel, consentUpdatedAt: input.emailMarketingConsent.consentUpdatedAt });
      return r.ok ? { customer: r.value, userErrors: [] } : { customer: null, userErrors: r.errors.map((e) => ({ ...e, field: ['input', ...(e.field ?? [])] })) };
    },
  }),
  customerSmsMarketingConsentUpdate: t.field({
    type: SmsConsentPayload, args: { input: t.arg({ type: SmsConsentInput, required: true }) },
    resolve: async (_r, { input }, ctx) => {
      requireScope(ctx, 'write_customers');
      const id = parseId(String(input.customerId), 'Customer');
      if (!id || !(await getCustomer(ctx.db, ctx.shopId, id))) return { customer: null, userErrors: [{ field: ['input', 'customerId'], message: 'Customer not found', code: 'INVALID' }] };
      const c = input.smsMarketingConsent as { marketingState: string; marketingOptInLevel?: string | null; consentUpdatedAt?: Date | null };
      const r = await updateSmsMarketingConsent(ctx.db, ctx.shopId, id, { marketingState: c.marketingState, marketingOptInLevel: c.marketingOptInLevel, consentUpdatedAt: c.consentUpdatedAt });
      return r.ok ? { customer: r.value, userErrors: [] } : { customer: null, userErrors: r.errors.map((e) => ({ ...e, field: ['input', ...(e.field ?? [])] })) };
    },
  }),
}));

