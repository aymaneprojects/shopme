import { Badge, Banner, Button, Card, ConfirmDialog, EmptyState, ImageUploader, Input, Modal, RichTextEditor, Select, Skeleton, Switch, TagInput, Textarea, useToast } from '@shopme/ui';
import type { Column } from '@shopme/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileText, Pencil, Plus } from 'lucide-react';
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { UserErrors, gql, mutate } from '../../api';
import { PageHeader } from '../../components/PageHeader';
import { PagedTable } from '../../components/PagedTable';
import { SaveBar, guard } from '../../components/SaveBar';
import { useFormat } from '../../components/shared';
import { gidToNum, numToGid } from '../../format';
import { ARTICLE, ARTICLES, ARTICLE_CREATE, ARTICLE_DELETE, ARTICLE_UPDATE, BLOGS, BLOG_CREATE, BLOG_DELETE, BLOG_UPDATE } from '../../graphql';
import { useI18n } from '../../i18n';
import { useShop } from '../../session';

interface Blog { id: string; title: string; handle: string }
const useBlogs = () => useQuery({ queryKey: ['blogs'], queryFn: () => gql<{ blogs: { nodes: Blog[] } }>(BLOGS) });
const errText = (e: unknown) => (e instanceof UserErrors ? e.errors.map((x) => x.message).join(' · ') : (e as Error).message);

interface ArticleRow { id: string; title: string; isPublished: boolean; updatedAt: string; tags: string[]; author: { name: string } | null; blog: { id: string; title: string } | null }

export function BlogPostsPage() {
  const { t } = useI18n();
  const nav = useNavigate();
  const fmt = useFormat();
  const columns: Array<Column<ArticleRow>> = [
    { key: 'title', header: t('field.title'), cell: (a) => <span className="font-medium">{a.title}</span> },
    { key: 'blog', header: t('blogs.blog'), cell: (a) => a.blog?.title ?? '—' },
    { key: 'author', header: t('blogs.author'), cell: (a) => a.author?.name ?? '—' },
    { key: 'status', header: t('field.status'), cell: (a) => <Badge tone={a.isPublished ? 'success' : 'neutral'}>{t(a.isPublished ? 'pages.visible' : 'pages.hidden')}</Badge> },
    { key: 'updated', header: t('pages.updated'), cell: (a) => fmt.date(a.updatedAt) },
  ];
  const add = <Button variant="primary" onClick={() => nav('/online-store/blog-posts/new')}><Plus className="size-4" />{t('blogs.addPost')}</Button>;
  return (
    <PagedTable<ArticleRow> title={t('store.blogPosts')} doc={ARTICLES} root="articles" queryKey="articles" columns={columns} actions={add} searchLabel={t('blogs.searchPosts')}
      onRowClick={(r) => nav(`/online-store/blog-posts/${gidToNum(r.id)}`)}
      empty={<EmptyState icon={<FileText className="size-10" />} title={t('blogs.emptyTitle')} description={t('blogs.emptyBody')} action={add} />} />
  );
}

interface ArticleForm { title: string; handle: string; body: string; summary: string; author: string; tags: string[]; imageUrl: string; imageAlt: string; blogId: string; isPublished: boolean }
interface ArticleData { id: string; title: string; handle: string; body: string; summary: string | null; tags: string[]; isPublished: boolean; author: { name: string } | null; image: { url: string; altText: string | null } | null; blog: { id: string } | null }

export function BlogPostEditPage() {
  const { id = 'new' } = useParams();
  const isNew = id === 'new';
  const { t } = useI18n();
  const { user } = useShop();
  const gid = numToGid('Article', id);
  const q = useQuery({ queryKey: ['article', gid], enabled: !isNew, queryFn: () => gql<{ article: ArticleData | null }>(ARTICLE, { id: gid }) });
  const blogs = useBlogs();
  if ((!isNew && q.isLoading) || blogs.isLoading) return <Skeleton className="h-64" />;
  if (q.error) return <Banner>{q.error.message}</Banner>;
  if (!isNew && !q.data?.article) return <Banner>{t('blogs.notFound')}</Banner>;
  const a = q.data?.article;
  const initial: ArticleForm = a
    ? { title: a.title, handle: a.handle, body: a.body, summary: a.summary ?? '', author: a.author?.name ?? '', tags: a.tags, imageUrl: a.image?.url ?? '', imageAlt: a.image?.altText ?? '', blogId: a.blog?.id ?? '', isPublished: a.isPublished }
    : { title: '', handle: '', body: '', summary: '', author: `${user.firstName} ${user.lastName}`.trim(), tags: [], imageUrl: '', imageAlt: '', blogId: blogs.data?.blogs.nodes[0]?.id ?? '', isPublished: false };
  return <PostForm key={`${id}:${q.dataUpdatedAt}`} id={a ? gid : null} initial={initial} blogs={blogs.data?.blogs.nodes ?? []} />;
}

