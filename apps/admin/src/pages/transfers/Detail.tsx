import { Banner, Button, Card, ConfirmDialog, Input, Modal, Skeleton, useToast } from '@shopme/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ExternalLink, Truck } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { gql, mutate } from '../../api';
import { PageHeader } from '../../components/PageHeader';
import { useFormat } from '../../components/shared';
import { gidToNum, numToGid } from '../../format';
import {
  SHIPMENT_CREATE, SHIPMENT_CREATE_IN_TRANSIT, SHIPMENT_DELETE, SHIPMENT_MARK_IN_TRANSIT, TRANSFER, TRANSFER_CANCEL, TRANSFER_DUPLICATE,
} from '../../graphql';
import { useT } from '../../i18n';
import { TransferForm } from './Form';
import type { TransferDraft } from './Form';
import { TransferStatusBadge, dayValue, errText } from './shared';

interface ShipmentLine { id: string; quantity: number; acceptedQuantity: number; rejectedQuantity: number; canceledQuantity: number; unreceivedQuantity: number; inventoryItem: { id: string; sku: string | null; variant: { id: string; title: string; product: { id: string; title: string } } | null } | null }
export interface Shipment {
  id: string; name: string; status: string; barcode: string | null; dateCreated: string | null; dateShipped: string | null; dateReceived: string | null;
  tracking: { company: string | null; trackingNumber: string | null; trackingUrl: string | null; arrivesAt: string | null } | null;
  lineItemTotalQuantity: number; totalAcceptedQuantity: number; totalRejectedQuantity: number; totalCanceledQuantity: number; lineItems: { nodes: ShipmentLine[] };
}
interface Line { id: string; title: string | null; totalQuantity: number; shippableQuantity: number; shippedQuantity: number; pickedForShipmentQuantity: number; processableQuantity: number; inventoryItem: { id: string; sku: string | null } | null }
interface Snap { name: string; location: { id: string } | null; address: { formatted: string[] } }
export interface TransferDetail {
  id: string; name: string; status: string; dateCreated: string | null; referenceName: string | null; note: string | null; tags: string[]; totalQuantity: number; receivedQuantity: number;
  shopmePurchaseOrderId: string | null; origin: Snap | null; destination: Snap | null; lineItems: { nodes: Line[] }; shipments: { nodes: Shipment[] };
}

export function TransferDetailPage() {
  const { id = '' } = useParams();
  const t = useT();
  const gid = numToGid('InventoryTransfer', id);
  const q = useQuery({ queryKey: ['transfer', gid], queryFn: () => gql<{ inventoryTransfer: TransferDetail | null }>(TRANSFER, { id: gid }) });
  if (q.isLoading) return <div className="grid gap-4"><Skeleton className="h-8 w-64" /><Skeleton className="h-64" /></div>;
  if (q.error) return <Banner>{q.error.message}</Banner>;
  const tr = q.data?.inventoryTransfer;
  if (!tr) return <Banner>{t('transfers.notFound')}</Banner>;
  if (tr.status === 'DRAFT') {
    const draft: TransferDraft = {
      id: tr.id, origin: tr.origin?.location?.id ?? '', destination: tr.destination?.location?.id ?? '', date: dayValue(tr.dateCreated), reference: tr.referenceName ?? '', note: tr.note ?? '', tags: tr.tags,
      lines: tr.lineItems.nodes.map((l) => ({ itemId: l.inventoryItem?.id ?? '', lineId: l.id, title: l.title ?? '', sku: l.inventoryItem?.sku ?? null, image: null, quantity: String(l.totalQuantity), available: null })),
    };
    return <TransferForm key={q.dataUpdatedAt} initial={draft} />;
  }
  return <TransferView key={q.dataUpdatedAt} tr={tr} />;
}

