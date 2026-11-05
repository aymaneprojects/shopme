import { Badge, Banner, Button, Card, ConfirmDialog, EmptyState, IndexTable, Modal, Pagination, Tabs, useToast } from '@shopme/ui';
import type { Column } from '@shopme/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronRight, Download, Gift, Package, Plus, Search, ShoppingBag, Tag, Truck } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { gql, mutate } from '../api';
import { ColumnPicker, useColumnVisibility } from '../components/ColumnPicker';
import { PageHeader } from '../components/PageHeader';
import { searchCls, useFormat, useListParams } from '../components/shared';
import { gidToNum } from '../format';
import {
  DISCOUNT_AUTOMATIC_ACTIVATE, DISCOUNT_AUTOMATIC_DEACTIVATE, DISCOUNT_AUTOMATIC_DELETE, DISCOUNT_CODE_ACTIVATE, DISCOUNT_CODE_DEACTIVATE, DISCOUNT_CODE_DELETE, DISCOUNT_NODES,
} from '../graphql';
import { useT } from '../i18n';
import type { Key } from '../i18n';
import { downloadText, toCsv } from '../lib/download';
import { useDebounced } from '../lib/hooks';
import type { Connection } from '../lib/hooks';
import emptyDiscounts from '../assets/empty/empty-discounts.webp';

export interface DiscountRow {
  id: string;
  discount: { __typename: string; title: string; status: string; startsAt: string; endsAt: string | null; usageLimit?: number | null; asyncUsageCount: number; summary: string; tags?: string[]; context?: { __typename: string; customers?: Array<{ id: string }>; segments?: Array<{ id: string; name: string }> }; combinesWith?: { productDiscounts: boolean; orderDiscounts: boolean; shippingDiscounts: boolean }; codes?: { nodes: Array<{ code: string }> } };
}
const PAGE_SIZE = 25;
const TABS = ['all', 'active', 'scheduled', 'expired'] as const;
type Tab = (typeof TABS)[number];
const tone = { ACTIVE: 'success', SCHEDULED: 'info', EXPIRED: 'neutral' } as const;

