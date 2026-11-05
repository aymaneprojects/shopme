import { Banner, Button, Card, ConfirmDialog, Dropdown, EmptyState, IndexTable, Input, Modal, Pagination, Select, useToast } from '@shopme/ui';
import type { Column } from '@shopme/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, Download, FileImage, FolderPlus, Folder, MoreHorizontal, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { useRef, useState } from 'react';
import { Link } from 'react-router';
import { UserErrors, gql, mutate, upload } from '../../api';
import { searchCls, selectCls, useFormat, useListParams } from '../../components/shared';
import { FILES, FILE_CREATE, FILE_DELETE, FILE_FOLDERS, FILE_FOLDER_CREATE, FILE_FOLDER_DELETE, FILE_FOLDER_RENAME, FILE_UPDATE, FILES_MOVE } from '../../graphql';
import { gidToNum } from '../../format';
import { useI18n } from '../../i18n';
import type { Key } from '../../i18n';
import { useDebounced } from '../../lib/hooks';
import type { Connection } from '../../lib/hooks';
import { StoreActions } from './Themes';

interface Ref { type: 'PRODUCT' | 'COLLECTION' | 'ARTICLE' | 'THEME'; id: string | null; title: string }
interface FolderRow { id: string; name: string; fileCount: number | null }
interface FileRow {
  id: string; alt: string | null; createdAt: string; mimeType?: string | null; image?: { url: string; width: number | null; height: number | null } | null;
  shopmeFilename: string | null; shopmeFileSize: number | null; shopmeReferences: Ref[]; shopmeFolder: { id: string; name: string } | null;
}
const nameOf = (f: FileRow) => f.shopmeFilename || decodeURIComponent((f.image?.url ?? '').split('?')[0]!.split('/').pop() ?? '') || f.id;
const REF_ORDER: Ref['type'][] = ['PRODUCT', 'COLLECTION', 'ARTICLE', 'THEME'];
const refLink = (r: Ref) => (r.type === 'PRODUCT' ? `/products/${r.id}` : r.type === 'COLLECTION' ? `/collections/${r.id}` : r.type === 'ARTICLE' ? `/online-store/blog-posts/${r.id}` : '/online-store/themes');
const formatBytes = (n: number | null, lang: string) => {
  if (n == null) return '';
  const nf = (v: number, unit: string) => `${new Intl.NumberFormat(lang, { maximumFractionDigits: 2 }).format(v)} ${unit}`;
  return n < 1024 ? nf(n, lang === 'fr' ? 'o' : 'B') : n < 1024 ** 2 ? nf(n / 1024, lang === 'fr' ? 'Ko' : 'KB') : nf(n / 1024 ** 2, lang === 'fr' ? 'Mo' : 'MB');
};
const folderNum = (id: string) => gidToNum(id);
const errText = (e: unknown) => (e instanceof UserErrors ? e.errors.map((x) => x.message).join(' · ') : (e as Error).message);

