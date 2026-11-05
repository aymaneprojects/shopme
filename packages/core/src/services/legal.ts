import { and, desc, eq } from 'drizzle-orm';
import { customerAddresses, customers, events, shops } from '../db/schema';
import type { Executor } from '../db/client';
import { errR, okR, type Result } from './catalog/common';
import { getOrderDetail, listOrders } from './orders/orders';
import type { Shop } from './shops';
import { privacySettingsOf, updatePrivacySettings } from './privacy/settings';

/** Shopify's ShopPolicyType values ShopMe supports -> storefront handle (`/policies/<handle>`) and default title. */
export const POLICY_TYPES = {
  REFUND_POLICY: { handle: 'refund-policy', title: 'Refund policy' },
  PRIVACY_POLICY: { handle: 'privacy-policy', title: 'Privacy policy' },
  TERMS_OF_SERVICE: { handle: 'terms-of-service', title: 'Terms of service' },
  SHIPPING_POLICY: { handle: 'shipping-policy', title: 'Shipping policy' },
  CONTACT_INFORMATION: { handle: 'contact-information', title: 'Contact information' },
  TERMS_OF_SALE: { handle: 'terms-of-sale', title: 'Terms of sale' },
  LEGAL_NOTICE: { handle: 'legal-notice', title: 'Legal notice' },
  SUBSCRIPTION_POLICY: { handle: 'subscription-policy', title: 'Subscription policy' },
} as const;
export type PolicyType = keyof typeof POLICY_TYPES;
export const POLICY_TYPE_KEYS = Object.keys(POLICY_TYPES) as PolicyType[];

export interface PolicyView { id: number; type: PolicyType; handle: string; title: string; body: string; url: string; createdAt: Date; updatedAt: Date }
interface Stored { title?: string; body?: string; createdAt?: string; updatedAt?: string }

/** Policies live in `shops.settings.policies[handle]`, the shape the storefront (`/policies/*`, `shop.privacy_policy`, ...) already reads. */
export function policiesOf(shop: Shop): PolicyView[] {
  const stored = (shop.settings.policies ?? {}) as Record<string, Stored>;
  return POLICY_TYPE_KEYS.map((type, i) => {
    const { handle, title } = POLICY_TYPES[type]; const s = stored[handle];
    return { id: i + 1, type, handle, title: s?.title ?? title, body: s?.body ?? '', url: `/policies/${handle}`, createdAt: new Date(s?.createdAt ?? shop.createdAt), updatedAt: new Date(s?.updatedAt ?? shop.updatedAt) };
  });
}

/** Set a policy body (HTML). An empty body removes the policy from the storefront. */
export async function updatePolicy(db: Executor, shop: Shop, type: string, body: string): Promise<Result<PolicyView>> {
  if (!(type in POLICY_TYPES)) return errR(['shopPolicy', 'type'], 'Policy type is not supported', 'INVALID');
  if (body.length > 200_000) return errR(['shopPolicy', 'body'], 'Body is too long', 'TOO_BIG');
  const { handle, title } = POLICY_TYPES[type as PolicyType];
  const policies = { ...((shop.settings.policies ?? {}) as Record<string, Stored>) };
  const now = new Date().toISOString();
  if (body.trim()) policies[handle] = { title, body, createdAt: policies[handle]?.createdAt ?? now, updatedAt: now };
  else delete policies[handle];
  const [row] = await db.update(shops).set({ settings: { ...shop.settings, policies }, updatedAt: new Date() }).where(eq(shops.id, shop.id)).returning();
  return okR(policiesOf(row!).find((p) => p.type === type)!);
}

export interface CookieBanner { enabled: boolean; message: string }
/** Legacy view of the cookie banner setting: "enabled" means the banner is always shown (`privacy.cookieBanner.mode = ALWAYS`). */
export const cookieBannerOf = (shop: Shop): CookieBanner => {
  const p = privacySettingsOf(shop);
  return { enabled: p.cookieBanner.mode === 'ALWAYS', message: p.cookieBanner.message };
};
export async function updateCookieBanner(db: Executor, shop: Shop, i: Partial<CookieBanner>): Promise<CookieBanner> {
  const cur = privacySettingsOf(shop);
  const r = await updatePrivacySettings(db, shop, { cookieBanner: { ...(i.enabled != null && { mode: i.enabled ? 'ALWAYS' as const : cur.cookieBanner.mode === 'ALWAYS' ? 'AUTO' as const : cur.cookieBanner.mode }), ...(i.message != null && { message: i.message.slice(0, 1000) }) } });
  return r.ok ? { enabled: r.value.cookieBanner.mode === 'ALWAYS', message: r.value.cookieBanner.message } : cookieBannerOf(shop);
}

/** GDPR "right of access": everything stored about one customer (profile, addresses, orders with lines and payments, timeline). Null when unknown. */
export async function exportCustomerData(db: Executor, shopId: number, customerId: number) {
  const [customer] = await db.select().from(customers).where(and(eq(customers.shopId, shopId), eq(customers.id, customerId))).limit(1);
  if (!customer) return null;
  const { passwordHash: _omit, ...profile } = customer;
  const addresses = await db.select().from(customerAddresses).where(and(eq(customerAddresses.shopId, shopId), eq(customerAddresses.customerId, customerId)));
  const orderRows = await listOrders(db, shopId, { query: `customer_id:${customerId}`, offset: 0, limit: 10_000 });
  const ordersOut = [];
  for (const o of orderRows) {
    const d = await getOrderDetail(db, shopId, o.id);
    ordersOut.push({ ...o, lines: d.lines, shippingAddress: d.shippingAddress, billingAddress: d.billingAddress, shippingLines: d.shippingLines, transactions: d.transactions, fulfillments: d.fulfillments, refunds: d.refunds });
  }
  const timeline = await db.select({ verb: events.verb, kind: events.kind, message: events.message, createdAt: events.createdAt }).from(events)
    .where(and(eq(events.shopId, shopId), eq(events.subjectType, 'customer'), eq(events.subjectId, customerId))).orderBy(desc(events.createdAt));
  return { exportedAt: new Date().toISOString(), customer: profile, addresses, orders: ordersOut, timeline };
}
