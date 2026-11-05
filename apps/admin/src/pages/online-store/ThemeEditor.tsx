import { Banner, Skeleton, Tabs, useToast } from '@shopme/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Monitor, Smartphone } from 'lucide-react';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { gql, mutate } from '../../api';
import { PageHeader } from '../../components/PageHeader';
import { SaveBar } from '../../components/SaveBar';
import { gidToNum, numToGid } from '../../format';
import { THEME_FILES_UPSERT, THEME_LOCALES, THEME_SETTINGS } from '../../graphql';
import { useI18n } from '../../i18n';
import { useParams, useSearchParams } from 'react-router';
import { SettingField } from '../../components/SettingField';
import { SectionsEditor } from './SectionsEditor';
import { ThemeToolbar } from './ThemeToolbar';
import { buildValues, isInput, parseCurrent, parseDict, parseSchema, resolveLabel, serializeData } from '../../lib/settings-schema';
import type { SettingGroup, SettingValue } from '../../lib/settings-schema';

export const fileText = (r: FilesRes | undefined, name: string) => r?.theme?.files.nodes.find((n) => n.filename === name)?.body?.content;
export const DATA_FILE = 'config/settings_data.json';
export interface FilesRes { theme: { id: string; name?: string; role?: string; files: { nodes: Array<{ filename: string; body: { content?: string } | null }> } } | null }

export function ThemeEditorPage() {
  const { id = '' } = useParams();
  const { t } = useI18n();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') === 'settings' ? 'settings' : 'sections';
  const gid = numToGid('OnlineStoreTheme', id);
  const tabs = <div className="mb-4"><Tabs value={tab} onChange={(v) => setParams(v === 'settings' ? { tab: v } : {}, { replace: true })} tabs={[{ id: 'sections', label: t('editor.tabSections') }, { id: 'settings', label: t('editor.tabSettings') }]} /></div>;
  const q = useQuery({ queryKey: ['theme-settings', gid], queryFn: () => gql<FilesRes>(THEME_SETTINGS, { id: gid }) });
  const loc = useQuery({ queryKey: ['theme-locales', gid], queryFn: () => gql<FilesRes>(THEME_LOCALES, { id: gid }), retry: false });
  if (q.isLoading) return <div className="grid gap-4"><Skeleton className="h-8 w-64" /><Skeleton className="h-96" /></div>;
  if (q.error) return <Banner>{q.error.message}</Banner>;
  if (!q.data?.theme) return <Banner>{t('themes.notFound')}</Banner>;
  if (tab === 'sections') return <SectionsEditor themeId={gid} name={q.data.theme.name ?? ''} role={q.data.theme.role} tabs={tabs} localesData={loc.data} />;
  return <Editor key={q.dataUpdatedAt} tabs={tabs} themeId={gid} name={q.data.theme.name ?? ''} role={q.data.theme.role} schemaJson={fileText(q.data, 'config/settings_schema.json') ?? '[]'} dataJson={fileText(q.data, DATA_FILE)} localesData={loc.data} />;
}

function Editor({ tabs, themeId, name, role, schemaJson, dataJson, localesData }: { tabs: ReactNode; themeId: string; name: string; role?: string; schemaJson: string; dataJson: string | undefined; localesData: FilesRes | undefined }) {
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
    <div className="pt-10">
      <SaveBar dirty={dirty} saving={save.isPending} onSave={() => save.mutate()} onDiscard={() => setValues(initial)} />
      <PageHeader back="/online-store" title={t('themes.customizeTitle', { name })}
        actions={<>
          <div className="flex rounded-md border border-line" role="group" aria-label={t('themes.device')}>
            {([['desktop', Monitor], ['mobile', Smartphone]] as const).map(([d, Icon]) => (
              <button key={d} type="button" aria-pressed={device === d} aria-label={t(`themes.${d}`)} onClick={() => setDevice(d)} className={`p-2 ${device === d ? 'bg-primary-subtle text-accent' : 'text-muted'}`}><Icon className="size-4" /></button>
            ))}
          </div>
          <ThemeToolbar themeId={themeId} name={name} role={role} dirty={dirty} previewUrl={`/?preview_theme_id=${gidToNum(themeId)}`} />
        </>} />
      {tabs}
      {error && <div className="mb-4"><Banner>{error}</Banner></div>}
      <div className="grid gap-4 lg:grid-cols-[22rem_1fr]">
        <div className="flex flex-col gap-2 lg:max-h-[calc(100vh-9rem)] lg:overflow-y-auto">
          {groups.length === 0 && <p className="text-[13px] text-muted">{t('themes.noSettings')}</p>}
          {groups.map((g, i) => <Group key={i} group={g} open={i === 0} label={label} values={values} onChange={(id, v) => setValues((s) => ({ ...s, [id]: v }))} />)}
        </div>
        <div className="flex justify-center rounded-lg border border-line bg-surface p-2">
          <iframe key={reload} title={t('themes.preview')} src={`/?preview=${reload}`} className={`h-[70vh] rounded-md border border-line bg-white ${device === 'mobile' ? 'w-[390px]' : 'w-full'}`} />
        </div>
      </div>
    </div>
  );
}

function Group({ group, open, label, values, onChange }: { group: SettingGroup; open: boolean; label: (l?: string) => string; values: Record<string, SettingValue>; onChange: (id: string, v: SettingValue) => void }) {
  return (
    <details open={open} className="rounded-lg border border-line bg-canvas">
      <summary className="cursor-pointer px-3 py-2 text-[13px] font-semibold">{label(group.name)}</summary>
      <div className="flex flex-col gap-3 border-t border-line p-3">
        {group.settings.map((s, i) => isInput(s)
          ? <SettingField key={s.id} def={s} label={label(s.label)} info={s.info ? label(s.info) : undefined} value={values[s.id]!} optionLabel={label} onChange={(v) => onChange(s.id, v)} />
          : s.type === 'header' ? <h3 key={i} className="text-[13px] font-semibold">{label(s.content)}</h3>
            : s.type === 'paragraph' ? <p key={i} className="text-xs text-muted">{label(s.content)}</p> : null)}
      </div>
    </details>
  );
}
