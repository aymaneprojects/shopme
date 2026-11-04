import { Banner, Button, Card, ConfirmDialog, Dropdown, ImageUploader, Input, MediaGallery, RichTextEditor, Select, Skeleton, TagInput, Textarea, useToast } from '@shopme/ui';
import type { GalleryItem } from '@shopme/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MoreHorizontal, Plus, X } from 'lucide-react';
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { UserErrors, gql, mutate } from '../api';
import { CollectionPicker } from '../components/Pickers';
import { PageHeader } from '../components/PageHeader';
import { SaveBar, guard } from '../components/SaveBar';
import { InventoryFields, OptionsEditor, PricingFields, ShippingFields, VariantsTable } from '../components/VariantsEditor';
import { formatMoney, numToGid } from '../format';
import { LOCATIONS, PRODUCT, PRODUCT_DELETE, PRODUCT_FILTER_OPTIONS } from '../graphql';
import { useI18n } from '../i18n';
import { flattenStrings } from '../lib/hooks';
import { createProduct, emptyForm, formFromProduct, isPersistedMedia, updateProduct, validate } from '../lib/product-form';
import type { ApiProduct, LocationRef, ProductForm } from '../lib/product-form';
import { useShop } from '../session';

/** Loads the product (or a blank form) and locations, then mounts the form. */
export function ProductEditPage() {
  const { id = 'new' } = useParams();
  const isNew = id === 'new';
  const locs = useQuery({ queryKey: ['locations'], queryFn: () => gql<{ locations: { nodes: Array<LocationRef & { isActive: boolean }> } }>(LOCATIONS) });
  const prod = useQuery({ queryKey: ['product', id], enabled: !isNew, queryFn: () => gql<{ product: ApiProduct | null }>(PRODUCT, { id: numToGid('Product', id) }) });
  const { t } = useI18n();

  if (locs.isLoading || (!isNew && prod.isLoading)) return <div className="grid gap-4"><Skeleton className="h-8 w-64" /><Skeleton className="h-64" /></div>;
  const error = locs.error ?? prod.error;
  if (error) return <Banner>{error.message}</Banner>;
  const locations = (locs.data?.locations.nodes ?? []).filter((l) => l.isActive !== false);
  if (!isNew && !prod.data?.product) return <Banner>{t('product.notFound')}</Banner>;
  const initial = isNew ? emptyForm(locations) : formFromProduct(prod.data!.product!, locations);
  return <ProductFormView key={`${id}:${prod.dataUpdatedAt}`} id={isNew ? null : numToGid('Product', id)} initial={initial} locations={locations} />;
}

const stripHtml = (h: string) => h.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
const slug = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

