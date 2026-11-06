import { Badge, Banner, Button, Card, Checkbox, Input, Modal, Select, Skeleton, Switch, useToast } from '@shopme/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Check, CloudUpload, Download, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { ApiError } from '../api';
import { useI18n } from '../i18n';
import type { Key } from '../i18n';
import { fetchOffsiteAlert, offsiteApi } from '../lib/offsiteApi';
import type { DestinationInput, DestinationView, OffsiteAlert, OffsiteScope, RemoteBackup, RunItem, TestResult } from '../lib/offsiteApi';
import { JobBar, mb, useStoreJob } from '../lib/storeJob';
import { useFormat } from './shared';

const keyOf = (s: string) => s as Key;

/** Text of the banner: the last off-site backup failed, or none reached the bucket for 48 hours. */
export function OffsiteAlertText({ alert }: { alert: OffsiteAlert }) {
  const { t } = useI18n();
  const fmt = useFormat();
  if (alert.kind === 'failed') return <>{t('offsite.alert.failed', { error: (alert.error || t('offsite.alert.unknown')).replace(/[.\s]+$/, '') })} {t(alert.retrying ? 'offsite.alert.retry' : 'offsite.alert.check')}</>;
  return <>{t('offsite.alert.stale')} {alert.lastOkAt ? t('offsite.alert.last', { date: fmt.dateTime(alert.lastOkAt) }) : t('offsite.alert.never')}</>;
}

/** Shown on the home page and in Settings > Backup while the store's off-site backups are failing or out of date. */
export function OffsiteAlertBanner({ link }: { link?: boolean }) {
  const { t } = useI18n();
  const q = useQuery({ queryKey: ['offsite-alert'], queryFn: fetchOffsiteAlert, retry: false, staleTime: 60_000 });
  const alert = q.data?.alert;
  if (!alert) return null;
  return (
    <div className="mb-1" data-testid="offsite-banner">
      <Banner tone="critical">
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <AlertTriangle className="size-4 shrink-0" aria-hidden />
          <span className="min-w-0 flex-1"><OffsiteAlertText alert={alert} /></span>
          {link && <Link to="/settings/backup" className="font-medium underline">{t('offsite.alert.open')}</Link>}
        </span>
      </Banner>
    </div>
  );
}

const STATUS_TONE = { ok: 'success', retry: 'attention', failed: 'critical', running: 'info' } as const;

function History({ rows, platform }: { rows: RunItem[]; platform: boolean }) {
  const { t } = useI18n();
  const fmt = useFormat();
  if (rows.length === 0) return <p className="text-[13px] text-muted">{t('offsite.history.empty')}</p>;
  return (
    <ul className="divide-y divide-line" data-testid="offsite-history">
      {rows.slice(0, 8).map((r) => (
        <li key={r.id} className="flex flex-wrap items-start gap-x-3 gap-y-1 py-2 text-[13px]">
          <span className="w-40 shrink-0 text-muted">{fmt.dateTime(r.finishedAt ?? r.startedAt)}</span>
          <span className="min-w-0 flex-1">
            <span className="block">{t(r.kind === 'database' ? 'offsite.kind.database' : 'offsite.kind.store')}{platform && r.store ? ` · ${r.store}` : ''}{r.encrypted ? ` · ${t('offsite.encrypted')}` : ''}</span>
            {r.error && <span className={r.status === 'ok' ? 'block text-muted' : 'block text-critical'}>{r.error}</span>}
            {r.status === 'retry' && r.nextAttemptAt && <span className="block text-muted">{t('offsite.history.next', { when: fmt.dateTime(r.nextAttemptAt), n: r.attempts })}</span>}
          </span>
          <span className="w-16 shrink-0 text-right tabular-nums text-muted">{r.bytes ? mb(r.bytes) : '—'}</span>
          <Badge tone={STATUS_TONE[r.status]}>{t(keyOf(`offsite.status.${r.status}`))}</Badge>
        </li>
      ))}
    </ul>
  );
}

