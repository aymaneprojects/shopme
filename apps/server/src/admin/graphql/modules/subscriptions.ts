import {
  changeContractStatus, contractOrderIds, contractsForOrder, countSubscriptionContracts, getCustomer, getOrder, getShop, getSubscriptionContract, listBillingAttempts, listContractLines, listEvents,
  listSubscriptionContracts, quoteRenewal, contractLinePrice, policyForCycle, sortedPolicies,
  type ContractAction, type ContractDiscount, type SubscriptionBillingAttempt as AttemptRow, type SubscriptionContract as ContractRow, type SubscriptionContractLine as LineRow,
} from '@shopme/core';
import { parseId, toGid, type UserError } from '@shopme/shopify-compat';
import { builder } from '../builder';
import { requireScope, type GraphQLContext } from '../context';
import { ConnectionArgs, defineConnection, paginate, paginateArray } from '../types/connection';
import { DisplayableError } from '../types/errors';
import { Count, MoneyV2, moneyV2 } from '../types/money';
import { Node, registerNode } from '../types/node';
import { COUNTRY_CODES, CountryCode, Customer_, EventConnection, Order_, OrderConnection, countryName, type EventRow } from '../types/sales';
import { LineItem } from './orders';
import { AdjustmentType, SellingPlanAnchor, SellingPlanInterval } from './selling-plans';
import { Image } from './files';
import { billContract, type SubscriptionNotifyJob } from '../../../subscriptions';

/** Subscription contracts created by checkouts with purchase options, their lines, billing attempts and status actions. */

const Status = builder.enumType('SubscriptionContractSubscriptionStatus', { values: ['ACTIVE', 'PAUSED', 'CANCELLED', 'EXPIRED', 'FAILED'] as const });
const LastPaymentStatus = builder.enumType('SubscriptionContractLastPaymentStatus', { values: ['SUCCEEDED', 'FAILED'] as const });
const CycleStatus = builder.enumType('SubscriptionBillingCycleBillingCycleStatus', { values: ['BILLED', 'UNBILLED'] as const });
const STATUS_CODES = ['INVALID', 'CONTRACT_DOES_NOT_EXIST', 'CONTRACT_TERMINATED'] as const;
const StatusCode = builder.enumType('SubscriptionContractStatusUpdateErrorCode', { values: STATUS_CODES });
const StatusUserError = builder.objectRef<UserError>('SubscriptionContractStatusUpdateUserError').implement({
  interfaces: [DisplayableError],
  fields: (t) => ({ code: t.field({ type: StatusCode, nullable: true, resolve: (e) => ((STATUS_CODES as readonly string[]).includes(e.code ?? '') ? (e.code as (typeof STATUS_CODES)[number]) : 'INVALID') }) }),
});
const SKIP_CODES = ['INVALID', 'CYCLE_NOT_FOUND', 'CONTRACT_TERMINATED', 'CYCLE_INDEX_OUT_OF_RANGE', 'CYCLE_START_DATE_OUT_OF_RANGE', 'BILLING_CYCLE_SKIPPED'] as const;
const SkipCode = builder.enumType('SubscriptionBillingCycleSkipUserErrorCode', { values: SKIP_CODES });
const SkipUserError = builder.objectRef<UserError>('SubscriptionBillingCycleSkipUserError').implement({
  interfaces: [DisplayableError],
  fields: (t) => ({ code: t.field({ type: SkipCode, nullable: true, resolve: (e) => ((SKIP_CODES as readonly string[]).includes(e.code ?? '') ? (e.code as (typeof SKIP_CODES)[number]) : 'INVALID') }) }),
});
const ATTEMPT_CODES = ['INVALID', 'BLANK', 'CONTRACT_NOT_FOUND', 'CONTRACT_TERMINATED', 'CONTRACT_PAUSED', 'ORIGIN_TIME_BEFORE_CONTRACT_CREATION', 'DUPLICATE'] as const;
const AttemptCode = builder.enumType('BillingAttemptUserErrorCode', { values: ATTEMPT_CODES });
const AttemptUserError = builder.objectRef<UserError>('BillingAttemptUserError').implement({
  interfaces: [DisplayableError],
  fields: (t) => ({ code: t.field({ type: AttemptCode, nullable: true, resolve: (e) => ((ATTEMPT_CODES as readonly string[]).includes(e.code ?? '') ? (e.code as (typeof ATTEMPT_CODES)[number]) : 'INVALID') }) }),
});

