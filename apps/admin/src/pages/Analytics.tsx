import { Banner, Card, Input, Select, Skeleton, cx } from '@shopme/ui';
import { useQuery } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import { useMemo } from 'react';
import { NavLink, useParams, useSearchParams } from 'react-router';
import { gql } from '../api';
import { LineChart } from '../components/Charts';
import type { Series } from '../components/Charts';
import { PageHeader } from '../components/PageHeader';
import { SHOPME_REPORT } from '../graphql';
import { useI18n } from '../i18n';
import type { Key } from '../i18n';
import { en } from '../i18n/en';
import { CHART_COLUMN, PRESETS, REPORTS, SNAPSHOT_REPORTS, TIME_REPORTS, comparisonRange, delta, fillSeries, presetRange } from '../lib/analytics';
import type { Compare, Preset, Range, ReportName } from '../lib/analytics';
import { useShop } from '../session';

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

export function AnalyticsPage() {
  const { t } = useI18n();
  const { shop } = useShop();
  const params = useParams();
  const name = (REPORTS as readonly string[]).includes(params.name ?? '') ? (params.name as ReportName) : 'SALES_OVER_TIME';
  const [sp, setSp] = useSearchParams();
  const today = todayIn(shop.timezone);
  const preset = (sp.get('preset') ?? 'LAST_30_DAYS') as Preset | 'CUSTOM';
  const range: Range = preset === 'CUSTOM' ? { from: sp.get('from') ?? today, to: sp.get('to') ?? today } : presetRange((PRESETS as string[]).includes(preset) ? (preset as Preset) : 'LAST_30_DAYS', today);
  const compare = (sp.get('compare') ?? 'PREVIOUS_PERIOD') as Compare;
  const groupBy = (sp.get('group') ?? 'DAY') as Group;
  const isTime = TIME_REPORTS.includes(name);
  const snapshot = SNAPSHOT_REPORTS.includes(name);
  const valid = range.from <= range.to;
  const prevRange = isTime && valid ? comparisonRange(range, compare) : null;
  const q = useReport(name, valid ? range : null, groupBy);
  const prev = useReport(name, prevRange, groupBy);
  const patch = (changes: Record<string, string>) => { const next = new URLSearchParams(sp); for (const [k, v] of Object.entries(changes)) (v ? next.set(k, v) : next.delete(k)); setSp(next, { replace: true }); };
  const rep = q.data;
  const cells = useCells(rep?.currencyCode ?? shop.currency);

  const metricKey = CHART_COLUMN[name];
  const metricIdx = rep ? rep.columns.findIndex((c) => c.key === metricKey) : -1;
  const metricCol = rep?.columns[metricIdx];
  const toSeries = (r: Report | undefined, r0: Range): Array<[string, number]> => (r && metricIdx >= 0 ? fillSeries(r.rows.map((x) => [String(x[0]), Number(x[metricIdx] ?? 0)] as [string, number]), r0, groupBy) : []);
  const series: Series[] = rep && metricCol ? [{ label: t('analytics.current'), color: 'var(--color-primary)', points: toSeries(rep, range) }] : [];
  if (prev.data && prevRange && metricCol) series.push({ label: t('analytics.previous'), color: 'var(--color-text-muted)', dashed: true, points: toSeries(prev.data, prevRange) });
  const fmtMetric = (n: number) => (metricCol ? cells.cell(metricCol, Math.round(n)) : String(n));

  const kpis = rep ? rep.columns.filter((c) => (c.type === 'money' || c.type === 'int' || (c.type === 'percent' && c.key in rep.totals)) && c.key in rep.totals).slice(0, 4) : [];
  const csv = `/admin/api/reports/${name}.csv?from=${range.from}&to=${range.to}&groupBy=${groupBy}`;
  const select = 'w-auto';

  return (
    <>
      <PageHeader title={t('analytics.title')} actions={<a href={csv} download className="btn btn-secondary"><Download className="size-4" />{t('analytics.exportCsv')}</a>} />
      <div className="grid gap-4 md:grid-cols-[13rem_1fr]">
        <nav aria-label={t('analytics.reports')} className="flex gap-1 overflow-x-auto md:flex-col">
          {REPORTS.map((r) => (
            <NavLink key={r} to={{ pathname: `/analytics/${r}`, search: sp.toString() }} className={() => cx('whitespace-nowrap rounded-md px-3 py-1.5 text-[13px]', r === name ? 'bg-surface font-medium text-accent' : 'hover:bg-surface')}>{t(`analytics.report.${r}` as Key)}</NavLink>
          ))}
        </nav>
        <div className="flex min-w-0 flex-col gap-4">
          <div className="flex flex-wrap items-end gap-3">
            {!snapshot && (
              <>
                <Select className={select} label={t('analytics.range')} value={preset} onChange={(e) => patch({ preset: e.target.value, from: '', to: '' })}>
                  {PRESETS.map((p) => <option key={p} value={p}>{t(`analytics.preset.${p}` as Key)}</option>)}
                  <option value="CUSTOM">{t('analytics.custom')}</option>
                </Select>
                {preset === 'CUSTOM' && (
                  <>
                    <Input className={select} type="date" label={t('analytics.from')} value={range.from} max={range.to} onChange={(e) => patch({ preset: 'CUSTOM', from: e.target.value })} />
                    <Input className={select} type="date" label={t('analytics.to')} value={range.to} min={range.from} onChange={(e) => patch({ preset: 'CUSTOM', to: e.target.value })} />
                  </>
                )}
                {isTime && (
                  <>
                    <Select className={select} label={t('analytics.compare')} value={compare} onChange={(e) => patch({ compare: e.target.value })}>
                      {(['NONE', 'PREVIOUS_PERIOD', 'PREVIOUS_YEAR'] as const).map((c) => <option key={c} value={c}>{t(`analytics.compare.${c}` as Key)}</option>)}
                    </Select>
                    <Select className={select} label={t('analytics.groupBy')} value={groupBy} onChange={(e) => patch({ group: e.target.value })}>
                      {(['DAY', 'WEEK', 'MONTH'] as const).map((g) => <option key={g} value={g}>{t(`analytics.group.${g}` as Key)}</option>)}
                    </Select>
                  </>
                )}
              </>
            )}
          </div>
          {!valid && <Banner>{t('analytics.invalidRange')}</Banner>}
          {snapshot && <p className="text-[13px] text-muted">{t('analytics.snapshotNote')}</p>}
          {name === 'SESSIONS' && <p className="text-[13px] text-muted">{t('analytics.sessionsNote')}</p>}
          {q.error && <Banner>{q.error.message}</Banner>}
          {kpis.length > 0 && (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {kpis.map((c) => {
                const cur = rep!.totals[c.key] ?? 0;
                const before = prev.data?.totals[c.key];
                const d = before === undefined ? null : delta(cur, before);
                return (
                  <Card key={c.key} title={cells.colLabel(c)}>
                    <p className="text-xl font-semibold">{cells.cell(c, cur)}</p>
                    {before !== undefined && <p className={cx('text-xs', d === null ? 'text-muted' : d >= 0 ? 'text-success' : 'text-critical')}>{d === null ? '—' : `${d >= 0 ? '+' : ''}${d} %`} <span className="text-muted">{t('analytics.vs', { value: cells.cell(c, before) })}</span></p>}
                  </Card>
                );
              })}
            </div>
          )}
          {isTime && metricCol && (
            <Card title={cells.colLabel(metricCol)}>
              {q.isLoading ? <Skeleton className="h-48" /> : rep && rep.rows.length ? <LineChart series={series} format={fmtMetric} label={t(`analytics.report.${name}` as Key)} /> : <p className="py-8 text-center text-[13px] text-muted">{t('analytics.noData')}</p>}
            </Card>
          )}
          <Card title={t(`analytics.report.${name}` as Key)}>
            {q.isLoading ? <Skeleton className="h-32" /> : !rep || rep.rows.length === 0 ? <p className="py-6 text-center text-[13px] text-muted">{t('analytics.noData')}</p> : (
              <div className="overflow-x-auto">
                <table className="w-full text-[13px]">
                  <thead><tr className="border-b border-line text-left text-muted">{rep.columns.map((c) => <th key={c.key} scope="col" className={cx('px-2 py-1.5 font-medium', c.type !== 'text' && c.type !== 'date' && 'text-right')}>{cells.colLabel(c)}</th>)}</tr></thead>
                  <tbody>{rep.rows.map((r, i) => <tr key={i} className="border-b border-line last:border-0">{r.map((v, j) => <td key={j} className={cx('px-2 py-1.5', rep.columns[j]!.type !== 'text' && rep.columns[j]!.type !== 'date' && 'text-right tabular-nums')}>{cells.cell(rep.columns[j]!, v)}</td>)}</tr>)}</tbody>
                </table>
              </div>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
