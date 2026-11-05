import {
  calculateDraftOrder, completeDraftOrder, convertMinor, currencyRate, countDraftOrders, createDraftOrder, deleteDraftOrder, draftInvoiceUrl, getCustomer, getDraftOrder, getOrder, getProduct, getShop, getVariant,
  listDraftOrders, sendDraftInvoice, updateDraftOrder, type DraftCalc, type DraftInput, type DraftLine, type DraftLineInput, type DraftOrder as DraftRow, type PricingResult, type Shop as ShopRow,
} from '@shopme/core';
import { and, eq } from 'drizzle-orm';
import { schema } from '@shopme/core';
import { parseId, parseMoney, toGid, type UserError } from '@shopme/shopify-compat';
import { builder } from '../builder';
import { requireScope, type GraphQLContext } from '../context';
import { ConnectionArgs, defineConnection, paginate } from '../types/connection';
import { definePayload } from '../types/errors';
import { Count, CurrencyCode, MoneyBag, moneyBag } from '../types/money';
import { Node, legacyId, registerNode } from '../types/node';
import { Product_, ProductVariant } from '../types/catalog';
import { Customer_, MailingAddress, MailingAddressInput, Order_, type AddressShape } from '../types/sales';
import { Image } from './files';
import { Attribute } from './orders';

/**
 * Draft orders (Shopify's `draftOrder*` API). Lines are catalog variants or custom items, with per-line and order-level discounts and a
 * custom shipping line. Prices are computed by the checkout pricing engine (taxes from the shipping country). Completing a draft goes
 * through the regular order creation. Differences: fixed-amount line discounts apply to the whole line, `discountCodes` are ignored,
 * the invoice link `/draft_orders/<token>/pay` opens the checkout (variant-only drafts) or a payment-pending confirmation page.
 */

const Status = builder.enumType('DraftOrderStatus', { values: ['OPEN', 'INVOICE_SENT', 'COMPLETED'] as const });
const DiscountType = builder.enumType('DraftOrderAppliedDiscountType', { values: ['FIXED_AMOUNT', 'PERCENTAGE'] as const });

/* ------------------------------ shapes ------------------------------ */

interface View {
  id: number; name: string; status: 'OPEN' | 'INVOICE_SENT' | 'COMPLETED'; email: string | null; phone: string | null; note: string | null; tags: string[]; taxExempt: boolean; taxesIncluded: boolean; currency: string;
  lines: DraftLine[]; calc: DraftCalc; appliedDiscount: DraftRow['appliedDiscount']; shippingLine: DraftRow['shippingLine']; shippingAddress: DraftRow['shippingAddress']; billingAddress: DraftRow['billingAddress'];
  poNumber: string | null; marketId: number | null; presentmentCurrency: string | null;
  customerId: number | null; orderId: number | null; createdAt: Date; updatedAt: Date; completedAt: Date | null; invoiceSentAt: Date | null; invoiceUrl: string | null;
  totals: { subtotal: number; totalDiscounts: number; totalShipping: number; totalTax: number; total: number };
}
interface LineView { l: DraftLine; c: DraftCalc['lines'][number]; currency: string }

