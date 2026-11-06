import { Banner, Input, Select } from '@shopme/ui';
import { Fingerprint, Loader2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { ButtonHTMLAttributes, ClipboardEvent, FormEvent, KeyboardEvent, ReactNode } from 'react';
import { ApiError, rest } from '../api';
import { AuthShell, useAuthMethods } from '../components/AuthShell';
import type { AuthCardSize } from '../components/AuthShell';
import { ThemePicker, useBundledThemesRest } from '../components/ThemeGallery';
import { useI18n } from '../i18n';
import { isCancelled, lastSignInMethod, passkeysUsable, rememberSignInMethod, signInWithPasskey } from '../lib/passkeys';
import { useSession } from '../session';
import type { Shop, User } from '../session';
import { EmailPanelLite } from '../components/EmailSetupLite';

type Signed = { user: User; shop: Shop; twoFactorSetupRequired?: boolean };
type LoginReply = Partial<Signed> & { twoFactorRequired?: boolean; emailCodeRequired?: boolean; challenge?: string; email?: string };

/** Full-width button of the sign-in cards. `tone`: dark (primary), light (secondary) or pill (sign-up layout). */
function AuthButton({ tone = 'dark', loading, children, ...rest }: { tone?: 'dark' | 'light' | 'pill'; loading?: boolean } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type="button" {...rest} disabled={rest.disabled || loading} className={`auth-btn ${tone === 'light' ? 'auth-btn-light' : tone === 'pill' ? 'auth-btn-dark auth-btn-pill' : 'auth-btn-dark'} ${rest.className ?? ''}`}>
      {loading && <Loader2 className="size-4 animate-spin" aria-hidden />}{children}
    </button>
  );
}

function useSubmit<T>(run: () => Promise<T>, onDone: (r: T) => void, describe?: (err: ApiError) => string | null) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    setBusy(true); setError(null);
    try { onDone(await run()); } catch (err) { if (isCancelled(err)) return; setError((err instanceof ApiError && describe?.(err)) || (err instanceof ApiError ? err.message : String(err))); } finally { setBusy(false); }
  };
  return { error, busy, submit, setError };
}

// ---- login -----------------------------------------------------------------------------------------------------------------------

type Stage = { kind: 'form' } | { kind: 'twofactor'; challenge: string } | { kind: 'code'; challenge: string; email: string } | { kind: 'forgot' };

