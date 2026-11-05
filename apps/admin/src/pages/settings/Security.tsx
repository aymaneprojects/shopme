import { Badge, Banner, Button, Card, Input, Skeleton, Switch, useToast } from '@shopme/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { rest } from '../../api';
import { useFormat } from '../../components/shared';
import { useI18n } from '../../i18n';
import { useSession } from '../../session';

interface SessionRow { id: string; ip: string | null; userAgent: string; createdAt: string; current: boolean }
interface Security { twoFactor: { enabled: boolean; recoveryCodesLeft: number }; require2fa: boolean; canManagePolicy: boolean; sessions: SessionRow[] }
interface Setup { secret: string; otpauthUri: string; qrSvg: string }

const deviceOf = (ua: string) => {
  const browser = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : /Electron/.test(ua) ? 'ShopMe' : '';
  const os = /Windows/.test(ua) ? 'Windows' : /Mac OS X/.test(ua) ? 'macOS' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Linux/.test(ua) ? 'Linux' : '';
  return [browser, os].filter(Boolean).join(' · ');
};

function RecoveryCodes({ codes, onDone }: { codes: string[]; onDone: () => void }) {
  const { t } = useI18n();
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted">{t('security.recoveryHelp')}</p>
      <ul className="grid grid-cols-2 gap-2 rounded-md bg-surface p-3 font-mono text-sm sm:grid-cols-5" aria-label={t('security.recovery')}>{codes.map((c) => <li key={c}>{c}</li>)}</ul>
      <div className="flex gap-2">
        <Button onClick={() => void navigator.clipboard?.writeText(codes.join('\n'))}>{t('security.recovery')}</Button>
        <Button variant="primary" onClick={onDone}>{t('security.done')}</Button>
      </div>
    </div>
  );
}

