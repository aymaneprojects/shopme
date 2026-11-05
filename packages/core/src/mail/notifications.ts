import { and, eq } from 'drizzle-orm';
import { Liquid } from 'liquidjs';
import { defaultMoneyFormats, renderMoneyFormat } from '@shopme/shopify-compat';
import { lineMoney, orderMoney } from '../services/markets/order-money';
import type { Executor } from '../db/client';
import { notificationTemplates, shops } from '../db/schema';
import type { OrderSummary } from '../services/orders/create';
import type { Shop } from '../services/shops';
import type { Mail, Mailer } from '../mail';

export const NOTIFICATION_KEYS = [
  'order_confirmation', 'staff_new_order', 'shipping_confirmation', 'shipping_update', 'order_cancelled', 'refund',
  'customer_account_welcome', 'customer_account_invite', 'password_reset', 'draft_order_invoice', 'contact_form', 'staff_invite', 'staff_login_alert', 'gift_card_issued', 'abandoned_checkout', 'store_credit_account_credit',
] as const;
export type NotificationKey = (typeof NOTIFICATION_KEYS)[number];
export const isNotificationKey = (k: string): k is NotificationKey => (NOTIFICATION_KEYS as readonly string[]).includes(k);

type Lang = { subject: string; body: string };
interface Def { name: string; description: string; audience: 'customer' | 'staff'; variables: string[]; en: Lang; fr: Lang }

// ---- default bodies (inner HTML, Liquid). The shop header/footer is added around them by `layout`. ---------------------------

const ROW = 'padding:8px 0;border-bottom:1px solid #e2e8f0';
const lineTable = (items: string) => `<table style="width:100%;border-collapse:collapse">{% for l in ${items} %}<tr><td style="${ROW}">{{ l.title }} <span style="color:#64748b">&times; {{ l.quantity }}</span></td>{% if l.total %}<td style="${ROW};text-align:right">{{ l.total }}</td>{% endif %}</tr>{% endfor %}</table>`;
const orderBlock = (L: { subtotal: string; discount: string; shipping: string; tax: string; total: string; shipTo: string; payment: string; bank: string }) =>
  `${lineTable('order.line_items')}<table style="width:100%;margin-top:12px"><tr><td>${L.subtotal}</td><td style="text-align:right">{{ order.subtotal }}</td></tr>`
  + `{% if order.discount %}<tr><td>${L.discount}</td><td style="text-align:right">-{{ order.discount }}</td></tr>{% endif %}`
  + `{% if order.shipping %}<tr><td>${L.shipping}</td><td style="text-align:right">{{ order.shipping }}</td></tr>{% endif %}`
  + `{% if order.tax %}<tr><td>{{ order.tax_label }}</td><td style="text-align:right">{{ order.tax }}</td></tr>{% endif %}`
  + `<tr><td><strong>${L.total}</strong></td><td style="text-align:right"><strong>{{ order.total }}</strong></td></tr></table>`
  + `{% if order.shipping_address %}<h3 style="margin:20px 0 4px;font-size:15px">${L.shipTo}</h3><p style="margin:0">{% for a in order.shipping_address %}{{ a }}{% unless forloop.last %}<br>{% endunless %}{% endfor %}</p>{% endif %}`
  + `<h3 style="margin:20px 0 4px;font-size:15px">${L.payment}</h3><p style="margin:0">{{ order.payment_method }} ({{ order.payment_status }})</p>`
  + `{% if order.bank_instructions %}<p style="background:#eff6ff;border-radius:6px;padding:12px">${L.bank}<br>{{ order.bank_instructions | escape | newline_to_br | raw }}</p>{% endif %}`;
const EN_BLOCK = { subtotal: 'Subtotal', discount: 'Discount', shipping: 'Shipping', tax: 'Taxes', total: 'Total', shipTo: 'Shipping address', payment: 'Payment', bank: 'Please transfer the total amount using the bank details below, quoting {{ order.name }}.' };
const FR_BLOCK = { subtotal: 'Sous-total', discount: 'Réduction', shipping: 'Livraison', tax: 'Taxes', total: 'Total', shipTo: 'Adresse de livraison', payment: 'Paiement', bank: 'Merci de virer le montant total avec les coordonnées ci-dessous en indiquant {{ order.name }}.' };
const questionsEn = '<p style="color:#64748b;font-size:13px;margin-top:24px">Questions? Reply to this email or write to {{ shop.email }}.</p>';
const questionsFr = '<p style="color:#64748b;font-size:13px;margin-top:24px">Une question ? Répondez à cet e-mail ou écrivez à {{ shop.email }}.</p>';
const button = (url: string, label: string) => `<p style="margin:24px 0"><a href="{{ ${url} }}" style="background:#1E40AF;color:#fff;padding:12px 20px;border-radius:6px;text-decoration:none;display:inline-block">${label}</a></p>`;
const tracking = (en: boolean) => `{% if fulfillment.tracking_number %}<p>${en ? 'Tracking' : 'Suivi'}: {% if fulfillment.tracking_url %}<a href="{{ fulfillment.tracking_url }}">{{ fulfillment.tracking_number }}</a>{% else %}{{ fulfillment.tracking_number }}{% endif %}{% if fulfillment.tracking_company %} ({{ fulfillment.tracking_company }}){% endif %}</p>{% endif %}`;

