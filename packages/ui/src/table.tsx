import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, X } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button, Skeleton, cx } from './basics';
import { Checkbox } from './form';

export interface Column<T> {
  key: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  /** When set the header is a sort toggle. */
  sortKey?: string;
  className?: string;
}

export interface BulkAction { key: string; label: string; onRun: (ids: string[]) => void; danger?: boolean }

export interface IndexTableProps<T> {
  rows: T[];
  rowId: (row: T) => string;
  columns: Array<Column<T>>;
  loading?: boolean;
  selected?: string[];
  onSelectedChange?: (ids: string[]) => void;
  bulkActions?: BulkAction[];
  onRowClick?: (row: T) => void;
  sort?: { key: string; reverse: boolean };
  onSortChange?: (s: { key: string; reverse: boolean }) => void;
  selectedLabel?: (n: number) => string;
  selectAllLabel?: string;
  empty?: ReactNode;
}

/** Table with optional row selection, a sticky bulk-action bar and sortable headers. */
export function IndexTable<T>({ rows, rowId, columns, loading, selected, onSelectedChange, bulkActions = [], onRowClick, sort, onSortChange, selectedLabel = (n) => `${n} selected`, selectAllLabel = 'Select all', empty }: IndexTableProps<T>) {
  const selectable = !!onSelectedChange && !!selected;
  const ids = rows.map(rowId);
  const allOn = ids.length > 0 && ids.every((i) => selected?.includes(i));
  const some = selectable && selected!.length > 0;
  const toggle = (id: string) => onSelectedChange?.(selected!.includes(id) ? selected!.filter((x) => x !== id) : [...selected!, id]);
  return (
    <div>
      {some && (
        <div className="anim-fade sticky top-0 z-10 flex min-h-11 flex-wrap items-center gap-2 border-b border-line bg-canvas px-3 py-1.5 shadow-[0_2px_6px_rgb(16_24_40/0.06)]" role="toolbar">
          <Checkbox aria-label={selectAllLabel} checked={allOn} onChange={() => onSelectedChange!(allOn ? [] : ids)} />
          <span className="text-[13px] font-medium">{selectedLabel(selected!.length)}</span>
          {!allOn && ids.length > selected!.length && (
            <Button variant="plain" size="sm" onClick={() => onSelectedChange!(ids)}>{selectAllLabel} {ids.length}</Button>
          )}
          <span className="mx-1 h-4 w-px bg-line" aria-hidden />
          {bulkActions.map((a) => <Button key={a.key} size="sm" variant={a.danger ? 'critical' : 'secondary'} onClick={() => a.onRun(selected!)}>{a.label}</Button>)}
          <Button variant="plain" size="sm" icon aria-label="Clear selection" className="btn-neutral ml-auto" onClick={() => onSelectedChange!([])}><X className="size-4" /></Button>
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="itable w-full text-left text-[13px]">
          <thead className="border-b border-line text-xs text-muted">
            <tr className="h-8">
              {selectable && <th className="w-10 px-3"><Checkbox aria-label={selectAllLabel} checked={allOn} onChange={() => onSelectedChange!(allOn ? [] : ids)} /></th>}
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
            {!loading && rows.map((row) => {
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
