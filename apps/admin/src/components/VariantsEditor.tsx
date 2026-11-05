import { Button, Input, Select, TagInput, cx } from '@shopme/ui';
import { Plus, Trash2 } from 'lucide-react';
import type { ButtonHTMLAttributes } from 'react';
import { useId, useState } from 'react';
import { formatMoney, parseDecimal } from '../format';
import { useI18n, useT } from '../i18n';
import { countryOptions } from '../lib/countries';
import { LENGTH_UNITS, MAX_OPTIONS, WEIGHT_UNITS, generateVariants } from '../lib/variants';
import type { OptionDef, VariantDraft } from '../lib/variants';

export interface LocationRef { id: string; name: string }
export interface MediaRef { id: string; url: string }
export const UNIT_MEASURES = ['ML', 'CL', 'L', 'M3', 'MG', 'G', 'KG', 'MM', 'CM', 'M', 'M2', 'ITEM'] as const;
type Patch = (p: Partial<VariantDraft>) => void;

/** Options (name + values) editor. Every change regenerates the variant combinations. */
export function OptionsEditor({ options, variants, lockedCount = 0, onChange }: { options: OptionDef[]; variants: VariantDraft[]; lockedCount?: number; onChange: (o: { options: OptionDef[]; variants: VariantDraft[] }) => void }) {
  const t = useT();
  const apply = (next: OptionDef[]) => onChange({ options: next, variants: generateVariants(next, variants) });
  const setOption = (i: number, p: Partial<OptionDef>) => apply(options.map((o, j) => (j === i ? { ...o, ...p } : o)));
  const remove = (i: number) => {
    const next = options.filter((_, j) => j !== i);
    onChange({ options: next, variants: generateVariants(next, variants.map((v) => ({ ...v, optionValues: v.optionValues.filter((_, j) => j !== i) }))) });
  };
  return (
    <div className="flex flex-col gap-4">
      {options.map((o, i) => (
        <div key={i} className="rounded-md border border-line bg-canvas p-3">
          <div className="flex items-end gap-2">
            <Input className="flex-1" label={t('variants.optionName')} placeholder={t('variants.optionNamePlaceholder')} value={o.name} disabled={i < lockedCount && !!o.id} onChange={(e) => setOption(i, { name: e.target.value })} />
            {i >= lockedCount && <Button variant="plain" aria-label={t('variants.removeOption')} onClick={() => remove(i)}><Trash2 className="size-4" /></Button>}
          </div>
          <div className="mt-2">
            <TagInput label={t('variants.optionValues')} placeholder={t('variants.valuesPlaceholder')} value={o.values} onChange={(values) => setOption(i, { values })} />
          </div>
        </div>
      ))}
      {options.length < MAX_OPTIONS && (
        <div><Button onClick={() => apply([...options, { name: '', values: [] }])}><Plus className="size-4" />{options.length ? t('variants.addAnotherOption') : t('variants.addOptions')}</Button></div>
      )}
    </div>
  );
}

/** Grey capsule button used for the optional parts of a section ("+ Compare-at price", "+ SKU"). */
function AddPill({ label, ...rest }: { label: string } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type="button" className="inline-flex h-7 items-center gap-1.5 rounded-lg bg-surface px-2.5 text-[13px] font-medium text-fg hover:bg-hover" {...rest}><Plus className="size-3.5 text-muted" />{label}</button>;
}

const track = (on: boolean) => (on ? 'bg-primary' : 'bg-[color-mix(in_srgb,var(--color-text-muted)_55%,var(--color-bg))]');

/** Capsule with a label and a small switch ("Charge tax", "Continue selling when out of stock"). */
function PillSwitch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)} className="inline-flex h-7 items-center gap-2 rounded-lg bg-surface px-2.5 text-[13px] font-medium hover:bg-hover">
      {label}
      <span className={cx('relative h-4 w-7 rounded-full transition-colors', track(checked))}>
        <span className={cx('absolute top-0.5 size-3 rounded-full bg-white shadow transition-all duration-150', checked ? 'left-3.5' : 'left-0.5')} />
      </span>
    </button>
  );
}

