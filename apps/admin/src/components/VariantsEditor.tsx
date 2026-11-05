import { Button, Checkbox, Dropdown, Input, Select, Switch, TagInput, cx } from '@shopme/ui';
import type { MenuItem } from '@shopme/ui';
import { ChevronDown, ChevronRight, MoreHorizontal, Plus, Trash2 } from 'lucide-react';
import { Fragment, useState } from 'react';
import { formatMoney, parseDecimal } from '../format';
import { useI18n, useT } from '../i18n';
import { countryOptions } from '../lib/countries';
import { LENGTH_UNITS, MAX_OPTIONS, WEIGHT_UNITS, generateVariants, variantLabel } from '../lib/variants';
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
        <div key={i} className="rounded-md border border-line p-3">
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

export function PricingFields({ v, patch, currency }: { v: VariantDraft; patch: Patch; currency: string }) {
  const t = useT();
  const price = parseDecimal(v.price), cost = parseDecimal(v.cost);
  const profit = price !== null && cost !== null ? price - cost : null;
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <Input label={t('pricing.price')} inputMode="decimal" value={v.price} onChange={(e) => patch({ price: e.target.value })} />
      <Input label={t('pricing.compareAt')} inputMode="decimal" value={v.compareAtPrice} onChange={(e) => patch({ compareAtPrice: e.target.value })} />
      <Input label={t('pricing.cost')} inputMode="decimal" help={t('pricing.costHelp')} value={v.cost} onChange={(e) => patch({ cost: e.target.value })} />
      <div className="sm:col-span-3"><Switch checked={v.taxable} onChange={(taxable) => patch({ taxable })} label={t('pricing.chargeTax')} /></div>
      {profit !== null && price ? <p className="text-xs text-muted sm:col-span-3">{t('pricing.margin', { profit: formatMoney(profit, currency), pct: Math.round((profit / price) * 100) })}</p> : null}
      <UnitPriceFields v={v} patch={patch} currency={currency} />
    </div>
  );
}

