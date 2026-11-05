import { createHash, randomUUID } from 'node:crypto';
import {
  addOrderComment, cancelOrder, changeOrderTags, closeOrder, countOrders, createFulfillment, getCustomer, getFulfillment, getOrder, getOrderDetail, getProduct, getVariant, listEvents, listOrders,
  markOrderAsPaid, openOrder, paidAmounts, refundOrder, updateOrder, updateTracking,
  type Fulfillment as FulfillmentRow, type Order as OrderRow, type OrderDetail, type OrderLine, type OrderTransaction as TxRow, type Refund as RefundRow,
} from '@shopme/core';
import { formatMoney, parseId, parseMoney, toGid, type UserError } from '@shopme/shopify-compat';
import { builder } from '../builder';
import { requireScope, type GraphQLContext } from '../context';
import { ConnectionArgs, defineConnection, paginate, paginateArray, type PageArgs } from '../types/connection';
import { DisplayableError, UserError as UserErrorRef, definePayload } from '../types/errors';
import { Count, CurrencyCode, MoneyBag, MoneyV2, moneyBag, moneyV2, type MoneyBagShape } from '../types/money';
import { Node, legacyId, registerNode } from '../types/node';
import { Job, Product_, ProductVariant } from '../types/catalog';
import {
  CommentEvent, Customer_, EventConnection, EventSortKeys, MailingAddress, MailingAddressInput, Order_, OrderConnection, registerTaggable, type AddressShape, type EventRow,
} from '../types/sales';
import { Image } from './files';

/* ------------------------------ enums ------------------------------ */

const FinancialStatus = builder.enumType('OrderDisplayFinancialStatus', { values: ['PENDING', 'AUTHORIZED', 'PARTIALLY_PAID', 'PARTIALLY_REFUNDED', 'VOIDED', 'PAID', 'REFUNDED', 'EXPIRED'] as const });
const FulfillmentStatusEnum = builder.enumType('OrderDisplayFulfillmentStatus', {
  values: ['UNFULFILLED', 'PARTIALLY_FULFILLED', 'FULFILLED', 'RESTOCKED', 'PENDING_FULFILLMENT', 'OPEN', 'IN_PROGRESS', 'ON_HOLD', 'SCHEDULED', 'REQUEST_DECLINED', 'FULFILLMENT_NOT_REQUIRED'] as const,
});
const OrderSortKeys = builder.enumType('OrderSortKeys', {
  values: ['CREATED_AT', 'CURRENT_TOTAL_PRICE', 'CUSTOMER_NAME', 'DESTINATION', 'FINANCIAL_STATUS', 'FULFILLMENT_STATUS', 'ID', 'ORDER_NUMBER', 'PO_NUMBER', 'PROCESSED_AT', 'RELEVANCE', 'TOTAL_ITEMS_QUANTITY', 'TOTAL_PRICE', 'UPDATED_AT'] as const,
});
const CancelReason = builder.enumType('OrderCancelReason', { values: ['CUSTOMER', 'DECLINED', 'FRAUD', 'INVENTORY', 'STAFF', 'OTHER'] as const });
const TxKind = builder.enumType('OrderTransactionKind', { values: ['SALE', 'CAPTURE', 'AUTHORIZATION', 'VOID', 'REFUND', 'CHANGE', 'EMV_AUTHORIZATION', 'SUGGESTED_REFUND'] as const });
const TxStatus = builder.enumType('OrderTransactionStatus', { values: ['SUCCESS', 'FAILURE', 'PENDING', 'ERROR', 'AWAITING_RESPONSE', 'UNKNOWN'] as const });
const FulfillmentStatus = builder.enumType('FulfillmentStatus', { values: ['PENDING', 'OPEN', 'SUCCESS', 'CANCELLED', 'ERROR', 'FAILURE'] as const });
const RestockType = builder.enumType('RefundLineItemRestockType', { values: ['RETURN', 'CANCEL', 'LEGACY_RESTOCK', 'NO_RESTOCK'] as const });
const AllocationMethod = builder.enumType('DiscountApplicationAllocationMethod', { values: ['ACROSS', 'EACH', 'ONE'] as const });
const TargetSelection = builder.enumType('DiscountApplicationTargetSelection', { values: ['ALL', 'ENTITLED', 'EXPLICIT'] as const });
const TargetType = builder.enumType('DiscountApplicationTargetType', { values: ['LINE_ITEM', 'SHIPPING_LINE'] as const });

/* ------------------------------ shapes and helpers ------------------------------ */

const details = new WeakMap<OrderRow, Promise<OrderDetail>>();
export const detailOf = (ctx: GraphQLContext, o: OrderRow) => {
  let p = details.get(o);
  if (!p) { p = getOrderDetail(ctx.db, ctx.shopId, o.id); details.set(o, p); }
  return p;
};
const staffId = (ctx: GraphQLContext) => (ctx.auth.kind === 'session' ? ctx.auth.user.id : null);

const bag = (o: OrderRow, minor: number): MoneyBagShape =>
  moneyBag(minor, o.currency, { minor: Math.round(minor * o.currencyRate), currency: o.presentmentCurrency });
const asList = <T>(nodes: T[], a: PageArgs) => paginateArray(a, a.reverse ? [...nodes].reverse() : nodes);
const fraction = (r: number) => (r > 1 ? r / 100 : r);

export interface LineShape extends OrderLine { order: OrderRow }
interface TaxLineShape { title: string; rate: number; price: number; order: OrderRow }
interface ShippingLineShape { id: number; title: string; code: string | null; price: number; order: OrderRow }
interface DiscountShape { id: number; code: string | null; title: string | null; valueType: string; value: number; targetType: string; index: number; order: OrderRow }
interface TxShape extends TxRow { order: OrderRow }
interface FulfillmentShape extends FulfillmentRow { order: OrderRow }
interface RefundShape extends RefundRow { order: OrderRow }
interface FulfillmentLineShape { id: number; quantity: number; line: LineShape }
interface RefundLineShape { id: number; quantity: number; restockType: string; locationId: number | null; subtotal: number; totalTax: number; line: LineShape }

export const Attribute = builder.objectRef<{ key: string; value: string | null }>('Attribute').implement({
  fields: (t) => ({ key: t.exposeString('key'), value: t.exposeString('value', { nullable: true }) }),
});

const TaxLine = builder.objectRef<TaxLineShape>('TaxLine').implement({
  fields: (t) => ({
    title: t.exposeString('title'),
    rate: t.float({ nullable: true, resolve: (l) => fraction(l.rate) }),
    ratePercentage: t.float({ nullable: true, resolve: (l) => fraction(l.rate) * 100 }),
    priceSet: t.field({ type: MoneyBag, resolve: (l) => bag(l.order, l.price) }),
    source: t.string({ nullable: true, resolve: () => null }),
    channelLiable: t.boolean({ nullable: true, resolve: () => null }),
  }),
});
const taxLinesOf = (rows: OrderDetail['taxLines'], order: OrderRow): TaxLineShape[] => rows.map((x) => ({ title: x.title, rate: x.rate, price: x.price, order }));

