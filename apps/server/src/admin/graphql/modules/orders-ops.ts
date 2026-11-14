import {
  MARK_AS, activeLocations, attributionReport, campaignResults, captureOrderPayments, countShippingLabels, createBatch, createShippingLabel, deleteBatch, deleteCampaign, deliveryStatusOf, getBatch, getOrder,
  listBatches, listShippingLabels, markOrderAs, moveToBatch, orderAddressProblems, orderConversion, orderRisk, ordersAwaitingLabel, ordersStats, renameBatch, saveCampaign, salesChannels, schema, setStorefrontPublication,
  isTestTracking, voidLabel, CAMPAIGN_CHANNELS, type MarketingCampaign, type MarkAs, type OrderBatch, type ShippingLabel,
} from '@shopme/core';
import { eq } from 'drizzle-orm';
import { formatDecimal, parseId, parseMoney, toGid, type UserError } from '@shopme/shopify-compat';
import { gatewaysFor } from '../../../payments-gateways';
import { builder } from '../builder';
import { requireScope, type GraphQLContext } from '../context';
import { definePayload } from '../types/errors';
import { Count } from '../types/money';
import { Order_ } from '../types/sales';
import { detailOf } from './orders';

/**
 * ShopMe extensions for the orders area: address checks, a simple risk read, the conversion summary, delivery columns, batches, bulk "mark as" and
 * capture, shipping labels, the orders stats strip, marketing campaigns with attribution and the sales channels list.
 */

const staffId = (ctx: GraphQLContext) => (ctx.auth.kind === 'session' ? ctx.auth.user.id : null);
const labelCurrency = async (ctx: GraphQLContext, l: ShippingLabel) => {
  if (l.currency) return l.currency;
  const [o] = await ctx.db.select({ c: schema.orders.currency }).from(schema.orders).where(eq(schema.orders.id, l.orderId));
  return o?.c ?? 'USD';
};
/** A stored label document is served by `GET /admin/api/shipping-labels/:id/label` (see label-routes.ts). */
const labelUrlOf = (l: ShippingLabel & { hasDocument?: boolean }) => (l.source !== 'PURCHASED' ? null : l.labelUrl && !l.hasDocument ? l.labelUrl : `/admin/api/shipping-labels/${l.id}/label`);
const fail = (field: string[] | null, message: string, code?: string): UserError[] => [{ field, message, ...(code ? { code } : {}) }];
const oid = (v: string | number) => parseId(String(v), 'Order');

/* ------------------------------ order fields ------------------------------ */

const RiskSignal = builder.objectRef<{ code: string; weight: number; detail?: string }>('ShopmeOrderRiskSignal').implement({
  fields: (t) => ({ code: t.exposeString('code'), weight: t.exposeInt('weight'), detail: t.string({ nullable: true, resolve: (s) => s.detail ?? null }) }),
});
const Risk = builder.objectRef<{ level: string; score: number; signals: Array<{ code: string; weight: number; detail?: string }> }>('ShopmeOrderRisk').implement({
  description: 'A simple risk read computed from the shop\'s own data (no third-party fraud service).',
  fields: (t) => ({ level: t.exposeString('level'), score: t.exposeInt('score'), signals: t.field({ type: [RiskSignal], resolve: (r) => r.signals }) }),
});
const Conversion = builder.objectRef<{ visits: number; firstVisitAt: Date; landingPath: string; referrer: string | null; utmSource: string | null; utmMedium: string | null; utmCampaign: string | null; lastVisitPath: string }>('ShopmeOrderConversion').implement({
  description: 'What the storefront saw of the buyer before the order: first page, referrer, campaign tags.',
  fields: (t) => ({
    visits: t.exposeInt('visits'), firstVisitAt: t.field({ type: 'DateTime', resolve: (c) => c.firstVisitAt }), landingPath: t.exposeString('landingPath'), lastVisitPath: t.exposeString('lastVisitPath'),
    referrer: t.exposeString('referrer', { nullable: true }), utmSource: t.exposeString('utmSource', { nullable: true }), utmMedium: t.exposeString('utmMedium', { nullable: true }), utmCampaign: t.exposeString('utmCampaign', { nullable: true }),
  }),
});
const BatchRef = builder.objectRef<{ id: number; name: string }>('ShopmeOrderBatchRef').implement({ fields: (t) => ({ id: t.id({ resolve: (b) => toGid('ShopmeOrderBatch', b.id) }), name: t.exposeString('name') }) });
const LocationRef = builder.objectRef<{ id: number; name: string }>('ShopmeOrderLocation').implement({ fields: (t) => ({ id: t.id({ resolve: (b) => toGid('Location', b.id) }), name: t.exposeString('name') }) });

