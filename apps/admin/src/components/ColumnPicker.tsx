import { Checkbox, Popover } from '@shopme/ui';
import type { Column } from '@shopme/ui';
import { Columns3 } from 'lucide-react';
import { useState } from 'react';
import { useT } from '../i18n';

const read = (key: string, fallback: string[]): string[] => {
  try {
    const raw = localStorage.getItem(`shopme.columns.${key}`);
    if (raw == null) return fallback;
    const v = JSON.parse(raw) as unknown;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : fallback;
  } catch { return fallback; }
};

/** Which table columns are hidden; remembered per table in this browser. */
/** `defaultHidden`: columns hidden until the user chooses to show them. */
export function useColumnVisibility(storageKey: string, defaultHidden: string[] = []) {
  const [hidden, setHidden] = useState<string[]>(() => read(storageKey, defaultHidden));
  const toggle = (key: string) => setHidden((h) => {
    const next = h.includes(key) ? h.filter((k) => k !== key) : [...h, key];
    try { localStorage.setItem(`shopme.columns.${storageKey}`, JSON.stringify(next)); } catch { /* storage unavailable */ }
    return next;
  });
  return { hidden, toggle, filter: <T,>(cols: Array<Column<T>>) => cols.filter((c) => !hidden.includes(c.key)) };
}

/** "Edit columns" button at the end of a list toolbar. Columns without a text header (thumbnails) are always shown. */
export function ColumnPicker<T>({ columns, hidden, onToggle, locked = [] }: { columns: Array<Column<T>>; hidden: string[]; onToggle: (key: string) => void; locked?: string[] }) {
  const t = useT();
  const choices = columns.filter((c) => typeof c.header === 'string' && c.header && !locked.includes(c.key));
  return (
    <Popover label={t('columns.edit')} align="right" className="w-56" trigger={<Columns3 className="size-4" />}>
      <p className="mb-2 text-[13px] font-semibold">{t('columns.title')}</p>
      <ul className="flex flex-col gap-1.5">
        {choices.map((c) => <li key={c.key}><Checkbox label={c.header} checked={!hidden.includes(c.key)} onChange={() => onToggle(c.key)} /></li>)}
      </ul>
    </Popover>
  );
}
