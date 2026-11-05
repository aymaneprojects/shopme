import { sql } from 'drizzle-orm';
import { bigint, boolean, check, index, integer, jsonb, numeric, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core';
import { createdAt, money, oneOf, pk, ref, shopIdCol, tagsCol, timestamps, ts } from './_helpers';
import { shops } from './shop';
import { locations, productVariants } from './catalog';

const shopFk = () => shopIdCol().references(() => shops.id, { onDelete: 'cascade' });

export const customers = pgTable('customers', {
  id: pk(), shopId: shopFk(),
  email: text('email'), // lower-cased
  firstName: text('first_name'), lastName: text('last_name'), phone: text('phone'),
  locale: text('locale').notNull().default('en'),
  note: text('note'), tags: tagsCol(),
  state: text('state').notNull().default('DISABLED'), // DISABLED | INVITED | ENABLED | DECLINED
  verifiedEmail: boolean('verified_email').notNull().default(false),
  taxExempt: boolean('tax_exempt').notNull().default(false),
  acceptsMarketing: boolean('accepts_marketing').notNull().default(false),
  defaultAddressId: ref('default_address_id'),
  numberOfOrders: integer('number_of_orders').notNull().default(0),
  amountSpent: money('amount_spent').notNull().default(0),
  passwordHash: text('password_hash'), // storefront account
  lastLoginAt: ts('last_login_at'),
  /** Privacy: the data-sale opt-out flag and the last cookie consent the customer gave (restored on sign-in). */
  dataSaleOptOut: boolean('data_sale_opt_out').notNull().default(false),
  consent: jsonb('consent').$type<Record<string, unknown> | null>(),
  /** Marketing consent per channel. `acceptsMarketing` stays in step (true while the email state is SUBSCRIBED). */
  emailMarketingState: text('email_marketing_state').notNull().default('NOT_SUBSCRIBED'),
  emailMarketingOptInLevel: text('email_marketing_opt_in_level').notNull().default('UNKNOWN'),
  emailMarketingUpdatedAt: ts('email_marketing_updated_at'),
  smsMarketingState: text('sms_marketing_state').notNull().default('NOT_SUBSCRIBED'),
  smsMarketingOptInLevel: text('sms_marketing_opt_in_level').notNull().default('UNKNOWN'),
  smsMarketingUpdatedAt: ts('sms_marketing_updated_at'),
  smsMarketingCollectedFrom: text('sms_marketing_collected_from'),
  ...timestamps(),
}, (t) => [uniqueIndex('customers_shop_email_uq').on(t.shopId, t.email), index('customers_shop_created_idx').on(t.shopId, t.createdAt)]);

export const customerAddresses = pgTable('customer_addresses', {
  id: pk(), shopId: shopFk(),
  customerId: ref('customer_id').notNull().references(() => customers.id, { onDelete: 'cascade' }),
  firstName: text('first_name'), lastName: text('last_name'), company: text('company'),
  address1: text('address1'), address2: text('address2'), city: text('city'),
  province: text('province'), provinceCode: text('province_code'), zip: text('zip'),
  country: text('country'), countryCode: text('country_code'), phone: text('phone'),
  ...timestamps(),
});

export const carts = pgTable('carts', {
  id: pk(), shopId: shopFk(),
  token: text('token').notNull().unique(),
  customerId: ref('customer_id').references(() => customers.id, { onDelete: 'set null' }),
  email: text('email'), currency: text('currency').notNull(),
  note: text('note'), attributes: jsonb('attributes').$type<Record<string, string>>().notNull().default({}),
  discountCodes: text('discount_codes').array().notNull().default([]),
  shippingAddress: jsonb('shipping_address'), billingAddress: jsonb('billing_address'),
  shippingRateId: ref('shipping_rate_id'),
  /** Buyer market and country the cart is priced for (null: the shop's default context). `currency` is the presentment currency. */
  marketId: ref('market_id'), countryCode: text('country_code'),
  /** Set when the cart was opened from a draft order's pay link; the draft is completed by that checkout. No FK: draft_orders is defined later (ops.ts imports this file). */
  draftOrderId: ref('draft_order_id'),
  completedAt: ts('completed_at'),
  ...timestamps(),
});

export const cartLines = pgTable('cart_lines', {
  id: pk(), shopId: shopFk(),
  cartId: ref('cart_id').notNull().references(() => carts.id, { onDelete: 'cascade' }),
  variantId: ref('variant_id').notNull().references(() => productVariants.id, { onDelete: 'cascade' }),
  quantity: integer('quantity').notNull(),
  properties: jsonb('properties').$type<Record<string, string>>().notNull().default({}),
  position: integer('position').notNull().default(0),
  ...timestamps(),
}, (t) => [index('cart_lines_cart_idx').on(t.cartId)]);

export const orders = pgTable('orders', {
  id: pk(), shopId: shopFk(),
  orderNumber: integer('order_number').notNull(),
  name: text('name').notNull(), // '#1001'
  customerId: ref('customer_id').references(() => customers.id, { onDelete: 'set null' }),
  email: text('email'), phone: text('phone'),
  currency: text('currency').notNull(),
  presentmentCurrency: text('presentment_currency').notNull(),
  /** presentment = shop amount * rate (1 while single-currency). */
  currencyRate: numeric('currency_rate', { precision: 18, scale: 8, mode: 'number' }).notNull().default(1),
  /** Exact amounts in `presentmentCurrency` as the buyer saw them (null while single-currency: equal to the shop amounts). */
  presentmentMoney: jsonb('presentment_money').$type<{ subtotal: number; shipping: number; tax: number; discounts: number; tip: number; total: number }>(),
  taxesIncluded: boolean('taxes_included').notNull().default(false),
  test: boolean('test').notNull().default(false),
  financialStatus: text('financial_status').notNull().default('PENDING'),
  fulfillmentStatus: text('fulfillment_status').notNull().default('UNFULFILLED'),
  cancelReason: text('cancel_reason'), cancelledAt: ts('cancelled_at'), closedAt: ts('closed_at'),
  /** Fulfillment hold: while `heldAt` is set the order shows ON_HOLD and cannot be fulfilled. */
  holdReason: text('hold_reason'), holdNote: text('hold_note'), heldAt: ts('held_at'),
  processedAt: ts('processed_at').notNull().defaultNow(),
  note: text('note'), tags: tagsCol(), sourceName: text('source_name').default('web'),
  cartToken: text('cart_token'),
  subtotal: money('subtotal').notNull().default(0),
  totalShipping: money('total_shipping').notNull().default(0),
  totalTax: money('total_tax').notNull().default(0),
  totalDiscounts: money('total_discounts').notNull().default(0),
  total: money('total').notNull().default(0),
  /** Tip left by the buyer at checkout; included in `total`. */
  totalTip: money('total_tip').notNull().default(0),
  totalRefunded: money('total_refunded').notNull().default(0),
  ...timestamps(),
}, (t) => [
  uniqueIndex('orders_shop_number_uq').on(t.shopId, t.orderNumber),
  index('orders_shop_created_idx').on(t.shopId, t.createdAt),
  index('orders_customer_idx').on(t.shopId, t.customerId),
  check('orders_financial_chk', oneOf(t.financialStatus, ['PENDING', 'AUTHORIZED', 'PARTIALLY_PAID', 'PAID', 'PARTIALLY_REFUNDED', 'REFUNDED', 'VOIDED', 'EXPIRED'])),
  check('orders_fulfillment_chk', oneOf(t.fulfillmentStatus, ['UNFULFILLED', 'PARTIALLY_FULFILLED', 'FULFILLED', 'RESTOCKED', 'ON_HOLD'])),
]);

export const orderLines = pgTable('order_lines', {
  id: pk(), shopId: shopFk(),
  orderId: ref('order_id').notNull().references(() => orders.id, { onDelete: 'cascade' }),
  position: integer('position').notNull().default(0),
  productId: ref('product_id'), variantId: ref('variant_id'), // plain ids: history survives product deletes
  title: text('title').notNull(), variantTitle: text('variant_title'), sku: text('sku'), vendor: text('vendor'),
  quantity: integer('quantity').notNull(), currentQuantity: integer('current_quantity').notNull(),
  fulfilledQuantity: integer('fulfilled_quantity').notNull().default(0),
  requiresShipping: boolean('requires_shipping').notNull().default(true),
  taxable: boolean('taxable').notNull().default(true),
  isGiftCard: boolean('is_gift_card').notNull().default(false),
  unitPrice: money('unit_price').notNull(),
  discountedTotal: money('discounted_total').notNull(),
  totalTax: money('total_tax').notNull().default(0),
  /** The same three amounts in the order's presentment currency (null while single-currency). */
  presentmentUnitPrice: money('presentment_unit_price'), presentmentDiscountedTotal: money('presentment_discounted_total'), presentmentTotalTax: money('presentment_total_tax'),
  weightGrams: integer('weight_grams'),
  imageUrl: text('image_url'),
  properties: jsonb('properties').$type<Record<string, string>>().notNull().default({}),
}, (t) => [index('order_lines_order_idx').on(t.orderId)]);

export const orderAddresses = pgTable('order_addresses', {
  id: pk(), shopId: shopFk(),
  orderId: ref('order_id').notNull().references(() => orders.id, { onDelete: 'cascade' }),
  kind: text('kind').notNull(), // shipping | billing
  firstName: text('first_name'), lastName: text('last_name'), company: text('company'),
  address1: text('address1'), address2: text('address2'), city: text('city'),
  province: text('province'), provinceCode: text('province_code'), zip: text('zip'),
  country: text('country'), countryCode: text('country_code'), phone: text('phone'),
}, (t) => [uniqueIndex('order_addresses_kind_uq').on(t.orderId, t.kind), check('order_addresses_kind_chk', oneOf(t.kind, ['shipping', 'billing']))]);

export const orderShippingLines = pgTable('order_shipping_lines', {
  id: pk(), shopId: shopFk(),
  orderId: ref('order_id').notNull().references(() => orders.id, { onDelete: 'cascade' }),
  title: text('title').notNull(), code: text('code'), price: money('price').notNull().default(0), tax: money('tax').notNull().default(0),
});

export const orderTaxLines = pgTable('order_tax_lines', {
  id: pk(), shopId: shopFk(),
  orderId: ref('order_id').notNull().references(() => orders.id, { onDelete: 'cascade' }),
  orderLineId: ref('order_line_id'), shippingLineId: ref('shipping_line_id'),
  title: text('title').notNull(), rate: numeric('rate', { precision: 9, scale: 6, mode: 'number' }).notNull(), price: money('price').notNull(),
});

export const orderDiscountApplications = pgTable('order_discount_applications', {
  id: pk(), shopId: shopFk(),
  orderId: ref('order_id').notNull().references(() => orders.id, { onDelete: 'cascade' }),
  discountId: ref('discount_id'), code: text('code'), title: text('title'),
  valueType: text('value_type').notNull(), value: bigint('value', { mode: 'number' }).notNull(),
  allocatedAmount: money('allocated_amount').notNull().default(0),
  targetType: text('target_type').notNull().default('LINE_ITEM'),
});

export const transactions = pgTable('transactions', {
  id: pk(), shopId: shopFk(),
  orderId: ref('order_id').notNull().references(() => orders.id, { onDelete: 'cascade' }),
  parentId: ref('parent_id'),
  kind: text('kind').notNull(), status: text('status').notNull(),
  gateway: text('gateway'), amount: money('amount').notNull(), currency: text('currency').notNull(),
  /** What the buyer paid or got back in the presentment currency (null while single-currency). `amount` stays in shop money. */
  presentmentAmount: money('presentment_amount'), presentmentCurrency: text('presentment_currency'),
  test: boolean('test').notNull().default(false),
  errorCode: text('error_code'),
  paymentId: text('payment_id'), // provider reference (e.g. Stripe PaymentIntent id)
  /** Gift card that paid this transaction (gateway 'gift_card'); refunds credit the balance back. */
  giftCardId: ref('gift_card_id'),
  processedAt: ts('processed_at'),
  createdAt: createdAt(),
}, (t) => [index('transactions_order_idx').on(t.orderId), index('transactions_payment_idx').on(t.paymentId),
  check('transactions_kind_chk', oneOf(t.kind, ['SALE', 'CAPTURE', 'AUTHORIZATION', 'VOID', 'REFUND', 'CHANGE'])),
  check('transactions_status_chk', oneOf(t.status, ['SUCCESS', 'FAILURE', 'PENDING', 'ERROR']))]);

export const fulfillments = pgTable('fulfillments', {
  id: pk(), shopId: shopFk(),
  orderId: ref('order_id').notNull().references(() => orders.id, { onDelete: 'cascade' }),
  locationId: ref('location_id').references(() => locations.id, { onDelete: 'set null' }),
  name: text('name').notNull(), // '#1001.1'
  status: text('status').notNull().default('SUCCESS'),
  trackingCompany: text('tracking_company'),
  trackingNumbers: text('tracking_numbers').array().notNull().default([]),
  trackingUrls: text('tracking_urls').array().notNull().default([]),
  notifyCustomer: boolean('notify_customer').notNull().default(false),
  deliveredAt: ts('delivered_at'),
  ...timestamps(),
}, (t) => [check('fulfillments_status_chk', oneOf(t.status, ['SUCCESS', 'CANCELLED', 'ERROR', 'FAILURE']))]);

export const fulfillmentLines = pgTable('fulfillment_lines', {
  id: pk(), shopId: shopFk(),
  fulfillmentId: ref('fulfillment_id').notNull().references(() => fulfillments.id, { onDelete: 'cascade' }),
  orderLineId: ref('order_line_id').notNull().references(() => orderLines.id, { onDelete: 'cascade' }),
  quantity: integer('quantity').notNull(),
});

export const refunds = pgTable('refunds', {
  id: pk(), shopId: shopFk(),
  orderId: ref('order_id').notNull().references(() => orders.id, { onDelete: 'cascade' }),
  note: text('note'), total: money('total').notNull(),
  processedAt: ts('processed_at').notNull().defaultNow(),
  createdAt: createdAt(),
});

export const refundLines = pgTable('refund_lines', {
  id: pk(), shopId: shopFk(),
  refundId: ref('refund_id').notNull().references(() => refunds.id, { onDelete: 'cascade' }),
  orderLineId: ref('order_line_id').notNull().references(() => orderLines.id, { onDelete: 'cascade' }),
  quantity: integer('quantity').notNull(), restockType: text('restock_type'), locationId: ref('location_id'),
  subtotal: money('subtotal').notNull().default(0), totalTax: money('total_tax').notNull().default(0),
});

export const discounts = pgTable('discounts', {
  id: pk(), shopId: shopFk(),
  title: text('title').notNull(),
  kind: text('kind').notNull().default('CODE'), // CODE | AUTOMATIC
  status: text('status').notNull().default('ACTIVE'), // ACTIVE | EXPIRED | SCHEDULED | DISABLED
  valueType: text('value_type').notNull().default('PERCENTAGE'), // PERCENTAGE (value = basis points) | FIXED_AMOUNT (value = cents)
  value: bigint('value', { mode: 'number' }).notNull().default(0),
  target: text('target').notNull().default('ORDER'), // ORDER | PRODUCTS | SHIPPING
  /** {productIds:[], collectionIds:[]} when target = PRODUCTS */
  appliesTo: jsonb('applies_to').$type<{ productIds?: number[]; collectionIds?: number[] }>().notNull().default({}),
  minimumSubtotal: money('minimum_subtotal'), minimumQuantity: integer('minimum_quantity'),
  usageLimit: integer('usage_limit'), usageCount: integer('usage_count').notNull().default(0),
  oncePerCustomer: boolean('once_per_customer').notNull().default(false),
  /** Sales channels (publication ids) the discount works on; empty = every channel. */
  publicationIds: bigint('publication_ids', { mode: 'number' }).array().notNull().default(sql`'{}'::bigint[]`),
  startsAt: ts('starts_at'), endsAt: ts('ends_at'),
  ...timestamps(),
}, (t) => [check('discounts_kind_chk', oneOf(t.kind, ['CODE', 'AUTOMATIC'])), check('discounts_value_type_chk', oneOf(t.valueType, ['PERCENTAGE', 'FIXED_AMOUNT']))]);

export const discountCodes = pgTable('discount_codes', {
  id: pk(), shopId: shopFk(),
  discountId: ref('discount_id').notNull().references(() => discounts.id, { onDelete: 'cascade' }),
  code: text('code').notNull(), // stored upper-cased; matched case-insensitively
  usageCount: integer('usage_count').notNull().default(0),
}, (t) => [uniqueIndex('discount_codes_shop_code_uq').on(t.shopId, t.code)]);

export const shippingZones = pgTable('shipping_zones', {
  id: pk(), shopId: shopFk(), name: text('name').notNull(), ...timestamps(),
});
export const shippingZoneCountries = pgTable('shipping_zone_countries', {
  id: pk(), shopId: shopFk(),
  zoneId: ref('zone_id').notNull().references(() => shippingZones.id, { onDelete: 'cascade' }),
  countryCode: text('country_code').notNull(), // '*' = rest of world
  provinceCodes: text('province_codes').array().notNull().default([]),
}, (t) => [uniqueIndex('shipping_zone_country_uq').on(t.zoneId, t.countryCode)]);
export const shippingRates = pgTable('shipping_rates', {
  id: pk(), shopId: shopFk(),
  zoneId: ref('zone_id').notNull().references(() => shippingZones.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  type: text('type').notNull().default('FLAT'), // FLAT | WEIGHT_BASED | PRICE_BASED | FREE
  price: money('price').notNull().default(0),
  minValue: bigint('min_value', { mode: 'number' }), maxValue: bigint('max_value', { mode: 'number' }), // grams or cents
  position: integer('position').notNull().default(0),
  active: boolean('active').notNull().default(true),
}, (t) => [check('shipping_rates_type_chk', oneOf(t.type, ['FLAT', 'WEIGHT_BASED', 'PRICE_BASED', 'FREE']))]);

export const taxRates = pgTable('tax_rates', {
  id: pk(), shopId: shopFk(),
  name: text('name').notNull(),
  countryCode: text('country_code').notNull(), provinceCode: text('province_code'),
  rate: numeric('rate', { precision: 9, scale: 6, mode: 'number' }).notNull(), // percent, e.g. 20
  appliesToShipping: boolean('applies_to_shipping').notNull().default(false),
  priority: integer('priority').notNull().default(0),
  active: boolean('active').notNull().default(true),
});
