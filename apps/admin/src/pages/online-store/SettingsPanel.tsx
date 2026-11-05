import { Dropdown } from '@shopme/ui';
import type { MenuItem } from '@shopme/ui';
import { ArrowLeft, Copy, Eye, EyeOff, MoreHorizontal, Trash2, X } from 'lucide-react';
import { SettingField } from '../../components/SettingField';
import { useT } from '../../i18n';
import { coerceValue } from '../../lib/settings-schema';
import type { SettingDef, SettingValue } from '../../lib/settings-schema';

export interface PanelActions { duplicate?: () => void; toggle: () => void; hidden: boolean; remove?: () => void }

const isField = (s: SettingDef): s is SettingDef & { id: string } => !!s.id;

/** Settings of the selected section or block: header with back (blocks) and close, a "..." menu (duplicate, hide/show, remove), then the fields. */
export function SettingsPanel({ title, scope, defs, values, label, onChange, onBack, onClose, actions, notice }: {
  title: string; scope: string; defs: SettingDef[]; values: Record<string, SettingValue>; label: (l?: string) => string;
  onChange: (key: string, v: SettingValue) => void; onBack?: () => void; onClose: () => void; actions: PanelActions; notice?: string;
}) {
  const t = useT();
  const items: MenuItem[] = [
    ...(actions.duplicate ? [{ key: 'duplicate', label: t('editor.duplicate'), icon: <Copy className="size-4" />, onSelect: actions.duplicate }] : []),
    { key: 'toggle', label: actions.hidden ? t('editor.show') : t('editor.hide'), icon: actions.hidden ? <Eye className="size-4" /> : <EyeOff className="size-4" />, onSelect: actions.toggle },
    ...(actions.remove ? [{ key: 'remove', label: t('common.remove'), icon: <Trash2 className="size-4" />, danger: true, onSelect: actions.remove }] : []),
  ];
  return (
    <section className="flex min-h-0 flex-col rounded-lg border border-line bg-canvas lg:max-h-[calc(100vh-11rem)]" aria-label={t('editor.settings')}>
      <header className="flex items-center gap-1 border-b border-line px-2 py-1.5">
        {onBack && <button type="button" aria-label={t('common.back')} onClick={onBack} className="rounded p-1.5 text-muted hover:bg-surface hover:text-fg"><ArrowLeft className="size-4" /></button>}
        <h2 className="min-w-0 flex-1 truncate px-1 text-[13px] font-semibold">{title}</h2>
        <Dropdown align="right" icon variant="plain" size="sm" label={t('common.moreActions')} trigger={<MoreHorizontal className="size-4" />} items={items} />
        <button type="button" aria-label={t('common.close')} onClick={onClose} className="rounded p-1.5 text-muted hover:bg-surface hover:text-fg"><X className="size-4" /></button>
      </header>
      <div className="flex min-h-0 flex-col gap-3 overflow-y-auto p-3">
        {notice && <p className="text-xs text-muted">{notice}</p>}
        {!defs.length && <p className="text-[13px] text-muted">{t('editor.noSettings')}</p>}
        {defs.map((d, i) => isField(d)
          ? <SettingField key={`${scope}:${d.id}`} def={d} label={label(d.label)} info={d.info ? label(d.info) : undefined} optionLabel={label}
            value={coerceValue(d, values[d.id])} onChange={(v) => onChange(d.id, v)} />
          : d.type === 'header' ? <h3 key={i} className="text-[13px] font-semibold">{label(d.content)}</h3>
            : d.type === 'paragraph' ? <p key={i} className="text-xs text-muted">{label(d.content)}</p> : null)}
      </div>
    </section>
  );
}
