import {
  changeGroupResources, countSellingPlanGroups, createSellingPlanGroup, deleteSellingPlanGroup, getProduct, getSellingPlan, getSellingPlanGroup, getSellingPlanGroups, getVariant, groupProductIds, groupVariantIds,
  groupsForProducts, groupsForVariants, listSellingPlanGroups, listSellingPlans, updateSellingPlanGroup,
  type PlanBillingPolicy, type PlanDeliveryPolicy, type PlanPricingPolicy, type SellingPlan as PlanRow, type SellingPlanGroup as GroupRow, type SellingPlanGroupInput as GroupIn, type SellingPlanInput as PlanIn,
} from '@shopme/core';
import { parseId, parseMoney, toGid, type UserError } from '@shopme/shopify-compat';
import { builder } from '../builder';
import { requireScope, type GraphQLContext } from '../context';
import { ConnectionArgs, defineConnection, paginate, paginateArray } from '../types/connection';
import { DisplayableError } from '../types/errors';
import { Count, MoneyV2, moneyV2 } from '../types/money';
import { Node, registerNode } from '../types/node';
import { Product_, ProductConnection, ProductVariant, ProductVariantConnection, shopOf } from '../types/catalog';

/** Purchase options: selling plan groups and their plans, attached to products and variants. */

export const SellingPlanInterval = builder.enumType('SellingPlanInterval', { values: ['DAY', 'WEEK', 'MONTH', 'YEAR'] as const });
const Category = builder.enumType('SellingPlanCategory', { values: ['SUBSCRIPTION', 'PRE_ORDER', 'TRY_BEFORE_YOU_BUY', 'OTHER'] as const });
export const AdjustmentType = builder.enumType('SellingPlanPricingPolicyAdjustmentType', { values: ['PERCENTAGE', 'FIXED_AMOUNT', 'PRICE'] as const });
const SortKeys = builder.enumType('SellingPlanGroupSortKeys', { values: ['CREATED_AT', 'ID', 'NAME', 'UPDATED_AT'] as const });
const AnchorType = builder.enumType('SellingPlanAnchorType', { values: ['WEEKDAY', 'MONTHDAY', 'YEARDAY'] as const });
const DeliveryIntent = builder.enumType('SellingPlanRecurringDeliveryPolicyIntent', { values: ['FULFILLMENT_BEGIN'] as const });
const PreAnchor = builder.enumType('SellingPlanRecurringDeliveryPolicyPreAnchorBehavior', { values: ['ASAP', 'NEXT'] as const });
const ERROR_CODES = [
  'BLANK', 'INVALID', 'TOO_LONG', 'TOO_BIG', 'TAKEN', 'GREATER_THAN', 'GREATER_THAN_OR_EQUAL_TO', 'LESS_THAN', 'NOT_A_NUMBER', 'NOT_FOUND', 'GROUP_DOES_NOT_EXIST', 'GROUP_COULD_NOT_BE_DELETED',
  'PRODUCT_DOES_NOT_EXIST', 'PRODUCT_VARIANT_DOES_NOT_EXIST', 'SELLING_PLAN_DOES_NOT_EXIST', 'BILLING_POLICY_INTERVAL_TOO_LARGE', 'DELIVERY_POLICY_INTERVAL_TOO_LARGE',
  'SELLING_PLAN_MAX_CYCLES_MUST_BE_GREATER_THAN_MIN_CYCLES', 'SELLING_PLAN_PRICING_POLICIES_LIMIT', 'SELLING_PLAN_DUPLICATE_PRICING_POLICY',
] as const;
const ErrorCode = builder.enumType('SellingPlanGroupUserErrorCode', { values: ERROR_CODES });
export const SellingPlanGroupUserError = builder.objectRef<UserError>('SellingPlanGroupUserError').implement({
  interfaces: [DisplayableError],
  fields: (t) => ({ code: t.field({ type: ErrorCode, nullable: true, resolve: (e) => (e.code && (ERROR_CODES as readonly string[]).includes(e.code) ? (e.code as (typeof ERROR_CODES)[number]) : null) }) }),
});

/* ------------------------------ output types ------------------------------ */

interface PlanShape extends PlanRow { currency: string }
interface PolicyShape { p: PlanPricingPolicy; currency: string; createdAt: Date }