/* ------------------------------ output types ------------------------------ */

const BillingPolicy = builder.objectRef<ContractRow>('SubscriptionBillingPolicy').implement({
  fields: (t) => ({
    interval: t.field({ type: SellingPlanInterval, resolve: (c) => c.billingPolicy.interval }), intervalCount: t.int({ resolve: (c) => c.billingPolicy.intervalCount }),
    minCycles: t.int({ nullable: true, resolve: (c) => c.billingPolicy.minCycles }), maxCycles: t.int({ nullable: true, resolve: (c) => c.billingPolicy.maxCycles }),
    anchors: t.field({ type: [SellingPlanAnchor], resolve: () => [] }),
  }),
});
const DeliveryPolicy = builder.objectRef<ContractRow>('SubscriptionDeliveryPolicy').implement({
  fields: (t) => ({
    interval: t.field({ type: SellingPlanInterval, resolve: (c) => c.deliveryPolicy.interval }), intervalCount: t.int({ resolve: (c) => c.deliveryPolicy.intervalCount }),
    anchors: t.field({ type: [SellingPlanAnchor], resolve: () => [] }),
  }),
});

interface LineShape extends LineRow { contract: ContractRow }
const CycleAdjustment = builder.objectRef<{ type: string; value: number; afterCycle: number; computed: number; currency: string }>('SubscriptionCyclePriceAdjustment').implement({
  fields: (t) => ({
    adjustmentType: t.field({ type: AdjustmentType, resolve: (x) => x.type as 'PERCENTAGE' }),
    afterCycle: t.exposeInt('afterCycle'),
    computedPrice: t.field({ type: MoneyV2, resolve: (x) => moneyV2(x.computed, x.currency) }),
    shopmeAdjustmentValue: t.float({ resolve: (x) => x.value }),
  }),
});
const PricingPolicy = builder.objectRef<LineShape>('SubscriptionPricingPolicy').implement({
  fields: (t) => ({
    basePrice: t.field({ type: MoneyV2, resolve: (l) => moneyV2(l.basePrice * l.deliveriesPerBilling, l.contract.currency) }),
    cycleDiscounts: t.field({
      type: [CycleAdjustment],
      resolve: (l) => sortedPolicies(l.pricingPolicies).map((p) => ({ type: p.adjustmentType, value: p.adjustmentValue, afterCycle: p.afterCycle, computed: contractLinePrice(l.basePrice, [p], l.deliveriesPerBilling, p.afterCycle + 1), currency: l.contract.currency })),
    }),
  }),
});
const SubscriptionLine = builder.objectRef<LineShape>('SubscriptionLine').implement({
  fields: (t) => ({
    id: t.id({ resolve: (l) => toGid('SubscriptionLine', l.id) }),
    title: t.exposeString('title'),
    variantTitle: t.exposeString('variantTitle', { nullable: true }),
    sku: t.exposeString('sku', { nullable: true }),
    quantity: t.exposeInt('quantity'),
    productId: t.id({ nullable: true, resolve: (l) => (l.productId ? toGid('Product', l.productId) : null) }),
    variantId: t.id({ nullable: true, resolve: (l) => (l.variantId ? toGid('ProductVariant', l.variantId) : null) }),
    sellingPlanId: t.id({ nullable: true, resolve: (l) => (l.sellingPlanId ? toGid('SellingPlan', l.sellingPlanId) : null) }),
    sellingPlanName: t.exposeString('sellingPlanName', { nullable: true }),
    currentPrice: t.field({ type: MoneyV2, resolve: (l) => moneyV2(l.currentPrice, l.contract.currency) }),
    lineDiscountedPrice: t.field({ type: MoneyV2, resolve: (l) => moneyV2(l.currentPrice * l.quantity, l.contract.currency) }),
    requiresShipping: t.exposeBoolean('requiresShipping'),
    taxable: t.exposeBoolean('taxable'),
    variantImage: t.field({ type: Image, nullable: true, resolve: (l) => (l.imageUrl ? { id: null, url: l.imageUrl, altText: l.title, width: null, height: null } : null) }),
    pricingPolicy: t.field({ type: PricingPolicy, nullable: true, resolve: (l) => (l.pricingPolicies.length ? l : null) }),
    shopmeCurrentPolicyIndex: t.int({ nullable: true, resolve: (l) => { const p = policyForCycle(l.pricingPolicies, l.contract.cyclesCompleted + 1); return p ? sortedPolicies(l.pricingPolicies).indexOf(p) : null; } }),
  }),
});
const SubscriptionLineConnection = defineConnection('SubscriptionLine', SubscriptionLine);

