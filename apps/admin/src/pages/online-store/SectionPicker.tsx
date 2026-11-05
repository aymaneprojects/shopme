import { Spinner, cx } from '@shopme/ui';
import { ChevronDown, LayoutPanelTop, LayoutTemplate, Search } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useT } from '../../i18n';
import type { Key } from '../../i18n';
import { CATEGORY_ORDER, groupItems } from '../../lib/section-categories';
import type { CategoryId, PickerItem } from '../../lib/section-categories';
import type { ReactNode } from 'react';

/** A popover docked against the tree panel (list on the left, preview on the right); Escape or a click outside closes it. */
function Dialog({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; closeLabel: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    const down = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); };
    document.addEventListener('keydown', key);
    document.addEventListener('mousedown', down, true);
    return () => { document.removeEventListener('keydown', key); document.removeEventListener('mousedown', down, true); };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div ref={ref} role="dialog" aria-label={title} className="fixed bottom-1 left-[252px] z-[60] flex h-[min(465px,calc(100vh-60px))] w-[537px] max-w-[calc(100vw-260px)] overflow-hidden rounded-xl border border-line bg-canvas text-fg shadow-pop">
      {children}
    </div>
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
      <div className="flex min-h-0 w-full">
        <div className="flex w-[213px] shrink-0 flex-col p-1">
          <div className="relative mb-1.5">
            <Search className="pointer-events-none absolute left-2.5 top-2 size-3.5 text-muted" />
            <input type="search" autoFocus value={find} onChange={(e) => setFind(e.target.value)} placeholder={t('editor.searchSections')} aria-label={t('editor.searchSections')} className="field-control w-full pl-8 text-[11px]" />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto pr-0.5">
            {groups.length === 0 && <p className="px-2 text-[12px] text-muted">{t(items.length ? 'editor.noMatch' : 'editor.noPresets')}</p>}
            {CATEGORY_ORDER.map((id) => groups.find((g) => g.id === id)).filter((g): g is NonNullable<typeof g> => !!g).map((g) => {
              const shut = !find.trim() && closed[g.id];
              return (
                <section key={g.id} aria-label={catLabel(g.id)} className="mb-1 border-b border-line pb-1 last:border-b-0">
                  <button type="button" aria-expanded={!shut} onClick={() => setClosed((c) => ({ ...c, [g.id]: !c[g.id] }))} className="flex h-8 w-full items-center justify-between rounded px-1.5 text-[11px] font-semibold hover:bg-hover">
                    {catLabel(g.id)}<ChevronDown className={cx('size-3.5 transition-transform', shut && 'rotate-180')} />
                  </button>
                  {!shut && (
                    <ul>
                      {g.items.map((i) => (
                        <li key={`${i.type}:${i.presetIndex}`}>
                          <button type="button" onClick={() => onAdd(i.type, i.presetIndex)} onMouseEnter={() => setActive(i)} onFocus={() => setActive(i)}
                            className={cx('flex w-full items-center gap-2 rounded-md px-1.5 py-1.5 text-left text-[11px] hover:bg-hover focus-visible:bg-hover', active?.type === i.type && active.presetIndex === i.presetIndex && 'bg-hover')}><LayoutPanelTop className="size-3.5 shrink-0 text-muted" aria-hidden /><span className="min-w-0">{i.name}</span></button>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              );
            })}
          </div>
        </div>
        <div className="flex min-w-0 flex-1 flex-col items-center justify-center bg-surface p-3" aria-live="polite">
          {active ? (
            <div className="w-full"><PresetPreview url={url} loading={loading} title={t('editor.presetPreview', { name: active.name })} /></div>
          ) : <p className="p-6 text-center text-[12px] text-muted">{t('editor.hoverToPreview')}</p>}
        </div>
      </div>
    </Dialog>
  );
}
