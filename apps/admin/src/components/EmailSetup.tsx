import { Badge, Banner, Button, Card, Input, Select, Skeleton, cx, useToast } from '@shopme/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Check, ChevronDown, ChevronRight, Circle, Copy, Mail, ShieldAlert } from 'lucide-react';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { useI18n } from '../i18n';
import type { Key } from '../i18n';
import { emailErrorText, fetchEmailHealth, lineState, platformEmailApi } from '../lib/emailApi';
import type { EmailApi, EmailHealth, EmailInput, EmailView, LastCheck, LineState, OutboxRow, RecordCheck, RecordLine, RecordsView, ServerCheck, TestResult } from '../lib/emailApi';
import { Section } from './SettingsKit';

const qk = (api: EmailApi, part: string) => ['email', api.scope, part];
const keyOf = (s: string) => s as Key;

/** Copy to the clipboard, with a fallback for pages where the clipboard API is not allowed. */
async function copyText(text: string): Promise<void> {
  try { await navigator.clipboard.writeText(text); return; } catch { /* fall back */ }
  const ta = document.createElement('textarea');
  ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
  document.body.appendChild(ta); ta.select();
  try { document.execCommand('copy'); } finally { ta.remove(); }
}

export function CopyButton({ text, what }: { text: string; what: string }) {
  const { t } = useI18n();
  const toast = useToast();
  const [done, setDone] = useState(false);
  return (
    <Button size="sm" aria-label={t('email.copyLabel', { what })} onClick={() => { void copyText(text).then(() => { setDone(true); toast(t('email.copied')); setTimeout(() => setDone(false), 1500); }); }}>
      {done ? <Check className="size-3.5" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}{t(done ? 'email.copied' : 'email.copy')}
    </Button>
  );
}

const STATE_TONE: Record<LineState, 'success' | 'attention' | 'critical' | 'neutral'> = { ok: 'success', todo: 'attention', problem: 'critical', unknown: 'neutral' };
const STATE_ICON: Record<LineState, ReactNode> = {
  ok: <Check className="size-3" aria-hidden />, todo: <Circle className="size-3" aria-hidden />, problem: <AlertTriangle className="size-3" aria-hidden />, unknown: <Circle className="size-3 opacity-50" aria-hidden />,
};
export function StatePill({ state }: { state: LineState }) {
  const { t } = useI18n();
  return <Badge tone={STATE_TONE[state]}>{STATE_ICON[state]}<span className="ml-1">{t(`email.st.${state === 'ok' ? 'ok' : state}` as Key)}</span></Badge>;
}

export function Collapse({ title, description, open, onToggle, children, testId }: { title: ReactNode; description?: ReactNode; open: boolean; onToggle: () => void; children: ReactNode; testId?: string }) {
  return (
    <section data-testid={testId} className="rounded-lg bg-canvas shadow-card">
      <button type="button" aria-expanded={open} onClick={onToggle} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-hover">
        {open ? <ChevronDown className="size-4 text-muted" aria-hidden /> : <ChevronRight className="size-4 text-muted" aria-hidden />}
        <span className="min-w-0 flex-1"><span className="block text-sm font-semibold">{title}</span>{description && <span className="block text-[13px] text-muted">{description}</span>}</span>
      </button>
      {open && <div className="flex flex-col gap-4 border-t border-line p-4">{children}</div>}
    </section>
  );
}

const mono = 'min-w-0 flex-1 break-all rounded bg-surface px-2 py-1.5 font-mono text-xs leading-5';
/** Long values (the DKIM key) scroll inside their box instead of stretching the page. */
const monoLong = `${mono} max-h-20 overflow-y-auto`;

