import { Badge, Button, ButtonGroup, Modal, cx, useToast } from '@shopme/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Monitor, Palette, Smartphone } from 'lucide-react';
import { useId, useState } from 'react';
import type { ReactNode } from 'react';
import { UserErrors, gql, mutate, rest } from '../api';
import { BUNDLED_THEMES, THEME_INSTALL_BUNDLED } from '../graphql';
import { useI18n, useT } from '../i18n';
import type { Key } from '../i18n';

/** A theme that ships with ShopMe (`shopmeBundledThemes`, or `GET /admin/api/bundled-themes` before sign-in). */
export interface BundledThemeCard {
  handle: string; name: string; version: string; author: string; description: string; tags: string[];
  /** Facets of the theme store: industries and features (slugs) and the catalog size (`one`, `few`, `some`, `many`). */
  industries?: string[]; catalogSize?: string | null; features?: string[];
  previews: { desktop: string | null; mobile: string | null };
  /** Pages the theme has a template for (`index`, `customers/login`...). */
  templates?: string[];
  /** What changed in each version, newest first. */
  changelog?: Array<{ version: string; date: string | null; notes: string[] }>;
}

/** The themes that ship with ShopMe, in the admin's language (signed-in admin: GraphQL). */
export function useBundledThemes() {
  const { lang } = useI18n();
  return useQuery({ queryKey: ['bundled-themes', lang], staleTime: 60_000, queryFn: () => gql<{ shopmeBundledThemes?: BundledThemeCard[] }>(BUNDLED_THEMES, { locale: lang }) });
}

/** Adds a bundled theme to the library (unpublished) and refreshes the theme list. */
export function useAddBundledTheme(onAdded?: (theme: BundledThemeCard) => void) {
  const t = useT();
  const toast = useToast();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (th: BundledThemeCard) => mutate(THEME_INSTALL_BUNDLED, { handle: th.handle }, 'shopmeThemeInstallBundled').then(() => th),
    onSuccess: (th) => { toast(t('themes.free.added', { name: th.name })); onAdded?.(th); void qc.invalidateQueries({ queryKey: ['themes'] }); },
    onError: (e: Error) => {
      const code = e instanceof UserErrors ? (e.errors[0] as { code?: string } | undefined)?.code : undefined;
      toast(code === 'NOT_FOUND' ? t('themes.free.notFound') : e.message, 'critical');
    },
  });
}

/** The bundled themes through the REST endpoint (works in the first-store wizard, where nobody is signed in yet). */
export function useBundledThemesRest() {
  const { lang } = useI18n();
  return useQuery({ queryKey: ['bundled-themes-rest', lang], staleTime: 60_000, queryFn: () => rest<{ themes: BundledThemeCard[] }>(`/bundled-themes?locale=${lang}`) });
}

/** Translated label of a tag ("Fashion" -> "Mode"); tags the admin does not know are shown as written by the theme. */
export function useTagLabel() {
  const t = useT();
  return (tag: string) => {
    const key = `themes.tag.${tag.toLowerCase().replace(/[^a-z0-9]+/g, '-')}` as Key;
    const label = t(key);
    return label === key ? tag : label;
  };
}

/** Preview image of a theme (home page, top of the page), or a placeholder when it has none. */
export function ThemeThumb({ theme, kind = 'desktop', className }: { theme: BundledThemeCard; kind?: 'desktop' | 'mobile'; className?: string }) {
  const t = useT();
  const src = theme.previews[kind] ?? theme.previews.desktop;
  return src
    ? <img src={src} alt="" loading="lazy" draggable={false} className={cx('block w-full object-cover object-top', className)} />
    : <div className={cx('grid w-full place-items-center bg-gradient-to-br from-primary-subtle to-surface text-accent', className)}><span className="grid justify-items-center gap-1 text-[12px] text-muted"><Palette className="size-8 text-accent" aria-hidden />{t('themes.free.noPreview')}</span></div>;
}

export function ThemeTags({ tags }: { tags: string[] }) {
  const label = useTagLabel();
  const t = useT();
  if (!tags.length) return null;
  return <ul className="flex flex-wrap gap-1.5" aria-label={t('themes.free.tags')}>{tags.map((tag) => <li key={tag}><Badge>{label(tag)}</Badge></li>)}</ul>;
}

/** Card of the "Free ShopMe themes" gallery on Online Store > Themes. */
export function ThemeGalleryCard({ theme, installed, busy, onAdd, onPreview }: { theme: BundledThemeCard; installed: boolean; busy: boolean; onAdd: () => void; onPreview: () => void }) {
  const t = useT();
  return (
    <li className="flex flex-col overflow-hidden rounded-lg border border-line bg-canvas">
      <button type="button" onClick={onPreview} aria-label={t('themes.free.previewOf', { name: theme.name })} className="block aspect-[16/10] overflow-hidden border-b border-line bg-surface">
        <ThemeThumb theme={theme} className="h-full" />
      </button>
      <div className="flex flex-1 flex-col gap-3 p-3">
        <div className="min-w-0">
          <h3 className="truncate font-medium">{theme.name}</h3>
          <p className="mt-1 line-clamp-3 text-[13px] text-muted">{theme.description}</p>
        </div>
        <ThemeTags tags={theme.tags} />
        <div className="mt-auto flex flex-wrap items-center gap-2">
          {installed
            ? <Badge tone="success"><Check className="size-3" aria-hidden />{t('themes.free.inLibrary')}</Badge>
            : <Button size="sm" variant="primary" loading={busy} onClick={onAdd}>{t('themes.free.add')}</Button>}
          <Button size="sm" onClick={onPreview}>{t('themes.free.preview')}</Button>
        </div>
      </div>
    </li>
  );
}

