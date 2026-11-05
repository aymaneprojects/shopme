import { eq } from 'drizzle-orm';
import { shops } from '../../db/schema';
import type { Executor } from '../../db/client';
import { errR, okR, type Result } from '../catalog/common';
import type { Shop } from '../shops';

/**
 * Checkout settings (Settings > Checkout), stored in `shops.settings.checkout`. The storefront checkout renders and validates
 * from the same object, so a field that is hidden is never asked for and a required one is always enforced on the server.
 */
export type FieldRule = 'hidden' | 'optional' | 'required';
export const FIELD_RULES: readonly FieldRule[] = ['hidden', 'optional', 'required'];
export type MarketingMode = 'hidden' | 'unchecked' | 'checked';
export const MARKETING_MODES: readonly MarketingMode[] = ['hidden', 'unchecked', 'checked'];

export interface CheckoutSettings {
  /** What the buyer identifies with: an email, or an email or a mobile phone number. */
  contactMethod: 'email' | 'email_or_phone';
  /** `guest`: anyone can check out; `required`: the buyer must be signed in to a customer account. */
  accountMode: 'guest' | 'required';
  /** `full`: first and last name; `last`: last name only. */
  nameMode: 'full' | 'last';
  company: FieldRule;
  address2: FieldRule;
  phone: FieldRule;
  /** Email marketing opt-in checkbox below the contact field. */
  marketing: MarketingMode;
  tipping: { enabled: boolean; presets: number[] };
  orderNotes: boolean;
}

export const DEFAULT_CHECKOUT_SETTINGS: CheckoutSettings = {
  contactMethod: 'email', accountMode: 'guest', nameMode: 'full', company: 'optional', address2: 'optional', phone: 'optional',
  marketing: 'unchecked', tipping: { enabled: false, presets: [5, 10, 15] }, orderNotes: false,
};

const pick = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T => ((allowed as readonly unknown[]).includes(v) ? (v as T) : fallback);

export function checkoutSettingsOf(shop: Pick<Shop, 'settings'>): CheckoutSettings {
  const c = (((shop.settings as Record<string, unknown>).checkout ?? {}) as Record<string, any>);
  const d = DEFAULT_CHECKOUT_SETTINGS;
  const presets = Array.isArray(c.tipping?.presets) ? (c.tipping.presets as unknown[]).filter((n): n is number => Number.isInteger(n) && (n as number) > 0 && (n as number) <= 100) : d.tipping.presets;
  return {
    contactMethod: pick(c.contactMethod, ['email', 'email_or_phone'], d.contactMethod),
    accountMode: pick(c.accountMode, ['guest', 'required'], d.accountMode),
    nameMode: pick(c.nameMode, ['full', 'last'], d.nameMode),
    company: pick(c.company, FIELD_RULES, d.company),
    address2: pick(c.address2, FIELD_RULES, d.address2),
    phone: pick(c.phone, FIELD_RULES, d.phone),
    marketing: pick(c.marketing, MARKETING_MODES, d.marketing),
    tipping: { enabled: c.tipping?.enabled === true, presets },
    orderNotes: c.orderNotes === true,
  };
}

export type CheckoutSettingsInput = Partial<Omit<CheckoutSettings, 'tipping'>> & { tipping?: { enabled?: boolean | null; presets?: number[] | null } | null };

export async function updateCheckoutSettings(db: Executor, shop: Shop, input: CheckoutSettingsInput): Promise<Result<CheckoutSettings>> {
  const cur = checkoutSettingsOf(shop);
  const check = <T extends string>(v: T | null | undefined, allowed: readonly T[], field: string): Result<null> =>
    v == null || (allowed as readonly string[]).includes(v) ? okR(null) : errR([field], `${field} is invalid`, 'INVALID');
  for (const [field, v, allowed] of [
    ['contactMethod', input.contactMethod, ['email', 'email_or_phone']], ['accountMode', input.accountMode, ['guest', 'required']], ['nameMode', input.nameMode, ['full', 'last']],
    ['company', input.company, FIELD_RULES], ['address2', input.address2, FIELD_RULES], ['phone', input.phone, FIELD_RULES], ['marketing', input.marketing, MARKETING_MODES],
  ] as const) {
    const r = check(v as string | null | undefined, allowed as readonly string[], field);
    if (!r.ok) return r;
  }
  let presets = cur.tipping.presets;
  if (input.tipping?.presets) {
    if (input.tipping.presets.length > 5) return errR(['tipping', 'presets'], 'Use at most 5 tip presets', 'TOO_LONG');
    if (input.tipping.presets.some((n) => !Number.isInteger(n) || n < 1 || n > 100)) return errR(['tipping', 'presets'], 'Tip presets are whole percentages between 1 and 100', 'INVALID');
    presets = [...new Set(input.tipping.presets)].sort((a, b) => a - b);
  }
  const tipping = { enabled: input.tipping?.enabled ?? cur.tipping.enabled, presets };
  if (tipping.enabled && !presets.length) return errR(['tipping', 'presets'], 'Add at least one tip preset to turn tipping on', 'BLANK');
  const next: CheckoutSettings = {
    contactMethod: input.contactMethod ?? cur.contactMethod, accountMode: input.accountMode ?? cur.accountMode, nameMode: input.nameMode ?? cur.nameMode,
    company: input.company ?? cur.company, address2: input.address2 ?? cur.address2, phone: input.phone ?? cur.phone, marketing: input.marketing ?? cur.marketing,
    tipping, orderNotes: input.orderNotes ?? cur.orderNotes,
  };
  await db.update(shops).set({ settings: { ...shop.settings, checkout: next }, updatedAt: new Date() }).where(eq(shops.id, shop.id));
  return okR(next);
}

/** Address keys the settings ask for (hidden ones are dropped, required ones are validated). */
export function requiredAddressKeys(s: CheckoutSettings): string[] {
  return [
    ...(s.nameMode === 'full' ? ['firstName'] : []), 'lastName', 'address1', 'city', 'zip', 'countryCode',
    ...(s.company === 'required' ? ['company'] : []), ...(s.address2 === 'required' ? ['address2'] : []), ...(s.phone === 'required' ? ['phone'] : []),
  ];
}

/** Remove the address fields the checkout does not collect. */
export function stripHiddenAddressFields<T extends object | null>(a: T, s: CheckoutSettings): T {
  if (!a) return a;
  const out: Record<string, unknown> = { ...a };
  if (s.nameMode === 'last') out.firstName = null;
  if (s.company === 'hidden') out.company = null;
  if (s.address2 === 'hidden') out.address2 = null;
  return out as T;
}

export const isPhone = (v: string) => /^\+?[0-9 ().-]{6,25}$/.test(v.trim()) && v.replace(/\D/g, '').length >= 6;

/** Split what the buyer typed in the contact field: an email, or (when the settings allow it) a phone number. */
export function splitContact(s: CheckoutSettings, raw: string): { email: string | null; phone: string | null } {
  const v = raw.trim();
  if (!v) return { email: null, phone: null };
  if (v.includes('@')) return { email: v, phone: null };
  return s.contactMethod === 'email_or_phone' && isPhone(v) ? { email: null, phone: v } : { email: v, phone: null };
}

/** Tip in minor units for the checkout choice: a percentage of the subtotal, or a custom amount. */
export const tipFor = (subtotal: number, choice: { percent: number | null; amount: number }) => (choice.percent ? Math.round((subtotal * choice.percent) / 100) : Math.max(0, choice.amount));
