/** The amounts of an order as the buyer saw them: presentment money when the buyer paid in another currency, shop money otherwise. */
import type * as s from '../../db/schema';
import { convertMinor } from './money';

type OrderRow = typeof s.orders.$inferSelect;
type LineRow = typeof s.orderLines.$inferSelect;

export interface OrderMoney { currency: string; subtotal: number; shipping: number; tax: number; discounts: number; tip: number; total: number; refunded: number; converted: boolean }

export const isPresentmentOrder = (o: Pick<OrderRow, 'currency' | 'presentmentCurrency' | 'presentmentMoney'>): boolean => !!o.presentmentMoney && o.presentmentCurrency !== o.currency;

/** Presentment amount of a shop amount of the order (proportional share of the paid total, so a full amount maps to exactly what was paid). */
export function presentmentShare(o: Pick<OrderRow, 'total' | 'currency' | 'presentmentCurrency' | 'presentmentMoney' | 'currencyRate'>, shopAmount: number): number {
  if (!o.presentmentMoney || o.presentmentCurrency === o.currency) return shopAmount;
  if (o.total > 0) return Math.round((shopAmount * o.presentmentMoney.total) / o.total);
  return convertMinor(shopAmount, o.currency, o.presentmentCurrency, o.currencyRate);
}

export function orderMoney(o: OrderRow): OrderMoney {
  const pm = o.presentmentMoney;
  if (!pm || o.presentmentCurrency === o.currency) {
    return { currency: o.currency, subtotal: o.subtotal, shipping: o.totalShipping, tax: o.totalTax, discounts: o.totalDiscounts, tip: o.totalTip, total: o.total, refunded: o.totalRefunded, converted: false };
  }
  return { currency: o.presentmentCurrency, subtotal: pm.subtotal, shipping: pm.shipping, tax: pm.tax, discounts: pm.discounts, tip: pm.tip, total: pm.total, refunded: presentmentShare(o, o.totalRefunded), converted: true };
}

export function lineMoney(o: Pick<OrderRow, 'currency' | 'presentmentCurrency'>, l: LineRow): { unitPrice: number; discountedTotal: number; totalTax: number } {
  if (l.presentmentUnitPrice == null || o.presentmentCurrency === o.currency) return { unitPrice: l.unitPrice, discountedTotal: l.discountedTotal, totalTax: l.totalTax };
  return { unitPrice: l.presentmentUnitPrice, discountedTotal: l.presentmentDiscountedTotal ?? l.discountedTotal, totalTax: l.presentmentTotalTax ?? l.totalTax };
}
