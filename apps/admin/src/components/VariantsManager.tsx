import { Button, Checkbox, ConfirmDialog, Dropdown, Input, Modal, cx } from '@shopme/ui';
import { Check, ImageIcon, Layers, MoreHorizontal, Plus, Search, SlidersHorizontal, X } from 'lucide-react';
import { useId, useMemo, useState } from 'react';
import { formatMoney, parseDecimal, toDecimalString } from '../format';
import { useT } from '../i18n';
import { newVariantLike, variantLabel } from '../lib/variants';
import type { OptionDef, VariantDraft } from '../lib/variants';
import { OptionsEditor, VariantMediaPicker, VariantSections } from './VariantsEditor';
import type { LocationRef, MediaRef } from './VariantsEditor';

interface Props {
  options: OptionDef[]; variants: VariantDraft[]; locations: LocationRef[]; currency: string; media?: MediaRef[];
  /** Options that exist on the server cannot be renamed; see `OptionsEditor`. */
  lockedCount?: number; giftCard?: boolean;
  onMetafields?: (variantId: string) => void;
  onChange: (p: { options?: OptionDef[]; variants: VariantDraft[] }) => void;
}

const norm = (s: string) => s.trim().toLowerCase();

/**
 * Variants area of the product page: a grey strip with the option chips over a white card.
 * Without options the card holds the price, inventory and shipping sections of the single variant;
 * with options it is a master/detail view (searchable, groupable list on the left, the selected variant's sections on the right)
 * with bulk edits, "add variant" and a per-variant menu (edit values, duplicate, delete).
 */
