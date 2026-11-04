import {
  countCodeDiscounts, createCodeDiscount, deleteCodeDiscount, effectiveStatus, getCodeDiscount, getCodeDiscountByCode, getCollection, getProduct, listCodeDiscounts, setDiscountActive, updateCodeDiscount,
  type CodeDiscount, type CodeDiscountInput,
} from '@shopme/core';
import { parseId, parseMoney, toGid, type UserError } from '@shopme/shopify-compat';
import { builder } from '../builder';
import { requireScope, type GraphQLContext } from '../context';
import { ConnectionArgs, defineConnection, paginate, paginateArray } from '../types/connection';
import { DisplayableError } from '../types/errors';
import { Count, MoneyV2, moneyV2 } from '../types/money';
import { Node, legacyId, registerNode } from '../types/node';
import { Collection_, CollectionConnection, ProductConnection, shopOf } from '../types/catalog';

const Status = builder.enumType('DiscountStatus', { values: ['ACTIVE', 'EXPIRED', 'SCHEDULED'] as const });
const DiscountClass = builder.enumType('DiscountClass', { values: ['PRODUCT', 'ORDER', 'SHIPPING'] as const });
const SortKeys = builder.enumType('CodeDiscountSortKeys', { values: ['CREATED_AT', 'ENDS_AT', 'ID', 'RELEVANCE', 'STARTS_AT', 'TITLE', 'UPDATED_AT'] as const });
const DiscountSortKeys = builder.enumType('DiscountSortKeys', { values: ['CREATED_AT', 'ENDS_AT', 'ID', 'RELEVANCE', 'STARTS_AT', 'TITLE', 'UPDATED_AT'] as const });
const BuyerSelection = builder.enumType('DiscountBuyerSelection', { values: ['ALL'] as const });
const ErrorCode = builder.enumType('DiscountErrorCode', {
  values: ['BLANK', 'PRESENT', 'EQUAL_TO', 'GREATER_THAN', 'GREATER_THAN_OR_EQUAL_TO', 'INVALID', 'LESS_THAN_OR_EQUAL_TO', 'LESS_THAN', 'TAKEN', 'TOO_LONG', 'TOO_SHORT', 'INTERNAL_ERROR', 'TOO_MANY_ARGUMENTS',
    'MISSING_ARGUMENT', 'ACTIVE_PERIOD_OVERLAP', 'END_DATE_BEFORE_START_DATE', 'EXCEEDED_MAX', 'MINIMUM_SUBTOTAL_AND_QUANTITY_RANGE_BOTH_PRESENT', 'VALUE_OUTSIDE_RANGE', 'CONFLICT', 'IMPLICIT_DUPLICATE',
    'DUPLICATE', 'INCLUSION', 'APPLIES_ON_NOTHING'] as const,
});
const ErrorCode_values = new Set(['BLANK', 'PRESENT', 'EQUAL_TO', 'GREATER_THAN', 'GREATER_THAN_OR_EQUAL_TO', 'INVALID', 'LESS_THAN_OR_EQUAL_TO', 'LESS_THAN', 'TAKEN', 'TOO_LONG', 'TOO_SHORT', 'INTERNAL_ERROR', 'TOO_MANY_ARGUMENTS',
  'MISSING_ARGUMENT', 'ACTIVE_PERIOD_OVERLAP', 'END_DATE_BEFORE_START_DATE', 'EXCEEDED_MAX', 'MINIMUM_SUBTOTAL_AND_QUANTITY_RANGE_BOTH_PRESENT', 'VALUE_OUTSIDE_RANGE', 'CONFLICT', 'IMPLICIT_DUPLICATE',
  'DUPLICATE', 'INCLUSION', 'APPLIES_ON_NOTHING']);

const DiscountUserError = builder.objectRef<UserError & { extraInfo?: string | null }>('DiscountUserError').implement({
  interfaces: [DisplayableError],
  fields: (t) => ({
    code: t.field({ type: ErrorCode, nullable: true, resolve: (e) => (e.code && ErrorCode_values.has(e.code) ? e.code : null) as never }),
    extraInfo: t.string({ nullable: true, resolve: () => null }),
  }),
});
/* ------------------------------ output types ------------------------------ */

