import { carrierProvider, estimateLabelRates, getOrder, getShop, labelAccounts, labelItemsWeight, labelRates, purchaseLabel, type LabelRateQuote, type ShippingLabel } from '@shopme/core';
import { formatDecimal, parseId, type UserError } from '@shopme/shopify-compat';
import { builder } from '../builder';
import { requireScope, type GraphQLContext } from '../context';
import { definePayload, UserError as UserErrorRef } from '../types/errors';
import { ShippingLabelRef } from './orders-ops';

/**
 * Buying postage from the carrier accounts of Settings > Shipping that sell labels: the accounts, the label rates for an order's parcel and
 * the purchase (tracking on the fulfillment, cost and document on the label). Voiding goes through `shopmeShippingLabelVoid`.
 */

const staffId = (ctx: GraphQLContext) => (ctx.auth.kind === 'session' ? ctx.auth.user.id : null);
const fail = (field: string[] | null, message: string, code?: string): UserError[] => [{ field, message, ...(code ? { code } : {}) }];
const ids = (orderId: string, fulfillmentId?: string | null) => ({ order: parseId(orderId, 'Order'), fulfillment: fulfillmentId ? parseId(fulfillmentId, 'Fulfillment') : null });

const LabelCarrier = builder.objectRef<{ id: string; name: string; provider: string; test: boolean }>('ShopmeLabelCarrier').implement({
  description: 'A carrier account that can sell shipping labels.',
  fields: (t) => ({ id: t.exposeString('id'), name: t.exposeString('name'), provider: t.exposeString('provider'), test: t.exposeBoolean('test') }),
});
const LabelRate = builder.objectRef<LabelRateQuote>('ShopmeShippingLabelRate').implement({
  fields: (t) => ({
    accountId: t.exposeString('accountId'), accountName: t.exposeString('accountName'), test: t.exposeBoolean('test'),
    rateId: t.string({ description: 'The carrier\'s id of the offer, sent back to buy it.', resolve: (r) => r.rate.id }),
    service: t.string({ resolve: (r) => r.rate.service }), name: t.string({ resolve: (r) => r.rate.name }),
    price: t.field({ type: 'Money', resolve: (r) => formatDecimal(r.rate.price, r.rate.currency) }), currencyCode: t.string({ resolve: (r) => r.rate.currency }),
    estimatedDays: t.int({ nullable: true, resolve: (r) => r.rate.estimatedDays }),
  }),
});
const CarrierProblem = builder.objectRef<{ accountId: string; accountName: string; message: string }>('ShopmeLabelCarrierError').implement({
  fields: (t) => ({ accountId: t.exposeString('accountId'), accountName: t.exposeString('accountName'), message: t.exposeString('message') }),
});
type RatesShape = { rates: LabelRateQuote[]; carrierErrors: Array<{ accountId: string; accountName: string; message: string }>; userErrors: UserError[] };
const RatesResult = builder.objectRef<RatesShape>('ShopmeShippingLabelRates').implement({
  fields: (t) => ({
    rates: t.field({ type: [LabelRate], description: 'Offers of every carrier account that sells labels, cheapest first.', resolve: (r) => r.rates }),
    carrierErrors: t.field({ type: [CarrierProblem], description: 'Carriers that could not quote (the others still do).', resolve: (r) => r.carrierErrors }),
    userErrors: t.field({ type: [UserErrorRef], resolve: (r) => r.userErrors }),
  }),
});
const Parcel = builder.inputType('ShopmeLabelParcelInput', {
  description: 'The package: a package of Settings > Shipping (else the default one) and the total weight in grams, packaging included.',
  fields: (t) => ({ packageId: t.id(), weightGrams: t.int({ required: true }) }),
});
const RatesInput = builder.inputType('ShopmeShippingLabelRatesInput', {
  fields: (t) => ({ orderId: t.id({ required: true }), fulfillmentId: t.id({ description: 'Label for an existing fulfillment instead of the items still to ship.' }), parcel: t.field({ type: Parcel, required: true }) }),
});
const EstimateInput = builder.inputType('ShopmeShippingLabelEstimateInput', {
  fields: (t) => ({ countryCode: t.string({ required: true }), zip: t.string(), parcel: t.field({ type: Parcel, required: true }) }),
});
const PurchaseInput = builder.inputType('ShopmeShippingLabelPurchaseInput', {
  fields: (t) => ({
    orderId: t.id({ required: true }), fulfillmentId: t.id(), parcel: t.field({ type: Parcel, required: true }),
    accountId: t.string({ required: true }), rateId: t.string({ required: true }), notifyCustomer: t.boolean(),
  }),
});
const packageOf = (v: string | null | undefined) => (v ? parseId(v, 'ShopmeShippingPackage') ?? parseId(v, 'ShippingPackage') ?? (/^\d+$/.test(v) ? Number(v) : -1) : null);

