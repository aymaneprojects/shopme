import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  confirmSubscription, CONSENT_COOKIE, CONSENT_COOKIE_MAX_AGE, CONSENT_VERSION, connectedPixels, consentAnswer, consentFromCustomer, decodeConsentCookie, getPixel, listConsentPolicies, optOutOfDataSale, policiesOf, policyFor,
  privacySettingsOf, recordStorefrontEvents, resolveVisitorConsent, saveCustomerConsent, schema as s, type ConsentCookie, type Customer, type PixelRow, type PrivacySettings, type RegionPolicy, type Shop, type VisitorConsent,
} from '@shopme/core';
import { eq } from 'drizzle-orm';
import type { AppContext } from '../context';
import { FailureLimiter } from '../plugins/rate-limit';
import { customerOf, makeEnv } from './env';
import { crossSite, formBody } from './forms';
import { messages } from './i18n';
import type { createContent } from './pages';
import { pixelDocument, RUNTIME_JS, RUNTIME_VERSION } from './privacy-runtime';

/** Everything the storefront knows about the visitor's privacy situation for one request. */
export interface PrivacyEnv {
  settings: PrivacySettings;
  policy: RegionPolicy;
  consent: VisitorConsent;
  customerConsent: ConsentCookie | null;
  country: string | null;
  region: string | null;
  gpc: boolean;
  pixels: PixelRow[];
}

const header = (req: FastifyRequest, name: string): string | null => { const v = req.headers[name]; return typeof v === 'string' && v.trim() ? v.trim() : null; };

/**
 * Visitor region: the country header set by the CDN or proxy in front (Cloudflare, Vercel), else the shop country. IP geolocation of our own is
 * not built in, so a self-hosted store without such a proxy treats every visitor as being in the shop's country.
 */
export function visitorRegion(req: FastifyRequest, shop: Pick<Shop, 'country'>): { country: string | null; region: string | null } {
  const raw = header(req, 'cf-ipcountry') ?? header(req, 'x-vercel-ip-country');
  const country = raw && /^[A-Za-z]{2}$/.test(raw) && !['XX', 'T1'].includes(raw.toUpperCase()) ? raw.toUpperCase() : shop.country?.toUpperCase() || null;
  const region = header(req, 'cf-region-code') ?? header(req, 'x-vercel-ip-country-region');
  return { country, region: region ? region.toUpperCase().slice(0, 3) : null };
}

/** The cookie of this request: ours, or the answer of the former banner (`shopme_consent` / `cookie_consent` = accepted). */
export function consentCookieOf(req: FastifyRequest): ConsentCookie | null {
  const own = decodeConsentCookie(req.cookies?.[CONSENT_COOKIE]);
  if (own) return own;
  const legacy = String(req.cookies?.shopme_consent ?? req.cookies?.cookie_consent ?? '').toLowerCase();
  if (legacy === 'accepted' || legacy === 'all' || legacy === 'true' || legacy === 'yes') return { v: CONSENT_VERSION, analytics: 'yes', marketing: 'yes', preferences: 'yes', saleOfData: 'yes', ts: 1 };
  if (legacy === 'declined') return { v: CONSENT_VERSION, analytics: 'no', marketing: 'no', preferences: 'no', saleOfData: 'no', ts: 1 };
  return null;
}

export async function privacyEnvFor(ctx: AppContext, req: FastifyRequest, shop: Shop, customer: Customer | null): Promise<PrivacyEnv> {
  const settings = privacySettingsOf(shop);
  const { country, region } = visitorRegion(req, shop);
  const rows = settings.mode === 'MANUAL' ? await listConsentPolicies(ctx.db, shop.id) : [];
  const policy = policyFor(settings, rows, country, region);
  const gpc = req.headers['sec-gpc'] === '1';
  const customerConsent = consentFromCustomer(customer?.consent);
  const consent = resolveVisitorConsent({ bannerMode: settings.cookieBanner.mode, policy, cookie: consentCookieOf(req), customerConsent, customerOptOut: !!customer?.dataSaleOptOut, gpc, country, region });
  return { settings, policy, consent, customerConsent, country, region, gpc, pixels: await connectedPixels(ctx.db, shop.id) };
}

