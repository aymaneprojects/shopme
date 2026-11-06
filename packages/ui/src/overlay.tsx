import { ChevronDown, X } from 'lucide-react';
import { cloneElement, createContext, isValidElement, useCallback, useContext, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent, ReactNode, RefObject } from 'react';
import { Button, ButtonGroup, cx } from './basics';
import type { ButtonProps } from './basics';

/** Modal built on the native <dialog> element (focus trap, Escape, inert backdrop). Fades and scales in. */
export function Modal({ open, onClose, title, children, footer, footerStart, closeLabel = 'Close', wide, medium, xl, plain }: { /** Mid-size dialog (about 32rem). */ medium?: boolean; /** Large dialog (about 64rem), e.g. an image preview. */ xl?: boolean; open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode; /** Left-aligned footer content, e.g. a selected count. */ footerStart?: ReactNode; closeLabel?: string; wide?: boolean; /** Compact dialog without divider lines (confirmations). */ plain?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref} aria-labelledby={titleId} onClose={onClose} onClick={(e) => {
        if (e.target !== e.currentTarget) return;
        // Native dialogs receive backdrop clicks too. Padding and scrollbars are inside the dialog.
        const box = e.currentTarget.getBoundingClientRect();
        if (e.clientX < box.left || e.clientX > box.right || e.clientY < box.top || e.clientY > box.bottom) onClose();
      }}
      className={cx('modal m-auto w-[calc(100%-2rem)] rounded-xl border-0 bg-canvas p-0 text-fg shadow-pop', xl ? 'max-w-5xl' : wide ? 'max-w-2xl' : medium ? 'max-w-lg' : 'max-w-md')}
    >
      {open && (
        <div className="flex max-h-[85vh] flex-col">
          <header className={cx('flex shrink-0 items-center justify-between gap-3 px-4 py-3', !plain && 'border-b border-line')}>
            <h2 id={titleId} className="min-w-0 break-words text-[13px] font-semibold">{title}</h2>
            <Button variant="plain" size="sm" icon aria-label={closeLabel} onClick={onClose} className="btn-neutral shrink-0"><X className="size-4" /></Button>
          </header>
          <div className={cx('min-h-0 overflow-y-auto p-4', plain && 'pt-1')}>{children}</div>
          {(footer || footerStart) && (
            <footer className={cx('flex shrink-0 flex-wrap items-center gap-2 px-4 py-3', !plain && 'border-t border-line', footerStart ? 'justify-between' : 'justify-end')}>
              {footerStart && <span className="min-w-0 max-w-full break-words text-[13px]">{footerStart}</span>}
              {footer && <span className="flex min-w-0 max-w-full flex-wrap justify-end gap-2 [&_.btn]:h-auto [&_.btn]:min-h-[var(--h-btn)] [&_.btn]:max-w-full [&_.btn]:whitespace-normal [&_.btn]:py-1 [&_.btn-label]:min-w-0 [&_.btn-label]:break-words">{footer}</span>}
            </footer>
          )}
        </div>
      )}
    </dialog>
  );
}

/** Confirmation: compact, no dividers; destructive confirmations (`danger`) use the critical button. */
export function ConfirmDialog({ open, title, message, confirmLabel, cancelLabel, closeLabel, danger, loading, onConfirm, onClose }: { open: boolean; title: string; message: ReactNode; confirmLabel: string; cancelLabel: string; closeLabel?: string; danger?: boolean; loading?: boolean; onConfirm: () => void; onClose: () => void }) {
  return (
    <Modal open={open} onClose={onClose} title={title} closeLabel={closeLabel} plain footer={<><Button onClick={onClose}>{cancelLabel}</Button><Button variant={danger ? 'critical' : 'primary'} loading={loading} onClick={onConfirm}>{confirmLabel}</Button></>}>
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
      e.preventDefault();
      e.stopPropagation();
      close();
      ref.current?.querySelector<HTMLElement>('[aria-haspopup],[data-popover-trigger]')?.focus();
    };
    const panel = ref.current;
    document.addEventListener('mousedown', down);
    panel?.addEventListener('keydown', key);
    return () => { document.removeEventListener('mousedown', down); panel?.removeEventListener('keydown', key); };
  }, [open, close]);
  return ref;
}