builder.objectFields(Order_, (t) => ({
  shopmeAddressProblems: t.stringList({ description: 'Problems found in the shipping address (empty when it looks deliverable).', resolve: async (o, _a, ctx) => orderAddressProblems(await detailOf(ctx, o)) }),
  shopmeRisk: t.field({ type: Risk, resolve: async (o, _a, ctx) => orderRisk(ctx.db, ctx.shopId, o, await detailOf(ctx, o)) }),
  shopmeConversion: t.field({ type: Conversion, nullable: true, resolve: (o, _a, ctx) => orderConversion(ctx.db, ctx.shopId, o) }),
  shopmeDeliveryStatus: t.string({ description: 'NOT_FULFILLED, IN_TRANSIT or DELIVERED.', resolve: async (o, _a, ctx) => deliveryStatusOf(await detailOf(ctx, o)) }),
  shopmeDeliveryMethod: t.string({ nullable: true, resolve: async (o, _a, ctx) => (await detailOf(ctx, o)).shippingLines[0]?.title ?? null }),
  shopmeFulfillBy: t.field({ type: 'DateTime', nullable: true, resolve: (o) => o.fulfillBy }),
  shopmeBatch: t.field({ type: BatchRef, nullable: true, resolve: async (o, _a, ctx) => (o.batchId ? getBatch(ctx.db, ctx.shopId, o.batchId) : null) }),
  shopmeLocation: t.field({
    type: LocationRef, nullable: true, description: 'Where the order ships from: the location of its latest fulfillment, else the default location.',
    resolve: async (o, _a, ctx) => {
      const live = (await detailOf(ctx, o)).fulfillments.filter((f) => f.status !== 'CANCELLED' && f.locationId);
      const locs = await activeLocations(ctx.db, ctx.shopId);
      const id = live.at(-1)?.locationId ?? locs[0]?.id ?? null;
      const l = id ? (await activeLocations(ctx.db, ctx.shopId)).find((x) => x.id === id) ?? null : null;
      return l ? { id: l.id, name: l.name } : null;
    },
  }),
}));

/* ------------------------------ stats strip ------------------------------ */

const StatsMetric = builder.objectRef<{ key: string; value: number; previous: number; series: number[] }>('ShopmeOrdersStatsMetric').implement({
  fields: (t) => ({ key: t.exposeString('key'), value: t.exposeFloat('value'), previous: t.exposeFloat('previous'), series: t.field({ type: ['Float'], resolve: (m) => m.series }) }),
});
const Stats = builder.objectRef<{ from: Date; to: Date; currency: string; buckets: Date[]; metrics: Array<{ key: string; value: number; previous: number; series: number[] }> }>('ShopmeOrdersStats').implement({
  description: 'Figures above the orders list. Money values are in minor units of `currencyCode`; fulfillmentHours is in hours.',
  fields: (t) => ({ currencyCode: t.exposeString('currency'), buckets: t.field({ type: ['DateTime'], resolve: (s) => s.buckets }), metrics: t.field({ type: [StatsMetric], resolve: (s) => s.metrics }) }),
});

