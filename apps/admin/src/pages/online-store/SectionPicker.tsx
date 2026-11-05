import { Button, Spinner, cx } from '@shopme/ui';
import { ChevronDown, LayoutTemplate, Search, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useT } from '../../i18n';
import type { Key } from '../../i18n';
import { CATEGORY_ORDER, groupItems } from '../../lib/section-categories';
import type { CategoryId, PickerItem } from '../../lib/section-categories';
import type { ReactNode } from 'react';

/** Same dialog behaviour as the UI kit's modal (native dialog: focus trap, Escape), but wide enough for the list and the preview side by side. */
function Dialog({ open, onClose, title, closeLabel, children }: { open: boolean; onClose: () => void; title: string; closeLabel: string; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} onClose={onClose} onClick={(e) => e.target === ref.current && onClose()} className="modal m-auto w-[calc(100%-2rem)] max-w-4xl rounded-xl border-0 bg-canvas p-0 text-fg shadow-pop">
      {open && (
        <div className="flex max-h-[85vh] flex-col">
          <header className="flex items-center justify-between border-b border-line px-4 py-3">
            <h2 className="text-[13px] font-semibold">{title}</h2>
            <Button variant="plain" size="sm" icon aria-label={closeLabel} onClick={onClose} className="btn-neutral"><X className="size-4" /></Button>
          </header>
          <div className="overflow-y-auto p-4">{children}</div>
        </div>
      )}
    </dialog>
  );
}

const FRAME_W = 1280;
const FRAME_H = 800;

/** Scaled-down live render of a section preset (the storefront draws it from a throwaway draft, so it uses the theme's own styles). */
function PresetPreview({ url, loading, title }: { url: string | null; loading: boolean; title: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.3);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setScale(el.clientWidth / FRAME_W));
    ro.observe(el); setScale(el.clientWidth / FRAME_W);
    return () => ro.disconnect();
  }, []);
  return (
    <div ref={box} className="relative w-full overflow-hidden rounded-md border border-line bg-white" style={{ aspectRatio: `${FRAME_W} / ${FRAME_H}` }}>
      {url && <iframe title={title} src={url} tabIndex={-1} className="pointer-events-none absolute left-0 top-0 border-0 bg-white" style={{ width: FRAME_W, height: FRAME_H, transform: `scale(${scale})`, transformOrigin: '0 0' }} />}
      {(loading || !url) && <div className="absolute inset-0 flex items-center justify-center bg-surface/70 text-muted">{loading ? <Spinner /> : <LayoutTemplate className="size-8" aria-hidden />}</div>}
    </div>
  );
}

/** "Add section" dialog: presets grouped by category, searchable, with a quick preview of the hovered or focused preset. */
export function SectionPicker({ open, onClose, items, onAdd, previewUrl }: {
  open: boolean; onClose: () => void; items: PickerItem[]; onAdd: (type: string, presetIndex: number) => void;
  /** Resolves to the URL of a page showing only this preset. */
  previewUrl: (type: string, presetIndex: number) => Promise<string | null>;
}) {
  const t = useT();
  const [find, setFind] = useState('');
  const [closed, setClosed] = useState<Record<string, boolean>>({});
  const [active, setActive] = useState<PickerItem | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const catLabel = (c: CategoryId) => t(`editor.cat.${c}` as Key);
  const groups = useMemo(() => groupItems(items, find, catLabel), [items, find]); // eslint-disable-line react-hooks/exhaustive-deps
  const seq = useRef(0);

  useEffect(() => { if (!open) { setFind(''); setActive(null); setUrl(null); } }, [open]);
  useEffect(() => {
    if (!active) return;
    const n = ++seq.current;
    setLoading(true);
    const timer = setTimeout(() => {
      previewUrl(active.type, active.presetIndex).then((u) => { if (n === seq.current) { setUrl(u); setLoading(false); } }).catch(() => { if (n === seq.current) setLoading(false); });
    }, 250);
    return () => clearTimeout(timer);
  }, [active]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Dialog open={open} onClose={onClose} closeLabel={t('common.close')} title={t('editor.addSection')}>
      <div className="grid gap-4 md:grid-cols-[17rem_minmax(0,1fr)]">
        <div className="min-w-0">
          <div className="relative mb-3">
            <Search className="pointer-events-none absolute left-2.5 top-2 size-4 text-muted" />
            <input type="search" autoFocus value={find} onChange={(e) => setFind(e.target.value)} placeholder={t('editor.searchSections')} aria-label={t('editor.searchSections')} className="field-control w-full pl-8" />
          </div>
          <div className="max-h-[52vh] overflow-y-auto pr-1">
            {groups.length === 0 && <p className="text-[13px] text-muted">{t(items.length ? 'editor.noMatch' : 'editor.noPresets')}</p>}
            {CATEGORY_ORDER.map((id) => groups.find((g) => g.id === id)).filter((g): g is NonNullable<typeof g> => !!g).map((g) => {
              const shut = !find.trim() && closed[g.id];
              return (
                <section key={g.id} aria-label={catLabel(g.id)} className="mb-2">
                  <button type="button" aria-expanded={!shut} onClick={() => setClosed((c) => ({ ...c, [g.id]: !c[g.id] }))} className="flex w-full items-center justify-between rounded px-1.5 py-1 text-xs font-semibold uppercase tracking-wide text-muted hover:bg-surface">
                    {catLabel(g.id)}<ChevronDown className={cx('size-3.5 transition-transform', shut && '-rotate-90')} />
                  </button>
                  {!shut && (
                    <ul>
                      {g.items.map((i) => (
                        <li key={`${i.type}:${i.presetIndex}`}>
                          <button type="button" onClick={() => onAdd(i.type, i.presetIndex)} onMouseEnter={() => setActive(i)} onFocus={() => setActive(i)}
                            className={cx('w-full rounded-md px-2 py-1.5 text-left text-[13px] hover:bg-surface focus-visible:bg-surface', active?.type === i.type && active.presetIndex === i.presetIndex && 'bg-surface')}>{i.name}</button>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              );
            })}
          </div>
        </div>
        <div className="hidden min-w-0 flex-col gap-2 md:flex" aria-live="polite">
          {active ? (
            <>
              <PresetPreview url={url} loading={loading} title={t('editor.presetPreview', { name: active.name })} />
              <p className="text-[13px] font-medium">{active.name}</p>
              <p className="text-xs text-muted">{catLabel(active.category)} · {active.type}</p>
            </>
          ) : <div className="flex h-full min-h-48 items-center justify-center rounded-md border border-dashed border-line p-6 text-center text-[13px] text-muted">{t('editor.hoverToPreview')}</div>}
        </div>
      </div>
    </Dialog>
  );
}
