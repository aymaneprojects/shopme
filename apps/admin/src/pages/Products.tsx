import { Badge, Banner, Button, Card, ConfirmDialog, Dropdown, EmptyState, IndexTable, ListToolbar, Pagination, TagPickerDialog, useToast } from '@shopme/ui';
import type { Column } from '@shopme/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Archive, ArrowUpDown, Check, CircleCheck, ImageIcon, Plus, Search, Tag, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { gql, mutate } from '../api';
import { ColumnPicker, useColumnVisibility } from '../components/ColumnPicker';
import { PageHeader } from '../components/PageHeader';
import { ViewAs } from '../components/ViewAs';
import { CollectionPicker } from '../components/Pickers';
import { ViewTabs } from '../components/SavedViews';
import { ProductMetricsStrip } from '../components/ProductMetrics';
import { ExportButton, ImportButton } from '../components/CsvTools';
import { gidToNum } from '../format';
import { COLLECTION_ADD_PRODUCTS, COLLECTION_REMOVE_PRODUCTS, PRODUCTS, PRODUCTS_COUNT, PRODUCT_DELETE, PRODUCT_FILTER_OPTIONS, PRODUCT_UPDATE, TAGS_ADD, TAGS_REMOVE } from '../graphql';
import { useT } from '../i18n';
import { flattenStrings, q, useDebounced } from '../lib/hooks';
import type { Connection } from '../lib/hooks';
import emptyProducts from '../assets/empty/empty-products.webp';

export interface ProductRow {
  id: string; title: string; handle: string; status: 'ACTIVE' | 'DRAFT' | 'ARCHIVED' | 'UNLISTED'; vendor: string; productType: string;
  totalInventory: number; tracksInventory: boolean; variantsCount: { count: number } | null;
  featuredMedia: { image?: { url: string } } | null;
  publishedAt?: string | null; category?: { name: string } | null;
}

type StringConn = { edges: Array<{ node: string }> };
export const statusTone = { ACTIVE: 'success', DRAFT: 'warning', ARCHIVED: 'neutral', UNLISTED: 'info' } as const;
const PAGE_SIZE = 25;
const SORTS = { TITLE: 'TITLE', CREATED_AT: 'CREATED_AT', UPDATED_AT: 'UPDATED_AT', INVENTORY_TOTAL: 'INVENTORY_TOTAL', PRODUCT_TYPE: 'PRODUCT_TYPE', VENDOR: 'VENDOR' };

export function Thumb({ url, className = 'size-8' }: { url?: string | null; className?: string }) {
  return url ? <img src={url} alt="" className={`${className} rounded-lg border border-line object-cover`} /> : <div className={`${className} grid place-items-center rounded-md border border-line bg-surface text-muted`}><ImageIcon className="size-4" /></div>;
}

