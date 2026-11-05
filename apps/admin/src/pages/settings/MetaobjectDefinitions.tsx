import { Banner, Button, Card, Checkbox, ConfirmDialog, Dropdown, EmptyState, Input, Select, Skeleton, Switch, Textarea, useToast } from '@shopme/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Boxes, ChevronDown, ChevronUp, GripVertical, Plus, Trash2 } from 'lucide-react';
import { useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { UserErrors, gql, mutate } from '../../api';
import { SaveBar, guard } from '../../components/SaveBar';
import { LinkRow, RowCard, SubHeader } from '../../components/SettingsKit';
import { gidToNum, numToGid } from '../../format';
import { METAOBJECT_DEFINITIONS, METAOBJECT_DEFINITION, METAOBJECT_DEFINITION_CREATE, METAOBJECT_DEFINITION_DELETE, METAOBJECT_DEFINITION_UPDATE } from '../../graphql';
import { useI18n } from '../../i18n';
import type { Key } from '../../i18n';
import { FIELD_TYPE_GROUPS, choicesToText, definitionIdsOf, draftOf, emptyField, fieldType, slugKey, textToChoices, validationInputs, validationSpecs } from '../../lib/metaobjects';
import type { FieldDraft } from '../../lib/metaobjects';

interface DefinitionRow { id: string; type: string; name: string; description: string | null; metaobjectsCount: number; fieldDefinitions: Array<{ key: string }> }
interface FieldDef { key: string; name: string; description: string | null; required: boolean; type: { name: string }; validations: Array<{ name: string; value: string | null }>; capabilities: { adminFilterable: { enabled: boolean } } }
interface DefinitionData {
  id: string; type: string; name: string; description: string | null; displayNameKey: string | null; metaobjectsCount: number;
  access: { admin: string; storefront: string; customerAccount: string };
  capabilities: { publishable: { enabled: boolean }; translatable: { enabled: boolean }; onlineStore: { enabled: boolean; data: { urlHandle: string; canCreateRedirects: boolean } | null } | null };
  fieldDefinitions: FieldDef[];
}

/** Settings > Custom data > Metaobjects: the definitions of the shop. */
export function MetaobjectDefinitionsPage() {
  const { t } = useI18n();
  const q = useQuery({ queryKey: ['mo-definitions', ''], queryFn: async () => (await gql<{ metaobjectDefinitions: { nodes: DefinitionRow[] } }>(METAOBJECT_DEFINITIONS)).metaobjectDefinitions.nodes });
  const add = <Link to="/settings/metafields/metaobjects/new" className="btn btn-primary">{t("mo.addDefinition")}</Link>;
  return (
    <>
      <SubHeader back="/settings/metafields" parent={t('settings.metafields')} title={t('mo.title')} actions={add} />
      {q.error && <Banner>{(q.error as Error).message}</Banner>}
      {q.isLoading && <Skeleton className="h-24" />}
      {q.data && q.data.length === 0 && <EmptyState icon={<Boxes className="size-10" />} title={t('mo.emptyTitle')} description={t('mo.emptyBody')} />}
      {!!q.data?.length && (
        <RowCard>
          {q.data.map((d) => <LinkRow key={d.id} to={`/settings/metafields/metaobjects/${gidToNum(d.id)}`} icon={Boxes} title={d.name} description={`${d.type} · ${t('mo.fieldsCount', { n: d.fieldDefinitions.length, $count: d.fieldDefinitions.length })}`} trailing={t('mo.entriesCount', { n: d.metaobjectsCount, $count: d.metaobjectsCount })} />)}
        </RowCard>
      )}
    </>
  );
}

interface Form {
  name: string; type: string; typeTouched: boolean; editType: boolean; description: string; showDescription: boolean; fields: FieldDraft[];
  publishable: boolean; translatable: boolean; online: boolean; urlHandle: string; urlTouched: boolean; createRedirects: boolean; storefront: boolean; customerAccount: boolean; displayNameKey: string;
}

let uidCounter = 0;
const uid = () => `f${++uidCounter}`;

function formOf(d: DefinitionData | null): Form {
  if (!d) return { name: '', type: '', typeTouched: false, editType: false, description: '', showDescription: false, fields: [{ ...emptyField(uid()), base: 'single_line_text_field' }], publishable: true, translatable: true, online: false, urlHandle: '', urlTouched: false, createRedirects: false, storefront: true, customerAccount: false, displayNameKey: '' };
  return {
    name: d.name, type: d.type, typeTouched: true, editType: false, description: d.description ?? '', showDescription: !!d.description, fields: d.fieldDefinitions.map((f) => draftOf(f, uid())),
    publishable: d.capabilities.publishable.enabled, translatable: d.capabilities.translatable.enabled, online: !!d.capabilities.onlineStore?.enabled, urlHandle: d.capabilities.onlineStore?.data?.urlHandle ?? '', urlTouched: true,
    createRedirects: !!d.capabilities.onlineStore?.data?.canCreateRedirects, storefront: d.access.storefront === 'PUBLIC_READ', customerAccount: d.access.customerAccount === 'READ', displayNameKey: d.displayNameKey ?? '',
  };
}

/** Definition editor (create and edit). */
export function MetaobjectDefinitionEditPage() {
  const { id = 'new' } = useParams();
  const isNew = id === 'new';
  const { t } = useI18n();
  const gid = numToGid('MetaobjectDefinition', id);
  const q = useQuery({ queryKey: ['mo-definition', gid], enabled: !isNew, queryFn: async () => (await gql<{ metaobjectDefinition: DefinitionData | null }>(METAOBJECT_DEFINITION, { id: gid })).metaobjectDefinition });
  if (!isNew && q.isLoading) return <Skeleton className="h-64" />;
  if (q.error) return <Banner>{(q.error as Error).message}</Banner>;
  if (!isNew && !q.data) return <Banner>{t('mo.definitionNotFound')}</Banner>;
  return <DefinitionForm key={`${id}:${q.dataUpdatedAt}`} def={q.data ?? null} />;
}

function typeOptions(t: (k: Key) => string) {
  return FIELD_TYPE_GROUPS.map((g) => <optgroup key={g.label} label={t(g.label)}>{g.types.map((x) => <option key={x} value={x}>{t(`mo.type.${x}` as Key)}</option>)}</optgroup>);
}

function FieldRow({ f, index, count, set, remove, move, definitions, error, dragging, onDragStart, onDrop }: {
  f: FieldDraft; index: number; count: number; set: (p: Partial<FieldDraft>) => void; remove: () => void; move: (to: number) => void; definitions: Array<{ id: string; name: string; type: string }>;
  error?: string; dragging: boolean; onDragStart: () => void; onDrop: () => void;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const specs = validationSpecs(fieldType(f));
  const val = (name: string) => f.validations[name] ?? '';
  const setVal = (name: string, v: string) => set({ validations: { ...f.validations, [name]: v } });
  return (
    <li className={`rounded-lg border border-line ${dragging ? 'opacity-50' : ''}`} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); onDrop(); }} data-field-row={f.key || index}>
      <div className="flex flex-wrap items-center gap-2 p-2">
        <button type="button" draggable aria-label={t('mo.moveField')} onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', f.uid); onDragStart(); }}
          onKeyDown={(e) => { if (e.key === 'ArrowUp') { e.preventDefault(); move(index - 1); } if (e.key === 'ArrowDown') { e.preventDefault(); move(index + 1); } }}
          className="cursor-grab rounded p-1 text-muted hover:text-fg"><GripVertical className="size-4" /></button>
        <div className="relative min-w-40 flex-1">
          <input aria-label={t('mo.fieldLabel')} placeholder={t('mo.fieldLabel')} className="field-control w-full pr-6" value={f.name}
            onChange={(e) => set({ name: e.target.value, ...(!f.existing && !f.keyTouched ? { key: slugKey(e.target.value) } : {}) })} />
          <span className="pointer-events-none absolute right-2 top-1.5 text-muted" aria-hidden>*</span>
        </div>
        <select aria-label={t('mo.cardinality')} className="field-control" value={f.list ? 'list' : 'one'} disabled={f.existing} onChange={(e) => set({ list: e.target.value === 'list' })}>
          <option value="one">{t('mo.one')}</option><option value="list">{t('mo.list')}</option>
        </select>
        <select aria-label={t('mo.fieldType')} className="field-control" value={f.base} disabled={f.existing} onChange={(e) => set({ base: e.target.value, validations: {} })}>{typeOptions(t)}</select>
        <Button size="sm" variant="plain" aria-expanded={open} aria-label={t('mo.fieldSettings')} onClick={() => setOpen(!open)}>{open ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}</Button>
        <Button size="sm" variant="plain" aria-label={t('common.delete')} onClick={remove} disabled={count <= 0}><Trash2 className="size-4" /></Button>
      </div>
      {error && <p role="alert" className="px-3 pb-2 text-xs text-critical">{error}</p>}
      {open && (
        <div className="grid gap-3 border-t border-line p-3 sm:grid-cols-2">
          <Input label={t('mo.fieldKey')} value={f.key} disabled={f.existing} help={f.existing ? t('mo.keyLocked') : undefined} onChange={(e) => set({ key: e.target.value, keyTouched: true })} />
          <div className="flex items-end"><Checkbox label={t('mo.required')} checked={f.required} onChange={(e) => set({ required: e.target.checked })} /></div>
          <Input label={t('mo.fieldDescription')} className="sm:col-span-2" value={f.description} onChange={(e) => set({ description: e.target.value })} />
          {specs.map((s) => {
            const label = t(s.label);
            switch (s.kind) {
              case 'choices': return <Textarea key={s.name} className="sm:col-span-2" label={label} help={t('mo.choicesHelp')} rows={3} value={choicesToText(val(s.name))} onChange={(e) => setVal(s.name, textToChoices(e.target.value))} />;
              case 'definition': return (
                <Select key={s.name} label={label} className="sm:col-span-2" value={val(s.name)} onChange={(e) => setVal(s.name, e.target.value)}>
                  <option value="">{t('mo.anyDefinition')}</option>{definitions.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                </Select>
              );
              case 'definitions': return (
                <fieldset key={s.name} className="sm:col-span-2"><legend className="mb-1 text-[13px] font-medium">{label}</legend>
                  <div className="flex flex-wrap gap-3">{definitions.map((d) => {
                    const ids = definitionIdsOf(val(s.name));
                    return <Checkbox key={d.id} label={d.name} checked={ids.includes(d.id)} onChange={(e) => { const n = e.target.checked ? [...ids, d.id] : ids.filter((x) => x !== d.id); setVal(s.name, n.length ? JSON.stringify(n) : ''); }} />;
                  })}</div></fieldset>
              );
              case 'fileTypes': return (
                <fieldset key={s.name} className="sm:col-span-2"><legend className="mb-1 text-[13px] font-medium">{label}</legend>
                  <div className="flex flex-wrap gap-3">{['Image', 'Video', 'GenericFile'].map((x) => {
                    const cur = definitionIdsOf(val(s.name));
                    return <Checkbox key={x} label={t(`mo.fileType.${x}` as Key)} checked={cur.includes(x)} onChange={(e) => { const n = e.target.checked ? [...cur, x] : cur.filter((y) => y !== x); setVal(s.name, n.length ? JSON.stringify(n) : ''); }} />;
                  })}</div></fieldset>
              );
              case 'date': return <Input key={s.name} label={label} type={f.base === 'date' ? 'date' : 'datetime-local'} value={val(s.name)} onChange={(e) => setVal(s.name, e.target.value)} />;
              case 'number': return <Input key={s.name} label={label} type="number" step="any" value={val(s.name)} onChange={(e) => setVal(s.name, e.target.value)} />;
              default: return <Input key={s.name} label={label} value={val(s.name)} onChange={(e) => setVal(s.name, e.target.value)} />;
            }
          })}
        </div>
      )}
    </li>
  );
}

