import { Badge, Button, ConfirmDialog, Dropdown, Input, Modal, Select, useToast } from '@shopme/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MoreHorizontal, Pencil, Plus, Trash2, Wand2 } from 'lucide-react';
import { useState } from 'react';
import { gql, mutate } from '../../api';
import { RowCard } from '../../components/SettingsKit';
import { CollectionPicker } from '../../components/Pickers';
import { COLLECTIONS_SIMPLE, POLICIES_GENERATE } from '../../graphql';
import { gidToNum } from '../../format';
import { useI18n } from '../../i18n';
import { errText, major, minor, newId, useConfig, useSaveConfig } from '../../lib/config';
import type { ReturnSet, ReturnsConfig } from '../../lib/config';
import { useShop } from '../../session';

/** Written policies "..." menu: fill the policies from templates. */
export function PolicyMenu() {
  const { t } = useI18n();
  const toast = useToast();
  const qc = useQueryClient();
  const [confirm, setConfirm] = useState(false);
  const gen = useMutation({
    mutationFn: (overwrite: boolean) => mutate<{ value: { written: string[] } }>(POLICIES_GENERATE, { overwrite }, 'shopmePoliciesGenerate'),
    onSuccess: (r) => { toast(t('bs.policiesGenerated', { n: r.value.written.length })); setConfirm(false); void qc.invalidateQueries({ queryKey: ['shop-policies'] }); },
    onError: (e) => { setConfirm(false); toast(errText(e), 'critical'); },
  });
  return (
    <>
      <Dropdown align="right" variant="plain" size="sm" icon label={t('common.moreActions')} trigger={<MoreHorizontal className="size-4" />} items={[
        { key: 'fill', icon: <Wand2 />, label: t('bs.policiesFill'), onSelect: () => gen.mutate(false) },
        { key: 'replace', icon: <Wand2 />, label: t('bs.policiesReplace'), danger: true, onSelect: () => setConfirm(true) },
      ]} />
      <ConfirmDialog open={confirm} danger onClose={() => setConfirm(false)} title={t('bs.policiesReplaceTitle')} message={t('bs.policiesReplaceBody')} confirmLabel={t('bs.policiesReplaceConfirm')} cancelLabel={t('common.cancel')} onConfirm={() => gen.mutate(true)} />
    </>
  );
}

/** Extra return rule sets: items of chosen collections follow their own window, shipping cost and restocking fee. */
export function ReturnRuleSets({ editing, setEditing }: { editing: string | 'new' | null; setEditing: (v: string | 'new' | null) => void }) {
  const { t } = useI18n();
  const { shop } = useShop();
  const cfg = useConfig<ReturnsConfig>('RETURNS');
  const cols = useQuery({ queryKey: ['collections-simple'], queryFn: async () => (await gql<{ collections: { nodes: Array<{ id: string; title: string }> } }>(COLLECTIONS_SIMPLE)).collections.nodes });
  const [del, setDel] = useState<ReturnSet | null>(null);
  const save = useSaveConfig<ReturnsConfig>('RETURNS', () => { setEditing(null); setDel(null); });
  const digits = shop.currency === 'JPY' ? 0 : 2;
  if (!cfg.data) return null;
  const sets = cfg.data.ruleSets;
  const titleOf = (n: number) => cols.data?.find((c) => gidToNum(c.id) === String(n))?.title ?? `#${n}`;
  const summary = (r: ReturnSet) => [
    r.windowDays === null ? null : r.windowDays === 0 ? t('bs.returnsNone') : t('bs.returnsWindow', { n: r.windowDays }),
    t(`returns.shipping.${r.shippingCost === 'customer_fixed' ? 'fixed' : r.shippingCost === 'customer_pays' ? 'customer' : 'free'}` as never),
    r.restockingFeePercent ? t('bs.returnsRestock', { n: r.restockingFeePercent }) : null,
  ].filter(Boolean).join(' · ');
  return (
    <>
      {sets.length > 0 && (
        <RowCard>
          {sets.map((r) => (
            <div key={r.id} className="flex items-center gap-3 px-4 py-3">
              <span className="min-w-0 flex-1"><span className="block truncate text-[13px] font-medium">{r.name}</span><span className="block truncate text-xs text-muted">{r.collectionIds.map(titleOf).join(', ') || '—'} · {summary(r)}</span></span>
              <Badge>{t('bs.collectionsCount', { n: r.collectionIds.length })}</Badge>
              <Dropdown align="right" variant="plain" size="sm" icon label={t('common.moreActions')} trigger={<MoreHorizontal className="size-4" />} items={[
                { key: 'edit', icon: <Pencil />, label: t('common.edit'), onSelect: () => setEditing(r.id) },
                { key: 'del', icon: <Trash2 />, label: t('common.delete'), danger: true, onSelect: () => setDel(r) },
              ]} />
            </div>
          ))}
        </RowCard>
      )}
      <SetModal key={editing ?? 'none'} open={editing !== null} cfg={cfg.data} id={editing === 'new' ? null : editing} digits={digits} titleOf={titleOf} saving={save.isPending} onClose={() => setEditing(null)} onSave={(ruleSets) => save.mutate({ ruleSets })} />
      <ConfirmDialog open={!!del} danger onClose={() => setDel(null)} title={t('bs.deleteItemTitle', { name: del?.name ?? '' })} message={t('bs.deleteItemBody')} confirmLabel={t('common.delete')} cancelLabel={t('common.cancel')} onConfirm={() => del && save.mutate({ ruleSets: sets.filter((x) => x.id !== del.id) })} />
    </>
  );
}