const ORDER_VARS = ['shop.name', 'shop.email', 'shop.url', 'order.name', 'order.email', 'order.note', 'order.total', 'order.subtotal', 'order.shipping', 'order.tax', 'order.discount', 'order.line_items', 'order.shipping_address', 'order.payment_method', 'order.payment_status', 'order.bank_instructions'];

const DEFS: Record<NotificationKey, Def> = {
  order_confirmation: {
    name: 'Order confirmation', description: 'Sent to the customer when an order is placed.', audience: 'customer', variables: ORDER_VARS,
    en: { subject: 'Order {{ order.name }} confirmed', body: `<p style="margin-top:0">Thank you for your order! We received your order {{ order.name }}.</p>${orderBlock(EN_BLOCK)}${questionsEn}` },
    fr: { subject: 'Commande {{ order.name }} confirmée', body: `<p style="margin-top:0">Merci pour votre commande ! Nous avons bien reçu votre commande {{ order.name }}.</p>${orderBlock(FR_BLOCK)}${questionsFr}` },
  },
  staff_new_order: {
    name: 'New order (staff)', description: 'Sent to the shop email address when an order is placed.', audience: 'staff', variables: ORDER_VARS,
    en: { subject: '[{{ shop.name }}] New order {{ order.name }}', body: `<p style="margin-top:0">New order {{ order.name }} from {{ order.email }}.</p>${orderBlock(EN_BLOCK)}` },
    fr: { subject: '[{{ shop.name }}] Nouvelle commande {{ order.name }}', body: `<p style="margin-top:0">Nouvelle commande {{ order.name }} de {{ order.email }}.</p>${orderBlock(FR_BLOCK)}` },
  },
  shipping_confirmation: {
    name: 'Shipping confirmation', description: 'Sent to the customer when a fulfillment is created with "notify customer".', audience: 'customer',
    variables: ['shop.name', 'order.name', 'fulfillment.name', 'fulfillment.tracking_number', 'fulfillment.tracking_url', 'fulfillment.tracking_company', 'fulfillment.line_items'],
    en: { subject: 'Your order {{ order.name }} is on its way', body: `<p style="margin-top:0">Good news: your order {{ order.name }} has shipped.</p>${tracking(true)}${lineTable('fulfillment.line_items')}${questionsEn}` },
    fr: { subject: 'Votre commande {{ order.name }} est en route', body: `<p style="margin-top:0">Bonne nouvelle : votre commande {{ order.name }} a été expédiée.</p>${tracking(false)}${lineTable('fulfillment.line_items')}${questionsFr}` },
  },
  shipping_update: {
    name: 'Shipping update', description: 'Sent to the customer when the tracking information of a shipment changes.', audience: 'customer',
    variables: ['shop.name', 'order.name', 'fulfillment.name', 'fulfillment.tracking_number', 'fulfillment.tracking_url', 'fulfillment.tracking_company'],
    en: { subject: 'Shipping update for order {{ order.name }}', body: `<p style="margin-top:0">The tracking details of your order {{ order.name }} have been updated.</p>${tracking(true)}${questionsEn}` },
    fr: { subject: 'Mise à jour de la livraison de la commande {{ order.name }}', body: `<p style="margin-top:0">Les informations de suivi de votre commande {{ order.name }} ont été mises à jour.</p>${tracking(false)}${questionsFr}` },
  },
  order_cancelled: {
    name: 'Order cancelled', description: 'Sent to the customer when an order is cancelled with "notify customer".', audience: 'customer', variables: [...ORDER_VARS, 'order.cancel_reason'],
    en: { subject: 'Order {{ order.name }} was cancelled', body: `<p style="margin-top:0">Your order {{ order.name }} has been cancelled.</p>{% if order.cancel_reason %}<p>Reason: {{ order.cancel_reason }}</p>{% endif %}<p>If you already paid, you will be refunded.</p>${questionsEn}` },
    fr: { subject: 'La commande {{ order.name }} a été annulée', body: `<p style="margin-top:0">Votre commande {{ order.name }} a été annulée.</p>{% if order.cancel_reason %}<p>Motif : {{ order.cancel_reason }}</p>{% endif %}<p>Si vous avez déjà payé, vous serez remboursé.</p>${questionsFr}` },
  },
  refund: {
    name: 'Refund', description: 'Sent to the customer when a refund is issued with "notify customer".', audience: 'customer', variables: ['shop.name', 'order.name', 'refund.amount', 'refund.note'],
    en: { subject: 'Refund for order {{ order.name }}', body: `<p style="margin-top:0">We issued a refund of <strong>{{ refund.amount }}</strong> for your order {{ order.name }}.</p>{% if refund.note %}<p>{{ refund.note }}</p>{% endif %}<p>It can take a few days to appear on your statement.</p>${questionsEn}` },
    fr: { subject: 'Remboursement de la commande {{ order.name }}', body: `<p style="margin-top:0">Nous avons émis un remboursement de <strong>{{ refund.amount }}</strong> pour votre commande {{ order.name }}.</p>{% if refund.note %}<p>{{ refund.note }}</p>{% endif %}<p>Il peut falloir quelques jours pour qu'il apparaisse sur votre relevé.</p>${questionsFr}` },
  },
  customer_account_welcome: {
    name: 'Customer account welcome', description: 'Sent to a customer after they create an account.', audience: 'customer', variables: ['shop.name', 'customer.first_name', 'customer.email', 'account_url'],
    en: { subject: 'Welcome to {{ shop.name }}', body: `<p style="margin-top:0">Hi {{ customer.first_name | default: 'there' }}, your account has been created.</p>${button('account_url', 'Visit your account')}` },
    fr: { subject: 'Bienvenue chez {{ shop.name }}', body: `<p style="margin-top:0">Bonjour {{ customer.first_name }}, votre compte a été créé.</p>${button('account_url', 'Accéder à mon compte')}` },
  },
  customer_account_invite: {
    name: 'Customer account invite', description: 'Invites a customer to activate their account.', audience: 'customer', variables: ['shop.name', 'customer.first_name', 'customer.email', 'activation_url'],
    en: { subject: 'Activate your {{ shop.name }} account', body: `<p style="margin-top:0">Hi {{ customer.first_name | default: 'there' }}, {{ shop.name }} invites you to activate your customer account.</p>${button('activation_url', 'Activate my account')}` },
    fr: { subject: 'Activez votre compte {{ shop.name }}', body: `<p style="margin-top:0">Bonjour {{ customer.first_name }}, {{ shop.name }} vous invite à activer votre compte client.</p>${button('activation_url', 'Activer mon compte')}` },
  },
  password_reset: {
    name: 'Password reset', description: 'Sent when a customer asks to reset their password.', audience: 'customer', variables: ['shop.name', 'customer.first_name', 'reset_url'],
    en: { subject: 'Reset your {{ shop.name }} password', body: `<p style="margin-top:0">Follow this link to choose a new password. If you did not ask for it, ignore this email.</p>${button('reset_url', 'Reset my password')}` },
    fr: { subject: 'Réinitialisez votre mot de passe {{ shop.name }}', body: `<p style="margin-top:0">Suivez ce lien pour choisir un nouveau mot de passe. Si vous n'êtes pas à l'origine de cette demande, ignorez cet e-mail.</p>${button('reset_url', 'Réinitialiser mon mot de passe')}` },
  },
  draft_order_invoice: {
    name: 'Draft order invoice', description: 'Sent with a payment link when you send an invoice for a draft order.', audience: 'customer',
    variables: ['shop.name', 'draft.name', 'draft.total', 'draft.subtotal', 'draft.line_items', 'invoice_url', 'custom_message'],
    en: { subject: 'Invoice {{ draft.name }} from {{ shop.name }}', body: `<p style="margin-top:0">{% if custom_message %}{{ custom_message }}{% else %}Here is your invoice from {{ shop.name }}.{% endif %}</p>${lineTable('draft.line_items')}<p style="text-align:right"><strong>Total: {{ draft.total }}</strong></p>${button('invoice_url', 'Complete your purchase')}` },
    fr: { subject: 'Facture {{ draft.name }} de {{ shop.name }}', body: `<p style="margin-top:0">{% if custom_message %}{{ custom_message }}{% else %}Voici votre facture de {{ shop.name }}.{% endif %}</p>${lineTable('draft.line_items')}<p style="text-align:right"><strong>Total : {{ draft.total }}</strong></p>${button('invoice_url', 'Finaliser mon achat')}` },
  },
  contact_form: {
    name: 'Contact form', description: 'Sent to the shop email address when a visitor submits the contact form.', audience: 'staff', variables: ['shop.name', 'contact.name', 'contact.email', 'contact.phone', 'contact.message'],
    en: { subject: '[{{ shop.name }}] New message from {{ contact.name | default: contact.email }}', body: '<p style="margin-top:0">From {{ contact.name }} &lt;{{ contact.email }}&gt;{% if contact.phone %} ({{ contact.phone }}){% endif %}:</p><p style="white-space:pre-wrap">{{ contact.message }}</p>' },
    fr: { subject: '[{{ shop.name }}] Nouveau message de {{ contact.name | default: contact.email }}', body: '<p style="margin-top:0">De {{ contact.name }} &lt;{{ contact.email }}&gt;{% if contact.phone %} ({{ contact.phone }}){% endif %} :</p><p style="white-space:pre-wrap">{{ contact.message }}</p>' },
  },
  staff_invite: {
    name: 'Staff invitation', description: 'Sent when you invite someone to your admin.', audience: 'staff', variables: ['shop.name', 'invite.url', 'invite.email', 'invite.role', 'invite.inviter'],
    en: { subject: 'You are invited to {{ shop.name }}', body: `<p style="margin-top:0">{% if invite.inviter %}{{ invite.inviter }} invited you{% else %}You are invited{% endif %} to manage {{ shop.name }} as <strong>{{ invite.role }}</strong>.</p>${button('invite.url', 'Accept the invitation')}<p style="color:#64748b;font-size:13px">The link expires in 7 days.</p>` },
    fr: { subject: 'Invitation à rejoindre {{ shop.name }}', body: `<p style="margin-top:0">{% if invite.inviter %}{{ invite.inviter }} vous invite{% else %}Vous êtes invité{% endif %} à gérer {{ shop.name }} avec le rôle <strong>{{ invite.role }}</strong>.</p>${button('invite.url', "Accepter l'invitation")}<p style="color:#64748b;font-size:13px">Le lien expire dans 7 jours.</p>` },
  },
  staff_login_alert: {
    name: 'Staff sign-in alert', description: 'Sent to a staff member when their account signs in to the admin.', audience: 'staff', variables: ['shop.name', 'login.email', 'login.ip', 'login.device', 'login.time'],
    en: { subject: 'New sign-in to {{ shop.name }}', body: '<p style="margin-top:0">Your account {{ login.email }} just signed in to the admin of {{ shop.name }}.</p><p style="color:#64748b">Time: {{ login.time }}<br>IP address: {{ login.ip }}<br>Device: {{ login.device }}</p><p>If this was not you, change your password and sign out the other sessions in Settings, Security.</p>' },
    fr: { subject: 'Nouvelle connexion à {{ shop.name }}', body: '<p style="margin-top:0">Votre compte {{ login.email }} vient de se connecter à l\'administration de {{ shop.name }}.</p><p style="color:#64748b">Heure : {{ login.time }}<br>Adresse IP : {{ login.ip }}<br>Appareil : {{ login.device }}</p><p>Si ce n\'était pas vous, changez votre mot de passe et déconnectez les autres sessions dans Paramètres, Sécurité.</p>' },
  },
  gift_card_issued: {
    name: 'Gift card', description: 'Sent to the recipient (or the buyer) when a gift card is issued.', audience: 'customer',
    variables: ['shop.name', 'gift_card.balance', 'gift_card.initial_value', 'gift_card.code', 'gift_card.last_characters', 'gift_card.url', 'gift_card.message', 'gift_card.recipient_name', 'gift_card.sender_email', 'gift_card.expires_on'],
    en: { subject: 'Your {{ shop.name }} gift card', body: `<p style="margin-top:0">{% if gift_card.recipient_name %}Hi {{ gift_card.recipient_name }}, {% endif %}you received a gift card for <strong>{{ gift_card.initial_value }}</strong>{% if gift_card.sender_email %} from {{ gift_card.sender_email }}{% endif %}.</p>{% if gift_card.message %}<blockquote style="margin:16px 0;padding:8px 16px;border-left:3px solid #cbd5e1">{{ gift_card.message }}</blockquote>{% endif %}<p style="font-size:20px;letter-spacing:2px;font-weight:bold">{{ gift_card.code }}</p>{% if gift_card.expires_on %}<p>Valid until {{ gift_card.expires_on }}.</p>{% endif %}${button('gift_card.url', 'View your gift card')}${questionsEn}` },
    fr: { subject: 'Votre carte cadeau {{ shop.name }}', body: `<p style="margin-top:0">{% if gift_card.recipient_name %}Bonjour {{ gift_card.recipient_name }}, {% endif %}vous avez reçu une carte cadeau de <strong>{{ gift_card.initial_value }}</strong>{% if gift_card.sender_email %} de la part de {{ gift_card.sender_email }}{% endif %}.</p>{% if gift_card.message %}<blockquote style="margin:16px 0;padding:8px 16px;border-left:3px solid #cbd5e1">{{ gift_card.message }}</blockquote>{% endif %}<p style="font-size:20px;letter-spacing:2px;font-weight:bold">{{ gift_card.code }}</p>{% if gift_card.expires_on %}<p>Valable jusqu'au {{ gift_card.expires_on }}.</p>{% endif %}${button('gift_card.url', 'Voir ma carte cadeau')}${questionsFr}` },
  },
  store_credit_account_credit: {
    name: 'Store credit issued', description: 'Sent to a customer when store credit is added to their account with "notify customer".', audience: 'customer',
    variables: ['shop.name', 'customer.first_name', 'store_credit.amount', 'store_credit.balance', 'store_credit.expires_on', 'account_url'],
    en: { subject: 'You received {{ store_credit.amount }} of store credit', body: `<p style="margin-top:0">Hi{% if customer.first_name %} {{ customer.first_name }}{% endif %}, <strong>{{ store_credit.amount }}</strong> of store credit was added to your {{ shop.name }} account.</p><p>Your balance is now <strong>{{ store_credit.balance }}</strong>.{% if store_credit.expires_on %} This credit expires on {{ store_credit.expires_on }}.{% endif %}</p>${button('account_url', 'Visit your account')}${questionsEn}` },
    fr: { subject: 'Vous avez reçu {{ store_credit.amount }} de crédit en magasin', body: `<p style="margin-top:0">Bonjour{% if customer.first_name %} {{ customer.first_name }}{% endif %}, <strong>{{ store_credit.amount }}</strong> de crédit en magasin ont été ajoutés à votre compte {{ shop.name }}.</p><p>Votre solde est maintenant de <strong>{{ store_credit.balance }}</strong>.{% if store_credit.expires_on %} Ce crédit expire le {{ store_credit.expires_on }}.{% endif %}</p>${button('account_url', 'Accéder à mon compte')}${questionsFr}` },
  },
  abandoned_checkout: {
    name: 'Abandoned checkout', description: 'Sent to a customer who left items in their checkout, with a link that restores the cart.', audience: 'customer',
    variables: ['shop.name', 'checkout.customer_first_name', 'checkout.line_items', 'checkout.subtotal', 'checkout.recovery_url'],
    en: { subject: 'You left something in your cart', body: `<p style="margin-top:0">Hi{% if checkout.customer_first_name %} {{ checkout.customer_first_name }}{% endif %}, you left items in your cart at {{ shop.name }}. They are waiting for you.</p>${lineTable('checkout.line_items')}<p style="text-align:right"><strong>{{ checkout.subtotal }}</strong></p>${button('checkout.recovery_url', 'Return to your checkout')}${questionsEn}` },
    fr: { subject: 'Vous avez oublié quelque chose dans votre panier', body: `<p style="margin-top:0">Bonjour{% if checkout.customer_first_name %} {{ checkout.customer_first_name }}{% endif %}, vous avez laissé des articles dans votre panier chez {{ shop.name }}. Ils vous attendent.</p>${lineTable('checkout.line_items')}<p style="text-align:right"><strong>{{ checkout.subtotal }}</strong></p>${button('checkout.recovery_url', 'Reprendre ma commande')}${questionsFr}` },
  },
};

