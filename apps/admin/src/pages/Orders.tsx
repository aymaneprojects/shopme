import { Banner, Button, Card, Dropdown, EmptyState, IndexTable, Modal, Pagination, Tabs, TagInput, useToast } from '@shopme/ui';
import type { Column } from '@shopme/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, Search } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { gql, mutate } from '../api';
import { FinancialBadge, FulfillmentBadge, searchCls, selectCls, useFormat, useListParams } from '../components/shared';
import type { MoneySet } from '../components/shared';
import { PageHeader } from '../components/PageHeader';
import { exportHref, startDownload } from '../components/CsvTools';
import { gidToNum } from '../format';
import { ORDERS, ORDERS_COUNT, ORDER_CLOSE, TAGS_ADD } from '../graphql';
import { useT } from '../i18n';
import type { Key } from '../i18n';
import { useDebounced } from '../lib/hooks';
import type { Connection } from '../lib/hooks';
import emptyOrders from '../assets/empty/empty-orders.webp';

export interface OrderRow {
  id: string; name: string; createdAt: string; displayFinancialStatus: string; displayFulfillmentStatus: string; tags: string[];
  cancelledAt: string | null; closedAt: string | null; totalPriceSet: MoneySet; customer: { id: string; displayName: string } | null;
  lineItems: { nodes: Array<{ id: string; quantity: number }> };
}

const PAGE_SIZE = 25;
const TABS = ['all', 'unfulfilled', 'unpaid', 'open', 'closed'] as const;
type Tab = (typeof TABS)[number];
const TAB_QUERY: Record<Tab, string> = { all: '', unfulfilled: 'fulfillment_status:unfulfilled', unpaid: 'financial_status:pending', open: 'status:open', closed: 'status:closed' };
const FINANCIAL = ['PENDING', 'AUTHORIZED', 'PARTIALLY_PAID', 'PAID', 'PARTIALLY_REFUNDED', 'REFUNDED', 'VOIDED'];
const FULFILLMENT = ['UNFULFILLED', 'PARTIALLY_FULFILLED', 'FULFILLED'];
const SORTS = ['CREATED_AT', 'ORDER_NUMBER', 'TOTAL_PRICE', 'CUSTOMER_NAME', 'FINANCIAL_STATUS', 'FULFILLMENT_STATUS'];

