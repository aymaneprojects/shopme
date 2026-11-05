import { Badge, Banner, Button, ConfirmDialog, EmptyState, Input, Skeleton, Card, useToast } from '@shopme/ui';
import type { Column } from '@shopme/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileText, Plus, Search } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { UserErrors, gql, mutate } from '../../api';
import { PageHeader } from '../../components/PageHeader';
import { SaveBar, guard } from '../../components/SaveBar';
import { RichText } from '../../components/RichText';
import { SeoListing } from '../../components/SeoListing';
import { TemplateCard, VisibilityCard, toLocalInput, visibilityInput } from '../../components/PublishCards';
import { VisibilityList } from '../../components/VisibilityList';
import { useFormat } from '../../components/shared';
import { gidToNum, numToGid } from '../../format';
import { PAGE, PAGES, PAGE_CREATE, PAGE_DELETE, PAGE_UPDATE, STORE_ACCESS } from '../../graphql';
import { useI18n } from '../../i18n';
import { StoreActions } from './Themes';

interface PageRow { id: string; title: string; handle: string; body: string; isPublished: boolean; updatedAt: string }
const excerpt = (html: string) => html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

/** Warning strip shown on the Pages list while the storefront is behind a password. */
function RestrictedAccess() {
  const { t } = useI18n();
  const q = useQuery({ queryKey: ['store-access'], queryFn: () => gql<{ shop: { shopmeStorefront: { passwordEnabled: boolean } } }>(STORE_ACCESS) });
  if (!q.data?.shop.shopmeStorefront.passwordEnabled) return null;
  return (
    <Banner tone="warning">
      <div className="flex flex-wrap items-center gap-2"><span><strong>{t('access.restricted')}</strong> {t('access.restrictedBody')}</span>
        <Link to="/online-store/preferences" className="btn btn-secondary btn-sm ml-auto">{t('access.manage')}</Link></div>
    </Banner>
  );
}

export function PagesListPage() {
  const { t } = useI18n();
  const nav = useNavigate();
  const fmt = useFormat();
  const columns: Array<Column<PageRow>> = [
    { key: 'title', header: t('field.title'), cell: (p) => <span className="font-medium">{p.title}</span> },
    { key: 'status', header: t('pages.visibility'), cell: (p) => <Badge tone={p.isPublished ? 'success' : 'neutral'}>{t(p.isPublished ? 'pages.visible' : 'pages.hidden')}</Badge> },
    { key: 'content', header: t('pages.content'), className: 'max-w-md', cell: (p) => <span className="line-clamp-1 text-muted">{excerpt(p.body)}</span> },
    { key: 'updated', header: t('pages.updated'), cell: (p) => fmt.dateTime(p.updatedAt) },
  ];
  const add = <Button variant="primary" onClick={() => nav('/online-store/pages/new')}><Plus className="size-4" />{t('pages.add')}</Button>;
  return (
    <div className="flex flex-col gap-4">
      <StoreActions>{add}</StoreActions>
      <RestrictedAccess />
      <VisibilityList<PageRow> queryKey="pages" doc={PAGES} root="pages" columns={columns} searchLabel={t('pages.search')}
        sorts={[{ key: 'UPDATED_AT', label: t('pages.updated') }, { key: 'TITLE', label: t('field.title') }]}
        onRowClick={(r) => nav(`/online-store/pages/${gidToNum(r.id)}`)}
        setVisible={{ doc: PAGE_UPDATE, field: 'pageUpdate', vars: (id, v) => ({ id, page: { isPublished: v } }) }}
        remove={{ doc: PAGE_DELETE, field: 'pageDelete', vars: (id) => ({ id }) }}
        deleteTitle={(n) => t('pages.deleteManyTitle', { n })} deleteBody={t('pages.deleteBody')}
        noResults={<EmptyState icon={<Search className="size-10" />} title={t('content.noResults')} description={t('content.noResultsBody')} />}
        empty={<EmptyState icon={<FileText className="size-10" />} title={t('pages.emptyTitle')} description={t('pages.emptyBody')} action={add} />} />
    </div>
  );
}

