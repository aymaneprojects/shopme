import { Badge, Banner, Button, ConfirmDialog, Dropdown, Input, Modal, Skeleton, useToast, cx } from '@shopme/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ArrowLeftRight, Check, ChevronDown, Circle, Copy, Globe, Store } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { ApiError, UserErrors, mutate, rest } from '../../api';
import { SettingsActions } from '../../components/SettingsKit';
import { SHOP_UPDATE } from '../../graphql';
import { useI18n } from '../../i18n';
import { useMulti } from '../../session';
import { useShopSettings } from './Settings';

interface DomainRow { id: number; host: string; verified: boolean; primary: boolean; verificationRecord: string; verificationValue: string; createdAt: string }
interface DomainsView { platformHost: string | null; primaryDomain: string | null; url: string; domains: DomainRow[] }
export interface DnsRecord { id: string; type: string; name: string; value: string; current: string[]; ok: boolean }
interface DnsView { host: string; target: string; records: DnsRecord[]; propagated: boolean }

/** One address of the store, whatever the mode: the permanent one, or a domain of its own. */
interface Entry { host: string; permanent: boolean; primary: boolean; id?: number; verified?: boolean }

const errText = (e: unknown) => (e instanceof ApiError ? e.message : e instanceof UserErrors ? e.errors.map((x) => x.message).join(' · ') : String(e));

/** The store's addresses and what can be done with them, in multi-store mode (own table) and single-store mode (the primary domain setting). */
function useDomainModel() {
  const { t } = useI18n();
  const toast = useToast();
  const qc = useQueryClient();
  const multi = !!useMulti();
  const multiQ = useQuery({ queryKey: ['store-domains'], enabled: multi, queryFn: () => rest<DomainsView>('/store/domains') });
  const shopQ = useShopSettings();
  const refresh = () => { void qc.invalidateQueries({ queryKey: ['store-domains'] }); void qc.invalidateQueries({ queryKey: ['store-info'] }); void qc.invalidateQueries({ queryKey: ['shop-settings'] }); void qc.invalidateQueries({ queryKey: ['domain-dns'] }); };
  const setPrimaryDomain = useMutation({
    mutationFn: (primaryDomain: string) => mutate(SHOP_UPDATE, { input: { primaryDomain } }, 'shopmeShopUpdate'),
    onSuccess: refresh,
  });
  let entries: Entry[] = [];
  let loading = multi ? multiQ.isLoading : shopQ.isLoading;
  const error = (multi ? multiQ.error : shopQ.error) as Error | null;
  let target = '';
  if (multi && multiQ.data) {
    const v = multiQ.data;
    target = v.platformHost ?? '';
    entries = [...(v.platformHost ? [{ host: v.platformHost, permanent: true, primary: !v.primaryDomain }] : []), ...v.domains.map((d) => ({ host: d.host, permanent: false, primary: d.primary, id: d.id, verified: d.verified }))];
  } else if (!multi && shopQ.data) {
    const s = shopQ.data.shop;
    target = s.myshopifyDomain;
    const custom = s.primaryDomain && s.primaryDomain.host !== s.myshopifyDomain ? s.primaryDomain.host : '';
    entries = [...(custom ? [{ host: custom, permanent: false, primary: true }] : []), { host: s.myshopifyDomain, permanent: true, primary: !custom }];
  } else loading = true;
  const view = multiQ.data;
  const fail = (e: Error) => toast(errText(e), 'critical');
  const add = useMutation({
    mutationFn: async (host: string) => { if (multi) await rest<DomainsView>('/store/domains', { body: { host } }); else await setPrimaryDomain.mutateAsync(host); },
    onSuccess: () => { refresh(); toast(t('domains.added')); },
  });
  const remove = useMutation({
    mutationFn: async (e: Entry) => { if (multi) await rest<DomainsView>(`/store/domains/${e.id}`, { method: 'DELETE' }); else await setPrimaryDomain.mutateAsync(''); },
    onSuccess: () => { refresh(); toast(t('domains.removed')); }, onError: fail,
  });
  const makePrimary = useMutation({
    mutationFn: async (e: Entry | null) => { if (multi) await rest<DomainsView>('/store/domains/primary', { method: 'PUT', body: { id: e?.id ?? null } }); else await setPrimaryDomain.mutateAsync(e?.host ?? ''); },
    onSuccess: () => { refresh(); toast(t('domains.primarySet')); }, onError: fail,
  });
  const verify = useMutation({
    mutationFn: async (e: Entry) => { if (multi && e.id != null) await rest<DomainsView>(`/store/domains/${e.id}/verify`, { body: {} }); },
    onSettled: refresh,
  });
  return { multi, entries, target, loading, error, view, add, remove, makePrimary, verify, fail };
}

