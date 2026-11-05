import type { Db, Executor } from '../../db/client';
import { checkoutMeta } from '../../db/schema';
import type { Shop } from '../shops';
import { debitStoreCredit, findStoreCreditAccount, liveBalance, storeCreditEnabled } from './index';

/**
 * Store credit as a checkout payment method ("tender"). The checkout asks `planStoreCredit` what the signed-in buyer can spend (after gift
 * cards) and `payWithStoreCredit` debits it inside the order transaction. Everything credit-specific about checkout lives here.
 */
export interface StoreCreditTender {
  enabled: boolean;
  accountId: number | null;
  /** Spendable balance of the buyer in the cart currency. */
  available: number;
  /** The buyer's checkbox (checked by default). */
  use: boolean;
  /** What pays for the order: the smaller of the balance and what is still due. */
  applied: number;
}

export const NO_STORE_CREDIT: StoreCreditTender = { enabled: false, accountId: null, available: 0, use: false, applied: 0 };

/** `payable` is what credit may still pay: the amount due after gift cards, without gift card products (they cannot be bought with credit). */
export async function planStoreCredit(db: Executor, shop: Shop, i: { customerId: number | null; currency: string; payable: number; use: boolean; now?: Date }): Promise<StoreCreditTender> {
  if (!storeCreditEnabled(shop) || !i.customerId) return NO_STORE_CREDIT;
  const account = await findStoreCreditAccount(db, shop.id, i.customerId, i.currency);
  if (!account) return { ...NO_STORE_CREDIT, enabled: true };
  const available = await liveBalance(db, account.id, i.now);
  return { enabled: true, accountId: account.id, available, use: i.use, applied: i.use ? Math.max(0, Math.min(available, i.payable)) : 0 };
}

/** Debit the credit that pays for an order. False when the balance changed meanwhile (the order must not be created). */
export async function payWithStoreCredit(tx: Db, shopId: number, i: { accountId: number; amount: number; orderId: number }): Promise<boolean> {
  const r = await debitStoreCredit(tx, shopId, { accountId: i.accountId, amount: i.amount, event: 'ORDER_PAYMENT', orderId: i.orderId });
  return r.ok;
}

/** Remember the buyer's "use store credit" checkbox on the checkout. */
export async function setUseStoreCredit(db: Executor, shopId: number, cartId: number, use: boolean): Promise<void> {
  await db.insert(checkoutMeta).values({ cartId, shopId, useStoreCredit: use }).onConflictDoUpdate({ target: checkoutMeta.cartId, set: { useStoreCredit: use } });
}