const SubscriptionMailingAddress = builder.objectRef<Record<string, string | null>>('SubscriptionMailingAddress').implement({
  fields: (t) => ({
    address1: t.string({ nullable: true, resolve: (a) => a.address1 ?? null }), address2: t.string({ nullable: true, resolve: (a) => a.address2 ?? null }), city: t.string({ nullable: true, resolve: (a) => a.city ?? null }),
    company: t.string({ nullable: true, resolve: (a) => a.company ?? null }), firstName: t.string({ nullable: true, resolve: (a) => a.firstName ?? null }), lastName: t.string({ nullable: true, resolve: (a) => a.lastName ?? null }),
    name: t.string({ nullable: true, resolve: (a) => [a.firstName, a.lastName].filter(Boolean).join(' ') || null }), phone: t.string({ nullable: true, resolve: (a) => a.phone ?? null }),
    province: t.string({ nullable: true, resolve: (a) => a.province ?? a.provinceCode ?? null }), provinceCode: t.string({ nullable: true, resolve: (a) => a.provinceCode ?? null }), zip: t.string({ nullable: true, resolve: (a) => a.zip ?? null }),
    country: t.string({ nullable: true, resolve: (a) => countryName(a.countryCode ?? null) ?? a.country ?? null }),
    countryCode: t.field({ type: CountryCode, nullable: true, resolve: (a) => (a.countryCode && COUNTRY_CODES.has(a.countryCode) ? a.countryCode : null) }),
  }),
});
const ShippingOption = builder.objectRef<{ title: string; code: string | null }>('SubscriptionShippingOption').implement({
  fields: (t) => ({ title: t.exposeString('title'), code: t.exposeString('code', { nullable: true }), presentmentTitle: t.string({ nullable: true, resolve: (o) => o.title }), description: t.string({ nullable: true, resolve: () => null }) }),
});
const DeliveryMethodShipping = builder.objectRef<ContractRow>('SubscriptionDeliveryMethodShipping').implement({
  fields: (t) => ({
    address: t.field({ type: SubscriptionMailingAddress, resolve: (c) => c.deliveryAddress ?? {} }),
    shippingOption: t.field({ type: ShippingOption, resolve: (c) => c.deliveryMethod ?? { title: '', code: null } }),
  }),
});
const DeliveryMethod = builder.unionType('SubscriptionDeliveryMethod', { types: [DeliveryMethodShipping], resolveType: () => DeliveryMethodShipping });

