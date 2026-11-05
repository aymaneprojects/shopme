import { Badge, Button, Checkbox, Dropdown, Input, Modal, Select, Skeleton, cx } from '@shopme/ui';
import { useQuery } from '@tanstack/react-query';
import { MoreHorizontal, Pencil, Plus, Repeat, Trash2, X } from 'lucide-react';
import { useState } from 'react';
import { gql } from '../api';
import { SELLING_PLAN_GROUPS } from '../graphql';
import { useI18n } from '../i18n';
import type { Key } from '../i18n';
import {
  PLAN_INTERVALS, blankGroup, blankPlan, groupFromApi, hasErrors, planDiscount, planFrequency, planName, validateGroup,
  type ApiSellingPlanGroup, type PlanDiscountType, type PlanErrors, type PlanGroupDraft, type PlanInterval, type PurchaseOptionsForm,
} from '../lib/selling-plans';
import { formatMoney } from '../format';

/**
 * Product page "Purchase options": subscription plans (selling plan groups) offered with the product, created here or picked from the
 * existing ones, and the "only sell as a subscription" switch. Changes are saved with the product.
 */
export function PurchaseOptions({ value, onChange, currency }: { value: PurchaseOptionsForm; onChange: (v: PurchaseOptionsForm) => void; currency: string }) {
  const { t, lang } = useI18n();
  const money = (n: number) => formatMoney(n.toFixed(2), currency, lang);
  const [editing, setEditing] = useState<PlanGroupDraft | null>(null);
  const [attaching, setAttaching] = useState(false);
  const groups = value.groups;
  const add = () => setEditing(blankGroup(t('sub.plan.defaultName')));
  const menu = (
    <Dropdown size="sm" className="chip" label={t('sub.po.add')} trigger={<><Plus className="size-3.5" />{t('sub.po.add')}</>} items={[
      { key: 'create', icon: <Repeat className="size-4" />, label: t('sub.po.create'), onSelect: add },
      { key: 'attach', icon: <Plus className="size-4" />, label: t('sub.po.attach'), onSelect: () => setAttaching(true) },
    ]} />
  );
  const save = (g: PlanGroupDraft) => {
    const exists = groups.some((x) => x.key === g.key);
    onChange({ ...value, groups: exists ? groups.map((x) => (x.key === g.key ? g : x)) : [...groups, g] });
    setEditing(null);
  };
  const remove = (key: string) => {
    const next = groups.filter((x) => x.key !== key);
    onChange({ groups: next, requiresSellingPlan: next.length ? value.requiresSellingPlan : false });
  };

  return (
    <section aria-labelledby="purchase-options-title" data-testid="purchase-options">
      <header className="mb-3 flex min-h-7 items-center justify-between gap-2">
        <h2 id="purchase-options-title" className="text-[15px] font-semibold">{t('sub.po.title')}</h2>
      </header>
      {groups.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-line px-4 py-4">
          {menu}
        </div>
      ) : (
        <div className="rounded-lg bg-canvas shadow-card">
          <ul className="divide-y divide-line">
            {groups.map((g) => (
              <li key={g.key} className="flex items-start gap-3 px-4 py-3 text-[13px]">
                <span aria-hidden className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg bg-surface text-muted"><Repeat className="size-4" /></span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">{g.name}</span>
                    {!g.id && <Badge tone="info">{t('sub.po.unsaved')}</Badge>}
                  </div>
                  <ul className="mt-1.5 flex flex-wrap gap-1.5">
                    {g.plans.map((p) => {
                      const d = planDiscount(t, p, money);
                      return <li key={p.key} className="inline-flex items-center gap-1 rounded-md bg-surface px-2 py-0.5 text-xs">{planFrequency(t, p)}{d && <span className="text-muted">· {d}</span>}</li>;
                    })}
                  </ul>
                  {g.productsCount > 1 && <p className="mt-1.5 text-xs text-muted">{t('sub.po.sharedWith', { n: g.productsCount - 1 })}</p>}
                </div>
                <Dropdown align="right" variant="plain" size="sm" icon label={t('sub.po.actions')} trigger={<MoreHorizontal className="size-4" />} items={[
                  { key: 'edit', icon: <Pencil className="size-4" />, label: t('sub.po.edit'), onSelect: () => setEditing(g) },
                  { key: 'remove', icon: <Trash2 className="size-4" />, label: t('sub.po.remove'), danger: true, separatorBefore: true, onSelect: () => remove(g.key) },
                ]} />
              </li>
            ))}
          </ul>
          <div className="flex flex-col gap-3 border-t border-line px-4 py-3">
            <div>{menu}</div>
            <div className="flex flex-col gap-0.5">
              <Checkbox label={t('sub.po.onlySubscription')} checked={value.requiresSellingPlan} onChange={(e) => onChange({ ...value, requiresSellingPlan: e.target.checked })} />
              <p className="pl-6 text-xs text-muted">{t('sub.po.onlySubscriptionHelp')}</p>
            </div>
          </div>
        </div>
      )}
      {editing && <PlanDialog initial={editing} onClose={() => setEditing(null)} onSave={save} currency={currency} />}
      {attaching && <AttachDialog exclude={groups.flatMap((g) => (g.id ? [g.id] : []))} onClose={() => setAttaching(false)} onAdd={(picked) => { onChange({ ...value, groups: [...groups, ...picked] }); setAttaching(false); }} />}
    </section>
  );
}

