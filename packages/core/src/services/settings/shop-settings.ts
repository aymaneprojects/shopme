import { and, eq, sql } from 'drizzle-orm';
import { defaultMoneyFormats } from '@shopme/shopify-compat';
import { orders, shops, WEIGHT_UNITS } from '../../db/schema';
import type { Db, Executor } from '../../db/client';
import { errR, okR, type Result } from '../catalog/common';
import { addEvent } from '../events';
import type { Shop } from '../shops';

/** Typed view of the free-form `shops.settings` JSON (the storefront reads the same keys). */
export interface ShopAddress { company?: string | null; address1?: string | null; address2?: string | null; city?: string | null; provinceCode?: string | null; province?: string | null; zip?: string | null; countryCode?: string | null; phone?: string | null }
export interface PaymentSettings {
  manual: { bankTransfer: { enabled: boolean; instructions: string }; cod: { enabled: boolean } };
  stripe: { enabled: boolean };
}

export const shopAddressOf = (s: Shop): ShopAddress => ({ countryCode: s.country, ...((s.settings.address as ShopAddress | undefined) ?? {}) });
export const storefrontOf = (s: Shop) => ({
  passwordEnabled: s.settings.storefrontPasswordEnabled === true,
  password: typeof s.settings.storefrontPassword === 'string' ? s.settings.storefrontPassword : '',
  message: typeof s.settings.passwordMessage === 'string' ? s.settings.passwordMessage : '',
  /** Restrict the whole storefront to signed-in customers who are contacts of a company (B2B). */
  b2bOnly: s.settings.b2bOnly === true,
  homepageTitle: typeof s.settings.homepageTitle === 'string' ? s.settings.homepageTitle : '',
  socialSharingImage: typeof s.settings.socialSharingImage === 'string' ? s.settings.socialSharingImage : '',
});

export function paymentSettingsOf(s: Shop): PaymentSettings {
  const p = (s.settings.payments ?? {}) as { manual?: { bankTransfer?: { enabled?: boolean; instructions?: string }; cod?: { enabled?: boolean } }; stripe?: { enabled?: boolean } };
  return {
    manual: { bankTransfer: { enabled: !!p.manual?.bankTransfer?.enabled, instructions: p.manual?.bankTransfer?.instructions ?? '' }, cod: { enabled: !!p.manual?.cod?.enabled } },
    stripe: { enabled: !!p.stripe?.enabled },
  };
}

