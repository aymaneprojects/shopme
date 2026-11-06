import { Banner, Button, Card, Checkbox, Input, Skeleton, Switch, useToast } from '@shopme/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, Upload } from 'lucide-react';
import { useRef, useState } from 'react';
import { ApiError, apiUrl, rest } from '../../api';
import { useFormat } from '../../components/shared';
import { useI18n } from '../../i18n';
import { JobBar, mb, useStoreJob } from '../../lib/storeJob';
import { OffsiteAlertBanner, OffsiteCard } from '../../components/OffsiteBackup';

interface Backups { settings: { enabled: boolean; intervalHours: number; keep: number }; directory: string; backups: Array<{ name: string; bytes: number; createdAt: string }> }

function ExportCard() {
  const { t } = useI18n();
  const [jobId, setJobId] = useState<number | null>(null);
  const start = useMutation({ mutationFn: () => rest<{ job: { id: number } }>('/store/export', { body: {} }), onSuccess: (r) => setJobId(r.job.id) });
  const job = useStoreJob(jobId).data;
  const done = job?.status === 'COMPLETED';
  return (
    <Card title={t('backup.export')}>
      <div className="flex flex-col gap-3">
        <p className="text-[13px] text-muted">{t('backup.exportHelp')}</p>
        {start.error && <Banner>{start.error.message}</Banner>}
        {job?.status === 'FAILED' && <Banner>{t('backup.failed', { error: job.error ?? '' })}</Banner>}
        {jobId !== null && !job?.done && <><p className="text-[13px]">{t('backup.preparing')}</p><JobBar job={job} /></>}
        {done && (
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-[13px]">{t('backup.ready', { size: mb(job.result?.details?.bytes ?? 0) })}</p>
            <a href={apiUrl(`/store/export/${jobId}/download`)} className="btn btn-primary"><Download className="size-4" />{t('backup.download')}</a>
          </div>
        )}
        <div><Button variant="primary" loading={start.isPending || (jobId !== null && !job?.done)} onClick={() => { setJobId(null); start.mutate(); }}>{t('backup.exportStart')}</Button></div>
      </div>
    </Card>
  );
}

function ImportCard() {
  const { t } = useI18n();
  const qc = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [needsConfirm, setNeedsConfirm] = useState(false);
  const [jobId, setJobId] = useState<number | null>(null);
  const start = useMutation({
    mutationFn: async () => {
      const body = new FormData();
      if (confirm) body.append('confirm', 'replace'); // fields must precede the file
      body.append('file', file!);
      const res = await fetch(apiUrl('/store/import'), { method: 'POST', credentials: 'same-origin', body });
      const json = (await res.json().catch(() => ({}))) as { error?: string; needsConfirm?: boolean; job?: { id: number } };
      if (!res.ok) { setNeedsConfirm(!!json.needsConfirm); throw new ApiError(json.error ?? `HTTP ${res.status}`, res.status); }
      return json.job!.id;
    },
    onSuccess: (id) => { setJobId(id); setNeedsConfirm(false); },
  });
  const job = useStoreJob(jobId).data;
  const running = jobId !== null && !job?.done;
  if (job?.status === 'COMPLETED') void qc.invalidateQueries();
  return (
    <Card title={t('backup.import')}>
      <div className="flex flex-col gap-3">
        <p className="text-[13px] text-muted">{t('backup.importHelp')}</p>
        {start.error && <Banner>{needsConfirm ? t('backup.importNeedsConfirm') : start.error.message}</Banner>}
        {job?.status === 'FAILED' && <Banner>{t('backup.failed', { error: job.error ?? '' })}</Banner>}
        {job?.status === 'COMPLETED' && <Banner tone="success">{t('backup.imported')}</Banner>}
        {running && <><p className="text-[13px]">{t('backup.importing')}</p><JobBar job={job} /></>}
        <input ref={input} type="file" accept=".shopme,application/zip" className="hidden" aria-label={t('backup.importChoose')} onChange={(e) => { setFile(e.target.files?.[0] ?? null); setJobId(null); }} />
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={() => input.current?.click()}><Upload className="size-4" />{t('backup.importChoose')}</Button>
          {file && <span className="text-[13px] text-muted">{file.name} ({mb(file.size)})</span>}
        </div>
        {file && <Checkbox label={t('backup.importReplace')} checked={confirm} onChange={(e) => setConfirm(e.target.checked)} />}
        <div><Button variant="danger" disabled={!file || !confirm} loading={start.isPending || running} onClick={() => start.mutate()}>{t('backup.importStart')}</Button></div>
      </div>
    </Card>
  );
}