function DefinitionForm({ def }: { def: DefinitionData | null }) {
  const { t } = useI18n();
  const nav = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();
  const initialRef = useRef(formOf(def));
  const initial = initialRef.current;
  const [form, setForm] = useState<Form>(initial);
  const [banner, setBanner] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [confirm, setConfirm] = useState(false);
  const [drag, setDrag] = useState<string | null>(null);
  const set = (p: Partial<Form>) => setForm((f) => ({ ...f, ...p }));
  const defs = useQuery({ queryKey: ['mo-definitions', ''], queryFn: async () => (await gql<{ metaobjectDefinitions: { nodes: DefinitionRow[] } }>(METAOBJECT_DEFINITIONS)).metaobjectDefinitions.nodes });
  const dirty = JSON.stringify(form) !== JSON.stringify(initial);
  const setField = (u: string, p: Partial<FieldDraft>) => setForm((f) => ({ ...f, fields: f.fields.map((x) => (x.uid === u ? { ...x, ...p } : x)) }));
  const move = (from: number, to: number) => setForm((f) => { if (to < 0 || to >= f.fields.length) return f; const n = [...f.fields]; const [x] = n.splice(from, 1); n.splice(to, 0, x!); return { ...f, fields: n }; });
  const textFields = form.fields.filter((f) => f.base === 'single_line_text_field' && !f.list && f.key);
  const canOnline = textFields.length > 0;

  const save = useMutation({
    mutationFn: async () => {
      setBanner(null); setErrors({});
      const fields = form.fields.filter((f) => f.name.trim() || f.key.trim());
      const fieldDef = (f: FieldDraft) => ({ key: f.key.trim() || slugKey(f.name), name: f.name.trim() || f.key, description: f.description.trim() || null, required: f.required, validations: validationInputs(f), capabilities: { adminFilterable: { enabled: f.filterable } } });
      const capabilities = {
        publishable: { enabled: form.publishable }, translatable: { enabled: form.translatable },
        ...(form.online ? { onlineStore: { enabled: true, data: { urlHandle: form.urlHandle.trim(), createRedirects: form.createRedirects } } } : def ? { onlineStore: { enabled: false } } : {}),
      };
      const access = { storefront: form.storefront ? 'PUBLIC_READ' : 'NONE', customerAccount: form.customerAccount ? 'READ' : 'NONE' };
      if (def) {
        const kept = new Set(fields.filter((f) => f.existing).map((f) => f.key));
        const ops = [
          ...def.fieldDefinitions.filter((d) => !kept.has(d.key)).map((d) => ({ delete: { key: d.key } })),
          ...fields.map((f) => (f.existing ? { update: (({ key, name, description, required, validations, capabilities: c }) => ({ key, name, description, required, validations, capabilities: c }))(fieldDef(f)) } : { create: { ...fieldDef(f), type: fieldType(f) } })),
        ];
        await mutate(METAOBJECT_DEFINITION_UPDATE, { id: def.id, definition: { name: form.name.trim(), description: form.description.trim() || null, fieldDefinitions: ops, resetFieldOrder: true, displayNameKey: form.displayNameKey || null, access, capabilities } }, 'metaobjectDefinitionUpdate');
        return def.id;
      }
      const r = await mutate<{ metaobjectDefinition: { id: string } }>(METAOBJECT_DEFINITION_CREATE, { definition: {
        type: form.type.trim(), name: form.name.trim(), description: form.description.trim() || null, displayNameKey: form.displayNameKey || null, access, capabilities,
        fieldDefinitions: fields.map((f) => ({ ...fieldDef(f), type: fieldType(f) })),
      } }, 'metaobjectDefinitionCreate');
      return r.metaobjectDefinition.id;
    },
    onSuccess: (id) => {
      toast(t('mo.definitionSaved'));
      for (const k of ['mo-definitions', 'mo-definition', 'mo-definition-type', 'mo-summary']) void qc.invalidateQueries({ queryKey: [k] });
      if (!def) { guard.off = true; nav(`/settings/metafields/metaobjects/${gidToNum(id)}`, { replace: true }); }
    },
    onError: (e) => {
      if (!(e instanceof UserErrors)) { setBanner(e.message); return; }
      const byKey: Record<string, string> = {};
      const rest: string[] = [];
      for (const err of e.errors as Array<{ message: string; elementKey?: string | null }>) { if (err.elementKey) byKey[err.elementKey] = err.message; else rest.push(err.message); }
      setErrors(byKey);
      if (rest.length) setBanner(rest.join(' · '));
    },
  });
  const del = useMutation({
    mutationFn: () => mutate(METAOBJECT_DEFINITION_DELETE, { id: def!.id }, 'metaobjectDefinitionDelete'),
    onSuccess: () => { for (const k of ['mo-definitions', 'mo-summary', 'mo-entries']) void qc.invalidateQueries({ queryKey: [k] }); guard.off = true; nav('/settings/metafields/metaobjects'); },
    onError: (e) => { setConfirm(false); setBanner(e.message); },
  });

  const valid = form.name.trim() && form.type.trim().length >= 3 && form.fields.some((f) => f.name.trim() && f.base);
  return (
    <>
      <SaveBar dirty={dirty} saving={save.isPending} onSave={() => save.mutate()} onDiscard={() => { setForm(initial); setBanner(null); setErrors({}); }} />
      <SubHeader back="/settings/metafields/metaobjects" parent={t('settings.metafields')} title={def ? def.name : t('mo.addDefinitionTitle')}
        actions={def ? <>
          <Button onClick={() => nav(`/content/metaobjects/${encodeURIComponent(def.type)}`)}>{t('mo.viewEntries')}</Button>
          <Dropdown align="right" label={t('common.moreActions')} trigger={t('common.moreActions')} chevron items={[{ key: 'delete', label: t('mo.deleteDefinition'), danger: true, onSelect: () => setConfirm(true) }]} />
        </> : undefined} />
      <div className="mx-auto flex max-w-3xl flex-col gap-5">
        {banner && <Banner>{banner}</Banner>}
        <Card>
          <div className="flex flex-col gap-2">
            <Input label={t('mo.name')} placeholder={t('mo.namePlaceholder')} value={form.name} onChange={(e) => set({ name: e.target.value, ...(!form.typeTouched && !def ? { type: slugKey(e.target.value), urlHandle: form.urlTouched ? form.urlHandle : slugKey(e.target.value).replace(/_/g, '-') } : {}) })} />
            <div className="flex items-center gap-2 text-[13px] text-muted">
              <span>{t('mo.type')}</span>
              {form.editType && !def ? <input aria-label={t('mo.type')} className="field-control" value={form.type} onChange={(e) => set({ type: e.target.value, typeTouched: true })} /> : <span className="font-mono text-fg">{form.type}</span>}
              {!def && form.name && !form.editType && <button type="button" className="text-accent hover:underline" onClick={() => set({ editType: true })}>{t('mo.editType')}</button>}
            </div>
            {form.showDescription || form.description
              ? <Textarea label={t('mo.descriptionLabel')} rows={2} value={form.description} onChange={(e) => set({ description: e.target.value })} />
              : <div><Button size="sm" variant="plain" onClick={() => set({ showDescription: true })}>{t('mo.addDescription')}</Button></div>}
          </div>
        </Card>

        <section aria-labelledby="mo-fields" className="flex flex-col gap-2">
          <h2 id="mo-fields" className="text-sm font-semibold">{t('mo.fields')}</h2>
          <Card>
            <ul className="flex flex-col gap-2">
              {form.fields.map((f, i) => (
                <FieldRow key={f.uid} f={f} index={i} count={form.fields.length} definitions={(defs.data ?? []).filter((d) => d.id !== def?.id).map((d) => ({ id: d.id, name: d.name, type: d.type }))}
                  set={(p) => setField(f.uid, p)} move={(to) => move(i, to)} remove={() => set({ fields: form.fields.filter((x) => x.uid !== f.uid), displayNameKey: form.displayNameKey === f.key ? '' : form.displayNameKey })}
                  error={errors[f.key]} dragging={drag === f.uid} onDragStart={() => setDrag(f.uid)} onDrop={() => { if (drag) { const from = form.fields.findIndex((x) => x.uid === drag); move(from, i); } setDrag(null); }} />
              ))}
            </ul>
            <div className="mt-2"><Button size="sm" variant="plain" onClick={() => set({ fields: [...form.fields, emptyField(uid())] })}><Plus className="size-4" />{t('mo.addField')}</Button></div>
          </Card>
        </section>

        <section aria-labelledby="mo-options" className="flex flex-col gap-2">
          <h2 id="mo-options" className="text-sm font-semibold">{t('mo.options')}</h2>
          <div className="divide-y divide-line rounded-lg bg-canvas px-4 shadow-card [&>div]:py-3">
            <div className="flex items-center justify-between"><span className="text-[13px]">{t('mo.opt.status')}</span><Switch checked={form.publishable} onChange={(v) => set({ publishable: v })} label={<span className="sr-only">{t('mo.opt.status')}</span>} /></div>
            <div className="flex items-center justify-between"><span className="text-[13px]">{t('mo.opt.translations')}</span><Switch checked={form.translatable} onChange={(v) => set({ translatable: v })} label={<span className="sr-only">{t('mo.opt.translations')}</span>} /></div>
            <div>
              <div className="flex items-center justify-between"><span className="text-[13px]">{t('mo.opt.web')}</span><Switch checked={form.online} onChange={(v) => set({ online: v })} label={<span className="sr-only">{t('mo.opt.web')}</span>} /></div>
              {!canOnline && !form.online && <p className="mt-1 text-xs text-muted">{t('mo.opt.webNeeds')}</p>}
              {form.online && (
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <Input label={t('mo.urlHandle')} help={t('mo.urlHandleHelp', { url: `/pages/${form.urlHandle || '…'}/<handle>` })} value={form.urlHandle} onChange={(e) => set({ urlHandle: e.target.value, urlTouched: true })} />
                  <div className="flex items-end"><Checkbox label={t('mo.createRedirects')} checked={form.createRedirects} onChange={(e) => set({ createRedirects: e.target.checked })} /></div>
                  <p className="text-xs text-muted sm:col-span-2">{t('mo.templateNote', { type: form.type || 'type' })}</p>
                </div>
              )}
            </div>
            <div className="flex items-center justify-between"><span className="text-[13px]">{t('mo.opt.storefront')}</span><Switch checked={form.storefront} onChange={(v) => set({ storefront: v })} label={<span className="sr-only">{t('mo.opt.storefront')}</span>} /></div>
            <div className="flex items-center justify-between"><span className="text-[13px]">{t('mo.opt.customer')}</span><Switch checked={form.customerAccount} onChange={(v) => set({ customerAccount: v })} label={<span className="sr-only">{t('mo.opt.customer')}</span>} /></div>
          </div>
        </section>

        <section aria-labelledby="mo-field-options" className="flex flex-col gap-2">
          <h2 id="mo-field-options" className="text-sm font-semibold">{t('mo.fieldOptions')}</h2>
          <div className="divide-y divide-line rounded-lg bg-canvas px-4 shadow-card [&>div]:py-3">
            <div className="flex items-center justify-between gap-3">
              <span className="text-[13px]">{t('mo.displayName')}</span>
              <select aria-label={t('mo.displayName')} className="field-control" value={form.displayNameKey} onChange={(e) => set({ displayNameKey: e.target.value })}>
                <option value="">{t('mo.autoGenerated')}</option>
                {textFields.map((f) => <option key={f.uid} value={f.key}>{f.name || f.key}</option>)}
              </select>
            </div>
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between gap-3">
                <span className="text-[13px]">{t('mo.filters')}</span>
                <select aria-label={t('mo.addFilterFields')} className="field-control" value="" disabled={!form.fields.some((f) => f.key && !f.filterable && !f.list && !f.base.endsWith('reference'))}
                  onChange={(e) => { const f = form.fields.find((x) => x.uid === e.target.value); if (f) setField(f.uid, { filterable: true }); }}>
                  <option value="">{t('mo.addFilterFields')}</option>
                  {form.fields.filter((f) => f.key && !f.filterable && !f.list && !f.base.endsWith('reference')).map((f) => <option key={f.uid} value={f.uid}>{f.name || f.key}</option>)}
                </select>
              </div>
              {form.fields.some((f) => f.filterable) && (
                <ul className="flex flex-wrap gap-1.5">
                  {form.fields.filter((f) => f.filterable).map((f) => <li key={f.uid} className="inline-flex items-center gap-1 rounded-full bg-surface py-0.5 pl-2.5 pr-1 text-[13px]">{f.name || f.key}<button type="button" aria-label={`${t('common.remove')} ${f.name || f.key}`} className="rounded-full p-0.5 text-muted hover:text-fg" onClick={() => setField(f.uid, { filterable: false })}>×</button></li>)}
                </ul>
              )}
            </div>
          </div>
        </section>
        {!def && <div><Button variant="primary" loading={save.isPending} disabled={!valid} onClick={() => save.mutate()}>{t('save.save')}</Button></div>}
      </div>
      <ConfirmDialog open={confirm} onClose={() => setConfirm(false)} danger title={t('mo.deleteDefinitionTitle', { name: def?.name ?? '' })} message={t('mo.deleteDefinitionBody', { n: def?.metaobjectsCount ?? 0, $count: def?.metaobjectsCount ?? 0 })}
        confirmLabel={t('common.delete')} cancelLabel={t('common.cancel')} loading={del.isPending} onConfirm={() => del.mutate()} />
    </>
  );
}

