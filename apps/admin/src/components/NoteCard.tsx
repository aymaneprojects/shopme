import { Button, Card, Modal, Textarea } from '@shopme/ui';
import { Pencil, Plus } from 'lucide-react';
import { useState } from 'react';
import { useI18n } from '../i18n';
import { SideSection } from './OrderChrome';

/**
 * Notes card: the note is collapsed behind a "+" (or a pencil once there is one) that opens an edit dialog.
 * `onSave` may return a promise; the dialog stays open until it settles and shows the error if it fails.
 */
export function NoteCard({ title, value, onSave, placeholder, dialogTitle, side }: { /** Render as a section of the side column (no card). */ side?: boolean; title: string; value: string; onSave: (note: string) => void | Promise<unknown>; placeholder?: string; dialogTitle?: string }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const show = () => { setDraft(value); setError(null); setOpen(true); };
  const save = async () => {
    setBusy(true);
    try { await onSave(draft.trim()); setOpen(false); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };
  const button = <button type="button" className="btn btn-plain btn-icon btn-sm" aria-label={value ? t('qa.editNote') : t('qa.addNote')} onClick={show}>{value ? <Pencil className="size-4" /> : <Plus className="size-4" />}</button>;
  const body = value ? <p className="whitespace-pre-wrap break-words text-[13px]">{value}</p> : side ? null : <p className="text-[13px] text-muted">{t('note.empty')}</p>;
  const dialog = (
    <Modal open={open} onClose={() => setOpen(false)} closeLabel={t('common.close')} title={dialogTitle ?? title} medium
      footer={<><Button onClick={() => setOpen(false)}>{t('common.cancel')}</Button><Button variant="primary" loading={busy} disabled={draft.trim() === value.trim()} onClick={() => void save()}>{t('save.save')}</Button></>}>
      <div className="flex flex-col gap-2">
        {error && <p role="alert" className="text-xs text-critical">{error}</p>}
        <Textarea aria-label={title} autoFocus rows={5} value={draft} placeholder={placeholder} onChange={(e) => setDraft(e.target.value)} />
      </div>
    </Modal>
  );
  if (side) return <SideSection title={title} action={button}>{body}{dialog}</SideSection>;
  return <Card title={title} actions={button}>{body}{dialog}</Card>;
}
