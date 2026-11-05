import { Badge, Banner, Button, Card, Checkbox, ConfirmDialog, Input, Modal, Select, Skeleton, Switch, useToast } from '@shopme/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDownAZ, ArrowUpAZ, Plus, Search, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router';
import { UserErrors, gql, mutate } from '../../api';
import { LinkRow, RowCard, Section, SettingsActions, SubHeader } from '../../components/SettingsKit';
import { SaveBar } from '../../components/SaveBar';
import { parseDecimal } from '../../format';
import { CUSTOMS_APPLY, SHOPME_CONFIG_UPDATE, SHOP_UPDATE, TAX_PRESET_APPLY, TAX_RATES, TAX_RATE_CREATE, TAX_RATE_DELETE, TAX_RATE_UPDATE, TAX_REGIONS } from '../../graphql';
import { useI18n } from '../../i18n';
import type { Key } from '../../i18n';
import { countryName, countryOptions } from '../../lib/countries';
import { errText, useConfig } from '../../lib/config';
import type { TaxesConfig } from '../../lib/config';
import { useShopSettings } from './Settings';
import type { ShopData } from './Settings';

interface TaxRate { id: string; name: string; countryCode: string; provinceCode: string | null; rate: number | string }
interface Preset { id: string; countries: string[]; rows: number }
const useRates = () => useQuery({ queryKey: ['tax-rates'], queryFn: () => gql<{ taxRates: TaxRate[] }>(TAX_RATES) });