type Ctx = GraphQLContext;
interface Shape extends CodeDiscount { currency: string }

const DiscountPercentage = builder.objectRef<{ percentage: number }>('DiscountPercentage').implement({ fields: (t) => ({ percentage: t.exposeFloat('percentage') }) });
const DiscountAmount = builder.objectRef<{ amount: ReturnType<typeof moneyV2>; appliesOnEachItem: boolean }>('DiscountAmount').implement({
  fields: (t) => ({ amount: t.field({ type: MoneyV2, resolve: (a) => a.amount }), appliesOnEachItem: t.exposeBoolean('appliesOnEachItem') }),
});
const ValueUnion = builder.unionType('DiscountCustomerGetsValue', {
  types: [DiscountAmount, DiscountPercentage],
  resolveType: (v) => ('percentage' in (v as object) ? DiscountPercentage : DiscountAmount),
});
const AllDiscountItems = builder.objectRef<{ allItems: boolean }>('AllDiscountItems').implement({ fields: (t) => ({ allItems: t.exposeBoolean('allItems') }) });
const DiscountProducts = builder.objectRef<Shape>('DiscountProducts').implement({
  fields: (t) => ({
    products: t.field({
      type: ProductConnection, args: ConnectionArgs,
      resolve: async (d, a, ctx) => paginateArray(a, (await Promise.all((d.appliesTo.productIds ?? []).map((id) => getProduct(ctx.db, ctx.shopId, id)))).filter((p) => p != null)),
    }),
  }),
});
const DiscountCollections = builder.objectRef<Shape>('DiscountCollections').implement({
  fields: (t) => ({
    collections: t.field({
      type: CollectionConnection, args: ConnectionArgs,
      resolve: async (d, a, ctx) => paginateArray(a, (await Promise.all((d.appliesTo.collectionIds ?? []).map((id) => getCollection(ctx.db, ctx.shopId, id)))).filter((c) => c != null)),
    }),
  }),
});
void Collection_;
const ItemsUnion = builder.unionType('DiscountItems', {
  types: [AllDiscountItems, DiscountProducts, DiscountCollections],
  resolveType: (v) => ('allItems' in (v as object) ? AllDiscountItems : (v as Shape).appliesTo.collectionIds?.length && !(v as Shape).appliesTo.productIds?.length ? DiscountCollections : DiscountProducts),
});
const CustomerGets = builder.objectRef<Shape>('DiscountCustomerGets').implement({
  fields: (t) => ({
    appliesOnOneTimePurchase: t.boolean({ resolve: () => true }),
    appliesOnSubscription: t.boolean({ resolve: () => false }),
    value: t.field({
      type: ValueUnion,
      resolve: (d) => (d.valueType === 'PERCENTAGE' ? { percentage: d.value / 10000 } : { amount: moneyV2(d.value, d.currency), appliesOnEachItem: d.target === 'PRODUCTS' }),
    }),
    items: t.field({ type: ItemsUnion, resolve: (d) => (d.target === 'PRODUCTS' ? d : { allItems: true }) }),
  }),
});
const MinQuantity = builder.objectRef<{ q: number }>('DiscountMinimumQuantity').implement({ fields: (t) => ({ greaterThanOrEqualToQuantity: t.field({ type: 'UnsignedInt64', resolve: (m) => String(m.q) }) }) });
const MinSubtotal = builder.objectRef<{ amount: ReturnType<typeof moneyV2> }>('DiscountMinimumSubtotal').implement({
  fields: (t) => ({ greaterThanOrEqualToSubtotal: t.field({ type: MoneyV2, resolve: (m) => m.amount }) }),
});
const MinUnion = builder.unionType('DiscountMinimumRequirement', { types: [MinQuantity, MinSubtotal], resolveType: (v) => ('q' in (v as object) ? MinQuantity : MinSubtotal) });
const minimumOf = (d: Shape) => (d.minimumQuantity != null ? { q: d.minimumQuantity } : d.minimumSubtotal != null ? { amount: moneyV2(d.minimumSubtotal, d.currency) } : null);

