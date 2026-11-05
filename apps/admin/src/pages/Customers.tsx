import { Badge, Banner, Button, Card, ConfirmDialog, Dropdown, EmptyState, IndexTable, ListToolbar, Modal, Pagination, Skeleton, TagInput, TagPickerDialog, Textarea, useToast } from '@shopme/ui';
import type { Column } from '@shopme/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowUpDown, Building2, Check, ChevronDown, ChevronUp, Copy, FileDown, GitMerge, MoreHorizontal, Pencil, Search, ShieldOff, ShoppingCart, Trash2, Undo2, Users, Wallet } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { gql, mutate } from '../api';
import { AddressBlock, FinancialBadge, FulfillmentBadge, searchCls, selectCls, useFormat, useListParams } from '../components/shared';
import type { Money, MoneySet } from '../components/shared';
import { LearnMore } from '../components/LearnMore';
import { ColumnPicker, useColumnVisibility } from '../components/ColumnPicker';
import { AddToCompanyDialog, BulkEditDialog, CustomerSearchDialog, MergeDialog } from '../components/CustomerDialogs';
import { CustomerQueryBar } from '../components/CustomerQueryBar';
import { HelpHeader } from '../components/HelpHeader';
import { PageHeader } from '../components/PageHeader';
import { ExportButton, ImportButton } from '../components/CsvTools';
import { ViewTabs } from '../components/SavedViews';
import { gidToNum, numToGid } from '../format';
import { CUSTOMER, CUSTOMER_CANCEL_ERASURE, CUSTOMER_DATA_REQUEST, CUSTOMER_DETAIL_EXTRAS, CUSTOMER_IDS, CUSTOMERS, CUSTOMERS_COUNT, CUSTOMER_DELETE, CUSTOMER_REQUEST_ERASURE, CUSTOMER_TAGS, CUSTOMER_UPDATE, TAGS_ADD, TAGS_REMOVE } from '../graphql';
import { countryName } from '../lib/countries';
import { useI18n, useT } from '../i18n';
import type { Key } from '../i18n';
import { Timeline } from '../components/Timeline';
import { MetafieldsEditor } from '../components/MetafieldsEditor';
import { StoreCreditCard, StoreCreditDialog } from '../components/StoreCredit';
import { useDebounced } from '../lib/hooks';
import type { Connection } from '../lib/hooks';
import emptyCustomers from '../assets/empty/empty-customers.webp';

export interface CustomerRow {
  id: string; displayName: string; note: string | null; tags: string[]; numberOfOrders: number; createdAt: string;
  defaultEmailAddress: { emailAddress: string; marketingState: string } | null; defaultAddress: { city: string | null; country: string | null; countryCodeV2?: string | null } | null; amountSpent: Money;
}
const PAGE_SIZE = 25;
const TABS = ['all', 'subscribed', 'hasOrders', 'noOrders', 'repeat'] as const;
type Tab = (typeof TABS)[number];
const TAB_QUERY: Record<Tab, string> = { all: '', subscribed: 'accepts_marketing:true', hasOrders: 'orders_count:>0', noOrders: 'orders_count:0', repeat: 'orders_count:>1' };
const SORTS = ['NAME', 'LOCATION', 'ORDERS_COUNT', 'CREATED_AT'];

export const MarketingBadge = ({ state }: { state?: string | null }) => {
  const t = useT();
  const s = state ?? 'NOT_SUBSCRIBED';
  return <Badge tone={s === 'SUBSCRIBED' ? 'success' : 'neutral'}>{t(`marketing.${s}` as Key)}</Badge>;
};

