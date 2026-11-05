import { Badge, Banner, Button, Card, Checkbox, Input, Select, Skeleton, Switch, Textarea, useToast } from '@shopme/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Cookie, Lock, Mail, MailCheck, Server, Share2, Trash2, Plus } from 'lucide-react';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { UserErrors, gql, mutate } from '../../api';
import { LinkRow, RowCard, Section, SubHeader } from '../../components/SettingsKit';
import { SaveBar } from '../../components/SaveBar';
import { CHECKOUT_SETTINGS_UPDATE, CONSENT_POLICIES, CONSENT_POLICY_UPDATE, PRIVACY_SETTINGS, PRIVACY_SETTINGS_UPDATE, SHOP_POLICIES } from '../../graphql';
import { useI18n } from '../../i18n';

type BannerMode = 'AUTO' | 'ALWAYS' | 'OFF';
interface PrivacyData {
  mode: 'AUTO' | 'MANUAL'; cookieBanner: { mode: BannerMode; message: string; position: 'bottom' | 'left' | 'right' }; dataSaleOptOutPage: 'AUTO' | 'OFF'; doubleOptIn: boolean; hasPrivacyPolicy: boolean; storageLocation: string;
  regions: { consentRequired: string[]; notice: string[]; dataSaleOptOutUsStates: string[]; reviewedAt: string };
}
interface Page { shopmePrivacySettings: PrivacyData; shopmeCheckoutSettings: { marketing: 'hidden' | 'unchecked' | 'checked' } }

const US_STATES: Record<string, string> = { CA: 'California', CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', IA: 'Iowa', IN: 'Indiana', KY: 'Kentucky', MD: 'Maryland', MN: 'Minnesota', MT: 'Montana', NE: 'Nebraska', NH: 'New Hampshire', NJ: 'New Jersey', OR: 'Oregon', RI: 'Rhode Island', TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VA: 'Virginia' };
/** US state names that differ in French (the others are written the same way). */
const US_STATES_FR: Record<string, string> = { CA: 'Californie', IA: 'Iowa', NJ: 'New Jersey', NH: 'New Hampshire', TN: 'Tennessee', VA: 'Virginie', RI: 'Rhode Island' };
const stateName = (code: string, lang: string) => (lang === 'fr' ? US_STATES_FR[code] : undefined) ?? US_STATES[code] ?? code;

function usePrivacy() {
  const { t } = useI18n();
  const toast = useToast();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['privacy-settings'], queryFn: () => gql<Page>(PRIVACY_SETTINGS) });
  const save = useMutation({
    mutationFn: (input: Record<string, unknown>) => mutate(PRIVACY_SETTINGS_UPDATE, { input }, 'shopmePrivacySettingsUpdate'),
    onSuccess: () => { toast(t('settings.saved')); void qc.invalidateQueries({ queryKey: ['privacy-settings'] }); void qc.invalidateQueries({ queryKey: ['cookie-banner'] }); },
    onError: (e) => toast(e instanceof UserErrors ? e.errors.map((x) => x.message).join(' · ') : e.message, 'critical'),
  });
  return { q, save };
}

const AUTO = (t: ReturnType<typeof useI18n>['t'], on: boolean, label?: string): ReactNode => <Badge tone={on ? 'success' : 'neutral'} dot>{label ?? t(on ? 'priv.automated' : 'priv.manual')}</Badge>;

