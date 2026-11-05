import { Check, ChevronLeft, ChevronsUpDown, Download, Search, Upload, X } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Button, cx } from './basics';
import { Dropdown, Modal, Popover } from './overlay';

export interface ToolbarFilter { key: string; label: string; options: Array<{ value: string; label: string }>; /** Free-text filter: the menu shows an input instead of options. */ text?: boolean }

export interface ListToolbarProps {
  /** Saved views / built-in tabs, shown as a selector at the start of the bar. */
  views?: Array<{ id: string; label: ReactNode }>;
  view?: string;
  onView?: (id: string) => void;
  viewsLabel?: string;
  /** Custom content at the start of the bar (replaces the built-in view selector). */
  leading?: ReactNode;
  query: string;
  onQuery: (q: string) => void;
  placeholder: string;
  /** When given, focusing the empty search field opens the "Add filter" menu listing these. */
  filters?: ToolbarFilter[];
  values?: Record<string, string>;
  onFilter?: (key: string, value: string) => void;
  removeFilterLabel?: string;
  /** Content at the end of the bar (column picker, sort). */
  trailing?: ReactNode;
  className?: string;
}

/**
 * The bar above a list: view selector, a search field that doubles as the "Add filter" menu (pick a filter, then a
 * value), the active filters as removable chips and a slot for column / sort controls.
 */
export function ListToolbar({ views, view, onView, viewsLabel = 'View', leading, query, onQuery, placeholder, filters = [], values = {}, onFilter, removeFilterLabel = 'Remove filter', trailing, className }: ListToolbarProps) {
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const listId = useId();
  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => { if (!root.current?.contains(e.target as Node)) { setOpen(false); setPicked(null); } };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOpen(false); setPicked(null); } };
    document.addEventListener('mousedown', down);
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('mousedown', down); document.removeEventListener('keydown', key); };
  }, [open]);
  const active = filters.filter((f) => values[f.key]);
  const free = filters.filter((f) => !values[f.key]);
  const current = filters.find((f) => f.key === picked);
  const showMenu = open && filters.length > 0 && !query && (current || free.length > 0);
  const activeView = views?.find((v) => v.id === view);
  return (
    <div ref={root} className={cx('relative rounded-lg bg-canvas shadow-card', className)}>
      <div className="flex min-h-10 items-center gap-1 px-1.5">
        {leading}
        {!leading && views && views.length > 0 && (
          <Dropdown variant="plain" size="sm" className="btn-neutral !font-semibold" label={viewsLabel} trigger={<>{activeView?.label ?? views[0]!.label}<ChevronsUpDown className="size-3.5 text-muted" /></>}
            items={views.map((v) => ({ key: v.id, label: v.label, icon: v.id === view ? <Check className="size-4" /> : undefined, onSelect: () => onView?.(v.id) }))} />
        )}
        <label className="relative flex min-w-0 flex-1 items-center gap-2 px-1.5">
          <Search className="size-4 shrink-0 text-muted" aria-hidden />
          <input
            type="search" role={filters.length ? 'combobox' : undefined} aria-expanded={filters.length ? !!showMenu : undefined} aria-controls={showMenu ? listId : undefined}
            value={query} placeholder={placeholder} aria-label={placeholder}
            onFocus={() => setOpen(true)} onChange={(e) => onQuery(e.target.value)}
            className="h-9 min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-muted [&::-webkit-search-cancel-button]:hidden"
          />
        </label>
        {trailing}
      </div>
      {active.length > 0 && (
        <ul className="flex flex-wrap gap-1.5 border-t border-line px-3 py-2">
          {active.map((f) => (
            <li key={f.key} className="inline-flex items-center gap-1 rounded-full border border-line bg-surface py-0.5 pl-2.5 pr-1 text-xs">
              {f.label}: {f.options.find((o) => o.value === values[f.key])?.label ?? values[f.key]}
              <button type="button" aria-label={`${removeFilterLabel} ${f.label}`} className="grid size-5 place-items-center rounded-full hover:bg-hover" onClick={() => onFilter?.(f.key, '')}><X className="size-3" /></button>
            </li>
          ))}
        </ul>
      )}
      {showMenu && (
        <ul id={listId} role="listbox" className="anim-menu absolute left-10 top-full z-30 mt-1 max-h-72 w-64 overflow-y-auto rounded-lg bg-canvas p-1 shadow-pop">
          {current ? (
            <>
              <li role="presentation"><button type="button" className="flex w-full items-center gap-1 rounded-md px-2 py-1.5 text-left text-[13px] font-semibold hover:bg-hover" onClick={() => setPicked(null)}><ChevronLeft className="size-4" />{current.label}</button></li>
              {current.text && (
                <li role="presentation" className="p-1.5"><input autoFocus aria-label={current.label} placeholder={current.label} className="field-control w-full" onKeyDown={(e) => { if (e.key === 'Enter' && e.currentTarget.value.trim()) { onFilter?.(current.key, e.currentTarget.value.trim()); setPicked(null); setOpen(false); } }} /></li>
              )}
              {current.options.map((o) => (
                <li key={o.value} role="option" aria-selected={false}><button type="button" className="w-full rounded-md px-2.5 py-1.5 text-left text-[13px] hover:bg-hover" onClick={() => { onFilter?.(current.key, o.value); setPicked(null); setOpen(false); }}>{o.label}</button></li>
              ))}
              {current.options.length === 0 && !current.text && <li className="px-2.5 py-1.5 text-[13px] text-muted">—</li>}
            </>
          ) : free.map((f) => (
            <li key={f.key} role="option" aria-selected={false}><button type="button" className="w-full rounded-md px-2.5 py-1.5 text-left text-[13px] hover:bg-hover" onClick={() => setPicked(f.key)}>{f.label}</button></li>
          ))}
        </ul>
      )}
    </div>
  );
}

