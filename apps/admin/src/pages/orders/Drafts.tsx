import { Badge, Banner, Button, Card, ConfirmDialog, EmptyState, Input, Modal, Select, Skeleton, TagInput, Textarea, useToast } from '@shopme/ui';
import type { Column } from '@shopme/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { UserErrors, gql, mutate } from '../../api';
import { PageHeader } from '../../components/PageHeader';
import { PagedTable } from '../../components/PagedTable';
import { SaveBar, guard } from '../../components/SaveBar';
import { useFormat } from '../../components/shared';
import type { MoneySet } from '../../components/shared';
import { formatMoney, gidToNum, numToGid } from '../../format';
import { DRAFT_CUSTOMER_SEARCH, DRAFT_ORDER, DRAFT_ORDERS, DRAFT_ORDER_CALCULATE, DRAFT_ORDER_COMPLETE, DRAFT_ORDER_CREATE, DRAFT_ORDER_DELETE, DRAFT_ORDER_INVOICE_SEND, DRAFT_ORDER_UPDATE, DRAFT_VARIANT_SEARCH } from '../../graphql';
import { useI18n } from '../../i18n';
import type { Key } from '../../i18n';
import { blankDraft, estimateTotals, toDraftInput, totalsFromCalculation, totalsRows } from '../../lib/draft-order';
import type { CalculatedDraft, DraftForm, DraftLine } from '../../lib/draft-order';
import { useDebounced } from '../../lib/hooks';
import { useShop } from '../../session';
import emptyOrders from '../../assets/empty/empty-orders.webp';

const errText = (e: unknown) => (e instanceof UserErrors ? e.errors.map((x) => x.message).join(' · ') : (e as Error).message);
const statusTone = { OPEN: 'warning', INVOICE_SENT: 'info', COMPLETED: 'success' } as const;
const StatusBadge = ({ status }: { status: string }) => { const { t } = useI18n(); return <Badge tone={statusTone[status as keyof typeof statusTone] ?? 'neutral'}>{t(`draft.status.${status}` as Key)}</Badge>; };

interface DraftRow { id: string; name: string; status: string; createdAt: string; totalPriceSet: MoneySet; customer: { displayName: string } | null; email: string | null }

export function DraftsPage() {
  const { t } = useI18n();
  const nav = useNavigate();
  const fmt = useFormat();
  const columns: Array<Column<DraftRow>> = [
    { key: 'name', header: t('draft.draft'), cell: (d) => <span className="font-medium">{d.name}</span> },
    { key: 'date', header: t('draft.date'), cell: (d) => fmt.date(d.createdAt) },
    { key: 'cust', header: t('draft.customer'), cell: (d) => d.customer?.displayName ?? d.email ?? '—' },
    { key: 'status', header: t('field.status'), cell: (d) => <StatusBadge status={d.status} /> },
    { key: 'total', header: t('draft.total'), className: 'text-right', cell: (d) => fmt.money(d.totalPriceSet) },
  ];
  const add = <Button variant="primary" onClick={() => nav('/orders/drafts/new')}><Plus className="size-4" />{t('draft.create')}</Button>;
  return (
    <>
      <PageHeader back="/orders" title={t('draft.title')} actions={add} />
      <PagedTable<DraftRow> title={t('draft.title')} doc={DRAFT_ORDERS} root="draftOrders" queryKey="drafts" columns={columns} searchLabel={t('draft.search')}
        onRowClick={(r) => nav(`/orders/drafts/${gidToNum(r.id)}`)}
        empty={<EmptyState image={emptyOrders} title={t('draft.emptyTitle')} description={t('draft.emptyBody')} action={add} />} />
    </>
  );
}

interface DraftData {
  id: string; name: string; status: string; email: string | null; note2: string | null; tags: string[]; customer: { id: string; displayName: string } | null; order: { id: string; name: string } | null;
  appliedDiscount: { valueType: 'FIXED_AMOUNT' | 'PERCENTAGE'; value: number } | null; shippingLine: { title: string; originalPriceSet: MoneySet } | null;
  lineItems: { nodes: Array<{ id: string; title: string; variantTitle: string | null; quantity: number; variant: { id: string } | null; originalUnitPriceSet: MoneySet }> };
}