export const SellingPlanAnchor = builder.objectRef<{ type: 'WEEKDAY' | 'MONTHDAY' | 'YEARDAY'; day: number; month: number | null; cutoffDay: number | null }>('SellingPlanAnchor').implement({
  fields: (t) => ({ type: t.field({ type: AnchorType, resolve: (a) => a.type }), day: t.exposeInt('day'), month: t.exposeInt('month', { nullable: true }), cutoffDay: t.exposeInt('cutoffDay', { nullable: true }) }),
});
const RecurringBilling = builder.objectRef<{ b: PlanBillingPolicy; createdAt: Date }>('SellingPlanRecurringBillingPolicy').implement({
  fields: (t) => ({
    interval: t.field({ type: SellingPlanInterval, resolve: (x) => x.b.interval }), intervalCount: t.int({ resolve: (x) => x.b.intervalCount }),
    minCycles: t.int({ nullable: true, resolve: (x) => x.b.minCycles }), maxCycles: t.int({ nullable: true, resolve: (x) => x.b.maxCycles }),
    anchors: t.field({ type: [SellingPlanAnchor], resolve: () => [] }), createdAt: t.field({ type: 'DateTime', resolve: (x) => x.createdAt }),
  }),
});
const BillingUnion = builder.unionType('SellingPlanBillingPolicy', { types: [RecurringBilling], resolveType: () => RecurringBilling });
const RecurringDelivery = builder.objectRef<{ d: PlanDeliveryPolicy; createdAt: Date }>('SellingPlanRecurringDeliveryPolicy').implement({
  fields: (t) => ({
    interval: t.field({ type: SellingPlanInterval, resolve: (x) => x.d.interval }), intervalCount: t.int({ resolve: (x) => x.d.intervalCount }),
    anchors: t.field({ type: [SellingPlanAnchor], resolve: () => [] }), cutoff: t.int({ nullable: true, resolve: () => null }),
    intent: t.field({ type: DeliveryIntent, resolve: () => 'FULFILLMENT_BEGIN' as const }), preAnchorBehavior: t.field({ type: PreAnchor, resolve: () => 'ASAP' as const }),
    createdAt: t.field({ type: 'DateTime', resolve: (x) => x.createdAt }),
  }),
});
const DeliveryUnion = builder.unionType('SellingPlanDeliveryPolicy', { types: [RecurringDelivery], resolveType: () => RecurringDelivery });
const PercentageValue = builder.objectRef<{ percentage: number }>('SellingPlanPricingPolicyPercentageValue').implement({ fields: (t) => ({ percentage: t.exposeFloat('percentage') }) });
const AdjustmentValue = builder.unionType('SellingPlanPricingPolicyAdjustmentValue', {
  types: [MoneyV2, PercentageValue], resolveType: (v) => ('percentage' in (v as object) ? PercentageValue : MoneyV2),
});
const valueOf = (x: PolicyShape) => (x.p.adjustmentType === 'PERCENTAGE' ? { percentage: x.p.adjustmentValue } : moneyV2(x.p.adjustmentValue, x.currency));
const PolicyBase = builder.interfaceRef<PolicyShape>('SellingPlanPricingPolicyBase').implement({
  fields: (t) => ({ adjustmentType: t.field({ type: AdjustmentType, resolve: (x) => x.p.adjustmentType }), adjustmentValue: t.field({ type: AdjustmentValue, resolve: (x) => valueOf(x) as never }) }),
});
const FixedPolicy = builder.objectRef<PolicyShape>('SellingPlanFixedPricingPolicy').implement({
  interfaces: [PolicyBase], fields: (t) => ({ createdAt: t.field({ type: 'DateTime', resolve: (x) => x.createdAt }) }),
});
const RecurringPolicy = builder.objectRef<PolicyShape>('SellingPlanRecurringPricingPolicy').implement({
  interfaces: [PolicyBase], fields: (t) => ({ afterCycle: t.int({ nullable: true, resolve: (x) => x.p.afterCycle }), createdAt: t.field({ type: 'DateTime', resolve: (x) => x.createdAt }) }),
});
const PolicyUnion = builder.unionType('SellingPlanPricingPolicy', { types: [FixedPolicy, RecurringPolicy], resolveType: (x) => ((x as PolicyShape).p.afterCycle > 0 ? RecurringPolicy : FixedPolicy) });
const InventoryPolicy = builder.objectRef<{ reserve: 'ON_FULFILLMENT' | 'ON_SALE' }>('SellingPlanInventoryPolicy').implement({
  fields: (t) => ({ reserve: t.field({ type: builder.enumType('SellingPlanReserve', { values: ['ON_FULFILLMENT', 'ON_SALE'] as const }), resolve: (x) => x.reserve }) }),
});

