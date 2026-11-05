import { createHmac, timingSafeEqual } from 'node:crypto';

/** Fill `{order}`, `{amount}`, `{currency}`, `{email}`, `{reference}` and `{return_url}` in a gateway's payment page URL (values are URL-encoded). */
export function fillRedirectUrl(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? encodeURIComponent(String(vars[k])) : m));
}

/** Hex HMAC-SHA256 of the raw body: what a payment provider sends in `X-ShopMe-Signature` when it confirms a payment. */
export const signPaymentWebhook = (secret: string, rawBody: string | Buffer): string => createHmac('sha256', secret).update(rawBody).digest('hex');

export function verifyPaymentWebhook(secret: string, rawBody: string | Buffer, signature: string): boolean {
  if (!secret || !signature) return false;
  const a = Buffer.from(signPaymentWebhook(secret, rawBody), 'hex');
  const b = Buffer.from(signature.trim().toLowerCase().replace(/^sha256=/, ''), 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}
