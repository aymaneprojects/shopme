import { Button, Checkbox, Modal } from '@shopme/ui';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Search } from 'lucide-react';
import { Fragment, useState } from 'react';
import { gql } from '../api';
import { COLLECTIONS, DRAFT_VARIANT_SEARCH, PRODUCTS_PICKER } from '../graphql';
import { useT } from '../i18n';
import { useShop } from '../session';
import { useFormat } from './shared';
import { useDebounced } from '../lib/hooks';
import { Thumb } from '../pages/Products';

export interface PickedProduct { id: string; title: string; status?: string; featuredMedia?: { image?: { url: string } } | null }
export interface PickedCollection { id: string; title: string; ruleSet?: unknown }

/** Searchable multi-select of products. */
export function ProductPicker({ open, onClose, onConfirm, excludeIds = [] }: { open: boolean; onClose: () => void; onConfirm: (p: PickedProduct[]) => void; excludeIds?: string[] }) {
  const t = useT();
  const [search, setSearch] = useState('');
  const [picked, setPicked] = useState<Map<string, PickedProduct>>(new Map());
  const term = useDebounced(search);
  const { data, isLoading } = useQuery({
    queryKey: ['picker-products', term], enabled: open,
    queryFn: () => gql<{ products: { nodes: PickedProduct[] } }>(PRODUCTS_PICKER, { first: 30, query: term.trim() || null }),
  });
  const rows = (data?.products.nodes ?? []).filter((p) => !excludeIds.includes(p.id));
  const toggle = (p: PickedProduct) => setPicked((m) => { const n = new Map(m); n.has(p.id) ? n.delete(p.id) : n.set(p.id, p); return n; });
  const close = () => { setPicked(new Map()); setSearch(''); onClose(); };
  return (
    <Modal open={open} onClose={close} title={t('picker.products')} closeLabel={t('common.close')} wide footerStart={t('picker.selected', { n: picked.size, $count: picked.size })}
      footer={<><Button onClick={close}>{t('common.cancel')}</Button><Button variant="primary" disabled={!picked.size} onClick={() => { onConfirm([...picked.values()]); close(); }}>{t('picker.add', { n: picked.size })}</Button></>}>
      <input type="search" autoFocus value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('products.search')} aria-label={t('products.search')} className="mb-3 w-full field-control" />
      {isLoading ? <p className="text-[13px] text-muted">{t('common.loading')}</p> : rows.length === 0 ? <p className="text-[13px] text-muted">{t('picker.none')}</p> : (
        <ul className="divide-y divide-line">
          {rows.map((p) => (
            <li key={p.id} className="flex items-center gap-3 py-2">
              <Checkbox checked={picked.has(p.id)} onChange={() => toggle(p)} aria-label={p.title} />
              <Thumb url={p.featuredMedia?.image?.url} className="size-8" />
              <span className="text-[13px]">{p.title}</span>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}

/** Multi-select of manual collections (automated collections are not selectable). */
export function CollectionPicker({ open, onClose, onConfirm, excludeIds = [] }: { open: boolean; onClose: () => void; onConfirm: (c: PickedCollection[]) => void; excludeIds?: string[] }) {
  const t = useT();
  const [picked, setPicked] = useState<Map<string, PickedCollection>>(new Map());
  const { data, isLoading } = useQuery({ queryKey: ['picker-collections'], enabled: open, queryFn: () => gql<{ collections: { nodes: PickedCollection[] } }>(COLLECTIONS, { first: 100 }) });
  const rows = (data?.collections.nodes ?? []).filter((c) => !c.ruleSet && !excludeIds.includes(c.id));
  const close = () => { setPicked(new Map()); onClose(); };
  return (
    <Modal open={open} onClose={close} title={t('picker.collections')} closeLabel={t('common.close')}
      footer={<><Button onClick={close}>{t('common.cancel')}</Button><Button variant="primary" disabled={!picked.size} onClick={() => { onConfirm([...picked.values()]); close(); }}>{t('picker.add', { n: picked.size })}</Button></>}>
      {isLoading ? <p className="text-[13px] text-muted">{t('common.loading')}</p> : rows.length === 0 ? <p className="text-[13px] text-muted">{t('picker.noneCollections')}</p> : (
        <ul className="divide-y divide-line">
          {rows.map((c) => (
            <li key={c.id} className="py-2"><Checkbox label={c.title} checked={picked.has(c.id)} onChange={() => setPicked((m) => { const n = new Map(m); n.has(c.id) ? n.delete(c.id) : n.set(c.id, c); return n; })} /></li>
          ))}
        </ul>
      )}
    </Modal>
  );
}

export interface PickedVariant { variantId: string; productTitle: string; variantTitle: string; price: string }
interface VariantProduct { id: string; title: string; featuredMedia?: { image?: { url: string } } | null; variants: { nodes: Array<{ id: string; title: string; price: string; inventoryQuantity: number | null; inventoryItem: { tracked: boolean } | null }> } }

/** Browse-products dialog: search, one row per product with its variants underneath (checkboxes, available stock, price) and a selected count. */
export function VariantPicker({ open, onClose, onConfirm, excludeVariantIds = [] }: { open: boolean; onClose: () => void; onConfirm: (v: PickedVariant[]) => void; excludeVariantIds?: string[] }) {
  const t = useT();
  const fmt = useFormat();
  const cur = useShop().shop.currency;
  const [search, setSearch] = useState('');
  const [picked, setPicked] = useState<Map<string, PickedVariant>>(new Map());
  const term = useDebounced(search).trim();
  const { data, isLoading } = useQuery({ queryKey: ['picker-variants', term], enabled: open, queryFn: () => gql<{ products: { nodes: VariantProduct[] } }>(DRAFT_VARIANT_SEARCH, { query: term || null }) });
  const products = data?.products.nodes ?? [];
  const pick = (p: VariantProduct, v: VariantProduct['variants']['nodes'][number]): PickedVariant => ({ variantId: v.id, productTitle: p.title, variantTitle: v.title, price: v.price });
  const toggle = (p: VariantProduct, v: VariantProduct['variants']['nodes'][number]) => setPicked((m) => { const n = new Map(m); n.has(v.id) ? n.delete(v.id) : n.set(v.id, pick(p, v)); return n; });
  const toggleProduct = (p: VariantProduct) => setPicked((m) => {
    const n = new Map(m); const free = p.variants.nodes.filter((v) => !excludeVariantIds.includes(v.id));
    if (free.every((v) => n.has(v.id))) free.forEach((v) => n.delete(v.id)); else free.forEach((v) => n.set(v.id, pick(p, v)));
    return n;
  });
  const close = () => { setPicked(new Map()); setSearch(''); onClose(); };
  const hasOptions = (p: VariantProduct) => p.variants.nodes.length > 1 || p.variants.nodes[0]?.title !== 'Default Title';
  return (
    <Modal open={open} onClose={close} title={t('picker.addProducts')} closeLabel={t('common.close')} wide footerStart={t('picker.selected', { n: picked.size, $count: picked.size })}
      footer={<><Button onClick={close}>{t('picker.close')}</Button><Button variant="primary" disabled={!picked.size} onClick={() => { onConfirm([...picked.values()]); close(); }}>{t('picker.done')}</Button></>}>
      <div className="relative mb-3">
        <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted" />
        <input type="search" autoFocus value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('picker.searchProducts')} aria-label={t('picker.searchProducts')} className="field-control w-full !pl-8" />
      </div>
      {isLoading ? <p className="text-[13px] text-muted">{t('common.loading')}</p> : products.length === 0 ? <p className="text-[13px] text-muted">{t('picker.none')}</p> : (
        <table className="w-full text-left text-[13px]">
          <thead className="text-xs text-muted"><tr className="h-8 border-b border-line"><th className="w-8" /><th className="font-semibold">{t('picker.product')}</th><th className="px-2 text-right font-semibold">{t('picker.available')}</th><th className="px-2 text-right font-semibold">{t('picker.price')}</th></tr></thead>
          <tbody>
            {products.map((p) => {
              const vs = p.variants.nodes;
              const free = vs.filter((v) => !excludeVariantIds.includes(v.id));
              const all = free.length > 0 && free.every((v) => picked.has(v.id));
              return (
                <Fragment key={p.id}>
                  <tr className="border-b border-line">
                    <td className="py-2"><Checkbox aria-label={p.title} checked={all} disabled={!free.length} onChange={() => toggleProduct(p)} /></td>
                    <td className="py-2" colSpan={hasOptions(p) ? 3 : 1}><span className="flex items-center gap-3"><Thumb url={p.featuredMedia?.image?.url} />{p.title}</span></td>
                    {!hasOptions(p) && <><td className="px-2 text-right">{vs[0] && <Stock v={vs[0]} />}</td><td className="px-2 text-right">{vs[0] && fmt.money({ amount: vs[0].price, currencyCode: cur })}</td></>}
                  </tr>
                  {hasOptions(p) && vs.map((v) => {
                    const taken = excludeVariantIds.includes(v.id);
                    return (
                      <tr key={v.id} className="border-b border-line last:border-0">
                        <td className="py-2 pl-5"><Checkbox aria-label={`${p.title} ${v.title}`} checked={taken || picked.has(v.id)} disabled={taken} onChange={() => toggle(p, v)} /></td>
                        <td className="py-2 pl-2">{v.title}{taken && <span className="block text-xs text-warning">{t('picker.alreadyIn')}</span>}</td>
                        <td className="px-2 text-right"><Stock v={v} /></td>
                        <td className="px-2 text-right">{fmt.money({ amount: v.price, currencyCode: cur })}</td>
                      </tr>
                    );
                  })}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      )}
    </Modal>
  );
}

function Stock({ v }: { v: { inventoryQuantity: number | null; inventoryItem: { tracked: boolean } | null } }) {
  const t = useT();
  if (!v.inventoryItem?.tracked) return <span className="text-muted">{t('picker.notTracked')}</span>;
  const n = v.inventoryQuantity ?? 0;
  return <span className="inline-flex items-center gap-1">{n <= 0 && <AlertTriangle className="size-3.5 text-warning" aria-hidden />}{n}</span>;
}
