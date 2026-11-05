import { useQuery } from '@tanstack/react-query';
import { Calendar } from 'lucide-react';
import { gql } from '../api';
import { PRODUCT_METRICS } from '../graphql';
import { useI18n } from '../i18n';

interface Metrics { days: number; unitsSold: number; unitsInStock: number; sellThroughRate: number | null; daysOfStockLeft: number | null; unsold: number; abc: { a: number; b: number; c: number } }

/** Strip above the products list: sell-through rate, days of stock left and ABC analysis over the last 30 days. */
export function ProductMetricsStrip() {
  const { t, lang } = useI18n();
  const q = useQuery({ queryKey: ['product-metrics'], staleTime: 60_000, queryFn: () => gql<{ shopmeProductMetrics: Metrics }>(PRODUCT_METRICS, { days: 30 }) });
  const m = q.data?.shopmeProductMetrics;
  if (q.isError) return null;
  const pct = m?.sellThroughRate == null ? null : new Intl.NumberFormat(lang, { style: 'percent', maximumFractionDigits: 1 }).format(m.sellThroughRate);
  const noData = <span className="text-muted">{t('metrics.noData')}</span>;
  const cell = 'min-w-0 flex-1 px-4 py-2';
  const label = 'text-[13px] font-semibold underline decoration-dotted decoration-muted underline-offset-4';
  return (
    <section aria-label={t('metrics.title')} className="mb-3 flex flex-wrap items-stretch divide-x divide-line rounded-xl border border-line bg-canvas">
      <div className="flex items-center gap-1.5 px-4 text-[13px]"><Calendar className="size-4 text-muted" />{t('metrics.days', { n: 30 })}</div>
      <div className={cell}><p className={label} title={t('metrics.sellThroughHelp')}>{t('metrics.sellThrough')}</p><p className="text-[13px]">{m ? pct ?? noData : '…'}</p></div>
      <div className={cell}><p className={label} title={t('metrics.daysLeftHelp')}>{t('metrics.daysLeft')}</p><p className="text-[13px]">{m ? m.daysOfStockLeft == null ? noData : t('metrics.daysValue', { n: m.daysOfStockLeft }) : '…'}</p></div>
      <div className={cell}>
        <p className={label} title={t('metrics.abcHelp')}>{t('metrics.abc')}</p>
        <p className="text-[13px]">{m ? m.abc.a + m.abc.b + m.abc.c === 0 ? noData : <span>{t('metrics.abcValue', { a: m.abc.a, b: m.abc.b, c: m.abc.c })}</span> : '…'}</p>
      </div>
    </section>
  );
}
