import { Dropdown } from '@shopme/ui';
import { useQuery } from '@tanstack/react-query';
import { Calendar } from 'lucide-react';
import { gql } from '../../api';
import { Sparkline } from '../../components/Sparkline';
import { ORDERS_STATS } from '../../graphql';
import { useI18n } from '../../i18n';
import type { Key } from '../../i18n';
import { STAT_RANGES, changeOf, rangeBounds } from '../../lib/dateRange';
import type { StatRange } from '../../lib/dateRange';

interface Metric { key: string; value: number; previous: number; series: number[] }
interface Stats { shopmeOrdersStats: { currencyCode: string; buckets: string[]; metrics: Metric[] } }

const TILES = ['orders', 'items', 'returns', 'fulfilled', 'delivered', 'fulfillmentHours'] as const;
const LABEL: Record<(typeof TILES)[number], Key> = {
  orders: 'btn.stat.orders', items: 'btn.stat.items', returns: 'btn.stat.returns', fulfilled: 'btn.stat.fulfilled', delivered: 'btn.stat.delivered', fulfillmentHours: 'btn.stat.fulfillmentTime',
};

/** Figures above the orders list for a chosen period (and location), each compared with the period before and drawn as a sparkline. */
export function OrdersStats({ range, onRange, locationId }: { range: StatRange; onRange: (r: StatRange) => void; locationId: string }) {
  const { t, lang } = useI18n();
  const { from, to } = rangeBounds(range);
  const q = useQuery({
    queryKey: ['orders-stats', range, locationId, from.getTime()], staleTime: 30_000,
    queryFn: () => gql<Stats>(ORDERS_STATS, { from: from.toISOString(), to: to.toISOString(), locationId: locationId || null }),
  });
  const s = q.data?.shopmeOrdersStats;
  const by = new Map((s?.metrics ?? []).map((m) => [m.key, m]));
  const num = new Intl.NumberFormat(lang);
  const pct = new Intl.NumberFormat(lang, { style: 'percent', maximumFractionDigits: 0, signDisplay: 'exceptZero' });
  const duration = (h: number) => (h <= 0 ? '—' : h < 1 ? t('btn.stat.minutes', { n: Math.max(1, Math.round(h * 60)) }) : h < 48 ? t('btn.stat.hours', { n: Math.round(h * 10) / 10 }) : t('btn.stat.days', { n: Math.round(h / 24) }));
  const show = (key: (typeof TILES)[number], v: number) => (key === 'fulfillmentHours' ? duration(v) : num.format(v));
  if (q.isError) return null;
  return (
    <section aria-label={t('btn.stat.title')} className="mb-3 flex items-stretch overflow-x-auto rounded-xl border border-line bg-canvas">
      <div className="flex shrink-0 items-center border-r border-line px-2">
        <Dropdown variant="plain" size="sm" chevron label={t('btn.stat.range')} trigger={<><Calendar className="size-4 text-muted" />{t(`btn.range.${range}` as Key)}</>}
          items={STAT_RANGES.map((r) => ({ key: r, label: t(`btn.range.${r}` as Key), onSelect: () => onRange(r) }))} />
      </div>
      {TILES.map((key) => {
        const m = by.get(key);
        const change = m ? changeOf(m.value, m.previous) : null;
        const good = key === 'fulfillmentHours' ? (change ?? 0) <= 0 : (change ?? 0) >= 0;
        return (
          <div key={key} data-stat={key} className="min-w-32 flex-1 border-r border-line px-4 py-2 last:border-r-0">
            <p className="w-fit border-b border-dashed border-muted text-xs font-semibold leading-5">{t(LABEL[key])}</p>
            <p className="mt-0.5 text-[15px] font-semibold tabular-nums">{m ? show(key, m.value) : '…'}</p>
            <div className="flex items-center justify-between gap-2">
              <span className={`text-xs tabular-nums ${change == null ? 'text-muted' : good ? 'text-success' : 'text-critical'}`}>{change == null ? '—' : pct.format(change)}</span>
              <Sparkline values={m?.series ?? []} className="h-5 w-14 shrink-0 text-muted" />
            </div>
          </div>
        );
      })}
    </section>
  );
}
