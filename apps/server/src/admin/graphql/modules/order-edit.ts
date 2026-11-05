import {
  addEditDiscount, addVariantToEdit, approveReturn, beginOrderEdit, calculateOrderEdit, closeReturn, commitOrderEdit, createReturn, discardOrderEdit, getOrder, getOrderEdit, getReturn, getVariant, listReturns,
  returnableQuantities, schema, setEditQuantity, RETURN_REASONS, type CalculatedLine, type CalculatedOrder, type Order as OrderRow, type ReturnLine, type ReturnWithLines,
} from '@shopme/core';
import { presentmentShare } from '@shopme/core';
import { and, eq } from 'drizzle-orm';
import { parseId, parseMoney, toGid, type UserError } from '@shopme/shopify-compat';
import { builder } from '../builder';
import { requireScope, type GraphQLContext } from '../context';
import { ConnectionArgs, defineConnection, paginateArray } from '../types/connection';
import { DisplayableError, UserError as UserErrorRef, definePayload } from '../types/errors';
import { MoneyBag, MoneyInput, MoneyV2, moneyBag, moneyV2, type MoneyBagShape } from '../types/money';
import { Node, registerNode } from '../types/node';
import { ProductVariant } from '../types/catalog';
import { Order_ } from '../types/sales';
import { Image } from './files';
import { LineItem, PricingValue, type LineShape } from './orders';

/** Order editing (`orderEdit*`: a server-side session, recalculated on every change, applied by `orderEditCommit`) and returns. */

const staffOf = (ctx: GraphQLContext) => (ctx.auth.kind === 'session' ? ctx.auth.user.id : null);
const fail = (field: string[], message: string, code?: string): UserError[] => [{ field, message, ...(code ? { code } : {}) }];
const bag = (o: OrderRow, minor: number): MoneyBagShape => moneyBag(minor, o.currency, { minor: presentmentShare(o, minor), currency: o.presentmentMoney ? o.presentmentCurrency : o.currency });

/* ------------------------------ order editing ------------------------------ */

type CO = CalculatedOrder & { id: number };
const withId = (c: CalculatedOrder): CO => Object.assign(c, { id: c.edit.id });
const CalculatedLineItem = builder.objectRef<{ calc: CO; line: CalculatedLine }>('CalculatedLineItem').implement({
  fields: (t) => ({
    id: t.id({ resolve: (l) => toGid('CalculatedLineItem', l.line.id) }),
    title: t.string({ resolve: (l) => l.line.title }),
    variantTitle: t.string({ nullable: true, resolve: (l) => l.line.variantTitle }),
    sku: t.string({ nullable: true, resolve: (l) => l.line.sku }),
    quantity: t.int({ resolve: (l) => l.line.quantity }),
    editableQuantity: t.int({ resolve: (l) => Math.max(0, l.line.quantity - l.line.uneditable) }),
    editableQuantityBeforeChanges: t.int({ resolve: (l) => Math.max(0, l.line.quantityBefore - l.line.uneditable) }),
    restockable: t.boolean({ resolve: (l) => l.line.variantId != null }),
    restocking: t.boolean({ resolve: (l) => l.line.restock && l.line.quantity < l.line.quantityBefore }),
    hasStagedLineItemDiscount: t.boolean({ resolve: (l) => !!l.line.stagedDiscount }),
    image: t.field({ type: Image, nullable: true, resolve: (l) => (l.line.imageUrl ? { id: null, url: l.line.imageUrl, altText: l.line.title, width: null, height: null } : null) }),
    variant: t.field({ type: ProductVariant, nullable: true, resolve: (l, _a, ctx) => (l.line.variantId ? getVariant(ctx.db, ctx.shopId, l.line.variantId) : null) }),
    originalUnitPriceSet: t.field({ type: MoneyBag, resolve: (l) => bag(l.calc.order, l.line.unitPrice) }),
    discountedUnitPriceSet: t.field({ type: MoneyBag, resolve: (l) => bag(l.calc.order, l.line.quantity ? Math.round(l.line.discountedTotal / l.line.quantity) : l.line.unitPrice) }),
    editableSubtotalSet: t.field({ type: MoneyBag, resolve: (l) => bag(l.calc.order, l.line.discountedTotal - uneditableOf(l)) }),
    uneditableSubtotalSet: t.field({ type: MoneyBag, resolve: (l) => bag(l.calc.order, uneditableOf(l)) }),
  }),
});
const uneditableOf = (l: { line: CalculatedLine }) => (l.line.quantity ? Math.round((l.line.discountedTotal * Math.min(l.line.uneditable, l.line.quantity)) / l.line.quantity) : 0);
const CalculatedLineItemConnection = defineConnection('CalculatedLineItem', CalculatedLineItem);
const wrap = (calc: CO, lines = calc.lines) => lines.map((line) => ({ calc, line }));

