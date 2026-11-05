import { postGuardedJson, webhooksAllowPrivate } from '../net-guard';
import type { ShippingConfig } from '../settings/config';

/**
 * Carrier-calculated rates: the price of a rate is asked from a provider at checkout instead of being fixed.
 * Providers are registered here; a rate stores the provider id and its parameters, and may point to a carrier account of Settings > Shipping.
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
}

const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) && n >= 0 ? Math.round(n) : 0; };

/** Demo provider without any account: a base price plus a price per started kilogram (minor units). */
const demoFlat: CarrierProvider = {
  id: 'demo_flat', name: 'Demo carrier (base + per kg)', needsAccount: false,
  params: [{ key: 'base', label: 'Base price', kind: 'money' }, { key: 'perKg', label: 'Price per kg', kind: 'money' }],
  async quote({ params, totals }) { return num(params.base) + num(params.perKg) * Math.ceil(totals.grams / 1000); },
};

/**
 * Generic HTTP carrier: POSTs the cart weight, value and destination as JSON to the account's endpoint (with a bearer secret) and expects
 * `{"price": <minor units>}` or `{"price": null}` when it does not serve the destination. Works with any carrier a merchant fronts with a small service.
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
};

const REGISTRY = new Map<string, CarrierProvider>([[demoFlat.id, demoFlat], [httpCarrier.id, httpCarrier]]);
export const registerCarrierProvider = (p: CarrierProvider) => { REGISTRY.set(p.id, p); };
export const carrierProviders = (): CarrierProvider[] => [...REGISTRY.values()];
export const carrierProvider = (id: string | null | undefined): CarrierProvider | null => (id ? REGISTRY.get(id) ?? null : null);