builder.queryFields((t) => ({
  shopmeOrdersStats: t.field({
    type: Stats, args: { from: t.arg({ type: 'DateTime', required: true }), to: t.arg({ type: 'DateTime', required: true }), locationId: t.arg.id() },
    resolve: async (_r, a, ctx) => {
      requireScope(ctx, 'read_orders');
      const [shop] = await ctx.db.select({ currency: schema.shops.currency }).from(schema.shops).where(eq(schema.shops.id, ctx.shopId));
      const from = new Date(a.from), to = new Date(a.to);
      if (!(to > from)) throw new Error('`to` must be after `from`');
      return ordersStats(ctx.db, ctx.shopId, { from, to, locationId: a.locationId ? parseId(String(a.locationId), 'Location') : null }, shop?.currency ?? 'USD');
    },
  }),
}));

/* ------------------------------ bulk mark as / capture ------------------------------ */

const MarkAsStatus = builder.enumType('ShopmeOrderMarkAs', { values: MARK_AS });
const BulkResult = builder.objectRef<{ orderId: string; ok: boolean; message: string | null }>('ShopmeBulkOrderResult').implement({
  fields: (t) => ({ orderId: t.exposeID('orderId'), ok: t.exposeBoolean('ok'), message: t.exposeString('message', { nullable: true }) }),
});
const BulkPayload = (name: string) => definePayload<{ results: Array<{ orderId: string; ok: boolean; message: string | null }>; succeeded: number }>(name, (t) => ({
  results: t.field({ type: [BulkResult], resolve: (p) => p.results }), succeeded: t.exposeInt('succeeded'),
}));

async function eachOrder(ctx: GraphQLContext, ids: Array<string | number>, run: (id: number) => Promise<{ ok: true } | { ok: false; errors: UserError[] }>) {
  const results: Array<{ orderId: string; ok: boolean; message: string | null }> = [];
  for (const raw of ids.slice(0, 250)) {
    const id = oid(raw);
    if (!id) { results.push({ orderId: String(raw), ok: false, message: 'Order does not exist' }); continue; }
    const r = await run(id);
    results.push({ orderId: toGid('Order', id), ok: r.ok, message: r.ok ? null : r.errors.map((e) => e.message).join('; ') });
  }
  return { results, succeeded: results.filter((r) => r.ok).length, userErrors: [] as UserError[] };
}

builder.mutationFields((t) => ({
  shopmeOrdersMarkAs: t.field({
    type: BulkPayload('ShopmeOrdersMarkAsPayload'), args: { ids: t.arg.idList({ required: true }), status: t.arg({ type: MarkAsStatus, required: true }) },
    description: 'Sets the fulfillment state of several orders (the bulk "Mark as" menu). Each order succeeds or fails on its own.',
    resolve: (_r, a, ctx) => { requireScope(ctx, 'write_orders'); return eachOrder(ctx, a.ids, (id) => markOrderAs(ctx.db, ctx.shopId, id, a.status as MarkAs, staffId(ctx))); },
  }),
  shopmeOrdersCapture: t.field({
    type: BulkPayload('ShopmeOrdersCapturePayload'), args: { ids: t.arg.idList({ required: true }) },
    description: 'Captures the authorised payments of several orders.',
    resolve: async (_r, a, ctx) => { requireScope(ctx, 'write_orders'); const gateways = await gatewaysFor(ctx.request.server, ctx.shopId); return eachOrder(ctx, a.ids, (id) => captureOrderPayments(ctx.db, ctx.shopId, id, staffId(ctx), gateways)); },
  }),
}));

/* ------------------------------ batches ------------------------------ */

const Batch = builder.objectRef<OrderBatch & { orderCount: number }>('ShopmeOrderBatch').implement({
  fields: (t) => ({
    id: t.id({ resolve: (b) => toGid('ShopmeOrderBatch', b.id) }), name: t.exposeString('name'), orderCount: t.exposeInt('orderCount'),
    createdAt: t.field({ type: 'DateTime', resolve: (b) => b.createdAt }),
  }),
});
const bid = (v: string | number) => parseId(String(v), 'ShopmeOrderBatch');
const orderIdsOf = (ids: Array<string | number>) => ids.map(oid).filter((x): x is number => x != null);

