import { Banner, Button, Card, ConfirmDialog, Skeleton, useToast } from '@shopme/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router';
import { useState } from 'react';
import { gql, mutate } from '../../api';
import { PageHeader } from '../../components/PageHeader';
import { useFormat } from '../../components/shared';
import type { Money } from '../../components/shared';
import { gidToNum, numToGid } from '../../format';
import { PURCHASE_ORDER, PURCHASE_ORDER_ARCHIVE, PURCHASE_ORDER_CLOSE, PURCHASE_ORDER_DUPLICATE } from '../../graphql';
import { useT } from '../../i18n';
import type { Key } from '../../i18n';
import { Thumb } from '../Products';
import { TransferStatusBadge, dayValue, errText } from '../transfers/shared';
import { PurchaseOrderForm } from './Form';
import type { PoDraft } from './Form';
import { PurchaseOrderStateBadge } from './List';

interface Line {
  id: string; title: string | null; variantTitle: string | null; supplierSku: string | null; totalQuantity: number; taxPercent: string | null; shopmeSku: string | null;
  shopmeReceivedQuantity: number; shopmeRejectedQuantity: number; shopmeOutstandingQuantity: number; unitCost: { amount: string }; subtotal: { amount: string }; totalCost: { amount: string };
  inventoryItem: { id: string; sku: string | null; variant: { id: string; product: { featuredMedia: { image?: { url: string } } | null } } | null } | null;
}
export interface PurchaseOrderDetail {
  id: string; name: string; status: string; shopmeState: string; dateCreated: string; orderedAt: string | null; archivedAt: string | null; shopmeClosedAt: string | null; currency: string;
  shopmeReferenceNumber: string | null; shopmeSupplierNote: string | null; shopmePaymentTerms: string | null; shopmeTaxesIncluded: boolean; shopmeExchangeRate: number | null; shopmeCarrier: string | null;
  shopmeExpectedArrival: string | null; shopmeTags: string[]; shopmeDestinationLocationId: string | null; shopmeSupplier: { id: string; name: string } | null; origin: { supplierName: string | null } | null;
  destination: { name: string } | null; shopmeTotalQuantity: number; shopmeReceivedQuantity: number; shopmeRejectedQuantity: number;
  shopmeTotals: { variantsCount: number; itemsCount: number; subtotal: { amount: string }; taxes: { amount: string }; shipping: { amount: string }; other: { amount: string }; total: Money };
  lineItems: { nodes: Line[] }; transfers: { nodes: Array<{ id: string; name: string; status: string; totalQuantity: number; receivedQuantity: number; dateCreated: string | null }> };
}

export function PurchaseOrderDetailPage() {
  const { id = '' } = useParams();
  const t = useT();
  const gid = numToGid('InventoryPurchaseOrder', id);
  const q = useQuery({ queryKey: ['purchase-order', gid], queryFn: () => gql<{ inventoryPurchaseOrder: PurchaseOrderDetail | null }>(PURCHASE_ORDER, { id: gid }) });
  if (q.isLoading) return <div className="grid gap-4"><Skeleton className="h-8 w-64" /><Skeleton className="h-64" /></div>;
  if (q.error) return <Banner>{q.error.message}</Banner>;
  const po = q.data?.inventoryPurchaseOrder;
  if (!po) return <Banner>{t('po.notFound')}</Banner>;
  if (po.status === 'DRAFT') {
    const draft: PoDraft = {
      id: po.id, supplierId: po.shopmeSupplier?.id ?? '', destination: po.shopmeDestinationLocationId ?? '', reference: po.shopmeReferenceNumber ?? '', note: po.shopmeSupplierNote ?? '',
      paymentTerms: po.shopmePaymentTerms ?? 'NONE', currency: po.currency, tags: po.shopmeTags, shipping: stripZero(po.shopmeTotals.shipping.amount), other: stripZero(po.shopmeTotals.other.amount),
      taxesIncluded: po.shopmeTaxesIncluded, expectedArrival: po.shopmeExpectedArrival ? dayValue(po.shopmeExpectedArrival) : '', carrier: po.shopmeCarrier ?? '', exchangeRate: po.shopmeExchangeRate ? String(po.shopmeExchangeRate) : '',
      lines: po.lineItems.nodes.map((l) => ({
        itemId: l.inventoryItem?.id ?? '', lineId: l.id, title: [l.title, l.variantTitle].filter(Boolean).join(' - '), sku: l.shopmeSku, image: l.inventoryItem?.variant?.product.featuredMedia?.image?.url ?? null,
        supplierSku: l.supplierSku ?? '', quantity: String(l.totalQuantity), unitCost: l.unitCost.amount, taxPercent: l.taxPercent ?? '',
      })),
    };
    return <PurchaseOrderForm key={q.dataUpdatedAt} initial={draft} />;
  }
  return <PurchaseOrderView key={q.dataUpdatedAt} po={po} />;
}
const stripZero = (a: string) => (Number(a) === 0 ? '' : a);

