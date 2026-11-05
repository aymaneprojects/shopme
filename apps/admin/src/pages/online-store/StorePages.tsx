import { Badge, Banner, Button, Card, ConfirmDialog, EmptyState, IndexTable, Input, Pagination, RichTextEditor, Skeleton, Switch, useToast } from '@shopme/ui';
import type { Column } from '@shopme/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileText, Plus } from 'lucide-react';
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { UserErrors, gql, mutate } from '../../api';
import { PageHeader } from '../../components/PageHeader';
import { SaveBar, guard } from '../../components/SaveBar';
import { useFormat, useListParams } from '../../components/shared';
import { gidToNum, numToGid } from '../../format';
import { PAGE, PAGES, PAGE_CREATE, PAGE_DELETE, PAGE_UPDATE } from '../../graphql';
import { useI18n } from '../../i18n';
import type { Connection } from '../../lib/hooks';

interface PageRow { id: string; title: string; handle: string; isPublished: boolean; updatedAt: string }

export function PagesListPage() {
  const { t } = useI18n();
  const nav = useNavigate();
  const fmt = useFormat();
  const L = useListParams();
  const list = useQuery({ queryKey: ['pages', L.get('after'), L.get('before')], queryFn: () => gql<{ pages: Connection<PageRow> }>(PAGES, L.page(25)), placeholderData: (p) => p });
  const pi = list.data?.pages.pageInfo;
  const columns: Array<Column<PageRow>> = [
    { key: 'title', header: t('field.title'), cell: (p) => <span className="font-medium">{p.title}</span> },
    { key: 'status', header: t('field.status'), cell: (p) => <Badge tone={p.isPublished ? 'success' : 'neutral'}>{t(p.isPublished ? 'pages.visible' : 'pages.hidden')}</Badge> },
    { key: 'updated', header: t('pages.updated'), cell: (p) => fmt.date(p.updatedAt) },
  ];
  const add = <Button variant="primary" onClick={() => nav('/online-store/pages/new')}><Plus className="size-4" />{t('pages.add')}</Button>;
  return (
    <Card className="!p-0">
      <div className="flex items-center justify-between border-b border-line p-3"><h2 className="text-[13px] font-semibold">{t('store.pages')}</h2>{add}</div>
      {list.isError && <div className="p-3"><Banner>{(list.error as Error).message}</Banner></div>}
      <IndexTable rows={list.data?.pages.nodes ?? []} rowId={(r) => r.id} columns={columns} loading={list.isLoading} onRowClick={(r) => nav(`/online-store/pages/${gidToNum(r.id)}`)}
        empty={list.isError ? null : <EmptyState icon={<FileText className="size-10" />} title={t('pages.emptyTitle')} description={t('pages.emptyBody')} action={add} />} />
      <Pagination hasPrevious={L.get('before') ? !!pi?.hasPreviousPage : !!L.get('after')} hasNext={L.get('before') ? true : !!pi?.hasNextPage} previousLabel={t('common.previous')} nextLabel={t('common.next')}
        onPrevious={() => L.patch({ before: pi?.startCursor ?? '', after: '' }, true)} onNext={() => L.patch({ after: pi?.endCursor ?? '', before: '' }, true)} />
    </Card>
  );
}

interface PageForm { title: string; handle: string; body: string; isPublished: boolean }
const blank: PageForm = { title: '', handle: '', body: '', isPublished: true };

export function PageEditPage() {
  const { id = 'new' } = useParams();
  const isNew = id === 'new';
  const { t } = useI18n();
  const gid = numToGid('Page', id);
  const q = useQuery({ queryKey: ['page', gid], enabled: !isNew, queryFn: () => gql<{ page: (PageForm & { id: string }) | null }>(PAGE, { id: gid }) });
  if (!isNew && q.isLoading) return <Skeleton className="h-64" />;
  if (q.error) return <Banner>{q.error.message}</Banner>;
  if (!isNew && !q.data?.page) return <Banner>{t('pages.notFound')}</Banner>;
  const p = q.data?.page;
  return <PageFormView key={`${id}:${q.dataUpdatedAt}`} id={p ? gid : null} initial={p ? { title: p.title, handle: p.handle, body: p.body, isPublished: p.isPublished } : blank} />;
}