/* ------------------------------ line items ------------------------------ */

export const LineItem = builder.objectRef<LineShape>('LineItem');
LineItem.implement({
  interfaces: [Node],
  fields: (t) => ({
    name: t.string({ resolve: (l) => (l.variantTitle ? `${l.title} - ${l.variantTitle}` : l.title) }),
    title: t.exposeString('title'),
    variantTitle: t.exposeString('variantTitle', { nullable: true }),
    sku: t.exposeString('sku', { nullable: true }),
    vendor: t.exposeString('vendor', { nullable: true }),
    quantity: t.exposeInt('quantity'),
    currentQuantity: t.exposeInt('currentQuantity'),
    refundableQuantity: t.int({ resolve: (l) => l.currentQuantity }),
    unfulfilledQuantity: t.int({ resolve: (l) => Math.max(0, l.currentQuantity - l.fulfilledQuantity) }),
    nonFulfillableQuantity: t.int({ resolve: () => 0 }),
    requiresShipping: t.exposeBoolean('requiresShipping'),
    taxable: t.exposeBoolean('taxable'),
    isGiftCard: t.exposeBoolean('isGiftCard'),
    restockable: t.boolean({ resolve: (l) => l.variantId != null }),
    merchantEditable: t.boolean({ resolve: () => false }),
    createdAt: t.field({ type: 'DateTime', resolve: (l) => l.order.createdAt }),
    customAttributes: t.field({ type: [Attribute], resolve: (l) => Object.entries(l.properties).map(([key, value]) => ({ key, value })) }),
    originalUnitPriceSet: t.field({ type: MoneyBag, resolve: (l) => bag(l.order, l.unitPrice) }),
    originalTotalSet: t.field({ type: MoneyBag, resolve: (l) => bag(l.order, l.unitPrice * l.quantity) }),
    discountedTotalSet: t.field({ type: MoneyBag, args: { withCodeDiscounts: t.arg.boolean({ defaultValue: false }) }, resolve: (l) => bag(l.order, l.discountedTotal) }),
    discountedUnitPriceSet: t.field({ type: MoneyBag, resolve: (l) => bag(l.order, Math.round(l.discountedTotal / Math.max(1, l.quantity))) }),
    discountedUnitPriceAfterAllDiscountsSet: t.field({ type: MoneyBag, resolve: (l) => bag(l.order, Math.round(l.discountedTotal / Math.max(1, l.quantity))) }),
    totalDiscountSet: t.field({ type: MoneyBag, resolve: (l) => bag(l.order, Math.max(0, l.unitPrice * l.quantity - l.discountedTotal)) }),
    unfulfilledOriginalTotalSet: t.field({ type: MoneyBag, resolve: (l) => bag(l.order, l.unitPrice * Math.max(0, l.currentQuantity - l.fulfilledQuantity)) }),
    unfulfilledDiscountedTotalSet: t.field({ type: MoneyBag, resolve: (l) => bag(l.order, Math.round((l.discountedTotal * Math.max(0, l.currentQuantity - l.fulfilledQuantity)) / Math.max(1, l.quantity))) }),
    taxLines: t.field({
      type: [TaxLine], args: { first: t.arg.int() },
      resolve: async (l, _a, ctx) => taxLinesOf((await detailOf(ctx, l.order)).taxLines.filter((x) => x.orderLineId === l.id), l.order),
    }),
    image: t.field({ type: Image, nullable: true, resolve: (l) => (l.imageUrl ? { id: null, url: l.imageUrl, altText: l.title, width: null, height: null } : null) }),
    product: t.field({ type: Product_, nullable: true, resolve: (l, _a, ctx) => (l.productId ? getProduct(ctx.db, ctx.shopId, l.productId) : null) }),
    variant: t.field({ type: ProductVariant, nullable: true, resolve: (l, _a, ctx) => (l.variantId ? getVariant(ctx.db, ctx.shopId, l.variantId) : null) }),
  }),
});
const LineItemConnection = defineConnection('LineItem', LineItem);
const linesOf = (d: OrderDetail, order: OrderRow): LineShape[] => d.lines.map((l) => ({ ...l, order }));

/* ------------------------------ shipping and discounts ------------------------------ */

const ShippingLine = builder.objectRef<ShippingLineShape>('ShippingLine').implement({
  fields: (t) => ({
    id: t.id({ nullable: true, resolve: (s) => toGid('ShippingLine', s.id) }),
    title: t.exposeString('title'),
    code: t.exposeString('code', { nullable: true }),
    custom: t.boolean({ resolve: () => false }),
    source: t.string({ nullable: true, resolve: () => null }),
    phone: t.string({ nullable: true, resolve: () => null }),
    carrierIdentifier: t.string({ nullable: true, resolve: () => null }),
    deliveryCategory: t.string({ nullable: true, resolve: () => null }),
    shippingRateHandle: t.string({ nullable: true, resolve: (s) => s.code }),
    isRemoved: t.boolean({ resolve: () => false }),
    createdAt: t.field({ type: 'DateTime', resolve: (s) => s.order.createdAt }),
    originalPriceSet: t.field({ type: MoneyBag, resolve: (s) => bag(s.order, s.price) }),
    discountedPriceSet: t.field({ type: MoneyBag, resolve: (s) => bag(s.order, s.price) }),
    currentDiscountedPriceSet: t.field({ type: MoneyBag, resolve: (s) => bag(s.order, s.price) }),
    taxLines: t.field({ type: [TaxLine], resolve: async (s, _a, ctx) => taxLinesOf((await detailOf(ctx, s.order)).taxLines.filter((x) => x.shippingLineId === s.id), s.order) }),
  }),
});
const ShippingLineConnection = defineConnection('ShippingLine', ShippingLine);

