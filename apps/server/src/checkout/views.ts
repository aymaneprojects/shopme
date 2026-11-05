import type { PaymentProvider } from '@shopme/payments';
import { configOf, frequencyLabel, lineMoney, moneyFormatsFor, orderMoney, policyForCycle, sortedPolicies, type CartSellingPlan, type CheckoutAddressInput, type CheckoutView, type DiscountRejection, type GiftCardRejection, type OrderSummary, type Shop } from '@shopme/core';
import { renderMoneyFormat } from '@shopme/shopify-compat';
import { countryOptions, PROVINCES } from './geo';
import { translator, type T } from './i18n';

export const esc = (v: unknown): string => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const attr = (v: unknown) => esc(v);

export interface PageCtx { shop: Shop; t: T; lang: string; money: (n: number) => string; /** Markup for the `<head>`: consent runtime and customer events configuration. */ head?: string }

export function pageCtx(shop: Shop, currency = shop.currency): PageCtx {
  const { t, lang } = translator(shop.locale);
  const f = moneyFormatsFor(shop, currency);
  return { shop, t, lang, money: (n) => renderMoneyFormat(f.format, n, currency) };
}

/** The same page context formatting money in the currency of a checkout or order (the buyer's presentment currency). */
export const inCurrency = (c: PageCtx, currency: string): PageCtx => (currency === c.shop.currency ? c : { ...c, money: pageCtx(c.shop, currency).money });

/** Checkout branding of Settings > Checkout: accent and background colours, logo, button shape, header and footer text. */
function brandingOf(c: PageCtx) {
  const b = configOf(c.shop, 'CHECKOUT').branding;
  const radius = b.buttonShape === 'pill' ? '999px' : b.buttonShape === 'square' ? '2px' : '8px';
  const css = [
    b.accentColor ? `--primary:${b.accentColor};--primary-dark:${b.accentColor};` : '', b.backgroundColor ? `--bg:${b.backgroundColor};` : '',
  ].join('');
  const style = `<style>:root{${css}}.btn{border-radius:${radius}}</style>`;
  const logo = /^https?:\/\//.test(b.logoUrl) || b.logoUrl.startsWith('/') ? `<img src="${attr(b.logoUrl)}" alt="${attr(c.shop.name)}" style="max-height:40px;vertical-align:middle">` : '';
  return { style, logo, headerText: b.headerText, footerText: b.footerText };
}

function layout(c: PageCtx, title: string, body: string, opts: { script?: boolean } = {}): string {
  const brand = brandingOf(c);
  return `<!doctype html><html lang="${c.lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>${esc(title)} - ${esc(c.shop.name)}</title><link rel="stylesheet" href="/checkout-assets/checkout.css">${brand.style}${c.head ?? ''}</head>
<body><a class="skip" href="#main">${esc(c.t('title'))}</a><header class="co-header"><a href="/">${brand.logo || esc(c.shop.name)}</a>${brand.headerText ? `<span class="note" style="margin-left:12px">${esc(brand.headerText)}</span>` : ''}</header>${body}${brand.footerText ? `<footer class="note" style="text-align:center;padding:16px">${esc(brand.footerText)}</footer>` : ''}${opts.script ? '<script src="/checkout-assets/checkout.js" defer></script>' : ''}</body></html>`;
}

export function notFoundPage(c: PageCtx): string {
  return layout(c, c.t('notFound'), `<main id="main" class="ty"><h1>${esc(c.t('notFound'))}</h1><p>${esc(c.t('notFoundText'))}</p><p><a href="/">${esc(c.t('continueShopping'))}</a></p></main>`);
}

// --- fragments (also returned as JSON by the live refresh) -----------------------------------------------------------

/** "Estimated delivery Nov 12 - Nov 15": today plus the transit days, in the shop language. */
function eta(c: { t: PageCtx['t']; shop: { locale: string } }, transit: { min: number; max: number } | null | undefined): string | null {
  if (!transit) return null;
  const fmt = new Intl.DateTimeFormat(c.shop.locale, { month: 'short', day: 'numeric' });
  const at = (days: number) => fmt.format(new Date(Date.now() + days * 86_400_000));
  const range = transit.min === transit.max ? at(transit.min) : `${at(transit.min)} - ${at(transit.max)}`;
  return c.t('estDelivery', { range });
}