export function FilesPage() {
  const { t, lang } = useI18n();
  const toast = useToast();
  const qc = useQueryClient();
  const fmt = useFormat();
  const L = useListParams();
  const input = useRef<HTMLInputElement>(null);
  const [search, setSearch] = useState(L.get('q'));
  const term = useDebounced(search).trim();
  const kind = L.get('type');
  const folder = L.get('folder');
  const [selected, setSelected] = useState<string[]>([]);
  const [confirm, setConfirm] = useState<string[] | null>(null);
  const [edit, setEdit] = useState<{ file: FileRow; alt: string; folder: string } | null>(null);
  const [folderDialog, setFolderDialog] = useState<{ id: string | null; name: string } | null>(null);
  const [folderError, setFolderError] = useState<string | null>(null);
  const [folderDelete, setFolderDelete] = useState<FolderRow | null>(null);
  const [moving, setMoving] = useState<{ ids: string[]; folder: string } | null>(null);
  const query = [term, kind && `media_type:${kind}`, folder && `folder:${folder}`].filter(Boolean).join(' ');
  const list = useQuery({
    queryKey: ['files', query, L.get('after'), L.get('before')],
    queryFn: async () => (await gql<{ files: Connection<FileRow> }>(FILES, { query: query || null, ...L.page(25) })).files,
    placeholderData: (p) => p,
  });
  const folders = useQuery({ queryKey: ['file-folders'], queryFn: async () => (await gql<{ shopmeFileFolders: FolderRow[] }>(FILE_FOLDERS)).shopmeFileFolders });
  const currentFolder = folders.data?.find((f) => folderNum(f.id) === folder) ?? null;
  const refresh = () => { setSelected([]); void qc.invalidateQueries({ queryKey: ['files'] }); void qc.invalidateQueries({ queryKey: ['file-folders'] }); };
  const send = useMutation({
    mutationFn: async (files: File[]) => {
      for (const f of files) {
        const up = await upload<{ file: { url: string } }>('/files', f);
        const created = await mutate<{ files: { id: string }[] }>(FILE_CREATE, { files: [{ originalSource: up.file.url, contentType: f.type.startsWith('video/') ? 'VIDEO' : 'IMAGE', alt: '' }] }, 'fileCreate');
        if (currentFolder && created.files[0]) await mutate(FILES_MOVE, { fileIds: [created.files[0].id], folderId: currentFolder.id }, 'shopmeFilesMove');
      }
    },
    onSuccess: (_d, files) => { toast(t('files.uploaded', { n: files.length })); refresh(); }, onError: (e) => toast(errText(e), 'critical'),
  });
  const save = useMutation({
    mutationFn: async () => {
      await mutate(FILE_UPDATE, { files: [{ id: edit!.file.id, alt: edit!.alt }] }, 'fileUpdate');
      if ((edit!.file.shopmeFolder?.id ?? '') !== edit!.folder) await mutate(FILES_MOVE, { fileIds: [edit!.file.id], folderId: edit!.folder || null }, 'shopmeFilesMove');
    },
    onSuccess: () => { toast(t('files.saved')); setEdit(null); refresh(); }, onError: (e) => toast(errText(e), 'critical'),
  });
  const del = useMutation({
    mutationFn: (ids: string[]) => mutate(FILE_DELETE, { fileIds: ids }, 'fileDelete'),
    onSuccess: (_d, ids) => { toast(t('files.deleted', { n: ids.length })); setEdit(null); refresh(); }, onError: (e) => toast(errText(e), 'critical'),
  });
  const move = useMutation({
    mutationFn: (v: { ids: string[]; folder: string }) => mutate(FILES_MOVE, { fileIds: v.ids, folderId: v.folder || null }, 'shopmeFilesMove'),
    onSuccess: (_d, v) => { toast(t('files.moved', { n: v.ids.length })); setMoving(null); refresh(); }, onError: (e) => toast(errText(e), 'critical'),
  });
  const saveFolder = useMutation({
    mutationFn: () => (folderDialog!.id ? mutate(FILE_FOLDER_RENAME, { id: folderDialog!.id, name: folderDialog!.name }, 'shopmeFileFolderRename') : mutate(FILE_FOLDER_CREATE, { name: folderDialog!.name }, 'shopmeFileFolderCreate')),
    onSuccess: () => { toast(t('files.folderSaved')); setFolderDialog(null); setFolderError(null); refresh(); }, onError: (e) => setFolderError(errText(e)),
  });
  const removeFolder = useMutation({
    mutationFn: (f: FolderRow) => mutate(FILE_FOLDER_DELETE, { id: f.id }, 'shopmeFileFolderDelete'),
    onSuccess: () => { toast(t('files.folderDeleted')); setFolderDelete(null); L.patch({ folder: '' }, true); refresh(); }, onError: (e) => { setFolderDelete(null); toast(errText(e), 'critical'); },
  });
  const urlOf = (f: FileRow) => { const u = f.image?.url ?? ''; return u.startsWith('http') ? u : `${location.origin}${u}`; };
  const rows = list.data?.nodes ?? [];
  const chosen = rows.filter((r) => selected.includes(r.id));
  const copy = (f: FileRow) => { void navigator.clipboard?.writeText(urlOf(f)); toast(t('files.copied')); };
  const copyLinks = () => { void navigator.clipboard?.writeText(chosen.map(urlOf).join('\n')); toast(t('files.linksCopied', { n: chosen.length })); };
  const download = (files: FileRow[]) => {
    files.forEach((f, i) => setTimeout(() => {
      const a = document.createElement('a');
      a.href = f.image?.url ?? ''; a.download = nameOf(f); a.rel = 'noopener';
      document.body.appendChild(a); a.click(); a.remove();
    }, i * 250));
    toast(t('files.downloading', { n: files.length }));
  };

  const refCell = (f: FileRow) => {
    const counts = REF_ORDER.map((type) => [type, f.shopmeReferences.filter((r) => r.type === type).length] as const).filter(([, n]) => n > 0);
    if (!counts.length) return <span className="text-muted">{t('files.noReferences')}</span>;
    return <span>{counts.map(([type, n]) => (type === 'THEME' ? t('files.ref.THEME') : t(`files.ref.${type}` as Key, { n }))).join(', ')}</span>;
  };
  const columns: Array<Column<FileRow>> = [
    { key: 'name', header: t('files.name'), cell: (f) => (
      <span className="flex items-center gap-3">
        {f.image?.url ? <img src={f.image.url} alt="" className="size-10 rounded-md border border-line object-cover" /> : <span className="grid size-10 place-items-center rounded-md border border-line text-muted"><FileImage className="size-5" /></span>}
        <span className="min-w-0"><span className="block truncate font-medium">{nameOf(f)}</span><span className="text-xs uppercase text-muted">{(f.mimeType ?? '').split('/')[1] ?? ''}{f.shopmeFolder && !folder ? ` · ${f.shopmeFolder.name}` : ''}</span></span>
      </span>) },
    { key: 'alt', header: t('files.alt'), className: 'max-w-xs', cell: (f) => <span className="line-clamp-1 text-muted">{f.alt || '—'}</span> },
    { key: 'date', header: t('files.added'), cell: (f) => fmt.dateTime(f.createdAt) },
    { key: 'size', header: t('files.size'), className: 'whitespace-nowrap text-right', cell: (f) => formatBytes(f.shopmeFileSize, lang) || '—' },
    { key: 'refs', header: t('files.references'), cell: refCell },
  ];
  const pi = list.data?.pageInfo;
  const add = <Button variant="primary" loading={send.isPending} onClick={() => input.current?.click()}><Plus className="size-4" />{t('files.add')}</Button>;
  const newFolder = <Button onClick={() => { setFolderError(null); setFolderDialog({ id: null, name: '' }); }}><FolderPlus className="size-4" />{t('files.newFolder')}</Button>;
  const more = (
    <Dropdown align="right" icon variant="secondary" label={t('files.moreActions')} trigger={<MoreHorizontal className="size-4" />}
      items={[
        { key: 'download', label: t('files.downloadSelected'), icon: <Download className="size-4" />, disabled: !chosen.length, onSelect: () => download(chosen) },
        { key: 'copy', label: t('files.copyLinks'), icon: <Copy className="size-4" />, disabled: !chosen.length, onSelect: copyLinks },
        ...(currentFolder ? [
          { key: 'rename', label: t('files.renameFolder'), icon: <Pencil className="size-4" />, onSelect: () => { setFolderError(null); setFolderDialog({ id: currentFolder.id, name: currentFolder.name }); } },
          { key: 'deleteFolder', label: t('files.deleteFolder'), danger: true, icon: <Trash2 className="size-4" />, onSelect: () => setFolderDelete(currentFolder) },
        ] : []),
      ]} />
  );
  const chip = (key: string, label: string, count?: number | null) => (
    <button key={key || 'all'} type="button" aria-pressed={folder === key} onClick={() => L.patch({ folder: key }, true)}
      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs ${folder === key ? 'border-primary bg-primary-subtle font-medium' : 'border-line hover:bg-surface'}`}>
      {key !== '' && key !== 'none' && <Folder className="size-3.5" />}{label}{count != null && <span className="text-muted">{count}</span>}
    </button>
  );
  return (
    <div className="flex flex-col gap-4">
      <StoreActions>{more}{newFolder}{add}</StoreActions>
      <input ref={input} type="file" accept="image/*,video/*" multiple hidden aria-label={t('files.add')} onChange={(e) => { const f = Array.from(e.target.files ?? []); if (f.length) send.mutate(f); e.target.value = ''; }} />
      {(folders.data?.length ?? 0) > 0 && (
        <nav aria-label={t('files.folder')} className="flex flex-wrap gap-2">
          {chip('', t('files.allFiles'))}{chip('none', t('files.root'))}{folders.data!.map((f) => chip(folderNum(f.id), f.name, f.fileCount))}
        </nav>
      )}
      <Card className="!p-0">
        <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
          <select aria-label={t('files.type')} value={kind} onChange={(e) => L.patch({ type: e.target.value })} className={selectCls}>
            <option value="">{t('files.type.all')}</option><option value="IMAGE">{t('files.type.image')}</option><option value="VIDEO">{t('files.type.video')}</option>
          </select>
          <div className="relative min-w-48 flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-2 size-4 text-muted" />
            <input type="search" value={search} onChange={(e) => { setSearch(e.target.value); L.patch({ q: e.target.value }); }} placeholder={t('files.search')} aria-label={t('files.search')} className={searchCls} />
          </div>
        </div>
        {list.isError && <div className="p-3"><Banner>{(list.error as Error).message}</Banner></div>}
        <IndexTable rows={rows} rowId={(r) => r.id} columns={columns} loading={list.isLoading} onRowClick={(f) => setEdit({ file: f, alt: f.alt ?? '', folder: f.shopmeFolder?.id ?? '' })}
          selected={selected} onSelectedChange={setSelected} selectedLabel={(n) => t('common.selected', { n })} selectAllLabel={t('common.selectAll')}
          bulkActions={[
            { key: 'download', label: t('files.download'), onRun: (ids) => download(rows.filter((r) => ids.includes(r.id))) },
            { key: 'move', label: t('files.moveTo'), onRun: (ids) => setMoving({ ids, folder: '' }) },
            { key: 'delete', label: t('common.delete'), danger: true, onRun: setConfirm },
          ]}
          empty={list.isError ? null : <EmptyState icon={<FileImage className="size-10" />} title={t(query ? 'content.noResults' : 'files.emptyTitle')} description={t(query ? 'content.noResultsBody' : 'files.emptyBody')} action={query ? undefined : add} />} />
        <Pagination hasPrevious={L.get('before') ? !!pi?.hasPreviousPage : !!L.get('after')} hasNext={L.get('before') ? true : !!pi?.hasNextPage} previousLabel={t('common.previous')} nextLabel={t('common.next')}
          onPrevious={() => L.patch({ before: pi?.startCursor ?? '', after: '' }, true)} onNext={() => L.patch({ after: pi?.endCursor ?? '', before: '' }, true)} />
      </Card>
      <Modal open={!!edit} onClose={() => setEdit(null)} closeLabel={t('common.close')} title={edit ? nameOf(edit.file) : ''}
        footer={edit && <><Button variant="critical" onClick={() => setConfirm([edit.file.id])}>{t('common.delete')}</Button><span className="flex-1" /><Button onClick={() => copy(edit.file)}><Copy className="size-4" />{t('files.copyLink')}</Button><Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>{t('save.save')}</Button></>}>
        {edit && <div className="flex flex-col gap-3">
          {edit.file.image?.url && <img src={edit.file.image.url} alt={edit.alt} className="max-h-64 w-fit rounded-md border border-line object-contain" />}
          <Input label={t('files.alt')} value={edit.alt} onChange={(e) => setEdit({ ...edit, alt: e.target.value })} />
          <Select label={t('files.folder')} value={edit.folder} onChange={(e) => setEdit({ ...edit, folder: e.target.value })}>
            <option value="">{t('files.root')}</option>{(folders.data ?? []).map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
          </Select>
          <div className="text-[13px]">
            <p className="mb-1 font-medium">{t('files.refsTitle')}</p>
            {edit.file.shopmeReferences.length === 0 ? <p className="text-muted">{t('files.noReferences')}</p> : (
              <ul className="flex flex-col gap-1">{edit.file.shopmeReferences.map((r) => <li key={`${r.type}${r.id}${r.title}`}><Link className="text-accent hover:underline" to={refLink(r)} onClick={() => setEdit(null)}>{r.title}</Link></li>)}</ul>
            )}
          </div>
        </div>}
      </Modal>
      <Modal open={!!folderDialog} onClose={() => setFolderDialog(null)} closeLabel={t('common.close')} title={t(folderDialog?.id ? 'files.renameFolder' : 'files.newFolder')}
        footer={<><Button onClick={() => setFolderDialog(null)}>{t('common.cancel')}</Button><Button variant="primary" loading={saveFolder.isPending} disabled={!folderDialog?.name.trim()} onClick={() => saveFolder.mutate()}>{t(folderDialog?.id ? 'save.save' : 'files.createFolder')}</Button></>}>
        <div className="flex flex-col gap-3">
          {folderError && <Banner>{folderError}</Banner>}
          <Input label={t('files.folderName')} value={folderDialog?.name ?? ''} autoFocus onChange={(e) => setFolderDialog((d) => d && { ...d, name: e.target.value })}
            onKeyDown={(e) => { if (e.key === 'Enter' && folderDialog?.name.trim()) saveFolder.mutate(); }} />
        </div>
      </Modal>
      <Modal open={!!moving} onClose={() => setMoving(null)} closeLabel={t('common.close')} title={t('files.moveTo')}
        footer={<><Button onClick={() => setMoving(null)}>{t('common.cancel')}</Button><Button variant="primary" loading={move.isPending} onClick={() => moving && move.mutate(moving)}>{t('files.moveTo')}</Button></>}>
        {moving && <Select label={t('files.folder')} value={moving.folder} onChange={(e) => setMoving({ ...moving, folder: e.target.value })}>
          <option value="">{t('files.root')}</option>{(folders.data ?? []).map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
        </Select>}
      </Modal>
      <ConfirmDialog open={!!folderDelete} onClose={() => setFolderDelete(null)} danger title={t('files.deleteFolderTitle', { name: folderDelete?.name ?? '' })} message={(folderDelete?.fileCount ?? 0) > 0 ? t('files.folderNotEmpty') : t('files.deleteFolderBody')} confirmLabel={t('common.delete')} cancelLabel={t('common.cancel')}
        onConfirm={() => folderDelete && removeFolder.mutate(folderDelete)} />
      <ConfirmDialog open={!!confirm} onClose={() => setConfirm(null)} danger title={t('files.deleteTitle', { n: confirm?.length ?? 0 })} message={t('files.deleteBody')} confirmLabel={t('common.delete')} cancelLabel={t('common.cancel')}
        onConfirm={() => { if (confirm) del.mutate(confirm); setConfirm(null); }} />
    </div>
  );
}