export interface ExportDialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: ReactNode;
  scopeTitle: string;
  scopes: Array<{ key: string; label: string; disabled?: boolean }>;
  defaultScope?: string;
  formatTitle?: string;
  formats?: Array<{ key: string; label: string }>;
  confirmLabel: string;
  cancelLabel: string;
  closeLabel?: string;
  footnote?: ReactNode;
  onExport: (scope: string, format: string) => void;
}

/** Export dialog: description, "what to export" radios, "format" radios, Cancel and the primary export button. */
export function ExportDialog({ open, onClose, title, description, scopeTitle, scopes, defaultScope, formatTitle, formats = [], confirmLabel, cancelLabel, closeLabel, footnote, onExport }: ExportDialogProps) {
  const [scope, setScope] = useState(defaultScope ?? scopes[0]?.key ?? '');
  const [format, setFormat] = useState(formats[0]?.key ?? '');
  const name = useId();
  const group = (heading: string, id: string, items: Array<{ key: string; label: string; disabled?: boolean }>, value: string, set: (v: string) => void) => (
    <fieldset className="mt-4">
      <legend className="mb-1.5 text-[13px] font-semibold">{heading}</legend>
      <div className="flex flex-col gap-1.5">
        {items.map((it) => (
          <label key={it.key} className={cx('inline-flex items-center gap-2 text-[13px]', it.disabled && 'text-muted opacity-60')}>
            <input type="radio" name={`${name}-${id}`} className="size-4 accent-(--color-primary)" checked={value === it.key} disabled={it.disabled} onChange={() => set(it.key)} />
            {it.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
  return (
    <Modal open={open} onClose={onClose} title={title} closeLabel={closeLabel} plain medium
      footer={<><Button onClick={onClose}>{cancelLabel}</Button><Button variant="primary" onClick={() => { onExport(scope, format); onClose(); }}><Upload className="size-4" />{confirmLabel}</Button></>}>
      {description && <p className="text-[13px] leading-5">{description}</p>}
      {group(scopeTitle, 'scope', scopes, scope, setScope)}
      {formats.length > 0 && group(formatTitle ?? '', 'format', formats, format, setFormat)}
      {footnote && <p className="mt-4 text-[13px]">{footnote}</p>}
    </Modal>
  );
}

/** Small popover to adjust a quantity in place: pick "Set to" or "Add", type the number, apply. */
export function QuantityPopover({ value, onApply, trigger, labels, disabled }: {
  value: number;
  onApply: (next: number, mode: 'set' | 'add') => void;
  trigger?: ReactNode;
  disabled?: boolean;
  labels: { adjust: string; set: string; add: string; apply: string };
}) {
  const [mode, setMode] = useState<'set' | 'add'>('set');
  const [n, setN] = useState(String(value));
  return (
    <Popover label={labels.adjust} className="w-72" triggerVariant="plain" triggerClassName="btn-neutral !h-7 !px-1.5" trigger={trigger ?? value}>
      {(close) => (
        <form className="flex items-center gap-2" onSubmit={(e) => { e.preventDefault(); const v = Number(n); if (Number.isFinite(v)) { onApply(mode === 'set' ? v : value + v, mode); close(); } }}>
          <select aria-label={labels.adjust} value={mode} disabled={disabled} onChange={(e) => { const m = e.target.value as 'set' | 'add'; setMode(m); setN(m === 'set' ? String(value) : '0'); }} className="field-control w-24">
            <option value="set">{labels.set}</option>
            <option value="add">{labels.add}</option>
          </select>
          <input type="number" autoFocus aria-label={labels.adjust} value={n} onFocus={(e) => e.target.select()} onChange={(e) => setN(e.target.value)} className="field-control min-w-0 flex-1" />
          <Button type="submit" variant="primary" icon aria-label={labels.apply}><Check className="size-4" /></Button>
        </form>
      )}
    </Popover>
  );
}

export interface ViewerImage { key: string; url: string; name: string; alt: string; details?: string; usedIn?: string }

/** Full-screen media viewer: image on the left, an information panel (name, alt text, details) on the right. */
export function MediaViewer({ items, index, onIndexChange, onClose, onSave, labels, downloadHref }: {
  items: ViewerImage[];
  index: number | null;
  onIndexChange: (i: number) => void;
  onClose: () => void;
  onSave?: (item: ViewerImage, change: { name: string; alt: string }) => void;
  downloadHref?: (item: ViewerImage) => string;
  labels: { close: string; info: string; name: string; alt: string; details: string; usedIn: string; save: string; counter: (i: number, n: number) => string; previous: string; next: string; download: string };
}) {
  const item = index === null ? null : items[index];
  const [name, setName] = useState('');
  const [alt, setAlt] = useState('');
  useEffect(() => { if (item) { setName(item.name); setAlt(item.alt); } }, [item?.key]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (index === null) return;
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowRight' && index < items.length - 1) onIndexChange(index + 1);
      else if (e.key === 'ArrowLeft' && index > 0) onIndexChange(index - 1);
    };
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, [index, items.length, onClose, onIndexChange]);
  if (!item || index === null) return null;
  return (
    <div role="dialog" aria-modal="true" aria-label={item.name} className="fixed inset-0 z-[70] flex flex-col bg-[#0b0b0d] text-white">
      <header className="flex h-12 items-center gap-3 border-b border-white/10 bg-[#161618] px-3">
        <button type="button" aria-label={labels.close} onClick={onClose} className="grid size-8 place-items-center rounded-md hover:bg-white/10"><X className="size-4" /></button>
        <div className="min-w-0 leading-tight">
          <div className="truncate text-[13px] font-semibold">{item.name}</div>
          <div className="text-xs text-white/60">{labels.counter(index + 1, items.length)}</div>
        </div>
        <div className="ml-auto flex items-center gap-1">
          {items.length > 1 && <>
            <button type="button" aria-label={labels.previous} disabled={index === 0} onClick={() => onIndexChange(index - 1)} className="grid size-8 place-items-center rounded-md hover:bg-white/10 disabled:opacity-40"><ChevronLeft className="size-4" /></button>
            <button type="button" aria-label={labels.next} disabled={index === items.length - 1} onClick={() => onIndexChange(index + 1)} className="grid size-8 rotate-180 place-items-center rounded-md hover:bg-white/10 disabled:opacity-40"><ChevronLeft className="size-4" /></button>
          </>}
          <a href={downloadHref?.(item) ?? item.url} download aria-label={labels.download} className="grid size-8 place-items-center rounded-md hover:bg-white/10"><Download className="size-4" /></a>
        </div>
      </header>
      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <div className="grid min-h-0 flex-1 place-items-center p-6"><img src={item.url} alt={item.alt} className="max-h-full max-w-full object-contain" /></div>
        <aside className="w-full shrink-0 overflow-y-auto p-3 md:w-80">
          <form className="rounded-xl bg-[#1c1c1f] p-3 text-[13px]" onSubmit={(e) => { e.preventDefault(); onSave?.(item, { name, alt }); }}>
            <h2 className="mb-2 font-semibold">{labels.info}</h2>
            <label className="mb-1 block text-xs font-medium text-white/80" htmlFor="mv-name">{labels.name}</label>
            <input id="mv-name" value={name} onChange={(e) => setName(e.target.value)} className="mb-2 h-8 w-full rounded-lg border border-white/20 bg-transparent px-2 text-[13px]" />
            <label className="mb-1 block text-xs font-medium text-white/80" htmlFor="mv-alt">{labels.alt}</label>
            <textarea id="mv-alt" rows={5} value={alt} onChange={(e) => setAlt(e.target.value)} className="mb-2 w-full rounded-lg border border-white/20 bg-transparent px-2 py-1.5 text-[13px]" />
            {item.details && <><div className="text-xs font-medium text-white/80">{labels.details}</div><p className="mb-2 text-xs text-white/60">{item.details}</p></>}
            {item.usedIn && <><div className="text-xs font-medium text-white/80">{labels.usedIn}</div><p className="mb-2 text-xs text-white/60">{item.usedIn}</p></>}
            {onSave && <Button type="submit" variant="primary" size="sm" disabled={name === item.name && alt === item.alt}>{labels.save}</Button>}
          </form>
        </aside>
      </div>
    </div>
  );
}

/** Bulk tag dialog: a search / create field and a checklist of the available tags. */
export function TagPickerDialog({ open, onClose, title, suggestions, onSave, labels }: {
  open: boolean; onClose: () => void; title: string; suggestions: string[];
  onSave: (tags: string[]) => void;
  labels: { search: string; available: string; save: string; cancel: string; close: string; create: (tag: string) => string };
}) {
  const [term, setTerm] = useState('');
  const [chosen, setChosen] = useState<string[]>([]);
  useEffect(() => { if (open) { setTerm(''); setChosen([]); } }, [open]);
  const t = term.trim();
  const all = [...new Set([...suggestions, ...chosen])];
  const shown = all.filter((s) => s.toLowerCase().includes(t.toLowerCase()));
  const canCreate = !!t && !all.some((s) => s.toLowerCase() === t.toLowerCase());
  const toggle = (tag: string) => setChosen((c) => (c.includes(tag) ? c.filter((x) => x !== tag) : [...c, tag]));
  return (
    <Modal open={open} onClose={onClose} title={title} closeLabel={labels.close} plain medium
      footer={<><Button onClick={onClose}>{labels.cancel}</Button><Button variant="primary" disabled={!chosen.length} onClick={() => { onSave(chosen); onClose(); }}>{labels.save}</Button></>}>
      <label className="field-control flex items-center gap-2">
        <Search className="size-4 text-muted" aria-hidden />
        <input autoFocus value={term} aria-label={labels.search} placeholder={labels.search} onChange={(e) => setTerm(e.target.value)} className="min-w-0 flex-1 bg-transparent outline-none"
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); if (canCreate) { setChosen((c) => [...c, t]); setTerm(''); } } }} />
      </label>
      <div className="mt-4 min-h-40">
        {canCreate && <button type="button" className="mb-2 text-[13px] text-accent hover:underline" onClick={() => { setChosen((c) => [...c, t]); setTerm(''); }}>{labels.create(t)}</button>}
        {shown.length > 0 && <p className="mb-1.5 text-[13px] font-semibold">{labels.available}</p>}
        <ul className="flex flex-col gap-1.5">
          {shown.map((s) => <li key={s}><label className="inline-flex items-center gap-2 text-[13px]"><input type="checkbox" className="size-4 accent-(--color-primary)" checked={chosen.includes(s)} onChange={() => toggle(s)} />{s}</label></li>)}
        </ul>
      </div>
    </Modal>
  );
}
