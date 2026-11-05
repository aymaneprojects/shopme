import { Badge, Banner, Button, Card, ConfirmDialog, Dropdown, EmptyState, IndexTable, ListToolbar, Pagination, Skeleton, TagInput, TagPickerDialog, Textarea, useToast } from '@shopme/ui';
import type { Column } from '@shopme/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowUpDown, Check, ChevronDown, ChevronUp, Copy, MoreHorizontal, Plus, Search, Trash2, Users } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { gql, mutate } from '../api';
import { AddressBlock, FinancialBadge, FulfillmentBadge, searchCls, selectCls, useFormat, useListParams } from '../components/shared';
import type { Money, MoneySet } from '../components/shared';
import { PageHeader } from '../components/PageHeader';
import { ExportButton, ImportButton } from '../components/CsvTools';
import { ViewTabs } from '../components/SavedViews';
import { gidToNum, numToGid } from '../format';
import { CUSTOMER, CUSTOMER_IDS, CUSTOMERS, CUSTOMERS_COUNT, CUSTOMER_DELETE, CUSTOMER_TAGS, CUSTOMER_UPDATE, TAGS_ADD, TAGS_REMOVE } from '../graphql';
import { useT } from '../i18n';
import type { Key } from '../i18n';
import { Timeline } from '../components/Timeline';
import { MetafieldsEditor } from '../components/MetafieldsEditor';
import { useDebounced } from '../lib/hooks';
import type { Connection } from '../lib/hooks';
import emptyCustomers from '../assets/empty/empty-customers.webp';

export interface CustomerRow {
  id: string; displayName: string; note: string | null; tags: string[]; numberOfOrders: number; createdAt: string;
  defaultEmailAddress: { emailAddress: string; marketingState: string } | null; defaultAddress: { city: string | null; country: string | null } | null; amountSpent: Money;
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
  const customerTags = useQuery({ queryKey: ['customer-tag-options'], staleTime: 60_000, queryFn: async () => { const r = await gql<{ customers: Connection<CustomerRow & { tags: string[] }> }>(CUSTOMER_TAGS); return [...new Set(r.customers.nodes.flatMap((c) => c.tags))].sort(); } });
  const sort = { key: L.get('sort') || 'CREATED_AT', reverse: L.get('dir') !== 'asc' };
  const terms = [term.trim(), TAB_QUERY[tab], L.get('tag') && `tag:"${L.get('tag').replace(/"/g, '')}"`, L.get('country') && `country:${L.get('country')}`].filter(Boolean).join(' ');

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

  const rows = list.data?.customers.nodes ?? [];
  const pi = list.data?.customers.pageInfo;
  const columns: Array<Column<CustomerRow>> = [
    { key: 'name', header: t('customers.name'), sortKey: 'NAME', cell: (c) => <span className="font-medium">{c.displayName}{c.note && <span title={c.note} className="ml-1 text-muted">✎</span>}</span> },
    { key: 'mk', header: t('customers.subscription'), cell: (c) => <MarketingBadge state={c.defaultEmailAddress?.marketingState} /> },
    { key: 'loc', header: t('customers.location'), sortKey: 'LOCATION', cell: (c) => [c.defaultAddress?.city, c.defaultAddress?.country].filter(Boolean).join(', ') || <span className="text-muted">—</span> },
    { key: 'orders', header: t('customers.orders'), sortKey: 'ORDERS_COUNT', cell: (c) => c.numberOfOrders },
    { key: 'spent', header: t('customers.spent'), cell: (c) => fmt.money(c.amountSpent) },
  ];
  const add = <Button variant="primary" onClick={() => nav('/customers/new')}>{t('customers.add')}</Button>;

