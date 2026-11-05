/** ShopMe-specific (no Shopify equivalent): numbers for the admin home screen. See docs/dev/admin-settings-api.md. */
import { GraphQLError } from 'graphql';
import { GROUP_BYS, REPORT_NAMES, productMetrics, shopDashboard, shopmeReport, type ProductMetrics, type Report } from '@shopme/core';
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

const AbcCounts = builder.objectRef<ProductMetrics['abc']>('ShopmeAbcCounts').implement({ fields: (t) => ({ a: t.exposeInt('a'), b: t.exposeInt('b'), c: t.exposeInt('c') }) });
const ProductMetricsType = builder.objectRef<ProductMetrics>('ShopmeProductMetrics').implement({
  description: 'Figures of the strip above the products list. `sellThroughRate` is 0-1.',
  fields: (t) => ({
    days: t.exposeInt('days'), unitsSold: t.exposeInt('unitsSold'), unitsInStock: t.exposeInt('unitsInStock'),
    sellThroughRate: t.float({ nullable: true, resolve: (m) => m.sellThroughRate }),
    daysOfStockLeft: t.int({ nullable: true, resolve: (m) => m.daysOfStockLeft }),
    abc: t.field({ type: AbcCounts, resolve: (m) => m.abc }),
    unsold: t.exposeInt('unsold'),
  }),
});
builder.queryFields((t) => ({
  shopmeProductMetrics: t.field({
    type: ProductMetricsType, args: { days: t.arg.int({ defaultValue: 30 }) },
    resolve: (_r, a, ctx) => { requireScope(ctx, 'read_products'); return productMetrics(ctx.db, ctx.shopId, { days: a.days ?? 30 }); },
  }),
}));

const ReportName = builder.enumType('ShopmeReportName', { values: REPORT_NAMES });
const GroupBy = builder.enumType('ShopmeReportGroupBy', { values: GROUP_BYS });
const ReportColumn = builder.objectRef<Report['columns'][number]>('ShopmeReportColumn').implement({
  fields: (t) => ({ key: t.exposeString('key'), label: t.exposeString('label'), type: t.exposeString('type', { description: 'text | date | int | money | percent' }) }),
});
const ReportRef = builder.objectRef<Report>('ShopmeReport').implement({
  description: 'ShopMe analytics report. `money` cells are integer minor units of `currencyCode`; `percent` cells are 0-100.',
  fields: (t) => ({
    name: t.field({ type: ReportName, resolve: (r) => r.name }),
    currencyCode: t.exposeString('currency'),
    from: t.exposeString('from'), to: t.exposeString('to'),
    groupBy: t.field({ type: GroupBy, resolve: (r) => r.groupBy }),
    columns: t.field({ type: [ReportColumn], resolve: (r) => r.columns }),
    rows: t.field({ type: 'JSON', description: 'Array of rows, each an array of cells in column order.', resolve: (r) => r.rows }),
    totals: t.field({ type: 'JSON', description: 'Column key -> total (summable columns, plus the overall ratio of ratio reports).', resolve: (r) => r.totals }),
  }),
});

builder.queryFields((t) => ({
  shopmeReport: t.field({
    type: ReportRef,
    args: { name: t.arg({ type: ReportName, required: true }), from: t.arg.string({ required: true, description: 'YYYY-MM-DD, shop time zone.' }), to: t.arg.string({ required: true, description: 'YYYY-MM-DD, inclusive.' }), groupBy: t.arg({ type: GroupBy, defaultValue: 'DAY' }) },
    resolve: async (_r, a, ctx) => {
      requireScope(ctx, 'read_reports');
      const r = await shopmeReport(ctx.db, ctx.shopId, a.name, a.from, a.to, a.groupBy ?? 'DAY');
      if (!r) throw new GraphQLError('from and to must be YYYY-MM-DD dates with from <= to', { extensions: { code: 'BAD_USER_INPUT' } });
      return r;
    },
  }),
}));
