import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  attachContractPaymentMethod, contractsForOrder, getShopStripeKeys, shopOfPayment, availablePaymentMethods, configOf, findOrderIdByName, markOrderAuthorized, cleanAddress, findOrderIdByPayment, getDefaultAddress, getCartByToken, getOrderByCheckoutToken, getOrderSummary, getShop, loadCheckout, markOrderPaid, recordPaymentFailure,
  accountsModeOf, sendFulfillmentRequests, sendSms, checkoutSettingsOf, customerAccountsSettingsOf, orderVars, renderSubscriptionConfirmation, privacySettingsOf, type Customer, type Mail, recordOrderEmail, sendNotification, sendStaffNewOrder, shippableCountries, splitContact, submitCheckout, updateCheckout, type CheckoutAddressInput, type CheckoutSettings, type CheckoutError, type CheckoutView, type Shop,
} from '@shopme/core';
import { createStripeGateway, fillRedirectUrl, readSetting, verifyPaymentWebhook, type StripeGateway } from '@shopme/payments';
import { parseMoney } from '@shopme/shopify-compat';
import type { AppContext } from '../context';
import type { SubscriptionNotifyJob } from '../subscriptions';
import { CART_COOKIE, customerOf, primaryShop } from '../storefront/env';
import { requestOrigin } from '../stores';
import { pageDescriptor, privacyEnvFor, privacyHead } from '../storefront/privacy';
import { CSS, JS } from './assets';
import { countryName, PROVINCES } from './geo';
import { checkoutPage, discountMessage, inCurrency, notFoundPage, pageCtx, shippingFragment, summaryFragment, thankYouPage, type PageCtx } from './views';

/**
 * `stripe`: the installation's gateway (STRIPE_* env); mutable on purpose: tests replace it with a gateway backed by a fake client.
 * `forShop`: the gateway of one store: its own keys (Settings > Payments) when saved, else the installation's.
 */
export interface CheckoutPayments { stripe: StripeGateway | null; forShop(shopId: number): Promise<StripeGateway | null> }
declare module 'fastify' { interface FastifyInstance { checkoutPayments: CheckoutPayments } }

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
  const payments: CheckoutPayments = {
    stripe: createStripeGateway(config.stripe),
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

  async function pageData(shop: Shop, view: CheckoutView, extra: { errors?: string[]; values?: Body; chosenMethod?: string; marketing?: boolean } = {}) {
    const stripe = await app.checkoutPayments.forShop(shop.id);
    const methods = availablePaymentMethods(shop.settings, { stripeConfigured: !!stripe, context: { country: view.address?.countryCode ?? null, total: view.amountDue } });
    return {
      view, methods, errors: extra.errors ?? [], values: extra.values, chosenMethod: extra.chosenMethod, marketing: extra.marketing ?? view.settings.marketing === 'checked',
      countries: view.requiresShipping ? await shippableCountries(db, shop.id) : null,
      bankInstructions: bankInstructions(shop),
      stripe: stripe && methods.some((m) => m.id === 'stripe') ? { publishableKey: stripe.publishableKey } : null,
    };
  }

  app.get('/checkout-assets/checkout.css', async (_r, reply) => reply.header('cache-control', 'public, max-age=300').type('text/css; charset=utf-8').send(CSS));
  app.get('/checkout-assets/checkout.js', async (_r, reply) => reply.header('cache-control', 'public, max-age=300').type('text/javascript; charset=utf-8').send(JS));

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
      if ((event.type === 'payment_intent.succeeded' || event.type === 'payment_intent.payment_failed' || event.type === 'payment_intent.amount_capturable_updated') && typeof pi.id === 'string') {
        // Shared installation keys and no store in the request (multi-store): the payment's own store.
        if (!shop && config.multiStore && gateway === app.checkoutPayments.stripe) shop = await shopOfPayment(db, pi.id);
        if (!shop) return { received: true };
        const orderId = await findOrderIdByPayment(db, shop.id, pi.id);
        if (orderId) {
          if (event.type !== 'payment_intent.payment_failed') await rememberCard(shop.id, orderId, pi);
          if (event.type === 'payment_intent.amount_capturable_updated') { if (await markOrderAuthorized(db, shop.id, orderId, { gateway: 'stripe', paymentId: pi.id })) { enqueueEmails(shop.id, orderId); await enqueueSubscriptionEmails(shop.id, orderId); } }
          else if (event.type === 'payment_intent.succeeded') { if (await markOrderPaid(db, shop.id, orderId, { gateway: 'stripe', paymentId: pi.id })) { enqueueEmails(shop.id, orderId); await enqueueSubscriptionEmails(shop.id, orderId); } }
          else await recordPaymentFailure(db, shop.id, orderId, { gateway: 'stripe', paymentId: pi.id, message: pi.last_payment_error?.message });
        } else ctx.log.warn({ paymentIntent: pi.id }, 'stripe webhook for an unknown payment');
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
      if (!shop || !gw || !gw.secret || typeof sig !== 'string' || !verifyPaymentWebhook(gw.secret, req.body as string, sig)) return reply.code(400).send({ error: 'Invalid signature' });
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
        methods: availablePaymentMethods(shop.settings, { stripeConfigured: !!(await app.checkoutPayments.forShop(shop.id)), context: { country: view.address?.countryCode ?? null, total: view.amountDue } }).map((m) => m.id),
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
      const stripe = await app.checkoutPayments.forShop(shop.id);
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
      const methods = availablePaymentMethods(shop.settings, { stripeConfigured: !!stripe, context: { country: pre?.address?.countryCode ?? null, total: pre?.amountDue ?? 0 } });
      const kinds = Object.fromEntries(methods.map((m) => [m.id, m.kind]));
      const captureMethod = configOf(shop, 'PAYMENTS').captureMethod;
      let paymentError = false;
      const res = await submitCheckout(db, shop, token, {
        customerId: buyer?.id ?? null, doubleOptIn: privacySettingsOf(shop).doubleOptIn, visitSessionId: req.cookies.shopme_vid ?? null,
        paymentMethod: str(b.paymentMethod), allowedMethods: methods.map((m) => m.id), methodKinds: kinds, acceptsMarketing: settings.marketing !== 'hidden' && !!b.acceptsMarketing, note: settings.orderNotes ? str(b.note).trim().slice(0, 5000) || null : undefined,
        shippingRateId: Number.isFinite(rate) && rate !== 0 ? rate : null,
        startOnlinePayment: async (view) => {
          if (!stripe) throw new Error('Stripe is not configured');
          // Subscriptions: the card is saved on a Stripe customer for the renewals (Stripe keeps the card; we keep its ids).
          const subscribing = view.lines.some((l) => l.sellingPlan);
          const customer = subscribing ? await stripe.createCustomer({ email: view.email, name: [view.address?.firstName, view.address?.lastName].filter(Boolean).join(' ') || null, reference: token, idempotencyKey: `customer-${token}` }) : undefined;
          const pi = await stripe.createPaymentIntent({ amount: view.amountDue, currency: view.currency, reference: token, email: view.email, description: `${shop.name} checkout`, idempotencyKey: randomUUID(), captureMethod, ...(customer && { setupFutureUsage: 'off_session' as const, customer }) });
          clientSecret = pi.clientSecret;
          return pi.id;
        },
      }).catch((e) => { if (str(b.paymentMethod) === 'stripe') { ctx.log.error({ err: e }, 'stripe payment intent failed'); paymentError = true; return null; } throw e; });
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
