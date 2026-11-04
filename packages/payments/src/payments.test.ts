import Stripe from 'stripe';
import { describe, expect, it } from 'vitest';
import { createStripeGateway, manualProviders, parsePaymentSettings } from './index';

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
