import { Badge, Banner, Button, Dropdown, Skeleton, cx } from '@shopme/ui';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Check, ChevronDown, Monitor, Search, Smartphone, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { gql } from '../../api';
import { ThemeTags, ThemeThumb, useAddBundledTheme, useBundledThemes, useTagLabel, type BundledThemeCard } from '../../components/ThemeGallery';
import { THEMES } from '../../graphql';
import { useI18n } from '../../i18n';
import type { Key } from '../../i18n';

const BASE = '/online-store/themes/store';

/** Handles of the bundled themes already in the theme library. */
function useInLibrary(): Set<string> {
  const q = useQuery({ queryKey: ['themes'], queryFn: () => gql<{ themes: { nodes: Array<{ shopmeBundledTheme?: { handle: string } | null }> } }>(THEMES) });
  return useMemo(() => new Set((q.data?.themes.nodes ?? []).map((x) => x.shopmeBundledTheme?.handle).filter((h): h is string => !!h)), [q.data]);
}

/** Top bar shared by the store pages: back to the themes, the store's name and the "Browse themes" menu. */
function StoreBar({ dark, query, onQuery, center }: { dark?: boolean; query?: string; onQuery?: (v: string) => void; center?: ReactNode }) {
  const { t } = useI18n();
  const nav = useNavigate();
  const [searching, setSearching] = useState(false);
  return (
    <header className={cx('sticky top-0 z-10 flex h-14 items-center gap-3 border-b px-4 sm:px-6', dark ? 'border-white/10 bg-ink text-ink-text' : 'border-line bg-canvas')}>
      <div className="mx-auto flex w-full max-w-[1100px] items-center gap-3">
        <button type="button" aria-label={t('themes.store.back')} title={t('themes.store.back')} onClick={() => nav('/online-store')} className="grid size-8 place-items-center rounded-md hover:bg-hover"><ArrowLeft className="size-4" /></button>
        <Link to={BASE} className="text-[14px] font-semibold">{t('themes.store.name')}</Link>
        <div className="flex flex-1 justify-center">{center}</div>
        <span className={dark ? '[&_.btn]:!text-ink-text' : undefined}><Dropdown align="right" size="sm" variant="plain" chevron label={t('themes.store.browse')} trigger={t('themes.store.browse')} items={[
          { key: 'all', label: t('themes.store.allThemes'), onSelect: () => nav(BASE) },
          { key: 'free', label: t('themes.store.freeThemes'), onSelect: () => nav(`${BASE}/free`) },
        ]} /></span>
        {onQuery && (searching
          ? <input autoFocus type="search" aria-label={t('themes.store.search')} placeholder={t('themes.store.search')} value={query ?? ''} onChange={(e) => onQuery(e.target.value)} onBlur={() => !query && setSearching(false)} className="field-control h-8 w-44 text-[13px] text-fg" />
          : <button type="button" aria-label={t('themes.store.search')} title={t('themes.store.search')} onClick={() => setSearching(true)} className="grid size-8 place-items-center rounded-md hover:bg-hover"><Search className="size-4" /></button>)}
      </div>
    </header>
  );
}

function Screen({ dark, children }: { dark?: boolean; children: ReactNode }) {
  return <div className={cx('fixed inset-0 z-[45] overflow-y-auto', dark ? 'bg-ink text-ink-text' : 'bg-canvas text-fg')}>{children}</div>;
}

function Facet({ title, children }: { title: string; children: ReactNode }) {
  const [open, setOpen] = useState(true);
  return (
    <section className="border-b border-line py-3">
      <button type="button" aria-expanded={open} onClick={() => setOpen((v) => !v)} className="flex w-full items-center justify-between text-[13px] font-semibold">{title}<ChevronDown className={cx('size-4 transition-transform', !open && '-rotate-90')} aria-hidden /></button>
      {open && <div className="mt-2 flex flex-col gap-1.5">{children}</div>}
    </section>
  );
}

