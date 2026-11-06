import { Badge, Banner, Button, ButtonGroup, ConfirmDialog, Dropdown, Input, Modal, Skeleton, cx, useToast } from '@shopme/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ExternalLink, MoreHorizontal, Palette } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { UserErrors, apiUrl, gql, mutate, upload } from '../../api';
import { PageHeader } from '../../components/PageHeader';
import { gidToNum } from '../../format';
import { THEMES, THEME_DELETE, THEME_DUPLICATE, THEME_PUBLISH, THEME_UPDATE, THEME_UPDATE_TO_BUNDLED } from '../../graphql';
import { ThemeThumb, useAddBundledTheme, useBundledThemes, type BundledThemeCard } from '../../components/ThemeGallery';
import { useI18n, useT } from '../../i18n';
import type { Key } from '../../i18n';
import { ThemeUpdateDialog, ThemeUpdateResultDialog, type BundledThemeStatus, type ThemeUpdateResult } from './ThemeUpdate';
import { useStorefrontUrl } from '../../lib/storefront-url';

const TABS: Array<{ to: string; key: Key; end?: boolean }> = [
  { to: '/online-store', key: 'store.themes', end: true }, { to: '/online-store/blog-posts', key: 'store.blogPosts' }, { to: '/online-store/blogs', key: 'store.blogs' },
  { to: '/online-store/pages', key: 'store.pages' }, { to: '/online-store/navigation', key: 'store.navigation' }, { to: '/online-store/files', key: 'store.files' },
  { to: '/online-store/redirects', key: 'store.redirects' }, { to: '/online-store/preferences', key: 'store.preferences' },
];

/** Renders its children in the Online Store header, left of "View your store" (the page's own header actions). */
export function StoreActions({ children }: { children: ReactNode }) {
  const [host, setHost] = useState<HTMLElement | null>(null);
  useEffect(() => setHost(document.getElementById('store-header-actions')), []);
  return host ? createPortal(children, host) : null;
}