/** Create or edit a plan group: its name and delivery frequencies, each with an optional discount. */
function PlanDialog({ initial, onClose, onSave, currency }: { initial: PlanGroupDraft; onClose: () => void; onSave: (g: PlanGroupDraft) => void; currency: string }) {
  const { t, lang } = useI18n();
  const money = (n: number) => formatMoney(n.toFixed(2), currency, lang);
  const [g, setG] = useState(initial);
  const [errors, setErrors] = useState<PlanErrors | null>(null);
  const setPlan = (key: string, p: Partial<PlanGroupDraft['plans'][number]>) => setG((x) => ({ ...x, plans: x.plans.map((y) => (y.key === key ? { ...y, ...p } : y)) }));
  const submit = () => {
    const e = validateGroup(g);
    setErrors(e);
    if (!hasErrors(e)) onSave(g);
  };
  const isNew = !initial.id && !initial.plans.some((p) => p.id);
  return (
    <Modal open onClose={onClose} wide closeLabel={t('common.close')} title={t(initial.id ? 'sub.plan.editTitle' : 'sub.plan.createTitle')}
      footer={<><Button onClick={onClose}>{t('common.cancel')}</Button><Button variant="primary" onClick={submit}>{t(isNew ? 'sub.plan.create' : 'common.apply')}</Button></>}>
      <div className="flex flex-col gap-4">
        {initial.productsCount > 1 && <p className="rounded-lg bg-surface px-3 py-2 text-[13px]">{t('sub.plan.sharedNote', { n: initial.productsCount - 1 })}</p>}
        <Input label={t('sub.plan.name')} help={t('sub.plan.nameHelp')} value={g.name} error={errors?.name ? t(errors.name) : null} onChange={(e) => setG({ ...g, name: e.target.value })} />
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-[13px] font-medium">{t('sub.plan.frequencies')}</legend>
          <ul className="flex flex-col gap-2">
            {g.plans.map((p, i) => {
              const err = errors?.rows[p.key];
              return (
                <li key={p.key} className="rounded-lg border border-line p-3">
                  <div className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-2 sm:grid-cols-[6rem_minmax(0,9rem)_minmax(0,10rem)_minmax(0,7rem)_auto]">
                    <Input className="col-span-1" label={t('sub.plan.every')} inputMode="numeric" value={p.intervalCount} aria-invalid={!!err} onChange={(e) => setPlan(p.key, { intervalCount: e.target.value.replace(/[^\d]/g, '') })} />
                    <Select label={t('sub.plan.frequency')} className="max-sm:order-none" value={p.interval} onChange={(e) => setPlan(p.key, { interval: e.target.value as PlanInterval })}>
                      {PLAN_INTERVALS.map((u) => <option key={u} value={u}>{t(`sub.plan.unit.${u}` as Key)}</option>)}
                    </Select>
                    <Select label={t('sub.plan.discount')} value={p.discountType} onChange={(e) => setPlan(p.key, { discountType: e.target.value as PlanDiscountType, ...(e.target.value === 'NONE' ? { discountValue: '' } : {}) })}>
                      {(['NONE', 'PERCENTAGE', 'FIXED_AMOUNT'] as const).map((d) => <option key={d} value={d}>{t(`sub.plan.discount.${d}` as Key)}</option>)}
                    </Select>
                    <Input label={p.discountType === 'FIXED_AMOUNT' ? currency : '%'} aria-label={t('sub.plan.discountValue')} inputMode="decimal" disabled={p.discountType === 'NONE'} value={p.discountValue} onChange={(e) => setPlan(p.key, { discountValue: e.target.value })} />
                    <Button variant="plain" size="sm" icon aria-label={`${t('sub.plan.removeFrequency')} ${i + 1}`} disabled={g.plans.length === 1} onClick={() => setG({ ...g, plans: g.plans.filter((x) => x.key !== p.key) })} className="mb-1"><X className="size-4" /></Button>
                  </div>
                  <p className={cx('mt-2 text-xs', err ? 'text-critical' : 'text-muted')}>{err ? t(err) : t('sub.plan.shownAs', { name: planName(t, p, money) })}</p>
                </li>
              );
            })}
          </ul>
          {errors?.plans && <p className="text-xs text-critical">{t(errors.plans)}</p>}
          <div><Button size="sm" onClick={() => setG({ ...g, plans: [...g.plans, blankPlan('MONTH', '1', g.plans[0]?.discountValue ?? '')] })}><Plus className="size-3.5" />{t('sub.plan.addFrequency')}</Button></div>
        </fieldset>
        <p className="text-xs text-muted">{t('sub.plan.help')}</p>
      </div>
    </Modal>
  );
}

