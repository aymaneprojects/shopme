import { useToast } from '@shopme/ui';
import { gql } from '../api';
import { useFormat } from '../components/shared';
import type { MoneySet } from '../components/shared';
import { ORDER_FOR_PRINT } from '../graphql';
import { useI18n } from '../i18n';
import { printDocuments, printHtmlMany } from './print';
import type { PrintDoc, PrintableOrder } from './print';

type Addr = { firstName?: string | null; lastName?: string | null; company?: string | null; address1?: string | null; address2?: string | null; city?: string | null; zip?: string | null; country?: string | null } | null;
interface PrintOrder {
  id: string; name: string; createdAt: string; email: string | null;
  lineItems: { nodes: Array<{ title: string; variantTitle: string | null; sku: string | null; quantity: number; originalUnitPriceSet: MoneySet; discountedTotalSet: MoneySet }> };
  subtotalPriceSet: MoneySet; totalShippingPriceSet: MoneySet; totalTaxSet: MoneySet; totalPriceSet: MoneySet; shippingAddress: Addr; billingAddress: Addr;
}

const addressLines = (a: Addr) => (a ? [[a.firstName, a.lastName].filter(Boolean).join(' '), a.company, a.address1, a.address2, [a.zip, a.city].filter(Boolean).join(' '), a.country].filter((x): x is string => !!x) : []);

/** Prints the chosen documents (order page, packing slip, invoice) for several orders in one go; resolves to how many orders were printed. */
export function usePrintOrders() {
  const { t, lang } = useI18n();
  const fmt = useFormat();
  const toast = useToast();
  return async (ids: string[], docs: PrintDoc[]): Promise<number> => {
    try {
      const rows = (await Promise.all(ids.map((id) => gql<{ order: PrintOrder | null }>(ORDER_FOR_PRINT, { id })))).flatMap((r) => (r.order ? [r.order] : []));
      const orders: PrintableOrder[] = rows.map((o) => ({
        name: o.name, createdAt: o.createdAt, email: o.email,
        lines: o.lineItems.nodes.map((l) => ({ title: l.title, variantTitle: l.variantTitle, sku: l.sku, quantity: l.quantity, unitPrice: fmt.money(l.originalUnitPriceSet), total: fmt.money(l.discountedTotalSet) })),
        totals: [[t('order.subtotal'), fmt.money(o.subtotalPriceSet)], [t('order.shipping'), fmt.money(o.totalShippingPriceSet)], [t('order.taxes'), fmt.money(o.totalTaxSet)], [t('order.total'), fmt.money(o.totalPriceSet)]],
        shipping: addressLines(o.shippingAddress), billing: addressLines(o.billingAddress),
      }));
      const html = printHtmlMany(orders, docs, { order: t('order.printOrderTitle'), packing: t('order.printPackingTitle'), invoice: t('btn.print.invoiceTitle'), date: t('orders.date'), item: t('order.items'), sku: 'SKU', quantity: t('order.quantity'), price: t('order.price'), total: t('order.total'), shipTo: t('order.shippingAddress'), billTo: t('order.billingAddress'), blocked: '' }, lang);
      if (!orders.length || !printDocuments(html)) { toast(t('order.printFailed'), 'critical'); return 0; }
      return orders.length;
    } catch (e) { toast((e as Error).message, 'critical'); return 0; }
  };
}
