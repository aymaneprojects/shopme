import { cx } from '@shopme/ui';
import { Check } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useT } from '../i18n';

/**
 * Text field with a list of existing values below it (product type, vendor). Typing filters the list, a value that does not exist yet
 * is offered as "Use ...", so new values can still be created. Arrow keys move, Enter picks, Escape closes.
 */
export function Combobox({ id, className, value, onChange, options, placeholder }: { id?: string; className?: string; value: string; onChange: (v: string) => void; options: string[]; placeholder?: string }) {
  const t = useT();
  const auto = useId();
  const listId = `${auto}-list`;
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const box = useRef<HTMLDivElement>(null);
  const needle = value.trim().toLowerCase();
  const shown = useMemo(() => options.filter((o) => !needle || o.toLowerCase().includes(needle)).slice(0, 50), [options, needle]);
  const exact = options.some((o) => o.toLowerCase() === needle);
  const items = [...shown.map((v) => ({ v, create: false })), ...(needle && !exact ? [{ v: value.trim(), create: true }] : [])];
  const activeId = open && active >= 0 && items[active] ? `${listId}-${active}` : undefined;
  useEffect(() => {
    if (activeId) document.getElementById(activeId)?.scrollIntoView?.({ block: 'nearest' });
  }, [activeId]);
  const pick = (v: string) => { onChange(v); setOpen(false); setActive(-1); };
  return (
    <div ref={box} className="relative" onBlur={(e) => { if (!box.current?.contains(e.relatedTarget as Node)) setOpen(false); }}>
      <input
        id={id} className={className} role="combobox" aria-expanded={open} aria-controls={listId} aria-activedescendant={activeId} aria-autocomplete="list" autoComplete="off"
        placeholder={placeholder} value={value}
        onFocus={() => setOpen(true)} onChange={(e) => { onChange(e.target.value); setOpen(true); setActive(-1); }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setActive((a) => Math.min(items.length - 1, a + 1)); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
          else if (e.key === 'Enter' && open && active >= 0 && items[active]) { e.preventDefault(); pick(items[active]!.v); }
          else if (e.key === 'Escape' && open) { e.stopPropagation(); setOpen(false); }
        }}
      />
      {open && items.length > 0 && (
        <ul id={listId} role="listbox" className="absolute right-0 z-30 mt-1 max-h-56 w-60 overflow-y-auto rounded-lg border border-line bg-canvas p-1 shadow-card">
          {items.map((it, i) => (
            <li key={`${it.create}-${it.v}`} id={`${listId}-${i}`} role="option" aria-selected={it.v === value}>
              <button type="button" tabIndex={-1} onMouseDown={(e) => e.preventDefault()} onClick={() => pick(it.v)} className={cx('flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-[13px] hover:bg-hover', i === active && 'bg-hover')}>
                <span className="min-w-0 truncate">{it.create ? t('bp.combo.use', { value: it.v }) : it.v}</span>
                {it.v === value && !it.create && <Check className="size-4 shrink-0 text-muted" />}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