builder.queryFields((t) => ({
  shopmeOrderBatches: t.field({ type: [Batch], resolve: (_r, _a, ctx) => { requireScope(ctx, 'read_orders'); return listBatches(ctx.db, ctx.shopId); } }),
}));
builder.mutationFields((t) => ({
  shopmeOrderBatchCreate: t.field({
    type: definePayload<{ batch: (OrderBatch & { orderCount: number }) | null }>('ShopmeOrderBatchCreatePayload', (u) => ({ batch: u.field({ type: Batch, nullable: true, resolve: (p) => p.batch }) })),
    args: { name: t.arg.string(), orderIds: t.arg.idList({ required: true }) }, description: 'Creates a batch holding the given orders.',
    resolve: async (_r, a, ctx) => {
      requireScope(ctx, 'write_orders');
      const r = await createBatch(ctx.db, ctx.shopId, { name: a.name, orderIds: orderIdsOf(a.orderIds), staffId: staffId(ctx) });
      return r.ok ? { batch: r.value, userErrors: [] } : { batch: null, userErrors: r.errors };
    },
  }),
  shopmeOrdersMoveToBatch: t.field({
    type: definePayload<{ moved: number }>('ShopmeOrdersMoveToBatchPayload', (u) => ({ moved: u.exposeInt('moved') })),
    args: { batchId: t.arg.id({ description: 'Null removes the orders from their batch.' }), orderIds: t.arg.idList({ required: true }) },
    resolve: async (_r, a, ctx) => {
      requireScope(ctx, 'write_orders');
      const batchId = a.batchId ? bid(a.batchId) : null;
      if (a.batchId && !batchId) return { moved: 0, userErrors: fail(['batchId'], 'Batch does not exist', 'NOT_FOUND') };
      const r = await moveToBatch(ctx.db, ctx.shopId, { batchId, orderIds: orderIdsOf(a.orderIds), staffId: staffId(ctx) });
      return r.ok ? { moved: r.value.moved, userErrors: [] } : { moved: 0, userErrors: r.errors };
    },
  }),
  shopmeOrderBatchRename: t.field({
    type: definePayload<{ batch: OrderBatch | null }>('ShopmeOrderBatchRenamePayload', (u) => ({ batch: u.field({ type: BatchRef, nullable: true, resolve: (p) => p.batch }) })),
    args: { id: t.arg.id({ required: true }), name: t.arg.string({ required: true }) },
    resolve: async (_r, a, ctx) => { requireScope(ctx, 'write_orders'); const id = bid(a.id); const r = id ? await renameBatch(ctx.db, ctx.shopId, id, a.name) : null; return r?.ok ? { batch: r.value, userErrors: [] } : { batch: null, userErrors: r ? r.errors : fail(['id'], 'Batch does not exist', 'NOT_FOUND') }; },
  }),
  shopmeOrderBatchDelete: t.field({
    type: definePayload<{ deletedId: string | null }>('ShopmeOrderBatchDeletePayload', (u) => ({ deletedId: u.id({ nullable: true, resolve: (p) => p.deletedId }) })),
    args: { id: t.arg.id({ required: true }) },
    resolve: async (_r, a, ctx) => { requireScope(ctx, 'write_orders'); const id = bid(a.id); const r = id ? await deleteBatch(ctx.db, ctx.shopId, id) : null; return r?.ok ? { deletedId: toGid('ShopmeOrderBatch', r.value.id), userErrors: [] } : { deletedId: null, userErrors: r ? r.errors : fail(['id'], 'Batch does not exist', 'NOT_FOUND') }; },
  }),
}));

/* ------------------------------ shipping labels ------------------------------ */

