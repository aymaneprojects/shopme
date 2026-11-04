import { Button, Checkbox, Modal } from '@shopme/ui';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { gql } from '../api';
import { COLLECTIONS, PRODUCTS_PICKER } from '../graphql';
import { useT } from '../i18n';
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
    <Modal open={open} onClose={close} title={t('picker.products')} closeLabel={t('common.close')} wide
      footer={<><Button onClick={close}>{t('common.cancel')}</Button><Button variant="primary" disabled={!picked.size} onClick={() => { onConfirm([...picked.values()]); close(); }}>{t('picker.add', { n: picked.size })}</Button></>}>
      <input type="search" autoFocus value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('products.search')} aria-label={t('products.search')} className="mb-3 w-full rounded-md border border-line bg-canvas px-3 py-2 text-sm" />
      {isLoading ? <p className="text-sm text-muted">{t('common.loading')}</p> : rows.length === 0 ? <p className="text-sm text-muted">{t('picker.none')}</p> : (
        <ul className="divide-y divide-line">
          {rows.map((p) => (
            <li key={p.id} className="flex items-center gap-3 py-2">
              <Checkbox checked={picked.has(p.id)} onChange={() => toggle(p)} aria-label={p.title} />
              <Thumb url={p.featuredMedia?.image?.url} className="size-8" />
              <span className="text-sm">{p.title}</span>
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
      {isLoading ? <p className="text-sm text-muted">{t('common.loading')}</p> : rows.length === 0 ? <p className="text-sm text-muted">{t('picker.noneCollections')}</p> : (
        <ul className="divide-y divide-line">
          {rows.map((c) => (
            <li key={c.id} className="py-2"><Checkbox label={c.title} checked={picked.has(c.id)} onChange={() => setPicked((m) => { const n = new Map(m); n.has(c.id) ? n.delete(c.id) : n.set(c.id, c); return n; })} /></li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