const ContractDiscountRef = builder.objectRef<ContractDiscount & { currency: string }>('ShopmeSubscriptionDiscount').implement({
  fields: (t) => ({
    title: t.exposeString('title'), code: t.exposeString('code', { nullable: true }), remainingCycles: t.exposeInt('remainingCycles', { nullable: true }),
    valueType: t.exposeString('valueType'), target: t.exposeString('target'),
    percentage: t.float({ nullable: true, resolve: (d) => (d.valueType === 'PERCENTAGE' ? d.value / 100 : null) }),
    amount: t.field({ type: MoneyV2, nullable: true, resolve: (d) => (d.valueType === 'FIXED_AMOUNT' ? moneyV2(d.value, d.currency) : null) }),
  }),
});

export const SubscriptionContract = builder.objectRef<ContractRow>('SubscriptionContract');
const SubscriptionBillingAttempt = builder.objectRef<AttemptRow>('SubscriptionBillingAttempt');
SubscriptionBillingAttempt.implement({
  interfaces: [Node],
  fields: (t) => ({
    idempotencyKey: t.exposeString('idempotencyKey'),
    createdAt: t.field({ type: 'DateTime', resolve: (a) => a.createdAt }),
    completedAt: t.field({ type: 'DateTime', nullable: true, resolve: (a) => a.completedAt }),
    originTime: t.field({ type: 'DateTime', nullable: true, resolve: (a) => a.billingDate }),
    ready: t.boolean({ resolve: (a) => a.status !== 'PENDING' }),
    errorCode: t.exposeString('errorCode', { nullable: true }),
    errorMessage: t.exposeString('errorMessage', { nullable: true }),
    nextActionUrl: t.field({ type: 'URL', nullable: true, resolve: () => null }),
    order: t.field({ type: Order_, nullable: true, resolve: (a, _x, ctx) => (a.orderId ? getOrder(ctx.db, ctx.shopId, a.orderId) : null) }),
    subscriptionContract: t.field({ type: SubscriptionContract, resolve: async (a, _x, ctx) => (await getSubscriptionContract(ctx.db, ctx.shopId, a.contractId))! }),
    shopmeStatus: t.exposeString('status'),
    shopmeCycleIndex: t.exposeInt('cycleIndex'),
  }),
});
const BillingAttemptConnection = defineConnection('SubscriptionBillingAttempt', SubscriptionBillingAttempt);

const linesOf = async (ctx: GraphQLContext, c: ContractRow): Promise<LineShape[]> => (await listContractLines(ctx.db, ctx.shopId, [c.id])).map((l) => ({ ...l, contract: c }));

