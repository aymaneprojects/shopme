import { Badge, Banner, Button, ConfirmDialog, Dropdown, Input, Modal, Select, Skeleton, Switch, cx } from '@shopme/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Calculator, ChevronDown, FlaskConical, MoreHorizontal, Pencil, PlusCircle, Tag, Trash2, Truck } from 'lucide-react';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { gql } from '../../api';
import { RowCard } from '../../components/SettingsKit';
import { useFormat } from '../../components/shared';
import { LABEL_ESTIMATE, SHIPPING_PACKAGES } from '../../graphql';
import { parseDecimal } from '../../format';
import { useI18n } from '../../i18n';
import { newId, useConfig, useSaveConfig } from '../../lib/config';
import type { CarrierAccount, ShippingConfig } from '../../lib/config';
import { countryOptions } from '../../lib/countries';
import { GRAMS_PER, WEIGHT_ABBR } from '../../lib/shipping';
import { useShop } from '../../session';

/** A label rate as the API returns it (rates for an order, or an estimate). */
export interface LabelRate { accountId: string; accountName: string; test: boolean; rateId: string; service: string; name: string; price: string; currencyCode: string; estimatedDays: number | null }
export interface RatesAnswer { rates: LabelRate[]; carrierErrors: Array<{ accountId: string; accountName: string; message: string }>; userErrors: Array<{ field: string[] | null; message: string }> }

/** Accounts that can sell postage: the test carrier always, HTTP accounts when the merchant says their service does. */
export const sellsLabels = (a: CarrierAccount) => a.provider === 'test' || a.labels;

/** Row of the Shipping card that opens in place and carries a button next to its summary (the button is not part of the toggle). */
function ActionCollapseRow({ title, description, summary, action, children }: { title: ReactNode; description: ReactNode; summary?: ReactNode; action?: ReactNode; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <div className="flex w-full items-center gap-3 px-4 py-3 hover:bg-hover">
        <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="min-w-0 flex-1 text-left">
          <span className="block text-[13px] font-medium">{title}</span><span className="block text-[13px] text-muted">{description}</span>
        </button>
        {summary && <span className="shrink-0 text-[13px] text-muted">{summary}</span>}
        {action && <span className="shrink-0">{action}</span>}
        <button type="button" tabIndex={-1} aria-hidden onClick={() => setOpen(!open)} className="shrink-0"><ChevronDown className={cx('size-4 text-muted transition-transform', open && 'rotate-180')} /></button>
      </div>
      {open && <div className="px-3 pb-3">{children}</div>}
    </div>
  );
}

/** Badges of a carrier account: what it does at checkout and whether it sells labels. */
function AccountBadges({ a }: { a: CarrierAccount }) {
  const { t } = useI18n();
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      {a.provider === 'test' && <Badge tone="attention">{t('postage.testBadge')}</Badge>}
      <Badge>{t('postage.carrierRates')}</Badge>
      {sellsLabels(a) ? <Badge tone="success">{t('postage.labelsYes')}</Badge> : <Badge>{t('postage.labelsNo')}</Badge>}
    </span>
  );
}

/** Settings > Shipping, "Shipping labels" row: carriers that sell labels, and the rate calculator. */
export function LabelsRow() {
  const { t } = useI18n();
  const cfg = useConfig<ShippingConfig>('SHIPPING');
  const [calc, setCalc] = useState(false);
  const sellers = (cfg.data?.carrierAccounts ?? []).filter(sellsLabels);
  return (
    <>
      <ActionCollapseRow title={t('postage.labelsRow')} description={t('postage.labelsRowDesc')}
        summary={sellers.length ? t('postage.labelCarriers', { n: sellers.length }) : t('postage.labelsOff')}
        action={<Button size="sm" onClick={() => setCalc(true)}><Calculator className="size-3.5" />{t('postage.calculate')}</Button>}>
        <RowCard className="border border-line shadow-none">
          {cfg.isLoading ? <div className="p-3"><Skeleton className="h-10" /></div> : sellers.length === 0 ? <p className="px-4 py-3 text-[13px] text-muted">{t('postage.labelsNone')}</p> : (
            <>
              <p className="px-4 py-2.5 text-[13px] text-muted">{t('postage.labelsHelp')}</p>
              {sellers.map((a) => (
                <div key={a.id} className="flex items-center gap-3 px-4 py-3">
                  <Tag className="size-4 shrink-0 text-muted" />
                  <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{a.name}</span>
                  {a.provider === 'test' ? <Badge tone="attention">{t('postage.testBadge')}</Badge> : <Badge tone="success">{t('postage.labelsYes')}</Badge>}
                </div>
              ))}
            </>
          )}
        </RowCard>
      </ActionCollapseRow>
      {calc && <CalculateRatesModal onClose={() => setCalc(false)} />}
    </>
  );
}

