import { Banner, Card, Checkbox, Input, Select, Skeleton, Switch, Textarea, useToast, cx } from '@shopme/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Navigate, NavLink, Outlet } from 'react-router';
import type { ReactNode } from 'react';
import { useState } from 'react';
import { UserErrors, gql, mutate } from '../../api';
import { PageHeader } from '../../components/PageHeader';
import { SaveBar } from '../../components/SaveBar';
import { SHOP, SHOP_UPDATE } from '../../graphql';
import { useI18n } from '../../i18n';
import type { Key } from '../../i18n';
import { CURRENCIES, TIMEZONES } from '../../lib/countries';
import { useStaffAccess } from '../../lib/permissions';
import type { Permission } from '../../lib/permissions';

const SECTIONS: Array<{ id: string; key: Key; perm?: Permission }> = [
  { id: 'general', key: 'settings.general' }, { id: 'payments', key: 'settings.payments' }, { id: 'shipping', key: 'settings.shipping' },
  { id: 'taxes', key: 'settings.taxes' }, { id: 'domains', key: 'settings.domains' }, { id: 'languages', key: 'settings.languages' },
  { id: 'users', key: 'settings.users', perm: 'staff' }, { id: 'notifications', key: 'settings.notifications' }, { id: 'policies', key: 'settings.policies' },
  { id: 'webhooks', key: 'settings.webhooks' }, { id: 'shopify-import', key: 'settings.shopifyImport' },
];

export function SettingsLayout() {
  const { t } = useI18n();
  const can = useStaffAccess();
  return (
    <>
      <PageHeader title={t('nav.settings')} />
      <div className="grid gap-4 md:grid-cols-[13rem_1fr]">
        <nav aria-label={t('nav.settings')} className="flex gap-1 overflow-x-auto md:flex-col">
          {SECTIONS.filter((s) => can(s.perm)).map((s) => (
            <NavLink key={s.id} to={`/settings/${s.id}`} className={({ isActive }) => cx('whitespace-nowrap rounded-md px-3 py-1.5 text-sm', isActive ? 'bg-primary-subtle font-medium text-primary' : 'hover:bg-surface')}>{t(s.key)}</NavLink>
          ))}
        </nav>
        <div className="min-w-0"><Outlet /></div>
      </div>
    </>
  );
}
export const SettingsIndex = () => <Navigate to="/settings/general" replace />;

export interface ShopData {
  name: string; email: string; description: string | null; currencyCode: string; ianaTimezone: string; weightUnit: string; taxesIncluded: boolean; taxShipping: boolean; locale: string;
  currencyFormats: { moneyFormat: string; moneyWithCurrencyFormat: string }; primaryDomain: { host: string; url: string } | null; myshopifyDomain: string;
  storefront: { passwordEnabled: boolean; password: string };
}
export interface ShopForm {
  name: string; email: string; description: string; currencyCode: string; ianaTimezone: string; weightUnit: string; moneyFormat: string; moneyWithCurrencyFormat: string;
  storefrontPasswordEnabled: boolean; storefrontPassword: string; taxesIncluded: boolean; taxShipping: boolean; primaryDomain: string; locale: string;
}
const toForm = (s: ShopData): ShopForm => ({
  name: s.name, email: s.email, description: s.description ?? '', currencyCode: s.currencyCode, ianaTimezone: s.ianaTimezone, weightUnit: s.weightUnit,
  moneyFormat: s.currencyFormats.moneyFormat, moneyWithCurrencyFormat: s.currencyFormats.moneyWithCurrencyFormat,
  storefrontPasswordEnabled: s.storefront.passwordEnabled, storefrontPassword: s.storefront.password, taxesIncluded: s.taxesIncluded, taxShipping: s.taxShipping,
  primaryDomain: s.primaryDomain && s.primaryDomain.host !== s.myshopifyDomain ? s.primaryDomain.host : '', locale: s.locale,
});

export const useShopSettings = () => useQuery({ queryKey: ['shop-settings'], queryFn: () => gql<{ shop: ShopData }>(SHOP) });

/** Loads the shop, edits a subset of its fields with a save bar, and saves via `shopUpdate`. */
function ShopPanel({ fields, children }: { fields: Array<keyof ShopForm>; children: (f: ShopForm, set: (p: Partial<ShopForm>) => void, shop: ShopData) => ReactNode }) {
  const q = useShopSettings();
  if (q.isLoading) return <Skeleton className="h-64" />;
  if (q.error) return <Banner>{q.error.message}</Banner>;
  return <ShopPanelForm key={q.dataUpdatedAt} shop={q.data!.shop} fields={fields}>{children}</ShopPanelForm>;
}

function ShopPanelForm({ shop, fields, children }: { shop: ShopData; fields: Array<keyof ShopForm>; children: (f: ShopForm, set: (p: Partial<ShopForm>) => void, shop: ShopData) => ReactNode }) {
  const { t } = useI18n();
  const toast = useToast();
  const qc = useQueryClient();
  const [initial] = useState(() => toForm(shop));
  const [form, setForm] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const dirty = fields.some((k) => form[k] !== initial[k]);
  const save = useMutation({
    mutationFn: () => mutate(SHOP_UPDATE, { input: Object.fromEntries(fields.map((k) => [k, form[k]])) }, 'shopmeShopUpdate'),
    onSuccess: () => { toast(t('settings.saved')); setError(null); void qc.invalidateQueries({ queryKey: ['shop-settings'] }); },
    onError: (e) => setError(e instanceof UserErrors ? e.errors.map((x) => x.message).join(' · ') : e.message),
  });
  return (
    <>
      <SaveBar dirty={dirty} saving={save.isPending} onSave={() => save.mutate()} onDiscard={() => { setForm(initial); setError(null); }} />
      {error && <div className="mb-4"><Banner>{error}</Banner></div>}
      <div className="flex flex-col gap-4">{children(form, (p) => setForm((f) => ({ ...f, ...p })), shop)}</div>
    </>
  );
}