/** Section title with an optional switch on the right (inventory tracking, physical product). */
function SectionHead({ title, toggle }: { title: string; toggle?: { checked: boolean; onChange: (v: boolean) => void; label: string } }) {
  return (
    <div className="flex min-h-6 items-center justify-between gap-2">
      <h3 className="text-[13px] font-semibold">{title}</h3>
      {toggle && (
        <button type="button" role="switch" aria-checked={toggle.checked} aria-label={toggle.label} title={toggle.label} onClick={() => toggle.onChange(!toggle.checked)} className={cx('relative h-5 w-9 shrink-0 rounded-full transition-colors', track(toggle.checked))}>
          <span className={cx('absolute top-0.5 size-4 rounded-full bg-white shadow transition-all duration-150', toggle.checked ? 'left-4.5' : 'left-0.5')} />
        </button>
      )}
    </div>
  );
}

const currencySymbol = (currency: string) => { try { return new Intl.NumberFormat(undefined, { style: 'currency', currency }).formatToParts(0).find((p) => p.type === 'currency')?.value ?? currency; } catch { return currency; } };

/** Text input with the currency symbol on its right edge. */
function MoneyField({ label, value, onChange, currency, help, bold }: { label: string; value: string; onChange: (v: string) => void; currency: string; help?: string; bold?: boolean }) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className={cx('text-[13px]', bold ? 'font-semibold' : 'font-medium')}>{label}</label>
      <div className="relative max-w-xs">
        <input id={id} inputMode="decimal" className="field-control w-full pr-8" value={value} onChange={(e) => onChange(e.target.value)} />
        <span aria-hidden className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[13px] text-muted">{currencySymbol(currency)}</span>
      </div>
      {help && <p className="text-xs text-muted">{help}</p>}
    </div>
  );
}

/** Price, with compare-at price, cost and unit price revealed on demand, and the tax switch. */
export function PricingFields({ v, patch, currency }: { v: VariantDraft; patch: Patch; currency: string }) {
  const t = useT();
  const [more, setMore] = useState({ compare: false, cost: false, unit: false });
  const price = parseDecimal(v.price), cost = parseDecimal(v.cost);
  const profit = price !== null && cost !== null ? price - cost : null;
  const showCompare = more.compare || !!v.compareAtPrice, showCost = more.cost || !!v.cost, showUnit = more.unit || !!v.unitQuantity;
  return (
    <div className="flex flex-col gap-3">
      <MoneyField bold label={t('pricing.price')} value={v.price} onChange={(price) => patch({ price })} currency={currency} />
      {showCompare && <MoneyField label={t('pricing.compareAt')} value={v.compareAtPrice} onChange={(compareAtPrice) => patch({ compareAtPrice })} currency={currency} />}
      {showCost && <MoneyField label={t('pricing.cost')} value={v.cost} onChange={(cost) => patch({ cost })} currency={currency} help={t('pricing.costHelp')} />}
      {profit !== null && price ? <p className="text-xs text-muted">{t('pricing.margin', { profit: formatMoney(profit, currency), pct: Math.round((profit / price) * 100) })}</p> : null}
      {showUnit && <UnitPriceFields v={v} patch={patch} currency={currency} />}
      <div className="flex flex-wrap gap-2">
        {!showCompare && <AddPill label={t('pricing.compareAt')} onClick={() => setMore({ ...more, compare: true })} />}
        {!showCost && <AddPill label={t('pricing.cost')} onClick={() => setMore({ ...more, cost: true })} />}
        {!showUnit && <AddPill label={t('pricing.unitPrice')} onClick={() => setMore({ ...more, unit: true })} />}
        <PillSwitch checked={v.taxable} onChange={(taxable) => patch({ taxable })} label={t('pricing.chargeTax')} />
      </div>
    </div>
  );
}

/** "Unit price": 750 ml sold at 9.00 is shown as 1.20 per 100 ml on the storefront. */
export function UnitPriceFields({ v, patch, currency }: { v: VariantDraft; patch: Patch; currency: string }) {
  const t = useT();
  const price = parseDecimal(v.price), q = parseDecimal(v.unitQuantity), r = parseDecimal(v.unitReference);
  const unitPrice = price !== null && q && q > 0 && r && r > 0 ? (price / q) * r : null;
  const measures = (value: string, onChange: (x: string) => void, label: string) => (
    <Select label={label} value={value} onChange={(e) => onChange(e.target.value)}>{UNIT_MEASURES.map((u) => <option key={u} value={u}>{u}</option>)}</Select>
  );
  return (
    <fieldset className="rounded-md border border-line p-3">
      <legend className="px-1 text-[13px] font-medium">{t('pricing.unitPrice')}</legend>
      <div className="grid gap-3 sm:grid-cols-4">
        <Input label={t('pricing.unitQuantity')} inputMode="decimal" value={v.unitQuantity} onChange={(e) => patch({ unitQuantity: e.target.value })} />
        {measures(v.unitQuantityUnit, (unitQuantityUnit) => patch({ unitQuantityUnit }), t('pricing.unitUnit'))}
        <Input label={t('pricing.unitReference')} inputMode="decimal" value={v.unitReference} onChange={(e) => patch({ unitReference: e.target.value })} />
        {measures(v.unitReferenceUnit, (unitReferenceUnit) => patch({ unitReferenceUnit }), t('pricing.unitUnit'))}
        <p className="text-xs text-muted sm:col-span-4">{unitPrice !== null ? t('pricing.unitPriceShown', { price: formatMoney(unitPrice, currency), ref: `${v.unitReference} ${v.unitReferenceUnit}` }) : t('pricing.unitPriceHelp')}</p>
      </div>
    </fieldset>
  );
}

