import { Button, Checkbox, ConfirmDialog, Input, Modal } from '@shopme/ui';
import { Plus, Search, X } from 'lucide-react';
import { useId, useMemo, useState } from 'react';
import { parseDecimal, toDecimalString } from '../format';
import { useT } from '../i18n';
import { newVariantLike, variantLabel } from '../lib/variants';
import type { OptionDef, VariantDraft } from '../lib/variants';
import { VariantsTable } from './VariantsEditor';
import type { LocationRef, MediaRef } from './VariantsEditor';

interface Props {
  options: OptionDef[]; variants: VariantDraft[]; locations: LocationRef[]; currency: string; media?: MediaRef[];
  onMetafields?: (variantId: string) => void;
  onChange: (p: { options?: OptionDef[]; variants: VariantDraft[] }) => void;
}

const norm = (s: string) => s.trim().toLowerCase();

/** Variants table with search, option filters, select all with bulk edits, "Add variant" and a per-variant menu (edit, duplicate, delete). */
export function VariantsManager({ options, variants, locations, currency, media, onMetafields, onChange }: Props) {
  const t = useT();
  const listId = useId();
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState<Record<number, string>>({});
  const [selected, setSelected] = useState<string[]>([]);
  const [adding, setAdding] = useState<{ source: VariantDraft | null; values: string[]; editKey?: string } | null>(null);
  const [addError, setAddError] = useState('');
  const [prices, setPrices] = useState<{ price: string; compareAtPrice: string } | null>(null);
  const [quantities, setQuantities] = useState<Record<string, string> | null>(null);
  const [confirm, setConfirm] = useState<string[] | null>(null);

  const visible = useMemo(() => {
    const q = norm(search);
    return (v: VariantDraft) => (!q || norm(variantLabel(v, '')).includes(q) || norm(v.sku).includes(q) || norm(v.barcode).includes(q))
      && Object.entries(filters).every(([i, value]) => !value || v.optionValues[Number(i)] === value);
  }, [search, filters]);
  const filtering = !!search.trim() || Object.values(filters).some(Boolean);
  const chosen = variants.filter((v) => selected.includes(v.key));
  const canDelete = (n: number) => variants.length - n >= 1;

  const patchSelected = (p: (v: VariantDraft) => Partial<VariantDraft>) => onChange({ variants: variants.map((v) => (selected.includes(v.key) ? { ...v, ...p(v) } : v)) });
  const remove = (keys: string[]) => { onChange({ variants: variants.filter((v) => !keys.includes(v.key)) }); setSelected((s) => s.filter((k) => !keys.includes(k))); };

  const openAdd = (source: VariantDraft | null) => { setAddError(''); setAdding({ source, values: options.map((_, i) => source?.optionValues[i] ?? '') }); };
  const openEdit = (v: VariantDraft) => { setAddError(''); setAdding({ source: v, editKey: v.key, values: options.map((_, i) => v.optionValues[i] ?? '') }); };
  const confirmAdd = () => {
    if (!adding) return;
    const values = adding.values.map((x) => x.trim());
    if (values.some((x) => !x)) { setAddError(t('variants.addMissing')); return; }
    if (variants.some((v) => v.key !== adding.editKey && v.optionValues.length === values.length && v.optionValues.every((x, i) => norm(x) === norm(values[i]!)))) { setAddError(t('variants.addExists')); return; }
    // A value typed in the dialog becomes a value of its option, so the options editor stays in sync.
    const nextOptions = options.map((o, i) => (o.values.some((x) => norm(x) === norm(values[i]!)) ? o : { ...o, values: [...o.values, values[i]!] }));
    const canon = values.map((x, i) => nextOptions[i]!.values.find((y) => norm(y) === norm(x)) ?? x);
    if (adding.editKey) {
      onChange({ options: nextOptions, variants: variants.map((v) => (v.key === adding.editKey ? { ...v, optionValues: canon } : v)) });
      setAdding(null);
      return;
    }
    const created = { ...newVariantLike(adding.source ?? variants[0], canon), ...(adding.source && { sku: '', barcode: '' }) };
    onChange({ options: nextOptions, variants: [...variants, created] });
    setAdding(null);
  };

  const applyPrices = () => {
    if (!prices) return;
    const price = parseDecimal(prices.price), compare = parseDecimal(prices.compareAtPrice);
    patchSelected(() => ({ ...(price !== null && price >= 0 && { price: toDecimalString(price) ?? '0.00' }), ...(compare !== null && compare >= 0 && { compareAtPrice: toDecimalString(compare) ?? '' }) }));
    setPrices(null);
  };
  const applyQuantities = () => {
    if (!quantities) return;
    const set = Object.entries(quantities).filter(([, n]) => n.trim() !== '' && Number.isFinite(Number(n)));
    patchSelected((v) => (v.tracked ? { quantities: { ...v.quantities, ...Object.fromEntries(set.map(([loc, n]) => [loc, String(Math.max(0, Math.trunc(Number(n))))])) } } : {}));
    setQuantities(null);
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-40 flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-2 size-4 text-muted" />
          <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('variants.search')} aria-label={t('variants.search')} className="field-control w-full pl-8" />
        </div>
        {options.map((o, i) => o.values.length > 1 && (
          <select key={i} aria-label={t('variants.filterBy', { name: o.name })} value={filters[i] ?? ''} onChange={(e) => setFilters({ ...filters, [i]: e.target.value })} className="field-control">
            <option value="">{o.name}</option>
            {o.values.map((x) => <option key={x} value={x}>{x}</option>)}
          </select>
        ))}
        {filtering && <Button variant="plain" size="sm" onClick={() => { setSearch(''); setFilters({}); }}>{t('products.clearFilters')}</Button>}
        <Button onClick={() => openAdd(null)}><Plus className="size-4" />{t('variants.add')}</Button>
      </div>

      {selected.length > 0 && (
        <div role="toolbar" aria-label={t('variants.bulkActions')} className="flex flex-wrap items-center gap-2 rounded-md border border-line bg-surface px-3 py-1.5">
          <Checkbox aria-label={t('common.selectAll')} checked={selected.length === variants.length} onChange={() => setSelected(selected.length === variants.length ? [] : variants.map((v) => v.key))} />
          <span className="text-[13px] font-medium">{t('common.selected', { n: selected.length })}</span>
          <span className="mx-1 h-4 w-px bg-line" aria-hidden />
          <Button size="sm" onClick={() => setPrices({ price: '', compareAtPrice: '' })}>{t('variants.editPrices')}</Button>
          <Button size="sm" disabled={!chosen.some((v) => v.tracked)} onClick={() => setQuantities(Object.fromEntries(locations.map((l) => [l.id, ''])))}>{t('variants.editQuantities')}</Button>
          <Button size="sm" variant="critical" disabled={!canDelete(selected.length)} onClick={() => setConfirm(selected)}>{t('variants.deleteSelected')}</Button>
          <Button variant="plain" size="sm" icon aria-label={t('variants.clearSelection')} className="btn-neutral ml-auto" onClick={() => setSelected([])}><X className="size-4" /></Button>
        </div>
      )}

      <VariantsTable
        variants={variants} locations={locations} currency={currency} media={media} onMetafields={onMetafields} onChange={(vs) => onChange({ variants: vs })}
        selection={{ selected, onChange: setSelected }} visible={visible}
        menu={(v) => [
          { key: 'edit', label: t('variants.editValues'), onSelect: () => openEdit(v) },
          { key: 'duplicate', label: t('variants.duplicate'), onSelect: () => openAdd(v) },
          { key: 'delete', label: t('common.delete'), danger: true, disabled: !canDelete(1), onSelect: () => setConfirm([v.key]) },
        ]}
      />

      <Modal open={!!adding} onClose={() => setAdding(null)} closeLabel={t('common.close')} title={adding?.editKey ? t('variants.editValues') : adding?.source ? t('variants.duplicateTitle') : t('variants.add')}
        footer={<><Button onClick={() => setAdding(null)}>{t('common.cancel')}</Button><Button variant="primary" onClick={confirmAdd}>{adding?.editKey ? t('common.apply') : t('variants.addConfirm')}</Button></>}>
        {adding && (
          <div className="grid gap-3">
            {!adding.editKey && <p className="text-[13px] text-muted">{t('variants.addHelp')}</p>}
            {options.map((o, i) => (
              <div key={i}>
                <Input label={o.name} list={`${listId}-${i}`} value={adding.values[i] ?? ''} onChange={(e) => { setAddError(''); setAdding({ ...adding, values: adding.values.map((x, j) => (j === i ? e.target.value : x)) }); }} />
                <datalist id={`${listId}-${i}`}>{o.values.map((x) => <option key={x} value={x} />)}</datalist>
              </div>
            ))}
            {addError && <p role="alert" className="text-xs text-critical">{addError}</p>}
          </div>
        )}
      </Modal>

      <Modal open={!!prices} onClose={() => setPrices(null)} closeLabel={t('common.close')} title={t('variants.editPricesTitle', { n: selected.length })}
        footer={<><Button onClick={() => setPrices(null)}>{t('common.cancel')}</Button><Button variant="primary" onClick={applyPrices}>{t('common.apply')}</Button></>}>
        {prices && (
          <div className="grid gap-3">
            <p className="text-[13px] text-muted">{t('variants.leaveEmpty')}</p>
            <Input label={`${t('pricing.price')} (${currency})`} inputMode="decimal" value={prices.price} onChange={(e) => setPrices({ ...prices, price: e.target.value })} />
            <Input label={`${t('pricing.compareAt')} (${currency})`} inputMode="decimal" value={prices.compareAtPrice} onChange={(e) => setPrices({ ...prices, compareAtPrice: e.target.value })} />
          </div>
        )}
      </Modal>

      <Modal open={!!quantities} onClose={() => setQuantities(null)} closeLabel={t('common.close')} title={t('variants.editQuantitiesTitle', { n: chosen.filter((v) => v.tracked).length })}
        footer={<><Button onClick={() => setQuantities(null)}>{t('common.cancel')}</Button><Button variant="primary" onClick={applyQuantities}>{t('common.apply')}</Button></>}>
        {quantities && (
          <div className="grid gap-3">
            <p className="text-[13px] text-muted">{t('variants.quantitiesHelp')}</p>
            {locations.map((l) => <Input key={l.id} label={`${t('inventory.available')} — ${l.name}`} type="number" min={0} value={quantities[l.id] ?? ''} onChange={(e) => setQuantities({ ...quantities, [l.id]: e.target.value })} />)}
          </div>
        )}
      </Modal>

      <ConfirmDialog open={!!confirm} onClose={() => setConfirm(null)} danger title={t('variants.deleteTitle', { n: confirm?.length ?? 0 })} message={t('variants.deleteBody')}
        confirmLabel={t('common.delete')} cancelLabel={t('common.cancel')} onConfirm={() => { if (confirm) remove(confirm); setConfirm(null); }} />
    </div>
  );
}
