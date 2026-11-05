import { Badge, Banner, Card, ConfirmDialog, EmptyState, IndexTable, Pagination, Skeleton, Tabs, useToast } from '@shopme/ui';
import type { Column } from '@shopme/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Boxes, Search } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { gql, mutate } from '../api';
import { LearnMore } from '../components/LearnMore';
import { PageHeader } from '../components/PageHeader';
import { searchCls, selectCls, useFormat, useListParams } from '../components/shared';
import { gidToNum } from '../format';
import {
  METAOBJECTS, METAOBJECTS_SUMMARY, METAOBJECT_BULK_DELETE, METAOBJECT_DEFINITIONS, METAOBJECT_DEFINITION_BY_TYPE, METAOBJECT_UPDATE, SHOPME_METAOBJECTS,
} from '../graphql';
import { useI18n } from '../i18n';
import type { Key } from '../i18n';
import { useDebounced } from '../lib/hooks';
import type { Connection } from '../lib/hooks';
import { previewValues } from '../lib/metaobjects';
import type { EntryField } from '../lib/metaobjects';

interface DefinitionRow { id: string; type: string; name: string; description: string | null; metaobjectsCount: number; updatedAt: string; capabilities: { publishable: { enabled: boolean }; onlineStore: { enabled: boolean } | null }; fieldDefinitions: Array<{ key: string }> }
interface Summary { activeCount: number; draftCount: number; webPageCount: number; webPageEntryCount: number; totalCount: number; recent: Array<{ id: string; displayName: string; definition: { id: string; name: string } }> }

const entryPath = (type: string, id: string) => `/content/metaobjects/${encodeURIComponent(type)}/${gidToNum(id)}`;

function Tile({ title, count, to }: { title: string; count: number; to: string }) {
  const { t } = useI18n();
  return (
    <Link to={to} className="flex min-h-24 flex-col gap-1 rounded-lg bg-canvas p-4 shadow-card hover:bg-hover">
      <span className="text-[13px] font-medium">{title}</span>
      <span className="text-[13px] text-muted">{t('mo.entriesCount', { n: count, $count: count })}</span>
    </Link>
  );
}

