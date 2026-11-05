import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  availablePaymentMethods, cleanAddress, findOrderIdByPayment, getDefaultAddress, getCartByToken, getOrderByCheckoutToken, getOrderSummary, getShop, loadCheckout, markOrderPaid, recordPaymentFailure,
  checkoutSettingsOf, orderVars, recordOrderEmail, sendNotification, sendStaffNewOrder, shippableCountries, splitContact, submitCheckout, updateCheckout, type CheckoutAddressInput, type CheckoutSettings, type CheckoutError, type CheckoutView, type Shop,
} from '@shopme/core';
import { createStripeGateway, readSetting, type StripeGateway } from '@shopme/payments';
import { parseMoney } from '@shopme/shopify-compat';
import type { AppContext } from '../context';
import { CART_COOKIE, customerOf, primaryShop } from '../storefront/env';
import { CSS, JS } from './assets';
import { countryName, PROVINCES } from './geo';
import { checkoutPage, discountMessage, inCurrency, notFoundPage, pageCtx, shippingFragment, summaryFragment, thankYouPage, type PageCtx } from './views';

/** Mutable on purpose: tests replace `stripe` with a gateway backed by a fake client. */
export interface CheckoutPayments { stripe: StripeGateway | null }
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
      case 'completed': return t('err_completed');
      case 'empty': return t('err_empty');
      default: return t('err_generic');
    }
  });
}