/** Industries (tags) of the themes, with the themes they hold, sorted by name in the admin's language. */
export function industriesOf(themes: BundledThemeCard[], label: (tag: string) => string): Array<{ tag: string; label: string; count: number }> {
  const m = new Map<string, number>();
  for (const th of themes) for (const tag of new Set(th.tags)) m.set(tag, (m.get(tag) ?? 0) + 1);
  return [...m].map(([tag, count]) => ({ tag, label: label(tag), count })).sort((a, b) => a.label.localeCompare(b.label));
}

/** Themes matching the filters (every selected industry must be in the theme's tags), sorted. */
export function filterThemes(themes: BundledThemeCard[], o: { industries: string[]; query: string; sort: 'relevance' | 'name' }): BundledThemeCard[] {
  const q = o.query.trim().toLowerCase();
  const out = themes.filter((th) => o.industries.every((i) => th.tags.includes(i)) && (!q || `${th.name} ${th.description}`.toLowerCase().includes(q)));
  return o.sort === 'name' ? [...out].sort((a, b) => a.name.localeCompare(b.name)) : out;
}

/** Browse the themes: "all themes" or "free themes" (every bundled theme is free), with industry filters and sorting. */
export function ThemeStoreBrowsePage({ free }: { free?: boolean }) {
  const { t } = useI18n();
  const nav = useNavigate();
  const label = useTagLabel();
  const q = useBundledThemes();
  const [industries, setIndustries] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<'relevance' | 'name'>('relevance');
  const themes = q.data?.shopmeBundledThemes ?? [];
  const shown = filterThemes(themes, { industries, query, sort });
  const facets = industriesOf(themes, label);
  const toggle = (tag: string) => setIndustries((l) => (l.includes(tag) ? l.filter((x) => x !== tag) : [...l, tag]));
  const chips = [...(free ? [{ key: 'free', name: t('themes.store.free'), remove: () => nav(BASE) }] : []), ...industries.map((tag) => ({ key: tag, name: label(tag), remove: () => toggle(tag) }))];
  return (
    <Screen>
      <StoreBar query={query} onQuery={setQuery} />
      <main className="mx-auto w-full max-w-[1100px] px-4 pb-16 pt-8 sm:px-6">
        <h1 className="text-[28px] font-semibold leading-tight">{t(free ? 'themes.store.browseFree' : 'themes.store.browseAll')}</h1>
        {chips.length > 0 && (
          <div className="mt-4 flex flex-wrap items-center gap-2 text-[11px] uppercase tracking-wide text-muted">
            <span>{t('themes.store.filteredBy')}</span>
            {chips.map((c) => <button key={c.key} type="button" aria-label={t('themes.store.removeFilter', { name: c.name })} onClick={c.remove} className="inline-flex items-center gap-1 rounded-md border border-line bg-surface px-2 py-0.5 text-[12px] normal-case tracking-normal text-fg">{c.name}<X className="size-3" aria-hidden /></button>)}
          </div>
        )}
        <div className="mt-6 grid gap-8 md:grid-cols-[220px_1fr]">
          <aside aria-label={t('themes.store.price')}>
            <Facet title={t('themes.store.price')}>
              <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" checked={!!free} onChange={() => nav(free ? BASE : `${BASE}/free`)} className="size-4 accent-[var(--color-primary)]" /><span className="flex-1">{t('themes.store.free')}</span><span className="text-muted">{themes.length}</span></label>
            </Facet>
            <Facet title={t('themes.store.industry')}>
              {facets.map((f) => <label key={f.tag} className="flex items-center gap-2 text-[13px]"><input type="checkbox" checked={industries.includes(f.tag)} onChange={() => toggle(f.tag)} className="size-4 accent-[var(--color-primary)]" /><span className="flex-1">{f.label}</span></label>)}
            </Facet>
          </aside>
          <section aria-live="polite">
            <div className="mb-4 flex items-end justify-between gap-3">
              <p className="text-[13px] text-muted">{t('themes.store.count', { n: shown.length })}</p>
              <label className="flex flex-col rounded-lg border border-line px-3 py-1.5 text-[11px] text-muted">{t('themes.store.sort')}
                <select value={sort} onChange={(e) => setSort(e.target.value as 'relevance' | 'name')} className="bg-transparent text-[13px] font-medium text-fg outline-none">
                  <option value="relevance">{t('themes.store.sort.relevance')}</option><option value="name">{t('themes.store.sort.name')}</option>
                </select>
              </label>
            </div>
            {q.isLoading ? <Skeleton className="h-72" /> : q.error ? <Banner>{q.error.message}</Banner> : shown.length === 0 ? <p className="text-[13px] text-muted">{t('themes.store.noResults')}</p> : (
              <ul className="grid gap-x-5 gap-y-7 sm:grid-cols-2 lg:grid-cols-3">
                {shown.map((th) => (
                  <li key={th.handle}>
                    <Link to={`${BASE}/${th.handle}`} aria-label={t('themes.free.previewOf', { name: th.name })} className="block aspect-[4/3] overflow-hidden rounded-xl border border-line bg-surface shadow-card"><ThemeThumb theme={th} className="h-full" /></Link>
                    <h2 className="mt-2.5 text-[13px] font-semibold">{th.name}</h2>
                    <p className="text-[12px] text-muted">{t('themes.store.free')}</p>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </main>
    </Screen>
  );
}

export const ThemeStoreAllPage = () => <ThemeStoreBrowsePage />;
export const ThemeStoreFreePage = () => <ThemeStoreBrowsePage free />;

function useStoreTheme(): { theme: BundledThemeCard | undefined; loading: boolean; error: Error | null } {
  const { handle = '' } = useParams();
  const q = useBundledThemes();
  return { theme: q.data?.shopmeBundledThemes?.find((x) => x.handle === handle), loading: q.isLoading, error: q.error };
}

function AddButton({ theme, inLibrary, size }: { theme: BundledThemeCard; inLibrary: boolean; size?: 'sm' | 'md' }) {
  const { t } = useI18n();
  const add = useAddBundledTheme();
  return inLibrary
    ? <Badge tone="success"><Check className="size-3" aria-hidden />{t('themes.free.inLibrary')}</Badge>
    : <Button size={size} variant="primary" loading={add.isPending} onClick={() => add.mutate(theme)}>{t('themes.free.add')}</Button>;
}

const pageLabel = (t: (k: Key) => string, name: string) => { const k = `editor.page.${name}` as Key; const v = t(k); return v === k ? name.replace(/^customers\//, '').replace(/_/g, ' ') : v; };

/** Details of a theme: what it looks like, what it includes and what changed in each version. */
export function ThemeStoreDetailPage() {
  const { t, lang } = useI18n();
  const label = useTagLabel();
  const { theme, loading, error } = useStoreTheme();
  const inLibrary = useInLibrary();
  const date = (iso: string | null) => (iso && !Number.isNaN(Date.parse(iso)) ? new Intl.DateTimeFormat(lang, { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(iso)) : null);
  if (loading) return <Screen><StoreBar /><div className="mx-auto max-w-[1100px] p-6"><Skeleton className="h-96" /></div></Screen>;
  if (error || !theme) return <Screen><StoreBar /><div className="mx-auto max-w-[1100px] p-6"><Banner>{error?.message ?? t('themes.store.notFound')}</Banner></div></Screen>;
  const templates = theme.templates ?? [];
  const pages = templates.filter((n) => !n.startsWith('customers/') && n !== 'password' && n !== 'gift_card');
  const accounts = templates.filter((n) => n.startsWith('customers/'));
  const columns: Array<{ title: string; items: string[] }> = [
    { title: t('themes.store.pages'), items: pages.map((n) => pageLabel(t, n.split('.')[0]!)).filter((v, i, a) => a.indexOf(v) === i) },
    { title: t('themes.store.accountPages'), items: accounts.map((n) => pageLabel(t, n)) },
    { title: t('themes.store.industries'), items: theme.tags.map(label) },
  ].filter((c) => c.items.length);
  const added = inLibrary.has(theme.handle);
  return (
    <Screen>
      <header className="sticky top-0 z-10 border-b border-line bg-canvas px-4 sm:px-6">
        <div className="mx-auto flex h-14 w-full max-w-[1100px] items-center gap-4">
          <Link to={BASE} aria-label={t('themes.store.back')} title={t('themes.store.back')} className="grid size-8 place-items-center rounded-md hover:bg-hover"><ArrowLeft className="size-4" /></Link>
          <span className="text-[15px] font-semibold">{theme.name}</span>
          <nav aria-label={t('themes.store.sections')} className="hidden gap-4 text-[13px] sm:flex">
            <a href="#overview" className="hover:underline">{t('themes.store.tab.overview')}</a>
            <a href="#features" className="hover:underline">{t('themes.store.tab.features')}</a>
            <a href="#changelog" className="hover:underline">{t('themes.store.tab.changelog')}</a>
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <Link to={`${BASE}/${theme.handle}/preview`} className="btn btn-secondary btn-sm">{t('themes.store.viewDemo')}</Link>
            <AddButton theme={theme} inLibrary={added} size="sm" />
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-[1100px] px-4 pb-20 pt-8 sm:px-6">
        <section id="overview" aria-labelledby="ts-name" className="scroll-mt-20">
          <h1 id="ts-name" className="text-[28px] font-semibold leading-tight">{theme.name}</h1>
          <p className="mt-1 text-[13px] text-muted">{t('themes.by', { author: theme.author })} · {t('themes.update.version', { version: theme.version })} · {t('themes.store.free')}</p>
          <div className="mt-3"><ThemeTags tags={theme.tags} /></div>
          <p className="mt-4 max-w-2xl text-[15px] leading-relaxed">{theme.description}</p>
          <div className="mt-6 overflow-hidden rounded-2xl border border-line bg-surface shadow-card"><ThemeThumb theme={theme} className="aspect-[16/9]" /></div>
          <ul className="mt-8 grid gap-6 sm:grid-cols-2">
            <li>
              <div className="overflow-hidden rounded-xl border border-line bg-surface"><ThemeThumb theme={theme} kind="desktop" className="aspect-[4/3]" /></div>
              <h2 className="mt-3 text-[14px] font-semibold"><Monitor className="mr-1.5 inline size-4 align-text-bottom" aria-hidden />{t('themes.store.onComputers')}</h2>
            </li>
            <li>
              <div className="grid aspect-[4/3] place-items-center overflow-hidden rounded-xl border border-line bg-surface"><div className="h-[88%] w-[34%] overflow-hidden rounded-[18px] border-4 border-ink bg-canvas"><ThemeThumb theme={theme} kind="mobile" className="h-full" /></div></div>
              <h2 className="mt-3 text-[14px] font-semibold"><Smartphone className="mr-1.5 inline size-4 align-text-bottom" aria-hidden />{t('themes.store.onPhones')}</h2>
            </li>
          </ul>
        </section>

        <div className="my-12 flex items-center gap-4"><div className="h-px flex-1 bg-line" /><span className="rounded-full border border-line bg-surface px-3 py-1 text-[11px] font-medium uppercase tracking-wide text-muted">{t('themes.store.included')}</span><div className="h-px flex-1 bg-line" /></div>

        <section id="features" aria-labelledby="ts-features" className="scroll-mt-20">
          <h2 id="ts-features" className="text-[22px] font-semibold">{t('themes.store.tab.features')}</h2>
          <div className="mt-5 grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
            {columns.map((c) => (
              <div key={c.title}><h3 className="text-[13px] font-semibold">{c.title}</h3><ul className="mt-2 flex flex-col gap-1 text-[13px] text-muted">{c.items.map((i) => <li key={i}>{i}</li>)}</ul></div>
            ))}
          </div>
        </section>

        <section id="changelog" aria-labelledby="ts-changelog" className="mt-12 scroll-mt-20">
          <h2 id="ts-changelog" className="text-[22px] font-semibold">{t('themes.store.tab.changelog')}</h2>
          {(theme.changelog ?? []).length === 0 ? <p className="mt-3 text-[13px] text-muted">{t('themes.store.noChangelog')}</p> : (
            <ol className="mt-4 flex flex-col gap-6">
              {(theme.changelog ?? []).map((v) => (
                <li key={v.version} className="border-t border-line pt-4">
                  <h3 className="text-[14px] font-semibold">{t('themes.update.versionHeading', { version: v.version })}{date(v.date) && <span className="ml-2 text-[12px] font-normal text-muted">{t('themes.store.releaseDate', { date: date(v.date)! })}</span>}</h3>
                  <ul className="mt-2 list-disc space-y-1 pl-5 text-[13px] text-muted">{v.notes.map((n) => <li key={n}>{n}</li>)}</ul>
                </li>
              ))}
            </ol>
          )}
        </section>
      </main>
    </Screen>
  );
}

/** Full-size preview of a theme on a dark page, with a desktop / mobile switch and a bar to add the theme. */
export function ThemeStorePreviewPage() {
  const { t } = useI18n();
  const nav = useNavigate();
  const { theme, loading, error } = useStoreTheme();
  const inLibrary = useInLibrary();
  const [kind, setKind] = useState<'desktop' | 'mobile'>('desktop');
  const toggle = (k: 'desktop' | 'mobile', Icon: typeof Monitor, text: string) => (
    <button type="button" aria-pressed={kind === k} aria-label={text} title={text} onClick={() => setKind(k)} className={cx('grid size-8 place-items-center rounded-md', kind === k ? 'bg-white/20' : 'hover:bg-white/10')}><Icon className="size-4" /></button>
  );
  if (loading || error || !theme) return <Screen dark><StoreBar dark />{error ? <div className="p-6"><Banner>{error.message}</Banner></div> : !loading && <p className="p-6 text-[13px]">{t('themes.store.notFound')}</p>}</Screen>;
  return (
    <Screen dark>
      <StoreBar dark center={<div role="group" aria-label={t('themes.free.device')} className="flex items-center gap-1">{toggle('desktop', Monitor, t('themes.free.desktop'))}{toggle('mobile', Smartphone, t('themes.free.mobile'))}</div>} />
      <main className="mx-auto px-4 pb-32 pt-6">
        {kind === 'desktop'
          ? <div className="mx-auto max-w-[1100px] overflow-hidden rounded-t-xl bg-canvas"><ThemeThumb theme={theme} kind="desktop" className="w-full" /></div>
          : <div className="mx-auto w-[340px] overflow-hidden rounded-[28px] border-[6px] border-white/20 bg-canvas"><ThemeThumb theme={theme} kind="mobile" className="w-full" /></div>}
      </main>
      <div role="region" aria-label={theme.name} className="fixed inset-x-0 bottom-5 z-20 mx-auto flex w-[min(92vw,1100px)] items-center gap-3 rounded-full bg-canvas px-5 py-2.5 text-fg shadow-lg">
        <span className="text-[16px] font-semibold">{theme.name}</span>
        <span className="text-[12px] text-muted">{t('themes.store.free')}</span>
        <div className="ml-auto flex items-center gap-2">
          <Button size="sm" onClick={() => nav(`${BASE}/${theme.handle}`)}>{t('themes.store.details')}</Button>
          <AddButton theme={theme} inLibrary={inLibrary.has(theme.handle)} size="sm" />
        </div>
      </div>
    </Screen>
  );
}
