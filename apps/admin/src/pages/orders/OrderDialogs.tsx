import { Button, Checkbox, Input, Modal, Select, Textarea, useToast } from '@shopme/ui';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { gql, mutate } from '../../api';
import type { MoneySet } from '../../components/shared';
import { FULFILLMENT_CREATE, FULFILLMENT_ORDER_HOLD, FULFILLMENT_TRACKING_UPDATE, LOCATIONS, ORDER_CANCEL, ORDER_UPDATE } from '../../graphql';
import { useT } from '../../i18n';
import type { Key } from '../../i18n';

export interface OrderLine {
  id: string; title: string; variantTitle: string | null; sku: string | null; quantity: number; refundableQuantity: number; unfulfilledQuantity: number; requiresShipping?: boolean;
  originalUnitPriceSet: MoneySet; discountedTotalSet: MoneySet; variant: { id: string; image: { url: string } | null } | null;
}

const QtyInput = ({ label, value, max, onChange }: { label: string; value: number; max: number; onChange: (n: number) => void }) => (
  <input type="number" aria-label={label} min={0} max={max} value={value} onChange={(e) => onChange(Math.max(0, Math.min(max, Math.floor(Number(e.target.value) || 0))))} className="w-16 field-control" />
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
            <li key={l.id} className="flex items-center gap-3 py-2 text-[13px]">
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
        <p className="text-[13px] text-muted">{t('order.cancelBody')}</p>
        <Select label={t('order.cancelReason')} value={reason} onChange={(e) => setReason(e.target.value)}>{REASONS.map((r) => <option key={r} value={r}>{t(`order.reason.${r}` as Key)}</option>)}</Select>
        <Checkbox label={t('order.refundPayment')} checked={refund} onChange={(e) => setRefund(e.target.checked)} />
        <Checkbox label={t('order.restock')} checked={restock} onChange={(e) => setRestock(e.target.checked)} />
        <Checkbox label={t('order.notifyCustomer')} checked={notify} onChange={(e) => setNotify(e.target.checked)} />
        <Textarea label={t('order.staffNote')} value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
    </Modal>
  );
}

export interface AddressValue { firstName: string | null; lastName: string | null; company: string | null; address1: string | null; address2: string | null; city: string | null; provinceCode: string | null; zip: string | null; countryCodeV2: string | null; phone: string | null }

