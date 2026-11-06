import { cx } from '@shopme/ui';
import { Check, CircleHelp, Languages, LayoutGrid, LogOut, Monitor, Moon, PlusCircle, Server, Sun } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { ComponentType, ReactNode } from 'react';
import { LANGS, useI18n } from '../i18n';
import { getTheme, setTheme } from '../lib/theme';
import type { Theme } from '../lib/theme';
import { useMulti, useSession } from '../session';
import type { AccountStore } from '../session';
import { ActivityBell } from './ActivityBell';

/** "Boutique Test Virtuelle" -> "BT"; one word -> its first two letters. */
export const storeInitials = (name: string) => {
  const w = name.trim().split(/\s+/).filter(Boolean);
  return (w.length > 1 ? `${w[0]![0]}${w[1]![0]}` : (w[0] ?? 'S').slice(0, 2)).toUpperCase();
};
export const personInitials = (p: { firstName?: string | null; lastName?: string | null; email: string }) => (((p.firstName?.[0] ?? '') + (p.lastName?.[0] ?? '')) || p.email.slice(0, 2)).toUpperCase();

/** Avatar colour of a store, stable for its handle (own palette). */
const AVATAR_COLOURS = ['bg-[#1A3591]', 'bg-[#0F766E]', 'bg-[#9D174D]', 'bg-[#6D28D9]', 'bg-[#B45309]', 'bg-[#15803D]'];
const colourOf = (key: string) => AVATAR_COLOURS[[...key].reduce((n, c) => (n * 31 + c.charCodeAt(0)) >>> 0, 7) % AVATAR_COLOURS.length]!;

export function StoreAvatar({ name, handle, className }: { name: string; handle?: string; className?: string }) {
  return <span className={cx('grid shrink-0 place-items-center rounded-md font-semibold text-white', colourOf(handle ?? name), className ?? 'size-6 text-[10px]')} aria-hidden>{storeInitials(name)}</span>;
}

/** Badge of a store row: suspended, or taking test payments only. */
export function StoreBadge({ store }: { store: Pick<AccountStore, 'status' | 'testMode'> | undefined }) {
  const { t } = useI18n();
  if (!store) return null;
  if (store.status === 'SUSPENDED') return <span className="shrink-0 rounded-md bg-critical-subtle px-1.5 py-px text-[11px] font-medium text-critical">{t('ms.badge.suspended')}</span>;
  if (store.testMode) return <span className="shrink-0 rounded-md bg-[color-mix(in_srgb,var(--color-border)_70%,var(--color-bg))] px-1.5 py-px text-[11px] font-medium text-muted" title={t('ms.badge.testHint')}>{t('ms.badge.test')}</span>;
  return null;
}

const row = 'flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-[13px] hover:bg-hover focus-visible:bg-hover focus-visible:outline-none';
const HELP_URL = 'https://github.com/aymaneprojects/shopme#readme';

/**
 * Account menu at the bottom of the sidebar. Store group: the current store, the account's other stores (switch), all stores and
 * "Create a store" (multi-store mode); then the account group: the signed-in user, preferences, help and sign out.
 */
