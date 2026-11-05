import { Badge, Banner, Button, ConfirmDialog, Input, Modal, Skeleton, cx, useToast } from '@shopme/ui';
import { useMutation, useQuery } from '@tanstack/react-query';
import { FileText, LayoutTemplate, LogOut, Minimize2, Monitor, MousePointerClick, PanelsTopLeft, Redo2, Settings, Smartphone, Tablet, Undo2 } from 'lucide-react';
import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { useBlocker, useNavigate, useParams, useSearchParams } from 'react-router';
import type { Key } from '../../i18n';
import { gql, mutate, rest } from '../../api';
import { gidToNum, numToGid } from '../../format';
import { THEME_EDITOR_FILES, THEME_FILES_UPSERT, THEME_LOCALES, THEME_PREVIEW_DATA, THEME_SCHEMAS, THEME_SETTINGS, THEME_TEMPLATE_NAMES } from '../../graphql';
import { useI18n } from '../../i18n';
import { changedDocs, changedSettings, emptySession, sessionReducer } from '../../lib/editor-session';
import { categoryOf } from '../../lib/section-categories';
import type { PickerItem } from '../../lib/section-categories';
import { buildValues, coerceValue, isInput, parseCurrent, parseDict, parseSchema, resolveLabel, serializeData } from '../../lib/settings-schema';
import type { SchemeSet, SettingDef, SettingValue } from '../../lib/settings-schema';
import { SchemesContext, SourcesContext } from '../../components/theme-fields/context';
import { addableSections, blockOrder, blockSettings, indexSchemas, parseTemplate, serializeTemplate, templateReducer, uniqueId } from '../../lib/theme-template';
import type { Action, SectionInstance, Template } from '../../lib/theme-template';
import { PreviewDataMenu } from './PreviewDataMenu';
import type { PreviewChoices, PreviewData } from './PreviewDataMenu';
import { PreviewFrame } from './PreviewFrame';
import type { Device, Target, ToolbarActions } from './PreviewFrame';
import { SectionPicker } from './SectionPicker';
import { SectionsTree, previewPath, templateForPath } from './SectionsEditor';
import type { Docs, Sel } from './SectionsEditor';
import { SettingsPanel } from './SettingsPanel';
import { ThemeSettingsPanel } from './ThemeSettingsPanel';
import { ThemeToolbar } from './ThemeToolbar';

export const fileText = (r: FilesRes | undefined, name: string) => r?.theme?.files.nodes.find((n) => n.filename === name)?.body?.content;
export const DATA_FILE = 'config/settings_data.json';
export interface FilesRes { theme: { id: string; name?: string; role?: string; files: { nodes: Array<{ filename: string; body: { content?: string } | null }> } } | null }

const nodes = (r?: FilesRes) => (r?.theme?.files.nodes ?? []).map((n) => ({ filename: n.filename, content: n.body?.content }));
const DEVICES = [['desktop', Monitor, 'themes.desktop'], ['tablet', Tablet, 'editor.tablet'], ['mobile', Smartphone, 'themes.mobile']] as const;
const EMPTY_TEMPLATE: Template = { sections: {}, order: [] };

export function ThemeEditorPage() {
  const { id = '' } = useParams();
  const { t } = useI18n();
  const gid = numToGid('OnlineStoreTheme', id);
  const q = useQuery({ queryKey: ['theme-settings', gid], queryFn: () => gql<FilesRes>(THEME_SETTINGS, { id: gid }) });
  const loc = useQuery({ queryKey: ['theme-locales', gid], queryFn: () => gql<FilesRes>(THEME_LOCALES, { id: gid }), retry: false });
  if (q.isLoading) return <div className="grid gap-4"><Skeleton className="h-8 w-64" /><Skeleton className="h-96" /></div>;
  if (q.error) return <Banner>{q.error.message}</Banner>;
  if (!q.data?.theme) return <Banner>{t('themes.notFound')}</Banner>;
  return <EditorShell key={gid} themeId={gid} name={q.data.theme.name ?? ''} role={q.data.theme.role} schemaJson={fileText(q.data, 'config/settings_schema.json') ?? '[]'} dataJson={fileText(q.data, DATA_FILE)} localesData={loc.data} />;
}

const withParams = (path: string, params: Record<string, string>) => {
  const u = new URL(path, 'http://x');
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  return `${u.pathname}${u.search}`;
};

