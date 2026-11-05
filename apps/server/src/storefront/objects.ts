import { currencyName, customerAccountsSettingsOf, type BuyerCountry, type CartDiscounts, type CartView, type MarketContext, type Shop } from '@shopme/core';
import { ajaxLine, cartLevelApplications, discountApplication } from './cart-format';
import { policiesOf } from './data/content';

export const currencySymbol = (currency: string, locale = 'en'): string => {
  try { return new Intl.NumberFormat(locale, { style: 'currency', currency, currencyDisplay: 'narrowSymbol' }).formatToParts(0).find((p) => p.type === 'currency')?.value ?? currency; } catch { return currency; }
};

const currencyObject = (iso: string, locale: string) => ({ iso_code: iso, name: currencyName(iso, locale), symbol: currencySymbol(iso, locale) });

export function shopObject(shop: Shop, origin: string, counts: { products: number; collections: number }, currencies: string[] = [shop.currency]) {
  const settings = shop.settings as Record<string, unknown>;
  const policies = policiesOf(settings);
  const policy = (h: string) => policies.find((p) => p.handle === h) ?? null;
  return {
    id: shop.id, name: shop.name, email: shop.email, description: String(settings.description ?? ''), currency: shop.currency, money_format: shop.moneyFormat,
    money_with_currency_format: shop.moneyWithCurrencyFormat, taxes_included: shop.taxesIncluded, url: origin, secure_url: origin, domain: new URL(origin).host, permanent_domain: new URL(origin).host,
    address: { country: shop.country, country_code: shop.country, ...(settings.address as object | undefined) }, locale: shop.locale, timezone: shop.timezone, weight_unit: ({ KILOGRAMS: 'kg', GRAMS: 'g', POUNDS: 'lb', OUNCES: 'oz' } as Record<string, string>)[shop.weightUnit] ?? 'kg',
    enabled_currencies: currencies.map((c) => currencyObject(c, shop.locale)), customer_accounts_enabled: customerAccountsSettingsOf(shop).mode !== 'DISABLED', customer_accounts_optional: customerAccountsSettingsOf(shop).mode === 'OPTIONAL',
    password_message: String(settings.passwordMessage ?? ''), policies, refund_policy: policy('refund-policy'), privacy_policy: policy('privacy-policy'), shipping_policy: policy('shipping-policy'), terms_of_service: policy('terms-of-service'),
    terms_of_sale: policy('terms-of-sale'), legal_notice: policy('legal-notice'), subscription_policy: policy('subscription-policy'),
    features: {}, metafields: {}, products_count: counts.products, collections_count: counts.collections, brand: { logo: null, slogan: null, short_description: null, colors: {} },
  };
}

/** Theme routes; with a locale prefix (`/fr`) every URL carries it, as in Shopify's localized storefronts. */
export const routesObject = (prefix = '', shop?: Pick<Shop, 'settings'>) => {
  const acc = shop ? customerAccountsSettingsOf(shop) : null;
  // Sign-in links are present only while accounts exist and the merchant shows the links; the pages themselves keep working.
  const links = !acc || (acc.mode !== 'DISABLED' && acc.loginLinksVisible);
  const r = {
    root_url: '/', account_url: acc?.url ?? '/account', account_login_url: links ? '/account/login' : '', account_logout_url: '/account/logout', account_register_url: links ? '/account/register' : '', account_addresses_url: '/account/addresses',
    collections_url: '/collections', all_products_collection_url: '/collections/all', search_url: '/search', predictive_search_url: '/search/suggest', cart_url: '/cart', cart_add_url: '/cart/add',
    cart_change_url: '/cart/change', cart_clear_url: '/cart/clear', cart_update_url: '/cart/update', product_recommendations_url: '/recommendations/products', storefront_login_url: links ? '/account/login' : '',
    localization_url: '/localization',
  };
  return prefix ? Object.fromEntries(Object.entries(r).map(([k, v]) => [k, k === 'root_url' ? prefix : k === 'localization_url' || !v || /^https?:/.test(v) ? v : prefix + v])) : r;
};

export interface LanguageView { locale: string; name: string; primary: boolean; prefix: string }

const countryDisplay = (code: string, locale: string): string => { try { return new Intl.DisplayNames([locale, 'en'], { type: 'region' }).of(code) ?? code; } catch { return code; } };

const endonym = (code: string): string => {
  try { const n = new Intl.DisplayNames([code], { type: 'language' }).of(code); if (n) return n.charAt(0).toLocaleUpperCase(code) + n.slice(1); } catch { /* fall through */ }
  return code;
};

