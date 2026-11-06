import { Banner, Card, ConfirmDialog, Skeleton, useToast } from '@shopme/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BarChart3, Lock, Megaphone, Package, Rocket, Search, ShoppingCart } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { apiUrl, gql, mutate } from '../api';
import { selectCls, useFormat } from '../components/shared';
import type { Money } from '../components/shared';
import { DELIVERY_PROFILES, HOME_THEMES, MARKETING_PAGE, ORDERS_COUNT, PAYMENT_SETTINGS, PRODUCTS_COUNT, SHOPME_DASHBOARD, STORE_ACCESS_UPDATE } from '../graphql';
import { useT } from '../i18n';
import type { Key } from '../i18n';
import { useStoreInfo } from '../lib/storeInfo';
import { EmailBanner } from '../components/EmailSetup';
import { DottedGlobe } from '../components/home/Globe';
import { KpiBar } from '../components/home/KpiBar';
import { SetupGuide } from '../components/home/SetupGuide';
import { OffsiteAlertBanner } from '../components/OffsiteBackup';
import { fetchEmailHealth } from '../lib/emailApi';
import { detectTasks, greetingPart } from '../lib/home';
import { offsiteApi } from '../lib/offsiteApi';
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

/** Current time, refreshed every minute, so the greeting follows the day. */
function useNow(everyMs = 60_000) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const id = setInterval(() => setNow(new Date()), everyMs); return () => clearInterval(id); }, [everyMs]);
  return now;
}

