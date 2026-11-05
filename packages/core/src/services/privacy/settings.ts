import { and, asc, eq } from 'drizzle-orm';
import { consentPolicies, shops } from '../../db/schema';
import type { Db, Executor } from '../../db/client';
import { errR, okR, type Result } from '../catalog/common';
import type { Shop } from '../shops';
import { builtinPolicy, type RegionPolicy } from './regions';

/** Customer privacy settings (Settings > Customer privacy), stored in `shops.settings.privacy`. */
export type PrivacyMode = 'AUTO' | 'MANUAL';
export type BannerMode = 'AUTO' | 'ALWAYS' | 'OFF';
export const BANNER_POSITIONS = ['bottom', 'left', 'right'] as const;
export type BannerPosition = (typeof BANNER_POSITIONS)[number];

export interface PrivacySettings {
  /** AUTO: the built-in region table decides; MANUAL: the merchant's `consent_policies` rows. */
  mode: PrivacyMode;
  cookieBanner: { mode: BannerMode; message: string; position: BannerPosition };
  dataSaleOptOutPage: 'AUTO' | 'OFF';
  /** Ask newcomers to confirm by email before the subscription counts. */
  doubleOptIn: boolean;
}

export const DEFAULT_BANNER_MESSAGE = 'We use cookies to improve your experience.';

export function privacySettingsOf(shop: Pick<Shop, 'settings'>): PrivacySettings {
  const st = shop.settings as Record<string, any>;
  const p = (st.privacy ?? {}) as Record<string, any>;
  const legacy = (st.cookieBanner ?? {}) as { enabled?: boolean; message?: string };
  const bannerMode: BannerMode = ['AUTO', 'ALWAYS', 'OFF'].includes(p.cookieBanner?.mode) ? p.cookieBanner.mode : legacy.enabled ? 'ALWAYS' : 'AUTO';
  return {
    mode: p.mode === 'MANUAL' ? 'MANUAL' : 'AUTO',
    cookieBanner: {
      mode: bannerMode, message: typeof p.cookieBanner?.message === 'string' && p.cookieBanner.message.trim() ? p.cookieBanner.message : typeof legacy.message === 'string' && legacy.message.trim() ? legacy.message : DEFAULT_BANNER_MESSAGE,
      position: (BANNER_POSITIONS as readonly unknown[]).includes(p.cookieBanner?.position) ? p.cookieBanner.position : 'bottom',
    },
    dataSaleOptOutPage: p.dataSaleOptOutPage === 'OFF' ? 'OFF' : 'AUTO', doubleOptIn: p.doubleOptIn === true,
  };
}

export interface PrivacySettingsInput {
  mode?: PrivacyMode | null;
  cookieBanner?: { mode?: BannerMode | null; message?: string | null; position?: BannerPosition | null } | null;
  dataSaleOptOutPage?: 'AUTO' | 'OFF' | null;
  doubleOptIn?: boolean | null;
}

export async function updatePrivacySettings(db: Executor, shop: Shop, input: PrivacySettingsInput): Promise<Result<PrivacySettings>> {
  const cur = privacySettingsOf(shop);
  if (input.mode != null && !['AUTO', 'MANUAL'].includes(input.mode)) return errR(['mode'], 'Mode is invalid', 'INVALID');
  if (input.cookieBanner?.mode != null && !['AUTO', 'ALWAYS', 'OFF'].includes(input.cookieBanner.mode)) return errR(['cookieBanner', 'mode'], 'Banner mode is invalid', 'INVALID');
  if (input.cookieBanner?.position != null && !(BANNER_POSITIONS as readonly string[]).includes(input.cookieBanner.position)) return errR(['cookieBanner', 'position'], 'Banner position is invalid', 'INVALID');
  if (input.cookieBanner?.message != null && input.cookieBanner.message.length > 1000) return errR(['cookieBanner', 'message'], 'The banner message is too long', 'TOO_LONG');
  const next: PrivacySettings = {
    mode: input.mode ?? cur.mode,
    cookieBanner: {
      mode: input.cookieBanner?.mode ?? cur.cookieBanner.mode,
      message: input.cookieBanner?.message != null ? input.cookieBanner.message.trim() || DEFAULT_BANNER_MESSAGE : cur.cookieBanner.message,
      position: input.cookieBanner?.position ?? cur.cookieBanner.position,
    },
    dataSaleOptOutPage: input.dataSaleOptOutPage ?? cur.dataSaleOptOutPage, doubleOptIn: input.doubleOptIn ?? cur.doubleOptIn,
  };
  const legacy = { ...((shop.settings as Record<string, any>).cookieBanner ?? {}), enabled: next.cookieBanner.mode === 'ALWAYS', message: next.cookieBanner.message };
  await db.update(shops).set({ settings: { ...shop.settings, privacy: next, cookieBanner: legacy }, updatedAt: new Date() }).where(eq(shops.id, shop.id));
  return okR(next);
}