const CalculatedOrder_ = builder.objectRef<CO>('CalculatedOrder').implement({
  interfaces: [Node],
  fields: (t) => ({
    id: t.id({ resolve: (c) => toGid('CalculatedOrder', c.edit.id) }),
    committed: t.boolean({ resolve: (c) => c.edit.status === 'COMMITTED' }),
    notificationPreviewTitle: t.string({ resolve: (c) => `Order ${c.order.name} updated` }),
    originalOrder: t.field({ type: Order_, resolve: (c) => c.order }),
    lineItems: t.field({ type: CalculatedLineItemConnection, args: { ...ConnectionArgs, query: t.arg.string() }, resolve: (c, a) => paginateArray(a, wrap(c).filter((l) => l.line.quantity > 0 || l.line.quantityBefore > 0)) }),
    addedLineItems: t.field({ type: CalculatedLineItemConnection, args: ConnectionArgs, resolve: (c, a) => paginateArray(a, wrap(c, c.lines.filter((l) => l.orderLineId === null && l.quantity > 0))) }),
    subtotalPriceSet: t.field({ type: MoneyBag, nullable: true, resolve: (c) => bag(c.order, c.lines.reduce((n, l) => n + l.discountedTotal, 0)) }),
    totalPriceSet: t.field({ type: MoneyBag, resolve: (c) => bag(c.order, c.total) }),
    totalOutstandingSet: t.field({ type: MoneyBag, description: 'Payment due when positive, refund owed when negative.', resolve: (c) => bag(c.order, c.outstanding) }),
    cartDiscountAmountSet: t.field({ type: MoneyBag, nullable: true, resolve: () => null }),
  }),
});
registerNode('CalculatedOrder', async (ctx, id) => { const e = await getOrderEdit(ctx.db, ctx.shopId, id); return e ? withId(await calculateOrderEdit(ctx.db, ctx.shopId, e)) : null; });

const Session = builder.objectRef<{ id: number }>('OrderEditSession').implement({ interfaces: [Node], fields: () => ({}) });
const StagedDiscountChange = builder.objectRef<{ id: number; description: string | null; valueType: string; value: number; currency: string }>('OrderStagedChangeAddLineItemDiscount').implement({
  fields: (t) => ({
    description: t.string({ resolve: (d) => d.description ?? '' }),
    value: t.field({ type: PricingValue, resolve: (d) => (d.valueType === 'PERCENTAGE' ? { percentage: d.value } : { amount: String(d.value / 100), currencyCode: d.currency }) as never }),
  }),
});

const DiscountInput = builder.inputType('OrderEditAppliedDiscountInput', { fields: (t) => ({ description: t.string(), fixedValue: t.field({ type: MoneyInput }), percentValue: t.float() }) });

const editPayload = <Extra extends object>(name: string, extra: (t: PothosSchemaTypes.ObjectFieldBuilder<PothosSchemaTypes.ExtendDefaultTypes<import('../builder').SchemaTypes>, { calc: CO | null; line: CalculatedLine | null; discount: Extra | null }>) => Record<string, never> = () => ({})) =>
  definePayload<{ calc: CO | null; line: CalculatedLine | null; discount: Extra | null }>(name, (t) => ({
    calculatedOrder: t.field({ type: CalculatedOrder_, nullable: true, resolve: (p) => p.calc }),
    orderEditSession: t.field({ type: Session, nullable: true, resolve: (p) => (p.calc ? { id: p.calc.edit.id } : null) }),
    ...(name === 'OrderEditBeginPayload' ? {} : { calculatedLineItem: t.field({ type: CalculatedLineItem, nullable: true, resolve: (p) => (p.calc && p.line ? { calc: p.calc, line: p.line } : null) }) }),
    ...extra(t),
  }));
