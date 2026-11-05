import { Banner, Button, Card, Dropdown, EmptyState, Input, Pagination, Select, Skeleton, Switch, Tooltip, cx } from '@shopme/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowUpDown, Download, FileText, MoreHorizontal, Pin, PinOff, RefreshCw, Search, SlidersHorizontal, StickyNote, Target } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router';
import { gql, mutate } from '../api';
import { AnnotationsPanel, GoalsDialog, GoalsStrip, QueryBox, RangeSlider, useAnnotations } from '../components/AnalyticsParts';
import { BarChart, LineChart, Sparkline } from '../components/Charts';
import type { Series } from '../components/Charts';
import { TopBar } from '../components/OrderChrome';
import { PageHeader } from '../components/PageHeader';
import { useFormat } from '../components/shared';
import { EXPLORATIONS, REPORT_CURRENCIES, REPORT_PIN, REPORT_STATES, REPORT_VIEWED, SHOPME_REPORT_CURRENCY } from '../graphql';
import { useI18n } from '../i18n';
import type { Key } from '../i18n';
import { en } from '../i18n/en';
import { CHART_COLUMN, PRESETS, REPORTS, REPORT_CATEGORY, SNAPSHOT_REPORTS, TIME_REPORTS, comparisonRange, delta, fillSeries, presetRange } from '../lib/analytics';
import type { Compare, Preset, Range, ReportName } from '../lib/analytics';
import { cumulate, emptyQuery, matchesFilter, parseReportQuery } from '../lib/report-query';
import type { QueryFilter, QueryOp, ReportQuery } from '../lib/report-query';
import { useShop } from '../session';
import emptyAnalytics from '../assets/empty/empty-analytics.webp';

type Group = 'DAY' | 'WEEK' | 'MONTH';
type Viz = 'LINE' | 'BAR' | 'TABLE';
interface Column { key: string; label: string; type: 'text' | 'date' | 'int' | 'money' | 'percent' }
interface Report { name: string; currencyCode: string; from: string; to: string; columns: Column[]; rows: Array<Array<string | number | null>>; totals: Record<string, number> }

export const todayIn = (tz: string) => { try { return new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date()); } catch { return new Date().toISOString().slice(0, 10); } };

function useReport(name: ReportName, range: Range | null, groupBy: Group, currency = '') {
  return useQuery({
    queryKey: ['report', name, range?.from, range?.to, groupBy, currency], enabled: !!range && range.from <= range.to,
    queryFn: async () => (await gql<{ shopmeReport: Report }>(SHOPME_REPORT_CURRENCY, { name, from: range!.from, to: range!.to, groupBy, currency: currency || null })).shopmeReport,
  });
}

