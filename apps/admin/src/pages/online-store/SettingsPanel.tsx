import { ArrowLeft, Code, Copy, Eye, EyeOff, LayoutPanelTop, MoreHorizontal, Trash2, X } from 'lucide-react';
import { useState } from 'react';
import { SettingField } from '../../components/SettingField';
import { useT } from '../../i18n';
import { coerceValue, visibleSettings } from '../../lib/settings-schema';
import type { SettingDef, SettingValue, VisibilityScope } from '../../lib/settings-schema';
import { EditorMenu } from './EditorMenu';
import type { EditorMenuItem } from './EditorMenu';

export interface PanelActions { duplicate?: () => void; toggle: () => void; hidden: boolean; remove?: () => void; editCode?: () => void }

const isField = (s: SettingDef): s is SettingDef & { id: string } => !!s.id;

/** Settings of the selected section or block: header with icon (back arrow for blocks), a "..." menu (duplicate, hide/show, remove) and close, then the fields. */
export function SettingsPanel({ title, scope, defs, values, label, onChange, onBack, onClose, actions, notice, visibility }: {
  title: string; scope: string; defs: SettingDef[]; values: Record<string, SettingValue>; label: (l?: string) => string; /** What `visible_if` conditions read (settings with their defaults applied). */ visibility: VisibilityScope;
  onChange: (key: string, v: SettingValue) => void; onBack?: () => void; onClose: () => void; actions: PanelActions; notice?: string;
}) {
  const t = useT();
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const items: EditorMenuItem[] = [
    ...(actions.duplicate ? [{ key: 'duplicate', label: t('editor.duplicate'), icon: <Copy />, onSelect: actions.duplicate }] : []),
    ...(actions.editCode ? [{ key: 'code', label: t('bs.editCode'), icon: <Code />, onSelect: actions.editCode }] : []),
    { key: 'toggle', label: actions.hidden ? t('editor.show') : t('editor.hide'), icon: actions.hidden ? <Eye /> : <EyeOff />, onSelect: actions.toggle },
    ...(actions.remove ? [{ key: 'remove', label: t('common.remove'), icon: <Trash2 />, danger: true, separator: true, onSelect: actions.remove }] : []),
  ];
  const hb = 'grid size-6 place-items-center rounded text-muted hover:bg-hover hover:text-fg';
  return (
    <section className="flex min-h-0 w-[250px] shrink-0 flex-col overflow-hidden rounded-lg border border-line bg-canvas" aria-label={t('editor.settings')}>
      <header className="flex h-[34px] shrink-0 items-center gap-1 border-b border-line px-2">
        {onBack ? <button type="button" aria-label={t('common.back')} onClick={onBack} className={hb}><ArrowLeft className="size-3.5" /></button>
          : <LayoutPanelTop className="ml-1 size-3.5 shrink-0 text-muted" aria-hidden />}
        <h2 className="min-w-0 flex-1 truncate px-1 text-[12px] font-medium">{title}</h2>
        <button type="button" aria-label={t('common.moreActions')} aria-haspopup="menu" onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setMenu({ x: r.right, y: r.bottom + 2 }); }} className={hb}><MoreHorizontal className="size-3.5" /></button>
        <button type="button" aria-label={t('common.close')} onClick={onClose} className={hb}><X className="size-3.5" /></button>
        {menu && <EditorMenu at={menu} align="right" items={items} label={t('common.moreActions')} onClose={() => setMenu(null)} />}
      </header>
      <div className="flex min-h-0 flex-col gap-3 overflow-y-auto p-3">
        {notice && <p className="text-xs text-muted">{notice}</p>}
        {!defs.length && <p className="text-[13px] text-muted">{t('editor.noSettings')}</p>}
        {visibleSettings(defs, visibility).map((d, i) => isField(d)
          ? <SettingField key={`${scope}:${d.id}`} def={d} label={label(d.label)} info={d.info ? label(d.info) : undefined} optionLabel={label} dynamic
            value={coerceValue(d, values[d.id])} onChange={(v) => onChange(d.id, v)} />
          : d.type === 'header' ? <h3 key={i} className="text-[12px] font-semibold">{label(d.content)}</h3>
            : d.type === 'paragraph' ? <p key={i} className="text-xs text-muted">{label(d.content)}</p> : null)}
      </div>
    </section>
  );
}
