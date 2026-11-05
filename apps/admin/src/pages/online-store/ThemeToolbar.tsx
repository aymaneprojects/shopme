import { Button, useToast } from '@shopme/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CopyPlus, Download, Eye, Keyboard, LayoutGrid, MoreHorizontal } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { mutate } from '../../api';
import { gidToNum } from '../../format';
import { THEME_DUPLICATE, THEME_PUBLISH } from '../../graphql';
import { useT } from '../../i18n';
import type { Key } from '../../i18n';
import { EditorMenu } from './EditorMenu';

/** The "more" menu and Publish button at the right of the editor's top bar. */
export function ThemeToolbar({ themeId, name, role, dirty, previewUrl, onShortcuts }: { themeId: string; name: string; role?: string; dirty: boolean; previewUrl: string; onShortcuts?: () => void }) {
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
  const duplicate = useMutation({
    mutationFn: () => mutate<{ newTheme: { id: string } }>(THEME_DUPLICATE, { id: themeId, name: t('themes.copyOf', { name }) }, 'themeDuplicate'),
    onSuccess: (r) => { toast(t('themes.duplicated')); refresh(); nav(`/online-store/themes/${gidToNum(r.newTheme.id)}/editor`); },
    onError: (e) => toast(e.message, 'critical'),
  });
  return (
    <>
      <button type="button" aria-label={t('common.moreActions')} aria-haspopup="menu" aria-expanded={!!menu} title={t('common.moreActions')} className="grid size-8 place-items-center rounded-md text-fg hover:bg-hover aria-expanded:bg-hover"
        onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setMenu(menu ? null : { x: r.right, y: r.bottom + 4 }); }}><MoreHorizontal className="size-4" /></button>
      {menu && (
        <EditorMenu at={menu} align="right" label={t('common.moreActions')} onClose={() => setMenu(null)}
          items={[
            { key: 'preview', label: t('editor.openPreview'), icon: <Eye />, onSelect: () => { window.open(previewUrl, '_blank', 'noopener'); } },
            { key: 'duplicate', label: t('themes.duplicate'), icon: <CopyPlus />, onSelect: () => duplicate.mutate() },
            { key: 'download', label: t('themes.download'), icon: <Download />, onSelect: () => { window.location.href = `/admin/api/themes/${gidToNum(themeId)}/download.zip`; } },
            ...(onShortcuts ? [{ key: 'shortcuts', label: t('editor.shortcuts'), icon: <Keyboard />, onSelect: onShortcuts }] : []),
            { key: 'all', label: t('editor.allThemes'), icon: <LayoutGrid />, separator: true, onSelect: () => nav('/online-store') },
          ]}
          footer={<><p className="text-[13px] font-semibold">{name}</p><p className="text-xs text-muted">{role ? t(`themes.role.${role}` as Key) : ''}</p></>} />
      )}
      <Button size="sm" disabled={live || dirty} loading={publish.isPending} title={dirty ? t('editor.saveFirst') : undefined} onClick={() => publish.mutate()}>{t('themes.publish')}</Button>
    </>
  );
}