function SetModal({ open, cfg, id, digits, titleOf, saving, onClose, onSave }: { open: boolean; cfg: ReturnsConfig; id: string | null; digits: number; titleOf: (n: number) => string; saving: boolean; onClose: () => void; onSave: (l: ReturnSet[]) => void }) {
  const { t } = useI18n();
  const cur = cfg.ruleSets.find((r) => r.id === id);
  const [f, setF] = useState(() => ({ name: cur?.name ?? '', collections: cur?.collectionIds ?? ([] as number[]), windowDays: cur?.windowDays == null ? '' : String(cur.windowDays), shippingCost: cur?.shippingCost ?? 'free', fee: major(cur?.shippingFee ?? null, digits), restock: cur?.restockingFeePercent ? String(cur.restockingFeePercent) : '' }));
  const [picker, setPicker] = useState(false);
  const days = f.windowDays.trim() === '' ? null : Number(f.windowDays);
  const valid = f.name.trim() && f.collections.length > 0 && (days === null || (Number.isInteger(days) && days >= 0)) && (f.shippingCost !== 'customer_fixed' || (minor(f.fee, digits) ?? 0) > 0);
  const build = (): ReturnSet => ({ id: cur?.id ?? newId(cfg.ruleSets.map((r) => r.id), f.name), name: f.name.trim(), collectionIds: f.collections, windowDays: days, shippingCost: f.shippingCost, shippingFee: f.shippingCost === 'customer_fixed' ? minor(f.fee, digits) ?? 0 : 0, restockingFeePercent: Number(f.restock.replace(',', '.') || 0) });
  return (
    <Modal open={open} onClose={onClose} closeLabel={t('common.close')} title={t(cur ? 'bs.editReturnRule' : 'bs.addReturnRule')}
      footer={<><Button onClick={onClose}>{t('common.cancel')}</Button><Button variant="primary" loading={saving} disabled={!valid} onClick={() => onSave(cur ? cfg.ruleSets.map((r) => (r.id === cur.id ? build() : r)) : [...cfg.ruleSets, build()])}>{t('save.save')}</Button></>}>
      <div className="flex flex-col gap-3">
        <p className="text-[13px] text-muted">{t('bs.returnRuleIntro')}</p>
        <Input label={t('bs.ruleName')} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        <div>
          <p className="mb-1 text-[13px] font-medium">{t('bs.returnRuleCollections')}</p>
          <div className="flex flex-wrap items-center gap-1.5">
            {f.collections.map((n) => <span key={n} className="inline-flex items-center gap-1 rounded-full bg-hover py-0.5 pl-2.5 pr-1 text-[13px]">{titleOf(n)}<button type="button" aria-label={`${t('common.remove')} ${titleOf(n)}`} className="rounded-full px-1 hover:bg-line" onClick={() => setF({ ...f, collections: f.collections.filter((x) => x !== n) })}>×</button></span>)}
            <Button size="sm" onClick={() => setPicker(true)}><Plus className="size-3.5" />{t('bs.addCollections')}</Button>
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Input label={t('returns.window')} help={t('bs.returnWindowZero')} inputMode="numeric" value={f.windowDays} onChange={(e) => setF({ ...f, windowDays: e.target.value })} />
          <Input label={t('returns.restocking')} inputMode="decimal" value={f.restock} onChange={(e) => setF({ ...f, restock: e.target.value })} />
          <Select label={t('returns.shipping')} value={f.shippingCost} onChange={(e) => setF({ ...f, shippingCost: e.target.value as ReturnSet['shippingCost'] })}>
            <option value="free">{t('returns.shipping.free')}</option><option value="customer_fixed">{t('returns.shipping.fixed')}</option><option value="customer_pays">{t('returns.shipping.customer')}</option>
          </Select>
          {f.shippingCost === 'customer_fixed' && <Input label={t('returns.fee', { currency: '' })} inputMode="decimal" value={f.fee} onChange={(e) => setF({ ...f, fee: e.target.value })} />}
        </div>
      </div>
      <CollectionPicker open={picker} onClose={() => setPicker(false)} excludeIds={[]} onConfirm={(picked) => { setF({ ...f, collections: [...new Set([...f.collections, ...picked.map((c) => Number(gidToNum(c.id)))])] }); setPicker(false); }} />
    </Modal>
  );
}