export function GeneralSettings() {
  const { t } = useI18n();
  return (
    <ShopPanel fields={['name', 'email', 'description', 'currencyCode', 'ianaTimezone', 'weightUnit', 'moneyFormat', 'moneyWithCurrencyFormat', 'storefrontPasswordEnabled', 'storefrontPassword']}>
      {(f, set) => (
        <>
          <Card title={t('settings.storeDetails')}>
            <div className="grid gap-3 sm:grid-cols-2">
              <Input label={t('setup.shopName')} value={f.name} onChange={(e) => set({ name: e.target.value })} />
              <Input label={t('settings.contactEmail')} type="email" value={f.email} onChange={(e) => set({ email: e.target.value })} />
              <Textarea className="sm:col-span-2" label={t('field.description')} value={f.description} onChange={(e) => set({ description: e.target.value })} />
            </div>
          </Card>
          <Card title={t('settings.standards')}>
            <div className="grid gap-3 sm:grid-cols-2">
              <Select label={t('setup.currency')} value={f.currencyCode} onChange={(e) => set({ currencyCode: e.target.value })}>
                {[...new Set([f.currencyCode, ...CURRENCIES])].map((c) => <option key={c}>{c}</option>)}
              </Select>
              <Select label={t('settings.timezone')} value={f.ianaTimezone} onChange={(e) => set({ ianaTimezone: e.target.value })}>
                {[...new Set([f.ianaTimezone, ...TIMEZONES])].map((c) => <option key={c}>{c}</option>)}
              </Select>
              <Select label={t('settings.units')} value={f.weightUnit} onChange={(e) => set({ weightUnit: e.target.value })}>
                {['KILOGRAMS', 'GRAMS', 'POUNDS', 'OUNCES'].map((u) => <option key={u} value={u}>{t(`unit.${u}` as Key)}</option>)}
              </Select>
              <span />
              <Input label={t('settings.moneyFormat')} help={t('settings.moneyFormatHelp')} value={f.moneyFormat} onChange={(e) => set({ moneyFormat: e.target.value })} />
              <Input label={t('settings.moneyWithCurrencyFormat')} value={f.moneyWithCurrencyFormat} onChange={(e) => set({ moneyWithCurrencyFormat: e.target.value })} />
            </div>
          </Card>
          <Card title={t('settings.password')}>
            <div className="flex flex-col gap-3">
              <p className="text-sm text-muted">{t('settings.passwordHelp')}</p>
              <Switch checked={f.storefrontPasswordEnabled} onChange={(v) => set({ storefrontPasswordEnabled: v })} label={t('settings.passwordEnable')} />
              {f.storefrontPasswordEnabled && <Input className="max-w-sm" label={t('field.password')} value={f.storefrontPassword} onChange={(e) => set({ storefrontPassword: e.target.value })} />}
            </div>
          </Card>
        </>
      )}
    </ShopPanel>
  );
}

export function DomainsSettings() {
  const { t } = useI18n();
  return (
    <ShopPanel fields={['primaryDomain']}>
      {(f, set, shop) => (
        <>
          <Card title={t('settings.domains')}>
            <div className="flex flex-col gap-3">
              <p className="text-sm text-muted">{t('settings.defaultDomain')}: <span className="font-medium text-fg">{shop.myshopifyDomain}</span></p>
              <Input className="max-w-sm" label={t('settings.primaryDomain')} placeholder="shop.example.com" value={f.primaryDomain} onChange={(e) => set({ primaryDomain: e.target.value.trim().toLowerCase() })} />
            </div>
          </Card>
          <Card title={t('settings.dnsTitle')}>
            <ol className="list-decimal space-y-1 pl-5 text-sm">
              <li>{t('settings.dns1')}</li>
              <li>{t('settings.dns2', { host: shop.myshopifyDomain })}</li>
              <li>{t('settings.dns3')}</li>
            </ol>
          </Card>
        </>
      )}
    </ShopPanel>
  );
}

export function LanguagesSettings() {
  const { t } = useI18n();
  return (
    <ShopPanel fields={['locale']}>
      {(f, set) => (
        <Card title={t('settings.languages')}>
          <div className="flex flex-col gap-3">
            <p className="text-sm text-muted">{t('settings.languagesHelp')}</p>
            <Select className="max-w-xs" label={t('settings.storeLocale')} value={f.locale} onChange={(e) => set({ locale: e.target.value })}>
              {[...new Set([f.locale, 'en', 'fr'])].map((l) => <option key={l} value={l}>{l === 'en' ? 'English' : l === 'fr' ? 'Français' : l}</option>)}
            </Select>
          </div>
        </Card>
      )}
    </ShopPanel>
  );
}

export function TaxToggles() {
  const { t } = useI18n();
  return (
    <ShopPanel fields={['taxesIncluded', 'taxShipping']}>
      {(f, set) => (
        <Card title={t('settings.taxOptions')}>
          <div className="flex flex-col gap-3">
            <Checkbox label={t('settings.taxesIncluded')} checked={f.taxesIncluded} onChange={(e) => set({ taxesIncluded: e.target.checked })} />
            <Checkbox label={t('settings.taxShipping')} checked={f.taxShipping} onChange={(e) => set({ taxShipping: e.target.checked })} />
          </div>
        </Card>
      )}
    </ShopPanel>
  );
}