const PricingPercentageValue = builder.objectRef<{ percentage: number }>('PricingPercentageValue').implement({ fields: (t) => ({ percentage: t.exposeFloat('percentage') }) });
export const PricingValue = builder.unionType('PricingValue', {
  types: [MoneyV2, PricingPercentageValue],
  resolveType: (v) => ('percentage' in (v as object) ? PricingPercentageValue : MoneyV2),
});
const DiscountApplication = builder.interfaceRef<DiscountShape>('DiscountApplication').implement({
  fields: (t) => ({
    allocationMethod: t.field({ type: AllocationMethod, resolve: (d) => (d.targetType === 'SHIPPING_LINE' ? 'EACH' : 'ACROSS') as 'ACROSS' }),
    index: t.exposeInt('index'),
    targetSelection: t.field({ type: TargetSelection, resolve: () => 'ALL' as const }),
    targetType: t.field({ type: TargetType, resolve: (d) => (d.targetType === 'SHIPPING_LINE' ? 'SHIPPING_LINE' : 'LINE_ITEM') as 'LINE_ITEM' }),
    value: t.field({ type: PricingValue, resolve: (d) => (d.valueType === 'PERCENTAGE' ? { percentage: d.value / 100 } : moneyV2(d.value, d.order.currency)) }),
  }),
  resolveType: (d) => (d.code ? 'DiscountCodeApplication' : 'ManualDiscountApplication'),
});
const CodeApplication = builder.objectRef<DiscountShape>('DiscountCodeApplication').implement({
  interfaces: [DiscountApplication], fields: (t) => ({ code: t.string({ resolve: (d) => d.code ?? '' }) }),
});
const ManualApplication = builder.objectRef<DiscountShape>('ManualDiscountApplication').implement({
  interfaces: [DiscountApplication], fields: (t) => ({ title: t.string({ resolve: (d) => d.title ?? 'Discount' }), description: t.string({ nullable: true, resolve: () => null }) }),
});
const DiscountApplicationConnection = defineConnection('DiscountApplication', DiscountApplication as never);

/* ------------------------------ transactions, fulfillments, refunds ------------------------------ */

const OrderTransaction = builder.objectRef<TxShape>('OrderTransaction');
OrderTransaction.implement({
  interfaces: [Node],
  fields: (t) => ({
    kind: t.field({ type: TxKind, resolve: (x) => x.kind as 'SALE' }),
    status: t.field({ type: TxStatus, resolve: (x) => x.status as 'SUCCESS' }),
    gateway: t.exposeString('gateway', { nullable: true }),
    formattedGateway: t.string({ nullable: true, resolve: (x) => (x.gateway ? x.gateway.replace(/[_-]/g, ' ').replace(/^./, (c) => c.toUpperCase()) : null) }),
    amountSet: t.field({ type: MoneyBag, resolve: (x) => bag(x.order, x.amount) }),
    createdAt: t.field({ type: 'DateTime', resolve: (x) => x.createdAt }),
    processedAt: t.field({ type: 'DateTime', nullable: true, resolve: (x) => x.processedAt }),
    test: t.exposeBoolean('test'),
    errorCode: t.string({ nullable: true, resolve: () => null }),
    manualPaymentGateway: t.boolean({ resolve: (x) => x.gateway === 'manual' }),
    manuallyCapturable: t.boolean({ resolve: () => false }),
    multiCapturable: t.boolean({ resolve: () => false }),
    order: t.field({ type: Order_, nullable: true, resolve: (x) => x.order }),
    parentTransaction: t.field({
      type: OrderTransaction, nullable: true,
      resolve: async (x, _a, ctx) => { const p = x.parentId ? (await detailOf(ctx, x.order)).transactions.find((y) => y.id === x.parentId) : null; return p ? { ...p, order: x.order } : null; },
    }),
  }),
});
const OrderTransactionConnection = defineConnection('OrderTransaction', OrderTransaction);
const txsOf = (rows: TxRow[], order: OrderRow): TxShape[] => rows.map((x) => ({ ...x, order }));

const FulfillmentTrackingInfo = builder.objectRef<{ company: string | null; number: string | null; url: string | null }>('FulfillmentTrackingInfo').implement({
  fields: (t) => ({ company: t.exposeString('company', { nullable: true }), number: t.exposeString('number', { nullable: true }), url: t.field({ type: 'URL', nullable: true, resolve: (i) => i.url }) }),
});
const FulfillmentLineItem = builder.objectRef<FulfillmentLineShape>('FulfillmentLineItem').implement({
  interfaces: [Node],
  fields: (t) => ({
    quantity: t.exposeInt('quantity', { nullable: true }),
    lineItem: t.field({ type: LineItem, resolve: (f) => f.line }),
    createdAt: t.field({ type: 'DateTime', resolve: (f) => f.line.order.createdAt }),
    originalTotalSet: t.field({ type: MoneyBag, resolve: (f) => bag(f.line.order, f.line.unitPrice * f.quantity) }),
    discountedTotalSet: t.field({ type: MoneyBag, resolve: (f) => bag(f.line.order, Math.round((f.line.discountedTotal * f.quantity) / Math.max(1, f.line.quantity))) }),
  }),
});
const FulfillmentLineItemConnection = defineConnection('FulfillmentLineItem', FulfillmentLineItem);

const Fulfillment = builder.objectRef<FulfillmentShape>('Fulfillment');
Fulfillment.implement({
  interfaces: [Node],
  fields: (t) => ({
    legacyResourceId: t.field({ type: 'UnsignedInt64', resolve: legacyId }),
    name: t.exposeString('name'),
    status: t.field({ type: FulfillmentStatus, resolve: (f) => f.status as 'SUCCESS' }),
    createdAt: t.field({ type: 'DateTime', resolve: (f) => f.createdAt }),
    updatedAt: t.field({ type: 'DateTime', resolve: (f) => f.updatedAt }),
    deliveredAt: t.field({ type: 'DateTime', nullable: true, resolve: (f) => f.deliveredAt }),
    totalQuantity: t.int({ resolve: (f) => f.lines.reduce((s, l) => s + l.quantity, 0) }),
    order: t.field({ type: Order_, resolve: (f) => f.order }),
    trackingInfo: t.field({
      type: [FulfillmentTrackingInfo], args: { first: t.arg.int() },
      resolve: (f) => {
        const n = Math.max(f.trackingNumbers.length, f.trackingUrls.length);
        return Array.from({ length: n }, (_, i) => ({ company: f.trackingCompany, number: f.trackingNumbers[i] ?? null, url: f.trackingUrls[i] ?? null }));
      },
    }),
    fulfillmentLineItems: t.field({
      type: FulfillmentLineItemConnection, args: ConnectionArgs,
      resolve: async (f, a, ctx) => {
        const d = await detailOf(ctx, f.order);
        const lines = linesOf(d, f.order);
        return asList(f.lines.flatMap((fl) => { const line = lines.find((l) => l.id === fl.orderLineId); return line ? [{ id: fl.id, quantity: fl.quantity, line }] : []; }), a);
      },
    }),
  }),
});
registerNode('Fulfillment', async (ctx, id) => { const f = await getFulfillment(ctx.db, ctx.shopId, id); const o = f && (await getOrder(ctx.db, ctx.shopId, f.orderId)); return f && o ? { ...f, order: o } : null; });

const RefundLineItem = builder.objectRef<RefundLineShape>('RefundLineItem').implement({
  fields: (t) => ({
    id: t.id({ nullable: true, resolve: (r) => toGid('RefundLineItem', r.id) }),
    quantity: t.exposeInt('quantity'),
    lineItem: t.field({ type: LineItem, resolve: (r) => r.line }),
    restockType: t.field({ type: RestockType, resolve: (r) => r.restockType as 'NO_RESTOCK' }),
    restocked: t.boolean({ resolve: (r) => r.restockType !== 'NO_RESTOCK' }),
    priceSet: t.field({ type: MoneyBag, resolve: (r) => bag(r.line.order, r.line.unitPrice) }),
    subtotalSet: t.field({ type: MoneyBag, resolve: (r) => bag(r.line.order, r.subtotal) }),
    totalTaxSet: t.field({ type: MoneyBag, resolve: (r) => bag(r.line.order, r.totalTax) }),
  }),
});
const RefundLineItemConnection = defineConnection('RefundLineItem', RefundLineItem);

