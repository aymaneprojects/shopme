import { Badge, Banner, Button, Input, Modal, Skeleton, useToast } from '@shopme/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Fingerprint, Monitor, PlusCircle, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import type { FormEvent } from 'react';
import { rest } from '../../api';
import { useAuthMethods } from '../../components/AuthShell';
import { useFormat } from '../../components/shared';
import { useI18n } from '../../i18n';
import { isCancelled, passkeysUsable, registerPasskey } from '../../lib/passkeys';
import { useSession } from '../../session';
import { AccountSection, accountCard } from '../account/AccountLayout';

interface SessionRow { id: string; ip: string | null; userAgent: string; createdAt: string; current: boolean }
interface PasskeyRow { id: number; name: string; createdAt: string; lastUsedAt: string | null; backedUp: boolean }
export interface Security { twoFactor: { enabled: boolean; recoveryCodesLeft: number }; passkeys: PasskeyRow[]; requireSecureLogin: boolean; require2fa: boolean; canManagePolicy: boolean; sessions: SessionRow[] }
interface Setup { secret: string; otpauthUri: string; qrSvg: string }

const PASSKEY_HELP = 'https://github.com/aymaneprojects/shopme/blob/main/docs/install/sign-in.md';

export const useSecurity = () => useQuery({ queryKey: ['security'], queryFn: () => rest<Security>('/auth/security') });

const deviceOf = (ua: string) => {
  const browser = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : /Electron/.test(ua) ? 'ShopMe' : '';
  const os = /Windows/.test(ua) ? 'Windows' : /Mac OS X/.test(ua) ? 'macOS' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Linux/.test(ua) ? 'Linux' : '';
  return browser && os ? `${browser} · ${os}` : browser || os;
};

/**
 * "Verify your account to continue": the identity re-check before a sensitive change. The password is checked by the server, then handed
 * to `onVerified` (the changes themselves ask for it again on the server).
 */
export function VerifyIdentity({ open, onClose, onVerified }: { open: boolean; onClose: () => void; onVerified: (password: string) => void }) {
  const { t } = useI18n();
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const check = useMutation({
    mutationFn: () => rest('/auth/verify', { body: { password } }),
    onSuccess: () => { const p = password; setPassword(''); setError(null); onVerified(p); },
    onError: (e) => setError(e.message),
  });
  const close = () => { setPassword(''); setError(null); onClose(); };
  return (
    <Modal open={open} onClose={close} closeLabel={t('common.close')} title={t('acc.verify.title')} medium
      footer={<><Button onClick={close}>{t('common.cancel')}</Button><Button variant="primary" type="submit" form="verify-identity" loading={check.isPending} disabled={!password}>{t('acc.verify.button')}</Button></>}>
      <form id="verify-identity" className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); check.mutate(); }}>
        <p className="text-[13px] text-muted">{t('acc.verify.text')}</p>
        {error && <Banner>{error}</Banner>}
        <Input label={t('acc.verify.password')} type="password" autoComplete="current-password" autoFocus required value={password} onChange={(e) => setPassword(e.target.value)} />
      </form>
    </Modal>
  );
}

function RecoveryCodes({ codes, onDone }: { codes: string[]; onDone: () => void }) {
  const { t } = useI18n();
  return (
    <div className="flex flex-col gap-3 p-4">
      <p className="text-[13px] text-muted">{t('security.recoveryHelp')}</p>
      <ul className="grid grid-cols-2 gap-2 rounded-md bg-surface p-3 font-mono text-[13px] sm:grid-cols-3" aria-label={t('security.recovery')}>{codes.map((c) => <li key={c}>{c}</li>)}</ul>
      <div className="flex gap-2">
        <Button onClick={() => void navigator.clipboard?.writeText(codes.join('\n'))}>{t('security.recovery')}</Button>
        <Button variant="primary" onClick={onDone}>{t('security.done')}</Button>
      </div>
    </div>
  );
}