export function shippingFragment(c0: PageCtx, v: CheckoutView): string {
  const c = inCurrency(c0, v.currency);
  if (!v.address?.countryCode) return `<p class="note">${esc(c.t('shippingEnter'))}</p>`;
  if (!v.shippingOptions.length) return `<p class="note">${esc(c.t('shippingNone'))}</p>`;
  return `<div class="options" role="radiogroup">${v.shippingOptions.map((o) =>
    `<label class="option"><input type="radio" name="shippingRateId" value="${o.id}"${o.id === v.shippingRateId ? ' checked' : ''}><span class="grow">${esc(o.name)}${[o.detail, eta(c, o.transit)].filter(Boolean).map((d) => `<small class="note" style="display:block">${esc(d!)}</small>`).join('')}</span><span class="price">${o.price ? esc(c.money(o.price)) : esc(c.t('free'))}</span></label>`).join('')}</div>`;
}

/** Unit price of the next billings of a subscription line (the plan's price from cycle 2, in the checkout currency). */
const recurringUnit = (sp: CartSellingPlan): number => {
  const sorted = sortedPolicies(sp.pricingPolicies);
  const at = policyForCycle(sorted, 2);
  return at ? sp.priceAdjustments[sorted.indexOf(at)]?.price ?? sp.price : sp.compareAtPrice;
};

export function summaryFragment(c0: PageCtx, v: CheckoutView): string {
  const c = inCurrency(c0, v.currency);
  const p = v.pricing;
  const lines = v.lines.map((l) => {
    const pl = p.lines.find((x) => x.id === l.lineId)!;
    const title = [l.product.title, l.hasOnlyDefaultVariant ? '' : l.variantTitle].filter(Boolean);
    const sp = l.sellingPlan;
    const plan = sp ? `<small class="plan">${esc(sp.name)}</small><small class="recurring">${esc(c.t('recurring', { price: c.money(recurringUnit(sp) * l.quantity), frequency: frequencyLabel(c.lang, sp.billingPolicy) }))}</small>` : '';
    return `<li class="line"><div class="thumb">${l.image ? `<img src="${attr(l.image.url)}" alt="" width="64" height="64">` : ''}<span class="qty" aria-label="${esc(c.t('qty'))}">${l.quantity}</span></div>`
      + `<div class="grow">${esc(title[0])}${title[1] ? `<small>${esc(title[1])}</small>` : ''}${plan}</div><div>${esc(c.money(pl.total))}</div></li>`;
  }).join('');
  const subscribing = v.lines.some((l) => l.sellingPlan);
  const tags = v.appliedDiscounts.filter((d) => d.code).map((d) => `<span class="tag">${esc(d.code)}<button type="button" data-discount-remove="${attr(d.code)}" aria-label="${esc(c.t('remove'))} ${attr(d.code)}">&times;</button></span>`).join('');
  const shippingValue = !v.requiresShipping ? '' : p.shipping ? (p.totalShipping ? esc(c.money(p.totalShipping)) : esc(c.t('free'))) : esc(c.t('shippingTbd'));
  const giftTags = v.giftCards.map((g) => `<span class="tag">${esc(c.t('giftCard'))} &bull;&bull;${esc(g.lastCharacters)}<button type="button" data-gift-remove="${attr(g.code)}" aria-label="${esc(c.t('remove'))} ${attr(g.lastCharacters)}">&times;</button></span>`).join('');
  const credit = v.storeCredit.applied;
  return `<ul class="lines">${lines}</ul>${subscribing ? `<p class="note subscription-note">${esc(c.t('subscriptionNote'))}</p>` : ''}${tags || giftTags ? `<div>${tags}${giftTags}</div>` : ''}<dl class="totals">`
    + `<div><dt>${esc(c.t('subtotal'))}</dt><dd>${esc(c.money(p.subtotal))}</dd></div>`
    + (p.totalDiscounts ? `<div><dt>${esc(c.t('discount'))}</dt><dd>-${esc(c.money(p.totalDiscounts))}</dd></div>` : '')
    + (v.requiresShipping ? `<div><dt>${esc(c.t('shipping'))}</dt><dd>${shippingValue}</dd></div>` : '')
    + (p.totalTax && !v.taxesIncluded ? `<div><dt>${esc(c.t('taxes'))}</dt><dd>${esc(c.money(p.totalTax))}</dd></div>` : '')
    + (v.tip ? `<div><dt>${esc(c.t('tipLine'))}</dt><dd>${esc(c.money(v.tip))}</dd></div>` : '')
    + (v.giftCardTotal || credit
      ? `<div><dt>${esc(c.t('total'))}</dt><dd>${esc(c.money(p.total + v.tip))}</dd></div>` + v.giftCards.filter((g) => g.applied).map((g) => `<div><dt>${esc(c.t('giftCard'))} &bull;&bull;${esc(g.lastCharacters)}</dt><dd>-${esc(c.money(g.applied))}</dd></div>`).join('')
        + (credit ? `<div><dt>${esc(c.t('storeCredit'))}</dt><dd>-${esc(c.money(credit))}</dd></div>` : '')
        + `<div class="grand"><dt>${esc(c.t('amountDue'))}</dt><dd>${esc(c.money(v.amountDue))}</dd></div>`
      : `<div class="grand"><dt>${esc(c.t('total'))}</dt><dd>${esc(c.money(p.total + v.tip))}</dd></div>`)
    + (p.totalTax && v.taxesIncluded ? `<div><dt><small>${esc(c.t('includedTaxes'))}</small></dt><dd><small>${esc(c.money(p.totalTax))}</small></dd></div>` : '')
    + `</dl>`;
}

