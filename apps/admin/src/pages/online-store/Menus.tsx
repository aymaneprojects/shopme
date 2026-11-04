import { Banner, Button, Card, ConfirmDialog, Input, Modal, Select, Skeleton, useToast } from '@shopme/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { UserErrors, gql, mutate } from '../../api';
import { SaveBar } from '../../components/SaveBar';
import { COLLECTIONS, MENUS, MENU_CREATE, MENU_DELETE, MENU_UPDATE, PAGES, PRODUCTS_PICKER } from '../../graphql';
import { useI18n } from '../../i18n';
import type { Key } from '../../i18n';
import { useDebounced } from '../../lib/hooks';
import * as tree from '../../lib/menu-tree';
import type { LinkType, MenuItem, Path } from '../../lib/menu-tree';

interface ApiItem { id: string; title: string; type: string; url: string | null; resourceId: string | null; items?: ApiItem[] }
interface ApiMenu { id: string; title: string; handle: string; isDefault?: boolean; items: ApiItem[] }
const fromApi = (items: ApiItem[] = []): MenuItem[] => items.map((i) => ({ id: i.id, title: i.title, type: (['PRODUCT', 'COLLECTION', 'PAGE'].includes(i.type) ? i.type : 'HTTP') as LinkType, url: i.url ?? '', resourceId: i.resourceId, items: fromApi(i.items) }));
const slug = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export function MenusPage() {
  const { t } = useI18n();
  const q = useQuery({ queryKey: ['menus'], queryFn: () => gql<{ menus: { nodes: ApiMenu[] } }>(MENUS) });
  const [sel, setSel] = useState<string>('');
  if (q.isLoading) return <Skeleton className="h-64" />;
  if (q.error) return <Banner>{q.error.message}</Banner>;
  const menus = q.data!.menus.nodes;
  const current = sel === 'new' ? null : menus.find((m) => m.id === sel) ?? menus[0] ?? null;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-2">
        <Select label={t('menus.menu')} value={current?.id ?? 'new'} onChange={(e) => setSel(e.target.value)}>
          {menus.map((m) => <option key={m.id} value={m.id}>{m.title}</option>)}<option value="new">{t('menus.new')}</option>
        </Select>
      </div>
      <MenuEditor key={`${current?.id ?? 'new'}:${q.dataUpdatedAt}`} menu={current} onCreated={(id) => setSel(id)} />
    </div>
  );
}