export const SellingPlan = builder.objectRef<PlanShape>('SellingPlan');
SellingPlan.implement({
  interfaces: [Node],
  fields: (t) => ({
    name: t.exposeString('name'),
    description: t.exposeString('description', { nullable: true }),
    options: t.stringList({ resolve: (p) => p.options }),
    position: t.exposeInt('position', { nullable: true }),
    category: t.field({ type: Category, nullable: true, resolve: (p) => p.category as 'SUBSCRIPTION' }),
    createdAt: t.field({ type: 'DateTime', resolve: (p) => p.createdAt }),
    billingPolicy: t.field({ type: BillingUnion, resolve: (p) => ({ b: p.billingPolicy, createdAt: p.createdAt }) }),
    deliveryPolicy: t.field({ type: DeliveryUnion, resolve: (p) => ({ d: p.deliveryPolicy, createdAt: p.createdAt }) }),
    pricingPolicies: t.field({ type: [PolicyUnion], resolve: (p) => p.pricingPolicies.map((x) => ({ p: x, currency: p.currency, createdAt: p.createdAt })) }),
    inventoryPolicy: t.field({ type: InventoryPolicy, nullable: true, resolve: () => ({ reserve: 'ON_SALE' as const }) }),
  }),
});
const SellingPlanConnection = defineConnection('SellingPlan', SellingPlan);

const plansOf = async (ctx: GraphQLContext, groupId: number): Promise<PlanShape[]> => {
  const currency = (await shopOf(ctx)).currency;
  return (await listSellingPlans(ctx.db, ctx.shopId, [groupId])).map((p) => ({ ...p, currency }));
};
const productIdArg = (raw: string | number) => parseId(String(raw), 'Product');

export const SellingPlanGroup = builder.objectRef<GroupRow>('SellingPlanGroup');
SellingPlanGroup.implement({
  interfaces: [Node],
  fields: (t) => ({
    name: t.exposeString('name'),
    merchantCode: t.exposeString('merchantCode'),
    description: t.exposeString('description', { nullable: true }),
    options: t.stringList({ resolve: (g) => g.options }),
    position: t.exposeInt('position', { nullable: true }),
    appId: t.exposeString('appId', { nullable: true }),
    createdAt: t.field({ type: 'DateTime', resolve: (g) => g.createdAt }),
    summary: t.string({ nullable: true, resolve: async (g, _a, ctx) => (await listSellingPlans(ctx.db, ctx.shopId, [g.id])).map((p) => p.name).join(', ') || null }),
    sellingPlans: t.field({ type: SellingPlanConnection, args: ConnectionArgs, resolve: async (g, a, ctx) => paginateArray(a, await plansOf(ctx, g.id)) }),
    sellingPlansCount: t.field({ type: Count, nullable: true, resolve: async (g, _a, ctx) => ({ count: (await listSellingPlans(ctx.db, ctx.shopId, [g.id])).length, precision: 'EXACT' as const }) }),
    products: t.field({
      type: ProductConnection, args: ConnectionArgs,
      resolve: async (g, a, ctx) => paginateArray(a, (await Promise.all((await groupProductIds(ctx.db, ctx.shopId, g.id)).map((id) => getProduct(ctx.db, ctx.shopId, id)))).filter((p) => p != null)),
    }),
    productsCount: t.field({ type: Count, nullable: true, resolve: async (g, _a, ctx) => ({ count: (await groupProductIds(ctx.db, ctx.shopId, g.id)).length, precision: 'EXACT' as const }) }),
    productVariants: t.field({
      type: ProductVariantConnection, args: { ...ConnectionArgs, productId: t.arg.id() },
      resolve: async (g, a, ctx) => {
        const vs = (await Promise.all((await groupVariantIds(ctx.db, ctx.shopId, g.id)).map((id) => getVariant(ctx.db, ctx.shopId, id)))).filter((v) => v != null);
        const pid = a.productId ? productIdArg(a.productId) : null;
        return paginateArray(a, pid ? vs.filter((v) => v.productId === pid) : vs);
      },
    }),
    productVariantsCount: t.field({ type: Count, nullable: true, args: { productId: t.arg.id() }, resolve: async (g, a, ctx) => {
      const vs = (await Promise.all((await groupVariantIds(ctx.db, ctx.shopId, g.id)).map((id) => getVariant(ctx.db, ctx.shopId, id)))).filter((v) => v != null);
      const pid = a.productId ? productIdArg(a.productId) : null;
      return { count: (pid ? vs.filter((v) => v.productId === pid) : vs).length, precision: 'EXACT' as const };
    } }),
    appliesToProduct: t.boolean({ args: { productId: t.arg.id({ required: true }) }, resolve: async (g, a, ctx) => (await groupProductIds(ctx.db, ctx.shopId, g.id)).includes(productIdArg(a.productId) ?? -1) }),
    appliesToProductVariant: t.boolean({ args: { productVariantId: t.arg.id({ required: true }) }, resolve: async (g, a, ctx) => (await groupVariantIds(ctx.db, ctx.shopId, g.id)).includes(parseId(String(a.productVariantId), 'ProductVariant') ?? -1) }),
    appliesToProductVariants: t.boolean({
      args: { productId: t.arg.id({ required: true }) },
      resolve: async (g, a, ctx) => {
        const pid = productIdArg(a.productId);
        const vs = await Promise.all((await groupVariantIds(ctx.db, ctx.shopId, g.id)).map((id) => getVariant(ctx.db, ctx.shopId, id)));
        return vs.some((v) => v?.productId === pid);
      },
    }),
  }),
});
const SellingPlanGroupConnection = defineConnection('SellingPlanGroup', SellingPlanGroup);
registerNode('SellingPlanGroup', (ctx, id) => getSellingPlanGroup(ctx.db, ctx.shopId, id));
registerNode('SellingPlan', async (ctx, id) => {
  const p = await getSellingPlan(ctx.db, ctx.shopId, id);
  return p ? { ...p, currency: (await shopOf(ctx)).currency } : null;
});

