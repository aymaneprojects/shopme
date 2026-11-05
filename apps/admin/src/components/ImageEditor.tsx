import { Button, Input, Modal, cx, uploadFile } from '@shopme/ui';
import type { UploadedFile } from '@shopme/ui';
import { Crop, FlipHorizontal2, FlipVertical2, Paintbrush, PaintBucket, RotateCcw, RotateCw, Scaling, Undo2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { PointerEvent } from 'react';
import { useT } from '../i18n';

export type ImageTool = 'crop' | 'rotate' | 'resize' | 'draw' | 'background';
type Tool = ImageTool;
const clone = (c: HTMLCanvasElement) => { const n = document.createElement('canvas'); n.width = c.width; n.height = c.height; n.getContext('2d')!.drawImage(c, 0, 0); return n; };

/**
 * Edit an image in the browser: crop (drag a rectangle), rotate, flip, resize, draw on it and put a colour behind transparent areas.
 * "Save" uploads the result as a new file and hands it back; the original stays untouched.
 */
export function ImageEditor({ open, url, name, onClose, onSaved, onError, initialTool = 'crop' }: { open: boolean; url: string; name: string; onClose: () => void; onSaved: (file: UploadedFile) => void; onError: (message: string) => void; /** Tool selected when the editor opens. */ initialTool?: ImageTool }) {
  const t = useT();
  const view = useRef<HTMLCanvasElement>(null);
  const [work, setWork] = useState<HTMLCanvasElement | null>(null);
  const [history, setHistory] = useState<HTMLCanvasElement[]>([]);
  const [tool, setTool] = useState<Tool>(initialTool);
  const [sel, setSel] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [color, setColor] = useState('#e11d48');
  const [size, setSize] = useState(8);
  const [bg, setBg] = useState('');
  const [width, setWidth] = useState('');
  const [busy, setBusy] = useState(false);
  const drag = useRef<{ x: number; y: number } | null>(null);
  const last = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    if (!open) return;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => { const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight; c.getContext('2d')!.drawImage(img, 0, 0); setWork(c); setHistory([]); setWidth(String(c.width)); };
    img.onerror = () => onError(t('bp.editor.loadFailed'));
    img.src = url;
  }, [open, url]); // eslint-disable-line react-hooks/exhaustive-deps

  const paint = () => {
    const v = view.current; if (!v || !work) return;
    v.width = work.width; v.height = work.height;
    const g = v.getContext('2d')!;
    if (bg) { g.fillStyle = bg; g.fillRect(0, 0, v.width, v.height); }
    g.drawImage(work, 0, 0);
    if (sel && tool === 'crop') { g.fillStyle = 'rgba(0,0,0,.45)'; g.fillRect(0, 0, v.width, v.height); g.clearRect(sel.x, sel.y, sel.w, sel.h); g.drawImage(work, sel.x, sel.y, sel.w, sel.h, sel.x, sel.y, sel.w, sel.h); g.strokeStyle = '#fff'; g.lineWidth = Math.max(2, v.width / 400); g.strokeRect(sel.x, sel.y, sel.w, sel.h); }
  };
  useEffect(paint); // eslint-disable-line react-hooks/exhaustive-deps

  const commit = (next: HTMLCanvasElement) => { if (work) setHistory((h) => [...h.slice(-9), work]); setWork(next); setSel(null); setWidth(String(next.width)); };
  const point = (e: PointerEvent<HTMLCanvasElement>) => { const r = e.currentTarget.getBoundingClientRect(); return { x: ((e.clientX - r.left) / r.width) * e.currentTarget.width, y: ((e.clientY - r.top) / r.height) * e.currentTarget.height }; };

  const rotate = (dir: 1 | -1) => { if (!work) return; const c = document.createElement('canvas'); c.width = work.height; c.height = work.width; const g = c.getContext('2d')!; g.translate(c.width / 2, c.height / 2); g.rotate((dir * Math.PI) / 2); g.drawImage(work, -work.width / 2, -work.height / 2); commit(c); };
  const flip = (horizontal: boolean) => { if (!work) return; const c = document.createElement('canvas'); c.width = work.width; c.height = work.height; const g = c.getContext('2d')!; g.translate(horizontal ? c.width : 0, horizontal ? 0 : c.height); g.scale(horizontal ? -1 : 1, horizontal ? 1 : -1); g.drawImage(work, 0, 0); commit(c); };
  const applyCrop = () => { if (!work || !sel || sel.w < 2 || sel.h < 2) return; const c = document.createElement('canvas'); c.width = Math.round(sel.w); c.height = Math.round(sel.h); c.getContext('2d')!.drawImage(work, sel.x, sel.y, sel.w, sel.h, 0, 0, c.width, c.height); commit(c); };
  const applyResize = () => { const w = Math.round(Number(width)); if (!work || !(w >= 8 && w <= 5000)) return; const h = Math.round((work.height * w) / work.width); const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d')!; g.imageSmoothingQuality = 'high'; g.drawImage(work, 0, 0, w, h); commit(c); };

  const down = (e: PointerEvent<HTMLCanvasElement>) => {
    if (!work) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = point(e);
    if (tool === 'crop') { drag.current = p; setSel({ x: p.x, y: p.y, w: 0, h: 0 }); }
    if (tool === 'draw') { setHistory((h) => [...h.slice(-9), clone(work)]); last.current = p; const g = work.getContext('2d')!; g.fillStyle = color; g.beginPath(); g.arc(p.x, p.y, size / 2, 0, Math.PI * 2); g.fill(); paint(); }
  };
  const move = (e: PointerEvent<HTMLCanvasElement>) => {
    if (!work) return;
    const p = point(e);
    if (tool === 'crop' && drag.current) { const d = drag.current; setSel({ x: Math.max(0, Math.min(d.x, p.x)), y: Math.max(0, Math.min(d.y, p.y)), w: Math.min(work.width, Math.max(d.x, p.x)) - Math.max(0, Math.min(d.x, p.x)), h: Math.min(work.height, Math.max(d.y, p.y)) - Math.max(0, Math.min(d.y, p.y)) }); }
    if (tool === 'draw' && last.current) { const g = work.getContext('2d')!; g.strokeStyle = color; g.lineWidth = size; g.lineCap = 'round'; g.beginPath(); g.moveTo(last.current.x, last.current.y); g.lineTo(p.x, p.y); g.stroke(); last.current = p; paint(); }
  };
  const up = () => { drag.current = null; last.current = null; };

  const save = async () => {
    if (!work) return;
    setBusy(true);
    try {
      const out = document.createElement('canvas'); out.width = work.width; out.height = work.height;
      const g = out.getContext('2d')!;
      if (bg) { g.fillStyle = bg; g.fillRect(0, 0, out.width, out.height); }
      g.drawImage(work, 0, 0);
      const type = bg ? 'image/jpeg' : 'image/png';
      const blob = await new Promise<Blob | null>((res) => out.toBlob(res, type, 0.92));
      if (!blob) throw new Error(t('bp.editor.saveFailed'));
      const base = name.replace(/\.[a-z0-9]+$/i, '') || 'image';
      onSaved(await uploadFile(new File([blob], `${base}-edited.${bg ? 'jpg' : 'png'}`, { type })));
    } catch (e) { onError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };

  const tools: Array<[Tool, string, typeof Crop]> = [['crop', 'bp.editor.crop', Crop], ['rotate', 'bp.editor.rotate', RotateCw], ['resize', 'bp.editor.resize', Scaling], ['draw', 'bp.editor.draw', Paintbrush], ['background', 'bp.editor.background', PaintBucket]];
  return (
    <Modal open={open} onClose={onClose} closeLabel={t('common.close')} title={t('bp.editor.title')} wide
      footer={<><Button onClick={onClose}>{t('common.cancel')}</Button><Button variant="primary" loading={busy} disabled={!work} onClick={() => void save()}>{t('bp.editor.save')}</Button></>}>
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2" role="toolbar" aria-label={t('bp.editor.title')}>
          {tools.map(([k, label, Icon]) => <Button key={k} size="sm" aria-pressed={tool === k} className={cx(tool === k && 'ring-2 ring-primary')} onClick={() => { setTool(k); setSel(null); }}><Icon className="size-4" />{t(label as 'bp.editor.crop')}</Button>)}
          <Button size="sm" icon aria-label={t('bp.editor.undo')} disabled={!history.length} onClick={() => { const prev = history.at(-1); if (prev) { setHistory(history.slice(0, -1)); setWork(prev); setWidth(String(prev.width)); } }}><Undo2 className="size-4" /></Button>
        </div>
        <div className="flex flex-wrap items-end gap-3 text-[13px]">
          {tool === 'crop' && <><p className="text-muted">{t('bp.editor.cropHelp')}</p><Button size="sm" variant="primary" disabled={!sel || sel.w < 2 || sel.h < 2} onClick={applyCrop}>{t('bp.editor.applyCrop')}</Button></>}
          {tool === 'rotate' && <>
            <Button size="sm" onClick={() => rotate(-1)}><RotateCcw className="size-4" />{t('bp.editor.left')}</Button><Button size="sm" onClick={() => rotate(1)}><RotateCw className="size-4" />{t('bp.editor.right')}</Button>
            <Button size="sm" onClick={() => flip(true)}><FlipHorizontal2 className="size-4" />{t('bp.editor.flipH')}</Button><Button size="sm" onClick={() => flip(false)}><FlipVertical2 className="size-4" />{t('bp.editor.flipV')}</Button></>}
          {tool === 'resize' && <><Input className="w-32" type="number" min={8} max={5000} label={t('bp.editor.width')} value={width} onChange={(e) => setWidth(e.target.value)} /><p className="pb-2 text-muted">{work ? t('bp.editor.size', { w: work.width, h: work.height }) : ''}</p><Button size="sm" variant="primary" onClick={applyResize}>{t('common.apply')}</Button></>}
          {tool === 'draw' && <>
            <label className="flex items-center gap-2">{t('bp.editor.color')}<input type="color" value={color} onChange={(e) => setColor(e.target.value)} className="h-8 w-12 rounded-md border border-line bg-field" /></label>
            <label className="flex items-center gap-2">{t('bp.editor.brush')}<input type="range" min={2} max={48} value={size} onChange={(e) => setSize(Number(e.target.value))} /></label></>}
          {tool === 'background' && <>
            <label className="flex items-center gap-2">{t('bp.editor.color')}<input type="color" value={bg || '#ffffff'} onChange={(e) => setBg(e.target.value)} className="h-8 w-12 rounded-md border border-line bg-field" /></label>
            <Button size="sm" disabled={!bg} onClick={() => setBg('')}>{t('bp.editor.noBackground')}</Button><p className="text-muted">{t('bp.editor.backgroundHelp')}</p></>}
        </div>
        <div className="grid max-h-[60vh] place-items-center overflow-auto rounded-lg border border-line bg-surface p-2" style={{ backgroundImage: 'conic-gradient(#0000000d 25%, transparent 0 50%, #0000000d 0 75%, transparent 0)', backgroundSize: '16px 16px' }}>
          {work ? <canvas ref={view} aria-label={t('bp.editor.canvas')} className={cx('max-h-[56vh] max-w-full touch-none', tool === 'draw' || tool === 'crop' ? 'cursor-crosshair' : '')} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} /> : <p className="p-8 text-muted">{t('common.loading')}</p>}
        </div>
      </div>
    </Modal>
  );
}
