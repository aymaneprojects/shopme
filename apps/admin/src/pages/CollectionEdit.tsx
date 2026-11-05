import { Banner, Button, ButtonGroup, Card, ConfirmDialog, Dropdown, ImageUploader, Input, Select, Skeleton, Textarea, useToast } from '@shopme/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, Eye, LayoutGrid, List, MoreHorizontal, Plus, Search, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { UserErrors, gql, mutate } from '../api';
import { ChannelsSection, channelChanges, channelStates, usePublications } from '../components/Channels';
import type { ChannelState } from '../components/Channels';
import { ConditionsBuilder } from '../components/ConditionsBuilder';
import { MetafieldsEditor } from '../components/MetafieldsEditor';
import { RichText } from '../components/RichText';
import { PageHeader } from '../components/PageHeader';
import { PrevNext } from '../components/PrevNext';
import { ProductPicker } from '../components/Pickers';
import type { PickedProduct } from '../components/Pickers';
import { SaveBar, guard } from '../components/SaveBar';
import { numToGid } from '../format';
import { COLLECTION, COLLECTION_ADD_PRODUCTS, COLLECTION_CREATE, COLLECTION_DELETE, COLLECTION_REMOVE_PRODUCTS, COLLECTION_UPDATE, PUBLISHABLE_PUBLISH, PUBLISHABLE_UNPUBLISH } from '../graphql';
import { useI18n } from '../i18n';
import { defaultRule, isRuleValid, toRuleInput } from '../lib/collection-rules';
import type { RuleSet } from '../lib/collection-rules';
import { Thumb } from './Products';

interface ApiCollection {
  id: string; title: string; handle: string; descriptionHtml: string; sortOrder: string; templateSuffix: string | null; updatedAt: string;
  image: { url: string; altText: string | null } | null; seo: { title: string | null; description: string | null };
  ruleSet: RuleSet | null; products: { nodes: PickedProduct[] };
  resourcePublicationsV2?: { nodes: Array<{ isPublished: boolean; publishDate: string | null; publication: { id: string; name: string } }> };
}
interface CollectionForm {
  title: string; descriptionHtml: string; imageUrl: string; sortOrder: string; templateSuffix: string; handle: string; seoTitle: string; seoDescription: string;
  smart: boolean; ruleSet: RuleSet; products: PickedProduct[];
  channels: ChannelState[];
}

const SORT_ORDERS = ['MANUAL', 'BEST_SELLING', 'ALPHA_ASC', 'ALPHA_DESC', 'PRICE_DESC', 'PRICE_ASC', 'CREATED_DESC', 'CREATED'];
const blank: CollectionForm = { title: '', descriptionHtml: '', imageUrl: '', sortOrder: 'MANUAL', templateSuffix: '', handle: '', seoTitle: '', seoDescription: '', smart: false, ruleSet: { appliedDisjunctively: false, rules: [] }, products: [], channels: [] };

function fromApi(c: ApiCollection, pubs: Array<{ id: string; name: string; shopmeKind?: string }>): CollectionForm {
  return {
    title: c.title, descriptionHtml: c.descriptionHtml, imageUrl: c.image?.url ?? '', sortOrder: c.sortOrder, templateSuffix: c.templateSuffix ?? '', handle: c.handle,
    seoTitle: c.seo.title ?? '', seoDescription: c.seo.description ?? '', smart: !!c.ruleSet, ruleSet: c.ruleSet ?? blank.ruleSet, products: c.products.nodes, channels: channelStates(pubs, c.resourcePublicationsV2?.nodes ?? []),
  };
}

export function CollectionEditPage() {
  const { id = 'new' } = useParams();
  const isNew = id === 'new';
  const { t } = useI18n();
  const pubs = usePublications();
  const q = useQuery({ queryKey: ['collection', id], enabled: !isNew, queryFn: () => gql<{ collection: ApiCollection | null }>(COLLECTION, { id: numToGid('Collection', id) }) });
  if (pubs.isLoading || (!isNew && q.isLoading)) return <div className="grid gap-4"><Skeleton className="h-8 w-64" /><Skeleton className="h-64" /></div>;
  if (q.error) return <Banner>{q.error.message}</Banner>;
  if (!isNew && !q.data?.collection) return <Banner>{t('collections.notFound')}</Banner>;
  return <CollectionFormView key={`${id}:${q.dataUpdatedAt}`} id={isNew ? null : numToGid('Collection', id)} initial={isNew ? { ...blank, channels: channelStates(pubs.data ?? [], null) } : fromApi(q.data!.collection!, pubs.data ?? [])} />;
}

