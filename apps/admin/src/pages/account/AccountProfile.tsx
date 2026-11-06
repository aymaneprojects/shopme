import { Banner, Input, Select, useToast } from '@shopme/ui';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { rest } from '../../api';
import { SaveBar } from '../../components/SaveBar';
import { LANGS, useI18n } from '../../i18n';
import { useMulti, useSession } from '../../session';
import { AccountSection, accountCard, usePerson } from './AccountLayout';

/** Account > General: name and e-mail, the stores of the account (multi-store), and the language of this admin. */
export function AccountProfilePage() {
  const { t, lang, setLang } = useI18n();
  const toast = useToast();
  const { refresh } = useSession();
  const multi = useMulti();
  const person = usePerson();
  const [saved, setSaved] = useState({ firstName: person.firstName ?? '', lastName: person.lastName ?? '' });
  const [form, setForm] = useState(saved);
  const [error, setError] = useState<string | null>(null);
  const dirty = form.firstName !== saved.firstName || form.lastName !== saved.lastName;
  const save = useMutation({
    mutationFn: () => rest('/auth/profile', { method: 'PATCH', body: { firstName: form.firstName.trim(), lastName: form.lastName.trim() } }),
    onSuccess: () => { const next = { firstName: form.firstName.trim(), lastName: form.lastName.trim() }; setSaved(next); setForm(next); setError(null); toast(t('acc.saved')); void refresh(); },
    onError: (e) => setError(e.message),
  });
  return (
    <>
      <SaveBar dirty={dirty} saving={save.isPending} onSave={() => save.mutate()} onDiscard={() => { setForm(saved); setError(null); }} />
      <h1 className="mb-4 border-b border-line pb-4 text-xl font-semibold leading-8 [&+section]:border-t-0">{t('acc.nav.general')}</h1>
      <AccountSection title={t('acc.info')}>
        <div className={accountCard}>
          <div className="flex items-center gap-3 border-b border-line p-4">
            <span className="grid size-10 shrink-0 place-items-center rounded-full bg-primary text-[13px] font-semibold text-on-primary" aria-hidden>{person.initials}</span>
            <span className="min-w-0 truncate text-sm font-semibold">{person.name}</span>
          </div>
          <div className="flex flex-col gap-3 p-4">
            {error && <Banner>{error}</Banner>}
            <div className="grid gap-3 sm:grid-cols-2">
              <Input label={t('acc.firstName')} autoComplete="given-name" maxLength={100} value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} />
              <Input label={t('acc.lastName')} autoComplete="family-name" maxLength={100} value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} />
            </div>
            <p className="text-[13px] text-muted">{t('acc.nameHelp')}</p>
          </div>
          <div className="border-t border-line p-4">
            <div className="text-xs text-muted">{t('acc.email')}</div>
            <div className="mt-0.5 break-all text-[13px]">{person.email}</div>
          </div>
        </div>
      </AccountSection>
      {multi && (
        <AccountSection title={t('acc.stores')} help={t('acc.storesDesc')}>
          <div className={accountCard}><a href="/admin/stores" className="block p-4 text-[13px] font-medium text-primary hover:underline">{t('acc.showStores')}</a></div>
        </AccountSection>
      )}
      <AccountSection title={t('acc.language')} help={t('acc.languageDesc')}>
        <div className={`${accountCard} p-4`}>
          <Select label={t('acc.languageField')} value={lang} onChange={(e) => setLang(e.target.value as typeof lang)}>
            {LANGS.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
          </Select>
        </div>
      </AccountSection>
    </>
  );
}
