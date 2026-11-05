import { sql, type SQL } from 'drizzle-orm';
import type { Executor } from '../../db/client';
import { getShop } from '../shops';
import { csvLine } from '../csv';

export const REPORT_NAMES = [
  'SALES_OVER_TIME', 'SALES_BY_PRODUCT', 'SALES_BY_VARIANT', 'SALES_BY_VENDOR', 'ORDERS_OVER_TIME', 'AVERAGE_ORDER_VALUE',
  'RETURNING_CUSTOMER_RATE', 'TOP_CUSTOMERS', 'DISCOUNT_USAGE', 'TAXES', 'INVENTORY_SNAPSHOT', 'SESSIONS',
] as const;
export type ReportName = (typeof REPORT_NAMES)[number];
export const GROUP_BYS = ['DAY', 'WEEK', 'MONTH'] as const;
export type GroupBy = (typeof GROUP_BYS)[number];

/** `money` cells are integer minor units of `currency`, `percent` is 0-100 with two decimals, `date` is YYYY-MM-DD. */
export type ColumnType = 'text' | 'date' | 'int' | 'money' | 'percent';
export interface ReportColumn { key: string; label: string; type: ColumnType }
export type Cell = string | number | null;
export interface Report {
  name: ReportName; currency: string; from: string; to: string; groupBy: GroupBy;
  columns: ReportColumn[]; rows: Cell[][];
  /** One value per summable column (`int`, `money`), plus the ratios of the ratio reports. */
  totals: Record<string, number>;
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
type Row = Record<string, string | number | null>;
const rowsOf = (r: unknown) => ((r as { rows?: unknown[] }).rows ?? (r as unknown[])) as Row[];
const n = (v: unknown) => Number(v ?? 0);
const col = (key: string, label: string, type: ColumnType): ReportColumn => ({ key, label, type });
const pct = (a: number, b: number) => (b ? Math.round((a / b) * 10000) / 100 : 0);

export const isDay = (v: string) => DAY_RE.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));

/**
 * Run a report over the closed day range [from, to] (shop time zone). Orders counted are non-cancelled, non-test orders
 * processed in the range; `INVENTORY_SNAPSHOT` ignores the range. Returns `null` for an invalid range.
 */
