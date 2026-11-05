import { Banner, Button, Card, EmptyState, Select, Skeleton, useToast, cx } from '@shopme/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Table2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { Link, useSearchParams } from 'react-router';
import { UserErrors, gql, mutate } from '../api';
import { PageHeader } from '../components/PageHeader';
import { SaveBar } from '../components/SaveBar';
import { gidToNum } from '../format';
import { INVENTORY_SET_QUANTITIES, LOCATIONS, PRODUCTS_BULK, VARIANTS_BULK_UPDATE } from '../graphql';
import { useT } from '../i18n';
import { BULK_FIELDS, invalidCount, isValid, planBulk, setEdit } from '../lib/bulk-edit';
import type { BulkEdits, BulkField, BulkVariant } from '../lib/bulk-edit';
import { useShop } from '../session';

interface ApiProduct {
  id: string; title: string; status: string;
  variants: { nodes: Array<{
    id: string; title: string; sku: string | null; price: string; compareAtPrice: string | null;
    inventoryItem: { id: string; tracked: boolean; unitCost: { amount: string } | null; inventoryLevel: { quantities: Array<{ name: string; quantity: number }> } | null };
  }> };
}
interface Row extends BulkVariant { productTitle: string; variantTitle: string; first: boolean }

/** Spreadsheet-like editor for the price, cost, SKU and stock of the products selected on the product list (`/products/bulk?ids=1,2`). */
export function BulkEditPage() {
  const t = useT();
  const toast = useToast();
  const qc = useQueryClient();
  const { shop } = useShop();
  const [params] = useSearchParams();
  const ids = (params.get('ids') ?? '').split(',').map((x) => x.trim()).filter((x) => /^\d+$/.test(x)).slice(0, 100);
  const [locationId, setLocationId] = useState('');
  const [edits, setEdits] = useState<BulkEdits>({});
  const [error, setError] = useState<string | null>(null);

  const locs = useQuery({ queryKey: ['locations'], queryFn: () => gql<{ locations: { nodes: Array<{ id: string; name: string; isActive: boolean }> } }>(LOCATIONS) });
  const places = (locs.data?.locations.nodes ?? []).filter((l) => l.isActive);
  const loc = locationId || places[0]?.id || '';
  const q = useQuery({
    queryKey: ['products-bulk', ids.join(','), loc], enabled: !!loc && ids.length > 0,
    queryFn: () => gql<{ products: { nodes: ApiProduct[] } }>(PRODUCTS_BULK, { query: ids.map((i) => `id:${i}`).join(' OR '), locationId: loc }),
  });

  const rows = useMemo<Row[]>(() => (q.data?.products.nodes ?? []).flatMap((p) => p.variants.nodes.map((v, i): Row => ({
    productId: p.id, variantId: v.id, inventoryItemId: v.inventoryItem.id, tracked: v.inventoryItem.tracked, stocked: !!v.inventoryItem.inventoryLevel,
    sku: v.sku ?? '', price: v.price, compareAtPrice: v.compareAtPrice ?? '', cost: v.inventoryItem.unitCost?.amount ?? '',
    quantity: String(v.inventoryItem.inventoryLevel?.quantities.find((x) => x.name === 'available')?.quantity ?? 0),
    productTitle: p.title, variantTitle: v.title === 'Default Title' ? '' : v.title, first: i === 0,
  }))), [q.data]);

  const dirty = Object.keys(edits).length > 0;
  const bad = invalidCount(edits);
  const save = useMutation({
    mutationFn: async () => {
      const plan = planBulk(rows, edits, loc);
      for (const p of plan.variants) await mutate(VARIANTS_BULK_UPDATE, { productId: p.productId, variants: p.variants }, 'productVariantsBulkUpdate');
      if (plan.quantities.length) await mutate(INVENTORY_SET_QUANTITIES, { input: { reason: 'correction', name: 'available', quantities: plan.quantities } }, 'inventorySetQuantities');
    },
    onSuccess: async () => {
      toast(t('bulk.saved', { n: Object.keys(edits).length }));
      setEdits({}); setError(null);
      await qc.invalidateQueries({ queryKey: ['products-bulk'] }); void qc.invalidateQueries({ queryKey: ['products'] }); void qc.invalidateQueries({ queryKey: ['inventory'] });
    },
    onError: (e) => setError(e instanceof UserErrors ? e.errors.map((x) => `${x.field?.slice(-1)[0] ?? ''} ${x.message}`.trim()).join(' · ') : e.message),
  });

  const move = (e: KeyboardEvent<HTMLInputElement>, r: number, c: number) => {
    const dr = e.key === 'ArrowDown' || (e.key === 'Enter' && !e.shiftKey) ? 1 : e.key === 'ArrowUp' || (e.key === 'Enter' && e.shiftKey) ? -1 : 0;
    const dc = e.key === 'ArrowRight' && e.currentTarget.selectionStart === e.currentTarget.value.length ? 1 : e.key === 'ArrowLeft' && e.currentTarget.selectionEnd === 0 ? -1 : 0;
    if (!dr && !dc) return;
    e.preventDefault();
    const grid = e.currentTarget.closest('table')!;
    const target = grid.querySelector<HTMLInputElement>(`input[data-r="${r + dr}"][data-c="${c + dc}"]`);
    target?.focus(); target?.select();
  };

  const labels: Record<BulkField, string> = { sku: t('inventory.sku'), price: t('pricing.price'), compareAtPrice: t('pricing.compareAt'), cost: t('pricing.cost'), quantity: t('inventory.available') };
  const cell = (row: Row, field: BulkField, r: number) => {
    const c = BULK_FIELDS.indexOf(field);
    const disabled = field === 'quantity' && (!row.tracked || !row.stocked);
    const value = edits[row.variantId]?.[field] ?? row[field];
    const changed = edits[row.variantId]?.[field] !== undefined;
    const invalid = changed && !isValid(field, value);
    return (
      <td key={field} className="px-1 py-1">
        <input
          data-r={r} data-c={c} aria-label={`${labels[field]} ${row.productTitle} ${row.variantTitle}`.trim()} aria-invalid={invalid} disabled={disabled}
          inputMode={field === 'sku' ? 'text' : 'decimal'} value={disabled ? '' : value} placeholder={disabled ? '—' : undefined}
          onChange={(e) => setEdits((cur) => setEdit(cur, rows, row.variantId, field, e.target.value))} onKeyDown={(e) => move(e, r, c)} onFocus={(e) => e.currentTarget.select()}
          className={cx('w-full min-w-24 rounded-md border bg-field px-2 py-1 text-[13px]', field === 'sku' ? 'min-w-32' : 'text-right', invalid ? 'border-critical' : changed ? 'border-accent bg-surface' : 'border-transparent hover:border-line', disabled && 'opacity-50')}
        />
      </td>
    );
  };

  return (
    <>
      <SaveBar dirty={dirty} saving={save.isPending} onSave={() => (bad ? toast(t('bulk.invalid', { n: bad }), 'critical') : save.mutate())} onDiscard={() => { setEdits({}); setError(null); }} />
      <PageHeader back="/products" title={t('bulk.title')}
        actions={places.length > 1 && <Select aria-label={t('bulk.location')} value={loc} onChange={(e) => { setLocationId(e.target.value); setEdits((cur) => Object.fromEntries(Object.entries(cur).map(([k, v]) => { const { quantity: _q, ...rest } = v; return [k, rest]; }).filter(([, v]) => Object.keys(v as object).length))); }}>{places.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</Select>} />
      {error && <div className="mb-4"><Banner>{error}</Banner></div>}
      <Card className="!p-0">
        <p className="border-b border-line px-4 py-2 text-xs text-muted">{t('bulk.help', { currency: shop.currency })}</p>
        {(q.isLoading || locs.isLoading) && <div className="p-4"><Skeleton className="h-40" /></div>}
        {q.error && <div className="p-4"><Banner>{q.error.message}</Banner></div>}
        {ids.length === 0 && <EmptyState icon={<Table2 className="size-10" />} title={t('bulk.emptyTitle')} description={t('bulk.emptyBody')} action={<Link to="/products" className="text-accent hover:underline">{t('nav.products')}</Link>} />}
        {q.data && (
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead className="bg-surface text-left text-xs text-muted">
                <tr><th className="px-3 py-2 font-medium">{t('products.product')}</th>{BULK_FIELDS.map((f) => <th key={f} className={cx('px-3 py-2 font-medium', f !== 'sku' && 'text-right')}>{labels[f]}{f === 'price' || f === 'compareAtPrice' || f === 'cost' ? ` (${shop.currency})` : ''}</th>)}</tr>
              </thead>
              <tbody>
                {rows.map((row, r) => (
                  <tr key={row.variantId} className={cx('border-t border-line', row.first && r > 0 && 'border-t-2')}>
                    <td className="px-3 py-1.5">
                      {row.first ? <Link to={`/products/${gidToNum(row.productId)}`} className="font-medium text-accent hover:underline">{row.productTitle}</Link> : null}
                      {row.variantTitle && <div className={cx('text-xs text-muted', !row.first && 'pl-3')}>{row.variantTitle}</div>}
                    </td>
                    {BULK_FIELDS.map((f) => cell(row, f, r))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <p className="mt-2 text-xs text-muted"><Button variant="plain" size="sm" onClick={() => setEdits({})} disabled={!dirty}>{t('save.discard')}</Button></p>
    </>
  );
}