/** Settings > Customer privacy. */
export function CustomerPrivacySettings() {
  const { t, lang } = useI18n();
  const { q } = usePrivacy();
  const policies = useQuery({ queryKey: ['shop-policies'], queryFn: () => gql<{ shop: { shopPolicies: Array<{ type: string; body: string }> } }>(SHOP_POLICIES) });
  if (q.isLoading) return <Skeleton className="h-96" />;
  if (q.error) return <Banner>{q.error.message}</Banner>;
  const p = q.data!.shopmePrivacySettings;
  const policySet = !!policies.data?.shop.shopPolicies.find((x) => x.type === 'PRIVACY_POLICY')?.body.replace(/<[^>]*>/g, '').trim();
  const states = p.regions.dataSaleOptOutUsStates;
  const names = states.slice(0, 2).map((s) => stateName(s, lang));
  const marketing = q.data!.shopmeCheckoutSettings.marketing;
  const bannerDesc = p.cookieBanner.mode === 'OFF' ? t('priv.banner.offDesc') : p.cookieBanner.mode === 'ALWAYS' ? t('priv.banner.alwaysDesc') : t('priv.banner.autoDesc');
  return (
    <div className="flex flex-col gap-6">
      <Section title={t('priv.settings')}>
        <RowCard>
          <LinkRow to="/settings/policies/PRIVACY_POLICY" icon={Lock} title={t('priv.policy')} description={t(policySet ? 'priv.policy.published' : 'priv.policy.missing')}
            trailing={<Badge tone={policySet ? 'success' : 'warning'} dot>{t(policySet ? 'priv.policy.set' : 'priv.policy.notSet')}</Badge>} />
          <LinkRow to="/settings/privacy/cookie-banner" icon={Cookie} title={t('priv.banner')} description={bannerDesc}
            trailing={AUTO(t, p.cookieBanner.mode === 'AUTO' && p.mode === 'AUTO', p.cookieBanner.mode === 'OFF' ? t('priv.off') : p.cookieBanner.mode === 'ALWAYS' || p.mode === 'MANUAL' ? t('priv.manual') : undefined)} />
          <LinkRow to="/settings/privacy/data-sale" icon={Share2} title={t('priv.dataSale')}
            description={p.dataSaleOptOutPage === 'OFF' ? t('priv.banner.offDesc') : t('priv.dataSale.active', { names: names.join(', '), n: Math.max(0, states.length - names.length) })}
            trailing={AUTO(t, p.dataSaleOptOutPage === 'AUTO', p.dataSaleOptOutPage === 'OFF' ? t('priv.off') : undefined)} />
        </RowCard>
      </Section>
      <Section title={t('priv.marketing')} description={t('priv.marketingDesc')}>
        <RowCard>
          <LinkRow to="/settings/privacy/marketing" icon={Mail} title={t('priv.checkout')} description={t(`priv.checkout.${marketing}` as 'priv.checkout.hidden')} />
          <LinkRow to="/settings/privacy/double-opt-in" icon={MailCheck} title={t('priv.double')} description={t(p.doubleOptIn ? 'priv.double.on' : 'priv.double.off')} />
        </RowCard>
      </Section>
      <Section title={t('priv.storage')}>
        <Card><p className="flex items-center gap-2 text-[13px]"><Server className="size-4 text-muted" aria-hidden />{p.storageLocation === 'Self-hosted' ? t('fid.priv.selfHosted') : p.storageLocation}</p></Card>
        <p className="text-[13px] text-muted">{t('priv.disclaimer')}</p>
      </Section>
    </div>
  );
}

function PrivacyPage({ title, children, form }: { title: string; children: ReactNode; form?: { dirty: boolean; saving: boolean; onSave: () => void; onDiscard: () => void } }) {
  const { t } = useI18n();
  return (
    <>
      {form && <SaveBar {...form} />}
      <SubHeader back="/settings/privacy" parent={t('settings.privacy')} title={title} />
      <div className="flex flex-col gap-6">{children}</div>
    </>
  );
}

const radio = (name: string, value: string, checked: boolean, onChange: () => void, label: ReactNode, help?: ReactNode) => (
  <label key={value} className="flex cursor-pointer items-start gap-2.5 text-[13px]">
    <input type="radio" name={name} value={value} checked={checked} onChange={onChange} className="mt-0.5 size-4 accent-[var(--color-primary,#1E40AF)]" />
    <span><span className="block font-medium">{label}</span>{help && <span className="block text-muted">{help}</span>}</span>
  </label>
);

