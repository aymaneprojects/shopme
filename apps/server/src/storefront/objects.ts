import type { CartView, Shop } from '@shopme/core';
import { ajaxLine } from './cart-format';
import { policiesOf } from './data/content';

export const currencySymbol = (currency: string, locale = 'en'): string => {
  try { return new Intl.NumberFormat(locale, { style: 'currency', currency, currencyDisplay: 'narrowSymbol' }).formatToParts(0).find((p) => p.type === 'currency')?.value ?? currency; } catch { return currency; }
};

const currencyObject = (iso: string, locale: string) => ({ iso_code: iso, name: iso, symbol: currencySymbol(iso, locale) });

export function shopObject(shop: Shop, origin: string, counts: { products: number; collections: number }) {
  const settings = shop.settings as Record<string, unknown>;
  const policies = policiesOf(settings);
  const policy = (h: string) => policies.find((p) => p.handle === h) ?? null;
  return {
    id: shop.id, name: shop.name, email: shop.email, description: String(settings.description ?? ''), currency: shop.currency, money_format: shop.moneyFormat,
    money_with_currency_format: shop.moneyWithCurrencyFormat, taxes_included: shop.taxesIncluded, url: origin, secure_url: origin, domain: new URL(origin).host, permanent_domain: new URL(origin).host,
    address: { country: shop.country, country_code: shop.country, ...(settings.address as object | undefined) }, locale: shop.locale, timezone: shop.timezone, weight_unit: ({ KILOGRAMS: 'kg', GRAMS: 'g', POUNDS: 'lb', OUNCES: 'oz' } as Record<string, string>)[shop.weightUnit] ?? 'kg',
    enabled_currencies: [currencyObject(shop.currency, shop.locale)], customer_accounts_enabled: false, customer_accounts_optional: false,
    password_message: String(settings.passwordMessage ?? ''), policies, refund_policy: policy('refund-policy'), privacy_policy: policy('privacy-policy'), shipping_policy: policy('shipping-policy'), terms_of_service: policy('terms-of-service'),
    features: {}, metafields: {}, products_count: counts.products, collections_count: counts.collections, brand: { logo: null, slogan: null, short_description: null, colors: {} },
  };
}

export const routesObject = () => ({
  root_url: '/', account_url: '/account', account_login_url: '/account/login', account_logout_url: '/account/logout', account_register_url: '/account/register', account_addresses_url: '/account/addresses',
  collections_url: '/collections', all_products_collection_url: '/collections/all', search_url: '/search', predictive_search_url: '/search/suggest', cart_url: '/cart', cart_add_url: '/cart/add',
  cart_change_url: '/cart/change', cart_clear_url: '/cart/clear', cart_update_url: '/cart/update', product_recommendations_url: '/recommendations/products', storefront_login_url: '/account/login',
});

export function localizationObject(shop: Shop) {
  const country = { iso_code: shop.country, name: shop.country, currency: currencyObject(shop.currency, shop.locale), market: { handle: 'default', id: 1 }, unit_system: 'metric' };
  const language = { iso_code: shop.locale, name: shop.locale, endonym_name: shop.locale, primary: true, root_url: '/' };
  return { country, language, available_countries: [country], available_languages: [language], market: { handle: 'default', id: 1 } };
}

export function requestObject(shop: Shop, origin: string, path: string, pageType: string) {
  const host = new URL(origin).host;
  return {
    host, origin, path, page_type: pageType, design_mode: false, visual_preview_mode: false, locale: { iso_code: shop.locale, name: shop.locale, endonym_name: shop.locale, primary: true, root_url: '/', direction: 'ltr' },
  };
}

/** Liquid `cart`: the Ajax shape plus drops themes expect (image object, product, variant, url_to_remove). */
export function liquidCart(cart: CartView | null, shop: Shop) {
  const currency = cart?.currency ?? shop.currency;
  const lines = (cart?.lines ?? []).map((l, i) => {
    const a = ajaxLine(l, currency);
    const image = l.image ? { src: l.image.url, url: l.image.url, alt: l.image.alt ?? l.product.title, width: l.image.width, height: l.image.height, aspect_ratio: l.image.width && l.image.height ? l.image.width / l.image.height : 1 } : null;
    const product = { id: l.productId, title: l.product.title, handle: l.product.handle, url: `/products/${l.product.handle}`, vendor: l.product.vendor, type: l.product.productType, featured_image: image, has_only_default_variant: l.hasOnlyDefaultVariant, gift_card: l.product.isGiftCard };
    const variant = { id: l.variantId, title: l.variantTitle, sku: l.sku, price: l.price, url: a.url, available: true, options: a.variant_options, image, featured_image: image, product_id: l.productId };
    return { ...a, image, featured_image: image, index: i + 1, index0: i, product, variant, url_to_remove: `/cart/change?line=${i + 1}&quantity=0`, selling_plan_allocation: null, unit_price_measurement: null, quantity_rule: { min: 1, max: null, increment: 1 }, 'discounts?': false, message: '' };
  });
  const total = lines.reduce((n, i) => n + i.final_line_price, 0);
  return {
    token: cart?.token ?? '', note: cart?.note ?? null, attributes: cart?.attributes ?? {}, item_count: lines.reduce((n, i) => n + i.quantity, 0), items: lines, empty: lines.length === 0,
    items_subtotal_price: total, total_price: total, original_total_price: total, total_discount: 0, total_weight: lines.reduce((n, i) => n + i.grams * i.quantity, 0),
    requires_shipping: lines.some((i) => i.requires_shipping), currency: currencyObject(currency, shop.locale), taxes_included: shop.taxesIncluded, duties_included: false,
    cart_level_discount_applications: [], discount_applications: [], checkout_charge_amount: total,
  };
}

/** A map object whose per-key values are loaded on first access (LiquidJS awaits promise-valued properties). */
export function lazyMap<T>(keys: string[] | true, load: (key: string) => Promise<T>, base: object = {}): any {
  const cache = new Map<string, Promise<T>>();
  const known = keys === true ? { has: (k: string) => !k.startsWith('__') && k !== 'then' } : new Set(keys);
  const get = (k: string) => { let p = cache.get(k); if (!p) { p = load(k); cache.set(k, p); } return p; };
  return new Proxy(base, {
    get: (t, k, r) => (typeof k === 'string' && known.has(k) && !(k in t) ? get(k) : Reflect.get(t, k, r)),
    has: (t, k) => (typeof k === 'string' && known.has(k)) || Reflect.has(t, k),
    getOwnPropertyDescriptor: (t, k) => (typeof k === 'string' && known.has(k) && !(k in t) ? { configurable: true, enumerable: false, writable: false, value: get(k) } : Reflect.getOwnPropertyDescriptor(t, k)),
  });
}
