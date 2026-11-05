import { Badge, Button, Card, Checkbox, Modal, Select, useToast } from '@shopme/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { gql, mutate } from '../../api';
import { useFormat } from '../../components/shared';
import { ORDER_RETURNS, RETURN_APPROVE_REQUEST, RETURN_CLOSE, RETURN_CREATE } from '../../graphql';
import { useT } from '../../i18n';
import type { Key } from '../../i18n';

const REASONS = ['UNKNOWN', 'SIZE_TOO_SMALL', 'SIZE_TOO_LARGE', 'UNWANTED', 'NOT_AS_DESCRIBED', 'WRONG_ITEM', 'DEFECTIVE', 'STYLE', 'COLOR', 'OTHER'];
interface ReturnsData {
  order: {
    id: string; returnStatus: string;
    lineItems: { nodes: Array<{ id: string; title: string; variantTitle: string | null; shopmeReturnableQuantity: number }> };
    returns: { nodes: Array<{ id: string; name: string; status: string; createdAt: string; totalQuantity: number; returnLineItems: { nodes: Array<{ quantity: number; returnReason: string; shopmeTitle?: string; shopmeVariantTitle?: string | null; shopmeRestockType?: string; shopmeRestocked?: boolean }> } }> };
  } | null;
}
const tone = { REQUESTED: 'warning', OPEN: 'info', CLOSED: 'success', DECLINED: 'neutral', CANCELED: 'neutral' } as const;

export const useReturns = (orderId: string) => useQuery({ queryKey: ['order-returns', orderId], queryFn: () => gql<ReturnsData>(ORDER_RETURNS, { id: orderId }) });

/** Returns of an order: status, items, and the approve / close actions. */
export function ReturnsCard({ orderId }: { orderId: string }) {
  const t = useT();
  const fmt = useFormat();
  const toast = useToast();
  const qc = useQueryClient();
  const q = useReturns(orderId);
  const refresh = () => { void qc.invalidateQueries({ queryKey: ['order-returns'] }); void qc.invalidateQueries({ queryKey: ['order'] }); };
  const act = useMutation({
    mutationFn: ({ id, kind }: { id: string; kind: 'approve' | 'close' }) => (kind === 'approve' ? mutate(RETURN_APPROVE_REQUEST, { input: { id } }, 'returnApproveRequest') : mutate(RETURN_CLOSE, { id }, 'returnClose')),
    onSuccess: () => { toast(t('returns.updated')); refresh(); }, onError: (e) => toast(e.message, 'critical'),
  });
  const rs = q.data?.order?.returns.nodes ?? [];
  if (!rs.length) return null;
  return (
    <Card title={t('returns.title')}>
      <ul className="flex flex-col gap-3">
        {rs.map((r) => (
          <li key={r.id} className="text-[13px]">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{r.name}</span><Badge tone={tone[r.status as keyof typeof tone] ?? 'neutral'}>{t(`returns.status.${r.status}` as Key)}</Badge>
              <span className="text-muted">{fmt.date(r.createdAt)}</span>
              <span className="ml-auto flex gap-2">
                {r.status === 'REQUESTED' && <Button size="sm" loading={act.isPending} onClick={() => act.mutate({ id: r.id, kind: 'approve' })}>{t('returns.approve')}</Button>}
                {r.status === 'OPEN' && <Button size="sm" variant="primary" loading={act.isPending} onClick={() => act.mutate({ id: r.id, kind: 'close' })}>{t('returns.close')}</Button>}
              </span>
            </div>
            <ul className="mt-1 text-muted">
              {r.returnLineItems.nodes.map((l, i) => <li key={i}>{l.quantity} × {l.shopmeTitle}{l.shopmeVariantTitle ? ` · ${l.shopmeVariantTitle}` : ''} — {t(`returns.reason.${l.returnReason}` as Key)}{l.shopmeRestockType === 'RETURN' ? ` · ${t(l.shopmeRestocked ? 'returns.restocked' : 'returns.willRestock')}` : ''}</li>)}
            </ul>
          </li>
        ))}
      </ul>
    </Card>
  );
}

export function ReturnDialog({ open, onClose, orderId, onDone }: { open: boolean; onClose: () => void; orderId: string; onDone: () => void }) {
  const t = useT();
  const toast = useToast();
  const q = useReturns(orderId);
  const lines = (q.data?.order?.lineItems.nodes ?? []).filter((l) => l.shopmeReturnableQuantity > 0);
  const [qty, setQty] = useState<Record<string, number>>({});
  const [reason, setReason] = useState<Record<string, string>>({});
  const [restock, setRestock] = useState(true);
  const picked = lines.filter((l) => (qty[l.id] ?? 0) > 0);
  const create = useMutation({
    mutationFn: () => mutate(RETURN_CREATE, {
      returnInput: { orderId, returnLineItems: picked.map((l) => ({ fulfillmentLineItemId: l.id, quantity: qty[l.id], returnReason: reason[l.id] ?? 'UNKNOWN', shopmeRestock: restock })) },
    }, 'returnCreate'),
    onSuccess: () => { toast(t('returns.created')); onDone(); onClose(); }, onError: (e) => toast(e.message, 'critical'),
  });
  return (
    <Modal open={open} onClose={onClose} title={t('returns.createTitle')} closeLabel={t('common.close')} wide
      footer={<><Button onClick={onClose}>{t('common.cancel')}</Button><Button variant="primary" loading={create.isPending} disabled={!picked.length} onClick={() => create.mutate()}>{t('returns.create')}</Button></>}>
      <div className="flex flex-col gap-4">
        {q.isLoading ? <p className="text-[13px] text-muted">{t('common.loading')}</p> : lines.length === 0 ? <p className="text-[13px] text-muted">{t('returns.nothing')}</p> : (
          <ul className="divide-y divide-line">
            {lines.map((l) => (
              <li key={l.id} className="flex flex-wrap items-center gap-3 py-2 text-[13px]">
                <span className="min-w-0 flex-1">{l.title}{l.variantTitle && <span className="text-muted"> · {l.variantTitle}</span>}</span>
                <input type="number" aria-label={`${t('order.quantity')} ${l.title}`} min={0} max={l.shopmeReturnableQuantity} value={qty[l.id] ?? 0}
                  onChange={(e) => setQty({ ...qty, [l.id]: Math.max(0, Math.min(l.shopmeReturnableQuantity, Math.floor(Number(e.target.value) || 0))) })} className="h-8 w-16 rounded-md border border-line bg-field px-2 text-[13px]" />
                <span className="text-muted">/ {l.shopmeReturnableQuantity}</span>
                <Select aria-label={`${t('returns.reasonLabel')} ${l.title}`} value={reason[l.id] ?? 'UNKNOWN'} onChange={(e) => setReason({ ...reason, [l.id]: e.target.value })}>
                  {REASONS.map((r) => <option key={r} value={r}>{t(`returns.reason.${r}` as Key)}</option>)}
                </Select>
              </li>
            ))}
          </ul>
        )}
        <Checkbox label={t('returns.restock')} checked={restock} onChange={(e) => setRestock(e.target.checked)} />
        <p className="text-xs text-muted">{t('returns.help')}</p>
      </div>
    </Modal>
  );
}