function TestOutcome({ r }: { r: TestResult }) {
  const { t } = useI18n();
  return (
    <div data-testid="offsite-test" className="flex flex-col gap-2">
      <Banner tone={r.ok ? 'success' : 'critical'}>{r.ok ? t('offsite.test.ok') : t('offsite.test.fail', { error: r.error ?? '' })}</Banner>
      <ul className="flex flex-col gap-1 text-[13px]">
        {(['write', 'read', 'delete'] as const).map((step) => {
          const s = r.steps.find((x) => x.step === step);
          return (
            <li key={step} className="flex items-center gap-2">
              {!s ? <span className="size-4 text-muted" aria-hidden>·</span> : s.ok ? <Check className="size-4 text-success" aria-hidden /> : <X className="size-4 text-critical" aria-hidden />}
              <span className={s ? undefined : 'text-muted'}>{t(keyOf(`offsite.step.${step}`))}</span>
              {s && !s.ok && s.error && <span className="text-critical">— {s.error}</span>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function RestoreDialog({ backup, onClose, onDone }: { backup: RemoteBackup | null; onClose: () => void; onDone: () => void }) {
  const { t } = useI18n();
  const fmt = useFormat();
  const qc = useQueryClient();
  const api = offsiteApi('store');
  const [agree, setAgree] = useState(false);
  const [jobId, setJobId] = useState<number | null>(null);
  const start = useMutation({ mutationFn: (key: string) => api.restore(key), onSuccess: (r) => setJobId(r.job.id) });
  const job = useStoreJob(jobId).data;
  const running = start.isPending || (jobId !== null && !job?.done);
  const done = job?.status === 'COMPLETED';
  if (done) { void qc.invalidateQueries(); }
  const date = backup ? fmt.dateTime(backup.createdAt) : '';
  const close = () => { if (running) return; setAgree(false); setJobId(null); start.reset(); if (done) onDone(); onClose(); };
  return (
    <Modal open={!!backup} onClose={close} closeLabel={t('common.close')} title={t('offsite.restore.title')} medium
      footer={done ? <Button variant="primary" onClick={close}>{t('common.close')}</Button> : <>
        <Button onClick={close} disabled={running}>{t('common.cancel')}</Button>
        <Button variant="danger" disabled={!agree} loading={running} onClick={() => backup && start.mutate(backup.key)}>{t('offsite.restore.go')}</Button>
      </>}>
      <div className="flex flex-col gap-3 text-[13px]" data-testid="offsite-restore-dialog">
        <p>{t('offsite.restore.intro', { date })}</p>
        <ul className="flex flex-col gap-1.5 pl-4 [&>li]:list-disc">
          <li><strong>{t('offsite.restore.replaced.k')}</strong> {t('offsite.restore.replaced.v')}</li>
          <li><strong>{t('offsite.restore.lost.k')}</strong> {t('offsite.restore.lost.v', { date })}</li>
          <li><strong>{t('offsite.restore.kept.k')}</strong> {t('offsite.restore.kept.v')}</li>
        </ul>
        <Banner tone="warning">{t('offsite.restore.advice')}</Banner>
        {start.error && <Banner>{start.error instanceof ApiError ? start.error.message : String(start.error)}</Banner>}
        {job?.status === 'FAILED' && <Banner>{t('backup.failed', { error: job.error ?? '' })}</Banner>}
        {done && <Banner tone="success">{t('offsite.restore.done')}</Banner>}
        {running && <><p>{t('offsite.restore.running')}</p><JobBar job={job} /></>}
        {!done && <Checkbox label={t('offsite.restore.agree')} checked={agree} onChange={(e) => setAgree(e.target.checked)} disabled={running} />}
      </div>
    </Modal>
  );
}

function Remote({ scope }: { scope: OffsiteScope }) {
  const { t } = useI18n();
  const fmt = useFormat();
  const api = useMemo(() => offsiteApi(scope), [scope]);
  const [open, setOpen] = useState(false);
  const [restoring, setRestoring] = useState<RemoteBackup | null>(null);
  const q = useQuery({ queryKey: ['offsite-remote', scope], queryFn: api.remote, enabled: open, retry: false });
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-[13px] font-semibold">{t('offsite.remote.title')}</h3>
        <Button size="sm" loading={q.isFetching} onClick={() => (open ? void q.refetch() : setOpen(true))}>{t(open ? 'offsite.remote.refresh' : 'offsite.remote.show')}</Button>
      </div>
      {q.error && <Banner>{q.error.message}</Banner>}
      {q.data && (q.data.backups.length === 0 ? <p className="text-[13px] text-muted">{t('offsite.remote.empty')}</p> : (
        <ul className="divide-y divide-line" data-testid="offsite-remote">
          {q.data.backups.slice(0, 12).map((b) => (
            <li key={b.key} className="flex flex-wrap items-center gap-2 py-2 text-[13px]">
              <span className="min-w-0 flex-1">
                <span className="block truncate font-mono text-xs">{b.name}</span>
                <span className="block text-muted">{fmt.dateTime(b.createdAt)} · {mb(b.bytes)} · {t(b.kind === 'database' ? 'offsite.kind.database' : 'offsite.kind.store')}{b.subjectName ? ` · ${b.subjectName}` : ''}{b.encrypted ? ` · ${t('offsite.encrypted')}` : ''}</span>
              </span>
              <a href={api.downloadUrl(b.key)} className="inline-flex items-center gap-1 rounded-md border border-line px-2 py-1 text-xs hover:bg-surface"><Download className="size-3.5" aria-hidden />{t('backup.download')}</a>
              {scope === 'store' && b.kind === 'store' && <Button size="sm" variant="danger" onClick={() => setRestoring(b)}>{t('offsite.restore')}</Button>}
            </li>
          ))}
        </ul>
      ))}
      {scope === 'store' && <RestoreDialog backup={restoring} onClose={() => setRestoring(null)} onDone={() => void q.refetch()} />}
    </div>
  );
}

const SECRET_DOTS = '••••••••••••';

/** Settings of one off-site destination (the store's, or the whole installation's in the platform area) with its test, history and restore. */
export function OffsiteCard({ scope }: { scope: OffsiteScope }) {
  const { t } = useI18n();
  const toast = useToast();
  const qc = useQueryClient();
  const api = useMemo(() => offsiteApi(scope), [scope]);
  const [poll, setPoll] = useState(0);
  const q = useQuery({
    queryKey: ['offsite', scope], queryFn: api.overview,
    refetchInterval: (s) => (s.state.data?.history.some((r) => r.status === 'running') || poll > Date.now() ? 2000 : false),
  });
  const [draft, setDraft] = useState<DestinationInput>({});
  const [test, setTest] = useState<TestResult | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [removing, setRemoving] = useState(false);
  const [jobId, setJobId] = useState<number | null>(null);
  const job = useStoreJob(jobId).data;
  const refresh = () => { void qc.invalidateQueries({ queryKey: ['offsite', scope] }); void qc.invalidateQueries({ queryKey: ['offsite-alert'] }); };
  const fail = (e: Error) => toast(e.message, 'critical');

  const save = useMutation({
    mutationFn: () => api.save(draft),
    onSuccess: () => { toast(t('offsite.saved')); setDraft({}); setFieldErrors({}); refresh(); },
    onError: (e) => {
      const errs = (e instanceof ApiError ? (e.body?.errors as Array<{ field: string; message: string }> | undefined) : undefined) ?? [];
      setFieldErrors(Object.fromEntries(errs.map((x) => [x.field, x.message])));
      if (!errs.length) fail(e);
    },
  });
  const testM = useMutation({ mutationFn: () => api.test(draft), onSuccess: (r) => { setTest(r); setFieldErrors({}); }, onError: (e) => { setTest(null); if (e instanceof ApiError && Array.isArray(e.body?.errors)) setFieldErrors(Object.fromEntries((e.body.errors as Array<{ field: string; message: string }>).map((x) => [x.field, x.message]))); else fail(e); } });
  const run = useMutation({
    mutationFn: api.run,
    onSuccess: (r) => { if (r.job) setJobId(r.job.id); else { setPoll(Date.now() + 60_000); toast(t('offsite.run.started')); } refresh(); },
    onError: fail,
  });
  const remove = useMutation({ mutationFn: api.remove, onSuccess: () => { setRemoving(false); setDraft({}); setTest(null); toast(t('offsite.removed')); refresh(); }, onError: fail });
  if (job?.done && jobId !== null) { setJobId(null); refresh(); if (job.status === 'COMPLETED') toast(t('offsite.run.ok')); else toast(job.error ?? t('offsite.run.fail'), 'critical'); void qc.invalidateQueries({ queryKey: ['offsite-remote', scope] }); }

  const d = q.data?.destination;
  const v = d ? { ...d, ...draft } as DestinationView & DestinationInput : null;
  const set = (patch: DestinationInput) => { setDraft((x) => ({ ...x, ...patch })); setTest(null); };
  const preset = v ? d!.presets.find((p) => p.id === v.preset) ?? null : null;
  const pickPreset = (id: string) => {
    const p = d!.presets.find((x) => x.id === id);
    if (!p) return set({ preset: null });
    set({ preset: p.id, region: p.region, endpoint: p.endpoint.replace('{region}', p.region).replace('{account}', '<account-id>'), forcePathStyle: p.pathStyle });
  };
  const setRegion = (region: string) => set({ region, ...(preset?.endpoint.includes('{region}') ? { endpoint: preset.endpoint.replace('{region}', region || preset.region).replace('{account}', v!.endpoint.match(/^https:\/\/([^.]+)\./)?.[1] ?? '<account-id>') } : {}) });
  const dirty = Object.keys(draft).length > 0;
  const platform = scope === 'platform';
  const e = (f: string) => fieldErrors[f];

  return (
    <Card title={t(platform ? 'offsite.titlePlatform' : 'offsite.title')} actions={d?.configured && !dirty ? <Button size="sm" loading={run.isPending || jobId !== null} onClick={() => run.mutate()}><CloudUpload className="size-4" aria-hidden />{t('offsite.runNow')}</Button> : undefined}>
      {q.isLoading && <Skeleton className="h-40" />}
      {q.error && <Banner>{q.error.message}</Banner>}
      {q.data && d && v && (
        <div className="flex flex-col gap-4" data-testid={`offsite-${scope}`}>
          <p className="text-[13px] text-muted">{t(platform ? 'offsite.introPlatform' : 'offsite.intro')}</p>
          {platform && q.data.alert && <Banner tone="critical"><OffsiteAlertText alert={q.data.alert} /></Banner>}
          <Switch checked={v.enabled} onChange={(on) => set({ enabled: on })} label={t('offsite.on')} />

          <div className="grid gap-3 sm:grid-cols-2">
            <Select label={t('offsite.provider')} value={v.preset ?? ''} onChange={(ev) => pickPreset(ev.target.value)} error={e('preset')}>
              <option value="">{t('offsite.provider.choose')}</option>
              {d.presets.map((p) => <option key={p.id} value={p.id}>{p.id === 'custom' ? t('offsite.provider.custom') : p.name}</option>)}
            </Select>
            <Input label={t('offsite.region')} value={v.region} onChange={(ev) => setRegion(ev.target.value)} error={e('region')} autoComplete="off" />
            <Input className="sm:col-span-2" label={t('offsite.endpoint')} value={v.endpoint} onChange={(ev) => set({ endpoint: ev.target.value })} error={e('endpoint')} autoComplete="off" spellCheck={false}
              help={preset?.needs === 'account' ? t('offsite.endpoint.account') : t('offsite.endpoint.help')} placeholder="https://s3.example.com" />
            <Checkbox className="sm:col-span-2" label={t('offsite.pathStyle')} checked={v.forcePathStyle} onChange={(ev) => set({ forcePathStyle: ev.target.checked })} />
            <Input label={t('offsite.bucket')} value={v.bucket} onChange={(ev) => set({ bucket: ev.target.value.trim() })} error={e('bucket')} autoComplete="off" spellCheck={false} />
            <Input label={t('offsite.prefix')} value={v.prefix} onChange={(ev) => set({ prefix: ev.target.value })} error={e('prefix')} help={t('offsite.prefix.help')} autoComplete="off" spellCheck={false} />
            <Input label={t('offsite.accessKey')} value={v.accessKeyId} onChange={(ev) => set({ accessKeyId: ev.target.value.trim() })} error={e('accessKeyId')} autoComplete="off" spellCheck={false} />
            <Input type="password" label={t('offsite.secret')} value={draft.secretAccessKey ?? ''} placeholder={d.secretSet ? SECRET_DOTS : ''} onChange={(ev) => set({ secretAccessKey: ev.target.value })} error={e('secretAccessKey')}
              help={d.secretSet ? t('offsite.secret.saved') : t('offsite.secret.help')} autoComplete="new-password" />
          </div>

          <fieldset className="flex flex-col gap-2 rounded-lg border border-line p-3">
            <legend className="px-1 text-[13px] font-semibold">{t('offsite.passphrase.title')}</legend>
            <Banner tone="warning"><span className="flex gap-2"><AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden /><span data-testid="offsite-passphrase-warning">{t('offsite.passphrase.warn')}</span></span></Banner>
            <Input type="password" label={t('offsite.passphrase')} value={draft.passphrase ?? ''} placeholder={d.passphraseSet ? SECRET_DOTS : ''} onChange={(ev) => set({ passphrase: ev.target.value, clearPassphrase: false })} error={e('passphrase')}
              help={d.passphraseSet ? t('offsite.passphrase.saved') : t('offsite.passphrase.help')} autoComplete="new-password" />
            {d.passphraseSet && <Checkbox label={t('offsite.passphrase.off')} checked={!!draft.clearPassphrase} onChange={(ev) => set({ clearPassphrase: ev.target.checked, passphrase: undefined })} />}
          </fieldset>

          <div className="flex flex-col gap-2">
            <h3 className="text-[13px] font-semibold">{t('offsite.retention')}</h3>
            <div className="grid max-w-md gap-3 sm:grid-cols-3">
              <Input type="number" min={1} max={365} label={t('offsite.keepDaily')} value={v.keepDaily} onChange={(ev) => set({ keepDaily: Number(ev.target.value) })} />
              <Input type="number" min={0} max={365} label={t('offsite.keepWeekly')} value={v.keepWeekly} onChange={(ev) => set({ keepWeekly: Number(ev.target.value) })} />
              <Input type="number" min={0} max={365} label={t('offsite.keepMonthly')} value={v.keepMonthly} onChange={(ev) => set({ keepMonthly: Number(ev.target.value) })} />
            </div>
            <p className="text-[13px] text-muted">{t('offsite.retention.help')}</p>
          </div>

          <p className="text-[13px] text-muted">{t(keyOf(`offsite.dump.${d.databaseDump}`))}</p>

          <div className="flex flex-wrap items-center gap-2">
            <Button variant="primary" disabled={!dirty} loading={save.isPending} onClick={() => save.mutate()}>{t('offsite.save')}</Button>
            <Button loading={testM.isPending} onClick={() => testM.mutate()}>{t('offsite.test')}</Button>
            {d.configured && <Button variant="danger" onClick={() => setRemoving(true)}>{t('offsite.remove')}</Button>}
          </div>
          {test && <TestOutcome r={test} />}
          {jobId !== null && <><p className="text-[13px]">{t('offsite.run.running')}</p><JobBar job={job} /></>}

          {d.configured && (
            <>
              <h3 className="text-[13px] font-semibold">{t('offsite.history')}</h3>
              <History rows={q.data.history} platform={platform} />
              <Remote scope={scope} />
            </>
          )}
        </div>
      )}
      <Modal open={removing} onClose={() => setRemoving(false)} closeLabel={t('common.close')} title={t('offsite.remove.title')} plain
        footer={<><Button onClick={() => setRemoving(false)}>{t('common.cancel')}</Button><Button variant="danger" loading={remove.isPending} onClick={() => remove.mutate()}>{t('offsite.remove')}</Button></>}>
        <p className="text-[13px]">{t('offsite.remove.body')}</p>
      </Modal>
    </Card>
  );
}
