import { JobReporter, duplicateProduct, getPrimaryShop, purgeExpiredSessions, purgeOldVisits, recordBackupResult, runScheduledBackup, schema as s } from '@shopme/core';
import { eq } from 'drizzle-orm';
import type { AppContext } from './context';
import { registerCommerceJobs } from './commerce-jobs';
import { registerOpsJobs } from './ops';
import { registerBulkJobs } from './bulk/runner';
import { schema } from './admin/graphql/schema';
import { registerPrivacyJobs } from './privacy-jobs';

/**
 * Register background jobs on the in-process queue (ctx.queue). Feature agents add their handlers here,
 * e.g. `ctx.queue.register('webhook.deliver', ...)`. The queue interface lets this move to a worker later.
 */
/** Stores the background jobs work for: the store (single-store), every store that is not suspended (multi-store). */
export async function activeShopIds(ctx: AppContext): Promise<number[]> {
  if (!ctx.config.multiStore) { const shop = await getPrimaryShop(ctx.db); return shop ? [shop.id] : []; }
  return (await ctx.db.select({ id: s.shops.id }).from(s.shops).where(eq(s.shops.status, 'ACTIVE')).orderBy(s.shops.id)).map((r) => r.id);
}

export function registerJobs(ctx: AppContext): () => void {
  ctx.queue.every('purge-expired-sessions', 60 * 60 * 1000, async () => { await purgeExpiredSessions(ctx.db); });
  ctx.queue.every('purge-old-visits', 24 * 3600_000, async () => { await purgeOldVisits(ctx.db); });
  // Automatic backups: checked hourly (and once shortly after start); only runs when enabled and the newest one is older than the interval.
  // Single-store: the store; multi-store: every active store, each into its own backups folder.
  const backup = async () => {
    const ids = await activeShopIds(ctx);
    let failed: unknown = null;
    for (const id of ids) {
      try {
        const name = await runScheduledBackup(ctx.db, ctx.storageFor(id), id, ctx.stores.dataDirFor(id), ctx.appVersion);
        if (name) await recordBackupResult(ctx.db, id, { ok: true, name });
      } catch (e) {
        await recordBackupResult(ctx.db, id, { ok: false, error: e instanceof Error ? e.message.slice(0, 300) : 'Backup failed' });
        failed ??= e;
      }
    }
    if (failed) throw failed;
  };
  ctx.queue.register('store.auto-backup', backup);
  ctx.queue.every('auto-backup', 3600_000, backup);
  if (ctx.config.env !== 'test') ctx.queue.enqueue('store.auto-backup', {}, { delayMs: 90_000, maxAttempts: 1 });
  registerBulkJobs(ctx, schema);
  // `productDuplicate(synchronous: false)`: copy in the background and keep the outcome on the job row.
  ctx.queue.register<{ shopId: number; jobId: number; productId: number; newTitle: string; newStatus?: string | null; includeImages?: boolean | null; includeTranslations?: boolean | null; includeInventory?: boolean | null; includeSkus?: boolean | null; includeBarcodes?: boolean | null }>('product.duplicate', async (j) => {
    const r = await duplicateProduct(ctx.db, j.shopId, j.productId, { newTitle: j.newTitle, newStatus: j.newStatus, includeImages: j.includeImages, includeTranslations: j.includeTranslations, includeInventory: j.includeInventory, includeSkus: j.includeSkus, includeBarcodes: j.includeBarcodes });
    const rep = new JobReporter(ctx.db, j.jobId);
    rep.result.details = { productId: j.productId, newProductId: r.ok ? r.value.id : null, errors: r.ok ? [] : r.errors.map((e) => ({ ...e, field: ['productId'] })) };
    await rep.finish();
  });
  const stopOps = registerOpsJobs(ctx);
  const stopCommerce = registerCommerceJobs(ctx);
  const stopPrivacy = registerPrivacyJobs(ctx);
  return () => { stopOps(); stopCommerce(); stopPrivacy(); };
}
