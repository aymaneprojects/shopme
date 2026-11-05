import { Skeleton, cx } from '@shopme/ui';
import { BarChart3, Check, Gift, ShoppingBasket, Home, Monitor, Moon, Sun, Languages, LogOut, Menu, Percent, Search, Settings, ShoppingCart, Store, Tag, Users, Warehouse, FolderTree, FilePlus2, ArrowLeft, FileText, CircleHelp, PanelLeft } from 'lucide-react';
import { Suspense, useEffect, useRef, useState } from 'react';
import type { ComponentType } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router';
import { LANGS, useI18n } from '../i18n';
import type { Key } from '../i18n';
import { getTheme, setTheme } from '../lib/theme';
import type { Theme } from '../lib/theme';
import { NAV_PERMISSION, useStaffAccess } from '../lib/permissions';
import { SETTINGS_SECTIONS } from '../lib/settingsNav';
import { useSession, useShop } from '../session';
import { ActivityBell } from './ActivityBell';
import { CommandPalette } from './CommandPalette';

interface NavItem { id: string; labelKey: Key; to: string; icon: ComponentType<{ className?: string }>; end?: boolean; children?: NavItem[] }

// Data-driven so later items can be gated by a feature flag instead of removed.
export const NAV: NavItem[] = [
  { id: 'home', labelKey: 'nav.home', to: '/', icon: Home, end: true },
  { id: 'orders', labelKey: 'nav.orders', to: '/orders', icon: ShoppingCart, children: [{ id: 'drafts', labelKey: 'nav.drafts', to: '/orders/drafts', icon: FilePlus2 }, { id: 'abandoned', labelKey: 'nav.abandoned', to: '/orders/abandoned', icon: ShoppingBasket }] },
  {
    id: 'products', labelKey: 'nav.products', to: '/products', icon: Tag,
    children: [
      { id: 'collections', labelKey: 'nav.collections', to: '/collections', icon: FolderTree },
      { id: 'inventory', labelKey: 'nav.inventory', to: '/inventory', icon: Warehouse },
      { id: 'gift-cards', labelKey: 'nav.giftCards', to: '/gift-cards', icon: Gift },
    ],
  },
  { id: 'customers', labelKey: 'nav.customers', to: '/customers', icon: Users, children: [{ id: 'segments', labelKey: 'nav.segments', to: '/customers/segments', icon: Users }] },
  { id: 'analytics', labelKey: 'nav.analytics', to: '/analytics', icon: BarChart3, children: [{ id: 'reports', labelKey: 'nav.reports', to: '/analytics/reports', icon: FileText }] },
  { id: 'discounts', labelKey: 'nav.discounts', to: '/discounts', icon: Percent },
  { id: 'online-store', labelKey: 'nav.onlineStore', to: '/online-store', icon: Store },
  { id: 'settings', labelKey: 'nav.settings', to: '/settings', icon: Settings },
];

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
  const link = (item: NavItem, child = false) => (
    <NavLink key={item.id} to={item.to} end={item.end || !!item.children} onClick={onNavigate} title={collapsed ? t(item.labelKey) : undefined} aria-label={collapsed ? t(item.labelKey) : undefined} className={({ isActive }) => itemCls(isActive, child, collapsed)}>
      {!child && <item.icon className="size-4 shrink-0" />}
      {!collapsed && t(item.labelKey)}
    </NavLink>
  );
  const group = (i: NavItem) => {
    const open = !collapsed && !!i.children && (pathname.startsWith(i.to) || i.children.some((c) => pathname.startsWith(c.to)));
    return (
      <div key={i.id} className={cx('contents', i.id === 'settings' && '[&>a]:mt-auto')}>
        {link(i)}
        {open && <div className="anim-fade flex flex-col gap-0.5">{i.children!.map((c) => link(c, true))}</div>}
      </div>
    );
  };
  return <nav aria-label="Main" className="flex min-h-0 flex-1 flex-col gap-0.5">{NAV.filter((i) => can(NAV_PERMISSION[i.id])).map(group)}</nav>;
}