export interface ShopSettingsInput {
  name?: string | null; email?: string | null; description?: string | null;
  currency?: string | null; timezone?: string | null; weightUnit?: string | null; locale?: string | null;
  moneyFormat?: string | null; moneyWithCurrencyFormat?: string | null;
  taxesIncluded?: boolean | null; taxShipping?: boolean | null;
  address?: ShopAddress | null;
  storefrontPasswordEnabled?: boolean | null; storefrontPassword?: string | null; storefrontPasswordMessage?: string | null;
  primaryDomain?: string | null;
  /** Storefront preferences: B2B-only access, the home page title and the social sharing image (a file URL). */
  b2bOnly?: boolean | null; homepageTitle?: string | null; socialSharingImage?: string | null;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const HOST_RE = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(:\d{1,5})?$/i;
const validTimezone = (tz: string) => { try { new Intl.DateTimeFormat('en', { timeZone: tz }); return true; } catch { return false; } };

export async function updateShopSettings(db: Db, shopId: number, input: ShopSettingsInput, staffId?: number | null): Promise<Result<Shop>> {
  const [cur] = await db.select().from(shops).where(eq(shops.id, shopId));
  if (!cur) return errR(null, 'Shop not found');
  if (input.name !== undefined && !input.name?.trim()) return errR(['name'], "Store name can't be blank");
  if (input.email !== undefined && !EMAIL_RE.test(input.email ?? '')) return errR(['email'], 'Email is invalid');
  if (input.timezone && !validTimezone(input.timezone)) return errR(['timezone'], 'Time zone is invalid');
  if (input.weightUnit && !(WEIGHT_UNITS as readonly string[]).includes(input.weightUnit)) return errR(['weightUnit'], 'Weight unit is invalid');
  if (input.primaryDomain && !HOST_RE.test(input.primaryDomain)) return errR(['primaryDomain'], 'Domain is invalid');
  if (input.address?.countryCode && !/^[A-Za-z]{2}$/.test(input.address.countryCode)) return errR(['address', 'countryCode'], 'Country code is invalid');

  const currency = input.currency?.toUpperCase();
  if (currency && currency !== cur.currency) {
    if (!Intl.supportedValuesOf('currency').includes(currency)) return errR(['currency'], 'Currency is invalid');
    const [o] = await db.select({ n: sql<number>`count(*)::int` }).from(orders).where(eq(orders.shopId, shopId));
    if ((o?.n ?? 0) > 0) return errR(['currency'], 'The store currency cannot be changed once orders exist');
  }
  const settings: Record<string, unknown> = { ...cur.settings };
  if (input.description !== undefined) settings.description = input.description ?? '';
  if (input.taxShipping != null) settings.taxShipping = input.taxShipping;
  if (input.address) {
    const country = input.address.countryCode?.toUpperCase();
    settings.address = { ...((cur.settings.address as object | undefined) ?? {}), ...input.address, ...(country && { countryCode: country }) };
  }
  const pwEnabled = input.storefrontPasswordEnabled ?? cur.settings.storefrontPasswordEnabled === true;
  const pw = input.storefrontPassword ?? (typeof cur.settings.storefrontPassword === 'string' ? cur.settings.storefrontPassword : '');
  if (pwEnabled && !pw) return errR(['storefrontPassword'], 'A password is required to enable the storefront password');
  if (input.storefrontPasswordEnabled != null) settings.storefrontPasswordEnabled = input.storefrontPasswordEnabled;
  if (input.storefrontPassword != null) settings.storefrontPassword = input.storefrontPassword;
  if (input.storefrontPasswordMessage != null) settings.passwordMessage = input.storefrontPasswordMessage;
  if (input.b2bOnly != null) settings.b2bOnly = input.b2bOnly;
  if (input.homepageTitle != null) {
    if (input.homepageTitle.length > 70) return errR(['homepageTitle'], 'Home page title is too long (maximum is 70 characters)');
    settings.homepageTitle = input.homepageTitle.trim();
  }
  if (input.socialSharingImage != null) {
    const u = input.socialSharingImage.trim();
    if (u && !/^(https?:\/\/|\/)/i.test(u)) return errR(['socialSharingImage'], 'Social sharing image must be a URL');
    settings.socialSharingImage = u;
  }

  const formats = currency && currency !== cur.currency ? defaultMoneyFormats(currency, input.locale ?? cur.locale) : null;
  const [row] = await db.update(shops).set({
    ...(input.name && { name: input.name.trim() }), ...(input.email && { email: input.email.trim().toLowerCase() }),
    ...(currency && { currency }), ...(input.timezone && { timezone: input.timezone }), ...(input.weightUnit && { weightUnit: input.weightUnit }), ...(input.locale && { locale: input.locale }),
    ...(input.address?.countryCode && { country: input.address.countryCode.toUpperCase() }),
    ...(formats ?? {}), ...(input.moneyFormat && { moneyFormat: input.moneyFormat }), ...(input.moneyWithCurrencyFormat && { moneyWithCurrencyFormat: input.moneyWithCurrencyFormat }),
    ...(input.taxesIncluded != null && { taxesIncluded: input.taxesIncluded }),
    ...(input.primaryDomain !== undefined && { primaryDomain: input.primaryDomain?.toLowerCase() || null }),
    settings, updatedAt: new Date(),
  }).where(eq(shops.id, shopId)).returning();
  await addEvent(db, shopId, { subjectType: 'shop', subjectId: shopId, verb: 'shop.updated', message: 'Store settings were updated', authorStaffUserId: staffId });
  return okR(row!);
}

export interface PaymentSettingsInput { bankTransfer?: { enabled?: boolean | null; instructions?: string | null } | null; cod?: { enabled?: boolean | null } | null; stripe?: { enabled?: boolean | null } | null }

export async function updatePaymentSettings(db: Db, shopId: number, input: PaymentSettingsInput, stripeConfigured: boolean): Promise<Result<PaymentSettings>> {
  const [cur] = await db.select().from(shops).where(eq(shops.id, shopId));
  if (!cur) return errR(null, 'Shop not found');
  const p = paymentSettingsOf(cur);
  if (input.bankTransfer?.enabled != null) p.manual.bankTransfer.enabled = input.bankTransfer.enabled;
  if (input.bankTransfer?.instructions != null) p.manual.bankTransfer.instructions = input.bankTransfer.instructions;
  if (input.cod?.enabled != null) p.manual.cod.enabled = input.cod.enabled;
  if (input.stripe?.enabled != null) p.stripe.enabled = input.stripe.enabled;
  if (p.stripe.enabled && !stripeConfigured) return errR(['stripe', 'enabled'], 'Stripe is not configured: set STRIPE_SECRET_KEY and STRIPE_PUBLISHABLE_KEY on the server');
  if (p.manual.bankTransfer.enabled && !p.manual.bankTransfer.instructions.trim()) return errR(['bankTransfer', 'instructions'], 'Payment instructions are required for bank transfer');
  await db.update(shops).set({ settings: { ...cur.settings, payments: p }, updatedAt: new Date() }).where(eq(shops.id, shopId));
  return okR(p);
}