/** E-mail first: the e-mail, then (on the next step) the password; then a mailed code on a new device, or the authenticator code. */
export function LoginPage() {
  const { t } = useI18n();
  const { signedIn } = useSession();
  const methods = useAuthMethods();
  const status = useQuery({ queryKey: ['setup-status'], retry: false, staleTime: 30_000, queryFn: () => rest<{ needsSetup: boolean }>('/setup/status') });
  const [step, setStep] = useState<'email' | 'password'>('email');
  const [stage, setStage] = useState<Stage>({ kind: 'form' });
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const finish = (r: Signed, method: 'password' | 'passkey') => { rememberSignInMethod(method); signedIn(r); };
  const passwordLogin = useSubmit(
    () => rest<LoginReply>('/auth/login', { body: { email, password } }),
    (r) => {
      if (r.twoFactorRequired && r.challenge) setStage({ kind: 'twofactor', challenge: r.challenge });
      else if (r.emailCodeRequired && r.challenge) setStage({ kind: 'code', challenge: r.challenge, email: r.email ?? email });
      else finish(r as Signed, 'password');
    },
    (err) => (err.body?.passkeyRequired ? t('login.passkeyRequired') : err.status === 401 || /invalid|credential/i.test(err.message) ? t('login.invalid') : null),
  );
  const passkey = useSubmit(() => signInWithPasskey<Signed>(), (r) => finish(r, 'passkey'));
  const canPasskey = passkeysUsable(methods.data?.passkeys.rpId);
  const lastPasskey = lastSignInMethod() === 'passkey';
  const switchToPasskey = () => { setStage({ kind: 'form' }); void passkey.submit(); };

  if (stage.kind === 'twofactor') return <TwoFactorStep challenge={stage.challenge} onBack={() => { setStage({ kind: 'form' }); setPassword(''); }} onDone={(r) => finish(r, 'password')} />;
  if (stage.kind === 'code') return <EmailCodeStep challenge={stage.challenge} email={stage.email} canPasskey={canPasskey} onPasskey={switchToPasskey} onBack={() => { setStage({ kind: 'form' }); setPassword(''); }} onDone={(r) => finish(r, 'password')} />;
  if (stage.kind === 'forgot') return <ForgotPassword initialEmail={email} onBack={(msg, resetEmail) => { setStage({ kind: 'form' }); setNotice(msg ?? null); setStep('password'); setPassword(''); setEmail(resetEmail ?? email); passwordLogin.setError(null); passkey.setError(null); }} />;

  const err = (passkey.error ? t('login.passkeyFailed') : null) ?? passwordLogin.error;
  return (
    <AuthShell variant="login" title={t('login.title')} subtitle={t('login.subtitle')}>
      <div className="flex flex-col gap-4">
        {notice && <Banner tone="success">{notice}</Banner>}
        {err && <Banner>{err}</Banner>}
        {step === 'email' ? (
          <form onSubmit={(e) => { e.preventDefault(); setStep('password'); setNotice(null); }} className="flex flex-col gap-4">
            <Input label={t('field.email')} type="email" autoComplete="username webauthn" autoFocus required value={email} onChange={(e) => setEmail(e.target.value)} />
            <AuthButton type="submit">{t('login.continueEmail')}</AuthButton>
          </form>
        ) : (
          <form onSubmit={(e) => { setNotice(null); void passwordLogin.submit(e); }} className="flex flex-col gap-4">
            <div className="flex items-center justify-between gap-3 rounded-[10px] bg-surface px-3 py-2.5 text-[14px]">
              <span className="min-w-0 truncate font-medium" data-testid="login-email">{email}</span>
              <button type="button" className="auth-link shrink-0 text-[13px]" onClick={() => { setStep('email'); setPassword(''); passwordLogin.setError(null); }}>{t('login.change')}</button>
            </div>
            <Input label={t('field.password')} type="password" autoComplete="current-password" autoFocus required value={password} onChange={(e) => setPassword(e.target.value)} />
            <AuthButton type="submit" loading={passwordLogin.busy}>{t('login.submit')}</AuthButton>
            {methods.data?.passwordReset && <button type="button" className="auth-link self-start text-[13px]" onClick={() => setStage({ kind: 'forgot' })}>{t('login.forgot')}</button>}
          </form>
        )}
        {canPasskey && (
          <>
            <div className="auth-divider" role="separator">{t('login.or')}</div>
            <div className="relative">
              <AuthButton tone="light" loading={passkey.busy} onClick={() => void passkey.submit()}><Fingerprint className="size-5" aria-hidden />{t('login.passkey')}</AuthButton>
              {lastPasskey && <span className="auth-badge">{t('login.lastUsed')}</span>}
            </div>
          </>
        )}
        {status.data?.needsSetup && <p className="text-center text-[14px] text-muted">{t('login.newTo')} <a className="auth-link" href="/admin/">{t('login.start')} →</a></p>}
      </div>
    </AuthShell>
  );
}

