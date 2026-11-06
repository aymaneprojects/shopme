import { Dropdown, cx } from '@shopme/ui';
import { CircleHelp, CircleUserRound, Lock, LogOut, Server } from 'lucide-react';
import { Suspense } from 'react';
import { NavLink, Outlet } from 'react-router';
import { personInitials } from '../../components/AccountMenu';
import { Logo, PageFallback } from '../../components/Shell';
import { useI18n } from '../../i18n';
import { useMulti, useSession } from '../../session';

const HELP_URL = 'https://github.com/aymaneprojects/shopme#readme';

/** The signed-in person of the account pages (the account when several stores are served, else the staff member). */
export function usePerson() {
  const { state } = useSession();
  const multi = useMulti();
  const user = state.status === 'authenticated' ? state.user : null;
  const p = multi?.account ?? user ?? { email: '', firstName: '', lastName: '' };
  const name = [p.firstName, p.lastName].filter(Boolean).join(' ') || p.email;
  return { ...p, name, initials: personInitials(p) };
}

/** The signed-in person at the top right of the account pages: opens a menu with the account, the platform (its owner), help and sign out. */
export function AccountChip({ dark }: { dark?: boolean }) {
  const { t } = useI18n();
  const { logout } = useSession();
  const multi = useMulti();
  const person = usePerson();
  return (
    <Dropdown align="right" variant="plain" label={t('acc.menu')} className={cx('!gap-2 !px-1.5 !text-fg', dark && '!text-white hover:!bg-white/10')} menuClassName="!text-fg"
      trigger={<><span className="grid size-7 place-items-center rounded-md bg-primary text-[11px] font-semibold text-on-primary" aria-hidden>{person.initials}</span><span className="max-w-[40vw] truncate text-[13px] font-medium max-sm:hidden">{person.name}</span></>}
      items={[
        { key: 'account', label: t('acc.title'), icon: <CircleUserRound className="size-4" />, onSelect: () => { window.location.assign('/admin/account'); } },
        ...(multi?.account.platformOwner ? [{ key: 'platform', label: t('ms.platform'), icon: <Server className="size-4" />, onSelect: () => { window.location.assign('/admin/platform'); } }] : []),
        { key: 'help', label: t('shell.help'), icon: <CircleHelp className="size-4" />, onSelect: () => { window.open(HELP_URL, '_blank', 'noopener'); } },
        { key: 'logout', label: t('shell.logout'), icon: <LogOut className="size-4" />, separatorBefore: true, onSelect: () => { void logout(); } },
      ]} />
  );
}

/**
 * Account area (profile, security): logo and signed-in person on a white top bar, the account sections on the left and one column of
 * settings on a light page. Shared by the single-store and multi-store routers; the logo goes back to the stores (or the store).
 */
export function AccountLayout() {
  const { t } = useI18n();
  const multi = useMulti();
  const home = multi ? '/admin/stores' : '/admin/';
  const items = [{ to: '/account', end: true, label: t('acc.nav.general'), icon: CircleUserRound }, { to: '/account/security', end: false, label: t('acc.nav.security'), icon: Lock }];
  return (
    <div className="flex min-h-screen flex-col bg-page text-fg">
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-line bg-canvas px-4">
        <a href={home} aria-label={t('acc.logo')} className="flex items-center gap-2 rounded-md text-[15px] font-semibold"><Logo className="size-7" />ShopMe</a>
        <AccountChip />
      </header>
      <div className="flex min-h-0 flex-1 max-md:flex-col">
        <nav aria-label={t('acc.nav')} className="shrink-0 border-line bg-surface p-2 max-md:flex max-md:gap-1 max-md:border-b md:w-52 md:border-r md:pt-4">
          {items.map((i) => (
            <NavLink key={i.to} to={i.to} end={i.end} className={({ isActive }) => cx('relative flex h-9 items-center gap-2.5 rounded-lg px-3 text-[13px] transition-colors', isActive ? 'bg-primary-subtle font-semibold text-primary before:absolute before:inset-y-1 before:left-0 before:w-0.5 before:rounded-full before:bg-primary' : 'text-muted hover:bg-hover hover:text-fg')}>
              <i.icon className="size-4 shrink-0" />{i.label}
            </NavLink>
          ))}
        </nav>
        <main className="min-w-0 flex-1 px-4 py-6 md:px-10">
          <div className="mx-auto w-full max-w-[760px]"><Suspense fallback={<PageFallback />}><Outlet /></Suspense></div>
        </main>
      </div>
    </div>
  );
}

/** A row of the account pages: a title and help text on the left, the card(s) on the right; rows are separated by a thin line. */
export function AccountSection({ title, badge, help, children }: { title: string; badge?: string; help?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="grid gap-3 border-t border-line py-6 first:border-t-0 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] md:gap-8">
      <div>
        <h2 className="flex flex-wrap items-center gap-2 text-sm font-semibold leading-6">{title}{badge && <span className="rounded-md bg-info-subtle px-1.5 py-px text-[11px] font-medium text-info">{badge}</span>}</h2>
        {help && <div className="mt-1 text-[13px] text-muted">{help}</div>}
      </div>
      <div className="flex min-w-0 flex-col gap-3">{children}</div>
    </section>
  );
}

export const accountCard = 'rounded-lg bg-canvas shadow-card';