export async function registerCheckout(app: FastifyInstance): Promise<void> {
  const ctx: AppContext = app.ctx;
  const { db, config } = ctx;
  app.decorate('checkoutPayments', { stripe: createStripeGateway(config.stripe) } satisfies CheckoutPayments);

  // --- emails (background jobs, retried by the queue) ---
  ctx.queue.register<{ shopId: number; orderId: number }>('order.confirmation-email', async ({ shopId, orderId }) => {
    const [shop, order] = await Promise.all([getShop(db, shopId), getOrderSummary(db, shopId, orderId)]);
    if (shop && order?.order.email) {
      await sendNotification(db, ctx.mailer, shop, config.appUrl, 'order_confirmation', order.order.email, orderVars(order, shop));
      await recordOrderEmail(db, shopId, orderId, 'order_confirmation', order.order.email);
    }
  });
  ctx.queue.register<{ shopId: number; orderId: number }>('order.staff-email', async ({ shopId, orderId }) => {
    const [shop, order] = await Promise.all([getShop(db, shopId), getOrderSummary(db, shopId, orderId)]);
    if (shop && order) await sendStaffNewOrder(db, ctx.mailer, shop, config.appUrl, orderVars(order, shop));
  });
  const enqueueEmails = (shopId: number, orderId: number) => {
    ctx.queue.enqueue('order.confirmation-email', { shopId, orderId });
    ctx.queue.enqueue('order.staff-email', { shopId, orderId });
  };

  const cartToken = (req: FastifyRequest) => (req.cookies[CART_COOKIE] ?? '').split('?')[0]!.split('%3F')[0]!;
  const bankInstructions = (shop: Shop) => {
    const v = readSetting(shop.settings, 'payments.manual.bankTransfer') as { instructions?: unknown } | undefined;
    return typeof v?.instructions === 'string' ? v.instructions : '';
  };
  const html = (reply: FastifyReply, body: string, status = 200) => reply.code(status).header('cache-control', 'no-store').type('text/html; charset=utf-8').send(body);

  /** Settings > Checkout "require sign-in": the buyer must hold a customer session. */
  /** Presentment currency of the checkout (its cart's currency). */
  const cartCurrency = (shop: Shop, token: string) => async (): Promise<string> => (await getCartByToken(db, shop.id, token))?.currency ?? shop.currency;

  const loginRequired = async (req: FastifyRequest, shop: Shop) => checkoutSettingsOf(shop).accountMode === 'required' && !(await customerOf(ctx, req, shop));

  async function pageData(shop: Shop, view: CheckoutView, extra: { errors?: string[]; values?: Body; chosenMethod?: string; marketing?: boolean } = {}) {
    const stripe = app.checkoutPayments.stripe;
    const methods = availablePaymentMethods(shop.settings, { stripeConfigured: !!stripe });
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
    scope.post('/webhooks/stripe', async (req, reply) => {
      const gateway = app.checkoutPayments.stripe;
      const sig = req.headers['stripe-signature'];
      if (!gateway || typeof sig !== 'string') return reply.code(400).send({ error: 'Stripe is not configured or the signature is missing' });
      let event;
      try { event = gateway.verifyWebhook(req.body as string, sig); } catch { return reply.code(400).send({ error: 'Invalid signature' }); }
      const pi = event.data.object;
      const shop = await primaryShop(ctx);
      if (shop && (event.type === 'payment_intent.succeeded' || event.type === 'payment_intent.payment_failed') && typeof pi.id === 'string') {
        const orderId = await findOrderIdByPayment(db, shop.id, pi.id);
        if (orderId) {
          if (event.type === 'payment_intent.succeeded') { if (await markOrderPaid(db, shop.id, orderId, { gateway: 'stripe', paymentId: pi.id })) enqueueEmails(shop.id, orderId); }
          else await recordPaymentFailure(db, shop.id, orderId, { gateway: 'stripe', paymentId: pi.id, message: pi.last_payment_error?.message });
        } else ctx.log.warn({ paymentIntent: pi.id }, 'stripe webhook for an unknown payment');
      }
      return { received: true };
    });
  });

  await app.register(async (scope) => {
    scope.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string' }, (_req, body, done) => done(null, Object.fromEntries(new URLSearchParams(body as string))));

    const start = async (req: FastifyRequest, reply: FastifyReply) => {
      const shop = await primaryShop(ctx);
      const token = cartToken(req);
      const cart = shop && token ? await getCartByToken(db, shop.id, token) : null;
      if (!cart || !cart.lines.length) return reply.redirect(req.method === 'GET' ? '/' : '/cart', 303);
      return reply.redirect(`/checkouts/${cart.token}`, 303);
    };
    scope.get('/checkout', start);
    scope.post('/checkout', start);

    scope.get('/checkouts/:token', async (req, reply) => {
      const shop = await primaryShop(ctx);
      if (!shop) return reply.code(503).send('Store is not set up');
      const { token } = req.params as { token: string };
      let view = await loadCheckout(db, shop, token);
      const c = pageCtx(shop);
      if (!view) return html(reply, notFoundPage(c), 404);
      if (view.completed) return reply.redirect(`/checkouts/${token}/thank-you`, 303);
      if (!view.lines.length) return reply.redirect('/cart', 303);
      if (await loginRequired(req, shop)) return reply.redirect(`/account/login?return_url=${encodeURIComponent(`/checkouts/${token}`)}`, 303);
      // Signed-in customers start with their email and default address (the order then belongs to their account by email).
      const customer = !view.email && !view.address ? await customerOf(ctx, req, shop) : null;
      if (customer?.email) {
        const a = await getDefaultAddress(db, shop.id, customer);
        await updateCheckout(db, shop, token, { email: customer.email, ...(a ? { address: addressFrom({ ...a, countryCode: a.countryCode ?? '', provinceCode: a.provinceCode ?? '' }) } : {}) });
        view = (await loadCheckout(db, shop, token)) ?? view;
      }
      return html(reply, checkoutPage(c, await pageData(shop, view)));
    });

    /** Persist what the buyer typed and return the re-priced fragments. */
    scope.post('/checkouts/:token/refresh', async (req, reply) => {
      const shop = await primaryShop(ctx);
      if (!shop) return reply.code(503).send({});
      const { token } = req.params as { token: string };
      const b = (req.body ?? {}) as Body;
      const c = pageCtx(shop);
      if (await loginRequired(req, shop)) return reply.code(401).send({});
      const settings = checkoutSettingsOf(shop);
      const contact = splitContact(settings, str(b.email));
      const email = contact.email ?? '';
      const rate = Number(b.shippingRateId);
      const first = await updateCheckout(db, shop, token, {
        ...(email === '' || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? { email: email || null } : {}),
        address: addressWithRules(b, settings, contact.phone), shippingRateId: Number.isFinite(rate) && rate !== 0 ? rate : undefined, ...(await tipPatch(b, cartCurrency(shop, token), settings)),
        removeDiscountCode: str(b.removeDiscountCode) || undefined, removeGiftCardCode: str(b.removeGiftCardCode) || undefined,
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
      const view = (await loadCheckout(db, shop, token))!;
      return reply.header('cache-control', 'no-store').send({
        shipping: view.requiresShipping ? shippingFragment(c, view) : undefined, summary: summaryFragment(c, view), total: inCurrency(c, view.currency).money(view.amountDue),
        amount: view.amountDue, free: view.amountDue === 0, payments: true, discountError, giftError,
      });
    });

    /** No-JS discount form. */
    scope.post('/checkouts/:token/discount', async (req, reply) => {
      const shop = await primaryShop(ctx);
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
      const shop = await primaryShop(ctx);
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
      const shop = await primaryShop(ctx);
      if (!shop) return reply.code(503).send('Store is not set up');
      const { token } = req.params as { token: string };
      const view = await loadCheckout(db, shop, token);
      if (!view || view.completed || !view.lines.length) return reply.redirect(view?.completed ? `/checkouts/${token}/thank-you` : '/cart', 303);
      reply.setCookie(CART_COOKIE, token, { path: '/', sameSite: 'lax', httpOnly: false, maxAge: 90 * 24 * 3600, secure: config.appUrl.startsWith('https://') });
      return reply.redirect(`/checkouts/${token}`, 303);
    });

    scope.post('/checkouts/:token/complete', async (req, reply) => {
      const shop = await primaryShop(ctx);
      if (!shop) return reply.code(503).send('Store is not set up');
      const { token } = req.params as { token: string };
      const b = (req.body ?? {}) as Body;
      const json = String(req.headers['content-type'] ?? '').includes('json');
      const c = pageCtx(shop);
      const stripe = app.checkoutPayments.stripe;
      if (await loginRequired(req, shop)) return json ? reply.code(401).send({ ok: false, errors: [c.t('err_login')] }) : reply.redirect(`/account/login?return_url=${encodeURIComponent(`/checkouts/${token}`)}`, 303);
      const settings = checkoutSettingsOf(shop);
      const contact = splitContact(settings, str(b.email));
      const fail = async (errors: string[]) => {
        if (json) return reply.code(422).send({ ok: false, errors });
        const view = await loadCheckout(db, shop, token);
        if (!view) return html(reply, notFoundPage(c), 404);
        return html(reply, checkoutPage(c, await pageData(shop, view, { errors, values: b, chosenMethod: str(b.paymentMethod), marketing: !!b.acceptsMarketing })), 422);
      };

      const rate = Number(b.shippingRateId);
      const saved = await updateCheckout(db, shop, token, { email: contact.email, address: addressWithRules(b, settings, contact.phone), shippingRateId: Number.isFinite(rate) && rate !== 0 ? rate : undefined, ...(await tipPatch(b, cartCurrency(shop, token), settings)) });
      if (!saved.ok) return saved.error === 'completed' ? reply.redirect(`/checkouts/${token}/thank-you`, 303) : fail([saved.error === 'invalid_email' ? c.t(settings.contactMethod === 'email_or_phone' ? 'err_contact' : 'err_email') : c.t('err_generic')]);

      let clientSecret = '';
      const methods = availablePaymentMethods(shop.settings, { stripeConfigured: !!stripe });
      let paymentError = false;
      const res = await submitCheckout(db, shop, token, {
        paymentMethod: str(b.paymentMethod), allowedMethods: methods.map((m) => m.id), acceptsMarketing: settings.marketing !== 'hidden' && !!b.acceptsMarketing, note: settings.orderNotes ? str(b.note).trim().slice(0, 5000) || null : undefined,
        shippingRateId: Number.isFinite(rate) && rate !== 0 ? rate : null,
        startOnlinePayment: async (view) => {
          if (!stripe) throw new Error('Stripe is not configured');
          const pi = await stripe.createPaymentIntent({ amount: view.amountDue, currency: view.currency, reference: token, email: view.email, description: `${shop.name} checkout`, idempotencyKey: randomUUID() });
          clientSecret = pi.clientSecret;
          return pi.id;
        },
      }).catch((e) => { if (str(b.paymentMethod) === 'stripe') { ctx.log.error({ err: e }, 'stripe payment intent failed'); paymentError = true; return null; } throw e; });
      if (paymentError || !res) return fail([c.t('err_payment')]);
      if (!res.ok) {
        if (res.errors.some((e) => e.code === 'completed')) return reply.redirect(`/checkouts/${token}/thank-you`, 303);
        return fail(errorMessages(c, res.errors));
      }
      if (!res.needsOnlinePayment) enqueueEmails(shop.id, res.orderId);
      const returnUrl = `${config.appUrl.replace(/\/$/, '')}/checkouts/${token}/thank-you`;
      if (json) return { ok: true, clientSecret, returnUrl };
      return reply.redirect(`/checkouts/${token}/thank-you`, 303);
    });

    scope.get('/checkouts/:token/thank-you', async (req, reply) => {
      const shop = await primaryShop(ctx);
      if (!shop) return reply.code(503).send('Store is not set up');
      const { token } = req.params as { token: string };
      const order = await getOrderByCheckoutToken(db, shop.id, token);
      if (!order) return reply.redirect(`/checkouts/${token}`, 303);
      return html(reply, thankYouPage(pageCtx(shop), order, bankInstructions(shop)));
    });
  });
}