/** "Unit price": 750 ml sold at 9.00 is shown as 1.20 per 100 ml on the storefront. */
export function UnitPriceFields({ v, patch, currency }: { v: VariantDraft; patch: Patch; currency: string }) {
  const t = useT();
  const price = parseDecimal(v.price), q = parseDecimal(v.unitQuantity), r = parseDecimal(v.unitReference);
  const unitPrice = price !== null && q && q > 0 && r && r > 0 ? (price / q) * r : null;
  const measures = (id: string, value: string, onChange: (x: string) => void, label: string) => (
    <Select label={label} value={value} onChange={(e) => onChange(e.target.value)}>{UNIT_MEASURES.map((u) => <option key={u} value={u}>{u}</option>)}</Select>
  );
  return (
    <details className="rounded-md border border-line p-3 sm:col-span-3" open={!!v.unitQuantity}>
      <summary className="cursor-pointer text-[13px] font-medium">{t('pricing.unitPrice')}</summary>
      <div className="mt-3 grid gap-3 sm:grid-cols-4">
        <Input label={t('pricing.unitQuantity')} inputMode="decimal" value={v.unitQuantity} onChange={(e) => patch({ unitQuantity: e.target.value })} />
        {measures('uq', v.unitQuantityUnit, (unitQuantityUnit) => patch({ unitQuantityUnit }), t('pricing.unitUnit'))}
        <Input label={t('pricing.unitReference')} inputMode="decimal" value={v.unitReference} onChange={(e) => patch({ unitReference: e.target.value })} />
        {measures('ur', v.unitReferenceUnit, (unitReferenceUnit) => patch({ unitReferenceUnit }), t('pricing.unitUnit'))}
        <p className="text-xs text-muted sm:col-span-4">{unitPrice !== null ? t('pricing.unitPriceShown', { price: formatMoney(unitPrice, currency), ref: `${v.unitReference} ${v.unitReferenceUnit}` }) : t('pricing.unitPriceHelp')}</p>
      </div>
    </details>
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

export function InventoryFields({ v, patch, locations, compact }: { v: VariantDraft; patch: Patch; locations: LocationRef[]; compact?: boolean }) {
  const t = useT();
  return (
    <div className="flex flex-col gap-3">
      <Switch checked={v.tracked} onChange={(tracked) => patch({ tracked })} label={t('inventory.track')} />
      {v.tracked && locations.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2">
          {locations.map((l) => (
            <Input key={l.id} label={`${t('inventory.available')} — ${l.name}`} type="number" min={0} value={v.quantities[l.id] ?? '0'} onChange={(e) => patch({ quantities: { ...v.quantities, [l.id]: e.target.value } })} />
          ))}
        </div>
      )}
      <div className={compact ? 'grid gap-3 sm:grid-cols-2' : 'grid gap-3 sm:grid-cols-3'}>
        <Input label={t('inventory.sku')} value={v.sku} onChange={(e) => patch({ sku: e.target.value })} />
        <Input label={t('inventory.barcode')} value={v.barcode} onChange={(e) => patch({ barcode: e.target.value })} />
      </div>
      <Checkbox checked={v.continueSelling} onChange={(e) => patch({ continueSelling: e.target.checked })} label={t('inventory.continueSelling')} />
    </div>
  );
}

export function ShippingFields({ v, patch }: { v: VariantDraft; patch: Patch }) {
  const { t, lang } = useI18n();
  return (
    <div className="flex flex-col gap-3">
      <Switch checked={v.requiresShipping} onChange={(requiresShipping) => patch({ requiresShipping })} label={t('shipping.physical')} />
      {v.requiresShipping && (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid grid-cols-2 gap-3">
              <Input label={t('shipping.weight')} inputMode="decimal" value={v.weight} onChange={(e) => patch({ weight: e.target.value })} />
              <Select label={t('shipping.unit')} value={v.weightUnit} onChange={(e) => patch({ weightUnit: e.target.value as VariantDraft['weightUnit'] })}>
                {WEIGHT_UNITS.map((u) => <option key={u} value={u}>{t(`unit.${u}` as 'unit.GRAMS')}</option>)}
              </Select>
            </div>
            <fieldset className="grid grid-cols-[1fr_1fr_1fr_auto] items-end gap-2">
              <legend className="mb-1 text-[13px] font-medium">{t('shipping.dimensions')}</legend>
              <Input aria-label={t('shipping.length')} placeholder={t('shipping.length')} inputMode="decimal" value={v.length} onChange={(e) => patch({ length: e.target.value })} />
              <Input aria-label={t('shipping.width')} placeholder={t('shipping.width')} inputMode="decimal" value={v.width} onChange={(e) => patch({ width: e.target.value })} />
              <Input aria-label={t('shipping.height')} placeholder={t('shipping.height')} inputMode="decimal" value={v.height} onChange={(e) => patch({ height: e.target.value })} />
              <Select aria-label={t('shipping.dimensionUnit')} value={v.dimensionUnit} onChange={(e) => patch({ dimensionUnit: e.target.value as VariantDraft['dimensionUnit'] })}>
                {LENGTH_UNITS.map((u) => <option key={u} value={u}>{t(`lengthUnit.${u}` as 'lengthUnit.CENTIMETERS')}</option>)}
              </Select>
            </fieldset>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Select label={t('shipping.origin')} value={v.countryOfOrigin} onChange={(e) => patch({ countryOfOrigin: e.target.value })}>
              <option value="">{t('shipping.noOrigin')}</option>
              {countryOptions(lang).map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
            </Select>
            <Input label={t('shipping.hsCode')} help={t('shipping.hsCodeHelp')} value={v.hsCode} maxLength={14} onChange={(e) => patch({ hsCode: e.target.value })} />
          </div>
        </>
      )}
    </div>
  );
}

/** One row per variant: quick edit of price, expandable for the rest. Optional selection checkboxes, filtering and a per-row menu. */
export function VariantsTable({ variants, locations, currency, media = [], onMetafields, onChange, selection, visible, menu }: {
  variants: VariantDraft[]; locations: LocationRef[]; currency: string; media?: MediaRef[]; onMetafields?: (variantId: string) => void; onChange: (v: VariantDraft[]) => void;
  selection?: { selected: string[]; onChange: (keys: string[]) => void };
  visible?: (v: VariantDraft) => boolean;
  menu?: (v: VariantDraft, actions: { edit: () => void }) => MenuItem[];
}) {
  const t = useT();
  const [open, setOpen] = useState<string | null>(null);
  const patchAt = (key: string): Patch => (p) => onChange(variants.map((v) => (v.key === key ? { ...v, ...p } : v)));
  const shown = variants.filter((v) => !visible || visible(v));
  const allOn = shown.length > 0 && shown.every((v) => selection?.selected.includes(v.key));
  const cols = 4 + (selection ? 1 : 0) + (menu ? 1 : 0);
  return (
    <div className={cx('rounded-md border border-line', menu ? 'sm:overflow-visible overflow-x-auto' : 'overflow-x-auto')}>
      <table className="w-full text-[13px]">
        <thead className="bg-surface text-left text-xs text-muted">
          <tr>
            {selection && <th className="w-8 pl-3"><Checkbox aria-label={t('common.selectAll')} checked={allOn} onChange={() => selection.onChange(allOn ? selection.selected.filter((k) => !shown.some((v) => v.key === k)) : [...new Set([...selection.selected, ...shown.map((v) => v.key)])])} /></th>}
            <th className="w-8" /><th className="px-3 py-2 font-medium">{t('variants.variant')}</th><th className="px-3 py-2 font-medium">{t('pricing.price')} ({currency})</th><th className="px-3 py-2 font-medium">{t('inventory.available')}</th>
            {menu && <th className="w-10" />}
          </tr>
        </thead>
        <tbody>
          {shown.length === 0 && <tr className="border-t border-line"><td colSpan={cols} className="px-3 py-6 text-center text-muted">{t('variants.noMatch')}</td></tr>}
          {shown.map((v) => {
            const isOpen = open === v.key;
            const total = locations.reduce((n, l) => n + (Number(v.quantities[l.id]) || 0), 0);
            const label = variantLabel(v, t('variants.default'));
            return (
              <Fragment key={v.key}>
                <tr className="border-t border-line" data-selected={selection?.selected.includes(v.key) ? 'true' : undefined}>
                  {selection && <td className="pl-3"><Checkbox aria-label={`${t('variants.select')} ${label}`} checked={selection.selected.includes(v.key)} onChange={() => selection.onChange(selection.selected.includes(v.key) ? selection.selected.filter((k) => k !== v.key) : [...selection.selected, v.key])} /></td>}
                  <td className="pl-2"><button type="button" aria-label={t('variants.details')} aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : v.key)}>{isOpen ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}</button></td>
                  <td className="px-3 py-2 font-medium"><span className="inline-flex items-center gap-2">{media.find((m) => m.id === v.mediaId) && <img src={media.find((m) => m.id === v.mediaId)!.url} alt="" className="size-7 rounded object-cover" />}{label}</span></td>
                  <td className="px-3 py-1"><input aria-label={`${t('pricing.price')} ${variantLabel(v, '')}`} inputMode="decimal" className="w-24 field-control" value={v.price} onChange={(e) => patchAt(v.key)({ price: e.target.value })} /></td>
                  <td className="px-3 py-2">{v.tracked ? total : <span className="text-muted">{t('products.notTracked')}</span>}</td>
                  {menu && <td className="pr-2 text-right"><Dropdown align="right" variant="plain" size="sm" icon label={`${t('variants.actions')} ${label}`} trigger={<MoreHorizontal className="size-4" />} items={menu(v, { edit: () => setOpen(v.key) })} /></td>}
                </tr>
                {isOpen && (
                  <tr className="border-t border-line bg-surface"><td colSpan={cols} className="p-4">
                    <div className="grid gap-6">
                      <PricingFields v={v} patch={patchAt(v.key)} currency={currency} />
                      <InventoryFields v={v} patch={patchAt(v.key)} locations={locations} compact />
                      <ShippingFields v={v} patch={patchAt(v.key)} />
                      <VariantMediaPicker v={v} patch={patchAt(v.key)} media={media} />
                      {v.id && onMetafields && <div><Button size="sm" onClick={() => onMetafields(v.id!)}>{t('mf.variantMetafields')}</Button></div>}
                      {v.id === undefined && !menu && <Button variant="plain" size="sm" onClick={() => onChange(variants.filter((x) => x.key !== v.key))}><Trash2 className="size-4" />{t('variants.remove')}</Button>}
                    </div>
                  </td></tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
