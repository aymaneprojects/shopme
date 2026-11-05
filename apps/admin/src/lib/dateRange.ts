export const STAT_RANGES = ['today', 'yesterday', '7d', '30d'] as const;
export type StatRange = (typeof STAT_RANGES)[number];

const midnight = (d: Date) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };

/** Local-time `[from, to)` of a named range (today, yesterday, the last 7 or 30 days including today). */
export function rangeBounds(range: StatRange, now = new Date()): { from: Date; to: Date } {
  const today = midnight(now);
  const day = (n: number) => { const x = new Date(today); x.setDate(x.getDate() + n); return x; };
  switch (range) {
    case 'yesterday': return { from: day(-1), to: today };
    case '7d': return { from: day(-6), to: day(1) };
    case '30d': return { from: day(-29), to: day(1) };
    default: return { from: today, to: day(1) };
  }
}

/** Relative change between two figures as a fraction, or null when there is nothing to compare with. */
export const changeOf = (value: number, previous: number): number | null => (previous > 0 ? (value - previous) / previous : null);