function AutoCard() {
  const { t } = useI18n();
  const toast = useToast();
  const fmt = useFormat();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['backups'], queryFn: () => rest<Backups>('/store/backups') });
  const [edit, setEdit] = useState<Backups['settings'] | null>(null);
  const [jobId, setJobId] = useState<number | null>(null);
  const job = useStoreJob(jobId).data;
  const refresh = () => void qc.invalidateQueries({ queryKey: ['backups'] });
  const save = useMutation({ mutationFn: (s: Backups['settings']) => rest('/store/backups/settings', { method: 'PUT', body: s }), onSuccess: () => { toast(t('backup.saved')); setEdit(null); refresh(); }, onError: (e) => toast(e.message, 'critical') });
  const now = useMutation({ mutationFn: () => rest<{ job: { id: number } }>('/store/backups', { body: {} }), onSuccess: (r) => setJobId(r.job.id), onError: (e) => toast(e.message, 'critical') });
  const del = useMutation({ mutationFn: (name: string) => rest(`/store/backups/${encodeURIComponent(name)}`, { method: 'DELETE' }), onSuccess: () => { toast(t('backup.deleted')); refresh(); } });
  if (job?.done && jobId !== null) { setJobId(null); refresh(); }
  const s = edit ?? q.data?.settings;
  return (
    <Card title={t('backup.auto')} actions={<Button size="sm" loading={now.isPending || jobId !== null} onClick={() => now.mutate()}>{t('backup.now')}</Button>}>
      {q.isLoading && <Skeleton className="h-24" />}
      {q.error && <Banner>{q.error.message}</Banner>}
      {q.data && s && (
        <div className="flex flex-col gap-3">
          <p className="text-[13px] text-muted">{t('backup.autoHelp', { dir: q.data.directory })}</p>
          <Switch checked={s.enabled} onChange={(v) => setEdit({ ...s, enabled: v })} label={t('backup.autoOn')} />
          <div className="grid max-w-md gap-3 sm:grid-cols-2">
            <Input type="number" min={1} max={720} label={t('backup.every')} value={s.intervalHours} onChange={(e) => setEdit({ ...s, intervalHours: Number(e.target.value) })} />
            <Input type="number" min={1} max={60} label={t('backup.keep')} value={s.keep} onChange={(e) => setEdit({ ...s, keep: Number(e.target.value) })} />
          </div>
          {edit && <div><Button variant="primary" loading={save.isPending} onClick={() => save.mutate(edit)}>{t('save.save')}</Button></div>}
          <h3 className="mt-2 text-[13px] font-semibold">{t('backup.list')}</h3>
          {q.data.backups.length === 0 ? <p className="text-[13px] text-muted">{t('backup.empty')}</p> : (
            <ul className="divide-y divide-line">
              {q.data.backups.map((b) => (
                <li key={b.name} className="flex flex-wrap items-center gap-2 py-2 text-[13px]">
                  <span className="min-w-0 flex-1 truncate font-mono text-xs">{b.name}</span><span className="text-muted">{fmt.dateTime(b.createdAt)} · {mb(b.bytes)}</span>
                  <a href={apiUrl(`/store/backups/${encodeURIComponent(b.name)}`)} className="rounded-md border border-line px-2 py-1 text-xs hover:bg-surface">{t('backup.download')}</a>
                  <Button size="sm" variant="danger" onClick={() => del.mutate(b.name)}>{t('backup.delete')}</Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Card>
  );
}

export function BackupSettings() {
  const { t } = useI18n();
  return (
    <div className="flex flex-col gap-4">
      <p className="text-[13px] text-muted">{t('backup.intro')}</p>
      <OffsiteAlertBanner />
      <ExportCard />
      <AutoCard />
      <OffsiteCard scope="store" />
      <ImportCard />
    </div>
  );
}
