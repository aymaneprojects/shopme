import { Banner, Button, Card, Checkbox, Input, Modal, Select, Skeleton, Switch, Textarea, useToast } from '@shopme/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { mutate } from '../../api';
import { Section } from '../../components/SettingsKit';
import { SaveBar } from '../../components/SaveBar';
import { SHOP_DELETE, SHOP_UPDATE, SHOPME_CONFIG_UPDATE } from '../../graphql';
import { useI18n } from '../../i18n';
import type { Key } from '../../i18n';
import { CURRENCIES, TIMEZONES, countryOptions } from '../../lib/countries';
import { errText, useConfig } from '../../lib/config';
import type { GeneralConfig, OrdersConfig } from '../../lib/config';
import { useShop } from '../../session';
import { useShopSettings } from './Settings';
import type { ShopData } from './Settings';

const METRIC = ['KILOGRAMS', 'GRAMS'];
const IMPERIAL = ['POUNDS', 'OUNCES'];
const systemOf = (unit: string) => (IMPERIAL.includes(unit) ? 'IMPERIAL' : 'METRIC');

interface Form {
  name: string; email: string; description: string; currencyCode: string; ianaTimezone: string; weightUnit: string; moneyFormat: string; moneyWithCurrencyFormat: string;
  storefrontPasswordEnabled: boolean; storefrontPassword: string;
  phone: string; company: string; address1: string; address2: string; city: string; zip: string; provinceCode: string; countryCode: string;
  general: GeneralConfig; orders: OrdersConfig;
}

const toForm = (s: ShopData, general: GeneralConfig, orders: OrdersConfig): Form => ({
  name: s.name, email: s.email, description: s.description ?? '', currencyCode: s.currencyCode, ianaTimezone: s.ianaTimezone, weightUnit: s.weightUnit,
  moneyFormat: s.currencyFormats.moneyFormat, moneyWithCurrencyFormat: s.currencyFormats.moneyWithCurrencyFormat, storefrontPasswordEnabled: s.storefront.passwordEnabled, storefrontPassword: s.storefront.password,
  phone: s.address?.phone ?? '', company: s.address?.company ?? '', address1: s.address?.address1 ?? '', address2: s.address?.address2 ?? '', city: s.address?.city ?? '', zip: s.address?.zip ?? '',
  provinceCode: s.address?.provinceCode ?? '', countryCode: s.address?.countryCode ?? '', general, orders,
});

export function GeneralSettings() {
  const shop = useShopSettings();
  const general = useConfig<GeneralConfig>('GENERAL');
  const orders = useConfig<OrdersConfig>('ORDERS');
  if (shop.isLoading || general.isLoading || orders.isLoading) return <Skeleton className="h-64" />;
  const err = shop.error ?? general.error ?? orders.error;
  if (err) return <Banner>{err.message}</Banner>;
  return <GeneralForm key={`${shop.dataUpdatedAt}-${general.dataUpdatedAt}-${orders.dataUpdatedAt}`} shop={shop.data!.shop} general={general.data!} orders={orders.data!} />;
}

