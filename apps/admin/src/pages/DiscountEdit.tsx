import { Badge, Banner, Button, Card, Checkbox, ConfirmDialog, Dropdown, Input, Select, Skeleton, useToast } from '@shopme/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MoreHorizontal, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import { UserErrors, gql, mutate } from '../api';
import { CollectionPicker, ProductPicker } from '../components/Pickers';
import { PageHeader } from '../components/PageHeader';
import { SaveBar, guard } from '../components/SaveBar';
import { useFormat } from '../components/shared';
import { gidToNum, numToGid } from '../format';
import {
  CODE_DISCOUNT_NODE, DISCOUNT_CODE_ACTIVATE, DISCOUNT_CODE_BASIC_CREATE, DISCOUNT_CODE_BASIC_UPDATE, DISCOUNT_CODE_DEACTIVATE, DISCOUNT_CODE_DELETE,
  DISCOUNT_CODE_FREE_SHIPPING_CREATE, DISCOUNT_CODE_FREE_SHIPPING_UPDATE,
} from '../graphql';
import { useI18n } from '../i18n';
import type { Key } from '../i18n';
import { blankDiscount, fromDiscountNode, generateCode, summarizeDiscount, toDiscountInput, validateDiscount } from '../lib/discount-form';
import type { DiscountForm, DiscountKind } from '../lib/discount-form';
import { useShop } from '../session';

type Loaded = Parameters<typeof fromDiscountNode>[0] & { status: string };

export function DiscountEditPage() {
  const { id = 'new' } = useParams();
  const [sp] = useSearchParams();
  const isNew = id === 'new';
  const { t } = useI18n();
  const gid = numToGid('DiscountCodeNode', id);
  const q = useQuery({ queryKey: ['discount', gid], enabled: !isNew, queryFn: () => gql<{ codeDiscountNode: { id: string; codeDiscount: Loaded } | null }>(CODE_DISCOUNT_NODE, { id: gid }) });
  if (!isNew && q.isLoading) return <div className="grid gap-4"><Skeleton className="h-8 w-64" /><Skeleton className="h-64" /></div>;
  if (q.error) return <Banner>{q.error.message}</Banner>;
  if (!isNew && !q.data?.codeDiscountNode) return <Banner>{t('discounts.notFound')}</Banner>;
  const node = q.data?.codeDiscountNode;
  const kind = (['order', 'product', 'shipping'].includes(sp.get('type') ?? '') ? sp.get('type') : 'order') as DiscountKind;
  return <DiscountFormView key={`${id}:${q.dataUpdatedAt}`} id={node ? gid : null} status={node?.codeDiscount.status} initial={node ? fromDiscountNode(node.codeDiscount) : blankDiscount(kind)} />;
}