function TwoFactorCard({ data, onChange }: { data: Security; onChange: () => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const { refresh } = useSession();
  const [setup, setSetup] = useState<Setup | null>(null);
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [codes, setCodes] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fail = (e: Error) => setError(e.message);
  const start = useMutation({ mutationFn: () => rest<Setup>('/auth/2fa/setup', { body: {} }), onSuccess: (r) => { setSetup(r); setError(null); }, onError: fail });
  const enable = useMutation({
    mutationFn: () => rest<{ recoveryCodes: string[] }>('/auth/2fa/enable', { body: { code } }),
    onSuccess: (r) => { setCodes(r.recoveryCodes); setSetup(null); setCode(''); setError(null); toast(t('security.enabledToast')); onChange(); void refresh(); }, onError: fail,
  });
  const disable = useMutation({
    mutationFn: () => rest('/auth/2fa/disable', { body: { password } }),
    onSuccess: () => { setPassword(''); setError(null); toast(t('security.disabledToast')); onChange(); void refresh(); }, onError: fail,
  });
  const regenerate = useMutation({
    mutationFn: () => rest<{ recoveryCodes: string[] }>('/auth/2fa/recovery-codes', { body: { password } }),
    onSuccess: (r) => { setCodes(r.recoveryCodes); setPassword(''); setError(null); onChange(); }, onError: fail,
  });
  const on = data.twoFactor.enabled;
  return (
    <Card title={t('security.2fa')} actions={<Badge tone={on ? 'success' : 'neutral'}>{t(on ? 'security.on' : 'security.off')}</Badge>}>
      <div className="flex flex-col gap-3">
        <p className="text-sm text-muted">{t('security.2faHelp')}</p>
        {error && <Banner>{error}</Banner>}
        {codes ? <RecoveryCodes codes={codes} onDone={() => setCodes(null)} /> : !on ? (
          setup ? (
            <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); enable.mutate(); }}>
              <p className="text-sm">{t('security.scan')}</p>
              <div className="flex flex-wrap items-center gap-4">
                <img alt="" width={160} height={160} className="rounded-md border border-line bg-white p-1" src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(setup.qrSvg)}`} />
                <div className="text-sm"><div className="text-muted">{t('security.key')}</div><code className="select-all break-all font-mono">{setup.secret.replace(/(.{4})/g, '$1 ').trim()}</code></div>
              </div>
              <Input className="max-w-xs" label={t('security.code')} required inputMode="numeric" autoComplete="one-time-code" maxLength={7} value={code} onChange={(e) => setCode(e.target.value)} />
              <div><Button type="submit" variant="primary" loading={enable.isPending}>{t('security.enable')}</Button></div>
            </form>
          ) : <div><Button variant="primary" loading={start.isPending} onClick={() => start.mutate()}>{t('security.setup')}</Button></div>
        ) : (
          <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); }}>
            <p className="text-sm text-muted">{t('security.recoveryLeft', { n: data.twoFactor.recoveryCodesLeft })}</p>
            <Input className="max-w-xs" type="password" autoComplete="current-password" label={t('security.password')} value={password} onChange={(e) => setPassword(e.target.value)} />
            <div className="flex flex-wrap gap-2">
              <Button disabled={!password} loading={regenerate.isPending} onClick={() => regenerate.mutate()}>{t('security.regenerate')}</Button>
              <Button variant="danger" disabled={!password} loading={disable.isPending} onClick={() => disable.mutate()}>{t('security.disable')}</Button>
            </div>
          </form>
        )}
      </div>
    </Card>
  );
}

/** Security of the signed-in account: two-step verification, shop policy and active sessions. `forced` is the enrolment-required screen. */
export function SecuritySettings({ forced = false }: { forced?: boolean }) {
  const { t } = useI18n();
  const fmt = useFormat();
  const toast = useToast();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['security'], queryFn: () => rest<Security>('/auth/security') });
  const refetch = () => void qc.invalidateQueries({ queryKey: ['security'] });
  const policy = useMutation({ mutationFn: (v: boolean) => rest('/auth/security', { method: 'PUT', body: { require2fa: v } }), onSuccess: () => { toast(t('security.requireToast')); refetch(); }, onError: (e) => toast(e.message, 'critical') });
  const revoke = useMutation({ mutationFn: (id: string) => rest(`/auth/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' }), onSuccess: () => { toast(t('security.revoked')); refetch(); }, onError: (e) => toast(e.message, 'critical') });
  const revokeOthers = useMutation({ mutationFn: () => rest('/auth/sessions/revoke-others', { body: {} }), onSuccess: () => { toast(t('security.revoked')); refetch(); } });
  const d = q.data;
  return (
    <div className="flex flex-col gap-4">
      {forced && <Banner>{t('security.setupRequired')}</Banner>}
      {q.isLoading && <Skeleton className="h-40" />}
      {q.error && <Banner>{q.error.message}</Banner>}
      {d && <TwoFactorCard data={d} onChange={refetch} />}
      {d?.canManagePolicy && !forced && (
        <Card title={t('security.require')}>
          <div className="flex flex-col gap-2"><p className="text-sm text-muted">{t('security.requireHelp')}</p><Switch checked={d.require2fa} onChange={(v) => policy.mutate(v)} label={t('security.require')} /></div>
        </Card>
      )}
      {d && !forced && (
        <Card title={t('security.sessions')} actions={d.sessions.length > 1 ? <Button size="sm" loading={revokeOthers.isPending} onClick={() => revokeOthers.mutate()}>{t('security.revokeOthers')}</Button> : undefined}>
          <p className="mb-2 text-sm text-muted">{t('security.sessionsHelp')}</p>
          <ul className="divide-y divide-line">
            {d.sessions.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
                <div className="min-w-0 flex-1">
                  <div className="font-medium">{deviceOf(s.userAgent) || t('security.unknownDevice')} {s.current && <Badge tone="info">{t('security.current')}</Badge>}</div>
                  <div className="text-xs text-muted">{s.ip ?? '—'} · {t('security.signedIn', { date: fmt.dateTime(s.createdAt) })}</div>
                </div>
                {!s.current && <Button size="sm" variant="danger" loading={revoke.isPending && revoke.variables === s.id} onClick={() => revoke.mutate(s.id)}>{t('security.revoke')}</Button>}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
