import { Banner, Button, ButtonGroup, Card, ConfirmDialog, Dropdown, ImageUploader, Input, Modal, Skeleton, Textarea, useToast } from '@shopme/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, Eye, LayoutTemplate, MoreHorizontal, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { UserErrors, gql, mutate } from '../api';
import { ChannelsSection, channelChanges, channelStates, usePublications } from '../components/Channels';
import type { ChannelState } from '../components/Channels';
import { ConditionsBuilder } from '../components/ConditionsBuilder';
import { CollectionProducts } from '../components/CollectionProducts';
import { ProductMetafields } from '../components/MetafieldsEditor';
import type { MetafieldEdits } from '../components/MetafieldsEditor';
import { RichText } from '../components/RichText';
import { PageHeader } from '../components/PageHeader';
import { PrevNext } from '../components/PrevNext';
import { ProductPicker } from '../components/Pickers';
import type { PickedProduct } from '../components/Pickers';
import { SaveBar, guard } from '../components/SaveBar';
import { numToGid } from '../format';
import { COLLECTION, COLLECTION_ADD_PRODUCTS, COLLECTION_CREATE, COLLECTION_DELETE, COLLECTION_REMOVE_PRODUCTS, COLLECTION_UPDATE, METAFIELDS_SET, PUBLISHABLE_PUBLISH, PUBLISHABLE_UNPUBLISH } from '../graphql';
import { fromField } from '../lib/metafields';
import { useI18n } from '../i18n';
import { defaultRule, isRuleValid, toRuleInput } from '../lib/collection-rules';
import type { RuleSet } from '../lib/collection-rules';

interface ApiCollection {
  id: string; title: string; handle: string; descriptionHtml: string; sortOrder: string; templateSuffix: string | null; updatedAt: string;
  image: { url: string; altText: string | null } | null; seo: { title: string | null; description: string | null };
  ruleSet: RuleSet | null; products: { nodes: PickedProduct[] };
  resourcePublicationsV2?: { nodes: Array<{ isPublished: boolean; publishDate: string | null; publication: { id: string; name: string } }> };
}
interface CollectionForm {
  title: string; descriptionHtml: string; imageUrl: string; sortOrder: string; templateSuffix: string; handle: string; seoTitle: string; seoDescription: string;
  smart: boolean; ruleSet: RuleSet; products: PickedProduct[];
  channels: ChannelState[]; metafieldEdits: MetafieldEdits;
}

const SORT_ORDERS = ['MANUAL', 'BEST_SELLING', 'ALPHA_ASC', 'ALPHA_DESC', 'PRICE_DESC', 'PRICE_ASC', 'CREATED_DESC', 'CREATED'];
const blank: CollectionForm = { title: '', descriptionHtml: '', imageUrl: '', sortOrder: 'MANUAL', templateSuffix: '', handle: '', seoTitle: '', seoDescription: '', smart: false, ruleSet: { appliedDisjunctively: false, rules: [] }, products: [], channels: [], metafieldEdits: {} };

