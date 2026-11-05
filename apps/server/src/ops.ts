import {
  attemptDelivery, dueDeliveries, getShop, onEvent, orderEventMail, recordOrderEmail, ORDER_EMAIL_VERBS, purgeOldDeliveries, recordDeliveries, sendNotification, shopUrl, topicsForVerb,
  type EventRow,
} from '@shopme/core';
import type { AppContext } from './context';

type EventJob = { shopId: number; verb: string | null; subjectId: number | null; data: Record<string, unknown> | null };

/** Time given to the originating transaction to commit before jobs read the resource (events are written inside it). */
export const EVENT_SETTLE_MS = 300;

/**
 * Domain events (`events` table writes) -> background work: outbound webhook deliveries and customer notification emails.
 * Returns the unsubscribe function (called when the app closes).
 */
export function registerOpsJobs(ctx: AppContext): () => void {
  const { db, queue, config } = ctx;
  const host = (url: string) => new URL(url).host;

  queue.register<EventJob>('webhook.fanout', async (e) => {
    for (const id of await recordDeliveries(db, e.shopId, e)) queue.enqueue('webhook.deliver', { shopId: e.shopId, id });
  });
  queue.register<{ shopId: number; id: number }>('webhook.deliver', async ({ shopId, id }) => {
    const shop = await getShop(db, shopId);
    if (!shop) return;
    const delay = await attemptDelivery(db, shop, id, { shopDomain: host(shopUrl(shop, config.appUrl)) });
    if (delay != null) queue.enqueue('webhook.deliver', { shopId, id }, { delayMs: delay });
  });
  queue.register<EventJob>('notify.order-event', async (e) => {
    const shop = await getShop(db, e.shopId);
    if (!shop || e.subjectId == null || !e.verb) return;
    const mail = await orderEventMail(db, shop, e.verb, e.subjectId, e.data);
    if (mail) { await sendNotification(db, ctx.mailer, shop, config.appUrl, mail.key, mail.to, mail.vars); await recordOrderEmail(db, e.shopId, e.subjectId, mail.key, mail.to); }
  });
  queue.every('webhook-sweep', 30_000, async () => {
    for (const d of await dueDeliveries(db)) queue.enqueue('webhook.deliver', { shopId: d.shopId, id: d.id });
  });
  queue.every('webhook-purge', 6 * 3600_000, async () => { await purgeOldDeliveries(db); });

  return onEvent((shopId: number, ev: EventRow) => {
    const job: EventJob = { shopId, verb: ev.verb, subjectId: ev.subjectId, data: ev.data };
    if (topicsForVerb(ev.verb).length) queue.enqueue('webhook.fanout', job, { delayMs: EVENT_SETTLE_MS, maxAttempts: 5 });
    if (ev.verb && ev.verb in ORDER_EMAIL_VERBS && ev.data?.notify) queue.enqueue('notify.order-event', job, { delayMs: EVENT_SETTLE_MS, maxAttempts: 5 });
  });
}
