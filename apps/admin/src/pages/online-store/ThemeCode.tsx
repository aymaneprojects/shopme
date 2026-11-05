import { Badge, Banner, Button, ConfirmDialog, Input, Modal, Select, Skeleton, Spinner, cx, useToast } from '@shopme/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, CheckCircle2, ChevronDown, ChevronRight, FilePlus2, FileText, History, Image as ImageIcon, Pencil, Search, Trash2, TriangleAlert, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useBlocker, useNavigate, useParams, useSearchParams } from 'react-router';
import { gql, mutate } from '../../api';
import { CodeEditor } from '../../components/CodeEditor';
import type { CodeEditorHandle, CodeProblem } from '../../components/CodeEditor';
import { numToGid } from '../../format';
import { THEME_ALL_FILES, THEME_FILES_COPY, THEME_FILES_DELETE, THEME_FILES_LINT, THEME_FILES_UPSERT, THEME_FILES_WITH_HISTORY, THEME_FILE_BODY, THEME_FILE_VERSION, THEME_FILE_VERSIONS } from '../../graphql';
import { useI18n } from '../../i18n';
import type { Key } from '../../i18n';
import { THEME_DIRS, baseOf, dirOf, formatBytes, groupFiles, isImageFile, isTextFile, languageOf, newFilePath, renamedPath, starterContent } from '../../lib/theme-files';

interface FileRow { filename: string; contentType: string; size: string; updatedAt: string }
interface ListRes { theme: { id: string; name: string; role: string; files: { nodes: FileRow[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } } } | null }
interface BodyRes { theme: { files: { nodes: Array<{ filename: string; body: { content?: string } | null }> } } | null }
interface Lint { filename: string; line: number; column: number; severity: 'ERROR' | 'WARNING'; message: string }
interface Version { id: string; size: number; createdAt: string }
interface Doc { original: string; loaded: boolean; failed?: boolean; fresh?: boolean }

/** Every file of the theme, 250 at a time. */
async function loadList(gid: string): Promise<{ name: string; role: string; files: FileRow[] } | null> {
  let after: string | null = null; let head: { name: string; role: string } | null = null; const files: FileRow[] = [];
  for (let i = 0; i < 40; i++) {
    const r: ListRes = await gql<ListRes>(THEME_ALL_FILES, { id: gid, after });
    if (!r.theme) return null;
    head = { name: r.theme.name, role: r.theme.role }; files.push(...r.theme.files.nodes);
    if (!r.theme.files.pageInfo.hasNextPage) break;
    after = r.theme.files.pageInfo.endCursor;
  }
  return head && { ...head, files };
}

/** "Edit code": the theme's files in a tree, a code editor with Liquid, JSON, CSS and JavaScript highlighting, a syntax check, file history and add / rename / delete. */
export function ThemeCodePage() {
  const { id = '' } = useParams();
  const { t } = useI18n();
  const gid = numToGid('OnlineStoreTheme', id);
  const list = useQuery({ queryKey: ['theme-all-files', gid], queryFn: () => loadList(gid) });
  if (list.isLoading) return <div className="fixed inset-0 z-[45] grid gap-3 bg-page p-4"><Skeleton className="h-8 w-64" /><Skeleton className="h-full" /></div>;
  if (list.error) return <div className="fixed inset-0 z-[45] bg-page p-4"><Banner>{list.error.message}</Banner></div>;
  if (!list.data) return <div className="fixed inset-0 z-[45] bg-page p-4"><Banner>{t('themes.notFound')}</Banner></div>;
  return <CodeWorkspace key={gid} themeId={gid} num={id} head={list.data} />;
}