const Label = builder.objectRef<ShippingLabel & { orderName: string }>('ShopmeShippingLabel').implement({
  fields: (t) => ({
    id: t.id({ resolve: (l) => toGid('ShopmeShippingLabel', l.id) }), orderId: t.id({ resolve: (l) => toGid('Order', l.orderId) }), orderName: t.exposeString('orderName'),
    carrier: t.exposeString('carrier'), service: t.exposeString('service', { nullable: true }), trackingNumber: t.exposeString('trackingNumber', { nullable: true }), trackingUrl: t.exposeString('trackingUrl', { nullable: true }),
    cost: t.field({ type: 'Money', resolve: async (l, _a, ctx) => formatDecimal(l.cost, await labelCurrency(ctx, l)) }),
    currencyCode: t.string({ description: 'Currency of `cost`: the carrier\'s for a bought label, else the order\'s.', resolve: (l, _a, ctx) => labelCurrency(ctx, l) }),
    status: t.exposeString('status'), createdAt: t.field({ type: 'DateTime', resolve: (l) => l.createdAt }),
    source: t.string({ description: 'MANUAL (recorded by hand) or PURCHASED (bought from a carrier account).', resolve: (l) => l.source }),
    fulfillmentId: t.id({ nullable: true, resolve: (l) => (l.fulfillmentId ? toGid('Fulfillment', l.fulfillmentId) : null) }),
    weightGrams: t.int({ nullable: true, resolve: (l) => l.weightGrams }),
    labelUrl: t.string({ nullable: true, description: 'Where to print a bought label: the stored document (staff only) or the carrier\'s link.', resolve: (l) => labelUrlOf(l) }),
    labelFormat: t.string({ nullable: true, resolve: (l) => l.labelFormat }),
    refundStatus: t.string({ nullable: true, description: 'For a voided bought label: REFUNDED or NOT_REFUNDED.', resolve: (l) => l.refundStatus }),
    test: t.boolean({ description: 'Bought from the test carrier: the label is a sample and its tracking number is fake.', resolve: (l) => l.source === 'PURCHASED' && isTestTracking(l.trackingNumber) }),
  }),
});
export { Label as ShippingLabelRef };
const LabelInput = builder.inputType('ShopmeShippingLabelInput', {
  fields: (t) => ({
    orderId: t.id({ required: true }), carrier: t.string({ required: true }), service: t.string(), trackingNumber: t.string(), trackingUrl: t.string(), cost: t.field({ type: 'Money' }), weightGrams: t.int(), notifyCustomer: t.boolean(),
  }),
});
builder.queryFields((t) => ({
  shopmeShippingLabels: t.field({
    type: [Label], args: { status: t.arg.string(), first: t.arg.int({ defaultValue: 50 }), orderId: t.arg.id() },
    resolve: (_r, a, ctx) => {
      requireScope(ctx, 'read_orders');
      return listShippingLabels(ctx.db, ctx.shopId, { status: a.status === 'ACTIVE' || a.status === 'VOIDED' ? a.status : null, orderId: a.orderId ? oid(a.orderId) : null, limit: Math.min(200, Math.max(1, a.first ?? 50)), offset: 0 });
    },
  }),
  shopmeShippingLabelsCount: t.field({ type: Count, args: { status: t.arg.string() }, resolve: async (_r, a, ctx) => { requireScope(ctx, 'read_orders'); return { count: await countShippingLabels(ctx.db, ctx.shopId, a.status === 'ACTIVE' || a.status === 'VOIDED' ? a.status : null), precision: 'EXACT' as const }; } }),
  shopmeOrdersAwaitingLabel: t.field({ type: [Order_], description: 'Open orders with something to ship and no label yet.', resolve: (_r, _a, ctx) => { requireScope(ctx, 'read_orders'); return ordersAwaitingLabel(ctx.db, ctx.shopId); } }),
}));
builder.mutationFields((t) => ({
  shopmeShippingLabelCreate: t.field({
    type: definePayload<{ label: (ShippingLabel & { orderName: string }) | null }>('ShopmeShippingLabelCreatePayload', (u) => ({ label: u.field({ type: Label, nullable: true, resolve: (p) => p.label }) })),
    args: { input: t.arg({ type: LabelInput, required: true }) },
    description: 'Records a shipping label bought elsewhere (carrier, service, tracking) for an order and fulfills its remaining items with that tracking. To buy postage from a carrier account, use `shopmeShippingLabelPurchase`.',
    resolve: async (_r, { input }, ctx) => {
      requireScope(ctx, 'write_fulfillments');
      const orderId = oid(input.orderId);
      const order = orderId ? await getOrder(ctx.db, ctx.shopId, orderId) : null;
      if (!orderId || !order) return { label: null, userErrors: fail(['input', 'orderId'], 'Order does not exist', 'NOT_FOUND') };
      let cost = 0;
      try { cost = input.cost ? parseMoney(input.cost, order.currency) : 0; } catch { return { label: null, userErrors: fail(['input', 'cost'], 'Cost is invalid', 'INVALID') }; }
      const r = await createShippingLabel(ctx.db, ctx.shopId, { orderId, carrier: input.carrier, service: input.service, trackingNumber: input.trackingNumber, trackingUrl: input.trackingUrl, cost, weightGrams: input.weightGrams, notifyCustomer: input.notifyCustomer ?? false, staffId: staffId(ctx) });
      return r.ok ? { label: { ...r.value, orderName: order.name }, userErrors: [] } : { label: null, userErrors: r.errors };
    },
  }),
  shopmeShippingLabelVoid: t.field({
    type: definePayload<{ label: (ShippingLabel & { orderName: string }) | null }>('ShopmeShippingLabelVoidPayload', (u) => ({ label: u.field({ type: Label, nullable: true, resolve: (p) => p.label }) })),
    args: { id: t.arg.id({ required: true }) },
    description: 'Voids a label. A label bought from a carrier account is voided at the carrier first (which refunds the postage when it can), then its fulfillment is cancelled so the items can be shipped again.',
    resolve: async (_r, a, ctx) => {
      requireScope(ctx, 'write_fulfillments');
      const id = parseId(String(a.id), 'ShopmeShippingLabel');
      const r = id ? await voidLabel(ctx.db, ctx.shopId, id, staffId(ctx)) : null;
      if (!r?.ok) return { label: null, userErrors: r ? r.errors : fail(['id'], 'Label does not exist', 'NOT_FOUND') };
      const o = await getOrder(ctx.db, ctx.shopId, r.value.orderId);
      return { label: { ...r.value, orderName: o?.name ?? '' }, userErrors: [] };
    },
  }),
}));