// ---- rendering --------------------------------------------------------------------------------------------------------------

const html = new Liquid({ outputEscape: 'escape', strictVariables: false, strictFilters: false });
const plain = new Liquid({ strictVariables: false, strictFilters: false });
const langOf = (shop: Shop): 'en' | 'fr' => (shop.locale.slice(0, 2).toLowerCase() === 'fr' ? 'fr' : 'en');
const esc = (v: unknown) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export const shopUrl = (shop: Shop, appUrl: string) => (shop.primaryDomain ? `https://${shop.primaryDomain}` : appUrl).replace(/\/$/, '');

function layout(shop: Shop, inner: string): string {
  return `<!doctype html><html><body style="margin:0;background:#f1f5f9;font-family:Arial,Helvetica,sans-serif;color:#0f172a"><div style="max-width:560px;margin:0 auto;padding:24px">`
    + `<div style="background:#1E40AF;color:#fff;padding:20px 24px;border-radius:8px 8px 0 0;font-size:20px;font-weight:bold">${esc(shop.name)}</div>`
    + `<div style="background:#fff;padding:24px;border-radius:0 0 8px 8px">${inner}</div></div></body></html>`;
}

/** Plain-text alternative derived from the HTML body. */
export function htmlToText(h: string): string {
  return h.replace(/<(br|\/p|\/tr|\/h3|\/div)\s*\/?>/gi, '\n').replace(/<\/td>/gi, '  ').replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&times;/g, 'x').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
    .replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