/** Six boxes for a 6-digit code: typing moves on, backspace moves back, pasting fills them all. */
export function DigitBoxes({ value, onChange, label, autoFocus }: { value: string; onChange: (v: string) => void; label: (n: number) => string; autoFocus?: boolean }) {
  const refs = useRef<Array<HTMLInputElement | null>>([]);
  const digits = Array.from({ length: 6 }, (_, i) => value[i] ?? '');
  const focus = (i: number) => refs.current[Math.max(0, Math.min(5, i))]?.focus();
  const setAt = (i: number, d: string) => onChange(digits.map((x, j) => (j === i ? d : x)).join('').slice(0, 6));
  const onKey = (i: number) => (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace') {
      e.preventDefault();
      if (digits[i]) setAt(i, '');
      else if (i > 0) { setAt(i - 1, ''); focus(i - 1); }
    } else if (e.key === 'ArrowLeft') focus(i - 1);
    else if (e.key === 'ArrowRight') focus(i + 1);
  };
  const onInput = (i: number, raw: string) => {
    const d = raw.replace(/\D/g, '');
    if (!d) return;
    if (d.length > 1) { onChange((value.slice(0, i) + d).slice(0, 6)); focus(Math.min(5, i + d.length)); return; }
    setAt(i, d);
    focus(i + 1);
  };
  const onPaste = (e: ClipboardEvent<HTMLInputElement>) => {
    const d = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    if (!d) return;
    e.preventDefault();
    onChange(d);
    focus(d.length >= 6 ? 5 : d.length);
  };
  return (
    <div className="grid grid-cols-6 gap-2" role="group">
      {digits.map((d, i) => (
        <input key={i} ref={(el) => { refs.current[i] = el; }} className="auth-digit" inputMode="numeric" autoComplete={i === 0 ? 'one-time-code' : 'off'} maxLength={6} aria-label={label(i + 1)}
          autoFocus={autoFocus && i === 0} value={d} onChange={(e) => onInput(i, e.target.value)} onKeyDown={onKey(i)} onPaste={onPaste} onFocus={(e) => e.target.select()} />
      ))}
    </div>
  );
}

const RESEND_COOLDOWN_S = 30;

/** New device: the 6-digit code mailed to the account. */
export function EmailCodeStep({ challenge, email, canPasskey, onPasskey, onBack, onDone }: { challenge: string; email: string; canPasskey: boolean; onPasskey: () => void; onBack: () => void; onDone: (r: Signed) => void }) {
  const { t } = useI18n();
  const [code, setCode] = useState('');
  const [wait, setWait] = useState(RESEND_COOLDOWN_S);
  const [info, setInfo] = useState<string | null>(null);
  const [trust, setTrust] = useState(true);
  useEffect(() => {
    if (wait <= 0) return;
    const id = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(id);
  }, [wait]);
  const verify = useSubmit(
    () => rest<Signed>('/auth/login/email-code', { body: { challenge, code, trust } }),
    onDone,
    (err) => (err.body?.expired ? t('login.2fa.expired') : err.body?.codeExpired ? t('login.emailCode.expired') : err.body?.codeLocked ? t('login.emailCode.locked') : err.status === 401 ? t('login.emailCode.invalid') : null),
  );
  const resend = useSubmit(
    () => rest('/auth/login/email-code/resend', { body: { challenge } }),
    () => { setWait(RESEND_COOLDOWN_S); setCode(''); setInfo(t('login.emailCode.sent')); verify.setError(null); },
    (err) => (err.status === 429 ? t('login.emailCode.resendLimit') : null),
  );
  const error = verify.error ?? resend.error;
  return (
    <AuthShell variant="login" title={t('login.emailCode.title')} subtitle={t('login.emailCode.subtitle', { email })}>
      <form onSubmit={(e) => { setInfo(null); void verify.submit(e); }} className="flex flex-col gap-4">
        {error && <Banner>{error}</Banner>}
        {info && !error && <Banner tone="success">{info}</Banner>}
        <div className="flex flex-col gap-2">
          <DigitBoxes value={code} onChange={setCode} autoFocus label={(n) => t('login.emailCode.digit', { n })} />
          <div>
            {wait > 0 ? <span className="text-[13px] text-muted" aria-live="polite">{t('login.emailCode.resendIn', { s: wait })}</span>
              : <button type="button" className="auth-link text-[13px]" disabled={resend.busy} onClick={() => { setInfo(null); void resend.submit(); }}>{t('login.emailCode.resend')}</button>}
          </div>
        </div>
        <label className="flex items-center gap-2 text-[13px] text-muted"><input type="checkbox" checked={trust} onChange={(e) => setTrust(e.target.checked)} />{t('login.emailCode.trust')}</label>
        <AuthButton type="submit" loading={verify.busy} disabled={code.length !== 6}>{t('login.emailCode.verify')}</AuthButton>
        {canPasskey && <AuthButton tone="light" onClick={onPasskey}>{t('login.emailCode.usePasskey')}</AuthButton>}
        <button type="button" className="auth-link self-center text-[13px]" onClick={onBack}>{t('login.2fa.back')}</button>
      </form>
    </AuthShell>
  );
}