function useDns(host: string | undefined, enabled = true) {
  return useQuery({ queryKey: ['domain-dns', host], enabled: !!host && enabled, retry: false, staleTime: 15_000, queryFn: () => rest<DnsView>(`/store/domain-dns?host=${encodeURIComponent(host!)}`) });
}

type Status = 'connected' | 'setup';
/** A permanent address is always connected; a domain of its own is once its DNS records are in place (and, with several stores, its ownership proven). */
function statusOf(e: Entry, dns: DnsView | undefined, multi: boolean): Status {
  if (e.permanent) return 'connected';
  if (!dns) return multi && e.verified ? 'connected' : 'setup';
  return dns.propagated && (!multi || e.verified) ? 'connected' : 'setup';
}
function StatusBadge({ status }: { status: Status }) {
  const { t } = useI18n();
  return status === 'connected' ? <Badge tone="success">{t('settings.connected')}</Badge> : <Badge tone="info">{t('dm.setupRequired')}</Badge>;
}

function DomainRowItem({ e, multi }: { e: Entry; multi: boolean }) {
  const { t } = useI18n();
  const dns = useDns(e.host, !e.permanent);
  return (
    <li className="grid grid-cols-[1fr_12rem] items-center gap-3 px-4 py-2.5 text-[13px] hover:bg-hover">
      <span className="flex min-w-0 items-center gap-2">
        <Globe className="size-4 shrink-0 text-muted" aria-hidden />
        {e.permanent ? <span className="truncate">{e.host}</span> : <Link to={`/settings/domains/${encodeURIComponent(e.host)}`} className="truncate hover:underline">{e.host}</Link>}
        {e.primary && <span className="shrink-0 rounded-md border border-line px-1.5 py-0.5 text-xs text-muted">{t('settings.primaryBadge')}</span>}
      </span>
      <span><StatusBadge status={statusOf(e, dns.data, multi)} /></span>
    </li>
  );
}

/** Settings > Domains: the store's addresses with their status; a domain of its own opens its setup page. */
export function DomainsSettings() {
  const { t } = useI18n();
  const nav = useNavigate();
  const m = useDomainModel();
  const [adding, setAdding] = useState(false);
  const [host, setHost] = useState('');
  const [error, setError] = useState<string | null>(null);
  const next = () => {
    const h = host.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    m.add.mutate(h, { onSuccess: () => { setAdding(false); setHost(''); nav(`/settings/domains/${encodeURIComponent(h)}`); }, onError: (e) => setError(errText(e)) });
  };
  if (m.loading && !m.error) return <Skeleton className="h-32" />;
  if (m.error) return <Banner>{m.error.message}</Banner>;
  return (
    <>
      <SettingsActions><button type="button" className="btn btn-secondary !rounded-full" onClick={() => { setError(null); setAdding(true); }}>{t('settings.connectDomain')}</button></SettingsActions>
      <div className="overflow-hidden rounded-xl bg-canvas p-2 shadow-card">
        <div className="grid grid-cols-[1fr_12rem] gap-3 rounded-lg bg-surface px-3 py-2 text-[13px] text-muted"><span>{t('settings.domain')}</span><span>{t('field.status')}</span></div>
        <ul>{m.entries.map((e) => <DomainRowItem key={e.host} e={e} multi={m.multi} />)}</ul>
      </div>
      <Modal open={adding} onClose={() => setAdding(false)} closeLabel={t('common.close')} title={t('settings.connectDomain')}
        footer={<><Button onClick={() => setAdding(false)}>{t('common.cancel')}</Button><Button variant="primary" loading={m.add.isPending} disabled={!host.includes('.')} onClick={next}>{t('dm.next')}</Button></>}>
        <form className="flex flex-col gap-3" onSubmit={(ev) => { ev.preventDefault(); if (host.includes('.')) next(); }}>
          {error && <Banner>{error}</Banner>}
          <Input label={t('settings.domain')} placeholder="example.com, shop.example.com" autoComplete="off" autoFocus value={host} onChange={(e) => setHost(e.target.value)} />
        </form>
      </Modal>
    </>
  );
}

