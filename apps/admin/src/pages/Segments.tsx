import { Banner, Button, Card, ConfirmDialog, Dropdown, EmptyState, IndexTable, Input, Select, Skeleton, useToast } from '@shopme/ui';
import type { Column } from '@shopme/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowUpDown, Check, Plus, Search, Users } from 'lucide-react';
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { UserErrors, gql, mutate } from '../api';
import { LearnMore } from '../components/LearnMore';
import { PageHeader } from '../components/PageHeader';
import { SaveBar, guard } from '../components/SaveBar';
import { searchCls, selectCls, useFormat } from '../components/shared';
import { gidToNum, numToGid } from '../format';
import { CUSTOMERS, CUSTOMERS_COUNT, SEGMENTS, SEGMENT_CREATE, SEGMENT_DELETE, SEGMENT_GET, SEGMENT_UPDATE } from '../graphql';
import { useI18n } from '../i18n';
import type { Key } from '../i18n';
import { BUILT_IN_SEGMENTS, buildQuery, parseQuery } from '../lib/segment-query';
import type { SegmentConditions } from '../lib/segment-query';

interface Segment { id: string; name: string; query: string; createdAt: string; updatedAt: string; customersCount: { count: number } }
interface Row { id: string; name: string; query: string; count: number | null; at: string | null; builtIn: boolean }
const errText = (e: unknown) => (e instanceof UserErrors ? e.errors.map((x) => x.message).join(' · ') : (e as Error).message);

const useTotal = () => useQuery({ queryKey: ['customers-count', ''], queryFn: () => gql<{ customersCount: { count: number } }>(CUSTOMERS_COUNT, { query: null }) });

export function SegmentsPage() {
  const { t } = useI18n();
  const nav = useNavigate();
  const fmt = useFormat();
  const toast = useToast();
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<'recent' | 'name'>('recent');
  const [selected, setSelected] = useState<string[]>([]);
  const [confirm, setConfirm] = useState<string[] | null>(null);
  const custom = useQuery({ queryKey: ['segments'], queryFn: () => gql<{ shopmeCustomerSegments: Segment[] }>(SEGMENTS) });
  const total = useTotal();
  const builtInCounts = useQuery({
    queryKey: ['segments-builtin-counts'],
    queryFn: async () => Promise.all(BUILT_IN_SEGMENTS.map(async (s) => (await gql<{ customersCount: { count: number } }>(CUSTOMERS_COUNT, { query: s.query })).customersCount.count)),
  });
  const del = useMutation({
    mutationFn: (ids: string[]) => Promise.all(ids.map((id) => mutate(SEGMENT_DELETE, { id }, 'shopmeCustomerSegmentDelete'))),
    onSuccess: (_d, ids) => { toast(t('segments.deleted', { n: ids.length })); setSelected([]); void qc.invalidateQueries({ queryKey: ['segments'] }); },
    onError: (e) => toast(errText(e), 'critical'),
  });

  const rows: Row[] = [
    ...BUILT_IN_SEGMENTS.map((s, i) => ({ id: `builtin:${s.id}`, name: t(s.nameKey as Key), query: s.query, count: builtInCounts.data?.[i] ?? null, at: null, builtIn: true })),
    ...(custom.data?.shopmeCustomerSegments ?? []).map((s) => ({ id: s.id, name: s.name, query: s.query, count: s.customersCount.count, at: s.updatedAt, builtIn: false })),
  ].filter((r) => r.name.toLowerCase().includes(search.trim().toLowerCase()))
    .sort((a, b) => (sort === 'name' ? a.name.localeCompare(b.name) : (b.at ?? '').localeCompare(a.at ?? '')));
  const open = (r: Row) => nav(r.builtIn ? `/customers/segments/view?q=${encodeURIComponent(r.query)}&name=${encodeURIComponent(r.name)}` : `/customers/segments/${gidToNum(r.id)}`);
  const pct = (n: number | null) => (n === null || !total.data ? '—' : `${total.data.customersCount.count ? Math.round((n / total.data.customersCount.count) * 100) : 0} %`);
  const columns: Array<Column<Row>> = [
    { key: 'name', header: t('field.name'), cell: (r) => <span className="font-medium">{r.name}</span> },
    { key: 'pct', header: t('segments.share'), cell: (r) => <span className="tabular-nums">{pct(r.count)}</span> },
    { key: 'last', header: t('segments.lastActivity'), cell: (r) => (r.at ? t('segments.edited', { date: fmt.date(r.at) }) : <span className="text-muted">{t('segments.builtIn')}</span>) },
    { key: 'by', header: t('segments.createdBy'), cell: (r) => (r.builtIn ? 'ShopMe' : t('segments.you')) },
  ];
  const create = <Button variant="primary" onClick={() => nav('/customers/segments/new')}>{t('segments.create')}</Button>;
  return (
    <>
      <PageHeader icon={<Users className="size-4" />} title={t('nav.segments')} actions={create} />
      <Card className="!p-0">
        <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
          <div className="relative min-w-48 flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-2 size-4 text-muted" />
            <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('segments.search')} aria-label={t('segments.search')} className={searchCls} />
          </div>
          <Dropdown align="right" variant="plain" size="sm" icon className="btn-neutral" label={t('common.sort')} trigger={<ArrowUpDown className="size-4" />}
            items={(['recent', 'name'] as const).map((x) => ({ key: x, label: t(`segments.sort.${x}` as Key), icon: sort === x ? <Check className="size-4" /> : undefined, onSelect: () => setSort(x) }))} />
        </div>
        {custom.isError && <div className="p-3"><Banner>{(custom.error as Error).message}</Banner></div>}
        <IndexTable rows={rows} rowId={(r) => r.id} columns={columns} loading={custom.isLoading} onRowClick={open}
          selected={selected} onSelectedChange={(ids) => setSelected(ids.filter((i) => !i.startsWith('builtin:')))} selectedLabel={(n) => t('common.selected', { n })} selectAllLabel={t('common.selectAll')}
          bulkActions={[{ key: 'delete', label: t('common.delete'), danger: true, onRun: setConfirm }]}
          empty={<EmptyState icon={<Users className="size-10" />} title={t('content.noResults')} description={t('content.noResultsBody')} />} />
      </Card>
      <LearnMore topic={t('qaf.learn.segments')} />
      <ConfirmDialog open={!!confirm} onClose={() => setConfirm(null)} danger title={t('segments.deleteTitle', { n: confirm?.length ?? 0 })} message={t('segments.deleteBody')} confirmLabel={t('common.delete')} cancelLabel={t('common.cancel')}
        onConfirm={() => { if (confirm) del.mutate(confirm); setConfirm(null); }} />
    </>
  );
}

