import { Banner, Card, Dropdown, EmptyState, Input, Skeleton, cx } from '@shopme/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowUpDown, ChevronRight, Download, FileText, MoreHorizontal, RefreshCw, Search } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, Navigate, useParams, useSearchParams } from 'react-router';
import { gql } from '../api';
import { LineChart } from '../components/Charts';
import type { Series } from '../components/Charts';
import { TopBar } from '../components/OrderChrome';
import { PageHeader } from '../components/PageHeader';
import { SHOPME_REPORT } from '../graphql';
import { useI18n } from '../i18n';
import type { Key } from '../i18n';
import { en } from '../i18n/en';
import { CHART_COLUMN, PRESETS, REPORTS, SNAPSHOT_REPORTS, TIME_REPORTS, comparisonRange, delta, fillSeries, presetRange } from '../lib/analytics';
import type { Compare, Preset, Range, ReportName } from '../lib/analytics';
import { useShop } from '../session';
import emptyAnalytics from '../assets/empty/empty-analytics.webp';

type Group = 'DAY' | 'WEEK' | 'MONTH';
interface Column { key: string; label: string; type: 'text' | 'date' | 'int' | 'money' | 'percent' }
interface Report { name: string; currencyCode: string; from: string; to: string; columns: Column[]; rows: Array<Array<string | number | null>>; totals: Record<string, number> }

const todayIn = (tz: string) => { try { return new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date()); } catch { return new Date().toISOString().slice(0, 10); } };

function useReport(name: ReportName, range: Range | null, groupBy: Group) {
  return useQuery({
    queryKey: ['report', name, range?.from, range?.to, groupBy], enabled: !!range && range.from <= range.to,
    queryFn: async () => (await gql<{ shopmeReport: Report }>(SHOPME_REPORT, { name, from: range!.from, to: range!.to, groupBy })).shopmeReport,
  });
}

