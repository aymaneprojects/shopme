import { Banner, Button, Card, EmptyState, IndexTable, Input, Modal, Pagination, Select, useToast } from '@shopme/ui';
import type { Column } from '@shopme/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Search, Warehouse } from 'lucide-react';
import { useState } from 'react';
import { gql, mutate } from '../api';
import { PageHeader } from '../components/PageHeader';
import { ExportButton, ImportButton } from '../components/CsvTools';
import { INVENTORY_ACTIVATE, INVENTORY_MOVE, INVENTORY_SET_QUANTITIES, INVENTORY_VARIANTS, LOCATIONS } from '../graphql';
import { useT } from '../i18n';
import { useDebounced } from '../lib/hooks';
import type { Connection } from '../lib/hooks';
import { Thumb } from './Products';

interface Level { location: { id: string; name: string }; quantities: Array<{ name: string; quantity: number }> }
interface VariantRow {
  id: string; title: string; sku: string | null;
  product: { id: string; title: string; featuredMedia: { image?: { url: string } } | null };
  inventoryItem: { id: string; tracked: boolean; inventoryLevels: { nodes: Level[] } };
}
const PAGE_SIZE = 50;
const qty = (levels: Level[], name: string) => levels.reduce((n, l) => n + (l.quantities.find((q) => q.name === name)?.quantity ?? 0), 0);