/** Cookie banner: when it shows, its text and position, and the consent rules per region (automated table or the merchant's own). */
export function CookieBannerPage() {
  const { t } = useI18n();
  const { q, save } = usePrivacy();
  if (q.isLoading) return <Skeleton className="h-96" />;
  if (q.error) return <Banner>{q.error.message}</Banner>;
  return <CookieBannerForm key={q.dataUpdatedAt} data={q.data!.shopmePrivacySettings} save={save.mutate} saving={save.isPending} t={t} />;
}

function CookieBannerForm({ data, save, saving, t }: { data: PrivacyData; save: (i: Record<string, unknown>) => void; saving: boolean; t: ReturnType<typeof useI18n>['t'] }) {
  const [mode, setMode] = useState(data.cookieBanner.mode);
  const [message, setMessage] = useState(data.cookieBanner.message);
  const [position, setPosition] = useState(data.cookieBanner.position);
  const [rules, setRules] = useState(data.mode);
  const dirty = mode !== data.cookieBanner.mode || message !== data.cookieBanner.message || position !== data.cookieBanner.position || rules !== data.mode;
  return (
    <PrivacyPage title={t('priv.banner')} form={{ dirty, saving, onSave: () => save({ mode: rules, cookieBanner: { mode, message, position } }), onDiscard: () => { setMode(data.cookieBanner.mode); setMessage(data.cookieBanner.message); setPosition(data.cookieBanner.position); setRules(data.mode); } }}>
      {mode === 'OFF' && <Banner tone="warning">{t('priv.banner.offWarning')}</Banner>}
      <Section title={t('priv.banner.when')}>
        <Card>
          <div role="radiogroup" className="flex flex-col gap-2.5">
            {radio('banner-mode', 'AUTO', mode === 'AUTO', () => setMode('AUTO'), t('priv.banner.auto'), t('priv.banner.autoHelp'))}
            {radio('banner-mode', 'ALWAYS', mode === 'ALWAYS', () => setMode('ALWAYS'), t('priv.banner.always'), t('priv.banner.alwaysHelp'))}
            {radio('banner-mode', 'OFF', mode === 'OFF', () => setMode('OFF'), t('priv.banner.off'), t('priv.banner.offHelp'))}
          </div>
        </Card>
      </Section>
      <Section title={t('priv.banner.look')}>
        <Card>
          <div className="grid gap-3">
            <Textarea label={t('priv.banner.message')} help={t('priv.banner.messageHelp')} value={message} maxLength={1000} onChange={(e) => setMessage(e.target.value)} />
            <Select label={t('priv.banner.position')} value={position} onChange={(e) => setPosition(e.target.value as typeof position)}>
              <option value="bottom">{t('priv.banner.pos.bottom')}</option><option value="left">{t('priv.banner.pos.left')}</option><option value="right">{t('priv.banner.pos.right')}</option>
            </Select>
          </div>
        </Card>
      </Section>
      <Section title={t('priv.rules')} description={t('priv.rulesDesc')}>
        <Card>
          <div role="radiogroup" className="flex flex-col gap-2.5">
            {radio('rules', 'AUTO', rules === 'AUTO', () => setRules('AUTO'), t('priv.rules.auto'), t('priv.rules.autoHelp', { date: data.regions.reviewedAt }))}
            {radio('rules', 'MANUAL', rules === 'MANUAL', () => setRules('MANUAL'), t('priv.rules.manual'), t('priv.rules.manualHelp'))}
          </div>
        </Card>
        {rules === 'AUTO' ? (
          <Card title={t('priv.rules.table')}>
            <dl className="grid gap-2 text-[13px]">
              <div><dt className="font-medium">{t('priv.rules.optIn')}</dt><dd className="text-muted">{data.regions.consentRequired.join(', ')}</dd></div>
              <div><dt className="font-medium">{t('priv.rules.notice')}</dt><dd className="text-muted">{data.regions.notice.join(', ')}</dd></div>
              <div><dt className="font-medium">{t('priv.rules.sale')}</dt><dd className="text-muted">{data.regions.dataSaleOptOutUsStates.join(', ')}</dd></div>
            </dl>
            <p className="mt-3 text-[13px] text-muted">{t('priv.rules.reviewed', { date: data.regions.reviewedAt })} {t('priv.disclaimer')}</p>
          </Card>
        ) : <ManualRules />}
      </Section>
    </PrivacyPage>
  );
}

