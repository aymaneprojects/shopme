import { and, asc, eq, gt, inArray } from 'drizzle-orm';
import { customers, draftOrders, orders } from '../../db/schema';
import { draftSearch } from '../draft-orders';
import type { Db } from '../../db/client';
import { getOrderDetail, orderSearch } from '../orders/orders';
import { csvLine } from '../csv';
import { decimal } from './common';

export const ORDER_COLUMNS = [
  'Name', 'Email', 'Financial Status', 'Paid at', 'Fulfillment Status', 'Accepts Marketing', 'Currency', 'Subtotal', 'Shipping', 'Taxes', 'Total', 'Discount Code', 'Discount Amount',
  'Shipping Method', 'Created at', 'Lineitem quantity', 'Lineitem name', 'Lineitem price', 'Lineitem sku', 'Lineitem requires shipping', 'Lineitem fulfillment status',
  'Billing Name', 'Billing Address1', 'Billing City', 'Billing Zip', 'Billing Province', 'Billing Country', 'Billing Phone',
  'Shipping Name', 'Shipping Address1', 'Shipping City', 'Shipping Zip', 'Shipping Province', 'Shipping Country', 'Shipping Phone', 'Notes', 'Cancelled at', 'Tags', 'Id',
];

export interface OrderExportFilter {
  /** Same search syntax as the orders list. */
  query?: string | null;
  /** Restrict to these order ids (the rows selected in the list). */
  ids?: number[] | null;
}

/** Order export (read-only): one row per line item, order-level columns only on the first row of each order. */
export async function* exportOrders(db: Db, shopId: number, filter: OrderExportFilter = {}): AsyncGenerator<string> {
  yield csvLine(ORDER_COLUMNS);
  let after = 0;
  for (;;) {
    const batch = await db.select({ o: orders, marketing: customers.acceptsMarketing }).from(orders).leftJoin(customers, eq(customers.id, orders.customerId))
      .where(and(eq(orders.shopId, shopId), gt(orders.id, after), orderSearch(filter.query), filter.ids ? inArray(orders.id, filter.ids.length ? filter.ids : [0]) : undefined)).orderBy(asc(orders.id)).limit(100);
    if (!batch.length) return;
    after = batch.at(-1)!.o.id;
    for (const { o, marketing } of batch) {
      const d = await getOrderDetail(db, shopId, o.id);
      const money = (n: number) => decimal(n, o.currency);
      const addr = (a: typeof d.billingAddress) => [[a?.firstName, a?.lastName].filter(Boolean).join(' '), a?.address1 ?? '', a?.city ?? '', a?.zip ?? '', a?.provinceCode ?? '', a?.countryCode ?? '', a?.phone ?? ''];
      const paid = d.transactions.find((t) => t.kind === 'SALE' || t.kind === 'CAPTURE');
      const discount = d.discounts[0];
      const lines = d.lines.length ? d.lines : [null];
      for (const [i, l] of lines.entries()) {
        const first = i === 0;
        yield csvLine([
          o.name, first ? o.email ?? '' : '', first ? o.financialStatus.toLowerCase() : '', first ? paid?.createdAt.toISOString() ?? '' : '', first ? o.fulfillmentStatus.toLowerCase() : '', first ? (marketing ? 'yes' : 'no') : '',
          first ? o.currency : '', first ? money(o.subtotal) : '', first ? money(o.totalShipping) : '', first ? money(o.totalTax) : '', first ? money(o.total) : '',
          first ? (discount as { code?: string | null; title?: string | null } | undefined)?.code ?? '' : '', first ? money(o.totalDiscounts) : '', first ? d.shippingLines[0]?.title ?? '' : '', first ? o.createdAt.toISOString() : '',
          l?.quantity ?? '', l ? [l.title, l.variantTitle].filter(Boolean).join(' - ') : '', l ? money(l.unitPrice) : '', l?.sku ?? '', l ? String(l.requiresShipping) : '',
          l ? (l.fulfilledQuantity >= l.quantity ? 'fulfilled' : 'pending') : '',
          ...(first ? [...addr(d.billingAddress), ...addr(d.shippingAddress)] : new Array(14).fill('')),
          first ? o.note ?? '' : '', first ? o.cancelledAt?.toISOString() ?? '' : '', first ? o.tags.join(', ') : '', first ? o.id : '',
        ]);
      }
    }
  }
}

export const DRAFT_ORDER_COLUMNS = [
  'Name', 'Status', 'Email', 'Currency', 'Subtotal', 'Shipping', 'Taxes', 'Discount', 'Total', 'Created at', 'Completed at', 'Order',
  'Lineitem quantity', 'Lineitem name', 'Lineitem price', 'Lineitem sku', 'Shipping Name', 'Shipping Address1', 'Shipping City', 'Shipping Zip', 'Shipping Province', 'Shipping Country',
  'Notes', 'Tags', 'Id',
];

/** Draft order export (read-only), same layout as the order export: one row per line item. */
export async function* exportDraftOrders(db: Db, shopId: number, filter: OrderExportFilter = {}): AsyncGenerator<string> {
  yield csvLine(DRAFT_ORDER_COLUMNS);
  let after = 0;
  for (;;) {
    const batch = await db.select({ d: draftOrders, orderName: orders.name }).from(draftOrders).leftJoin(orders, eq(orders.id, draftOrders.orderId))
      .where(and(eq(draftOrders.shopId, shopId), gt(draftOrders.id, after), draftSearch(filter.query), filter.ids ? inArray(draftOrders.id, filter.ids.length ? filter.ids : [0]) : undefined))
      .orderBy(asc(draftOrders.id)).limit(200);
    if (!batch.length) return;
    after = batch.at(-1)!.d.id;
    for (const { d, orderName } of batch) {
      const money = (n: number) => decimal(n, d.currency);
      const a = d.shippingAddress ?? {};
      const lines = d.lines.length ? d.lines : [null];
      for (const [i, l] of lines.entries()) {
        const first = i === 0;
        yield csvLine([
          d.name, first ? d.status.toLowerCase() : '', first ? d.email ?? '' : '', first ? d.currency : '', first ? money(d.subtotal) : '', first ? money(d.totalShipping) : '', first ? money(d.totalTax) : '',
          first ? money(d.totalDiscounts) : '', first ? money(d.total) : '', first ? d.createdAt.toISOString() : '', first ? d.completedAt?.toISOString() ?? '' : '', first ? orderName ?? '' : '',
          l?.quantity ?? '', l ? [l.title, l.variantTitle].filter(Boolean).join(' - ') : '', l ? money(l.unitPrice) : '', l?.sku ?? '',
          ...(first ? [[a.firstName, a.lastName].filter(Boolean).join(' '), a.address1 ?? '', a.city ?? '', a.zip ?? '', a.provinceCode ?? a.province ?? '', a.countryCode ?? a.country ?? ''] : new Array(6).fill('')),
          first ? d.note ?? '' : '', first ? d.tags.join(', ') : '', first ? d.id : '',
        ]);
      }
    }
  }
}