export function discountMessage(t: T, reason: DiscountRejection | GiftCardRejection | 'invalid_email'): string {
  return t((reason.startsWith('gc_') ? reason : `d_${reason}`) as 'd_not_found');
}

// --- checkout page ------------------------------------------------------------------------------------------------------

/** Settings > Checkout > address autocomplete: when off, address fields tell the browser not to autofill them. */
const autofill = (c: PageCtx, hint: string) => (hint === 'email' || configOf(c.shop, 'CHECKOUT').addressAutocomplete ? hint : 'off');

function field(c: PageCtx, name: keyof ReturnType<typeof translator>['s'] & string, key: string, value: string | null | undefined, o: { autocomplete?: string; required?: boolean; type?: string; half?: boolean } = {}): string {
  return `<label class="field"><span>${esc(c.t(name as 'email'))}</span><input name="${key}" type="${o.type ?? 'text'}" value="${attr(value)}"${o.autocomplete ? ` autocomplete="${autofill(c, o.autocomplete)}"` : ''}${o.required ? ' required' : ''}></label>`;
}

export const BRAND_NAMES: Record<string, string> = { visa: 'Visa', mastercard: 'Mastercard', amex: 'American Express', discover: 'Discover', diners: 'Diners Club', jcb: 'JCB', unionpay: 'UnionPay', cartes_bancaires: 'Cartes Bancaires' };

export interface PageData {
  view: CheckoutView;
  countries: string[] | null;
  methods: PaymentProvider[];
  bankInstructions: string;
  stripe: { publishableKey: string } | null;
  errors: string[];
  values?: Record<string, string>;
  marketing?: boolean;
  chosenMethod?: string;
  /** Sign-in link of the checkout (accounts on, links shown, buyer not signed in) and the signed-in buyer's email. */
  signInUrl?: string | null;
  signedInEmail?: string | null;
}

