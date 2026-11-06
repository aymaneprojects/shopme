import { Badge, Banner, Button, Card, Input, Modal, Select, Skeleton, Switch, Textarea, useToast, cx } from '@shopme/ui';
import { Globe } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Navigate, Outlet, useLocation } from 'react-router';
import type { ReactNode } from 'react';
import { useState } from 'react';
import { UserErrors, gql, mutate } from '../../api';
import { SettingsActions, SettingsSlot } from '../../components/SettingsKit';
import { SaveBar } from '../../components/SaveBar';
import { SHOP, SHOP_UPDATE } from '../../graphql';
import { useI18n } from '../../i18n';
import type { Key } from '../../i18n';
import { CURRENCIES, TIMEZONES } from '../../lib/countries';
import { SETTINGS_SECTIONS } from '../../lib/settingsNav';
import { useMulti } from '../../session';
import { EmailBanner } from '../../components/EmailSetup';

/** Settings pages sit in a narrow centered column under a large title; sub-pages draw their own header. */
export function SettingsLayout() {
  const { t } = useI18n();
  const { pathname } = useLocation();
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  const section = SETTINGS_SECTIONS.find((s) => pathname === `/settings/${s.id}`);
  const wide = /^\/settings\/(notifications\/(?!customer$|staff$)[^/]+|languages\/translate)$/.test(pathname);
  return (
    <SettingsSlot.Provider value={slot}>
      <div className={cx('mx-auto w-full', wide ? 'max-w-[900px]' : 'max-w-[680px]')}>
        {section && (
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
            <h1 className="text-xl font-semibold leading-8">{section.id === 'users' ? t('users.title') : section.id === 'checkout' ? t('checkout.pageTitle') : t(section.key)}</h1>
            <div ref={setSlot} className="flex items-center gap-2" />
          </div>
        )}
        {pathname !== '/settings/emails' && !pathname.startsWith('/settings/notifications') && !pathname.startsWith('/settings/domains/') && <EmailBanner />}
        <Outlet />
      </div>
    </SettingsSlot.Provider>
  );
}
export const SettingsIndex = () => <Navigate to="/settings/general" replace />;

export interface ShopData {
  name: string; email: string; description: string | null; currencyCode: string; ianaTimezone: string; weightUnit: string; taxesIncluded: boolean; taxShipping: boolean; locale: string;
  currencyFormats: { moneyFormat: string; moneyWithCurrencyFormat: string }; primaryDomain: { host: string; url: string } | null; myshopifyDomain: string;
  storefront: { passwordEnabled: boolean; password: string };
  address?: { company: string | null; address1: string | null; address2: string | null; city: string | null; zip: string | null; provinceCode: string | null; countryCode: string | null; phone: string | null };
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
export function ShopPanel({ fields, children }: { fields: Array<keyof ShopForm>; children: (f: ShopForm, set: (p: Partial<ShopForm>) => void, shop: ShopData) => ReactNode }) {
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
