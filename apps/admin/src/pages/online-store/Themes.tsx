import { Badge, Banner, Button, ConfirmDialog, Dropdown, Input, Modal, Skeleton, cx, useToast } from '@shopme/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ExternalLink, MoreHorizontal, Palette, Upload } from 'lucide-react';
import { useRef, useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router';
import { gql, mutate, upload } from '../../api';
import { PageHeader } from '../../components/PageHeader';
import { gidToNum } from '../../format';
import { THEMES, THEME_DELETE, THEME_DUPLICATE, THEME_PUBLISH, THEME_UPDATE } from '../../graphql';
import { useT } from '../../i18n';
import type { Key } from '../../i18n';

const TABS: Array<{ to: string; key: Key; end?: boolean }> = [
  { to: '/online-store', key: 'store.themes', end: true }, { to: '/online-store/blog-posts', key: 'store.blogPosts' }, { to: '/online-store/blogs', key: 'store.blogs' },
  { to: '/online-store/pages', key: 'store.pages' }, { to: '/online-store/navigation', key: 'store.navigation' }, { to: '/online-store/redirects', key: 'store.redirects' },
];

export function OnlineStoreLayout() {
  const t = useT();
  return (
    <>
      <PageHeader title={t('nav.onlineStore')} actions={<a href="/" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 field-control font-medium hover:bg-surface"><ExternalLink className="size-4" />{t('store.view')}</a>} />
      <nav aria-label={t('nav.onlineStore')} className="mb-4 flex gap-1 overflow-x-auto border-b border-line">
        {TABS.map((x) => <NavLink key={x.to} to={x.to} end={x.end} className={({ isActive }) => cx('-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-[13px] font-medium', isActive ? 'border-accent text-accent' : 'border-transparent text-muted hover:text-fg')}>{t(x.key)}</NavLink>)}
      </nav>
      <Outlet />
    </>
  );
}

interface Theme { id: string; name: string; role: string }
type Dialog = { kind: 'rename' | 'duplicate' | 'delete'; theme: Theme } | null;

function ThemeCard({ theme, live, busy, onAction }: { theme: Theme; live: boolean; busy: boolean; onAction: (a: 'customize' | 'publish' | 'rename' | 'duplicate' | 'delete', th: Theme) => void }) {
  const t = useT();
  const num = gidToNum(theme.id);
  return (
    <li className={cx('flex flex-col overflow-hidden rounded-lg border bg-canvas', live ? 'border-accent' : 'border-line')}>
      <div className="grid h-28 place-items-center bg-gradient-to-br from-primary-subtle to-surface text-accent"><Palette className="size-9" aria-hidden /></div>
      <div className="flex flex-1 flex-col gap-3 p-3">
        <div className="flex items-start gap-2">
          <h3 className="min-w-0 flex-1 truncate font-medium">{theme.name}</h3>
          {live ? <Badge tone="success">{t('themes.live')}</Badge> : <Badge>{t(`themes.role.${theme.role}` as Key)}</Badge>}
        </div>
        <div className="mt-auto flex flex-wrap items-center gap-2">
          <Button size="sm" variant={live ? 'primary' : 'secondary'} onClick={() => onAction('customize', theme)}>{t('themes.customize')}</Button>
          {!live && <Button size="sm" loading={busy} onClick={() => onAction('publish', theme)}>{t('themes.publish')}</Button>}
          <Dropdown align="right" label={t('common.moreActions')} trigger={<MoreHorizontal className="size-4" />} items={[
            { key: 'rename', label: t('themes.rename'), onSelect: () => onAction('rename', theme) },
            { key: 'duplicate', label: t('themes.duplicate'), onSelect: () => onAction('duplicate', theme) },
            { key: 'download', label: t('themes.download'), onSelect: () => { window.location.href = `/admin/api/themes/${num}/download.zip`; } },
            { key: 'delete', label: t('common.delete'), danger: true, disabled: live, onSelect: () => onAction('delete', theme) },
          ]} />
        </div>
      </div>
    </li>
  );
}

export function ThemesPage() {
  const t = useT();
  const nav = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [name, setName] = useState('');
  const q = useQuery({ queryKey: ['themes'], queryFn: () => gql<{ themes: { nodes: Theme[] } }>(THEMES) });
  const done = (msg: Key) => { toast(t(msg)); setDialog(null); void qc.invalidateQueries({ queryKey: ['themes'] }); };
  const fail = (e: Error) => toast(e.message, 'critical');
  const publish = useMutation({ mutationFn: (id: string) => mutate(THEME_PUBLISH, { id }, 'themePublish'), onSuccess: () => done('themes.published'), onError: fail });
  const rename = useMutation({ mutationFn: (v: { id: string; name: string }) => mutate(THEME_UPDATE, { id: v.id, input: { name: v.name } }, 'themeUpdate'), onSuccess: () => done('themes.renamed'), onError: fail });
  const duplicate = useMutation({ mutationFn: (v: { id: string; name: string }) => mutate(THEME_DUPLICATE, v, 'themeDuplicate'), onSuccess: () => done('themes.duplicated'), onError: fail });
  const remove = useMutation({ mutationFn: (id: string) => mutate(THEME_DELETE, { id }, 'themeDelete'), onSuccess: () => done('themes.deleted'), onError: fail });
  const send = useMutation({ mutationFn: (f: File) => upload('/themes/upload', f), onSuccess: () => done('themes.uploaded'), onError: fail });

  if (q.isLoading) return <Skeleton className="h-40" />;
  if (q.error) return <Banner>{q.error.message}</Banner>;
  const themes = q.data?.themes.nodes ?? [];
  const current = themes.find((x) => x.role === 'MAIN') ?? themes[0];
  const others = themes.filter((x) => x !== current);
  const act = (a: 'customize' | 'publish' | 'rename' | 'duplicate' | 'delete', th: Theme) => {
    if (a === 'customize') nav(`/online-store/themes/${gidToNum(th.id)}/editor`);
    else if (a === 'publish') publish.mutate(th.id);
    else { setName(a === 'duplicate' ? t('themes.copyOf', { name: th.name }) : th.name); setDialog({ kind: a, theme: th }); }
  };
  const submit = () => {
    if (!dialog || !name.trim()) return;
    (dialog.kind === 'rename' ? rename : duplicate).mutate({ id: dialog.theme.id, name: name.trim() });
  };
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <p className="flex-1 text-[13px] text-muted">{t('themes.intro')}</p>
        <input ref={fileRef} type="file" accept=".zip,application/zip" hidden aria-label={t('themes.upload')} onChange={(e) => { const f = e.target.files?.[0]; if (f) send.mutate(f); e.target.value = ''; }} />
        <Button loading={send.isPending} onClick={() => fileRef.current?.click()}><Upload className="size-4" />{t('themes.upload')}</Button>
      </div>
      {!current && <p className="text-[13px] text-muted">{t('themes.none')}</p>}
      {current && (
        <section aria-labelledby="th-current"><h2 id="th-current" className="mb-2 text-[13px] font-semibold">{t('themes.current')}</h2>
          <ul className="grid max-w-sm gap-4"><ThemeCard theme={current} live busy={false} onAction={act} /></ul></section>
      )}
      {others.length > 0 && (
        <section aria-labelledby="th-library"><h2 id="th-library" className="mb-2 text-[13px] font-semibold">{t('themes.library')}</h2>
          <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{others.map((th) => <ThemeCard key={th.id} theme={th} live={false} busy={publish.isPending && publish.variables === th.id} onAction={act} />)}</ul></section>
      )}
      <Modal open={dialog?.kind === 'rename' || dialog?.kind === 'duplicate'} onClose={() => setDialog(null)} closeLabel={t('common.close')} title={t(dialog?.kind === 'duplicate' ? 'themes.duplicate' : 'themes.rename')}
        footer={<><Button onClick={() => setDialog(null)}>{t('common.cancel')}</Button><Button variant="primary" loading={rename.isPending || duplicate.isPending} onClick={submit}>{t('save.save')}</Button></>}>
        <Input label={t('themes.name')} value={name} autoFocus onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submit()} />
      </Modal>
      <ConfirmDialog open={dialog?.kind === 'delete'} danger onClose={() => setDialog(null)} title={t('themes.deleteTitle', { name: dialog?.theme.name ?? '' })} message={t('themes.deleteBody')}
        confirmLabel={t('common.delete')} cancelLabel={t('common.cancel')} onConfirm={() => dialog && remove.mutate(dialog.theme.id)} />
    </div>
  );
}
