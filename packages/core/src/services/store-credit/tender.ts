import type { Db, Executor } from '../../db/client';
import { checkoutMeta } from '../../db/schema';
import type { Shop } from '../shops';
import { convertMinor, unconvertMinor } from '../markets/money';
import { debitStoreCredit, findStoreCreditAccount, liveBalance, storeCreditEnabled } from './index';

/**
 * Store credit as a checkout payment method ("tender"). The checkout asks `planStoreCredit` what the signed-in buyer can spend (after gift
 * cards) and `payWithStoreCredit` debits it inside the order transaction. Everything credit-specific about checkout lives here.
 */
export interface StoreCreditTender {
  enabled: boolean;
  accountId: number | null;
  /** Spendable balance of the buyer, shown in the cart currency (the credit itself is kept in shop money). */
  available: number;
  /** The buyer's checkbox (checked by default). */
  use: boolean;
  /** What pays for the order, in the cart currency: the smaller of the balance and what is still due. */
  applied: number;
  /** The same payment in shop money: what is debited from the account (equal to `applied` when the cart is in the shop currency). */
  appliedShop: number;
}

export const NO_STORE_CREDIT: StoreCreditTender = { enabled: false, accountId: null, available: 0, use: false, applied: 0, appliedShop: 0 };

/** `payable` is what credit may still pay: the amount due after gift cards, without gift card products (they cannot be bought with credit). */
export async function planStoreCredit(db: Executor, shop: Shop, i: { customerId: number | null; currency: string; rate?: number; payable: number; use: boolean; now?: Date }): Promise<StoreCreditTender> {
  if (!storeCreditEnabled(shop) || !i.customerId) return NO_STORE_CREDIT;
  // Credit accounts are in shop money; a cart in another currency spends it at the cart's rate.
  const account = await findStoreCreditAccount(db, shop.id, i.customerId, shop.currency);
  if (!account) return { ...NO_STORE_CREDIT, enabled: true };
  const balance = await liveBalance(db, account.id, i.now);
  const presented = i.currency !== shop.currency || (i.rate ?? 1) !== 1;
  const available = presented ? convertMinor(balance, shop.currency, i.currency, i.rate ?? 1) : balance;
  const applied = i.use ? Math.max(0, Math.min(available, i.payable)) : 0;
  const appliedShop = !presented ? applied : applied >= available ? balance : Math.min(balance, unconvertMinor(applied, shop.currency, i.currency, i.rate ?? 1));
  return { enabled: true, accountId: account.id, available, use: i.use, applied, appliedShop };
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