const emptyCalc: DraftCalc = { lines: [], orderDiscount: 0, taxLines: [] };
const viewOf = (shop: ShopRow, appUrl: string, d: DraftRow): View => ({
  id: d.id, name: d.name, status: d.status as View['status'], email: d.email, phone: d.phone, note: d.note, tags: d.tags, taxExempt: d.taxExempt, taxesIncluded: shop.taxesIncluded, currency: d.currency,
  lines: d.lines, calc: d.calc ?? emptyCalc, appliedDiscount: d.appliedDiscount, shippingLine: d.shippingLine, shippingAddress: d.shippingAddress, billingAddress: d.billingAddress,
  poNumber: d.poNumber, marketId: d.marketId, presentmentCurrency: d.presentmentCurrency,
  customerId: d.customerId, orderId: d.orderId, createdAt: d.createdAt, updatedAt: d.updatedAt, completedAt: d.completedAt, invoiceSentAt: d.invoiceSentAt, invoiceUrl: d.status === 'COMPLETED' ? null : draftInvoiceUrl(shop, appUrl, d),
  totals: { subtotal: d.subtotal, totalDiscounts: d.totalDiscounts, totalShipping: d.totalShipping, totalTax: d.totalTax, total: d.total },
});
const calcViewOf = (shop: ShopRow, draft: Omit<DraftInput, 'lines'> & { lines: DraftLine[]; currency: string }, pricing: PricingResult, calc: DraftCalc): View => ({
  id: 0, name: '', status: 'OPEN', email: draft.email ?? null, phone: draft.phone ?? null, note: draft.note ?? null, tags: draft.tags ?? [], taxExempt: !!draft.taxExempt, taxesIncluded: shop.taxesIncluded, currency: draft.currency,
  lines: draft.lines, calc, appliedDiscount: draft.appliedDiscount ?? null, shippingLine: draft.shippingLine ?? null, shippingAddress: draft.shippingAddress ?? null, billingAddress: draft.billingAddress ?? null,
  poNumber: draft.poNumber ?? null, marketId: draft.marketId ?? null, presentmentCurrency: (draft as { presentmentCurrency?: string | null }).presentmentCurrency ?? null,
  customerId: draft.customerId ?? null, orderId: null, createdAt: new Date(), updatedAt: new Date(), completedAt: null, invoiceSentAt: null, invoiceUrl: null,
  totals: { subtotal: pricing.subtotal, totalDiscounts: pricing.totalDiscounts, totalShipping: pricing.totalShipping, totalTax: pricing.totalTax, total: pricing.total },
});

const bag = (minor: number, currency: string) => moneyBag(minor, currency);
const addressOf = (a: View['shippingAddress']): AddressShape | null => (a ? {
  id: 0, firstName: a.firstName ?? null, lastName: a.lastName ?? null, company: a.company ?? null, address1: a.address1 ?? null, address2: a.address2 ?? null, city: a.city ?? null,
  province: a.province ?? null, provinceCode: a.provinceCode ?? null, zip: a.zip ?? null, country: a.country ?? null, countryCode: a.countryCode ?? null, phone: a.phone ?? null,
} : null);

/* ------------------------------ types ------------------------------ */

const AppliedDiscount = builder.objectRef<{ d: NonNullable<DraftLine['discount']>; amount: number; currency: string }>('DraftOrderAppliedDiscount').implement({
  fields: (t) => ({
    title: t.string({ nullable: true, resolve: (x) => x.d.title }),
    description: t.string({ resolve: (x) => x.d.description ?? x.d.title ?? '' }),
    value: t.float({ resolve: (x) => x.d.value }),
    valueType: t.field({ type: DiscountType, resolve: (x) => x.d.valueType }),
    amountSet: t.field({ type: MoneyBag, resolve: (x) => bag(x.amount, x.currency) }),
  }),
});

const TaxLine = builder.objectRef<{ title: string; rate: number; price: number; currency: string }>('DraftOrderTaxLine').implement({
  fields: (t) => ({
    title: t.exposeString('title'), rate: t.float({ resolve: (x) => x.rate / 100 }), ratePercentage: t.float({ resolve: (x) => x.rate }),
    priceSet: t.field({ type: MoneyBag, resolve: (x) => bag(x.price, x.currency) }),
  }),
});

const ShippingLine = builder.objectRef<{ title: string; price: number; currency: string }>('DraftOrderShippingLine').implement({
  description: 'The shipping line of a draft order (Shopify returns `ShippingLine`; same field names).',
  fields: (t) => ({
    id: t.id({ nullable: true, resolve: () => null }), title: t.exposeString('title'), code: t.string({ nullable: true, resolve: () => null }), custom: t.boolean({ resolve: () => true }),
    originalPriceSet: t.field({ type: MoneyBag, resolve: (s) => bag(s.price, s.currency) }), discountedPriceSet: t.field({ type: MoneyBag, resolve: (s) => bag(s.price, s.currency) }),
  }),
});