const Refund = builder.objectRef<RefundShape>('Refund');
Refund.implement({
  interfaces: [Node],
  fields: (t) => ({
    legacyResourceId: t.field({ type: 'UnsignedInt64', resolve: legacyId }),
    note: t.exposeString('note', { nullable: true }),
    createdAt: t.field({ type: 'DateTime', nullable: true, resolve: (r) => r.createdAt }),
    updatedAt: t.field({ type: 'DateTime', resolve: (r) => r.createdAt }),
    processedAt: t.field({ type: 'DateTime', resolve: (r) => r.processedAt }),
    totalRefundedSet: t.field({ type: MoneyBag, resolve: (r) => bag(r.order, r.total) }),
    order: t.field({ type: Order_, resolve: (r) => r.order }),
    transactions: t.field({ type: OrderTransactionConnection, args: ConnectionArgs, resolve: (r, a) => asList(txsOf(r.transactions, r.order), a) }),
    refundLineItems: t.field({
      type: RefundLineItemConnection, args: ConnectionArgs,
      resolve: async (r, a, ctx) => {
        const lines = linesOf(await detailOf(ctx, r.order), r.order);
        return asList(r.lines.flatMap((rl) => { const line = lines.find((l) => l.id === rl.orderLineId); return line ? [{ ...rl, restockType: rl.restockType ?? 'NO_RESTOCK', line }] : []; }), a);
      },
    }),
  }),
});
const refundsOf = (d: OrderDetail, order: OrderRow): RefundShape[] => d.refunds.map((r) => ({ ...r, order }));

/* ------------------------------ Order ------------------------------ */

const money = (o: OrderRow, minor: number) => bag(o, minor);
const outstanding = (o: OrderRow, d: OrderDetail) => Math.max(0, o.total - paidAmounts(d.transactions).received);
const addr = (a: OrderDetail['shippingAddress']): AddressShape | null => a;

