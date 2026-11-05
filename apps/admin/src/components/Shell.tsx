import { Dropdown, Skeleton, cx, useToast } from '@shopme/ui';
import { BarChart3, Check, Gift, Repeat, ShoppingBasket, Home, Monitor, Moon, Sun, Languages, LogOut, Menu, Percent, Search, Settings, ShoppingCart, Store, Tag, Users, Warehouse, FolderTree, FilePlus2, ArrowLeft, FileText, CircleHelp, Copy, ExternalLink, MoreHorizontal, PanelLeft, ClipboardList, ArrowLeftRight, Boxes, Building2, Activity, Globe, BookOpen, Megaphone, Truck, ChevronRight } from 'lucide-react';
import { Suspense, useEffect, useRef, useState } from 'react';
import type { ComponentType, ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { gql } from '../api';
import { ORDERS_COUNT } from '../graphql';
import { NavLink, Outlet, useLocation } from 'react-router';
import { LANGS, useI18n } from '../i18n';
import type { Key } from '../i18n';
import { getTheme, setTheme } from '../lib/theme';
import { useStoreInfo } from '../lib/storeInfo';
import type { Theme } from '../lib/theme';
import { NAV_PERMISSION, useStaffAccess } from '../lib/permissions';
import { SETTINGS_SECTIONS } from '../lib/settingsNav';
import { useSession, useShop } from '../session';
import { ActivityBell } from './ActivityBell';
import { CommandPalette } from './CommandPalette';
import { LearnMore } from './LearnMore';

interface NavItem { id: string; labelKey: Key; to: string; icon: ComponentType<{ className?: string }>; end?: boolean; children?: NavItem[] }

// Data-driven so later items can be gated by a feature flag instead of removed.
export const NAV: NavItem[] = [
  { id: 'home', labelKey: 'nav.home', to: '/', icon: Home, end: true },
  { id: 'orders', labelKey: 'nav.orders', to: '/orders', icon: ShoppingCart, children: [{ id: 'drafts', labelKey: 'nav.drafts', to: '/orders/drafts', icon: FilePlus2 }, { id: 'abandoned', labelKey: 'nav.abandoned', to: '/orders/abandoned', icon: ShoppingBasket }, { id: 'shipping-labels', labelKey: 'nav.shippingLabels', to: '/orders/shipping-labels', icon: Truck }, { id: 'subscriptions', labelKey: 'nav.subscriptions', to: '/orders/subscriptions', icon: Repeat }] },
  {
    id: 'products', labelKey: 'nav.products', to: '/products', icon: Tag,
    children: [
      { id: 'collections', labelKey: 'nav.collections', to: '/collections', icon: FolderTree },
      { id: 'inventory', labelKey: 'nav.inventory', to: '/inventory', icon: Warehouse },
      { id: 'purchase-orders', labelKey: 'nav.purchaseOrders', to: '/purchase-orders', icon: ClipboardList },
      { id: 'transfers', labelKey: 'nav.transfers', to: '/transfers', icon: ArrowLeftRight },
      { id: 'gift-cards', labelKey: 'nav.giftCards', to: '/gift-cards', icon: Gift },
    ],
  },
  { id: 'customers', labelKey: 'nav.customers', to: '/customers', icon: Users, children: [{ id: 'segments', labelKey: 'nav.segments', to: '/customers/segments', icon: Users }, { id: 'companies', labelKey: 'bc.companies', to: '/customers/companies', icon: Building2 }] },
  { id: 'discounts', labelKey: 'nav.discounts', to: '/discounts', icon: Percent },
  { id: 'content', labelKey: 'nav.content', to: '/content', icon: Boxes, children: [
    { id: 'metaobjects', labelKey: 'nav.metaobjects', to: '/content/metaobjects', icon: Boxes },
    { id: 'content-files', labelKey: 'store.files', to: '/content/files', icon: FileText },
    { id: 'content-menus', labelKey: 'nav.contentMenus', to: '/content/navigation', icon: Menu },
    { id: 'content-blog-posts', labelKey: 'store.blogPosts', to: '/content/blog-posts', icon: FileText },
  ] },
  { id: 'markets', labelKey: 'nav.markets', to: '/markets', icon: Globe, children: [{ id: 'catalogs', labelKey: 'nav.catalogs', to: '/markets/catalogs', icon: BookOpen }] },
  { id: 'analytics', labelKey: 'nav.analytics', to: '/analytics', icon: BarChart3, children: [{ id: 'reports', labelKey: 'nav.reports', to: '/analytics/reports', icon: FileText }, { id: 'live-view', labelKey: 'bc.analytics.live', to: '/analytics/live', icon: Activity }] },
  { id: 'marketing', labelKey: 'nav.growth', to: '/marketing', icon: Megaphone },
  {
    id: 'online-store', labelKey: 'nav.onlineStore', to: '/online-store', icon: Store,
    children: [
      { id: 'themes', labelKey: 'nav.themes', to: '/online-store', icon: Store, end: true },
      { id: 'store-pages', labelKey: 'nav.storePages', to: '/online-store/pages', icon: FileText },
      { id: 'navigation', labelKey: 'nav.menus', to: '/online-store/navigation', icon: Menu },
      { id: 'blog-posts', labelKey: 'store.blogPosts', to: '/online-store/blog-posts', icon: FileText },
      { id: 'files', labelKey: 'store.files', to: '/online-store/files', icon: FileText },
      { id: 'preferences', labelKey: 'store.preferences', to: '/online-store/preferences', icon: Settings },
    ],
  },
  { id: 'settings', labelKey: 'nav.settings', to: '/settings', icon: Settings },
];
/** Items listed under the "Sales channels" label. */
const CHANNEL_IDS = ['online-store'];

/** Own logo mark: rounded square with a shopping bag. */
export function Logo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden>
      <rect width="32" height="32" rx="8" fill="#1A3591" />
      <path d="M9 12h14l-1.2 10H10.2z" fill="none" stroke="#fff" strokeWidth="2" strokeLinejoin="round" />
      <path d="M12.5 12a3.5 3.5 0 0 1 7 0" fill="none" stroke="#fff" strokeWidth="2" />
    </svg>
  );
}

