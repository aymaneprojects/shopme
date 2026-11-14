import Stripe from 'stripe';
import { describe, expect, it } from 'vitest';
import { createStripeAdmin, createStripeGateway, fillRedirectUrl, STRIPE_WEBHOOK_EVENTS, manualProviders, parsePaymentSettings, signPaymentWebhook, verifyPaymentWebhook } from './index';

describe('payment settings', () => {
  it('enables manual methods by default', () => {
    const s = parsePaymentSettings({});
    expect(manualProviders(s).map((p) => p.id)).toEqual(['bank_transfer', 'cod']);
    expect(s.stripe.enabled).toBe(true);
  });
  it('reads nested and flat keys', () => {
    const s = parsePaymentSettings({ payments: { manual: { bankTransfer: { enabled: true, instructions: 'IBAN 1' }, cod: { enabled: false } } }, 'payments.stripe': { enabled: false } });
    expect(manualProviders(s)).toEqual([{ id: 'bank_transfer', kind: 'manual', instructions: 'IBAN 1' }]);
    expect(s.stripe.enabled).toBe(false);
  });
});

describe('stripe gateway', () => {
  const cfg = { secretKey: 'sk_test_x', publishableKey: 'pk_test_x', webhookSecret: 'whsec_test' };
  it('is off without full config', () => { expect(createStripeGateway({ secretKey: 'sk' })).toBeNull(); });
  it('creates intents through the client', async () => {
    const calls: any[] = [];
    const g = createStripeGateway(cfg, { paymentIntents: { create: async (p) => { calls.push(p); return { id: 'pi_1', client_secret: 'pi_1_secret' }; } }, webhooks: { constructEvent: () => { throw new Error('x'); } } })!;
    expect(await g.createPaymentIntent({ amount: 1234, currency: 'EUR', reference: 'tok', idempotencyKey: 'k' })).toEqual({ id: 'pi_1', clientSecret: 'pi_1_secret' });
    expect(calls[0]).toMatchObject({ amount: 1234, currency: 'eur', metadata: { checkout_token: 'tok' } });
  });
  it('verifies webhook signatures with the real SDK', () => {
    const g = createStripeGateway(cfg)!;
    const payload = JSON.stringify({ id: 'evt_1', object: 'event', type: 'payment_intent.succeeded', data: { object: { id: 'pi_1' } } });
    const header = new Stripe(cfg.secretKey).webhooks.generateTestHeaderString({ payload, secret: cfg.webhookSecret });
    expect(g.verifyWebhook(payload, header).type).toBe('payment_intent.succeeded');
    expect(() => g.verifyWebhook(payload + ' ', header)).toThrow();
    expect(() => g.verifyWebhook(payload, 't=1,v1=bad')).toThrow();
  });
});

describe('redirect gateways', () => {
  it('fills the payment page URL with encoded values and leaves unknown placeholders', () => {
    expect(fillRedirectUrl('https://p.test/?r={reference}&a={amount}&x={unknown}', { reference: '#1001 B', amount: '12.50' })).toBe('https://p.test/?r=%231001%20B&a=12.50&x={unknown}');
  });
  it('verifies the HMAC signature of the webhook body', () => {
    const body = '{"reference":"#1001","status":"paid"}';
    const sig = signPaymentWebhook('secret', body);
    expect(verifyPaymentWebhook('secret', body, sig)).toBe(true);
    expect(verifyPaymentWebhook('secret', body, `sha256=${sig.toUpperCase()}`)).toBe(true);
    expect(verifyPaymentWebhook('other', body, sig)).toBe(false);
    expect(verifyPaymentWebhook('secret', `${body} `, sig)).toBe(false);
    expect(verifyPaymentWebhook('', body, sig)).toBe(false);
    expect(verifyPaymentWebhook('secret', body, 'zz')).toBe(false);
  });
  it('captures an authorised intent through the client', async () => {
    const calls: unknown[][] = [];
    const client = {
      paymentIntents: { create: async (p: Record<string, unknown>) => { calls.push([p]); return { id: 'pi', client_secret: 's' }; }, capture: async (id: string, p?: Record<string, unknown>) => { calls.push([id, p]); } },
      webhooks: { constructEvent: () => { throw new Error('x'); } },
    };
    const gw = createStripeGateway({ secretKey: 'sk', publishableKey: 'pk', webhookSecret: 'wh' }, client)!;
    await gw.createPaymentIntent({ amount: 100, currency: 'EUR', reference: 't', idempotencyKey: 'k', captureMethod: 'manual' });
    await gw.capture('pi', 100, 'idem');
    expect(calls[0]![0]).toMatchObject({ capture_method: 'manual' });
    expect(calls[1]).toEqual(['pi', { amount_to_capture: 100 }]);
  });
});

