import { ArrowLeft, ArrowRight, ImagePlus, Trash2 } from 'lucide-react';
import { useRef, useState } from 'react';
import { cx } from './basics';

export interface UploadedFile { id: string | number; filename: string; url: string; mimeType: string; byteSize: number }

/** Upload one file with the admin REST endpoint (`POST /admin/api/files`, multipart field `file`). */
export async function uploadFile(file: File, endpoint = '/admin/api/files'): Promise<UploadedFile> {
  const body = new FormData();
  body.append('file', file);
  const res = await fetch(endpoint, { method: 'POST', body, credentials: 'same-origin' });
  if (!res.ok) {
    const j = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(j.error ?? `Upload failed (${res.status})`);
  }
  return ((await res.json()) as { file: UploadedFile }).file;
}

/** Drop zone / button that uploads the chosen images and reports the stored files. */
export function ImageUploader({ onUploaded, onError, label, multiple = true, compact }: { onUploaded: (files: UploadedFile[]) => void; onError?: (message: string) => void; label: string; multiple?: boolean; compact?: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const handle = async (list: FileList | null) => {
    if (!list?.length) return;
    setBusy(true);
    try {
      const files = await Promise.all(Array.from(list).filter((f) => f.type.startsWith('image/')).map((f) => uploadFile(f)));
      if (files.length) onUploaded(files);
    } catch (e) {
      onError?.(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  };
  return (
    <button
      type="button" disabled={busy} onClick={() => input.current?.click()}
      onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); void handle(e.dataTransfer.files); }}
      className={cx('flex flex-col items-center justify-center gap-1 rounded-md border border-dashed border-line text-sm text-muted hover:bg-surface', compact ? 'size-24' : 'w-full py-8', over && 'bg-primary-subtle', busy && 'opacity-60')}
    >
      <ImagePlus className="size-5" />
      {!compact && <span>{label}</span>}
      <input ref={input} type="file" accept="image/*" multiple={multiple} hidden aria-label={label} onChange={(e) => void handle(e.target.files)} />
    </button>
  );
}

export interface GalleryItem { key: string; url: string; alt?: string }

/** Ordered image grid: first item is the featured image. Reorder by drag and drop or the arrow buttons. */
export function MediaGallery({ items, onChange, canRemove = () => true, labels }: { items: GalleryItem[]; onChange: (items: GalleryItem[]) => void; canRemove?: (item: GalleryItem) => boolean; labels: { remove: string; moveLeft: string; moveRight: string; featured: string; alt: string } }) {
  const [drag, setDrag] = useState<number | null>(null);
  const move = (from: number, to: number) => {
    if (to < 0 || to >= items.length || from === to) return;
    const next = items.slice();
    next.splice(to, 0, next.splice(from, 1)[0]!);
    onChange(next);
  };
  return (
    <ul className="grid grid-cols-[repeat(auto-fill,minmax(7rem,1fr))] gap-3">
      {items.map((it, i) => (
        <li key={it.key} draggable onDragStart={() => setDrag(i)} onDragOver={(e) => e.preventDefault()} onDrop={() => { if (drag !== null) move(drag, i); setDrag(null); }}
          className={cx('group relative overflow-hidden rounded-md border border-line bg-surface', i === 0 && 'col-span-2 row-span-2')}>
          <img src={it.url} alt={it.alt ?? ''} className="aspect-square w-full object-cover" />
          {i === 0 && <span className="absolute left-1 top-1 rounded bg-canvas/90 px-1.5 py-0.5 text-xs">{labels.featured}</span>}
          <div className="absolute inset-x-0 bottom-0 flex justify-center gap-1 bg-canvas/85 p-1 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
            <button type="button" aria-label={labels.moveLeft} disabled={i === 0} onClick={() => move(i, i - 1)} className="rounded p-1 hover:bg-line disabled:opacity-40"><ArrowLeft className="size-4" /></button>
            <button type="button" aria-label={labels.moveRight} disabled={i === items.length - 1} onClick={() => move(i, i + 1)} className="rounded p-1 hover:bg-line disabled:opacity-40"><ArrowRight className="size-4" /></button>
            {canRemove(it) && <button type="button" aria-label={labels.remove} onClick={() => onChange(items.filter((_, j) => j !== i))} className="rounded p-1 text-critical hover:bg-line"><Trash2 className="size-4" /></button>}
          </div>
        </li>
      ))}
    </ul>
  );
}
