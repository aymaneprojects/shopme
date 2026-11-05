import { Banner, Button, Card, Dropdown, EmptyState, IndexTable, Input, ListToolbar, Modal, Pagination, Popover, TagInput, useToast } from '@shopme/ui';
import type { BulkAction, Column, ToolbarFilter } from '@shopme/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowUpDown, Check, ChevronDown, Download, Inbox, MapPin, Search, TriangleAlert } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { gql, mutate } from '../api';
import { ColumnPicker, useColumnVisibility } from '../components/ColumnPicker';
import { FinancialBadge, FulfillmentBadge, useFormat, useListParams } from '../components/shared';
import type { MoneySet } from '../components/shared';
import { PageHeader } from '../components/PageHeader';
import { exportHref, startDownload } from '../components/CsvTools';
import { ViewTabs } from '../components/SavedViews';
import { gidToNum } from '../format';
import { BATCH_CREATE, BATCH_MOVE, ORDERS_CAPTURE, ORDERS_COUNT, ORDERS_FILTER_OPTIONS, ORDERS_LIST, ORDERS_MARK_AS, ORDER_CLOSE, ORDER_MARK_AS_PAID, TAGS_ADD, TAGS_REMOVE } from '../graphql';
import { useT } from '../i18n';
import type { Key } from '../i18n';
import { useDebounced } from '../lib/hooks';
import type { Connection } from '../lib/hooks';
import { STAT_RANGES } from '../lib/dateRange';
import type { StatRange } from '../lib/dateRange';
import { usePrintOrders } from '../lib/orderPrint';
import { OrdersStats } from './orders/OrdersStats';
import emptyOrders from '../assets/empty/empty-orders.webp';

export interface OrderRow {
  id: string; name: string; createdAt: string; displayFinancialStatus: string; displayFulfillmentStatus: string; tags: string[];
  cancelledAt: string | null; closedAt: string | null; totalPriceSet: MoneySet; customer: { id: string; displayName: string } | null;
  lineItems: { nodes: Array<{ id: string; title?: string; quantity: number }> };
  sourceName?: string | null; poNumber?: string | null; test?: boolean; capturable?: boolean;
  shopmeAddressProblems?: string[]; shopmeDeliveryStatus?: string; shopmeDeliveryMethod?: string | null; shopmeFulfillBy?: string | null;
  shopmeBatch?: { id: string; name: string } | null; shopmeLocation?: { id: string; name: string } | null;
}

const PAGE_SIZE = 25;
const TABS = ['all', 'unfulfilled', 'unpaid', 'open', 'closed'] as const;
type Tab = (typeof TABS)[number];
const TAB_QUERY: Record<Tab, string> = { all: '', unfulfilled: 'fulfillment_status:unfulfilled', unpaid: 'financial_status:pending', open: 'status:open', closed: 'status:closed' };
const FINANCIAL = ['PENDING', 'AUTHORIZED', 'PARTIALLY_PAID', 'PAID', 'PARTIALLY_REFUNDED', 'REFUNDED', 'VOIDED'];
const FULFILLMENT = ['UNFULFILLED', 'IN_PROGRESS', 'PARTIALLY_FULFILLED', 'FULFILLED', 'ON_HOLD'];
const DELIVERY = ['NOT_FULFILLED', 'IN_TRANSIT', 'DELIVERED'];
const CHANNELS = ['web', 'draft', 'manual', 'pos'];
const MARK_AS = ['UNFULFILLED', 'IN_PROGRESS', 'FULFILLED', 'ON_HOLD', 'DELIVERED'] as const;
const SORTS = ['CREATED_AT', 'ORDER_NUMBER', 'TOTAL_PRICE', 'CUSTOMER_NAME', 'FINANCIAL_STATUS', 'FULFILLMENT_STATUS'];
/** Columns that are off until the user turns them on from the column chooser. */
const DEFAULT_HIDDEN = ['fulfillBy', 'channel', 'delivery', 'method', 'location', 'batch', 'po', 'tags'];

interface BulkResult { succeeded: number; results: Array<{ orderId: string; ok: boolean; message: string | null }> }

