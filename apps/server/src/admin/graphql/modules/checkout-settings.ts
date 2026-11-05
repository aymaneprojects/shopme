/**
 * ShopMe extensions: checkout settings, return rules, staff order notification recipients and per-notification switches,
 * and the in-app activity feed (admin bell).
 */
import {
  checkoutSettingsOf, getShop, isNotificationKey, listActivity, markActivityRead, returnRulesOf, setNotificationEnabled, staffOrderRecipientsOf, updateCheckoutSettings, updateReturnRules, updateStaffOrderRecipients,
  type ActivityEntry, type CheckoutSettings, type ReturnRules,
} from '@shopme/core';
import { builder } from '../builder';
import { requireScope, type GraphQLContext } from '../context';
import { definePayload } from '../types/errors';

const FieldRuleEnum = builder.enumType('ShopmeCheckoutFieldRule', { values: ['hidden', 'optional', 'required'] as const });
const MarketingEnum = builder.enumType('ShopmeCheckoutMarketing', { values: ['hidden', 'unchecked', 'checked'] as const });
const ContactEnum = builder.enumType('ShopmeCheckoutContactMethod', { values: ['email', 'email_or_phone'] as const });
const AccountEnum = builder.enumType('ShopmeCheckoutAccountMode', { values: ['guest', 'required'] as const });
const NameEnum = builder.enumType('ShopmeCheckoutNameMode', { values: ['full', 'last'] as const });

const Tipping = builder.objectRef<CheckoutSettings['tipping']>('ShopmeCheckoutTipping').implement({
  fields: (t) => ({ enabled: t.exposeBoolean('enabled'), presets: t.exposeIntList('presets', { description: 'Preset tip percentages.' }) }),
});
const CheckoutSettingsType = builder.objectRef<CheckoutSettings>('ShopmeCheckoutSettings').implement({
  fields: (t) => ({
    contactMethod: t.field({ type: ContactEnum, resolve: (s) => s.contactMethod }),
    accountMode: t.field({ type: AccountEnum, resolve: (s) => s.accountMode }),
    nameMode: t.field({ type: NameEnum, resolve: (s) => s.nameMode }),
    company: t.field({ type: FieldRuleEnum, resolve: (s) => s.company }),
    address2: t.field({ type: FieldRuleEnum, resolve: (s) => s.address2 }),
    phone: t.field({ type: FieldRuleEnum, resolve: (s) => s.phone }),
    marketing: t.field({ type: MarketingEnum, resolve: (s) => s.marketing }),
    tipping: t.field({ type: Tipping, resolve: (s) => s.tipping }),
    orderNotes: t.exposeBoolean('orderNotes'),
  }),
});
const TippingInput = builder.inputType('ShopmeCheckoutTippingInput', { fields: (t) => ({ enabled: t.boolean(), presets: t.intList() }) });
const CheckoutSettingsInput = builder.inputType('ShopmeCheckoutSettingsInput', {
  fields: (t) => ({
    contactMethod: t.field({ type: ContactEnum }), accountMode: t.field({ type: AccountEnum }), nameMode: t.field({ type: NameEnum }),
    company: t.field({ type: FieldRuleEnum }), address2: t.field({ type: FieldRuleEnum }), phone: t.field({ type: FieldRuleEnum }), marketing: t.field({ type: MarketingEnum }),
    tipping: t.field({ type: TippingInput }), orderNotes: t.boolean(),
  }),
});
const CheckoutPayload = definePayload<{ settings: CheckoutSettings | null }>('ShopmeCheckoutSettingsUpdatePayload', (t) => ({ settings: t.field({ type: CheckoutSettingsType, nullable: true, resolve: (p) => p.settings }) }));

/* ------------------------------ return rules ------------------------------ */