/* ------------------------------ marketing ------------------------------ */

type Campaign = MarketingCampaign & { orders: number; sales: number };
const CampaignRef = builder.objectRef<Campaign>('ShopmeMarketingCampaign').implement({
  fields: (t) => ({
    id: t.id({ resolve: (c) => toGid('ShopmeMarketingCampaign', c.id) }), name: t.exposeString('name'), channel: t.exposeString('channel'), status: t.exposeString('status'),
    utmSource: t.exposeString('utmSource', { nullable: true }), utmMedium: t.exposeString('utmMedium', { nullable: true }), utmCampaign: t.exposeString('utmCampaign', { nullable: true }),
    budget: t.field({ type: 'Money', resolve: async (c, _a, ctx) => formatDecimal(c.budget, await shopCurrency(ctx)) }),
    startsAt: t.field({ type: 'DateTime', nullable: true, resolve: (c) => c.startsAt }), endsAt: t.field({ type: 'DateTime', nullable: true, resolve: (c) => c.endsAt }), notes: t.exposeString('notes', { nullable: true }),
    orders: t.exposeInt('orders'), sales: t.field({ type: 'Money', resolve: async (c, _a, ctx) => formatDecimal(c.sales, await shopCurrency(ctx)) }),
    createdAt: t.field({ type: 'DateTime', resolve: (c) => c.createdAt }),
  }),
});
const shopCurrency = async (ctx: GraphQLContext) => (await ctx.db.select({ c: schema.shops.currency }).from(schema.shops).where(eq(schema.shops.id, ctx.shopId)))[0]?.c ?? 'USD';
const AttributionRow = builder.objectRef<{ source: string; medium: string; campaign: string; orders: number; sales: number; visits: number }>('ShopmeAttributionRow').implement({
  fields: (t) => ({
    source: t.exposeString('source'), medium: t.exposeString('medium'), campaign: t.exposeString('campaign'), orders: t.exposeInt('orders'), visits: t.exposeInt('visits'),
    sales: t.field({ type: 'Money', resolve: async (r, _a, ctx) => formatDecimal(r.sales, await shopCurrency(ctx)) }),
  }),
});
const Attribution = builder.objectRef<{ rows: Array<{ source: string; medium: string; campaign: string; orders: number; sales: number; visits: number }>; totalOrders: number; attributedOrders: number; totalSales: number }>('ShopmeAttribution').implement({
  fields: (t) => ({
    rows: t.field({ type: [AttributionRow], resolve: (a) => a.rows }), totalOrders: t.exposeInt('totalOrders'), attributedOrders: t.exposeInt('attributedOrders'),
    totalSales: t.field({ type: 'Money', resolve: async (a, _x, ctx) => formatDecimal(a.totalSales, await shopCurrency(ctx)) }),
  }),
});
const CampaignInput = builder.inputType('ShopmeMarketingCampaignInput', {
  fields: (t) => ({
    name: t.string(), channel: t.string({ description: CAMPAIGN_CHANNELS.join(', ') }), utmSource: t.string(), utmMedium: t.string(), utmCampaign: t.string(), budget: t.field({ type: 'Money' }), status: t.string(),
    startsAt: t.field({ type: 'DateTime' }), endsAt: t.field({ type: 'DateTime' }), notes: t.string(),
  }),
});
type CampaignIn = typeof CampaignInput.$inferInput;
async function campaignInput(ctx: GraphQLContext, i: CampaignIn) {
  const cur = await shopCurrency(ctx);
  let budget: number | undefined;
  if (i.budget != null) { try { budget = parseMoney(i.budget, cur); } catch { return { errors: fail(['input', 'budget'], 'Budget is invalid', 'INVALID') }; } }
  const status: 'DRAFT' | 'ACTIVE' | 'ENDED' | undefined = i.status === 'DRAFT' || i.status === 'ACTIVE' || i.status === 'ENDED' ? i.status : undefined;
  if (i.status && !status) return { errors: fail(['input', 'status'], 'Status is invalid', 'INVALID') };
  return { value: { name: i.name ?? undefined, channel: i.channel ?? undefined, utmSource: i.utmSource, utmMedium: i.utmMedium, utmCampaign: i.utmCampaign, budget, status, startsAt: i.startsAt ? new Date(i.startsAt) : i.startsAt, endsAt: i.endsAt ? new Date(i.endsAt) : i.endsAt, notes: i.notes } };
}
const CampaignPayload = (name: string) => definePayload<{ campaign: Campaign | null }>(name, (u) => ({ campaign: u.field({ type: CampaignRef, nullable: true, resolve: (p) => p.campaign }) }));
const cid = (v: string | number) => parseId(String(v), 'ShopmeMarketingCampaign');

