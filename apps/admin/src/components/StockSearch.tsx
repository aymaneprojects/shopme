import { useQuery } from '@tanstack/react-query';
import { ScanLine, Search, Upload } from 'lucide-react';
import { useRef, useState } from 'react';
import { gql } from '../api';
import { STOCK_VARIANT_SEARCH } from '../graphql';
import { useT } from '../i18n';
import { useDebounced } from '../lib/hooks';
import { Thumb } from '../pages/Products';

export interface FoundVariant {
  id: string; title: string; sku: string | null; productTitle: string; image: string | null; inventoryItemId: string; tracked: boolean; unitCost: string | null;
  available: Record<string, number>; incoming: Record<string, number>;
}

interface Raw {
  id: string; title: string; sku: string | null;
  product: { id: string; title: string; featuredMedia: { image?: { url: string } } | null };
  inventoryItem: { id: string; tracked: boolean; unitCost: { amount: string } | null; inventoryLevels: { nodes: Array<{ location: { id: string }; quantities: Array<{ name: string; quantity: number }> }> } } | null;
}

export const variantLabel = (v: { productTitle: string; title: string }) => (v.title && v.title !== 'Default Title' ? `${v.productTitle} - ${v.title}` : v.productTitle);

/**
 * "Search products to add" field: search-as-you-type over variants (title, SKU, barcode), results show the available quantity at the
 * chosen location. The two icon buttons mirror the import (CSV of SKU,quantity) and barcode scan shortcuts.
 */
export function StockSearch({ locationId, onAdd, onImport, excludeItemIds = [], disabled }: {
  locationId?: string | null; onAdd: (v: FoundVariant) => void; onImport?: (rows: Array<{ sku: string; quantity: number }>) => void; excludeItemIds?: string[]; disabled?: boolean;
}) {
  const t = useT();
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const [scan, setScan] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const term = useDebounced(text).trim();
  const { data } = useQuery({
    queryKey: ['stock-variants', term], enabled: open && !disabled,
    queryFn: async () => (await gql<{ productVariants: { nodes: Raw[] } }>(STOCK_VARIANT_SEARCH, { query: term || null })).productVariants.nodes,
  });
  const found: FoundVariant[] = (data ?? []).filter((v) => v.inventoryItem).map((v) => {
    const levels = v.inventoryItem!.inventoryLevels.nodes;
    const pick = (name: string) => Object.fromEntries(levels.map((l) => [l.location.id, l.quantities.find((q) => q.name === name)?.quantity ?? 0]));
    return {
      id: v.id, title: v.title, sku: v.sku, productTitle: v.product.title, image: v.product.featuredMedia?.image?.url ?? null, inventoryItemId: v.inventoryItem!.id,
      tracked: v.inventoryItem!.tracked, unitCost: v.inventoryItem!.unitCost?.amount ?? null, available: pick('available'), incoming: pick('incoming'),
    };
  }).filter((v) => !excludeItemIds.includes(v.inventoryItemId));

  const scanned = async (code: string) => {
    const hit = (await gql<{ productVariants: { nodes: Raw[] } }>(STOCK_VARIANT_SEARCH, { query: `barcode:${code} OR sku:${code}` })).productVariants.nodes[0];
    if (hit?.inventoryItem) {
      const lv = hit.inventoryItem.inventoryLevels.nodes;
      const pick = (name: string) => Object.fromEntries(lv.map((l) => [l.location.id, l.quantities.find((q) => q.name === name)?.quantity ?? 0]));
      onAdd({ id: hit.id, title: hit.title, sku: hit.sku, productTitle: hit.product.title, image: hit.product.featuredMedia?.image?.url ?? null, inventoryItemId: hit.inventoryItem.id, tracked: hit.inventoryItem.tracked, unitCost: hit.inventoryItem.unitCost?.amount ?? null, available: pick('available'), incoming: pick('incoming') });
    }
  };

  return (
    <div className="relative">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted" />
          <input type="search" value={text} disabled={disabled} onChange={(e) => { setText(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)}
            placeholder={t('stock.searchProducts')} aria-label={t('stock.searchProducts')} className="field-control w-full border-0 pl-8 shadow-none focus:ring-0" />
        </div>
        {onImport && <>
          <input ref={file} type="file" accept=".csv,text/csv" hidden onChange={async (e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (!f) return;
            const rows = (await f.text()).split(/\r?\n/).map((l) => l.split(/[;,]/).map((c) => c.trim().replace(/^"|"$/g, ''))).filter((r) => r[0] && Number(r[1]) > 0 && r[0].toLowerCase() !== 'sku').map((r) => ({ sku: r[0]!, quantity: Math.floor(Number(r[1])) }));
            onImport(rows);
          }} />
          <button type="button" className="btn btn-secondary btn-icon btn-sm" title={t('stock.import')} aria-label={t('stock.import')} onClick={() => file.current?.click()} disabled={disabled}><Upload className="size-4" /></button>
        </>}
        <button type="button" className={`btn btn-secondary btn-icon btn-sm ${scan ? 'ring-2 ring-accent' : ''}`} title={t('stock.scan')} aria-label={t('stock.scan')} aria-pressed={scan} onClick={() => setScan((s) => !s)} disabled={disabled}><ScanLine className="size-4" /></button>
      </div>
      {scan && (
        <input autoFocus className="field-control mt-2 w-full" placeholder={t('stock.scanPlaceholder')} aria-label={t('stock.scanPlaceholder')}
          onKeyDown={(e) => { if (e.key === 'Enter') { const el = e.currentTarget; const v = el.value.trim(); el.value = ''; if (v) void scanned(v); } }} />
      )}
      {open && !disabled && (
        <ul role="listbox" className="absolute left-0 right-0 z-30 mt-1 max-h-72 overflow-auto rounded-lg border border-line bg-canvas shadow-lg">
          {found.length === 0 && <li className="px-3 py-2 text-[13px] text-muted">{t('picker.none')}</li>}
          {found.map((v) => (
            <li key={v.id} role="option" aria-selected={false}>
              <button type="button" className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-surface" onMouseDown={(e) => e.preventDefault()} onClick={() => { onAdd(v); setText(''); setOpen(false); }}>
                <Thumb url={v.image} className="size-8" />
                <span className="min-w-0 flex-1"><span className="block truncate text-[13px] font-medium">{variantLabel(v)}</span>{v.sku && <span className="block text-xs text-muted">{v.sku}</span>}</span>
                <span className="whitespace-nowrap text-xs text-muted">{locationId ? t('stock.availableAt', { n: v.available[locationId] ?? 0 }) : t('stock.availableTotal', { n: Object.values(v.available).reduce((a, b) => a + b, 0) })}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
