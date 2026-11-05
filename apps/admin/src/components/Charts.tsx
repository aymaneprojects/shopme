import { markIndex } from '../lib/analytics';

// Dependency-free SVG line and bar charts with optional comparison series. Every point has a text alternative through <title>.
export interface Series { label: string; color: string; dashed?: boolean; points: Array<[string, number]> }
/** A dated note drawn on a chart. */
export interface Mark { day: string; text: string }

const W = 640, H = 200, PX = 8, PT = 8, PB = 22;

/** Gridlines at 0, half and the maximum; the middle one is dropped when its label would repeat a neighbour (small whole-number axes). */
const gridTicks = (max: number, format: (n: number) => string) => [0, 0.5, 1].filter((t) => t !== 0.5 || (format(max * 0.5) !== format(0) && format(max * 0.5) !== format(max)));

export function LineChart({ series, format, label, marks = [] }: { series: Series[]; format: (n: number) => string; label: string; marks?: Mark[] }) {
  const n = Math.max(1, ...series.map((s) => s.points.length));
  const max = Math.max(1, ...series.flatMap((s) => s.points.map((p) => p[1])));
  const x = (i: number) => PX + (n === 1 ? (W - PX * 2) / 2 : (i / (n - 1)) * (W - PX * 2));
  const y = (v: number) => PT + (1 - v / max) * (H - PT - PB);
  const ticks = gridTicks(max, format);
  const main = series[0];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label} className="w-full">
      {ticks.map((t) => (
        <g key={t}>
          <line x1={PX} x2={W - PX} y1={y(max * t)} y2={y(max * t)} stroke="var(--color-border)" strokeDasharray={t ? '3 3' : undefined} />
          <text x={PX + 2} y={y(max * t) - 3} fontSize="10" fill="var(--color-text-muted)">{format(max * t)}</text>
        </g>
      ))}
      {main && main.points.length > 1 && (
        <polygon points={`${x(0)},${y(0)} ${main.points.map((p, i) => `${x(i)},${y(p[1])}`).join(' ')} ${x(main.points.length - 1)},${y(0)}`} fill={main.color} opacity="0.08" />
      )}
      {[...series].reverse().map((s) => (
        <g key={s.label}>
          <polyline fill="none" stroke={s.color} strokeWidth="2" strokeLinejoin="round" strokeDasharray={s.dashed ? '5 4' : undefined} points={s.points.map((p, i) => `${x(i)},${y(p[1])}`).join(' ')} />
          {s.points.map((p, i) => (
            <circle key={i} cx={x(i)} cy={y(p[1])} r={n > 45 ? 1.5 : 3} fill={s.color}><title>{`${s.label} · ${p[0]}: ${format(p[1])}`}</title></circle>
          ))}
        </g>
      ))}
      {main && marks.map((m, i) => { const at = markIndex(main.points, m.day); return at < 0 ? null : (
        <g key={i}><line x1={x(at)} x2={x(at)} y1={PT} y2={H - PB} stroke="var(--color-primary)" strokeDasharray="2 3" opacity="0.7" /><rect x={x(at) - 3.5} y={PT - 2} width="7" height="7" transform={`rotate(45 ${x(at)} ${PT + 1.5})`} fill="var(--color-primary)"><title>{`${m.day}: ${m.text}`}</title></rect></g>
      ); })}
      {main && main.points.length > 0 && (
        <>
          <text x={PX} y={H - 6} fontSize="10" fill="var(--color-text-muted)">{main.points[0]![0]}</text>
          <text x={W - PX} y={H - 6} fontSize="10" textAnchor="end" fill="var(--color-text-muted)">{main.points.at(-1)![0]}</text>
        </>
      )}
    </svg>
  );
}

/** Grouped bars: one bar per period, with the comparison period beside it in a lighter tone. */
export function BarChart({ series, format, label, marks = [] }: { series: Series[]; format: (n: number) => string; label: string; marks?: Mark[] }) {
  const n = Math.max(1, ...series.map((s) => s.points.length));
  const max = Math.max(1, ...series.flatMap((s) => s.points.map((p) => p[1])));
  const slot = (W - PX * 2) / n;
  const bar = Math.max(1, Math.min(28, (slot * 0.8) / Math.max(1, series.length)));
  const y = (v: number) => PT + (1 - v / max) * (H - PT - PB);
  const main = series[0];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label} className="w-full">
      {gridTicks(max, format).map((t) => (
        <g key={t}>
          <line x1={PX} x2={W - PX} y1={y(max * t)} y2={y(max * t)} stroke="var(--color-border)" strokeDasharray={t ? '3 3' : undefined} />
          <text x={PX + 2} y={y(max * t) - 3} fontSize="10" fill="var(--color-text-muted)">{format(max * t)}</text>
        </g>
      ))}
      {series.map((s, si) => s.points.map((p, i) => (
        <rect key={`${si}-${i}`} x={PX + i * slot + (slot - bar * series.length) / 2 + si * bar} y={y(p[1])} width={bar} height={Math.max(0, y(0) - y(p[1]))} rx="1.5" fill={s.color} opacity={si === 0 ? 0.9 : 0.4}><title>{`${s.label} · ${p[0]}: ${format(p[1])}`}</title></rect>
      )))}
      {main && marks.map((m, i) => { const at = markIndex(main.points, m.day); return at < 0 ? null : (
        <g key={i}><line x1={PX + at * slot + slot / 2} x2={PX + at * slot + slot / 2} y1={PT} y2={H - PB} stroke="var(--color-text)" strokeDasharray="2 3" opacity="0.6" /><circle cx={PX + at * slot + slot / 2} cy={PT + 2} r="3.5" fill="var(--color-text)"><title>{`${m.day}: ${m.text}`}</title></circle></g>
      ); })}
      {main && main.points.length > 0 && (
        <>
          <text x={PX} y={H - 6} fontSize="10" fill="var(--color-text-muted)">{main.points[0]![0]}</text>
          <text x={W - PX} y={H - 6} fontSize="10" textAnchor="end" fill="var(--color-text-muted)">{main.points.at(-1)![0]}</text>
        </>
      )}
    </svg>
  );
}

/** Tiny line without axes, for the figure tiles. `values` oldest first. */
export function Sparkline({ values, label }: { values: number[]; label: string }) {
  if (values.length < 2) return null;
  const w = 96, h = 28, max = Math.max(...values), min = Math.min(...values), span = max - min || 1;
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * (w - 2) + 1},${h - 3 - ((v - min) / span) * (h - 6)}`).join(' ');
  return <svg viewBox={`0 0 ${w} ${h}`} role="img" aria-label={label} className="mt-2 h-7 w-24"><polyline fill="none" stroke="var(--color-primary)" strokeWidth="1.75" strokeLinejoin="round" strokeLinecap="round" points={pts} /></svg>;
}
