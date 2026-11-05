import { Banner, Card, ConfirmDialog, IndexTable, Pagination, Tabs, useToast } from '@shopme/ui';
import type { Column } from '@shopme/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import type { ReactNode } from 'react';
import { useState } from 'react';
import { gql, mutate } from '../api';
import { useI18n } from '../i18n';
import type { Key } from '../i18n';
import { useDebounced } from '../lib/hooks';
import type { Connection } from '../lib/hooks';
import { searchCls, selectCls, useListParams } from './shared';
import { ViewTabs } from './SavedViews';
import type { ViewResource } from './SavedViews';

const TABS = ['all', 'published', 'unpublished'] as const;
type Tab = (typeof TABS)[number];

/**
 * Searchable list with All / Visible / Hidden tabs, a sort menu, row selection and bulk "make visible / make hidden / delete"
 * for resources that have an `isPublished` flag (pages, blog posts).
 */
export function VisibilityList<T extends { id: string }>({ queryKey, doc, root, columns, sorts, searchLabel, onRowClick, empty, noResults, setVisible, remove, deleteTitle, deleteBody, viewResource }: {
  /** Saved views (custom tabs next to All / Visible / Hidden) are kept for this kind of list. */
  viewResource?: ViewResource;
  queryKey: string; doc: string; root: string; columns: Array<Column<T>>; sorts: Array<{ key: string; label: string }>; searchLabel: string;
  onRowClick: (row: T) => void; empty: ReactNode; noResults: ReactNode;
  /** Mutation document + builder for one row's visibility change. */
  setVisible: { doc: string; field: string; vars: (id: string, visible: boolean) => Record<string, unknown> };
  remove: { doc: string; field: string; vars: (id: string) => Record<string, unknown> };
  deleteTitle: (n: number) => string; deleteBody: string;
}) {
  const { t } = useI18n();
  const toast = useToast();
  const qc = useQueryClient();
  const L = useListParams();
  const tab = (TABS.includes(L.get('tab') as Tab) ? L.get('tab') : 'all') as Tab;
  const [search, setSearch] = useState(L.get('q'));
  const term = useDebounced(search).trim();
  const [selected, setSelected] = useState<string[]>([]);
  const [confirm, setConfirm] = useState<string[] | null>(null);
  const sort = { key: L.get('sort') || sorts[0]!.key, reverse: L.get('dir') !== 'asc' };
  const query = [term, tab !== 'all' && `published_status:${tab}`].filter(Boolean).join(' ');
  const list = useQuery({
    queryKey: [queryKey, query, sort, L.get('after'), L.get('before')],
    queryFn: async () => (await gql<Record<string, Connection<T>>>(doc, { query: query || null, sortKey: sort.key, reverse: sort.reverse, ...L.page(25) }))[root]!,
    placeholderData: (p) => p,
  });
  const refresh = () => { setSelected([]); void qc.invalidateQueries({ queryKey: [queryKey] }); };
  const visibility = useMutation({
    mutationFn: ({ ids, visible }: { ids: string[]; visible: boolean }) => Promise.all(ids.map((id) => mutate(setVisible.doc, setVisible.vars(id, visible), setVisible.field))),
    onSuccess: (_d, v) => { toast(t(v.visible ? 'content.madeVisible' : 'content.madeHidden', { n: v.ids.length })); refresh(); }, onError: (e) => toast(e.message, 'critical'),
  });
  const del = useMutation({
    mutationFn: (ids: string[]) => Promise.all(ids.map((id) => mutate(remove.doc, remove.vars(id), remove.field))),
    onSuccess: (_d, ids) => { toast(t('content.deleted', { n: ids.length })); refresh(); }, onError: (e) => toast(e.message, 'critical'),
  });
  const pi = list.data?.pageInfo;
  return (
    <>
      <Card className="!p-0">
        {viewResource
          ? <div className="border-b border-line px-3 py-2"><ViewTabs resource={viewResource} query={query} tabs={TABS.map((id) => ({ id, label: t(`content.tab.${id}` as Key) }))} value={tab} onTab={(v) => { setSelected([]); L.patch({ tab: v === 'all' ? '' : v, view: '' }); }} /></div>
          : <div className="px-3 pt-1"><Tabs tabs={TABS.map((id) => ({ id, label: t(`content.tab.${id}` as Key) }))} value={tab} onChange={(v) => { setSelected([]); L.patch({ tab: v === 'all' ? '' : v }); }} /></div>}
        <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
          <div className="relative min-w-48 flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-2 size-4 text-muted" />
            <input type="search" value={search} onChange={(e) => { setSearch(e.target.value); L.patch({ q: e.target.value }); }} placeholder={searchLabel} aria-label={searchLabel} className={searchCls} />
          </div>
          <select aria-label={t('common.sort')} value={`${sort.key}:${sort.reverse ? 'desc' : 'asc'}`} onChange={(e) => { const [k, d] = e.target.value.split(':'); L.patch({ sort: k === sorts[0]!.key ? '' : k!, dir: d === 'asc' ? 'asc' : '' }); }} className={selectCls}>
            {sorts.map((s) => [<option key={`${s.key}:desc`} value={`${s.key}:desc`}>{s.label} ↓</option>, <option key={`${s.key}:asc`} value={`${s.key}:asc`}>{s.label} ↑</option>])}
          </select>
        </div>
        {list.isError && <div className="p-3"><Banner>{(list.error as Error).message}</Banner></div>}
        <IndexTable rows={list.data?.nodes ?? []} rowId={(r) => r.id} columns={columns} loading={list.isLoading} onRowClick={onRowClick}
          selected={selected} onSelectedChange={setSelected} selectedLabel={(n) => t('common.selected', { n })} selectAllLabel={t('common.selectAll')}
          bulkActions={[
            { key: 'show', label: t('content.makeVisible'), onRun: (ids) => visibility.mutate({ ids, visible: true }) },
            { key: 'hide', label: t('content.makeHidden'), onRun: (ids) => visibility.mutate({ ids, visible: false }) },
            { key: 'delete', label: t('common.delete'), danger: true, onRun: setConfirm },
          ]}
          empty={list.isError ? null : query ? noResults : empty} />
        <Pagination hasPrevious={L.get('before') ? !!pi?.hasPreviousPage : !!L.get('after')} hasNext={L.get('before') ? true : !!pi?.hasNextPage} previousLabel={t('common.previous')} nextLabel={t('common.next')}
          onPrevious={() => L.patch({ before: pi?.startCursor ?? '', after: '' }, true)} onNext={() => L.patch({ after: pi?.endCursor ?? '', before: '' }, true)} />
      </Card>
      <ConfirmDialog open={!!confirm} onClose={() => setConfirm(null)} danger title={deleteTitle(confirm?.length ?? 0)} message={deleteBody} confirmLabel={t('common.delete')} cancelLabel={t('common.cancel')}
        onConfirm={() => { if (confirm) del.mutate(confirm); setConfirm(null); }} />
    </>
  );
}