/** Fields shared by the stored and the calculated draft order line item. */
const lineFields = (t: PothosSchemaTypes.ObjectFieldBuilder<PothosSchemaTypes.ExtendDefaultTypes<import('../builder').SchemaTypes>, LineView>) => ({
  uuid: t.string({ resolve: (x) => x.l.uuid }),
  name: t.string({ resolve: (x) => (x.l.variantTitle ? `${x.l.title} - ${x.l.variantTitle}` : x.l.title) }),
  title: t.string({ resolve: (x) => x.l.title }),
  variantTitle: t.string({ nullable: true, resolve: (x) => x.l.variantTitle }),
  sku: t.string({ nullable: true, resolve: (x) => x.l.sku }),
  vendor: t.string({ nullable: true, resolve: (x) => x.l.vendor }),
  quantity: t.int({ resolve: (x) => x.l.quantity }),
  custom: t.boolean({ resolve: (x) => x.l.variantId == null }),
  requiresShipping: t.boolean({ resolve: (x) => x.l.requiresShipping }),
  taxable: t.boolean({ resolve: (x) => x.l.taxable }),
  isGiftCard: t.boolean({ resolve: () => false }),
  customAttributes: t.field({ type: [Attribute], resolve: (x) => Object.entries(x.l.properties).map(([key, value]) => ({ key, value })) }),
  originalUnitPriceSet: t.field({ type: MoneyBag, resolve: (x) => bag(x.l.unitPrice, x.currency) }),
  originalTotalSet: t.field({ type: MoneyBag, resolve: (x) => bag(x.c.subtotal, x.currency) }),
  discountedTotalSet: t.field({ type: MoneyBag, resolve: (x) => bag(x.c.total, x.currency) }),
  totalDiscountSet: t.field({ type: MoneyBag, resolve: (x) => bag(x.c.discount, x.currency) }),
  appliedDiscount: t.field({ type: AppliedDiscount, nullable: true, resolve: (x) => (x.l.discount ? { d: x.l.discount, amount: x.c.lineDiscount, currency: x.currency } : null) }),
  image: t.field({ type: Image, nullable: true, resolve: (x) => (x.l.imageUrl ? { id: null, url: x.l.imageUrl, altText: x.l.title, width: null, height: null } : null) }),
  product: t.field({ type: Product_, nullable: true, resolve: (x, _a, ctx) => (x.l.productId ? getProduct(ctx.db, ctx.shopId, x.l.productId) : null) }),
  variant: t.field({ type: ProductVariant, nullable: true, resolve: (x, _a, ctx) => (x.l.variantId ? getVariant(ctx.db, ctx.shopId, x.l.variantId) : null) }),
});
const lineViews = (v: View): LineView[] => v.lines.map((l, i) => ({ l, c: v.calc.lines[i] ?? { uuid: l.uuid, subtotal: l.unitPrice * l.quantity, discount: 0, lineDiscount: 0, total: l.unitPrice * l.quantity, tax: 0 }, currency: v.currency }));

const LineItem = builder.objectRef<LineView>('DraftOrderLineItem').implement({ fields: (t) => ({ id: t.id({ resolve: (x) => toGid('DraftOrderLineItem', x.l.uuid) }), ...lineFields(t) }) });
const CalculatedLineItem = builder.objectRef<LineView>('CalculatedDraftOrderLineItem').implement({ fields: (t) => lineFields(t) });
const LineItemConnection = defineConnection('DraftOrderLineItem', LineItem);