/** `Product.sellingPlanGroups`: groups attached to the product or to one of its variants. */
builder.objectFields(Product_, (t) => ({
  requiresSellingPlan: t.boolean({ resolve: (p) => p.requiresSellingPlan }),
  sellingPlanGroups: t.field({
    type: SellingPlanGroupConnection, args: ConnectionArgs,
    resolve: async (p, a, ctx) => paginateArray(a, await getSellingPlanGroups(ctx.db, ctx.shopId, ((await groupsForProducts(ctx.db, ctx.shopId, [p.id])).get(p.id) ?? []).map((g) => g.groupId))),
  }),
  sellingPlanGroupsCount: t.field({ type: Count, nullable: true, resolve: async (p, _a, ctx) => ({ count: ((await groupsForProducts(ctx.db, ctx.shopId, [p.id])).get(p.id) ?? []).length, precision: 'EXACT' as const }) }),
}));
builder.objectFields(ProductVariant, (t) => ({
  sellingPlanGroups: t.field({
    type: SellingPlanGroupConnection, args: ConnectionArgs,
    resolve: async (v, a, ctx) => paginateArray(a, await getSellingPlanGroups(ctx.db, ctx.shopId, (await groupsForVariants(ctx.db, ctx.shopId, [v.id])).get(v.id) ?? [])),
  }),
  sellingPlanGroupsCount: t.field({ type: Count, nullable: true, resolve: async (v, _a, ctx) => ({ count: ((await groupsForVariants(ctx.db, ctx.shopId, [v.id])).get(v.id) ?? []).length, precision: 'EXACT' as const }) }),
}));

/* ------------------------------ queries ------------------------------ */

builder.queryFields((t) => ({
  sellingPlanGroup: t.field({
    type: SellingPlanGroup, nullable: true, args: { id: t.arg.id({ required: true }) },
    resolve: async (_r, a, ctx) => { requireScope(ctx, 'read_purchase_options'); const id = parseId(String(a.id), 'SellingPlanGroup'); return id ? getSellingPlanGroup(ctx.db, ctx.shopId, id) : null; },
  }),
  sellingPlanGroups: t.field({
    type: SellingPlanGroupConnection, args: { ...ConnectionArgs, query: t.arg.string(), sortKey: t.arg({ type: SortKeys, defaultValue: 'ID' }) },
    resolve: (_r, a, ctx) => {
      requireScope(ctx, 'read_purchase_options');
      return paginate(a, {
        fetch: ({ offset, limit }) => listSellingPlanGroups(ctx.db, ctx.shopId, { query: a.query, sortKey: (a.sortKey ?? 'ID') as 'ID', reverse: !!a.reverse, offset, limit }),
        total: () => countSellingPlanGroups(ctx.db, ctx.shopId, a.query),
      });
    },
  }),
}));

