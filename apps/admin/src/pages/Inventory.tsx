import { Banner, Button, Card, EmptyState, IndexTable, Input, ListToolbar, Modal, Pagination, QuantityPopover, Select, Textarea, useToast } from '@shopme/ui';
import type { Column } from '@shopme/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { SlidersHorizontal, Warehouse } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { gql, mutate } from '../api';
import { ColumnPicker, useColumnVisibility } from '../components/ColumnPicker';
import { PageHeader } from '../components/PageHeader';
import { ExportButton, ImportButton } from '../components/CsvTools';
import { ViewTabs } from '../components/SavedViews';
import { INVENTORY_ACTIVATE, INVENTORY_ADJUST_QUANTITIES, INVENTORY_ITEM_TRACKING, INVENTORY_MOVE, INVENTORY_SET_QUANTITIES, INVENTORY_VARIANTS, LOCATIONS } from '../graphql';
import { useT } from '../i18n';
import { q as quote, useDebounced } from '../lib/hooks';
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
  const [params, setParams] = useSearchParams();
  const patch = (changes: Record<string, string>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(changes)) (v ? next.set(k, v) : next.delete(k));
    setParams(next, { replace: true });
  };
  const location = params.get('loc') ?? '';
  const untracked = params.get('tracking') === 'untracked';
  const setLocation = (v: string) => patch({ loc: v });
  const urlQ = params.get('q') ?? '';
  const [search, setSearch] = useState(urlQ);
  useEffect(() => { setSearch(urlQ); setCursor({}); }, [urlQ]); // a saved view changed the search
  const term = useDebounced(search);
  const [selected, setSelected] = useState<string[]>([]);
  const [bulkQty, setBulkQty] = useState<{ name: 'available' | 'on_hand'; mode: 'set' | 'adjust'; location: string; value: string } | null>(null);
  const [cursor, setCursor] = useState<{ after?: string; before?: string }>({});
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [moving, setMoving] = useState<{ v: VariantRow; to: string; qty: string } | null>(null);
  const [counting, setCounting] = useState<{ location: string; text: string } | null>(null);
  const cols = useColumnVisibility('inventory');

  const locs = useQuery({ queryKey: ['locations'], queryFn: () => gql<{ locations: { nodes: Array<{ id: string; name: string; isActive: boolean }> } }>(LOCATIONS) });
  const list = useQuery({
    queryKey: ['inventory', term, cursor],
    queryFn: () => gql<{ productVariants: Connection<VariantRow> }>(INVENTORY_VARIANTS, { query: term.trim() || null, ...(cursor.before ? { last: PAGE_SIZE, before: cursor.before } : { first: PAGE_SIZE, after: cursor.after ?? null }) }),
    placeholderData: (p) => p,
  });

  const rows = (list.data?.productVariants.nodes ?? []).filter((v) => v.inventoryItem.tracked !== untracked);
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

  const countStock = useMutation({
    mutationFn: async () => {
      const { location: loc, text } = counting!;
      const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((l) => { const [sku = '', n = ''] = l.split(/[,;\t]/).map((x) => x.trim()); return { sku, n: Number(n) }; });
      const bad = lines.find((l) => !l.sku || !Number.isInteger(l.n) || l.n < 0);
      if (bad) throw new Error(t('inventory.countBadLine', { line: `${bad.sku || '?'}` }));
      const quantities: Array<{ inventoryItemId: string; locationId: string; quantity: number }> = [];
      for (const l of lines) {
        const r = await gql<{ productVariants: Connection<VariantRow> }>(INVENTORY_VARIANTS, { first: 5, query: `sku:${quote(l.sku)}` });
        const v = r.productVariants.nodes.find((x) => x.sku === l.sku && x.inventoryItem.tracked);
        if (!v) throw new Error(t('inventory.countUnknownSku', { sku: l.sku }));
        quantities.push({ inventoryItemId: v.inventoryItem.id, locationId: loc, quantity: l.n });
      }
      return mutate(INVENTORY_SET_QUANTITIES, { input: { reason: 'cycle_count_available', name: 'available', quantities } }, 'inventorySetQuantities');
    },
    onSuccess: () => { toast(t('inventory.countDone')); setCounting(null); void qc.invalidateQueries({ queryKey: ['inventory'] }); void qc.invalidateQueries({ queryKey: ['products'] }); },
    onError: (e) => toast(e.message, 'critical'),
  });

  const refreshAll = () => { void qc.invalidateQueries({ queryKey: ['inventory'] }); void qc.invalidateQueries({ queryKey: ['products'] }); };
  const tracking = useMutation({
    mutationFn: ({ ids, tracked }: { ids: string[]; tracked: boolean }) => Promise.all(ids.map((id) => {
      const item = rows.find((r) => r.id === id)!.inventoryItem.id;
      return mutate(INVENTORY_ITEM_TRACKING, { id: item, tracked }, 'inventoryItemUpdate');
    })),
    onSuccess: (_d, v) => { toast(t(v.tracked ? 'inventory.tracking.on' : 'inventory.tracking.off', { n: v.ids.length })); setSelected([]); refreshAll(); },
    onError: (e) => toast(e.message, 'critical'),
  });
  const bulkQuantity = useMutation({
    mutationFn: async () => {
      const b = bulkQty!;
      const n = Math.trunc(Number(b.value));
      const targets = rows.filter((r) => selected.includes(r.id) && r.inventoryItem.tracked);
      // Make sure each item is stocked at the location first (a no-op when it already is).
      for (const r of targets) await mutate(INVENTORY_ACTIVATE, { inventoryItemId: r.inventoryItem.id, locationId: b.location, available: 0 }, 'inventoryActivate');
      if (b.mode === 'set') return mutate(INVENTORY_SET_QUANTITIES, { input: { reason: 'correction', name: b.name, quantities: targets.map((r) => ({ inventoryItemId: r.inventoryItem.id, locationId: b.location, quantity: Math.max(0, n) })) } }, 'inventorySetQuantities');
      return mutate(INVENTORY_ADJUST_QUANTITIES, { input: { reason: 'correction', name: b.name, changes: targets.map((r) => ({ inventoryItemId: r.inventoryItem.id, locationId: b.location, delta: n })) } }, 'inventoryAdjustQuantities');
    },
    onSuccess: () => { toast(t('inventory.saved')); setBulkQty(null); setSelected([]); refreshAll(); },
    onError: (e) => toast(e.message, 'critical'),
  });
  const activeLocations = locs.data?.locations.nodes.filter((l) => l.isActive !== false) ?? [];

  const columns: Array<Column<VariantRow>> = [
    { key: 'img', header: '', className: 'w-14', cell: (v) => <Thumb url={v.product.featuredMedia?.image?.url} /> },
    { key: 'product', header: t('products.product'), cell: (v) => <div><div className="font-medium">{v.product.title}</div>{v.title !== 'Default Title' && <span className="mt-0.5 inline-block rounded-md bg-surface px-1.5 py-px text-xs text-muted shadow-[inset_0_0_0_1px_var(--color-border)]">{v.title}</span>}</div> },
    { key: 'sku', header: t('inventory.sku'), cell: (v) => v.sku || <span className="text-muted">{t('inventory.noSku')}</span> },
    { key: 'unavailable', header: t('inventory.unavailable'), cell: (v) => qty(levelsOf(v), 'reserved') },
    { key: 'committed', header: t('inventory.committed'), cell: (v) => qty(levelsOf(v), 'committed') },
    {
      key: 'available', header: t('inventory.available'),
      cell: (v) => {
        const current = String(qty(levelsOf(v), 'available'));
        if (!location) return current;
        const key = editKey(v);
        const shown = edits[key] ?? current;
        return (
          <QuantityPopover
            value={Number(current)} labels={{ adjust: `${t('qty.adjust')} ${v.product.title}`, set: t('qty.set'), add: t('qty.add'), apply: t('qty.apply') }}
            trigger={<span className={shown !== current ? 'font-semibold text-accent' : undefined}>{shown}<SlidersHorizontal className="ml-1.5 inline size-3 text-muted" aria-hidden /></span>}
            onApply={(next) => setEdits((st) => { const n = { ...st }; if (String(next) === current) delete n[key]; else n[key] = String(next); return n; })} />
        );
      },
    },
    { key: 'onhand', header: t('inventory.onHand'), cell: (v) => qty(levelsOf(v), 'on_hand') },
    { key: 'incoming', header: t('inventory.incoming'), cell: (v) => qty(levelsOf(v), 'incoming') },
    ...(location && (locs.data?.locations.nodes.filter((l) => l.isActive !== false).length ?? 0) > 1
      ? [{ key: 'move', header: '', className: 'w-24', cell: (v: VariantRow) => <Button size="sm" aria-label={`${t('inventory.move')} ${v.product.title}`} onClick={() => setMoving({ v, to: '', qty: '1' })}>{t('inventory.move')}</Button> }]
      : []),
  ];
  const pi = list.data?.productVariants.pageInfo;
  const dirtyCount = Object.keys(edits).length;

  return (
    <>
      <PageHeader icon={<Warehouse className="size-4" />}
        title={<span className="flex items-center gap-2">{t('nav.inventory')}
          <select aria-label={t('inventory.location')} value={location} onChange={(e) => { setLocation(e.target.value); setEdits({}); }} className="field-control font-normal">
            <option value="">{t('inventory.allLocations')}</option>
            {locs.data?.locations.nodes.filter((l) => l.isActive !== false).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select></span>}
        actions={<>
          {dirtyCount > 0 && <><Button onClick={() => setEdits({})}>{t('save.discard')}</Button><Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>{t('inventory.saveN', { n: dirtyCount })}</Button></>}
          <Button onClick={() => setCounting({ location: location || locs.data?.locations.nodes.find((l) => l.isActive !== false)?.id || '', text: '' })}>{t('inventory.counts')}</Button>
          <ExportButton kind="inventory" /><ImportButton kind="inventory" invalidate={['inventory']} />
        </>} />
      <Card className="!p-0">
        <ListToolbar
          className="!rounded-b-none !shadow-none border-b border-line"
          leading={<ViewTabs resource="INVENTORY" query={[term.trim(), location && `location:${location}`, untracked && 'tracked:false'].filter(Boolean).join(' ')} value="all" onTab={() => { setSelected([]); setParams(new URLSearchParams(), { replace: true }); }} tabs={[{ id: 'all', label: t('inventory.tabAll') }]} />}
          query={search} onQuery={(v) => { setSearch(v); setCursor({}); patch({ q: v }); }} placeholder={t('list.searchAndFilter')} removeFilterLabel={t('list.removeFilter')}
          filters={[{ key: 'tracking', label: t('inventory.trackingFilter'), options: [{ value: 'untracked', label: t('inventory.filterUntracked') }] }]}
          values={{ tracking: untracked ? 'untracked' : '' }} onFilter={(_k, v) => { setSelected([]); patch({ tracking: v }); }}
          trailing={<ColumnPicker locked={['product']} columns={columns} hidden={cols.hidden} onToggle={cols.toggle} />}
        />
        {!location && rows.length > 0 && <p className="border-b border-line px-4 py-2 text-xs text-muted">{t('inventory.pickLocation')}</p>}
        {list.isError && <div className="p-3"><Banner>{(list.error as Error).message}</Banner></div>}
        <IndexTable rows={rows} rowId={(r) => r.id} columns={cols.filter(columns)} loading={list.isLoading}
          selected={selected} onSelectedChange={setSelected} selectedLabel={(n) => t('common.selected', { n })} selectAllLabel={t('common.selectAll')}
          bulkActions={untracked
            ? [{ key: 'track', label: t('inventory.trackQuantity'), onRun: (ids) => tracking.mutate({ ids, tracked: true }) }]
            : [
              { key: 'available', label: t('inventory.editAvailable'), onRun: () => setBulkQty({ name: 'available', mode: 'set', location: location || activeLocations[0]?.id || '', value: '' }) },
              { key: 'onhand', label: t('inventory.editOnHand'), onRun: () => setBulkQty({ name: 'on_hand', mode: 'set', location: location || activeLocations[0]?.id || '', value: '' }) },
              { key: 'untrack', label: t('inventory.stopTracking'), onRun: (ids) => tracking.mutate({ ids, tracked: false }) },
            ]}
          empty={list.isError ? null : <EmptyState icon={<Warehouse className="size-10" />} title={t('inventory.emptyTitle')} description={t('inventory.emptyBody')} />} />
        <Pagination hasPrevious={cursor.before ? !!pi?.hasPreviousPage : !!cursor.after} hasNext={cursor.before ? true : !!pi?.hasNextPage}
          previousLabel={t('common.previous')} nextLabel={t('common.next')}
          onPrevious={() => setCursor({ before: pi?.startCursor ?? undefined })} onNext={() => setCursor({ after: pi?.endCursor ?? undefined })} />
      </Card>
      <Modal open={!!bulkQty} onClose={() => setBulkQty(null)} closeLabel={t('common.close')} title={t(bulkQty?.name === 'on_hand' ? 'inventory.editOnHandTitle' : 'inventory.editAvailableTitle', { n: selected.length })}
        footer={<><Button onClick={() => setBulkQty(null)}>{t('common.cancel')}</Button><Button variant="primary" loading={bulkQuantity.isPending} disabled={!bulkQty?.location || bulkQty.value.trim() === '' || !Number.isFinite(Number(bulkQty.value))} onClick={() => bulkQuantity.mutate()}>{t('common.apply')}</Button></>}>
        {bulkQty && (
          <div className="grid gap-3">
            <Select label={t('inventory.location')} value={bulkQty.location} onChange={(e) => setBulkQty({ ...bulkQty, location: e.target.value })}>
              {activeLocations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </Select>
            <Select label={t('inventory.bulkMode')} value={bulkQty.mode} onChange={(e) => setBulkQty({ ...bulkQty, mode: e.target.value as 'set' | 'adjust' })}>
              <option value="set">{t('inventory.bulkSet')}</option>
              <option value="adjust">{t('inventory.bulkAdjust')}</option>
            </Select>
            <Input label={t('inventory.bulkValue')} type="number" min={bulkQty.mode === 'set' ? 0 : undefined} value={bulkQty.value} onChange={(e) => setBulkQty({ ...bulkQty, value: e.target.value })} />
          </div>
        )}
      </Modal>
      <Modal open={!!counting} onClose={() => setCounting(null)} closeLabel={t('common.close')} title={t('inventory.counts')}
        footer={<><Button onClick={() => setCounting(null)}>{t('common.cancel')}</Button><Button variant="primary" loading={countStock.isPending} disabled={!counting?.location || !counting.text.trim()} onClick={() => countStock.mutate()}>{t('inventory.countApply')}</Button></>}>
        {counting && (
          <div className="grid gap-3">
            <p className="text-[13px] text-muted">{t('inventory.countHelp')}</p>
            <Select label={t('inventory.location')} value={counting.location} onChange={(e) => setCounting({ ...counting, location: e.target.value })}>
              {locs.data?.locations.nodes.filter((l) => l.isActive !== false).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </Select>
            <Textarea label={t('inventory.countLines')} rows={6} placeholder={'SKU-001, 12\nSKU-002, 0'} value={counting.text} onChange={(e) => setCounting({ ...counting, text: e.target.value })} />
          </div>
        )}
      </Modal>
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
