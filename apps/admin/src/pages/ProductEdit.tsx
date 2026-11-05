import { Banner, Button, Checkbox, ConfirmDialog, Dropdown, ImageUploader, Input, MediaGallery, MediaViewer, Modal, Skeleton, cx, useToast } from '@shopme/ui';
import type { GalleryItem } from '@shopme/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Archive, Copy, Eye, Gift, Tag, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import { UserErrors, gql, mutate } from '../api';
import { MetafieldsEditor } from '../components/MetafieldsEditor';
import { CollectionPicker } from '../components/Pickers';
import { Chip, INLINE_SELECT, InlineRow, InlineTags, SideHead } from '../components/ProductSide';
import { SeoListing } from '../components/SeoListing';
import { RichText } from '../components/RichText';
import { PageHeader } from '../components/PageHeader';
import { PrevNext } from '../components/PrevNext';
import { ViewAs } from '../components/ViewAs';
import { SaveBar, guard } from '../components/SaveBar';
import { VariantsManager } from '../components/VariantsManager';
import { numToGid } from '../format';
import { LOCATIONS, PRODUCT, PRODUCT_DELETE, PRODUCT_DUPLICATE, PRODUCT_FILTER_OPTIONS, TAXONOMY_CATEGORIES } from '../graphql';
import { useI18n } from '../i18n';
import { flattenStrings } from '../lib/hooks';
import { createProduct, emptyForm, formFromProduct, giftCardForm, isPersistedMedia, updateProduct, validate } from '../lib/product-form';
import type { ApiProduct, LocationRef, ProductForm } from '../lib/product-form';
import { useShop } from '../session';

/** Loads the product (or a blank form) and locations, then mounts the form. */
export function ProductEditPage() {
  const { id = 'new' } = useParams();
  const isNew = id === 'new';
  const locs = useQuery({ queryKey: ['locations'], queryFn: () => gql<{ locations: { nodes: Array<LocationRef & { isActive: boolean }> } }>(LOCATIONS) });
  const prod = useQuery({ queryKey: ['product', id], enabled: !isNew, queryFn: () => gql<{ product: ApiProduct | null }>(PRODUCT, { id: numToGid('Product', id) }) });
  const { t } = useI18n();
  const [params] = useSearchParams();

  if (locs.isLoading || (!isNew && prod.isLoading)) return <div className="grid gap-4"><Skeleton className="h-8 w-64" /><Skeleton className="h-64" /></div>;
  const error = locs.error ?? prod.error;
  if (error) return <Banner>{error.message}</Banner>;
  const locations = (locs.data?.locations.nodes ?? []).filter((l) => l.isActive !== false);
  if (!isNew && !prod.data?.product) return <Banner>{t('product.notFound')}</Banner>;
  const initial = isNew ? (params.get('giftCard') ? giftCardForm(locations, t('product.giftCardTitle')) : emptyForm(locations)) : formFromProduct(prod.data!.product!, locations);
  return <ProductFormView key={`${id}:${prod.dataUpdatedAt}`} id={isNew ? null : numToGid('Product', id)} initial={initial} locations={locations} previewUrl={prod.data?.product?.onlineStorePreviewUrl ?? null} />;
}

const slug = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

