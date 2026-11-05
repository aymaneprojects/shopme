import { Spinner, cx } from '@shopme/ui';
import { ArrowDown, ArrowUp, Copy, Eye, EyeOff, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useT } from '../../i18n';

export type Device = 'desktop' | 'tablet' | 'mobile';
export const DEVICE_WIDTH: Record<Device, string> = { desktop: '100%', tablet: '768px', mobile: '390px' };

export interface Target { section: string; block?: string }
interface Box { x: number; y: number; w: number; h: number }
interface Hit { target: Target; box: Box }

export interface ToolbarActions { up?: () => void; down?: () => void; duplicate?: () => void; toggle: () => void; hidden: boolean; remove?: () => void }

const SECTION = '[data-shopify-editor-section]';
const BLOCK = '[data-shopify-editor-block]';
const idOf = (el: Element, attr: string): string | null => {
  try { const v = JSON.parse(el.getAttribute(attr) ?? '') as { id?: unknown }; return typeof v.id === 'string' ? v.id : null; } catch { return null; }
};
const boxOf = (el: Element): Box => { const r = el.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; };
const sameBox = (a: Box | null, b: Box | null) => (a === b) || (!!a && !!b && a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h);
const keyOf = (t: Target | null) => (t ? `${t.section}/${t.block ?? ''}` : '');

/** The element of the preview document that stands for a section or block. */
function findEl(doc: Document, t: Target): Element | null {
  for (const s of doc.querySelectorAll(SECTION)) {
    if (idOf(s, 'data-shopify-editor-section') !== t.section) continue;
    if (!t.block) return s;
    for (const b of s.querySelectorAll(BLOCK)) if (idOf(b, 'data-shopify-editor-block') === t.block) return b;
  }
  return null;
}

/**
 * The storefront preview in an iframe, with the editor chrome drawn on top: hover outline with the element's name, selection outline with a mini toolbar,
 * click-to-select (inspector), scroll-preserving refreshes. The preview page and the admin share an origin, so the frame document is read directly.
 */