function fromApi(c: ApiCollection, pubs: Array<{ id: string; name: string; shopmeKind?: string }>): CollectionForm {
  return {
    title: c.title, descriptionHtml: c.descriptionHtml, imageUrl: c.image?.url ?? '', sortOrder: c.sortOrder, templateSuffix: c.templateSuffix ?? '', handle: c.handle,
    seoTitle: c.seo.title ?? '', seoDescription: c.seo.description ?? '', smart: !!c.ruleSet, ruleSet: c.ruleSet ?? blank.ruleSet, products: c.products.nodes, channels: channelStates(pubs, c.resourcePublicationsV2?.nodes ?? []), metafieldEdits: {},
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
  const [templateOpen, setTemplateOpen] = useState(false);
  const [templateDraft, setTemplateDraft] = useState('');
  const [metafieldsOpen, setMetafieldsOpen] = useState(false);
  const set = (p: Partial<CollectionForm>) => setForm((f) => ({ ...f, ...p }));
  const dirty = JSON.stringify(form) !== JSON.stringify(initial);

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
      const mf = Object.values(form.metafieldEdits).map((m) => ({ ownerId: cid!, namespace: m.namespace, key: m.key, type: m.type, value: fromField(m.type, m.value) }));
      if (mf.length) await mutate(METAFIELDS_SET, { metafields: mf }, 'metafieldsSet');
      if (publish.length) await mutate(PUBLISHABLE_PUBLISH, { id: cid, input: publish }, 'publishablePublish');
      if (unpublish.length) await mutate(PUBLISHABLE_UNPUBLISH, { id: cid, input: unpublish }, 'publishableUnpublish');
      return cid;
    },
    onSuccess: async (cid) => {
      toast(t('collection.saved'));
      void qc.invalidateQueries({ queryKey: ['collections'] });
      void qc.invalidateQueries({ queryKey: ['owner-metafields'] });
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
                  {form.imageUrl ? (
                    <>
                      <img src={form.imageUrl} alt="" className="size-24 rounded-lg border border-line object-cover" />
                      <button type="button" onClick={() => set({ imageUrl: '' })} className="text-xs text-muted hover:text-fg">{t('common.remove')}</button>
                    </>
                  ) : <ImageUploader multiple={false} look="tile" label={t('media.upload')} onUploaded={(f) => set({ imageUrl: f[0]!.url })} onError={(m) => toast(m, 'critical')} />}
                </div>
                <div className="min-w-0 flex-1">
                  <Input label={t('field.title')} required value={form.title} error={titleError} onChange={(e) => set({ title: e.target.value })} />
                  <button type="button" className="mt-1.5 inline-flex items-center gap-1.5 rounded-md py-0.5 text-[13px] text-muted hover:text-fg" onClick={() => { setTemplateDraft(form.templateSuffix); setTemplateOpen(true); }}>
                    <LayoutTemplate className="size-4" aria-hidden />{form.templateSuffix.trim() ? t('fin.col.templateNamed', { name: form.templateSuffix.trim() }) : t('fin.col.defaultTemplate')}
                  </button>
                </div>
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

          <CollectionProducts products={form.products} smart={form.smart} sortOrder={form.sortOrder} onSortOrder={(sortOrder) => set({ sortOrder })} onAdd={() => setPicking(true)} onRemove={(pid) => set({ products: form.products.filter((x) => x.id !== pid) })} />


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
          {metafieldsOpen || Object.keys(form.metafieldEdits).length > 0 ? (
            <Card title={t('mf.title')} actions={Object.keys(form.metafieldEdits).length === 0 && <Button variant="plain" size="sm" onClick={() => setMetafieldsOpen(false)}>{t('common.close')}</Button>}>
              <ProductMetafields bare ownerType="COLLECTION" ownerId={id} edits={form.metafieldEdits} onChange={(metafieldEdits) => set({ metafieldEdits })} />
            </Card>
          ) : (
            <button type="button" aria-label={t('mf.title')} onClick={() => setMetafieldsOpen(true)} className="flex min-h-12 w-full flex-col items-center justify-center gap-0.5 rounded-lg border border-dashed border-line text-[13px] text-muted hover:bg-hover hover:text-fg">
              <Plus className="size-4" aria-hidden /><span>{t('mf.title')}</span>
            </button>
          )}
        </div>
      </div>
      <Modal open={templateOpen} onClose={() => setTemplateOpen(false)} closeLabel={t('common.close')} medium title={t('fin.col.templateTitle')}
        footer={<><Button onClick={() => setTemplateOpen(false)}>{t('common.cancel')}</Button><Button variant="primary" onClick={() => { set({ templateSuffix: templateDraft.trim() }); setTemplateOpen(false); }}>{t('save.save')}</Button></>}>
        <Input autoFocus label={t('product.template')} help={t('product.templateHelp')} placeholder={t('fin.col.defaultTemplate')} value={templateDraft} onChange={(e) => setTemplateDraft(e.target.value)} />
      </Modal>
      <ProductPicker open={picking} onClose={() => setPicking(false)} excludeIds={form.products.map((p) => p.id)} onConfirm={(p) => set({ products: [...form.products, ...p] })} />
      <ConfirmDialog open={confirmDelete} onClose={() => setConfirmDelete(false)} danger title={t('collections.deleteTitle', { n: 1 })} message={t('collections.deleteBody')} confirmLabel={t('common.delete')} cancelLabel={t('common.cancel')} onConfirm={() => { setConfirmDelete(false); del.mutate(); }} />
    </>
  );
}
