import { and, asc, desc, eq, sql, type SQL } from 'drizzle-orm';
import { analyticsAnnotations, analyticsExplorations, analyticsGoals, analyticsReportStates, currencySettings, staffUsers } from '../../db/schema';
import type { Db, Executor } from '../../db/client';
import { errR, okR, type Result } from '../catalog/common';
import { getShop } from '../shops';
import { REPORT_NAMES, isDay, shopmeReport, type Cell, type ColumnType, type GroupBy, type ReportColumn } from './reports';

const rowsOf = (r: unknown) => ((r as { rows?: unknown[] }).rows ?? (r as unknown[])) as Array<Record<string, string | number | null>>;
const n = (v: unknown) => Number(v ?? 0);

/* ------------------------------ pinned and last viewed reports ------------------------------ */

export type ReportState = typeof analyticsReportStates.$inferSelect;
const EXPLORATION_KEY = /^EXPLORATION:(\d+)$/;

async function validKey(db: Executor, shopId: number, key: string): Promise<boolean> {
  if ((REPORT_NAMES as readonly string[]).includes(key)) return true;
  const m = EXPLORATION_KEY.exec(key);
  return !!m && !!(await getExploration(db, shopId, Number(m[1])));
}

export const listReportStates = (db: Executor, shopId: number, staffId: number): Promise<ReportState[]> =>
  db.select().from(analyticsReportStates).where(and(eq(analyticsReportStates.shopId, shopId), eq(analyticsReportStates.staffUserId, staffId)));

export async function setReportPinned(db: Db, shopId: number, staffId: number, key: string, pinned: boolean): Promise<Result<ReportState>> {
  if (!(await validKey(db, shopId, key))) return errR(['key'], 'Report does not exist', 'DOES_NOT_EXIST');
  const [row] = await db.insert(analyticsReportStates).values({ shopId, staffUserId: staffId, reportKey: key, pinned })
    .onConflictDoUpdate({ target: [analyticsReportStates.shopId, analyticsReportStates.staffUserId, analyticsReportStates.reportKey], set: { pinned } }).returning();
  return okR(row!);
}

/** Remember that this staff member opened the report now. */
export async function touchReport(db: Db, shopId: number, staffId: number, key: string): Promise<Result<ReportState>> {
  if (!(await validKey(db, shopId, key))) return errR(['key'], 'Report does not exist', 'DOES_NOT_EXIST');
  const now = new Date();
  const [row] = await db.insert(analyticsReportStates).values({ shopId, staffUserId: staffId, reportKey: key, lastViewedAt: now })
    .onConflictDoUpdate({ target: [analyticsReportStates.shopId, analyticsReportStates.staffUserId, analyticsReportStates.reportKey], set: { lastViewedAt: now } }).returning();
  return okR(row!);
}

/* ------------------------------ goals ------------------------------ */

export const GOAL_METRICS = ['TOTAL_SALES', 'ORDERS', 'AVERAGE_ORDER_VALUE', 'SESSIONS'] as const;
export const GOAL_PERIODS = ['WEEK', 'MONTH', 'QUARTER', 'YEAR'] as const;
export type GoalMetric = (typeof GOAL_METRICS)[number];
export type GoalPeriod = (typeof GOAL_PERIODS)[number];
export type Goal = typeof analyticsGoals.$inferSelect;

const DAY = 86400_000;
const fmtDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const pd = (d: string) => Date.parse(`${d}T00:00:00Z`);

/** The calendar period (week starts Monday) that contains `today` (YYYY-MM-DD). */
export function goalPeriodRange(period: GoalPeriod, today: string): { from: string; to: string } {
  const t = new Date(`${today}T00:00:00Z`);
  const y = t.getUTCFullYear(), m = t.getUTCMonth();
  if (period === 'WEEK') { const dow = (t.getUTCDay() + 6) % 7; const from = pd(today) - dow * DAY; return { from: fmtDay(from), to: fmtDay(from + 6 * DAY) }; }
  if (period === 'MONTH') return { from: fmtDay(Date.UTC(y, m, 1)), to: fmtDay(Date.UTC(y, m + 1, 1) - DAY) };
  if (period === 'QUARTER') { const q = Math.floor(m / 3) * 3; return { from: fmtDay(Date.UTC(y, q, 1)), to: fmtDay(Date.UTC(y, q + 3, 1) - DAY) }; }
  return { from: fmtDay(Date.UTC(y, 0, 1)), to: fmtDay(Date.UTC(y + 1, 0, 1) - DAY) };
}