/** Liquid `localization`: the published languages (`url` is the same page in that language, for hreflang) and the current one. */
export function localizationObject(shop: Shop, current: string, languages: LanguageView[], origin: string, path: string, market?: MarketContext, countries: BuyerCountry[] = []) {
  const countryObject = (code: string, name: string, currency: string, m: { handle: string; id: number }) => ({ iso_code: code, name, currency: currencyObject(currency, shop.locale), market: m, unit_system: 'metric', popular_languages: [] });
  const marketOf = { handle: market?.marketHandle ?? 'primary', id: market?.marketId ?? 0 };
  const available = countries.length ? countries.map((c) => countryObject(c.code, c.name, c.currency, { handle: c.marketHandle, id: c.marketId ?? 0 })) : [countryObject(shop.country, countryDisplay(shop.country, shop.locale), shop.currency, marketOf)];
  const country = available.find((c) => c.iso_code === (market?.countryCode ?? shop.country)) ?? countryObject(market?.countryCode ?? shop.country, countryDisplay(market?.countryCode ?? shop.country, shop.locale), market?.currency ?? shop.currency, marketOf);
  const lang = (l: LanguageView) => ({ iso_code: l.locale, name: l.name, endonym_name: endonym(l.locale), primary: l.primary, root_url: l.prefix || '/', url: origin + l.prefix + (path === '/' && l.prefix ? '' : path) });
  const all = languages.length ? languages.map(lang) : [lang({ locale: shop.locale, name: shop.locale, primary: true, prefix: '' })];
  const language = all.find((l) => l.iso_code === current) ?? all[0]!;
  return { country, language, available_countries: available, available_languages: all, market: marketOf };
}

export function requestObject(shop: Shop, origin: string, path: string, pageType: string, locale = shop.locale, prefix = '') {
  const host = new URL(origin).host;
  return {
    host, origin, path, page_type: pageType, design_mode: false, visual_preview_mode: false,
    locale: { iso_code: locale, name: locale, endonym_name: endonym(locale), primary: locale === shop.locale, root_url: prefix || '/', direction: 'ltr' },
  };
}

/** Liquid `cart`: the Ajax shape plus drops themes expect (image object, product, variant, url_to_remove) and the discount applications. */
export function liquidCart(cart: CartView | null, shop: Shop, d: CartDiscounts | null = null, fallbackCurrency = shop.currency) {
  const currency = cart?.currency ?? fallbackCurrency;
  const token = cart?.token ?? '';
  const lines = (cart?.lines ?? []).map((l, i) => {
    const a = ajaxLine(l, currency, d, token);
    const image = l.image ? { src: l.image.url, url: l.image.url, alt: l.image.alt ?? l.product.title, width: l.image.width, height: l.image.height, aspect_ratio: l.image.width && l.image.height ? l.image.width / l.image.height : 1 } : null;
    const product = { id: l.productId, title: l.product.title, handle: l.product.handle, url: `/products/${l.product.handle}`, vendor: l.product.vendor, type: l.product.productType, featured_image: image, has_only_default_variant: l.hasOnlyDefaultVariant, gift_card: l.product.isGiftCard };
    const variant = { id: l.variantId, title: l.variantTitle, sku: l.sku, price: l.price, url: a.url, available: true, options: a.variant_options, image, featured_image: image, product_id: l.productId };
    return { ...a, image, featured_image: image, index: i + 1, index0: i, product, variant, url_to_remove: `/cart/change?line=${i + 1}&quantity=0`, selling_plan_allocation: null, unit_price_measurement: null, quantity_rule: { min: 1, max: null, increment: 1 }, 'discounts?': a.discounts.length > 0, message: '' };
  });
  const subtotal = lines.reduce((n, i) => n + i.final_line_price, 0);
  const original = lines.reduce((n, i) => n + i.original_line_price, 0);
  const cartLevel = cart ? cartLevelApplications(cart, d) : [];
  const total = subtotal - cartLevel.reduce((n, a) => n + a.total_allocated_amount, 0);
  const applications = cart ? (d?.applications ?? []).map((a) => discountApplication(a, cart, a.allocated)) : [];
  return {
    token: cart?.token ?? '', note: cart?.note ?? null, attributes: cart?.attributes ?? {}, item_count: lines.reduce((n, i) => n + i.quantity, 0), items: lines, empty: lines.length === 0,
    items_subtotal_price: subtotal, total_price: total, original_total_price: original, total_discount: original - total, total_weight: lines.reduce((n, i) => n + i.grams * i.quantity, 0),
    requires_shipping: lines.some((i) => i.requires_shipping), currency: currencyObject(currency, shop.locale), taxes_included: shop.taxesIncluded, duties_included: false,
    cart_level_discount_applications: cartLevel, discount_applications: applications, checkout_charge_amount: total,
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
