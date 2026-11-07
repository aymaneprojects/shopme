import { Button, Modal, Spinner, uploadFile, useToast } from '@shopme/ui';
import { useState } from 'react';
import { useI18n } from '../../i18n';

/** Free images that ship with the admin: abstract backgrounds drawn for ShopMe (CC0), copied into the store files when picked. */
export const FREE_IMAGES = Array.from({ length: 12 }, (_, i) => `abstract-${String(i + 1).padStart(2, '0')}.jpg`);
export const freeImageUrl = (name: string) => `${import.meta.env.BASE_URL}free-images/${name}`;

/** Dialog listing the free images; the chosen one is uploaded to the store files and reported with its file URL. */
export function FreeImagesDialog({ open, onClose, onPick }: { open: boolean; onClose: () => void; onPick: (url: string) => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const pick = async (name: string) => {
    setBusy(name);
    try {
      const response = await fetch(freeImageUrl(name));
      if (!response.ok) throw new Error(t('bs.free.loadError'));
      const blob = await response.blob();
      if (!blob.type.startsWith('image/')) throw new Error(t('bs.free.loadError'));
      const file = await uploadFile(new File([blob], name, { type: blob.type }));
      onPick(file.url); onClose();
    } catch (e) { toast(e instanceof Error ? e.message : String(e), 'critical'); } finally { setBusy(null); }
  };
  return (
    <Modal open={open} onClose={onClose} closeLabel={t('common.close')} title={t('bs.free.title')} wide footer={<Button onClick={onClose}>{t('common.close')}</Button>}>
      <p className="mb-3 text-[13px] text-muted">{t('bs.free.intro')}</p>
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
        {FREE_IMAGES.map((name, i) => (
          <li key={name}>
            <button type="button" disabled={!!busy} onClick={() => void pick(name)} aria-label={t('bs.free.use', { n: i + 1 })}
              className="relative block aspect-[16/10] w-full overflow-hidden rounded-lg border border-line hover:border-primary focus-visible:border-primary">
              <img src={freeImageUrl(name)} alt="" loading="lazy" className="size-full object-cover" />
              {busy === name && <span className="absolute inset-0 grid place-items-center bg-canvas/70"><Spinner /></span>}
            </button>
          </li>
        ))}
      </ul>
    </Modal>
  );
}
