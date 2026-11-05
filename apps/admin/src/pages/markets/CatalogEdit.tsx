import { Badge, Banner, Button, Card, ConfirmDialog, Input, Pagination, Select, Skeleton, useToast } from '@shopme/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { gql, mutate } from '../../api';
import { PageHeader } from '../../components/PageHeader';
import { SaveBar, guard } from '../../components/SaveBar';
import { searchCls, useFormat } from '../../components/shared';
import { gidToNum, numToGid, parseDecimal } from '../../format';
import {
  CATALOG_CREATE, CATALOG_DELETE, CATALOG_DETAIL, CATALOG_UPDATE, PRICE_LIST_CREATE, PRICE_LIST_FIXED_ADD, PRICE_LIST_FIXED_DELETE, PRICE_LIST_PRICES, PRICE_LIST_UPDATE,
} from '../../graphql';
import { useI18n } from '../../i18n';
import { useDebounced } from '../../lib/hooks';
import type { Connection } from '../../lib/hooks';
import { errText } from './shared';
import type { CatalogRow } from './Catalogs';

interface MarketOption { id: string; name: string; primary: boolean; currencySettings: { baseCurrency: { currencyCode: string } } | null; catalogs: { nodes: Array<{ id: string }> } }
interface Detail { catalog: CatalogRow | null; markets: { nodes: MarketOption[] }; shop: { id: string; currencyCode: string } }

export function CatalogEditPage() {
  const { id = 'new' } = useParams();
  const { t } = useI18n();
  const gid = numToGid('MarketCatalog', id);
  const q = useQuery({ queryKey: ['catalog', gid], queryFn: () => gql<Detail>(CATALOG_DETAIL, { id: id === 'new' ? 'gid://shopify/MarketCatalog/0' : gid }) });
  if (q.isLoading) return <div className="grid gap-4"><Skeleton className="h-8 w-64" /><Skeleton className="h-64" /></div>;
  if (q.error) return <Banner>{q.error.message}</Banner>;
  if (id !== 'new' && !q.data?.catalog) return <Banner>{t('catalogs.notFound')}</Banner>;
  return <Editor key={q.dataUpdatedAt} data={q.data!} isNew={id === 'new'} />;
}

type Adj = 'PERCENTAGE_DECREASE' | 'PERCENTAGE_INCREASE';

