import { beforeEach, describe, expect, it } from 'vitest';
import {
  PaymentProviderError, clearPayPalTokenCache, createMollieAdapter, createPayPalAdapter, mapMollieRefundStatus, mapMollieStatus, mapPayPalStatus,
  minorToDecimal, parseMollieSettings, parsePayPalSettings, toMollieAmount, toPayPalValue, type FetchLike,
} from './index';

interface Call { url: string; method: string; headers: Record<string, string>; body?: string; signal?: AbortSignal }
type Reply = { status?: number; json?: unknown; text?: string } | Error;

/** Fake fetch answering from a queue of replies (or a function) and recording every call. */
function fakeFetch(replies: Reply[] | ((c: Call) => Reply)) {
  const calls: Call[] = [];
  const fetch: FetchLike = async (url, init) => {
    const c: Call = { url, method: init.method, headers: init.headers, body: init.body, signal: init.signal };
    calls.push(c);
    const r = typeof replies === 'function' ? replies(c) : replies.shift();
    if (!r) throw new Error(`unexpected call ${init.method} ${url}`);
    if (r instanceof Error) throw r;
    const status = r.status ?? 200;
    return { ok: status >= 200 && status < 300, status, headers: { get: () => null }, text: async () => r.text ?? (r.json === undefined ? '' : JSON.stringify(r.json)) };
  };
  return { fetch, calls };
}

const tokenReply = (expires_in = 3600, access_token = 'tok1'): Reply => ({ json: { access_token, token_type: 'Bearer', expires_in } });
const ppSettings = { clientId: 'cid', clientSecret: 'secret', webhookId: 'WH-1', environment: 'sandbox' as const };
const bearer = (t: string) => `Bearer ${t}`;

describe('amount formatting', () => {
  it('formats 2-decimal, 0-decimal and 3-decimal currencies', () => {
    expect(toPayPalValue(1050, 'EUR')).toBe('10.50');
    expect(toPayPalValue(5, 'usd')).toBe('0.05');
    expect(toPayPalValue(0, 'EUR')).toBe('0.00');
    expect(toPayPalValue(1234, 'JPY')).toBe('1234');
    expect(toPayPalValue(1234500, 'KWD')).toBe('1234.500');
    expect(toMollieAmount(1050, 'EUR')).toEqual({ currency: 'EUR', value: '10.50' });
    expect(toMollieAmount(1234, 'jpy')).toEqual({ currency: 'JPY', value: '1234' });
  });
  it('PayPal sends HUF and TWD as whole units and refuses fractions', () => {
    expect(toPayPalValue(150000, 'HUF')).toBe('1500');
    expect(toPayPalValue(99900, 'TWD')).toBe('999');
    expect(() => toPayPalValue(150050, 'HUF')).toThrow(/cannot be expressed/);
  });
  it('rejects invalid amounts', () => {
    expect(() => minorToDecimal('mollie', 1.5, 'EUR', 2)).toThrow(PaymentProviderError);
    expect(() => toPayPalValue(-1, 'EUR')).toThrow(PaymentProviderError);
  });
});

describe('settings validation', () => {
  it('validates PayPal settings', () => {
    expect(parsePayPalSettings({ ...ppSettings, clientId: ' cid ' }).clientId).toBe('cid');
    for (const bad of [{}, { ...ppSettings, clientId: '' }, { ...ppSettings, clientSecret: '' }, { ...ppSettings, webhookId: '' }, { ...ppSettings, environment: 'prod' }, null]) {
      expect(() => parsePayPalSettings(bad)).toThrow(expect.objectContaining({ code: 'invalid_settings' }));
    }
  });
  it('validates the Mollie key', () => {
    expect(parseMollieSettings({ apiKey: 'test_dHar4XY7LxsDOtmnkVtjNVWXLSlXsM' }).mode).toBe('test');
    expect(parseMollieSettings({ apiKey: 'live_dHar4XY7LxsDOtmnkVtjNVWXLSlXsM' }).mode).toBe('live');
    for (const bad of [{}, { apiKey: 'sk_test_x' }, { apiKey: 'test_short' }, { apiKey: 5 }, { apiKey: 'dev_dHar4XY7LxsDOtmnkVtjNVWXLSlXsM' }]) {
      expect(() => parseMollieSettings(bad)).toThrow(expect.objectContaining({ code: 'invalid_settings' }));
    }
  });
});