function MenuEditor({ menu, onCreated }: { menu: ApiMenu | null; onCreated: (id: string) => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const qc = useQueryClient();
  const initial = { title: menu?.title ?? '', items: fromApi(menu?.items) };
  const [title, setTitle] = useState(initial.title);
  const [items, setItems] = useState(initial.items);
  const [picker, setPicker] = useState<Path | null>(null); // parent path to add into
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const dirty = title !== initial.title || JSON.stringify(items) !== JSON.stringify(initial.items);
  const refresh = () => qc.invalidateQueries({ queryKey: ['menus'] });
  const save = useMutation({
    mutationFn: async () => {
      if (!title.trim()) throw new Error(t('menus.titleRequired'));
      if (items.some(function bad(i: MenuItem): boolean { return !i.title.trim() || i.items.some(bad); })) throw new Error(t('menus.itemTitleRequired'));
      if (menu) { await mutate(MENU_UPDATE, { id: menu.id, title: title.trim(), items: tree.toInput(items, true) }, 'menuUpdate'); return menu.id; }
      return (await mutate<{ menu: { id: string } }>(MENU_CREATE, { title: title.trim(), handle: slug(title) || 'menu', items: tree.toInput(items, false) }, 'menuCreate')).menu.id;
    },
    onSuccess: (id) => { toast(t('menus.saved')); setError(null); void refresh().then(() => onCreated(id)); },
    onError: (e) => setError(e instanceof UserErrors ? e.errors.map((x) => x.message).join(' · ') : e.message),
  });
  const del = useMutation({ mutationFn: () => mutate(MENU_DELETE, { id: menu!.id }, 'menuDelete'), onSuccess: () => { void refresh().then(() => onCreated('')); }, onError: (e) => toast(e.message, 'critical') });

  const rows: Array<{ item: MenuItem; path: Path }> = [];
  (function walk(list: MenuItem[], base: Path) { list.forEach((it, i) => { rows.push({ item: it, path: [...base, i] }); walk(it.items, [...base, i]); }); })(items, []);
  const icon = (label: string, I: typeof ArrowUp, on: boolean, fn: () => void) => <button type="button" aria-label={label} disabled={!on} onClick={fn} className="rounded p-1 hover:bg-surface disabled:opacity-30"><I className="size-4" /></button>;

  return (
    <>
      <SaveBar dirty={dirty} saving={save.isPending} onSave={() => save.mutate()} onDiscard={() => { setTitle(initial.title); setItems(initial.items); setError(null); }} />
      {error && <Banner>{error}</Banner>}
      <Card title={t('menus.items')} actions={<span className="flex gap-2">{!menu && <Button size="sm" variant="primary" loading={save.isPending} onClick={() => save.mutate()}>{t('save.save')}</Button>}{menu && !menu.isDefault && <Button size="sm" variant="danger" onClick={() => setConfirm(true)}>{t('common.delete')}</Button>}</span>}>
        <Input className="mb-4 max-w-sm" label={t('field.title')} value={title} onChange={(e) => setTitle(e.target.value)} />
        {rows.length === 0 && <p className="mb-3 text-sm text-muted">{t('menus.empty')}</p>}
        <ul className="flex flex-col gap-2">
          {rows.map(({ item, path }) => (
            <li key={path.join('.')} style={{ marginLeft: `${(path.length - 1) * 1.5}rem` }} className="flex flex-wrap items-center gap-2 rounded-md border border-line p-2">
              <input aria-label={t('menus.itemTitle')} value={item.title} onChange={(e) => setItems(tree.updateItem(items, path, { title: e.target.value }))} className="min-w-32 flex-1 rounded-md border border-line bg-canvas px-2 py-1 text-sm" />
              {item.type === 'HTTP'
                ? <input aria-label="URL" value={item.url} onChange={(e) => setItems(tree.updateItem(items, path, { url: e.target.value }))} className="min-w-32 flex-1 rounded-md border border-line bg-canvas px-2 py-1 text-sm" />
                : <span className="text-xs text-muted">{t(`menus.type.${item.type}` as Key)}</span>}
              {icon(t('menus.up'), ArrowUp, tree.canMoveUp(path), () => setItems(tree.moveUp(items, path)))}
              {icon(t('menus.down'), ArrowDown, tree.canMoveDown(items, path), () => setItems(tree.moveDown(items, path)))}
              {icon(t('menus.indent'), ArrowRight, tree.canIndent(items, path), () => setItems(tree.indent(items, path)))}
              {icon(t('menus.outdent'), ArrowLeft, tree.canOutdent(path), () => setItems(tree.outdent(items, path)))}
              {icon(t('common.remove'), Trash2, true, () => setItems(tree.removeItem(items, path)))}
            </li>
          ))}
        </ul>
        <div className="mt-3"><Button size="sm" onClick={() => setPicker([])}><Plus className="size-4" />{t('menus.addItem')}</Button></div>
      </Card>
      <LinkPicker open={!!picker} onClose={() => setPicker(null)} onPick={(it) => { setItems(tree.addItem(items, picker ?? [], it)); setPicker(null); }} />
      <ConfirmDialog open={confirm} onClose={() => setConfirm(false)} danger title={t('menus.deleteTitle')} message={t('menus.deleteBody')} confirmLabel={t('common.delete')} cancelLabel={t('common.cancel')} onConfirm={() => { setConfirm(false); del.mutate(); }} />
    </>
  );
}

interface Found { id: string; title: string; handle?: string }
const PREFIX: Record<string, string> = { PRODUCT: '/products/', COLLECTION: '/collections/', PAGE: '/pages/' };

function LinkPicker({ open, onClose, onPick }: { open: boolean; onClose: () => void; onPick: (i: MenuItem) => void }) {
  const { t } = useI18n();
  const [type, setType] = useState<LinkType>('HTTP');
  const [url, setUrl] = useState('');
  const [search, setSearch] = useState('');
  const term = useDebounced(search);
  const q = useQuery({
    queryKey: ['link-picker', type, term], enabled: open && type !== 'HTTP',
    queryFn: async (): Promise<Found[]> => {
      const query = term.trim() || null;
      if (type === 'PRODUCT') return (await gql<{ products: { nodes: Found[] } }>(PRODUCTS_PICKER, { first: 20, query })).products.nodes;
      if (type === 'COLLECTION') return (await gql<{ collections: { nodes: Found[] } }>(COLLECTIONS, { first: 20, query })).collections.nodes;
      return (await gql<{ pages: { nodes: Found[] } }>(PAGES, { first: 20, query })).pages.nodes;
    },
  });
  const pick = (f: Found) => onPick({ title: f.title, type, url: f.handle ? `${PREFIX[type]}${f.handle}` : '', resourceId: f.id, items: [] });
  return (
    <Modal open={open} onClose={onClose} title={t('menus.addItem')} closeLabel={t('common.close')}
      footer={type === 'HTTP' ? <><Button onClick={onClose}>{t('common.cancel')}</Button><Button variant="primary" disabled={!url.trim()} onClick={() => { onPick({ title: url.trim(), type: 'HTTP', url: url.trim(), resourceId: null, items: [] }); setUrl(''); }}>{t('menus.add')}</Button></> : <Button onClick={onClose}>{t('common.cancel')}</Button>}>
      <div className="flex flex-col gap-3">
        <Select label={t('menus.linkTo')} value={type} onChange={(e) => setType(e.target.value as LinkType)}>
          {(['HTTP', 'PRODUCT', 'COLLECTION', 'PAGE'] as const).map((k) => <option key={k} value={k}>{t(`menus.type.${k}` as Key)}</option>)}
        </Select>
        {type === 'HTTP' ? <Input label="URL" placeholder="https://… /pages/contact" value={url} onChange={(e) => setUrl(e.target.value)} /> : (
          <>
            <input type="search" aria-label={t('menus.search')} placeholder={t('menus.search')} value={search} onChange={(e) => setSearch(e.target.value)} className="rounded-md border border-line bg-canvas px-3 py-2 text-sm" />
            {q.isError && <Banner>{(q.error as Error).message}</Banner>}
            <ul className="max-h-60 divide-y divide-line overflow-y-auto">
              {(q.data ?? []).map((f) => <li key={f.id}><button type="button" className="w-full px-2 py-2 text-left text-sm hover:bg-surface" onClick={() => pick(f)}>{f.title}</button></li>)}
              {q.data?.length === 0 && <li className="py-2 text-sm text-muted">{t('picker.none')}</li>}
            </ul>
          </>
        )}
      </div>
    </Modal>
  );
}
