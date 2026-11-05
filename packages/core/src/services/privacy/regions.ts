/**
 * Built-in region table for the "automated" privacy mode. It is DATA TO REVIEW on every release, not legal advice:
 * laws change, and which rule applies to a merchant is the merchant's responsibility (see docs/dev/privacy.md).
 */
export const PRIVACY_REGIONS_REVIEWED_AT = '2026-11-05';

/** Opt-in required before analytics, marketing or preference cookies: EU, EEA, United Kingdom and Switzerland. */
export const CONSENT_REQUIRED_COUNTRIES: readonly string[] = [
  'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE', // EU
  'IS', 'LI', 'NO', // EEA
  'GB', 'CH',
];

/** Countries where a short notice is shown (tracking allowed, the visitor can still refuse). */
export const NOTICE_COUNTRIES: readonly string[] = ['CA', 'BR', 'AU', 'NZ', 'JP', 'KR', 'ZA', 'TR', 'MX', 'AR', 'IN'];

/** United States states with a "do not sell or share" opt-out requirement (keyed by state code, country US). */
export const DATA_SALE_OPT_OUT_US_STATES: readonly string[] = [
  'CA', 'CO', 'CT', 'DE', 'IA', 'IN', 'KY', 'MD', 'MN', 'MT', 'NE', 'NH', 'NJ', 'OR', 'RI', 'TN', 'TX', 'UT', 'VA',
];

export type BannerLevel = 'OPT_IN' | 'NOTICE' | 'NONE';
export interface RegionPolicy { consentRequired: boolean; dataSaleOptOutRequired: boolean; level: BannerLevel; source: 'builtin' | 'manual' | 'default' }

/** Policy for a visitor region from the built-in table. Without a known country the default is "not required". */
export function builtinPolicy(country: string | null | undefined, region?: string | null): RegionPolicy {
  const c = (country ?? '').toUpperCase();
  const r = (region ?? '').toUpperCase();
  if (CONSENT_REQUIRED_COUNTRIES.includes(c)) return { consentRequired: true, dataSaleOptOutRequired: false, level: 'OPT_IN', source: 'builtin' };
  // The listed states require an opt-out; a US visitor whose state is unknown gets it too (better safe than sorry).
  const sale = c === 'US' && (!r || DATA_SALE_OPT_OUT_US_STATES.includes(r));
  if (NOTICE_COUNTRIES.includes(c)) return { consentRequired: false, dataSaleOptOutRequired: false, level: 'NOTICE', source: 'builtin' };
  return { consentRequired: false, dataSaleOptOutRequired: sale, level: 'NONE', source: sale ? 'builtin' : 'default' };
}

/** Regions the built-in table lists, for the admin summary ("active in California, Colorado and 17 other states"). */
export const builtinRegions = () => ({
  consentRequired: [...CONSENT_REQUIRED_COUNTRIES], notice: [...NOTICE_COUNTRIES], dataSaleOptOutUsStates: [...DATA_SALE_OPT_OUT_US_STATES], reviewedAt: PRIVACY_REGIONS_REVIEWED_AT,
});
