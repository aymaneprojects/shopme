import { createHash } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  attachContractPaymentMethod, contractsForOrder, getShopStripeKeys, getShopPayPalCredentials, getShopMollieKey, isPublicHttpsUrl, shopOfPayment, availablePaymentMethods, configOf, findOrderIdByName, gatewaySecretOf, markOrderAuthorized, mirrorProviderRefunds, recordPaymentCanceled, recordDispute, cleanAddress, findOrderIdByPayment, getDefaultAddress, getCartByToken, getOrderByCheckoutToken, getOrderSummary, getShop, loadCheckout, markOrderPaid, recordPaymentFailure,
  accountsModeOf, sendFulfillmentRequests, sendSms, checkoutSettingsOf, customerAccountsSettingsOf, orderVars, renderSubscriptionConfirmation, privacySettingsOf, type Customer, type Mail, recordOrderEmail, sendNotification, sendStaffNewOrder, shippableCountries, splitContact, submitCheckout, updateCheckout, type CheckoutAddressInput, type CheckoutSettings, type CheckoutError, type CheckoutView, type Shop,
} from '@shopme/core';
import { createMollieAdapter, createPayPalAdapter, createStripeAdmin, createStripeGateway, fillRedirectUrl, type FetchLike, type MollieAdapter, type PayPalAdapter, STRIPE_WEBHOOK_EVENTS, readSetting, verifyPaymentWebhook, type StripeAdmin, type StripeGateway } from '@shopme/payments';
import { parseMoney } from '@shopme/shopify-compat';
import type { AppContext } from '../context';
import type { SubscriptionNotifyJob } from '../subscriptions';
import { CART_COOKIE, customerOf, primaryShop } from '../storefront/env';
import { requestOrigin } from '../stores';
import { pageDescriptor, privacyEnvFor, privacyHead } from '../storefront/privacy';
import { CSS, JS, PREVIEW_JS } from './assets';
import { countryName, PROVINCES } from './geo';
import { registerHostedProviders } from './hosted-providers';
import { checkoutPage, discountMessage, inCurrency, notFoundPage, pageCtx, shippingFragment, summaryFragment, thankYouPage, type PageCtx } from './views';

/**
 * `stripe`: the installation's gateway (STRIPE_* env); mutable on purpose: tests replace it with a gateway backed by a fake client.
 * `forShop`: the gateway of one store: its own keys (Settings > Payments) when saved, else the installation's.
 */
export interface CheckoutPayments {
  stripe: StripeGateway | null; forShop(shopId: number): Promise<StripeGateway | null>;
  /** Account-level Stripe client for a secret key (saving keys: validation, webhook endpoint, wallet domains); mutable so tests inject a fake. */
  admin: (secretKey: string) => StripeAdmin;
  /** PayPal client of a store (its saved credentials), null when it has none. */
  paypalForShop(shopId: number): Promise<PayPalAdapter | null>;
  /** Mollie client of a store (its saved API key), null when it has none. */
  mollieForShop(shopId: number): Promise<MollieAdapter | null>;
  /** PayPal client for credentials being saved (the webhook id may still be empty); mutable so tests inject a fake. */
  paypalAdmin: (c: { clientId: string; clientSecret: string; environment: 'sandbox' | 'live' }) => PayPalAdapter;
  mollieAdmin: (apiKey: string) => MollieAdapter;
  /** `fetch` the PayPal and Mollie adapters use; tests replace it with a fake so nothing reaches the providers. */
  providerFetch?: FetchLike;
  /** The enabled Mollie methods of a store as a label ("iDEAL, Bancontact"), cached for a few minutes; "Mollie" when unknown. */
  mollieLabel(shopId: number): Promise<string>;
  /** Forget the cached Mollie labels (tests). */
  clearMollieLabels(): void;
}
declare module 'fastify' { interface FastifyInstance { checkoutPayments: CheckoutPayments } }

/**
 * Idempotency key of the PaymentIntent of a checkout: the same submit (double click, retry) maps to the same intent, a changed cart (other
 * amount or currency) or other intent parameters get a new one. Stripe refuses one key with different parameters, hence the fingerprint.
 */
export function paymentIntentKey(token: string, p: { amount: number; currency: string; captureMethod?: string; email?: string | null; customer?: string }): string {
  const fingerprint = createHash('sha256').update(JSON.stringify([p.amount, p.currency.toUpperCase(), p.captureMethod ?? 'automatic', p.email ?? '', p.customer ?? ''])).digest('hex').slice(0, 20);
  return `pi-${token}-${fingerprint}`;
}
/** Idempotency key of the PayPal order / Mollie payment of a checkout: the same submit maps to the same provider object, other amounts or capture modes get a new one. */
export function hostedPaymentKey(provider: 'paypal' | 'mollie', token: string, p: { amount: number; currency: string; captureMethod?: string; email?: string | null }): string {
  const fingerprint = createHash('sha256').update(JSON.stringify([p.amount, p.currency.toUpperCase(), p.captureMethod ?? 'automatic', p.email ?? ''])).digest('hex').slice(0, 20);
  return `${provider}-${token}-${fingerprint}`;
}
const STRIPE_EVENTS: string[] = [...STRIPE_WEBHOOK_EVENTS];
type Body = Record<string, any>;
const str = (v: unknown) => (typeof v === 'string' ? v : '');

