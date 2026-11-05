import { Button, Checkbox, Input, Modal, Select, Textarea, useToast } from '@shopme/ui';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { gql, mutate } from '../../api';
import { useFormat } from '../../components/shared';
import type { MoneySet } from '../../components/shared';
import { FULFILLMENT_CREATE, LOCATIONS, ORDER_CANCEL, REFUND_CREATE } from '../../graphql';
import { useT } from '../../i18n';
import type { Key } from '../../i18n';
import { calcRefund, clampQuantity, fromCents, toCents } from '../../lib/refund';
import type { RefundLine } from '../../lib/refund';
import { parseDecimal } from '../../format';

export interface OrderLine {
  id: string; title: string; variantTitle: string | null; sku: string | null; quantity: number; refundableQuantity: number; unfulfilledQuantity: number;
  originalUnitPriceSet: MoneySet; discountedTotalSet: MoneySet; variant: { id: string; image: { url: string } | null } | null;
}

const QtyInput = ({ label, value, max, onChange }: { label: string; value: number; max: number; onChange: (n: number) => void }) => (
  <input type="number" aria-label={label} min={0} max={max} value={value} onChange={(e) => onChange(Math.max(0, Math.min(max, Math.floor(Number(e.target.value) || 0))))} className="w-16 rounded-md border border-line bg-canvas px-2 py-1 text-sm" />
);

function useRun(done: () => void, ok: Key) {
  const t = useT();
  const toast = useToast();
  return { toast, t, onSuccess: () => { toast(t(ok)); done(); }, onError: (e: Error) => toast(e.message, 'critical') };
}