/* ------------------------------ inputs ------------------------------ */

const AnchorInput = builder.inputType('SellingPlanAnchorInput', { fields: (t) => ({ type: t.field({ type: AnchorType }), day: t.int(), month: t.int(), cutoffDay: t.int() }) });
const RecurringBillingInput = builder.inputType('SellingPlanRecurringBillingPolicyInput', {
  fields: (t) => ({ interval: t.field({ type: SellingPlanInterval }), intervalCount: t.int(), anchors: t.field({ type: [AnchorInput] }), minCycles: t.int(), maxCycles: t.int() }),
});
const BillingInput = builder.inputType('SellingPlanBillingPolicyInput', { fields: (t) => ({ recurring: t.field({ type: RecurringBillingInput }) }) });
const RecurringDeliveryInput = builder.inputType('SellingPlanRecurringDeliveryPolicyInput', {
  fields: (t) => ({ interval: t.field({ type: SellingPlanInterval }), intervalCount: t.int(), anchors: t.field({ type: [AnchorInput] }), cutoff: t.int(), intent: t.field({ type: DeliveryIntent }), preAnchorBehavior: t.field({ type: PreAnchor }) }),
});
const DeliveryInput = builder.inputType('SellingPlanDeliveryPolicyInput', { fields: (t) => ({ recurring: t.field({ type: RecurringDeliveryInput }) }) });
const ValueInput = builder.inputType('SellingPlanPricingPolicyValueInput', { fields: (t) => ({ percentage: t.float(), fixedValue: t.field({ type: 'Decimal' }) }) });
const RecurringPolicyInput = builder.inputType('SellingPlanPricingPolicyRecurringInput', {
  fields: (t) => ({ id: t.id(), adjustmentType: t.field({ type: AdjustmentType }), adjustmentValue: t.field({ type: ValueInput }), afterCycle: t.int({ required: true }) }),
});
const FixedPolicyInput = builder.inputType('SellingPlanPricingPolicyFixedInput', { fields: (t) => ({ id: t.id(), adjustmentType: t.field({ type: AdjustmentType }), adjustmentValue: t.field({ type: ValueInput }) }) });
const PricingPolicyInput = builder.inputType('SellingPlanPricingPolicyInput', { fields: (t) => ({ recurring: t.field({ type: RecurringPolicyInput }), fixed: t.field({ type: FixedPolicyInput }) }) });
const InventoryPolicyInput = builder.inputType('SellingPlanInventoryPolicyInput', { fields: (t) => ({ reserve: t.string() }) });
const PlanInput = builder.inputType('SellingPlanInput', {
  fields: (t) => ({
    id: t.id(), name: t.string(), description: t.string(), billingPolicy: t.field({ type: BillingInput }), deliveryPolicy: t.field({ type: DeliveryInput }), inventoryPolicy: t.field({ type: InventoryPolicyInput }),
    pricingPolicies: t.field({ type: [PricingPolicyInput] }), options: t.stringList(), position: t.int(), category: t.field({ type: Category }),
  }),
});
const GroupInput = builder.inputType('SellingPlanGroupInput', {
  fields: (t) => ({
    name: t.string(), appId: t.string(), merchantCode: t.string(), description: t.string(), options: t.stringList(), position: t.int(),
    sellingPlansToCreate: t.field({ type: [PlanInput] }), sellingPlansToUpdate: t.field({ type: [PlanInput] }), sellingPlansToDelete: t.idList(),
  }),
});
const ResourceInput = builder.inputType('SellingPlanGroupResourceInput', { fields: (t) => ({ productVariantIds: t.idList(), productIds: t.idList() }) });

type PlanInShape = typeof PlanInput.$inferInput;
const fail = (field: string[], message: string, code = 'INVALID'): UserError[] => [{ field, message, code }];
const defined = <T extends object>(o: T): Partial<T> => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null)) as Partial<T>;