function addressFrom(b: Body): CheckoutAddressInput {
  const provinceCode = str(b.provinceCode).toUpperCase();
  const country = str(b.countryCode).toUpperCase();
  const known = PROVINCES[country]?.find((p) => p.code === provinceCode);
  return cleanAddress({ ...b, provinceCode: known ? provinceCode : '', province: known ? known.name : b.province, country: country ? countryName(country, 'en') : null })!;
}

/** Address from the form, without the fields the checkout settings hide; the contact phone (email or phone mode) fills the phone. */
function addressWithRules(b: Body, settings: CheckoutSettings, contactPhone: string | null): CheckoutAddressInput {
  const a = addressFrom(b);
  if (settings.nameMode === 'last') a.firstName = null;
  if (settings.company === 'hidden') a.company = null;
  if (settings.address2 === 'hidden') a.address2 = null;
  if (settings.phone === 'hidden') a.phone = null;
  if (contactPhone && !a.phone) a.phone = contactPhone;
  return a;
}

/** Tip choice of the form: `tip` is a preset percentage, `custom` (with `tipCustom` as an amount) or empty for no tip. Undefined when tipping is off or the form has no tip field. */
async function tipPatch(b: Body, currencyOf: () => Promise<string>, settings: CheckoutSettings): Promise<{ tipPercent: number | null; tipAmount: number } | undefined> {
  if (!settings.tipping.enabled || b.tip === undefined) return undefined;
  const choice = str(b.tip);
  if (choice === 'custom') {
    try { return { tipPercent: null, tipAmount: parseMoney(str(b.tipCustom).replace(',', '.').trim() || '0', await currencyOf()) }; } catch { return { tipPercent: null, tipAmount: 0 }; }
  }
  const pct = Number(choice);
  return Number.isInteger(pct) && settings.tipping.presets.includes(pct) ? { tipPercent: pct, tipAmount: 0 } : { tipPercent: null, tipAmount: 0 };
}

function errorMessages(c: PageCtx, errors: CheckoutError[]): string[] {
  const { t } = c;
  return errors.map((e) => {
    switch (e.code) {
      case 'email': return t('err_email');
      case 'contact': return t('err_contact');
      case 'address': return t('err_address', { fields: e.fields.map((f) => (({ firstName: t('firstName'), lastName: t('lastName'), address1: t('address1'), city: t('city'), zip: t('zip'), countryCode: t('country'), company: t('companyField'), address2: t('address2Field'), phone: t('phoneField') } as Record<string, string>)[f] ?? f)).join(', ') });
      case 'shipping_method': return t('err_shipping_method');
      case 'payment_method': return t('err_payment_method');
      case 'stock': return t('err_stock', { items: e.issues.map((i) => `${i.title} (${i.available})`).join(', ') });
      case 'discount': return t('err_discount');
      case 'gift_card': return t('err_gift_card');
      case 'store_credit': return t('err_store_credit');
      case 'completed': return t('err_completed');
      case 'empty': return t('err_empty');
      default: return t('err_generic');
    }
  });
}

