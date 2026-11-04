import { Badge, Banner, Button, Card, ConfirmDialog, EmptyState, IndexTable, Pagination, useToast } from '@shopme/ui';
import type { Column } from '@shopme/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FolderTree, Plus, Search } from 'lucide-react';
import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { gql, mutate } from '../api';
import { PageHeader } from '../components/PageHeader';
import { gidToNum } from '../format';
import { COLLECTIONS, COLLECTION_DELETE } from '../graphql';
import { useT } from '../i18n';
import type { Key } from '../i18n';
import { useDebounced } from '../lib/hooks';
import type { Connection } from '../lib/hooks';
import type { Rule, RuleSet } from '../lib/collection-rules';
import { Thumb } from './Products';

interface CollectionRow { id: string; title: string; handle: string; productsCount: { count: number } | null; image: { url: string } | null; ruleSet: RuleSet | null }
const PAGE_SIZE = 25;

export function useRuleSummary() {
  const t = useT();
  return (rs: RuleSet | null) => {
    if (!rs) return '';
    const one = (r: Rule) => `${t(`column.${r.column}` as Key)} ${t(`relation.${r.relation}` as Key).toLowerCase()} ${r.condition}`.trim();
    return rs.rules.map(one).join(rs.appliedDisjunctively ? ` ${t('conditions.or')} ` : ` ${t('conditions.and')} `);
  };
}

export function CollectionsPage() {
  const t = useT();
  const nav = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();
  const summarize = useRuleSummary();
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState(params.get('q') ?? '');
  const term = useDebounced(search);
  const type = params.get('type') ?? '';
  const [selected, setSelected] = useState<string[]>([]);
  const [confirm, setConfirm] = useState<string[] | null>(null);
  const after = params.get('after'), before = params.get('before');
  const query = [term.trim(), type && `collection_type:${type}`].filter(Boolean).join(' ');
  const patch = (c: Record<string, string>) => { const n = new URLSearchParams(params); for (const [k, v] of Object.entries(c)) v ? n.set(k, v) : n.delete(k); if (!('after' in c || 'before' in c)) { n.delete('after'); n.delete('before'); } setParams(n, { replace: true }); };

  const list = useQuery({
    queryKey: ['collections', query, after, before],
    queryFn: () => gql<{ collections: Connection<CollectionRow> }>(COLLECTIONS, { query: query || null, ...(before ? { last: PAGE_SIZE, before } : { first: PAGE_SIZE, after }) }),
    placeholderData: (p) => p,
  });
  const del = useMutation({
    mutationFn: (ids: string[]) => Promise.all(ids.map((id) => mutate(COLLECTION_DELETE, { input: { id } }, 'collectionDelete'))),
    onSuccess: (_r, ids) => { toast(t('collections.deleted', { n: ids.length })); setSelected([]); void qc.invalidateQueries({ queryKey: ['collections'] }); },
    onError: (e) => toast(e.message, 'critical'),
  });
  const rows = list.data?.collections.nodes ?? [];
  const pi = list.data?.collections.pageInfo;
  const columns: Array<Column<CollectionRow>> = [
    { key: 'img', header: '', className: 'w-14', cell: (c) => <Thumb url={c.image?.url} /> },
    { key: 'title', header: t('field.title'), cell: (c) => <span className="font-medium">{c.title}</span> },
    { key: 'count', header: t('nav.products'), cell: (c) => c.productsCount?.count ?? 0 },
    { key: 'cond', header: t('collections.conditions'), cell: (c) => (c.ruleSet ? <span className="text-sm text-muted">{summarize(c.ruleSet)}</span> : <Badge>{t('collections.manual')}</Badge>) },
  ];
  const hasFilters = !!query;

  return (
    <>
      <PageHeader title={t('nav.collections')} actions={<Button variant="primary" onClick={() => nav('/collections/new')}><Plus className="size-4" />{t('collections.add')}</Button>} />
      <Card className="!p-0">
        <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
          <div className="relative min-w-48 flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted" />
            <input type="search" value={search} onChange={(e) => { setSearch(e.target.value); }} placeholder={t('collections.search')} aria-label={t('collections.search')} className="w-full rounded-md border border-line bg-canvas py-2 pl-8 pr-3 text-sm" />
          </div>
          <select aria-label={t('collections.type')} value={type} onChange={(e) => patch({ type: e.target.value })} className="rounded-md border border-line bg-canvas px-2 py-1.5 text-sm">
            <option value="">{t('collections.type')}</option>
            <option value="custom">{t('collections.manual')}</option>
            <option value="smart">{t('collections.automated')}</option>
          </select>
        </div>
        {list.isError && <div className="p-3"><Banner>{(list.error as Error).message}</Banner></div>}
        <IndexTable
          rows={rows} rowId={(r) => r.id} columns={columns} loading={list.isLoading}
          selected={selected} onSelectedChange={setSelected} selectedLabel={(n) => t('common.selected', { n })} selectAllLabel={t('common.selectAll')}
          onRowClick={(r) => nav(`/collections/${gidToNum(r.id)}`)}
          bulkActions={[{ key: 'delete', label: t('common.delete'), danger: true, onRun: (ids) => setConfirm(ids) }]}
          empty={list.isError ? null : hasFilters
            ? <EmptyState icon={<Search className="size-10" />} title={t('products.noResults')} description={t('products.noResultsBody')} />
            : <EmptyState icon={<FolderTree className="size-10" />} title={t('collections.emptyTitle')} description={t('collections.emptyBody')} action={<Button variant="primary" onClick={() => nav('/collections/new')}><Plus className="size-4" />{t('collections.add')}</Button>} />}
        />
        <Pagination
          hasPrevious={before ? !!pi?.hasPreviousPage : !!after} hasNext={before ? true : !!pi?.hasNextPage}
          previousLabel={t('common.previous')} nextLabel={t('common.next')}
          onPrevious={() => patch({ before: pi?.startCursor ?? '', after: '' })} onNext={() => patch({ after: pi?.endCursor ?? '', before: '' })}
        />
      </Card>
      <ConfirmDialog open={!!confirm} onClose={() => setConfirm(null)} danger title={t('collections.deleteTitle', { n: confirm?.length ?? 0 })} message={t('collections.deleteBody')} confirmLabel={t('common.delete')} cancelLabel={t('common.cancel')} onConfirm={() => { if (confirm) del.mutate(confirm); setConfirm(null); }} />
    </>
  );
}
