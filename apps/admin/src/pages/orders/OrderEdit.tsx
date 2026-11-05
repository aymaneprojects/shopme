import { Badge, Banner, Button, Card, Checkbox, Input, Modal, Skeleton, useToast } from '@shopme/ui';
import { useMutation } from '@tanstack/react-query';
import { Inbox, Percent, Plus, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { UserErrors, mutate } from '../../api';
import { IconHeading, PageTitle, SideSection, TopBar, TwoColumn } from '../../components/OrderChrome';
import { useFormat } from '../../components/shared';
import type { MoneySet } from '../../components/shared';
import { numToGid, parseDecimal } from '../../format';
import { ORDER_EDIT_ADD_CUSTOM_ITEM, ORDER_EDIT_ADD_SHIPPING, ORDER_EDIT_ADD_LINE_ITEM_DISCOUNT, ORDER_EDIT_ADD_VARIANT, ORDER_EDIT_SET_ORDER_DISCOUNT, ORDER_EDIT_BEGIN, ORDER_EDIT_COMMIT, ORDER_EDIT_DISCARD, ORDER_EDIT_SET_QUANTITY } from '../../graphql';
import { useT } from '../../i18n';
import { Thumb } from '../Products';
import { VariantDialog } from './Drafts';

interface CLine {
  id: string; title: string; variantTitle: string | null; sku: string | null; quantity: number; editableQuantity: number; editableQuantityBeforeChanges: number; hasStagedLineItemDiscount: boolean;
  variant?: { id: string } | null; image: { url: string } | null; originalUnitPriceSet: MoneySet; discountedUnitPriceSet: MoneySet; editableSubtotalSet: MoneySet;
}
interface Calc { id: string; shopmeShippingFeeSet: MoneySet; shopmeOrderDiscountSet: MoneySet; shopmeShippingFeeTitle: string | null; shopmeOrderDiscountDescription: string | null; totalPriceSet: MoneySet; subtotalPriceSet: MoneySet | null; totalOutstandingSet: MoneySet; lineItems: { nodes: CLine[] }; originalOrder?: { id: string; name: string } }
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
  const [panel, setPanel] = useState<'custom' | 'discount' | 'shipping' | null>(null);
  const [custom, setCustom] = useState({ title: '', price: '', quantity: '1', taxable: true, requiresShipping: false });
  const [odKind, setOdKind] = useState<'percent' | 'amount'>('percent');
  const [odValue, setOdValue] = useState('');
  const [odReason, setOdReason] = useState('');
  const [feeTitle, setFeeTitle] = useState('');
  const [feePrice, setFeePrice] = useState('');
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
  const done = (p: Payload) => { apply(p); setPanel(null); };
  const addCustom = useMutation({
    mutationFn: (cur: string) => mutate<Payload>(ORDER_EDIT_ADD_CUSTOM_ITEM, { id: calc!.id, title: custom.title.trim(), price: { amount: String(parseDecimal(custom.price) ?? 0), currencyCode: cur }, quantity: Math.max(1, Math.floor(Number(custom.quantity) || 1)), taxable: custom.taxable, requiresShipping: custom.requiresShipping }, 'orderEditAddCustomItem'),
    onSuccess: (p) => { done(p); setCustom({ title: '', price: '', quantity: '1', taxable: true, requiresShipping: false }); }, onError: (e) => setError(errText(e)),
  });
  const setOrderDiscount = useMutation({
    mutationFn: (v: { clear?: boolean; cur: string }) => mutate<Payload>(ORDER_EDIT_SET_ORDER_DISCOUNT, { id: calc!.id, discount: v.clear ? null : { description: odReason.trim() || t('orderEdit.discountLabel'), ...(odKind === 'percent' ? { percentValue: parseDecimal(odValue) ?? 0 } : { fixedValue: { amount: String(parseDecimal(odValue) ?? 0), currencyCode: v.cur } }) } }, 'shopmeOrderEditSetOrderDiscount'),
    onSuccess: (p, v) => { done(p); if (v.clear) { setOdValue(''); setOdReason(''); } }, onError: (e) => setError(errText(e)),
  });
  const setFee = useMutation({
    mutationFn: (v: { clear?: boolean; cur: string }) => mutate<Payload>(ORDER_EDIT_ADD_SHIPPING, { id: calc!.id, shippingLine: { title: feeTitle.trim() || t('btn.edit.feeDefault'), price: { amount: v.clear ? '0' : String(parseDecimal(feePrice) ?? 0), currencyCode: v.cur } } }, 'orderEditAddShippingLine'),
    onSuccess: (p, v) => { done(p); if (v.clear) { setFeeTitle(''); setFeePrice(''); } }, onError: (e) => setError(errText(e)),
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
  const busy = setQty.isPending || addVariant.isPending || addCustom.isPending || setOrderDiscount.isPending || setFee.isPending;
  const orderDiscount = Number(calc.shopmeOrderDiscountSet.shopMoney.amount);
  const shippingFee = Number(calc.shopmeShippingFeeSet.shopMoney.amount);

  const changes = lines.filter((l) => l.editableQuantity !== l.editableQuantityBeforeChanges || l.hasStagedLineItemDiscount);
  const total = Number(calc.totalPriceSet.shopMoney.amount);
  const paid = Math.max(0, total - outstanding);
  const m = (n: number) => fmt.money({ amount: String(n), currencyCode: cur });

  return (
    <>
      <TopBar back={`/orders/${id}`} onBack={() => void cancel()} icon={<Inbox />} crumbs={[{ label: t('nav.orders'), to: '/orders' }, { label: orderName }]} />
      <TwoColumn
        main={<>
          <PageTitle>{t('qa.editOrderTitle')}</PageTitle>
          {error && <Banner>{error}</Banner>}
          <section>
            <IconHeading icon={<Inbox />} tone="attention" actions={<><Button size="sm" onClick={() => setPanel('custom')}><Plus className="size-3.5" />{t('btn.edit.customItem')}</Button><Button size="sm" onClick={() => setAdding(true)}><Plus className="size-3.5" />{t('draft.productBtn')}</Button></>}>{t('order.items')}</IconHeading>
            <Card className="!p-0">
              <ul className="divide-y divide-line px-4">
                {lines.map((l) => {
                  const locked = l.quantity - l.editableQuantity;
                  return (
                    <li key={l.id} className="flex flex-wrap items-center gap-3 py-3 text-[13px]">
                      <Thumb url={l.image?.url} className="size-9" />
                      <div className="min-w-0 flex-1">
                        <p className="font-medium">{l.title}</p>
                        {(l.variantTitle || l.sku) && <p className="mt-0.5 flex flex-wrap gap-1 text-xs text-muted">{[l.variantTitle, l.sku].filter(Boolean).map((x) => <span key={x} className="rounded-md bg-surface px-1.5">{x}</span>)}</p>}
                        {l.hasStagedLineItemDiscount && <Badge tone="info">{t('orderEdit.discounted')}</Badge>}
                        {locked > 0 && <p className="text-xs text-muted">{t('orderEdit.fulfilledLocked', { n: locked })}</p>}
                      </div>
                      <span className="text-accent">{fmt.money(l.originalUnitPriceSet)}</span>
                      <input type="number" aria-label={`${t('order.quantity')} ${l.title}`} min={locked} value={l.quantity} disabled={busy}
                        onChange={(e) => setQty.mutate({ line: l.id, quantity: Math.max(locked, Math.floor(Number(e.target.value) || 0)) })} className="field-control w-16" />
                      <span className="w-20 text-right">{fmt.money(l.editableSubtotalSet)}</span>
                      <Button size="sm" variant="plain" icon aria-label={`${t('orderEdit.discount')} ${l.title}`} onClick={() => setDiscountFor(l)}><Percent className="size-4" /></Button>
                      <Button size="sm" variant="plain" icon className="btn-neutral" aria-label={`${t('common.remove')} ${l.title}`} disabled={busy || l.quantity <= locked} onClick={() => setQty.mutate({ line: l.id, quantity: locked })}><X className="size-4" /></Button>
                    </li>
                  );
                })}
              </ul>
            </Card>
            <div className="mt-3"><Checkbox label={t('orderEdit.restock')} checked={restock} onChange={(e) => setRestock(e.target.checked)} /></div>
          </section>
          <section>
            <h2 className="mb-2 text-sm font-semibold">{t('order.payment')}</h2>
            <Card className="overflow-hidden !p-0">
              <dl className="grid grid-cols-[1fr_auto] gap-x-6 gap-y-2 px-4 py-3.5 text-[13px]">
                <dt>{t('order.subtotal')}</dt><dd className="text-right text-muted">{fmt.money(calc.subtotalPriceSet)}</dd>
                <dt>{orderDiscount > 0 ? <span className="flex items-center gap-1">{calc.shopmeOrderDiscountDescription ?? t('order.discount')}<button type="button" aria-label={t('common.remove')} className="grid size-5 place-items-center rounded hover:bg-hover" onClick={() => setOrderDiscount.mutate({ clear: true, cur })}><X className="size-3" /></button></span> : <button type="button" className="text-accent hover:underline" onClick={() => setPanel('discount')}>{t('btn.edit.addDiscount')}</button>}</dt><dd className="text-right text-muted">{orderDiscount > 0 ? `−${m(orderDiscount)}` : ''}</dd>
                <dt>{shippingFee > 0 ? <span className="flex items-center gap-1">{calc.shopmeShippingFeeTitle ?? t('order.shipping')}<button type="button" aria-label={t('common.remove')} className="grid size-5 place-items-center rounded hover:bg-hover" onClick={() => setFee.mutate({ clear: true, cur })}><X className="size-3" /></button></span> : <button type="button" className="text-accent hover:underline" onClick={() => setPanel('shipping')}>{t('btn.edit.addShipping')}</button>}</dt><dd className="text-right text-muted">{shippingFee > 0 ? m(shippingFee) : ''}</dd>
                <dt className="font-semibold">{t('order.total')}</dt><dd className="text-right font-semibold">{fmt.money(calc.totalPriceSet)}</dd>
              </dl>
              <dl className="grid grid-cols-[1fr_auto] gap-x-6 gap-y-2 border-t border-line px-4 py-3.5 text-[13px]">
                <dt>{t('order.paid')}</dt><dd className="text-right text-muted">{m(paid)}</dd>
                {outstanding !== 0 && <><dt className={outstanding < 0 ? 'text-critical' : ''}>{outstanding < 0 ? t('orderEdit.refundOwed') : t('orderEdit.paymentDue')}</dt><dd className="text-right">{m(Math.abs(outstanding))}</dd></>}
              </dl>
              <p className="bg-surface px-4 py-3 text-[13px] text-muted">{t('orderEdit.taxNote')}</p>
            </Card>
          </section>
          <section>
            <h2 className="mb-2 text-sm font-semibold">{t('orderEdit.reason')}</h2>
            <Card>
              <Input aria-label={t('orderEdit.reason')} value={note} onChange={(e) => setNote(e.target.value)} />
              <p className="mt-2 text-xs text-muted">{t('orderEdit.reasonHelp')}</p>
            </Card>
          </section>
        </>}
        side={
          <SideSection title={t('orderEdit.summary')}>
            {changes.length === 0 && orderDiscount === 0 && shippingFee === 0 ? <p className="text-muted">{t('orderEdit.noChanges')}</p> : (
              <ul className="flex flex-col gap-1">
                {changes.map((l) => <li key={l.id} className="flex justify-between gap-2"><span className="truncate">{l.title}</span><span className="text-muted">{l.editableQuantityBeforeChanges} → {l.editableQuantity}</span></li>)}
                {orderDiscount > 0 && <li className="flex justify-between gap-2"><span className="truncate">{calc.shopmeOrderDiscountDescription ?? t('order.discount')}</span><span className="text-muted">−{m(orderDiscount)}</span></li>}
                {shippingFee > 0 && <li className="flex justify-between gap-2"><span className="truncate">{calc.shopmeShippingFeeTitle ?? t('order.shipping')}</span><span className="text-muted">+{m(shippingFee)}</span></li>}
              </ul>
            )}
            <Button variant="primary" className="mt-3 w-full" disabled={busy || (changes.length === 0 && orderDiscount === 0 && shippingFee === 0)} onClick={() => setConfirm(true)}>{t('orderEdit.update')}</Button>
            <p className="mt-3 text-xs text-muted">{t('orderEdit.help')}</p>
          </SideSection>} />
      <VariantDialog open={adding} onClose={() => setAdding(false)} excludeVariantIds={lines.flatMap((l) => (l.variant ? [l.variant.id] : []))} onAdd={(ls) => ls.forEach((l) => l.variantId && addVariant.mutate(l.variantId))} />
      <Modal open={!!discountFor} onClose={() => setDiscountFor(null)} title={t('orderEdit.discount')} closeLabel={t('common.close')}
        footer={<><Button onClick={() => setDiscountFor(null)}>{t('common.cancel')}</Button><Button variant="primary" loading={addDiscount.isPending} disabled={!((parseDecimal(percent) ?? 0) > 0)} onClick={() => addDiscount.mutate()}>{t('draft.add')}</Button></>}>
        <Input label={t('orderEdit.percent')} inputMode="decimal" value={percent} onChange={(e) => setPercent(e.target.value)} />
      </Modal>
      <Modal open={panel === 'custom'} onClose={() => setPanel(null)} title={t('btn.edit.customItem')} closeLabel={t('common.close')}
        footer={<><Button onClick={() => setPanel(null)}>{t('common.cancel')}</Button><Button variant="primary" loading={addCustom.isPending} disabled={!custom.title.trim() || parseDecimal(custom.price) == null} onClick={() => addCustom.mutate(cur)}>{t('draft.add')}</Button></>}>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2"><Input label={t('field.title')} value={custom.title} maxLength={255} onChange={(e) => setCustom({ ...custom, title: e.target.value })} /></div>
          <Input label={t('order.price')} inputMode="decimal" value={custom.price} onChange={(e) => setCustom({ ...custom, price: e.target.value })} />
          <Input label={t('order.quantity')} type="number" min={1} value={custom.quantity} onChange={(e) => setCustom({ ...custom, quantity: e.target.value })} />
          <Checkbox label={t('btn.edit.taxable')} checked={custom.taxable} onChange={(e) => setCustom({ ...custom, taxable: e.target.checked })} />
          <Checkbox label={t('btn.edit.requiresShipping')} checked={custom.requiresShipping} onChange={(e) => setCustom({ ...custom, requiresShipping: e.target.checked })} />
        </div>
      </Modal>
      <Modal open={panel === 'discount'} onClose={() => setPanel(null)} title={t('btn.edit.addDiscount')} closeLabel={t('common.close')}
        footer={<><Button onClick={() => setPanel(null)}>{t('common.cancel')}</Button><Button variant="primary" loading={setOrderDiscount.isPending} disabled={!((parseDecimal(odValue) ?? 0) > 0)} onClick={() => setOrderDiscount.mutate({ cur })}>{t('draft.add')}</Button></>}>
        <div className="grid gap-3">
          <div role="group" aria-label={t('btn.edit.discountType')} className="flex gap-2">
            {(['percent', 'amount'] as const).map((k) => <Button key={k} size="sm" variant={odKind === k ? 'primary' : 'secondary'} aria-pressed={odKind === k} onClick={() => setOdKind(k)}>{k === 'percent' ? '%' : cur}</Button>)}
          </div>
          <Input label={odKind === 'percent' ? t('orderEdit.percent') : t('btn.edit.discountAmount')} inputMode="decimal" value={odValue} onChange={(e) => setOdValue(e.target.value)} />
          <Input label={t('btn.edit.discountReason')} maxLength={100} value={odReason} onChange={(e) => setOdReason(e.target.value)} />
        </div>
      </Modal>
      <Modal open={panel === 'shipping'} onClose={() => setPanel(null)} title={t('btn.edit.addShipping')} closeLabel={t('common.close')}
        footer={<><Button onClick={() => setPanel(null)}>{t('common.cancel')}</Button><Button variant="primary" loading={setFee.isPending} disabled={!((parseDecimal(feePrice) ?? 0) > 0)} onClick={() => setFee.mutate({ cur })}>{t('draft.add')}</Button></>}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Input label={t('btn.edit.feeName')} maxLength={100} placeholder={t('btn.edit.feeDefault')} value={feeTitle} onChange={(e) => setFeeTitle(e.target.value)} />
          <Input label={t('order.price')} inputMode="decimal" value={feePrice} onChange={(e) => setFeePrice(e.target.value)} />
        </div>
      </Modal>
      <Modal open={confirm} onClose={() => setConfirm(false)} title={t('orderEdit.confirmTitle')} closeLabel={t('common.close')}
        footer={<><Button onClick={() => setConfirm(false)}>{t('common.cancel')}</Button><Button variant="primary" loading={commit.isPending} onClick={() => commit.mutate()}>{t('orderEdit.update')}</Button></>}>
        <div className="flex flex-col gap-3">
          <p className="text-[13px]">{outstanding < 0 ? t('orderEdit.confirmRefund', { amount: fmt.money({ amount: String(-outstanding), currencyCode: cur }) }) : outstanding > 0 ? t('orderEdit.confirmDue', { amount: fmt.money({ amount: String(outstanding), currencyCode: cur }) }) : t('orderEdit.confirmNone')}</p>
          <Checkbox label={t('order.notifyCustomer')} checked={notify} onChange={(e) => setNotify(e.target.checked)} />
        </div>
      </Modal>
    </>
  );
}