export const listGoals = (db: Executor, shopId: number): Promise<Goal[]> => db.select().from(analyticsGoals).where(eq(analyticsGoals.shopId, shopId)).orderBy(asc(analyticsGoals.id));

export async function setGoal(db: Db, shopId: number, input: { metric: string; period: string; target: number }, staffId?: number | null): Promise<Result<Goal>> {
  if (!(GOAL_METRICS as readonly string[]).includes(input.metric)) return errR(['metric'], 'Metric is not valid', 'INVALID');
  if (!(GOAL_PERIODS as readonly string[]).includes(input.period)) return errR(['period'], 'Period is not valid', 'INVALID');
  if (!Number.isFinite(input.target) || input.target <= 0) return errR(['target'], 'Target must be greater than zero', 'INVALID');
  const target = Math.round(input.target);
  const [row] = await db.insert(analyticsGoals).values({ shopId, metric: input.metric, period: input.period, target, createdByStaffId: staffId ?? null })
    .onConflictDoUpdate({ target: [analyticsGoals.shopId, analyticsGoals.metric, analyticsGoals.period], set: { target, updatedAt: new Date() } }).returning();
  return okR(row!);
}

export async function deleteGoal(db: Db, shopId: number, id: number): Promise<Result<number>> {
  const del = await db.delete(analyticsGoals).where(and(eq(analyticsGoals.shopId, shopId), eq(analyticsGoals.id, id))).returning({ id: analyticsGoals.id });
  return del.length ? okR(id) : errR(['id'], 'Goal does not exist', 'DOES_NOT_EXIST');
}

export interface GoalProgress { goal: Goal; from: string; to: string; actual: number; /** 0..1 share of the period that has passed */ elapsed: number }

/** Each goal with the figure reached so far in its current period. */
export async function goalProgress(db: Executor, shopId: number, today: string): Promise<GoalProgress[]> {
  const goals = await listGoals(db, shopId);
  const out: GoalProgress[] = [];
  for (const goal of goals) {
    const { from, to } = goalPeriodRange(goal.period as GoalPeriod, today);
    const end = today < to ? today : to;
    let actual = 0;
    if (goal.metric === 'SESSIONS') actual = (await shopmeReport(db, shopId, 'SESSIONS', from, end))?.rows.reduce((s, r) => s + n(r[1]), 0) ?? 0;
    else {
      const rep = await shopmeReport(db, shopId, goal.metric === 'AVERAGE_ORDER_VALUE' ? 'AVERAGE_ORDER_VALUE' : 'SALES_OVER_TIME', from, end, 'MONTH');
      actual = !rep ? 0 : goal.metric === 'TOTAL_SALES' ? rep.totals.total ?? 0 : goal.metric === 'ORDERS' ? rep.totals.orders ?? 0 : rep.totals.aov ?? 0;
    }
    const total = (pd(to) - pd(from)) / DAY + 1, passed = (pd(end) - pd(from)) / DAY + 1;
    out.push({ goal, from, to, actual, elapsed: Math.min(1, passed / total) });
  }
  return out;
}

/* ------------------------------ annotations ------------------------------ */

export type Annotation = typeof analyticsAnnotations.$inferSelect;

export const listAnnotations = (db: Executor, shopId: number, o: { reportKey?: string | null; from?: string; to?: string } = {}): Promise<Annotation[]> =>
  db.select().from(analyticsAnnotations).where(and(
    eq(analyticsAnnotations.shopId, shopId),
    o.reportKey ? sql`(${analyticsAnnotations.reportKey} is null or ${analyticsAnnotations.reportKey} = ${o.reportKey})` : undefined,
    o.from ? sql`${analyticsAnnotations.day} >= ${o.from}` : undefined, o.to ? sql`${analyticsAnnotations.day} <= ${o.to}` : undefined,
  )).orderBy(asc(analyticsAnnotations.day), asc(analyticsAnnotations.id));

export async function createAnnotation(db: Db, shopId: number, input: { day: string; text: string; reportKey?: string | null }, staffId?: number | null): Promise<Result<Annotation>> {
  const text = input.text.trim();
  if (!isDay(input.day)) return errR(['day'], 'Date must be YYYY-MM-DD', 'INVALID');
  if (!text) return errR(['text'], "Text can't be blank", 'BLANK');
  if (text.length > 280) return errR(['text'], 'Text is too long (maximum is 280 characters)', 'TOO_LONG');
  if (input.reportKey && !(await validKey(db, shopId, input.reportKey))) return errR(['reportKey'], 'Report does not exist', 'DOES_NOT_EXIST');
  const [row] = await db.insert(analyticsAnnotations).values({ shopId, day: input.day, text, reportKey: input.reportKey ?? null, createdByStaffId: staffId ?? null }).returning();
  return okR(row!);
}