/** Content > Metaobjects: totals, recent entries and the list of definitions. */
export function MetaobjectsPage() {
  const { t } = useI18n();
  const nav = useNavigate();
  const fmt = useFormat();
  const [search, setSearch] = useState('');
  const term = useDebounced(search).trim();
  const summary = useQuery({ queryKey: ['mo-summary'], queryFn: async () => (await gql<{ shopmeMetaobjectsSummary: Summary }>(METAOBJECTS_SUMMARY)).shopmeMetaobjectsSummary });
  const defs = useQuery({ queryKey: ['mo-definitions', term], queryFn: async () => (await gql<{ metaobjectDefinitions: { nodes: DefinitionRow[] } }>(METAOBJECT_DEFINITIONS, { query: term || null })).metaobjectDefinitions.nodes, placeholderData: (p) => p });
  const s = summary.data;
  const columns: Array<Column<DefinitionRow>> = [
    { key: 'name', header: t('mo.col.name'), cell: (d) => <div><span className="font-medium">{d.name}</span><p className="font-mono text-xs text-muted">{d.type}</p></div> },
    { key: 'count', header: t('mo.col.entries'), cell: (d) => d.metaobjectsCount },
    { key: 'fields', header: t('mo.col.fields'), cell: (d) => d.fieldDefinitions.length },
    { key: 'web', header: '', cell: (d) => (d.capabilities.onlineStore?.enabled ? <Badge tone="info">{t('mo.webPages')}</Badge> : null) },
    { key: 'updated', header: t('pages.updated'), cell: (d) => fmt.date(d.updatedAt) },
  ];
  return (
    <>
      <PageHeader icon={<Boxes className="size-4" />} title={t('mo.title')} actions={<>
        <Link to="/settings/metafields/metaobjects" className="btn btn-secondary">{t('mo.manage')}</Link>
        <Link to="/settings/metafields/metaobjects/new" className="btn btn-primary">{t('mo.addDefinition')}</Link>
      </>} />
      <div className="mb-4 grid gap-3 lg:grid-cols-[1fr_1fr_1.4fr]">
        <div className="grid gap-3 sm:grid-cols-2 lg:col-span-2">
          <Tile title={t('mo.tile.online')} count={s?.webPageCount ?? 0} to="/content/entries?q=web_page:true&tab=active" />
          <Tile title={t('mo.webPages')} count={s?.webPageEntryCount ?? 0} to="/content/entries?q=web_page:true" />
          <Tile title={t('mo.tile.active')} count={s?.activeCount ?? 0} to="/content/entries?tab=active" />
          <Tile title={t('mo.tile.draft')} count={s?.draftCount ?? 0} to="/content/entries?tab=draft" />
        </div>
        <Card title={t('mo.recent')}>
          {summary.isLoading ? <Skeleton className="h-24" /> : !s?.recent.length ? <p className="text-[13px] text-muted">{t('mo.noEntries')}</p> : (
            <ul className="flex flex-col">
              {s.recent.map((e) => (
                <li key={e.id}><Link to={`/content/entries?q=${encodeURIComponent(`id:${gidToNum(e.id)}`)}`} className="flex items-center justify-between gap-3 py-1.5 text-[13px] hover:underline"><span className="truncate">{e.displayName}</span><span className="shrink-0 text-muted">{e.definition.name}</span></Link></li>
              ))}
            </ul>
          )}
          {!!s?.totalCount && <Link to="/content/entries" className="mt-2 inline-block text-[13px] font-medium hover:underline">{t('mo.viewAll', { n: s.totalCount, $count: s.totalCount })}</Link>}
        </Card>
      </div>
      <Card className="!p-0">
        <div className="flex items-center gap-2 border-b border-line p-3">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-2 size-4 text-muted" />
            <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('mo.searchDefinitions')} aria-label={t('mo.searchDefinitions')} className={searchCls} />
          </div>
        </div>
        {defs.isError && <div className="p-3"><Banner>{(defs.error as Error).message}</Banner></div>}
        <IndexTable rows={defs.data ?? []} rowId={(d) => d.id} columns={columns} loading={defs.isLoading} onRowClick={(d) => nav(`/content/metaobjects/${encodeURIComponent(d.type)}`)}
          empty={term ? <EmptyState icon={<Search className="size-10" />} title={t('mo.noDefinitionFound')} description={t('content.noResultsBody')} />
            : <EmptyState icon={<Boxes className="size-10" />} title={t('mo.emptyTitle')} description={t('mo.emptyBody')} action={<Link to="/settings/metafields/metaobjects/new" className="btn btn-primary">{t('mo.addDefinition')}</Link>} />} />
      </Card>
      <LearnMore topic={t('qaf.learn.metaobjects')} />
    </>
  );
}

type Tab = 'all' | 'active' | 'draft';
interface EntryRow { id: string; handle: string; displayName: string; type: string; updatedAt: string; capabilities: { publishable: { status: string } | null }; fields: EntryField[] }
interface GlobalRow { id: string; handle: string; displayName: string; type: string; updatedAt: string; capabilities: { publishable: { status: string } | null }; definition: { id: string; name: string; type: string; capabilities: { publishable: { enabled: boolean } } } }
interface DefinitionFull { id: string; type: string; name: string; metaobjectsCount: number; capabilities: { publishable: { enabled: boolean }; onlineStore: { enabled: boolean; data: { urlHandle: string } | null } | null }; fieldDefinitions: Array<{ key: string; name: string; type: { name: string }; capabilities: { adminFilterable: { enabled: boolean } } }> }

const StatusBadge = ({ status }: { status: string | null | undefined }) => {
  const { t } = useI18n();
  return status ? <Badge tone={status === 'ACTIVE' ? 'success' : 'neutral'}>{t(status === 'ACTIVE' ? 'mo.status.ACTIVE' : 'mo.status.DRAFT')}</Badge> : null;
};