/** `/customers/segments/new`, `/customers/segments/:id` and the read-only `/customers/segments/view?q=` used by built-in segments. */
export function SegmentEditPage() {
  const { id = 'new' } = useParams();
  const { t } = useI18n();
  const gid = numToGid('ShopmeCustomerSegment', id);
  const q = useQuery({ queryKey: ['segment', gid], enabled: id !== 'new' && id !== 'view', queryFn: () => gql<{ shopmeCustomerSegment: Segment | null }>(SEGMENT_GET, { id: gid }) });
  if (id === 'view') return <SegmentView key={location.search} id={null} initial={{ name: new URLSearchParams(location.search).get('name') ?? '', query: new URLSearchParams(location.search).get('q') ?? '' }} readOnly />;
  if (id === 'new') return <SegmentView key={location.search} id={null} initial={{ name: '', query: new URLSearchParams(location.search).get('q') ?? '' }} />;
  if (q.isLoading) return <div className="grid gap-4"><Skeleton className="h-8 w-64" /><Skeleton className="h-64" /></div>;
  if (q.error) return <Banner>{q.error.message}</Banner>;
  const s = q.data?.shopmeCustomerSegment;
  if (!s) return <Banner>{t('segments.notFound')}</Banner>;
  return <SegmentView key={q.dataUpdatedAt} id={s.id} initial={{ name: s.name, query: s.query }} />;
}