const viewFields = (t: PothosSchemaTypes.ObjectFieldBuilder<PothosSchemaTypes.ExtendDefaultTypes<import('../builder').SchemaTypes>, View>) => {
  const m = (pick: (v: View) => number) => (v: View) => bag(pick(v), v.currency);
  return {
    currencyCode: t.field({ type: CurrencyCode, resolve: (v) => v.currency }),
    presentmentCurrencyCode: t.field({ type: CurrencyCode, resolve: (v) => v.presentmentCurrency ?? v.currency }),
    poNumber: t.string({ nullable: true, resolve: (v) => v.poNumber }),
    shopmeMarket: t.field({
      type: DraftMarket, nullable: true, description: 'ShopMe extension: the market the draft is sold in.',
      resolve: async (v, _a, ctx) => {
        if (!v.marketId) return null;
        const [m] = await ctx.db.select().from(schema.markets).where(and(eq(schema.markets.shopId, ctx.shopId), eq(schema.markets.id, v.marketId))).limit(1);
        return m ? { id: m.id, name: m.name, currency: v.presentmentCurrency ?? v.currency } : null;
      },
    }),
    shopmePresentmentTotalSet: t.field({
      type: MoneyBag, nullable: true, description: 'ShopMe extension: the total converted to the currency of the draft market (for quoting; the order itself is created in the shop currency).',
      resolve: async (v, _a, ctx) => {
        if (!v.presentmentCurrency || v.presentmentCurrency === v.currency) return null;
        const rate = await currencyRate(ctx.db, ctx.shopId, v.currency, v.presentmentCurrency);
        return rate ? moneyBag(convertMinor(v.totals.total, v.currency, v.presentmentCurrency, rate), v.presentmentCurrency) : null;
      },
    }),
    email: t.string({ nullable: true, resolve: (v) => v.email }),
    phone: t.string({ nullable: true, resolve: (v) => v.phone }),
    taxExempt: t.boolean({ resolve: (v) => v.taxExempt }),
    taxesIncluded: t.boolean({ resolve: (v) => v.taxesIncluded }),
    tags: t.stringList({ resolve: (v) => v.tags }),
    customer: t.field({ type: Customer_, nullable: true, resolve: (v, _a, ctx) => (v.customerId ? getCustomer(ctx.db, ctx.shopId, v.customerId) : null) }),
    appliedDiscount: t.field({ type: AppliedDiscount, nullable: true, resolve: (v) => (v.appliedDiscount ? { d: v.appliedDiscount, amount: v.calc.orderDiscount, currency: v.currency } : null) }),
    shippingLine: t.field({ type: ShippingLine, nullable: true, resolve: (v) => (v.shippingLine ? { ...v.shippingLine, currency: v.currency } : null) }),
    shippingAddress: t.field({ type: MailingAddress, nullable: true, resolve: (v) => addressOf(v.shippingAddress) }),
    billingAddress: t.field({ type: MailingAddress, nullable: true, resolve: (v) => addressOf(v.billingAddress) }),
    taxLines: t.field({ type: [TaxLine], resolve: (v) => v.calc.taxLines.map((x) => ({ ...x, currency: v.currency })) }),
    totalQuantityOfLineItems: t.int({ resolve: (v) => v.lines.reduce((n, l) => n + l.quantity, 0) }),
    totalWeight: t.field({ type: 'UnsignedInt64', resolve: (v) => String(v.lines.reduce((n, l) => n + l.grams * l.quantity, 0)) }),
    totalLineItemsPriceSet: t.field({ type: MoneyBag, resolve: m((v) => v.totals.subtotal) }),
    lineItemsSubtotalPrice: t.field({ type: MoneyBag, resolve: m((v) => v.totals.subtotal) }),
    totalDiscountsSet: t.field({ type: MoneyBag, resolve: m((v) => v.totals.totalDiscounts) }),
    subtotalPriceSet: t.field({ type: MoneyBag, description: 'Line items after discounts.', resolve: m((v) => v.totals.subtotal - v.totals.totalDiscounts) }),
    totalShippingPriceSet: t.field({ type: MoneyBag, resolve: m((v) => v.totals.totalShipping) }),
    totalTaxSet: t.field({ type: MoneyBag, resolve: m((v) => v.totals.totalTax) }),
    totalPriceSet: t.field({ type: MoneyBag, resolve: m((v) => v.totals.total) }),
  };
};