function Editor({ data, isNew }: { data: Detail; isNew: boolean }) {
  const { t } = useI18n();
  const nav = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();
  const c = data.catalog;
  const pl = c?.priceList ?? null;
  const [title, setTitle] = useState(c?.title ?? '');
  const [status, setStatus] = useState<'ACTIVE' | 'DRAFT' | 'ARCHIVED'>(c?.status ?? 'DRAFT');
  const [marketId, setMarketId] = useState(c?.markets?.nodes[0]?.id ?? '');
  const [adjType, setAdjType] = useState<Adj>(pl?.parent.adjustment.type ?? 'PERCENTAGE_DECREASE');
  const [adjValue, setAdjValue] = useState(String(pl?.parent.adjustment.value ?? 0));
  const [compareAt, setCompareAt] = useState<'ADJUSTED' | 'NULLIFY'>(pl?.parent.settings.compareAtMode ?? 'ADJUSTED');
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const market = data.markets.nodes.find((m) => m.id === marketId) ?? null;
  const currency = pl?.currency ?? market?.currencySettings?.baseCurrency.currencyCode ?? data.shop.currencyCode;
  const value = parseDecimal(adjValue);
  const before = JSON.stringify([c?.title ?? '', c?.status ?? 'DRAFT', c?.markets?.nodes[0]?.id ?? '', pl?.parent.adjustment.type ?? 'PERCENTAGE_DECREASE', String(pl?.parent.adjustment.value ?? 0), pl?.parent.settings.compareAtMode ?? 'ADJUSTED']);
  const dirty = isNew ? !!title || !!marketId : JSON.stringify([title, status, marketId, adjType, adjValue, compareAt]) !== before;
  const choices = data.markets.nodes.filter((m) => !m.primary && (!m.catalogs.nodes.length || m.id === c?.markets?.nodes[0]?.id));

  const save = useMutation({
    mutationFn: async () => {
      if (!title.trim()) throw new Error(t('catalogs.titleRequired'));
      if (!marketId) throw new Error(t('catalogs.marketRequired'));
      if (value === null || value < 0) throw new Error(t('catalogs.adjustValue'));
      const parent = { adjustment: { type: adjType, value }, settings: { compareAtMode: compareAt } };
      if (c) {
        if (pl) await mutate(PRICE_LIST_UPDATE, { id: pl.id, input: { name: title.trim(), parent } }, 'priceListUpdate');
        const list = pl ? pl.id : (await mutate<{ priceList: { id: string } }>(PRICE_LIST_CREATE, { input: { name: title.trim(), currency, parent } }, 'priceListCreate')).priceList.id;
        await mutate(CATALOG_UPDATE, { id: c.id, input: { title: title.trim(), status, context: { marketIds: [marketId] }, priceListId: list } }, 'catalogUpdate');
        return c.id;
      }
      const list = (await mutate<{ priceList: { id: string } }>(PRICE_LIST_CREATE, { input: { name: title.trim(), currency, parent } }, 'priceListCreate')).priceList.id;
      const r = await mutate<{ catalog: { id: string } }>(CATALOG_CREATE, { input: { title: title.trim(), status, context: { marketIds: [marketId] }, priceListId: list } }, 'catalogCreate');
      return r.catalog.id;
    },
    onSuccess: (id) => {
      setError(null); toast(t(isNew ? 'catalogs.created' : 'catalogs.saved'));
      void qc.invalidateQueries({ queryKey: ['catalog'] }); void qc.invalidateQueries({ queryKey: ['catalogs'] }); void qc.invalidateQueries({ queryKey: ['markets'] }); void qc.invalidateQueries({ queryKey: ['market'] });
      if (isNew) { guard.off = true; nav(`/markets/catalogs/${gidToNum(id)}`, { replace: true }); }
    },
    onError: (e) => setError(errText(e)),
  });
  const remove = useMutation({
    mutationFn: () => mutate(CATALOG_DELETE, { id: c!.id, deleteDependentResources: true }, 'catalogDelete'),
    onSuccess: () => { guard.off = true; toast(t('catalogs.deleted')); void qc.invalidateQueries({ queryKey: ['catalogs'] }); void qc.invalidateQueries({ queryKey: ['market'] }); nav('/markets/catalogs'); },
    onError: (e) => toast(errText(e), 'critical'),
  });

  return (
    <>
      <SaveBar dirty={dirty} saving={save.isPending} onSave={() => save.mutate()} onDiscard={() => { setTitle(c?.title ?? ''); setStatus(c?.status ?? 'DRAFT'); setMarketId(c?.markets?.nodes[0]?.id ?? ''); setAdjType(pl?.parent.adjustment.type ?? 'PERCENTAGE_DECREASE'); setAdjValue(String(pl?.parent.adjustment.value ?? 0)); setCompareAt(pl?.parent.settings.compareAtMode ?? 'ADJUSTED'); setError(null); }} />
      <PageHeader back="/markets/catalogs" title={c?.title ?? t('catalogs.new')} more={c ? [{ key: 'delete', label: t('catalogs.delete'), danger: true, onSelect: () => setConfirmDelete(true) }] : undefined}
        actions={isNew ? <Button variant="primary" loading={save.isPending} disabled={!dirty} onClick={() => save.mutate()}>{t('save.save')}</Button> : undefined} />
      {error && <div className="mb-3"><Banner>{error}</Banner></div>}
      <div className="grid max-w-3xl gap-5">
        <Card title={t('catalogs.details')}>
          <div className="grid gap-3 sm:grid-cols-[1fr_9rem]">
            <Input label={t('catalogs.name')} value={title} onChange={(e) => setTitle(e.target.value)} />
            <Select label={t('catalogs.col.status')} value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
              <option value="ACTIVE">{t('catalogs.status.ACTIVE')}</option><option value="DRAFT">{t('catalogs.status.DRAFT')}</option><option value="ARCHIVED">{t('catalogs.status.ARCHIVED')}</option>
            </Select>
          </div>
          <div className="mt-3">
            <Select label={t('catalogs.market')} help={market ? t('catalogs.currencyIs', { currency }) : t('catalogs.marketHelp')} value={marketId} onChange={(e) => setMarketId(e.target.value)} disabled={!!pl && !!marketId && !isNew && false}>
              <option value="">{t('catalogs.chooseMarket')}</option>
              {choices.map((m) => <option key={m.id} value={m.id}>{m.name}{m.currencySettings ? ` (${m.currencySettings.baseCurrency.currencyCode})` : ''}</option>)}
            </Select>
          </div>
        </Card>

        <Card title={t('catalogs.pricing')}>
          <p className="mb-3 text-[13px] text-muted">{t('catalogs.pricingHelp')}</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Select label={t('catalogs.adjustType')} value={adjType} onChange={(e) => setAdjType(e.target.value as Adj)}>
              <option value="PERCENTAGE_DECREASE">{t('catalogs.decrease')}</option><option value="PERCENTAGE_INCREASE">{t('catalogs.increase')}</option>
            </Select>
            <Input label={t('catalogs.adjustValue')} inputMode="decimal" value={adjValue} onChange={(e) => setAdjValue(e.target.value)} error={value === null || value < 0 ? t('catalogs.adjustValue') : undefined} />
          </div>
          <fieldset className="mt-3 flex flex-col gap-1.5 text-[13px]">
            <legend className="mb-1 font-medium">{t('catalogs.compareAt')}</legend>
            <label className="flex items-center gap-2"><input type="radio" name="compare" checked={compareAt === 'ADJUSTED'} onChange={() => setCompareAt('ADJUSTED')} />{t('catalogs.compareAtAdjusted')}</label>
            <label className="flex items-center gap-2"><input type="radio" name="compare" checked={compareAt === 'NULLIFY'} onChange={() => setCompareAt('NULLIFY')} />{t('catalogs.compareAtNullify')}</label>
          </fieldset>
        </Card>

        <FixedPrices priceListId={pl?.id ?? null} currency={currency} />
      </div>
      <ConfirmDialog open={confirmDelete} title={t('catalogs.deleteTitle', { name: c?.title ?? '' })} message={t('catalogs.deleteBody')} confirmLabel={t('catalogs.delete')} cancelLabel={t('common.cancel')} closeLabel={t('common.close')} danger loading={remove.isPending}
        onConfirm={() => remove.mutate()} onClose={() => setConfirmDelete(false)} />
    </>
  );
}

