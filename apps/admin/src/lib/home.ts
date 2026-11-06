// Logic of the Home page that does not need React: greeting by time of day, setup task detection and ordering, guide dismissal.

export type TaskId = 'launch' | 'payments' | 'domain' | 'email' | 'product' | 'theme' | 'shipping' | 'backup';
/** Display order of the guide; finished tasks move behind the pending ones and keep this order. */
export const TASK_IDS: readonly TaskId[] = ['launch', 'payments', 'domain', 'email', 'product', 'theme', 'shipping', 'backup'];

/** What the page knows about the store. `undefined` means "not loaded (or failed)", which never counts as done. */
export interface TaskSignals {
  passwordProtected?: boolean;
  payments?: { bankTransfer: boolean; cod: boolean; stripe: boolean; stripeConfigured: boolean };
  customDomain?: boolean;
  emailDone?: boolean;
  productCount?: number;
  theme?: { createdAt: string; updatedAt: string } | null;
  shippingMethods?: number;
  offsite?: { configured: boolean; enabled: boolean };
}

/** The live theme counts as customized once it was saved noticeably after it was installed. */
export const THEME_GRACE_MS = 60_000;
export function themeCustomized(theme: TaskSignals['theme']): boolean {
  if (!theme) return false;
  const created = Date.parse(theme.createdAt), updated = Date.parse(theme.updatedAt);
  return Number.isFinite(created) && Number.isFinite(updated) && updated - created > THEME_GRACE_MS;
}

export function detectTasks(s: TaskSignals): Record<TaskId, boolean> {
  const p = s.payments;
  return {
    launch: s.passwordProtected === false,
    payments: !!p && (p.bankTransfer || p.cod || (p.stripe && p.stripeConfigured)),
    domain: s.customDomain === true,
    email: s.emailDone === true,
    product: (s.productCount ?? 0) > 0,
    theme: themeCustomized(s.theme),
    shipping: (s.shippingMethods ?? 0) > 0,
    backup: !!s.offsite && s.offsite.configured && s.offsite.enabled,
  };
}

/** Pending tasks first, then the finished ones, each group in the guide's own order. */
export function orderTasks(done: Record<TaskId, boolean>): TaskId[] {
  return [...TASK_IDS.filter((id) => !done[id]), ...TASK_IDS.filter((id) => done[id])];
}
export const countDone = (done: Record<TaskId, boolean>) => TASK_IDS.filter((id) => done[id]).length;

/** Hour (0-23) of an instant in a time zone; falls back to the browser's zone when the name is not valid. */
export function hourIn(at: Date, timeZone: string): number {
  try {
    const h = Number(new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', hour12: false }).formatToParts(at).find((x) => x.type === 'hour')?.value);
    return h === 24 ? 0 : h;
  } catch { return at.getHours(); }
}
export type DayPart = 'morning' | 'afternoon' | 'evening';
/** Morning from 05:00, afternoon from 12:00, evening from 18:00 until the small hours. */
export const dayPart = (hour: number): DayPart => (hour >= 5 && hour < 12 ? 'morning' : hour >= 12 && hour < 18 ? 'afternoon' : 'evening');
export const greetingPart = (at: Date, timeZone: string): DayPart => dayPart(hourIn(at, timeZone));

const guideKey = (shopId: number | string) => `shopme.home.guide.hidden.${shopId}`;
export function readGuideHidden(shopId: number | string): boolean {
  try { return localStorage.getItem(guideKey(shopId)) === '1'; } catch { return false; }
}
export function writeGuideHidden(shopId: number | string, hidden: boolean): void {
  try { if (hidden) localStorage.setItem(guideKey(shopId), '1'); else localStorage.removeItem(guideKey(shopId)); } catch { /* storage unavailable: the choice lasts for this visit only */ }
}

// ---- key figures ---------------------------------------------------------------------------------------------------------------------

export type KpiId = 'sessions' | 'sales' | 'orders' | 'conversion';
export type KpiType = 'int' | 'money' | 'percent';
/** Each figure reads one column of an existing analytics report. */
export const KPI_DEFS: ReadonlyArray<{ id: KpiId; report: 'SESSIONS' | 'SALES_OVER_TIME' | 'ORDERS_OVER_TIME'; column: string; type: KpiType }> = [
  { id: 'sessions', report: 'SESSIONS', column: 'sessions', type: 'int' },
  { id: 'sales', report: 'SALES_OVER_TIME', column: 'total', type: 'money' },
  { id: 'orders', report: 'ORDERS_OVER_TIME', column: 'orders', type: 'int' },
  { id: 'conversion', report: 'SESSIONS', column: 'conversion', type: 'percent' },
];

export interface ReportLike { currencyCode?: string; columns: Array<{ key: string }>; rows: Array<Array<string | number | null>>; totals: Record<string, number> }

/** Weekly points once the period gets long, so a chart never holds more than about 60 points. */
export const groupFor = (days: number): 'DAY' | 'WEEK' => (days > 62 ? 'WEEK' : 'DAY');

/** Value of a figure for the whole period. */
export const kpiTotal = (rep: ReportLike | undefined, column: string): number | undefined => (rep ? rep.totals[column] ?? 0 : undefined);

/** [period, value] rows of one column, in report order. */
export function kpiRows(rep: ReportLike | undefined, column: string): Array<[string, number]> {
  const i = rep ? rep.columns.findIndex((c) => c.key === column) : -1;
  return i < 0 ? [] : rep!.rows.map((r) => [String(r[0]), Number(r[i] ?? 0)] as [string, number]);
}

export function formatKpi(type: KpiType, value: number | undefined, currency: string, lang: string): string {
  if (value === undefined || !Number.isFinite(value)) return '—';
  try {
    if (type === 'money') {
      const f = new Intl.NumberFormat(lang, { style: 'currency', currency });
      return f.format(value / 10 ** (f.resolvedOptions().maximumFractionDigits ?? 2));
    }
    if (type === 'percent') return `${new Intl.NumberFormat(lang, { maximumFractionDigits: 1 }).format(value)} %`;
    return new Intl.NumberFormat(lang).format(value);
  } catch { return String(value); }
}

/** "7 Oct 2026 – 5 Nov 2026" style label of an inclusive date range (YYYY-MM-DD). */
export function rangeLabel(r: { from: string; to: string }, lang: string): string {
  const f = (d: string) => new Intl.DateTimeFormat(lang, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${d}T00:00:00Z`));
  return r.from === r.to ? f(r.from) : `${f(r.from)} – ${f(r.to)}`;
}
