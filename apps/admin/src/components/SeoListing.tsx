import { Button, Card, Input, Textarea } from '@shopme/ui';
import { Pencil } from 'lucide-react';
import { useState } from 'react';
import { useI18n } from '../i18n';

const strip = (html: string) => html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
const TITLE_MAX = 70;
const DESCRIPTION_MAX = 160;

/**
 * "Search engine listing" card: a preview of how the page appears in search results, with an edit toggle for the URL handle
 * and, when `onSeoTitle` / `onSeoDescription` are given, the page title and meta description overrides.
 */
export function SeoListing({ title, prefix, handle, onHandle, description, seoTitle = '', onSeoTitle, seoDescription = '', onSeoDescription, flat, image, siteName }: {
  /** `flat`: heading above a grey inset preview with the optional `image` thumbnail and `siteName` (product page layout). */
  flat?: boolean; image?: string; siteName?: string;
  title: string; prefix: string; handle: string; onHandle: (v: string) => void; description: string;
  seoTitle?: string; onSeoTitle?: (v: string) => void; seoDescription?: string; onSeoDescription?: (v: string) => void;
}) {
  const { t } = useI18n();
  const [editing, setEditing] = useState(false);
  const shownTitle = seoTitle.trim() || title;
  const text = (seoDescription.trim() || strip(description)).slice(0, DESCRIPTION_MAX);
  const edit = editing && (
    <div className={flat ? 'mt-3 flex flex-col gap-3 rounded-lg bg-canvas p-4 shadow-card' : 'mt-4 flex flex-col gap-3 border-t border-line pt-4'}>
      {onSeoTitle && <Input label={t('seo.pageTitle')} value={seoTitle} placeholder={title} help={t('seo.chars', { n: seoTitle.length, max: TITLE_MAX })} onChange={(e) => onSeoTitle(e.target.value)} />}
      {onSeoDescription && <Textarea label={t('seo.metaDescription')} rows={3} value={seoDescription} help={t('seo.chars', { n: seoDescription.length, max: DESCRIPTION_MAX })} onChange={(e) => onSeoDescription(e.target.value)} />}
      <Input label={`${t('seo.url')} (${prefix})`} value={handle} onChange={(e) => onHandle(e.target.value)} />
    </div>
  );
  if (flat) {
    return (
      <section>
        <header className="mb-3 flex min-h-7 items-center justify-between gap-2">
          <h2 className="text-[15px] font-semibold">{t('seo.title')}</h2>
          <Button size="sm" variant="plain" icon aria-label={t('seo.edit')} aria-expanded={editing} onClick={() => setEditing((v) => !v)}><Pencil className="size-4" /></Button>
        </header>
        <div className="flex items-start gap-4 rounded-lg bg-surface p-4 text-[13px]" data-testid="seo-preview">
          {!shownTitle && !text ? <p className="text-muted">{t('seo.empty')}</p> : (
            <div className="min-w-0 flex-1">
              <p className="truncate text-base text-fg">{shownTitle}</p>
              {text && <p className="mt-1 line-clamp-2 text-muted">{text}</p>}
              <p className="mt-3 truncate font-medium">{siteName ?? prefix}</p>
              <p className="truncate text-xs text-muted">{prefix}{handle || '…'}</p>
            </div>
          )}
          {image && <img src={image} alt="" className="size-28 shrink-0 rounded-lg bg-canvas object-contain p-1" />}
        </div>
        {edit}
      </section>
    );
  }
  return (
    <Card title={t('seo.title')} actions={<Button size="sm" icon aria-label={t('seo.edit')} aria-expanded={editing} onClick={() => setEditing((v) => !v)}><Pencil className="size-3.5" /></Button>}>
      {!shownTitle && !text ? <p className="text-[13px] text-muted">{t('seo.empty')}</p> : (
        <div className="text-[13px]" data-testid="seo-preview">
          <p className="truncate text-base text-accent">{shownTitle}</p>
          <p className="truncate text-muted">{prefix}{handle || '…'}</p>
          {text && <p className="mt-1 text-muted">{text}</p>}
        </div>
      )}
      {edit}
    </Card>
  );
}
