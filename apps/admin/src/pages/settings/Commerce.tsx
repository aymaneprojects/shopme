import { Badge, Banner, Button, Card, Checkbox, ConfirmDialog, EmptyState, Input, Modal, Select, Skeleton, Switch, Textarea, useToast } from '@shopme/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { UserErrors, gql, mutate } from '../../api';
import { SaveBar } from '../../components/SaveBar';
import { useFormat } from '../../components/shared';
import { parseDecimal } from '../../format';
import {
  PAYMENT_SETTINGS, PAYMENT_SETTINGS_UPDATE, SHIPPING_ZONES, SHIPPING_ZONE_CREATE, SHIPPING_ZONE_DELETE, SHIPPING_ZONE_UPDATE,
  TAX_RATES, TAX_RATE_CREATE, TAX_RATE_DELETE, TAX_RATE_UPDATE,
} from '../../graphql';
import { useI18n } from '../../i18n';
import { countryName, countryOptions } from '../../lib/countries';
import { useShop } from '../../session';
import { TaxToggles } from './Settings';

const errText = (e: Error) => (e instanceof UserErrors ? e.errors.map((x) => x.message).join(' · ') : e.message);

// ---------- Payments ----------
interface Payments { bankTransfer: { enabled: boolean; instructions: string }; cod: { enabled: boolean }; stripe: { enabled: boolean; stripeConfigured: boolean } }

export function PaymentsSettings() {
  const q = useQuery({ queryKey: ['payment-settings'], queryFn: () => gql<{ shopmePaymentSettings: Payments }>(PAYMENT_SETTINGS) });
  if (q.isLoading) return <Skeleton className="h-64" />;
  if (q.error) return <Banner>{q.error.message}</Banner>;
  return <PaymentsForm key={q.dataUpdatedAt} data={q.data!.shopmePaymentSettings} />;
}

function PaymentsForm({ data }: { data: Payments }) {
  const { t } = useI18n();
  const toast = useToast();
  const qc = useQueryClient();
  const init = { bank: data.bankTransfer.enabled, instructions: data.bankTransfer.instructions, cod: data.cod.enabled, stripe: data.stripe.enabled };
  const [f, setF] = useState(init);
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () => mutate(PAYMENT_SETTINGS_UPDATE, { input: { bankTransfer: { enabled: f.bank, instructions: f.instructions }, cod: { enabled: f.cod }, stripe: { enabled: f.stripe } } }, 'shopmePaymentSettingsUpdate'),
    onSuccess: () => { toast(t('settings.saved')); setError(null); void qc.invalidateQueries({ queryKey: ['payment-settings'] }); },
    onError: (e) => setError(errText(e)),
  });
  return (
    <>
      <SaveBar dirty={JSON.stringify(f) !== JSON.stringify(init)} saving={save.isPending} onSave={() => save.mutate()} onDiscard={() => setF(init)} />
      {error && <div className="mb-4"><Banner>{error}</Banner></div>}
      <div className="flex flex-col gap-4">
        <Card title={t('payments.stripe')} actions={<Badge tone={data.stripe.stripeConfigured ? 'success' : 'warning'}>{data.stripe.stripeConfigured ? t('payments.configured') : t('payments.notConfigured')}</Badge>}>
          <div className="flex flex-col gap-2">
            <Switch checked={f.stripe} onChange={(v) => setF({ ...f, stripe: v })} label={t('payments.stripeEnable')} />
            {!data.stripe.stripeConfigured && <p className="text-sm text-muted">{t('payments.stripeHint')}</p>}
          </div>
        </Card>
        <Card title={t('payments.bank')}>
          <div className="flex flex-col gap-3">
            <Switch checked={f.bank} onChange={(v) => setF({ ...f, bank: v })} label={t('payments.bankEnable')} />
            {f.bank && <Textarea label={t('payments.instructions')} help={t('payments.instructionsHelp')} rows={4} value={f.instructions} onChange={(e) => setF({ ...f, instructions: e.target.value })} />}
          </div>
        </Card>
        <Card title={t('payments.cod')}><Switch checked={f.cod} onChange={(v) => setF({ ...f, cod: v })} label={t('payments.codEnable')} /></Card>
      </div>
    </>
  );
}

