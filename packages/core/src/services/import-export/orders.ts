import { and, asc, eq, gt } from 'drizzle-orm';
import { customers, orders } from '../../db/schema';
import type { Db } from '../../db/client';
import { getOrderDetail } from '../orders/orders';
import { csvLine } from '../csv';
import { decimal } from './common';

export const ORDER_COLUMNS = [
  'Name', 'Email', 'Financial Status', 'Paid at', 'Fulfillment Status', 'Accepts Marketing', 'Currency', 'Subtotal', 'Shipping', 'Taxes', 'Total', 'Discount Code', 'Discount Amount',
  'Shipping Method', 'Created at', 'Lineitem quantity', 'Lineitem name', 'Lineitem price', 'Lineitem sku', 'Lineitem requires shipping', 'Lineitem fulfillment status',
  'Billing Name', 'Billing Address1', 'Billing City', 'Billing Zip', 'Billing Province', 'Billing Country', 'Billing Phone',
  'Shipping Name', 'Shipping Address1', 'Shipping City', 'Shipping Zip', 'Shipping Province', 'Shipping Country', 'Shipping Phone', 'Notes', 'Cancelled at', 'Tags', 'Id',
];

/** Order export (read-only): one row per line item, order-level columns only on the first row of each order. */
export async function* exportOrders(db: Db, shopId: number): AsyncGenerator<string> {
  yield csvLine(ORDER_COLUMNS);
  let after = 0;
  for (;;) {
    const batch = await db.select({ o: orders, marketing: customers.acceptsMarketing }).from(orders).leftJoin(customers, eq(customers.id, orders.customerId))
      .where(and(eq(orders.shopId, shopId), gt(orders.id, after))).orderBy(asc(orders.id)).limit(100);
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
