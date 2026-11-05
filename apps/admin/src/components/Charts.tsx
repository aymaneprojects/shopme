// Dependency-free SVG line chart with optional comparison series. Every point has a text alternative through <title>.
export interface Series { label: string; color: string; dashed?: boolean; points: Array<[string, number]> }

const W = 640, H = 200, PX = 8, PT = 8, PB = 22;

export function LineChart({ series, format, label }: { series: Series[]; format: (n: number) => string; label: string }) {
  const n = Math.max(1, ...series.map((s) => s.points.length));
  const max = Math.max(1, ...series.flatMap((s) => s.points.map((p) => p[1])));
  const x = (i: number) => PX + (n === 1 ? (W - PX * 2) / 2 : (i / (n - 1)) * (W - PX * 2));
  const y = (v: number) => PT + (1 - v / max) * (H - PT - PB);
  const ticks = [0, 0.5, 1];
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
      {main && main.points.length > 0 && (
        <>
          <text x={PX} y={H - 6} fontSize="10" fill="var(--color-text-muted)">{main.points[0]![0]}</text>
          <text x={W - PX} y={H - 6} fontSize="10" textAnchor="end" fill="var(--color-text-muted)">{main.points.at(-1)![0]}</text>
        </>
      )}
    </svg>
  );
}
