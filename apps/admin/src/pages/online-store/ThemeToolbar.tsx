import { Button, useToast } from '@shopme/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { BookOpen, CircleHelp, Code, Eye, Keyboard, Languages, MoreHorizontal } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { mutate } from '../../api';
import { gidToNum } from '../../format';
import { THEME_PUBLISH } from '../../graphql';
import { useT } from '../../i18n';
import type { Key } from '../../i18n';
import { EditorMenu } from './EditorMenu';

/** The "more" menu and Publish button at the right of the editor's top bar. */
export function ThemeToolbar({ themeId, name, role, dirty, previewUrl, onShortcuts, docsUrl, supportUrl, version, author }: { themeId: string; name: string; role?: string; dirty: boolean; previewUrl: string; onShortcuts?: () => void; /** The theme's documentation page (`theme_documentation_url` of its schema). */ docsUrl?: string; /** Where to get help with the theme (`theme_support_url`). */ supportUrl?: string; version?: string; /** `theme_author` of the schema. */ author?: string }) {
  const t = useT();
  const toast = useToast();
  const qc = useQueryClient();
  const nav = useNavigate();
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const live = role === 'MAIN';
  const refresh = () => { void qc.invalidateQueries({ queryKey: ['themes'] }); void qc.invalidateQueries({ queryKey: ['theme-settings'] }); };
  const publish = useMutation({
    mutationFn: () => mutate(THEME_PUBLISH, { id: themeId }, 'themePublish'),
    onSuccess: () => { toast(t('themes.published')); refresh(); },
    onError: (e) => toast(e.message, 'critical'),
  });
  return (
    <>
      <button type="button" aria-label={t('common.moreActions')} aria-haspopup="menu" aria-expanded={!!menu} title={t('common.moreActions')} className="grid size-8 place-items-center rounded-md text-fg hover:bg-hover aria-expanded:bg-hover"
        onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setMenu(menu ? null : { x: r.right, y: r.bottom + 4 }); }}><MoreHorizontal className="size-4" /></button>
      {menu && (
        <EditorMenu at={menu} align="right" label={t('common.moreActions')} onClose={() => setMenu(null)}
          items={[
            { key: 'code', label: t('bs.editCode'), icon: <Code />, onSelect: () => nav(`/online-store/themes/${gidToNum(themeId)}/code`) },
            { key: 'content', label: t('bs.editContent'), icon: <Languages />, onSelect: () => nav(`/online-store/themes/${gidToNum(themeId)}/content`) },
            { key: 'preview', label: t('fid.editor.preview'), icon: <Eye />, onSelect: () => { window.open(previewUrl, '_blank', 'noopener'); } },
            ...(docsUrl ? [{ key: 'docs', label: t('bs.docs'), icon: <BookOpen />, onSelect: () => { window.open(docsUrl, '_blank', 'noopener,noreferrer'); } }] : []),
            ...(onShortcuts ? [{ key: 'shortcuts', label: t('editor.shortcuts'), icon: <Keyboard />, onSelect: onShortcuts }] : []),
            ...(supportUrl ? [{ key: 'support', label: t('fid.editor.support'), icon: <CircleHelp />, onSelect: () => { window.open(supportUrl, '_blank', 'noopener,noreferrer'); } }] : []),
          ]}
          footer={<><p className="text-[13px]"><span className="font-semibold">{name}</span>{version && <span className="ml-1 text-muted">{version}</span>}</p><p className="text-xs text-muted">{author ? t('fid.editor.by', { author }) : role ? t(`themes.role.${role}` as Key) : ''}</p></>} />
      )}
      <Button size="sm" disabled={live || dirty} loading={publish.isPending} title={dirty ? t('editor.saveFirst') : undefined} onClick={() => publish.mutate()}>{t('themes.publish')}</Button>
    </>
  );
}