Order_.implement({
  interfaces: [Node],
  fields: (t) => {
    const set = <K extends string>(_k: K, f: (o: OrderRow, d: OrderDetail) => number) => ({ type: MoneyBag, resolve: async (o: OrderRow, _a: unknown, ctx: GraphQLContext) => money(o, f(o, await detailOf(ctx, o))) });
    const dateField = (f: (o: OrderRow) => Date | null) => t.field({ type: 'DateTime', nullable: true, resolve: (o) => f(o) });
    return {
      legacyResourceId: t.field({ type: 'UnsignedInt64', resolve: legacyId }),
      name: t.exposeString('name'),
      number: t.exposeInt('orderNumber'),
      createdAt: t.field({ type: 'DateTime', resolve: (o) => o.createdAt }),
      updatedAt: t.field({ type: 'DateTime', resolve: (o) => o.updatedAt }),
      processedAt: t.field({ type: 'DateTime', resolve: (o) => o.processedAt }),
      cancelledAt: dateField((o) => o.cancelledAt),
      closedAt: dateField((o) => o.closedAt),
      closed: t.boolean({ resolve: (o) => o.closedAt != null }),
      cancelReason: t.field({ type: CancelReason, nullable: true, resolve: (o) => o.cancelReason as 'OTHER' | null }),
      confirmed: t.boolean({ resolve: () => true }),
      test: t.exposeBoolean('test'),
      email: t.exposeString('email', { nullable: true }),
      phone: t.exposeString('phone', { nullable: true }),
      note: t.exposeString('note', { nullable: true }),
      tags: t.exposeStringList('tags'),
      sourceName: t.exposeString('sourceName', { nullable: true }),
      cartToken: t.exposeString('cartToken', { nullable: true }),
      taxesIncluded: t.exposeBoolean('taxesIncluded'),
      taxExempt: t.boolean({ resolve: () => false }),
      currencyCode: t.field({ type: CurrencyCode, resolve: (o) => o.currency }),
      presentmentCurrencyCode: t.field({ type: CurrencyCode, resolve: (o) => o.presentmentCurrency }),
      displayFinancialStatus: t.field({ type: FinancialStatus, nullable: true, resolve: (o) => o.financialStatus as 'PAID' }),
      displayFulfillmentStatus: t.field({ type: FulfillmentStatusEnum, resolve: (o) => o.fulfillmentStatus as 'UNFULFILLED' }),
      subtotalPriceSet: t.field({ type: MoneyBag, nullable: true, resolve: (o) => money(o, o.subtotal) }),
      totalPriceSet: t.field({ type: MoneyBag, resolve: (o) => money(o, o.total) }),
      originalTotalPriceSet: t.field({ type: MoneyBag, resolve: (o) => money(o, o.total) }),
      totalTaxSet: t.field({ type: MoneyBag, nullable: true, resolve: (o) => money(o, o.totalTax) }),
      totalShippingPriceSet: t.field({ type: MoneyBag, resolve: (o) => money(o, o.totalShipping) }),
      totalDiscountsSet: t.field({ type: MoneyBag, nullable: true, resolve: (o) => money(o, o.totalDiscounts) }),
      totalRefundedSet: t.field({ type: MoneyBag, resolve: (o) => money(o, o.totalRefunded) }),
      currentTotalPriceSet: t.field({ type: MoneyBag, resolve: (o) => money(o, o.total - o.totalRefunded) }),
      currentSubtotalPriceSet: t.field({ type: MoneyBag, resolve: (o) => money(o, o.subtotal) }),
      currentTotalTaxSet: t.field({ type: MoneyBag, resolve: (o) => money(o, o.totalTax) }),
      currentTotalDiscountsSet: t.field({ type: MoneyBag, resolve: (o) => money(o, o.totalDiscounts) }),
      currentShippingPriceSet: t.field({ type: MoneyBag, resolve: (o) => money(o, o.totalShipping) }),
      cartDiscountAmountSet: t.field({ type: MoneyBag, nullable: true, resolve: (o) => money(o, o.totalDiscounts) }),
      currentCartDiscountAmountSet: t.field({ type: MoneyBag, resolve: (o) => money(o, o.totalDiscounts) }),
      totalCapturableSet: t.field({ type: MoneyBag, resolve: (o) => money(o, 0) }),
      totalTipReceivedSet: t.field({ type: MoneyBag, resolve: (o) => money(o, 0) }),
      totalRefundedShippingSet: t.field({ type: MoneyBag, resolve: (o) => money(o, 0) }),
      // Deprecated shop-currency scalars, kept because many clients still select them.
      ...Object.fromEntries(([
        ['totalPrice', (o: OrderRow) => o.total], ['subtotalPrice', (o: OrderRow) => o.subtotal], ['totalTax', (o: OrderRow) => o.totalTax], ['totalDiscounts', (o: OrderRow) => o.totalDiscounts],
        ['totalShippingPrice', (o: OrderRow) => o.totalShipping], ['totalRefunded', (o: OrderRow) => o.totalRefunded], ['cartDiscountAmount', (o: OrderRow) => o.totalDiscounts],
        ['totalCapturable', () => 0],
      ] as const).map(([name, f]) => [name, t.field({ type: 'Money', nullable: name === 'subtotalPrice' || name === 'totalTax' || name === 'totalDiscounts' || name === 'cartDiscountAmount', deprecationReason: `Use \`${name}Set\` instead.`, resolve: (o: OrderRow) => formatMoney(f(o), o.currency) })])),
      totalTipReceived: t.field({ type: MoneyV2, deprecationReason: 'Use `totalTipReceivedSet` instead.', resolve: (o) => moneyV2(0, o.currency) }),
      totalReceived: t.field({ type: 'Money', deprecationReason: 'Use `totalReceivedSet` instead.', resolve: async (o, _a, ctx) => formatMoney(paidAmounts((await detailOf(ctx, o)).transactions).received, o.currency) }),
      netPayment: t.field({ type: 'Money', deprecationReason: 'Use `netPaymentSet` instead.', resolve: async (o, _a, ctx) => { const p = paidAmounts((await detailOf(ctx, o)).transactions); return formatMoney(p.received - p.refunded, o.currency); } }),
      confirmationNumber: t.string({ nullable: true, resolve: (o) => createHash('sha256').update(`order:${o.id}`).digest('hex').slice(0, 9).toUpperCase() }),
      customerLocale: t.string({ nullable: true, resolve: async (o, _a, ctx) => (o.customerId ? (await getCustomer(ctx.db, ctx.shopId, o.customerId))?.locale ?? null : null) }),
      customerAcceptsMarketing: t.boolean({ resolve: async (o, _a, ctx) => (o.customerId ? !!(await getCustomer(ctx.db, ctx.shopId, o.customerId))?.acceptsMarketing : false) }),
      merchantEditable: t.boolean({ resolve: (o) => !o.cancelledAt }),
      edited: t.boolean({ resolve: () => false }),
      canNotifyCustomer: t.boolean({ resolve: (o) => !!o.email }),
      poNumber: t.string({ nullable: true, resolve: () => null }),
      checkoutToken: t.string({ nullable: true, resolve: (o) => o.cartToken }),
      sourceIdentifier: t.string({ nullable: true, resolve: () => null }),
      statusPageUrl: t.field({ type: 'URL', resolve: (o, _a, ctx) => `${ctx.app.config.appUrl}/account/orders/${o.id}` }),
      totalReceivedSet: t.field(set('totalReceivedSet', (_o, d) => paidAmounts(d.transactions).received)),
      netPaymentSet: t.field(set('netPaymentSet', (_o, d) => { const p = paidAmounts(d.transactions); return p.received - p.refunded; })),
      totalOutstandingSet: t.field(set('totalOutstandingSet', outstanding)),
      subtotalLineItemsQuantity: t.int({ resolve: async (o, _a, ctx) => (await detailOf(ctx, o)).lines.reduce((s, l) => s + l.quantity, 0) }),
      currentSubtotalLineItemsQuantity: t.int({ resolve: async (o, _a, ctx) => (await detailOf(ctx, o)).lines.reduce((s, l) => s + l.currentQuantity, 0) }),
      requiresShipping: t.boolean({ resolve: async (o, _a, ctx) => (await detailOf(ctx, o)).lines.some((l) => l.requiresShipping) }),
      canMarkAsPaid: t.boolean({ resolve: async (o, _a, ctx) => !o.cancelledAt && ['PENDING', 'AUTHORIZED', 'PARTIALLY_PAID'].includes(o.financialStatus) && outstanding(o, await detailOf(ctx, o)) > 0 }),
      fullyPaid: t.boolean({ resolve: async (o, _a, ctx) => outstanding(o, await detailOf(ctx, o)) === 0 && o.total > 0 }),
      unpaid: t.boolean({ resolve: async (o, _a, ctx) => paidAmounts((await detailOf(ctx, o)).transactions).received === 0 }),
      refundable: t.boolean({ resolve: async (o, _a, ctx) => { const p = paidAmounts((await detailOf(ctx, o)).transactions); return p.received - p.refunded > 0; } }),
      capturable: t.boolean({ resolve: () => false }),
      fulfillable: t.boolean({ resolve: async (o, _a, ctx) => !o.cancelledAt && (await detailOf(ctx, o)).lines.some((l) => l.currentQuantity > l.fulfilledQuantity) }),
      discountCode: t.string({ nullable: true, resolve: async (o, _a, ctx) => (await detailOf(ctx, o)).discounts.find((x) => x.code)?.code ?? null }),
      discountCodes: t.stringList({ resolve: async (o, _a, ctx) => (await detailOf(ctx, o)).discounts.flatMap((x) => (x.code ? [x.code] : [])) }),
      paymentGatewayNames: t.stringList({ resolve: async (o, _a, ctx) => [...new Set((await detailOf(ctx, o)).transactions.flatMap((x) => (x.gateway ? [x.gateway] : [])))] }),
      customAttributes: t.field({ type: [Attribute], resolve: () => [] }),
      hasTimelineComment: t.boolean({ resolve: async (o, _a, ctx) => (await listEvents(ctx.db, ctx.shopId, 'order', o.id, 500)).some((e) => e.kind === 'comment') }),
      customer: t.field({ type: Customer_, nullable: true, resolve: (o, _a, ctx) => (o.customerId ? getCustomer(ctx.db, ctx.shopId, o.customerId) : null) }),
      shippingAddress: t.field({ type: MailingAddress, nullable: true, resolve: async (o, _a, ctx) => addr((await detailOf(ctx, o)).shippingAddress) }),
      billingAddress: t.field({ type: MailingAddress, nullable: true, resolve: async (o, _a, ctx) => addr((await detailOf(ctx, o)).billingAddress) }),
      billingAddressMatchesShippingAddress: t.boolean({
        resolve: async (o, _a, ctx) => { const d = await detailOf(ctx, o); const k = (a: typeof d.shippingAddress) => JSON.stringify([a?.address1, a?.city, a?.zip, a?.countryCode]); return k(d.shippingAddress) === k(d.billingAddress); },
      }),
      lineItems: t.field({ type: LineItemConnection, args: ConnectionArgs, resolve: async (o, a, ctx) => asList(linesOf(await detailOf(ctx, o), o), a) }),
      shippingLines: t.field({
        type: ShippingLineConnection, args: { ...ConnectionArgs, includeRemovals: t.arg.boolean({ defaultValue: false }) },
        resolve: async (o, a, ctx) => asList((await detailOf(ctx, o)).shippingLines.map((s) => ({ ...s, order: o })), a),
      }),
      shippingLine: t.field({ type: ShippingLine, nullable: true, resolve: async (o, _a, ctx) => { const s = (await detailOf(ctx, o)).shippingLines[0]; return s ? { ...s, order: o } : null; } }),
      taxLines: t.field({ type: [TaxLine], resolve: async (o, _a, ctx) => taxLinesOf((await detailOf(ctx, o)).taxLines, o) }),
      discountApplications: t.field({
        type: DiscountApplicationConnection, args: ConnectionArgs,
        resolve: async (o, a, ctx) => asList((await detailOf(ctx, o)).discounts.map((x, index) => ({ ...x, index, order: o })), a),
      }),
      transactions: t.field({ type: [OrderTransaction], args: { first: t.arg.int(), capturable: t.arg.boolean(), manuallyResolvable: t.arg.boolean() }, resolve: async (o, _a, ctx) => txsOf((await detailOf(ctx, o)).transactions, o) }),
      transactionsCount: t.field({ type: Count, nullable: true, resolve: async (o, _a, ctx) => ({ count: (await detailOf(ctx, o)).transactions.length, precision: 'EXACT' as const }) }),
      fulfillments: t.field({
        type: [Fulfillment], args: { first: t.arg.int(), query: t.arg.string() },
        resolve: async (o, a, ctx) => (await detailOf(ctx, o)).fulfillments.map((f) => ({ ...f, order: o })).slice(0, a.first ?? undefined),
      }),
      fulfillmentsCount: t.field({ type: Count, nullable: true, resolve: async (o, _a, ctx) => ({ count: (await detailOf(ctx, o)).fulfillments.length, precision: 'EXACT' as const }) }),
      refunds: t.field({ type: [Refund], args: { first: t.arg.int() }, resolve: async (o, a, ctx) => refundsOf(await detailOf(ctx, o), o).slice(0, a.first ?? undefined) }),
      events: t.field({
        type: EventConnection, args: { ...ConnectionArgs, sortKey: t.arg({ type: EventSortKeys, defaultValue: 'ID' }), query: t.arg.string() },
        resolve: async (o, a, ctx) => {
          const rows = (await listEvents(ctx.db, ctx.shopId, 'order', o.id, 500)) as EventRow[]; // newest first
          return asList(a.reverse ? rows : [...rows].reverse(), { ...a, reverse: false });
        },
      }),
    };
  },
});
registerNode('Order', (ctx, id) => getOrder(ctx.db, ctx.shopId, id));
registerTaggable('Order', async (ctx, id, mode, tags) => { requireScope(ctx, 'write_orders'); return changeOrderTags(ctx.db, ctx.shopId, id, mode, tags); });