const CombinesWith = builder.objectRef<Record<string, never>>('DiscountCombinesWith').implement({
  fields: (t) => ({
    orderDiscounts: t.boolean({ resolve: () => false }), productDiscounts: t.boolean({ resolve: () => false }), shippingDiscounts: t.boolean({ resolve: () => false }),
    productDiscountsWithTagsOnSameCartLine: t.stringList({ nullable: true, resolve: () => null }),
  }),
});
const BuyerAll = builder.objectRef<{ all: 'ALL' }>('DiscountBuyerSelectionAll').implement({ fields: (t) => ({ all: t.field({ type: BuyerSelection, resolve: () => 'ALL' as const }) }) });
const ContextUnion = builder.unionType('DiscountContext', { types: [BuyerAll], resolveType: () => BuyerAll });
const CountryAll = builder.objectRef<{ allCountries: boolean }>('DiscountCountryAll').implement({ fields: (t) => ({ allCountries: t.exposeBoolean('allCountries') }) });
const DestinationUnion = builder.unionType('DiscountShippingDestinationSelection', { types: [CountryAll], resolveType: () => CountryAll });

const RedeemCode = builder.objectRef<{ id: number; code: string; usageCount: number; createdAtIso: Date }>('DiscountRedeemCode').implement({
  fields: (t) => ({
    id: t.id({ resolve: (c) => toGid('DiscountRedeemCode', c.id) }), code: t.exposeString('code'), asyncUsageCount: t.exposeInt('usageCount'),
    createdAt: t.field({ type: 'DateTime', resolve: (c) => c.createdAtIso }),
  }),
});
const RedeemCodeConnection = defineConnection('DiscountRedeemCode', RedeemCode);

const summaryOf = (d: Shape) => {
  const what = d.target === 'SHIPPING' ? 'Free shipping' : d.valueType === 'PERCENTAGE' ? `${d.value / 100}% off` : `${moneyV2(d.value, d.currency).amount} ${d.currency} off`;
  const scope = d.target === 'PRODUCTS' ? ' selected items' : d.target === 'ORDER' ? ' entire order' : '';
  return `${what}${scope}`;
};

/** Fields shared by both code discount types. */
const common = (t: PothosSchemaTypes.ObjectFieldBuilder<PothosSchemaTypes.ExtendDefaultTypes<import('../builder').SchemaTypes>, Shape>) => ({
  title: t.exposeString('title'),
  status: t.field({ type: Status, resolve: (d) => effectiveStatus(d) }),
  startsAt: t.field({ type: 'DateTime', resolve: (d) => d.startsAt ?? d.createdAt }),
  endsAt: t.field({ type: 'DateTime', nullable: true, resolve: (d) => d.endsAt }),
  createdAt: t.field({ type: 'DateTime', resolve: (d) => d.createdAt }),
  updatedAt: t.field({ type: 'DateTime', resolve: (d) => d.updatedAt }),
  usageLimit: t.exposeInt('usageLimit', { nullable: true }),
  appliesOncePerCustomer: t.exposeBoolean('oncePerCustomer'),
  asyncUsageCount: t.exposeInt('usageCount'),
  recurringCycleLimit: t.int({ nullable: true, resolve: () => null }),
  hasTimelineComment: t.boolean({ resolve: () => false }),
  tags: t.stringList({ resolve: () => [] }),
  totalSales: t.field({ type: MoneyV2, nullable: true, resolve: () => null }),
  summary: t.string({ resolve: summaryOf }),
  shortSummary: t.string({ resolve: summaryOf }),
  combinesWith: t.field({ type: CombinesWith, resolve: () => ({}) }),
  context: t.field({ type: ContextUnion, resolve: () => ({ all: 'ALL' as const }) }),
  minimumRequirement: t.field({ type: MinUnion, nullable: true, resolve: minimumOf }),
  discountClasses: t.field({ type: [DiscountClass], resolve: (d) => [d.target === 'SHIPPING' ? 'SHIPPING' : d.target === 'PRODUCTS' ? 'PRODUCT' : 'ORDER'] as ('ORDER')[] }),
  codesCount: t.field({ type: Count, nullable: true, resolve: (d) => ({ count: d.codes.length, precision: 'EXACT' as const }) }),
  codes: t.field({
    type: RedeemCodeConnection, args: { ...ConnectionArgs, sortKey: t.arg.string(), query: t.arg.string(), savedSearchId: t.arg.id() },
    resolve: (d, a) => paginateArray(a, d.codes.map((c) => ({ id: c.id, code: c.code, usageCount: c.usageCount, createdAtIso: d.createdAt }))),
  }),
  shareableUrls: t.stringList({ resolve: () => [] }),
});