/** Add or edit one rate; `lockCountry` fixes the country (region page). */
function RateModal({ editing, onClose, lockCountry }: { editing: { id: string | null; name: string; countryCode: string; province: string; rate: string } | null; onClose: () => void; lockCountry?: string }) {
  const { t, lang } = useI18n();
  const toast = useToast();
  const qc = useQueryClient();
  const [draft, setDraft] = useState(editing);
  const [seen, setSeen] = useState<typeof editing>(null);
  const [error, setError] = useState<string | null>(null);
  if (editing !== seen) { setSeen(editing); setDraft(editing); setError(null); }
  const rate = draft ? parseDecimal(draft.rate) : null;
  const valid = !!draft && draft.name.trim() !== '' && draft.countryCode !== '' && rate !== null && rate >= 0 && rate <= 100;
  const save = useMutation({
    mutationFn: () => {
      const e = draft!;
      const input = { name: e.name.trim(), countryCode: e.countryCode, provinceCode: e.province.trim().toUpperCase() || null, rate };
      return e.id ? mutate(TAX_RATE_UPDATE, { id: e.id, input }, 'taxRateUpdate') : mutate(TAX_RATE_CREATE, { input }, 'taxRateCreate');
    },
    onSuccess: () => { toast(t('settings.saved')); void qc.invalidateQueries({ queryKey: ['tax-rates'] }); void qc.invalidateQueries({ queryKey: ['tax-regions'] }); onClose(); },
    onError: (e) => setError(errText(e)),
  });
  return (
    <Modal open={!!editing} onClose={onClose} title={editing?.id ? t('taxes.edit') : t('taxes.add')} closeLabel={t('common.close')}
      footer={<><Button onClick={onClose}>{t('common.cancel')}</Button><Button variant="primary" disabled={!valid} loading={save.isPending} onClick={() => save.mutate()}>{t('save.save')}</Button></>}>
      {draft && (
        <div className="flex flex-col gap-3">
          {error && <Banner>{error}</Banner>}
          <Select label={t('taxes.country')} value={draft.countryCode} disabled={!!lockCountry} onChange={(e) => setDraft({ ...draft, countryCode: e.target.value })}>
            <option value="" />{countryOptions(lang).map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
          </Select>
          <Input label={t('taxes.province')} value={draft.province} onChange={(e) => setDraft({ ...draft, province: e.target.value })} />
          <Input label={t('taxes.name')} placeholder="VAT" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
          <Input label={`${t('taxes.rate')} (%)`} inputMode="decimal" value={draft.rate} error={draft.rate && !valid && (rate === null || rate < 0 || rate > 100) ? t('taxes.rateInvalid') : null} onChange={(e) => setDraft({ ...draft, rate: e.target.value })} />
        </div>
      )}
    </Modal>
  );
}

interface RateDraft { id: string | null; name: string; countryCode: string; province: string; rate: string }
const blankRate = (countryCode = ''): RateDraft => ({ id: null, name: '', countryCode, province: '', rate: '' });

export function TaxesSettings() {
  const { t, lang } = useI18n();
  const rates = useRates();
  const regions = useQuery({ queryKey: ['tax-regions'], queryFn: () => gql<{ shopmeTaxRegions: Array<{ countryCode: string; rates: number; provinces: number; combinedRate: number }>; shopmeTaxPresets: Preset[] }>(TAX_REGIONS) });
  const [editing, setEditing] = useState<RateDraft | null>(null);
  const [presets, setPresets] = useState(false);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<'name' | 'rate'>('name');
  const [desc, setDesc] = useState(false);

  const rows = useMemo(() => {
    const list = (regions.data?.shopmeTaxRegions ?? []).map((r) => ({
      ...r, name: countryName(r.countryCode, lang),
      summary: (rates.data?.taxRates ?? []).filter((x) => x.countryCode === r.countryCode && !x.provinceCode).map((x) => `${x.name} ${Number(x.rate)} %`).join(', '),
    }));
    const needle = search.trim().toLowerCase();
    const shown = needle ? list.filter((r) => r.name.toLowerCase().includes(needle) || r.countryCode.toLowerCase() === needle || r.summary.toLowerCase().includes(needle)) : list;
    return [...shown].sort((a, b) => (sort === 'rate' ? a.combinedRate - b.combinedRate : a.name.localeCompare(b.name, lang)) * (desc ? -1 : 1));
  }, [regions.data, rates.data, search, sort, desc, lang]);

  return (
    <div className="flex flex-col gap-4">
      <TaxOptions />
      <SettingsActions>
        <Link to="/analytics/reports/TAXES" className="btn btn-secondary">{t('taxes.reports')}</Link>
        <Button variant="primary" onClick={() => setEditing(blankRate())}><Plus className="size-4" />{t('taxes.add')}</Button>
      </SettingsActions>

      <Section title={t('bs.taxService')} description={t('bs.taxServiceDesc')} action={<Button onClick={() => setPresets(true)}>{t('bs.manage')}</Button>} />

      <Section title={t('taxes.rates')} description={t('taxes.ratesDesc')}>
        <Card>
          {(rates.isError || regions.isError) && <Banner>{((rates.error ?? regions.error) as Error).message}</Banner>}
          {regions.data && regions.data.shopmeTaxRegions.length === 0 && <p className="text-[13px] text-muted">{t('taxes.empty')}</p>}
          {(regions.data?.shopmeTaxRegions.length ?? 0) > 0 && (
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <label className="relative min-w-48 flex-1">
                  <Search aria-hidden className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted" />
                  <input type="search" aria-label={t('bs.searchRegions')} placeholder={t('bs.searchRegions')} value={search} onChange={(e) => setSearch(e.target.value)} className="field-control h-9 w-full pl-8" />
                </label>
                <select aria-label={t('bs.sortBy')} className="field-control h-9" value={sort} onChange={(e) => setSort(e.target.value as 'name' | 'rate')}>
                  <option value="name">{t('bs.sortName')}</option><option value="rate">{t('bs.sortRate')}</option>
                </select>
                <Button size="sm" aria-label={t(desc ? 'bs.sortDesc' : 'bs.sortAsc')} onClick={() => setDesc(!desc)}>{desc ? <ArrowUpAZ className="size-4" /> : <ArrowDownAZ className="size-4" />}</Button>
              </div>
              <RowCard className="shadow-none ring-1 ring-line">
                {rows.map((r) => (
                  <LinkRow key={r.countryCode} to={`/settings/taxes/${r.countryCode}`} title={r.name} description={r.summary || t('bs.provincesOnly')}
                    trailing={<>{r.provinces > 0 && <Badge>{t('bs.provincesCount', { n: r.provinces })}</Badge>}<span>{r.combinedRate ? `${Number(r.combinedRate.toFixed(3))} %` : '—'}</span></>} />
                ))}
                {rows.length === 0 && <p className="px-4 py-6 text-center text-[13px] text-muted">{t('bs.noRegionMatch')}</p>}
              </RowCard>
            </div>
          )}
        </Card>
      </Section>

      <DutiesAndCustoms />
      <RateModal editing={editing} onClose={() => setEditing(null)} />
      <PresetModal open={presets} presets={regions.data?.shopmeTaxPresets ?? []} onClose={() => setPresets(false)} />
    </div>
  );
}

/** Tax-inclusive pricing, tax on shipping, and VAT on digital goods. */
function TaxOptions() {
  const { t } = useI18n();
  const toast = useToast();
  const qc = useQueryClient();
  const shop = useShopSettings();
  const cfg = useConfig<TaxesConfig>('TAXES');
  if (shop.isLoading || cfg.isLoading) return <Skeleton className="h-32" />;
  if (shop.error || cfg.error) return <Banner>{(shop.error ?? cfg.error)!.message}</Banner>;
  return <TaxOptionsForm key={`${shop.dataUpdatedAt}-${cfg.dataUpdatedAt}`} shop={shop.data!.shop} cfg={cfg.data!} t={t} toast={toast} qc={qc} />;
}

function TaxOptionsForm({ shop, cfg, t, toast, qc }: { shop: ShopData; cfg: TaxesConfig; t: ReturnType<typeof useI18n>['t']; toast: ReturnType<typeof useToast>; qc: ReturnType<typeof useQueryClient> }) {
  const init = { taxesIncluded: shop.taxesIncluded, taxShipping: shop.taxShipping, digitalVat: cfg.digitalVat };
  const [f, setF] = useState(init);
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: async () => {
      if (f.taxesIncluded !== init.taxesIncluded || f.taxShipping !== init.taxShipping) await mutate(SHOP_UPDATE, { input: { taxesIncluded: f.taxesIncluded, taxShipping: f.taxShipping } }, 'shopmeShopUpdate');
      if (f.digitalVat !== init.digitalVat) await mutate(SHOPME_CONFIG_UPDATE, { key: 'TAXES', value: { ...cfg, digitalVat: f.digitalVat } }, 'shopmeConfigUpdate');
    },
    onSuccess: () => { toast(t('settings.saved')); setError(null); void qc.invalidateQueries({ queryKey: ['shop-settings'] }); void qc.invalidateQueries({ queryKey: ['config', 'TAXES'] }); },
    onError: (e) => setError(errText(e)),
  });
  return (
    <>
      <SaveBar dirty={JSON.stringify(f) !== JSON.stringify(init)} saving={save.isPending} onSave={() => save.mutate()} onDiscard={() => { setF(init); setError(null); }} />
      {error && <div className="mb-4"><Banner>{error}</Banner></div>}
      <Section title={t('settings.taxOptions')}><Card>
        <div className="flex flex-col gap-3">
          <Switch placement="end" label={t('settings.taxesIncluded')} checked={f.taxesIncluded} onChange={(v) => setF({ ...f, taxesIncluded: v })} />
          <Switch placement="end" label={t('settings.taxShipping')} checked={f.taxShipping} onChange={(v) => setF({ ...f, taxShipping: v })} />
          <div>
            <Switch placement="end" label={t('bs.digitalVat')} checked={f.digitalVat} onChange={(v) => setF({ ...f, digitalVat: v })} />
            <p className="mt-1 text-[13px] text-muted">{t('bs.digitalVatHelp')}</p>
          </div>
        </div>
      </Card></Section>
    </>
  );
}

