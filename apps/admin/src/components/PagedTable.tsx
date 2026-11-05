import { Banner, Card, IndexTable, Pagination } from '@shopme/ui';
import type { Column } from '@shopme/ui';
import { useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import type { ReactNode } from 'react';
import { useState } from 'react';
import { gql } from '../api';
import { useT } from '../i18n';
import { useDebounced } from '../lib/hooks';
import type { Connection } from '../lib/hooks';
import { searchCls, useListParams } from './shared';

/** Card with a searchable, cursor-paginated table over a `{ nodes, pageInfo }` connection. Search text goes to the `query` variable. */
export function PagedTable<T extends { id: string }>({ title, doc, root, queryKey, columns, empty, onRowClick, actions, searchLabel, size = 25 }: {
  title: ReactNode; doc: string; root: string; queryKey: string; columns: Array<Column<T>>; empty: ReactNode; onRowClick?: (row: T) => void; actions?: ReactNode; searchLabel?: string; size?: number;
}) {
  const t = useT();
  const L = useListParams();
  const [search, setSearch] = useState(L.get('q'));
  const term = useDebounced(search).trim();
  const list = useQuery({
    queryKey: [queryKey, term, L.get('after'), L.get('before')],
    queryFn: async () => (await gql<Record<string, Connection<T>>>(doc, { query: term || null, ...L.page(size) }))[root]!,
    placeholderData: (p) => p,
  });
  const pi = list.data?.pageInfo;
  return (
    <Card className="!p-0">
      <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
        <h2 className="text-[13px] font-semibold">{title}</h2>
        {searchLabel && (
          <div className="relative ml-2 min-w-40 max-w-xs flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-2 size-4 text-muted" />
            <input type="search" value={search} onChange={(e) => { setSearch(e.target.value); L.patch({ q: e.target.value }); }} placeholder={searchLabel} aria-label={searchLabel} className={searchCls} />
          </div>
        )}
        <div className="ml-auto">{actions}</div>
      </div>
      {list.isError && <div className="p-3"><Banner>{(list.error as Error).message}</Banner></div>}
      <IndexTable rows={list.data?.nodes ?? []} rowId={(r) => r.id} columns={columns} loading={list.isLoading} onRowClick={onRowClick} empty={list.isError ? null : empty} />
      <Pagination hasPrevious={L.get('before') ? !!pi?.hasPreviousPage : !!L.get('after')} hasNext={L.get('before') ? true : !!pi?.hasNextPage} previousLabel={t('common.previous')} nextLabel={t('common.next')}
        onPrevious={() => L.patch({ before: pi?.startCursor ?? '', after: '' }, true)} onNext={() => L.patch({ after: pi?.endCursor ?? '', before: '' }, true)} />
    </Card>
  );
}