export interface TemplateView {
  key: NotificationKey; name: string; description: string; audience: 'customer' | 'staff'; variables: string[];
  subject: string; body: string; defaultSubject: string; defaultBody: string; customized: boolean; updatedAt: Date | null;
  /** False when the merchant switched the notification off. */
  enabled: boolean; toggleable: boolean;
}

export const defaultTemplate = (shop: Shop, key: NotificationKey): Lang => DEFS[key][langOf(shop)];

async function overrideOf(db: Executor, shopId: number, key: string) {
  return (await db.select().from(notificationTemplates).where(and(eq(notificationTemplates.shopId, shopId), eq(notificationTemplates.key, key))).limit(1))[0] ?? null;
}

export async function listNotificationTemplates(db: Executor, shop: Shop): Promise<TemplateView[]> {
  const rows = await db.select().from(notificationTemplates).where(eq(notificationTemplates.shopId, shop.id));
  return NOTIFICATION_KEYS.map((key) => {
    const d = DEFS[key]; const def = d[langOf(shop)]; const o = rows.find((r) => r.key === key);
    return { key, name: d.name, description: d.description, audience: d.audience, variables: d.variables, subject: o?.subject ?? def.subject, body: o?.body ?? def.body, defaultSubject: def.subject, defaultBody: def.body, customized: !!o, updatedAt: o?.updatedAt ?? null, enabled: notificationEnabled(shop, key), toggleable: isToggleable(key) };
  });
}

