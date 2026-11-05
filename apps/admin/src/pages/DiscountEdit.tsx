import { Badge, Banner, Button, ButtonGroup, Card, Checkbox, ConfirmDialog, Dropdown, Input, Modal, Select, Skeleton, useToast } from '@shopme/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MoreHorizontal, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import { UserErrors, gql, mutate } from '../api';
import { usePublications } from '../components/Channels';
import { EligibilityCard, TagsCard } from '../components/EligibilityCard';
import { GenerateCodesCard } from '../components/GenerateCodes';
import { CollectionPicker, ProductPicker } from '../components/Pickers';
import { PageHeader } from '../components/PageHeader';
import { SaveBar, guard } from '../components/SaveBar';
import { useFormat } from '../components/shared';
import { gidToNum, numToGid } from '../format';
import {
  DISCOUNT_AUTOMATIC_ACTIVATE, DISCOUNT_AUTOMATIC_BASIC_CREATE, DISCOUNT_AUTOMATIC_BASIC_UPDATE, DISCOUNT_AUTOMATIC_BXGY_CREATE, DISCOUNT_AUTOMATIC_BXGY_UPDATE, DISCOUNT_AUTOMATIC_DEACTIVATE,
  DISCOUNT_AUTOMATIC_DELETE, DISCOUNT_AUTOMATIC_FREE_SHIPPING_CREATE, DISCOUNT_AUTOMATIC_FREE_SHIPPING_UPDATE, DISCOUNT_CODE_ACTIVATE, DISCOUNT_CODE_BASIC_CREATE, DISCOUNT_CODE_BASIC_UPDATE,
  DISCOUNT_CODE_BXGY_CREATE, DISCOUNT_CODE_BXGY_UPDATE, DISCOUNT_CODE_DEACTIVATE, DISCOUNT_CODE_DELETE, DISCOUNT_CODE_FREE_SHIPPING_CREATE, DISCOUNT_CODE_FREE_SHIPPING_UPDATE, DISCOUNT_NODE,
} from '../graphql';
import { useI18n } from '../i18n';
import type { Key } from '../i18n';
import { blankDiscount, fromDiscountNode, generateCode, summarizeDiscount, toDiscountInput, validateDiscount } from '../lib/discount-form';
import type { BxgyForm, DiscountForm, DiscountKind, DiscountMethod, PurchaseType, Ref } from '../lib/discount-form';
import { useShop } from '../session';

type Loaded = Parameters<typeof fromDiscountNode>[0] & { status: string };
const KINDS: DiscountKind[] = ['order', 'product', 'shipping', 'bxgy'];

/** [create doc, update doc, input variable, create root, update root] for a discount type and method. */
function ops(kind: DiscountKind, method: DiscountMethod) {
  const t = {
    code: {
      order: [DISCOUNT_CODE_BASIC_CREATE, DISCOUNT_CODE_BASIC_UPDATE, 'basicCodeDiscount', 'discountCodeBasicCreate', 'discountCodeBasicUpdate'],
      shipping: [DISCOUNT_CODE_FREE_SHIPPING_CREATE, DISCOUNT_CODE_FREE_SHIPPING_UPDATE, 'freeShippingCodeDiscount', 'discountCodeFreeShippingCreate', 'discountCodeFreeShippingUpdate'],
      bxgy: [DISCOUNT_CODE_BXGY_CREATE, DISCOUNT_CODE_BXGY_UPDATE, 'bxgyCodeDiscount', 'discountCodeBxgyCreate', 'discountCodeBxgyUpdate'],
    },
    automatic: {
      order: [DISCOUNT_AUTOMATIC_BASIC_CREATE, DISCOUNT_AUTOMATIC_BASIC_UPDATE, 'automaticBasicDiscount', 'discountAutomaticBasicCreate', 'discountAutomaticBasicUpdate'],
      shipping: [DISCOUNT_AUTOMATIC_FREE_SHIPPING_CREATE, DISCOUNT_AUTOMATIC_FREE_SHIPPING_UPDATE, 'freeShippingAutomaticDiscount', 'discountAutomaticFreeShippingCreate', 'discountAutomaticFreeShippingUpdate'],
      bxgy: [DISCOUNT_AUTOMATIC_BXGY_CREATE, DISCOUNT_AUTOMATIC_BXGY_UPDATE, 'automaticBxgyDiscount', 'discountAutomaticBxgyCreate', 'discountAutomaticBxgyUpdate'],
    },
  } as const;
  return t[method][kind === 'product' ? 'order' : kind];
}

