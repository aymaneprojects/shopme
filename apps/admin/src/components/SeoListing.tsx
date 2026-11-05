import { Button, Card, Input } from '@shopme/ui';
import { Pencil } from 'lucide-react';
import { useState } from 'react';
import { useI18n } from '../i18n';

const strip = (html: string) => html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

/** "Search engine listing" card: a preview of how the page appears in search results, with an edit toggle for the URL handle. */
export function SeoListing({ title, prefix, handle, onHandle, description }: { title: string; prefix: string; handle: string; onHandle: (v: string) => void; description: string }) {
  const { t } = useI18n();
  const [editing, setEditing] = useState(false);
  const text = strip(description).slice(0, 160);
  return (
    <Card title={t('seo.title')} actions={<Button size="sm" icon aria-label={t('seo.edit')} onClick={() => setEditing((v) => !v)}><Pencil className="size-3.5" /></Button>}>
      {editing && <Input className="mb-3" label={`${t('product.handle')} (${prefix})`} value={handle} onChange={(e) => onHandle(e.target.value)} />}
      {!title && !text ? <p className="text-[13px] text-muted">{t('seo.empty')}</p> : (
        <div className="text-[13px]">
          <p className="truncate text-base text-accent">{title}</p>
          <p className="truncate text-muted">{prefix}{handle || '…'}</p>
          {text && <p className="mt-1 text-muted">{text}</p>}
        </div>
      )}
    </Card>
  );
}