SubscriptionContract.implement({
  interfaces: [Node],
  fields: (t) => ({
    status: t.field({ type: Status, resolve: (c) => c.status as 'ACTIVE' }),
    createdAt: t.field({ type: 'DateTime', resolve: (c) => c.createdAt }),
    updatedAt: t.field({ type: 'DateTime', resolve: (c) => c.updatedAt }),
    currencyCode: t.exposeString('currency'),
    nextBillingDate: t.field({ type: 'DateTime', nullable: true, resolve: (c) => (c.status === 'CANCELLED' || c.status === 'EXPIRED' ? null : c.nextBillingDate) }),
    revisionId: t.field({ type: 'UnsignedInt64', resolve: (c) => String(c.updatedAt.getTime()) }),
    note: t.exposeString('note', { nullable: true }),
    lastPaymentStatus: t.field({ type: LastPaymentStatus, nullable: true, resolve: (c) => (c.lastPaymentStatus as 'SUCCEEDED' | null) ?? null }),
    lastBillingAttemptErrorType: t.exposeString('lastBillingErrorType', { nullable: true }),
    billingPolicy: t.field({ type: BillingPolicy, resolve: (c) => c }),
    deliveryPolicy: t.field({ type: DeliveryPolicy, resolve: (c) => c }),
    deliveryPrice: t.field({ type: MoneyV2, resolve: (c) => moneyV2(c.deliveryPrice, c.currency) }),
    deliveryMethod: t.field({ type: DeliveryMethod, nullable: true, resolve: (c) => (c.deliveryMethod ? c : null) }),
    customer: t.field({ type: Customer_, nullable: true, resolve: (c, _a, ctx) => (c.customerId ? getCustomer(ctx.db, ctx.shopId, c.customerId) : null) }),
    originOrder: t.field({ type: Order_, nullable: true, resolve: (c, _a, ctx) => (c.originOrderId ? getOrder(ctx.db, ctx.shopId, c.originOrderId) : null) }),
    lines: t.field({ type: SubscriptionLineConnection, args: ConnectionArgs, resolve: async (c, a, ctx) => paginateArray(a, await linesOf(ctx, c)) }),
    linesCount: t.field({ type: Count, nullable: true, resolve: async (c, _a, ctx) => ({ count: (await listContractLines(ctx.db, ctx.shopId, [c.id])).length, precision: 'EXACT' as const }) }),
    orders: t.field({
      type: OrderConnection, args: ConnectionArgs,
      resolve: async (c, a, ctx) => { requireScope(ctx, 'read_orders'); return paginateArray(a, (await Promise.all((await contractOrderIds(ctx.db, ctx.shopId, c)).map((id) => getOrder(ctx.db, ctx.shopId, id)))).filter((o) => o != null)); },
    }),
    billingAttempts: t.field({ type: BillingAttemptConnection, args: ConnectionArgs, resolve: async (c, a, ctx) => paginateArray(a, await listBillingAttempts(ctx.db, ctx.shopId, c.id)) }),
    shopmeEvents: t.field({
      type: EventConnection, args: ConnectionArgs,
      resolve: async (c, a, ctx) => paginateArray(a, (await listEvents(ctx.db, ctx.shopId, 'subscription_contract', c.id, 500)) as EventRow[]),
    }),
    shopmePaymentGateway: t.exposeString('paymentGateway'),
    shopmeHasSavedPaymentMethod: t.boolean({ resolve: (c) => !!c.stripePaymentMethodId }),
    shopmeCyclesCompleted: t.exposeInt('cyclesCompleted'),
    shopmeFailedAttempts: t.exposeInt('failedAttempts'),
    shopmeRetryAt: t.field({ type: 'DateTime', nullable: true, resolve: (c) => c.retryAt }),
    shopmePausedAt: t.field({ type: 'DateTime', nullable: true, resolve: (c) => c.pausedAt }),
    shopmeCancelledAt: t.field({ type: 'DateTime', nullable: true, resolve: (c) => c.cancelledAt }),
    shopmeDiscounts: t.field({ type: [ContractDiscountRef], resolve: (c) => c.discounts.map((d) => ({ ...d, currency: c.currency })) }),
    /** Total of the next renewal order (lines, discounts kept from checkout, delivery and taxes). */
    shopmeNextOrderTotal: t.field({
      type: MoneyV2, nullable: true,
      resolve: async (c, _a, ctx) => {
        if (c.status === 'CANCELLED' || c.status === 'EXPIRED') return null;
        const shop = await getShop(ctx.db, ctx.shopId);
        const lines = await listContractLines(ctx.db, ctx.shopId, [c.id]);
        return shop && lines.length ? moneyV2((await quoteRenewal(ctx.db, shop, c, lines)).total, c.currency) : null;
      },
    }),
  }),
});
const SubscriptionContractConnection = defineConnection('SubscriptionContract', SubscriptionContract);
registerNode('SubscriptionContract', (ctx, id) => getSubscriptionContract(ctx.db, ctx.shopId, id));

