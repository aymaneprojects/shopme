import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  configOf, findOrderIdByPaymentIds, getOrderByCheckoutToken, getOrderSummary, getShop, getShopPayPalCredentials, markOrderAuthorized, markOrderPaid, mirrorProviderRefunds, mirrorRefundedTotal, recordPaymentCanceled, recordPaymentFailure,
  type Customer, type OrderSummary, type Shop,
} from '@shopme/core';
import { PaymentProviderError, decimalToMinor, type MolliePaymentResult, type PayPalAdapter, type PayPalOrderResult, type PayPalWebhookEvent } from '@shopme/payments';
import type { AppContext } from '../context';
import { customerOf, primaryShop } from '../storefront/env';
import { translator } from './i18n';
import type { PageCtx } from './views';
import { thankYouPage } from './views';

type PageContextFn = (req: FastifyRequest, shop: Shop, customer: Customer | null, page: { type: string; events?: { name: string; data?: unknown; once?: string }[] }) => Promise<PageCtx>;

export interface HostedHelpers {
  enqueueEmails(shopId: number, orderId: number): void;
  enqueueSubscriptionEmails(shopId: number, orderId: number): Promise<void>;
  html(reply: FastifyReply, body: string, status?: number): FastifyReply;
  pageContext: PageContextFn;
  bankInstructions(shop: Shop): string;
}

const str = (v: unknown) => (typeof v === 'string' ? v : '');
const obj = (v: unknown): Record<string, any> => (v && typeof v === 'object' ? (v as Record<string, any>) : {});

/**
 * PayPal and Mollie: the return pages the buyer lands on after the provider, and the provider webhooks. Both providers get the order
 * PENDING with the provider id on its SALE transaction (see `complete` in index.ts); everything here is idempotent, whichever of the
 * return page and the webhook arrives first, and every lookup is scoped to the store the request resolved to.
 */