const DraftMarket = builder.objectRef<{ id: number; name: string; currency: string }>('ShopmeDraftMarket').implement({ fields: (t) => ({ id: t.id({ resolve: (m) => toGid('Market', m.id) }), name: t.exposeString('name'), currencyCode: t.field({ type: CurrencyCode, resolve: (m) => m.currency }) }) });
export const DraftOrder = builder.objectRef<View>('DraftOrder');
DraftOrder.implement({
  interfaces: [Node],
  fields: (t) => ({
    ...viewFields(t),
    legacyResourceId: t.field({ type: 'UnsignedInt64', resolve: legacyId }),
    name: t.exposeString('name'),
    status: t.field({ type: Status, resolve: (v) => v.status }),
    note2: t.string({ nullable: true, resolve: (v) => v.note }),
    ready: t.boolean({ resolve: (v) => v.status !== 'COMPLETED' && v.lines.length > 0 }),
    invoiceUrl: t.field({ type: 'URL', nullable: true, resolve: (v) => v.invoiceUrl }),
    invoiceSentAt: t.field({ type: 'DateTime', nullable: true, resolve: (v) => v.invoiceSentAt }),
    completedAt: t.field({ type: 'DateTime', nullable: true, resolve: (v) => v.completedAt }),
    createdAt: t.field({ type: 'DateTime', resolve: (v) => v.createdAt }),
    updatedAt: t.field({ type: 'DateTime', resolve: (v) => v.updatedAt }),
    order: t.field({ type: Order_, nullable: true, resolve: (v, _a, ctx) => (v.orderId ? getOrder(ctx.db, ctx.shopId, v.orderId) : null) }),
    lineItems: t.field({ type: LineItemConnection, args: ConnectionArgs, resolve: (v, a) => paginate(a, { fetch: async ({ offset, limit }) => lineViews(v).slice(offset, offset + limit) }) }),
  }),
});
const DraftOrderConnection = defineConnection('DraftOrder', DraftOrder);

const Calculated = builder.objectRef<View>('CalculatedDraftOrder').implement({
  fields: (t) => ({ ...viewFields(t), lineItems: t.field({ type: [CalculatedLineItem], resolve: lineViews }), availableShippingRates: t.stringList({ resolve: () => [] }) }),
});

/* ------------------------------ inputs ------------------------------ */

const AttributeInput = builder.inputType('AttributeInput', { fields: (t) => ({ key: t.string({ required: true }), value: t.string({ required: true }) }) });
const AppliedDiscountInput = builder.inputType('DraftOrderAppliedDiscountInput', {
  fields: (t) => ({ title: t.string(), description: t.string(), value: t.float({ required: true }), valueType: t.field({ type: DiscountType, required: true }) }),
});
const ShippingLineInput = builder.inputType('ShippingLineInput', { fields: (t) => ({ title: t.string(), price: t.field({ type: 'Money' }), shippingRateHandle: t.string() }) });
const LineItemInput = builder.inputType('DraftOrderLineItemInput', {
  fields: (t) => ({
    variantId: t.id(), title: t.string(), originalUnitPrice: t.field({ type: 'Money' }), quantity: t.int({ required: true }), sku: t.string(), taxable: t.boolean(), requiresShipping: t.boolean(),
    grams: t.int(), appliedDiscount: t.field({ type: AppliedDiscountInput }), customAttributes: t.field({ type: [AttributeInput] }), uuid: t.string(),
  }),
});
const PurchasingEntityInput = builder.inputType('PurchasingEntityInput', { fields: (t) => ({ customerId: t.id() }) });
const DraftOrderInput = builder.inputType('DraftOrderInput', {
  fields: (t) => ({
    email: t.string(), phone: t.string(), note: t.string(), tags: t.stringList(), customerId: t.id(), purchasingEntity: t.field({ type: PurchasingEntityInput }), taxExempt: t.boolean(),
    lineItems: t.field({ type: [LineItemInput] }), appliedDiscount: t.field({ type: AppliedDiscountInput }), shippingLine: t.field({ type: ShippingLineInput }),
    shippingAddress: t.field({ type: MailingAddressInput }), billingAddress: t.field({ type: MailingAddressInput }), discountCodes: t.stringList(), customAttributes: t.field({ type: [AttributeInput] }),
    poNumber: t.string(), shopmeMarketId: t.id({ description: 'ShopMe extension: market the draft is sold in (null clears it).' }),
  }),
});
const DeleteInput = builder.inputType('DraftOrderDeleteInput', { fields: (t) => ({ id: t.id({ required: true }) }) });
const EmailInput = builder.inputType('EmailInput', { fields: (t) => ({ to: t.string(), subject: t.string(), customMessage: t.string(), from: t.string(), body: t.string(), bcc: t.stringList() }) });

