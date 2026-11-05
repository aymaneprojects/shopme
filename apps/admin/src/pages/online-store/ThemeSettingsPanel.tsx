import { ChevronDown, Search } from 'lucide-react';
import { useState } from 'react';
import { SettingField } from '../../components/SettingField';
import { useT } from '../../i18n';
import { isInput, visibleSettings } from '../../lib/settings-schema';
import type { SettingDef, SettingGroup, SettingValue } from '../../lib/settings-schema';

/** Keep the settings that match `needle` (label, help or id), with the headers and paragraphs that introduce them. */
export function filterSettings(settings: SettingDef[], needle: string, label: (l?: string) => string): SettingDef[] {
  const n = needle.trim().toLowerCase();
  if (!n) return settings;
  const hit = (s: SettingDef) => isInput(s) && [label(s.label), s.info ? label(s.info) : '', s.id].some((x) => x.toLowerCase().includes(n));
  const out: SettingDef[] = [];
  let lead: SettingDef[] = [];
  for (const s of settings) {
    if (isInput(s)) { if (hit(s)) { out.push(...lead, s); lead = []; } } else if (s.type === 'header') lead = [s]; else lead.push(s);
  }
  return out;
}

/** Theme settings: a list of collapsible rows (name, chevron), narrowed by a search box (matching groups open by themselves). */
export function ThemeSettingsPanel({ groups, values, label, onChange }: { groups: SettingGroup[]; values: Record<string, SettingValue>; label: (l?: string) => string; onChange: (id: string, v: SettingValue) => void }) {
  const t = useT();
  const [find, setFind] = useState('');
  const shown = groups.map((g) => ({ g, settings: visibleSettings(filterSettings(g.settings, find, label), { settings: values }), nameHit: !!find.trim() && label(g.name).toLowerCase().includes(find.trim().toLowerCase()) }))
    .map((x) => (x.nameHit && !x.settings.length ? { ...x, settings: x.g.settings } : x)).filter((x) => x.settings.length);
  return (
    <div className="flex flex-col">
      <div className="relative px-3 pb-2 pt-2">
        <Search className="pointer-events-none absolute left-5 top-4 size-3.5 text-muted" />
        <input type="search" value={find} onChange={(e) => setFind(e.target.value)} placeholder={t('editor.searchSettings')} aria-label={t('editor.searchSettings')} className="field-control w-full pl-8 text-[12px]" />
      </div>
      {groups.length === 0 && <p className="px-4 text-[13px] text-muted">{t('themes.noSettings')}</p>}
      {groups.length > 0 && shown.length === 0 && <p className="px-4 text-[13px] text-muted">{t('editor.noSettingsMatch')}</p>}
      {shown.map(({ g, settings }) => (
        <details key={`${g.name}:${find.trim() ? 'q' : 'n'}`} open={!!find.trim() || groups[0] === g} className="group/d border-b border-line last:border-b-0">
          <summary className="flex h-10 cursor-pointer list-none items-center justify-between px-3 text-[12px] font-medium hover:bg-hover [&::-webkit-details-marker]:hidden">
            {label(g.name)}<ChevronDown className="size-3.5 text-muted transition-transform group-open/d:rotate-180" />
          </summary>
          <div className="flex flex-col gap-3 px-3 pb-4 pt-1">
            {settings.map((s, i) => isInput(s)
              ? <SettingField key={s.id} def={s} label={label(s.label)} info={s.info ? label(s.info) : undefined} value={values[s.id]!} optionLabel={label} onChange={(v) => onChange(s.id, v)} />
              : s.type === 'header' ? <h3 key={i} className="text-[13px] font-semibold">{label(s.content)}</h3>
                : s.type === 'paragraph' ? <p key={i} className="text-xs text-muted">{label(s.content)}</p> : null)}
          </div>
        </details>
      ))}
    </div>
  );
}
