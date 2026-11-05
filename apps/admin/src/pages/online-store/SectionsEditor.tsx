import { Banner, Button, Dropdown, Modal, Select, Skeleton, cx, useToast } from '@shopme/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, Eye, EyeOff, GripVertical, Monitor, Plus, Smartphone, Trash2, Undo2 } from 'lucide-react';
import { useMemo, useReducer, useState } from 'react';
import type { ReactNode } from 'react';
import { gql, mutate } from '../../api';
import { PageHeader } from '../../components/PageHeader';
import { SaveBar } from '../../components/SaveBar';
import { SettingField } from '../../components/SettingField';
import { gidToNum } from '../../format';
import { THEME_EDITOR_FILES, THEME_FILES_UPSERT, THEME_LOCALES, THEME_PREVIEW_HANDLES, THEME_SCHEMAS, THEME_TEMPLATE_NAMES } from '../../graphql';
import { useI18n } from '../../i18n';
import { coerceValue, parseDict, resolveLabel } from '../../lib/settings-schema';
import type { SettingDef } from '../../lib/settings-schema';
import { addableSections, allowedBlocks, blockOrder, blockSettings, historyReducer, indexSchemas, parseTemplate, serializeTemplate, templateReducer, uniqueId } from '../../lib/theme-template';
import type { Action, SchemaIndex, SectionInstance, Template } from '../../lib/theme-template';
import { fileText } from './ThemeEditor';
import type { FilesRes } from './ThemeEditor';

type Docs = Record<string, Template>;
interface DocAction { file: string; action: Action }
const docsReducer = (d: Docs, { file, action }: DocAction): Docs => {
  const t = d[file];
  const n = t && templateReducer(t, action);
  return n && n !== t ? { ...d, [file]: n } : d;
};
const historyDocs = historyReducer(docsReducer);
interface Sel { file: string; section: string; block?: string }

