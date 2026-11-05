import { Badge, Checkbox, cx } from '@shopme/ui';
import { useQuery } from '@tanstack/react-query';
import { Clock, CornerDownLeft, FileText, ListFilter, Search, Settings, ShoppingCart, Tag, Users } from 'lucide-react';
import type { ComponentType } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { gql } from '../api';
import { CUSTOMERS, ORDERS, PRODUCTS } from '../graphql';
import { useI18n } from '../i18n';
import type { Key } from '../i18n';
import { useDebounced } from '../lib/hooks';
import type { Connection } from '../lib/hooks';
import { useShop } from '../session';

type Scope = 'customers' | 'orders' | 'products' | 'pages';
interface Entry { id: string; label: string; to: string; group: Key; icon: ComponentType<{ className?: string }>; hint?: string }

const PAGES: Array<{ key: Key; to: string; icon: ComponentType<{ className?: string }>; group?: Key }> = [
  { key: 'nav.home', to: '/', icon: FileText }, { key: 'nav.orders', to: '/orders', icon: ShoppingCart }, { key: 'nav.drafts', to: '/orders/drafts', icon: ShoppingCart },
  { key: 'nav.products', to: '/products', icon: Tag }, { key: 'nav.collections', to: '/collections', icon: Tag }, { key: 'nav.inventory', to: '/inventory', icon: Tag },
  { key: 'nav.customers', to: '/customers', icon: Users }, { key: 'nav.discounts', to: '/discounts', icon: Tag }, { key: 'nav.onlineStore', to: '/online-store', icon: FileText },
  { key: 'settings.general', to: '/settings/general', icon: Settings, group: 'cmd.settings' }, { key: 'settings.payments', to: '/settings/payments', icon: Settings, group: 'cmd.settings' },
  { key: 'settings.checkout', to: '/settings/checkout', icon: Settings, group: 'cmd.settings' },
  { key: 'settings.accounts', to: '/settings/accounts', icon: Settings, group: 'cmd.settings' }, { key: 'settings.privacy', to: '/settings/privacy', icon: Settings, group: 'cmd.settings' }, { key: 'settings.events', to: '/settings/events', icon: Settings, group: 'cmd.settings' },
  { key: 'settings.shipping', to: '/settings/shipping', icon: Settings, group: 'cmd.settings' }, { key: 'settings.taxes', to: '/settings/taxes', icon: Settings, group: 'cmd.settings' },
  { key: 'settings.domains', to: '/settings/domains', icon: Settings, group: 'cmd.settings' }, { key: 'settings.languages', to: '/settings/languages', icon: Settings, group: 'cmd.settings' },
  { key: 'settings.users', to: '/settings/users', icon: Settings, group: 'cmd.settings' }, { key: 'settings.notifications', to: '/settings/notifications', icon: Settings, group: 'cmd.settings' },
  { key: 'settings.policies', to: '/settings/policies', icon: Settings, group: 'cmd.settings' }, { key: 'settings.webhooks', to: '/settings/webhooks', icon: Settings, group: 'cmd.settings' },
];
const SCOPES: Array<{ id: Scope; key: Key }> = [{ id: 'customers', key: 'cmd.customers' }, { id: 'orders', key: 'cmd.orders' }, { id: 'products', key: 'cmd.products' }, { id: 'pages', key: 'cmd.pages' }];