/** Settings > Shipping, "Carrier accounts" row: the accounts with what they do (rates, labels), add / edit / delete, and the test carrier. */
export function CarrierAccountsRow() {
  const { t } = useI18n();
  const qc = useQueryClient();
  const cfg = useConfig<ShippingConfig>('SHIPPING');
  const [modal, setModal] = useState<{ id: string | null } | null>(null);
  const [del, setDel] = useState<CarrierAccount | null>(null);
  const save = useSaveConfig<ShippingConfig>('SHIPPING', () => { setModal(null); setDel(null); void qc.invalidateQueries({ queryKey: ['label-carriers'] }); void qc.invalidateQueries({ queryKey: ['order-labels'] }); });
  const c = cfg.data;
  const accounts = c?.carrierAccounts ?? [];
  const put = (carrierAccounts: CarrierAccount[]) => c && save.mutate({ ...c, carrierAccounts });
  const hasTest = accounts.some((a) => a.provider === 'test');
  const addTest = () => put([...accounts, { id: newId(accounts.map((a) => a.id), 'test-carrier'), provider: 'test', name: t('postage.testName'), endpoint: '', secret: '', labels: true }]);
  return (
    <>
      <ActionCollapseRow title={t('fid.ship.carriers')} description={t('fid.ship.carriersDesc')} summary={accounts.length ? t('fid.ship.accountsCount', { n: accounts.length }) : t('fid.ship.none')}>
        <RowCard className="border border-line shadow-none">
          {cfg.isLoading && <div className="p-3"><Skeleton className="h-10" /></div>}
          {accounts.map((a) => (
            <div key={a.id} className="flex items-center gap-3 px-4 py-3" data-testid="carrier-account">
              {a.provider === 'test' ? <FlaskConical className="size-4 shrink-0 text-muted" /> : <Truck className="size-4 shrink-0 text-muted" />}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-medium">{a.name}</span>
                <span className="block truncate text-xs text-muted">{a.provider === 'test' ? t('postage.providerTest') : a.endpoint}</span>
                <span className="mt-1 block"><AccountBadges a={a} /></span>
              </span>
              <Dropdown align="right" variant="plain" size="sm" icon label={t('common.moreActions')} trigger={<MoreHorizontal className="size-4" />} items={[
                { key: 'edit', icon: <Pencil />, label: t('common.edit'), onSelect: () => setModal({ id: a.id }) },
                { key: 'del', icon: <Trash2 />, label: t('common.delete'), danger: true, onSelect: () => setDel(a) },
              ]} />
            </div>
          ))}
          <button type="button" className="flex w-full items-center gap-2 px-4 py-3 text-left text-[13px] hover:bg-hover" onClick={() => setModal({ id: null })}><PlusCircle className="size-4" />{t('bs.addCarrier')}</button>
          {!hasTest && <button type="button" className="flex w-full items-center gap-2 px-4 py-3 text-left text-[13px] hover:bg-hover" disabled={save.isPending || !c} onClick={addTest}><FlaskConical className="size-4" />{t('postage.addTest')}</button>}
        </RowCard>
      </ActionCollapseRow>
      {modal && c && <CarrierModal cfg={c} id={modal.id} saving={save.isPending} onClose={() => setModal(null)} onSave={put} />}
      <ConfirmDialog open={!!del} danger onClose={() => setDel(null)} title={t('bs.deleteItemTitle', { name: del?.name ?? '' })} message={t('bs.deleteItemBody')} confirmLabel={t('common.delete')} cancelLabel={t('common.cancel')}
        onConfirm={() => del && put(accounts.filter((x) => x.id !== del.id))} />
    </>
  );
}