const isField = (s: SettingDef): s is SettingDef & { id: string } => !!s.id;
const nodes = (r?: FilesRes) => (r?.theme?.files.nodes ?? []).map((n) => ({ filename: n.filename, content: n.body?.content }));
const baseName = (f: string) => f.replace(/^.*\//, '').replace(/\.(json|liquid)$/, '');

/** Storefront path previewed for a template (alternates such as `page.contact` use their base type). */
export function previewPath(template: string, h: { product?: string; collection?: string; page?: string }): string {
  switch (template.split('.')[0]) {
    case 'product': return h.product ? `/products/${h.product}` : '/';
    case 'collection': return `/collections/${h.collection ?? 'all'}`;
    case 'list-collections': return '/collections';
    case 'page': return h.page ? `/pages/${h.page}` : '/';
    case 'cart': return '/cart';
    case 'search': return '/search?q=a';
    case '404': return '/404-preview-not-found';
    default: return '/';
  }
}

export function SectionsEditor({ themeId, name, tabs, localesData }: { themeId: string; name: string; tabs: ReactNode; localesData?: FilesRes }) {
  const { t } = useI18n();
  const [template, setTemplate] = useState('index');
  const names = useQuery({ queryKey: ['theme-templates', themeId], queryFn: () => gql<FilesRes>(THEME_TEMPLATE_NAMES, { id: themeId }) });
  const schemas = useQuery({ queryKey: ['theme-schemas', themeId], queryFn: () => gql<FilesRes>(THEME_SCHEMAS, { id: themeId }), staleTime: 60_000 });
  const loc = useQuery({ queryKey: ['theme-locales', themeId], queryFn: () => gql<FilesRes>(THEME_LOCALES, { id: themeId }), retry: false, initialData: localesData });
  const files = useQuery({ queryKey: ['theme-editor-files', themeId, template], queryFn: () => gql<FilesRes>(THEME_EDITOR_FILES, { id: themeId, filenames: [`templates/${template}.json`, 'sections/*.json'] }) });
  const handles = useQuery({ queryKey: ['theme-preview-handles'], retry: false, staleTime: 60_000, queryFn: () => gql<{ products: { nodes: Array<{ handle: string }> }; collections: { nodes: Array<{ handle: string }> }; pages: { nodes: Array<{ handle: string }> } }>(THEME_PREVIEW_HANDLES) });

  const templateNames = useMemo(() => (names.data?.theme?.files.nodes ?? []).map((n) => /^templates\/([^/]+)\.json$/.exec(n.filename)?.[1]).filter((x): x is string => !!x), [names.data]);
  const idx = useMemo(() => indexSchemas(nodes(schemas.data)), [schemas.data]);
  const dict = useMemo(() => parseDict(fileText(loc.data, 'locales/en.default.schema.json')), [loc.data]);

  if (files.isLoading || schemas.isLoading) return <div className="grid gap-4"><Skeleton className="h-8 w-64" /><Skeleton className="h-96" /></div>;
  const err = files.error ?? schemas.error ?? names.error;
  const parsed: Docs = {};
  for (const f of nodes(files.data)) { const d = parseTemplate(f.content); if (d) parsed[f.filename] = d; }
  const h = { product: handles.data?.products.nodes[0]?.handle, collection: handles.data?.collections.nodes[0]?.handle, page: handles.data?.pages.nodes[0]?.handle };
  return (
    <Inner key={`${template}:${files.dataUpdatedAt}`} themeId={themeId} name={name} tabs={tabs} template={template} templates={templateNames.length ? templateNames : ['index']} onTemplate={setTemplate}
      initial={parsed} idx={idx} dict={dict} error={err?.message ?? (parsed[`templates/${template}.json`] ? null : t('editor.templateMissing'))} previewUrl={previewPath(template, h)} />
  );
}

function Inner({ themeId, name, tabs, template, templates, onTemplate, initial, idx, dict, error: loadError, previewUrl }: {
  themeId: string; name: string; tabs: ReactNode; template: string; templates: string[]; onTemplate: (t: string) => void; initial: Docs; idx: SchemaIndex; dict: unknown;
  error: string | null; previewUrl: string;
}) {
  const { t } = useI18n();
  const toast = useToast();
  const qc = useQueryClient();
  const [base, setBase] = useState(initial);
  const [hist, dispatch] = useReducer(historyDocs, { past: [], present: initial });
  const docs = hist.present;
  const [sel, setSel] = useState<Sel | null>(null);
  const [adding, setAdding] = useState<string | null>(null);
  const [device, setDevice] = useState<'desktop' | 'mobile'>('desktop');
  const [reload, setReload] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [drag, setDrag] = useState<{ file: string; id: string } | null>(null);
  const label = (l?: string) => resolveLabel(l, dict);
  const tplFile = `templates/${template}.json`;
  const keys = Object.keys(docs).sort();
  const ordered = [...keys.filter((f) => f !== tplFile && /header/.test(f)), ...(docs[tplFile] ? [tplFile] : []), ...keys.filter((f) => f !== tplFile && !/header/.test(f))];
  const changed = Object.keys(docs).filter((f) => JSON.stringify(docs[f]) !== JSON.stringify(base[f]));
  const edit = (file: string, action: Action) => dispatch({ kind: 'do', action: { file, action } });

  const save = useMutation({
    mutationFn: () => mutate(THEME_FILES_UPSERT, { themeId, files: changed.map((f) => ({ filename: f, body: { type: 'TEXT', value: serializeTemplate(docs[f]!) } })) }, 'themeFilesUpsert'),
    onSuccess: () => { toast(t('themes.saved')); setBase(docs); setError(null); setReload((n) => n + 1); void qc.invalidateQueries({ queryKey: ['theme-editor-files'] }); },
    onError: (e) => setError(e.message),
  });
  const sectionTitle = (s: SectionInstance) => label(s.name) || label(idx.sections[s.type]?.name) || s.type;
  const current = sel && docs[sel.file]?.sections[sel.section];
  const secSchema = current ? idx.sections[current.type] : undefined;
  const block = sel?.block ? current?.blocks?.[sel.block] : undefined;
  const defs = (block && sel?.block ? blockSettings(secSchema, block.type, idx) : secSchema?.settings ?? []);
  const values = (block ?? current)?.settings ?? {};
  const fileLabel = (f: string) => (f === tplFile ? t('editor.templateSections', { name: template }) : label(`t:${baseName(f).replace(/-group$/, '')}`).replace(/^./, (c) => c.toUpperCase()));
  const sectionPicker = adding ? addableSections(idx) : [];
  const url = `${previewUrl}${previewUrl.includes('?') ? '&' : '?'}preview_theme_id=${gidToNum(themeId)}&_=${reload}`;

  const addSection = (file: string, type: string, presetIndex: number) => {
    const preset = idx.sections[type]?.presets?.[presetIndex];
    const id = uniqueId(type, Object.keys(docs[file]?.sections ?? {}));
    edit(file, { kind: 'addSection', type, preset, id });
    setSel({ file, section: id }); setAdding(null);
  };

  return (
    <>
      <SaveBar dirty={changed.length > 0} saving={save.isPending} onSave={() => save.mutate()} onDiscard={() => { dispatch({ kind: 'reset', to: base }); setSel(null); }} />
      <PageHeader back="/online-store" title={t('themes.customizeTitle', { name })}
        actions={<>
          <Select aria-label={t('editor.template')} value={template} onChange={(e) => { setSel(null); onTemplate(e.target.value); }}>{templates.map((x) => <option key={x} value={x}>{x}</option>)}</Select>
          <Button aria-label={t('editor.undo')} disabled={!hist.past.length} onClick={() => dispatch({ kind: 'undo' })}><Undo2 className="size-4" />{t('editor.undo')}</Button>
          <div className="flex rounded-md border border-line" role="group" aria-label={t('themes.device')}>
            {([['desktop', Monitor], ['mobile', Smartphone]] as const).map(([d, Icon]) => (
              <button key={d} type="button" aria-pressed={device === d} aria-label={t(`themes.${d}`)} onClick={() => setDevice(d)} className={cx('p-2', device === d ? 'bg-primary-subtle text-accent' : 'text-muted')}><Icon className="size-4" /></button>
            ))}
          </div>
        </>} />
      {tabs}
      {(error ?? loadError) && <div className="mb-4"><Banner>{error ?? loadError}</Banner></div>}
      <div className="grid gap-4 lg:grid-cols-[22rem_1fr]">
        <div className="flex flex-col gap-3 lg:max-h-[calc(100vh-11rem)] lg:overflow-y-auto">
          {ordered.map((file) => {
            const doc = docs[file]!;
            return (
              <section key={file} className="rounded-lg border border-line bg-canvas" aria-label={fileLabel(file)}>
                <h2 className="flex items-center border-b border-line px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted">{fileLabel(file)}</h2>
                <ul className="p-1">
                  {doc.order.map((id, i) => {
                    const s = doc.sections[id]!;
                    const selected = sel?.file === file && sel.section === id && !sel.block;
                    const schema = idx.sections[s.type];
                    const order = blockOrder(s);
                    const types = allowedBlocks(schema, idx);
                    const full = schema?.max_blocks !== undefined && order.length >= schema.max_blocks;
                    return (
                      <li key={id} draggable onDragStart={() => setDrag({ file, id })} onDragEnd={() => setDrag(null)} onDragOver={(e) => drag?.file === file && e.preventDefault()}
                        onDrop={() => { if (drag?.file === file && drag.id !== id) edit(file, { kind: 'moveSection', id: drag.id, to: i }); setDrag(null); }}>
                        <Row selected={selected} dim={!!s.disabled} onSelect={() => setSel({ file, section: id })} grip
                          title={sectionTitle(s)} hidden={!!s.disabled} labels={{ up: t('editor.moveUp'), down: t('editor.moveDown'), show: t('editor.show'), hide: t('editor.hide'), remove: t('common.remove') }}
                          onUp={i > 0 ? () => edit(file, { kind: 'moveSection', id, to: i - 1 }) : undefined} onDown={i < doc.order.length - 1 ? () => edit(file, { kind: 'moveSection', id, to: i + 1 }) : undefined}
                          onToggle={() => edit(file, { kind: 'toggleSection', id })} onRemove={() => { edit(file, { kind: 'removeSection', id }); if (sel?.section === id) setSel(null); }} />
                        <ul className="ml-6 border-l border-line pl-1">
                          {order.map((bid, bi) => {
                            const b = s.blocks![bid]!;
                            const bsel = sel?.file === file && sel.section === id && sel.block === bid;
                            const bname = label(b.name) || label((schema?.blocks?.find((x) => x.type === b.type)?.name) ?? idx.blocks[b.type]?.name) || b.type;
                            return (
                              <li key={bid}>
                                <Row selected={bsel} dim={!!b.disabled} onSelect={() => setSel({ file, section: id, block: bid })} title={b.static ? `${bname} (${t('editor.static')})` : bname} hidden={!!b.disabled}
                                  labels={{ up: t('editor.moveUp'), down: t('editor.moveDown'), show: t('editor.show'), hide: t('editor.hide'), remove: t('common.remove') }}
                                  onUp={!b.static && bi > 0 ? () => edit(file, { kind: 'moveBlock', section: id, block: bid, to: bi - 1 }) : undefined}
                                  onDown={!b.static && bi < order.length - 1 ? () => edit(file, { kind: 'moveBlock', section: id, block: bid, to: bi + 1 }) : undefined}
                                  onToggle={() => edit(file, { kind: 'toggleBlock', section: id, block: bid })}
                                  onRemove={b.static ? undefined : () => { edit(file, { kind: 'removeBlock', section: id, block: bid }); if (bsel) setSel({ file, section: id }); }} />
                              </li>
                            );
                          })}
                          {types.length > 0 && (
                            <li className="px-2 py-1">
                              <Dropdown label={t('editor.addBlockTo', { name: sectionTitle(s) })} trigger={<><Plus className="size-3.5" />{t('editor.addBlock')}</>}
                                items={full ? [{ key: 'max', label: t('editor.maxBlocks', { n: schema!.max_blocks! }), disabled: true, onSelect: () => {} }] : types.map((b) => ({
                                  key: b.type, label: label(b.name) || b.type,
                                  disabled: b.limit !== undefined && order.filter((x) => s.blocks![x]!.type === b.type).length >= b.limit,
                                  onSelect: () => edit(file, { kind: 'addBlock', section: id, type: b.type, max: schema?.max_blocks, limit: b.limit }),
                                }))} />
                            </li>
                          )}
                        </ul>
                      </li>
                    );
                  })}
                </ul>
                <div className="border-t border-line p-2"><Button size="sm" onClick={() => setAdding(file)}><Plus className="size-4" />{t('editor.addSection')}</Button></div>
              </section>
            );
          })}
          {sel && current && (
            <section className="rounded-lg border border-accent bg-canvas" aria-label={t('editor.settings')}>
              <h2 className="border-b border-line px-3 py-2 text-[13px] font-semibold">{block ? label(idx.blocks[block.type]?.name) || block.type : sectionTitle(current)}</h2>
              <div className="flex flex-col gap-3 p-3">
                {!defs.length && <p className="text-[13px] text-muted">{t('editor.noSettings')}</p>}
                {defs.map((d, i) => isField(d)
                  ? <SettingField key={`${sel.section}:${sel.block ?? ''}:${d.id}`} def={d} label={label(d.label)} info={d.info ? label(d.info) : undefined} optionLabel={label}
                    value={coerceValue(d, values[d.id])} onChange={(v) => edit(sel.file, { kind: 'setSetting', id: sel.section, block: sel.block, key: d.id, value: v })} />
                  : d.type === 'header' ? <h3 key={i} className="text-[13px] font-semibold">{label(d.content)}</h3>
                    : d.type === 'paragraph' ? <p key={i} className="text-xs text-muted">{label(d.content)}</p> : null)}
              </div>
            </section>
          )}
        </div>
        <div className="flex justify-center rounded-lg border border-line bg-surface p-2">
          <iframe key={`${reload}:${template}`} title={t('themes.preview')} src={url} className={cx('h-[70vh] rounded-md border border-line bg-white', device === 'mobile' ? 'w-[390px]' : 'w-full')} />
        </div>
      </div>
      <Modal open={!!adding} onClose={() => setAdding(null)} closeLabel={t('common.close')} title={t('editor.addSection')} wide>
        {sectionPicker.length === 0 ? <p className="text-[13px] text-muted">{t('editor.noPresets')}</p> : (
          <ul className="grid gap-2 sm:grid-cols-2">
            {sectionPicker.flatMap((s) => s.presets.map((p, pi) => (
              <li key={`${s.type}:${pi}`}><button type="button" className="w-full rounded-md border border-line p-3 text-left hover:bg-surface" onClick={() => adding && addSection(adding, s.type, pi)}>
                <span className="block text-[13px] font-medium">{label(p.name) || label(s.name)}</span><span className="block text-xs text-muted">{s.type}</span></button></li>
            )))}
          </ul>
        )}
      </Modal>
    </>
  );
}

function Row({ title, selected, dim, hidden, grip, labels, onSelect, onUp, onDown, onToggle, onRemove }: {
  title: string; selected: boolean; dim: boolean; hidden: boolean; grip?: boolean; labels: Record<'up' | 'down' | 'show' | 'hide' | 'remove', string>;
  onSelect: () => void; onUp?: () => void; onDown?: () => void; onToggle: () => void; onRemove?: () => void;
}) {
  const btn = 'rounded p-1 text-muted hover:bg-surface hover:text-fg disabled:opacity-30';
  return (
    <div className={cx('group flex items-center gap-0.5 rounded-md px-1', selected ? 'bg-primary-subtle' : 'hover:bg-surface')}>
      {grip && <GripVertical className="size-3.5 shrink-0 cursor-grab text-muted" aria-hidden />}
      <button type="button" onClick={onSelect} aria-current={selected} className={cx('min-w-0 flex-1 truncate py-1.5 pl-1 text-left text-[13px]', dim && 'text-muted line-through decoration-1', selected && 'font-medium text-accent')}>{title}</button>
      <button type="button" className={btn} aria-label={`${labels.up}: ${title}`} disabled={!onUp} onClick={onUp}><ArrowUp className="size-3.5" /></button>
      <button type="button" className={btn} aria-label={`${labels.down}: ${title}`} disabled={!onDown} onClick={onDown}><ArrowDown className="size-3.5" /></button>
      <button type="button" className={btn} aria-label={`${hidden ? labels.show : labels.hide}: ${title}`} onClick={onToggle}>{hidden ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}</button>
      {onRemove && <button type="button" className={btn} aria-label={`${labels.remove}: ${title}`} onClick={onRemove}><Trash2 className="size-3.5" /></button>}
    </div>
  );
}