/** "Learn more about ..." line under index pages and a few settings pages; each path maps to its topic. */
const LEARN_MORE: Array<[RegExp, Key]> = [
  [/^\/collections$/, 'btn.learn.collections'], [/^\/orders$/, 'btn.learn.orders'], [/^\/orders\/[^/]+\/refund$/, 'btn.learn.refunds'], [/^\/orders\/[^/]+\/edit$/, 'btn.learn.orderEdit'],
  [/^\/orders\/drafts$/, 'btn.learn.drafts'], [/^\/orders\/abandoned$/, 'btn.learn.abandoned'], [/^\/orders\/shipping-labels$/, 'btn.learn.labels'], [/^\/discounts$/, 'btn.learn.discounts'],
  [/^\/online-store\/pages$/, 'btn.learn.pages'], [/^\/settings\/users$/, 'btn.learn.users'], [/^\/settings\/policies$/, 'btn.learn.policies'], [/^\/settings\/payments$/, 'btn.learn.payments'],
  [/^\/settings\/shipping\/pickup$/, 'btn.learn.pickup'], [/^\/settings\/shipping\/local-delivery$/, 'btn.learn.localDelivery'], [/^\/settings\/taxes$/, 'btn.learn.taxes'],
  [/^\/settings\/domains$/, 'btn.learn.domains'], [/^\/settings\/languages$/, 'btn.learn.languages'], [/^\/settings\/events$/, 'btn.learn.events'],
];

/** Adds the docs link for the current page unless the page already shows its own (`LearnMore` marks itself with `data-learn-more="page"`). */
function ShellLearnMore({ pathname }: { pathname: string }) {
  const { t } = useI18n();
  const topic = LEARN_MORE.find(([re]) => re.test(pathname.replace(/\/$/, '') || '/'))?.[1];
  const [own, setOwn] = useState(false);
  useEffect(() => {
    const sheet = document.getElementById('sheet');
    if (!sheet) return;
    const check = () => setOwn(!!sheet.querySelector('[data-learn-more="page"]'));
    check();
    const obs = new MutationObserver(check);
    obs.observe(sheet, { childList: true, subtree: true });
    return () => obs.disconnect();
  }, [pathname]);
  if (!topic || own) return null;
  return <LearnMore topic={t(topic)} shell />;
}

/** Index pages span the whole sheet; detail and edit pages keep the narrower centred column. */
const WIDE_ROUTE = /^\/(products|collections|inventory|orders|orders\/drafts|orders\/abandoned|orders\/shipping-labels|orders\/subscriptions|marketing|customers|customers\/segments|discounts|gift-cards|markets|transfers|purchase-orders|content\/metaobjects|content\/entries)\/?$/;
const COLLAPSE_KEY = 'shopme.sidebar.collapsed';
const readCollapsed = () => { try { return localStorage.getItem(COLLAPSE_KEY) === '1'; } catch { return false; } };

