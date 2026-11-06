import { Banner, Button, Card, Dropdown, EmptyState, Input, Modal, Select, Skeleton, Switch, cx, useToast } from '@shopme/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Activity, BarChart3, ExternalLink, Save } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { UserErrors, gql, mutate } from '../api';
import { QueryBox } from '../components/AnalyticsParts';
import { BarChart, LineChart, Sparkline } from '../components/Charts';
import type { Series } from '../components/Charts';
import { TopBar } from '../components/OrderChrome';
import { PageHeader } from '../components/PageHeader';
import { useFormat } from '../components/shared';
import { EXPLORATION, EXPLORATION_CATALOG, EXPLORATION_DELETE, EXPLORATION_RUN, EXPLORATION_SAVE } from '../graphql';
import { useI18n } from '../i18n';
import type { Key } from '../i18n';
import { PRESETS, comparisonRange, delta, presetRange } from '../lib/analytics';
import type { Compare, Preset } from '../lib/analytics';
import { cumulate, emptyQuery } from '../lib/report-query';
import type { QueryFilter, QueryOp, ReportQuery } from '../lib/report-query';
import { useShop } from '../session';
import { todayIn, useCells } from './Analytics';

type Viz = 'TABLE' | 'LINE' | 'BAR';
type Dataset = 'ORDERS' | 'PRODUCTS' | 'CUSTOMERS' | 'SESSIONS';
interface Catalog { metrics: Array<{ key: string; label: string; type: 'int' | 'money' | 'percent' }>; dimensions: Array<{ key: string; label: string; date: boolean }>; filters: Array<{ key: string; label: string; numeric: boolean }> }
interface Def { dataset: Dataset; metrics: string[]; dimension: string | null; filters: QueryFilter[]; period: string; from?: string; to?: string; compare: Compare; visualization: Viz; cumulative?: boolean }
interface Result { currencyCode: string; from: string; to: string; columns: Array<{ key: string; label: string; type: 'text' | 'date' | 'int' | 'money' | 'percent' }>; rows: Array<Array<string | number | null>>; totals: Record<string, number> }

const errText = (e: unknown) => (e instanceof UserErrors ? e.errors.map((x) => x.message).join(' · ') : (e as Error).message);
const DATASETS: Dataset[] = ['ORDERS', 'PRODUCTS', 'CUSTOMERS', 'SESSIONS'];
const OPS: Array<{ op: QueryOp; label: string }> = [{ op: 'EQ', label: '=' }, { op: 'NEQ', label: '≠' }, { op: 'CONTAINS', label: '~' }, { op: 'GT', label: '>' }, { op: 'LT', label: '<' }];
const DEFAULT: Def = { dataset: 'ORDERS', metrics: ['orders', 'total_sales'], dimension: 'day', filters: [], period: 'LAST_30_DAYS', compare: 'PREVIOUS_PERIOD', visualization: 'LINE' };

