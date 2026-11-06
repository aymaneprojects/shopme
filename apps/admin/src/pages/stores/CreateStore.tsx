import { Banner, Button, Card, Input, Select } from '@shopme/ui';
import { useQuery } from '@tanstack/react-query';
import { Globe, PlusCircle } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { ApiError, rest } from '../../api';
import { PageHeader } from '../../components/PageHeader';
import { ThemePicker, useBundledThemesRest } from '../../components/ThemeGallery';
import { LANGS, useI18n } from '../../i18n';
import type { Lang } from '../../i18n';
import { CURRENCIES, countryOptions } from '../../lib/countries';
import { useSession } from '../../session';

interface HandleCheck { handle: string; available: boolean; problem: string | null; code?: 'INVALID' | 'RESERVED' | 'TAKEN' | null; host: string | null }

/** Default currency of a country (the setup picks it when the merchant changes the country). */
const COUNTRY_CURRENCY: Record<string, string> = { US: 'USD', GB: 'GBP', CA: 'CAD', CH: 'CHF', AU: 'AUD', NZ: 'NZD', JP: 'JPY', SE: 'SEK', NO: 'NOK', DK: 'DKK', PL: 'PLN', CZ: 'CZK', MA: 'MAD', TN: 'TND', DZ: 'DZD', SN: 'XOF', CI: 'XOF', BR: 'BRL', MX: 'MXN', IN: 'INR', SG: 'SGD' };

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => { const id = setTimeout(() => setV(value), ms); return () => clearTimeout(id); }, [value, ms]);
  return v;
}

/** Multi-store "Create a store": name, handle (with its address), country, currency and language; then the new store's admin. */
export function CreateStorePage() {
  const { t, lang } = useI18n();
  const { state } = useSession();
  const allowed = state.status === 'account' && state.multi.canCreateStores;
  const [f, setF] = useState({ shopName: '', handle: '', country: lang === 'fr' ? 'FR' : 'US', currency: lang === 'fr' ? 'EUR' : 'USD', locale: lang as Lang });
  const [customHandle, setCustomHandle] = useState(false);
  const [theme, setTheme] = useState('aurora');
  const themes = useBundledThemesRest().data?.themes ?? [];
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const name = useDebounced(f.shopName.trim(), 250);
  const wanted = useDebounced(f.handle.trim().toLowerCase(), 250);
  const check = useQuery({
    queryKey: ['store-handle', customHandle ? `h:${wanted}` : `n:${name}`], enabled: customHandle ? !!wanted : !!name, staleTime: 5_000,
    queryFn: () => rest<HandleCheck>(`/account/stores/handle?${new URLSearchParams(customHandle ? { handle: wanted } : { name })}`),
  });
  useEffect(() => { if (!customHandle && check.data) setF((x) => ({ ...x, handle: check.data!.handle })); }, [check.data, customHandle]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      const r = await rest<{ store: { adminPath: string } }>('/account/stores', { body: { shopName: f.shopName.trim(), handle: f.handle.trim().toLowerCase() || undefined, country: f.country, currency: f.currency, locale: f.locale, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, ...(themes.length > 1 && { theme }) } });
      window.location.assign(r.store.adminPath);
    } catch (err) {
      setError(err instanceof ApiError && err.status === 403 ? t('ms.create.denied') : err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };
  const problem = check.data && !check.data.available ? t(check.data.code === 'TAKEN' ? 'ms.create.handleTaken' : check.data.code === 'RESERVED' ? 'ms.create.handleReserved' : 'ms.create.handleInvalid') : null;
  return (
    <>
      <PageHeader back="/stores" title={t('ms.createStore')} />
      {!allowed && <Banner tone="info">{t('ms.create.denied')}</Banner>}
      {allowed && (
        <form onSubmit={submit} className="mx-auto flex max-w-xl flex-col gap-4">
          {error && <Banner>{error}</Banner>}
          <Card>
            <div className="flex flex-col gap-3">
              <Input label={t('ms.create.name')} required maxLength={120} autoFocus value={f.shopName} onChange={(e) => setF({ ...f, shopName: e.target.value })} />
              <div>
                {customHandle
                  ? <Input label={t('ms.create.handle')} required maxLength={40} pattern="[a-z0-9](?:[a-z0-9-]*[a-z0-9])?" value={f.handle} onChange={(e) => setF({ ...f, handle: e.target.value.toLowerCase() })} error={problem ?? undefined} help={t('ms.create.handleHelp')} />
                  : null}
                <div className="mt-1 flex flex-wrap items-center gap-2 text-[13px] text-muted" aria-live="polite">
                  <Globe className="size-4 shrink-0" aria-hidden />
                  {check.data?.host ? <span><span className="sr-only">{t('ms.create.address')} </span><span className="font-medium text-fg">{check.data.host}</span></span> : <span>{t('ms.create.addressHint')}</span>}
                  {!customHandle && problem && <span className="text-critical">{problem}</span>}
                  {!customHandle && <button type="button" className="text-accent underline" onClick={() => setCustomHandle(true)}>{t('ms.create.editHandle')}</button>}
                </div>
                <p className="mt-1 text-xs text-muted">{t('ms.create.handleNote')}</p>
              </div>
            </div>
          </Card>
          <Card title={t('ms.create.regional')}>
            <div className="grid gap-3 sm:grid-cols-3">
              <Select label={t('setup.country')} value={f.country} onChange={(e) => setF({ ...f, country: e.target.value, currency: COUNTRY_CURRENCY[e.target.value] ?? 'EUR' })}>
                {countryOptions(lang).map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
              </Select>
              <Select label={t('setup.currency')} value={f.currency} onChange={(e) => setF({ ...f, currency: e.target.value })}>{CURRENCIES.map((c) => <option key={c}>{c}</option>)}</Select>
              <Select label={t('ms.create.language')} value={f.locale} onChange={(e) => setF({ ...f, locale: e.target.value as Lang })}>{LANGS.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}</Select>
            </div>
            <p className="mt-3 text-[13px] text-muted">{t('ms.create.starter')}</p>
          </Card>
          {themes.length > 1 && <Card><ThemePicker themes={themes} value={theme} onChange={setTheme} /></Card>}
          <div className="flex justify-end gap-2">
            <a href="/admin/stores" className="btn btn-secondary">{t('common.cancel')}</a>
            <Button type="submit" variant="primary" loading={busy} disabled={!f.shopName.trim() || !!problem}><PlusCircle className="size-4" />{t('ms.create.submit')}</Button>
          </div>
        </form>
      )}
    </>
  );
}