function ProductFormView({ id, initial: initialProp, locations }: { id: string | null; initial: ProductForm; locations: LocationRef[] }) {
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
  const set = (p: Partial<ProductForm>) => setForm((f) => ({ ...f, ...p }));
  const dirty = JSON.stringify(form) !== JSON.stringify(initial);
  const filters = useQuery({ queryKey: ['product-filter-options'], queryFn: () => gql<Record<'productTypes' | 'productVendors' | 'productTags', { edges: Array<{ node: string }> }>>(PRODUCT_FILTER_OPTIONS), staleTime: 60_000 });

  const single = form.options.length === 0;
  const first = form.variants[0]!;
  const patchFirst = (p: Partial<typeof first>) => set({ variants: [{ ...first, ...p }, ...form.variants.slice(1)] });

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

  const serverError = errors.server;
  const gallery = { remove: t('common.remove'), moveLeft: t('media.moveLeft'), moveRight: t('media.moveRight'), featured: t('media.featured'), alt: t('media.alt') };
  const seoTitle = form.seoTitle || form.title || t('product.untitled');
  const seoUrl = `/products/${form.handle || slug(form.title) || 'handle'}`;

  return (
    <>
      <SaveBar dirty={dirty} saving={save.isPending} onSave={() => save.mutate()} onDiscard={() => { setForm(initial); setErrors({}); }} />
      <PageHeader
        back="/products" title={id ? form.title || t('product.untitled') : t('product.addTitle')}
        actions={id && <Dropdown align="right" label={t('common.moreActions')} trigger={<MoreHorizontal className="size-4" />} items={[{ key: 'delete', label: t('common.delete'), danger: true, onSelect: () => setConfirmDelete(true) }]} />}
      />
      {serverError && <div className="mb-4"><Banner>{typeof serverError === 'string' ? serverError : serverError.errors.map((e) => `${e.field?.join('.') ?? ''} ${e.message}`.trim()).join(' · ')}</Banner></div>}
      <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
        <div className="flex flex-col gap-4">
          <Card>
            <div className="flex flex-col gap-3">
              <Input label={t('field.title')} required placeholder={t('product.titlePlaceholder')} value={form.title} error={errors.title} onChange={(e) => set({ title: e.target.value })} />
              <div className="flex flex-col gap-1">
                <span className="text-sm font-medium">{t('field.description')}</span>
                <RichTextEditor value={form.descriptionHtml} onChange={(descriptionHtml) => set({ descriptionHtml })}
                  labels={{ bold: t('rte.bold'), italic: t('rte.italic'), underline: t('rte.underline'), list: t('rte.list'), orderedList: t('rte.orderedList'), link: t('rte.link'), source: t('rte.source'), paragraph: t('rte.paragraph'), heading: t('rte.heading'), subheading: t('rte.subheading'), linkPrompt: t('rte.linkPrompt') }} />
              </div>
            </div>
          </Card>

          <Card title={t('product.media')}>
            <div className="flex flex-col gap-3">
              <MediaGallery items={form.media} onChange={(media) => set({ media })} canRemove={(i) => !isPersistedMedia(i)} labels={gallery} />
              <ImageUploader label={t('media.upload')} onUploaded={(files) => set({ media: [...form.media, ...files.map((f): GalleryItem => ({ key: `new-${f.id}`, url: f.url, alt: f.filename }))] })} onError={(m) => toast(m, 'critical')} />
            </div>
          </Card>

          {single && (
            <>
              <Card title={t('product.pricing')}>{errors.price && <p className="mb-2 text-xs text-critical">{errors.price}</p>}<PricingFields v={first} patch={patchFirst} currency={shop.currency} /></Card>
              <Card title={t('product.inventory')}><InventoryFields v={first} patch={patchFirst} locations={locations} /></Card>
              <Card title={t('product.shipping')}><ShippingFields v={first} patch={patchFirst} /></Card>
            </>
          )}

          <Card title={t('product.variants')}>
            <div className="flex flex-col gap-4">
              <OptionsEditor options={form.options} variants={form.variants} lockedCount={initial.options.length} onChange={(o) => set(o)} />
              {!single && (
                <>
                  <p className="text-sm text-muted">{t('variants.count', { n: form.variants.length })}</p>
                  {errors.price && <p className="text-xs text-critical">{errors.price}</p>}
                  <VariantsTable variants={form.variants} locations={locations} currency={shop.currency} onChange={(variants) => set({ variants })} />
                </>
              )}
            </div>
          </Card>

          <Card title={t('product.seo')}>
            <div className="flex flex-col gap-3">
              <div className="rounded-md border border-line bg-surface p-3">
                <p className="truncate text-base text-primary">{seoTitle}</p>
                <p className="truncate text-xs text-success">{window.location.host}{seoUrl}</p>
                <p className="line-clamp-2 text-sm text-muted">{form.seoDescription || stripHtml(form.descriptionHtml) || t('product.seoEmpty')}</p>
              </div>
              <Input label={t('product.seoTitle')} value={form.seoTitle} help={t('product.chars', { n: form.seoTitle.length, max: 70 })} onChange={(e) => set({ seoTitle: e.target.value })} />
              <Textarea label={t('product.seoDescription')} value={form.seoDescription} help={t('product.chars', { n: form.seoDescription.length, max: 160 })} onChange={(e) => set({ seoDescription: e.target.value })} />
              <Input label={t('product.handle')} value={form.handle} placeholder={slug(form.title)} onChange={(e) => set({ handle: e.target.value })} />
            </div>
          </Card>
        </div>

        <div className="flex flex-col gap-4">
          <Card title={t('field.status')}>
            <Select aria-label={t('field.status')} value={form.status} onChange={(e) => set({ status: e.target.value as ProductForm['status'] })}>
              <option value="ACTIVE">{t('status.ACTIVE')}</option>
              <option value="DRAFT">{t('status.DRAFT')}</option>
              <option value="ARCHIVED">{t('status.ARCHIVED')}</option>
            </Select>
          </Card>
          <Card title={t('product.organization')}>
            <div className="flex flex-col gap-3">
              <Input label={t('field.vendor')} list="vendors" value={form.vendor} onChange={(e) => set({ vendor: e.target.value })} />
              <datalist id="vendors">{flattenStrings(filters.data?.productVendors).map((v) => <option key={v} value={v} />)}</datalist>
              <Input label={t('field.productType')} list="types" value={form.productType} onChange={(e) => set({ productType: e.target.value })} />
              <datalist id="types">{flattenStrings(filters.data?.productTypes).map((v) => <option key={v} value={v} />)}</datalist>
              <div className="flex flex-col gap-1.5">
                <span className="text-sm font-medium">{t('nav.collections')}</span>
                <ul className="flex flex-wrap gap-1.5">
                  {form.collections.map((c) => (
                    <li key={c.id} className="inline-flex items-center gap-1 rounded-full border border-line bg-surface px-2 py-0.5 text-xs">
                      {c.title}<button type="button" aria-label={`${t('common.remove')} ${c.title}`} onClick={() => set({ collections: form.collections.filter((x) => x.id !== c.id) })}><X className="size-3" /></button>
                    </li>
                  ))}
                </ul>
                <div><Button size="sm" onClick={() => setPickCollections(true)}><Plus className="size-4" />{t('product.addToCollection')}</Button></div>
              </div>
              <TagInput label={t('field.tags')} value={form.tags} onChange={(tags) => set({ tags })} suggestions={flattenStrings(filters.data?.productTags)} removeLabel={t('common.remove')} />
              <Input label={t('product.template')} help={t('product.templateHelp')} value={form.templateSuffix} onChange={(e) => set({ templateSuffix: e.target.value })} />
            </div>
          </Card>
        </div>
      </div>
      <CollectionPicker open={pickCollections} onClose={() => setPickCollections(false)} excludeIds={form.collections.map((c) => c.id)} onConfirm={(c) => set({ collections: [...form.collections, ...c.map((x) => ({ id: x.id, title: x.title }))] })} />
      <ConfirmDialog open={confirmDelete} onClose={() => setConfirmDelete(false)} danger title={t('product.deleteTitle')} message={t('products.deleteBody')} confirmLabel={t('common.delete')} cancelLabel={t('common.cancel')} onConfirm={() => { setConfirmDelete(false); del.mutate(); }} />
    </>
  );
}