const ShippingCostEnum = builder.enumType('ShopmeReturnShippingCost', { values: ['free', 'customer_fixed', 'customer_pays'] as const });
const FinalSale = builder.objectRef<ReturnRules['finalSale']>('ShopmeReturnFinalSale').implement({
  fields: (t) => ({ productIds: t.field({ type: ['ID'], resolve: (f) => f.productIds.map((id) => `gid://shopify/Product/${id}`) }), collectionIds: t.field({ type: ['ID'], resolve: (f) => f.collectionIds.map((id) => `gid://shopify/Collection/${id}`) }) }),
});
const ReturnRulesType = builder.objectRef<ReturnRules>('ShopmeReturnRules').implement({
  fields: (t) => ({
    windowDays: t.int({ nullable: true, resolve: (r) => r.windowDays }),
    shippingCost: t.field({ type: ShippingCostEnum, resolve: (r) => r.shippingCost }),
    shippingFee: t.int({ description: 'Minor units.', resolve: (r) => r.shippingFee }),
    restockingFeePercent: t.float({ resolve: (r) => r.restockingFeePercent }),
    finalSale: t.field({ type: FinalSale, resolve: (r) => r.finalSale }),
  }),
});
const idsOf = (xs: readonly string[] | null | undefined, type: string): number[] | undefined => xs?.map((x) => Number(String(x).replace(new RegExp(`^gid://shopify/${type}/`), ''))).filter((n) => Number.isInteger(n) && n > 0);
const ReturnRulesInput = builder.inputType('ShopmeReturnRulesInput', {
  fields: (t) => ({
    windowDays: t.int({ description: 'Null clears the limit.' }), shippingCost: t.field({ type: ShippingCostEnum }), shippingFee: t.int(), restockingFeePercent: t.float(),
    finalSaleProductIds: t.idList(), finalSaleCollectionIds: t.idList(),
  }),
});
const ReturnRulesPayload = definePayload<{ rules: ReturnRules | null }>('ShopmeReturnRulesUpdatePayload', (t) => ({ rules: t.field({ type: ReturnRulesType, nullable: true, resolve: (p) => p.rules }) }));

/* ------------------------------ notifications ------------------------------ */

const Recipients = builder.objectRef<{ emails: string[]; custom: boolean }>('ShopmeStaffOrderRecipients').implement({
  fields: (t) => ({ emails: t.exposeStringList('emails'), isDefault: t.boolean({ description: 'True while the store contact email is used.', resolve: (r) => !r.custom }) }),
});
const RecipientsPayload = definePayload<{ recipients: { emails: string[]; custom: boolean } | null }>('ShopmeStaffOrderRecipientsUpdatePayload', (t) => ({ recipients: t.field({ type: Recipients, nullable: true, resolve: (p) => p.recipients }) }));
const TogglePayload = definePayload<{ key: string | null; enabled: boolean | null }>('ShopmeNotificationToggleUpdatePayload', (t) => ({ key: t.string({ nullable: true, resolve: (p) => p.key }), enabled: t.boolean({ nullable: true, resolve: (p) => p.enabled }) }));

/* ------------------------------ activity feed ------------------------------ */

const ActivityKindEnum = builder.enumType('ShopmeActivityKind', { values: ['order', 'low_stock', 'webhook_failed', 'backup'] as const });
const Activity = builder.objectRef<ActivityEntry>('ShopmeActivityEntry').implement({
  fields: (t) => ({
    id: t.id({ resolve: (a) => `gid://shopify/ShopmeActivityEntry/${a.id}` }), kind: t.field({ type: ActivityKindEnum, resolve: (a) => a.kind }),
    title: t.exposeString('title'), body: t.exposeString('body'), link: t.string({ nullable: true, description: 'Admin path.', resolve: (a) => a.link }),
    createdAt: t.field({ type: 'DateTime', resolve: (a) => a.createdAt }), read: t.exposeBoolean('read'), ok: t.exposeBoolean('ok'),
  }),
});
const Feed = builder.objectRef<{ items: ActivityEntry[]; unreadCount: number }>('ShopmeActivityFeed').implement({
  fields: (t) => ({ items: t.field({ type: [Activity], resolve: (f) => f.items }), unreadCount: t.exposeInt('unreadCount') }),
});
const MarkPayload = definePayload<{ unreadCount: number }>('ShopmeActivityMarkAllReadPayload', (t) => ({ unreadCount: t.exposeInt('unreadCount') }));

const staffOf = (ctx: GraphQLContext) => (ctx.auth.kind === 'session' ? ctx.auth.user.id : null);
const shopOf = async (ctx: GraphQLContext) => (await getShop(ctx.db, ctx.shopId))!;