const floatingStyle: CSSProperties = { position: 'fixed', inset: 'auto', margin: 0, border: 0, overflow: 'auto' };

/** Keep floating controls outside ancestor clipping without moving them out of a modal's DOM/focus scope. */
function useFloatingPanel<T extends HTMLElement>(open: boolean, anchor: RefObject<HTMLDivElement | null>, panel: RefObject<T | null>, align: 'left' | 'right') {
  useLayoutEffect(() => {
    const element = panel.current;
    if (!open || !element || !anchor.current) return;
    // The native popover top layer escapes scroll containers and transformed ancestors.
    // Older browsers still receive bounded fixed positioning.
    if (typeof element.showPopover === 'function') element.showPopover();
    else element.style.display = 'block';
    const update = () => {
      const trigger = anchor.current?.getBoundingClientRect();
      if (!trigger) return;
      const padding = 8, gap = 4;
      const viewportWidth = window.innerWidth, viewportHeight = window.innerHeight;
      const availableWidth = Math.max(0, viewportWidth - padding * 2);
      element.style.maxWidth = `${availableWidth}px`;
      element.style.minWidth = '';
      if (parseFloat(getComputedStyle(element).minWidth) > availableWidth) element.style.minWidth = `${availableWidth}px`;
      const box = element.getBoundingClientRect();
      // offset dimensions exclude the entry animation's scale transform.
      const width = element.offsetWidth || box.width;
      const naturalHeight = Math.max(element.scrollHeight, element.offsetHeight, box.height);
      const availableViewportHeight = Math.max(0, viewportHeight - padding * 2);
      const below = Math.max(0, Math.min(availableViewportHeight, viewportHeight - trigger.bottom - gap - padding));
      const above = Math.max(0, Math.min(availableViewportHeight, trigger.top - gap - padding));
      const placeAbove = naturalHeight > below && above > below;
      const availableHeight = placeAbove ? above : below;
      const height = Math.min(naturalHeight, availableHeight);
      const left = align === 'right' ? trigger.right - width : trigger.left;
      const top = placeAbove ? trigger.top - gap - height : trigger.bottom + gap;
      element.style.left = `${Math.max(padding, Math.min(left, viewportWidth - width - padding))}px`;
      element.style.top = `${Math.max(padding, Math.min(top, viewportHeight - height - padding))}px`;
      element.style.maxHeight = `${availableHeight}px`;
      element.style.transformOrigin = placeAbove ? 'bottom' : 'top';
    };
    update();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update);
    observer?.observe(element);
    observer?.observe(anchor.current);
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
      element.hidePopover?.();
    };
  }, [open, anchor, panel, align]);
}

export interface MenuItem { key: string; label: ReactNode; onSelect: () => void; danger?: boolean; disabled?: boolean; /** Optional leading icon. */ icon?: ReactNode; /** Draws a divider above this item (groups related actions). */ separatorBefore?: boolean; /** Keyboard shortcut hint shown on the right, e.g. `Ctrl+D`. */ shortcut?: string; /** Small heading drawn above this item (starts a titled group, e.g. "Print"). */ section?: string }

