import { Banner, Button, Card, ConfirmDialog, TagInput, Textarea, Input } from '@shopme/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeftRight, CalendarDays, Hash, NotebookPen, StickyNote, X } from 'lucide-react';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { mutate } from '../../api';
import { PageHeader } from '../../components/PageHeader';
import { guard } from '../../components/SaveBar';
import { StockSearch, variantLabel } from '../../components/StockSearch';
import type { FoundVariant } from '../../components/StockSearch';
import { gidToNum } from '../../format';
import {
  TRANSFER_CREATE, TRANSFER_CREATE_READY, TRANSFER_DELETE, TRANSFER_EDIT, TRANSFER_READY, TRANSFER_REMOVE_ITEMS, TRANSFER_SET_ITEMS, STOCK_VARIANT_SEARCH,
} from '../../graphql';
import { gql } from '../../api';
import { useT } from '../../i18n';
import { Thumb } from '../Products';
import { PinSelect, Pipeline, TransitStep, dayValue, errText, useLocationOptions } from './shared';

export interface FormLine { itemId: string; lineId: string | null; title: string; sku: string | null; image: string | null; quantity: string; available: number | null }
export interface TransferDraft {
  id: string | null; origin: string; destination: string; lines: FormLine[]; date: string; reference: string; note: string; tags: string[];
}
export const emptyDraft = (): TransferDraft => ({ id: null, origin: '', destination: '', lines: [], date: dayValue(), reference: '', note: '', tags: [] });

/** A details row: icon + link-style label that turns into its input when opened (or when it already has a value). */
function DetailRow({ icon, label, open, onOpen, children }: { icon: ReactNode; label: string; open: boolean; onOpen: () => void; children: ReactNode }) {
  return (
    <div className="flex items-start gap-3 py-1.5">
      <span className="mt-0.5 text-muted" aria-hidden>{icon}</span>
      {open ? <div className="flex-1">{children}</div> : <button type="button" className="text-[13px] hover:underline" onClick={onOpen}>{label}</button>}
    </div>
  );
}

