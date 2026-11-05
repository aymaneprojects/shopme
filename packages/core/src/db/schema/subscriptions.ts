import { sql } from 'drizzle-orm';
import { boolean, check, index, integer, jsonb, pgTable, primaryKey, text, uniqueIndex } from 'drizzle-orm/pg-core';
import { createdAt, money, oneOf, pk, ref, shopIdCol, timestamps, ts } from './_helpers';
import { shops } from './shop';
import { products, productVariants } from './catalog';
import { customers, orders } from './sales';

/** Purchase options (selling plans) and the subscription contracts they create at checkout. */
const shopFk = () => shopIdCol().references(() => shops.id, { onDelete: 'cascade' });

export const SELLING_PLAN_INTERVALS = ['DAY', 'WEEK', 'MONTH', 'YEAR'] as const;
export type SellingPlanInterval = (typeof SELLING_PLAN_INTERVALS)[number];
export const SELLING_PLAN_CATEGORIES = ['SUBSCRIPTION', 'PRE_ORDER', 'TRY_BEFORE_YOU_BUY', 'OTHER'] as const;
export const PRICING_ADJUSTMENT_TYPES = ['PERCENTAGE', 'FIXED_AMOUNT', 'PRICE'] as const;
export type PricingAdjustmentType = (typeof PRICING_ADJUSTMENT_TYPES)[number];
export const SUBSCRIPTION_STATUSES = ['ACTIVE', 'PAUSED', 'CANCELLED', 'EXPIRED', 'FAILED'] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

/** How often the customer is charged. `minCycles` / `maxCycles` bound the number of billing cycles (null: no bound). */
export interface PlanBillingPolicy { interval: SellingPlanInterval; intervalCount: number; minCycles: number | null; maxCycles: number | null }
/** How often the items are delivered (equal to billing for pay-per-delivery plans, shorter for prepaid ones). */
export interface PlanDeliveryPolicy { interval: SellingPlanInterval; intervalCount: number }
/**
 * Price change applied to the one-time price. `afterCycle` 0 applies from the first order; N applies from order N+1.
 * `adjustmentValue` is a percentage (10 = 10% off) for PERCENTAGE, minor units of the shop currency otherwise (amount off, or the new price).
 */
export interface PlanPricingPolicy { adjustmentType: PricingAdjustmentType; adjustmentValue: number; afterCycle: number }

/** A set of purchase options shown together on the product page (e.g. "Subscribe and save" with 2 and 4 week plans). */
export const sellingPlanGroups = pgTable('selling_plan_groups', {
  id: pk(), shopId: shopFk(),
  name: text('name').notNull(),
  merchantCode: text('merchant_code').notNull(),
  description: text('description'),
  /** Option names (e.g. "Delivery every"); each plan carries the matching values. */
  options: text('options').array().notNull().default(sql`'{}'::text[]`),
  position: integer('position'),
  appId: text('app_id'),
  ...timestamps(),
}, (t) => [index('selling_plan_groups_shop_idx').on(t.shopId, t.id)]);