export function CustomersPage() {
  const t = useT();
  const nav = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();
  const fmt = useFormat();
  const L = useListParams();
  const tab = (TABS.includes(L.get('tab') as Tab) ? L.get('tab') : 'all') as Tab;
  const [search, setSearch] = useState(L.get('q'));
  const term = useDebounced(search);
  const urlQ = L.get('q');
  useEffect(() => { setSearch(urlQ); }, [urlQ]); // a saved view changed the search
  const [selected, setSelected] = useState<string[]>([]);
  const [confirm, setConfirm] = useState<string[] | null>(null);
  const [tagging, setTagging] = useState<{ ids: string[]; mode: 'add' | 'remove' } | null>(null);
  const [editing, setEditing] = useState<string[] | null>(null);
  const [merging, setMerging] = useState<[string, string] | null>(null);
  const [companyFor, setCompanyFor] = useState<string[] | null>(null);
  const cols = useColumnVisibility('customers', ['email', 'tags', 'since']);
  const customerTags = useQuery({ queryKey: ['customer-tag-options'], staleTime: 60_000, queryFn: async () => { const r = await gql<{ customers: Connection<CustomerRow & { tags: string[] }> }>(CUSTOMER_TAGS); return [...new Set(r.customers.nodes.flatMap((c) => c.tags))].sort(); } });
  const sort = { key: L.get('sort') || 'CREATED_AT', reverse: L.get('dir') !== 'asc' };
  const terms = [term.trim(), TAB_QUERY[tab], L.get('sq'), L.get('tag') && `tag:"${L.get('tag').replace(/"/g, '')}"`, L.get('country') && `country:${L.get('country')}`].filter(Boolean).join(' ');

  const list = useQuery({
    queryKey: ['customers', terms, sort, L.get('after'), L.get('before')],
    queryFn: () => gql<{ customers: Connection<CustomerRow> }>(CUSTOMERS, { query: terms || null, sortKey: sort.key, reverse: sort.reverse, ...L.page(PAGE_SIZE) }),
    placeholderData: (p) => p,
  });
  const count = useQuery({ queryKey: ['customers-count', terms], queryFn: () => gql<{ customersCount: { count: number } }>(CUSTOMERS_COUNT, { query: terms || null }) });
  const bulk = useMutation({
    mutationFn: async ({ ids, tags, remove }: { ids: string[]; tags?: string[]; remove?: boolean }) => {
      await Promise.all(ids.map((id) => (tags ? (remove ? mutate(TAGS_REMOVE, { id, tags }, 'tagsRemove') : mutate(TAGS_ADD, { id, tags }, 'tagsAdd')) : mutate(CUSTOMER_DELETE, { input: { id } }, 'customerDelete'))));
    },
    onSuccess: (_d, v) => { toast(t(v.tags ? 'customers.tagged' : 'customers.deleted', { n: v.ids.length })); setSelected([]); void qc.invalidateQueries({ queryKey: ['customers'] }); },
    onError: (e) => toast(e.message, 'critical'),
  });

  const { lang } = useI18n();
  const rows = list.data?.customers.nodes ?? [];
  const pi = list.data?.customers.pageInfo;
  const labels: Record<string, string> = { name: t('customers.name'), email: t('field.email'), mk: t('customers.subscription'), loc: t('customers.location'), orders: t('customers.orders'), spent: t('customers.spent'), tags: t('field.tags'), since: t('customers.since') };
  const columns: Array<Column<CustomerRow>> = [
    { key: 'name', header: labels.name, sortKey: 'NAME', cell: (c) => <span className="font-medium">{c.displayName}{c.note && <span title={c.note} className="ml-1 text-muted">✎</span>}</span> },
    { key: 'email', header: labels.email, cell: (c) => c.defaultEmailAddress?.emailAddress ?? <span className="text-muted">—</span> },
    { key: 'mk', header: <HelpHeader label={labels.mk!} help={t('bc.help.subscription')} />, cell: (c) => <MarketingBadge state={c.defaultEmailAddress?.marketingState} /> },
    { key: 'loc', header: <HelpHeader label={labels.loc!} help={t('bc.help.location')} />, sortKey: 'LOCATION', cell: (c) => [c.defaultAddress?.city, c.defaultAddress?.countryCodeV2 ? countryName(c.defaultAddress.countryCodeV2, lang) : c.defaultAddress?.country].filter(Boolean).join(', ') || <span className="text-muted">—</span> },
    { key: 'orders', header: labels.orders, sortKey: 'ORDERS_COUNT', cell: (c) => c.numberOfOrders },
    { key: 'spent', header: <HelpHeader label={labels.spent!} help={t('bc.help.spent')} />, cell: (c) => fmt.money(c.amountSpent) },
    { key: 'tags', header: labels.tags, cell: (c) => (c.tags.length ? <span className="line-clamp-1 max-w-48">{c.tags.join(', ')}</span> : <span className="text-muted">—</span>) },
    { key: 'since', header: labels.since, sortKey: 'CREATED_AT', cell: (c) => fmt.date(c.createdAt) },
  ];
  // The column chooser lists columns by their plain titles (the table headers carry a help icon).
  const pickable = columns.map((c) => ({ ...c, header: labels[c.key] ?? c.key }));
  const add = <Button variant="primary" onClick={() => nav('/customers/new')}>{t('customers.add')}</Button>;

  return (
    <>
      <PageHeader icon={<Users className="size-4" />} title={t('nav.customers')} actions={<><ExportButton kind="customers" /><ImportButton kind="customers" invalidate={['customers', 'customers-count']} />{add}</>} />
      <CustomerQueryBar value={L.get('sq')} onApply={(v) => { setSelected([]); L.patch({ sq: v, view: '' }); }} onSave={(v) => nav(`/customers/segments/new?q=${encodeURIComponent(v)}`)} />
      <Card className="!p-0">
        <ListToolbar
          className="!rounded-b-none !shadow-none border-b border-line"
          leading={<ViewTabs resource="CUSTOMER" query={terms} tabs={TABS.map((id) => ({ id, label: t(`customers.tab.${id}` as Key) }))} value={tab} onTab={(v) => { setSelected([]); L.patch({ tab: v === 'all' ? '' : v, view: '' }); }} />}
          query={search} onQuery={(v) => { setSearch(v); L.patch({ q: v }); }} placeholder={t('fid.customers.search')} removeFilterLabel={t('list.removeFilter')}
          filters={[{ key: 'tag', label: t('filter.tag'), options: [], text: true }]} values={{ tag: L.get('tag') }} onFilter={(_k, v) => L.patch({ tag: v })}
          trailing={<><ColumnPicker locked={['name']} columns={pickable} hidden={cols.hidden} onToggle={cols.toggle} /><Dropdown align="right" variant="plain" size="sm" icon className="btn-neutral" label={t('common.sort')} trigger={<ArrowUpDown className="size-4" />}
            items={SORTS.map((x) => ({ key: x, label: t(`customers.sort.${x}` as Key), icon: sort.key === x ? <Check className="size-4" /> : undefined, onSelect: () => L.patch({ sort: x }) }))} /></>}
        />
        {list.isError && <div className="p-3"><Banner>{(list.error as Error).message}</Banner></div>}
        <IndexTable
          rows={rows} rowId={(r) => r.id} columns={cols.filter(columns)} loading={list.isLoading}
          selected={selected} onSelectedChange={setSelected} selectedLabel={(n) => t('common.selected', { n })} selectAllLabel={t('common.selectAll')}
          sort={sort} onSortChange={(s) => L.patch({ sort: s.key, dir: s.reverse ? '' : 'asc' })}
          onRowClick={(r) => nav(`/customers/${gidToNum(r.id)}`)}
          bulkInline={selected.length === 2 ? 3 : 2} moreLabel={t('list.moreBulk')} selectPageLabel={(n) => t('list.selectPage', { n })} deselectLabel={t('list.deselectAll')} showSelectedLabel={t('list.showSelected')}
          bulkActions={[
            { key: 'edit', label: t('bc.editInBulk'), onRun: (ids) => setEditing(ids) },
            ...(selected.length === 2 ? [{ key: 'merge', label: t('bc.merge'), icon: <GitMerge className="size-4" />, onRun: (ids: string[]) => setMerging([ids[0]!, ids[1]!]) }] : []),
            { key: 'tag', label: t('orders.addTags'), onRun: (ids) => setTagging({ ids, mode: 'add' }) },
            { key: 'untag', label: t('products.removeTags'), onRun: (ids) => setTagging({ ids, mode: 'remove' }) },
            { key: 'company', label: t('bc.addToCompany'), onRun: (ids) => setCompanyFor(ids) },
            { key: 'delete', label: t('customers.deleteBulk'), icon: <Trash2 className="size-4" />, danger: true, onRun: setConfirm },
          ]}
          empty={list.isError ? null : terms
            ? <EmptyState icon={<Search className="size-10" />} title={t('products.noResults')} description={t('products.noResultsBody')} action={<Button onClick={() => { setSearch(''); L.clear(); }}>{t('products.clearFilters')}</Button>} />
            : <EmptyState image={emptyCustomers} title={t('customers.emptyTitle')} description={t('customers.emptyBody')} action={add} />}
        />
        <Pagination hasPrevious={L.get('before') ? !!pi?.hasPreviousPage : !!L.get('after')} hasNext={L.get('before') ? true : !!pi?.hasNextPage}
          previousLabel={t('common.previous')} nextLabel={t('common.next')}
          onPrevious={() => L.patch({ before: pi?.startCursor ?? '', after: '' }, true)} onNext={() => L.patch({ after: pi?.endCursor ?? '', before: '' }, true)} />
      </Card>
      <LearnMore topic={t('qaf.learn.customers')} />
      <BulkEditDialog open={!!editing} ids={editing ?? []} onClose={() => setEditing(null)} onDone={() => setSelected([])} />
      {merging && <MergeDialog open ids={merging} onClose={() => setMerging(null)} onDone={(id) => { setMerging(null); setSelected([]); nav(`/customers/${gidToNum(id)}`); }} />}
      <AddToCompanyDialog open={!!companyFor} ids={companyFor ?? []} onClose={() => setCompanyFor(null)} onDone={() => setSelected([])} />
      <ConfirmDialog open={!!confirm} onClose={() => setConfirm(null)} danger title={t('customers.deleteTitle', { n: confirm?.length ?? 0 })} message={t('customers.deleteBody')} confirmLabel={t('common.delete')} cancelLabel={t('common.cancel')} onConfirm={() => { if (confirm) bulk.mutate({ ids: confirm }); setConfirm(null); }} />
      <TagPickerDialog open={!!tagging} onClose={() => setTagging(null)} title={tagging?.mode === 'remove' ? t('products.removeTags') : t('fid.customers.tagTitle', { n: tagging?.ids.length ?? 0 })} suggestions={customerTags.data ?? []}
        onSave={(list) => { if (tagging) bulk.mutate({ ids: tagging.ids, tags: list, remove: tagging.mode === 'remove' }); setTagging(null); }}
        labels={{ search: t('tagpicker.search'), available: t('tagpicker.available'), save: t('save.save'), cancel: t('common.cancel'), close: t('common.close'), create: (x) => t('tagpicker.create', { tag: x }) }} />
    </>
  );
}