export async function registerHostedProviders(app: FastifyInstance, h: HostedHelpers): Promise<void> {
  const ctx: AppContext = app.ctx;
  const { db, config } = ctx;

  const paid = (shop: Shop, orderId: number) => { h.enqueueEmails(shop.id, orderId); return h.enqueueSubscriptionEmails(shop.id, orderId); };

  /** The store a webhook is for: the handle in the path (multi-store), else the store of the request host. */
  async function webhookShop(req: FastifyRequest, reply: FastifyReply): Promise<Shop | null> {
    const handle = (req.params as { handle?: string }).handle;
    if (handle) {
      if (!config.multiStore) { reply.code(404).send({ error: 'Not found' }); return null; }
      const id = ctx.stores.idForHandle(handle);
      const shop = id == null ? null : await getShop(db, id);
      if (!shop) { reply.code(404).send({ error: 'Unknown store' }); return null; }
      return shop;
    }
    const shop = await primaryShop(ctx, req);
    if (!shop) reply.code(404).send({ error: 'Unknown store' });
    return shop;
  }

  // ------------------------------------------------------------------------------------------------------------------------
  // PayPal
  // ------------------------------------------------------------------------------------------------------------------------

  /** Apply the state of a PayPal order (after capture, authorize or a lookup) to the ShopMe order. */
  async function applyPayPalOrder(shop: Shop, orderId: number, r: PayPalOrderResult, failureMessage?: string): Promise<void> {
    if (r.status === 'paid' || r.status === 'refunded') {
      if (await markOrderPaid(db, shop.id, orderId, { gateway: 'paypal', paymentId: r.captureId ?? r.orderId })) await paid(shop, orderId);
    } else if (r.status === 'authorized') {
      if (await markOrderAuthorized(db, shop.id, orderId, { gateway: 'paypal', paymentId: r.authorizationId ?? r.orderId })) await paid(shop, orderId);
    } else if (r.status === 'failed') {
      await recordPaymentFailure(db, shop.id, orderId, { gateway: 'paypal', paymentId: r.captureId ?? r.authorizationId ?? r.orderId, message: failureMessage ?? 'PayPal declined the payment', dedupe: true });
    }
  }

  /**
   * The buyer approved the PayPal order: capture it (intent CAPTURE) or authorize it. Safe to repeat and to race with the webhook: PayPal
   * answers an already captured order with its state (read back with getOrder) and the transition to PAID happens once.
   */
  async function completePayPal(shop: Shop, paypal: PayPalAdapter, orderId: number, paypalOrderId: string, intent: 'CAPTURE' | 'AUTHORIZE'): Promise<{ ok: boolean; message?: string }> {
    let result: PayPalOrderResult | null = null;
    let error: unknown = null;
    try { result = intent === 'AUTHORIZE' ? await paypal.authorizeOrder(paypalOrderId, `paypal-authorize-${paypalOrderId}`) : await paypal.captureOrder(paypalOrderId, `paypal-capture-${paypalOrderId}`); }
    catch (e) { error = e; try { result = await paypal.getOrder(paypalOrderId); } catch { result = null; } }
    if (result && (result.status === 'paid' || result.status === 'authorized' || result.status === 'refunded')) { await applyPayPalOrder(shop, orderId, result); return { ok: true }; }
    if (error) {
      const message = error instanceof Error ? error.message : 'PayPal could not complete the payment';
      // A declined funding source is a failure; a network problem is not (the buyer can retry, the webhook may still arrive).
      if (error instanceof PaymentProviderError && error.status >= 400 && error.status < 500) await recordPaymentFailure(db, shop.id, orderId, { gateway: 'paypal', paymentId: paypalOrderId, message, dedupe: true });
      else ctx.log.error({ err: error }, 'paypal capture failed');
      return { ok: false, message };
    }
    return { ok: !!result && result.status !== 'failed' };
  }

  const payPalSale = (o: OrderSummary) => o.transactions.find((t) => t.gateway === 'paypal' && ['SALE', 'AUTHORIZATION'].includes(t.kind) && t.paymentId);
  const settleView = async (req: FastifyRequest, reply: FastifyReply, shop: Shop, order: OrderSummary, notice: { text: string; retryUrl?: string } | undefined, status = 200) => {
    const c = await h.pageContext(req, shop, await customerOf(ctx, req, shop), { type: 'thank_you' });
    const n = notice ? { text: notice.text, ...(notice.retryUrl ? { retryUrl: notice.retryUrl, retryLabel: c.t('payRetryPayPal') } : {}) } : undefined;
    return h.html(reply, thankYouPage(c, order, h.bankInstructions(shop), n), status);
  };

  /** The buyer comes back from PayPal after approving: capture or authorize server side, then the thank-you page. */
  app.get('/checkouts/:token/paypal/return', async (req, reply) => {
    const shop = await primaryShop(ctx, req);
    if (!shop) return reply.code(503).send('Store is not set up');
    const { token } = req.params as { token: string };
    const order = await getOrderByCheckoutToken(db, shop.id, token);
    if (!order) return reply.redirect(`/checkouts/${token}`, 303);
    const sale = payPalSale(order);
    if (sale && order.order.financialStatus === 'PENDING') {
      const paypal = await app.checkoutPayments.paypalForShop(shop.id);
      if (paypal) {
        const r = await completePayPal(shop, paypal, order.order.id, sale.paymentId!, configOf(shop, 'PAYMENTS').captureMethod === 'manual' ? 'AUTHORIZE' : 'CAPTURE');
        if (!r.ok) {
          return settleView(req, reply, shop, order, { text: pageContextT(shop)('payDeclined'), retryUrl: `/checkouts/${token}/paypal/retry` }, 422);
        }
      }
    }
    return reply.redirect(`/checkouts/${token}/thank-you`, 303);
  });

  /** The translator without a request (messages only need the store locale). */
  const pageContextT = (shop: Shop) => translator(shop.locale).t;

  /** The buyer left PayPal without paying: the order stays PENDING (never shown as paid) and the page says so, with a way to try again. */
  app.get('/checkouts/:token/paypal/cancel', async (req, reply) => {
    const shop = await primaryShop(ctx, req);
    if (!shop) return reply.code(503).send('Store is not set up');
    const { token } = req.params as { token: string };
    const order = await getOrderByCheckoutToken(db, shop.id, token);
    if (!order) return reply.redirect(`/checkouts/${token}`, 303);
    if (order.order.financialStatus !== 'PENDING') return reply.redirect(`/checkouts/${token}/thank-you`, 303);
    return settleView(req, reply, shop, order, { text: pageContextT(shop)('payCancelled', { name: order.order.name }), retryUrl: `/checkouts/${token}/paypal/retry` });
  });

  /** "Pay with PayPal" again: back to the approval page of the PayPal order that is still open. */
  app.get('/checkouts/:token/paypal/retry', async (req, reply) => {
    const shop = await primaryShop(ctx, req);
    if (!shop) return reply.code(503).send('Store is not set up');
    const { token } = req.params as { token: string };
    const order = await getOrderByCheckoutToken(db, shop.id, token);
    const sale = order ? payPalSale(order) : undefined;
    const paypal = await app.checkoutPayments.paypalForShop(shop.id);
    const creds = await getShopPayPalCredentials(db, shop.id, config.sessionSecret);
    if (!order || !sale || !paypal || !creds || order.order.financialStatus !== 'PENDING') return reply.redirect(`/checkouts/${token}/thank-you`, 303);
    return reply.redirect(`https://www.${creds.environment === 'sandbox' ? 'sandbox.' : ''}paypal.com/checkoutnow?token=${encodeURIComponent(sale.paymentId!)}`, 303);
  });

  await app.register(async (scope) => {
    scope.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => done(null, body));
    const paypalWebhook = async (req: FastifyRequest, reply: FastifyReply) => {
      const shop = await webhookShop(req, reply);
      if (!shop) return;
      const paypal = await app.checkoutPayments.paypalForShop(shop.id);
      if (!paypal) return reply.code(400).send({ error: 'PayPal is not configured' });
      let event: PayPalWebhookEvent | null = null;
      try { event = await paypal.verifyWebhook(req.headers as Record<string, string | string[] | undefined>, typeof req.body === 'string' ? req.body : JSON.stringify(req.body ?? {})); }
      catch (e) { ctx.log.error({ err: e }, 'paypal webhook verification failed'); return reply.code(500).send({ error: 'Verification failed' }); }
      if (!event) return reply.code(400).send({ error: 'Invalid signature' });
      await handlePayPalEvent(shop, paypal, event);
      return { received: true };
    };
    scope.post('/webhooks/paypal', paypalWebhook);
    scope.post('/webhooks/paypal/:handle', paypalWebhook);
  });

  async function handlePayPalEvent(shop: Shop, paypal: PayPalAdapter, event: PayPalWebhookEvent): Promise<void> {
    const r = obj(event.resource);
    const related = obj(obj(r.supplementary_data).related_ids);
    const upLink = (Array.isArray(r.links) ? r.links : []).find((l: { rel?: string }) => l?.rel === 'up') as { href?: string } | undefined;
    const captureOfRefund = str(upLink?.href).match(/\/captures\/([^/?#]+)/)?.[1] ?? '';
    const ppOrderId = str(related.order_id);
    const find = (...ids: string[]) => findOrderIdByPaymentIds(db, shop.id, ids.filter(Boolean), 'paypal');
    switch (event.event_type) {
      case 'CHECKOUT.ORDER.APPROVED': {
        const orderId = await find(str(r.id));
        if (!orderId) break;
        if ((await orderStatus(shop.id, orderId)) === 'PENDING') await completePayPal(shop, paypal, orderId, str(r.id), r.intent === 'AUTHORIZE' ? 'AUTHORIZE' : 'CAPTURE');
        break;
      }
      case 'PAYMENT.CAPTURE.COMPLETED': {
        const orderId = await find(str(r.id), ppOrderId);
        if (orderId && await markOrderPaid(db, shop.id, orderId, { gateway: 'paypal', paymentId: str(r.id) })) await paid(shop, orderId);
        break;
      }
      case 'PAYMENT.AUTHORIZATION.CREATED': {
        const orderId = await find(str(r.id), ppOrderId);
        if (orderId && await markOrderAuthorized(db, shop.id, orderId, { gateway: 'paypal', paymentId: str(r.id) })) await paid(shop, orderId);
        break;
      }
      case 'PAYMENT.CAPTURE.DENIED': case 'PAYMENT.CAPTURE.DECLINED': {
        const orderId = await find(str(r.id), ppOrderId);
        if (orderId) await recordPaymentFailure(db, shop.id, orderId, { gateway: 'paypal', paymentId: str(r.id), message: 'PayPal declined the payment', dedupe: true });
        break;
      }
      case 'PAYMENT.AUTHORIZATION.VOIDED': {
        const orderId = await find(str(r.id), ppOrderId);
        if (orderId) await recordPaymentCanceled(db, shop.id, orderId);
        break;
      }
      case 'PAYMENT.CAPTURE.REFUNDED': {
        const orderId = await find(captureOfRefund, ppOrderId);
        const amount = r.amount ? decimalToMinor(str(r.amount.value), str(r.amount.currency_code)) : NaN;
        if (orderId && str(r.id) && Number.isFinite(amount)) await mirrorProviderRefunds(db, shop.id, orderId, 'paypal', [{ id: str(r.id), amount, status: str(r.status).toUpperCase() === 'FAILED' ? 'failed' : 'succeeded' }]);
        break;
      }
      default: break;
    }
  }

  const orderStatus = async (shopId: number, orderId: number) => (await getOrderSummary(db, shopId, orderId))?.order.financialStatus ?? null;

  // ------------------------------------------------------------------------------------------------------------------------
  // Mollie
  // ------------------------------------------------------------------------------------------------------------------------

  /** Apply a verified Mollie payment (fetched from Mollie, never taken from the request) to the ShopMe order of this store. */
  async function applyMolliePayment(shop: Shop, p: MolliePaymentResult): Promise<boolean> {
    // The payment carries the store it was created for; one that names another store is not ours to touch.
    if (p.shopId && p.shopId !== String(shop.id)) return false;
    const orderId = await findOrderIdByPaymentIds(db, shop.id, [p.paymentId], 'mollie');
    if (!orderId) { ctx.log.warn({ payment: p.paymentId }, 'mollie payment for an unknown order'); return false; }
    switch (p.status) {
      case 'paid': case 'refunded':
        if (await markOrderPaid(db, shop.id, orderId, { gateway: 'mollie', paymentId: p.paymentId })) await paid(shop, orderId);
        if (p.amountRefunded > 0) await mirrorRefundedTotal(db, shop.id, orderId, 'mollie', p.paymentId, p.amountRefunded);
        break;
      case 'authorized':
        if (await markOrderAuthorized(db, shop.id, orderId, { gateway: 'mollie', paymentId: p.paymentId })) await paid(shop, orderId);
        break;
      case 'failed':
        await recordPaymentFailure(db, shop.id, orderId, { gateway: 'mollie', paymentId: p.paymentId, message: `Mollie payment ${p.providerStatus}`, dedupe: true });
        break;
      case 'voided':
        if (!(await recordPaymentCanceled(db, shop.id, orderId))) await recordPaymentFailure(db, shop.id, orderId, { gateway: 'mollie', paymentId: p.paymentId, message: 'Mollie payment canceled', dedupe: true });
        break;
      default: break; // open / pending: nothing to record yet
    }
    return true;
  }

  await app.register(async (scope) => {
    scope.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string' }, (_req, body, done) => done(null, body));
    scope.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => { try { done(null, JSON.parse(body as string)); } catch { done(null, {}); } });
    const mollieWebhook = async (req: FastifyRequest, reply: FastifyReply) => {
      const shop = await webhookShop(req, reply);
      if (!shop) return;
      const mollie = await app.checkoutPayments.mollieForShop(shop.id);
      if (!mollie) return reply.code(400).send({ error: 'Mollie is not configured' });
      let p: MolliePaymentResult | null;
      try { p = await mollie.resolveWebhook(req.body as string | Record<string, unknown>); }
      catch (e) {
        // Not a payment of this account (another store's id): nothing to do and nothing to retry.
        if (e instanceof PaymentProviderError && (e.status === 404 || e.status === 422)) return { received: true };
        ctx.log.error({ err: e }, 'mollie webhook lookup failed');
        return reply.code(500).send({ error: 'Lookup failed' });
      }
      if (!p) return reply.code(400).send({ error: 'Missing payment id' });
      await applyMolliePayment(shop, p);
      return { received: true };
    };
    scope.post('/webhooks/mollie', mollieWebhook);
    scope.post('/webhooks/mollie/:handle', mollieWebhook);
  });

  /** Back from Mollie: read the payment (the webhook may be late or unreachable on a private install) and show the thank-you page, honest about pending payments. */
  app.get('/checkouts/:token/mollie/return', async (req, reply) => {
    const shop = await primaryShop(ctx, req);
    if (!shop) return reply.code(503).send('Store is not set up');
    const { token } = req.params as { token: string };
    const order = await getOrderByCheckoutToken(db, shop.id, token);
    if (!order) return reply.redirect(`/checkouts/${token}`, 303);
    const sale = order.transactions.find((t) => t.gateway === 'mollie' && ['SALE', 'AUTHORIZATION'].includes(t.kind) && t.paymentId);
    const mollie = sale && order.order.financialStatus === 'PENDING' ? await app.checkoutPayments.mollieForShop(shop.id) : null;
    if (sale && mollie) {
      try {
        const p = await mollie.getPayment(sale.paymentId!);
        await applyMolliePayment(shop, p);
        if (p.status === 'failed' || p.status === 'voided') return settleView(req, reply, shop, order, { text: pageContextT(shop)('payNotCompleted', { name: order.order.name }) });
      } catch (e) { ctx.log.warn({ err: e }, 'mollie payment could not be read on return'); }
    }
    return reply.redirect(`/checkouts/${token}/thank-you`, 303);
  });
}