/* ------------------------------ queries ------------------------------ */

const oid = (v: string | number) => parseId(String(v), 'Order');

builder.queryFields((t) => ({
  order: t.field({
    type: Order_, nullable: true, args: { id: t.arg.id({ required: true }) },
    resolve: (_r, a, ctx) => { requireScope(ctx, 'read_orders'); const id = oid(a.id); return id ? getOrder(ctx.db, ctx.shopId, id) : null; },
  }),
  orders: t.field({
    type: OrderConnection, args: { ...ConnectionArgs, sortKey: t.arg({ type: OrderSortKeys, defaultValue: 'PROCESSED_AT' }), query: t.arg.string(), savedSearchId: t.arg.id() },
    resolve: (_r, a, ctx) => {
      requireScope(ctx, 'read_orders');
      // Shopify lists newest first by default; `reverse: true` flips to oldest first for date keys, so the DB direction is inverted for them.
      const newestFirst = ['PROCESSED_AT', 'CREATED_AT', 'UPDATED_AT', 'ID', 'ORDER_NUMBER'].includes(a.sortKey ?? 'PROCESSED_AT');
      const reverse = newestFirst ? !a.reverse : !!a.reverse;
      return paginate(a, {
        fetch: ({ offset, limit }) => listOrders(ctx.db, ctx.shopId, { query: a.query, sortKey: a.sortKey ?? 'PROCESSED_AT', reverse, offset, limit }),
        total: async () => (await countOrders(ctx.db, ctx.shopId, a.query)).count,
      });
    },
  }),
  ordersCount: t.field({
    type: Count, nullable: true, args: { query: t.arg.string(), savedSearchId: t.arg.id(), limit: t.arg.int({ defaultValue: 10000 }) },
    resolve: (_r, a, ctx) => { requireScope(ctx, 'read_orders'); return countOrders(ctx.db, ctx.shopId, a.query, a.limit ?? 10000); },
  }),
}));

/* ------------------------------ mutations ------------------------------ */

const OrderInput = builder.inputType('OrderInput', {
  fields: (t) => ({
    id: t.id({ required: true }), email: t.string(), phone: t.string(), note: t.string(), tags: t.stringList(), shippingAddress: t.field({ type: MailingAddressInput }),
    poNumber: t.string(),
  }),
});
const IdInput = (name: string) => builder.inputType(name, { fields: (t) => ({ id: t.id({ required: true }) }) });
const OrderCloseInput = IdInput('OrderCloseInput');
const OrderOpenInput = IdInput('OrderOpenInput');
const OrderMarkAsPaidInput = IdInput('OrderMarkAsPaidInput');

type OrderPayload = { order: OrderRow | null };
const orderPayload = (name: string) => definePayload<OrderPayload>(name, (t) => ({ order: t.field({ type: Order_, nullable: true, resolve: (p) => p.order }) }));
const UpdatePayload = orderPayload('OrderUpdatePayload');
const ClosePayload = orderPayload('OrderClosePayload');
const OpenPayload = orderPayload('OrderOpenPayload');
const PaidPayload = orderPayload('OrderMarkAsPaidPayload');

const noOrder = (field: string[]): UserError[] => [{ field, message: 'Order does not exist' }];
async function orderOp(ctx: GraphQLContext, rawId: string | number, field: string[], run: (id: number) => Promise<{ ok: true; value: OrderRow } | { ok: false; errors: UserError[] }>) {
  requireScope(ctx, 'write_orders');
  const id = oid(rawId);
  if (!id) return { order: null, userErrors: noOrder(field) };
  const r = await run(id);
  return r.ok ? { order: r.value, userErrors: [] } : { order: null, userErrors: r.errors.map((e) => ({ ...e, field: e.field?.[0] === 'id' ? field : e.field })) };
}

