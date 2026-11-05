import { Badge, Banner, Button, Card, Checkbox, Input, Modal, Skeleton, Textarea, useToast } from '@shopme/ui';
import { useMutation } from '@tanstack/react-query';
import { Percent, Plus } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { UserErrors, mutate } from '../../api';
import { PageHeader } from '../../components/PageHeader';
import { useFormat } from '../../components/shared';
import type { MoneySet } from '../../components/shared';
import { numToGid, parseDecimal } from '../../format';
import { ORDER_EDIT_ADD_LINE_ITEM_DISCOUNT, ORDER_EDIT_ADD_VARIANT, ORDER_EDIT_BEGIN, ORDER_EDIT_COMMIT, ORDER_EDIT_DISCARD, ORDER_EDIT_SET_QUANTITY } from '../../graphql';
import { useT } from '../../i18n';
import { Thumb } from '../Products';
import { VariantDialog } from './Drafts';

interface CLine {
  id: string; title: string; variantTitle: string | null; sku: string | null; quantity: number; editableQuantity: number; editableQuantityBeforeChanges: number; hasStagedLineItemDiscount: boolean;
  image: { url: string } | null; originalUnitPriceSet: MoneySet; discountedUnitPriceSet: MoneySet; editableSubtotalSet: MoneySet;
}
interface Calc { id: string; totalPriceSet: MoneySet; subtotalPriceSet: MoneySet | null; totalOutstandingSet: MoneySet; lineItems: { nodes: CLine[] }; originalOrder?: { id: string; name: string } }
type Payload = { calculatedOrder: Calc | null };