/** API plan input -> service input; `base` (the stored plan) fills what an update leaves out. */
function toPlan(i: PlanInShape, currency: string, path: string[], base?: PlanRow): { plan: PlanIn } | { errors: UserError[] } {
  const rb = i.billingPolicy?.recurring;
  const rd = i.deliveryPolicy?.recurring;
  const billing = rb ? { ...(base?.billingPolicy ?? {}), ...defined({ interval: rb.interval, intervalCount: rb.intervalCount }), minCycles: rb.minCycles !== undefined ? rb.minCycles ?? null : base?.billingPolicy.minCycles ?? null, maxCycles: rb.maxCycles !== undefined ? rb.maxCycles ?? null : base?.billingPolicy.maxCycles ?? null } as PlanBillingPolicy : undefined;
  const delivery = rd ? { ...(base?.deliveryPolicy ?? {}), ...defined({ interval: rd.interval, intervalCount: rd.intervalCount }) } as PlanDeliveryPolicy : undefined;
  let pricing: PlanPricingPolicy[] | undefined;
  if (i.pricingPolicies) {
    pricing = [];
    for (const [k, pp] of i.pricingPolicies.entries()) {
      const src = pp.fixed ?? pp.recurring;
      if (!src || (pp.fixed && pp.recurring)) return { errors: fail([...path, 'pricingPolicies', String(k)], 'Give either a fixed or a recurring pricing policy') };
      const type = src.adjustmentType ?? 'PERCENTAGE';
      const v = src.adjustmentValue;
      let value: number;
      if (type === 'PERCENTAGE') value = v?.percentage ?? NaN;
      else { try { value = v?.fixedValue != null ? parseMoney(v.fixedValue, currency) : NaN; } catch { value = NaN; } }
      if (!Number.isFinite(value)) return { errors: fail([...path, 'pricingPolicies', String(k), 'adjustmentValue'], 'Adjustment value is invalid', 'NOT_A_NUMBER') };
      pricing.push({ adjustmentType: type, adjustmentValue: value, afterCycle: pp.recurring ? pp.recurring.afterCycle : 0 });
    }
  }
  return { plan: { id: i.id ? parseId(String(i.id), 'SellingPlan') : null, name: i.name, description: i.description, options: i.options, position: i.position, category: i.category, billingPolicy: billing, deliveryPolicy: delivery, pricingPolicies: pricing } };
}

async function toGroup(ctx: GraphQLContext, i: typeof GroupInput.$inferInput, existing: PlanRow[] = []): Promise<{ input: GroupIn } | { errors: UserError[] }> {
  const currency = (await shopOf(ctx)).currency;
  const create: PlanIn[] = [];
  const update: PlanIn[] = [];
  for (const [k, p] of (i.sellingPlansToCreate ?? []).entries()) { const r = toPlan(p, currency, ['input', 'sellingPlansToCreate', String(k)]); if ('errors' in r) return r; create.push(r.plan); }
  for (const [k, p] of (i.sellingPlansToUpdate ?? []).entries()) {
    const id = p.id ? parseId(String(p.id), 'SellingPlan') : null;
    const base = existing.find((e) => e.id === id);
    if (!base) return { errors: fail(['input', 'sellingPlansToUpdate', String(k), 'id'], 'Selling plan does not exist', 'SELLING_PLAN_DOES_NOT_EXIST') };
    const r = toPlan(p, currency, ['input', 'sellingPlansToUpdate', String(k)], base); if ('errors' in r) return r; update.push(r.plan);
  }
  const del = (i.sellingPlansToDelete ?? []).map((x) => parseId(String(x), 'SellingPlan'));
  if (del.some((x) => x == null)) return { errors: fail(['input', 'sellingPlansToDelete'], 'Selling plan does not exist', 'SELLING_PLAN_DOES_NOT_EXIST') };
  return { input: { name: i.name, merchantCode: i.merchantCode, description: i.description, options: i.options, position: i.position, appId: i.appId, plansToCreate: create, plansToUpdate: update, plansToDelete: del as number[] } };
}

const ids = (xs: (string | number)[] | null | undefined, type: string) => (xs ?? []).map((x) => parseId(String(x), type));
const staffOf = (ctx: GraphQLContext) => (ctx.auth.kind === 'session' ? ctx.auth.user.id : null);

/* ------------------------------ payloads ------------------------------ */