export function DraftEditPage() {
  const { id = 'new' } = useParams();
  const isNew = id === 'new';
  const { t } = useI18n();
  const gid = numToGid('DraftOrder', id);
  const q = useQuery({ queryKey: ['draft', gid], enabled: !isNew, queryFn: () => gql<{ draftOrder: DraftData | null }>(DRAFT_ORDER, { id: gid }) });
  if (!isNew && q.isLoading) return <Skeleton className="h-64" />;
  if (q.error) return <Banner>{q.error.message}</Banner>;
  if (!isNew && !q.data?.draftOrder) return <Banner>{t('draft.notFound')}</Banner>;
  const d = q.data?.draftOrder;
  const initial: DraftForm = d ? {
    lines: d.lineItems.nodes.map((l) => ({ key: l.id, variantId: l.variant?.id, title: l.title, variantTitle: l.variantTitle ?? undefined, price: l.originalUnitPriceSet.shopMoney.amount, quantity: l.quantity })),
    discount: d.appliedDiscount ? { valueType: d.appliedDiscount.valueType, value: String(d.appliedDiscount.value) } : null,
    shipping: d.shippingLine ? { title: d.shippingLine.title, price: d.shippingLine.originalPriceSet.shopMoney.amount } : null,
    customerId: d.customer?.id ?? '', email: d.email ?? '', note: d.note2 ?? '', tags: d.tags,
  } : blankDraft;
  return <DraftForm_ key={`${id}:${q.dataUpdatedAt}`} draft={d ?? null} initial={initial} />;
}