export async function deleteAnnotation(db: Db, shopId: number, id: number): Promise<Result<number>> {
  const del = await db.delete(analyticsAnnotations).where(and(eq(analyticsAnnotations.shopId, shopId), eq(analyticsAnnotations.id, id))).returning({ id: analyticsAnnotations.id });
  return del.length ? okR(id) : errR(['id'], 'Annotation does not exist', 'DOES_NOT_EXIST');
}

/* ------------------------------ explorations (custom reports) ------------------------------ */

export const EXPLORATION_DATASETS = ['ORDERS', 'PRODUCTS', 'CUSTOMERS', 'SESSIONS'] as const;
export type ExplorationDataset = (typeof EXPLORATION_DATASETS)[number];
export const FILTER_OPS = ['EQ', 'NEQ', 'CONTAINS', 'GT', 'LT'] as const;
export type FilterOp = (typeof FILTER_OPS)[number];
export const VISUALIZATIONS = ['TABLE', 'LINE', 'BAR'] as const;

export interface ExplorationDefinition {
  dataset: ExplorationDataset;
  metrics: string[];
  /** A dimension key of the dataset, or null for one total row. */
  dimension: string | null;
  filters: Array<{ field: string; op: FilterOp; value: string }>;
  /** A relative range stored with the report; the UI turns it into dates. */
  period: string;
  compare: 'NONE' | 'PREVIOUS_PERIOD' | 'PREVIOUS_YEAR';
  visualization: (typeof VISUALIZATIONS)[number];
  /** Metric key to sort by (descending) when the dimension is not a date; defaults to the first metric. */
  sort?: string | null;
  limit?: number;
}

interface MetricSpec { label: string; type: ColumnType; sql: SQL }
interface FieldSpec { label: string; expr: SQL; type?: 'text' | 'number' }
interface DatasetSpec {
  from: SQL; where: SQL; dateColumn: SQL;
  metrics: Record<string, MetricSpec>;
  /** Dimensions; the `date` ones are bucketed by the granularity they name. */
  dimensions: Record<string, FieldSpec & { date?: GroupBy }>;
  filters: Record<string, FieldSpec>;
}

