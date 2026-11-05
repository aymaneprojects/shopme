import { Banner, Button, Card, Select, Skeleton, useToast } from '@shopme/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { gql, mutate } from '../../api';
import { PageHeader } from '../../components/PageHeader';
import { numToGid } from '../../format';
import { SHIPMENT_RECEIVE, TRANSFER_SHIPMENT } from '../../graphql';
import { useT } from '../../i18n';
import type { Shipment } from './Detail';
import { TransferStatusBadge, errText } from './shared';

interface ShipmentWithTransfer extends Shipment { shopmeTransfer: { id: string; name: string; status: string; origin: { name: string } | null; destination: { name: string } | null } | null }

/** Receive a shipment: accepted and rejected units per line, "receive all", and what to do with the units not received. */
export function TransferReceivePage() {
  const { id = '', shipmentId = '' } = useParams();
  const t = useT();
  const gid = numToGid('InventoryShipment', shipmentId);
  const q = useQuery({ queryKey: ['transfer-shipment', gid], queryFn: () => gql<{ inventoryShipment: ShipmentWithTransfer | null }>(TRANSFER_SHIPMENT, { id: gid }) });
  if (q.isLoading) return <div className="grid gap-4"><Skeleton className="h-8 w-64" /><Skeleton className="h-64" /></div>;
  if (q.error) return <Banner>{q.error.message}</Banner>;
  const s = q.data?.inventoryShipment;
  if (!s) return <Banner>{t('transfers.notFound')}</Banner>;
  return <ReceiveForm key={q.dataUpdatedAt} s={s} transferNum={id} />;
}

function ReceiveForm({ s, transferNum }: { s: ShipmentWithTransfer; transferNum: string }) {
  const t = useT();
  const nav = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();
  const lines = s.lineItems.nodes;
  const [accept, setAccept] = useState<Record<string, string>>({});
  const [reject, setReject] = useState<Record<string, string>>({});
  const [rest, setRest] = useState<'KEEP' | 'CANCELED'>('KEEP');
  const [error, setError] = useState<string | null>(null);
  const n = (v: string | undefined) => Math.max(0, Math.floor(Number(v) || 0));
  const total = (l: (typeof lines)[number]) => n(accept[l.id]) + n(reject[l.id]);
  const over = lines.some((l) => total(l) > l.unreceivedQuantity);
  const any = lines.some((l) => total(l) > 0) || rest === 'CANCELED';
  const receivable = s.status === 'IN_TRANSIT' || s.status === 'PARTIALLY_RECEIVED';

  const go = useMutation({
    mutationFn: async () => {
      const lineItems = lines.flatMap((l) => [
        ...(n(accept[l.id]) ? [{ shipmentLineItemId: l.id, quantity: n(accept[l.id]), reason: 'ACCEPTED' }] : []),
        ...(n(reject[l.id]) ? [{ shipmentLineItemId: l.id, quantity: n(reject[l.id]), reason: 'REJECTED' }] : []),
      ]);
      await mutate(SHIPMENT_RECEIVE, { id: s.id, lineItems, bulkReceiveAction: rest === 'CANCELED' ? 'CANCELED' : null }, 'inventoryShipmentReceive');
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['transfer'] }); void qc.invalidateQueries({ queryKey: ['transfers'] }); void qc.invalidateQueries({ queryKey: ['inventory'] });
      toast(t('transfers.receivedDone'));
      nav(`/transfers/${transferNum}`, { replace: true });
    },
    onError: (e) => setError(errText(e)),
  });

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader back={`/transfers/${transferNum}`} title={t('transfers.receiveTitle', { name: s.name })} badges={<TransferStatusBadge status={s.status} />}
        subtitle={s.shopmeTransfer ? `${s.shopmeTransfer.origin?.name ?? ''} → ${s.shopmeTransfer.destination?.name ?? ''}` : undefined}
        actions={<><Button disabled={!receivable} onClick={() => { setAccept(Object.fromEntries(lines.map((l) => [l.id, String(l.unreceivedQuantity)]))); setReject({}); }}>{t('transfers.receiveAll')}</Button>
          <Button variant="primary" disabled={!receivable || !any || over} loading={go.isPending} onClick={() => { setError(null); go.mutate(); }}>{t('transfers.receiveItems')}</Button></>} />
      {error && <div className="mb-4"><Banner>{error}</Banner></div>}
      {!receivable && <div className="mb-4"><Banner tone="info">{t('transfers.notReceivable')}</Banner></div>}
      {over && <div className="mb-4"><Banner tone="warning">{t('transfers.receiveOver')}</Banner></div>}
      <Card>
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead><tr className="text-left text-xs text-muted">
              <th className="py-2 font-medium">{t('transfers.product')}</th><th className="py-2 text-right font-medium">{t('transfers.shipped')}</th><th className="py-2 text-right font-medium">{t('transfers.alreadyReceived')}</th>
              <th className="py-2 text-right font-medium">{t('transfers.toReceive')}</th><th className="w-28 py-2 pl-3 font-medium">{t('transfers.accepted')}</th><th className="w-28 py-2 font-medium">{t('transfers.rejected')}</th></tr></thead>
            <tbody>
              {lines.map((l) => {
                const v = l.inventoryItem?.variant;
                const title = v ? `${v.product.title}${v.title !== 'Default Title' ? ` - ${v.title}` : ''}` : '—';
                return (
                  <tr key={l.id} className="border-t border-line align-top">
                    <td className="py-2"><p>{title}</p>{l.inventoryItem?.sku && <p className="text-xs text-muted">{l.inventoryItem.sku}</p>}</td>
                    <td className="py-2 text-right">{l.quantity}</td>
                    <td className="py-2 text-right">{l.acceptedQuantity + l.rejectedQuantity + l.canceledQuantity}</td>
                    <td className="py-2 text-right">{l.unreceivedQuantity}</td>
                    <td className="py-2 pl-3"><input type="number" min={0} max={l.unreceivedQuantity} disabled={l.unreceivedQuantity === 0} aria-label={`${t('transfers.accepted')} ${title}`} className="field-control w-24" value={accept[l.id] ?? ''} placeholder="0" onChange={(e) => setAccept({ ...accept, [l.id]: e.target.value })} /></td>
                    <td className="py-2"><input type="number" min={0} max={l.unreceivedQuantity} disabled={l.unreceivedQuantity === 0} aria-label={`${t('transfers.rejected')} ${title}`} className="field-control w-24" value={reject[l.id] ?? ''} placeholder="0" onChange={(e) => setReject({ ...reject, [l.id]: e.target.value })} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="mt-4 max-w-sm">
          <Select label={t('transfers.remainingUnits')} help={t('transfers.remainingHelp')} value={rest} onChange={(e) => setRest(e.target.value as 'KEEP' | 'CANCELED')}>
            <option value="KEEP">{t('transfers.remainingKeep')}</option>
            <option value="CANCELED">{t('transfers.remainingCancel')}</option>
          </Select>
        </div>
      </Card>
    </div>
  );
}
