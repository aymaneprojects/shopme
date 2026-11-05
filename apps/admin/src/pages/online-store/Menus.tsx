import { Banner, Button, Card, ConfirmDialog, EmptyState, IndexTable, Input, Modal, Select, Skeleton, useToast } from '@shopme/ui';
import type { Column } from '@shopme/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, GripVertical, Plus, Search, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { UserErrors, gql, mutate } from '../../api';
import { Link, useNavigate, useParams } from 'react-router';
import { PageHeader } from '../../components/PageHeader';
import { SaveBar, guard } from '../../components/SaveBar';
import { gidToNum } from '../../format';
import { StoreActions } from './Themes';
import { COLLECTIONS, MENUS, MENU_CREATE, MENU_DELETE, MENU_UPDATE, PAGES, PRODUCTS_PICKER } from '../../graphql';
import { useI18n } from '../../i18n';
import type { Key } from '../../i18n';
import { useDebounced, useStoreBase } from '../../lib/hooks';
import * as tree from '../../lib/menu-tree';
import type { DropPlace, LinkType, MenuItem, Path } from '../../lib/menu-tree';

interface ApiItem { id: string; title: string; type: string; url: string | null; resourceId: string | null; items?: ApiItem[] }
interface ApiMenu { id: string; title: string; handle: string; isDefault?: boolean; items: ApiItem[] }
const fromApi = (items: ApiItem[] = []): MenuItem[] => items.map((i) => ({ id: i.id, title: i.title, type: (['PRODUCT', 'COLLECTION', 'PAGE'].includes(i.type) ? i.type : 'HTTP') as LinkType, url: i.url ?? '', resourceId: i.resourceId, items: fromApi(i.items) }));
const slug = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export function MenusPage() {
  const base = useStoreBase();
  const { t } = useI18n();
  const nav = useNavigate();
  const q = useQuery({ queryKey: ['menus'], queryFn: () => gql<{ menus: { nodes: ApiMenu[] } }>(MENUS) });
  const [search, setSearch] = useState('');
  const [desc, setDesc] = useState(false);
  if (q.isLoading) return <Skeleton className="h-64" />;
  if (q.error) return <Banner>{q.error.message}</Banner>;
  const menus = q.data!.menus.nodes.filter((m) => m.title.toLowerCase().includes(search.trim().toLowerCase())).sort((a, b) => (desc ? -1 : 1) * a.title.localeCompare(b.title));
  const columns: Array<Column<ApiMenu>> = [
    { key: 'title', header: <button type="button" className="inline-flex items-center gap-1" onClick={() => setDesc(!desc)}>{t('menus.menu')}{desc ? <ArrowDown className="size-3" /> : <ArrowUp className="size-3" />}</button>, cell: (m) => <span className="font-medium">{m.title}</span> },
    { key: 'items', header: t('menus.items'), cell: (m) => <span className="text-muted">{m.items.map((i) => i.title).join(', ') || '—'}</span> },
  ];
  return (
    <div className="flex flex-col gap-4">
      <StoreActions>
        <Link to="/online-store/redirects" className="btn btn-secondary">{t('store.redirects')}</Link>
        <Button variant="primary" onClick={() => nav(`${base}/navigation/new`)}>{t('menus.create')}</Button>
      </StoreActions>
      <Card className="!p-0">
        <div className="border-b border-line p-3"><div className="relative max-w-md"><Search className="pointer-events-none absolute left-2.5 top-2 size-4 text-muted" /><input type="search" className="field-control w-full pl-8" placeholder={t('menus.searchMenus')} aria-label={t('menus.searchMenus')} value={search} onChange={(e) => setSearch(e.target.value)} /></div></div>
        <IndexTable rows={menus} rowId={(m) => m.id} columns={columns} onRowClick={(m) => nav(`${base}/navigation/${gidToNum(m.id)}`)} empty={<EmptyState icon={<Search className="size-10" />} title={t('menus.emptyList')} />} />
      </Card>
    </div>
  );
}

