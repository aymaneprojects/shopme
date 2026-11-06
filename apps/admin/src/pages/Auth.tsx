import { Banner, Button, Card, Input, Select } from '@shopme/ui';
import { Boxes } from 'lucide-react';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { FormEvent, ReactNode } from 'react';
import { ApiError, rest } from '../api';
import { LANGS, useI18n } from '../i18n';
import { useSession } from '../session';
import type { Shop, User } from '../session';

function AuthLayout({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  const { lang, setLang } = useI18n();
  return (
    <div className="grid min-h-screen place-items-center bg-surface p-4">
      <div className="w-full max-w-md">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2 text-lg font-semibold"><Boxes className="size-6 text-accent" />ShopMe</div>
          <select aria-label="Language" value={lang} onChange={(e) => setLang(e.target.value as 'en' | 'fr')} className="field-control">
            {LANGS.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
          </select>
        </div>
        <Card>
          <h1 className="text-lg font-semibold">{title}</h1>
          {subtitle && <p className="mb-4 mt-1 text-[13px] text-muted">{subtitle}</p>}
          {children}
        </Card>
      </div>
    </div>
  );
}

function useSubmit<T>(run: () => Promise<T>, onDone: (r: T) => void) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try { onDone(await run()); } catch (err) { setError(err instanceof ApiError ? err.message : String(err)); } finally { setBusy(false); }
  };
  return { error, busy, submit };
}

export function LoginPage() {
  const { t } = useI18n();
  const { signedIn } = useSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [challenge, setChallenge] = useState<string | null>(null);
  const { error, busy, submit } = useSubmit(
    () => rest<{ user: User; shop: Shop; twoFactorSetupRequired?: boolean; twoFactorRequired?: boolean; challenge?: string }>('/auth/login', { body: { email, password } }),
    (r) => (r.twoFactorRequired && r.challenge ? setChallenge(r.challenge) : signedIn(r)),
  );
  if (challenge) return <TwoFactorStep challenge={challenge} onBack={() => setChallenge(null)} />;
  return (
    <AuthLayout title={t('login.title')} subtitle={t('login.subtitle')}>
      <form onSubmit={submit} className="flex flex-col gap-3">
        {error && <Banner>{error === 'Unauthorized' || /invalid|credential/i.test(error) ? t('login.invalid') : error}</Banner>}
        <Input label={t('field.email')} type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
        <Input label={t('field.password')} type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        <Button type="submit" variant="primary" loading={busy}>{t('login.submit')}</Button>
      </form>
    </AuthLayout>
  );
}

/** Second login step: a TOTP code, or a recovery code. */
function TwoFactorStep({ challenge, onBack }: { challenge: string; onBack: () => void }) {
  const { t } = useI18n();
  const { signedIn } = useSession();
  const [code, setCode] = useState('');
  const [recovery, setRecovery] = useState(false);
  const { error, busy, submit } = useSubmit(() => rest<{ user: User; shop: Shop; twoFactorSetupRequired?: boolean }>('/auth/login/2fa', { body: { challenge, code } }), signedIn);
  return (
    <AuthLayout title={t('login.2fa.title')} subtitle={t('login.2fa.subtitle')}>
      <form onSubmit={submit} className="flex flex-col gap-3">
        {error && <Banner>{/expired/i.test(error) ? t('login.2fa.expired') : /invalid/i.test(error) ? t('login.2fa.invalid') : error}</Banner>}
        <Input label={t('login.2fa.code')} autoFocus required inputMode={recovery ? 'text' : 'numeric'} autoComplete="one-time-code" maxLength={recovery ? 12 : 7} value={code} onChange={(e) => setCode(e.target.value)} />
        <Button type="submit" variant="primary" loading={busy}>{t('login.2fa.verify')}</Button>
        <button type="button" className="text-sm text-accent underline" onClick={() => { setRecovery(!recovery); setCode(''); }}>{t(recovery ? 'login.2fa.authenticator' : 'login.2fa.recovery')}</button>
        <button type="button" className="text-sm text-muted underline" onClick={onBack}>{t('login.2fa.back')}</button>
      </form>
    </AuthLayout>
  );
}

const CURRENCIES = ['EUR', 'USD', 'GBP', 'CAD', 'CHF', 'AUD', 'JPY'];
const COUNTRIES = ['FR', 'US', 'GB', 'CA', 'CH', 'BE', 'DE', 'ES', 'IT', 'NL', 'AU'];