export function HomePage() {
  const t = useT();
  const fmt = useFormat();
  const { shop, user } = useShop();
  const nav = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();
  const store = useStoreInfo();
  const now = useNow();
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

  // Setup guide: every task is read from the store's own data. A query that fails leaves its task pending.
  const pay = useQuery({ queryKey: ['home-payments'], retry: false, queryFn: () => gql<{ shopmePaymentSettings: { bankTransfer: { enabled: boolean }; cod: { enabled: boolean }; stripe: { enabled: boolean; stripeConfigured: boolean } } }>(PAYMENT_SETTINGS) });
  const mail = useQuery({ queryKey: ['email-health'], retry: false, staleTime: 60_000, queryFn: fetchEmailHealth });
  const products = useQuery({ queryKey: ['home-products-count'], retry: false, staleTime: 30_000, queryFn: () => gql<{ productsCount: { count: number } }>(PRODUCTS_COUNT, {}) });
  const shipping = useQuery({ queryKey: ['home-delivery-profiles'], retry: false, staleTime: 30_000, queryFn: () => gql<{ deliveryProfiles: { nodes: Array<{ activeMethodDefinitionsCount: number }> } }>(DELIVERY_PROFILES) });
  const themes = useQuery({ queryKey: ['home-themes'], retry: false, staleTime: 30_000, queryFn: () => gql<{ themes: { nodes: Array<{ role: string; createdAt: string; updatedAt: string }> } }>(HOME_THEMES) });
  const offsite = useQuery({ queryKey: ['home-offsite'], retry: false, staleTime: 60_000, queryFn: () => offsiteApi('store').overview() });
  const p = pay.data?.shopmePaymentSettings;
  const settled = store.loaded && [pay, mail, products, shipping, themes, offsite].every((x) => !x.isPending);
  const done = useMemo(() => detectTasks({
    passwordProtected: store.loaded ? store.passwordProtected : undefined,
    payments: p && { bankTransfer: p.bankTransfer.enabled, cod: p.cod.enabled, stripe: p.stripe.enabled, stripeConfigured: p.stripe.stripeConfigured },
    customDomain: store.loaded ? store.customDomain : undefined,
    emailDone: mail.data?.done,
    productCount: products.data?.productsCount.count,
    theme: themes.data?.themes.nodes.find((x) => x.role === 'MAIN') ?? null,
    shippingMethods: shipping.data?.deliveryProfiles.nodes.reduce((n, x) => n + x.activeMethodDefinitionsCount, 0),
    offsite: offsite.data?.destination,
  }), [store.loaded, store.passwordProtected, store.customDomain, p, mail.data, products.data, themes.data, shipping.data, offsite.data]);

  const [range, setRange] = useState('LAST_7_DAYS');
  const q = useQuery({ queryKey: ['dashboard', range], queryFn: () => gql<{ shopmeDashboard: Dash }>(SHOPME_DASHBOARD, { range }) });
  const d = q.data?.shopmeDashboard;
  const series = (d?.salesByDay ?? []).map((x) => ({ date: x.date, total: Number(x.sales.amount) }));
  const maxQty = Math.max(1, ...(d?.topProducts ?? []).map((p) => p.quantity));
  const link = 'inline-flex items-center gap-2 field-control font-medium hover:bg-surface';
  const prot = store.passwordProtected;
  const launch = 'btn btn-primary !rounded-full';
  const pill = 'inline-flex h-9 items-center gap-2 rounded-full border border-line bg-canvas px-4 text-[13px] font-medium shadow-card hover:bg-hover';
  const toDo = toProcess.data?.ordersCount.count ?? 0;

  return (
    <div className="mx-auto max-w-[1100px]">
      <KpiBar currency={shop.currency} timezone={shop.timezone} />
      <OffsiteAlertBanner link /><EmailBanner />

      <section className="relative isolate overflow-x-clip py-6 sm:py-10" aria-labelledby="home-greeting">
        <DottedGlobe className="pointer-events-none absolute -right-24 top-1/2 -z-10 aspect-square w-[360px] -translate-y-1/2 text-muted opacity-40 sm:-right-10 sm:w-[500px] lg:w-[560px]" />
        <h1 id="home-greeting" className="max-w-[560px] text-[28px] font-semibold leading-tight tracking-tight sm:text-[34px]">{user.firstName ? t(`hm.greet.${greetingPart(now, shop.timezone)}` as Key, { name: user.firstName }) : t(`hm.greet.${greetingPart(now, shop.timezone)}.plain` as Key)}</h1>
        <p className="mt-2 max-w-[520px] text-lg text-muted sm:text-xl">{t('hm.greet.sub')}</p>
        <div className="mt-6 flex flex-wrap items-center gap-2">
          {toDo > 0 && <button type="button" className={pill} onClick={() => nav('/orders?tab=unfulfilled')}>{t('hm.processOrders')}<span className="rounded-md bg-surface px-1.5 text-xs tabular-nums">{toDo}</span></button>}
          <button type="button" onClick={openPalette} aria-label={t('home.searchLabel')} aria-keyshortcuts="Control+K Meta+K" className={`${pill} min-w-0 text-muted`}>
            <Search className="size-4 shrink-0" aria-hidden /><span className="truncate">{t('home.search')}</span><kbd className="hidden rounded bg-surface sm:inline px-1.5 py-0.5 text-[11px] font-medium">Ctrl K</kbd>
          </button>
        </div>
      </section>

      {settled ? <SetupGuide done={done} onLaunch={() => setLaunching(true)} launchable={prot} /> : <Skeleton className="mt-8 h-64 w-full rounded-2xl" />}

      <div className="mt-10 flex flex-col gap-4">
        <Card title={t('hm.store.title')}>
          <div className="flex flex-col items-center gap-5 sm:flex-row sm:justify-center sm:gap-10">
            <StorePreview protectedStore={prot} />
            <div className="flex flex-col items-center gap-3 sm:items-start">
              <span className="inline-flex h-7 items-center gap-2 rounded-full bg-surface px-3 text-[13px]" role="status">
                <span className={`size-2 rounded-full ${prot ? 'bg-[#e0a100]' : 'bg-[#2ea44f]'}`} aria-hidden />{t(prot ? 'home.status.protected' : 'home.status.online')}
              </span>
              <p className="text-[13px] text-muted"><span className="font-medium">{shop.name}</span> {t(prot ? 'home.headline.protected' : 'home.headline.online')}</p>
              {prot
                ? <button type="button" className={launch} onClick={() => setLaunching(true)}><Rocket className="size-4" />{t('home.launch')}</button>
                : <a href={store.url || '/'} target="_blank" rel="noreferrer" className={launch}><Rocket className="size-4" />{t('home.viewStore')}</a>}
            </div>
          </div>
        </Card>

        <div className="flex flex-wrap items-center gap-2">
          <h2 className="min-w-0 flex-1 truncate text-lg font-semibold">{t('hm.overview')}</h2>
          <select aria-label={t('home.range')} value={range} onChange={(e) => setRange(e.target.value)} className={selectCls}>{RANGES.map((r) => <option key={r} value={r}>{t(`home.range.${r}` as Key)}</option>)}</select>
        </div>
        {q.isError && <Banner>{(q.error as Error).message}</Banner>}
        <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
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
        <Card title={t('btn.home.growth')} actions={<Link to="/marketing" className="text-[13px] text-accent underline">{t('btn.home.growthOpen')}</Link>}>
          <div className="flex items-center gap-3 text-[13px]">
            <Megaphone className="size-5 text-muted" aria-hidden />
            <p className="text-muted">{growth.data ? t('btn.home.growthSummary', { campaigns: growth.data.shopmeMarketingCampaigns.filter((c) => c.status === 'ACTIVE').length, orders: growth.data.shopmeAttribution.attributedOrders }) : t('btn.home.growthBody')}</p>
          </div>
        </Card>
        <Card title={t('home.quickLinks')}>
          <div className="flex flex-wrap gap-2">
            <Link to="/products/new" className={link}><Package className="size-4" />{t('products.add')}</Link>
            <Link to="/orders" className={link}><ShoppingCart className="size-4" />{t('home.viewOrders')}</Link>
            <Link to="/analytics" className={link}><BarChart3 className="size-4" />{t('analytics.viewReports')}</Link>
          </div>
        </Card>
      </div>
      <ConfirmDialog open={launching} loading={launch_.isPending} onClose={() => setLaunching(false)} closeLabel={t('common.close')} title={t('btn.home.launchTitle')}
        message={t('btn.home.launchBody')} confirmLabel={t('home.launch')} cancelLabel={t('common.cancel')} onConfirm={() => launch_.mutate()} />
    </div>
  );
}
