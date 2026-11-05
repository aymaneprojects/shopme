import { Liquid } from 'liquidjs';
import type { Shop } from './shops';
import { configOf } from './settings/config';
import { postGuardedJson, webhooksAllowPrivate } from './net-guard';

const liquid = new Liquid({ strictVariables: false, strictFilters: false });

/** Liquid error of an SMS body, or null when it parses. */
export function smsTemplateError(source: string): string | null {
  try { liquid.parse(source); return null; } catch (e) { return e instanceof Error ? e.message : 'Invalid template'; }
}

/** Whether the store can send the SMS of this notification: a gateway is set and the template is switched on with a body. */
export function smsEnabledFor(shop: Pick<Shop, 'settings'>, key: string): boolean {
  const c = configOf(shop, 'NOTIFICATIONS').sms;
  const t = c.templates[key];
  return !!c.gatewayUrl && !!t?.enabled && !!t.body.trim();
}

/** Render the SMS body of a notification with the same Liquid variables as its email. */
export async function renderSms(shop: Shop, key: string, vars: Record<string, unknown>): Promise<string | null> {
  const t = configOf(shop, 'NOTIFICATIONS').sms.templates[key];
  if (!t?.body.trim()) return null;
  return (await liquid.parseAndRender(t.body, { shop: { name: shop.name, email: shop.email }, ...vars })).replace(/\s+/g, ' ').trim();
}

/** Valid-looking international or national phone number (digits, spaces, dashes, a leading plus). */
export const isSmsNumber = (v: string | null | undefined): v is string => !!v && /^\+?[0-9][0-9 ().-]{5,19}$/.test(v.trim());

/**
 * Send the SMS of a notification through the merchant's gateway: `POST {to, body, from}` as JSON with `Authorization: Bearer <secret>`.
 * Returns false when SMS is off for this notification, the buyer has no usable number or the gateway refused.
 */
export async function sendSms(shop: Shop, key: string, to: string | null | undefined, vars: Record<string, unknown>): Promise<boolean> {
  if (!smsEnabledFor(shop, key) || !isSmsNumber(to)) return false;
  const c = configOf(shop, 'NOTIFICATIONS').sms;
  const body = await renderSms(shop, key, vars);
  if (!body) return false;
  try {
    const res = await postGuardedJson(new URL(c.gatewayUrl), {
      headers: { 'content-type': 'application/json', ...(c.secret ? { authorization: `Bearer ${c.secret}` } : {}) },
      body: JSON.stringify({ to: to.trim(), body, from: shop.name, notification: key }), timeoutMs: 5000, allowPrivate: webhooksAllowPrivate(),
    });
    return res.status >= 200 && res.status < 300;
  } catch { return false; }
}
