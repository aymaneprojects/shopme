import { Button, ConfirmDialog } from '@shopme/ui';
import { useEffect, useState } from 'react';
import { useBlocker } from 'react-router';
import { useT } from '../i18n';

/** Set `guard.off = true` right before a programmatic navigation after a successful save. */
export const guard = { off: false };

/** Contextual save bar: a dark pill centred in the top bar while the form is dirty, with the unsaved-changes navigation guard. */
export function SaveBar({ dirty, saving, saveDisabled, onSave, onDiscard, saveLabel, discardLabel }: { dirty: boolean; saving?: boolean; saveDisabled?: boolean; onSave: () => void; onDiscard: () => void; /** Wording of the two buttons when the bar belongs to a dialog ("Cancel" / "Done"). */ saveLabel?: string; discardLabel?: string }) {
  const t = useT();
  const [shake, setShake] = useState(0);
  const blocker = useBlocker(({ currentLocation, nextLocation }) => dirty && !guard.off && currentLocation.pathname !== nextLocation.pathname);

  useEffect(() => { guard.off = false; return () => { guard.off = false; }; }, []);
  // Attempting to leave draws attention to the bar before the confirmation appears.
  useEffect(() => { if (blocker.state === 'blocked') setShake((n) => n + 1); }, [blocker.state]);
  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [dirty]);

  return (
    <>
      {dirty && (
        <div className="pointer-events-none fixed inset-x-0 top-0 z-50 flex min-h-12 items-start justify-center px-2 py-1.5">
          <div role="region" aria-label={t('save.unsaved')} key={shake} className={`anim-bar pointer-events-auto flex min-h-9 max-w-full flex-wrap items-center justify-end gap-x-2 gap-y-1 rounded-2xl border border-white/10 bg-bar py-1 pl-3 pr-1 text-white shadow-lg sm:rounded-full ${shake ? 'anim-shake' : ''}`}>
            <span className="min-w-0 text-[13px] font-semibold max-sm:w-full max-sm:px-2 max-sm:text-center">{t('save.unsaved')}</span>
            <Button size="sm" variant="plain" onClick={onDiscard} disabled={saving} className="shrink-0 !rounded-full !text-white hover:!bg-white/15">{discardLabel ?? t('save.discard')}</Button>
            <Button size="sm" variant="primary" onClick={onSave} loading={saving} disabled={saveDisabled} className="shrink-0 !rounded-full">{saveLabel ?? t('save.save')}</Button>
          </div>
        </div>
      )}
      <ConfirmDialog
        open={blocker.state === 'blocked'} title={t('save.leaveTitle')} message={t('save.leaveBody')}
        confirmLabel={t('save.leave')} cancelLabel={t('save.stay')} closeLabel={t('common.close')} danger
        onConfirm={() => blocker.proceed?.()} onClose={() => blocker.reset?.()}
      />
    </>
  );
}
