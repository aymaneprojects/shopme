import { Button, Select } from '@shopme/ui';
import { Database } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useI18n } from '../../i18n';

export interface PreviewData { product?: string; collection?: string; page?: string; /** `<blog handle>/<article handle>` */ article?: string; locale?: string; country?: string }
export interface PreviewChoices {
  products: Array<{ handle: string; title: string }>; collections: Array<{ handle: string; title: string }>; pages: Array<{ handle: string; title: string }>;
  articles: Array<{ handle: string; title: string; blog: { handle: string } }>;
  locales: Array<{ locale: string; name: string; primary: boolean; published: boolean }>;
  countries: Array<{ code: string; name: string }>;
}

/** Top-bar button that opens the preview data panel: which product, collection, page and article the preview shows, in which language and country. */
export function PreviewDataMenu({ choices, value, onChange, className }: { choices: PreviewChoices | undefined; value: PreviewData; onChange: (v: PreviewData) => void; className?: string }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState({ left: 0, top: 0 });
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const r = btn.current?.getBoundingClientRect(); const w = box.current?.offsetWidth ?? 300;
      if (r) setPos({ left: Math.max(8, Math.min(r.right - w, window.innerWidth - w - 8)), top: r.bottom + 6 });
    };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node) && !btn.current?.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOpen(false); btn.current?.focus(); } };
    document.addEventListener('mousedown', down, true); document.addEventListener('keydown', key);
    return () => { document.removeEventListener('mousedown', down, true); document.removeEventListener('keydown', key); };
  }, [open]);
  const set = (k: keyof PreviewData, v: string) => onChange({ ...value, [k]: v || undefined });
  const c = choices;
  const changed = Object.values(value).some(Boolean);
  const pick = (k: 'product' | 'collection' | 'page', rows: Array<{ handle: string; title: string }> | undefined, label: string) => (
    <Select label={label} value={value[k] ?? ''} onChange={(e) => set(k, e.target.value)}>
      <option value="">{t('bs.preview.first')}</option>
      {rows?.map((r) => <option key={r.handle} value={r.handle}>{r.title}</option>)}
    </Select>
  );
  return (
    <>
      <button ref={btn} type="button" aria-label={t('bs.preview.title')} title={t('bs.preview.title')} aria-haspopup="dialog" aria-expanded={open} aria-pressed={changed} onClick={() => setOpen((o) => !o)} className={className}><Database className="size-4" /></button>
      {open && (
        <div ref={box} role="dialog" aria-label={t('bs.preview.title')} className="fixed z-[80] flex max-h-[min(560px,calc(100vh-70px))] w-[300px] flex-col gap-3 overflow-y-auto rounded-xl border border-line bg-canvas p-3 text-[13px] shadow-pop" style={pos}>
          <div>
            <h2 className="text-[13px] font-semibold">{t('bs.preview.title')}</h2>
            <p className="text-xs text-muted">{t('bs.preview.intro')}</p>
          </div>
          {pick('product', c?.products, t('bs.preview.product'))}
          {pick('collection', c?.collections, t('bs.preview.collection'))}
          {pick('page', c?.pages, t('bs.preview.page'))}
          <Select label={t('bs.preview.article')} value={value.article ?? ''} onChange={(e) => set('article', e.target.value)}>
            <option value="">{t('bs.preview.first')}</option>
            {c?.articles.map((a) => <option key={`${a.blog.handle}/${a.handle}`} value={`${a.blog.handle}/${a.handle}`}>{a.title}</option>)}
          </Select>
          {(c?.locales.length ?? 0) > 1 && (
            <Select label={t('bs.preview.language')} value={value.locale ?? ''} onChange={(e) => set('locale', e.target.value)}>
              <option value="">{t('bs.preview.default')}</option>
              {c!.locales.filter((l) => !l.primary).map((l) => <option key={l.locale} value={l.locale}>{l.name}{l.published ? '' : ` (${t('bs.preview.unpublished')})`}</option>)}
            </Select>
          )}
          {(c?.countries.length ?? 0) > 0 && (
            <Select label={t('bs.preview.country')} help={t('bs.preview.countryHelp')} value={value.country ?? ''} onChange={(e) => set('country', e.target.value)}>
              <option value="">{t('bs.preview.default')}</option>
              {c!.countries.map((x) => <option key={x.code} value={x.code}>{x.name}</option>)}
            </Select>
          )}
          <Button size="sm" disabled={!changed} onClick={() => onChange({})}>{t('bs.preview.reset')}</Button>
        </div>
      )}
    </>
  );
}
