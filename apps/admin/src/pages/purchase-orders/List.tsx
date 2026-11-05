import { Badge, Banner, Button, Card, EmptyState, IndexTable, Pagination, Tabs } from '@shopme/ui';
import type { Column } from '@shopme/ui';
import { useQuery } from '@tanstack/react-query';
import { Plus, Search } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { gql } from '../../api';
import { PageHeader } from '../../components/PageHeader';
import { searchCls, useFormat, useListParams } from '../../components/shared';
import type { Money } from '../../components/shared';
import { gidToNum } from '../../format';
import { PURCHASE_ORDERS } from '../../graphql';
import { useT } from '../../i18n';
import type { Key } from '../../i18n';
import { useDebounced } from '../../lib/hooks';
import type { Connection } from '../../lib/hooks';
import emptyOrders from '../../assets/empty/empty-orders.webp';

export interface PurchaseOrderRow {
  id: string; name: string; status: string; shopmeState: string; dateCreated: string; orderedAt: string | null; shopmeReferenceNumber: string | null; shopmeExpectedArrival: string | null; shopmeTags: string[];
  origin: { supplierName: string | null } | null; destination: { name: string } | null; shopmeTotalQuantity: number; shopmeReceivedQuantity: number; shopmeRejectedQuantity: number;
  shopmeTotals: { total: Money };
}

export const PO_TONE = { DRAFT: 'neutral', ORDERED: 'info', PARTIALLY_RECEIVED: 'attention', RECEIVED: 'success', CLOSED: 'neutral' } as const;
export function PurchaseOrderStateBadge({ state }: { state: string }) {
  const t = useT();
  return <Badge tone={PO_TONE[state as keyof typeof PO_TONE] ?? 'neutral'}>{t(`po.state.${state}` as Key)}</Badge>;
}

const PAGE_SIZE = 25;
const TABS = ['all', 'draft', 'ordered', 'partially_received', 'received', 'closed'] as const;
type Tab = (typeof TABS)[number];

export function PurchaseOrdersPage() {
  const t = useT();
  const nav = useNavigate();
  const fmt = useFormat();
  const L = useListParams();
  const tab = (TABS.includes(L.get('tab') as Tab) ? L.get('tab') : 'all') as Tab;
  const [search, setSearch] = useState(L.get('q'));
  const term = useDebounced(search);
  const terms = [term.trim(), tab !== 'all' && `state:${tab}`, tab === 'closed' || tab === 'received' ? 'archived:true' : ''].filter(Boolean).join(' ');
  const list = useQuery({
    queryKey: ['purchase-orders', terms, L.get('after'), L.get('before')],
    queryFn: () => gql<{ inventoryPurchaseOrders: Connection<PurchaseOrderRow> }>(PURCHASE_ORDERS, { query: terms || null, sortKey: 'ID', reverse: true, ...L.page(PAGE_SIZE) }),
    placeholderData: (p) => p,
  });
  const rows = list.data?.inventoryPurchaseOrders.nodes ?? [];
  const pi = list.data?.inventoryPurchaseOrders.pageInfo;
  const create = <Button variant="primary" onClick={() => nav('/purchase-orders/new')}><Plus className="size-4" />{t('po.create')}</Button>;
  const columns: Array<Column<PurchaseOrderRow>> = [
    { key: 'name', header: t('po.order'), cell: (r) => <div><p className="font-medium">{r.name}</p>{r.shopmeReferenceNumber && <p className="text-xs text-muted">{r.shopmeReferenceNumber}</p>}</div> },
    { key: 'supplier', header: t('po.supplier'), cell: (r) => r.origin?.supplierName ?? '—' },
    { key: 'destination', header: t('po.destination'), cell: (r) => r.destination?.name ?? '—' },
    { key: 'status', header: t('field.status'), cell: (r) => <PurchaseOrderStateBadge state={r.shopmeState} /> },
    { key: 'received', header: t('po.receivedProgress'), className: 'text-right', cell: (r) => <span className="whitespace-nowrap">{t('po.nOfM', { n: r.shopmeReceivedQuantity + r.shopmeRejectedQuantity, m: r.shopmeTotalQuantity })}</span> },
    { key: 'total', header: t('po.total'), className: 'text-right', cell: (r) => <span className="whitespace-nowrap">{fmt.money(r.shopmeTotals.total)}</span> },
    { key: 'arrival', header: t('po.expectedArrival'), cell: (r) => fmt.date(r.shopmeExpectedArrival) },
  ];
  return (
    <>
      <PageHeader back="/products" title={t('nav.purchaseOrders')} actions={create} />
      <Card className="!p-0">
        <div className="px-3 pt-1"><Tabs tabs={TABS.map((id) => ({ id, label: t(`po.tab.${id}` as Key) }))} value={tab} onChange={(v) => L.patch({ tab: v === 'all' ? '' : v })} /></div>
        <div className="border-b border-line p-3">
          <div className="relative max-w-md">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted" />
            <input type="search" value={search} onChange={(e) => { setSearch(e.target.value); L.patch({ q: e.target.value }); }} placeholder={t('po.search')} aria-label={t('po.search')} className={searchCls} />
          </div>
        </div>
        {list.isError && <div className="p-3"><Banner>{(list.error as Error).message}</Banner></div>}
        <IndexTable rows={rows} rowId={(r) => r.id} columns={columns} loading={list.isLoading} onRowClick={(r) => nav(`/purchase-orders/${gidToNum(r.id)}`)}
          selected={[]} onSelectedChange={() => {}} selectedLabel={(n) => t('common.selected', { n })} selectAllLabel={t('common.selectAll')}
          empty={list.isError ? null : terms
            ? <EmptyState icon={<Search className="size-10" />} title={t('products.noResults')} description={t('products.noResultsBody')} />
            : <EmptyState image={emptyOrders} title={t('po.emptyTitle')} description={t('po.emptyBody')} action={create} />} />
        <Pagination hasPrevious={L.get('before') ? !!pi?.hasPreviousPage : !!L.get('after')} hasNext={L.get('before') ? true : !!pi?.hasNextPage}
          previousLabel={t('common.previous')} nextLabel={t('common.next')}
          onPrevious={() => L.patch({ before: pi?.startCursor ?? '', after: '' }, true)} onNext={() => L.patch({ after: pi?.endCursor ?? '', before: '' }, true)} />
      </Card>
    </>
  );
}
