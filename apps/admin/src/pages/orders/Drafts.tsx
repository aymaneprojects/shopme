import { Badge, Banner, Button, Card, ConfirmDialog, EmptyState, IndexTable, Input, ListToolbar, Modal, Pagination, Select, Skeleton, TagInput, Textarea, Tooltip, useToast } from '@shopme/ui';
import type { Column, ToolbarFilter } from '@shopme/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Info, PenLine, Plus, Search, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { UserErrors, gql, mutate } from '../../api';
import { PageHeader } from '../../components/PageHeader';
import { DraftCompanySection } from '../../components/CompanyOrderCards';
import { NoteCard } from '../../components/NoteCard';
import { PageTitle, SideSection, TopBar } from '../../components/OrderChrome';
import { ColumnPicker, useColumnVisibility } from '../../components/ColumnPicker';
import { VariantPicker } from '../../components/Pickers';
import { guard } from '../../components/SaveBar';
import { useFormat, useListParams } from '../../components/shared';
import type { MoneySet } from '../../components/shared';
import { ExportButton, exportHref, startDownload } from '../../components/CsvTools';
import { formatMoney, gidToNum, numToGid } from '../../format';
import { CUSTOMER_CREATE, DRAFT_MARKETS, DRAFT_CUSTOMER_SEARCH, DRAFT_ORDER, DRAFT_ORDERS, DRAFT_ORDER_CALCULATE, DRAFT_ORDER_COMPLETE, DRAFT_ORDER_CREATE, DRAFT_ORDER_DELETE, DRAFT_ORDER_INVOICE_SEND, DRAFT_ORDER_UPDATE } from '../../graphql';
import { useI18n } from '../../i18n';
import type { Key } from '../../i18n';
import { blankDraft, estimateTotals, toDraftInput, totalsFromCalculation } from '../../lib/draft-order';
import type { CalculatedDraft, DraftForm, DraftLine } from '../../lib/draft-order';
import { useDebounced } from '../../lib/hooks';
import type { Connection } from '../../lib/hooks';
import { useShop } from '../../session';
import emptyOrders from '../../assets/empty/empty-orders.webp';

const errText = (e: unknown) => (e instanceof UserErrors ? e.errors.map((x) => x.message).join(' · ') : (e as Error).message);
const statusTone = { OPEN: 'warning', INVOICE_SENT: 'info', COMPLETED: 'success' } as const;
const StatusBadge = ({ status }: { status: string }) => { const { t } = useI18n(); return <Badge tone={statusTone[status as keyof typeof statusTone] ?? 'neutral'}>{t(`draft.status.${status}` as Key)}</Badge>; };

interface DraftRow { id: string; name: string; status: string; createdAt: string; poNumber: string | null; tags: string[]; totalPriceSet: MoneySet; customer: { displayName: string } | null; email: string | null; shopmeMarket: { name: string } | null }
const DRAFT_VIEWS = ['all', 'OPEN', 'INVOICE_SENT', 'COMPLETED'] as const;

