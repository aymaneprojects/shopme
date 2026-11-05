import { Button, ConfirmDialog, Dropdown, Input, Modal, useToast } from '@shopme/ui';
import type { ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, ChevronsUpDown, Plus } from 'lucide-react';
import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { gql, mutate } from '../api';
import {
  SAVED_SEARCH_CREATE, SAVED_SEARCH_DELETE, SAVED_SEARCH_UPDATE, SAVED_VIEWS_ARTICLE, SAVED_VIEWS_CUSTOMER, SAVED_VIEWS_INVENTORY, SAVED_VIEWS_ORDER, SAVED_VIEWS_PAGE, SAVED_VIEWS_PRODUCT,
} from '../graphql';
import { useT } from '../i18n';

export type ViewResource = 'PRODUCT' | 'ORDER' | 'CUSTOMER' | 'INVENTORY' | 'PAGE' | 'ARTICLE';
export interface SavedView { id: string; name: string; query: string; params: string; resourceType: string }

const QUERIES: Record<ViewResource, string> = { PRODUCT: SAVED_VIEWS_PRODUCT, ORDER: SAVED_VIEWS_ORDER, CUSTOMER: SAVED_VIEWS_CUSTOMER, INVENTORY: SAVED_VIEWS_INVENTORY, PAGE: SAVED_VIEWS_PAGE, ARTICLE: SAVED_VIEWS_ARTICLE };
/** Parameters that are not part of a view: the saved view in use and the pagination cursors. */
const TRANSIENT = ['view', 'after', 'before'];

/** Canonical form of a list state: sorted `key=value` pairs, without the transient parameters and empty values. */
export function canonicalParams(source: URLSearchParams | string): string {
  const p = new URLSearchParams(source);
  for (const k of TRANSIENT) p.delete(k);
  return [...p.entries()].filter(([, v]) => v !== '').sort(([a, x], [b, y]) => a.localeCompare(b) || x.localeCompare(y)).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
}

export const useSavedViews = (resource: ViewResource) => useQuery({
  queryKey: ['saved-views', resource], staleTime: 30_000,
  queryFn: async () => (await gql<{ views: { nodes: SavedView[] } }>(QUERIES[resource])).views.nodes,
});

interface TabsProps<T extends string> {
  resource: ViewResource;
  /** Built-in tabs (All, Active, ...). Selecting one must also clear the `view` parameter. */
  tabs: Array<{ id: T; label: ReactNode }>;
  value: T;
  onTab: (id: T) => void;
  /** The search query of the current list state, stored with the view for API clients. */
  query: string;
}

type Dialog = { kind: 'create' | 'rename' | 'duplicate'; view?: SavedView; name: string; error?: string } | null;


/**
 * The tabs above a list: the built-in ones, then the saved views shared by all staff, then "+" to save the current
 * search, filters and sort as a new view. The active view has a menu (save changes, rename, duplicate, delete).
 */