/** Entries of one definition: search, status tabs, filters on filterable fields, bulk actions. */
export function MetaobjectEntriesPage() {
  const { type = '' } = useParams();
  const { t } = useI18n();
  const nav = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();
  const fmt = useFormat();
  const L = useListParams();
  const def = useQuery({ queryKey: ['mo-definition-type', type], queryFn: async () => (await gql<{ metaobjectDefinitionByType: DefinitionFull | null }>(METAOBJECT_DEFINITION_BY_TYPE, { type })).metaobjectDefinitionByType });
  const d = def.data;
  const publishable = !!d?.capabilities.publishable.enabled;
  const tab = (['all', 'active', 'draft'].includes(L.get('tab')) ? L.get('tab') : 'all') as Tab;
  const [search, setSearch] = useState(L.get('q'));
  const term = useDebounced(search).trim();
  const filterable = (d?.fieldDefinitions ?? []).filter((f) => f.capabilities.adminFilterable.enabled);
  const filterQuery = filterable.map((f) => (L.get(`f_${f.key}`) ? `fields.${f.key}:"${L.get(`f_${f.key}`).replace(/"/g, '')}"` : '')).filter(Boolean);
  const query = [term, publishable && tab !== 'all' && `status:${tab}`, ...filterQuery].filter(Boolean).join(' ');
  const sort = L.get('sort') || 'updated_at';
  const reverse = L.get('dir') !== 'asc';
  const list = useQuery({
    queryKey: ['mo-entries', type, query, sort, reverse, L.get('after'), L.get('before')], enabled: !!d,
    queryFn: async () => (await gql<{ metaobjects: Connection<EntryRow> }>(METAOBJECTS, { type, query: query || null, sortKey: sort, reverse, ...L.page(25) })).metaobjects,
    placeholderData: (p) => p,
  });
  const [selected, setSelected] = useState<string[]>([]);
  const [confirm, setConfirm] = useState<string[] | null>(null);
  const refresh = () => { setSelected([]); void qc.invalidateQueries({ queryKey: ['mo-entries'] }); void qc.invalidateQueries({ queryKey: ['mo-summary'] }); void qc.invalidateQueries({ queryKey: ['mo-definition-type'] }); void qc.invalidateQueries({ queryKey: ['mo-definitions'] }); };
  const setStatus = useMutation({
    mutationFn: ({ ids, status }: { ids: string[]; status: 'ACTIVE' | 'DRAFT' }) => Promise.all(ids.map((id) => mutate(METAOBJECT_UPDATE, { id, metaobject: { capabilities: { publishable: { status } } } }, 'metaobjectUpdate'))),
    onSuccess: (_r, v) => { toast(t('mo.statusChanged', { n: v.ids.length, $count: v.ids.length })); refresh(); }, onError: (e) => toast(e.message, 'critical'),
  });
  const del = useMutation({
    mutationFn: (ids: string[]) => mutate(METAOBJECT_BULK_DELETE, { where: { ids } }, 'metaobjectBulkDelete'),
    onSuccess: (_r, ids) => { toast(t('mo.deleted', { n: ids.length, $count: ids.length })); refresh(); }, onError: (e) => toast(e.message, 'critical'),
  });
  if (def.isLoading) return <Skeleton className="h-64" />;
  if (def.error) return <Banner>{(def.error as Error).message}</Banner>;
  if (!d) return <Banner>{t('mo.definitionNotFound')}</Banner>;
  const preview = d.fieldDefinitions.length > 1;
  const columns: Array<Column<EntryRow>> = [
    { key: 'name', header: t('mo.col.name'), cell: (e) => <span className="font-medium">{e.displayName}</span> },
    ...(publishable ? [{ key: 'status', header: t('field.status'), cell: (e: EntryRow) => <StatusBadge status={e.capabilities.publishable?.status} /> }] : []),
    ...(preview ? [{ key: 'preview', header: t('mo.col.fields'), cell: (e: EntryRow) => <span className="text-muted">{previewValues(e.fields.filter((f) => f.key !== d.fieldDefinitions[0]?.key)).map((p) => p.text).join(' · ')}</span> }] : []),
    { key: 'updated', header: t('pages.updated'), cell: (e) => fmt.dateTime(e.updatedAt) },
  ];
  const pi = list.data?.pageInfo;
  const add = <Link to={`/content/metaobjects/${encodeURIComponent(type)}/new`} className="btn btn-primary">{t('mo.addEntry')}</Link>;
  return (
    <>
      <PageHeader back="/content/metaobjects" title={d.name} subtitle={<span className="font-mono">{d.type}</span>}
        actions={<><Link to={`/settings/metafields/metaobjects/${gidToNum(d.id)}`} className="btn btn-secondary">{t('mo.editDefinition')}</Link>{add}</>} />
      <Card className="!p-0">
        {publishable && <div className="px-3 pt-1"><Tabs tabs={(['all', 'active', 'draft'] as const).map((id) => ({ id, label: t(`mo.tab.${id}` as Key) }))} value={tab} onChange={(v) => { setSelected([]); L.patch({ tab: v === 'all' ? '' : v }); }} /></div>}
        <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
          <div className="relative min-w-48 flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-2 size-4 text-muted" />
            <input type="search" value={search} onChange={(e) => { setSearch(e.target.value); L.patch({ q: e.target.value }); }} placeholder={t('mo.searchEntries')} aria-label={t('mo.searchEntries')} className={searchCls} />
          </div>
          {filterable.map((f) => <input key={f.key} aria-label={f.name} placeholder={f.name} className="field-control w-36" value={L.get(`f_${f.key}`)} onChange={(e) => L.patch({ [`f_${f.key}`]: e.target.value })} />)}
          <select aria-label={t('common.sort')} value={`${sort}:${reverse ? 'desc' : 'asc'}`} onChange={(e) => { const [k, dir] = e.target.value.split(':'); L.patch({ sort: k === 'updated_at' ? '' : k!, dir: dir === 'asc' ? 'asc' : '' }); }} className={selectCls}>
            {(['updated_at', 'display_name'] as const).flatMap((k) => [<option key={`${k}d`} value={`${k}:desc`}>{t(k === 'updated_at' ? 'pages.updated' : 'mo.col.name')} ↓</option>, <option key={`${k}a`} value={`${k}:asc`}>{t(k === 'updated_at' ? 'pages.updated' : 'mo.col.name')} ↑</option>])}
          </select>
        </div>
        {list.isError && <div className="p-3"><Banner>{(list.error as Error).message}</Banner></div>}
        <IndexTable rows={list.data?.nodes ?? []} rowId={(r) => r.id} columns={columns} loading={list.isLoading} onRowClick={(r) => nav(entryPath(type, r.id))}
          selected={selected} onSelectedChange={setSelected} selectedLabel={(n) => t('common.selected', { n })} selectAllLabel={t('common.selectAll')}
          bulkActions={[
            ...(publishable ? [{ key: 'active', label: t('mo.setActive'), onRun: (ids: string[]) => setStatus.mutate({ ids, status: 'ACTIVE' }) }, { key: 'draft', label: t('mo.setDraft'), onRun: (ids: string[]) => setStatus.mutate({ ids, status: 'DRAFT' }) }] : []),
            { key: 'delete', label: t('common.delete'), danger: true, onRun: setConfirm },
          ]}
          empty={list.isError ? null : query ? <EmptyState icon={<Search className="size-10" />} title={t('content.noResults')} description={t('content.noResultsBody')} /> : <EmptyState icon={<Boxes className="size-10" />} title={t('mo.noEntriesTitle', { name: d.name })} description={t('mo.noEntriesBody')} action={add} />} />
        <Pagination hasPrevious={L.get('before') ? !!pi?.hasPreviousPage : !!L.get('after')} hasNext={L.get('before') ? true : !!pi?.hasNextPage} previousLabel={t('common.previous')} nextLabel={t('common.next')}
          onPrevious={() => L.patch({ before: pi?.startCursor ?? '', after: '' }, true)} onNext={() => L.patch({ after: pi?.endCursor ?? '', before: '' }, true)} />
      </Card>
      <ConfirmDialog open={!!confirm} onClose={() => setConfirm(null)} danger title={t('mo.deleteEntriesTitle', { n: confirm?.length ?? 0, $count: confirm?.length ?? 0 })} message={t('mo.deleteEntriesBody')} confirmLabel={t('common.delete')} cancelLabel={t('common.cancel')}
        onConfirm={() => { if (confirm) del.mutate(confirm); setConfirm(null); }} />
    </>
  );
}