export function PreviewFrame({ src, title, device, inspector, selected, highlight, nameOf, hasBlock, onPick, onNavigate, onInsert, refresh, toolbar, fill }: {
  src: string; title: string; device: Device; inspector: boolean; selected: Target | null; nameOf: (t: Target) => string; hasBlock: (section: string, block: string) => boolean;
  /** Section hovered in the tree: outlined like a hover in the preview. */ highlight: Target | null;
  onPick: (t: Target) => void; onNavigate: (pathAndQuery: string) => void; onInsert: (section: string, where: 'before' | 'after') => void;
  /** Bump `n` to reload the page with `params` set on its URL, keeping the scroll position. */
  refresh: { n: number; params: Record<string, string> }; toolbar: ToolbarActions | null; fill?: boolean;
}) {
  const t = useT();
  const frame = useRef<HTMLIFrameElement>(null);
  const live = useRef({ inspector, selected, highlight, nameOf, hasBlock, onPick, onNavigate });
  live.current = { inspector, selected, highlight, nameOf, hasBlock, onPick, onNavigate };
  const leave = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const scroll = useRef<{ x: number; y: number } | null>(null);
  const fromFrame = useRef(false);
  const stop = useRef<() => void>(() => {});
  const hoverEl = useRef<{ el: Element; target: Target } | null>(null);
  const [hover, setHover] = useState<Hit | null>(null);
  const [sel, setSel] = useState<Box | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [busy, setBusy] = useState(true);
  const [loads, setLoads] = useState(0);

  const attach = () => {
    stop.current();
    const f = frame.current;
    let doc: Document | null = null; let win: Window | null = null;
    try { win = f?.contentWindow ?? null; doc = win?.document ?? null; } catch { doc = null; }
    setBusy(false);
    if (!f || !doc || !win || !doc.body) { setHover(null); setSel(null); return; }
    const w = win; const d = doc;
    setLoads((n) => n + 1);
    if (scroll.current) { w.scrollTo(scroll.current.x, scroll.current.y); const s = scroll.current; requestAnimationFrame(() => w.scrollTo(s.x, s.y)); scroll.current = null; }
    live.current.onNavigate(`${w.location.pathname}${w.location.search}`);

    const El = (w as unknown as { Element: typeof Element }).Element;
    const asEl = (x: EventTarget | null): Element | null => (x instanceof El ? x : null);
    const resolve = (from: EventTarget | null): { el: Element; target: Target } | null => {
      const start = asEl(from);
      const secEl = start?.closest(SECTION);
      const section = secEl ? idOf(secEl, 'data-shopify-editor-section') : null;
      if (!start || !secEl || !section) return null;
      for (let b = start.closest(BLOCK); b && secEl.contains(b); b = b.parentElement?.closest(BLOCK) ?? null) {
        const id = idOf(b, 'data-shopify-editor-block');
        if (id && live.current.hasBlock(section, id)) return { el: b, target: { section, block: id } };
      }
      return { el: secEl, target: { section } };
    };
    const over = (e: Event) => { if (!live.current.inspector) return; clearTimeout(leave.current); hoverEl.current = resolve(e.target); };
    // Leaving the page lingers a moment so the insert handles outside the frame stay reachable.
    const out = (e: MouseEvent) => { if (!e.relatedTarget) { clearTimeout(leave.current); leave.current = setTimeout(() => { hoverEl.current = null; }, 400); } };
    const click = (e: MouseEvent) => {
      const a = asEl(e.target)?.closest('a[href]') as HTMLAnchorElement | null | undefined;
      if (live.current.inspector) {
        e.preventDefault(); e.stopPropagation();
        const hit = resolve(e.target);
        if (hit) { fromFrame.current = true; live.current.onPick(hit.target); }
        return;
      }
      // Browsing the preview keeps it a preview: carry the preview parameters over to same-site links.
      if (a && a.origin === w.location.origin) {
        const cur = new URL(w.location.href); const to = new URL(a.href);
        for (const k of ['preview_theme_id', '_draft']) { const v = cur.searchParams.get(k); if (v && !to.searchParams.has(k)) to.searchParams.set(k, v); }
        a.href = to.toString();
      }
    };
    d.addEventListener('mouseover', over);
    d.addEventListener('mouseout', out as EventListener);
    d.addEventListener('click', click, true);

    let raf = 0; let selEl: { key: string; el: Element | null } = { key: '', el: null }; let last = { w: 0, h: 0 };
    const tick = () => {
      const l = live.current;
      const key = keyOf(l.selected);
      if (l.selected && (selEl.key !== key || !selEl.el?.isConnected)) selEl = { key, el: findEl(d, l.selected) };
      if (!l.selected) selEl = { key: '', el: null };
      const sb = selEl.el ? boxOf(selEl.el) : null;
      setSel((p) => (sameBox(p, sb) ? p : sb));
      let h = l.inspector ? hoverEl.current : null;
      if (l.highlight) { const he = findEl(d, l.highlight); h = he ? { el: he, target: l.highlight } : h; }
      const hb = h?.el.isConnected ? { target: h.target, box: boxOf(h.el) } : null;
      setHover((p) => (hb && p && keyOf(p.target) === keyOf(hb.target) && sameBox(p.box, hb.box) ? p : hb));
      const sz = { w: w.innerWidth, h: w.innerHeight };
      if (sz.w !== last.w || sz.h !== last.h) { last = sz; setSize(sz); }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    stop.current = () => { cancelAnimationFrame(raf); try { d.removeEventListener('mouseover', over); d.removeEventListener('mouseout', out as EventListener); d.removeEventListener('click', click, true); } catch { /* document gone */ } };
  };
  useEffect(() => () => stop.current(), []);

  // Bring a section picked in the tree into view.
  const key = keyOf(selected);
  useEffect(() => {
    if (!selected || !key) return;
    if (fromFrame.current) { fromFrame.current = false; return; }
    try {
      const doc = frame.current?.contentDocument; const el = doc && findEl(doc, selected);
      if (!el) return;
      const r = el.getBoundingClientRect(); const vh = frame.current!.contentWindow!.innerHeight;
      if (r.top < 0 || r.bottom > vh) el.scrollIntoView({ block: r.height > vh ? 'start' : 'center', behavior: 'smooth' });
    } catch { /* frame not ready */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, loads]);

  // Reload with the new draft, keeping the scroll position.
  const first = useRef(refresh.n);
  useEffect(() => {
    if (refresh.n === first.current) return;
    first.current = refresh.n;
    try {
      const w = frame.current?.contentWindow;
      if (!w) return;
      const u = new URL(w.location.href);
      for (const [k, v] of Object.entries(refresh.params)) u.searchParams.set(k, v);
      scroll.current = { x: w.scrollX, y: w.scrollY };
      setBusy(true);
      w.location.replace(u.toString());
    } catch { setBusy(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refresh.n]);

  const label = (target: Target) => live.current.nameOf(target);
  const tag = (b: Box, name: string, solid: boolean): ReactNode => (
    <span className={cx('absolute max-w-[16rem] truncate whitespace-nowrap rounded-sm px-1.5 py-0.5 text-[11px] font-medium leading-4 text-white', solid ? 'bg-[#2f5bea]' : 'bg-[#2f5bea]/85')} style={{ left: b.x, top: b.y >= 20 ? b.y - 20 : b.y }}>{name}</span>
  );
  const showHover = !!hover && keyOf(hover.target) !== key;
  const handles = [showHover ? hover : null, sel && selected ? { target: selected, box: sel } : null].filter((x): x is Hit => !!x && !x.target.block);
  const handle = (hit: Hit, where: 'before' | 'after') => {
    const y = where === 'before' ? hit.box.y : hit.box.y + hit.box.h;
    return <button key={`${keyOf(hit.target)}:${where}`} type="button" aria-label={`${t('editor.insertHere')}: ${where === 'before' ? t('editor.addBefore') : t('editor.addAfter')}`} onClick={() => onInsert(hit.target.section, where)}
      className="pointer-events-auto absolute grid size-5 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-[#2f5bea] text-[15px] leading-none text-white shadow" style={{ left: hit.box.x + hit.box.w / 2, top: Math.min(Math.max(y, 10), size.h - 10) }}>+</button>;
  };
  const tb = sel && toolbar && size.w ? (() => {
    const bottom = sel.y + sel.h;
    const top = bottom + 52 <= size.h ? bottom + 8 : Math.max(Math.max(sel.y, 0) + 8, Math.min(bottom, size.h) - 52);
    const half = 100;
    const left = Math.min(Math.max(sel.x + sel.w / 2, half + 4), Math.max(size.w - half - 4, half + 4));
    return { top, left };
  })() : null;
  const btn = 'inline-flex size-8 items-center justify-center rounded-full text-white/85 hover:bg-white/15 hover:text-white disabled:opacity-30';

  return (
    <div className={cx('relative mx-auto max-w-full overflow-hidden rounded-md border border-line bg-white', fill ? 'h-full' : 'h-[calc(100vh-12rem)] min-h-[28rem]')} style={{ width: DEVICE_WIDTH[device] }}>
      <iframe ref={frame} title={title} src={src} onLoad={attach} className="block size-full border-0 bg-white" />
      <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden={!toolbar}>
        {showHover && hover && (
          <>
            <div className="absolute rounded-[1px] outline outline-2 -outline-offset-1 outline-[#2f5bea]/70 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.35)]" style={{ left: hover.box.x, top: hover.box.y, width: hover.box.w, height: hover.box.h }} />
            {tag(hover.box, label(hover.target), false)}
          </>
        )}
        {sel && selected && (
          <>
            <div className="absolute rounded-[1px] outline outline-2 -outline-offset-1 outline-[#2f5bea] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.5)]" style={{ left: sel.x, top: sel.y, width: sel.w, height: sel.h }} />
            {tag(sel, label(selected), true)}
          </>
        )}
        {handles.flatMap((hit) => [handle(hit, 'before'), handle(hit, 'after')])}
        {tb && toolbar && (
          <div role="toolbar" aria-label={title} className="pointer-events-auto absolute flex -translate-x-1/2 items-center gap-0.5 rounded-full border border-white/10 bg-bar p-1 shadow-lg" style={{ top: tb.top, left: tb.left }}>
            <button type="button" className={btn} aria-label={t('editor.moveUp')} disabled={!toolbar.up} onClick={toolbar.up}><ArrowUp className="size-4" /></button>
            <button type="button" className={btn} aria-label={t('editor.moveDown')} disabled={!toolbar.down} onClick={toolbar.down}><ArrowDown className="size-4" /></button>
            {toolbar.duplicate && <button type="button" className={btn} aria-label={t('editor.duplicate')} onClick={toolbar.duplicate}><Copy className="size-4" /></button>}
            <button type="button" className={btn} aria-label={toolbar.hidden ? t('editor.show') : t('editor.hide')} onClick={toolbar.toggle}>{toolbar.hidden ? <EyeOff className="size-4" /> : <Eye className="size-4" />}</button>
            {toolbar.remove && <button type="button" className={cx(btn, 'hover:!bg-red-500/30')} aria-label={t('common.remove')} onClick={toolbar.remove}><Trash2 className="size-4" /></button>}
          </div>
        )}
        {busy && <div className="absolute right-2 top-2 rounded-full bg-bar/80 p-1.5 text-white"><Spinner /></div>}
      </div>
    </div>
  );
}