export async function registerCheckout(app: FastifyInstance): Promise<void> {
  const ctx: AppContext = app.ctx;
  const { db, config } = ctx;
  const ownGateways = new Map<number, { sig: string; gw: StripeGateway | null }>();
  const payments = <CheckoutPayments>{
    stripe: createStripeGateway(config.stripe),
    admin: (secretKey) => createStripeAdmin(secretKey),
    async forShop(shopId) {
      const keys = await getShopStripeKeys(db, shopId, config.sessionSecret);
      if (!keys) return payments.stripe;
      const sig = `${keys.publishableKey}:${keys.secretKey}:${keys.webhookSecret}`;
      const hit = ownGateways.get(shopId);
      if (hit?.sig === sig) return hit.gw;
      const gw = createStripeGateway(keys);
      ownGateways.set(shopId, { sig, gw });
      return gw;
    },
  };
  const mollieLabels = new Map<number, { label: string; until: number; sig: string }>();
  payments.paypalAdmin = (c) => createPayPalAdapter({ ...c, webhookId: '' }, { fetch: payments.providerFetch, allowMissingWebhook: true });
  payments.mollieAdmin = (apiKey) => createMollieAdapter({ apiKey }, { fetch: payments.providerFetch });
  payments.paypalForShop = async (shopId) => {
    const c = await getShopPayPalCredentials(db, shopId, config.sessionSecret);
    return c ? createPayPalAdapter(c, { fetch: payments.providerFetch }) : null;
  };
  payments.mollieForShop = async (shopId) => {
    const apiKey = await getShopMollieKey(db, shopId, config.sessionSecret);
    return apiKey ? createMollieAdapter({ apiKey }, { fetch: payments.providerFetch }) : null;
  };
  payments.mollieLabel = async (shopId) => {
    const adapter = await payments.mollieForShop(shopId);
    if (!adapter) return 'Mollie';
    const sig = String(await getShopMollieKey(db, shopId, config.sessionSecret)).slice(-8);
    const hit = mollieLabels.get(shopId);
    if (hit && hit.sig === sig && hit.until > Date.now()) return hit.label;
    let label = 'Mollie', ttl = 60_000;
    try {
      const names = (await adapter.listMethods()).filter((m) => m.status === 'activated' && m.description).map((m) => m.description);
      if (names.length) { label = names.slice(0, 8).join(', ') + (names.length > 8 ? '...' : ''); ttl = 5 * 60_000; }
    } catch (e) { ctx.log.warn({ err: e }, 'mollie methods could not be listed'); }
    mollieLabels.set(shopId, { label, until: Date.now() + ttl, sig });
    return label;
  };
  payments.clearMollieLabels = () => mollieLabels.clear();
  app.decorate('checkoutPayments', payments);

  // --- emails (background jobs, retried by the queue) ---
  ctx.queue.register<{ shopId: number; orderId: number }>('order.confirmation-email', async ({ shopId, orderId }) => {
    const [shop, order] = await Promise.all([getShop(db, shopId), getOrderSummary(db, shopId, orderId)]);
    if (shop && order?.order.email) {
      const to = order.order.email;
      await sendNotification(db, ctx.mailer, shop, ctx.stores.storefrontBase(shop.id), 'order_confirmation', to, orderVars(order, shop), { onSent: (m) => recordOrderEmail(db, shopId, orderId, 'order_confirmation', to, { subject: m.subject, html: m.html ?? m.text }) });
    }
    if (shop && order) await sendSms(shop, 'order_confirmation', order.order.phone, orderVars(order, shop));
  });
  ctx.queue.register<{ shopId: number; orderId: number }>('order.fulfillment-request', async ({ shopId, orderId }) => {
    const shop = await getShop(db, shopId);
    if (shop) await sendFulfillmentRequests(db, ctx.mailer, shop, ctx.stores.storefrontBase(shop.id), orderId);
  });
  ctx.queue.register<{ shopId: number; orderId: number }>('order.staff-email', async ({ shopId, orderId }) => {
    const [shop, order] = await Promise.all([getShop(db, shopId), getOrderSummary(db, shopId, orderId)]);
    if (shop && order) await sendStaffNewOrder(db, ctx.mailer, shop, ctx.stores.storefrontBase(shop.id), orderVars(order, shop));
  });
  const enqueueEmails = (shopId: number, orderId: number) => {
    ctx.queue.enqueue('order.confirmation-email', { shopId, orderId });
    ctx.queue.enqueue('order.staff-email', { shopId, orderId });
    ctx.queue.enqueue('order.fulfillment-request', { shopId, orderId });
  };
  /** "Subscription confirmed" for the contracts an order started (sent with the order confirmation, once the order is placed or paid). */
  const enqueueSubscriptionEmails = async (shopId: number, orderId: number) => {
    for (const c of await contractsForOrder(db, shopId, orderId)) if (c.originOrderId === orderId) ctx.queue.enqueue<SubscriptionNotifyJob>('subscription.notify', { shopId, contractId: c.id, key: 'subscription_confirmation' });
  };
  /** The card saved for later at checkout goes on the order's subscription contracts (off-session renewals). */
  const rememberCard = async (shopId: number, orderId: number, pi: Record<string, any>) => {
    const id = (v: unknown) => (typeof v === 'string' ? v : v && typeof v === 'object' && typeof (v as { id?: unknown }).id === 'string' ? (v as { id: string }).id : null);
    await attachContractPaymentMethod(db, shopId, orderId, { customer: id(pi.customer), paymentMethod: id(pi.payment_method) });
  };

  const cartToken = (req: FastifyRequest) => (req.cookies[CART_COOKIE] ?? '').split('?')[0]!.split('%3F')[0]!;
  const bankInstructions = (shop: Shop) => {
    const v = readSetting(shop.settings, 'payments.manual.bankTransfer') as { instructions?: unknown } | undefined;
    return typeof v?.instructions === 'string' ? v.instructions : '';
  };
  /** Page context with the consent runtime and event configuration (checkout is ours, so pixels and the banner are injected here). */
  async function pageContext(req: FastifyRequest, shop: Shop, customer: Customer | null, page: { type: string; events?: { name: string; data?: unknown; once?: string }[] }): Promise<PageCtx> {
    const c = pageCtx(shop);
    c.head = privacyHead(shop, await privacyEnvFor(ctx, req, shop, customer), page, customer, shop.locale);
    return c;
  }
  const checkoutEventData = (view: CheckoutView, c: PageCtx) => ({
    token: view.token, currencyCode: view.currency, email: view.email ?? undefined,
    totalPrice: { amount: (view.pricing.total + view.tip) / 100, currencyCode: view.currency }, subtotalPrice: { amount: view.pricing.subtotal / 100, currencyCode: view.currency },
    lineItems: view.lines.map((l) => ({ title: l.product.title, quantity: l.quantity, variant: { id: String(l.variantId), title: l.variantTitle, sku: l.sku, price: { amount: l.price / 100, currencyCode: view.currency }, product: { id: String(l.productId), title: l.product.title, vendor: l.product.vendor } } })),
    shippingLine: view.pricing.shipping ? { price: { amount: view.pricing.totalShipping / 100, currencyCode: view.currency } } : null, locale: c.lang,
  });
  const html = (reply: FastifyReply, body: string, status = 200) => reply.code(status).header('cache-control', 'no-store').type('text/html; charset=utf-8').send(body);

  /** Settings > Checkout "require sign-in": the buyer must hold a customer session. */
  /** Presentment currency of the checkout (its cart's currency). */
  const cartCurrency = (shop: Shop, token: string) => async (): Promise<string> => (await getCartByToken(db, shop.id, token))?.currency ?? shop.currency;

  const loginRequired = async (req: FastifyRequest, shop: Shop) => accountsModeOf(shop) === 'REQUIRED' && !(await customerOf(ctx, req, shop));

  /** Methods offered to the buyer: PayPal and Mollie only when enabled and configured for this store. */
  async function offeredMethods(shop: Shop, view: { address?: { countryCode?: string | null } | null; amountDue: number }) {
    const stripe = await app.checkoutPayments.forShop(shop.id);
    const parsedPayments = availablePaymentMethods(shop.settings, { stripeConfigured: !!stripe, paypalConfigured: true, mollieConfigured: true });
    const wantsPayPal = parsedPayments.some((m) => m.id === 'paypal'), wantsMollie = parsedPayments.some((m) => m.id === 'mollie');
    const paypal = wantsPayPal ? await app.checkoutPayments.paypalForShop(shop.id) : null;
    const mollie = wantsMollie ? await app.checkoutPayments.mollieForShop(shop.id) : null;
    const methods = availablePaymentMethods(shop.settings, {
      stripeConfigured: !!stripe, paypalConfigured: !!paypal, mollieConfigured: !!mollie, mollieName: mollie ? await app.checkoutPayments.mollieLabel(shop.id) : undefined,
      context: { country: view.address?.countryCode ?? null, total: view.amountDue },
    });
    return { stripe, paypal, mollie, methods };
  }

  async function pageData(shop: Shop, view: CheckoutView, extra: { errors?: string[]; values?: Body; chosenMethod?: string; marketing?: boolean } = {}) {
    const { stripe, methods } = await offeredMethods(shop, view);
    return {
      view, methods, errors: extra.errors ?? [], values: extra.values, chosenMethod: extra.chosenMethod, marketing: extra.marketing ?? view.settings.marketing === 'checked',
      countries: view.requiresShipping ? await shippableCountries(db, shop.id) : null,
      bankInstructions: bankInstructions(shop),
      stripe: stripe && methods.some((m) => m.id === 'stripe') ? { publishableKey: stripe.publishableKey } : null,
    };
  }

  app.get('/checkout-assets/checkout.css', async (_r, reply) => reply.header('cache-control', 'public, max-age=300').type('text/css; charset=utf-8').send(CSS));
  app.get('/checkout-assets/checkout.js', async (_r, reply) => reply.header('cache-control', 'public, max-age=300').type('text/javascript; charset=utf-8').send(JS));
  app.get('/checkout-assets/preview.js', async (_r, reply) => reply.header('cache-control', 'public, max-age=300').type('text/javascript; charset=utf-8').send(PREVIEW_JS));

  // Stripe needs the exact bytes for signature verification: this scope keeps the JSON body as a string.
  await app.register(async (scope) => {
    scope.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => done(null, body));
    /**
     * Stripe events. The store is the one named in the path (`/webhooks/stripe/<handle>`, any host) or the one of the request host;
     * the signature is checked with that store's own webhook secret (or the installation's when it has none). Single-store mode:
     * `/webhooks/stripe` with the STRIPE_WEBHOOK_SECRET, as before. Multi-store events on the shared installation keys that name no
     * store are matched to the store that owns the payment.
     */
    const stripeWebhook = async (req: FastifyRequest, reply: FastifyReply) => {
      const handle = (req.params as { handle?: string }).handle;
      let shop: Shop | null;
      if (handle) {
        if (!config.multiStore) return reply.code(404).send({ error: 'Not found' });
        const id = ctx.stores.idForHandle(handle);
        shop = id == null ? null : await getShop(db, id);
        if (!shop) return reply.code(404).send({ error: 'Unknown store' });
      } else shop = await primaryShop(ctx, req);
      const gateway = shop ? await app.checkoutPayments.forShop(shop.id) : app.checkoutPayments.stripe;
      const sig = req.headers['stripe-signature'];
      if (!gateway || typeof sig !== 'string') return reply.code(400).send({ error: 'Stripe is not configured or the signature is missing' });
      let event;
      try { event = gateway.verifyWebhook(req.body as string, sig); } catch { return reply.code(400).send({ error: 'Invalid signature' }); }
      const pi = event.data.object;
      const isIntent = event.type.startsWith('payment_intent.');
      // Charge and dispute events name their PaymentIntent; payment_intent events are the PaymentIntent.
      const paymentId = isIntent ? pi.id : pi.payment_intent;
      if (STRIPE_EVENTS.includes(event.type) && typeof paymentId === 'string') {
        // Shared installation keys and no store in the request (multi-store): the payment's own store.
        if (!shop && config.multiStore && gateway === app.checkoutPayments.stripe) shop = await shopOfPayment(db, paymentId);
        if (!shop) return { received: true };
        const orderId = await findOrderIdByPayment(db, shop.id, paymentId);
        if (orderId) {
          if (isIntent && event.type !== 'payment_intent.payment_failed' && event.type !== 'payment_intent.canceled') await rememberCard(shop.id, orderId, pi);
          if (event.type === 'payment_intent.amount_capturable_updated') { if (await markOrderAuthorized(db, shop.id, orderId, { gateway: 'stripe', paymentId })) { enqueueEmails(shop.id, orderId); await enqueueSubscriptionEmails(shop.id, orderId); } }
          else if (event.type === 'payment_intent.succeeded') { if (await markOrderPaid(db, shop.id, orderId, { gateway: 'stripe', paymentId })) { enqueueEmails(shop.id, orderId); await enqueueSubscriptionEmails(shop.id, orderId); } }
          else if (event.type === 'payment_intent.canceled') await recordPaymentCanceled(db, shop.id, orderId);
          else if (event.type === 'charge.refunded') {
            // Newer API versions leave the refund list out of the charge (and the embedded list is cut at 10): ask Stripe then. A failure answers 500 so Stripe retries.
            const embedded = pi.refunds;
            const list = Array.isArray(embedded?.data) && !embedded.has_more ? embedded.data : await gateway.listRefunds(paymentId);
            await mirrorProviderRefunds(db, shop.id, orderId, 'stripe', list);
          }
          else if (event.type === 'charge.dispute.created') await recordDispute(db, shop.id, orderId, { id: pi.id, amount: pi.amount, currency: pi.currency, reason: pi.reason });
          else await recordPaymentFailure(db, shop.id, orderId, { gateway: 'stripe', paymentId, message: pi.last_payment_error?.message });
        } else ctx.log.warn({ paymentIntent: paymentId }, 'stripe webhook for an unknown payment');
      }
      return { received: true };
    };
    scope.post('/webhooks/stripe', stripeWebhook);
    scope.post('/webhooks/stripe/:handle', stripeWebhook);
  });

  // Payment confirmation of a redirect gateway: `POST {"reference": "<order name>", "status": "paid" | "failed"}` signed with the gateway secret (hex HMAC-SHA256 of the raw body in X-ShopMe-Signature).
  await app.register(async (scope) => {
    scope.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => done(null, body));
    scope.post('/webhooks/payments/:gatewayId', async (req, reply) => {
      const shop = await primaryShop(ctx, req);
      const { gatewayId } = req.params as { gatewayId: string };
      const gw = shop ? configOf(shop, 'PAYMENTS').redirectGateways.find((g) => g.id === gatewayId) : undefined;
      const sig = req.headers['x-shopme-signature'];
      const secret = gw ? gatewaySecretOf(gw.secret, config.sessionSecret) : '';
      if (!shop || !gw || !secret || typeof sig !== 'string' || !verifyPaymentWebhook(secret, req.body as string, sig)) return reply.code(400).send({ error: 'Invalid signature' });
      let body: { reference?: unknown; status?: unknown };
      try { body = JSON.parse(req.body as string); } catch { return reply.code(400).send({ error: 'Invalid JSON' }); }
      const orderId = typeof body.reference === 'string' ? await findOrderIdByName(db, shop.id, body.reference, `redirect:${gw.id}`) : null;
      if (!orderId) return reply.code(404).send({ error: 'Unknown order' });
      if (body.status === 'paid') { if (await markOrderPaid(db, shop.id, orderId, { gateway: `redirect:${gw.id}` })) enqueueEmails(shop.id, orderId); }
      else if (body.status === 'failed') await recordPaymentFailure(db, shop.id, orderId, { gateway: `redirect:${gw.id}` });
      else return reply.code(400).send({ error: 'Unknown status' });
      return { received: true };
    });
  });

  await registerHostedProviders(app, { enqueueEmails, enqueueSubscriptionEmails, html, pageContext, bankInstructions });

  await app.register(async (scope) => {
    scope.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string' }, (_req, body, done) => done(null, Object.fromEntries(new URLSearchParams(body as string))));

    const start = async (req: FastifyRequest, reply: FastifyReply) => {
      const shop = await primaryShop(ctx, req);
      const token = cartToken(req);
      const cart = shop && token ? await getCartByToken(db, shop.id, token) : null;
      if (!cart || !cart.lines.length) return reply.redirect(req.method === 'GET' ? '/' : '/cart', 303);
      return reply.redirect(`/checkouts/${cart.token}`, 303);
    };
    scope.get('/checkout', start);
    scope.post('/checkout', start);

    scope.get('/checkouts/:token', async (req, reply) => {
      const shop = await primaryShop(ctx, req);
      if (!shop) return reply.code(503).send('Store is not set up');
      const { token } = req.params as { token: string };
      const buyer = await customerOf(ctx, req, shop);
      let view = await loadCheckout(db, shop, token, new Date(), { customerId: buyer?.id });
      if (!view) return html(reply, notFoundPage(pageCtx(shop)), 404);
      if (view.completed) return reply.redirect(`/checkouts/${token}/thank-you`, 303);
      if (!view.lines.length) return reply.redirect('/cart', 303);
      if (await loginRequired(req, shop)) return reply.redirect(`/account/login?return_url=${encodeURIComponent(`/checkouts/${token}`)}`, 303);
      // Signed-in customers start with their email and default address (the order then belongs to their account by email).
      const customer = !view.email && !view.address ? buyer : null;
      if (customer?.email) {
        const a = await getDefaultAddress(db, shop.id, customer);
        await updateCheckout(db, shop, token, { email: customer.email, ...(a ? { address: addressFrom({ ...a, countryCode: a.countryCode ?? '', provinceCode: a.provinceCode ?? '' }) } : {}) });
        view = (await loadCheckout(db, shop, token, new Date(), { customerId: buyer?.id })) ?? view;
      }
      const c = await pageContext(req, shop, buyer, { type: 'checkout', events: [{ name: 'checkout_started', data: { checkout: checkoutEventData(view, pageCtx(shop)) }, once: `checkout_started_${token}` }] });
      const acc = customerAccountsSettingsOf(shop);
      const signInUrl = !buyer && acc.mode !== 'DISABLED' && acc.loginLinksVisible ? `/account/login?return_url=${encodeURIComponent(`/checkouts/${token}`)}` : null;
      return html(reply, checkoutPage(c, { ...(await pageData(shop, view)), signInUrl, signedInEmail: buyer?.email ?? null }));
    });

    /** Persist what the buyer typed and return the re-priced fragments. */
    scope.post('/checkouts/:token/refresh', async (req, reply) => {
      const shop = await primaryShop(ctx, req);
      if (!shop) return reply.code(503).send({});
      const { token } = req.params as { token: string };
      const b = (req.body ?? {}) as Body;
      const c = pageCtx(shop);
      if (await loginRequired(req, shop)) return reply.code(401).send({});
      const buyer = await customerOf(ctx, req, shop);
      const settings = checkoutSettingsOf(shop);
      const contact = splitContact(settings, str(b.email));
      const email = contact.email ?? '';
      const rate = Number(b.shippingRateId);
      const first = await updateCheckout(db, shop, token, {
        ...(email === '' || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? { email: email || null } : {}),
        address: addressWithRules(b, settings, contact.phone), shippingRateId: Number.isFinite(rate) && rate !== 0 ? rate : undefined, ...(await tipPatch(b, cartCurrency(shop, token), settings)),
        removeDiscountCode: str(b.removeDiscountCode) || undefined, removeGiftCardCode: str(b.removeGiftCardCode) || undefined,
        ...(b.storeCreditField ? { useStoreCredit: !!b.useStoreCredit } : {}),
      });
      if (!first.ok) return reply.code(first.error === 'not_found' ? 404 : 409).send({});
      let discountError = '';
      if (str(b.addDiscountCode).trim()) {
        const r = await updateCheckout(db, shop, token, { addDiscountCode: str(b.addDiscountCode) });
        if (!r.ok) discountError = discountMessage(c.t, r.error as 'not_found');
      }
      let giftError = '';
      if (str(b.addGiftCardCode).trim()) {
        const r = await updateCheckout(db, shop, token, { addGiftCardCode: str(b.addGiftCardCode) });
        if (!r.ok) giftError = discountMessage(c.t, r.error as 'not_found');
      }
      const view = (await loadCheckout(db, shop, token, new Date(), { customerId: buyer?.id }))!;
      return reply.header('cache-control', 'no-store').send({
        shipping: view.requiresShipping ? shippingFragment(c, view) : undefined, summary: summaryFragment(c, view), total: inCurrency(c, view.currency).money(view.amountDue),
        amount: view.amountDue, free: view.amountDue === 0, payments: true, discountError, giftError,
        methods: (await offeredMethods(shop, view)).methods.map((m) => m.id),
      });
    });

    /** No-JS discount form. */
    scope.post('/checkouts/:token/discount', async (req, reply) => {
      const shop = await primaryShop(ctx, req);
      if (!shop) return reply.code(503).send('');
      const { token } = req.params as { token: string };
      const r = await updateCheckout(db, shop, token, { addDiscountCode: str((req.body as Body)?.discountCode) });
      if (!r.ok && r.error !== 'not_found' && r.error !== 'completed') {
        const view = await loadCheckout(db, shop, token);
        if (view) return html(reply, checkoutPage(pageCtx(shop), await pageData(shop, view, { errors: [discountMessage(pageCtx(shop).t, r.error as 'not_found')] })), 422);
      }
      return reply.redirect(`/checkouts/${token}`, 303);
    });

    /** No-JS gift card form. */
    scope.post('/checkouts/:token/gift-card', async (req, reply) => {
      const shop = await primaryShop(ctx, req);
      if (!shop) return reply.code(503).send('');
      const { token } = req.params as { token: string };
      const r = await updateCheckout(db, shop, token, { addGiftCardCode: str((req.body as Body)?.giftCardCode) });
      if (!r.ok && r.error !== 'not_found' && r.error !== 'completed') {
        const view = await loadCheckout(db, shop, token);
        if (view) return html(reply, checkoutPage(pageCtx(shop), await pageData(shop, view, { errors: [discountMessage(pageCtx(shop).t, r.error as 'not_found')] })), 422);
      }
      return reply.redirect(`/checkouts/${token}`, 303);
    });

    /** Link of the abandoned checkout email: puts the cart back in the buyer's browser and opens the checkout. */
    scope.get('/checkouts/:token/recover', async (req, reply) => {
      const shop = await primaryShop(ctx, req);
      if (!shop) return reply.code(503).send('Store is not set up');
      const { token } = req.params as { token: string };
      const view = await loadCheckout(db, shop, token);
      if (!view || view.completed || !view.lines.length) return reply.redirect(view?.completed ? `/checkouts/${token}/thank-you` : '/cart', 303);
      reply.setCookie(CART_COOKIE, token, { path: '/', sameSite: 'lax', httpOnly: false, maxAge: 90 * 24 * 3600, secure: config.appUrl.startsWith('https://') });
      return reply.redirect(`/checkouts/${token}`, 303);
    });

    scope.post('/checkouts/:token/complete', async (req, reply) => {
      const shop = await primaryShop(ctx, req);
      if (!shop) return reply.code(503).send('Store is not set up');
      const { token } = req.params as { token: string };
      const b = (req.body ?? {}) as Body;
      const json = String(req.headers['content-type'] ?? '').includes('json');
      const c = pageCtx(shop);
      if (await loginRequired(req, shop)) return json ? reply.code(401).send({ ok: false, errors: [c.t('err_login')] }) : reply.redirect(`/account/login?return_url=${encodeURIComponent(`/checkouts/${token}`)}`, 303);
      const buyer = await customerOf(ctx, req, shop);
      const settings = checkoutSettingsOf(shop);
      const contact = splitContact(settings, str(b.email));
      const fail = async (errors: string[]) => {
        if (json) return reply.code(422).send({ ok: false, errors });
        const view = await loadCheckout(db, shop, token, new Date(), { customerId: buyer?.id });
        if (!view) return html(reply, notFoundPage(c), 404);
        return html(reply, checkoutPage(c, await pageData(shop, view, { errors, values: b, chosenMethod: str(b.paymentMethod), marketing: !!b.acceptsMarketing })), 422);
      };

      const rate = Number(b.shippingRateId);
      const saved = await updateCheckout(db, shop, token, { email: contact.email, address: addressWithRules(b, settings, contact.phone), shippingRateId: Number.isFinite(rate) && rate !== 0 ? rate : undefined, ...(await tipPatch(b, cartCurrency(shop, token), settings)) });
      if (!saved.ok) return saved.error === 'completed' ? reply.redirect(`/checkouts/${token}/thank-you`, 303) : fail([saved.error === 'invalid_email' ? c.t(settings.contactMethod === 'email_or_phone' ? 'err_contact' : 'err_email') : c.t('err_generic')]);

      let clientSecret = '';
      const pre = await loadCheckout(db, shop, token, new Date(), { customerId: buyer?.id });
      const { stripe, paypal, mollie, methods } = await offeredMethods(shop, { address: pre?.address, amountDue: pre?.amountDue ?? 0 });
      const kinds = Object.fromEntries(methods.map((m) => [m.id, m.kind]));
      const captureMethod = configOf(shop, 'PAYMENTS').captureMethod;
      let paymentError = false;
      let hostedUrl = ''; // approval / checkout page of PayPal or Mollie
      const res = await submitCheckout(db, shop, token, {
        customerId: buyer?.id ?? null, doubleOptIn: privacySettingsOf(shop).doubleOptIn, visitSessionId: req.cookies.shopme_vid ?? null,
        paymentMethod: str(b.paymentMethod), allowedMethods: methods.map((m) => m.id), methodKinds: kinds, acceptsMarketing: settings.marketing !== 'hidden' && !!b.acceptsMarketing, note: settings.orderNotes ? str(b.note).trim().slice(0, 5000) || null : undefined,
        shippingRateId: Number.isFinite(rate) && rate !== 0 ? rate : null,
        startOnlinePayment: async (view) => {
          const origin = requestOrigin(ctx, req);
          const method = str(b.paymentMethod);
          if (method === 'paypal') {
            if (!paypal) throw new Error('PayPal is not configured');
            const o = await paypal.createOrder({
              amount: view.amountDue, currency: view.currency, intent: captureMethod === 'manual' ? 'AUTHORIZE' : 'CAPTURE', orderId: token, description: `${shop.name} checkout`,
              returnUrl: `${origin}/checkouts/${token}/paypal/return`, cancelUrl: `${origin}/checkouts/${token}/paypal/cancel`,
              idempotencyKey: hostedPaymentKey('paypal', token, { amount: view.amountDue, currency: view.currency, captureMethod, email: view.email }),
            });
            if (!o.approvalUrl) throw new Error('PayPal returned no approval link');
            hostedUrl = o.approvalUrl;
            return o.id;
          }
          if (method === 'mollie') {
            if (!mollie) throw new Error('Mollie is not configured');
            const hook = `${config.appUrl}/webhooks/mollie${config.multiStore ? `/${ctx.stores.info(shop.id)?.handle ?? ''}` : ''}`;
            const p = await mollie.createPayment({
              amount: view.amountDue, currency: view.currency, description: `${shop.name} checkout`, redirectUrl: `${origin}/checkouts/${token}/mollie/return`,
              // Mollie refuses a webhook it cannot reach: without a public https URL the return page reads the payment itself.
              ...(isPublicHttpsUrl(hook) ? { webhookUrl: hook } : {}), orderId: token, shopId: String(shop.id), captureMode: 'automatic',
              idempotencyKey: hostedPaymentKey('mollie', token, { amount: view.amountDue, currency: view.currency, email: view.email }),
            });
            if (!p.checkoutUrl) throw new Error('Mollie returned no checkout URL');
            hostedUrl = p.checkoutUrl;
            return p.paymentId;
          }
          if (!stripe) throw new Error('Stripe is not configured');
          // Subscriptions: the card is saved on a Stripe customer for the renewals (Stripe keeps the card; we keep its ids).
          const subscribing = view.lines.some((l) => l.sellingPlan);
          const customer = subscribing ? await stripe.createCustomer({ email: view.email, name: [view.address?.firstName, view.address?.lastName].filter(Boolean).join(' ') || null, reference: token, idempotencyKey: `customer-${token}` }) : undefined;
          const pi = await stripe.createPaymentIntent({ amount: view.amountDue, currency: view.currency, reference: token, email: view.email, description: `${shop.name} checkout`, idempotencyKey: paymentIntentKey(token, { amount: view.amountDue, currency: view.currency, captureMethod, email: view.email, customer }), captureMethod, ...(customer && { setupFutureUsage: 'off_session' as const, customer }) });
          clientSecret = pi.clientSecret;
          return pi.id;
        },
      }).catch((e) => { if (['stripe', 'paypal', 'mollie'].includes(str(b.paymentMethod))) { ctx.log.error({ err: e, method: str(b.paymentMethod) }, 'online payment could not be started'); paymentError = true; return null; } throw e; });
      if (paymentError || !res) return fail([c.t('err_payment')]);
      if (!res.ok) {
        if (res.errors.some((e) => e.code === 'completed')) return reply.redirect(`/checkouts/${token}/thank-you`, 303);
        return fail(errorMessages(c, res.errors));
      }
      if (!res.needsOnlinePayment && kinds[str(b.paymentMethod)] !== 'redirect') { enqueueEmails(shop.id, res.orderId); await enqueueSubscriptionEmails(shop.id, res.orderId); }
      // Double opt-in: the marketing checkbox only started a pending subscription; the buyer confirms it from this email.
      if (res.marketingConfirmation) ctx.queue.enqueue<Mail>('mail.send', renderSubscriptionConfirmation(shop, res.marketingConfirmation.email, `${ctx.stores.publicOrigin(shop.id)}/account/subscribe/confirm/${res.marketingConfirmation.customerId}/${res.marketingConfirmation.token}`));
      const returnUrl = `${requestOrigin(ctx, req)}/checkouts/${token}/thank-you`;
      // A redirect gateway: the order is placed and the buyer goes to the merchant's payment page; the provider confirms through the payment webhook.
      const gw = kinds[str(b.paymentMethod)] === 'redirect' ? configOf(shop, 'PAYMENTS').redirectGateways.find((g) => `redirect:${g.id}` === str(b.paymentMethod)) : undefined;
      if (gw) {
        const payUrl = fillRedirectUrl(gw.redirectUrl, { order: res.name, reference: res.name, amount: (res.total / 100).toFixed(2), currency: res.currency, email: res.email, return_url: returnUrl });
        if (json) return { ok: true, clientSecret, returnUrl, redirectUrl: payUrl };
        return reply.redirect(payUrl, 303);
      }
      if (hostedUrl) {
        if (json) return { ok: true, clientSecret, returnUrl, redirectUrl: hostedUrl };
        return reply.redirect(hostedUrl, 303);
      }
      if (json) return { ok: true, clientSecret, returnUrl };
      return reply.redirect(`/checkouts/${token}/thank-you`, 303);
    });

    scope.get('/checkouts/:token/thank-you', async (req, reply) => {
      const shop = await primaryShop(ctx, req);
      if (!shop) return reply.code(503).send('Store is not set up');
      const { token } = req.params as { token: string };
      const order = await getOrderByCheckoutToken(db, shop.id, token);
      if (!order) return reply.redirect(`/checkouts/${token}`, 303);
      const o = order.order;
      const c = await pageContext(req, shop, await customerOf(ctx, req, shop), { type: 'thank_you', events: [{
        name: 'checkout_completed', once: `checkout_completed_${o.id}`,
        data: { checkout: {
          token, order: { id: String(o.id), name: o.name }, currencyCode: o.currency, email: o.email ?? undefined, totalPrice: { amount: o.total / 100, currencyCode: o.currency }, subtotalPrice: { amount: o.subtotal / 100, currencyCode: o.currency },
          lineItems: order.lines.map((l) => ({ title: l.title, quantity: l.quantity, variant: { id: String(l.variantId ?? ''), title: l.variantTitle, sku: l.sku, price: { amount: l.unitPrice / 100, currencyCode: o.currency }, product: { id: String(l.productId ?? ''), title: l.title, vendor: l.vendor ?? '' } } })),
        } },
      }] });
      return html(reply, thankYouPage(c, order, bankInstructions(shop)));
    });
  });
}
