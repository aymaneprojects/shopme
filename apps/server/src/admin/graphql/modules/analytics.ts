/** ShopMe-specific (no Shopify equivalent): numbers for the admin home screen. See docs/dev/admin-settings-api.md. */
import { shopDashboard } from '@shopme/core';
import { builder } from '../builder';
import { requireScope } from '../context';
import { Count, MoneyV2, moneyV2 } from '../types/money';
import { Product_ } from '../types/catalog';
import { getProduct } from '@shopme/core';

const Range = builder.enumType('ShopmeDashboardRange', { values: ['TODAY', 'LAST_7_DAYS', 'LAST_30_DAYS'] as const });

type Dash = Awaited<ReturnType<typeof shopDashboard>>;
const SalesByDay = builder.objectRef<{ date: string; sales: string; orders: number; currency: string }>('ShopmeDashboardDay').implement({
  fields: (t) => ({
    date: t.exposeString('date', { description: 'YYYY-MM-DD in the shop time zone.' }),
    sales: t.field({ type: MoneyV2, resolve: (d) => ({ amount: d.sales, currencyCode: d.currency }) }),
    ordersCount: t.exposeInt('orders'),
  }),
});
const TopProduct = builder.objectRef<Dash['topProducts'][number] & { currency: string }>('ShopmeDashboardProduct').implement({
  fields: (t) => ({
    title: t.exposeString('title'),
    quantity: t.exposeInt('quantity'),
    sales: t.field({ type: MoneyV2, resolve: (p) => moneyV2(p.sales, p.currency) }),
    product: t.field({ type: Product_, nullable: true, resolve: (p, _a, ctx) => (p.productId ? getProduct(ctx.db, ctx.shopId, p.productId) : null) }),
  }),
});
const Dashboard = builder.objectRef<Dash>('ShopmeDashboard').implement({
  fields: (t) => ({
    totalSales: t.field({ type: MoneyV2, resolve: (d) => moneyV2(d.totalSales, d.currency) }),
    ordersCount: t.exposeInt('ordersCount'),
    averageOrderValue: t.field({ type: MoneyV2, resolve: (d) => moneyV2(d.averageOrderValue, d.currency) }),
    salesByDay: t.field({ type: [SalesByDay], resolve: (d) => d.salesByDay.map((x) => ({ ...x, sales: moneyV2(x.sales, d.currency).amount, currency: d.currency })) }),
    topProducts: t.field({ type: [TopProduct], resolve: (d) => d.topProducts.map((p) => ({ ...p, currency: d.currency })) }),
  }),
});
void Count;

builder.queryFields((t) => ({
  shopmeDashboard: t.field({
    type: Dashboard, args: { range: t.arg({ type: Range, defaultValue: 'LAST_7_DAYS' }) },
    resolve: (_r, a, ctx) => { requireScope(ctx, 'read_reports'); return shopDashboard(ctx.db, ctx.shopId, a.range ?? 'LAST_7_DAYS'); },
  }),
}));
