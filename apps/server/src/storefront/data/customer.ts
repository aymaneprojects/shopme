import { loadMetafields } from './metafields';
import { inArray } from 'drizzle-orm';
import { lazyList } from '@shopme/liquid-compat';
import { contractLinePrice, listContractLines, listSubscriptionContracts, customerStoreCreditBalance, storeCreditEnabled, countCustomerOrders, lineMoney, orderMoney, presentmentShare, listAddressBook, listCustomerOrders, schema as s, type Customer, type CustomerAddress, type Db, type Order, type OrderDetail, type Shop } from '@shopme/core';
import { countryName } from '../../checkout/geo';

/** Liquid `customer`, `customer.orders`, `order` and address objects. Money is integer minor units. */

const LABELS: Record<string, Record<string, string>> = {
  en: { paid: 'Paid', pending: 'Pending', authorized: 'Authorized', partially_paid: 'Partially paid', partially_refunded: 'Partially refunded', refunded: 'Refunded', voided: 'Voided', expired: 'Expired', unfulfilled: 'Unfulfilled', partial: 'Partially fulfilled', fulfilled: 'Fulfilled', restocked: 'Restocked', on_hold: 'On hold', customer: 'Customer changed their mind', fraud: 'Fraudulent order', inventory: 'Items not available', declined: 'Payment declined', other: 'Other' },
  fr: { paid: 'Payée', pending: 'En attente', authorized: 'Autorisée', partially_paid: 'Partiellement payée', partially_refunded: 'Partiellement remboursée', refunded: 'Remboursée', voided: 'Annulée', expired: 'Expirée', unfulfilled: 'Non expédiée', partial: 'Partiellement expédiée', fulfilled: 'Expédiée', restocked: 'Remise en stock', on_hold: 'En attente', customer: "Le client a changé d'avis", fraud: 'Commande frauduleuse', inventory: 'Articles indisponibles', declined: 'Paiement refusé', other: 'Autre' },
};
const label = (shop: Shop, key: string) => (LABELS[shop.locale.slice(0, 2)] ?? LABELS.en!)[key] ?? key;

export interface AddressObject {
  id: number; first_name: string; last_name: string; name: string; company: string; address1: string; address2: string; street: string; city: string; province: string; province_code: string;
  zip: string; country: string; country_code: string; country_name: string; phone: string; url: string; summary: string;
}

type AddressRow = Pick<CustomerAddress, 'id' | 'firstName' | 'lastName' | 'company' | 'address1' | 'address2' | 'city' | 'province' | 'provinceCode' | 'zip' | 'country' | 'countryCode' | 'phone'>;

export function addressObject(a: AddressRow, shop: Shop, url = ''): AddressObject {
  const countryCode = a.countryCode ?? '';
  const country = countryCode ? countryName(countryCode, shop.locale) : a.country ?? '';
  const name = [a.firstName, a.lastName].filter(Boolean).join(' ');
  return {
    id: a.id, first_name: a.firstName ?? '', last_name: a.lastName ?? '', name, company: a.company ?? '', address1: a.address1 ?? '', address2: a.address2 ?? '', street: [a.address1, a.address2].filter(Boolean).join(', '),
    city: a.city ?? '', province: a.province ?? a.provinceCode ?? '', province_code: a.provinceCode ?? '', zip: a.zip ?? '', country, country_code: countryCode, country_name: country, phone: a.phone ?? '', url,
    summary: [name, a.company, a.address1, a.address2, [a.zip, a.city].filter(Boolean).join(' '), country].filter(Boolean).join(', '),
  };
}

const STATUS_LOWER = (v: string) => v.toLowerCase();

export interface OrderObject {
  id: number; name: string; order_number: number; email: string | null; phone: string | null; currency: string; created_at: string; processed_at: string; customer_url: string;
  financial_status: string; financial_status_label: string; fulfillment_status: string; fulfillment_status_label: string; cancelled: boolean; cancelled_at: string | null; cancel_reason: string | null; cancel_reason_label: string | null;
  subtotal_price: number; total_price: number; total_discounts: number; shipping_price: number; tax_price: number; total_refunded_amount: number; taxes_included: boolean; note: string | null; tags: string[];
  line_items: unknown[]; shipping_address: AddressObject | null; billing_address: AddressObject | null; shipping_methods: { title: string; price: number }[];
  tax_lines: { title: string; price: number; rate: number; rate_percentage: number }[]; discount_applications: { title: string; total_allocated_amount: number; type: string }[]; fulfillments: unknown[];
}

const fulfillmentLabel = (o: Order) => (o.fulfillmentStatus === 'PARTIALLY_FULFILLED' ? 'partial' : STATUS_LOWER(o.fulfillmentStatus));

