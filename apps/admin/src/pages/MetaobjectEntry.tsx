import { Badge, Banner, Button, Card, ConfirmDialog, Dropdown, Input, Select, Skeleton, useToast } from '@shopme/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Boxes, Copy, Info, MoreHorizontal } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { UserErrors, gql, mutate } from '../api';
import { ValueInput } from '../components/MetaobjectInputs';
import type { FieldSpec, Labels } from '../components/MetaobjectInputs';
import { PageHeader } from '../components/PageHeader';
import { SaveBar, guard } from '../components/SaveBar';
import { useFormat } from '../components/shared';
import { gidToNum, numToGid } from '../format';
import { METAOBJECT, METAOBJECT_CREATE, METAOBJECT_DEFINITION_BY_TYPE, METAOBJECT_DELETE, METAOBJECT_UPDATE } from '../graphql';
import { useI18n } from '../i18n';
import { isListType } from '../lib/metaobjects';

interface Ref { id: string; title?: string; displayName?: string; alt?: string | null; image?: { url: string } | null; product?: { title: string }; definition?: { name: string } }
interface FieldData { key: string; type: string; value: string | null; reference: Ref | null; references: { nodes: Array<Ref | null> } | null }
interface DefinitionData {
  id: string; type: string; name: string; displayNameKey: string | null;
  capabilities: { publishable: { enabled: boolean }; translatable: { enabled: boolean }; onlineStore: { enabled: boolean; data: { urlHandle: string } | null } | null };
  fieldDefinitions: Array<Omit<FieldSpec, 'type'> & { type: { name: string } }>;
}
interface EntryData {
  id: string; handle: string; shopmeExternalId: string | null; displayName: string; type: string; updatedAt: string; createdAt: string;
  capabilities: { publishable: { status: string } | null; onlineStore: { templateSuffix: string | null } | null };
  definition: DefinitionData; fields: FieldData[];
  referencedBy: { nodes: Array<{ key: string; name: string; namespace: string; referencer: { __typename: string; id: string; displayName?: string; title?: string } }> };
}

const refLabel = (r: Ref | null): string => (r ? (r.displayName ?? (r.product?.title && r.title ? `${r.product.title} – ${r.title}` : r.title) ?? r.alt ?? r.image?.url.split('/').pop() ?? r.id) : '');

/** Make a stored list value tidy (no blank items) before it is sent. */
function normalize(type: string, value: string): string {
  if (!isListType(type) || !value) return value;
  try { const kept = (JSON.parse(value) as unknown[]).filter((x) => String(x).trim() !== ''); return kept.length ? JSON.stringify(kept) : ''; } catch { return value; }
}

function useDefinition(type: string, enabled: boolean) {
  return useQuery({ queryKey: ['mo-definition-type', type], enabled, queryFn: async () => (await gql<{ metaobjectDefinitionByType: DefinitionData | null }>(METAOBJECT_DEFINITION_BY_TYPE, { type })).metaobjectDefinitionByType });
}

/** Entry editor route: loads the entry (or the definition for a new one) and renders the form. */
export function MetaobjectEntryPage() {
  const { type = '', id = 'new' } = useParams();
  const isNew = id === 'new';
  const { t } = useI18n();
  const gid = numToGid('Metaobject', id);
  const q = useQuery({ queryKey: ['mo-entry', gid], enabled: !isNew, queryFn: async () => (await gql<{ metaobject: EntryData | null }>(METAOBJECT, { id: gid })).metaobject });
  const def = useDefinition(type, isNew);
  if (isNew ? def.isLoading : q.isLoading) return <Skeleton className="h-64" />;
  if (q.error || def.error) return <Banner>{((q.error ?? def.error) as Error).message}</Banner>;
  if (isNew) {
    if (!def.data) return <Banner>{t('mo.definitionNotFound')}</Banner>;
    return <EntryForm key="new" entry={null} definition={def.data} />;
  }
  if (!q.data) return <Banner>{t('mo.entryNotFound')}</Banner>;
  return <EntryForm key={`${id}:${q.dataUpdatedAt}`} entry={q.data} definition={q.data.definition} />;
}