/** Settings mode: the sidebar swaps to the list of settings sections, with a way back to the main menu. */
function SettingsNavLinks({ onNavigate, collapsed }: { onNavigate: () => void; collapsed: boolean }) {
  const { t } = useI18n();
  const can = useStaffAccess();
  return (
    <nav aria-label={t('nav.settings')} className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto">
      <NavLink to="/" onClick={onNavigate} title={collapsed ? t('nav.settings') : undefined} aria-label={collapsed ? t('nav.settings') : undefined} className={cx('mb-2 flex h-8 items-center gap-2 rounded-lg px-2 text-[13px] font-semibold text-white hover:bg-frame-hover', collapsed && 'justify-center')}>
        <ArrowLeft className="size-4 shrink-0" />{!collapsed && t('nav.settings')}
      </NavLink>
      {SETTINGS_SECTIONS.filter((s) => can(s.perm)).map((s) => (
        <NavLink key={s.id} to={`/settings/${s.id}`} onClick={onNavigate} title={collapsed ? t(s.key) : undefined} aria-label={collapsed ? t(s.key) : undefined} className={({ isActive }) => cx('flex min-h-7 items-center gap-2 rounded-lg px-2 py-1 text-[13px] leading-4 transition-colors', collapsed && 'justify-center', isActive ? 'bg-frame-active font-semibold text-white' : 'text-frame-text hover:bg-frame-hover')}>
          <s.icon className="size-4 shrink-0" />{!collapsed && t(s.key)}
        </NavLink>
      ))}
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
function AccountMenu({ collapsed }: { collapsed: boolean }) {
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
    <div ref={box} className="relative mt-2">
      <button type="button" aria-haspopup="menu" aria-expanded={open} aria-label={t('shell.account')} title={collapsed ? shop.name : undefined} onClick={() => setOpen(!open)}
        className={cx('flex h-9 w-full items-center gap-2 rounded-lg px-2 text-[13px] text-frame-text hover:bg-frame-hover', collapsed && 'justify-center')}>
        <span className="grid size-5 shrink-0 place-items-center rounded-md bg-primary text-[11px] font-semibold text-white">{initial}</span>
        {!collapsed && <span className="min-w-0 flex-1 truncate text-left">{shop.name}</span>}
      </button>
      {open && (
        <div role="menu" aria-label={t('shell.account')} className="anim-fade absolute bottom-11 left-0 z-50 w-64 rounded-xl border border-line bg-canvas p-1.5 text-fg shadow-pop">
          <div role="menuitem" aria-current="true" className={cx(row, 'bg-hover')}>
            <span className="grid size-5 shrink-0 place-items-center rounded-md bg-primary text-[11px] font-semibold text-white">{initial}</span><span className="min-w-0 flex-1 truncate font-medium">{shop.name}</span><Check className="size-4" />
          </div>
          <div className="my-1.5 border-t border-line" />
          <div className="flex items-center gap-2.5 px-2 py-1.5 text-[13px]"><span className="grid size-5 shrink-0 place-items-center rounded-full bg-accent text-[10px] font-semibold text-white">{(user.email[0] ?? 'U').toUpperCase()}</span><span className="min-w-0 flex-1 truncate">{user.email}</span></div>
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
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
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
  const mac = typeof navigator !== 'undefined' && /mac|iphone|ipad/i.test(navigator.platform);
  return (
    <div className="flex h-screen flex-col bg-frame text-frame-text" style={collapsed ? ({ '--w-sidebar': '3.5rem' } as React.CSSProperties) : undefined}>
      <RouteProgress />
      <header className="flex h-12 shrink-0 items-center gap-2 px-3">
        <button type="button" className="btn btn-plain btn-icon !text-frame-text hover:!bg-frame-hover md:hidden" aria-label={t('nav.menu')} onClick={() => setOpen(true)}><Menu className="size-5" /></button>
        <div className="flex items-center gap-2">
          <Logo className="size-6" />
          <span className="hidden text-[13px] font-semibold text-white sm:inline">ShopMe</span>
        </div>
        <button type="button" className="btn btn-plain btn-icon !hidden !text-frame-text hover:!bg-frame-hover md:!inline-flex" aria-label={collapsed ? t('shell.expand') : t('shell.collapse')} aria-pressed={collapsed} onClick={() => setCollapsed(!collapsed)}><PanelLeft className="size-[18px]" /></button>
        <div className="ml-auto flex items-center gap-1"><ActivityBell /></div>
      </header>
      <div className="flex min-h-0 flex-1">
        <aside className={cx('fixed inset-y-0 left-0 z-40 flex w-[var(--w-sidebar)] flex-col bg-frame px-2 pb-3 pt-14 transition-transform duration-200 ease-out md:static md:z-auto md:translate-x-0 md:pt-1', open ? 'translate-x-0' : '-translate-x-full')}>
          <button type="button" onClick={() => { setOpen(false); setPalette(true); }} aria-label={t('shell.search')} aria-keyshortcuts="Control+K Meta+K" title={collapsed ? t('shell.search') : undefined}
            className={cx('mb-2 flex h-8 w-full items-center gap-2 rounded-lg bg-white/10 px-2.5 text-[13px] text-frame-muted shadow-[inset_0_0_0_1px_rgb(255_255_255/0.08)] hover:bg-white/15', collapsed && 'justify-center px-0')}>
            <Search className="size-4 shrink-0" />
            {!collapsed && <><span className="flex-1 text-left">{t('shell.searchPlaceholder')}</span><kbd className="rounded bg-white/10 px-1.5 py-0.5 text-[11px] font-medium">{mac ? '⌘' : 'Ctrl'} K</kbd></>}
          </button>
          {pathname.startsWith('/settings') ? <SettingsNavLinks onNavigate={() => setOpen(false)} collapsed={collapsed} /> : <NavLinks onNavigate={() => setOpen(false)} collapsed={collapsed} />}
          <AccountMenu collapsed={collapsed} />
        </aside>
        {open && <div className="anim-fade fixed inset-0 z-30 bg-black/50 md:hidden" onClick={() => setOpen(false)} aria-hidden />}
        <div className="mb-1 mr-1 min-w-0 flex-1 overflow-y-auto rounded-xl bg-page text-fg max-md:mx-1 md:ml-0" id="sheet">
          <main className="mx-auto w-full max-w-[1100px] p-4 md:px-5 md:py-5">
            <div key={pathname.split('/').slice(0, 2).join('/')} className="anim-view"><Suspense fallback={<PageFallback />}><Outlet /></Suspense></div>
          </main>
        </div>
      </div>
      <CommandPalette open={palette} onClose={() => setPalette(false)} />
    </div>
  );
}