export function SetupPage() {
  const { t, lang } = useI18n();
  const { signedIn } = useSession();
  const fr = lang === 'fr';
  const [f, setF] = useState({ shopName: '', firstName: '', lastName: '', email: '', password: '', currency: fr ? 'EUR' : 'USD', country: fr ? 'FR' : 'US' });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const { error, busy, submit } = useSubmit(
    () => rest<{ user: User; shop: Shop }>('/setup', { body: { ...f, locale: lang, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone } }),
    signedIn,
  );
  return (
    <AuthLayout title={t('setup.title')} subtitle={t('setup.subtitle')}>
      <form onSubmit={submit} className="flex flex-col gap-3">
        {error && <Banner>{error}</Banner>}
        <Input label={t('setup.shopName')} required value={f.shopName} onChange={set('shopName')} />
        <div className="grid grid-cols-2 gap-3">
          <Input label={t('field.firstName')} autoComplete="given-name" value={f.firstName} onChange={set('firstName')} />
          <Input label={t('field.lastName')} autoComplete="family-name" value={f.lastName} onChange={set('lastName')} />
        </div>
        <Input label={t('field.email')} type="email" autoComplete="username" required value={f.email} onChange={set('email')} />
        <Input label={t('field.password')} type="password" autoComplete="new-password" required minLength={8} help={t('setup.passwordHelp')} value={f.password} onChange={set('password')} />
        <div className="grid grid-cols-2 gap-3">
          <Select label={t('setup.currency')} value={f.currency} onChange={set('currency')}>{CURRENCIES.map((c) => <option key={c}>{c}</option>)}</Select>
          <Select label={t('setup.country')} value={f.country} onChange={set('country')}>{COUNTRIES.map((c) => <option key={c} value={c}>{c}</option>)}</Select>
        </div>
        <Button type="submit" variant="primary" loading={busy}>{t('setup.submit')}</Button>
      </form>
    </AuthLayout>
  );
}

/** Staff invitation link (`/admin/invite/<token>`): set a password, or (multi-store) join with the account the person already has. */
export function InvitePage({ token }: { token: string }) {
  const { t } = useI18n();
  const { signedIn } = useSession();
  const info = useQuery({ queryKey: ['invite', token], retry: false, queryFn: () => rest<{ email: string; firstName: string | null; shopName: string; accountExists?: boolean }>(`/staff/invite/${encodeURIComponent(token)}`) });
  const [f, setF] = useState({ firstName: '', lastName: '', password: '' });
  const existing = !!info.data?.accountExists;
  const { error, busy, submit } = useSubmit(
    () => rest<{ user: User; shop: Shop; storeHandle?: string }>('/staff/accept-invite', { body: { token, password: f.password, ...(!existing && { firstName: f.firstName || undefined, lastName: f.lastName || undefined }) } }),
    // Multi-store: open the store's admin (a fresh page picks up the store from its URL); single-store: the admin home.
    (r) => { if (r.storeHandle) { window.location.assign(`/admin/store/${r.storeHandle}/`); return; } window.history.replaceState(null, '', '/admin/'); signedIn(r); },
  );
  if (info.isLoading) return <AuthLayout title={t('invite.title')}><p className="text-[13px] text-muted">{t('common.loading')}</p></AuthLayout>;
  if (!info.data) return <AuthLayout title={t('invite.title')}><Banner>{t('invite.invalid')}</Banner></AuthLayout>;
  return (
    <AuthLayout title={t('invite.join', { shop: info.data.shopName })} subtitle={t(existing ? 'invite.existing' : 'invite.subtitle', { email: info.data.email })}>
      <form onSubmit={submit} className="flex flex-col gap-3">
        {error && <Banner>{error}</Banner>}
        <Input label={t('field.email')} type="email" autoComplete="username" value={info.data.email} readOnly />
        {!existing && (
          <div className="grid grid-cols-2 gap-3">
            <Input label={t('field.firstName')} autoComplete="given-name" value={f.firstName} placeholder={info.data.firstName ?? ''} onChange={(e) => setF({ ...f, firstName: e.target.value })} />
            <Input label={t('field.lastName')} autoComplete="family-name" value={f.lastName} onChange={(e) => setF({ ...f, lastName: e.target.value })} />
          </div>
        )}
        <Input label={t(existing ? 'invite.accountPassword' : 'invite.newPassword')} type="password" autoComplete={existing ? 'current-password' : 'new-password'} required minLength={8} help={existing ? undefined : t('setup.passwordHelp')} value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} />
        <Button type="submit" variant="primary" loading={busy}>{t('invite.submit')}</Button>
      </form>
    </AuthLayout>
  );
}