builder.queryFields((t) => ({
  shopmeMarketingCampaigns: t.field({ type: [CampaignRef], resolve: (_r, _a, ctx) => { requireScope(ctx, 'read_marketing_events'); return campaignResults(ctx.db, ctx.shopId); } }),
  shopmeAttribution: t.field({
    type: Attribution, args: { from: t.arg({ type: 'DateTime', required: true }), to: t.arg({ type: 'DateTime', required: true }) },
    resolve: (_r, a, ctx) => { requireScope(ctx, 'read_marketing_events'); return attributionReport(ctx.db, ctx.shopId, new Date(a.from), new Date(a.to)); },
  }),
}));
builder.mutationFields((t) => ({
  shopmeMarketingCampaignCreate: t.field({
    type: CampaignPayload('ShopmeMarketingCampaignCreatePayload'), args: { input: t.arg({ type: CampaignInput, required: true }) },
    resolve: async (_r, { input }, ctx) => {
      requireScope(ctx, 'write_marketing_events');
      const v = await campaignInput(ctx, input);
      if (!v.value) return { campaign: null, userErrors: v.errors };
      const r = await saveCampaign(ctx.db, ctx.shopId, null, v.value);
      return r.ok ? { campaign: { ...r.value, orders: 0, sales: 0 }, userErrors: [] } : { campaign: null, userErrors: r.errors };
    },
  }),
  shopmeMarketingCampaignUpdate: t.field({
    type: CampaignPayload('ShopmeMarketingCampaignUpdatePayload'), args: { id: t.arg.id({ required: true }), input: t.arg({ type: CampaignInput, required: true }) },
    resolve: async (_r, a, ctx) => {
      requireScope(ctx, 'write_marketing_events');
      const id = cid(a.id);
      const v = await campaignInput(ctx, a.input);
      if (!id) return { campaign: null, userErrors: fail(['id'], 'Campaign does not exist', 'NOT_FOUND') };
      if (!v.value) return { campaign: null, userErrors: v.errors };
      const r = await saveCampaign(ctx.db, ctx.shopId, id, v.value);
      if (!r.ok) return { campaign: null, userErrors: r.errors };
      return { campaign: (await campaignResults(ctx.db, ctx.shopId)).find((c) => c.id === id) ?? null, userErrors: [] };
    },
  }),
  shopmeMarketingCampaignDelete: t.field({
    type: definePayload<{ deletedId: string | null }>('ShopmeMarketingCampaignDeletePayload', (u) => ({ deletedId: u.id({ nullable: true, resolve: (p) => p.deletedId }) })), args: { id: t.arg.id({ required: true }) },
    resolve: async (_r, a, ctx) => { requireScope(ctx, 'write_marketing_events'); const id = cid(a.id); return id && (await deleteCampaign(ctx.db, ctx.shopId, id)) ? { deletedId: toGid('ShopmeMarketingCampaign', id), userErrors: [] } : { deletedId: null, userErrors: fail(['id'], 'Campaign does not exist', 'NOT_FOUND') }; },
  }),
}));

