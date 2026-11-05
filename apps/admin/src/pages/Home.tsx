import { Badge, Banner, Button, Card, Skeleton } from '@shopme/ui';
import { useQuery } from '@tanstack/react-query';
import { BarChart3, CreditCard, ExternalLink, Globe, Package, ScrollText, ShoppingCart } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { gql } from '../api';
import { PageHeader } from '../components/PageHeader';
import { selectCls, useFormat } from '../components/shared';
import type { Money } from '../components/shared';
import { ORDERS_COUNT, SHOPME_DASHBOARD } from '../graphql';
import { useT } from '../i18n';
import type { Key } from '../i18n';
import { useShop } from '../session';

interface Dash { totalSales: Money; ordersCount: number; averageOrderValue: Money; salesByDay: Array<{ date: string; sales: { amount: string } }>; topProducts: Array<{ title: string; quantity: number }> }
const RANGES = ['TODAY', 'LAST_7_DAYS', 'LAST_30_DAYS'];

/** Dependency-free bar chart. Bars have text alternatives through <title>. */
export function SalesChart({ data, label, format }: { data: Array<{ date: string; total: number }>; label: string; format: (n: number) => string }) {
  const W = 600, H = 160, pad = 4;
  const max = Math.max(1, ...data.map((d) => d.total));
  const bw = data.length ? (W - pad * 2) / data.length : 0;
  return (
    <svg viewBox={`0 0 ${W} ${H + 18}`} role="img" aria-label={label} className="w-full">
      <line x1="0" x2={W} y1={H} y2={H} stroke="var(--color-border)" />
      {data.map((d, i) => {
        const h = (d.total / max) * (H - 8);
        return (
          <g key={d.date}>
            <rect x={pad + i * bw + 1} y={H - h} width={Math.max(1, bw - 2)} height={h} rx="2" fill="var(--color-primary)"><title>{`${d.date}: ${format(d.total)}`}</title></rect>
            {(i === 0 || i === data.length - 1) && <text x={pad + i * bw + bw / 2} y={H + 13} fontSize="10" textAnchor={i === 0 ? 'start' : 'end'} fill="var(--color-text-muted)">{d.date.slice(5)}</text>}
          </g>
        );
      })}
    </svg>
  );
}

export function HomePage() {
  const t = useT();
  const fmt = useFormat();
  const { shop, user } = useShop();
  const nav = useNavigate();
  const toProcess = useQuery({ queryKey: ['orders-count', 'to-process'], queryFn: () => gql<{ ordersCount: { count: number } }>(ORDERS_COUNT, { query: 'fulfillment_status:unfulfilled status:open' }) });
  const [range, setRange] = useState('LAST_7_DAYS');
  const q = useQuery({ queryKey: ['dashboard', range], queryFn: () => gql<{ shopmeDashboard: Dash }>(SHOPME_DASHBOARD, { range }) });
  const d = q.data?.shopmeDashboard;
  const kpi = (label: string, value: string) => <Card key={label} title={label}><p className="text-2xl font-semibold">{q.isLoading ? <Skeleton className="h-8 w-24" /> : value}</p></Card>;
  const series = (d?.salesByDay ?? []).map((x) => ({ date: x.date, total: Number(x.sales.amount) }));
  const maxQty = Math.max(1, ...(d?.topProducts ?? []).map((p) => p.quantity));
  const link = 'inline-flex items-center gap-2 field-control font-medium hover:bg-surface';

  return (
    <>
      <PageHeader title={t('home.welcome', { name: user.firstName || shop.name })}
        actions={<select aria-label={t('home.range')} value={range} onChange={(e) => setRange(e.target.value)} className={selectCls}>{RANGES.map((r) => <option key={r} value={r}>{t(`home.range.${r}` as Key)}</option>)}</select>} />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <a href="/" target="_blank" rel="noreferrer" className="btn btn-primary"><ExternalLink className="size-4" />{t('store.view')}</a>
        <Button onClick={() => nav('/orders?tab=unfulfilled')}>{t('home.processOrders')}{toProcess.data && <Badge tone={toProcess.data.ordersCount.count ? 'attention' : 'neutral'}>{toProcess.data.ordersCount.count}</Badge>}</Button>
      </div>
      {q.isError && <div className="mb-4"><Banner>{(q.error as Error).message}</Banner></div>}
      <div className="grid gap-4 sm:grid-cols-3">
        {kpi(t('home.sales'), fmt.money(d?.totalSales))}
        {kpi(t('home.orders'), String(d?.ordersCount ?? '—'))}
        {kpi(t('home.aov'), fmt.money(d?.averageOrderValue))}
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_20rem]">
        <Card title={t('home.salesByDay')} actions={<Link to="/analytics/SALES_OVER_TIME" className="text-[13px] text-primary underline">{t('analytics.viewReports')}</Link>}>
          {series.length ? <SalesChart data={series} label={t('home.salesByDay')} format={(n) => fmt.money({ amount: String(n), currencyCode: shop.currency })} /> : <p className="py-8 text-center text-[13px] text-muted">{t('home.noSales')}</p>}
        </Card>
        <Card title={t('home.topProducts')}>
          {(d?.topProducts.length ?? 0) === 0 ? <p className="text-[13px] text-muted">{t('home.noSales')}</p> : (
            <ul className="flex flex-col gap-2">
              {d!.topProducts.map((p) => (
                <li key={p.title} className="text-[13px]"><div className="flex justify-between gap-2"><span className="truncate">{p.title}</span><span className="text-muted">{p.quantity}</span></div>
                  <div className="mt-1 h-1.5 rounded-full bg-surface"><div className="h-1.5 rounded-full bg-primary" style={{ width: `${(p.quantity / maxQty) * 100}%` }} /></div></li>
              ))}
            </ul>
          )}
        </Card>
      </div>
      <Card className="mt-4" title={t('home.quickLinks')}>
        <div className="flex flex-wrap gap-2">
          <Link to="/products/new" className={link}><Package className="size-4" />{t('products.add')}</Link>
          <Link to="/orders" className={link}><ShoppingCart className="size-4" />{t('home.viewOrders')}</Link>
          <Link to="/analytics" className={link}><BarChart3 className="size-4" />{t('analytics.viewReports')}</Link>
        </div>
      </Card>
      <h2 className="mb-2 mt-6 text-[13px] font-semibold">{t('home.nextSteps')}</h2>
      <div className="grid gap-4 sm:grid-cols-3">
        {([['/settings/payments', CreditCard, 'home.setupPayments'], ['/settings/domains', Globe, 'home.setupDomain'], ['/settings/policies', ScrollText, 'home.setupPolicies']] as const).map(([to, Icon, key]) => (
          <Link key={to} to={to} className="flex flex-col gap-1 rounded-lg border border-line bg-canvas p-4 hover:bg-surface">
            <Icon className="size-5 text-accent" aria-hidden /><span className="text-[13px] font-semibold">{t(key)}</span><span className="text-xs text-muted">{t(`${key}.body` as Key)}</span>
          </Link>
        ))}
      </div>
    </>
  );
}