interface PageForm { title: string; handle: string; body: string; isPublished: boolean; publishDate: string; publishedAt: string | null; templateSuffix: string; seoTitle: string; seoDescription: string }
interface PageData { id: string; title: string; handle: string; body: string; isPublished: boolean; publishedAt: string | null; templateSuffix: string | null; seo: { title: string | null; description: string | null } }
const blank: PageForm = { title: '', handle: '', body: '', isPublished: false, publishDate: '', publishedAt: null, templateSuffix: '', seoTitle: '', seoDescription: '' };

export function PageEditPage() {
  const { id = 'new' } = useParams();
  const isNew = id === 'new';
  const { t } = useI18n();
  const gid = numToGid('Page', id);
  const q = useQuery({ queryKey: ['page', gid], enabled: !isNew, queryFn: () => gql<{ page: PageData | null }>(PAGE, { id: gid }) });
  if (!isNew && q.isLoading) return <Skeleton className="h-64" />;
  if (q.error) return <Banner>{q.error.message}</Banner>;
  if (!isNew && !q.data?.page) return <Banner>{t('pages.notFound')}</Banner>;
  const p = q.data?.page;
  return <PageFormView key={`${id}:${q.dataUpdatedAt}`} id={p ? gid : null} initial={p ? {
    title: p.title, handle: p.handle, body: p.body, isPublished: p.publishedAt != null, publishDate: p.publishedAt && new Date(p.publishedAt) > new Date() ? toLocalInput(p.publishedAt) : '', publishedAt: p.publishedAt,
    templateSuffix: p.templateSuffix ?? '', seoTitle: p.seo.title ?? '', seoDescription: p.seo.description ?? '',
  } : blank} />;
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
      const page = {
        title: form.title.trim(), body: form.body, ...visibilityInput(form, initial), templateSuffix: form.templateSuffix || null, seo: { title: form.seoTitle.trim() || null, description: form.seoDescription.trim() || null },
        ...(form.handle.trim() && { handle: form.handle.trim() }),
      };
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
      <PageHeader back="/online-store/pages" title={id ? form.title || t('pages.untitled') : t('pages.addTitle')}
        more={id ? [{ key: 'view', label: t('pages.viewOnStore'), onSelect: () => window.open(`/pages/${form.handle}`, '_blank', 'noopener') }, { key: 'delete', label: t('common.delete'), danger: true, onSelect: () => setConfirm(true) }] : undefined} />
      {error && <div className="mb-4"><Banner>{error}</Banner></div>}
      <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
        <div className="flex flex-col gap-4">
          <Card>
            <div className="flex flex-col gap-3">
              <Input label={t('field.title')} required placeholder={t('pages.titlePlaceholder')} value={form.title} error={titleErr} onChange={(e) => set({ title: e.target.value })} />
              <div className="flex flex-col gap-1"><span className="text-[13px] font-medium">{t('pages.content')}</span>
                <RichText value={form.body} onChange={(body) => set({ body })} /></div>
            </div>
          </Card>
          <SeoListing title={form.title} prefix="/pages/" handle={form.handle} onHandle={(handle) => set({ handle })} description={form.body}
            seoTitle={form.seoTitle} onSeoTitle={(seoTitle) => set({ seoTitle })} seoDescription={form.seoDescription} onSeoDescription={(seoDescription) => set({ seoDescription })} />
        </div>
        <div className="flex flex-col gap-4">
          <VisibilityCard value={form} onChange={(v) => set(v)} />
          <TemplateCard kind="page" value={form.templateSuffix} onChange={(templateSuffix) => set({ templateSuffix })} />
        </div>
      </div>
      <ConfirmDialog open={confirm} onClose={() => setConfirm(false)} danger title={t('pages.deleteTitle')} message={t('pages.deleteBody')} confirmLabel={t('common.delete')} cancelLabel={t('common.cancel')} onConfirm={() => { setConfirm(false); del.mutate(); }} />
    </>
  );
}