/** Second login step: a TOTP code, or a recovery code. */
function TwoFactorStep({ challenge, onBack, onDone }: { challenge: string; onBack: () => void; onDone: (r: Signed) => void }) {
  const { t } = useI18n();
  const [code, setCode] = useState('');
  const [recovery, setRecovery] = useState(false);
  const { error, busy, submit } = useSubmit(() => rest<Signed>('/auth/login/2fa', { body: { challenge, code } }), onDone, (err) => (/expired/i.test(err.message) ? t('login.2fa.expired') : /invalid/i.test(err.message) ? t('login.2fa.invalid') : null));
  return (
    <AuthShell variant="login" title={t('login.2fa.title')} subtitle={t('login.2fa.subtitle')}>
      <form onSubmit={submit} className="flex flex-col gap-4">
        {error && <Banner>{error}</Banner>}
        <Input label={t('login.2fa.code')} autoFocus required inputMode={recovery ? 'text' : 'numeric'} autoComplete="one-time-code" maxLength={recovery ? 12 : 7} value={code} onChange={(e) => setCode(e.target.value)} />
        <AuthButton type="submit" loading={busy}>{t('login.2fa.verify')}</AuthButton>
        <button type="button" className="auth-link self-start text-[13px]" onClick={() => { setRecovery(!recovery); setCode(''); }}>{t(recovery ? 'login.2fa.authenticator' : 'login.2fa.recovery')}</button>
        <button type="button" className="self-start text-[13px] text-muted underline" onClick={onBack}>{t('login.2fa.back')}</button>
      </form>
    </AuthShell>
  );
}

/** Forgotten password: the e-mail, then the mailed code with the new password. */
function ForgotPassword({ initialEmail, onBack }: { initialEmail: string; onBack: (message?: string, email?: string) => void }) {
  const { t } = useI18n();
  const [email, setEmail] = useState(initialEmail);
  const [sent, setSent] = useState(false);
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const ask = useSubmit(() => rest('/auth/password/forgot', { body: { email } }), () => setSent(true));
  const reset = useSubmit(() => rest('/auth/password/reset', { body: { email, code, password } }), () => onBack(t('forgot.done'), email), (err) => (err.status === 401 ? t('forgot.invalid') : null));
  return (
    <AuthShell variant="signup" title={t('forgot.title')} subtitle={sent ? t('forgot.sent', { email }) : t('forgot.subtitle')}>
      {!sent ? (
        <form onSubmit={ask.submit} className="flex flex-col gap-4">
          {ask.error && <Banner>{ask.error}</Banner>}
          <Input label={t('field.email')} type="email" autoComplete="username" autoFocus required value={email} onChange={(e) => setEmail(e.target.value)} />
          <AuthButton tone="pill" type="submit" loading={ask.busy}>{t('forgot.send')}</AuthButton>
          <button type="button" className="auth-link self-center text-[13px]" onClick={() => onBack()}>{t('forgot.back')}</button>
        </form>
      ) : (
        <form onSubmit={reset.submit} className="flex flex-col gap-4">
          {reset.error && <Banner>{reset.error}</Banner>}
          <DigitBoxes value={code} onChange={setCode} autoFocus label={(n) => t('login.emailCode.digit', { n })} />
          <Input label={t('forgot.newPassword')} type="password" autoComplete="new-password" required minLength={8} help={t('setup.passwordHelp')} value={password} onChange={(e) => setPassword(e.target.value)} />
          <AuthButton tone="pill" type="submit" loading={reset.busy} disabled={code.length !== 6}>{t('forgot.submit')}</AuthButton>
          <button type="button" className="auth-link self-center text-[13px]" onClick={() => onBack()}>{t('forgot.back')}</button>
        </form>
      )}
    </AuthShell>
  );
}

