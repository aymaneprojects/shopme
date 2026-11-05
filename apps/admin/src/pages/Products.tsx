import { Badge, Banner, Button, Card, ConfirmDialog, EmptyState, IndexTable, Pagination, Tabs, useToast } from '@shopme/ui';
import type { Column } from '@shopme/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ImageIcon, Plus, Search, Tag } from 'lucide-react';
import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { gql, mutate } from '../api';
import { PageHeader } from '../components/PageHeader';
import { ExportButton, ImportButton } from '../components/CsvTools';
import { gidToNum } from '../format';
import { PRODUCTS, PRODUCTS_COUNT, PRODUCT_DELETE, PRODUCT_FILTER_OPTIONS, PRODUCT_UPDATE } from '../graphql';
import { useT } from '../i18n';
import { flattenStrings, q, useDebounced } from '../lib/hooks';
import type { Connection } from '../lib/hooks';

export interface ProductRow {
  id: string; title: string; handle: string; status: 'ACTIVE' | 'DRAFT' | 'ARCHIVED' | 'UNLISTED'; vendor: string; productType: string;
  totalInventory: number; tracksInventory: boolean; variantsCount: { count: number } | null;
  featuredMedia: { image?: { url: string } } | null;
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
  const status = get('status') || 'all';
  const sort = { key: get('sort') || 'UPDATED_AT', reverse: get('dir') !== 'asc' };
  const [selected, setSelected] = useState<string[]>([]);
  const [confirmDelete, setConfirmDelete] = useState<string[] | null>(null);

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
    { key: 'type', header: t('field.productType'), sortKey: 'PRODUCT_TYPE', cell: (p) => p.productType || <span className="text-muted">—</span> },
    { key: 'vendor', header: t('field.vendor'), sortKey: 'VENDOR', cell: (p) => p.vendor || <span className="text-muted">—</span> },
  ];

  const pick = (key: string, items: string[], all: string) => (
    <select aria-label={all} value={get(key)} onChange={(e) => patch({ [key]: e.target.value })} className="field-control">
      <option value="">{all}</option>
      {items.map((i) => <option key={i} value={i}>{i}</option>)}
    </select>
  );
  const opt = options.data;

  const empty = hasFilters
    ? <EmptyState icon={<Search className="size-10" />} title={t('products.noResults')} description={t('products.noResultsBody')} action={<Button onClick={() => { setSearch(''); setParams({}); }}>{t('products.clearFilters')}</Button>} />
    : <EmptyState icon={<Tag className="size-10" />} title={t('products.emptyTitle')} description={t('products.emptyBody')} action={<Button variant="primary" onClick={() => nav('/products/new')}><Plus className="size-4" />{t('products.add')}</Button>} />;

  return (
    <>
      <PageHeader title={t('nav.products')} actions={<><ExportButton kind="products" /><ImportButton kind="products" invalidate={['products', 'products-count']} /><Button variant="primary" onClick={() => nav('/products/new')}><Plus className="size-4" />{t('products.add')}</Button></>} />
      <Card className="!p-0">
        <div className="px-4 pt-2">
          <Tabs
            value={status} onChange={(v) => { setSelected([]); patch({ status: v === 'all' ? '' : v }); }}
            tabs={[{ id: 'all', label: t('products.tabAll') }, { id: 'active', label: label('ACTIVE') }, { id: 'draft', label: label('DRAFT') }, { id: 'archived', label: label('ARCHIVED') }]}
          />
        </div>
        <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
          <div className="relative min-w-48 flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-2 size-4 text-muted" />
            <input type="search" value={search} onChange={(e) => { setSearch(e.target.value); patch({ q: e.target.value }); }} placeholder={t('products.search')} aria-label={t('products.search')} className="field-control w-full pl-8" />
          </div>
          {pick('vendor', flattenStrings(opt?.productVendors), t('field.vendor'))}
          {pick('type', flattenStrings(opt?.productTypes), t('field.productType'))}
          {pick('tag', flattenStrings(opt?.productTags), t('field.tags'))}
          <select aria-label={t('products.inventory')} value={get('stock')} onChange={(e) => patch({ stock: e.target.value })} className="field-control">
            <option value="">{t('products.inventory')}</option>
            <option value="in">{t('products.stockIn')}</option>
            <option value="out">{t('products.stockOut')}</option>
          </select>
          <select aria-label={t('common.sort')} value={sort.key} onChange={(e) => patch({ sort: e.target.value })} className="field-control">
            {Object.keys(SORTS).map((k) => <option key={k} value={k}>{t(`sort.${k}` as 'sort.TITLE')}</option>)}
          </select>
        </div>
        {list.isError && <div className="p-3"><Banner>{(list.error as Error).message}</Banner></div>}
        <IndexTable
          rows={rows} rowId={(r) => r.id} columns={columns} loading={list.isLoading}
          selected={selected} onSelectedChange={setSelected} selectedLabel={(n) => t('common.selected', { n })} selectAllLabel={t('common.selectAll')}
          sort={sort} onSortChange={(s) => patch({ sort: s.key, dir: s.reverse ? 'desc' : 'asc' })}
          onRowClick={(r) => nav(`/products/${gidToNum(r.id)}`)}
          bulkActions={[
            { key: 'active', label: t('products.setActive'), onRun: (ids) => bulk.mutate({ ids, action: 'ACTIVE' }) },
            { key: 'draft', label: t('products.setDraft'), onRun: (ids) => bulk.mutate({ ids, action: 'DRAFT' }) },
            { key: 'archive', label: t('products.setArchived'), onRun: (ids) => bulk.mutate({ ids, action: 'ARCHIVED' }) },
            { key: 'delete', label: t('common.delete'), danger: true, onRun: (ids) => setConfirmDelete(ids) },
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
      <ConfirmDialog
        open={!!confirmDelete} onClose={() => setConfirmDelete(null)} danger
        title={t('products.deleteTitle', { n: confirmDelete?.length ?? 0 })} message={t('products.deleteBody')}
        confirmLabel={t('common.delete')} cancelLabel={t('common.cancel')}
        onConfirm={() => { if (confirmDelete) bulk.mutate({ ids: confirmDelete, action: 'DELETE' }); setConfirmDelete(null); }}
      />
    </>
  );
}