interface SaveVars { docs: Docs; files: Array<{ filename: string; body: { type: 'TEXT'; value: string } }>; settings: Record<string, SettingValue>; data?: string }

/** The editor session: one history (undo/redo) over every template and the theme settings, one live preview, one save. */
function EditorShell({ themeId, name, role, schemaJson, dataJson, localesData }: { themeId: string; name: string; role?: string; schemaJson: string; dataJson: string | undefined; localesData: FilesRes | undefined }) {
  const { t, lang } = useI18n();
  const toast = useToast();
  const nav = useNavigate();
  const num = gidToNum(themeId);
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') === 'settings' ? 'settings' : 'sections';
  const setTab = (v: string) => setParams(v === 'settings' ? { tab: v } : {}, { replace: true });

  // ---- data
  const [template, setTemplate] = useState('index');
  const [frameTpl, setFrameTpl] = useState('index');
  const names = useQuery({ queryKey: ['theme-templates', themeId], queryFn: () => gql<FilesRes>(THEME_TEMPLATE_NAMES, { id: themeId }) });
  const schemas = useQuery({ queryKey: ['theme-schemas', themeId], queryFn: () => gql<FilesRes>(THEME_SCHEMAS, { id: themeId }), staleTime: 60_000 });
  const files = useQuery({ queryKey: ['theme-editor-files', themeId, template], queryFn: () => gql<FilesRes>(THEME_EDITOR_FILES, { id: themeId, filenames: [`templates/${template}.json`, 'sections/*.json'] }) });
  const pdata = useQuery({ queryKey: ['theme-preview-data'], retry: false, staleTime: 60_000, queryFn: () => gql<PreviewRes>(THEME_PREVIEW_DATA) });
  const [chosen, setChosen] = useState<PreviewData>(() => readChosen(num));
  const choices = useMemo(() => previewChoices(pdata.data), [pdata.data]);
  const templateNames = useMemo(() => (names.data?.theme?.files.nodes ?? []).map((n) => /^templates\/([^/]+)\.json$/.exec(n.filename)?.[1]).filter((x): x is string => !!x), [names.data]);
  const idx = useMemo(() => indexSchemas(nodes(schemas.data)), [schemas.data]);
  const dict = useMemo(() => parseDict(fileText(localesData, lang === 'fr' ? 'locales/fr.schema.json' : 'locales/en.default.schema.json') ?? fileText(localesData, 'locales/en.default.schema.json')), [localesData, lang]);
  const label = (l?: string) => resolveLabel(l, dict);
  const groups = useMemo(() => parseSchema(schemaJson), [schemaJson]);
  const info = useMemo(() => themeInfo(schemaJson), [schemaJson]);

  // ---- state: what the server has (first read of each file, then what this session saved), and the session's edits on top
  const loaded = useRef<Docs>({});
  for (const f of nodes(files.data)) if (!(f.filename in loaded.current)) { const d = parseTemplate(f.content); if (d) loaded.current[f.filename] = d; }
  const [saved, setSaved] = useState<Docs>({});
  const [baseSettings, setBaseSettings] = useState(() => buildValues(groups, parseCurrent(dataJson)));
  const [savedData, setSavedData] = useState(dataJson);
  const [hist, dispatch] = useReducer(sessionReducer, undefined, emptySession);
  const base = useMemo(() => ({ ...loaded.current, ...saved }), [files.data, saved]); // eslint-disable-line react-hooks/exhaustive-deps
  const docs = useMemo(() => ({ ...base, ...hist.present.docs }), [base, hist.present.docs]);
  const settings = useMemo(() => ({ ...baseSettings, ...hist.present.settings }), [baseSettings, hist.present.settings]);
  const changedFiles = useMemo(() => changedDocs(base, hist.present), [base, hist.present]);
  const changedKeys = useMemo(() => changedSettings(baseSettings, hist.present), [baseSettings, hist.present]);
  const dirty = changedFiles.length + changedKeys.length > 0;

  const [sel, setSel] = useState<Sel | null>(null);
  const [adding, setAdding] = useState<{ file: string; index?: number } | null>(null);
  const [hovered, setHovered] = useState<Sel | null>(null);
  const [clip, setClip] = useState<SectionInstance | null>(null);
  const [renaming, setRenaming] = useState<{ file: string; id: string; name: string } | null>(null);
  const [shortcuts, setShortcuts] = useState(false);
  const [device, setDevice] = useState<Device>('desktop');
  const [inspector, setInspector] = useState(true);
  const [full, setFull] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const tplFile = `templates/${template}.json`;
  const keys = Object.keys(docs).filter((f) => f === tplFile || /^sections\/.*\.json$/.test(f)).sort();
  const ordered = [...keys.filter((f) => f !== tplFile && /header/.test(f)), ...(docs[tplFile] ? [tplFile] : []), ...keys.filter((f) => f !== tplFile && !/header/.test(f))];

  const edit = (file: string, action: Action, tag?: string) => {
    const cur = docs[file];
    const next = cur && templateReducer(cur, action);
    if (cur && next && next !== cur) dispatch({ kind: 'doc', file, doc: next, at: Date.now(), tag });
  };
  const locate = (id: string): Sel | null => { const f = ordered.find((x) => docs[x]?.sections[id]); return f ? { file: f, section: id } : null; };
  const sectionTitle = (s: SectionInstance) => label(s.name) || label(idx.sections[s.type]?.name) || s.type;
  const blockTitle = (s: SectionInstance, bid: string) => {
    const b = s.blocks?.[bid];
    return b ? label(b.name) || label(idx.sections[s.type]?.blocks?.find((x) => x.type === b.type)?.name ?? idx.blocks[b.type]?.name) || b.type : bid;
  };
  const fileLabel = (f: string) => {
    if (f === tplFile) return t('editor.groupTemplate');
    const own = docs[f]?.name;
    if (typeof own === 'string' && own.trim()) return label(own);
    return label(`t:${f.replace(/^.*\//, '').replace(/\.json$/, '').replace(/-group$/, '')}`).replace(/^./, (c) => c.toUpperCase());
  };

  // ---- operations on sections and blocks (shared by the tree, the preview toolbar and the settings panel)
  const dropSel = (section: string, block?: string) => setSel((s) => (s && s.section === section && (!block || s.block === block) ? (block ? { file: s.file, section } : null) : s));
  const ops = {
    edit: (file: string, action: Action) => edit(file, action),
    duplicateSection: (file: string, id: string) => {
      const doc = docs[file]; const src = doc?.sections[id]; if (!doc || !src) return;
      const newId = uniqueId(src.type, Object.keys(doc.sections));
      edit(file, { kind: 'duplicateSection', id, newId });
      setSel({ file, section: newId });
    },
    removeSection: (file: string, id: string) => { edit(file, { kind: 'removeSection', id }); dropSel(id); },
    removeBlock: (file: string, section: string, block: string) => { edit(file, { kind: 'removeBlock', section, block }); dropSel(section, block); },
    add: (file: string, index?: number) => setAdding({ file, index }),
    copy: (file: string, id: string) => { const src = docs[file]?.sections[id]; if (src) { setClip(structuredClone(src)); toast(t('editor.copied')); } },
    paste: (file: string, index: number) => {
      const doc = docs[file]; if (!doc || !clip) return;
      const id = uniqueId(clip.type, Object.keys(doc.sections));
      edit(file, { kind: 'insertSection', id, instance: clip, index });
      setSel({ file, section: id });
    },
    rename: (file: string, id: string) => setRenaming({ file, id, name: docs[file]?.sections[id]?.name ?? '' }),
    editCode: (file: string, id: string) => { const type = docs[file]?.sections[id]?.type; if (type) nav(`/online-store/themes/${num}/code?file=${encodeURIComponent(`sections/${type}.liquid`)}`); },
    canPaste: !!clip,
  };
  const addSection = (file: string, type: string, presetIndex: number, index?: number) => {
    const preset = idx.sections[type]?.presets?.[presetIndex];
    const id = uniqueId(type, Object.keys(docs[file]?.sections ?? {}));
    edit(file, { kind: 'addSection', type, preset, id, index });
    setSel({ file, section: id }); setAdding(null); setTab('sections');
  };

  const current = sel && docs[sel.file]?.sections[sel.section];
  const block = sel?.block ? current?.blocks?.[sel.block] : undefined;
  const secSchema = current ? idx.sections[current.type] : undefined;
  const defs = block && sel?.block && current ? blockSettings(secSchema, block.type, idx) : secSchema?.settings ?? [];
  const selTarget: Target | null = sel && current ? { section: sel.section, block: block ? sel.block : undefined } : null;
  const selActions: ToolbarActions | null = (() => {
    if (!sel || !current) return null;
    const doc = docs[sel.file]!;
    if (sel.block && block) {
      const order = blockOrder(current); const bi = order.indexOf(sel.block);
      return {
        up: !block.static && bi > 0 ? () => edit(sel.file, { kind: 'moveBlock', section: sel.section, block: sel.block!, to: bi - 1 }) : undefined,
        down: !block.static && bi < order.length - 1 ? () => edit(sel.file, { kind: 'moveBlock', section: sel.section, block: sel.block!, to: bi + 1 }) : undefined,
        toggle: () => edit(sel.file, { kind: 'toggleBlock', section: sel.section, block: sel.block! }), hidden: !!block.disabled,
        remove: block.static ? undefined : () => ops.removeBlock(sel.file, sel.section, sel.block!),
        editCode: () => nav(`/online-store/themes/${num}/code?file=${encodeURIComponent(`blocks/${block.type}.liquid`)}`),
      };
    }
    const i = doc.order.indexOf(sel.section);
    return {
      up: i > 0 ? () => edit(sel.file, { kind: 'moveSection', id: sel.section, to: i - 1 }) : undefined,
      down: i < doc.order.length - 1 ? () => edit(sel.file, { kind: 'moveSection', id: sel.section, to: i + 1 }) : undefined,
      duplicate: () => ops.duplicateSection(sel.file, sel.section),
      toggle: () => edit(sel.file, { kind: 'toggleSection', id: sel.section }), hidden: !!current.disabled,
      remove: () => ops.removeSection(sel.file, sel.section),
      editCode: () => ops.editCode(sel.file, sel.section),
    };
  })();
  const toolbar: ToolbarActions | null = selActions;
  const nameOf = (tg: Target) => { const s = locate(tg.section); const inst = s && docs[s.file]?.sections[tg.section]; return inst ? (tg.block ? blockTitle(inst, tg.block) : sectionTitle(inst)) : tg.section; };

  // ---- preview: unsaved changes go to the server as a draft (debounced) and the frame reloads in place
  const draftFiles = useMemo(() => {
    const f: Record<string, string> = {};
    for (const file of changedFiles) f[file] = serializeTemplate(docs[file]!);
    if (changedKeys.length) f[DATA_FILE] = serializeData(savedData, settings);
    return f;
  }, [changedFiles, changedKeys, docs, settings, savedData]);
  const draftSig = JSON.stringify(draftFiles);
  const token = useRef<string | undefined>(undefined);
  const seq = useRef(0);
  const [refresh, setRefresh] = useState<{ n: number; params: Record<string, string> }>({ n: 0, params: {} });
  useEffect(() => {
    if (!token.current && draftSig === '{}') return;
    const n = ++seq.current;
    const timer = setTimeout(() => {
      rest<{ token: string }>(`/themes/${num}/preview-draft`, { body: { token: token.current, files: JSON.parse(draftSig) as Record<string, string> } })
        .then((r) => { if (n !== seq.current) return; token.current = r.token; setRefresh((p) => ({ n: p.n + 1, params: { preview_theme_id: String(num), _draft: r.token } })); })
        .catch(() => { /* the preview keeps showing the last version */ });
    }, 450);
    return () => clearTimeout(timer);
  }, [draftSig, num]);

  const h = {
    product: chosen.product ?? pdata.data?.products.nodes[0]?.handle, collection: chosen.collection ?? pdata.data?.collections.nodes[0]?.handle, page: chosen.page ?? pdata.data?.pages.nodes[0]?.handle,
    article: chosen.article ?? (pdata.data?.articles.nodes[0] ? `${pdata.data.articles.nodes[0].blog.handle}/${pdata.data.articles.nodes[0].handle}` : undefined),
  };
  const frameUrl = (tpl: string, withDraft: boolean) => withParams(`${chosen.locale ? `/${chosen.locale}` : ''}${previewPath(tpl, h)}`, { preview_theme_id: String(num), ...(chosen.country ? { country: chosen.country } : {}), ...(withDraft && token.current ? { _draft: token.current } : {}) });
  const src = useMemo(() => frameUrl(frameTpl, true), [frameTpl, h.product, h.collection, h.page, h.article, chosen.locale, chosen.country, num]); // eslint-disable-line react-hooks/exhaustive-deps
  const changeChosen = (v: PreviewData) => { setChosen(v); writeChosen(num, v); };
  const chooseTemplate = (tpl: string) => { setSel(null); setTemplate(tpl); setFrameTpl(tpl); };
  const onNavigate = (path: string) => {
    const tpl = templateForPath(path);
    if (!tpl || tpl === template.split('.')[0]) return;
    const next = templateNames.find((x) => x === tpl) ?? templateNames.find((x) => x.split('.')[0] === tpl);
    if (next) { setSel(null); setTemplate(next); }
  };
  const onPick = (tg: Target) => {
    const at = locate(tg.section);
    if (!at) return;
    setTab('sections');
    setSel({ ...at, block: tg.block });
  };
  const onInsert = (section: string, where: 'before' | 'after') => {
    const at = locate(section); const doc = at && docs[at.file];
    if (at && doc) setAdding({ file: at.file, index: doc.order.indexOf(section) + (where === 'after' ? 1 : 0) });
  };
  const hasBlock = (section: string, bid: string) => { const at = locate(section); return !!at && !!docs[at.file]?.sections[section]?.blocks?.[bid]; };

  // quick preview of a preset: a throwaway draft whose template holds only that section (the page chrome stays, minus the other groups' sections)
  const pickerToken = useRef<string | undefined>(undefined);
  const pickerSeq = useRef(0);
  const presetUrl = async (type: string, presetIndex: number) => {
    const doc = templateReducer(EMPTY_TEMPLATE, { kind: 'addSection', type, preset: idx.sections[type]?.presets?.[presetIndex], id: 'preview' });
    const f: Record<string, string> = { ...JSON.parse(draftSig) as Record<string, string>, 'templates/index.json': serializeTemplate(doc) };
    for (const file of Object.keys(docs)) if (/^sections\/.*\.json$/.test(file)) f[file] = serializeTemplate({ ...docs[file]!, sections: {}, order: [] });
    const r = await rest<{ token: string }>(`/themes/${num}/preview-draft`, { body: { token: pickerToken.current, files: f } });
    pickerToken.current = r.token;
    return `/?preview_theme_id=${num}&_draft=${r.token}&_r=${++pickerSeq.current}`;
  };
  const pickerItems: PickerItem[] = useMemo(() => addableSections(idx).flatMap((s) => s.presets.map((p, presetIndex) => {
    const nm = label(p.name) || label(s.name);
    return { type: s.type, presetIndex, name: nm, category: categoryOf(s.type, nm, p.category) };
  })), [idx, dict]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- save
  const save = useMutation({
    mutationFn: (v: SaveVars) => mutate(THEME_FILES_UPSERT, { themeId, files: v.files }, 'themeFilesUpsert'),
    onSuccess: (_r, v) => { toast(t('themes.saved')); setSaved((s) => ({ ...s, ...v.docs })); setBaseSettings(v.settings); if (v.data !== undefined) setSavedData(v.data); setError(null); },
    onError: (e) => setError(e.message),
  });
  const doSave = () => {
    const out: SaveVars = { docs: {}, files: [], settings, data: undefined };
    for (const f of changedFiles) { out.docs[f] = docs[f]!; out.files.push({ filename: f, body: { type: 'TEXT', value: serializeTemplate(docs[f]!) } }); }
    if (changedKeys.length) { out.data = serializeData(savedData, settings); out.files.push({ filename: DATA_FILE, body: { type: 'TEXT', value: out.data } }); }
    save.mutate(out);
  };

  useEffect(() => {
    if (!full) return;
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') setFull(false); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [full]);

  const kb = useRef<(e: KeyboardEvent) => void>(() => {});
  kb.current = (e) => {
    const el = e.target as HTMLElement | null;
    if (el && (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable)) return;
    if (document.querySelector('dialog[open]')) return;
    const mod = e.ctrlKey || e.metaKey; const k = e.key.toLowerCase();
    if (mod && k === 'z') { e.preventDefault(); dispatch({ kind: e.shiftKey ? 'redo' : 'undo' }); }
    else if (mod && k === 'y') { e.preventDefault(); dispatch({ kind: 'redo' }); }
    else if (mod && e.shiftKey && k === 'h' && selActions) { e.preventDefault(); selActions.toggle(); }
    else if (e.shiftKey && e.key === 'Backspace' && selActions?.remove) { e.preventDefault(); selActions.remove(); }
    else if (mod && k === 'c' && sel && !sel.block) { e.preventDefault(); ops.copy(sel.file, sel.section); }
    else if (mod && k === 'v' && clip) { const doc = sel && docs[sel.file]; if (sel && doc) { e.preventDefault(); ops.paste(sel.file, doc.order.indexOf(sel.section) + 1); } }
  };
  useEffect(() => {
    const h = (e: KeyboardEvent) => kb.current(e);
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

  const loadError = files.error ?? schemas.error ?? names.error;
  const missing = !files.isLoading && !docs[tplFile];
  const NEXT: Record<Device, Device> = { desktop: 'mobile', mobile: 'tablet', tablet: 'desktop' };
  const nextDevice = NEXT[device];
  const NextIcon = DEVICES.find(([d]) => d === nextDevice)![1];
  const nextKey = DEVICES.find(([d]) => d === nextDevice)![2];
  const topBtn = 'grid size-8 place-items-center rounded-md text-fg hover:bg-hover disabled:text-muted disabled:opacity-50 disabled:hover:bg-transparent aria-pressed:bg-primary-subtle aria-pressed:text-accent aria-selected:bg-primary-subtle aria-selected:text-accent';
  const deviceBtn = <button type="button" aria-label={t(nextKey)} title={t(nextKey)} className={topBtn} onClick={() => setDevice(nextDevice)}><NextIcon className="size-4" /></button>;
  const inspectorBtn = (
    <button type="button" aria-pressed={inspector} aria-label={t('editor.inspector')} title={t(inspector ? 'editor.inspectorOn' : 'editor.inspectorOff')} onClick={() => setInspector((v) => !v)} className={topBtn}><MousePointerClick className="size-4" /></button>
  );
  const showPanel = tab === 'sections' && !!sel && !!current;
  const blocker = useBlocker(({ currentLocation, nextLocation }) => dirty && currentLocation.pathname !== nextLocation.pathname);
  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [dirty]);
  const status = role === 'MAIN' ? <Badge tone="success">{t('themes.live')}</Badge> : <Badge tone="info">{role && role !== 'UNPUBLISHED' ? t(`themes.role.${role}` as Key) : t('editor.draft')}</Badge>;
  const pageName = t(`editor.page.${template.split('.')[0]}` as Key) === `editor.page.${template.split('.')[0]}` ? template : t(`editor.page.${template.split('.')[0]}` as Key);

  const schemes = (settings.color_schemes && typeof settings.color_schemes === 'object' && !Array.isArray(settings.color_schemes) ? settings.color_schemes : {}) as SchemeSet;
  const bag = (defs: SettingDef[] | undefined, vals: Record<string, SettingValue> | undefined) => Object.fromEntries((defs ?? []).filter(isInput).map((d) => [d.id, coerceValue(d, vals?.[d.id])]));
  const visibility = { section: bag(secSchema?.settings, current?.settings), block: block ? bag(defs, block.settings) : undefined, settings };

  return (
    <SchemesContext.Provider value={schemes}>
    <SourcesContext.Provider value={template}>
    <div className="fixed inset-0 z-[45] flex flex-col bg-page text-fg">
      <ConfirmDialog open={blocker.state === 'blocked'} title={t('save.leaveTitle')} message={t('save.leaveBody')} confirmLabel={t('save.leave')} cancelLabel={t('save.stay')} closeLabel={t('common.close')} danger
        onConfirm={() => blocker.proceed?.()} onClose={() => blocker.reset?.()} />
      <header className="relative flex h-[46px] shrink-0 items-center justify-between px-3">
        <div role="tablist" aria-label={t('editor.panels')} className="flex items-center gap-1">
          <button type="button" aria-label={t('editor.allThemes')} title={t('editor.allThemes')} className={topBtn} onClick={() => nav('/online-store')}><LogOut className="size-4 -scale-x-100" /></button>
          <button type="button" role="tab" aria-selected={tab === 'sections'} aria-label={t('editor.tabSections')} title={t('editor.tabSections')} className={topBtn} onClick={() => setTab('sections')}><PanelsTopLeft className="size-4" /></button>
          <button type="button" role="tab" aria-selected={tab === 'settings'} aria-label={t('editor.tabSettings')} title={t('editor.tabSettings')} className={topBtn} onClick={() => setTab('settings')}><Settings className="size-4" /></button>
        </div>
        <div className="pointer-events-none absolute inset-x-0 top-0 flex h-full items-center justify-center gap-10 text-[12px]">
          <div className="pointer-events-auto flex items-center gap-2"><LayoutTemplate className="size-3.5" aria-hidden /><span className="font-medium">{name}</span>{status}</div>
          <label className="pointer-events-auto relative flex h-7 items-center gap-1.5 rounded-md pl-1.5 pr-2 hover:bg-hover">
            <FileText className="size-3.5" aria-hidden />
            <span aria-hidden>{pageName}</span>
            <select aria-label={t('editor.template')} value={template} onChange={(e) => chooseTemplate(e.target.value)} className="absolute inset-0 cursor-pointer opacity-0">{(templateNames.length ? templateNames : ['index']).map((x) => <option key={x} value={x}>{x}</option>)}</select>
          </label>
        </div>
        <div className="flex items-center gap-1">
          <PreviewDataMenu choices={choices} value={chosen} onChange={changeChosen} className={topBtn} />
          {inspectorBtn}
          {deviceBtn}
          <button type="button" aria-label={t('editor.undo')} title={t('editor.undo')} disabled={!hist.past.length} onClick={() => dispatch({ kind: 'undo' })} className={topBtn}><Undo2 className="size-4" /></button>
          <button type="button" aria-label={t('editor.redo')} title={t('editor.redo')} disabled={!hist.future.length} onClick={() => dispatch({ kind: 'redo' })} className={topBtn}><Redo2 className="size-4" /></button>
          <ThemeToolbar onShortcuts={() => setShortcuts(true)} themeId={themeId} name={name} role={role} dirty={dirty} previewUrl={frameUrl(frameTpl, false)} docsUrl={info.docs} supportUrl={info.support} version={info.version} author={info.author} />
          <Button size="sm" variant="primary" disabled={!dirty} loading={save.isPending} onClick={doSave}>{t('save.save')}</Button>
        </div>
      </header>
      {(error ?? loadError?.message) && <div className="px-1 pb-1"><Banner>{error ?? loadError?.message}</Banner></div>}
      <div className="flex min-h-0 flex-1 gap-1 p-1 pt-0">
        <div className="flex w-[248px] shrink-0 flex-col overflow-hidden rounded-lg border border-line bg-canvas">
          <h1 className="shrink-0 border-b border-line px-3 py-2 text-[12px] font-semibold">{tab === 'settings' ? t('editor.tabSettings') : pageName}</h1>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {tab === 'settings'
              ? <ThemeSettingsPanel groups={groups} values={settings} label={label} onChange={(id, v) => dispatch({ kind: 'setting', id, value: v, at: Date.now() })} />
              : files.isLoading || schemas.isLoading ? <div className="p-3"><Skeleton className="h-64" /></div> : (
                <>
                  {missing && !loadError && <div className="p-2"><Banner>{t('editor.templateMissing')}</Banner></div>}
                  <SectionsTree docs={docs} order={ordered} idx={idx} label={label} fileLabel={fileLabel} sectionTitle={sectionTitle} blockTitle={blockTitle} sel={sel} onSel={setSel} onHover={setHovered} ops={ops} />
                </>
              )}
          </div>
        </div>
        <div className={cx(full ? 'fixed inset-0 z-[55] flex flex-col gap-2 bg-surface p-3' : 'min-w-0 flex-1')}>
          {full && (
            <div className="flex items-center justify-center gap-2">
              {inspectorBtn}{deviceBtn}
              <Button onClick={() => setFull(false)}><Minimize2 className="size-4" />{t('editor.exitFullscreen')}</Button>
            </div>
          )}
          <div className={full ? 'min-h-0 flex-1' : 'h-full'}>
            <PreviewFrame src={src} title={t('themes.preview')} device={device} inspector={inspector} selected={selTarget} highlight={hovered ? { section: hovered.section } : null} onInsert={onInsert} nameOf={nameOf} hasBlock={hasBlock} onPick={onPick} onNavigate={onNavigate} refresh={refresh} toolbar={tab === 'sections' ? toolbar : null} fill />
          </div>
        </div>
        {showPanel && current && sel && selActions && (
          <SettingsPanel
            title={block && sel.block ? blockTitle(current, sel.block) : sectionTitle(current)} scope={`${sel.file}:${sel.section}:${sel.block ?? ''}`}
            notice={block ? t('editor.blockOf', { name: sectionTitle(current) }) : undefined}
            defs={defs} values={(block ?? current).settings ?? {}} label={label} visibility={visibility}
            onChange={(key, value) => edit(sel.file, { kind: 'setSetting', id: sel.section, block: sel.block, key, value }, `set:${sel.file}:${sel.section}:${sel.block ?? ''}:${key}`)}
            onBack={block ? () => setSel({ file: sel.file, section: sel.section }) : undefined} onClose={() => setSel(null)}
            actions={{ duplicate: selActions.duplicate, toggle: selActions.toggle, hidden: selActions.hidden, remove: selActions.remove, editCode: selActions.editCode }} />
        )}
      </div>
      <SectionPicker open={!!adding} onClose={() => setAdding(null)} items={pickerItems} onAdd={(type, pi) => adding && addSection(adding.file, type, pi, adding.index)} previewUrl={presetUrl} />
      <Modal open={!!renaming} onClose={() => setRenaming(null)} closeLabel={t('common.close')} title={t('editor.renameTitle')}
        footer={<><Button onClick={() => setRenaming(null)}>{t('common.cancel')}</Button><Button variant="primary" onClick={() => { if (renaming) edit(renaming.file, { kind: 'renameSection', id: renaming.id, name: renaming.name }); setRenaming(null); }}>{t('save.save')}</Button></>}>
        {renaming && <Input label={t('editor.sectionName')} autoFocus value={renaming.name} onChange={(e) => setRenaming({ ...renaming, name: e.target.value })} onKeyDown={(e) => { if (e.key === 'Enter') { edit(renaming.file, { kind: 'renameSection', id: renaming.id, name: renaming.name }); setRenaming(null); } }} />}
      </Modal>
      <Modal open={shortcuts} onClose={() => setShortcuts(false)} closeLabel={t('common.close')} title={t('editor.shortcuts')}>
        <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-2 text-[13px]">
          {([['editor.shortcutUndo', 'Ctrl+Z'], ['editor.shortcutRedo', 'Ctrl+Shift+Z'], ['editor.shortcutHide', 'Ctrl+Shift+H'], ['editor.shortcutDelete', 'Shift+Backspace'], ['editor.shortcutCopy', 'Ctrl+C'], ['editor.shortcutPaste', 'Ctrl+V']] as const).map(([k, keys]) => (
            <div key={k} className="contents"><dt>{t(k)}</dt><dd><kbd className="rounded border border-line bg-surface px-1.5 py-0.5 text-xs">{keys}</kbd></dd></div>
          ))}
        </dl>
      </Modal>
    </div>
    </SourcesContext.Provider>
    </SchemesContext.Provider>
  );
}

interface PreviewRes {
  products: { nodes: Array<{ handle: string; title: string }> }; collections: { nodes: Array<{ handle: string; title: string }> }; pages: { nodes: Array<{ handle: string; title: string }> };
  articles: { nodes: Array<{ handle: string; title: string; blog: { handle: string } }> };
  shopLocales: Array<{ locale: string; name: string; primary: boolean; published: boolean }>;
  markets: { nodes: Array<{ conditions: { regionsCondition: { regions: { nodes: Array<{ code?: string; name?: string }> } } | null } | null }> };
}

/** What the preview data panel can offer: the store's own resources, languages and the countries of its markets. */
export function previewChoices(d: PreviewRes | undefined): PreviewChoices | undefined {
  if (!d) return undefined;
  const countries = new Map<string, string>();
  for (const m of d.markets?.nodes ?? []) for (const r of m.conditions?.regionsCondition?.regions.nodes ?? []) if (r.code) countries.set(r.code, r.name ?? r.code);
  return {
    products: d.products.nodes, collections: d.collections.nodes, pages: d.pages.nodes, articles: d.articles.nodes,
    locales: d.shopLocales ?? [], countries: [...countries].map(([code, name]) => ({ code, name })).sort((a, b) => a.name.localeCompare(b.name)),
  };
}

/** The documentation and support addresses, version and author a theme declares in `theme_info` of its settings schema. */
export function themeInfo(schemaJson: string): { docs?: string; support?: string; version?: string; author?: string } {
  try {
    const info = (JSON.parse(schemaJson) as Array<Record<string, unknown>>).find((g) => g?.name === 'theme_info');
    const url = (v: unknown) => (typeof v === 'string' && /^https?:\/\//.test(v) ? v : undefined);
    const text = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
    return { docs: url(info?.theme_documentation_url), support: url(info?.theme_support_url), version: text(info?.theme_version), author: text(info?.theme_author) };
  } catch { return {}; }
}

const chosenKey = (num: string | number) => `shopme.preview-data.${num}`;
function readChosen(num: string | number): PreviewData {
  try { return JSON.parse(sessionStorage.getItem(chosenKey(num)) ?? '{}') as PreviewData; } catch { return {}; }
}
function writeChosen(num: string | number, v: PreviewData) {
  try { sessionStorage.setItem(chosenKey(num), JSON.stringify(v)); } catch { /* storage unavailable */ }
}
