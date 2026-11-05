import { postGuardedJson, webhooksAllowPrivate } from '../net-guard';
import type { ShippingConfig } from '../settings/config';
import { CarrierError, type CarrierAccount, type CarrierLabelSupport } from './carrier-types';
import { testLabels, testQuote } from './test-carrier';

export * from './carrier-types';

/**
 * Carrier-calculated rates: the price of a rate is asked from a provider at checkout instead of being fixed.
 * Providers are registered here; a rate stores the provider id and its parameters, and may point to a carrier account of Settings > Shipping.
 * A provider may also sell postage (`labels`): label rates, purchase and void for the carrier accounts of that provider.
 */
export interface CarrierQuoteContext {
  params: Record<string, unknown>;
  account: ShippingConfig['carrierAccounts'][number] | null;
  totals: { subtotal: number; grams: number };
  destination: { countryCode: string | null; provinceCode?: string | null; zip?: string | null };
  /** Price of the fixed fallback of the rate (minor units), used when the provider cannot answer. */
  fallback: number;
}

export interface CarrierProvider {
  id: string;
  name: string;
  /** Needs a carrier account (endpoint and secret). */
  needsAccount: boolean;
  /** Parameters the rate editor asks for. */
  params: { key: string; label: string; kind: 'money' | 'text' }[];
  /** Price in minor units, or null when the carrier has no offer for the cart (the rate is then not offered). */
  quote(ctx: CarrierQuoteContext): Promise<number | null>;
  /** Label purchase, for the accounts of this provider that sell postage. */
  labels?: CarrierLabelSupport;
  /** Sample data only (the built-in test carrier): shown as test mode everywhere. */
  test?: boolean;
}