const DiscountCodeBasic = builder.objectRef<Shape>('DiscountCodeBasic').implement({
  fields: (t) => ({ ...common(t), customerGets: t.field({ type: CustomerGets, resolve: (d) => d }) }),
});
const DiscountCodeFreeShipping = builder.objectRef<Shape>('DiscountCodeFreeShipping').implement({
  fields: (t) => ({
    ...common(t),
    appliesOnOneTimePurchase: t.boolean({ resolve: () => true }), appliesOnSubscription: t.boolean({ resolve: () => false }),
    destinationSelection: t.field({ type: DestinationUnion, resolve: () => ({ allCountries: true }) }),
    maximumShippingPrice: t.field({ type: MoneyV2, nullable: true, resolve: () => null }),
  }),
});
const isFreeShipping = (d: Shape) => d.target === 'SHIPPING';
const DiscountCodeUnion = builder.unionType('DiscountCode', { types: [DiscountCodeBasic, DiscountCodeFreeShipping], resolveType: (d) => (isFreeShipping(d as Shape) ? DiscountCodeFreeShipping : DiscountCodeBasic) });
const DiscountUnion = builder.unionType('Discount', { types: [DiscountCodeBasic, DiscountCodeFreeShipping], resolveType: (d) => (isFreeShipping(d as Shape) ? DiscountCodeFreeShipping : DiscountCodeBasic) });

/** `DiscountCodeNode.id` and `DiscountNode.id` are both `gid://shopify/DiscountCodeNode/<id>` for code discounts. */
const CodeNode = builder.objectRef<Shape>('DiscountCodeNode').implement({
  interfaces: [Node],
  fields: (t) => ({
    id: t.id({ resolve: (d) => toGid('DiscountCodeNode', d.id) }),
    codeDiscount: t.field({ type: DiscountCodeUnion, resolve: (d) => d }),
  }),
});
const DiscountNode = builder.objectRef<Shape>('DiscountNode').implement({
  interfaces: [Node],
  fields: (t) => ({
    id: t.id({ resolve: (d) => toGid('DiscountCodeNode', d.id) }),
    discount: t.field({ type: DiscountUnion, resolve: (d) => d }),
  }),
});
const CodeNodeConnection = defineConnection('DiscountCodeNode', CodeNode);
const DiscountNodeConnection = defineConnection('DiscountNode', DiscountNode);

const withCurrency = async (ctx: Ctx, d: CodeDiscount | null): Promise<Shape | null> => (d ? { ...d, currency: (await shopOf(ctx)).currency } : null);
const load = async (ctx: Ctx, d: CodeDiscount) => (await withCurrency(ctx, d))!;
const codeId = (raw: string | number) => parseId(String(raw), 'DiscountCodeNode') ?? parseId(String(raw), 'DiscountNode');
registerNode('DiscountCodeNode', async (ctx, id) => withCurrency(ctx, await getCodeDiscount(ctx.db, ctx.shopId, id)));
registerNode('DiscountNode', async (ctx, id) => withCurrency(ctx, await getCodeDiscount(ctx.db, ctx.shopId, id)));
void legacyId;

/* ------------------------------ queries ------------------------------ */