// ---- first-store setup ------------------------------------------------------------------------------------------------------------

const CURRENCIES = ['EUR', 'USD', 'GBP', 'CAD', 'CHF', 'AUD', 'JPY'];
const COUNTRIES = ['FR', 'US', 'GB', 'CA', 'CH', 'BE', 'DE', 'ES', 'IT', 'NL', 'AU'];

function Steps({ step, total }: { step: number; total: number }) {
  const { t } = useI18n();
  return (
    <div className="mb-5" aria-label={t('setup.step', { n: step, total })}>
      <p className="mb-1.5 text-[12px] font-medium text-muted">{t('setup.step', { n: step, total })}</p>
      <div className="flex gap-1.5" aria-hidden>{Array.from({ length: total }, (_, i) => <span key={i} className={`h-1 flex-1 rounded-full ${i < step ? 'bg-primary' : 'bg-border'}`} />)}</div>
    </div>
  );
}

export function SetupPage() {
  const { t, lang } = useI18n();
  const { signedIn } = useSession();
  const fr = lang === 'fr';
  const [step, setStep] = useState(1);
  const [f, setF] = useState({ shopName: '', firstName: '', lastName: '', email: '', password: '', currency: fr ? 'EUR' : 'USD', country: fr ? 'FR' : 'US' });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  // Starting theme: Aurora unless another bundled theme is picked (the picker only appears when there is a choice).
  const [theme, setTheme] = useState('aurora');
  const themes = useBundledThemesRest().data?.themes ?? [];
  const [created, setCreated] = useState<{ user: User; shop: Shop } | null>(null);
  const { error, busy, submit } = useSubmit(
    () => rest<{ user: User; shop: Shop }>('/setup', { body: { ...f, locale: lang, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, ...(themes.length > 1 && { theme }) } }),
    setCreated,
  );
  // Optional last step: the 3 DNS lines for e-mail. The session already exists (the server set the cookie); opening the store happens on "continue" or "skip".
  if (created) return <AuthShell variant="signup" size="wide" title={t('setup.email.title')} subtitle={t('setup.email.subtitle')}><EmailPanelLite onDone={() => signedIn(created)} email={f.email} /></AuthShell>;
  const size: AuthCardSize = step === 1 ? 'narrow' : themes.length > 1 ? 'xwide' : 'default';
  return (
    <AuthShell variant="signup" title={t('setup.title')} subtitle={t('setup.subtitle')} size={size}>
      <Steps step={step} total={2} />
      {step === 1 ? (
        <form onSubmit={(e) => { e.preventDefault(); setStep(2); }} className="flex flex-col gap-4">
          <h2 className="text-[17px] font-semibold">{t('setup.accountTitle')}</h2>
          <div className="grid grid-cols-2 gap-3">
            <Input label={t('field.firstName')} autoComplete="given-name" value={f.firstName} onChange={set('firstName')} />
            <Input label={t('field.lastName')} autoComplete="family-name" value={f.lastName} onChange={set('lastName')} />
          </div>
          <Input label={t('field.email')} type="email" autoComplete="username" required value={f.email} onChange={set('email')} />
          <Input label={t('field.password')} type="password" autoComplete="new-password" required minLength={8} help={t('setup.passwordHelp')} value={f.password} onChange={set('password')} />
          <AuthButton tone="pill" type="submit">{t('setup.next')}</AuthButton>
        </form>
      ) : (
        <form onSubmit={submit} className="flex flex-col gap-4">
          <h2 className="text-[17px] font-semibold">{t('setup.storeTitle')}</h2>
          {error && <Banner>{error}</Banner>}
          <Input label={t('setup.shopName')} required autoFocus value={f.shopName} onChange={set('shopName')} />
          <div className="grid grid-cols-2 gap-3">
            <Select label={t('setup.currency')} value={f.currency} onChange={set('currency')}>{CURRENCIES.map((c) => <option key={c}>{c}</option>)}</Select>
            <Select label={t('setup.country')} value={f.country} onChange={set('country')}>{COUNTRIES.map((c) => <option key={c} value={c}>{c}</option>)}</Select>
          </div>
          {themes.length > 1 && <ThemePicker themes={themes} value={theme} onChange={setTheme} />}
          <div className="flex flex-col gap-2 sm:flex-row-reverse">
            <AuthButton tone="pill" type="submit" loading={busy}>{t('setup.submit')}</AuthButton>
            <AuthButton tone="light" className="sm:max-w-[140px]" onClick={() => setStep(1)}>{t('setup.back')}</AuthButton>
          </div>
        </form>
      )}
    </AuthShell>
  );
}