const SubscriptionBillingCycle = builder.objectRef<{ contract: ContractRow; index: number; date: Date; skipped: boolean }>('SubscriptionBillingCycle').implement({
  fields: (t) => ({
    cycleIndex: t.exposeInt('index'),
    billingAttemptExpectedDate: t.field({ type: 'DateTime', resolve: (x) => x.date }),
    cycleStartAt: t.field({ type: 'DateTime', resolve: (x) => x.date }),
    cycleEndAt: t.field({ type: 'DateTime', resolve: (x) => x.contract.nextBillingDate }),
    skipped: t.exposeBoolean('skipped'),
    edited: t.boolean({ resolve: () => false }),
    status: t.field({ type: CycleStatus, resolve: () => 'UNBILLED' as const }),
    sourceContract: t.field({ type: SubscriptionContract, resolve: (x) => x.contract }),
  }),
});

/** ShopMe: the subscription contracts an order started or renewed. */
builder.objectFields(Order_, (t) => ({
  shopmeSubscriptionContracts: t.field({ type: [SubscriptionContract], resolve: (o, _a, ctx) => { requireScope(ctx, 'read_own_subscription_contracts'); return contractsForOrder(ctx.db, ctx.shopId, o.id); } }),
}));
const LineItemSellingPlan = builder.objectRef<{ name: string; id: number | null }>('LineItemSellingPlan').implement({
  fields: (t) => ({ name: t.exposeString('name'), sellingPlanId: t.id({ nullable: true, resolve: (p) => (p.id ? toGid('SellingPlan', p.id) : null) }) }),
});
builder.objectFields(LineItem, (t) => ({
  sellingPlan: t.field({ type: LineItemSellingPlan, nullable: true, resolve: (l) => (l.sellingPlanName ? { name: l.sellingPlanName, id: l.sellingPlanId } : null) }),
  contract: t.field({ type: SubscriptionContract, nullable: true, resolve: (l, _a, ctx) => (l.subscriptionContractId ? getSubscriptionContract(ctx.db, ctx.shopId, l.subscriptionContractId) : null) }),
}));
builder.objectFields(Customer_, (t) => ({
  subscriptionContracts: t.field({
    type: SubscriptionContractConnection, args: ConnectionArgs,
    resolve: (c, a, ctx) => {
      requireScope(ctx, 'read_own_subscription_contracts');
      return paginate(a, {
        fetch: ({ offset, limit }) => listSubscriptionContracts(ctx.db, ctx.shopId, { customerId: c.id, reverse: !a.reverse, offset, limit }),
        total: () => countSubscriptionContracts(ctx.db, ctx.shopId, null, c.id),
      });
    },
  }),
}));

/* ------------------------------ queries ------------------------------ */

const SortKeys = builder.enumType('ShopmeSubscriptionContractSortKeys', { values: ['ID', 'CREATED_AT', 'UPDATED_AT', 'NEXT_BILLING_DATE', 'STATUS'] as const });

builder.queryFields((t) => ({
  subscriptionContract: t.field({
    type: SubscriptionContract, nullable: true, args: { id: t.arg.id({ required: true }) },
    resolve: async (_r, a, ctx) => { requireScope(ctx, 'read_own_subscription_contracts'); const id = parseId(String(a.id), 'SubscriptionContract'); return id ? getSubscriptionContract(ctx.db, ctx.shopId, id) : null; },
  }),
  subscriptionContracts: t.field({
    type: SubscriptionContractConnection, args: { ...ConnectionArgs, query: t.arg.string(), shopmeSortKey: t.arg({ type: SortKeys, defaultValue: 'ID' }) },
    resolve: (_r, a, ctx) => {
      requireScope(ctx, 'read_own_subscription_contracts');
      return paginate(a, {
        fetch: ({ offset, limit }) => listSubscriptionContracts(ctx.db, ctx.shopId, { query: a.query, sortKey: (a.shopmeSortKey ?? 'ID') as 'ID', reverse: !!a.reverse, offset, limit }),
        total: () => countSubscriptionContracts(ctx.db, ctx.shopId, a.query),
      });
    },
  }),
  shopmeSubscriptionContractsCount: t.field({
    type: Count, args: { query: t.arg.string() },
    resolve: async (_r, a, ctx) => { requireScope(ctx, 'read_own_subscription_contracts'); return { count: await countSubscriptionContracts(ctx.db, ctx.shopId, a.query), precision: 'EXACT' as const }; },
  }),
}));

