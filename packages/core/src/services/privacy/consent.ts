import type { RegionPolicy } from './regions';
import type { BannerMode } from './settings';

/** First-party cookie holding the visitor's choice. Bump the version to ask everybody again (e.g. when categories change). */
export const CONSENT_COOKIE = '_shopme_consent';
export const CONSENT_VERSION = 1;
export const CONSENT_COOKIE_MAX_AGE = 365 * 24 * 3600;

export type Choice = 'yes' | 'no' | '';
export const CONSENT_CATEGORIES = ['analytics', 'marketing', 'preferences'] as const;
export type ConsentCategory = (typeof CONSENT_CATEGORIES)[number];

export interface ConsentCookie { v: number; analytics: Choice; marketing: Choice; preferences: Choice; saleOfData: Choice; region?: string; ts: number }

const choice = (v: unknown): Choice => (v === 'yes' || v === 'no' ? v : '');

export const encodeConsentCookie = (c: ConsentCookie): string => encodeURIComponent(JSON.stringify(c));

/** Parse the cookie; anything malformed or from another version is "no choice yet". */
export function decodeConsentCookie(raw: string | null | undefined): ConsentCookie | null {
  if (!raw) return null;
  try {
    let text = raw;
    if (!raw.trimStart().startsWith('{')) text = decodeURIComponent(raw);
    const o = JSON.parse(text) as Record<string, unknown>;
    if (!o || typeof o !== 'object' || o.v !== CONSENT_VERSION) return null;
    return { v: CONSENT_VERSION, analytics: choice(o.analytics), marketing: choice(o.marketing), preferences: choice(o.preferences), saleOfData: choice(o.saleOfData), region: typeof o.region === 'string' ? o.region.slice(0, 8) : undefined, ts: Number.isFinite(Number(o.ts)) ? Number(o.ts) : 0 };
  } catch { return null; }
}

/** A saved customer copy (jsonb) in the cookie shape, or null. */
export const consentFromCustomer = (raw: unknown): ConsentCookie | null => (raw && typeof raw === 'object' ? decodeConsentCookie(encodeURIComponent(JSON.stringify(raw))) : null);

export interface VisitorConsent {
  consentRequired: boolean;
  dataSaleOptOutRequired: boolean;
  level: RegionPolicy['level'];
  bannerMode: BannerMode;
  /** The visitor has to be asked (or told) now. */
  shouldShowBanner: boolean;
  /** What was answered: `yes`, `no` or `''` (not asked yet). */
  analytics: Choice; marketing: Choice; preferences: Choice; saleOfData: Choice;
  /** What may run now. In a region without a consent requirement everything is allowed until the visitor says no. */
  allowed: { analytics: boolean; marketing: boolean; preferences: boolean; saleOfData: boolean };
  region: { country: string | null; region: string | null };
  source: RegionPolicy['source'];
}

export interface ConsentInput {
  bannerMode: BannerMode;
  policy: RegionPolicy;
  cookie: ConsentCookie | null;
  /** Saved copy on the signed-in customer: wins over the cookie when it is newer. */
  customerConsent?: ConsentCookie | null;
  customerOptOut?: boolean;
  /** `Sec-GPC: 1` request header. */
  gpc?: boolean;
  country?: string | null; region?: string | null;
}

export function resolveVisitorConsent(i: ConsentInput): VisitorConsent {
  const saved = i.customerConsent && (!i.cookie || i.customerConsent.ts > i.cookie.ts) ? i.customerConsent : i.cookie;
  const off = i.bannerMode === 'OFF';
  // A banner the merchant forces on (ALWAYS) works as opt-in everywhere: nothing runs before the visitor answers.
  const required = (i.policy.consentRequired || i.bannerMode === 'ALWAYS') && !off;
  const answered = CONSENT_CATEGORIES.every((k) => saved?.[k] === 'yes' || saved?.[k] === 'no');
  const value = (k: ConsentCategory): Choice => saved?.[k] ?? '';
  const allowedOf = (k: ConsentCategory) => (required ? value(k) === 'yes' : value(k) !== 'no');
  const gpcOptOut = !!i.gpc && i.policy.dataSaleOptOutRequired;
  const saleOut = saved?.saleOfData === 'no' || gpcOptOut || !!i.customerOptOut;
  const collected = !!saved && (required ? answered : true);
  const shouldShow = off ? false : i.bannerMode === 'ALWAYS' ? !collected : (i.policy.consentRequired || i.policy.level === 'NOTICE') && !collected;
  return {
    consentRequired: i.policy.consentRequired, dataSaleOptOutRequired: i.policy.dataSaleOptOutRequired, level: i.policy.level, bannerMode: i.bannerMode, shouldShowBanner: shouldShow,
    analytics: value('analytics'), marketing: value('marketing'), preferences: value('preferences'), saleOfData: saleOut ? 'no' : saved?.saleOfData ?? '',
    allowed: { analytics: allowedOf('analytics'), marketing: allowedOf('marketing'), preferences: allowedOf('preferences'), saleOfData: !saleOut },
    region: { country: i.country ?? null, region: i.region ?? null }, source: i.policy.source,
  };
}

/** Cookie value after the visitor answers: unknown categories keep the previous answer. */
export function consentAnswer(prev: ConsentCookie | null, a: Partial<Record<ConsentCategory | 'saleOfData', Choice | boolean | undefined>>, region?: string, now = Date.now()): ConsentCookie {
  const pick = (k: ConsentCategory | 'saleOfData'): Choice => (typeof a[k] === 'boolean' ? (a[k] ? 'yes' : 'no') : a[k] === 'yes' || a[k] === 'no' ? (a[k] as Choice) : prev?.[k] ?? '');
  return { v: CONSENT_VERSION, analytics: pick('analytics'), marketing: pick('marketing'), preferences: pick('preferences'), saleOfData: pick('saleOfData'), region: region ?? prev?.region, ts: now };
}

/** May a pixel with these requirements run? Empty requirements run for everyone (the admin warns about it). */
export function pixelMayRun(p: { requiredConsent: readonly string[]; respectSaleOptOut: boolean }, c: Pick<VisitorConsent, 'allowed'>): boolean {
  if (!p.requiredConsent.every((k) => c.allowed[k as ConsentCategory] === true)) return false;
  return !(p.respectSaleOptOut && !c.allowed.saleOfData);
}