const BeginPayload = editPayload('OrderEditBeginPayload');
const AddVariantPayload = editPayload('OrderEditAddVariantPayload');
const SetQuantityPayload = editPayload('OrderEditSetQuantityPayload');
const DiscountPayload = editPayload<{ id: number; description: string | null; valueType: string; value: number; currency: string }>('OrderEditAddLineItemDiscountPayload', (t) => ({
  addedDiscountStagedChange: t.field({ type: StagedDiscountChange, nullable: true, resolve: (p) => p.discount }),
}) as never);
const CommitPayload = definePayload<{ order: OrderRow | null; successMessages: string[] | null }>('OrderEditCommitPayload', (t) => ({
  order: t.field({ type: Order_, nullable: true, resolve: (p) => p.order }), successMessages: t.stringList({ nullable: true, resolve: (p) => p.successMessages }),
}));

const calcOf = async (ctx: GraphQLContext, editId: number) => { const e = await getOrderEdit(ctx.db, ctx.shopId, editId); return e ? withId(await calculateOrderEdit(ctx.db, ctx.shopId, e)) : null; };
const editId = (v: string | number) => parseId(String(v), 'CalculatedOrder') ?? parseId(String(v), 'OrderEditSession');
const lineId = (v: string | number) => parseId(String(v), 'CalculatedLineItem') ?? parseId(String(v), 'LineItem');
const noEdit = () => fail(['id'], 'Order edit session does not exist', 'NOT_FOUND');

