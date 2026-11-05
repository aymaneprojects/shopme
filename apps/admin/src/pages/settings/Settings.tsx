import { Badge, Banner, Button, Card, Input, Modal, Select, Skeleton, Switch, Textarea, useToast, cx } from '@shopme/ui';
import { Globe } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Navigate, Outlet, useLocation } from 'react-router';
import type { ReactNode } from 'react';
import { useState } from 'react';
import { UserErrors, gql, mutate } from '../../api';
import { Section, SettingsActions, SettingsSlot } from '../../components/SettingsKit';
import { SaveBar } from '../../components/SaveBar';
import { SHOP, SHOP_UPDATE } from '../../graphql';
import { useI18n } from '../../i18n';
import type { Key } from '../../i18n';
import { CURRENCIES, TIMEZONES } from '../../lib/countries';
import { SETTINGS_SECTIONS } from '../../lib/settingsNav';

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
            <h1 className="text-xl font-semibold leading-8">{t(section.key)}</h1>
            <div ref={setSlot} className="flex items-center gap-2" />
          </div>
        )}
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

export function GeneralSettings() {
  const { t } = useI18n();
  return (
    <ShopPanel fields={['name', 'email', 'description', 'currencyCode', 'ianaTimezone', 'weightUnit', 'moneyFormat', 'moneyWithCurrencyFormat', 'storefrontPasswordEnabled', 'storefrontPassword']}>
      {(f, set) => (
        <>
          <Section title={t('settings.storeDetails')} description={t('settings.storeDetailsDesc')}><Card>
            <div className="grid gap-3 sm:grid-cols-2">
              <Input label={t('setup.shopName')} value={f.name} onChange={(e) => set({ name: e.target.value })} />
              <Input label={t('settings.contactEmail')} type="email" value={f.email} onChange={(e) => set({ email: e.target.value })} />
              <Textarea className="sm:col-span-2" label={t('field.description')} value={f.description} onChange={(e) => set({ description: e.target.value })} />
            </div>
          </Card></Section>
          <Section title={t('settings.standards')} description={t('settings.standardsDesc')}><Card>
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
          </Card></Section>
          <Section title={t('settings.password')}><Card>
            <div className="flex flex-col gap-3">
              <p className="text-[13px] text-muted">{t('settings.passwordHelp')}</p>
              <Switch checked={f.storefrontPasswordEnabled} onChange={(v) => set({ storefrontPasswordEnabled: v })} label={t('settings.passwordEnable')} />
              {f.storefrontPasswordEnabled && <Input className="max-w-sm" label={t('field.password')} value={f.storefrontPassword} onChange={(e) => set({ storefrontPassword: e.target.value })} />}
            </div>
          </Card></Section>
        </>
      )}
    </ShopPanel>
  );
}

export function DomainsSettings() {
  const { t } = useI18n();
  const toast = useToast();
  const qc = useQueryClient();
  const q = useShopSettings();
  const [connect, setConnect] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: (primaryDomain: string) => mutate(SHOP_UPDATE, { input: { primaryDomain } }, 'shopmeShopUpdate'),
    onSuccess: () => { toast(t('settings.saved')); setConnect(null); setError(null); void qc.invalidateQueries({ queryKey: ['shop-settings'] }); },
    onError: (e) => setError(e instanceof UserErrors ? e.errors.map((x) => x.message).join(' · ') : e.message),
  });
  if (q.isLoading) return <Skeleton className="h-32" />;
  if (q.error) return <Banner>{q.error.message}</Banner>;
  const shop = q.data!.shop;
  const custom = shop.primaryDomain && shop.primaryDomain.host !== shop.myshopifyDomain ? shop.primaryDomain.host : '';
  const rows = [...(custom ? [{ host: custom, primary: true, custom: true }] : []), { host: shop.myshopifyDomain, primary: !custom, custom: false }];
  return (
    <>
      <SettingsActions><Button variant="primary" onClick={() => { setError(null); setConnect(custom); }}>{t('settings.connectDomain')}</Button></SettingsActions>
      <div className="overflow-hidden rounded-lg bg-canvas shadow-card">
        <div className="grid grid-cols-[1fr_8rem_auto] gap-3 border-b border-line bg-surface px-4 py-2 text-[13px] text-muted"><span>{t('settings.domain')}</span><span>{t('field.status')}</span><span className="w-20" /></div>
        <ul className="divide-y divide-line">
          {rows.map((r) => (
            <li key={r.host} className="grid grid-cols-[1fr_8rem_auto] items-center gap-3 px-4 py-3 text-[13px]">
              <span className="flex min-w-0 items-center gap-2"><Globe className="size-4 shrink-0 text-muted" /><span className="truncate font-medium">{r.host}</span>{r.primary && <Badge>{t('settings.primaryBadge')}</Badge>}</span>
              <span><Badge tone="success">{t('settings.connected')}</Badge></span>
              <span className="flex w-20 justify-end gap-1">{r.custom && <><Button size="sm" onClick={() => { setError(null); setConnect(r.host); }}>{t('common.edit')}</Button><Button size="sm" variant="danger" loading={save.isPending} onClick={() => save.mutate('')}>{t('settings.disconnect')}</Button></>}</span>
            </li>
          ))}
        </ul>
      </div>
      <p className="mt-3 text-center text-[13px] text-muted">{t('settings.domainsHelp')}</p>
      <Modal open={connect !== null} onClose={() => setConnect(null)} closeLabel={t('common.close')} title={t('settings.connectDomain')}
        footer={<><Button onClick={() => setConnect(null)}>{t('common.cancel')}</Button><Button variant="primary" loading={save.isPending} disabled={!connect?.includes('.')} onClick={() => save.mutate(connect!)}>{t('settings.connect')}</Button></>}>
        <div className="flex flex-col gap-3">
          {error && <Banner>{error}</Banner>}
          <Input label={t('settings.primaryDomain')} placeholder="shop.example.com" value={connect ?? ''} onChange={(e) => setConnect(e.target.value.trim().toLowerCase())} />
          <ol className="list-decimal space-y-1 pl-5 text-[13px] text-muted">
            <li>{t('settings.dns1')}</li>
            <li>{t('settings.dns2', { host: shop.myshopifyDomain })}</li>
            <li>{t('settings.dns3')}</li>
          </ol>
        </div>
      </Modal>
    </>
  );
}

export function TaxToggles() {
  const { t } = useI18n();
  return (
    <ShopPanel fields={['taxesIncluded', 'taxShipping']}>
      {(f, set) => (
        <Section title={t('settings.taxOptions')}><Card>
          <div className="flex flex-col gap-3">
            <Switch label={t('settings.taxesIncluded')} checked={f.taxesIncluded} onChange={(v) => set({ taxesIncluded: v })} />
            <Switch label={t('settings.taxShipping')} checked={f.taxShipping} onChange={(v) => set({ taxShipping: v })} />
          </div>
        </Card></Section>
      )}
    </ShopPanel>
  );
}
