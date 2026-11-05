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
export function SeoListing({ title, prefix, handle, onHandle, description, seoTitle = '', onSeoTitle, seoDescription = '', onSeoDescription }: {
  title: string; prefix: string; handle: string; onHandle: (v: string) => void; description: string;
  seoTitle?: string; onSeoTitle?: (v: string) => void; seoDescription?: string; onSeoDescription?: (v: string) => void;
}) {
  const { t } = useI18n();
  const [editing, setEditing] = useState(false);
  const shownTitle = seoTitle.trim() || title;
  const text = (seoDescription.trim() || strip(description)).slice(0, DESCRIPTION_MAX);
  return (
    <Card title={t('seo.title')} actions={<Button size="sm" icon aria-label={t('seo.edit')} aria-expanded={editing} onClick={() => setEditing((v) => !v)}><Pencil className="size-3.5" /></Button>}>
      {!shownTitle && !text ? <p className="text-[13px] text-muted">{t('seo.empty')}</p> : (
        <div className="text-[13px]" data-testid="seo-preview">
          <p className="truncate text-base text-accent">{shownTitle}</p>
          <p className="truncate text-muted">{prefix}{handle || '…'}</p>
          {text && <p className="mt-1 text-muted">{text}</p>}
        </div>
      )}
      {editing && (
        <div className="mt-4 flex flex-col gap-3 border-t border-line pt-4">
          {onSeoTitle && <Input label={t('seo.pageTitle')} value={seoTitle} placeholder={title} help={t('seo.chars', { n: seoTitle.length, max: TITLE_MAX })} onChange={(e) => onSeoTitle(e.target.value)} />}
          {onSeoDescription && <Textarea label={t('seo.metaDescription')} rows={3} value={seoDescription} help={t('seo.chars', { n: seoDescription.length, max: DESCRIPTION_MAX })} onChange={(e) => onSeoDescription(e.target.value)} />}
          <Input label={`${t('seo.url')} (${prefix})`} value={handle} onChange={(e) => onHandle(e.target.value)} />
        </div>
      )}
    </Card>
  );
}
