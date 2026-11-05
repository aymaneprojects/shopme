import { and, eq, sql, type SQL } from 'drizzle-orm';
import type { Executor } from '../../db/client';
import { currencySettings } from '../../db/schema';
import { convertMinor } from '../markets/money';
import { rfmGroupOf } from './rfm';
import { getShop } from '../shops';
import { csvLine } from '../csv';

export const REPORT_NAMES = [
  'SALES_OVER_TIME', 'SALES_BY_PRODUCT', 'SALES_BY_VARIANT', 'SALES_BY_VENDOR', 'ORDERS_OVER_TIME', 'AVERAGE_ORDER_VALUE',
  'RETURNING_CUSTOMER_RATE', 'TOP_CUSTOMERS', 'DISCOUNT_USAGE', 'TAXES', 'INVENTORY_SNAPSHOT', 'SESSIONS',
  'SALES_BY_CHANNEL', 'SALES_BY_PAYMENT_METHOD', 'SALES_BY_COUNTRY', 'NEW_VS_RETURNING', 'PROFIT_BY_PRODUCT', 'ACQUISITION_BY_REFERRER', 'TOP_PAGES',
  'CUSTOMER_COHORTS', 'RFM_SEGMENTS', 'SELL_THROUGH', 'ABC_ANALYSIS',
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
export async function shopmeReport(db: Executor, shopId: number, name: ReportName, from: string, to: string, groupBy: GroupBy = 'DAY', currency?: string | null): Promise<Report | null> {
  const rep = await runReport(db, shopId, name, from, to, groupBy);
  if (!rep || !currency || currency === rep.currency) return rep;
  const [cs] = await db.select({ rate: currencySettings.manualRate }).from(currencySettings)
    .where(and(eq(currencySettings.shopId, shopId), eq(currencySettings.currencyCode, currency), eq(currencySettings.enabled, true)));
  if (!cs?.rate || !(cs.rate > 0)) return rep; // not an enabled presentment currency with a rate: stay in shop money
  const rate = cs.rate;
  const moneyIdx = rep.columns.map((c, i) => (c.type === 'money' ? i : -1)).filter((i) => i >= 0);
  const totals = { ...rep.totals };
  for (const c of rep.columns) if (c.type === 'money' && c.key in totals) totals[c.key] = convertMinor(totals[c.key]!, rep.currency, currency, rate);
  return { ...rep, currency, totals, rows: rep.rows.map((r) => r.map((v, i) => (moneyIdx.includes(i) && v !== null ? convertMinor(Number(v), rep.currency, currency, rate) : v))) };
}

async function runReport(db: Executor, shopId: number, name: ReportName, from: string, to: string, groupBy: GroupBy): Promise<Report | null> {
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
      const r = await q(sql`select ${period} as p, count(*)::int as orders, coalesce(sum((select sum(l.current_quantity) from order_lines l where l.order_id = o.id)), 0)::text as units,
        count(*) filter (where o.fulfillment_status = 'FULFILLED')::int as fulfilled from orders o where ${w} group by 1 order by 1`);
      return done([col('period', 'Period', 'date'), col('orders', 'Orders', 'int'), col('units', 'Units sold', 'int'), col('fulfilled', 'Orders fulfilled', 'int')], r.map((x) => [String(x.p), n(x.orders), n(x.units), n(x.fulfilled)]));
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
    case 'SALES_BY_CHANNEL': {
      const r = await q(sql`select coalesce(nullif(o.source_name, ''), 'web') as channel, count(*)::int as orders, sum(o.total - o.total_refunded)::text as total from orders o where ${w} group by 1 order by sum(o.total - o.total_refunded) desc, 1`);
      return done([col('channel', 'Sales channel', 'text'), col('orders', 'Orders', 'int'), col('total', 'Total sales', 'money')], r.map((x) => [String(x.channel), n(x.orders), n(x.total)]));
    }
    case 'SALES_BY_PAYMENT_METHOD': {
      const r = await q(sql`select coalesce(t.gateway, '-') as gateway, count(distinct t.order_id)::int as orders,
        sum(case when t.kind in ('SALE', 'CAPTURE') then t.amount else 0 end)::text as paid, sum(case when t.kind = 'REFUND' then t.amount else 0 end)::text as refunded
        from transactions t join orders o on o.id = t.order_id where ${w} and t.status = 'SUCCESS' group by 1 order by sum(case when t.kind in ('SALE', 'CAPTURE') then t.amount else 0 end) desc, 1`);
      return done([col('gateway', 'Payment method', 'text'), col('orders', 'Orders', 'int'), col('paid', 'Paid', 'money'), col('refunded', 'Refunded', 'money')], r.map((x) => [String(x.gateway), n(x.orders), n(x.paid), n(x.refunded)]));
    }
    case 'SALES_BY_COUNTRY': {
      const r = await q(sql`select coalesce(nullif(a.country_code, ''), '-') as country, count(*)::int as orders, sum(o.total - o.total_refunded)::text as total
        from orders o left join order_addresses a on a.order_id = o.id and a.kind = 'shipping' where ${w} group by 1 order by sum(o.total - o.total_refunded) desc, 1`);
      return done([col('country', 'Country', 'text'), col('orders', 'Orders', 'int'), col('total', 'Total sales', 'money')], r.map((x) => [String(x.country), n(x.orders), n(x.total)]));
    }
    case 'NEW_VS_RETURNING': {
      const r = await q(sql`select ${period} as p,
        count(*) filter (where o.customer_id is null or f.first_order = o.id)::int as new_orders, count(*) filter (where o.customer_id is not null and f.first_order <> o.id)::int as returning_orders,
        coalesce(sum(o.total - o.total_refunded) filter (where o.customer_id is null or f.first_order = o.id), 0)::text as new_sales, coalesce(sum(o.total - o.total_refunded) filter (where o.customer_id is not null and f.first_order <> o.id), 0)::text as returning_sales
        from orders o left join (select customer_id, (array_agg(id order by processed_at, id))[1] as first_order from orders where shop_id = ${shopId} and cancelled_at is null and test = false and customer_id is not null group by 1) f on f.customer_id = o.customer_id
        where ${w} group by 1 order by 1`);
      return done([col('period', 'Period', 'date'), col('new_orders', 'New customer orders', 'int'), col('returning_orders', 'Returning customer orders', 'int'), col('new_sales', 'New customer sales', 'money'), col('returning_sales', 'Returning customer sales', 'money')],
        r.map((x) => [String(x.p), n(x.new_orders), n(x.returning_orders), n(x.new_sales), n(x.returning_sales)]));
    }
    case 'PROFIT_BY_PRODUCT': {
      const r = await q(sql`select max(l.title) as title, sum(l.current_quantity)::text as units, sum(l.discounted_total)::text as sales, sum(l.current_quantity * coalesce(i.unit_cost, 0))::text as cost
        from order_lines l join orders o on o.id = l.order_id left join inventory_items i on i.variant_id = l.variant_id where ${w} and l.is_gift_card = false
        group by coalesce(l.product_id::text, l.title) order by sum(l.discounted_total) - sum(l.current_quantity * coalesce(i.unit_cost, 0)) desc, 1 limit 500`);
      const rows = r.map((x): Cell[] => [String(x.title), n(x.units), n(x.sales), n(x.cost), n(x.sales) - n(x.cost), pct(n(x.sales) - n(x.cost), n(x.sales))]);
      const sales = rows.reduce((t, x) => t + n(x[2]), 0), profit = rows.reduce((t, x) => t + n(x[4]), 0);
      return done([col('product', 'Product', 'text'), col('units', 'Units sold', 'int'), col('sales', 'Sales', 'money'), col('cost', 'Cost of goods', 'money'), col('profit', 'Profit', 'money'), col('margin', 'Margin', 'percent')], rows, { margin: pct(profit, sales) });
    }
    case 'ACQUISITION_BY_REFERRER': {
      const source = sql`coalesce(nullif(regexp_replace(regexp_replace(coalesce(v.referrer, ''), '^https?://(www\\.)?', ''), '[/?#].*$', ''), ''), 'direct')`;
      const r = await q(sql`select ${source} as source, count(distinct v.session_id)::int as sessions, count(*)::int as views from visits v
        where v.shop_id = ${shopId} and v.created_at >= ${fromTs} and v.created_at < ${toTs} group by 1 order by count(distinct v.session_id) desc, 1 limit 200`);
      return done([col('source', 'Traffic source', 'text'), col('sessions', 'Sessions', 'int'), col('views', 'Page views', 'int')], r.map((x) => [String(x.source), n(x.sessions), n(x.views)]));
    }
    case 'TOP_PAGES': {
      const r = await q(sql`select v.path, count(*)::int as views, count(distinct v.session_id)::int as sessions from visits v
        where v.shop_id = ${shopId} and v.created_at >= ${fromTs} and v.created_at < ${toTs} group by 1 order by count(*) desc, 1 limit 200`);
      return done([col('path', 'Page', 'text'), col('views', 'Page views', 'int'), col('sessions', 'Sessions', 'int')], r.map((x) => [String(x.path), n(x.views), n(x.sessions)]));
    }
    case 'CUSTOMER_COHORTS': {
      // Customers grouped by the month of their first order; the share of each cohort that ordered again 0..5 months later.
      const ks = [0, 1, 2, 3, 4, 5];
      const r = await q(sql`with firsts as (
          select customer_id, date_trunc('month', min(processed_at) at time zone ${tz}) as cohort from orders where shop_id = ${shopId} and cancelled_at is null and test = false and customer_id is not null group by 1
        ), act as (
          select distinct o.customer_id, date_trunc('month', o.processed_at at time zone ${tz}) as m from orders o where o.shop_id = ${shopId} and o.cancelled_at is null and o.test = false and o.customer_id is not null
        )
        select to_char(f.cohort, 'YYYY-MM-DD') as cohort, count(distinct f.customer_id)::int as customers,
          ${sql.join(ks.map((k) => sql`count(distinct a.customer_id) filter (where a.m = f.cohort + (${k} * interval '1 month'))::int as ${sql.raw(`m${k}`)}`), sql`, `)}
        from firsts f left join act a on a.customer_id = f.customer_id
        where f.cohort >= date_trunc('month', ${from}::date::timestamp) and f.cohort < ${to}::date::timestamp + interval '1 day' group by f.cohort order by f.cohort`);
      return done([col('cohort', 'First order month', 'date'), col('customers', 'Customers', 'int'), ...ks.map((k) => col(`m${k}`, `Month ${k}`, 'percent'))],
        r.map((x) => [String(x.cohort), n(x.customers), ...ks.map((k) => pct(n(x[`m${k}`]), n(x.customers)))]));
    }
    case 'RFM_SEGMENTS': {
      const r = await q(sql`select c.id, count(o.id)::int as orders, coalesce(sum(o.total - o.total_refunded), 0)::text as spent, extract(day from now() - max(o.processed_at))::int as days
        from customers c left join orders o on o.customer_id = c.id and o.cancelled_at is null and o.test = false where c.shop_id = ${shopId} and c.erased_at is null group by c.id`);
      const groups = new Map<string, { customers: number; orders: number; spent: number }>();
      for (const x of r) {
        const g = rfmGroupOf(x.days == null ? null : n(x.days), n(x.orders));
        const e = groups.get(g) ?? { customers: 0, orders: 0, spent: 0 };
        e.customers++; e.orders += n(x.orders); e.spent += n(x.spent); groups.set(g, e);
      }
      const rows = [...groups.entries()].sort((a, b) => b[1].customers - a[1].customers || a[0].localeCompare(b[0])).map(([g, e]): Cell[] => [g, e.customers, e.orders, e.spent, e.customers ? Math.round(e.spent / e.customers) : 0]);
      return done([col('segment', 'RFM group', 'text'), col('customers', 'Customers', 'int'), col('orders', 'Orders', 'int'), col('spent', 'Total spent', 'money'), col('average', 'Average spent', 'money')], rows);
    }
    case 'SELL_THROUGH': {
      const r = await q(sql`select p.title, coalesce(s.units, 0)::int as sold, coalesce(st.stock, 0)::int as stock from products p
        left join (select l.product_id, sum(l.current_quantity) as units from order_lines l join orders o on o.id = l.order_id where ${w} group by 1) s on s.product_id = p.id
        left join (select v.product_id, sum(il.available) as stock from product_variants v join inventory_items i on i.variant_id = v.id join inventory_levels il on il.inventory_item_id = i.id and il.is_active group by 1) st on st.product_id = p.id
        where p.shop_id = ${shopId} and p.status <> 'ARCHIVED' and (coalesce(s.units, 0) > 0 or coalesce(st.stock, 0) > 0) order by coalesce(s.units, 0) desc, p.title limit 500`);
      return done([col('product', 'Product', 'text'), col('sold', 'Units sold', 'int'), col('stock', 'Units in stock', 'int'), col('rate', 'Sell-through rate', 'percent')],
        r.map((x) => [String(x.title), n(x.sold), n(x.stock), pct(n(x.sold), n(x.sold) + n(x.stock))]));
    }
    case 'ABC_ANALYSIS': {
      const r = await q(sql`select max(l.title) as title, sum(l.discounted_total)::text as sales from order_lines l join orders o on o.id = l.order_id where ${w} and l.is_gift_card = false
        group by coalesce(l.product_id::text, l.title) order by sum(l.discounted_total) desc, 1 limit 1000`);
      const total = r.reduce((t, x) => t + n(x.sales), 0);
      let run = 0;
      const rows = r.map((x): Cell[] => {
        const before = total ? run / total : 0; run += n(x.sales);
        return [String(x.title), n(x.sales), pct(n(x.sales), total), pct(run, total), before < 0.8 ? 'A' : before < 0.95 ? 'B' : 'C'];
      });
      return done([col('product', 'Product', 'text'), col('sales', 'Sales', 'money'), col('share', 'Share of sales', 'percent'), col('cumulative', 'Cumulative share', 'percent'), col('class', 'ABC class', 'text')], rows);
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
