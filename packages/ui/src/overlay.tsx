import { X } from 'lucide-react';
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Banner, Button, cx } from './basics';

/** Modal built on the native <dialog> element (focus trap, Escape, backdrop). */
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
      className={cx('m-auto w-full rounded-lg border border-line bg-canvas p-0 text-fg shadow-xl backdrop:bg-black/50', wide ? 'max-w-2xl' : 'max-w-md')}
    >
      {open && (
        <div className="flex max-h-[85vh] flex-col">
          <header className="flex items-center justify-between border-b border-line px-4 py-3">
            <h2 className="text-base font-semibold">{title}</h2>
            <button type="button" aria-label={closeLabel} onClick={onClose} className="rounded p-1 hover:bg-surface"><X className="size-4" /></button>
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
    <Modal open={open} onClose={onClose} title={title} footer={<><Button onClick={onClose}>{cancelLabel}</Button><Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm}>{confirmLabel}</Button></>}>
      <div className="text-sm">{message}</div>
    </Modal>
  );
}

export interface MenuItem { key: string; label: ReactNode; onSelect: () => void; danger?: boolean; disabled?: boolean }

/** Button + popup menu. Closes on outside click, Escape and selection. */
export function Dropdown({ trigger, items, align = 'left', label }: { trigger: ReactNode; items: MenuItem[]; align?: 'left' | 'right'; label?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const key = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', down);
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('mousedown', down); document.removeEventListener('keydown', key); };
  }, [open]);
  return (
    <div ref={ref} className="relative inline-block">
      <button type="button" aria-haspopup="menu" aria-expanded={open} aria-label={label} onClick={() => setOpen(!open)} className="inline-flex items-center gap-1.5 rounded-md border border-line bg-canvas px-3 py-2 text-sm font-medium hover:bg-surface">
        {trigger}
      </button>
      {open && (
        <ul role="menu" className={cx('absolute z-30 mt-1 min-w-44 rounded-md border border-line bg-canvas py-1 shadow-lg', align === 'right' ? 'right-0' : 'left-0')}>
          {items.map((it) => (
            <li key={it.key} role="none">
              <button role="menuitem" type="button" disabled={it.disabled} onClick={() => { setOpen(false); it.onSelect(); }}
                className={cx('block w-full px-3 py-1.5 text-left text-sm hover:bg-surface disabled:opacity-50', it.danger && 'text-critical')}>
                {it.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: Array<{ id: T; label: ReactNode }>; value: T; onChange: (v: T) => void }) {
  return (
    <div role="tablist" className="flex gap-1 border-b border-line">
      {tabs.map((t) => (
        <button key={t.id} role="tab" type="button" aria-selected={value === t.id} onClick={() => onChange(t.id)}
          className={cx('-mb-px border-b-2 px-3 py-2 text-sm font-medium', value === t.id ? 'border-primary text-primary' : 'border-transparent text-muted hover:text-fg')}>
          {t.label}
        </button>
      ))}
    </div>
  );
}

type ToastTone = 'success' | 'critical' | 'info';
interface ToastItem { id: number; message: string; tone: ToastTone }
const ToastCtx = createContext<(message: string, tone?: ToastTone) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const push = useCallback((message: string, tone: ToastTone = 'success') => {
    const id = Date.now() + Math.random();
    setItems((s) => [...s, { id, message, tone }]);
    setTimeout(() => setItems((s) => s.filter((i) => i.id !== id)), 4000);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 flex-col gap-2" aria-live="polite">
        {items.map((i) => <Banner key={i.id} tone={i.tone} className="shadow-lg">{i.message}</Banner>)}
      </div>
    </ToastCtx.Provider>
  );
}