function datasetSpec(name: ExplorationDataset, shopId: number, tz: string): DatasetSpec {
  const bucket = (col: SQL, unit: string) => sql`to_char(date_trunc(${sql.raw(`'${unit}'`)}, ${col} at time zone ${tz}), 'YYYY-MM-DD')`;
  if (name === 'ORDERS') {
    const d = sql.raw('o.processed_at');
    return {
      from: sql`orders o left join order_addresses sa on sa.order_id = o.id and sa.kind = 'shipping'`,
      where: sql`o.shop_id = ${shopId} and o.cancelled_at is null and o.test = false`, dateColumn: d,
      metrics: {
        orders: { label: 'Orders', type: 'int', sql: sql`count(*)` },
        gross_sales: { label: 'Gross sales', type: 'money', sql: sql`coalesce(sum(o.subtotal + o.total_discounts), 0)` },
        discounts: { label: 'Discounts', type: 'money', sql: sql`coalesce(sum(o.total_discounts), 0)` },
        refunds: { label: 'Refunds', type: 'money', sql: sql`coalesce(sum(o.total_refunded), 0)` },
        shipping: { label: 'Shipping', type: 'money', sql: sql`coalesce(sum(o.total_shipping), 0)` },
        taxes: { label: 'Taxes', type: 'money', sql: sql`coalesce(sum(o.total_tax), 0)` },
        total_sales: { label: 'Total sales', type: 'money', sql: sql`coalesce(sum(o.total - o.total_refunded), 0)` },
        aov: { label: 'Average order value', type: 'money', sql: sql`coalesce(round(avg(o.total - o.total_refunded)), 0)` },
        customers: { label: 'Customers', type: 'int', sql: sql`count(distinct o.customer_id)` },
        units: { label: 'Units sold', type: 'int', sql: sql`coalesce(sum((select sum(l.current_quantity) from order_lines l where l.order_id = o.id)), 0)` },
      },
      dimensions: {
        day: { label: 'Day', expr: bucket(d, 'day'), date: 'DAY' }, week: { label: 'Week', expr: bucket(d, 'week'), date: 'WEEK' }, month: { label: 'Month', expr: bucket(d, 'month'), date: 'MONTH' },
        channel: { label: 'Sales channel', expr: sql`coalesce(nullif(o.source_name, ''), 'web')` }, financial_status: { label: 'Payment status', expr: sql`o.financial_status` },
        fulfillment_status: { label: 'Fulfillment status', expr: sql`o.fulfillment_status` }, country: { label: 'Shipping country', expr: sql`coalesce(nullif(sa.country_code, ''), '-')` },
        currency: { label: 'Currency', expr: sql`o.presentment_currency` }, weekday: { label: 'Day of week', expr: sql`to_char(o.processed_at at time zone ${tz}, 'ID') || ' ' || to_char(o.processed_at at time zone ${tz}, 'Dy')` },
        hour: { label: 'Hour of day', expr: sql`to_char(o.processed_at at time zone ${tz}, 'HH24')` },
        customer_type: { label: 'Customer type', expr: sql`case when o.customer_id is null then 'guest' when exists (select 1 from orders p where p.customer_id = o.customer_id and p.shop_id = o.shop_id and p.cancelled_at is null and p.processed_at < o.processed_at) then 'returning' else 'new' end` },
      },
      filters: {
        channel: { label: 'Sales channel', expr: sql`coalesce(nullif(o.source_name, ''), 'web')` }, financial_status: { label: 'Payment status', expr: sql`o.financial_status` },
        fulfillment_status: { label: 'Fulfillment status', expr: sql`o.fulfillment_status` }, country: { label: 'Shipping country', expr: sql`coalesce(sa.country_code, '')` },
        currency: { label: 'Currency', expr: sql`o.presentment_currency` }, tag: { label: 'Order tag', expr: sql`array_to_string(o.tags, ',')` },
        total: { label: 'Order total (minor units)', expr: sql`(o.total - o.total_refunded)`, type: 'number' },
      },
    };
  }
  if (name === 'PRODUCTS') {
    const d = sql.raw('o.processed_at');
    return {
      from: sql`order_lines l join orders o on o.id = l.order_id`, where: sql`o.shop_id = ${shopId} and o.cancelled_at is null and o.test = false and l.is_gift_card = false`, dateColumn: d,
      metrics: {
        units: { label: 'Units sold', type: 'int', sql: sql`coalesce(sum(l.current_quantity), 0)` },
        sales: { label: 'Sales', type: 'money', sql: sql`coalesce(sum(l.discounted_total), 0)` },
        orders: { label: 'Orders', type: 'int', sql: sql`count(distinct l.order_id)` },
        avg_price: { label: 'Average unit price', type: 'money', sql: sql`coalesce(round(avg(l.unit_price)), 0)` },
      },
      dimensions: {
        day: { label: 'Day', expr: bucket(d, 'day'), date: 'DAY' }, week: { label: 'Week', expr: bucket(d, 'week'), date: 'WEEK' }, month: { label: 'Month', expr: bucket(d, 'month'), date: 'MONTH' },
        product: { label: 'Product', expr: sql`l.title` }, variant: { label: 'Variant', expr: sql`l.title || coalesce(' / ' || l.variant_title, '')` }, vendor: { label: 'Vendor', expr: sql`coalesce(nullif(l.vendor, ''), '-')` },
        sku: { label: 'SKU', expr: sql`coalesce(nullif(l.sku, ''), '-')` },
      },
      filters: { product: { label: 'Product', expr: sql`l.title` }, vendor: { label: 'Vendor', expr: sql`coalesce(l.vendor, '')` }, sku: { label: 'SKU', expr: sql`coalesce(l.sku, '')` }, quantity: { label: 'Quantity', expr: sql`l.current_quantity`, type: 'number' } },
    };
  }
  if (name === 'CUSTOMERS') {
    const d = sql.raw('o.processed_at');
    return {
      from: sql`orders o join customers c on c.id = o.customer_id`, where: sql`o.shop_id = ${shopId} and o.cancelled_at is null and o.test = false`, dateColumn: d,
      metrics: {
        customers: { label: 'Customers', type: 'int', sql: sql`count(distinct c.id)` }, orders: { label: 'Orders', type: 'int', sql: sql`count(*)` },
        spent: { label: 'Total spent', type: 'money', sql: sql`coalesce(sum(o.total - o.total_refunded), 0)` }, avg_order: { label: 'Average order value', type: 'money', sql: sql`coalesce(round(avg(o.total - o.total_refunded)), 0)` },
      },
      dimensions: {
        day: { label: 'Day', expr: bucket(d, 'day'), date: 'DAY' }, week: { label: 'Week', expr: bucket(d, 'week'), date: 'WEEK' }, month: { label: 'Month', expr: bucket(d, 'month'), date: 'MONTH' },
        customer: { label: 'Customer', expr: sql`coalesce(nullif(trim(coalesce(c.first_name, '') || ' ' || coalesce(c.last_name, '')), ''), c.email, '-')` },
        subscription: { label: 'Email subscription', expr: sql`c.email_marketing_state` }, language: { label: 'Language', expr: sql`c.locale` },
      },
      filters: { customer: { label: 'Customer', expr: sql`coalesce(c.first_name, '') || ' ' || coalesce(c.last_name, '') || ' ' || coalesce(c.email, '')` }, tag: { label: 'Customer tag', expr: sql`array_to_string(c.tags, ',')` }, subscription: { label: 'Email subscription', expr: sql`c.email_marketing_state` }, language: { label: 'Language', expr: sql`c.locale` } },
    };
  }
  const d = sql.raw('v.created_at');
  const source = sql`coalesce(nullif(regexp_replace(regexp_replace(coalesce(v.referrer, ''), '^https?://(www\\.)?', ''), '[/?#].*$', ''), ''), 'direct')`;
  return {
    from: sql`visits v`, where: sql`v.shop_id = ${shopId}`, dateColumn: d,
    metrics: { sessions: { label: 'Sessions', type: 'int', sql: sql`count(distinct v.session_id)` }, views: { label: 'Page views', type: 'int', sql: sql`count(*)` } },
    dimensions: {
      day: { label: 'Day', expr: bucket(d, 'day'), date: 'DAY' }, week: { label: 'Week', expr: bucket(d, 'week'), date: 'WEEK' }, month: { label: 'Month', expr: bucket(d, 'month'), date: 'MONTH' },
      source: { label: 'Traffic source', expr: source }, page: { label: 'Page', expr: sql`v.path` }, hour: { label: 'Hour of day', expr: sql`to_char(v.created_at at time zone ${tz}, 'HH24')` },
    },
    filters: { source: { label: 'Traffic source', expr: source }, page: { label: 'Page', expr: sql`v.path` } },
  };
}

