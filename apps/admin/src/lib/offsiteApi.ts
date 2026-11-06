import { apiUrl, rest } from '../api';

export type OffsiteScope = 'store' | 'platform';

export interface StoragePreset { id: string; name: string; endpoint: string; region: string; pathStyle: boolean; needs?: 'account' }
export interface DestinationView {
  scope: OffsiteScope; configured: boolean; enabled: boolean;
  preset: string | null; endpoint: string; region: string; forcePathStyle: boolean; bucket: string; prefix: string; accessKeyId: string;
  secretSet: boolean; passphraseSet: boolean;
  keepDaily: number; keepWeekly: number; keepMonthly: number;
  presets: StoragePreset[]; allowPrivateEndpoints: boolean; databaseDump: 'yes' | 'no' | 'not-here';
}
export interface RunItem {
  id: number; kind: 'store' | 'database'; trigger: 'scheduled' | 'manual'; status: 'running' | 'ok' | 'retry' | 'failed'; attempts: number; bytes: number | null; encrypted: boolean;
  error: string | null; store: string | null; startedAt: string; finishedAt: string | null; nextAttemptAt: string | null; object: string | null;
}
export type OffsiteAlert = { kind: 'failed'; error: string; at: string; retrying: boolean } | { kind: 'stale'; lastOkAt: string | null };
export interface Overview { destination: DestinationView; history: RunItem[]; alert: OffsiteAlert | null }
export interface RemoteBackup { key: string; name: string; kind: 'store' | 'database'; createdAt: string; bytes: number; encrypted: boolean; subjectShopId: number | null; subjectName?: string | null }
export interface TestResult { ok: boolean; error?: string; steps: Array<{ step: 'write' | 'read' | 'delete'; ok: boolean; error?: string }> }

/** What the form sends. The secret and the passphrase are only present when the person typed one. */
export interface DestinationInput {
  enabled?: boolean; preset?: string | null; endpoint?: string; region?: string; forcePathStyle?: boolean; bucket?: string; prefix?: string; accessKeyId?: string;
  secretAccessKey?: string; passphrase?: string; clearPassphrase?: boolean; keepDaily?: number; keepWeekly?: number; keepMonthly?: number;
}

const base = (scope: OffsiteScope) => (scope === 'store' ? '/store/backups/offsite' : '/platform/backups/offsite');

/** The store's destination or the installation's (platform owner): same shapes, different routes. */
export const offsiteApi = (scope: OffsiteScope) => ({
  scope,
  overview: () => rest<Overview>(base(scope)),
  save: (input: DestinationInput) => rest<{ destination: DestinationView }>(base(scope), { method: 'PUT', body: input }),
  remove: () => rest<{ ok: true }>(base(scope), { method: 'DELETE' }),
  test: (input: DestinationInput) => rest<TestResult>(`${base(scope)}/test`, { body: input }),
  run: () => rest<{ job?: { id: number }; started?: boolean }>(`${base(scope)}/run`, { body: {} }),
  remote: () => rest<{ backups: RemoteBackup[] }>(`${base(scope)}/remote`),
  restore: (key: string) => rest<{ job: { id: number } }>(`${base(scope)}/restore`, { body: { key, confirm: 'replace' } }),
  downloadUrl: (key: string) => apiUrl(`${base(scope)}/download?key=${encodeURIComponent(key)}`),
});

export const fetchOffsiteAlert = () => rest<{ alert: OffsiteAlert | null }>('/store/backups/offsite/alert');
