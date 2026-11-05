import { Banner, Button, Card, EmptyState, IndexTable, ListToolbar, Pagination } from '@shopme/ui';
import type { Column } from '@shopme/ui';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeftRight, Search } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { gql } from '../../api';
import { PageHeader } from '../../components/PageHeader';
import { LearnMore } from '../../components/LearnMore';
import { useFormat, useListParams } from '../../components/shared';
import { gidToNum } from '../../format';
import { TRANSFERS } from '../../graphql';
import { useT } from '../../i18n';
import type { Key } from '../../i18n';
import { useDebounced } from '../../lib/hooks';
import type { Connection } from '../../lib/hooks';
import emptyProducts from '../../assets/empty/empty-products.webp';
import { TransferStatusBadge } from './shared';

export interface TransferRow {
  id: string; name: string; status: string; dateCreated: string | null; referenceName: string | null; tags: string[]; totalQuantity: number; receivedQuantity: number;
  origin: { name: string } | null; destination: { name: string } | null; shipments: { nodes: Array<{ id: string; tracking: { arrivesAt: string | null } | null }> };
}

const PAGE_SIZE = 25;
const TABS = ['all', 'DRAFT', 'READY_TO_SHIP', 'IN_PROGRESS', 'TRANSFERRED', 'CANCELED'] as const;
type Tab = (typeof TABS)[number];

export function TransfersPage() {
  const t = useT();
  const nav = useNavigate();
  const fmt = useFormat();
  const L = useListParams();
  const tab = (TABS.includes(L.get('tab') as Tab) ? L.get('tab') : 'all') as Tab;
  const [search, setSearch] = useState(L.get('q'));
  const term = useDebounced(search);
  const terms = [term.trim(), tab !== 'all' && `status:${tab}`].filter(Boolean).join(' ');
  const list = useQuery({
    queryKey: ['transfers', terms, L.get('after'), L.get('before')],
    queryFn: () => gql<{ inventoryTransfers: Connection<TransferRow> }>(TRANSFERS, { query: terms || null, sortKey: 'ID', reverse: true, ...L.page(PAGE_SIZE) }),
    placeholderData: (p) => p,
  });
  const rows = list.data?.inventoryTransfers.nodes ?? [];
  const pi = list.data?.inventoryTransfers.pageInfo;
  const create = <Button variant="primary" onClick={() => nav('/transfers/new')}>{t('transfers.create')}</Button>;
  const arrival = (r: TransferRow) => {
    const dates = r.shipments.nodes.map((s) => s.tracking?.arrivesAt).filter((d): d is string => !!d).sort();
    return dates[0] ? fmt.date(dates[0]) : '—';
  };
  const columns: Array<Column<TransferRow>> = [
    { key: 'name', header: t('transfers.transfer'), cell: (r) => <div><p className="font-medium">{r.name}</p>{r.referenceName && <p className="text-xs text-muted">{r.referenceName}</p>}</div> },
    { key: 'origin', header: t('transfers.origin'), cell: (r) => r.origin?.name ?? '—' },
    { key: 'destination', header: t('transfers.destination'), cell: (r) => r.destination?.name ?? '—' },
    { key: 'status', header: t('field.status'), cell: (r) => <TransferStatusBadge status={r.status} /> },
    { key: 'items', header: t('transfers.items'), className: 'text-right', cell: (r) => <span className="whitespace-nowrap">{r.receivedQuantity} / {r.totalQuantity}</span> },
    { key: 'arrival', header: t('transfers.expectedArrival'), cell: arrival },
    { key: 'tags', header: t('field.tags'), cell: (r) => <span className="text-muted">{r.tags.join(', ')}</span> },
  ];
  const empty = !list.isLoading && !list.isError && rows.length === 0 && !terms;
  return (
    <>
      <PageHeader icon={<ArrowLeftRight className="size-4" />} title={t('nav.transfers')} actions={empty ? undefined : create} />
      <Card className="!p-0">
        {!empty && (
          <ListToolbar
            className="!rounded-b-none !shadow-none border-b border-line" viewsLabel={t('list.views')}
            views={TABS.map((id) => ({ id, label: t(`transfers.tab.${id}` as Key) }))} view={tab} onView={(v) => L.patch({ tab: v === 'all' ? '' : v })}
            query={search} onQuery={(v) => { setSearch(v); L.patch({ q: v }); }} placeholder={t('list.searchAndFilter')} />
        )}
        {list.isError && <div className="p-3"><Banner>{(list.error as Error).message}</Banner></div>}
        {empty
          ? <EmptyState image={emptyProducts} title={t('transfers.emptyTitle')} description={t('transfers.emptyBody')} action={create} />
          : <IndexTable rows={rows} rowId={(r) => r.id} columns={columns} loading={list.isLoading} onRowClick={(r) => nav(`/transfers/${gidToNum(r.id)}`)}
            empty={list.isError ? null : <EmptyState icon={<Search className="size-10" />} title={t('products.noResults')} description={t('products.noResultsBody')} />} />}
        <Pagination hasPrevious={L.get('before') ? !!pi?.hasPreviousPage : !!L.get('after')} hasNext={L.get('before') ? true : !!pi?.hasNextPage}
          previousLabel={t('common.previous')} nextLabel={t('common.next')}
          onPrevious={() => L.patch({ before: pi?.startCursor ?? '', after: '' }, true)} onNext={() => L.patch({ after: pi?.endCursor ?? '', before: '' }, true)} />
      </Card>
      <LearnMore topic={t('qaf.learn.transfers')} />
    </>
  );
}