/* ------------------------------ domain page ------------------------------ */

function Step({ state, title, children }: { state: 'done' | 'todo' | 'wait'; title: string; children?: React.ReactNode }) {
  return (
    <li className="px-4 py-3" data-state={state}>
      <div className={cx('flex items-center gap-2.5 text-[13px]', state === 'wait' && 'text-muted')}>
        {state === 'done' ? <span className="grid size-4 shrink-0 place-items-center rounded-full bg-success text-white"><Check className="size-3" aria-hidden /></span> : <Circle className="size-4 shrink-0 text-muted" strokeDasharray="3 3" aria-hidden />}
        <span className={cx(state !== 'wait' && 'font-medium')}>{title}</span>
      </div>
      {children}
    </li>
  );
}

function CopyValue({ value, label }: { value: string; label: string }) {
  const { t } = useI18n();
  const toast = useToast();
  return (
    <span className="inline-flex max-w-full items-center gap-1.5">
      <span className="break-all font-mono text-xs">{value}</span>
      <button type="button" aria-label={label} className="grid size-6 shrink-0 place-items-center rounded-md text-muted hover:bg-hover" onClick={() => { void navigator.clipboard?.writeText(value).then(() => toast(t('domains.copied'))).catch(() => undefined); }}><Copy className="size-3.5" aria-hidden /></button>
    </span>
  );
}