/** Pick existing plan groups to offer with this product. */
function AttachDialog({ exclude, onClose, onAdd }: { exclude: string[]; onClose: () => void; onAdd: (groups: PlanGroupDraft[]) => void }) {
  const { t } = useI18n();
  const q = useQuery({ queryKey: ['selling-plan-groups'], queryFn: () => gql<{ sellingPlanGroups: { nodes: ApiSellingPlanGroup[] } }>(SELLING_PLAN_GROUPS, { first: 100 }) });
  const [picked, setPicked] = useState<string[]>([]);
  const rows = (q.data?.sellingPlanGroups.nodes ?? []).filter((g) => !exclude.includes(g.id));
  return (
    <Modal open onClose={onClose} medium closeLabel={t('common.close')} title={t('sub.attach.title')}
      footer={<><Button onClick={onClose}>{t('common.cancel')}</Button><Button variant="primary" disabled={!picked.length} onClick={() => onAdd(rows.filter((g) => picked.includes(g.id)).map(groupFromApi))}>{t('sub.attach.add')}</Button></>}>
      {q.isLoading ? <Skeleton className="h-16" /> : rows.length === 0 ? <p className="text-[13px] text-muted">{t('sub.attach.empty')}</p> : (
        <ul className="flex flex-col divide-y divide-line">
          {rows.map((g) => (
            <li key={g.id} className="py-2">
              <Checkbox checked={picked.includes(g.id)} onChange={(e) => setPicked(e.target.checked ? [...picked, g.id] : picked.filter((x) => x !== g.id))}
                label={<span className="flex flex-col"><span className="font-medium">{g.name}</span><span className="text-xs text-muted">{g.summary ?? ''} · {t('sub.attach.products', { n: g.productsCount?.count ?? 0 })}</span></span>} />
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