/** Button + popup menu with arrow-key navigation. Closes on outside click, Escape and selection. */
export function Dropdown({ trigger, items, align = 'left', label, variant = 'secondary', size = 'md', icon, chevron, className, menuClassName, footer, disabled, title }: { /** Block shown under the items (e.g. a hint or a link). */ footer?: ReactNode; /** Greys the trigger out (for example while the page has unsaved changes). */ disabled?: boolean; title?: string; trigger: ReactNode; items: MenuItem[]; align?: 'left' | 'right'; label?: string; variant?: ButtonProps['variant']; size?: ButtonProps['size']; icon?: boolean; chevron?: boolean; /** Extra classes for the trigger button (e.g. `chip`). */ className?: string; menuClassName?: string }) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const ref = useDismiss(open, close);
  const menu = useRef<HTMLUListElement>(null);
  useFloatingPanel(open, ref, menu, align);
  const menuId = useId();
  const triggerId = useId();
  const openingEdge = useRef<'first' | 'last'>('first');
  const focusItem = (edge: 'first' | 'last') => {
    const els = menu.current?.querySelectorAll<HTMLElement>('[role=menuitem]:not(:disabled)');
    (edge === 'last' ? els?.[els.length - 1] : els?.[0])?.focus({ preventScroll: true });
  };
  useEffect(() => { if (open) focusItem(openingEdge.current); }, [open]);
  const select = (item: MenuItem) => {
    close();
    // Restore focus before the action: a dialog or navigation may deliberately move it next.
    ref.current?.querySelector<HTMLElement>('[aria-haspopup="menu"]')?.focus({ preventScroll: true });
    item.onSelect();
  };
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
      <Button id={triggerId} variant={variant} size={size} icon={icon} className={className} aria-haspopup="menu" aria-controls={open ? menuId : undefined} aria-expanded={open} aria-label={label} disabled={disabled} title={title}
        onKeyDown={(e) => {
          if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
          e.preventDefault();
          openingEdge.current = e.key === 'ArrowUp' ? 'last' : 'first';
          if (open) focusItem(openingEdge.current); else setOpen(true);
        }}
        onClick={() => { openingEdge.current = 'first'; setOpen(!open); }}>
        {trigger}{chevron && <ChevronDown className="size-3.5" />}
      </Button>
      {open && (
        <ul ref={menu} id={menuId} popover="manual" style={floatingStyle} role="menu" aria-labelledby={triggerId} onKeyDown={nav} className={cx('anim-menu z-[90] min-w-48 rounded-lg bg-canvas p-1 text-fg shadow-pop', menuClassName)}>
          {items.map((it) => (
            <li key={it.key} role="none" className={it.separatorBefore || it.section ? 'mt-1 border-t border-line pt-1 first:mt-0 first:border-t-0 first:pt-0' : undefined}>
              {it.section && <div role="presentation" className="px-2.5 pb-0.5 pt-1 text-xs font-medium text-muted">{it.section}</div>}
              <button role="menuitem" type="button" disabled={it.disabled} onClick={() => select(it)}
                className={cx('flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[13px] hover:bg-hover focus-visible:bg-hover focus-visible:outline-none disabled:opacity-50', it.danger && 'text-critical hover:bg-critical-subtle')}>
                {it.icon && <span className="grid size-4 shrink-0 place-items-center [&_svg]:size-4" aria-hidden>{it.icon}</span>}
                <span className="min-w-0 flex-1 break-words">{it.label}</span>
                {it.shortcut && <kbd className="ml-4 text-xs text-muted">{it.shortcut}</kbd>}
              </button>
            </li>
          ))}
          {footer && <li role="none" className="mt-1 border-t border-line px-2.5 pb-1 pt-2 text-xs text-muted">{footer}</li>}
        </ul>
      )}
    </div>
  );
}

/** Context menu that opens at the pointer (`at` = viewport coordinates); closes on outside press, Escape and selection. */
export function ContextMenu({ at, items, onClose, footer }: { at: { x: number; y: number } | null; items: MenuItem[]; onClose: () => void; footer?: ReactNode }) {
  const menu = useRef<HTMLUListElement>(null);
  useEffect(() => {
    if (!at) return;
    menu.current?.querySelector<HTMLElement>('[role=menuitem]:not(:disabled)')?.focus({ preventScroll: true });
    const down = (e: MouseEvent) => { if (!menu.current?.contains(e.target as Node)) onClose(); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', down); document.addEventListener('keydown', key);
    return () => { document.removeEventListener('mousedown', down); document.removeEventListener('keydown', key); };
  }, [at, onClose]);
  if (!at) return null;
  const nav = (e: ReactKeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); return; }
    const els = [...(menu.current?.querySelectorAll<HTMLElement>('[role=menuitem]:not(:disabled)') ?? [])];
    const i = els.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); els[(i + 1) % els.length]?.focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); els[(i - 1 + els.length) % els.length]?.focus(); }
  };
  const left = Math.min(at.x, window.innerWidth - 240), top = Math.min(at.y, window.innerHeight - 40 * items.length - 24);
  return (
    <ul ref={menu} role="menu" onKeyDown={nav} style={{ left, top }} className="anim-menu fixed z-[90] min-w-48 rounded-lg bg-canvas p-1 shadow-pop">
      {items.map((it) => (
        <li key={it.key} role="none" className={it.separatorBefore ? 'mt-1 border-t border-line pt-1' : undefined}>
          <button role="menuitem" type="button" disabled={it.disabled} onClick={() => { onClose(); it.onSelect(); }}
            className={cx('flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[13px] hover:bg-hover focus-visible:bg-hover focus-visible:outline-none disabled:opacity-50', it.danger && 'text-critical hover:bg-critical-subtle')}>
            {it.icon && <span className="grid size-4 shrink-0 place-items-center [&_svg]:size-4" aria-hidden>{it.icon}</span>}
            <span className="flex-1">{it.label}</span>
            {it.shortcut && <kbd className="ml-4 text-xs text-muted">{it.shortcut}</kbd>}
          </button>
        </li>
      ))}
      {footer && <li role="none" className="mt-1 border-t border-line px-2.5 pb-1 pt-2 text-xs text-muted">{footer}</li>}
    </ul>
  );
}

