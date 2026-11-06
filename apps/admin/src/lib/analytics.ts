// Date ranges, comparison periods and series helpers for the Analytics page. Dates are YYYY-MM-DD (shop time zone, computed in UTC).

export const REPORTS = [
  'SALES_OVER_TIME', 'ORDERS_OVER_TIME', 'AVERAGE_ORDER_VALUE', 'SALES_BY_PRODUCT', 'SALES_BY_VARIANT', 'SALES_BY_VENDOR',
  'RETURNING_CUSTOMER_RATE', 'TOP_CUSTOMERS', 'DISCOUNT_USAGE', 'TAXES', 'INVENTORY_SNAPSHOT', 'SESSIONS',
  'SALES_BY_CHANNEL', 'SALES_BY_PAYMENT_METHOD', 'SALES_BY_COUNTRY', 'NEW_VS_RETURNING', 'PROFIT_BY_PRODUCT', 'ACQUISITION_BY_REFERRER', 'TOP_PAGES',
  'CUSTOMER_COHORTS', 'RFM_SEGMENTS', 'SELL_THROUGH', 'ABC_ANALYSIS',
] as const;
export type ReportName = (typeof REPORTS)[number];
/** Reports whose first column is a period (they get a chart and a comparison). */
export const TIME_REPORTS: readonly ReportName[] = ['SALES_OVER_TIME', 'ORDERS_OVER_TIME', 'AVERAGE_ORDER_VALUE', 'RETURNING_CUSTOMER_RATE', 'SESSIONS', 'NEW_VS_RETURNING'];
/** Reports that ignore the date range. */
export const SNAPSHOT_REPORTS: readonly ReportName[] = ['INVENTORY_SNAPSHOT', 'RFM_SEGMENTS'];
/** Column charted by default for each time report. */
export const CHART_COLUMN: Partial<Record<ReportName, string>> = {
  SALES_OVER_TIME: 'total', ORDERS_OVER_TIME: 'orders', AVERAGE_ORDER_VALUE: 'aov', RETURNING_CUSTOMER_RATE: 'rate', SESSIONS: 'sessions', NEW_VS_RETURNING: 'returning_orders',
};

export type ReportCategory = 'sales' | 'customers' | 'inventory' | 'acquisition' | 'profit';
export const REPORT_CATEGORY: Record<ReportName, ReportCategory> = {
  SALES_OVER_TIME: 'sales', ORDERS_OVER_TIME: 'sales', AVERAGE_ORDER_VALUE: 'sales', SALES_BY_PRODUCT: 'sales', SALES_BY_VARIANT: 'sales', SALES_BY_VENDOR: 'sales', DISCOUNT_USAGE: 'sales', TAXES: 'sales',
  SALES_BY_CHANNEL: 'sales', SALES_BY_PAYMENT_METHOD: 'sales', SALES_BY_COUNTRY: 'sales', RETURNING_CUSTOMER_RATE: 'customers', TOP_CUSTOMERS: 'customers', NEW_VS_RETURNING: 'customers',
  CUSTOMER_COHORTS: 'customers', RFM_SEGMENTS: 'customers', INVENTORY_SNAPSHOT: 'inventory', SELL_THROUGH: 'inventory', ABC_ANALYSIS: 'inventory', SESSIONS: 'acquisition',
  ACQUISITION_BY_REFERRER: 'acquisition', TOP_PAGES: 'acquisition', PROFIT_BY_PRODUCT: 'profit',
};

/** Index of the point a dated note belongs to: the last period that starts on or before `day` (-1 when the day is before the first period). */
export function markIndex(points: ReadonlyArray<readonly [string, number]>, day: string): number {
  let at = -1;
  for (let i = 0; i < points.length; i++) if (points[i]![0] <= day) at = i; else break;
  return at;
}

export type Compare = 'NONE' | 'PREVIOUS_PERIOD' | 'PREVIOUS_YEAR';
export interface Range { from: string; to: string }

const DAY = 86400_000;
const parse = (d: string) => Date.parse(`${d}T00:00:00Z`);
export const fmtDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);
export const addDays = (d: string, n: number) => fmtDay(parse(d) + n * DAY);
export const daysIn = (r: Range) => Math.round((parse(r.to) - parse(r.from)) / DAY) + 1;

export type Preset = 'TODAY' | 'LAST_7_DAYS' | 'LAST_30_DAYS' | 'LAST_90_DAYS' | 'THIS_MONTH' | 'LAST_MONTH' | 'THIS_YEAR';
export const PRESETS: Preset[] = ['TODAY', 'LAST_7_DAYS', 'LAST_30_DAYS', 'LAST_90_DAYS', 'THIS_MONTH', 'LAST_MONTH', 'THIS_YEAR'];

/** The range of a preset, ending today (`today` is the shop's current date). */
export function presetRange(p: Preset, today: string): Range {
  const [y, m] = [Number(today.slice(0, 4)), Number(today.slice(5, 7))];
  switch (p) {
    case 'TODAY': return { from: today, to: today };
    case 'LAST_7_DAYS': return { from: addDays(today, -6), to: today };
    case 'LAST_30_DAYS': return { from: addDays(today, -29), to: today };
    case 'LAST_90_DAYS': return { from: addDays(today, -89), to: today };
    case 'THIS_MONTH': return { from: `${y}-${String(m).padStart(2, '0')}-01`, to: today };
    case 'LAST_MONTH': { const first = Date.UTC(y, m - 2, 1); return { from: fmtDay(first), to: fmtDay(Date.UTC(y, m - 1, 1) - DAY) }; }
    case 'THIS_YEAR': return { from: `${y}-01-01`, to: today };
  }
}

/** The period to compare with: the same number of days right before, or the same dates one year earlier. */
export function comparisonRange(r: Range, mode: Compare): Range | null {
  if (mode === 'NONE') return null;
  if (mode === 'PREVIOUS_PERIOD') { const n = daysIn(r); return { from: addDays(r.from, -n), to: addDays(r.from, -1) }; }
  const shift = (d: string) => { const [y, m, day] = d.split('-').map(Number) as [number, number, number]; return fmtDay(Date.UTC(y - 1, m - 1, Math.min(day, new Date(Date.UTC(y - 1, m, 0)).getUTCDate()))); };
  return { from: shift(r.from), to: shift(r.to) };
}

/** Relative change in percent (`null` when there is nothing to compare with). */
export function delta(current: number, previous: number): number | null {
  if (!previous) return current ? null : 0;
  return Math.round(((current - previous) / Math.abs(previous)) * 1000) / 10;
}

/** Fill a series with zeros for every period start of [from, to] so a chart has no holes; `rows` are [period, value]. */
export function fillSeries(rows: Array<[string, number]>, r: Range, groupBy: 'DAY' | 'WEEK' | 'MONTH'): Array<[string, number]> {
  const map = new Map(rows);
  const out: Array<[string, number]> = [];
  const seen = new Set<string>();
  for (let d = r.from; d <= r.to; d = addDays(d, 1)) {
    const key = groupBy === 'DAY' ? d : groupBy === 'MONTH' ? `${d.slice(0, 7)}-01` : weekStart(d);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push([key, map.get(key) ?? 0]);
  }
  return out;
}
/** Monday of the week of `d` (matches PostgreSQL date_trunc('week')). */
export function weekStart(d: string): string {
  const dow = (new Date(parse(d)).getUTCDay() + 6) % 7;
  return addDays(d, -dow);
}

/** Today's date (YYYY-MM-DD) in a time zone. */
export const todayIn = (tz: string) => { try { return new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date()); } catch { return new Date().toISOString().slice(0, 10); } };
