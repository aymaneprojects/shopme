import { Banner, Button, Card, Input, Select } from '@shopme/ui';
import { Boxes } from 'lucide-react';
import { useState } from 'react';
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
          <div className="flex items-center gap-2 text-lg font-semibold"><Boxes className="size-6 text-primary" />ShopMe</div>
          <select aria-label="Language" value={lang} onChange={(e) => setLang(e.target.value as 'en' | 'fr')} className="rounded-md border border-line bg-canvas px-2 py-1 text-sm">
            {LANGS.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
          </select>
        </div>
        <Card>
          <h1 className="text-lg font-semibold">{title}</h1>
          {subtitle && <p className="mb-4 mt-1 text-sm text-muted">{subtitle}</p>}
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
  const { error, busy, submit } = useSubmit(() => rest<{ user: User; shop: Shop }>('/auth/login', { body: { email, password } }), signedIn);
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