export function ViewTabs<T extends string>({ resource, tabs, value, onTab, query }: TabsProps<T>) {
  const t = useT();
  const toast = useToast();
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const views = useSavedViews(resource);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [confirmDelete, setConfirmDelete] = useState<SavedView | null>(null);

  const list = views.data ?? [];
  const active = list.find((v) => v.id === params.get('view')) ?? null;
  const current = canonicalParams(params);
  const dirty = !!active && canonicalParams(active.params) !== current;
  const refresh = () => qc.invalidateQueries({ queryKey: ['saved-views', resource] });

  const open = (v: SavedView) => setParams(new URLSearchParams({ ...Object.fromEntries(new URLSearchParams(v.params)), view: v.id }), { replace: true });
  const useView = (v: SavedView) => open(v);

  const create = useMutation({
    mutationFn: (i: { name: string; params: string; query: string }) => mutate<{ savedSearch: SavedView }>(SAVED_SEARCH_CREATE, { input: { resourceType: resource, ...i } }, 'savedSearchCreate'),
    onSuccess: (r) => { void refresh(); toast(t('views.saved')); setDialog(null); useView(r.savedSearch); },
    onError: (e) => setDialog((d) => (d ? { ...d, error: e.message } : d)),
  });
  const update = useMutation({
    mutationFn: (i: { id: string; name?: string; params?: string; query?: string }) => mutate(SAVED_SEARCH_UPDATE, { input: i }, 'savedSearchUpdate'),
    onSuccess: () => { void refresh(); toast(t('views.updated')); setDialog(null); },
    onError: (e) => setDialog((d) => (d ? { ...d, error: e.message } : d)),
  });
  const remove = useMutation({
    mutationFn: (v: SavedView) => mutate(SAVED_SEARCH_DELETE, { input: { id: v.id } }, 'savedSearchDelete'),
    onSuccess: (_r, v) => {
      void refresh(); toast(t('views.deleted'));
      if (v.id === params.get('view')) setParams(new URLSearchParams(), { replace: true });
    },
    onError: (e) => toast(e.message, 'critical'),
  });

  const submit = () => {
    if (!dialog) return;
    const name = dialog.name.trim();
    if (!name) { setDialog({ ...dialog, error: t('views.nameRequired') }); return; }
    if (dialog.kind === 'create') create.mutate({ name, params: current, query });
    else if (dialog.kind === 'duplicate' && dialog.view) create.mutate({ name, params: dialog.view.params, query: dialog.view.query });
    else if (dialog.view) update.mutate({ id: dialog.view.id, name });
  };

  const dialogTitle = dialog?.kind === 'rename' ? t('views.rename') : dialog?.kind === 'duplicate' ? t('views.duplicate') : t('views.saveAs');
  return (
    <>
      <div className="flex items-center gap-1">
        <Dropdown variant="plain" size="sm" className="btn-neutral !font-semibold" label={t('views.tabs')}
          trigger={<>{active ? active.name : tabs.find((x) => x.id === value)?.label}<ChevronsUpDown className="size-3.5 text-muted" /></>}
          items={[
            ...tabs.map((tab) => ({ key: `tab-${tab.id}`, label: tab.label, icon: !active && value === tab.id ? <Check className="size-4" /> : undefined, onSelect: () => onTab(tab.id) })),
            ...list.map((v, i) => ({ key: v.id, label: v.name, separatorBefore: i === 0, icon: active?.id === v.id ? <Check className="size-4" /> : undefined, onSelect: () => useView(v) })),
            ...(active ? [
              { key: 'save', label: t('views.saveChanges'), disabled: !dirty, separatorBefore: true, onSelect: () => update.mutate({ id: active.id, params: current, query }) },
              { key: 'rename', label: t('views.rename'), onSelect: () => setDialog({ kind: 'rename' as const, view: active, name: active.name }) },
              { key: 'duplicate', label: t('views.duplicate'), onSelect: () => setDialog({ kind: 'duplicate' as const, view: active, name: t('views.copyOf', { name: active.name }) }) },
              { key: 'delete', label: t('common.delete'), danger: true, onSelect: () => setConfirmDelete(active) },
            ] : []),
            { key: 'add', label: t('views.add'), icon: <Plus className="size-4" />, separatorBefore: true, onSelect: () => setDialog({ kind: 'create', name: '' }) },
          ]} />
        {dirty && active && (
          <span className="flex items-center gap-1.5 pl-1">
            <Button size="sm" onClick={() => open(active)}>{t('views.discard')}</Button>
            <Button size="sm" variant="primary" loading={update.isPending} onClick={() => update.mutate({ id: active.id, params: current, query })}>{t('views.saveChanges')}</Button>
          </span>
        )}
      </div>

      <Modal open={!!dialog} onClose={() => setDialog(null)} closeLabel={t('common.close')} title={dialogTitle}
        footer={<><Button onClick={() => setDialog(null)}>{t('common.cancel')}</Button><Button variant="primary" loading={create.isPending || update.isPending} onClick={submit}>{dialog?.kind === 'rename' ? t('save.save') : t('views.save')}</Button></>}>
        {dialog && (
          <form className="grid gap-2" onSubmit={(e) => { e.preventDefault(); submit(); }}>
            <Input label={t('views.name')} autoFocus maxLength={40} value={dialog.name} error={dialog.error} onChange={(e) => setDialog({ ...dialog, name: e.target.value, error: undefined })} />
            {dialog.kind === 'create' && <p className="text-xs text-muted">{t('views.saveHelp')}</p>}
          </form>
        )}
      </Modal>
      <ConfirmDialog open={!!confirmDelete} onClose={() => setConfirmDelete(null)} danger title={t('views.deleteTitle', { name: confirmDelete?.name ?? '' })} message={t('views.deleteBody')}
        confirmLabel={t('common.delete')} cancelLabel={t('common.cancel')} onConfirm={() => { if (confirmDelete) remove.mutate(confirmDelete); setConfirmDelete(null); }} />
    </>
  );
}