builder.mutationFields((t) => ({
  orderEditBegin: t.field({
    type: BeginPayload, args: { id: t.arg.id({ required: true }) },
    resolve: async (_r, a, ctx) => {
      requireScope(ctx, 'write_order_edits');
      const orderId = parseId(String(a.id), 'Order');
      const r = orderId ? await beginOrderEdit(ctx.db, ctx.shopId, orderId, staffOf(ctx)) : null;
      if (!r?.ok) return { calc: null, line: null, discount: null, userErrors: r ? r.errors : fail(['id'], 'Order does not exist') };
      return { calc: await calcOf(ctx, r.value.id), line: null, discount: null, userErrors: [] };
    },
  }),
  orderEditAddVariant: t.field({
    type: AddVariantPayload, args: { id: t.arg.id({ required: true }), variantId: t.arg.id({ required: true }), quantity: t.arg.int({ required: true }), locationId: t.arg.id(), allowDuplicates: t.arg.boolean({ defaultValue: false }) },
    resolve: async (_r, a, ctx) => {
      requireScope(ctx, 'write_order_edits');
      const id = editId(a.id); const variantId = parseId(String(a.variantId), 'ProductVariant');
      if (!id || !variantId) return { calc: null, line: null, discount: null, userErrors: noEdit() };
      const r = await addVariantToEdit(ctx.db, ctx.shopId, id, variantId, a.quantity);
      if (!r.ok) return { calc: null, line: null, discount: null, userErrors: r.errors };
      const calc = (await calcOf(ctx, id))!;
      return { calc, line: calc.lines.find((l) => l.id === r.value.lineId) ?? null, discount: null, userErrors: [] };
    },
  }),
  orderEditSetQuantity: t.field({
    type: SetQuantityPayload, args: { id: t.arg.id({ required: true }), lineItemId: t.arg.id({ required: true }), quantity: t.arg.int({ required: true }), restock: t.arg.boolean({ defaultValue: false }) },
    resolve: async (_r, a, ctx) => {
      requireScope(ctx, 'write_order_edits');
      const id = editId(a.id); const line = lineId(a.lineItemId);
      if (!id || !line) return { calc: null, line: null, discount: null, userErrors: noEdit() };
      const r = await setEditQuantity(ctx.db, ctx.shopId, id, line, a.quantity, !!a.restock);
      if (!r.ok) return { calc: null, line: null, discount: null, userErrors: r.errors };
      const calc = (await calcOf(ctx, id))!;
      return { calc, line: calc.lines.find((l) => l.id === line) ?? null, discount: null, userErrors: [] };
    },
  }),
  orderEditAddLineItemDiscount: t.field({
    type: DiscountPayload, args: { id: t.arg.id({ required: true }), lineItemId: t.arg.id({ required: true }), discount: t.arg({ type: DiscountInput, required: true }) },
    resolve: async (_r, a, ctx) => {
      requireScope(ctx, 'write_order_edits');
      const id = editId(a.id); const line = lineId(a.lineItemId);
      if (!id || !line) return { calc: null, line: null, discount: null, userErrors: noEdit() };
      const cur = (await calcOf(ctx, id))!;
      const d = a.discount;
      if ((d.fixedValue == null) === (d.percentValue == null)) return { calc: null, line: null, discount: null, userErrors: fail(['discount'], 'Specify either a fixed value or a percent value') };
      let value: number;
      try { value = d.fixedValue ? parseMoney(d.fixedValue.amount, cur.order.currency) : d.percentValue!; } catch { return { calc: null, line: null, discount: null, userErrors: fail(['discount', 'fixedValue'], 'Amount is invalid') }; }
      const r = await addEditDiscount(ctx.db, ctx.shopId, id, line, { valueType: d.fixedValue ? 'FIXED_AMOUNT' : 'PERCENTAGE', value, description: d.description });
      if (!r.ok) return { calc: null, line: null, discount: null, userErrors: r.errors };
      const calc = (await calcOf(ctx, id))!;
      return { calc, line: calc.lines.find((l) => l.id === line) ?? null, discount: { ...r.value.discount, currency: calc.order.currency }, userErrors: [] };
    },
  }),
  orderEditCommit: t.field({
    type: CommitPayload, args: { id: t.arg.id({ required: true }), notifyCustomer: t.arg.boolean(), staffNote: t.arg.string() },
    resolve: async (_r, a, ctx) => {
      requireScope(ctx, 'write_order_edits');
      const id = editId(a.id);
      if (!id) return { order: null, successMessages: null, userErrors: noEdit() };
      const r = await commitOrderEdit(ctx.db, ctx.shopId, id, { staffId: staffOf(ctx), staffNote: a.staffNote, notifyCustomer: !!a.notifyCustomer });
      return r.ok ? { order: r.value.order, successMessages: r.value.messages, userErrors: [] } : { order: null, successMessages: null, userErrors: r.errors };
    },
  }),
  /** ShopMe extension: abandon an edit session. */
  shopmeOrderEditDiscard: t.field({
    type: definePayload<{ discarded: boolean }>('ShopmeOrderEditDiscardPayload', (u) => ({ discarded: u.boolean({ resolve: (p) => p.discarded }) })), args: { id: t.arg.id({ required: true }) },
    resolve: async (_r, a, ctx) => { requireScope(ctx, 'write_order_edits'); const id = editId(a.id); if (id) await discardOrderEdit(ctx.db, ctx.shopId, id); return { discarded: !!id, userErrors: [] }; },
  }),
}));

/* ------------------------------ returns ------------------------------ */

const ReturnStatus = builder.enumType('ReturnStatus', { values: ['CANCELED', 'CLOSED', 'OPEN', 'REQUESTED', 'DECLINED'] as const });
const ReturnReason = builder.enumType('ReturnReason', { values: RETURN_REASONS });
const OrderReturnStatus = builder.enumType('OrderReturnStatus', { values: ['INSPECTION_COMPLETE', 'IN_PROGRESS', 'NO_RETURN', 'RETURNED', 'RETURN_FAILED', 'RETURN_REQUESTED'] as const });
const RETURN_ERROR_CODES = ['INTERNAL_ERROR', 'BLANK', 'GREATER_THAN', 'INVALID', 'INVALID_STATE', 'NOT_FOUND', 'TOO_MANY_ARGUMENTS'] as const;
const ReturnErrorCode = builder.enumType('ReturnErrorCode', { values: RETURN_ERROR_CODES });
const ReturnUserError = builder.objectRef<UserError>('ReturnUserError').implement({
  interfaces: [DisplayableError],
  fields: (t) => ({ code: t.field({ type: ReturnErrorCode, nullable: true, resolve: (e) => ((RETURN_ERROR_CODES as readonly string[]).includes(e.code ?? '') ? e.code : null) as never }) }),
});

