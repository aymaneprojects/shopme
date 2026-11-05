import {
  dueGiftCardNotifications, getShop, giftCardAddressees, giftCardMailVars, issueGiftCardsForOrder, markGiftCardNotified, onEvent, recoverAbandonedCheckouts, schema, sendNotification,
  type Shop,
} from '@shopme/core';
import type { AppContext } from './context';
import { EVENT_SETTLE_MS } from './ops';

/**
 * Wave 7a background work: gift cards issued when an order is paid (and their emails), and the abandoned checkout recovery sweep.
 * Returns the unsubscribe function of the event listener.
 */
export function registerCommerceJobs(ctx: AppContext): () => void {
  const { db, queue, config } = ctx;

  /** Email every card that is due (bought online, or issued with a recipient), once. */
  async function sendGiftCardEmails(shop: Shop): Promise<void> {
    for (const card of await dueGiftCardNotifications(db, shop.id)) {
      const { to, from } = await giftCardAddressees(db, card);
      if (to) await sendNotification(db, ctx.mailer, shop, config.appUrl, 'gift_card_issued', to, giftCardMailVars(shop, config.appUrl, card, from));
      await markGiftCardNotified(db, card.id);
    }
  }

  queue.register<{ shopId: number; orderId: number }>('giftcards.issue', async ({ shopId, orderId }) => {
    const shop = await getShop(db, shopId);
    if (!shop) return;
    await issueGiftCardsForOrder(db, shopId, orderId);
    await sendGiftCardEmails(shop);
  });
  queue.every('gift-card-notifications', 60_000, async () => {
    for (const row of await db.select({ id: schema.shops.id }).from(schema.shops)) { const shop = await getShop(db, row.id); if (shop) await sendGiftCardEmails(shop); }
  });
  queue.every('abandoned-checkout-recovery', 10 * 60_000, async () => {
    for (const row of await db.select({ id: schema.shops.id }).from(schema.shops)) {
      const shop = await getShop(db, row.id);
      if (shop) await recoverAbandonedCheckouts(db, ctx.mailer, shop, config.appUrl);
    }
  });

  return onEvent((shopId, ev) => {
    if (ev.verb === 'order.paid' && ev.subjectId != null) queue.enqueue('giftcards.issue', { shopId, orderId: ev.subjectId }, { delayMs: EVENT_SETTLE_MS, maxAttempts: 5 });
  });
}