export function checkoutPage(c0: PageCtx, d: PageData): string {
  const c = inCurrency(c0, d.view.currency);
  const { t } = c;
  const v = d.view;
  const a: CheckoutAddressInput = v.address ?? {};
  const countries = countryOptions(d.countries, c.shop.locale);
  const defaultCountry = a.countryCode ?? (countries.some((x) => x.code === c.shop.country) ? c.shop.country : '');
  const list = PROVINCES[a.countryCode ?? defaultCountry];
  const provinceBox = list
    ? `<span>${esc(t('province'))}</span><select name="provinceCode" autocomplete="address-level1" required>${list.map((p) => `<option value="${p.code}"${p.code === a.provinceCode ? ' selected' : ''}>${esc(p.name)}</option>`).join('')}</select>`
    : `<span>${esc(t('province'))}</span><input name="province" autocomplete="address-level1" value="${attr(a.province)}">`;
  const free = v.amountDue === 0;
  const chosen = d.chosenMethod && d.methods.some((m) => m.id === d.chosenMethod) ? d.chosenMethod : d.methods[0]?.id;
  const brands = configOf(c.shop, 'PAYMENTS').cardBrands;
  const payOptions = d.methods.map((m) => {
    const builtIn = m.id === 'bank_transfer' || m.id === 'cod' || m.id === 'stripe';
    const hint = m.id === 'bank_transfer' ? t('bank_transfer_hint') : m.id === 'cod' ? t('cod_hint') : m.id === 'stripe' ? t('stripe_hint')
      : m.kind === 'test' ? t('test_hint') : m.kind === 'redirect' ? t('redirect_hint') : m.instructions ?? '';
    const panel = m.id === 'stripe' ? '<div id="stripe-element" style="margin-top:12px"></div>' : '';
    const badges = m.id === 'stripe' && brands.length ? `<p class="note" style="margin:8px 0 0">${esc(t('weAccept'))} ${brands.map((b) => `<span class="tag">${esc(BRAND_NAMES[b] ?? b)}</span>`).join(' ')}</p>` : '';
    const label = m.name ?? (builtIn ? t(m.id as 'cod') : t('test'));
    return `<label class="option"><input type="radio" name="paymentMethod" value="${attr(m.id)}"${m.id === chosen ? ' checked' : ''}><span class="grow">${esc(label)}</span></label>`
      + `<div class="panel" data-panel="${attr(m.id)}"${m.id === chosen ? '' : ' hidden'}><span style="white-space:pre-wrap">${esc(hint)}</span>${badges}${panel}</div>`;
  }).join('');
  const config = {
    refreshUrl: `/checkouts/${v.token}/refresh`, completeUrl: `/checkouts/${v.token}/complete`,
    provinces: PROVINCES, labels: { province: t('province'), show: t('showSummary'), hide: t('hideSummary'), processing: t('processing'), generic: t('err_generic') },
    stripe: d.stripe ? { publishableKey: d.stripe.publishableKey, amount: v.amountDue, currency: v.currency.toLowerCase() } : null,
  };
  const val = (k: string) => d.values?.[k] ?? '';
  const st = v.settings;
  const rule = (r: 'hidden' | 'optional' | 'required', optLabel: 'company' | 'address2' | 'phone', reqLabel: 'companyField' | 'address2Field' | 'phoneField', key: string, value: string | null | undefined, o: { autocomplete: string; type?: string }) =>
    r === 'hidden' ? '' : field(c, r === 'required' ? reqLabel : optLabel, key, val(key) || value, { ...o, required: r === 'required' });
  const nameRow = st.nameMode === 'last'
    ? `<div class="row">${field(c, 'lastName', 'lastName', val('lastName') || a.lastName, { autocomplete: 'family-name', required: true })}</div>`
    : `<div class="row two">${field(c, 'firstName', 'firstName', val('firstName') || a.firstName, { autocomplete: 'given-name', required: true })}${field(c, 'lastName', 'lastName', val('lastName') || a.lastName, { autocomplete: 'family-name', required: true })}</div>`;
  const addressForm = `<div class="row"><label class="field"><span>${esc(t('country'))}</span><select name="countryCode" autocomplete="country" required>${countries.length > 1 ? `<option value=""${defaultCountry ? '' : ' selected'} disabled>—</option>` : ''}${countries.map((x) => `<option value="${x.code}"${x.code === defaultCountry ? ' selected' : ''}>${esc(x.name)}</option>`).join('')}</select></label></div>`
    + nameRow
    + rule(st.company, 'company', 'companyField', 'company', a.company, { autocomplete: 'organization' })
    + field(c, 'address1', 'address1', a.address1, { autocomplete: 'address-line1', required: true })
    + rule(st.address2, 'address2', 'address2Field', 'address2', a.address2, { autocomplete: 'address-line2' })
    + `<div class="row three">${field(c, 'zip', 'zip', a.zip, { autocomplete: 'postal-code', required: true })}${field(c, 'city', 'city', a.city, { autocomplete: 'address-level2', required: true })}<label class="field" id="province-box">${provinceBox}</label></div>`
    + rule(st.phone, 'phone', 'phoneField', 'phone', st.contactMethod === 'email_or_phone' && !v.email ? null : a.phone, { autocomplete: 'tel', type: 'tel' });
  const tag = (name: string) => d.view.rejectedCodes.length && name ? '' : '';
  void tag;
  const phoneContact = st.contactMethod === 'email_or_phone';
  const contactValue = val('email') || v.email || (phoneContact ? v.address?.phone ?? '' : '');
  const contactField = `<label class="field"><span>${esc(t(phoneContact ? 'contactOrPhone' : 'email'))}</span><input id="email" name="email" type="${phoneContact ? 'text' : 'email'}" value="${attr(contactValue)}" autocomplete="${phoneContact ? 'username' : 'email'}"${phoneContact ? ' inputmode="email"' : ''} required></label>`;
  const tipBox = st.tipping.enabled
    ? `<h2>${esc(t('tipTitle'))}</h2><div class="options" role="radiogroup" id="tip-options">`
      + `<label class="option"><input type="radio" name="tip" value=""${!v.tipChoice.percent && !v.tipChoice.amount ? ' checked' : ''}><span class="grow">${esc(t('tipNone'))}</span></label>`
      + st.tipping.presets.map((pc) => `<label class="option"><input type="radio" name="tip" value="${pc}"${v.tipChoice.percent === pc ? ' checked' : ''}><span class="grow">${pc}%</span><span class="price">${esc(c.money(Math.round(Math.max(0, v.pricing.subtotal - v.pricing.totalDiscounts) * pc / 100)))}</span></label>`).join('')
      + `<label class="option"><input type="radio" name="tip" value="custom"${!v.tipChoice.percent && v.tipChoice.amount ? ' checked' : ''}><span class="grow">${esc(t('tipCustom'))}</span><input name="tipCustom" inputmode="decimal" aria-label="${attr(t('tipCustom'))}" style="max-width:8rem" value="${attr(v.tipChoice.amount ? (v.tipChoice.amount / 100).toFixed(2) : '')}"></label></div>`
    : '';
  const noteBox = st.orderNotes ? `<label class="field" style="margin-top:16px"><span>${esc(t('orderNote'))}</span><textarea name="note" rows="3" maxlength="5000">${esc(val('note') || v.note)}</textarea></label>` : '';
  const discountErr = v.rejectedCodes.map((r) => `${r.code}: ${discountMessage(t, r.reason)}`).join(' ');

  const sc = v.storeCredit;
  const creditBox = sc.enabled && sc.available > 0
    ? `<label class="check" id="store-credit-box"><input type="hidden" name="storeCreditField" value="1"><input type="checkbox" name="useStoreCredit" value="1"${sc.use ? ' checked' : ''}> <span>${esc(t('useStoreCredit'))} <small>(${esc(t('storeCreditBalance', { amount: c.money(sc.available) }))})</small></span></label>`
    : '';
  const accountLine = d.signedInEmail ? `<p class="note">${esc(t('signedInAs', { email: d.signedInEmail }))}</p>` : d.signInUrl ? `<p class="note">${esc(t('haveAccount'))} <a href="${attr(d.signInUrl)}">${esc(t('signIn'))}</a></p>` : '';
  const body = `<div class="co">
<aside class="co-summary" id="summary" aria-label="${esc(t('orderSummary'))}">
 <button type="button" class="co-toggle" id="summary-toggle" aria-expanded="true" aria-controls="summary-body"><span data-label>${esc(t('hideSummary'))}</span><strong data-total>${esc(c.money(v.amountDue))}</strong></button>
 <div class="co-summary-body" id="summary-body">
  <div id="summary-lines">${summaryFragment(c, v)}</div>
  <form method="post" action="/checkouts/${v.token}/discount" class="disc"><label class="field"><span class="visually-hidden">${esc(t('discountCode'))}</span><input id="discount-input" name="discountCode" placeholder="${attr(t('discountCode'))}" autocomplete="off"></label><button class="btn small" type="submit" data-discount-add>${esc(t('apply'))}</button></form>
  <p class="msg" id="discount-msg" role="status">${esc(discountErr)}</p>
  <form method="post" action="/checkouts/${v.token}/gift-card" class="disc"><label class="field"><span class="visually-hidden">${esc(t('giftCardCode'))}</span><input id="gift-input" name="giftCardCode" placeholder="${attr(t('giftCardCode'))}" autocomplete="off"></label><button class="btn small" type="submit" data-gift-add>${esc(t('apply'))}</button></form>
  <p class="msg" id="gift-msg" role="status"></p>
 </div>
</aside>
<main class="co-main" id="main"><h1 class="visually-hidden">${esc(t('title'))}</h1>
<div class="errors" id="errors" role="alert" aria-live="assertive">${d.errors.map((e) => `<p>${esc(e)}</p>`).join('')}</div>
<form id="checkout-form" method="post" action="/checkouts/${v.token}/complete" novalidate>
 <h2 style="margin-top:0">${esc(t('contact'))}</h2>
 ${accountLine}${contactField}
 ${st.marketing === 'hidden' ? '' : `<label class="check"><input type="checkbox" name="acceptsMarketing" value="1"${d.marketing ? ' checked' : ''}> ${esc(t('marketing'))}</label>`}
 <h2>${esc(t(v.requiresShipping ? 'delivery' : 'billingAddress'))}</h2>${addressForm}
 ${v.requiresShipping ? `<h2>${esc(t('shippingMethod'))}</h2><div id="shipping-methods" aria-live="polite">${shippingFragment(c, v)}</div>` : ''}
 ${tipBox}${noteBox}
 <h2>${esc(t('payment'))}</h2>
 ${creditBox}
 <p class="note" id="free-note"${free ? '' : ' hidden'}>${esc(t('noPayment'))}</p>
 <div id="payments"${free ? ' hidden' : ''}>${d.methods.length ? `<div class="options" role="radiogroup">${payOptions}</div>` : `<p class="note">${esc(t('noMethods'))}</p>`}</div>
 <button class="btn" id="submit" type="submit"${d.methods.length || free ? '' : ' disabled'}>${esc(t(d.stripe ? 'payNow' : 'placeOrder'))}</button>
 <p style="margin-top:16px"><a href="/cart">&larr; ${esc(t('returnToCart'))}</a></p>
</form></main></div>
<script type="application/json" id="checkout-config">${JSON.stringify(config).replace(/</g, '\\u003c')}</script>`;
  return layout(c, t('title'), body, { script: true });
}

