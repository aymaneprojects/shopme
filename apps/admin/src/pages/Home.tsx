import { Badge, Banner, Button, Card, ConfirmDialog, Skeleton, useToast } from '@shopme/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BarChart3, Check, Lock, Megaphone, Package, Rocket, Search, ShoppingCart } from 'lucide-react';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { Link, useNavigate } from 'react-router';
import { apiUrl, gql, mutate } from '../api';
import { selectCls, useFormat } from '../components/shared';
import type { Money } from '../components/shared';
import { MARKETING_PAGE, ORDERS_COUNT, PAYMENT_SETTINGS, SHOPME_DASHBOARD, SHOP_POLICIES, STORE_ACCESS_UPDATE } from '../graphql';
import { useT } from '../i18n';
import type { Key } from '../i18n';
import { useStoreInfo } from '../lib/storeInfo';
import { useMulti, useShop } from '../session';

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

/** Opens the Ctrl/Cmd+K command palette mounted in the shell. */
export const openPalette = () => window.dispatchEvent(new Event('shopme:open-palette'));

/** Scaled, non-interactive thumbnail of the live storefront home (same origin, sandboxed: no scripts). */
function StorePreview({ protectedStore }: { protectedStore: boolean }) {
  const t = useT();
  // The page is fetched and its scripts removed before it goes into the frame: a sandboxed frame that still holds scripts logs a console error for each of them.
  const multi = useMulti();
  const page = useQuery({ queryKey: ['store-preview'], staleTime: 60_000, retry: false, queryFn: async () => {
    // Multi-store: the storefront lives on the store's own host; the admin API renders its home page for the thumbnail.
    const html = await (await fetch(multi ? apiUrl('/store/home-preview') : '/', { credentials: 'same-origin' })).text();
    const page = html.replace(/<script\b[\s\S]*?<\/script>/gi, '');
    return multi ? page : page.replace(/<head([^>]*)>/i, '<head$1><base href="/">');
  } });
  return (
    <div className="relative mx-auto h-[184px] w-[290px] overflow-hidden rounded-xl bg-canvas shadow-card ring-1 ring-line" role="img" aria-label={t('home.preview.label')}>
      <iframe srcDoc={page.data} title={t('home.preview.label')} sandbox="" tabIndex={-1} aria-hidden loading="lazy" className="pointer-events-none origin-top-left border-0 bg-white"
        style={{ width: 1280, height: 800, transform: 'scale(0.2266)' }} />
      <span className="absolute bottom-2 left-2 inline-flex items-center gap-1 rounded-lg bg-ink/75 px-2 py-1 text-xs font-semibold text-white">
        {protectedStore ? <Lock className="size-3" aria-hidden /> : <span className="size-1.5 rounded-full bg-[#4ade80]" aria-hidden />}
        {t(protectedStore ? 'home.preview.private' : 'home.preview.online')}
      </span>
    </div>
  );
}

