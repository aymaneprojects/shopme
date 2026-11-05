import { Card, Skeleton } from '@shopme/ui';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';
import { useI18n } from '../i18n';
import { bubbleRadius, buildWorld, pointFor, type AtlasFeature, type WorldMap } from '../lib/world-map';

export interface LiveCountry { countryCode: string; visitors: number }

let worldPromise: Promise<WorldMap> | null = null;
/** The atlas (about 100 KB) is loaded the first time a live view opens, in its own chunk. */
function loadWorld(): Promise<WorldMap> {
  worldPromise ??= Promise.all([import('world-atlas/countries-110m.json'), import('topojson-client')]).then(([atlas, topo]) => {
    const topology = atlas.default;
    const fc = topo.feature(topology, topology.objects.countries as never) as unknown as { features: AtlasFeature[] };
    return buildWorld(fc.features);
  });
  return worldPromise;
}

const countryName = (code: string, lang: string) => { try { return new Intl.DisplayNames([lang], { type: 'region' }).of(code) ?? code; } catch { return code; } };

/**
 * Live view: a world map with a bubble per country (area = visitors of the last 5 minutes) next to the top countries list, which is also
 * the accessible reading of the map. Countries come from the browser time zone of each visitor; ShopMe stores no location beyond that.
 */
export function LiveMap({ countries, unlocated }: { countries: LiveCountry[]; unlocated: number }) {
  const { t, lang } = useI18n();
  const [world, setWorld] = useState<WorldMap | null>(null);
  const [failed, setFailed] = useState(false);
  const [hover, setHover] = useState<{ code: string; x: number; y: number } | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const at = (code: string, e: ReactMouseEvent) => { const r = box.current?.getBoundingClientRect(); setHover({ code, x: e.clientX - (r?.left ?? 0), y: e.clientY - (r?.top ?? 0) }); };
  const atElement = (code: string, el: Element) => { const r = box.current?.getBoundingClientRect(); const own = el.getBoundingClientRect(); setHover({ code, x: own.left - (r?.left ?? 0) + own.width / 2, y: own.top - (r?.top ?? 0) }); };
  useEffect(() => { let live = true; loadWorld().then((w) => { if (live) setWorld(w); }, () => { if (live) setFailed(true); }); return () => { live = false; }; }, []);
  const max = Math.max(0, ...countries.map((c) => c.visitors));
  const visited = useMemo(() => new Map(countries.map((c) => [c.countryCode, c.visitors])), [countries]);
  const nf = new Intl.NumberFormat(lang);
  const visitorsText = (n: number) => t('live.map.visitors', { n: nf.format(n), $count: n });
  const bubbles = world ? countries.flatMap((c) => { const p = pointFor(c.countryCode, world); return p ? [{ ...c, p, r: bubbleRadius(c.visitors, max) }] : []; }).sort((a, b) => b.r - a.r) : [];
  const top = countries.slice(0, 8);
  const hovered = hover ? { name: countryName(hover.code, lang), n: visited.get(hover.code) ?? 0 } : null;

  return (
    <Card title={<span className="flex items-baseline gap-2">{t('live.map.title')}<span className="text-xs font-normal text-muted">{t('live.map.window')}</span></span>}>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div ref={box} className="relative min-w-0" onMouseLeave={() => setHover(null)}>
          {!world && !failed && <div aria-label={t('live.map.loading')}><Skeleton className="aspect-[2/1] w-full" /></div>}
          {world && (
            <svg viewBox={world.viewBox} role="img" aria-label={t('live.map.aria')} className="block h-auto w-full" data-testid="live-map">
              {world.countries.map((c) => (
                <path key={`${c.code}-${c.name}`} d={c.d} fillRule="evenodd" strokeWidth={0.4} stroke="var(--color-border)"
                  fill={visited.has(c.code) ? 'color-mix(in srgb, var(--color-accent) 28%, var(--color-surface))' : 'var(--color-surface)'}
                  onMouseMove={visited.has(c.code) ? (e) => at(c.code, e) : () => setHover(null)} />
              ))}
              {bubbles.map((b) => (
                <g key={b.countryCode} tabIndex={0} role="img" aria-label={`${countryName(b.countryCode, lang)}: ${visitorsText(b.visitors)}`} className="cursor-default outline-none [&:focus-visible>circle:last-child]:stroke-[var(--color-focus-ring)]"
                  onMouseMove={(e) => { e.stopPropagation(); at(b.countryCode, e); }}
                  onFocus={(e) => atElement(b.countryCode, e.currentTarget)}
                  onBlur={() => setHover(null)}>
                  <circle cx={b.p[0]} cy={b.p[1]} r={Math.max(b.r, 12)} fill="transparent" />
                  <circle cx={b.p[0]} cy={b.p[1]} r={b.r} fill="var(--color-accent)" fillOpacity={hover?.code === b.countryCode ? 1 : 0.8} stroke="var(--color-bg)" strokeWidth={2} />
                </g>
              ))}
            </svg>
          )}
          {failed && <p className="py-10 text-center text-[13px] text-muted">{t('live.map.none')}</p>}
          {hover && hovered && (
            <div role="tooltip" className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-md bg-raised px-2.5 py-1.5 text-xs shadow-pop" style={{ left: hover.x, top: hover.y - 8 }}>
              <span className="block font-semibold tabular-nums">{visitorsText(hovered.n)}</span><span className="block text-muted">{hovered.name}</span>
            </div>
          )}
        </div>
        <div className="min-w-0">
          <h3 className="mb-2 text-[13px] font-medium">{t('live.map.topCountries')}</h3>
          {top.length === 0 ? <p className="text-[13px] text-muted">{t('live.map.none')}</p> : (
            <ul className="flex flex-col gap-2 text-[13px]" data-testid="live-countries">
              {top.map((c) => (
                <li key={c.countryCode} onMouseEnter={() => setHover(null)}>
                  <div className="flex items-baseline justify-between gap-3"><span className="truncate">{countryName(c.countryCode, lang)}</span><span className="tabular-nums text-muted">{nf.format(c.visitors)}</span></div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface" aria-hidden><div className="h-full rounded-full bg-[var(--color-accent)]" style={{ width: `${Math.max(4, (c.visitors / (max || 1)) * 100)}%` }} /></div>
                </li>
              ))}
            </ul>
          )}
          {unlocated > 0 && <p className="mt-3 flex items-baseline justify-between gap-3 border-t border-line pt-2 text-[13px] text-muted"><span>{t('live.map.unknown')}</span><span className="tabular-nums">{nf.format(unlocated)}</span></p>}
        </div>
      </div>
      <p className="mt-3 text-xs text-muted">{t('live.map.note')}</p>
    </Card>
  );
}