interface PolicyRow { id: string; countryCode: string | null; regionCode: string | null; consentRequired: boolean; dataSaleOptOutRequired: boolean }

/** The merchant's own consent rules (manual mode): one row per country, optionally per region; a row without a country is the default. */
function ManualRules() {
  const { t } = useI18n();
  const toast = useToast();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['consent-policies'], queryFn: () => gql<{ consentPolicy: PolicyRow[] }>(CONSENT_POLICIES) });
  const [rows, setRows] = useState<PolicyRow[] | null>(null);
  const list = rows ?? q.data?.consentPolicy ?? [];
  const save = useMutation({
    mutationFn: () => mutate(CONSENT_POLICY_UPDATE, { policies: list.map((r) => ({ countryCode: r.countryCode || null, regionCode: r.regionCode || null, consentRequired: r.consentRequired, dataSaleOptOutRequired: r.dataSaleOptOutRequired })) }, 'shopmeConsentPoliciesReplace'),
    onSuccess: () => { toast(t('settings.saved')); setRows(null); void qc.invalidateQueries({ queryKey: ['consent-policies'] }); void qc.invalidateQueries({ queryKey: ['privacy-settings'] }); },
    onError: (e) => toast(e instanceof UserErrors ? e.errors.map((x) => x.message).join(' · ') : e.message, 'critical'),
  });
  const edit = (i: number, p: Partial<PolicyRow>) => setRows(list.map((r, j) => (j === i ? { ...r, ...p } : r)));
  if (q.isLoading) return <Skeleton className="h-32" />;
  return (
    <Card title={t('priv.rules.mine')}>
      {list.length === 0 && <p className="text-[13px] text-muted">{t('priv.rules.none')}</p>}
      <div className="flex flex-col gap-3">
        {list.map((r, i) => (
          <div key={`${r.id}-${i}`} className="grid items-end gap-2 sm:grid-cols-[6rem_6rem_1fr_auto]">
            <Input label={t('priv.rules.country')} value={r.countryCode ?? ''} maxLength={2} placeholder="FR" onChange={(e) => edit(i, { countryCode: e.target.value.toUpperCase() })} />
            <Input label={t('priv.rules.region')} value={r.regionCode ?? ''} maxLength={3} placeholder="CA" onChange={(e) => edit(i, { regionCode: e.target.value.toUpperCase() })} />
            <div className="flex flex-wrap gap-4 pb-2">
              <Checkbox label={t('priv.rules.consent')} checked={r.consentRequired} onChange={(e) => edit(i, { consentRequired: e.target.checked })} />
              <Checkbox label={t('priv.rules.optOut')} checked={r.dataSaleOptOutRequired} onChange={(e) => edit(i, { dataSaleOptOutRequired: e.target.checked })} />
            </div>
            <Button size="sm" icon aria-label={t('common.remove')} onClick={() => setRows(list.filter((_, j) => j !== i))}><Trash2 className="size-4" /></Button>
          </div>
        ))}
      </div>
      <div className="mt-3 flex items-center justify-between gap-2">
        <Button size="sm" onClick={() => setRows([...list, { id: `new-${list.length}`, countryCode: '', regionCode: '', consentRequired: true, dataSaleOptOutRequired: false }])}><Plus className="size-4" />{t('priv.rules.add')}</Button>
        <Button size="sm" variant="primary" loading={save.isPending} disabled={rows === null} onClick={() => save.mutate()}>{t('priv.rules.save')}</Button>
      </div>
    </Card>
  );
}