const RECENT_KEY = 'shopme.recentSearches';
const readRecent = (): string[] => { try { const v = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]'); return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(0, 5) : []; } catch { return []; } };
const saveRecent = (term: string) => { try { localStorage.setItem(RECENT_KEY, JSON.stringify([term, ...readRecent().filter((x) => x !== term)].slice(0, 5))); } catch { /* storage unavailable */ } };

function useRemote<T extends { id: string }>(doc: string, root: string, term: string, on: boolean) {
  return useQuery({
    queryKey: ['palette', root, term], enabled: on && term.length >= 2, staleTime: 30_000,
    queryFn: async () => (await gql<Record<string, Connection<T>>>(doc, { first: 5, query: term }))[root]!.nodes,
  }).data ?? [];
}

/** Ctrl/Cmd+K search: filter chips by type, grouped results, recent searches, Enter to open. */
export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useI18n();
  const { shop } = useShop();
  const nav = useNavigate();
  const ref = useRef<HTMLDialogElement>(null);
  const [text, setText] = useState('');
  const [scope, setScope] = useState<Scope | null>(null);
  const [recent, setRecent] = useState<string[]>([]);
  const [active, setActive] = useState(0);
  const [refine, setRefine] = useState(false);
  const [hidden, setHidden] = useState<Scope[]>([]); // result types switched off with the filter button
  const on = (s: Scope) => (!scope || scope === s) && !hidden.includes(s);
  const term = useDebounced(text, 200).trim();
  const live = (s: Scope) => open && on(s);
  const products = useRemote<{ id: string; title: string; status: string }>(PRODUCTS, 'products', term, live('products'));
  const orders = useRemote<{ id: string; name: string; displayFinancialStatus: string }>(ORDERS, 'orders', term, live('orders'));
  const customers = useRemote<{ id: string; displayName: string }>(CUSTOMERS, 'customers', term, live('customers'));

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) { d.showModal(); setText(''); setScope(null); setActive(0); setRecent(readRecent()); setRefine(false); }
    if (!open && d.open) d.close();
  }, [open]);

  const q = text.trim().toLowerCase();
  const entries = useMemo<Entry[]>(() => {
    const showPages = !hidden.includes('pages') && (scope === 'pages' || (!scope && !!q));
    const pages = showPages ? PAGES.map((p) => ({ id: p.to, label: t(p.key), to: p.to, group: (p.group ?? 'cmd.pages') as Key, icon: p.icon })).filter((p) => !q || p.label.toLowerCase().includes(q)) : [];
    const id = (gid: string) => encodeURIComponent(gid.split('/').pop() ?? gid);
    return [
      ...(on('customers') ? customers.map((c) => ({ id: c.id, label: c.displayName, to: `/customers/${id(c.id)}`, group: 'cmd.customers' as Key, icon: Users })) : []),
      ...(on('orders') ? orders.map((o) => ({ id: o.id, label: o.name, to: `/orders/${id(o.id)}`, group: 'cmd.orders' as Key, icon: ShoppingCart, hint: o.displayFinancialStatus })) : []),
      ...(on('products') ? products.map((p) => ({ id: p.id, label: p.title, to: `/products/${id(p.id)}`, group: 'cmd.products' as Key, icon: Tag, hint: p.status })) : []),
      ...pages,
    ];
  }, [q, t, scope, hidden, products, orders, customers]); // eslint-disable-line react-hooks/exhaustive-deps
  const idle = !q && !scope;

  useEffect(() => setActive(0), [text, scope]);
  useEffect(() => { ref.current?.querySelector(`[data-idx="${active}"]`)?.scrollIntoView({ block: 'nearest' }); }, [active]);

  const go = (e: Entry) => { if (q.length >= 2) saveRecent(text.trim()); onClose(); void nav(e.to); };
  const onKey = (e: React.KeyboardEvent) => {
    const count = idle ? recent.length : entries.length;
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, count - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      if (idle) { const r = recent[active]; if (r) setText(r); } else if (entries[active]) go(entries[active]!);
    } else if (e.key === 'Backspace' && !text && scope) setScope(null);
  };

  let last: Key | null = null;
  const hasSelection = idle ? !!recent[active] : !!entries[active];
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
          <div className="flex flex-wrap gap-1.5 border-b border-line px-3 py-2" role="group" aria-label={t('cmd.filters')}>
            {SCOPES.map((s) => (
              <button key={s.id} type="button" aria-pressed={scope === s.id} onClick={() => setScope(scope === s.id ? null : s.id)}
                className={cx('rounded-lg px-2.5 py-1 text-xs font-medium transition-colors', scope === s.id ? 'bg-primary text-white' : 'bg-surface text-fg hover:bg-hover')}>{t(s.key)}</button>
            ))}
            <button type="button" aria-label={t('btn.cmd.refine')} title={t('btn.cmd.refine')} aria-expanded={refine} aria-pressed={refine || hidden.length > 0} onClick={() => setRefine(!refine)}
              className={cx('ml-auto grid size-7 place-items-center rounded-lg transition-colors hover:bg-hover', (refine || hidden.length > 0) ? 'bg-hover text-fg' : 'text-muted')}><ListFilter className="size-4" /></button>
          </div>
          {refine && (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-line bg-surface px-3 py-2 text-xs" role="group" aria-label={t('btn.cmd.include')}>
              <span className="font-semibold text-muted">{t('btn.cmd.include')}</span>
              {SCOPES.map((s) => <Checkbox key={s.id} label={t(s.key)} checked={!hidden.includes(s.id)} onChange={() => setHidden(hidden.includes(s.id) ? hidden.filter((x) => x !== s.id) : [...hidden, s.id])} />)}
            </div>
          )}
          <ul id="cmd-list" role="listbox" className="h-[18rem] overflow-y-auto p-1.5">
            {idle && !recent.length && <li className="grid h-full place-items-center px-3 text-center text-[13px]">{t('cmd.searchIn', { shop: shop.name })}</li>}
            {idle && recent.length > 0 && (
              <>
                <li role="presentation" className="px-2.5 pb-1 pt-2 text-xs font-semibold text-muted">{t('cmd.recent')}</li>
                {recent.map((r, i) => (
                  <li key={r} role="option" id={`cmd-${i}`} data-idx={i} aria-selected={i === active} onMouseMove={() => setActive(i)} onClick={() => setText(r)}
                    className={cx('flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px]', i === active && 'bg-hover')}><Clock className="size-4 text-muted" /><span className="flex-1 truncate">{r}</span></li>
                ))}
              </>
            )}
            {!idle && entries.length === 0 && <li className="grid h-full place-items-center px-3 text-center text-[13px] text-muted">{q.length < 2 && scope !== 'pages' ? t('cmd.hint') : t('cmd.empty')}</li>}
            {!idle && entries.map((e, i) => {
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
          <div className="flex items-center justify-end gap-2 border-t border-line px-3 py-2 text-xs text-muted" aria-hidden={!hasSelection}>
            <span>{t('cmd.open')}</span><kbd className="rounded border border-line px-1.5 py-0.5"><CornerDownLeft className="size-3" /></kbd>
          </div>
        </div>
      )}
    </dialog>
  );
}
