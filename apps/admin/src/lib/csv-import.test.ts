import { describe, expect, it } from 'vitest';
import { idleImport, importReducer as r } from './csv-import';
import type { ImportEvent, ImportState } from './csv-import';
import type { Job } from './jobs';

const file = new File(['a,b'], 'p.csv');
const done = (j: Partial<Job> = {}): Job => ({ status: 'completed', progress: 100, counts: { created: 2, updated: 1, errors: 1 }, errors: [{ row: 4, message: 'Bad price' }], ...j });
const run = (events: ImportEvent[], from: ImportState = idleImport) => events.reduce(r, from);

describe('csv import state machine', () => {
  it('goes idle -> dryRun -> preview with row errors', () => {
    const s = run([{ type: 'pick', file }, { type: 'started', jobId: 'j1' }, { type: 'job', job: { status: 'running', progress: 40 } }]);
    expect(s).toMatchObject({ step: 'dryRun', jobId: 'j1', job: { progress: 40 } });
    expect(r(s, { type: 'job', job: done() })).toMatchObject({ step: 'preview', job: { errors: [{ row: 4 }] } });
  });
  it('confirm runs the real import and ends in done', () => {
    const importing = run([{ type: 'pick', file }, { type: 'started', jobId: 'a' }, { type: 'job', job: done() }, { type: 'confirm' }]);
    expect(importing).toMatchObject({ step: 'importing', jobId: null });
    expect(run([{ type: 'started', jobId: 'b' }, { type: 'job', job: done() }], importing)).toMatchObject({ step: 'done' });
  });
  it('does not confirm when nothing would be imported', () => {
    const p = run([{ type: 'pick', file }, { type: 'started', jobId: 'a' }, { type: 'job', job: done({ counts: { created: 0, errors: 3 } }) }, { type: 'confirm' }]);
    expect(p.step).toBe('preview');
  });
  it('ignores job events before the job id is known; failures and reset', () => {
    const s = run([{ type: 'pick', file }]);
    expect(r(s, { type: 'job', job: done() })).toBe(s);
    expect(run([{ type: 'started', jobId: 'a' }, { type: 'job', job: { status: 'failed', error: 'Bad header' } }], s)).toEqual({ step: 'error', message: 'Bad header' });
    expect(r({ step: 'error', message: 'x' }, { type: 'reset' })).toEqual(idleImport);
  });
  it('can retry after an error', () => { expect(r({ step: 'error', message: 'x' }, { type: 'pick', file }).step).toBe('dryRun'); });
});
