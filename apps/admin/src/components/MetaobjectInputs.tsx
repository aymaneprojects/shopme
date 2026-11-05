import { Button, Checkbox, Modal, Textarea } from '@shopme/ui';
import { useQuery } from '@tanstack/react-query';
import { Plus, X } from 'lucide-react';
import { useState } from 'react';
import { gql } from '../api';
import { MO_PICK_ALL_ENTRIES, MO_PICK_ENTRIES, MO_PICK_FILES, MO_PICK_PAGES, MO_REF_LABELS } from '../graphql';
import { useT } from '../i18n';
import { useDebounced } from '../lib/hooks';
import { baseOf, choicesToText, definitionIdsOf, isListType, parseList, serializeList, unitsOf } from '../lib/metaobjects';
import { CollectionPicker, ProductPicker, VariantPicker } from './Pickers';
import { RichText } from './RichText';

export interface FieldSpec { key: string; name: string; description?: string | null; required: boolean; type: string; validations: Array<{ name: string; value: string | null }> }
/** Display names of referenced records by GID (so chips can show a title without another request). */
export type Labels = Record<string, string>
export interface RefItem { id: string; label: string }

const validation = (spec: FieldSpec, name: string) => spec.validations.find((v) => v.name === name)?.value ?? undefined;
const seg = 'inline-flex rounded-full bg-surface p-0.5 text-[13px]';
const segBtn = (on: boolean) => `rounded-full px-3 py-1 ${on ? 'bg-canvas font-medium shadow-card' : 'text-muted hover:text-fg'}`;

function jsonObj(value: string): Record<string, string> { try { const o = JSON.parse(value) as Record<string, unknown>; return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, String(v)])); } catch { return {}; } }

/** One editor for a single (non-list, non-reference) value. Empty means "no value". */
function Scalar({ spec, base, value, onChange, label }: { spec: FieldSpec; base: string; value: string; onChange: (v: string) => void; label: string }) {
  const t = useT();
  const choices = base === 'single_line_text_field' ? validation(spec, 'choices') : undefined;
  if (choices) {
    let list: string[] = [];
    try { list = (JSON.parse(choices) as unknown[]).map(String); } catch { /* none */ }
    return <select aria-label={label} className="field-control" value={value} onChange={(e) => onChange(e.target.value)}><option value="" />{list.map((c) => <option key={c} value={c}>{c}</option>)}</select>;
  }
  switch (base) {
    case 'multi_line_text_field': return <Textarea aria-label={label} rows={3} value={value} onChange={(e) => onChange(e.target.value)} />;
    case 'rich_text_field': return <div className="w-full"><RichText value={value} onChange={onChange} /></div>;
    case 'number_integer': case 'number_decimal': return <input aria-label={label} type="number" step={base === 'number_decimal' ? 'any' : 1} className="field-control w-40" value={value} onChange={(e) => onChange(e.target.value)} />;
    case 'boolean': return (
      <div className={seg} role="group" aria-label={label}>
        <button type="button" aria-pressed={value === 'false'} className={segBtn(value === 'false')} onClick={() => onChange('false')}>{t('mo.false')}</button>
        <button type="button" aria-pressed={value === 'true'} className={segBtn(value === 'true')} onClick={() => onChange('true')}>{t('mo.true')}</button>
      </div>
    );
    case 'date': return <input aria-label={label} type="date" className="field-control" value={value} onChange={(e) => onChange(e.target.value)} />;
    case 'date_time': return <input aria-label={label} type="datetime-local" className="field-control" value={value.replace(/:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})?$/, '').slice(0, 16)} onChange={(e) => onChange(e.target.value ? new Date(e.target.value).toISOString() : '')} />;
    case 'color': return (
      <div className="flex items-center gap-2">
        <input aria-label={label} className="field-control w-32" placeholder="#000000" value={value} onChange={(e) => onChange(e.target.value)} />
        <input type="color" aria-label={`${label} (${t('mf.colorPicker')})`} className="h-8 w-10 rounded-md border border-line bg-field" value={/^#[0-9a-f]{6}$/i.test(value) ? value : '#000000'} onChange={(e) => onChange(e.target.value)} />
      </div>
    );
    case 'json': return <Textarea aria-label={label} rows={4} className="font-mono text-xs" value={value} onChange={(e) => onChange(e.target.value)} />;
    case 'money': {
      const o = jsonObj(value);
      const set = (p: Record<string, string>) => { const n = { ...o, ...p }; onChange(n.amount || n.currency_code ? JSON.stringify({ amount: n.amount ?? '', currency_code: n.currency_code || 'EUR' }) : ''); };
      return <div className="flex gap-2"><input aria-label={label} type="number" step="any" className="field-control w-32" value={o.amount ?? ''} onChange={(e) => set({ amount: e.target.value })} /><input aria-label={`${label} (${t('mo.currency')})`} className="field-control w-20" maxLength={3} value={o.currency_code ?? 'EUR'} onChange={(e) => set({ currency_code: e.target.value.toUpperCase() })} /></div>;
    }
    case 'weight': case 'volume': case 'dimension': {
      const o = jsonObj(value);
      const units = unitsOf(base);
      const set = (p: Record<string, string>) => { const n: Record<string, string | undefined> = { unit: units[0], ...o, ...p }; onChange(n.value ? JSON.stringify({ value: Number(n.value), unit: n.unit }) : ''); };
      return <div className="flex gap-2"><input aria-label={label} type="number" step="any" className="field-control w-32" value={o.value ?? ''} onChange={(e) => set({ value: e.target.value })} /><select aria-label={`${label} (${t('mo.unit')})`} className="field-control" value={o.unit ?? units[0]} onChange={(e) => set({ unit: e.target.value })}>{units.map((u) => <option key={u}>{u}</option>)}</select></div>;
    }
    case 'rating': {
      const o = jsonObj(value);
      const lo = validation(spec, 'scale_min') ?? o.scale_min ?? '0', hi = validation(spec, 'scale_max') ?? o.scale_max ?? '5';
      return <div className="flex items-center gap-2"><input aria-label={label} type="number" step="any" min={lo} max={hi} className="field-control w-24" value={o.value ?? ''} onChange={(e) => onChange(e.target.value ? JSON.stringify({ value: e.target.value, scale_min: lo, scale_max: hi }) : '')} /><span className="text-xs text-muted">/ {hi}</span></div>;
    }
    default: return <input aria-label={label} type={base === 'url' ? 'url' : 'text'} className="field-control w-full" value={value} onChange={(e) => onChange(e.target.value)} />;
  }
}