// ---------- Shipping ----------
interface Rate { id?: string; name: string; price: string; condition: 'none' | 'subtotal' | 'weight'; min: string; max: string }
type Money = { amount: string } | null;
interface ApiRate { id: string; name: string; type: string; price: { amount: string }; minSubtotal: Money; maxSubtotal: Money; minWeight: number | null; maxWeight: number | null }
interface Zone { id: string; name: string; countries: Array<{ countryCode: string; provinceCodes: string[] }>; rates: ApiRate[] }

const toRate = (r: ApiRate): Rate => {
  const sub = r.type === 'PRICE_BASED', w = r.type === 'WEIGHT_BASED';
  return {
    id: r.id, name: r.name, price: r.price.amount, condition: sub ? 'subtotal' : w ? 'weight' : 'none',
    min: String((sub ? r.minSubtotal?.amount : r.minWeight) ?? ''), max: String((sub ? r.maxSubtotal?.amount : r.maxWeight) ?? ''),
  };
};
/** Maps a form rate to a ShopmeShippingRateInput. A rate without a condition is a flat rate. */
export const rateInput = (r: Rate) => {
  const min = parseDecimal(r.min), max = parseDecimal(r.max);
  const type = r.condition === 'subtotal' ? 'PRICE_BASED' : r.condition === 'weight' ? 'WEIGHT_BASED' : 'FLAT';
  return {
    name: r.name.trim(), type, price: (parseDecimal(r.price) ?? 0).toFixed(2),
    minSubtotal: r.condition === 'subtotal' && min !== null ? min.toFixed(2) : null, maxSubtotal: r.condition === 'subtotal' && max !== null ? max.toFixed(2) : null,
    minWeight: r.condition === 'weight' ? min : null, maxWeight: r.condition === 'weight' ? max : null,
  };
};

