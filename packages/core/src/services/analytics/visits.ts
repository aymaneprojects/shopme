import { and, eq, gte, lt } from 'drizzle-orm';
import type { Executor } from '../../db/client';
import { visits } from '../../db/schema';
import { countryForTimeZone } from './tz-countries';

export const VISIT_SESSION_MS = 30 * 60 * 1000;
export const VISIT_RETENTION_DAYS = 400;
export { countryForTimeZone, TZ_DATA_VERSION } from './tz-countries';

/** Record one storefront page view. `sessionId` is the anonymous id of the visit cookie; nothing personal is stored. */
export async function recordVisit(db: Executor, shopId: number, input: { sessionId: string; path: string; referrer?: string | null; utmSource?: string | null; utmMedium?: string | null; utmCampaign?: string | null }): Promise<void> {
  await db.insert(visits).values({ shopId, sessionId: input.sessionId.slice(0, 64), path: input.path.slice(0, 500), referrer: input.referrer ? input.referrer.slice(0, 500) : null, utmSource: input.utmSource?.slice(0, 100) || null, utmMedium: input.utmMedium?.slice(0, 100) || null, utmCampaign: input.utmCampaign?.slice(0, 150) || null });
}

/**
 * Coarse location of a visit: the browser's IANA time zone (sent by the storefront analytics beacon) is mapped to a country and only
 * that country code is kept, on the page views of the current session. No IP address, region or city is stored. Returns the country
 * that was stored, or null when the zone is not tied to a country.
 */
export async function setVisitCountry(db: Executor, shopId: number, sessionId: string, timeZone: unknown, now = new Date()): Promise<string | null> {
  const country = countryForTimeZone(timeZone);
  if (!country || !/^[A-Za-z0-9_-]{16,64}$/.test(sessionId)) return null;
  await db.update(visits).set({ countryCode: country })
    .where(and(eq(visits.shopId, shopId), eq(visits.sessionId, sessionId), gte(visits.createdAt, new Date(now.getTime() - VISIT_SESSION_MS))));
  return country;
}

export const purgeOldVisits = (db: Executor) => db.delete(visits).where(lt(visits.createdAt, new Date(Date.now() - VISIT_RETENTION_DAYS * 86400_000)));