function ProductFormView({ id, initial: initialProp, locations, previewUrl }: { id: string | null; initial: ProductForm; locations: LocationRef[]; previewUrl: string | null }) {
  const [initial] = useState(initialProp); // frozen per mount; the parent remounts on refetch
  const { t } = useI18n();
  const { shop } = useShop();
  const nav = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();
  const [form, setForm] = useState(initial);
  const [errors, setErrors] = useState<{ title?: string; price?: string; server?: UserErrors | string }>({});
  const [pickCollections, setPickCollections] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [variantMf, setVariantMf] = useState<string | null>(null);
  const [viewing, setViewing] = useState<number | null>(null);
  const [dup, setDup] = useState<{ title: string; images: boolean; status: 'DRAFT' | 'ACTIVE' } | null>(null);
  const cats = useQuery({ queryKey: ['taxonomy'], staleTime: 600_000, queryFn: () => gql<{ taxonomy: { categories: { nodes: Array<{ id: string; fullName: string }> } } | null }>(TAXONOMY_CATEGORIES) });
  const set = (p: Partial<ProductForm>) => setForm((f) => ({ ...f, ...p }));
  const dirty = JSON.stringify(form) !== JSON.stringify(initial);
  const filters = useQuery({ queryKey: ['product-filter-options'], queryFn: () => gql<Record<'productTypes' | 'productVendors' | 'productTags', { edges: Array<{ node: string }> }>>(PRODUCT_FILTER_OPTIONS), staleTime: 60_000 });

  const save = useMutation({
    mutationFn: async () => {
      const v = validate(form);
      if (Object.keys(v).length) { setErrors({ title: v.title && t('product.titleRequired'), price: v.price && t('product.priceInvalid') }); throw new Error('validation'); }
      setErrors({});
      return id ? (await updateProduct(id, form, initial, locations), id) : createProduct(form, locations);
    },
    onSuccess: async (pid) => {
      toast(t('product.saved'));
      void qc.invalidateQueries({ queryKey: ['products'] });
      if (!id) { guard.off = true; nav(`/products/${pid.split('/').pop()}`, { replace: true }); }
      else await qc.invalidateQueries({ queryKey: ['product'] });
    },
    onError: (e) => {
      if (e.message === 'validation') return;
      setErrors({ server: e instanceof UserErrors ? e : e.message });
      toast(t('product.saveFailed'), 'critical');
    },
  });
  const del = useMutation({
    mutationFn: () => mutate(PRODUCT_DELETE, { input: { id } }, 'productDelete'),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['products'] }); guard.off = true; nav('/products'); toast(t('products.deleted', { n: 1 })); },
    onError: (e) => toast(e.message, 'critical'),
  });

  const duplicate = useMutation({
    mutationFn: () => mutate<{ newProduct: { id: string } }>(PRODUCT_DUPLICATE, { productId: id, newTitle: dup!.title.trim(), includeImages: dup!.images, newStatus: dup!.status }, 'productDuplicate'),
    onSuccess: (r) => { setDup(null); toast(t('product.duplicated')); void qc.invalidateQueries({ queryKey: ['products'] }); guard.off = true; nav(`/products/${r.newProduct.id.split('/').pop()}`); },
    onError: (e) => toast(e.message, 'critical'),
  });

  const serverError = errors.server;
  const gallery = { remove: t('common.remove'), moveLeft: t('media.moveLeft'), moveRight: t('media.moveRight'), featured: t('media.featured'), alt: t('media.alt') };
  const seoUrl = `/products/${form.handle || slug(form.title) || 'handle'}`;
  const publicUrl = id ? (form.status === 'ACTIVE' ? seoUrl : previewUrl) : null;

  return (
    <>
      <SaveBar dirty={dirty} saving={save.isPending} onSave={() => save.mutate()} onDiscard={() => { setForm(initial); setErrors({}); }} />
      <PageHeader
        back="/products" breadcrumb={{ icon: <Tag className="size-4" />, label: t('nav.products'), to: '/products' }} title={id ? form.title || t('product.untitled') : t('product.addTitle')}
        actions={id && <>
          <ViewAs url={publicUrl} />
          <Button disabled={!previewUrl} onClick={() => { if (previewUrl) window.open(previewUrl, '_blank', 'noopener'); }}><Eye className="size-4" />{t('product.preview')}</Button>
          <Dropdown align="right" chevron disabled={dirty} title={dirty ? t('btn.share.saveFirst') : undefined} trigger={t('share.label')} items={[
            { key: 'copy', label: t('share.copyLink'), disabled: !publicUrl, onSelect: () => { void navigator.clipboard?.writeText(new URL(publicUrl!, window.location.origin).href).then(() => toast(t('share.copied')), () => toast(t('share.copyFailed'), 'critical')); } },
            { key: 'mail', label: t('share.email'), disabled: !publicUrl, onSelect: () => { window.location.href = `mailto:?subject=${encodeURIComponent(form.title)}&body=${encodeURIComponent(new URL(publicUrl!, window.location.origin).href)}`; } },
          ]} />
          <Dropdown align="right" chevron trigger={t('common.moreActions')} items={[
            { key: 'duplicate', icon: <Copy className="size-4" />, label: t('pv.duplicateProduct'), onSelect: () => setDup({ title: t('product.copyOf', { title: form.title }), images: true, status: 'DRAFT' }) },
            ...(form.status === 'ARCHIVED' ? [] : [{ key: 'archive', icon: <Archive className="size-4" />, label: t('pv.archiveProduct'), onSelect: () => set({ status: 'ARCHIVED' }) }]),
            ...(form.status === 'ACTIVE' ? [] : [{ key: 'activate', label: t('products.setActive'), onSelect: () => set({ status: 'ACTIVE' }) }]),
            { key: 'delete', icon: <Trash2 className="size-4" />, label: t('pv.deleteProduct'), danger: true, separatorBefore: true, onSelect: () => setConfirmDelete(true) },
          ]} />
          <PrevNext kind="products" gid={id} />
        </>}
      />
      {serverError && <div className="mb-4"><Banner>{typeof serverError === 'string' ? serverError : serverError.errors.map((e) => `${e.field?.join('.') ?? ''} ${e.message}`.trim()).join(' · ')}</Banner></div>}
      <div className="grid gap-x-6 gap-y-4 lg:grid-cols-[1fr_20rem]">
        <div className="flex min-w-0 flex-col gap-5">
          <div className="flex flex-wrap items-start gap-3" role="group" aria-label={t('product.media')}>
            {form.media.length > 0 && <MediaGallery compact onOpen={setViewing} openLabel={t('viewer.open')} items={form.media} onChange={(media) => set({ media })} canRemove={(i) => !isPersistedMedia(i)} labels={gallery} />}
            <div className={form.media.length ? undefined : 'w-full'}>
              <ImageUploader look={form.media.length ? 'tile' : 'band'} label={form.media.length ? t('media.upload') : t('pv.uploadBand')} onUploaded={(files) => set({ media: [...form.media, ...files.map((f): GalleryItem => ({ key: `new-${f.id}`, url: f.url, alt: f.filename }))] })} onError={(m) => toast(m, 'critical')} />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="product-title" className="text-[13px] text-muted">{t('field.title')}</label>
            <input id="product-title" required aria-invalid={!!errors.title} aria-describedby={errors.title ? 'product-title-error' : undefined} placeholder={t('product.titlePlaceholder')} value={form.title} onChange={(e) => set({ title: e.target.value })}
              className="field-control w-full !min-h-10 !text-xl !font-semibold" />
            {errors.title && <p id="product-title-error" className="text-xs text-critical">{errors.title}</p>}
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="sr-only">{t('field.description')}</span>
            <RichText value={form.descriptionHtml} onChange={(descriptionHtml) => set({ descriptionHtml })} />
          </div>

          {errors.price && <p className="-mb-2 text-xs text-critical">{errors.price}</p>}
          <VariantsManager options={form.options} variants={form.variants} locations={locations} currency={shop.currency} lockedCount={initial.options.length} giftCard={form.isGiftCard}
            media={form.media.filter(isPersistedMedia).map((m) => ({ id: m.key, url: m.url }))} onMetafields={id ? setVariantMf : undefined} onChange={(p) => set(p)} />

          {id && <MetafieldsEditor ownerId={id} ownerType="PRODUCT" />}

          <SeoListing flat title={form.title || t('product.untitled')} prefix={`${window.location.host}/products/`} handle={form.handle || slug(form.title)} onHandle={(handle) => set({ handle })} description={form.descriptionHtml}
            seoTitle={form.seoTitle} onSeoTitle={(seoTitle) => set({ seoTitle })} seoDescription={form.seoDescription} onSeoDescription={(seoDescription) => set({ seoDescription })}
            image={form.media[0]?.url} siteName={shop.name} />
        </div>

        <aside className="flex flex-col gap-4 lg:pt-1 [&>section]:border-t [&>section]:border-line [&>section]:pt-4 [&>section:first-child]:border-0 [&>section:first-child]:pt-0">
          <section className="flex flex-col gap-2">
            {form.isGiftCard && <p className="inline-flex w-fit items-center gap-1.5 rounded-full border border-line bg-surface px-2.5 py-0.5 text-xs"><Gift className="size-3.5" />{t('product.giftCardBadge')}</p>}
            <div className="flex items-center gap-2 text-[13px]">
              <span aria-hidden className={cx('size-2 shrink-0 rounded-full', form.status === 'ACTIVE' ? 'bg-success' : form.status === 'DRAFT' ? 'bg-attention' : 'bg-muted')} />
              <select aria-label={t('field.status')} value={form.status} onChange={(e) => set({ status: e.target.value as ProductForm['status'] })} className="-ml-1 min-w-0 flex-1 rounded-md bg-transparent px-1 py-1 font-medium outline-none hover:bg-hover focus-visible:outline-2 focus-visible:-outline-offset-1 focus-visible:outline-accent">
                <option value="ACTIVE">{t('status.ACTIVE')}</option>
                <option value="DRAFT">{t('status.DRAFT')}</option>
                <option value="ARCHIVED">{t('status.ARCHIVED')}</option>
              </select>
            </div>
          </section>

          <section className="flex flex-col gap-1">
            <InlineRow label={t('product.category')} hint={t('product.categoryHelp')}>
              {(p) => (
                <select {...p} className={cx(p.className, INLINE_SELECT)} value={form.category} onChange={(e) => set({ category: e.target.value })}>
                  <option value="">{t('product.noCategory')}</option>
                  {(cats.data?.taxonomy?.categories.nodes ?? []).map((c) => <option key={c.id} value={c.id}>{c.fullName}</option>)}
                </select>
              )}
            </InlineRow>
            <InlineRow label={t('field.productType')}>
              {(p) => <input {...p} list="types" placeholder={t('pv.none')} value={form.productType} onChange={(e) => set({ productType: e.target.value })} />}
            </InlineRow>
            <InlineRow label={t('field.vendor')}>
              {(p) => <input {...p} list="vendors" placeholder={t('pv.none')} value={form.vendor} onChange={(e) => set({ vendor: e.target.value })} />}
            </InlineRow>
            <InlineRow label={t('product.template')} hint={t('product.templateHelp')}>
              {(p) => <input {...p} placeholder={t('pv.defaultTemplate')} value={form.templateSuffix} onChange={(e) => set({ templateSuffix: e.target.value })} />}
            </InlineRow>
            <datalist id="vendors">{flattenStrings(filters.data?.productVendors).map((v) => <option key={v} value={v} />)}</datalist>
            <datalist id="types">{flattenStrings(filters.data?.productTypes).map((v) => <option key={v} value={v} />)}</datalist>
          </section>

          <section className="flex flex-col gap-2">
            <SideHead title={t('nav.collections')} action={{ label: t('product.addToCollection'), onClick: () => setPickCollections(true) }} />
            {form.collections.length > 0 && (
              <ul className="flex flex-wrap gap-1.5">
                {form.collections.map((c) => <Chip key={c.id} removeLabel={`${t('common.remove')} ${c.title}`} onRemove={() => set({ collections: form.collections.filter((x) => x.id !== c.id) })}>{c.title}</Chip>)}
              </ul>
            )}
          </section>

          <section>
            <InlineTags label={t('field.tags')} placeholder={t('pv.addTags')} value={form.tags} onChange={(tags) => set({ tags })} suggestions={flattenStrings(filters.data?.productTags)} removeLabel={t('common.remove')} />
          </section>
        </aside>
      </div>
      <Modal open={!!variantMf} onClose={() => setVariantMf(null)} closeLabel={t('common.close')} title={t('mf.variantMetafields')} wide>
        {variantMf && <MetafieldsEditor ownerId={variantMf} ownerType="PRODUCTVARIANT" title={form.variants.find((v) => v.id === variantMf)?.optionValues.join(' / ') || t('mf.title')} />}
      </Modal>
      <MediaViewer items={form.media.map((m) => ({ key: m.key, url: m.url, name: m.url.split('/').pop()?.split('?')[0] ?? '', alt: m.alt ?? '', usedIn: `${t('nav.products')} (1)` }))} index={viewing} onIndexChange={setViewing} onClose={() => setViewing(null)}
        onSave={(item, change) => set({ media: form.media.map((m) => (m.key === item.key ? { ...m, alt: change.alt } : m)) })}
        labels={{ close: t('common.close'), info: t('viewer.info'), name: t('viewer.name'), alt: t('viewer.alt'), details: t('viewer.details'), usedIn: t('viewer.usedIn'), save: t('viewer.save'), counter: (i, n) => t('viewer.counter', { i, n }), previous: t('viewer.previous'), next: t('viewer.next'), download: t('viewer.download') }} />
      <CollectionPicker open={pickCollections} onClose={() => setPickCollections(false)} excludeIds={form.collections.map((c) => c.id)} onConfirm={(c) => set({ collections: [...form.collections, ...c.map((x) => ({ id: x.id, title: x.title }))] })} />
      <Modal open={!!dup} onClose={() => setDup(null)} medium closeLabel={t('common.close')} title={t('product.duplicateTitle')}
        footer={<><Button onClick={() => setDup(null)}>{t('common.cancel')}</Button><Button variant="primary" loading={duplicate.isPending} disabled={!dup?.title.trim()} onClick={() => duplicate.mutate()}>{t('product.duplicateConfirm')}</Button></>}>
        {dup && (
          <div className="grid gap-4">
            <Input label={t('field.title')} value={dup.title} onChange={(e) => setDup({ ...dup, title: e.target.value })} />
            <fieldset className="grid gap-1.5"><legend className="mb-1 text-[13px] font-medium">{t('product.duplicateDetails')}</legend>
              <Checkbox label={t('product.duplicateMedia')} checked={dup.images} onChange={(e) => setDup({ ...dup, images: e.target.checked })} />
            </fieldset>
            <fieldset className="grid gap-1.5"><legend className="mb-1 text-[13px] font-medium">{t('product.duplicateStatus')}</legend>
              {(['DRAFT', 'ACTIVE'] as const).map((st) => (
                <label key={st} className="inline-flex items-center gap-2 text-[13px]"><input type="radio" name="dup-status" checked={dup.status === st} onChange={() => setDup({ ...dup, status: st })} />{t(st === 'DRAFT' ? 'product.duplicateAsDraft' : 'product.duplicateAsActive')}</label>
              ))}
            </fieldset>
          </div>
        )}
      </Modal>
      <ConfirmDialog open={confirmDelete} onClose={() => setConfirmDelete(false)} danger title={t('product.deleteTitle')} message={t('products.deleteBody')} confirmLabel={t('common.delete')} cancelLabel={t('common.cancel')} onConfirm={() => { setConfirmDelete(false); del.mutate(); }} />
    </>
  );
}
