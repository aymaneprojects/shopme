import { Button, Checkbox, ImageUploader, Input, Select, Textarea, useToast } from '@shopme/ui';
import { useQuery } from '@tanstack/react-query';
import { gql } from '../api';
import { MO_PICK_ENTRIES } from '../graphql';
import { RichText } from './RichText';
import { useI18n } from '../i18n';
import { FONT_OPTIONS } from '../lib/settings-schema';
import type { SettingDef, SettingValue } from '../lib/settings-schema';

/** `shopify://shop_images/x.png` references point at the store's files. */
const fileSrc = (v: string) => v.replace(/^shopify:\/\/shop_images\//, '/files/');

/** Entries of the setting's metaobject type; stored values are `shopify://metaobjects/<type>/<handle>`. */
function MetaobjectSetting({ def, label, info, value, onChange }: { def: SettingDef & { id: string }; label: string; info?: string; value: SettingValue; onChange: (v: SettingValue) => void }) {
  const { t } = useI18n();
  const type = def.metaobject_type ?? '';
  const entries = useQuery({ queryKey: ['mo-setting-entries', type], enabled: !!type, queryFn: async () => (await gql<{ metaobjects: { nodes: Array<{ id: string; displayName: string; handle: string }> } }>(MO_PICK_ENTRIES, { type, query: null })).metaobjects.nodes });
  const ref = (handle: string) => `shopify://metaobjects/${type}/${handle}`;
  const rows = entries.data ?? [];
  if (def.type === 'metaobject') {
    return <Select label={label} help={info ?? (type ? undefined : t('mo.settingNoType'))} value={String(value)} onChange={(e) => onChange(e.target.value)}><option value="" />{rows.map((r) => <option key={r.id} value={ref(r.handle)}>{r.displayName}</option>)}</Select>;
  }
  const list = Array.isArray(value) ? value : [];
  const toggle = (v: string, on: boolean) => onChange(on ? [...list, v].slice(0, def.limit ?? 50) : list.filter((x) => x !== v));
  return (
    <fieldset className="flex flex-col gap-1"><legend className="text-[13px] font-medium">{label}</legend>
      {rows.map((r) => <Checkbox key={r.id} label={r.displayName} checked={list.includes(ref(r.handle))} onChange={(e) => toggle(ref(r.handle), e.target.checked)} />)}
      {!rows.length && <p className="text-xs text-muted">{t('mo.noneYet')}</p>}
      {info && <p className="text-xs text-muted">{info}</p>}</fieldset>
  );
}

/** One theme setting rendered as the matching form control (shared by theme settings and section/block settings). */
export function SettingField({ def, label, info, value, optionLabel, onChange }: { def: SettingDef & { id: string }; label: string; info?: string; value: SettingValue; optionLabel: (l?: string) => string; onChange: (v: SettingValue) => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const str = String(value);
  switch (def.type) {
    case 'color':
      return (
        <div className="flex flex-col gap-1"><span className="text-[13px] font-medium">{label}</span>
          <div className="flex items-center gap-2">
            <input type="color" aria-label={label} value={/^#[0-9a-f]{6}$/i.test(str) ? str : '#000000'} onChange={(e) => onChange(e.target.value)} className="size-9 rounded border border-line" />
            <input aria-label={`${label} (hex)`} value={str} onChange={(e) => onChange(e.target.value)} className="w-28 field-control" />
          </div>{info && <p className="text-xs text-muted">{info}</p>}</div>
      );
    case 'textarea': return <Textarea label={label} help={info} value={str} onChange={(e) => onChange(e.target.value)} />;
    case 'checkbox': return <Checkbox label={label} checked={value === true} onChange={(e) => onChange(e.target.checked)} />;
    case 'range':
      return (
        <div className="flex flex-col gap-1"><span className="flex justify-between text-[13px] font-medium">{label}<span className="font-normal text-muted">{str}{def.unit ?? ''}</span></span>
          <input type="range" aria-label={label} min={def.min} max={def.max} step={def.step ?? 1} value={Number(value)} onChange={(e) => onChange(Number(e.target.value))} className="accent-(--color-primary)" />
          {info && <p className="text-xs text-muted">{info}</p>}</div>
      );
    case 'select':
      return <Select label={label} help={info} value={str} onChange={(e) => onChange(e.target.value)}>{def.options?.map((o) => <option key={o.value} value={o.value}>{optionLabel(o.label)}</option>)}</Select>;
    case 'font_picker':
      return <Select label={label} help={info} value={str} onChange={(e) => onChange(e.target.value)}>{[...FONT_OPTIONS, ...(FONT_OPTIONS.some((f) => f.value === str) || !str ? [] : [{ value: str, label: str }])].map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</Select>;
    case 'radio':
      return (
        <fieldset className="flex flex-col gap-1"><legend className="text-[13px] font-medium">{label}</legend>
          {def.options?.map((o) => <label key={o.value} className="inline-flex items-center gap-2 text-[13px]"><input type="radio" name={def.id} className="accent-(--color-primary)" checked={str === o.value} onChange={() => onChange(o.value)} />{optionLabel(o.label)}</label>)}</fieldset>
      );
    case 'image_picker':
      return (
        <div className="flex flex-col gap-2"><span className="text-[13px] font-medium">{label}</span>
          {str && <img src={fileSrc(str)} alt="" className="max-h-24 w-fit rounded-md border border-line object-contain" />}
          <ImageUploader multiple={false} compact label={t('media.upload')} onUploaded={(f) => onChange(f[0]!.url)} onError={(m) => toast(m, 'critical')} />
          {str && <Button size="sm" onClick={() => onChange('')}>{t('common.remove')}</Button>}</div>
      );
    case 'richtext':
      return <div className="flex flex-col gap-1"><span className="text-[13px] font-medium">{label}</span><RichText value={str} onChange={onChange} /></div>;
    case 'metaobject': case 'metaobject_list': return <MetaobjectSetting def={def} label={label} info={info} value={value} onChange={onChange} />;
    case 'html': case 'liquid': return <Textarea label={label} help={info} className="font-mono" value={str} onChange={(e) => onChange(e.target.value)} />;
    default:
      return <Input label={label} help={info} type={def.type === 'url' ? 'url' : 'text'} value={str} onChange={(e) => onChange(e.target.value)} />;
  }
}
