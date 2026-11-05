import { ChevronDown, X } from 'lucide-react';
import { createContext, useCallback, useContext, useEffect, useId, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react';
import { Button, ButtonGroup, cx } from './basics';
import type { ButtonProps } from './basics';

/** Modal built on the native <dialog> element (focus trap, Escape, inert backdrop). Fades and scales in. */
export function Modal({ open, onClose, title, children, footer, closeLabel = 'Close', wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode; closeLabel?: string; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref} onClose={onClose} onClick={(e) => e.target === ref.current && onClose()}
      className={cx('modal m-auto w-[calc(100%-2rem)] rounded-xl border-0 bg-canvas p-0 text-fg shadow-pop', wide ? 'max-w-2xl' : 'max-w-md')}
    >
      {open && (
        <div className="flex max-h-[85vh] flex-col">
          <header className="flex items-center justify-between border-b border-line px-4 py-3">
            <h2 className="text-[13px] font-semibold">{title}</h2>
            <Button variant="plain" size="sm" icon aria-label={closeLabel} onClick={onClose} className="btn-neutral"><X className="size-4" /></Button>
          </header>
          <div className="overflow-y-auto p-4">{children}</div>
          {footer && <footer className="flex justify-end gap-2 border-t border-line px-4 py-3">{footer}</footer>}
        </div>
      )}
    </dialog>
  );
}

export function ConfirmDialog({ open, title, message, confirmLabel, cancelLabel, danger, onConfirm, onClose }: { open: boolean; title: string; message: ReactNode; confirmLabel: string; cancelLabel: string; danger?: boolean; onConfirm: () => void; onClose: () => void }) {
  return (
    <Modal open={open} onClose={onClose} title={title} footer={<><Button onClick={onClose}>{cancelLabel}</Button><Button variant={danger ? 'critical' : 'primary'} onClick={onConfirm}>{confirmLabel}</Button></>}>
      <div className="text-[13px]">{message}</div>
    </Modal>
  );
}

/** Closes a floating panel on outside press and Escape (focus returns to the trigger). */
function useDismiss(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && close();
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      close();
      ref.current?.querySelector<HTMLElement>('[aria-haspopup],[data-popover-trigger]')?.focus();
    };
    document.addEventListener('mousedown', down);
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('mousedown', down); document.removeEventListener('keydown', key); };
  }, [open, close]);
  return ref;
}

export interface MenuItem { key: string; label: ReactNode; onSelect: () => void; danger?: boolean; disabled?: boolean }