// --- thank you ------------------------------------------------------------------------------------------------------------

export function thankYouPage(c: PageCtx, o: OrderSummary, bankInstructions: string): string {
  const { t } = c;
  const gateway = o.transactions[0]?.gateway ?? 'free';
  const paid = o.order.financialStatus === 'PAID' || o.order.financialStatus === 'AUTHORIZED';
  const pay = configOf(c.shop, 'PAYMENTS');
  const custom = gateway.startsWith('manual:') ? pay.customMethods.find((m) => `manual:${m.id}` === gateway) : undefined;
  const redirect = gateway.startsWith('redirect:') ? pay.redirectGateways.find((g) => `redirect:${g.id}` === gateway) : undefined;
  const methodLabel = custom?.name ?? redirect?.name ?? (gateway === 'test' ? t('test') : t(gateway as 'cod'));
  const a = o.shippingAddress;
  const addr = a ? [[a.firstName, a.lastName].filter(Boolean).join(' '), a.company, a.address1, a.address2, [a.zip, a.city].filter(Boolean).join(' '), a.province, a.country ?? a.countryCode].filter(Boolean) : [];
  const om = orderMoney(o.order);
  const money = inCurrency(c, om.currency).money;
  const lines = o.lines.map((l) => `<li class="line"><div class="thumb">${l.imageUrl ? `<img src="${attr(l.imageUrl)}" alt="" width="64" height="64">` : ''}<span class="qty">${l.quantity}</span></div><div class="grow">${esc(l.title)}${l.variantTitle ? `<small>${esc(l.variantTitle)}</small>` : ''}${l.sellingPlanName ? `<small class="plan">${esc(l.sellingPlanName)}</small>` : ''}</div><div>${esc(money(lineMoney(o.order, l).discountedTotal))}</div></li>`).join('');
  const o2 = o.order;
  const giftPaid = o.transactions.filter((x) => x.gateway === 'gift_card' && x.status === 'SUCCESS' && x.kind === 'SALE').reduce((n, x) => n + x.amount, 0);
  const creditPaid = o.transactions.filter((x) => x.gateway === 'store_credit' && x.status === 'SUCCESS' && x.kind === 'SALE').reduce((n, x) => n + (om.currency === x.presentmentCurrency && x.presentmentAmount != null ? x.presentmentAmount : x.amount), 0);
  const totals = `<dl class="totals"><div><dt>${esc(t('subtotal'))}</dt><dd>${esc(money(om.subtotal))}</dd></div>`
    + (om.discounts ? `<div><dt>${esc(t('discount'))}</dt><dd>-${esc(money(om.discounts))}</dd></div>` : '')
    + (o.shippingLines.length ? `<div><dt>${esc(o.shippingLines[0]!.title)}</dt><dd>${om.shipping ? esc(money(om.shipping)) : esc(t('free'))}</dd></div>` : '')
    + (om.tax ? `<div><dt>${esc(t(o2.taxesIncluded ? 'includedTaxes' : 'taxes'))}</dt><dd>${esc(money(om.tax))}</dd></div>` : '')
    + (om.tip ? `<div><dt>${esc(t('tipLine'))}</dt><dd>${esc(money(om.tip))}</dd></div>` : '')
    + `<div class="grand"><dt>${esc(t('total'))}</dt><dd>${esc(money(om.total))}</dd></div>`
    + (giftPaid ? `<div><dt>${esc(t('giftCard'))}</dt><dd>-${esc(money(giftPaid))}</dd></div>` : '')
    + (creditPaid ? `<div><dt>${esc(t('storeCredit'))}</dt><dd>-${esc(money(creditPaid))}</dd></div>` : '') + `</dl>`;
  const online = gateway === 'stripe';
  const notes = [
    online && !paid ? `<p>${esc(t('paymentProcessing'))}</p>` : '',
    gateway === 'bank_transfer' && !paid ? `<h3>${esc(t('bankDetails'))}</h3>${bankInstructions ? `<pre style="white-space:pre-wrap;font:inherit">${esc(bankInstructions)}</pre>` : `<p>${esc(t('bankDetailsMissing'))}</p>`}` : '',
    gateway === 'cod' ? `<p>${esc(t('codNote'))}</p>` : '',
  ].join('');
  const body = `<main id="main" class="ty"><p style="margin:0;color:var(--muted)">${esc(t('orderNumber', { name: o2.name }))}</p>
<h1>${esc(t('thankYou', { name: a?.firstName ?? '' }).replace(/\s+([,!])/, '$1'))}</h1>
<p><span class="badge${paid ? ' ok' : ''}">${esc(t(paid ? 'paid' : 'pending'))}</span> ${esc(t(paid ? 'confirmed' : 'confirmedPending'))}. ${esc(t('emailSent', { email: o2.email ?? '' }))}</p>
<section class="card"><h2>${esc(t('orderSummary'))}</h2><ul class="lines">${lines}</ul>${o.lines.some((l) => l.subscriptionContractId) ? `<p class="note subscription-note">${esc(t('subscriptionStarted'))}</p>` : ''}${totals}</section>
<section class="card"><h2>${esc(t('paymentMethod'))}</h2><p>${esc(methodLabel)}</p>${notes}${custom?.instructions && !paid ? `<pre style="white-space:pre-wrap;font:inherit">${esc(custom.instructions)}</pre>` : ''}</section>
${addr.length ? `<section class="card"><h2>${esc(t('shipTo'))}</h2><p>${addr.map(esc).join('<br>')}</p></section>` : ''}
<p><a href="/">${esc(t('backToShop'))}</a></p></main>`;
  return layout(c, t('confirmed'), body);
}
