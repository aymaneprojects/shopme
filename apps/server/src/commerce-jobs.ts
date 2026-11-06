import {
  autoFulfillGiftCardLines, dueGiftCardNotifications, getShop, giftCardAddressees, giftCardMailVars, issueGiftCardsForOrder, markGiftCardNotified, onEvent, recoverAbandonedCheckouts, schema, sendNotification,
  type Shop,
} from '@shopme/core';
import { eq } from 'drizzle-orm';
import type { AppContext } from './context';
import { EVENT_SETTLE_MS } from './ops';

/**
 * Wave 7a background work: gift cards issued when an order is paid (and their emails), and the abandoned checkout recovery sweep.
 * Returns the unsubscribe function of the event listener.
 */
export function registerCommerceJobs(ctx: AppContext): () => void {
  const { db, queue } = ctx;

  /** Email every card that is due (bought online, or issued with a recipient), once. */
  async function sendGiftCardEmails(shop: Shop): Promise<void> {
    for (const card of await dueGiftCardNotifications(db, shop.id)) {
      const { to, from } = await giftCardAddressees(db, card);
      const base = ctx.stores.storefrontBase(shop.id);
      if (to) await sendNotification(db, ctx.mailer, shop, base, 'gift_card_issued', to, giftCardMailVars(shop, base, card, from));
      await markGiftCardNotified(db, card.id);
    }
  }

  queue.register<{ shopId: number; orderId: number }>('giftcards.issue', async ({ shopId, orderId }) => {
    const shop = await getShop(db, shopId);
    if (!shop) return;
    await issueGiftCardsForOrder(db, shopId, orderId);
    await autoFulfillGiftCardLines(db, shopId, orderId);
    await sendGiftCardEmails(shop);
  });
  // Every store that is not suspended (multi-store), each with its own links and sender.
  const activeShops = async () => (await db.select().from(schema.shops).where(eq(schema.shops.status, 'ACTIVE')).orderBy(schema.shops.id)) as Shop[];
  queue.every('gift-card-notifications', 60_000, async () => {
    for (const shop of await activeShops()) await sendGiftCardEmails(shop);
  });
  queue.every('abandoned-checkout-recovery', 10 * 60_000, async () => {
    for (const shop of await activeShops()) await recoverAbandonedCheckouts(db, ctx.mailer, shop, ctx.stores.storefrontBase(shop.id));
  });

  return onEvent((shopId, ev) => {
    if (ev.verb === 'order.paid' && ev.subjectId != null) queue.enqueue('giftcards.issue', { shopId, orderId: ev.subjectId }, { delayMs: EVENT_SETTLE_MS, maxAttempts: 5 });
  });
}
