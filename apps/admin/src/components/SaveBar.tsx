import { Button, ConfirmDialog } from '@shopme/ui';
import { useEffect } from 'react';
import { useBlocker } from 'react-router';
import { useT } from '../i18n';

/** Set `guard.off = true` right before a programmatic navigation after a successful save. */
export const guard = { off: false };

/** Sticky save/discard bar shown while the form is dirty, plus the unsaved-changes navigation guard. */
export function SaveBar({ dirty, saving, onSave, onDiscard }: { dirty: boolean; saving?: boolean; onSave: () => void; onDiscard: () => void }) {
  const t = useT();
  const blocker = useBlocker(({ currentLocation, nextLocation }) => dirty && !guard.off && currentLocation.pathname !== nextLocation.pathname);

  useEffect(() => { guard.off = false; return () => { guard.off = false; }; }, []);
  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [dirty]);

  return (
    <>
      {dirty && (
        <div className="fixed inset-x-0 top-0 z-50 flex items-center gap-3 bg-fg px-4 py-2 text-canvas" role="region" aria-label={t('save.unsaved')}>
          <span className="text-sm font-medium text-canvas">{t('save.unsaved')}</span>
          <span className="flex-1" />
          <Button size="sm" onClick={onDiscard} disabled={saving}>{t('save.discard')}</Button>
          <Button size="sm" variant="primary" onClick={onSave} loading={saving}>{t('save.save')}</Button>
        </div>
      )}
      <ConfirmDialog
        open={blocker.state === 'blocked'} title={t('save.leaveTitle')} message={t('save.leaveBody')}
        confirmLabel={t('save.leave')} cancelLabel={t('save.stay')} danger
        onConfirm={() => blocker.proceed?.()} onClose={() => blocker.reset?.()}
      />
    </>
  );
}
