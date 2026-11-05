// Background jobs (CSV import, Shopify migration): GET /admin/api/jobs/:id.
import { useQuery } from '@tanstack/react-query';
import { rest } from '../api';

export interface JobError { row?: number; message: string }
export interface Job { status: 'pending' | 'running' | 'completed' | 'failed'; progress?: number; counts?: Record<string, number>; errors?: JobError[]; error?: string }
export const isTerminal = (j?: Job) => j?.status === 'completed' || j?.status === 'failed';

/** Polls a job once a second until it completes or fails. */
export function useJob(jobId: string | null) {
  return useQuery({
    queryKey: ['job', jobId], enabled: !!jobId, gcTime: 0,
    queryFn: () => rest<Job>(`/jobs/${jobId}`),
    refetchInterval: (q) => (isTerminal(q.state.data) || q.state.error ? false : 1000),
  });
}
