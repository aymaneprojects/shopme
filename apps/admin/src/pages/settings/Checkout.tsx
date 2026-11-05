import { Banner, Card, Input, Select, Skeleton, Switch, useToast } from '@shopme/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { UserErrors, gql, mutate } from '../../api';
import { Section } from '../../components/SettingsKit';
import { SaveBar } from '../../components/SaveBar';
import { CHECKOUT_SETTINGS, CHECKOUT_SETTINGS_UPDATE } from '../../graphql';
import { useI18n } from '../../i18n';
import { CheckoutExtras } from './CheckoutBranding';

type Rule = 'hidden' | 'optional' | 'required';
interface CheckoutForm {
  contactMethod: 'email' | 'email_or_phone'; accountMode: 'guest' | 'required'; nameMode: 'full' | 'last';
  company: Rule; address2: Rule; phone: Rule; marketing: 'hidden' | 'unchecked' | 'checked';
  tipping: { enabled: boolean; presets: number[] }; orderNotes: boolean;
}

function Radios<T extends string>({ name, value, onChange, options }: { name: string; value: T; onChange: (v: T) => void; options: Array<{ id: T; label: ReactNode; help?: ReactNode }> }) {
  return (
    <div role="radiogroup" className="flex flex-col gap-2.5">
      {options.map((o) => (
        <label key={o.id} className="flex cursor-pointer items-start gap-2.5 text-[13px]">
          <input type="radio" name={name} value={o.id} checked={value === o.id} onChange={() => onChange(o.id)} className="mt-0.5 size-4 accent-[var(--color-primary,#1E40AF)]" />
          <span><span className="block font-medium">{o.label}</span>{o.help && <span className="block text-muted">{o.help}</span>}</span>
        </label>
      ))}
    </div>
  );
}

/** Settings > Checkout: what the one-page checkout asks for and requires. */
export function CheckoutSettings() {
  const q = useQuery({ queryKey: ['checkout-settings'], queryFn: () => gql<{ shopmeCheckoutSettings: CheckoutForm }>(CHECKOUT_SETTINGS) });
  if (q.isLoading) return <Skeleton className="h-96" />;
  if (q.error) return <Banner>{q.error.message}</Banner>;
  return <div className="flex flex-col gap-6"><CheckoutSettingsForm key={q.dataUpdatedAt} initial={q.data!.shopmeCheckoutSettings} /><CheckoutExtras /></div>;
}

function CheckoutSettingsForm({ initial }: { initial: CheckoutForm }) {
  const { t } = useI18n();
  const toast = useToast();
  const qc = useQueryClient();
  const [form, setForm] = useState(initial);
  const [presets, setPresets] = useState(initial.tipping.presets.join(', '));
  const [error, setError] = useState<string | null>(null);
  const set = (p: Partial<CheckoutForm>) => setForm((f) => ({ ...f, ...p }));
  const parsed = presets.split(/[,\s]+/).filter(Boolean).map(Number);
  const draft = { ...form, tipping: { ...form.tipping, presets: parsed.every((n) => Number.isInteger(n)) ? parsed : form.tipping.presets } };
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial);
  const save = useMutation({
    mutationFn: () => mutate(CHECKOUT_SETTINGS_UPDATE, { input: draft }, 'shopmeCheckoutSettingsUpdate'),
    onSuccess: () => { toast(t('settings.saved')); setError(null); void qc.invalidateQueries({ queryKey: ['checkout-settings'] }); },
    onError: (e) => setError(e instanceof UserErrors ? e.errors.map((x) => x.message).join(' · ') : e.message),
  });
  const selCls = 'h-8 rounded-md border border-line bg-canvas px-2 text-[13px] font-medium';
  const infoRow = (label: string, control: ReactNode) => <div className="flex items-center justify-between gap-3 py-2.5 text-[13px]"><span>{label}</span>{control}</div>;
  const rule = (label: string, key: 'company' | 'address2' | 'phone') => infoRow(label,
    <select aria-label={label} className={selCls} value={form[key]} onChange={(e) => set({ [key]: e.target.value as Rule })}>
      <option value="hidden">{t('checkout.rule.hidden')}</option><option value="optional">{t('checkout.rule.optional')}</option><option value="required">{t('checkout.rule.required')}</option>
    </select>);
  return (
    <div className="flex flex-col gap-6">
      <SaveBar dirty={dirty} saving={save.isPending} onSave={() => save.mutate()} onDiscard={() => { setForm(initial); setPresets(initial.tipping.presets.join(', ')); setError(null); }} />
      {error && <Banner>{error}</Banner>}
      <Section title={t('checkout.contact')} description={t('checkout.contactDesc')}>
        <Card>
          <Radios name="contact" value={form.contactMethod} onChange={(v) => set({ contactMethod: v })} options={[
            { id: 'email', label: t('checkout.contact.email') }, { id: 'email_or_phone', label: t('checkout.contact.emailOrPhone'), help: t('checkout.contact.emailOrPhoneHelp') },
          ]} />
        </Card>
      </Section>
      <Section title={t('checkout.accounts')} description={t('checkout.accountsDesc')}>
        <Card>
          <Radios name="accounts" value={form.accountMode} onChange={(v) => set({ accountMode: v })} options={[
            { id: 'guest', label: t('checkout.accounts.guest'), help: t('checkout.accounts.guestHelp') }, { id: 'required', label: t('checkout.accounts.required'), help: t('checkout.accounts.requiredHelp') },
          ]} />
        </Card>
      </Section>
      <Section title={t('checkout.info')} description={t('checkout.infoDesc')}>
        <Card>
          <div className="-my-1 flex flex-col divide-y divide-line">
            {infoRow(t('checkout.info.name'), <select aria-label={t('checkout.info.name')} className={selCls} value={form.nameMode} onChange={(e) => set({ nameMode: e.target.value as CheckoutForm['nameMode'] })}>
              <option value="full">{t('checkout.info.nameFull')}</option><option value="last">{t('checkout.info.nameLast')}</option>
            </select>)}
            {rule(t('checkout.info.company'), 'company')}
            {rule(t('checkout.info.address2'), 'address2')}
            {rule(t('checkout.info.phone'), 'phone')}
          </div>
        </Card>
      </Section>
      <Section title={t('checkout.marketing')} description={t('checkout.marketingDesc')}>
        <Card>
          <Select label={t('checkout.marketing.label')} value={form.marketing} onChange={(e) => set({ marketing: e.target.value as CheckoutForm['marketing'] })}>
            <option value="hidden">{t('checkout.marketing.hidden')}</option><option value="unchecked">{t('checkout.marketing.unchecked')}</option><option value="checked">{t('checkout.marketing.checked')}</option>
          </Select>
        </Card>
      </Section>
      <Section title={t('checkout.tipping')} description={t('checkout.tippingDesc')}>
        <Card>
          <div className="flex flex-col gap-3">
            <Switch placement="end" checked={form.tipping.enabled} onChange={(v) => set({ tipping: { ...form.tipping, enabled: v } })} label={t('checkout.tipping.enable')} />
            {form.tipping.enabled && <Input className="max-w-64" label={t('checkout.tipping.presets')} help={t('checkout.tipping.presetsHelp')} value={presets} inputMode="numeric" onChange={(e) => setPresets(e.target.value)} />}
          </div>
        </Card>
      </Section>
      <Section title={t('checkout.notes')} description={t('checkout.notesDesc')}>
        <Card><Switch placement="end" checked={form.orderNotes} onChange={(v) => set({ orderNotes: v })} label={t('checkout.notes.enable')} /></Card>
      </Section>
    </div>
  );
}

