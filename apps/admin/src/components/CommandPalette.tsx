import { Badge, cx } from '@shopme/ui';
import { useQuery } from '@tanstack/react-query';
import { CornerDownLeft, FileText, Search, Settings, ShoppingCart, Tag, Users } from 'lucide-react';
import type { ComponentType } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { gql } from '../api';
import { CUSTOMERS, ORDERS, PRODUCTS } from '../graphql';
import { useI18n } from '../i18n';
import type { Key } from '../i18n';
import { useDebounced } from '../lib/hooks';
import type { Connection } from '../lib/hooks';

interface Entry { id: string; label: string; to: string; group: Key; icon: ComponentType<{ className?: string }>; hint?: string }

const PAGES: Array<{ key: Key; to: string; icon: ComponentType<{ className?: string }>; group?: Key }> = [
  { key: 'nav.home', to: '/', icon: FileText }, { key: 'nav.orders', to: '/orders', icon: ShoppingCart }, { key: 'nav.drafts', to: '/orders/drafts', icon: ShoppingCart },
  { key: 'nav.products', to: '/products', icon: Tag }, { key: 'nav.collections', to: '/collections', icon: Tag }, { key: 'nav.inventory', to: '/inventory', icon: Tag },
  { key: 'nav.customers', to: '/customers', icon: Users }, { key: 'nav.discounts', to: '/discounts', icon: Tag }, { key: 'nav.onlineStore', to: '/online-store', icon: FileText },
  { key: 'settings.general', to: '/settings/general', icon: Settings, group: 'cmd.settings' }, { key: 'settings.payments', to: '/settings/payments', icon: Settings, group: 'cmd.settings' },
  { key: 'settings.shipping', to: '/settings/shipping', icon: Settings, group: 'cmd.settings' }, { key: 'settings.taxes', to: '/settings/taxes', icon: Settings, group: 'cmd.settings' },
  { key: 'settings.domains', to: '/settings/domains', icon: Settings, group: 'cmd.settings' }, { key: 'settings.languages', to: '/settings/languages', icon: Settings, group: 'cmd.settings' },
  { key: 'settings.users', to: '/settings/users', icon: Settings, group: 'cmd.settings' }, { key: 'settings.notifications', to: '/settings/notifications', icon: Settings, group: 'cmd.settings' },
  { key: 'settings.policies', to: '/settings/policies', icon: Settings, group: 'cmd.settings' }, { key: 'settings.webhooks', to: '/settings/webhooks', icon: Settings, group: 'cmd.settings' },
];

function useRemote<T extends { id: string }>(doc: string, root: string, term: string) {
  return useQuery({
    queryKey: ['palette', root, term], enabled: term.length >= 2, staleTime: 30_000,
    queryFn: async () => (await gql<Record<string, Connection<T>>>(doc, { first: 5, query: term }))[root]!.nodes,
  }).data ?? [];
}

/** Ctrl/Cmd+K palette: jump to a page, or search products, orders and customers with the existing list queries. */
export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useI18n();
  const nav = useNavigate();
  const ref = useRef<HTMLDialogElement>(null);
  const [text, setText] = useState('');
  const [active, setActive] = useState(0);
  const term = useDebounced(text, 200).trim();
  const products = useRemote<{ id: string; title: string; status: string }>(PRODUCTS, 'products', open ? term : '');
  const orders = useRemote<{ id: string; name: string; displayFinancialStatus: string }>(ORDERS, 'orders', open ? term : '');
  const customers = useRemote<{ id: string; displayName: string }>(CUSTOMERS, 'customers', open ? term : '');

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) { d.showModal(); setText(''); setActive(0); }
    if (!open && d.open) d.close();
  }, [open]);

  const entries = useMemo<Entry[]>(() => {
    const q = text.trim().toLowerCase();
    const pages = PAGES.map((p) => ({ id: p.to, label: t(p.key), to: p.to, group: (p.group ?? 'cmd.pages') as Key, icon: p.icon }))
      .filter((p) => !q || p.label.toLowerCase().includes(q));
    const id = (gid: string) => encodeURIComponent(gid.split('/').pop() ?? gid);
    return [
      ...pages,
      ...products.map((p) => ({ id: p.id, label: p.title, to: `/products/${id(p.id)}`, group: 'cmd.products' as Key, icon: Tag, hint: p.status })),
      ...orders.map((o) => ({ id: o.id, label: o.name, to: `/orders/${id(o.id)}`, group: 'cmd.orders' as Key, icon: ShoppingCart, hint: o.displayFinancialStatus })),
      ...customers.map((c) => ({ id: c.id, label: c.displayName, to: `/customers/${id(c.id)}`, group: 'cmd.customers' as Key, icon: Users })),
    ];
  }, [text, t, products, orders, customers]);

  useEffect(() => setActive(0), [text]);
  useEffect(() => { ref.current?.querySelector(`[data-idx="${active}"]`)?.scrollIntoView({ block: 'nearest' }); }, [active]);

  const go = (e: Entry) => { onClose(); void nav(e.to); };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, entries.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    else if (e.key === 'Enter' && entries[active]) { e.preventDefault(); go(entries[active]!); }
  };

  let last: Key | null = null;
  return (
    <dialog ref={ref} onClose={onClose} onClick={(e) => e.target === ref.current && onClose()} aria-label={t('shell.search')}
      className="modal mx-auto mt-[12vh] w-[calc(100%-2rem)] max-w-xl rounded-xl border-0 bg-canvas p-0 text-fg shadow-pop">
      {open && (
        <div onKeyDown={onKey}>
          <div className="flex items-center gap-2 border-b border-line px-3">
            <Search className="size-4 shrink-0 text-muted" />
            <input autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder={t('cmd.placeholder')} aria-label={t('shell.search')} role="combobox" aria-expanded aria-controls="cmd-list" aria-activedescendant={`cmd-${active}`}
              className="h-12 w-full bg-transparent text-[13px] placeholder:text-muted focus:outline-none" />
            <kbd className="rounded border border-line px-1.5 py-0.5 text-[11px] text-muted">Esc</kbd>
          </div>
          <ul id="cmd-list" role="listbox" className="max-h-[50vh] overflow-y-auto p-1.5">
            {entries.length === 0 && <li className="px-3 py-8 text-center text-[13px] text-muted">{t('cmd.empty')}</li>}
            {entries.map((e, i) => {
              const head = e.group !== last ? (last = e.group) : null;
              return (
                <li key={e.group + e.id} role="presentation">
                  {head && <div className="px-2.5 pb-1 pt-2 text-xs font-semibold text-muted">{t(head)}</div>}
                  <div role="option" id={`cmd-${i}`} data-idx={i} aria-selected={i === active} onMouseMove={() => setActive(i)} onClick={() => go(e)}
                    className={cx('flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px]', i === active && 'bg-hover')}>
                    <e.icon className="size-4 text-muted" />
                    <span className="min-w-0 flex-1 truncate">{e.label}</span>
                    {e.hint && <Badge>{e.hint}</Badge>}
                    {i === active && <CornerDownLeft className="size-3.5 text-muted" aria-hidden />}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </dialog>
  );
}
