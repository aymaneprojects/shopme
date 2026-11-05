import { boolean, check, index, jsonb, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core';
import { money, oneOf, pk, ref, shopIdCol, tagsCol, timestamps, ts } from './_helpers';
import { shops } from './shop';
import { customers, orders } from './sales';

const shopFk = () => shopIdCol().references(() => shops.id, { onDelete: 'cascade' });

export const DRAFT_STATUSES = ['OPEN', 'INVOICE_SENT', 'COMPLETED'] as const;

export interface DraftDiscount { title: string | null; description: string | null; valueType: 'PERCENTAGE' | 'FIXED_AMOUNT'; /** Percent (10 = 10%) or minor units. */ value: number }
/** A resolved draft line (catalog variant or custom item). Prices are minor units in the shop currency. */
export interface DraftLine {
  uuid: string;
  variantId: number | null; productId: number | null;
  title: string; variantTitle: string | null; sku: string | null; vendor: string | null; imageUrl: string | null;
  quantity: number; unitPrice: number; taxable: boolean; requiresShipping: boolean; grams: number;
  discount: DraftDiscount | null; properties: Record<string, string>;
}
export type DraftAddress = Record<string, string | null | undefined>;

/** Draft (manual) orders. Lines, discount and shipping live in JSON; the money columns are the last priced snapshot. */
export const draftOrders = pgTable('draft_orders', {
  id: pk(), shopId: shopIdCol().references(() => shops.id, { onDelete: 'cascade' }),
  name: text('name').notNull(), // '#D1'
  token: text('token').notNull().unique(), // capability for the invoice link
  status: text('status').notNull().default('OPEN'),
  customerId: ref('customer_id').references(() => customers.id, { onDelete: 'set null' }),
  email: text('email'), phone: text('phone'), note: text('note'), tags: tagsCol(),
  /** B2B purchasing entity; copied to the order when the draft is completed. */
  companyId: ref('company_id'), companyContactId: ref('company_contact_id'), companyLocationId: ref('company_location_id'),
  currency: text('currency').notNull(),
  taxExempt: boolean('tax_exempt').notNull().default(false),
  lines: jsonb('lines').$type<DraftLine[]>().notNull().default([]),
  appliedDiscount: jsonb('applied_discount').$type<DraftDiscount | null>(),
  shippingLine: jsonb('shipping_line').$type<{ title: string; price: number } | null>(),
  shippingAddress: jsonb('shipping_address').$type<DraftAddress | null>(),
  billingAddress: jsonb('billing_address').$type<DraftAddress | null>(),
  subtotal: money('subtotal').notNull().default(0), totalDiscounts: money('total_discounts').notNull().default(0),
  totalShipping: money('total_shipping').notNull().default(0), totalTax: money('total_tax').notNull().default(0), total: money('total').notNull().default(0),
  /** Per-line priced values and tax lines of the last calculation. */
  calc: jsonb('calc').$type<DraftCalc | null>(),
  poNumber: text('po_number'),
  /** Market the draft is sold in; `presentmentCurrency` is the currency of that market (informational: the order is created in the shop currency). */
  marketId: ref('market_id'), presentmentCurrency: text('presentment_currency'),
  invoiceSentAt: ts('invoice_sent_at'), completedAt: ts('completed_at'),
  orderId: ref('order_id').references(() => orders.id, { onDelete: 'set null' }),
  ...timestamps(),
}, (t) => [index('draft_orders_shop_idx').on(t.shopId, t.createdAt), check('draft_orders_status_chk', oneOf(t.status, DRAFT_STATUSES))]);

export interface DraftCalc {
  /** `discount` is everything allocated to the line, `lineDiscount` only its own custom discount. */
  lines: { uuid: string; subtotal: number; discount: number; lineDiscount: number; total: number; tax: number }[];
  /** Amount of the order-level discount. */
  orderDiscount: number;
  taxLines: { title: string; rate: number; price: number }[];
}

/** Merchant overrides of notification email templates (the defaults live in code). */
export const notificationTemplates = pgTable('notification_templates', {
  id: pk(), shopId: shopIdCol().references(() => shops.id, { onDelete: 'cascade' }),
  key: text('key').notNull(),
  subject: text('subject').notNull(), body: text('body').notNull(),
  ...timestamps(),
}, (t) => [uniqueIndex('notification_templates_key_uq').on(t.shopId, t.key)]);