export function InventoryPage() {
  const t = useT();
  const toast = useToast();
  const qc = useQueryClient();
  const [location, setLocation] = useState('');
  const [search, setSearch] = useState('');
  const term = useDebounced(search);
  const [cursor, setCursor] = useState<{ after?: string; before?: string }>({});
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [moving, setMoving] = useState<{ v: VariantRow; to: string; qty: string } | null>(null);

  const locs = useQuery({ queryKey: ['locations'], queryFn: () => gql<{ locations: { nodes: Array<{ id: string; name: string; isActive: boolean }> } }>(LOCATIONS) });
  const list = useQuery({
    queryKey: ['inventory', term, cursor],
    queryFn: () => gql<{ productVariants: Connection<VariantRow> }>(INVENTORY_VARIANTS, { query: term.trim() || null, ...(cursor.before ? { last: PAGE_SIZE, before: cursor.before } : { first: PAGE_SIZE, after: cursor.after ?? null }) }),
    placeholderData: (p) => p,
  });

  const rows = (list.data?.productVariants.nodes ?? []).filter((v) => v.inventoryItem.tracked);
  const levelsOf = (v: VariantRow) => v.inventoryItem.inventoryLevels.nodes.filter((l) => !location || l.location.id === location);
  const editKey = (v: VariantRow) => `${v.inventoryItem.id}|${location}`;

  const save = useMutation({
    mutationFn: () => {
      const quantities = Object.entries(edits).map(([k, value]) => {
        const [inventoryItemId, locationId] = k.split('|');
        return { inventoryItemId: inventoryItemId!, locationId: locationId!, quantity: Math.max(0, Math.trunc(Number(value) || 0)) };
      });
      return mutate(INVENTORY_SET_QUANTITIES, { input: { reason: 'correction', name: 'available', quantities } }, 'inventorySetQuantities');
    },
    onSuccess: () => { toast(t('inventory.saved')); setEdits({}); void qc.invalidateQueries({ queryKey: ['inventory'] }); void qc.invalidateQueries({ queryKey: ['products'] }); },
    onError: (e) => toast(e.message, 'critical'),
  });

  const move = useMutation({
    mutationFn: async () => {
      const { v, to, qty: n } = moving!;
      const item = v.inventoryItem.id;
      // Stock the item at the destination first if it is not there yet (a no-op otherwise).
      await mutate(INVENTORY_ACTIVATE, { inventoryItemId: item, locationId: to, available: 0 }, 'inventoryActivate');
      return mutate(INVENTORY_MOVE, { input: { reason: 'movement_created', referenceDocumentUri: `shopme://inventory/${item.split('/').pop()}`, changes: [{ inventoryItemId: item, quantity: Math.trunc(Number(n)), from: { locationId: location, name: 'available' }, to: { locationId: to, name: 'available' } }] } }, 'inventoryMoveQuantities');
    },
    onSuccess: () => { toast(t('inventory.moved')); setMoving(null); void qc.invalidateQueries({ queryKey: ['inventory'] }); void qc.invalidateQueries({ queryKey: ['products'] }); },
    onError: (e) => toast(e.message, 'critical'),
  });

  const columns: Array<Column<VariantRow>> = [
    { key: 'img', header: '', className: 'w-14', cell: (v) => <Thumb url={v.product.featuredMedia?.image?.url} /> },
    { key: 'product', header: t('products.product'), cell: (v) => <div><div className="font-medium">{v.product.title}</div>{v.title !== 'Default Title' && <div className="text-xs text-muted">{v.title}</div>}</div> },
    { key: 'sku', header: t('inventory.sku'), cell: (v) => v.sku || <span className="text-muted">{t('inventory.noSku')}</span> },
    { key: 'committed', header: t('inventory.committed'), cell: (v) => qty(levelsOf(v), 'committed') },
    {
      key: 'available', header: t('inventory.available'),
      cell: (v) => {
        const current = String(qty(levelsOf(v), 'available'));
        if (!location) return current;
        const key = editKey(v);
        return (
          <input type="number" min={0} aria-label={`${t('inventory.available')} ${v.product.title}`} value={edits[key] ?? current}
            className="w-24 rounded-md border border-line bg-canvas px-2 py-1"
            onChange={(e) => setEdits((s) => { const n = { ...s }; if (e.target.value === current) delete n[key]; else n[key] = e.target.value; return n; })} />
        );
      },
    },
    { key: 'onhand', header: t('inventory.onHand'), cell: (v) => qty(levelsOf(v), 'on_hand') },
    ...(location && (locs.data?.locations.nodes.filter((l) => l.isActive !== false).length ?? 0) > 1
      ? [{ key: 'move', header: '', className: 'w-24', cell: (v: VariantRow) => <Button size="sm" aria-label={`${t('inventory.move')} ${v.product.title}`} onClick={() => setMoving({ v, to: '', qty: '1' })}>{t('inventory.move')}</Button> }]
      : []),
  ];
  const pi = list.data?.productVariants.pageInfo;
  const dirtyCount = Object.keys(edits).length;

  return (
    <>
      <PageHeader title={t('nav.inventory')} actions={<><ExportButton kind="inventory" /><ImportButton kind="inventory" invalidate={['inventory']} />{dirtyCount > 0 && <><Button onClick={() => setEdits({})}>{t('save.discard')}</Button><Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>{t('inventory.saveN', { n: dirtyCount })}</Button></>}</>} />
      <Card className="!p-0">
        <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
          <div className="relative min-w-48 flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted" />
            <input type="search" value={search} onChange={(e) => { setSearch(e.target.value); setCursor({}); }} placeholder={t('inventory.search')} aria-label={t('inventory.search')} className="w-full rounded-md border border-line bg-canvas py-2 pl-8 pr-3 text-sm" />
          </div>
          <select aria-label={t('inventory.location')} value={location} onChange={(e) => { setLocation(e.target.value); setEdits({}); }} className="rounded-md border border-line bg-canvas px-2 py-1.5 text-sm">
            <option value="">{t('inventory.allLocations')}</option>
            {locs.data?.locations.nodes.filter((l) => l.isActive !== false).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </div>
        {!location && rows.length > 0 && <p className="border-b border-line px-4 py-2 text-xs text-muted">{t('inventory.pickLocation')}</p>}
        {list.isError && <div className="p-3"><Banner>{(list.error as Error).message}</Banner></div>}
        <IndexTable rows={rows} rowId={(r) => r.id} columns={columns} loading={list.isLoading}
          empty={list.isError ? null : <EmptyState icon={<Warehouse className="size-10" />} title={t('inventory.emptyTitle')} description={t('inventory.emptyBody')} />} />
        <Pagination hasPrevious={cursor.before ? !!pi?.hasPreviousPage : !!cursor.after} hasNext={cursor.before ? true : !!pi?.hasNextPage}
          previousLabel={t('common.previous')} nextLabel={t('common.next')}
          onPrevious={() => setCursor({ before: pi?.startCursor ?? undefined })} onNext={() => setCursor({ after: pi?.endCursor ?? undefined })} />
      </Card>
      <Modal open={!!moving} onClose={() => setMoving(null)} closeLabel={t('common.close')} title={t('inventory.moveTitle')}
        footer={<><Button onClick={() => setMoving(null)}>{t('common.cancel')}</Button><Button variant="primary" loading={move.isPending} disabled={!moving?.to || !(Number(moving.qty) >= 1)} onClick={() => move.mutate()}>{t('inventory.move')}</Button></>}>
        {moving && (
          <div className="grid gap-3">
            <p className="text-sm">{moving.v.product.title}{moving.v.title !== 'Default Title' && ` · ${moving.v.title}`}</p>
            <Select label={t('inventory.moveTo')} value={moving.to} onChange={(e) => setMoving({ ...moving, to: e.target.value })}>
              <option value="">{t('loc.chooseLocation')}</option>
              {locs.data?.locations.nodes.filter((l) => l.isActive !== false && l.id !== location).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </Select>
            <Input label={t('inventory.moveQuantity')} type="number" min={1} max={Math.max(0, qty(levelsOf(moving.v), 'available'))} value={moving.qty} onChange={(e) => setMoving({ ...moving, qty: e.target.value })} />
          </div>
        )}
      </Modal>
    </>
  );
}