export function MenuEditPage() {
  const { id = 'new' } = useParams();
  const { t } = useI18n();
  const q = useQuery({ queryKey: ['menus'], queryFn: () => gql<{ menus: { nodes: ApiMenu[] } }>(MENUS) });
  if (q.isLoading) return <Skeleton className="h-64" />;
  if (q.error) return <Banner>{q.error.message}</Banner>;
  const menu = id === 'new' ? null : q.data!.menus.nodes.find((m) => gidToNum(m.id) === id) ?? null;
  if (id !== 'new' && !menu) return <Banner>{t('menus.notFound')}</Banner>;
  return <MenuEditor key={`${id}:${q.dataUpdatedAt}`} menu={menu} />;
}

function MenuEditor({ menu }: { menu: ApiMenu | null }) {
  const base = useStoreBase();
  const { t } = useI18n();
  const toast = useToast();
  const qc = useQueryClient();
  const nav = useNavigate();
  const initial = { title: menu?.title ?? '', items: fromApi(menu?.items) };
  const [title, setTitle] = useState(initial.title);
  const [items, setItems] = useState(initial.items);
  const [picker, setPicker] = useState<Path | null>(null); // parent path to add into
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [drag, setDrag] = useState<Path | null>(null);
  const [drop, setDrop] = useState<{ key: string; place: DropPlace } | null>(null);
  const dirty = title !== initial.title || JSON.stringify(items) !== JSON.stringify(initial.items);
  const refresh = () => qc.invalidateQueries({ queryKey: ['menus'] });
  const save = useMutation({
    mutationFn: async () => {
      if (!title.trim()) throw new Error(t('menus.titleRequired'));
      if (items.some(function bad(i: MenuItem): boolean { return !i.title.trim() || i.items.some(bad); })) throw new Error(t('menus.itemTitleRequired'));
      if (menu) { await mutate(MENU_UPDATE, { id: menu.id, title: title.trim(), items: tree.toInput(items, true) }, 'menuUpdate'); return menu.id; }
      return (await mutate<{ menu: { id: string } }>(MENU_CREATE, { title: title.trim(), handle: slug(title) || 'menu', items: tree.toInput(items, false) }, 'menuCreate')).menu.id;
    },
    onSuccess: (id) => { toast(t('menus.saved')); setError(null); void refresh().then(() => { guard.off = true; nav(`${base}/navigation/${gidToNum(id)}`, { replace: true }); }); },
    onError: (e) => setError(e instanceof UserErrors ? e.errors.map((x) => x.message).join(' · ') : e.message),
  });
  const del = useMutation({ mutationFn: () => mutate(MENU_DELETE, { id: menu!.id }, 'menuDelete'), onSuccess: () => { guard.off = true; void refresh().then(() => nav(`${base}/navigation`)); }, onError: (e) => toast(e.message, 'critical') });

  const rows: Array<{ item: MenuItem; path: Path }> = [];
  (function walk(list: MenuItem[], base: Path) { list.forEach((it, i) => { rows.push({ item: it, path: [...base, i] }); walk(it.items, [...base, i]); }); })(items, []);
  const icon = (label: string, I: typeof ArrowUp, on: boolean, fn: () => void) => <button type="button" aria-label={label} disabled={!on} onClick={fn} className="rounded p-1 hover:bg-surface disabled:opacity-30"><I className="size-4" /></button>;

  return (
    <>
      <SaveBar dirty={dirty} saving={save.isPending} onSave={() => save.mutate()} onDiscard={() => { setTitle(initial.title); setItems(initial.items); setError(null); }} />
      {error && <div className="mx-auto mb-4 max-w-3xl"><Banner>{error}</Banner></div>}
      <PageHeader back={`${base}/navigation`} title={menu ? menu.title : t('menus.add')} more={menu && !menu.isDefault ? [{ key: 'delete', label: t('common.delete'), danger: true, onSelect: () => setConfirm(true) }] : undefined} />
      <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <Card>
        <Input label={t('field.name')} placeholder={t('menus.namePlaceholder')} value={title} onChange={(e) => setTitle(e.target.value)} />
        <p className="mt-2 text-[13px] text-muted">{t('menus.handle')}: {menu?.handle ?? (slug(title) || '—')}</p>
      </Card>
      <Card title={t('menus.items')}>
        {rows.length === 0 && <p className="mb-3 text-[13px] text-muted">{t('menus.empty')}</p>}
        <ul className="flex flex-col gap-2">
          {rows.map(({ item, path }) => (
            <li
              key={path.join('.')} style={{ marginLeft: `${(path.length - 1) * 1.5}rem` }} data-testid="menu-row"
              className={`flex flex-wrap items-center gap-2 rounded-md border p-2 ${drop?.key === path.join('.') ? (drop.place === 'inside' ? 'border-accent bg-accent/5' : drop.place === 'before' ? 'border-line border-t-2 border-t-accent' : 'border-line border-b-2 border-b-accent') : 'border-line'} ${drag && drag.join('.') === path.join('.') ? 'opacity-50' : ''}`}
              onDragOver={(e) => {
                if (!drag) return;
                const r = e.currentTarget.getBoundingClientRect();
                const y = (e.clientY - r.top) / Math.max(r.height, 1);
                const place: DropPlace = y < 0.3 ? 'before' : y > 0.7 ? 'after' : 'inside';
                if (!tree.canMoveTo(items, drag, path, place)) { if (drop) setDrop(null); return; }
                e.preventDefault();
                if (drop?.key !== path.join('.') || drop.place !== place) setDrop({ key: path.join('.'), place });
              }}
              onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDrop(null); }}
              onDrop={(e) => { e.preventDefault(); if (drag && drop) setItems(tree.moveTo(items, drag, path, drop.place)); setDrag(null); setDrop(null); }}
            >
              <span draggable onDragStart={(e) => { setDrag(path); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', path.join('.')); }} onDragEnd={() => { setDrag(null); setDrop(null); }}
                className="grid cursor-grab touch-none place-items-center rounded p-1 text-muted hover:bg-surface active:cursor-grabbing" title={t('bc.menus.drag')} aria-label={t('bc.menus.drag')}><GripVertical className="size-4" /></span>
              <input aria-label={t('menus.itemTitle')} value={item.title} onChange={(e) => setItems(tree.updateItem(items, path, { title: e.target.value }))} className="min-w-32 flex-1 field-control" />
              {item.type === 'HTTP'
                ? <input aria-label="URL" value={item.url} onChange={(e) => setItems(tree.updateItem(items, path, { url: e.target.value }))} className="min-w-32 flex-1 field-control" />
                : <span className="text-xs text-muted">{t(`menus.type.${item.type}` as Key)}</span>}
              {icon(t('menus.up'), ArrowUp, tree.canMoveUp(path), () => setItems(tree.moveUp(items, path)))}
              {icon(t('menus.down'), ArrowDown, tree.canMoveDown(items, path), () => setItems(tree.moveDown(items, path)))}
              {icon(t('menus.indent'), ArrowRight, tree.canIndent(items, path), () => setItems(tree.indent(items, path)))}
              {icon(t('menus.outdent'), ArrowLeft, tree.canOutdent(path), () => setItems(tree.outdent(items, path)))}
              {icon(t('common.remove'), Trash2, true, () => setItems(tree.removeItem(items, path)))}
            </li>
          ))}
        </ul>
        <div className="mt-3"><Button className="w-full justify-start" onClick={() => setPicker([])}><Plus className="size-4" />{t('menus.addItem')}</Button></div>
      </Card>
      </div>
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
            <input type="search" aria-label={t('menus.search')} placeholder={t('menus.search')} value={search} onChange={(e) => setSearch(e.target.value)} className="field-control" />
            {q.isError && <Banner>{(q.error as Error).message}</Banner>}
            <ul className="max-h-60 divide-y divide-line overflow-y-auto">
              {(q.data ?? []).map((f) => <li key={f.id}><button type="button" className="w-full px-2 py-2 text-left text-[13px] hover:bg-surface" onClick={() => pick(f)}>{f.title}</button></li>)}
              {q.data?.length === 0 && <li className="py-2 text-[13px] text-muted">{t('picker.none')}</li>}
            </ul>
          </>
        )}
      </div>
    </Modal>
  );
}