type Input = typeof DraftOrderInput.$inferInput;
type DiscountIn = NonNullable<Input['appliedDiscount']>;

/* ------------------------------ conversion ------------------------------ */

class BadInput extends Error { constructor(readonly userError: UserError) { super(userError.message); } }
const money = (v: string, currency: string, field: string[]) => {
  try { return parseMoney(v, currency); } catch { throw new BadInput({ field, message: 'Amount is invalid' }); }
};
const discountOf = (d: DiscountIn | null | undefined, currency: string, field: string[]) => (d ? {
  title: d.title ?? null, description: d.description ?? null, valueType: d.valueType, value: d.valueType === 'FIXED_AMOUNT' ? parseMoney(d.value, currency) : d.value,
} : null);
const addr = (a: Input['shippingAddress']) => (a === undefined ? undefined : a === null ? null : Object.fromEntries(Object.entries(a).filter(([, v]) => v != null)) as Record<string, string>);

/** GraphQL input -> service input. Money strings become minor units in the shop currency; ids are parsed. */
function toInput(i: Input, currency: string): DraftInput {
  const customerRaw = i.purchasingEntity?.customerId ?? i.customerId;
  const customerId = customerRaw == null ? undefined : parseId(String(customerRaw), 'Customer');
  if (customerRaw != null && !customerId) throw new BadInput({ field: ['customerId'], message: 'Customer does not exist' });
  return {
    email: i.email, phone: i.phone, note: i.note, tags: i.tags, taxExempt: i.taxExempt, customerId, poNumber: i.poNumber,
    marketId: i.shopmeMarketId === undefined ? undefined : i.shopmeMarketId === null ? null : parseId(String(i.shopmeMarketId), 'Market'),
    appliedDiscount: i.appliedDiscount === undefined ? undefined : discountOf(i.appliedDiscount, currency, ['appliedDiscount']),
    shippingLine: i.shippingLine === undefined ? undefined : i.shippingLine === null ? null : { title: i.shippingLine.title?.trim() || 'Shipping', price: i.shippingLine.price ? money(i.shippingLine.price, currency, ['shippingLine', 'price']) : 0 },
    shippingAddress: addr(i.shippingAddress), billingAddress: addr(i.billingAddress),
    lines: i.lineItems?.map((l, n): DraftLineInput => {
      const variantId = l.variantId ? parseId(String(l.variantId), 'ProductVariant') : null;
      if (l.variantId && !variantId) throw new BadInput({ field: ['lineItems', String(n), 'variantId'], message: 'Product variant does not exist' });
      return {
        variantId, title: l.title, quantity: l.quantity, sku: l.sku, taxable: l.taxable, requiresShipping: l.requiresShipping, grams: l.grams, uuid: l.uuid,
        originalUnitPrice: l.originalUnitPrice != null ? money(l.originalUnitPrice, currency, ['lineItems', String(n), 'originalUnitPrice']) : null,
        discount: discountOf(l.appliedDiscount, currency, ['lineItems', String(n), 'appliedDiscount']),
        properties: l.customAttributes ? Object.fromEntries(l.customAttributes.map((a) => [a.key, a.value])) : undefined,
      };
    }),
  };
}

/* ------------------------------ operations ------------------------------ */