describe('stripe subscriptions', () => {
  const cfg = { secretKey: 'sk', publishableKey: 'pk', webhookSecret: 'wh' };
  const noHooks = { constructEvent: () => { throw new Error('x'); } };
  it('saves the payment method for later and charges it off-session', async () => {
    const calls: Array<[string, Record<string, unknown>, Record<string, unknown> | undefined]> = [];
    const client = {
      paymentIntents: { create: async (p: Record<string, unknown>, o?: Record<string, unknown>) => { calls.push(['pi', p, o]); return { id: p.off_session ? 'pi_renew' : 'pi_first', client_secret: 's', status: 'succeeded' }; } },
      customers: { create: async (p: Record<string, unknown>, o?: Record<string, unknown>) => { calls.push(['cus', p, o]); return { id: 'cus_1' }; } },
      refunds: { create: async (p: Record<string, unknown>, o?: Record<string, unknown>) => { calls.push(['re', p, o]); return {}; } },
      webhooks: noHooks,
    };
    const gw = createStripeGateway(cfg, client)!;
    expect(await gw.createCustomer({ email: 'a@b.c', reference: 'tok', idempotencyKey: 'k1' })).toBe('cus_1');
    await gw.createPaymentIntent({ amount: 900, currency: 'EUR', reference: 'tok', idempotencyKey: 'k2', setupFutureUsage: 'off_session', customer: 'cus_1' });
    expect(calls[1]![1]).toMatchObject({ setup_future_usage: 'off_session', customer: 'cus_1' });
    expect(await gw.chargeOffSession({ amount: 900, currency: 'EUR', customer: 'cus_1', paymentMethod: 'pm_1', idempotencyKey: 'k3', reference: 'subscription:1' })).toEqual({ ok: true, id: 'pi_renew' });
    expect(calls[2]![1]).toMatchObject({ off_session: true, confirm: true, customer: 'cus_1', payment_method: 'pm_1', currency: 'eur' });
    expect(calls[2]![2]).toEqual({ idempotencyKey: 'k3' });
    await gw.refund('pi_renew', 900, 'k4');
    expect(calls[3]![1]).toEqual({ payment_intent: 'pi_renew', amount: 900 });
  });
  it('reports a declined or unconfirmed off-session charge as data', async () => {
    const declined = Object.assign(new Error('Your card was declined.'), { code: 'card_declined', decline_code: 'insufficient_funds', raw: { payment_intent: { id: 'pi_x' } } });
    const gw = createStripeGateway(cfg, { paymentIntents: { create: async () => { throw declined; } }, webhooks: noHooks })!;
    expect(await gw.chargeOffSession({ amount: 900, currency: 'EUR', customer: 'cus_1', paymentMethod: 'pm_1', idempotencyKey: 'k', reference: 'r' })).toEqual({ ok: false, code: 'insufficient_funds', message: 'Your card was declined.', id: 'pi_x' });
    const action = createStripeGateway(cfg, { paymentIntents: { create: async () => ({ id: 'pi_y', client_secret: 's', status: 'requires_action' }) }, webhooks: noHooks })!;
    expect(await action.chargeOffSession({ amount: 1, currency: 'EUR', customer: 'c', paymentMethod: 'p', idempotencyKey: 'k', reference: 'r' })).toMatchObject({ ok: false, code: 'authentication_required', id: 'pi_y' });
  });
});

