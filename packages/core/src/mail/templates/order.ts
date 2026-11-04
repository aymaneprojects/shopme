import { renderMoneyFormat } from '@shopme/shopify-compat';
import type { Mail } from '../../mail';
import type { OrderSummary } from '../../services/orders/create';
import type { Shop } from '../../services/shops';

type Dict = Record<string, string>;
const STRINGS: Record<string, Dict> = {
  en: {
    confirmSubject: 'Order {name} confirmed', staffSubject: '[{shop}] New order {name}', thanks: 'Thank you for your order!', received: 'We received your order {name}.',
    staffIntro: 'New order {name} from {email}.', qty: 'Qty', subtotal: 'Subtotal', discount: 'Discount', shipping: 'Shipping', taxes: 'Taxes', includedTaxes: 'Included taxes', total: 'Total',
    shipTo: 'Shipping address', payment: 'Payment', paid: 'Paid', pending: 'Awaiting payment', bank_transfer: 'Bank transfer', cod: 'Cash on delivery', stripe: 'Card', free: 'No payment due',
    bankHelp: 'Please transfer the total amount using the bank details below, quoting {name}.', questions: 'Questions? Reply to this email or write to {email}.', view: 'Payment status',
  },
  fr: {
    confirmSubject: 'Commande {name} confirmée', staffSubject: '[{shop}] Nouvelle commande {name}', thanks: 'Merci pour votre commande !', received: 'Nous avons bien reçu votre commande {name}.',
    staffIntro: 'Nouvelle commande {name} de {email}.', qty: 'Qté', subtotal: 'Sous-total', discount: 'Réduction', shipping: 'Livraison', taxes: 'Taxes', includedTaxes: 'Dont taxes', total: 'Total',
    shipTo: 'Adresse de livraison', payment: 'Paiement', paid: 'Payé', pending: 'En attente de paiement', bank_transfer: 'Virement bancaire', cod: 'Paiement à la livraison', stripe: 'Carte bancaire', free: 'Aucun paiement requis',
    bankHelp: 'Merci de virer le montant total avec les coordonnées ci-dessous en indiquant {name}.', questions: 'Une question ? Répondez à cet e-mail ou écrivez à {email}.', view: 'Statut du paiement',
  },
};

const esc = (v: unknown) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function dict(locale: string): (key: string, vars?: Record<string, string>) => string {
  const d = STRINGS[locale.slice(0, 2).toLowerCase()] ?? STRINGS.en!;
  return (k, vars = {}) => (d[k] ?? STRINGS.en![k] ?? k).replace(/\{(\w+)\}/g, (_m, v: string) => vars[v] ?? '');
}

/** Bank transfer instructions are shop settings (`payments.manual.bankTransfer.instructions`). */
function bankInstructions(shop: Shop): string {
  const settings = shop.settings as Record<string, any>;
  const v = settings['payments.manual.bankTransfer'] ?? settings.payments?.manual?.bankTransfer;
  return typeof v?.instructions === 'string' ? v.instructions : '';
}

function parts(o: OrderSummary, shop: Shop) {
  const t = dict(shop.locale);
  const money = (n: number) => renderMoneyFormat(shop.moneyFormat, n, o.order.currency);
  const gateway = o.transactions[0]?.gateway ?? 'free';
  const paid = o.order.financialStatus === 'PAID';
  const a = o.shippingAddress;
  const address = a ? [[a.firstName, a.lastName].filter(Boolean).join(' '), a.company, a.address1, a.address2, [a.zip, a.city].filter(Boolean).join(' '), a.province, a.country ?? a.countryCode].filter(Boolean) as string[] : [];
  const rows: [string, string][] = [[t('subtotal'), money(o.order.subtotal)]];
  if (o.order.totalDiscounts) rows.push([t('discount'), `-${money(o.order.totalDiscounts)}`]);
  if (o.shippingLines.length) rows.push([t('shipping'), money(o.order.totalShipping)]);
  if (o.order.totalTax) rows.push([o.order.taxesIncluded ? t('includedTaxes') : t('taxes'), money(o.order.totalTax)]);
  rows.push([t('total'), money(o.order.total)]);
  const lines = o.lines.map((l) => ({ title: [l.title, l.variantTitle].filter(Boolean).join(' - '), qty: l.quantity, total: money(l.discountedTotal) }));
  const pay = `${t(gateway)} (${paid ? t('paid') : t('pending')})`;
  const bank = !paid && gateway === 'bank_transfer' ? bankInstructions(shop) : '';
  return { t, lines, rows, address, pay, bank, gateway, paid };
}

