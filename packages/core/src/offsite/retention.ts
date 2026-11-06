/**
 * Retention: keep the newest backup of each of the last N days, N weeks and N months (UTC), and delete the rest.
 * "Last N days" counts days that have a backup, so a store that was quiet for a week does not lose its history.
 */
export interface Retention { keepDaily: number; keepWeekly: number; keepMonthly: number }
export const DEFAULT_RETENTION: Retention = { keepDaily: 7, keepWeekly: 4, keepMonthly: 6 };
export const clampRetention = (r: Partial<Retention>): Retention => {
  const n = (v: number | undefined, d: number, min: number) => Math.min(365, Math.max(min, Number.isFinite(v) ? Math.round(v as number) : d));
  return { keepDaily: n(r.keepDaily, DEFAULT_RETENTION.keepDaily, 1), keepWeekly: n(r.keepWeekly, DEFAULT_RETENTION.keepWeekly, 0), keepMonthly: n(r.keepMonthly, DEFAULT_RETENTION.keepMonthly, 0) };
};

const day = (d: Date) => d.toISOString().slice(0, 10);
const month = (d: Date) => d.toISOString().slice(0, 7);
/** ISO week (Monday first): `2026-W45`. */
export function isoWeek(d: Date): string {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dow = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - dow); // the Thursday decides the year
  const y = t.getUTCFullYear();
  const w = Math.ceil(((t.getTime() - Date.UTC(y, 0, 1)) / 86_400_000 + 1) / 7);
  return `${y}-W${String(w).padStart(2, '0')}`;
}

export interface Dated { key: string; at: Date }
/** Which of `items` to keep and which to delete. The newest item is always kept. */
export function applyRetention<T extends Dated>(items: T[], r: Retention): { keep: T[]; remove: T[] } {
  const sorted = [...items].sort((a, b) => b.at.getTime() - a.at.getTime() || (a.key < b.key ? 1 : -1));
  const keep = new Set<T>();
  const pick = (bucket: (d: Date) => string, count: number) => {
    const seen = new Set<string>();
    for (const it of sorted) {
      const b = bucket(it.at);
      if (seen.has(b)) continue;
      if (seen.size >= count) break;
      seen.add(b);
      keep.add(it);
    }
  };
  pick(day, r.keepDaily); pick(isoWeek, r.keepWeekly); pick(month, r.keepMonthly);
  if (sorted[0]) keep.add(sorted[0]);
  return { keep: sorted.filter((i) => keep.has(i)), remove: sorted.filter((i) => !keep.has(i)) };
}