/** Edit the shipping or billing address of an order (orderUpdate). */
export function AddressDialog({ open, onClose, orderId, value, onDone, kind = 'shipping' }: { open: boolean; onClose: () => void; orderId: string; value: AddressValue | null; onDone: () => void; kind?: 'shipping' | 'billing' }) {
  const t = useT();
  const [f, setF] = useState<Record<string, string>>(() => Object.fromEntries(Object.entries(value ?? {}).map(([k, v]) => [k, v ?? ''])));
  const set = (k: string) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const run = useRun(() => { onDone(); onClose(); }, 'order.updated');
  const m = useMutation({
    mutationFn: () => mutate(ORDER_UPDATE, {
      input: { id: orderId, [kind === 'billing' ? 'billingAddress' : 'shippingAddress']: {
        firstName: f.firstName || null, lastName: f.lastName || null, company: f.company || null, address1: f.address1 || null, address2: f.address2 || null,
        city: f.city || null, provinceCode: f.provinceCode || null, zip: f.zip || null, phone: f.phone || null, ...(f.countryCodeV2 && { countryCode: f.countryCodeV2.toUpperCase() }),
      } },
    }, 'orderUpdate'),
    onSuccess: run.onSuccess, onError: run.onError,
  });
  return (
    <Modal open={open} onClose={onClose} title={t(kind === 'billing' ? 'order.billingEdit' : 'order.shippingEdit')} closeLabel={t('common.close')} wide
      footer={<><Button onClick={onClose}>{t('common.cancel')}</Button><Button variant="primary" loading={m.isPending} onClick={() => m.mutate()}>{t('save.save')}</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Input label={t('order.addr.firstName')} value={f.firstName ?? ''} onChange={set('firstName')} />
        <Input label={t('order.addr.lastName')} value={f.lastName ?? ''} onChange={set('lastName')} />
        <Input label={t('order.addr.company')} className="sm:col-span-2" value={f.company ?? ''} onChange={set('company')} />
        <Input label={t('order.addr.address1')} className="sm:col-span-2" value={f.address1 ?? ''} onChange={set('address1')} />
        <Input label={t('order.addr.address2')} className="sm:col-span-2" value={f.address2 ?? ''} onChange={set('address2')} />
        <Input label={t('order.addr.city')} value={f.city ?? ''} onChange={set('city')} />
        <Input label={t('order.addr.zip')} value={f.zip ?? ''} onChange={set('zip')} />
        <Input label={t('order.addr.province')} value={f.provinceCode ?? ''} onChange={set('provinceCode')} />
        <Input label={t('order.addr.country')} maxLength={2} value={f.countryCodeV2 ?? ''} onChange={set('countryCodeV2')} />
        <Input label={t('order.addr.phone')} className="sm:col-span-2" value={f.phone ?? ''} onChange={set('phone')} />
      </div>
    </Modal>
  );
}

export interface FulfillmentValue { id: string; name: string; shopmeNotifyCustomer: boolean; trackingInfo: Array<{ company: string | null; number: string | null; url: string | null }> }

/** Edit the tracking details of a fulfillment (fulfillmentTrackingInfoUpdate). */
export function TrackingDialog({ open, onClose, fulfillment: f, onDone }: { open: boolean; onClose: () => void; fulfillment: FulfillmentValue; onDone: () => void }) {
  const t = useT();
  const first = f.trackingInfo[0];
  const [company, setCompany] = useState(first?.company ?? ''); const [number, setNumber] = useState(first?.number ?? ''); const [url, setUrl] = useState(first?.url ?? '');
  const [notify, setNotify] = useState(f.shopmeNotifyCustomer);
  const run = useRun(() => { onDone(); onClose(); }, 'ful.trackingSaved');
  const m = useMutation({
    mutationFn: () => mutate(FULFILLMENT_TRACKING_UPDATE, {
      fulfillmentId: f.id, notifyCustomer: notify,
      trackingInfoInput: { company: company || null, numbers: number ? [number] : [], urls: url ? [url] : [] },
    }, 'fulfillmentTrackingInfoUpdate'),
    onSuccess: run.onSuccess, onError: run.onError,
  });
  return (
    <Modal open={open} onClose={onClose} title={t('ful.trackingTitle', { name: f.name })} closeLabel={t('common.close')}
      footer={<><Button onClick={onClose}>{t('common.cancel')}</Button><Button variant="primary" loading={m.isPending} onClick={() => m.mutate()}>{t('save.save')}</Button></>}>
      <div className="grid gap-3">
        <Input label={t('order.trackingCompany')} value={company} onChange={(e) => setCompany(e.target.value)} />
        <Input label={t('order.trackingNumber')} value={number} onChange={(e) => setNumber(e.target.value)} />
        <Input label={t('order.trackingUrl')} type="url" value={url} onChange={(e) => setUrl(e.target.value)} />
        <Checkbox label={t('order.notifyCustomer')} checked={notify} onChange={(e) => setNotify(e.target.checked)} />
      </div>
    </Modal>
  );
}

export const HOLD_REASON_LIST = ['AWAITING_PAYMENT', 'HIGH_RISK_OF_FRAUD', 'INCORRECT_ADDRESS', 'INVENTORY_OUT_OF_STOCK', 'UNKNOWN_DELIVERY_DATE', 'AWAITING_RETURN_ITEMS', 'OTHER'] as const;

/** Put the fulfillment of an order on hold, with a reason (fulfillmentOrderHold). */
export function HoldDialog({ open, onClose, orderId, onDone }: { open: boolean; onClose: () => void; orderId: string; onDone: () => void }) {
  const t = useT();
  const [reason, setReason] = useState<string>('AWAITING_PAYMENT'); const [notes, setNotes] = useState('');
  const run = useRun(() => { onDone(); onClose(); }, 'hold.held');
  const m = useMutation({
    mutationFn: () => mutate(FULFILLMENT_ORDER_HOLD, { id: orderId, fulfillmentHold: { reason, reasonNotes: notes || null } }, 'fulfillmentOrderHold'),
    onSuccess: run.onSuccess, onError: run.onError,
  });
  return (
    <Modal open={open} onClose={onClose} title={t('hold.title')} closeLabel={t('common.close')}
      footer={<><Button onClick={onClose}>{t('common.cancel')}</Button><Button variant="primary" loading={m.isPending} onClick={() => m.mutate()}>{t('hold.confirm')}</Button></>}>
      <div className="grid gap-3">
        <Select label={t('hold.reason')} value={reason} onChange={(e) => setReason(e.target.value)}>
          {HOLD_REASON_LIST.map((r) => <option key={r} value={r}>{t(`hold.reason.${r}` as Key)}</option>)}
        </Select>
        <Textarea label={t('hold.notes')} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>
    </Modal>
  );
}
