import { Banner, cx } from '@shopme/ui';
import { LayoutGrid, Menu, Server } from 'lucide-react';
import { Suspense, useState } from 'react';
import type { ComponentType } from 'react';
import { NavLink, Outlet } from 'react-router';
import { AccountMenu } from '../../components/AccountMenu';
import { Logo, PageFallback } from '../../components/Shell';
import { useI18n } from '../../i18n';
import type { Key } from '../../i18n';
import { useSession } from '../../session';

/**
 * Multi-store mode, account level (no store open): the account's stores, "Create a store" and, for the platform owner, the
 * Platform area. Same frame as a store's admin, with the account menu at the bottom of the sidebar.
 */
export function AccountShell() {
  const { t } = useI18n();
  const { state } = useSession();
  const [open, setOpen] = useState(false);
  if (state.status !== 'account') return null;
  const items: Array<{ to: string; key: Key; icon: ComponentType<{ className?: string }> }> = [
    { to: '/stores', key: 'ms.nav.stores', icon: LayoutGrid },
    ...(state.multi.account.platformOwner ? [{ to: '/platform', key: 'ms.platform' as Key, icon: Server }] : []),
  ];
  return (
    <div className="flex h-screen flex-col bg-frame text-frame-text">
      <header className="flex h-12 shrink-0 items-center gap-2 px-3">
        <button type="button" className="btn btn-plain btn-icon !text-frame-text hover:!bg-frame-hover md:hidden" aria-label={t('nav.menu')} onClick={() => setOpen(true)}><Menu className="size-5" /></button>
        <div className="flex items-center gap-2"><Logo className="size-6" /><span className="text-[13px] font-semibold text-white">ShopMe</span></div>
      </header>
      <div className="flex min-h-0 flex-1">
        <aside className={cx('fixed inset-y-0 left-0 z-40 flex w-[var(--w-sidebar)] flex-col bg-frame px-2 pb-3 pt-14 transition-transform duration-200 ease-out md:static md:z-auto md:translate-x-0 md:pt-1', open ? 'translate-x-0' : '-translate-x-full')}>
          <nav aria-label={t('ms.nav.account')} className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto">
            {items.map((i) => (
              <NavLink key={i.to} to={i.to} onClick={() => setOpen(false)} className={({ isActive }) => cx('flex h-7 items-center gap-2 rounded-lg px-2 text-[13px] transition-colors', isActive ? 'bg-frame-active font-semibold text-white' : 'text-frame-text hover:bg-frame-hover')}>
                <i.icon className="size-4 shrink-0" />{t(i.key)}
              </NavLink>
            ))}
          </nav>
          <AccountMenu collapsed={false} />
        </aside>
        {open && <div className="anim-fade fixed inset-0 z-30 bg-black/50 md:hidden" onClick={() => setOpen(false)} aria-hidden />}
        <div className="mb-1 mr-1 min-w-0 flex-1 overflow-y-auto rounded-xl bg-page text-fg max-md:mx-1 md:ml-0" id="sheet">
          <main className="mx-auto w-full max-w-[1000px] p-4 md:px-5 md:py-5">
            {state.forbidden && <div className="mb-4"><Banner tone="warning" role="status">{t('ms.forbidden', { handle: state.forbidden })}</Banner></div>}
            <Suspense fallback={<PageFallback />}><Outlet /></Suspense>
          </main>
        </div>
      </div>
    </div>
  );
}