interface RShape extends ReturnWithLines { order: OrderRow; titles: Map<number, { title: string; variantTitle: string | null }> }
interface RLShape extends ReturnLine { title: string; variantTitle: string | null }
const ReturnLineItemType = builder.interfaceRef<RLShape>('ReturnLineItemType').implement({
  fields: (t) => ({
    id: t.id({ resolve: (l) => toGid('ReturnLineItem', l.id) }),
    quantity: t.int({ resolve: (l) => l.quantity }),
    processedQuantity: t.int({ resolve: (l) => (l.restocked ? l.quantity : 0) }),
    processableQuantity: t.int({ resolve: (l) => (l.restocked ? 0 : l.quantity) }),
    unprocessedQuantity: t.int({ resolve: (l) => l.quantity }),
    refundedQuantity: t.int({ resolve: () => 0 }),
    refundableQuantity: t.int({ resolve: (l) => l.quantity }),
    returnReason: t.field({ type: ReturnReason, resolve: (l) => l.reason as 'UNKNOWN' }),
    returnReasonNote: t.string({ resolve: (l) => l.note ?? '' }),
    customerNote: t.string({ nullable: true, resolve: (l) => l.note }),
    shopmeTitle: t.string({ resolve: (l) => l.title }),
    shopmeVariantTitle: t.string({ nullable: true, resolve: (l) => l.variantTitle }),
    shopmeRestockType: t.string({ resolve: (l) => l.restockType }),
    shopmeRestocked: t.boolean({ resolve: (l) => l.restocked }),
  }),
  resolveType: () => 'ReturnLineItem',
});
builder.objectRef<RLShape>('ReturnLineItem').implement({ interfaces: [Node, ReturnLineItemType], fields: () => ({}) });
const ReturnLineConnection = defineConnection('ReturnLineItemType', ReturnLineItemType as never);

const Return = builder.objectRef<RShape>('Return');
Return.implement({
  interfaces: [Node],
  fields: (t) => ({
    name: t.string({ resolve: (r) => r.name }),
    status: t.field({ type: ReturnStatus, resolve: (r) => r.status as 'OPEN' }),
    createdAt: t.field({ type: 'DateTime', resolve: (r) => r.createdAt }),
    closedAt: t.field({ type: 'DateTime', nullable: true, resolve: (r) => r.closedAt }),
    requestApprovedAt: t.field({ type: 'DateTime', nullable: true, resolve: (r) => r.requestApprovedAt }),
    totalQuantity: t.int({ resolve: (r) => r.lines.reduce((n, l) => n + l.quantity, 0) }),
    shopmeReturnShippingFee: t.field({ type: MoneyV2, resolve: (r) => moneyV2(r.returnShippingFee, r.order.currency) }),
    shopmeRestockingFeePercent: t.float({ resolve: (r) => r.restockingFeeBps / 100 }),
    order: t.field({ type: Order_, resolve: (r) => r.order }),
    returnLineItems: t.field({
      type: ReturnLineConnection, args: { ...ConnectionArgs, processingStatus: t.arg({ type: builder.inputType('ReturnProcessingStatusFilterInput', { fields: (u) => ({ statuses: u.stringList() }) }) }) },
      resolve: (r, a) => paginateArray(a, r.lines.map((l) => ({ ...l, title: r.titles.get(l.orderLineId)?.title ?? '', variantTitle: r.titles.get(l.orderLineId)?.variantTitle ?? null }))),
    }),
  }),
});
const ReturnConnection = defineConnection('Return', Return);

async function loadReturn(ctx: GraphQLContext, r: ReturnWithLines | null): Promise<RShape | null> {
  if (!r) return null;
  const order = await getOrder(ctx.db, ctx.shopId, r.orderId);
  if (!order) return null;
  const rows = await ctx.db.select({ id: schema.orderLines.id, title: schema.orderLines.title, variantTitle: schema.orderLines.variantTitle }).from(schema.orderLines).where(and(eq(schema.orderLines.orderId, r.orderId)));
  return { ...r, order, titles: new Map(rows.map((x) => [x.id, x])) };
}
registerNode('Return', async (ctx, id) => loadReturn(ctx, await getReturn(ctx.db, ctx.shopId, id)));