/* ------------------------------ mutations ------------------------------ */

const fail = (field: string[], message: string, code = 'INVALID'): UserError[] => [{ field, message, code }];
const staffOf = (ctx: GraphQLContext) => (ctx.auth.kind === 'session' ? ctx.auth.user.id : null);

type StatusPayload = { contract: ContractRow | null; userErrors: UserError[] };
const statusPayload = (name: string) => builder.objectRef<StatusPayload>(name).implement({
  fields: (t) => ({ contract: t.field({ type: SubscriptionContract, nullable: true, resolve: (p) => p.contract }), userErrors: t.field({ type: [StatusUserError], resolve: (p) => p.userErrors }) }),
});

async function act(ctx: GraphQLContext, raw: string | number, action: ContractAction): Promise<StatusPayload> {
  requireScope(ctx, 'write_own_subscription_contracts');
  const id = parseId(String(raw), 'SubscriptionContract');
  if (!id) return { contract: null, userErrors: fail(['subscriptionContractId'], 'Subscription contract does not exist', 'CONTRACT_DOES_NOT_EXIST') };
  const r = await changeContractStatus(ctx.db, ctx.shopId, id, action, { staffId: staffOf(ctx), actor: 'staff' });
  if (!r.ok) return { contract: null, userErrors: r.errors };
  if (action === 'cancel') ctx.app.queue.enqueue<SubscriptionNotifyJob>('subscription.notify', { shopId: ctx.shopId, contractId: id, key: 'subscription_cancelled' });
  return { contract: r.value, userErrors: [] };
}

const ACTIONS = [
  ['subscriptionContractPause', 'SubscriptionContractPausePayload', 'pause'], ['subscriptionContractActivate', 'SubscriptionContractActivatePayload', 'activate'],
  ['subscriptionContractCancel', 'SubscriptionContractCancelPayload', 'cancel'], ['subscriptionContractExpire', 'SubscriptionContractExpirePayload', 'expire'],
  ['subscriptionContractFail', 'SubscriptionContractFailPayload', 'fail'],
] as const;
for (const [field, payload, action] of ACTIONS) {
  const ref = statusPayload(payload);
  builder.mutationFields((t) => ({ [field]: t.field({ type: ref, args: { subscriptionContractId: t.arg.id({ required: true }) }, resolve: (_r, a, ctx) => act(ctx, a.subscriptionContractId, action) }) }));
}

const SelectorInput = builder.inputType('SubscriptionBillingCycleSelector', { fields: (t) => ({ index: t.int(), date: t.field({ type: 'DateTime' }) }) });
const CycleInput = builder.inputType('SubscriptionBillingCycleInput', { fields: (t) => ({ contractId: t.id({ required: true }), selector: t.field({ type: SelectorInput, required: true }) }) });
const SkipPayload = builder.objectRef<{ cycle: { contract: ContractRow; index: number; date: Date; skipped: boolean } | null; userErrors: UserError[] }>('SubscriptionBillingCycleSkipPayload').implement({
  fields: (t) => ({ billingCycle: t.field({ type: SubscriptionBillingCycle, nullable: true, resolve: (p) => p.cycle }), userErrors: t.field({ type: [SkipUserError], resolve: (p) => p.userErrors }) }),
});
const AttemptInput = builder.inputType('SubscriptionBillingAttemptInput', { fields: (t) => ({ idempotencyKey: t.string({ required: true }), originTime: t.field({ type: 'DateTime' }) }) });
const AttemptPayload = builder.objectRef<{ attempt: AttemptRow | null; userErrors: UserError[] }>('SubscriptionBillingAttemptCreatePayload').implement({
  fields: (t) => ({ subscriptionBillingAttempt: t.field({ type: SubscriptionBillingAttempt, nullable: true, resolve: (p) => p.attempt }), userErrors: t.field({ type: [AttemptUserError], resolve: (p) => p.userErrors }) }),
});