export function FulfillDialog({ open, onClose, orderId, lines, onDone }: { open: boolean; onClose: () => void; orderId: string; lines: OrderLine[]; onDone: () => void }) {
  const t = useT();
  const [qty, setQty] = useState<Record<string, number>>(() => Object.fromEntries(lines.map((l) => [l.id, l.unfulfilledQuantity])));
  const [company, setCompany] = useState(''); const [number, setNumber] = useState(''); const [url, setUrl] = useState(''); const [notify, setNotify] = useState(true);
  const picked = lines.filter((l) => (qty[l.id] ?? 0) > 0);
  const [locationId, setLocationId] = useState('');
  const locs = useQuery({ queryKey: ['locations'], queryFn: () => gql<{ locations: { nodes: Array<{ id: string; name: string; isActive: boolean; fulfillsOnlineOrders: boolean }> } }>(LOCATIONS) });
  const places = (locs.data?.locations.nodes ?? []).filter((l) => l.isActive);
  const run = useRun(() => { onDone(); onClose(); }, 'order.fulfilled');
  const m = useMutation({
    mutationFn: () => mutate(FULFILLMENT_CREATE, {
      fulfillment: {
        orderId, notifyCustomer: notify, ...(locationId && { locationId }), lineItems: picked.map((l) => ({ id: l.id, quantity: qty[l.id] })),
        ...((company || number || url) && { trackingInfo: { company: company || null, number: number || null, url: url || null } }),
      },
    }, 'fulfillmentCreate'),
    onSuccess: run.onSuccess, onError: run.onError,
  });
  return (
    <Modal open={open} onClose={onClose} title={t('order.fulfillTitle')} closeLabel={t('common.close')} wide
      footer={<><Button onClick={onClose}>{t('common.cancel')}</Button><Button variant="primary" loading={m.isPending} disabled={!picked.length} onClick={() => m.mutate()}>{t('order.markFulfilled')}</Button></>}>
      <div className="flex flex-col gap-4">
        <ul className="divide-y divide-line">
          {lines.map((l) => (
            <li key={l.id} className="flex items-center gap-3 py-2 text-sm">
              <span className="flex-1">{l.title}{l.variantTitle && <span className="text-muted"> · {l.variantTitle}</span>}</span>
              <QtyInput label={`${t('order.quantity')} ${l.title}`} value={qty[l.id] ?? 0} max={l.unfulfilledQuantity} onChange={(n) => setQty({ ...qty, [l.id]: n })} />
              <span className="text-muted">/ {l.unfulfilledQuantity}</span>
            </li>
          ))}
        </ul>
        {places.length > 1 && (
          <Select label={t('order.fulfillFrom')} help={t('order.fulfillFromHelp')} value={locationId} onChange={(e) => setLocationId(e.target.value)}>
            <option value="">{t('order.fulfillFromAuto')}</option>
            {places.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </Select>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <Input label={t('order.trackingCompany')} value={company} onChange={(e) => setCompany(e.target.value)} />
          <Input label={t('order.trackingNumber')} value={number} onChange={(e) => setNumber(e.target.value)} />
          <Input label={t('order.trackingUrl')} className="sm:col-span-2" type="url" value={url} onChange={(e) => setUrl(e.target.value)} />
        </div>
        <Checkbox label={t('order.notifyCustomer')} checked={notify} onChange={(e) => setNotify(e.target.checked)} />
      </div>
    </Modal>
  );
}

export function RefundDialog({ open, onClose, orderId, lines, shipping, refundableCents, onDone }: { open: boolean; onClose: () => void; orderId: string; lines: OrderLine[]; shipping: MoneySet; refundableCents: number; onDone: () => void }) {
  const t = useT();
  const fmt = useFormat();
  const [qty, setQty] = useState<Record<string, number>>({});
  const [ship, setShip] = useState('0');
  const [restock, setRestock] = useState(true); const [notify, setNotify] = useState(true); const [note, setNote] = useState('');
  const cur = shipping.shopMoney.currencyCode;
  const shippingCents = toCents(shipping.shopMoney.amount);
  const rl: RefundLine[] = lines.map((l) => ({ id: l.id, quantity: l.quantity, refundableQuantity: l.refundableQuantity, discountedTotalCents: toCents(l.discountedTotalSet.shopMoney.amount) }));
  const shipCents = Math.round((parseDecimal(ship) ?? 0) * 100);
  const r = calcRefund({ lines: rl, quantities: qty, shippingRefundCents: shipCents, shippingCents, refundableCents });
  const money = (c: number) => fmt.money({ amount: fromCents(c), currencyCode: cur });
  const run = useRun(() => { onDone(); onClose(); }, 'order.refunded');
  const m = useMutation({
    mutationFn: () => mutate(REFUND_CREATE, {
      input: {
        orderId, note: note || null, notify,
        refundLineItems: lines.filter((l) => clampQuantity(rl.find((x) => x.id === l.id)!, qty[l.id] ?? 0) > 0).map((l) => ({ lineItemId: l.id, quantity: qty[l.id], restockType: restock ? 'RETURN' : 'NO_RESTOCK' })),
        ...(r.shippingCents > 0 && { shipping: { amount: fromCents(r.shippingCents) } }),
      },
    }, 'refundCreate'),
    onSuccess: run.onSuccess, onError: run.onError,
  });
  return (
    <Modal open={open} onClose={onClose} title={t('order.refundTitle')} closeLabel={t('common.close')} wide
      footer={<><Button onClick={onClose}>{t('common.cancel')}</Button><Button variant="primary" loading={m.isPending} disabled={r.totalCents <= 0} onClick={() => m.mutate()}>{t('order.refundAmount', { amount: money(r.totalCents) })}</Button></>}>
      <div className="flex flex-col gap-4">
        <ul className="divide-y divide-line">
          {lines.filter((l) => l.refundableQuantity > 0).map((l) => (
            <li key={l.id} className="flex items-center gap-3 py-2 text-sm">
              <span className="flex-1">{l.title}{l.variantTitle && <span className="text-muted"> · {l.variantTitle}</span>}</span>
              <QtyInput label={`${t('order.quantity')} ${l.title}`} value={qty[l.id] ?? 0} max={l.refundableQuantity} onChange={(n) => setQty({ ...qty, [l.id]: n })} />
              <span className="text-muted">/ {l.refundableQuantity}</span>
            </li>
          ))}
        </ul>
        <Input label={t('order.refundShipping', { max: money(shippingCents) })} inputMode="decimal" value={ship} onChange={(e) => setShip(e.target.value)} />
        <Checkbox label={t('order.restock')} checked={restock} onChange={(e) => setRestock(e.target.checked)} />
        <Checkbox label={t('order.notifyCustomer')} checked={notify} onChange={(e) => setNotify(e.target.checked)} />
        <Textarea label={t('order.refundNote')} value={note} onChange={(e) => setNote(e.target.value)} />
        <dl className="grid grid-cols-[1fr_auto] gap-1 rounded-md bg-surface p-3 text-sm">
          <dt>{t('order.itemsSubtotal')}</dt><dd>{money(r.itemsCents)}</dd>
          <dt>{t('order.shipping')}</dt><dd>{money(r.shippingCents)}</dd>
          <dt className="font-semibold">{t('order.refundTotal')}</dt><dd className="font-semibold">{money(r.totalCents)}</dd>
          {r.capped && <dd className="col-span-2 text-xs text-warning">{t('order.refundCapped', { max: money(refundableCents) })}</dd>}
        </dl>
      </div>
    </Modal>
  );
}

const REASONS = ['CUSTOMER', 'INVENTORY', 'FRAUD', 'DECLINED', 'STAFF', 'OTHER'];
export function CancelDialog({ open, onClose, orderId, onDone }: { open: boolean; onClose: () => void; orderId: string; onDone: () => void }) {
  const t = useT();
  const [reason, setReason] = useState('CUSTOMER'); const [restock, setRestock] = useState(true); const [refund, setRefund] = useState(true); const [notify, setNotify] = useState(false); const [note, setNote] = useState('');
  const run = useRun(() => { onDone(); onClose(); }, 'order.cancelled');
  const m = useMutation({
    mutationFn: () => mutate(ORDER_CANCEL, { orderId, reason, refund, restock, notifyCustomer: notify, staffNote: note || null }, 'orderCancel'),
    onSuccess: run.onSuccess, onError: run.onError,
  });
  return (
    <Modal open={open} onClose={onClose} title={t('order.cancelTitle')} closeLabel={t('common.close')}
      footer={<><Button onClick={onClose}>{t('order.keep')}</Button><Button variant="danger" loading={m.isPending} onClick={() => m.mutate()}>{t('order.cancelConfirm')}</Button></>}>
      <div className="flex flex-col gap-3">
        <p className="text-sm text-muted">{t('order.cancelBody')}</p>
        <Select label={t('order.cancelReason')} value={reason} onChange={(e) => setReason(e.target.value)}>{REASONS.map((r) => <option key={r} value={r}>{t(`order.reason.${r}` as Key)}</option>)}</Select>
        <Checkbox label={t('order.refundPayment')} checked={refund} onChange={(e) => setRefund(e.target.checked)} />
        <Checkbox label={t('order.restock')} checked={restock} onChange={(e) => setRestock(e.target.checked)} />
        <Checkbox label={t('order.notifyCustomer')} checked={notify} onChange={(e) => setNotify(e.target.checked)} />
        <Textarea label={t('order.staffNote')} value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
    </Modal>
  );
}
