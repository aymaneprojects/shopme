import { Banner, Button, Modal } from '@shopme/ui';
import { useQueryClient } from '@tanstack/react-query';
import { Download, Upload } from 'lucide-react';
import { useEffect, useReducer, useRef, useState } from 'react';
import { upload } from '../api';
import { useI18n } from '../i18n';
import type { Key } from '../i18n';
import { canConfirm, idleImport, importReducer } from '../lib/csv-import';
import type { ImportKind } from '../lib/csv-import';
import { useJob } from '../lib/jobs';
import type { Job } from '../lib/jobs';

const linkCls = 'btn btn-secondary';

/** Export URL for a kind; `query` and `ids` narrow the order exports to a filter or a selection. */
export const exportHref = (kind: ImportKind | 'orders' | 'draft_orders', params: { query?: string; ids?: string } = {}) => {
  const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v)).toString();
  return `/admin/api/export/${kind}.csv${qs ? `?${qs}` : ''}`;
};
export function startDownload(href: string) {
  const a = document.createElement('a');
  a.href = href; a.download = ''; document.body.appendChild(a); a.click(); a.remove();
}

export function ExportButton({ kind }: { kind: ImportKind | 'orders' | 'draft_orders' }) {
  const { t } = useI18n();
  return <a href={`/admin/api/export/${kind}.csv`} download className={linkCls}><Download className="size-4" />{t('csv.export')}</a>;
}

/** Progress bar, per-outcome counts and the first row errors of a job. */
export function JobSummary({ job }: { job?: Job }) {
  const { t } = useI18n();
  if (!job) return null;
  const label = (k: string) => (['created', 'updated', 'skipped', 'errors', 'imported', 'failed'].includes(k) ? t(`csv.count.${k}` as Key) : k);
  return (
    <div className="flex flex-col gap-3">
      {job.progress !== undefined && job.status !== 'completed' && <div role="progressbar" aria-valuenow={Math.round(job.progress)} aria-valuemin={0} aria-valuemax={100} className="h-2 overflow-hidden rounded-full bg-line"><div className="h-full bg-primary transition-all" style={{ width: `${Math.min(100, job.progress)}%` }} /></div>}
      {job.counts && <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">{Object.entries(job.counts).map(([k, n]) => <div key={k} className="rounded-md border border-line p-2"><dt className="text-xs text-muted">{label(k)}</dt><dd className="text-lg font-semibold">{n}</dd></div>)}</dl>}
      {!!job.errors?.length && (
        <div><h3 className="mb-1 text-[13px] font-semibold">{t('csv.errors', { n: job.errors.length })}</h3>
          <ul className="max-h-48 overflow-y-auto rounded-md border border-line text-[13px]">{job.errors.slice(0, 100).map((e, i) => <li key={i} className="border-b border-line px-2 py-1 last:border-0">{e.row !== undefined && <span className="mr-2 font-mono text-xs text-muted">{t('csv.row', { n: e.row })}</span>}{e.message}</li>)}</ul></div>
      )}
    </div>
  );
}

export function ImportButton({ kind, invalidate = [] }: { kind: ImportKind; invalidate?: string[] }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}><Upload className="size-4" />{t('csv.import')}</Button>
      <ImportDialog key={String(open)} open={open} kind={kind} invalidate={invalidate} onClose={() => setOpen(false)} />
    </>
  );
}

function ImportDialog({ open, kind, invalidate, onClose }: { open: boolean; kind: ImportKind; invalidate: string[]; onClose: () => void }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const [s, dispatch] = useReducer(importReducer, idleImport);
  const started = useRef<unknown>(null);
  const running = s.step === 'dryRun' || s.step === 'importing';
  const job = useJob(running ? s.jobId : null);

  // Upload when entering dryRun / importing without a job id.
  useEffect(() => {
    if (!running || s.jobId || started.current === s) return;
    started.current = s;
    upload<{ jobId: string }>(`/import/${kind}`, s.file, s.step === 'dryRun' ? { dryRun: '1' } : {})
      .then((r) => dispatch({ type: 'started', jobId: String(r.jobId) }), (e: Error) => dispatch({ type: 'fail', message: e.message }));
  }, [s, running, kind]);
  useEffect(() => {
    if (job.data) dispatch({ type: 'job', job: job.data });
    else if (job.error) dispatch({ type: 'fail', message: job.error.message });
  }, [job.data, job.error]);
  useEffect(() => { if (s.step === 'done') for (const k of invalidate) void qc.invalidateQueries({ queryKey: [k] }); }, [s.step, invalidate, qc]);

  const pick = <input type="file" accept=".csv,text/csv" aria-label={t('csv.chooseFile')} className="block w-full text-[13px]" onChange={(e) => { const f = e.target.files?.[0]; if (f) dispatch({ type: 'pick', file: f }); e.target.value = ''; }} />;
  return (
    <Modal open={open} onClose={onClose} closeLabel={t('common.close')} wide title={t(`csv.title.${kind}` as Key)}
      footer={<>
        <Button onClick={onClose}>{s.step === 'done' ? t('common.close') : t('common.cancel')}</Button>
        {s.step === 'preview' && <Button variant="primary" disabled={!canConfirm(s.job)} onClick={() => dispatch({ type: 'confirm' })}>{t('csv.confirm')}</Button>}
      </>}>
      <div className="flex flex-col gap-3">
        {(s.step === 'idle' || s.step === 'error') && <><p className="text-[13px] text-muted">{t(`csv.help.${kind}` as Key)}</p>{pick}</>}
        {s.step === 'error' && <Banner>{s.message}</Banner>}
        {s.step === 'dryRun' && <><p className="text-[13px]">{t('csv.checking', { name: s.file.name })}</p><JobSummary job={s.job ?? { status: 'pending', progress: 0 }} /></>}
        {s.step === 'preview' && <><p className="text-[13px] font-medium">{t('csv.previewTitle', { name: s.file.name })}</p><JobSummary job={s.job} />{!canConfirm(s.job) && <Banner tone="warning">{t('csv.nothing')}</Banner>}<details className="text-[13px]"><summary className="cursor-pointer text-muted">{t('csv.chooseAnother')}</summary><div className="mt-2">{pick}</div></details></>}
        {s.step === 'importing' && <><p className="text-[13px]">{t('csv.importing')}</p><JobSummary job={s.job ?? { status: 'pending', progress: 0 }} /></>}
        {s.step === 'done' && <><Banner tone="success">{t('csv.done')}</Banner><JobSummary job={s.job} /></>}
      </div>
    </Modal>
  );
}