builder.queryFields((t) => ({
  codeDiscountNode: t.field({
    type: CodeNode, nullable: true, args: { id: t.arg.id({ required: true }) },
    resolve: async (_r, a, ctx) => { requireScope(ctx, 'read_discounts'); const id = codeId(a.id); return id ? withCurrency(ctx, await getCodeDiscount(ctx.db, ctx.shopId, id)) : null; },
  }),
  codeDiscountNodeByCode: t.field({
    type: CodeNode, nullable: true, args: { code: t.arg.string({ required: true }) },
    resolve: async (_r, a, ctx) => { requireScope(ctx, 'read_discounts'); return withCurrency(ctx, await getCodeDiscountByCode(ctx.db, ctx.shopId, a.code)); },
  }),
  codeDiscountNodes: t.field({
    type: CodeNodeConnection, args: { ...ConnectionArgs, sortKey: t.arg({ type: SortKeys, defaultValue: 'ID' }), query: t.arg.string(), savedSearchId: t.arg.id() },
    resolve: (_r, a, ctx) => { requireScope(ctx, 'read_discounts'); return page(ctx, a); },
  }),
  discountNode: t.field({
    type: DiscountNode, nullable: true, args: { id: t.arg.id({ required: true }) },
    resolve: async (_r, a, ctx) => { requireScope(ctx, 'read_discounts'); const id = codeId(a.id); return id ? withCurrency(ctx, await getCodeDiscount(ctx.db, ctx.shopId, id)) : null; },
  }),
  discountNodes: t.field({
    type: DiscountNodeConnection, args: { ...ConnectionArgs, sortKey: t.arg({ type: DiscountSortKeys, defaultValue: 'ID' }), query: t.arg.string(), savedSearchId: t.arg.id() },
    resolve: (_r, a, ctx) => { requireScope(ctx, 'read_discounts'); return page(ctx, a); },
  }),
  discountNodesCount: t.field({
    type: Count, nullable: true, args: { query: t.arg.string(), savedSearchId: t.arg.id(), limit: t.arg.int({ defaultValue: 10000 }) },
    resolve: (_r, a, ctx) => { requireScope(ctx, 'read_discounts'); return countCodeDiscounts(ctx.db, ctx.shopId, a.query, a.limit ?? 10000); },
  }),
}));

function page(ctx: Ctx, a: { first?: number | null; after?: string | null; last?: number | null; before?: string | null; reverse?: boolean | null; sortKey?: string | null; query?: string | null }) {
  return paginate(a, {
    fetch: async ({ offset, limit }) => Promise.all((await listCodeDiscounts(ctx.db, ctx.shopId, { query: a.query, sortKey: (a.sortKey ?? 'ID') as 'ID', reverse: !!a.reverse, offset, limit })).map((d) => load(ctx, d))),
    total: async () => (await countCodeDiscounts(ctx.db, ctx.shopId, a.query)).count,
  });
}

/* ------------------------------ inputs ------------------------------ */

