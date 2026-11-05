import { Badge, Banner, Button, Card, Checkbox, ConfirmDialog, EmptyState, Input, Modal, Select, Skeleton, Switch, Textarea, useToast } from '@shopme/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { UserErrors, gql, mutate } from '../../api';
import { SaveBar } from '../../components/SaveBar';
import { Link } from 'react-router';
import { Section, SettingsActions } from '../../components/SettingsKit';
import { useFormat } from '../../components/shared';
import { parseDecimal } from '../../format';
import {
  PAYMENT_SETTINGS, PAYMENT_SETTINGS_UPDATE,
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
      <div className="flex flex-col gap-6">
        <Section title={t('payments.stripe')} description={t('payments.cardDesc')} action={<a href="https://docs.stripe.com/payments" target="_blank" rel="noreferrer" className="btn btn-secondary">{t('payments.learnMore')}</a>}>
          <Card>
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between gap-2"><Switch checked={f.stripe} onChange={(v) => setF({ ...f, stripe: v })} label={t('payments.stripeEnable')} /><Badge tone={data.stripe.stripeConfigured ? 'success' : 'warning'}>{data.stripe.stripeConfigured ? t('payments.configured') : t('payments.notConfigured')}</Badge></div>
              {!data.stripe.stripeConfigured && <p className="text-[13px] text-muted">{t('payments.stripeHint')}</p>}
            </div>
          </Card>
        </Section>
        <Section title={t('payments.manual')} description={t('payments.manualDesc')}>
          <Card>
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-3">
                <Switch checked={f.bank} onChange={(v) => setF({ ...f, bank: v })} label={t('payments.bankEnable')} />
                {f.bank && <Textarea label={t('payments.instructions')} help={t('payments.instructionsHelp')} rows={4} value={f.instructions} onChange={(e) => setF({ ...f, instructions: e.target.value })} />}
              </div>
              <div className="border-t border-line pt-4"><Switch checked={f.cod} onChange={(v) => setF({ ...f, cod: v })} label={t('payments.codEnable')} /></div>
            </div>
          </Card>
        </Section>
      </div>
    </>
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
      <SettingsActions>
        <Link to="/analytics/reports/TAXES" className="btn btn-secondary">{t('taxes.reports')}</Link>
        <Button variant="primary" onClick={() => { setError(null); setEditing({ id: null, name: '', countryCode: '', province: '', rate: '' }); }}><Plus className="size-4" />{t('taxes.add')}</Button>
      </SettingsActions>
      <Section title={t('taxes.rates')} description={t('taxes.ratesDesc')}>
      <Card>
        {q.isError && <Banner>{(q.error as Error).message}</Banner>}
        {q.data?.taxRates.length === 0 && <p className="text-[13px] text-muted">{t('taxes.empty')}</p>}
        {(q.data?.taxRates.length ?? 0) > 0 && (
          <table className="w-full text-left text-[13px]">
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
      </Section>
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