export function DraftsPage() {
  const { t } = useI18n();
  const nav = useNavigate();
  const fmt = useFormat();
  const toast = useToast();
  const qc = useQueryClient();
  const L = useListParams();
  const [removing, setRemoving] = useState<string[] | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [search, setSearch] = useState(L.get('q'));
  const term = useDebounced(search).trim();
  const cols = useColumnVisibility('drafts', ['market', 'tags']);
  const view = (DRAFT_VIEWS as readonly string[]).includes(L.get('view')) ? L.get('view') : 'all';
  const query = [term, view !== 'all' && `status:${view.toLowerCase()}`, L.get('po') && `po_number:"${L.get('po').replace(/"/g, '')}"`, L.get('tag') && `tag:"${L.get('tag').replace(/"/g, '')}"`].filter(Boolean).join(' ');
  const list = useQuery({
    queryKey: ['drafts', query, L.get('after'), L.get('before')], placeholderData: (p) => p,
    queryFn: async () => (await gql<{ draftOrders: Connection<DraftRow> }>(DRAFT_ORDERS, { query: query || null, ...L.page(25) })).draftOrders,
  });
  const rows = list.data?.nodes ?? [];
  const pi = list.data?.pageInfo;
  const columns: Array<Column<DraftRow>> = [
    { key: 'name', header: t('draft.draft'), cell: (d) => <span className="font-medium">{d.name}</span> },
    { key: 'date', header: t('draft.date'), cell: (d) => <span className="text-muted">{fmt.date(d.createdAt)}</span> },
    { key: 'cust', header: t('draft.customer'), cell: (d) => d.customer?.displayName ?? d.email ?? <span className="text-muted">{t('orders.noCustomer')}</span> },
    { key: 'po', header: t('btn.orders.col.po'), cell: (d) => d.poNumber ?? <span className="text-muted">—</span> },
    { key: 'market', header: t('btn.draft.market'), cell: (d) => d.shopmeMarket?.name ?? <span className="text-muted">—</span> },
    { key: 'tags', header: t('field.tags'), cell: (d) => <span className="text-muted">{d.tags.join(', ')}</span> },
    { key: 'status', header: t('field.status'), cell: (d) => <StatusBadge status={d.status} /> },
    { key: 'total', header: t('draft.total'), className: 'text-right', cell: (d) => fmt.money(d.totalPriceSet) },
  ];
  const filters: ToolbarFilter[] = [
    { key: 'po', label: t('btn.orders.col.po'), options: [], text: true },
    { key: 'tag', label: t('field.tags'), options: [], text: true },
  ];
  const del = useMutation({
    mutationFn: async (ids: string[]) => { for (const id of ids) await mutate(DRAFT_ORDER_DELETE, { input: { id } }, 'draftOrderDelete'); },
    onSuccess: (_d, ids) => { toast(t('draft.deletedMany', { n: ids.length, $count: ids.length })); setRemoving(null); setSelected([]); void qc.invalidateQueries({ queryKey: ['drafts'] }); },
    onError: (e) => { setRemoving(null); toast(e.message, 'critical'); },
  });
  const add = <Button variant="primary" onClick={() => nav('/orders/drafts/new')}>{t('draft.create')}</Button>;
  const hasFilters = !!query;
  return (
    <>
      <PageHeader title={t('draft.title')} actions={<><ExportButton kind="draft_orders" />{add}</>} />
      <Card className="!p-0">
        <ListToolbar
          className="!rounded-b-none !shadow-none border-b border-line"
          views={DRAFT_VIEWS.map((v) => ({ id: v, label: t(v === 'all' ? 'orders.tab.all' : (`draft.status.${v}` as Key)) }))} view={view} viewsLabel={t('btn.draft.view')}
          onView={(v) => { setSelected([]); L.patch({ view: v === 'all' ? '' : v }); }}
          query={search} onQuery={(v) => { setSearch(v); L.patch({ q: v }); }} placeholder={t('list.searchAndFilter')}
          filters={filters} values={{ po: L.get('po'), tag: L.get('tag') }} onFilter={(k, v) => L.patch({ [k]: v })} removeFilterLabel={t('list.removeFilter')}
          trailing={<ColumnPicker locked={['name']} columns={columns} hidden={cols.hidden} onToggle={cols.toggle} />}
        />
        {list.isError && <div className="p-3"><Banner>{(list.error as Error).message}</Banner></div>}
        <IndexTable rows={rows} rowId={(r) => r.id} columns={cols.filter(columns)} loading={list.isLoading} onRowClick={(r) => nav(`/orders/drafts/${gidToNum(r.id)}`)}
          selected={selected} onSelectedChange={setSelected} selectedLabel={(n) => t('common.selected', { n })} selectAllLabel={t('common.selectAll')}
          selectPageLabel={(n) => t('list.selectPage', { n })} deselectLabel={t('list.deselectAll')} showSelectedLabel={t('list.showSelected')}
          bulkActions={[{ key: 'export', label: t('draft.export'), onRun: (ids) => startDownload(exportHref('draft_orders', { ids: ids.map(gidToNum).join(',') })) }, { key: 'delete', label: t('draft.deleteSelected'), danger: true, onRun: (ids) => setRemoving(ids) }]}
          empty={list.isError ? null : hasFilters
            ? <EmptyState icon={<Search className="size-10" />} title={t('products.noResults')} description={t('products.noResultsBody')} action={<Button onClick={() => { setSearch(''); L.clear(); }}>{t('products.clearFilters')}</Button>} />
            : <EmptyState image={emptyOrders} title={t('draft.emptyTitle')} description={t('draft.emptyBody')} action={add} />} />
        <Pagination hasPrevious={L.get('before') ? !!pi?.hasPreviousPage : !!L.get('after')} hasNext={L.get('before') ? true : !!pi?.hasNextPage}
          previousLabel={t('common.previous')} nextLabel={t('common.next')}
          onPrevious={() => L.patch({ before: pi?.startCursor ?? '', after: '' }, true)} onNext={() => L.patch({ after: pi?.endCursor ?? '', before: '' }, true)} />
      </Card>
      <ConfirmDialog open={!!removing} danger loading={del.isPending} onClose={() => setRemoving(null)} closeLabel={t('common.close')}
        title={t('draft.deleteManyTitle', { n: removing?.length ?? 0, $count: removing?.length ?? 0 })} message={t('draft.deleteBody')} confirmLabel={t('common.delete')} cancelLabel={t('common.cancel')}
        onConfirm={() => removing && del.mutate(removing)} />
    </>
  );
}

