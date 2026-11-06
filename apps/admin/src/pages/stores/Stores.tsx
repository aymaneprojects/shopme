import { Badge, Banner, Button, EmptyState, Skeleton } from '@shopme/ui';
import { useQuery } from '@tanstack/react-query';
import { ExternalLink, LayoutGrid, PlusCircle, Store } from 'lucide-react';
import { useNavigate } from 'react-router';
import { rest } from '../../api';
import { StoreAvatar, StoreBadge } from '../../components/AccountMenu';
import { PageHeader } from '../../components/PageHeader';
import { useI18n } from '../../i18n';
import type { Key } from '../../i18n';
import type { AccountStore } from '../../session';

export interface StoreListItem extends AccountStore { adminPath: string }

const ROLE_KEYS: Record<string, Key> = { owner: 'ms.role.owner', admin: 'ms.role.admin', staff: 'ms.role.staff' };

/** Multi-store: every store the account works in, with its role, address and a way into its admin. */
export function StoresPage() {
  const { t } = useI18n();
  const nav = useNavigate();
  const q = useQuery({ queryKey: ['account-stores'], queryFn: () => rest<{ stores: StoreListItem[]; canCreateStores: boolean }>('/account/stores') });
  const create = q.data?.canCreateStores ? <Button variant="primary" onClick={() => nav('/stores/new')}><PlusCircle className="size-4" />{t('ms.createStore')}</Button> : null;
  return (
    <>
      <PageHeader icon={<LayoutGrid className="size-4" />} title={t('ms.stores.title')} actions={create} />
      {q.isLoading && <Skeleton className="h-40" />}
      {q.error && <Banner>{q.error.message}</Banner>}
      {q.data && q.data.stores.length === 0 && (
        <div className="rounded-lg bg-canvas shadow-card">
          <EmptyState icon={<Store className="size-8" />} title={t('ms.stores.emptyTitle')} description={t(q.data.canCreateStores ? 'ms.stores.emptyCreate' : 'ms.stores.emptyAsk')} action={create} />
        </div>
      )}
      {q.data && q.data.stores.length > 0 && (
        <ul className="divide-y divide-line overflow-hidden rounded-lg bg-canvas shadow-card" aria-label={t('ms.stores.title')}>
          {q.data.stores.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <StoreAvatar name={s.name} handle={s.handle} className="size-9 text-xs" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2"><a href={s.adminPath} className="truncate text-sm font-semibold hover:underline">{s.name}</a><StoreBadge store={s} /></div>
                <div className="truncate text-[13px] text-muted">{s.primaryDomain ?? s.host}</div>
              </div>
              <Badge>{t(ROLE_KEYS[s.role] ?? 'ms.role.staff')}</Badge>
              <a href={s.url} target="_blank" rel="noreferrer" className="btn btn-plain btn-icon" aria-label={t('ms.stores.viewStore', { name: s.name })} title={t('ms.stores.viewStore', { name: s.name })}><ExternalLink className="size-4" /></a>
              <a href={s.adminPath} className="btn btn-secondary btn-sm">{t('ms.stores.open')}</a>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
