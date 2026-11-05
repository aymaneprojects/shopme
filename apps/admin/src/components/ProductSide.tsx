import { cx } from '@shopme/ui';
import { Plus, X } from 'lucide-react';
import type { ReactNode } from 'react';
import { useId, useState } from 'react';

const FIELD = 'min-w-0 rounded-md bg-transparent px-2 py-1 text-right text-[13px] outline-none transition-colors hover:bg-hover focus-visible:bg-field focus-visible:outline-2 focus-visible:-outline-offset-1 focus-visible:outline-accent placeholder:text-muted';

/** One "label … value" row of the product sidebar; the value is an unframed control that shows its frame on hover and focus. */
export function InlineRow({ label, hint, children }: { label: string; hint?: string; children: (p: { id: string; className: string }) => ReactNode }) {
  const id = useId();
  return (
    <div className="flex items-center justify-between gap-3 text-[13px]" title={hint}>
      <label htmlFor={id} className="shrink-0">{label}</label>
      {children({ id, className: cx(FIELD, 'w-44') })}
    </div>
  );
}
export const INLINE_SELECT = '[text-align-last:right]';

/** Sidebar block title with a round "+" button on the right. */
export function SideHead({ title, action }: { title: string; action?: { label: string; onClick: () => void } }) {
  return (
    <div className="flex min-h-6 items-center justify-between">
      <h3 className="text-[13px] font-medium">{title}</h3>
      {action && <button type="button" aria-label={action.label} title={action.label} onClick={action.onClick} className="grid size-6 place-items-center rounded-full text-muted hover:bg-hover hover:text-fg"><Plus className="size-4" /></button>}
    </div>
  );
}

/** Grey rectangular chip with an optional remove button (collections, tags). */
export function Chip({ children, onRemove, removeLabel }: { children: ReactNode; onRemove?: () => void; removeLabel?: string }) {
  return (
    <li className="inline-flex items-center gap-1 rounded-md bg-surface px-2 py-0.5 text-xs font-medium">
      {children}
      {onRemove && <button type="button" aria-label={removeLabel} onClick={onRemove} className="text-muted hover:text-fg"><X className="size-3" /></button>}
    </li>
  );
}

/** Tags as chips plus a "+ Add tags" input (Enter or comma adds, Backspace on empty removes the last). */
export function InlineTags({ label, placeholder, value, onChange, suggestions, removeLabel }: { label: string; placeholder: string; value: string[]; onChange: (v: string[]) => void; suggestions: string[]; removeLabel: string }) {
  const [draft, setDraft] = useState('');
  const listId = useId();
  const add = (raw: string) => {
    const t = raw.trim();
    if (t && !value.some((v) => v.toLowerCase() === t.toLowerCase())) onChange([...value, t]);
    setDraft('');
  };
  return (
    <div className="flex flex-col gap-2">
      <SideHead title={label} />
      {value.length > 0 && <ul className="flex flex-wrap gap-1.5">{value.map((tag) => <Chip key={tag} removeLabel={`${removeLabel} ${tag}`} onRemove={() => onChange(value.filter((x) => x !== tag))}>{tag}</Chip>)}</ul>}
      <div className="relative">
        <Plus className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted" />
        <input
          aria-label={label} list={listId} value={draft} placeholder={placeholder} className="h-7 w-full rounded-md bg-surface pl-7 pr-2 text-[13px] outline-none placeholder:text-muted focus-visible:outline-2 focus-visible:-outline-offset-1 focus-visible:outline-accent"
          onChange={(e) => (e.target.value.endsWith(',') ? add(e.target.value.slice(0, -1)) : setDraft(e.target.value))}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(draft); } else if (e.key === 'Backspace' && !draft && value.length) onChange(value.slice(0, -1)); }}
          onBlur={() => draft && add(draft)}
        />
        <datalist id={listId}>{suggestions.filter((s) => !value.includes(s)).map((s) => <option key={s} value={s} />)}</datalist>
      </div>
    </div>
  );
}