export const staffId = (ctx: GraphQLContext) => (ctx.auth.kind === 'session' ? ctx.auth.user.id : null);
export const shopFor = async (ctx: GraphQLContext) => (await getShop(ctx.db, ctx.shopId))!;
export const asView = async (ctx: GraphQLContext, d: DraftRow) => viewOf(await shopFor(ctx), ctx.app.config.appUrl, d);
const noDraft: UserError[] = [{ field: ['id'], message: 'Draft order does not exist' }];

const Create = definePayload<{ draftOrder: View | null }>('DraftOrderCreatePayload', (t) => ({ draftOrder: t.field({ type: DraftOrder, nullable: true, resolve: (p) => p.draftOrder }) }));
const Update = definePayload<{ draftOrder: View | null }>('DraftOrderUpdatePayload', (t) => ({ draftOrder: t.field({ type: DraftOrder, nullable: true, resolve: (p) => p.draftOrder }) }));
const Complete = definePayload<{ draftOrder: View | null }>('DraftOrderCompletePayload', (t) => ({ draftOrder: t.field({ type: DraftOrder, nullable: true, resolve: (p) => p.draftOrder }) }));
const InvoiceSend = definePayload<{ draftOrder: View | null }>('DraftOrderInvoiceSendPayload', (t) => ({ draftOrder: t.field({ type: DraftOrder, nullable: true, resolve: (p) => p.draftOrder }) }));
const Delete = definePayload<{ deletedId: string | null }>('DraftOrderDeletePayload', (t) => ({ deletedId: t.id({ nullable: true, resolve: (p) => p.deletedId }) }));
const Calculate = definePayload<{ calculatedDraftOrder: View | null }>('DraftOrderCalculatePayload', (t) => ({ calculatedDraftOrder: t.field({ type: Calculated, nullable: true, resolve: (p) => p.calculatedDraftOrder }) }));

registerNode('DraftOrder', async (ctx, id) => { const d = await getDraftOrder(ctx.db, ctx.shopId, id); return d ? asView(ctx, d) : null; });

export const did = (v: string) => parseId(String(v), 'DraftOrder');
/** Run a mutation body, turning malformed input into userErrors. */
async function guard<T extends { userErrors: UserError[] }>(fn: () => Promise<T>, empty: Omit<T, 'userErrors'>): Promise<T> {
  try { return await fn(); } catch (e) { if (e instanceof BadInput) return { ...empty, userErrors: [e.userError] } as T; throw e; }
}

builder.queryFields((t) => ({
  draftOrder: t.field({
    type: DraftOrder, nullable: true, args: { id: t.arg.id({ required: true }) },
    resolve: async (_r, a, ctx) => { requireScope(ctx, 'read_draft_orders'); const id = did(a.id); const d = id ? await getDraftOrder(ctx.db, ctx.shopId, id) : null; return d ? asView(ctx, d) : null; },
  }),
  draftOrders: t.field({
    type: DraftOrderConnection, args: { ...ConnectionArgs, query: t.arg.string() },
    resolve: async (_r, a, ctx) => {
      requireScope(ctx, 'read_draft_orders');
      const shop = await shopFor(ctx);
      return paginate(a, {
        fetch: async ({ offset, limit }) => (await listDraftOrders(ctx.db, ctx.shopId, { query: a.query, reverse: !!a.reverse, offset, limit })).map((d) => viewOf(shop, ctx.app.config.appUrl, d)),
        total: () => countDraftOrders(ctx.db, ctx.shopId, a.query),
      });
    },
  }),
  draftOrdersCount: t.field({
    type: Count, nullable: true, args: { query: t.arg.string() },
    resolve: async (_r, a, ctx) => { requireScope(ctx, 'read_draft_orders'); return { count: await countDraftOrders(ctx.db, ctx.shopId, a.query), precision: 'EXACT' as const }; },
  }),
}));

