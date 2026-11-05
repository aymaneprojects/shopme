import { Button, Checkbox, ImageUploader, Input, Select, Textarea, uploadFile, useToast } from '@shopme/ui';
import { useQuery } from '@tanstack/react-query';
import { ExternalLink, ImagePlus, Upload, X } from 'lucide-react';
import { useContext, useRef, useState } from 'react';
import { gql } from '../api';
import { MO_PICK_ENTRIES } from '../graphql';
import { RichText } from './RichText';
import { ColorSchemesField } from './theme-fields/ColorSchemesField';
import { SchemesContext } from './theme-fields/context';
import { DynamicSourceButton } from './theme-fields/DynamicSource';
import { FreeImagesDialog } from './theme-fields/FreeImages';
import { ResourceSelect } from './theme-fields/ResourceSelect';
import { Segmented } from './theme-fields/Segmented';
import { useI18n } from '../i18n';
import { FONT_OPTIONS } from '../lib/settings-schema';
import { schemeOptions } from '../lib/settings-schema';
import type { SchemeSet, SettingDef, SettingValue } from '../lib/settings-schema';

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

/** Label row of a text setting, with the dynamic source button when the setting can read page data. */
function LabelRow({ label, children }: { label: string; children?: React.ReactNode }) {
  return <span className="flex items-center justify-between gap-2 text-[13px] font-medium"><span>{label}</span>{children}</span>;
}