const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) && n >= 0 ? Math.round(n) : 0; };
const str = (v: unknown, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const currencyOf = (v: unknown, fallback: string) => (typeof v === 'string' && /^[A-Za-z]{3}$/.test(v) ? v.toUpperCase() : fallback);
const HTTPS = /^https:\/\//;
const BASE64 = /^[A-Za-z0-9+/=\s]+$/;

/** Demo provider without any account: a base price plus a price per started kilogram (minor units). */
const demoFlat: CarrierProvider = {
  id: 'demo_flat', name: 'Demo carrier (base + per kg)', needsAccount: false,
  params: [{ key: 'base', label: 'Base price', kind: 'money' }, { key: 'perKg', label: 'Price per kg', kind: 'money' }],
  async quote({ params, totals }) { return num(params.base) + num(params.perKg) * Math.ceil(totals.grams / 1000); },
};

/** POST a JSON body to the account's endpoint with its bearer secret; non-2xx answers and `{"error": "..."}` become a {@link CarrierError}. */
async function callAccount(account: CarrierAccount, body: Record<string, unknown>, o: { timeoutMs: number; maxBytes?: number }): Promise<Record<string, unknown>> {
  if (!account.endpoint) throw new CarrierError(`${account.name}: the carrier account has no endpoint`);
  let res: { status: number; body: string };
  try {
    res = await postGuardedJson(new URL(account.endpoint), {
      headers: { 'content-type': 'application/json', accept: 'application/json', ...(account.secret ? { authorization: `Bearer ${account.secret}` } : {}) },
      body: JSON.stringify(body), timeoutMs: o.timeoutMs, allowPrivate: webhooksAllowPrivate(), maxBytes: o.maxBytes,
    });
  } catch (e) { throw new CarrierError(`${account.name} did not answer (${e instanceof Error ? e.message : String(e)})`); }
  let j: Record<string, unknown> = {};
  try { j = JSON.parse(res.body || '{}') as Record<string, unknown>; } catch { /* reported below */ }
  if (res.status < 200 || res.status >= 300 || typeof j.error === 'string') throw new CarrierError(`${account.name}: ${str(j.error, 300) || `HTTP ${res.status}`}`);
  return j;
}

/** HTTP label contract (docs/dev/carrier-labels.md): `label_rates`, `label_purchase` and `label_void` actions on the account's endpoint. */
const httpLabels: CarrierLabelSupport = {
  async rates(account, shipment) {
    const j = await callAccount(account, { action: 'label_rates', shipment }, { timeoutMs: 8000 });
    const list = Array.isArray(j.rates) ? (j.rates as Array<Record<string, unknown>>) : [];
    return list.flatMap((r) => {
      const id = str(r.id);
      const price = Number(r.price);
      if (!id || !Number.isFinite(price) || price < 0) return [];
      const days = Number(r.estimatedDays);
      return [{ id, service: str(r.service, 100) || id, name: str(r.name, 120) || str(r.service, 100) || id, price: Math.round(price), currency: currencyOf(r.currency, shipment.currency), estimatedDays: r.estimatedDays != null && Number.isFinite(days) && days >= 0 ? Math.round(days) : null }];
    });
  },
  async purchase(account, shipment, rateId) {
    const j = await callAccount(account, { action: 'label_purchase', rateId, shipment }, { timeoutMs: 20_000, maxBytes: 8 * 1024 * 1024 });
    const label = (j.label && typeof j.label === 'object' ? j.label : {}) as Record<string, unknown>;
    const url = str(label.url, 2000);
    const data = typeof label.data === 'string' && label.data.length > 0 && BASE64.test(label.data) ? label.data.replace(/\s+/g, '') : null;
    const trackingNumber = str(j.trackingNumber, 100);
    const price = Number(j.price);
    if (!trackingNumber) throw new CarrierError(`${account.name} returned no tracking number`);
    if (j.price == null || !Number.isFinite(price) || price < 0) throw new CarrierError(`${account.name} returned no price`);
    if (!data && !HTTPS.test(url)) throw new CarrierError(`${account.name} returned no label document`);
    const trackingUrl = str(j.trackingUrl, 2000);
    return {
      labelId: str(j.labelId) || trackingNumber, trackingNumber, trackingUrl: /^https?:\/\//.test(trackingUrl) ? trackingUrl : null,
      service: str(j.service, 100) || rateId, name: str(j.name, 120) || str(j.service, 100) || rateId, price: Math.round(price), currency: currencyOf(j.currency, shipment.currency),
      label: { format: label.format === 'PNG' || label.format === 'ZPL' ? label.format : 'PDF', url: HTTPS.test(url) ? url : null, data },
    };
  },
  async void(account, label) {
    const j = await callAccount(account, { action: 'label_void', labelId: label.labelId, trackingNumber: label.trackingNumber }, { timeoutMs: 10_000 });
    if (j.voided === false) throw new CarrierError(`${account.name} refused to void the label${typeof j.reason === 'string' ? `: ${str(j.reason)}` : ''}`);
    return { refunded: j.refunded !== false };
  },
};

/**
 * Generic HTTP carrier: POSTs the cart weight, value and destination as JSON to the account's endpoint (with a bearer secret) and expects
 * `{"price": <minor units>}` or `{"price": null}` when it does not serve the destination. Works with any carrier a merchant fronts with a small service.
 * When the account has `labels` on, the same endpoint also sells postage (see {@link httpLabels}).
 */
const httpCarrier: CarrierProvider = {
  id: 'http', name: 'HTTP carrier account', needsAccount: true,
  params: [{ key: 'service', label: 'Service code', kind: 'text' }],
  async quote({ params, account, totals, destination, fallback }) {
    if (!account?.endpoint) return fallback;
    try {
      const res = await postGuardedJson(new URL(account.endpoint), {
        headers: { 'content-type': 'application/json', ...(account.secret ? { authorization: `Bearer ${account.secret}` } : {}) },
        body: JSON.stringify({ service: typeof params.service === 'string' ? params.service : '', grams: totals.grams, subtotal: totals.subtotal, destination }),
        timeoutMs: 4000, allowPrivate: webhooksAllowPrivate(),
      });
      if (res.status < 200 || res.status >= 300) return fallback;
      const j = JSON.parse(res.body) as { price?: unknown };
      return j.price == null ? null : num(j.price);
    } catch { return fallback; }
  },
  labels: httpLabels,
};

/** Built-in test carrier: sample prices and fake labels (PDF marked as a test, tracking numbers that track nothing). No account endpoint. */
const testCarrier: CarrierProvider = {
  id: 'test', name: 'Test carrier (test mode)', needsAccount: true, test: true,
  params: [{ key: 'service', label: 'Service (standard or express)', kind: 'text' }],
  async quote({ params, account, totals, fallback }) { return account ? testQuote(typeof params.service === 'string' ? params.service : 'standard', totals.grams) : fallback; },
  labels: testLabels,
};

const REGISTRY = new Map<string, CarrierProvider>([[demoFlat.id, demoFlat], [httpCarrier.id, httpCarrier], [testCarrier.id, testCarrier]]);
export const registerCarrierProvider = (p: CarrierProvider) => { REGISTRY.set(p.id, p); };
export const carrierProviders = (): CarrierProvider[] => [...REGISTRY.values()];
export const carrierProvider = (id: string | null | undefined): CarrierProvider | null => (id ? REGISTRY.get(id) ?? null : null);

/** Whether a carrier account can sell postage: its provider supports labels and, for HTTP accounts, the merchant said the endpoint does. */
export const accountSellsLabels = (a: CarrierAccount): boolean => !!carrierProvider(a.provider)?.labels && (a.provider !== 'http' || a.labels);