interface DraftData {
  id: string; name: string; status: string; email: string | null; note2: string | null; tags: string[]; poNumber: string | null; shopmeMarket: { id: string; name: string; currencyCode: string } | null; customer: { id: string; displayName: string } | null; order: { id: string; name: string } | null;
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
    customerId: d.customer?.id ?? '', email: d.email ?? '', note: d.note2 ?? '', tags: d.tags, poNumber: d.poNumber ?? '', marketId: d.shopmeMarket?.id ?? '',
  } : blankDraft;
  return <DraftForm_ key={`${id}:${q.dataUpdatedAt}`} draft={d ?? null} initial={initial} />;
}

function DraftForm_({ draft, initial }: { draft: DraftData | null; initial: DraftForm }) {
  const { t, lang } = useI18n();
  const nav = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();
  const { shop } = useShop();
  const fmt = useFormat();
  const [form, setForm] = useState(initial);
  const [custLabel, setCustLabel] = useState(draft?.customer?.displayName ?? '');
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<'variant' | 'custom' | 'invoice' | 'delete' | 'complete' | null>(null);
  const id = draft?.id ?? null;
  const completed = draft?.status === 'COMPLETED';
  const set = (p: Partial<DraftForm>) => setForm((f) => ({ ...f, ...p }));
  const saved = useRef(JSON.stringify(initial));
  const dirty = JSON.stringify(form) !== saved.current;
  const [custOpen, setCustOpen] = useState(false);
  const markets = useQuery({ queryKey: ['draft-markets'], staleTime: 60_000, queryFn: () => gql<{ markets: { nodes: Array<{ id: string; name: string; status: string; currencySettings: { baseCurrency: { currencyCode: string } | null } | null }> }; shop: { currencyCode: string } }>(DRAFT_MARKETS) });
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
      saved.current = JSON.stringify(form);
      if (id) { await mutate(DRAFT_ORDER_UPDATE, { id, input }, 'draftOrderUpdate'); return id; }
      return (await mutate<{ draftOrder: { id: string } }>(DRAFT_ORDER_CREATE, { input }, 'draftOrderCreate')).draftOrder.id;
    },
    onSuccess: (did) => { void qc.invalidateQueries({ queryKey: ['drafts'] }); if (!id) { guard.off = true; nav(`/orders/drafts/${gidToNum(did)}`, { replace: true }); } },
    onError: (e) => { saved.current = JSON.stringify(initial); setError(errText(e)); },
  });
  // Autosave: a moment after the last change the draft is created (once it has a line) or updated.
  const formKey = JSON.stringify(form);
  useEffect(() => {
    if (completed || !dirty || !form.lines.length || save.isPending) return;
    const timer = setTimeout(() => save.mutate(), id ? 1200 : 2500);
    return () => clearTimeout(timer);
  }, [formKey, completed, save.isPending]); // eslint-disable-line react-hooks/exhaustive-deps
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
  const field = 'field-control';

  return (
    <>
      <TopBar back="/orders/drafts" icon={<PenLine />} crumbs={[{ label: t('draft.title'), to: '/orders/drafts' }, ...(draft ? [{ label: draft.name }] : [])]}
        actions={<>
          {draft && !completed && <Button variant="danger" onClick={() => setDialog('delete')}>{t('common.delete')}</Button>}
          {draft && !completed && <Button disabled={dirty || save.isPending} onClick={() => { setInvoiceTo(form.email); setDialog('invoice'); }}>{t('draft.sendInvoice')}</Button>}
          {draft && !completed && <Button variant="primary" disabled={dirty || busy} onClick={() => setDialog('complete')}>{t('draft.markPaid')}</Button>}
        </>} />
      <div className="mx-auto max-w-[890px]"><PageTitle>{draft ? draft.name : t('draft.create')}</PageTitle></div>
      {error && <div className="mb-4"><Banner>{error}</Banner></div>}
      {completed && draft?.order && <div className="mb-4"><Banner tone="info">{t('draft.completedBanner')} <Link className="underline" to={`/orders/${gidToNum(draft.order.id)}`}>{draft.order.name}</Link></Banner></div>}
      {!completed && <p className="mx-auto mb-2 max-w-[890px] text-xs text-muted" role="status">{save.isPending ? t('btn.draft.saving') : dirty ? (form.lines.length ? t('btn.draft.pending') : t('btn.draft.addToSave')) : draft ? t('btn.draft.saved') : t('btn.draft.addToSave')}</p>}
      <div className="mx-auto mt-4 grid max-w-[890px] gap-x-10 gap-y-4 lg:grid-cols-[minmax(0,1fr)_14.375rem]">
        <fieldset disabled={completed} className="flex min-w-0 flex-col gap-4">
          <section><div className="mb-2 flex min-h-8 items-center justify-between"><h2 className="text-sm font-semibold">{t('draft.products')}</h2>{form.lines.length > 0 && <div className="flex gap-2"><Button size="sm" onClick={() => setDialog('variant')}>{t('draft.productBtn')}</Button><Button size="sm" onClick={() => setDialog('custom')}>{t('draft.customBtn')}</Button></div>}</div>
            <Card>
            {form.lines.length === 0 ? (
              <div className="flex flex-wrap items-center justify-center gap-2 rounded-lg border border-dashed border-line px-4 py-5">
                <Button size="sm" onClick={() => setDialog('variant')}><Plus className="size-3.5" />{t('draft.productBtn')}</Button>
                <Button size="sm" onClick={() => setDialog('custom')}><Plus className="size-3.5" />{t('draft.customBtn')}</Button>
              </div>
            ) : (
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
          </Card></section>
          <section><h2 className="mb-2 text-sm font-semibold">{t('draft.payment')}</h2>
          <Card>
            <dl className="flex flex-col gap-1.5 text-[13px]" aria-live="polite">
              <div className="flex justify-between"><dt>{t('draft.row.subtotal')}</dt><dd>{money(totals.subtotal)}</dd></div>
              <div className="flex justify-between"><dt>{form.discount ? t('draft.row.discount') : <button type="button" className="text-accent hover:underline" onClick={() => set({ discount: { valueType: 'PERCENTAGE', value: '' } })}>{t('draft.discount')}</button>}</dt><dd className={form.discount ? '' : 'text-muted'}>{money(-totals.discount)}</dd></div>
              <div className="flex justify-between"><dt>{form.shipping ? t('draft.row.shipping') : <button type="button" className="text-accent hover:underline" onClick={() => set({ shipping: { title: t('draft.shippingDefault'), price: '0' } })}>{t('draft.shipping')}</button>}</dt><dd className={form.shipping ? '' : 'text-muted'}>{form.shipping && totals.shipping === 0 ? t('draft.free') : money(totals.shipping)}</dd></div>
              <div className="flex justify-between"><dt className="flex items-center gap-1">{t('btn.draft.estimatedTax')}<Tooltip content={t('btn.draft.taxHelp')}><span tabIndex={0} aria-label={t('btn.draft.taxHelp')} className="text-muted"><Info className="size-3.5" /></span></Tooltip></dt><dd className={totals.tax > 0 ? '' : 'text-muted'}>{totals.tax > 0 || calc.data ? money(totals.tax) : t('btn.draft.taxNotCalculated')}</dd></div>
              <div className="flex justify-between border-t border-line pt-2 text-base font-semibold"><dt>{t('draft.row.total')}</dt><dd>{money(totals.total)}</dd></div>
              {calc.data?.shopmePresentmentTotalSet && form.marketId && <div className="flex justify-between text-xs text-muted"><dt>{t('btn.draft.presentment')}</dt><dd>≈ {fmt.money(calc.data.shopmePresentmentTotalSet)}</dd></div>}
            </dl>
            {form.discount && (
              <div className="mt-3 flex items-end gap-2">
                <Select label={t('draft.discount')} value={form.discount.valueType} onChange={(e) => set({ discount: { ...form.discount!, valueType: e.target.value as 'FIXED_AMOUNT' | 'PERCENTAGE' } })}><option value="PERCENTAGE">%</option><option value="FIXED_AMOUNT">{currency}</option></Select>
                <Input aria-label={t('draft.discountValue')} inputMode="decimal" value={form.discount.value} onChange={(e) => set({ discount: { ...form.discount!, value: e.target.value } })} />
                <Button size="sm" aria-label={`${t('common.remove')}: ${t('draft.discount')}`} onClick={() => set({ discount: null })}>{t('common.remove')}</Button>
              </div>
            )}
            {form.shipping && (
              <div className="mt-3 flex items-end gap-2">
                <Input label={t('draft.shipping')} aria-label={t('draft.shippingName')} value={form.shipping.title} onChange={(e) => set({ shipping: { ...form.shipping!, title: e.target.value } })} />
                <Input aria-label={t('draft.shippingPrice')} inputMode="decimal" className="w-24" value={form.shipping.price} onChange={(e) => set({ shipping: { ...form.shipping!, price: e.target.value } })} />
                <Button size="sm" aria-label={`${t('common.remove')}: ${t('draft.shipping')}`} onClick={() => set({ shipping: null })}>{t('common.remove')}</Button>
              </div>
            )}
            {form.lines.length === 0 && <p className="-mx-4 -mb-4 mt-3 rounded-b-lg bg-surface px-4 py-3 text-[13px] text-muted">{t('draft.addToCalculate')}</p>}
            {calc.isError && form.lines.length > 0 && <p className="mt-2 text-xs text-muted">{t('draft.estimate')}</p>}
          </Card></section>
        </fieldset>
        <fieldset disabled={completed} className="flex min-w-0 flex-col">
          <NoteCard side title={t('draft.note')} value={form.note} placeholder={t('draft.notePlaceholder')} onSave={(note) => set({ note })} />
          <SideSection title={t('draft.customer')}>
            <CustomerPick label={custLabel} onPick={(c) => { setCustLabel(c.displayName); set({ customerId: c.id, email: c.defaultEmailAddress?.emailAddress ?? form.email }); }} onClear={() => { setCustLabel(''); set({ customerId: '' }); }} onCreate={() => setCustOpen(true)} />
            <Input className="mt-3" label={t('field.email')} type="email" value={form.email} onChange={(e) => set({ email: e.target.value })} />
          </SideSection>
          <SideSection title={t('btn.orders.col.po')}><Input aria-label={t('btn.orders.col.po')} maxLength={100} value={form.poNumber ?? ''} onChange={(e) => set({ poNumber: e.target.value })} /></SideSection>
          <SideSection title={t('btn.draft.market')}>
            <Select aria-label={t('btn.draft.market')} value={form.marketId ?? ''} onChange={(e) => set({ marketId: e.target.value })}>
              <option value="">{t('btn.draft.noMarket')}</option>
              {(markets.data?.markets.nodes ?? []).map((m) => <option key={m.id} value={m.id}>{m.name}{m.currencySettings?.baseCurrency ? ` (${m.currencySettings.baseCurrency.currencyCode})` : ''}</option>)}
            </Select>
            <p className="mt-1 text-xs text-muted">{t('btn.draft.marketHelp', { currency: currency })}</p>
          </SideSection>
          {draft && <DraftCompanySection draftId={draft.id} locked={completed} />}
          <SideSection title={t('field.tags')}><TagInput value={form.tags} onChange={(tags) => set({ tags })} removeLabel={t('common.remove')} /></SideSection>
        </fieldset>
      </div>
      <NewCustomerDialog open={custOpen} onClose={() => setCustOpen(false)} defaultEmail={form.email} onCreated={(c) => { setCustLabel(c.displayName); set({ customerId: c.id, email: c.email ?? form.email }); setCustOpen(false); }} />
      <VariantDialog open={dialog === 'variant'} onClose={() => setDialog(null)} excludeVariantIds={form.lines.flatMap((l) => (l.variantId ? [l.variantId] : []))} onAdd={(lines) => set({ lines: [...form.lines, ...lines] })} />
      <CustomDialog open={dialog === 'custom'} onClose={() => setDialog(null)} onAdd={(l) => set({ lines: [...form.lines, l] })} />
      <Modal open={dialog === 'invoice'} onClose={() => setDialog(null)} closeLabel={t('common.close')} title={t('draft.sendInvoice')}
        footer={<><Button onClick={() => setDialog(null)}>{t('common.cancel')}</Button><Button variant="primary" loading={invoice.isPending} disabled={!invoiceTo.includes('@')} onClick={() => invoice.mutate()}>{t('draft.send')}</Button></>}>
        <Input label={t('draft.invoiceTo')} type="email" value={invoiceTo} onChange={(e) => setInvoiceTo(e.target.value)} />
      </Modal>
      <Modal open={dialog === 'complete'} onClose={() => setDialog(null)} closeLabel={t('common.close')} title={t('draft.completeTitle')}
        footer={<><Button onClick={() => setDialog(null)}>{t('common.cancel')}</Button><Button loading={complete.isPending && complete.variables === true} onClick={() => complete.mutate(true)}>{t('draft.paymentPending')}</Button><Button variant="primary" loading={complete.isPending && complete.variables === false} onClick={() => complete.mutate(false)}>{t('draft.markPaid')}</Button></>}>
        <p className="text-[13px]">{t('draft.completeBody')}</p>
      </Modal>
      <ConfirmDialog open={dialog === 'delete'} danger onClose={() => setDialog(null)} closeLabel={t('common.close')} title={t('draft.deleteTitle')} message={t('draft.deleteBody')} confirmLabel={t('common.delete')} cancelLabel={t('common.cancel')} onConfirm={() => del.mutate()} />
    </>
  );
}

interface CustomerHit { id: string; displayName: string; defaultEmailAddress: { emailAddress: string } | null }
function CustomerPick({ label, onPick, onClear, onCreate }: { label: string; onPick: (c: CustomerHit) => void; onClear: () => void; onCreate: () => void }) {
  const { t } = useI18n();
  const [search, setSearch] = useState('');
  const term = useDebounced(search).trim();
  const hits = useQuery({ queryKey: ['draft-customers', term], enabled: term.length > 1, queryFn: () => gql<{ customers: { nodes: CustomerHit[] } }>(DRAFT_CUSTOMER_SEARCH, { query: term }) });
  if (label) return <div className="flex items-center justify-between text-[13px]"><span className="font-medium">{label}</span><Button size="sm" onClick={onClear}>{t('common.remove')}</Button></div>;
  return (
    <div className="flex flex-col gap-1">
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted" />
        <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('draft.searchCustomer')} aria-label={t('draft.searchCustomer')} className="field-control w-full !pl-8" />
      </div>
      <button type="button" className="flex items-center gap-1.5 rounded px-2 py-1 text-left text-[13px] text-accent hover:bg-surface" onClick={onCreate}><Plus className="size-3.5" aria-hidden />{t('btn.draft.createCustomer')}</button>
      {term.length > 1 && (hits.data?.customers.nodes ?? []).map((c) => <button key={c.id} type="button" className="rounded px-2 py-1 text-left text-[13px] hover:bg-surface" onClick={() => { onPick(c); setSearch(''); }}>{c.displayName}{c.defaultEmailAddress && <span className="text-muted"> · {c.defaultEmailAddress.emailAddress}</span>}</button>)}
    </div>
  );
}