/** Money cells are minor units; the number of decimals comes from the currency. */
function useCells(currency: string) {
  const { lang, t } = useI18n();
  return useMemo(() => {
    const digits = new Intl.NumberFormat(lang, { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2;
    const money = (v: number) => new Intl.NumberFormat(lang, { style: 'currency', currency }).format(v / 10 ** digits);
    const num = new Intl.NumberFormat(lang);
    const cell = (c: Column, v: string | number | null) => (v === null || v === '' ? '—' : c.type === 'money' ? money(Number(v)) : c.type === 'percent' ? `${num.format(Number(v))} %` : c.type === 'int' ? num.format(Number(v)) : String(v));
    const colLabel = (c: Column) => { const k = `analytics.col.${c.key}`; return k in en ? t(k as Key) : c.label; };
    return { money, cell, colLabel, num };
  }, [lang, currency, t]);
}

const fmtRange = (r: Range) => (r.from === r.to ? r.from : `${r.from} – ${r.to}`);

/** Date range, comparison and grouping state shared by the overview and the report pages, kept in the URL. */
function useFilters() {
  const { shop } = useShop();
  const [sp, setSp] = useSearchParams();
  const today = todayIn(shop.timezone);
  const preset = (sp.get('preset') ?? 'LAST_30_DAYS') as Preset | 'CUSTOM';
  const range: Range = preset === 'CUSTOM' ? { from: sp.get('from') ?? today, to: sp.get('to') ?? today } : presetRange((PRESETS as string[]).includes(preset) ? (preset as Preset) : 'LAST_30_DAYS', today);
  const compare = (sp.get('compare') ?? 'PREVIOUS_PERIOD') as Compare;
  const groupBy = (sp.get('group') ?? 'DAY') as Group;
  const valid = range.from <= range.to;
  const patch = (changes: Record<string, string>) => { const next = new URLSearchParams(sp); for (const [k, v] of Object.entries(changes)) (v ? next.set(k, v) : next.delete(k)); setSp(next, { replace: true }); };
  return { sp, preset, range, compare, groupBy, valid, patch, prevRange: valid ? comparisonRange(range, compare) : null };
}
type Filters = ReturnType<typeof useFilters>;

/** Rounded select pill used by the filter row. */
function Pill({ label, value, onChange, children }: { label: string; value: string; onChange: (v: string) => void; children: React.ReactNode }) {
  return <select aria-label={label} title={label} value={value} onChange={(e) => onChange(e.target.value)} className="h-8 cursor-pointer rounded-full border border-line bg-canvas px-3 text-[13px] font-medium shadow-card hover:bg-hover">{children}</select>;
}

function FilterBar({ f, compare = true, group = false }: { f: Filters; compare?: boolean; group?: boolean }) {
  const { t } = useI18n();
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
    </div>
  );
}

type Cells = ReturnType<typeof useCells>;

/** Line chart of one column of a time report, with the comparison period as a dashed line and a legend below. */
function SeriesChart({ name, rep, prev, f, cells, loading }: { name: ReportName; rep: Report | undefined; prev: Report | undefined; f: Filters; cells: Cells; loading: boolean }) {
  const { t } = useI18n();
  const metricKey = CHART_COLUMN[name];
  const idx = rep ? rep.columns.findIndex((c) => c.key === metricKey) : -1;
  const col = rep?.columns[idx];
  if (loading) return <Skeleton className="h-48" />;
  if (!rep || !col || !rep.rows.length) return <p className="py-8 text-center text-[13px] text-muted">{t('analytics.noData')}</p>;
  const toSeries = (r: Report, r0: Range) => fillSeries(r.rows.map((x) => [String(x[0]), Number(x[idx] ?? 0)] as [string, number]), r0, f.groupBy);
  const series: Series[] = [{ label: fmtRange(f.range), color: 'var(--color-primary)', points: toSeries(rep, f.range) }];
  if (prev && f.prevRange) series.push({ label: fmtRange(f.prevRange), color: 'var(--color-text-muted)', dashed: true, points: toSeries(prev, f.prevRange) });
  return (
    <>
      <LineChart series={series} format={(n) => cells.cell(col, Math.round(n))} label={t(`analytics.report.${name}` as Key)} />
      <ul className="mt-2 flex flex-wrap justify-center gap-x-4 gap-y-1 text-xs text-muted">
        {series.map((s, i) => <li key={s.label} className="flex items-center gap-1.5"><span aria-hidden className={cx('inline-block h-0 w-4 border-t-2', i > 0 && 'border-dashed')} style={{ borderColor: s.color }} />{s.label}</li>)}
      </ul>
    </>
  );
}

const cardCls = 'rounded-lg bg-canvas p-4 shadow-card';

function Kpi({ to, label, cur, before, cells, col }: { to?: string; label: string; cur: number | undefined; before: number | undefined; cells: Cells; col: Column }) {
  const { t } = useI18n();
  const d = cur === undefined || before === undefined ? null : delta(cur, before);
  const body = (
    <>
      <p className="text-[13px] text-muted">{label}</p>
      <p className="mt-1 text-xl font-semibold">{cur === undefined ? '—' : cells.cell(col, cur)}</p>
      {before !== undefined && cur !== undefined && (
        <p className={cx('text-xs', d === null ? 'text-muted' : d >= 0 ? 'text-success' : 'text-critical')}>{d === null ? '—' : `${d >= 0 ? '+' : ''}${d} %`} <span className="text-muted">{t('analytics.vs', { value: cells.cell(col, before) })}</span></p>
      )}
    </>
  );
  return to ? <Link to={to} className={cx(cardCls, 'block hover:bg-hover')}>{body}</Link> : <div className={cardCls}>{body}</div>;
}

/** Analytics overview: key metrics, sales over time with its breakdown, average order value and best sellers. */
export function AnalyticsPage() {
  const { t } = useI18n();
  const { shop } = useShop();
  const f = useFilters();
  const range = f.valid ? f.range : null;
  const sales = useReport('SALES_OVER_TIME', range, f.groupBy), salesPrev = useReport('SALES_OVER_TIME', f.prevRange, f.groupBy);
  const aov = useReport('AVERAGE_ORDER_VALUE', range, f.groupBy), aovPrev = useReport('AVERAGE_ORDER_VALUE', f.prevRange, f.groupBy);
  const ret = useReport('RETURNING_CUSTOMER_RATE', range, f.groupBy), retPrev = useReport('RETURNING_CUSTOMER_RATE', f.prevRange, f.groupBy);
  const products = useReport('SALES_BY_PRODUCT', range, f.groupBy);
  const cells = useCells(sales.data?.currencyCode ?? shop.currency);
  const to = (name: ReportName) => ({ pathname: `/analytics/reports/${name}`, search: f.sp.toString() });
  const money = (key: string): Column => ({ key, label: '', type: 'money' });
  const breakdown = ['gross', 'discounts', 'refunds', 'shipping', 'taxes', 'total'] as const;
  const err = sales.error ?? aov.error ?? ret.error ?? products.error;
  const topProducts = (products.data?.rows ?? []).slice(0, 5);
  const salesCol = sales.data?.columns.find((c) => c.key === 'total');
  const csv = `/admin/api/reports/SALES_OVER_TIME.csv?from=${f.range.from}&to=${f.range.to}&groupBy=${f.groupBy}`;
  return (
    <>
      <PageHeader
        title={t('analytics.title')}
        actions={<>
          <Dropdown align="right" icon label={t('qa.moreActions')} trigger={<MoreHorizontal className="size-4" />} items={[{ key: 'csv', label: t('analytics.exportCsv'), onSelect: () => { window.location.href = csv; } }]} />
          <Link to="/analytics/reports" className="btn btn-primary">{t('analytics.viewReports')}</Link>
        </>}
      />
      <div className="flex flex-col gap-4">
        <FilterBar f={f} group />
        {!f.valid && <Banner>{t('analytics.invalidRange')}</Banner>}
        {err && <Banner>{err.message}</Banner>}
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Kpi to={`${to('SALES_OVER_TIME').pathname}?${f.sp}`} label={t('analytics.col.gross')} cur={sales.data?.totals.gross} before={salesPrev.data?.totals.gross} cells={cells} col={money('gross')} />
          <Kpi to={`${to('ORDERS_OVER_TIME').pathname}?${f.sp}`} label={t('analytics.col.orders')} cur={sales.data?.totals.orders} before={salesPrev.data?.totals.orders} cells={cells} col={{ key: 'orders', label: '', type: 'int' }} />
          <Kpi to={`${to('AVERAGE_ORDER_VALUE').pathname}?${f.sp}`} label={t('analytics.col.aov')} cur={aov.data?.totals.aov} before={aovPrev.data?.totals.aov} cells={cells} col={money('aov')} />
          <Kpi to={`${to('RETURNING_CUSTOMER_RATE').pathname}?${f.sp}`} label={t('analytics.col.rate')} cur={ret.data?.totals.rate} before={retPrev.data?.totals.rate} cells={cells} col={{ key: 'rate', label: '', type: 'percent' }} />
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
          <Card title={t('analytics.report.AVERAGE_ORDER_VALUE')}>
            <SeriesChart name="AVERAGE_ORDER_VALUE" rep={aov.data} prev={aovPrev.data} f={f} cells={cells} loading={aov.isLoading} />
          </Card>
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
      </div>
    </>
  );
}

const CATEGORY: Record<ReportName, 'sales' | 'customers' | 'inventory' | 'acquisition'> = {
  SALES_OVER_TIME: 'sales', ORDERS_OVER_TIME: 'sales', AVERAGE_ORDER_VALUE: 'sales', SALES_BY_PRODUCT: 'sales', SALES_BY_VARIANT: 'sales', SALES_BY_VENDOR: 'sales', DISCOUNT_USAGE: 'sales', TAXES: 'sales',
  RETURNING_CUSTOMER_RATE: 'customers', TOP_CUSTOMERS: 'customers', INVENTORY_SNAPSHOT: 'inventory', SESSIONS: 'acquisition',
};

/** Searchable list of every report with its category. */
export function ReportsListPage() {
  const { t } = useI18n();
  const [search, setSearch] = useState('');
  const [asc, setAsc] = useState(true);
  const rows = REPORTS.map((r) => ({ id: r, name: t(`analytics.report.${r}` as Key), category: t(`analytics.category.${CATEGORY[r]}` as Key) }))
    .filter((r) => `${r.name} ${r.category}`.toLowerCase().includes(search.trim().toLowerCase()))
    .sort((a, b) => (a.category.localeCompare(b.category) || a.name.localeCompare(b.name)) * (asc ? 1 : -1));
  return (
    <>
      <PageHeader title={t('analytics.reports')} back="/analytics" />
      <div className="overflow-hidden rounded-lg bg-canvas shadow-card">
        <div className="flex items-center gap-2 border-b border-line px-3 py-2 text-muted">
          <Search className="size-4 shrink-0" aria-hidden />
          <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('analytics.searchReports')} aria-label={t('analytics.searchReports')} className="h-7 flex-1 bg-transparent text-[13px] text-fg outline-none placeholder:text-muted" />
          <button type="button" className="btn btn-plain btn-icon btn-sm" aria-label={t('common.sort')} onClick={() => setAsc((v) => !v)}><ArrowUpDown className="size-4" /></button>
        </div>
        <table className="w-full text-[13px]">
          <thead><tr className="border-b border-line bg-surface text-left text-muted"><th scope="col" className="px-4 py-2 font-medium">{t('analytics.reportName')}</th><th scope="col" className="px-4 py-2 font-medium">{t('analytics.categoryLabel')}</th><th className="w-8" /></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-line last:border-0 hover:bg-hover">
                <td className="p-0"><Link to={`/analytics/reports/${r.id}`} className="block px-4 py-2.5 font-medium">{r.name}</Link></td>
                <td className="px-4 py-2.5 text-muted">{r.category}</td>
                <td className="pr-3 text-muted"><ChevronRight className="size-4" aria-hidden /></td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={3} className="px-4 py-8 text-center text-muted">{t('analytics.noReports')}</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}

/** Old links (`/analytics/SALES_OVER_TIME`) now point to `/analytics/reports/…`. */
export function LegacyReportRedirect() {
  const { name = '' } = useParams();
  return <Navigate to={`/analytics/reports/${name}`} replace />;
}

/** One report: filters, key totals, chart and the data table. */
export function ReportPage() {
  const { t } = useI18n();
  const { shop } = useShop();
  const params = useParams();
  const name = (REPORTS as readonly string[]).includes(params.name ?? '') ? (params.name as ReportName) : 'SALES_OVER_TIME';
  const f = useFilters();
  const qc = useQueryClient();
  const [auto, setAuto] = useState(false);
  useEffect(() => {
    if (!auto) return;
    const id = setInterval(() => void qc.invalidateQueries({ queryKey: ['report'] }), 30_000);
    return () => clearInterval(id);
  }, [auto, qc]);
  const isTime = TIME_REPORTS.includes(name);
  const snapshot = SNAPSHOT_REPORTS.includes(name);
  const q = useReport(name, f.valid ? f.range : null, f.groupBy);
  const prev = useReport(name, isTime ? f.prevRange : null, f.groupBy);
  const rep = q.data;
  const cells = useCells(rep?.currencyCode ?? shop.currency);
  const kpis = rep ? rep.columns.filter((c) => (c.type === 'money' || c.type === 'int' || (c.type === 'percent' && c.key in rep.totals)) && c.key in rep.totals).slice(0, 4) : [];
  const csv = `/admin/api/reports/${name}.csv?from=${f.range.from}&to=${f.range.to}&groupBy=${f.groupBy}`;
  const metricCol = rep?.columns.find((c) => c.key === CHART_COLUMN[name]);

  return (
    <>
      <TopBar back="/analytics/reports" icon={<FileText />} crumbs={[{ label: t('analytics.reports'), to: '/analytics/reports' }, { label: t(`analytics.report.${name}` as Key) }]}
        actions={<>
          <button type="button" className="btn btn-secondary" aria-pressed={auto} onClick={() => setAuto((v) => !v)}><RefreshCw className="size-4" />{auto ? t('analytics.autoRefreshOff') : t('analytics.autoRefreshOn')}</button>
          <Dropdown align="right" chevron label={t('qa.moreActions')} trigger={t('qa.moreActions')} items={[{ key: 'csv', label: t('analytics.exportCsv'), onSelect: () => { window.location.href = csv; } }, { key: 'refresh', label: t('analytics.refresh'), onSelect: () => void qc.invalidateQueries({ queryKey: ['report'] }) }]} />
        </>} />
      <div className="flex flex-col gap-4">
        {!snapshot && <FilterBar f={f} compare={isTime} group={isTime} />}
        {!f.valid && <Banner>{t('analytics.invalidRange')}</Banner>}
        {snapshot && <p className="text-[13px] text-muted">{t('analytics.snapshotNote')}</p>}
        {name === 'SESSIONS' && <p className="text-[13px] text-muted">{t('analytics.sessionsNote')}</p>}
        {q.error && <Banner>{q.error.message}</Banner>}
        {kpis.length > 0 && (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {kpis.map((c) => <Kpi key={c.key} label={cells.colLabel(c)} cur={rep!.totals[c.key] ?? 0} before={prev.data?.totals[c.key]} cells={cells} col={c} />)}
          </div>
        )}
        {isTime && metricCol && (
          <Card title={cells.colLabel(metricCol)}>
            <SeriesChart name={name} rep={rep} prev={prev.data} f={f} cells={cells} loading={q.isLoading} />
          </Card>
        )}
        <Card title={t(`analytics.report.${name}` as Key)} actions={<a href={csv} download className="btn btn-secondary btn-sm"><Download className="size-4" />{t('analytics.exportCsv')}</a>}>
          {q.isLoading ? <Skeleton className="h-32" /> : !rep || rep.rows.length === 0 ? <EmptyState image={emptyAnalytics} title={t('analytics.noData')} /> : (
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead><tr className="border-b border-line text-left text-muted">{rep.columns.map((c) => <th key={c.key} scope="col" className={cx('px-2 py-1.5 font-medium', c.type !== 'text' && c.type !== 'date' && 'text-right')}>{cells.colLabel(c)}</th>)}</tr></thead>
                <tbody>{rep.rows.map((r, i) => <tr key={i} className="border-b border-line last:border-0">{r.map((v, j) => <td key={j} className={cx('px-2 py-1.5', rep.columns[j]!.type !== 'text' && rep.columns[j]!.type !== 'date' && 'text-right tabular-nums')}>{cells.cell(rep.columns[j]!, v)}</td>)}</tr>)}</tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
