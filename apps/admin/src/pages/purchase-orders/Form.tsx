import { Banner, Button, Card, ConfirmDialog, Input, Modal, Select, TagInput, Textarea } from '@shopme/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, ClipboardList, ChevronUp, Pencil, X } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { gql, mutate } from '../../api';
import { PageHeader } from '../../components/PageHeader';
import { guard } from '../../components/SaveBar';
import { StockSearch, variantLabel } from '../../components/StockSearch';
import type { FoundVariant } from '../../components/StockSearch';
import { formatMoney, gidToNum } from '../../format';
import {
  PURCHASE_ORDER_CREATE, PURCHASE_ORDER_DELETE, PURCHASE_ORDER_ORDERED, PURCHASE_ORDER_UPDATE, STOCK_VARIANT_SEARCH, SUPPLIERS, SUPPLIER_CREATE,
} from '../../graphql';
import { useI18n, useT } from '../../i18n';
import type { Key } from '../../i18n';
import { currencySymbolLabel } from '../../lib/markets';
import { useShop } from '../../session';
import { Thumb } from '../Products';
import { Pipeline } from '../transfers/shared';
import { PinSelect, dayValue, errText, useLocationOptions } from '../transfers/shared';

export interface PoLine { itemId: string; lineId: string | null; title: string; sku: string | null; image: string | null; supplierSku: string; quantity: string; unitCost: string; taxPercent: string }
export interface PoDraft {
  id: string | null; supplierId: string; destination: string; lines: PoLine[]; reference: string; note: string; paymentTerms: string; currency: string; tags: string[];
  shipping: string; other: string; taxesIncluded: boolean; expectedArrival: string; carrier: string; exchangeRate: string;
}
export const PAYMENT_TERMS = ['NONE', 'DUE_ON_RECEIPT', 'DUE_ON_FULFILLMENT', 'NET_7', 'NET_15', 'NET_30', 'NET_45', 'NET_60'] as const;

export const emptyPo = (currency: string): PoDraft => ({
  id: null, supplierId: '', destination: '', lines: [], reference: '', note: '', paymentTerms: 'NONE', currency, tags: [], shipping: '', other: '', taxesIncluded: true, expectedArrival: '', carrier: '', exchangeRate: '',
});

const num = (v: string) => { const n = Number(v.trim().replace(',', '.')); return v.trim() === '' || Number.isNaN(n) ? 0 : n; };
const digits = (currency: string) => { try { return new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2; } catch { return 2; } };

/** Totals the way the server computes them: tax is part of the line price when taxes are included, added on top otherwise. */
export function poTotals(lines: Pick<PoLine, 'quantity' | 'unitCost' | 'taxPercent'>[], taxesIncluded: boolean, shipping: number, other: number, currency: string) {
  const f = 10 ** digits(currency);
  let subtotal = 0; let taxes = 0; let total = 0;
  for (const l of lines) {
    const line = Math.round(Math.max(0, Math.floor(num(l.quantity))) * num(l.unitCost) * f);
    const pct = num(l.taxPercent);
    const tax = taxesIncluded ? Math.round((line * pct) / (100 + pct)) : Math.round((line * pct) / 100);
    subtotal += line; taxes += tax; total += line + (taxesIncluded ? 0 : tax);
  }
  return { variants: lines.length, items: lines.reduce((n, l) => n + Math.max(0, Math.floor(num(l.quantity))), 0), subtotal: subtotal / f, taxes: taxes / f, total: (total + Math.round(shipping * f) + Math.round(other * f)) / f };
}