const itemCls = (isActive: boolean, child: boolean, collapsed = false) => cx(
  'flex h-7 items-center gap-2 rounded-lg px-2 text-[13px] transition-colors',
  collapsed && 'justify-center',
  child && 'ml-7 text-frame-muted',
  isActive ? 'bg-frame-active font-semibold text-white' : 'text-frame-text hover:bg-frame-hover',
);

function NavLinks({ onNavigate, collapsed }: { onNavigate: () => void; collapsed: boolean }) {
  const { t } = useI18n();
  const can = useStaffAccess();
  const { pathname } = useLocation();
  const link = (item: NavItem, child = false, extra?: ReactNode) => (
    <NavLink key={item.id} to={item.to} end={item.end || !!item.children} onClick={onNavigate} title={collapsed ? t(item.labelKey) : undefined} aria-label={collapsed ? t(item.labelKey) : undefined} className={({ isActive }) => itemCls(isActive, child, collapsed)}>
      {!child && <item.icon className="size-4 shrink-0" />}
      {!collapsed && t(item.labelKey)}
      {extra}
    </NavLink>
  );
  const unfulfilled = useQuery({ queryKey: ['orders-count', 'nav-unfulfilled'], staleTime: 60_000, queryFn: () => gql<{ ordersCount: { count: number } }>(ORDERS_COUNT, { query: 'fulfillment_status:unfulfilled status:open' }) });
  const badge = (i: NavItem) => (i.id === 'orders' && !collapsed && (unfulfilled.data?.ordersCount.count ?? 0) > 0
    ? <span className="ml-auto grid min-w-5 place-items-center rounded-full bg-white/15 px-1.5 text-[11px] font-semibold text-white" aria-label={t('nav.unfulfilledBadge')}>{unfulfilled.data!.ordersCount.count}</span> : null);
  const group = (i: NavItem) => {
    const open = !collapsed && !!i.children && (pathname.startsWith(i.to) || i.children.some((c) => pathname.startsWith(c.to)));
    return (
      <div key={i.id} className={cx('contents', i.id === 'settings' && '[&>a]:mt-auto')}>
        {link(i, false, badge(i))}
        {open && <div className="anim-fade flex flex-col gap-0.5">{i.children!.map((c) => link(c, true))}</div>}
      </div>
    );
  };
  const items = NAV.filter((i) => can(NAV_PERMISSION[i.id]));
  const channels = items.filter((i) => CHANNEL_IDS.includes(i.id));
  return (
    <nav aria-label="Main" className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto">
      {items.filter((i) => !CHANNEL_IDS.includes(i.id) && i.id !== 'settings').map(group)}
      {channels.length > 0 && !collapsed && (
        <NavLink to="/channels" onClick={onNavigate} className={({ isActive }) => cx('mb-0.5 mt-3 flex items-center gap-0.5 rounded-lg px-2 py-0.5 text-xs font-medium hover:bg-frame-hover', isActive ? 'text-white' : 'text-frame-muted')}>
          {t('nav.salesChannels')}<ChevronRight className="size-3.5" aria-hidden />
        </NavLink>
      )}
      {channels.map(group)}
      {items.filter((i) => i.id === 'settings').map(group)}
    </nav>
  );
}

