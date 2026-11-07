import { X } from 'lucide-react';
import { useId, useState } from 'react';
import type { InputHTMLAttributes, ReactNode, Ref, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';
import { cx } from './basics';

const control = 'field-control w-full';

interface FieldProps { label?: ReactNode; help?: ReactNode; error?: string | null; className?: string }

/** Wraps a control with a label, help text and error. Pass `id` to the control from the render prop. */
export function Field({ label, help, error, className, children }: FieldProps & { children: (p: { id: string; 'aria-invalid': boolean; 'aria-describedby'?: string }) => ReactNode }) {
  const id = useId();
  const note = error || help ? `${id}-note` : undefined;
  return (
    <div className={cx('flex flex-col gap-1.5', className)}>
      {label && <label htmlFor={id} className="text-[13px] font-medium">{label}</label>}
      {children({ id, 'aria-invalid': !!error, 'aria-describedby': note })}
      {(error || help) && <p id={note} className={cx('text-xs', error ? 'text-critical' : 'text-muted')}>{error || help}</p>}
    </div>
  );
}

export function Input({ label, help, error, className, suffix, ...rest }: FieldProps & InputHTMLAttributes<HTMLInputElement> & { /** Text shown at the right end inside the field (a currency, a unit, a character count). */ suffix?: ReactNode }) {
  return <Field label={label} help={help} error={error} className={className}>{(p) => (suffix == null ? <input className={control} {...p} {...rest} /> : (
    <div className="relative">
      <input className={cx(control, 'pr-14')} {...p} {...rest} />
      <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-[13px] text-muted">{suffix}</span>
    </div>
  ))}</Field>;
}

export function Textarea({ label, help, error, className, ...rest }: FieldProps & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <Field label={label} help={help} error={error} className={className}>{(p) => <textarea rows={3} className={control} {...p} {...rest} />}</Field>;
}

export function Select({ label, help, error, className, children, ...rest }: FieldProps & SelectHTMLAttributes<HTMLSelectElement>) {
  return <Field label={label} help={help} error={error} className={className}>{(p) => <select className={cx(control, 'pr-7')} {...p} {...rest}>{children}</select>}</Field>;
}

export function Checkbox({ label, className, ...rest }: { label?: ReactNode; ref?: Ref<HTMLInputElement> } & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className={cx('inline-flex items-center gap-2 text-[13px]', className)}>
      <input type="checkbox" className="size-4 rounded accent-(--color-primary) transition-shadow" {...rest} />
      {label}
    </label>
  );
}

export function Switch({ checked, onChange, label, description, placement = 'start' }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; /** Secondary line under the label. */ description?: ReactNode; /** `end` puts the toggle on the right of the label (settings rows). */ placement?: 'start' | 'end' }) {
  const toggle = (
    <button
      type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)}
      className={cx('relative h-5 w-9 shrink-0 rounded-full shadow-[inset_0_1px_2px_rgb(0_0_0/0.25)] transition-colors', checked ? 'bg-primary' : 'bg-[color-mix(in_srgb,var(--color-text-muted)_55%,var(--color-bg))]')}
    >
      <span className={cx('absolute top-0.5 size-4 rounded-full bg-white shadow transition-all duration-150', checked ? 'left-4.5' : 'left-0.5')} />
    </button>
  );
  if (placement === 'end' || description) {
    return (
      <label className={cx('flex cursor-pointer items-start gap-3 text-[13px]', placement === 'end' && 'w-full justify-between')}>
        {placement === 'start' && toggle}
        <span className="min-w-0 flex-1"><span className="block font-medium">{label}</span>{description && <span className="block text-xs text-muted">{description}</span>}</span>
        {placement === 'end' && toggle}
      </label>
    );
  }
  return (
    <label className="inline-flex cursor-pointer items-center gap-2 text-[13px]">
      {toggle}
      {label}
    </label>
  );
}

/** Tag/chip input: Enter or comma adds, Backspace on empty removes the last. */
export function TagInput({ value, onChange, placeholder, label, suggestions = [], removeLabel = 'Remove', 'aria-label': inputLabel }: { value: string[]; onChange: (v: string[]) => void; placeholder?: string; removeLabel?: string; label?: ReactNode; suggestions?: string[]; 'aria-label'?: string }) {
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
            {...p} aria-label={inputLabel} className={control} value={draft} placeholder={placeholder} list={listId}
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
