// CSV import flow as a pure state machine: pick file -> dry run -> preview (errors) -> confirm -> import progress -> done.
import type { Job } from './jobs';

export type ImportKind = 'products' | 'customers' | 'inventory';
export type ImportState =
  | { step: 'idle' }
  | { step: 'dryRun'; file: File; jobId: string | null; job?: Job }
  | { step: 'preview'; file: File; job: Job }
  | { step: 'importing'; file: File; jobId: string | null; job?: Job }
  | { step: 'done'; job: Job }
  | { step: 'error'; message: string };
export type ImportEvent =
  | { type: 'pick'; file: File }
  | { type: 'started'; jobId: string }
  | { type: 'job'; job: Job }
  | { type: 'confirm' }
  | { type: 'fail'; message: string }
  | { type: 'reset' };

export const idleImport: ImportState = { step: 'idle' };
const importable = (j: Job) => Object.entries(j.counts ?? {}).filter(([k]) => !/error|skip|fail/i.test(k)).reduce((s, [, n]) => s + n, 0);
/** Whether confirming makes sense: the dry run found rows that would be imported. */
export const canConfirm = (j: Job) => importable(j) > 0 || !j.counts;
const failure = (j: Job): ImportState => ({ step: 'error', message: j.error ?? j.errors?.[0]?.message ?? 'Import failed' });

export function importReducer(s: ImportState, e: ImportEvent): ImportState {
  if (e.type === 'reset') return idleImport;
  if (e.type === 'fail') return { step: 'error', message: e.message };
  switch (s.step) {
    case 'idle': case 'error': case 'done':
      return e.type === 'pick' ? { step: 'dryRun', file: e.file, jobId: null } : s;
    case 'dryRun':
      if (e.type === 'started') return { ...s, jobId: e.jobId };
      if (e.type === 'job' && s.jobId) {
        if (e.job.status === 'failed') return failure(e.job);
        return e.job.status === 'completed' ? { step: 'preview', file: s.file, job: e.job } : { ...s, job: e.job };
      }
      return s;
    case 'preview':
      if (e.type === 'confirm') return canConfirm(s.job) ? { step: 'importing', file: s.file, jobId: null } : s;
      return e.type === 'pick' ? { step: 'dryRun', file: e.file, jobId: null } : s;
    case 'importing':
      if (e.type === 'started') return { ...s, jobId: e.jobId };
      if (e.type === 'job' && s.jobId) {
        if (e.job.status === 'failed') return failure(e.job);
        return e.job.status === 'completed' ? { step: 'done', job: e.job } : { ...s, job: e.job };
      }
      return s;
  }
}