/** Pick the variant's image among the product's media. */
export function VariantMediaPicker({ v, patch, media }: { v: VariantDraft; patch: Patch; media: MediaRef[] }) {
  const t = useT();
  if (!media.length) return <p className="text-xs text-muted">{t('variants.noMedia')}</p>;
  return (
    <fieldset className="flex flex-col gap-1.5">
      <legend className="text-[13px] font-medium">{t('variants.image')}</legend>
      <div className="flex flex-wrap gap-2">
        <button type="button" aria-pressed={!v.mediaId} onClick={() => patch({ mediaId: '' })} className={cx('grid size-14 place-items-center rounded-md border text-xs text-muted', !v.mediaId ? 'border-primary ring-2 ring-primary' : 'border-line')}>{t('variants.noImage')}</button>
        {media.map((m) => (
          <button key={m.id} type="button" aria-label={t('variants.useImage')} aria-pressed={v.mediaId === m.id} onClick={() => patch({ mediaId: m.id })} className={cx('size-14 overflow-hidden rounded-md border', v.mediaId === m.id ? 'border-primary ring-2 ring-primary' : 'border-line')}>
            <img src={m.url} alt="" className="size-full object-cover" />
          </button>
        ))}
      </div>
    </fieldset>
  );
}

/** Inventory tracking and quantities per location; SKU and barcode on demand; continue selling switch. */
export function InventoryFields({ v, patch, locations }: { v: VariantDraft; patch: Patch; locations: LocationRef[] }) {
  const t = useT();
  const [more, setMore] = useState({ sku: false, barcode: false });
  const showSku = more.sku || !!v.sku, showBarcode = more.barcode || !!v.barcode;
  return (
    <div className="flex flex-col gap-3">
      <SectionHead title={t('product.inventory')} toggle={{ checked: v.tracked, onChange: (tracked) => patch({ tracked }), label: t('inventory.track') }} />
      {v.tracked && (locations.length > 0 ? (
        <div className="overflow-hidden rounded-md border border-line text-[13px]">
          <div className="flex items-center justify-between bg-surface px-3 py-1.5 text-xs font-medium text-muted"><span>{t('pv.location')}</span><span>{t('pv.quantity')}</span></div>
          {locations.map((l) => (
            <div key={l.id} className="flex items-center justify-between gap-3 border-t border-line px-3 py-1.5">
              <span className="min-w-0 truncate">{l.name}</span>
              <input type="number" min={0} aria-label={`${t('inventory.available')} — ${l.name}`} className="field-control w-24 text-right" value={v.quantities[l.id] ?? '0'} onChange={(e) => patch({ quantities: { ...v.quantities, [l.id]: e.target.value } })} />
            </div>
          ))}
        </div>
      ) : <p className="text-[13px] text-muted">{t('pv.noLocations')}</p>)}
      {(showSku || showBarcode) && (
        <div className="grid gap-3 sm:grid-cols-2">
          {showSku && <Input label={t('inventory.sku')} value={v.sku} onChange={(e) => patch({ sku: e.target.value })} />}
          {showBarcode && <Input label={t('inventory.barcode')} value={v.barcode} onChange={(e) => patch({ barcode: e.target.value })} />}
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        {!showSku && <AddPill label={t('inventory.sku')} onClick={() => setMore({ ...more, sku: true })} />}
        {!showBarcode && <AddPill label={t('inventory.barcode')} onClick={() => setMore({ ...more, barcode: true })} />}
        <PillSwitch checked={v.continueSelling} onChange={(continueSelling) => patch({ continueSelling })} label={t('inventory.continueSelling')} />
      </div>
    </div>
  );
}

const JOINED = 'field-control flex items-center gap-1 focus-within:outline-2 focus-within:-outline-offset-1 focus-within:outline-accent';
const BARE = 'w-0 min-w-0 flex-1 bg-transparent outline-none';

export function ShippingFields({ v, patch }: { v: VariantDraft; patch: Patch }) {
  const { t, lang } = useI18n();
  const weightId = useId();
  const [more, setMore] = useState({ origin: false, hs: false });
  const showOrigin = more.origin || !!v.countryOfOrigin, showHs = more.hs || !!v.hsCode;
  return (
    <div className="flex flex-col gap-3">
      <SectionHead title={t('product.shipping')} toggle={{ checked: v.requiresShipping, onChange: (requiresShipping) => patch({ requiresShipping }), label: t('shipping.physical') }} />
      {v.requiresShipping && (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex min-w-0 flex-col gap-1.5">
              <label htmlFor={weightId} className="text-[13px] font-medium">{t('shipping.weight')}</label>
              <div className={JOINED}>
                <input id={weightId} inputMode="decimal" className={BARE} value={v.weight} onChange={(e) => patch({ weight: e.target.value })} />
                <select aria-label={t('pv.weightUnit')} className="shrink-0 bg-transparent text-muted outline-none" value={v.weightUnit} onChange={(e) => patch({ weightUnit: e.target.value as VariantDraft['weightUnit'] })}>
                  {WEIGHT_UNITS.map((u) => <option key={u} value={u}>{t(`unit.${u}` as 'unit.GRAMS')}</option>)}
                </select>
              </div>
            </div>
            <fieldset className="flex min-w-0 flex-col gap-1.5">
              <legend className="mb-1.5 text-[13px] font-medium">{t('shipping.dimensions')}</legend>
              <div className={JOINED}>
                {([['length', 'L'], ['width', 'W'], ['height', 'H']] as const).map(([k, letter], i) => (
                  <span key={k} className="flex min-w-0 flex-1 items-center gap-1">
                    {i > 0 && <span aria-hidden className="text-muted">×</span>}
                    <span aria-hidden className="text-muted">{letter}</span>
                    <input aria-label={t(`shipping.${k}` as 'shipping.length')} inputMode="decimal" className={BARE} value={v[k]} onChange={(e) => patch({ [k]: e.target.value })} />
                  </span>
                ))}
                <select aria-label={t('shipping.dimensionUnit')} className="shrink-0 bg-transparent text-muted outline-none" value={v.dimensionUnit} onChange={(e) => patch({ dimensionUnit: e.target.value as VariantDraft['dimensionUnit'] })}>
                  {LENGTH_UNITS.map((u) => <option key={u} value={u}>{t(`lengthUnit.${u}` as 'lengthUnit.CENTIMETERS')}</option>)}
                </select>
              </div>
            </fieldset>
          </div>
          {(showOrigin || showHs) && (
            <div className="grid gap-3 sm:grid-cols-2">
              {showOrigin && (
                <Select label={t('shipping.origin')} value={v.countryOfOrigin} onChange={(e) => patch({ countryOfOrigin: e.target.value })}>
                  <option value="">{t('shipping.noOrigin')}</option>
                  {countryOptions(lang).map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
                </Select>
              )}
              {showHs && <Input label={t('shipping.hsCode')} help={t('shipping.hsCodeHelp')} value={v.hsCode} maxLength={14} onChange={(e) => patch({ hsCode: e.target.value })} />}
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            {!showOrigin && <AddPill label={t('shipping.origin')} onClick={() => setMore({ ...more, origin: true })} />}
            {!showHs && <AddPill label={t('shipping.hsCode')} onClick={() => setMore({ ...more, hs: true })} />}
          </div>
        </>
      )}
    </div>
  );
}

/** The three sections of one variant (price, inventory, shipping), divided like one card. */
export function VariantSections({ v, patch, locations, currency, giftCard }: { v: VariantDraft; patch: Patch; locations: LocationRef[]; currency: string; giftCard?: boolean }) {
  return (
    <div className="flex flex-col divide-y divide-line [&>*]:py-4 [&>*:first-child]:pt-0 [&>*:last-child]:pb-0">
      <PricingFields v={v} patch={patch} currency={currency} />
      <InventoryFields v={v} patch={patch} locations={locations} />
      {!giftCard && <ShippingFields v={v} patch={patch} />}
    </div>
  );
}
