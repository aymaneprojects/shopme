import { Banner, Card, Skeleton } from '@shopme/ui';
import { useQuery } from '@tanstack/react-query';
import { Activity, Search } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { gql } from '../api';
import { BarChart } from '../components/Charts';
import { DottedGlobe } from '../components/home/Globe';
import type { GlobeMarker } from '../components/home/Globe';
import { PageHeader } from '../components/PageHeader';
import { LIVE_VIEW } from '../graphql';
import { useI18n } from '../i18n';
import { loadWorld } from '../lib/world-load';
import { pointFor, unproject } from '../lib/world-map';
import type { WorldMap } from '../lib/world-map';
import { useCells } from './Analytics';

interface Live {
  at: string; currencyCode: string; visitorsNow: number; sessionsToday: number; ordersToday: number; salesToday: number; activeCarts: number; checkoutsNow: number;
  viewsPerMinute: Array<{ minute: string; views: number }>; topPages: Array<{ path: string; views: number }>; topSources: Array<{ source: string; sessions: number }>;
  recentOrders: Array<{ id: string; name: string; total: number; createdAt: string; country: string | null }>;
  countries: Array<{ countryCode: string; visitors: number }>; visitorsUnlocated: number;
}

const countryName = (code: string, lang: string) => { try { return new Intl.DisplayNames([lang], { type: 'region' }).of(code) ?? code; } catch { return code; } };
const ORDER_COLOR = '#8b5cf6';

/** Where visitors are in the buying path: carts, checkout, purchase, as three steps of a funnel. */
function Funnel({ steps }: { steps: [number, number, number] }) {
  const max = Math.max(1, ...steps);
  const h = (n: number) => 8 + (n / max) * 72;
  return (
    <svg viewBox="0 0 300 90" className="mt-3 h-24 w-full" aria-hidden focusable="false">
      {steps.map((n, i) => {
        const x = i * 100, hh = h(n), next = steps[i + 1] === undefined ? hh : h(steps[i + 1]!);
        return <path key={i} d={`M${x} ${85 - hh}L${x + 100} ${85 - next}L${x + 100} 85L${x} 85Z`} fill="var(--color-accent)" fillOpacity={0.25 + i * 0.25} />;
      })}
    </svg>
  );
}

