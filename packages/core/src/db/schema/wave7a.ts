import { sql } from 'drizzle-orm';
import { boolean, check, index, integer, jsonb, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core';
import { createdAt, money, oneOf, pk, ref, shopIdCol, timestamps, ts } from './_helpers';
import { shops } from './shop';
import { carts, customers, discounts, orders } from './sales';

/** Wave 7a commerce tables: gift cards, checkout extras (gift card codes, recovery emails), order edits, returns, discount extensions. */
const shopFk = () => shopIdCol().references(() => shops.id, { onDelete: 'cascade' });

export const giftCards = pgTable('gift_cards', {
  id: pk(), shopId: shopFk(),
  /** Upper-case, 8-20 letters and digits. Redeemed at checkout; only the last four characters are shown in the admin. */
  code: text('code').notNull(),
  /** Unguessable token of the public page `/gift_cards/:token`. */
  token: text('token').notNull(),
  currency: text('currency').notNull(),
  initialValue: money('initial_value').notNull(),
  balance: money('balance').notNull(),
  enabled: boolean('enabled').notNull().default(true),
  expiresOn: ts('expires_on'),
  deactivatedAt: ts('deactivated_at'),
  note: text('note'),
  customerId: ref('customer_id').references(() => customers.id, { onDelete: 'set null' }),
  orderId: ref('order_id'), orderLineId: ref('order_line_id'),
  recipientCustomerId: ref('recipient_customer_id').references(() => customers.id, { onDelete: 'set null' }),
  recipientName: text('recipient_name'), message: text('message'),
  sendNotificationAt: ts('send_notification_at'), notifiedAt: ts('notified_at'),
  templateSuffix: text('template_suffix'),
  ...timestamps(),
}, (t) => [
  uniqueIndex('gift_cards_shop_code_uq').on(t.shopId, t.code), uniqueIndex('gift_cards_token_uq').on(t.token), index('gift_cards_order_idx').on(t.orderId),
  check('gift_cards_balance_chk', sql`${t.balance} >= 0`),
]);

export const giftCardTransactions = pgTable('gift_card_transactions', {
  id: pk(), shopId: shopFk(),
  giftCardId: ref('gift_card_id').notNull().references(() => giftCards.id, { onDelete: 'cascade' }),
  /** Signed minor units: credits are positive, debits (including checkout redemptions) negative. */
  amount: money('amount').notNull(),
  note: text('note'),
  orderId: ref('order_id').references(() => orders.id, { onDelete: 'set null' }),
  processedAt: ts('processed_at').notNull().defaultNow(),
  createdAt: createdAt(),
}, (t) => [index('gift_card_tx_card_idx').on(t.giftCardId)]);

/** One row per cart that needs more than the cart table holds: gift cards applied at checkout and the recovery email state. */
export const checkoutMeta = pgTable('checkout_meta', {
  cartId: ref('cart_id').primaryKey().references(() => carts.id, { onDelete: 'cascade' }),
  shopId: shopFk(),
  giftCardCodes: text('gift_card_codes').array().notNull().default([]),
  recoveryEmailCount: integer('recovery_email_count').notNull().default(0),
  recoverySentAt: ts('recovery_sent_at'),
  /** Tip chosen at checkout: a percentage of the subtotal (preset) or a fixed amount in minor units. */
  tipPercent: integer('tip_percent'),
  tipAmount: integer('tip_amount').notNull().default(0),
  /** The buyer's "use store credit" checkbox (checked by default; only matters when the signed-in customer has credit). */
  useStoreCredit: boolean('use_store_credit').notNull().default(true),
});

/** Ids of staged additions start at 900000000 so they never collide with order line ids (`quantities` keys are `String(id)` of either). */
export type StagedAddition = { id: number; variantId: number; quantity: number };
export type StagedDiscount = { id: number; lineId: number; valueType: 'PERCENTAGE' | 'FIXED_AMOUNT'; /** percent (10 = 10%) or minor units */ value: number; description: string | null };
export const orderEdits = pgTable('order_edits', {
  id: pk(), shopId: shopFk(),
  orderId: ref('order_id').notNull().references(() => orders.id, { onDelete: 'cascade' }),
  status: text('status').notNull().default('OPEN'),
  staffId: ref('staff_id'),
  additions: jsonb('additions').$type<StagedAddition[]>().notNull().default([]),
  /** Order line id -> new quantity (additions carry their own quantity). */
  quantities: jsonb('quantities').$type<Record<string, number>>().notNull().default({}),
  /** Order line id -> do not put removed units back in stock (default: restock). */
  noRestock: jsonb('no_restock').$type<Record<string, boolean>>().notNull().default({}),
  discounts: jsonb('discounts').$type<StagedDiscount[]>().notNull().default([]),
  committedAt: ts('committed_at'),
  ...timestamps(),
}, (t) => [index('order_edits_order_idx').on(t.orderId), check('order_edits_status_chk', oneOf(t.status, ['OPEN', 'COMMITTED', 'DISCARDED']))]);

export const returns = pgTable('returns', {
  id: pk(), shopId: shopFk(),
  orderId: ref('order_id').notNull().references(() => orders.id, { onDelete: 'cascade' }),
  number: integer('number').notNull(),
  name: text('name').notNull(), // '#1001-R1'
  status: text('status').notNull().default('OPEN'),
  note: text('note'),
  requestApprovedAt: ts('request_approved_at'), closedAt: ts('closed_at'),
  /** Defaults copied from the shop return rules when the return is created. */
  returnShippingFee: integer('return_shipping_fee').notNull().default(0),
  restockingFeeBps: integer('restocking_fee_bps').notNull().default(0),
  ...timestamps(),
}, (t) => [index('returns_order_idx').on(t.orderId), check('returns_status_chk', oneOf(t.status, ['REQUESTED', 'OPEN', 'CLOSED', 'DECLINED', 'CANCELED']))]);

export const returnLines = pgTable('return_lines', {
  id: pk(), shopId: shopFk(),
  returnId: ref('return_id').notNull().references(() => returns.id, { onDelete: 'cascade' }),
  orderLineId: ref('order_line_id').notNull(),
  quantity: integer('quantity').notNull(),
  reason: text('reason').notNull().default('UNKNOWN'),
  note: text('note'),
  /** RETURN puts the items back in stock when the return is closed. */
  restockType: text('restock_type').notNull().default('NO_RESTOCK'),
  locationId: ref('location_id'),
  restocked: boolean('restocked').notNull().default(false),
}, (t) => [index('return_lines_return_idx').on(t.returnId)]);

export type DiscountScope = { productIds?: number[]; collectionIds?: number[] };
export interface BxgyConfig {
  buyQuantity: number; buyAppliesTo: DiscountScope;
  getQuantity: number; getAppliesTo: DiscountScope;
  /** Maximum number of times the offer applies in one order. */
  usesPerOrder: number | null;
}
/** What the discounts table does not hold: combination rules, the Shopify discount type, and BXGY configuration. */
export const discountExtensions = pgTable('discount_extensions', {
  discountId: ref('discount_id').primaryKey().references(() => discounts.id, { onDelete: 'cascade' }),
  shopId: shopFk(),
  subtype: text('subtype').notNull().default('BASIC'),
  combinesWith: jsonb('combines_with').$type<{ product: boolean; order: boolean; shipping: boolean }>().notNull().default({ product: false, order: false, shipping: false }),
  bxgy: jsonb('bxgy').$type<BxgyConfig | null>(),
  /** Who may use the discount: everyone, customers of the listed segments, or the listed customers. */
  eligibility: text('eligibility').notNull().default('ALL'),
  segmentIds: integer('segment_ids').array().notNull().default(sql`'{}'::integer[]`),
  customerIds: integer('customer_ids').array().notNull().default(sql`'{}'::integer[]`),
  tags: text('tags').array().notNull().default(sql`'{}'::text[]`),
}, (t) => [check('discount_ext_subtype_chk', oneOf(t.subtype, ['BASIC', 'FREE_SHIPPING', 'BXGY'])), check('discount_ext_eligibility_chk', oneOf(t.eligibility, ['ALL', 'SEGMENTS', 'CUSTOMERS']))]);