const CombinesWithInput = builder.inputType('DiscountCombinesWithInput', {
  fields: (t) => ({ productDiscounts: t.boolean({ defaultValue: false }), orderDiscounts: t.boolean({ defaultValue: false }), shippingDiscounts: t.boolean({ defaultValue: false }) }),
});
const ContextInput = builder.inputType('DiscountContextInput', { fields: (t) => ({ all: t.field({ type: BuyerSelection }) }) });
const MinRequirementInput = builder.inputType('DiscountMinimumRequirementInput', {
  fields: (t) => ({
    quantity: t.field({ type: builder.inputType('DiscountMinimumQuantityInput', { fields: (u) => ({ greaterThanOrEqualToQuantity: u.field({ type: 'UnsignedInt64' }) }) }) }),
    subtotal: t.field({ type: builder.inputType('DiscountMinimumSubtotalInput', { fields: (u) => ({ greaterThanOrEqualToSubtotal: u.field({ type: 'Decimal' }) }) }) }),
  }),
});
const GetsInput = builder.inputType('DiscountCustomerGetsInput', {
  fields: (t) => ({
    value: t.field({
      type: builder.inputType('DiscountCustomerGetsValueInput', {
        fields: (u) => ({
          percentage: u.float(),
          discountAmount: u.field({ type: builder.inputType('DiscountAmountInput', { fields: (v) => ({ amount: v.field({ type: 'Decimal' }), appliesOnEachItem: v.boolean() }) }) }),
        }),
      }),
    }),
    items: t.field({
      type: builder.inputType('DiscountItemsInput', {
        fields: (u) => ({
          all: u.boolean(),
          products: u.field({ type: builder.inputType('DiscountProductsInput', { fields: (v) => ({ productsToAdd: v.idList(), productsToRemove: v.idList(), productVariantsToAdd: v.idList(), productVariantsToRemove: v.idList() }) }) }),
          collections: u.field({ type: builder.inputType('DiscountCollectionsInput', { fields: (v) => ({ add: v.idList(), remove: v.idList() }) }) }),
        }),
      }),
    }),
    appliesOnOneTimePurchase: t.boolean(), appliesOnSubscription: t.boolean(),
  }),
});
const base = (t: PothosSchemaTypes.InputFieldBuilder<PothosSchemaTypes.ExtendDefaultTypes<import('../builder').SchemaTypes>, 'InputObject'>) => ({
  combinesWith: t.field({ type: CombinesWithInput }), title: t.string(), startsAt: t.field({ type: 'DateTime' }), endsAt: t.field({ type: 'DateTime' }),
  appliesOncePerCustomer: t.boolean(), code: t.string(), usageLimit: t.int(), context: t.field({ type: ContextInput }), tags: t.stringList(),
  minimumRequirement: t.field({ type: MinRequirementInput }), recurringCycleLimit: t.int(),
});
const BasicInput = builder.inputType('DiscountCodeBasicInput', { fields: (t) => ({ ...base(t), customerGets: t.field({ type: GetsInput }) }) });
const FreeShippingInput = builder.inputType('DiscountCodeFreeShippingInput', {
  fields: (t) => ({
    ...base(t), maximumShippingPrice: t.field({ type: 'Decimal' }), appliesOnOneTimePurchase: t.boolean(), appliesOnSubscription: t.boolean(),
    destination: t.field({ type: builder.inputType('DiscountShippingDestinationSelectionInput', { fields: (u) => ({ all: u.boolean({ defaultValue: false }) }) }) }),
  }),
});

type BasicIn = typeof BasicInput.$inferInput;
type FreeIn = typeof FreeShippingInput.$inferInput;
const fail = (field: string[], message: string, code = 'INVALID'): UserError[] => [{ field, message, code }];
const ids = (xs: (string | number)[] | null | undefined, type: string) => (xs ?? []).map((x) => parseId(String(x), type));

/** API input -> service input; returns userErrors when something unsupported or malformed is requested. */
async function convert(ctx: Ctx, root: string, i: BasicIn | FreeIn, kind: 'basic' | 'free', cur: CodeDiscount | null): Promise<{ input: CodeDiscountInput } | { errors: UserError[] }> {
  const currency = (await shopOf(ctx)).currency;
  const out: CodeDiscountInput = {
    title: i.title, code: i.code, startsAt: i.startsAt, endsAt: i.endsAt, usageLimit: i.usageLimit, oncePerCustomer: i.appliesOncePerCustomer,
  };
  if (i.minimumRequirement) {
    const sub = i.minimumRequirement.subtotal?.greaterThanOrEqualToSubtotal;
    const qty = i.minimumRequirement.quantity?.greaterThanOrEqualToQuantity;
    try { out.minimumSubtotal = sub != null ? parseMoney(sub, currency) : null; } catch { return { errors: fail([root, 'minimumRequirement', 'subtotal'], 'Subtotal is invalid') }; }
    out.minimumQuantity = qty != null ? Number(qty) : null;
  }
  if (kind === 'free') {
    const f = i as FreeIn;
    if (f.maximumShippingPrice != null) return { errors: fail([root, 'maximumShippingPrice'], 'A maximum shipping price is not supported yet') };
    out.target = 'SHIPPING'; out.valueType = 'PERCENTAGE'; out.value = 10000;
    return { input: out };
  }
  const gets = (i as BasicIn).customerGets;
  if (gets) {
    const v = gets.value;
    if (v?.percentage != null && v.discountAmount) return { errors: fail([root, 'customerGets', 'value'], 'Specify either a percentage or a discount amount', 'TOO_MANY_ARGUMENTS') };
    if (v?.percentage != null) { out.valueType = 'PERCENTAGE'; out.value = Math.round(v.percentage * 10000); }
    else if (v?.discountAmount?.amount != null) {
      out.valueType = 'FIXED_AMOUNT';
      try { out.value = parseMoney(v.discountAmount.amount, currency); } catch { return { errors: fail([root, 'customerGets', 'value', 'discountAmount', 'amount'], 'Amount is invalid') }; }
    } else if (!cur) return { errors: fail([root, 'customerGets', 'value'], 'A discount value is required', 'BLANK') };
    const it = gets.items;
    if (it?.products?.productVariantsToAdd?.length) return { errors: fail([root, 'customerGets', 'items', 'products'], 'Variant-level discounts are not supported yet') };
    const pAdd = ids(it?.products?.productsToAdd, 'Product'); const cAdd = ids(it?.collections?.add, 'Collection');
    if ([...pAdd, ...cAdd].some((x) => x == null)) return { errors: fail([root, 'customerGets', 'items'], 'Invalid product or collection id') };
    if (it && (it.all || !(it.products || it.collections))) { out.target = 'ORDER'; out.appliesTo = {}; }
    else if (it) {
      const prev = cur?.target === 'PRODUCTS' ? cur.appliesTo : {};
      const drop = (xs: number[], rm: (number | null)[]) => xs.filter((x) => !rm.includes(x));
      const productIds = [...new Set([...drop(prev.productIds ?? [], ids(it.products?.productsToRemove, 'Product')), ...(pAdd as number[])])];
      const collectionIds = [...new Set([...drop(prev.collectionIds ?? [], ids(it.collections?.remove, 'Collection')), ...(cAdd as number[])])];
      out.target = 'PRODUCTS'; out.appliesTo = { productIds, collectionIds };
    } else if (!cur) out.target = 'ORDER';
  } else if (!cur) return { errors: fail([root, 'customerGets'], 'customerGets is required', 'BLANK') };
  return { input: out };
}

