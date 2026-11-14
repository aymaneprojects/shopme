import { and, eq } from 'drizzle-orm';
import { orders } from '../../db/schema';
import type { Db, Executor } from '../../db/client';
import { errR, okR, type Result } from '../catalog/common';
import { addEvent } from '../events';
import { cancelOrder } from '../orders/refunds';
import { paidAmounts, type Order, type OrderDetail } from '../orders/orders';
import type { GatewayResolver } from '../orders/gateways';
import { createReturn, returnableQuantities, type ReturnWithLines } from '../returns';
import { customerAccountsSettingsOf } from './settings';
import type { Shop } from '../shops';

/** What a signed-in customer may do with one of their orders (Settings > Customer accounts > Order actions). */
export interface OrderActions {
  reorder: boolean;
  /** Cancel an unfulfilled order within the configured number of hours. */
  cancel: boolean;
  /** Ask to return fulfilled items. */
  returns: boolean;
  /** End of the cancellation window (for the label "cancel until ..."). */
  cancelUntil: Date | null;
}

export function cancellationDeadline(order: Pick<Order, 'processedAt'>, hours: number): Date {
  return new Date(order.processedAt.getTime() + hours * 3600_000);
}

const fulfilledAnything = (d: Pick<OrderDetail, 'lines'>) => d.lines.some((l) => l.fulfilledQuantity > 0);

export async function orderActionsFor(db: Executor, shop: Pick<Shop, 'settings' | 'id'>, order: Order, detail: OrderDetail, now = new Date()): Promise<OrderActions> {
  const s = customerAccountsSettingsOf(shop);
  const open = !order.cancelledAt && order.financialStatus !== 'VOIDED';
  const until = cancellationDeadline(order, s.orderActions.cancellationWindowHours);
  const cancel = s.orderActions.cancellations && open && order.fulfillmentStatus === 'UNFULFILLED' && !fulfilledAnything(detail) && now.getTime() <= until.getTime();
  let returns = false;
  if (s.orderActions.returns && open && fulfilledAnything(detail)) returns = [...(await returnableQuantities(db, shop.id, order.id)).values()].some((n) => n > 0);
  return { reorder: s.orderActions.reorder && detail.lines.some((l) => l.variantId != null), cancel, returns, cancelUntil: s.orderActions.cancellations ? until : null };
}

/** The customer cancels their own order. Stock goes back and anything paid is refunded (recorded; the money movement is the payment provider's). */
export async function customerCancelOrder(db: Db, shop: Shop, customerId: number, orderId: number, detail: OrderDetail, now = new Date(), gateways?: GatewayResolver): Promise<Result<Order>> {
  const [order] = await db.select().from(orders).where(and(eq(orders.shopId, shop.id), eq(orders.id, orderId), eq(orders.customerId, customerId))).limit(1);
  if (!order) return errR(['orderId'], 'Order does not exist', 'NOT_FOUND');
  const a = await orderActionsFor(db, shop, order, detail, now);
  if (!a.cancel) return errR(['orderId'], 'This order can no longer be cancelled', 'INVALID');
  const { received, refunded } = paidAmounts(detail.transactions);
  const r = await cancelOrder(db, shop.id, orderId, { reason: 'CUSTOMER', restock: true, refund: received - refunded > 0, staffNote: 'Cancelled by the customer from their account', gateways });
  if (r.ok) await addEvent(db, shop.id, { subjectType: 'customer', subjectId: customerId, verb: 'customer.order_cancelled', message: `Cancelled order ${order.name} from their account`, data: { orderId } });
  return r;
}

/** The customer asks to return fulfilled items; staff approve the request in the admin. */
export async function customerRequestReturn(
  db: Db, shop: Shop, customerId: number, orderId: number, detail: OrderDetail, lines: { orderLineId: number; quantity: number; reason?: string | null }[], note?: string | null,
): Promise<Result<ReturnWithLines>> {
  const [order] = await db.select().from(orders).where(and(eq(orders.shopId, shop.id), eq(orders.id, orderId), eq(orders.customerId, customerId))).limit(1);
  if (!order) return errR(['orderId'], 'Order does not exist', 'NOT_FOUND');
  const a = await orderActionsFor(db, shop, order, detail);
  if (!a.returns) return errR(['orderId'], 'Returns are not available for this order', 'INVALID');
  const r = await createReturn(db, shop.id, orderId, lines.map((l) => ({ ...l, restock: true })), { requested: true, note: note?.slice(0, 1000) ?? null });
  return r.ok ? okR(r.value) : r;
}