function GeneralForm({ shop, general, orders }: { shop: ShopData; general: GeneralConfig; orders: OrdersConfig }) {
  const { t, lang } = useI18n();
  const toast = useToast();
  const qc = useQueryClient();
  const [initial] = useState(() => toForm(shop, general, orders));
  const [f, setF] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const set = (p: Partial<Form>) => setF((x) => ({ ...x, ...p }));
  const dirty = JSON.stringify(f) !== JSON.stringify(initial);
  const countries = countryOptions(lang);
  const sameShop = (k: keyof Form) => f[k] === initial[k];

  const save = useMutation({
    mutationFn: async () => {
      const shopKeys: Array<keyof Form> = ['name', 'email', 'description', 'currencyCode', 'ianaTimezone', 'weightUnit', 'moneyFormat', 'moneyWithCurrencyFormat', 'storefrontPasswordEnabled', 'storefrontPassword'];
      const addrKeys: Array<keyof Form> = ['phone', 'company', 'address1', 'address2', 'city', 'zip', 'provinceCode', 'countryCode'];
      const input: Record<string, unknown> = Object.fromEntries(shopKeys.filter((k) => !sameShop(k)).map((k) => [k, f[k]]));
      if (addrKeys.some((k) => !sameShop(k))) input.address = Object.fromEntries(addrKeys.filter((k) => !sameShop(k) && !(k === 'countryCode' && f.countryCode === '')).map((k) => [k, f[k]]));
      if (Object.keys(input).length) await mutate(SHOP_UPDATE, { input }, 'shopmeShopUpdate');
      if (JSON.stringify(f.general) !== JSON.stringify(initial.general)) await mutate(SHOPME_CONFIG_UPDATE, { key: 'GENERAL', value: f.general }, 'shopmeConfigUpdate');
      if (JSON.stringify(f.orders) !== JSON.stringify(initial.orders)) await mutate(SHOPME_CONFIG_UPDATE, { key: 'ORDERS', value: f.orders }, 'shopmeConfigUpdate');
    },
    onSuccess: () => { toast(t('settings.saved')); setError(null); void qc.invalidateQueries({ queryKey: ['shop-settings'] }); void qc.invalidateQueries({ queryKey: ['config'] }); },
    onError: (e) => setError(errText(e)),
  });

  const system = systemOf(f.weightUnit);
  const host = shop.primaryDomain?.host ?? shop.myshopifyDomain;
  const be = f.general.businessEntity;
  const setBe = (p: Partial<GeneralConfig['businessEntity']>) => set({ general: { ...f.general, businessEntity: { ...be, ...p } } });
  const setOrders = (p: Partial<OrdersConfig>) => set({ orders: { ...f.orders, ...p } });

  return (
    <>
      <SaveBar dirty={dirty} saving={save.isPending} onSave={() => save.mutate()} onDiscard={() => { setF(initial); setError(null); }} />
      {error && <div className="mb-4"><Banner>{error}</Banner></div>}
      <fieldset disabled={save.isPending} className="flex min-w-0 flex-col gap-4">
        <div className="flex items-center gap-3 rounded-lg bg-canvas p-4 shadow-card">
          <span aria-hidden className="flex size-12 items-center justify-center rounded-lg bg-primary text-lg font-semibold text-white">{(f.name.trim()[0] ?? '?').toUpperCase()}</span>
          <div className="min-w-0 flex-1"><p className="truncate text-base font-semibold">{f.name || shop.name}</p><p className="truncate text-[13px] text-muted">{host}</p></div>
          <Link to="/settings/domains" className="btn btn-secondary">{t('bs.manageDomains')}</Link>
        </div>

        <Section title={t('settings.storeDetails')} description={t('settings.storeDetailsDesc')}><Card>
          <div className="grid gap-3 sm:grid-cols-2">
            <Input label={t('setup.shopName')} value={f.name} onChange={(e) => set({ name: e.target.value })} />
            <Input label={t('settings.contactEmail')} type="email" value={f.email} onChange={(e) => set({ email: e.target.value })} />
            <Input label={t('bs.storePhone')} type="tel" autoComplete="tel" value={f.phone} onChange={(e) => set({ phone: e.target.value })} />
            <span />
            <Textarea className="sm:col-span-2" label={t('field.description')} value={f.description} onChange={(e) => set({ description: e.target.value })} />
          </div>
        </Card></Section>

        <Section title={t('bs.storeAddress')} description={t('bs.storeAddressDesc')}><Card>
          <div className="grid gap-3 sm:grid-cols-2">
            <Input label={t('bs.company')} value={f.company} onChange={(e) => set({ company: e.target.value })} className="sm:col-span-2" />
            <Input label={t('bs.address1')} value={f.address1} onChange={(e) => set({ address1: e.target.value })} className="sm:col-span-2" />
            <Input label={t('bs.address2')} value={f.address2} onChange={(e) => set({ address2: e.target.value })} className="sm:col-span-2" />
            <Input label={t('bs.city')} value={f.city} onChange={(e) => set({ city: e.target.value })} />
            <Input label={t('bs.zip')} value={f.zip} onChange={(e) => set({ zip: e.target.value })} />
            <Select label={t('taxes.country')} value={f.countryCode} onChange={(e) => set({ countryCode: e.target.value })}>
              <option value="" />{countries.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
            </Select>
            <Input label={t('bs.province')} value={f.provinceCode} onChange={(e) => set({ provinceCode: e.target.value.toUpperCase() })} />
          </div>
        </Card></Section>

        <Section title={t('bs.businessEntity')} description={t('bs.businessEntityDesc')}><Card>
          <div className="grid gap-3 sm:grid-cols-2">
            <Input label={t('bs.legalName')} value={be.legalName} onChange={(e) => setBe({ legalName: e.target.value })} />
            <Input label={t('bs.taxId')} help={t('bs.taxIdHelp')} value={be.taxId} onChange={(e) => setBe({ taxId: e.target.value })} />
            <Input label={t('bs.address1')} value={be.address1} onChange={(e) => setBe({ address1: e.target.value })} className="sm:col-span-2" />
            <Input label={t('bs.address2')} value={be.address2} onChange={(e) => setBe({ address2: e.target.value })} className="sm:col-span-2" />
            <Input label={t('bs.city')} value={be.city} onChange={(e) => setBe({ city: e.target.value })} />
            <Input label={t('bs.zip')} value={be.zip} onChange={(e) => setBe({ zip: e.target.value })} />
            <Select label={t('taxes.country')} value={be.countryCode} onChange={(e) => setBe({ countryCode: e.target.value })}>
              <option value="" />{countries.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
            </Select>
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
            <Select label={t('bs.unitSystem')} value={system} onChange={(e) => set({ weightUnit: e.target.value === 'IMPERIAL' ? 'POUNDS' : 'KILOGRAMS' })}>
              <option value="METRIC">{t('bs.metric')}</option><option value="IMPERIAL">{t('bs.imperial')}</option>
            </Select>
            <Select label={t('settings.units')} value={f.weightUnit} onChange={(e) => set({ weightUnit: e.target.value })}>
              {(system === 'IMPERIAL' ? IMPERIAL : METRIC).map((u) => <option key={u} value={u}>{t(`unit.${u}` as Key)}</option>)}
            </Select>
            <Select label={t('bs.backupRegion')} help={t('bs.backupRegionHelp')} value={f.general.backupRegion} onChange={(e) => set({ general: { ...f.general, backupRegion: e.target.value } })}>
              <option value="">{t('bs.backupNone')}</option>{countries.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
            </Select>
            <span />
            <Input label={t('settings.moneyFormat')} help={t('settings.moneyFormatHelp')} value={f.moneyFormat} onChange={(e) => set({ moneyFormat: e.target.value })} />
            <Input label={t('settings.moneyWithCurrencyFormat')} value={f.moneyWithCurrencyFormat} onChange={(e) => set({ moneyWithCurrencyFormat: e.target.value })} />
          </div>
        </Card></Section>

        <Section title={t('bs.orderId')} description={t('bs.orderIdDesc')}><Card>
          <div className="grid gap-3 sm:grid-cols-2">
            <Input label={t('bs.orderPrefix')} value={f.orders.idPrefix} maxLength={16} onChange={(e) => setOrders({ idPrefix: e.target.value })} />
            <Input label={t('bs.orderSuffix')} value={f.orders.idSuffix} maxLength={16} onChange={(e) => setOrders({ idSuffix: e.target.value })} />
          </div>
          <p className="mt-3 text-[13px] text-muted">{t('bs.orderIdExample', { id: `${f.orders.idPrefix}1001${f.orders.idSuffix}` })}</p>
        </Card></Section>

        <Section title={t('bs.orderProcessing')} description={t('bs.orderProcessingDesc')}><Card>
          <div className="flex flex-col gap-3">
            <Checkbox label={t('bs.autoArchive')} checked={f.orders.autoArchive} onChange={(e) => setOrders({ autoArchive: e.target.checked })} />
            <Checkbox label={t('bs.autoFulfilGift')} checked={f.orders.autoFulfillGiftCards} onChange={(e) => setOrders({ autoFulfillGiftCards: e.target.checked })} />
          </div>
        </Card></Section>

        <Section title={t('settings.password')}><Card>
          <div className="flex flex-col gap-3">
            <p className="text-[13px] text-muted">{t('settings.passwordHelp')}</p>
            <Switch placement="end" checked={f.storefrontPasswordEnabled} onChange={(v) => set({ storefrontPasswordEnabled: v })} label={t('settings.passwordEnable')} />
            {f.storefrontPasswordEnabled && <Input className="max-w-sm" label={t('field.password')} value={f.storefrontPassword} onChange={(e) => set({ storefrontPassword: e.target.value })} />}
          </div>
        </Card></Section>

        <DeleteStore name={shop.name} />
      </fieldset>
    </>
  );
}

/** Danger zone: deleting the store writes a final export to the server backups folder first. Owner only. */
function DeleteStore({ name }: { name: string }) {
  const { t } = useI18n();
  const { user } = useShop();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const [error, setError] = useState<string | null>(null);
  const del = useMutation({
    mutationFn: () => mutate(SHOP_DELETE, { confirmName: typed.trim() }, 'shopmeShopDelete'),
    onSuccess: () => { window.location.assign('/admin/'); },
    onError: (e) => setError(errText(e)),
  });
  if (user.role !== 'owner') return null;
  return (
    <Section title={t('bs.deleteStore')} description={t('bs.deleteStoreDesc')}>
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Link to="/settings/backup" className="btn btn-secondary">{t('bs.exportFirst')}</Link>
          <Button variant="danger" onClick={() => { setError(null); setTyped(''); setOpen(true); }}><Trash2 className="size-4" />{t('bs.deleteStore')}</Button>
        </div>
      </Card>
      <Modal open={open} onClose={() => setOpen(false)} closeLabel={t('common.close')} title={t('bs.deleteStore')}
        footer={<><Button onClick={() => setOpen(false)}>{t('common.cancel')}</Button><Button variant="danger" loading={del.isPending} disabled={typed.trim() !== name} onClick={() => del.mutate()}>{t('bs.deleteStoreConfirm')}</Button></>}>
        <div className="flex flex-col gap-3">
          {error && <Banner>{error}</Banner>}
          <p className="text-[13px]">{t('bs.deleteStoreBody')}</p>
          <Input label={t('bs.typeName', { name })} value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />
        </div>
      </Modal>
    </Section>
  );
}