/** Searchable single/multi picker for pages, files and metaobject entries (products, variants and collections use the shared pickers). */
function RecordPicker({ open, kind, definitionTypes, multiple, onClose, onPick }: { open: boolean; kind: 'page' | 'file' | 'entry'; definitionTypes: string[]; multiple: boolean; onClose: () => void; onPick: (items: RefItem[]) => void }) {
  const t = useT();
  const [search, setSearch] = useState('');
  const term = useDebounced(search).trim();
  const [picked, setPicked] = useState<Map<string, RefItem>>(new Map());
  const q = useQuery({
    queryKey: ['mo-pick', kind, definitionTypes, term], enabled: open,
    queryFn: async (): Promise<RefItem[]> => {
      if (kind === 'page') return (await gql<{ pages: { nodes: Array<{ id: string; title: string }> } }>(MO_PICK_PAGES, { query: term || null })).pages.nodes.map((n) => ({ id: n.id, label: n.title }));
      if (kind === 'file') return (await gql<{ files: { nodes: Array<{ id: string; alt: string | null; shopmeFilename: string | null }> } }>(MO_PICK_FILES, { query: term || null })).files.nodes.map((n) => ({ id: n.id, label: n.shopmeFilename || n.alt || n.id }));
      if (definitionTypes.length === 1) return (await gql<{ metaobjects: { nodes: Array<{ id: string; displayName: string }> } }>(MO_PICK_ENTRIES, { type: definitionTypes[0], query: term || null })).metaobjects.nodes.map((n) => ({ id: n.id, label: n.displayName }));
      const all = (await gql<{ shopmeMetaobjects: { nodes: Array<{ id: string; displayName: string; type?: string; definition: { name: string; type?: string } }> } }>(MO_PICK_ALL_ENTRIES, { query: term || null })).shopmeMetaobjects.nodes;
      return all.filter((n) => !definitionTypes.length || definitionTypes.includes(n.definition.type ?? '')).map((n) => ({ id: n.id, label: `${n.displayName} (${n.definition.name})` }));
    },
  });
  const close = () => { setPicked(new Map()); setSearch(''); onClose(); };
  const toggle = (r: RefItem) => setPicked((m) => { const n = new Map(multiple ? m : []); if (m.has(r.id)) n.delete(r.id); else n.set(r.id, r); return n; });
  return (
    <Modal open={open} onClose={close} title={t(kind === 'page' ? 'mo.pick.page' : kind === 'file' ? 'mo.pick.file' : 'mo.pick.entry')} closeLabel={t('common.close')}
      footer={<><Button onClick={close}>{t('common.cancel')}</Button><Button variant="primary" disabled={!picked.size} onClick={() => { onPick([...picked.values()]); close(); }}>{t('mo.pick.choose')}</Button></>}>
      <input type="search" autoFocus value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('mo.pick.search')} aria-label={t('mo.pick.search')} className="mb-3 w-full field-control" />
      {q.isLoading ? <p className="text-[13px] text-muted">{t('common.loading')}</p> : !q.data?.length ? <p className="text-[13px] text-muted">{t('picker.none')}</p> : (
        <ul className="divide-y divide-line">
          {q.data.map((r) => <li key={r.id} className="flex items-center gap-3 py-2"><Checkbox checked={picked.has(r.id)} onChange={() => toggle(r)} aria-label={r.label} /><span className="text-[13px]">{r.label}</span></li>)}
        </ul>
      )}
    </Modal>
  );
}