export function ShippingSettings() {
  const { t, lang } = useI18n();
  const fmt = useFormat();
  const { shop } = useShop();
  const toast = useToast();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['shipping-zones'], queryFn: () => gql<{ shippingZones: Zone[] }>(SHIPPING_ZONES) });
  const [editing, setEditing] = useState<{ id: string | null; name: string; codes: string[]; rates: Rate[] } | null>(null);
  const [confirm, setConfirm] = useState<Zone | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ['shipping-zones'] });
  const save = useMutation({
    mutationFn: () => {
      const e = editing!;
      const input = { name: e.name.trim(), countries: e.codes.map((countryCode) => ({ countryCode, provinceCodes: [] })), rates: e.rates.map(rateInput) };
      return e.id ? mutate(SHIPPING_ZONE_UPDATE, { id: e.id, input }, 'shippingZoneUpdate') : mutate(SHIPPING_ZONE_CREATE, { input }, 'shippingZoneCreate');
    },
    onSuccess: () => { toast(t('settings.saved')); setEditing(null); setError(null); void refresh(); },
    onError: (e) => setError(errText(e)),
  });
  const del = useMutation({ mutationFn: (id: string) => mutate(SHIPPING_ZONE_DELETE, { id }, 'shippingZoneDelete'), onSuccess: () => { void refresh(); }, onError: (e) => toast(e.message, 'critical') });
  const countries = countryOptions(lang);
  const e = editing;
  const setRate = (i: number, p: Partial<Rate>) => setEditing({ ...e!, rates: e!.rates.map((r, j) => (j === i ? { ...r, ...p } : r)) });
  const valid = !!e && e.name.trim() !== '' && e.codes.length > 0 && e.rates.every((r) => r.name.trim() && parseDecimal(r.price) !== null);
  const blankRate: Rate = { name: '', price: '', condition: 'none', min: '', max: '' };
  const add = <Button variant="primary" onClick={() => { setError(null); setEditing({ id: null, name: '', codes: [], rates: [{ ...blankRate }] }); }}><Plus className="size-4" />{t('shipping.addZone')}</Button>;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between"><h2 className="text-base font-semibold">{t('settings.shipping')}</h2>{add}</div>
      {q.isError && <Banner>{(q.error as Error).message}</Banner>}
      {q.isLoading && <Skeleton className="h-32" />}
      {q.data?.shippingZones.length === 0 && <Card><EmptyState title={t('shipping.emptyTitle')} description={t('shipping.emptyBody')} action={add} /></Card>}
      {q.data?.shippingZones.map((z) => (
        <Card key={z.id} title={z.name} actions={<span className="flex gap-2"><Button size="sm" onClick={() => { setError(null); setEditing({ id: z.id, name: z.name, codes: z.countries.map((c) => c.countryCode), rates: z.rates.map(toRate) }); }}>{t('common.edit')}</Button><Button size="sm" variant="danger" onClick={() => setConfirm(z)}>{t('common.delete')}</Button></span>}>
          <p className="mb-2 text-sm text-muted">{z.countries.map((c) => countryName(c.countryCode, lang)).join(', ')}</p>
          <ul className="divide-y divide-line text-sm">
            {z.rates.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-2 py-1.5">
                <span className="font-medium">{r.name}</span>
                <span className="text-muted">{[r.minSubtotal && `≥ ${fmt.money({ amount: r.minSubtotal.amount, currencyCode: shop.currency })}`, r.maxSubtotal && `≤ ${fmt.money({ amount: r.maxSubtotal.amount, currencyCode: shop.currency })}`, r.minWeight != null && `≥ ${r.minWeight}`, r.maxWeight != null && `≤ ${r.maxWeight}`].filter(Boolean).join(' · ')}</span>
                <span className="ml-auto">{Number(r.price.amount) === 0 ? t('shipping.free') : fmt.money({ amount: r.price.amount, currencyCode: shop.currency })}</span>
              </li>
            ))}
          </ul>
        </Card>
      ))}

      <Modal open={!!e} onClose={() => setEditing(null)} wide title={e?.id ? t('shipping.editZone') : t('shipping.addZone')} closeLabel={t('common.close')}
        footer={<><Button onClick={() => setEditing(null)}>{t('common.cancel')}</Button><Button variant="primary" disabled={!valid} loading={save.isPending} onClick={() => save.mutate()}>{t('save.save')}</Button></>}>
        {e && (
          <div className="flex flex-col gap-4">
            {error && <Banner>{error}</Banner>}
            <Input label={t('shipping.zoneName')} value={e.name} onChange={(ev) => setEditing({ ...e, name: ev.target.value })} />
            <fieldset>
              <legend className="mb-1 text-sm font-medium">{t('shipping.countries')}</legend>
              <div className="grid max-h-40 grid-cols-2 gap-1 overflow-y-auto rounded-md border border-line p-2 sm:grid-cols-3">
                {countries.map((c) => <Checkbox key={c.code} label={c.name} checked={e.codes.includes(c.code)} onChange={(ev) => setEditing({ ...e, codes: ev.target.checked ? [...e.codes, c.code] : e.codes.filter((x) => x !== c.code) })} />)}
              </div>
            </fieldset>
            <div className="flex flex-col gap-3">
              <h3 className="text-sm font-medium">{t('shipping.rates')}</h3>
              {e.rates.map((r, i) => (
                <div key={i} className="grid gap-2 rounded-md border border-line p-3 sm:grid-cols-4">
                  <Input label={t('shipping.rateName')} value={r.name} onChange={(ev) => setRate(i, { name: ev.target.value })} />
                  <Input label={`${t('shipping.price')} (${shop.currency})`} inputMode="decimal" value={r.price} onChange={(ev) => setRate(i, { price: ev.target.value })} />
                  <Select label={t('shipping.condition')} value={r.condition} onChange={(ev) => setRate(i, { condition: ev.target.value as Rate['condition'] })}>
                    <option value="none">{t('shipping.condNone')}</option><option value="subtotal">{t('shipping.condSubtotal')}</option><option value="weight">{t('shipping.condWeight')}</option>
                  </Select>
                  {r.condition !== 'none' && <>
                    <Input label={t('shipping.min')} inputMode="decimal" value={r.min} onChange={(ev) => setRate(i, { min: ev.target.value })} />
                    <Input label={t('shipping.max')} inputMode="decimal" value={r.max} onChange={(ev) => setRate(i, { max: ev.target.value })} />
                  </>}
                  <div className="flex items-end sm:col-start-4"><Button size="sm" onClick={() => setEditing({ ...e, rates: e.rates.filter((_, j) => j !== i) })}><Trash2 className="size-4" />{t('common.remove')}</Button></div>
                </div>
              ))}
              <div><Button size="sm" onClick={() => setEditing({ ...e, rates: [...e.rates, { ...blankRate }] })}><Plus className="size-4" />{t('shipping.addRate')}</Button></div>
            </div>
          </div>
        )}
      </Modal>
      <ConfirmDialog open={!!confirm} onClose={() => setConfirm(null)} danger title={t('shipping.deleteTitle')} message={t('shipping.deleteBody')} confirmLabel={t('common.delete')} cancelLabel={t('common.cancel')} onConfirm={() => { if (confirm) del.mutate(confirm.id); setConfirm(null); }} />
    </div>
  );
}

