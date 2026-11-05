import { check, index, integer, pgTable, text } from 'drizzle-orm/pg-core';
import { createdAt, money, oneOf, pk, ref, shopIdCol, timestamps, ts } from './_helpers';
import { shops } from './shop';
import { orders } from './sales';

const shopFk = () => shopIdCol().references(() => shops.id, { onDelete: 'cascade' });

/** Fulfilment batches: a named group of orders picked and packed together (`orders.batch_id`). */
export const orderBatches = pgTable('order_batches', {
  id: pk(), shopId: shopFk(),
  name: text('name').notNull(),
  ...timestamps(),
}, (t) => [index('order_batches_shop_idx').on(t.shopId)]);

/**
 * Shipping labels: a carrier, service and tracking number recorded for an order, either entered by hand (`MANUAL`) or bought from a
 * carrier account that sells postage (`PURCHASED`, with the carrier's label reference, the cost charged and the label document).
 */
export const shippingLabels = pgTable('shipping_labels', {
  id: pk(), shopId: shopFk(),
  orderId: ref('order_id').notNull().references(() => orders.id, { onDelete: 'cascade' }),
  fulfillmentId: ref('fulfillment_id'),
  carrier: text('carrier').notNull(), service: text('service'),
  trackingNumber: text('tracking_number'), trackingUrl: text('tracking_url'),
  cost: money('cost').notNull().default(0), weightGrams: integer('weight_grams'),
  status: text('status').notNull().default('ACTIVE'),
  voidedAt: ts('voided_at'),
  source: text('source').notNull().default('MANUAL'),
  /** Carrier account of Settings > Shipping the label was bought from, and the carrier's own id for it (used to void it). */
  carrierAccountId: text('carrier_account_id'), providerRef: text('provider_ref'),
  /** Currency of `cost` (the carrier's), and the label document: stored by ShopMe and/or a link the carrier hosts. */
  currency: text('currency'), labelFormat: text('label_format'), labelUrl: text('label_url'),
  /** For a voided purchased label: whether the carrier refunded the postage. */
  refundStatus: text('refund_status'),
  ...timestamps(),
}, (t) => [
  index('shipping_labels_order_idx').on(t.orderId), index('shipping_labels_shop_idx').on(t.shopId, t.createdAt), check('shipping_labels_status_chk', oneOf(t.status, ['ACTIVE', 'VOIDED'])),
  check('shipping_labels_source_chk', oneOf(t.source, ['MANUAL', 'PURCHASED'])),
]);

/** The label document of a purchased label (base64), kept apart so label lists stay light. Served to staff only. */
export const shippingLabelDocuments = pgTable('shipping_label_documents', {
  labelId: ref('label_id').primaryKey().references(() => shippingLabels.id, { onDelete: 'cascade' }),
  shopId: shopFk(),
  contentType: text('content_type').notNull(),
  data: text('data').notNull(),
  createdAt: createdAt(),
});

/** Marketing campaigns: a name tied to a UTM campaign so orders can be attributed to it. */
export const marketingCampaigns = pgTable('marketing_campaigns', {
  id: pk(), shopId: shopFk(),
  name: text('name').notNull(),
  channel: text('channel').notNull().default('other'),
  utmSource: text('utm_source'), utmMedium: text('utm_medium'), utmCampaign: text('utm_campaign'),
  budget: money('budget').notNull().default(0),
  status: text('status').notNull().default('ACTIVE'),
  startsAt: ts('starts_at'), endsAt: ts('ends_at'),
  notes: text('notes'),
  ...timestamps(),
}, (t) => [index('marketing_campaigns_shop_idx').on(t.shopId), check('marketing_campaigns_status_chk', oneOf(t.status, ['DRAFT', 'ACTIVE', 'ENDED']))]);