/** Reference field: chips for the chosen records and a button that opens the matching picker. */
function RefInput({ spec, value, onChange, labels, setLabels, label }: { spec: FieldSpec; value: string; onChange: (v: string) => void; labels: Labels; setLabels: (l: Labels) => void; label: string }) {
  const t = useT();
  const base = baseOf(spec.type);
  const list = isListType(spec.type);
  const ids = list ? parseList(value) : value ? [value] : [];
  const [open, setOpen] = useState(false);
  const defIds = base === 'metaobject_reference' ? definitionIdsOf(validation(spec, 'metaobject_definition_id')) : base === 'mixed_reference' ? definitionIdsOf(validation(spec, 'metaobject_definition_ids')) : [];
  const defTypes = useQuery({
    queryKey: ['mo-def-types', defIds], enabled: defIds.length > 0,
    queryFn: async () => (await gql<{ metaobjectDefinitions: { nodes: Array<{ id: string; type: string }> } }>(`query MetaobjectDefTypes { metaobjectDefinitions(first: 100) { nodes { id type } } }`)).metaobjectDefinitions.nodes.filter((d) => defIds.some((x) => x === d.id || d.id.endsWith(`/${x.split('/').pop()}`))).map((d) => d.type),
  });
  const unknown = ids.filter((id) => !labels[id]);
  const fetched = useQuery({
    queryKey: ['mo-ref-labels', unknown], enabled: unknown.length > 0,
    queryFn: async () => (await gql<{ nodes: Array<{ id: string; displayName?: string; title?: string; alt?: string | null } | null> }>(MO_REF_LABELS, { ids: unknown })).nodes,
  });
  const labelOf = (id: string) => labels[id] ?? (() => { const n = fetched.data?.find((x) => x?.id === id); return n ? (n.displayName ?? n.title ?? n.alt ?? undefined) : undefined; })() ?? id.split('/').pop() ?? id;
  const set = (picked: RefItem[]) => {
    setLabels({ ...labels, ...Object.fromEntries(picked.map((p) => [p.id, p.label])) });
    const next = list ? [...new Set([...ids, ...picked.map((p) => p.id)])] : picked.slice(0, 1).map((p) => p.id);
    onChange(list ? (next.length ? JSON.stringify(next) : '') : (next[0] ?? ''));
  };
  const remove = (id: string) => { const next = ids.filter((x) => x !== id); onChange(list ? (next.length ? JSON.stringify(next) : '') : ''); };
  const common = { open, onClose: () => setOpen(false) };
  return (
    <div className="flex flex-col items-start gap-2">
      {ids.length > 0 && (
        <ul className="flex flex-wrap gap-1.5" aria-label={label}>
          {ids.map((id) => (
            <li key={id} className="inline-flex items-center gap-1 rounded-full bg-surface py-0.5 pl-2.5 pr-1 text-[13px]">
              <span>{labelOf(id)}</span>
              <button type="button" aria-label={`${t('common.remove')} ${labelOf(id)}`} className="rounded-full p-0.5 text-muted hover:text-fg" onClick={() => remove(id)}><X className="size-3.5" /></button>
            </li>
          ))}
        </ul>
      )}
      {(list || ids.length === 0) && <Button size="sm" onClick={() => setOpen(true)}><Plus className="size-4" />{t(ids.length ? 'mo.addMore' : 'mo.add')}</Button>}
      {!list && ids.length > 0 && <Button size="sm" variant="plain" onClick={() => setOpen(true)}>{t('mo.change')}</Button>}
      {base === 'product_reference' && <ProductPicker {...common} onConfirm={(p) => set(p.map((x) => ({ id: x.id, label: x.title })))} />}
      {base === 'collection_reference' && <CollectionPicker {...common} onConfirm={(c) => set(c.map((x) => ({ id: x.id, label: x.title })))} />}
      {base === 'variant_reference' && <VariantPicker open={open} onClose={common.onClose} onConfirm={(v) => set(v.map((x) => ({ id: x.variantId, label: `${x.productTitle}${x.variantTitle && x.variantTitle !== 'Default Title' ? ` – ${x.variantTitle}` : ''}` })))} />}
      {base === 'page_reference' && <RecordPicker {...common} kind="page" definitionTypes={[]} multiple={list} onPick={set} />}
      {base === 'file_reference' && <RecordPicker {...common} kind="file" definitionTypes={[]} multiple={list} onPick={set} />}
      {(base === 'metaobject_reference' || base === 'mixed_reference') && <RecordPicker {...common} kind="entry" definitionTypes={defTypes.data ?? []} multiple={list} onPick={set} />}
    </div>
  );
}