function DiscountFormView({ id, status, initial }: { id: string | null; status?: string; initial: DiscountForm }) {
  const { t } = useI18n();
  const nav = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();
  const fmt = useFormat();
  const { shop } = useShop();
  const [form, setForm] = useState(initial);
  const [errors, setErrors] = useState<ReturnType<typeof validateDiscount>>({});
  const [error, setError] = useState<string | null>(null);
  const [picking, setPicking] = useState<'products' | 'collections' | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const set = (p: Partial<DiscountForm>) => setForm((f) => ({ ...f, ...p }));
  const dirty = JSON.stringify(form) !== JSON.stringify(initial);
  const err = (k: keyof typeof errors) => (errors[k] ? t(errors[k] as Key) : null);
  const shipping = form.kind === 'shipping';

  const save = useMutation({
    mutationFn: async () => {
      const e = validateDiscount(form);
      setErrors(e);
      if (Object.keys(e).length) throw new Error('validation');
      setError(null);
      const input = toDiscountInput(form, id ? { collections: initial.collections.map((c) => c.id), products: initial.products.map((p) => p.id) } : undefined);
      const [doc, key, root] = shipping
        ? [id ? DISCOUNT_CODE_FREE_SHIPPING_UPDATE : DISCOUNT_CODE_FREE_SHIPPING_CREATE, 'freeShippingCodeDiscount', id ? 'discountCodeFreeShippingUpdate' : 'discountCodeFreeShippingCreate']
        : [id ? DISCOUNT_CODE_BASIC_UPDATE : DISCOUNT_CODE_BASIC_CREATE, 'basicCodeDiscount', id ? 'discountCodeBasicUpdate' : 'discountCodeBasicCreate'];
      const r = await mutate<{ codeDiscountNode: { id: string } }>(doc!, { ...(id && { id }), [key!]: input }, root!);
      return r.codeDiscountNode.id;
    },
    onSuccess: (nid) => { toast(t('discounts.saved')); void qc.invalidateQueries({ queryKey: ['discounts'] }); void qc.invalidateQueries({ queryKey: ['discount'] }); guard.off = true; nav(`/discounts/${gidToNum(nid)}`, { replace: true }); },
    onError: (e) => { if (e.message !== 'validation') setError(e instanceof UserErrors ? e.errors.map((x) => x.message).join(' · ') : e.message); },
  });
  const toggle = useMutation({
    mutationFn: () => (status === 'ACTIVE' ? mutate(DISCOUNT_CODE_DEACTIVATE, { id }, 'discountCodeDeactivate') : mutate(DISCOUNT_CODE_ACTIVATE, { id }, 'discountCodeActivate')),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['discount'] }); void qc.invalidateQueries({ queryKey: ['discounts'] }); },
    onError: (e) => toast(e.message, 'critical'),
  });
  const del = useMutation({
    mutationFn: () => mutate(DISCOUNT_CODE_DELETE, { id }, 'discountCodeDelete'),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['discounts'] }); guard.off = true; nav('/discounts'); },
    onError: (e) => toast(e.message, 'critical'),
  });
  const summary = summarizeDiscount(form, t, (n) => fmt.money({ amount: String(n), currencyCode: shop.currency }));
  const refList = (kind: 'collections' | 'products') => (
    <ul className="mt-2 divide-y divide-line">
      {form[kind].map((r) => (
        <li key={r.id} className="flex items-center gap-2 py-1.5 text-sm"><span className="flex-1">{r.title}</span>
          <button type="button" aria-label={`${t('common.remove')} ${r.title}`} className="rounded p-1 text-muted hover:bg-surface" onClick={() => set({ [kind]: form[kind].filter((x) => x.id !== r.id) })}><Trash2 className="size-4" /></button></li>
      ))}
    </ul>
  );
  const combos = [['productDiscounts', 'discount.combine.product'], ['orderDiscounts', 'discount.combine.order'], ['shippingDiscounts', 'discount.combine.shipping']] as const;

  return (
    <>
      <SaveBar dirty={dirty} saving={save.isPending} onSave={() => save.mutate()} onDiscard={() => { setForm(initial); setErrors({}); }} />
      <PageHeader back="/discounts"
        title={<span className="flex items-center gap-2">{id ? form.code : t(`discounts.kind.${form.kind}` as Key)}{status && <Badge tone={status === 'ACTIVE' ? 'success' : 'neutral'}>{t(`discounts.status.${status}` as Key)}</Badge>}</span>}
        actions={<>
          {!id && <Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>{t('save.save')}</Button>}
          {id && <Dropdown align="right" label={t('common.moreActions')} trigger={<MoreHorizontal className="size-4" />} items={[
            { key: 'toggle', label: status === 'ACTIVE' ? t('discounts.deactivate') : t('discounts.activate'), onSelect: () => toggle.mutate() },
            { key: 'delete', label: t('common.delete'), danger: true, onSelect: () => setConfirmDelete(true) },
          ]} />}
        </>} />
      {error && <div className="mb-4"><Banner>{error}</Banner></div>}
      <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
        <div className="flex flex-col gap-4">
          <Card title={t('discount.method')}>
            <div className="flex items-end gap-2">
              <Input className="flex-1" label={t('discounts.code')} help={t('discount.codeHelp')} value={form.code} error={err('code')} onChange={(e) => set({ code: e.target.value.toUpperCase() })} />
              <Button onClick={() => set({ code: generateCode() })}>{t('discount.generate')}</Button>
            </div>
          </Card>

          {!shipping && (
            <Card title={t('discount.value')}>
              <div className="flex flex-col gap-3">
                <div className="flex gap-2">
                  <Select label={t('discount.valueType')} value={form.valueType} onChange={(e) => set({ valueType: e.target.value as DiscountForm['valueType'] })}>
                    <option value="percentage">{t('discount.percentage')}</option><option value="fixed">{t('discount.fixed')}</option>
                  </Select>
                  <Input className="flex-1" label={form.valueType === 'percentage' ? '%' : shop.currency} inputMode="decimal" value={form.value} error={err('value')} onChange={(e) => set({ value: e.target.value })} />
                </div>
                {form.kind === 'product' && (
                  <div>
                    <Select label={t('discount.appliesTo')} value={form.appliesTo} onChange={(e) => set({ appliesTo: e.target.value as DiscountForm['appliesTo'] })}>
                      <option value="collections">{t('discount.specificCollections')}</option><option value="products">{t('discount.specificProducts')}</option>
                    </Select>
                    <div className="mt-2"><Button size="sm" onClick={() => setPicking(form.appliesTo === 'products' ? 'products' : 'collections')}>{t('discount.browse')}</Button></div>
                    {refList(form.appliesTo === 'products' ? 'products' : 'collections')}
                    {errors.targets && <p className="mt-1 text-xs text-critical">{t(errors.targets)}</p>}
                  </div>
                )}
              </div>
            </Card>
          )}

          {shipping && (
            <Card title={t('discount.shippingRates')}>
              <Checkbox label={t('discount.excludeOver')} checked={form.hasMaxShipping} onChange={(e) => set({ hasMaxShipping: e.target.checked })} />
              {form.hasMaxShipping && <Input className="mt-2 max-w-48" label={shop.currency} inputMode="decimal" value={form.maxShipping} error={err('maxShipping')} onChange={(e) => set({ maxShipping: e.target.value })} />}
            </Card>
          )}

          <Card title={t('discount.minimum')}>
            <div className="flex flex-col gap-3">
              <Select label={t('discount.minimumType')} value={form.minType} onChange={(e) => set({ minType: e.target.value as DiscountForm['minType'] })}>
                <option value="none">{t('discount.minNone')}</option><option value="subtotal">{t('discount.minSubtotal')}</option><option value="quantity">{t('discount.minQuantity')}</option>
              </Select>
              {form.minType !== 'none' && <Input className="max-w-48" label={form.minType === 'subtotal' ? shop.currency : t('discount.items')} inputMode="decimal" value={form.minValue} error={err('minValue')} onChange={(e) => set({ minValue: e.target.value })} />}
            </div>
          </Card>

          <Card title={t('discount.limits')}>
            <div className="flex flex-col gap-3">
              <Checkbox label={t('discount.limitTotal')} checked={form.limitTotal} onChange={(e) => set({ limitTotal: e.target.checked })} />
              {form.limitTotal && <Input className="max-w-48" aria-label={t('discount.limitTotal')} inputMode="numeric" value={form.usageLimit} error={err('usageLimit')} onChange={(e) => set({ usageLimit: e.target.value })} />}
              <Checkbox label={t('discount.oncePerCustomer')} checked={form.oncePerCustomer} onChange={(e) => set({ oncePerCustomer: e.target.checked })} />
            </div>
          </Card>

          <Card title={t('discount.combinations')}>
            <div className="flex flex-col gap-2">
              {combos.map(([k, label]) => <Checkbox key={k} label={t(label)} checked={form.combines[k]} onChange={(e) => set({ combines: { ...form.combines, [k]: e.target.checked } })} />)}
            </div>
          </Card>

          <Card title={t('discount.dates')}>
            <div className="flex flex-col gap-3">
              <Input className="max-w-64" type="datetime-local" label={t('discount.startsAt')} value={form.startsAt} onChange={(e) => set({ startsAt: e.target.value })} />
              <Checkbox label={t('discount.setEnd')} checked={form.hasEnd} onChange={(e) => set({ hasEnd: e.target.checked })} />
              {form.hasEnd && <Input className="max-w-64" type="datetime-local" label={t('discount.endsAt')} value={form.endsAt} error={err('endsAt')} onChange={(e) => set({ endsAt: e.target.value })} />}
              <p className="text-xs text-muted">{t('discount.timezone', { tz: shop.timezone })}</p>
            </div>
          </Card>
        </div>
        <div>
          <Card title={t('discount.summary')} className="sticky top-16">
            <ul className="list-disc space-y-1 pl-4 text-sm">{summary.map((s, i) => <li key={i}>{s}</li>)}</ul>
          </Card>
        </div>
      </div>
      <ProductPicker open={picking === 'products'} onClose={() => setPicking(null)} excludeIds={form.products.map((p) => p.id)} onConfirm={(p) => set({ products: [...form.products, ...p.map((x) => ({ id: x.id, title: x.title }))] })} />
      <CollectionPicker open={picking === 'collections'} onClose={() => setPicking(null)} excludeIds={form.collections.map((c) => c.id)} onConfirm={(c) => set({ collections: [...form.collections, ...c.map((x) => ({ id: x.id, title: x.title }))] })} />
      <ConfirmDialog open={confirmDelete} onClose={() => setConfirmDelete(false)} danger title={t('discounts.deleteTitle', { n: 1 })} message={t('discounts.deleteBody')} confirmLabel={t('common.delete')} cancelLabel={t('common.cancel')} onConfirm={() => { setConfirmDelete(false); del.mutate(); }} />
    </>
  );
}