/** Money cells are minor units; the number of decimals comes from the currency. */
export function useCells(currency: string) {
  const { lang, t } = useI18n();
  return useMemo(() => {
    const digits = new Intl.NumberFormat(lang, { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2;
    const money = (v: number) => new Intl.NumberFormat(lang, { style: 'currency', currency }).format(v / 10 ** digits);
    const num = new Intl.NumberFormat(lang);
    const cell = (c: Column, v: string | number | null) => (v === null || v === '' ? '—' : c.type === 'money' ? money(Number(v)) : c.type === 'percent' ? `${num.format(Number(v))} %` : c.type === 'int' ? num.format(Number(v)) : label(c, String(v)));
    const label = (c: Column, v: string) => {
      // Fixed vocabularies get a translation: sales channels, RFM groups, ABC classes.
      const k = `bc.value.${c.key}.${v}`;
      return k in en ? t(k as Key) : v;
    };
    const colLabel = (c: Column) => { const k = `analytics.col.${c.key}`; const k2 = `bc.metric.${c.key}`; return k in en ? t(k as Key) : k2 in en ? t(k2 as Key) : c.label; };
    return { money, cell, colLabel, num };
  }, [lang, currency, t]);
}

const fmtRange = (r: Range) => (r.from === r.to ? r.from : `${r.from} – ${r.to}`);

/** Date range, comparison, grouping and currency, shared by the overview and the report pages, kept in the URL. */
function useFilters() {
  const { shop } = useShop();
  const [sp, setSp] = useSearchParams();
  const today = todayIn(shop.timezone);
  const preset = (sp.get('preset') ?? 'LAST_30_DAYS') as Preset | 'CUSTOM';
  const range: Range = preset === 'CUSTOM' ? { from: sp.get('from') ?? today, to: sp.get('to') ?? today } : presetRange((PRESETS as string[]).includes(preset) ? (preset as Preset) : 'LAST_30_DAYS', today);
  const compare = (sp.get('compare') ?? 'PREVIOUS_PERIOD') as Compare;
  const groupBy = (sp.get('group') ?? 'DAY') as Group;
  const currency = sp.get('cur') ?? '';
  const valid = range.from <= range.to;
  const patch = (changes: Record<string, string>) => { const next = new URLSearchParams(sp); for (const [k, v] of Object.entries(changes)) (v ? next.set(k, v) : next.delete(k)); setSp(next, { replace: true }); };
  return { sp, preset, range, compare, groupBy, currency, valid, patch, today, prevRange: valid ? comparisonRange(range, compare) : null };
}
type Filters = ReturnType<typeof useFilters>;

/** Rounded select pill used by the filter row. */
function Pill({ label, value, onChange, children }: { label: string; value: string; onChange: (v: string) => void; children: React.ReactNode }) {
  return <select aria-label={label} title={label} value={value} onChange={(e) => onChange(e.target.value)} className="h-8 cursor-pointer rounded-full border border-line bg-canvas px-3 text-[13px] font-medium shadow-card hover:bg-hover">{children}</select>;
}

const useCurrencies = () => useQuery({ queryKey: ['report-currencies'], staleTime: 60_000, queryFn: async () => (await gql<{ shopmeReportCurrencies: Array<{ code: string; rate: number }> }>(REPORT_CURRENCIES)).shopmeReportCurrencies });

function FilterBar({ f, compare = true, group = false, money = false }: { f: Filters; compare?: boolean; group?: boolean; money?: boolean }) {
  const { t } = useI18n();
  const currencies = useCurrencies();
  const cls = 'w-auto';
  return (
    <div className="flex flex-wrap items-end gap-2">
      <Pill label={t('analytics.range')} value={f.preset} onChange={(v) => f.patch({ preset: v, from: '', to: '' })}>
        {PRESETS.map((p) => <option key={p} value={p}>{t(`analytics.preset.${p}` as Key)}</option>)}
        <option value="CUSTOM">{t('analytics.custom')}</option>
      </Pill>
      {f.preset === 'CUSTOM' && (
        <>
          <Input className={cls} type="date" label={t('analytics.from')} value={f.range.from} max={f.range.to} onChange={(e) => f.patch({ preset: 'CUSTOM', from: e.target.value })} />
          <Input className={cls} type="date" label={t('analytics.to')} value={f.range.to} min={f.range.from} onChange={(e) => f.patch({ preset: 'CUSTOM', to: e.target.value })} />
        </>
      )}
      {compare && (
        <Pill label={t('analytics.compare')} value={f.compare} onChange={(v) => f.patch({ compare: v })}>
          {(['NONE', 'PREVIOUS_PERIOD', 'PREVIOUS_YEAR'] as const).map((c) => <option key={c} value={c}>{t(`analytics.compare.${c}` as Key)}</option>)}
        </Pill>
      )}
      {group && (
        <Pill label={t('analytics.groupBy')} value={f.groupBy} onChange={(v) => f.patch({ group: v })}>
          {(['DAY', 'WEEK', 'MONTH'] as const).map((g) => <option key={g} value={g}>{t(`analytics.group.${g}` as Key)}</option>)}
        </Pill>
      )}
      {money && (currencies.data?.length ?? 0) > 1 && (
        <Pill label={t('bc.analytics.currency')} value={f.currency || currencies.data![0]!.code} onChange={(v) => f.patch({ cur: v === currencies.data![0]!.code ? '' : v })}>
          {currencies.data!.map((c) => <option key={c.code} value={c.code}>{c.code}</option>)}
        </Pill>
      )}
    </div>
  );
}

type Cells = ReturnType<typeof useCells>;

/** "Last refreshed" time of the data on the page, with a button to reload it. */
function Refreshed({ at, fetching }: { at: number; fetching: boolean }) {
  const { t, lang } = useI18n();
  const qc = useQueryClient();
  const [, tick] = useState(0);
  useEffect(() => { const id = setInterval(() => tick((n) => n + 1), 30_000); return () => clearInterval(id); }, []);
  const time = at ? new Intl.DateTimeFormat(lang, { timeStyle: 'short' }).format(new Date(at)) : '—';
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted">
      {t('bc.analytics.refreshed', { time })}
      <Tooltip content={t('analytics.refresh')}><button type="button" aria-label={t('analytics.refresh')} disabled={fetching} onClick={() => void qc.invalidateQueries({ queryKey: ['report'] })} className="grid size-6 place-items-center rounded-md hover:bg-hover disabled:opacity-50"><RefreshCw className={cx('size-3.5', fetching && 'animate-spin')} /></button></Tooltip>
    </span>
  );
}

interface ChartOpts { viz: Viz; cumulative: boolean; metric?: string; marks?: Array<{ day: string; text: string }> }

/** Chart of one column of a time report, with the comparison period dashed or lighter, a range slider to zoom and a legend below. */
function SeriesChart({ name, rep, prev, f, cells, loading, opts }: { name: ReportName; rep: Report | undefined; prev: Report | undefined; f: Filters; cells: Cells; loading: boolean; opts?: Partial<ChartOpts> }) {
  const { t } = useI18n();
  const [zoom, setZoom] = useState<[number, number] | null>(null);
  const metricKey = opts?.metric ?? CHART_COLUMN[name];
  const idx = rep ? rep.columns.findIndex((c) => c.key === metricKey) : -1;
  const col = rep?.columns[idx];
  const key = `${rep?.from}${rep?.to}${f.groupBy}${metricKey}`;
  useEffect(() => setZoom(null), [key]);
  if (loading) return <Skeleton className="h-48" />;
  if (!rep || !col || !rep.rows.length) return <p className="py-8 text-center text-[13px] text-muted">{t('analytics.noData')}</p>;
  const toSeries = (r: Report, r0: Range) => fillSeries(r.rows.map((x) => [String(x[0]), Number(x[idx] ?? 0)] as [string, number]), r0, f.groupBy);
  let main = toSeries(rep, f.range);
  let before = prev && f.prevRange ? toSeries(prev, f.prevRange) : null;
  const accumulate = (pts: Array<[string, number]>): Array<[string, number]> => { const c = cumulate(pts.map((p) => p[1])); return pts.map((p, i) => [p[0], c[i]!]); };
  if (opts?.cumulative) { main = accumulate(main); before = before && accumulate(before); }
  const [lo, hi] = zoom ?? [0, main.length - 1];
  const cut = (pts: Array<[string, number]>) => pts.slice(lo, hi + 1);
  const series: Series[] = [{ label: fmtRange(f.range), color: 'var(--color-primary)', points: cut(main) }];
  if (before) series.push({ label: fmtRange(f.prevRange!), color: 'var(--color-text-muted)', dashed: true, points: cut(before) });
  const Chart = opts?.viz === 'BAR' ? BarChart : LineChart;
  return (
    <>
      <Chart series={series} format={(n) => cells.cell(col, Math.round(n))} label={t(`analytics.report.${name}` as Key)} marks={opts?.marks} />
      <RangeSlider length={main.length} value={[lo, hi]} onChange={setZoom} labels={[main[lo]![0], main[hi]![0]]} />
      <ul className="mt-2 flex flex-wrap justify-center gap-x-4 gap-y-1 text-xs text-muted">
        {series.map((s, i) => <li key={s.label} className="flex items-center gap-1.5"><span aria-hidden className={cx('inline-block h-0 w-4 border-t-2', i > 0 && 'border-dashed')} style={{ borderColor: s.color }} />{s.label}</li>)}
      </ul>
    </>
  );
}

const cardCls = 'rounded-lg bg-canvas p-4 shadow-card';

function Kpi({ to, label, cur, before, cells, col, spark }: { to?: string; label: string; cur: number | undefined; before: number | undefined; cells: Cells; col: Column; spark?: number[] }) {
  const { t } = useI18n();
  const d = cur === undefined || before === undefined ? null : delta(cur, before);
  const body = (
    <>
      <p className="text-[13px] text-muted">{label}</p>
      <p className="mt-1 text-xl font-semibold">{cur === undefined ? '—' : cells.cell(col, cur)}</p>
      {before !== undefined && cur !== undefined && (
        <p className={cx('text-xs', d === null ? 'text-muted' : d >= 0 ? 'text-success' : 'text-critical')}>{d === null ? '—' : `${d >= 0 ? '+' : ''}${d} %`} <span className="text-muted">{t('analytics.vs', { value: cells.cell(col, before) })}</span></p>
      )}
      {spark && <Sparkline values={spark} label={label} />}
    </>
  );
  return to ? <Link to={to} className={cx(cardCls, 'block hover:bg-hover')}>{body}</Link> : <div className={cardCls}>{body}</div>;
}
const columnValues = (r: Report | undefined, key: string) => { const i = r?.columns.findIndex((c) => c.key === key) ?? -1; return i < 0 ? undefined : r!.rows.map((x) => Number(x[i] ?? 0)); };

/** Analytics overview: key metrics, goals, sales over time with its breakdown, sales by channel, average order value and best sellers. */
export function AnalyticsPage() {
  const { t } = useI18n();
  const { shop } = useShop();
  const f = useFilters();
  const nav = useNavigate();
  const [goalsOpen, setGoalsOpen] = useState(false);
  const range = f.valid ? f.range : null;
  const cur = f.currency;
  const sales = useReport('SALES_OVER_TIME', range, f.groupBy, cur), salesPrev = useReport('SALES_OVER_TIME', f.prevRange, f.groupBy, cur);
  const ords = useReport('ORDERS_OVER_TIME', range, f.groupBy, cur), ordsPrev = useReport('ORDERS_OVER_TIME', f.prevRange, f.groupBy, cur);
  const aov = useReport('AVERAGE_ORDER_VALUE', range, f.groupBy, cur), aovPrev = useReport('AVERAGE_ORDER_VALUE', f.prevRange, f.groupBy, cur);
  const ret = useReport('RETURNING_CUSTOMER_RATE', range, f.groupBy, cur), retPrev = useReport('RETURNING_CUSTOMER_RATE', f.prevRange, f.groupBy, cur);
  const products = useReport('SALES_BY_PRODUCT', range, f.groupBy, cur);
  const channels = useReport('SALES_BY_CHANNEL', range, f.groupBy, cur);
  const cells = useCells(sales.data?.currencyCode ?? (cur || shop.currency));
  const to = (name: ReportName) => ({ pathname: `/analytics/reports/${name}`, search: f.sp.toString() });
  const money = (key: string): Column => ({ key, label: '', type: 'money' });
  const breakdown = ['gross', 'discounts', 'refunds', 'shipping', 'taxes', 'total'] as const;
  const err = sales.error ?? aov.error ?? ret.error ?? products.error ?? ords.error;
  const topProducts = (products.data?.rows ?? []).slice(0, 5);
  const salesCol = sales.data?.columns.find((c) => c.key === 'total');
  const csv = `/admin/api/reports/SALES_OVER_TIME.csv?from=${f.range.from}&to=${f.range.to}&groupBy=${f.groupBy}`;
  const topChannels = (channels.data?.rows ?? []).slice(0, 5);
  const channelMax = Math.max(1, ...topChannels.map((r) => Number(r[2] ?? 0)));
  const refreshedAt = Math.max(sales.dataUpdatedAt, ords.dataUpdatedAt, aov.dataUpdatedAt);
  const fetching = sales.isFetching || ords.isFetching || aov.isFetching || ret.isFetching;
  return (
    <>
      <PageHeader
        title={t('analytics.title')} subtitle={<Refreshed at={refreshedAt} fetching={fetching} />}
        actions={<>
          <Dropdown align="right" icon label={t('qa.moreActions')} trigger={<MoreHorizontal className="size-4" />} items={[
            { key: 'live', label: t('bc.analytics.live'), onSelect: () => nav('/analytics/live') },
            { key: 'csv', label: t('analytics.exportCsv'), onSelect: () => { window.location.href = csv; } },
          ]} />
          <Button onClick={() => setGoalsOpen(true)}><Target className="size-4" />{t('bc.goal.button')}</Button>
          <Link to="/analytics/reports" className="btn btn-secondary">{t('analytics.viewReports')}</Link>
          <Link to="/analytics/explorations/new" className="btn btn-primary">{t('bc.explore.new')}</Link>
        </>}
      />
      <div className="flex flex-col gap-4">
        <FilterBar f={f} group money />
        {!f.valid && <Banner>{t('analytics.invalidRange')}</Banner>}
        {err && <Banner>{err.message}</Banner>}
        <GoalsStrip onEdit={() => setGoalsOpen(true)} />
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Kpi to={`${to('SALES_OVER_TIME').pathname}?${f.sp}`} label={t('analytics.col.gross')} cur={sales.data?.totals.gross} before={salesPrev.data?.totals.gross} cells={cells} col={money('gross')} spark={columnValues(sales.data, 'gross')} />
          <Kpi to={`${to('RETURNING_CUSTOMER_RATE').pathname}?${f.sp}`} label={t('analytics.col.rate')} cur={ret.data?.totals.rate} before={retPrev.data?.totals.rate} cells={cells} col={{ key: 'rate', label: '', type: 'percent' }} spark={columnValues(ret.data, 'rate')} />
          <Kpi to={`${to('ORDERS_OVER_TIME').pathname}?${f.sp}`} label={t('bc.analytics.fulfilled')} cur={ords.data?.totals.fulfilled} before={ordsPrev.data?.totals.fulfilled} cells={cells} col={{ key: 'fulfilled', label: '', type: 'int' }} spark={columnValues(ords.data, 'fulfilled')} />
          <Kpi to={`${to('ORDERS_OVER_TIME').pathname}?${f.sp}`} label={t('analytics.col.orders')} cur={ords.data?.totals.orders} before={ordsPrev.data?.totals.orders} cells={cells} col={{ key: 'orders', label: '', type: 'int' }} spark={columnValues(ords.data, 'orders')} />
        </div>
        <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
          <Card title={t('analytics.report.SALES_OVER_TIME')}>
            <p className="-mt-1 mb-2 text-xl font-semibold">{salesCol && sales.data ? cells.cell(salesCol, sales.data.totals.total ?? 0) : '—'}</p>
            <SeriesChart name="SALES_OVER_TIME" rep={sales.data} prev={salesPrev.data} f={f} cells={cells} loading={sales.isLoading} />
          </Card>
          <Card title={t('analytics.breakdown')}>
            <ul className="-mx-2 text-[13px]">
              {breakdown.map((k, i) => {
                const c = sales.data?.columns.find((x) => x.key === k);
                return (
                  <li key={k} className={cx('rounded-md', i % 2 === 1 && 'bg-surface')}>
                    <Link to={to('SALES_OVER_TIME')} className="flex items-center justify-between gap-2 px-2 py-2 hover:underline">
                      <span className={cx(k !== 'total' && 'text-accent')}>{t(`analytics.col.${k}` as Key)}</span>
                      <span className="tabular-nums">{c && sales.data ? cells.cell(c, sales.data.totals[k] ?? 0) : '—'}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </Card>
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <Card title={t('analytics.report.SALES_BY_CHANNEL')} actions={<Link to={to('SALES_BY_CHANNEL')} className="text-[13px] text-accent hover:underline">{t('analytics.viewReport')}</Link>}>
            {channels.isLoading ? <Skeleton className="h-32" /> : topChannels.length === 0 ? <p className="py-8 text-center text-[13px] text-muted">{t('analytics.noData')}</p> : (
              <ul className="flex flex-col gap-2.5 text-[13px]">
                {topChannels.map((r, i) => (
                  <li key={i}>
                    <div className="mb-1 flex items-center justify-between gap-3"><span className="min-w-0 truncate">{cells.cell(channels.data!.columns[0]!, r[0] ?? null)}</span><span className="tabular-nums">{cells.cell(channels.data!.columns[2]!, r[2] ?? 0)}</span></div>
                    <div className="h-1.5 rounded-full bg-surface"><div className="h-1.5 rounded-full bg-primary" style={{ width: `${(Number(r[2] ?? 0) / channelMax) * 100}%` }} /></div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card title={t('analytics.report.AVERAGE_ORDER_VALUE')}>
            <SeriesChart name="AVERAGE_ORDER_VALUE" rep={aov.data} prev={aovPrev.data} f={f} cells={cells} loading={aov.isLoading} />
          </Card>
        </div>
        <Card title={t('analytics.report.SALES_BY_PRODUCT')} actions={<Link to={to('SALES_BY_PRODUCT')} className="text-[13px] text-accent hover:underline">{t('analytics.viewReport')}</Link>}>
          {products.isLoading ? <Skeleton className="h-32" /> : topProducts.length === 0 ? <p className="py-8 text-center text-[13px] text-muted">{t('analytics.noData')}</p> : (
            <ul className="divide-y divide-line text-[13px]">
              {topProducts.map((r, i) => (
                <li key={i} className="flex items-center justify-between gap-3 py-2"><span className="min-w-0 truncate">{String(r[0])}</span><span className="tabular-nums">{cells.cell(products.data!.columns[2]!, r[2] ?? 0)}</span></li>
              ))}
            </ul>
          )}
        </Card>
      </div>
      <GoalsDialog open={goalsOpen} onClose={() => setGoalsOpen(false)} />
    </>
  );
}

/* ------------------------------ reports list ------------------------------ */

interface ReportState { key: string; pinned: boolean; lastViewedAt: string | null }
interface ExplorationRow { id: string; name: string; createdByName: string | null; updatedAt: string }
const LIST_PAGE = 20;

/** Searchable list of every report and saved exploration: category, last viewed, who made it, with pinning. */
export function ReportsListPage() {
  const { t } = useI18n();
  const fmt = useFormat();
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [asc, setAsc] = useState(true);
  const [page, setPage] = useState(0);
  const states = useQuery({ queryKey: ['report-states'], queryFn: async () => (await gql<{ shopmeReportStates: ReportState[] }>(REPORT_STATES)).shopmeReportStates });
  const explorations = useQuery({ queryKey: ['explorations'], queryFn: async () => (await gql<{ shopmeExplorations: ExplorationRow[] }>(EXPLORATIONS)).shopmeExplorations });
  const stateOf = (key: string) => states.data?.find((s) => s.key === key);
  const pin = useMutation({ mutationFn: (v: { key: string; pinned: boolean }) => mutate(REPORT_PIN, v, 'shopmeReportPin'), onSuccess: () => void qc.invalidateQueries({ queryKey: ['report-states'] }) });
  const all = [
    ...REPORTS.map((r) => ({ key: r as string, to: `/analytics/reports/${r}`, name: t(`analytics.report.${r}` as Key), category: t(`analytics.category.${REPORT_CATEGORY[r]}` as Key), by: 'ShopMe' })),
    ...(explorations.data ?? []).map((e) => ({ key: `EXPLORATION:${e.id.split('/').pop()}`, to: `/analytics/explorations/${e.id.split('/').pop()}`, name: e.name, category: t('bc.explore.category'), by: e.createdByName ?? t('bc.explore.you') })),
  ];
  const rows = all.filter((r) => `${r.name} ${r.category}`.toLowerCase().includes(search.trim().toLowerCase()))
    .sort((a, b) => (Number(!!stateOf(b.key)?.pinned) - Number(!!stateOf(a.key)?.pinned)) || (a.category.localeCompare(b.category) || a.name.localeCompare(b.name)) * (asc ? 1 : -1));
  const pages = Math.max(1, Math.ceil(rows.length / LIST_PAGE));
  const at = Math.min(page, pages - 1);
  const shown = rows.slice(at * LIST_PAGE, (at + 1) * LIST_PAGE);
  return (
    <>
      <PageHeader title={t('analytics.reports')} back="/analytics" actions={<Link to="/analytics/explorations/new" className="btn btn-primary">{t('bc.explore.new')}</Link>} />
      <div className="overflow-hidden rounded-lg bg-canvas shadow-card">
        <div className="flex items-center gap-2 border-b border-line px-3 py-2 text-muted">
          <Search className="size-4 shrink-0" aria-hidden />
          <input type="search" value={search} onChange={(e) => { setSearch(e.target.value); setPage(0); }} placeholder={t('analytics.searchReports')} aria-label={t('analytics.searchReports')} className="h-7 flex-1 bg-transparent text-[13px] text-fg outline-none placeholder:text-muted" />
          <button type="button" className="btn btn-plain btn-icon btn-sm" aria-label={t('common.sort')} onClick={() => setAsc((v) => !v)}><ArrowUpDown className="size-4" /></button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead><tr className="border-b border-line bg-surface text-left text-muted"><th className="w-10" /><th scope="col" className="px-4 py-2 font-medium">{t('analytics.reportName')}</th><th scope="col" className="px-4 py-2 font-medium">{t('analytics.categoryLabel')}</th><th scope="col" className="px-4 py-2 font-medium">{t('bc.reports.lastViewed')}</th><th scope="col" className="px-4 py-2 font-medium">{t('bc.reports.createdBy')}</th></tr></thead>
            <tbody>
              {shown.map((r) => {
                const s = stateOf(r.key);
                return (
                  <tr key={r.key} className="border-b border-line last:border-0 hover:bg-hover">
                    <td className="pl-3"><button type="button" aria-pressed={!!s?.pinned} aria-label={t(s?.pinned ? 'bc.reports.unpin' : 'bc.reports.pin', { name: r.name })} title={t(s?.pinned ? 'bc.reports.unpin' : 'bc.reports.pin', { name: r.name })} onClick={() => pin.mutate({ key: r.key, pinned: !s?.pinned })} className={cx('grid size-7 place-items-center rounded-md hover:bg-surface', s?.pinned ? 'text-accent' : 'text-muted')}>{s?.pinned ? <Pin className="size-4 fill-current" /> : <PinOff className="size-4" />}</button></td>
                    <td className="p-0"><Link to={r.to} className="block px-4 py-2.5 font-medium">{r.name}</Link></td>
                    <td className="px-4 py-2.5 text-muted">{r.category}</td>
                    <td className="px-4 py-2.5 text-muted">{s?.lastViewedAt ? fmt.dateTime(s.lastViewedAt) : '—'}</td>
                    <td className="px-4 py-2.5 text-muted">{r.by}</td>
                  </tr>
                );
              })}
              {rows.length === 0 && <tr><td colSpan={5} className="px-4 py-8 text-center text-muted">{t('analytics.noReports')}</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between border-t border-line px-3 py-1.5 text-xs text-muted">
          <span>{rows.length ? t('bc.reports.range', { from: at * LIST_PAGE + 1, to: Math.min(rows.length, (at + 1) * LIST_PAGE), n: rows.length }) : ''}</span>
          <Pagination hasPrevious={at > 0} hasNext={at < pages - 1} previousLabel={t('common.previous')} nextLabel={t('common.next')} onPrevious={() => setPage(at - 1)} onNext={() => setPage(at + 1)} />
        </div>
      </div>
    </>
  );
}

/** Old links (`/analytics/SALES_OVER_TIME`) now point to `/analytics/reports/…`. */
export function LegacyReportRedirect() {
  const { name = '' } = useParams();
  return <Navigate to={`/analytics/reports/${name}`} replace />;
}

/* ------------------------------ one report ------------------------------ */

const isMetric = (c: Column) => c.type === 'int' || c.type === 'money' || c.type === 'percent';
const OPS: Array<{ op: QueryOp; label: string }> = [{ op: 'EQ', label: '=' }, { op: 'NEQ', label: '≠' }, { op: 'CONTAINS', label: '~' }, { op: 'GT', label: '>' }, { op: 'LT', label: '<' }];

/** One report: filters and controls, a query box, key totals, chart with annotations, and the data table. */
export function ReportPage() {
  const { t } = useI18n();
  const { shop } = useShop();
  const nav = useNavigate();
  const params = useParams();
  const name = (REPORTS as readonly string[]).includes(params.name ?? '') ? (params.name as ReportName) : 'SALES_OVER_TIME';
  const f = useFilters();
  const qc = useQueryClient();
  const [auto, setAuto] = useState(false);
  const [panel, setPanel] = useState(false);
  const [notes, setNotes] = useState(false);
  useEffect(() => {
    if (!auto) return;
    const id = setInterval(() => void qc.invalidateQueries({ queryKey: ['report'] }), 30_000);
    return () => clearInterval(id);
  }, [auto, qc]);
  useEffect(() => { void gql(REPORT_VIEWED, { key: name }).then(() => qc.invalidateQueries({ queryKey: ['report-states'] })).catch(() => undefined); }, [name, qc]);
  const isTime = TIME_REPORTS.includes(name);
  const snapshot = SNAPSHOT_REPORTS.includes(name);
  const q = useReport(name, f.valid ? f.range : null, f.groupBy, f.currency);
  const prev = useReport(name, isTime ? f.prevRange : null, f.groupBy, f.currency);
  const rep = q.data;
  const cells = useCells(rep?.currencyCode ?? (f.currency || shop.currency));
  const metrics = rep ? rep.columns.filter(isMetric) : [];
  // Controls kept in the URL: visible metrics, chart metric, visualization, cumulative, row filters.
  const shownKeys = (f.sp.get('cols') ?? '').split(',').filter(Boolean);
  const visible = (c: Column, i: number) => i === 0 || !isMetric(c) || shownKeys.length === 0 || shownKeys.includes(c.key);
  const viz = ((f.sp.get('viz') ?? (isTime ? 'LINE' : 'TABLE')).toUpperCase()) as Viz;
  const cumulative = f.sp.get('cum') === '1';
  const metricKey = f.sp.get('metric') || CHART_COLUMN[name] || metrics[0]?.key;
  const whereText = f.sp.get('where') ?? '';
  const parsedWhere = whereText ? parseReportQuery(`WHERE ${whereText}`) : null;
  const filters: QueryFilter[] = parsedWhere?.ok ? parsedWhere.query.where : [];
  const kpis = rep ? rep.columns.filter((c) => (c.type === 'money' || c.type === 'int' || (c.type === 'percent' && c.key in rep.totals)) && c.key in rep.totals).slice(0, 4) : [];
  const csv = `/admin/api/reports/${name}.csv?from=${f.range.from}&to=${f.range.to}&groupBy=${f.groupBy}`;
  const metricCol = rep?.columns.find((c) => c.key === metricKey);
  const marksQ = useAnnotations(name, f.range.from, f.range.to);
  const marks = notes ? (marksQ.data ?? []).map((a) => ({ day: a.day, text: a.text })) : [];
  const setFilters = (list: QueryFilter[]) => f.patch({ where: list.map((x) => `${x.field} ${OPS.find((o) => o.op === x.op)!.label === '≠' ? '!=' : OPS.find((o) => o.op === x.op)!.label} ${/^[\w.:\-/]+$/.test(x.value) ? x.value : `"${x.value.replace(/"/g, '')}"`}`).join(' AND ') });
  const toggleMetric = (key: string) => { const base = shownKeys.length ? shownKeys : metrics.map((m) => m.key); const next = base.includes(key) ? base.filter((k) => k !== key) : [...base, key]; f.patch({ cols: next.length === metrics.length || next.length === 0 ? '' : next.join(',') }); };

  // The query box mirrors the controls: reading them gives the text, applying edited text sets them again.
  const query: ReportQuery = {
    ...emptyQuery(), from: name.toLowerCase(), show: shownKeys.length ? shownKeys : metrics.map((m) => m.key), by: isTime ? f.groupBy.toLowerCase() : null, where: filters,
    since: f.preset === 'CUSTOM' ? f.range.from : f.preset, until: f.preset === 'CUSTOM' ? f.range.to : null, compare: isTime ? f.compare : null, visualize: viz === (isTime ? 'LINE' : 'TABLE') ? null : viz, cumulative,
  };
  const apply = (nq: ReportQuery): string | null => {
    const target = (nq.from ?? name.toLowerCase()).toUpperCase();
    if (!(REPORTS as readonly string[]).includes(target)) return t('bc.query.error.badReport', { token: nq.from ?? '' });
    const isDate = !!nq.since && /^\d{4}-\d{2}-\d{2}$/.test(nq.since);
    const preset = !nq.since ? f.preset : isDate ? 'CUSTOM' : (PRESETS as string[]).includes(nq.since) ? nq.since : null;
    if (preset === null) return t('bc.query.error.badSince', { token: nq.since ?? '' });
    const keys = new Set(metrics.map((m) => m.key));
    const show = nq.show.filter((k) => keys.has(k));
    const next = new URLSearchParams(f.sp);
    const set = (k: string, v: string) => (v ? next.set(k, v) : next.delete(k));
    set('preset', preset === 'LAST_30_DAYS' ? '' : preset); set('from', preset === 'CUSTOM' ? nq.since! : ''); set('to', preset === 'CUSTOM' ? nq.until ?? f.today : '');
    set('compare', nq.compare ?? f.sp.get('compare') ?? ''); set('group', nq.by && ['day', 'week', 'month'].includes(nq.by) ? nq.by.toUpperCase() : '');
    set('cols', show.length && show.length !== keys.size ? show.join(',') : ''); set('viz', nq.visualize ?? ''); set('cum', nq.cumulative ? '1' : '');
    set('where', nq.where.map((w) => `${w.field} ${{ EQ: '=', NEQ: '!=', CONTAINS: '~', GT: '>', LT: '<' }[w.op]} ${/^[\w.:\-/]+$/.test(w.value) ? w.value : `"${w.value}"`}`).join(' AND '));
    if (target !== name) nav({ pathname: `/analytics/reports/${target}`, search: next.toString() }); else nav({ search: next.toString() }, { replace: true });
    return null;
  };

  const rows = (rep?.rows ?? []).map((r, i) => ({ r, i })).filter(({ r }) => filters.every((fl) => { const ci = rep!.columns.findIndex((c) => c.key === fl.field); return ci < 0 || matchesFilter(r[ci] ?? null, fl); }));
  const showCompare = isTime && !!prev.data && f.compare !== 'NONE';
  const columns = rep?.columns ?? [];
  const barRows = !isTime && rep && metricCol ? rep.rows.slice(0, 30) : [];

  return (
    <>
      <TopBar back="/analytics/reports" icon={<FileText />} crumbs={[{ label: t('analytics.reports'), to: '/analytics/reports' }, { label: t(`analytics.report.${name}` as Key) }]}
        actions={<>
          <Refreshed at={q.dataUpdatedAt} fetching={q.isFetching} />
          <button type="button" className="btn btn-secondary" aria-pressed={notes} onClick={() => setNotes((v) => !v)}><StickyNote className="size-4" />{t('bc.annotations.toggle')}</button>
          <button type="button" className="btn btn-secondary" aria-pressed={panel} onClick={() => setPanel((v) => !v)}><SlidersHorizontal className="size-4" />{t('bc.controls.toggle')}</button>
          <button type="button" className="btn btn-secondary" aria-pressed={auto} onClick={() => setAuto((v) => !v)}><RefreshCw className="size-4" />{auto ? t('analytics.autoRefreshOff') : t('analytics.autoRefreshOn')}</button>
          <Dropdown align="right" chevron label={t('qa.moreActions')} trigger={t('qa.moreActions')} items={[{ key: 'csv', label: t('analytics.exportCsv'), onSelect: () => { window.location.href = csv; } }, { key: 'refresh', label: t('analytics.refresh'), onSelect: () => void qc.invalidateQueries({ queryKey: ['report'] }) }]} />
        </>} />
      <div className="flex flex-col gap-4">
        <QueryBox query={query} onApply={apply} />
        <div className={cx('grid gap-4', panel && 'lg:grid-cols-[1fr_18rem]')}>
          <div className="flex min-w-0 flex-col gap-4">
            {!snapshot && <FilterBar f={f} compare={isTime} group={isTime} money />}
            {!f.valid && <Banner>{t('analytics.invalidRange')}</Banner>}
            {snapshot && <p className="text-[13px] text-muted">{t('analytics.snapshotNote')}</p>}
            {name === 'SESSIONS' && <p className="text-[13px] text-muted">{t('analytics.sessionsNote')}</p>}
            {name === 'PROFIT_BY_PRODUCT' && <p className="text-[13px] text-muted">{t('bc.report.profitNote')}</p>}
            {q.error && <Banner>{q.error.message}</Banner>}
            {parsedWhere && !parsedWhere.ok && <Banner tone="warning">{t(`bc.query.error.${parsedWhere.error}` as Key, { token: parsedWhere.token ?? '' })}</Banner>}
            {kpis.length > 0 && (
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                {kpis.map((c) => <Kpi key={c.key} label={cells.colLabel(c)} cur={rep!.totals[c.key] ?? 0} before={prev.data?.totals[c.key]} cells={cells} col={c} spark={isTime ? columnValues(rep, c.key) : undefined} />)}
              </div>
            )}
            {viz !== 'TABLE' && isTime && metricCol && (
              <Card title={cells.colLabel(metricCol)}>
                <SeriesChart name={name} rep={rep} prev={prev.data} f={f} cells={cells} loading={q.isLoading} opts={{ viz, cumulative, metric: metricKey, marks }} />
              </Card>
            )}
            {viz !== 'TABLE' && !isTime && metricCol && barRows.length > 0 && (
              <Card title={cells.colLabel(metricCol)}>
                <BarChart series={[{ label: cells.colLabel(metricCol), color: 'var(--color-primary)', points: barRows.map((r) => [String(r[0]), Number(r[rep!.columns.indexOf(metricCol)] ?? 0)] as [string, number]) }]} format={(n) => cells.cell(metricCol, Math.round(n))} label={cells.colLabel(metricCol)} />
              </Card>
            )}
            {notes && <AnnotationsPanel reportKey={name} from={f.range.from} to={f.range.to} />}
            <Card title={t(`analytics.report.${name}` as Key)} actions={<a href={csv} download className="btn btn-secondary btn-sm"><Download className="size-4" />{t('analytics.exportCsv')}</a>}>
              {q.isLoading ? <Skeleton className="h-32" /> : !rep || rows.length === 0 ? <EmptyState image={emptyAnalytics} title={t('analytics.noData')} /> : (
                <div className="overflow-x-auto">
                  <table className="w-full text-[13px]">
                    <thead><tr className="border-b border-line text-left text-muted">{columns.map((c, i) => visible(c, i) && <th key={c.key} scope="col" className={cx('px-2 py-1.5 font-medium', c.type !== 'text' && c.type !== 'date' && 'text-right')}>{cells.colLabel(c)}</th>)}</tr></thead>
                    <tbody>
                      {rows.map(({ r, i }) => {
                        const before = showCompare ? prev.data!.rows[i] : undefined;
                        return [
                          <tr key={`r${i}`} className={cx('border-b border-line last:border-0', before && 'border-b-0')}>{r.map((v, j) => visible(columns[j]!, j) && <td key={j} className={cx('px-2 py-1.5', columns[j]!.type !== 'text' && columns[j]!.type !== 'date' && 'text-right tabular-nums')}>{cells.cell(columns[j]!, v)}</td>)}</tr>,
                          before && <tr key={`c${i}`} className="border-b border-line bg-surface/60 text-xs text-muted last:border-0">{before.map((v, j) => visible(columns[j]!, j) && <td key={j} className={cx('px-2 py-1', columns[j]!.type !== 'text' && columns[j]!.type !== 'date' && 'text-right tabular-nums')}>{j === 0 ? <span>{String(v)}</span> : cells.cell(columns[j]!, v)}</td>)}</tr>,
                        ];
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          </div>
          {panel && (
            <aside aria-label={t('bc.controls.toggle')} className="flex flex-col gap-3 self-start rounded-lg bg-canvas p-4 text-[13px] shadow-card">
              <h2 className="font-semibold">{t('bc.controls.title')}</h2>
              {!snapshot && (
                <>
                  <Select label={t('analytics.range')} value={f.preset} onChange={(e) => f.patch({ preset: e.target.value, from: '', to: '' })}>{PRESETS.map((p) => <option key={p} value={p}>{t(`analytics.preset.${p}` as Key)}</option>)}<option value="CUSTOM">{t('analytics.custom')}</option></Select>
                  {f.preset === 'CUSTOM' && <div className="grid grid-cols-2 gap-2"><Input type="date" label={t('analytics.from')} value={f.range.from} onChange={(e) => f.patch({ preset: 'CUSTOM', from: e.target.value })} /><Input type="date" label={t('analytics.to')} value={f.range.to} onChange={(e) => f.patch({ preset: 'CUSTOM', to: e.target.value })} /></div>}
                </>
              )}
              {isTime && <Select label={t('analytics.compare')} value={f.compare} onChange={(e) => f.patch({ compare: e.target.value })}>{(['NONE', 'PREVIOUS_PERIOD', 'PREVIOUS_YEAR'] as const).map((c) => <option key={c} value={c}>{t(`analytics.compare.${c}` as Key)}</option>)}</Select>}
              {isTime && <Select label={t('bc.controls.dimension')} value={f.groupBy} onChange={(e) => f.patch({ group: e.target.value })}>{(['DAY', 'WEEK', 'MONTH'] as const).map((g) => <option key={g} value={g}>{t(`analytics.group.${g}` as Key)}</option>)}</Select>}
              <fieldset className="flex flex-col gap-1.5">
                <legend className="mb-1 font-medium">{t('bc.controls.metrics')}</legend>
                {metrics.map((m) => <label key={m.key} className="flex items-center gap-2"><input type="checkbox" checked={shownKeys.length === 0 || shownKeys.includes(m.key)} onChange={() => toggleMetric(m.key)} />{cells.colLabel(m)}</label>)}
              </fieldset>
              <Select label={t('bc.controls.viz')} value={viz} onChange={(e) => f.patch({ viz: e.target.value === (isTime ? 'LINE' : 'TABLE') ? '' : e.target.value })}>
                {isTime && <option value="LINE">{t('bc.viz.LINE')}</option>}<option value="BAR">{t('bc.viz.BAR')}</option><option value="TABLE">{t('bc.viz.TABLE')}</option>
              </Select>
              {viz !== 'TABLE' && metrics.length > 1 && <Select label={t('bc.controls.chartMetric')} value={metricKey ?? ''} onChange={(e) => f.patch({ metric: e.target.value === CHART_COLUMN[name] ? '' : e.target.value })}>{metrics.map((m) => <option key={m.key} value={m.key}>{cells.colLabel(m)}</option>)}</Select>}
              {isTime && viz !== 'TABLE' && <Switch checked={cumulative} onChange={(v) => f.patch({ cum: v ? '1' : '' })} label={t('bc.controls.cumulative')} />}
              <fieldset className="flex flex-col gap-2">
                <legend className="mb-1 font-medium">{t('bc.controls.filters')}</legend>
                {filters.map((fl, i) => (
                  <div key={i} className="grid grid-cols-[1fr_3.5rem_1fr_auto] items-center gap-1">
                    <select aria-label={t('bc.controls.filterField')} className="field-control" value={fl.field} onChange={(e) => setFilters(filters.map((x, k) => (k === i ? { ...x, field: e.target.value } : x)))}>{columns.map((c) => <option key={c.key} value={c.key}>{cells.colLabel(c)}</option>)}</select>
                    <select aria-label={t('bc.controls.filterOp')} className="field-control" value={fl.op} onChange={(e) => setFilters(filters.map((x, k) => (k === i ? { ...x, op: e.target.value as QueryOp } : x)))}>{OPS.map((o) => <option key={o.op} value={o.op}>{o.label}</option>)}</select>
                    <input aria-label={t('bc.controls.filterValue')} className="field-control" value={fl.value} onChange={(e) => setFilters(filters.map((x, k) => (k === i ? { ...x, value: e.target.value } : x)))} />
                    <Button variant="plain" size="sm" icon aria-label={t('common.remove')} onClick={() => setFilters(filters.filter((_, k) => k !== i))}>×</Button>
                  </div>
                ))}
                <Button size="sm" className="w-fit" disabled={!columns.length} onClick={() => setFilters([...filters, { field: columns[0]!.key, op: 'CONTAINS', value: 'a' }])}>{t('bc.controls.addFilter')}</Button>
                {filters.length > 0 && <p className="text-xs text-muted">{t('bc.controls.filterHelp')}</p>}
              </fieldset>
            </aside>
          )}
        </div>
      </div>
    </>
  );
}