function DraftForm_({ draft, initial }: { draft: DraftData | null; initial: DraftForm }) {
  const { t, lang } = useI18n();
  const nav = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();
  const { shop } = useShop();
  const [form, setForm] = useState(initial);
  const [custLabel, setCustLabel] = useState(draft?.customer?.displayName ?? '');
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<'variant' | 'custom' | 'invoice' | 'delete' | 'complete' | null>(null);
  const id = draft?.id ?? null;
  const completed = draft?.status === 'COMPLETED';
  const set = (p: Partial<DraftForm>) => setForm((f) => ({ ...f, ...p }));
  const dirty = JSON.stringify(form) !== JSON.stringify(initial);
  const setLine = (key: string, p: Partial<DraftLine>) => set({ lines: form.lines.map((l) => (l.key === key ? { ...l, ...p } : l)) });

  const input = toDraftInput(form);
  const inputKey = useDebounced(JSON.stringify(input), 400);
  const calc = useQuery({
    queryKey: ['draft-calc', inputKey], enabled: form.lines.length > 0 && !completed, retry: false, placeholderData: (p) => p,
    queryFn: async () => (await mutate<{ calculatedDraftOrder: CalculatedDraft }>(DRAFT_ORDER_CALCULATE, { input: JSON.parse(inputKey) }, 'draftOrderCalculate')).calculatedDraftOrder,
  });
  const totals = calc.data && !calc.isError ? totalsFromCalculation(calc.data) : estimateTotals(form);
  const currency = totals.currency ?? shop.currency;
  const money = (n: number) => formatMoney(n, currency, lang);

  const invalidate = () => { void qc.invalidateQueries({ queryKey: ['drafts'] }); void qc.invalidateQueries({ queryKey: ['draft'] }); };
  const save = useMutation({
    mutationFn: async () => {
      if (!form.lines.length) throw new Error(t('draft.needLines'));
      setError(null);
      if (id) { await mutate(DRAFT_ORDER_UPDATE, { id, input }, 'draftOrderUpdate'); return id; }
      return (await mutate<{ draftOrder: { id: string } }>(DRAFT_ORDER_CREATE, { input }, 'draftOrderCreate')).draftOrder.id;
    },
    onSuccess: (did) => { toast(t('draft.saved')); invalidate(); if (!id) { guard.off = true; nav(`/orders/drafts/${gidToNum(did)}`, { replace: true }); } },
    onError: (e) => setError(errText(e)),
  });
  const complete = useMutation({
    mutationFn: (paymentPending: boolean) => mutate<{ draftOrder: { order: { id: string } } }>(DRAFT_ORDER_COMPLETE, { id, paymentPending }, 'draftOrderComplete'),
    onSuccess: (r) => { toast(t('draft.completed')); invalidate(); guard.off = true; nav(`/orders/${gidToNum(r.draftOrder.order.id)}`); }, onError: (e) => { setDialog(null); setError(errText(e)); },
  });
  const [invoiceTo, setInvoiceTo] = useState(form.email);
  const invoice = useMutation({
    mutationFn: () => mutate(DRAFT_ORDER_INVOICE_SEND, { id, email: { to: invoiceTo.trim() } }, 'draftOrderInvoiceSend'),
    onSuccess: () => { toast(t('draft.invoiceSent')); setDialog(null); invalidate(); }, onError: (e) => setError(errText(e)),
  });
  const del = useMutation({
    mutationFn: () => mutate(DRAFT_ORDER_DELETE, { input: { id } }, 'draftOrderDelete'),
    onSuccess: () => { invalidate(); guard.off = true; nav('/orders/drafts'); }, onError: (e) => { setDialog(null); toast(e.message, 'critical'); },
  });
  const busy = save.isPending || complete.isPending;
  const rows = totalsRows(totals, !!form.shipping);
  const field = 'field-control';

  return (
    <>
      <SaveBar dirty={dirty && !completed} saving={save.isPending} onSave={() => save.mutate()} onDiscard={() => { setForm(initial); setError(null); }} />
      <PageHeader back="/orders/drafts" title={draft ? draft.name : t('draft.create')}
        actions={<>
          {draft && !completed && <Button variant="danger" onClick={() => setDialog('delete')}>{t('common.delete')}</Button>}
          {draft && !completed && <Button disabled={dirty} onClick={() => { setInvoiceTo(form.email); setDialog('invoice'); }}>{t('draft.sendInvoice')}</Button>}
          {draft && !completed && <Button variant="primary" disabled={dirty || busy} onClick={() => setDialog('complete')}>{t('draft.markPaid')}</Button>}
          {!draft && <Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>{t('draft.saveDraft')}</Button>}
        </>} />
      {error && <div className="mb-4"><Banner>{error}</Banner></div>}
      {completed && draft?.order && <div className="mb-4"><Banner tone="info">{t('draft.completedBanner')} <Link className="underline" to={`/orders/${gidToNum(draft.order.id)}`}>{draft.order.name}</Link></Banner></div>}
      {draft && !completed && dirty && <p className="mb-2 text-xs text-muted">{t('draft.saveFirst')}</p>}
      <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
        <fieldset disabled={completed} className="flex min-w-0 flex-col gap-4">
          <Card title={t('draft.products')} actions={<div className="flex gap-2"><Button size="sm" onClick={() => setDialog('variant')}>{t('draft.addProduct')}</Button><Button size="sm" onClick={() => setDialog('custom')}>{t('draft.addCustom')}</Button></div>}>
            {form.lines.length === 0 ? <p className="text-[13px] text-muted">{t('draft.noLines')}</p> : (
              <ul className="divide-y divide-line">
                {form.lines.map((l) => (
                  <li key={l.key} className="flex flex-wrap items-center gap-3 py-2 text-[13px]">
                    <span className="min-w-0 flex-1"><span className="block truncate font-medium">{l.title}</span>{l.variantTitle && l.variantTitle !== 'Default Title' && <span className="text-xs text-muted">{l.variantTitle}</span>}{!l.variantId && <Badge>{t('draft.custom')}</Badge>}</span>
                    <span className="w-24 text-right">{money(Number(l.price.replace(',', '.')) || 0)}</span>
                    <input type="number" min={1} aria-label={`${t('draft.quantity')}: ${l.title}`} value={l.quantity} onChange={(e) => setLine(l.key, { quantity: Math.max(1, Math.floor(Number(e.target.value)) || 1) })} className={`${field} w-16`} />
                    <span className="w-24 text-right font-medium">{money((Number(l.price.replace(',', '.')) || 0) * l.quantity)}</span>
                    <button type="button" aria-label={`${t('common.remove')}: ${l.title}`} className="rounded p-1 text-muted hover:bg-surface" onClick={() => set({ lines: form.lines.filter((x) => x.key !== l.key) })}><Trash2 className="size-4" /></button>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card title={t('draft.adjustments')}>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-2">
                <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" className="accent-(--color-primary)" checked={!!form.discount} onChange={(e) => set({ discount: e.target.checked ? { valueType: 'PERCENTAGE', value: '' } : null })} />{t('draft.discount')}</label>
                {form.discount && <div className="flex gap-2">
                  <Select aria-label={t('draft.discountType')} value={form.discount.valueType} onChange={(e) => set({ discount: { ...form.discount!, valueType: e.target.value as 'FIXED_AMOUNT' | 'PERCENTAGE' } })}><option value="PERCENTAGE">%</option><option value="FIXED_AMOUNT">{currency}</option></Select>
                  <Input aria-label={t('draft.discountValue')} inputMode="decimal" value={form.discount.value} onChange={(e) => set({ discount: { ...form.discount!, value: e.target.value } })} />
                </div>}
              </div>
              <div className="flex flex-col gap-2">
                <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" className="accent-(--color-primary)" checked={!!form.shipping} onChange={(e) => set({ shipping: e.target.checked ? { title: t('draft.shippingDefault'), price: '0' } : null })} />{t('draft.shipping')}</label>
                {form.shipping && <div className="flex gap-2">
                  <Input aria-label={t('draft.shippingName')} value={form.shipping.title} onChange={(e) => set({ shipping: { ...form.shipping!, title: e.target.value } })} />
                  <Input aria-label={t('draft.shippingPrice')} inputMode="decimal" className="w-24" value={form.shipping.price} onChange={(e) => set({ shipping: { ...form.shipping!, price: e.target.value } })} />
                </div>}
              </div>
            </div>
          </Card>
          <Card title={t('draft.payment')}>
            <dl className="flex flex-col gap-1.5 text-[13px]" aria-live="polite">
              {rows.map((r) => (
                <div key={r.key} className={`flex justify-between ${r.key === 'total' ? 'border-t border-line pt-2 text-base font-semibold' : ''}`}>
                  <dt>{t(`draft.row.${r.key}` as Key)}</dt><dd>{r.free ? t('draft.free') : money(r.amount)}</dd>
                </div>
              ))}
            </dl>
            {calc.isError && form.lines.length > 0 && <p className="mt-2 text-xs text-muted">{t('draft.estimate')}</p>}
          </Card>
        </fieldset>
        <fieldset disabled={completed} className="flex flex-col gap-4">
          <Card title={t('draft.customer')}>
            <CustomerPick label={custLabel} onPick={(c) => { setCustLabel(c.displayName); set({ customerId: c.id, email: c.defaultEmailAddress?.emailAddress ?? form.email }); }} onClear={() => { setCustLabel(''); set({ customerId: '' }); }} />
            <Input className="mt-3" label={t('field.email')} type="email" value={form.email} onChange={(e) => set({ email: e.target.value })} />
          </Card>
          <Card title={t('draft.note')}><Textarea aria-label={t('draft.note')} value={form.note} onChange={(e) => set({ note: e.target.value })} /></Card>
          <Card title={t('field.tags')}><TagInput value={form.tags} onChange={(tags) => set({ tags })} removeLabel={t('common.remove')} /></Card>
        </fieldset>
      </div>
      <VariantDialog open={dialog === 'variant'} onClose={() => setDialog(null)} onAdd={(lines) => set({ lines: [...form.lines, ...lines] })} />
      <CustomDialog open={dialog === 'custom'} onClose={() => setDialog(null)} onAdd={(l) => set({ lines: [...form.lines, l] })} />
      <Modal open={dialog === 'invoice'} onClose={() => setDialog(null)} closeLabel={t('common.close')} title={t('draft.sendInvoice')}
        footer={<><Button onClick={() => setDialog(null)}>{t('common.cancel')}</Button><Button variant="primary" loading={invoice.isPending} disabled={!invoiceTo.includes('@')} onClick={() => invoice.mutate()}>{t('draft.send')}</Button></>}>
        <Input label={t('draft.invoiceTo')} type="email" value={invoiceTo} onChange={(e) => setInvoiceTo(e.target.value)} />
      </Modal>
      <Modal open={dialog === 'complete'} onClose={() => setDialog(null)} closeLabel={t('common.close')} title={t('draft.completeTitle')}
        footer={<><Button onClick={() => setDialog(null)}>{t('common.cancel')}</Button><Button loading={complete.isPending && complete.variables === true} onClick={() => complete.mutate(true)}>{t('draft.paymentPending')}</Button><Button variant="primary" loading={complete.isPending && complete.variables === false} onClick={() => complete.mutate(false)}>{t('draft.markPaid')}</Button></>}>
        <p className="text-[13px]">{t('draft.completeBody')}</p>
      </Modal>
      <ConfirmDialog open={dialog === 'delete'} danger onClose={() => setDialog(null)} title={t('draft.deleteTitle')} message={t('draft.deleteBody')} confirmLabel={t('common.delete')} cancelLabel={t('common.cancel')} onConfirm={() => del.mutate()} />
    </>
  );
}

interface CustomerHit { id: string; displayName: string; defaultEmailAddress: { emailAddress: string } | null }
function CustomerPick({ label, onPick, onClear }: { label: string; onPick: (c: CustomerHit) => void; onClear: () => void }) {
  const { t } = useI18n();
  const [search, setSearch] = useState('');
  const term = useDebounced(search).trim();
  const hits = useQuery({ queryKey: ['draft-customers', term], enabled: term.length > 1, queryFn: () => gql<{ customers: { nodes: CustomerHit[] } }>(DRAFT_CUSTOMER_SEARCH, { query: term }) });
  if (label) return <div className="flex items-center justify-between text-[13px]"><span className="font-medium">{label}</span><Button size="sm" onClick={onClear}>{t('common.remove')}</Button></div>;
  return (
    <div className="flex flex-col gap-1">
      <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('draft.searchCustomer')} aria-label={t('draft.searchCustomer')} className="field-control" />
      {term.length > 1 && (hits.data?.customers.nodes ?? []).map((c) => <button key={c.id} type="button" className="rounded px-2 py-1 text-left text-[13px] hover:bg-surface" onClick={() => { onPick(c); setSearch(''); }}>{c.displayName}{c.defaultEmailAddress && <span className="text-muted"> · {c.defaultEmailAddress.emailAddress}</span>}</button>)}
    </div>
  );
}

interface VariantHit { id: string; title: string; variants: { nodes: Array<{ id: string; title: string; price: string }> } }
export function VariantDialog({ open, onClose, onAdd }: { open: boolean; onClose: () => void; onAdd: (l: DraftLine[]) => void }) {
  const { t } = useI18n();
  const [search, setSearch] = useState('');
  const term = useDebounced(search).trim();
  const q = useQuery({ queryKey: ['draft-variants', term], enabled: open, queryFn: () => gql<{ products: { nodes: VariantHit[] } }>(DRAFT_VARIANT_SEARCH, { query: term || null }) });
  return (
    <Modal open={open} onClose={onClose} closeLabel={t('common.close')} title={t('draft.addProduct')} wide>
      <input type="search" autoFocus value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('products.search')} aria-label={t('products.search')} className="mb-3 w-full field-control" />
      {q.isLoading ? <p className="text-[13px] text-muted">{t('common.loading')}</p> : !q.data?.products.nodes.length ? <p className="text-[13px] text-muted">{t('picker.none')}</p> : (
        <ul className="divide-y divide-line">
          {q.data.products.nodes.flatMap((p) => p.variants.nodes.map((v) => (
            <li key={v.id} className="flex items-center gap-3 py-2 text-[13px]">
              <span className="flex-1">{p.title}{v.title !== 'Default Title' && <span className="text-muted"> · {v.title}</span>}</span>
              <span className="text-muted">{v.price}</span>
              <Button size="sm" aria-label={`${t('draft.add')}: ${p.title} ${v.title}`} onClick={() => { onAdd([{ key: `${v.id}:${Date.now()}`, variantId: v.id, title: p.title, variantTitle: v.title, price: v.price, quantity: 1 }]); onClose(); }}>{t('draft.add')}</Button>
            </li>
          )))}
        </ul>
      )}
    </Modal>
  );
}

function CustomDialog({ open, onClose, onAdd }: { open: boolean; onClose: () => void; onAdd: (l: DraftLine) => void }) {
  const { t } = useI18n();
  const [title, setTitle] = useState('');
  const [price, setPrice] = useState('');
  const [qty, setQty] = useState('1');
  const ok = !!title.trim() && Number(price.replace(',', '.')) >= 0 && price.trim() !== '';
  const submit = () => { onAdd({ key: `c:${Date.now()}`, title: title.trim(), price, quantity: Math.max(1, Math.floor(Number(qty)) || 1) }); setTitle(''); setPrice(''); setQty('1'); onClose(); };
  return (
    <Modal open={open} onClose={onClose} closeLabel={t('common.close')} title={t('draft.addCustom')}
      footer={<><Button onClick={onClose}>{t('common.cancel')}</Button><Button variant="primary" disabled={!ok} onClick={submit}>{t('draft.add')}</Button></>}>
      <div className="grid gap-3 sm:grid-cols-[1fr_6rem_5rem]">
        <Input label={t('field.title')} value={title} onChange={(e) => setTitle(e.target.value)} />
        <Input label={t('draft.price')} inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} />
        <Input label={t('draft.quantity')} type="number" min={1} value={qty} onChange={(e) => setQty(e.target.value)} />
      </div>
    </Modal>
  );
}

