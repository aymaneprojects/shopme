import { Dropdown, Skeleton, cx } from '@shopme/ui';
import { Check, Home, Monitor, Moon, Sun, Languages, LogOut, Menu, Percent, Search, Settings, ShoppingCart, Store, Tag, Users, Warehouse, FolderTree, FilePlus2 } from 'lucide-react';
import { Suspense, useEffect, useState } from 'react';
import type { ComponentType } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router';
import { LANGS, useI18n } from '../i18n';
import type { Key } from '../i18n';
import { getTheme, setTheme } from '../lib/theme';
import type { Theme } from '../lib/theme';
import { NAV_PERMISSION, useStaffAccess } from '../lib/permissions';
import { useSession, useShop } from '../session';
import { CommandPalette } from './CommandPalette';

interface NavItem { id: string; labelKey: Key; to: string; icon: ComponentType<{ className?: string }>; end?: boolean; children?: NavItem[] }

// Data-driven so later items can be gated by a feature flag instead of removed.
export const NAV: NavItem[] = [
  { id: 'home', labelKey: 'nav.home', to: '/', icon: Home, end: true },
  { id: 'orders', labelKey: 'nav.orders', to: '/orders', icon: ShoppingCart, children: [{ id: 'drafts', labelKey: 'nav.drafts', to: '/orders/drafts', icon: FilePlus2 }] },
  {
    id: 'products', labelKey: 'nav.products', to: '/products', icon: Tag,
    children: [
      { id: 'collections', labelKey: 'nav.collections', to: '/collections', icon: FolderTree },
      { id: 'inventory', labelKey: 'nav.inventory', to: '/inventory', icon: Warehouse },
    ],
  },
  { id: 'customers', labelKey: 'nav.customers', to: '/customers', icon: Users },
  { id: 'discounts', labelKey: 'nav.discounts', to: '/discounts', icon: Percent },
  { id: 'online-store', labelKey: 'nav.onlineStore', to: '/online-store', icon: Store },
  { id: 'settings', labelKey: 'nav.settings', to: '/settings', icon: Settings },
];

/** Own logo mark: rounded square with a shopping bag. */
export function Logo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden>
      <rect width="32" height="32" rx="8" fill="#1E40AF" />
      <path d="M9 12h14l-1.2 10H10.2z" fill="none" stroke="#fff" strokeWidth="2" strokeLinejoin="round" />
      <path d="M12.5 12a3.5 3.5 0 0 1 7 0" fill="none" stroke="#fff" strokeWidth="2" />
    </svg>
  );
}

const itemCls = (isActive: boolean, child: boolean) => cx(
  'flex h-7 items-center gap-2 rounded-lg px-2 text-[13px] transition-colors',
  child && 'ml-7 text-frame-muted',
  isActive ? 'bg-frame-active font-semibold text-white' : 'text-frame-text hover:bg-frame-hover',
);

function NavLinks({ onNavigate }: { onNavigate: () => void }) {
  const { t } = useI18n();
  const can = useStaffAccess();
  const { pathname } = useLocation();
  const link = (item: NavItem, child = false) => (
    <NavLink key={item.id} to={item.to} end={item.end || !!item.children} onClick={onNavigate} className={({ isActive }) => itemCls(isActive, child)}>
      {!child && <item.icon className="size-4 shrink-0" />}
      {t(item.labelKey)}
    </NavLink>
  );
  const group = (i: NavItem) => {
    const open = !!i.children && (pathname.startsWith(i.to) || i.children.some((c) => pathname.startsWith(c.to)));
    return (
      <div key={i.id} className={cx('contents', i.id === 'settings' && '[&>a]:mt-auto')}>
        {link(i)}
        {open && <div className="anim-fade flex flex-col gap-0.5">{i.children!.map((c) => link(c, true))}</div>}
      </div>
    );
  };
  return <nav aria-label="Main" className="flex min-h-0 flex-1 flex-col gap-0.5">{NAV.filter((i) => can(NAV_PERMISSION[i.id])).map(group)}</nav>;
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

export function Shell() {
  const { t, lang, setLang } = useI18n();
  const { logout } = useSession();
  const { shop, user } = useShop();
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  const [palette, setPalette] = useState(false);
  const [theme, setThemeState] = useState<Theme>(getTheme);
  const pick = (v: Theme) => { setTheme(v); setThemeState(v); };
  const themes: Array<[Theme, string, ComponentType<{ className?: string }>]> = [['light', t('theme.light'), Sun], ['dark', t('theme.dark'), Moon], ['system', t('theme.system'), Monitor]];
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
    <div className="flex h-screen flex-col bg-frame text-frame-text">
      <RouteProgress />
      <header className="flex h-12 shrink-0 items-center gap-3 px-3">
        <button type="button" className="btn btn-plain btn-icon !text-frame-text hover:!bg-frame-hover md:hidden" aria-label={t('nav.menu')} onClick={() => setOpen(true)}><Menu className="size-5" /></button>
        <div className="flex items-center gap-2 md:w-[calc(var(--w-sidebar)-12px)]">
          <Logo className="size-6" />
          <span className="hidden text-[13px] font-semibold text-white sm:inline">ShopMe</span>
        </div>
        <button type="button" onClick={() => setPalette(true)} aria-label={t('shell.search')} aria-keyshortcuts="Control+K Meta+K"
          className="flex h-8 w-full max-w-[460px] flex-1 items-center gap-2 rounded-lg bg-white/10 px-2.5 text-[13px] text-frame-muted shadow-[inset_0_0_0_1px_rgb(255_255_255/0.08)] hover:bg-white/15 md:mx-auto">
          <Search className="size-4" />
          <span className="flex-1 text-left">{t('shell.searchPlaceholder')}</span>
          <kbd className="hidden rounded bg-white/10 px-1.5 py-0.5 text-[11px] font-medium sm:inline">{mac ? '⌘' : 'Ctrl'} K</kbd>
        </button>
        <div className="ml-auto">
          <Dropdown
            align="right" label={t('shell.account')} variant="plain"
            trigger={<><span className="grid size-6 place-items-center rounded-md bg-primary text-xs font-semibold text-white">{(shop.name[0] ?? 'S').toUpperCase()}</span><span className="hidden max-w-32 truncate text-[13px] text-frame-text sm:inline">{shop.name}</span></>}
            items={[
              { key: 'who', label: <span className="text-muted">{user.email}</span>, onSelect: () => {}, disabled: true },
              ...LANGS.map((l) => ({ key: l.id, label: <span className="flex items-center gap-2"><Languages className="size-4" />{l.label}{lang === l.id && <Check className="ml-auto size-4" />}</span>, onSelect: () => setLang(l.id) })),
              ...themes.map(([id, label, Icon]) => ({ key: `theme-${id}`, label: <span className="flex items-center gap-2"><Icon className="size-4" />{label}{theme === id && <Check className="ml-auto size-4" />}</span>, onSelect: () => pick(id) })),
              { key: 'logout', label: <span className="flex items-center gap-2"><LogOut className="size-4" />{t('shell.logout')}</span>, onSelect: () => void logout() },
            ]}
          />
        </div>
      </header>
      <div className="flex min-h-0 flex-1">
        <aside className={cx('fixed inset-y-0 left-0 z-40 flex w-[var(--w-sidebar)] flex-col bg-frame px-2 pb-3 pt-14 transition-transform duration-200 ease-out md:static md:z-auto md:translate-x-0 md:pt-1', open ? 'translate-x-0' : '-translate-x-full')}>
          <NavLinks onNavigate={() => setOpen(false)} />
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
