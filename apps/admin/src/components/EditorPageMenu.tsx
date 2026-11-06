import { cx } from '@shopme/ui';
import { ChevronDown, CircleCheck, LayoutTemplate, LogIn, Package, ShoppingCart, UserRound, Store } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useT } from '../i18n';
import type { Key } from '../i18n';
import { EDITOR_GROUPS, type EditorPage } from '../lib/checkout-editor';

export const PAGE_ICON: Record<EditorPage, LucideIcon> = { checkout: ShoppingCart, 'thank-you': CircleCheck, login: LogIn, orders: Package, order: LayoutTemplate, profile: UserRound };

/**
 * The checkout and customer accounts editor's page selector: a button with the current page that opens the pages in groups
 * (checkout, post-purchase, customer accounts), then a link back to the theme of the online store.
 */
export function EditorPageMenu({ current, onSelect, onTheme }: { current: EditorPage; onSelect: (page: EditorPage) => void; onTheme: () => void }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', down); document.addEventListener('keydown', key);
    return () => { document.removeEventListener('mousedown', down); document.removeEventListener('keydown', key); };
  }, [open]);
  const Icon = PAGE_ICON[current];
  const item = 'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] hover:bg-hover';
  return (
    <div ref={ref} className="pointer-events-auto relative">
      <button type="button" aria-haspopup="menu" aria-expanded={open} aria-label={t('ckeditor.pageMenu')} onClick={() => setOpen((v) => !v)} className="flex h-7 items-center gap-1.5 rounded-md bg-surface pl-2 pr-1.5 text-[12px] hover:bg-hover">
        <Icon className="size-3.5" aria-hidden /><span>{t(`ckeditor.page.${current}` as Key)}</span><ChevronDown className="size-3.5" aria-hidden />
      </button>
      {open && (
        <div role="menu" aria-label={t('ckeditor.pageMenu')} className="absolute left-1/2 top-9 z-50 w-[260px] -translate-x-1/2 rounded-xl border border-line bg-canvas p-2 shadow-pop">
          {EDITOR_GROUPS.map((g) => (
            <div key={g.id} role="group" aria-label={t(g.label)} className="mb-1">
              <p className="px-2 pb-1 pt-1.5 text-[11px] font-semibold text-muted">{t(g.label)}</p>
              {g.pages.map((p) => {
                const I = PAGE_ICON[p];
                return <button key={p} type="button" role="menuitemradio" aria-checked={p === current} onClick={() => { setOpen(false); onSelect(p); }} className={cx(item, p === current && 'bg-primary-subtle text-accent')}><I className="size-4" aria-hidden />{t(`ckeditor.page.${p}` as Key)}</button>;
              })}
            </div>
          ))}
          <div className="mt-1 border-t border-line pt-1">
            <button type="button" role="menuitem" onClick={() => { setOpen(false); onTheme(); }} className={item}><Store className="size-4" aria-hidden />{t('ckeditor.themePage')}</button>
          </div>
        </div>
      )}
    </div>
  );
}