builder.queryFields((t) => ({
  shopmeLabelCarriers: t.field({
    type: [LabelCarrier], description: 'Carrier accounts of Settings > Shipping that can sell shipping labels.',
    resolve: async (_r, _a, ctx) => {
      requireScope(ctx, 'read_shipping');
      const shop = await getShop(ctx.db, ctx.shopId);
      return shop ? labelAccounts(shop).map((a) => ({ id: a.id, name: a.name, provider: a.provider, test: !!carrierProvider(a.provider)?.test })) : [];
    },
  }),
  shopmeShippingLabelRates: t.field({
    type: RatesResult, args: { input: t.arg({ type: RatesInput, required: true }) },
    description: 'Label rates for an order\'s parcel from every carrier account that sells labels.',
    resolve: async (_r, { input }, ctx): Promise<RatesShape> => {
      requireScope(ctx, 'write_fulfillments');
      const id = ids(String(input.orderId), input.fulfillmentId ? String(input.fulfillmentId) : null);
      if (!id.order || !(await getOrder(ctx.db, ctx.shopId, id.order))) return { rates: [], carrierErrors: [], userErrors: fail(['input', 'orderId'], 'Order does not exist', 'NOT_FOUND') };
      const r = await labelRates(ctx.db, ctx.shopId, { orderId: id.order, fulfillmentId: id.fulfillment, parcel: { packageId: packageOf(input.parcel.packageId ? String(input.parcel.packageId) : null), weightGrams: input.parcel.weightGrams } });
      return r.ok ? { rates: r.value.rates, carrierErrors: r.value.errors, userErrors: [] } : { rates: [], carrierErrors: [], userErrors: r.errors.map((e) => ({ ...e, field: ['input', ...(e.field ?? [])] })) };
    },
  }),
  shopmeShippingLabelItemsWeight: t.int({
    args: { orderId: t.arg.id({ required: true }), fulfillmentId: t.arg.id() },
    description: 'Weight in grams of the items a label would cover (the items still to ship, or a fulfillment\'s), without packaging.',
    resolve: async (_r, a, ctx) => {
      requireScope(ctx, 'read_orders');
      const id = ids(String(a.orderId), a.fulfillmentId ? String(a.fulfillmentId) : null);
      return id.order ? labelItemsWeight(ctx.db, ctx.shopId, id.order, id.fulfillment) : 0;
    },
  }),
  shopmeShippingLabelEstimate: t.field({
    type: RatesResult, args: { input: t.arg({ type: EstimateInput, required: true }) },
    description: 'Label rates for a parcel to a destination country, without an order (Settings > Shipping, "Calculate rates").',
    resolve: async (_r, { input }, ctx): Promise<RatesShape> => {
      requireScope(ctx, 'read_shipping');
      const r = await estimateLabelRates(ctx.db, ctx.shopId, { countryCode: input.countryCode, zip: input.zip, parcel: { packageId: packageOf(input.parcel.packageId ? String(input.parcel.packageId) : null), weightGrams: input.parcel.weightGrams } });
      return r.ok ? { rates: r.value.rates, carrierErrors: r.value.errors, userErrors: [] } : { rates: [], carrierErrors: [], userErrors: r.errors.map((e) => ({ ...e, field: ['input', ...(e.field ?? [])] })) };
    },
  }),
}));

builder.mutationFields((t) => ({
  shopmeShippingLabelPurchase: t.field({
    type: definePayload<{ label: (ShippingLabel & { orderName: string }) | null }>('ShopmeShippingLabelPurchasePayload', (u) => ({ label: u.field({ type: ShippingLabelRef, nullable: true, resolve: (p) => p.label }) })),
    args: { input: t.arg({ type: PurchaseInput, required: true }) },
    description: 'Buys a shipping label from a carrier account at the chosen rate. Its tracking goes on the fulfillment (a new one for the items still to ship, or `fulfillmentId`) and its cost and document are stored on the label.',
    resolve: async (_r, { input }, ctx) => {
      requireScope(ctx, 'write_fulfillments');
      const id = ids(String(input.orderId), input.fulfillmentId ? String(input.fulfillmentId) : null);
      const order = id.order ? await getOrder(ctx.db, ctx.shopId, id.order) : null;
      if (!id.order || !order) return { label: null, userErrors: fail(['input', 'orderId'], 'Order does not exist', 'NOT_FOUND') };
      if (input.fulfillmentId && !id.fulfillment) return { label: null, userErrors: fail(['input', 'fulfillmentId'], 'Fulfillment does not exist', 'NOT_FOUND') };
      const r = await purchaseLabel(ctx.db, ctx.shopId, {
        orderId: id.order, fulfillmentId: id.fulfillment, parcel: { packageId: packageOf(input.parcel.packageId ? String(input.parcel.packageId) : null), weightGrams: input.parcel.weightGrams },
        accountId: input.accountId, rateId: input.rateId, notifyCustomer: input.notifyCustomer ?? false, staffId: staffId(ctx),
      });
      return r.ok ? { label: { ...r.value, orderName: order.name }, userErrors: [] } : { label: null, userErrors: r.errors.map((e) => ({ ...e, field: ['input', ...(e.field ?? [])] })) };
    },
  }),
}));
