import { Banner, Button, Card, Checkbox, Input, Select, Skeleton, Textarea, useToast } from '@shopme/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { UserErrors, gql, mutate } from '../api';
import { METAFIELDS_SET, METAFIELD_DEFINITIONS, OWNER_METAFIELDS } from '../graphql';
import { useI18n } from '../i18n';
import { ValueInput } from './MetaobjectInputs';
import type { Labels } from './MetaobjectInputs';
import { BASE_TYPES, changedInputs, fromField, inputKind, toField, typeLabelKey } from '../lib/metafields';
import type { MetafieldDefinitionRow, MetafieldOwnerType, MetafieldValue } from '../lib/metafields';

interface Field { namespace: string; key: string; type: string; value: string; label: string; description?: string | null; defined: boolean; validations?: Array<{ name: string; value: string | null }> }
const idOf = (ns: string, key: string) => `${ns}.${key}`;

/** One editor widget per metafield type. */
function FieldInput({ f, onChange }: { f: Field; onChange: (value: string) => void }) {
  const { t } = useI18n();
  const [labels, setLabels] = useState<Labels>({});
  if (/^(list\.)?metaobject_reference$/.test(f.type)) {
    // Stored lists are JSON arrays; the editor works on the stored string directly.
    const stored = f.type.startsWith('list.') ? (() => { try { return JSON.stringify(JSON.parse(f.value)); } catch { return f.value.split('\n').map((x) => x.trim()).filter(Boolean).length ? JSON.stringify(f.value.split('\n').map((x) => x.trim()).filter(Boolean)) : ''; } })() : f.value;
    return (
      <div className="flex flex-col gap-1">
        <span className="text-[13px] font-medium">{f.label}</span>
        <ValueInput spec={{ key: f.key, name: f.label, description: f.description, required: false, type: f.type, validations: f.validations ?? [] }} value={stored} labels={labels} setLabels={setLabels}
          onChange={(v) => onChange(f.type.startsWith('list.') ? (v ? (JSON.parse(v) as string[]).join('\n') : '') : v)} />
        {f.description && <p className="text-xs text-muted">{f.description}</p>}
      </div>
    );
  }
  const kind = inputKind(f.type);
  const label = f.label;
  const help = f.description ?? (kind === 'list' ? t('mf.listHelp') : kind === 'json' ? t('mf.jsonHelp') : f.type === 'rich_text_field' ? t('mf.richHelp') : f.type.endsWith('_reference') ? t('mf.referenceHelp') : undefined);
  if (kind === 'boolean') return <Checkbox label={label} checked={f.value === 'true'} onChange={(e) => onChange(e.target.checked ? 'true' : 'false')} />;
  if (kind === 'multiline' || kind === 'json' || kind === 'list') return <Textarea label={label} help={help} rows={kind === 'multiline' ? 3 : 4} value={f.value} className={kind === 'json' ? 'font-mono text-xs' : undefined} onChange={(e) => onChange(e.target.value)} />;
  if (kind === 'color') {
    return (
      <div className="flex items-end gap-2">
        <Input label={label} help={help} className="flex-1" value={f.value} placeholder="#000000" onChange={(e) => onChange(e.target.value)} />
        <input type="color" aria-label={`${label} (${t('mf.colorPicker')})`} value={/^#[0-9a-f]{6}$/i.test(f.value) ? f.value : '#000000'} onChange={(e) => onChange(e.target.value)} className="mb-0.5 h-9 w-12 rounded-md border border-line bg-field" />
      </div>
    );
  }
  const type = kind === 'number' ? 'number' : kind === 'date' ? 'date' : kind === 'datetime' ? 'datetime-local' : kind === 'url' ? 'url' : 'text';
  return <Input label={label} help={help} type={type} step={f.type === 'number_decimal' ? 'any' : undefined} value={f.value} onChange={(e) => onChange(e.target.value)} />;
}

/**
 * Metafields of one resource: a typed input for every definition of the owner type (pinned first), the values that have no definition,
 * and a small form to add one. Saved with its own button through `metafieldsSet`.
 */
export function MetafieldsEditor({ ownerId, ownerType, title }: { ownerId: string; ownerType: MetafieldOwnerType; title?: string }) {
  const { t } = useI18n();
  const toast = useToast();
  const qc = useQueryClient();
  const defs = useQuery({ queryKey: ['metafield-definitions', ownerType], queryFn: () => gql<{ metafieldDefinitions: { nodes: MetafieldDefinitionRow[] } }>(METAFIELD_DEFINITIONS, { ownerType }) });
  const vals = useQuery({ queryKey: ['owner-metafields', ownerId], queryFn: () => gql<{ node: { metafields?: { nodes: MetafieldValue[] } } | null }>(OWNER_METAFIELDS, { id: ownerId }) });
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [added, setAdded] = useState({ namespace: 'custom', key: '', type: 'single_line_text_field', value: '' });
  const [error, setError] = useState<string | null>(null);

  const stored = vals.data?.node?.metafields?.nodes;
  const fields = useMemo(() => {
    const out: Record<string, Field> = {};
    const current = new Map((stored ?? []).map((m) => [idOf(m.namespace, m.key), m]));
    const sorted = [...(defs.data?.metafieldDefinitions.nodes ?? [])].sort((a, b) => Number(!!b.pinnedPosition) - Number(!!a.pinnedPosition));
    for (const d of sorted) {
      const id = idOf(d.namespace, d.key);
      out[id] = { namespace: d.namespace, key: d.key, type: d.type.name, value: toField(d.type.name, current.get(id)?.value ?? ''), label: d.name, description: d.description, defined: true, validations: d.validations };
    }
    for (const m of stored ?? []) {
      const id = idOf(m.namespace, m.key);
      if (!out[id]) out[id] = { namespace: m.namespace, key: m.key, type: m.type, value: toField(m.type, m.value), label: id, defined: false };
    }
    return out;
  }, [defs.data, stored]);
  const original = useMemo(() => Object.fromEntries(Object.entries(fields).map(([id, f]) => [id, f.value])), [fields]);
  useEffect(() => setEdits({}), [stored]);

  const merged = Object.fromEntries(Object.entries(fields).map(([id, f]) => [id, { ...f, value: edits[id] ?? f.value }]));
  const pendingAdd = added.key.trim() && added.value.trim() ? [{ ownerId, namespace: added.namespace.trim() || 'custom', key: added.key.trim(), type: added.type, value: fromField(added.type, added.value) }] : [];
  const inputs = [...changedInputs(ownerId, merged, original), ...pendingAdd];

  const save = useMutation({
    mutationFn: () => mutate(METAFIELDS_SET, { metafields: inputs }, 'metafieldsSet'),
    onSuccess: () => { toast(t('mf.saved')); setError(null); setAdded({ ...added, key: '', value: '' }); void qc.invalidateQueries({ queryKey: ['owner-metafields', ownerId] }); void qc.invalidateQueries({ queryKey: ['metafield-definitions'] }); },
    onError: (e) => setError(e instanceof UserErrors ? e.errors.map((x) => x.message).join(' · ') : e.message),
  });

  if (defs.isLoading || vals.isLoading) return <Card title={title ?? t('mf.title')}><Skeleton className="h-16" /></Card>;
  const loadError = defs.error ?? vals.error;
  const rows = Object.entries(merged);
  return (
    <Card title={title ?? t('mf.title')}>
      <div className="flex flex-col gap-3">
        {loadError && <Banner>{loadError.message}</Banner>}
        {error && <Banner>{error}</Banner>}
        {rows.length === 0 && <p className="text-[13px] text-muted">{t('mf.none')}</p>}
        {rows.map(([id, f]) => <div key={id}><FieldInput f={f} onChange={(value) => setEdits((e) => ({ ...e, [id]: value }))} />{!f.defined && <p className="mt-0.5 text-xs text-muted">{t(typeLabelKey(f.type))}</p>}</div>)}
        <details className="rounded-md border border-line p-3">
          <summary className="cursor-pointer text-[13px] font-medium">{t('mf.addValue')}</summary>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <Input label={t('mf.namespace')} value={added.namespace} onChange={(e) => setAdded({ ...added, namespace: e.target.value })} />
            <Input label={t('mf.key')} value={added.key} onChange={(e) => setAdded({ ...added, key: e.target.value })} />
            <Select label={t('mf.type')} value={added.type} onChange={(e) => setAdded({ ...added, type: e.target.value })}>
              {BASE_TYPES.map((x) => <option key={x} value={x}>{t(typeLabelKey(x))}</option>)}
            </Select>
            <Input label={t('mf.value')} value={added.value} onChange={(e) => setAdded({ ...added, value: e.target.value })} />
          </div>
        </details>
        <div><Button variant="primary" loading={save.isPending} disabled={!inputs.length} onClick={() => save.mutate()}>{t('mf.save')}</Button></div>
      </div>
    </Card>
  );
}
