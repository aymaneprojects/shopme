import { Button, Popover, Tooltip, cx } from '@shopme/ui';
import { HelpCircle, SlidersHorizontal } from 'lucide-react';
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
 * Adjust a stock quantity in place: pick "Adjust by" or "Set to", type the number, choose the reason and apply.
 * The reason is recorded in the inventory history.
 */
export function AdjustPopover({ value, label, trigger, onApply }: { value: number; label: string; trigger?: ReactNode; onApply: (change: { mode: 'adjust' | 'set'; amount: number; reason: AdjustReason }) => void }) {
  const t = useT();
  const [mode, setMode] = useState<'adjust' | 'set'>('adjust');
  const [n, setN] = useState('0');
  const [reason, setReason] = useState<AdjustReason>('correction');
  const amount = Math.trunc(Number(n));
  const valid = Number.isFinite(amount) && (mode === 'adjust' ? amount !== 0 && value + amount >= 0 : amount >= 0 && amount !== value);
  const next = mode === 'adjust' ? value + (Number.isFinite(amount) ? amount : 0) : amount;
  return (
    <Popover label={label} className="w-72" triggerVariant="plain" triggerClassName="btn-neutral !h-7 !px-1.5"
      trigger={trigger ?? <span className="tabular-nums">{value}<SlidersHorizontal className="ml-1.5 inline size-3 text-muted" aria-hidden /></span>}>
      {(close) => (
        <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); if (valid) { onApply({ mode, amount, reason }); close(); } }}>
          <div className="flex rounded-lg bg-surface p-0.5 text-[13px]" role="radiogroup" aria-label={label}>
            {(['adjust', 'set'] as const).map((m) => (
              <button key={m} type="button" role="radio" aria-checked={mode === m} onClick={() => { setMode(m); setN(m === 'set' ? String(value) : '0'); }} className={cx('flex-1 rounded-md px-2 py-1 font-medium', mode === m ? 'bg-canvas shadow-card' : 'text-muted')}>{t(m === 'adjust' ? 'bp.adjust.adjustBy' : 'bp.adjust.setTo')}</button>
            ))}
          </div>
          <label className="flex flex-col gap-1 text-[13px]">
            <span className="font-medium">{t(mode === 'adjust' ? 'bp.adjust.amount' : 'bp.adjust.newQuantity')}</span>
            <input type="number" autoFocus value={n} onFocus={(e) => e.target.select()} onChange={(e) => setN(e.target.value)} className="field-control" />
          </label>
          <label className="flex flex-col gap-1 text-[13px]">
            <span className="font-medium">{t('bp.adjust.reason')}</span>
            <select value={reason} onChange={(e) => setReason(e.target.value as AdjustReason)} className="field-control">
              {ADJUST_REASONS.map((r) => <option key={r} value={r}>{t(`bp.reason.${r}` as 'bp.reason.correction')}</option>)}
            </select>
          </label>
          <p className="text-xs text-muted">{t('bp.adjust.result', { from: value, to: Number.isFinite(next) ? next : value })}</p>
          <Button type="submit" variant="primary" disabled={!valid}>{t('qty.apply')}</Button>
        </form>
      )}
    </Popover>
  );
}