/** Primary action with a chevron that opens related actions. */
export function SplitButton({ children, onClick, items, variant = 'primary', loading, disabled, menuLabel = 'More', size = 'md' }: { children: ReactNode; onClick: () => void; items: MenuItem[]; variant?: ButtonProps['variant']; loading?: boolean; disabled?: boolean; menuLabel?: string; size?: ButtonProps['size'] }) {
  return (
    <ButtonGroup>
      <Button variant={variant} size={size} onClick={onClick} loading={loading} disabled={disabled}>{children}</Button>
      <Dropdown align="right" variant={variant} size={size} icon disabled={disabled || loading} label={menuLabel} trigger={<ChevronDown className="size-3.5" />} items={items} />
    </ButtonGroup>
  );
}

/** Click-to-open floating panel for arbitrary content. */
export function Popover({ trigger, children, align = 'left', label, className, triggerVariant, triggerClassName }: { triggerVariant?: ButtonProps['variant']; triggerClassName?: string; trigger: ReactNode; children: ReactNode | ((close: () => void) => ReactNode); align?: 'left' | 'right'; label?: string; className?: string }) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const ref = useDismiss(open, close);
  const panel = useRef<HTMLDivElement>(null);
  useFloatingPanel(open, ref, panel, align);
  return (
    <div ref={ref} className="relative inline-block">
      <Button variant={triggerVariant} className={triggerClassName} aria-haspopup="dialog" data-popover-trigger aria-expanded={open} aria-label={label} onClick={() => setOpen(!open)}>{trigger}</Button>
      {open && <div ref={panel} popover="manual" style={floatingStyle} role="dialog" aria-label={label} className={cx('anim-menu z-[90] rounded-lg bg-canvas p-3 text-fg shadow-pop', className)}>{typeof children === 'function' ? children(close) : children}</div>}
    </div>
  );
}

/**
 * Tooltip that appears after a short hover delay (or immediately on keyboard focus). `shortcut` shows keys as small keycaps after
 * the label, and the control it describes gets `aria-describedby` while the tooltip is open. The fade is dropped with reduced motion.
 */
export function Tooltip({ content, children, delay = 450, side = 'bottom', shortcut }: { content: ReactNode; children: ReactNode; delay?: number; side?: 'top' | 'bottom' | 'right'; shortcut?: string[] }) {
  const [show, setShow] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const id = useId();
  const on = (wait: number) => { clearTimeout(timer.current); timer.current = setTimeout(() => setShow(true), wait); };
  const off = () => { clearTimeout(timer.current); setShow(false); };
  useEffect(() => () => clearTimeout(timer.current), []);
  const child = show && isValidElement<{ 'aria-describedby'?: string }>(children) ? cloneElement(children, { 'aria-describedby': id }) : children;
  const where = side === 'right' ? 'left-full top-1/2 ml-2 -translate-y-1/2' : side === 'top' ? 'bottom-full left-1/2 mb-1.5 -translate-x-1/2' : 'top-full left-1/2 mt-1.5 -translate-x-1/2';
  return (
    <span className="relative inline-flex" onMouseEnter={() => on(delay)} onMouseLeave={off} onFocus={() => on(0)} onBlur={off} onKeyDown={(e) => e.key === 'Escape' && off()} onMouseDown={off}>
      {child}
      {show && (
        <span id={id} role="tooltip" className={cx('tip', where)}>
          {content}
          {shortcut && shortcut.length > 0 && <span className="tip-keys" aria-hidden>{shortcut.map((k) => <kbd key={k}>{k}</kbd>)}</span>}
        </span>
      )}
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