/** Enlarged preview of a theme with a desktop / mobile toggle. `footer` holds the dialog's actions. */
export function ThemePreviewDialog({ theme, onClose, footer }: { theme: BundledThemeCard | null; onClose: () => void; footer?: ReactNode }) {
  const t = useT();
  const [kind, setKind] = useState<'desktop' | 'mobile'>('desktop');
  const label = useTagLabel();
  return (
    <Modal open={!!theme} onClose={onClose} xl closeLabel={t('common.close')} title={t('themes.free.previewTitle', { name: theme?.name ?? '' })}
      footerStart={theme ? <span className="text-[12px] text-muted">{t('themes.free.byline', { version: theme.version, author: theme.author })}</span> : undefined}
      footer={footer}>
      {theme && (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <ButtonGroup aria-label={t('themes.free.device')}>
              <Button size="sm" aria-pressed={kind === 'desktop'} onClick={() => setKind('desktop')}><Monitor className="size-4" aria-hidden />{t('themes.free.desktop')}</Button>
              <Button size="sm" aria-pressed={kind === 'mobile'} onClick={() => setKind('mobile')}><Smartphone className="size-4" aria-hidden />{t('themes.free.mobile')}</Button>
            </ButtonGroup>
            {theme.tags.length > 0 && <span className="text-[12px] text-muted">{theme.tags.map(label).join(' · ')}</span>}
          </div>
          <p className="text-[13px] text-muted">{theme.description}</p>
          <div className="grid place-items-center rounded-lg border border-line bg-surface p-3">
            {kind === 'desktop'
              ? <div className="w-full overflow-hidden rounded-md border border-line bg-canvas shadow-card"><ThemeThumb theme={theme} kind="desktop" className="aspect-[16/10]" /></div>
              : <div className="w-[220px] overflow-hidden rounded-[22px] border-4 border-ink bg-canvas shadow-card sm:w-[260px]"><ThemeThumb theme={theme} kind="mobile" className="aspect-[390/844]" /></div>}
          </div>
        </div>
      )}
    </Modal>
  );
}

/**
 * Starting-theme choice of the first-store wizard and of "Create a store": the gallery's cards as one radio group.
 * `compact` is the narrow layout of the wizard.
 */
export function ThemePicker({ themes, value, onChange, compact }: { themes: BundledThemeCard[]; value: string; onChange: (handle: string) => void; compact?: boolean }) {
  const t = useT();
  const name = useId();
  const [preview, setPreview] = useState<BundledThemeCard | null>(null);
  return (
    <fieldset className="min-w-0">
      <legend className="mb-1 text-[13px] font-medium">{t('themes.picker.title')}</legend>
      <p className="mb-2 text-[12px] text-muted">{t('themes.picker.help')}</p>
      <ul className={cx('grid gap-3', compact ? 'grid-cols-2' : 'sm:grid-cols-2 lg:grid-cols-3')}>
        {themes.map((theme) => (
          <li key={theme.handle} className="flex flex-col overflow-hidden rounded-lg border border-line bg-canvas has-[input:checked]:border-accent has-[input:checked]:shadow-[0_0_0_2px_var(--color-accent)] has-[input:focus-visible]:outline has-[input:focus-visible]:outline-2 has-[input:focus-visible]:outline-offset-2">
            <label className="flex flex-1 cursor-pointer flex-col">
              <input type="radio" name={name} value={theme.handle} checked={value === theme.handle} onChange={() => onChange(theme.handle)} className="sr-only" />
              <span className="relative block aspect-[16/10] overflow-hidden border-b border-line bg-surface">
                <ThemeThumb theme={theme} className="h-full" />
                {value === theme.handle && <span className="absolute right-1.5 top-1.5 grid size-5 place-items-center rounded-full bg-primary text-on-primary" aria-hidden><Check className="size-3.5" /></span>}
              </span>
              <span className="flex flex-1 flex-col gap-1.5 p-2.5">
                <span className="font-medium">{theme.name}</span>
                <span className={cx('text-[12px] text-muted', compact ? 'line-clamp-2' : 'line-clamp-3')}>{theme.description}</span>
                <ThemeTags tags={theme.tags} />
              </span>
            </label>
            <div className="px-2.5 pb-2.5"><Button size="sm" onClick={() => setPreview(theme)}>{t('themes.free.preview')}</Button></div>
          </li>
        ))}
      </ul>
      <ThemePreviewDialog theme={preview} onClose={() => setPreview(null)}
        footer={preview && (value === preview.handle
          ? <Badge tone="success"><Check className="size-3" aria-hidden />{t('themes.picker.selected')}</Badge>
          : <Button variant="primary" onClick={() => { onChange(preview.handle); setPreview(null); }}>{t('themes.picker.use')}</Button>)} />
    </fieldset>
  );
}