function TransferView({ tr }: { tr: TransferDetail }) {
  const t = useT();
  const fmt = useFormat();
  const nav = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();
  const [shipOpen, setShipOpen] = useState(false);
  const [confirm, setConfirm] = useState<'cancel' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const num = gidToNum(tr.id);
  const refresh = () => { void qc.invalidateQueries({ queryKey: ['transfer'] }); void qc.invalidateQueries({ queryKey: ['transfers'] }); void qc.invalidateQueries({ queryKey: ['inventory'] }); };
  const act = useMutation({
    mutationFn: async (a: { doc: string; vars: Record<string, unknown>; root: string; ok: string; then?: (r: Record<string, unknown>) => void }) => ({ a, r: await mutate<Record<string, unknown>>(a.doc, a.vars, a.root) }),
    onSuccess: ({ a, r }) => { refresh(); toast(a.ok); a.then?.(r); setConfirm(null); },
    onError: (e) => { setError(errText(e)); setConfirm(null); },
  });
  const run = (doc: string, vars: Record<string, unknown>, root: string, ok: string, then?: (r: Record<string, unknown>) => void) => { setError(null); act.mutate({ doc, vars, root, ok, then }); };

  const shipments = tr.shipments.nodes;
  const receivable = shipments.filter((s) => s.status === 'IN_TRANSIT' || s.status === 'PARTIALLY_RECEIVED');
  const remaining = tr.lineItems.nodes.reduce((n, l) => n + l.processableQuantity, 0);
  const canShip = (tr.status === 'READY_TO_SHIP' || tr.status === 'IN_PROGRESS') && remaining > 0 && !tr.shopmePurchaseOrderId;
  const primary = tr.status === 'READY_TO_SHIP' && canShip
    ? <Button variant="primary" onClick={() => setShipOpen(true)}><Truck className="size-4" />{t('transfers.shipItems')}</Button>
    : receivable.length === 1 ? <Button variant="primary" onClick={() => nav(`/transfers/${num}/receive/${gidToNum(receivable[0]!.id)}`)}>{t('transfers.receiveItems')}</Button> : null;
  const more = [
    ...(tr.status === 'IN_PROGRESS' && canShip ? [{ key: 'ship', label: t('transfers.addShipment'), onSelect: () => setShipOpen(true) }] : []),
    { key: 'duplicate', label: t('transfers.duplicate'), onSelect: () => run(TRANSFER_DUPLICATE, { id: tr.id }, 'inventoryTransferDuplicate', t('transfers.duplicated'), (r) => nav(`/transfers/${gidToNum((r.inventoryTransfer as { id: string }).id)}`)) },
    ...(tr.status === 'READY_TO_SHIP' && shipments.length === 0 ? [{ key: 'cancel', label: t('transfers.cancel'), danger: true, onSelect: () => setConfirm('cancel') }] : []),
  ];
  const progress = tr.totalQuantity ? Math.round((tr.receivedQuantity / tr.totalQuantity) * 100) : 0;

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader back="/transfers" title={tr.name} badges={<TransferStatusBadge status={tr.status} />} subtitle={fmt.date(tr.dateCreated)} actions={primary} more={more} />
      {error && <div className="mb-4"><Banner>{error}</Banner></div>}
      {tr.status === 'CANCELED' && <div className="mb-4"><Banner tone="info">{t('transfers.canceledNote')}</Banner></div>}
      <div className="grid gap-4 lg:grid-cols-[1fr_18rem]">
        <div className="flex flex-col gap-4">
          <Card title={t('transfers.items')} actions={<span className="text-xs text-muted">{t('transfers.receivedOf', { n: tr.receivedQuantity, total: tr.totalQuantity })}</span>}>
            <div className="mb-3 h-1.5 overflow-hidden rounded-full bg-surface" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}><div className="h-full bg-success" style={{ width: `${progress}%` }} /></div>
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead><tr className="text-left text-xs text-muted"><th className="py-2 font-medium">{t('transfers.product')}</th><th className="py-2 text-right font-medium">{t('transfers.ordered')}</th><th className="py-2 text-right font-medium">{t('transfers.shipped')}</th><th className="py-2 text-right font-medium">{t('transfers.received')}</th><th className="py-2 text-right font-medium">{t('transfers.rejected')}</th></tr></thead>
                <tbody>
                  {tr.lineItems.nodes.map((l) => {
                    const sl = shipments.flatMap((s) => s.lineItems.nodes).filter((x) => x.inventoryItem?.id === l.inventoryItem?.id);
                    return (
                      <tr key={l.id} className="border-t border-line">
                        <td className="py-2"><p>{l.title}</p>{l.inventoryItem?.sku && <p className="text-xs text-muted">{l.inventoryItem.sku}</p>}</td>
                        <td className="py-2 text-right">{l.totalQuantity}</td><td className="py-2 text-right">{l.shippedQuantity}</td>
                        <td className="py-2 text-right">{sl.reduce((n, x) => n + x.acceptedQuantity, 0)}</td><td className="py-2 text-right">{sl.reduce((n, x) => n + x.rejectedQuantity, 0)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
          {shipments.map((s) => <ShipmentCard key={s.id} s={s} transferNum={num} onAction={run} />)}
        </div>
        <div className="flex flex-col gap-4">
          <Card title={t('transfers.origin')}><p className="text-[13px] font-medium">{tr.origin?.name ?? '—'}</p>{tr.origin?.address.formatted.map((l) => <p key={l} className="text-xs text-muted">{l}</p>)}</Card>
          <Card title={t('transfers.destination')}><p className="text-[13px] font-medium">{tr.destination?.name ?? '—'}</p>{tr.destination?.address.formatted.map((l) => <p key={l} className="text-xs text-muted">{l}</p>)}</Card>
          <Card title={t('transfers.details')}>
            <dl className="grid gap-2 text-[13px]">
              <div><dt className="text-xs text-muted">{t('transfers.reference')}</dt><dd>{tr.referenceName ?? '—'}</dd></div>
              {tr.note && <div><dt className="text-xs text-muted">{t('transfers.note')}</dt><dd className="whitespace-pre-wrap">{tr.note}</dd></div>}
              {tr.tags.length > 0 && <div><dt className="text-xs text-muted">{t('field.tags')}</dt><dd>{tr.tags.join(', ')}</dd></div>}
              {tr.shopmePurchaseOrderId && <div><dt className="text-xs text-muted">{t('transfers.purchaseOrder')}</dt><dd><Link className="text-accent hover:underline" to={`/purchase-orders/${gidToNum(tr.shopmePurchaseOrderId)}`}>{t('transfers.viewPurchaseOrder')}</Link></dd></div>}
            </dl>
          </Card>
        </div>
      </div>
      <ShipModal open={shipOpen} onClose={() => setShipOpen(false)} tr={tr} onDone={() => { setShipOpen(false); refresh(); toast(t('transfers.shipmentCreated')); }} onError={setError} />
      <ConfirmDialog open={confirm === 'cancel'} title={t('transfers.cancelTitle')} message={t('transfers.cancelBody')} confirmLabel={t('transfers.cancel')} cancelLabel={t('common.close')} closeLabel={t('common.close')} danger loading={act.isPending}
        onConfirm={() => run(TRANSFER_CANCEL, { id: tr.id }, 'inventoryTransferCancel', t('transfers.canceled'))} onClose={() => setConfirm(null)} />
    </div>
  );
}

function ShipmentCard({ s, transferNum, onAction }: { s: Shipment; transferNum: string; onAction: (doc: string, vars: Record<string, unknown>, root: string, ok: string) => void }) {
  const t = useT();
  const fmt = useFormat();
  const nav = useNavigate();
  const tk = s.tracking;
  return (
    <Card title={<span className="flex items-center gap-2">{s.name}<TransferStatusBadge status={s.status} /></span>}
      actions={<div className="flex gap-2">
        {s.status === 'DRAFT' && <><Button size="sm" onClick={() => onAction(SHIPMENT_DELETE, { id: s.id }, 'inventoryShipmentDelete', t('transfers.shipmentDeleted'))}>{t('common.delete')}</Button><Button size="sm" variant="primary" onClick={() => onAction(SHIPMENT_MARK_IN_TRANSIT, { id: s.id }, 'inventoryShipmentMarkInTransit', t('transfers.inTransitDone'))}>{t('transfers.markInTransit')}</Button></>}
        {(s.status === 'IN_TRANSIT' || s.status === 'PARTIALLY_RECEIVED') && <Button size="sm" variant="primary" onClick={() => nav(`/transfers/${transferNum}/receive/${gidToNum(s.id)}`)}>{t('transfers.receiveItems')}</Button>}
      </div>}>
      <div className="mb-3 flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted">
        {tk?.company && <span>{tk.company}</span>}
        {tk?.trackingNumber && (tk.trackingUrl ? <a className="inline-flex items-center gap-1 text-accent hover:underline" href={tk.trackingUrl} target="_blank" rel="noreferrer noopener">{tk.trackingNumber}<ExternalLink className="size-3" /></a> : <span>{tk.trackingNumber}</span>)}
        {tk?.arrivesAt && <span>{t('transfers.arrives', { date: fmt.date(tk.arrivesAt) })}</span>}
        {s.dateShipped && <span>{t('transfers.shippedOn', { date: fmt.date(s.dateShipped) })}</span>}
        {s.dateReceived && <span>{t('transfers.receivedOn', { date: fmt.date(s.dateReceived) })}</span>}
      </div>
      <table className="w-full text-[13px]">
        <thead><tr className="text-left text-xs text-muted"><th className="py-1 font-medium">{t('transfers.product')}</th><th className="py-1 text-right font-medium">{t('transfers.quantity')}</th><th className="py-1 text-right font-medium">{t('transfers.accepted')}</th><th className="py-1 text-right font-medium">{t('transfers.rejected')}</th><th className="py-1 text-right font-medium">{t('transfers.canceledQty')}</th></tr></thead>
        <tbody>
          {s.lineItems.nodes.map((l) => (
            <tr key={l.id} className="border-t border-line"><td className="py-1.5">{l.inventoryItem?.variant ? `${l.inventoryItem.variant.product.title}${l.inventoryItem.variant.title !== 'Default Title' ? ` - ${l.inventoryItem.variant.title}` : ''}` : '—'}</td>
              <td className="py-1.5 text-right">{l.quantity}</td><td className="py-1.5 text-right">{l.acceptedQuantity}</td><td className="py-1.5 text-right">{l.rejectedQuantity}</td><td className="py-1.5 text-right">{l.canceledQuantity}</td></tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

/** Create a shipment: pick quantities, add tracking, then save it as a draft or send it in transit right away. */
function ShipModal({ open, onClose, tr, onDone, onError }: { open: boolean; onClose: () => void; tr: TransferDetail; onDone: () => void; onError: (m: string) => void }) {
  const t = useT();
  const lines = tr.lineItems.nodes.filter((l) => l.processableQuantity > 0);
  const [qty, setQty] = useState<Record<string, string>>({});
  const [trk, setTrk] = useState({ company: '', trackingNumber: '', trackingUrl: '', arrivesAt: '' });
  const value = (l: Line) => qty[l.id] ?? String(l.processableQuantity);
  const go = useMutation({
    mutationFn: async (inTransit: boolean) => {
      const lineItems = lines.map((l) => ({ inventoryItemId: l.inventoryItem!.id, quantity: Math.min(l.processableQuantity, Math.max(0, Math.floor(Number(value(l)) || 0))) })).filter((l) => l.quantity > 0);
      const trackingInput = { company: trk.company.trim() || null, trackingNumber: trk.trackingNumber.trim() || null, trackingUrl: trk.trackingUrl.trim() || null, arrivesAt: trk.arrivesAt ? new Date(`${trk.arrivesAt}T12:00:00`).toISOString() : null };
      await mutate(inTransit ? SHIPMENT_CREATE_IN_TRANSIT : SHIPMENT_CREATE, { input: { movementId: tr.id, lineItems, trackingInput } }, inTransit ? 'inventoryShipmentCreateInTransit' : 'inventoryShipmentCreate');
    },
    onSuccess: onDone, onError: (e) => { onError(errText(e)); onClose(); },
  });
  const any = lines.some((l) => Number(value(l)) > 0);
  return (
    <Modal open={open} onClose={onClose} title={t('transfers.shipTitle')} closeLabel={t('common.close')} wide
      footer={<><Button onClick={onClose}>{t('common.cancel')}</Button><Button disabled={!any} loading={go.isPending && go.variables === false} onClick={() => go.mutate(false)}>{t('transfers.saveShipmentDraft')}</Button><Button variant="primary" disabled={!any} loading={go.isPending && go.variables === true} onClick={() => go.mutate(true)}>{t('transfers.markInTransit')}</Button></>}>
      <table className="mb-4 w-full text-[13px]">
        <thead><tr className="text-left text-xs text-muted"><th className="py-1 font-medium">{t('transfers.product')}</th><th className="py-1 text-right font-medium">{t('transfers.toShip')}</th><th className="w-28 py-1 font-medium">{t('transfers.quantity')}</th></tr></thead>
        <tbody>{lines.map((l) => (
          <tr key={l.id} className="border-t border-line"><td className="py-1.5">{l.title}</td><td className="py-1.5 text-right">{l.processableQuantity}</td>
            <td className="py-1.5"><input type="number" min={0} max={l.processableQuantity} aria-label={`${t('transfers.quantity')} ${l.title}`} className="field-control w-24" value={value(l)} onChange={(e) => setQty({ ...qty, [l.id]: e.target.value })} /></td></tr>
        ))}</tbody>
      </table>
      <div className="grid gap-3 sm:grid-cols-2">
        <Input label={t('transfers.carrier')} value={trk.company} onChange={(e) => setTrk({ ...trk, company: e.target.value })} />
        <Input label={t('transfers.trackingNumber')} value={trk.trackingNumber} onChange={(e) => setTrk({ ...trk, trackingNumber: e.target.value })} />
        <Input label={t('transfers.trackingUrl')} type="url" placeholder="https://" value={trk.trackingUrl} onChange={(e) => setTrk({ ...trk, trackingUrl: e.target.value })} />
        <Input label={t('transfers.expectedArrival')} type="date" value={trk.arrivesAt} onChange={(e) => setTrk({ ...trk, arrivesAt: e.target.value })} />
      </div>
    </Modal>
  );
}
