import { lt } from 'drizzle-orm';
import type { Executor } from '../../db/client';
import { visits } from '../../db/schema';

export const VISIT_SESSION_MS = 30 * 60 * 1000;
export const VISIT_RETENTION_DAYS = 400;

/** Record one storefront page view. `sessionId` is the anonymous id of the visit cookie; nothing personal is stored. */
export async function recordVisit(db: Executor, shopId: number, input: { sessionId: string; path: string; referrer?: string | null; utmSource?: string | null; utmMedium?: string | null; utmCampaign?: string | null }): Promise<void> {
  await db.insert(visits).values({ shopId, sessionId: input.sessionId.slice(0, 64), path: input.path.slice(0, 500), referrer: input.referrer ? input.referrer.slice(0, 500) : null, utmSource: input.utmSource?.slice(0, 100) || null, utmMedium: input.utmMedium?.slice(0, 100) || null, utmCampaign: input.utmCampaign?.slice(0, 150) || null });
}

export const purgeOldVisits = (db: Executor) => db.delete(visits).where(lt(visits.createdAt, new Date(Date.now() - VISIT_RETENTION_DAYS * 86400_000)));