type NodePayload = { codeDiscountNode: Shape | null };
const payload = (name: string, extra: (t: PothosSchemaTypes.ObjectFieldBuilder<PothosSchemaTypes.ExtendDefaultTypes<import('../builder').SchemaTypes>, NodePayload & { userErrors: UserError[] }>) => Record<string, never> = () => ({})) => {
  const ref = builder.objectRef<NodePayload & { userErrors: UserError[] }>(name);
  ref.implement({ fields: (t) => ({ codeDiscountNode: t.field({ type: CodeNode, nullable: true, resolve: (p) => p.codeDiscountNode }), userErrors: t.field({ type: [DiscountUserError], resolve: (p) => p.userErrors }), ...extra(t) }) });
  return ref;
};
const BasicCreatePayload = payload('DiscountCodeBasicCreatePayload');
const BasicUpdatePayload = payload('DiscountCodeBasicUpdatePayload');
const FreeCreatePayload = payload('DiscountCodeFreeShippingCreatePayload');
const FreeUpdatePayload = payload('DiscountCodeFreeShippingUpdatePayload');
const ActivatePayload = payload('DiscountCodeActivatePayload');
const DeactivatePayload = payload('DiscountCodeDeactivatePayload');
const DeletePayload = builder.objectRef<{ deletedCodeDiscountId: string | null; userErrors: UserError[] }>('DiscountCodeDeletePayload').implement({
  fields: (t) => ({ deletedCodeDiscountId: t.id({ nullable: true, resolve: (p) => p.deletedCodeDiscountId }), userErrors: t.field({ type: [DiscountUserError], resolve: (p) => p.userErrors }) }),
});

const prefix = (errors: UserError[], root: string): UserError[] => errors.map((e) => ({ ...e, field: e.field?.[0] === root ? e.field : [root, ...(e.field ?? [])] }));
const noDiscount = (field: string[]): UserError[] => fail(field, 'Discount does not exist');