export function DiscountsPage() {
  const t = useT();
  const nav = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();
  const fmt = useFormat();
  const L = useListParams();
  const tab = (TABS.includes(L.get('tab') as Tab) ? L.get('tab') : 'all') as Tab;
  const [search, setSearch] = useState(L.get('q'));
  const term = useDebounced(search);
  const [selected, setSelected] = useState<string[]>([]);
  const [chooser, setChooser] = useState(false);
  const [confirm, setConfirm] = useState<string[] | null>(null);
  const cols = useColumnVisibility('discounts');
  const [exporting, setExporting] = useState(false);
  const [tagFilter, setTagFilter] = useState(L.get('tag'));
  const tagTerm = useDebounced(tagFilter).trim();
  const terms = [term.trim(), tab !== 'all' && `status:${tab}`, tagTerm && `tag:${/\s/.test(tagTerm) ? `"${tagTerm.replace(/"/g, '')}"` : tagTerm}`].filter(Boolean).join(' ');

  const list = useQuery({
    queryKey: ['discounts', terms, L.get('after'), L.get('before')],
    queryFn: () => gql<{ discountNodes: Connection<DiscountRow> }>(DISCOUNT_NODES, { query: terms || null, ...L.page(PAGE_SIZE) }),
    placeholderData: (p) => p,
  });
  const bulk = useMutation({
    mutationFn: async ({ ids, action }: { ids: string[]; action: 'activate' | 'deactivate' | 'delete' }) => {
      await Promise.all(ids.map((id) => {
        const auto = id.includes('DiscountAutomaticNode');
        return action === 'activate' ? (auto ? mutate(DISCOUNT_AUTOMATIC_ACTIVATE, { id }, 'discountAutomaticActivate') : mutate(DISCOUNT_CODE_ACTIVATE, { id }, 'discountCodeActivate'))
          : action === 'deactivate' ? (auto ? mutate(DISCOUNT_AUTOMATIC_DEACTIVATE, { id }, 'discountAutomaticDeactivate') : mutate(DISCOUNT_CODE_DEACTIVATE, { id }, 'discountCodeDeactivate'))
            : (auto ? mutate(DISCOUNT_AUTOMATIC_DELETE, { id }, 'discountAutomaticDelete') : mutate(DISCOUNT_CODE_DELETE, { id }, 'discountCodeDelete'));
      }));
    },
    onSuccess: (_d, v) => { toast(t('discounts.bulkDone', { n: v.ids.length })); setSelected([]); void qc.invalidateQueries({ queryKey: ['discounts'] }); },
    onError: (e) => toast(e.message, 'critical'),
  });

  /** Every discount matching the current search and tab, as a CSV download. */
  const exportCsv = async () => {
    setExporting(true);
    try {
      const out: unknown[][] = [['Title', 'Code', 'Method', 'Status', 'Type', 'Starts', 'Ends', 'Used', 'Summary']];
      for (let after: string | null = null; ;) {
        const r: { discountNodes: Connection<DiscountRow> } = await gql(DISCOUNT_NODES, { query: terms || null, first: 100, after });
        for (const { discount: d } of r.discountNodes.nodes) {
          out.push([d.title, d.codes?.nodes[0]?.code ?? '', d.__typename.startsWith('DiscountAutomatic') ? 'automatic' : 'code', d.status, d.__typename.replace(/^Discount(Code|Automatic)/, '').toLowerCase(), d.startsAt, d.endsAt ?? '', d.asyncUsageCount, d.summary]);
        }
        if (!r.discountNodes.pageInfo.hasNextPage) break;
        after = r.discountNodes.pageInfo.endCursor ?? null;
      }
      downloadText('discounts.csv', toCsv(out));
    } catch (e) { toast((e as Error).message, 'critical'); } finally { setExporting(false); }
  };

  const rows = list.data?.discountNodes.nodes ?? [];
  const pi = list.data?.discountNodes.pageInfo;
  const typeKey = (d: DiscountRow) => (/FreeShipping$/.test(d.discount.__typename) ? 'discounts.type.shipping' : /Bxgy$/.test(d.discount.__typename) ? 'discounts.type.bxgy' : 'discounts.type.amount');
  const columns: Array<Column<DiscountRow>> = [
    { key: 'code', header: t('discounts.code'), cell: (d) => <div><p className="font-medium">{d.discount.codes?.nodes[0]?.code ?? d.discount.title}</p><p className="text-xs text-muted">{d.discount.summary}</p></div> },
    { key: 'status', header: t('field.status'), cell: (d) => <Badge tone={tone[d.discount.status as keyof typeof tone] ?? 'neutral'}>{t(`discounts.status.${d.discount.status}` as Key)}</Badge> },
    { key: 'method', header: t('discounts.method'), cell: (d) => t(d.discount.__typename.startsWith('DiscountAutomatic') ? 'discounts.method.automatic' : 'discounts.method.code') },
    { key: 'type', header: t('discounts.typeCol'), cell: (d) => t(typeKey(d) as Key) },
    { key: 'eligibility', header: t('discounts.eligibility'), cell: (d) => {
      const c = d.discount.context;
      return c?.segments ? c.segments.map((s) => s.name).join(', ') : c?.customers ? t('discounts.eligibility.customers', { n: c.customers.length }) : t('discount.eligibility.all');
    } },
    { key: 'tags', header: t('discounts.tags'), cell: (d) => <span className="flex flex-wrap gap-1">{(d.discount.tags ?? []).map((x) => <Badge key={x}>{x}</Badge>)}</span> },
    { key: 'combines', header: t('discounts.combines'), cell: (d) => (
      <span className="flex gap-1.5">{([['productDiscounts', Tag, 'discount.combine.product'], ['orderDiscounts', ShoppingBag, 'discount.combine.order'], ['shippingDiscounts', Truck, 'discount.combine.shipping']] as const).map(([k, Icon, label]) => (
        <Icon key={k} role="img" aria-label={`${t(label)}: ${d.discount.combinesWith?.[k] ? t('discounts.combines.yes') : t('discounts.combines.no')}`} className={`size-4 ${d.discount.combinesWith?.[k] ? 'text-fg' : 'text-muted opacity-40'}`} />
      ))}</span>) },
    { key: 'used', header: t('discounts.used'), cell: (d) => (d.discount.usageLimit ? `${d.discount.asyncUsageCount} / ${d.discount.usageLimit}` : d.discount.asyncUsageCount) },
    { key: 'dates', header: t('discounts.dates'), cell: (d) => <span className="text-muted">{fmt.date(d.discount.startsAt)}{d.discount.endsAt ? ` → ${fmt.date(d.discount.endsAt)}` : ''}</span> },
  ];
  const create = <Button variant="primary" onClick={() => setChooser(true)}><Plus className="size-4" />{t('discounts.create')}</Button>;

  return (
    <>
      <PageHeader title={t('nav.discounts')} actions={<><Button loading={exporting} onClick={() => void exportCsv()}><Download className="size-4" />{t('csv.export')}</Button>{create}</>} />
      <Card className="!p-0">
        <div className="px-3 pt-1"><Tabs tabs={TABS.map((id) => ({ id, label: t(`discounts.tab.${id}` as Key) }))} value={tab} onChange={(v) => { setSelected([]); L.patch({ tab: v === 'all' ? '' : v }); }} /></div>
        <div className="flex items-center gap-2 border-b border-line p-3">
          <div className="relative max-w-md flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-2 size-4 text-muted" />
            <input type="search" value={search} onChange={(e) => { setSearch(e.target.value); L.patch({ q: e.target.value }); }} placeholder={t('discounts.search')} aria-label={t('discounts.search')} className={searchCls} />
          </div>
          <input type="search" value={tagFilter} onChange={(e) => { setTagFilter(e.target.value); L.patch({ tag: e.target.value }); }} placeholder={t('discounts.filterTag')} aria-label={t('discounts.filterTag')} className="field-control max-w-44" />
          <ColumnPicker locked={['code']} columns={columns} hidden={cols.hidden} onToggle={cols.toggle} />
        </div>
        {list.isError && <div className="p-3"><Banner>{(list.error as Error).message}</Banner></div>}
        <IndexTable rows={rows} rowId={(r) => r.id} columns={cols.filter(columns)} loading={list.isLoading}
          selected={selected} onSelectedChange={setSelected} selectedLabel={(n) => t('common.selected', { n })} selectAllLabel={t('common.selectAll')}
          onRowClick={(r) => nav(`/discounts/${gidToNum(r.id)}`)}
          bulkActions={[
            { key: 'on', label: t('discounts.activate'), onRun: (ids) => bulk.mutate({ ids, action: 'activate' }) },
            { key: 'off', label: t('discounts.deactivate'), onRun: (ids) => bulk.mutate({ ids, action: 'deactivate' }) },
            { key: 'del', label: t('common.delete'), danger: true, onRun: setConfirm },
          ]}
          empty={list.isError ? null : terms
            ? <EmptyState icon={<Search className="size-10" />} title={t('products.noResults')} description={t('products.noResultsBody')} />
            : <EmptyState image={emptyDiscounts} title={t('discounts.emptyTitle')} description={t('discounts.emptyBody')} action={create} />} />
        <Pagination hasPrevious={L.get('before') ? !!pi?.hasPreviousPage : !!L.get('after')} hasNext={L.get('before') ? true : !!pi?.hasNextPage}
          previousLabel={t('common.previous')} nextLabel={t('common.next')}
          onPrevious={() => L.patch({ before: pi?.startCursor ?? '', after: '' }, true)} onNext={() => L.patch({ after: pi?.endCursor ?? '', before: '' }, true)} />
      </Card>
      <ConfirmDialog open={!!confirm} onClose={() => setConfirm(null)} danger title={t('discounts.deleteTitle', { n: confirm?.length ?? 0 })} message={t('discounts.deleteBody')} confirmLabel={t('common.delete')} cancelLabel={t('common.cancel')} onConfirm={() => { if (confirm) bulk.mutate({ ids: confirm, action: 'delete' }); setConfirm(null); }} />
      <Modal open={chooser} onClose={() => setChooser(false)} title={t('discounts.chooseType')} closeLabel={t('common.close')} footer={<Button onClick={() => setChooser(false)}>{t('common.cancel')}</Button>}>
        <ul className="flex flex-col gap-2">
          {([['product', Package], ['bxgy', Gift], ['order', ShoppingBag], ['shipping', Truck]] as const).map(([k, Icon]) => (
            <li key={k}>
              <button type="button" onClick={() => nav(`/discounts/new?type=${k}`)} className="flex w-full items-start gap-3 rounded-md border border-line p-3 text-left hover:bg-surface">
                <Icon className="mt-0.5 size-5 text-accent" />
                <span className="flex-1"><span className="block text-[13px] font-medium">{t(`discounts.kind.${k}` as Key)}</span><span className="block text-xs text-muted">{t(`discounts.kind.${k}.help` as Key)}</span></span>
                <ChevronRight className="mt-1 size-4 text-muted" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      </Modal>
    </>
  );
}
