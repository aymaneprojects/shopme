import { and, eq } from 'drizzle-orm';
import type { Db } from '../db/client';
import { jobs } from '../db/schema';

export interface JobError { row?: number; message: string }
export interface JobCounts { created: number; updated: number; skipped: number; failed: number }
/** Stored in `jobs.result`; returned as `result` by `GET /admin/api/jobs/:id`. */
export interface JobResult {
  dryRun?: boolean;
  progress: { processed: number; total: number | null; phase?: string };
  counts: JobCounts;
  /** First 200 errors (`errorCount` is the total). */
  errors: JobError[];
  errorCount: number;
  /** Free-form per-resource counts (migration). */
  details?: Record<string, unknown>;
}

export const emptyResult = (dryRun?: boolean): JobResult => ({ dryRun, progress: { processed: 0, total: null }, counts: { created: 0, updated: 0, skipped: 0, failed: 0 }, errors: [], errorCount: 0 });

export async function createJob(db: Db, shopId: number, type: string, dryRun?: boolean): Promise<number> {
  const [r] = await db.insert(jobs).values({ shopId, type, status: 'RUNNING', result: emptyResult(dryRun) }).returning({ id: jobs.id });
  return r!.id;
}

export async function getJob(db: Db, shopId: number, id: number) {
  const [r] = await db.select().from(jobs).where(and(eq(jobs.shopId, shopId), eq(jobs.id, id)));
  return r ?? null;
}

/** Accumulates progress in memory and flushes it to the job row at most every 500ms. */
export class JobReporter {
  readonly result: JobResult;
  private last = 0;
  constructor(private db: Db, readonly jobId: number, dryRun?: boolean) { this.result = emptyResult(dryRun); }
  count(k: keyof JobCounts, n = 1) { this.result.counts[k] += n; }
  error(message: string, row?: number) {
    this.result.errorCount++;
    if (this.result.errors.length < 200) this.result.errors.push({ row, message });
  }
  async progress(processed: number, total?: number | null, phase?: string) {
    this.result.progress = { processed, total: total ?? this.result.progress.total, phase: phase ?? this.result.progress.phase };
    if (Date.now() - this.last > 500) await this.flush();
  }
  async flush() {
    this.last = Date.now();
    await this.db.update(jobs).set({ result: this.result }).where(eq(jobs.id, this.jobId));
  }
  async finish(error?: string) {
    await this.db.update(jobs).set({ result: this.result, status: error ? 'FAILED' : 'COMPLETED', done: true, error: error ?? null, finishedAt: new Date() }).where(eq(jobs.id, this.jobId));
  }
}
