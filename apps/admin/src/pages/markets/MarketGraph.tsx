import { Badge } from '@shopme/ui';
import { BookOpen, Globe, Store } from 'lucide-react';
import { Link } from 'react-router';
import { useI18n } from '../../i18n';
import { useShop } from '../../session';
import { countriesOf, type MarketRow } from './shared';

/** Tree view of the markets: the store at the root, the primary market under it, then every other market with its countries and catalogs. */
export function MarketGraph({ rows, onOpen }: { rows: MarketRow[]; shopName?: string; onOpen: (id: string) => void }) {
  const { t } = useI18n();
  const { shop } = useShop();
  const primary = rows.find((m) => m.primary);
  const others = rows.filter((m) => !m.primary);
  const node = (m: MarketRow) => {
    const cs = countriesOf(m);
    return (
      <li key={m.id} className="relative pl-6 before:absolute before:left-0 before:top-5 before:h-px before:w-6 before:bg-line">
        <button type="button" onClick={() => onOpen(m.id)} className="flex w-full max-w-md items-center gap-3 rounded-lg border border-line bg-canvas px-3 py-2 text-left text-[13px] shadow-card hover:bg-hover">
          <Globe className="size-4 shrink-0 text-muted" aria-hidden />
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-2 font-medium">{m.name}{m.primary && <Badge tone="info">{t('markets.primary')}</Badge>}</span>
            <span className="block truncate text-xs text-muted">{cs.length ? `${cs.slice(0, 3).map((c) => c.name).join(', ')}${cs.length > 3 ? ` ${t('markets.more', { n: cs.length - 3 })}` : ''}` : t('markets.noCountries')}</span>
          </span>
          {(m.catalogsCount?.count ?? 0) > 0 && <span className="inline-flex items-center gap-1 text-xs text-muted"><BookOpen className="size-3.5" aria-hidden />{m.catalogsCount?.count}</span>}
          <Badge tone={m.status === 'ACTIVE' ? 'success' : 'neutral'}>{t(`markets.status.${m.status}` as 'markets.status.ACTIVE')}</Badge>
        </button>
        {m.catalogs.nodes.length > 0 && (
          <ul className="ml-6 mt-1 flex flex-col gap-1 border-l border-line pl-4">
            {m.catalogs.nodes.map((c) => <li key={c.id} className="text-xs"><Link to={`/markets/catalogs/${c.id.split('/').pop()}`} className="inline-flex items-center gap-1.5 text-muted hover:text-fg"><BookOpen className="size-3" aria-hidden />{c.title}</Link></li>)}
          </ul>
        )}
      </li>
    );
  };
  return (
    <div className="p-4" role="tree" aria-label={t('bp.markets.graphView')}>
      <div className="mb-3 inline-flex items-center gap-2 rounded-lg border border-line bg-surface px-3 py-2 text-[13px] font-medium"><Store className="size-4 text-muted" aria-hidden />{shop.name}</div>
      <ul className="ml-3 flex flex-col gap-2 border-l border-line pb-1">
        {primary && node(primary)}
        {others.map(node)}
        {!rows.length && <li className="pl-6 text-[13px] text-muted">{t('markets.emptyTitle')}</li>}
      </ul>
    </div>
  );
}

/** Right-hand summary of the markets list (shown or hidden with the toggle in the header). */
export function MarketsSidePanel({ rows }: { rows: MarketRow[] }) {
  const { t } = useI18n();
  const live = rows.filter((m) => m.status === 'ACTIVE').length;
  const planned = rows.filter((m) => m.status === 'DRAFT' && m.shopmeLaunchAt).length;
  const countries = new Set(rows.filter((m) => m.status === 'ACTIVE').flatMap((m) => countriesOf(m).map((c) => c.code)));
  const catalogs = rows.reduce((n, m) => n + (m.catalogsCount?.count ?? 0), 0);
  const stat = (label: string, value: number) => <div className="flex items-center justify-between py-2 text-[13px]"><dt className="text-muted">{label}</dt><dd className="font-semibold tabular-nums">{value}</dd></div>;
  return (
    <aside aria-label={t('bp.markets.overview')} className="h-fit rounded-xl border border-line bg-canvas p-4 shadow-card">
      <h2 className="mb-1 text-sm font-semibold">{t('bp.markets.overview')}</h2>
      <dl className="divide-y divide-line">
        {stat(t('bp.markets.statLive'), live)}
        {stat(t('bp.markets.statDraft'), rows.length - live)}
        {stat(t('bp.markets.statPlanned'), planned)}
        {stat(t('bp.markets.statCountries'), countries.size)}
        {stat(t('bp.markets.statCatalogs'), catalogs)}
      </dl>
      <Link to="/markets/rollouts" className="mt-3 inline-block text-[13px] text-accent hover:underline">{t('bp.markets.planRollout')}</Link>
    </aside>
  );
}
