import { Banner, Button, Card, ConfirmDialog, Dropdown, ImageUploader, Input, RichTextEditor, Select, Skeleton, Textarea, useToast } from '@shopme/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MoreHorizontal, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { UserErrors, gql, mutate } from '../api';
import { ConditionsBuilder } from '../components/ConditionsBuilder';
import { PageHeader } from '../components/PageHeader';
import { ProductPicker } from '../components/Pickers';
import type { PickedProduct } from '../components/Pickers';
import { SaveBar, guard } from '../components/SaveBar';
import { numToGid } from '../format';
import { COLLECTION, COLLECTION_ADD_PRODUCTS, COLLECTION_CREATE, COLLECTION_DELETE, COLLECTION_REMOVE_PRODUCTS, COLLECTION_UPDATE } from '../graphql';
import { useI18n } from '../i18n';
import { defaultRule, isRuleValid, toRuleInput } from '../lib/collection-rules';
import type { RuleSet } from '../lib/collection-rules';
import { Thumb } from './Products';

interface ApiCollection {
  id: string; title: string; handle: string; descriptionHtml: string; sortOrder: string; templateSuffix: string | null; updatedAt: string;
  image: { url: string; altText: string | null } | null; seo: { title: string | null; description: string | null };
  ruleSet: RuleSet | null; products: { nodes: PickedProduct[] };
}
interface CollectionForm {
  title: string; descriptionHtml: string; imageUrl: string; sortOrder: string; templateSuffix: string; handle: string; seoTitle: string; seoDescription: string;
  smart: boolean; ruleSet: RuleSet; products: PickedProduct[];
}

const SORT_ORDERS = ['MANUAL', 'BEST_SELLING', 'ALPHA_ASC', 'ALPHA_DESC', 'PRICE_DESC', 'PRICE_ASC', 'CREATED_DESC', 'CREATED'];
const blank: CollectionForm = { title: '', descriptionHtml: '', imageUrl: '', sortOrder: 'MANUAL', templateSuffix: '', handle: '', seoTitle: '', seoDescription: '', smart: false, ruleSet: { appliedDisjunctively: false, rules: [] }, products: [] };

function fromApi(c: ApiCollection): CollectionForm {
  return {
    title: c.title, descriptionHtml: c.descriptionHtml, imageUrl: c.image?.url ?? '', sortOrder: c.sortOrder, templateSuffix: c.templateSuffix ?? '', handle: c.handle,
    seoTitle: c.seo.title ?? '', seoDescription: c.seo.description ?? '', smart: !!c.ruleSet, ruleSet: c.ruleSet ?? blank.ruleSet, products: c.products.nodes,
  };
}

export function CollectionEditPage() {
  const { id = 'new' } = useParams();
  const isNew = id === 'new';
  const { t } = useI18n();
  const q = useQuery({ queryKey: ['collection', id], enabled: !isNew, queryFn: () => gql<{ collection: ApiCollection | null }>(COLLECTION, { id: numToGid('Collection', id) }) });
  if (!isNew && q.isLoading) return <div className="grid gap-4"><Skeleton className="h-8 w-64" /><Skeleton className="h-64" /></div>;
  if (q.error) return <Banner>{q.error.message}</Banner>;
  if (!isNew && !q.data?.collection) return <Banner>{t('collections.notFound')}</Banner>;
  return <CollectionFormView key={`${id}:${q.dataUpdatedAt}`} id={isNew ? null : numToGid('Collection', id)} initial={isNew ? blank : fromApi(q.data!.collection!)} />;
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

  return (
    <>
      <SaveBar dirty={dirty} saving={save.isPending} onSave={() => save.mutate()} onDiscard={() => { setForm(initial); setError(null); setTitleError(null); }} />
      <PageHeader back="/collections" title={id ? form.title || t('collection.untitled') : t('collection.addTitle')}
        actions={id && <Dropdown align="right" label={t('common.moreActions')} trigger={<MoreHorizontal className="size-4" />} items={[{ key: 'delete', label: t('common.delete'), danger: true, onSelect: () => setConfirmDelete(true) }]} />} />
      {error && <div className="mb-4"><Banner>{error}</Banner></div>}
      <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
        <div className="flex flex-col gap-4">
          <Card>
            <div className="flex flex-col gap-3">
              <Input label={t('field.title')} required value={form.title} error={titleError} onChange={(e) => set({ title: e.target.value })} />
              <div className="flex flex-col gap-1">
                <span className="text-[13px] font-medium">{t('field.description')}</span>
                <RichTextEditor value={form.descriptionHtml} onChange={(descriptionHtml) => set({ descriptionHtml })}
                  labels={{ bold: t('rte.bold'), italic: t('rte.italic'), underline: t('rte.underline'), list: t('rte.list'), orderedList: t('rte.orderedList'), link: t('rte.link'), source: t('rte.source'), paragraph: t('rte.paragraph'), heading: t('rte.heading'), subheading: t('rte.subheading'), linkPrompt: t('rte.linkPrompt') }} />
              </div>
            </div>
          </Card>

          <Card title={t('collection.type')}>
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
            {form.products.length === 0 ? <p className="text-[13px] text-muted">{form.smart ? t('collection.autoEmpty') : t('collection.manualEmpty')}</p> : (
              <ul className="divide-y divide-line">
                {form.products.map((p) => (
                  <li key={p.id} className="flex items-center gap-3 py-2">
                    <Thumb url={p.featuredMedia?.image?.url} className="size-8" />
                    <span className="flex-1 text-[13px]">{p.title}</span>
                    {!form.smart && <button type="button" aria-label={`${t('common.remove')} ${p.title}`} className="rounded p-1 text-muted hover:bg-surface" onClick={() => set({ products: form.products.filter((x) => x.id !== p.id) })}><Trash2 className="size-4" /></button>}
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title={t('product.seo')}>
            <div className="flex flex-col gap-3">
              <Input label={t('product.seoTitle')} value={form.seoTitle} onChange={(e) => set({ seoTitle: e.target.value })} />
              <Textarea label={t('product.seoDescription')} value={form.seoDescription} onChange={(e) => set({ seoDescription: e.target.value })} />
              <Input label={t('product.handle')} value={form.handle} onChange={(e) => set({ handle: e.target.value })} />
            </div>
          </Card>
        </div>
        <div className="flex flex-col gap-4">
          <Card title={t('collection.image')}>
            <div className="flex flex-col gap-2">
              {form.imageUrl && <img src={form.imageUrl} alt="" className="aspect-square w-full rounded-md border border-line object-cover" />}
              <ImageUploader multiple={false} label={t('media.upload')} onUploaded={(f) => set({ imageUrl: f[0]!.url })} onError={(m) => toast(m, 'critical')} />
              {form.imageUrl && <Button size="sm" onClick={() => set({ imageUrl: '' })}>{t('common.remove')}</Button>}
            </div>
          </Card>
          <Card title={t('collection.organization')}>
            <div className="flex flex-col gap-3">
              <Select label={t('collection.sortOrder')} value={form.sortOrder} onChange={(e) => set({ sortOrder: e.target.value })}>
                {SORT_ORDERS.map((s) => <option key={s} value={s}>{t(`sortOrder.${s}` as 'sortOrder.MANUAL')}</option>)}
              </Select>
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