const ART = { card: 'var(--color-bg)', line: 'var(--color-border)', main: 'var(--color-primary)', sub: 'var(--color-primary-subtle)' };
/** Own illustrations: simple shapes in the admin palette. */
function PaymentArt() {
  return (
    <svg viewBox="0 0 240 120" className="h-full w-full" aria-hidden>
      <rect x="62" y="26" width="116" height="72" rx="10" fill={ART.card} stroke={ART.line} strokeWidth="1.5" />
      <rect x="62" y="40" width="116" height="16" fill={ART.main} opacity=".85" />
      <rect x="76" y="72" width="40" height="6" rx="3" fill={ART.line} /><rect x="76" y="84" width="24" height="6" rx="3" fill={ART.line} />
      <circle cx="152" cy="80" r="10" fill={ART.sub} stroke={ART.main} strokeWidth="1.5" /><path d="m147.5 80 3 3 5-6" fill="none" stroke={ART.main} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function DomainArt() {
  return (
    <svg viewBox="0 0 240 120" className="h-full w-full" aria-hidden>
      <rect x="34" y="40" width="172" height="40" rx="20" fill={ART.card} stroke={ART.line} strokeWidth="1.5" />
      <circle cx="56" cy="60" r="8" fill={ART.sub} stroke={ART.main} strokeWidth="1.5" /><path d="M48 60h16M56 52c-4 5-4 11 0 16M56 52c4 5 4 11 0 16" fill="none" stroke={ART.main} strokeWidth="1.2" />
      <rect x="72" y="56" width="86" height="8" rx="4" fill={ART.line} />
      <text x="166" y="64" fontSize="13" fontWeight="600" fill={ART.main} fontFamily="inherit">.com</text>
      <path d="m184 74 12 26 4-10 10-4z" fill={ART.main} stroke={ART.card} strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}
function PolicyArt() {
  return (
    <svg viewBox="0 0 240 120" className="h-full w-full" aria-hidden>
      <rect x="82" y="18" width="84" height="88" rx="8" fill={ART.card} stroke={ART.line} strokeWidth="1.5" transform="rotate(-6 124 62)" />
      <rect x="74" y="14" width="84" height="88" rx="8" fill={ART.card} stroke={ART.line} strokeWidth="1.5" />
      <rect x="86" y="50" width="48" height="5" rx="2.5" fill={ART.line} /><rect x="86" y="62" width="60" height="5" rx="2.5" fill={ART.line} /><rect x="86" y="74" width="36" height="5" rx="2.5" fill={ART.line} />
      <path d="M116 22l14 5v10c0 9-6 15-14 18-8-3-14-9-14-18V27z" fill={ART.main} /><path d="m110 38 4 4 7-8" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function StepCard({ to, art, title, body, done }: { to: string; art: ReactNode; title: string; body: string; done: boolean }) {
  const t = useT();
  return (
    <Link to={to} className="group flex flex-col gap-3 rounded-2xl border border-line bg-canvas p-2 shadow-card transition-colors hover:bg-surface">
      <div className={`grid h-[110px] place-items-center overflow-hidden rounded-xl bg-surface ${done ? 'opacity-60' : ''}`}>{art}</div>
      <div className="flex flex-col gap-1 px-2 pb-2">
        <span className="flex items-center gap-2 text-[13px] font-semibold">{title}{done && <Badge tone="success"><Check className="size-3" aria-hidden />{t('home.card.done')}</Badge>}</span>
        <span className="text-[13px] leading-5 text-muted">{body}</span>
      </div>
    </Link>
  );
}

export function HomePage() {
  const t = useT();
  const fmt = useFormat();
  const { shop, user } = useShop();
  const nav = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();
  const store = useStoreInfo();
  const [launching, setLaunching] = useState(false);
  const launch_ = useMutation({
    mutationFn: () => mutate(STORE_ACCESS_UPDATE, { input: { storefrontPasswordEnabled: false } }, 'shopmeShopUpdate'),
    onSuccess: () => { setLaunching(false); toast(t('btn.home.launched')); void qc.invalidateQueries({ queryKey: ['store-info'] }); }, onError: (e) => { setLaunching(false); toast(e.message, 'critical'); },
  });
  const growth = useQuery({
    queryKey: ['home-growth'], retry: false, staleTime: 60_000,
    queryFn: () => gql<{ shopmeMarketingCampaigns: Array<{ status: string }>; shopmeAttribution: { attributedOrders: number; totalOrders: number } }>(MARKETING_PAGE, { from: new Date(Date.now() - 30 * 86_400_000).toISOString(), to: new Date(Date.now() + 86_400_000).toISOString() }),
  });
  const toProcess = useQuery({ queryKey: ['orders-count', 'to-process'], queryFn: () => gql<{ ordersCount: { count: number } }>(ORDERS_COUNT, { query: 'fulfillment_status:unfulfilled status:open' }) });
  const pay = useQuery({ queryKey: ['home-payments'], retry: false, queryFn: () => gql<{ shopmePaymentSettings: { bankTransfer: { enabled: boolean }; cod: { enabled: boolean }; stripe: { enabled: boolean; stripeConfigured: boolean } } }>(PAYMENT_SETTINGS) });
  const pol = useQuery({ queryKey: ['home-policies'], retry: false, queryFn: () => gql<{ shop: { shopPolicies: Array<{ body: string }> } }>(SHOP_POLICIES) });
  const p = pay.data?.shopmePaymentSettings;
  const steps = [
    { to: '/settings/payments', art: <PaymentArt />, title: t('home.setupPayments'), body: t('home.setupPayments.body'), done: !!p && (p.bankTransfer.enabled || p.cod.enabled || (p.stripe.enabled && p.stripe.stripeConfigured)) },
    { to: '/settings/domains', art: <DomainArt />, title: t('home.setupDomain'), body: t('home.setupDomain.body'), done: store.customDomain },
    { to: '/settings/policies', art: <PolicyArt />, title: t('home.setupPolicies'), body: t('home.setupPolicies.body'), done: !!pol.data && pol.data.shop.shopPolicies.some((x) => x.body.trim() !== '') },
  ];
  const [range, setRange] = useState('LAST_7_DAYS');
  const q = useQuery({ queryKey: ['dashboard', range], queryFn: () => gql<{ shopmeDashboard: Dash }>(SHOPME_DASHBOARD, { range }) });
  const d = q.data?.shopmeDashboard;
  const kpi = (label: string, value: string) => <Card key={label} title={label}><p className="text-2xl font-semibold">{q.isLoading ? <Skeleton className="h-8 w-24" /> : value}</p></Card>;
  const series = (d?.salesByDay ?? []).map((x) => ({ date: x.date, total: Number(x.sales.amount) }));
  const maxQty = Math.max(1, ...(d?.topProducts ?? []).map((p) => p.quantity));
  const link = 'inline-flex items-center gap-2 field-control font-medium hover:bg-surface';
  const prot = store.passwordProtected;
  const launch = 'btn btn-primary mt-2 w-[290px] justify-center !rounded-full';

  return (
    <>
      <div className="mx-auto flex max-w-[860px] flex-col items-center">
        <div className="mb-6 self-start">
          <span className="inline-flex h-7 items-center gap-2 rounded-full bg-canvas px-3 text-[13px] shadow-card" role="status">
            <span className={`size-2 rounded-full ${prot ? 'bg-[#e0a100]' : 'bg-[#2ea44f]'}`} aria-hidden />{t(prot ? 'home.status.protected' : 'home.status.online')}
          </span>
        </div>
        <StorePreview protectedStore={prot} />
        {prot
          ? <button type="button" className={launch} onClick={() => setLaunching(true)}><Rocket className="size-4" />{t('home.launch')}</button>
          : <a href={store.url || '/'} target="_blank" rel="noreferrer" className={launch}><Rocket className="size-4" />{t('home.viewStore')}</a>}
        <h1 className="mt-8 text-center text-[26px] font-medium leading-9">
          <span className="underline decoration-dotted decoration-1 underline-offset-4">{shop.name}</span><br />{t(prot ? 'home.headline.protected' : 'home.headline.online')}<br />{t('home.question')}
        </h1>
        <button type="button" onClick={openPalette} aria-label={t('home.searchLabel')} aria-keyshortcuts="Control+K Meta+K"
          className="mt-6 flex h-[88px] w-full max-w-[560px] flex-col justify-between rounded-3xl bg-canvas px-4 py-3 text-left shadow-card ring-1 ring-line hover:ring-primary">
          <span className="text-sm text-muted">{t('home.search')}</span>
          <span className="flex items-center justify-between text-muted"><Search className="size-4" aria-hidden /><kbd className="rounded bg-surface px-1.5 py-0.5 text-[11px] font-medium">Ctrl K</kbd></span>
        </button>
        <Button className="mt-5 !rounded-full" onClick={() => nav('/orders?tab=unfulfilled')}>{t('home.processOrders')}{toProcess.data && <Badge tone={toProcess.data.ordersCount.count ? 'attention' : 'neutral'}>{toProcess.data.ordersCount.count}</Badge>}</Button>
      </div>
      {steps.some((s) => !s.done) && (
        <div className="mx-auto mt-12 grid max-w-[860px] gap-4 sm:grid-cols-3" aria-label={t('home.nextSteps')}>
          {steps.map((s) => <StepCard key={s.to} {...s} />)}
        </div>
      )}
      <div className="mt-12">
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <h2 className="min-w-0 flex-1 truncate text-lg font-semibold">{t('home.welcome', { name: user.firstName || shop.name })}</h2>
          <select aria-label={t('home.range')} value={range} onChange={(e) => setRange(e.target.value)} className={selectCls}>{RANGES.map((r) => <option key={r} value={r}>{t(`home.range.${r}` as Key)}</option>)}</select>
        </div>
        {q.isError && <div className="mb-4"><Banner>{(q.error as Error).message}</Banner></div>}
        <div className="grid gap-4 sm:grid-cols-3">
          {kpi(t('home.sales'), fmt.money(d?.totalSales))}
          {kpi(t('home.orders'), String(d?.ordersCount ?? '—'))}
          {kpi(t('home.aov'), fmt.money(d?.averageOrderValue))}
        </div>
        <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_20rem]">
          <Card title={t('home.salesByDay')} actions={<Link to="/analytics/SALES_OVER_TIME" className="text-[13px] text-accent underline">{t('analytics.viewReports')}</Link>}>
            {series.length ? <SalesChart data={series} label={t('home.salesByDay')} format={(n) => fmt.money({ amount: String(n), currencyCode: shop.currency })} /> : <p className="py-8 text-center text-[13px] text-muted">{t('home.noSales')}</p>}
          </Card>
          <Card title={t('home.topProducts')}>
            {(d?.topProducts.length ?? 0) === 0 ? <p className="text-[13px] text-muted">{t('home.noSales')}</p> : (
              <ul className="flex flex-col gap-2">
                {d!.topProducts.map((x) => (
                  <li key={x.title} className="text-[13px]"><div className="flex justify-between gap-2"><span className="truncate">{x.title}</span><span className="text-muted">{x.quantity}</span></div>
                    <div className="mt-1 h-1.5 rounded-full bg-surface"><div className="h-1.5 rounded-full bg-primary" style={{ width: `${(x.quantity / maxQty) * 100}%` }} /></div></li>
                ))}
              </ul>
            )}
          </Card>
        </div>
        <Card className="mt-4" title={t('btn.home.growth')} actions={<Link to="/marketing" className="text-[13px] text-accent underline">{t('btn.home.growthOpen')}</Link>}>
          <div className="flex items-center gap-3 text-[13px]">
            <Megaphone className="size-5 text-muted" aria-hidden />
            <p className="text-muted">{growth.data ? t('btn.home.growthSummary', { campaigns: growth.data.shopmeMarketingCampaigns.filter((c) => c.status === 'ACTIVE').length, orders: growth.data.shopmeAttribution.attributedOrders }) : t('btn.home.growthBody')}</p>
          </div>
        </Card>
        <Card className="mt-4" title={t('home.quickLinks')}>
          <div className="flex flex-wrap gap-2">
            <Link to="/products/new" className={link}><Package className="size-4" />{t('products.add')}</Link>
            <Link to="/orders" className={link}><ShoppingCart className="size-4" />{t('home.viewOrders')}</Link>
            <Link to="/analytics" className={link}><BarChart3 className="size-4" />{t('analytics.viewReports')}</Link>
          </div>
        </Card>
      </div>
    <ConfirmDialog open={launching} loading={launch_.isPending} onClose={() => setLaunching(false)} closeLabel={t('common.close')} title={t('btn.home.launchTitle')}
        message={t('btn.home.launchBody')} confirmLabel={t('home.launch')} cancelLabel={t('common.cancel')} onConfirm={() => launch_.mutate()} />
    </>
  );
}