async function create(ctx: Ctx, root: string, i: BasicIn | FreeIn, kind: 'basic' | 'free'): Promise<NodePayload & { userErrors: UserError[] }> {
  requireScope(ctx, 'write_discounts');
  const c = await convert(ctx, root, i, kind, null);
  if ('errors' in c) return { codeDiscountNode: null, userErrors: c.errors };
  const r = await createCodeDiscount(ctx.db, ctx.shopId, c.input, ctx.auth.kind === 'session' ? ctx.auth.user.id : null);
  return r.ok ? { codeDiscountNode: await load(ctx, r.value), userErrors: [] } : { codeDiscountNode: null, userErrors: prefix(r.errors, root) };
}
async function update(ctx: Ctx, rawId: string | number, root: string, i: BasicIn | FreeIn, kind: 'basic' | 'free'): Promise<NodePayload & { userErrors: UserError[] }> {
  requireScope(ctx, 'write_discounts');
  const id = codeId(rawId);
  const cur = id ? await getCodeDiscount(ctx.db, ctx.shopId, id) : null;
  if (!id || !cur) return { codeDiscountNode: null, userErrors: noDiscount(['id']) };
  const c = await convert(ctx, root, i, kind, cur);
  if ('errors' in c) return { codeDiscountNode: null, userErrors: c.errors };
  const r = await updateCodeDiscount(ctx.db, ctx.shopId, id, c.input, ctx.auth.kind === 'session' ? ctx.auth.user.id : null);
  return r.ok ? { codeDiscountNode: await load(ctx, r.value), userErrors: [] } : { codeDiscountNode: null, userErrors: prefix(r.errors, root) };
}
async function toggle(ctx: Ctx, rawId: string | number, active: boolean) {
  requireScope(ctx, 'write_discounts');
  const id = codeId(rawId);
  if (!id) return { codeDiscountNode: null, userErrors: noDiscount(['id']) };
  const r = await setDiscountActive(ctx.db, ctx.shopId, id, active);
  return r.ok ? { codeDiscountNode: await load(ctx, r.value), userErrors: [] } : { codeDiscountNode: null, userErrors: r.errors };
}

builder.mutationFields((t) => ({
  discountCodeBasicCreate: t.field({ type: BasicCreatePayload, args: { basicCodeDiscount: t.arg({ type: BasicInput, required: true }) }, resolve: (_r, a, ctx) => create(ctx, 'basicCodeDiscount', a.basicCodeDiscount, 'basic') }),
  discountCodeBasicUpdate: t.field({
    type: BasicUpdatePayload, args: { id: t.arg.id({ required: true }), basicCodeDiscount: t.arg({ type: BasicInput, required: true }) },
    resolve: (_r, a, ctx) => update(ctx, a.id, 'basicCodeDiscount', a.basicCodeDiscount, 'basic'),
  }),
  discountCodeFreeShippingCreate: t.field({
    type: FreeCreatePayload, args: { freeShippingCodeDiscount: t.arg({ type: FreeShippingInput, required: true }) },
    resolve: (_r, a, ctx) => create(ctx, 'freeShippingCodeDiscount', a.freeShippingCodeDiscount, 'free'),
  }),
  discountCodeFreeShippingUpdate: t.field({
    type: FreeUpdatePayload, args: { id: t.arg.id({ required: true }), freeShippingCodeDiscount: t.arg({ type: FreeShippingInput, required: true }) },
    resolve: (_r, a, ctx) => update(ctx, a.id, 'freeShippingCodeDiscount', a.freeShippingCodeDiscount, 'free'),
  }),
  discountCodeActivate: t.field({ type: ActivatePayload, args: { id: t.arg.id({ required: true }) }, resolve: (_r, a, ctx) => toggle(ctx, a.id, true) }),
  discountCodeDeactivate: t.field({ type: DeactivatePayload, args: { id: t.arg.id({ required: true }) }, resolve: (_r, a, ctx) => toggle(ctx, a.id, false) }),
  discountCodeDelete: t.field({
    type: DeletePayload, args: { id: t.arg.id({ required: true }) },
    resolve: async (_r, a, ctx) => {
      requireScope(ctx, 'write_discounts');
      const id = codeId(a.id);
      const r = id ? await deleteCodeDiscount(ctx.db, ctx.shopId, id) : null;
      return r?.ok ? { deletedCodeDiscountId: toGid('DiscountCodeNode', id!), userErrors: [] } : { deletedCodeDiscountId: null, userErrors: noDiscount(['id']) };
    },
  }),
}));
