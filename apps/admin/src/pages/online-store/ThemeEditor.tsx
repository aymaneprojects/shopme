import { Banner, Button, Checkbox, ImageUploader, Input, RichTextEditor, Select, Skeleton, Textarea, useToast } from '@shopme/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Monitor, Smartphone } from 'lucide-react';
import { useState } from 'react';
import { gql, mutate } from '../../api';
import { PageHeader } from '../../components/PageHeader';
import { SaveBar } from '../../components/SaveBar';
import { numToGid } from '../../format';
import { THEME_FILES_UPSERT, THEME_LOCALES, THEME_SETTINGS } from '../../graphql';
import { useI18n } from '../../i18n';
import { useParams } from 'react-router';
import { FONT_OPTIONS, buildValues, isInput, parseCurrent, parseDict, parseSchema, resolveLabel, serializeData } from '../../lib/settings-schema';
import type { SettingDef, SettingGroup, SettingValue } from '../../lib/settings-schema';

interface FilesRes { theme: { id: string; name?: string; files: { nodes: Array<{ filename: string; body: { content?: string } | null }> } } | null }
const fileText = (r: FilesRes | undefined, name: string) => r?.theme?.files.nodes.find((n) => n.filename === name)?.body?.content;
const DATA_FILE = 'config/settings_data.json';

export function ThemeEditorPage() {
  const { id = '' } = useParams();
  const { t } = useI18n();
  const gid = numToGid('OnlineStoreTheme', id);
  const q = useQuery({ queryKey: ['theme-settings', gid], queryFn: () => gql<FilesRes>(THEME_SETTINGS, { id: gid }) });
  const loc = useQuery({ queryKey: ['theme-locales', gid], queryFn: () => gql<FilesRes>(THEME_LOCALES, { id: gid }), retry: false });
  if (q.isLoading) return <div className="grid gap-4"><Skeleton className="h-8 w-64" /><Skeleton className="h-96" /></div>;
  if (q.error) return <Banner>{q.error.message}</Banner>;
  if (!q.data?.theme) return <Banner>{t('themes.notFound')}</Banner>;
  return <Editor key={q.dataUpdatedAt} themeId={gid} name={q.data.theme.name ?? ''} schemaJson={fileText(q.data, 'config/settings_schema.json') ?? '[]'} dataJson={fileText(q.data, DATA_FILE)} localesData={loc.data} />;
}

function Editor({ themeId, name, schemaJson, dataJson, localesData }: { themeId: string; name: string; schemaJson: string; dataJson: string | undefined; localesData: FilesRes | undefined }) {
  const { t, lang } = useI18n();
  const toast = useToast();
  const qc = useQueryClient();
  const groups = parseSchema(schemaJson);
  const dict = parseDict(fileText(localesData, lang === 'fr' ? 'locales/fr.schema.json' : 'locales/en.default.schema.json') ?? fileText(localesData, 'locales/en.default.schema.json'));
  const [initial, setInitial] = useState(() => buildValues(groups, parseCurrent(dataJson)));
  const [saved, setSaved] = useState(dataJson);
  const [values, setValues] = useState(initial);
  const [device, setDevice] = useState<'desktop' | 'mobile'>('desktop');
  const [reload, setReload] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const dirty = JSON.stringify(values) !== JSON.stringify(initial);

  const save = useMutation({
    mutationFn: async () => {
      const value = serializeData(saved, values);
      await mutate(THEME_FILES_UPSERT, { themeId, files: [{ filename: DATA_FILE, body: { type: 'TEXT', value } }] }, 'themeFilesUpsert');
      return value;
    },
    onSuccess: (value) => { toast(t('themes.saved')); setSaved(value); setInitial(values); setError(null); setReload((n) => n + 1); void qc.invalidateQueries({ queryKey: ['theme-settings'] }); },
    onError: (e) => setError(e.message),
  });
  const label = (l?: string) => resolveLabel(l, dict);

  return (
    <>
      <SaveBar dirty={dirty} saving={save.isPending} onSave={() => save.mutate()} onDiscard={() => setValues(initial)} />
      <PageHeader back="/online-store" title={t('themes.customizeTitle', { name })}
        actions={<div className="flex rounded-md border border-line" role="group" aria-label={t('themes.device')}>
          {([['desktop', Monitor], ['mobile', Smartphone]] as const).map(([d, Icon]) => (
            <button key={d} type="button" aria-pressed={device === d} aria-label={t(`themes.${d}`)} onClick={() => setDevice(d)} className={`p-2 ${device === d ? 'bg-primary-subtle text-primary' : 'text-muted'}`}><Icon className="size-4" /></button>
          ))}
        </div>} />
      {error && <div className="mb-4"><Banner>{error}</Banner></div>}
      <div className="grid gap-4 lg:grid-cols-[22rem_1fr]">
        <div className="flex flex-col gap-2 lg:max-h-[calc(100vh-9rem)] lg:overflow-y-auto">
          {groups.length === 0 && <p className="text-sm text-muted">{t('themes.noSettings')}</p>}
          {groups.map((g, i) => <Group key={i} group={g} open={i === 0} label={label} values={values} onChange={(id, v) => setValues((s) => ({ ...s, [id]: v }))} />)}
        </div>
        <div className="flex justify-center rounded-lg border border-line bg-surface p-2">
          <iframe key={reload} title={t('themes.preview')} src={`/?preview=${reload}`} className={`h-[70vh] rounded-md border border-line bg-white ${device === 'mobile' ? 'w-[390px]' : 'w-full'}`} />
        </div>
      </div>
    </>
  );
}

