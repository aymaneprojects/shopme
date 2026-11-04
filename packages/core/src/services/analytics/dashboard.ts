import { sql } from 'drizzle-orm';
import type { Executor } from '../../db/client';
import { getShop } from '../shops';

export type DashboardRange = 'TODAY' | 'LAST_7_DAYS' | 'LAST_30_DAYS';
const DAYS: Record<DashboardRange, number> = { TODAY: 1, LAST_7_DAYS: 7, LAST_30_DAYS: 30 };

export interface Dashboard {
  currency: string;
  /** Net sales (order totals minus refunds) in minor units. */
  totalSales: number;
  ordersCount: number;
  averageOrderValue: number;
  /** One entry per day of the range (shop time zone), zero-filled. `date` is YYYY-MM-DD. */
  salesByDay: { date: string; sales: number; orders: number }[];
  topProducts: { productId: number | null; title: string; quantity: number; sales: number }[];
}

/**
 * Numbers behind the admin home screen. Counts non-cancelled, non-test orders processed in the range.
 * Days are cut in the shop's IANA time zone; "today" is the shop's today.
 */
export async function shopDashboard(db: Executor, shopId: number, range: DashboardRange): Promise<Dashboard> {
  const shop = await getShop(db, shopId);
  if (!shop) throw new Error('Shop not found');
  const days = DAYS[range];
  const tz = shop.timezone;
  const startDay = sql`((now() at time zone ${tz})::date - ${days - 1}::int)`;
  const startTs = sql`(${startDay}::timestamp at time zone ${tz})`;
  const where = sql`o.shop_id = ${shopId} and o.cancelled_at is null and o.test = false and o.processed_at >= ${startTs}`;

  const dayRows = await db.execute<{ day: string; sales: string; n: number }>(sql`
    select to_char(d.day, 'YYYY-MM-DD') as day, coalesce(s.sales, 0)::text as sales, coalesce(s.n, 0)::int as n
    from generate_series(${startDay}, (now() at time zone ${tz})::date, interval '1 day') as d(day)
    left join (
      select (o.processed_at at time zone ${tz})::date as day, sum(o.total - o.total_refunded) as sales, count(*) as n
      from orders o where ${where} group by 1
    ) s on s.day = d.day::date
    order by d.day`);
  const topRows = await db.execute<{ product_id: string | null; title: string; quantity: string; sales: string }>(sql`
    select max(l.product_id)::text as product_id, max(l.title) as title, sum(l.current_quantity)::text as quantity, sum(l.discounted_total)::text as sales
    from order_lines l join orders o on o.id = l.order_id
    where ${where} group by coalesce(l.product_id::text, l.title) order by sum(l.discounted_total) desc, max(l.title) limit 5`);

  const rows = (r: unknown) => ((r as { rows?: unknown[] }).rows ?? (r as unknown[])) as Record<string, string | number | null>[];
  const salesByDay = rows(dayRows).map((r) => ({ date: String(r.day), sales: Number(r.sales), orders: Number(r.n) }));
  const totalSales = salesByDay.reduce((s, d) => s + d.sales, 0);
  const ordersCount = salesByDay.reduce((s, d) => s + d.orders, 0);
  return {
    currency: shop.currency, totalSales, ordersCount, averageOrderValue: ordersCount ? Math.round(totalSales / ordersCount) : 0, salesByDay,
    topProducts: rows(topRows).map((r) => ({ productId: r.product_id ? Number(r.product_id) : null, title: String(r.title), quantity: Number(r.quantity), sales: Number(r.sales) })),
  };
}
