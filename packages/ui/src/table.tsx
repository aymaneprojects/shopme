import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight } from 'lucide-react';
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

/** Table with optional row selection, a bulk-action bar and sortable headers. */
export function IndexTable<T>({ rows, rowId, columns, loading, selected, onSelectedChange, bulkActions = [], onRowClick, sort, onSortChange, selectedLabel = (n) => `${n} selected`, selectAllLabel = 'Select all', empty }: IndexTableProps<T>) {
  const selectable = !!onSelectedChange && !!selected;
  const ids = rows.map(rowId);
  const allOn = ids.length > 0 && ids.every((i) => selected?.includes(i));
  const toggle = (id: string) => onSelectedChange?.(selected!.includes(id) ? selected!.filter((x) => x !== id) : [...selected!, id]);
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-line bg-surface text-xs text-muted">
          {selectable && selected!.length > 0 ? (
            <tr>
              <th className="w-10 px-3 py-2"><Checkbox aria-label={selectAllLabel} checked={allOn} onChange={() => onSelectedChange!(allOn ? [] : ids)} /></th>
              <th colSpan={columns.length} className="px-3 py-1.5">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-fg">{selectedLabel(selected!.length)}</span>
                  {bulkActions.map((a) => <Button key={a.key} size="sm" variant={a.danger ? 'danger' : 'secondary'} onClick={() => a.onRun(selected!)}>{a.label}</Button>)}
                </div>
              </th>
            </tr>
          ) : (
            <tr>
              {selectable && <th className="w-10 px-3 py-2"><Checkbox aria-label={selectAllLabel} checked={allOn} onChange={() => onSelectedChange!(allOn ? [] : ids)} /></th>}
              {columns.map((c) => (
                <th key={c.key} className={cx('px-3 py-2 font-medium', c.className)} aria-sort={sort && sort.key === c.sortKey ? (sort.reverse ? 'descending' : 'ascending') : undefined}>
                  {c.sortKey && onSortChange ? (
                    <button type="button" className="inline-flex items-center gap-1 hover:text-fg" onClick={() => onSortChange({ key: c.sortKey!, reverse: sort && sort.key === c.sortKey ? !sort.reverse : false })}>
                      {c.header}
                      {sort && sort.key === c.sortKey && (sort.reverse ? <ArrowDown className="size-3" /> : <ArrowUp className="size-3" />)}
                    </button>
                  ) : c.header}
                </th>
              ))}
            </tr>
          )}
        </thead>
        <tbody>
          {loading && Array.from({ length: 5 }, (_, i) => (
            <tr key={i} className="border-b border-line">
              {selectable && <td className="px-3 py-3" />}
              {columns.map((c) => <td key={c.key} className="px-3 py-3"><Skeleton className="h-4 w-24" /></td>)}
            </tr>
          ))}
          {!loading && rows.map((row) => {
            const id = rowId(row);
            return (
              <tr key={id} className={cx('border-b border-line last:border-0', onRowClick && 'cursor-pointer hover:bg-surface', selected?.includes(id) && 'bg-primary-subtle')} onClick={() => onRowClick?.(row)}>
                {selectable && (
                  <td className="w-10 px-3 py-2" onClick={(e) => e.stopPropagation()}>
                    <Checkbox aria-label={id} checked={selected!.includes(id)} onChange={() => toggle(id)} />
                  </td>
                )}
                {columns.map((c) => <td key={c.key} className={cx('px-3 py-2', c.className)}>{c.cell(row)}</td>)}
              </tr>
            );
          })}
        </tbody>
      </table>
      {!loading && rows.length === 0 && empty}
    </div>
  );
}

export function Pagination({ hasPrevious, hasNext, onPrevious, onNext, previousLabel = 'Previous', nextLabel = 'Next' }: { hasPrevious: boolean; hasNext: boolean; onPrevious: () => void; onNext: () => void; previousLabel?: string; nextLabel?: string }) {
  if (!hasPrevious && !hasNext) return null;
  return (
    <nav className="flex justify-center gap-2 border-t border-line p-3" aria-label="Pagination">
      <Button size="sm" disabled={!hasPrevious} onClick={onPrevious} aria-label={previousLabel}><ChevronLeft className="size-4" />{previousLabel}</Button>
      <Button size="sm" disabled={!hasNext} onClick={onNext} aria-label={nextLabel}>{nextLabel}<ChevronRight className="size-4" /></Button>
    </nav>
  );
}