/** Settings mode: the sidebar swaps to the settings sections, with a way back, a search field and the store header. */
function SettingsNavLinks({ onNavigate, collapsed }: { onNavigate: () => void; collapsed: boolean }) {
  const { t } = useI18n();
  const can = useStaffAccess();
  const { shop } = useShop();
  const store = useStoreInfo();
  const toast = useToast();
  const [term, setTerm] = useState('');
  const needle = term.trim().toLocaleLowerCase();
  const sections = SETTINGS_SECTIONS.filter((s) => can(s.perm)).filter((s) => !needle || t(s.key).toLocaleLowerCase().includes(needle));
  const host = store.host || (typeof location === 'undefined' ? '' : location.host);
  const initial = (shop.name[0] ?? 'S').toUpperCase();
  const copy = () => { void navigator.clipboard?.writeText(store.url || location.origin).then(() => toast(t('settings.nav.copied'))).catch(() => undefined); };
  return (
    <nav aria-label={t('nav.settings')} className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto">
      <NavLink to="/" onClick={onNavigate} title={collapsed ? t('nav.settings') : undefined} aria-label={collapsed ? t('nav.settings') : undefined} className={cx('mb-2 flex h-8 items-center gap-2 rounded-lg px-2 text-[13px] font-semibold text-white hover:bg-frame-hover', collapsed && 'justify-center')}>
        <ArrowLeft className="size-4 shrink-0" />{!collapsed && t('nav.settings')}
      </NavLink>
      {!collapsed && (
        <>
          <label className="relative mb-2 block">
            <span className="sr-only">{t('settings.nav.search')}</span>
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-frame-muted" aria-hidden />
            <input type="search" value={term} onChange={(e) => setTerm(e.target.value)} placeholder={t('settings.nav.search')} autoComplete="off"
              className="h-8 w-full rounded-lg border-0 bg-white/10 pl-8 pr-2 text-[13px] text-white shadow-[inset_0_0_0_1px_rgb(255_255_255/0.08)] outline-none placeholder:text-frame-muted focus:bg-white/15 focus-visible:shadow-[0_0_0_2px_var(--color-focus-ring)]" />
          </label>
          <div className="mb-1 flex items-center gap-2 rounded-lg bg-white/10 py-1.5 pl-2 pr-1 shadow-[inset_0_0_0_1px_rgb(255_255_255/0.08)]">
            <span className="grid size-6 shrink-0 place-items-center rounded-md bg-primary-top text-xs font-semibold text-white" aria-hidden>{initial}</span>
            <span className="min-w-0 flex-1 leading-4"><span className="block truncate text-[13px] font-semibold text-white">{shop.name}</span><span className="block truncate text-[11px] text-frame-muted">{host}</span></span>
            <Dropdown align="right" icon variant="plain" label={t('settings.nav.storeMenu')} menuClassName="!text-fg" className="!size-6 !min-h-0 shrink-0 !text-frame-text hover:!bg-frame-hover" trigger={<MoreHorizontal className="size-4" />}
              items={[
                { key: 'view', label: t('settings.nav.viewStore'), icon: <ExternalLink className="size-4" />, onSelect: () => { window.open(store.url || '/', '_blank', 'noopener'); } },
                { key: 'copy', label: t('settings.nav.copyUrl'), icon: <Copy className="size-4" />, onSelect: copy },
              ]} />
          </div>
        </>
      )}
      {sections.map((s) => (
        <NavLink key={s.id} to={s.to ?? `/settings/${s.id}`} onClick={onNavigate} title={collapsed ? t(s.key) : undefined} aria-label={collapsed ? t(s.key) : undefined} className={({ isActive }) => cx('flex min-h-7 items-center gap-2 rounded-lg px-2 py-1 text-[13px] leading-4 transition-colors', collapsed && 'justify-center', isActive ? 'bg-frame-active font-semibold text-white' : 'text-frame-text hover:bg-frame-hover')}>
          <s.icon className="size-4 shrink-0" />{!collapsed && t(s.key)}
        </NavLink>
      ))}
      {sections.length === 0 && <p className="px-2 py-2 text-[13px] text-frame-muted">{t('settings.nav.empty')}</p>}
    </nav>
  );
}

export function PageFallback() {
  return (
    <div className="flex flex-col gap-4" role="status" aria-busy>
      <Skeleton className="h-7 w-48" />
      <div className="skeleton h-40 rounded-lg" /><div className="skeleton h-64 rounded-lg" />
    </div>
  );
}

/** Thin top progress bar flashed on every route change. */
function RouteProgress() {
  const { pathname } = useLocation();
  const [key, setKey] = useState<string | null>(null);
  useEffect(() => {
    setKey(pathname);
    const id = setTimeout(() => setKey(null), 550);
    return () => clearTimeout(id);
  }, [pathname]);
  return key ? <div className="route-progress" aria-hidden><span key={key} style={{ animationDuration: '550ms' }} /></div> : null;
}

