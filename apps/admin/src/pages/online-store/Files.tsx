import { Banner, Button, Card, ConfirmDialog, EmptyState, IndexTable, Input, Modal, Pagination, useToast } from '@shopme/ui';
import type { Column } from '@shopme/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, FileImage, Plus, Search } from 'lucide-react';
import { useRef, useState } from 'react';
import { UserErrors, gql, mutate, upload } from '../../api';
import { searchCls, selectCls, useFormat, useListParams } from '../../components/shared';
import { FILES, FILE_CREATE, FILE_DELETE, FILE_UPDATE } from '../../graphql';
import { useI18n } from '../../i18n';
import { useDebounced } from '../../lib/hooks';
import type { Connection } from '../../lib/hooks';
import { StoreActions } from './Themes';

interface FileRow { id: string; alt: string | null; createdAt: string; mimeType?: string | null; image?: { url: string; width: number | null; height: number | null } | null }
const nameOf = (f: FileRow) => decodeURIComponent((f.image?.url ?? '').split('?')[0]!.split('/').pop() ?? '') || f.id;
const errText = (e: unknown) => (e instanceof UserErrors ? e.errors.map((x) => x.message).join(' · ') : (e as Error).message);

export function FilesPage() {
  const { t } = useI18n();
  const toast = useToast();
  const qc = useQueryClient();
  const fmt = useFormat();
  const L = useListParams();
  const input = useRef<HTMLInputElement>(null);
  const [search, setSearch] = useState(L.get('q'));
  const term = useDebounced(search).trim();
  const kind = L.get('type');
  const [selected, setSelected] = useState<string[]>([]);
  const [confirm, setConfirm] = useState<string[] | null>(null);
  const [edit, setEdit] = useState<{ file: FileRow; alt: string } | null>(null);
  const query = [term, kind && `media_type:${kind}`].filter(Boolean).join(' ');
  const list = useQuery({
    queryKey: ['files', query, L.get('after'), L.get('before')],
    queryFn: async () => (await gql<{ files: Connection<FileRow> }>(FILES, { query: query || null, ...L.page(25) })).files,
    placeholderData: (p) => p,
  });
  const refresh = () => { setSelected([]); void qc.invalidateQueries({ queryKey: ['files'] }); };
  const send = useMutation({
    mutationFn: async (files: File[]) => {
      for (const f of files) {
        const up = await upload<{ file: { url: string } }>('/files', f);
        await mutate(FILE_CREATE, { files: [{ originalSource: up.file.url, contentType: f.type.startsWith('video/') ? 'VIDEO' : 'IMAGE', alt: '' }] }, 'fileCreate');
      }
    },
    onSuccess: (_d, files) => { toast(t('files.uploaded', { n: files.length })); refresh(); }, onError: (e) => toast(errText(e), 'critical'),
  });
  const save = useMutation({
    mutationFn: () => mutate(FILE_UPDATE, { files: [{ id: edit!.file.id, alt: edit!.alt }] }, 'fileUpdate'),
    onSuccess: () => { toast(t('files.saved')); setEdit(null); refresh(); }, onError: (e) => toast(errText(e), 'critical'),
  });
  const del = useMutation({
    mutationFn: (ids: string[]) => mutate(FILE_DELETE, { fileIds: ids }, 'fileDelete'),
    onSuccess: (_d, ids) => { toast(t('files.deleted', { n: ids.length })); setEdit(null); refresh(); }, onError: (e) => toast(errText(e), 'critical'),
  });
  const copy = (f: FileRow) => { const u = f.image?.url ?? ''; void navigator.clipboard?.writeText(u.startsWith('http') ? u : `${location.origin}${u}`); toast(t('files.copied')); };

  const columns: Array<Column<FileRow>> = [
    { key: 'name', header: t('files.name'), cell: (f) => (
      <span className="flex items-center gap-3">
        {f.image?.url ? <img src={f.image.url} alt="" className="size-10 rounded-md border border-line object-cover" /> : <span className="grid size-10 place-items-center rounded-md border border-line text-muted"><FileImage className="size-5" /></span>}
        <span className="min-w-0"><span className="block truncate font-medium">{nameOf(f)}</span><span className="text-xs uppercase text-muted">{(f.mimeType ?? '').split('/')[1] ?? ''}</span></span>
      </span>) },
    { key: 'alt', header: t('files.alt'), className: 'max-w-xs', cell: (f) => <span className="line-clamp-1 text-muted">{f.alt || '—'}</span> },
    { key: 'date', header: t('files.added'), cell: (f) => fmt.dateTime(f.createdAt) },
    { key: 'size', header: t('files.dimensions'), cell: (f) => (f.image?.width ? `${f.image.width} × ${f.image.height}` : '—') },
  ];
  const pi = list.data?.pageInfo;
  const add = <Button variant="primary" loading={send.isPending} onClick={() => input.current?.click()}><Plus className="size-4" />{t('files.add')}</Button>;
  return (
    <div className="flex flex-col gap-4">
      <StoreActions>{add}</StoreActions>
      <input ref={input} type="file" accept="image/*,video/*" multiple hidden aria-label={t('files.add')} onChange={(e) => { const f = Array.from(e.target.files ?? []); if (f.length) send.mutate(f); e.target.value = ''; }} />
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
        <IndexTable rows={list.data?.nodes ?? []} rowId={(r) => r.id} columns={columns} loading={list.isLoading} onRowClick={(f) => setEdit({ file: f, alt: f.alt ?? '' })}
          selected={selected} onSelectedChange={setSelected} selectedLabel={(n) => t('common.selected', { n })} selectAllLabel={t('common.selectAll')}
          bulkActions={[{ key: 'delete', label: t('common.delete'), danger: true, onRun: setConfirm }]}
          empty={list.isError ? null : <EmptyState icon={<FileImage className="size-10" />} title={t(query ? 'content.noResults' : 'files.emptyTitle')} description={t(query ? 'content.noResultsBody' : 'files.emptyBody')} action={query ? undefined : add} />} />
        <Pagination hasPrevious={L.get('before') ? !!pi?.hasPreviousPage : !!L.get('after')} hasNext={L.get('before') ? true : !!pi?.hasNextPage} previousLabel={t('common.previous')} nextLabel={t('common.next')}
          onPrevious={() => L.patch({ before: pi?.startCursor ?? '', after: '' }, true)} onNext={() => L.patch({ after: pi?.endCursor ?? '', before: '' }, true)} />
      </Card>
      <Modal open={!!edit} onClose={() => setEdit(null)} closeLabel={t('common.close')} title={edit ? nameOf(edit.file) : ''}
        footer={edit && <><Button variant="critical" onClick={() => setConfirm([edit.file.id])}>{t('common.delete')}</Button><span className="flex-1" /><Button onClick={() => copy(edit.file)}><Copy className="size-4" />{t('files.copyLink')}</Button><Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>{t('save.save')}</Button></>}>
        {edit && <div className="flex flex-col gap-3">
          {edit.file.image?.url && <img src={edit.file.image.url} alt={edit.alt} className="max-h-64 w-fit rounded-md border border-line object-contain" />}
          <Input label={t('files.alt')} value={edit.alt} onChange={(e) => setEdit({ ...edit, alt: e.target.value })} />
        </div>}
      </Modal>
      <ConfirmDialog open={!!confirm} onClose={() => setConfirm(null)} danger title={t('files.deleteTitle', { n: confirm?.length ?? 0 })} message={t('files.deleteBody')} confirmLabel={t('common.delete')} cancelLabel={t('common.cancel')}
        onConfirm={() => { if (confirm) del.mutate(confirm); setConfirm(null); }} />
    </div>
  );
}