/** Create a customer without leaving the draft: first and last name, email. */
function NewCustomerDialog({ open, onClose, defaultEmail, onCreated }: { open: boolean; onClose: () => void; defaultEmail: string; onCreated: (c: { id: string; displayName: string; email: string | null }) => void }) {
  const { t } = useI18n();
  const [f, setF] = useState({ firstName: '', lastName: '', email: '' });
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (open) { setF({ firstName: '', lastName: '', email: defaultEmail }); setError(null); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const create = useMutation({
    mutationFn: () => mutate<{ customer: { id: string; displayName: string; defaultEmailAddress: { emailAddress: string } | null } }>(CUSTOMER_CREATE, { input: { firstName: f.firstName.trim() || null, lastName: f.lastName.trim() || null, email: f.email.trim() || null } }, 'customerCreate'),
    onSuccess: (r) => onCreated({ id: r.customer.id, displayName: r.customer.displayName || f.email, email: r.customer.defaultEmailAddress?.emailAddress ?? (f.email.trim() || null) }), onError: (e) => setError(errText(e)),
  });
  return (
    <Modal open={open} onClose={onClose} closeLabel={t('common.close')} title={t('btn.draft.createCustomer')}
      footer={<><Button onClick={onClose}>{t('common.cancel')}</Button><Button variant="primary" loading={create.isPending} disabled={!f.email.includes('@') && !f.firstName.trim() && !f.lastName.trim()} onClick={() => create.mutate()}>{t('btn.draft.createCustomerSave')}</Button></>}>
      {error && <div className="mb-3"><Banner>{error}</Banner></div>}
      <div className="grid gap-3 sm:grid-cols-2">
        <Input label={t('field.firstName')} value={f.firstName} onChange={(e) => setF({ ...f, firstName: e.target.value })} />
        <Input label={t('field.lastName')} value={f.lastName} onChange={(e) => setF({ ...f, lastName: e.target.value })} />
        <div className="sm:col-span-2"><Input label={t('field.email')} type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></div>
      </div>
    </Modal>
  );
}

export function VariantDialog({ open, onClose, onAdd, excludeVariantIds }: { open: boolean; onClose: () => void; onAdd: (l: DraftLine[]) => void; excludeVariantIds?: string[] }) {
  return (
    <VariantPicker open={open} onClose={onClose} excludeVariantIds={excludeVariantIds}
      onConfirm={(vs) => onAdd(vs.map((v) => ({ key: `${v.variantId}:${Date.now()}`, variantId: v.variantId, title: v.productTitle, variantTitle: v.variantTitle, price: v.price, quantity: 1 })))} />
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