type GroupPayload = { sellingPlanGroup: GroupRow | null; userErrors: UserError[] };
const groupPayload = (name: string) => builder.objectRef<GroupPayload>(name).implement({
  fields: (t) => ({ sellingPlanGroup: t.field({ type: SellingPlanGroup, nullable: true, resolve: (p) => p.sellingPlanGroup }), userErrors: t.field({ type: [SellingPlanGroupUserError], resolve: (p) => p.userErrors }) }),
});
const CreatePayload = groupPayload('SellingPlanGroupCreatePayload');
const AddProductsPayload = groupPayload('SellingPlanGroupAddProductsPayload');
const AddVariantsPayload = groupPayload('SellingPlanGroupAddProductVariantsPayload');
const UpdatePayload = builder.objectRef<GroupPayload & { deletedSellingPlanIds: string[] | null }>('SellingPlanGroupUpdatePayload').implement({
  fields: (t) => ({
    sellingPlanGroup: t.field({ type: SellingPlanGroup, nullable: true, resolve: (p) => p.sellingPlanGroup }), deletedSellingPlanIds: t.idList({ nullable: true, resolve: (p) => p.deletedSellingPlanIds }),
    userErrors: t.field({ type: [SellingPlanGroupUserError], resolve: (p) => p.userErrors }),
  }),
});
const DeletePayload = builder.objectRef<{ deletedSellingPlanGroupId: string | null; userErrors: UserError[] }>('SellingPlanGroupDeletePayload').implement({
  fields: (t) => ({ deletedSellingPlanGroupId: t.id({ nullable: true, resolve: (p) => p.deletedSellingPlanGroupId }), userErrors: t.field({ type: [SellingPlanGroupUserError], resolve: (p) => p.userErrors }) }),
});
const RemoveProductsPayload = builder.objectRef<{ removedProductIds: string[] | null; userErrors: UserError[] }>('SellingPlanGroupRemoveProductsPayload').implement({
  fields: (t) => ({ removedProductIds: t.idList({ nullable: true, resolve: (p) => p.removedProductIds }), userErrors: t.field({ type: [SellingPlanGroupUserError], resolve: (p) => p.userErrors }) }),
});
const RemoveVariantsPayload = builder.objectRef<{ removedProductVariantIds: string[] | null; userErrors: UserError[] }>('SellingPlanGroupRemoveProductVariantsPayload').implement({
  fields: (t) => ({ removedProductVariantIds: t.idList({ nullable: true, resolve: (p) => p.removedProductVariantIds }), userErrors: t.field({ type: [SellingPlanGroupUserError], resolve: (p) => p.userErrors }) }),
});

async function changeResources(ctx: GraphQLContext, rawId: string | number, op: 'add' | 'remove', kind: 'products' | 'variants', raw: (string | number)[]) {
  requireScope(ctx, 'write_purchase_options');
  const id = parseId(String(rawId), 'SellingPlanGroup');
  const field = kind === 'products' ? 'productIds' : 'productVariantIds';
  const parsed = ids(raw, kind === 'products' ? 'Product' : 'ProductVariant');
  if (!id) return { ok: false as const, errors: fail(['id'], 'Selling plan group does not exist', 'GROUP_DOES_NOT_EXIST') };
  if (parsed.some((x) => x == null)) return { ok: false as const, errors: fail([field], kind === 'products' ? 'Product does not exist' : 'Product variant does not exist', kind === 'products' ? 'PRODUCT_DOES_NOT_EXIST' : 'PRODUCT_VARIANT_DOES_NOT_EXIST') };
  return changeGroupResources(ctx.db, ctx.shopId, id, op, kind, parsed as number[]);
}

/* ------------------------------ mutations ------------------------------ */