/** May first-party analytics count this request? (Region policy and the visitor's cookie; the signed-in customer's saved copy is not consulted here.) */
export async function analyticsAllowed(ctx: AppContext, req: FastifyRequest, shop: Shop): Promise<boolean> {
  const settings = privacySettingsOf(shop);
  const { country, region } = visitorRegion(req, shop);
  const rows = settings.mode === 'MANUAL' ? await listConsentPolicies(ctx.db, shop.id) : [];
  const policy = policyFor(settings, rows, country, region);
  return resolveVisitorConsent({ bannerMode: settings.cookieBanner.mode, policy, cookie: consentCookieOf(req), country, region }).allowed.analytics;
}

const TEXT = {
  en: {
    title: 'Cookie consent', accept: 'Accept all', reject: 'Decline', manage: 'Manage preferences', managePreferences: 'Cookie preferences', save: 'Save preferences', privacyPolicy: 'Privacy policy',
    categories: { analytics: 'Analytics', marketing: 'Marketing', preferences: 'Preferences' },
    categoryHelp: { analytics: 'Helps us understand how the store is used.', marketing: 'Lets us and our partners show relevant offers.', preferences: 'Remembers your choices such as language or region.' },
  },
  fr: {
    title: 'Consentement aux cookies', accept: 'Tout accepter', reject: 'Refuser', manage: 'Gérer les préférences', managePreferences: 'Préférences en matière de cookies', save: 'Enregistrer les préférences', privacyPolicy: 'Politique de confidentialité',
    categories: { analytics: 'Statistiques', marketing: 'Marketing', preferences: 'Préférences' },
    categoryHelp: { analytics: 'Nous aide à comprendre comment la boutique est utilisée.', marketing: 'Nous permet, ainsi qu\'à nos partenaires, de proposer des offres pertinentes.', preferences: 'Mémorise vos choix, comme la langue ou la région.' },
  },
} as const;
export const privacyText = (locale: string) => (locale.slice(0, 2).toLowerCase() === 'fr' ? TEXT.fr : TEXT.en);

const DEFAULT_MESSAGE_FR = 'Nous utilisons des cookies pour améliorer votre expérience.';
/** Banner text: the merchant's own words, else the default in the shop language. */
export function bannerMessage(shop: Shop, env: Pick<PrivacyEnv, 'settings'>): string {
  const m = env.settings.cookieBanner.message;
  return m === 'We use cookies to improve your experience.' && shop.locale.slice(0, 2).toLowerCase() === 'fr' ? DEFAULT_MESSAGE_FR : m;
}

export const privacyPolicyUrl = (shop: Shop): string | null => (policiesOf(shop).find((p) => p.type === 'PRIVACY_POLICY')?.body.trim() ? '/policies/privacy-policy' : null);
export const OPT_OUT_PATH = '/pages/data-sale-opt-out';

export interface PageDescriptor { type: string; events?: { name: string; data?: unknown; once?: string }[] }

/** Configuration read by the runtime (JSON in the page head). */
export function privacyConfig(shop: Shop, env: PrivacyEnv, page: PageDescriptor, customer: Customer | null, locale = shop.locale) {
  return {
    cookie: { name: CONSENT_COOKIE, version: CONSENT_VERSION, maxAge: CONSENT_COOKIE_MAX_AGE },
    policy: { consentRequired: env.policy.consentRequired, dataSaleOptOutRequired: env.policy.dataSaleOptOutRequired, level: env.policy.level, bannerMode: env.settings.cookieBanner.mode, gpc: env.gpc, customerOptOut: !!customer?.dataSaleOptOut },
    region: [env.country, env.region].filter(Boolean).join('-'),
    customerConsent: env.customerConsent,
    banner: { message: bannerMessage(shop, env), position: env.settings.cookieBanner.position },
    labels: privacyText(locale),
    policyUrls: { privacy: privacyPolicyUrl(shop), optOut: env.policy.dataSaleOptOutRequired && env.settings.dataSaleOptOutPage === 'AUTO' ? OPT_OUT_PATH : null },
    endpoints: { consent: '/.shopme/consent', events: '/.shopme/events' },
    currency: shop.currency, shop: { id: String(shop.id), name: shop.name, currency: shop.currency, locale },
    customer: customer ? { id: String(customer.id), ordersCount: customer.numberOfOrders } : null,
    pixels: env.pixels.map((p) => ({ id: p.id, name: p.name, requiredConsent: p.requiredConsent, respectSaleOptOut: p.respectSaleOptOut, domEvents: p.domEvents, settings: {} })),
    page,
  };
}

const escJson = (v: unknown) => JSON.stringify(v).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');

