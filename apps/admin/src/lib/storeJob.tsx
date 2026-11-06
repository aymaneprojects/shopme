import { useQuery } from '@tanstack/react-query';
import { rest } from '../api';

export interface StoreJob { id: number; status: string; done: boolean; error: string | null; result: { progress?: { processed: number; total: number | null }; details?: { file?: string; bytes?: number } } | null }

export const mb = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1e3))} kB`);

/** Polls a store job until it is done. */
export function useStoreJob(id: number | null) {
  return useQuery({
    queryKey: ['store-job', id], enabled: id !== null, gcTime: 0,
    queryFn: async () => (await rest<{ job: StoreJob }>(`/store/jobs/${id}`)).job,
    refetchInterval: (q) => (q.state.data?.done || q.state.error ? false : 700),
  });
}

export function JobBar({ job }: { job?: StoreJob }) {
  const p = job?.result?.progress;
  const pct = p?.total ? Math.round((p.processed / p.total) * 100) : 5;
  return <div role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} className="h-2 overflow-hidden rounded-full bg-line"><div className="h-full bg-primary transition-all" style={{ width: `${pct}%` }} /></div>;
}