/** The fields of each dataset, for the builder UI. */
export function explorationCatalog(): Record<ExplorationDataset, { metrics: Array<{ key: string; label: string; type: ColumnType }>; dimensions: Array<{ key: string; label: string; date: boolean }>; filters: Array<{ key: string; label: string; numeric: boolean }> }> {
  const out = {} as ReturnType<typeof explorationCatalog>;
  for (const ds of EXPLORATION_DATASETS) {
    const s = datasetSpec(ds, 0, 'UTC');
    out[ds] = {
      metrics: Object.entries(s.metrics).map(([key, m]) => ({ key, label: m.label, type: m.type })),
      dimensions: Object.entries(s.dimensions).map(([key, d]) => ({ key, label: d.label, date: !!d.date })),
      filters: Object.entries(s.filters).map(([key, f]) => ({ key, label: f.label, numeric: f.type === 'number' })),
    };
  }
  return out;
}

export function validateDefinition(def: unknown): Result<ExplorationDefinition> {
  const d = def as Partial<ExplorationDefinition> | null;
  if (!d || typeof d !== 'object') return errR(['definition'], 'Definition is not valid', 'INVALID');
  if (!(EXPLORATION_DATASETS as readonly string[]).includes(d.dataset as string)) return errR(['definition', 'dataset'], 'Dataset is not valid', 'INVALID');
  const spec = datasetSpec(d.dataset!, 0, 'UTC');
  const metrics = Array.isArray(d.metrics) ? d.metrics : [];
  if (!metrics.length) return errR(['definition', 'metrics'], 'Choose at least one metric', 'INVALID');
  if (metrics.length > 8) return errR(['definition', 'metrics'], 'Choose at most 8 metrics', 'INVALID');
  for (const m of metrics) if (!(m in spec.metrics)) return errR(['definition', 'metrics'], `Metric "${m}" is not available in this dataset`, 'INVALID');
  if (d.dimension && !(d.dimension in spec.dimensions)) return errR(['definition', 'dimension'], `Dimension "${d.dimension}" is not available in this dataset`, 'INVALID');
  const filters = Array.isArray(d.filters) ? d.filters : [];
  if (filters.length > 10) return errR(['definition', 'filters'], 'At most 10 filters', 'INVALID');
  for (const f of filters) {
    if (!f || !(f.field in spec.filters)) return errR(['definition', 'filters'], `Filter field "${f?.field}" is not available in this dataset`, 'INVALID');
    if (!(FILTER_OPS as readonly string[]).includes(f.op)) return errR(['definition', 'filters'], 'Filter operator is not valid', 'INVALID');
    if (spec.filters[f.field]!.type === 'number' && !Number.isFinite(Number(f.value))) return errR(['definition', 'filters'], `Filter "${f.field}" needs a number`, 'INVALID');
  }
  if (d.sort && !(d.sort in spec.metrics)) return errR(['definition', 'sort'], 'Sort metric is not valid', 'INVALID');
  return okR({
    dataset: d.dataset!, metrics: [...new Set(metrics)], dimension: d.dimension ?? null, filters: filters.map((f) => ({ field: f.field, op: f.op, value: String(f.value ?? '').slice(0, 200) })),
    period: typeof d.period === 'string' && d.period ? d.period.slice(0, 40) : 'LAST_30_DAYS', compare: d.compare === 'PREVIOUS_PERIOD' || d.compare === 'PREVIOUS_YEAR' ? d.compare : 'NONE',
    visualization: (VISUALIZATIONS as readonly string[]).includes(d.visualization as string) ? d.visualization! : 'TABLE', sort: d.sort ?? null, limit: Math.min(Math.max(Number(d.limit) || 100, 1), 500),
  });
}

