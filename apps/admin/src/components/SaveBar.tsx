import { Button, ConfirmDialog } from '@shopme/ui';
import { useEffect, useState } from 'react';
import { useBlocker } from 'react-router';
import { useT } from '../i18n';

/** Set `guard.off = true` right before a programmatic navigation after a successful save. */
export const guard = { off: false };

/** Contextual save bar: a dark pill centred in the top bar while the form is dirty, with the unsaved-changes navigation guard. */
export function SaveBar({ dirty, saving, onSave, onDiscard }: { dirty: boolean; saving?: boolean; onSave: () => void; onDiscard: () => void }) {
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
        <div className="pointer-events-none fixed inset-x-0 top-0 z-50 flex h-12 items-center justify-center">
          <div role="region" aria-label={t('save.unsaved')} key={shake} className={`anim-bar pointer-events-auto flex h-9 items-center gap-3 rounded-full border border-white/10 bg-bar py-1 pl-4 pr-1 text-white shadow-lg ${shake ? 'anim-shake' : ''}`}>
            <span className="text-[13px] font-semibold">{t('save.unsaved')}</span>
            <Button size="sm" variant="plain" onClick={onDiscard} disabled={saving} className="!rounded-full !text-white hover:!bg-white/15">{t('save.discard')}</Button>
            <Button size="sm" variant="primary" onClick={onSave} loading={saving} className="!rounded-full">{t('save.save')}</Button>
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