builder.mutationFields((t) => ({
  draftOrderCreate: t.field({
    type: Create, args: { input: t.arg({ type: DraftOrderInput, required: true }) },
    resolve: (_r, { input }, ctx) => guard(async () => {
      requireScope(ctx, 'write_draft_orders');
      const shop = await shopFor(ctx);
      const r = await createDraftOrder(ctx.db, shop, toInput(input, shop.currency), staffId(ctx));
      return r.ok ? { draftOrder: await asView(ctx, r.value), userErrors: [] } : { draftOrder: null, userErrors: r.errors };
    }, { draftOrder: null }),
  }),
  draftOrderUpdate: t.field({
    type: Update, args: { id: t.arg.id({ required: true }), input: t.arg({ type: DraftOrderInput, required: true }) },
    resolve: (_r, { id: rawId, input }, ctx) => guard(async () => {
      requireScope(ctx, 'write_draft_orders');
      const id = did(rawId);
      if (!id) return { draftOrder: null, userErrors: noDraft };
      const shop = await shopFor(ctx);
      const r = await updateDraftOrder(ctx.db, shop, id, toInput(input, shop.currency), staffId(ctx));
      return r.ok ? { draftOrder: await asView(ctx, r.value), userErrors: [] } : { draftOrder: null, userErrors: r.errors };
    }, { draftOrder: null }),
  }),
  draftOrderDelete: t.field({
    type: Delete, args: { input: t.arg({ type: DeleteInput, required: true }) },
    resolve: async (_r, { input }, ctx) => {
      requireScope(ctx, 'write_draft_orders');
      const id = did(input.id);
      const r = id ? await deleteDraftOrder(ctx.db, ctx.shopId, id, staffId(ctx)) : null;
      return r?.ok ? { deletedId: toGid('DraftOrder', id!), userErrors: [] } : { deletedId: null, userErrors: r && !r.ok ? r.errors : noDraft };
    },
  }),
  draftOrderCalculate: t.field({
    type: Calculate, args: { input: t.arg({ type: DraftOrderInput, required: true }) },
    resolve: (_r, { input }, ctx) => guard(async () => {
      requireScope(ctx, 'read_draft_orders');
      const shop = await shopFor(ctx);
      const r = await calculateDraftOrder(ctx.db, shop, toInput(input, shop.currency));
      if (!r.ok) return { calculatedDraftOrder: null, userErrors: r.errors };
      return { calculatedDraftOrder: calcViewOf(shop, r.value.draft as never, r.value.pricing, r.value.calc), userErrors: [] };
    }, { calculatedDraftOrder: null }),
  }),
  draftOrderComplete: t.field({
    type: Complete, args: { id: t.arg.id({ required: true }), paymentPending: t.arg.boolean({ defaultValue: false }), sourceName: t.arg.string() },
    resolve: async (_r, a, ctx) => {
      requireScope(ctx, 'write_draft_orders');
      const id = did(a.id);
      if (!id) return { draftOrder: null, userErrors: noDraft };
      const r = await completeDraftOrder(ctx.db, await shopFor(ctx), id, { paymentPending: !!a.paymentPending, sourceName: a.sourceName ?? undefined, staffId: staffId(ctx) });
      return r.ok ? { draftOrder: await asView(ctx, r.value.draft), userErrors: [] } : { draftOrder: null, userErrors: r.errors };
    },
  }),
  draftOrderInvoiceSend: t.field({
    type: InvoiceSend, args: { id: t.arg.id({ required: true }), email: t.arg({ type: EmailInput }) },
    resolve: async (_r, a, ctx) => {
      requireScope(ctx, 'write_draft_orders');
      const id = did(a.id);
      if (!id) return { draftOrder: null, userErrors: noDraft };
      const r = await sendDraftInvoice(ctx.db, ctx.app.mailer, await shopFor(ctx), ctx.app.config.appUrl, id, { to: a.email?.to, subject: a.email?.subject, customMessage: a.email?.customMessage, staffId: staffId(ctx) });
      return r.ok ? { draftOrder: await asView(ctx, r.value), userErrors: [] } : { draftOrder: null, userErrors: r.errors };
    },
  }),
}));