/** Create page and draft editor of a transfer. */
export function TransferForm({ initial }: { initial: TransferDraft }) {
  const t = useT();
  const nav = useNavigate();
  const qc = useQueryClient();
  const locations = useLocationOptions();
  const [f, setF] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [open, setOpen] = useState({ reference: !!initial.reference, note: !!initial.note, tags: initial.tags.length > 0 });
  const options = locations.data ?? [];
  const ready = !!f.origin && !!f.destination && f.lines.length > 0 && f.lines.every((l) => Number(l.quantity) >= 1);
  const set = (patch: Partial<TransferDraft>) => setF((c) => ({ ...c, ...patch }));

  const addVariant = (v: FoundVariant) => setF((c) => c.lines.some((l) => l.itemId === v.inventoryItemId) ? c : ({
    ...c, lines: [...c.lines, { itemId: v.inventoryItemId, lineId: null, title: variantLabel(v), sku: v.sku, image: v.image, quantity: '1', available: f.origin ? v.available[f.origin] ?? 0 : null }],
  }));
  const importRows = async (rows: Array<{ sku: string; quantity: number }>) => {
    for (const r of rows) {
      const hit = (await gql<{ productVariants: { nodes: Array<{ id: string; title: string; sku: string | null; product: { title: string }; inventoryItem: { id: string } | null }> } }>(STOCK_VARIANT_SEARCH, { query: `sku:${r.sku}` })).productVariants.nodes[0];
      if (!hit?.inventoryItem) continue;
      setF((c) => c.lines.some((l) => l.itemId === hit.inventoryItem!.id) ? c : ({ ...c, lines: [...c.lines, { itemId: hit.inventoryItem!.id, lineId: null, title: variantLabel({ productTitle: hit.product.title, title: hit.title }), sku: hit.sku, image: null, quantity: String(r.quantity), available: null }] }));
    }
  };

  const save = useMutation({
    mutationFn: async (asReady: boolean) => {
      const lineItems = f.lines.map((l) => ({ inventoryItemId: l.itemId, quantity: Math.max(0, Math.floor(Number(l.quantity) || 0)) }));
      const dateCreated = new Date(`${f.date}T12:00:00`).toISOString();
      const common = { originLocationId: f.origin || null, destinationLocationId: f.destination || null, lineItems, dateCreated, note: f.note.trim() || null, tags: f.tags, referenceName: f.reference.trim() || null };
      if (!f.id) {
        const r = await mutate<{ inventoryTransfer: { id: string } }>(asReady ? TRANSFER_CREATE_READY : TRANSFER_CREATE, { input: common }, asReady ? 'inventoryTransferCreateAsReadyToShip' : 'inventoryTransferCreate');
        return r.inventoryTransfer.id;
      }
      await mutate(TRANSFER_EDIT, { id: f.id, input: { originId: f.origin || null, destinationId: f.destination || null, dateCreated: f.date, note: f.note.trim() || null, tags: f.tags, referenceName: f.reference.trim() || null } }, 'inventoryTransferEdit');
      const removed = initial.lines.filter((l) => l.lineId && !f.lines.some((x) => x.lineId === l.lineId)).map((l) => l.lineId!);
      if (removed.length) await mutate(TRANSFER_REMOVE_ITEMS, { input: { id: f.id, transferLineItemIds: removed } }, 'inventoryTransferRemoveItems');
      if (lineItems.length) await mutate(TRANSFER_SET_ITEMS, { input: { id: f.id, lineItems } }, 'inventoryTransferSetItems');
      if (asReady) await mutate(TRANSFER_READY, { id: f.id }, 'inventoryTransferMarkAsReadyToShip');
      return f.id;
    },
    onSuccess: (id) => {
      guard.off = true;
      void qc.invalidateQueries({ queryKey: ['transfers'] });
      void qc.invalidateQueries({ queryKey: ['transfer'] });
      nav(`/transfers/${gidToNum(id)}`, { replace: true });
    },
    onError: (e) => setError(errText(e)),
  });

  const remove = useMutation({
    mutationFn: () => mutate(TRANSFER_DELETE, { id: f.id }, 'inventoryTransferDelete'),
    onSuccess: () => { guard.off = true; void qc.invalidateQueries({ queryKey: ['transfers'] }); nav('/transfers', { replace: true }); },
    onError: (e) => { setError(errText(e)); setConfirmDelete(false); },
  });
  const originName = options.find((o) => o.id === f.origin)?.name;
  return (
    <div className="mx-auto max-w-[800px]">
      <PageHeader large back={f.id ? `/transfers/${gidToNum(f.id)}` : '/transfers'} breadcrumb={{ icon: <ArrowLeftRight className="size-4" />, label: t('nav.transfers'), to: '/transfers' }} title={f.id ? t('transfers.editDraft') : t('transfers.createTitle')}
        actions={(f.id || f.origin || f.destination || f.lines.length > 0 || f.reference || f.note || f.tags.length > 0) && <div className="flex max-w-[calc(100vw-2rem)] flex-wrap justify-end gap-2">
          {f.id && <Button onClick={() => setConfirmDelete(true)}>{t('common.delete')}</Button>}
          <Button disabled={!f.origin || !f.destination || f.origin === f.destination} loading={save.isPending && save.variables === false} onClick={() => { setError(null); save.mutate(false); }}>{t('transfers.saveDraft')}</Button>
          <Button variant="primary" disabled={!ready || f.origin === f.destination} loading={save.isPending && save.variables === true} onClick={() => { setError(null); save.mutate(true); }}>{t('transfers.markReady')}</Button>
        </div>} />
      {error && <div className="mb-4"><Banner>{error}</Banner></div>}
      {f.origin && f.origin === f.destination && <div className="mb-4"><Banner tone="warning">{t('transfers.sameLocation')}</Banner></div>}
      <Card className="!p-0">
        <div className="p-3">
          <Pipeline
            start={<PinSelect value={f.origin} onChange={(v) => set({ origin: v })} options={options} placeholder={t('transfers.selectOrigin')} label={t('transfers.origin')} />}
            middle={<TransitStep label={t('transfers.inTransit')} />}
            end={<PinSelect value={f.destination} onChange={(v) => set({ destination: v })} options={options} placeholder={t('transfers.selectDestination')} label={t('transfers.destination')} />} />
        </div>
        <div className="border-t border-line px-3 py-2">
          <StockSearch locationId={f.origin || null} onAdd={addVariant} onImport={(rows) => void importRows(rows)} excludeItemIds={f.lines.map((l) => l.itemId)} />
        </div>
        {f.lines.length > 0 && (
          <div className="overflow-x-auto border-t border-line">
            <table className="w-full text-[13px]">
              <thead><tr className="text-left text-xs text-muted"><th className="px-3 py-2 font-medium">{t('transfers.product')}</th><th className="px-3 py-2 font-medium">{t('transfers.sku')}</th><th className="w-32 px-3 py-2 font-medium">{t('transfers.quantity')}</th><th className="w-10" /></tr></thead>
              <tbody>
                {f.lines.map((l, i) => {
                  const over = l.available != null && Number(l.quantity) > l.available;
                  return (
                    <tr key={l.itemId} className="border-t border-line">
                      <td className="px-3 py-2"><div className="flex items-center gap-2"><Thumb url={l.image} className="size-8" /><span>{l.title}</span></div></td>
                      <td className="px-3 py-2 text-muted">{l.sku ?? '—'}</td>
                      <td className="px-3 py-2">
                        <input type="number" min={1} inputMode="numeric" aria-label={`${t('transfers.quantity')} ${l.title}`} className="field-control w-24" value={l.quantity}
                          onChange={(e) => setF((c) => ({ ...c, lines: c.lines.map((x, j) => (j === i ? { ...x, quantity: e.target.value } : x)) }))} />
                        {l.available != null && <p className={`mt-1 text-xs ${over ? 'text-critical' : 'text-muted'}`}>{over ? t('transfers.exceedsStock', { n: l.available, name: originName ?? '' }) : t('stock.availableAt', { n: l.available })}</p>}
                      </td>
                      <td className="px-3 py-2"><button type="button" className="btn btn-icon btn-sm" aria-label={t('common.remove')} onClick={() => setF((c) => ({ ...c, lines: c.lines.filter((_, j) => j !== i) }))}><X className="size-4" /></button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <h2 className="mb-2 mt-6 text-[13px] font-semibold">{t('transfers.details')}</h2>
      <Card>
        <div className="flex items-center gap-3 py-1.5">
          <CalendarDays className="size-4 text-muted" aria-hidden />
          <input type="date" aria-label={t('transfers.date')} className="field-control h-7 w-auto rounded-full bg-surface px-3 text-[13px]" value={f.date} onChange={(e) => set({ date: e.target.value })} />
        </div>
        <DetailRow icon={<NotebookPen className="size-4" />} label={t('transfers.addReference')} open={open.reference} onOpen={() => setOpen((o) => ({ ...o, reference: true }))}>
          <Input autoFocus label={t('transfers.reference')} value={f.reference} maxLength={255} onChange={(e) => set({ reference: e.target.value })} />
        </DetailRow>
        <DetailRow icon={<StickyNote className="size-4" />} label={t('transfers.addNote')} open={open.note} onOpen={() => setOpen((o) => ({ ...o, note: true }))}>
          <Textarea autoFocus label={t('transfers.note')} value={f.note} maxLength={5000} onChange={(e) => set({ note: e.target.value })} />
        </DetailRow>
        <DetailRow icon={<Hash className="size-4" />} label={t('transfers.addTags')} open={open.tags} onOpen={() => setOpen((o) => ({ ...o, tags: true }))}>
          <TagInput label={t('field.tags')} value={f.tags} onChange={(tags) => set({ tags })} removeLabel={t('common.remove')} />
        </DetailRow>
      </Card>
      <ConfirmDialog open={confirmDelete} title={t('transfers.deleteTitle')} message={t('transfers.deleteBody')} confirmLabel={t('common.delete')} cancelLabel={t('common.cancel')} closeLabel={t('common.close')} danger loading={remove.isPending}
        onConfirm={() => remove.mutate()} onClose={() => setConfirmDelete(false)} />
    </div>
  );
}

export function TransferCreatePage() {
  return <TransferForm initial={emptyDraft()} />;
}