function PageFormView({ id, initial }: { id: string | null; initial: PageForm }) {
  const { t } = useI18n();
  const nav = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();
  const [form, setForm] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [titleErr, setTitleErr] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const set = (p: Partial<PageForm>) => setForm((f) => ({ ...f, ...p }));
  const dirty = JSON.stringify(form) !== JSON.stringify(initial);
  const save = useMutation({
    mutationFn: async () => {
      if (!form.title.trim()) { setTitleErr(t('collection.titleRequired')); throw new Error('validation'); }
      setTitleErr(null); setError(null);
      const page = { title: form.title.trim(), body: form.body, isPublished: form.isPublished, ...(form.handle.trim() && { handle: form.handle.trim() }) };
      if (id) { await mutate(PAGE_UPDATE, { id, page }, 'pageUpdate'); return id; }
      return (await mutate<{ page: { id: string } }>(PAGE_CREATE, { page }, 'pageCreate')).page.id;
    },
    onSuccess: (pid) => { toast(t('pages.saved')); void qc.invalidateQueries({ queryKey: ['pages'] }); void qc.invalidateQueries({ queryKey: ['page'] }); if (!id) { guard.off = true; nav(`/online-store/pages/${gidToNum(pid)}`, { replace: true }); } },
    onError: (e) => { if (e.message !== 'validation') setError(e instanceof UserErrors ? e.errors.map((x) => x.message).join(' · ') : e.message); },
  });
  const del = useMutation({ mutationFn: () => mutate(PAGE_DELETE, { id }, 'pageDelete'), onSuccess: () => { void qc.invalidateQueries({ queryKey: ['pages'] }); guard.off = true; nav('/online-store/pages'); }, onError: (e) => toast(e.message, 'critical') });
  return (
    <>
      <SaveBar dirty={dirty} saving={save.isPending} onSave={() => save.mutate()} onDiscard={() => { setForm(initial); setTitleErr(null); }} />
      <PageHeader back="/online-store/pages" title={id ? form.title || t('pages.untitled') : t('pages.add')}
        actions={<>{id && <Button variant="danger" onClick={() => setConfirm(true)}>{t('common.delete')}</Button>}{!id && <Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>{t('save.save')}</Button>}</>} />
      {error && <div className="mb-4"><Banner>{error}</Banner></div>}
      <div className="grid gap-4 lg:grid-cols-[1fr_18rem]">
        <Card>
          <div className="flex flex-col gap-3">
            <Input label={t('field.title')} required value={form.title} error={titleErr} onChange={(e) => set({ title: e.target.value })} />
            <div className="flex flex-col gap-1"><span className="text-[13px] font-medium">{t('pages.content')}</span>
              <RichTextEditor value={form.body} onChange={(body) => set({ body })}
                labels={{ bold: t('rte.bold'), italic: t('rte.italic'), underline: t('rte.underline'), list: t('rte.list'), orderedList: t('rte.orderedList'), link: t('rte.link'), source: t('rte.source'), paragraph: t('rte.paragraph'), heading: t('rte.heading'), subheading: t('rte.subheading'), linkPrompt: t('rte.linkPrompt') }} /></div>
          </div>
        </Card>
        <div className="flex flex-col gap-4">
          <Card title={t('pages.visibility')}><Switch checked={form.isPublished} onChange={(v) => set({ isPublished: v })} label={t('pages.visible')} /></Card>
          <Card title={t('product.handle')}><Input aria-label={t('product.handle')} value={form.handle} onChange={(e) => set({ handle: e.target.value })} /></Card>
        </div>
      </div>
      <ConfirmDialog open={confirm} onClose={() => setConfirm(false)} danger title={t('pages.deleteTitle')} message={t('pages.deleteBody')} confirmLabel={t('common.delete')} cancelLabel={t('common.cancel')} onConfirm={() => { setConfirm(false); del.mutate(); }} />
    </>
  );
}