function PostForm({ id, initial, blogs }: { id: string | null; initial: ArticleForm; blogs: Blog[] }) {
  const { t } = useI18n();
  const nav = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();
  const [form, setForm] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const set = (p: Partial<ArticleForm>) => setForm((f) => ({ ...f, ...p }));
  const dirty = JSON.stringify(form) !== JSON.stringify(initial);
  const save = useMutation({
    mutationFn: async () => {
      if (!form.title.trim() || !form.blogId) { setError(t(form.blogId ? 'collection.titleRequired' : 'blogs.blogRequired')); throw new Error('validation'); }
      setError(null);
      const article = {
        blogId: form.blogId, title: form.title.trim(), body: form.body, summary: form.summary, tags: form.tags, isPublished: form.isPublished,
        ...(form.author.trim() && { author: { name: form.author.trim() } }), ...(form.handle.trim() && { handle: form.handle.trim() }),
        ...(form.imageUrl && { image: { url: form.imageUrl, altText: form.imageAlt } }),
      };
      if (id) { await mutate(ARTICLE_UPDATE, { id, article }, 'articleUpdate'); return id; }
      return (await mutate<{ article: { id: string } }>(ARTICLE_CREATE, { article }, 'articleCreate')).article.id;
    },
    onSuccess: (aid) => { toast(t('blogs.saved')); void qc.invalidateQueries({ queryKey: ['articles'] }); void qc.invalidateQueries({ queryKey: ['article'] }); if (!id) { guard.off = true; nav(`/online-store/blog-posts/${gidToNum(aid)}`, { replace: true }); } },
    onError: (e) => { if (e.message !== 'validation') setError(errText(e)); },
  });
  const del = useMutation({ mutationFn: () => mutate(ARTICLE_DELETE, { id }, 'articleDelete'), onSuccess: () => { void qc.invalidateQueries({ queryKey: ['articles'] }); guard.off = true; nav('/online-store/blog-posts'); }, onError: (e) => toast(e.message, 'critical') });
  const rte = { bold: t('rte.bold'), italic: t('rte.italic'), underline: t('rte.underline'), list: t('rte.list'), orderedList: t('rte.orderedList'), link: t('rte.link'), source: t('rte.source'), paragraph: t('rte.paragraph'), heading: t('rte.heading'), subheading: t('rte.subheading'), linkPrompt: t('rte.linkPrompt') };
  return (
    <>
      <SaveBar dirty={dirty} saving={save.isPending} onSave={() => save.mutate()} onDiscard={() => { setForm(initial); setError(null); }} />
      <PageHeader back="/online-store/blog-posts" title={id ? form.title || t('pages.untitled') : t('blogs.addPost')}
        actions={<>{id && <Button variant="danger" onClick={() => setConfirm(true)}>{t('common.delete')}</Button>}{!id && <Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>{t('save.save')}</Button>}</>} />
      {error && <div className="mb-4"><Banner>{error}</Banner></div>}
      <div className="grid gap-4 lg:grid-cols-[1fr_18rem]">
        <div className="flex flex-col gap-4">
          <Card><div className="flex flex-col gap-3">
            <Input label={t('field.title')} required value={form.title} onChange={(e) => set({ title: e.target.value })} />
            <div className="flex flex-col gap-1"><span className="text-sm font-medium">{t('pages.content')}</span><RichTextEditor value={form.body} onChange={(body) => set({ body })} labels={rte} /></div>
            <Textarea label={t('blogs.summary')} help={t('blogs.summaryHelp')} value={form.summary} onChange={(e) => set({ summary: e.target.value })} />
          </div></Card>
          <Card title={t('blogs.image')}>
            <div className="flex flex-col gap-3">
              {form.imageUrl && <img src={form.imageUrl} alt={form.imageAlt} className="max-h-48 w-fit rounded-md border border-line object-contain" />}
              <ImageUploader multiple={false} compact label={t('media.upload')} onUploaded={(f) => set({ imageUrl: f[0]!.url })} onError={(m) => toast(m, 'critical')} />
              {form.imageUrl && <><Input label={t('blogs.imageAlt')} value={form.imageAlt} onChange={(e) => set({ imageAlt: e.target.value })} /><Button size="sm" className="w-fit" onClick={() => set({ imageUrl: '', imageAlt: '' })}>{t('common.remove')}</Button></>}
            </div>
          </Card>
        </div>
        <div className="flex flex-col gap-4">
          <Card title={t('pages.visibility')}><Switch checked={form.isPublished} onChange={(v) => set({ isPublished: v })} label={t('pages.visible')} /></Card>
          <Card title={t('blogs.organization')}>
            <div className="flex flex-col gap-3">
              <Select label={t('blogs.blog')} value={form.blogId} onChange={(e) => set({ blogId: e.target.value })}>
                {!form.blogId && <option value="" />}{blogs.map((b) => <option key={b.id} value={b.id}>{b.title}</option>)}
              </Select>
              <Input label={t('blogs.author')} value={form.author} onChange={(e) => set({ author: e.target.value })} />
              <TagInput label={t('field.tags')} value={form.tags} onChange={(tags) => set({ tags })} removeLabel={t('common.remove')} />
              <Input label={t('product.handle')} value={form.handle} onChange={(e) => set({ handle: e.target.value })} />
            </div>
          </Card>
        </div>
      </div>
      <ConfirmDialog open={confirm} onClose={() => setConfirm(false)} danger title={t('blogs.deletePostTitle')} message={t('blogs.deletePostBody')} confirmLabel={t('common.delete')} cancelLabel={t('common.cancel')} onConfirm={() => { setConfirm(false); del.mutate(); }} />
    </>
  );
}