describe('status mapping', () => {
  it('maps PayPal statuses', () => {
    expect(mapPayPalStatus('order', 'CREATED')).toBe('pending');
    expect(mapPayPalStatus('order', 'APPROVED')).toBe('pending');
    expect(mapPayPalStatus('order', 'COMPLETED')).toBe('paid');
    expect(mapPayPalStatus('capture', 'COMPLETED')).toBe('paid');
    expect(mapPayPalStatus('capture', 'PENDING')).toBe('pending');
    expect(mapPayPalStatus('capture', 'DECLINED')).toBe('failed');
    expect(mapPayPalStatus('capture', 'PARTIALLY_REFUNDED')).toBe('refunded');
    expect(mapPayPalStatus('authorization', 'CREATED')).toBe('authorized');
    expect(mapPayPalStatus('authorization', 'VOIDED')).toBe('voided');
    expect(mapPayPalStatus('authorization', 'CAPTURED')).toBe('paid');
    expect(mapPayPalStatus('refund', 'COMPLETED')).toBe('refunded');
    expect(mapPayPalStatus('refund', 'PENDING')).toBe('pending');
    expect(mapPayPalStatus('refund', 'FAILED')).toBe('failed');
  });
  it('maps Mollie statuses', () => {
    expect(['open', 'pending', 'authorized', 'paid', 'canceled', 'expired', 'failed'].map(mapMollieStatus))
      .toEqual(['pending', 'pending', 'authorized', 'paid', 'voided', 'failed', 'failed']);
    expect(['queued', 'pending', 'processing', 'refunded', 'failed', 'canceled'].map(mapMollieRefundStatus))
      .toEqual(['pending', 'pending', 'pending', 'refunded', 'failed', 'failed']);
  });
});