/* ------------------------------ sales channels ------------------------------ */

const Channel = builder.objectRef<{ handle: string; kind: string; active: boolean; products: number; published: number; orders: number; sales: number }>('ShopmeSalesChannel').implement({
  fields: (t) => ({
    handle: t.exposeString('handle'), kind: t.exposeString('kind'), active: t.exposeBoolean('active'), products: t.exposeInt('products'), publishedProducts: t.exposeInt('published'), orders: t.exposeInt('orders'),
    sales: t.field({ type: 'Money', resolve: async (c, _a, ctx) => formatDecimal(c.sales, await shopCurrency(ctx)) }),
  }),
});
builder.queryFields((t) => ({
  shopmeSalesChannels: t.field({ type: [Channel], resolve: (_r, _a, ctx) => { requireScope(ctx, 'read_publications'); return salesChannels(ctx.db, ctx.shopId); } }),
}));
builder.mutationFields((t) => ({
  shopmeSalesChannelPublishAll: t.field({
    type: definePayload<{ changed: number }>('ShopmeSalesChannelPublishAllPayload', (u) => ({ changed: u.exposeInt('changed') })),
    args: { handle: t.arg.string({ required: true }), publish: t.arg.boolean({ required: true }) },
    description: 'Publishes every active product to the channel, or takes them all off it. Only the online store has a catalog.',
    resolve: async (_r, a, ctx) => {
      requireScope(ctx, 'write_publications');
      if (a.handle !== 'online-store') return { changed: 0, userErrors: fail(['handle'], 'This channel has no catalog to publish', 'INVALID') };
      return { changed: await setStorefrontPublication(ctx.db, ctx.shopId, a.publish), userErrors: [] };
    },
  }),
}));
