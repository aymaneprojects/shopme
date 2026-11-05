import type { PaymentProvider } from '@shopme/payments';
import type { CheckoutAddressInput, CheckoutView, DiscountRejection, GiftCardRejection, OrderSummary, Shop } from '@shopme/core';
import { renderMoneyFormat } from '@shopme/shopify-compat';
import { countryOptions, PROVINCES } from './geo';
import { translator, type T } from './i18n';

export const esc = (v: unknown): string => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const attr = (v: unknown) => esc(v);

export interface PageCtx { shop: Shop; t: T; lang: string; money: (n: number) => string }

export function pageCtx(shop: Shop): PageCtx {
  const { t, lang } = translator(shop.locale);
  return { shop, t, lang, money: (n) => renderMoneyFormat(shop.moneyFormat, n, shop.currency) };
}

function layout(c: PageCtx, title: string, body: string, opts: { script?: boolean } = {}): string {
  return `<!doctype html><html lang="${c.lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>${esc(title)} - ${esc(c.shop.name)}</title><link rel="stylesheet" href="/checkout-assets/checkout.css"></head>
<body><a class="skip" href="#main">${esc(c.t('title'))}</a><header class="co-header"><a href="/">${esc(c.shop.name)}</a></header>${body}${opts.script ? '<script src="/checkout-assets/checkout.js" defer></script>' : ''}</body></html>`;
}

export function notFoundPage(c: PageCtx): string {
  return layout(c, c.t('notFound'), `<main id="main" class="ty"><h1>${esc(c.t('notFound'))}</h1><p>${esc(c.t('notFoundText'))}</p><p><a href="/">${esc(c.t('continueShopping'))}</a></p></main>`);
}

// --- fragments (also returned as JSON by the live refresh) -----------------------------------------------------------

export function shippingFragment(c: PageCtx, v: CheckoutView): string {
  if (!v.address?.countryCode) return `<p class="note">${esc(c.t('shippingEnter'))}</p>`;
  if (!v.shippingOptions.length) return `<p class="note">${esc(c.t('shippingNone'))}</p>`;
  return `<div class="options" role="radiogroup">${v.shippingOptions.map((o) =>
    `<label class="option"><input type="radio" name="shippingRateId" value="${o.id}"${o.id === v.shippingRateId ? ' checked' : ''}><span class="grow">${esc(o.name)}</span><span class="price">${o.price ? esc(c.money(o.price)) : esc(c.t('free'))}</span></label>`).join('')}</div>`;
}

export function summaryFragment(c: PageCtx, v: CheckoutView): string {
  const p = v.pricing;
  const lines = v.lines.map((l) => {
    const pl = p.lines.find((x) => x.id === l.lineId)!;
    const title = [l.product.title, l.hasOnlyDefaultVariant ? '' : l.variantTitle].filter(Boolean);
    return `<li class="line"><div class="thumb">${l.image ? `<img src="${attr(l.image.url)}" alt="" width="64" height="64">` : ''}<span class="qty" aria-label="${esc(c.t('qty'))}">${l.quantity}</span></div>`
      + `<div class="grow">${esc(title[0])}${title[1] ? `<small>${esc(title[1])}</small>` : ''}</div><div>${esc(c.money(pl.total))}</div></li>`;
  }).join('');
  const tags = v.appliedDiscounts.filter((d) => d.code).map((d) => `<span class="tag">${esc(d.code)}<button type="button" data-discount-remove="${attr(d.code)}" aria-label="${esc(c.t('remove'))} ${attr(d.code)}">&times;</button></span>`).join('');
  const shippingValue = !v.requiresShipping ? '' : p.shipping ? (p.totalShipping ? esc(c.money(p.totalShipping)) : esc(c.t('free'))) : esc(c.t('shippingTbd'));
  const giftTags = v.giftCards.map((g) => `<span class="tag">${esc(c.t('giftCard'))} &bull;&bull;${esc(g.lastCharacters)}<button type="button" data-gift-remove="${attr(g.code)}" aria-label="${esc(c.t('remove'))} ${attr(g.lastCharacters)}">&times;</button></span>`).join('');
  return `<ul class="lines">${lines}</ul>${tags || giftTags ? `<div>${tags}${giftTags}</div>` : ''}<dl class="totals">`
    + `<div><dt>${esc(c.t('subtotal'))}</dt><dd>${esc(c.money(p.subtotal))}</dd></div>`
    + (p.totalDiscounts ? `<div><dt>${esc(c.t('discount'))}</dt><dd>-${esc(c.money(p.totalDiscounts))}</dd></div>` : '')
    + (v.requiresShipping ? `<div><dt>${esc(c.t('shipping'))}</dt><dd>${shippingValue}</dd></div>` : '')
    + (p.totalTax && !v.taxesIncluded ? `<div><dt>${esc(c.t('taxes'))}</dt><dd>${esc(c.money(p.totalTax))}</dd></div>` : '')
    + (v.giftCardTotal
      ? `<div><dt>${esc(c.t('total'))}</dt><dd>${esc(c.money(p.total))}</dd></div>` + v.giftCards.filter((g) => g.applied).map((g) => `<div><dt>${esc(c.t('giftCard'))} &bull;&bull;${esc(g.lastCharacters)}</dt><dd>-${esc(c.money(g.applied))}</dd></div>`).join('')
        + `<div class="grand"><dt>${esc(c.t('amountDue'))}</dt><dd>${esc(c.money(v.amountDue))}</dd></div>`
      : `<div class="grand"><dt>${esc(c.t('total'))}</dt><dd>${esc(c.money(p.total))}</dd></div>`)
    + (p.totalTax && v.taxesIncluded ? `<div><dt><small>${esc(c.t('includedTaxes'))}</small></dt><dd><small>${esc(c.money(p.totalTax))}</small></dd></div>` : '')
    + `</dl>`;
}