export function AccountMenu({ collapsed, userBlock }: { collapsed: boolean; userBlock?: boolean }) {
  const { t, lang, setLang } = useI18n();
  const { state, logout } = useSession();
  const multi = useMulti();
  const [open, setOpen] = useState(false);
  const [theme, setThemeState] = useState<Theme>(getTheme);
  const box = useRef<HTMLDivElement>(null);
  const pick = (v: Theme) => { setTheme(v); setThemeState(v); };
  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOpen(false); box.current?.querySelector('button')?.focus(); } };
    document.addEventListener('mousedown', down); document.addEventListener('keydown', key);
    return () => { document.removeEventListener('mousedown', down); document.removeEventListener('keydown', key); };
  }, [open]);

  const shop = state.status === 'authenticated' ? state.shop : null;
  const user = state.status === 'authenticated' ? state.user : null;
  const person = multi?.account ?? user ?? { email: '', firstName: '', lastName: '' };
  const current = multi?.stores.find((s) => s.id === shop?.id);
  const others = multi ? multi.stores.filter((s) => s.id !== shop?.id) : [];
  const shown = others.slice(0, 6);
  const themes: Array<[Theme, string, ComponentType<{ className?: string }>]> = [['light', t('theme.light'), Sun], ['dark', t('theme.dark'), Moon], ['system', t('theme.system'), Monitor]];

  const trigger: ReactNode = userBlock && user && !collapsed
    ? <><span className="grid size-6 shrink-0 place-items-center rounded-md bg-primary-top text-[10px] font-semibold text-white">{personInitials(user)}</span>
      <span className="min-w-0 flex-1 text-left leading-4"><span className="block truncate font-semibold text-white">{[user.firstName, user.lastName].filter(Boolean).join(' ') || user.email}</span><span className="block truncate text-[11px] text-frame-muted">{user.email}</span></span></>
    : shop
      ? <><StoreAvatar name={shop.name} handle={shop.handle} className="size-5 text-[9px]" />{!collapsed && <span className="min-w-0 flex-1 truncate text-left">{shop.name}</span>}{!collapsed && current?.testMode && <span className="rounded bg-white/10 px-1 text-[10px] text-frame-muted">{t('ms.badge.test')}</span>}</>
      : <><span className="grid size-5 shrink-0 place-items-center rounded-md bg-primary-top text-[9px] font-semibold text-white">{personInitials(person)}</span>{!collapsed && <span className="min-w-0 flex-1 truncate text-left">{person.email}</span>}</>;

  return (
    <div ref={box} className="relative mt-2 flex items-center gap-1">
      <button type="button" aria-haspopup="menu" aria-expanded={open} aria-label={t('shell.account')} title={collapsed ? shop?.name ?? person.email : undefined} onClick={() => setOpen(!open)}
        className={cx('flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2 text-[13px] text-frame-text hover:bg-frame-hover', userBlock && !collapsed ? 'h-10' : 'h-9', collapsed && 'justify-center')}>
        {trigger}
      </button>
      {!collapsed && shop && <ActivityBell />}
      {open && (
        <div role="menu" aria-label={t('shell.account')} className="anim-fade absolute bottom-11 left-0 z-50 max-h-[80vh] w-72 overflow-y-auto rounded-xl border border-line bg-canvas p-1.5 text-fg shadow-pop">
          {shop && (
            <div role="menuitem" aria-current="true" className={cx(row, 'bg-hover hover:bg-hover')}>
              <StoreAvatar name={shop.name} handle={shop.handle} /><span className="min-w-0 flex-1 truncate font-medium">{shop.name}</span><StoreBadge store={current} /><Check className="size-4 shrink-0" aria-hidden />
            </div>
          )}
          {shown.map((s) => (
            <a key={s.id} role="menuitem" href={`/admin/store/${s.handle}/`} className={row} title={t('ms.switchTo', { name: s.name })}>
              <StoreAvatar name={s.name} handle={s.handle} /><span className="min-w-0 flex-1 truncate">{s.name}</span><StoreBadge store={s} />
            </a>
          ))}
          {multi && <a role="menuitem" href="/admin/stores" className={row}><LayoutGrid className="size-4 text-muted" />{t('ms.allStores')}</a>}
          {multi?.canCreateStores && <a role="menuitem" href="/admin/stores/new" className={row}><PlusCircle className="size-4 text-muted" />{t('ms.createStore')}</a>}
          {(shop || multi) && <div className="my-1.5 border-t border-line" role="separator" />}
          <div className="flex items-center gap-2.5 px-2 py-1.5 text-[13px]"><span className="grid size-6 shrink-0 place-items-center rounded-full bg-primary text-[10px] font-semibold text-on-primary" aria-hidden>{personInitials(person)}</span><span className="min-w-0 flex-1 truncate">{person.email}</span></div>
          {multi?.account.platformOwner && <a role="menuitem" href="/admin/platform" className={row}><Server className="size-4 text-muted" />{t('ms.platform')}</a>}
          <div className="flex items-center gap-1 px-2 py-1" role="group" aria-label={t('ms.language')}>
            <Languages className="mr-1.5 size-4 shrink-0 text-muted" aria-hidden />
            {LANGS.map((l) => (
              <button key={l.id} type="button" role="menuitem" aria-current={lang === l.id} onClick={() => setLang(l.id)}
                className={cx('rounded-md px-2 py-1 text-[13px]', lang === l.id ? 'bg-hover font-semibold' : 'text-muted hover:bg-hover hover:text-fg')}>{l.label}</button>
            ))}
          </div>
          <div className="flex items-center gap-1 px-2 py-1" role="group" aria-label={t('ms.appearance')}>
            <span className="mr-1.5 w-4" aria-hidden />
            {themes.map(([id, label, Icon]) => (
              <button key={id} type="button" role="menuitem" aria-label={label} title={label} aria-current={theme === id} onClick={() => pick(id)}
                className={cx('grid size-7 place-items-center rounded-md', theme === id ? 'bg-hover text-fg' : 'text-muted hover:bg-hover hover:text-fg')}><Icon className="size-4" /></button>
            ))}
          </div>
          <a role="menuitem" href={HELP_URL} target="_blank" rel="noreferrer" className={row}><CircleHelp className="size-4 text-muted" />{t('shell.help')}</a>
          <button type="button" role="menuitem" className={row} onClick={() => void logout()}><LogOut className="size-4 text-muted" />{t('shell.logout')}</button>
        </div>
      )}
    </div>
  );
}
