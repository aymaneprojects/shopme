import { Button, Input, cx } from '@shopme/ui';
import { Copy, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useI18n } from '../../i18n';
import { addScheme, schemeOptions } from '../../lib/settings-schema';
import type { SchemeSet, SettingDef } from '../../lib/settings-schema';

/** The theme's named color schemes: a row of swatches (the selected one is edited below), with add, duplicate and delete. */
export function ColorSchemesField({ def, value, label, optionLabel, onChange }: { def: SettingDef & { id: string }; value: SchemeSet; label: string; optionLabel: (l?: string) => string; onChange: (v: SchemeSet) => void }) {
  const { t } = useI18n();
  const options = schemeOptions(value);
  const [picked, setPicked] = useState<string | null>(null);
  const current = picked && value[picked] ? picked : options[0]?.id;
  const fields = def.definition ?? [];
  const defaults = Object.fromEntries(fields.filter((f) => f.id).map((f) => [f.id!, String(f.default ?? '')]));
  const set = (key: string, v: string) => current && onChange({ ...value, [current]: { settings: { ...value[current]!.settings, [key]: v } } });
  const add = (from?: string) => { const r = addScheme(value, defaults, from); onChange(r.schemes); setPicked(r.id); };
  const remove = () => {
    if (!current || options.length < 2) return;
    const { [current]: _gone, ...rest } = value;
    onChange(rest); setPicked(null);
  };
  const s = current ? value[current]!.settings : undefined;
  return (
    <div className="flex flex-col gap-2">
      <span className="text-[13px] font-medium">{label}</span>
      <ul className="flex flex-wrap gap-2" role="listbox" aria-label={label}>
        {options.map((o, index) => {
          const sv = value[o.id]!.settings;
          return (
            <li key={o.id}>
              <button type="button" role="option" aria-selected={o.id === current} tabIndex={o.id === current ? 0 : -1} aria-label={o.name} title={o.name} onClick={() => setPicked(o.id)}
                onKeyDown={(e) => {
                  if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
                  let next: number;
                  if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (index + 1) % options.length;
                  else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = (index - 1 + options.length) % options.length;
                  else if (e.key === 'Home') next = 0;
                  else if (e.key === 'End') next = options.length - 1;
                  else return;
                  e.preventDefault();
                  setPicked(options[next]!.id);
                  e.currentTarget.closest('ul')?.querySelectorAll<HTMLButtonElement>('[role="option"]')[next]?.focus();
                }}
                className={cx('grid h-12 w-16 place-items-center rounded-lg border text-[13px] font-semibold', o.id === current ? 'border-primary ring-2 ring-primary' : 'border-line hover:border-fg')}
                style={{ background: sv.background, color: sv.text }}>
                <span className="flex items-center gap-1">Aa<span className="size-2.5 rounded-full" style={{ background: sv.button }} aria-hidden /></span>
              </button>
            </li>
          );
        })}
        <li><button type="button" aria-label={t('bs.schemes.add')} title={t('bs.schemes.add')} onClick={() => add()} className="grid h-12 w-12 place-items-center rounded-lg border border-dashed border-line text-muted hover:border-fg hover:text-fg"><Plus className="size-4" /></button></li>
      </ul>
      {s && current && (
        <div className="flex flex-col gap-2 rounded-lg border border-line bg-surface p-2">
          <div className="flex items-center justify-between gap-2">
            <span className="min-w-0 truncate text-[12px] font-semibold">{s.name || current}</span>
            <span className="flex shrink-0 gap-1">
              <Button size="sm" variant="plain" aria-label={t('bs.schemes.duplicate')} title={t('bs.schemes.duplicate')} onClick={() => add(current)}><Copy className="size-3.5" /></Button>
              <Button size="sm" variant="plain" aria-label={t('bs.schemes.delete')} title={options.length < 2 ? t('bs.schemes.lastOne') : t('bs.schemes.delete')} disabled={options.length < 2} onClick={remove}><Trash2 className="size-3.5" /></Button>
            </span>
          </div>
          {fields.filter((f): f is SettingDef & { id: string } => !!f.id).map((f) => f.type === 'color' ? (
            <div key={f.id} className="flex items-center justify-between gap-2">
              <span className="text-[12px]">{optionLabel(f.label)}</span>
              <span className="flex items-center gap-1.5">
                <input type="color" aria-label={optionLabel(f.label)} value={/^#[0-9a-f]{6}$/i.test(s[f.id] ?? '') ? s[f.id] : '#000000'} onChange={(e) => set(f.id, e.target.value)} className="size-7 rounded border border-line" />
                <input aria-label={`${optionLabel(f.label)} (hex)`} value={s[f.id] ?? ''} onChange={(e) => set(f.id, e.target.value)} className="field-control w-24 !py-1 text-[12px]" />
              </span>
            </div>
          ) : <Input key={f.id} label={optionLabel(f.label)} value={s[f.id] ?? ''} onChange={(e) => set(f.id, e.target.value)} />)}
        </div>
      )}
    </div>
  );
}