function PurchaseOrderView({ po }: { po: PurchaseOrderDetail }) {
  const t = useT();
  const fmt = useFormat();
  const nav = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<'close' | null>(null);
  const num = gidToNum(po.id);
  const money = (amount: string) => fmt.money({ amount, currencyCode: po.currency });
  const act = useMutation({
    mutationFn: async (a: { doc: string; vars: Record<string, unknown>; root: string; ok: string; then?: (r: Record<string, unknown>) => void }) => ({ a, r: await mutate<Record<string, unknown>>(a.doc, a.vars, a.root) }),
    onSuccess: ({ a, r }) => { for (const k of ['purchase-order', 'purchase-orders', 'inventory']) void qc.invalidateQueries({ queryKey: [k] }); toast(a.ok); a.then?.(r); setConfirm(null); },
    onError: (e) => { setError(errText(e)); setConfirm(null); },
  });
  const run = (doc: string, vars: Record<string, unknown>, root: string, ok: string, then?: (r: Record<string, unknown>) => void) => { setError(null); act.mutate({ doc, vars, root, ok, then }); };
  const open = po.shopmeState === 'ORDERED' || po.shopmeState === 'PARTIALLY_RECEIVED';
  const resolved = po.shopmeReceivedQuantity + po.shopmeRejectedQuantity;
  const progress = po.shopmeTotalQuantity ? Math.round((resolved / po.shopmeTotalQuantity) * 100) : 0;
  const more = [
    { key: 'duplicate', label: t('transfers.duplicate'), onSelect: () => run(PURCHASE_ORDER_DUPLICATE, { id: po.id }, 'shopmePurchaseOrderDuplicate', t('po.duplicated'), (r) => nav(`/purchase-orders/${gidToNum((r.shopmePurchaseOrder as { id: string }).id)}`)) },
    ...(open ? [{ key: 'close', label: t('po.close'), onSelect: () => setConfirm('close') }] : []),
    ...(!po.archivedAt && (po.shopmeState === 'RECEIVED' || po.shopmeState === 'CLOSED') ? [{ key: 'archive', label: t('po.archive'), onSelect: () => run(PURCHASE_ORDER_ARCHIVE, { id: po.id, archive: true }, 'shopmePurchaseOrderArchive', t('po.archived')) }] : []),
    ...(po.archivedAt ? [{ key: 'unarchive', label: t('po.unarchive'), onSelect: () => run(PURCHASE_ORDER_ARCHIVE, { id: po.id, archive: false }, 'shopmePurchaseOrderArchive', t('po.unarchived')) }] : []),
  ];
  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader back="/purchase-orders" title={po.name} badges={<PurchaseOrderStateBadge state={po.shopmeState} />} subtitle={t('po.orderedOn', { date: fmt.date(po.orderedAt ?? po.dateCreated) })} more={more}
        actions={open ? <Button variant="primary" onClick={() => nav(`/purchase-orders/${num}/receive`)}>{t('po.receiveItems')}</Button> : undefined} />
      {error && <div className="mb-4"><Banner>{error}</Banner></div>}
      {po.shopmeState === 'CLOSED' && <div className="mb-4"><Banner tone="info">{t('po.closedNote')}</Banner></div>}
      <div className="grid items-start gap-4 lg:grid-cols-[1fr_20rem]">
        <div className="flex flex-col gap-4">
          <Card title={t('transfers.items')} actions={<span className="text-xs text-muted">{t('po.nOfM', { n: resolved, m: po.shopmeTotalQuantity })}</span>}>
            <div className="mb-3 h-1.5 overflow-hidden rounded-full bg-surface" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}><div className="h-full bg-success" style={{ width: `${progress}%` }} /></div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[32rem] text-[13px]">
                <thead><tr className="text-left text-xs text-muted"><th className="py-2 font-medium">{t('transfers.product')}</th><th className="py-2 text-right font-medium">{t('transfers.ordered')}</th><th className="py-2 text-right font-medium">{t('transfers.received')}</th><th className="py-2 text-right font-medium">{t('transfers.rejected')}</th><th className="py-2 text-right font-medium">{t('po.unitCost')}</th><th className="py-2 text-right font-medium">{t('po.lineTotal')}</th></tr></thead>
                <tbody>
                  {po.lineItems.nodes.map((l) => (
                    <tr key={l.id} className="border-t border-line align-top">
                      <td className="py-2"><div className="flex items-center gap-2"><Thumb url={l.inventoryItem?.variant?.product.featuredMedia?.image?.url} className="size-8" />
                        <div><p>{[l.title, l.variantTitle].filter(Boolean).join(' - ')}</p><p className="text-xs text-muted">{[l.shopmeSku, l.supplierSku && t('po.supplierSkuShort', { sku: l.supplierSku })].filter(Boolean).join(' · ')}</p></div></div></td>
                      <td className="py-2 text-right">{l.totalQuantity}</td><td className="py-2 text-right">{l.shopmeReceivedQuantity}</td><td className="py-2 text-right">{l.shopmeRejectedQuantity}</td>
                      <td className="py-2 text-right">{money(l.unitCost.amount)}</td><td className="py-2 text-right">{money(l.totalCost.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
          <Card title={t('po.receipts')}>
            {po.transfers.nodes.length === 0 ? <p className="text-[13px] text-muted">{t('po.noReceipts')}</p> : (
              <ul className="divide-y divide-line">
                {po.transfers.nodes.map((tr) => (
                  <li key={tr.id} className="flex items-center gap-3 py-2 text-[13px]">
                    <Link className="font-medium text-accent hover:underline" to={`/transfers/${gidToNum(tr.id)}`}>{tr.name}</Link>
                    <TransferStatusBadge status={tr.status} /><span className="text-muted">{fmt.date(tr.dateCreated)}</span>
                    <span className="ml-auto">{t('po.nOfM', { n: tr.receivedQuantity, m: tr.totalQuantity })}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
        <div className="flex flex-col gap-4">
          <Card title={t('po.costSummary')}>
            <dl className="grid gap-1.5 text-[13px]">
              <div className="flex justify-between"><dt>{t('po.variantsItems', { v: po.shopmeTotals.variantsCount, i: po.shopmeTotals.itemsCount, $count: po.shopmeTotals.variantsCount })}</dt><dd>{money(po.shopmeTotals.subtotal.amount)}</dd></div>
              <div className="flex justify-between"><dt>{po.shopmeTaxesIncluded ? t('po.taxesIncluded') : t('po.taxes')}</dt><dd>{money(po.shopmeTotals.taxes.amount)}</dd></div>
              {Number(po.shopmeTotals.shipping.amount) > 0 && <div className="flex justify-between"><dt>{t('po.shipping')}</dt><dd>{money(po.shopmeTotals.shipping.amount)}</dd></div>}
              {Number(po.shopmeTotals.other.amount) > 0 && <div className="flex justify-between"><dt>{t('po.otherCosts')}</dt><dd>{money(po.shopmeTotals.other.amount)}</dd></div>}
            </dl>
            <div className="mt-3 flex justify-between border-t border-line pt-3 text-[13px] font-semibold"><span>{t('po.total')}</span><span>{fmt.money(po.shopmeTotals.total)}</span></div>
          </Card>
          <Card title={t('po.supplier')}><p className="text-[13px] font-medium">{po.origin?.supplierName ?? '—'}</p></Card>
          <Card title={t('po.destination')}><p className="text-[13px] font-medium">{po.destination?.name ?? '—'}</p></Card>
          <Card title={t('po.details')}>
            <dl className="grid gap-2 text-[13px]">
              <div><dt className="text-xs text-muted">{t('po.reference')}</dt><dd>{po.shopmeReferenceNumber ?? '—'}</dd></div>
              <div><dt className="text-xs text-muted">{t('po.paymentTerms')}</dt><dd>{t(`po.terms.${po.shopmePaymentTerms ?? 'NONE'}` as Key)}</dd></div>
              <div><dt className="text-xs text-muted">{t('po.currency')}</dt><dd>{po.currency}</dd></div>
              {po.shopmeExpectedArrival && <div><dt className="text-xs text-muted">{t('po.expectedArrival')}</dt><dd>{fmt.date(po.shopmeExpectedArrival)}</dd></div>}
              {po.shopmeCarrier && <div><dt className="text-xs text-muted">{t('transfers.carrier')}</dt><dd>{po.shopmeCarrier}</dd></div>}
              {po.shopmeSupplierNote && <div><dt className="text-xs text-muted">{t('po.supplierNote')}</dt><dd className="whitespace-pre-wrap">{po.shopmeSupplierNote}</dd></div>}
              {po.shopmeTags.length > 0 && <div><dt className="text-xs text-muted">{t('field.tags')}</dt><dd>{po.shopmeTags.join(', ')}</dd></div>}
            </dl>
          </Card>
        </div>
      </div>
      <ConfirmDialog open={confirm === 'close'} title={t('po.closeTitle')} message={t('po.closeBody')} confirmLabel={t('po.close')} cancelLabel={t('common.cancel')} closeLabel={t('common.close')} danger loading={act.isPending}
        onConfirm={() => run(PURCHASE_ORDER_CLOSE, { id: po.id }, 'shopmePurchaseOrderClose', t('po.closed'))} onClose={() => setConfirm(null)} />
    </div>
  );
}