export async function shopmeReport(db: Executor, shopId: number, name: ReportName, from: string, to: string, groupBy: GroupBy = 'DAY'): Promise<Report | null> {
  if (!isDay(from) || !isDay(to) || from > to) return null;
  const shop = await getShop(db, shopId);
  if (!shop) throw new Error('Shop not found');
  const tz = shop.timezone;
  const unit = sql.raw(groupBy === 'WEEK' ? "'week'" : groupBy === 'MONTH' ? "'month'" : "'day'");
  const fromTs = sql`(${from}::date::timestamp at time zone ${tz})`;
  const toTs = sql`((${to}::date + 1)::timestamp at time zone ${tz})`;
  const where = (alias: string, column = 'processed_at'): SQL => sql.raw(`${alias}.shop_id = ${Number(shopId)}`).append(sql` and `).append(sql.raw(`${alias}.cancelled_at is null and ${alias}.test = false and ${alias}.${column}`)).append(sql` >= ${fromTs} and `).append(sql.raw(`${alias}.${column}`)).append(sql` < ${toTs}`);
  const w = where('o');
  const period = sql`to_char(date_trunc(${unit}, o.processed_at at time zone ${tz}), 'YYYY-MM-DD')`;
  const q = async (query: SQL) => rowsOf(await db.execute(query));
  const base = { name, currency: shop.currency, from, to, groupBy };
  const done = (columns: ReportColumn[], rows: Cell[][], totals: Record<string, number> = {}): Report => {
    const sums: Record<string, number> = {};
    columns.forEach((c, i) => { if (c.type === 'int' || c.type === 'money') sums[c.key] = rows.reduce((s, r) => s + n(r[i]), 0); });
    return { ...base, columns, rows, totals: { ...sums, ...totals } };
  };

  switch (name) {
    case 'SALES_OVER_TIME': {
      const r = await q(sql`select ${period} as p, count(*)::int as orders, sum(o.subtotal + o.total_discounts)::text as gross, sum(o.total_discounts)::text as discounts, sum(o.total_refunded)::text as refunds,
        sum(o.total_shipping)::text as shipping, sum(o.total_tax)::text as taxes, sum(o.total - o.total_refunded)::text as total from orders o where ${w} group by 1 order by 1`);
      return done([col('period', 'Period', 'date'), col('orders', 'Orders', 'int'), col('gross', 'Gross sales', 'money'), col('discounts', 'Discounts', 'money'), col('refunds', 'Refunds', 'money'), col('shipping', 'Shipping', 'money'), col('taxes', 'Taxes', 'money'), col('total', 'Total sales', 'money')],
        r.map((x) => [String(x.p), n(x.orders), n(x.gross), n(x.discounts), n(x.refunds), n(x.shipping), n(x.taxes), n(x.total)]));
    }
    case 'ORDERS_OVER_TIME': {
      const r = await q(sql`select ${period} as p, count(*)::int as orders, coalesce(sum((select sum(l.current_quantity) from order_lines l where l.order_id = o.id)), 0)::text as units from orders o where ${w} group by 1 order by 1`);
      return done([col('period', 'Period', 'date'), col('orders', 'Orders', 'int'), col('units', 'Units sold', 'int')], r.map((x) => [String(x.p), n(x.orders), n(x.units)]));
    }
    case 'AVERAGE_ORDER_VALUE': {
      const r = await q(sql`select ${period} as p, count(*)::int as orders, sum(o.total - o.total_refunded)::text as total from orders o where ${w} group by 1 order by 1`);
      const rows = r.map((x): Cell[] => [String(x.p), n(x.orders), n(x.total), n(x.orders) ? Math.round(n(x.total) / n(x.orders)) : 0]);
      const orders = rows.reduce((s, x) => s + n(x[1]), 0); const total = rows.reduce((s, x) => s + n(x[2]), 0);
      return done([col('period', 'Period', 'date'), col('orders', 'Orders', 'int'), col('total', 'Total sales', 'money'), col('aov', 'Average order value', 'money')], rows, { aov: orders ? Math.round(total / orders) : 0 });
    }
    case 'SALES_BY_PRODUCT':
    case 'SALES_BY_VARIANT':
    case 'SALES_BY_VENDOR': {
      const byVariant = name === 'SALES_BY_VARIANT';
      const byVendor = name === 'SALES_BY_VENDOR';
      const key = byVendor ? sql`coalesce(nullif(l.vendor, ''), '-')` : byVariant ? sql`coalesce(l.variant_id::text, l.title || '/' || coalesce(l.variant_title, ''))` : sql`coalesce(l.product_id::text, l.title)`;
      const r = await q(sql`select max(l.title) as title, max(l.variant_title) as variant, max(l.sku) as sku, max(coalesce(nullif(l.vendor, ''), '-')) as vendor, sum(l.current_quantity)::text as units, sum(l.discounted_total)::text as sales
        from order_lines l join orders o on o.id = l.order_id where ${w} group by ${key} order by sum(l.discounted_total) desc, max(l.title) limit 500`);
      if (byVendor) return done([col('vendor', 'Vendor', 'text'), col('units', 'Units sold', 'int'), col('sales', 'Sales', 'money')], r.map((x) => [String(x.vendor), n(x.units), n(x.sales)]));
      if (byVariant) return done([col('product', 'Product', 'text'), col('variant', 'Variant', 'text'), col('sku', 'SKU', 'text'), col('units', 'Units sold', 'int'), col('sales', 'Sales', 'money')], r.map((x) => [String(x.title), (x.variant as string) ?? null, (x.sku as string) ?? null, n(x.units), n(x.sales)]));
      return done([col('product', 'Product', 'text'), col('units', 'Units sold', 'int'), col('sales', 'Sales', 'money')], r.map((x) => [String(x.title), n(x.units), n(x.sales)]));
    }
    case 'RETURNING_CUSTOMER_RATE': {
      const r = await q(sql`select ${period} as p, count(distinct o.customer_id)::int as customers,
        count(distinct o.customer_id) filter (where f.first_at < date_trunc(${unit}, o.processed_at at time zone ${tz}) at time zone ${tz})::int as returning
        from orders o join (select customer_id, min(processed_at) as first_at from orders where shop_id = ${shopId} and cancelled_at is null and test = false and customer_id is not null group by 1) f on f.customer_id = o.customer_id
        where ${w} group by 1 order by 1`);
      const rows = r.map((x): Cell[] => [String(x.p), n(x.customers), n(x.returning), pct(n(x.returning), n(x.customers))]);
      const c = rows.reduce((s, x) => s + n(x[1]), 0); const ret = rows.reduce((s, x) => s + n(x[2]), 0);
      return done([col('period', 'Period', 'date'), col('customers', 'Customers', 'int'), col('returning', 'Returning customers', 'int'), col('rate', 'Returning customer rate', 'percent')], rows, { rate: pct(ret, c) });
    }
    case 'TOP_CUSTOMERS': {
      const r = await q(sql`select c.id, coalesce(nullif(trim(coalesce(c.first_name, '') || ' ' || coalesce(c.last_name, '')), ''), c.email, '-') as customer, c.email, count(*)::int as orders, sum(o.total - o.total_refunded)::text as spent
        from orders o join customers c on c.id = o.customer_id where ${w} group by c.id order by sum(o.total - o.total_refunded) desc, c.id limit 100`);
      return done([col('customer', 'Customer', 'text'), col('email', 'Email', 'text'), col('orders', 'Orders', 'int'), col('spent', 'Total spent', 'money')], r.map((x) => [String(x.customer), (x.email as string) ?? null, n(x.orders), n(x.spent)]));
    }
    case 'DISCOUNT_USAGE': {
      const r = await q(sql`select coalesce(d.code, d.title, '-') as discount, count(distinct d.order_id)::int as orders, sum(d.allocated_amount)::text as amount
        from order_discount_applications d join orders o on o.id = d.order_id where ${w} group by 1 order by sum(d.allocated_amount) desc, 1`);
      return done([col('discount', 'Discount', 'text'), col('orders', 'Orders', 'int'), col('amount', 'Discounted amount', 'money')], r.map((x) => [String(x.discount), n(x.orders), n(x.amount)]));
    }
    case 'TAXES': {
      const r = await q(sql`select t.title, t.rate::float as rate, count(distinct t.order_id)::int as orders, sum(t.price)::text as tax
        from order_tax_lines t join orders o on o.id = t.order_id where ${w} group by t.title, t.rate order by sum(t.price) desc, t.title`);
      return done([col('title', 'Tax', 'text'), col('rate', 'Rate', 'percent'), col('orders', 'Orders', 'int'), col('tax', 'Tax collected', 'money')], r.map((x) => [String(x.title), Math.round(n(x.rate) * 10000) / 100, n(x.orders), n(x.tax)]));
    }
    case 'INVENTORY_SNAPSHOT': {
      const r = await q(sql`select p.title, v.title as variant, v.sku, coalesce(sum(l.available), 0)::int as available, coalesce(sum(l.on_hand), 0)::int as on_hand, coalesce(sum(l.committed), 0)::int as committed,
        (coalesce(sum(l.on_hand), 0) * coalesce(max(i.unit_cost), 0))::text as value
        from product_variants v join products p on p.id = v.product_id left join inventory_items i on i.variant_id = v.id left join inventory_levels l on l.inventory_item_id = i.id and l.is_active
        where v.shop_id = ${shopId} and p.status <> 'ARCHIVED' group by p.id, v.id order by p.title, v.position limit 2000`);
      return done([col('product', 'Product', 'text'), col('variant', 'Variant', 'text'), col('sku', 'SKU', 'text'), col('available', 'Available', 'int'), col('on_hand', 'On hand', 'int'), col('committed', 'Committed', 'int'), col('value', 'Inventory value', 'money')],
        r.map((x) => [String(x.title), (x.variant as string) ?? null, (x.sku as string) ?? null, n(x.available), n(x.on_hand), n(x.committed), n(x.value)]));
    }
    case 'SESSIONS': {
      const vp = sql`to_char(date_trunc(${unit}, v.created_at at time zone ${tz}), 'YYYY-MM-DD')`;
      const vw = sql`v.shop_id = ${shopId} and v.created_at >= ${fromTs} and v.created_at < ${toTs}`;
      const visits = await q(sql`select ${vp} as p, count(distinct v.session_id)::int as sessions, count(*)::int as views from visits v where ${vw} group by 1`);
      const ords = await q(sql`select ${period} as p, count(*)::int as orders from orders o where ${w} group by 1`);
      const map = new Map<string, { sessions: number; views: number; orders: number }>();
      for (const x of visits) map.set(String(x.p), { sessions: n(x.sessions), views: n(x.views), orders: 0 });
      for (const x of ords) { const e = map.get(String(x.p)) ?? { sessions: 0, views: 0, orders: 0 }; e.orders = n(x.orders); map.set(String(x.p), e); }
      const rows = [...map.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([p, e]): Cell[] => [p, e.sessions, e.views, e.orders, pct(e.orders, e.sessions)]);
      const [tot] = await q(sql`select count(distinct v.session_id)::int as sessions from visits v where ${vw}`);
      const orders = rows.reduce((s, x) => s + n(x[3]), 0);
      return { ...done([col('period', 'Period', 'date'), col('sessions', 'Sessions', 'int'), col('views', 'Page views', 'int'), col('orders', 'Orders', 'int'), col('conversion', 'Conversion rate', 'percent')], rows, { conversion: pct(orders, n(tot?.sessions)) }) };
    }
  }
}

/** Format a cell as a decimal for CSV (money in major units). */
function plain(c: ReportColumn, v: Cell, currency: string): string {
  if (v === null) return '';
  if (c.type !== 'money') return String(v);
  let digits = 2;
  try { digits = new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2; } catch { /* default */ }
  return (Number(v) / 10 ** digits).toFixed(digits);
}

/** CSV text of a report (header row, data rows). */
export function reportCsv(r: Report): string {
  const lines = [csvLine(r.columns.map((c) => c.label))];
  for (const row of r.rows) lines.push(csvLine(row.map((v, i) => plain(r.columns[i]!, v, r.currency))));
  return lines.join('');
}