/** Order edit session: every change is sent to the server, which recalculates; nothing touches the order until "Update order". */
export function OrderEditPage() {
  const { id = '' } = useParams();
  const t = useT();
  const nav = useNavigate();
  const fmt = useFormat();
  const toast = useToast();
  const orderGid = numToGid('Order', id);
  const [calc, setCalc] = useState<Calc | null>(null);
  const [orderName, setOrderName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [restock, setRestock] = useState(true);
  const [discountFor, setDiscountFor] = useState<CLine | null>(null);
  const [percent, setPercent] = useState('');
  const [adding, setAdding] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [note, setNote] = useState('');
  const [notify, setNotify] = useState(false);
  const started = useRef(false);
  const errText = (e: unknown) => (e instanceof UserErrors ? e.errors.map((x) => x.message).join(' · ') : (e as Error).message);

  const begin = useMutation({
    mutationFn: () => mutate<{ calculatedOrder: Calc }>(ORDER_EDIT_BEGIN, { id: orderGid }, 'orderEditBegin'),
    onSuccess: (p) => { setCalc(p.calculatedOrder); setOrderName(p.calculatedOrder.originalOrder?.name ?? ''); }, onError: (e) => setError(errText(e)),
  });
  useEffect(() => { if (!started.current) { started.current = true; begin.mutate(); } }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const apply = (p: Payload) => { if (p.calculatedOrder) setCalc(p.calculatedOrder); setError(null); };
  const setQty = useMutation({
    mutationFn: (v: { line: string; quantity: number }) => mutate<Payload>(ORDER_EDIT_SET_QUANTITY, { id: calc!.id, lineItemId: v.line, quantity: v.quantity, restock }, 'orderEditSetQuantity'),
    onSuccess: apply, onError: (e) => setError(errText(e)),
  });
  const addVariant = useMutation({
    mutationFn: (variantId: string) => mutate<Payload>(ORDER_EDIT_ADD_VARIANT, { id: calc!.id, variantId, quantity: 1 }, 'orderEditAddVariant'),
    onSuccess: apply, onError: (e) => setError(errText(e)),
  });
  const addDiscount = useMutation({
    mutationFn: () => mutate<Payload>(ORDER_EDIT_ADD_LINE_ITEM_DISCOUNT, { id: calc!.id, lineItemId: discountFor!.id, discount: { description: t('orderEdit.discountLabel'), percentValue: parseDecimal(percent) ?? 0 } }, 'orderEditAddLineItemDiscount'),
    onSuccess: (p) => { apply(p); setDiscountFor(null); setPercent(''); }, onError: (e) => setError(errText(e)),
  });
  const commit = useMutation({
    mutationFn: () => mutate(ORDER_EDIT_COMMIT, { id: calc!.id, notifyCustomer: notify, staffNote: note.trim() || null }, 'orderEditCommit'),
    onSuccess: () => { toast(t('orderEdit.updated')); nav(`/orders/${id}`); }, onError: (e) => { setConfirm(false); setError(errText(e)); },
  });
  const cancel = async () => { if (calc) await mutate(ORDER_EDIT_DISCARD, { id: calc.id }, 'shopmeOrderEditDiscard').catch(() => undefined); nav(`/orders/${id}`); };

  if (begin.isError && !calc) return <Banner>{error}</Banner>;
  if (!calc) return <div className="grid gap-4"><Skeleton className="h-8 w-64" /><Skeleton className="h-64" /></div>;
  const lines = calc.lineItems.nodes;
  const outstanding = Number(calc.totalOutstandingSet.shopMoney.amount);
  const cur = calc.totalOutstandingSet.shopMoney.currencyCode;
  const busy = setQty.isPending || addVariant.isPending;

  return (
    <>
      <PageHeader back={`/orders/${id}`} title={t('orderEdit.title', { name: orderName })}
        actions={<><Button onClick={() => void cancel()}>{t('common.cancel')}</Button><Button variant="primary" disabled={busy} onClick={() => setConfirm(true)}>{t('orderEdit.review')}</Button></>} />
      {error && <div className="mb-4"><Banner>{error}</Banner></div>}
      <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
        <Card title={t('order.items')} actions={<Button size="sm" onClick={() => setAdding(true)}><Plus className="size-4" />{t('orderEdit.addProduct')}</Button>}>
          <ul className="divide-y divide-line">
            {lines.map((l) => {
              const locked = l.quantity - l.editableQuantity;
              return (
                <li key={l.id} className="flex flex-wrap items-center gap-3 py-2 text-[13px]">
                  <Thumb url={l.image?.url} />
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{l.title}</p>
                    <p className="text-xs text-muted">{[l.variantTitle, l.sku].filter(Boolean).join(' · ')}</p>
                    {l.hasStagedLineItemDiscount && <Badge tone="info">{t('orderEdit.discounted')}</Badge>}
                    {locked > 0 && <p className="text-xs text-muted">{t('orderEdit.fulfilledLocked', { n: locked })}</p>}
                  </div>
                  <span className="text-muted">{fmt.money(l.originalUnitPriceSet)}</span>
                  <input type="number" aria-label={`${t('order.quantity')} ${l.title}`} min={locked} value={l.quantity} disabled={busy}
                    onChange={(e) => setQty.mutate({ line: l.id, quantity: Math.max(locked, Math.floor(Number(e.target.value) || 0)) })} className="h-8 w-16 rounded-md border border-line bg-field px-2 text-[13px]" />
                  <span className="w-24 text-right">{fmt.money(l.editableSubtotalSet)}</span>
                  <Button size="sm" aria-label={`${t('orderEdit.discount')} ${l.title}`} onClick={() => setDiscountFor(l)}><Percent className="size-4" /></Button>
                  <Button size="sm" aria-label={`${t('common.remove')} ${l.title}`} disabled={busy || l.quantity <= locked} onClick={() => setQty.mutate({ line: l.id, quantity: locked })}>{t('common.remove')}</Button>
                </li>
              );
            })}
          </ul>
          <div className="mt-3"><Checkbox label={t('orderEdit.restock')} checked={restock} onChange={(e) => setRestock(e.target.checked)} /></div>
        </Card>
        <Card title={t('orderEdit.summary')}>
          <dl className="grid grid-cols-[1fr_auto] gap-x-6 gap-y-1 text-[13px]">
            <dt className="text-muted">{t('order.subtotal')}</dt><dd className="text-right">{fmt.money(calc.subtotalPriceSet)}</dd>
            <dt className="font-semibold">{t('orderEdit.newTotal')}</dt><dd className="text-right font-semibold">{fmt.money(calc.totalPriceSet)}</dd>
            <dt className={outstanding < 0 ? 'text-critical' : 'text-muted'}>{outstanding < 0 ? t('orderEdit.refundOwed') : t('orderEdit.paymentDue')}</dt>
            <dd className="text-right">{fmt.money({ amount: String(Math.abs(outstanding)), currencyCode: cur })}</dd>
          </dl>
          <p className="mt-3 text-xs text-muted">{t('orderEdit.help')}</p>
        </Card>
      </div>
      <VariantDialog open={adding} onClose={() => setAdding(false)} onAdd={(ls) => ls.forEach((l) => l.variantId && addVariant.mutate(l.variantId))} />
      <Modal open={!!discountFor} onClose={() => setDiscountFor(null)} title={t('orderEdit.discount')} closeLabel={t('common.close')}
        footer={<><Button onClick={() => setDiscountFor(null)}>{t('common.cancel')}</Button><Button variant="primary" loading={addDiscount.isPending} disabled={!((parseDecimal(percent) ?? 0) > 0)} onClick={() => addDiscount.mutate()}>{t('draft.add')}</Button></>}>
        <Input label={t('orderEdit.percent')} inputMode="decimal" value={percent} onChange={(e) => setPercent(e.target.value)} />
      </Modal>
      <Modal open={confirm} onClose={() => setConfirm(false)} title={t('orderEdit.confirmTitle')} closeLabel={t('common.close')}
        footer={<><Button onClick={() => setConfirm(false)}>{t('common.cancel')}</Button><Button variant="primary" loading={commit.isPending} onClick={() => commit.mutate()}>{t('orderEdit.update')}</Button></>}>
        <div className="flex flex-col gap-3">
          <p className="text-[13px]">{outstanding < 0 ? t('orderEdit.confirmRefund', { amount: fmt.money({ amount: String(-outstanding), currencyCode: cur }) }) : outstanding > 0 ? t('orderEdit.confirmDue', { amount: fmt.money({ amount: String(outstanding), currencyCode: cur }) }) : t('orderEdit.confirmNone')}</p>
          <Textarea label={t('order.staffNote')} value={note} onChange={(e) => setNote(e.target.value)} />
          <Checkbox label={t('order.notifyCustomer')} checked={notify} onChange={(e) => setNotify(e.target.checked)} />
        </div>
      </Modal>
    </>
  );
}
