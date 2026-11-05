import { Badge, Banner, Button, ConfirmDialog, Select, Skeleton, useToast } from '@shopme/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Plus, Search } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useBlocker, useNavigate, useParams } from 'react-router';
import { gql, mutate } from '../../api';
import { numToGid } from '../../format';
import { SHOP_LOCALES, THEME_FILES_UPSERT, THEME_LOCALE_FILES } from '../../graphql';
import { useI18n } from '../../i18n';
import { applyEdits, flatten, localeFiles, parseLocale, placeholdersDiffer, serializeLocale } from '../../lib/locale-content';
import type { LocaleFile, Tree } from '../../lib/locale-content';

interface FilesRes { theme: { id: string; name: string; files: { nodes: Array<{ filename: string; body: { content?: string } | null }> } } | null }
type Nodes = Array<{ filename: string; body: { content?: string } | null }>;
const PAGE = 120;

/** "Edit default theme content": every text of the theme's locale files in one searchable table, per language. */
export function ThemeContentPage() {
  const { id = '' } = useParams();
  const { t } = useI18n();
  const gid = numToGid('OnlineStoreTheme', id);
  const q = useQuery({ queryKey: ['theme-locale-files', gid], queryFn: () => gql<FilesRes>(THEME_LOCALE_FILES, { id: gid }) });
  const shopLocales = useQuery({ queryKey: ['shop-locales'], retry: false, staleTime: 60_000, queryFn: () => gql<{ shopLocales: Array<{ locale: string; name: string }> }>(SHOP_LOCALES) });
  if (q.isLoading) return <Shell id={id}><Skeleton className="h-96" /></Shell>;
  if (q.error) return <Shell id={id}><Banner>{q.error.message}</Banner></Shell>;
  if (!q.data?.theme) return <Shell id={id}><Banner>{t('themes.notFound')}</Banner></Shell>;
  const files = q.data.theme.files.nodes;
  const list = localeFiles(files.map((f) => f.filename));
  if (!list.some((f) => f.isDefault)) return <Shell id={id}><Banner tone="warning">{t('bs.content.none')}</Banner></Shell>;
  return <ContentEditor key={`${gid}:${q.dataUpdatedAt}`} themeId={gid} num={id} name={q.data.theme.name} files={files} list={list} shopLocales={shopLocales.data?.shopLocales ?? []} />;
}

function Shell({ id, children, actions, title }: { id: string; children: React.ReactNode; actions?: React.ReactNode; title?: string }) {
  const { t } = useI18n();
  const nav = useNavigate();
  return (
    <div className="fixed inset-0 z-[45] flex flex-col bg-page text-fg">
      <header className="flex h-[46px] shrink-0 items-center gap-2 px-3">
        <button type="button" aria-label={t('bs.content.back')} title={t('bs.content.back')} className="grid size-8 place-items-center rounded-md hover:bg-hover" onClick={() => nav(`/online-store/themes/${id}/editor`)}><ArrowLeft className="size-4" /></button>
        <h1 className="min-w-0 flex-1 truncate text-[13px] font-semibold">{title ?? t('bs.editContent')}</h1>
        {actions}
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto p-3 pt-0"><div className="mx-auto flex max-w-5xl flex-col gap-3">{children}</div></div>
    </div>
  );
}

