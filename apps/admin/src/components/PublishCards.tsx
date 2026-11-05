import { Button, Card, Input, Select } from '@shopme/ui';
import { useQuery } from '@tanstack/react-query';
import { CalendarClock, Eye } from 'lucide-react';
import { gql } from '../api';
import { TEMPLATE_SUFFIXES } from '../graphql';
import { useI18n } from '../i18n';
import { useFormat } from './shared';

/** ISO timestamp -> `YYYY-MM-DDTHH:mm` in the browser's time zone, as `datetime-local` inputs expect. */
export function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export interface Visibility { isPublished: boolean; /** `datetime-local` value, empty when no date is set. */ publishDate: string; /** The stored publish time, to tell "visible since" from "scheduled". */ publishedAt: string | null }

/** Mutation fields for a visibility value: scheduling wins; clearing a future date publishes now. */
export function visibilityInput(v: Visibility, initial: Visibility): { isPublished?: boolean; publishDate?: string } {
  if (!v.isPublished) return { isPublished: false };
  if (v.publishDate) return { publishDate: new Date(v.publishDate).toISOString() };
  const wasScheduled = initial.publishedAt != null && new Date(initial.publishedAt) > new Date();
  return wasScheduled ? { publishDate: new Date().toISOString() } : { isPublished: true };
}

/** Visible / hidden choice plus an optional "visible on" date and time (scheduled publishing). */
export function VisibilityCard({ value, onChange }: { value: Visibility; onChange: (v: Visibility) => void }) {
  const { t } = useI18n();
  const fmt = useFormat();
  const scheduled = value.isPublished && value.publishDate !== '' && new Date(value.publishDate) > new Date();
  const [date = '', time = ''] = value.publishDate.split('T');
  const setParts = (d: string, tm: string) => onChange({ ...value, isPublished: true, publishDate: d ? `${d}T${tm || '00:00'}` : '' });
  return (
    <Card title={t('pages.visibility')}>
      <div role="radiogroup" aria-label={t('pages.visibility')} className="flex flex-col gap-2 text-[13px]">
        <label className="inline-flex items-center gap-2"><input type="radio" name="visibility" checked={value.isPublished} onChange={() => onChange({ ...value, isPublished: true })} />{t('pages.visible')}</label>
        <label className="inline-flex items-center gap-2"><input type="radio" name="visibility" checked={!value.isPublished} onChange={() => onChange({ ...value, isPublished: false, publishDate: '' })} />{t('pages.hidden')}</label>
      </div>
      {value.isPublished && (
        <div className="mt-3 flex flex-col gap-2 text-[13px]">
          {value.publishDate === '' ? (
            <>
              {value.publishedAt && new Date(value.publishedAt) <= new Date() && <p className="text-muted">{t('publish.visibleSince', { date: fmt.dateTime(value.publishedAt) })}</p>}
              <Button size="sm" className="w-fit" onClick={() => setParts(toLocalInput(new Date(Date.now() + 86_400_000).toISOString()).slice(0, 10), '09:00')}><CalendarClock className="size-4" />{t('publish.setDate')}</Button>
            </>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-2">
                <Input type="date" label={t('publish.date')} value={date} onChange={(e) => setParts(e.target.value, time)} />
                <Input type="time" label={t('publish.time')} value={time} onChange={(e) => setParts(date, e.target.value)} />
              </div>
              <p className="text-muted">{scheduled ? t('publish.scheduledOn', { date: fmt.dateTime(new Date(value.publishDate).toISOString()) }) : t('publish.visibleSince', { date: fmt.dateTime(new Date(value.publishDate).toISOString()) })}</p>
              <Button size="sm" className="w-fit" onClick={() => onChange({ ...value, publishDate: '' })}>{t('publish.clearDate')}</Button>
            </>
          )}
        </div>
      )}
      {!value.isPublished && <p className="mt-2 text-[13px] text-muted">{t('publish.hiddenHelp')}</p>}
    </Card>
  );
}

/** Theme template select: the alternate templates the live theme provides for this kind of content. */
export function TemplateCard({ kind, value, onChange, previewPath }: { kind: 'page' | 'article' | 'blog'; value: string; onChange: (v: string) => void; /** Storefront path of the saved item: the eye icon opens it with the chosen template. */ previewPath?: string | null }) {
  const { t } = useI18n();
  const q = useQuery({ queryKey: ['template-suffixes', kind], queryFn: async () => (await gql<{ shopmeTemplateSuffixes: string[] }>(TEMPLATE_SUFFIXES, { kind })).shopmeTemplateSuffixes });
  const list = q.data ?? [];
  return (
    <Card title={t('template.title')} actions={previewPath ? <a href={`${previewPath}${previewPath.includes('?') ? '&' : '?'}view=${encodeURIComponent(value)}`} target="_blank" rel="noreferrer" className="btn btn-plain btn-icon btn-sm" aria-label={t('bc.template.preview')} title={t('bc.template.preview')}><Eye className="size-4" /></a> : undefined}>
      <Select aria-label={t('template.title')} help={t('template.help')} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">{t('template.default')}</option>
        {list.map((s) => <option key={s} value={s}>{`${kind}.${s}`}</option>)}
        {value && q.data && !list.includes(value) && <option value={value}>{t('template.missing', { name: `${kind}.${value}` })}</option>}
      </Select>
    </Card>
  );
}