describe('PayPal adapter', () => {
  beforeEach(() => clearPayPalTokenCache());

  it('creates and deletes a webhook, and checks credentials, without a webhook id', async () => {
    const { fetch, calls } = fakeFetch((c) => (c.url.endsWith('/token') ? tokenReply() : c.method === 'DELETE' ? { status: 204 } : { status: 201, json: { id: 'WH-new' } }));
    const pp = createPayPalAdapter({ ...ppSettings, webhookId: '' }, { fetch, allowMissingWebhook: true });
    await pp.verifyCredentials();
    expect(await pp.createWebhook('https://shop.example.com/webhooks/paypal')).toEqual({ id: 'WH-new' });
    const post = calls.find((c) => c.url.endsWith('/v1/notifications/webhooks'))!;
    expect(JSON.parse(post.body!)).toMatchObject({ url: 'https://shop.example.com/webhooks/paypal', event_types: expect.arrayContaining([{ name: 'PAYMENT.CAPTURE.REFUNDED' }]) });
    await pp.deleteWebhook('WH-new');
    expect(calls.at(-1)).toMatchObject({ method: 'DELETE', url: expect.stringContaining('/v1/notifications/webhooks/WH-new') });
    expect(await pp.verifyWebhook({}, '{}')).toBeNull();
    expect(() => createPayPalAdapter({ ...ppSettings, webhookId: '' }, { fetch })).toThrow(/webhookId is required/);
  });

  it('requests a token with Basic auth, caches it per client id, and refreshes after expiry', async () => {
    let t = 1_000_000;
    const { fetch, calls } = fakeFetch((c) => (c.url.endsWith('/v1/oauth2/token') ? tokenReply(120, `tok${calls.filter((x) => x.url.endsWith('/token')).length}`) : { json: { id: 'O1', status: 'CREATED', purchase_units: [] } }));
    const pp = createPayPalAdapter(ppSettings, { fetch, now: () => t });
    await pp.getOrder('O1');
    await pp.getOrder('O1');
    expect(calls.filter((c) => c.url.endsWith('/token'))).toHaveLength(1);
    const tok = calls[0]!;
    expect(tok.url).toBe('https://api-m.sandbox.paypal.com/v1/oauth2/token');
    expect(tok.method).toBe('POST');
    expect(tok.headers.Authorization).toBe(`Basic ${Buffer.from('cid:secret').toString('base64')}`);
    expect(tok.headers['Content-Type']).toBe('application/x-www-form-urlencoded');
    expect(tok.body).toBe('grant_type=client_credentials');
    expect(calls[1]!.headers.Authorization).toBe(bearer('tok1'));
    t += 61_000; // 120s ttl minus the 60s safety margin has passed
    await pp.getOrder('O1');
    expect(calls.filter((c) => c.url.endsWith('/token'))).toHaveLength(2);
    expect(calls.at(-1)!.headers.Authorization).toBe(bearer('tok2'));
  });

  it('keeps separate tokens per client id and uses the live host', async () => {
    const { fetch, calls } = fakeFetch((c) => (c.url.endsWith('/token') ? tokenReply() : { json: { id: 'O', status: 'CREATED' } }));
    const a = createPayPalAdapter(ppSettings, { fetch });
    const b = createPayPalAdapter({ ...ppSettings, clientId: 'other', environment: 'live' }, { fetch });
    await a.getOrder('O'); await b.getOrder('O');
    expect(calls.filter((c) => c.url.endsWith('/token'))).toHaveLength(2);
    expect(calls.some((c) => c.url === 'https://api-m.paypal.com/v2/checkout/orders/O')).toBe(true);
  });

  it('refreshes the token once on a 401', async () => {
    const { fetch, calls } = fakeFetch([tokenReply(3600, 'old'), { status: 401, json: { name: 'AUTHENTICATION_FAILURE', message: 'expired' } }, tokenReply(3600, 'new'), { json: { id: 'O', status: 'CREATED' } }]);
    const pp = createPayPalAdapter(ppSettings, { fetch });
    expect((await pp.getOrder('O')).orderId).toBe('O');
    expect(calls[3]!.headers.Authorization).toBe(bearer('new'));
  });

  it('creates an order with idempotency header, experience context and approval link', async () => {
    const { fetch, calls } = fakeFetch([tokenReply(), { status: 201, json: { id: 'ORD1', status: 'PAYER_ACTION_REQUIRED', links: [{ rel: 'self', href: 'https://x/self' }, { rel: 'payer-action', href: 'https://paypal.test/checkoutnow?token=ORD1' }] } }]);
    const pp = createPayPalAdapter(ppSettings, { fetch });
    const r = await pp.createOrder({ amount: 1050, currency: 'EUR', intent: 'CAPTURE', orderId: 'ord_1', invoiceId: 'INV-1', description: 'Order #1', returnUrl: 'https://s.test/ok', cancelUrl: 'https://s.test/cancel', idempotencyKey: 'idem-1' });
    expect(r).toEqual({ id: 'ORD1', providerStatus: 'PAYER_ACTION_REQUIRED', approvalUrl: 'https://paypal.test/checkoutnow?token=ORD1' });
    const c = calls[1]!;
    expect(c.url).toBe('https://api-m.sandbox.paypal.com/v2/checkout/orders');
    expect(c.method).toBe('POST');
    expect(c.headers['PayPal-Request-Id']).toBe('idem-1');
    expect(c.headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(c.body!)).toEqual({
      intent: 'CAPTURE',
      purchase_units: [{ reference_id: 'ord_1', custom_id: 'ord_1', invoice_id: 'INV-1', description: 'Order #1', amount: { currency_code: 'EUR', value: '10.50' } }],
      payment_source: { paypal: { experience_context: { return_url: 'https://s.test/ok', cancel_url: 'https://s.test/cancel', user_action: 'PAY_NOW' } } },
    });
  });

  it('falls back to the approve link and supports AUTHORIZE with JPY', async () => {
    const { fetch, calls } = fakeFetch([tokenReply(), { json: { id: 'O2', status: 'CREATED', links: [{ rel: 'approve', href: 'https://paypal.test/approve' }] } }]);
    const r = await createPayPalAdapter(ppSettings, { fetch }).createOrder({ amount: 3000, currency: 'JPY', intent: 'AUTHORIZE', orderId: 'o', returnUrl: 'r', cancelUrl: 'c', idempotencyKey: 'k' });
    expect(r.approvalUrl).toBe('https://paypal.test/approve');
    const body = JSON.parse(calls[1]!.body!);
    expect(body.intent).toBe('AUTHORIZE');
    expect(body.purchase_units[0].amount).toEqual({ currency_code: 'JPY', value: '3000' });
    expect(body.purchase_units[0].invoice_id).toBeUndefined();
  });

  it('captures an order and returns the provider ids', async () => {
    const { fetch, calls } = fakeFetch([tokenReply(), { status: 201, json: { id: 'ORD1', status: 'COMPLETED', purchase_units: [{ custom_id: 'ord_1', payments: { captures: [{ id: 'CAP1', status: 'COMPLETED', amount: { currency_code: 'EUR', value: '10.50' } }] } }] } }]);
    const r = await createPayPalAdapter(ppSettings, { fetch }).captureOrder('ORD1', 'cap-key');
    expect(r).toEqual({ orderId: 'ORD1', providerStatus: 'COMPLETED', status: 'paid', captureId: 'CAP1', authorizationId: null, amount: 1050, currency: 'EUR', reference: 'ord_1' });
    expect(calls[1]).toMatchObject({ url: 'https://api-m.sandbox.paypal.com/v2/checkout/orders/ORD1/capture', method: 'POST' });
    expect(calls[1]!.headers['PayPal-Request-Id']).toBe('cap-key');
  });

  it('authorizes an order, then captures and voids the authorization', async () => {
    const { fetch, calls } = fakeFetch([
      tokenReply(),
      { status: 201, json: { id: 'ORD1', status: 'COMPLETED', purchase_units: [{ reference_id: 'ref', payments: { authorizations: [{ id: 'AUTH1', status: 'CREATED', amount: { currency_code: 'HUF', value: '1500' } }] } }] } },
      { status: 201, json: { id: 'CAP2', status: 'COMPLETED', amount: { currency_code: 'EUR', value: '5.00' } } },
      { status: 201, json: { id: 'CAP3', status: 'PENDING' } },
      { status: 204, text: '' },
    ]);
    const pp = createPayPalAdapter(ppSettings, { fetch });
    const a = await pp.authorizeOrder('ORD1');
    expect(a).toMatchObject({ status: 'authorized', authorizationId: 'AUTH1', captureId: null, amount: 150000, currency: 'HUF', reference: 'ref' });
    expect(calls[1]!.url).toMatch(/\/orders\/ORD1\/authorize$/);
    expect(calls[1]!.headers['PayPal-Request-Id']).toBeUndefined();

    const c = await pp.captureAuthorization('AUTH1', { amount: 500, currency: 'EUR', finalCapture: true, idempotencyKey: 'k1' });
    expect(c).toEqual({ id: 'CAP2', providerStatus: 'COMPLETED', status: 'paid', amount: 500, currency: 'EUR' });
    expect(calls[2]!.url).toBe('https://api-m.sandbox.paypal.com/v2/payments/authorizations/AUTH1/capture');
    expect(calls[2]!.headers['PayPal-Request-Id']).toBe('k1');
    expect(JSON.parse(calls[2]!.body!)).toEqual({ amount: { currency_code: 'EUR', value: '5.00' }, final_capture: true });

    expect((await pp.captureAuthorization('AUTH1', { idempotencyKey: 'k2' })).status).toBe('pending');
    expect(JSON.parse(calls[3]!.body!)).toEqual({});

    await pp.voidAuthorization('AUTH1', 'k3');
    expect(calls[4]).toMatchObject({ url: 'https://api-m.sandbox.paypal.com/v2/payments/authorizations/AUTH1/void', method: 'POST' });
    expect(calls[4]!.headers['PayPal-Request-Id']).toBe('k3');
    expect(calls[4]!.body).toBeUndefined();
  });

  it('refunds a capture fully or partially', async () => {
    const { fetch, calls } = fakeFetch([tokenReply(), { status: 201, json: { id: 'REF1', status: 'COMPLETED', amount: { currency_code: 'EUR', value: '2.50' } } }, { status: 201, json: { id: 'REF2', status: 'PENDING' } }]);
    const pp = createPayPalAdapter(ppSettings, { fetch });
    const r = await pp.refundCapture('CAP1', { amount: 250, currency: 'EUR', note: 'Sorry', idempotencyKey: 'rk' });
    expect(r).toEqual({ id: 'REF1', providerStatus: 'COMPLETED', status: 'refunded', amount: 250, currency: 'EUR' });
    expect(calls[1]).toMatchObject({ url: 'https://api-m.sandbox.paypal.com/v2/payments/captures/CAP1/refund', method: 'POST' });
    expect(calls[1]!.headers['PayPal-Request-Id']).toBe('rk');
    expect(JSON.parse(calls[1]!.body!)).toEqual({ amount: { currency_code: 'EUR', value: '2.50' }, note_to_payer: 'Sorry' });
    expect((await pp.refundCapture('CAP1', { idempotencyKey: 'rk2' })).status).toBe('pending');
    expect(JSON.parse(calls[2]!.body!)).toEqual({});
    await expect(pp.refundCapture('CAP1', { amount: 100, idempotencyKey: 'x' })).rejects.toMatchObject({ code: 'invalid_amount' });
  });

  describe('verifyWebhook', () => {
    const headers = { 'paypal-transmission-id': 'tid', 'paypal-transmission-time': '2026-01-01T00:00:00Z', 'paypal-transmission-sig': 'sig', 'paypal-cert-url': 'https://api.paypal.com/cert', 'paypal-auth-algo': 'SHA256withRSA' };
    const raw = '{"id":"WH-EVT-1","event_type":"PAYMENT.CAPTURE.COMPLETED","resource":{"id":"CAP1","amount":{"value":"10.00"}}}';
    it('returns the event on SUCCESS and posts the raw event text', async () => {
      const { fetch, calls } = fakeFetch([tokenReply(), { json: { verification_status: 'SUCCESS' } }]);
      const ev = await createPayPalAdapter(ppSettings, { fetch }).verifyWebhook(headers, raw);
      expect(ev).toMatchObject({ id: 'WH-EVT-1', event_type: 'PAYMENT.CAPTURE.COMPLETED' });
      const c = calls[1]!;
      expect(c.url).toBe('https://api-m.sandbox.paypal.com/v1/notifications/verify-webhook-signature');
      expect(c.body).toContain(`"webhook_event":${raw}`);
      expect(JSON.parse(c.body!)).toMatchObject({ auth_algo: 'SHA256withRSA', cert_url: 'https://api.paypal.com/cert', transmission_id: 'tid', transmission_sig: 'sig', transmission_time: '2026-01-01T00:00:00Z', webhook_id: 'WH-1' });
    });
    it('accepts upper-case header names', async () => {
      const { fetch } = fakeFetch([tokenReply(), { json: { verification_status: 'SUCCESS' } }]);
      const upper = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toUpperCase(), v]));
      expect(await createPayPalAdapter(ppSettings, { fetch }).verifyWebhook(upper, raw)).not.toBeNull();
    });
    it('returns null on FAILURE, missing headers and invalid JSON without calling PayPal when it can avoid it', async () => {
      const f1 = fakeFetch([tokenReply(), { json: { verification_status: 'FAILURE' } }]);
      expect(await createPayPalAdapter(ppSettings, { fetch: f1.fetch }).verifyWebhook(headers, raw)).toBeNull();
      const f2 = fakeFetch([]);
      const pp = createPayPalAdapter(ppSettings, { fetch: f2.fetch });
      expect(await pp.verifyWebhook({ ...headers, 'paypal-transmission-sig': undefined }, raw)).toBeNull();
      expect(await pp.verifyWebhook(headers, 'not json')).toBeNull();
      expect(f2.calls).toHaveLength(0);
    });
    it('throws when the verification call itself errors', async () => {
      const { fetch } = fakeFetch([tokenReply(), { status: 500, json: { name: 'INTERNAL_SERVER_ERROR', message: 'boom', debug_id: 'dbg' } }]);
      await expect(createPayPalAdapter(ppSettings, { fetch }).verifyWebhook(headers, raw)).rejects.toMatchObject({ code: 'INTERNAL_SERVER_ERROR', status: 500 });
    });
  });

  describe('errors', () => {
    it('maps PayPal error bodies', async () => {
      const { fetch } = fakeFetch([tokenReply(), { status: 422, json: { name: 'UNPROCESSABLE_ENTITY', message: 'The requested action could not be performed.', debug_id: 'abc123', details: [{ issue: 'INSTRUMENT_DECLINED', description: 'The instrument presented was declined.' }] } }]);
      const err = await createPayPalAdapter(ppSettings, { fetch }).captureOrder('O').catch((e) => e);
      expect(err).toBeInstanceOf(PaymentProviderError);
      expect(err).toMatchObject({ provider: 'paypal', code: 'UNPROCESSABLE_ENTITY', status: 422, debugId: 'abc123' });
      expect(err.message).toContain('The instrument presented was declined.');
    });
    it('reports bad credentials from the token endpoint without leaking secrets', async () => {
      const { fetch } = fakeFetch([{ status: 401, json: { error: 'invalid_client', error_description: 'Client Authentication failed' } }]);
      const err = await createPayPalAdapter(ppSettings, { fetch }).getOrder('O').catch((e) => e);
      expect(err).toMatchObject({ code: 'invalid_client', status: 401 });
      expect(JSON.stringify(err.message)).not.toContain('secret');
    });
    it('turns timeouts and network errors into typed errors and passes an abort signal', async () => {
      const t = Object.assign(new Error('The operation was aborted'), { name: 'TimeoutError' });
      const f1 = fakeFetch([t]);
      await expect(createPayPalAdapter(ppSettings, { fetch: f1.fetch, timeoutMs: 50 }).getOrder('O')).rejects.toMatchObject({ code: 'timeout', message: expect.stringContaining('timed out after 50 ms') });
      expect(f1.calls[0]!.signal).toBeInstanceOf(AbortSignal);
      clearPayPalTokenCache();
      const f2 = fakeFetch([new Error('ECONNRESET')]);
      await expect(createPayPalAdapter(ppSettings, { fetch: f2.fetch }).getOrder('O')).rejects.toMatchObject({ code: 'network_error' });
    });
    it('handles non-JSON error bodies', async () => {
      const { fetch } = fakeFetch([tokenReply(), { status: 502, text: '<html>bad gateway</html>' }]);
      await expect(createPayPalAdapter(ppSettings, { fetch }).getOrder('O')).rejects.toMatchObject({ code: 'http_502', status: 502 });
    });
  });
});