/** Validate Liquid syntax; returns the error message or null. */
export function liquidError(source: string): string | null {
  try { html.parse(source); return null; } catch (e) { return e instanceof Error ? e.message : 'Invalid template'; }
}

export async function saveNotificationTemplate(db: Executor, shopId: number, key: NotificationKey, subject: string, body: string): Promise<void> {
  await db.insert(notificationTemplates).values({ shopId, key, subject, body })
    .onConflictDoUpdate({ target: [notificationTemplates.shopId, notificationTemplates.key], set: { subject, body, updatedAt: new Date() } });
}

export async function resetNotificationTemplate(db: Executor, shopId: number, key: NotificationKey): Promise<void> {
  await db.delete(notificationTemplates).where(and(eq(notificationTemplates.shopId, shopId), eq(notificationTemplates.key, key)));
}

export interface Rendered { subject: string; html: string; text: string }

/** Render a template (merchant override or default) with `vars`; `shop` is always added to the Liquid context. */
export async function renderNotification(db: Executor, shop: Shop, appUrl: string, key: NotificationKey, vars: Record<string, unknown>, override?: Lang): Promise<Rendered> {
  const o = override ?? (await overrideOf(db, shop.id, key)) ?? defaultTemplate(shop, key);
  const ctx = { shop: { name: shop.name, email: shop.email, url: shopUrl(shop, appUrl) }, ...vars };
  const subject = (await plain.parseAndRender(o.subject, ctx)).replace(/\s+/g, ' ').trim();
  const inner = await html.parseAndRender(o.body, ctx);
  return { subject, html: layout(shop, inner), text: htmlToText(inner) };
}