function Group({ group, open, label, values, onChange }: { group: SettingGroup; open: boolean; label: (l?: string) => string; values: Record<string, SettingValue>; onChange: (id: string, v: SettingValue) => void }) {
  return (
    <details open={open} className="rounded-lg border border-line bg-canvas">
      <summary className="cursor-pointer px-3 py-2 text-sm font-semibold">{label(group.name)}</summary>
      <div className="flex flex-col gap-3 border-t border-line p-3">
        {group.settings.map((s, i) => isInput(s)
          ? <SettingField key={s.id} def={s} label={label(s.label)} info={s.info ? label(s.info) : undefined} value={values[s.id]!} optionLabel={label} onChange={(v) => onChange(s.id, v)} />
          : s.type === 'header' ? <h3 key={i} className="text-sm font-semibold">{label(s.content)}</h3>
            : s.type === 'paragraph' ? <p key={i} className="text-xs text-muted">{label(s.content)}</p> : null)}
      </div>
    </details>
  );
}

export function SettingField({ def, label, info, value, optionLabel, onChange }: { def: SettingDef & { id: string }; label: string; info?: string; value: SettingValue; optionLabel: (l?: string) => string; onChange: (v: SettingValue) => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const str = String(value);
  switch (def.type) {
    case 'color':
      return (
        <div className="flex flex-col gap-1"><span className="text-sm font-medium">{label}</span>
          <div className="flex items-center gap-2">
            <input type="color" aria-label={label} value={/^#[0-9a-f]{6}$/i.test(str) ? str : '#000000'} onChange={(e) => onChange(e.target.value)} className="size-9 rounded border border-line" />
            <input aria-label={`${label} (hex)`} value={str} onChange={(e) => onChange(e.target.value)} className="w-28 rounded-md border border-line bg-canvas px-2 py-1.5 text-sm" />
          </div>{info && <p className="text-xs text-muted">{info}</p>}</div>
      );
    case 'textarea': return <Textarea label={label} help={info} value={str} onChange={(e) => onChange(e.target.value)} />;
    case 'checkbox': return <Checkbox label={label} checked={value === true} onChange={(e) => onChange(e.target.checked)} />;
    case 'range':
      return (
        <div className="flex flex-col gap-1"><span className="flex justify-between text-sm font-medium">{label}<span className="font-normal text-muted">{str}{def.unit ?? ''}</span></span>
          <input type="range" aria-label={label} min={def.min} max={def.max} step={def.step ?? 1} value={Number(value)} onChange={(e) => onChange(Number(e.target.value))} className="accent-(--color-primary)" />
          {info && <p className="text-xs text-muted">{info}</p>}</div>
      );
    case 'select':
      return <Select label={label} help={info} value={str} onChange={(e) => onChange(e.target.value)}>{def.options?.map((o) => <option key={o.value} value={o.value}>{optionLabel(o.label)}</option>)}</Select>;
    case 'font_picker':
      return <Select label={label} help={info} value={str} onChange={(e) => onChange(e.target.value)}>{[...FONT_OPTIONS, ...(FONT_OPTIONS.some((f) => f.value === str) || !str ? [] : [{ value: str, label: str }])].map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</Select>;
    case 'radio':
      return (
        <fieldset className="flex flex-col gap-1"><legend className="text-sm font-medium">{label}</legend>
          {def.options?.map((o) => <label key={o.value} className="inline-flex items-center gap-2 text-sm"><input type="radio" name={def.id} className="accent-(--color-primary)" checked={str === o.value} onChange={() => onChange(o.value)} />{optionLabel(o.label)}</label>)}</fieldset>
      );
    case 'image_picker':
      return (
        <div className="flex flex-col gap-2"><span className="text-sm font-medium">{label}</span>
          {str && <img src={str} alt="" className="max-h-24 w-fit rounded-md border border-line object-contain" />}
          <ImageUploader multiple={false} compact label={t('media.upload')} onUploaded={(f) => onChange(f[0]!.url)} onError={(m) => toast(m, 'critical')} />
          {str && <Button size="sm" onClick={() => onChange('')}>{t('common.remove')}</Button>}</div>
      );
    case 'richtext':
      return <div className="flex flex-col gap-1"><span className="text-sm font-medium">{label}</span><RichTextEditor value={str} onChange={onChange} /></div>;
    default:
      return <Input label={label} help={info} type={def.type === 'url' ? 'url' : 'text'} value={str} onChange={(e) => onChange(e.target.value)} />;
  }
}
