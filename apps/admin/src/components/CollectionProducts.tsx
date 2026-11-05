import { Button, ButtonGroup, Card, Dropdown } from '@shopme/ui';
import { Check, Columns3, LayoutGrid, List, ListFilter, Plus, Search, Trash2, X } from 'lucide-react';
import { useState } from 'react';
import { useI18n } from '../i18n';
import type { Key } from '../i18n';
import { Thumb } from '../pages/Products';
import type { PickedProduct } from './Pickers';

const STATUSES = ['ACTIVE', 'DRAFT', 'UNLISTED', 'ARCHIVED'] as const;
const COLUMNS = [2, 3, 4, 5, 6];
const SORT_ORDERS = ['MANUAL', 'BEST_SELLING', 'ALPHA_ASC', 'ALPHA_DESC', 'PRICE_DESC', 'PRICE_ASC', 'CREATED_DESC', 'CREATED'];

/** Products of a collection: search, status filter chip with "Clear all", sort, list or grid view with a column count control. */
export function CollectionProducts({ products, smart, sortOrder, onSortOrder, onAdd, onRemove }: {
  products: PickedProduct[]; smart: boolean; sortOrder: string; onSortOrder: (s: string) => void; onAdd: () => void; onRemove: (id: string) => void;
}) {
  const { t } = useI18n();
  const [query, setQuery] = useState('');
  const [statuses, setStatuses] = useState<string[]>([]);
  const [grid, setGrid] = useState(false);
  const [cols, setCols] = useState(4);
  const needle = query.trim().toLowerCase();
  const shown = products.filter((p) => (!needle || p.title.toLowerCase().includes(needle)) && (!statuses.length || statuses.includes(p.status ?? 'ACTIVE')));
  const toggle = (s: string) => setStatuses((cur) => (cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s]));
  const remove = (p: PickedProduct) => !smart && <button type="button" aria-label={`${t('common.remove')} ${p.title}`} className={grid ? 'absolute right-1 top-1 rounded-full bg-canvas p-1 text-muted opacity-0 shadow-card hover:text-fg focus-visible:opacity-100 group-hover:opacity-100' : 'rounded p-1 text-muted hover:bg-surface'} onClick={() => onRemove(p.id)}><Trash2 className={grid ? 'size-3.5' : 'size-4'} /></button>;
  return (
    <Card title={t('collection.products', { n: products.length })} actions={!smart && <Button size="sm" onClick={onAdd}><Plus className="size-4" />{t('collection.addProducts')}</Button>}>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative min-w-40 flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-2 size-4 text-muted" />
          <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('bp.collection.filter')} aria-label={t('bp.collection.filter')} className="field-control w-full pl-8" />
        </div>
        <Dropdown label={t('fin.col.statusFilter')} icon trigger={<ListFilter className="size-4" />} items={STATUSES.map((s) => ({ key: s, label: t(`status.${s}` as Key), icon: statuses.includes(s) ? <Check className="size-4" /> : <span className="size-4" />, onSelect: () => toggle(s) }))} />
        {grid && <Dropdown label={t('fin.col.columns')} className="gap-1" trigger={<><Columns3 className="size-4" /><span>{cols}</span></>} items={COLUMNS.map((n) => ({ key: String(n), label: t('fin.col.nColumns', { n }), icon: n === cols ? <Check className="size-4" /> : <span className="size-4" />, onSelect: () => setCols(n) }))} />}
        <select aria-label={t('collection.sortOrder')} value={sortOrder} onChange={(e) => onSortOrder(e.target.value)} className="field-control w-auto">
          {SORT_ORDERS.map((s) => <option key={s} value={s}>{t(`sortOrder.${s}` as 'sortOrder.MANUAL')}</option>)}
        </select>
        <ButtonGroup>
          <Button icon aria-label={t('bp.collection.listView')} aria-pressed={!grid} onClick={() => setGrid(false)}><List className="size-4" /></Button>
          <Button icon aria-label={t('bp.collection.gridView')} aria-pressed={grid} onClick={() => setGrid(true)}><LayoutGrid className="size-4" /></Button>
        </ButtonGroup>
      </div>
      {statuses.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-2 text-[13px]">
          <span className="inline-flex items-center gap-1 rounded-full border border-line bg-surface py-0.5 pl-2.5 pr-1 text-xs">
            {t('fin.col.statusChip', { values: statuses.map((s) => t(`status.${s}` as Key)).join(', ') })}
            <button type="button" aria-label={t('fin.col.removeStatus')} className="grid size-5 place-items-center rounded-full hover:bg-hover" onClick={() => setStatuses([])}><X className="size-3" /></button>
          </span>
          <button type="button" className="text-muted underline-offset-2 hover:text-fg hover:underline" onClick={() => setStatuses([])}>{t('fin.col.clearAll')}</button>
        </div>
      )}
      {products.length === 0 ? <p className="text-[13px] text-muted">{smart ? t('collection.autoEmpty') : t('collection.manualEmpty')}</p> : shown.length === 0 ? <p className="text-[13px] text-muted">{t('products.noResults')}</p> : grid ? (
        <ul className="grid gap-3" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
          {shown.map((p) => (
            <li key={p.id} className="group relative flex min-w-0 flex-col gap-1.5">
              <Thumb url={p.featuredMedia?.image?.url} className="aspect-square w-full" />
              <span className="truncate text-[13px]">{p.title}</span>
              {remove(p)}
            </li>
          ))}
        </ul>
      ) : (
        <ul className="divide-y divide-line">
          {shown.map((p) => (
            <li key={p.id} className="flex items-center gap-3 py-2">
              <Thumb url={p.featuredMedia?.image?.url} className="size-8" />
              <span className="min-w-0 flex-1 truncate text-[13px]">{p.title}</span>
              {remove(p)}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