/** `<script>` pair injected in the `<head>`: configuration, then the runtime (synchronous, so `Shopify.customerPrivacy` exists for theme scripts). */
export function privacyHead(shop: Shop, env: PrivacyEnv, page: PageDescriptor, customer: Customer | null, locale?: string): string {
  return `<script type="application/json" id="shopme-privacy-config">${escJson(privacyConfig(shop, env, page, customer, locale))}</script><script src="/.shopme/runtime.js?v=${RUNTIME_VERSION}"></script>`;
}

/** Insert markup before `</head>` (or after `<head>`, or at the start when the layout has no head). */
export function injectHead(html: string, markup: string): string {
  const low = html.toLowerCase();
  const end = low.indexOf('</head>');
  if (end !== -1) return html.slice(0, end) + markup + html.slice(end);
  const open = low.indexOf('<head');
  if (open !== -1) { const close = html.indexOf('>', open); if (close !== -1) return html.slice(0, close + 1) + markup + html.slice(close + 1); }
  return markup + html;
}

const asMoney = (cents: number, currency: string) => ({ amount: Math.round(cents) / 100, currencyCode: currency });

/** Page-specific standard events, built from what the page template renders. */
export function pageDescriptor(pageType: string, extra: Record<string, any> | undefined, currency: string): PageDescriptor {
  const events: NonNullable<PageDescriptor['events']> = [];
  if (pageType === 'product' && extra?.product) {
    const p = extra.product;
    const v = p.selected_or_first_available_variant ?? p.variants?.[0];
    events.push({ name: 'product_viewed', data: { productVariant: {
      id: String(v?.id ?? ''), title: v?.title ?? p.title, sku: v?.sku ?? '', price: asMoney(v?.price ?? p.price ?? 0, currency), image: p.featured_image ? { src: p.featured_image.src ?? p.featured_image } : null,
      product: { id: String(p.id), title: p.title, vendor: p.vendor ?? '', type: p.type ?? '', url: p.url },
    } } });
  } else if (pageType === 'collection' && extra?.collection) {
    events.push({ name: 'collection_viewed', data: { collection: { id: String(extra.collection.id), title: extra.collection.title, handle: extra.collection.handle } } });
  } else if (pageType === 'search' && extra?.search?.performed) {
    events.push({ name: 'search_submitted', data: { searchResult: { query: extra.search.terms, productVariants: [] } } });
  } else if (pageType === 'cart') {
    events.push({ name: 'cart_viewed', data: {} });
  }
  return { type: pageType, events };
}

/** Liquid `privacy` object: what a theme needs to draw its own banner and links. */
export function privacyLiquid(shop: Shop, env: PrivacyEnv) {
  const optOut = env.policy.dataSaleOptOutRequired && env.settings.dataSaleOptOutPage === 'AUTO';
  return {
    consent_required: env.policy.consentRequired, data_sale_opt_out_required: optOut, banner_enabled: env.settings.cookieBanner.mode !== 'OFF', banner_mode: env.settings.cookieBanner.mode,
    banner_message: bannerMessage(shop, env), banner_position: env.settings.cookieBanner.position, privacy_policy_url: privacyPolicyUrl(shop), data_sale_opt_out_url: optOut ? OPT_OUT_PATH : null,
    should_show_banner: env.consent.shouldShowBanner, region: [env.country, env.region].filter(Boolean).join('-'),
  };
}

const answerOf = (v: unknown): boolean | 'yes' | 'no' | undefined => (typeof v === 'boolean' ? v : v === 'yes' || v === 'no' ? v : undefined);

/**
 * Privacy routes of the storefront: the runtime script, consent state and answers, the first-party event intake, pixel sandbox documents and
 * the data-sale opt-out page.
 */