function CodeWorkspace({ themeId, num, head }: { themeId: string; num: string; head: { name: string; role: string; files: FileRow[] } }) {
  const { t } = useI18n();
  const toast = useToast();
  const nav = useNavigate();
  const qc = useQueryClient();
  const [params] = useSearchParams();
  const editor = useRef<CodeEditorHandle>(null);
  const names = useMemo(() => head.files.map((f) => f.filename), [head.files]);
  const byName = useMemo(() => new Map(head.files.map((f) => [f.filename, f])), [head.files]);

  const [tabs, setTabs] = useState<string[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [docs, setDocs] = useState<Record<string, Doc>>({});
  const texts = useRef<Record<string, string>>({});
  const [dirty, setDirty] = useState<Set<string>>(new Set());
  const [rev, setRev] = useState<Record<string, number>>({});
  const [problems, setProblems] = useState<Record<string, CodeProblem[]>>({});
  const [find, setFind] = useState('');
  const [closed, setClosed] = useState<Record<string, boolean>>({});
  const [history, setHistory] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState<{ dir: string; name: string } | null>(null);
  const [renaming, setRenaming] = useState<{ path: string; name: string } | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [closing, setClosing] = useState<string | null>(null);

  const dirtyNow = dirty.size > 0;
  const blocker = useBlocker(({ currentLocation, nextLocation }) => dirtyNow && currentLocation.pathname !== nextLocation.pathname);
  useEffect(() => {
    if (!dirtyNow) return;
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [dirtyNow]);

  // ---- opening files
  const load = useCallback(async (path: string) => {
    if (!isTextFile(path)) { setDocs((d) => ({ ...d, [path]: { original: '', loaded: true } })); return; }
    try {
      const r = await gql<BodyRes>(THEME_FILE_BODY, { id: themeId, filenames: [path] });
      const text = r.theme?.files.nodes[0]?.body?.content ?? '';
      texts.current[path] = text;
      setDocs((d) => ({ ...d, [path]: { original: text, loaded: true } }));
    } catch { setDocs((d) => ({ ...d, [path]: { original: '', loaded: true, failed: true } })); }
  }, [themeId]);
  const open = useCallback((path: string) => {
    setTabs((tb) => (tb.includes(path) ? tb : [...tb, path]));
    setActive(path);
    setDocs((d) => { if (d[path]) return d; void load(path); return { ...d, [path]: { original: '', loaded: false } }; });
  }, [load]);
  useEffect(() => {
    const f = params.get('file');
    open(f && names.includes(f) ? f : names.includes('layout/theme.liquid') ? 'layout/theme.liquid' : names[0] ?? '');
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const doc = active ? docs[active] : undefined;
  const text = (p: string) => texts.current[p] ?? docs[p]?.original ?? '';
  const setText = (p: string, v: string) => {
    texts.current[p] = v;
    const isDirty = v !== (docs[p]?.original ?? '') || !!docs[p]?.fresh;
    setDirty((s) => { if (s.has(p) === isDirty) return s; const n = new Set(s); if (isDirty) n.add(p); else n.delete(p); return n; });
  };

  // ---- syntax check (debounced while typing; the server is the reference parser)
  const lintSeq = useRef(0);
  const [version, setVersion] = useState(0);
  const lintNow = useCallback(async (path: string) => {
    if (!isTextFile(path) || !(path.endsWith('.liquid') || path.endsWith('.json'))) { setProblems((p) => ({ ...p, [path]: [] })); return; }
    const n = ++lintSeq.current;
    try {
      const r = await gql<{ themeFilesLint: Lint[] }>(THEME_FILES_LINT, { files: [{ filename: path, body: texts.current[path] ?? '' }] });
      if (n === lintSeq.current) setProblems((p) => ({ ...p, [path]: r.themeFilesLint.map((d) => ({ line: d.line, column: d.column, severity: d.severity === 'ERROR' ? 'error' : 'warning', message: d.message })) }));
    } catch { /* the check is a help; saving checks again */ }
  }, []);
  useEffect(() => {
    if (!active || !doc?.loaded || doc.failed) return;
    const timer = setTimeout(() => { void lintNow(active); }, 700);
    return () => clearTimeout(timer);
  }, [active, doc?.loaded, doc?.failed, version, lintNow]);

  // ---- saving
  const save = useMutation({
    mutationFn: async () => {
      const files = [...dirty].map((p) => ({ filename: p, body: { type: 'TEXT' as const, value: texts.current[p] ?? '' } }));
      return { files, payload: await mutate(THEME_FILES_UPSERT, { themeId, files }, 'themeFilesUpsert') };
    },
    onSuccess: ({ files }) => {
      toast(t('bs.code.saved'));
      setError(null);
      setDocs((d) => { const n = { ...d }; for (const f of files) n[f.filename] = { original: f.body.value, loaded: true }; return n; });
      setDirty(new Set());
      void qc.invalidateQueries({ queryKey: ['theme-all-files'] }); void qc.invalidateQueries({ queryKey: ['theme-file-versions'] }); void qc.invalidateQueries({ queryKey: ['theme-files-history'] });
      void qc.invalidateQueries({ queryKey: ['theme-settings'] }); void qc.invalidateQueries({ queryKey: ['theme-schemas'] }); void qc.invalidateQueries({ queryKey: ['theme-editor-files'] });
      for (const f of files) void lintNow(f.filename);
    },
    onError: (e) => { setError(e.message); void Promise.all([...dirty].map((p) => lintNow(p))); },
  });
  const saveAll = () => { if (dirty.size && !save.isPending) save.mutate(); };

  // ---- add, rename, delete
  const createFile = useMutation({
    mutationFn: async (path: string) => { await mutate(THEME_FILES_UPSERT, { themeId, files: [{ filename: path, body: { type: 'TEXT', value: starterContent(path) } }] }, 'themeFilesUpsert'); return path; },
    onSuccess: async (path) => { setAdding(null); await qc.invalidateQueries({ queryKey: ['theme-all-files'] }); texts.current[path] = starterContent(path); setDocs((d) => ({ ...d, [path]: { original: starterContent(path), loaded: true } })); setTabs((tb) => [...tb, path]); setActive(path); },
    onError: (e) => setError(e.message),
  });
  const dropTab = (path: string) => {
    setTabs((tb) => { const next = tb.filter((x) => x !== path); setActive((a) => (a === path ? next.at(-1) ?? null : a)); return next; });
    delete texts.current[path];
    setDocs((d) => { const { [path]: _x, ...rest } = d; return rest; });
    setDirty((s) => { const n = new Set(s); n.delete(path); return n; });
    setRev((r) => ({ ...r, [path]: (r[path] ?? 0) + 1 }));
  };
  const rename = useMutation({
    mutationFn: async ({ from, to }: { from: string; to: string }) => {
      await mutate(THEME_FILES_COPY, { themeId, files: [{ srcFilename: from, dstFilename: to }] }, 'themeFilesCopy');
      await mutate(THEME_FILES_DELETE, { themeId, files: [from] }, 'themeFilesDelete');
      return { from, to };
    },
    onSuccess: async ({ from, to }) => {
      setRenaming(null);
      const wasOpen = tabs.includes(from);
      await qc.invalidateQueries({ queryKey: ['theme-all-files'] });
      if (wasOpen) { dropTab(from); open(to); }
    },
    onError: (e) => setError(e.message),
  });
  const remove = useMutation({
    mutationFn: async (path: string) => { await mutate(THEME_FILES_DELETE, { themeId, files: [path] }, 'themeFilesDelete'); return path; },
    onSuccess: async (path) => { setDeleting(null); dropTab(path); await qc.invalidateQueries({ queryKey: ['theme-all-files'] }); void qc.invalidateQueries({ queryKey: ['theme-files-history'] }); },
    onError: (e) => { setDeleting(null); setError(e.message); },
  });

  // ---- history
  const versions = useQuery({ queryKey: ['theme-file-versions', themeId, active], enabled: history && !!active && isTextFile(active), queryFn: () => gql<{ themeFileVersions: Version[] }>(THEME_FILE_VERSIONS, { themeId, filename: active }) });
  const deletedFiles = useQuery({ queryKey: ['theme-files-history', themeId], retry: false, queryFn: () => gql<{ themeFilesWithHistory: string[] }>(THEME_FILES_WITH_HISTORY, { themeId }) });
  const gone = (deletedFiles.data?.themeFilesWithHistory ?? []).filter((p) => !byName.has(p) && isTextFile(p));
  const [pickedVersion, setPickedVersion] = useState<string | null>(null);
  useEffect(() => { setPickedVersion(null); }, [active]);
  const pickedBody = useQuery({ queryKey: ['theme-file-version', pickedVersion], enabled: !!pickedVersion, queryFn: () => gql<{ themeFileVersion: { body: string | null } | null }>(THEME_FILE_VERSION, { id: pickedVersion }) });
  const restoreDeleted = async (path: string) => {
    try {
      const vs = await gql<{ themeFileVersions: Version[] }>(THEME_FILE_VERSIONS, { themeId, filename: path });
      const v = vs.themeFileVersions[0];
      if (!v) return;
      const body = (await gql<{ themeFileVersion: { body: string | null } | null }>(THEME_FILE_VERSION, { id: v.id })).themeFileVersion?.body ?? '';
      texts.current[path] = body;
      setDocs((d) => ({ ...d, [path]: { original: '', loaded: true, fresh: true } }));
      setTabs((tb) => (tb.includes(path) ? tb : [...tb, path])); setActive(path);
      setDirty((s) => new Set(s).add(path));
      toast(t('bs.code.restoredDeleted'));
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };

  const tree = useMemo(() => groupFiles(names, find), [names, find]);
  const mine = active ? problems[active] ?? [] : [];
  const errorCount = mine.filter((p) => p.severity === 'error').length;
  const activeRow = active ? byName.get(active) : undefined;
  const check = adding ? newFilePath(adding.dir, adding.name, names) : null;
  const checkRename = renaming ? renamedPath(renaming.path, renaming.name, names) : null;
  const errText = (r: typeof check) => (r && !r.ok ? t(`bs.code.err.${r.error}` as Key) : undefined);
  const askClose = (path: string) => { if (dirty.has(path)) setClosing(path); else dropTab(path); };

  return (
    <div className="fixed inset-0 z-[45] flex flex-col bg-page text-fg">
      <ConfirmDialog open={blocker.state === 'blocked'} title={t('save.leaveTitle')} message={t('save.leaveBody')} confirmLabel={t('save.leave')} cancelLabel={t('save.stay')} closeLabel={t('common.close')} danger
        onConfirm={() => blocker.proceed?.()} onClose={() => blocker.reset?.()} />
      <ConfirmDialog open={!!closing} title={t('bs.code.closeTitle')} message={t('bs.code.closeBody', { name: closing ?? '' })} confirmLabel={t('bs.code.closeDiscard')} cancelLabel={t('save.stay')} closeLabel={t('common.close')} danger
        onConfirm={() => { if (closing) dropTab(closing); setClosing(null); }} onClose={() => setClosing(null)} />
      <ConfirmDialog open={!!deleting} title={t('bs.code.deleteTitle', { name: deleting ?? '' })} message={t('bs.code.deleteBody')} confirmLabel={t('common.delete')} cancelLabel={t('common.cancel')} closeLabel={t('common.close')} danger loading={remove.isPending}
        onConfirm={() => deleting && remove.mutate(deleting)} onClose={() => setDeleting(null)} />
      <Modal open={!!adding} onClose={() => setAdding(null)} closeLabel={t('common.close')} title={t('bs.code.addTitle')}
        footer={<><Button onClick={() => setAdding(null)}>{t('common.cancel')}</Button><Button variant="primary" loading={createFile.isPending} disabled={!check?.ok} onClick={() => check?.ok && createFile.mutate(check.path)}>{t('bs.code.create')}</Button></>}>
        {adding && (
          <div className="flex flex-col gap-3">
            <Select label={t('bs.code.folder')} value={adding.dir} onChange={(e) => setAdding({ ...adding, dir: e.target.value })}>{THEME_DIRS.map((d) => <option key={d} value={d}>{d}</option>)}</Select>
            <Input label={t('bs.code.fileName')} autoFocus value={adding.name} placeholder={t('bs.code.fileNameHint')} error={adding.name.trim() ? errText(check) : undefined}
              help={check?.ok ? check.path : undefined} onChange={(e) => setAdding({ ...adding, name: e.target.value })} onKeyDown={(e) => { if (e.key === 'Enter' && check?.ok) createFile.mutate(check.path); }} />
          </div>
        )}
      </Modal>
      <Modal open={!!renaming} onClose={() => setRenaming(null)} closeLabel={t('common.close')} title={t('bs.code.renameTitle')}
        footer={<><Button onClick={() => setRenaming(null)}>{t('common.cancel')}</Button><Button variant="primary" loading={rename.isPending} disabled={!checkRename?.ok || (checkRename.ok && checkRename.path === renaming?.path)} onClick={() => renaming && checkRename?.ok && rename.mutate({ from: renaming.path, to: checkRename.path })}>{t('editor.rename')}</Button></>}>
        {renaming && <Input label={t('bs.code.fileName')} autoFocus value={renaming.name} error={errText(checkRename)} help={checkRename?.ok ? checkRename.path : undefined} onChange={(e) => setRenaming({ ...renaming, name: e.target.value })} />}
      </Modal>

      <header className="flex h-[46px] shrink-0 items-center gap-2 px-3">
        <button type="button" aria-label={t('bs.code.back')} title={t('bs.code.back')} className="grid size-8 place-items-center rounded-md hover:bg-hover" onClick={() => nav(`/online-store/themes/${num}/editor`)}><ArrowLeft className="size-4" /></button>
        <h1 className="flex min-w-0 items-center gap-2 text-[13px] font-semibold"><span className="truncate">{head.name}</span><Badge tone={head.role === 'MAIN' ? 'success' : 'info'}>{head.role === 'MAIN' ? t('themes.live') : t(`themes.role.${head.role}` as Key)}</Badge></h1>
        <span className="min-w-0 flex-1 truncate text-center text-xs text-muted" aria-live="polite">{active ?? ''}</span>
        {active && isTextFile(active) && (
          <span className={cx('flex items-center gap-1 text-xs', errorCount ? 'text-critical' : mine.length ? 'text-warning' : 'text-success')} aria-live="polite">
            {errorCount ? <TriangleAlert className="size-3.5" /> : <CheckCircle2 className="size-3.5" />}
            {errorCount ? t('bs.code.errors', { n: errorCount }) : mine.length ? t('bs.code.warnings', { n: mine.length }) : t('bs.code.noProblems')}
          </span>
        )}
        <Button size="sm" aria-pressed={history} disabled={!active || !isTextFile(active)} onClick={() => setHistory((h) => !h)}><History className="size-3.5" />{t('bs.code.history')}</Button>
        <Button size="sm" variant="primary" disabled={!dirtyNow} loading={save.isPending} onClick={saveAll}>{dirty.size > 1 ? t('bs.code.saveAll', { n: dirty.size }) : t('save.save')}</Button>
      </header>
      {error && <div className="px-1 pb-1"><Banner>{error}</Banner></div>}

      <div className="flex min-h-0 flex-1 gap-1 p-1 pt-0">
        <aside className="flex w-[260px] shrink-0 flex-col overflow-hidden rounded-lg border border-line bg-canvas" aria-label={t('bs.code.files')}>
          <div className="relative border-b border-line p-2">
            <Search className="pointer-events-none absolute left-4 top-4 size-3.5 text-muted" />
            <input type="search" value={find} onChange={(e) => setFind(e.target.value)} placeholder={t('bs.code.search')} aria-label={t('bs.code.search')} className="field-control w-full pl-8 text-[12px]" />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto py-1 text-[12px]">
            {tree.map((g) => {
              const shut = !find.trim() && closed[g.dir];
              return (
                <section key={g.dir} aria-label={g.dir}>
                  <div className="group flex h-7 items-center pr-1.5">
                    <button type="button" aria-expanded={!shut} onClick={() => setClosed((c) => ({ ...c, [g.dir]: !c[g.dir] }))} className="flex h-full min-w-0 flex-1 items-center gap-1 px-2 text-left font-semibold hover:bg-hover">
                      {shut ? <ChevronRight className="size-3.5 shrink-0" /> : <ChevronDown className="size-3.5 shrink-0" />}<span className="truncate">{g.dir}</span><span className="font-normal text-muted">{g.files.length}</span>
                    </button>
                    {(THEME_DIRS as readonly string[]).includes(g.dir) && <button type="button" aria-label={t('bs.code.addIn', { dir: g.dir })} title={t('bs.code.addIn', { dir: g.dir })} onClick={() => setAdding({ dir: g.dir, name: '' })} className="grid size-5 place-items-center rounded text-muted hover:bg-hover hover:text-fg"><FilePlus2 className="size-3.5" /></button>}
                  </div>
                  {!shut && (
                    <ul>
                      {g.files.map((p) => (
                        <li key={p} className={cx('group/f flex h-6 items-center pr-1', active === p ? 'bg-primary text-on-primary' : 'hover:bg-hover')}>
                          <button type="button" onClick={() => open(p)} aria-current={active === p} title={p} className="flex h-full min-w-0 flex-1 items-center gap-1.5 pl-6 text-left">
                            {isTextFile(p) ? <FileText className="size-3.5 shrink-0 opacity-70" /> : <ImageIcon className="size-3.5 shrink-0 opacity-70" />}
                            <span className="truncate">{baseOf(p)}</span>{dirty.has(p) && <span className="size-1.5 shrink-0 rounded-full bg-current" aria-label={t('bs.code.unsaved')} />}
                          </button>
                          <span className="hidden shrink-0 gap-0.5 group-hover/f:flex group-focus-within/f:flex">
                            <button type="button" aria-label={`${t('editor.rename')}: ${p}`} title={t('editor.rename')} disabled={dirty.has(p)} onClick={() => setRenaming({ path: p, name: baseOf(p) })} className="grid size-5 place-items-center rounded hover:bg-black/10 disabled:opacity-40"><Pencil className="size-3" /></button>
                            <button type="button" aria-label={`${t('common.delete')}: ${p}`} title={t('common.delete')} onClick={() => setDeleting(p)} className="grid size-5 place-items-center rounded hover:bg-black/10"><Trash2 className="size-3" /></button>
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              );
            })}
            {!tree.length && <p className="px-3 py-2 text-muted">{t('bs.code.noFiles')}</p>}
            {gone.length > 0 && (
              <section aria-label={t('bs.code.deletedFiles')} className="mt-2 border-t border-line pt-1">
                <h2 className="px-2 py-1 font-semibold">{t('bs.code.deletedFiles')}</h2>
                <ul>{gone.map((p) => <li key={p}><button type="button" onClick={() => void restoreDeleted(p)} title={t('bs.code.restoreDeleted')} className="flex h-6 w-full items-center gap-1.5 pl-4 pr-2 text-left text-muted hover:bg-hover hover:text-fg"><FileText className="size-3.5 shrink-0" /><span className="truncate">{p}</span></button></li>)}</ul>
              </section>
            )}
          </div>
        </aside>

        <section className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-lg border border-line bg-canvas" aria-label={t('bs.code.editor')}>
          {tabs.length > 0 && (
            <div role="tablist" aria-label={t('bs.code.openFiles')} className="flex shrink-0 overflow-x-auto border-b border-line bg-surface">
              {tabs.map((p) => (
                <div key={p} role="presentation" className={cx('flex shrink-0 items-center border-r border-line text-[12px]', active === p ? 'bg-canvas font-medium' : 'text-muted hover:bg-hover')}>
                  <button type="button" role="tab" aria-selected={active === p} onClick={() => setActive(p)} title={p} className="flex h-8 items-center gap-1.5 pl-3 pr-1">{baseOf(p)}{dirty.has(p) && <span className="size-1.5 rounded-full bg-accent" aria-label={t('bs.code.unsaved')} />}</button>
                  <button type="button" aria-label={`${t('common.close')}: ${p}`} onClick={() => askClose(p)} className="mr-1 grid size-5 place-items-center rounded hover:bg-hover"><X className="size-3" /></button>
                </div>
              ))}
            </div>
          )}
          <div className="relative min-h-0 flex-1">
            {!active && <p className="grid h-full place-items-center text-[13px] text-muted">{t('bs.code.pick')}</p>}
            {active && !doc?.loaded && <div className="absolute inset-0 grid place-items-center"><Spinner /></div>}
            {active && doc?.failed && <div className="p-4"><Banner>{t('bs.code.loadFailed')}</Banner></div>}
            {active && doc?.loaded && !doc.failed && !isTextFile(active) && (
              <div className="grid h-full place-items-center p-6 text-center text-[13px] text-muted">
                <div className="flex max-w-sm flex-col items-center gap-3">
                  {isImageFile(active) && <img src={`/cdn/shop/t/${num}/assets/${baseOf(active).replace(/^assets\//, '')}`} alt="" className="max-h-40 rounded border border-line" />}
                  <p className="font-medium text-fg">{active}</p>
                  <p>{t('bs.code.binary', { size: formatBytes(Number(activeRow?.size ?? 0)) })}</p>
                </div>
              </div>
            )}
            {active && doc?.loaded && !doc.failed && isTextFile(active) && (
              <CodeEditor key="one" ref={editor} docKey={`${active}#${rev[active] ?? 0}`} initial={doc.fresh ? text(active) : doc.original} lang={languageOf(active)} problems={mine}
                onChange={(v) => { setText(active, v); setVersion((n) => n + 1); }} onSave={saveAll} />
            )}
          </div>
          {mine.length > 0 && (
            <ul className="max-h-32 shrink-0 overflow-y-auto border-t border-line bg-surface text-[12px]" aria-label={t('bs.code.problems')}>
              {mine.map((p, i) => (
                <li key={i}><button type="button" onClick={() => editor.current?.goTo(p.line, p.column)} className="flex w-full items-start gap-2 px-3 py-1 text-left hover:bg-hover">
                  <TriangleAlert className={cx('mt-0.5 size-3.5 shrink-0', p.severity === 'error' ? 'text-critical' : 'text-warning')} />
                  <span className="shrink-0 text-muted">{p.line}:{p.column}</span><span className="min-w-0">{p.message}</span>
                </button></li>
              ))}
            </ul>
          )}
        </section>

        {history && active && isTextFile(active) && (
          <aside className="flex w-[300px] shrink-0 flex-col overflow-hidden rounded-lg border border-line bg-canvas" aria-label={t('bs.code.history')}>
            <header className="flex h-9 shrink-0 items-center justify-between border-b border-line px-3"><h2 className="text-[12px] font-semibold">{t('bs.code.historyOf', { name: baseOf(active) })}</h2><button type="button" aria-label={t('common.close')} onClick={() => setHistory(false)} className="grid size-6 place-items-center rounded hover:bg-hover"><X className="size-3.5" /></button></header>
            <div className="min-h-0 flex-1 overflow-y-auto">
              {versions.isLoading && <div className="p-3"><Spinner /></div>}
              {versions.data && !versions.data.themeFileVersions.length && <p className="p-3 text-[12px] text-muted">{t('bs.code.noHistory')}</p>}
              <ul>
                {versions.data?.themeFileVersions.map((v) => (
                  <li key={v.id} className="border-b border-line">
                    <button type="button" aria-pressed={pickedVersion === v.id} onClick={() => setPickedVersion(pickedVersion === v.id ? null : v.id)} className={cx('flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-[12px] hover:bg-hover', pickedVersion === v.id && 'bg-hover')}>
                      <span>{new Date(v.createdAt).toLocaleString()}</span><span className="text-muted">{formatBytes(v.size)}</span>
                    </button>
                    {pickedVersion === v.id && (
                      <div className="flex flex-col gap-2 bg-surface p-2">
                        {pickedBody.isLoading ? <Spinner /> : <pre className="max-h-64 overflow-auto rounded border border-line bg-canvas p-2 text-[11px] leading-snug" tabIndex={0}>{pickedBody.data?.themeFileVersion?.body ?? ''}</pre>}
                        <Button size="sm" variant="primary" disabled={pickedBody.isLoading} onClick={() => { editor.current?.replace(pickedBody.data?.themeFileVersion?.body ?? ''); toast(t('bs.code.reverted')); }}>{t('bs.code.restore')}</Button>
                        <p className="text-[11px] text-muted">{t('bs.code.restoreHint')}</p>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}
