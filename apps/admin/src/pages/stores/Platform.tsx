import { Badge, Banner, Button, Card, Dropdown, Input, Modal, Skeleton, useToast } from '@shopme/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ExternalLink, Server } from 'lucide-react';
import { useState } from 'react';
import { ApiError, rest } from '../../api';
import { StoreAvatar } from '../../components/AccountMenu';
import { PageHeader } from '../../components/PageHeader';
import { useI18n } from '../../i18n';
import { useSession } from '../../session';
import { PlatformEmail } from '../../components/EmailSetup';
import { Section } from '../../components/SettingsKit';

interface PlatformStore { id: number; name: string; handle: string; status: 'ACTIVE' | 'SUSPENDED'; ownerEmail: string | null; primaryDomain: string | null; createdAt: string; staffCount: number; host: string | null; url: string; adminPath: string }
interface PlatformData { stores: PlatformStore[]; settings: { storeCreation: 'OWNER' | 'EVERYONE' } }

/** Platform owner (multi-store): every store of the installation, suspend / resume / delete, and who may create stores. */
export function PlatformPage() {
  const { t, lang } = useI18n();
  const toast = useToast();
  const qc = useQueryClient();
  const { state } = useSession();
  const owner = state.status === 'account' && state.multi.account.platformOwner;
  const mine = new Set(state.status === 'account' ? state.multi.stores.map((s) => s.id) : []);
  const q = useQuery({ queryKey: ['platform-stores'], enabled: owner, queryFn: () => rest<PlatformData>('/platform/stores') });
  const [deleting, setDeleting] = useState<PlatformStore | null>(null);
  const [typed, setTyped] = useState('');
  const fail = (e: Error) => toast(e instanceof ApiError ? e.message : String(e), 'critical');
  const status = useMutation({
    mutationFn: ({ id, action }: { id: number; action: 'suspend' | 'resume' }) => rest(`/platform/stores/${id}/${action}`, { body: {} }),
    onSuccess: (_r, v) => { toast(t(v.action === 'suspend' ? 'ms.platform.suspended' : 'ms.platform.resumed')); void qc.invalidateQueries({ queryKey: ['platform-stores'] }); },
    onError: fail,
  });
  const del = useMutation({
    mutationFn: (s: PlatformStore) => rest(`/platform/stores/${s.id}`, { method: 'DELETE', body: { confirm: typed.trim() } }),
    onSuccess: () => { toast(t('ms.platform.deleted')); setDeleting(null); setTyped(''); void qc.invalidateQueries({ queryKey: ['platform-stores'] }); },
    onError: fail,
  });
  const settings = useMutation({
    mutationFn: (storeCreation: 'OWNER' | 'EVERYONE') => rest('/platform/settings', { method: 'PUT', body: { storeCreation } }),
    onSuccess: () => { toast(t('ms.platform.settingsSaved')); void qc.invalidateQueries({ queryKey: ['platform-stores'] }); },
    onError: fail,
  });
  const date = (iso: string) => new Date(iso).toLocaleDateString(lang, { year: 'numeric', month: 'short', day: 'numeric' });

  if (!owner) return <><PageHeader icon={<Server className="size-4" />} title={t('ms.platform')} /><Banner tone="info">{t('ms.platform.ownerOnly')}</Banner></>;
  return (
    <>
      <PageHeader icon={<Server className="size-4" />} title={t('ms.platform')} subtitle={t('ms.platform.subtitle')} />
      {q.isLoading && <Skeleton className="h-48" />}
      {q.error && <Banner>{q.error.message}</Banner>}
      {q.data && (
        <div className="flex flex-col gap-4">
          <div className="overflow-x-auto rounded-lg bg-canvas shadow-card">
            <table className="w-full min-w-[640px] text-[13px]">
              <caption className="sr-only">{t('ms.platform.storesCaption')}</caption>
              <thead className="border-b border-line bg-surface text-left text-muted">
                <tr><th scope="col" className="px-4 py-2 font-medium">{t('ms.platform.col.store')}</th><th scope="col" className="px-3 py-2 font-medium">{t('ms.platform.col.owner')}</th><th scope="col" className="px-3 py-2 font-medium">{t('ms.platform.col.staff')}</th><th scope="col" className="px-3 py-2 font-medium">{t('ms.platform.col.created')}</th><th scope="col" className="px-3 py-2 font-medium">{t('field.status')}</th><th scope="col" className="px-3 py-2"><span className="sr-only">{t('common.moreActions')}</span></th></tr>
              </thead>
              <tbody className="divide-y divide-line">
                {q.data.stores.map((s) => (
                  <tr key={s.id}>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2.5"><StoreAvatar name={s.name} handle={s.handle} className="size-7 text-[10px]" />
                        <div className="min-w-0"><div className="truncate font-semibold">{s.name}</div><div className="truncate text-xs text-muted">{s.primaryDomain ?? s.host}</div></div></div>
                    </td>
                    <td className="px-3 py-2.5 text-muted">{s.ownerEmail ?? '—'}</td>
                    <td className="px-3 py-2.5 tabular-nums">{s.staffCount}</td>
                    <td className="px-3 py-2.5 text-muted">{date(s.createdAt)}</td>
                    <td className="px-3 py-2.5">{s.status === 'SUSPENDED' ? <Badge tone="critical">{t('ms.badge.suspended')}</Badge> : <Badge tone="success">{t('ms.platform.active')}</Badge>}</td>
                    <td className="px-3 py-2.5 text-right">
                      <Dropdown align="right" size="sm" chevron label={t('ms.platform.actionsFor', { name: s.name })} trigger={t('common.moreActions')} items={[
                        ...(mine.has(s.id) ? [{ key: 'open', label: t('ms.stores.open'), onSelect: () => { window.location.assign(s.adminPath); } }] : []),
                        { key: 'view', label: t('ms.platform.viewStorefront'), icon: <ExternalLink className="size-4" />, onSelect: () => { window.open(s.url, '_blank', 'noopener'); } },
                        s.status === 'SUSPENDED'
                          ? { key: 'resume', label: t('ms.platform.resume'), onSelect: () => status.mutate({ id: s.id, action: 'resume' }) }
                          : { key: 'suspend', label: t('ms.platform.suspend'), onSelect: () => status.mutate({ id: s.id, action: 'suspend' }) },
                        { key: 'delete', label: t('ms.platform.delete'), danger: true, onSelect: () => { setTyped(''); setDeleting(s); } },
                      ]} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Card title={t('ms.platform.creationTitle')}>
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1 text-[13px] text-muted">{t('ms.platform.creationHelp')}</legend>
              {(['OWNER', 'EVERYONE'] as const).map((v) => (
                <label key={v} className="flex items-center gap-2 text-[13px]">
                  <input type="radio" name="store-creation" value={v} checked={q.data.settings.storeCreation === v} disabled={settings.isPending} onChange={() => settings.mutate(v)} />
                  {t(v === 'OWNER' ? 'ms.platform.creation.OWNER' : 'ms.platform.creation.EVERYONE')}
                </label>
              ))}
            </fieldset>
          </Card>
          <Section title={t('email.platform.title')} description={t('email.platform.desc')}><Card><PlatformEmail defaultTo={state.status === 'account' ? state.multi.account.email : ''} /></Card></Section>
        </div>
      )}
      <Modal open={!!deleting} onClose={() => setDeleting(null)} closeLabel={t('common.close')} title={t('ms.platform.deleteTitle', { name: deleting?.name ?? '' })}
        footer={<><Button onClick={() => setDeleting(null)}>{t('common.cancel')}</Button><Button variant="danger" loading={del.isPending} disabled={typed.trim() !== deleting?.handle} onClick={() => deleting && del.mutate(deleting)}>{t('ms.platform.deleteConfirm')}</Button></>}>
        <div className="flex flex-col gap-3 text-[13px]">
          <Banner tone="critical">{t('ms.platform.deleteWarning')}</Banner>
          <Input label={t('ms.platform.deleteType', { handle: deleting?.handle ?? '' })} value={typed} autoComplete="off" onChange={(e) => setTyped(e.target.value)} />
        </div>
      </Modal>
    </>
  );
}