/** Button + popup menu with arrow-key navigation. Closes on outside click, Escape and selection. */
export function Dropdown({ trigger, items, align = 'left', label, variant = 'secondary', size = 'md', icon, chevron }: { trigger: ReactNode; items: MenuItem[]; align?: 'left' | 'right'; label?: string; variant?: ButtonProps['variant']; size?: ButtonProps['size']; icon?: boolean; chevron?: boolean }) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const ref = useDismiss(open, close);
  const menu = useRef<HTMLUListElement>(null);
  useEffect(() => { if (open) menu.current?.querySelector<HTMLElement>('[role=menuitem]:not(:disabled)')?.focus({ preventScroll: true }); }, [open]);
  const nav = (e: ReactKeyboardEvent) => {
    const els = [...(menu.current?.querySelectorAll<HTMLElement>('[role=menuitem]:not(:disabled)') ?? [])];
    const i = els.indexOf(document.activeElement as HTMLElement);
    const go = (n: number) => { e.preventDefault(); els[(n + els.length) % els.length]?.focus(); };
    if (e.key === 'ArrowDown') go(i + 1);
    else if (e.key === 'ArrowUp') go(i - 1);
    else if (e.key === 'Home') go(0);
    else if (e.key === 'End') go(els.length - 1);
    else if (e.key === 'Tab') close();
  };
  return (
    <div ref={ref} className="relative inline-block">
      <Button variant={variant} size={size} icon={icon} aria-haspopup="menu" aria-expanded={open} aria-label={label} onClick={() => setOpen(!open)}>
        {trigger}{chevron && <ChevronDown className="size-3.5" />}
      </Button>
      {open && (
        <ul ref={menu} role="menu" onKeyDown={nav} className={cx('anim-menu absolute z-30 mt-1 min-w-48 rounded-lg bg-canvas p-1 shadow-pop', align === 'right' ? 'right-0' : 'left-0')}>
          {items.map((it) => (
            <li key={it.key} role="none">
              <button role="menuitem" type="button" disabled={it.disabled} onClick={() => { setOpen(false); it.onSelect(); }}
                className={cx('block w-full rounded-md px-2.5 py-1.5 text-left text-[13px] hover:bg-hover focus-visible:bg-hover focus-visible:outline-none disabled:opacity-50', it.danger && 'text-critical hover:bg-critical-subtle')}>
                {it.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Primary action with a chevron that opens related actions. */
export function SplitButton({ children, onClick, items, variant = 'primary', loading, disabled, menuLabel = 'More', size = 'md' }: { children: ReactNode; onClick: () => void; items: MenuItem[]; variant?: ButtonProps['variant']; loading?: boolean; disabled?: boolean; menuLabel?: string; size?: ButtonProps['size'] }) {
  return (
    <ButtonGroup>
      <Button variant={variant} size={size} onClick={onClick} loading={loading} disabled={disabled}>{children}</Button>
      <Dropdown align="right" variant={variant} size={size} icon label={menuLabel} trigger={<ChevronDown className="size-3.5" />} items={items} />
    </ButtonGroup>
  );
}

/** Click-to-open floating panel for arbitrary content. */
export function Popover({ trigger, children, align = 'left', label, className }: { trigger: ReactNode; children: ReactNode | ((close: () => void) => ReactNode); align?: 'left' | 'right'; label?: string; className?: string }) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const ref = useDismiss(open, close);
  return (
    <div ref={ref} className="relative inline-block">
      <Button aria-haspopup="dialog" data-popover-trigger aria-expanded={open} aria-label={label} onClick={() => setOpen(!open)}>{trigger}</Button>
      {open && <div role="dialog" aria-label={label} className={cx('anim-menu absolute z-30 mt-1 rounded-lg bg-canvas p-3 shadow-pop', align === 'right' ? 'right-0' : 'left-0', className)}>{typeof children === 'function' ? children(close) : children}</div>}
    </div>
  );
}

/** Tooltip that appears after a short hover delay (or immediately on keyboard focus). */
export function Tooltip({ content, children, delay = 450, side = 'bottom' }: { content: ReactNode; children: ReactNode; delay?: number; side?: 'top' | 'bottom' }) {
  const [show, setShow] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const id = useId();
  const on = (wait: number) => { clearTimeout(timer.current); timer.current = setTimeout(() => setShow(true), wait); };
  const off = () => { clearTimeout(timer.current); setShow(false); };
  useEffect(() => () => clearTimeout(timer.current), []);
  return (
    <span className="relative inline-flex" onMouseEnter={() => on(delay)} onMouseLeave={off} onFocus={() => on(0)} onBlur={off} onKeyDown={(e) => e.key === 'Escape' && off()} aria-describedby={show ? id : undefined}>
      {children}
      {show && <span id={id} role="tooltip" className={cx('tip left-1/2 -translate-x-1/2', side === 'bottom' ? 'top-full mt-1.5' : 'bottom-full mb-1.5')}>{content}</span>}
    </span>
  );
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: Array<{ id: T; label: ReactNode }>; value: T; onChange: (v: T) => void }) {
  const onKey = (e: ReactKeyboardEvent) => {
    const i = tabs.findIndex((t) => t.id === value);
    const n = e.key === 'ArrowRight' ? i + 1 : e.key === 'ArrowLeft' ? i - 1 : null;
    if (n === null) return;
    e.preventDefault();
    const next = tabs[(n + tabs.length) % tabs.length]!;
    onChange(next.id);
    (e.currentTarget.querySelectorAll<HTMLElement>('[role=tab]')[(n + tabs.length) % tabs.length])?.focus();
  };
  return (
    <div role="tablist" onKeyDown={onKey} className="flex gap-1 border-b border-line">
      {tabs.map((t) => (
        <button key={t.id} role="tab" type="button" tabIndex={value === t.id ? 0 : -1} aria-selected={value === t.id} onClick={() => onChange(t.id)}
          className={cx('-mb-px rounded-t-md border-b-2 px-3 py-2 text-[13px] font-medium', value === t.id ? 'border-accent text-accent' : 'border-transparent text-muted hover:bg-hover hover:text-fg')}>
          {t.label}
        </button>
      ))}
    </div>
  );
}

type ToastTone = 'success' | 'critical' | 'info';
export interface ToastOptions { action?: { label: string; onClick: () => void }; duration?: number }
interface ToastItem extends ToastOptions { id: number; message: string; tone: ToastTone; leaving?: boolean }
type Push = (message: string, tone?: ToastTone, options?: ToastOptions) => void;
const ToastCtx = createContext<Push>(() => {});
export const useToast = () => useContext(ToastCtx);

/** Dark pill at the bottom centre; slides up, auto-dismisses after 5 s, optional action, red for errors. */
export function ToastProvider({ children, dismissLabel = 'Dismiss' }: { children: ReactNode; dismissLabel?: string }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const remove = useCallback((id: number) => {
    setItems((s) => s.map((i) => (i.id === id ? { ...i, leaving: true } : i)));
    setTimeout(() => setItems((s) => s.filter((i) => i.id !== id)), 170);
  }, []);
  const push = useCallback<Push>((message, tone = 'success', options) => {
    const id = Date.now() + Math.random();
    setItems((s) => [...s.slice(-2), { id, message, tone, ...options }]);
    setTimeout(() => remove(id), options?.duration ?? 5000);
  }, [remove]);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-5 z-[80] flex flex-col items-center gap-2 px-4" aria-live="polite">
        {items.map((i) => (
          <div key={i.id} role={i.tone === 'critical' ? 'alert' : 'status'} data-leaving={i.leaving ? 'true' : undefined}
            className={cx('anim-toast pointer-events-auto flex max-w-lg items-center gap-3 rounded-xl py-2 pl-4 pr-2 text-[13px] font-medium shadow-pop', i.tone === 'critical' ? 'bg-[var(--color-critical-fill)] text-white' : 'bg-ink text-ink-text')}>
            <span>{i.message}</span>
            {i.action && <button type="button" onClick={() => { i.action!.onClick(); remove(i.id); }} className="rounded-md px-2 py-1 font-semibold underline-offset-2 hover:bg-white/15 hover:underline">{i.action.label}</button>}
            <button type="button" aria-label={dismissLabel} onClick={() => remove(i.id)} className="grid size-6 place-items-center rounded-md opacity-70 hover:bg-white/15 hover:opacity-100"><X className="size-3.5" /></button>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