interface CustomerData {
  id: string; displayName: string; firstName: string | null; lastName: string | null; locale: string; taxExempt: boolean; note: string | null; tags: string[]; createdAt: string; numberOfOrders: number;
  defaultEmailAddress: { emailAddress: string; marketingState: string } | null; defaultPhoneNumber: { phoneNumber: string } | null; amountSpent: Money;
  addressesV2: { nodes: Array<NonNullable<Parameters<typeof AddressBlock>[0]['a']> & { id: string }> };
  orders: { nodes: Array<{ id: string; name: string; createdAt: string; displayFinancialStatus: string; displayFulfillmentStatus: string; totalPriceSet: MoneySet }> };
}

export function CustomerDetailPage() {
  const { id = '' } = useParams();
  const t = useT();
  const gid = numToGid('Customer', id);
  const q = useQuery({ queryKey: ['customer', gid], queryFn: () => gql<{ customer: CustomerData | null }>(CUSTOMER, { id: gid }) });
  if (q.isLoading) return <div className="grid gap-4"><Skeleton className="h-8 w-64" /><Skeleton className="h-64" /></div>;
  if (q.error) return <Banner>{q.error.message}</Banner>;
  if (!q.data?.customer) return <Banner>{t('customers.notFound')}</Banner>;
  return <CustomerView key={q.dataUpdatedAt} c={q.data.customer} />;
}