/** Data-sale opt-out page: on in the regions that need it. */
export function DataSalePage() {
  const { t } = useI18n();
  const { q, save } = usePrivacy();
  if (q.isLoading) return <Skeleton className="h-64" />;
  if (q.error) return <Banner>{q.error.message}</Banner>;
  return <DataSaleForm key={q.dataUpdatedAt} data={q.data!.shopmePrivacySettings} save={save.mutate} saving={save.isPending} t={t} />;
}
function DataSaleForm({ data, save, saving, t }: { data: PrivacyData; save: (i: Record<string, unknown>) => void; saving: boolean; t: ReturnType<typeof useI18n>['t'] }) {
  const { lang } = useI18n();
  const [mode, setMode] = useState(data.dataSaleOptOutPage);
  const dirty = mode !== data.dataSaleOptOutPage;
  return (
    <PrivacyPage title={t('priv.dataSale')} form={{ dirty, saving, onSave: () => save({ dataSaleOptOutPage: mode }), onDiscard: () => setMode(data.dataSaleOptOutPage) }}>
      <Card>
        <div role="radiogroup" className="flex flex-col gap-2.5">
          {radio('opt-out', 'AUTO', mode === 'AUTO', () => setMode('AUTO'), t('priv.dataSale.auto'), t('priv.dataSale.autoHelp'))}
          {radio('opt-out', 'OFF', mode === 'OFF', () => setMode('OFF'), t('priv.dataSale.off'), t('priv.dataSale.offHelp'))}
        </div>
      </Card>
      <Card title={t('priv.dataSale.regions')}>
        <p className="text-[13px] text-muted">{data.regions.dataSaleOptOutUsStates.map((s) => stateName(s, lang)).join(', ')}</p>
        <p className="mt-3 text-[13px] text-muted">{t('priv.dataSale.page')} <code>/pages/data-sale-opt-out</code></p>
      </Card>
    </PrivacyPage>
  );
}

/** Email marketing checkbox at checkout (shares the checkout setting). */
export function MarketingPage() {
  const { t } = useI18n();
  const toast = useToast();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['privacy-settings'], queryFn: () => gql<Page>(PRIVACY_SETTINGS) });
  const [value, setValue] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: (marketing: string) => mutate(CHECKOUT_SETTINGS_UPDATE, { input: { marketing } }, 'shopmeCheckoutSettingsUpdate'),
    onSuccess: () => { toast(t('settings.saved')); void qc.invalidateQueries({ queryKey: ['privacy-settings'] }); void qc.invalidateQueries({ queryKey: ['checkout-settings'] }); },
    onError: (e) => toast(e.message, 'critical'),
  });
  if (q.isLoading) return <Skeleton className="h-48" />;
  if (q.error) return <Banner>{q.error.message}</Banner>;
  const current = q.data!.shopmeCheckoutSettings.marketing;
  const v = value ?? current;
  return (
    <PrivacyPage title={t('priv.checkout')} form={{ dirty: v !== current, saving: save.isPending, onSave: () => save.mutate(v), onDiscard: () => setValue(null) }}>
      <Card>
        <div role="radiogroup" className="flex flex-col gap-2.5">
          {radio('mk', 'hidden', v === 'hidden', () => setValue('hidden'), t('priv.checkout.hidden'))}
          {radio('mk', 'unchecked', v === 'unchecked', () => setValue('unchecked'), t('priv.checkout.unchecked'))}
          {radio('mk', 'checked', v === 'checked', () => setValue('checked'), t('priv.checkout.checked'))}
        </div>
        <p className="mt-3 text-[13px] text-muted">{t('priv.checkout.note')}</p>
      </Card>
    </PrivacyPage>
  );
}

/** Double opt-in: subscribers confirm by email before they count as subscribed. */
export function DoubleOptInPage() {
  const { t } = useI18n();
  const { q, save } = usePrivacy();
  if (q.isLoading) return <Skeleton className="h-48" />;
  if (q.error) return <Banner>{q.error.message}</Banner>;
  const on = q.data!.shopmePrivacySettings.doubleOptIn;
  return (
    <PrivacyPage title={t('priv.double')}>
      <Card>
        <Switch checked={on} onChange={(v) => save.mutate({ doubleOptIn: v })} label={t('priv.double.switch')} />
        <p className="mt-2 text-[13px] text-muted">{t('priv.double.help')}</p>
      </Card>
    </PrivacyPage>
  );
}
