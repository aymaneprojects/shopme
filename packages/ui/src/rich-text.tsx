import { Bold, Code, Italic, Link2, List, ListOrdered, Underline } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { cx } from './basics';

/** Strip scripts, event handlers and javascript: URLs. The server must sanitize too; this is defence in depth. */
export function sanitizeHtml(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll('script,style,iframe,object,embed,link,meta').forEach((n) => n.remove());
  doc.body.querySelectorAll('*').forEach((el) => {
    for (const a of Array.from(el.attributes)) {
      if (a.name.startsWith('on') || (/^(href|src)$/.test(a.name) && /^\s*javascript:/i.test(a.value))) el.removeAttribute(a.name);
    }
  });
  return doc.body.innerHTML;
}

export interface RichTextLabels { bold: string; italic: string; underline: string; list: string; orderedList: string; link: string; source: string; paragraph: string; heading: string; subheading: string; linkPrompt: string }
const defaultLabels: RichTextLabels = { bold: 'Bold', italic: 'Italic', underline: 'Underline', list: 'Bulleted list', orderedList: 'Numbered list', link: 'Link', source: 'HTML source', paragraph: 'Paragraph', heading: 'Heading', subheading: 'Subheading', linkPrompt: 'URL' };

/** Minimal WYSIWYG editor (contentEditable + execCommand) with an HTML source toggle. */
export function RichTextEditor({ value, onChange, labels = defaultLabels, id }: { value: string; onChange: (html: string) => void; labels?: RichTextLabels; id?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [source, setSource] = useState(false);

  useEffect(() => {
    if (ref.current && !source && ref.current.innerHTML !== value) ref.current.innerHTML = sanitizeHtml(value);
  }, [value, source]);

  const emit = () => ref.current && onChange(ref.current.innerHTML === '<br>' ? '' : ref.current.innerHTML);
  const run = (cmd: string, arg?: string) => { ref.current?.focus(); document.execCommand(cmd, false, arg); emit(); };
  const btn = (label: string, icon: React.ReactNode, onClick: () => void, active = false) => (
    <button type="button" title={label} aria-label={label} aria-pressed={active} onMouseDown={(e) => e.preventDefault()} onClick={onClick} className={cx('rounded p-1.5 hover:bg-line', active && 'bg-line')}>{icon}</button>
  );

  return (
    <div className="rounded-md border border-line bg-canvas">
      <div className="flex flex-wrap items-center gap-0.5 border-b border-line bg-surface p-1">
        <select aria-label={labels.paragraph} className="rounded border border-line bg-canvas px-1 py-1 text-xs" disabled={source} defaultValue="P"
          onChange={(e) => { run('formatBlock', e.target.value); }}>
          <option value="P">{labels.paragraph}</option>
          <option value="H2">{labels.heading}</option>
          <option value="H3">{labels.subheading}</option>
        </select>
        {btn(labels.bold, <Bold className="size-4" />, () => run('bold'))}
        {btn(labels.italic, <Italic className="size-4" />, () => run('italic'))}
        {btn(labels.underline, <Underline className="size-4" />, () => run('underline'))}
        {btn(labels.list, <List className="size-4" />, () => run('insertUnorderedList'))}
        {btn(labels.orderedList, <ListOrdered className="size-4" />, () => run('insertOrderedList'))}
        {btn(labels.link, <Link2 className="size-4" />, () => { const u = window.prompt(labels.linkPrompt, 'https://'); if (u) run('createLink', u); })}
        <span className="flex-1" />
        {btn(labels.source, <Code className="size-4" />, () => setSource(!source), source)}
      </div>
      {source ? (
        <textarea id={id} className="block min-h-40 w-full bg-canvas p-3 font-mono text-xs" value={value} onChange={(e) => onChange(e.target.value)} />
      ) : (
        <div id={id} ref={ref} contentEditable suppressContentEditableWarning role="textbox" aria-multiline onInput={emit} onBlur={emit}
          className="prose-sm min-h-40 p-3 text-sm outline-none [&_a]:text-primary [&_a]:underline [&_h2]:text-lg [&_h2]:font-semibold [&_h3]:font-semibold [&_ol]:list-decimal [&_ol]:pl-5 [&_ul]:list-disc [&_ul]:pl-5" />
      )}
    </div>
  );
}