/** What is happening right now: visitors, sales, the buying path and where visitors are, refreshed every 10 seconds from the first-party visit log. */
export function LiveViewPage() {
  const { t, lang } = useI18n();
  const q = useQuery({ queryKey: ['live-view'], refetchInterval: 10_000, queryFn: async () => (await gql<{ shopmeLiveView: Live }>(LIVE_VIEW)).shopmeLiveView });
  const d = q.data;
  const cells = useCells(d?.currencyCode ?? 'EUR');
  const nf = new Intl.NumberFormat(lang);
  const [world, setWorld] = useState<WorldMap | null>(null);
  const [search, setSearch] = useState('');
  useEffect(() => { let live = true; loadWorld().then((w) => { if (live) setWorld(w); }, () => undefined); return () => { live = false; }; }, []);
  const markers = useMemo<GlobeMarker[]>(() => {
    if (!world || !d) return [];
    const at = (code: string) => { const p = pointFor(code, world); if (!p) return null; const [lon, lat] = unproject(p[0], p[1]); return { lat, lon }; };
    return [
      ...d.countries.flatMap((c) => { const p = at(c.countryCode); return p ? [{ ...p, n: c.visitors }] : []; }),
      ...d.recentOrders.flatMap((o) => { const p = o.country ? at(o.country) : null; return p ? [{ ...p, n: 1, color: ORDER_COLOR }] : []; }),
    ];
  }, [world, d]);
  const tile = (label: string, value: string) => <div className="rounded-xl bg-canvas p-3 shadow-card"><p className="text-[13px] font-medium">{label}</p><p className="mt-1 text-[13px] tabular-nums">{value}</p></div>;
  const maxVisitors = Math.max(1, ...(d?.countries ?? []).map((c) => c.visitors));
  const places = (d?.countries ?? []).filter((c) => countryName(c.countryCode, lang).toLowerCase().includes(search.trim().toLowerCase()));
  return (
    <>
      <PageHeader back="/analytics" icon={<Activity className="size-4" />} title={t('bc.analytics.live')} badges={<span className="inline-flex items-center gap-1.5 text-xs text-muted"><span aria-hidden className="size-2 rounded-full bg-accent" />{t('lv.now')}</span>} />
      {q.error && <Banner>{q.error.message}</Banner>}
      {!d ? <Skeleton className="h-64" /> : (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
          <div className="flex flex-col gap-3">
            <div className="grid grid-cols-2 gap-3">
              {tile(t('bc.live.visitors'), nf.format(d.visitorsNow))}
              {tile(t('lv.totalSales'), cells.money(d.salesToday))}
              {tile(t('lv.visits'), nf.format(d.sessionsToday))}
              {tile(t('analytics.col.orders'), nf.format(d.ordersToday))}
            </div>
            <Card title={t('lv.behavior')}>
              <div className="grid grid-cols-3 gap-2 text-[13px]">
                {([[t('bc.live.carts'), d.activeCarts], [t('lv.atCheckout'), d.checkoutsNow], [t('lv.purchased'), d.ordersToday]] as const).map(([label, n]) => <div key={label}><p className="text-xs text-muted">{label}</p><p className="tabular-nums">{nf.format(n)}</p></div>)}
              </div>
              <Funnel steps={[d.activeCarts, d.checkoutsNow, d.ordersToday]} />
            </Card>
            <Card title={t('lv.byLocation')}>
              {places.length === 0 ? <p className="text-[13px] text-muted">{t('live.map.none')}</p> : (
                <ul className="flex flex-col gap-2 text-[13px]" data-testid="live-countries">
                  {places.map((c) => (
                    <li key={c.countryCode}>
                      <div className="flex items-baseline justify-between gap-3"><span className="truncate">{countryName(c.countryCode, lang)}</span><span className="tabular-nums text-muted">{nf.format(c.visitors)}</span></div>
                      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface" aria-hidden><div className="h-full rounded-full bg-accent" style={{ width: `${Math.max(4, (c.visitors / maxVisitors) * 100)}%` }} /></div>
                    </li>
                  ))}
                </ul>
              )}
              {d.visitorsUnlocated > 0 && <p className="mt-3 flex items-baseline justify-between gap-3 border-t border-line pt-2 text-[13px] text-muted"><span>{t('live.map.unknown')}</span><span className="tabular-nums">{nf.format(d.visitorsUnlocated)}</span></p>}
              <p className="mt-3 text-xs text-muted">{t('live.map.note')}</p>
            </Card>
            <Card title={t('bc.live.perMinute')}>
              <BarChart series={[{ label: t('bc.live.views'), color: 'var(--color-primary)', points: d.viewsPerMinute.map((m) => [new Intl.DateTimeFormat(lang, { timeStyle: 'short' }).format(new Date(m.minute)), m.views] as [string, number]) }]} format={(n) => nf.format(n)} label={t('bc.live.perMinute')} />
            </Card>
            <Card title={t('bc.live.topPages')}>
              {d.topPages.length === 0 ? <p className="text-[13px] text-muted">{t('bc.live.quiet')}</p> : <ul className="divide-y divide-line text-[13px]">{d.topPages.map((p) => <li key={p.path} className="flex items-center justify-between gap-3 py-1.5"><span className="min-w-0 truncate">{p.path}</span><span className="tabular-nums text-muted">{nf.format(p.views)}</span></li>)}</ul>}
            </Card>
            <Card title={t('bc.live.topSources')}>
              {d.topSources.length === 0 ? <p className="text-[13px] text-muted">{t('bc.live.quiet')}</p> : <ul className="divide-y divide-line text-[13px]">{d.topSources.map((s) => <li key={s.source} className="flex items-center justify-between gap-3 py-1.5"><span className="min-w-0 truncate">{s.source === 'direct' ? t('bc.live.direct') : s.source}</span><span className="tabular-nums text-muted">{nf.format(s.sessions)}</span></li>)}</ul>}
            </Card>
            <Card title={t('bc.live.recentOrders')}>
              {d.recentOrders.length === 0 ? <p className="text-[13px] text-muted">{t('bc.live.noOrders')}</p> : <ul className="divide-y divide-line text-[13px]">{d.recentOrders.map((o) => <li key={o.id} className="flex items-center justify-between gap-3 py-1.5"><span>{o.name}</span><span className="tabular-nums text-muted">{cells.money(o.total)}</span></li>)}</ul>}
            </Card>
          </div>
          <div className="relative min-h-[28rem] overflow-hidden rounded-xl bg-canvas shadow-card lg:sticky lg:top-4 lg:h-[calc(100vh-7rem)]">
            <label className="absolute right-3 top-3 z-10 flex h-8 w-64 max-w-[70%] items-center gap-2 rounded-lg border border-line bg-canvas px-2.5 text-[13px]">
              <Search className="size-4 shrink-0 text-muted" aria-hidden />
              <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('lv.search')} aria-label={t('lv.search')} className="min-w-0 flex-1 bg-transparent outline-none" />
            </label>
            <DottedGlobe markers={markers} className="absolute left-1/2 top-1/2 aspect-square w-[min(100%,52rem)] -translate-x-1/2 -translate-y-1/2 text-accent opacity-70" />
            <ul className="absolute bottom-3 right-3 flex flex-wrap items-center gap-4 text-xs text-muted">
              <li className="flex items-center gap-1.5"><span aria-hidden className="size-2 rounded-full" style={{ background: ORDER_COLOR }} />{t('analytics.col.orders')}</li>
              <li className="flex items-center gap-1.5"><span aria-hidden className="size-2 rounded-full bg-accent" />{t('bc.live.visitors')}</li>
            </ul>
          </div>
        </div>
      )}
    </>
  );
}