export function OnlineStoreLayout() {
  const t = useT();
  const { pathname } = useLocation();
  const active = [...TABS].reverse().find((x) => (x.end ? pathname === x.to : pathname.startsWith(x.to))) ?? TABS[0]!;
  const isIndex = pathname.replace(/\/$/, '') === '/online-store';
  const storefront = useStorefrontUrl();
  const detail = pathname.split('/').filter(Boolean).length >= 3;
  return (
    <>
      {!detail && <>
      <PageHeader title={t(isIndex ? 'nav.onlineStore' : active.key)} actions={<><span id="store-header-actions" className="contents" />{isIndex && <a href={storefront('/')} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 field-control font-medium hover:bg-surface"><ExternalLink className="size-4" />{t('themes.previewStore')}</a>}</>} />
      {!isIndex && (
        <nav aria-label={t('nav.onlineStore')} className="mb-4 flex gap-1 overflow-x-auto border-b border-line">
          {TABS.map((x) => <NavLink key={x.to} to={x.to} end={x.end} className={({ isActive }) => cx('-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-[13px] font-medium', isActive ? 'border-accent text-accent' : 'border-transparent text-muted hover:text-fg')}>{t(x.key)}</NavLink>)}
        </nav>
      )}</>}
      <Outlet />
    </>
  );
}

interface Theme { id: string; name: string; role: string; createdAt?: string; shopmeBundledTheme?: BundledThemeStatus | null }
type Action = 'customize' | 'publish' | 'preview' | 'rename' | 'duplicate' | 'delete' | 'update';
type Dialog = { kind: 'rename' | 'duplicate' | 'delete' | 'update'; theme: Theme } | null;

/** "Added: Wednesday 5:36 AM" for a recent theme, the date otherwise. */
export function addedLabel(iso: string | undefined, lang: string, now = Date.now()): string {
  const d = iso ? new Date(iso) : null;
  if (!d || Number.isNaN(d.getTime())) return '';
  const recent = now - d.getTime() < 6 * 86_400_000;
  return new Intl.DateTimeFormat(lang, recent ? { weekday: 'long', hour: 'numeric', minute: '2-digit' } : { day: 'numeric', month: 'long', year: 'numeric' }).format(d);
}

function ThemeMenu({ theme, live, onAction }: { theme: Theme; live: boolean; onAction: (a: Action, th: Theme) => void }) {
  const t = useT();
  const num = gidToNum(theme.id);
  return (
    <Dropdown align="right" label={t('common.moreActions')} trigger={<MoreHorizontal className="size-4" />} icon variant="plain" items={[
      { key: 'rename', label: t('themes.rename'), onSelect: () => onAction('rename', theme) },
      { key: 'duplicate', label: t('themes.duplicate'), onSelect: () => onAction('duplicate', theme) },
      { key: 'download', label: t('themes.download'), onSelect: () => { window.location.href = apiUrl(`/themes/${num}/download.zip`); } },
      { key: 'delete', label: t('common.delete'), danger: true, disabled: live, onSelect: () => onAction('delete', theme) },
    ]} />
  );
}

function UpdateNote({ theme, onAction }: { theme: Theme; onAction: (a: Action, th: Theme) => void }) {
  const t = useT();
  const b = theme.shopmeBundledTheme;
  if (!b?.updateAvailable) return null;
  return <span className="flex flex-wrap items-center gap-2"><Badge tone="info">{t('themes.update.available', { version: b.bundledVersion })}</Badge><Button size="sm" onClick={() => onAction('update', theme)}>{t('themes.update.button')}</Button></span>;
}

/** The live theme: its preview, then a dark bar with its name, when it was added and the "Customize" button. */
function CurrentThemeCard({ theme, preview, onAction }: { theme: Theme; preview: BundledThemeCard | undefined; onAction: (a: Action, th: Theme) => void }) {
  const { t, lang } = useI18n();
  const bundled = theme.shopmeBundledTheme;
  const added = addedLabel(theme.createdAt, lang);
  return (
    <section aria-label={t('themes.currentTheme')} className="overflow-hidden rounded-xl border border-line bg-canvas shadow-card">
      <div className="overflow-hidden bg-surface">
        {preview ? <ThemeThumb theme={preview} className="aspect-[16/8]" /> : <div className="grid aspect-[16/8] place-items-center bg-gradient-to-br from-primary-subtle to-surface text-accent"><Palette className="size-10" aria-hidden /></div>}
      </div>
      <div className="flex flex-wrap items-center gap-3 bg-ink px-5 py-4 text-ink-text">
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-lg font-semibold">{theme.name}</h2>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[12px] opacity-80">
            {bundled?.installedVersion && <span>{t('themes.update.version', { version: bundled.installedVersion })}</span>}
            {added && <span>{t('themes.addedOn', { date: added })}</span>}
            {bundled?.updateAvailable && <button type="button" className="underline" onClick={() => onAction('update', theme)}>{t('themes.update.available', { version: bundled.bundledVersion })}</button>}
          </p>
        </div>
        <Button size="sm" className="!border-transparent !bg-canvas !text-fg" onClick={() => onAction('customize', theme)}>{t('themes.customize')}</Button>
        <span className="[&_.btn]:!border-transparent [&_.btn]:!bg-transparent [&_.btn]:!text-ink-text"><ThemeMenu theme={theme} live onAction={onAction} /></span>
      </div>
    </section>
  );
}

/** One row of the drafts list: thumbnail, name, when it was added, "Publish" with its menu, "Customize" and the more menu. */
function DraftRow({ theme, preview, busy, onAction }: { theme: Theme; preview: BundledThemeCard | undefined; busy: boolean; onAction: (a: Action, th: Theme) => void }) {
  const { t, lang } = useI18n();
  const added = addedLabel(theme.createdAt, lang);
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3.5">
      <div className="h-[52px] w-[84px] shrink-0 overflow-hidden rounded-md border border-line bg-surface">
        {preview ? <ThemeThumb theme={preview} className="h-full" /> : <div className="grid h-full place-items-center text-accent"><Palette className="size-5" aria-hidden /></div>}
      </div>
      <div className="min-w-[160px] flex-1">
        <p className="truncate font-medium">{theme.name}</p>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-muted">
          {added && <span>{t('themes.addedOn', { date: added })}</span>}
          {theme.shopmeBundledTheme?.installedVersion && <span>{t('themes.update.version', { version: theme.shopmeBundledTheme.installedVersion })}</span>}
          <UpdateNote theme={theme} onAction={onAction} />
        </p>
      </div>
      <ButtonGroup>
        <Button size="sm" loading={busy} onClick={() => onAction('publish', theme)}>{t('themes.publish')}</Button>
        <Dropdown align="right" size="sm" icon chevron label={t('themes.publishMore')} trigger={<span className="sr-only">{t('themes.publishMore')}</span>} items={[{ key: 'preview', label: t('themes.previewTheme'), onSelect: () => onAction('preview', theme) }]} />
      </ButtonGroup>
      <Button size="sm" onClick={() => onAction('customize', theme)}>{t('themes.customize')}</Button>
      <ThemeMenu theme={theme} live={false} onAction={onAction} />
    </li>
  );
}

/** A theme of the "Discover themes" grid: a tall preview, its name and author, and "Add". */
export function DiscoverCard({ theme, busy, onAdd }: { theme: BundledThemeCard; busy: boolean; onAdd: () => void }) {
  const t = useT();
  return (
    <li className="flex flex-col gap-2.5">
      <Link to={`/online-store/themes/store/${theme.handle}`} aria-label={t('themes.free.previewOf', { name: theme.name })} className="block aspect-[4/3] overflow-hidden rounded-xl border border-line bg-surface shadow-card">
        <ThemeThumb theme={theme} className="h-full" />
      </Link>
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1"><h3 className="truncate text-[13px] font-semibold">{theme.name}</h3><p className="text-[12px] text-muted">{t('themes.by', { author: theme.author })}</p></div>
        <Button size="sm" loading={busy} onClick={onAdd}>{t('themes.add')}</Button>
      </div>
    </li>
  );
}

export function ThemesPage() {
  const { t } = useI18n();
  const nav = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();
  const storefront = useStorefrontUrl();
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
  const [updated, setUpdated] = useState<ThemeUpdateResult | null>(null);
  const free = useBundledThemes();
  const add = useAddBundledTheme();
  const update = useMutation({
    mutationFn: (id: string) => mutate<ThemeUpdateResult>(THEME_UPDATE_TO_BUNDLED, { id }, 'shopmeThemeUpdateToBundled'),
    onSuccess: (r) => { setDialog(null); setUpdated(r); void qc.invalidateQueries({ queryKey: ['themes'] }); },
    onError: (e: Error) => {
      const code = e instanceof UserErrors ? (e.errors[0] as { code?: string } | undefined)?.code : undefined;
      toast(code && ['UP_TO_DATE', 'NOT_BUNDLED_THEME', 'BUNDLE_UNAVAILABLE'].includes(code) ? t(`themes.update.error.${code}` as Key) : e.message, 'critical');
    },
  });

  if (q.isLoading) return <Skeleton className="h-40" />;
  if (q.error) return <Banner>{q.error.message}</Banner>;
  const themes = q.data?.themes.nodes ?? [];
  const current = themes.find((x) => x.role === 'MAIN') ?? themes[0];
  const others = themes.filter((x) => x !== current);
  const gallery = free.data?.shopmeBundledThemes ?? [];
  const byHandle = new Map(gallery.map((g) => [g.handle, g]));
  const previewOf = (th: Theme) => (th.shopmeBundledTheme?.handle ? byHandle.get(th.shopmeBundledTheme.handle) : undefined);
  const inLibrary = new Set(themes.map((x) => x.shopmeBundledTheme?.handle).filter(Boolean));
  const discover = gallery.filter((g) => !inLibrary.has(g.handle));
  const act = (a: Action, th: Theme) => {
    if (a === 'customize') nav(`/online-store/themes/${gidToNum(th.id)}/editor`);
    else if (a === 'publish') publish.mutate(th.id);
    else if (a === 'preview') window.open(storefront(`/?preview_theme_id=${gidToNum(th.id)}`), '_blank', 'noopener');
    else if (a === 'update') setDialog({ kind: 'update', theme: th });
    else { setName(a === 'duplicate' ? t('themes.copyOf', { name: th.name }) : th.name); setDialog({ kind: a, theme: th }); }
  };
  const submit = () => {
    if (!dialog || !name.trim()) return;
    (dialog.kind === 'rename' ? rename : duplicate).mutate({ id: dialog.theme.id, name: name.trim() });
  };
  return (
    <div className="mx-auto flex w-full max-w-[820px] flex-col gap-8">
      {!current && <p className="text-[13px] text-muted">{t('themes.none')}</p>}
      {current && <CurrentThemeCard theme={current} preview={previewOf(current)} onAction={act} />}

      <section aria-labelledby="th-drafts">
        <div className="mb-2 flex items-center gap-2">
          <h2 id="th-drafts" className="flex-1 text-[13px] font-semibold">{t('themes.drafts')}</h2>
          <input ref={fileRef} type="file" accept=".zip,application/zip" hidden aria-label={t('themes.upload')} onChange={(e) => { const f = e.target.files?.[0]; if (f) send.mutate(f); e.target.value = ''; }} />
          <Dropdown align="right" size="sm" chevron label={t('themes.import')} trigger={t('themes.import')} items={[{ key: 'zip', label: t('themes.import.zip'), onSelect: () => fileRef.current?.click() }]} />
        </div>
        {others.length === 0 && <p className="rounded-xl border border-dashed border-line px-4 py-6 text-center text-[13px] text-muted">{t('themes.draftsEmpty')}</p>}
        {others.length > 0 && (
          <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-canvas shadow-card">
            {others.map((th) => <DraftRow key={th.id} theme={th} preview={previewOf(th)} busy={publish.isPending && publish.variables === th.id} onAction={act} />)}
          </ul>
        )}
      </section>

      <section aria-labelledby="th-discover">
        <div className="mb-2 flex items-center gap-2">
          <h2 id="th-discover" className="flex-1 text-[13px] font-semibold">{t('themes.discover')}</h2>
          <Button size="sm" onClick={() => nav('/online-store/themes/store')}>{t('themes.visitStore')}</Button>
        </div>
        <ul className="grid gap-x-4 gap-y-6 sm:grid-cols-2 lg:grid-cols-3">
          {discover.map((th) => <DiscoverCard key={th.handle} theme={th} busy={add.isPending && add.variables?.handle === th.handle} onAdd={() => add.mutate(th)} />)}
          <li className="flex aspect-[4/3] flex-col justify-center gap-2 rounded-xl border border-line bg-canvas p-6 shadow-card">
            <h3 className="text-[13px] font-semibold">{t('themes.exploreTitle')}</h3>
            <p className="text-[12px] text-muted">{t('themes.exploreBody')}</p>
            <div><Button size="sm" onClick={() => nav('/online-store/themes/store')}>{t('themes.visitStore')}</Button></div>
          </li>
        </ul>
      </section>

      <p className="pb-4 text-center text-[12px]"><a className="text-accent underline" href="https://github.com/aymaneprojects/shopme/blob/main/docs/spec/theme-format.md" target="_blank" rel="noreferrer">{t('themes.learnMore')}</a></p>

      <Modal open={dialog?.kind === 'rename' || dialog?.kind === 'duplicate'} onClose={() => setDialog(null)} closeLabel={t('common.close')} title={t(dialog?.kind === 'duplicate' ? 'themes.duplicate' : 'themes.rename')}
        footer={<><Button onClick={() => setDialog(null)}>{t('common.cancel')}</Button><Button variant="primary" loading={rename.isPending || duplicate.isPending} onClick={submit}>{t('save.save')}</Button></>}>
        <Input label={t('themes.name')} value={name} autoFocus onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submit()} />
      </Modal>
      {dialog?.kind === 'update' && dialog.theme.shopmeBundledTheme && (
        <ThemeUpdateDialog open themeId={dialog.theme.id} status={dialog.theme.shopmeBundledTheme} busy={update.isPending} onClose={() => setDialog(null)} onConfirm={() => update.mutate(dialog.theme.id)} />
      )}
      <ThemeUpdateResultDialog result={updated} onClose={() => setUpdated(null)} onCustomize={(id) => { setUpdated(null); nav(`/online-store/themes/${gidToNum(id)}/editor`); }} />
      <ConfirmDialog open={dialog?.kind === 'delete'} danger onClose={() => setDialog(null)} title={t('themes.deleteTitle', { name: dialog?.theme.name ?? '' })} message={t('themes.deleteBody')}
        confirmLabel={t('common.delete')} cancelLabel={t('common.cancel')} onConfirm={() => dialog && remove.mutate(dialog.theme.id)} />
    </div>
  );
}
