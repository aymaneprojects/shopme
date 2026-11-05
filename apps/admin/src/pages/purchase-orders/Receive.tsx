import { Banner, Button, Card, Skeleton, useToast } from '@shopme/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { gql, mutate } from '../../api';
import { PageHeader } from '../../components/PageHeader';
import { numToGid } from '../../format';
import { PURCHASE_ORDER, PURCHASE_ORDER_RECEIVE } from '../../graphql';
import { useT } from '../../i18n';
import { errText } from '../transfers/shared';
import type { PurchaseOrderDetail } from './Detail';
import { PurchaseOrderStateBadge } from './List';

/** Receive units of an ordered purchase order: accepted and rejected per line, with cost update and over-receiving options. */
export function PurchaseOrderReceivePage() {
  const { id = '' } = useParams();
  const t = useT();
  const gid = numToGid('InventoryPurchaseOrder', id);
  const q = useQuery({ queryKey: ['purchase-order', gid], queryFn: () => gql<{ inventoryPurchaseOrder: PurchaseOrderDetail | null }>(PURCHASE_ORDER, { id: gid }) });
  if (q.isLoading) return <div className="grid gap-4"><Skeleton className="h-8 w-64" /><Skeleton className="h-64" /></div>;
  if (q.error) return <Banner>{q.error.message}</Banner>;
  const po = q.data?.inventoryPurchaseOrder;
  if (!po) return <Banner>{t('po.notFound')}</Banner>;
  return <ReceiveForm key={q.dataUpdatedAt} po={po} num={id} />;
}

function ReceiveForm({ po, num }: { po: PurchaseOrderDetail; num: string }) {
  const t = useT();
  const nav = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();
  const lines = po.lineItems.nodes;
  const [accept, setAccept] = useState<Record<string, string>>({});
  const [reject, setReject] = useState<Record<string, string>>({});
  const [updateCost, setUpdateCost] = useState(true);
  const [allowOver, setAllowOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const n = (v: string | undefined) => Math.max(0, Math.floor(Number(v) || 0));
  const total = (l: (typeof lines)[number]) => n(accept[l.id]) + n(reject[l.id]);
  const over = lines.some((l) => total(l) > l.shopmeOutstandingQuantity);
  const any = lines.some((l) => total(l) > 0);
  const open = po.shopmeState === 'ORDERED' || po.shopmeState === 'PARTIALLY_RECEIVED';

  const go = useMutation({
    mutationFn: () => mutate(PURCHASE_ORDER_RECEIVE, {
      id: po.id, input: {
        lineItems: lines.filter((l) => total(l) > 0).map((l) => ({ purchaseOrderLineItemId: l.id, acceptedQuantity: n(accept[l.id]), rejectedQuantity: n(reject[l.id]) })),
        allowOverReceive: allowOver, updateUnitCost: updateCost,
      },
    }, 'shopmePurchaseOrderReceive'),
    onSuccess: () => {
      for (const k of ['purchase-order', 'purchase-orders', 'transfers', 'inventory']) void qc.invalidateQueries({ queryKey: [k] });
      toast(t('po.receivedDone'));
      nav(`/purchase-orders/${num}`, { replace: true });
    },
    onError: (e) => setError(errText(e)),
  });

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader back={`/purchase-orders/${num}`} title={t('po.receiveTitle', { name: po.name })} badges={<PurchaseOrderStateBadge state={po.shopmeState} />} subtitle={`${po.origin?.supplierName ?? ''} → ${po.destination?.name ?? ''}`}
        actions={<><Button disabled={!open} onClick={() => { setAccept(Object.fromEntries(lines.map((l) => [l.id, String(l.shopmeOutstandingQuantity)]))); setReject({}); }}>{t('transfers.receiveAll')}</Button>
          <Button variant="primary" disabled={!open || !any || (over && !allowOver)} loading={go.isPending} onClick={() => { setError(null); go.mutate(); }}>{t('transfers.receiveItems')}</Button></>} />
      {error && <div className="mb-4"><Banner>{error}</Banner></div>}
      {!open && <div className="mb-4"><Banner tone="info">{t('po.notReceivable')}</Banner></div>}
      {over && !allowOver && <div className="mb-4"><Banner tone="warning">{t('po.receiveOver')}</Banner></div>}
      <Card>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[30rem] text-[13px]">
            <thead><tr className="text-left text-xs text-muted">
              <th className="py-2 font-medium">{t('transfers.product')}</th><th className="py-2 text-right font-medium">{t('transfers.ordered')}</th><th className="py-2 text-right font-medium">{t('transfers.alreadyReceived')}</th>
              <th className="py-2 text-right font-medium">{t('transfers.toReceive')}</th><th className="w-28 py-2 pl-3 font-medium">{t('transfers.accepted')}</th><th className="w-28 py-2 font-medium">{t('transfers.rejected')}</th></tr></thead>
            <tbody>
              {lines.map((l) => {
                const title = [l.title, l.variantTitle].filter(Boolean).join(' - ');
                return (
                  <tr key={l.id} className="border-t border-line align-top">
                    <td className="py-2"><p>{title}</p><p className="text-xs text-muted">{l.shopmeSku}</p></td>
                    <td className="py-2 text-right">{l.totalQuantity}</td>
                    <td className="py-2 text-right">{l.shopmeReceivedQuantity + l.shopmeRejectedQuantity}</td>
                    <td className="py-2 text-right">{l.shopmeOutstandingQuantity}</td>
                    <td className="py-2 pl-3"><input type="number" min={0} aria-label={`${t('transfers.accepted')} ${title}`} className="field-control w-24" value={accept[l.id] ?? ''} placeholder="0" onChange={(e) => setAccept({ ...accept, [l.id]: e.target.value })} /></td>
                    <td className="py-2"><input type="number" min={0} aria-label={`${t('transfers.rejected')} ${title}`} className="field-control w-24" value={reject[l.id] ?? ''} placeholder="0" onChange={(e) => setReject({ ...reject, [l.id]: e.target.value })} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="mt-4 grid gap-2 text-[13px]">
          <label className="flex items-center gap-2"><input type="checkbox" checked={updateCost} onChange={(e) => setUpdateCost(e.target.checked)} />{t('po.updateCosts')}</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={allowOver} onChange={(e) => setAllowOver(e.target.checked)} />{t('po.allowOver')}</label>
        </div>
      </Card>
    </div>
  );
}