export function BlogsPage() {
  const { t } = useI18n();
  const toast = useToast();
  const qc = useQueryClient();
  const q = useBlogs();
  const [edit, setEdit] = useState<{ id: string | null; title: string; handle: string } | null>(null);
  const [del, setDel] = useState<Blog | null>(null);
  const [error, setError] = useState<string | null>(null);
  const done = (msg: string) => { toast(msg); setEdit(null); setDel(null); setError(null); void qc.invalidateQueries({ queryKey: ['blogs'] }); };
  const save = useMutation({
    mutationFn: () => {
      const blog = { title: edit!.title.trim(), ...(edit!.handle.trim() && { handle: edit!.handle.trim() }) };
      return edit!.id ? mutate(BLOG_UPDATE, { id: edit!.id, blog }, 'blogUpdate') : mutate(BLOG_CREATE, { blog }, 'blogCreate');
    },
    onSuccess: () => done(t('blogs.blogSaved')), onError: (e) => setError(errText(e)),
  });
  const remove = useMutation({ mutationFn: (id: string) => mutate(BLOG_DELETE, { id }, 'blogDelete'), onSuccess: () => done(t('blogs.blogDeleted')), onError: (e) => { setDel(null); toast(e.message, 'critical'); } });
  const blogs = q.data?.blogs.nodes ?? [];
  const add = <Button variant="primary" onClick={() => setEdit({ id: null, title: '', handle: '' })}><Plus className="size-4" />{t('blogs.addBlog')}</Button>;
  return (
    <Card title={t('store.blogs')} actions={add}>
      {q.isLoading && <Skeleton className="h-24" />}
      {q.error && <Banner>{q.error.message}</Banner>}
      {q.data && blogs.length === 0 && <EmptyState icon={<FileText className="size-10" />} title={t('blogs.noBlogsTitle')} description={t('blogs.noBlogsBody')} action={add} />}
      <ul className="divide-y divide-line">
        {blogs.map((b) => (
          <li key={b.id} className="flex items-center gap-3 py-2 text-sm">
            <span className="flex-1"><span className="font-medium">{b.title}</span> <span className="text-muted">/{b.handle}</span></span>
            <Button size="sm" aria-label={`${t('common.edit')}: ${b.title}`} onClick={() => setEdit({ id: b.id, title: b.title, handle: b.handle })}><Pencil className="size-3.5" />{t('common.edit')}</Button>
            <Button size="sm" variant="danger" onClick={() => setDel(b)}>{t('common.delete')}</Button>
          </li>
        ))}
      </ul>
      <Modal open={!!edit} onClose={() => setEdit(null)} closeLabel={t('common.close')} title={t(edit?.id ? 'blogs.editBlog' : 'blogs.addBlog')}
        footer={<><Button onClick={() => setEdit(null)}>{t('common.cancel')}</Button><Button variant="primary" loading={save.isPending} disabled={!edit?.title.trim()} onClick={() => save.mutate()}>{t('save.save')}</Button></>}>
        <div className="flex flex-col gap-3">
          {error && <Banner>{error}</Banner>}
          <Input label={t('field.title')} value={edit?.title ?? ''} onChange={(e) => setEdit((s) => s && { ...s, title: e.target.value })} />
          <Input label={t('product.handle')} value={edit?.handle ?? ''} onChange={(e) => setEdit((s) => s && { ...s, handle: e.target.value })} />
        </div>
      </Modal>
      <ConfirmDialog open={!!del} danger onClose={() => setDel(null)} title={t('blogs.deleteBlogTitle', { name: del?.title ?? '' })} message={t('blogs.deleteBlogBody')} confirmLabel={t('common.delete')} cancelLabel={t('common.cancel')} onConfirm={() => del && remove.mutate(del.id)} />
    </Card>
  );
}
