import { cx } from '@shopme/ui';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';

export interface EditorMenuItem { key: string; label: string; icon?: ReactNode; shortcut?: string; danger?: boolean; disabled?: boolean; /** A divider is drawn above this item. */ separator?: boolean; onSelect: () => void }

/** Popup menu of the theme editor: icon, label and shortcut per row, dividers between groups, optional header and footer blocks. Positioned at a point (context menu) or under a trigger. */
export function EditorMenu({ items, at, onClose, footer, align = 'left', label }: {
  items: EditorMenuItem[]; at: { x: number; y: number }; onClose: () => void; footer?: ReactNode; align?: 'left' | 'right'; label?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number }>({ left: at.x, top: at.y });
  useLayoutEffect(() => {
    const place = () => {
      const r = ref.current?.getBoundingClientRect();
      if (!r) return;
      const left = align === 'right' ? at.x - r.width : at.x;
      setPos({ left: Math.max(4, Math.min(left, window.innerWidth - r.width - 4)), top: Math.max(4, Math.min(at.y, window.innerHeight - r.height - 4)) });
    };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [at.x, at.y, align]);
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('[role=menuitem]:not(:disabled)')?.focus({ preventScroll: true });
    const down = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) onClose(); };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onClose(); return; }
      const els = [...(ref.current?.querySelectorAll<HTMLElement>('[role=menuitem]:not(:disabled)') ?? [])];
      const i = els.indexOf(document.activeElement as HTMLElement);
      if (e.key === 'ArrowDown') { e.preventDefault(); els[(i + 1) % els.length]?.focus(); }
      if (e.key === 'ArrowUp') { e.preventDefault(); els[(i - 1 + els.length) % els.length]?.focus(); }
    };
    document.addEventListener('mousedown', down, true);
    document.addEventListener('keydown', key);
    window.addEventListener('blur', onClose);
    return () => { document.removeEventListener('mousedown', down, true); document.removeEventListener('keydown', key); window.removeEventListener('blur', onClose); };
  }, [onClose]);
  return (
    <div ref={ref} role="menu" aria-label={label} className="fixed z-[80] max-h-[calc(100dvh-0.5rem)] min-w-56 max-w-[calc(100vw-0.5rem)] overflow-auto rounded-xl border border-line bg-canvas py-1.5 text-[13px] shadow-pop" style={pos}>
      {items.map((i) => (
        <div key={i.key}>
          {i.separator && <div role="separator" className="mx-0 my-1.5 border-t border-line" />}
          <button type="button" role="menuitem" disabled={i.disabled} onClick={() => { onClose(); i.onSelect(); }}
            className={cx('mx-1.5 flex w-[calc(100%-0.75rem)] items-center gap-2.5 rounded-md px-2 py-1.5 text-left hover:bg-hover focus-visible:bg-hover focus-visible:outline-none disabled:text-muted disabled:opacity-60', i.danger && 'text-critical')}>
            <span className="grid size-4 shrink-0 place-items-center [&>svg]:size-4">{i.icon}</span>
            <span className="min-w-0 flex-1 truncate">{i.label}</span>
            {i.shortcut && <span className="shrink-0 pl-4 text-xs text-muted">{i.shortcut}</span>}
          </button>
        </div>
      ))}
      {footer && <div className="mt-1.5 border-t border-line px-3.5 pb-1.5 pt-3">{footer}</div>}
    </div>
  );
}