function PresetModal({ open, presets, onClose }: { open: boolean; presets: Preset[]; onClose: () => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const qc = useQueryClient();
  const [replace, setReplace] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const apply = useMutation({
    mutationFn: (id: string) => mutate<{ value: { added: number; skipped: number } }>(TAX_PRESET_APPLY, { id, replace }, 'shopmeTaxPresetApply'),
    onSuccess: (r) => { toast(t('bs.presetApplied', { added: r.value.added, skipped: r.value.skipped })); setError(null); void qc.invalidateQueries({ queryKey: ['tax-rates'] }); void qc.invalidateQueries({ queryKey: ['tax-regions'] }); },
    onError: (e) => setError(errText(e)),
  });
  return (
    <Modal open={open} onClose={onClose} closeLabel={t('common.close')} title={t('bs.taxPresets')} footer={<Button onClick={onClose}>{t('common.close')}</Button>}>
      <div className="flex flex-col gap-3">
        {error && <Banner>{error}</Banner>}
        <p className="text-[13px] text-muted">{t('bs.taxPresetsHelp')}</p>
        <ul className="divide-y divide-line">
          {presets.map((p) => (
            <li key={p.id} className="flex items-center gap-3 py-2.5">
              <span className="min-w-0 flex-1"><span className="block text-[13px] font-medium">{t(`bs.preset.${p.id}` as Key)}</span><span className="block text-xs text-muted">{t('bs.presetRows', { n: p.rows })}</span></span>
              <Button size="sm" loading={apply.isPending && apply.variables === p.id} onClick={() => apply.mutate(p.id)}>{t('bs.addRates')}</Button>
            </li>
          ))}
        </ul>
        <Checkbox label={t('bs.presetReplace')} checked={replace} onChange={(e) => setReplace(e.target.checked)} />
      </div>
    </Modal>
  );
}

/** Import duties collected at checkout, and the customs defaults (origin country, HS code) applied to products. */
function DutiesAndCustoms() {
  const { t, lang } = useI18n();
  const toast = useToast();
  const qc = useQueryClient();
  const cfg = useConfig<TaxesConfig>('TAXES');
  const [dutyOpen, setDutyOpen] = useState(false);
  const save = useMutation({
    mutationFn: (value: TaxesConfig) => mutate(SHOPME_CONFIG_UPDATE, { key: 'TAXES', value }, 'shopmeConfigUpdate'),
    onSuccess: () => { toast(t('settings.saved')); void qc.invalidateQueries({ queryKey: ['config', 'TAXES'] }); setDutyOpen(false); }, onError: (e) => toast(errText(e), 'critical'),
  });
  const apply = useMutation({
    mutationFn: () => mutate<{ value: { updated: number } }>(CUSTOMS_APPLY, {}, 'shopmeCustomsApply'),
    onSuccess: (r) => toast(t('bs.customsApplied', { n: r.value.updated })), onError: (e) => toast(errText(e), 'critical'),
  });
  if (!cfg.data) return <Skeleton className="h-24" />;
  const c = cfg.data;
  return (
    <>
      <Section title={t('bs.duties')} description={t('bs.dutiesDesc')} action={<Button onClick={() => setDutyOpen(true)}>{t('bs.configure')}</Button>}>
        <Card><p className="text-[13px] text-muted">{c.duties.enabled ? t('bs.dutiesOn', { n: c.duties.rules.length }) : t('bs.dutiesOff')}</p></Card>
      </Section>
      <CustomsCard cfg={c} lang={lang} saving={save.isPending} onSave={(customs) => save.mutate({ ...c, customs })} applying={apply.isPending} onApply={() => apply.mutate()} />
      <DutyModal open={dutyOpen} cfg={c} saving={save.isPending} onClose={() => setDutyOpen(false)} onSave={(duties) => save.mutate({ ...c, duties })} />
    </>
  );
}

function CustomsCard({ cfg, lang, saving, onSave, applying, onApply }: { cfg: TaxesConfig; lang: string; saving: boolean; onSave: (c: TaxesConfig['customs']) => void; applying: boolean; onApply: () => void }) {
  const { t } = useI18n();
  const [f, setF] = useState(cfg.customs);
  const dirty = f.originCountry !== cfg.customs.originCountry || f.hsCode !== cfg.customs.hsCode;
  return (
    <Section title={t('bs.customs')} description={t('bs.customsDesc')}>
      <Card>
        <div className="flex flex-col gap-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Select label={t('bs.originCountry')} value={f.originCountry} onChange={(e) => setF({ ...f, originCountry: e.target.value })}>
              <option value="" />{countryOptions(lang).map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
            </Select>
            <Input label={t('bs.hsCode')} help={t('bs.hsCodeHelp')} value={f.hsCode} maxLength={20} onChange={(e) => setF({ ...f, hsCode: e.target.value })} />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" disabled={!dirty} loading={saving} onClick={() => onSave(f)}>{t('bs.saveCustoms')}</Button>
            <Button disabled={dirty || (!cfg.customs.originCountry && !cfg.customs.hsCode)} loading={applying} onClick={onApply}>{t('bs.applyCustoms')}</Button>
          </div>
        </div>
      </Card>
    </Section>
  );
}

function DutyModal({ open, cfg, saving, onClose, onSave }: { open: boolean; cfg: TaxesConfig; saving: boolean; onClose: () => void; onSave: (d: TaxesConfig['duties']) => void }) {
  const { t, lang } = useI18n();
  const [f, setF] = useState(cfg.duties);
  const [seen, setSeen] = useState(false);
  const [add, setAdd] = useState({ countryCode: '', rate: '' });
  if (open !== seen) { setSeen(open); if (open) { setF(cfg.duties); setAdd({ countryCode: '', rate: '' }); } }
  const rate = parseDecimal(add.rate);
  return (
    <Modal open={open} onClose={onClose} closeLabel={t('common.close')} title={t('bs.duties')} wide
      footer={<><Button onClick={onClose}>{t('common.cancel')}</Button><Button variant="primary" loading={saving} onClick={() => onSave(f)}>{t('save.save')}</Button></>}>
      <div className="flex flex-col gap-3">
        <p className="text-[13px] text-muted">{t('bs.dutiesHelp')}</p>
        <Switch placement="end" label={t('bs.dutiesEnable')} checked={f.enabled} onChange={(v) => setF({ ...f, enabled: v })} />
        <ul className="divide-y divide-line">
          {f.rules.map((r) => (
            <li key={r.countryCode} className="flex items-center gap-3 py-2 text-[13px]">
              <span className="flex-1 font-medium">{countryName(r.countryCode, lang)}</span><span>{r.rate} %</span>
              <Button size="sm" variant="plain" aria-label={`${t('common.delete')} ${r.countryCode}`} onClick={() => setF({ ...f, rules: f.rules.filter((x) => x.countryCode !== r.countryCode) })}><Trash2 className="size-4" /></Button>
            </li>
          ))}
        </ul>
        <div className="flex items-end gap-2">
          <Select className="flex-1" label={t('taxes.country')} value={add.countryCode} onChange={(e) => setAdd({ ...add, countryCode: e.target.value })}>
            <option value="" />{countryOptions(lang).filter((c) => !f.rules.some((r) => r.countryCode === c.code)).map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
          </Select>
          <Input className="w-28" label={`${t('taxes.rate')} (%)`} inputMode="decimal" value={add.rate} onChange={(e) => setAdd({ ...add, rate: e.target.value })} />
          <Button disabled={!add.countryCode || rate === null || rate < 0 || rate > 100} onClick={() => { setF({ ...f, rules: [...f.rules, { countryCode: add.countryCode, rate: rate!, label: 'Import duties' }] }); setAdd({ countryCode: '', rate: '' }); }}>{t('bs.addRow')}</Button>
        </div>
      </div>
    </Modal>
  );
}

/** One country: every rate (country-wide and per province) with edit and delete. */
export function TaxRegionPage() {
  const { country = '' } = useParams();
  const code = country.toUpperCase();
  const { t, lang } = useI18n();
  const toast = useToast();
  const qc = useQueryClient();
  const q = useRates();
  const [editing, setEditing] = useState<RateDraft | null>(null);
  const [del, setDel] = useState<TaxRate | null>(null);
  const remove = useMutation({
    mutationFn: (id: string) => mutate(TAX_RATE_DELETE, { id }, 'taxRateDelete'),
    onSuccess: () => { setDel(null); void qc.invalidateQueries({ queryKey: ['tax-rates'] }); void qc.invalidateQueries({ queryKey: ['tax-regions'] }); },
    onError: (e) => { setDel(null); toast(errText(e), 'critical'); },
  });
  const rates = (q.data?.taxRates ?? []).filter((r) => r.countryCode === code);
  const wide = rates.filter((r) => !r.provinceCode);
  const byProvince = [...new Set(rates.filter((r) => r.provinceCode).map((r) => r.provinceCode!))].sort();
  const total = (p: string | null) => rates.filter((r) => !r.provinceCode || r.provinceCode === p).reduce((a, r) => a + Number(r.rate), 0);
  const row = (r: TaxRate) => (
    <li key={r.id} className="flex items-center gap-3 px-4 py-2.5 text-[13px]">
      <span className="min-w-0 flex-1 truncate font-medium">{r.name}</span><span>{Number(r.rate)} %</span>
      <Button size="sm" onClick={() => setEditing({ id: r.id, name: r.name, countryCode: r.countryCode, province: r.provinceCode ?? '', rate: String(Number(r.rate)) })}>{t('common.edit')}</Button>
      <Button size="sm" variant="danger" aria-label={`${t('common.delete')} ${r.name}`} onClick={() => setDel(r)}><Trash2 className="size-4" /></Button>
    </li>
  );
  return (
    <div className="flex flex-col gap-4">
      <SubHeader back="/settings/taxes" parent={t('settings.taxes')} title={countryName(code, lang)} actions={<Button variant="primary" onClick={() => setEditing(blankRate(code))}><Plus className="size-4" />{t('taxes.add')}</Button>} />
      {q.isLoading && <Skeleton className="h-32" />}
      {q.data && rates.length === 0 && <Banner tone="info">{t('bs.regionEmpty')}</Banner>}
      {wide.length > 0 && <Section title={t('bs.countryWide')} description={t('bs.combined', { rate: Number(total(null).toFixed(3)) })}><RowCard>{wide.map(row)}</RowCard></Section>}
      {byProvince.map((p) => (
        <Section key={p} title={`${t('taxes.province')} ${p}`} description={t('bs.combined', { rate: Number(total(p).toFixed(3)) })}><RowCard>{rates.filter((r) => r.provinceCode === p).map(row)}</RowCard></Section>
      ))}
      <RateModal editing={editing} onClose={() => setEditing(null)} lockCountry={code} />
      <ConfirmDialog open={!!del} danger onClose={() => setDel(null)} title={t('bs.deleteItemTitle', { name: del?.name ?? '' })} message={t('bs.deleteItemBody')} confirmLabel={t('common.delete')} cancelLabel={t('common.cancel')} onConfirm={() => del && remove.mutate(del.id)} />
    </div>
  );
}
