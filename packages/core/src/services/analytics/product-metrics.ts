import { sql } from 'drizzle-orm';
import type { Db } from '../../db/client';

/**
 * Figures of the strip above the products list, over the last `days` days (non-cancelled, non-test orders; gift card lines excluded):
 * - sell-through rate: units sold / (units sold + units in stock), over tracked, active products;
 * - days of stock left: units in stock / average units sold per day (null without sales);
 * - ABC analysis by revenue: products ranked by revenue, A until 80% of the revenue, B up to 95%, C the rest (products without sales included).
 */
export interface ProductMetrics {
  days: number;
  unitsSold: number;
  unitsInStock: number;
  sellThroughRate: number | null;
  daysOfStockLeft: number | null;
  abc: { a: number; b: number; c: number };
  /** Products that sold nothing over the period (counted in C). */
  unsold: number;
}

export interface AbcInput { id: number; revenue: number }

/** Class of each product: A covers the first 80% of the revenue, B the next 15%, C the remaining 5% and every product that sold nothing. */
export function abcClasses(rows: AbcInput[]): { a: number; b: number; c: number } {
  const sold = rows.filter((r) => r.revenue > 0).sort((x, y) => y.revenue - x.revenue || x.id - y.id);
  const total = sold.reduce((n, r) => n + r.revenue, 0);
  const out = { a: 0, b: 0, c: rows.length - sold.length };
  let before = 0;
  for (const r of sold) {
    // Classify on the share accumulated before this product, so the best seller is always an A.
    const share = total ? before / total : 0;
    if (share < 0.8) out.a += 1; else if (share < 0.95) out.b += 1; else out.c += 1;
    before += r.revenue;
  }
  return out;
}

export async function productMetrics(db: Db, shopId: number, opts: { days?: number; now?: Date } = {}): Promise<ProductMetrics> {
  const days = Math.min(Math.max(Math.trunc(opts.days ?? 30), 1), 365);
  const since = new Date((opts.now ?? new Date()).getTime() - days * 86_400_000);
  const sales = await db.execute(sql`
    select l.product_id, sum(l.current_quantity)::int as units, sum(l.discounted_total)::float8 as revenue
    from order_lines l join orders o on o.id = l.order_id
    where l.shop_id = ${shopId} and o.cancelled_at is null and o.test = false and o.processed_at >= ${since.toISOString()}::timestamptz and l.is_gift_card = false and l.product_id is not null
    group by l.product_id`);
  const stock = await db.execute(sql`
    select p.id, coalesce(sum(case when i.tracked then greatest(lv.available, 0) else 0 end), 0)::int as units
    from products p
    left join product_variants v on v.product_id = p.id
    left join inventory_items i on i.variant_id = v.id
    left join inventory_levels lv on lv.inventory_item_id = i.id and lv.is_active
    where p.shop_id = ${shopId} and p.status = 'ACTIVE' and p.is_gift_card = false
    group by p.id`);
  const rows = (r: unknown) => ((r as { rows?: unknown[] }).rows ?? (r as unknown[])) as Record<string, string | number>[];
  const byProduct = new Map(rows(sales).map((r) => [Number(r.product_id), { units: Number(r.units), revenue: Number(r.revenue) }]));
  const active = rows(stock).map((r) => ({ id: Number(r.id), units: Number(r.units) }));
  const unitsInStock = active.reduce((n, p) => n + p.units, 0);
  const unitsSold = active.reduce((n, p) => n + (byProduct.get(p.id)?.units ?? 0), 0);
  const abc = abcClasses(active.map((p) => ({ id: p.id, revenue: byProduct.get(p.id)?.revenue ?? 0 })));
  const perDay = unitsSold / days;
  return {
    days, unitsSold, unitsInStock,
    sellThroughRate: unitsSold + unitsInStock > 0 ? unitsSold / (unitsSold + unitsInStock) : null,
    daysOfStockLeft: perDay > 0 ? Math.round(unitsInStock / perDay) : null,
    abc, unsold: active.filter((p) => !(byProduct.get(p.id)?.revenue)).length,
  };
}