export function orderObject(o: Order, shop: Shop, d?: OrderDetail, handles: Map<number, string> = new Map()): OrderObject {
  const addr = (a: OrderDetail['shippingAddress']) => (a ? addressObject({ ...a, id: a.id }, shop) : null);
  const fs = fulfillmentLabel(o);
  const cancel = o.cancelReason ? STATUS_LOWER(o.cancelReason) : null;
  const fin = STATUS_LOWER(o.financialStatus);
  const om = orderMoney(o);
  return {
    id: o.id, name: o.name, order_number: o.orderNumber, email: o.email, phone: o.phone, currency: om.currency, created_at: o.processedAt.toISOString(), processed_at: o.processedAt.toISOString(),
    customer_url: `/account/orders/${o.id}`, financial_status: fin, financial_status_label: label(shop, fin), fulfillment_status: fs === 'unfulfilled' ? 'unfulfilled' : fs, fulfillment_status_label: label(shop, fs),
    cancelled: !!o.cancelledAt, cancelled_at: o.cancelledAt?.toISOString() ?? null, cancel_reason: cancel, cancel_reason_label: cancel ? label(shop, cancel) : null,
    subtotal_price: om.subtotal, total_price: om.total, total_discounts: om.discounts, shipping_price: om.shipping, tax_price: om.tax, total_refunded_amount: om.refunded, taxes_included: o.taxesIncluded, note: o.note, tags: o.tags,
    line_items: (d?.lines ?? []).map((l) => {
      const lm = lineMoney(o, l);
      const finalLine = lm.discountedTotal;
      const original = lm.unitPrice * l.quantity;
      return {
        id: l.id, title: l.title, product_title: l.title, variant_title: l.variantTitle, quantity: l.quantity, sku: l.sku ?? '', vendor: l.vendor ?? '', price: lm.unitPrice, original_price: lm.unitPrice,
        final_price: l.quantity ? Math.round(finalLine / l.quantity) : 0, line_price: finalLine, original_line_price: original, final_line_price: finalLine, total_discount: original - finalLine,
        url: l.productId && handles.has(l.productId) ? `/products/${handles.get(l.productId)}` : null, product_id: l.productId, variant_id: l.variantId, properties: l.properties, requires_shipping: l.requiresShipping,
        image: l.imageUrl ? { src: l.imageUrl, url: l.imageUrl, alt: l.title, width: null, height: null } : null,
        fulfillment: null, 'fulfillment_status': l.fulfilledQuantity >= l.quantity ? 'fulfilled' : l.fulfilledQuantity > 0 ? 'partial' : 'unfulfilled', gift_card: l.isGiftCard, line_level_discount_allocations: [],
        selling_plan_allocation: l.sellingPlanName ? { price: lm.unitPrice, selling_plan: { id: l.sellingPlanId, name: l.sellingPlanName } } : null,
      };
    }),
    shipping_address: addr(d?.shippingAddress ?? null), billing_address: addr(d?.billingAddress ?? null), shipping_methods: (d?.shippingLines ?? []).map((l, _i, all) => ({ title: l.title, price: all.length === 1 ? om.shipping : presentmentShare(o, l.price) })),
    tax_lines: (d?.taxLines ?? []).map((t) => ({ title: t.title, price: presentmentShare(o, t.price), rate: t.rate / 100, rate_percentage: t.rate })),
    discount_applications: (d?.discounts ?? []).map((a) => ({ title: a.title ?? a.code ?? '', total_allocated_amount: presentmentShare(o, a.allocatedAmount), type: a.code ? 'discount_code' : 'automatic' })),
    fulfillments: (d?.fulfillments ?? []).filter((f) => f.status === 'SUCCESS').map((f) => ({
      name: f.name, created_at: f.createdAt.toISOString(), tracking_company: f.trackingCompany ?? '', tracking_number: f.trackingNumbers[0] ?? '', tracking_numbers: f.trackingNumbers, tracking_url: f.trackingUrls[0] ?? '', tracking_urls: f.trackingUrls,
      item_count: f.lines.reduce((n, l) => n + l.quantity, 0),
    })),
  };
}

/** Handles and first-image URLs of the products on an order's lines (for `line_item.url` and `.image`). */
export async function productLookups(db: Db, lines: { productId: number | null }[]): Promise<{ handles: Map<number, string> }> {
  const ids = [...new Set(lines.flatMap((l) => (l.productId ? [l.productId] : [])))];
  const rows = ids.length ? await db.select({ id: s.products.id, handle: s.products.handle }).from(s.products).where(inArray(s.products.id, ids)) : [];
  return { handles: new Map(rows.map((r) => [r.id, r.handle])) };
}

export interface CustomerObject {
  id: number; email: string; first_name: string; last_name: string; name: string; phone: string; accepts_marketing: boolean; tags: string[]; tax_exempt: boolean; has_account: boolean;
  orders: OrderObject[]; orders_count: number; total_spent: number; last_order: OrderObject | null; addresses: AddressObject[]; addresses_count: number; default_address: AddressObject | null; new_address: AddressObject;
  created_at: string; metafields: Record<string, unknown>;
  email_marketing_state: string; sms_marketing_state: string; data_sale_opt_out: boolean;
  /** Store credit balance (minor units) in the shop currency; nil when the feature is off, there is no account or the balance is zero. */
  store_credit_account: { balance: number; currency: string } | null;
  /** ShopMe: the customer's subscriptions (newest first), with the actions they can take from the account page. */
  subscription_contracts: SubscriptionObject[];
}