export function DiscountEditPage() {
  const { id = 'new' } = useParams();
  const [sp] = useSearchParams();
  const isNew = id === 'new';
  const { t } = useI18n();
  const gid = numToGid('DiscountNode', id);
  const q = useQuery({ queryKey: ['discount', gid], enabled: !isNew, queryFn: () => gql<{ discountNode: { id: string; discount: Loaded } | null }>(DISCOUNT_NODE, { id: gid }) });
  if (!isNew && q.isLoading) return <div className="grid gap-4"><Skeleton className="h-8 w-64" /><Skeleton className="h-64" /></div>;
  if (q.error) return <Banner>{q.error.message}</Banner>;
  if (!isNew && !q.data?.discountNode) return <Banner>{t('discounts.notFound')}</Banner>;
  const node = q.data?.discountNode;
  const kind = (KINDS.includes(sp.get('type') as DiscountKind) ? sp.get('type') : 'order') as DiscountKind;
  const method = (sp.get('method') === 'automatic' ? 'automatic' : 'code') as DiscountMethod;
  return <DiscountFormView key={`${id}:${q.dataUpdatedAt}`} id={node?.id ?? null} status={node?.discount.status} initial={node ? fromDiscountNode(node.discount) : blankDiscount(kind, method)} />;
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
  const [picking, setPicking] = useState<'products' | 'collections' | 'buyProducts' | 'buyCollections' | 'getProducts' | 'getCollections' | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [editingCombos, setEditingCombos] = useState<DiscountForm['combines'] | null>(null);
  const pubs = usePublications();
  const set = (p: Partial<DiscountForm>) => setForm((f) => ({ ...f, ...p }));
  const setBxgy = (p: Partial<BxgyForm>) => setForm((f) => ({ ...f, bxgy: { ...f.bxgy, ...p } }));
  const dirty = JSON.stringify(form) !== JSON.stringify(initial);
  const err = (k: keyof typeof errors) => (errors[k] ? t(errors[k] as Key) : null);
  const shipping = form.kind === 'shipping';
  const bxgy = form.kind === 'bxgy';
  const automatic = form.method === 'automatic';
  const automaticId = !!id && id.includes('DiscountAutomaticNode');

  const save = useMutation({
    mutationFn: async () => {
      const e = validateDiscount(form);
      setErrors(e);
      if (Object.keys(e).length) throw new Error('validation');
      setError(null);
      const input = toDiscountInput(form, id ? { collections: initial.collections.map((c) => c.id), products: initial.products.map((p) => p.id), segments: initial.segments.map((s) => s.id), customers: initial.customers.map((c) => c.id) } : undefined);
      const [createDoc, updateDoc, key, createRoot, updateRoot] = ops(form.kind, form.method);
      const r = await mutate<Record<string, { id: string }>>(id ? updateDoc : createDoc, { ...(id && { id }), [key]: input }, id ? updateRoot : createRoot);
      return (r.codeDiscountNode ?? r.automaticDiscountNode)!.id;
    },
    onSuccess: (nid) => { toast(t('discounts.saved')); void qc.invalidateQueries({ queryKey: ['discounts'] }); void qc.invalidateQueries({ queryKey: ['discount'] }); guard.off = true; nav(`/discounts/${gidToNum(nid)}`, { replace: true }); },
    onError: (e) => { if (e.message !== 'validation') setError(e instanceof UserErrors ? e.errors.map((x) => x.message).join(' · ') : e.message); },
  });
  const toggle = useMutation({
    mutationFn: () => {
      const on = status !== 'ACTIVE';
      return automaticId ? mutate(on ? DISCOUNT_AUTOMATIC_ACTIVATE : DISCOUNT_AUTOMATIC_DEACTIVATE, { id }, on ? 'discountAutomaticActivate' : 'discountAutomaticDeactivate')
        : mutate(on ? DISCOUNT_CODE_ACTIVATE : DISCOUNT_CODE_DEACTIVATE, { id }, on ? 'discountCodeActivate' : 'discountCodeDeactivate');
    },
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['discount'] }); void qc.invalidateQueries({ queryKey: ['discounts'] }); },
    onError: (e) => toast(e.message, 'critical'),
  });
  const del = useMutation({
    mutationFn: () => (automaticId ? mutate(DISCOUNT_AUTOMATIC_DELETE, { id }, 'discountAutomaticDelete') : mutate(DISCOUNT_CODE_DELETE, { id }, 'discountCodeDelete')),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['discounts'] }); guard.off = true; nav('/discounts'); },
    onError: (e) => toast(e.message, 'critical'),
  });
  const summary = summarizeDiscount(form, t, (n) => fmt.money({ amount: String(n), currencyCode: shop.currency }));
  const refList = (items: Ref[], remove: (id: string) => void) => (
    <ul className="mt-2 divide-y divide-line">
      {items.map((r) => (
        <li key={r.id} className="flex items-center gap-2 py-1.5 text-[13px]"><span className="flex-1">{r.title}</span>
          <button type="button" aria-label={`${t('common.remove')} ${r.title}`} className="rounded p-1 text-muted hover:bg-surface" onClick={() => remove(r.id)}><Trash2 className="size-4" /></button></li>
      ))}
    </ul>
  );
  const without = (items: Ref[], rid: string) => items.filter((x) => x.id !== rid);
  /** Pick what a rule applies to: collections or specific products, with the chosen items listed under it. */
  const targets = (label: string, as: 'collections' | 'products', onAs: (v: 'collections' | 'products') => void, cols: Ref[], prods: Ref[], pickKey: [typeof picking, typeof picking], drop: (kind: 'collections' | 'products', id: string) => void, error: string | null) => (
    <div>
      <Select label={label} value={as} onChange={(e) => onAs(e.target.value as 'collections' | 'products')}>
        <option value="collections">{t('discount.specificCollections')}</option><option value="products">{t('discount.specificProducts')}</option>
      </Select>
      <div className="mt-2"><Button size="sm" onClick={() => setPicking(as === 'products' ? pickKey[0] : pickKey[1])}>{t('discount.browse')}</Button></div>
      {refList(as === 'products' ? prods : cols, (rid) => drop(as, rid))}
      {error && <p className="mt-1 text-xs text-critical">{error}</p>}
    </div>
  );
  /** Purchase type select (one-time, subscription, both). */
  const purchaseSelect = (
    <Select label={t('sub.disc.purchaseType')} value={form.purchaseType} onChange={(e) => set({ purchaseType: e.target.value as PurchaseType })}>
      <option value="one_time">{t('sub.disc.oneTime')}</option><option value="subscription">{t('sub.disc.subscription')}</option><option value="both">{t('sub.disc.both')}</option>
    </Select>
  );
  /** For subscriptions: the payments the discount applies to. */
  const recurringChoice = form.purchaseType !== 'one_time' && (
    <div role="radiogroup" aria-label={t('sub.disc.recurring')} className="flex flex-col gap-2 border-t border-line pt-3 text-[13px]" data-testid="recurring-payments">
      <span className="font-medium">{t('sub.disc.recurring')}</span>
      {([['first', 'sub.disc.first'], ['limited', 'sub.disc.limited'], ['all', 'sub.disc.all']] as const).map(([v, label]) => (
        <div key={v} className="flex flex-col gap-2">
          <label className="inline-flex items-center gap-2"><input type="radio" name="recurring" className="accent-(--color-primary)" checked={form.recurring === v} onChange={() => set({ recurring: v })} />{t(label)}</label>
          {v === 'limited' && form.recurring === 'limited' && <Input className="ml-6 max-w-48" label={t('sub.disc.cycles')} help={t('sub.disc.cyclesHelp')} inputMode="numeric" value={form.recurringCycles} error={err('recurringCycles')} onChange={(e) => set({ recurringCycles: e.target.value })} />}
        </div>
      ))}
    </div>
  );
  const combos = [['productDiscounts', 'discount.combine.product'], ['orderDiscounts', 'discount.combine.order'], ['shippingDiscounts', 'discount.combine.shipping']] as const;
  const b = form.bxgy;
  const heading = id ? (automatic ? form.title : form.code) : t(`discounts.kind.${form.kind}` as Key);

  return (
    <>
      <SaveBar dirty={dirty} saving={save.isPending} onSave={() => save.mutate()} onDiscard={() => { setForm(initial); setErrors({}); }} />
      <PageHeader back="/discounts"
        title={<span className="flex items-center gap-2">{heading}{status && <Badge tone={status === 'ACTIVE' ? 'success' : 'neutral'}>{t(`discounts.status.${status}` as Key)}</Badge>}</span>}
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
            <div className="flex flex-col gap-3">
              {!id && (
                <div className="flex flex-col gap-1">
                  <span className="text-[13px] font-medium">{t('discounts.method')}</span>
                  <ButtonGroup aria-label={t('discounts.method')}>
                    {(['code', 'automatic'] as const).map((m) => <Button key={m} aria-pressed={form.method === m} onClick={() => set({ method: m })}>{t(`discounts.method.${m}` as Key)}</Button>)}
                  </ButtonGroup>
                </div>
              )}
              {automatic ? (
                <Input label={t('discount.title')} help={t('discount.titleHelp')} value={form.title} error={err('title')} onChange={(e) => set({ title: e.target.value })} />
              ) : (
                <div className="flex items-end gap-2">
                  <Input className="flex-1" label={t('discounts.code')} help={t('discount.codeHelp')} value={form.code} error={err('code')} onChange={(e) => set({ code: e.target.value.toUpperCase() })} />
                  <Button variant="plain" onClick={() => set({ code: generateCode() })}>{t('discount.generate')}</Button>
                </div>
              )}
            </div>
          </Card>

          {id && !automatic && <GenerateCodesCard discountId={id} />}

          {!shipping && !bxgy && (
            <Card title={t('discount.value')}>
              <div className="flex flex-col gap-3">
                <div className="flex gap-2">
                  <Select label={t('discount.valueType')} value={form.valueType} onChange={(e) => set({ valueType: e.target.value as DiscountForm['valueType'] })}>
                    <option value="percentage">{t('discount.percentage')}</option><option value="fixed">{t('discount.fixed')}</option>
                  </Select>
                  <Input className="flex-1" label={form.valueType === 'percentage' ? '%' : shop.currency} inputMode="decimal" value={form.value} error={err('value')} onChange={(e) => set({ value: e.target.value })} />
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  {form.kind === 'product' && (
                    <Select label={t('discount.appliesTo')} value={form.appliesTo === 'products' ? 'products' : 'collections'} onChange={(e) => set({ appliesTo: e.target.value as 'collections' | 'products' })}>
                      <option value="collections">{t('discount.specificCollections')}</option><option value="products">{t('discount.specificProducts')}</option>
                    </Select>
                  )}
                  {purchaseSelect}
                </div>
                {form.kind === 'product' && (
                  <div>
                    <Button size="sm" onClick={() => setPicking(form.appliesTo === 'products' ? 'products' : 'collections')}>{t('discount.browse')}</Button>
                    {refList(form.appliesTo === 'products' ? form.products : form.collections, (rid) => set(form.appliesTo === 'products' ? { products: without(form.products, rid) } : { collections: without(form.collections, rid) }))}
                    {err('targets') && <p className="mt-1 text-xs text-critical">{err('targets')}</p>}
                  </div>
                )}
                {recurringChoice}
              </div>
            </Card>
          )}

          {bxgy && (
            <>
              <Card title={t('discount.bxgyBuys')}>
                <div className="flex flex-col gap-3">
                  <Input className="max-w-40" label={t('discount.bxgyQuantity')} inputMode="numeric" value={b.buyQty} error={err('buyQty')} onChange={(e) => setBxgy({ buyQty: e.target.value })} />
                  {targets(t('discount.bxgyAnyItems'), b.buyAppliesTo, (v) => setBxgy({ buyAppliesTo: v }), b.buyCollections, b.buyProducts, ['buyProducts', 'buyCollections'],
                    (k, rid) => setBxgy(k === 'products' ? { buyProducts: without(b.buyProducts, rid) } : { buyCollections: without(b.buyCollections, rid) }), err('buyTargets'))}
                </div>
              </Card>
              <Card title={t('discount.bxgyGets')}>
                <div className="flex flex-col gap-3">
                  <Input className="max-w-40" label={t('discount.bxgyQuantity')} inputMode="numeric" value={b.getQty} error={err('getQty')} onChange={(e) => setBxgy({ getQty: e.target.value })} />
                  {targets(t('discount.bxgyAnyItems'), b.getAppliesTo, (v) => setBxgy({ getAppliesTo: v }), b.getCollections, b.getProducts, ['getProducts', 'getCollections'],
                    (k, rid) => setBxgy(k === 'products' ? { getProducts: without(b.getProducts, rid) } : { getCollections: without(b.getCollections, rid) }), err('getTargets'))}
                  <div className="flex items-end gap-2">
                    <Select label={t('discount.bxgyEffect')} value={b.getEffect} onChange={(e) => setBxgy({ getEffect: e.target.value as BxgyForm['getEffect'] })}>
                      <option value="free">{t('discount.bxgyFree')}</option><option value="percentage">{t('discount.percentage')}</option>
                    </Select>
                    {b.getEffect === 'percentage' && <Input className="w-28" label="%" inputMode="decimal" value={b.getPercent} error={err('getPercent')} onChange={(e) => setBxgy({ getPercent: e.target.value })} />}
                  </div>
                  <Checkbox label={t('discount.bxgyLimit')} checked={b.hasUsesLimit} onChange={(e) => setBxgy({ hasUsesLimit: e.target.checked })} />
                  {b.hasUsesLimit && <Input className="max-w-40" aria-label={t('discount.bxgyLimit')} inputMode="numeric" value={b.usesLimit} error={err('usesLimit')} onChange={(e) => setBxgy({ usesLimit: e.target.value })} />}
                </div>
              </Card>
            </>
          )}

          {shipping && (
            <Card title={t('discount.shippingRates')}>
              <div className="flex flex-col gap-3">
                <div>
                  <Checkbox label={t('discount.excludeOver')} checked={form.hasMaxShipping} onChange={(e) => set({ hasMaxShipping: e.target.checked })} />
                  {form.hasMaxShipping && <Input className="mt-2 max-w-48" label={shop.currency} inputMode="decimal" value={form.maxShipping} error={err('maxShipping')} onChange={(e) => set({ maxShipping: e.target.value })} />}
                </div>
                <div className="grid gap-3 sm:grid-cols-2">{purchaseSelect}</div>
                {recurringChoice}
              </div>
            </Card>
          )}

          {!bxgy && (
            <Card title={t('discount.minimum')}>
              <div className="flex flex-col gap-3">
                <div role="radiogroup" aria-label={t('discount.minimumType')} className="flex flex-col gap-2 text-[13px]">
                  {([['none', 'discount.minNone'], ['subtotal', 'discount.minSubtotal'], ['quantity', 'discount.minQuantity']] as const).map(([v, label]) => (
                    <div key={v} className="flex flex-col gap-2">
                      <label className="inline-flex items-center gap-2"><input type="radio" name="min-type" className="accent-(--color-primary)" checked={form.minType === v} onChange={() => set({ minType: v })} />{t(label)}</label>
                      {form.minType === v && v !== 'none' && <Input className="ml-6 max-w-48" label={v === 'subtotal' ? shop.currency : t('discount.items')} inputMode="decimal" value={form.minValue} error={err('minValue')} onChange={(e) => set({ minValue: e.target.value })} />}
                    </div>
                  ))}
                </div>
              </div>
            </Card>
          )}

          {!automatic && (
            <Card title={t('discount.limits')}>
              <div className="flex flex-col gap-3">
                <Checkbox label={t('discount.limitTotal')} checked={form.limitTotal} onChange={(e) => set({ limitTotal: e.target.checked })} />
                {form.limitTotal && <Input className="max-w-48" aria-label={t('discount.limitTotal')} inputMode="numeric" value={form.usageLimit} error={err('usageLimit')} onChange={(e) => set({ usageLimit: e.target.value })} />}
                <Checkbox label={t('discount.oncePerCustomer')} checked={form.oncePerCustomer} onChange={(e) => set({ oncePerCustomer: e.target.checked })} />
              </div>
            </Card>
          )}

          <EligibilityCard form={form} set={set} error={err('eligibility')} />

          <Card title={t('discount.combinations')} actions={<Button size="sm" onClick={() => setEditingCombos({ ...form.combines })}>{t('bp.discount.editCombinations')}</Button>}>
            <div className="flex flex-col gap-2">
              <p className="text-xs text-muted">{t('discount.combineHelp')}</p>
              <ul className="flex flex-wrap gap-1.5">
                {combos.filter(([k]) => form.combines[k]).map(([k, label]) => <li key={k}><Badge tone="info">{t(label)}</Badge></li>)}
                {!combos.some(([k]) => form.combines[k]) && <li className="text-[13px] text-muted">{t('bp.discount.noCombinations')}</li>}
              </ul>
            </div>
          </Card>

          <Card title={t('bp.discount.channels')}>
            <div role="radiogroup" aria-label={t('bp.discount.channels')} className="flex flex-col gap-2 text-[13px]">
              <label className="inline-flex items-center gap-2"><input type="radio" name="channels" className="accent-(--color-primary)" checked={form.channelIds.length === 0} onChange={() => set({ channelIds: [] })} />{t('bp.discount.allChannels')}</label>
              <label className="inline-flex items-center gap-2"><input type="radio" name="channels" className="accent-(--color-primary)" checked={form.channelIds.length > 0} onChange={() => set({ channelIds: (pubs.data ?? []).slice(0, 1).map((p) => p.id) })} />{t('bp.discount.specificChannels')}</label>
              {form.channelIds.length > 0 && (
                <div className="ml-6 flex flex-col gap-1.5">
                  {(pubs.data ?? []).map((p) => <Checkbox key={p.id} label={p.name} checked={form.channelIds.includes(p.id)} onChange={(e) => { const next = e.target.checked ? [...form.channelIds, p.id] : form.channelIds.filter((x) => x !== p.id); set({ channelIds: next.length ? next : form.channelIds }); }} />)}
                  <p className="text-xs text-muted">{t('bp.discount.channelsHelp')}</p>
                </div>
              )}
            </div>
          </Card>

          <TagsCard value={form.tags} onChange={(tags) => set({ tags })} />

          <Card title={t('discount.dates')}>
            <div className="flex flex-col gap-3">
              <Input className="max-w-64" type="datetime-local" label={t('discount.startsAt')} value={form.startsAt} onChange={(e) => set({ startsAt: e.target.value })} />
              {form.hasEnd
                ? <><Input className="max-w-64" type="datetime-local" label={t('discount.endsAt')} value={form.endsAt} error={err('endsAt')} onChange={(e) => set({ endsAt: e.target.value })} />
                  <div><Button variant="plain" onClick={() => set({ hasEnd: false })}>{t('discount.removeEnd')}</Button></div></>
                : <div><Button onClick={() => set({ hasEnd: true })}><Plus className="size-4" />{t('discount.setEnd')}</Button></div>}
              <p className="text-xs text-muted">{t('discount.timezone', { tz: shop.timezone })}</p>
            </div>
          </Card>
        </div>
        <div>
          <Card title={t('discount.summary')} className="sticky top-16">
            <ul className="list-disc space-y-1 pl-4 text-[13px]">{summary.map((s, i) => <li key={i}>{s}</li>)}</ul>
          </Card>
        </div>
      </div>
      <ProductPicker open={picking === 'products'} onClose={() => setPicking(null)} excludeIds={form.products.map((p) => p.id)} onConfirm={(p) => set({ products: [...form.products, ...p.map((x) => ({ id: x.id, title: x.title }))] })} />
      <CollectionPicker open={picking === 'collections'} onClose={() => setPicking(null)} excludeIds={form.collections.map((c) => c.id)} onConfirm={(c) => set({ collections: [...form.collections, ...c.map((x) => ({ id: x.id, title: x.title }))] })} />
      <ProductPicker open={picking === 'buyProducts'} onClose={() => setPicking(null)} excludeIds={b.buyProducts.map((p) => p.id)} onConfirm={(p) => setBxgy({ buyProducts: [...b.buyProducts, ...p.map((x) => ({ id: x.id, title: x.title }))] })} />
      <CollectionPicker open={picking === 'buyCollections'} onClose={() => setPicking(null)} excludeIds={b.buyCollections.map((c) => c.id)} onConfirm={(c) => setBxgy({ buyCollections: [...b.buyCollections, ...c.map((x) => ({ id: x.id, title: x.title }))] })} />
      <ProductPicker open={picking === 'getProducts'} onClose={() => setPicking(null)} excludeIds={b.getProducts.map((p) => p.id)} onConfirm={(p) => setBxgy({ getProducts: [...b.getProducts, ...p.map((x) => ({ id: x.id, title: x.title }))] })} />
      <CollectionPicker open={picking === 'getCollections'} onClose={() => setPicking(null)} excludeIds={b.getCollections.map((c) => c.id)} onConfirm={(c) => setBxgy({ getCollections: [...b.getCollections, ...c.map((x) => ({ id: x.id, title: x.title }))] })} />
      <Modal open={!!editingCombos} onClose={() => setEditingCombos(null)} closeLabel={t('common.close')} title={t('discount.combinations')} medium
        footer={<><Button onClick={() => setEditingCombos(null)}>{t('common.cancel')}</Button><Button variant="primary" onClick={() => { if (editingCombos) set({ combines: editingCombos }); setEditingCombos(null); }}>{t('common.apply')}</Button></>}>
        {editingCombos && (
          <div className="flex flex-col gap-2">
            <p className="text-[13px] text-muted">{t('discount.combineHelp')}</p>
            {combos.map(([k, label]) => <Checkbox key={k} label={t(label)} checked={editingCombos[k]} onChange={(e) => setEditingCombos({ ...editingCombos, [k]: e.target.checked })} />)}
          </div>
        )}
      </Modal>
      <ConfirmDialog open={confirmDelete} onClose={() => setConfirmDelete(false)} danger title={t('discounts.deleteTitle', { n: 1 })} message={t('discounts.deleteBody')} confirmLabel={t('common.delete')} cancelLabel={t('common.cancel')} onConfirm={() => { setConfirmDelete(false); del.mutate(); }} />
    </>
  );
}