function CollectionFormView({ id, initial: initialProp }: { id: string | null; initial: CollectionForm }) {
  const { t } = useI18n();
  const nav = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();
  const [initial] = useState(initialProp);
  const [form, setForm] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [titleError, setTitleError] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [productFilter, setProductFilter] = useState('');
  const [grid, setGrid] = useState(false);
  const set = (p: Partial<CollectionForm>) => setForm((f) => ({ ...f, ...p }));
  const dirty = JSON.stringify(form) !== JSON.stringify(initial);
  const shownProducts = form.products.filter((p) => !productFilter.trim() || p.title.toLowerCase().includes(productFilter.trim().toLowerCase()));

  const save = useMutation({
    mutationFn: async () => {
      if (!form.title.trim()) { setTitleError(t('collection.titleRequired')); throw new Error('validation'); }
      if (form.smart && (!form.ruleSet.rules.length || !form.ruleSet.rules.every(isRuleValid))) { setError(t('collection.rulesInvalid')); throw new Error('validation'); }
      setTitleError(null); setError(null);
      const input = {
        title: form.title.trim(), descriptionHtml: form.descriptionHtml, sortOrder: form.sortOrder, templateSuffix: form.templateSuffix.trim() || null,
        seo: { title: form.seoTitle.trim() || null, description: form.seoDescription.trim() || null },
        ...(form.handle.trim() && { handle: form.handle.trim() }),
        ...(form.imageUrl && form.imageUrl !== initial.imageUrl && { image: { src: new URL(form.imageUrl, window.location.origin).href } }),
        ...(form.smart && { ruleSet: { appliedDisjunctively: form.ruleSet.appliedDisjunctively, rules: toRuleInput(form.ruleSet.rules) } }),
      };
      let cid = id;
      if (cid) await mutate(COLLECTION_UPDATE, { collection: { id: cid, ...input } }, 'collectionUpdate');
      else cid = (await mutate<{ collection: { id: string } }>(COLLECTION_CREATE, { collection: input }, 'collectionCreate')).collection.id;
      if (!form.smart) {
        const had = new Set(initial.products.map((p) => p.id)), has = new Set(form.products.map((p) => p.id));
        const add = [...has].filter((p) => !had.has(p)), remove = [...had].filter((p) => !has.has(p));
        if (add.length) await mutate(COLLECTION_ADD_PRODUCTS, { id: cid, productIds: add }, 'collectionAddProductsV2');
        if (remove.length) await mutate(COLLECTION_REMOVE_PRODUCTS, { id: cid, productIds: remove }, 'collectionRemoveProducts');
      }
      const base = id ? initial.channels : form.channels.map((c) => ({ ...c, published: c.online, publishDate: '' }));
      const { publish, unpublish } = channelChanges(base, form.channels);
      if (publish.length) await mutate(PUBLISHABLE_PUBLISH, { id: cid, input: publish }, 'publishablePublish');
      if (unpublish.length) await mutate(PUBLISHABLE_UNPUBLISH, { id: cid, input: unpublish }, 'publishableUnpublish');
      return cid;
    },
    onSuccess: async (cid) => {
      toast(t('collection.saved'));
      void qc.invalidateQueries({ queryKey: ['collections'] });
      if (!id) { guard.off = true; nav(`/collections/${cid.split('/').pop()}`, { replace: true }); } else await qc.invalidateQueries({ queryKey: ['collection'] });
    },
    onError: (e) => { if (e.message !== 'validation') { setError(e instanceof UserErrors ? e.errors.map((x) => x.message).join(' · ') : e.message); toast(t('product.saveFailed'), 'critical'); } },
  });
  const del = useMutation({
    mutationFn: () => mutate(COLLECTION_DELETE, { input: { id } }, 'collectionDelete'),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['collections'] }); guard.off = true; nav('/collections'); },
    onError: (e) => toast(e.message, 'critical'),
  });

  const duplicate = useMutation({
    mutationFn: async () => {
      const input = {
        title: t('product.copyOf', { title: form.title.trim() || initial.title }), descriptionHtml: form.descriptionHtml, sortOrder: form.sortOrder, templateSuffix: form.templateSuffix.trim() || null,
        ...(form.smart && { ruleSet: { appliedDisjunctively: form.ruleSet.appliedDisjunctively, rules: toRuleInput(form.ruleSet.rules) } }),
      };
      const created = (await mutate<{ collection: { id: string } }>(COLLECTION_CREATE, { collection: input }, 'collectionCreate')).collection.id;
      if (!form.smart && form.products.length) await mutate(COLLECTION_ADD_PRODUCTS, { id: created, productIds: form.products.map((p) => p.id) }, 'collectionAddProductsV2');
      return created;
    },
    onSuccess: (cid) => { toast(t('collection.duplicated')); void qc.invalidateQueries({ queryKey: ['collections'] }); guard.off = true; nav(`/collections/${cid.split('/').pop()}`); },
    onError: (e) => toast(e.message, 'critical'),
  });

  return (
    <>
      <SaveBar dirty={dirty} saving={save.isPending} onSave={() => save.mutate()} onDiscard={() => { setForm(initial); setError(null); setTitleError(null); }} />
      <PageHeader back="/collections" title={id ? form.title || t('collection.untitled') : t('collection.addTitle')}
        actions={id && <>
          <ButtonGroup>
            <Button icon aria-label={t('collection.duplicate')} loading={duplicate.isPending} onClick={() => duplicate.mutate()}><Copy className="size-4" /></Button>
            <Button icon aria-label={t('collection.view')} onClick={() => { window.open(`/collections/${form.handle || initial.handle}`, '_blank', 'noopener'); }}><Eye className="size-4" /></Button>
            <Button icon className="text-critical" aria-label={t('common.delete')} onClick={() => setConfirmDelete(true)}><Trash2 className="size-4" /></Button>
          </ButtonGroup>
          <PrevNext kind="collections" gid={id} />
        </>} />
      {error && <div className="mb-4"><Banner>{error}</Banner></div>}
      <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
        <div className="flex flex-col gap-4">
          <Card>
            <div className="flex flex-col gap-3">
              <div className="flex items-start gap-3">
                <div className="flex shrink-0 flex-col items-center gap-1.5" aria-label={t('collection.image')}>
                  {form.imageUrl ? <img src={form.imageUrl} alt="" className="size-16 rounded-lg border border-line object-cover" /> : <Thumb className="size-16" />}
                  <ImageUploader multiple={false} look="tile" label={t('media.upload')} onUploaded={(f) => set({ imageUrl: f[0]!.url })} onError={(m) => toast(m, 'critical')} />
                  {form.imageUrl && <button type="button" onClick={() => set({ imageUrl: '' })} className="text-xs text-muted hover:text-fg">{t('common.remove')}</button>}
                </div>
                <div className="min-w-0 flex-1"><Input label={t('field.title')} required value={form.title} error={titleError} onChange={(e) => set({ title: e.target.value })} /></div>
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-[13px] font-medium">{t('field.description')}</span>
                <RichText value={form.descriptionHtml} onChange={(descriptionHtml) => set({ descriptionHtml })} />
              </div>
            </div>
          </Card>

          <Card title={t('collection.type')} actions={id && (
            <Dropdown align="right" variant="plain" size="sm" icon label={t('common.moreActions')} trigger={<MoreHorizontal className="size-4" />} items={[
              { key: 'duplicate', icon: <Copy className="size-4" />, label: t('collection.duplicate'), onSelect: () => duplicate.mutate() },
              { key: 'view', icon: <Eye className="size-4" />, label: t('collection.view'), onSelect: () => { window.open(`/collections/${form.handle || initial.handle}`, '_blank', 'noopener'); } },
              { key: 'delete', icon: <Trash2 className="size-4" />, label: t('common.delete'), danger: true, separatorBefore: true, onSelect: () => setConfirmDelete(true) },
            ]} />
          )}>
            <div className="flex flex-col gap-3">
              <div className="flex gap-4 text-[13px]" role="radiogroup" aria-label={t('collection.type')}>
                {[false, true].map((smart) => (
                  <label key={String(smart)} className="inline-flex items-center gap-1.5">
                    <input type="radio" name="ctype" disabled={!!id} className="accent-(--color-primary)" checked={form.smart === smart} onChange={() => set({ smart, ruleSet: smart && !form.ruleSet.rules.length ? { ...form.ruleSet, rules: [defaultRule()] } : form.ruleSet })} />
                    {t(smart ? 'collections.automated' : 'collections.manual')}
                  </label>
                ))}
              </div>
              {form.smart ? <ConditionsBuilder value={form.ruleSet} onChange={(ruleSet) => set({ ruleSet })} /> : <p className="text-[13px] text-muted">{t('collection.manualHelp')}</p>}
            </div>
          </Card>

          <Card title={t('collection.products', { n: form.products.length })} actions={!form.smart && <Button size="sm" onClick={() => setPicking(true)}><Plus className="size-4" />{t('collection.addProducts')}</Button>}>
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <div className="relative min-w-40 flex-1">
                <Search className="pointer-events-none absolute left-2.5 top-2 size-4 text-muted" />
                <input type="search" value={productFilter} onChange={(e) => setProductFilter(e.target.value)} placeholder={t('bp.collection.filter')} aria-label={t('bp.collection.filter')} className="field-control w-full pl-8" />
              </div>
              <select aria-label={t('collection.sortOrder')} value={form.sortOrder} onChange={(e) => set({ sortOrder: e.target.value })} className="field-control w-auto">
                {SORT_ORDERS.map((s) => <option key={s} value={s}>{t(`sortOrder.${s}` as 'sortOrder.MANUAL')}</option>)}
              </select>
              <ButtonGroup>
                <Button icon aria-label={t('bp.collection.listView')} aria-pressed={!grid} onClick={() => setGrid(false)}><List className="size-4" /></Button>
                <Button icon aria-label={t('bp.collection.gridView')} aria-pressed={grid} onClick={() => setGrid(true)}><LayoutGrid className="size-4" /></Button>
              </ButtonGroup>
            </div>
            {form.products.length === 0 ? <p className="text-[13px] text-muted">{form.smart ? t('collection.autoEmpty') : t('collection.manualEmpty')}</p> : shownProducts.length === 0 ? <p className="text-[13px] text-muted">{t('products.noResults')}</p> : grid ? (
              <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                {shownProducts.map((p) => (
                  <li key={p.id} className="group relative flex flex-col gap-1.5">
                    <Thumb url={p.featuredMedia?.image?.url} className="aspect-square w-full" />
                    <span className="truncate text-[13px]">{p.title}</span>
                    {!form.smart && <button type="button" aria-label={`${t('common.remove')} ${p.title}`} className="absolute right-1 top-1 rounded-full bg-canvas p-1 text-muted opacity-0 shadow-card hover:text-fg focus-visible:opacity-100 group-hover:opacity-100" onClick={() => set({ products: form.products.filter((x) => x.id !== p.id) })}><Trash2 className="size-3.5" /></button>}
                  </li>
                ))}
              </ul>
            ) : (
              <ul className="divide-y divide-line">
                {shownProducts.map((p) => (
                  <li key={p.id} className="flex items-center gap-3 py-2">
                    <Thumb url={p.featuredMedia?.image?.url} className="size-8" />
                    <span className="flex-1 text-[13px]">{p.title}</span>
                    {!form.smart && <button type="button" aria-label={`${t('common.remove')} ${p.title}`} className="rounded p-1 text-muted hover:bg-surface" onClick={() => set({ products: form.products.filter((x) => x.id !== p.id) })}><Trash2 className="size-4" /></button>}
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {id && <MetafieldsEditor ownerId={id} ownerType="COLLECTION" />}

          <Card title={t('product.seo')}>
            <div className="flex flex-col gap-3">
              <Input label={t('product.seoTitle')} value={form.seoTitle} onChange={(e) => set({ seoTitle: e.target.value })} />
              <Textarea label={t('product.seoDescription')} value={form.seoDescription} onChange={(e) => set({ seoDescription: e.target.value })} />
              <Input label={t('product.handle')} value={form.handle} onChange={(e) => set({ handle: e.target.value })} />
            </div>
          </Card>
        </div>
        <div className="flex flex-col gap-4">
          <Card title={t('bp.channels.title')}><ChannelsSection value={form.channels} onChange={(channels) => set({ channels })} bare /></Card>
          <Card title={t('collection.organization')}>
            <div className="flex flex-col gap-3">
              <Input label={t('product.template')} help={t('product.templateHelp')} value={form.templateSuffix} onChange={(e) => set({ templateSuffix: e.target.value })} />
            </div>
          </Card>
        </div>
      </div>
      <ProductPicker open={picking} onClose={() => setPicking(false)} excludeIds={form.products.map((p) => p.id)} onConfirm={(p) => set({ products: [...form.products, ...p] })} />
      <ConfirmDialog open={confirmDelete} onClose={() => setConfirmDelete(false)} danger title={t('collections.deleteTitle', { n: 1 })} message={t('collections.deleteBody')} confirmLabel={t('common.delete')} cancelLabel={t('common.cancel')} onConfirm={() => { setConfirmDelete(false); del.mutate(); }} />
    </>
  );
}
