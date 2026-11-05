/** Tiny inline line chart for a stats tile: decorative, the figure next to it carries the meaning. */
export function Sparkline({ values, className }: { values: number[]; className?: string }) {
  const w = 96, h = 24, pad = 2;
  if (values.length < 2 || values.every((v) => v === 0)) {
    return <svg aria-hidden viewBox={`0 0 ${w} ${h}`} className={className} width={w} height={h}><line x1={pad} x2={w - pad} y1={h - pad} y2={h - pad} stroke="currentColor" strokeOpacity={0.25} strokeWidth={1.5} strokeLinecap="round" /></svg>;
  }
  const max = Math.max(...values), min = Math.min(...values, 0);
  const span = max - min || 1;
  const pts = values.map((v, i) => `${(pad + (i * (w - pad * 2)) / (values.length - 1)).toFixed(1)},${(h - pad - ((v - min) / span) * (h - pad * 2)).toFixed(1)}`);
  return <svg aria-hidden viewBox={`0 0 ${w} ${h}`} className={className} width={w} height={h}><polyline points={pts.join(' ')} fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" /></svg>;
}