/** Account menu at the bottom of the sidebar: the store, the signed-in user, language and theme, help and sign out. */
function AccountMenu({ collapsed, userBlock }: { collapsed: boolean; userBlock?: boolean }) {
  const { t, lang, setLang } = useI18n();
  const { logout } = useSession();
  const { shop, user } = useShop();
  const [open, setOpen] = useState(false);
  const [theme, setThemeState] = useState<Theme>(getTheme);
  const box = useRef<HTMLDivElement>(null);
  const pick = (v: Theme) => { setTheme(v); setThemeState(v); };
  const themes: Array<[Theme, string, ComponentType<{ className?: string }>]> = [['light', t('theme.light'), Sun], ['dark', t('theme.dark'), Moon], ['system', t('theme.system'), Monitor]];
  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOpen(false); box.current?.querySelector('button')?.focus(); } };
    document.addEventListener('mousedown', down); document.addEventListener('keydown', key);
    return () => { document.removeEventListener('mousedown', down); document.removeEventListener('keydown', key); };
  }, [open]);
  const initial = (shop.name[0] ?? 'S').toUpperCase();
  const row = 'flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-[13px] hover:bg-hover';
  return (
    <div ref={box} className="relative mt-2 flex items-center gap-1">
      <button type="button" aria-haspopup="menu" aria-expanded={open} aria-label={t('shell.account')} title={collapsed ? shop.name : undefined} onClick={() => setOpen(!open)}
        className={cx('flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2 text-[13px] text-frame-text hover:bg-frame-hover', userBlock && !collapsed ? 'h-10' : 'h-9', collapsed && 'justify-center')}>
        {userBlock && !collapsed
          ? <><span className="grid size-6 shrink-0 place-items-center rounded-md bg-primary-top text-[10px] font-semibold text-white">{(((user.firstName?.[0] ?? '') + (user.lastName?.[0] ?? '')) || (user.email[0] ?? 'U')).toUpperCase()}</span>
            <span className="min-w-0 flex-1 text-left leading-4"><span className="block truncate font-semibold text-white">{[user.firstName, user.lastName].filter(Boolean).join(' ') || user.email}</span><span className="block truncate text-[11px] text-frame-muted">{user.email}</span></span></>
          : <><span className="grid size-5 shrink-0 place-items-center rounded-md bg-primary text-[11px] font-semibold text-white">{initial}</span>
            {!collapsed && <span className="min-w-0 flex-1 truncate text-left">{shop.name}</span>}</>}
      </button>
      {!collapsed && <ActivityBell />}
      {open && (
        <div role="menu" aria-label={t('shell.account')} className="anim-fade absolute bottom-11 left-0 z-50 w-64 rounded-xl border border-line bg-canvas p-1.5 text-fg shadow-pop">
          <div role="menuitem" aria-current="true" className={cx(row, 'bg-hover')}>
            <span className="grid size-5 shrink-0 place-items-center rounded-md bg-primary text-[11px] font-semibold text-white">{initial}</span><span className="min-w-0 flex-1 truncate font-medium">{shop.name}</span><Check className="size-4" />
          </div>
          <div className="my-1.5 border-t border-line" />
          <div className="flex items-center gap-2.5 px-2 py-1.5 text-[13px]"><span className="grid size-5 shrink-0 place-items-center rounded-full bg-primary text-[10px] font-semibold text-on-primary">{(user.email[0] ?? 'U').toUpperCase()}</span><span className="min-w-0 flex-1 truncate">{user.email}</span></div>
          {LANGS.map((l) => <button key={l.id} type="button" role="menuitem" aria-current={lang === l.id} className={row} onClick={() => setLang(l.id)}><Languages className="size-4 text-muted" />{l.label}{lang === l.id && <Check className="ml-auto size-4" />}</button>)}
          {themes.map(([id, label, Icon]) => <button key={id} type="button" role="menuitem" aria-current={theme === id} className={row} onClick={() => pick(id)}><Icon className="size-4 text-muted" />{label}{theme === id && <Check className="ml-auto size-4" />}</button>)}
          <a role="menuitem" href="https://github.com/aymaneprojects/shopme#readme" target="_blank" rel="noreferrer" className={row}><CircleHelp className="size-4 text-muted" />{t('shell.help')}</a>
          <button type="button" role="menuitem" className={row} onClick={() => void logout()}><LogOut className="size-4 text-muted" />{t('shell.logout')}</button>
        </div>
      )}
    </div>
  );
}