function EntryForm({ entry, definition: raw }: { entry: EntryData | null; definition: DefinitionData }) {
  const { t } = useI18n();
  const nav = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();
  const fmt = useFormat();
  const definition = useMemo(() => ({ ...raw, fieldDefinitions: raw.fieldDefinitions.map((f): FieldSpec => ({ ...f, type: f.type.name })) }), [raw]);
  const publishable = definition.capabilities.publishable.enabled;
  const online = definition.capabilities.onlineStore;
  const initial = useMemo(() => ({
    values: Object.fromEntries(definition.fieldDefinitions.map((f) => [f.key, entry?.fields.find((x) => x.key === f.key)?.value ?? ''])) as Record<string, string>,
    handle: entry?.handle ?? '', externalId: entry?.shopmeExternalId ?? '', status: entry?.capabilities.publishable?.status ?? 'ACTIVE', templateSuffix: entry?.capabilities.onlineStore?.templateSuffix ?? '', redirect: false,
  }), [definition, entry]);
  const [form, setForm] = useState(initial);
  const [labels, setLabels] = useState<Labels>(() => {
    const out: Labels = {};
    for (const f of entry?.fields ?? []) {
      if (f.reference) out[f.reference.id] = refLabel(f.reference);
      for (const n of f.references?.nodes ?? []) if (n) out[n.id] = refLabel(n);
    }
    return out;
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [banner, setBanner] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const dirty = JSON.stringify(form) !== JSON.stringify(initial);
  const set = (p: Partial<typeof form>) => setForm((f) => ({ ...f, ...p }));
  const fieldsInput = () => definition.fieldDefinitions.map((f) => ({ key: f.key, value: normalize(f.type, form.values[f.key] ?? '') }))
    .filter((f) => entry || f.value !== '');

  const save = useMutation({
    mutationFn: async () => {
      setErrors({}); setBanner(null);
      const capabilities = { ...(publishable && { publishable: { status: form.status } }), ...(online?.enabled && { onlineStore: { templateSuffix: form.templateSuffix || null } }) };
      if (entry) {
        await mutate(METAOBJECT_UPDATE, { id: entry.id, metaobject: { fields: fieldsInput(), handle: form.handle.trim() || undefined, shopmeExternalId: form.externalId.trim(), redirectNewHandle: form.redirect, capabilities } }, 'metaobjectUpdate');
        return entry.id;
      }
      return (await mutate<{ metaobject: { id: string } }>(METAOBJECT_CREATE, { metaobject: { type: definition.type, fields: fieldsInput(), handle: form.handle.trim() || undefined, shopmeExternalId: form.externalId.trim() || undefined, capabilities } }, 'metaobjectCreate')).metaobject.id;
    },
    onSuccess: (id) => {
      toast(t('mo.entrySaved'));
      void qc.invalidateQueries({ queryKey: ['mo-entry'] }); void qc.invalidateQueries({ queryKey: ['mo-entries'] }); void qc.invalidateQueries({ queryKey: ['mo-summary'] }); void qc.invalidateQueries({ queryKey: ['mo-definitions'] });
      if (!entry) { guard.off = true; nav(`/content/metaobjects/${encodeURIComponent(definition.type)}/${gidToNum(id)}`, { replace: true }); }
    },
    onError: (e) => {
      if (!(e instanceof UserErrors)) { setBanner(e.message); return; }
      const byKey: Record<string, string> = {};
      const rest: string[] = [];
      for (const err of e.errors as Array<{ message: string; elementKey?: string | null; field?: string[] | null }>) {
        if (err.elementKey) byKey[err.elementKey] = err.message; else rest.push(err.message);
      }
      setErrors(byKey);
      if (rest.length) setBanner(rest.join(' · '));
    },
  });
  const del = useMutation({
    mutationFn: () => mutate(METAOBJECT_DELETE, { id: entry!.id }, 'metaobjectDelete'),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['mo-entries'] }); void qc.invalidateQueries({ queryKey: ['mo-summary'] }); void qc.invalidateQueries({ queryKey: ['mo-definitions'] }); guard.off = true; nav(`/content/metaobjects/${encodeURIComponent(definition.type)}`); },
    onError: (e) => { setConfirm(false); setBanner(e.message); },
  });
  const dup = useMutation({
    mutationFn: async () => {
      const fields = definition.fieldDefinitions.map((f) => ({ key: f.key, value: normalize(f.type, initial.values[f.key] ?? '') })).filter((f) => f.value !== '');
      return (await mutate<{ metaobject: { id: string } }>(METAOBJECT_CREATE, { metaobject: { type: definition.type, fields, capabilities: publishable ? { publishable: { status: 'DRAFT' } } : undefined } }, 'metaobjectCreate')).metaobject.id;
    },
    onSuccess: (id) => { toast(t('mo.duplicated')); void qc.invalidateQueries({ queryKey: ['mo-entries'] }); nav(`/content/metaobjects/${encodeURIComponent(definition.type)}/${gidToNum(id)}`); },
    onError: (e) => toast(e.message, 'critical'),
  });

  const nameKey = definition.displayNameKey;
  const title = entry ? entry.displayName || entry.handle : t('mo.newEntry', { name: definition.name });
  const url = online?.enabled && online.data ? `/pages/${online.data.urlHandle}/${form.handle || entry?.handle || ''}` : null;
  return (
    <>
      <SaveBar dirty={dirty} saving={save.isPending} onSave={() => save.mutate()} onDiscard={() => { setForm(initial); setErrors({}); setBanner(null); }} />
      <PageHeader large back={`/content/metaobjects/${encodeURIComponent(definition.type)}`} breadcrumb={{ icon: <Boxes className="size-4" />, label: t('mo.title'), to: '/content/metaobjects' }} title={title} subtitle={entry ? `${definition.name} · ${t('mo.updatedAt', { date: fmt.dateTime(entry.updatedAt) })}` : definition.name}
        actions={entry ? <>
          <Button loading={dup.isPending} onClick={() => dup.mutate()}>{t('mo.duplicate')}</Button>
          <Dropdown align="right" label={t('common.moreActions')} trigger={t('mo.otherActions')} chevron items={[
            ...(url && online?.enabled && (!publishable || form.status === 'ACTIVE') ? [{ key: 'view', label: t('pages.viewOnStore'), onSelect: () => window.open(url, '_blank', 'noopener') }] : []),
            { key: 'delete', label: t('common.delete'), danger: true, onSelect: () => setConfirm(true) },
          ]} />
        </> : undefined} />
      {banner && <div className="mb-4"><Banner>{banner}</Banner></div>}
      <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
        <Card>
          <div className="flex flex-col divide-y divide-line">
            {definition.fieldDefinitions.length === 0 && <p className="py-2 text-[13px] text-muted">{t('mo.noFields')}</p>}
            {definition.fieldDefinitions.map((f) => (
              <div key={f.key} className="grid gap-1 py-3 first:pt-0 last:pb-0 sm:grid-cols-[11rem_1fr] sm:gap-4" data-field={f.key}>
                <div className="flex items-start gap-1 pt-1 text-[13px]" title={f.description ?? undefined}>
                  <span>{f.name}{f.required && <span className="ml-0.5 font-semibold" aria-hidden>*</span>}</span>
                  {f.description && <Info className="mt-0.5 size-3.5 shrink-0 text-muted" aria-label={f.description} />}
                  {nameKey === f.key && <Badge tone="info">{t('mo.displayName')}</Badge>}
                </div>
                <div className="min-w-0">
                  <ValueInput spec={f} value={form.values[f.key] ?? ''} labels={labels} setLabels={setLabels} onChange={(v) => set({ values: { ...form.values, [f.key]: v } })} />
                  {errors[f.key] && <p role="alert" className="mt-1 text-xs text-critical">{errors[f.key]}</p>}
                </div>
              </div>
            ))}
          </div>
        </Card>
        <div className="flex flex-col gap-4">
          {publishable && (
            <Card title={t('field.status')}>
              <Select aria-label={t('field.status')} value={form.status} onChange={(e) => set({ status: e.target.value })}>
                <option value="ACTIVE">{t('mo.status.ACTIVE')}</option><option value="DRAFT">{t('mo.status.DRAFT')}</option>
              </Select>
              <p className="mt-1 text-xs text-muted">{t('mo.statusHelp')}</p>
            </Card>
          )}
          <Card title={definition.name} actions={entry && (
            <Dropdown align="right" label={t('common.moreActions')} trigger={<MoreHorizontal className="size-4" />} items={[
              { key: 'def', label: t('mo.goToDefinition'), onSelect: () => nav(`/settings/metafields/metaobjects/${gidToNum(definition.id)}`) },
              { key: 'all', label: t('mo.viewAllEntries'), onSelect: () => nav(`/content/metaobjects/${encodeURIComponent(definition.type)}`) },
            ]} />
          )}>
            <p className="text-[13px] text-muted">{entry ? t('mo.addedByStaff') : t('mo.newOfType', { type: definition.type })}</p>
          </Card>
          <Card title={t('mo.anchor')}>
            <div className="flex items-end gap-2">
              <Input label={t('mo.handle')} className="flex-1" value={form.handle} placeholder={entry ? undefined : t('mo.handleAuto')} onChange={(e) => set({ handle: e.target.value.toLowerCase() })} help={t('mo.handleHelp')} />
              {entry && <Button icon aria-label={t('mo.copyHandle')} onClick={() => { void navigator.clipboard?.writeText(form.handle).then(() => toast(t('mo.copied'))); }}><Copy className="size-4" /></Button>}
            </div>
            <Input className="mt-3" label={t('bc.mo.externalId')} help={t('bc.mo.externalIdHelp')} value={form.externalId} onChange={(e) => set({ externalId: e.target.value })} />
            {entry && online?.enabled && form.handle !== initial.handle && <label className="mt-2 flex items-center gap-2 text-[13px]"><input type="checkbox" checked={form.redirect} onChange={(e) => set({ redirect: e.target.checked })} />{t('mo.redirectHandle')}</label>}
          </Card>
          {online?.enabled && (
            <Card title={t('mo.onlineStore')}>
              <Input label={t('mo.templateSuffix')} help={t('mo.templateHelp', { type: definition.type })} value={form.templateSuffix} onChange={(e) => set({ templateSuffix: e.target.value })} />
              {url && <p className="mt-2 break-all font-mono text-xs text-muted">{url}</p>}
            </Card>
          )}
          {entry && entry.referencedBy.nodes.length > 0 && (
            <Card title={t('mo.referencedBy')}>
              <ul className="flex flex-col gap-1 text-[13px]">
                {entry.referencedBy.nodes.map((r, i) => {
                  const name = r.referencer.displayName ?? r.referencer.title ?? r.referencer.id;
                  const to = r.referencer.__typename === 'Product' ? `/products/${gidToNum(r.referencer.id)}` : r.referencer.__typename === 'Collection' ? `/collections/${gidToNum(r.referencer.id)}` : r.referencer.__typename === 'Page' ? `/online-store/pages/${gidToNum(r.referencer.id)}` : null;
                  return <li key={i} className="flex justify-between gap-2"><span className="truncate">{to ? <Link to={to} className="hover:underline">{name}</Link> : name}</span><span className="shrink-0 text-muted">{r.name}</span></li>;
                })}
              </ul>
            </Card>
          )}
        </div>
      </div>
      <ConfirmDialog open={confirm} onClose={() => setConfirm(false)} danger title={t('mo.deleteEntryTitle')} message={t('mo.deleteEntryBody')} confirmLabel={t('common.delete')} cancelLabel={t('common.cancel')} loading={del.isPending} onConfirm={() => del.mutate()} />
    </>
  );
}