interface PriceNode {
  originType: 'FIXED' | 'RELATIVE'; price: { amount: string; currencyCode: string }; compareAtPrice: { amount: string } | null;
  variant: { id: string; title: string; sku: string | null; price: string; product: { id: string; title: string } };
}

/** Fixed prices table: every variant with its price under the list; typing a price turns it into a fixed one. */
function FixedPrices({ priceListId, currency }: { priceListId: string | null; currency: string }) {
  const { t, lang } = useI18n();
  const fmt = useFormat();
  const toast = useToast();
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const term = useDebounced(search).trim();
  const [onlyFixed, setOnlyFixed] = useState(false);
  const [cursor, setCursor] = useState<{ after?: string; before?: string }>({});
  const [draft, setDraft] = useState<Record<string, string>>({});
  const size = 15;
  const q = useQuery({
    queryKey: ['price-list-prices', priceListId, term, onlyFixed, cursor.after, cursor.before], enabled: !!priceListId, placeholderData: (p) => p,
    queryFn: () => gql<{ priceList: { fixedPricesCount: number; prices: Connection<PriceNode> } | null }>(PRICE_LIST_PRICES, {
      id: priceListId, query: term || null, originType: onlyFixed ? 'FIXED' : null, ...(cursor.before ? { last: size, before: cursor.before } : { first: size, after: cursor.after ?? null }),
    }),
  });
  const refresh = () => { void qc.invalidateQueries({ queryKey: ['price-list-prices'] }); void qc.invalidateQueries({ queryKey: ['catalogs'] }); };
  const setFixed = useMutation({
    mutationFn: ({ variantId, amount }: { variantId: string; amount: string }) => mutate(PRICE_LIST_FIXED_ADD, { priceListId, prices: [{ variantId, price: { amount, currencyCode: currency } }] }, 'priceListFixedPricesAdd'),
    onSuccess: (_r, v) => { toast(t('catalogs.priceSaved')); setDraft((d) => { const n = { ...d }; delete n[v.variantId]; return n; }); refresh(); }, onError: (e) => toast(errText(e), 'critical'),
  });
  const clearFixed = useMutation({
    mutationFn: (variantId: string) => mutate(PRICE_LIST_FIXED_DELETE, { priceListId, variantIds: [variantId] }, 'priceListFixedPricesDelete'),
    onSuccess: () => { toast(t('catalogs.priceCleared')); refresh(); }, onError: (e) => toast(errText(e), 'critical'),
  });
  const money = (amount: string) => fmt.money({ amount, currencyCode: currency });
  const digits = (() => { try { return new Intl.NumberFormat(lang, { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2; } catch { return 2; } })();
  const plain = (amount: string) => Number(amount).toFixed(digits);
  const rows = q.data?.priceList?.prices.nodes ?? [];
  const pi = q.data?.priceList?.prices.pageInfo;
  const commit = (n: PriceNode) => {
    const raw = draft[n.variant.id];
    if (raw === undefined) return;
    const v = parseDecimal(raw);
    if (v === null || v < 0 || v.toFixed(digits) === plain(n.price.amount)) { setDraft((d) => { const x = { ...d }; delete x[n.variant.id]; return x; }); return; }
    setFixed.mutate({ variantId: n.variant.id, amount: v.toFixed(digits) });
  };
  return (
    <Card title={t('catalogs.fixed')}>
      <p className="mb-3 text-[13px] text-muted">{priceListId ? t('catalogs.fixedHelp') : t('catalogs.fixedSave')}</p>
      {priceListId && (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-3">
            <div className="relative min-w-48 flex-1">
              <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted" />
              <input type="search" value={search} onChange={(e) => { setSearch(e.target.value); setCursor({}); }} placeholder={t('catalogs.searchProducts')} aria-label={t('catalogs.searchProducts')} className={searchCls} />
            </div>
            <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" checked={onlyFixed} onChange={(e) => { setOnlyFixed(e.target.checked); setCursor({}); }} />{t('catalogs.onlyFixed')}</label>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead><tr className="border-b border-line text-left text-muted"><th className="py-2 pr-3 font-medium">{t('catalogs.col.product')}</th><th className="py-2 pr-3 text-right font-medium">{t('catalogs.col.base')}</th><th className="py-2 pr-3 text-right font-medium">{t('catalogs.col.price')}</th><th className="py-2 pr-3 font-medium" /></tr></thead>
              <tbody>
                {rows.map((n) => (
                  <tr key={n.variant.id} className="border-b border-line last:border-0">
                    <td className="py-2 pr-3"><span className="font-medium">{n.variant.product.title}</span>{n.variant.title !== 'Default Title' && <span className="text-muted"> · {n.variant.title}</span>}{n.variant.sku && <span className="block text-xs text-muted">{n.variant.sku}</span>}</td>
                    <td className="py-2 pr-3 text-right text-muted">{new Intl.NumberFormat(lang, { style: 'decimal', minimumFractionDigits: 2 }).format(Number(n.variant.price))}</td>
                    <td className="py-2 pr-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <Badge tone={n.originType === 'FIXED' ? 'info' : 'neutral'}>{t(n.originType === 'FIXED' ? 'catalogs.fixedBadge' : 'catalogs.adjustedBadge')}</Badge>
                        <input aria-label={`${t('catalogs.col.price')} ${n.variant.product.title}`} inputMode="decimal" className="field-control w-28 text-right" value={draft[n.variant.id] ?? plain(n.price.amount)} onChange={(e) => setDraft((d) => ({ ...d, [n.variant.id]: e.target.value }))}
                          onBlur={() => commit(n)} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
                        <span className="w-10 text-left text-xs text-muted">{n.price.currencyCode}</span>
                      </div>
                      {n.compareAtPrice && <p className="mr-12 text-xs text-muted line-through">{money(n.compareAtPrice.amount)}</p>}
                    </td>
                    <td className="py-2 text-right">{n.originType === 'FIXED' && <Button size="sm" variant="plain" onClick={() => clearFixed.mutate(n.variant.id)}>{t('catalogs.clearFixed')}</Button>}</td>
                  </tr>
                ))}
                {!rows.length && !q.isLoading && <tr><td colSpan={4} className="py-6 text-center text-muted">{t('catalogs.noPrices')}</td></tr>}
              </tbody>
            </table>
          </div>
          <Pagination hasPrevious={cursor.before ? !!pi?.hasPreviousPage : !!cursor.after} hasNext={cursor.before ? true : !!pi?.hasNextPage} previousLabel={t('common.previous')} nextLabel={t('common.next')}
            onPrevious={() => setCursor({ before: pi?.startCursor ?? undefined })} onNext={() => setCursor({ after: pi?.endCursor ?? undefined })} />
        </>
      )}
    </Card>
  );
}
