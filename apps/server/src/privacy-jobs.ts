import { expireStoreCredits, purgeLoginCodes, purgeStorefrontEvents } from '@shopme/core';
import type { AppContext } from './context';

/** Background work of store credit and customer privacy: credit expiry (every 15 minutes, idempotent) and the retention of codes and events. */
export function registerPrivacyJobs(ctx: AppContext): () => void {
  ctx.queue.every('store-credit-expiry', 15 * 60_000, async () => { await expireStoreCredits(ctx.db); });
  ctx.queue.every('purge-privacy-data', 60 * 60_000, async () => { await purgeLoginCodes(ctx.db); await purgeStorefrontEvents(ctx.db); });
  return () => {};
}