const OrderCancelUserError = builder.objectRef<UserError>('OrderCancelUserError');
const OrderCancelUserErrorCode = builder.enumType('OrderCancelUserErrorCode', {
  values: ['NO_REFUND_PERMISSION', 'NO_REFUND_TO_STORE_CREDIT_PERMISSION', 'STORE_CREDIT_REFUND_EXPIRATION_IN_PAST', 'STORE_CREDIT_REFUND_MISSING_CUSTOMER', 'STORE_CREDIT_REFUND_B2B_NOT_SUPPORTED', 'NOT_FOUND', 'INVALID', 'INTERNAL_ERROR'] as const,
});
OrderCancelUserError.implement({ interfaces: [DisplayableError], fields: (t) => ({ code: t.field({ type: OrderCancelUserErrorCode, nullable: true, resolve: (e) => (e.code as 'INVALID') ?? null }) }) });
const OrderCancelRefundMethodInput = builder.inputType('OrderCancelRefundMethodInput', { fields: (t) => ({ originalPaymentMethodsRefund: t.boolean() }) });
const OrderCancelPayload = builder.objectRef<{ job: { id: string; done: boolean } | null; orderCancelUserErrors: UserError[] }>('OrderCancelPayload').implement({
  fields: (t) => ({
    job: t.field({ type: Job, nullable: true, resolve: (p) => p.job }),
    orderCancelUserErrors: t.field({ type: [OrderCancelUserError], resolve: (p) => p.orderCancelUserErrors }),
    userErrors: t.field({ type: [UserErrorRef], resolve: (p) => p.orderCancelUserErrors }),
  }),
});

const FulfillmentTrackingInput = builder.inputType('FulfillmentTrackingInput', {
  fields: (t) => ({ number: t.string(), url: t.field({ type: 'URL' }), company: t.string(), numbers: t.stringList(), urls: t.field({ type: ['URL'] }) }),
});
const FulfillmentOrderLineItemInput = builder.inputType('FulfillmentOrderLineItemInput', { fields: (t) => ({ id: t.id({ required: true }), quantity: t.int({ required: true }) }) });
const FulfillmentOrderLineItemsInput = builder.inputType('FulfillmentOrderLineItemsInput', {
  fields: (t) => ({ fulfillmentOrderId: t.id({ required: true }), fulfillmentOrderLineItems: t.field({ type: [FulfillmentOrderLineItemInput] }) }),
});
/** Real input requires `lineItemsByFulfillmentOrder`; ShopMe has no fulfillment orders, so `orderId` + `lineItems` (or nothing: fulfil all) also work. */
const FulfillmentInput = builder.inputType('FulfillmentInput', {
  fields: (t) => ({
    trackingInfo: t.field({ type: FulfillmentTrackingInput }), notifyCustomer: t.boolean({ defaultValue: false }),
    lineItemsByFulfillmentOrder: t.field({ type: [FulfillmentOrderLineItemsInput] }),
    orderId: t.id({ description: 'ShopMe extension: the order to fulfil.' }), lineItems: t.field({ type: [FulfillmentOrderLineItemInput], description: 'ShopMe extension: line item ids (LineItem GIDs) and quantities; omit to fulfil everything left.' }),
    locationId: t.id({ description: 'ShopMe extension: the location stock ships from (default: the first by priority).' }),
  }),
});
const FulfillmentPayload = definePayload<{ fulfillment: FulfillmentShape | null }>('FulfillmentCreatePayload', (t) => ({ fulfillment: t.field({ type: Fulfillment, nullable: true, resolve: (p) => p.fulfillment }) }));
const TrackingPayload = definePayload<{ fulfillment: FulfillmentShape | null }>('FulfillmentTrackingInfoUpdatePayload', (t) => ({ fulfillment: t.field({ type: Fulfillment, nullable: true, resolve: (p) => p.fulfillment }) }));

const ShippingRefundInput = builder.inputType('ShippingRefundInput', { fields: (t) => ({ amount: t.field({ type: 'Money' }), fullRefund: t.boolean() }) });
const RefundLineItemInput = builder.inputType('RefundLineItemInput', {
  fields: (t) => ({ lineItemId: t.id({ required: true }), quantity: t.int({ required: true }), restockType: t.field({ type: RestockType }), locationId: t.id() }),
});
const OrderTransactionInput = builder.inputType('OrderTransactionInput', {
  fields: (t) => ({ amount: t.field({ type: 'Money', required: true }), gateway: t.string({ required: true }), kind: t.field({ type: TxKind, required: true }), orderId: t.id({ required: true }), parentId: t.id() }),
});
const RefundInput = builder.inputType('RefundInput', {
  fields: (t) => ({
    currency: t.field({ type: CurrencyCode }), orderId: t.id({ required: true }), note: t.string(), notify: t.boolean(), shipping: t.field({ type: ShippingRefundInput }), processedAt: t.field({ type: 'DateTime' }),
    refundLineItems: t.field({ type: [RefundLineItemInput] }), transactions: t.field({ type: [OrderTransactionInput] }), allowOverRefunding: t.boolean({ defaultValue: false }),
  }),
});
const RefundPayload = definePayload<{ order: OrderRow | null; refund: RefundShape | null }>('RefundCreatePayload', (t) => ({
  order: t.field({ type: Order_, nullable: true, resolve: (p) => p.order }), refund: t.field({ type: Refund, nullable: true, resolve: (p) => p.refund }),
}));
const CommentPayload = definePayload<{ event: EventRow | null }>('OrderTimelineCommentCreatePayload', (t) => ({ event: t.field({ type: CommentEvent, nullable: true, resolve: (p) => p.event }) }));