interface Extras {
  id: string; canDelete: boolean; shopmeErasureScheduledAt: string | null; shopmeErasedAt: string | null; smsMarketingConsent: { marketingState: string } | null; shopmeWhatsappMarketingConsent: { marketingState: string } | null; statistics: { rfmGroup: string | null };
  shopmeCompanies: Array<{ id: string; title: string | null; isMainContact: boolean; company: { id: string; name: string } }>;
  lastOrder: { id: string; lineItems: { nodes: Array<{ id: string; title: string; quantity: number; variant: { image: { url: string } | null } | null }> } } | null;
}

function CustomerView({ c }: { c: CustomerData }) {
  const t = useT();
  const fmt = useFormat();
  const nav = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();
  const [note, setNote] = useState(c.note ?? '');
  const [confirm, setConfirm] = useState(false);
  const [creditOpen, setCreditOpen] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  const [mergeWith, setMergeWith] = useState<'pick' | string | null>(null);
  const [eraseOpen, setEraseOpen] = useState(false);
  const [companyOpen, setCompanyOpen] = useState(false);
  const { lang } = useI18n();
  const extras = useQuery({ queryKey: ['customer', 'extras', c.id], queryFn: async () => (await gql<{ customer: Extras | null }>(CUSTOMER_DETAIL_EXTRAS, { id: c.id })).customer });
  const x = extras.data;
  const refresh = () => { void qc.invalidateQueries({ queryKey: ['customer'] }); void qc.invalidateQueries({ queryKey: ['customers'] }); void qc.invalidateQueries({ queryKey: ['timeline', 'customer'] }); };
  const fail = (e: Error) => toast(e.message, 'critical');
  const saveNote = useMutation({ mutationFn: () => mutate(CUSTOMER_UPDATE, { input: { id: c.id, note } }, 'customerUpdate'), onSuccess: () => { toast(t('customers.saved')); refresh(); }, onError: fail });
  const tags = useMutation({
    mutationFn: async (next: string[]) => {
      const add = next.filter((x) => !c.tags.includes(x)), remove = c.tags.filter((x) => !next.includes(x));
      if (add.length) await mutate(TAGS_ADD, { id: c.id, tags: add }, 'tagsAdd');
      if (remove.length) await mutate(TAGS_REMOVE, { id: c.id, tags: remove }, 'tagsRemove');
    },
    onSuccess: refresh, onError: fail,
  });
  const del = useMutation({ mutationFn: () => mutate(CUSTOMER_DELETE, { input: { id: c.id } }, 'customerDelete'), onSuccess: () => { refresh(); nav('/customers'); }, onError: fail });
  const request = useMutation({
    mutationFn: () => mutate<{ data: unknown }>(CUSTOMER_DATA_REQUEST, { id: c.id }, 'shopmeCustomerDataRequest'),
    onSuccess: (r) => { downloadJson(`customer-${gidToNum(c.id)}.json`, r.data); toast(t('customers.dataExported')); refresh(); }, onError: fail,
  });
  const erase = useMutation({
    mutationFn: () => mutate(CUSTOMER_REQUEST_ERASURE, { id: c.id }, 'customerRequestDataErasure'),
    onSuccess: () => { setEraseOpen(false); toast(t('bc.erase.requested')); refresh(); }, onError: (e) => { setEraseOpen(false); fail(e); },
  });
  const cancelErase = useMutation({
    mutationFn: () => mutate(CUSTOMER_CANCEL_ERASURE, { id: c.id }, 'customerCancelDataErasure'),
    onSuccess: () => { toast(t('bc.erase.cancelled')); refresh(); }, onError: fail,
  });
  const num = gidToNum(c.id);
  const since = fmt.date(c.createdAt);
  const ids = useQuery({ queryKey: ['customer-neighbours'], staleTime: 60_000, queryFn: () => gql<{ customers: { nodes: Array<{ id: string }> } }>(CUSTOMER_IDS) });
  const at = ids.data?.customers.nodes.findIndex((x) => x.id === c.id) ?? -1;
  const neighbours = { prev: at > 0 ? ids.data!.customers.nodes[at - 1]!.id : null, next: at >= 0 ? ids.data!.customers.nodes[at + 1]?.id ?? null : null };

  const lastOrder = c.orders.nodes[0];
  const langName = (() => { try { return new Intl.DisplayNames([lang], { type: 'language' }).of(c.locale || 'en') ?? c.locale; } catch { return c.locale; } })();
  const Section = ({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) => (
    <section className="flex flex-col gap-1.5 py-3 text-[13px] first:pt-0">
      <div className="flex items-center justify-between gap-2"><h2 className="font-semibold">{title}</h2>{action}</div>
      {children}
    </section>
  );
  const editBtn = (label: string, onClick: () => void) => <Button variant="plain" size="sm" icon aria-label={label} onClick={onClick}><Pencil className="size-3.5" /></Button>;

  return (
    <>
      <PageHeader large back="/customers" breadcrumb={{ icon: <Users className="size-4" />, label: t('nav.customers'), to: '/customers' }} title={c.displayName}
        actions={<>
          <Dropdown align="right" menuClassName="min-w-64" label={t('common.moreActions')} trigger={<>{t('common.moreActions')}<ChevronDown className="size-4" /></>} items={[
            { key: 'credit', icon: <Wallet className="size-4" />, label: t('bc.grantCredit'), onSelect: () => setCreditOpen(true) },
            { key: 'merge', icon: <GitMerge className="size-4" />, label: t('bc.mergeCustomer'), onSelect: () => setMergeWith('pick') },
            { key: 'data', icon: <FileDown className="size-4" />, label: t('customers.requestData'), onSelect: () => request.mutate() },
            ...(x?.shopmeErasedAt ? [] : x?.shopmeErasureScheduledAt
              ? [{ key: 'cancelErase', icon: <Undo2 className="size-4" />, label: t('bc.erase.cancel'), onSelect: () => cancelErase.mutate() }]
              : [{ key: 'erase', icon: <ShieldOff className="size-4" />, label: t('bc.erase.action'), onSelect: () => setEraseOpen(true) }]),
            { key: 'delete', icon: <Trash2 className="size-4" />, label: t('fid.customers.delete'), danger: true, onSelect: () => setConfirm(true) },
          ]} />
          <span className="inline-flex gap-1">
            <Button size="sm" icon aria-label={t('customers.previous')} disabled={!neighbours.prev} onClick={() => neighbours.prev && nav(`/customers/${gidToNum(neighbours.prev)}`)}><ChevronUp className="size-4" /></Button>
            <Button size="sm" icon aria-label={t('customers.next')} disabled={!neighbours.next} onClick={() => neighbours.next && nav(`/customers/${gidToNum(neighbours.next)}`)}><ChevronDown className="size-4" /></Button>
          </span></>} />
      <div className="grid gap-6 lg:grid-cols-[1fr_17rem]">
        <div className="flex min-w-0 flex-col gap-5">
          {x?.shopmeErasedAt && <Banner>{t('bc.erase.done', { date: fmt.date(x.shopmeErasedAt) })}</Banner>}
          {!x?.shopmeErasedAt && x?.shopmeErasureScheduledAt && (
            <Banner tone="warning"><div className="flex flex-wrap items-center gap-2"><span>{t('bc.erase.scheduled', { date: fmt.date(x.shopmeErasureScheduledAt) })}</span><Button size="sm" className="ml-auto" loading={cancelErase.isPending} onClick={() => cancelErase.mutate()}>{t('bc.erase.cancel')}</Button></div></Banner>
          )}
          <dl className="grid grid-cols-2 gap-4 px-3 text-[13px] sm:grid-cols-4">
            <div><dt className="font-semibold">{t('customers.spent')}</dt><dd className="mt-1">{fmt.money(c.amountSpent)}</dd></div>
            <div><dt className="font-semibold">{t('customers.orders')}</dt><dd className="mt-1">{c.numberOfOrders}</dd></div>
            <div><dt className="font-semibold">{t('customers.since')}</dt><dd className="mt-1">{since}</dd></div>
            <div><dt className="font-semibold">{t('bc.group')}</dt><dd className="mt-1">{t(c.numberOfOrders > 0 ? 'bc.group.customer' : 'bc.group.prospect')}{x?.statistics.rfmGroup && c.numberOfOrders > 0 && <span className="block text-xs font-normal text-muted">{t(`bc.rfm.${x.statistics.rfmGroup}` as Key)}</span>}</dd></div>
          </dl>
          <section>
            <div className="mb-2 flex items-center justify-between gap-3">
              <h2 className="text-sm font-semibold">{t('qaf.customer.lastOrder')}</h2>
              <span className="flex items-center gap-2">{<Link className="btn btn-plain btn-sm" to={`/orders?q=${encodeURIComponent(`customer_id:${num}`)}`}>{t("customers.viewAllOrders")}</Link>}<Button size="sm" variant="primary" onClick={() => nav("/orders/drafts/new")}>{t('customers.createOrder')}</Button></span>
            </div>
            <Card>
              {!lastOrder ? <p className="text-[13px] text-muted">{t('customers.noOrders')}</p> : (
                <div className="flex flex-col gap-2 text-[13px]">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link to={`/orders/${gidToNum(lastOrder.id)}`} className="text-sm font-semibold hover:underline">{lastOrder.name}</Link>
                    <FinancialBadge status={lastOrder.displayFinancialStatus} /><FulfillmentBadge status={lastOrder.displayFulfillmentStatus} />
                    <span className="ml-auto text-sm font-semibold">{fmt.money(lastOrder.totalPriceSet)}</span>
                  </div>
                  <span className="text-muted">{fmt.dateTime(lastOrder.createdAt)}</span>
                  {x?.lastOrder?.lineItems.nodes.length ? (
                    <ul className="mt-1 flex flex-col gap-1.5 border-t border-line pt-2">
                      {x.lastOrder.lineItems.nodes.map((l) => (
                        <li key={l.id} className="flex items-center gap-2">
                          {l.variant?.image?.url ? <img src={l.variant.image.url} alt="" className="size-8 rounded-md border border-line object-cover" /> : <span aria-hidden className="grid size-8 place-items-center rounded-md border border-line text-muted"><ShoppingCart className="size-4" /></span>}
                          <span className="min-w-0 flex-1 truncate">{l.title}</span><span className="text-muted">× {l.quantity}</span>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              )}
            </Card>
          </section>
          <Timeline kind="customer" id={c.id} />
          <MetafieldsEditor ownerId={c.id} ownerType="CUSTOMER" />
        </div>
        <div className="flex flex-col divide-y divide-line">
          <Section title={t('qaf.customer.contact')} action={<Dropdown align="right" variant="plain" size="sm" icon label={t('common.moreActions')} trigger={<MoreHorizontal className="size-4" />} items={[{ key: 'edit', label: t('customers.editContact'), onSelect: () => nav(`/customers/${num}/edit`) }, { key: 'company', label: t('bc.addToCompany'), onSelect: () => setCompanyOpen(true) }]} />}>
            <div className="flex flex-col gap-0.5">
              <span className="flex items-center justify-between gap-2">{c.defaultEmailAddress ? <a className="truncate text-accent hover:underline" href={`mailto:${c.defaultEmailAddress.emailAddress}`}>{c.defaultEmailAddress.emailAddress}</a> : '—'}
                {c.defaultEmailAddress && <Button variant="plain" size="sm" icon aria-label={t('customers.copyEmail')} onClick={() => { void navigator.clipboard?.writeText(c.defaultEmailAddress!.emailAddress); toast(t('customers.copied')); }}><Copy className="size-3.5" /></Button>}</span>
              {c.defaultPhoneNumber && <span>{c.defaultPhoneNumber.phoneNumber}</span>}
              <span>{t('qaf.customer.language', { lang: langName })}</span>
              <span>{t('qaf.customer.neverSignedIn')}</span>
            </div>
          </Section>
          <Section title={t('qaf.customer.defaultAddress')}>{c.addressesV2.nodes[0] ? <AddressBlock a={c.addressesV2.nodes[0]} /> : <p className="text-muted">{t('customers.noAddress')}</p>}</Section>
          <Section title={t('qaf.customer.marketing')}>
            {![c.defaultEmailAddress?.marketingState, c.defaultPhoneNumber && x?.smsMarketingConsent?.marketingState, c.defaultPhoneNumber && x?.shopmeWhatsappMarketingConsent?.marketingState].some((s) => s === 'SUBSCRIBED' || s === 'PENDING') ? <p className="text-muted">{t('qaf.customer.noChannel')}</p> : (
              <ul className="flex flex-col gap-1">
                {c.defaultEmailAddress && <li className="flex items-center justify-between gap-2"><span>{t('bc.channel.email')}</span><MarketingBadge state={c.defaultEmailAddress.marketingState} /></li>}
                {c.defaultPhoneNumber && <li className="flex items-center justify-between gap-2"><span>{t('bc.channel.sms')}</span><MarketingBadge state={x?.smsMarketingConsent?.marketingState} /></li>}
                {c.defaultPhoneNumber && <li className="flex items-center justify-between gap-2"><span>{t('bc.channel.whatsapp')}</span><MarketingBadge state={x?.shopmeWhatsappMarketingConsent?.marketingState} /></li>}
              </ul>
            )}
          </Section>
          {!!x?.shopmeCompanies.length && (
            <Section title={t('bc.companies')} action={editBtn(t('bc.addToCompany'), () => setCompanyOpen(true))}>
              <ul className="flex flex-col gap-0.5">{x.shopmeCompanies.map((m) => <li key={m.id}><Link className="text-accent hover:underline" to={`/customers/companies/${gidToNum(m.company.id)}`}>{m.company.name}</Link>{m.title && <span className="text-muted"> · {m.title}</span>}{m.isMainContact && <span className="text-muted"> · {t('bc.company.main')}</span>}</li>)}</ul>
            </Section>
          )}
          <Section title={t('qaf.customer.tax')}><p className="text-muted">{c.taxExempt ? t('qaf.customer.taxExempt') : t('qaf.customer.collectTax')}</p></Section>
          <StoreCreditCard customerId={c.id} onEdit={() => setCreditOpen(true)} />
          <Section title={t('field.tags')}><TagInput value={c.tags} onChange={(v) => tags.mutate(v)} placeholder={t('pv.addTags')} removeLabel={t('common.remove')} /></Section>
          <Section title={t('order.notes')} action={editBtn(t('order.notes'), () => setNoteOpen(true))}>
            <p className={c.note ? 'whitespace-pre-wrap' : 'text-muted'}>{c.note || t('fid.customers.noNote')}</p>
          </Section>
        </div>
      </div>
      <Modal open={noteOpen} onClose={() => setNoteOpen(false)} title={t('order.notes')} closeLabel={t('common.close')}
        footer={<><Button onClick={() => { setNote(c.note ?? ''); setNoteOpen(false); }}>{t('common.cancel')}</Button><Button variant="primary" loading={saveNote.isPending} disabled={note === (c.note ?? '')} onClick={() => saveNote.mutate(undefined, { onSuccess: () => setNoteOpen(false) })}>{t('save.save')}</Button></>}>
        <Textarea aria-label={t('order.notes')} value={note} onChange={(e) => setNote(e.target.value)} />
      </Modal>
      <StoreCreditDialog customerId={c.id} open={creditOpen} onClose={() => setCreditOpen(false)} />
      <CustomerSearchDialog open={mergeWith === 'pick'} title={t('bc.merge.pickTitle')} excludeId={c.id} onClose={() => setMergeWith(null)} onPick={(id) => setMergeWith(id)} />
      {mergeWith && mergeWith !== 'pick' && <MergeDialog open ids={[c.id, mergeWith]} onClose={() => setMergeWith(null)} onDone={(id) => { setMergeWith(null); refresh(); nav(`/customers/${gidToNum(id)}`); }} />}
      <AddToCompanyDialog open={companyOpen} ids={[c.id]} onClose={() => setCompanyOpen(false)} onDone={() => { void qc.invalidateQueries({ queryKey: ['customer', 'extras'] }); }} />
      <ConfirmDialog open={eraseOpen} onClose={() => setEraseOpen(false)} danger loading={erase.isPending} title={t('bc.erase.title')} message={t('bc.erase.body')} confirmLabel={t('bc.erase.confirm')} cancelLabel={t('common.cancel')} onConfirm={() => erase.mutate()} />
      <ConfirmDialog open={confirm} onClose={() => setConfirm(false)} danger title={t('customers.deleteTitle', { n: 1 })} message={t('customers.deleteBody')} confirmLabel={t('common.delete')} cancelLabel={t('common.cancel')} onConfirm={() => { setConfirm(false); del.mutate(); }} />
    </>
  );
}

function downloadJson(name: string, data: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