/** Create page and draft editor of a purchase order (two columns: lines on the left, cost summary and details on the right). */
export function PurchaseOrderForm({ initial }: { initial: PoDraft }) {
  const t = useT();
  const { lang } = useI18n();
  const nav = useNavigate();
  const qc = useQueryClient();
  const { shop } = useShop();
  const locations = useLocationOptions();
  const suppliers = useQuery({ queryKey: ['suppliers'], queryFn: async () => (await gql<{ shopmeSuppliers: { nodes: Array<{ id: string; name: string; currencyCode: string | null; paymentTerms: string | null }> } }>(SUPPLIERS)).shopmeSuppliers.nodes });
  const [f, setF] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [costsOpen, setCostsOpen] = useState(false);
  const [more, setMore] = useState(!!initial.expectedArrival || !!initial.carrier);
  const [supplierOpen, setSupplierOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const set = (patch: Partial<PoDraft>) => setF((c) => ({ ...c, ...patch }));
  const totals = poTotals(f.lines, f.taxesIncluded, num(f.shipping), num(f.other), f.currency);
  const money = (n: number) => formatMoney(n, f.currency, lang);
  const canOrder = !!f.supplierId && !!f.destination && f.lines.length > 0 && f.lines.every((l) => Number(l.quantity) >= 1);
  const currencies = ['EUR', 'USD', 'GBP', 'CAD', 'AUD', 'CHF', 'JPY', 'SEK', 'NOK', 'DKK', 'PLN', 'MAD', 'XOF'].concat(Intl.supportedValuesOf('currency').filter((c) => !['EUR', 'USD', 'GBP', 'CAD', 'AUD', 'CHF', 'JPY', 'SEK', 'NOK', 'DKK', 'PLN', 'MAD', 'XOF'].includes(c)));

  const addVariant = (v: FoundVariant) => setF((c) => c.lines.some((l) => l.itemId === v.inventoryItemId) ? c : ({
    ...c, lines: [...c.lines, { itemId: v.inventoryItemId, lineId: null, title: variantLabel(v), sku: v.sku, image: v.image, supplierSku: '', quantity: '1', unitCost: v.unitCost ?? '0', taxPercent: '' }],
  }));
  const importRows = async (rows: Array<{ sku: string; quantity: number }>) => {
    for (const r of rows) {
      const hit = (await gql<{ productVariants: { nodes: Array<{ id: string; title: string; sku: string | null; product: { title: string }; inventoryItem: { id: string; unitCost: { amount: string } | null } | null }> } }>(STOCK_VARIANT_SEARCH, { query: `sku:${r.sku}` })).productVariants.nodes[0];
      if (!hit?.inventoryItem) continue;
      setF((c) => c.lines.some((l) => l.itemId === hit.inventoryItem!.id) ? c : ({ ...c, lines: [...c.lines, { itemId: hit.inventoryItem!.id, lineId: null, title: variantLabel({ productTitle: hit.product.title, title: hit.title }), sku: hit.sku, image: null, supplierSku: '', quantity: String(r.quantity), unitCost: hit.inventoryItem!.unitCost?.amount ?? '0', taxPercent: '' }] }));
    }
  };
  const pickSupplier = (id: string) => {
    const s = suppliers.data?.find((x) => x.id === id);
    set({ supplierId: id, ...(s?.currencyCode && !f.lines.length ? { currency: s.currencyCode } : {}), ...(s?.paymentTerms && f.paymentTerms === 'NONE' ? { paymentTerms: s.paymentTerms } : {}) });
  };

  const save = useMutation({
    mutationFn: async (order: boolean) => {
      const input = {
        supplierId: f.supplierId || null, destinationLocationId: f.destination || null, currencyCode: f.currency, taxesIncluded: f.taxesIncluded, referenceNumber: f.reference.trim() || null, supplierNote: f.note.trim() || null,
        paymentTerms: f.paymentTerms === 'NONE' ? null : f.paymentTerms, tags: f.tags, shippingCost: num(f.shipping).toFixed(digits(f.currency)), otherCost: num(f.other).toFixed(digits(f.currency)),
        expectedArrival: f.expectedArrival ? new Date(`${f.expectedArrival}T12:00:00`).toISOString() : null, carrier: f.carrier.trim() || null, exchangeRate: f.exchangeRate ? num(f.exchangeRate) : null,
        lineItems: f.lines.map((l) => ({ inventoryItemId: l.itemId, quantity: Math.max(0, Math.floor(num(l.quantity))), unitCost: num(l.unitCost).toFixed(digits(f.currency)), supplierSku: l.supplierSku.trim() || null, taxPercent: l.taxPercent.trim() ? num(l.taxPercent) : null })),
      };
      const r = f.id
        ? await mutate<{ shopmePurchaseOrder: { id: string } }>(PURCHASE_ORDER_UPDATE, { id: f.id, input }, 'shopmePurchaseOrderUpdate')
        : await mutate<{ shopmePurchaseOrder: { id: string } }>(PURCHASE_ORDER_CREATE, { input }, 'shopmePurchaseOrderCreate');
      if (order) await mutate(PURCHASE_ORDER_ORDERED, { id: r.shopmePurchaseOrder.id }, 'shopmePurchaseOrderMarkAsOrdered');
      return r.shopmePurchaseOrder.id;
    },
    onSuccess: (id) => {
      guard.off = true;
      void qc.invalidateQueries({ queryKey: ['purchase-orders'] }); void qc.invalidateQueries({ queryKey: ['purchase-order'] }); void qc.invalidateQueries({ queryKey: ['inventory'] });
      nav(`/purchase-orders/${gidToNum(id)}`, { replace: true });
    },
    onError: (e) => setError(errText(e)),
  });
  const remove = useMutation({
    mutationFn: () => mutate(PURCHASE_ORDER_DELETE, { id: f.id }, 'shopmePurchaseOrderDelete'),
    onSuccess: () => { guard.off = true; void qc.invalidateQueries({ queryKey: ['purchase-orders'] }); nav('/purchase-orders', { replace: true }); },
    onError: (e) => { setError(errText(e)); setConfirmDelete(false); },
  });

  return (
    <div className="mx-auto max-w-[820px]">
      <PageHeader large back="/purchase-orders" breadcrumb={{ icon: <ClipboardList className="size-4" />, label: t('nav.purchaseOrders'), to: '/purchase-orders' }} title={f.id ? t('po.editDraft') : t('po.createTitle')}
        actions={(f.id || f.supplierId || f.destination || f.lines.length > 0 || f.reference || f.note || f.tags.length > 0) && <div className="flex max-w-[calc(100vw-2rem)] flex-wrap justify-end gap-2">
          {f.id && <Button onClick={() => setConfirmDelete(true)}>{t('common.delete')}</Button>}
          <Button loading={save.isPending && save.variables === false} onClick={() => { setError(null); save.mutate(false); }}>{t('po.saveDraft')}</Button>
          <Button variant="primary" disabled={!canOrder} loading={save.isPending && save.variables === true} onClick={() => { setError(null); save.mutate(true); }}>{t('po.markOrdered')}</Button>
        </div>} />
      {error && <div className="mb-4"><Banner>{error}</Banner></div>}
      <div className="grid items-start gap-4 lg:grid-cols-[1fr_16.5rem]">
        <Card className="!p-0">
          <div className="p-3">
            <Pipeline
              start={(
                <label className="relative inline-flex items-center">
                  <select aria-label={t('po.supplier')} value={f.supplierId} className="chip-select h-8 max-w-[16rem] pl-2.5 pr-7 text-[13px] font-medium"
                    onChange={(e) => { if (e.target.value === '__new') setSupplierOpen(true); else pickSupplier(e.target.value); }}>
                    <option value="">{t('po.selectSupplier')}</option>
                    {(suppliers.data ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                    <option value="__new">{t('po.addSupplier')}</option>
                  </select>
                </label>
              )}
              end={<PinSelect value={f.destination} onChange={(v) => set({ destination: v })} options={locations.data ?? []} placeholder={t('transfers.selectDestination')} label={t('po.destination')} />} />
          </div>
          <div className="border-t border-line px-3 py-2"><StockSearch locationId={f.destination || null} onAdd={addVariant} onImport={(rows) => void importRows(rows)} excludeItemIds={f.lines.map((l) => l.itemId)} /></div>
          {f.lines.length > 0 && (
            <div className="overflow-x-auto border-t border-line">
              <table className="w-full min-w-[34rem] text-[13px]">
                <thead><tr className="text-left text-xs text-muted">
                  <th className="px-3 py-2 font-medium">{t('transfers.product')}</th><th className="px-2 py-2 font-medium">{t('po.supplierSku')}</th><th className="w-20 px-2 py-2 font-medium">{t('transfers.quantity')}</th>
                  <th className="w-24 px-2 py-2 font-medium">{t('po.unitCost')}</th><th className="w-16 px-2 py-2 font-medium">{t('po.tax')}</th><th className="px-3 py-2 text-right font-medium">{t('po.lineTotal')}</th><th className="w-8" /></tr></thead>
                <tbody>
                  {f.lines.map((l, i) => {
                    const patch = (p: Partial<PoLine>) => setF((c) => ({ ...c, lines: c.lines.map((x, j) => (j === i ? { ...x, ...p } : x)) }));
                    const tt = poTotals([l], f.taxesIncluded, 0, 0, f.currency);
                    return (
                      <tr key={l.itemId} className="border-t border-line align-top">
                        <td className="px-3 py-2"><div className="flex items-center gap-2"><Thumb url={l.image} className="size-8" /><div><p>{l.title}</p>{l.sku && <p className="text-xs text-muted">{l.sku}</p>}</div></div></td>
                        <td className="px-2 py-2"><input aria-label={`${t('po.supplierSku')} ${l.title}`} className="field-control w-24" value={l.supplierSku} onChange={(e) => patch({ supplierSku: e.target.value })} /></td>
                        <td className="px-2 py-2"><input type="number" min={1} aria-label={`${t('transfers.quantity')} ${l.title}`} className="field-control w-16" value={l.quantity} onChange={(e) => patch({ quantity: e.target.value })} /></td>
                        <td className="px-2 py-2"><input inputMode="decimal" aria-label={`${t('po.unitCost')} ${l.title}`} className="field-control w-20" value={l.unitCost} onChange={(e) => patch({ unitCost: e.target.value })} /></td>
                        <td className="px-2 py-2"><input inputMode="decimal" aria-label={`${t('po.tax')} ${l.title}`} className="field-control w-14" placeholder="%" value={l.taxPercent} onChange={(e) => patch({ taxPercent: e.target.value })} /></td>
                        <td className="px-3 py-2 text-right">{money(tt.total)}</td>
                        <td className="py-2 pr-2"><button type="button" className="btn btn-icon btn-sm" aria-label={t('common.remove')} onClick={() => setF((c) => ({ ...c, lines: c.lines.filter((_, j) => j !== i) }))}><X className="size-4" /></button></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <div className="flex flex-col gap-4">
          <section>
            <div className="mb-2 flex items-center justify-between"><h2 className="text-[13px] font-semibold">{t('po.costSummary')}</h2>
              <button type="button" className="btn btn-icon btn-sm" aria-label={t('po.editCosts')} aria-pressed={costsOpen} onClick={() => setCostsOpen((o) => !o)}><Pencil className="size-4" /></button></div>
            <Card>
              <p className="mb-2 text-[13px] font-semibold">{t('po.orderDetails')}</p>
              <dl className="grid gap-1.5 text-[13px]">
                <div className="flex justify-between"><dt>{t('po.variantsItems', { v: totals.variants, i: totals.items, $count: totals.variants })}</dt><dd>{money(totals.subtotal)}</dd></div>
                <div className="flex justify-between"><dt>{f.taxesIncluded ? t('po.taxesIncluded') : t('po.taxes')}</dt><dd>{money(totals.taxes)}</dd></div>
                {(costsOpen || num(f.shipping) > 0) && <div className="flex items-center justify-between gap-2"><dt>{t('po.shipping')}</dt><dd>{costsOpen ? <input inputMode="decimal" aria-label={t('po.shipping')} className="field-control w-24 text-right" value={f.shipping} onChange={(e) => set({ shipping: e.target.value })} /> : money(num(f.shipping))}</dd></div>}
                {(costsOpen || num(f.other) > 0) && <div className="flex items-center justify-between gap-2"><dt>{t('po.otherCosts')}</dt><dd>{costsOpen ? <input inputMode="decimal" aria-label={t('po.otherCosts')} className="field-control w-24 text-right" value={f.other} onChange={(e) => set({ other: e.target.value })} /> : money(num(f.other))}</dd></div>}
              </dl>
              <div className="mt-3 flex justify-between border-t border-line pt-3 text-[13px] font-semibold"><span>{t('po.total')}</span><span>{money(totals.total)}</span></div>
            </Card>
          </section>

          <section>
            <h2 className="mb-2 text-[13px] font-semibold">{t('po.details')}</h2>
            <Card>
              <div className="flex flex-col gap-3">
                <Input label={t('po.reference')} value={f.reference} maxLength={255} onChange={(e) => set({ reference: e.target.value })} suffix={<span className="text-xs">{f.reference.length}/255</span>} />
                <div className="relative">
                  <Textarea label={t('po.supplierNote')} value={f.note} maxLength={5000} onChange={(e) => set({ note: e.target.value })} />
                  <span className="pointer-events-none absolute bottom-2 right-2.5 text-xs text-muted">{f.note.length}/5000</span>
                </div>
                <div className="flex items-center gap-1.5 border-t border-line pt-3">
                  <label className="inline-flex min-w-0 items-center gap-1 rounded-md bg-hover px-1.5 py-0.5 text-xs"><span className="text-muted">{t('fid.po.terms')}</span>
                    <select aria-label={t('po.paymentTerms')} value={f.paymentTerms} onChange={(e) => set({ paymentTerms: e.target.value })} className="cursor-pointer appearance-none bg-transparent font-medium outline-none [field-sizing:content]">
                      {PAYMENT_TERMS.map((p) => <option key={p} value={p}>{t(`po.terms.${p}` as Key)}</option>)}
                    </select></label>
                  <label className="inline-flex min-w-0 items-center gap-1 rounded-md bg-hover px-1.5 py-0.5 text-xs"><span className="text-muted">{t('po.currency')}</span>
                    <select aria-label={t('po.currency')} value={f.currency} onChange={(e) => set({ currency: e.target.value })} className="cursor-pointer appearance-none bg-transparent font-medium outline-none [field-sizing:content]">
                      {[...new Set([shop.currency, ...currencies])].map((c) => <option key={c} value={c}>{currencySymbolLabel(c, lang)}</option>)}
                    </select></label>
                  <button type="button" className="btn btn-plain btn-icon btn-sm ml-auto" aria-expanded={more} aria-label={t('po.moreFields')} onClick={() => setMore((m) => !m)}>{more ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}</button>
                </div>
                {more && (
                  <div className="grid gap-3">
                    <Input label={t('po.expectedArrival')} type="date" value={f.expectedArrival || ''} min={dayValue()} onChange={(e) => set({ expectedArrival: e.target.value })} />
                    <Input label={t('transfers.carrier')} value={f.carrier} onChange={(e) => set({ carrier: e.target.value })} />
                    {f.currency !== shop.currency && <Input label={t('po.exchangeRate', { from: f.currency, to: shop.currency })} inputMode="decimal" value={f.exchangeRate} onChange={(e) => set({ exchangeRate: e.target.value })} />}
                    <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" checked={f.taxesIncluded} onChange={(e) => set({ taxesIncluded: e.target.checked })} />{t('po.pricesIncludeTaxes')}</label>
                  </div>
                )}
              </div>
            </Card>
          </section>

          <section>
            <h2 className="mb-2 text-[13px] font-semibold">{t('field.tags')}</h2>
            <Card><TagInput aria-label={t('field.tags')} value={f.tags} onChange={(tags) => set({ tags })} placeholder={t('po.tagPlaceholder')} removeLabel={t('common.remove')} /></Card>
          </section>
        </div>
      </div>
      <SupplierModal open={supplierOpen} onClose={() => setSupplierOpen(false)} onCreated={(s) => { setSupplierOpen(false); void qc.invalidateQueries({ queryKey: ['suppliers'] }); setF((c) => ({ ...c, supplierId: s.id, ...(s.currencyCode ? { currency: s.currencyCode } : {}) })); }} />
      <ConfirmDialog open={confirmDelete} title={t('po.deleteTitle')} message={t('po.deleteBody')} confirmLabel={t('common.delete')} cancelLabel={t('common.cancel')} closeLabel={t('common.close')} danger loading={remove.isPending}
        onConfirm={() => remove.mutate()} onClose={() => setConfirmDelete(false)} />
    </div>
  );
}

export function SupplierModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (s: { id: string; name: string; currencyCode: string | null }) => void }) {
  const t = useT();
  const { shop } = useShop();
  const [s, setS] = useState({ name: '', contactName: '', email: '', phone: '', currencyCode: shop.currency, paymentTerms: 'NONE' });
  const [error, setError] = useState<string | null>(null);
  const create = useMutation({
    mutationFn: () => mutate<{ supplier: { id: string; name: string; currencyCode: string | null } }>(SUPPLIER_CREATE, { input: { name: s.name.trim(), contactName: s.contactName.trim() || null, email: s.email.trim() || null, phone: s.phone.trim() || null, currencyCode: s.currencyCode, paymentTerms: s.paymentTerms === 'NONE' ? null : s.paymentTerms } }, 'shopmeSupplierCreate'),
    onSuccess: (r) => { setError(null); onCreated(r.supplier); },
    onError: (e) => setError(errText(e)),
  });
  return (
    <Modal open={open} onClose={onClose} title={t('po.addSupplier')} closeLabel={t('common.close')}
      footer={<><Button onClick={onClose}>{t('common.cancel')}</Button><Button variant="primary" disabled={!s.name.trim()} loading={create.isPending} onClick={() => create.mutate()}>{t('save.save')}</Button></>}>
      {error && <div className="mb-3"><Banner>{error}</Banner></div>}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2"><Input label={t('po.supplierName')} autoFocus value={s.name} onChange={(e) => setS({ ...s, name: e.target.value })} /></div>
        <Input label={t('po.contactName')} value={s.contactName} onChange={(e) => setS({ ...s, contactName: e.target.value })} />
        <Input label={t('field.email')} type="email" value={s.email} onChange={(e) => setS({ ...s, email: e.target.value })} />
        <Input label={t('po.phone')} value={s.phone} onChange={(e) => setS({ ...s, phone: e.target.value })} />
        <Select label={t('po.currency')} value={s.currencyCode} onChange={(e) => setS({ ...s, currencyCode: e.target.value })}>{[...new Set([shop.currency, 'EUR', 'USD', 'GBP', 'CAD', 'CHF'])].map((c) => <option key={c} value={c}>{c}</option>)}</Select>
        <Select label={t('po.paymentTerms')} value={s.paymentTerms} onChange={(e) => setS({ ...s, paymentTerms: e.target.value })}>{PAYMENT_TERMS.map((p) => <option key={p} value={p}>{t(`po.terms.${p}` as Key)}</option>)}</Select>
      </div>
    </Modal>
  );
}

export function PurchaseOrderCreatePage() {
  const { shop } = useShop();
  return <PurchaseOrderForm initial={emptyPo(shop.currency)} />;
}