/** A saved exploration (or a new one): the builder panel, the query box and the result as a chart and a table. */
export function ExplorationPage() {
  const { id = 'new' } = useParams();
  const { t } = useI18n();
  const { shop } = useShop();
  const toast = useToast();
  const nav = useNavigate();
  const qc = useQueryClient();
  const isNew = id === 'new';
  const catalog = useQuery({ queryKey: ['exploration-catalog'], staleTime: Infinity, queryFn: async () => (await gql<{ shopmeExplorationCatalog: Record<Dataset, Catalog> }>(EXPLORATION_CATALOG)).shopmeExplorationCatalog });
  const saved = useQuery({ queryKey: ['exploration', id], enabled: !isNew, queryFn: async () => (await gql<{ shopmeExploration: { id: string; name: string; definition: Def } | null }>(EXPLORATION, { id: `gid://shopify/ShopmeExploration/${id}` })).shopmeExploration });
  const [def, setDef] = useState<Def>(DEFAULT);
  const [name, setName] = useState('');
  const [loaded, setLoaded] = useState(isNew);
  const [dialog, setDialog] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (saved.data && !loaded) { setDef({ ...DEFAULT, ...saved.data.definition }); setName(saved.data.name); setLoaded(true); } }, [saved.data, loaded]);
  const today = todayIn(shop.timezone);
  const range = def.period === 'CUSTOM' && def.from && def.to ? { from: def.from, to: def.to } : presetRange((PRESETS as string[]).includes(def.period) ? (def.period as Preset) : 'LAST_30_DAYS', today);
  const prevRange = comparisonRange(range, def.compare);
  const cat = catalog.data?.[def.dataset];
  const dim = cat?.dimensions.find((d) => d.key === def.dimension);
  const definition = { dataset: def.dataset, metrics: def.metrics, dimension: def.dimension, filters: def.filters.filter((f) => f.value !== ''), period: def.period, compare: def.compare, visualization: def.visualization };
  const useRun = (r: { from: string; to: string } | null) => useQuery({
    queryKey: ['exploration-run', JSON.stringify(definition), r?.from, r?.to], enabled: !!r && r.from <= r.to && def.metrics.length > 0 && !!catalog.data, placeholderData: (p) => p, retry: false,
    queryFn: async () => (await gql<{ shopmeExplorationRun: Result }>(EXPLORATION_RUN, { definition, from: r!.from, to: r!.to })).shopmeExplorationRun,
  });
  const cur = useRun(range), before = useRun(dim?.date ? prevRange : null);
  const cells = useCells(cur.data?.currencyCode ?? shop.currency);
  const save = useMutation({
    mutationFn: () => mutate<{ exploration: { id: string } }>(EXPLORATION_SAVE, { id: isNew ? null : `gid://shopify/ShopmeExploration/${id}`, name: name.trim(), definition: { ...definition, ...(def.period === 'CUSTOM' && { from: def.from, to: def.to }), cumulative: !!def.cumulative } }, 'shopmeExplorationSave'),
    onSuccess: (r) => { setDialog(false); setError(null); toast(t('bc.explore.saved')); void qc.invalidateQueries({ queryKey: ['explorations'] }); void qc.invalidateQueries({ queryKey: ['exploration'] }); nav(`/analytics/explorations/${r.exploration.id.split('/').pop()}`, { replace: true }); },
    onError: (e) => setError(errText(e)),
  });
  const del = useMutation({
    mutationFn: () => mutate(EXPLORATION_DELETE, { id: `gid://shopify/ShopmeExploration/${id}` }, 'shopmeExplorationDelete'),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['explorations'] }); nav('/analytics/reports'); }, onError: (e) => toast(errText(e), 'critical'),
  });
  useEffect(() => { if (!isNew) void gql('mutation($k: String!) { shopmeReportViewed(key: $k) { state { key } } }', { k: `EXPLORATION:${id}` }).catch(() => undefined); }, [id, isNew]);

  const set = (p: Partial<Def>) => setDef((d) => ({ ...d, ...p }));
  const changeDataset = (dataset: Dataset) => {
    const c = catalog.data![dataset];
    set({ dataset, metrics: [c.metrics[0]!.key], dimension: c.dimensions.find((d) => d.key === 'day')?.key ?? null, filters: [] });
  };
  const toggleMetric = (key: string) => set({ metrics: def.metrics.includes(key) ? def.metrics.filter((m) => m !== key) : [...def.metrics, key] });
  const query: ReportQuery = { ...emptyQuery(), from: def.dataset.toLowerCase(), show: def.metrics, by: def.dimension, where: def.filters, since: def.period === 'CUSTOM' ? def.from ?? range.from : def.period, until: def.period === 'CUSTOM' ? def.to ?? range.to : null, compare: def.compare, visualize: def.visualization, cumulative: !!def.cumulative };
  const apply = (q: ReportQuery): string | null => {
    const ds = (q.from ?? def.dataset.toLowerCase()).toUpperCase() as Dataset;
    if (!DATASETS.includes(ds)) return t('bc.query.error.badDataset', { token: q.from ?? '' });
    const c = catalog.data![ds];
    const bad = q.show.find((k) => !c.metrics.some((m) => m.key === k));
    if (bad) return t('bc.query.error.badMetric', { token: bad });
    if (!q.show.length) return t('bc.query.error.emptyClause', { token: 'SHOW' });
    if (q.by && !c.dimensions.some((d) => d.key === q.by)) return t('bc.query.error.badDimension', { token: q.by });
    const badFilter = q.where.find((w) => !c.filters.some((x) => x.key === w.field));
    if (badFilter) return t('bc.query.error.badField', { token: badFilter.field });
    const isDate = !!q.since && /^\d{4}-\d{2}-\d{2}$/.test(q.since);
    if (q.since && !isDate && !(PRESETS as string[]).includes(q.since)) return t('bc.query.error.badSince', { token: q.since });
    setDef({ dataset: ds, metrics: q.show, dimension: q.by, filters: q.where, period: !q.since ? def.period : isDate ? 'CUSTOM' : q.since, from: isDate ? q.since! : undefined, to: isDate ? q.until ?? today : undefined, compare: q.compare ?? 'NONE', visualization: q.visualize ?? (q.by && c.dimensions.find((d) => d.key === q.by)?.date ? 'LINE' : 'TABLE'), cumulative: q.cumulative });
    return null;
  };

  const res = cur.data;
  const metricCols = res?.columns.filter((c) => c.key !== 'dim') ?? [];
  const chartCol = metricCols[0];
  const chartIdx = res && chartCol ? res.columns.indexOf(chartCol) : -1;
  const chartSeries = useMemo<Series[]>(() => {
    if (!res || chartIdx < 0) return [];
    const pts = (r: Result): Array<[string, number]> => { const v = r.rows.map((x) => Number(x[chartIdx] ?? 0)); const c = def.cumulative ? cumulate(v) : v; return r.rows.map((x, i) => [String(x[0]), c[i]!]); };
    const out: Series[] = [{ label: `${range.from} – ${range.to}`, color: 'var(--color-primary)', points: pts(res) }];
    if (before.data && prevRange && dim?.date) out.push({ label: `${prevRange.from} – ${prevRange.to}`, color: 'var(--color-text-muted)', dashed: true, points: pts(before.data) });
    return out;
  }, [res, before.data, chartIdx, def.cumulative, dim?.date, range.from, range.to, prevRange?.from, prevRange?.to]);
  const Chart = def.visualization === 'BAR' || !dim?.date ? BarChart : LineChart;

  if (!isNew && saved.isLoading) return <Skeleton className="h-64" />;
  if (!isNew && saved.data === null) return <Banner>{t('bc.explore.notFound')}</Banner>;
  if (catalog.isLoading) return <Skeleton className="h-64" />;
  if (catalog.error) return <Banner>{catalog.error.message}</Banner>;
  return (
    <>
      <TopBar back="/analytics/reports" icon={<BarChart3 />} crumbs={[{ label: t('analytics.reports'), to: '/analytics/reports' }, { label: name || t('bc.explore.untitled') }]}
        actions={<>
          <Button variant="primary" onClick={() => (name ? save.mutate() : setDialog(true))} loading={save.isPending && !dialog}><Save className="size-4" />{t('bc.explore.save')}</Button>
          {!isNew && <Dropdown align="right" chevron label={t('qa.moreActions')} trigger={t('qa.moreActions')} items={[{ key: 'rename', label: t('bc.explore.rename'), onSelect: () => setDialog(true) }, { key: 'delete', label: t('common.delete'), danger: true, onSelect: () => setConfirm(true) }]} />}
        </>} />
      <div className="flex flex-col gap-4">
        <QueryBox query={query} onApply={apply} />
        <div className="grid gap-4 lg:grid-cols-[1fr_18rem]">
          <div className="flex min-w-0 flex-col gap-4">
            {cur.error && <Banner>{(cur.error as Error).message}</Banner>}
            {def.metrics.length === 0 && <Banner tone="info">{t('bc.explore.pickMetric')}</Banner>}
            {res && metricCols.length > 0 && (
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                {metricCols.slice(0, 4).map((c, i) => {
                  const total = res.totals[c.key];
                  const prevTotal = before.data?.totals[c.key];
                  const d = total === undefined || prevTotal === undefined ? null : delta(total, prevTotal);
                  const ci = res.columns.indexOf(c);
                  return (
                    <div key={c.key} className="rounded-lg bg-canvas p-4 shadow-card">
                      <p className="text-[13px] text-muted">{cells.colLabel(c)}</p>
                      <p className="mt-1 text-xl font-semibold">{total === undefined ? '—' : cells.cell(c, total)}</p>
                      {d !== null && <p className={cx('text-xs', d >= 0 ? 'text-success' : 'text-critical')}>{d >= 0 ? '+' : ''}{d} %</p>}
                      {dim?.date && i < 4 && <Sparkline values={res.rows.map((r) => Number(r[ci] ?? 0))} label={cells.colLabel(c)} />}
                    </div>
                  );
                })}
              </div>
            )}
            {def.visualization !== 'TABLE' && chartCol && res && res.rows.length > 0 && (
              <Card title={cells.colLabel(chartCol)}>
                <Chart series={chartSeries} format={(n) => cells.cell(chartCol, Math.round(n))} label={cells.colLabel(chartCol)} />
              </Card>
            )}
            <Card title={name || t('bc.explore.untitled')}>
              {cur.isLoading ? <Skeleton className="h-32" /> : !res || res.rows.length === 0 ? <EmptyState icon={<Activity className="size-10" />} title={t('analytics.noData')} /> : (
                <div className="overflow-x-auto">
                  <table className="w-full text-[13px]">
                    <thead><tr className="border-b border-line text-left text-muted">{res.columns.map((c) => <th key={c.key} scope="col" className={cx('px-2 py-1.5 font-medium', c.type !== 'text' && c.type !== 'date' && 'text-right')}>{c.key === 'dim' ? (dim ? t(`bc.dim.${dim.key}` as Key) : t('bc.explore.total')) : cells.colLabel(c)}</th>)}</tr></thead>
                    <tbody>{res.rows.map((r, i) => <tr key={i} className="border-b border-line last:border-0">{r.map((v, j) => <td key={j} className={cx('px-2 py-1.5', res.columns[j]!.type !== 'text' && res.columns[j]!.type !== 'date' && 'text-right tabular-nums')}>{j === 0 && !dim ? t('bc.explore.total') : cells.cell(res.columns[j]!, v)}</td>)}</tr>)}</tbody>
                  </table>
                </div>
              )}
            </Card>
          </div>
          <aside aria-label={t('bc.controls.title')} className="flex flex-col gap-3 self-start rounded-lg bg-canvas p-4 text-[13px] shadow-card">
            <h2 className="font-semibold">{t('bc.controls.title')}</h2>
            <Select label={t('bc.explore.dataset')} value={def.dataset} onChange={(e) => changeDataset(e.target.value as Dataset)}>{DATASETS.map((d) => <option key={d} value={d}>{t(`bc.dataset.${d}` as Key)}</option>)}</Select>
            <fieldset className="flex flex-col gap-1.5">
              <legend className="mb-1 font-medium">{t('bc.controls.metrics')}</legend>
              {cat?.metrics.map((m) => <label key={m.key} className="flex items-center gap-2"><input type="checkbox" checked={def.metrics.includes(m.key)} onChange={() => toggleMetric(m.key)} />{cells.colLabel({ key: m.key, label: m.label, type: m.type })}</label>)}
            </fieldset>
            <Select label={t('bc.explore.dimension')} value={def.dimension ?? ''} onChange={(e) => { const d = e.target.value || null; set({ dimension: d, visualization: d && cat?.dimensions.find((x) => x.key === d)?.date ? 'LINE' : def.visualization === 'LINE' ? 'BAR' : def.visualization }); }}>
              <option value="">{t('bc.explore.noDimension')}</option>{cat?.dimensions.map((d) => <option key={d.key} value={d.key}>{t(`bc.dim.${d.key}` as Key)}</option>)}
            </Select>
            <Select label={t('analytics.range')} value={def.period} onChange={(e) => set({ period: e.target.value, ...(e.target.value === 'CUSTOM' && { from: range.from, to: range.to }) })}>{PRESETS.map((p) => <option key={p} value={p}>{t(`analytics.preset.${p}` as Key)}</option>)}<option value="CUSTOM">{t('analytics.custom')}</option></Select>
            {def.period === 'CUSTOM' && <div className="grid grid-cols-2 gap-2"><Input type="date" label={t('analytics.from')} value={def.from ?? range.from} onChange={(e) => set({ from: e.target.value })} /><Input type="date" label={t('analytics.to')} value={def.to ?? range.to} onChange={(e) => set({ to: e.target.value })} /></div>}
            <Select label={t('analytics.compare')} value={def.compare} disabled={!dim?.date} help={!dim?.date ? t('bc.explore.compareHelp') : undefined} onChange={(e) => set({ compare: e.target.value as Compare })}>{(['NONE', 'PREVIOUS_PERIOD', 'PREVIOUS_YEAR'] as const).map((c) => <option key={c} value={c}>{t(`analytics.compare.${c}` as Key)}</option>)}</Select>
            <Select label={t('bc.controls.viz')} value={def.visualization} onChange={(e) => set({ visualization: e.target.value as Viz })}>{dim?.date && <option value="LINE">{t('bc.viz.LINE')}</option>}<option value="BAR">{t('bc.viz.BAR')}</option><option value="TABLE">{t('bc.viz.TABLE')}</option></Select>
            {dim?.date && def.visualization !== 'TABLE' && <Switch checked={!!def.cumulative} onChange={(v) => set({ cumulative: v })} label={t('bc.controls.cumulative')} />}
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1 font-medium">{t('bc.controls.filters')}</legend>
              {def.filters.map((fl, i) => (
                <div key={i} className="grid grid-cols-[1fr_3.5rem_1fr_auto] items-center gap-1">
                  <select aria-label={t('bc.controls.filterField')} className="field-control" value={fl.field} onChange={(e) => set({ filters: def.filters.map((x, k) => (k === i ? { ...x, field: e.target.value } : x)) })}>{cat?.filters.map((c) => <option key={c.key} value={c.key}>{t(`bc.filter.${c.key}` as Key)}</option>)}</select>
                  <select aria-label={t('bc.controls.filterOp')} className="field-control" value={fl.op} onChange={(e) => set({ filters: def.filters.map((x, k) => (k === i ? { ...x, op: e.target.value as QueryOp } : x)) })}>{OPS.map((o) => <option key={o.op} value={o.op}>{o.label}</option>)}</select>
                  <input aria-label={t('bc.controls.filterValue')} className="field-control" value={fl.value} onChange={(e) => set({ filters: def.filters.map((x, k) => (k === i ? { ...x, value: e.target.value } : x)) })} />
                  <Button variant="plain" size="sm" icon aria-label={t('common.remove')} onClick={() => set({ filters: def.filters.filter((_, k) => k !== i) })}>×</Button>
                </div>
              ))}
              <Button size="sm" className="w-fit" disabled={!cat?.filters.length} onClick={() => set({ filters: [...def.filters, { field: cat!.filters[0]!.key, op: 'EQ', value: '' }] })}>{t('bc.controls.addFilter')}</Button>
              <p className="text-xs text-muted">{t('bc.explore.filterHelp')}</p>
            </fieldset>
          </aside>
        </div>
      </div>
      <Modal open={dialog} onClose={() => setDialog(false)} title={t(isNew ? 'bc.explore.saveTitle' : 'bc.explore.rename')} closeLabel={t('common.close')}
        footer={<><Button onClick={() => setDialog(false)}>{t('common.cancel')}</Button><Button variant="primary" loading={save.isPending} disabled={!name.trim()} onClick={() => save.mutate()}>{t('save.save')}</Button></>}>
        <div className="flex flex-col gap-3">{error && <Banner>{error}</Banner>}<Input label={t('field.name')} autoFocus maxLength={120} value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && name.trim()) save.mutate(); }} /></div>
      </Modal>
      <Modal open={confirm} onClose={() => setConfirm(false)} title={t('bc.explore.deleteTitle')} closeLabel={t('common.close')} plain
        footer={<><Button onClick={() => setConfirm(false)}>{t('common.cancel')}</Button><Button variant="critical" loading={del.isPending} onClick={() => del.mutate()}>{t('common.delete')}</Button></>}>
        <p className="text-[13px]">{t('bc.explore.deleteBody')}</p>
      </Modal>
    </>
  );
}
