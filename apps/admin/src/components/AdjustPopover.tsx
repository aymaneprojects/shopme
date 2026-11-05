import { Button, Popover, Tooltip } from '@shopme/ui';
import { Check, HelpCircle, NotebookPen, SlidersHorizontal } from 'lucide-react';
import type { ReactNode } from 'react';
import { useState } from 'react';
import { useT } from '../i18n';

export const ADJUST_REASONS = ['correction', 'received', 'restock', 'cycle_count_available', 'damaged', 'shrinkage', 'quality_control', 'safety_stock', 'promotion', 'other'] as const;
export type AdjustReason = (typeof ADJUST_REASONS)[number];

/** Column title with a "?" that explains the column on hover and keyboard focus. */
export function HeaderHint({ label, hint }: { label: string; hint: string }) {
  return (
    <span className="inline-flex items-center gap-1">{label}
      <Tooltip content={hint}><span tabIndex={0} aria-label={hint} className="inline-grid size-4 place-items-center text-muted"><HelpCircle className="size-3.5" /></span></Tooltip>
    </span>
  );
}

/**
/**
 * Adjust a stock quantity in place, on one row: "Set to" or "Adjust by", the number, the location, the reason (behind the
 * note button) and the check that applies it. The reason is recorded in the inventory history.
 */
export function AdjustPopover({ value, label, trigger, onApply, locations, location, onLocation, name = 'available' }: {
  value: number; label: string; trigger?: ReactNode;
  onApply: (change: { mode: 'adjust' | 'set'; amount: number; reason: AdjustReason; locationId?: string }) => void;
  /** Locations offered in the row; the change applies to the chosen one. */
  locations?: Array<{ id: string; name: string }>; location?: string; onLocation?: (id: string) => void;
  /** Which quantity the row edits (for the result line). */
  name?: 'available' | 'on_hand';
}) {
  const t = useT();
  const [mode, setMode] = useState<'adjust' | 'set'>('set');
  const [n, setN] = useState(String(value));
  const [reason, setReason] = useState<AdjustReason>('correction');
  const [showReason, setShowReason] = useState(false);
  const [loc, setLoc] = useState(location ?? locations?.[0]?.id ?? '');
  const amount = Math.trunc(Number(n));
  const valid = n.trim() !== '' && Number.isFinite(amount) && (mode === 'adjust' ? amount !== 0 && value + amount >= 0 : amount >= 0 && (amount !== value || loc !== location));
  const next = mode === 'adjust' ? value + (Number.isFinite(amount) ? amount : 0) : amount;
  return (
    <Popover label={label} className="w-max" align="right" triggerVariant="plain" triggerClassName="btn-neutral !h-7 !px-1.5"
      trigger={trigger ?? <span className="tabular-nums">{value}<SlidersHorizontal className="ml-1.5 inline size-3 text-muted" aria-hidden /></span>}>
      {(close) => (
        <form className="flex flex-col gap-2" onSubmit={(e) => { e.preventDefault(); if (valid) { onApply({ mode, amount, reason, locationId: loc || undefined }); close(); } }}>
          <div className="flex items-center gap-1.5">
            <div className="flex h-8 items-center rounded-lg border border-line bg-canvas focus-within:ring-2 focus-within:ring-primary/40">
              <select aria-label={t('bp.adjust.mode')} value={mode} onChange={(e) => { const m = e.target.value as 'adjust' | 'set'; setMode(m); setN(m === 'set' ? String(value) : '0'); }}
                className="h-full rounded-l-lg border-r border-line bg-surface pl-2 pr-1 text-[13px] font-medium outline-none">
                <option value="set">{t('bp.adjust.setTo')}</option>
                <option value="adjust">{t('bp.adjust.adjustBy')}</option>
              </select>
              <input type="number" autoFocus aria-label={t(mode === 'adjust' ? 'bp.adjust.amount' : 'bp.adjust.newQuantity')} value={n} onFocus={(e) => e.target.select()} onChange={(e) => setN(e.target.value)}
                className="h-full w-20 rounded-r-lg bg-transparent px-2 text-[13px] tabular-nums outline-none" />
            </div>
            {locations && locations.length > 0 && (
              <select aria-label={t('inventory.location')} value={loc} onChange={(e) => { setLoc(e.target.value); onLocation?.(e.target.value); }} className="field-control !h-8 w-44">
                {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
            )}
            <Button type="button" size="sm" icon aria-label={t('bp.adjust.reason')} aria-pressed={showReason} className="!size-8" onClick={() => setShowReason(!showReason)}><NotebookPen className="size-4" /></Button>
            <Button type="submit" size="sm" icon variant="primary" aria-label={t('qty.apply')} disabled={!valid} className="!size-8"><Check className="size-4" /></Button>
          </div>
          {showReason && (
            <label className="flex items-center gap-2 text-[13px]">
              <span className="font-medium">{t('bp.adjust.reason')}</span>
              <select value={reason} onChange={(e) => setReason(e.target.value as AdjustReason)} className="field-control !h-8 flex-1">
                {ADJUST_REASONS.map((r) => <option key={r} value={r}>{t(`bp.reason.${r}` as 'bp.reason.correction')}</option>)}
              </select>
            </label>
          )}
          {valid && <p className="text-xs text-muted">{t(name === 'on_hand' ? 'fid.adjust.resultOnHand' : 'bp.adjust.result', { from: value, to: Number.isFinite(next) ? next : value })}</p>}
        </form>
      )}
    </Popover>
  );
}
