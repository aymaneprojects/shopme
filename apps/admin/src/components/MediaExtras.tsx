import { Button, uploadFile } from '@shopme/ui';
import { Box, Film, Trash2, Upload } from 'lucide-react';
import { useRef, useState } from 'react';
import { useT } from '../i18n';

export interface ExtraMedia { key: string; url: string; name: string; type: 'VIDEO' | 'MODEL_3D'; persisted: boolean }

const MODEL = /\.(glb|gltf|usdz)$/i;
export const mediaTypeOf = (f: { name: string; type: string }): ExtraMedia['type'] | null => (f.type.startsWith('video/') ? 'VIDEO' : MODEL.test(f.name) ? 'MODEL_3D' : null);

/** Videos and 3D models of a product: the saved ones (read only) and the new ones, with an upload button. */
export function MediaExtras({ value, onChange, onError }: { value: ExtraMedia[]; onChange: (v: ExtraMedia[]) => void; onError: (m: string) => void }) {
  const t = useT();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const pick = async (list: FileList | null) => {
    if (!list?.length) return;
    setBusy(true);
    const added: ExtraMedia[] = [];
    try {
      for (const f of Array.from(list)) {
        const type = mediaTypeOf(f);
        if (!type) { onError(t('bp.media.unsupported', { name: f.name })); continue; }
        const up = await uploadFile(f);
        added.push({ key: `new-${up.id}`, url: up.url, name: up.filename, type, persisted: false });
      }
    } catch (e) { onError(e instanceof Error ? e.message : String(e)); } finally {
      if (added.length) onChange([...value, ...added]);
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  };
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" loading={busy} onClick={() => input.current?.click()}><Upload className="size-4" />{t('bp.media.addExtra')}</Button>
        <input ref={input} type="file" hidden multiple accept="video/*,.glb,.gltf,.usdz,model/gltf-binary" aria-label={t('bp.media.addExtra')} onChange={(e) => void pick(e.target.files)} />
        <span className="text-xs text-muted">{t('bp.media.extraHelp')}</span>
      </div>
      {value.length > 0 && (
        <ul className="flex flex-col gap-1.5">
          {value.map((m) => (
            <li key={m.key} className="flex items-center gap-2 rounded-lg border border-line bg-canvas px-3 py-1.5 text-[13px]">
              {m.type === 'VIDEO' ? <Film className="size-4 text-muted" aria-hidden /> : <Box className="size-4 text-muted" aria-hidden />}
              <span className="min-w-0 flex-1 truncate">{m.name || t(m.type === 'VIDEO' ? 'bp.media.video' : 'bp.media.model')}</span>
              <span className="text-xs text-muted">{t(m.type === 'VIDEO' ? 'bp.media.video' : 'bp.media.model')}</span>
              {!m.persisted && <button type="button" aria-label={`${t('common.remove')} ${m.name}`} onClick={() => onChange(value.filter((x) => x.key !== m.key))} className="rounded p-1 text-muted hover:bg-surface"><Trash2 className="size-4" /></button>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