/** The records to set at the DNS provider, with what DNS says today next to what it must say. */
function RecordsTable({ records }: { records: DnsRecord[] }) {
  const { t } = useI18n();
  return (
    <div className="overflow-x-auto rounded-lg border border-line">
      <table className="w-full min-w-[34rem] text-left text-[13px]">
        <thead><tr className="border-b border-line text-muted"><th className="px-3 py-2 font-normal">{t('dm.type')}</th><th className="px-3 py-2 font-normal">{t('domains.recordName')}</th><th className="px-3 py-2 font-normal">{t('dm.current')}</th><th aria-hidden /><th className="px-3 py-2 font-normal">{t('dm.updateTo')}</th></tr></thead>
        <tbody>
          {records.map((r) => (
            <tr key={r.id} className="border-b border-line last:border-0 align-top" data-ok={r.ok}>
              <td className="px-3 py-2 font-medium">{r.type}</td>
              <td className="px-3 py-2"><CopyValue value={r.name} label={t('domains.copyName')} /></td>
              <td className="px-3 py-2 text-muted"><span className="break-all font-mono text-xs">{r.current.length ? r.current.join(', ') : t('dm.empty')}</span></td>
              <td className="px-1 py-2 text-muted" aria-hidden>{r.ok ? <Check className="size-4 text-success" /> : '→'}</td>
              <td className="px-3 py-2"><CopyValue value={r.value} label={t('domains.copyValue')} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** The page of one domain: status, then the steps to connect it (DNS records, propagation, certificate). */
export function DomainDetailPage() {
  const { t } = useI18n();
  const nav = useNavigate();
  const toast = useToast();
  const host = (useParams().host ?? '').toLowerCase();
  const m = useDomainModel();
  const dns = useDns(host);
  const [manual, setManual] = useState(true);
  const [removing, setRemoving] = useState(false);
  const entry = m.entries.find((e) => e.host === host);
  if ((m.loading && !m.error) || (entry && dns.isLoading)) return <Skeleton className="h-64" />;
  if (m.error) return <Banner>{m.error.message}</Banner>;
  if (!entry) return <Banner>{t('dm.notFound')}</Banner>;
  const d = dns.data;
  const routingOk = !!d?.records.find((r) => r.id === 'routing')?.ok;
  const ownership = d?.records.find((r) => r.id === 'verify');
  const records = d?.records ?? [];
  const status = statusOf(entry, d, m.multi);
  const step1 = status === 'connected' || (m.multi ? !!entry.verified || !!ownership?.ok : routingOk);
  const step2 = status === 'connected' || (step1 && routingOk);
  const step3 = status === 'connected';
  const recheck = async () => {
    try { await m.verify.mutateAsync(entry); } catch (e) { toast(errText(e), 'critical'); }
    const r = await dns.refetch();
    toast(r.data?.propagated ? t('domains.verified') : t('dm.notYet'));
  };
  return (
    <>
      <div className="mb-4 flex items-center gap-2">
        <Link to="/settings/domains" aria-label={t('common.back')} className="btn btn-secondary btn-icon btn-sm"><ArrowLeft className="size-4" /></Link>
        <Link to="/settings/domains" className="inline-flex items-center gap-1.5 text-[13px] text-muted hover:text-fg"><Globe className="size-4" aria-hidden />{t('settings.domains')}</Link>
        <div className="ml-auto flex items-center gap-2">
          {!entry.permanent && (
            <Dropdown align="right" chevron label={t('dm.moreActions')} trigger={t('dm.moreActions')} items={[
              ...(status === 'connected' && !entry.primary ? [{ key: 'primary', label: t('domains.makePrimary'), onSelect: () => m.makePrimary.mutate(entry) }] : []),
              { key: 'remove', label: t('dm.removeDomain'), danger: true, onSelect: () => setRemoving(true) },
            ]} />
          )}
        </div>
      </div>
      <div className="mb-4 flex flex-wrap items-center gap-2"><h1 className="text-xl font-semibold leading-8">{entry.host}</h1><StatusBadge status={status} />{entry.primary && <span className="rounded-md border border-line px-1.5 py-0.5 text-xs text-muted">{t('settings.primaryBadge')}</span>}</div>
      {dns.error && <div className="mb-3"><Banner>{errText(dns.error)}</Banner></div>}
      <div className="overflow-hidden rounded-xl bg-canvas shadow-card">
        <div className="flex items-center justify-center gap-4 bg-surface py-8" aria-hidden>
          <span className="grid size-12 place-items-center rounded-full bg-canvas text-accent shadow-card"><Store className="size-6" /></span>
          <ArrowLeftRight className="size-4 text-muted" />
          <span className="grid size-12 place-items-center rounded-full bg-canvas text-accent shadow-card"><Globe className="size-6" /></span>
        </div>
        <ol className="divide-y divide-line">
          <Step state={step1 ? 'done' : 'todo'} title={t('dm.step.records')}>
            {!step1 && (
              <div className="mt-3 flex flex-col gap-4 pl-6">
                <button type="button" aria-expanded={manual} onClick={() => setManual(!manual)} className="inline-flex items-center gap-1 self-end text-[13px]">{t('dm.manual')}<ChevronDown className={cx('size-4 transition-transform', manual && 'rotate-180')} aria-hidden /></button>
                {manual && (
                  <div className="flex flex-col gap-3 text-[13px]">
                    <p>{t('dm.manual.1', { host: entry.host })}</p>
                    <p>{t('dm.manual.2')}</p>
                    <RecordsTable records={records} />
                    <Button className="self-end" loading={m.verify.isPending || dns.isFetching} onClick={() => void recheck()}>{t('dm.updated')}</Button>
                  </div>
                )}
              </div>
            )}
          </Step>
          <Step state={step2 ? 'done' : 'wait'} title={t('dm.step.propagation')}>{step1 && !step2 && <p className="mt-2 pl-6 text-[13px] text-muted">{t('dm.propagation.help')}</p>}</Step>
          <Step state={step3 ? 'done' : 'wait'} title={t('dm.step.tls')}>{!step3 && <p className="mt-2 pl-6 text-[13px] text-muted">{t(m.multi ? 'dm.tls.auto' : 'dm.tls.proxy')}</p>}</Step>
        </ol>
      </div>
      <ConfirmDialog open={removing} danger title={t('domains.removeTitle', { host: entry.host })} message={t('domains.removeBody')} confirmLabel={t('dm.removeDomain')} cancelLabel={t('common.cancel')} closeLabel={t('common.close')}
        loading={m.remove.isPending} onConfirm={() => m.remove.mutate(entry, { onSuccess: () => nav('/settings/domains') })} onClose={() => setRemoving(false)} />
    </>
  );
}