describe('stripe refunds, voids and account setup', () => {
  const cfg = { secretKey: 'sk_test_x', publishableKey: 'pk_test_x', webhookSecret: 'whsec_test' };
  const webhooks = new Stripe('sk_test_x').webhooks as never;

  it('refund returns the Stripe refund id, cancel releases the authorisation, listRefunds reads them', async () => {
    const calls: unknown[][] = [];
    const gw = createStripeGateway(cfg, {
      paymentIntents: { create: async () => ({ id: 'pi', client_secret: 's' }), cancel: async (id, p, o) => { calls.push(['cancel', id, p, o]); return {}; } },
      refunds: { create: async (p, o) => { calls.push(['refund', p, o]); return { id: 're_1' }; }, list: async (p) => { calls.push(['list', p]); return { data: [{ id: 're_1', amount: 500, status: 'succeeded' }] }; } },
      webhooks,
    })!;
    expect(await gw.refund('pi_1', 500, 'k1')).toEqual({ id: 're_1' });
    await gw.cancel('pi_1', 'k2');
    expect(await gw.listRefunds('pi_1')).toEqual([{ id: 're_1', amount: 500, status: 'succeeded' }]);
    expect(calls).toEqual([['refund', { payment_intent: 'pi_1', amount: 500 }, { idempotencyKey: 'k1' }], ['cancel', 'pi_1', {}, { idempotencyKey: 'k2' }], ['list', { payment_intent: 'pi_1', limit: 100 }]]);
  });

  it('refund of a client that reports no id gives null', async () => {
    const gw = createStripeGateway(cfg, { paymentIntents: { create: async () => ({ id: 'pi', client_secret: 's' }) }, refunds: { create: async () => undefined }, webhooks })!;
    expect(await gw.refund('pi_1', 1, 'k')).toEqual({ id: null });
  });

  it('admin validates the key, creates the endpoint with the handled events and registers domains', async () => {
    const calls: unknown[][] = [];
    const admin = createStripeAdmin('sk_test_x', {
      paymentIntents: { create: async () => ({ id: 'pi', client_secret: 's' }) }, webhooks,
      accounts: { retrieve: async () => ({ id: 'acct_1' }) },
      webhookEndpoints: { create: async (p) => { calls.push(['create', p]); return { id: 'we_1', secret: 'whsec_new' }; }, del: async (id) => { calls.push(['del', id]); } },
      paymentMethodDomains: { create: async (p) => { calls.push(['domain', p]); } },
    });
    expect(await admin.verifyAccount()).toEqual({ id: 'acct_1' });
    expect(await admin.createWebhookEndpoint('https://shop.example.com/webhooks/stripe')).toEqual({ id: 'we_1', secret: 'whsec_new' });
    await admin.deleteWebhookEndpoint('we_1');
    await admin.registerDomain('shop.example.com');
    expect(calls[0]).toEqual(['create', { url: 'https://shop.example.com/webhooks/stripe', enabled_events: [...STRIPE_WEBHOOK_EVENTS], description: 'ShopMe' }]);
    expect(STRIPE_WEBHOOK_EVENTS).toContain('charge.refunded');
    expect(calls.slice(1)).toEqual([['del', 'we_1'], ['domain', { domain_name: 'shop.example.com' }]]);
  });

  it('admin surfaces Stripe rejections', async () => {
    const admin = createStripeAdmin('sk_test_bad', { paymentIntents: { create: async () => ({ id: 'pi', client_secret: 's' }) }, webhooks, accounts: { retrieve: async () => { throw new Error('Invalid API Key'); } } });
    await expect(admin.verifyAccount()).rejects.toThrow('Invalid API Key');
  });
});
