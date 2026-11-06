import { Skeleton, cx } from '@shopme/ui';
import { useQuery } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { gql } from '../../api';
import { LIVE_VIEW, SHOPME_REPORT_CURRENCY } from '../../graphql';
import { useI18n } from '../../i18n';
import type { Key } from '../../i18n';
import { PRESETS, comparisonRange, daysIn, delta, fillSeries, presetRange, todayIn } from '../../lib/analytics';
import type { Preset, Range } from '../../lib/analytics';
import { KPI_DEFS, formatKpi, groupFor, kpiRows, kpiTotal, rangeLabel } from '../../lib/home';
import type { KpiId, ReportLike } from '../../lib/home';
import { LineChart } from '../Charts';
import type { Series } from '../Charts';
import { Sparkline } from '../Sparkline';

type ReportName = (typeof KPI_DEFS)[number]['report'];

/** Same query key as the Analytics pages, so a report fetched there is reused here. */
function useReport(name: ReportName, range: Range | null, groupBy: 'DAY' | 'WEEK') {
  return useQuery({
    queryKey: ['report', name, range?.from, range?.to, groupBy, ''], enabled: !!range, staleTime: 30_000, retry: false,
    queryFn: async () => (await gql<{ shopmeReport: ReportLike }>(SHOPME_REPORT_CURRENCY, { name, from: range!.from, to: range!.to, groupBy, currency: null })).shopmeReport,
  });
}

/** Visitors of the last five minutes, refreshed while the page is open. */
export function useLiveVisitors() {
  return useQuery({ queryKey: ['live-view'], refetchInterval: 15_000, retry: false, queryFn: async () => (await gql<{ shopmeLiveView: { visitorsNow: number } }>(LIVE_VIEW)).shopmeLiveView });
}

const pill = 'h-8 whitespace-nowrap rounded-full border border-line bg-canvas px-3 text-[13px] font-medium';

/**
 * Top strip of Home: period and channel, four figures with a small trend, and the live visitor count. A figure opens a chart card
 * (this period against the previous one) right below the strip; clicking it again, the close button or Esc closes the card.
 */
export function KpiBar({ currency, timezone }: { currency: string; timezone: string }) {
  const { t, lang } = useI18n();
  const [preset, setPreset] = useState<Preset>('LAST_30_DAYS');
  const [open, setOpen] = useState<KpiId | null>(null);
  const range = useMemo(() => presetRange(preset, todayIn(timezone)), [preset, timezone]);
  const prev = useMemo(() => comparisonRange(range, 'PREVIOUS_PERIOD'), [range]);
  const groupBy = groupFor(daysIn(range));
  const reports = {
    SESSIONS: [useReport('SESSIONS', range, groupBy), useReport('SESSIONS', prev, groupBy)],
    SALES_OVER_TIME: [useReport('SALES_OVER_TIME', range, groupBy), useReport('SALES_OVER_TIME', prev, groupBy)],
    ORDERS_OVER_TIME: [useReport('ORDERS_OVER_TIME', range, groupBy), useReport('ORDERS_OVER_TIME', prev, groupBy)],
  } as const;
  const live = useLiveVisitors();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(null); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  const cur = (def: (typeof KPI_DEFS)[number]) => reports[def.report][0];
  const money = (def: (typeof KPI_DEFS)[number]) => cur(def).data?.currencyCode || currency;
  const fmt = (def: (typeof KPI_DEFS)[number], v: number | undefined) => formatKpi(def.type, v, money(def), lang);
  const series = (def: (typeof KPI_DEFS)[number], which: 0 | 1, r: Range | null) => {
    const q = reports[def.report][which];
    return r && q.data ? fillSeries(kpiRows(q.data, def.column), r, groupBy) : [];
  };
  const openDef = KPI_DEFS.find((d) => d.id === open);
  const name = (id: KpiId) => t(`hm.kpi.${id}` as Key);

  return (
    <section aria-label={t('hm.kpi.bar')} className="mb-6">
      <div className="flex flex-col gap-3 rounded-2xl bg-canvas px-3 py-3 shadow-card ring-1 ring-line lg:flex-row lg:items-center lg:gap-4 lg:px-4">
        <div className="flex flex-wrap items-center gap-2 lg:w-[330px] lg:shrink-0 lg:flex-nowrap">
          <select aria-label={t('hm.kpi.period')} value={preset} onChange={(e) => { setPreset(e.target.value as Preset); }} className={cx(pill, 'cursor-pointer hover:bg-hover')}>
            {PRESETS.map((p) => <option key={p} value={p}>{t(`analytics.preset.${p}` as Key)}</option>)}
          </select>
          <span className={cx(pill, 'inline-flex items-center text-muted')} title={t('hm.kpi.channels')}>{t('hm.kpi.allChannels')}</span>
        </div>
        <div className="grid min-w-0 flex-1 grid-cols-2 gap-1 sm:grid-cols-4">
          {KPI_DEFS.map((def) => {
            const q = cur(def);
            const value = kpiTotal(q.data, def.column);
            const spark = series(def, 0, range).map((p) => p[1]);
            const active = open === def.id;
            return (
              <button key={def.id} type="button" aria-expanded={active} aria-controls="home-kpi-chart" aria-label={t('hm.kpi.chart', { name: name(def.id) })} data-kpi={def.id}
                onClick={() => setOpen(active ? null : def.id)}
                className={cx('flex min-w-0 flex-col items-start gap-0.5 rounded-xl px-3 py-2 text-left transition-colors hover:bg-hover focus-visible:outline-2', active && 'bg-surface ring-1 ring-line')}>
                <span className="max-w-full text-[12px] leading-tight text-muted">{name(def.id)}</span>
                <span className="flex items-center gap-2 text-[15px] font-semibold tabular-nums">
                  {q.isLoading ? <Skeleton className="h-5 w-14" /> : <span data-testid={`kpi-${def.id}`}>{fmt(def, value)}</span>}
                  <Sparkline values={spark} className="h-5 w-14 shrink-0 text-accent" />
                </span>
              </button>
            );
          })}
        </div>
        <Link to="/analytics/live" aria-label={t('hm.live.aria', { n: live.data?.visitorsNow ?? 0 })} className="inline-flex items-center justify-between gap-2 self-stretch rounded-xl px-3 py-2 text-[13px] hover:bg-hover lg:w-[190px] lg:shrink-0 lg:justify-end lg:self-auto">
          <span className="text-muted">{t('hm.live')}</span>
          <span className="font-semibold tabular-nums">{live.data?.visitorsNow ?? '—'}</span>
          <span className="relative flex size-2.5" aria-hidden>
            <span className="absolute inline-flex size-full rounded-full bg-success opacity-60 motion-safe:animate-ping" />
            <span className="relative inline-flex size-2.5 rounded-full bg-success" />
          </span>
        </Link>
      </div>

      {openDef && (
        <div id="home-kpi-chart" role="region" aria-label={t(`hm.kpi.${openDef.id}.title` as Key)} className="relative mt-3 rounded-2xl bg-canvas p-4 shadow-card ring-1 ring-line sm:p-5">
          <button type="button" aria-label={t('hm.kpi.closeChart')} onClick={() => setOpen(null)} className="absolute right-3 top-3 grid size-8 place-items-center rounded-full text-muted hover:bg-hover"><X className="size-4" aria-hidden /></button>
          <KpiChart def={openDef} range={range} prev={prev} main={series(openDef, 0, range)} before={prev ? series(openDef, 1, prev) : null} loading={cur(openDef).isLoading}
            value={fmt(openDef, kpiTotal(cur(openDef).data, openDef.column))} change={delta(kpiTotal(cur(openDef).data, openDef.column) ?? 0, kpiTotal(reports[openDef.report][1].data, openDef.column) ?? 0)} format={(n) => fmt(openDef, n)} />
        </div>
      )}
    </section>
  );
}