function ContentEditor({ themeId, num, name, files, list, shopLocales }: { themeId: string; num: string; name: string; files: Nodes; list: LocaleFile[]; shopLocales: Array<{ locale: string; name: string }> }) {
  const { t } = useI18n();
  const toast = useToast();
  const qc = useQueryClient();
  const def = list.find((f) => f.isDefault)!;
  const [added, setAdded] = useState<LocaleFile[]>([]);
  const all = [...list, ...added];
  const [code, setCode] = useState(def.code);
  const [edits, setEdits] = useState<Record<string, Record<string, string>>>({});
  const [find, setFind] = useState('');
  const [group, setGroup] = useState('');
  const [show, setShow] = useState<'all' | 'edited' | 'missing'>('all');
  const [limit, setLimit] = useState(PAGE);
  const [error, setError] = useState<string | null>(null);

  const trees = useMemo(() => {
    const out: Record<string, Tree> = {};
    for (const f of all) out[f.code] = parseLocale(files.find((x) => x.filename === f.path)?.body?.content) ?? {};
    return out;
  }, [files, all.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const source = useMemo(() => flatten(trees[def.code] ?? {}), [trees, def.code]);
  const flat = useMemo(() => flatten(trees[code] ?? {}), [trees, code]);
  const mine = edits[code] ?? {};
  const keys = useMemo(() => Object.keys(source), [source]);
  const groups = useMemo(() => [...new Set(keys.map((k) => k.split('.')[0]!))], [keys]);
  const valueOf = (k: string) => (k in mine ? mine[k]! : flat[k] ?? '');
  const isDefault = code === def.code;
  const editedCount = Object.values(edits).reduce((n, e) => n + Object.keys(e).length, 0);
  const dirty = editedCount > 0 || added.length > 0;

  const n = find.trim().toLowerCase();
  const rows = keys.filter((k) => {
    if (group && k.split('.')[0] !== group) return false;
    if (show === 'edited' && !(k in mine)) return false;
    if (show === 'missing' && (isDefault || valueOf(k) !== '')) return false;
    return !n || k.toLowerCase().includes(n) || source[k]!.toLowerCase().includes(n) || valueOf(k).toLowerCase().includes(n);
  });
  useEffect(() => { setLimit(PAGE); }, [find, group, show, code]);

  const blocker = useBlocker(({ currentLocation, nextLocation }) => dirty && currentLocation.pathname !== nextLocation.pathname);
  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [dirty]);

  const set = (k: string, v: string) => setEdits((e) => {
    const cur = { ...(e[code] ?? {}) };
    if (v === (flat[k] ?? '')) delete cur[k]; else cur[k] = v;
    return { ...e, [code]: cur };
  });

  const save = useMutation({
    mutationFn: () => {
      const out: Array<{ filename: string; body: { type: 'TEXT'; value: string } }> = [];
      for (const f of all) {
        const e = edits[f.code];
        const isNew = added.some((a) => a.code === f.code);
        if (!isNew && !(e && Object.keys(e).length)) continue;
        out.push({ filename: f.path, body: { type: 'TEXT', value: serializeLocale(applyEdits(trees[f.code] ?? {}, e ?? {})) } });
      }
      return mutate(THEME_FILES_UPSERT, { themeId, files: out }, 'themeFilesUpsert');
    },
    onSuccess: () => { toast(t('bs.content.saved')); setError(null); setEdits({}); setAdded([]); void qc.invalidateQueries({ queryKey: ['theme-locale-files'] }); void qc.invalidateQueries({ queryKey: ['theme-locales'] }); },
    onError: (e) => setError(e.message),
  });
  const addable = shopLocales.filter((l) => !all.some((f) => f.code.toLowerCase() === l.locale.toLowerCase().split('-')[0]! || f.code.toLowerCase() === l.locale.toLowerCase()));
  const addLanguage = (locale: string) => {
    if (!locale) return;
    setAdded((a) => [...a, { code: locale, path: `locales/${locale}.json`, isDefault: false }]);
    setCode(locale);
  };
  const label = (f: LocaleFile) => shopLocales.find((l) => l.locale === f.code)?.name ?? f.code;

  return (
    <Shell id={num} title={`${t('bs.editContent')} · ${name}`} actions={(
      <>
        <Button size="sm" disabled={!dirty || save.isPending} onClick={() => { setEdits({}); setAdded([]); setCode(def.code); setError(null); }}>{t('save.discard')}</Button>
        <Button size="sm" variant="primary" disabled={!dirty} loading={save.isPending} onClick={() => save.mutate()}>{t('save.save')}</Button>
      </>
    )}>
      <ConfirmDialog open={blocker.state === 'blocked'} title={t('save.leaveTitle')} message={t('save.leaveBody')} confirmLabel={t('save.leave')} cancelLabel={t('save.stay')} closeLabel={t('common.close')} danger
        onConfirm={() => blocker.proceed?.()} onClose={() => blocker.reset?.()} />
      {error && <Banner>{error}</Banner>}
      <p className="text-[13px] text-muted">{t('bs.content.intro')}</p>
      <div className="flex flex-wrap items-end gap-2">
        <label className="relative min-w-52 flex-1">
          <span className="visually-hidden sr-only">{t('bs.content.search')}</span>
          <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted" />
          <input type="search" value={find} onChange={(e) => setFind(e.target.value)} placeholder={t('bs.content.search')} aria-label={t('bs.content.search')} className="field-control w-full pl-8" />
        </label>
        <Select aria-label={t('bs.content.language')} value={code} onChange={(e) => setCode(e.target.value)}>
          {all.map((f) => <option key={f.code} value={f.code}>{label(f)}{f.isDefault ? ` (${t('bs.content.default')})` : ''}</option>)}
        </Select>
        <Select aria-label={t('bs.content.group')} value={group} onChange={(e) => setGroup(e.target.value)}>
          <option value="">{t('bs.content.allGroups')}</option>
          {groups.map((g) => <option key={g} value={g}>{g}</option>)}
        </Select>
        <Select aria-label={t('bs.content.show')} value={show} onChange={(e) => setShow(e.target.value as typeof show)}>
          <option value="all">{t('bs.content.showAll')}</option>
          <option value="edited">{t('bs.content.showEdited')}</option>
          {!isDefault && <option value="missing">{t('bs.content.showMissing')}</option>}
        </Select>
        {addable.length > 0 && (
          <Select aria-label={t('bs.content.addLanguage')} value="" onChange={(e) => addLanguage(e.target.value)}>
            <option value="">{`+ ${t('bs.content.addLanguage')}`}</option>
            {addable.map((l) => <option key={l.locale} value={l.locale}>{l.name}</option>)}
          </Select>
        )}
      </div>
      <p className="flex items-center gap-2 text-xs text-muted">{t('bs.content.count', { n: rows.length, total: keys.length })}{editedCount > 0 && <Badge tone="attention">{t('bs.content.unsaved', { n: editedCount })}</Badge>}</p>
      <div className="overflow-hidden rounded-xl border border-line bg-canvas">
        <table className="w-full table-fixed text-[13px]">
          <thead className="bg-surface text-left text-xs text-muted">
            <tr>
              <th className="w-[26%] px-3 py-2 font-medium">{t('bs.content.key')}</th>
              {!isDefault && <th className="w-[30%] px-3 py-2 font-medium">{t('bs.content.original')}</th>}
              <th className="px-3 py-2 font-medium">{isDefault ? t('bs.content.text') : label(all.find((f) => f.code === code)!)}</th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, limit).map((k) => {
              const v = valueOf(k);
              const bad = !isDefault && placeholdersDiffer(source[k]!, v);
              const long = (isDefault ? v : source[k]!).length > 70 || v.length > 70;
              return (
                <tr key={k} className="border-t border-line align-top">
                  <th scope="row" className="break-words px-3 py-2 text-left align-top font-mono text-[11px] font-normal text-muted">{k}</th>
                  {!isDefault && <td className="break-words px-3 py-2 align-top text-muted">{source[k]}</td>}
                  <td className="px-3 py-1.5 align-top">
                    {long
                      ? <textarea aria-label={k} rows={2} value={v} onChange={(e) => set(k, e.target.value)} className="field-control w-full resize-y" aria-invalid={bad} />
                      : <input aria-label={k} value={v} onChange={(e) => set(k, e.target.value)} className="field-control w-full" aria-invalid={bad} />}
                    {bad && <p className="mt-1 text-xs text-critical">{t('bs.content.placeholders')}</p>}
                    {k in mine && <p className="mt-1 text-xs text-muted">{t('bs.content.edited')}</p>}
                  </td>
                </tr>
              );
            })}
            {!rows.length && <tr><td colSpan={3} className="px-3 py-8 text-center text-muted">{t('bs.content.noMatch')}</td></tr>}
          </tbody>
        </table>
      </div>
      {rows.length > limit && <div className="flex justify-center pb-4"><Button onClick={() => setLimit((l) => l + PAGE)}><Plus className="size-4" />{t('bs.content.more', { n: rows.length - limit })}</Button></div>}
    </Shell>
  );
}
