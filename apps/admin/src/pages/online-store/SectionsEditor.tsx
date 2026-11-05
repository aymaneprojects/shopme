import { cx } from '@shopme/ui';
import { AlignLeft, ChevronRight, ClipboardPaste, Code, Copy, CopyPlus, Eye, EyeOff, GripVertical, Image as ImageIcon, LayoutPanelTop, MousePointerClick, Pencil, PlusCircle, SquareDashed, Trash2 } from 'lucide-react';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { useI18n } from '../../i18n';
import { allowedBlocks, blockOrder } from '../../lib/theme-template';
import type { Action, SchemaIndex, SectionInstance, Template } from '../../lib/theme-template';
import { EditorMenu } from './EditorMenu';
import type { EditorMenuItem } from './EditorMenu';

export type Docs = Record<string, Template>;
export interface Sel { file: string; section: string; block?: string }

export const baseName = (f: string) => f.replace(/^.*\//, '').replace(/\.(json|liquid)$/, '');

/** Storefront path previewed for a template (alternates such as `page.contact` use their base type). */
export function previewPath(template: string, h: { product?: string; collection?: string; page?: string; /** `<blog>/<article>` */ article?: string }): string {
  switch (template.split('.')[0]) {
    case 'product': return h.product ? `/products/${h.product}` : '/';
    case 'collection': return `/collections/${h.collection ?? 'all'}`;
    case 'list-collections': return '/collections';
    case 'page': return h.page ? `/pages/${h.page}` : '/';
    case 'article': return h.article ? `/blogs/${h.article}` : '/blogs/news';
    case 'blog': return `/blogs/${(h.article ?? 'news').split('/')[0]}`;
    case 'cart': return '/cart';
    case 'search': return '/search?q=a';
    case '404': return '/404-preview-not-found';
    default: return '/';
  }
}

/** Template base name for a storefront path the preview navigated to, or null when it maps to none. */
export function templateForPath(path: string): string | null {
  const p = path.split('?')[0]!.replace(/\/+$/, '') || '/';
  if (p === '/') return 'index';
  if (p === '/collections') return 'list-collections';
  if (p.startsWith('/collections/')) return 'collection';
  if (p.startsWith('/products/')) return 'product';
  if (p.startsWith('/pages/')) return 'page';
  if (p.startsWith('/blogs/')) return p.split('/').length > 3 ? 'article' : 'blog';
  if (p === '/cart') return 'cart';
  if (p === '/search') return 'search';
  return null;
}

interface Ops {
  edit: (file: string, action: Action) => void;
  duplicateSection: (file: string, id: string) => void;
  removeSection: (file: string, id: string) => void;
  removeBlock: (file: string, section: string, block: string) => void;
  add: (file: string, index?: number) => void;
  copy: (file: string, id: string) => void;
  paste: (file: string, index: number) => void;
  rename: (file: string, id: string) => void;
  /** Open the section's file in the code editor. */
  editCode?: (file: string, id: string) => void;
  canPaste: boolean;
}

const blockIcon = (type: string) => /head|title|text|paragraph|rich/.test(type) ? <AlignLeft /> : /button|cta/.test(type) ? <MousePointerClick /> : /image|media|video|logo|icon/.test(type) ? <ImageIcon /> : <SquareDashed />;
const linkRow = 'mx-2 my-px flex h-6 items-center gap-1.5 rounded-md pl-[29px] text-left text-[11px] text-accent hover:bg-hover';
const linkWidth = { width: 'calc(100% - 1rem)' };

/** The section tree of the sections tab: one titled group per template and group file, with its sections (expandable to their blocks) and an "add section" link. */
export function SectionsTree({ docs, order, idx, label, fileLabel, sectionTitle, blockTitle, sel, onSel, onHover, ops }: {
  docs: Docs; order: string[]; idx: SchemaIndex; label: (l?: string) => string; fileLabel: (f: string) => string;
  sectionTitle: (s: SectionInstance) => string; blockTitle: (s: SectionInstance, bid: string) => string;
  sel: Sel | null; onSel: (s: Sel) => void; onHover: (s: Sel | null) => void; ops: Ops;
}) {
  const { t } = useI18n();
  const [drag, setDrag] = useState<{ file: string; id: string } | null>(null);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [menu, setMenu] = useState<{ x: number; y: number; file: string; id: string } | null>(null);
  const { edit } = ops;
  const menuItems = (file: string, id: string): EditorMenuItem[] => {
    const doc = docs[file]; const s = doc?.sections[id]; const i = doc ? doc.order.indexOf(id) : 0;
    if (!doc || !s) return [];
    return [
      { key: 'copy', label: t('editor.copy'), icon: <Copy />, onSelect: () => ops.copy(file, id) },
      { key: 'paste', label: t('editor.paste'), icon: <ClipboardPaste />, disabled: !ops.canPaste, onSelect: () => ops.paste(file, i + 1) },
      { key: 'dup', label: t('editor.duplicate'), icon: <CopyPlus />, onSelect: () => ops.duplicateSection(file, id) },
      { key: 'rename', label: t('editor.rename'), icon: <Pencil />, onSelect: () => ops.rename(file, id) },
      { key: 'hide', label: s.disabled ? t('editor.show') : t('editor.hide'), icon: s.disabled ? <Eye /> : <EyeOff />, shortcut: 'Ctrl+Shift+H', onSelect: () => edit(file, { kind: 'toggleSection', id }) },
      ...(ops.editCode ? [{ key: 'code', label: t('bs.editCode'), icon: <Code />, onSelect: () => ops.editCode!(file, id) }] : []),
      { key: 'before', label: t('editor.addBefore'), icon: <PlusCircle />, separator: true, onSelect: () => ops.add(file, i) },
      { key: 'after', label: t('editor.addAfter'), icon: <PlusCircle />, onSelect: () => ops.add(file, i + 1) },
      { key: 'remove', label: t('common.delete'), icon: <Trash2 />, danger: true, separator: true, shortcut: 'Shift+⌫', onSelect: () => ops.removeSection(file, id) },
    ];
  };
  return (
    <>
      {order.map((file) => {
        const doc = docs[file]!;
        const addFirst = /footer/.test(file);
        const addSection = <button type="button" onClick={() => ops.add(file)} className={linkRow} style={linkWidth}><PlusCircle className="size-3.5 shrink-0" />{t('editor.addSection')}</button>;
        return (
          <section key={file} className="border-b border-line py-2 last:border-b-0" aria-label={fileLabel(file)}>
            <h2 className="px-4 pb-1.5 pt-0.5 text-[11px] font-semibold">{fileLabel(file)}</h2>
            {addFirst && addSection}
            <ul>
              {doc.order.map((id, i) => {
                const s = doc.sections[id]!;
                const key = `${file}:${id}`;
                const selected = sel?.file === file && sel.section === id && !sel.block;
                const inside = sel?.file === file && sel.section === id;
                const schema = idx.sections[s.type];
                const blocks = blockOrder(s);
                const types = allowedBlocks(schema, idx);
                const full = schema?.max_blocks !== undefined && blocks.length >= schema.max_blocks;
                const expandable = blocks.length > 0 || types.length > 0;
                const expanded = (open[key] ?? inside) && expandable;
                return (
                  <li key={id} onMouseEnter={() => onHover({ file, section: id })} onMouseLeave={() => onHover(null)} draggable onDragStart={() => setDrag({ file, id })} onDragEnd={() => setDrag(null)} onDragOver={(e) => drag?.file === file && e.preventDefault()}
                    onDrop={() => { if (drag?.file === file && drag.id !== id) edit(file, { kind: 'moveSection', id: drag.id, to: i }); setDrag(null); }}
                    onContextMenu={(e) => { e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY, file, id }); }}>
                    <Row selected={selected} dim={!!s.disabled} hidden={!!s.disabled} onSelect={() => { onSel({ file, section: id }); setOpen((o) => ({ ...o, [key]: true })); }}
                      title={sectionTitle(s)} icon={<LayoutPanelTop />} expanded={expanded} onExpand={expandable ? () => setOpen((o) => ({ ...o, [key]: !expanded })) : undefined} grip
                      labels={{ show: t('editor.show'), hide: t('editor.hide'), remove: t('common.remove') }}
                      onToggle={() => edit(file, { kind: 'toggleSection', id })} onRemove={() => ops.removeSection(file, id)} />
                    {expanded && (
                      <ul>
                        {types.length > 0 && (
                          <li>
                            {full ? <p className="px-[29px] py-1 text-[11px] text-muted">{t('editor.maxBlocks', { n: schema!.max_blocks! })}</p>
                              : <BlockAdder label={t('editor.addBlockTo', { name: sectionTitle(s) })} text={t('editor.addBlock')}
                                items={types.map((b) => ({ key: b.type, label: label(b.name) || b.type, icon: blockIcon(b.type), disabled: b.limit !== undefined && blocks.filter((x) => s.blocks![x]!.type === b.type).length >= b.limit, onSelect: () => edit(file, { kind: 'addBlock', section: id, type: b.type, max: schema?.max_blocks, limit: b.limit }) }))} />}
                          </li>
                        )}
                        {blocks.map((bid) => {
                          const b = s.blocks![bid]!;
                          const bsel = sel?.file === file && sel.section === id && sel.block === bid;
                          const bname = blockTitle(s, bid);
                          return (
                            <li key={bid}>
                              <Row selected={bsel} dim={!!b.disabled} onSelect={() => onSel({ file, section: id, block: bid })} title={b.static ? `${bname} (${t('editor.static')})` : bname} hidden={!!b.disabled} icon={blockIcon(b.type)} indent
                                labels={{ show: t('editor.show'), hide: t('editor.hide'), remove: t('common.remove') }}
                                onToggle={() => edit(file, { kind: 'toggleBlock', section: id, block: bid })}
                                onRemove={b.static ? undefined : () => ops.removeBlock(file, id, bid)} />
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </li>
                );
              })}
            </ul>
            {!addFirst && addSection}
          </section>
        );
      })}
      {menu && <EditorMenu at={menu} items={menuItems(menu.file, menu.id)} label={t('editor.sectionMenu')} onClose={() => setMenu(null)} />}
    </>
  );
}

/** "Add block" link that opens the list of block types under it. */
function BlockAdder({ label, text, items }: { label: string; text: string; items: EditorMenuItem[] }) {
  const [at, setAt] = useState<{ x: number; y: number } | null>(null);
  return (
    <>
      <button type="button" aria-label={label} aria-haspopup="menu" onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setAt({ x: r.left + 24, y: r.bottom + 2 }); }} className={linkRow} style={linkWidth}><PlusCircle className="size-3.5 shrink-0" />{text}</button>
      {at && <EditorMenu at={at} items={items} label={label} onClose={() => setAt(null)} />}
    </>
  );
}

function Row({ title, selected, dim, hidden, grip, icon, indent, expanded, onExpand, labels, onSelect, onToggle, onRemove }: {
  title: string; selected: boolean; dim: boolean; hidden: boolean; grip?: boolean; icon: ReactNode; indent?: boolean; expanded?: boolean; onExpand?: () => void;
  labels: Record<'show' | 'hide' | 'remove', string>; onSelect: () => void; onToggle: () => void; onRemove?: () => void;
}) {
  const tone = selected ? 'text-on-primary' : 'text-muted';
  const act = cx('hidden size-5 shrink-0 place-items-center rounded group-hover:grid group-focus-within:grid', selected ? 'text-on-primary hover:bg-white/20' : 'text-muted hover:bg-surface hover:text-fg');
  return (
    <div className={cx('group relative mx-2 flex h-6 items-center rounded-md px-px', selected ? 'bg-primary text-on-primary' : 'hover:bg-hover')}>
      {indent ? <span className="w-[14px] shrink-0" /> : (
        <button type="button" tabIndex={-1} aria-hidden onClick={onExpand} className={cx('grid size-[14px] shrink-0 place-items-center rounded', tone, !onExpand && 'invisible')}>
          <ChevronRight className={cx('size-3 transition-transform', expanded && 'rotate-90')} />
        </button>
      )}
      <button type="button" onClick={onSelect} aria-current={selected} className={cx('flex h-full min-w-0 flex-1 items-center gap-1.5 pl-1.5 text-left text-[11px]', selected && 'font-semibold', dim && !selected && 'text-muted line-through decoration-1')}>
        <span className={cx('relative grid size-3.5 shrink-0 place-items-center [&_svg]:size-3.5 [&_svg]:stroke-[1.6]', tone)} aria-hidden>
          <span className={cx('grid place-items-center', grip && 'group-hover:invisible')}>{icon}</span>
          {grip && <GripVertical className="absolute hidden size-3 cursor-grab group-hover:block" />}
        </span>
        <span className="min-w-0 flex-1 truncate">{title}</span>
      </button>
      {onRemove && <button type="button" className={act} aria-label={`${labels.remove}: ${title}`} onClick={onRemove}><Trash2 className="size-3" /></button>}
      <button type="button" className={act} aria-label={`${hidden ? labels.show : labels.hide}: ${title}`} onClick={onToggle}>{hidden ? <EyeOff className="size-3" /> : <Eye className="size-3" />}</button>
    </div>
  );
}
