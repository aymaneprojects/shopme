import { customerAccountsSettingsOf, type Shop } from '@shopme/core';
import { countryName } from '../../checkout/geo';
import type { AddressObject, CustomerObject, OrderObject } from './customer';

/**
 * Sample customer for the theme editor: the signed-in account pages (account, order, addresses) are previewed with this made-up
 * customer, never with a real one. Texts follow the shop language; money is in the shop currency (minor units).
 */

const T = {
  en: { first: 'Sam', last: 'Sample', street: '12 Sample Street', city: 'Springfield', item1: 'Sample item', item2: 'Another sample item', variant: 'Medium', shipping: 'Standard shipping', carrier: 'Sample carrier', paid: 'Paid', fulfilled: 'Fulfilled', unfulfilled: 'Unfulfilled', pending: 'Pending' },
  fr: { first: 'Camille', last: 'Exemple', street: '12 rue de l’Exemple', city: 'Villeneuve', item1: 'Article d’exemple', item2: 'Autre article d’exemple', variant: 'Moyen', shipping: 'Livraison standard', carrier: 'Transporteur d’exemple', paid: 'Payée', fulfilled: 'Expédiée', unfulfilled: 'Non expédiée', pending: 'En attente' },
};
const textOf = (shop: Shop) => (shop.locale.toLowerCase().startsWith('fr') ? T.fr : T.en);

function sampleAddress(shop: Shop, id: number, street: string): AddressObject {
  const t = textOf(shop);
  const code = shop.country || 'US';
  const country = countryName(code, shop.locale);
  const name = `${t.first} ${t.last}`;
  return {
    id, first_name: t.first, last_name: t.last, name, company: '', address1: street, address2: '', street, city: t.city, province: '', province_code: '', zip: '10001', country, country_code: code, country_name: country,
    phone: '', url: id ? `/account/addresses/${id}` : '', summary: [name, street, `10001 ${t.city}`, country].join(', '),
  };
}

const daysAgo = (n: number) => new Date(Date.now() - n * 86400_000).toISOString();

function sampleOrderObject(shop: Shop, n: number, o: { days: number; fulfilled: boolean; paid: boolean; lines: boolean }): OrderObject {
  const t = textOf(shop);
  const addr = sampleAddress(shop, 0, t.street);
  const lines = [
    { id: 1, title: t.item1, variant: t.variant, sku: 'SAMPLE-1', price: 2490, qty: 1 },
    { id: 2, title: t.item2, variant: null, sku: 'SAMPLE-2', price: 1250, qty: 2 },
  ];
  const subtotal = lines.reduce((s, l) => s + l.price * l.qty, 0);
  const shipping = 590;
  const name = `#${1000 + n}`;
  return {
    id: 0, name, order_number: 1000 + n, email: 'sample@example.com', phone: null, currency: shop.currency, created_at: daysAgo(o.days), processed_at: daysAgo(o.days), customer_url: '/account/orders/sample',
    financial_status: o.paid ? 'paid' : 'pending', financial_status_label: o.paid ? t.paid : t.pending, fulfillment_status: o.fulfilled ? 'fulfilled' : 'unfulfilled', fulfillment_status_label: o.fulfilled ? t.fulfilled : t.unfulfilled,
    cancelled: false, cancelled_at: null, cancel_reason: null, cancel_reason_label: null,
    subtotal_price: subtotal, total_price: subtotal + shipping, total_discounts: 0, shipping_price: shipping, tax_price: 0, total_refunded_amount: 0, taxes_included: true, note: null, tags: [],
    line_items: o.lines ? lines.map((l) => ({
      id: l.id, title: l.title, product_title: l.title, variant_title: l.variant, quantity: l.qty, sku: l.sku, vendor: shop.name, price: l.price, original_price: l.price, final_price: l.price,
      line_price: l.price * l.qty, original_line_price: l.price * l.qty, final_line_price: l.price * l.qty, total_discount: 0, url: null, product_id: null, variant_id: null, properties: {}, requires_shipping: true,
      image: null, fulfillment: null, fulfillment_status: o.fulfilled ? 'fulfilled' : 'unfulfilled', gift_card: false, line_level_discount_allocations: [],
    })) : [],
    shipping_address: addr, billing_address: addr, shipping_methods: [{ title: t.shipping, price: shipping }], tax_lines: [], discount_applications: [],
    fulfillments: o.fulfilled ? [{ name: `${name}.1`, created_at: daysAgo(Math.max(0, o.days - 1)), tracking_company: t.carrier, tracking_number: 'SAMPLE0000000', tracking_numbers: ['SAMPLE0000000'], tracking_url: '', tracking_urls: [], item_count: 3 }] : [],
  };
}

/** The sample `customer` object (three orders, two addresses, store credit when the store offers it). */
export function sampleCustomer(shop: Shop): CustomerObject {
  const t = textOf(shop);
  const orders = [sampleOrderObject(shop, 3, { days: 2, fulfilled: false, paid: true, lines: false }), sampleOrderObject(shop, 2, { days: 12, fulfilled: true, paid: true, lines: false }), sampleOrderObject(shop, 1, { days: 40, fulfilled: true, paid: true, lines: false })];
  const addresses = [sampleAddress(shop, 1, t.street), sampleAddress(shop, 2, t.street.replace('12', '48'))];
  return {
    id: 0, email: 'sample@example.com', first_name: t.first, last_name: t.last, name: `${t.first} ${t.last}`, phone: '', accepts_marketing: false, tags: [], tax_exempt: false, has_account: true,
    orders, orders_count: orders.length, total_spent: orders.reduce((s, o) => s + o.total_price, 0), last_order: orders[0]!, addresses, addresses_count: addresses.length, default_address: addresses[0]!,
    new_address: { ...sampleAddress(shop, 0, ''), address1: '', street: '', city: '', zip: '', summary: '' },
    created_at: daysAgo(90), metafields: {}, email_marketing_state: 'not_subscribed', sms_marketing_state: 'not_subscribed', data_sale_opt_out: false,
    store_credit_account: customerAccountsSettingsOf(shop).storeCredit ? { balance: 1500, currency: shop.currency } : null,
  };
}

/** The sample `order` of the order page, with the order actions the store's settings allow (their buttons do nothing in the preview). */
export function sampleOrder(shop: Shop) {
  const s = customerAccountsSettingsOf(shop).orderActions;
  const order = sampleOrderObject(shop, 2, { days: 12, fulfilled: true, paid: true, lines: true });
  return {
    ...order,
    actions: {
      reorder: s.reorder, cancel: false, return: s.returns, cancel_until: null, reorder_url: '#', cancel_url: '#', return_url: '#',
      return_lines: s.returns ? (order.line_items as Array<{ id: number; title: string; variant_title: string | null; quantity: number }>).map((l) => ({ id: l.id, title: l.title, variant_title: l.variant_title ?? '', max: l.quantity })) : [],
    },
  };
}