describe('Mollie adapter', () => {
  const key = 'test_dHar4XY7LxsDOtmnkVtjNVWXLSlXsM';
  const mk = (replies: Reply[] | ((c: Call) => Reply)) => { const f = fakeFetch(replies); return { ...f, mollie: createMollieAdapter({ apiKey: key }, { fetch: f.fetch }) }; };
  const payment = (over: Record<string, unknown> = {}) => ({ id: 'tr_abc123', status: 'paid', amount: { currency: 'EUR', value: '10.50' }, metadata: { orderId: 'ord_1', shopId: 'shop_1' }, method: 'ideal', ...over });

  it('creates a payment with metadata, urls, manual capture and Idempotency-Key', async () => {
    const { mollie, calls } = mk([{ status: 201, json: payment({ status: 'open', _links: { checkout: { href: 'https://mollie.test/checkout/abc', type: 'text/html' } } }) }]);
    const r = await mollie.createPayment({ amount: 1050, currency: 'EUR', description: 'Order #1', redirectUrl: 'https://s.test/return', cancelUrl: 'https://s.test/cancel', webhookUrl: 'https://s.test/hook', orderId: 'ord_1', shopId: 'shop_1', method: 'creditcard', captureMode: 'manual', idempotencyKey: 'ik-1' });
    expect(r).toEqual({ paymentId: 'tr_abc123', checkoutUrl: 'https://mollie.test/checkout/abc', status: 'pending' });
    const c = calls[0]!;
    expect(c.url).toBe('https://api.mollie.com/v2/payments');
    expect(c.method).toBe('POST');
    expect(c.headers.Authorization).toBe(`Bearer ${key}`);
    expect(c.headers['Idempotency-Key']).toBe('ik-1');
    expect(JSON.parse(c.body!)).toEqual({
      amount: { currency: 'EUR', value: '10.50' }, description: 'Order #1', redirectUrl: 'https://s.test/return', cancelUrl: 'https://s.test/cancel',
      webhookUrl: 'https://s.test/hook', metadata: { orderId: 'ord_1', shopId: 'shop_1' }, method: 'creditcard', captureMode: 'manual',
    });
  });

  it('omits optional fields and formats zero-decimal currencies', async () => {
    const { mollie, calls } = mk([{ status: 201, json: payment({ status: 'open' }) }]);
    const r = await mollie.createPayment({ amount: 3000, currency: 'JPY', description: 'x', redirectUrl: 'https://s.test/r', orderId: 'o', shopId: 's', idempotencyKey: 'k' });
    expect(r.checkoutUrl).toBeNull();
    const body = JSON.parse(calls[0]!.body!);
    expect(body.amount).toEqual({ currency: 'JPY', value: '3000' });
    expect(Object.keys(body).sort()).toEqual(['amount', 'description', 'metadata', 'redirectUrl']);
  });

  it('gets a payment and normalises it', async () => {
    const { mollie, calls } = mk([{ json: payment({ status: 'authorized', amountCaptured: { currency: 'EUR', value: '0.00' }, isCancelable: true }) }]);
    const p = await mollie.getPayment('tr_abc123');
    expect(p).toMatchObject({ paymentId: 'tr_abc123', status: 'authorized', providerStatus: 'authorized', amount: 1050, currency: 'EUR', amountRefunded: 0, amountCaptured: 0, isCancelable: true, orderId: 'ord_1', shopId: 'shop_1', method: 'ideal' });
    expect(calls[0]).toMatchObject({ url: 'https://api.mollie.com/v2/payments/tr_abc123', method: 'GET' });
    expect(calls[0]!.headers['Idempotency-Key']).toBeUndefined();
    await expect(mollie.getPayment('../x')).rejects.toMatchObject({ code: 'invalid_id' });
  });

  it('reports a fully refunded paid payment as refunded', async () => {
    const { mollie } = mk([{ json: payment({ amountRefunded: { currency: 'EUR', value: '10.50' } }) }, { json: payment({ amountRefunded: { currency: 'EUR', value: '2.00' } }) }]);
    expect((await mollie.getPayment('tr_abc123')).status).toBe('refunded');
    const partial = await mollie.getPayment('tr_abc123');
    expect(partial).toMatchObject({ status: 'paid', amountRefunded: 200 });
  });

  it('captures an authorization, fully or partially', async () => {
    const { mollie, calls } = mk([
      { status: 201, json: { id: 'cpt_1', status: 'succeeded', amount: { currency: 'EUR', value: '5.00' } } },
      { status: 201, json: { id: 'cpt_2', status: 'pending', amount: { currency: 'EUR', value: '10.50' } } },
    ]);
    expect(await mollie.createCapture('tr_abc123', { amount: 500, currency: 'EUR', description: 'Shipment', idempotencyKey: 'c1' })).toEqual({ captureId: 'cpt_1', providerStatus: 'succeeded', status: 'paid', amount: 500, currency: 'EUR' });
    expect(calls[0]).toMatchObject({ url: 'https://api.mollie.com/v2/payments/tr_abc123/captures', method: 'POST' });
    expect(calls[0]!.headers['Idempotency-Key']).toBe('c1');
    expect(JSON.parse(calls[0]!.body!)).toEqual({ amount: { currency: 'EUR', value: '5.00' }, description: 'Shipment' });
    expect((await mollie.createCapture('tr_abc123', { idempotencyKey: 'c2' })).status).toBe('pending');
    expect(JSON.parse(calls[1]!.body!)).toEqual({});
  });

  it('cancels / releases a payment with DELETE and no idempotency key', async () => {
    const { mollie, calls } = mk([{ json: payment({ status: 'canceled' }) }]);
    expect((await mollie.cancelPayment('tr_abc123')).status).toBe('voided');
    expect(calls[0]).toMatchObject({ url: 'https://api.mollie.com/v2/payments/tr_abc123', method: 'DELETE' });
    expect(calls[0]!.body).toBeUndefined();
  });

  it('creates and reads refunds', async () => {
    const refund = { id: 're_1', paymentId: 'tr_abc123', status: 'pending', amount: { currency: 'EUR', value: '2.50' } };
    const { mollie, calls } = mk([{ status: 201, json: refund }, { json: { ...refund, status: 'refunded' } }]);
    const r = await mollie.createRefund('tr_abc123', { amount: 250, currency: 'EUR', description: 'Return', idempotencyKey: 'r1' });
    expect(r).toEqual({ refundId: 're_1', paymentId: 'tr_abc123', providerStatus: 'pending', status: 'pending', amount: 250, currency: 'EUR' });
    expect(calls[0]).toMatchObject({ url: 'https://api.mollie.com/v2/payments/tr_abc123/refunds', method: 'POST' });
    expect(calls[0]!.headers['Idempotency-Key']).toBe('r1');
    expect(JSON.parse(calls[0]!.body!)).toEqual({ amount: { currency: 'EUR', value: '2.50' }, description: 'Return' });
    expect((await mollie.getRefund('tr_abc123', 're_1')).status).toBe('refunded');
    expect(calls[1]).toMatchObject({ url: 'https://api.mollie.com/v2/payments/tr_abc123/refunds/re_1', method: 'GET' });
  });

  it('lists enabled methods, optionally for an amount and locale', async () => {
    const methods = { count: 2, _embedded: { methods: [
      { resource: 'method', id: 'ideal', description: 'iDEAL', status: 'activated', minimumAmount: { currency: 'EUR', value: '0.01' }, maximumAmount: { currency: 'EUR', value: '50000.00' }, image: {}, _links: {} },
      { resource: 'method', id: 'creditcard', description: 'Cards', status: 'pending-review', minimumAmount: { currency: 'EUR', value: '0.01' }, maximumAmount: null },
    ] } };
    const { mollie, calls } = mk([{ json: methods }, { json: { count: 0, _embedded: { methods: [] } } }]);
    expect(await mollie.listMethods()).toEqual([
      { id: 'ideal', description: 'iDEAL', status: 'activated', minimumAmount: { currency: 'EUR', value: '0.01' }, maximumAmount: { currency: 'EUR', value: '50000.00' } },
      { id: 'creditcard', description: 'Cards', status: 'pending-review', minimumAmount: { currency: 'EUR', value: '0.01' }, maximumAmount: null },
    ]);
    expect(calls[0]).toMatchObject({ url: 'https://api.mollie.com/v2/methods', method: 'GET' });
    expect(await mollie.listMethods({ amount: 1000, currency: 'GBP', locale: 'en_GB' })).toEqual([]);
    const u = new URL(calls[1]!.url);
    expect(u.pathname).toBe('/v2/methods');
    expect(u.searchParams.get('amount[currency]')).toBe('GBP');
    expect(u.searchParams.get('amount[value]')).toBe('10.00');
    expect(u.searchParams.get('locale')).toBe('en_GB');
    await expect(mollie.listMethods({ amount: 5 })).rejects.toMatchObject({ code: 'invalid_amount' });
  });

  describe('resolveWebhook', () => {
    it('re-fetches the payment by id and ignores any other posted data', async () => {
      const { mollie, calls } = mk([{ json: payment({ status: 'paid' }) }]);
      const r = await mollie.resolveWebhook('id=tr_abc123&status=paid&amount=0.01');
      expect(r).toMatchObject({ paymentId: 'tr_abc123', status: 'paid', orderId: 'ord_1' });
      expect(calls).toHaveLength(1);
      expect(calls[0]).toMatchObject({ url: 'https://api.mollie.com/v2/payments/tr_abc123', method: 'GET' });
      expect(calls[0]!.headers.Authorization).toBe(`Bearer ${key}`);
    });
    it('takes the status from Mollie, not from the posted body', async () => {
      const { mollie } = mk([{ json: payment({ status: 'failed' }) }]);
      expect((await mollie.resolveWebhook({ id: 'tr_abc123', status: 'paid' }))!.status).toBe('failed');
    });
    it('accepts URLSearchParams and rejects missing or malformed ids without any request', async () => {
      const { mollie, calls } = mk([{ json: payment() }]);
      expect(await mollie.resolveWebhook(new URLSearchParams('id=tr_abc123'))).not.toBeNull();
      for (const bad of ['', 'id=', 'id=re_123', 'id=tr_a/../b', 'foo=bar', null, undefined, { id: 5 }]) {
        expect(await mollie.resolveWebhook(bad as never)).toBeNull();
      }
      expect(calls).toHaveLength(1);
    });
    it('propagates a 404 for an unknown payment', async () => {
      const { mollie } = mk([{ status: 404, json: { status: 404, title: 'Not Found', detail: 'No payment exists with token tr_zzz.' } }]);
      await expect(mollie.resolveWebhook('id=tr_zzz')).rejects.toMatchObject({ status: 404 });
    });
  });

  describe('errors', () => {
    it('maps Mollie error bodies including the field', async () => {
      const { mollie } = mk([{ status: 422, json: { status: 422, title: 'Unprocessable Entity', detail: 'The amount is higher than the maximum', field: 'amount' } }]);
      const err = await mollie.createPayment({ amount: 1, currency: 'EUR', description: 'x', redirectUrl: 'r', orderId: 'o', shopId: 's', idempotencyKey: 'k' }).catch((e) => e);
      expect(err).toBeInstanceOf(PaymentProviderError);
      expect(err).toMatchObject({ provider: 'mollie', code: 'Unprocessable Entity', status: 422 });
      expect(err.message).toBe('Unprocessable Entity: The amount is higher than the maximum (field: amount)');
    });
    it('never includes the api key in errors', async () => {
      const { mollie } = mk([{ status: 401, json: { status: 401, title: 'Unauthorized Request', detail: 'Missing authentication, or failed to authenticate' } }]);
      const err = await mollie.getPayment('tr_abc123').catch((e) => e);
      expect(JSON.stringify({ m: err.message, c: err.code })).not.toContain(key);
    });
    it('turns timeouts into typed errors and passes an abort signal', async () => {
      const t = Object.assign(new Error('timeout'), { name: 'TimeoutError' });
      const f = fakeFetch([t]);
      const mollie = createMollieAdapter({ apiKey: key }, { fetch: f.fetch, timeoutMs: 25 });
      await expect(mollie.getPayment('tr_abc123')).rejects.toMatchObject({ code: 'timeout', message: expect.stringContaining('25 ms') });
      expect(f.calls[0]!.signal).toBeInstanceOf(AbortSignal);
    });
    it('rejects invalid settings at construction', () => {
      expect(() => createMollieAdapter({ apiKey: 'nope' })).toThrow(PaymentProviderError);
      expect(() => createPayPalAdapter({})).toThrow(PaymentProviderError);
    });
  });
});