function SegmentView({ id, initial, readOnly }: { id: string | null; initial: { name: string; query: string }; readOnly?: boolean }) {
  const { t } = useI18n();
  const nav = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();
  const [name, setName] = useState(initial.name);
  const [c, setC] = useState<SegmentConditions>(() => parseQuery(initial.query));
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const query = buildQuery(c);
  const dirty = !readOnly && (name !== initial.name || query !== initial.query);
  const set = (p: Partial<SegmentConditions>) => setC((x) => ({ ...x, ...p }));
  const count = useQuery({ queryKey: ['customers-count', query], queryFn: () => gql<{ customersCount: { count: number } }>(CUSTOMERS_COUNT, { query: query || null }) });
  const preview = useQuery({
    queryKey: ['customers', 'segment-preview', query],
    queryFn: () => gql<{ customers: { nodes: Array<{ id: string; displayName: string; numberOfOrders: number; defaultEmailAddress: { emailAddress: string } | null }> } }>(CUSTOMERS, { query: query || null, sortKey: 'CREATED_AT', reverse: true, first: 10 }),
  });
  const save = useMutation({
    mutationFn: async () => {
      if (!name.trim()) throw new Error(t('segments.nameRequired'));
      setError(null);
      if (id) { await mutate(SEGMENT_UPDATE, { id, name: name.trim(), query }, 'shopmeCustomerSegmentUpdate'); return id; }
      return (await mutate<{ segment: { id: string } }>(SEGMENT_CREATE, { name: name.trim(), query }, 'shopmeCustomerSegmentCreate')).segment.id;
    },
    onSuccess: (sid) => { toast(t('segments.saved')); void qc.invalidateQueries({ queryKey: ['segments'] }); void qc.invalidateQueries({ queryKey: ['segment'] }); guard.off = true; nav(`/customers/segments/${gidToNum(sid)}`, { replace: true }); },
    onError: (e) => setError(errText(e)),
  });
  const del = useMutation({
    mutationFn: () => mutate(SEGMENT_DELETE, { id }, 'shopmeCustomerSegmentDelete'),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['segments'] }); guard.off = true; nav('/customers/segments'); }, onError: (e) => toast(errText(e), 'critical'),
  });
  const dis = !!readOnly;
  return (
    <>
      <SaveBar dirty={dirty} saving={save.isPending} onSave={() => save.mutate()} onDiscard={() => { setName(initial.name); setC(parseQuery(initial.query)); setError(null); }} />
      <PageHeader back="/customers/segments" title={readOnly ? name : id ? name || t('segments.untitled') : t('segments.create')}
        actions={<Button variant={readOnly ? 'secondary' : 'secondary'} onClick={() => nav(`/customers?q=${encodeURIComponent(query)}`)}><Users className="size-4" />{t('segments.viewCustomers')}</Button>}
        more={id ? [{ key: 'delete', label: t('common.delete'), danger: true, onSelect: () => setConfirm(true) }] : undefined} />
      {error && <div className="mb-4"><Banner>{error}</Banner></div>}
      <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
        <div className="flex flex-col gap-4">
          <Card title={t('segments.conditions')}>
            <div className="grid gap-3 sm:grid-cols-2">
              <Select label={t('segments.orders')} disabled={dis} value={c.orders} onChange={(e) => set({ orders: e.target.value as SegmentConditions['orders'] })}>
                <option value="">{t('segments.any')}</option><option value="none">{t('segments.orders.none')}</option><option value="any">{t('segments.orders.any')}</option><option value="repeat">{t('segments.orders.repeat')}</option>
              </Select>
              <Select label={t('customers.subscription')} disabled={dis} value={c.marketing} onChange={(e) => set({ marketing: e.target.value as SegmentConditions['marketing'] })}>
                <option value="">{t('segments.any')}</option><option value="subscribed">{t('marketing.SUBSCRIBED')}</option><option value="notSubscribed">{t('marketing.NOT_SUBSCRIBED')}</option>
              </Select>
              <Input label={t('field.tags')} disabled={dis} value={c.tag} onChange={(e) => set({ tag: e.target.value })} />
              <Input label={t('customer.country')} disabled={dis} help={t('segments.countryHelp')} value={c.country} onChange={(e) => set({ country: e.target.value })} />
              <Input type="date" label={t('segments.since')} disabled={dis} value={c.since} onChange={(e) => set({ since: e.target.value })} />
              <Input label={t('segments.other')} disabled={dis} help={t('segments.otherHelp')} value={c.other} onChange={(e) => set({ other: e.target.value })} />
            </div>
            <p className="mt-3 break-all rounded-md bg-surface px-3 py-2 font-mono text-xs text-muted">{query || t('segments.allCustomers')}</p>
          </Card>
          <Card title={t('segments.preview')} actions={count.data && <span className="text-[13px] text-muted">{t('customers.count', { n: count.data.customersCount.count })}</span>}>
            {preview.data?.customers.nodes.length === 0 && <p className="text-[13px] text-muted">{t('segments.noMatch')}</p>}
            <ul className="divide-y divide-line text-[13px]">
              {preview.data?.customers.nodes.map((x) => (
                <li key={x.id}><button type="button" className="flex w-full items-center gap-3 py-2 text-left hover:bg-surface" onClick={() => nav(`/customers/${gidToNum(x.id)}`)}>
                  <span className="font-medium">{x.displayName}</span><span className="text-muted">{x.defaultEmailAddress?.emailAddress}</span><span className="ml-auto text-muted">{t('customers.orderCount', { n: x.numberOfOrders })}</span>
                </button></li>
              ))}
            </ul>
          </Card>
        </div>
        <Card title={t('segments.details')}>
          <Input label={t('field.name')} disabled={dis} value={name} onChange={(e) => setName(e.target.value)} />
          {readOnly && <p className="mt-3 text-[13px] text-muted">{t('segments.builtInHelp')}</p>}
          {!readOnly && !id && <div className="mt-3 flex justify-end"><Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>{t('save.save')}</Button></div>}
        </Card>
      </div>
      <ConfirmDialog open={confirm} onClose={() => setConfirm(false)} danger title={t('segments.deleteTitle', { n: 1 })} message={t('segments.deleteBody')} confirmLabel={t('common.delete')} cancelLabel={t('common.cancel')} onConfirm={() => { setConfirm(false); del.mutate(); }} />
    </>
  );
}