export interface SubscriptionObject {
  id: number; name: string; status: string; currency: string; created_at: string; next_billing_date: string | null;
  billing_interval: string; billing_interval_count: number; delivery_interval: string; delivery_interval_count: number;
  lines: { title: string; variant_title: string | null; quantity: number; price: number; line_price: number; selling_plan_name: string | null; image: string | null }[];
  subtotal: number; delivery_price: number; total: number;
  can_pause: boolean; can_resume: boolean; can_cancel: boolean; can_skip: boolean;
  pause_url: string; resume_url: string; cancel_url: string; skip_url: string;
}

/** Liquid `customer.subscription_contracts`. Amounts are the next billing's, in the shop currency. */
export async function subscriptionObjects(db: Db, shop: Shop, customerId: number): Promise<SubscriptionObject[]> {
  const contracts = await listSubscriptionContracts(db, shop.id, { customerId, reverse: true, offset: 0, limit: 50 });
  const lines = await listContractLines(db, shop.id, contracts.map((c) => c.id));
  return contracts.map((c) => {
    const cycle = c.cyclesCompleted + 1;
    const own = lines.filter((l) => l.contractId === c.id).map((l) => {
      const price = contractLinePrice(l.basePrice, l.pricingPolicies, l.deliveriesPerBilling, cycle);
      return { title: l.title, variant_title: l.variantTitle, quantity: l.quantity, price, line_price: price * l.quantity, selling_plan_name: l.sellingPlanName, image: l.imageUrl };
    });
    const subtotal = own.reduce((n, l) => n + l.line_price, 0);
    const ended = c.status === 'CANCELLED' || c.status === 'EXPIRED';
    const base = `/account/subscriptions/${c.id}`;
    return {
      id: c.id, name: `#${c.id}`, status: c.status.toLowerCase(), currency: c.currency, created_at: c.createdAt.toISOString(), next_billing_date: ended ? null : c.nextBillingDate.toISOString(),
      billing_interval: c.billingPolicy.interval.toLowerCase(), billing_interval_count: c.billingPolicy.intervalCount, delivery_interval: c.deliveryPolicy.interval.toLowerCase(), delivery_interval_count: c.deliveryPolicy.intervalCount,
      lines: own, subtotal, delivery_price: c.deliveryPrice, total: subtotal + c.deliveryPrice,
      can_pause: c.status === 'ACTIVE', can_resume: c.status === 'PAUSED', can_cancel: !ended && (c.billingPolicy.minCycles == null || c.cyclesCompleted >= c.billingPolicy.minCycles), can_skip: c.status === 'ACTIVE',
      pause_url: `${base}/pause`, resume_url: `${base}/resume`, cancel_url: `${base}/cancel`, skip_url: `${base}/skip`,
    };
  });
}

const ORDER_PREVIEW = 20;

/** The signed-in customer as Liquid sees it. `orders` carry list-level data only (no lines); the order page loads the full detail. */
export async function buildCustomer(db: Db, shop: Shop, c: Customer): Promise<CustomerObject> {
  const [addrRows, total, mf, credit, subscriptions] = await Promise.all([
    listAddressBook(db, shop.id, c.id), countCustomerOrders(db, shop.id, c.id), loadMetafields(db, shop.id, 'CUSTOMER', [c.id]),
    storeCreditEnabled(shop) ? customerStoreCreditBalance(db, shop.id, c.id, shop.currency) : Promise.resolve(0),
    subscriptionObjects(db, shop, c.id),
  ]);
  const addresses = addrRows.map((a) => addressObject(a, shop, `/account/addresses/${a.id}`));
  const load = async (offset: number, limit: number) => (await listCustomerOrders(db, shop.id, c.id, { offset, limit })).map((o) => orderObject(o, shop));
  const orders = await load(0, ORDER_PREVIEW);
  return {
    id: c.id, email: c.email ?? '', first_name: c.firstName ?? '', last_name: c.lastName ?? '', name: [c.firstName, c.lastName].filter(Boolean).join(' ') || (c.email ?? ''), phone: c.phone ?? '',
    accepts_marketing: c.acceptsMarketing, tags: c.tags, tax_exempt: c.taxExempt, has_account: !!c.passwordHash,
    orders: lazyList(orders, total, load) as OrderObject[], orders_count: total, total_spent: c.amountSpent, last_order: orders[0] ?? null,
    addresses, addresses_count: addresses.length, default_address: addresses.find((a) => a.id === c.defaultAddressId) ?? addresses[0] ?? null,
    new_address: addressObject({ id: 0, firstName: c.firstName, lastName: c.lastName, company: null, address1: null, address2: null, city: null, province: null, provinceCode: null, zip: null, country: null, countryCode: null, phone: null }, shop),
    created_at: c.createdAt.toISOString(), metafields: mf.get(c.id) ?? {},
    email_marketing_state: c.emailMarketingState.toLowerCase(), sms_marketing_state: c.smsMarketingState.toLowerCase(), data_sale_opt_out: c.dataSaleOptOut,
    store_credit_account: credit > 0 ? { balance: credit, currency: shop.currency } : null,
    subscription_contracts: subscriptions,
  };
}
