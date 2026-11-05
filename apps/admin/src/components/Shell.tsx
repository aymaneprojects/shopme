import { Dropdown, cx } from '@shopme/ui';
import { BarChart3, Boxes, Home, Languages, LogOut, Menu, Percent, Search, Settings, ShoppingCart, Store, Tag, Users, Warehouse, FolderTree, FilePlus2 } from 'lucide-react';
import { useState } from 'react';
import type { ComponentType } from 'react';
import { NavLink, Outlet } from 'react-router';
import { LANGS, useI18n } from '../i18n';
import type { Key } from '../i18n';
import { NAV_PERMISSION, useStaffAccess } from '../lib/permissions';
import { useSession, useShop } from '../session';

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
  { id: 'analytics', labelKey: 'nav.analytics', to: '/analytics', icon: BarChart3 },
  { id: 'discounts', labelKey: 'nav.discounts', to: '/discounts', icon: Percent },
  { id: 'online-store', labelKey: 'nav.onlineStore', to: '/online-store', icon: Store },
  { id: 'settings', labelKey: 'nav.settings', to: '/settings', icon: Settings },
];

function NavLinks({ onNavigate }: { onNavigate: () => void }) {
  const { t } = useI18n();
  const can = useStaffAccess();
  const link = (item: NavItem, child = false) => (
    <NavLink
      key={item.id} to={item.to} end={item.end} onClick={onNavigate}
      className={({ isActive }) => cx('flex items-center gap-2 rounded-md px-3 py-1.5 text-sm', child && 'ml-6', isActive ? 'bg-primary-subtle font-medium text-primary' : 'text-fg hover:bg-surface')}
    >
      <item.icon className="size-4" />
      {t(item.labelKey)}
    </NavLink>
  );
  return <nav aria-label="Main" className="flex flex-col gap-0.5">{NAV.filter((i) => can(NAV_PERMISSION[i.id])).map((i) => <div key={i.id} className="contents">{link(i)}{i.children?.filter((c) => can(NAV_PERMISSION[i.id])).map((c) => link(c, true))}</div>)}</nav>;
}

export function Shell() {
  const { t, lang, setLang } = useI18n();
  const { logout } = useSession();
  const { shop, user } = useShop();
  const [open, setOpen] = useState(false);
  return (
    <div className="flex min-h-screen">
      <aside className={cx('fixed inset-y-0 left-0 z-40 flex w-60 flex-col gap-4 border-r border-line bg-canvas p-3 transition-transform md:static md:translate-x-0', open ? 'translate-x-0' : '-translate-x-full')}>
        <div className="flex items-center gap-2 px-2 py-1.5 text-base font-semibold"><Boxes className="size-5 text-primary" />ShopMe</div>
        <NavLinks onNavigate={() => setOpen(false)} />
      </aside>
      {open && <div className="fixed inset-0 z-30 bg-black/40 md:hidden" onClick={() => setOpen(false)} aria-hidden />}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-line bg-canvas px-4 py-2">
          <button type="button" className="rounded p-1.5 hover:bg-surface md:hidden" aria-label={t('nav.menu')} onClick={() => setOpen(true)}><Menu className="size-5" /></button>
          <div className="relative max-w-md flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted" />
            <input type="search" disabled placeholder={t('shell.searchPlaceholder')} aria-label={t('shell.search')} className="w-full rounded-md border border-line bg-surface py-2 pl-8 pr-3 text-sm placeholder:text-muted" />
          </div>
          <div className="ml-auto">
            <Dropdown
              align="right" label={t('shell.account')}
              trigger={<><span className="grid size-6 place-items-center rounded-full bg-primary text-xs text-on-primary">{(shop.name[0] ?? 'S').toUpperCase()}</span><span className="hidden sm:inline">{shop.name}</span></>}
              items={[
                { key: 'who', label: <span className="text-muted">{user.email}</span>, onSelect: () => {}, disabled: true },
                ...LANGS.map((l) => ({ key: l.id, label: <span className="flex items-center gap-2"><Languages className="size-4" />{l.label}{lang === l.id ? ' ✓' : ''}</span>, onSelect: () => setLang(l.id) })),
                { key: 'logout', label: <span className="flex items-center gap-2"><LogOut className="size-4" />{t('shell.logout')}</span>, onSelect: () => void logout() },
              ]}
            />
          </div>
        </header>
        <main className="mx-auto w-full max-w-6xl flex-1 p-4 md:p-6"><Outlet /></main>
      </div>
    </div>
  );
}
