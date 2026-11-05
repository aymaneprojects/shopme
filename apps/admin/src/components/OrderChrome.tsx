import { ArrowLeft } from 'lucide-react';
import { useLayoutEffect } from 'react';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import type { MenuItem } from '@shopme/ui';
import { useT } from '../i18n';

/**
 * Page chrome shared by the order screens (list, detail, refund, edit, drafts, abandoned checkouts, analytics):
 * a full-width top bar (back arrow, icon, breadcrumb, actions on the right) over a content area whose width the page picks.
 */

/** Lets a page use the whole width of the content sheet (the shell caps ordinary pages at 1100px). */
export function useFullWidth() {
  useLayoutEffect(() => {
    const main = document.querySelector<HTMLElement>('#sheet > main');
    if (!main) return;
    const prev = main.style.maxWidth;
    main.style.maxWidth = 'none';
    return () => { main.style.maxWidth = prev; };
  }, []);
}

/** Top bar: [back] [icon] crumb / crumb ........ actions. Sticks to the top of the sheet. */
export function TopBar({ back, onBack, icon, crumbs, actions, children }: { back?: string; onBack?: () => void; icon?: ReactNode; crumbs: Array<{ label: ReactNode; to?: string }>; actions?: ReactNode; children?: ReactNode }) {
  const t = useT();
  return (
    <div className="sticky top-0 z-20 -mx-4 -mt-4 mb-4 flex min-h-12 flex-wrap items-center gap-2 bg-page px-4 py-1.5 md:-mx-5 md:-mt-5 md:px-5">
      {back && (onBack
        ? <button type="button" aria-label={t('common.back')} onClick={onBack} className="btn btn-secondary btn-icon btn-sm !rounded-full"><ArrowLeft className="size-4" /></button>
        : <Link to={back} aria-label={t('common.back')} className="btn btn-secondary btn-icon btn-sm !rounded-full"><ArrowLeft className="size-4" /></Link>)}
      <div className="flex min-w-0 items-center gap-1.5 text-[13px] font-medium">
        {icon && <span className="grid size-5 shrink-0 place-items-center text-muted [&_svg]:size-4" aria-hidden>{icon}</span>}
        {crumbs.map((c, i) => (
          <span key={i} className="flex min-w-0 items-center gap-1.5">
            {i > 0 && <span className="text-muted" aria-hidden>/</span>}
            {c.to && i < crumbs.length - 1 ? <Link to={c.to} className="truncate hover:underline">{c.label}</Link> : <span className={i === crumbs.length - 1 && crumbs.length > 1 ? 'truncate text-muted' : 'truncate'}>{c.label}</span>}
          </span>
        ))}
        {children}
      </div>
      <div className="ml-auto flex items-center gap-2">{actions}</div>
    </div>
  );
}

/** Big page title with optional badges and a muted line under it. */
export function PageTitle({ children, badges, subtitle }: { children: ReactNode; badges?: ReactNode; subtitle?: ReactNode }) {
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-[22px] font-semibold leading-8">{children}</h1>
        {badges}
      </div>
      {subtitle && <p className="text-[13px] text-muted">{subtitle}</p>}
    </div>
  );
}

/** Section heading with a small tinted icon tile (fulfillment / payment blocks). */
export function IconHeading({ icon, tone = 'neutral', children, actions }: { icon: ReactNode; tone?: 'neutral' | 'attention' | 'success'; children: ReactNode; actions?: ReactNode }) {
  const bg = { neutral: 'bg-surface text-muted', attention: 'bg-attention-subtle text-attention', success: 'bg-success-subtle text-success' }[tone];
  return (
    <div className="mb-2 flex min-h-8 items-center gap-2">
      <span className={`grid size-7 shrink-0 place-items-center rounded-lg [&_svg]:size-4 ${bg}`} aria-hidden>{icon}</span>
      <h2 className="text-sm font-semibold">{children}</h2>
      {actions && <div className="ml-auto flex items-center gap-2">{actions}</div>}
    </div>
  );
}

/** Flat block of the right-hand column: heading with an optional action, separated from the next block by a rule. */
export function SideSection({ title, action, children, label }: { title: ReactNode; action?: ReactNode; children?: ReactNode; label?: string }) {
  return (
    <section aria-label={label} className="border-b border-line py-3.5 first:pt-0 last:border-0">
      <div className="flex min-h-7 items-center justify-between gap-2">
        <h2 className="text-[13px] font-semibold">{title}</h2>
        {action}
      </div>
      {children && <div className="mt-1.5 text-[13px]">{children}</div>}
    </section>
  );
}

/** Two-column order layout: 620px main column and a 230px side column, centred. */
export function TwoColumn({ main, side }: { main: ReactNode; side?: ReactNode }) {
  return (
    <div className="mx-auto grid max-w-[890px] gap-x-10 gap-y-4 lg:grid-cols-[minmax(0,1fr)_14.375rem]">
      <div className="flex min-w-0 flex-col gap-4">{main}</div>
      {side && <div className="min-w-0">{side}</div>}
    </div>
  );
}

/** Keeps menu labels on one line so the popup grows with its longest entry. */
export function nowrapItems(items: MenuItem[]): MenuItem[] {
  return items.map((i) => ({ ...i, label: <span className="whitespace-nowrap">{i.label}</span> }));
}

/** Quantity shown as a small grey chip next to the unit price. */
export function QtyChip({ n }: { n: number }) {
  return <span className="inline-grid min-w-6 place-items-center rounded-md bg-surface px-1.5 text-xs text-muted">{n}</span>;
}