export function ProductsPage() {
  const t = useT();
  const nav = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const get = (k: string) => params.get(k) ?? '';
  const patch = (changes: Record<string, string>, keepCursor = false) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(changes)) v ? next.set(k, v) : next.delete(k);
    if (!keepCursor) { next.delete('after'); next.delete('before'); }
    setParams(next, { replace: true });
  };
  const [search, setSearch] = useState(get('q'));
  const debounced = useDebounced(search);
  const urlQ = get('q');
  useEffect(() => { setSearch(urlQ); }, [urlQ]); // a saved view or the browser history changed the search
  const status = get('status') || 'all';
  const sort = { key: get('sort') || 'UPDATED_AT', reverse: get('dir') !== 'asc' };
  const [selected, setSelected] = useState<string[]>([]);
  const [confirmDelete, setConfirmDelete] = useState<string[] | null>(null);
  const cols = useColumnVisibility('products');
  const [tagging, setTagging] = useState<{ ids: string[]; mode: 'add' | 'remove' } | null>(null);
  const [collecting, setCollecting] = useState<{ ids: string[]; mode: 'add' | 'remove' } | null>(null);

  const terms = [
    debounced.trim() && debounced.trim(),
    status !== 'all' && `status:${status}`,
    get('vendor') && `vendor:${q(get('vendor'))}`,
    get('type') && `product_type:${q(get('type'))}`,
    get('tag') && `tag:${q(get('tag'))}`,
    get('stock') === 'in' && 'inventory_total:>0',
    get('stock') === 'out' && 'inventory_total:<=0',
  ].filter(Boolean).join(' ');
  const hasFilters = !!terms;

  const backward = !!get('before');
  const list = useQuery({
    queryKey: ['products', terms, sort, get('after'), get('before')],
    queryFn: () => gql<{ products: Connection<ProductRow> }>(PRODUCTS, {
      query: terms || null, sortKey: sort.key, reverse: sort.reverse,
      ...(backward ? { last: PAGE_SIZE, before: get('before') } : { first: PAGE_SIZE, after: get('after') || null }),
    }),
    placeholderData: (prev) => prev,
  });
  const options = useQuery({
    queryKey: ['product-filter-options'],
    queryFn: () => gql<Record<'productTypes' | 'productVendors' | 'productTags', StringConn>>(PRODUCT_FILTER_OPTIONS),
    staleTime: 60_000,
  });
  const count = useQuery({ queryKey: ['products-count', terms], queryFn: () => gql<{ productsCount: { count: number } }>(PRODUCTS_COUNT, { query: terms || null }) });

  const bulk = useMutation({
    mutationFn: async ({ ids, action }: { ids: string[]; action: 'ACTIVE' | 'DRAFT' | 'ARCHIVED' | 'DELETE' }) => {
      await Promise.all(ids.map((id) => action === 'DELETE'
        ? mutate(PRODUCT_DELETE, { input: { id } }, 'productDelete')
        : mutate(PRODUCT_UPDATE, { product: { id, status: action } }, 'productUpdate')));
    },
    onSuccess: (_d, v) => { toast(t(v.action === 'DELETE' ? 'products.deleted' : 'products.updated', { n: v.ids.length })); setSelected([]); void qc.invalidateQueries({ queryKey: ['products'] }); void qc.invalidateQueries({ queryKey: ['products-count'] }); },
    onError: (e) => toast(e.message, 'critical'),
  });

  const done = (n: number) => { toast(t('products.updated', { n })); setSelected([]); void qc.invalidateQueries({ queryKey: ['products'] }); };
  const tagBulk = useMutation({
    mutationFn: async ({ ids, mode, tags: list }: { ids: string[]; mode: 'add' | 'remove'; tags: string[] }) => {
      await Promise.all(ids.map((id) => (mode === 'add' ? mutate(TAGS_ADD, { id, tags: list }, 'tagsAdd') : mutate(TAGS_REMOVE, { id, tags: list }, 'tagsRemove'))));
    },
    onSuccess: (_d, v) => { done(v.ids.length); void qc.invalidateQueries({ queryKey: ['product-filter-options'] }); },
    onError: (e) => toast(e.message, 'critical'),
  });
  const collectionBulk = useMutation({
    mutationFn: async ({ ids, mode, collections }: { ids: string[]; mode: 'add' | 'remove'; collections: string[] }) => {
      for (const id of collections) await mutate(mode === 'add' ? COLLECTION_ADD_PRODUCTS : COLLECTION_REMOVE_PRODUCTS, { id, productIds: ids }, mode === 'add' ? 'collectionAddProductsV2' : 'collectionRemoveProducts');
    },
    onSuccess: (_d, v) => done(v.ids.length),
    onError: (e) => toast(e.message, 'critical'),
  });

  const rows = list.data?.products.nodes ?? [];
  const pageInfo = list.data?.products.pageInfo;
  const label = (s: string) => t(`status.${s}` as 'status.ACTIVE');
  const columns: Array<Column<ProductRow>> = [
    { key: 'img', header: '', className: 'w-14', cell: (p) => <Thumb url={p.featuredMedia?.image?.url} /> },
    { key: 'title', header: t('products.product'), sortKey: 'TITLE', cell: (p) => <span className="font-medium">{p.title}</span> },
    { key: 'status', header: t('field.status'), cell: (p) => <Badge tone={statusTone[p.status]}>{label(p.status)}</Badge> },
    {
      key: 'inv', header: t('products.inventory'), sortKey: 'INVENTORY_TOTAL',
      cell: (p) => p.tracksInventory
        ? <span className={p.totalInventory <= 0 ? 'text-critical' : ''}>{t('products.inStock', { n: p.totalInventory, v: p.variantsCount?.count ?? 1, $count: p.variantsCount?.count ?? 1 })}</span>
        : <span className="text-muted">{t('products.notTracked')}</span>,
    },
    { key: 'category', header: t('qa.products.category'), cell: (p) => p.category?.name || <span className="text-muted">—</span> },
    { key: 'channels', header: t('qa.products.channels'), className: 'text-right', cell: (p) => <span className="tabular-nums">{p.publishedAt ? 1 : 0}</span> },
    { key: 'type', header: t('qa.products.productType'), sortKey: 'PRODUCT_TYPE', cell: (p) => p.productType || <span className="text-muted">—</span> },
    { key: 'vendor', header: t('field.vendor'), sortKey: 'VENDOR', cell: (p) => p.vendor || <span className="text-muted">—</span> },
  ];

  const opt = options.data;
  const toOptions = (items: string[]) => items.map((i) => ({ value: i, label: i }));
  const filters = [
    { key: 'vendor', label: t('filter.vendor'), options: toOptions(flattenStrings(opt?.productVendors)) },
    { key: 'type', label: t('filter.type'), options: toOptions(flattenStrings(opt?.productTypes)) },
    { key: 'tag', label: t('filter.tag'), options: toOptions(flattenStrings(opt?.productTags)) },
    { key: 'stock', label: t('filter.stock'), options: [{ value: 'in', label: t('products.stockIn') }, { value: 'out', label: t('products.stockOut') }] },
  ];

  const empty = hasFilters
    ? <EmptyState icon={<Search className="size-10" />} title={t('products.noResults')} description={t('products.noResultsBody')} action={<Button onClick={() => { setSearch(''); setParams({}); }}>{t('products.clearFilters')}</Button>} />
    : <EmptyState image={emptyProducts} title={t('products.emptyTitle')} description={t('products.emptyBody')} action={<Button variant="primary" onClick={() => nav('/products/new')}><Plus className="size-4" />{t('products.add')}</Button>} />;

  return (
    <>
      <PageHeader icon={<Tag className="size-4" />} title={t('nav.products')} actions={<><ViewAs /><ImportButton kind="products" invalidate={['products', 'products-count']} /><ExportButton kind="products" currentIds={rows.map((r) => r.id)} selectedIds={selected} /><Button variant="primary" onClick={() => nav('/products/new')}>{t('products.add')}</Button></>} />
      <ProductMetricsStrip />
      <Card className="!p-0">
        <ListToolbar
          className="!rounded-b-none !shadow-none border-b border-line"
          leading={<ViewTabs
            resource="PRODUCT" query={terms} value={status} onTab={(v) => { setSelected([]); patch({ status: v === 'all' ? '' : v, view: '' }); }}
            tabs={[{ id: 'all', label: t('products.tabAll') }, { id: 'active', label: label('ACTIVE') }, { id: 'draft', label: label('DRAFT') }, { id: 'archived', label: label('ARCHIVED') }]}
          />}
          query={search} onQuery={(v) => { setSearch(v); patch({ q: v }); }} placeholder={t('list.searchAndFilter')}
          filters={filters} values={{ vendor: get('vendor'), type: get('type'), tag: get('tag'), stock: get('stock') }} onFilter={(k, v) => patch({ [k]: v })} removeFilterLabel={t('list.removeFilter')}
          trailing={<>
            <Dropdown align="right" variant="plain" size="sm" icon className="btn-neutral" label={t('common.sort')} trigger={<ArrowUpDown className="size-4" />}
              items={Object.keys(SORTS).map((k) => ({ key: k, label: t(`sort.${k}` as 'sort.TITLE'), icon: sort.key === k ? <Check className="size-4" /> : undefined, onSelect: () => patch({ sort: k }) }))} />
            <ColumnPicker locked={['title']} columns={columns} hidden={cols.hidden} onToggle={cols.toggle} />
          </>}
        />
        {list.isError && <div className="p-3"><Banner>{(list.error as Error).message}</Banner></div>}
        <IndexTable
          rows={rows} rowId={(r) => r.id} columns={cols.filter(columns)} loading={list.isLoading}
          selected={selected} onSelectedChange={setSelected} selectedLabel={(n) => t('common.selected', { n })} selectAllLabel={t('common.selectAll')}
          sort={sort} onSortChange={(s) => patch({ sort: s.key, dir: s.reverse ? 'desc' : 'asc' })}
          onRowClick={(r) => nav(`/products/${gidToNum(r.id)}`)}
          bulkInline={2} moreLabel={t('list.moreBulk')} selectPageLabel={(n) => t('list.selectPage', { n })} deselectLabel={t('list.deselectAll')} showSelectedLabel={t('list.showSelected')}
          bulkActions={[
            { key: 'bulk', label: t('products.bulkEdit'), onRun: (ids) => nav(`/products/bulk?ids=${ids.map(gidToNum).join(',')}`) },
            { key: 'draft', label: t('products.setDraft'), onRun: (ids) => bulk.mutate({ ids, action: 'DRAFT' }) },
            { key: 'archive', label: t('bulk.archive'), icon: <Archive className="size-4" />, onRun: (ids) => bulk.mutate({ ids, action: 'ARCHIVED' }) },
            { key: 'active', label: t('products.setActive'), icon: <CircleCheck className="size-4" />, onRun: (ids) => bulk.mutate({ ids, action: 'ACTIVE' }) },
            { key: 'delete', label: t('bulk.deleteProducts'), icon: <Trash2 className="size-4" />, danger: true, onRun: (ids) => setConfirmDelete(ids) },
            { key: 'addTags', label: t('products.addTags'), separatorBefore: true, onRun: (ids) => setTagging({ ids, mode: 'add' }) },
            { key: 'removeTags', label: t('products.removeTags'), onRun: (ids) => setTagging({ ids, mode: 'remove' }) },
            { key: 'addColl', label: t('products.addToCollections'), separatorBefore: true, onRun: (ids) => setCollecting({ ids, mode: 'add' }) },
            { key: 'removeColl', label: t('products.removeFromCollections'), onRun: (ids) => setCollecting({ ids, mode: 'remove' }) },
          ]}
          empty={list.isError ? null : empty}
        />
        <Pagination
          hasPrevious={backward ? !!pageInfo?.hasPreviousPage : !!get('after')} hasNext={backward ? true : !!pageInfo?.hasNextPage}
          previousLabel={t('common.previous')} nextLabel={t('common.next')}
          onPrevious={() => patch({ before: pageInfo?.startCursor ?? '', after: '' }, true)}
          onNext={() => patch({ after: pageInfo?.endCursor ?? '', before: '' }, true)}
        />
        {count.data && rows.length > 0 && <p className="border-t border-line px-4 py-2 text-xs text-muted">{t('products.count', { n: count.data.productsCount.count })}</p>}
      </Card>
      <TagPickerDialog open={!!tagging} onClose={() => setTagging(null)} title={t(tagging?.mode === 'remove' ? 'products.removeTags' : 'products.addTags')} suggestions={flattenStrings(opt?.productTags)}
        onSave={(list) => { if (tagging) tagBulk.mutate({ ...tagging, tags: list }); setTagging(null); }}
        labels={{ search: t('tagpicker.search'), available: t('tagpicker.available'), save: t('save.save'), cancel: t('common.cancel'), close: t('common.close'), create: (x) => t('tagpicker.create', { tag: x }) }} />
      <CollectionPicker open={!!collecting} onClose={() => setCollecting(null)} onConfirm={(c) => { if (collecting) collectionBulk.mutate({ ...collecting, collections: c.map((x) => x.id) }); setCollecting(null); }} />
      <ConfirmDialog
        open={!!confirmDelete} onClose={() => setConfirmDelete(null)} danger
        title={t('products.deleteTitle', { n: confirmDelete?.length ?? 0 })} message={t('products.deleteBody')}
        confirmLabel={t('common.delete')} cancelLabel={t('common.cancel')}
        onConfirm={() => { if (confirmDelete) bulk.mutate({ ids: confirmDelete, action: 'DELETE' }); setConfirmDelete(null); }}
      />
    </>
  );
}
