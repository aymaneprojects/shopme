import { purgeExpiredSessions } from '@shopme/core';
import type { AppContext } from './context';

/**
 * Register background jobs on the in-process queue (ctx.queue). Feature agents add their handlers here,
 * e.g. `ctx.queue.register('webhook.deliver', ...)`. The queue interface lets this move to a worker later.
 */
export function registerJobs(ctx: AppContext): void {
  ctx.queue.every('purge-expired-sessions', 60 * 60 * 1000, async () => { await purgeExpiredSessions(ctx.db); });
}