export function VariantsManager({ options, variants, locations, currency, media, lockedCount = 0, giftCard, onMetafields, onChange }: Props) {
  const t = useT();
  const listId = useId();
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState<Record<number, string>>({});
  const [showFilters, setShowFilters] = useState(false);
  const [groupBy, setGroupBy] = useState<number | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [pickImage, setPickImage] = useState(false);
  const [editingOptions, setEditingOptions] = useState(false);
  const [adding, setAdding] = useState<{ source: VariantDraft | null; values: string[]; editKey?: string } | null>(null);
  const [addError, setAddError] = useState('');
  const [prices, setPrices] = useState<{ price: string; compareAtPrice: string } | null>(null);
  const [quantities, setQuantities] = useState<Record<string, string> | null>(null);
  const [confirm, setConfirm] = useState<string[] | null>(null);

  const multi = options.length > 0;
  const visible = useMemo(() => {
    const q = norm(search);
    return (v: VariantDraft) => (!q || norm(variantLabel(v, '')).includes(q) || norm(v.sku).includes(q) || norm(v.barcode).includes(q))
      && Object.entries(filters).every(([i, value]) => !value || v.optionValues[Number(i)] === value);
  }, [search, filters]);
  const filtering = !!search.trim() || Object.values(filters).some(Boolean);
  const shown = variants.filter(visible);
  const chosen = variants.filter((v) => selected.includes(v.key));
  const canDelete = (n: number) => variants.length - n >= 1;
  const active = variants.find((v) => v.key === activeKey) ?? variants[0]!;
  const patchAt = (key: string) => (p: Partial<VariantDraft>) => onChange({ variants: variants.map((v) => (v.key === key ? { ...v, ...p } : v)) });

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
    setActiveKey(created.key);
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

  const startOptions = () => { onChange({ options: [...options, { name: '', values: [] }], variants }); setEditingOptions(true); };
  const mediaOf = (v: VariantDraft) => media?.find((m) => m.id === v.mediaId);
  const thumb = (v: VariantDraft, size: string) => {
    const m = mediaOf(v);
    return <span className={cx('grid shrink-0 place-items-center overflow-hidden rounded-lg border border-line bg-canvas text-muted', size)}>{m ? <img src={m.url} alt="" className="size-full object-cover" /> : <ImageIcon className="size-4" />}</span>;
  };

  const groups = useMemo(() => {
    if (groupBy === null) return [{ name: null as string | null, items: shown }];
    const out: Array<{ name: string | null; items: VariantDraft[] }> = [];
    for (const v of shown) {
      const name = v.optionValues[groupBy] ?? '';
      (out.find((g) => g.name === name) ?? out[out.push({ name, items: [] }) - 1]!).items.push(v);
    }
    return out;
  }, [shown, groupBy]);

  const row = (v: VariantDraft) => {
    const total = locations.reduce((n, l) => n + (Number(v.quantities[l.id]) || 0), 0);
    const label = variantLabel(v, t('variants.default'));
    const on = v.key === active.key;
    return (
      <li key={v.key} className={cx('group flex items-center gap-1.5 rounded-lg pl-1.5 pr-1', on ? 'bg-hover' : 'hover:bg-hover')} data-selected={selected.includes(v.key) ? 'true' : undefined}>
        <input type="checkbox" aria-label={`${t('variants.select')} ${label}`} checked={selected.includes(v.key)} onChange={() => setSelected(selected.includes(v.key) ? selected.filter((k) => k !== v.key) : [...selected, v.key])}
          className={cx('size-4 shrink-0 accent-(--color-primary) group-hover:opacity-100 focus-visible:opacity-100', selected.length ? 'opacity-100' : 'opacity-0')} />
        <button type="button" aria-current={on ? 'true' : undefined} aria-label={label} onClick={() => { setActiveKey(v.key); setPickImage(false); }} className="flex min-w-0 flex-1 items-center gap-2 py-1.5 text-left">
          {thumb(v, 'size-9')}
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] font-medium">{label}</span>
            <span className="block truncate text-xs text-muted">{formatMoney(parseDecimal(v.price) ?? 0, currency)} · {v.tracked ? t('pv.availableShort', { n: total }) : t('products.notTracked')}</span>
          </span>
        </button>
      </li>
    );
  };

  const variantMenu = (v: VariantDraft) => [
    { key: 'edit', label: t('variants.editValues'), onSelect: () => openEdit(v) },
    { key: 'duplicate', label: t('variants.duplicate'), onSelect: () => openAdd(v) },
    ...(v.id && onMetafields ? [{ key: 'metafields', label: t('mf.variantMetafields'), onSelect: () => onMetafields(v.id!) }] : []),
    { key: 'delete', label: t('common.delete'), danger: true, separatorBefore: true, disabled: !canDelete(1), onSelect: () => setConfirm([v.key]) },
  ];

  const shownValues = (o: OptionDef) => o.values.slice(0, 3);
  const allOn = shown.length > 0 && shown.every((v) => selected.includes(v.key));

  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-xl bg-surface p-[9px]">
        <div className="flex flex-wrap items-center gap-2 px-1 pb-2.5 pt-1 text-[13px]">
          {!multi ? (
            <Button variant="plain" size="sm" className="btn-neutral" onClick={startOptions}><Plus className="size-4" />{t('variants.addOptions')}</Button>
          ) : (
            <>
              {options.map((o, i) => (
                <button key={i} type="button" aria-label={`${t('pv.editOptions')}: ${o.name}`} aria-expanded={editingOptions} onClick={() => setEditingOptions((x) => !x)} className="inline-flex h-7 items-center gap-2 rounded-full bg-canvas px-3 shadow-card hover:bg-hover">
                  <span className="font-medium">{o.name || t('variants.optionName')}</span>
                  {shownValues(o).map((x) => <span key={x} className="text-muted">{x}</span>)}
                  {o.values.length > 3 && <span className="text-muted">+{o.values.length - 3}</span>}
                </button>
              ))}
              <Button variant="plain" size="sm" icon aria-label={t('pv.addOption')} onClick={() => (options.length < 3 ? startOptions() : setEditingOptions(true))}><Plus className="size-4" /></Button>
            </>
          )}
        </div>
        {multi && editingOptions && (
          <div className="mb-2.5 flex flex-col gap-3 rounded-lg bg-canvas p-3 shadow-card">
            <OptionsEditor options={options} variants={variants} lockedCount={lockedCount} onChange={(o) => onChange(o)} />
            <div><Button size="sm" onClick={() => setEditingOptions(false)}>{t('pv.doneOptions')}</Button></div>
          </div>
        )}

        <div className="rounded-lg bg-canvas shadow-card">
          {!multi ? (
            <div className="p-4"><VariantSections v={variants[0]!} patch={patchAt(variants[0]!.key)} locations={locations} currency={currency} giftCard={giftCard} /></div>
          ) : (
            <>
              {selected.length > 0 && (
                <div role="toolbar" aria-label={t('variants.bulkActions')} className="flex flex-wrap items-center gap-2 rounded-t-lg border-b border-line bg-surface px-3 py-1.5">
                  <Checkbox aria-label={t('common.selectAll')} checked={selected.length === variants.length} onChange={() => setSelected(selected.length === variants.length ? [] : variants.map((v) => v.key))} />
                  <span className="text-[13px] font-medium">{t('common.selected', { n: selected.length })}</span>
                  <span className="mx-1 h-4 w-px bg-line" aria-hidden />
                  <Button size="sm" onClick={() => setPrices({ price: '', compareAtPrice: '' })}>{t('variants.editPrices')}</Button>
                  <Button size="sm" disabled={!chosen.some((v) => v.tracked)} onClick={() => setQuantities(Object.fromEntries(locations.map((l) => [l.id, ''])))}>{t('variants.editQuantities')}</Button>
                  <Button size="sm" variant="critical" disabled={!canDelete(selected.length)} onClick={() => setConfirm(selected)}>{t('variants.deleteSelected')}</Button>
                  <Button variant="plain" size="sm" icon aria-label={t('variants.clearSelection')} className="btn-neutral ml-auto" onClick={() => setSelected([])}><X className="size-4" /></Button>
                </div>
              )}
              <div className="grid md:grid-cols-[17.5rem_1fr]">
                <div className="flex min-w-0 flex-col gap-2 p-3">
                  <div className="flex items-center justify-between">
                    <Dropdown variant="plain" size="sm" icon label={t('pv.groupBy')} trigger={<Layers className="size-4" />} items={[
                      { key: 'none', label: t('pv.noGrouping'), icon: groupBy === null ? <Check className="size-4" /> : <span className="size-4" />, onSelect: () => setGroupBy(null) },
                      ...options.map((o, i) => ({ key: `g${i}`, label: `${t('pv.groupBy')} ${o.name || t('variants.optionName')}`, icon: groupBy === i ? <Check className="size-4" /> : <span className="size-4" />, onSelect: () => setGroupBy(i) })),
                    ]} />
                    <Button variant="plain" size="sm" icon aria-label={t('variants.add')} onClick={() => openAdd(null)}><Plus className="size-4" /></Button>
                  </div>
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-2.5 top-2 size-4 text-muted" />
                    <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('variants.search')} aria-label={t('variants.search')} className="field-control w-full pl-8 pr-8" />
                    <button type="button" aria-label={t('pv.filters')} aria-expanded={showFilters} onClick={() => setShowFilters((x) => !x)} className={cx('absolute right-1.5 top-1.5 grid size-5 place-items-center rounded text-muted hover:text-fg', (showFilters || filtering) && 'text-accent')}><SlidersHorizontal className="size-4" /></button>
                  </div>
                  {showFilters && (
                    <div className="flex flex-wrap gap-2">
                      {options.map((o, i) => o.values.length > 1 && (
                        <select key={i} aria-label={t('variants.filterBy', { name: o.name })} value={filters[i] ?? ''} onChange={(e) => setFilters({ ...filters, [i]: e.target.value })} className="field-control min-w-0 flex-1">
                          <option value="">{o.name}</option>
                          {o.values.map((x) => <option key={x} value={x}>{x}</option>)}
                        </select>
                      ))}
                      {filtering && <Button variant="plain" size="sm" onClick={() => { setSearch(''); setFilters({}); }}>{t('products.clearFilters')}</Button>}
                    </div>
                  )}
                  <div className="flex items-center gap-2 pl-1.5 text-[13px]">
                    <Checkbox aria-label={t('common.selectAll')} checked={allOn} onChange={() => setSelected(allOn ? selected.filter((k) => !shown.some((v) => v.key === k)) : [...new Set([...selected, ...shown.map((v) => v.key)])])} />
                    <span className="text-muted">{t('variants.count', { n: variants.length })}</span>
                  </div>
                  <div className="max-h-[34rem] overflow-y-auto" role="group" aria-label={t('pv.variantList')}>
                    {shown.length === 0 && <p className="px-2 py-6 text-center text-[13px] text-muted">{t('variants.noMatch')}</p>}
                    {groups.map((g) => (
                      <div key={g.name ?? 'all'}>
                        {g.name !== null && <p className="px-2 pb-1 pt-2 text-xs font-medium text-muted">{g.name} ({g.items.length})</p>}
                        <ul className="flex flex-col gap-0.5">{g.items.map(row)}</ul>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="min-w-0 border-t border-line p-4 md:border-l md:border-t-0" aria-live="polite">
                  <div className="flex items-center gap-3">
                    <button type="button" aria-label={t('pv.changeImage')} aria-expanded={pickImage} onClick={() => setPickImage((x) => !x)}>{thumb(active, 'size-14')}</button>
                    <p className="min-w-0 flex-1 truncate text-[15px] font-semibold">{variantLabel(active, t('variants.default'))}</p>
                    <Dropdown align="right" variant="plain" size="sm" icon label={`${t('variants.actions')} ${variantLabel(active, t('variants.default'))}`} trigger={<MoreHorizontal className="size-4" />} items={variantMenu(active)} />
                  </div>
                  {pickImage && <div className="mt-3"><VariantMediaPicker v={active} patch={patchAt(active.key)} media={media ?? []} /></div>}
                  <div className="mt-4 border-t border-line pt-4">
                    <VariantSections key={active.key} v={active} patch={patchAt(active.key)} locations={locations} currency={currency} giftCard={giftCard} />
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

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