  return (
    <>
      <PageHeader icon={<Users className="size-4" />} title={t('nav.customers')} actions={<>{count.data && <span className="text-[13px] text-muted">{t('customers.count', { n: count.data.customersCount.count })}</span>}<ExportButton kind="customers" /><ImportButton kind="customers" invalidate={['customers', 'customers-count']} />{add}</>} />
      <Card className="!p-0">
        <ListToolbar
          className="!rounded-b-none !shadow-none border-b border-line"
          leading={<ViewTabs resource="CUSTOMER" query={terms} tabs={TABS.map((id) => ({ id, label: t(`customers.tab.${id}` as Key) }))} value={tab} onTab={(v) => { setSelected([]); L.patch({ tab: v === 'all' ? '' : v, view: '' }); }} />}
          query={search} onQuery={(v) => { setSearch(v); L.patch({ q: v }); }} placeholder={t('list.searchAndFilter')} removeFilterLabel={t('list.removeFilter')}
          filters={[{ key: 'tag', label: t('filter.tag'), options: [], text: true }]} values={{ tag: L.get('tag') }} onFilter={(_k, v) => L.patch({ tag: v })}
          trailing={<Dropdown align="right" variant="plain" size="sm" icon className="btn-neutral" label={t('common.sort')} trigger={<ArrowUpDown className="size-4" />}
            items={SORTS.map((x) => ({ key: x, label: t(`customers.sort.${x}` as Key), icon: sort.key === x ? <Check className="size-4" /> : undefined, onSelect: () => L.patch({ sort: x }) }))} />}
        />
        {list.isError && <div className="p-3"><Banner>{(list.error as Error).message}</Banner></div>}
        <IndexTable
          rows={rows} rowId={(r) => r.id} columns={columns} loading={list.isLoading}
          selected={selected} onSelectedChange={setSelected} selectedLabel={(n) => t('common.selected', { n })} selectAllLabel={t('common.selectAll')}
          sort={sort} onSortChange={(s) => L.patch({ sort: s.key, dir: s.reverse ? '' : 'asc' })}
          onRowClick={(r) => nav(`/customers/${gidToNum(r.id)}`)}
          bulkInline={1} moreLabel={t('list.moreBulk')} selectPageLabel={(n) => t('list.selectPage', { n })} deselectLabel={t('list.deselectAll')} showSelectedLabel={t('list.showSelected')}
          bulkActions={[
            { key: 'tag', label: t('orders.addTags'), onRun: (ids) => setTagging({ ids, mode: 'add' }) },
            { key: 'untag', label: t('products.removeTags'), onRun: (ids) => setTagging({ ids, mode: 'remove' }) },
            { key: 'delete', label: t('customers.deleteBulk'), icon: <Trash2 className="size-4" />, danger: true, separatorBefore: true, onRun: setConfirm },
          ]}
          empty={list.isError ? null : terms
            ? <EmptyState icon={<Search className="size-10" />} title={t('products.noResults')} description={t('products.noResultsBody')} action={<Button onClick={() => { setSearch(''); L.clear(); }}>{t('products.clearFilters')}</Button>} />
            : <EmptyState image={emptyCustomers} title={t('customers.emptyTitle')} description={t('customers.emptyBody')} action={add} />}
        />
        <Pagination hasPrevious={L.get('before') ? !!pi?.hasPreviousPage : !!L.get('after')} hasNext={L.get('before') ? true : !!pi?.hasNextPage}
          previousLabel={t('common.previous')} nextLabel={t('common.next')}
          onPrevious={() => L.patch({ before: pi?.startCursor ?? '', after: '' }, true)} onNext={() => L.patch({ after: pi?.endCursor ?? '', before: '' }, true)} />
      </Card>
      <ConfirmDialog open={!!confirm} onClose={() => setConfirm(null)} danger title={t('customers.deleteTitle', { n: confirm?.length ?? 0 })} message={t('customers.deleteBody')} confirmLabel={t('common.delete')} cancelLabel={t('common.cancel')} onConfirm={() => { if (confirm) bulk.mutate({ ids: confirm }); setConfirm(null); }} />
      <TagPickerDialog open={!!tagging} onClose={() => setTagging(null)} title={t(tagging?.mode === 'remove' ? 'products.removeTags' : 'orders.addTags')} suggestions={customerTags.data ?? []}
        onSave={(list) => { if (tagging) bulk.mutate({ ids: tagging.ids, tags: list, remove: tagging.mode === 'remove' }); setTagging(null); }}
        labels={{ search: t('tagpicker.search'), available: t('tagpicker.available'), save: t('save.save'), cancel: t('common.cancel'), close: t('common.close'), create: (x) => t('tagpicker.create', { tag: x }) }} />
    </>
  );
}