function render(o: OrderSummary, shop: Shop, intro: string, subject: string): Mail & { subject: string } {
  const p = parts(o, shop);
  const { t } = p;
  const bankLine = p.bank ? `${t('bankHelp', { name: o.order.name })}\n${p.bank}` : '';
  const text = [
    intro, '',
    ...p.lines.map((l) => `${l.qty} x ${l.title}  ${l.total}`), '',
    ...p.rows.map(([k, v]) => `${k}: ${v}`), '',
    p.address.length ? `${t('shipTo')}:\n${p.address.join('\n')}\n` : '',
    `${t('payment')}: ${p.pay}`,
    bankLine, '', t('questions', { email: shop.email }),
  ].filter((x, i, a) => !(x === '' && a[i - 1] === '')).join('\n');
  const html = `<!doctype html><html><body style="margin:0;background:#f1f5f9;font-family:Arial,Helvetica,sans-serif;color:#0f172a"><div style="max-width:560px;margin:0 auto;padding:24px">`
    + `<div style="background:#1E40AF;color:#fff;padding:20px 24px;border-radius:8px 8px 0 0;font-size:20px;font-weight:bold">${esc(shop.name)}</div>`
    + `<div style="background:#fff;padding:24px;border-radius:0 0 8px 8px"><p style="margin-top:0">${esc(intro)}</p>`
    + `<table style="width:100%;border-collapse:collapse">${p.lines.map((l) => `<tr><td style="padding:8px 0;border-bottom:1px solid #e2e8f0">${esc(l.title)} <span style="color:#64748b">&times; ${l.qty}</span></td><td style="padding:8px 0;border-bottom:1px solid #e2e8f0;text-align:right">${esc(l.total)}</td></tr>`).join('')}</table>`
    + `<table style="width:100%;margin-top:12px">${p.rows.map(([k, v], i, a) => `<tr><td style="padding:3px 0;${i === a.length - 1 ? 'font-weight:bold;' : ''}">${esc(k)}</td><td style="text-align:right;${i === a.length - 1 ? 'font-weight:bold;' : ''}">${esc(v)}</td></tr>`).join('')}</table>`
    + (p.address.length ? `<h3 style="margin:20px 0 4px;font-size:15px">${esc(t('shipTo'))}</h3><p style="margin:0">${p.address.map(esc).join('<br>')}</p>` : '')
    + `<h3 style="margin:20px 0 4px;font-size:15px">${esc(t('payment'))}</h3><p style="margin:0">${esc(p.pay)}</p>`
    + (p.bank ? `<p style="background:#eff6ff;border-radius:6px;padding:12px;white-space:pre-wrap">${esc(t('bankHelp', { name: o.order.name }))}\n${esc(p.bank)}</p>` : '')
    + `<p style="color:#64748b;font-size:13px;margin-top:24px">${esc(t('questions', { email: shop.email }))}</p></div></div></body></html>`;
  return { to: '', subject, text, html };
}

/** Confirmation sent to the buyer. */
export function renderOrderConfirmation(o: OrderSummary, shop: Shop): Mail {
  const t = dict(shop.locale);
  const m = render(o, shop, `${t('thanks')} ${t('received', { name: o.order.name })}`, t('confirmSubject', { name: o.order.name }));
  return { ...m, to: o.order.email ?? '' };
}

/** Notification sent to the shop owner address. */
export function renderStaffNewOrder(o: OrderSummary, shop: Shop): Mail {
  const t = dict(shop.locale);
  const m = render(o, shop, t('staffIntro', { name: o.order.name, email: o.order.email ?? '' }), t('staffSubject', { shop: shop.name, name: o.order.name }));
  return { ...m, to: shop.email };
}