/** "3 items" with a chevron: opens the list of what was ordered. */
function ItemsCell({ o }: { o: OrderRow }) {
  const t = useT();
  const n = o.lineItems.nodes.reduce((s, l) => s + l.quantity, 0);
  return (
    <span onClick={(e) => e.stopPropagation()}>
      <Popover label={t('btn.orders.itemsList')} trigger={<>{t('btn.orders.items', { n, $count: n })}<ChevronDown className="size-3" /></>} triggerVariant="plain" triggerClassName="!h-6 !px-1.5 !text-[13px] !font-normal" className="w-64">
        <ul className="flex flex-col gap-1 text-[13px]">{o.lineItems.nodes.map((l) => <li key={l.id} className="flex justify-between gap-3"><span className="truncate">{l.title}</span><span className="shrink-0 text-muted">× {l.quantity}</span></li>)}</ul>
      </Popover>
    </span>
  );
}

export function OrdersPage() {
  const t = useT();
  const nav = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();
  const fmt = useFormat();
  const L = useListParams();
  const print = usePrintOrders();
  const tab = (TABS.includes(L.get('tab') as Tab) ? L.get('tab') : 'all') as Tab;
  const range = (STAT_RANGES.includes(L.get('range') as StatRange) ? L.get('range') : 'today') as StatRange;
  const [search, setSearch] = useState(L.get('q'));
  const term = useDebounced(search);
  const urlQ = L.get('q');
  useEffect(() => { setSearch(urlQ); }, [urlQ]); // a saved view changed the search
  const [selected, setSelected] = useState<string[]>([]);
  const [tagging, setTagging] = useState<{ ids: string[]; mode: 'add' | 'remove' } | null>(null);
  const [batching, setBatching] = useState<string[] | null>(null);
  const [batchName, setBatchName] = useState('');
  const [newTags, setNewTags] = useState<string[]>([]);
  const cols = useColumnVisibility('orders', DEFAULT_HIDDEN);
  const sort = { key: L.get('sort') || 'CREATED_AT', reverse: L.get('dir') !== 'asc' };
  const options = useQuery({ queryKey: ['orders-filter-options'], staleTime: 60_000, queryFn: () => gql<{ locations: { nodes: Array<{ id: string; name: string; isActive: boolean }> }; shopmeOrderBatches: Array<{ id: string; name: string; orderCount: number }> }>(ORDERS_FILTER_OPTIONS) });
  const locations = (options.data?.locations.nodes ?? []).filter((l) => l.isActive);
  const batches = options.data?.shopmeOrderBatches ?? [];
  const loc = L.get('loc');

  const terms = [
    term.trim(), TAB_QUERY[tab],
    L.get('fin') && `financial_status:${L.get('fin').toLowerCase()}`, L.get('ful') && `fulfillment_status:${L.get('ful').toLowerCase()}`,
    L.get('del') && `delivery_status:${L.get('del').toLowerCase()}`, L.get('channel') && `channel:${L.get('channel')}`,
    L.get('batch') && `batch_id:${gidToNum(L.get('batch'))}`, loc && `location_id:${gidToNum(loc)}`,
    L.get('method') && `delivery_method:"${L.get('method').replace(/"/g, '')}"`, L.get('po') && `po_number:"${L.get('po').replace(/"/g, '')}"`, L.get('test') && `test:${L.get('test')}`,
    L.get('from') && `created_at:>=${L.get('from')}`, L.get('to') && `created_at:<=${L.get('to')}`, L.get('tag') && `tag:"${L.get('tag').replace(/"/g, '')}"`,
  ].filter(Boolean).join(' ');

  const list = useQuery({
    queryKey: ['orders', terms, sort, L.get('after'), L.get('before')],
    queryFn: () => gql<{ orders: Connection<OrderRow> }>(ORDERS_LIST, { query: terms || null, sortKey: sort.key, reverse: sort.reverse, ...L.page(PAGE_SIZE) }),
    placeholderData: (p) => p,
  });
  const count = useQuery({ queryKey: ['orders-count', terms], queryFn: () => gql<{ ordersCount: { count: number } }>(ORDERS_COUNT, { query: terms || null }) });
  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: ['orders'] }), qc.invalidateQueries({ queryKey: ['orders-stats'] }), qc.invalidateQueries({ queryKey: ['orders-filter-options'] }), qc.invalidateQueries({ queryKey: ['orders-count'] })]);

  const bulk = useMutation({
    mutationFn: async ({ ids, action, tags }: { ids: string[]; action: 'close' | 'tag' | 'untag' | 'paid'; tags?: string[] }) => {
      await Promise.all(ids.map(async (id) => {
        if (action === 'close') return mutate(ORDER_CLOSE, { input: { id } }, 'orderClose');
        if (action === 'tag') return mutate(TAGS_ADD, { id, tags }, 'tagsAdd');
        if (action === 'untag') return mutate(TAGS_REMOVE, { id, tags }, 'tagsRemove');
        return mutate(ORDER_MARK_AS_PAID, { input: { id } }, 'orderMarkAsPaid');
      }));
    },
    onSuccess: (_d, v) => { toast(t('orders.bulkDone', { n: v.ids.length })); setSelected([]); void refresh(); },
    onError: (e) => toast(e.message, 'critical'),
  });
  const report = (r: BulkResult, done: Key) => {
    const failed = r.results.filter((x) => !x.ok);
    if (failed.length) toast(t('btn.bulk.partial', { ok: r.succeeded, failed: failed.length, reason: failed[0]!.message ?? '' }), r.succeeded ? undefined : 'critical');
    else toast(t(done, { n: r.succeeded }));
    setSelected([]); void refresh();
  };
  const markAs = useMutation({
    mutationFn: ({ ids, status }: { ids: string[]; status: (typeof MARK_AS)[number] }) => mutate<BulkResult>(ORDERS_MARK_AS, { ids, status }, 'shopmeOrdersMarkAs'),
    onSuccess: (r) => report(r, 'btn.bulk.markedDone'), onError: (e) => toast(e.message, 'critical'),
  });
  const capture = useMutation({
    mutationFn: (ids: string[]) => mutate<BulkResult>(ORDERS_CAPTURE, { ids }, 'shopmeOrdersCapture'),
    onSuccess: (r) => report(r, 'btn.bulk.capturedDone'), onError: (e) => toast(e.message, 'critical'),
  });
  const moveBatch = useMutation({
    mutationFn: ({ ids, batchId }: { ids: string[]; batchId: string | null }) => mutate<{ moved: number }>(BATCH_MOVE, { batchId, orderIds: ids }, 'shopmeOrdersMoveToBatch'),
    onSuccess: (r) => { toast(t('btn.bulk.movedDone', { n: r.moved })); setSelected([]); void refresh(); }, onError: (e) => toast(e.message, 'critical'),
  });
  const createBatch = useMutation({
    mutationFn: ({ ids, name }: { ids: string[]; name: string }) => mutate<{ batch: { name: string } }>(BATCH_CREATE, { name: name.trim() || null, orderIds: ids }, 'shopmeOrderBatchCreate'),
    onSuccess: (r) => { toast(t('btn.bulk.batchCreated', { name: r.batch.name })); setBatching(null); setBatchName(''); setSelected([]); void refresh(); }, onError: (e) => toast(e.message, 'critical'),
  });

  const rows = list.data?.orders.nodes ?? [];
  const pi = list.data?.orders.pageInfo;
  const hasFilters = !!terms;
  const channelName = (s?: string | null) => (({ web: t('qa.channel.web'), draft: t('qa.channel.draft'), draft_order: t('qa.channel.draft'), shopify_draft_order: t('qa.channel.draft'), manual: t('qa.channel.manual'), pos: t('qa.channel.pos'), subscription_contract: t('sub.channel') }) as Record<string, string>)[s ?? 'web'] ?? s ?? '';
  const columns: Array<Column<OrderRow>> = [
    {
      key: 'name', header: t('orders.order'), sortKey: 'ORDER_NUMBER',
      cell: (o) => (
        <span className="flex items-center gap-1.5 font-medium">
          {o.name}
          {!!o.shopmeAddressProblems?.length && <span title={t('btn.orders.addressWarning')} role="img" aria-label={t('btn.orders.addressWarning')} className="text-warning"><TriangleAlert className="size-3.5" /></span>}
          {o.test && <span className="rounded bg-surface px-1 text-[11px] font-normal text-muted">{t('btn.orders.test')}</span>}
        </span>
      ),
    },
    { key: 'date', header: t('orders.date'), sortKey: 'CREATED_AT', cell: (o) => fmt.date(o.createdAt) },
    { key: 'fulfillBy', header: t('btn.orders.col.fulfillBy'), cell: (o) => (o.shopmeFulfillBy ? fmt.date(o.shopmeFulfillBy) : <span className="text-muted">—</span>) },
    { key: 'cust', header: t('orders.customer'), sortKey: 'CUSTOMER_NAME', cell: (o) => o.customer?.displayName ?? <span className="text-muted">{t('orders.noCustomer')}</span> },
    { key: 'channel', header: t('btn.orders.col.channel'), cell: (o) => channelName(o.sourceName) },
    { key: 'total', header: t('orders.total'), sortKey: 'TOTAL_PRICE', cell: (o) => fmt.money(o.totalPriceSet) },
    { key: 'pay', header: t('orders.payment'), sortKey: 'FINANCIAL_STATUS', cell: (o) => <FinancialBadge status={o.displayFinancialStatus} /> },
    { key: 'ful', header: t('orders.fulfillment'), sortKey: 'FULFILLMENT_STATUS', cell: (o) => <FulfillmentBadge status={o.displayFulfillmentStatus} /> },
    { key: 'items', header: t('orders.items'), cell: (o) => <ItemsCell o={o} /> },
    { key: 'delivery', header: t('btn.orders.col.deliveryStatus'), cell: (o) => (o.shopmeDeliveryStatus ? t(`btn.delivery.${o.shopmeDeliveryStatus}` as Key) : '') },
    { key: 'method', header: t('btn.orders.col.deliveryMethod'), cell: (o) => o.shopmeDeliveryMethod ?? <span className="text-muted">—</span> },
    { key: 'location', header: t('btn.orders.col.location'), cell: (o) => o.shopmeLocation?.name ?? <span className="text-muted">—</span> },
    { key: 'batch', header: t('btn.orders.col.batch'), cell: (o) => o.shopmeBatch?.name ?? <span className="text-muted">—</span> },
    { key: 'po', header: t('btn.orders.col.po'), cell: (o) => o.poNumber ?? <span className="text-muted">—</span> },
    { key: 'tags', header: t('field.tags'), cell: (o) => <span className="text-muted">{o.tags.join(', ')}</span> },
  ];

  const opts = (items: string[], key: (v: string) => Key) => items.map((v) => ({ value: v, label: t(key(v)) }));
  const filters: ToolbarFilter[] = [
    { key: 'fin', label: t('orders.payment'), options: opts(FINANCIAL, (v) => `fin.${v}` as Key) },
    { key: 'ful', label: t('orders.fulfillment'), options: opts(FULFILLMENT, (v) => `ful.${v}` as Key) },
    { key: 'del', label: t('btn.filter.delivery'), options: opts(DELIVERY, (v) => `btn.delivery.${v}` as Key) },
    { key: 'channel', label: t('btn.filter.channel'), options: CHANNELS.map((c) => ({ value: c, label: channelName(c) })) },
    { key: 'batch', label: t('btn.filter.batch'), options: [{ value: 'gid://shopify/ShopmeOrderBatch/none', label: t('btn.filter.noBatch') }, ...batches.map((b) => ({ value: b.id, label: b.name }))] },
    { key: 'tag', label: t('field.tags'), options: [], text: true },
    { key: 'method', label: t('btn.orders.col.deliveryMethod'), options: [], text: true },
    { key: 'po', label: t('btn.orders.col.po'), options: [], text: true },
    { key: 'from', label: t('btn.filter.from'), options: [], date: true },
    { key: 'to', label: t('btn.filter.to'), options: [], date: true },
    { key: 'test', label: t('btn.filter.test'), options: [{ value: 'true', label: t('btn.filter.testOnly') }, { value: 'false', label: t('btn.filter.noTest') }] },
  ];
  const values = Object.fromEntries(filters.map((f) => [f.key, L.get(f.key)]));

  const nums = (ids: string[]) => ids.map(gidToNum).join(',');
  const selRows = rows.filter((r) => selected.includes(r.id));
  const bulkActions: BulkAction[] = [
    {
      key: 'print', label: t('btn.bulk.print'), onRun: () => undefined,
      menu: [
        { key: 'order', label: t('btn.bulk.printOrders'), onRun: (ids) => void print(ids, ['order']) },
        { key: 'packing', label: t('btn.bulk.printPacking'), onRun: (ids) => void print(ids, ['packing']) },
        { key: 'invoice', label: t('btn.bulk.printInvoices'), onRun: (ids) => void print(ids, ['invoice']) },
      ],
    },
    { key: 'labels', label: t('orders.createLabels'), onRun: (ids) => nav(`/orders/shipping-labels?orders=${nums(ids)}`) },
    {
      key: 'markAs', label: t('qa.markAs'), onRun: () => undefined,
      menu: [
        ...MARK_AS.map((s) => ({ key: s, label: t(`btn.mark.${s}` as Key), onRun: (ids: string[]) => markAs.mutate({ ids, status: s }) })),
        { key: 'paid', label: t('order.markPaid'), separatorBefore: true, onRun: (ids: string[]) => bulk.mutate({ ids, action: 'paid' }) },
      ],
    },
    { key: 'capture', label: t('btn.bulk.capture'), disabled: !selRows.some((r) => r.capturable), onRun: (ids) => capture.mutate(ids) },
    {
      key: 'batch', label: t('btn.bulk.batch'), onRun: () => undefined,
      menu: [
        { key: 'create', label: t('btn.bulk.createBatch'), onRun: (ids) => { setBatchName(''); setBatching(ids); } },
        ...batches.map((b, i) => ({ key: `to-${b.id}`, label: t('btn.bulk.moveTo', { name: b.name }), separatorBefore: i === 0, onRun: (ids: string[]) => moveBatch.mutate({ ids, batchId: b.id }) })),
        { key: 'remove', label: t('btn.bulk.removeFromBatch'), separatorBefore: true, onRun: (ids) => moveBatch.mutate({ ids, batchId: null }) },
      ],
    },
    { key: 'tag', label: t('orders.addTags'), onRun: (ids) => { setNewTags([]); setTagging({ ids, mode: 'add' }); } },
    { key: 'untag', label: t('products.removeTags'), onRun: (ids) => { setNewTags([]); setTagging({ ids, mode: 'remove' }); } },
    { key: 'export', label: t('orders.exportSelected'), onRun: (ids) => startDownload(exportHref('orders', { ids: nums(ids) })) },
    { key: 'close', label: t('orders.archive'), onRun: (ids) => bulk.mutate({ ids, action: 'close' }) },
  ];
  const locationName = locations.find((l) => l.id === loc)?.name;

  return (
    <>
      <PageHeader icon={<Inbox className="size-4" />} title={t('nav.orders')} actions={<>
        {count.data && <span className="text-[13px] text-muted">{t('orders.count', { n: count.data.ordersCount.count })}</span>}
        {locations.length > 1 && (
          <Dropdown align="right" chevron label={t('btn.orders.locationFilter')} trigger={<><MapPin className="size-4" />{locationName ?? t('btn.orders.allLocations')}</>}
            items={[{ key: 'all', label: t('btn.orders.allLocations'), icon: !loc ? <Check className="size-4" /> : undefined, onSelect: () => L.patch({ loc: '' }) },
              ...locations.map((l) => ({ key: l.id, label: l.name, icon: loc === l.id ? <Check className="size-4" /> : undefined, onSelect: () => L.patch({ loc: l.id }) }))]} />
        )}
        <Dropdown align="right" label={t('orders.exportMenu')} trigger={<><Download className="size-4" />{t('csv.export')}</>} items={[
          ...(hasFilters && count.data ? [{ key: 'filtered', label: t('orders.exportFiltered', { n: count.data.ordersCount.count }), onSelect: () => startDownload(exportHref('orders', { query: terms })) }] : []),
          { key: 'all', label: t('orders.exportAll'), onSelect: () => startDownload(exportHref('orders')) },
        ]} />
        <Button variant="primary" onClick={() => nav('/orders/drafts/new')}>{t('draft.create')}</Button>
      </>} />
      <OrdersStats range={range} onRange={(r) => L.patch({ range: r === 'today' ? '' : r }, true)} locationId={loc ? gidToNum(loc) : ''} />
      <Card className="!p-0">
        <ListToolbar
          className="!rounded-b-none !shadow-none border-b border-line"
          leading={<ViewTabs resource="ORDER" query={terms} tabs={TABS.map((id) => ({ id, label: t(`orders.tab.${id}` as Key) }))} value={tab} onTab={(v) => { setSelected([]); L.patch({ tab: v === 'all' ? '' : v, view: '' }); }} />}
          query={search} onQuery={(v) => { setSearch(v); L.patch({ q: v }); }} placeholder={t('list.searchAndFilter')}
          filters={filters} values={values} onFilter={(k, v) => L.patch({ [k]: v })} removeFilterLabel={t('list.removeFilter')}
          trailing={<>
            <Dropdown align="right" variant="plain" size="sm" icon className="btn-neutral" label={t('common.sort')} trigger={<ArrowUpDown className="size-4" />}
              items={SORTS.map((k) => ({ key: k, label: t(`orders.sort.${k}` as Key), icon: sort.key === k ? <Check className="size-4" /> : undefined, onSelect: () => L.patch({ sort: k }) }))} />
            <ColumnPicker locked={['name']} columns={columns} hidden={cols.hidden} onToggle={cols.toggle} />
          </>}
        />
        {list.isError && <div className="p-3"><Banner>{(list.error as Error).message}</Banner></div>}
        <IndexTable
          rows={rows} rowId={(r) => r.id} columns={cols.filter(columns)} loading={list.isLoading}
          selected={selected} onSelectedChange={setSelected} selectedLabel={(n) => t('common.selected', { n })} selectAllLabel={t('common.selectAll')}
          sort={sort} onSortChange={(s) => L.patch({ sort: s.key, dir: s.reverse ? '' : 'asc' })}
          onRowClick={(r) => nav(`/orders/${gidToNum(r.id)}`)}
          bulkInline={6} moreLabel={t('list.moreBulk')} selectPageLabel={(n) => t('list.selectPage', { n })} deselectLabel={t('list.deselectAll')} showSelectedLabel={t('list.showSelected')}
          bulkActions={bulkActions}
          empty={list.isError ? null : hasFilters
            ? <EmptyState icon={<Search className="size-10" />} title={t('products.noResults')} description={t('products.noResultsBody')} action={<Button onClick={() => { setSearch(''); L.clear(); }}>{t('products.clearFilters')}</Button>} />
            : <EmptyState image={emptyOrders} title={t('orders.emptyTitle')} description={t('orders.emptyBody')} />}
        />
        <Pagination hasPrevious={L.get('before') ? !!pi?.hasPreviousPage : !!L.get('after')} hasNext={L.get('before') ? true : !!pi?.hasNextPage}
          previousLabel={t('common.previous')} nextLabel={t('common.next')}
          onPrevious={() => L.patch({ before: pi?.startCursor ?? '', after: '' }, true)} onNext={() => L.patch({ after: pi?.endCursor ?? '', before: '' }, true)} />
      </Card>
      <Modal open={!!batching} onClose={() => setBatching(null)} title={t('btn.bulk.createBatch')} closeLabel={t('common.close')}
        footer={<><Button onClick={() => setBatching(null)}>{t('common.cancel')}</Button><Button variant="primary" loading={createBatch.isPending} onClick={() => batching && createBatch.mutate({ ids: batching, name: batchName })}>{t('btn.bulk.createBatchConfirm')}</Button></>}>
        <p className="mb-3 text-[13px] text-muted">{t('btn.bulk.batchHelp', { n: batching?.length ?? 0 })}</p>
        <Input label={t('btn.bulk.batchName')} value={batchName} maxLength={100} placeholder={t('btn.bulk.batchNamePlaceholder')} onChange={(e) => setBatchName(e.target.value)} />
      </Modal>
      <Modal open={!!tagging} onClose={() => setTagging(null)} title={tagging?.mode === 'remove' ? t('products.removeTags') : t('orders.addTags')} closeLabel={t('common.close')}
        footer={<><Button onClick={() => setTagging(null)}>{t('common.cancel')}</Button><Button variant="primary" disabled={!newTags.length} onClick={() => { if (tagging) bulk.mutate({ ids: tagging.ids, action: tagging.mode === 'add' ? 'tag' : 'untag', tags: newTags }); setTagging(null); }}>{t('common.apply')}</Button></>}>
        <TagInput label={t('field.tags')} value={newTags} onChange={setNewTags} removeLabel={t('common.remove')} />
      </Modal>
    </>
  );
}