function CarrierModal({ cfg, id, saving, onClose, onSave }: { cfg: ShippingConfig; id: string | null; saving: boolean; onClose: () => void; onSave: (l: CarrierAccount[]) => void }) {
  const { t } = useI18n();
  const cur = cfg.carrierAccounts.find((s) => s.id === id);
  const [f, setF] = useState(() => ({ provider: cur?.provider ?? 'http', name: cur?.name ?? '', endpoint: cur?.endpoint ?? '', secret: cur?.secret ?? '', labels: cur?.labels ?? false }));
  const http = f.provider === 'http';
  const valid = !!f.name.trim() && (!http || /^https?:\/\//.test(f.endpoint));
  const value: Omit<CarrierAccount, 'id'> = { ...f, name: f.name.trim(), endpoint: http ? f.endpoint : '', secret: http ? f.secret : '', labels: http ? f.labels : true };
  return (
    <Modal open onClose={onClose} closeLabel={t('common.close')} title={t(cur ? 'bs.editCarrier' : 'bs.addCarrier')}
      footer={<><Button onClick={onClose}>{t('common.cancel')}</Button><Button variant="primary" loading={saving} disabled={!valid} onClick={() => onSave(cur ? cfg.carrierAccounts.map((s) => (s.id === cur.id ? { ...s, ...value } : s)) : [...cfg.carrierAccounts, { id: newId(cfg.carrierAccounts.map((s) => s.id), value.name), ...value }])}>{t('save.save')}</Button></>}>
      <div className="flex flex-col gap-3">
        <Select label={t('postage.provider')} value={f.provider} disabled={!!cur} onChange={(e) => setF({ ...f, provider: e.target.value as CarrierAccount['provider'] })}>
          <option value="http">{t('postage.providerHttp')}</option><option value="test">{t('postage.providerTest')}</option>
        </Select>
        {http ? <p className="text-[13px] text-muted">{t('bs.carrierIntro')}</p> : <Banner tone="warning">{t('postage.testIntro')}</Banner>}
        <Input label={t('bs.carrierName')} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        {http && (
          <>
            <Input label={t('bs.carrierEndpoint')} placeholder="https://carrier.example.com/shopme" value={f.endpoint} onChange={(e) => setF({ ...f, endpoint: e.target.value.trim() })} />
            <Input label={t('bs.carrierSecret')} help={t('bs.carrierSecretHelp')} value={f.secret} onChange={(e) => setF({ ...f, secret: e.target.value })} />
            <div>
              <Switch checked={f.labels} onChange={(v) => setF({ ...f, labels: v })} label={t('postage.sellsLabels')} />
              <p className="mt-1 text-xs text-muted">{t('postage.sellsLabelsHelp')}</p>
            </div>
            <pre className="overflow-x-auto rounded-md bg-surface p-3 text-xs">{'POST → {"service":"…","grams":1200,"subtotal":4500,"destination":{"countryCode":"FR"}}\n← {"price":590}'}{f.labels ? '\nPOST → {"action":"label_rates","shipment":{…}}\n← {"rates":[{"id":"std","name":"Standard","price":590,"currency":"EUR"}]}' : ''}</pre>
          </>
        )}
      </div>
    </Modal>
  );
}

/** Label rates as a list: carrier, service, delivery time, price; selectable when `onSelect` is given. */
export function RatesList({ answer, selected, onSelect }: { answer: RatesAnswer; selected?: string | null; onSelect?: (r: LabelRate) => void }) {
  const { t, lang } = useI18n();
  const fmt = useFormat();
  const key = (r: LabelRate) => `${r.accountId}:${r.rateId}`;
  return (
    <div className="flex flex-col gap-2">
      {answer.carrierErrors.map((e) => <Banner key={e.accountId} tone="warning">{e.message}</Banner>)}
      {answer.rates.length === 0 ? <p className="text-[13px] text-muted">{t('postage.noRates')}</p> : (
        <ul className="divide-y divide-line rounded-lg border border-line" role={onSelect ? 'radiogroup' : undefined} aria-label={t('postage.rates')} data-testid="label-rates">
          {answer.rates.map((r, i) => {
            const body = (
              <>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-1.5 text-[13px] font-medium">{r.name}{r.test && <Badge tone="attention">{t('postage.testBadge')}</Badge>}{i === 0 && answer.rates.length > 1 && <Badge tone="info">{t('postage.cheapest')}</Badge>}</span>
                  <span className="block text-xs text-muted">{r.accountName}{r.estimatedDays != null ? ` · ${t('postage.days', { n: new Intl.NumberFormat(lang).format(r.estimatedDays), $count: r.estimatedDays })}` : ''}</span>
                </span>
                <span className="shrink-0 text-[13px] font-medium tabular-nums">{fmt.money({ amount: r.price, currencyCode: r.currencyCode })}</span>
              </>
            );
            return onSelect ? (
              <li key={key(r)}><label className={cx('flex cursor-pointer items-center gap-3 px-3 py-2.5 hover:bg-hover', selected === key(r) && 'bg-primary-subtle')}>
                <input type="radio" name="label-rate" className="size-4 accent-[var(--color-accent)]" checked={selected === key(r)} onChange={() => onSelect(r)} />{body}
              </label></li>
            ) : <li key={key(r)} className="flex items-center gap-3 px-3 py-2.5">{body}</li>;
          })}
        </ul>
      )}
    </div>
  );
}

/** Weight field in the shop's unit; `grams` is what the API takes. */
export function useWeight(initialGrams: number | null) {
  const { shop } = useShop();
  const unit = shop.weightUnit in GRAMS_PER ? shop.weightUnit : 'KILOGRAMS';
  const [text, setText] = useState(initialGrams ? String(Math.round((initialGrams / GRAMS_PER[unit]!) * 1000) / 1000) : '');
  const n = parseDecimal(text);
  return { text, setText, unit, abbr: WEIGHT_ABBR[unit] ?? '', grams: n != null && n > 0 ? Math.round(n * GRAMS_PER[unit]!) : null };
}

export interface PackageOption { id: string; name: string; default: boolean; weight: { value: number; unit: string } | null }

/** "Calculate rates": label rates for a parcel to a country, from the carriers that sell labels. */
function CalculateRatesModal({ onClose }: { onClose: () => void }) {
  const { t, lang } = useI18n();
  const { shop } = useShop();
  const packages = useQuery({ queryKey: ['shipping-packages'], queryFn: () => gql<{ shopmeShippingPackages: PackageOption[] }>(SHIPPING_PACKAGES) });
  const [country, setCountry] = useState(shop.country || 'FR');
  const [zip, setZip] = useState('');
  const [pkg, setPkg] = useState('');
  const weight = useWeight(1000);
  const run = useMutation({
    mutationFn: async () => (await gql<{ shopmeShippingLabelEstimate: RatesAnswer }>(LABEL_ESTIMATE, { input: { countryCode: country, zip: zip || null, parcel: { packageId: pkg || null, weightGrams: weight.grams } } })).shopmeShippingLabelEstimate,
  });
  const pkgs = packages.data?.shopmeShippingPackages ?? [];
  const def = pkgs.find((p) => p.default);
  const noCarrier = run.data?.userErrors.some((e) => e.field?.includes('accountId'));
  return (
    <Modal open onClose={onClose} closeLabel={t('common.close')} title={t('postage.calcTitle')} wide
      footer={<><Button onClick={onClose}>{t('common.close')}</Button><Button variant="primary" loading={run.isPending} disabled={!weight.grams} onClick={() => run.mutate()}>{t('postage.getRates')}</Button></>}>
      <div className="flex flex-col gap-3">
        <p className="text-[13px] text-muted">{t('postage.calcIntro')}</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Select label={t('postage.destination')} value={country} onChange={(e) => setCountry(e.target.value)}>{countryOptions(lang).map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}</Select>
          <Input label={t('postage.zip')} value={zip} maxLength={20} onChange={(e) => setZip(e.target.value)} />
          <Select label={t('postage.package')} value={pkg} onChange={(e) => setPkg(e.target.value)}>
            <option value="">{def ? t('postage.defaultPackage', { name: def.name }) : t('postage.customPackage')}</option>
            {pkgs.filter((p) => !p.default).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
          <Input label={`${t('postage.weight')} (${weight.abbr})`} inputMode="decimal" value={weight.text} onChange={(e) => weight.setText(e.target.value)} />
        </div>
        {run.error && <Banner>{run.error.message}</Banner>}
        {run.data && run.data.userErrors.length > 0 && <Banner tone={noCarrier ? 'info' : 'critical'}>{noCarrier ? t('postage.labelsNone') : run.data.userErrors.map((e) => e.message).join(' · ')}</Banner>}
        {run.data && run.data.userErrors.length === 0 && <RatesList answer={run.data} />}
      </div>
    </Modal>
  );
}
