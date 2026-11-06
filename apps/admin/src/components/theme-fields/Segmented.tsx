import { cx } from '@shopme/ui';
import { useId } from 'react';

/** A row of mutually exclusive options drawn as one segmented control. */
export function Segmented({ label, help, value, options, onChange }: { label: string; help?: string; value: string; options: Array<{ value: string; label: string }>; onChange: (v: string) => void }) {
  const id = useId();
  const selectedIndex = Math.max(0, options.findIndex((o) => o.value === value));
  return (
    <div className="flex flex-col gap-1">
      <span id={id} className="text-[13px] font-medium">{label}</span>
      <div role="radiogroup" aria-labelledby={id} className="flex rounded-lg border border-line bg-surface p-0.5">
        {options.map((o, index) => (
          <button key={o.value} type="button" role="radio" aria-checked={value === o.value} tabIndex={index === selectedIndex ? 0 : -1} onClick={() => onChange(o.value)}
            onKeyDown={(e) => {
              if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
              let next: number;
              if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (index + 1) % options.length;
              else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = (index - 1 + options.length) % options.length;
              else if (e.key === 'Home') next = 0;
              else if (e.key === 'End') next = options.length - 1;
              else return;
              e.preventDefault();
              onChange(options[next]!.value);
              e.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="radio"]')[next]?.focus();
            }}
            className={cx('min-w-0 flex-1 truncate rounded-md px-2 py-1 text-[12px]', value === o.value ? 'bg-canvas font-medium text-fg shadow-sm' : 'text-muted hover:text-fg')}>{o.label}</button>
        ))}
      </div>
      {help && <p className="text-xs text-muted">{help}</p>}
    </div>
  );
}