export function OrdersPage() {
  const t = useT();
  const nav = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();
  const fmt = useFormat();
  const L = useListParams();
  const tab = (TABS.includes(L.get('tab') as Tab) ? L.get('tab') : 'all') as Tab;
  const [search, setSearch] = useState(L.get('q'));
  const term = useDebounced(search);
  const [selected, setSelected] = useState<string[]>([]);
  const [labels, setLabels] = useState<string[] | null>(null);
  const [tagging, setTagging] = useState<string[] | null>(null);
  const [newTags, setNewTags] = useState<string[]>([]);
  const sort = { key: L.get('sort') || 'CREATED_AT', reverse: L.get('dir') !== 'asc' };

  const terms = [
    term.trim(), TAB_QUERY[tab],
    L.get('fin') && `financial_status:${L.get('fin').toLowerCase()}`, L.get('ful') && `fulfillment_status:${L.get('ful').toLowerCase()}`,
    L.get('from') && `created_at:>=${L.get('from')}`, L.get('to') && `created_at:<=${L.get('to')}`, L.get('tag') && `tag:"${L.get('tag').replace(/"/g, '')}"`,
  ].filter(Boolean).join(' ');

  const list = useQuery({
    queryKey: ['orders', terms, sort, L.get('after'), L.get('before')],
    queryFn: () => gql<{ orders: Connection<OrderRow> }>(ORDERS, { query: terms || null, sortKey: sort.key, reverse: sort.reverse, ...L.page(PAGE_SIZE) }),
    placeholderData: (p) => p,
  });
  const count = useQuery({ queryKey: ['orders-count', terms], queryFn: () => gql<{ ordersCount: { count: number } }>(ORDERS_COUNT, { query: terms || null }) });

  const bulk = useMutation({
    mutationFn: async ({ ids, action, tags }: { ids: string[]; action: 'close' | 'tag'; tags?: string[] }) => {
      await Promise.all(ids.map((id) => (action === 'close' ? mutate(ORDER_CLOSE, { input: { id } }, 'orderClose') : mutate(TAGS_ADD, { id, tags }, 'tagsAdd'))));
    },
    onSuccess: (_d, v) => { toast(t('orders.bulkDone', { n: v.ids.length })); setSelected([]); void qc.invalidateQueries({ queryKey: ['orders'] }); },
    onError: (e) => toast(e.message, 'critical'),
  });

  const rows = list.data?.orders.nodes ?? [];
  const pi = list.data?.orders.pageInfo;
  const hasFilters = !!terms;
  const columns: Array<Column<OrderRow>> = [
    { key: 'name', header: t('orders.order'), sortKey: 'ORDER_NUMBER', cell: (o) => <span className="font-medium">{o.name}</span> },
    { key: 'date', header: t('orders.date'), sortKey: 'CREATED_AT', cell: (o) => fmt.date(o.createdAt) },
    { key: 'cust', header: t('orders.customer'), sortKey: 'CUSTOMER_NAME', cell: (o) => o.customer?.displayName ?? <span className="text-muted">{t('orders.noCustomer')}</span> },
    { key: 'total', header: t('orders.total'), sortKey: 'TOTAL_PRICE', cell: (o) => fmt.money(o.totalPriceSet) },
    { key: 'pay', header: t('orders.payment'), sortKey: 'FINANCIAL_STATUS', cell: (o) => <FinancialBadge status={o.displayFinancialStatus} /> },
    { key: 'ful', header: t('orders.fulfillment'), sortKey: 'FULFILLMENT_STATUS', cell: (o) => <FulfillmentBadge status={o.displayFulfillmentStatus} /> },
    { key: 'items', header: t('orders.items'), cell: (o) => o.lineItems.nodes.reduce((n, l) => n + l.quantity, 0) },
    { key: 'tags', header: t('field.tags'), cell: (o) => <span className="text-muted">{o.tags.join(', ')}</span> },
  ];
  const sel = (key: string, label: string, items: string[], prefix: string) => (
    <select aria-label={label} value={L.get(key)} onChange={(e) => L.patch({ [key]: e.target.value })} className={selectCls}>
      <option value="">{label}</option>
      {items.map((i) => <option key={i} value={i}>{t(`${prefix}.${i}` as Key)}</option>)}
    </select>
  );

  return (
    <>
      <PageHeader title={t('nav.orders')} actions={<>{count.data && <span className="text-[13px] text-muted">{t('orders.count', { n: count.data.ordersCount.count })}</span>}<Dropdown align="right" label={t('orders.exportMenu')} trigger={<><Download className="size-4" />{t('csv.export')}</>} items={[
          ...(hasFilters && count.data ? [{ key: 'filtered', label: t('orders.exportFiltered', { n: count.data.ordersCount.count }), onSelect: () => startDownload(exportHref('orders', { query: terms })) }] : []),
          { key: 'all', label: t('orders.exportAll'), onSelect: () => startDownload(exportHref('orders')) },
        ]} /><Button variant="primary" onClick={() => nav('/orders/drafts/new')}>{t('draft.create')}</Button></>} />
      <Card className="!p-0">
        <div className="px-3 pt-1"><Tabs tabs={TABS.map((id) => ({ id, label: t(`orders.tab.${id}` as Key) }))} value={tab} onChange={(v) => { setSelected([]); L.patch({ tab: v === 'all' ? '' : v }); }} /></div>
        <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
          <div className="relative min-w-48 flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-2 size-4 text-muted" />
            <input type="search" value={search} onChange={(e) => { setSearch(e.target.value); L.patch({ q: e.target.value }); }} placeholder={t('orders.search')} aria-label={t('orders.search')} className={searchCls} />
          </div>
          {sel('fin', t('orders.payment'), FINANCIAL, 'fin')}
          {sel('ful', t('orders.fulfillment'), FULFILLMENT, 'ful')}
          <input type="date" aria-label={t('orders.from')} value={L.get('from')} onChange={(e) => L.patch({ from: e.target.value })} className={selectCls} />
          <input type="date" aria-label={t('orders.to')} value={L.get('to')} onChange={(e) => L.patch({ to: e.target.value })} className={selectCls} />
          <input type="text" aria-label={t('field.tags')} placeholder={t('field.tags')} value={L.get('tag')} onChange={(e) => L.patch({ tag: e.target.value })} className={`${selectCls} w-28`} />
          <select aria-label={t('common.sort')} value={sort.key} onChange={(e) => L.patch({ sort: e.target.value })} className={selectCls}>
            {SORTS.map((s) => <option key={s} value={s}>{t(`orders.sort.${s}` as Key)}</option>)}
          </select>
        </div>
        {list.isError && <div className="p-3"><Banner>{(list.error as Error).message}</Banner></div>}
        <IndexTable
          rows={rows} rowId={(r) => r.id} columns={columns} loading={list.isLoading}
          selected={selected} onSelectedChange={setSelected} selectedLabel={(n) => t('common.selected', { n })} selectAllLabel={t('common.selectAll')}
          sort={sort} onSortChange={(s) => L.patch({ sort: s.key, dir: s.reverse ? '' : 'asc' })}
          onRowClick={(r) => nav(`/orders/${gidToNum(r.id)}`)}
          bulkActions={[
            { key: 'tag', label: t('orders.addTags'), onRun: (ids) => { setNewTags([]); setTagging(ids); } },
            { key: 'labels', label: t('orders.createLabels'), onRun: (ids) => setLabels(ids) },
            { key: 'export', label: t('orders.exportSelected'), onRun: (ids) => startDownload(exportHref('orders', { ids: ids.map(gidToNum).join(',') })) },
            { key: 'close', label: t('orders.archive'), onRun: (ids) => bulk.mutate({ ids, action: 'close' }) },
          ]}
          empty={list.isError ? null : hasFilters
            ? <EmptyState icon={<Search className="size-10" />} title={t('products.noResults')} description={t('products.noResultsBody')} action={<Button onClick={() => { setSearch(''); L.clear(); }}>{t('products.clearFilters')}</Button>} />
            : <EmptyState image={emptyOrders} title={t('orders.emptyTitle')} description={t('orders.emptyBody')} />}
        />
        <Pagination hasPrevious={L.get('before') ? !!pi?.hasPreviousPage : !!L.get('after')} hasNext={L.get('before') ? true : !!pi?.hasNextPage}
          previousLabel={t('common.previous')} nextLabel={t('common.next')}
          onPrevious={() => L.patch({ before: pi?.startCursor ?? '', after: '' }, true)} onNext={() => L.patch({ after: pi?.endCursor ?? '', before: '' }, true)} />
      </Card>
      <Modal open={!!labels} onClose={() => setLabels(null)} title={t('orders.labelsTitle')} closeLabel={t('common.close')}
        footer={<><Button onClick={() => setLabels(null)}>{t('common.close')}</Button><Button variant="primary" onClick={() => { const id = labels?.[0]; setLabels(null); if (id) nav(`/orders/${gidToNum(id)}`); }}>{t('orders.addTrackingManually')}</Button></>}>
        <p className="text-[13px]">{t('orders.labelsBody')}</p>
      </Modal>
      <Modal open={!!tagging} onClose={() => setTagging(null)} title={t('orders.addTags')} closeLabel={t('common.close')}
        footer={<><Button onClick={() => setTagging(null)}>{t('common.cancel')}</Button><Button variant="primary" disabled={!newTags.length} onClick={() => { if (tagging) bulk.mutate({ ids: tagging, action: 'tag', tags: newTags }); setTagging(null); }}>{t('common.apply')}</Button></>}>
        <TagInput label={t('field.tags')} value={newTags} onChange={setNewTags} removeLabel={t('common.remove')} />
      </Modal>
    </>
  );
}