export function Shell() {
  const { t } = useI18n();
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  const [palette, setPalette] = useState(false);
  const [collapsed, setCollapsedState] = useState(readCollapsed);
  const setCollapsed = (v: boolean) => { setCollapsedState(v); try { localStorage.setItem(COLLAPSE_KEY, v ? '1' : '0'); } catch { /* storage unavailable */ } };
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setPalette((p) => !p); }
    };
    const openIt = () => setPalette(true);
    window.addEventListener('keydown', h);
    window.addEventListener('shopme:open-palette', openIt);
    return () => { window.removeEventListener('keydown', h); window.removeEventListener('shopme:open-palette', openIt); };
  }, []);
  // The theme editor takes the whole window (no sidebar), like a full-screen workspace.
  if (/^\/online-store\/themes\/[^/]+\/editor/.test(pathname)) {
    return (
      <div className="h-screen overflow-y-auto bg-page p-3 text-fg" id="sheet">
        <RouteProgress />
        <div className="anim-view mx-auto max-w-[1500px]"><Suspense fallback={<PageFallback />}><Outlet /></Suspense></div>
        <CommandPalette open={palette} onClose={() => setPalette(false)} />
      </div>
    );
  }
  const inSettings = pathname.startsWith('/settings');
  const mac = typeof navigator !== 'undefined' && /mac|iphone|ipad/i.test(navigator.platform);
  return (
    <div className="flex h-screen flex-col bg-frame text-frame-text" style={collapsed ? ({ '--w-sidebar': '3.5rem' } as React.CSSProperties) : inSettings ? ({ '--w-sidebar': '16rem' } as React.CSSProperties) : undefined}>
      <RouteProgress />
      <header className="flex h-12 shrink-0 items-center gap-2 px-3">
        <button type="button" className="btn btn-plain btn-icon !text-frame-text hover:!bg-frame-hover md:hidden" aria-label={t('nav.menu')} onClick={() => setOpen(true)}><Menu className="size-5" /></button>
        <div className="flex items-center gap-2">
          <Logo className="size-6" />
          <span className="hidden text-[13px] font-semibold text-white sm:inline">ShopMe</span>
        </div>
        <button type="button" className="btn btn-plain btn-icon !hidden !text-frame-text hover:!bg-frame-hover md:!inline-flex" aria-label={collapsed ? t('shell.expand') : t('shell.collapse')} aria-pressed={collapsed} onClick={() => setCollapsed(!collapsed)}><PanelLeft className="size-[18px]" /></button>
              </header>
      <div className="flex min-h-0 flex-1">
        <aside className={cx('fixed inset-y-0 left-0 z-40 flex w-[var(--w-sidebar)] flex-col bg-frame px-2 pb-3 pt-14 transition-transform duration-200 ease-out md:static md:z-auto md:translate-x-0 md:pt-1', open ? 'translate-x-0' : '-translate-x-full')}>
          {!inSettings && <button type="button" onClick={() => { setOpen(false); setPalette(true); }} aria-label={t('shell.search')} aria-keyshortcuts="Control+K Meta+K" title={collapsed ? t('shell.search') : undefined}
            className={cx('mb-2 flex h-8 w-full items-center gap-2 rounded-lg bg-white/10 px-2.5 text-[13px] text-frame-muted shadow-[inset_0_0_0_1px_rgb(255_255_255/0.08)] hover:bg-white/15', collapsed && 'justify-center px-0')}>
            <Search className="size-4 shrink-0" />
            {!collapsed && <><span className="flex-1 text-left">{t('shell.searchPlaceholder')}</span><kbd className="rounded bg-white/10 px-1.5 py-0.5 text-[11px] font-medium">{mac ? '⌘' : 'Ctrl'} K</kbd></>}
          </button>}
          {inSettings ? <SettingsNavLinks onNavigate={() => setOpen(false)} collapsed={collapsed} /> : <NavLinks onNavigate={() => setOpen(false)} collapsed={collapsed} />}
          <AccountMenu collapsed={collapsed} userBlock={inSettings} />
        </aside>
        {open && <div className="anim-fade fixed inset-0 z-30 bg-black/50 md:hidden" onClick={() => setOpen(false)} aria-hidden />}
        <div className="mb-1 mr-1 min-w-0 flex-1 overflow-y-auto rounded-xl bg-page text-fg max-md:mx-1 md:ml-0" id="sheet">
          <main className={cx('mx-auto w-full p-4 md:px-5 md:py-5', WIDE_ROUTE.test(pathname) ? 'max-w-none md:px-3 md:py-3' : 'max-w-[1100px]')}>
            <div key={pathname.split('/').slice(0, 2).join('/')} className="anim-view"><Suspense fallback={<PageFallback />}><Outlet /></Suspense></div>
            <ShellLearnMore pathname={pathname} />
          </main>
        </div>
      </div>
      <CommandPalette open={palette} onClose={() => setPalette(false)} />
    </div>
  );
}