export function registerPrivacyRoutes(app: FastifyInstance, ctx: AppContext, content: ReturnType<typeof createContent>): void {
  const { db } = ctx;
  const secure = ctx.config.appUrl.startsWith('https://');
  const eventLimiter = new FailureLimiter(240, 60_000);
  const optOutLimiter = new FailureLimiter(8, 10 * 60_000);

  app.get('/.shopme/runtime.js', async (_req, reply) => reply.header('cache-control', 'public, max-age=3600').type('text/javascript; charset=utf-8').send(RUNTIME_JS));

  app.get('/.shopme/consent.json', content.withShop(async (req, reply, shop) => {
    const customer = await customerOf(ctx, req, shop);
    const env = await privacyEnvFor(ctx, req, shop, customer);
    return reply.header('cache-control', 'no-store').send({
      consent: { analytics: env.consent.analytics, marketing: env.consent.marketing, preferences: env.consent.preferences, sale_of_data: env.consent.saleOfData, allowed: env.consent.allowed },
      shouldShowBanner: env.consent.shouldShowBanner, consentRequired: env.policy.consentRequired, dataSaleOptOutRequired: env.policy.dataSaleOptOutRequired, region: env.country, regionCode: env.region,
      banner: { mode: env.settings.cookieBanner.mode, message: bannerMessage(shop, env), position: env.settings.cookieBanner.position }, policyUrls: privacyConfig(shop, env, { type: 'api' }, customer).policyUrls,
    });
  }));

  /** The visitor answered: store the cookie (the runtime already wrote it; this covers headless storefronts) and keep a copy on a signed-in customer. */
  app.post('/.shopme/consent', content.withShop(async (req, reply, shop) => {
    if (crossSite(req)) return reply.code(403).send('');
    const b = (req.body ?? {}) as Record<string, unknown>;
    const prev = consentCookieOf(req);
    const { country, region } = visitorRegion(req, shop);
    const next = consentAnswer(prev, { analytics: answerOf(b.analytics) as never, marketing: answerOf(b.marketing) as never, preferences: answerOf(b.preferences) as never, saleOfData: answerOf(b.sale_of_data) as never }, [country, region].filter(Boolean).join('-'));
    reply.setCookie(CONSENT_COOKIE, JSON.stringify(next), { path: '/', sameSite: 'lax', httpOnly: false, maxAge: CONSENT_COOKIE_MAX_AGE, secure });
    const customer = await customerOf(ctx, req, shop);
    if (customer) {
      await saveCustomerConsent(db, shop.id, customer.id, next as unknown as Record<string, unknown>);
      if (next.saleOfData && next.saleOfData !== (customer.dataSaleOptOut ? 'no' : 'yes')) await db.update(s.customers).set({ dataSaleOptOut: next.saleOfData === 'no' }).where(eq(s.customers.id, customer.id));
    }
    return reply.header('cache-control', 'no-store').send({ ok: true, consent: next });
  }));

  /** First-party event intake. Needs analytics consent as resolved on the server from the cookie and the region; otherwise nothing is stored. */
  app.post('/.shopme/events', content.withShop(async (req, reply, shop) => {
    const key = `ip:${req.ip}`;
    if (eventLimiter.isLimited(key)) return reply.code(429).send('');
    eventLimiter.fail(key);
    const customer = await customerOf(ctx, req, shop);
    const env = await privacyEnvFor(ctx, req, shop, customer);
    if (!env.consent.allowed.analytics || req.headers.dnt === '1') return reply.code(204).send();
    const events = Array.isArray((req.body as { events?: unknown } | undefined)?.events) ? ((req.body as { events: unknown[] }).events as never[]) : [];
    await recordStorefrontEvents(db, shop.id, events, { customerId: customer?.id ?? null });
    return reply.code(204).send();
  }));

  /** Sandbox document of a connected pixel: framed by the runtime with `sandbox="allow-scripts"` only once its consent exists. */
  app.get('/.shopme/pixels/:id', content.withShop(async (req, reply, shop) => {
    const id = Number((req.params as { id: string }).id);
    const pixel = Number.isInteger(id) ? await getPixel(db, shop.id, id) : null;
    if (!pixel || !pixel.connected || pixel.kind !== 'CUSTOM') return reply.code(404).send('');
    return reply.header('cache-control', 'no-store').header('content-security-policy', "sandbox allow-scripts; frame-ancestors 'self'").type('text/html; charset=utf-8').send(pixelDocument({ name: pixel.name, code: pixel.code ?? '' }));
  }));

  // --- data sale opt-out page
  const optOutBody = (shop: Shop, flash: { done?: boolean; error?: string; email?: string }) => {
    const fr = shop.locale.slice(0, 2).toLowerCase() === 'fr';
    const esc = (v: string) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    return [
      `<p>${fr ? 'Vous pouvez refuser que vos données personnelles soient vendues ou partagées à des fins de publicité ciblée. Saisissez l\'adresse e-mail liée à vos commandes ou à votre compte.' : 'You can opt out of the sale or sharing of your personal information for targeted advertising. Enter the email address linked to your orders or account.'}</p>`,
      flash.done ? `<p role="status"><strong>${fr ? 'Votre demande a été enregistrée.' : 'Your request was recorded.'}</strong></p>` : '',
      flash.error ? `<p role="alert" class="form-errors">${esc(flash.error)}</p>` : '',
      `<form method="post" action="${OPT_OUT_PATH}" class="customer__form"><div class="field"><label for="OptOutEmail">${fr ? 'E-mail' : 'Email'}</label><input id="OptOutEmail" type="email" name="email" value="${esc(flash.email ?? '')}" autocomplete="email" required></div>`
      + `<button class="button" type="submit">${fr ? 'Refuser la vente et le partage de mes données' : 'Opt out of data sale and sharing'}</button></form>`,
    ].join('');
  };
  const optOutPage = async (req: FastifyRequest, reply: FastifyReply, shop: Shop, flash: { done?: boolean; error?: string; email?: string }) => {
    const env = await makeEnv(ctx, req, shop);
    const fr = shop.locale.slice(0, 2).toLowerCase() === 'fr';
    const title = fr ? 'Ne pas vendre ni partager mes informations personnelles' : 'Do not sell or share my personal information';
    reply.header('cache-control', 'no-store');
    return content.renderTemplate(req, reply, env, { template: 'page', pageType: 'page', title, suffix: null, extra: { page: { id: 0, title, handle: 'data-sale-opt-out', url: OPT_OUT_PATH, content: optOutBody(shop, flash), seo: { title, description: '' }, template_suffix: '' } } });
  };
  app.get(OPT_OUT_PATH, content.withShop(async (req, reply, shop) => {
    if (privacySettingsOf(shop).dataSaleOptOutPage === 'OFF') return content.notFound(req, reply, shop);
    const done = (req.query as Record<string, unknown>).done === '1';
    return optOutPage(req, reply, shop, { done });
  }));
  app.post(OPT_OUT_PATH, content.withShop(async (req, reply, shop) => {
    if (crossSite(req)) return reply.code(403).send('');
    if (privacySettingsOf(shop).dataSaleOptOutPage === 'OFF') return content.notFound(req, reply, shop);
    const email = String(formBody(req).email ?? '').trim();
    const key = `ip:${req.ip}`;
    if (optOutLimiter.isLimited(key)) return reply.code(429).type('text/html; charset=utf-8').send(messages(shop.locale).t('rate_limited'));
    optOutLimiter.fail(key);
    const r = await optOutOfDataSale(db, shop.id, email);
    if (!r.ok) return optOutPage(req, reply, shop, { error: messages(shop.locale).fieldErrors(r.errors).email ?? r.errors[0]?.message ?? 'Invalid email', email });
    // The opt-out also travels with the browser: the cookie says no to the sale of data.
    const next = consentAnswer(consentCookieOf(req), { saleOfData: 'no' });
    reply.setCookie(CONSENT_COOKIE, JSON.stringify(next), { path: '/', sameSite: 'lax', httpOnly: false, maxAge: CONSENT_COOKIE_MAX_AGE, secure });
    return reply.redirect(`${OPT_OUT_PATH}?done=1`, 303);
  }));

  // --- double opt-in confirmation link
  app.get('/account/subscribe/confirm/:id/:token', content.withShop(async (req, reply, shop) => {
    const { id, token } = req.params as { id: string; token: string };
    const customer = /^\d+$/.test(id) ? await confirmSubscription(db, shop.id, Number(id), token) : null;
    const fr = shop.locale.slice(0, 2).toLowerCase() === 'fr';
    const env = await makeEnv(ctx, req, shop);
    const title = customer ? (fr ? 'Inscription confirmée' : 'Subscription confirmed') : (fr ? 'Lien invalide' : 'Invalid link');
    const body = customer ? (fr ? '<p>Merci, votre inscription est confirmée.</p>' : '<p>Thank you, your subscription is confirmed.</p>') : (fr ? '<p>Ce lien est invalide ou a expiré.</p>' : '<p>This link is invalid or has expired.</p>');
    reply.header('cache-control', 'no-store');
    return content.renderTemplate(req, reply, env, { template: 'page', pageType: 'page', title, suffix: null, status: customer ? 200 : 410, extra: { page: { id: 0, title, handle: 'subscription', url: req.url, content: body, seo: { title, description: '' }, template_suffix: '' } } });
  }));
}

