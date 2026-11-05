import { Badge, Banner, Button, Card, EmptyState, IndexTable } from '@shopme/ui';
import type { Column } from '@shopme/ui';
import { useQuery } from '@tanstack/react-query';
import { BookOpen, Plus, Search } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { gql } from '../../api';
import { PageHeader } from '../../components/PageHeader';
import { searchCls, useListParams } from '../../components/shared';
import { gidToNum } from '../../format';
import { CATALOGS_LIST } from '../../graphql';
import { useI18n } from '../../i18n';
import type { Key } from '../../i18n';
import { useDebounced } from '../../lib/hooks';

export interface CatalogRow {
  id: string; title: string; status: 'ACTIVE' | 'DRAFT' | 'ARCHIVED';
  priceList: { id: string; name: string; currency: string; fixedPricesCount: number; parent: { adjustment: { type: 'PERCENTAGE_DECREASE' | 'PERCENTAGE_INCREASE'; value: number }; settings: { compareAtMode: 'ADJUSTED' | 'NULLIFY' } } } | null;
  markets?: { nodes: Array<{ id: string; name: string; primary: boolean }> };
}
const tone = { ACTIVE: 'success', DRAFT: 'neutral', ARCHIVED: 'warning' } as const;

export function CatalogsPage() {
  const { t } = useI18n();
  const nav = useNavigate();
  const L = useListParams();
  const [search, setSearch] = useState(L.get('q'));
  const term = useDebounced(search).trim();
  const list = useQuery({ queryKey: ['catalogs', term], queryFn: () => gql<{ catalogs: { nodes: CatalogRow[] } }>(CATALOGS_LIST, { query: term || null }), placeholderData: (p) => p });
  const create = <Button variant="primary" onClick={() => nav('/markets/catalogs/new')}><Plus className="size-4" />{t('catalogs.create')}</Button>;
  const columns: Array<Column<CatalogRow>> = [
    { key: 'title', header: t('catalogs.col.title'), cell: (c) => <span className="flex items-center gap-2 font-medium"><BookOpen className="size-4 text-muted" aria-hidden />{c.title}</span> },
    { key: 'status', header: t('catalogs.col.status'), cell: (c) => <Badge tone={tone[c.status]}>{t(`catalogs.status.${c.status}` as Key)}</Badge> },
    { key: 'markets', header: t('catalogs.col.markets'), cell: (c) => (c.markets?.nodes.length ? c.markets.nodes.map((m) => m.name).join(', ') : <span className="text-muted">{t('catalogs.noMarket')}</span>) },
    {
      key: 'pricing', header: t('catalogs.col.pricing'), cell: (c) => {
        const pl = c.priceList;
        if (!pl) return <span className="text-muted">{t('catalogs.summaryNone')}</span>;
        const a = pl.parent.adjustment;
        return <span>{pl.currency}{a.value ? ` · ${t('catalogs.summary', { type: a.type === 'PERCENTAGE_DECREASE' ? '−' : '+', value: String(a.value) })}` : ''}{pl.fixedPricesCount ? ` · ${pl.fixedPricesCount} ${t('catalogs.fixed').toLowerCase()}` : ''}</span>;
      },
    },
  ];
  return (
    <>
      <PageHeader back="/markets" title={t('catalogs.title')} actions={create} />
      <Card className="!p-0">
        <div className="border-b border-line p-3">
          <div className="relative max-w-md">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted" />
            <input type="search" value={search} onChange={(e) => { setSearch(e.target.value); L.patch({ q: e.target.value }); }} placeholder={t('catalogs.search')} aria-label={t('catalogs.search')} className={searchCls} />
          </div>
        </div>
        {list.isError && <div className="p-3"><Banner>{(list.error as Error).message}</Banner></div>}
        <IndexTable rows={list.data?.catalogs.nodes ?? []} rowId={(r) => r.id} columns={columns} loading={list.isLoading} onRowClick={(r) => nav(`/markets/catalogs/${gidToNum(r.id)}`)}
          selected={[]} onSelectedChange={() => {}} selectedLabel={(n) => t('common.selected', { n })} selectAllLabel={t('common.selectAll')}
          empty={list.isError ? null : <EmptyState icon={<BookOpen className="size-10" />} title={t('catalogs.emptyTitle')} description={t('catalogs.emptyBody')} action={create} />} />
      </Card>
    </>
  );
}
