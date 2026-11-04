import { Button, Checkbox, Input, Select, Switch, TagInput } from '@shopme/ui';
import { ChevronDown, ChevronRight, Plus, Trash2 } from 'lucide-react';
import { Fragment, useState } from 'react';
import { formatMoney, parseDecimal } from '../format';
import { useT } from '../i18n';
import { MAX_OPTIONS, WEIGHT_UNITS, generateVariants, variantLabel } from '../lib/variants';
import type { OptionDef, VariantDraft } from '../lib/variants';

export interface LocationRef { id: string; name: string }
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
    </div>
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
  const t = useT();
  return (
    <div className="flex flex-col gap-3">
      <Switch checked={v.requiresShipping} onChange={(requiresShipping) => patch({ requiresShipping })} label={t('shipping.physical')} />
      {v.requiresShipping && (
        <div className="grid grid-cols-2 gap-3 sm:max-w-sm">
          <Input label={t('shipping.weight')} inputMode="decimal" value={v.weight} onChange={(e) => patch({ weight: e.target.value })} />
          <Select label={t('shipping.unit')} value={v.weightUnit} onChange={(e) => patch({ weightUnit: e.target.value as VariantDraft['weightUnit'] })}>
            {WEIGHT_UNITS.map((u) => <option key={u} value={u}>{t(`unit.${u}` as 'unit.GRAMS')}</option>)}
          </Select>
        </div>
      )}
    </div>
  );
}

/** One row per variant: quick edit of price/SKU, expandable for the rest. */
export function VariantsTable({ variants, locations, currency, onChange }: { variants: VariantDraft[]; locations: LocationRef[]; currency: string; onChange: (v: VariantDraft[]) => void }) {
  const t = useT();
  const [open, setOpen] = useState<string | null>(null);
  const patchAt = (key: string): Patch => (p) => onChange(variants.map((v) => (v.key === key ? { ...v, ...p } : v)));
  return (
    <div className="overflow-x-auto rounded-md border border-line">
      <table className="w-full text-sm">
        <thead className="bg-surface text-left text-xs text-muted">
          <tr><th className="w-8" /><th className="px-3 py-2 font-medium">{t('variants.variant')}</th><th className="px-3 py-2 font-medium">{t('pricing.price')} ({currency})</th><th className="px-3 py-2 font-medium">{t('inventory.available')}</th></tr>
        </thead>
        <tbody>
          {variants.map((v) => {
            const isOpen = open === v.key;
            const total = locations.reduce((n, l) => n + (Number(v.quantities[l.id]) || 0), 0);
            return (
              <Fragment key={v.key}>
                <tr className="border-t border-line">
                  <td className="pl-2"><button type="button" aria-label={t('variants.details')} aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : v.key)}>{isOpen ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}</button></td>
                  <td className="px-3 py-2 font-medium">{variantLabel(v, t('variants.default'))}</td>
                  <td className="px-3 py-1"><input aria-label={`${t('pricing.price')} ${variantLabel(v, '')}`} inputMode="decimal" className="w-24 rounded-md border border-line bg-canvas px-2 py-1" value={v.price} onChange={(e) => patchAt(v.key)({ price: e.target.value })} /></td>
                  <td className="px-3 py-2">{v.tracked ? total : <span className="text-muted">{t('products.notTracked')}</span>}</td>
                </tr>
                {isOpen && (
                  <tr className="border-t border-line bg-surface"><td colSpan={4} className="p-4">
                    <div className="grid gap-6">
                      <PricingFields v={v} patch={patchAt(v.key)} currency={currency} />
                      <InventoryFields v={v} patch={patchAt(v.key)} locations={locations} compact />
                      <ShippingFields v={v} patch={patchAt(v.key)} />
                      {v.id === undefined && <Button variant="plain" size="sm" onClick={() => onChange(variants.filter((x) => x.key !== v.key))}><Trash2 className="size-4" />{t('variants.remove')}</Button>}
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