builder.mutationFields((t) => ({
  sellingPlanGroupCreate: t.field({
    type: CreatePayload, args: { input: t.arg({ type: GroupInput, required: true }), resources: t.arg({ type: ResourceInput }) },
    resolve: async (_r, a, ctx) => {
      requireScope(ctx, 'write_purchase_options');
      const g = await toGroup(ctx, a.input);
      if ('errors' in g) return { sellingPlanGroup: null, userErrors: g.errors };
      const productIds = ids(a.resources?.productIds, 'Product');
      const variantIds = ids(a.resources?.productVariantIds, 'ProductVariant');
      if (productIds.some((x) => x == null)) return { sellingPlanGroup: null, userErrors: fail(['resources', 'productIds'], 'Product does not exist', 'PRODUCT_DOES_NOT_EXIST') };
      if (variantIds.some((x) => x == null)) return { sellingPlanGroup: null, userErrors: fail(['resources', 'productVariantIds'], 'Product variant does not exist', 'PRODUCT_VARIANT_DOES_NOT_EXIST') };
      const r = await createSellingPlanGroup(ctx.db, ctx.shopId, g.input, { productIds: productIds as number[], variantIds: variantIds as number[] }, staffOf(ctx));
      return r.ok ? { sellingPlanGroup: r.value, userErrors: [] } : { sellingPlanGroup: null, userErrors: r.errors };
    },
  }),
  sellingPlanGroupUpdate: t.field({
    type: UpdatePayload, args: { id: t.arg.id({ required: true }), input: t.arg({ type: GroupInput, required: true }) },
    resolve: async (_r, a, ctx) => {
      requireScope(ctx, 'write_purchase_options');
      const id = parseId(String(a.id), 'SellingPlanGroup');
      const none = { sellingPlanGroup: null, deletedSellingPlanIds: null };
      if (!id || !(await getSellingPlanGroup(ctx.db, ctx.shopId, id))) return { ...none, userErrors: fail(['id'], 'Selling plan group does not exist', 'GROUP_DOES_NOT_EXIST') };
      const g = await toGroup(ctx, a.input, await listSellingPlans(ctx.db, ctx.shopId, [id]));
      if ('errors' in g) return { ...none, userErrors: g.errors };
      const r = await updateSellingPlanGroup(ctx.db, ctx.shopId, id, g.input, staffOf(ctx));
      return r.ok ? { sellingPlanGroup: r.value.group, deletedSellingPlanIds: r.value.deletedPlanIds.map((x) => toGid('SellingPlan', x)), userErrors: [] } : { ...none, userErrors: r.errors };
    },
  }),
  sellingPlanGroupDelete: t.field({
    type: DeletePayload, args: { id: t.arg.id({ required: true }) },
    resolve: async (_r, a, ctx) => {
      requireScope(ctx, 'write_purchase_options');
      const id = parseId(String(a.id), 'SellingPlanGroup');
      const r = id ? await deleteSellingPlanGroup(ctx.db, ctx.shopId, id) : null;
      return r?.ok ? { deletedSellingPlanGroupId: toGid('SellingPlanGroup', r.value), userErrors: [] } : { deletedSellingPlanGroupId: null, userErrors: fail(['id'], 'Selling plan group does not exist', 'GROUP_DOES_NOT_EXIST') };
    },
  }),
  sellingPlanGroupAddProducts: t.field({
    type: AddProductsPayload, args: { id: t.arg.id({ required: true }), productIds: t.arg.idList({ required: true }) },
    resolve: async (_r, a, ctx) => { const r = await changeResources(ctx, a.id, 'add', 'products', a.productIds); return r.ok ? { sellingPlanGroup: r.value.group, userErrors: [] } : { sellingPlanGroup: null, userErrors: r.errors }; },
  }),
  sellingPlanGroupRemoveProducts: t.field({
    type: RemoveProductsPayload, args: { id: t.arg.id({ required: true }), productIds: t.arg.idList({ required: true }) },
    resolve: async (_r, a, ctx) => { const r = await changeResources(ctx, a.id, 'remove', 'products', a.productIds); return r.ok ? { removedProductIds: r.value.ids.map((x) => toGid('Product', x)), userErrors: [] } : { removedProductIds: null, userErrors: r.errors }; },
  }),
  sellingPlanGroupAddProductVariants: t.field({
    type: AddVariantsPayload, args: { id: t.arg.id({ required: true }), productVariantIds: t.arg.idList({ required: true }) },
    resolve: async (_r, a, ctx) => { const r = await changeResources(ctx, a.id, 'add', 'variants', a.productVariantIds); return r.ok ? { sellingPlanGroup: r.value.group, userErrors: [] } : { sellingPlanGroup: null, userErrors: r.errors }; },
  }),
  sellingPlanGroupRemoveProductVariants: t.field({
    type: RemoveVariantsPayload, args: { id: t.arg.id({ required: true }), productVariantIds: t.arg.idList({ required: true }) },
    resolve: async (_r, a, ctx) => { const r = await changeResources(ctx, a.id, 'remove', 'variants', a.productVariantIds); return r.ok ? { removedProductVariantIds: r.value.ids.map((x) => toGid('ProductVariant', x)), userErrors: [] } : { removedProductVariantIds: null, userErrors: r.errors }; },
  }),
}));