builder.objectFields(Order_, (t) => ({
  returns: t.field({
    type: ReturnConnection, args: { ...ConnectionArgs, query: t.arg.string() },
    resolve: async (o, a, ctx) => paginateArray(a, (await Promise.all((await listReturns(ctx.db, ctx.shopId, o.id)).map((r) => loadReturn(ctx, r)))).filter((r): r is RShape => !!r)),
  }),
  returnStatus: t.field({
    type: OrderReturnStatus,
    resolve: async (o, _a, ctx) => {
      const rs = await listReturns(ctx.db, ctx.shopId, o.id);
      return rs.some((r) => r.status === 'REQUESTED') ? 'RETURN_REQUESTED' : rs.some((r) => r.status === 'OPEN') ? 'IN_PROGRESS' : rs.some((r) => r.status === 'CLOSED') ? 'RETURNED' : 'NO_RETURN';
    },
  }),
}));
builder.objectFields(LineItem, (t) => ({
  shopmeReturnableQuantity: t.int({ description: 'Fulfilled units that are not part of a return yet.', resolve: async (l: LineShape, _a, ctx) => (await returnableQuantities(ctx.db, ctx.shopId, l.orderId)).get(l.id) ?? 0 }),
}));

const ReturnLineInput = builder.inputType('ReturnLineItemInput', {
  fields: (t) => ({
    quantity: t.int({ required: true }), returnReason: t.field({ type: ReturnReason }), returnReasonNote: t.string(), fulfillmentLineItemId: t.id({ required: true }),
    shopmeRestock: t.boolean({ description: 'Put the items back in stock when the return is closed (default true).' }), shopmeLocationId: t.id(),
  }),
});
const ReturnInput = builder.inputType('ReturnInput', { fields: (t) => ({ orderId: t.id({ required: true }), returnLineItems: t.field({ type: [ReturnLineInput], required: true }), requestedAt: t.field({ type: 'DateTime' }), notifyCustomer: t.boolean(), shopmeIgnoreReturnRules: t.boolean({ description: 'Skip the return window and final sale checks of the shop return rules.' }) }) });
const RequestLineInput = builder.inputType('ReturnRequestLineItemInput', {
  fields: (t) => ({ fulfillmentLineItemId: t.id({ required: true }), quantity: t.int({ required: true }), returnReason: t.field({ type: ReturnReason }), customerNote: t.string() }),
});
const RequestInput = builder.inputType('ReturnRequestInput', { fields: (t) => ({ orderId: t.id({ required: true }), returnLineItems: t.field({ type: [RequestLineInput], required: true }) }) });
const ApproveInput = builder.inputType('ReturnApproveRequestInput', { fields: (t) => ({ id: t.id({ required: true }), notifyCustomer: t.boolean({ defaultValue: false }) }) });

const returnPayload = (name: string) => builder.objectRef<{ return: RShape | null; userErrors: UserError[] }>(name).implement({
  fields: (t) => ({ return: t.field({ type: Return, nullable: true, resolve: (p) => p.return }), userErrors: t.field({ type: [ReturnUserError], resolve: (p) => p.userErrors }) }),
});
const RequestPayload = returnPayload('ReturnRequestPayload');
const CreatePayload = returnPayload('ReturnCreatePayload');
const ApprovePayload = returnPayload('ReturnApproveRequestPayload');
const ClosePayload = returnPayload('ReturnClosePayload');
void UserErrorRef;

/** The id of a fulfilled line: a `LineItem` id, or the `FulfillmentLineItem` id of one of its fulfillments. */
async function orderLineOf(ctx: GraphQLContext, v: string | number): Promise<number | null> {
  const direct = parseId(String(v), 'LineItem');
  if (direct) return direct;
  const fl = parseId(String(v), 'FulfillmentLineItem');
  if (!fl) return null;
  const [row] = await ctx.db.select({ id: schema.fulfillmentLines.orderLineId }).from(schema.fulfillmentLines).where(and(eq(schema.fulfillmentLines.id, fl), eq(schema.fulfillmentLines.shopId, ctx.shopId))).limit(1);
  return row?.id ?? null;
}