export const sellingPlans = pgTable('selling_plans', {
  id: pk(), shopId: shopFk(),
  groupId: ref('group_id').notNull().references(() => sellingPlanGroups.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  description: text('description'),
  options: text('options').array().notNull().default(sql`'{}'::text[]`),
  position: integer('position'),
  category: text('category').notNull().default('SUBSCRIPTION'),
  billingPolicy: jsonb('billing_policy').$type<PlanBillingPolicy>().notNull(),
  deliveryPolicy: jsonb('delivery_policy').$type<PlanDeliveryPolicy>().notNull(),
  pricingPolicies: jsonb('pricing_policies').$type<PlanPricingPolicy[]>().notNull().default([]),
  createdAt: createdAt(),
}, (t) => [index('selling_plans_group_idx').on(t.groupId), check('selling_plans_category_chk', oneOf(t.category, SELLING_PLAN_CATEGORIES))]);

/** Products whose every variant offers the group's plans. */
export const sellingPlanGroupProducts = pgTable('selling_plan_group_products', {
  shopId: shopFk(),
  groupId: ref('group_id').notNull().references(() => sellingPlanGroups.id, { onDelete: 'cascade' }),
  productId: ref('product_id').notNull().references(() => products.id, { onDelete: 'cascade' }),
}, (t) => [primaryKey({ columns: [t.groupId, t.productId] }), index('spg_products_product_idx').on(t.productId)]);

/** Single variants that offer the group's plans (when only some variants of a product do). */
export const sellingPlanGroupVariants = pgTable('selling_plan_group_variants', {
  shopId: shopFk(),
  groupId: ref('group_id').notNull().references(() => sellingPlanGroups.id, { onDelete: 'cascade' }),
  variantId: ref('variant_id').notNull().references(() => productVariants.id, { onDelete: 'cascade' }),
}, (t) => [primaryKey({ columns: [t.groupId, t.variantId] }), index('spg_variants_variant_idx').on(t.variantId)]);

/** Discount kept on a contract for the next billing cycles ("limit to the first N payments"); `remainingCycles` null: every cycle. */
export interface ContractDiscount {
  discountId: number | null; title: string; code: string | null;
  valueType: 'PERCENTAGE' | 'FIXED_AMOUNT';
  /** Basis points for PERCENTAGE, minor units of the shop currency for FIXED_AMOUNT. */
  value: number;
  target: 'ORDER' | 'PRODUCTS' | 'SHIPPING';
  remainingCycles: number | null;
}
export type ContractAddress = Record<string, string | null>;

/** A customer's subscription: what to deliver, how often, and when to bill next. Money is in the shop currency. */
export const subscriptionContracts = pgTable('subscription_contracts', {
  id: pk(), shopId: shopFk(),
  customerId: ref('customer_id').references(() => customers.id, { onDelete: 'set null' }),
  status: text('status').notNull().default('ACTIVE'),
  currency: text('currency').notNull(),
  billingPolicy: jsonb('billing_policy').$type<PlanBillingPolicy>().notNull(),
  deliveryPolicy: jsonb('delivery_policy').$type<PlanDeliveryPolicy>().notNull(),
  nextBillingDate: ts('next_billing_date').notNull(),
  /** Order placed at checkout; renewal orders point back with `orders.subscription_contract_id`. */
  originOrderId: ref('origin_order_id').references(() => orders.id, { onDelete: 'set null' }),
  /** Payment method id used at checkout (`stripe`, `bank_transfer`, `cod`, `manual:<id>`...). */
  paymentGateway: text('payment_gateway').notNull(),
  /** Stripe references for off-session renewals (never card data: the card stays with Stripe). */
  stripeCustomerId: text('stripe_customer_id'), stripePaymentMethodId: text('stripe_payment_method_id'),
  deliveryAddress: jsonb('delivery_address').$type<ContractAddress | null>(),
  deliveryMethod: jsonb('delivery_method').$type<{ title: string; code: string | null } | null>(),
  deliveryPrice: money('delivery_price').notNull().default(0),
  discounts: jsonb('discounts').$type<ContractDiscount[]>().notNull().default([]),
  /** Billing cycles paid or ordered so far (the checkout order is cycle 1). */
  cyclesCompleted: integer('cycles_completed').notNull().default(1),
  /** Failed billing attempts in a row; the contract fails after the retry policy is exhausted. */
  failedAttempts: integer('failed_attempts').notNull().default(0),
  retryAt: ts('retry_at'),
  lastPaymentStatus: text('last_payment_status'),
  lastBillingErrorType: text('last_billing_error_type'),
  /** Billing date the "upcoming renewal" email was sent for (sent once per cycle). */
  upcomingNotifiedFor: ts('upcoming_notified_for'),
  note: text('note'),
  pausedAt: ts('paused_at'), cancelledAt: ts('cancelled_at'),
  ...timestamps(),
}, (t) => [
  index('subscription_contracts_shop_idx').on(t.shopId, t.status, t.nextBillingDate),
  index('subscription_contracts_customer_idx').on(t.shopId, t.customerId),
  index('subscription_contracts_origin_idx').on(t.originOrderId),
  check('subscription_contracts_status_chk', oneOf(t.status, SUBSCRIPTION_STATUSES)),
]);

export const subscriptionContractLines = pgTable('subscription_contract_lines', {
  id: pk(), shopId: shopFk(),
  contractId: ref('contract_id').notNull().references(() => subscriptionContracts.id, { onDelete: 'cascade' }),
  /** Plain ids: the contract keeps its lines when the product changes or goes away. */
  productId: ref('product_id'), variantId: ref('variant_id'),
  title: text('title').notNull(), variantTitle: text('variant_title'), sku: text('sku'), imageUrl: text('image_url'),
  quantity: integer('quantity').notNull(),
  sellingPlanId: ref('selling_plan_id'), sellingPlanName: text('selling_plan_name'),
  /** One-time unit price per delivery when subscribed, and the plan's pricing policies (snapshot): renewals price each cycle from them. */
  basePrice: money('base_price').notNull(),
  pricingPolicies: jsonb('pricing_policies').$type<PlanPricingPolicy[]>().notNull().default([]),
  deliveriesPerBilling: integer('deliveries_per_billing').notNull().default(1),
  /** Unit price charged per billing cycle at the current cycle. */
  currentPrice: money('current_price').notNull(),
  requiresShipping: boolean('requires_shipping').notNull().default(true),
  taxable: boolean('taxable').notNull().default(true),
  grams: integer('grams').notNull().default(0),
}, (t) => [index('subscription_contract_lines_contract_idx').on(t.contractId)]);

export const BILLING_ATTEMPT_STATUSES = ['PENDING', 'SUCCEEDED', 'FAILED'] as const;
/** One try to bill a cycle: the renewal order it created, or why it failed. */
export const subscriptionBillingAttempts = pgTable('subscription_billing_attempts', {
  id: pk(), shopId: shopFk(),
  contractId: ref('contract_id').notNull().references(() => subscriptionContracts.id, { onDelete: 'cascade' }),
  idempotencyKey: text('idempotency_key').notNull(),
  status: text('status').notNull().default('PENDING'),
  cycleIndex: integer('cycle_index').notNull(),
  billingDate: ts('billing_date').notNull(),
  orderId: ref('order_id'),
  paymentId: text('payment_id'),
  errorCode: text('error_code'), errorMessage: text('error_message'),
  createdAt: createdAt(),
  completedAt: ts('completed_at'),
}, (t) => [
  uniqueIndex('subscription_billing_attempts_key_uq').on(t.contractId, t.idempotencyKey),
  index('subscription_billing_attempts_contract_idx').on(t.contractId, t.createdAt),
  check('subscription_billing_attempts_status_chk', oneOf(t.status, BILLING_ATTEMPT_STATUSES)),
]);