/** Two-step authentication: what it is and a button to turn it on; the authenticator setup; and, once on, the recovery codes and turning it off. */
function TwoFactorSection({ data, onChange }: { data: Security; onChange: () => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const { refresh } = useSession();
  const [verify, setVerify] = useState<null | 'enable' | 'disable' | 'regenerate'>(null);
  const [setup, setSetup] = useState<Setup | null>(null);
  const [code, setCode] = useState('');
  const [codes, setCodes] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fail = (e: Error) => setError(e.message);
  const start = useMutation({ mutationFn: () => rest<Setup>('/auth/2fa/setup', { body: {} }), onSuccess: (r) => { setSetup(r); setError(null); }, onError: fail });
  const enable = useMutation({
    mutationFn: () => rest<{ recoveryCodes: string[] }>('/auth/2fa/enable', { body: { code } }),
    onSuccess: (r) => { setCodes(r.recoveryCodes); setSetup(null); setCode(''); setError(null); toast(t('security.enabledToast')); onChange(); void refresh(); }, onError: fail,
  });
  const disable = useMutation({
    mutationFn: (password: string) => rest('/auth/2fa/disable', { body: { password } }),
    onSuccess: () => { setError(null); toast(t('security.disabledToast')); onChange(); void refresh(); }, onError: fail,
  });
  const regenerate = useMutation({
    mutationFn: (password: string) => rest<{ recoveryCodes: string[] }>('/auth/2fa/recovery-codes', { body: { password } }),
    onSuccess: (r) => { setCodes(r.recoveryCodes); setError(null); onChange(); }, onError: fail,
  });
  const on = data.twoFactor.enabled;
  const verified = (password: string) => {
    const what = verify;
    setVerify(null);
    if (what === 'enable') start.mutate();
    else if (what === 'disable') disable.mutate(password);
    else if (what === 'regenerate') regenerate.mutate(password);
  };
  return (
    <AccountSection title={t('acc.2fa')}>
      <div className={accountCard}>
        <div className="flex flex-col gap-1 p-4">
          <div className="flex flex-wrap items-center gap-2"><h3 className="text-sm font-semibold">{t('acc.2faMethods')}</h3><Badge tone={on ? 'success' : 'neutral'}>{t(on ? 'acc.2faOn' : 'acc.2faOff')}</Badge></div>
          <p className="text-[13px] text-muted">{t('acc.2faIntro')}</p>
        </div>
        <div className="flex flex-col gap-3 border-t border-line">
          {error && <div className="px-4 pt-4"><Banner>{error}</Banner></div>}
          {codes ? <RecoveryCodes codes={codes} onDone={() => setCodes(null)} /> : setup ? (
            <form className="flex flex-col gap-3 p-4" onSubmit={(e: FormEvent) => { e.preventDefault(); enable.mutate(); }}>
              <p className="text-[13px]">{t('security.scan')}</p>
              <div className="flex flex-wrap items-center gap-4">
                <img alt="" width={160} height={160} className="rounded-md border border-line bg-white p-1" src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(setup.qrSvg)}`} />
                <div className="text-[13px]"><div className="text-muted">{t('security.key')}</div><code className="select-all break-all font-mono">{setup.secret.replace(/(.{4})/g, '$1 ').trim()}</code></div>
              </div>
              <Input className="max-w-xs" label={t('security.code')} required inputMode="numeric" autoComplete="one-time-code" maxLength={7} value={code} onChange={(e) => setCode(e.target.value)} />
              <div className="flex gap-2"><Button type="submit" variant="primary" loading={enable.isPending}>{t('security.enable')}</Button><Button onClick={() => { setSetup(null); setCode(''); }}>{t('common.cancel')}</Button></div>
            </form>
          ) : !on ? (
            <div className="flex flex-col gap-3 p-4">
              <div className="flex gap-3"><ShieldCheck className="mt-0.5 size-8 shrink-0 text-muted" aria-hidden /><p className="text-[13px]">{t('acc.2faWhy')}</p></div>
              <div>
                <h4 className="text-[11px] font-semibold uppercase tracking-wide">{t('acc.2faHow')}</h4>
                <p className="mt-1 text-[13px]">{t('acc.2faWhen')}</p>
                <ol className="mt-1 list-decimal space-y-1 pl-5 text-[13px]"><li>{t('acc.2faStep1')}</li><li>{t('acc.2faStep2')}</li></ol>
              </div>
              <div><Button loading={start.isPending} onClick={() => setVerify('enable')}>{t('acc.2faEnable')}</Button></div>
            </div>
          ) : (
            <div className="flex flex-col gap-3 p-4">
              <p className="text-[13px] text-muted">{t('acc.2faRecoveryLeft', { n: data.twoFactor.recoveryCodesLeft })}</p>
              <div className="flex flex-wrap gap-2">
                <Button loading={regenerate.isPending} onClick={() => setVerify('regenerate')}>{t('acc.2faRegenerate')}</Button>
                <Button variant="danger" loading={disable.isPending} onClick={() => setVerify('disable')}>{t('acc.2faDisable')}</Button>
              </div>
            </div>
          )}
        </div>
      </div>
      <VerifyIdentity open={verify !== null} onClose={() => setVerify(null)} onVerified={verified} />
    </AccountSection>
  );
}

/** Passkeys of the account: the list (synced or not, creation date, delete) and a dashed button to add one after the identity re-check. */
function PasskeysSection({ data, onChange }: { data: Security; onChange: () => void }) {
  const { t } = useI18n();
  const fmt = useFormat();
  const toast = useToast();
  const { refresh } = useSession();
  const [verify, setVerify] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const usable = passkeysUsable(useAuthMethods().data?.passkeys.rpId);
  const add = useMutation({
    mutationFn: (password: string) => registerPasskey(password, deviceOf(navigator.userAgent) || t('security.passkeyNamePlaceholder')),
    onSuccess: () => { setError(null); toast(t('security.passkeyAdded')); onChange(); void refresh(); },
    onError: (e) => { if (!isCancelled(e)) setError(e.message); },
  });
  const remove = useMutation({
    mutationFn: (id: number) => rest(`/auth/passkeys/${id}`, { method: 'DELETE' }),
    onSuccess: () => { toast(t('security.passkeyDeleted')); onChange(); void refresh(); }, onError: (e) => toast(e.message, 'critical'),
  });
  return (
    <AccountSection title={t('acc.passkeys')} badge={t('acc.recommended')}
      help={<><p>{t('acc.passkeysDesc')}</p><p className="mt-3"><a href={PASSKEY_HELP} target="_blank" rel="noreferrer" className="text-primary hover:underline">{t('acc.passkeysMore')}</a></p></>}>
      <div className={`${accountCard} flex flex-col gap-3 p-4`}>
        {error && <Banner>{error}</Banner>}
        {data.passkeys.map((p) => (
          <div key={p.id} className="flex items-start gap-3 rounded-lg border border-line p-3 text-[13px]">
            <Fingerprint className="mt-0.5 size-4 shrink-0 text-muted" aria-hidden />
            <div className="min-w-0 flex-1">
              <div className="truncate font-semibold">{p.name || t('acc.passkeys')}</div>
              <div className="text-muted">{t(p.backedUp ? 'acc.passkeySynced' : 'acc.passkeyLocal')}</div>
              <div className="text-muted">{t('acc.passkeyCreated', { date: fmt.date(p.createdAt) })}</div>
            </div>
            <button type="button" className="text-critical hover:underline disabled:opacity-50" disabled={remove.isPending && remove.variables === p.id} aria-label={`${t('acc.passkeyDelete')} ${p.name}`} onClick={() => remove.mutate(p.id)}>{t('acc.passkeyDelete')}</button>
          </div>
        ))}
        <button type="button" disabled={!usable || add.isPending} onClick={() => setVerify(true)}
          className="flex w-full flex-col items-center gap-1 rounded-lg border border-dashed border-line px-3 py-4 text-[13px] font-medium text-primary hover:bg-hover disabled:cursor-not-allowed disabled:opacity-60">
          <PlusCircle className="size-4" aria-hidden />{t(data.passkeys.length ? 'acc.passkeyAddAnother' : 'acc.passkeyAddFirst')}
        </button>
        {!usable && <p className="text-[13px] text-muted">{t('security.passkeyUnsupported')}</p>}
      </div>
      <VerifyIdentity open={verify} onClose={() => setVerify(false)} onVerified={(pw) => { setVerify(false); add.mutate(pw); }} />
    </AccountSection>
  );
}

/** Change password: the current password and the new one (twice). The other devices are signed out. */
function PasswordSection() {
  const { t } = useI18n();
  const toast = useToast();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ current: '', next: '', again: '' });
  const [error, setError] = useState<string | null>(null);
  const close = () => { setOpen(false); setF({ current: '', next: '', again: '' }); setError(null); };
  const change = useMutation({
    mutationFn: () => rest('/auth/password/change', { body: { password: f.current, newPassword: f.next } }),
    onSuccess: () => { toast(t('acc.passwordChanged')); close(); void qc.invalidateQueries({ queryKey: ['security'] }); },
    onError: (e) => setError(e.message),
  });
  const mismatch = f.again !== '' && f.again !== f.next;
  return (
    <AccountSection title={t('acc.password')}>
      <div className={`${accountCard} flex flex-col items-start gap-3 p-4`}>
        <p className="text-[13px]">{t('acc.passwordText')}</p>
        <Button onClick={() => setOpen(true)}>{t('acc.passwordChange')}</Button>
      </div>
      <Modal open={open} onClose={close} closeLabel={t('common.close')} title={t('acc.passwordChange')} medium
        footer={<><Button onClick={close}>{t('common.cancel')}</Button><Button variant="primary" type="submit" form="change-password" loading={change.isPending} disabled={!f.current || f.next.length < 8 || f.next !== f.again}>{t('save.save')}</Button></>}>
        <form id="change-password" className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); change.mutate(); }}>
          {error && <Banner>{error}</Banner>}
          <Input label={t('acc.passwordCurrent')} type="password" autoComplete="current-password" autoFocus required value={f.current} onChange={(e) => setF({ ...f, current: e.target.value })} />
          <Input label={t('acc.passwordNew')} type="password" autoComplete="new-password" required minLength={8} help={t('acc.passwordHint')} value={f.next} onChange={(e) => setF({ ...f, next: e.target.value })} />
          <Input label={t('acc.passwordConfirm')} type="password" autoComplete="new-password" required error={mismatch ? t('acc.passwordMismatch') : undefined} value={f.again} onChange={(e) => setF({ ...f, again: e.target.value })} />
        </form>
      </Modal>
    </AccountSection>
  );
}

/** "Today at 17:10" for today, "4 Nov, 11:28" for another day. */
function useWhen() {
  const { t, lang } = useI18n();
  return (iso: string) => {
    const d = new Date(iso);
    const now = new Date();
    const time = d.toLocaleTimeString(lang, { hour: '2-digit', minute: '2-digit' });
    return d.toDateString() === now.toDateString() ? t('acc.today', { time }) : `${d.toLocaleDateString(lang, { day: 'numeric', month: 'short' })} ${time}`;
  };
}

/** Devices signed in to the account, each with its own sign-out button. */
function DevicesSection({ data, onChange }: { data: Security; onChange: () => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const { logout } = useSession();
  const when = useWhen();
  const revoke = useMutation({ mutationFn: (id: string) => rest(`/auth/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' }), onSuccess: () => { toast(t('security.revoked')); onChange(); }, onError: (e) => toast(e.message, 'critical') });
  const revokeOthers = useMutation({ mutationFn: () => rest('/auth/sessions/revoke-others', { body: {} }), onSuccess: () => { toast(t('security.revoked')); onChange(); } });
  return (
    <AccountSection title={t('acc.devices')} help={t('acc.devicesDesc')}>
      <div className={accountCard}>
        <div className="flex items-center justify-between gap-2 border-b border-line p-4">
          <h3 className="text-sm font-semibold">{t('acc.signedIn')}</h3>
          {data.sessions.length > 1 && <Button size="sm" loading={revokeOthers.isPending} onClick={() => revokeOthers.mutate()}>{t('acc.signOutOthers')}</Button>}
        </div>
        <ul className="divide-y divide-line">
          {data.sessions.map((s) => (
            <li key={s.id} className="flex items-start gap-3 p-4 text-[13px]">
              <Monitor className="mt-0.5 size-5 shrink-0 text-muted" aria-hidden />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2"><span className="font-medium text-primary">{deviceOf(s.userAgent) || t('acc.unknownDevice')}</span>{s.current && <Badge tone="info">{t('acc.thisDevice')}</Badge>}</div>
                <div className="mt-1.5">{when(s.createdAt)}</div>
                <div className="text-muted">{s.ip ?? '—'}</div>
              </div>
              <Button size="sm" loading={revoke.isPending && revoke.variables === s.id} onClick={() => (s.current ? void logout() : revoke.mutate(s.id))}>{t('acc.signOut')}</Button>
            </li>
          ))}
        </ul>
      </div>
    </AccountSection>
  );
}

/** Account > Security: passkeys, password, two-step authentication and the devices signed in. */
export function AccountSecurityPage() {
  const { t } = useI18n();
  const qc = useQueryClient();
  const q = useSecurity();
  const refetch = () => void qc.invalidateQueries({ queryKey: ['security'] });
  return (
    <>
      <h1 className="mb-4 border-b border-line pb-4 text-xl font-semibold leading-8 [&+section]:border-t-0">{t('acc.nav.security')}</h1>
      {q.isLoading && <Skeleton className="h-40" />}
      {q.error && <Banner>{q.error.message}</Banner>}
      {q.data && (
        <>
          <PasskeysSection data={q.data} onChange={refetch} />
          <PasswordSection />
          <TwoFactorSection data={q.data} onChange={refetch} />
          <DevicesSection data={q.data} onChange={refetch} />
        </>
      )}
    </>
  );
}

/** The enrolment-required screen: the shop (or this member) demands two-step authentication before the admin opens. */
export function SecuritySettings({ forced = false }: { forced?: boolean }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const q = useSecurity();
  const refetch = () => void qc.invalidateQueries({ queryKey: ['security'] });
  if (!forced) return <AccountSecurityPage />;
  return (
    <div className="flex flex-col gap-2">
      <Banner>{t(q.data?.requireSecureLogin ? 'security.secureRequired' : 'security.setupRequired')}</Banner>
      {q.isLoading && <Skeleton className="h-40" />}
      {q.error && <Banner>{q.error.message}</Banner>}
      {q.data && <><TwoFactorSection data={q.data} onChange={refetch} /><PasskeysSection data={q.data} onChange={refetch} /></>}
    </div>
  );
}