builder.mutationFields((t) => ({
  subscriptionBillingCycleSkip: t.field({
    type: SkipPayload, args: { billingCycleInput: t.arg({ type: CycleInput, required: true }) },
    resolve: async (_r, { billingCycleInput: i }, ctx) => {
      requireScope(ctx, 'write_own_subscription_contracts');
      const id = parseId(String(i.contractId), 'SubscriptionContract');
      const c = id ? await getSubscriptionContract(ctx.db, ctx.shopId, id) : null;
      if (!c) return { cycle: null, userErrors: fail(['billingCycleInput', 'contractId'], 'Subscription contract does not exist', 'CYCLE_NOT_FOUND') };
      const next = c.cyclesCompleted + 1;
      const sameDay = (d: Date) => d.toISOString().slice(0, 10) === c.nextBillingDate.toISOString().slice(0, 10);
      if (i.selector.index != null && i.selector.index !== next) return { cycle: null, userErrors: fail(['billingCycleInput', 'selector', 'index'], 'Only the next billing cycle can be skipped', 'CYCLE_INDEX_OUT_OF_RANGE') };
      if (i.selector.index == null && (!i.selector.date || !sameDay(i.selector.date))) return { cycle: null, userErrors: fail(['billingCycleInput', 'selector', 'date'], 'Only the next billing cycle can be skipped', 'CYCLE_START_DATE_OUT_OF_RANGE') };
      const r = await changeContractStatus(ctx.db, ctx.shopId, c.id, 'skip', { staffId: staffOf(ctx), actor: 'staff' });
      if (!r.ok) return { cycle: null, userErrors: r.errors.map((e) => ({ ...e, field: ['billingCycleInput', 'contractId'] })) };
      return { cycle: { contract: r.value, index: next, date: c.nextBillingDate, skipped: true }, userErrors: [] };
    },
  }),
  subscriptionBillingAttemptCreate: t.field({
    type: AttemptPayload, args: { subscriptionContractId: t.arg.id({ required: true }), subscriptionBillingAttemptInput: t.arg({ type: AttemptInput, required: true }) },
    resolve: async (_r, a, ctx) => {
      requireScope(ctx, 'write_own_subscription_contracts');
      const id = parseId(String(a.subscriptionContractId), 'SubscriptionContract');
      const c = id ? await getSubscriptionContract(ctx.db, ctx.shopId, id) : null;
      if (!c) return { attempt: null, userErrors: fail(['subscriptionContractId'], 'Subscription contract does not exist', 'CONTRACT_NOT_FOUND') };
      if (c.status === 'PAUSED') return { attempt: null, userErrors: fail(['subscriptionContractId'], 'A paused subscription cannot be billed', 'CONTRACT_PAUSED') };
      if (c.status !== 'ACTIVE') return { attempt: null, userErrors: fail(['subscriptionContractId'], 'The subscription has ended', 'CONTRACT_TERMINATED') };
      const key = a.subscriptionBillingAttemptInput.idempotencyKey.trim();
      if (!key) return { attempt: null, userErrors: fail(['subscriptionBillingAttemptInput', 'idempotencyKey'], "Idempotency key can't be blank", 'BLANK') };
      const shop = (await getShop(ctx.db, ctx.shopId))!;
      const out = await billContract(ctx.request.server, shop, c.id, { idempotencyKey: key.slice(0, 200) });
      if (out.status === 'skipped') return { attempt: null, userErrors: fail(['subscriptionBillingAttemptInput', 'idempotencyKey'], 'This idempotency key was already used', 'DUPLICATE') };
      const attempt = (await listBillingAttempts(ctx.db, ctx.shopId, c.id)).find((x) => x.id === out.attemptId) ?? null;
      return { attempt, userErrors: [] };
    },
  }),
}));
