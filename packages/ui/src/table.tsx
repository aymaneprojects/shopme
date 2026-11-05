import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, MoreHorizontal } from 'lucide-react';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { Button, Skeleton, cx } from './basics';
import { Checkbox, Switch } from './form';
import { Dropdown } from './overlay';

export interface Column<T> {
  key: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  /** When set the header is a sort toggle. */
  sortKey?: string;
  className?: string;
}

export interface BulkMenuItem { key: string; label: string; onRun: (ids: string[]) => void; disabled?: boolean; icon?: ReactNode; separatorBefore?: boolean }
export interface BulkAction { key: string; label: string; /** Turns the action into a button with a menu ("Print", "Mark as"); `onRun` is then unused. */ menu?: BulkMenuItem[]; disabled?: boolean; onRun: (ids: string[]) => void; danger?: boolean; /** Leading icon (shown in the overflow menu). */ icon?: ReactNode; /** Divider above the action in the overflow menu. */ separatorBefore?: boolean }

export interface IndexTableProps<T> {
  rows: T[];
  rowId: (row: T) => string;
  columns: Array<Column<T>>;
  loading?: boolean;
  selected?: string[];
  onSelectedChange?: (ids: string[]) => void;
  bulkActions?: BulkAction[];
  /** How many bulk actions stay as buttons in the bar; the rest move to the "..." menu. Default: all. */
  bulkInline?: number;
  onRowClick?: (row: T) => void;
  sort?: { key: string; reverse: boolean };
  onSortChange?: (s: { key: string; reverse: boolean }) => void;
  selectedLabel?: (n: number) => string;
  selectAllLabel?: string;
  /** Label of the "select the N rows of the page" menu entry. */
  selectPageLabel?: (n: number) => string;
  deselectLabel?: string;
  /** Label of the overflow ("...") button. */
  moreLabel?: string;
  /** Adds the "show only the selected rows" switch at the end of the bulk bar. */
  showSelectedLabel?: string;
  empty?: ReactNode;
}