/** One DNS line to add: what it is, Type / Name / Value with Copy buttons, and (after a check) its state with the fix in one sentence. */
function DnsLine({ line, check, keyName, relay, include }: { line: RecordLine; check?: RecordCheck; keyName: string; relay: boolean; include: string | null }) {
  const { t } = useI18n();
  const state = lineState(check);
  const code = check?.code;
  const fixParams = { ip: check?.detail ?? '', include: check?.detail ?? include ?? '', target: check?.detail ?? '' };
  const fix = check && code ? t(`email.fix.${line.id}.${code}` as Key, fixParams) : '';
  const dkimRelay = relay && line.id === 'dkim';
  return (
    <li className="flex flex-col gap-2 rounded-lg border border-line p-3" data-testid={`dns-${line.id}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-[13px] font-semibold">{t(`email.line.${line.id}` as Key)}</span>
        <StatePill state={state} />
      </div>
      <dl className="grid gap-2 text-[13px] sm:grid-cols-[3.5rem_1fr]">
        <dt className="pt-1.5 text-muted">{t('email.col.type')}</dt><dd><span className="inline-block rounded bg-surface px-2 py-1.5 font-mono text-xs">{line.type}</span></dd>
        <dt className="pt-1.5 text-muted">{t('email.col.name')}</dt><dd className="flex items-start gap-2"><code className={mono}>{line.host}</code><CopyButton text={line.host} what={`${keyName} ${t('email.col.name')}`} /></dd>
        <dt className="pt-1.5 text-muted">{t('email.col.value')}</dt><dd className="flex items-start gap-2"><code className={monoLong} tabIndex={0}>{line.value}</code><CopyButton text={line.value} what={`${keyName} ${t('email.col.value')}`} /></dd>
      </dl>
      {line.id === 'spf' && line.existing && <p className="text-xs text-muted">{t('email.line.merged')} {t('email.line.spfHelp')}</p>}
      {line.id === 'dkim' && <p className="text-xs text-muted">{t('email.line.dkimHelp')}</p>}
      {line.id === 'dmarc' && <p className="text-xs text-muted">{t('email.line.dmarcHelp')}</p>}
      {fix && <p className={cx('text-[13px]', state === 'problem' ? 'text-critical' : state === 'ok' ? 'text-success' : '')} role={state === 'problem' ? 'alert' : undefined}>{fix}</p>}
      {dkimRelay && <p className="text-[13px] text-muted">{t('email.line.relayDkim')}</p>}
    </li>
  );
}

/** The 3 lines (SPF, DKIM, DMARC) with their state, and the "Check" button. */
export function DnsLines({ api, view, showWhere = true }: { api: EmailApi; view: EmailView; showWhere?: boolean }) {
  const { t, lang } = useI18n();
  const toast = useToast();
  const qc = useQueryClient();
  const records = useQuery({ queryKey: qk(api, 'records'), queryFn: () => api.records(), retry: false });
  const [fresh, setFresh] = useState<LastCheck | null>(null);
  const last = fresh ?? view.lastCheck;
  const check = useMutation({
    mutationFn: () => api.check(),
    onSuccess: (c) => { setFresh(c); void qc.invalidateQueries({ queryKey: ['email'] }); void qc.invalidateQueries({ queryKey: ['email-health'] }); },
    onError: (e) => toast(emailErrorText(e), 'critical'),
  });
  const r = records.data;
  if (records.isLoading) return <Skeleton className="h-40" />;
  if (records.error) return <Banner>{emailErrorText(records.error)}</Banner>;
  if (!r?.domain) return <Banner tone="info">{t('email.sender.none')}</Banner>;
  const relay = r.mode === 'relay';
  const when = last ? new Date(last.at).toLocaleString(lang, { dateStyle: 'medium', timeStyle: 'short' }) : null;
  const lines = r.records.filter((l) => !(relay && l.id === 'dkim'));
  const shown = relay ? [...lines.slice(0, 1), { id: 'dkim', type: 'TXT', host: '', value: '', existing: null, problems: [] } as RecordLine, ...lines.slice(1)] : lines;
  return (
    <div className="flex flex-col gap-3">
      <p className="text-[13px] text-muted">{t('email.domain', { domain: r.domain })}</p>
      <ul className="flex flex-col gap-3">
        {shown.map((l) => (relay && l.id === 'dkim'
          ? <li key="dkim" className="flex flex-col gap-2 rounded-lg border border-line p-3"><div className="flex flex-wrap items-center justify-between gap-2"><span className="text-[13px] font-semibold">{t('email.line.dkim')}</span><StatePill state="unknown" /></div><p className="text-[13px] text-muted">{t('email.line.relayDkim')}</p></li>
          : <DnsLine key={l.id} line={l} check={last?.records.find((c) => c.id === l.id)} keyName={l.id.toUpperCase()} relay={relay} include={r.relayInclude ?? null} />))}
      </ul>
      {showWhere && <p className="text-[13px] text-muted">{t('email.where')}</p>}
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="primary" loading={check.isPending} onClick={() => check.mutate()}>{t(check.isPending ? 'email.checking' : 'email.check')}</Button>
        <span className="text-[13px] text-muted">{when ? t('email.checkedAt', { time: when }) : t('email.neverChecked')}</span>
      </div>
    </div>
  );
}

/** Plain-words result of one server check, with its fix. */
function ServerRow({ c, view }: { c: ServerCheck; view: EmailView }) {
  const { t } = useI18n();
  const state: LineState = c.status === 'ok' ? 'ok' : c.status === 'unknown' ? 'unknown' : c.status === 'warn' ? 'todo' : 'problem';
  const d = c.data as { ip?: string; name?: string; names?: string[]; listed?: Array<{ zone: string }> };
  const src = view.lastCheck?.ip.source;
  const params = { ip: d.ip ?? view.lastCheck?.ip.v4 ?? '', name: d.name ?? d.names?.[0] ?? '', zones: (d.listed ?? []).map((l) => l.zone).join(', '), source: src ? t(`email.srv.ip.source.${src}` as Key) : '' };
  return (
    <li className="flex flex-col gap-1 rounded-lg border border-line p-3" data-testid={`srv-${c.id}`}>
      <div className="flex flex-wrap items-center justify-between gap-2"><span className="text-[13px] font-semibold">{t(`email.srv.${c.id}.title` as Key)}</span><StatePill state={state} /></div>
      <p className="text-[13px]">{t(`email.srv.${c.id}.${c.code}` as Key, params)}</p>
    </li>
  );
}

function RawAnswers({ records, last }: { records: RecordsView | undefined; last: LastCheck | null }) {
  const { t } = useI18n();
  if (!last?.records.length) return null;
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-[13px] font-semibold">{t('email.records.raw')}</h3>
      <ul className="flex flex-col gap-2 text-xs">
        {last.records.map((c) => (
          <li key={c.id}><span className="font-medium">{c.host}</span><code className="mt-0.5 block break-all rounded bg-surface px-2 py-1 font-mono">{c.found ?? t('email.records.none')}</code></li>
        ))}
      </ul>
      {!records && null}
    </div>
  );
}

function KeyRotation({ api, records }: { api: EmailApi; records: RecordsView }) {
  const { t } = useI18n();
  const toast = useToast();
  const qc = useQueryClient();
  const done = (m: string) => () => { toast(t(m as Key)); void qc.invalidateQueries({ queryKey: ['email'] }); };
  const rotate = useMutation({ mutationFn: () => api.rotate(), onSuccess: done('email.key.rotated'), onError: (e) => toast(emailErrorText(e), 'critical') });
  const activate = useMutation({ mutationFn: () => api.activate(), onSuccess: done('email.key.activated'), onError: (e) => toast(emailErrorText(e), 'critical') });
  if (!records.dkim) return null;
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-[13px] font-semibold">{t('email.key.title')}</h3>
      <p className="text-[13px] text-muted">{t('email.key.current', { selector: records.dkim.selector })}</p>
      {records.pending && (
        <div className="flex flex-col gap-2 rounded-lg border border-line p-3">
          <p className="text-[13px]">{t('email.key.pending', { selector: records.pending.selector })}</p>
          <div className="flex items-start gap-2"><code className={mono}>{records.pending.host}</code><CopyButton text={records.pending.host} what="DKIM" /></div>
          <div className="flex items-start gap-2"><code className={monoLong} tabIndex={0}>{records.pending.value}</code><CopyButton text={records.pending.value} what="DKIM" /></div>
          <div><Button variant="primary" loading={activate.isPending} onClick={() => activate.mutate()}>{t('email.key.activate')}</Button></div>
        </div>
      )}
      {!records.pending && <div className="flex flex-col items-start gap-1"><Button loading={rotate.isPending} onClick={() => rotate.mutate()}>{t('email.key.rotate')}</Button><span className="text-xs text-muted">{t('email.key.help')}</span></div>}
    </div>
  );
}

/** Technical details: server checks, raw DNS answers, the server address, key rotation and the latest messages. */
export function EmailDetails({ api, view }: { api: EmailApi; view: EmailView }) {
  const { t } = useI18n();
  const toast = useToast();
  const qc = useQueryClient();
  const records = useQuery({ queryKey: qk(api, 'records'), queryFn: () => api.records(), retry: false });
  const [ip, setIp] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () => api.update({ manualPublicIp: ip ?? view.manualPublicIp }),
    onSuccess: () => { toast(t('email.mode.saved')); setIp(null); void qc.invalidateQueries({ queryKey: ['email'] }); }, onError: (e) => toast(emailErrorText(e), 'critical'),
  });
  const server = view.lastCheck?.server;
  const ipInfo = view.lastCheck?.ip;
  const ipRow: ServerCheck = { id: 'ip', status: ipInfo?.v4 || ipInfo?.v6 ? 'ok' : 'unknown', code: ipInfo?.v4 || ipInfo?.v6 ? 'ok' : 'unknown', data: { ip: [ipInfo?.v4, ipInfo?.v6].filter(Boolean).join(', ') } };
  return (
    <>
      {view.effectiveMode === 'direct' && (
        <div className="flex flex-col gap-2">
          <h3 className="text-[13px] font-semibold">{t('email.srv.title')}</h3>
          {!server ? <p className="text-[13px] text-muted">{t('email.srv.run')}</p> : <ul className="flex flex-col gap-2">{[ipRow, ...server.filter((c) => c.id !== 'ip')].map((c) => <ServerRow key={c.id} c={c} view={view} />)}</ul>}
          {!view.publicIpFromConfig && (
            <div className="flex flex-wrap items-end gap-2">
              <div className="min-w-[14rem] flex-1"><Input label={t('email.ip.manual')} help={t('email.ip.manualHelp')} value={ip ?? view.manualPublicIp} onChange={(e) => setIp(e.target.value)} placeholder="203.0.113.7" /></div>
              {ip !== null && <Button loading={save.isPending} onClick={() => save.mutate()}>{t('email.relay.save')}</Button>}
            </div>
          )}
        </div>
      )}
      <RawAnswers records={records.data} last={view.lastCheck} />
      {records.data && view.effectiveMode !== 'relay' && <KeyRotation api={api} records={records.data} />}
      <Outbox api={api} />
    </>
  );
}

const OUT_TONE = { queued: 'neutral', sending: 'info', retry: 'attention', sent: 'success', failed: 'critical' } as const;
export function Outbox({ api }: { api: EmailApi }) {
  const { t, lang } = useI18n();
  const q = useQuery({ queryKey: qk(api, 'outbox'), queryFn: () => api.outbox(), retry: false, refetchInterval: 15_000 });
  const when = (iso: string) => new Date(iso).toLocaleString(lang, { dateStyle: 'short', timeStyle: 'short' });
  return (
    <div className="flex flex-col gap-2" data-testid="email-outbox">
      <h3 className="text-[13px] font-semibold">{t('email.outbox.title')}</h3>
      {q.isLoading ? <Skeleton className="h-16" /> : !q.data?.length ? <p className="text-[13px] text-muted">{t('email.outbox.empty')}</p> : (
        <div className="overflow-x-auto rounded-lg border border-line">
          <table className="w-full min-w-[520px] text-[13px]">
            <thead className="bg-surface text-left text-muted"><tr><th className="px-3 py-2 font-medium">{t('email.outbox.to')}</th><th className="px-3 py-2 font-medium">{t('email.outbox.subject')}</th><th className="px-3 py-2 font-medium">{t('email.outbox.status')}</th><th className="px-3 py-2 font-medium">{t('email.outbox.date')}</th></tr></thead>
            <tbody className="divide-y divide-line">
              {q.data.map((m: OutboxRow) => (
                <tr key={m.id} className="align-top">
                  <td className="px-3 py-2 break-all">{m.to}</td>
                  <td className="px-3 py-2">{m.subject}{m.lastError && <span className="mt-0.5 block text-xs text-critical">{t('email.outbox.error', { error: m.lastError })}</span>}</td>
                  <td className="px-3 py-2"><Badge tone={OUT_TONE[m.status]}>{t(`email.outbox.${m.status}` as Key)}</Badge>{m.status === 'retry' && m.nextAttemptAt && <span className="mt-0.5 block text-xs text-muted">{t('email.outbox.nextTry', { time: when(m.nextAttemptAt) })}</span>}<span className="block text-xs text-muted">{m.attempts}×</span></td>
                  <td className="px-3 py-2 whitespace-nowrap text-muted">{when(m.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/** "Send a test e-mail": the address, the button, and the delivery result with the answer of the receiving server. */
export function TestSend({ api, defaultTo }: { api: EmailApi; defaultTo: string }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const [typed, setTyped] = useState<string | null>(null);
  const to = typed ?? defaultTo;
  const setTo = (v: string) => setTyped(v);
  const [result, setResult] = useState<TestResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const send = useMutation({
    mutationFn: () => api.test(to.trim()),
    onSuccess: (r) => { setError(null); setResult(r); void qc.invalidateQueries({ queryKey: ['email'] }); void qc.invalidateQueries({ queryKey: ['email-health'] }); },
    onError: (e) => { setResult(null); setError(emailErrorText(e)); },
  });
  const valid = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/.test(to.trim());
  return (
    <div className="flex flex-col gap-3" data-testid="email-test">
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-[14rem] flex-1"><Input label={t('email.test.to')} type="email" value={to} onChange={(e) => setTo(e.target.value)} autoComplete="email" /></div>
        <Button variant="primary" loading={send.isPending} disabled={!valid} onClick={() => send.mutate()}>{t(send.isPending ? 'email.test.sending' : 'email.test.send')}</Button>
      </div>
      {error && <Banner>{error}</Banner>}
      {result && (result.error === 'no_mode'
        ? <Banner tone="warning">{t('email.test.noMode')}</Banner>
        : (
          <Banner tone={result.ok ? 'success' : 'critical'}>
            <p className="font-medium">{t(result.ok ? 'email.test.ok' : 'email.test.fail')}</p>
            {result.ok && <p>{t('email.test.okHint', { to: result.to })}</p>}
            <p className="mt-1 text-xs opacity-90">{t('email.test.from', { from: result.from })}{result.mxHost ? ` · ${t('email.test.via', { server: result.mxHost })}` : ''}</p>
            {(result.response || result.error) && <p className="mt-1 text-xs"><span className="font-medium">{t('email.test.response')}:</span> <code className="break-all font-mono">{result.response ?? result.error}</code>{!result.ok && result.response && result.error ? <code className="mt-0.5 block break-all font-mono">{result.error}</code> : null}</p>}
          </Banner>
        ))}
    </div>
  );
}

/** Advanced options: the sending mode and the relay form. Relay is recommended only when a check shows direct sending will not work. */
export function AdvancedOptions({ api, view }: { api: EmailApi; view: EmailView }) {
  const { t } = useI18n();
  const toast = useToast();
  const qc = useQueryClient();
  const [form, setForm] = useState({ preset: view.relay.preset ?? 'generic', host: view.relay.host, port: String(view.relay.port ?? 587), security: view.relay.security, username: view.relay.username, password: '' });
  const [error, setError] = useState<string | null>(null);
  const done = (msg: string) => () => { setError(null); toast(t(msg as Key)); setForm((f) => ({ ...f, password: '' })); void qc.invalidateQueries({ queryKey: ['email'] }); void qc.invalidateQueries({ queryKey: ['email-health'] }); };
  const fail = (e: unknown) => setError(emailErrorText(e));
  const setMode = useMutation({ mutationFn: (mode: 'direct' | 'relay') => api.update({ mode }), onSuccess: done('email.mode.saved'), onError: fail });
  const saveRelay = useMutation({
    mutationFn: (activate: boolean) => api.update({ preset: form.preset, host: form.host.trim(), port: Number(form.port) || null, security: form.security, username: form.username, ...(form.password ? { password: form.password } : {}), ...(activate ? { mode: 'relay' as const } : {}) }),
    onSuccess: done('email.relay.saved'), onError: fail,
  });
  const clearPw = useMutation({ mutationFn: () => api.update({ clearPassword: true }), onSuccess: done('email.mode.saved'), onError: fail });
  const preset = view.relayPresets.find((p) => p.id === form.preset);
  const pick = (id: string) => { const p = view.relayPresets.find((x) => x.id === id); setForm({ ...form, preset: id, ...(p && p.host ? { host: p.host, port: String(p.port), security: p.security, username: form.username || p.username || '' } : {}) }); };
  const relayOn = view.configuredMode === 'relay' && view.relay.configured;
  const reasons = (view.lastCheck?.server ?? []).filter((c) => c.status === 'error' && (c.id === 'port25' || c.id === 'dnsbl')).map((c) => t(`email.recommend.${c.id}` as Key)).join(', ');
  return (
    <>
      {view.recommendRelay && !relayOn && <Banner tone="warning" data-testid="recommend-relay">{t('email.recommend', { reason: reasons })}</Banner>}
      {error && <Banner>{error}</Banner>}
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-[13px] font-semibold">{t('email.mode')}</legend>
        {(['direct', 'relay'] as const).map((m) => {
          const on = m === 'relay' ? relayOn : !relayOn;
          return (
            <label key={m} className={cx('flex cursor-pointer items-start gap-3 rounded-lg border p-3', on ? 'border-primary bg-surface' : 'border-line')}>
              <input type="radio" name="email-mode" className="mt-1" checked={on} onChange={() => { if (m === 'direct') setMode.mutate('direct'); else if (view.relay.configured) setMode.mutate('relay'); else saveRelay.mutate(true); }} />
              <span><span className="block text-[13px] font-medium">{t(`email.mode.${m}` as Key)}{m === 'direct' && !view.recommendRelay ? '' : ''}</span><span className="block text-[13px] text-muted">{t(`email.mode.${m}Help` as Key)}</span></span>
            </label>
          );
        })}
      </fieldset>
      {view.envFallback && !relayOn && view.configuredMode !== 'direct' && <p className="text-[13px] text-muted">{t('email.mode.env')}</p>}
      <div className="flex flex-col gap-3">
        <h3 className="text-[13px] font-semibold">{t('email.relay.title')}</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <Select label={t('email.relay.preset')} value={form.preset} onChange={(e) => pick(e.target.value)}>{view.relayPresets.map((p) => <option key={p.id} value={p.id}>{p.id === 'generic' ? t('email.relay.generic') : p.name}</option>)}</Select>
          <Select label={t('email.relay.security')} value={form.security} onChange={(e) => setForm({ ...form, security: e.target.value })}>
            <option value="starttls">{t('email.relay.starttls')}</option><option value="tls">{t('email.relay.tls')}</option><option value="none">{t('email.relay.none')}</option>
          </Select>
          <Input label={t('email.relay.host')} value={form.host} onChange={(e) => setForm({ ...form, host: e.target.value })} placeholder="smtp.example.com" autoComplete="off" spellCheck={false} />
          <Input label={t('email.relay.port')} type="number" value={form.port} onChange={(e) => setForm({ ...form, port: e.target.value })} />
          <Input label={t('email.relay.username')} value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} autoComplete="off" />
          <Input label={t('email.relay.password')} type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} autoComplete="new-password" help={view.relay.passwordSet ? t('email.relay.passwordSaved') : undefined} />
        </div>
        <p className="text-xs text-muted">{t('email.relay.help')}</p>
        {preset?.spfInclude && <p className="text-xs text-muted">{t('email.relay.spf', { include: preset.spfInclude })}</p>}
        <p className="text-xs text-muted">{t('email.relay.dns')}</p>
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" loading={saveRelay.isPending} disabled={!form.host.trim()} onClick={() => saveRelay.mutate(false)}>{t('email.relay.save')}</Button>
          {view.relay.passwordSet && <Button variant="plain" loading={clearPw.isPending} onClick={() => clearPw.mutate()}>{t('email.relay.clear')}</Button>}
        </div>
      </div>
      <div className="flex flex-col gap-1">
        <h3 className="text-[13px] font-semibold">{t('email.dmarc.rua')}</h3>
        <DmarcAddress api={api} view={view} />
      </div>
    </>
  );
}

function DmarcAddress({ api, view }: { api: EmailApi; view: EmailView }) {
  const { t } = useI18n();
  const toast = useToast();
  const qc = useQueryClient();
  const [v, setV] = useState<string | null>(null);
  const save = useMutation({ mutationFn: () => api.update({ dmarcReportEmail: v ?? '' }), onSuccess: () => { toast(t('email.mode.saved')); setV(null); void qc.invalidateQueries({ queryKey: ['email'] }); }, onError: (e) => toast(emailErrorText(e), 'critical') });
  return (
    <div className="flex flex-wrap items-end gap-2">
      <div className="min-w-[14rem] flex-1"><Input type="email" aria-label={t('email.dmarc.rua')} help={t('email.dmarc.ruaHelp')} value={v ?? view.dmarcReportEmail} onChange={(e) => setV(e.target.value)} placeholder={view.sendingDomain ? `postmaster@${view.sendingDomain}` : ''} /></div>
      {v !== null && <Button loading={save.isPending} onClick={() => save.mutate()}>{t('email.relay.save')}</Button>}
    </div>
  );
}

/** Which From is in use, in one sentence. */
export function FromStatus({ view }: { view: EmailView }) {
  const { t } = useI18n();
  const f = view.from;
  const m = view.effectiveMode;
  let text: string; let tone: 'info' | 'warning' | 'success' = 'info';
  if (m === 'log') { text = t('email.from.log'); tone = 'warning'; }
  else if (m === 'relay') text = t('email.from.relay', { host: view.relay.host, address: f?.address ?? view.sender.address ?? '' });
  else if (m === 'env') text = t('email.from.env', { address: f?.address ?? view.sender.address ?? '' });
  else if (f?.kind === 'platform') text = f.storeAddress && !view.sender.free ? t('email.from.platform', { address: f.address, reply: f.storeAddress }) : f.storeAddress ? t('email.from.platform', { address: f.address, reply: f.storeAddress }) : t('email.from.platformNoReply', { address: f.address });
  else if (f?.deliverable) { text = t('email.from.store', { address: f.address }); tone = 'success'; }
  else { text = t('email.from.none'); tone = 'warning'; }
  return (
    <div className="flex flex-col gap-2" data-testid="email-from">
      <Banner tone={tone}><span className="flex items-start gap-2"><Mail className="mt-0.5 size-4 shrink-0" aria-hidden /><span>{text}</span></span></Banner>
      {view.sender.free && <Banner tone="warning" data-testid="free-mailbox">{t('email.sender.free', { address: view.sender.address ?? '' })}</Banner>}
      {view.sender.source === 'derived' && view.sender.address && <p className="text-[13px] text-muted">{t('email.sender.derived', { address: view.sender.address })}</p>}
    </div>
  );
}

/** Everything for one identity (store or platform): from, the 3 lines, test send, details and advanced options. */
export function EmailPanel({ api, defaultTo, title, description, sections = true }: { api: EmailApi; defaultTo: string; title?: ReactNode; description?: ReactNode; sections?: boolean }) {
  const { t } = useI18n();
  const [openDetails, setOpenDetails] = useState(false);
  const [openAdv, setOpenAdv] = useState(false);
  const [openPlat, setOpenPlat] = useState(false);
  const q = useQuery({ queryKey: qk(api, 'settings'), queryFn: () => api.settings(), retry: false });
  if (q.isLoading) return <Skeleton className="h-64" />;
  if (q.error || !q.data) return <Banner>{q.error ? emailErrorText(q.error) : t('email.loadError')}</Banner>;
  const view = q.data;
  return (
    <div className="flex flex-col gap-6">
      <Section title={title ?? t('email.title')} description={description ?? t('email.intro')}>
        <Card>
          <div className="flex flex-col gap-4">
            {api.scope === 'store' && <FromStatus view={view} />}
            {api.scope === 'store' && <div><Link to="/settings/notifications" className="text-[13px] text-accent underline">{t('email.sender.change')}</Link></div>}
            <DnsLines api={api} view={view} />
          </div>
        </Card>
      </Section>
      <Section title={t('email.test.title')} description={t('email.test.help')}><Card><TestSend api={api} defaultTo={defaultTo} /></Card></Section>
      {sections && (
        <div className="flex flex-col gap-3">
          <Collapse testId="email-details" title={t('email.details')} description={t('email.details.desc')} open={openDetails} onToggle={() => setOpenDetails(!openDetails)}><EmailDetails api={api} view={view} /></Collapse>
          <Collapse testId="email-advanced" title={t('email.adv')} description={t('email.adv.desc')} open={openAdv} onToggle={() => setOpenAdv(!openAdv)}><AdvancedOptions api={api} view={view} /></Collapse>
          {api.scope === 'store' && !view.multiStore && view.platform?.domain && view.platform.domain !== view.sendingDomain && (
            <Collapse testId="email-platform" title={t('email.platform.titleSingle')} description={t('email.platform.descSingle')} open={openPlat} onToggle={() => setOpenPlat(!openPlat)}><PlatformEmail defaultTo={defaultTo} /></Collapse>
          )}
        </div>
      )}
      <Card title={t('email.receiving.title')}><p className="text-[13px] text-muted">{t('email.receiving.body')}</p></Card>
    </div>
  );
}

/** The platform's own sending identity (fallback From for stores): same lines and checks, once for the installation. */
export function PlatformEmail({ defaultTo }: { defaultTo: string }) {
  const { t } = useI18n();
  const api = platformEmailApi;
  const q = useQuery({ queryKey: qk(api, 'settings'), queryFn: () => api.settings(), retry: false });
  if (q.isLoading) return <Skeleton className="h-40" />;
  if (!q.data) return q.error ? <Banner>{emailErrorText(q.error)}</Banner> : null;
  const v = q.data;
  if (!v.sendingDomain) return <Banner tone="info">{t('email.platform.none')}</Banner>;
  return (
    <div className="flex flex-col gap-4" data-testid="platform-email">
      <Banner tone={v.auth.ok ? 'success' : 'info'}>{v.auth.ok ? t('email.platform.state.ok', { address: `no-reply@${v.sendingDomain}` }) : t('email.platform.state.todo')}</Banner>
      <DnsLines api={api} view={v} showWhere={false} />
      <TestSend api={api} defaultTo={defaultTo} />
    </div>
  );
}

/** "Can your store send e-mail?" banner, shown on the home page and in Settings while it is not in order. */
export function EmailBanner() {
  const { t } = useI18n();
  const q = useQuery<EmailHealth>({ queryKey: ['email-health'], queryFn: fetchEmailHealth, retry: false, staleTime: 60_000 });
  const h = q.data;
  if (!h || h.status === 'ok') return null;
  const reason = h.status === 'unchecked' ? 'unchecked' : (['port25', 'dnsbl', 'no_mode', 'records', 'failures', 'not_authenticated'] as const).find((r) => h.reasons.includes(r)) ?? 'not_authenticated';
  return (
    <div className="mb-4" data-testid="email-banner">
      <Banner tone={h.status === 'unchecked' ? 'info' : 'warning'}>
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <ShieldAlert className="size-4 shrink-0" aria-hidden />
          <span className="min-w-0 flex-1">{t(keyOf(`email.banner.${reason}`))}</span>
          <Link to="/settings/emails" className="font-medium underline">{t(h.status === 'unchecked' ? 'email.banner.cta' : 'email.banner.fix')}</Link>
        </span>
      </Banner>
    </div>
  );
}