builder.queryFields((t) => ({
  shopmeCheckoutSettings: t.field({ type: CheckoutSettingsType, resolve: async (_r, _a, ctx) => { requireScope(ctx, 'read_shop'); return checkoutSettingsOf(await shopOf(ctx)); } }),
  shopmeReturnRules: t.field({ type: ReturnRulesType, resolve: async (_r, _a, ctx) => { requireScope(ctx, 'read_shop'); return returnRulesOf(await shopOf(ctx)); } }),
  shopmeStaffOrderRecipients: t.field({ type: Recipients, resolve: async (_r, _a, ctx) => { requireScope(ctx, 'read_shop'); return staffOrderRecipientsOf(await shopOf(ctx)); } }),
  shopmeActivityFeed: t.field({
    type: Feed, args: { first: t.arg.int({ defaultValue: 30 }) },
    resolve: (_r, a, ctx) => { requireScope(ctx, 'read_shop'); return listActivity(ctx.db, ctx.shopId, staffOf(ctx), a.first ?? 30); },
  }),
}));

builder.mutationFields((t) => ({
  shopmeCheckoutSettingsUpdate: t.field({
    type: CheckoutPayload, args: { input: t.arg({ type: CheckoutSettingsInput, required: true }) },
    resolve: async (_r, { input }, ctx) => {
      requireScope(ctx, 'write_shop');
      const r = await updateCheckoutSettings(ctx.db, await shopOf(ctx), {
        contactMethod: input.contactMethod ?? undefined, accountMode: input.accountMode ?? undefined, nameMode: input.nameMode ?? undefined, company: input.company ?? undefined, address2: input.address2 ?? undefined,
        phone: input.phone ?? undefined, marketing: input.marketing ?? undefined, orderNotes: input.orderNotes ?? undefined, tipping: input.tipping ?? undefined,
      });
      return r.ok ? { settings: r.value, userErrors: [] } : { settings: null, userErrors: r.errors };
    },
  }),
  shopmeReturnRulesUpdate: t.field({
    type: ReturnRulesPayload, args: { input: t.arg({ type: ReturnRulesInput, required: true }) },
    resolve: async (_r, { input }, ctx) => {
      requireScope(ctx, 'write_shop');
      const r = await updateReturnRules(ctx.db, await shopOf(ctx), {
        windowDays: input.windowDays, clearWindow: input.windowDays === null, shippingCost: input.shippingCost, shippingFee: input.shippingFee, restockingFeePercent: input.restockingFeePercent,
        finalSale: input.finalSaleProductIds || input.finalSaleCollectionIds ? { productIds: idsOf(input.finalSaleProductIds as string[] | undefined, 'Product'), collectionIds: idsOf(input.finalSaleCollectionIds as string[] | undefined, 'Collection') } : undefined,
      });
      return r.ok ? { rules: r.value, userErrors: [] } : { rules: null, userErrors: r.errors };
    },
  }),
  shopmeStaffOrderRecipientsUpdate: t.field({
    type: RecipientsPayload, args: { emails: t.arg.stringList({ required: true }) },
    resolve: async (_r, a, ctx) => {
      requireScope(ctx, 'write_shop');
      const r = await updateStaffOrderRecipients(ctx.db, await shopOf(ctx), a.emails);
      return 'error' in r ? { recipients: null, userErrors: [{ field: ['emails'], message: r.error }] } : { recipients: r, userErrors: [] };
    },
  }),
  shopmeNotificationToggle: t.field({
    type: TogglePayload, args: { key: t.arg.string({ required: true }), enabled: t.arg.boolean({ required: true }) },
    resolve: async (_r, a, ctx) => {
      requireScope(ctx, 'write_shop');
      if (!isNotificationKey(a.key)) return { key: null, enabled: null, userErrors: [{ field: ['key'], message: 'Unknown notification template' }] };
      const r = await setNotificationEnabled(ctx.db, await shopOf(ctx), a.key, a.enabled);
      return 'error' in r ? { key: null, enabled: null, userErrors: [{ field: ['key'], message: r.error }] } : { key: a.key, enabled: r.enabled, userErrors: [] };
    },
  }),
  shopmeActivityMarkAllRead: t.field({
    type: MarkPayload,
    resolve: async (_r, _a, ctx) => { requireScope(ctx, 'read_shop'); await markActivityRead(ctx.db, ctx.shopId, staffOf(ctx)); return { unreadCount: 0, userErrors: [] }; },
  }),
}));