// ---------- Taxes ----------
interface TaxRate { id: string; name: string; countryCode: string; provinceCode: string | null; rate: number | string }

export function TaxesSettings() {
  const { t, lang } = useI18n();
  const toast = useToast();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['tax-rates'], queryFn: () => gql<{ taxRates: TaxRate[] }>(TAX_RATES) });
  const [editing, setEditing] = useState<{ id: string | null; name: string; countryCode: string; province: string; rate: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ['tax-rates'] });
  const rate = editing ? parseDecimal(editing.rate) : null;
  const valid = !!editing && editing.name.trim() !== '' && editing.countryCode !== '' && rate !== null && rate >= 0 && rate <= 100;
  const save = useMutation({
    mutationFn: () => {
      const e = editing!;
      const input = { name: e.name.trim(), countryCode: e.countryCode, provinceCode: e.province.trim() || null, rate };
      return e.id ? mutate(TAX_RATE_UPDATE, { id: e.id, input }, 'taxRateUpdate') : mutate(TAX_RATE_CREATE, { input }, 'taxRateCreate');
    },
    onSuccess: () => { toast(t('settings.saved')); setEditing(null); setError(null); void refresh(); },
    onError: (e) => setError(errText(e)),
  });
  const del = useMutation({ mutationFn: (id: string) => mutate(TAX_RATE_DELETE, { id }, 'taxRateDelete'), onSuccess: () => { void refresh(); }, onError: (e) => toast(e.message, 'critical') });

  return (
    <div className="flex flex-col gap-4">
      <TaxToggles />
      <Card title={t('taxes.rates')} actions={<Button size="sm" variant="primary" onClick={() => { setError(null); setEditing({ id: null, name: '', countryCode: '', province: '', rate: '' }); }}><Plus className="size-4" />{t('taxes.add')}</Button>}>
        {q.isError && <Banner>{(q.error as Error).message}</Banner>}
        {q.data?.taxRates.length === 0 && <p className="text-sm text-muted">{t('taxes.empty')}</p>}
        {(q.data?.taxRates.length ?? 0) > 0 && (
          <table className="w-full text-left text-sm">
            <thead className="text-xs text-muted"><tr><th className="py-1">{t('taxes.country')}</th><th>{t('taxes.province')}</th><th>{t('taxes.name')}</th><th>{t('taxes.rate')}</th><th /></tr></thead>
            <tbody>
              {q.data!.taxRates.map((r) => (
                <tr key={r.id} className="border-t border-line">
                  <td className="py-1.5">{countryName(r.countryCode, lang)}</td><td>{r.provinceCode ?? '—'}</td><td>{r.name}</td><td>{Number(r.rate)} %</td>
                  <td className="text-right"><Button size="sm" onClick={() => { setError(null); setEditing({ id: r.id, name: r.name, countryCode: r.countryCode, province: r.provinceCode ?? '', rate: String(Number(r.rate)) }); }}>{t('common.edit')}</Button>{' '}
                    <Button size="sm" variant="danger" aria-label={`${t('common.delete')} ${r.name}`} onClick={() => del.mutate(r.id)}><Trash2 className="size-4" /></Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      <Modal open={!!editing} onClose={() => setEditing(null)} title={editing?.id ? t('taxes.edit') : t('taxes.add')} closeLabel={t('common.close')}
        footer={<><Button onClick={() => setEditing(null)}>{t('common.cancel')}</Button><Button variant="primary" disabled={!valid} loading={save.isPending} onClick={() => save.mutate()}>{t('save.save')}</Button></>}>
        {editing && (
          <div className="flex flex-col gap-3">
            {error && <Banner>{error}</Banner>}
            <Select label={t('taxes.country')} value={editing.countryCode} onChange={(e) => setEditing({ ...editing, countryCode: e.target.value })}>
              <option value="" />{countryOptions(lang).map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
            </Select>
            <Input label={t('taxes.province')} value={editing.province} onChange={(e) => setEditing({ ...editing, province: e.target.value })} />
            <Input label={t('taxes.name')} placeholder="VAT" value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
            <Input label={`${t('taxes.rate')} (%)`} inputMode="decimal" value={editing.rate} error={editing.rate && !valid && (rate === null || rate < 0 || rate > 100) ? t('taxes.rateInvalid') : null} onChange={(e) => setEditing({ ...editing, rate: e.target.value })} />
          </div>
        )}
      </Modal>
    </div>
  );
}