// ---- sender and sending -----------------------------------------------------------------------------------------------------

export interface NotificationSettings { senderName: string; senderEmail: string }
export const notificationSettingsOf = (shop: Shop): NotificationSettings => {
  const n = (shop.settings.notifications ?? {}) as Partial<NotificationSettings>;
  return { senderName: n.senderName ?? '', senderEmail: n.senderEmail ?? '' };
};

export async function updateNotificationSettings(db: Executor, shop: Shop, i: Partial<NotificationSettings>): Promise<NotificationSettings | { error: string }> {
  const cur = notificationSettingsOf(shop);
  const next = { senderName: (i.senderName ?? cur.senderName).trim().slice(0, 100), senderEmail: (i.senderEmail ?? cur.senderEmail).trim() };
  if (next.senderEmail && !/^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/.test(next.senderEmail)) return { error: 'Sender email is invalid' };
  if (/[<>"\r\n]/.test(next.senderName)) return { error: 'Sender name contains invalid characters' };
  await db.update(shops).set({ settings: { ...shop.settings, notifications: next }, updatedAt: new Date() }).where(eq(shops.id, shop.id));
  return next;
}

/** From header from the sender settings (needs an email; the name alone is ignored), else the mailer default. */
export function senderOf(shop: Shop): string | undefined {
  const { senderName, senderEmail } = notificationSettingsOf(shop);
  return senderEmail ? (senderName ? `"${senderName}" <${senderEmail}>` : senderEmail) : undefined;
}

// ---- per-notification switches and staff recipients -----------------------------------------------------------------------

/** Notifications the merchant can switch off. The others (password reset, invitations, sign-in alerts, invoices...) are transactional and always sent. */
export const TOGGLEABLE_NOTIFICATIONS: readonly NotificationKey[] = [
  'order_confirmation', 'staff_new_order', 'shipping_confirmation', 'shipping_update', 'order_cancelled', 'refund', 'abandoned_checkout', 'gift_card_issued', 'store_credit_account_credit',
];
export const isToggleable = (key: NotificationKey) => TOGGLEABLE_NOTIFICATIONS.includes(key);

const disabledOf = (shop: Pick<Shop, 'settings'>): string[] => {
  const v = (shop.settings as Record<string, unknown>).notificationsDisabled;
  return Array.isArray(v) ? v.filter((k): k is string => typeof k === 'string') : [];
};
export const notificationEnabled = (shop: Pick<Shop, 'settings'>, key: NotificationKey) => !isToggleable(key) || !disabledOf(shop).includes(key);

export async function setNotificationEnabled(db: Executor, shop: Shop, key: NotificationKey, enabled: boolean): Promise<{ error: string } | { enabled: boolean }> {
  if (!isToggleable(key)) return { error: 'This notification is always sent' };
  const off = new Set(disabledOf(shop));
  if (enabled) off.delete(key); else off.add(key);
  await db.update(shops).set({ settings: { ...shop.settings, notificationsDisabled: [...off] }, updatedAt: new Date() }).where(eq(shops.id, shop.id));
  return { enabled };
}

const EMAIL = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;

/** Who receives "New order": the saved recipients, or the store contact email while none are saved. */
export function staffOrderRecipientsOf(shop: Pick<Shop, 'settings' | 'email'>): { emails: string[]; custom: boolean } {
  const v = (shop.settings as Record<string, unknown>).staffOrderRecipients;
  const list = Array.isArray(v) ? v.filter((e): e is string => typeof e === 'string' && EMAIL.test(e)) : [];
  return list.length ? { emails: list, custom: true } : { emails: shop.email ? [shop.email] : [], custom: false };
}

export async function updateStaffOrderRecipients(db: Executor, shop: Shop, emails: string[]): Promise<{ error: string } | { emails: string[]; custom: boolean }> {
  const clean = [...new Set(emails.map((e) => e.trim().toLowerCase()).filter(Boolean))];
  const bad = clean.find((e) => !EMAIL.test(e) || e.length > 254);
  if (bad) return { error: `${bad} is not a valid email address` };
  if (clean.length > 20) return { error: 'You can add up to 20 recipients' };
  const settings = { ...shop.settings, staffOrderRecipients: clean };
  await db.update(shops).set({ settings, updatedAt: new Date() }).where(eq(shops.id, shop.id));
  return staffOrderRecipientsOf({ ...shop, settings });
}

/** Send one email. A switched-off notification is skipped (returns false) unless `force` (test emails, explicit staff actions). */
export async function sendNotification(db: Executor, mailer: Mailer, shop: Shop, appUrl: string, key: NotificationKey, to: string, vars: Record<string, unknown>, opts: { force?: boolean } = {}): Promise<boolean> {
  if (!opts.force && !notificationEnabled(shop, key)) return false;
  const r = await renderNotification(db, shop, appUrl, key, vars);
  const mail: Mail = { to, subject: r.subject, html: r.html, text: r.text, from: senderOf(shop), replyTo: DEFS[key].audience === 'customer' ? shop.email : undefined };
  await mailer.send(mail);
  return true;
}

/** "New order" email to every staff recipient. Returns how many were sent. */
export async function sendStaffNewOrder(db: Executor, mailer: Mailer, shop: Shop, appUrl: string, vars: Record<string, unknown>): Promise<number> {
  let n = 0;
  for (const to of staffOrderRecipientsOf(shop).emails) if (await sendNotification(db, mailer, shop, appUrl, 'staff_new_order', to, vars)) n++;
  return n;
}

// ---- Liquid variables -------------------------------------------------------------------------------------------------------

const GATEWAYS: Record<string, Record<string, string>> = {
  en: { bank_transfer: 'Bank transfer', cod: 'Cash on delivery', stripe: 'Card', free: 'No payment due', manual: 'Manual', paid: 'Paid', pending: 'Awaiting payment', gift_card: 'Gift card', store_credit: 'Store credit' },
  fr: { bank_transfer: 'Virement bancaire', cod: 'Paiement à la livraison', stripe: 'Carte bancaire', free: 'Aucun paiement dû', manual: 'Manuel', paid: 'Payé', pending: 'En attente de paiement', gift_card: 'Carte cadeau', store_credit: 'Crédit en magasin' },
};

/** Money in `currency`; the shop's own format applies to the shop currency, other currencies get a generated one. */
export const moneyOf = (shop: Shop, minor: number, currency = shop.currency) => renderMoneyFormat(currency === shop.currency ? shop.moneyFormat : defaultMoneyFormats(currency, shop.locale).moneyFormat, minor, currency);

function bankInstructions(shop: Shop): string | null {
  const s = shop.settings as Record<string, any>;
  const v = s['payments.manual.bankTransfer'] ?? s.payments?.manual?.bankTransfer;
  return typeof v?.instructions === 'string' && v.instructions ? v.instructions : null;
}

export function orderVars(o: OrderSummary, shop: Shop): Record<string, unknown> {
  const L = GATEWAYS[langOf(shop)]!;
  const om = orderMoney(o.order);
  const money = (n: number) => moneyOf(shop, n, om.currency);
  const paid = o.order.financialStatus === 'PAID';
  const gateway = o.transactions[0]?.gateway ?? 'free';
  const a = o.shippingAddress;
  const address = a ? [[a.firstName, a.lastName].filter(Boolean).join(' '), a.company, a.address1, a.address2, [a.zip, a.city].filter(Boolean).join(' '), a.province, a.country ?? a.countryCode].filter(Boolean) as string[] : [];
  return {
    order: {
      name: o.order.name, email: o.order.email, note: o.order.note, created_at: o.order.createdAt.toISOString(),
      subtotal: money(om.subtotal), total: money(om.total), discount: om.discounts ? money(om.discounts) : null,
      shipping: o.shippingLines.length ? money(om.shipping) : null,
      tax: om.tax ? money(om.tax) : null, tax_label: langOf(shop) === 'fr' ? (o.order.taxesIncluded ? 'Dont taxes' : 'Taxes') : (o.order.taxesIncluded ? 'Included taxes' : 'Taxes'),
      line_items: o.lines.map((l) => ({ title: [l.title, l.variantTitle].filter(Boolean).join(' - '), quantity: l.quantity, total: money(lineMoney(o.order, l).discountedTotal) })),
      shipping_address: address.length ? address : null,
      payment_method: L[gateway] ?? gateway, payment_status: paid ? L.paid : L.pending, paid,
      bank_instructions: !paid && gateway === 'bank_transfer' ? bankInstructions(shop) : null,
      cancel_reason: o.order.cancelReason ? o.order.cancelReason.toLowerCase() : null,
    },
  };
}

/** Realistic sample data for previews. */
export function sampleVars(shop: Shop, appUrl: string): Record<string, unknown> {
  const money = (n: number) => moneyOf(shop, n);
  const items = [{ title: 'Sample product - Medium', quantity: 2, total: money(4000) }, { title: 'Another product', quantity: 1, total: money(1500) }];
  const order = {
    name: '#1001', email: 'customer@example.com', note: null, created_at: new Date().toISOString(), subtotal: money(5500), total: money(6490), discount: null, shipping: money(490), tax: money(1082), tax_label: 'Taxes',
    line_items: items, shipping_address: ['Ada Lovelace', '1 Rue de Rivoli', '75001 Paris', 'France'], payment_method: GATEWAYS[langOf(shop)]!.stripe, payment_status: GATEWAYS[langOf(shop)]!.paid, paid: true,
    bank_instructions: null, cancel_reason: 'customer',
  };
  const customer = { first_name: 'Ada', last_name: 'Lovelace', email: 'customer@example.com' };
  const base = shopUrl(shop, appUrl);
  return {
    order, customer,
    fulfillment: { name: '#1001.1', tracking_number: '1Z999AA10123456784', tracking_url: 'https://tracking.example.com/1Z999AA10123456784', tracking_company: 'UPS', line_items: items.map((i) => ({ title: i.title, quantity: i.quantity })) },
    refund: { amount: money(1500), note: 'Item returned' },
    account_url: `${base}/account`, activation_url: `${base}/account/activate/sample-token`, reset_url: `${base}/account/reset/sample-token`,
    draft: { name: '#D1', subtotal: money(5500), total: money(6490), line_items: items }, invoice_url: `${base}/draft_orders/sample-token/pay`, custom_message: null,
    contact: { name: 'Ada Lovelace', email: 'ada@example.com', phone: '+33 1 23 45 67 89', message: 'Hello, do you ship to Canada?' },
    invite: { url: `${base}/admin/invite/sample-token`, email: 'new.staff@example.com', role: 'staff', inviter: 'The owner' },
    gift_card: { balance: money(5000), initial_value: money(5000), code: 'ABCD-EFGH-JKLM-NPQR', last_characters: 'npqr', url: `${base}/gift_cards/sample-token`, message: 'Happy birthday!', recipient_name: 'Ada', sender_email: 'friend@example.com', expires_on: null },
    store_credit: { amount: money(2000), balance: money(3500), expires_on: null },
    checkout: { customer_first_name: 'Ada', line_items: items, subtotal: money(5500), recovery_url: `${base}/checkouts/sample-token/recover` },
  };
}
