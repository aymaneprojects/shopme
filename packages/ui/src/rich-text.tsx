import {
  AlignCenter, AlignJustify, AlignLeft, AlignRight, Bold, Code, Eraser, Film, ImagePlus, IndentDecrease, IndentIncrease, Italic, Link2, List, ListOrdered, Palette, Table2, Underline, Unlink,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { cx } from './basics';
import { uploadFile } from './media';

/** Hosts whose players may stay embedded as iframes (mirrors the server-side allow-list). */
const EMBED_HOSTS = ['www.youtube.com', 'youtube.com', 'www.youtube-nocookie.com', 'player.vimeo.com'];

/** Strip scripts, event handlers, unsafe styles, javascript: URLs and non-video iframes. The server must sanitize too; this is defence in depth. */
export function sanitizeHtml(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll('script,style,object,embed,link,meta,form').forEach((n) => n.remove());
  doc.body.querySelectorAll('iframe').forEach((f) => {
    let ok = false;
    try { const u = new URL(f.getAttribute('src') ?? ''); ok = u.protocol === 'https:' && EMBED_HOSTS.includes(u.hostname.toLowerCase()); } catch { /* not a URL */ }
    if (!ok) { f.remove(); return; }
    f.removeAttribute('srcdoc');
  });
  doc.body.querySelectorAll('*').forEach((el) => {
    for (const a of Array.from(el.attributes)) {
      if (a.name.startsWith('on') || (/^(href|src)$/.test(a.name) && /^\s*(javascript|vbscript|data):/i.test(a.value)) || (a.name === 'style' && /expression\s*\(|url\s*\(|javascript:/i.test(a.value))) el.removeAttribute(a.name);
    }
  });
  return doc.body.innerHTML;
}

/** Embed URL for a YouTube or Vimeo page/share URL, or null when the URL is not recognised. */
export function videoEmbedUrl(raw: string): string | null {
  let u: URL;
  try { u = new URL(raw.trim()); } catch { return null; }
  const host = u.hostname.replace(/^www\./, '').toLowerCase();
  const id = (s: string | null | undefined) => (s && /^[\w-]{6,20}$/.test(s) ? s : null);
  if (host === 'youtu.be') { const v = id(u.pathname.slice(1)); return v ? `https://www.youtube.com/embed/${v}` : null; }
  if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'youtube-nocookie.com') {
    const [, kind, rest] = u.pathname.split('/');
    const v = id(u.searchParams.get('v') ?? (kind === 'embed' || kind === 'shorts' || kind === 'live' ? rest : null));
    return v ? `https://www.youtube.com/embed/${v}` : null;
  }
  if (host === 'vimeo.com' || host === 'player.vimeo.com') {
    const v = /\/(\d{5,12})(?:\/|$)/.exec(u.pathname)?.[1];
    return v ? `https://player.vimeo.com/video/${v}` : null;
  }
  return null;
}

export interface RichTextLabels {
  bold: string; italic: string; underline: string; list: string; orderedList: string; link: string; source: string; paragraph: string; heading: string; subheading: string; linkPrompt: string;
  heading1: string; heading2: string; heading3: string; heading4: string; quote: string;
  color: string; alignLeft: string; alignCenter: string; alignRight: string; justify: string; indent: string; outdent: string; unlink: string;
  image: string; imageUpload: string; video: string; videoPrompt: string; videoInvalid: string; table: string; tableRows: string; tableColumns: string; clearFormat: string;
  apply: string; insert: string; cancel: string; customColor: string; defaultColor: string; editor: string;
}
const defaultLabels: RichTextLabels = {
  bold: 'Bold', italic: 'Italic', underline: 'Underline', list: 'Bulleted list', orderedList: 'Numbered list', link: 'Link', source: 'Show HTML', paragraph: 'Paragraph', heading: 'Heading', subheading: 'Subheading', linkPrompt: 'URL',
  heading1: 'Heading 1', heading2: 'Heading 2', heading3: 'Heading 3', heading4: 'Heading 4', quote: 'Quote',
  color: 'Text color', alignLeft: 'Align left', alignCenter: 'Align center', alignRight: 'Align right', justify: 'Justify', indent: 'Increase indent', outdent: 'Decrease indent', unlink: 'Remove link',
  image: 'Insert image', imageUpload: 'Upload image', video: 'Embed video', videoPrompt: 'YouTube or Vimeo URL', videoInvalid: 'Enter a YouTube or Vimeo URL.', table: 'Insert table', tableRows: 'Rows', tableColumns: 'Columns', clearFormat: 'Clear formatting',
  apply: 'Apply', insert: 'Insert', cancel: 'Cancel', customColor: 'Custom color', defaultColor: 'Default', editor: 'Rich text editor',
};

const SWATCHES = ['#000000', '#4b5563', '#9ca3af', '#dc2626', '#ea580c', '#ca8a04', '#16a34a', '#0891b2', '#2563eb', '#7c3aed', '#db2777'];
type Panel = 'color' | 'link' | 'video' | 'table' | null;

export interface RichTextEditorProps {
  value: string; onChange: (html: string) => void; labels?: Partial<RichTextLabels>; id?: string;
  /** Open the app's file picker; call `insert` with the chosen image. When omitted the image button uploads a local file. */
  onPickImage?: (insert: (image: { url: string; alt?: string | null }) => void) => void;
  /** Called when an upload from the image button fails. */
  onError?: (message: string) => void;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

/** WYSIWYG editor (contentEditable + execCommand) with a block-format select, inline formatting, color, alignment, lists, link, image, video, table and an HTML source toggle. */
export function RichTextEditor({ value, onChange, labels: custom, id, onPickImage, onError }: RichTextEditorProps) {
  const labels = { ...defaultLabels, ...custom };
  const ref = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const range = useRef<Range | null>(null);
  const [source, setSource] = useState(false);
  const [panel, setPanel] = useState<Panel>(null);
  const [block, setBlock] = useState('P');
  const [url, setUrl] = useState('https://');
  const [urlError, setUrlError] = useState(false);
  const [grid, setGrid] = useState({ rows: 3, cols: 3 });

  useEffect(() => {
    if (ref.current && !source && ref.current.innerHTML !== value) ref.current.innerHTML = sanitizeHtml(value);
  }, [value, source]);

  useEffect(() => {
    const sync = () => {
      const sel = window.getSelection();
      if (!sel?.anchorNode || !ref.current?.contains(sel.anchorNode)) return;
      const v = String(document.queryCommandValue('formatBlock') || 'P').toUpperCase().replace(/[<>]/g, '');
      setBlock(['H1', 'H2', 'H3', 'H4', 'BLOCKQUOTE'].includes(v) ? v : 'P');
    };
    document.addEventListener('selectionchange', sync);
    return () => document.removeEventListener('selectionchange', sync);
  }, []);

  const emit = () => { if (ref.current) onChange(ref.current.innerHTML === '<br>' ? '' : ref.current.innerHTML); };
  const remember = () => {
    const sel = window.getSelection();
    if (sel?.rangeCount && ref.current?.contains(sel.anchorNode)) range.current = sel.getRangeAt(0).cloneRange();
  };
  const restore = () => {
    ref.current?.focus();
    const sel = window.getSelection();
    if (range.current && sel) { sel.removeAllRanges(); sel.addRange(range.current); }
  };
  const run = (cmd: string, arg?: string, css = false) => {
    restore();
    document.execCommand('styleWithCSS', false, css ? 'true' : 'false');
    document.execCommand(cmd, false, arg);
    emit();
  };
  const html = (markup: string) => { restore(); document.execCommand('insertHTML', false, markup); emit(); };
  const open = (p: Exclude<Panel, null>) => { remember(); setUrlError(false); if (p === 'link') setUrl('https://'); if (p === 'video') setUrl(''); setPanel(panel === p ? null : p); };
  const close = () => setPanel(null);

  const btn = (label: string, icon: React.ReactNode, onClick: () => void, active = false, disabled = source) => (
    <button type="button" title={label} aria-label={label} aria-pressed={active} disabled={disabled} onMouseDown={(e) => e.preventDefault()} onClick={onClick}
      className={cx('rounded p-1.5 hover:bg-line disabled:opacity-40 disabled:hover:bg-transparent', active && 'bg-line')}>{icon}</button>
  );
  const sep = <span aria-hidden className="mx-1 h-5 w-px bg-line" />;
  const insertImage = (img: { url: string; alt?: string | null }) => { html(`<img src="${esc(img.url)}" alt="${esc(img.alt ?? '')}">`); };
  const upload = async (list: FileList | null) => {
    const f = list?.[0];
    if (!f) return;
    try { const up = await uploadFile(f); insertImage({ url: up.url, alt: '' }); } catch (e) { onError?.(e instanceof Error ? e.message : String(e)); }
    if (fileInput.current) fileInput.current.value = '';
  };
  const submitLink = () => {
    const u = url.trim();
    if (!u || /^\s*javascript:/i.test(u)) { setUrlError(true); return; }
    restore();
    if (window.getSelection()?.isCollapsed) html(`<a href="${esc(u)}">${esc(u)}</a>`); else run('createLink', u);
    close();
  };
  const submitVideo = () => {
    const src = videoEmbedUrl(url);
    if (!src) { setUrlError(true); return; }
    html(`<iframe src="${src}" width="560" height="315" frameborder="0" allowfullscreen title="Video"></iframe><p><br></p>`);
    close();
  };
  const submitTable = () => {
    const cell = (tag: 'th' | 'td') => `<${tag}><br></${tag}>`;
    const rows = Array.from({ length: grid.rows }, (_, r) => `<tr>${Array.from({ length: grid.cols }, () => cell(r === 0 ? 'th' : 'td')).join('')}</tr>`).join('');
    html(`<table><tbody>${rows}</tbody></table><p><br></p>`);
    close();
  };
  const clearFormat = () => {
    restore();
    document.execCommand('removeFormat'); document.execCommand('unlink'); document.execCommand('formatBlock', false, 'P');
    emit();
  };
  const field = 'rounded border border-line bg-canvas px-2 py-1 text-xs';
  const actionBtn = 'rounded-full bg-primary px-3 py-1 text-xs font-medium text-on-primary';

  return (
    <div className="rounded-md border border-line bg-canvas" role="group" aria-label={labels.editor}>
      <div className="flex flex-wrap items-center gap-0.5 border-b border-line bg-surface p-1">
        <select aria-label={labels.paragraph} className="rounded border border-line bg-canvas px-1 py-1 text-xs" disabled={source} value={block}
          onMouseDown={remember} onChange={(e) => { setBlock(e.target.value); run('formatBlock', e.target.value); }}>
          <option value="P">{labels.paragraph}</option>
          <option value="H1">{labels.heading1}</option>
          <option value="H2">{labels.heading2}</option>
          <option value="H3">{labels.heading3}</option>
          <option value="H4">{labels.heading4}</option>
          <option value="BLOCKQUOTE">{labels.quote}</option>
        </select>
        {sep}
        {btn(labels.bold, <Bold className="size-4" />, () => run('bold'))}
        {btn(labels.italic, <Italic className="size-4" />, () => run('italic'))}
        {btn(labels.underline, <Underline className="size-4" />, () => run('underline'))}
        {btn(labels.color, <Palette className="size-4" />, () => open('color'), panel === 'color')}
        {sep}
        {btn(labels.alignLeft, <AlignLeft className="size-4" />, () => run('justifyLeft', undefined, true))}
        {btn(labels.alignCenter, <AlignCenter className="size-4" />, () => run('justifyCenter', undefined, true))}
        {btn(labels.alignRight, <AlignRight className="size-4" />, () => run('justifyRight', undefined, true))}
        {btn(labels.justify, <AlignJustify className="size-4" />, () => run('justifyFull', undefined, true))}
        {sep}
        {btn(labels.list, <List className="size-4" />, () => run('insertUnorderedList'))}
        {btn(labels.orderedList, <ListOrdered className="size-4" />, () => run('insertOrderedList'))}
        {btn(labels.outdent, <IndentDecrease className="size-4" />, () => run('outdent'))}
        {btn(labels.indent, <IndentIncrease className="size-4" />, () => run('indent'))}
        {sep}
        {btn(labels.link, <Link2 className="size-4" />, () => open('link'), panel === 'link')}
        {btn(labels.unlink, <Unlink className="size-4" />, () => run('unlink'))}
        {btn(labels.image, <ImagePlus className="size-4" />, () => { remember(); if (onPickImage) onPickImage(insertImage); else fileInput.current?.click(); })}
        {btn(labels.video, <Film className="size-4" />, () => open('video'), panel === 'video')}
        {btn(labels.table, <Table2 className="size-4" />, () => open('table'), panel === 'table')}
        {btn(labels.clearFormat, <Eraser className="size-4" />, clearFormat)}
        <span className="flex-1" />
        {btn(labels.source, <Code className="size-4" />, () => { setPanel(null); setSource(!source); }, source, false)}
        <input ref={fileInput} type="file" accept="image/*" hidden aria-label={labels.imageUpload} onChange={(e) => void upload(e.target.files)} />
      </div>
      {panel && !source && (
        <div className="flex flex-wrap items-center gap-2 border-b border-line bg-surface px-2 py-1.5 text-xs">
          {panel === 'color' && <>
            <button type="button" className="rounded border border-line px-2 py-1" onMouseDown={(e) => e.preventDefault()} onClick={() => { run('removeFormat'); close(); }}>{labels.defaultColor}</button>
            {SWATCHES.map((c) => (
              <button key={c} type="button" aria-label={c} title={c} style={{ background: c }} className="size-5 rounded-full border border-line" onMouseDown={(e) => e.preventDefault()} onClick={() => { run('foreColor', c, true); close(); }} />
            ))}
            <label className="inline-flex items-center gap-1">{labels.customColor}<input type="color" aria-label={labels.customColor} className="h-6 w-8 border-0 bg-transparent p-0" onChange={(e) => run('foreColor', e.target.value, true)} /></label>
          </>}
          {panel === 'link' && <>
            <input aria-label={labels.linkPrompt} aria-invalid={urlError} placeholder={labels.linkPrompt} value={url} onChange={(e) => { setUrl(e.target.value); setUrlError(false); }} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); submitLink(); } }} className={cx(field, 'min-w-56 flex-1', urlError && 'border-critical')} autoFocus />
            <button type="button" className={actionBtn} onClick={submitLink}>{labels.apply}</button>
          </>}
          {panel === 'video' && <>
            <input aria-label={labels.videoPrompt} aria-invalid={urlError} placeholder={labels.videoPrompt} value={url} onChange={(e) => { setUrl(e.target.value); setUrlError(false); }} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); submitVideo(); } }} className={cx(field, 'min-w-56 flex-1', urlError && 'border-critical')} autoFocus />
            <button type="button" className={actionBtn} onClick={submitVideo}>{labels.insert}</button>
            {urlError && <span role="alert" className="text-critical">{labels.videoInvalid}</span>}
          </>}
          {panel === 'table' && <>
            <label className="inline-flex items-center gap-1">{labels.tableRows}<input type="number" min={1} max={20} value={grid.rows} onChange={(e) => setGrid({ ...grid, rows: Math.min(20, Math.max(1, Number(e.target.value) || 1)) })} className={cx(field, 'w-16')} /></label>
            <label className="inline-flex items-center gap-1">{labels.tableColumns}<input type="number" min={1} max={10} value={grid.cols} onChange={(e) => setGrid({ ...grid, cols: Math.min(10, Math.max(1, Number(e.target.value) || 1)) })} className={cx(field, 'w-16')} /></label>
            <button type="button" className={actionBtn} onClick={submitTable}>{labels.insert}</button>
          </>}
          <button type="button" className="ml-auto rounded px-2 py-1 text-muted hover:bg-line" onClick={close}>{labels.cancel}</button>
        </div>
      )}
      {source ? (
        <textarea id={id} aria-label={labels.editor} className="block min-h-40 w-full bg-canvas p-3 font-mono text-xs" value={value} onChange={(e) => onChange(e.target.value)} spellCheck={false} />
      ) : (
        <div id={id} ref={ref} contentEditable suppressContentEditableWarning role="textbox" aria-multiline onInput={emit} onBlur={emit}
          className="prose-sm min-h-40 p-3 text-[13px] outline-none [&_a]:text-accent [&_a]:underline [&_blockquote]:border-l-2 [&_blockquote]:border-line [&_blockquote]:pl-3 [&_blockquote]:text-muted [&_h1]:text-xl [&_h1]:font-semibold [&_h2]:text-lg [&_h2]:font-semibold [&_h3]:font-semibold [&_h4]:font-medium [&_iframe]:aspect-video [&_iframe]:h-auto [&_iframe]:w-full [&_iframe]:max-w-xl [&_img]:max-w-full [&_ol]:list-decimal [&_ol]:pl-5 [&_table]:w-full [&_table]:border-collapse [&_td]:border [&_td]:border-line [&_td]:p-1.5 [&_th]:border [&_th]:border-line [&_th]:bg-surface [&_th]:p-1.5 [&_ul]:list-disc [&_ul]:pl-5" />
      )}
    </div>
  );
}
