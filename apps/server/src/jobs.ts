import { getPrimaryShop, purgeExpiredSessions, purgeOldVisits, runScheduledBackup } from '@shopme/core';
import type { AppContext } from './context';
import { registerOpsJobs } from './ops';

/**
 * Register background jobs on the in-process queue (ctx.queue). Feature agents add their handlers here,
 * e.g. `ctx.queue.register('webhook.deliver', ...)`. The queue interface lets this move to a worker later.
 */
export function registerJobs(ctx: AppContext): () => void {
  ctx.queue.every('purge-expired-sessions', 60 * 60 * 1000, async () => { await purgeExpiredSessions(ctx.db); });
  ctx.queue.every('purge-old-visits', 24 * 3600_000, async () => { await purgeOldVisits(ctx.db); });
  // Automatic backups: checked hourly (and once shortly after start); only runs when enabled and the newest one is older than the interval.
  const backup = async () => {
    const shop = await getPrimaryShop(ctx.db);
    if (shop) await runScheduledBackup(ctx.db, ctx.storage, shop.id, ctx.config.dataDir, ctx.appVersion);
  };
  ctx.queue.register('store.auto-backup', backup);
  ctx.queue.every('auto-backup', 3600_000, backup);
  if (ctx.config.env !== 'test') ctx.queue.enqueue('store.auto-backup', {}, { delayMs: 90_000, maxAttempts: 1 });
  return registerOpsJobs(ctx);
}