/** Entries of every definition (landing page tiles and "view all"). */
export function AllMetaobjectEntriesPage() {
  const { t } = useI18n();
  const nav = useNavigate();
  const fmt = useFormat();
  const L = useListParams();
  const tab = (['all', 'active', 'draft'].includes(L.get('tab')) ? L.get('tab') : 'all') as Tab;
  const [search, setSearch] = useState(L.get('q'));
  const term = useDebounced(search).trim();
  const query = [term, tab !== 'all' && `status:${tab}`].filter(Boolean).join(' ');
  const list = useQuery({
    queryKey: ['mo-all-entries', query, L.get('after'), L.get('before')],
    queryFn: async () => (await gql<{ shopmeMetaobjects: Connection<GlobalRow> }>(SHOPME_METAOBJECTS, { query: query || null, ...L.page(25) })).shopmeMetaobjects,
    placeholderData: (p) => p,
  });
  const columns: Array<Column<GlobalRow>> = [
    { key: 'name', header: t('mo.col.name'), cell: (e) => <span className="font-medium">{e.displayName}</span> },
    { key: 'def', header: t('mo.col.definition'), cell: (e) => e.definition.name },
    { key: 'status', header: t('field.status'), cell: (e) => (e.definition.capabilities.publishable.enabled ? <StatusBadge status={e.capabilities.publishable?.status} /> : null) },
    { key: 'updated', header: t('pages.updated'), cell: (e) => fmt.dateTime(e.updatedAt) },
  ];
  const pi = list.data?.pageInfo;
  return (
    <>
      <PageHeader back="/content/metaobjects" title={t('mo.allEntries')} />
      <Card className="!p-0">
        <div className="px-3 pt-1"><Tabs tabs={(['all', 'active', 'draft'] as const).map((id) => ({ id, label: t(`mo.tab.${id}` as Key) }))} value={tab} onChange={(v) => L.patch({ tab: v === 'all' ? '' : v })} /></div>
        <div className="border-b border-line p-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-2 size-4 text-muted" />
            <input type="search" value={search} onChange={(e) => { setSearch(e.target.value); L.patch({ q: e.target.value }); }} placeholder={t('mo.searchEntries')} aria-label={t('mo.searchEntries')} className={searchCls} />
          </div>
        </div>
        {list.isError && <div className="p-3"><Banner>{(list.error as Error).message}</Banner></div>}
        <IndexTable rows={list.data?.nodes ?? []} rowId={(r) => r.id} columns={columns} loading={list.isLoading} onRowClick={(r) => nav(entryPath(r.definition.type, r.id))}
          empty={<EmptyState icon={<Boxes className="size-10" />} title={t('mo.noEntries')} />} />
        <Pagination hasPrevious={L.get('before') ? !!pi?.hasPreviousPage : !!L.get('after')} hasNext={L.get('before') ? true : !!pi?.hasNextPage} previousLabel={t('common.previous')} nextLabel={t('common.next')}
          onPrevious={() => L.patch({ before: pi?.startCursor ?? '', after: '' }, true)} onNext={() => L.patch({ after: pi?.endCursor ?? '', before: '' }, true)} />
      </Card>
    </>
  );
}

