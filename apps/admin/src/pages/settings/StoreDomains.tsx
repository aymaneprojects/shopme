import { Badge, Banner, Button, ConfirmDialog, Dropdown, Input, Modal, Skeleton, useToast } from '@shopme/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, Globe } from 'lucide-react';
import { useState } from 'react';
import { ApiError, rest } from '../../api';
import { SettingsActions } from '../../components/SettingsKit';
import { useI18n } from '../../i18n';

interface DomainRow { id: number; host: string; verified: boolean; primary: boolean; verificationRecord: string; verificationValue: string; createdAt: string }
interface DomainsView { platformHost: string | null; primaryDomain: string | null; url: string; domains: DomainRow[] }

/**
 * Multi-store Settings > Domains: the store's permanent address (`<handle>.<base domain>`) and its own domains. A domain is added,
 * proven with a TXT record, then can become the primary domain; the store's other addresses redirect to the primary one.
 */
export function StoreDomains() {
  const { t } = useI18n();
  const toast = useToast();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['store-domains'], queryFn: () => rest<DomainsView>('/store/domains') });
  const [adding, setAdding] = useState(false);
  const [host, setHost] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [removing, setRemoving] = useState<DomainRow | null>(null);
  const [details, setDetails] = useState<DomainRow | null>(null);
  const refresh = (v: DomainsView) => { qc.setQueryData(['store-domains'], v); void qc.invalidateQueries({ queryKey: ['store-info'] }); void qc.invalidateQueries({ queryKey: ['shop-settings'] }); };
  const fail = (e: Error) => toast(e instanceof ApiError ? e.message : String(e), 'critical');
  const add = useMutation({
    mutationFn: () => rest<DomainsView>('/store/domains', { body: { host } }),
    onSuccess: (v) => { refresh(v); setAdding(false); setHost(''); toast(t('domains.added')); setDetails(v.domains.find((d) => d.host === host.trim().toLowerCase()) ?? null); },
    onError: (e) => setError(e instanceof ApiError ? e.message : String(e)),
  });
  const verify = useMutation({ mutationFn: (d: DomainRow) => rest<DomainsView>(`/store/domains/${d.id}/verify`, { body: {} }), onSuccess: (v) => { refresh(v); setDetails(null); toast(t('domains.verified')); }, onError: fail });
  const primary = useMutation({ mutationFn: (id: number | null) => rest<DomainsView>('/store/domains/primary', { method: 'PUT', body: { id } }), onSuccess: (v) => { refresh(v); toast(t('domains.primarySet')); }, onError: fail });
  const remove = useMutation({ mutationFn: (d: DomainRow) => rest<DomainsView>(`/store/domains/${d.id}`, { method: 'DELETE' }), onSuccess: (v) => { refresh(v); setRemoving(null); toast(t('domains.removed')); }, onError: fail });
  const copy = (v: string) => { void navigator.clipboard?.writeText(v).then(() => toast(t('domains.copied'))).catch(() => undefined); };

  if (q.isLoading) return <Skeleton className="h-32" />;
  if (q.error) return <Banner>{q.error.message}</Banner>;
  const v = q.data!;
  return (
    <>
      <SettingsActions><Button variant="primary" onClick={() => { setError(null); setAdding(true); }}>{t('domains.add')}</Button></SettingsActions>
      <div className="overflow-hidden rounded-lg bg-canvas shadow-card">
        <div className="grid grid-cols-[1fr_12rem_auto] gap-3 border-b border-line bg-surface px-4 py-2 text-[13px] text-muted"><span>{t('settings.domain')}</span><span>{t('field.status')}</span><span className="w-24" /></div>
        <ul className="divide-y divide-line">
          {v.platformHost && (
            <li className="grid grid-cols-[1fr_12rem_auto] items-center gap-3 px-4 py-3 text-[13px]">
              <span className="flex min-w-0 flex-wrap items-center gap-2"><Globe className="size-4 shrink-0 text-muted" /><span className="truncate font-medium">{v.platformHost}</span>{!v.primaryDomain && <Badge>{t('settings.primaryBadge')}</Badge>}<span className="text-xs text-muted">{t('domains.permanent')}</span></span>
              <span><Badge tone="success">{t('settings.connected')}</Badge></span>
              <span className="flex w-24 justify-end">{v.primaryDomain && <Button size="sm" loading={primary.isPending} onClick={() => primary.mutate(null)}>{t('domains.makePrimary')}</Button>}</span>
            </li>
          )}
          {v.domains.map((d) => (
            <li key={d.id} className="grid grid-cols-[1fr_12rem_auto] items-center gap-3 px-4 py-3 text-[13px]">
              <span className="flex min-w-0 items-center gap-2"><Globe className="size-4 shrink-0 text-muted" /><span className="truncate font-medium">{d.host}</span>{d.primary && <Badge>{t('settings.primaryBadge')}</Badge>}</span>
              <span>{d.verified ? <Badge tone="success">{t('domains.statusVerified')}</Badge> : <Badge tone="attention">{t('domains.statusPending')}</Badge>}</span>
              <span className="flex w-24 justify-end">
                <Dropdown align="right" size="sm" chevron label={t('domains.actionsFor', { host: d.host })} trigger={t('common.moreActions')} items={[
                  ...(!d.verified ? [{ key: 'verify', label: t('domains.verify'), onSelect: () => setDetails(d) }] : []),
                  ...(d.verified && !d.primary ? [{ key: 'primary', label: t('domains.makePrimary'), onSelect: () => primary.mutate(d.id) }] : []),
                  { key: 'remove', label: t('common.remove'), danger: true, onSelect: () => setRemoving(d) },
                ]} />
              </span>
            </li>
          ))}
        </ul>
      </div>
      <p className="mt-3 text-center text-[13px] text-muted">{t('domains.help')}</p>

      <Modal open={adding} onClose={() => setAdding(false)} closeLabel={t('common.close')} title={t('domains.add')}
        footer={<><Button onClick={() => setAdding(false)}>{t('common.cancel')}</Button><Button variant="primary" loading={add.isPending} disabled={!host.includes('.')} onClick={() => add.mutate()}>{t('domains.addSubmit')}</Button></>}>
        <div className="flex flex-col gap-3">
          {error && <Banner>{error}</Banner>}
          <Input label={t('settings.domain')} placeholder="shop.example.com" autoComplete="off" value={host} onChange={(e) => setHost(e.target.value.trim().toLowerCase())} />
          <p className="text-[13px] text-muted">{t('domains.addHelp')}</p>
        </div>
      </Modal>

      <Modal open={!!details} onClose={() => setDetails(null)} closeLabel={t('common.close')} title={t('domains.connectTitle', { host: details?.host ?? '' })}
        footer={<><Button onClick={() => setDetails(null)}>{t('common.close')}</Button><Button variant="primary" loading={verify.isPending} onClick={() => details && verify.mutate(details)}>{t('domains.verify')}</Button></>}>
        {details && (
          <ol className="flex list-decimal flex-col gap-3 pl-5 text-[13px]">
            <li>{t('domains.step1', { target: v.platformHost ?? '' })}</li>
            <li>
              {t('domains.step2')}
              <dl className="mt-2 grid grid-cols-[auto_1fr_auto] items-center gap-x-2 gap-y-1 rounded-md bg-surface p-2 text-xs">
                <dt className="text-muted">{t('domains.recordName')}</dt><dd className="break-all font-mono">{details.verificationRecord}</dd><Button size="sm" variant="plain" icon aria-label={t('domains.copyName')} onClick={() => copy(details.verificationRecord)}><Copy className="size-3.5" /></Button>
                <dt className="text-muted">{t('domains.recordValue')}</dt><dd className="break-all font-mono">{details.verificationValue}</dd><Button size="sm" variant="plain" icon aria-label={t('domains.copyValue')} onClick={() => copy(details.verificationValue)}><Copy className="size-3.5" /></Button>
              </dl>
            </li>
            <li>{t('domains.step3')}</li>
          </ol>
        )}
      </Modal>

      <ConfirmDialog open={!!removing} danger title={t('domains.removeTitle', { host: removing?.host ?? '' })} message={t('domains.removeBody')} confirmLabel={t('common.remove')} cancelLabel={t('common.cancel')} closeLabel={t('common.close')}
        loading={remove.isPending} onConfirm={() => removing && remove.mutate(removing)} onClose={() => setRemoving(null)} />
    </>
  );
}
