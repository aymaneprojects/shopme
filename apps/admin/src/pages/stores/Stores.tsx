import { Banner, Skeleton } from '@shopme/ui';
import { useQuery } from '@tanstack/react-query';
import { Plus, Search } from 'lucide-react';
import { useState } from 'react';
import { rest } from '../../api';
import { StoreAvatar, StoreBadge } from '../../components/AccountMenu';
import { Logo } from '../../components/Shell';
import { useI18n } from '../../i18n';
import type { AccountStore } from '../../session';
import { useSession } from '../../session';
import { AccountChip } from '../account/AccountLayout';

export interface StoreListItem extends AccountStore { adminPath: string }

type Filter = 'active' | 'suspended' | 'all';

/**
 * Multi-store, no store open: "Welcome back" and one white card to choose a store (filter, search, the list) or create a new one.
 * The account chip at the top right opens the account, the platform (its owner) and sign out.
 */
export function StoresPage() {
  const { t } = useI18n();
  const { state } = useSession();
  const [filter, setFilter] = useState<Filter>('active');
  const [term, setTerm] = useState('');
  const q = useQuery({ queryKey: ['account-stores'], queryFn: () => rest<{ stores: StoreListItem[]; canCreateStores: boolean }>('/account/stores') });
  const first = state.status === 'account' ? state.multi.account.firstName || state.multi.account.email.split('@')[0]! : '';
  const needle = term.trim().toLocaleLowerCase();
  const shown = (q.data?.stores ?? []).filter((s) => (filter === 'all' || (filter === 'suspended') === (s.status === 'SUSPENDED')) && (!needle || `${s.name} ${s.primaryDomain ?? s.host}`.toLocaleLowerCase().includes(needle)));
  return (
    <div className="auth-page">
      <header className="flex items-center justify-between px-4 pt-4 sm:px-10 sm:pt-6">
        <a href="/admin/stores" className="flex items-center gap-2.5 text-lg font-semibold text-white"><Logo className="size-8" /><span>ShopMe</span></a>
        <AccountChip dark />
      </header>
      <main className="flex flex-1 flex-col items-center justify-center px-4 py-8">
        <div className="mb-6 max-w-xl text-center">
          <h1 className="text-[28px] font-semibold leading-tight text-white sm:text-[34px]">{t('ms.stores.welcome', { name: first })}</h1>
          <p className="mt-2 text-[15px] text-white/70">{t('ms.stores.pick')}</p>
        </div>
        <div className="auth-card auth-light !max-w-[460px] !p-5">
          {q.isLoading && <Skeleton className="h-32" />}
          {q.error && <Banner>{q.error.message}</Banner>}
          {q.data && (
            <>
              <div className="flex items-center gap-2">
                <select aria-label={t('ms.stores.filter')} value={filter} onChange={(e) => setFilter(e.target.value as Filter)} className="h-9 shrink-0 rounded-lg border-0 bg-hover px-2.5 text-[13px] font-medium">
                  <option value="active">{t('ms.stores.filter.active')}</option><option value="suspended">{t('ms.stores.filter.suspended')}</option><option value="all">{t('ms.stores.filter.all')}</option>
                </select>
                <label className="relative block min-w-0 flex-1">
                  <span className="sr-only">{t('ms.stores.search')}</span>
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
                  <input type="search" value={term} onChange={(e) => setTerm(e.target.value)} placeholder={t('ms.stores.search')} autoComplete="off" className="h-9 w-full rounded-lg border-0 bg-hover pl-8 pr-2 text-[13px] outline-none placeholder:text-muted focus-visible:shadow-[0_0_0_2px_var(--color-focus-ring)]" />
                </label>
              </div>
              <ul className="mt-3 flex flex-col" aria-label={t('ms.stores.title')}>
                {shown.map((s) => (
                  <li key={s.id}>
                    <a href={s.adminPath} className="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-hover focus-visible:bg-hover focus-visible:outline-none">
                      <StoreAvatar name={s.name} handle={s.handle} className="size-8 text-[11px]" />
                      <span className="min-w-0 flex-1 leading-4"><span className="flex items-center gap-2"><span className="truncate text-[13px] font-semibold">{s.name}</span><StoreBadge store={s} /></span><span className="block truncate text-xs text-muted">{s.primaryDomain ?? s.host}</span></span>
                    </a>
                  </li>
                ))}
              </ul>
              {shown.length === 0 && <p className="px-2 py-4 text-center text-[13px] text-muted">{t(q.data.stores.length === 0 ? (q.data.canCreateStores ? 'ms.stores.emptyCreate' : 'ms.stores.emptyAsk') : 'ms.stores.noMatch')}</p>}
              {q.data.canCreateStores && (
                <a href="/admin/stores/new" className="mt-2 flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-hover focus-visible:bg-hover focus-visible:outline-none">
                  <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-ink text-ink-text" aria-hidden><Plus className="size-4" /></span>
                  <span className="text-[13px] font-semibold">{t('ms.stores.createNew')}</span>
                </a>
              )}
            </>
          )}
        </div>
      </main>
    </div>
  );
}