/** Table with optional row selection, a bulk-action bar that replaces the header row, and sortable headers. */
export function IndexTable<T>({ rows, rowId, columns, loading, selected, onSelectedChange, bulkActions = [], bulkInline, onRowClick, sort, onSortChange, selectedLabel = (n) => `${n} selected`, selectAllLabel = 'Select all', selectPageLabel = (n) => `Select all ${n} on the page`, deselectLabel = 'Deselect all', moreLabel = 'More actions', showSelectedLabel, empty }: IndexTableProps<T>) {
  const selectable = !!onSelectedChange && !!selected;
  const [onlySelected, setOnlySelected] = useState(false);
  const ids = rows.map(rowId);
  const allOn = ids.length > 0 && ids.every((i) => selected?.includes(i));
  const some = selectable && selected!.length > 0;
  const shown = some && onlySelected ? rows.filter((r) => selected!.includes(rowId(r))) : rows;
  const toggle = (id: string) => onSelectedChange?.(selected!.includes(id) ? selected!.filter((x) => x !== id) : [...selected!, id]);
  const inline = bulkInline === undefined ? bulkActions : bulkActions.slice(0, bulkInline);
  const overflow = bulkInline === undefined ? [] : bulkActions.slice(bulkInline);
  const headCheck = (
    <Checkbox aria-label={selectAllLabel} checked={allOn} ref={(el: HTMLInputElement | null) => { if (el) el.indeterminate = some && !allOn; }} onChange={() => onSelectedChange!(some ? [] : ids)} />
  );
  return (
    <div>
      <div className="max-md:overflow-x-auto">
        <table className="itable w-full text-left text-[13px]">
          <thead className="border-b border-line bg-surface text-xs text-muted">
            {some && (
              <tr className="h-9" role="toolbar" aria-label={selectedLabel(selected!.length)}>
                <th className="w-10 px-3 font-normal">{headCheck}</th>
                <th colSpan={columns.length} className="px-0 font-normal">
                  <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 py-1 text-fg">
                    <Dropdown variant="secondary" size="sm" className="chip" chevron trigger={selectedLabel(selected!.length)} items={[
                      { key: 'page', label: selectPageLabel(ids.length), onSelect: () => onSelectedChange!(ids) },
                      { key: 'none', label: deselectLabel, onSelect: () => onSelectedChange!([]) },
                    ]} />
                    {inline.map((a) => a.menu
                      ? <Dropdown key={a.key} variant="secondary" size="sm" className="chip" chevron trigger={a.label} menuClassName="min-w-48" items={a.menu.map((m) => ({ key: m.key, label: m.label, icon: m.icon, disabled: m.disabled, separatorBefore: m.separatorBefore, onSelect: () => m.onRun(selected!) }))} />
                      : <Button key={a.key} size="sm" variant="secondary" disabled={a.disabled} className={cx('chip', a.danger && 'text-critical')} onClick={() => a.onRun(selected!)}>{a.label}</Button>)}
                    {overflow.length > 0 && (
                      <Dropdown variant="secondary" size="sm" icon className="chip" label={moreLabel} trigger={<MoreHorizontal className="size-4" />} menuClassName="min-w-56"
                        items={overflow.map((a) => ({ key: a.key, label: a.label, icon: a.icon, danger: a.danger, separatorBefore: a.separatorBefore, onSelect: () => a.onRun(selected!) }))} />
                    )}
                    {showSelectedLabel && <span className="ml-auto pr-3"><Switch checked={onlySelected} onChange={setOnlySelected} label={<span className="text-[13px] font-normal">{showSelectedLabel}</span>} /></span>}
                  </div>
                </th>
              </tr>
            )}
              <tr className={cx('h-9', some && '[visibility:collapse]')} aria-hidden={some || undefined}>
                {selectable && <th className="w-10 px-3">{headCheck}</th>}
                {columns.map((c) => (
                  <th key={c.key} className={cx('px-3 font-semibold', c.className)} aria-sort={sort && sort.key === c.sortKey ? (sort.reverse ? 'descending' : 'ascending') : undefined}>
                    {c.sortKey && onSortChange ? (
                      <button type="button" className="-mx-1.5 inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 hover:bg-hover hover:text-fg" onClick={() => onSortChange({ key: c.sortKey!, reverse: sort && sort.key === c.sortKey ? !sort.reverse : false })}>
                        {c.header}
                        {sort && sort.key === c.sortKey && (sort.reverse ? <ArrowDown className="size-3" /> : <ArrowUp className="size-3" />)}
                      </button>
                    ) : c.header}
                  </th>
                ))}
              </tr>
          </thead>
          <tbody>
            {loading && Array.from({ length: 6 }, (_, i) => (
              <tr key={i} className="h-11 border-b border-line last:border-0">
                {selectable && <td className="px-3"><Skeleton className="size-4" /></td>}
                {columns.map((c, j) => <td key={c.key} className="px-3"><Skeleton className={cx('h-3.5', (i + j) % 3 === 0 ? 'w-32' : (i + j) % 3 === 1 ? 'w-20' : 'w-12')} /></td>)}
              </tr>
            ))}
            {!loading && shown.map((row) => {
              const id = rowId(row);
              const on = !!selected?.includes(id);
              return (
                <tr key={id} data-click={onRowClick ? 'true' : undefined} data-selected={on ? 'true' : undefined} className={cx('min-h-11 border-b border-line last:border-0', onRowClick && 'cursor-pointer')} onClick={() => onRowClick?.(row)}>
                  {selectable && (
                    <td className="w-10 px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
                      <Checkbox aria-label={id} checked={on} onChange={() => toggle(id)} />
                    </td>
                  )}
                  {columns.map((c) => <td key={c.key} className={cx('px-3 py-2.5', c.className)}>{c.cell(row)}</td>)}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {!loading && rows.length === 0 && empty}
    </div>
  );
}

export function Pagination({ hasPrevious, hasNext, onPrevious, onNext, previousLabel = 'Previous', nextLabel = 'Next' }: { hasPrevious: boolean; hasNext: boolean; onPrevious: () => void; onNext: () => void; previousLabel?: string; nextLabel?: string }) {
  if (!hasPrevious && !hasNext) return null;
  return (
    <nav className="flex justify-center gap-2 border-t border-line p-2.5" aria-label="Pagination">
      <Button size="sm" icon={false} disabled={!hasPrevious} onClick={onPrevious} aria-label={previousLabel}><ChevronLeft className="size-4" />{previousLabel}</Button>
      <Button size="sm" disabled={!hasNext} onClick={onNext} aria-label={nextLabel}>{nextLabel}<ChevronRight className="size-4" /></Button>
    </nav>
  );
}
