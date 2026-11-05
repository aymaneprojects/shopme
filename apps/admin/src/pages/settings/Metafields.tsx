import { Badge, Banner, Button, Card, Checkbox, ConfirmDialog, EmptyState, Input, Modal, Select, Skeleton, Tabs, Textarea, useToast } from '@shopme/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Braces } from 'lucide-react';
import { useState } from 'react';
import { UserErrors, gql, mutate } from '../../api';
import { METAFIELD_DEFINITIONS, METAFIELD_DEFINITION_CREATE, METAFIELD_DEFINITION_DELETE, METAFIELD_DEFINITION_UPDATE } from '../../graphql';
import { useI18n } from '../../i18n';
import { BASE_TYPES, OWNER_TYPES, isList, typeLabelKey } from '../../lib/metafields';
import type { MetafieldDefinitionRow, MetafieldOwnerType } from '../../lib/metafields';

interface Form { name: string; namespace: string; key: string; description: string; base: string; list: boolean; pin: boolean }
const blank: Form = { name: '', namespace: 'custom', key: '', description: '', base: 'single_line_text_field', list: false, pin: false };
const slug = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');

export function MetafieldsSettings() {
  const { t } = useI18n();
  const toast = useToast();
  const qc = useQueryClient();
  const [owner, setOwner] = useState<MetafieldOwnerType>('PRODUCT');
  const q = useQuery({ queryKey: ['metafield-definitions', owner], queryFn: () => gql<{ metafieldDefinitions: { nodes: MetafieldDefinitionRow[] } }>(METAFIELD_DEFINITIONS, { ownerType: owner }) });
  const [editing, setEditing] = useState<{ def: MetafieldDefinitionRow | null; form: Form } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [remove, setRemove] = useState<{ def: MetafieldDefinitionRow; values: boolean } | null>(null);
  const refresh = () => void qc.invalidateQueries({ queryKey: ['metafield-definitions'] });

  const save = useMutation({
    mutationFn: () => {
      const { def, form } = editing!;
      return def
        ? mutate(METAFIELD_DEFINITION_UPDATE, { definition: { ownerType: owner, namespace: def.namespace, key: def.key, name: form.name.trim(), description: form.description || null, pin: form.pin } }, 'metafieldDefinitionUpdate')
        : mutate(METAFIELD_DEFINITION_CREATE, { definition: { ownerType: owner, namespace: form.namespace.trim() || 'custom', key: form.key.trim(), name: form.name.trim(), description: form.description || null, type: form.list ? `list.${form.base}` : form.base, pin: form.pin } }, 'metafieldDefinitionCreate');
    },
    onSuccess: () => { toast(t('mf.defSaved')); setEditing(null); setError(null); refresh(); },
    onError: (e) => setError(e instanceof UserErrors ? e.errors.map((x) => x.message).join(' · ') : e.message),
  });
  const del = useMutation({
    mutationFn: () => mutate(METAFIELD_DEFINITION_DELETE, { id: remove!.def.id, deleteAllAssociatedMetafields: remove!.values }, 'metafieldDefinitionDelete'),
    onSuccess: () => { toast(t('mf.defDeleted')); setRemove(null); refresh(); }, onError: (e) => toast(e.message, 'critical'),
  });

  const defs = q.data?.metafieldDefinitions.nodes ?? [];
  const f = editing?.form;
  const set = (p: Partial<Form>) => setEditing((e) => (e ? { ...e, form: { ...e.form, ...p } } : e));
  const open = (def: MetafieldDefinitionRow | null) => {
    setError(null);
    setEditing({ def, form: def ? { name: def.name, namespace: def.namespace, key: def.key, description: def.description ?? '', base: def.type.name.replace(/^list\./, ''), list: isList(def.type.name), pin: !!def.pinnedPosition } : blank });
  };

  return (
    <Card title={t('settings.metafields')} actions={<Button variant="primary" onClick={() => open(null)}>{t('mf.addDefinition')}</Button>}>
      <div className="flex flex-col gap-3">
        <p className="text-[13px] text-muted">{t('mf.intro')}</p>
        <Tabs tabs={OWNER_TYPES.map((o) => ({ id: o.id, label: t(o.label) }))} value={owner} onChange={setOwner} />
        {q.error && <Banner>{q.error.message}</Banner>}
        {q.isLoading && <Skeleton className="h-24" />}
        {q.data && defs.length === 0 && <EmptyState icon={<Braces className="size-10" />} title={t('mf.emptyTitle')} description={t('mf.emptyBody')} />}
        <ul className="divide-y divide-line">
          {defs.map((d) => (
            <li key={d.id} className="flex flex-wrap items-center gap-3 py-3 text-[13px]">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2"><span className="font-medium">{d.name}</span>{d.pinnedPosition ? <Badge tone="info">{t('mf.pinned')}</Badge> : null}</div>
                <p className="truncate font-mono text-xs text-muted">{d.namespace}.{d.key}</p>
                {d.description && <p className="text-muted">{d.description}</p>}
              </div>
              <span className="text-muted">{isList(d.type.name) ? t('mf.listOf', { type: t(typeLabelKey(d.type.name)) }) : t(typeLabelKey(d.type.name))}</span>
              <span className="text-xs text-muted">{t('mf.valuesCount', { n: d.metafieldsCount })}</span>
              <Button size="sm" onClick={() => open(d)}>{t('common.edit')}</Button>
              <Button size="sm" variant="danger" onClick={() => setRemove({ def: d, values: false })}>{t('common.delete')}</Button>
            </li>
          ))}
        </ul>
      </div>

      <Modal open={!!editing} onClose={() => setEditing(null)} closeLabel={t('common.close')} title={editing?.def ? t('mf.editDefinition') : t('mf.addDefinition')}
        footer={<><Button onClick={() => setEditing(null)}>{t('common.cancel')}</Button><Button variant="primary" loading={save.isPending} disabled={!f?.name.trim() || !f?.key.trim()} onClick={() => save.mutate()}>{t('save.save')}</Button></>}>
        {f && editing && (
          <div className="grid gap-3 sm:grid-cols-2">
            {error && <div className="sm:col-span-2"><Banner>{error}</Banner></div>}
            <Input label={t('mf.name')} className="sm:col-span-2" required value={f.name} onChange={(e) => set({ name: e.target.value, ...(!editing.def && (!f.key || f.key === slug(f.name)) ? { key: slug(e.target.value) } : {}) })} />
            <Input label={t('mf.namespace')} disabled={!!editing.def} value={f.namespace} onChange={(e) => set({ namespace: e.target.value })} />
            <Input label={t('mf.key')} disabled={!!editing.def} required value={f.key} onChange={(e) => set({ key: e.target.value })} />
            <Select label={t('mf.type')} disabled={!!editing.def} help={editing.def ? t('mf.typeLocked') : undefined} value={f.base} onChange={(e) => set({ base: e.target.value })}>
              {BASE_TYPES.map((x) => <option key={x} value={x}>{t(typeLabelKey(x))}</option>)}
            </Select>
            <div className="flex items-end"><Checkbox label={t('mf.listCheckbox')} disabled={!!editing.def} checked={f.list} onChange={(e) => set({ list: e.target.checked })} /></div>
            <Textarea label={t('mf.description')} className="sm:col-span-2" rows={2} value={f.description} onChange={(e) => set({ description: e.target.value })} />
            <div className="sm:col-span-2"><Checkbox label={t('mf.pin')} checked={f.pin} onChange={(e) => set({ pin: e.target.checked })} /></div>
          </div>
        )}
      </Modal>

      <ConfirmDialog open={!!remove} danger onClose={() => setRemove(null)} title={t('mf.deleteTitle', { name: remove?.def.name ?? '' })} confirmLabel={t('common.delete')} cancelLabel={t('common.cancel')} onConfirm={() => del.mutate()}
        message={remove && (
          <div className="flex flex-col gap-3">
            <p>{t('mf.deleteBody', { n: remove.def.metafieldsCount })}</p>
            <Checkbox label={t('mf.deleteValues')} checked={remove.values} onChange={(e) => setRemove({ ...remove, values: e.target.checked })} />
          </div>
        )} />
    </Card>
  );
}