export function discountMessage(t: T, reason: DiscountRejection | GiftCardRejection | 'invalid_email'): string {
  return t((reason.startsWith('gc_') ? reason : `d_${reason}`) as 'd_not_found');
}

// --- checkout page ------------------------------------------------------------------------------------------------------

function field(c: PageCtx, name: keyof ReturnType<typeof translator>['s'] & string, key: string, value: string | null | undefined, o: { autocomplete?: string; required?: boolean; type?: string; half?: boolean } = {}): string {
  return `<label class="field"><span>${esc(c.t(name as 'email'))}</span><input name="${key}" type="${o.type ?? 'text'}" value="${attr(value)}"${o.autocomplete ? ` autocomplete="${o.autocomplete}"` : ''}${o.required ? ' required' : ''}></label>`;
}

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
}

export function checkoutPage(c: PageCtx, d: PageData): string {
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
  const payOptions = d.methods.map((m) => {
    const hint = m.id === 'bank_transfer' ? t('bank_transfer_hint') : m.id === 'cod' ? t('cod_hint') : t('stripe_hint');
    const panel = m.id === 'stripe' ? '<div id="stripe-element" style="margin-top:12px"></div>' : '';
    return `<label class="option"><input type="radio" name="paymentMethod" value="${m.id}"${m.id === chosen ? ' checked' : ''}><span class="grow">${esc(t(m.id))}</span></label>`
      + `<div class="panel" data-panel="${m.id}"${m.id === chosen ? '' : ' hidden'}>${esc(hint)}${panel}</div>`;
  }).join('');
  const config = {
    refreshUrl: `/checkouts/${v.token}/refresh`, completeUrl: `/checkouts/${v.token}/complete`,
    provinces: PROVINCES, labels: { province: t('province'), show: t('showSummary'), hide: t('hideSummary'), processing: t('processing'), generic: t('err_generic') },
    stripe: d.stripe ? { publishableKey: d.stripe.publishableKey, amount: v.amountDue, currency: v.currency.toLowerCase() } : null,
  };
  const val = (k: string) => d.values?.[k] ?? '';
  const addressForm = `<div class="row"><label class="field"><span>${esc(t('country'))}</span><select name="countryCode" autocomplete="country" required>${countries.length > 1 ? `<option value=""${defaultCountry ? '' : ' selected'} disabled>—</option>` : ''}${countries.map((x) => `<option value="${x.code}"${x.code === defaultCountry ? ' selected' : ''}>${esc(x.name)}</option>`).join('')}</select></label></div>`
    + `<div class="row two">${field(c, 'firstName', 'firstName', a.firstName, { autocomplete: 'given-name', required: true })}${field(c, 'lastName', 'lastName', a.lastName, { autocomplete: 'family-name', required: true })}</div>`
    + field(c, 'company', 'company', a.company, { autocomplete: 'organization' })
    + field(c, 'address1', 'address1', a.address1, { autocomplete: 'address-line1', required: true })
    + field(c, 'address2', 'address2', a.address2, { autocomplete: 'address-line2' })
    + `<div class="row three">${field(c, 'zip', 'zip', a.zip, { autocomplete: 'postal-code', required: true })}${field(c, 'city', 'city', a.city, { autocomplete: 'address-level2', required: true })}<label class="field" id="province-box">${provinceBox}</label></div>`
    + field(c, 'phone', 'phone', a.phone, { autocomplete: 'tel', type: 'tel' });
  const tag = (name: string) => d.view.rejectedCodes.length && name ? '' : '';
  void tag;
  const discountErr = v.rejectedCodes.map((r) => `${r.code}: ${discountMessage(t, r.reason)}`).join(' ');

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
 <label class="field"><span>${esc(t('email'))}</span><input id="email" name="email" type="email" value="${attr(val('email') || v.email)}" autocomplete="email" required></label>
 <label class="check"><input type="checkbox" name="acceptsMarketing" value="1"${d.marketing ? ' checked' : ''}> ${esc(t('marketing'))}</label>
 <h2>${esc(t(v.requiresShipping ? 'delivery' : 'billingAddress'))}</h2>${addressForm}
 ${v.requiresShipping ? `<h2>${esc(t('shippingMethod'))}</h2><div id="shipping-methods" aria-live="polite">${shippingFragment(c, v)}</div>` : ''}
 <h2>${esc(t('payment'))}</h2>
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
  const paid = o.order.financialStatus === 'PAID';
  const a = o.shippingAddress;
  const addr = a ? [[a.firstName, a.lastName].filter(Boolean).join(' '), a.company, a.address1, a.address2, [a.zip, a.city].filter(Boolean).join(' '), a.province, a.country ?? a.countryCode].filter(Boolean) : [];
  const money = (n: number) => renderMoneyFormat(c.shop.moneyFormat, n, o.order.currency);
  const lines = o.lines.map((l) => `<li class="line"><div class="thumb">${l.imageUrl ? `<img src="${attr(l.imageUrl)}" alt="" width="64" height="64">` : ''}<span class="qty">${l.quantity}</span></div><div class="grow">${esc(l.title)}${l.variantTitle ? `<small>${esc(l.variantTitle)}</small>` : ''}</div><div>${esc(money(l.discountedTotal))}</div></li>`).join('');
  const o2 = o.order;
  const giftPaid = o.transactions.filter((x) => x.gateway === 'gift_card' && x.status === 'SUCCESS' && x.kind === 'SALE').reduce((n, x) => n + x.amount, 0);
  const totals = `<dl class="totals"><div><dt>${esc(t('subtotal'))}</dt><dd>${esc(money(o2.subtotal))}</dd></div>`
    + (o2.totalDiscounts ? `<div><dt>${esc(t('discount'))}</dt><dd>-${esc(money(o2.totalDiscounts))}</dd></div>` : '')
    + (o.shippingLines.length ? `<div><dt>${esc(o.shippingLines[0]!.title)}</dt><dd>${o2.totalShipping ? esc(money(o2.totalShipping)) : esc(t('free'))}</dd></div>` : '')
    + (o2.totalTax ? `<div><dt>${esc(t(o2.taxesIncluded ? 'includedTaxes' : 'taxes'))}</dt><dd>${esc(money(o2.totalTax))}</dd></div>` : '')
    + `<div class="grand"><dt>${esc(t('total'))}</dt><dd>${esc(money(o2.total))}</dd></div>`
    + (giftPaid ? `<div><dt>${esc(t('giftCard'))}</dt><dd>-${esc(money(giftPaid))}</dd></div>` : '') + `</dl>`;
  const online = gateway === 'stripe';
  const notes = [
    online && !paid ? `<p>${esc(t('paymentProcessing'))}</p>` : '',
    gateway === 'bank_transfer' && !paid ? `<h3>${esc(t('bankDetails'))}</h3>${bankInstructions ? `<pre style="white-space:pre-wrap;font:inherit">${esc(bankInstructions)}</pre>` : `<p>${esc(t('bankDetailsMissing'))}</p>`}` : '',
    gateway === 'cod' ? `<p>${esc(t('codNote'))}</p>` : '',
  ].join('');
  const body = `<main id="main" class="ty"><p style="margin:0;color:var(--muted)">${esc(t('orderNumber', { name: o2.name }))}</p>
<h1>${esc(t('thankYou', { name: a?.firstName ?? '' }).replace(/\s+([,!])/, '$1'))}</h1>
<p><span class="badge${paid ? ' ok' : ''}">${esc(t(paid ? 'paid' : 'pending'))}</span> ${esc(t(paid ? 'confirmed' : 'confirmedPending'))}. ${esc(t('emailSent', { email: o2.email ?? '' }))}</p>
<section class="card"><h2>${esc(t('orderSummary'))}</h2><ul class="lines">${lines}</ul>${totals}</section>
<section class="card"><h2>${esc(t('paymentMethod'))}</h2><p>${esc(t(gateway as 'cod'))}</p>${notes}</section>
${addr.length ? `<section class="card"><h2>${esc(t('shipTo'))}</h2><p>${addr.map(esc).join('<br>')}</p></section>` : ''}
<p><a href="/">${esc(t('backToShop'))}</a></p></main>`;
  return layout(c, t('confirmed'), body);
}
