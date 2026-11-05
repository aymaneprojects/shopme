import { Badge, Banner, Button, Card, Dropdown, Input, Modal, Select, Skeleton, Switch, useToast } from '@shopme/ui';
import { MoreHorizontal } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { UserErrors, gql, mutate } from '../../api';
import { RowCard, Section, SubHeader } from '../../components/SettingsKit';
import { SaveBar } from '../../components/SaveBar';
import { CHECKOUT_CONFIGURATIONS, CHECKOUT_CONFIGURATION_ACTIVATE, CHECKOUT_CONFIGURATION_CREATE, CHECKOUT_CONFIGURATION_DELETE, CHECKOUT_CONFIGURATION_RENAME, CHECKOUT_CONFIGURATION_UPDATE } from '../../graphql';
import { useI18n } from '../../i18n';
import type { CheckoutConfig } from '../../lib/config';
import { CheckoutExtras } from './CheckoutBranding';

type Rule = 'hidden' | 'optional' | 'required';
export interface CheckoutForm {
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

export interface CheckoutConfiguration { id: string; name: string; active: boolean; settings: CheckoutForm; config: CheckoutConfig }
const CONFIGS_KEY = ['checkout-configurations'];
const useConfigurations = () => useQuery({ queryKey: CONFIGS_KEY, queryFn: async () => (await gql<{ shopmeCheckoutConfigurations: CheckoutConfiguration[] }>(CHECKOUT_CONFIGURATIONS)).shopmeCheckoutConfigurations });

type Dialog = { kind: 'duplicate' | 'rename' | 'delete'; id: string; name: string };

/** Settings > Checkout: the checkout configurations; the active one is what the storefront checkout uses. */
export function CheckoutSettings() {
  const { t } = useI18n();
  const toast = useToast();
  const qc = useQueryClient();
  const nav = useNavigate();
  const q = useConfigurations();
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refresh = () => { void qc.invalidateQueries({ queryKey: CONFIGS_KEY }); void qc.invalidateQueries({ queryKey: ['checkout-settings'] }); void qc.invalidateQueries({ queryKey: ['config', 'CHECKOUT'] }); };
  const run = useMutation({
    mutationFn: async (a: { kind: Dialog['kind'] | 'activate'; id: string; name?: string }) => {
      if (a.kind === 'duplicate') return mutate(CHECKOUT_CONFIGURATION_CREATE, { name: a.name, fromId: a.id }, 'shopmeCheckoutConfigurationCreate');
      if (a.kind === 'rename') return mutate(CHECKOUT_CONFIGURATION_RENAME, { id: a.id, name: a.name }, 'shopmeCheckoutConfigurationRename');
      if (a.kind === 'activate') return mutate(CHECKOUT_CONFIGURATION_ACTIVATE, { id: a.id }, 'shopmeCheckoutConfigurationActivate');
      return mutate(CHECKOUT_CONFIGURATION_DELETE, { id: a.id }, 'shopmeCheckoutConfigurationDelete');
    },
    onSuccess: (_r, a) => { setDialog(null); setError(null); refresh(); toast(t(a.kind === 'activate' ? 'cfg.activated' : a.kind === 'delete' ? 'cfg.deleted' : 'settings.saved')); },
    onError: (e) => setError(e instanceof UserErrors ? e.errors.map((x) => x.message).join(' · ') : e.message),
  });
  if (q.isLoading) return <Skeleton className="h-64" />;
  if (q.error) return <Banner>{q.error.message}</Banner>;
  const configs = q.data!;
  const open = (d: Dialog) => { setError(null); setDialog(d); };
  return (
    <div className="flex flex-col gap-6">
      <Section title={t('cfg.title')} description={t('cfg.desc')}>
        <RowCard>
          {configs.map((c) => (
            <div key={c.id} className="flex items-center gap-3 px-4 py-3 text-[13px]">
              <Link to={`/settings/checkout/${encodeURIComponent(c.id)}`} className="min-w-0 flex-1 truncate font-medium hover:underline">{c.name}</Link>
              {c.active && <Badge tone="success">{t('cfg.active')}</Badge>}
              {!c.active && <Button size="sm" loading={run.isPending && run.variables?.kind === 'activate' && run.variables.id === c.id} onClick={() => run.mutate({ kind: 'activate', id: c.id })}>{t('cfg.setActive')}</Button>}
              <Button size="sm" onClick={() => nav(`/settings/checkout/${encodeURIComponent(c.id)}`)}>{t('common.edit')}</Button>
              <Dropdown align="right" icon label={t('common.moreActions')} variant="plain" trigger={<MoreHorizontal className="size-4" />} items={[
                { key: 'rename', label: t('cfg.rename'), onSelect: () => open({ kind: 'rename', id: c.id, name: c.name }) },
                { key: 'duplicate', label: t('cfg.duplicate'), onSelect: () => open({ kind: 'duplicate', id: c.id, name: t('cfg.copyName', { name: c.name }) }) },
                ...(c.active ? [] : [{ key: 'delete', label: t('common.delete'), danger: true, separatorBefore: true, onSelect: () => open({ kind: 'delete', id: c.id, name: c.name }) }]),
              ]} />
            </div>
          ))}
        </RowCard>
      </Section>
      <Modal open={dialog !== null} onClose={() => setDialog(null)} closeLabel={t('common.close')} medium
        title={dialog?.kind === 'duplicate' ? t('cfg.duplicate') : dialog?.kind === 'rename' ? t('cfg.rename') : t('cfg.deleteTitle')}
        footer={<><Button onClick={() => setDialog(null)}>{t('common.cancel')}</Button>
          <Button variant={dialog?.kind === 'delete' ? 'danger' : 'primary'} loading={run.isPending} disabled={!dialog || (dialog.kind !== 'delete' && !dialog.name.trim())} onClick={() => dialog && run.mutate({ kind: dialog.kind, id: dialog.id, name: dialog.name })}>
            {dialog?.kind === 'delete' ? t('common.delete') : dialog?.kind === 'duplicate' ? t('cfg.duplicate') : t('save.save')}</Button></>}>
        <div className="flex flex-col gap-3">
          {error && <Banner>{error}</Banner>}
          {dialog?.kind === 'delete' ? <p className="text-[13px]">{t('cfg.deleteBody', { name: dialog.name })}</p>
            : dialog && <Input label={t('cfg.name')} maxLength={60} autoFocus value={dialog.name} onChange={(e) => setDialog({ ...dialog, name: e.target.value })} />}
        </div>
      </Modal>
    </div>
  );
}

/** Editor of one configuration: contact and sign-in rules, address fields, marketing, tipping, notes, then the look. */
export function CheckoutConfigurationPage() {
  const { t } = useI18n();
  const { id = '' } = useParams();
  const q = useConfigurations();
  const c = q.data?.find((x) => x.id === id);
  return (
    <>
      <SubHeader back="/settings/checkout" parent={t('checkout.pageTitle')} title={c?.name ?? t('cfg.title')} actions={c?.active ? <Badge tone="success">{t('cfg.active')}</Badge> : undefined} />
      {q.isLoading ? <Skeleton className="h-96" /> : q.error ? <Banner>{q.error.message}</Banner> : !c ? <Banner>{t('cfg.notFound')}</Banner>
        : <div className="flex flex-col gap-6"><CheckoutSettingsForm key={`${c.id}-${q.dataUpdatedAt}`} id={c.id} initial={c.settings} /><CheckoutExtras id={c.id} config={c.config} /></div>}
    </>
  );
}

function CheckoutSettingsForm({ id, initial }: { id: string; initial: CheckoutForm }) {
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
    mutationFn: () => mutate(CHECKOUT_CONFIGURATION_UPDATE, { id, settings: draft }, 'shopmeCheckoutConfigurationUpdate'),
    onSuccess: () => { toast(t('settings.saved')); setError(null); void qc.invalidateQueries({ queryKey: CONFIGS_KEY }); void qc.invalidateQueries({ queryKey: ['checkout-settings'] }); },
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

