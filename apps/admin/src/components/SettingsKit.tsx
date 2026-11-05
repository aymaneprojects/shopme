import { cx } from '@shopme/ui';
import { ArrowLeft, ChevronDown, ChevronRight } from 'lucide-react';
import { createContext, useContext, useState } from 'react';
import type { ComponentType, ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router';
import { useT } from '../i18n';

/** Slot in the settings title row (top right) where a page puts its primary actions. */
export const SettingsSlot = createContext<HTMLElement | null>(null);
export function SettingsActions({ children }: { children: ReactNode }) {
  const el = useContext(SettingsSlot);
  return el ? createPortal(children, el) : null;
}

/** Section of a settings page: title and description on top, then the cards. */
export function Section({ title, description, action, children, className }: { title: ReactNode; description?: ReactNode; action?: ReactNode; children?: ReactNode; className?: string }) {
  return (
    <section className={cx('flex flex-col gap-2.5', className)}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold leading-6">{title}</h2>
          {description && <p className="text-[13px] text-muted">{description}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

/** Card holding rows separated by hairlines. */
export function RowCard({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx('divide-y divide-line overflow-hidden rounded-lg bg-canvas shadow-card', className)}>{children}</div>;
}

interface RowProps { icon?: ComponentType<{ className?: string }>; title: ReactNode; description?: ReactNode; trailing?: ReactNode }
function RowBody({ icon: Icon, title, description, trailing, chevron }: RowProps & { chevron?: boolean }) {
  return (
    <>
      {Icon && <Icon className="size-4 shrink-0 text-muted" />}
      <span className="min-w-0 flex-1"><span className="block text-[13px] font-medium">{title}</span>{description && <span className="block text-[13px] text-muted">{description}</span>}</span>
      {trailing && <span className="flex shrink-0 items-center gap-2 text-[13px] text-muted">{trailing}</span>}
      {chevron && <ChevronRight className="size-4 shrink-0 text-muted" aria-hidden />}
    </>
  );
}
const rowCls = 'flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-hover';
export const LinkRow = ({ to, ...p }: RowProps & { to: string }) => <Link to={to} className={rowCls}><RowBody {...p} chevron /></Link>;
export const ButtonRow = ({ onClick, chevron = true, ...p }: RowProps & { onClick: () => void; chevron?: boolean }) => <button type="button" onClick={onClick} className={rowCls}><RowBody {...p} chevron={chevron} /></button>;

/** Header of a settings sub-page: round back button with the parent name, then the large title; actions go on the right. */
export function SubHeader({ back, parent, title, actions }: { back: string; parent: ReactNode; title: ReactNode; actions?: ReactNode }) {
  const t = useT();
  return (
    <div className="mb-5">
      <div className="mb-3 flex items-center gap-2">
        <Link to={back} aria-label={t('common.back')} className="btn btn-secondary btn-icon btn-sm"><ArrowLeft className="size-4" /></Link>
        <span className="text-[13px] text-muted">{parent}</span>
        <div className="ml-auto flex items-center gap-2">{actions}</div>
      </div>
      <h1 className="text-xl font-semibold leading-8">{title}</h1>
    </div>
  );
}

/** Row of a settings card that opens in place: title and description on the left, summary and chevron on the right. */
export function CollapseRow({ title, description, summary, defaultOpen, children }: { title: ReactNode; description?: ReactNode; summary?: ReactNode; defaultOpen?: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(!!defaultOpen);
  return (
    <div>
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-hover">
        <span className="min-w-0 flex-1"><span className="block text-[13px] font-medium">{title}</span>{description && <span className="block text-[13px] text-muted">{description}</span>}</span>
        {summary && <span className="shrink-0 text-[13px] text-muted">{summary}</span>}
        <ChevronDown className={cx('size-4 shrink-0 text-muted transition-transform', open && 'rotate-180')} aria-hidden />
      </button>
      {open && <div className="px-3 pb-3">{children}</div>}
    </div>
  );
}
