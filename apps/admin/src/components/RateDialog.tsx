import { Button } from '@shopme/ui';
import { Truck, X } from 'lucide-react';
import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { useT } from '../i18n';

/** Full-screen editor dialog: slim title bar with an icon, close button on the right, scrolling content below. */
export function RateDialog({ open, title, onClose, children }: { open: boolean; title: string; onClose: () => void; children: ReactNode }) {
  const t = useT();
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} onClose={onClose} onCancel={(e) => { e.preventDefault(); onClose(); }} className="m-0 h-dvh max-h-none w-screen max-w-none border-0 bg-canvas p-0 text-fg backdrop:bg-black/40 sm:m-auto sm:h-[calc(100dvh-1.5rem)] sm:w-[calc(100vw-2rem)] sm:rounded-xl">
      {open && (
        <div className="flex h-full flex-col">
          <header className="relative flex h-12 shrink-0 items-center gap-2 px-4">
            <Truck className="size-4 text-muted" aria-hidden /><h2 className="text-[13px] font-medium">{title}</h2>
            <Button variant="plain" size="sm" icon className="ml-auto" aria-label={t('common.close')} onClick={onClose}><X className="size-4" /></Button>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
        </div>
      )}
    </dialog>
  );
}