// --- manual consent policies ------------------------------------------------------------------------------------------

export type ConsentPolicyRow = typeof consentPolicies.$inferSelect;
export const listConsentPolicies = (db: Executor, shopId: number): Promise<ConsentPolicyRow[]> =>
  db.select().from(consentPolicies).where(eq(consentPolicies.shopId, shopId)).orderBy(asc(consentPolicies.id));

export interface ConsentPolicyInput { countryCode?: string | null; regionCode?: string | null; consentRequired: boolean; dataSaleOptOutRequired: boolean }

/** Replace-or-add rules (one per country and region). Switches the shop to MANUAL mode: the merchant's rules now decide. */
export async function upsertConsentPolicies(db: Db, shop: Shop, inputs: ConsentPolicyInput[], opts: { replace?: boolean } = {}): Promise<Result<ConsentPolicyRow[]>> {
  const clean: ConsentPolicyInput[] = [];
  for (const [i, p] of inputs.entries()) {
    const country = p.countryCode?.trim().toUpperCase() || null;
    const region = p.regionCode?.trim().toUpperCase() || null;
    if (region && !country) return errR(['consentPolicies', String(i), 'countryCode'], 'A country code is required when a region code is given', 'COUNTRY_CODE_REQUIRED');
    if (country && !/^[A-Z]{2}$/.test(country)) return errR(['consentPolicies', String(i), 'countryCode'], 'Country code is invalid', 'UNSUPORTED_CONSENT_POLICY');
    if (region && !/^[A-Z0-9]{1,3}$/.test(region)) return errR(['consentPolicies', String(i), 'regionCode'], 'Region code is invalid', 'REGION_CODE_MUST_MATCH_COUNTRY_CODE');
    clean.push({ countryCode: country, regionCode: region, consentRequired: !!p.consentRequired, dataSaleOptOutRequired: !!p.dataSaleOptOutRequired });
  }
  const out: ConsentPolicyRow[] = [];
  await db.transaction(async (tx) => {
    if (opts.replace) await tx.delete(consentPolicies).where(eq(consentPolicies.shopId, shop.id));
    for (const p of clean) {
      const [existing] = (await tx.select().from(consentPolicies).where(eq(consentPolicies.shopId, shop.id)))
        .filter((r) => (r.countryCode ?? null) === p.countryCode && (r.regionCode ?? null) === p.regionCode);
      if (existing) out.push((await tx.update(consentPolicies).set({ consentRequired: p.consentRequired, dataSaleOptOutRequired: p.dataSaleOptOutRequired }).where(eq(consentPolicies.id, existing.id)).returning())[0]!);
      else out.push((await tx.insert(consentPolicies).values({ shopId: shop.id, ...p }).returning())[0]!);
    }
    await tx.update(shops).set({ settings: { ...shop.settings, privacy: { ...privacySettingsOf(shop), mode: 'MANUAL' } }, updatedAt: new Date() }).where(eq(shops.id, shop.id));
  });
  return okR(out);
}

export async function deleteConsentPolicy(db: Executor, shopId: number, id: number): Promise<boolean> {
  const r = await db.delete(consentPolicies).where(and(eq(consentPolicies.shopId, shopId), eq(consentPolicies.id, id))).returning({ id: consentPolicies.id });
  return r.length > 0;
}

/**
 * Policy of a visitor region. AUTO uses the built-in table. MANUAL uses the merchant's rows: country and region first, then the country,
 * then the default row (no country), else "not required".
 */
export function policyFor(settings: PrivacySettings, rows: Pick<ConsentPolicyRow, 'countryCode' | 'regionCode' | 'consentRequired' | 'dataSaleOptOutRequired'>[], country: string | null | undefined, region?: string | null): RegionPolicy {
  if (settings.mode === 'AUTO') return builtinPolicy(country, region);
  const c = (country ?? '').toUpperCase(); const r = (region ?? '').toUpperCase();
  const hit = (rows.find((p) => c && r && p.countryCode === c && p.regionCode === r) ?? rows.find((p) => c && p.countryCode === c && !p.regionCode) ?? rows.find((p) => !p.countryCode));
  return hit
    ? { consentRequired: hit.consentRequired, dataSaleOptOutRequired: hit.dataSaleOptOutRequired, level: hit.consentRequired ? 'OPT_IN' : 'NONE', source: 'manual' }
    : { consentRequired: false, dataSaleOptOutRequired: false, level: 'NONE', source: 'default' };
}