function KpiChart({ def, range, prev, main, before, loading, value, change, format }: {
  def: (typeof KPI_DEFS)[number]; range: Range; prev: Range | null; main: Array<[string, number]>; before: Array<[string, number]> | null; loading: boolean; value: string; change: number | null; format: (n: number) => string;
}) {
  const { t, lang } = useI18n();
  const series: Series[] = [{ label: rangeLabel(range, lang), color: 'var(--color-accent)', points: main }];
  if (before && prev) series.push({ label: rangeLabel(prev, lang), color: 'var(--color-text-muted)', dashed: true, points: before });
  const empty = !loading && main.every((p) => p[1] === 0) && (before ?? []).every((p) => p[1] === 0);
  return (
    <>
      <p className="pr-10 text-3xl font-semibold tabular-nums">{loading ? <Skeleton className="h-9 w-32" /> : value}
        {change !== null && !loading && <span className={cx('ml-3 align-middle text-[13px] font-medium', change >= 0 ? 'text-success' : 'text-critical')}>{`${change > 0 ? '+' : ''}${new Intl.NumberFormat(lang, { maximumFractionDigits: 1 }).format(change)} %`}</span>}
      </p>
      <h2 className="mt-1 text-[13px] font-semibold">{t(`hm.kpi.${def.id}.title` as Key)}</h2>
      <p className="text-[13px] text-muted">{t(`hm.kpi.${def.id}.desc` as Key)}</p>
      <div className="mt-3">
        {loading ? <Skeleton className="h-48" /> : empty ? <p className="py-8 text-center text-[13px] text-muted">{t('hm.kpi.noData')}</p> : <LineChart series={series} format={format} label={t(`hm.kpi.${def.id}.title` as Key)} />}
      </div>
      <ul className="mt-2 flex flex-wrap justify-center gap-x-5 gap-y-1 text-xs text-muted" data-testid="kpi-legend">
        {series.map((s, i) => <li key={s.label} className="flex items-center gap-1.5"><span aria-hidden className={cx('inline-block h-0 w-4 border-t-2', i > 0 && 'border-dashed')} style={{ borderColor: s.color }} />{s.label}</li>)}
      </ul>
    </>
  );
}