export interface ExplorationResult { currency: string; from: string; to: string; columns: ReportColumn[]; rows: Cell[][]; totals: Record<string, number> }

/** Run a definition over the closed day range [from, to] (shop time zone). Metric and dimension names come from a fixed list, values are bound parameters. */
export async function runExploration(db: Executor, shopId: number, definition: unknown, from: string, to: string): Promise<Result<ExplorationResult>> {
  const v = validateDefinition(definition);
  if (!v.ok) return v;
  if (!isDay(from) || !isDay(to) || from > to) return errR(['from'], 'from and to must be YYYY-MM-DD dates with from <= to', 'INVALID');
  const def = v.value;
  const shop = await getShop(db, shopId);
  if (!shop) throw new Error('Shop not found');
  const tz = shop.timezone;
  const spec = datasetSpec(def.dataset, shopId, tz);
  const fromTs = sql`(${from}::date::timestamp at time zone ${tz})`, toTs = sql`((${to}::date + 1)::timestamp at time zone ${tz})`;
  const conds: SQL[] = [spec.where, sql`${spec.dateColumn} >= ${fromTs}`, sql`${spec.dateColumn} < ${toTs}`];
  for (const f of def.filters) {
    const e = spec.filters[f.field]!;
    const num = e.type === 'number';
    const val = f.value;
    const like = `%${val.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    conds.push(f.op === 'CONTAINS' ? sql`${e.expr} ilike ${like}` : num ? (f.op === 'GT' ? sql`${e.expr} > ${Number(val)}` : f.op === 'LT' ? sql`${e.expr} < ${Number(val)}` : f.op === 'NEQ' ? sql`${e.expr} <> ${Number(val)}` : sql`${e.expr} = ${Number(val)}`)
      : f.op === 'GT' ? sql`${e.expr} > ${val}` : f.op === 'LT' ? sql`${e.expr} < ${val}` : f.op === 'NEQ' ? sql`${e.expr} is distinct from ${val}` : sql`lower(${e.expr}) = ${val.toLowerCase()}`);
  }
  const dim = def.dimension ? spec.dimensions[def.dimension]! : null;
  const select = [dim ? sql`${dim.expr} as dim` : sql`'total' as dim`, ...def.metrics.map((m) => sql`${spec.metrics[m]!.sql}::text as ${sql.raw(`m_${m}`)}`)];
  const sortKey = def.sort ?? def.metrics[0]!;
  const order = dim?.date ? sql`1 asc` : dim ? sql`${spec.metrics[sortKey]!.sql} desc, 1 asc` : sql`1`;
  const rows = rowsOf(await db.execute(sql`select ${sql.join(select, sql`, `)} from ${spec.from} where ${sql.join(conds, sql` and `)} ${dim ? sql`group by 1` : sql``} order by ${order} limit ${def.limit ?? 100}`));
  const columns: ReportColumn[] = [{ key: 'dim', label: dim?.label ?? 'Total', type: dim?.date ? 'date' : 'text' }, ...def.metrics.map((m) => ({ key: m, label: spec.metrics[m]!.label, type: spec.metrics[m]!.type }))];
  const table = rows.map((r): Cell[] => [String(r.dim), ...def.metrics.map((m) => n(r[`m_${m}`]))]);
  const totals: Record<string, number> = {};
  columns.forEach((c, i) => { if (i > 0 && (c.type === 'int' || c.type === 'money') && !/^(aov|avg|average|customers)/.test(c.key) && !/avg_/.test(c.key)) totals[c.key] = table.reduce((s, r) => s + n(r[i]), 0); });
  return okR({ currency: shop.currency, from, to, columns, rows: table, totals });
}

export type Exploration = typeof analyticsExplorations.$inferSelect & { createdByName: string | null };

const withAuthor = async (db: Executor, rows: Array<typeof analyticsExplorations.$inferSelect>): Promise<Exploration[]> => {
  const ids = [...new Set(rows.map((r) => r.createdByStaffId).filter((x): x is number => x != null))];
  const names = new Map<number, string>();
  for (const id of ids) {
    const [u] = await db.select({ first: staffUsers.firstName, last: staffUsers.lastName, email: staffUsers.email }).from(staffUsers).where(eq(staffUsers.id, id));
    if (u) names.set(id, [u.first, u.last].filter(Boolean).join(' ') || u.email);
  }
  return rows.map((r) => ({ ...r, createdByName: r.createdByStaffId ? names.get(r.createdByStaffId) ?? null : null }));
};

export async function listExplorations(db: Executor, shopId: number): Promise<Exploration[]> {
  return withAuthor(db, await db.select().from(analyticsExplorations).where(eq(analyticsExplorations.shopId, shopId)).orderBy(desc(analyticsExplorations.updatedAt)));
}
export async function getExploration(db: Executor, shopId: number, id: number): Promise<Exploration | null> {
  const [r] = await db.select().from(analyticsExplorations).where(and(eq(analyticsExplorations.shopId, shopId), eq(analyticsExplorations.id, id)));
  return r ? (await withAuthor(db, [r]))[0]! : null;
}

export async function saveExploration(db: Db, shopId: number, input: { id?: number | null; name: string; definition: unknown }, staffId?: number | null): Promise<Result<Exploration>> {
  const name = input.name.trim();
  if (!name) return errR(['name'], "Name can't be blank", 'BLANK');
  if (name.length > 120) return errR(['name'], 'Name is too long (maximum is 120 characters)', 'TOO_LONG');
  const v = validateDefinition(input.definition);
  if (!v.ok) return v;
  if (input.id) {
    const [r] = await db.update(analyticsExplorations).set({ name, definition: v.value as unknown as Record<string, unknown>, updatedAt: new Date() }).where(and(eq(analyticsExplorations.shopId, shopId), eq(analyticsExplorations.id, input.id))).returning();
    return r ? okR((await withAuthor(db, [r]))[0]!) : errR(['id'], 'Exploration does not exist', 'DOES_NOT_EXIST');
  }
  const [r] = await db.insert(analyticsExplorations).values({ shopId, name, definition: v.value as unknown as Record<string, unknown>, createdByStaffId: staffId ?? null }).returning();
  return okR((await withAuthor(db, [r!]))[0]!);
}

export async function deleteExploration(db: Db, shopId: number, id: number): Promise<Result<number>> {
  const del = await db.delete(analyticsExplorations).where(and(eq(analyticsExplorations.shopId, shopId), eq(analyticsExplorations.id, id))).returning({ id: analyticsExplorations.id });
  if (!del.length) return errR(['id'], 'Exploration does not exist', 'DOES_NOT_EXIST');
  await db.delete(analyticsReportStates).where(and(eq(analyticsReportStates.shopId, shopId), eq(analyticsReportStates.reportKey, `EXPLORATION:${id}`)));
  await db.delete(analyticsAnnotations).where(and(eq(analyticsAnnotations.shopId, shopId), eq(analyticsAnnotations.reportKey, `EXPLORATION:${id}`)));
  return okR(id);
}

/* ------------------------------ live view ------------------------------ */

export interface LiveView {
  at: string; currency: string; visitorsNow: number; sessionsToday: number; ordersToday: number; salesToday: number; activeCarts: number;
  /** Page views per minute for the last 30 minutes, oldest first. */
  viewsPerMinute: Array<{ minute: string; views: number }>;
  topPages: Array<{ path: string; views: number }>; topSources: Array<{ source: string; sessions: number }>;
  recentOrders: Array<{ id: number; name: string; total: number; createdAt: string; country: string | null }>;
}

/** What is happening on the store right now, from the first-party visit log and the orders table. */
export async function liveView(db: Executor, shopId: number, now = new Date()): Promise<LiveView> {
  const shop = await getShop(db, shopId);
  if (!shop) throw new Error('Shop not found');
  const tz = shop.timezone;
  const t = now.toISOString();
  const q = async (query: SQL) => rowsOf(await db.execute(query));
  const [visitors] = await q(sql`select count(distinct session_id)::int as n from visits where shop_id = ${shopId} and created_at >= ${t}::timestamptz - interval '5 minutes' and created_at <= ${t}::timestamptz`);
  const dayStart = sql`(date_trunc('day', ${t}::timestamptz at time zone ${tz}) at time zone ${tz})`;
  const [today] = await q(sql`select count(distinct session_id)::int as n from visits where shop_id = ${shopId} and created_at >= ${dayStart}`);
  const [ord] = await q(sql`select count(*)::int as n, coalesce(sum(total - total_refunded), 0)::text as total from orders where shop_id = ${shopId} and cancelled_at is null and test = false and processed_at >= ${dayStart}`);
  const [carts] = await q(sql`select count(*)::int as n from carts c where c.shop_id = ${shopId} and c.completed_at is null and c.updated_at >= ${t}::timestamptz - interval '30 minutes' and exists (select 1 from cart_lines l where l.cart_id = c.id)`);
  const perMinute = await q(sql`select to_char(date_trunc('minute', created_at), 'YYYY-MM-DD"T"HH24:MI:00"Z"') as minute, count(*)::int as views from visits where shop_id = ${shopId} and created_at >= ${t}::timestamptz - interval '30 minutes' and created_at <= ${t}::timestamptz group by 1`);
  const byMinute = new Map(perMinute.map((r) => [String(r.minute), n(r.views)]));
  const base = Math.floor(now.getTime() / 60000) * 60000;
  const viewsPerMinute = Array.from({ length: 30 }, (_, i) => { const m = new Date(base - (29 - i) * 60000).toISOString().slice(0, 17) + '00Z'; return { minute: m, views: byMinute.get(m) ?? 0 }; });
  const topPages = await q(sql`select path, count(*)::int as views from visits where shop_id = ${shopId} and created_at >= ${t}::timestamptz - interval '30 minutes' group by 1 order by 2 desc, 1 limit 8`);
  const source = sql`coalesce(nullif(regexp_replace(regexp_replace(coalesce(referrer, ''), '^https?://(www\\.)?', ''), '[/?#].*$', ''), ''), 'direct')`;
  const topSources = await q(sql`select ${source} as source, count(distinct session_id)::int as sessions from visits where shop_id = ${shopId} and created_at >= ${t}::timestamptz - interval '30 minutes' group by 1 order by 2 desc, 1 limit 8`);
  const recent = await q(sql`select o.id, o.name, (o.total - o.total_refunded)::text as total, o.processed_at as at, a.country_code as country from orders o left join order_addresses a on a.order_id = o.id and a.kind = 'shipping'
    where o.shop_id = ${shopId} and o.cancelled_at is null and o.test = false and o.processed_at >= ${t}::timestamptz - interval '24 hours' order by o.processed_at desc limit 10`);
  return {
    at: t, currency: shop.currency, visitorsNow: n(visitors?.n), sessionsToday: n(today?.n), ordersToday: n(ord?.n), salesToday: n(ord?.total), activeCarts: n(carts?.n), viewsPerMinute,
    topPages: topPages.map((r) => ({ path: String(r.path), views: n(r.views) })), topSources: topSources.map((r) => ({ source: String(r.source), sessions: n(r.sessions) })),
    recentOrders: recent.map((r) => ({ id: n(r.id), name: String(r.name), total: n(r.total), createdAt: new Date(String(r.at)).toISOString(), country: (r.country as string) ?? null })),
  };
}

/** Currencies the reports can be shown in: the shop currency plus the enabled presentment currencies that have a rate. */
export async function reportCurrencies(db: Executor, shopId: number): Promise<Array<{ code: string; rate: number }>> {
  const shop = await getShop(db, shopId);
  if (!shop) return [];
  const rows = await db.select({ code: currencySettings.currencyCode, rate: currencySettings.manualRate }).from(currencySettings)
    .where(and(eq(currencySettings.shopId, shopId), eq(currencySettings.enabled, true))).orderBy(asc(currencySettings.currencyCode));
  return [{ code: shop.currency, rate: 1 }, ...rows.filter((r) => r.rate && r.rate > 0 && r.code !== shop.currency).map((r) => ({ code: r.code, rate: r.rate! }))];
}