// ---- invitation ------------------------------------------------------------------------------------------------------------------

/** Staff invitation link (`/admin/invite/<token>`): set a password, or (multi-store) join with the account the person already has. */
export function InvitePage({ token }: { token: string }) {
  const { t } = useI18n();
  const { signedIn } = useSession();
  const info = useQuery({ queryKey: ['invite', token], retry: false, queryFn: () => rest<{ email: string; firstName: string | null; shopName: string; accountExists?: boolean }>(`/staff/invite/${encodeURIComponent(token)}`) });
  const [f, setF] = useState({ firstName: '', lastName: '', password: '', code: '' });
  const [needsCode, setNeedsCode] = useState(false);
  const existing = !!info.data?.accountExists;
  const { error, busy, submit } = useSubmit(
    () => rest<{ user: User; shop: Shop; storeHandle?: string }>('/staff/accept-invite', { body: { token, password: f.password, ...(f.code && { code: f.code }), ...(!existing && { firstName: f.firstName || undefined, lastName: f.lastName || undefined }) } }),
    // Multi-store: open the store's admin (a fresh page picks up the store from its URL); single-store: the admin home.
    (r) => { if (r.storeHandle) { window.location.assign(`/admin/store/${r.storeHandle}/`); return; } window.history.replaceState(null, '', '/admin/'); signedIn(r); },
    (err) => { if (err.body?.twoFactorRequired) { setNeedsCode(true); return t('invite.codeHelp'); } return null; },
  );
  const frame = (title: string, body: ReactNode, subtitle?: string) => <AuthShell variant="signup" title={title} subtitle={subtitle}>{body}</AuthShell>;
  if (info.isLoading) return frame(t('invite.title'), <p className="text-[13px] text-muted">{t('common.loading')}</p>);
  if (!info.data) return frame(t('invite.title'), <Banner>{t('invite.invalid')}</Banner>);
  return frame(t('invite.join', { shop: info.data.shopName }), (
    <form onSubmit={submit} className="flex flex-col gap-4">
      {error && <Banner tone={needsCode && error === t('invite.codeHelp') ? 'info' : 'critical'}>{error}</Banner>}
      <Input label={t('field.email')} type="email" autoComplete="username" value={info.data.email} readOnly />
      {!existing && (
        <div className="grid grid-cols-2 gap-3">
          <Input label={t('field.firstName')} autoComplete="given-name" value={f.firstName} placeholder={info.data.firstName ?? ''} onChange={(e) => setF({ ...f, firstName: e.target.value })} />
          <Input label={t('field.lastName')} autoComplete="family-name" value={f.lastName} onChange={(e) => setF({ ...f, lastName: e.target.value })} />
        </div>
      )}
      <Input label={t(existing ? 'invite.accountPassword' : 'invite.newPassword')} type="password" autoComplete={existing ? 'current-password' : 'new-password'} required minLength={8} help={existing ? undefined : t('setup.passwordHelp')} value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} />
      {needsCode && <Input label={t('login.2fa.code')} autoFocus required inputMode="numeric" autoComplete="one-time-code" maxLength={12} value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} />}
      <AuthButton tone="pill" type="submit" loading={busy}>{t('invite.submit')}</AuthButton>
    </form>
  ), t(existing ? 'invite.existing' : 'invite.subtitle', { email: info.data.email }));
}
