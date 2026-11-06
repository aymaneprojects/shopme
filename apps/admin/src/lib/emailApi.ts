import { UserErrors, gql, mutate, rest } from '../api';
import { EMAIL_CHECK, EMAIL_DKIM_ACTIVATE, EMAIL_DKIM_ROTATE, EMAIL_HEALTH, EMAIL_OUTBOX, EMAIL_RECORDS, EMAIL_SEND_TEST, EMAIL_SETTINGS, EMAIL_SETTINGS_UPDATE } from '../graphql';

export type CheckStatus = 'ok' | 'warn' | 'error' | 'unknown';
export interface RecordCheck { id: 'spf' | 'dkim' | 'dmarc'; status: CheckStatus; code: string; host: string; found: string | null; detail: string | null }
export interface ServerCheck { id: 'port25' | 'ptr' | 'dnsbl' | 'ip'; status: CheckStatus; code: string; data: Record<string, unknown> }
export interface LastCheck { at: string; mode: 'direct' | 'relay'; domain: string | null; records: RecordCheck[]; server: ServerCheck[] | null; ip: { v4: string | null; v6: string | null; source: string | null } }
export interface RelayPreset { id: string; name: string; host: string; port: number; security: 'tls' | 'starttls' | 'none'; spfInclude: string | null; username?: string }
export type EmailMode = 'direct' | 'relay' | 'env' | 'log';

export interface EmailView {
  scope: 'store' | 'platform';
  configuredMode: 'direct' | 'relay' | null;
  effectiveMode: EmailMode;
  sender: { address: string | null; domain: string | null; source: 'sender' | 'derived' | null; free: boolean };
  sendingDomain: string | null;
  relay: { preset: string | null; host: string; port: number | null; security: string; username: string; passwordSet: boolean; configured: boolean };
  relayPresets: RelayPreset[];
  manualPublicIp: string; dmarcReportEmail: string; publicIpFromConfig: boolean; envFallback: boolean;
  from: { kind: 'store' | 'platform'; address: string; reason: string; deliverable: boolean; storeAddress: string | null } | null;
  platform: { domain: string | null; address: string | null; authenticated: boolean } | null;
  multiStore: boolean;
  auth: { ok: boolean; domain: string | null; checkedAt: string | null };
  lastCheck: LastCheck | null;
  recommendRelay: boolean;
}
export interface RecordLine { id: 'spf' | 'dkim' | 'dmarc'; type: 'TXT'; host: string; value: string; existing: string | null; problems: string[] }
export interface KeyLine { selector: string; host: string; value: string }
export interface RecordsView { domain: string | null; mode: 'direct' | 'relay'; ip: { v4: string | null; v6: string | null; source: string | null }; records: RecordLine[]; dkim: KeyLine | null; pending: KeyLine | null; relayInclude?: string | null }
export interface TestResult { ok: boolean; status: string; response: string | null; error: string | null; messageId: string; mode: EmailMode; mxHost: string | null; from: string; to: string }
export interface OutboxRow { id: number; to: string; from: string; subject: string; mode: string; status: 'queued' | 'sending' | 'retry' | 'sent' | 'failed'; attempts: number; lastError: string | null; lastResponse: string | null; mxHost: string | null; messageId: string; nextAttemptAt: string | null; createdAt: string; sentAt: string | null }
export interface EmailHealth { status: 'ok' | 'unchecked' | 'problem'; reasons: string[]; effectiveMode: EmailMode; fromKind: 'store' | 'platform'; done: boolean }
export interface EmailInput { mode?: 'direct' | 'relay' | ''; preset?: string; host?: string; port?: number | null; security?: string; username?: string; password?: string; clearPassword?: boolean; manualPublicIp?: string; dmarcReportEmail?: string }

/** One e-mail identity: the store (GraphQL) or the installation (platform REST routes). Both give the same shapes. */
export interface EmailApi {
  scope: 'store' | 'platform';
  settings(): Promise<EmailView>;
  records(): Promise<RecordsView>;
  check(): Promise<LastCheck>;
  update(input: EmailInput): Promise<EmailView>;
  rotate(): Promise<RecordsView>;
  activate(): Promise<RecordsView>;
  test(to: string): Promise<TestResult>;
  outbox(): Promise<OutboxRow[]>;
}

export const storeEmailApi: EmailApi = {
  scope: 'store',
  settings: async () => (await gql<{ shopmeEmailSettings: EmailView }>(EMAIL_SETTINGS)).shopmeEmailSettings,
  records: async () => (await gql<{ shopmeEmailRecords: RecordsView }>(EMAIL_RECORDS)).shopmeEmailRecords,
  check: async () => (await mutate<{ check: LastCheck }>(EMAIL_CHECK, {}, 'shopmeEmailCheck')).check,
  update: async (input) => (await mutate<{ settings: EmailView }>(EMAIL_SETTINGS_UPDATE, { input }, 'shopmeEmailSettingsUpdate')).settings,
  rotate: async () => (await mutate<{ records: RecordsView }>(EMAIL_DKIM_ROTATE, {}, 'shopmeEmailDkimRotate')).records,
  activate: async () => (await mutate<{ records: RecordsView }>(EMAIL_DKIM_ACTIVATE, {}, 'shopmeEmailDkimActivate')).records,
  test: async (to) => (await mutate<{ result: TestResult }>(EMAIL_SEND_TEST, { to }, 'shopmeEmailSendTest')).result,
  outbox: async () => (await gql<{ shopmeEmailOutbox: OutboxRow[] }>(EMAIL_OUTBOX, { first: 15 })).shopmeEmailOutbox,
};

const P = '/platform/email';
export const platformEmailApi: EmailApi = {
  scope: 'platform',
  settings: () => rest<EmailView>(`${P}/settings`),
  records: () => rest<RecordsView>(`${P}/records`),
  check: () => rest<LastCheck>(`${P}/check`, { body: {} }),
  update: (input) => rest<EmailView>(`${P}/settings`, { method: 'PUT', body: { ...input, mode: input.mode || null } }),
  rotate: () => rest<RecordsView>(`${P}/dkim/rotate`, { body: {} }),
  activate: () => rest<RecordsView>(`${P}/dkim/activate`, { body: {} }),
  test: (to) => rest<TestResult>(`${P}/test`, { body: { to } }),
  outbox: async () => (await rest<{ messages: OutboxRow[] }>(`${P}/outbox`)).messages,
};

export const fetchEmailHealth = async () => (await gql<{ shopmeEmailHealth: EmailHealth }>(EMAIL_HEALTH)).shopmeEmailHealth;
export const emailErrorText = (e: unknown) => (e instanceof UserErrors ? e.errors.map((x) => x.message).join(' · ') : (e as Error).message);

/** What the merchant sees for a record: done, to do (not found), problem (found but wrong), not checked. */
export type LineState = 'ok' | 'todo' | 'problem' | 'unknown';
export function lineState(c: RecordCheck | undefined): LineState {
  if (!c) return 'unknown';
  if (c.status === 'ok') return 'ok';
  if (c.status === 'unknown') return 'unknown';
  if (['missing', 'no_key', 'include_missing', 'relay'].includes(c.code) || c.status === 'warn') return 'todo';
  return 'problem';
}
