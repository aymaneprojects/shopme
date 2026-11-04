import { X } from 'lucide-react';
import { useId, useState } from 'react';
import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';
import { cx } from './basics';

const control =
  'w-full rounded-md border border-line bg-canvas px-3 py-2 text-sm text-fg placeholder:text-muted disabled:opacity-60 aria-[invalid=true]:border-critical';

interface FieldProps { label?: ReactNode; help?: ReactNode; error?: string | null; className?: string }

/** Wraps a control with a label, help text and error. Pass `id` to the control from the render prop. */
export function Field({ label, help, error, className, children }: FieldProps & { children: (p: { id: string; 'aria-invalid': boolean; 'aria-describedby'?: string }) => ReactNode }) {
  const id = useId();
  const note = error || help ? `${id}-note` : undefined;
  return (
    <div className={cx('flex flex-col gap-1', className)}>
      {label && <label htmlFor={id} className="text-sm font-medium">{label}</label>}
      {children({ id, 'aria-invalid': !!error, 'aria-describedby': note })}
      {(error || help) && <p id={note} className={cx('text-xs', error ? 'text-critical' : 'text-muted')}>{error || help}</p>}
    </div>
  );
}

export function Input({ label, help, error, className, ...rest }: FieldProps & InputHTMLAttributes<HTMLInputElement>) {
  return <Field label={label} help={help} error={error} className={className}>{(p) => <input className={control} {...p} {...rest} />}</Field>;
}

export function Textarea({ label, help, error, className, ...rest }: FieldProps & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <Field label={label} help={help} error={error} className={className}>{(p) => <textarea rows={3} className={control} {...p} {...rest} />}</Field>;
}

export function Select({ label, help, error, className, children, ...rest }: FieldProps & SelectHTMLAttributes<HTMLSelectElement>) {
  return <Field label={label} help={help} error={error} className={className}>{(p) => <select className={control} {...p} {...rest}>{children}</select>}</Field>;
}

export function Checkbox({ label, className, ...rest }: { label?: ReactNode } & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className={cx('inline-flex items-center gap-2 text-sm', className)}>
      <input type="checkbox" className="size-4 accent-(--color-primary)" {...rest} />
      {label}
    </label>
  );
}

export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode }) {
  return (
    <label className="inline-flex cursor-pointer items-center gap-2 text-sm">
      <button
        type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)}
        className={cx('relative h-5 w-9 rounded-full transition-colors', checked ? 'bg-primary' : 'bg-line')}
      >
        <span className={cx('absolute top-0.5 size-4 rounded-full bg-canvas transition-all', checked ? 'left-4.5' : 'left-0.5')} />
      </button>
      {label}
    </label>
  );
}

/** Tag/chip input: Enter or comma adds, Backspace on empty removes the last. */
export function TagInput({ value, onChange, placeholder, label, suggestions = [], removeLabel = 'Remove' }: { value: string[]; onChange: (v: string[]) => void; placeholder?: string; removeLabel?: string; label?: ReactNode; suggestions?: string[] }) {
  const [draft, setDraft] = useState('');
  const listId = useId();
  const add = (raw: string) => {
    const t = raw.trim();
    if (t && !value.some((v) => v.toLowerCase() === t.toLowerCase())) onChange([...value, t]);
    setDraft('');
  };
  return (
    <Field label={label}>
      {(p) => (
        <div className="flex flex-col gap-2">
          <input
            {...p} className={control} value={draft} placeholder={placeholder} list={listId}
            onChange={(e) => (e.target.value.endsWith(',') ? add(e.target.value.slice(0, -1)) : setDraft(e.target.value))}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); add(draft); }
              else if (e.key === 'Backspace' && !draft && value.length) onChange(value.slice(0, -1));
            }}
            onBlur={() => draft && add(draft)}
          />
          <datalist id={listId}>{suggestions.filter((s) => !value.includes(s)).map((s) => <option key={s} value={s} />)}</datalist>
          {value.length > 0 && (
            <ul className="flex flex-wrap gap-1.5">
              {value.map((t) => (
                <li key={t} className="inline-flex items-center gap-1 rounded-full bg-surface border border-line px-2 py-0.5 text-xs">
                  {t}
                  <button type="button" aria-label={`${removeLabel} ${t}`} onClick={() => onChange(value.filter((v) => v !== t))}><X className="size-3" /></button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Field>
  );
}