/** Value editor for one field of a metaobject entry (or of a metafield with a metaobject reference type). `value` is the stored string. */
export function ValueInput({ spec, value, onChange, labels, setLabels }: { spec: FieldSpec; value: string; onChange: (v: string) => void; labels: Labels; setLabels: (l: Labels) => void }) {
  const t = useT();
  const base = baseOf(spec.type);
  const list = isListType(spec.type);
  const [open, setOpen] = useState(value !== '');
  const reference = base.endsWith('_reference');
  if (reference) return <RefInput spec={spec} value={value} onChange={onChange} labels={labels} setLabels={setLabels} label={spec.name} />;
  if (base === 'boolean' && !list) return <Scalar spec={spec} base={base} value={value} onChange={onChange} label={spec.name} />;
  if (!open && !value) return <Button size="sm" onClick={() => setOpen(true)}><Plus className="size-4" />{t('mo.add')}</Button>;
  if (!list) return <Scalar spec={spec} base={base} value={value} onChange={onChange} label={spec.name} />;
  const choices = base === 'single_line_text_field' ? validation(spec, 'choices') : undefined;
  const items = parseList(value);
  if (choices) {
    const options = choicesToText(choices).split('\n').filter(Boolean);
    return (
      <div className="flex flex-col gap-1" role="group" aria-label={spec.name}>
        {options.map((o) => <Checkbox key={o} label={o} checked={items.includes(o)} onChange={(e) => onChange(serializeList(base, e.target.checked ? [...items, o] : items.filter((x) => x !== o)))} />)}
      </div>
    );
  }
  const setItem = (i: number, v: string) => onChange(serializeList(base, items.map((x, j) => (j === i ? v : x))));
  return (
    <div className="flex flex-col items-start gap-2">
      {items.map((it, i) => (
        <div key={i} className="flex w-full items-start gap-2">
          <div className="min-w-0 flex-1"><Scalar spec={spec} base={base} value={it} onChange={(v) => setItem(i, v)} label={`${spec.name} ${i + 1}`} /></div>
          <Button size="sm" variant="plain" aria-label={`${t('common.remove')} ${i + 1}`} onClick={() => onChange(serializeList(base, items.filter((_, j) => j !== i)))}><X className="size-4" /></Button>
        </div>
      ))}
      <Button size="sm" onClick={() => onChange(JSON.stringify([...items, base.startsWith('number') ? 0 : '']))}><Plus className="size-4" />{t('mo.addItem')}</Button>
    </div>
  );
}