async function makeReturn(ctx: GraphQLContext, root: string, orderRaw: string, lines: { id: string; quantity: number; reason?: string | null; note?: string | null; restock?: boolean | null; locationId?: string | null }[], requested: boolean, ignoreRules = false) {
  requireScope(ctx, requested ? 'write_returns' : 'write_returns');
  const orderId = parseId(String(orderRaw), 'Order');
  if (!orderId) return { return: null, userErrors: fail([root, 'orderId'], 'Order does not exist', 'NOT_FOUND') };
  const resolved: { orderLineId: number; quantity: number; reason?: string | null; note?: string | null; restock: boolean; locationId: number | null }[] = [];
  for (const [i, l] of lines.entries()) {
    const orderLineId = await orderLineOf(ctx, l.id);
    if (!orderLineId) return { return: null, userErrors: fail([root, 'returnLineItems', String(i), 'fulfillmentLineItemId'], 'Line item does not exist', 'NOT_FOUND') };
    resolved.push({ orderLineId, quantity: l.quantity, reason: l.reason, note: l.note, restock: l.restock ?? true, locationId: l.locationId ? parseId(String(l.locationId), 'Location') : null });
  }
  const r = await createReturn(ctx.db, ctx.shopId, orderId, resolved, { requested, staffId: staffOf(ctx), ignoreRules });
  return r.ok ? { return: await loadReturn(ctx, r.value), userErrors: [] } : { return: null, userErrors: r.errors.map((e) => ({ ...e, field: e.field ? [root, ...e.field] : [root] })) };
}

builder.mutationFields((t) => ({
  returnCreate: t.field({
    type: CreatePayload, args: { returnInput: t.arg({ type: ReturnInput, required: true }) },
    resolve: (_r, { returnInput: i }, ctx) => makeReturn(ctx, 'returnInput', String(i.orderId), i.returnLineItems.map((l) => ({ id: String(l.fulfillmentLineItemId), quantity: l.quantity, reason: l.returnReason, note: l.returnReasonNote, restock: l.shopmeRestock, locationId: l.shopmeLocationId ? String(l.shopmeLocationId) : null })), false, !!i.shopmeIgnoreReturnRules),
  }),
  returnRequest: t.field({
    type: RequestPayload, args: { input: t.arg({ type: RequestInput, required: true }) },
    resolve: (_r, { input: i }, ctx) => makeReturn(ctx, 'input', String(i.orderId), i.returnLineItems.map((l) => ({ id: String(l.fulfillmentLineItemId), quantity: l.quantity, reason: l.returnReason, note: l.customerNote })), true),
  }),
  returnApproveRequest: t.field({
    type: ApprovePayload, args: { input: t.arg({ type: ApproveInput, required: true }) },
    resolve: async (_r, { input }, ctx) => {
      requireScope(ctx, 'write_returns');
      const id = parseId(String(input.id), 'Return');
      const r = id ? await approveReturn(ctx.db, ctx.shopId, id, staffOf(ctx)) : null;
      if (!r) return { return: null, userErrors: fail(['input', 'id'], 'Return does not exist', 'NOT_FOUND') };
      return r.ok ? { return: await loadReturn(ctx, r.value), userErrors: [] } : { return: null, userErrors: r.errors };
    },
  }),
  returnClose: t.field({
    type: ClosePayload, args: { id: t.arg.id({ required: true }) },
    resolve: async (_r, a, ctx) => {
      requireScope(ctx, 'write_returns');
      const id = parseId(String(a.id), 'Return');
      const r = id ? await closeReturn(ctx.db, ctx.shopId, id, staffOf(ctx)) : null;
      if (!r) return { return: null, userErrors: fail(['id'], 'Return does not exist', 'NOT_FOUND') };
      return r.ok ? { return: await loadReturn(ctx, r.value), userErrors: [] } : { return: null, userErrors: r.errors };
    },
  }),
}));