builder.mutationFields((t) => ({
  orderUpdate: t.field({
    type: UpdatePayload, args: { input: t.arg({ type: OrderInput, required: true }) },
    resolve: (_r, { input }, ctx) => orderOp(ctx, input.id, ['input', 'id'], (id) => updateOrder(ctx.db, ctx.shopId, id, {
      email: input.email, phone: input.phone, note: input.note, tags: input.tags,
      shippingAddress: input.shippingAddress ? { ...input.shippingAddress, countryCode: input.shippingAddress.countryCode ?? undefined } : undefined,
    }, staffId(ctx))),
  }),
  orderClose: t.field({ type: ClosePayload, args: { input: t.arg({ type: OrderCloseInput, required: true }) }, resolve: (_r, { input }, ctx) => orderOp(ctx, input.id, ['input', 'id'], (id) => closeOrder(ctx.db, ctx.shopId, id, staffId(ctx))) }),
  orderOpen: t.field({ type: OpenPayload, args: { input: t.arg({ type: OrderOpenInput, required: true }) }, resolve: (_r, { input }, ctx) => orderOp(ctx, input.id, ['input', 'id'], (id) => openOrder(ctx.db, ctx.shopId, id, staffId(ctx))) }),
  orderMarkAsPaid: t.field({
    type: PaidPayload, args: { input: t.arg({ type: OrderMarkAsPaidInput, required: true }) },
    resolve: (_r, { input }, ctx) => orderOp(ctx, input.id, ['input', 'id'], (id) => markOrderAsPaid(ctx.db, ctx.shopId, id, staffId(ctx))),
  }),
  orderCancel: t.field({
    type: OrderCancelPayload,
    args: {
      orderId: t.arg.id({ required: true }), refund: t.arg.boolean({ deprecationReason: 'Use `refundMethod` instead.' }), refundMethod: t.arg({ type: OrderCancelRefundMethodInput }),
      restock: t.arg.boolean({ required: true }), reason: t.arg({ type: CancelReason, required: true }), notifyCustomer: t.arg.boolean({ defaultValue: false }), staffNote: t.arg.string(),
    },
    resolve: async (_r, a, ctx) => {
      requireScope(ctx, 'write_orders');
      const id = oid(a.orderId);
      if (!id) return { job: null, orderCancelUserErrors: [{ field: ['orderId'], message: 'Order does not exist', code: 'NOT_FOUND' }] };
      const r = await cancelOrder(ctx.db, ctx.shopId, id, { reason: a.reason, restock: a.restock, refund: !!(a.refund || a.refundMethod?.originalPaymentMethodsRefund), staffNote: a.staffNote, staffId: staffId(ctx), notifyCustomer: !!a.notifyCustomer });
      return r.ok ? { job: { id: toGid('Job', randomUUID()), done: true }, orderCancelUserErrors: [] } : { job: null, orderCancelUserErrors: r.errors };
    },
  }),
  fulfillmentCreate: t.field({
    type: FulfillmentPayload, args: { fulfillment: t.arg({ type: FulfillmentInput, required: true }), message: t.arg.string() },
    resolve: async (_r, { fulfillment: f }, ctx) => {
      requireScope(ctx, 'write_fulfillments');
      const groups = f.lineItemsByFulfillmentOrder ?? [];
      const rawOrder = f.orderId ?? groups[0]?.fulfillmentOrderId;
      const orderId = rawOrder ? parseId(String(rawOrder), 'Order') ?? parseId(String(rawOrder), 'FulfillmentOrder') : null;
      if (!orderId) return { fulfillment: null, userErrors: [{ field: ['fulfillment', 'orderId'], message: 'Order does not exist' }] };
      const picks = (f.lineItems ?? groups.flatMap((g) => g.fulfillmentOrderLineItems ?? [])).map((l) => ({ id: parseId(String(l.id), 'LineItem'), quantity: l.quantity }));
      if (picks.some((p) => p.id == null)) return { fulfillment: null, userErrors: [{ field: ['fulfillment', 'lineItems'], message: 'Invalid line item id' }] };
      const tr = f.trackingInfo;
      const r = await createFulfillment(ctx.db, ctx.shopId, orderId, {
        lines: picks.length ? picks.map((p) => ({ orderLineId: p.id!, quantity: p.quantity })) : null,
        tracking: tr ? { company: tr.company, numbers: tr.numbers ?? (tr.number ? [tr.number] : []), urls: tr.urls ?? (tr.url ? [tr.url] : []) } : null,
        notifyCustomer: !!f.notifyCustomer, staffId: staffId(ctx), locationId: f.locationId ? parseId(String(f.locationId), 'Location') : null,
      });
      return r.ok ? { fulfillment: { ...r.value.fulfillment, order: r.value.order }, userErrors: [] } : { fulfillment: null, userErrors: r.errors };
    },
  }),
  fulfillmentTrackingInfoUpdate: t.field({
    type: TrackingPayload, args: { fulfillmentId: t.arg.id({ required: true }), trackingInfoInput: t.arg({ type: FulfillmentTrackingInput, required: true }), notifyCustomer: t.arg.boolean() },
    resolve: async (_r, a, ctx) => {
      requireScope(ctx, 'write_fulfillments');
      const id = parseId(String(a.fulfillmentId), 'Fulfillment');
      const i = a.trackingInfoInput;
      const r = id ? await updateTracking(ctx.db, ctx.shopId, id, { company: i.company, numbers: i.numbers ?? (i.number ? [i.number] : undefined), urls: i.urls ?? (i.url ? [i.url] : undefined) }, a.notifyCustomer ?? undefined) : null;
      if (!r?.ok) return { fulfillment: null, userErrors: r ? r.errors : [{ field: ['fulfillmentId'], message: 'Fulfillment does not exist' }] };
      return { fulfillment: { ...r.value, order: (await getOrder(ctx.db, ctx.shopId, r.value.orderId))! }, userErrors: [] };
    },
  }),
  refundCreate: t.field({
    type: RefundPayload, args: { input: t.arg({ type: RefundInput, required: true }) },
    resolve: async (_r, { input }, ctx) => {
      requireScope(ctx, 'write_orders');
      const orderId = oid(input.orderId);
      const order = orderId ? await getOrder(ctx.db, ctx.shopId, orderId) : null;
      if (!orderId || !order) return { order: null, refund: null, userErrors: [{ field: ['input', 'orderId'], message: 'Order does not exist' }] };
      const lines = (input.refundLineItems ?? []).map((l) => ({ orderLineId: parseId(String(l.lineItemId), 'LineItem'), quantity: l.quantity, restockType: l.restockType, locationId: l.locationId ? parseId(String(l.locationId), 'Location') : null }));
      if (lines.some((l) => l.orderLineId == null)) return { order: null, refund: null, userErrors: [{ field: ['input', 'refundLineItems'], message: 'Invalid line item id' }] };
      const r = await refundOrder(ctx.db, ctx.shopId, orderId, {
        note: input.note, lines: lines.map((l) => ({ ...l, orderLineId: l.orderLineId! })), allowOverRefunding: !!input.allowOverRefunding, processedAt: input.processedAt, staffId: staffId(ctx), notifyCustomer: !!input.notify,
        shipping: input.shipping ? { full: input.shipping.fullRefund, amount: input.shipping.amount != null ? parseMoney(input.shipping.amount, order.currency) : null } : null,
        transactions: input.transactions?.map((x) => ({ amount: parseMoney(x.amount, order.currency), gateway: x.gateway, parentId: x.parentId ? parseId(String(x.parentId), 'OrderTransaction') : null })),
      });
      return r.ok
        ? { order: r.value.order, refund: { ...r.value.refund, order: r.value.order }, userErrors: [] }
        : { order: null, refund: null, userErrors: r.errors.map((e) => ({ ...e, field: ['input', ...(e.field ?? [])] })) };
    },
  }),
  /** ShopMe extension: Shopify has no public API for staff timeline comments. */
  orderTimelineCommentCreate: t.field({
    type: CommentPayload, args: { id: t.arg.id({ required: true }), message: t.arg.string({ required: true }) },
    resolve: async (_r, a, ctx) => {
      requireScope(ctx, 'write_orders');
      const id = oid(a.id);
      if (!id) return { event: null, userErrors: noOrder(['id']) };
      const r = await addOrderComment(ctx.db, ctx.shopId, id, a.message, staffId(ctx));
      return r.ok ? { event: r.value as EventRow, userErrors: [] } : { event: null, userErrors: r.errors };
    },
  }),
}));