/** A video address (YouTube, Vimeo or a file address) with an upload button for a video file. */
function VideoField({ label, info, value, onChange }: { label: string; info?: string; value: string; onChange: (v: string) => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const choose = async (f: File | undefined) => {
    if (!f) return;
    setBusy(true);
    try { onChange((await uploadFile(f)).url); } catch (e) { toast(e instanceof Error ? e.message : String(e), 'critical'); } finally { setBusy(false); if (input.current) input.current.value = ''; }
  };
  return (
    <div className="flex flex-col gap-1.5">
      <Input label={label} help={info} type="url" value={value} placeholder="https://" onChange={(e) => onChange(e.target.value)} />
      <input ref={input} type="file" accept="video/mp4,video/webm" hidden onChange={(e) => void choose(e.target.files?.[0])} />
      <div className="flex gap-2">
        <Button size="sm" loading={busy} onClick={() => input.current?.click()}><Upload className="size-3.5" />{t('bs.video.upload')}</Button>
        {value && <Button size="sm" onClick={() => onChange('')}>{t('common.remove')}</Button>}
      </div>
    </div>
  );
}

/** One theme setting rendered as the matching form control (shared by theme settings and section/block settings). */
export function SettingField({ def, label, info, value, optionLabel, onChange, dynamic }: { def: SettingDef & { id: string }; label: string; info?: string; value: SettingValue; optionLabel: (l?: string) => string; onChange: (v: SettingValue) => void; /** The setting can be bound to page data (section and block settings). */ dynamic?: boolean }) {
  const { t } = useI18n();
  const toast = useToast();
  const schemes = useContext(SchemesContext);
  const [free, setFree] = useState(false);
  const str = typeof value === 'object' && !Array.isArray(value) ? '' : String(value);
  switch (def.type) {
    case 'color':
      return (
        <div className="flex flex-col gap-1"><span className="text-[13px] font-medium">{label}</span>
          <div className="flex items-center gap-2">
            <input type="color" aria-label={label} value={/^#[0-9a-f]{6}$/i.test(str) ? str : '#000000'} onChange={(e) => onChange(e.target.value)} className="size-9 rounded border border-line" />
            <input aria-label={`${label} (hex)`} value={str} onChange={(e) => onChange(e.target.value)} className="w-28 field-control" />
            {str && def.default === '' && <button type="button" aria-label={t('bs.color.reset')} title={t('bs.color.reset')} onClick={() => onChange('')} className="grid size-7 place-items-center rounded text-muted hover:bg-hover hover:text-fg"><X className="size-3.5" /></button>}
          </div>{info && <p className="text-xs text-muted">{info}</p>}</div>
      );
    case 'textarea':
      return (
        <div className="flex flex-col gap-1">
          {dynamic && <LabelRow label={label}><DynamicSourceButton value={str} onChange={onChange} /></LabelRow>}
          <Textarea label={dynamic ? undefined : label} aria-label={label} help={info} value={str} onChange={(e) => onChange(e.target.value)} />
        </div>
      );
    case 'checkbox': return <Checkbox label={label} checked={value === true} onChange={(e) => onChange(e.target.checked)} />;
    case 'range':
      return (
        <div className="flex flex-col gap-1"><span className="flex justify-between text-[13px] font-medium">{label}<span className="font-normal text-muted">{str}{def.unit ?? ''}</span></span>
          <input type="range" aria-label={label} min={def.min} max={def.max} step={def.step ?? 1} value={Number(value)} onChange={(e) => onChange(Number(e.target.value))} className="accent-(--color-primary)" />
          {info && <p className="text-xs text-muted">{info}</p>}</div>
      );
    case 'select':
      if (def.variant === 'segmented' && (def.options?.length ?? 0) <= 4) return <Segmented label={label} help={info} value={str} options={(def.options ?? []).map((o) => ({ value: o.value, label: optionLabel(o.label) }))} onChange={onChange} />;
      return <Select label={label} help={info} value={str} onChange={(e) => onChange(e.target.value)}>{def.options?.map((o) => <option key={o.value} value={o.value}>{optionLabel(o.label)}</option>)}</Select>;
    case 'color_scheme': {
      const opts = schemeOptions(schemes);
      return (
        <Select label={label} help={info} value={str} onChange={(e) => onChange(e.target.value)}>
          {def.default === '' && <option value="">{t('bs.schemes.inherit')}</option>}
          {opts.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          {str && !opts.some((o) => o.id === str) && <option value={str}>{str}</option>}
        </Select>
      );
    }
    case 'color_scheme_group':
      return <ColorSchemesField def={def} label={label} optionLabel={optionLabel} value={(typeof value === 'object' && !Array.isArray(value) ? value : {}) as SchemeSet} onChange={onChange} />;
    case 'collection': case 'product': case 'page': case 'blog':
      return <ResourceSelect kind={def.type} label={label} info={info} value={str} onChange={onChange} />;
    case 'video_url': case 'video':
      return <VideoField label={label} info={info} value={str} onChange={onChange} />;
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
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => setFree(true)}><ImagePlus className="size-3.5" />{t('bs.free.browse')}</Button>
            {str && <Button size="sm" onClick={() => onChange('')}>{t('common.remove')}</Button>}
          </div>
          <FreeImagesDialog open={free} onClose={() => setFree(false)} onPick={onChange} />
        </div>
      );
    case 'richtext':
      return <div className="flex flex-col gap-1"><LabelRow label={label}>{dynamic && <DynamicSourceButton value={str} rich onChange={onChange} />}</LabelRow><RichText value={str} onChange={onChange} /></div>;
    case 'metaobject': case 'metaobject_list': return <MetaobjectSetting def={def} label={label} info={info} value={value} onChange={onChange} />;
    case 'html': case 'liquid': return <Textarea label={label} help={info} className="font-mono" value={str} onChange={(e) => onChange(e.target.value)} />;
    case 'url':
      return (
        <div className="flex items-end gap-1.5">
          <div className="min-w-0 flex-1"><Input label={label} help={info} type="url" value={str} onChange={(e) => onChange(e.target.value)} /></div>
          {str && <a href={str} target="_blank" rel="noopener noreferrer" aria-label={t('bs.link.open')} title={t('bs.link.open')} className="mb-px grid size-9 shrink-0 place-items-center rounded-lg border border-line text-muted hover:bg-hover hover:text-fg"><ExternalLink className="size-4" /></a>}
        </div>
      );
    case 'number': return <Input label={label} help={info} type="number" value={str} onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))} />;
    default:
      return dynamic && (def.type === 'text' || def.type === 'inline_richtext')
        ? (
          <div className="flex flex-col gap-1">
            <LabelRow label={label}><DynamicSourceButton value={str} onChange={onChange} /></LabelRow>
            <Input aria-label={label} help={info} type="text" value={str} onChange={(e) => onChange(e.target.value)} />
          </div>
        )
        : <Input label={label} help={info} type="text" value={str} onChange={(e) => onChange(e.target.value)} />;
  }
}