interface CustomerData {
  id: string; displayName: string; firstName: string | null; lastName: string | null; note: string | null; tags: string[]; createdAt: string; numberOfOrders: number;
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

function CustomerView({ c }: { c: CustomerData }) {
  const t = useT();
  const fmt = useFormat();
  const nav = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();
  const [note, setNote] = useState(c.note ?? '');
  const [confirm, setConfirm] = useState(false);
  const refresh = () => { void qc.invalidateQueries({ queryKey: ['customer'] }); void qc.invalidateQueries({ queryKey: ['customers'] }); };
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
  const num = gidToNum(c.id);
  const since = fmt.date(c.createdAt);
  const ids = useQuery({ queryKey: ['customer-neighbours'], staleTime: 60_000, queryFn: () => gql<{ customers: { nodes: Array<{ id: string }> } }>(CUSTOMER_IDS) });
  const at = ids.data?.customers.nodes.findIndex((x) => x.id === c.id) ?? -1;
  const neighbours = { prev: at > 0 ? ids.data!.customers.nodes[at - 1]!.id : null, next: at >= 0 ? ids.data!.customers.nodes[at + 1]?.id ?? null : null };

  return (
    <>
      <PageHeader back="/customers" title={c.displayName}
        actions={<>
          <Dropdown align="right" label={t('common.moreActions')} trigger={<>{t('common.moreActions')}<ChevronDown className="size-4" /></>} items={[
            { key: 'edit', label: t('customers.edit'), onSelect: () => nav(`/customers/${num}/edit`) },
            { key: 'orders', label: t('customers.viewAllOrders'), disabled: c.numberOfOrders === 0, onSelect: () => nav(`/orders?q=${encodeURIComponent(`customer_id:${num}`)}`) },
            { key: 'data', label: t('customers.requestData'), onSelect: () => { downloadJson(`customer-${num}.json`, c); toast(t('customers.dataExported')); } },
            { key: 'delete', label: t('common.delete'), danger: true, onSelect: () => setConfirm(true) },
          ]} />
          <span className="inline-flex gap-1">
            <Button size="sm" icon aria-label={t('customers.previous')} disabled={!neighbours.prev} onClick={() => neighbours.prev && nav(`/customers/${gidToNum(neighbours.prev)}`)}><ChevronUp className="size-4" /></Button>
            <Button size="sm" icon aria-label={t('customers.next')} disabled={!neighbours.next} onClick={() => neighbours.next && nav(`/customers/${gidToNum(neighbours.next)}`)}><ChevronDown className="size-4" /></Button>
          </span></>} />
      <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
        <div className="flex flex-col gap-4">
          <Card>
            <dl className="grid grid-cols-3 gap-4 text-[13px]">
              <div><dt className="text-muted">{t('customers.spent')}</dt><dd className="text-lg font-semibold">{fmt.money(c.amountSpent)}</dd></div>
              <div><dt className="text-muted">{t('customers.orders')}</dt><dd className="text-lg font-semibold">{c.numberOfOrders}</dd></div>
              <div><dt className="text-muted">{t('customers.since')}</dt><dd className="text-lg font-semibold">{since}</dd></div>
            </dl>
          </Card>
          <MetafieldsEditor ownerId={c.id} ownerType="CUSTOMER" />
          <Timeline kind="customer" id={c.id} />
          <Card title={t('customers.recentOrders')} actions={<span className="flex items-center gap-3">{c.numberOfOrders > 0 && <Link className="text-[13px] text-accent hover:underline" to={`/orders?q=${encodeURIComponent(`customer_id:${num}`)}`}>{t('customers.viewAllOrders')}</Link>}<Button size="sm" variant="primary" onClick={() => nav('/orders/drafts/new')}>{t('customers.createOrder')}</Button></span>}>
            {c.orders.nodes.length === 0 ? <p className="text-[13px] text-muted">{t('customers.noOrders')}</p> : (
              <ul className="divide-y divide-line">
                {c.orders.nodes.map((o) => (
                  <li key={o.id} className="flex flex-wrap items-center gap-3 py-2 text-[13px]">
                    <Link to={`/orders/${gidToNum(o.id)}`} className="font-medium text-accent hover:underline">{o.name}</Link>
                    <span className="text-muted">{fmt.date(o.createdAt)}</span>
                    <FinancialBadge status={o.displayFinancialStatus} /><FulfillmentBadge status={o.displayFulfillmentStatus} />
                    <span className="ml-auto">{fmt.money(o.totalPriceSet)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
        <div className="flex flex-col gap-4">
          <Card title={t('customers.contact')} actions={<Dropdown align="right" icon label={t('common.moreActions')} trigger={<MoreHorizontal className="size-4" />} items={[{ key: 'edit', label: t('customers.editContact'), onSelect: () => nav(`/customers/${num}/edit`) }]} />}>
            <div className="flex flex-col gap-1 text-[13px]">
              <span className="flex items-center gap-2">{c.defaultEmailAddress?.emailAddress ?? '—'}
                {c.defaultEmailAddress && <Button size="sm" icon aria-label={t('customers.copyEmail')} onClick={() => { void navigator.clipboard?.writeText(c.defaultEmailAddress!.emailAddress); toast(t('customers.copied')); }}><Copy className="size-3.5" /></Button>}</span>
              <span className="text-muted">{c.defaultPhoneNumber?.phoneNumber ?? ''}</span>
              <div className="mt-1"><MarketingBadge state={c.defaultEmailAddress?.marketingState} /></div>
            </div>
          </Card>
          <Card title={t('customers.addresses')}>{c.addressesV2.nodes.length ? <div className="flex flex-col gap-3">{c.addressesV2.nodes.map((a) => <AddressBlock key={a.id} a={a} />)}</div> : <p className="text-[13px] text-muted">{t('customers.noAddress')}</p>}</Card>
          <Card title={t('field.tags')}><TagInput value={c.tags} onChange={(v) => tags.mutate(v)} removeLabel={t('common.remove')} /></Card>
          <Card title={t('order.notes')}>
            <Textarea aria-label={t('order.notes')} value={note} onChange={(e) => setNote(e.target.value)} />
            <div className="mt-2 flex justify-end"><Button size="sm" disabled={note === (c.note ?? '')} loading={saveNote.isPending} onClick={() => saveNote.mutate()}>{t('save.save')}</Button></div>
          </Card>
        </div>
      </div>
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
