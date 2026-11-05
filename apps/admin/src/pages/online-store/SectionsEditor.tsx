import { Button, Dropdown, cx } from '@shopme/ui';
import type { MenuItem } from '@shopme/ui';
import { ArrowDown, ArrowUp, ClipboardPaste, Copy, CopyPlus, Eye, EyeOff, GripVertical, MoreHorizontal, Pencil, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useI18n, useT } from '../../i18n';
import { allowedBlocks, blockOrder } from '../../lib/theme-template';
import type { Action, SchemaIndex, SectionInstance, Template } from '../../lib/theme-template';

export type Docs = Record<string, Template>;
export interface Sel { file: string; section: string; block?: string }

export const baseName = (f: string) => f.replace(/^.*\//, '').replace(/\.(json|liquid)$/, '');

/** Storefront path previewed for a template (alternates such as `page.contact` use their base type). */
export function previewPath(template: string, h: { product?: string; collection?: string; page?: string }): string {
  switch (template.split('.')[0]) {
    case 'product': return h.product ? `/products/${h.product}` : '/';
    case 'collection': return `/collections/${h.collection ?? 'all'}`;
    case 'list-collections': return '/collections';
    case 'page': return h.page ? `/pages/${h.page}` : '/';
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
  canPaste: boolean;
}

/** The section tree of the sections tab: template and group files with their sections and blocks. */
export function SectionsTree({ docs, order, idx, label, fileLabel, sectionTitle, blockTitle, sel, onSel, onHover, ops }: {
  docs: Docs; order: string[]; idx: SchemaIndex; label: (l?: string) => string; fileLabel: (f: string) => string;
  sectionTitle: (s: SectionInstance) => string; blockTitle: (s: SectionInstance, bid: string) => string;
  sel: Sel | null; onSel: (s: Sel) => void; onHover: (s: Sel | null) => void; ops: Ops;
}) {
  const { t } = useI18n();
  const [drag, setDrag] = useState<{ file: string; id: string } | null>(null);
  const { edit } = ops;
  return (
    <>
      {order.map((file) => {
        const doc = docs[file]!;
        return (
          <section key={file} className="rounded-lg border border-line bg-canvas" aria-label={fileLabel(file)}>
            <h2 className="flex items-center border-b border-line px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted">{fileLabel(file)}</h2>
            <ul className="p-1">
              {doc.order.map((id, i) => {
                const s = doc.sections[id]!;
                const selected = sel?.file === file && sel.section === id && !sel.block;
                const schema = idx.sections[s.type];
                const blocks = blockOrder(s);
                const types = allowedBlocks(schema, idx);
                const full = schema?.max_blocks !== undefined && blocks.length >= schema.max_blocks;
                return (
                  <li key={id} onMouseEnter={() => onHover({ file, section: id })} onMouseLeave={() => onHover(null)} draggable onDragStart={() => setDrag({ file, id })} onDragEnd={() => setDrag(null)} onDragOver={(e) => drag?.file === file && e.preventDefault()}
                    onDrop={() => { if (drag?.file === file && drag.id !== id) edit(file, { kind: 'moveSection', id: drag.id, to: i }); setDrag(null); }}>
                    <Row selected={selected} dim={!!s.disabled} onSelect={() => onSel({ file, section: id })} grip
                      title={sectionTitle(s)} hidden={!!s.disabled} labels={{ up: t('editor.moveUp'), down: t('editor.moveDown'), show: t('editor.show'), hide: t('editor.hide'), remove: t('common.remove'), duplicate: t('editor.duplicate') }}
                      onUp={i > 0 ? () => edit(file, { kind: 'moveSection', id, to: i - 1 }) : undefined} onDown={i < doc.order.length - 1 ? () => edit(file, { kind: 'moveSection', id, to: i + 1 }) : undefined}
                      menu={[
                        { key: 'copy', label: t('editor.copy'), icon: <Copy className="size-4" />, onSelect: () => ops.copy(file, id) },
                        { key: 'paste', label: t('editor.paste'), icon: <ClipboardPaste className="size-4" />, disabled: !ops.canPaste, onSelect: () => ops.paste(file, i + 1) },
                        { key: 'dup', label: t('editor.duplicate'), icon: <CopyPlus className="size-4" />, onSelect: () => ops.duplicateSection(file, id) },
                        { key: 'rename', label: t('editor.rename'), icon: <Pencil className="size-4" />, onSelect: () => ops.rename(file, id) },
                        { key: 'hide', label: s.disabled ? t('editor.show') : t('editor.hide'), icon: s.disabled ? <Eye className="size-4" /> : <EyeOff className="size-4" />, onSelect: () => edit(file, { kind: 'toggleSection', id }) },
                        { key: 'before', label: t('editor.addBefore'), icon: <Plus className="size-4" />, onSelect: () => ops.add(file, i) },
                        { key: 'after', label: t('editor.addAfter'), icon: <Plus className="size-4" />, onSelect: () => ops.add(file, i + 1) },
                        { key: 'remove', label: t('common.remove'), icon: <Trash2 className="size-4" />, danger: true, onSelect: () => ops.removeSection(file, id) },
                      ]} onToggle={() => edit(file, { kind: 'toggleSection', id })} onRemove={() => ops.removeSection(file, id)} />
                    <ul className="ml-6 border-l border-line pl-1">
                      {blocks.map((bid, bi) => {
                        const b = s.blocks![bid]!;
                        const bsel = sel?.file === file && sel.section === id && sel.block === bid;
                        const bname = blockTitle(s, bid);
                        return (
                          <li key={bid}>
                            <Row selected={bsel} dim={!!b.disabled} onSelect={() => onSel({ file, section: id, block: bid })} title={b.static ? `${bname} (${t('editor.static')})` : bname} hidden={!!b.disabled}
                              labels={{ up: t('editor.moveUp'), down: t('editor.moveDown'), show: t('editor.show'), hide: t('editor.hide'), remove: t('common.remove') }}
                              onUp={!b.static && bi > 0 ? () => edit(file, { kind: 'moveBlock', section: id, block: bid, to: bi - 1 }) : undefined}
                              onDown={!b.static && bi < blocks.length - 1 ? () => edit(file, { kind: 'moveBlock', section: id, block: bid, to: bi + 1 }) : undefined}
                              onToggle={() => edit(file, { kind: 'toggleBlock', section: id, block: bid })}
                              onRemove={b.static ? undefined : () => ops.removeBlock(file, id, bid)} />
                          </li>
                        );
                      })}
                      {types.length > 0 && (
                        <li className="px-2 py-1">
                          <Dropdown label={t('editor.addBlockTo', { name: sectionTitle(s) })} trigger={<><Plus className="size-3.5" />{t('editor.addBlock')}</>}
                            items={full ? [{ key: 'max', label: t('editor.maxBlocks', { n: schema!.max_blocks! }), disabled: true, onSelect: () => {} }] : types.map((b) => ({
                              key: b.type, label: label(b.name) || b.type,
                              disabled: b.limit !== undefined && blocks.filter((x) => s.blocks![x]!.type === b.type).length >= b.limit,
                              onSelect: () => edit(file, { kind: 'addBlock', section: id, type: b.type, max: schema?.max_blocks, limit: b.limit }),
                            }))} />
                        </li>
                      )}
                    </ul>
                  </li>
                );
              })}
            </ul>
            <div className="border-t border-line p-2"><Button size="sm" onClick={() => ops.add(file)}><Plus className="size-4" />{t('editor.addSection')}</Button></div>
          </section>
        );
      })}
    </>
  );
}

function Row({ title, selected, dim, hidden, grip, labels, onSelect, onUp, onDown, onToggle, onRemove, menu }: {
  title: string; selected: boolean; dim: boolean; hidden: boolean; grip?: boolean; labels: Record<'up' | 'down' | 'show' | 'hide' | 'remove', string> & { duplicate?: string };
  onSelect: () => void; onUp?: () => void; onDown?: () => void; onToggle: () => void; onRemove?: () => void; menu?: MenuItem[];
}) {
  const t = useT();
  const btn = 'rounded p-1 text-muted hover:bg-surface hover:text-fg disabled:opacity-30';
  return (
    <div className={cx('group flex items-center gap-0.5 rounded-md px-1', selected ? 'bg-primary-subtle' : 'hover:bg-surface')}>
      {grip && <GripVertical className="size-3.5 shrink-0 cursor-grab text-muted" aria-hidden />}
      <button type="button" onClick={onSelect} aria-current={selected} className={cx('min-w-0 flex-1 truncate py-1.5 pl-1 text-left text-[13px]', dim && 'text-muted line-through decoration-1', selected && 'font-medium text-accent')}>{title}</button>
      <button type="button" className={btn} aria-label={`${labels.up}: ${title}`} disabled={!onUp} onClick={onUp}><ArrowUp className="size-3.5" /></button>
      <button type="button" className={btn} aria-label={`${labels.down}: ${title}`} disabled={!onDown} onClick={onDown}><ArrowDown className="size-3.5" /></button>
      <button type="button" className={btn} aria-label={`${hidden ? labels.show : labels.hide}: ${title}`} onClick={onToggle}>{hidden ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}</button>
      {menu && <Dropdown align="right" icon variant="plain" size="sm" label={`${t('editor.sectionMenu')}: ${title}`} trigger={<MoreHorizontal className="size-3.5" />} items={menu} />}
      {onRemove && <button type="button" className={btn} aria-label={`${labels.remove}: ${title}`} onClick={onRemove}><Trash2 className="size-3.5" /></button>}
    </div>
  );
}
